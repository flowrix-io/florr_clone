// AI-controlled bots that fill empty player slots so the game always has ~20 players.
// Bots are regular ServerPlayer objects inserted into the shared `players` dict,
// so the existing tick, rendering, combat, and petal systems handle them with no
// special-casing beyond skipping save/save-game paths (no socket/userId).

import { Server as SocketIOServer } from '../ws_server';
import { isMobDead, mobSpawnTime, mobX, mobY } from './mobFields';
import { liveEnemies } from './enemyRegistry';
import { ServerPlayer } from '../player';
import { Enemy } from '../server_utils';
import { sanitizePublicPlayerForClient } from './playerWire';
import {
    players,
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    PLAYER_SIZE,
    SCALE_FACTOR,
    MapElement,
    WALL_TILE_SIZE,
    TELEPORTER_RADIUS,
    getTileState,
    isTileIdBlocking,
    worldToTileX,
    worldToTileY
} from '../constants';
import { WORLD_MAP, WALL_GRID } from '../map_data';
import { getPetalStats } from '../petals';
import { getMobStats } from '../mobs';
import { queryEnemiesNear } from './enemyGrid';
import { WorldItem } from '../item';
import { BOT_ID_PREFIX } from './shared/botId';
import { collectWorldItems } from './itemRegistry';
import {
    createSquad as createSquadFn,
    joinPublicSquad as joinPublicSquadFn,
    listPublicSquads as listPublicSquadsFn,
    leaveSquad as leaveSquadFn,
    getSquadForPlayer as getSquadForPlayerFn,
    sendSquadSystemMessage,
    playerSquadMap
} from './squadManager';
import { RARITY_ORDER } from './shared/rarity';
import { botPetalReach, botSpeedModifier } from './bots/botReach';
import { Entity, Phase, Query, Scheduler, SystemContext, World } from '../ecs';
import * as C from '../ecs/components';
import { ensurePlayerEntity } from './ecsSync';

// ---------------------------------------------------------------------------
// The two imports that are deliberately LAZY
// ---------------------------------------------------------------------------
// `./playerManager` reaches server/utils.ts, which imports petal_actions.ts and
// server/playerState.ts at module scope — and both of those bind port 3000 and
// open the account database on require. `./guildManager` imports ../database
// directly. Between them they made merely REQUIRING this file start a second
// live game server on the port the real one is using, which is why no gate could
// ever drive bot AI and why every claim about bot behaviour in this file was
// unverifiable.
//
// Neither is needed by the per-tick decision path: both are reached only from
// bot CREATION and RESPAWN (spawn positions, level curves, starting inventory,
// guild names). Deferring them to those call sites makes `require('botManager')`
// side-effect free, which is what `ecs/bench/bot_cutover_check.ts` relies on —
// and that gate asserts it, so the edge cannot quietly come back.
//
// Deferring does NOT reorder anything inside the circular petal_actions <-> server
// graph: by the time a bot is created the tick loop is running and server.ts has
// long since pulled both modules into the require cache. The require order in the
// live server is unchanged either way.
function population(): typeof import('./playerManager') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./playerManager');
}
function guilds(): typeof import('./guildManager') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./guildManager');
}


const TARGET_TOTAL_PLAYERS = 23;
const MAINTAIN_INTERVAL_MS = 1500;
const SPAWN_BURST_CAP = 4;
export const MAX_BOT_COUNT = 50;
// How long to keep bots running after the last human disconnects, so the
// world isn't immediately empty if someone reconnects quickly.
const BOT_IDLE_TIMEOUT_MS = 45_000;

// When set, maintainBotCount targets exactly this many bots regardless of how
// many real players are connected. null = default behavior (fill up to
// TARGET_TOTAL_PLAYERS minus real players).
let targetBotCountOverride: number | null = null;

export function setTargetBotCount(count: number | null): void {
    if (count === null) {
        targetBotCountOverride = null;
        return;
    }
    targetBotCountOverride = Math.max(0, Math.min(MAX_BOT_COUNT, Math.floor(count)));
}

export function getTargetBotCount(): number | null {
    return targetBotCountOverride;
}

// Combat tuning
const REGULAR_AGGRO_RANGE = 500;       // common/uncommon/rare
const HIGH_TIER_AGGRO_RANGE = 900;     // epic/legendary/mythic
// Distance bands are now computed dynamically from petal reach + mob radius.
// Buffer added on top of (petal reach + mob radius) to keep the player body
// outside the mob's collision circle.
const STANDOFF_SAFETY_BUFFER = 18;
const FLEE_HEALTH_RATIO = 0.22;
const ITEM_SEEK_RANGE = 600;
const BOT_RESPAWN_DELAY_MS = 3000;
const BOT_SPAWN_INVULNERABILITY_MS = 3000;

// Tether: keep bots clustered near a real player so their viewports overlap
// and the enemy spawner doesn't inflate mob counts across the map.
const TETHER_RADIUS = 1400;            // bot stays within this of its anchor
const TETHER_RETURN_RADIUS = 2200;     // past this, drop whatever it's doing and regroup
const SPAWN_JITTER = 500;              // jitter radius around spawn anchor

// Ultra+ bots roam mythic zones looking for boss spawns — wider tether so
// they can patrol the full zone and engage mobs across it.
const ULTRA_ROAM_RADIUS = 2400;
const ULTRA_ROAM_RETURN = 3200;

// Boss raiding: bosses ignore the tether so bots can converge across the map.
const BOSS_RAID_RANGE = 4000;          // bots within this distance of a boss will raid
// Tight clump around the boss — sized so every raiding bot shares ~90% of
// its viewport with every other raider (10% of VIEWPORT_WIDTH / HEIGHT).
const RAID_CLUSTER_RADIUS = 90;
const RAID_CLUSTER_RETURN = 180;

// High-rarity (legendary+) zones: bots form sub-groups of 4-10 with a moderate
// clump, rather than clinging to the human or spreading out individually.
const HIGH_RARITY_SCAN_RANGE = 1200;   // a legendary+ mob this close → high-rarity mode
const GROUP_CLUSTER_RADIUS = 500;
const GROUP_CLUSTER_RETURN = 900;
const GROUP_TARGET_SIZE = 7;           // target group size (4-10 band)
const GROUP_MIN_FOR_MODE = 4;          // don't enter group mode unless this many bots are in the group

// Raid targets only. Ultras are explicitly excluded — bots treat them as
// high-tier mobs, not raid rally points.
const BOSS_TIERS = new Set(['super', 'unique', 'apex']);
const HIGH_TIERS = new Set(['epic', 'legendary', 'mythic', 'ultra']);

// Raid traversal: when the bot is farther than this from the raid anchor,
// swap slot 0 for powder to close distance faster. Beyond combat range.
// Two thresholds (equip when far / unequip when near) instead of one: a bot
// hovering right at a single boundary would otherwise swap its loadout every
// tick, which both flickers on clients and yanks its speed up and down.
const RAID_POWDER_EQUIP_DIST = 700;
const RAID_POWDER_UNEQUIP_DIST = 460;
// Powder has no common tier, so we clamp the floor at uncommon.
const POWDER_MIN_RARITY_IDX = 1;

// Long-haul raid routing — activated when the bot is this far from the boss.
// Under this threshold, bots just walk (with powder) using the normal raid
// navigation.
const RAID_SHORTCUT_MIN_DIST = 4000;
// A teleporter is only worth taking if its destination is closer to the boss
// than this fraction of the bot's current distance to the boss.
const RAID_TELE_PAYOFF_RATIO = 0.55;

function tierPriority(tier: string | undefined): number {
    if (!tier) return 0;
    // Unique ranks above super so raids always commit to uniques when both exist.
    if (tier === 'unique') return 4;
    if (tier === 'super') return 3;
    if (HIGH_TIERS.has(tier)) return 2;
    return 1;
}

function aggroRangeForTier(tier: string | undefined): number {
    if (!tier) return REGULAR_AGGRO_RANGE;
    // Boss raiding: much wider range so bots across the map can converge.
    if (BOSS_TIERS.has(tier)) return BOSS_RAID_RANGE;
    if (HIGH_TIERS.has(tier)) return HIGH_TIER_AGGRO_RANGE;
    return REGULAR_AGGRO_RANGE;
}

const BOT_NAMES = [
    'm28', 'M28', 'uwu', '67', 'Play Zorr.pro', '', '', 'petal',
     'super hunter', 'mark m28', 'dev', 'fake dev', 'admin', 'pytorch', 'urmom', 'skibidi', 'florrio'
     , 'CraftApexPetal', 'developer', 'hi', 'hello', '4167', 'florrrrr', 'bro', 'bruh', 'You suck',
      'pls loot super', 'powder', 'skibidi ohio rizz', 'rizzler', 'pro', 'noob', 'nub', '[YT]', 'killer', 'flower', 'ur mom', 'random flower',
      'centi', 'petall', 'ygg pls', 'SUPER BASIC', 'carry pls', 'lol', 'floor', 'ded', 'noooo', 'nl super', 'nah', 'm29', 'm56', 'florr67', 'get good', 'super raider', 'real admin'
      , 'not bot', 'bot', 'scripts', 'ban dupers', 'absorbed super', 'Guest #1234', 'Guest #6767', 'Guest #4167', 'UwU', 'm27', 'n28', 'super petal', 'apex petal', 'apex crafter', 'uniques',
      'i use scripts', 'm28 bad', 'guests', 'leech squad', 'leecher'
];

// Only use passive petals, yggdrasil, and powder
const BOT_PETAL_POOL = ['basic', 'stinger', 'iris', 'faster', 'cutter', 'missile', 'bone', 'glass', 'dandelion', 'yggdrasil', 'rock', 'third_eye', 'powder', 'javascript', 'soil'];

/**
 * Pre-defined bot-only guilds. Each entry registers a guild in the guildManager
 * whose membership is a fixed set of bot display names drawn from BOT_NAMES.
 * Bots that spawn with a listed name appear as members of that guild (offline
 * when no instance is currently spawned). The first entry of `members` is the
 * leader. Guild names must be exactly 5 uppercase alphanumeric chars and unique.
 */
interface BotGuildDef {
    name: string;
    members: string[];
}

const BOT_GUILDS: BotGuildDef[] = [
    {
        name: 'PRO1',
        members: ['developer', 'dev', 'fake dev', 'admin', 'real admin'],
    },
    {
        name: 'SUPERS',
        members: ['m28', 'M28', 'm29', 'm56'],
    },
    {
        name: 'YGG',
        members: ['super hunter', 'SUPER BASIC', 'super raider', 'pls loot super', 'nl super', 'absorbed super'],
    },
    {
        name: 'LOL',
        members: ['skibidi', 'skibidi ohio rizz', 'rizzler'],
    },
    {
        name: 'AA',
        members: ['[YT]', 'Play Zorr.pro', 'florrio', 'CraftApexPetal'],
    },
    {
        name: 'ABCDE',
        members: ['bot', 'not bot', 'scripts', 'ban dupers'],
    },
];

export function initializeBotGuilds(): void {
    guilds().clearBotGuilds();
    for (const def of BOT_GUILDS) {
        if (def.members.length === 0) continue;
        const [leader, ...rest] = def.members;
        guilds().registerBotGuild(def.name, leader, rest);
    }
}

interface BotAIState {
    wanderTargetX: number;
    wanderTargetY: number;
    nextWanderTime: number;
    respawnAt?: number;
    // Idle pause during wander — bots stand still for a beat instead of
    // marching between wander points nonstop. atWanderTarget latches arrival
    // so the "do I pause here?" roll happens once per trip, not once per tick
    // spent standing on the target.
    idleUntil?: number;
    atWanderTarget?: boolean;
    // Sticky farming zone. Re-picking the anchor from a distance-sorted list
    // every tick made the "k-th nearest zone" flip as the bot moved, which is
    // the classic two-point shuffle: walk toward A, A becomes nearest, anchor
    // becomes B, walk back. The zone is chosen once and held.
    farmZoneX?: number;
    farmZoneY?: number;
    farmZoneRarityIdx?: number;
    farmZoneUntil?: number;
    farmZoneRotation?: number;
    // Mode hysteresis: highRarity mode lingers this long past the last positive
    // scan so a mob drifting in and out of range can't flap the anchor (and
    // with it the tether radius) between modes every tick.
    highRarityUntil?: number;
    // Target commitment. Without it two similarly-scored mobs swap the target
    // every tick and the bot walks back and forth between them.
    targetId?: string;
    targetAcquiredAt?: number;
    pickupId?: string;
    // Flee hysteresis — bots keep running until meaningfully healed rather
    // than flipping between flee and attack at the threshold.
    fleeing?: boolean;
    fleeUntil?: number;
    // Movement smoothing: last committed heading, turn-rate limited toward the
    // AI's requested direction so bots arc instead of snapping (and so a
    // one-tick direction flip can't translate into a visible jitter).
    headX?: number;
    headY?: number;
    // Strafe/circling direction, flipped on a slow timer so orbiting looks
    // deliberate but not robotic.
    strafeDir?: number;
    strafeFlipAt?: number;
    // Smoothed raid slot angle — the assigned slot jumps whenever the raider
    // set changes, so the bot eases toward it instead of teleporting around.
    slotAngle?: number;
    // Oscillation detector: samples position on a fixed interval and counts
    // direction reversals / non-movement. Trips an unstick maneuver.
    oscSampleAt?: number;
    oscX?: number;
    oscY?: number;
    oscPrevDX?: number;
    oscPrevDY?: number;
    oscReversals?: number;
    oscStill?: number;
    unstickUntil?: number;
    unstickDirX?: number;
    unstickDirY?: number;
    unstickTrips?: number;
    unstickTripsAt?: number;
    suppressTargetUntil?: number;
    // A* path state (raid / group mode only)
    pathNodes?: Waypoint[];
    pathIndex?: number;
    pathGoalTileX?: number;
    pathGoalTileY?: number;
    pathCreatedAt?: number;
    // Raid powder swap: when traversing to a raid target, slot 0 is replaced
    // with a powder petal so the bot closes the gap faster. Original contents
    // are restored once the bot arrives / raid ends.
    raidPowderSlot?: { slot: number; original: any };
    // Yggdrasil swap: when the bot is near other bots, slot 1 is replaced
    // with a yggdrasil petal so it can revive a teammate that goes down.
    // Restored when the bot is alone again.
    yggdrasilSlot?: { slot: number; original: any };
    // followPath throttles: last A* recompute (raid anchors on moving bosses
    // otherwise invalidate the goal every couple of ticks and drain the whole
    // per-tick A* budget forever), and last greedy-LOS smoothing pass (the
    // full waypoint-skip raycast loop is only needed a few times a second).
    lastRepathAt?: number;
    lastSmoothAt?: number;
}

interface Waypoint { x: number; y: number }

const botAIState = new Map<string, BotAIState>();
let lastMaintainTime = 0;
// Timestamp of the last tick that saw at least one real player. Used to keep
// bots alive for BOT_IDLE_TIMEOUT_MS after the server goes empty.
let lastActivePlayerTime = Date.now();

// Natural drift around the base bot target so the population doesn't look
// pinned to a fixed number. Random-walked each maintain tick and clamped to
// a small band around zero. Not used when targetBotCountOverride is set.
const BOT_COUNT_JITTER_MIN = -3;
const BOT_COUNT_JITTER_MAX = 2;
const BOT_COUNT_JITTER_STEP_CHANCE = 0.35;
let botCountJitter = 0;

// Force-raid state set by an external trigger (e.g., chat mentions of
// "super" / "unique"). While active and a qualifying boss still exists, every
// bot is yanked into raid mode on that target regardless of distance.
interface ForcedRaid {
    x: number;
    y: number;
    tier: string;
    until: number; // Date.now() expiration timestamp
}
let forcedRaid: ForcedRaid | null = null;
const FORCED_RAID_DURATION_MS = 45000; // 45s — enough for bots to traverse the map and engage

// Boss announcements: when a super/unique boss first appears, the nearest bot
// shouts it in chat, which also triggers the raid. Tracked by enemy id so we
// don't re-announce the same boss every tick.
const announcedBosses = new Set<string>();
// Cooldown between boss announcements / raid calls. Randomized per-announcement
// in [MIN, MAX] so bots don't chain-call raids the instant a new boss pops.
const BOSS_ANNOUNCE_COOLDOWN_MIN_MS = 60000;
const BOSS_ANNOUNCE_COOLDOWN_MAX_MS = 90000;
let nextBossAnnounceAllowedAt = 0;
// On the first announce pass, suppress bosses that already existed when the
// module came online (server boot / initial super spawn wave) so bots don't
// spam chat with a flood of callouts.
let bossAnnounceInitialized = false;

