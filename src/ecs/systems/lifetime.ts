/**
 * Lifetime systems: timed expiry, unseen-mob despawn, and the death reaper.
 *
 * Replaces three separate mechanisms — the `Expires`-style deadline checks in
 * `updateGroundPollens`/`updateWebFields`, the per-drop `setTimeout` tracked in
 * `itemExpirationTimeouts`, and the end-of-tick `enemies.splice()` pass that
 * cleared `isDead` mobs.
 *
 * Retiring the per-item timers matters beyond tidiness: each one held a closure
 * over its item, so any path that removed a drop early leaked the timer unless
 * it remembered to clear it, and a timer that outlived its item kept the item
 * reachable. A single swept deadline has neither failure mode.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/**
 * How long a mob may go unseen by every player's viewport before it despawns.
 * Matches the existing 30-second threshold in `despawnDistantEnemies`.
 */
export const UNSEEN_DESPAWN_MS = 30_000;

export interface LifetimeQueries {
    expiring: Query;
    viewportTracked: Query;
    dead: Query;
}

export function createLifetimeQueries(world: World): LifetimeQueries {
    return {
        expiring: world.query([C.Expires]),
        viewportTracked: world.query([C.ViewportTracked], [C.IsDead]),
        dead: world.query([C.IsDead]),
    };
}

/** Destroy everything whose deadline has passed. */
export function expirySystem(queries: LifetimeQueries) {
    return (ctx: SystemContext): void => {
        const { cmd, now } = ctx;

        queries.expiring.chunks(chunk => {
            const expires = chunk.cols(C.Expires);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (now >= expires.at[i]) cmd.destroy(entities[i] as Entity);
            }
        });
    };
}

/**
 * Despawn mobs that no player has seen for a while.
 *
 * Registered with an interval so it runs at ~6Hz rather than 30Hz, exactly as
 * the old strided pass did — the threshold is 30 seconds, so a 166ms cadence is
 * equivalent and avoids sweeping ~1400 mobs every tick. The offset keeps it off
 * the same tick as the viewport-status pass that feeds it.
 */
export function unseenDespawnSystem(queries: LifetimeQueries) {
    return (ctx: SystemContext): void => {
        const { cmd, now } = ctx;
        const deadline = now - UNSEEN_DESPAWN_MS;

        queries.viewportTracked.chunks(chunk => {
            const tracked = chunk.cols(C.ViewportTracked);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (tracked.lastInViewport[i] < deadline) cmd.destroy(entities[i] as Entity);
            }
        });
    };
}

/**
 * Destroy entities marked dead during this tick.
 *
 * Runs in the Lifetime phase, i.e. AFTER Combat, which preserves the property
 * the old two-step (`isDead` flag now, splice at end of tick) existed to
 * provide: in-flight combat loops can still read a mob that died earlier in the
 * same tick, so damage attribution and drops resolve against a live entity.
 */
export function reaperSystem(queries: LifetimeQueries) {
    return (ctx: SystemContext): void => {
        const { cmd } = ctx;
        queries.dead.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) cmd.destroy(entities[i] as Entity);
        });
    };
}

export function registerLifetimeSystems(
    scheduler: {
        add: (
            name: string,
            phase: Phase,
            run: (ctx: SystemContext) => void,
            options?: { interval?: number; offset?: number },
        ) => unknown;
    },
    queries: LifetimeQueries,
): void {
    scheduler.add('expiry', Phase.Lifetime, expirySystem(queries));
    scheduler.add('unseenDespawn', Phase.Lifetime, unseenDespawnSystem(queries), { interval: 5, offset: 2 });
    // The reaper must be last in the phase: everything above may still want to
    // read entities that died this tick.
    scheduler.add('reaper', Phase.Lifetime, reaperSystem(queries));
}
