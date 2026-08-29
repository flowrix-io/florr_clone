/**
 * The mob-vs-mob separation kernel: pure arithmetic over flat arrays.
 *
 * ---------------------------------------------------------------------------
 * Why this is Jacobi and not the original Gauss-Seidel
 * ---------------------------------------------------------------------------
 * The original narrow phase mutated BOTH mobs of a pair as it went, so a pair
 * resolved later in the loop saw positions already moved by earlier pairs. That
 * is Gauss-Seidel relaxation, and it is inherently sequential: the result
 * depends on the order entries happen to be visited in, so it cannot be split
 * across threads at all.
 *
 * This kernel instead reads ONLY pre-tick positions and accumulates a push per
 * mob, which the caller applies afterwards — Jacobi relaxation. Two consequences
 * that are the whole point:
 *
 *   - Each entry's output depends on nothing any other entry writes, so a range
 *     of entries can be computed by any thread with no locking and no races.
 *   - The result does not depend on how the range was split, so the simulation
 *     is identical on one core and on eight. A game whose physics changed with
 *     the host's core count would be indefensible.
 *
 * The cost is that a mob touching several neighbours accumulates all their
 * pushes at once rather than partially resolving between them, so the caller
 * clamps the accumulated magnitude — see MAX_PUSH_PER_TICK at the call site.
 * Steady contact still resolves over a few ticks, exactly as before.
 *
 * Every pair is evaluated twice, once from each side, because a thread may only
 * write its own entries. That doubles the pair tests and is what buys the
 * lock-free split; it is a good trade beyond about two threads.
 */

import { ENTRY_IS_PET, ENTRY_NO_COLLISION, cellKeyOf, lookupCell } from './mobCollisionData';

/** Read-only view of the collision set, as plain arrays a worker can share. */
export interface KernelInput {
    x: Float64Array;
    y: Float64Array;
    radius: Float32Array;
    head: Float64Array;
    flags: Uint8Array;
    cellStart: Int32Array;
    sorted: Int32Array;
    hashKeys: Int32Array;
    hashVals: Int32Array;
    hashMask: number;
    count: number;
    maxRadius: number;
    cellSize: number;
    collisionBuffer: number;
    maxPushPerPair: number;
    /** Sentinel for "not a centipede segment". */
    nullHead: number;
}

/** Per-entry output. `deltaX/deltaY` are written only for the owned range. */
export interface KernelOutput {
    deltaX: Float64Array;
    deltaY: Float64Array;
    /** Contact pairs, recorded once (from the lower-indexed side). */
    contactA: Int32Array;
    contactB: Int32Array;
    /** Number of contacts written into this slab. */
    contactCount: number;
    /** Contacts dropped because the slab was full. */
    contactOverflow: number;
}

/**
 * Computes separation pushes for entries `[from, to)` against the whole set.
 *
 * Writes `deltaX/deltaY` at those indices only, and appends the contacts it owns
 * (those where the lower-indexed mob is in range) to the output slab. Touches
 * nothing else, so concurrent calls over disjoint ranges are safe.
 */
export function scanRange(
    input: KernelInput,
    from: number,
    to: number,
    out: KernelOutput,
): void {
    const { x, y, radius, head, flags, cellStart, sorted, hashKeys, hashVals,
            hashMask, maxRadius, cellSize, collisionBuffer, maxPushPerPair, nullHead } = input;
    const { deltaX, deltaY, contactA, contactB } = out;
    const contactCap = contactA.length;
    let contacts = 0;
    let overflow = 0;

    for (let i = from; i < to; i++) {
        const selfFlags = flags[i];
        const selfRadius = radius[i];
        const selfHead = head[i];
        const sx = x[i];
        const sy = y[i];

        let ax = 0;
        let ay = 0;

        // Anything close enough to touch is within this mob's radius plus the
        // largest radius in play plus the buffer.
        const reach = selfRadius + maxRadius + collisionBuffer;
        const minCX = Math.floor((sx - reach) / cellSize);
        const maxCX = Math.floor((sx + reach) / cellSize);
        const minCY = Math.floor((sy - reach) / cellSize);
        const maxCY = Math.floor((sy + reach) / cellSize);

        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const cell = lookupCell(hashKeys, hashVals, hashMask, cellKeyOf(cx, cy));
                if (cell < 0) continue;
                const end = cellStart[cell + 1];

                for (let s = cellStart[cell]; s < end; s++) {
                    const j = sorted[s];
                    if (j === i) continue;

                    // Segments of one centipede never push each other: the
                    // chain-follow pass keeps them in formation, and physical
                    // push-apart makes them tangle and spin.
                    if (selfHead !== nullHead && selfHead === head[j]) continue;

                    // Mobs flagged no_mob_collision neither push nor are pushed.
                    if (((selfFlags | flags[j]) & ENTRY_NO_COLLISION) !== 0) continue;

                    const dx = x[j] - sx;
                    const dy = y[j] - sy;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const minDistance = selfRadius + radius[j] + collisionBuffer;
                    if (!(distance < minDistance && distance > 0)) continue;

                    const push = Math.min((minDistance - distance) / 2, maxPushPerPair);
                    ax -= (dx / distance) * push;
                    ay -= (dy / distance) * push;

                    // Record each contact once, from the lower-indexed side, so
                    // the caller applies pet/wild damage exactly once per pair.
                    if (i < j) {
                        if (contacts < contactCap) {
                            contactA[contacts] = i;
                            contactB[contacts] = j;
                            contacts++;
                        } else {
                            overflow++;
                        }
                    }
                }
            }
        }

        deltaX[i] = ax;
        deltaY[i] = ay;
    }

    out.contactCount = contacts;
    out.contactOverflow = overflow;
}

export { ENTRY_IS_PET, ENTRY_NO_COLLISION };