// Casual phrasings for boss sightings. Kept lower-case / inconsistently
// punctuated on purpose so bot chatter blends in with the usual player chat.
// Every template must include "super" or "unique" as a bare word so human-
// typed versions of these messages still trigger the chat-handler raid.
// {tier} = "super" | "unique", {mob} = e.g. "beetle", {code} = squad ID.
// Templates containing {code} are only used when the announcing bot is in a
// squad — they're filtered out otherwise.
const BOSS_SHOUT_TEMPLATES_SUPER = [
    '{tier} {mob}',
    '{tier} {mob} come',
    '{tier} {mob} lets go',
    'who wants {tier} {mob}',
    'need help {tier} {mob}',
    '{tier} {mob} anyone',
    '{mob} {tier} here',
    '{tier} {mob} spawn',
    '{tier} {mob} free',
    '{tier} {mob} free mzone',
    '{tier} {mob} free lzone',
    'super shiny',
    'free {tier} {mob}',
    '{tier} {mob} deep',
    '{tier} {mob} lured',
    's{mob}',
    's{mob} unfree',
    'less than 20 ppl at {tier} {mob}',
    '{tier} {mob} free carry',
    'I have previously said things which I regret. Now I ponder in silence.',
    'pls carry',
    'free carry {code}',
    '{tier} {mob} carry code {code}',
];
const BOSS_SHOUT_TEMPLATES_UNIQUE = [
    'q{mob}',
    'how {tier} {mob}',
    '{tier} {mob} come',
    '{tier} {mob} lets go',
    'who wants {tier} {mob}',
    '{tier} {mob} anyone',
    '{mob} {tier} here',
    '{tier} {mob} so free',
    'WHAT {tier} {mob}',
    'q{mob} pls loot',
    'q{mob} pls carry',
    '{tier} {mob} pls carry',
    '{tier} {mob} pls loot',
    'q{mob} so free',
    'less than 20 ppl at {tier} {mob}',
    'I have previously said things which I regret. Now I ponder in silence.',
    'pls carry',
    'free carry {code}',
    '{tier} {mob} carry code {code}',
];

export function isBot(id: string): boolean {
    return id.startsWith(BOT_ID_PREFIX);
}

// ---------------------------------------------------------------------------
// The bot roster
// ---------------------------------------------------------------------------
/**
 * This tick's bots, resolved from the ECS rather than by scanning `players`.
 *
 * `C.IsBot` existed before this change and was even set correctly, but NOTHING
 * read it: every bot enumeration in this file was `for (const id in players)`
 * plus a `bot_` prefix test. A tag nobody reads is a tag that can silently stop
 * being set — the failure mode would be an empty ECS-side bot query and a wrong
 * answer rather than an error. Driving the roster off the query makes the tag
 * load-bearing, and `ecs/bench/bot_cutover_check.ts` pins the two definitions of
 * "is a bot" to each other.
 *
 * The `bot_` prefix stays authoritative on the LEGACY side (playerState's
 * spawn-budget and streaming exclusions, the spawners, squads, chat all test it,
 * and none of them have a world handle). This is a second view of the same
 * fact, kept honest by the check below rather than by hope.
 *
 * Rebuilt once per bot tick into a reused array. That is also strictly less work
 * than what it replaces: `driveMove` alone re-scanned every key of `players` for
 * every bot, every tick.
 */
const botRoster: ServerPlayer[] = [];
let botQuery: Query | undefined;
let botQueryWorld: World | undefined;
/** Rate limit for the roster-disagreement warning; it would otherwise be per tick. */
let rosterMismatchLogged = 0;

/**
 * Refill `botRoster` from the ECS.
 *
 * Falls back to the prefix scan when the two disagree, and says so. A live game
 * must not stop running bots because a tag regressed, but the disagreement has
 * to be findable — and in the gate it is fatal, not a warning.
 */
function rebuildBotRoster(world: World): void {
    if (botQueryWorld !== world || botQuery === undefined) {
        botQuery = world.query([C.IsPlayer, C.IsBot], [C.IsLobby]);
        botQueryWorld = world;
    }

    botRoster.length = 0;
    botQuery.chunks(chunk => {
        const entities = chunk.entities;
        for (let i = 0; i < chunk.count; i++) {
            const id = world.externalIdOf(entities[i] as Entity);
            if (id === undefined) continue;
            // A bot removed earlier this tick still has an entity until the mob
            // window's syncToEcs reaps it. Its ServerPlayer is already gone, and
            // it must not be driven.
            const bot = players[id];
            if (bot !== undefined) botRoster.push(bot);
        }
    });

    let prefixCount = 0;
    for (const id in players) if (isBot(id)) prefixCount++;
    if (botRoster.length === prefixCount) return;

    if (rosterMismatchLogged < 5) {
        rosterMismatchLogged++;
        console.warn(
            `[bots] ECS roster (${botRoster.length}) disagrees with the bot_ prefix `
            + `(${prefixCount}). C.IsBot is not being set for every bot — see `
            + 'server/ecsBridge.importPlayer. Falling back to the prefix scan.',
        );
    }
    botRoster.length = 0;
    for (const id in players) {
        if (!isBot(id)) continue;
        const bot = players[id];
        if (bot !== undefined) botRoster.push(bot);
    }
}

/**
 * The two definitions of "is a bot", counted independently. For the gate.
 *
 * `ecs` is the C.IsBot query BEFORE the prefix fallback kicks in; `prefix` is
 * the legacy `bot_` test. `ecs/bench/bot_cutover_check.ts` requires them equal,
 * which is what makes the tag load-bearing: the fallback keeps a live server
 * running when they diverge, and this makes CI refuse to ship the divergence.
 */
export function botRosterCounts(world: World): { ecs: number; prefix: number } {
    if (botQueryWorld !== world || botQuery === undefined) {
        botQuery = world.query([C.IsPlayer, C.IsBot], [C.IsLobby]);
        botQueryWorld = world;
    }
    let ecs = 0;
    botQuery.chunks(chunk => {
        const entities = chunk.entities;
        for (let i = 0; i < chunk.count; i++) {
            const id = world.externalIdOf(entities[i] as Entity);
            if (id !== undefined && players[id] !== undefined) ecs++;
        }
    });
    let prefix = 0;
    for (const id in players) if (isBot(id)) prefix++;
    return { ecs, prefix };
}

function generateBotId(): string {
    return BOT_ID_PREFIX + Math.random().toString(36).substring(2, 10);
}

// Per-level-band rarity weights derived (offline) from aggregating real-player
// inventories in server_inventory.json. Each band covers 10 levels. Within a
// band the values are relative weights; they're converted to a cumulative
// distribution at startup and sampled with a weighted roll.
//
// Methodology (one-time analysis):
//   * For every saved player, compute level from totalXP and bucket by
//     floor((level-1)/10).
//   * Sum petal counts per rarity, capped at 20 per player to prevent a
//     single whale/admin inventory from dominating a band.
//   * Drop `unique` in low bands (1-80) where it's clearly admin stock.
//   * Fill missing bands by interpolating from neighbours.
const LEVEL_BAND_SIZE = 10;
type RarityWeight = [string, number];
const RARITY_WEIGHTS_BY_BAND: Record<number, RarityWeight[]> = {
    0:  [['common', 300], ['uncommon', 55], ['rare', 1]],                                                             // levels 1-10
    1:  [['common', 40], ['uncommon', 24], ['rare', 15], ['epic', 2]],                                                // levels 11-20
    2:  [['common', 30], ['uncommon', 24], ['rare', 20], ['epic', 5]],                                                // levels 21-30 (interpolated)
    3:  [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 5]],                                                // levels 31-40
    4:  [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 1]],                             // levels 41-50
    5:  [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 4]],                             // levels 51-60
    6:  [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 11]],                            // levels 61-70
    7:  [['common', 18], ['uncommon', 18], ['rare', 20], ['epic', 20], ['legendary', 15], ['mythic', 1]],             // levels 71-80
    8:  [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 2]],             // levels 81-90
    9:  [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 5]],             // levels 91-100
    10: [['common', 40], ['uncommon', 40], ['rare', 40], ['epic', 40], ['legendary', 40], ['mythic', 17]],            // levels 101-110
    11: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 11], ['ultra', 1]], // levels 111-120
    12: [['common', 40], ['uncommon', 40], ['rare', 40], ['epic', 40], ['legendary', 40], ['mythic', 40], ['ultra', 21], ['super', 1]], // levels 121-130
    13: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 20], ['ultra', 20], ['super', 20]], // levels 131-140
    14: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 20], ['ultra', 20], ['super', 20], ['unique', 1]], // levels 141-199
    // Apex band — level 200+. Loadout skews heavily toward end-game rarities,
    // with apex as the headliner. Routed by explicit level check below, not
    // the normal rawBand / LEVEL_BAND_SIZE math.
    // Unique kept rare: bots wearing any unique petal show as unique-rarity in
    // the world, and at 10 petal slots even a small per-slot weight produces a
    // lot of "unique" bots if it's not held down.
    20: [['mythic', 10], ['ultra', 20], ['super', 20], ['unique', 2], ['apex', 30]]
};
const APEX_BAND = 20;
const APEX_LEVEL_THRESHOLD = 200;
const MAX_PRE_APEX_BAND = 14;

// Pre-compute cumulative distributions for fast sampling
interface CumulativeBand {
    cumulative: number[];
    rarities: string[];
    total: number;
}
const CUMULATIVE_BY_BAND: Record<number, CumulativeBand> = {};
for (const bandKey of Object.keys(RARITY_WEIGHTS_BY_BAND)) {
    const band = Number(bandKey);
    const weights = RARITY_WEIGHTS_BY_BAND[band];
    const cumulative: number[] = [];
    const rarities: string[] = [];
    let acc = 0;
    for (const [rarity, w] of weights) {
        acc += w;
        cumulative.push(acc);
        rarities.push(rarity);
    }
    CUMULATIVE_BY_BAND[band] = { cumulative, rarities, total: acc };
}


// djb2-style string hash → 32-bit unsigned int. Stable across runs, so a bot
// with the same name always hashes to the same seed.
function hashString(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(h, 33) ^ s.charCodeAt(i)) | 0;
    }
    return h >>> 0;
}

// mulberry32 — fast deterministic PRNG. Same seed → same stream, so name-
// seeded bots reproduce the same level + loadout every spawn.
function seededRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pickRarityForLevel(level: number, rng: () => number): string {
    // Apex is a separate band, not a linear extension of the level→band map:
    // levels 200+ always roll from the apex pool.
    let band: number;
    if (level >= APEX_LEVEL_THRESHOLD) {
        band = APEX_BAND;
    } else {
        const rawBand = Math.floor(Math.max(1, level - 1) / LEVEL_BAND_SIZE);
        band = Math.min(rawBand, MAX_PRE_APEX_BAND);
    }
    const entry = CUMULATIVE_BY_BAND[band] || CUMULATIVE_BY_BAND[0];
    const roll = (rng() * 2) + entry.total - 2;
    for (let i = 0; i < entry.cumulative.length; i++) {
        if (roll < entry.cumulative[i]) return entry.rarities[i];
    }
    return entry.rarities[entry.rarities.length - 1];
}

function rollBotLevel(rng: () => number): number {
    // Uniform 1-225. Roughly 11% of bots land at apex tier (level >= 200).
    // Derived from the name-seeded rng so same-name bots share a level.
    return Math.floor(rng() * 225) + 1;
}

// Recompute the level a bot named `name` would roll. Mirrors the rng draw
// order in createBot so callers (e.g. /level-from-string) see the same value
// without needing to spawn the bot.
export function getBotLevelForName(name: string): number {
    const rng = seededRng(hashString(name));
    return rollBotLevel(rng);
}

// Recompute the loadout a bot named `name` would roll. Must consume `rollBotLevel`
// first so the rng stream lines up with createBot — otherwise the loadout would
// diverge from what an actual bot of that name carries.
export function getBotLoadoutForName(name: string): any[] {
    const rng = seededRng(hashString(name));
    const level = rollBotLevel(rng);
    return buildBotLoadout(level, rng);
}

function buildBotLoadout(level: number, rng: () => number): any[] {
    const loadout: any[] = [];

    // Fill all 10 slots so bots have a full active loadout (matches max real-
    // player capacity) rather than 5 equipped + 5 empty slots.
    for (let i = 0; i < 10; i++) {
        const petalType = BOT_PETAL_POOL[Math.floor(rng() * BOT_PETAL_POOL.length)];
        const rarity = pickRarityForLevel(level, rng);
        const stats = getPetalStats(petalType, rarity);
        if (stats) {
            loadout.push({
                type: 'petal',
                rarity,
                petalType,
                health: stats.health,
                maxHealth: stats.health,
                onCooldown: false
            });
        } else {
            const fallback = getPetalStats('basic', 'common');
            loadout.push({
                type: 'petal',
                rarity: 'common',
                petalType: 'basic',
                health: fallback?.health ?? 10,
                maxHealth: fallback?.health ?? 10,
                onCooldown: false
            });
        }
    }

    return loadout;
}

function pickPowderRarity(loadout: any[]): string {
    let maxIdx = 0;
    if (loadout) {
        for (const item of loadout) {
            if (!item || item.type !== 'petal' || !item.rarity) continue;
            const idx = RARITY_ORDER.indexOf(item.rarity);
            if (idx > maxIdx) maxIdx = idx;
        }
    }
    return RARITY_ORDER[Math.max(POWDER_MIN_RARITY_IDX, maxIdx)];
}

// Bot's "power rarity" — the max petal rarity across their loadout. Drives
// target selection: a common-loadout bot hunts uncommon mobs, a mythic bot
// hunts mythic, ultra+ bots go boss hunting.
function getBotMaxRarityIdx(bot: ServerPlayer): number {
    let maxIdx = 0;
    if (bot.loadout) {
        for (const item of bot.loadout) {
            if (!item || item.type !== 'petal' || !item.rarity) continue;
            const idx = RARITY_ORDER.indexOf(item.rarity);
            if (idx > maxIdx) maxIdx = idx;
        }
    }
    return maxIdx;
}

// Which mob tier(s) this bot prefers to engage. Mirrors the progression rule
// "one tier above your gear, except mythic stays on mythic and ultra+ hunts
// bosses". Empty set = no preference (fall through to standard priority).
const MYTHIC_IDX = RARITY_ORDER.indexOf('mythic');
const ULTRA_IDX = RARITY_ORDER.indexOf('ultra');
function preferredMobTiersForBot(botIdx: number): Set<string> {
    if (botIdx >= ULTRA_IDX) return new Set(['super', 'unique', 'apex']);
    if (botIdx === MYTHIC_IDX) return new Set(['mythic']);
    if (botIdx >= 0 && botIdx < RARITY_ORDER.length - 1) {
        return new Set([RARITY_ORDER[botIdx + 1]]);
    }
    return new Set();
}

// Per-spawn-zone-type cache of zone centres. Resolved once at first use from
// WORLD_MAP and reused for every bot's anchor pick.
interface SpawnZone { cx: number; cy: number }
const spawnZoneCache = new Map<string, SpawnZone[]>();
function getSpawnZonesByType(zoneType: string): SpawnZone[] {
    const cached = spawnZoneCache.get(zoneType);
    if (cached) return cached;
    const out: SpawnZone[] = [];
    for (const el of WORLD_MAP) {
        if (el.type !== 'spawn') continue;
        if (el.properties?.spawnType !== zoneType) continue;
        if (el.width <= 0 || el.height <= 0) continue;
        out.push({
            cx: (el.x + el.width / 2) * SCALE_FACTOR,
            cy: (el.y + el.height / 2) * SCALE_FACTOR
        });
    }
    spawnZoneCache.set(zoneType, out);
    return out;
}

// Map a bot's max gear rarity to the spawn zone type it should farm in. The
// bot already prefers to fight mobs one tier above its gear (see
// preferredMobTiersForBot), and spawn zones spawn mobs of their declared
// type, so the right zone for farming is the one that produces the bot's
// preferred tier.
function getFarmingZoneType(rarityIdx: number): string {
    if (rarityIdx >= ULTRA_IDX) return 'mythic';        // ultra+ hunt mythic-zone bosses
    if (rarityIdx === MYTHIC_IDX) return 'mythic';      // mythic bots stay on mythic
    if (rarityIdx === 4) return 'mythic';               // legendary -> mythic
    if (rarityIdx === 3) return 'legendary';            // epic -> legendary
    if (rarityIdx === 2) return 'epic';                 // rare -> epic
    if (rarityIdx === 1) return 'rare';                 // uncommon -> rare
    return 'uncommon';                                  // common -> uncommon
}

// Pick a farming-zone anchor of the given type. Uses the bot id as a stable
// hash so different bots gravitate toward different zones instead of all
// piling onto the nearest one. Falls back through neighbour zone types when
// the bot's preferred type isn't on the map (so a map without rare zones
// still routes uncommon-tier bots somewhere sensible).
//
// The candidate list is ordered by world position, NOT by distance from the
// bot. Distance ordering made the pick unstable: as the bot walked toward the
// k-th nearest zone that zone became the (k-1)-th, the pick slid onto a
// different zone, and the bot turned around — a permanent two-point shuffle
// between whichever pair of zones kept trading places. `rotation` lets the
// caller advance a bot to a different zone deliberately (see the farm-zone
// timer in computeBotMode) instead of it happening as a side effect of moving.
function pickFarmingZoneAnchor(bot: ServerPlayer, rarityIdx: number, rotation: number = 0): { x: number; y: number } | null {
    // Try the bot's preferred type first, then walk down toward common, then
    // up toward mythic. Stops as soon as some zone type has any zones.
    const tried = new Set<string>();
    const preferred = getFarmingZoneType(rarityIdx);
    const candidates: string[] = [preferred];
    for (let i = rarityIdx; i >= 0; i--) {
        const t = getFarmingZoneType(i);
        if (!tried.has(t)) { tried.add(t); candidates.push(t); }
    }
    for (let i = rarityIdx + 1; i <= 6; i++) {
        const t = getFarmingZoneType(i);
        if (!tried.has(t)) { tried.add(t); candidates.push(t); }
    }

    let zones: SpawnZone[] = [];
    for (const t of candidates) {
        zones = getSpawnZonesByType(t);
        if (zones.length > 0) break;
    }
    if (zones.length === 0) return null;

    let h = 0;
    for (let i = 0; i < bot.id.length; i++) h = ((h * 31) + bot.id.charCodeAt(i)) | 0;
    // Position-independent ordering so the same bot always maps to the same
    // zone for a given rotation, no matter where it currently stands.
    const ordered = [...zones].sort((a, b) => (a.cx - b.cx) || (a.cy - b.cy));
    const idx = (((Math.abs(h) + rotation) % ordered.length) + ordered.length) % ordered.length;
    const pick = ordered[idx];
    return { x: pick.cx, y: pick.cy };
}

