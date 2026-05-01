"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuildEnemyGrid = rebuildEnemyGrid;
exports.getMaxEnemyRadius = getMaxEnemyRadius;
exports.queryEnemiesNear = queryEnemiesNear;
const mobs_1 = require("../mobs");
const constants_1 = require("../constants");
// Cell size chosen so a 3x3 query covers any plausible enemy radius + petal radius
// (largest mobs have radius < ~400). Smaller cells = fewer false positives but more
// query cells; 512 is a reasonable middle-ground for this world (60000 wide).
const CELL_SIZE = 512;
const KEY_OFFSET = 1024; // allow negative cell coords (PVP arena lives outside main world)
const grid = new Map();
let maxRadius = 0;
function key(cx, cy) {
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
function rebuildEnemyGrid(enemies) {
    grid.clear();
    maxRadius = 0;
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.ownerId)
            continue;
        if (e.isDead)
            continue;
        // Cache derived stats once per spawn lifetime.
        if (e._radius === undefined) {
            const mobStats = (0, mobs_1.getMobStats)(e.type, e.tier);
            e._radius = mobStats ? (mobStats.size * 40) / 2 : constants_1.ENEMY_SIZE / 2;
            e._mobDamage = mobStats ? mobStats.damage : 1;
            e._mobStats = mobStats;
        }
        const r = e._radius;
        if (r > maxRadius)
            maxRadius = r;
        const cx = Math.floor(e.x / CELL_SIZE);
        const cy = Math.floor(e.y / CELL_SIZE);
        const k = key(cx, cy);
        let bucket = grid.get(k);
        if (!bucket) {
            bucket = [];
            grid.set(k, bucket);
        }
        bucket.push(e);
    }
}
/** Largest enemy radius in the current grid; callers add this to their own radius. */
function getMaxEnemyRadius() {
    return maxRadius;
}
/**
 * Append all enemy candidates within `radius` of (x, y) into `out` (cleared first).
 * Returns `out`. Caller still does precise distance checks — this is a broad-phase.
 */
function queryEnemiesNear(x, y, radius, out) {
    out.length = 0;
    const minCX = Math.floor((x - radius) / CELL_SIZE);
    const maxCX = Math.floor((x + radius) / CELL_SIZE);
    const minCY = Math.floor((y - radius) / CELL_SIZE);
    const maxCY = Math.floor((y + radius) / CELL_SIZE);
    for (let cy = minCY; cy <= maxCY; cy++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
            const bucket = grid.get(key(cx, cy));
            if (!bucket)
                continue;
            for (let i = 0; i < bucket.length; i++)
                out.push(bucket[i]);
        }
    }
    return out;
}
