/**
 * Client-only render components.
 *
 * These exist ONLY in the browser world and have no server counterpart. The
 * server is authoritative about where things are; the client additionally has
 * to decide where to *draw* them, which is a different problem — it needs
 * interpolation targets, a snapshot history for high-ping smoothing, and eased
 * cosmetic state like eye offsets.
 *
 * Keeping them in their own module makes the split explicit: if a server system
 * ever queries one of these, that is a bug, and the import path says so.
 */

import { defineComponent, defineTag } from '../component';

/**
 * Where this entity is easing TOWARD.
 *
 * The server position is never applied directly — snapping to it makes remote
 * entities stutter at the tick rate. `Position` is the drawn position and this
 * is the authoritative one it chases.
 */
export const InterpTarget = defineComponent('InterpTarget', {
    x: 'f64',
    y: 'f64',
    angle: 'f32',
});

/**
 * Ring buffer of recent server samples, for high-ping interpolation.
 *
 * Held as an `obj` column: it is a short array of small records, read only by
 * the interpolation system, and exploding it into typed arrays would mean a
 * fixed stride per entity for a buffer most entities barely use.
 *
 * The buffer must stay monotonic in `t` even across a clock-offset re-anchor,
 * otherwise the interpolator reads samples out of order and entities jitter
 * backwards. `pushSnapshot` enforces that.
 */
export const SnapshotBuffer = defineComponent('SnapshotBuffer', {
    /** Array<{ t: number; x: number; y: number; angle: number }>. */
    samples: 'obj',
});

/** Longest snapshot history kept per entity. */
export const MAX_SNAPSHOTS = 12;

/**
 * The eased render position republished for every player, used to anchor that
 * player's absolute server-sent petal positions.
 *
 * Petals arrive in world coordinates but must be drawn relative to where the
 * flower is actually being *drawn* this frame, not where the server says it is
 * — otherwise petals visibly lead or lag their owner.
 */
export const RenderRef = defineComponent('RenderRef', {
    x: 'f64',
    y: 'f64',
});

/** Eased eye offset, a purely cosmetic follow with its own target. */
export const RenderEye = defineComponent('RenderEye', {
    x: 'f32',
    y: 'f32',
    targetX: 'f32',
    targetY: 'f32',
});

/**
 * The entity this client controls.
 *
 * Tagged rather than compared by id so the prediction system routes by
 * archetype: exactly one entity carries it, and only that one is predicted
 * forward from local input.
 */
export const IsLocalPlayer = defineTag('IsLocalPlayer');

/**
 * Rendered as somebody's pet.
 *
 * The full `enemySpawned` payload identifies a pet by owner id while the delta
 * stream sets a bare marker; this tag is the single normalised form the
 * renderer reads, so it never has to know which path delivered the entity.
 */
export const RendersAsPet = defineTag('RendersAsPet');

/** Push a sample, keeping the buffer monotonic and bounded. */
export function pushSnapshot(
    samples: Array<{ t: number; x: number; y: number; angle: number }>,
    t: number,
    x: number,
    y: number,
    angle: number,
): void {
    const last = samples.length > 0 ? samples[samples.length - 1] : undefined;
    // A clock re-anchor can hand us a timestamp at or before the previous one.
    // Nudging past it keeps the series strictly increasing so the interpolator
    // never reads backwards.
    const time = last !== undefined && t <= last.t ? last.t + 1 : t;
    samples.push({ t: time, x, y, angle });
    if (samples.length > MAX_SNAPSHOTS) samples.shift();
}