function equipRaidPowder(bot: ServerPlayer, state: BotAIState): void {
    if (state.raidPowderSlot !== undefined) return;
    if (!bot.loadout || bot.loadout.length === 0) return;

    const slot = 0;
    const current = bot.loadout[slot];
    // Already a powder here — nothing to swap, nothing to track.
    if (current && current.type === 'petal' && current.petalType === 'powder') return;

    const rarity = pickPowderRarity(bot.loadout);
    const stats = getPetalStats('powder', rarity);
    if (!stats) return;

    state.raidPowderSlot = { slot, original: current };
    bot.loadout[slot] = {
        type: 'petal',
        rarity: rarity as any,
        petalType: 'powder',
        health: stats.health,
        maxHealth: stats.health,
        onCooldown: false
    };
}

function unequipRaidPowder(bot: ServerPlayer, state: BotAIState): void {
    if (state.raidPowderSlot === undefined) return;
    const { slot, original } = state.raidPowderSlot;
    if (bot.loadout && slot < bot.loadout.length) {
        bot.loadout[slot] = original;
    }
    state.raidPowderSlot = undefined;
}

// Range within which a bot will keep yggdrasil equipped. Picked to roughly
// match the BOT_GROUP scan range so a bot that's already moving with peers
// also packs the heal petal. The revive range itself (in playerState.ts) is
// only 80 px, so the petal is only useful when the bots are tight.
const YGGDRASIL_BUDDY_RANGE = 600;
// Once equipped, the buddy has to get this far away before the petal is
// dropped again — otherwise a bot pacing around the 600 px mark re-rolls its
// loadout every tick.
const YGGDRASIL_BUDDY_DROP_RANGE = 820;
// Range at which a bot will go out of its way to revive a downed teammate.
// Larger than the petal's actual revive range so the bot has time to close
// the last bit of distance before its rotating petals brush the corpse.
const YGGDRASIL_REVIVE_SEEK_RANGE = 1500;

// Returns the rarity tier the yggdrasil swap should pick. Mirrors how the
// powder swap matches the bot's existing loadout: the new petal can't out-tier
// what they're already wearing, otherwise apex bots would walk around with
// permanently-rolled apex yggdrasils nobody else can craft.
function pickYggdrasilRarity(loadout: any[]): string {
    let maxIdx = 0;
    if (loadout) {
        for (const item of loadout) {
            if (!item || item.type !== 'petal' || !item.rarity) continue;
            const idx = RARITY_ORDER.indexOf(item.rarity);
            if (idx > maxIdx) maxIdx = idx;
        }
    }
    return RARITY_ORDER[maxIdx];
}

function equipYggdrasilSlot(bot: ServerPlayer, state: BotAIState): void {
    if (state.yggdrasilSlot !== undefined) return;
    if (!bot.loadout || bot.loadout.length < 2) return;

    const slot = 1;
    const current = bot.loadout[slot];
    // Already a yggdrasil here — nothing to swap, nothing to track.
    if (current && current.type === 'petal' && current.petalType === 'yggdrasil') return;
    // Don't overwrite the powder swap if the powder swap also picked slot 1
    // for any reason (currently it always uses slot 0, but keep this check so
    // a future tweak doesn't silently clobber the saved original).
    if (state.raidPowderSlot && state.raidPowderSlot.slot === slot) return;

    const rarity = pickYggdrasilRarity(bot.loadout);
    const stats = getPetalStats('yggdrasil', rarity);
    if (!stats) return;

    state.yggdrasilSlot = { slot, original: current };
    bot.loadout[slot] = {
        type: 'petal',
        rarity: rarity as any,
        petalType: 'yggdrasil',
        health: stats.health,
        maxHealth: stats.health,
        onCooldown: false
    };
}

function unequipYggdrasilSlot(bot: ServerPlayer, state: BotAIState): void {
    if (state.yggdrasilSlot === undefined) return;
    const { slot, original } = state.yggdrasilSlot;
    if (bot.loadout && slot < bot.loadout.length) {
        bot.loadout[slot] = original;
    }
    state.yggdrasilSlot = undefined;
}

// True if there's at least one other live bot within YGGDRASIL_BUDDY_RANGE.
// Used to decide whether to keep yggdrasil equipped — there's no point
// carrying a revive petal when the bot is alone.
function hasNearbyBotBuddy(bot: ServerPlayer, range: number = YGGDRASIL_BUDDY_RANGE): boolean {
    const rSq = range * range;
    for (let i = 0; i < botRoster.length; i++) {
        const other = botRoster[i];
        if (other.id === bot.id) continue;
        if ((other as any).isDead) continue;
        const dx = other.x - bot.x;
        const dy = other.y - bot.y;
        if (dx * dx + dy * dy <= rSq) return true;
    }
    return false;
}

// Closest dead bot inside YGGDRASIL_REVIVE_SEEK_RANGE that's worth diverting
// to revive. Returns null if there's no such corpse or this bot has no
// yggdrasil equipped (we'd waste the trip).
function findReviveTarget(bot: ServerPlayer, state: BotAIState): ServerPlayer | null {
    // No yggdrasil equipped → no revive capability. We only count the swapped
    // slot here; if a bot happens to have yggdrasil in its native loadout the
    // existing petal-touch revival in playerState.ts already covers it.
    if (state.yggdrasilSlot === undefined) {
        // Still check native loadout for yggdrasil so naturally-rolled
        // yggdrasil bots also actively seek corpses.
        let hasYgg = false;
        if (bot.loadout) {
            for (const item of bot.loadout) {
                if (item && item.type === 'petal' && item.petalType === 'yggdrasil') {
                    hasYgg = true;
                    break;
                }
            }
        }
        if (!hasYgg) return null;
    }

    const rSq = YGGDRASIL_REVIVE_SEEK_RANGE * YGGDRASIL_REVIVE_SEEK_RANGE;
    let best: ServerPlayer | null = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < botRoster.length; i++) {
        const other = botRoster[i];
        if (other.id === bot.id) continue;
        if (!other.isDead) continue;
        const dx = other.x - bot.x;
        const dy = other.y - bot.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > rSq) continue;
        if (d2 < bestDistSq) {
            best = other;
            bestDistSq = d2;
        }
    }
    return best;
}

// Pick the single-hop teleporter whose destination minimises total travel to
// the boss. Returns the teleporter source position (where the bot needs to
// walk to) or null if no teleporter is worth using. Cross-server teleporters
// are skipped — bots stay on their own server.
function findRaidTeleporterSrc(
    botX: number, botY: number,
    bossX: number, bossY: number
): { x: number; y: number } | null {
    const directDist = Math.sqrt((bossX - botX) ** 2 + (bossY - botY) ** 2);
    let bestTotal = directDist;
    let bestX = 0, bestY = 0;
    let found = false;

    for (const el of WORLD_MAP) {
        if (el.type !== 'teleporter') continue;
        const dest = el.properties?.teleportTo;
        if (!dest) continue;
        if (dest.serverPort) continue;

        const srcX = el.x + el.width / 2;
        const srcY = el.y + el.height / 2;
        const srcToBot = Math.sqrt((srcX - botX) ** 2 + (srcY - botY) ** 2);
        const destToBoss = Math.sqrt((dest.x - bossX) ** 2 + (dest.y - bossY) ** 2);

        // Only worth it if the teleport destination is actually close to the boss
        if (destToBoss > directDist * RAID_TELE_PAYOFF_RATIO) continue;

        const total = srcToBot + destToBoss;
        if (total < bestTotal) {
            bestTotal = total;
            bestX = srcX;
            bestY = srcY;
            found = true;
        }
    }

    return found ? { x: bestX, y: bestY } : null;
}

// Handles long-haul raid navigation: either route via teleporter or warp the
// bot to a spawn zone near the boss. Returns true when this tick was handled
// (caller should `continue`), false to fall through to normal raid movement.
function handleRaidShortcut(
    bot: ServerPlayer,
    state: BotAIState,
    now: number,
    anchor: { x: number; y: number },
    distToAnchor: number
): boolean {
    if (distToAnchor < RAID_SHORTCUT_MIN_DIST) return false;

    // Preferred: a teleporter that gets the bot meaningfully closer.
    const teleSrc = findRaidTeleporterSrc(bot.x, bot.y, anchor.x, anchor.y);
    if (teleSrc) {
        const dx = teleSrc.x - bot.x;
        const dy = teleSrc.y - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        // Inside the teleporter's activation radius — hold still so the 1s
        // timer fires. The teleporter logic in playerState runs for all
        // players including bots.
        if (d < TELEPORTER_RADIUS * 0.6) {
            bot.inputs.useMouse = false;
            bot.inputs.keys = [];
            bot.inputs.petalExtension = 1.0;
            return true;
        }
        // Navigate to the teleporter source. A* first, cheap steer as fallback.
        if (followPath(bot, state, now, teleSrc.x, teleSrc.y, 1.0, 1.0)) return true;
        const nd = d || 1;
        const steered = steerAroundWalls(bot.x, bot.y, dx / nd, dy / nd);
        driveMove(bot, steered.x, steered.y, 1.0, 1.0);
        return true;
    }

    // No teleporter helps — bot walks the rest of the way. Respawn-near-boss
    // is handled on death via respawnBot, not by warping a live bot.
    return false;
}

function nearestRealPlayer(x: number, y: number): ServerPlayer | null {
    let best: ServerPlayer | null = null;
    let bestD = Infinity;
    for (const id in players) {
        if (isBot(id)) continue;
        const p = players[id];
        if (!p || p.isDead) continue;
        const dx = p.x - x;
        const dy = p.y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
            bestD = d;
            best = p;
        }
    }
    return best;
}

function getSpawnAnchorElements(): MapElement[] {
    // Spawn zones and teleporters are the natural "entry points" of the map —
    // real players appear at these, so bots spawning here blend in and stay
    // close to where humans tend to be.
    return WORLD_MAP.filter(
        e => (e.type === 'spawn' || e.type === 'teleporter') && e.width > 0 && e.height > 0
    );
}

function pickBotSpawnPosition(): { x: number; y: number } {
    const anchors = getSpawnAnchorElements();

    if (anchors.length > 0) {
        // Try a handful of spawn/portal anchors to find a safe spot nearby.
        const shuffled = [...anchors].sort(() => Math.random() - 0.5).slice(0, 8);
        for (const anchor of shuffled) {
            const padding = 20;
            const baseArea = {
                x: anchor.x + padding,
                y: anchor.y + padding,
                width: Math.max(0, anchor.width - padding * 2),
                height: Math.max(0, anchor.height - padding * 2)
            };

            // First try inside the zone itself
            if (baseArea.width > 0 && baseArea.height > 0) {
                const inside = population().findSafeSpawnPosition(baseArea, 10);
                if (inside) return inside;
            }

            // Otherwise jitter around the anchor's center (useful for portals
            // which are small and surrounded by walkable terrain).
            const cx = anchor.x + anchor.width / 2;
            const cy = anchor.y + anchor.height / 2;
            for (let i = 0; i < 6; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 100 + Math.random() * SPAWN_JITTER;
                const jitterArea = {
                    x: cx + Math.cos(angle) * dist - 60,
                    y: cy + Math.sin(angle) * dist - 60,
                    width: 120,
                    height: 120
                };
                const safe = population().findSafeSpawnPosition(jitterArea, 4);
                if (safe) return safe;
            }
        }

        // Final fallback: centre of a random anchor (scaled to world coords)
        const anchor = anchors[Math.floor(Math.random() * anchors.length)];
        return {
            x: (anchor.x + anchor.width / 2) * SCALE_FACTOR,
            y: (anchor.y + anchor.height / 2) * SCALE_FACTOR
        };
    }

    // No spawn zones configured — fall back to a world-wide safe spawn
    const safe = population().findSafeSpawnPosition(
        { x: 0, y: 0, width: ACTUAL_WORLD_WIDTH, height: ACTUAL_WORLD_HEIGHT },
        30
    );
    if (safe) return safe;
    return {
        x: Math.random() * ACTUAL_WORLD_WIDTH,
        y: Math.random() * ACTUAL_WORLD_HEIGHT
    };
}

function pickBotName(): string {
    const base = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    return `${base}`;
}

function createBot(io: SocketIOServer, world: World): ServerPlayer {
    const id = generateBotId();
    // Name-derived rng: bot level + full loadout are deterministic from the
    // name. Two bots that happen to roll the same name will have the same
    // build, which is the whole point — "a bot named X plays like X".
    const name = pickBotName();
    const rng = seededRng(hashString(name));
    const level = rollBotLevel(rng);
    const maxHealth = population().calculateMaxHealthFromLevel(level);
    const damage = population().calculateDamageFromLevel(level);
    const pos = pickBotSpawnPosition();

    const botGuildName = guilds().getBotGuildNameForBot(name) || undefined;
    const bot: ServerPlayer = {
        id,
        name,
        x: pos.x,
        y: pos.y,
        angle: 0,
        score: 0,
        velocityX: 0,
        velocityY: 0,
        health: maxHealth,
        maxHealth,
        damage,
        inventory: population().createInitialInventory(),
        loadout: buildBotLoadout(level, rng),
        isInvulnerable: true,
        level,
        xp: 0,
        xpToNextLevel: population().calculateXPRequirement(level),
        knockbackX: 0,
        knockbackY: 0,
        inputs: { keys: [], petalExtension: 1.0 },
        speed_boost: 1,
        isDead: false,
        skills: {},
        mobKills: {},
        stars: 0,
        guildName: botGuildName
    };

    players[id] = bot;
    // Give the bot its entity NOW rather than waiting for the movement window's
    // `syncPlayersToEcs`. `maintainBotCount` runs earlier in the same tick than
    // the input scheduler, so without this a bot spawned this tick would be
    // missing from the ECS roster for its first tick — which the roster's
    // consistency check would (correctly) report as C.IsBot having gone wrong.
    ensurePlayerEntity(world, bot, Date.now());
    botAIState.set(id, {
        wanderTargetX: bot.x,
        wanderTargetY: bot.y,
        nextWanderTime: 0
    });

    setTimeout(() => {
        if (players[id]) {
            players[id].isInvulnerable = false;
            io.emit('playerInvulnerabilityEnded', { playerId: id });
        }
    }, BOT_SPAWN_INVULNERABILITY_MS);

    io.emit('newPlayer', sanitizePublicPlayerForClient(bot));
    return bot;
}

function removeBot(id: string, io: SocketIOServer): void {
    if (!isBot(id)) return;
    if (!players[id]) return;
    // If bot was in a squad, remove it and notify remaining members.
    if (playerSquadMap.has(id)) {
        const squad = getSquadForPlayerFn(id);
        const botName = players[id].name;
        leaveSquadFn(id, io);
        if (squad) {
            const remaining = squad.memberIds;
            if (remaining.length > 0) {
                sendSquadSystemMessage(squad, io, `${botName} has left the squad.`);
                for (const memberId of remaining) {
                    if (memberId.startsWith('bot_')) continue;
                    io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                }
            }
        }
    }
    delete players[id];
    botAIState.delete(id);
    botPersona.delete(id);
    botSquadNextTick.delete(id);
    // Required LAZILY, and this is the only reason it is not a normal import.
    // petal_actions.ts imports './server' at module scope, and server.ts binds
    // port 3000 and opens the account database on require — so a top-level
    // import here means that merely REQUIRING botManager starts a second live
    // server on the port the real game is using, which is why nothing can drive
    // this file from a harness today.
    //
    // Deferring this edge does NOT fix that on its own, and it is worth being
    // precise about why rather than leaving a comment that overclaims: there is
    // a SECOND module-scope path, botManager -> server/playerManager ->
    // server/utils -> petal_actions -> server. Closing that one means deferring
    // `splitPlayers`/`syncSplitStars` inside server/utils.ts, which reorders
    // module initialisation inside a CIRCULAR graph (petal_actions and server.ts
    // already require each other), and the failure mode for getting that wrong
    // is a "Cannot access X before initialization" at boot that no gate here can
    // catch, because no gate may start a server. So that half is deliberately
    // left undone. This edge is closed because it is free — playerManager has
    // already pulled petal_actions into the cache long before this line, so the
    // require order is unchanged either way.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { cleanupPlayerPetalActionState } =
        require('../petal_actions') as typeof import('../petal_actions');
    cleanupPlayerPetalActionState(id);
    io.emit('playerDisconnected', id);
}

export function removeAllBots(io: SocketIOServer): void {
    const botIds = Object.keys(players).filter(isBot);
    for (const id of botIds) removeBot(id, io);
}

function countBots(): number {
    let count = 0;
    for (const id in players) if (isBot(id)) count++;
    return count;
}

function listBotIds(): string[] {
    return Object.keys(players).filter(isBot);
}

/**
 * Keep total player count near TARGET_TOTAL_PLAYERS by spawning/removing bots.
 * If there are no real (human) players, all bots are despawned to avoid wasted
 * simulation while nobody is watching.
 */
