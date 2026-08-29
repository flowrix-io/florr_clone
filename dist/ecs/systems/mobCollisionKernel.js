"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENTRY_NO_COLLISION = exports.ENTRY_IS_PET = void 0;
exports.scanRange = scanRange;
const mobCollisionData_1 = require("./mobCollisionData");
Object.defineProperty(exports, "ENTRY_IS_PET", { enumerable: true, get: function () { return mobCollisionData_1.ENTRY_IS_PET; } });
Object.defineProperty(exports, "ENTRY_NO_COLLISION", { enumerable: true, get: function () { return mobCollisionData_1.ENTRY_NO_COLLISION; } });
/**
 * Computes separation pushes for entries `[from, to)` against the whole set.
 *
 * Writes `deltaX/deltaY` at those indices only, and appends the contacts it owns
 * (those where the lower-indexed mob is in range) to the output slab. Touches
 * nothing else, so concurrent calls over disjoint ranges are safe.
 */
function scanRange(input, from, to, out) {
    const { x, y, radius, head, flags, cellStart, sorted, hashKeys, hashVals, hashMask, maxRadius, cellSize, collisionBuffer, maxPushPerPair, nullHead } = input;
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
                const cell = (0, mobCollisionData_1.lookupCell)(hashKeys, hashVals, hashMask, (0, mobCollisionData_1.cellKeyOf)(cx, cy));
                if (cell < 0)
                    continue;
                const end = cellStart[cell + 1];
                for (let s = cellStart[cell]; s < end; s++) {
                    const j = sorted[s];
                    if (j === i)
                        continue;
                    // Segments of one centipede never push each other: the
                    // chain-follow pass keeps them in formation, and physical
                    // push-apart makes them tangle and spin.
                    if (selfHead !== nullHead && selfHead === head[j])
                        continue;
                    // Mobs flagged no_mob_collision neither push nor are pushed.
                    if (((selfFlags | flags[j]) & mobCollisionData_1.ENTRY_NO_COLLISION) !== 0)
                        continue;
                    const dx = x[j] - sx;
                    const dy = y[j] - sy;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const minDistance = selfRadius + radius[j] + collisionBuffer;
                    if (!(distance < minDistance && distance > 0))
                        continue;
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
                        }
                        else {
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
