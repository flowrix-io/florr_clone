/**
 * Mob-vs-mob collision and pet melee — the port of `checkEnemyEnemyCollisions`.
 *
 * The original was an all-pairs loop with a `getMobStats` call per pair, i.e.
 * O(E²) with a config lookup inside. That was survivable at a few hundred wild
 * mobs, but pet eggs multiply the population (an apex egg spawns 3 pets, a
 * centipede pet is 10 entities) and this pass alone froze the tick once several
 * players stacked eggs. It was rewritten to bucket into a uniform grid, and
 * that structure is preserved here exactly.
 *
 * Note this pass uses its OWN grid rather than the shared SpatialGrid, for the
 * same reason it always did: it must include PETS, while the shared grid
 * deliberately excludes them so broad-phase callers do not have to filter.
 *
 * The damage callbacks are injected. Applying a mob death means awarding XP and
 * drops and emitting to clients, and the original reached back into server.ts
 * through `require('../server')` mid-function to do it — a circular import that
 * only worked because it was lazy. Injecting the two hooks removes that cycle.
 */

import * as C from '../components';
import { Entity, entityIndex, NULL_ENTITY } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';
import { MobActivityField } from './lod';
import { ENTRY_IS_PET, ENTRY_NO_COLLISION, MobCollisionSet } from './mobCollisionData';
import { KernelInput, KernelOutput, scanRange } from './mobCollisionKernel';

function ensureF64(arr: Float64Array, n: number): Float64Array {
    return arr.length >= n ? arr : new Float64Array(Math.max(n, 1024));
}
function ensureI32(arr: Int32Array, n: number): Int32Array {
    return arr.length >= n ? arr : new Int32Array(Math.max(n, 4096));
}

/** Packs the kernel's read-only view. Allocated per pass; it is one small object. */
function kernelInput(
    x: Float64Array, y: Float64Array, radius: Float32Array, head: Float64Array,
    flags: Uint8Array, cellStart: Int32Array, sorted: Int32Array,
    hashKeys: Int32Array, hashVals: Int32Array, hashMask: number,
    count: number, maxRadius: number,
): KernelInput {
    return {
        x, y, radius, head, flags, cellStart, sorted, hashKeys, hashVals, hashMask,
        count, maxRadius,
        cellSize: COLLISION_CELL_SIZE,
        collisionBuffer: MOB_COLLISION_BUFFER,
        maxPushPerPair: MAX_PUSH_PER_TICK,
        nullHead: NULL_ENTITY as unknown as number,
    };
}

/** Gap maintained between mobs, on top of their radii. */
const MOB_COLLISION_BUFFER = 5;

/**
 * Cap on how far a pair may be separated in one tick.
 *
 * Mobs that spawn (or wander) deeply overlapped ease apart over a few ticks
 * instead of teleporting. Steady walking-into-each-other overlap is far below
 * this, so normal contact still resolves fully within the tick.
 */
const MAX_PUSH_PER_TICK = 10;

/**
 * How many per-pair pushes a mob may accumulate in one tick.
 *
 * The original clamped each PAIR to MAX_PUSH_PER_TICK and applied them one
 * after another, so a mob wedged between several others could travel several
 * times that in a tick — each step shrinking the next overlap, which is what
 * made it converge. Jacobi computes all its pushes at once, so clamping the sum
 * to a single MAX_PUSH_PER_TICK would separate a crowd strictly slower than the
 * old pass did. This headroom restores comparable convergence while still
 * bounding how far one tick can teleport a mob.
 */
// Measured: at 9000 mobs, residual overlapping pairs after 200 ticks were
// 8737 at 1x, 8277 at 2x, 8184 at 3x, and flat beyond — so 3 is where this
// stops buying convergence. (Not read from the environment: this file is
// compiled for the client too, where `process` does not exist.)
const JACOBI_PUSH_HEADROOM = 3;

/**
 * Broad-phase cell size. Must exceed the largest collision reach; 512 matches
 * the shared grid and comfortably covers real mob sizes.
 */
const COLLISION_CELL_SIZE = 512;

/** Coordinates past this make the cell-range loops non-terminating. */
const MAX_SANE_WORLD_COORD = 1e9;