export function maintainBotCount(io: SocketIOServer, realPlayerCount: number, world: World): void {
    const now = Date.now();

    if (realPlayerCount > 0) {
        lastActivePlayerTime = now;
    } else {
        // Keep bots running for BOT_IDLE_TIMEOUT_MS after the last human leaves
        // so reconnecting quickly doesn't hit an empty world. Past the timeout,
        // despawn everything to avoid wasted simulation.
        if (now - lastActivePlayerTime >= BOT_IDLE_TIMEOUT_MS) {
            if (countBots() > 0) removeAllBots(io);
            return;
        }
    }

    if (now - lastMaintainTime < MAINTAIN_INTERVAL_MS) return;
    lastMaintainTime = now;

    const currentBots = countBots();
    // Drift the jitter by ±1 each tick so the population wanders slowly instead
    // of sitting at a fixed target. Bounded so it can't collapse the server.
    if (Math.random() < BOT_COUNT_JITTER_STEP_CHANCE) {
        botCountJitter += Math.random() < 0.5 ? -1 : 1;
        if (botCountJitter < BOT_COUNT_JITTER_MIN) botCountJitter = BOT_COUNT_JITTER_MIN;
        if (botCountJitter > BOT_COUNT_JITTER_MAX) botCountJitter = BOT_COUNT_JITTER_MAX;
    }
    const desiredBots = targetBotCountOverride !== null
        ? targetBotCountOverride
        : Math.max(0, TARGET_TOTAL_PLAYERS - realPlayerCount + botCountJitter);

    if (currentBots < desiredBots) {
        const deficit = desiredBots - currentBots;
        const toSpawn = Math.min(deficit, SPAWN_BURST_CAP);
        for (let i = 0; i < toSpawn; i++) createBot(io, world);
    } else if (currentBots > desiredBots) {
        const excess = currentBots - desiredBots;
        const ids = listBotIds().slice(0, excess);
        for (const id of ids) removeBot(id, io);
    }
}

function respawnBot(bot: ServerPlayer, io: SocketIOServer): void {
    const pos = pickBotSpawnPosition();
    bot.x = pos.x;
    bot.y = pos.y;
    bot.velocityX = 0;
    bot.velocityY = 0;
    bot.health = bot.maxHealth;
    bot.isDead = false;
    bot.isInvulnerable = true;
    bot.killedBy = undefined;
    // Same rule as a player respawn: the glitch infection doesn't survive it.
    // Without this every long-lived bot ends up permanently glitched.
    bot.glitched = undefined;

    // Refresh any broken petals so the bot is combat-ready
    if (bot.loadout) {
        for (let i = 0; i < bot.loadout.length; i++) {
            const p = bot.loadout[i];
            if (p && p.type === 'petal' && p.onCooldown && p.petalType && p.rarity) {
                const stats = getPetalStats(p.petalType, p.rarity);
                if (stats) {
                    bot.loadout[i] = {
                        type: 'petal',
                        rarity: p.rarity,
                        petalType: p.petalType,
                        health: stats.health,
                        maxHealth: stats.health,
                        onCooldown: false
                    };
                }
            }
        }
    }

    const state = botAIState.get(bot.id);
    if (state) {
        state.wanderTargetX = bot.x;
        state.wanderTargetY = bot.y;
        state.nextWanderTime = 0;
        state.respawnAt = undefined;
        // The bot reappears somewhere else entirely: everything derived from
        // where it used to be (target, path, heading, watchdog samples) is
        // stale, and a leftover unstick maneuver would drive it out of its
        // new spawn for no reason.
        state.targetId = undefined;
        state.targetAcquiredAt = undefined;
        state.pickupId = undefined;
        state.fleeing = false;
        state.fleeUntil = undefined;
        state.idleUntil = undefined;
        state.slotAngle = undefined;
        state.headX = undefined;
        state.headY = undefined;
        state.unstickUntil = undefined;
        state.suppressTargetUntil = undefined;
        state.pathNodes = undefined;
        state.pathIndex = undefined;
        state.pathGoalTileX = undefined;
        state.pathGoalTileY = undefined;
        state.pathCreatedAt = undefined;
        resetOscillationSampler(bot, state, Date.now());
        // Farming zone survives death — the bot goes back to where it farms.
    }

    io.emit('playerRespawned', bot);

    setTimeout(() => {
        if (players[bot.id]) {
            players[bot.id].isInvulnerable = false;
            io.emit('playerInvulnerabilityEnded', { playerId: bot.id });
        }
    }, BOT_SPAWN_INVULNERABILITY_MS);
}

function clampToWorld(v: number, margin: number, max: number): number {
    return Math.max(margin, Math.min(max - margin, v));
}

// The petal/movement maths a bot needs is DERIVED, not mirrored.
//
// These three used to be hand-copies of `calculatePlayerModifiers` and of the
// petal ring's orbit radius, living here because the real implementations were
// unreachable: `calculatePlayerModifiers` sat in playerManager.ts (which boots a
// server on require) and the orbit radius was inside the petal loop. Both now
// have callable homes, so these are thin adapters over the real thing — see
// server/bots/botReach.ts for what the copies were getting wrong and for the
// gate that keeps them pinned.
function getBotSpeedMod(bot: ServerPlayer): number {
    return botSpeedModifier(bot);
}

// Largest distance from bot center that a petal can still strike a target at,
// given petalExtension and this bot's equipped petals' size/range. The safety
// buffer is folded in here (and subtracted again by the standoff maths) exactly
// as it always was.
function computePetalReach(bot: ServerPlayer, petalExtension: number): number {
    return botPetalReach(bot, petalExtension, STANDOFF_SAFETY_BUFFER);
}

function getMobRadius(enemy: { type: string; tier: string }): number {
    const stats = getMobStats(enemy.type, enemy.tier);
    const size = stats?.size ?? 1.0;
    return (size * 40) / 2;
}

// Find any non-target mob sitting inside a forward cone of the bot's movement
// vector close enough that continuing without engaging would body-slam into
// it. Returns the closest such mob (with distance) or null. Used to override
// the bot's combat target when a non-target mob is in the path: the bot drops
// into normal combat bands against the obstacle for one tick, lets its petals
// hit it, then resumes pursuit of the original target next tick.
function findInterceptingMob(
    botX: number,
    botY: number,
    dirX: number,
    dirY: number,
    excludeId: string | null,
    range: number
): { enemy: Enemy; dist: number } | null {
    let best: Enemy | null = null;
    let bestDist = Infinity;
    // The acceptance test below is dist <= range + mobRadius — exactly the
    // "hitbox overlaps circle(range)" contract of the fat-inserted grid, so a
    // query at `range` returns a superset of every possible acceptance.
    const near = queryEnemiesNear(botX, botY, range, _botQueryScratch);
    for (let i = 0; i < near.length; i++) {
        const enemy = near[i];
        if (isMobDead(enemy.entity)) continue;
        if (enemy.id === excludeId) continue;
        if (enemy.type === 'target_dummy') continue;
        if (enemy.type === 'item_spawner') continue;
        const dx = mobX(enemy.entity) - botX;
        const dy = mobY(enemy.entity) - botY;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0) continue;
        const mobR = getMobRadius(enemy);
        const cutoff = range + mobR;
        if (d2 > cutoff * cutoff) continue;
        const d = Math.sqrt(d2);
        // Forward-cone test: > 0.3 ≈ a ~70° arc in front of the bot.
        const dot = (dx / d) * dirX + (dy / d) * dirY;
        if (dot < 0.3) continue;
        if (d < bestDist) {
            best = enemy;
            bestDist = d;
        }
    }
    return best ? { enemy: best, dist: bestDist } : null;
}

// --- Wall avoidance ---
// Cheap raycast against WALL_GRID. State 1 = wall, 2 = water — both block.
function rayHitsWall(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Guard a degenerate ray: a 0/NaN dist means no hit; a non-finite or huge dist
    // (e.g. raycasting toward an entity flung to an enormous coordinate) would make
    // `steps` blow up and spin this loop forever — bound it. 1024 half-tile samples
    // covers any legitimate on-screen ray; beyond that the target is bogus anyway.
    if (!(dist > 0) || !Number.isFinite(dist)) return false;
    // Sample every half-tile so we don't skip over a wall tile diagonally
    const step = WALL_TILE_SIZE / 2;
    const steps = Math.min(1024, Math.ceil(dist / step));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + dx * t;
        const y = y0 + dy * t;
        const s = getTileState(WALL_GRID, x, y);
        if (isTileIdBlocking(s)) return true;
    }
    return false;
}

// Steer around walls when moving long distance toward a target. Probes the
// requested direction, then progressively wider angle offsets, and returns
// the first clear one (or the original if everything is blocked).
const STEER_OFFSETS = [
    0,
    Math.PI / 6, -Math.PI / 6,
    Math.PI / 3, -Math.PI / 3,
    Math.PI / 2, -Math.PI / 2,
    (2 * Math.PI) / 3, -(2 * Math.PI) / 3
];
function steerAroundWalls(
    fromX: number,
    fromY: number,
    dirX: number,
    dirY: number,
    probeDistance: number = WALL_TILE_SIZE * 1.4
): { x: number; y: number } {
    for (const off of STEER_OFFSETS) {
        const c = Math.cos(off);
        const s = Math.sin(off);
        // Rotate (dirX, dirY) by `off`
        const dx = dirX * c - dirY * s;
        const dy = dirX * s + dirY * c;
        if (!rayHitsWall(fromX, fromY, fromX + dx * probeDistance, fromY + dy * probeDistance)) {
            return { x: dx, y: dy };
        }
    }
    return { x: dirX, y: dirY };
}

// --- A* pathfinding on the WALL_GRID ---
//
// Used for raid and group-mode long-distance navigation around wall clusters.
// Simple steering handles a single wall fine but fails on concavities; A*
// gives proper path-around behavior.
//
// Cost model: 8-connected, orthogonal=1 / diagonal=√2, octile heuristic.
// Corner cutting is disallowed (diagonal requires both orthogonal neighbors
// clear). Goal tile snaps to nearest walkable if blocked.
//
// Cost per call is capped by PATH_MAX_NODES. A per-tick budget
// (PATH_MAX_PER_TICK) limits how many bots can recompute simultaneously so
// a whole raid recomputing together can't spike the frame.

const PATH_MAX_NODES = 4000;
const PATH_MAX_PER_TICK = 2;
const PATH_WAYPOINT_REACHED_DIST = WALL_TILE_SIZE * 0.55;   // ~165 px
const PATH_STALE_MS = 5000;
const PATH_GOAL_INVALIDATE_TILES = 2;
// A bot may not re-run A* more often than this even if its goal keeps moving
// (chasing a moving boss): it keeps following the slightly-stale path and lets
// local steering close the gap. Profiling showed A* + its heap at ~10% of all
// server CPU because raiding bots invalidated their paths every couple ticks.
const PATH_MIN_REPATH_MS = 1500;
// Full greedy-LOS waypoint smoothing runs at most this often per bot; between
// passes a single ray re-validates the current waypoint (see followPath).
const PATH_SMOOTH_INTERVAL_MS = 200;

let pathBudgetThisTick = PATH_MAX_PER_TICK;

const A_STAR_NEIGHBORS: Array<[number, number, number]> = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
];

function tileBlocked(tx: number, ty: number): boolean {
    if (ty < 0 || tx < 0) return true;
    if (ty >= WALL_GRID.length) return true;
    const row = WALL_GRID[ty];
    if (!row || tx >= row.length) return true;
    const s = row[tx];
    return isTileIdBlocking(s);
}

function octileHeuristic(ax: number, ay: number, bx: number, by: number): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function tileCenter(tx: number, ty: number): Waypoint {
    return {
        x: tx * WALL_TILE_SIZE + WALL_TILE_SIZE / 2,
        y: ty * WALL_TILE_SIZE + WALL_TILE_SIZE / 2
    };
}

/**
 * Min-heap keyed by `f`, in parallel typed arrays.
 *
 * Was an array of `{f, tx, ty}` object literals. A* pushes once per improved
 * neighbour — up to eight per expansion, so a 4000-node search allocated on the
 * order of 32,000 short-lived objects, and the pop path chased three pointers
 * per comparison. Profiling put heapPop+heapPush at ~13% of all bot CPU and the
 * whole A* at ~23% of the server.
 *
 * The arrays are module-scope and reused across calls (A* is single-threaded
 * and non-reentrant), and they GROW rather than being capped, so search
 * behaviour is unchanged — a cap would silently drop nodes and change paths.
 *
 * Comparisons are `<` and `<=` exactly where the object version had them: the
 * sift order decides which of two equal-`f` nodes is expanded first, and that
 * decides which of several equal-length paths is returned.
 */
let heapF = new Float64Array(1024);
let heapTx = new Int32Array(1024);
let heapTy = new Int32Array(1024);
let heapSize = 0;

function heapGrow(): void {
    const bigF = new Float64Array(heapF.length * 2);
    bigF.set(heapF); heapF = bigF;
    const bigX = new Int32Array(heapTx.length * 2);
    bigX.set(heapTx); heapTx = bigX;
    const bigY = new Int32Array(heapTy.length * 2);
    bigY.set(heapTy); heapTy = bigY;
}

function heapPush(f: number, tx: number, ty: number): void {
    if (heapSize === heapF.length) heapGrow();
    let i = heapSize++;
    heapF[i] = f; heapTx[i] = tx; heapTy[i] = ty;
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= heapF[i]) break;
        const tf = heapF[p]; heapF[p] = heapF[i]; heapF[i] = tf;
        const tx2 = heapTx[p]; heapTx[p] = heapTx[i]; heapTx[i] = tx2;
        const ty2 = heapTy[p]; heapTy[p] = heapTy[i]; heapTy[i] = ty2;
        i = p;
    }
}

/** Pops into these three, so the caller needs no object either. */
let popF = 0, popTx = 0, popTy = 0;

function heapPop(): boolean {
    if (heapSize === 0) return false;
    popF = heapF[0]; popTx = heapTx[0]; popTy = heapTy[0];
    heapSize--;
    if (heapSize === 0) return true;
    heapF[0] = heapF[heapSize]; heapTx[0] = heapTx[heapSize]; heapTy[0] = heapTy[heapSize];
    let i = 0;
    const n = heapSize;
    while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let sm = i;
        if (l < n && heapF[l] < heapF[sm]) sm = l;
        if (r < n && heapF[r] < heapF[sm]) sm = r;
        if (sm === i) break;
        const tf = heapF[i]; heapF[i] = heapF[sm]; heapF[sm] = tf;
        const tx2 = heapTx[i]; heapTx[i] = heapTx[sm]; heapTx[sm] = tx2;
        const ty2 = heapTy[i]; heapTy[i] = heapTy[sm]; heapTy[sm] = ty2;
        i = sm;
    }
    return true;
}

/**
 * Per-tile search scratch, replacing two `Map<number, number>`.
 *
 * The maps were rebuilt every call and hashed on every read and write — eight
 * `get` plus up to eight `set` per expansion, ~32,000 hash operations for a
 * full 4000-node search, which is what made findPathAStar itself the single
 * hottest function on the server.
 *
 * Flat arrays indexed by tile can't be cleared per call (40,000 entries), so
 * `searchStamp` marks which entries belong to the CURRENT search: a tile counts
 * as unvisited unless its stamp matches. That is the exact equivalent of
 * `map.get(idx) === undefined`, without the clear and without the hashing.
 */
let searchGScore = new Float64Array(0);
let searchCameFrom = new Int32Array(0);
let searchStamp = new Uint32Array(0);
let searchStampValue = 0;
let searchCells = 0;

function ensureSearchScratch(cells: number): void {
    if (searchCells === cells) return;
    searchGScore = new Float64Array(cells);
    searchCameFrom = new Int32Array(cells);
    searchStamp = new Uint32Array(cells);
    searchStampValue = 0;
    searchCells = cells;
}

function beginSearch(): void {
    searchStampValue++;
    // Uint32 wrap: every stamp would suddenly "match" stale entries, so clear
    // once in the ~4-billionth search rather than compare against a live set.
    if (searchStampValue === 0xFFFFFFFF) {
        searchStamp.fill(0);
        searchStampValue = 1;
    }
}

// Snap a blocked goal tile to the nearest walkable tile within `maxR` rings.
function snapGoalToWalkable(gx: number, gy: number, maxR: number = 4): { gx: number; gy: number } | null {
    if (!tileBlocked(gx, gy)) return { gx, gy };
    for (let r = 1; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                // Only visit the shell at radius `r`
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                if (!tileBlocked(gx + dx, gy + dy)) {
                    return { gx: gx + dx, gy: gy + dy };
                }
            }
        }
    }
    return null;
}

/**
 * Exported as a TEST SEAM, not as API: scripts/astar-equivalence.js drives it
 * against a pre-optimisation build to prove the two return identical paths.
 * Nothing outside this module should call it.
 */
