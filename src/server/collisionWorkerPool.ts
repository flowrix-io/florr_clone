/**
 * A persistent worker pool for the mob-collision kernel.
 *
 * ---------------------------------------------------------------------------
 * Why it looks like this
 * ---------------------------------------------------------------------------
 * The tick has a 33ms budget and mob collision is the largest single item in
 * it, so the parallel machinery has to be effectively free. Two consequences:
 *
 *  - Workers are started ONCE at boot and then live forever. Spawning a worker
 *    costs tens of milliseconds; doing it per tick would cost more than the pass
 *    it parallelises.
 *  - Handoff is `Atomics` on a shared control block, not `postMessage`.
 *    postMessage is a structured clone through the event loop — hundreds of
 *    microseconds each way and, worse, it cannot complete while the tick is
 *    still running, so the main thread could not wait for it. Atomics.wait /
 *    Atomics.notify is a few microseconds and works inside a synchronous tick.
 *
 * The mob data lives in SharedArrayBuffers that every worker maps at startup,
 * so a tick hands over a range of indices rather than any data.
 *
 * This module is the only place that touches `worker_threads`. The ECS system
 * takes the pool as an injected dependency, so the client bundle never reaches
 * it and the benches can run the identical kernel with no workers at all.
 */

import { Worker } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';

/** Hard cap on the mobs one parallel pass can carry. Above this: serial. */
export const MAX_PARALLEL_ENTRIES = 16384;
/** Contact slab per worker. Overflow degrades damage, never correctness. */
const CONTACTS_PER_WORKER = 1 << 15;
/** Open-addressed cell table capacity (power of two, >= 2x entries). */
const CELL_TABLE_CAP = 1 << 15;

// Control block slots.
const CTL_GENERATION = 0;
const CTL_PENDING = 1;
const CTL_SHUTDOWN = 2;
const CTL_SLOTS = 8;

// Params block slots (f64).
const P_COUNT = 0;
const P_MAX_RADIUS = 1;
const P_CELL_SIZE = 2;
const P_BUFFER = 3;
const P_MAX_PUSH = 4;
const P_NULL_HEAD = 5;
const P_HASH_MASK = 6;
const P_SLOTS = 8;

/** Every shared buffer a worker maps. Sent once, at worker startup. */
export interface CollisionSharedBuffers {
    control: SharedArrayBuffer;
    params: SharedArrayBuffer;
    x: SharedArrayBuffer;
    y: SharedArrayBuffer;
    radius: SharedArrayBuffer;
    head: SharedArrayBuffer;
    flags: SharedArrayBuffer;
    cellStart: SharedArrayBuffer;
    sorted: SharedArrayBuffer;
    hashKeys: SharedArrayBuffer;
    hashVals: SharedArrayBuffer;
    deltaX: SharedArrayBuffer;
    deltaY: SharedArrayBuffer;
    contactA: SharedArrayBuffer;
    contactB: SharedArrayBuffer;
    contactMeta: SharedArrayBuffer;
    /** Inclusive-exclusive [from, to) per worker, plus the main thread's share. */
    ranges: SharedArrayBuffer;
    workerCount: number;
    contactsPerWorker: number;
}

function sab(bytes: number): SharedArrayBuffer {
    return new SharedArrayBuffer(bytes);
}

/**
 * How many workers to start.
 *
 * One fewer than the cores, because the main thread takes a share of the range
 * itself rather than idling — and on a 2-vCPU box that means one worker beside
 * the tick, which is the whole available win there. Zero on a single core, in
 * which case the caller runs the kernel inline.
 */
export function defaultWorkerCount(): number {
    const cores = os.cpus()?.length ?? 1;
    return Math.max(0, Math.min(cores - 1, 7));
}

export class CollisionWorkerPool {
    private readonly workers: Worker[] = [];
    private readonly control: Int32Array;
    private readonly params: Float64Array;
    private readonly ranges: Int32Array;
    private readonly contactMeta: Int32Array;
    private generation = 0;
    private disposed = false;

    readonly buffers: CollisionSharedBuffers;
    readonly workerCount: number;

    /** Views the caller fills each tick. */
    readonly x: Float64Array;
    readonly y: Float64Array;
    readonly radius: Float32Array;
    readonly head: Float64Array;
    readonly flags: Uint8Array;
    readonly cellStart: Int32Array;
    readonly sorted: Int32Array;
    readonly hashKeys: Int32Array;
    readonly hashVals: Int32Array;
    readonly deltaX: Float64Array;
    readonly deltaY: Float64Array;
    readonly contactA: Int32Array;
    readonly contactB: Int32Array;