export interface MobCollisionDeps {
    /** Push an entity out of any wall it overlaps. */
    resolveWall(x: number, y: number, halfSize: number): { x: number; y: number };
    /**
     * True when this mob's config sets `no_mob_collision` (ant holes and the
     * like), which exempts it from pushing and being pushed.
     */
    noMobCollision(mob: Entity): boolean;
    /**
     * Credit `amount` of damage on `victim` to `playerEntity`, for XP and drop
     * attribution. Only called for pet-dealt damage, since contributors are
     * keyed by player.
     */
    creditDamage(victim: Entity, playerEntity: Entity, amount: number): void;
    /** Mark the victim as damaged this tick, for the batched damage broadcast. */
    onDamaged(victim: Entity): void;
    /** The victim's health reached zero. Awards XP/drops and emits. */
    onKilled(victim: Entity): void;
    /**
     * Which mobs are near enough to a player to be worth colliding this tick.
     * See systems/lod.ts. A mob left out of the broad phase is also excluded as
     * a PAIR TARGET, so a distant shove is missed entirely rather than applied
     * one-sided — which is the honest behaviour, and unobservable at that range.
     */
    activity: MobActivityField;
    /**
     * Optional worker pool for the separation kernel. Absent (or declining a
     * given tick) means the identical kernel runs inline on this thread — the
     * simulation result is the same either way, which is the point.
     */
    parallel?: CollisionParallel;
}

/**
 * The parallel executor for the separation kernel, injected by the server.
 *
 * Declared here as a plain interface so this system — which the client bundle
 * also compiles — never imports `worker_threads`. server/collisionWorkerPool.ts
 * supplies the real one; the benches and the client supply nothing and the pass
 * runs the identical kernel inline.
 */
export interface CollisionParallel {
    /** False when the pool cannot take this many entries; caller runs inline. */
    canHandle(count: number): boolean;
    /** Shared views the caller fills before each run. */
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
    readonly workerCount: number;
    readonly buffers: { contactsPerWorker: number };
    run(
        count: number, maxRadius: number, cellSize: number, collisionBuffer: number,
        maxPushPerPair: number, nullHead: number, hashMask: number,
        runMainShare: (from: number, to: number, slab: number) => void,
    ): void;
    contactCount(slab: number): number;
    contactOverflow(slab: number): number;
}

export interface MobCollisionQueries {
    /** Every living mob INCLUDING pets — this pass resolves pet/wild contact. */
    mobs: Query;
}

export function createMobCollisionQueries(world: World): MobCollisionQueries {
    return {
        mobs: world.query([C.Position, C.Radius, C.Health, C.Damage, C.IsEnemy], [C.IsDead]),
    };
}


