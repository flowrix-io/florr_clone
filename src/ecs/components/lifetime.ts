/**
 * Lifetime and despawn components.
 *
 * Every short-lived entity in the game — projectiles, pollen puffs, web fields,
 * dropped items, summoned mobs — had its own expiry mechanism: a `despawnAt`
 * field checked in one loop, an `expiresAt` in another, and for world items a
 * `setTimeout` per drop tracked in `itemExpirationTimeouts`.
 *
 * Unifying them on `Expires` means one sweep retires everything, and in
 * particular replaces the per-item timer map. Those timers were a real hazard:
 * a timeout that outlived its item kept a closure over it alive, and every path
 * that removed an item early had to remember to clear the timer or leak it.
 */

import { defineComponent } from '../component';

/**
 * Absolute timestamp at which this entity is destroyed.
 *
 * One sweep in the Lifetime phase destroys everything whose `at` has passed, so
 * expiry costs no timers and no allocation.
 */
export const Expires = defineComponent('Expires', {
    at: 'f64',
});

/** When this entity came into existence. Used for spawn protection, animation phase and age-based rules. */
export const SpawnTime = defineComponent('SpawnTime', {
    at: 'f64',
});

/**
 * Viewport-based despawn bookkeeping for mobs.
 *
 * `lastInViewport` is refreshed by the strided viewport pass; the despawn sweep
 * retires mobs that have been unseen past the threshold. Kept separate from
 * Expires because the rule is "unseen for N seconds", not a fixed deadline.
 */
export const ViewportTracked = defineComponent('ViewportTracked', {
    lastInViewport: 'f64',
});

/** Death animation start, so the client can play it out before removal. */
export const DeathAnimation = defineComponent('DeathAnimation', {
    startTime: 'f64',
});