export function findPathAStar(startX: number, startY: number, goalX: number, goalY: number): Waypoint[] | null {
    const gridW = (WALL_GRID[0]?.length ?? 0);
    if (gridW === 0 || WALL_GRID.length === 0) return null;

    const sx = worldToTileX(startX);
    const sy = worldToTileY(startY);
    let gx = worldToTileX(goalX);
    let gy = worldToTileY(goalY);

    const snapped = snapGoalToWalkable(gx, gy);
    if (!snapped) return null;
    gx = snapped.gx; gy = snapped.gy;

    if (sx === gx && sy === gy) return [];

    ensureSearchScratch(gridW * WALL_GRID.length);
    beginSearch();
    const stamp = searchStampValue;
    const startIdx = sy * gridW + sx;

    searchGScore[startIdx] = 0;
    searchCameFrom[startIdx] = -1;
    searchStamp[startIdx] = stamp;

    heapSize = 0;
    heapPush(octileHeuristic(sx, sy, gx, gy), sx, sy);

    let expanded = 0;
    while (heapSize > 0 && expanded < PATH_MAX_NODES) {
        heapPop();
        const curF = popF, curTx = popTx, curTy = popTy;

        if (curTx === gx && curTy === gy) {
            // Reconstruct from goal back to start (exclusive)
            const path: Waypoint[] = [];
            let idx = curTy * gridW + curTx;
            while (idx !== startIdx) {
                const tx = idx % gridW;
                const ty = (idx - tx) / gridW;
                path.unshift(tileCenter(tx, ty));
                // Stamp gate is the equivalent of the old `cameFrom.get(idx)`
                // returning undefined: an entry from an earlier search is not
                // ours to follow.
                if (searchStamp[idx] !== stamp) break;
                const prev = searchCameFrom[idx];
                if (prev < 0) break;
                idx = prev;
            }
            return path;
        }
        expanded++;
        const curIdx = curTy * gridW + curTx;
        // Skip stale heap entries (node was re-pushed with lower f)
        if (searchStamp[curIdx] !== stamp) continue;
        const curG = searchGScore[curIdx];
        // Heuristic admissible, so if we already popped this node via a lower f we can skip now
        if (curF > curG + octileHeuristic(curTx, curTy, gx, gy) + 1e-9) continue;

        for (let n = 0; n < A_STAR_NEIGHBORS.length; n++) {
            const dx = A_STAR_NEIGHBORS[n][0];
            const dy = A_STAR_NEIGHBORS[n][1];
            const stepCost = A_STAR_NEIGHBORS[n][2];
            const nx = curTx + dx;
            const ny = curTy + dy;
            if (tileBlocked(nx, ny)) continue;
            // Disallow corner cutting: both orthogonals must be clear for diagonals
            if (dx !== 0 && dy !== 0) {
                if (tileBlocked(curTx + dx, curTy)) continue;
                if (tileBlocked(curTx, curTy + dy)) continue;
            }
            const tentativeG = curG + stepCost;
            const nIdx = ny * gridW + nx;
            const seen = searchStamp[nIdx] === stamp;
            if (!seen || tentativeG < searchGScore[nIdx]) {
                searchStamp[nIdx] = stamp;
                searchGScore[nIdx] = tentativeG;
                searchCameFrom[nIdx] = curIdx;
                heapPush(tentativeG + octileHeuristic(nx, ny, gx, gy), nx, ny);
            }
        }
    }

    return null;
}

/**
 * Follow (and lazily compute) an A* path toward (goalX, goalY). Writes into
 * bot.inputs when a path is being followed. Returns true if the bot is
 * actively moving along a path this tick; false when path isn't available or
 * is finished, so the caller can fall back to simple steering.
 */
function followPath(
    bot: ServerPlayer,
    state: BotAIState,
    now: number,
    goalX: number,
    goalY: number,
    speedMult: number,
    petalExt: number
): boolean {
    const goalTx = worldToTileX(goalX);
    const goalTy = worldToTileY(goalY);

    const pathExhausted = !!state.pathNodes
        && state.pathIndex !== undefined
        && state.pathIndex >= state.pathNodes.length;

    const goalMoved = state.pathGoalTileX === undefined
        || Math.abs(state.pathGoalTileX - goalTx) > PATH_GOAL_INVALIDATE_TILES
        || Math.abs((state.pathGoalTileY as number) - goalTy) > PATH_GOAL_INVALIDATE_TILES;

    let stale = !state.pathNodes
        || !state.pathCreatedAt
        || now - state.pathCreatedAt > PATH_STALE_MS
        || pathExhausted
        || goalMoved;

    // Goal-moved / staleness may not force a recompute more often than
    // PATH_MIN_REPATH_MS — keep following the existing path meanwhile.
    // A bot with NO usable path (first call or exhausted) is exempt: without
    // a path it cannot move at all, so it must be allowed to compute one.
    const hasUsablePath = !!state.pathNodes && !pathExhausted && state.pathNodes.length > 0;
    if (stale && hasUsablePath && state.lastRepathAt !== undefined
        && now - state.lastRepathAt < PATH_MIN_REPATH_MS) {
        stale = false;
    }

    if (stale) {
        if (pathBudgetThisTick <= 0) return false;
        pathBudgetThisTick--;
        state.lastRepathAt = now;
        const path = findPathAStar(bot.x, bot.y, goalX, goalY);
        if (!path || path.length === 0) {
            // Cache an empty path so we don't burn the budget every tick when
            // blocked — retry after PATH_STALE_MS.
            state.pathNodes = [];
            state.pathIndex = 0;
            state.pathGoalTileX = goalTx;
            state.pathGoalTileY = goalTy;
            state.pathCreatedAt = now;
            return false;
        }
        state.pathNodes = path;
        state.pathIndex = 0;
        state.pathGoalTileX = goalTx;
        state.pathGoalTileY = goalTy;
        state.pathCreatedAt = now;
    }

    // Skip over waypoints we've already reached (handles overshoot from movement smoothing)
    const reachedSq = PATH_WAYPOINT_REACHED_DIST * PATH_WAYPOINT_REACHED_DIST;
    while (state.pathIndex! < state.pathNodes!.length) {
        const wp = state.pathNodes![state.pathIndex!];
        const dx = wp.x - bot.x;
        const dy = wp.y - bot.y;
        if (dx * dx + dy * dy < reachedSq) {
            state.pathIndex!++;
        } else {
            break;
        }
    }

    if (state.pathIndex! >= state.pathNodes!.length) return false;

    // Greedy LOS smoothing: skip ahead to the farthest waypoint with clear
    // line of sight. Without this, bots steer tile-center to tile-center,
    // producing a visible zigzag that turns into fast left-right snapping
    // under powder's 2×+ speed boost.
    //
    // The full multi-ray pass only runs every PATH_SMOOTH_INTERVAL_MS; between
    // passes one ray re-validates the current waypoint and, if the bot slid
    // behind a corner, the full pass runs immediately. Cuts steady-state path
    // following from N rays/bot/tick to 1.
    const needFullSmooth = state.lastSmoothAt === undefined
        || now - state.lastSmoothAt >= PATH_SMOOTH_INTERVAL_MS
        || rayHitsWall(bot.x, bot.y, state.pathNodes![state.pathIndex!].x, state.pathNodes![state.pathIndex!].y);
    if (needFullSmooth) {
        state.lastSmoothAt = now;
        while (state.pathIndex! + 1 < state.pathNodes!.length) {
            const next = state.pathNodes![state.pathIndex! + 1];
            if (rayHitsWall(bot.x, bot.y, next.x, next.y)) break;
            state.pathIndex!++;
        }
    }

    const wp = state.pathNodes![state.pathIndex!];
    const dx = wp.x - bot.x;
    const dy = wp.y - bot.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    driveMove(bot, dx / d, dy / d, speedMult, petalExt);
    return true;
}

// Per-bot strafe direction (+1 or -1). Held for several seconds at a time so
// the bot commits to a circling direction instead of oscillating, then flipped
// on a slow randomized timer so orbits don't read as a fixed animation loop.
const STRAFE_FLIP_MIN_MS = 3500;
const STRAFE_FLIP_MAX_MS = 9000;
function nextStrafeFlip(now: number): number {
    return now + STRAFE_FLIP_MIN_MS + Math.random() * (STRAFE_FLIP_MAX_MS - STRAFE_FLIP_MIN_MS);
}
function tangentDirection(botId: string, state: BotAIState, now: number): number {
    if (state.strafeDir === undefined) {
        // Simple hash: sum of char codes, parity picks the initial direction
        let h = 0;
        for (let i = 0; i < botId.length; i++) h = (h + botId.charCodeAt(i)) | 0;
        state.strafeDir = (h & 1) === 0 ? 1 : -1;
        state.strafeFlipAt = nextStrafeFlip(now);
    } else if (now >= (state.strafeFlipAt ?? 0)) {
        state.strafeDir = -state.strafeDir;
        state.strafeFlipAt = nextStrafeFlip(now);
    }
    return state.strafeDir;
}

type Anchor = { x: number; y: number } | null;

function withinAnchor(anchor: Anchor, x: number, y: number, radius: number): boolean {
    if (!anchor) return true;
    const dx = anchor.x - x;
    const dy = anchor.y - y;
    return dx * dx + dy * dy <= radius * radius;
}

// Distance advantage (px) a rival mob must beat before a bot abandons the
// target it is already committed to. Without it, two mobs of the same tier at
// near-equal distance swap the "best" slot every tick and the bot walks back
// and forth between them, never reaching either.
const TARGET_STICKINESS = 320;
// Same idea for ground loot, but smaller: drops don't move, so the only thing
// being damped is the bot's own position wobble flipping which one is nearest.
const PICKUP_STICKINESS = 140;

function pickBestEnemyTarget(
    bot: ServerPlayer,
    anchor: Anchor,
    tetherRadius: number,
    preferredTiers: Set<string>,
    stickyId?: string,
    stickiness: number = TARGET_STICKINESS
): { enemy: Enemy; dist: number } | null {
    // Score = priority * 10000 - distance, so bosses within their aggro range
    // beat every regular mob and the closer target wins among same tier.
    // Preferred-tier (matches bot's rarity progression) gets a +0.5 priority
    // bump so it beats same-tier-class unpreferred mobs, but never bosses.
    // The bot's existing target gets a flat score bonus on top (see
    // TARGET_STICKINESS) so ties resolve in favour of staying committed.
    let best: Enemy | null = null;
    let bestScore = -Infinity;
    let bestDist = 0;

    // Non-boss candidates can only pass the range gate below within
    // HIGH_TIER_AGGRO_RANGE (the largest non-boss aggro range), so a grid
    // query at that radius sees every possible winner. Bosses have a much
    // wider range (BOSS_RAID_RANGE) and skip the tether — they come from the
    // per-tick bossIndex instead of the grid. Same selection as the old full
    // scan, without iterating all ~1400 enemies per bot.
    const near = queryEnemiesNear(bot.x, bot.y, HIGH_TIER_AGGRO_RANGE, _botQueryScratch);
    const scoreEnemy = (enemy: Enemy) => {
        if (isMobDead(enemy.entity)) return;
        if (enemy.type === 'item_spawner') return;
        if (enemy.type === 'target_dummy') return;

        const isBoss = BOSS_TIERS.has(enemy.tier);

        // Tether applies to everything except bosses — bosses are raids and
        // bots are allowed to crowd up from across the map to fight them.
        if (!isBoss && !withinAnchor(anchor, mobX(enemy.entity), mobY(enemy.entity), tetherRadius)) return;

        const range = aggroRangeForTier(enemy.tier);
        const dx = mobX(enemy.entity) - bot.x;
        const dy = mobY(enemy.entity) - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > range) return;

        const priority = tierPriority(enemy.tier);
        const prefBonus = preferredTiers.has(enemy.tier) ? 0.5 : 0;
        const stickyBonus = (stickyId !== undefined && enemy.id === stickyId) ? stickiness : 0;
        const score = (priority + prefBonus) * 10000 - d + stickyBonus;
        if (score > bestScore) {
            bestScore = score;
            best = enemy;
            bestDist = d;
        }
    };
    for (let i = 0; i < near.length; i++) {
        const enemy = near[i];
        if (BOSS_TIERS.has(enemy.tier)) continue; // scored from bossIndex below
        scoreEnemy(enemy);
    }
    for (const boss of bossIndex) scoreEnemy(boss);

    return best ? { enemy: best, dist: bestDist } : null;
}

/**
 * Picks the boss a raiding bot should converge on: the most recently spawned
 * mob in `pool`, breaking ties towards whichever is closest to a human player.
 *
 * Both boss-raid target pickers ran this identical scan; the tie-break matters,
 * so it is one function rather than two copies that could drift.
 * `pool` must be non-empty.
 */
function newestClosestBoss(pool: Enemy[]): Enemy {
    let best = pool[0];
    let bestSpawn = mobSpawnTime(best.entity) ?? 0;
    let bestDistSq = distSqToNearestHumanPlayer(mobX(best.entity), mobY(best.entity));
    for (let i = 1; i < pool.length; i++) {
        const enemy = pool[i];
        const spawn = mobSpawnTime(enemy.entity) ?? 0;
        if (spawn > bestSpawn) {
            best = enemy;
            bestSpawn = spawn;
            bestDistSq = distSqToNearestHumanPlayer(mobX(enemy.entity), mobY(enemy.entity));
        } else if (spawn === bestSpawn) {
            const distSq = distSqToNearestHumanPlayer(mobX(enemy.entity), mobY(enemy.entity));
            if (distSq < bestDistSq) {
                best = enemy;
                bestDistSq = distSq;
            }
        }
    }
    return best;
}

/** Reused payload buffer for the pickup scan; see collectWorldItems. */
const _botItemScratch: WorldItem[] = [];

function findPickupTarget(
    bot: ServerPlayer,
    anchor: Anchor,
    tetherRadius: number,
    stickyId?: string
): { item: WorldItem; dist: number } | null {
    let best: WorldItem | null = null;
    // Effective distance of the current pick; the item the bot is already
    // walking to competes with a discount so two drops at similar range don't
    // trade places every tick and leave the bot shuffling between them.
    let bestDist = ITEM_SEEK_RANGE;
    let bestRealDist = ITEM_SEEK_RANGE;

    for (const item of collectWorldItems(_botItemScratch)) {
        if (item.pickedUpBy && item.pickedUpBy.has(bot.id)) continue;
        // Only chase items this bot is actually eligible for (it was a damage contributor)
        if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
            if (!item.eligiblePlayers.includes(bot.id)) continue;
        }
        // Don't chase drops that would drag the bot outside the cluster
        if (!withinAnchor(anchor, item.x, item.y, tetherRadius)) continue;
        const dx = item.x - bot.x;
        const dy = item.y - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const scored = (stickyId !== undefined && item.id === stickyId) ? d - PICKUP_STICKINESS : d;
        if (scored < bestDist) {
            bestDist = scored;
            bestRealDist = d;
            best = item;
        }
    }

    return best ? { item: best, dist: bestRealDist } : null;
}

// --- Mode detection ---

// Squared distance from a point to the nearest non-bot, non-dead player.
// Returns Infinity when no human player is connected — in that case the
// recency comparison alone decides the raid target.
function distSqToNearestHumanPlayer(x: number, y: number): number {
    let best = Infinity;
    for (const id in players) {
        if (isBot(id)) continue;
        const p = players[id];
        if (!p || (p as any).isDead) continue;
        const dx = p.x - x;
        const dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
    }
    return best;
}

// Prefer uniques strictly; only consider supers if no uniques exist anywhere.
// Within the chosen tier, pick the most recently spawned boss, with proximity
// to the nearest human player as a tiebreaker. This makes bots commit to
// freshly-spawned bosses bothering humans rather than chasing whatever stale
// boss happens to come first in the enemies array.
function pickRaidTargetGlobal(): { x: number; y: number; tier: string } | null {
    let pool: Enemy[] = [];
    let preferUnique = false;
    for (const enemy of liveEnemies()) {
        if (enemy.ownerId) continue;
        if ((enemy as any).isDead) continue;
        if (enemy.type === 'target_dummy') continue;
        if (enemy.tier === 'unique') {
            if (!preferUnique) { pool = []; preferUnique = true; }
            pool.push(enemy);
        } else if (enemy.tier === 'super' && !preferUnique) {
            pool.push(enemy);
        }
    }
    if (pool.length === 0) return null;

    const best = newestClosestBoss(pool);
    return { x: mobX(best.entity), y: mobY(best.entity), tier: best.tier };
}

/**
 * Force all bots into raid mode on the best available target (unique > super,
 * never ultra). No-op if no super/unique bosses exist. Returns the target info
 * if a raid was triggered, null otherwise. Called from the chat handler when
 * someone says "super" or "unique".
 */
export function triggerBotRaid(): { x: number; y: number; tier: string } | null {
    const target = pickRaidTargetGlobal();
    if (!target) {
        forcedRaid = null;
        return null;
    }
    forcedRaid = {
        x: target.x,
        y: target.y,
        tier: target.tier,
        until: Date.now() + FORCED_RAID_DURATION_MS
    };
    // Invalidate every bot's cached path so they replan toward the raid target.
    for (const s of botAIState.values()) {
        s.pathNodes = undefined;
        s.pathIndex = undefined;
        s.pathGoalTileX = undefined;
        s.pathGoalTileY = undefined;
        s.pathCreatedAt = undefined;
    }
    return target;
}

// Returns the forced-raid rally point if it's still active AND the target
// boss tier still exists in the world; otherwise clears the forced state.
function getActiveForcedRaidAnchor(): { x: number; y: number } | null {
    if (!forcedRaid) return null;
    if (Date.now() > forcedRaid.until) {
        forcedRaid = null;
        return null;
    }
    // Refresh the rally point to the nearest live boss of the preferred tier
    // so bots home in on a live target rather than a stale position.
    const refreshed = pickRaidTargetGlobal();
    if (!refreshed) {
        forcedRaid = null;
        return null;
    }
    forcedRaid.x = refreshed.x;
    forcedRaid.y = refreshed.y;
    forcedRaid.tier = refreshed.tier;
    return { x: forcedRaid.x, y: forcedRaid.y };
}

