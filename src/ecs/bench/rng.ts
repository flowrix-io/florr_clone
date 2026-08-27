/**
 * Deterministic PRNG for the ECS benches and cutover checks.
 *
 * Every bench in this directory carried its own identical copy. Seeded runs are
 * the whole point of these harnesses — an A/B against HEAD is only meaningful
 * if both sides draw the same numbers — so the generator lives in one place.
 */

/** mulberry32: fast, seedable, good enough for load shapes. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
