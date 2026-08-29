"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MobCollisionSet = exports.ENTRY_NO_COLLISION = exports.ENTRY_IS_PET = exports.EMPTY_KEY = void 0;
exports.cellKeyOf = cellKeyOf;
exports.lookupCell = lookupCell;
/** Free-slot marker in the cell table. Real keys are always >= 0. */
exports.EMPTY_KEY = -1;
/**
 * Packs a grid coordinate into a single non-negative key.
 *
 * The +1024 bias keeps coordinates near the origin positive; the mask keeps the
 * two axes in disjoint bit ranges. Multiplication rather than `<< 16` so the key
 * does not wrap through int32 for far-out coordinates the way the original did.
 */
function cellKeyOf(cx, cy) {
    return ((cy + 1024) * 65536) + ((cx + 1024) & 0xFFFF);
}
/** Probes the cell table. Returns the dense cell id, or -1 when absent. */
function lookupCell(keys, vals, mask, key) {
    let slot = (Math.imul(key, 0x9E3779B1) >>> 0) & mask;
    for (;;) {
        const k = keys[slot];
        if (k === exports.EMPTY_KEY)
            return -1;
        if (k === key)
            return vals[slot];
        slot = (slot + 1) & mask;
    }
}
/** Bit flags packed into `flags`. */
exports.ENTRY_IS_PET = 1 << 0;
exports.ENTRY_NO_COLLISION = 1 << 1;
/**
 * Grows a typed array to at least `needed`, PRESERVING its contents.
 *
 * The copy is not optional: `push` grows mid-broad-phase, so dropping the
 * existing entries silently zeroes every mob appended before the resize. That
 * is invisible below the initial 1024 capacity and corrupts every tick above
 * it — the collision set quietly loses its first 1024 mobs.
 */
function grow(arr, needed, make) {
    if (arr.length >= needed)
        return arr;
    let n = arr.length || 1024;
    while (n < needed)
        n *= 2;
    const next = make(n);
    next.set(arr);
    return next;
}
class MobCollisionSet {
    constructor() {
        /** Number of live entries this tick. */
        this.count = 0;
        this.entity = new Float64Array(0);
        this.x = new Float64Array(0);
        this.y = new Float64Array(0);
        this.radius = new Float32Array(0);
        this.damage = new Float32Array(0);
        this.owner = new Float64Array(0);
        /** Centipede chain identity; NULL_ENTITY when the mob is not a segment. */
        this.head = new Float64Array(0);
        this.flags = new Uint8Array(0);
        /** Largest radius in the set, for the neighbour-scan reach. */
        this.maxRadius = 0;
        // ---- uniform grid (counting sort) ----
        /** Dense cell id per entry. */
        this.cellId = new Int32Array(0);
        /** Start offset of each dense cell in `sorted`. Length cellCount + 1. */
        this.cellStart = new Int32Array(0);
        /** Entry indices grouped by cell, ascending within each cell. */
        this.sorted = new Int32Array(0);
        /**
         * Sparse cell key -> dense cell id, as an open-addressed table.
         *
         * A Map would be the obvious choice and was the original one, but a Map
         * cannot be read from a worker thread. Linear probing over two Int32Arrays
         * can, and it is also faster in the serial path: the narrow phase probes
         * this once per neighbouring cell per mob, which is the hottest lookup in
         * the pass. EMPTY_KEY marks a free slot; keys are always >= 0.
         */
        this.hashKeys = new Int32Array(0);
        this.hashVals = new Int32Array(0);
        this.hashMask = 0;
        this.cellCount = 0;
    }
    /** Discard the previous tick's contents. Keeps the buffers. */
    reset() {
        this.count = 0;
        this.maxRadius = 0;
        this.cellCount = 0;
    }
    /** Sizes and clears the cell table for up to `cells` distinct cells. */
    resetCellTable(cells) {
        let cap = 64;
        while (cap < cells * 2)
            cap *= 2;
        if (this.hashKeys.length !== cap) {
            this.hashKeys = new Int32Array(cap);
            this.hashVals = new Int32Array(cap);
        }
        this.hashKeys.fill(exports.EMPTY_KEY);
        this.hashMask = cap - 1;
    }
    /** Interns `key`, returning its dense cell id. */
    internCell(key) {
        const keys = this.hashKeys;
        const mask = this.hashMask;
        // Fibonacci hashing, then linear probe. The table is never more than
        // half full, so the probe chain stays short.
        let slot = (Math.imul(key, 0x9E3779B1) >>> 0) & mask;
        for (;;) {
            const k = keys[slot];
            if (k === exports.EMPTY_KEY) {
                keys[slot] = key;
                const id = this.cellCount++;
                this.hashVals[slot] = id;
                return id;
            }
            if (k === key)
                return this.hashVals[slot];
            slot = (slot + 1) & mask;
        }
    }
    /** Make room for `n` entries. */
    ensure(n) {
        if (this.entity.length >= n)
            return;
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
    push(entity, x, y, radius, damage, owner, head, flags) {
        const i = this.count;
        this.ensure(i + 1);
        this.entity[i] = entity;
        this.x[i] = x;
        this.y[i] = y;
        this.radius[i] = radius;
        this.damage[i] = damage;
        this.owner[i] = owner;
        this.head[i] = head;
        this.flags[i] = flags;
        if (radius > this.maxRadius)
            this.maxRadius = radius;
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
    buildGrid(cellSize) {
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
            while (k < cells + 1)
                k *= 2;
            this.cellStart = new Int32Array(k);
        }
        else {
            this.cellStart.fill(0, 0, cells + 1);
        }
        const start = this.cellStart;
        for (let i = 0; i < n; i++)
            start[this.cellId[i] + 1]++;
        for (let c = 0; c < cells; c++)
            start[c + 1] += start[c];
        // Scatter with a moving cursor per cell, then restore the offsets.
        const cursor = new Int32Array(cells);
        for (let i = 0; i < n; i++) {
            const id = this.cellId[i];
            this.sorted[start[id] + cursor[id]++] = i;
        }
    }
    /** Dense cell id for a grid coordinate, or -1 when the cell is empty. */
    cellAt(cx, cy) {
        return lookupCell(this.hashKeys, this.hashVals, this.hashMask, cellKeyOf(cx, cy));
    }
}
exports.MobCollisionSet = MobCollisionSet;
