/**
 * Viewport-status tracking — the port of `updateEnemyViewportStatus`.
 *
 * Refreshes `ViewportTracked.lastInViewport` for every mob currently near a
 * player, which is what feeds the unseen-despawn sweep. Until this existed the
 * ECS had no way to keep a mob alive: `unseenDespawn` reaped everything after
 * 30 seconds, so the tick harness had to fake this pass and legacy had to keep
 * lifecycle ownership.
 *
 * Two details carried over deliberately:
 *
 * - The test is NEAR A PLAYER, not IN A VIEWPORT. Maze and PVP players sit
 *   outside the world rectangle and are excluded from the world-clamped
 *   viewport list, which made every maze mob read as permanently out-of-view
 *   and churn through 30-second despawns.
 *
 * - It is STRIDED. This pass exists only to feed a 30-second timer, so running
 *   it at ~6Hz instead of 30Hz is equivalent, and it avoids box-testing ~1400
 *   mobs every tick. The offset keeps it off the same tick as the despawn sweep
 *   it feeds.
 */

import * as C from '../components';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

export interface ViewportDeps {
    /**
     * Whether this world position is close enough to any live player to count
     * as seen. Injected: the real test reads viewport dimensions and the player
     * list, and deliberately includes maze/PVP players.
     */
    isNearAnyPlayer(x: number, y: number): boolean;
}

export interface ViewportQueries {
    tracked: Query;
}

export function createViewportQueries(world: World): ViewportQueries {
    return {
        tracked: world.query([C.Position, C.ViewportTracked], [C.IsDead]),
    };
}

export function viewportStatusSystem(queries: ViewportQueries, deps: ViewportDeps) {
    const { isNearAnyPlayer } = deps;

    return (ctx: SystemContext): void => {
        const now = ctx.now;
        queries.tracked.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const tracked = chunk.cols(C.ViewportTracked);
            for (let i = 0; i < chunk.count; i++) {
                if (isNearAnyPlayer(pos.x[i], pos.y[i])) tracked.lastInViewport[i] = now;
            }
        });
    };
}

export function registerViewportSystem(
    scheduler: {
        add: (
            name: string,
            phase: Phase,
            run: (ctx: SystemContext) => void,
            options?: { interval?: number; offset?: number },
        ) => unknown;
    },
    queries: ViewportQueries,
    deps: ViewportDeps,
): void {
    // Strided like the original, and offset so it never lands on the same tick
    // as the despawn sweep that consumes what it writes.
    scheduler.add('viewportStatus', Phase.Lifetime, viewportStatusSystem(queries, deps), {
        interval: 5,
        offset: 0,
    });
}