// Scan for new super/unique bosses and have the nearest live bot shout them
// out in chat. Emitting through io.emit (not the socket handler) means we
// bypass the built-in chat-triggered raid — so we also call triggerBotRaid()
// directly. Rate-limited globally to avoid spam when multiple bosses spawn
// at once.
function announceNewBosses(io: SocketIOServer, now: number): void {
    // First pass: silently absorb any bosses that were already alive when the
    // bot manager spun up (or that existed before this guard was in place).
    // Prevents a burst of "super X come!" chatter the instant supers spawn.
    if (!bossAnnounceInitialized) {
        for (const enemy of liveEnemies()) {
            if (enemy.ownerId) continue;
            if ((enemy as any).isDead) continue;
            if (!BOSS_TIERS.has(enemy.tier)) continue;
            if (enemy.type === 'target_dummy') continue;
            announcedBosses.add(enemy.id);
        }
        bossAnnounceInitialized = true;
        // Require a full cooldown before the very first real announcement too.
        nextBossAnnounceAllowedAt = now + BOSS_ANNOUNCE_COOLDOWN_MIN_MS +
            Math.random() * (BOSS_ANNOUNCE_COOLDOWN_MAX_MS - BOSS_ANNOUNCE_COOLDOWN_MIN_MS);
    }

    if (now < nextBossAnnounceAllowedAt) return;

    for (const enemy of liveEnemies()) {
        if (enemy.ownerId) continue;
        if ((enemy as any).isDead) continue;
        if (!BOSS_TIERS.has(enemy.tier)) continue;
        if (enemy.type === 'target_dummy') continue;
        if (announcedBosses.has(enemy.id)) continue;

        let announcerId: string | null = null;
        let bestD = Infinity;
        for (let i = 0; i < botRoster.length; i++) {
            const b = botRoster[i];
            if (b.isDead) continue;
            const dx = b.x - mobX(enemy.entity);
            const dy = b.y - mobY(enemy.entity);
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; announcerId = b.id; }
        }
        if (!announcerId) return;

        const bot = players[announcerId];
        const tierWord = enemy.tier === 'unique' ? 'unique' : 'super';
        const fullPool = tierWord === 'unique' ? BOSS_SHOUT_TEMPLATES_UNIQUE : BOSS_SHOUT_TEMPLATES_SUPER;
        // {code} templates only make sense when the bot is in a squad.
        const squadId = bot.squadId;
        const pool = squadId ? fullPool : fullPool.filter(t => !t.includes('{code}'));
        let shout = pool[Math.floor(Math.random() * pool.length)]
            .replace('{tier}', tierWord)
            .replace('{mob}', enemy.type.replace(/_/g, ' '));
        if (squadId) shout = shout.replace('{code}', squadId);
        io.emit('chatMessage', {
            sender: bot.name,
            content: `[<span style="color: yellow;">${bot.name}</span>] ${shout}`,
            timestamp: now
        });
        announcedBosses.add(enemy.id);
        nextBossAnnounceAllowedAt = now + BOSS_ANNOUNCE_COOLDOWN_MIN_MS +
            Math.random() * (BOSS_ANNOUNCE_COOLDOWN_MAX_MS - BOSS_ANNOUNCE_COOLDOWN_MIN_MS);
        // Rally every bot — the chat handler's regex trigger won't fire for
        // messages we emit directly, so invoke it explicitly.
        triggerBotRaid();
        return; // One announcement per tick batch
    }

    // GC: drop ids of bosses that no longer exist so the set doesn't grow.
    if (announcedBosses.size > 32) {
        const live = new Set<string>();
        for (const e of liveEnemies()) {
            if (BOSS_TIERS.has(e.tier) && !(e as any).isDead) live.add(e.id);
        }
        for (const id of announcedBosses) {
            if (!live.has(id)) announcedBosses.delete(id);
        }
    }
}

function findNearestBossForBot(bot: ServerPlayer): { x: number; y: number; dist: number } | null {
    // Per-bot raid pick: only consider bosses within BOSS_RAID_RANGE of THIS
    // bot. Without the range gate, every bot in the world enters raid mode for
    // any boss anywhere — they then equip powder, blitz across the map, and
    // ram every mob in their path because powder mode skips the standoff
    // bands. Among in-range bosses, prefer uniques over supers, then most
    // recently spawned, then proximity to the nearest human player.
    let pool: Enemy[] = [];
    let preferUnique = false;
    for (const enemy of bossIndex) {
        if (isMobDead(enemy.entity)) continue; // may have died since the index was built this tick
        const dx = mobX(enemy.entity) - bot.x;
        const dy = mobY(enemy.entity) - bot.y;
        if (dx * dx + dy * dy > BOSS_RAID_RANGE * BOSS_RAID_RANGE) continue;
        if (enemy.tier === 'unique') {
            if (!preferUnique) { pool = []; preferUnique = true; }
            pool.push(enemy);
        } else if (enemy.tier === 'super' && !preferUnique) {
            pool.push(enemy);
        }
    }
    if (pool.length === 0) return null;

    const best = newestClosestBoss(pool);
    const dx = mobX(best.entity) - bot.x;
    const dy = mobY(best.entity) - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return { x: mobX(best.entity), y: mobY(best.entity), dist };
}

function hasHighRarityMobNearby(bot: ServerPlayer, range: number): boolean {
    const rSq = range * range;
    // Grid broad-phase (pets and rebuild-time dead mobs are already excluded).
    const near = queryEnemiesNear(bot.x, bot.y, range, _botQueryScratch);
    for (let i = 0; i < near.length; i++) {
        const enemy = near[i];
        if (isMobDead(enemy.entity)) continue;
        if (!HIGH_TIERS.has(enemy.tier)) continue;
        const dx = mobX(enemy.entity) - bot.x;
        const dy = mobY(enemy.entity) - bot.y;
        if (dx * dx + dy * dy <= rSq) return true;
    }
    return false;
}

// Assign each raiding bot a fixed angular slot around its raid anchor so
// bots spread evenly around the boss rather than clumping on one side.
// Recomputed each tick — if N raiders share an anchor, slot i gets angle
// (i / N) * 2π. Stable sort by id so slots don't shuffle tick to tick.
function computeRaidSlots(): Map<string, number> {
    const byAnchor = new Map<string, { ids: string[] }>();
    const forced = getActiveForcedRaidAnchor();

    for (let i = 0; i < botRoster.length; i++) {
        const b = botRoster[i];
        if (b.isDead) continue;
        const id = b.id;

        let anchor: { x: number; y: number } | null = null;
        if (forced) {
            anchor = forced;
        } else {
            const boss = findNearestBossForBot(b);
            if (boss) anchor = { x: boss.x, y: boss.y };
        }
        if (!anchor) continue;

        // Round anchor coords so bots raiding the same boss share a bucket
        // even as the boss drifts by a pixel or two.
        const key = `${Math.round(anchor.x / 8)}:${Math.round(anchor.y / 8)}`;
        let bucket = byAnchor.get(key);
        if (!bucket) {
            bucket = { ids: [] };
            byAnchor.set(key, bucket);
        }
        bucket.ids.push(id);
    }

    const slots = new Map<string, number>();
    for (const { ids } of byAnchor.values()) {
        ids.sort();
        const n = ids.length;
        for (let i = 0; i < n; i++) {
            slots.set(ids[i], (i / n) * Math.PI * 2);
        }
    }
    return slots;
}

// Deterministic bot grouping for high-rarity mode. Recomputed each tick so
// centroids follow the group as it moves.
interface GroupInfo { center: { x: number; y: number }; size: number }
function computeBotGroups(): Map<string, GroupInfo> {
    const botIds: string[] = [];
    for (let i = 0; i < botRoster.length; i++) {
        const b = botRoster[i];
        if (b.isDead) continue;
        botIds.push(b.id);
    }
    if (botIds.length === 0) return new Map();
    botIds.sort();  // stable assignment across ticks

    const numGroups = Math.max(1, Math.ceil(botIds.length / GROUP_TARGET_SIZE));
    const buckets: string[][] = Array.from({ length: numGroups }, () => []);
    // Round-robin so groups stay balanced (4-10 members each) when counts shift.
    for (let i = 0; i < botIds.length; i++) {
        buckets[i % numGroups].push(botIds[i]);
    }

    const result = new Map<string, GroupInfo>();
    for (const bucket of buckets) {
        if (bucket.length === 0) continue;
        let cx = 0, cy = 0;
        for (const id of bucket) {
            const p = players[id];
            cx += p.x;
            cy += p.y;
        }
        cx /= bucket.length;
        cy /= bucket.length;
        const info: GroupInfo = { center: { x: cx, y: cy }, size: bucket.length };
        for (const id of bucket) result.set(id, info);
    }
    return result;
}

type BotMode = 'raid' | 'highRarity' | 'normal';
interface ModeContext {
    kind: BotMode;
    anchor: Anchor;
    tetherRadius: number;
    returnRadius: number;
}

// How long highRarity mode survives past the last positive scan, and how long
// a bot farms one zone before rotating to another.
const HIGH_RARITY_LINGER_MS = 4000;
const FARM_ZONE_MIN_MS = 90_000;
const FARM_ZONE_MAX_MS = 240_000;
// Once the bot is this close to its farm zone the timer starts mattering —
// a bot still walking across the map shouldn't rotate to a new zone mid-trip.
const FARM_ZONE_ARRIVED_DIST = 1200;

function computeBotMode(
    bot: ServerPlayer,
    groups: Map<string, GroupInfo>,
    state: BotAIState,
    now: number
): ModeContext {
    // Forced raid (chat-triggered): every bot rallies on the target regardless
    // of distance or whether any human is in that biome. Without this, bots
    // stay tethered to the nearest human and never cross into an empty biome
    // to engage a super/unique that spawned there.
    const forced = getActiveForcedRaidAnchor();
    if (forced) {
        return {
            kind: 'raid',
            anchor: forced,
            tetherRadius: RAID_CLUSTER_RADIUS,
            returnRadius: RAID_CLUSTER_RETURN
        };
    }

    // Raid: any boss within BOSS_RAID_RANGE. Rally on the boss position,
    // clump tight enough to share ~90% viewport.
    const boss = findNearestBossForBot(bot);
    if (boss) {
        return {
            kind: 'raid',
            anchor: { x: boss.x, y: boss.y },
            tetherRadius: RAID_CLUSTER_RADIUS,
            returnRadius: RAID_CLUSTER_RETURN
        };
    }

    // High rarity: legendary+ mob nearby AND this bot's group has enough
    // members to justify grouping. Rally on the group centroid.
    // The scan result is latched for HIGH_RARITY_LINGER_MS: a mob wandering
    // across the scan boundary would otherwise flip the anchor between the
    // group centroid and the (far away) farm zone on alternating ticks, and
    // the bot would visibly stutter between the two.
    if (hasHighRarityMobNearby(bot, HIGH_RARITY_SCAN_RANGE)) {
        state.highRarityUntil = now + HIGH_RARITY_LINGER_MS;
    }
    if (state.highRarityUntil !== undefined && now < state.highRarityUntil) {
        const g = groups.get(bot.id);
        if (g && g.size >= GROUP_MIN_FOR_MODE) {
            return {
                kind: 'highRarity',
                anchor: g.center,
                tetherRadius: GROUP_CLUSTER_RADIUS,
                returnRadius: GROUP_CLUSTER_RETURN
            };
        }
    }

    // Every bot heads to the spawn zone matching its band so it actually
    // farms the mob tier its loadout was tuned for, instead of just wandering
    // wherever it spawned. Ultra+ bots get the wider mythic-zone roam radius
    // (they're hunting boss spawns), everyone else uses the standard tether.
    //
    // The chosen zone is cached on the bot: it only changes when the bot's
    // gear band changes, or when it has actually settled in the zone and its
    // farm timer runs out (at which point it moves on to another zone, the
    // way a player eventually rotates elsewhere).
    const botRarityIdx = getBotMaxRarityIdx(bot);
    let zone: { x: number; y: number } | null = null;
    if (state.farmZoneX !== undefined && state.farmZoneY !== undefined
        && state.farmZoneRarityIdx === botRarityIdx) {
        zone = { x: state.farmZoneX, y: state.farmZoneY };
        const dx = zone.x - bot.x;
        const dy = zone.y - bot.y;
        const arrived = dx * dx + dy * dy < FARM_ZONE_ARRIVED_DIST * FARM_ZONE_ARRIVED_DIST;
        if (arrived && state.farmZoneUntil !== undefined && now >= state.farmZoneUntil) {
            zone = null;   // timer expired while on station — rotate onward
            state.farmZoneRotation = (state.farmZoneRotation ?? 0) + 1;
        }
    }
    if (!zone) {
        zone = pickFarmingZoneAnchor(bot, botRarityIdx, state.farmZoneRotation ?? 0);
        if (zone) {
            state.farmZoneX = zone.x;
            state.farmZoneY = zone.y;
            state.farmZoneRarityIdx = botRarityIdx;
            state.farmZoneUntil = now + FARM_ZONE_MIN_MS + Math.random() * (FARM_ZONE_MAX_MS - FARM_ZONE_MIN_MS);
        }
    }
    if (zone) {
        const isHighTier = botRarityIdx >= ULTRA_IDX;
        return {
            kind: 'normal',
            anchor: zone,
            tetherRadius: isHighTier ? ULTRA_ROAM_RADIUS : TETHER_RADIUS,
            returnRadius: isHighTier ? ULTRA_ROAM_RETURN : TETHER_RETURN_RADIUS
        };
    }

    // Map has no spawn zones at all — fall back to tethering to a human if
    // one exists, otherwise free-roam from the bot's current position.
    const human = nearestRealPlayer(bot.x, bot.y);
    return {
        kind: 'normal',
        anchor: human ? { x: human.x, y: human.y } : null,
        tetherRadius: TETHER_RADIUS,
        returnRadius: TETHER_RETURN_RADIUS
    };
}

// Radius within which another bot pushes us aside. Tuned to just larger than
// two player bodies so bots don't overlap but don't scatter across the map.
const BOT_SEPARATION_RADIUS = PLAYER_SIZE * 2.2;
// How strongly the separation vector blends into intended direction.
const BOT_SEPARATION_STRENGTH = 0.9;

/**
 * Per-bot "personality" — a persistent set of small behavioural offsets so no
 * two bots play identically. Rolled once per bot id and held for its lifetime.
 *
 *  x / y            unit bias vector; keeps two bots chasing the same spot from
 *                   sitting on identical coordinates.
 *  standoffBias     how far inside max petal reach this bot orbits (px). Always
 *                   negative: bots vary in how tightly they crowd a mob, but
 *                   never park beyond reach where their petals can't connect.
 *                   Spreading the ring also stops every bot from converging on
 *                   one distance and being shoved in and out of it together by
 *                   separation.
 *  reactionMs       delay between spotting a target and committing to it.
 *  turnRate         max heading change per tick (rad). Low = lumbering.
 *  wanderSpeed      cruise speed multiplier while wandering.
 *  idleChance       chance of pausing on arrival at a wander point.
 *  aggression       how long the bot stays in a fight before running.
 */
interface BotPersona {
    x: number;
    y: number;
    standoffBias: number;
    reactionMs: number;
    turnRate: number;
    wanderSpeed: number;
    idleChance: number;
    aggression: number;
}
const botPersona = new Map<string, BotPersona>();
function getBotPersona(id: string): BotPersona {
    let p = botPersona.get(id);
    if (!p) {
        // Seeded off the bot id so a persona is stable even if the map entry is
        // rebuilt, and so behaviour is reproducible when debugging a given bot.
        const rng = seededRng(hashString(id));
        const a = rng() * Math.PI * 2;
        p = {
            x: Math.cos(a),
            y: Math.sin(a),
            standoffBias: -(2 + rng() * 38),           // 2-40 px inside max reach
            reactionMs: 120 + rng() * 320,             // 120-440 ms
            turnRate: 0.26 + rng() * 0.22,             // 0.26-0.48 rad/tick
            wanderSpeed: 0.40 + rng() * 0.30,          // 0.40-0.70
            idleChance: rng() * 0.45,
            aggression: 0.85 + rng() * 0.30,           // 0.85-1.15
        };
        botPersona.set(id, p);
    }
    return p;
}

// Speed below which heading changes are instant. A near-stationary player can
// pivot freely; only a bot already moving has to arc into its new direction.
const FREE_TURN_SPEED = 55;

function driveMove(
    bot: ServerPlayer,
    dirX: number,
    dirY: number,
    speedMult: number,
    petalExtension: number,
    agility: number = 1.0
): void {
    // Separation: push away from any other bot inside BOT_SEPARATION_RADIUS,
    // weighted by 1 - dist/radius so near-touches dominate over mid-range
    // neighbors. Keeps squads from collapsing to a single point.
    let sepX = 0;
    let sepY = 0;
    for (let i = 0; i < botRoster.length; i++) {
        const other = botRoster[i];
        if (other.id === bot.id) continue;
        if (other.isDead) continue;
        const dx = bot.x - other.x;
        const dy = bot.y - other.y;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0 || d2 > BOT_SEPARATION_RADIUS * BOT_SEPARATION_RADIUS) continue;
        const d = Math.sqrt(d2);
        const w = (1 - d / BOT_SEPARATION_RADIUS) / d;
        sepX += dx * w;
        sepY += dy * w;
    }

    // Persistent per-bot bias + a tiny tick-level wobble so motion looks alive
    // instead of pixel-locked. Kept small (<0.15) so it never overrides intent.
    const persona = getBotPersona(bot.id);
    const wobbleX = persona.x * 0.08 + (Math.random() - 0.5) * 0.06;
    const wobbleY = persona.y * 0.08 + (Math.random() - 0.5) * 0.06;

    let outX = dirX + sepX * BOT_SEPARATION_STRENGTH + wobbleX;
    let outY = dirY + sepY * BOT_SEPARATION_STRENGTH + wobbleY;
    const mag = Math.sqrt(outX * outX + outY * outY);
    if (mag > 0) {
        outX /= mag;
        outY /= mag;
    } else {
        outX = dirX;
        outY = dirY;
    }

    // Turn-rate limiting. The AI can request any direction on any tick; a real
    // player's hand can't. Easing the heading toward the request does two
    // things: movement reads as a human arcing around rather than a turret
    // snapping, and a decision that flip-flops between two opposite directions
    // can no longer translate into visible per-tick vibration — the heading
    // just hovers near the midpoint until something breaks the tie.
    const state = botAIState.get(bot.id);
    if (state) {
        const speed = Math.sqrt(bot.velocityX * bot.velocityX + bot.velocityY * bot.velocityY);
        if (state.headX === undefined || state.headY === undefined || speed < FREE_TURN_SPEED) {
            state.headX = outX;
            state.headY = outY;
        } else {
            const cur = Math.atan2(state.headY, state.headX);
            const want = Math.atan2(outY, outX);
            let delta = want - cur;
            // Shortest signed arc
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const maxTurn = persona.turnRate * agility;
            if (delta > maxTurn) delta = maxTurn;
            else if (delta < -maxTurn) delta = -maxTurn;
            const next = cur + delta;
            state.headX = Math.cos(next);
            state.headY = Math.sin(next);
        }
        outX = state.headX;
        outY = state.headY;
    }

    bot.inputs.useMouse = true;
    bot.inputs.mouseDirectionX = outX;
    bot.inputs.mouseDirectionY = outY;
    bot.inputs.mouseSpeedMultiplier = speedMult;
    bot.inputs.petalExtension = petalExtension;
}

