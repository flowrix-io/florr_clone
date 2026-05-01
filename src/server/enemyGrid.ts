import { Enemy } from '../server_utils';
import { getMobStats } from '../mobs';
import { ENEMY_SIZE } from '../constants';

// Cell size chosen so a 3x3 query covers any plausible enemy radius + petal radius
// (largest mobs have radius < ~400). Smaller cells = fewer false positives but more
// query cells; 512 is a reasonable middle-ground for this world (60000 wide).
const CELL_SIZE = 512;
const KEY_OFFSET = 1024; // allow negative cell coords (PVP arena lives outside main world)

const grid: Map<number, Enemy[]> = new Map();
let maxRadius = 0;

function key(cx: number, cy: number): number {
    return ((cy + KEY_OFFSET) << 16) | ((cx + KEY_OFFSET) & 0xFFFF);
}

/**
 * Rebuild the spatial grid from the current enemies array. Pets (ownerId set) and
 * dead enemies are excluded so callers don't need to filter them.
 *
 * Side-effect: caches mob radius/damage on each enemy as `_radius` / `_mobDamage`
 * so per-collision lookups don't have to call getMobStats again. type/tier never
 * change after spawn, so the cache is safe.
 */
export function rebuildEnemyGrid(enemies: Enemy[]): void {
    grid.clear();
    maxRadius = 0;
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.ownerId) continue;
        if ((e as any).isDead) continue;

        // Cache derived stats once per spawn lifetime.
        if ((e as any)._radius === undefined) {
            const mobStats = getMobStats(e.type, e.tier);
            (e as any)._radius = mobStats ? (mobStats.size * 40) / 2 : ENEMY_SIZE / 2;
            (e as any)._mobDamage = mobStats ? mobStats.damage : 1;
            (e as any)._mobStats = mobStats;
        }
        const r = (e as any)._radius as number;
        if (r > maxRadius) maxRadius = r;

        const cx = Math.floor(e.x / CELL_SIZE);
        const cy = Math.floor(e.y / CELL_SIZE);
        const k = key(cx, cy);
        let bucket = grid.get(k);
        if (!bucket) { bucket = []; grid.set(k, bucket); }
        bucket.push(e);
    }
}

/** Largest enemy radius in the current grid; callers add this to their own radius. */
export function getMaxEnemyRadius(): number {
    return maxRadius;
}

/**
 * Append all enemy candidates within `radius` of (x, y) into `out` (cleared first).
 * Returns `out`. Caller still does precise distance checks — this is a broad-phase.
 */
export function queryEnemiesNear(x: number, y: number, radius: number, out: Enemy[]): Enemy[] {
    out.length = 0;
    const minCX = Math.floor((x - radius) / CELL_SIZE);
    const maxCX = Math.floor((x + radius) / CELL_SIZE);
    const minCY = Math.floor((y - radius) / CELL_SIZE);
    const maxCY = Math.floor((y + radius) / CELL_SIZE);
    for (let cy = minCY; cy <= maxCY; cy++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
            const bucket = grid.get(key(cx, cy));
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
        }
    }
    return out;
}