export function mobCollisionSystem(queries: MobCollisionQueries, deps: MobCollisionDeps) {
    const { resolveWall, noMobCollision, creditDamage, onDamaged, onKilled, activity } = deps;

    // Reused across ticks so a normal tick allocates nothing. See
    // mobCollisionData.ts — flat arrays rather than per-mob objects.
    const set = new MobCollisionSet();
    const { parallel } = deps;

    // Serial-path scratch, grown on demand and reused.
    let serialDeltaX = new Float64Array(0);
    let serialDeltaY = new Float64Array(0);
    let serialContactA = new Int32Array(0);
    let serialContactB = new Int32Array(0);
    const serialOut: KernelOutput = {
        deltaX: serialDeltaX, deltaY: serialDeltaY,
        contactA: serialContactA, contactB: serialContactB,
        contactCount: 0, contactOverflow: 0,
    };
    /** Reused output header for this thread's share of a parallel pass. */
    const mainOut: KernelOutput = {
        deltaX: serialDeltaX, deltaY: serialDeltaY,
        contactA: serialContactA, contactB: serialContactB,
        contactCount: 0, contactOverflow: 0,
    };

    /** Apply damage, reporting death exactly once. */
    function applyDamage(world: World, victim: Entity, amount: number, attackerOwner: Entity): void {
        if (world.has(victim, C.IsDead)) return;
        const current = world.get(victim, C.Health, 'current') as number;
        if (current <= 0) return;

        // A pet's kill is credited to its owner; contributors are keyed by player.
        if (attackerOwner !== NULL_ENTITY && world.isAlive(attackerOwner)) {
            creditDamage(victim, attackerOwner, amount);
        }

        const next = Math.max(0, current - amount);
        world.set(victim, C.Health, 'current', next);
        onDamaged(victim);

        if (next <= 0) {
            world.add(victim, C.IsDead);
            onKilled(victim);
        }
    }

    return (ctx: SystemContext): void => {
        const world = ctx.world;

        // --- broad phase -------------------------------------------------------
        set.reset();

        queries.mobs.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const rad = chunk.cols(C.Radius);
            const dmg = chunk.cols(C.Damage);
            const entities = chunk.entities;

            // Archetype membership is uniform within a chunk, so these are
            // hoisted out of the row loop. They used to be `world.has` /
            // `world.get` per mob — 9000 archetype lookups a tick, and the
            // largest single cost in this (serial) broad phase.
            const petOwner = chunk.has(C.PetOwner) ? chunk.cols(C.PetOwner) : null;
            const segment = chunk.has(C.CentipedeSegment) ? chunk.cols(C.CentipedeSegment) : null;
            const petFlag = petOwner ? ENTRY_IS_PET : 0;

            for (let i = 0; i < chunk.count; i++) {
                const entity = entities[i] as Entity;
                const x = pos.x[i];
                const y = pos.y[i];

                // A degenerate position makes the cell-range loops below spin
                // forever (past 2^53, `cx++` is a no-op). Such a mob sits this
                // pass out — and, because it never enters the set, it is also
                // excluded as a pair target.
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                if (Math.abs(x) > MAX_SANE_WORLD_COORD || Math.abs(y) > MAX_SANE_WORLD_COORD) continue;

                // Far from every player: sit this tick out, most ticks. Done
                // here rather than in the narrow phase so a distant mob costs
                // neither an entry nor a grid slot.
                if (!activity.shouldStep(entity, x, y, ctx.tick)) continue;

                set.push(
                    entity, x, y, rad.value[i], dmg.value[i],
                    petOwner ? (petOwner.owner[i] as unknown as Entity) : NULL_ENTITY,
                    segment ? (segment.head[i] as unknown as Entity) : NULL_ENTITY,
                    petFlag | (noMobCollision(entity) ? ENTRY_NO_COLLISION : 0),
                );
            }
        });

        set.buildGrid(COLLISION_CELL_SIZE);

        const n = set.count;
        if (n === 0) return;

        // --- separation kernel (parallel when a pool is available) -------------
        //
        // Jacobi, not the original in-place Gauss-Seidel: every push is computed
        // from this tick's starting positions and applied afterwards. See
        // mobCollisionKernel.ts for why, and for why that makes the result the
        // same whether it runs on one thread or eight.
        const pool = parallel && parallel.canHandle(n) ? parallel : null;

        let deltaX: Float64Array;
        let deltaY: Float64Array;
        let slabs: number;
        let contactA: Int32Array;
        let contactB: Int32Array;
        let slabSize: number;
        let contactsOf: (slab: number) => number;

        if (pool) {
            // Publish this tick's set into the shared buffers, then split the
            // range across the workers and this thread.
            pool.x.set(set.x.subarray(0, n));
            pool.y.set(set.y.subarray(0, n));
            pool.radius.set(set.radius.subarray(0, n));
            pool.head.set(set.head.subarray(0, n));
            pool.flags.set(set.flags.subarray(0, n));
            pool.sorted.set(set.sorted.subarray(0, n));
            pool.cellStart.set(set.cellStart.subarray(0, set.cellCount + 1));
            pool.hashKeys.set(set.hashKeys);
            pool.hashVals.set(set.hashVals);

            slabSize = pool.buffers.contactsPerWorker;
            const input = kernelInput(pool.x, pool.y, pool.radius, pool.head, pool.flags,
                pool.cellStart, pool.sorted, pool.hashKeys, pool.hashVals, set.hashMask, n, set.maxRadius);

            pool.run(
                n, set.maxRadius, COLLISION_CELL_SIZE, MOB_COLLISION_BUFFER,
                MAX_PUSH_PER_TICK, NULL_ENTITY as unknown as number, set.hashMask,
                (from, to, slab) => {
                    mainOut.deltaX = pool.deltaX;
                    mainOut.deltaY = pool.deltaY;
                    mainOut.contactA = pool.contactA.subarray(slab * slabSize, (slab + 1) * slabSize);
                    mainOut.contactB = pool.contactB.subarray(slab * slabSize, (slab + 1) * slabSize);
                    scanRange(input, from, to, mainOut);
                },
            );

            deltaX = pool.deltaX;
            deltaY = pool.deltaY;
            contactA = pool.contactA;
            contactB = pool.contactB;
            slabs = pool.workerCount + 1;
            const mainSlab = pool.workerCount;
            const mainContacts = mainOut.contactCount;
            contactsOf = slab => (slab === mainSlab ? mainContacts : pool.contactCount(slab));
        } else {
            // Inline: one range, one slab, same kernel.
            serialDeltaX = ensureF64(serialDeltaX, n);
            serialDeltaY = ensureF64(serialDeltaY, n);
            serialContactA = ensureI32(serialContactA, n * 4);
            serialContactB = ensureI32(serialContactB, n * 4);
            serialOut.deltaX = serialDeltaX;
            serialOut.deltaY = serialDeltaY;
            serialOut.contactA = serialContactA;
            serialOut.contactB = serialContactB;

            scanRange(
                kernelInput(set.x, set.y, set.radius, set.head, set.flags,
                    set.cellStart, set.sorted, set.hashKeys, set.hashVals,
                    set.hashMask, n, set.maxRadius),
                0, n, serialOut,
            );

            deltaX = serialDeltaX;
            deltaY = serialDeltaY;
            contactA = serialContactA;
            contactB = serialContactB;
            slabs = 1;
            slabSize = serialContactA.length;
            const c = serialOut.contactCount;
            contactsOf = () => c;
        }

        // --- apply separation --------------------------------------------------
        const xs = set.x;
        const ys = set.y;
        const handles = set.entity;
        for (let i = 0; i < n; i++) {
            let dx = deltaX[i];
            let dy = deltaY[i];
            if (dx === 0 && dy === 0) continue;

            // Jacobi sums every neighbour's push at once, so the total is capped
            // here rather than per pair. Deep overlaps still ease apart over a
            // few ticks, which is what MAX_PUSH_PER_TICK has always meant.
            const cap = MAX_PUSH_PER_TICK * JACOBI_PUSH_HEADROOM;
            const mag = Math.sqrt(dx * dx + dy * dy);
            if (mag > cap) {
                const scale = cap / mag;
                dx *= scale;
                dy *= scale;
            }

            const entity = handles[i] as unknown as Entity;
            if (!world.isAlive(entity) || world.has(entity, C.IsDead)) continue;

            // Separation must not shove a mob into a wall. This pass runs after
            // the per-mob wall pass, so a violation would be visible for a tick.
            const resolved = resolveWall(xs[i] + dx, ys[i] + dy, set.radius[i]);
            xs[i] = resolved.x;
            ys[i] = resolved.y;
            world.write(entity, C.Position, { x: resolved.x, y: resolved.y });
        }

        // --- apply contact damage ----------------------------------------------
        // Pet/wild contact deals damage both ways, every tick, with no cooldown.
        // Pet-vs-pet and wild-vs-wild do not. Slabs are walked in worker order
        // and each slab is in ascending entry order, so this is deterministic.
        const damages = set.damage;
        const owners = set.owner;
        const flags = set.flags;
        for (let slab = 0; slab < slabs; slab++) {
            const base = slabs === 1 ? 0 : slab * slabSize;
            const count = contactsOf(slab);
            for (let c = 0; c < count; c++) {
                const i = contactA[base + c];
                const j = contactB[base + c];
                const iIsPet = (flags[i] & ENTRY_IS_PET) !== 0;
                if (iIsPet === ((flags[j] & ENTRY_IS_PET) !== 0)) continue;

                const petIdx = iIsPet ? i : j;
                const wildIdx = iIsPet ? j : i;
                applyDamage(world, handles[wildIdx] as unknown as Entity,
                            damages[petIdx], owners[petIdx] as unknown as Entity);
                applyDamage(world, handles[petIdx] as unknown as Entity,
                            damages[wildIdx], NULL_ENTITY);
            }
        }
    };
}

export function registerMobCollisionSystem(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: MobCollisionQueries,
    deps: MobCollisionDeps,
): void {
    // Combat phase: after all movement, before the Lifetime reaper, so a mob
    // killed here is still readable by anything that runs later this tick.
    scheduler.add('mobCollision', Phase.Combat, mobCollisionSystem(queries, deps));
}

/** Exposed for diagnostics/tests: the slot a handle occupies. */
export { entityIndex };
