"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateMazeMobPool = invalidateMazeMobPool;
exports.hasMazePlayers = hasMazePlayers;
exports.spawnMazeMobs = spawnMazeMobs;
exports.spawnMazeBosses = spawnMazeBosses;
exports.clearMazeEnemies = clearMazeEnemies;
const server_utils_1 = require("../server_utils");
const constants_1 = require("../constants");
const mobs_1 = require("../mobs");
const enemySpawner_1 = require("./enemySpawner");
const enemyGrid_1 = require("./enemyGrid");
const maze_1 = require("../maze");
// Population control. Unlike the open world (which only populates viewports),
// the maze is a bounded dungeon populated rrolf-style: mobs spawn across ALL
// corridors and persist while anyone is inside (despawnDistantEnemies exempts
// them via hasMazePlayers), so exploring deeper always finds mobs — not just
// a bubble around wherever the player happened to spawn in.
//
// The target is AREA-based, not per-player: the maze should feel equally
// dense for one explorer as for five. Derived from the open world's density
// constant so the corridors carry EXACTLY the same mobs-per-walkable-pixel as
// the regular map (~0.9 mobs per 600x600 floor cell, ~1300 mobs total) and
// stay in sync if the world density is ever retuned.
const MAZE_MOBS_PER_FLOOR_CELL = constants_1.ORIGINAL_ENEMY_DENSITY * maze_1.MAZE_CELL_SIZE * maze_1.MAZE_CELL_SIZE;
const MAX_MAZE_MOBS = 1500; // runaway guard above the derived target
const MIN_SPAWN_DISTANCE_FROM_PLAYER = 1200; // avoid on-screen pop-in
const MIN_SPAWN_DISTANCE_FROM_MOB = 100;
// Floor-cell count of the active maze, cached per day (the layout is static
// for the day, so this only recomputes on rotation).
let floorCellCacheDay = -1;
let floorCellCount = 0;
function getMazePopulationTarget() {
    const maze = (0, maze_1.getActiveMaze)();
    if (!maze)
        return 0;
    if (maze.dayNumber !== floorCellCacheDay) {
        let count = 0;
        for (let i = 0; i < maze.values.length; i++) {
            const v = maze.values[i];
            if (v === 1 || (v >= 4 && v <= 7))
                count++;
        }
        floorCellCount = count;
        floorCellCacheDay = maze.dayNumber;
    }
    return Math.min(MAX_MAZE_MOBS, Math.round(floorCellCount * MAZE_MOBS_PER_FLOOR_CELL));
}
// Ultra mobs are the maze bosses: kept alive in the deepest (mythic) rooms.
const MAZE_BOSS_COUNT = 2;
// Mob types that never spawn in the maze even if their section matches: wave
// spawners would flood the corridors, and utility mobs make no sense here.
const MAZE_EXCLUDED_TYPES = new Set(['ant_hole', 'fire_ant_hole', 'target_dummy', 'item_spawner', 'garbage']);
const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
let poolBiome = null;
let poolTypes = [];
/** Mob pool for the current maze biome (garden/desert/ocean section rosters). */
function getMazeMobPool() {
    const maze = (0, maze_1.getActiveMaze)();
    if (!maze)
        return [];
    if (poolBiome === maze.biome && poolTypes.length > 0)
        return poolTypes;
    const section = maze_1.MAZE_BIOME_SECTIONS[maze.biome];
    poolTypes = (0, mobs_1.getAllMobTypes)()
        .filter(type => {
        if (MAZE_EXCLUDED_TYPES.has(type))
            return false;
        if ((0, server_utils_1.isCentipedeBodyType)(type))
            return false;
        const stats = (0, mobs_1.getMobStats)(type, 'common');
        return !!stats && stats.section.includes(section);
    })
        .map(type => ({
        type,
        weight: (0, mobs_1.getMobStats)(type, 'common')?.spawn_weight ?? 1,
    }));
    poolBiome = maze.biome;
    return poolTypes;
}
/** Drop the cached pool (called on daily rotation so the biome roster swaps). */
function invalidateMazeMobPool() {
    poolBiome = null;
    poolTypes = [];
}
function pickWeighted(pool) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll <= 0)
            return entry;
    }
    return pool[pool.length - 1];
}
function getMazePlayerIds() {
    const ids = [];
    for (const id in constants_1.players) {
        if (id.startsWith('bot_'))
            continue;
        const p = constants_1.players[id];
        if (p?.inMaze && !p.isDead)
            ids.push(id);
    }
    return ids;
}
/** True while at least one live player is inside the maze. Used by the
 *  distant-enemy despawner to keep the maze persistently populated. */