    constructor(workerCount: number = defaultWorkerCount(), entryPath?: string) {
        this.workerCount = workerCount;
        const N = MAX_PARALLEL_ENTRIES;

        this.buffers = {
            control: sab(CTL_SLOTS * 4),
            params: sab(P_SLOTS * 8),
            x: sab(N * 8),
            y: sab(N * 8),
            radius: sab(N * 4),
            head: sab(N * 8),
            flags: sab(N),
            cellStart: sab((N + 1) * 4),
            sorted: sab(N * 4),
            hashKeys: sab(CELL_TABLE_CAP * 4),
            hashVals: sab(CELL_TABLE_CAP * 4),
            deltaX: sab(N * 8),
            deltaY: sab(N * 8),
            contactA: sab((workerCount + 1) * CONTACTS_PER_WORKER * 4),
            contactB: sab((workerCount + 1) * CONTACTS_PER_WORKER * 4),
            contactMeta: sab((workerCount + 1) * 2 * 4),
            ranges: sab((workerCount + 1) * 2 * 4),
            workerCount,
            contactsPerWorker: CONTACTS_PER_WORKER,
        };

        const b = this.buffers;
        this.control = new Int32Array(b.control);
        this.params = new Float64Array(b.params);
        this.ranges = new Int32Array(b.ranges);
        this.contactMeta = new Int32Array(b.contactMeta);
        this.x = new Float64Array(b.x);
        this.y = new Float64Array(b.y);
        this.radius = new Float32Array(b.radius);
        this.head = new Float64Array(b.head);
        this.flags = new Uint8Array(b.flags);
        this.cellStart = new Int32Array(b.cellStart);
        this.sorted = new Int32Array(b.sorted);
        this.hashKeys = new Int32Array(b.hashKeys);
        this.hashVals = new Int32Array(b.hashVals);
        this.deltaX = new Float64Array(b.deltaX);
        this.deltaY = new Float64Array(b.deltaY);
        this.contactA = new Int32Array(b.contactA);
        this.contactB = new Int32Array(b.contactB);

        const entry = entryPath ?? path.join(__dirname, 'collisionWorkerEntry.js');
        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(entry, { workerData: { buffers: b, index: i } });
            // A worker that dies takes its range's separation with it, which is
            // a visible physics glitch, not a crash — so log loudly and let the
            // pass carry on with the remaining threads.
            worker.on('error', err => console.error('[collision-worker] died:', err));
            worker.unref();
            this.workers.push(worker);
        }
    }

    /** Capacity check: the caller must fall back to serial when this is false. */
    canHandle(count: number): boolean {
        return !this.disposed && this.workerCount > 0 && count <= MAX_PARALLEL_ENTRIES;
    }

    /**
     * Splits `[0, count)` across the workers and the main thread, runs the
     * kernel everywhere, and blocks until every range is done.
     *
     * `runMainShare` is invoked with the main thread's own range while the
     * workers are busy — the main thread is a participant, not a supervisor.
     */
    run(
        count: number,
        maxRadius: number,
        cellSize: number,
        collisionBuffer: number,
        maxPushPerPair: number,
        nullHead: number,
        hashMask: number,
        runMainShare: (from: number, to: number, slab: number) => void,
    ): void {
        const parts = this.workerCount + 1;
        // Whole-cell-agnostic even split; every entry is owned exactly once.
        const per = Math.ceil(count / parts);
        for (let p = 0; p < parts; p++) {
            const from = Math.min(p * per, count);
            const to = Math.min(from + per, count);
            this.ranges[p * 2] = from;
            this.ranges[p * 2 + 1] = to;
            this.contactMeta[p * 2] = 0;
            this.contactMeta[p * 2 + 1] = 0;
        }

        this.params[P_COUNT] = count;
        this.params[P_MAX_RADIUS] = maxRadius;
        this.params[P_CELL_SIZE] = cellSize;
        this.params[P_BUFFER] = collisionBuffer;
        this.params[P_MAX_PUSH] = maxPushPerPair;
        this.params[P_NULL_HEAD] = nullHead;
        this.params[P_HASH_MASK] = hashMask;

        // Release the workers, then do our own share while they run.
        Atomics.store(this.control, CTL_PENDING, this.workerCount);
        Atomics.store(this.control, CTL_GENERATION, ++this.generation);
        Atomics.notify(this.control, CTL_GENERATION);

        const mainSlab = this.workerCount;
        runMainShare(this.ranges[mainSlab * 2], this.ranges[mainSlab * 2 + 1], mainSlab);

        // Barrier. Spin briefly before sleeping: the workers are usually already
        // finishing, and Atomics.wait costs a syscall.
        let spins = 0;
        while (Atomics.load(this.control, CTL_PENDING) > 0) {
            if (spins++ < 256) continue;
            const pending = Atomics.load(this.control, CTL_PENDING);
            if (pending > 0) Atomics.wait(this.control, CTL_PENDING, pending, 50);
        }
    }

    /** Contacts written by slab `p` this pass. */
    contactCount(p: number): number {
        return this.contactMeta[p * 2];
    }

    /** Contacts slab `p` had to drop. Non-zero means CONTACTS_PER_WORKER is low. */
    contactOverflow(p: number): number {
        return this.contactMeta[p * 2 + 1];
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        Atomics.store(this.control, CTL_SHUTDOWN, 1);
        Atomics.store(this.control, CTL_GENERATION, ++this.generation);
        Atomics.notify(this.control, CTL_GENERATION);
        for (const w of this.workers) void w.terminate();
        this.workers.length = 0;
    }
}

export const CONTROL_SLOTS = {
    CTL_GENERATION, CTL_PENDING, CTL_SHUTDOWN,
};
export const PARAM_SLOTS = {
    P_COUNT, P_MAX_RADIUS, P_CELL_SIZE, P_BUFFER, P_MAX_PUSH, P_NULL_HEAD, P_HASH_MASK,
};
