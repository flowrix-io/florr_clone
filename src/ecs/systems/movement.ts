/**
 * Movement systems.
 *
 * Ports of the integration steps that were previously inlined in
 * `updateMobProjectiles` / `updatePlayerProjectiles` (server.ts) and the
 * passive-AI branch of `moveEnemies`.
 *
 * The unit conventions are carried over verbatim rather than normalised,
 * because changing them silently would change how fast everything moves:
 *   - PROJECTILE speed is pixels per MILLISECOND (`speed * deltaTimeMs`).
 *   - Mob/player speed is pixels per SECOND (`speed * deltaTime`).
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

export interface MovementQueries {
    projectiles: Query;
}

export function createMovementQueries(world: World): MovementQueries {
    return {
        // Projectiles fly along a fixed heading; they never consult Velocity.
        projectiles: world.query([C.Position, C.Angle, C.Speed, C.Projectile], [C.IsDead]),
    };
}

/**
 * Advance every projectile along its heading and retire the ones that have
 * flown their full distance.
 *
 * The old loop walked the array BACKWARDS and spliced, because removing while
 * iterating forwards skips elements. Here removal is deferred to the command
 * buffer, so the loop reads forwards over dense columns.
 */
export function projectileFlightSystem(queries: MovementQueries) {
    return (ctx: SystemContext): void => {
        const { deltaMs, cmd } = ctx;

        queries.projectiles.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const angle = chunk.cols(C.Angle);
            const speed = chunk.cols(C.Speed);
            const proj = chunk.cols(C.Projectile);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                const moveDistance = speed.current[i] * deltaMs;
                const a = angle.value[i];
                pos.x[i] += Math.cos(a) * moveDistance;
                pos.y[i] += Math.sin(a) * moveDistance;
                proj.distance[i] += moveDistance;

                if (proj.distance[i] >= proj.maxDistance[i]) {
                    cmd.destroy(entities[i] as Entity);
                }
            }
        });
    };
}

/**
 * Register the projectile flight system in the Simulation phase.
 *
 * Passive mob drift used to live here as a dt-scaled friction integrator. That
 * was wrong: the real gardn passive step is PER TICK with no deltaTime, uses a
 * state-machine acceleration and clamps the resulting drift. It now lives in
 * systems/enemyPassive.ts as a faithful port.
 */
export function registerMovementSystems(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: MovementQueries,
): void {
    scheduler.add('projectileFlight', Phase.Simulation, projectileFlightSystem(queries));
}
