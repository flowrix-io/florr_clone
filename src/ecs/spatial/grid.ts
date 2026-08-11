/**
 * Spatial broad-phase grid over ECS entities.
 *
 * A direct successor to server/enemyGrid.ts and deliberately identical in
 * ALGORITHM — same 512px cells, same "fat" insertion (an entity goes into every
 * cell its own radius overlaps, so callers query with only their own radius),
 * same monotonic per-query stamp for dedup, same sanity clamps on degenerate
 * radii and coordinates. Those properties were each fixed a specific production
 * problem and none of them are up for renegotiation here.
 *
 * What changes is the STORAGE, and it changes for two measurable reasons:
 *
 *  1. Buckets hold parallel typed arrays (handle, x, y, radius) instead of
 *     pointers to mob objects. The narrow phase that every caller runs right
 *     after a query — `dist < radius + otherRadius` — then reads packed numbers
 *     with no pointer chase into a 45-field object. Returning bare entity
 *     handles and making the caller resolve each one through the world would be
 *     strictly worse than the object-pointer version, which is why this grid
 *     carries the position and radius out with the handle.
 *
 *  2. Cells are RETAINED between rebuilds and reset to zero length, rather than
 *     the whole Map being cleared and every bucket array reallocated each tick.
 *     At 30Hz the old scheme allocated a fresh array per occupied cell per tick,
 *     which is pure garbage on a heap that is capped at 192MB.
 *
 * Empty cells would accumulate forever under retention, so they are pruned on a
 * slow cadence (see PRUNE_INTERVAL).
 */

import * as C from '../components';
import { Entity, entityIndex } from '../entity';
import { Query, World } from '../world';

/** Cell size, chosen so a typical query touches one or two cells per axis. */
export const CELL_SIZE = 512;

/** Allows negative cell coordinates (the PVP arena lives outside the main world). */
const KEY_OFFSET = 1024;

/**
 * Sanity bounds, carried over verbatim from enemyGrid.ts. These exist to stop a
 * degenerate (NaN / Infinity / absurd) value from making the cell-range loops
 * span the whole coordinate space and spin at 100% CPU — the long-session hang.
 */
const MAX_MOB_RADIUS = 4096;
const MAX_QUERY_RADIUS = 8192;

/**
 * Coordinates past this are refused. Beyond ~2^53 a cell index increment is a
 * no-op and the scan loop never terminates; this bound keeps the loops finite.
 */
const MAX_SANE_WORLD_COORD = 1e9;

/** Rebuilds between sweeps that drop cells which have stayed empty. */
const PRUNE_INTERVAL = 600; // ~20s at 30Hz

const INITIAL_CELL_CAPACITY = 8;

/** One grid cell: parallel arrays, reused across rebuilds. */
class Cell {
    handles = new Float64Array(INITIAL_CELL_CAPACITY);
    /**
     * Entity INDEX (the handle's low bits), precomputed at insertion.
     *
     * Decoding a handle costs a float modulo, and the dedup check needs the
     * index for every candidate a query returns — which happens far more often
     * than insertion does (thousands of returned candidates per tick versus
     * ~1400 insertions). Paying the decode once at insertion instead of once
     * per return measurably moved the dense-clump case.
     */
    indices = new Uint32Array(INITIAL_CELL_CAPACITY);
    x = new Float64Array(INITIAL_CELL_CAPACITY);
    y = new Float64Array(INITIAL_CELL_CAPACITY);
    radius = new Float32Array(INITIAL_CELL_CAPACITY);
    count = 0;
    capacity = INITIAL_CELL_CAPACITY;
    /** Rebuild index this cell last held anything, for pruning. */
    lastUsed = 0;

    push(handle: number, index: number, px: number, py: number, r: number): void {
        if (this.count === this.capacity) this.grow();
        const i = this.count++;
        this.handles[i] = handle;
        this.indices[i] = index;
        this.x[i] = px;
        this.y[i] = py;
        this.radius[i] = r;
    }

    private grow(): void {
        const capacity = this.capacity * 2;
        const handles = new Float64Array(capacity); handles.set(this.handles);
        const indices = new Uint32Array(capacity); indices.set(this.indices);
        const x = new Float64Array(capacity); x.set(this.x);
        const y = new Float64Array(capacity); y.set(this.y);
        const radius = new Float32Array(capacity); radius.set(this.radius);
        this.handles = handles;
        this.indices = indices;
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.capacity = capacity;
    }
}

