import { Enemy, isCentipedeHeadType, isCentipedeBodyType } from '../server_utils';
import { players, enemies, ORIGINAL_ENEMY_DENSITY } from '../constants';
import { getMobStats, getAllMobTypes } from '../mobs';
import { spawnCentipedeBodySegments } from './enemySpawner';
import { rebuildEnemyGrid, queryEnemiesNear, getMaxEnemyRadius } from './enemyGrid';
import {
    getActiveMaze,
    isInMazeRegion,
    isMazeFloorAtWorld,
    getMazeZoneAtWorld,
    MazeBiome,
    MAZE_BIOME_SECTIONS,
    MAZE_ZONE_TIERS,
    MAZE_CELL_SIZE,
    MAZE_ORIGIN_X,
    MAZE_ORIGIN_Y
} from '../maze';

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
const MAZE_MOBS_PER_FLOOR_CELL = ORIGINAL_ENEMY_DENSITY * MAZE_CELL_SIZE * MAZE_CELL_SIZE;
const MAX_MAZE_MOBS = 1500; // runaway guard above the derived target
const MIN_SPAWN_DISTANCE_FROM_PLAYER = 1200; // avoid on-screen pop-in
const MIN_SPAWN_DISTANCE_FROM_MOB = 100;

// Floor-cell count of the active maze, cached per day (the layout is static
// for the day, so this only recomputes on rotation).
let floorCellCacheDay = -1;
let floorCellCount = 0;

function getMazePopulationTarget(): number {
    const maze = getActiveMaze();
    if (!maze) return 0;
    if (maze.dayNumber !== floorCellCacheDay) {
        let count = 0;
        for (let i = 0; i < maze.values.length; i++) {
            const v = maze.values[i];
            if (v === 1 || (v >= 4 && v <= 7)) count++;
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

const TIER_ORDER: Enemy['tier'][] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];

let poolBiome: MazeBiome | null = null;
let poolTypes: Array<{ type: string; weight: number }> = [];

/** Mob pool for the current maze biome (garden/desert/ocean section rosters). */
function getMazeMobPool(): Array<{ type: string; weight: number }> {
    const maze = getActiveMaze();
    if (!maze) return [];
    if (poolBiome === maze.biome && poolTypes.length > 0) return poolTypes;
    const section = MAZE_BIOME_SECTIONS[maze.biome];
    poolTypes = getAllMobTypes()
        .filter(type => {
            if (MAZE_EXCLUDED_TYPES.has(type)) return false;
            if (isCentipedeBodyType(type)) return false;
            const stats = getMobStats(type, 'common');
            return !!stats && stats.section.includes(section);
        })
        .map(type => ({
            type,
            weight: getMobStats(type, 'common')?.spawn_weight ?? 1,
        }));
    poolBiome = maze.biome;
    return poolTypes;
}

/** Drop the cached pool (called on daily rotation so the biome roster swaps). */
export function invalidateMazeMobPool(): void {
    poolBiome = null;
    poolTypes = [];
}

function pickWeighted<T extends { weight: number }>(pool: T[]): T {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll <= 0) return entry;
    }
    return pool[pool.length - 1];
}

function getMazePlayerIds(): string[] {
    const ids: string[] = [];
    for (const id in players) {
        if (id.startsWith('bot_')) continue;
        const p = players[id];
        if (p?.inMaze && !p.isDead) ids.push(id);
    }
    return ids;
}

/** True while at least one live player is inside the maze. Used by the
 *  distant-enemy despawner to keep the maze persistently populated. */
export function hasMazePlayers(): boolean {
    return getMazePlayerIds().length > 0;
}

function countMazeMobs(): { total: number; ultras: number } {
    let total = 0;
    let ultras = 0;
    for (const enemy of enemies) {
        if (enemy.ownerId) continue; // pets don't count against the population
        if (!isInMazeRegion(enemy.x, enemy.y)) continue;
        total++;
        // Centipede body segments share the head's tier — only the head counts
        // as a boss, or one ultra centipede (1 head + 9 bodies) would satisfy
        // the boss cap several times over and starve the other boss room.
        if (isCentipedeBodyType(enemy.type)) continue;
        if (TIER_ORDER.indexOf(enemy.tier) >= TIER_ORDER.indexOf('ultra')) ultras++;
    }
    return { total, ultras };
}

const _spawnQueryScratch: Enemy[] = [];

