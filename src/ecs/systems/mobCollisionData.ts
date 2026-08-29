/**
 * The per-tick collision working set, as flat arrays.
 *
 * mobCollision used to build an array of `Entry` objects and a
 * `Map<cellKey, Entry[]>` of buckets every tick — at 9000 mobs that is 9000
 * object allocations plus a few thousand array allocations per tick, and it is
 * also a shape the collision pass cannot be handed to a worker thread in.
 *
 * This is the same data as a struct-of-arrays with a counting-sort uniform
 * grid. Buffers are grown on demand and reused, so a steady tick allocates
 * nothing, and every array here is a candidate for SharedArrayBuffer backing so
 * worker threads can read the set with no copy.
 *
 * Entry order is the insertion order of the broad phase, and the grid's cell
 * lists are in ascending entry index — both of which the narrow phase's
 * pair-dedup (`other > self`) depends on.
 */

import { Entity } from '../entity';

/** Free-slot marker in the cell table. Real keys are always >= 0. */
export const EMPTY_KEY = -1;

/**
 * Packs a grid coordinate into a single non-negative key.
 *
 * The +1024 bias keeps coordinates near the origin positive; the mask keeps the
 * two axes in disjoint bit ranges. Multiplication rather than `<< 16` so the key
 * does not wrap through int32 for far-out coordinates the way the original did.
 */
export function cellKeyOf(cx: number, cy: number): number {
    return ((cy + 1024) * 65536) + ((cx + 1024) & 0xFFFF);
}

/** Probes the cell table. Returns the dense cell id, or -1 when absent. */
export function lookupCell(
    keys: Int32Array, vals: Int32Array, mask: number, key: number,
): number {
    let slot = (Math.imul(key, 0x9E3779B1) >>> 0) & mask;
    for (;;) {
        const k = keys[slot];
        if (k === EMPTY_KEY) return -1;
        if (k === key) return vals[slot];
        slot = (slot + 1) & mask;
    }
}

/** Bit flags packed into `flags`. */
export const ENTRY_IS_PET = 1 << 0;
export const ENTRY_NO_COLLISION = 1 << 1;

/**
 * Grows a typed array to at least `needed`, PRESERVING its contents.
 *
 * The copy is not optional: `push` grows mid-broad-phase, so dropping the
 * existing entries silently zeroes every mob appended before the resize. That
 * is invisible below the initial 1024 capacity and corrupts every tick above
 * it — the collision set quietly loses its first 1024 mobs.
 */
function grow<T extends Float64Array | Float32Array | Int32Array | Uint8Array>(
    arr: T, needed: number, make: (n: number) => T,
): T {
    if (arr.length >= needed) return arr;
    let n = arr.length || 1024;
    while (n < needed) n *= 2;
    const next = make(n);
    next.set(arr as any);
    return next;
}

export class MobCollisionSet {
    /** Number of live entries this tick. */
    count = 0;

    entity: Float64Array = new Float64Array(0);
    x: Float64Array = new Float64Array(0);
    y: Float64Array = new Float64Array(0);
    radius: Float32Array = new Float32Array(0);
    damage: Float32Array = new Float32Array(0);
    owner: Float64Array = new Float64Array(0);
    /** Centipede chain identity; NULL_ENTITY when the mob is not a segment. */
    head: Float64Array = new Float64Array(0);
    flags: Uint8Array = new Uint8Array(0);

    /** Largest radius in the set, for the neighbour-scan reach. */
    maxRadius = 0;

    // ---- uniform grid (counting sort) ----
    /** Dense cell id per entry. */
    private cellId: Int32Array = new Int32Array(0);
    /** Start offset of each dense cell in `sorted`. Length cellCount + 1. */
    cellStart: Int32Array = new Int32Array(0);
    /** Entry indices grouped by cell, ascending within each cell. */
    sorted: Int32Array = new Int32Array(0);
    /**
     * Sparse cell key -> dense cell id, as an open-addressed table.
     *
     * A Map would be the obvious choice and was the original one, but a Map
     * cannot be read from a worker thread. Linear probing over two Int32Arrays
     * can, and it is also faster in the serial path: the narrow phase probes
     * this once per neighbouring cell per mob, which is the hottest lookup in
     * the pass. EMPTY_KEY marks a free slot; keys are always >= 0.
     */
    hashKeys: Int32Array = new Int32Array(0);
    hashVals: Int32Array = new Int32Array(0);
    hashMask = 0;
    cellCount = 0;