/**
 * Query output. Preallocated by the caller and reused, so a per-tick query
 * storm allocates nothing.
 *
 * `count` candidates are written into the parallel arrays; the caller then runs
 * its own precise distance test. This is a broad phase over cell AABBs, so a
 * few corner cases come back that the narrow phase rejects.
 */
export class GridQueryResult {
    handles: Float64Array;
    x: Float64Array;
    y: Float64Array;
    radius: Float32Array;
    count = 0;

    constructor(capacity = 64) {
        this.handles = new Float64Array(capacity);
        this.x = new Float64Array(capacity);
        this.y = new Float64Array(capacity);
        this.radius = new Float32Array(capacity);
    }

    /** Entity handle at slot `i`, typed. */
    entity(i: number): Entity {
        return this.handles[i] as Entity;
    }

    ensure(capacity: number): void {
        if (capacity <= this.handles.length) return;
        let next = this.handles.length * 2;
        while (next < capacity) next *= 2;
        const handles = new Float64Array(next); handles.set(this.handles);
        const x = new Float64Array(next); x.set(this.x);
        const y = new Float64Array(next); y.set(this.y);
        const radius = new Float32Array(next); radius.set(this.radius);
        this.handles = handles;
        this.x = x;
        this.y = y;
        this.radius = radius;
    }
}

function key(cx: number, cy: number): number {
    return ((cy + KEY_OFFSET) << 16) | ((cx + KEY_OFFSET) & 0xFFFF);
}

export class SpatialGrid {
    private readonly cells = new Map<number, Cell>();
    /**
     * Per-query dedup stamps, indexed by ENTITY INDEX rather than stored on the
     * entity. An entity wider than a cell sits in several buckets and would
     * otherwise be returned once per bucket — and callers apply damage per
     * candidate, so a duplicate is a double hit.
     *
     * Keeping the stamps in a side array rather than a GridStamps component
     * means the grid never moves an entity between archetypes and never touches
     * component storage at all. The counter only increases, so a stale stamp can
     * never equal the current one and no reset pass is needed.
     */
    private stamps = new Uint32Array(1024);
    private queryStamp = 0;
    private rebuildCount = 0;

    /**
     * Cells that actually received an entity in the last rebuild.
     *
     * Retained cells accumulate — a mob that crossed the map once leaves an
     * empty cell behind — so resetting by walking the whole Map made the
     * rebuild cost scale with the world's historical footprint rather than with
     * the current population. On a quiet server that fixed cost was larger than
     * the work itself. Only these get reset.
     */
    private activeCells: Cell[] = [];

    private loggedBadRadius = NaN;
    private loggedBadQuery = NaN;