function isTooCloseToPlayersOrMobs(x: number, y: number, mobRadius: number): boolean {
    for (const id in players) {
        const p = players[id];
        if (!p?.inMaze) continue;
        const dx = p.x - x, dy = p.y - y;
        if (dx * dx + dy * dy < MIN_SPAWN_DISTANCE_FROM_PLAYER * MIN_SPAWN_DISTANCE_FROM_PLAYER) return true;
    }
    // Spatial-grid query instead of an all-enemies scan: at full maze density
    // (~1300 mobs) a linear pass per placement attempt would make the fill
    // burst quadratic. Caller refreshes the grid once per spawn batch.
    const reach = mobRadius + getMaxEnemyRadius() + MIN_SPAWN_DISTANCE_FROM_MOB;
    const nearby = queryEnemiesNear(x, y, reach, _spawnQueryScratch);
    for (const enemy of nearby) {
        const otherStats = getMobStats(enemy.type, enemy.tier);
        const otherRadius = otherStats ? (otherStats.size * 40) / 2 : 20;
        const dx = enemy.x - x, dy = enemy.y - y;
        const minDist = mobRadius + otherRadius + MIN_SPAWN_DISTANCE_FROM_MOB;
        if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    return false;
}

/** Mob body clearance: the centre plus 4 compass points must all be floor. */
function mazeBodyFits(x: number, y: number, mobRadius: number): boolean {
    if (!isMazeFloorAtWorld(x, y)) return false;
    const r = Math.min(mobRadius, MAZE_CELL_SIZE - 10);
    return isMazeFloorAtWorld(x - r, y) && isMazeFloorAtWorld(x + r, y) &&
        isMazeFloorAtWorld(x, y - r) && isMazeFloorAtWorld(x, y + r);
}

/**
 * Pick a walkable corridor position anywhere in the maze (uniform over floor
 * cells), clear of walls for the mob's body and not right next to a player.
 */
function findMazeSpawnPosition(mobRadius: number): { x: number; y: number } | null {
    const maze = getActiveMaze();
    if (!maze) return null;
    for (let attempt = 0; attempt < 40; attempt++) {
        const gx = Math.floor(Math.random() * maze.gridDim);
        const gy = Math.floor(Math.random() * maze.gridDim);
        if (maze.values[gy * maze.gridDim + gx] !== 1) continue; // plain floor cells only
        const x = MAZE_ORIGIN_X + (gx + 0.2 + Math.random() * 0.6) * MAZE_CELL_SIZE;
        const y = MAZE_ORIGIN_Y + (gy + 0.2 + Math.random() * 0.6) * MAZE_CELL_SIZE;
        if (!mazeBodyFits(x, y, mobRadius)) continue;
        if (isTooCloseToPlayersOrMobs(x, y, mobRadius)) continue;
        return { x, y };
    }
    return null;
}

function buildEnemy(type: string, tier: Enemy['tier'], x: number, y: number): Enemy | null {
    const stats = getMobStats(type, tier);
    if (!stats) return null;
    const currentTime = Date.now();
    return {
        id: Math.random().toString(36).slice(2, 11),
        type: type as Enemy['type'],
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
export function spawnMazeMobs(limit: number = 3): Enemy[] {
    const maze = getActiveMaze();
    if (!maze) return [];
    const mazePlayerIds = getMazePlayerIds();
    if (mazePlayerIds.length === 0) return [];

    const pool = getMazeMobPool();
    if (pool.length === 0) return [];

    const { total } = countMazeMobs();
    const target = getMazePopulationTarget();
    const needed = Math.min(limit, target - total);
    if (needed <= 0) return [];

    // Fresh broad-phase grid for the too-close checks below (the tick loop
    // rebuilds it too, but this call runs on its own interval).
    rebuildEnemyGrid(enemies);

    const spawned: Enemy[] = [];
    for (let i = 0; i < needed; i++) {
        const mobEntry = pickWeighted(pool);
        const prelimStats = getMobStats(mobEntry.type, 'common');
        const mobRadius = prelimStats ? (prelimStats.size * 40) / 2 : 20;
        const position = findMazeSpawnPosition(mobRadius);
        if (!position) continue;

        // Depth zone → tier, with a small up/down jitter (never above mythic;
        // ultras are reserved for the boss spawner).
        const zone = getMazeZoneAtWorld(position.x, position.y);
        if (zone < 0) continue;
        let tierIndex = zone;
        const roll = Math.random();
        if (roll < 0.08) tierIndex = Math.min(MAZE_ZONE_TIERS.length - 1, tierIndex + 1);
        else if (roll < 0.28) tierIndex = Math.max(0, tierIndex - 1);
        const tier = MAZE_ZONE_TIERS[tierIndex] as Enemy['tier'];

        // Re-check body clearance with the ACTUAL tier's size — higher tiers
        // are much bigger than the common-size estimate used for placement.
        const tierStats = getMobStats(mobEntry.type, tier);
        const tierRadius = tierStats ? (tierStats.size * 40) / 2 : mobRadius;
        if (tierRadius > mobRadius && !mazeBodyFits(position.x, position.y, tierRadius)) continue;

        const enemy = buildEnemy(mobEntry.type, tier, position.x, position.y);
        if (!enemy) continue;
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
export function spawnMazeBosses(): Enemy[] {
    const maze = getActiveMaze();
    if (!maze || maze.bossSpots.length === 0) return [];
    if (getMazePlayerIds().length === 0) return [];

    const { ultras } = countMazeMobs();
    let toSpawn = MAZE_BOSS_COUNT - ultras;
    if (toSpawn <= 0) return [];

    const pool = getMazeMobPool();
    if (pool.length === 0) return [];

    const spawned: Enemy[] = [];
    for (const spot of maze.bossSpots) {
        if (toSpawn <= 0) break;
        // Don't drop a boss on someone's head.
        let playerNearby = false;
        for (const id in players) {
            const p = players[id];
            if (!p?.inMaze) continue;
            const dx = p.x - spot.x, dy = p.y - spot.y;
            if (dx * dx + dy * dy < 1200 * 1200) { playerNearby = true; break; }
        }
        if (playerNearby) continue;
        // One boss per room.
        let bossHere = false;
        for (const enemy of enemies) {
            if (isCentipedeBodyType(enemy.type)) continue;
            if (TIER_ORDER.indexOf(enemy.tier) < TIER_ORDER.indexOf('ultra')) continue;
            const dx = enemy.x - spot.x, dy = enemy.y - spot.y;
            if (dx * dx + dy * dy < 2000 * 2000) { bossHere = true; break; }
        }
        if (bossHere) continue;

        const mobEntry = pickWeighted(pool);
        const boss = buildEnemy(mobEntry.type, 'ultra', spot.x, spot.y);
        if (!boss) continue;
        if (isCentipedeHeadType(boss.type)) {
            spawnCentipedeBodySegments(boss);
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
export function clearMazeEnemies(): string[] {
    const removed: string[] = [];
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (isInMazeRegion(enemy.x, enemy.y)) {
            removed.push(enemy.id);
            enemies.splice(i, 1);
        }
    }
    return removed;
}
