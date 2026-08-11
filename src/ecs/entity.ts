/**
 * Entity handles.
 *
 * A handle is a plain `number` that packs an INDEX (which slot in the world's
 * entity table) and a GENERATION (how many times that slot has been recycled).
 * The generation is what makes a handle safe to hold across ticks: a projectile
 * that despawns frees its index, but any stale handle still pointing at it
 * carries the old generation and so fails `world.isAlive()` instead of silently
 * addressing whatever entity moved into the slot.
 *
 * ---------------------------------------------------------------------------
 * Why arithmetic packing instead of bit twiddling
 * ---------------------------------------------------------------------------
 * The obvious encoding is `index | (generation << 24)`, but JS bitwise ops
 * coerce to *signed 32-bit*, which caps the whole handle at 2^31 and leaves
 * only 8 bits (256 recycles) for the generation. This game spawns and frees
 * projectiles at a very high rate — gas/rainbow petals churn thousands per
 * minute — so a 256-recycle wrap is not theoretical, it would happen within
 * minutes and resurrect stale handles.
 *
 * Numbers are IEEE doubles with 53 bits of exact integer range, so packing by
 * MULTIPLICATION instead gives 24 bits of index (16.7M live entities) and 29
 * bits of generation (536M recycles per slot) while staying exactly
 * representable. At the observed churn that is centuries before a wrap.
 *
 * Handles are decoded with `/` and `%` rather than shifts precisely so this
 * range is preserved — do not "optimise" these into bitwise ops.
 */

/** Number of addressable entity slots. Also the multiplier for the generation. */
export const ENTITY_INDEX_COUNT = 1 << 24; // 16,777,216

/** Highest generation a slot can reach before wrapping back to 0. */
export const ENTITY_MAX_GENERATION = 1 << 29; // 536,870,912

/**
 * An opaque entity handle. Branded so a raw `number` (a row index, a count, a
 * component value) can never be passed where an entity is expected.
 */
export type Entity = number & { readonly __entity: unique symbol };

/** The null handle. Index 0 / generation 0 is permanently reserved so that
 *  0 is always an invalid entity and zero-filled arrays read as "empty". */
export const NULL_ENTITY = 0 as Entity;

/** Pack an index + generation into a handle. */
export function makeEntity(index: number, generation: number): Entity {
    return (generation * ENTITY_INDEX_COUNT + index) as Entity;
}

/** The entity table slot this handle addresses. */
export function entityIndex(e: Entity): number {
    return e % ENTITY_INDEX_COUNT;
}

/** How many times this handle's slot had been recycled when it was issued. */
export function entityGeneration(e: Entity): number {
    return Math.floor(e / ENTITY_INDEX_COUNT);
}

/** Human-readable form for logs and assertions: `e<index>:<generation>`. */
export function entityToString(e: Entity): string {
    return e === NULL_ENTITY ? 'e<null>' : `e${entityIndex(e)}:${entityGeneration(e)}`;
}