    /**
     * Rebuild from every entity matching `source`.
     *
     * `source` should exclude pets and the dead, exactly as the old rebuild did
     * with its `ownerId`/`isDead` skips, so callers need no filtering.
     */
    rebuild(world: World, source: Query): void {
        const rebuildIndex = ++this.rebuildCount;

        const active = this.activeCells;
        for (let i = 0; i < active.length; i++) active[i].count = 0;
        active.length = 0;

        source.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const rad = chunk.cols(C.Radius);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                const px = pos.x[i];
                const py = pos.y[i];

                // A non-finite or absurd position would make the cell range
                // below NaN/Infinity and spin the nested loops forever. Such an
                // entity is simply absent from the grid this tick.
                if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
                if (px > MAX_SANE_WORLD_COORD || px < -MAX_SANE_WORLD_COORD) continue;
                if (py > MAX_SANE_WORLD_COORD || py < -MAX_SANE_WORLD_COORD) continue;

                let r = rad.value[i];
                if (!(r >= 0 && r <= MAX_MOB_RADIUS)) {
                    if (r !== this.loggedBadRadius) {
                        console.warn(`[SpatialGrid] degenerate radius=${r}; clamping`);
                        this.loggedBadRadius = r;
                    }
                    r = 0;
                }

                const handle = entities[i];
                const index = entityIndex(handle as Entity);
                const minCX = Math.floor((px - r) / CELL_SIZE);
                const maxCX = Math.floor((px + r) / CELL_SIZE);
                const minCY = Math.floor((py - r) / CELL_SIZE);
                const maxCY = Math.floor((py + r) / CELL_SIZE);

                for (let cy = minCY; cy <= maxCY; cy++) {
                    for (let cx = minCX; cx <= maxCX; cx++) {
                        const k = key(cx, cy);
                        let cell = this.cells.get(k);
                        if (cell === undefined) {
                            cell = new Cell();
                            this.cells.set(k, cell);
                        }
                        if (cell.count === 0) active.push(cell);
                        cell.push(handle, index, px, py, r);
                        cell.lastUsed = rebuildIndex;
                    }
                }
            }
        });

        // Retaining cells is what removes the per-tick bucket allocation, but
        // without this sweep a mob that wandered across the map once would pin
        // an empty cell forever.
        if (rebuildIndex % PRUNE_INTERVAL === 0) {
            for (const [k, cell] of this.cells) {
                if (cell.count === 0 && cell.lastUsed < rebuildIndex - PRUNE_INTERVAL) {
                    this.cells.delete(k);
                }
            }
        }
    }

    /**
     * Collect every entity whose hitbox may overlap a circle of `radius` around
     * (x, y) into `out`, each at most once.
     *
     * `radius` is the CALLER's own radius. Do not add the largest entity radius
     * to it — the grid already accounts for each entity's own size via fat
     * insertion. That distinction is the whole point: under centre-only
     * insertion a single apex ant_hole (radius 1718px) anywhere in the world
     * inflated every petal's query from ~9 cells to ~64.
     */
    query(x: number, y: number, radius: number, out: GridQueryResult): GridQueryResult {
        out.count = 0;

        if (!Number.isFinite(x) || !Number.isFinite(y)
            || Math.abs(x) > MAX_SANE_WORLD_COORD || Math.abs(y) > MAX_SANE_WORLD_COORD) {
            if (x !== this.loggedBadQuery) {
                console.warn(`[SpatialGrid] non-finite query position (${x},${y}); skipping`);
                this.loggedBadQuery = x;
            }
            return out;
        }
        if (!(radius >= 0 && radius <= MAX_QUERY_RADIUS)) {
            if (radius !== this.loggedBadQuery) {
                console.warn(`[SpatialGrid] degenerate query radius=${radius}; clamping`);
                this.loggedBadQuery = radius;
            }
            radius = MAX_QUERY_RADIUS;
        }

        const stamp = ++this.queryStamp;
        const stamps = this.stamps;

        const minCX = Math.floor((x - radius) / CELL_SIZE);
        const maxCX = Math.floor((x + radius) / CELL_SIZE);
        const minCY = Math.floor((y - radius) / CELL_SIZE);
        const maxCY = Math.floor((y + radius) / CELL_SIZE);

        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const cell = this.cells.get(key(cx, cy));
                if (cell === undefined || cell.count === 0) continue;

                const n = cell.count;
                out.ensure(out.count + n);

                const cellHandles = cell.handles;
                const cellIndices = cell.indices;
                const cellX = cell.x;
                const cellY = cell.y;
                const cellR = cell.radius;
                const outHandles = out.handles;
                const outX = out.x;
                const outY = out.y;
                const outR = out.radius;
                let o = out.count;

                for (let i = 0; i < n; i++) {
                    const idx = cellIndices[i];
                    if (idx >= stamps.length) continue;
                    if (stamps[idx] === stamp) continue;
                    stamps[idx] = stamp;

                    outHandles[o] = cellHandles[i];
                    outX[o] = cellX[i];
                    outY[o] = cellY[i];
                    outR[o] = cellR[i];
                    o++;
                }
                out.count = o;
            }
        }
        return out;
    }

    /** Grow the stamp table to cover `slotCount` entity slots. */
    ensureStampCapacity(slotCount: number): void {
        if (slotCount <= this.stamps.length) return;
        let next = this.stamps.length * 2;
        while (next < slotCount) next *= 2;
        const stamps = new Uint32Array(next);
        stamps.set(this.stamps);
        this.stamps = stamps;
    }

    /** Occupied cell count. Diagnostics. */
    get cellCount(): number {
        return this.cells.size;
    }
}