/**
 * Update bot AI — decides movement + combat posture each tick and writes into
 * `bot.inputs`, which the normal updatePlayerState pipeline then consumes.
 *
 * Priority: flee at low HP > attack boss/mob target > collect eligible drops > wander.
 */
// How often (ms) to consider a bot squad action. Staggered per-bot.
const BOT_SQUAD_TICK_MS = 8000;
// Chance per tick of this bot creating a public squad (if not in one).
const BOT_SQUAD_CREATE_CHANCE = 0.03;
// Chance per tick of this bot joining an available public squad.
const BOT_SQUAD_JOIN_CHANCE = 0.5;
const botSquadNextTick: Map<string, number> = new Map();

function updateBotSquadMembership(io: SocketIOServer, now: number): void {
    for (let i = 0; i < botRoster.length; i++) {
        const bot = botRoster[i];
        if (bot.isDead) continue;
        const id = bot.id;

        const next = botSquadNextTick.get(id) || 0;
        if (now < next) continue;
        // Jitter the next tick so bots don't all evaluate simultaneously.
        botSquadNextTick.set(id, now + BOT_SQUAD_TICK_MS + Math.floor(Math.random() * 4000));

        if (playerSquadMap.has(id)) continue;

        // Prefer joining an existing public squad with room.
        const publicSquads = listPublicSquadsFn();
        if (publicSquads.length > 0 && Math.random() < BOT_SQUAD_JOIN_CHANCE) {
            const squad = publicSquads[Math.floor(Math.random() * publicSquads.length)];
            const { squad: joined, error } = joinPublicSquadFn(squad.id, id);
            if (!error && joined) {
                bot.squadId = joined.id;
                sendSquadSystemMessage(joined, io, `${bot.name} has joined the squad.`);
                for (const memberId of joined.memberIds) {
                    if (memberId.startsWith('bot_')) continue;
                    io.to(memberId).emit('squadUpdate', { squadId: joined.id, memberIds: joined.memberIds, leaderId: joined.leaderId });
                }
            }
            continue;
        }

        // Occasionally host a new public squad. The bot will advertise the
        // code on its next boss callout via the {code} templates.
        if (Math.random() < BOT_SQUAD_CREATE_CHANCE) {
            const squad = createSquadFn(id, true);
            if (squad) {
                bot.squadId = squad.id;
            }
        }
    }
}

// Per-tick indexes. Bot targeting used to do 4-5 full linear scans over all
// ~1400 enemies PER BOT per tick (findNearestBossForBot ×2, hasHighRarityMobNearby,
// pickBestEnemyTarget, findInterceptingMob) — ~300k iterations/tick at the 50-bot
// cap, the single largest tick cost after the petal loops. Bosses are indexed once
// per tick (there are only a handful), and the range-bounded scans go through the
// enemy spatial grid instead. rebuildEnemyGrid() must run BEFORE updateBotAI in
// the tick for the grid queries to see this tick's positions (see server.ts).
const bossIndex: (Enemy)[] = [];
// One shared broad-phase scratch: the three query users per bot (mode scan, target
// pick, intercept) each fully consume their results before the next query runs.
const _botQueryScratch: (Enemy)[] = [];

function rebuildBossIndex(): void {
    bossIndex.length = 0;
    for (const enemy of liveEnemies()) {
        if (enemy.ownerId) continue;
        if (isMobDead(enemy.entity)) continue;
        if (enemy.type === 'target_dummy') continue;
        if (BOSS_TIERS.has(enemy.tier)) bossIndex.push(enemy);
    }
}

// --- Trajectory watchdog (oscillation / stuck detection) ---
//
// Every individual decision here can be locally reasonable and still add up to
// a bot pacing between two spots forever: two mobs trading "closest", a wander
// point behind a wall, an anchor that moves because the bot moved. Rather than
// enumerating causes, this watches the trajectory the decisions actually
// produce. Position is sampled on a fixed interval; when consecutive samples
// keep pointing in opposite directions — or the bot barely moves while still
// being driven — it is forced into a committed escape for a beat, which breaks
// whatever tie was flip-flopping.
const OSC_SAMPLE_MS = 450;
const OSC_MIN_STEP = 10;            // px in a sample worth calling "movement"
const OSC_REVERSAL_DOT = -0.30;     // cos of the angle between consecutive steps
const OSC_TRIP_REVERSALS = 3;       // ~1.4 s of back-and-forth
const OSC_STILL_TRIPS = 3;          // ~1.4 s of going nowhere
const UNSTICK_MIN_MS = 900;
const UNSTICK_MAX_MS = 1700;
// While escaping, combat targeting is suppressed so the bot doesn't walk
// straight back into the situation it was oscillating in.
const UNSTICK_TARGET_SUPPRESS_MS = 1200;
const UNSTICK_PROBE_DIST = 260;
// Jamming this many times inside this window means sidestepping isn't enough:
// the destination itself keeps walking the bot back into the same corner
// (normal-mode navigation is a cheap steering probe, which can't reason its
// way out of a concave wall). Escalate by sending it somewhere else entirely.
const UNSTICK_ESCALATE_TRIPS = 3;
const UNSTICK_ESCALATE_WINDOW_MS = 15_000;

// Keep the watchdog quiet while the bot is deliberately standing still.
function resetOscillationSampler(bot: ServerPlayer, state: BotAIState, now: number): void {
    state.oscSampleAt = now;
    state.oscX = bot.x;
    state.oscY = bot.y;
    state.oscStill = 0;
    state.oscReversals = 0;
    state.oscPrevDX = undefined;
    state.oscPrevDY = undefined;
}

function detectOscillation(bot: ServerPlayer, state: BotAIState, now: number): boolean {
    if (state.oscSampleAt === undefined) {
        resetOscillationSampler(bot, state, now);
        return false;
    }
    if (now - state.oscSampleAt < OSC_SAMPLE_MS) return false;

    const dx = bot.x - (state.oscX ?? bot.x);
    const dy = bot.y - (state.oscY ?? bot.y);
    state.oscSampleAt = now;
    state.oscX = bot.x;
    state.oscY = bot.y;

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < OSC_MIN_STEP) {
        state.oscStill = (state.oscStill ?? 0) + 1;
        state.oscReversals = 0;
    } else {
        state.oscStill = 0;
        const pdx = state.oscPrevDX;
        const pdy = state.oscPrevDY;
        if (pdx !== undefined && pdy !== undefined) {
            const plen = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
            const dot = (dx * pdx + dy * pdy) / (len * plen);
            state.oscReversals = dot < OSC_REVERSAL_DOT ? (state.oscReversals ?? 0) + 1 : 0;
        }
        state.oscPrevDX = dx;
        state.oscPrevDY = dy;
    }

    if ((state.oscReversals ?? 0) >= OSC_TRIP_REVERSALS || (state.oscStill ?? 0) >= OSC_STILL_TRIPS) {
        state.oscReversals = 0;
        state.oscStill = 0;
        state.oscPrevDX = undefined;
        state.oscPrevDY = undefined;
        return true;
    }
    return false;
}

// Escape direction for a bot that tripped the watchdog. Sidesteps first —
// perpendicular to the rut is the shortest way out of a two-point shuffle —
// then progressively wider, and finally straight back. The leading side is
// randomized so a knot of stuck bots doesn't all peel off the same way.
function pickUnstickDirection(bot: ServerPlayer, state: BotAIState): { x: number; y: number } {
    const base = Math.atan2(state.headY ?? 0, state.headX ?? 1);
    const side = Math.random() < 0.5 ? 1 : -1;
    const offsets = [
        (Math.PI / 2) * side, -(Math.PI / 2) * side,
        (2 * Math.PI / 3) * side, -(2 * Math.PI / 3) * side,
        Math.PI,
        (Math.PI / 3) * side, -(Math.PI / 3) * side,
        0
    ];
    for (const off of offsets) {
        const a = base + off;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        if (!rayHitsWall(bot.x, bot.y, bot.x + dx * UNSTICK_PROBE_DIST, bot.y + dy * UNSTICK_PROBE_DIST)) {
            return { x: dx, y: dy };
        }
    }
    const a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
}

// Combat orbit controller: how many px off the standoff ring corresponds to a
// full-strength radial correction. Larger = lazier, smoother approach.
const ORBIT_RADIAL_GAIN = 90;
// Flee hysteresis — recover to this multiple of the flee threshold before
// re-engaging, and stay in flight at least this long once committed.
const FLEE_RECOVER_RATIO = 2.0;
const FLEE_MIN_MS = 1200;

/**
 * Register bot AI as a `Phase.Input` system.
 *
 * ---------------------------------------------------------------------------
 * Why bot AI is a system, but NOT a system in `src/ecs`
 * ---------------------------------------------------------------------------
 * Two separate questions, with two different answers.
 *
 * SCHEDULING. `Phase.Input`'s doc comment has always said "sample player inputs
 * and run bot AI into the same input fields", and this is that. Being scheduled
 * means bot AI shows up in `Scheduler.drainTimings()` alongside every other
 * system in the tick-budget report, can be toggled by the debug menu, and has
 * ONE declared position in the tick order instead of a bare call in the middle
 * of `start_loop`.
 *
 * But WHICH scheduler is the whole decision, and getting it wrong is invisible.
 * The mob scheduler (`EcsRuntime.scheduler`) runs inside `moveEnemies()`, which
 * is AFTER `updatePlayerState` in `runSimulationStep`. A `Phase.Input` system
 * registered there would compute inputs that legacy had already consumed this
 * tick, so every bot would act on a tick-old decision — and all four gates would
 * pass, because nothing anywhere asserts that a bot's input was produced before
 * it was read. The player scheduler is no better: it runs INSIDE the movement
 * window, after `syncPlayersToEcs` has already pushed `player.inputs` into
 * `C.PlayerInput`, so anything written there would be a second writer racing a
 * push that already won.
 *
 * So this goes on `EcsRuntime.inputScheduler`, which `server.ts` ticks at
 * exactly the point `updateBotAI(io)` used to be called: after the enemy grid is
 * rebuilt (bot targeting queries it) and before `runSimulationStep`. The
 * committed positions bots read are then, as they always were, the ones from the
 * end of the previous tick — which is the behavioural contract, not an accident
 * of where the call sat.
 *
 * OWNERSHIP. Bots stay PRODUCERS into `player.inputs` and write no ECS
 * component. `syncPlayersToEcs` is the single writer of `C.PlayerInput`, and it
 * runs after this. If bot AI wrote the component instead, that push would
 * silently overwrite it with the stale legacy object every tick — the exact
 * shape of the projectile-damage bug (a write outside the sync window that the
 * next push reverts, with nothing failing). One writer, one direction.
 *
 * LOCATION. The decision code cannot move into `src/ecs`: it reads the wall tile
 * grid and the world map for A* and teleporter routing, the world item list,
 * squad and guild membership, and it emits chat. `src/ecs` may not import the
 * map or constants.ts and is bundled into the browser by webpack, so moving bot
 * AI there would either ship the pathfinder and the squad manager to every
 * client or replace 3000 lines of logic with 30 injected dependencies. A system
 * is a function; it does not have to live in the ECS to be scheduled by it.
 */
export function registerBotInputSystem(
    scheduler: Scheduler,
    io: SocketIOServer,
): void {
    scheduler.add('botAI', Phase.Input, (ctx: SystemContext) => {
        updateBotAI(io, ctx.world, ctx.now);
    });
}

/**
 * Update bot AI — decides movement + combat posture for every bot and writes
 * into `player.inputs`, which the normal `updatePlayerState` pipeline consumes.
 *
 * `now` is the scheduler's once-per-tick clock sample rather than a fresh
 * `Date.now()`, so every bot in a tick agrees on the time. Several of the
 * hysteresis timers here (flee, unstick, target reaction, wander) compare
 * against absolute deadlines and would behave subtly differently if each bot
 * re-read the clock.
 */
