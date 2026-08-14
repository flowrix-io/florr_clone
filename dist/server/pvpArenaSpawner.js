"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnArenaMobs = spawnArenaMobs;
const constants_1 = require("../constants");
const mobs_1 = require("../mobs");
const weighted_1 = require("./shared/weighted");
const enemyRegistry_1 = require("./enemyRegistry");
// Garden-themed mobs + spider. Weights control relative spawn frequency.
// Spider is intentionally rarer — it's the standout threat in the arena.
const ARENA_MOB_POOL = [
    { type: 'bee', weight: 3 },
    { type: 'ladybug', weight: 3 },
    { type: 'rock', weight: 2 },
    { type: 'dandelion', weight: 2 },
    { type: 'soldier_ant', weight: 2 },
    { type: 'hornet', weight: 1 },
    { type: 'spider', weight: 1 },
];
const ARENA_TIER_WEIGHTS = [
    { tier: 'common', weight: 0.40 },
    { tier: 'uncommon', weight: 0.30 },
    { tier: 'rare', weight: 0.18 },
    { tier: 'epic', weight: 0.08 },
    { tier: 'legendary', weight: 0.03 },
    { tier: 'mythic', weight: 0.01 },
];
// Keep the arena populated but not overcrowded. Scales with active fighters.
const MOBS_PER_PLAYER = 12;
const MAX_ARENA_MOBS = 60;
const MIN_SPAWN_DISTANCE_FROM_PLAYER = 300;
const MIN_SPAWN_DISTANCE_FROM_MOB = 80;
function countArenaPlayers() {
    let count = 0;
    for (const id in constants_1.players) {
        if (id.startsWith('bot_'))
            continue;
        if (constants_1.players[id]?.inPvpArena)
            count++;
    }
    return count;
}
function countArenaMobs() {
    let count = 0;
    for (const enemy of constants_1.enemies) {
        if ((0, constants_1.isInPvpArena)(enemy.x, enemy.y))
            count++;
    }
    return count;
}
function findArenaSpawnPosition(mobRadius) {
    // Keep mobs fully inside the arena so they don't clip the boundary ring.
    const maxR = constants_1.PVP_ARENA_RADIUS - mobRadius - 40;
    for (let attempt = 0; attempt < 40; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * maxR;
        const x = constants_1.PVP_ARENA_CENTER_X + Math.cos(angle) * radius;
        const y = constants_1.PVP_ARENA_CENTER_Y + Math.sin(angle) * radius;
        // Don't spawn right next to a player.
        let tooCloseToPlayer = false;
        for (const id in constants_1.players) {
            const p = constants_1.players[id];
            if (!p?.inPvpArena)
                continue;
            const dx = p.x - x;
            const dy = p.y - y;
            if (dx * dx + dy * dy < MIN_SPAWN_DISTANCE_FROM_PLAYER * MIN_SPAWN_DISTANCE_FROM_PLAYER) {
                tooCloseToPlayer = true;
                break;
            }
        }
        if (tooCloseToPlayer)
            continue;
        // Don't pile on top of another mob.
        let tooCloseToMob = false;
        for (const enemy of constants_1.enemies) {
            if (!(0, constants_1.isInPvpArena)(enemy.x, enemy.y))
                continue;
            const otherStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
            const otherRadius = otherStats ? (otherStats.size * 40) / 2 : 20;
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            const minDist = mobRadius + otherRadius + MIN_SPAWN_DISTANCE_FROM_MOB;
            if (dx * dx + dy * dy < minDist * minDist) {
                tooCloseToMob = true;
                break;
            }
        }
        if (tooCloseToMob)
            continue;
        return { x, y };
    }
    return null;
}
/**
 * Spawn up to `limit` mobs this tick to keep the arena populated.
 *
 * Mobs are admitted by `spawnEnemy` as they are created (entity + `enemies[]`);
 * the return value is the count, for logging and pacing.
 */
function spawnArenaMobs(limit = 3) {
    const arenaPlayers = countArenaPlayers();
    if (arenaPlayers === 0)
        return 0;
    const target = Math.min(MAX_ARENA_MOBS, arenaPlayers * MOBS_PER_PLAYER);
    const current = countArenaMobs();
    const needed = Math.min(limit, target - current);
    if (needed <= 0)
        return 0;
    let spawned = 0;
    for (let i = 0; i < needed; i++) {
        const mobEntry = (0, weighted_1.pickWeighted)(ARENA_MOB_POOL);
        const tierEntry = (0, weighted_1.pickWeighted)(ARENA_TIER_WEIGHTS);
        const stats = (0, mobs_1.getMobStats)(mobEntry.type, tierEntry.tier);
        if (!stats)
            continue;
        const mobRadius = (stats.size * 40) / 2;
        const position = findArenaSpawnPosition(mobRadius);
        if (!position)
            continue;
        if ((0, enemyRegistry_1.spawnEnemy)(mobEntry.type, tierEntry.tier, position.x, position.y))
            spawned++;
    }
    return spawned;
}