function hasMazePlayers() {
    return getMazePlayerIds().length > 0;
}
function countMazeMobs() {
    let total = 0;
    let ultras = 0;
    for (const enemy of constants_1.enemies) {
        if (enemy.ownerId)
            continue; // pets don't count against the population
        if (!(0, maze_1.isInMazeRegion)(enemy.x, enemy.y))
            continue;
        total++;
        // Centipede body segments share the head's tier — only the head counts
        // as a boss, or one ultra centipede (1 head + 9 bodies) would satisfy
        // the boss cap several times over and starve the other boss room.
        if ((0, server_utils_1.isCentipedeBodyType)(enemy.type))
            continue;
        if (TIER_ORDER.indexOf(enemy.tier) >= TIER_ORDER.indexOf('ultra'))
            ultras++;
    }
    return { total, ultras };
}
const _spawnQueryScratch = [];
function isTooCloseToPlayersOrMobs(x, y, mobRadius) {
    for (const id in constants_1.players) {
        const p = constants_1.players[id];
        if (!p?.inMaze)
            continue;
        const dx = p.x - x, dy = p.y - y;
        if (dx * dx + dy * dy < MIN_SPAWN_DISTANCE_FROM_PLAYER * MIN_SPAWN_DISTANCE_FROM_PLAYER)
            return true;
    }
    // Spatial-grid query instead of an all-enemies scan: at full maze density
    // (~1300 mobs) a linear pass per placement attempt would make the fill
    // burst quadratic. Caller refreshes the grid once per spawn batch.
    const reach = mobRadius + (0, enemyGrid_1.getMaxEnemyRadius)() + MIN_SPAWN_DISTANCE_FROM_MOB;
    const nearby = (0, enemyGrid_1.queryEnemiesNear)(x, y, reach, _spawnQueryScratch);
    for (const enemy of nearby) {
        const otherStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const otherRadius = otherStats ? (otherStats.size * 40) / 2 : 20;
        const dx = enemy.x - x, dy = enemy.y - y;
        const minDist = mobRadius + otherRadius + MIN_SPAWN_DISTANCE_FROM_MOB;
        if (dx * dx + dy * dy < minDist * minDist)
            return true;
    }
    return false;
}
/** Mob body clearance: the centre plus 4 compass points must all be floor. */
function mazeBodyFits(x, y, mobRadius) {
    if (!(0, maze_1.isMazeFloorAtWorld)(x, y))
        return false;
    const r = Math.min(mobRadius, maze_1.MAZE_CELL_SIZE - 10);
    return (0, maze_1.isMazeFloorAtWorld)(x - r, y) && (0, maze_1.isMazeFloorAtWorld)(x + r, y) &&
        (0, maze_1.isMazeFloorAtWorld)(x, y - r) && (0, maze_1.isMazeFloorAtWorld)(x, y + r);
}
/**
 * Pick a walkable corridor position anywhere in the maze (uniform over floor
 * cells), clear of walls for the mob's body and not right next to a player.
 */
function findMazeSpawnPosition(mobRadius) {
    const maze = (0, maze_1.getActiveMaze)();
    if (!maze)
        return null;
    for (let attempt = 0; attempt < 40; attempt++) {
        const gx = Math.floor(Math.random() * maze.gridDim);
        const gy = Math.floor(Math.random() * maze.gridDim);
        if (maze.values[gy * maze.gridDim + gx] !== 1)
            continue; // plain floor cells only
        const x = maze_1.MAZE_ORIGIN_X + (gx + 0.2 + Math.random() * 0.6) * maze_1.MAZE_CELL_SIZE;
        const y = maze_1.MAZE_ORIGIN_Y + (gy + 0.2 + Math.random() * 0.6) * maze_1.MAZE_CELL_SIZE;
        if (!mazeBodyFits(x, y, mobRadius))
            continue;
        if (isTooCloseToPlayersOrMobs(x, y, mobRadius))
            continue;
        return { x, y };
    }
    return null;
}
function buildEnemy(type, tier, x, y) {
    const stats = (0, mobs_1.getMobStats)(type, tier);
    if (!stats)
        return null;
    const currentTime = Date.now();
    return {
        id: Math.random().toString(36).slice(2, 11),
        type: type,
        tier,
        x,
        y,
        angle: Math.random() * Math.PI * 2,
        health: stats.health,
        maxHealth: stats.health,
        speed: stats.speed,
        damage: stats.damage,
        knockbackX: 0,
        knockbackY: 0,
        aiType: stats.ai_type,
        range: stats.range,
        reversed: stats.reversed ?? false,
        spawnTime: currentTime,
        lastViewportCheck: currentTime,
    };
}
/**
 * Keep the maze corridors populated. Tier comes from the depth zone the spawn
 * position lands in (common at the entrance through mythic at the deepest
 * corridors), with a little jitter. Returns the newly created enemies —
 * caller appends them to the global `enemies` array.
 */
