import { Enemy } from '../server_utils';
import { isMobDead, mobQueryStamp, mobRadiusOf, mobStatsOf, mobWorld, mobX, mobY, setMobQueryStamp, setMobRadius } from './mobFields';
import { ENEMY_SIZE, MAX_SANE_WORLD_COORD } from '../constants';

// Cell size chosen so a typical query (a petal or player radius, tens of px) touches
// only one or two cells per axis. Mobs larger than a cell are inserted into every cell
// they overlap, so cell size no longer has to bound the largest mob radius.
const CELL_SIZE = 512;
const KEY_OFFSET = 1024; // allow negative cell coords (PVP arena lives outside main world)

// Sanity bounds. No legitimate mob radius or broad-phase query radius comes close to
// these — they exist purely to stop a degenerate (NaN/Infinity/huge) value from making
// the cell-range loops span the whole coordinate space and spin forever at 100% CPU
// (the long-session server hang). Hit values are logged so the real cause is visible.
const MAX_MOB_RADIUS = 4096;    // mob _radius = size*40/2; the largest real mob is ant_hole/apex at 1718
const MAX_QUERY_RADIUS = 8192;  // a caller's own radius (petal/player/aura); real < ~1500
let _lastBadMobRadius = NaN;
let _lastBadQuery = NaN;

const grid: Map<number, Enemy[]> = new Map();

/**
 * Live wild mobs that carry a damaging petal ring (glitch flower), refreshed by
 * `rebuildEnemyGrid` because it is the one pass that already walks every enemy
 * each tick with pets and corpses filtered out.
 *
 * The ring reaches well past the mob's own radius, so a player standing in it
 * is not necessarily in a cell the mob was inserted into — `queryEnemiesNear`
 * from the player's side would miss it. Ring mobs are rare enough (usually
 * none) that iterating this list per player is cheaper than widening every
 * player's broad-phase query would be.
 */
export const petalRingEnemies: Enemy[] = [];

// Monotonic per-query stamp. A mob wider than a cell lives in several buckets, so a
// query spanning those buckets would otherwise return it more than once — and callers
// apply damage per returned candidate, so a duplicate is a double hit. Stamping is O(1)
// and needs no reset: the counter only ever increases, so a stale `_qs` can never equal
// the current stamp.
let queryStamp = 0;

function key(cx: number, cy: number): number {
    return ((cy + KEY_OFFSET) << 16) | ((cx + KEY_OFFSET) & 0xFFFF);
}

/**
 * Rebuild the spatial grid from the current enemies array. Pets (ownerId set) and
 * dead enemies are excluded so callers don't need to filter them.
 *
 * Each enemy is inserted into every cell its own radius overlaps ("fat" insertion).
 * That is what lets `queryEnemiesNear` take only the *caller's* radius. The old grid
 * stored each enemy in the single cell holding its centre, so every caller had to
 * query `ownRadius + getMaxEnemyRadius()` to avoid missing a large mob whose centre
 * was far away but whose edge was touching. Because that max is global, a single
 * ant_hole/apex (radius 1718px) anywhere in the world — a maze boss room, say —
 * inflated every petal's query from ~9 cells to ~64, for every player. With a Light
 * loadout (~70 petal instances, one query each) that dominated the tick.
 *
 * No stat caching any more: radius and mob-config are components written once at
 * spawn (C.Radius, C.MobStats), so the lazy `_radius` / `_mobStats` stamps this
 * loop used to write on the first pass are redundant.
 *
 * Per-mob component reads are hoisted into locals. This runs over every mob
 * every tick, and an accessor resolves archetype and row each call — cheap, but
 * not free enough to pay eight times per mob.
 */
