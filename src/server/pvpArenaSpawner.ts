import { Enemy, makeEnemy } from '../server_utils';
import {
    players,
    enemies,
    PVP_ARENA_CENTER_X,
    PVP_ARENA_CENTER_Y,
    PVP_ARENA_RADIUS,
    isInPvpArena
} from '../constants';
import { getMobStats } from '../mobs';

// Garden-themed mobs + spider. Weights control relative spawn frequency.
// Spider is intentionally rarer — it's the standout threat in the arena.
const ARENA_MOB_POOL: Array<{ type: string; weight: number }> = [
    { type: 'bee', weight: 3 },
    { type: 'ladybug', weight: 3 },
    { type: 'rock', weight: 2 },
    { type: 'dandelion', weight: 2 },
    { type: 'soldier_ant', weight: 2 },
    { type: 'hornet', weight: 1 },
    { type: 'spider', weight: 1 },
];

const ARENA_TIER_WEIGHTS: Array<{ tier: Enemy['tier']; weight: number }> = [
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

function pickWeighted<T extends { weight: number }>(pool: T[]): T {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll <= 0) return entry;
    }
    return pool[pool.length - 1];
}

function countArenaPlayers(): number {
    let count = 0;
    for (const id in players) {
        if (id.startsWith('bot_')) continue;
        if (players[id]?.inPvpArena) count++;
    }
    return count;
}

function countArenaMobs(): number {
    let count = 0;
    for (const enemy of enemies) {
        if (isInPvpArena(enemy.x, enemy.y)) count++;
    }
    return count;
}

function findArenaSpawnPosition(mobRadius: number): { x: number; y: number } | null {
    // Keep mobs fully inside the arena so they don't clip the boundary ring.
    const maxR = PVP_ARENA_RADIUS - mobRadius - 40;
    for (let attempt = 0; attempt < 40; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * maxR;
        const x = PVP_ARENA_CENTER_X + Math.cos(angle) * radius;
        const y = PVP_ARENA_CENTER_Y + Math.sin(angle) * radius;

        // Don't spawn right next to a player.
        let tooCloseToPlayer = false;
        for (const id in players) {
            const p = players[id];
            if (!p?.inPvpArena) continue;
            const dx = p.x - x;
            const dy = p.y - y;
            if (dx * dx + dy * dy < MIN_SPAWN_DISTANCE_FROM_PLAYER * MIN_SPAWN_DISTANCE_FROM_PLAYER) {
                tooCloseToPlayer = true;
                break;
            }
        }
        if (tooCloseToPlayer) continue;

        // Don't pile on top of another mob.
        let tooCloseToMob = false;
        for (const enemy of enemies) {
            if (!isInPvpArena(enemy.x, enemy.y)) continue;
            const otherStats = getMobStats(enemy.type, enemy.tier);
            const otherRadius = otherStats ? (otherStats.size * 40) / 2 : 20;
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            const minDist = mobRadius + otherRadius + MIN_SPAWN_DISTANCE_FROM_MOB;
            if (dx * dx + dy * dy < minDist * minDist) {
                tooCloseToMob = true;
                break;
            }
        }
        if (tooCloseToMob) continue;

        return { x, y };
    }
    return null;
}

/**
 * Spawn up to `limit` mobs this tick to keep the arena populated.
 * Returns the list of newly-created enemies (caller is responsible for
 * appending them to the global `enemies` array).
 */
export function spawnArenaMobs(limit: number = 3): Enemy[] {
    const arenaPlayers = countArenaPlayers();
    if (arenaPlayers === 0) return [];

    const target = Math.min(MAX_ARENA_MOBS, arenaPlayers * MOBS_PER_PLAYER);
    const current = countArenaMobs();
    const needed = Math.min(limit, target - current);
    if (needed <= 0) return [];

    const spawned: Enemy[] = [];
    for (let i = 0; i < needed; i++) {
        const mobEntry = pickWeighted(ARENA_MOB_POOL);
        const tierEntry = pickWeighted(ARENA_TIER_WEIGHTS);
        const stats = getMobStats(mobEntry.type, tierEntry.tier);
        if (!stats) continue;

        const mobRadius = (stats.size * 40) / 2;
        const position = findArenaSpawnPosition(mobRadius);
        if (!position) continue;

        const currentTime = Date.now();
        const enemy: Enemy = makeEnemy({
            id: Math.random().toString(36).slice(2, 11),
            type: mobEntry.type as Enemy['type'],
            tier: tierEntry.tier,
            x: position.x,
            y: position.y,
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
        });
        spawned.push(enemy);
    }
    return spawned;
}
