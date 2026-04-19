// AI-controlled bots that fill empty player slots so the game always has ~20 players.
// Bots are regular ServerPlayer objects inserted into the shared `players` dict,
// so the existing tick, rendering, combat, and petal systems handle them with no
// special-casing beyond skipping save/save-game paths (no socket/userId).

import { Server as SocketIOServer } from '../ws_server';
import { ServerPlayer } from '../player';
import {
    players,
    enemies,
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    PLAYER_SIZE,
    SCALE_FACTOR,
    MapElement,
    WALL_TILE_SIZE,
    TELEPORTER_RADIUS,
    getTileState,
    worldToTileX,
    worldToTileY
} from '../constants';
import { WORLD_MAP, WALL_GRID } from '../map_data';
import { getPetalStats } from '../petals';
import { getMobStats } from '../mobs';
import {
    calculateMaxHealthFromLevel,
    calculateDamageFromLevel,
    calculateXPRequirement,
    createInitialInventory,
    findSafeSpawnPosition
} from './playerManager';
import { items } from './gameState';
import {
    createSquad as createSquadFn,
    joinPublicSquad as joinPublicSquadFn,
    listPublicSquads as listPublicSquadsFn,
    leaveSquad as leaveSquadFn,
    getSquadForPlayer as getSquadForPlayerFn,
    sendSquadSystemMessage,
    playerSquadMap
} from './squadManager';
import { registerBotGuild, clearBotGuilds, getBotGuildNameForBot } from './guildManager';

const BOT_ID_PREFIX = 'bot_';
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
const BOSS_TIERS = new Set(['super', 'unique']);
const HIGH_TIERS = new Set(['epic', 'legendary', 'mythic', 'ultra']);

// Raid traversal: when the bot is farther than this from the raid anchor,
// swap slot 0 for powder to close distance faster. Beyond combat range.
const RAID_POWDER_MIN_DIST = 600;
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
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

const BOT_PETAL_POOL = ['basic', 'stinger', 'leaf', 'iris', 'faster', 'cutter', 'missile', 'bone', 'glass', 'dandelion', 'yggdrasil', 'rock', 'third_eye', 'rose', 'powder', 'javascript'];

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
    clearBotGuilds();
    for (const def of BOT_GUILDS) {
        if (def.members.length === 0) continue;
        const [leader, ...rest] = def.members;
        registerBotGuild(def.name, leader, rest);
    }
}

interface BotAIState {
    wanderTargetX: number;
    wanderTargetY: number;
    nextWanderTime: number;
    respawnAt?: number;
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
// {tier} = "super" | "unique", {mob} = e.g. "beetle".
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
    'less than 20 ppl at {tier} {mob}'
];

export function isBot(id: string): boolean {
    return id.startsWith(BOT_ID_PREFIX);
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
    14: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 20], ['ultra', 20], ['super', 20], ['unique', 5]], // levels 141-199
    // Apex band — level 200+. Loadout skews heavily toward end-game rarities,
    // with apex as the headliner. Routed by explicit level check below, not
    // the normal rawBand / LEVEL_BAND_SIZE math.
    20: [['mythic', 10], ['ultra', 20], ['super', 20], ['unique', 20], ['apex', 30]]
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
const MYTHIC_IDX = 5;
const ULTRA_IDX = 6;
function preferredMobTiersForBot(botIdx: number): Set<string> {
    if (botIdx >= ULTRA_IDX) return new Set(['super', 'unique']);
    if (botIdx === MYTHIC_IDX) return new Set(['mythic']);
    if (botIdx >= 0 && botIdx < RARITY_ORDER.length - 1) {
        return new Set([RARITY_ORDER[botIdx + 1]]);
    }
    return new Set();
}

// Mythic spawn zones — where super/unique bosses most often appear. Resolved
// once at first use from WORLD_MAP. Ultra+ bots roam here when idle.
interface MythicZone { cx: number; cy: number }
let mythicZonesCache: MythicZone[] | null = null;
function getMythicZones(): MythicZone[] {
    if (mythicZonesCache) return mythicZonesCache;
    const out: MythicZone[] = [];
    for (const el of WORLD_MAP) {
        if (el.type !== 'spawn') continue;
        if (el.properties?.spawnType !== 'mythic') continue;
        if (el.width <= 0 || el.height <= 0) continue;
        out.push({
            cx: (el.x + el.width / 2) * SCALE_FACTOR,
            cy: (el.y + el.height / 2) * SCALE_FACTOR
        });
    }
    mythicZonesCache = out;
    return out;
}

