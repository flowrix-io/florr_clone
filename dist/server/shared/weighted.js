"use strict";
/**
 * Weighted random selection helpers.
 *
 * `pickWeighted` was previously duplicated byte-for-byte in
 * `server/mazeSpawner.ts` and `server/pvpArenaSpawner.ts`, plus a
 * type-specialized twin (`selectWeightedMobType`) in `server/enemySpawner.ts`.
 * All three implemented the same cumulative-weight roll.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickWeighted = pickWeighted;
/**
 * Pick one entry from a pool using each entry's `.weight`.
 * `pool` must be non-empty; weights must be non-negative.
 */
function pickWeighted(pool) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll <= 0)
            return entry;
    }
    return pool[pool.length - 1];
}