    /** Discard the previous tick's contents. Keeps the buffers. */
    reset(): void {
        this.count = 0;
        this.maxRadius = 0;
        this.cellCount = 0;
    }

    /** Sizes and clears the cell table for up to `cells` distinct cells. */
    private resetCellTable(cells: number): void {
        let cap = 64;
        while (cap < cells * 2) cap *= 2;
        if (this.hashKeys.length !== cap) {
            this.hashKeys = new Int32Array(cap);
            this.hashVals = new Int32Array(cap);
        }
        this.hashKeys.fill(EMPTY_KEY);
        this.hashMask = cap - 1;
    }

    /** Interns `key`, returning its dense cell id. */
    private internCell(key: number): number {
        const keys = this.hashKeys;
        const mask = this.hashMask;
        // Fibonacci hashing, then linear probe. The table is never more than
        // half full, so the probe chain stays short.
        let slot = (Math.imul(key, 0x9E3779B1) >>> 0) & mask;
        for (;;) {
            const k = keys[slot];
            if (k === EMPTY_KEY) {
                keys[slot] = key;
                const id = this.cellCount++;
                this.hashVals[slot] = id;
                return id;
            }
            if (k === key) return this.hashVals[slot];
            slot = (slot + 1) & mask;
        }
    }

    /** Make room for `n` entries. */
    ensure(n: number): void {
        if (this.entity.length >= n) return;
        this.entity = grow(this.entity, n, k => new Float64Array(k));
        this.x = grow(this.x, n, k => new Float64Array(k));
        this.y = grow(this.y, n, k => new Float64Array(k));
        this.radius = grow(this.radius, n, k => new Float32Array(k));
        this.damage = grow(this.damage, n, k => new Float32Array(k));
        this.owner = grow(this.owner, n, k => new Float64Array(k));
        this.head = grow(this.head, n, k => new Float64Array(k));
        this.flags = grow(this.flags, n, k => new Uint8Array(k));
        this.cellId = grow(this.cellId, n, k => new Int32Array(k));
        this.sorted = grow(this.sorted, n, k => new Int32Array(k));
    }

    /** Appends one mob. Returns its entry index, which is also its pair order. */
    push(
        entity: Entity, x: number, y: number, radius: number, damage: number,
        owner: Entity, head: Entity, flags: number,
    ): number {
        const i = this.count;
        this.ensure(i + 1);
        this.entity[i] = entity as unknown as number;
        this.x[i] = x;
        this.y[i] = y;
        this.radius[i] = radius;
        this.damage[i] = damage;
        this.owner[i] = owner as unknown as number;
        this.head[i] = head as unknown as number;
        this.flags[i] = flags;
        if (radius > this.maxRadius) this.maxRadius = radius;
        this.count = i + 1;
        return i;
    }

    /**
     * Buckets every entry into a uniform grid of `cellSize`.
     *
     * Counting sort rather than per-cell arrays: one pass to count, a prefix
     * sum, one pass to scatter. Scattering in ascending entry index leaves each
     * cell's slice ascending, which the pair-dedup relies on.
     */
    buildGrid(cellSize: number): void {
        const n = this.count;
        this.cellCount = 0;
        // Worst case every mob lands in its own cell.
        this.resetCellTable(n);

        for (let i = 0; i < n; i++) {
            const cx = Math.floor(this.x[i] / cellSize);
            const cy = Math.floor(this.y[i] / cellSize);
            this.cellId[i] = this.internCell(cellKeyOf(cx, cy));
        }
        const cells = this.cellCount;

        if (this.cellStart.length < cells + 1) {
            let k = this.cellStart.length || 256;
            while (k < cells + 1) k *= 2;
            this.cellStart = new Int32Array(k);
        } else {
            this.cellStart.fill(0, 0, cells + 1);
        }

        const start = this.cellStart;
        for (let i = 0; i < n; i++) start[this.cellId[i] + 1]++;
        for (let c = 0; c < cells; c++) start[c + 1] += start[c];

        // Scatter with a moving cursor per cell, then restore the offsets.
        const cursor = new Int32Array(cells);
        for (let i = 0; i < n; i++) {
            const id = this.cellId[i];
            this.sorted[start[id] + cursor[id]++] = i;
        }
    }

    /** Dense cell id for a grid coordinate, or -1 when the cell is empty. */
    cellAt(cx: number, cy: number): number {
        return lookupCell(this.hashKeys, this.hashVals, this.hashMask, cellKeyOf(cx, cy));
    }
}