export function updateBotAI(io: SocketIOServer, world: World, now: number): void {
    rebuildBotRoster(world);
    rebuildBossIndex();
    updateBotSquadMembership(io, now);

    // Reset the per-tick A* budget so a single tick can't be dominated by
    // simultaneous recomputes (e.g., a whole raid repathing at once).
    pathBudgetThisTick = PATH_MAX_PER_TICK;

    // Bots call out fresh super/unique boss sightings in chat — this also
    // triggers the global raid rally via triggerBotRaid().
    announceNewBosses(io, now);

    // Bot groupings are only needed for highRarity mode but it's cheaper to
    // build once and reuse than recompute per-bot.
    const groups = computeBotGroups();
    // Angular slot assignments so raiding bots spread evenly around the boss.
    const raidSlots = computeRaidSlots();

    for (let botIndex = 0; botIndex < botRoster.length; botIndex++) {
        const bot = botRoster[botIndex];
        const id = bot.id;

        let state = botAIState.get(id);
        if (!state) {
            state = { wanderTargetX: bot.x, wanderTargetY: bot.y, nextWanderTime: 0 };
            botAIState.set(id, state);
        }

        if (bot.isDead) {
            // Restore the combat loadout before respawn so the bot isn't stuck
            // with the swapped petals if it died mid-traversal.
            unequipRaidPowder(bot, state);
            unequipYggdrasilSlot(bot, state);
            if (state.respawnAt === undefined) {
                state.respawnAt = now + BOT_RESPAWN_DELAY_MS;
            } else if (now >= state.respawnAt) {
                respawnBot(bot, io);
            }
            continue;
        }

        const persona = getBotPersona(id);

        // Trajectory watchdog. Runs ahead of every decision branch so it also
        // covers bots oscillating in combat, on a path, or while regrouping —
        // the old stuck check lived in the wander branch and never saw them.
        if (state.unstickUntil !== undefined && now < state.unstickUntil) {
            const steered = steerAroundWalls(bot.x, bot.y, state.unstickDirX ?? 1, state.unstickDirY ?? 0);
            driveMove(bot, steered.x, steered.y, 0.8, 1.0, 1.6);
            continue;
        }
        if (detectOscillation(bot, state, now)) {
            const dir = pickUnstickDirection(bot, state);
            state.unstickDirX = dir.x;
            state.unstickDirY = dir.y;
            state.unstickUntil = now + UNSTICK_MIN_MS + Math.random() * (UNSTICK_MAX_MS - UNSTICK_MIN_MS);
            state.suppressTargetUntil = now + UNSTICK_TARGET_SUPPRESS_MS;
            state.targetId = undefined;
            state.pickupId = undefined;
            state.nextWanderTime = 0;
            state.idleUntil = undefined;
            // The cached path is a prime suspect for the rut — drop it.
            state.pathNodes = undefined;
            state.pathIndex = undefined;
            state.pathGoalTileX = undefined;
            state.pathGoalTileY = undefined;
            state.pathCreatedAt = undefined;
            // Commit the heading immediately rather than easing into it.
            state.headX = dir.x;
            state.headY = dir.y;
            // Repeat offender? Then the destination is the problem, not the
            // local geometry — give the bot a different place to be.
            if (state.unstickTripsAt === undefined || now - state.unstickTripsAt > UNSTICK_ESCALATE_WINDOW_MS) {
                state.unstickTripsAt = now;
                state.unstickTrips = 1;
            } else {
                state.unstickTrips = (state.unstickTrips ?? 0) + 1;
            }
            if ((state.unstickTrips ?? 0) >= UNSTICK_ESCALATE_TRIPS) {
                state.unstickTrips = 0;
                state.unstickTripsAt = now;
                state.farmZoneRotation = (state.farmZoneRotation ?? 0) + 1;
                state.farmZoneX = undefined;
                state.farmZoneY = undefined;
                state.farmZoneUntil = undefined;
            }
            const steered = steerAroundWalls(bot.x, bot.y, dir.x, dir.y);
            driveMove(bot, steered.x, steered.y, 0.8, 1.0, 1.6);
            continue;
        }

        const mode = computeBotMode(bot, groups, state, now);
        const anchor = mode.anchor;
        const anchorDist = anchor
            ? Math.sqrt((anchor.x - bot.x) ** 2 + (anchor.y - bot.y) ** 2)
            : 0;
        const preferredTiers = preferredMobTiersForBot(getBotMaxRarityIdx(bot));

        // Swap in a powder petal whenever the bot is far enough from its
        // anchor that traversal speed actually matters — both raid traversal
        // (heading to a boss) and normal mode (heading to its band's farming
        // zone) qualify. Restored once the bot is in engagement range, so
        // combat slot 0 is back online before petals are needed. Separate
        // equip/unequip distances keep a bot loitering near the boundary from
        // re-rolling its loadout every tick.
        if (anchorDist > RAID_POWDER_EQUIP_DIST) {
            equipRaidPowder(bot, state);
        } else if (anchorDist < RAID_POWDER_UNEQUIP_DIST) {
            unequipRaidPowder(bot, state);
        }

        // Yggdrasil buddy swap: when another bot is close enough that they
        // could plausibly need a revive, slot 1 is replaced with a yggdrasil
        // petal. Restored when the bot is alone again — at a wider range than
        // it was equipped, so the swap can't chatter.
        const buddyRange = state.yggdrasilSlot !== undefined
            ? YGGDRASIL_BUDDY_DROP_RANGE
            : YGGDRASIL_BUDDY_RANGE;
        if (hasNearbyBotBuddy(bot, buddyRange)) {
            equipYggdrasilSlot(bot, state);
        } else {
            unequipYggdrasilSlot(bot, state);
        }

        // Revive seek: if a teammate has gone down within range and this bot
        // is carrying a yggdrasil, head straight to the corpse. The actual
        // revive (in playerState.ts) fires when one of our orbiting petals
        // touches the body, so we just need to get the body inside our orbit.
        const reviveTarget = findReviveTarget(bot, state);
        if (reviveTarget) {
            const dx = reviveTarget.x - bot.x;
            const dy = reviveTarget.y - bot.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            // Stand right on top of the corpse — the revive trigger uses the
            // petal position, and orbiting petals sweep through the centre.
            // Petals are extended (2.0) so they can clip the corpse from a
            // small radius without us body-blocking nearby allies.
            const steered = steerAroundWalls(bot.x, bot.y, dx / d, dy / d);
            driveMove(bot, steered.x, steered.y, 0.95, 2.0);
            continue;
        }

        // Long-haul raid routing: hop through a teleporter when one puts the
        // bot meaningfully closer to the boss, or warp the bot to a spawn zone
        // in the boss's section if no teleporter helps.
        if (mode.kind === 'raid' && anchor && handleRaidShortcut(bot, state, now, anchor, anchorDist)) {
            continue;
        }

        // Target selection, with commitment. The raw score flips between two
        // equally-good mobs on tiny position changes; TARGET_STICKINESS makes
        // the bot hold the one it chose until a rival is clearly better, so it
        // stops walking half-way to one mob and turning back toward the other.
        let target = (state.suppressTargetUntil !== undefined && now < state.suppressTargetUntil)
            ? null
            : pickBestEnemyTarget(bot, anchor, mode.tetherRadius, preferredTiers, state.targetId);

        if (target) {
            if (target.enemy.id !== state.targetId) {
                state.targetId = target.enemy.id;
                state.targetAcquiredAt = now;
            }
            // Reaction time: a player doesn't lock on the instant a mob crosses
            // into range. Until the delay elapses the bot carries on with what
            // it was doing, which reads as noticing rather than tracking.
            if (now - (state.targetAcquiredAt ?? 0) < persona.reactionMs) {
                target = null;
            }
        } else {
            state.targetId = undefined;
            state.targetAcquiredAt = undefined;
        }

        let isBossTarget = !!(target && BOSS_TIERS.has(target.enemy.tier));

        // Ram interception: if a non-target mob is sitting in the bot's path
        // close enough to body-slam, hijack the target so combat bands engage
        // it for a tick. Without this, a bot beelining for a far-away boss
        // (especially powdered up during raid traversal) plows straight
        // through every mob in between without its petals ever locking on.
        // Only fires when the bot is actually moving toward something — i.e.
        // there's a target whose direction we can read.
        if (target) {
            const tdx = mobX(target.enemy.entity) - bot.x;
            const tdy = mobY(target.enemy.entity) - bot.y;
            const tDist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
            const intercept = findInterceptingMob(
                bot.x, bot.y, tdx / tDist, tdy / tDist,
                target.enemy.id, 160
            );
            // Only divert when the interceptor is meaningfully closer than the
            // real target — otherwise we'd swap to the same mob we're already
            // engaging and clobber the boss-slot logic.
            if (intercept && intercept.dist < tDist - 40) {
                target = { enemy: intercept.enemy, dist: intercept.dist };
                isBossTarget = false;
            }
        }

        // If bot has drifted outside its cluster (boss raid / group / tether),
        // abandon the current task and regroup. Skipped when raiding a boss
        // target — bots commit to the fight even if the anchor is far.
        if (anchor && anchorDist > mode.returnRadius && !(mode.kind === 'raid' && isBossTarget)) {
            // Raid & group crowds use A* to navigate around wall clusters.
            // Normal-mode regroup stays on the cheap steering probe.
            if (mode.kind !== 'normal' && followPath(bot, state, now, anchor.x, anchor.y, 1.0, 1.0)) {
                continue;
            }
            const dx = anchor.x - bot.x;
            const dy = anchor.y - bot.y;
            const d = anchorDist || 1;
            const steered = steerAroundWalls(bot.x, bot.y, dx / d, dy / d);
            driveMove(bot, steered.x, steered.y, 1.0, 1.0);
            continue;
        }

        const healthRatio = bot.health / Math.max(1, bot.maxHealth);
        // Bosses are too valuable to flee — commit unless critically low.
        // Persona shifts the bar either way: some bots bail at the first sign
        // of trouble, others stay in far too long.
        const baseFlee = FLEE_HEALTH_RATIO * (2 - persona.aggression);
        const fleeThreshold = isBossTarget ? baseFlee * 0.5 : baseFlee;

        // Flee/fight hysteresis. Sitting exactly on the threshold used to flip
        // the decision every tick — the bot backed off, healed a sliver,
        // re-engaged, got hit, backed off: a two-position shuffle driven by
        // health rather than geometry. Now it commits to running until it has
        // actually recovered.
        if (state.fleeing) {
            if (healthRatio > fleeThreshold * FLEE_RECOVER_RATIO && now >= (state.fleeUntil ?? 0)) {
                state.fleeing = false;
            }
        } else if (healthRatio < fleeThreshold) {
            state.fleeing = true;
            state.fleeUntil = now + FLEE_MIN_MS;
        }

        if (target && state.fleeing) {
            const dx = bot.x - mobX(target.enemy.entity);
            const dy = bot.y - mobY(target.enemy.entity);
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            // Break away at an angle instead of straight back: a dead-straight
            // retreat line from a chasing mob is a bot tell.
            const strafe = tangentDirection(bot.id, state, now);
            const ax = dx / d + (-dy / d) * 0.35 * strafe;
            const ay = dy / d + (dx / d) * 0.35 * strafe;
            const am = Math.sqrt(ax * ax + ay * ay) || 1;
            const steered = steerAroundWalls(bot.x, bot.y, ax / am, ay / am);
            driveMove(bot, steered.x, steered.y, 1.0, 0.7, 1.5);
            continue;
        }

        if (target) {
            const dx = mobX(target.enemy.entity) - bot.x;
            const dy = mobY(target.enemy.entity) - bot.y;
            const d = target.dist || Math.sqrt(dx * dx + dy * dy) || 1;
            const dirX = dx / d;
            const dirY = dy / d;

            // Compute the actual standoff distance: petal orbit reach + mob
            // radius + buffer. This is how far petals can hit from and keeps
            // the bot's body out of the mob's collision circle.
            // 2.0 matches the player's max attack-state extension (space/LMB).
            const extendedPetalExt = 2.0;
            const petalReach = computePetalReach(bot, extendedPetalExt);
            const mobRadius = getMobRadius(target.enemy);
            // True max hit distance (bot centre → mob centre) where a petal's
            // far edge just touches the mob edge is petalReach - the safety
            // buffer + mobRadius. Stand ~10 px inside that so position jitter
            // still lands hits. Without this subtraction the safety buffer
            // gets double-counted and bots park just outside actual reach.
            const baseStandoff = petalReach - STANDOFF_SAFETY_BUFFER + mobRadius - 10;
            // Per-bot radial bias spreads the equilibrium ring so neighboring
            // bots don't all sit at the same distance and get shoved in and
            // out of it together by separation. Strictly inward: baseStandoff
            // is already the outer edge of what the petals can reach.
            const standoff = baseStandoff + persona.standoffBias;
            const dangerDist = PLAYER_SIZE / 2 + mobRadius + 6; // body-touch threshold

            if (d < dangerDist) {
                // Too close — shove off but stay in attack state so petals
                // remain extended while killing the mob. High agility: this is
                // the one case where an instant direction change is right.
                driveMove(bot, -dirX, -dirY, 1.0, extendedPetalExt, 3.0);
                continue;
            }

            if (d > standoff + 80) {
                // Far away — close distance at full speed. Raid/group bots
                // use A* to navigate around wall clusters; normal bots use
                // the cheap steering probe. (No speed-mod compensation: this
                // is the traversal branch where powder is supposed to help.)
                if (mode.kind !== 'normal' && followPath(bot, state, now, mobX(target.enemy.entity), mobY(target.enemy.entity), 0.95, extendedPetalExt)) {
                    continue;
                }
                const steered = steerAroundWalls(bot.x, bot.y, dirX, dirY);
                driveMove(bot, steered.x, steered.y, 0.95, extendedPetalExt);
                continue;
            }

            const strafe = tangentDirection(bot.id, state, now);
            let moveX: number;
            let moveY: number;
            let speedMult: number;

            // Boss raiders own an angular slot around the boss so they spread
            // out instead of stacking on one side.
            const slotAngle = isBossTarget ? raidSlots.get(bot.id) : undefined;

            if (slotAngle !== undefined) {
                // Ease toward the assigned slot. The raw assignment jumps every
                // time a raider joins or dies (the slots are redealt), and
                // snapping to the new angle sent bots sprinting around the boss
                // — or, with two raiders trading slots, back and forth forever.
                const cur = state.slotAngle;
                let use: number;
                if (cur === undefined) {
                    use = slotAngle;
                } else {
                    let delta = slotAngle - cur;
                    while (delta > Math.PI) delta -= Math.PI * 2;
                    while (delta < -Math.PI) delta += Math.PI * 2;
                    const step = 0.06;
                    use = cur + Math.max(-step, Math.min(step, delta));
                }
                state.slotAngle = use;

                const slotX = mobX(target.enemy.entity) + Math.cos(use) * standoff;
                const slotY = mobY(target.enemy.entity) + Math.sin(use) * standoff;
                const sx = slotX - bot.x;
                const sy = slotY - bot.y;
                const sd = Math.sqrt(sx * sx + sy * sy);
                if (sd > 12) {
                    // Speed tapers continuously to the strafe speed as the bot
                    // settles in, so there's no threshold to flip across.
                    moveX = sx / sd;
                    moveY = sy / sd;
                    speedMult = Math.min(0.8, 0.15 + sd / 300);
                } else {
                    moveX = -dirY * strafe;
                    moveY = dirX * strafe;
                    speedMult = 0.18;
                }
            } else {
                // Continuous orbit controller. This replaces the old ladder of
                // discrete distance bands (retreat / strafe / creep in), where
                // a bot whose distance wobbled across a band edge would flip
                // between backing off and closing in every tick — the in-combat
                // form of the two-position shuffle. Now the radial correction
                // is proportional to how far off the standoff ring the bot is
                // and passes smoothly through zero at the ring itself, so
                // there's nothing to flip between.
                const err = d - standoff;                                    // + = too far out
                const radial = Math.max(-1, Math.min(1, err / ORBIT_RADIAL_GAIN));
                // Circle hardest when settled on the ring, less while correcting.
                const tangential = 1 - 0.55 * Math.min(1, Math.abs(radial));
                moveX = dirX * radial + (-dirY * strafe) * tangential;
                moveY = dirY * radial + (dirX * strafe) * tangential;
                const m = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
                moveX /= m;
                moveY /= m;
                speedMult = 0.28 + 0.45 * Math.min(1, Math.abs(err) / 110);
            }

            // Close range: cancel out the bot's aggregated speed modifier
            // (powder, etc.) so per-tick movement matches what the controller
            // was tuned for. A powder-wearing bot moving 2× through the
            // standoff zone otherwise overshoots the ring every tick and
            // ping-pongs across it instead of orbiting.
            const speedMod = getBotSpeedMod(bot);
            const effectiveSpeedMult = speedMod > 1.0 ? speedMult / speedMod : speedMult;
            driveMove(bot, moveX, moveY, effectiveSpeedMult, extendedPetalExt);
            continue;
        }

        // No combat target — try to grab a nearby drop we earned
        const pickup = findPickupTarget(bot, anchor, mode.tetherRadius, state.pickupId);
        if (pickup) {
            state.pickupId = pickup.item.id;
            const dx = pickup.item.x - bot.x;
            const dy = pickup.item.y - bot.y;
            const d = pickup.dist || Math.sqrt(dx * dx + dy * dy) || 1;
            // Only steer when the pickup is far enough that walls could
            // genuinely block; close-range pickup doesn't need pathing.
            if (d > WALL_TILE_SIZE) {
                const steered = steerAroundWalls(bot.x, bot.y, dx / d, dy / d);
                driveMove(bot, steered.x, steered.y, 0.9, 1.0);
            } else {
                driveMove(bot, dx / d, dy / d, 0.9, 1.0);
            }
            continue;
        }
        state.pickupId = undefined;

        // Idle pause — nothing to fight, nothing to grab. Real players stop to
        // look around instead of marching between waypoints without a break.
        if (state.idleUntil !== undefined && now < state.idleUntil) {
            bot.inputs.useMouse = false;
            bot.inputs.keys = [];
            bot.inputs.petalExtension = 1.0;
            // Standing still on purpose isn't being stuck — keep the watchdog
            // from reading a deliberate pause as a jam.
            resetOscillationSampler(bot, state, now);
            continue;
        }
        state.idleUntil = undefined;

        // Wander — keep target inside the current cluster radius so raid/
        // group bots stay tight and normal bots stay tethered.
        if (now > state.nextWanderTime) {
            const center = anchor ?? { x: bot.x, y: bot.y };
            const maxDist = Math.max(80, mode.tetherRadius - 100);
            // Try a few random angles and pick the first one with line of
            // sight from the bot's current position. Bots that pick a wander
            // target through a wall have no way to actually reach it and end
            // up parked against the wall until nextWanderTime fires again.
            let pickedX = bot.x;
            let pickedY = bot.y;
            let foundClear = false;
            for (let attempt = 0; attempt < 8; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.min(maxDist, 200) + Math.random() * Math.max(0, maxDist - 200);
                const tx = clampToWorld(center.x + Math.cos(angle) * dist, 100, ACTUAL_WORLD_WIDTH);
                const ty = clampToWorld(center.y + Math.sin(angle) * dist, 100, ACTUAL_WORLD_HEIGHT);
                if (!rayHitsWall(bot.x, bot.y, tx, ty)) {
                    pickedX = tx;
                    pickedY = ty;
                    foundClear = true;
                    break;
                }
            }
            // If everything is walled off, scoot a short distance in any clear
            // direction so the bot at least moves and unsticks itself.
            if (!foundClear) {
                for (let attempt = 0; attempt < 8; attempt++) {
                    const angle = Math.random() * Math.PI * 2;
                    const tx = clampToWorld(bot.x + Math.cos(angle) * 200, 100, ACTUAL_WORLD_WIDTH);
                    const ty = clampToWorld(bot.y + Math.sin(angle) * 200, 100, ACTUAL_WORLD_HEIGHT);
                    if (!rayHitsWall(bot.x, bot.y, tx, ty)) {
                        pickedX = tx;
                        pickedY = ty;
                        break;
                    }
                }
            }
            state.wanderTargetX = pickedX;
            state.wanderTargetY = pickedY;
            state.nextWanderTime = now + 3000 + Math.random() * 4000;
            state.atWanderTarget = false;
        }

        const wdx = state.wanderTargetX - bot.x;
        const wdy = state.wanderTargetY - bot.y;
        const wd = Math.sqrt(wdx * wdx + wdy * wdy);

        if (wd < 30) {
            // Arrived. Decide once — not every tick — whether to linger here,
            // then line up the next hop shortly. The re-pick is deliberately
            // not immediate: a bot walled in on all sides gets its wander
            // target snapped back to its own position, and re-running the
            // 16-raycast pick every tick for it would be pure waste.
            if (!state.atWanderTarget) {
                state.atWanderTarget = true;
                if (Math.random() < persona.idleChance) {
                    state.idleUntil = now + 500 + Math.random() * 2200;
                }
            }
            state.nextWanderTime = Math.min(state.nextWanderTime, now + 250 + Math.random() * 500);
            bot.inputs.useMouse = false;
            bot.inputs.keys = [];
            bot.inputs.petalExtension = 1.0;
            resetOscillationSampler(bot, state, now);
        } else {
            state.atWanderTarget = false;
            // Per-bot cruise speed with a slow drift, so a field of wandering
            // bots doesn't move like a single formation at one fixed pace.
            const cruise = persona.wanderSpeed * (0.9 + 0.1 * Math.sin(now / 900 + persona.x * 6));
            // Steer around walls on wanders too, otherwise bots park against a
            // wall tile until nextWanderTime fires and the target is reshuffled.
            if (wd > WALL_TILE_SIZE) {
                const steered = steerAroundWalls(bot.x, bot.y, wdx / wd, wdy / wd);
                driveMove(bot, steered.x, steered.y, cruise, 1.0);
            } else {
                driveMove(bot, wdx / wd, wdy / wd, cruise, 1.0);
            }
        }
    }
}