// Pick a mythic-zone anchor for an ultra+ bot. Uses the bot id as a stable
// hash so different bots gravitate toward different zones instead of all
// piling onto the nearest one.
function pickMythicZoneAnchor(bot: ServerPlayer): { x: number; y: number } | null {
    const zones = getMythicZones();
    if (zones.length === 0) return null;
    // Score = distance, with a deterministic per-bot offset so they spread.
    let h = 0;
    for (let i = 0; i < bot.id.length; i++) h = ((h * 31) + bot.id.charCodeAt(i)) | 0;
    const offset = Math.abs(h) % Math.max(1, zones.length);
    // Sort by distance, then pick the `offset`-th nearest (modulo count) so
    // bots cluster across zones rather than all on the nearest one.
    const scored = zones
        .map(z => ({ z, d: (z.cx - bot.x) ** 2 + (z.cy - bot.y) ** 2 }))
        .sort((a, b) => a.d - b.d);
    const pick = scored[Math.min(offset, scored.length - 1)].z;
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
                const inside = findSafeSpawnPosition(baseArea, 10);
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
                const safe = findSafeSpawnPosition(jitterArea, 4);
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
    const safe = findSafeSpawnPosition(
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

function createBot(io: SocketIOServer): ServerPlayer {
    const id = generateBotId();
    // Name-derived rng: bot level + full loadout are deterministic from the
    // name. Two bots that happen to roll the same name will have the same
    // build, which is the whole point — "a bot named X plays like X".
    const name = pickBotName();
    const rng = seededRng(hashString(name));
    const level = rollBotLevel(rng);
    const maxHealth = calculateMaxHealthFromLevel(level);
    const damage = calculateDamageFromLevel(level);
    const pos = pickBotSpawnPosition();

    const botGuildName = getBotGuildNameForBot(name) || undefined;
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
        inventory: createInitialInventory(),
        loadout: buildBotLoadout(level, rng),
        isInvulnerable: true,
        level,
        xp: 0,
        xpToNextLevel: calculateXPRequirement(level),
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

    io.emit('newPlayer', bot);
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
export function maintainBotCount(io: SocketIOServer, realPlayerCount: number): void {
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
        for (let i = 0; i < toSpawn; i++) createBot(io);
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

// Largest distance from bot center that a petal can still strike a target
// at, given petalExtension and this bot's equipped petals' size/range.
function computePetalReach(bot: ServerPlayer, petalExtension: number): number {
    const baseRadius = 60 * petalExtension;
    let maxRangeMult = 1.0;
    let maxPetalHalfSize = 0;

    if (bot.loadout) {
        for (const item of bot.loadout) {
            if (!item || item.type !== 'petal' || !item.petalType || !item.rarity) continue;
            const stats = getPetalStats(item.petalType, item.rarity);
            if (!stats) continue;
            const effectiveSize = (item as any).customSize ?? stats.size ?? 1.0;
            maxPetalHalfSize = Math.max(maxPetalHalfSize, (40 * effectiveSize) / 2);
            if (stats.range !== undefined) {
                maxRangeMult = Math.max(maxRangeMult, stats.range);
            }
        }
    }

    return baseRadius * maxRangeMult + maxPetalHalfSize + STANDOFF_SAFETY_BUFFER;
}

function getMobRadius(enemy: { type: string; tier: string }): number {
    const stats = getMobStats(enemy.type, enemy.tier);
    const size = stats?.size ?? 1.0;
    return (size * 40) / 2;
}

// --- Wall avoidance ---
// Cheap raycast against WALL_GRID. State 1 = wall, 2 = water — both block.
function rayHitsWall(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return false;
    // Sample every half-tile so we don't skip over a wall tile diagonally
    const step = WALL_TILE_SIZE / 2;
    const steps = Math.ceil(dist / step);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + dx * t;
        const y = y0 + dy * t;
        const s = getTileState(WALL_GRID, x, y);
        if (s === 1 || s === 2) return true;
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
const PATH_MAX_PER_TICK = 3;
const PATH_WAYPOINT_REACHED_DIST = WALL_TILE_SIZE * 0.55;   // ~165 px
const PATH_STALE_MS = 5000;
const PATH_GOAL_INVALIDATE_TILES = 2;

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
    return s === 1 || s === 2;
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

// Min-heap keyed by `f`. Inline for speed (no allocation of wrapper methods).
interface HeapItem { f: number; tx: number; ty: number }
function heapPush(h: HeapItem[], item: HeapItem): void {
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (h[p].f <= h[i].f) break;
        const tmp = h[p]; h[p] = h[i]; h[i] = tmp;
        i = p;
    }
}
function heapPop(h: HeapItem[]): HeapItem | undefined {
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop() as HeapItem;
    if (h.length === 0) return top;
    h[0] = last;
    let i = 0;
    const n = h.length;
    while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < n && h[l].f < h[s].f) s = l;
        if (r < n && h[r].f < h[s].f) s = r;
        if (s === i) break;
        const tmp = h[i]; h[i] = h[s]; h[s] = tmp;
        i = s;
    }
    return top;
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

function findPathAStar(startX: number, startY: number, goalX: number, goalY: number): Waypoint[] | null {
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

    const idxOf = (tx: number, ty: number) => ty * gridW + tx;

    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const open: HeapItem[] = [];
    const startIdx = idxOf(sx, sy);

    gScore.set(startIdx, 0);
    heapPush(open, { f: octileHeuristic(sx, sy, gx, gy), tx: sx, ty: sy });

    let expanded = 0;
    while (open.length > 0 && expanded < PATH_MAX_NODES) {
        const cur = heapPop(open) as HeapItem;
        if (cur.tx === gx && cur.ty === gy) {
            // Reconstruct from goal back to start (exclusive)
            const path: Waypoint[] = [];
            let idx = idxOf(cur.tx, cur.ty);
            while (idx !== startIdx) {
                const tx = idx % gridW;
                const ty = (idx - tx) / gridW;
                path.unshift(tileCenter(tx, ty));
                const prev = cameFrom.get(idx);
                if (prev === undefined) break;
                idx = prev;
            }
            return path;
        }
        expanded++;
        const curIdx = idxOf(cur.tx, cur.ty);
        // Skip stale heap entries (node was re-pushed with lower f)
        const curG = gScore.get(curIdx);
        if (curG === undefined) continue;
        // Heuristic admissible, so if we already popped this node via a lower f we can skip now
        if (cur.f > curG + octileHeuristic(cur.tx, cur.ty, gx, gy) + 1e-9) continue;

        for (const [dx, dy, stepCost] of A_STAR_NEIGHBORS) {
            const nx = cur.tx + dx;
            const ny = cur.ty + dy;
            if (tileBlocked(nx, ny)) continue;
            // Disallow corner cutting: both orthogonals must be clear for diagonals
            if (dx !== 0 && dy !== 0) {
                if (tileBlocked(cur.tx + dx, cur.ty)) continue;
                if (tileBlocked(cur.tx, cur.ty + dy)) continue;
            }
            const tentativeG = curG + stepCost;
            const nIdx = idxOf(nx, ny);
            const existingG = gScore.get(nIdx);
            if (existingG === undefined || tentativeG < existingG) {
                gScore.set(nIdx, tentativeG);
                cameFrom.set(nIdx, curIdx);
                heapPush(open, {
                    f: tentativeG + octileHeuristic(nx, ny, gx, gy),
                    tx: nx, ty: ny
                });
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

    const stale = !state.pathNodes
        || !state.pathCreatedAt
        || now - state.pathCreatedAt > PATH_STALE_MS
        || pathExhausted
        || goalMoved;

    if (stale) {
        if (pathBudgetThisTick <= 0) return false;
        pathBudgetThisTick--;
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
    while (state.pathIndex! + 1 < state.pathNodes!.length) {
        const next = state.pathNodes![state.pathIndex! + 1];
        if (rayHitsWall(bot.x, bot.y, next.x, next.y)) break;
        state.pathIndex!++;
    }

    const wp = state.pathNodes![state.pathIndex!];
    const dx = wp.x - bot.x;
    const dy = wp.y - bot.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    driveMove(bot, dx / d, dy / d, speedMult, petalExt);
    return true;
}

// Per-bot strafe direction (+1 or -1). Deterministic so the bot commits to
// one circling direction instead of oscillating.
function tangentDirection(botId: string): number {
    // Simple hash: sum of char codes, parity picks direction
    let h = 0;
    for (let i = 0; i < botId.length; i++) h = (h + botId.charCodeAt(i)) | 0;
    return (h & 1) === 0 ? 1 : -1;
}

type Anchor = { x: number; y: number } | null;

function withinAnchor(anchor: Anchor, x: number, y: number, radius: number): boolean {
    if (!anchor) return true;
    const dx = anchor.x - x;
    const dy = anchor.y - y;
    return dx * dx + dy * dy <= radius * radius;
}

function pickBestEnemyTarget(
    bot: ServerPlayer,
    anchor: Anchor,
    tetherRadius: number,
    preferredTiers: Set<string>
): { enemy: typeof enemies[number]; dist: number } | null {
    // Score = priority * 10000 - distance, so bosses within their aggro range
    // beat every regular mob and the closer target wins among same tier.
    // Preferred-tier (matches bot's rarity progression) gets a +0.5 priority
    // bump so it beats same-tier-class unpreferred mobs, but never bosses.
    let best: typeof enemies[number] | null = null;
    let bestScore = -Infinity;
    let bestDist = 0;

    for (const enemy of enemies) {
        if (enemy.ownerId) continue;
        if ((enemy as any).isDead) continue;
        if (enemy.type === 'item_spawner') continue;
        if (enemy.type === 'target_dummy') continue;

        const isBoss = BOSS_TIERS.has(enemy.tier);

        // Tether applies to everything except bosses — bosses are raids and
        // bots are allowed to crowd up from across the map to fight them.
        if (!isBoss && !withinAnchor(anchor, enemy.x, enemy.y, tetherRadius)) continue;

        const range = aggroRangeForTier(enemy.tier);
        const dx = enemy.x - bot.x;
        const dy = enemy.y - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > range) continue;

        const priority = tierPriority(enemy.tier);
        const prefBonus = preferredTiers.has(enemy.tier) ? 0.5 : 0;
        const score = (priority + prefBonus) * 10000 - d;
        if (score > bestScore) {
            bestScore = score;
            best = enemy;
            bestDist = d;
        }
    }

    return best ? { enemy: best, dist: bestDist } : null;
}

function findPickupTarget(
    bot: ServerPlayer,
    anchor: Anchor,
    tetherRadius: number
): { item: typeof items[number]; dist: number } | null {
    let best: typeof items[number] | null = null;
    let bestDist = ITEM_SEEK_RANGE;

    for (const item of items) {
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
        if (d < bestDist) {
            bestDist = d;
            best = item;
        }
    }

    return best ? { item: best, dist: bestDist } : null;
}

// --- Mode detection ---

// Prefer uniques strictly; only consider supers if no uniques exist anywhere.
// Within the chosen tier, pick the nearest instance to this bot.
function pickRaidTargetGlobal(): { x: number; y: number; tier: string } | null {
    let bestUnique: typeof enemies[number] | null = null;
    let bestSuper: typeof enemies[number] | null = null;
    for (const enemy of enemies) {
        if (enemy.ownerId) continue;
        if ((enemy as any).isDead) continue;
        if (enemy.type === 'target_dummy') continue;
        if (enemy.tier === 'unique') {
            if (!bestUnique) bestUnique = enemy;
        } else if (enemy.tier === 'super') {
            if (!bestSuper) bestSuper = enemy;
        }
    }
    const pick = bestUnique ?? bestSuper;
    return pick ? { x: pick.x, y: pick.y, tier: pick.tier } : null;
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
        for (const enemy of enemies) {
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

    for (const enemy of enemies) {
        if (enemy.ownerId) continue;
        if ((enemy as any).isDead) continue;
        if (!BOSS_TIERS.has(enemy.tier)) continue;
        if (enemy.type === 'target_dummy') continue;
        if (announcedBosses.has(enemy.id)) continue;

        let announcerId: string | null = null;
        let bestD = Infinity;
        for (const pid in players) {
            if (!isBot(pid)) continue;
            const b = players[pid];
            if (!b || b.isDead) continue;
            const dx = b.x - enemy.x;
            const dy = b.y - enemy.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; announcerId = pid; }
        }
        if (!announcerId) return;

        const bot = players[announcerId];
        const tierWord = enemy.tier === 'unique' ? 'unique' : 'super';
        const pool = tierWord === 'unique' ? BOSS_SHOUT_TEMPLATES_UNIQUE : BOSS_SHOUT_TEMPLATES_SUPER;
        const shout = pool[Math.floor(Math.random() * pool.length)]
            .replace('{tier}', tierWord)
            .replace('{mob}', enemy.type.replace(/_/g, ' '));
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
        for (const e of enemies) {
            if (BOSS_TIERS.has(e.tier) && !(e as any).isDead) live.add(e.id);
        }
        for (const id of announcedBosses) {
            if (!live.has(id)) announcedBosses.delete(id);
        }
    }
}

function findNearestBossForBot(bot: ServerPlayer): { x: number; y: number; dist: number } | null {
    // Pass 1: look for uniques within raid range. Uniques always beat supers.
    let best: { x: number; y: number; dist: number } | null = null;
    let bestD = BOSS_RAID_RANGE;
    for (const enemy of enemies) {
        if (enemy.ownerId) continue;
        if ((enemy as any).isDead) continue;
        if (enemy.type === 'target_dummy') continue;
        if (enemy.tier !== 'unique') continue;
        const dx = enemy.x - bot.x;
        const dy = enemy.y - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) {
            bestD = d;
            best = { x: enemy.x, y: enemy.y, dist: d };
        }
    }
    if (best) return best;

    // Pass 2: no uniques nearby — fall back to supers.
    for (const enemy of enemies) {
        if (enemy.ownerId) continue;
        if ((enemy as any).isDead) continue;
        if (enemy.type === 'target_dummy') continue;
        if (enemy.tier !== 'super') continue;
        const dx = enemy.x - bot.x;
        const dy = enemy.y - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) {
            bestD = d;
            best = { x: enemy.x, y: enemy.y, dist: d };
        }
    }
    return best;
}

function hasHighRarityMobNearby(bot: ServerPlayer, range: number): boolean {
    const rSq = range * range;
    for (const enemy of enemies) {
        if (enemy.ownerId) continue;
        if ((enemy as any).isDead) continue;
        if (!HIGH_TIERS.has(enemy.tier)) continue;
        const dx = enemy.x - bot.x;
        const dy = enemy.y - bot.y;
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

    for (const id in players) {
        if (!isBot(id)) continue;
        const b = players[id];
        if (!b || b.isDead) continue;

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
    for (const id in players) {
        if (!isBot(id)) continue;
        const b = players[id];
        if (!b || b.isDead) continue;
        botIds.push(id);
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

function computeBotMode(bot: ServerPlayer, groups: Map<string, GroupInfo>): ModeContext {
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
    if (hasHighRarityMobNearby(bot, HIGH_RARITY_SCAN_RANGE)) {
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

    // Ultra+ bots roam mythic zones to hunt bosses. They ignore the normal
    // human tether because their "job" is to patrol where super/unique bosses
    // spawn, not to babysit humans farming lower-tier sections.
    const botRarityIdx = getBotMaxRarityIdx(bot);
    if (botRarityIdx >= ULTRA_IDX) {
        const zone = pickMythicZoneAnchor(bot);
        if (zone) {
            return {
                kind: 'normal',
                anchor: zone,
                tetherRadius: ULTRA_ROAM_RADIUS,
                returnRadius: ULTRA_ROAM_RETURN
            };
        }
    }

    // Normal: tether to nearest human player.
    const human = nearestRealPlayer(bot.x, bot.y);
    return {
        kind: 'normal',
        anchor: human ? { x: human.x, y: human.y } : null,
        tetherRadius: TETHER_RADIUS,
        returnRadius: TETHER_RETURN_RADIUS
    };
}

function driveMove(
    bot: ServerPlayer,
    dirX: number,
    dirY: number,
    speedMult: number,
    petalExtension: number
): void {
    bot.inputs.useMouse = true;
    bot.inputs.mouseDirectionX = dirX;
    bot.inputs.mouseDirectionY = dirY;
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
    for (const id in players) {
        if (!isBot(id)) continue;
        const bot = players[id];
        if (!bot || bot.isDead) continue;

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

        // Occasionally host a new public squad.
        if (Math.random() < BOT_SQUAD_CREATE_CHANCE) {
            const squad = createSquadFn(id, true);
            if (squad) {
                bot.squadId = squad.id;
            }
        }
    }
}

export function updateBotAI(io: SocketIOServer): void {
    const now = Date.now();
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

    for (const id in players) {
        if (!isBot(id)) continue;
        const bot = players[id];
        if (!bot) continue;

        let state = botAIState.get(id);
        if (!state) {
            state = { wanderTargetX: bot.x, wanderTargetY: bot.y, nextWanderTime: 0 };
            botAIState.set(id, state);
        }

        if (bot.isDead) {
            // Restore the combat loadout before respawn so the bot isn't stuck
            // with powder in slot 0 if it died mid-traversal.
            unequipRaidPowder(bot, state);
            if (state.respawnAt === undefined) {
                state.respawnAt = now + BOT_RESPAWN_DELAY_MS;
            } else if (now >= state.respawnAt) {
                respawnBot(bot, io);
            }
            continue;
        }

        const mode = computeBotMode(bot, groups);
        const anchor = mode.anchor;
        const anchorDist = anchor
            ? Math.sqrt((anchor.x - bot.x) ** 2 + (anchor.y - bot.y) ** 2)
            : 0;
        const preferredTiers = preferredMobTiersForBot(getBotMaxRarityIdx(bot));

        // Swap in a powder petal during raid traversal; restore combat loadout
        // once in engagement range (or when no longer raiding).
        if (mode.kind === 'raid' && anchorDist > RAID_POWDER_MIN_DIST) {
            equipRaidPowder(bot, state);
        } else {
            unequipRaidPowder(bot, state);
        }

        // Long-haul raid routing: hop through a teleporter when one puts the
        // bot meaningfully closer to the boss, or warp the bot to a spawn zone
        // in the boss's section if no teleporter helps.
        if (mode.kind === 'raid' && anchor && handleRaidShortcut(bot, state, now, anchor, anchorDist)) {
            continue;
        }

        const target = pickBestEnemyTarget(bot, anchor, mode.tetherRadius, preferredTiers);
        const isBossTarget = !!(target && BOSS_TIERS.has(target.enemy.tier));

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
        // Bosses are too valuable to flee — commit unless critically low
        const fleeThreshold = isBossTarget ? FLEE_HEALTH_RATIO * 0.5 : FLEE_HEALTH_RATIO;

        if (target && healthRatio < fleeThreshold) {
            const dx = bot.x - target.enemy.x;
            const dy = bot.y - target.enemy.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            driveMove(bot, dx / d, dy / d, 1.0, 0.7);
            continue;
        }

        if (target) {
            const dx = target.enemy.x - bot.x;
            const dy = target.enemy.y - bot.y;
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
            const standoff = petalReach - STANDOFF_SAFETY_BUFFER + mobRadius - 10;
            const dangerDist = PLAYER_SIZE / 2 + mobRadius + 6; // body-touch threshold

            let moveX: number;
            let moveY: number;
            let speedMult: number;
            let petalExt: number;

            // Boss raiders: each bot owns an angular slot around the boss so
            // they spread out instead of stacking. Kicks in once inside the
            // engagement band (d < standoff + 80); approach from farther away
            // still uses the direct-path logic below.
            const slotAngle = isBossTarget ? raidSlots.get(bot.id) : undefined;

            if (d < dangerDist) {
                // Too close — shove off at full speed but stay in attack state
                // so petals remain extended while killing the mob.
                moveX = -dirX;
                moveY = -dirY;
                speedMult = 1.0;
                petalExt = extendedPetalExt;
            } else if (slotAngle !== undefined && d < standoff + 80) {
                // Steer to the slot position around the boss. When the bot is
                // already at its slot, fall through to a small tangential
                // strafe so it isn't a sitting duck for AoE.
                const slotX = target.enemy.x + Math.cos(slotAngle) * standoff;
                const slotY = target.enemy.y + Math.sin(slotAngle) * standoff;
                const sx = slotX - bot.x;
                const sy = slotY - bot.y;
                const sd = Math.sqrt(sx * sx + sy * sy);
                if (sd > 40) {
                    moveX = sx / (sd || 1);
                    moveY = sy / (sd || 1);
                    speedMult = Math.min(0.8, 0.3 + sd / 400);
                } else {
                    const dir = tangentDirection(bot.id);
                    moveX = -dirY * dir;
                    moveY = dirX * dir;
                    speedMult = 0.2;
                }
                petalExt = extendedPetalExt;
            } else if (d < standoff - 8) {
                // Inside standoff but past the body-collision threshold — back
                // out while keeping petals trained on the mob.
                const dir = tangentDirection(bot.id);
                // 70% retreat + 30% strafe (deterministic direction)
                moveX = dirX * -0.7 + -dirY * dir * 0.3;
                moveY = dirY * -0.7 + dirX * dir * 0.3;
                speedMult = 0.6;
                petalExt = extendedPetalExt;
            } else if (d < standoff + 10) {
                // In the sweet spot — pure strafe, no forward/backward component
                // (deterministic per-bot direction so bots don't oscillate).
                const dir = tangentDirection(bot.id);
                moveX = -dirY * dir;
                moveY = dirX * dir;
                speedMult = 0.35;
                petalExt = extendedPetalExt;
            } else if (d < standoff + 80) {
                // Just outside reach — creep in slowly so we don't overshoot
                // the sweet spot under movement smoothing.
                moveX = dirX;
                moveY = dirY;
                speedMult = 0.35;
                petalExt = extendedPetalExt;
            } else {
                // Far away — close distance at full speed. Raid/group bots
                // use A* to navigate around wall clusters; normal bots use
                // the cheap steering probe.
                if (mode.kind !== 'normal' && followPath(bot, state, now, target.enemy.x, target.enemy.y, 0.95, extendedPetalExt)) {
                    continue;
                }
                const steered = steerAroundWalls(bot.x, bot.y, dirX, dirY);
                moveX = steered.x;
                moveY = steered.y;
                speedMult = 0.95;
                petalExt = extendedPetalExt;
            }

            driveMove(bot, moveX, moveY, speedMult, petalExt);
            continue;
        }

        // No combat target — try to grab a nearby drop we earned
        const pickup = findPickupTarget(bot, anchor, mode.tetherRadius);
        if (pickup) {
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

        // Wander — keep target inside the current cluster radius so raid/
        // group bots stay tight and normal bots stay tethered.
        if (now > state.nextWanderTime) {
            const center = anchor ?? { x: bot.x, y: bot.y };
            const angle = Math.random() * Math.PI * 2;
            const maxDist = Math.max(80, mode.tetherRadius - 100);
            const dist = Math.min(maxDist, 200) + Math.random() * Math.max(0, maxDist - 200);
            state.wanderTargetX = clampToWorld(center.x + Math.cos(angle) * dist, 100, ACTUAL_WORLD_WIDTH);
            state.wanderTargetY = clampToWorld(center.y + Math.sin(angle) * dist, 100, ACTUAL_WORLD_HEIGHT);
            state.nextWanderTime = now + 3000 + Math.random() * 4000;
        }

        const wdx = state.wanderTargetX - bot.x;
        const wdy = state.wanderTargetY - bot.y;
        const wd = Math.sqrt(wdx * wdx + wdy * wdy);

        if (wd < 30) {
            bot.inputs.useMouse = false;
            bot.inputs.keys = [];
            bot.inputs.petalExtension = 1.0;
            state.nextWanderTime = Math.min(state.nextWanderTime, now + 600);
        } else {
            // Steer around walls on wanders too, otherwise bots park against a
            // wall tile until nextWanderTime fires and the target is reshuffled.
            if (wd > WALL_TILE_SIZE) {
                const steered = steerAroundWalls(bot.x, bot.y, wdx / wd, wdy / wd);
                driveMove(bot, steered.x, steered.y, 0.55, 1.0);
            } else {
                driveMove(bot, wdx / wd, wdy / wd, 0.55, 1.0);
            }
        }
    }
}