export function rebuildEnemyGrid(enemies: readonly Enemy[]): void {
    grid.clear();
    petalRingEnemies.length = 0;
    const world = mobWorld();
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const entity = e.entity;
        if (e.ownerId) continue;
        if (isMobDead(entity, world)) continue;

        const x = mobX(entity, world);
        const y = mobY(entity, world);
        // A non-finite position would make the cell range below Infinity/NaN, and a
        // finite-but-absurd one (cell index past 2^53) stalls `cx++` outright — either
        // way the nested loops spin forever. Such a mob simply isn't in the grid this tick.
        if (!Number.isFinite(x) || !Number.isFinite(y)
            || Math.abs(x) > MAX_SANE_WORLD_COORD || Math.abs(y) > MAX_SANE_WORLD_COORD) continue;

        let r = mobRadiusOf(entity, world);
        // A degenerate mob radius would blow up the insertion cell range below.
        // Clamp + log, and persist so it's only logged once.
        if (!(r >= 0 && r <= MAX_MOB_RADIUS)) {
            if (r !== _lastBadMobRadius) {
                console.warn(`[enemyGrid] degenerate mob radius=${r} for ${e.type}/${e.tier}; clamping to ${ENEMY_SIZE / 2}`);
                _lastBadMobRadius = r;
            }
            r = ENEMY_SIZE / 2;
            setMobRadius(entity, r, world);
        }

        if (mobStatsOf(entity, world)?.petal_ring) petalRingEnemies.push(e);

        const minCX = Math.floor((x - r) / CELL_SIZE);
        const maxCX = Math.floor((x + r) / CELL_SIZE);
        const minCY = Math.floor((y - r) / CELL_SIZE);
        const maxCY = Math.floor((y + r) / CELL_SIZE);
        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const k = key(cx, cy);
                let bucket = grid.get(k);
                if (!bucket) { bucket = []; grid.set(k, bucket); }
                bucket.push(e);
            }
        }
    }
}

/**
 * Append every enemy whose hitbox may overlap a circle of `radius` around (x, y) into
 * `out` (cleared first), each at most once. Returns `out`.
 *
 * `radius` is the CALLER's own radius (petal, player, aura, spawn clearance) — do NOT
 * add the largest mob radius to it. The grid already accounts for each mob's own size.
 * Caller still does the precise `dist < radius + enemy._radius` test: this is a
 * broad phase over cell AABBs, so it can return a few extra corner cases.
 */
export function queryEnemiesNear(x: number, y: number, radius: number, out: Enemy[]): Enemy[] {
    out.length = 0;
    // A non-finite position would make the cell range below NaN/Infinity, and a
    // finite-but-absurd one (cell index past 2^53) stalls `cx++` outright — either way
    // the nested loops spin forever. Bail safely (can't query from a corrupt position).
    if (!Number.isFinite(x) || !Number.isFinite(y)
        || Math.abs(x) > MAX_SANE_WORLD_COORD || Math.abs(y) > MAX_SANE_WORLD_COORD) {
        if (x !== _lastBadQuery) {
            console.warn(`[enemyGrid] non-finite query position (${x},${y}); skipping query`);
            _lastBadQuery = x;
        }
        return out;
    }
    // A non-finite or absurdly large radius does the same. Clamp + log the real value.
    if (!(radius >= 0 && radius <= MAX_QUERY_RADIUS)) {
        if (radius !== _lastBadQuery) {
            console.warn(`[enemyGrid] degenerate query radius=${radius} at (${x.toFixed(0)},${y.toFixed(0)}); clamping to ${MAX_QUERY_RADIUS}`);
            _lastBadQuery = radius;
        }
        radius = MAX_QUERY_RADIUS;
    }
    const stamp = ++queryStamp;
    const minCX = Math.floor((x - radius) / CELL_SIZE);
    const maxCX = Math.floor((x + radius) / CELL_SIZE);
    const minCY = Math.floor((y - radius) / CELL_SIZE);
    const maxCY = Math.floor((y + radius) / CELL_SIZE);
    for (let cy = minCY; cy <= maxCY; cy++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
            const bucket = grid.get(key(cx, cy));
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i++) {
                const e = bucket[i];
                // Per-query dedup stamp; a mob spans several cells. Lives in
                // C.GridStamps rather than on the shell.
                if (mobQueryStamp(e.entity) === stamp) continue;
                setMobQueryStamp(e.entity, stamp);
                out.push(e);
            }
        }
    }
    return out;
}
