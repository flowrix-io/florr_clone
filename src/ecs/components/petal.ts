/**
 * Petal components.
 *
 * There is exactly one, and it hangs off the PLAYER — not off a petal. The
 * reasoning for that, drawn from how the code actually reads and writes petal
 * state rather than from ECS convention, is written out at length in
 * `ecs/systems/petalRing.ts`. The short version: a petal instance has no
 * lifetime of its own (the instance list is DERIVED from the loadout every
 * tick), its health usually belongs to the loadout slot rather than the
 * instance, nothing queries petals except by owner in slot order, and the
 * broadcast needs a dense per-player array in that same order.
 */

import { defineComponent } from '../component';

/**
 * A flower's petal-ring kinematics.
 *
 * `state` holds a `PetalRingState` (ecs/systems/petalRing.ts) — the per-instance
 * spring/glide state keyed by the instance's stable (loadoutIndex,
 * instanceIndex) identity. It is an `obj` column because it is cold, per-player
 * and non-numeric-shaped; the hot numbers inside it are the ring's own storage.
 *
 * Holding it on the entity is what makes cleanup structural. The global map this
 * replaces (`petalPhysicsStates` in server/playerState.ts) was keyed by
 * `"<socketId>_<slot>_<instance>"` and needed an explicit prefix scan on every
 * disconnect; miss that call once — for a splitter half, a bot removal, a
 * transfer — and the whole ring stayed in the heap for the process lifetime.
 * Here the column slot is cleared when the entity's row is released, so the map
 * dies with the flower.
 */
export const PetalRing = defineComponent('PetalRing', {
    /** PetalRingState. */
    state: 'obj',
    /**
     * Ring slots the current layout consumes — the divisor behind
     * `angleStep = 2*PI / slotCount`.
     *
     * Recomputed every tick by `layoutPetalRing`; stored so anything that needs
     * the ring's shape (diagnostics, and eventually the broadcast) does not have
     * to re-expand the loadout to get it.
     */
    slotCount: 'u16',
});
