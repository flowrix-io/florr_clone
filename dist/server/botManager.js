"use strict";
// AI-controlled bots that fill empty player slots so the game always has ~20 players.
// Bots are regular ServerPlayer objects inserted into the shared `players` dict,
// so the existing tick, rendering, combat, and petal systems handle them with no
// special-casing beyond skipping save/save-game paths (no socket/userId).
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BOT_COUNT = void 0;
exports.setTargetBotCount = setTargetBotCount;
exports.getTargetBotCount = getTargetBotCount;
exports.isBot = isBot;
exports.removeAllBots = removeAllBots;
exports.maintainBotCount = maintainBotCount;
exports.triggerBotRaid = triggerBotRaid;
exports.updateBotAI = updateBotAI;
const constants_1 = require("../constants");
const map_data_1 = require("../map_data");
const petals_1 = require("../petals");
const mobs_1 = require("../mobs");
const playerManager_1 = require("./playerManager");
const gameState_1 = require("./gameState");
const BOT_ID_PREFIX = 'bot_';
const TARGET_TOTAL_PLAYERS = 23;
const MAINTAIN_INTERVAL_MS = 1500;
const SPAWN_BURST_CAP = 4;
exports.MAX_BOT_COUNT = 50;
// When set, maintainBotCount targets exactly this many bots regardless of how
// many real players are connected. null = default behavior (fill up to
// TARGET_TOTAL_PLAYERS minus real players).
let targetBotCountOverride = null;
function setTargetBotCount(count) {
    if (count === null) {
        targetBotCountOverride = null;
        return;
    }
    targetBotCountOverride = Math.max(0, Math.min(exports.MAX_BOT_COUNT, Math.floor(count)));
}
function getTargetBotCount() {
    return targetBotCountOverride;
}
// Combat tuning
const REGULAR_AGGRO_RANGE = 500; // common/uncommon/rare
const HIGH_TIER_AGGRO_RANGE = 900; // epic/legendary/mythic
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
const TETHER_RADIUS = 1400; // bot stays within this of its anchor
const TETHER_RETURN_RADIUS = 2200; // past this, drop whatever it's doing and regroup
const SPAWN_JITTER = 500; // jitter radius around spawn anchor
// Boss raiding: bosses ignore the tether so bots can converge across the map.
const BOSS_RAID_RANGE = 4000; // bots within this distance of a boss will raid
// Tight clump around the boss — sized so every raiding bot shares ~90% of
// its viewport with every other raider (10% of VIEWPORT_WIDTH / HEIGHT).
const RAID_CLUSTER_RADIUS = 90;
const RAID_CLUSTER_RETURN = 180;
// High-rarity (legendary+) zones: bots form sub-groups of 4-10 with a moderate
// clump, rather than clinging to the human or spreading out individually.
const HIGH_RARITY_SCAN_RANGE = 1200; // a legendary+ mob this close → high-rarity mode
const GROUP_CLUSTER_RADIUS = 500;
const GROUP_CLUSTER_RETURN = 900;
const GROUP_TARGET_SIZE = 7; // target group size (4-10 band)
const GROUP_MIN_FOR_MODE = 4; // don't enter group mode unless this many bots are in the group
// Raid targets only. Ultras are explicitly excluded — bots treat them as
// high-tier mobs, not raid rally points.
const BOSS_TIERS = new Set(['super', 'unique']);
const HIGH_TIERS = new Set(['epic', 'legendary', 'mythic', 'ultra']);
function tierPriority(tier) {
    if (!tier)
        return 0;
    // Unique ranks above super so raids always commit to uniques when both exist.
    if (tier === 'unique')
        return 4;
    if (tier === 'super')
        return 3;
    if (HIGH_TIERS.has(tier))
        return 2;
    return 1;
}
function aggroRangeForTier(tier) {
    if (!tier)
        return REGULAR_AGGRO_RANGE;
    // Boss raiding: much wider range so bots across the map can converge.
    if (BOSS_TIERS.has(tier))
        return BOSS_RAID_RANGE;
    if (HIGH_TIERS.has(tier))
        return HIGH_TIER_AGGRO_RANGE;
    return REGULAR_AGGRO_RANGE;
}
const BOT_NAMES = [
    'm28', 'M28', 'uwu', '67', 'Play Zorr.pro', '', '', 'petal',
    'super hunter', 'mark m28', 'Play florr.io', 'dev', 'fake dev', 'admin', 'pytorch', 'urmom', 'skibidi', 'florrio',
    'CraftApexPetal', 'developer'
];
const BOT_PETAL_POOL = ['basic', 'stinger', 'leaf', 'iris', 'faster', 'cutter', 'missile', 'bone', 'glass', 'dandelion', 'yggdrasil', 'rock', 'third_eye', 'rose'];
const botAIState = new Map();
let lastMaintainTime = 0;
let forcedRaid = null;
const FORCED_RAID_DURATION_MS = 45000; // 45s — enough for bots to traverse the map and engage
function isBot(id) {
    return id.startsWith(BOT_ID_PREFIX);
}
function generateBotId() {
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
const RARITY_WEIGHTS_BY_BAND = {
    0: [['common', 300], ['uncommon', 55], ['rare', 1]], // levels 1-10
    1: [['common', 40], ['uncommon', 24], ['rare', 15], ['epic', 2]], // levels 11-20
    2: [['common', 30], ['uncommon', 24], ['rare', 20], ['epic', 5]], // levels 21-30 (interpolated)
    3: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 5]], // levels 31-40
    4: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 1]], // levels 41-50
    5: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 4]], // levels 51-60
    6: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 11]], // levels 61-70
    7: [['common', 18], ['uncommon', 18], ['rare', 20], ['epic', 20], ['legendary', 15], ['mythic', 1]], // levels 71-80
    8: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 2]], // levels 81-90
    9: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 5]], // levels 91-100
    10: [['common', 40], ['uncommon', 40], ['rare', 40], ['epic', 40], ['legendary', 40], ['mythic', 17]], // levels 101-110
    11: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 11], ['ultra', 1]], // levels 111-120
    12: [['common', 40], ['uncommon', 40], ['rare', 40], ['epic', 40], ['legendary', 40], ['mythic', 40], ['ultra', 21], ['super', 1]], // levels 121-130
    13: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 20], ['ultra', 20], ['super', 20]], // levels 131-140
    14: [['common', 20], ['uncommon', 20], ['rare', 20], ['epic', 20], ['legendary', 20], ['mythic', 20], ['ultra', 20], ['super', 20], ['unique', 5]] // levels 141+
};
const CUMULATIVE_BY_BAND = {};
for (const bandKey of Object.keys(RARITY_WEIGHTS_BY_BAND)) {
    const band = Number(bandKey);
    const weights = RARITY_WEIGHTS_BY_BAND[band];
    const cumulative = [];
    const rarities = [];
    let acc = 0;
    for (const [rarity, w] of weights) {
        acc += w;
        cumulative.push(acc);
        rarities.push(rarity);
    }
    CUMULATIVE_BY_BAND[band] = { cumulative, rarities, total: acc };
}
const MAX_BAND = Math.max(...Object.keys(CUMULATIVE_BY_BAND).map(Number));
function pickRarityForLevel(level) {
    const rawBand = Math.floor(Math.max(1, level - 1) / LEVEL_BAND_SIZE);
    const band = Math.min(rawBand, MAX_BAND);
    const entry = CUMULATIVE_BY_BAND[band] || CUMULATIVE_BY_BAND[0];
    const roll = (Math.random() * 2) + entry.total - 2;
    for (let i = 0; i < entry.cumulative.length; i++) {
        if (roll < entry.cumulative[i])
            return entry.rarities[i];
    }
    return entry.rarities[entry.rarities.length - 1];
}
function rollBotLevel() {
    // Mix of low / mid / high tier levels so the bot population reflects a
    // realistic spread rather than clustering at the floor.
    // const r = Math.random();
    // if (r < 0.45) return Math.floor(Math.random() * 12) + 1;    // 1-12
    // if (r < 0.75) return Math.floor(Math.random() * 20) + 12;   // 12-31
    // if (r < 0.92) return Math.floor(Math.random() * 30) + 30;   // 30-59
    // return Math.floor(Math.random() * 50) + 60;                  // 60-109
    return Math.floor(Math.random() * 200 + 1);
}
function buildBotLoadout(level) {
    const loadout = [];
    // Fill all 10 slots so bots have a full active loadout (matches max real-
    // player capacity) rather than 5 equipped + 5 empty slots.
    for (let i = 0; i < 10; i++) {
        const petalType = BOT_PETAL_POOL[Math.floor(Math.random() * BOT_PETAL_POOL.length)];
        const rarity = pickRarityForLevel(level);
        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
        if (stats) {
            loadout.push({
                type: 'petal',
                rarity,
                petalType,
                health: stats.health,
                maxHealth: stats.health,
                onCooldown: false
            });
        }
        else {
            const fallback = (0, petals_1.getPetalStats)('basic', 'common');
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
function nearestRealPlayer(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const id in constants_1.players) {
        if (isBot(id))
            continue;
        const p = constants_1.players[id];
        if (!p || p.isDead)
            continue;
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
function getSpawnAnchorElements() {
    // Spawn zones and teleporters are the natural "entry points" of the map —
    // real players appear at these, so bots spawning here blend in and stay
    // close to where humans tend to be.
    return map_data_1.WORLD_MAP.filter(e => (e.type === 'spawn' || e.type === 'teleporter') && e.width > 0 && e.height > 0);
}
function pickBotSpawnPosition() {
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
                const inside = (0, playerManager_1.findSafeSpawnPosition)(baseArea, 10);
                if (inside)
                    return inside;
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
                const safe = (0, playerManager_1.findSafeSpawnPosition)(jitterArea, 4);
                if (safe)
                    return safe;
            }
        }
        // Final fallback: centre of a random anchor (scaled to world coords)
        const anchor = anchors[Math.floor(Math.random() * anchors.length)];
        return {
            x: (anchor.x + anchor.width / 2) * constants_1.SCALE_FACTOR,
            y: (anchor.y + anchor.height / 2) * constants_1.SCALE_FACTOR
        };
    }
    // No spawn zones configured — fall back to a world-wide safe spawn
    const safe = (0, playerManager_1.findSafeSpawnPosition)({ x: 0, y: 0, width: constants_1.ACTUAL_WORLD_WIDTH, height: constants_1.ACTUAL_WORLD_HEIGHT }, 30);
    if (safe)
        return safe;
    return {
        x: Math.random() * constants_1.ACTUAL_WORLD_WIDTH,
        y: Math.random() * constants_1.ACTUAL_WORLD_HEIGHT
    };
}
function pickBotName() {
    const base = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    return `${base}`;
}
function createBot(io) {
    const id = generateBotId();
    const level = rollBotLevel();
    const maxHealth = (0, playerManager_1.calculateMaxHealthFromLevel)(level);
    const damage = (0, playerManager_1.calculateDamageFromLevel)(level);
    const pos = pickBotSpawnPosition();
    const bot = {
        id,
        name: pickBotName(),
        x: pos.x,
        y: pos.y,
        angle: 0,
        score: 0,
        velocityX: 0,
        velocityY: 0,
        health: maxHealth,
        maxHealth,
        damage,
        inventory: (0, playerManager_1.createInitialInventory)(),
        loadout: buildBotLoadout(level),
        isInvulnerable: true,
        level,
        xp: 0,
        xpToNextLevel: (0, playerManager_1.calculateXPRequirement)(level),
        knockbackX: 0,
        knockbackY: 0,
        inputs: { keys: [], petalExtension: 1.0 },
        speed_boost: 1,
        isDead: false,
        skills: {},
        mobKills: {},
        stars: 0
    };
    constants_1.players[id] = bot;
    botAIState.set(id, {
        wanderTargetX: bot.x,
        wanderTargetY: bot.y,
        nextWanderTime: 0
    });
    setTimeout(() => {
        if (constants_1.players[id]) {
            constants_1.players[id].isInvulnerable = false;
            io.emit('playerInvulnerabilityEnded', { playerId: id });
        }
    }, BOT_SPAWN_INVULNERABILITY_MS);
    io.emit('newPlayer', bot);
    return bot;
}
function removeBot(id, io) {
    if (!isBot(id))
        return;
    if (!constants_1.players[id])
        return;
    delete constants_1.players[id];
    botAIState.delete(id);
    io.emit('playerDisconnected', id);
}
function removeAllBots(io) {
    const botIds = Object.keys(constants_1.players).filter(isBot);
    for (const id of botIds)
        removeBot(id, io);
}
function countBots() {
    let count = 0;
    for (const id in constants_1.players)
        if (isBot(id))
            count++;
    return count;
}
function listBotIds() {
    return Object.keys(constants_1.players).filter(isBot);
}
/**
 * Keep total player count near TARGET_TOTAL_PLAYERS by spawning/removing bots.
 * If there are no real (human) players, all bots are despawned to avoid wasted
 * simulation while nobody is watching.
 */
function maintainBotCount(io, realPlayerCount) {
    const now = Date.now();
    if (realPlayerCount === 0) {
        if (countBots() > 0)
            removeAllBots(io);
        return;
    }
    if (now - lastMaintainTime < MAINTAIN_INTERVAL_MS)
        return;
    lastMaintainTime = now;
    const currentBots = countBots();
    const desiredBots = targetBotCountOverride !== null
        ? targetBotCountOverride
        : Math.max(0, TARGET_TOTAL_PLAYERS - realPlayerCount);
    if (currentBots < desiredBots) {
        const deficit = desiredBots - currentBots;
        const toSpawn = Math.min(deficit, SPAWN_BURST_CAP);
        for (let i = 0; i < toSpawn; i++)
            createBot(io);
    }
    else if (currentBots > desiredBots) {
        const excess = currentBots - desiredBots;
        const ids = listBotIds().slice(0, excess);
        for (const id of ids)
            removeBot(id, io);
    }
}
function respawnBot(bot, io) {
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
                const stats = (0, petals_1.getPetalStats)(p.petalType, p.rarity);
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
        if (constants_1.players[bot.id]) {
            constants_1.players[bot.id].isInvulnerable = false;
            io.emit('playerInvulnerabilityEnded', { playerId: bot.id });
        }
    }, BOT_SPAWN_INVULNERABILITY_MS);
}
function clampToWorld(v, margin, max) {
    return Math.max(margin, Math.min(max - margin, v));
}
// Largest distance from bot center that a petal can still strike a target
// at, given petalExtension and this bot's equipped petals' size/range.
function computePetalReach(bot, petalExtension) {
    const baseRadius = 60 * petalExtension;
    let maxRangeMult = 1.0;
    let maxPetalHalfSize = 0;
    if (bot.loadout) {
        for (const item of bot.loadout) {
            if (!item || item.type !== 'petal' || !item.petalType || !item.rarity)
                continue;
            const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
            if (!stats)
                continue;
            const effectiveSize = item.customSize ?? stats.size ?? 1.0;
            maxPetalHalfSize = Math.max(maxPetalHalfSize, (40 * effectiveSize) / 2);
            if (stats.range !== undefined) {
                maxRangeMult = Math.max(maxRangeMult, stats.range);
            }
        }
    }
    return baseRadius * maxRangeMult + maxPetalHalfSize + STANDOFF_SAFETY_BUFFER;
}
function getMobRadius(enemy) {
    const stats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
    const size = stats?.size ?? 1.0;
    return (size * 40) / 2;
}
// --- Wall avoidance ---
// Cheap raycast against WALL_GRID. State 1 = wall, 2 = water — both block.
function rayHitsWall(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0)
        return false;
    // Sample every half-tile so we don't skip over a wall tile diagonally
    const step = constants_1.WALL_TILE_SIZE / 2;
    const steps = Math.ceil(dist / step);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + dx * t;
        const y = y0 + dy * t;
        const s = (0, constants_1.getTileState)(map_data_1.WALL_GRID, x, y);
        if (s === 1 || s === 2)
            return true;
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
function steerAroundWalls(fromX, fromY, dirX, dirY, probeDistance = constants_1.WALL_TILE_SIZE * 1.4) {
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
const PATH_WAYPOINT_REACHED_DIST = constants_1.WALL_TILE_SIZE * 0.55; // ~165 px
const PATH_STALE_MS = 5000;
const PATH_GOAL_INVALIDATE_TILES = 2;
let pathBudgetThisTick = PATH_MAX_PER_TICK;
const A_STAR_NEIGHBORS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
];
function tileBlocked(tx, ty) {
    if (ty < 0 || tx < 0)
        return true;
    if (ty >= map_data_1.WALL_GRID.length)
        return true;
    const row = map_data_1.WALL_GRID[ty];
    if (!row || tx >= row.length)
        return true;
    const s = row[tx];
    return s === 1 || s === 2;
}
function octileHeuristic(ax, ay, bx, by) {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}
function tileCenter(tx, ty) {
    return {
        x: tx * constants_1.WALL_TILE_SIZE + constants_1.WALL_TILE_SIZE / 2,
        y: ty * constants_1.WALL_TILE_SIZE + constants_1.WALL_TILE_SIZE / 2
    };
}
function heapPush(h, item) {
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (h[p].f <= h[i].f)
            break;
        const tmp = h[p];
        h[p] = h[i];
        h[i] = tmp;
        i = p;
    }
}
function heapPop(h) {
    if (h.length === 0)
        return undefined;
    const top = h[0];
    const last = h.pop();
    if (h.length === 0)
        return top;
    h[0] = last;
    let i = 0;
    const n = h.length;
    while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < n && h[l].f < h[s].f)
            s = l;
        if (r < n && h[r].f < h[s].f)
            s = r;
        if (s === i)
            break;
        const tmp = h[i];
        h[i] = h[s];
        h[s] = tmp;
        i = s;
    }
    return top;
}
// Snap a blocked goal tile to the nearest walkable tile within `maxR` rings.
function snapGoalToWalkable(gx, gy, maxR = 4) {
    if (!tileBlocked(gx, gy))
        return { gx, gy };
    for (let r = 1; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                // Only visit the shell at radius `r`
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                if (!tileBlocked(gx + dx, gy + dy)) {
                    return { gx: gx + dx, gy: gy + dy };
                }
            }
        }
    }
    return null;
}
function findPathAStar(startX, startY, goalX, goalY) {
    const gridW = (map_data_1.WALL_GRID[0]?.length ?? 0);
    if (gridW === 0 || map_data_1.WALL_GRID.length === 0)
        return null;
    const sx = (0, constants_1.worldToTileX)(startX);
    const sy = (0, constants_1.worldToTileY)(startY);
    let gx = (0, constants_1.worldToTileX)(goalX);
    let gy = (0, constants_1.worldToTileY)(goalY);
    const snapped = snapGoalToWalkable(gx, gy);
    if (!snapped)
        return null;
    gx = snapped.gx;
    gy = snapped.gy;
    if (sx === gx && sy === gy)
        return [];
    const idxOf = (tx, ty) => ty * gridW + tx;
    const gScore = new Map();
    const cameFrom = new Map();
    const open = [];
    const startIdx = idxOf(sx, sy);
    gScore.set(startIdx, 0);
    heapPush(open, { f: octileHeuristic(sx, sy, gx, gy), tx: sx, ty: sy });
    let expanded = 0;
    while (open.length > 0 && expanded < PATH_MAX_NODES) {
        const cur = heapPop(open);
        if (cur.tx === gx && cur.ty === gy) {
            // Reconstruct from goal back to start (exclusive)
            const path = [];
            let idx = idxOf(cur.tx, cur.ty);
            while (idx !== startIdx) {
                const tx = idx % gridW;
                const ty = (idx - tx) / gridW;
                path.unshift(tileCenter(tx, ty));
                const prev = cameFrom.get(idx);
                if (prev === undefined)
                    break;
                idx = prev;
            }
            return path;
        }
        expanded++;
        const curIdx = idxOf(cur.tx, cur.ty);
        // Skip stale heap entries (node was re-pushed with lower f)
        const curG = gScore.get(curIdx);
        if (curG === undefined)
            continue;
        // Heuristic admissible, so if we already popped this node via a lower f we can skip now
        if (cur.f > curG + octileHeuristic(cur.tx, cur.ty, gx, gy) + 1e-9)
            continue;
        for (const [dx, dy, stepCost] of A_STAR_NEIGHBORS) {
            const nx = cur.tx + dx;
            const ny = cur.ty + dy;
            if (tileBlocked(nx, ny))
                continue;
            // Disallow corner cutting: both orthogonals must be clear for diagonals
            if (dx !== 0 && dy !== 0) {
                if (tileBlocked(cur.tx + dx, cur.ty))
                    continue;
                if (tileBlocked(cur.tx, cur.ty + dy))
                    continue;
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
function followPath(bot, state, now, goalX, goalY, speedMult, petalExt) {
    const goalTx = (0, constants_1.worldToTileX)(goalX);
    const goalTy = (0, constants_1.worldToTileY)(goalY);
    const pathExhausted = !!state.pathNodes
        && state.pathIndex !== undefined
        && state.pathIndex >= state.pathNodes.length;
    const goalMoved = state.pathGoalTileX === undefined
        || Math.abs(state.pathGoalTileX - goalTx) > PATH_GOAL_INVALIDATE_TILES
        || Math.abs(state.pathGoalTileY - goalTy) > PATH_GOAL_INVALIDATE_TILES;
    const stale = !state.pathNodes
        || !state.pathCreatedAt
        || now - state.pathCreatedAt > PATH_STALE_MS
        || pathExhausted
        || goalMoved;
    if (stale) {
        if (pathBudgetThisTick <= 0)
            return false;
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
    while (state.pathIndex < state.pathNodes.length) {
        const wp = state.pathNodes[state.pathIndex];
        const dx = wp.x - bot.x;
        const dy = wp.y - bot.y;
        if (dx * dx + dy * dy < reachedSq) {
            state.pathIndex++;
        }
        else {
            break;
        }
    }
    if (state.pathIndex >= state.pathNodes.length)
        return false;
    const wp = state.pathNodes[state.pathIndex];
    const dx = wp.x - bot.x;
    const dy = wp.y - bot.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    driveMove(bot, dx / d, dy / d, speedMult, petalExt);
    return true;
}
// Per-bot strafe direction (+1 or -1). Deterministic so the bot commits to
// one circling direction instead of oscillating.
function tangentDirection(botId) {
    // Simple hash: sum of char codes, parity picks direction
    let h = 0;
    for (let i = 0; i < botId.length; i++)
        h = (h + botId.charCodeAt(i)) | 0;
    return (h & 1) === 0 ? 1 : -1;
}
function withinAnchor(anchor, x, y, radius) {
    if (!anchor)
        return true;
    const dx = anchor.x - x;
    const dy = anchor.y - y;
    return dx * dx + dy * dy <= radius * radius;
}
function pickBestEnemyTarget(bot, anchor, tetherRadius) {
    // Score = priority * 10000 - distance, so bosses within their aggro range
    // beat every regular mob and the closer target wins among same tier.
    let best = null;
    let bestScore = -Infinity;
    let bestDist = 0;
    for (const enemy of constants_1.enemies) {
        if (enemy.ownerId)
            continue;
        if (enemy.isDead)
            continue;
        if (enemy.type === 'item_spawner')
            continue;
        const isBoss = BOSS_TIERS.has(enemy.tier);
        // Tether applies to everything except bosses — bosses are raids and
        // bots are allowed to crowd up from across the map to fight them.
        if (!isBoss && !withinAnchor(anchor, enemy.x, enemy.y, tetherRadius))
            continue;
        const range = aggroRangeForTier(enemy.tier);
        const dx = enemy.x - bot.x;
        const dy = enemy.y - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > range)
            continue;
        const priority = tierPriority(enemy.tier);
        const score = priority * 10000 - d;
        if (score > bestScore) {
            bestScore = score;
            best = enemy;
            bestDist = d;
        }
    }
    return best ? { enemy: best, dist: bestDist } : null;
}
function findPickupTarget(bot, anchor, tetherRadius) {
    let best = null;
    let bestDist = ITEM_SEEK_RANGE;
    for (const item of gameState_1.items) {
        if (item.pickedUpBy && item.pickedUpBy.has(bot.id))
            continue;
        // Only chase items this bot is actually eligible for (it was a damage contributor)
        if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
            if (!item.eligiblePlayers.includes(bot.id))
                continue;
        }
        // Don't chase drops that would drag the bot outside the cluster
        if (!withinAnchor(anchor, item.x, item.y, tetherRadius))
            continue;
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
function pickRaidTargetGlobal() {
    let bestUnique = null;
    let bestSuper = null;
    for (const enemy of constants_1.enemies) {
        if (enemy.ownerId)
            continue;
        if (enemy.isDead)
            continue;
        if (enemy.tier === 'unique') {
            if (!bestUnique)
                bestUnique = enemy;
        }
        else if (enemy.tier === 'super') {
            if (!bestSuper)
                bestSuper = enemy;
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
function triggerBotRaid() {
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
function getActiveForcedRaidAnchor() {
    if (!forcedRaid)
        return null;
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
function findNearestBossForBot(bot) {
    // Pass 1: look for uniques within raid range. Uniques always beat supers.
    let best = null;
    let bestD = BOSS_RAID_RANGE;
    for (const enemy of constants_1.enemies) {
        if (enemy.ownerId)
            continue;
        if (enemy.isDead)
            continue;
        if (enemy.tier !== 'unique')
            continue;
        const dx = enemy.x - bot.x;
        const dy = enemy.y - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) {
            bestD = d;
            best = { x: enemy.x, y: enemy.y, dist: d };
        }
    }
    if (best)
        return best;
    // Pass 2: no uniques nearby — fall back to supers.
    for (const enemy of constants_1.enemies) {
        if (enemy.ownerId)
            continue;
        if (enemy.isDead)
            continue;
        if (enemy.tier !== 'super')
            continue;
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
function hasHighRarityMobNearby(bot, range) {
    const rSq = range * range;
    for (const enemy of constants_1.enemies) {
        if (enemy.ownerId)
            continue;
        if (enemy.isDead)
            continue;
        if (!HIGH_TIERS.has(enemy.tier))
            continue;
        const dx = enemy.x - bot.x;
        const dy = enemy.y - bot.y;
        if (dx * dx + dy * dy <= rSq)
            return true;
    }
    return false;
}
function computeBotGroups() {
    const botIds = [];
    for (const id in constants_1.players) {
        if (!isBot(id))
            continue;
        const b = constants_1.players[id];
        if (!b || b.isDead)
            continue;
        botIds.push(id);
    }
    if (botIds.length === 0)
        return new Map();
    botIds.sort(); // stable assignment across ticks
    const numGroups = Math.max(1, Math.ceil(botIds.length / GROUP_TARGET_SIZE));
    const buckets = Array.from({ length: numGroups }, () => []);
    // Round-robin so groups stay balanced (4-10 members each) when counts shift.
    for (let i = 0; i < botIds.length; i++) {
        buckets[i % numGroups].push(botIds[i]);
    }
    const result = new Map();
    for (const bucket of buckets) {
        if (bucket.length === 0)
            continue;
        let cx = 0, cy = 0;
        for (const id of bucket) {
            const p = constants_1.players[id];
            cx += p.x;
            cy += p.y;
        }
        cx /= bucket.length;
        cy /= bucket.length;
        const info = { center: { x: cx, y: cy }, size: bucket.length };
        for (const id of bucket)
            result.set(id, info);
    }
    return result;
}
function computeBotMode(bot, groups) {
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
    // Normal: tether to nearest human player.
    const human = nearestRealPlayer(bot.x, bot.y);
    return {
        kind: 'normal',
        anchor: human ? { x: human.x, y: human.y } : null,
        tetherRadius: TETHER_RADIUS,
        returnRadius: TETHER_RETURN_RADIUS
    };
}
function driveMove(bot, dirX, dirY, speedMult, petalExtension) {
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
function updateBotAI(io) {
    const now = Date.now();
    // Reset the per-tick A* budget so a single tick can't be dominated by
    // simultaneous recomputes (e.g., a whole raid repathing at once).
    pathBudgetThisTick = PATH_MAX_PER_TICK;
    // Bot groupings are only needed for highRarity mode but it's cheaper to
    // build once and reuse than recompute per-bot.
    const groups = computeBotGroups();
    for (const id in constants_1.players) {
        if (!isBot(id))
            continue;
        const bot = constants_1.players[id];
        if (!bot)
            continue;
        let state = botAIState.get(id);
        if (!state) {
            state = { wanderTargetX: bot.x, wanderTargetY: bot.y, nextWanderTime: 0 };
            botAIState.set(id, state);
        }
        if (bot.isDead) {
            if (state.respawnAt === undefined) {
                state.respawnAt = now + BOT_RESPAWN_DELAY_MS;
            }
            else if (now >= state.respawnAt) {
                respawnBot(bot, io);
            }
            continue;
        }
        const mode = computeBotMode(bot, groups);
        const anchor = mode.anchor;
        const anchorDist = anchor
            ? Math.sqrt((anchor.x - bot.x) ** 2 + (anchor.y - bot.y) ** 2)
            : 0;
        const target = pickBestEnemyTarget(bot, anchor, mode.tetherRadius);
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
            // Stay a notch inside max reach so small position jitter still lands hits
            const standoff = petalReach + mobRadius - 10;
            const dangerDist = constants_1.PLAYER_SIZE / 2 + mobRadius + 6; // body-touch threshold
            let moveX;
            let moveY;
            let speedMult;
            let petalExt;
            if (d < dangerDist) {
                // Too close — shove off at full speed but stay in attack state
                // so petals remain extended while killing the mob.
                moveX = -dirX;
                moveY = -dirY;
                speedMult = 1.0;
                petalExt = extendedPetalExt;
            }
            else if (d < standoff - 8) {
                // Inside standoff but past the body-collision threshold — back
                // out while keeping petals trained on the mob.
                const dir = tangentDirection(bot.id);
                // 70% retreat + 30% strafe (deterministic direction)
                moveX = dirX * -0.7 + -dirY * dir * 0.3;
                moveY = dirY * -0.7 + dirX * dir * 0.3;
                speedMult = 0.6;
                petalExt = extendedPetalExt;
            }
            else if (d < standoff + 10) {
                // In the sweet spot — pure strafe, no forward/backward component
                // (deterministic per-bot direction so bots don't oscillate).
                const dir = tangentDirection(bot.id);
                moveX = -dirY * dir;
                moveY = dirX * dir;
                speedMult = 0.35;
                petalExt = extendedPetalExt;
            }
            else if (d < standoff + 80) {
                // Just outside reach — creep in slowly so we don't overshoot
                // the sweet spot under movement smoothing.
                moveX = dirX;
                moveY = dirY;
                speedMult = 0.35;
                petalExt = extendedPetalExt;
            }
            else {
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
            if (d > constants_1.WALL_TILE_SIZE) {
                const steered = steerAroundWalls(bot.x, bot.y, dx / d, dy / d);
                driveMove(bot, steered.x, steered.y, 0.9, 1.0);
            }
            else {
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
            state.wanderTargetX = clampToWorld(center.x + Math.cos(angle) * dist, 100, constants_1.ACTUAL_WORLD_WIDTH);
            state.wanderTargetY = clampToWorld(center.y + Math.sin(angle) * dist, 100, constants_1.ACTUAL_WORLD_HEIGHT);
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
        }
        else {
            // Steer around walls on wanders too, otherwise bots park against a
            // wall tile until nextWanderTime fires and the target is reshuffled.
            if (wd > constants_1.WALL_TILE_SIZE) {
                const steered = steerAroundWalls(bot.x, bot.y, wdx / wd, wdy / wd);
                driveMove(bot, steered.x, steered.y, 0.55, 1.0);
            }
            else {
                driveMove(bot, wdx / wd, wdy / wd, 0.55, 1.0);
            }
        }
    }
}