function spawnMazeMobs(limit = 3) {
    const maze = (0, maze_1.getActiveMaze)();
    if (!maze)
        return [];
    const mazePlayerIds = getMazePlayerIds();
    if (mazePlayerIds.length === 0)
        return [];
    const pool = getMazeMobPool();
    if (pool.length === 0)
        return [];
    const { total } = countMazeMobs();
    const target = getMazePopulationTarget();
    const needed = Math.min(limit, target - total);
    if (needed <= 0)
        return [];
    // Fresh broad-phase grid for the too-close checks below (the tick loop
    // rebuilds it too, but this call runs on its own interval).
    (0, enemyGrid_1.rebuildEnemyGrid)(constants_1.enemies);
    const spawned = [];
    for (let i = 0; i < needed; i++) {
        const mobEntry = pickWeighted(pool);
        const prelimStats = (0, mobs_1.getMobStats)(mobEntry.type, 'common');
        const mobRadius = prelimStats ? (prelimStats.size * 40) / 2 : 20;
        const position = findMazeSpawnPosition(mobRadius);
        if (!position)
            continue;
        // Depth zone → tier, with a small up/down jitter (never above mythic;
        // ultras are reserved for the boss spawner).
        const zone = (0, maze_1.getMazeZoneAtWorld)(position.x, position.y);
        if (zone < 0)
            continue;
        let tierIndex = zone;
        const roll = Math.random();
        if (roll < 0.08)
            tierIndex = Math.min(maze_1.MAZE_ZONE_TIERS.length - 1, tierIndex + 1);
        else if (roll < 0.28)
            tierIndex = Math.max(0, tierIndex - 1);
        const tier = maze_1.MAZE_ZONE_TIERS[tierIndex];
        // Re-check body clearance with the ACTUAL tier's size — higher tiers
        // are much bigger than the common-size estimate used for placement.
        const tierStats = (0, mobs_1.getMobStats)(mobEntry.type, tier);
        const tierRadius = tierStats ? (tierStats.size * 40) / 2 : mobRadius;
        if (tierRadius > mobRadius && !mazeBodyFits(position.x, position.y, tierRadius))
            continue;
        const enemy = buildEnemy(mobEntry.type, tier, position.x, position.y);
        if (!enemy)
            continue;
        spawned.push(enemy);
    }
    return spawned;
}
/**
 * Ultra mobs are the maze bosses: keep MAZE_BOSS_COUNT of them alive in the
 * mythic-zone boss rooms while anyone is inside the maze. Returns created
 * bosses (with any centipede body segments already chained via the shared
 * helper) — caller appends the returned heads to `enemies`; body segments are
 * appended by spawnCentipedeBodySegments itself.
 */
function spawnMazeBosses() {
    const maze = (0, maze_1.getActiveMaze)();
    if (!maze || maze.bossSpots.length === 0)
        return [];
    if (getMazePlayerIds().length === 0)
        return [];
    const { ultras } = countMazeMobs();
    let toSpawn = MAZE_BOSS_COUNT - ultras;
    if (toSpawn <= 0)
        return [];
    const pool = getMazeMobPool();
    if (pool.length === 0)
        return [];
    const spawned = [];
    for (const spot of maze.bossSpots) {
        if (toSpawn <= 0)
            break;
        // Don't drop a boss on someone's head.
        let playerNearby = false;
        for (const id in constants_1.players) {
            const p = constants_1.players[id];
            if (!p?.inMaze)
                continue;
            const dx = p.x - spot.x, dy = p.y - spot.y;
            if (dx * dx + dy * dy < 1200 * 1200) {
                playerNearby = true;
                break;
            }
        }
        if (playerNearby)
            continue;
        // One boss per room.
        let bossHere = false;
        for (const enemy of constants_1.enemies) {
            if ((0, server_utils_1.isCentipedeBodyType)(enemy.type))
                continue;
            if (TIER_ORDER.indexOf(enemy.tier) < TIER_ORDER.indexOf('ultra'))
                continue;
            const dx = enemy.x - spot.x, dy = enemy.y - spot.y;
            if (dx * dx + dy * dy < 2000 * 2000) {
                bossHere = true;
                break;
            }
        }
        if (bossHere)
            continue;
        const mobEntry = pickWeighted(pool);
        const boss = buildEnemy(mobEntry.type, 'ultra', spot.x, spot.y);
        if (!boss)
            continue;
        if ((0, server_utils_1.isCentipedeHeadType)(boss.type)) {
            (0, enemySpawner_1.spawnCentipedeBodySegments)(boss);
        }
        spawned.push(boss);
        toSpawn--;
    }
    return spawned;
}
/**
 * Remove every mob inside the maze region (used on daily rotation — the new
 * layout would strand yesterday's mobs inside walls). Returns removed ids.
 */
function clearMazeEnemies() {
    const removed = [];
    for (let i = constants_1.enemies.length - 1; i >= 0; i--) {
        const enemy = constants_1.enemies[i];
        if ((0, maze_1.isInMazeRegion)(enemy.x, enemy.y)) {
            removed.push(enemy.id);
            constants_1.enemies.splice(i, 1);
        }
    }
    return removed;
}
