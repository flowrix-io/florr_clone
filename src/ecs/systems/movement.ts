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

/**
 * Friction applied to the passive-motion velocity integrator each tick,
 * matching the gardn-style decay the old `moveEnemies` passive branch used.
 */
const PASSIVE_FRICTION = 0.9;

export interface MovementQueries {
    projectiles: Query;
    drifting: Query;
}

export function createMovementQueries(world: World): MovementQueries {
    return {
        // Projectiles fly along a fixed heading; they never consult Velocity.
        projectiles: world.query([C.Position, C.Angle, C.Speed, C.Projectile], [C.IsDead]),
        // Entities carrying PassiveMotion integrate a decaying velocity instead.
        drifting: world.query([C.Position, C.Velocity, C.PassiveMotion], [C.IsDead]),
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
 * Integrate the passive-motion velocity with friction.
 *
 * Separate from the projectile pass because the two have genuinely different
 * shapes — a heading and a speed versus a decaying velocity vector — and
 * merging them would put a branch in both hot loops.
 */
export function passiveDriftSystem(queries: MovementQueries) {
    return (ctx: SystemContext): void => {
        const { deltaTime } = ctx;

        queries.drifting.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const vel = chunk.cols(C.Velocity);

            for (let i = 0; i < chunk.count; i++) {
                pos.x[i] += vel.x[i] * deltaTime;
                pos.y[i] += vel.y[i] * deltaTime;
                vel.x[i] *= PASSIVE_FRICTION;
                vel.y[i] *= PASSIVE_FRICTION;
            }
        });
    };
}

/** Register both movement systems in the Simulation phase. */
export function registerMovementSystems(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: MovementQueries,
): void {
    scheduler.add('projectileFlight', Phase.Simulation, projectileFlightSystem(queries));
    scheduler.add('passiveDrift', Phase.Simulation, passiveDriftSystem(queries));
}
