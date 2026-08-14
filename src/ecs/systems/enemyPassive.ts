/**
 * Passive mob movement — the faithful port of `stepGardnPassive`.
 *
 * Ported from ~/gardn (Server/Process/Ai.cc tick_default_passive + Motion.cc).
 * Two distinct machines, which is why this is two systems rather than one with
 * a branch:
 *
 *   DEFAULT: idle ~1s -> pick a random heading -> pause 0.5s -> ease into motion
 *            along it for ~2s on a parabolic accel ramp -> back to idle.
 *   BEE:     no stop-and-go. Cruises continuously along a heading that wobbles
 *            sinusoidally (the wavy flight line), re-picking a base heading
 *            every 5s and pulsing speed for the first 0.5s of every 1.5s window.
 *
 * The discriminator is the Wobble component: bees carry it, other passives do
 * not. Routing on archetype removes the per-mob `type === 'bee'` string compare
 * that the original ran for every passive mob every tick.
 *
 * ---------------------------------------------------------------------------
 * Units: this integrator is PER TICK, not per second
 * ---------------------------------------------------------------------------
 * `velocity = velocity * (1 - FRICTION) + accel` and `position += velocity`,
 * with no deltaTime anywhere. That is deliberate and matches the original: the
 * friction constant is calibrated per tick (gardn's 1/3 at SIM_RATE 20 becomes
 * ~0.25 at this server's 30 TPS), and `moveEnemies` is called `mobCatchupCalls`
 * times rather than being handed a larger dt precisely because this step is a
 * fixed one. Scaling any of it by deltaTime changes how far mobs travel.
 */

import * as C from '../components';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/** Multiplier applied to a mob's stat speed throughout the AI. */
export const ENEMY_SPEED_MULTIPLIER = 2;

/**
 * Wander distance is size-relative: a mob 10x wider covers 10x the ground.
 * Mob `speed` is constant across rarities (only `size` scales), so an unscaled
 * step that reads as a few body-lengths for a common (radius 30) is a tenth of
 * a body-length for an apex (radius 858) — the "big mobs look frozen" bug.
 * Normalised against a radius above the common tier's 30 so small mobs settle
 * down in absolute terms too, rather than only being caught up to.
 */
export const WANDER_REF_RADIUS = 50;

/**
 * Ceiling on the resulting drift velocity, in px per tick.
 *
 * Straight radius-proportional scaling drifts an apex mob at ~2000 u/s, seven
 * times a player's top speed, so the passive step is clamped to the player's
 * base speed. MAX_SPEED is per second; this is per 30 TPS tick.
 */
export const MAX_WANDER_STEP = 300 / 30;

/** gardn's friction, recalibrated from 1/3 @ 20 TPS to this server's 30 TPS. */
const FRICTION = 0.25;

export interface EnemyPassiveQueries {
    /** Non-bee passives: the stop-and-go machine. */
    defaultPassive: Query;
    /** Bees: continuous wobbling cruise. */
    beePassive: Query;
}

export function createEnemyPassiveQueries(world: World): EnemyPassiveQueries {
    // IsIdle is required: in the original, stepGardnPassive was called FROM
    // stepIdle, so a chasing or homeward-bound mob never drifted. As a separate
    // system it would otherwise fight the AI's own movement every tick.
    const required = [
        C.Position, C.Velocity, C.Angle, C.Speed, C.Radius, C.PassiveMotion, C.IsIdle,
    ] as const;
    return {
        defaultPassive: world.query([...required], [C.IsDead, C.Wobble]),
        beePassive: world.query([...required, C.Wobble], [C.IsDead]),
    };
}

/** Radius-derived multiplier applied to every random-wander distance and speed. */
function sizeFactor(radius: number): number {
    return radius / WANDER_REF_RADIUS;
}

/**
 * Integrate the gardn motion step and write it back.
 *
 * Shared by both machines so the friction, the clamp and the position update
 * cannot drift apart between them.
 */
function integrate(
    pos: { x: Float64Array; y: Float64Array },
    vel: { x: Float64Array; y: Float64Array },
    i: number,
    accelX: number,
    accelY: number,
): void {
    let vx = vel.x[i] * (1 - FRICTION) + accelX;
    let vy = vel.y[i] * (1 - FRICTION) + accelY;

    // Clamp the size-scaled drift so the largest mobs cannot outrun players.
    // These velocity fields belong exclusively to this integrator (the wall
    // pass only ever zeroes them), so clamping here affects nothing else.
    const magnitude = Math.sqrt(vx * vx + vy * vy);
    if (magnitude > MAX_WANDER_STEP) {
        const k = MAX_WANDER_STEP / magnitude;
        vx *= k;
        vy *= k;
    }

    vel.x[i] = vx;
    vel.y[i] = vy;
    pos.x[i] += vx;
    pos.y[i] += vy;
}

/**
 * The default stop-and-go passive machine.
 *
 * Because it accelerates along the mob's facing angle, facing always equals the
 * movement direction by construction — no facing derivation is needed.
 */
export function defaultPassiveSystem(queries: EnemyPassiveQueries) {
    return (ctx: SystemContext): void => {
        const now = ctx.now;

        queries.defaultPassive.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const vel = chunk.cols(C.Velocity);
            const angle = chunk.cols(C.Angle);
            const speed = chunk.cols(C.Speed);
            const radius = chunk.cols(C.Radius);
            const passive = chunk.cols(C.PassiveMotion);

            for (let i = 0; i < chunk.count; i++) {
                // Immobile mobs (holes, spawners) never drift.
                if (speed.current[i] <= 0) continue;

                // Hop distance is (sum of accel)/FRICTION, so scaling ACCEL by
                // the radius factor scales distance-per-hop with size while the
                // phase durations stay fixed — that is what keeps hops
                // size-proportional rather than just slower.
                const accel = speed.current[i] * ENEMY_SPEED_MULTIPLIER * 0.25 * sizeFactor(radius.value[i]);

                let accelX = 0;
                let accelY = 0;

                const elapsed = now - passive.stateStart[i];

                if (passive.state[i] === C.PassiveState.Idle) {
                    if (elapsed >= 1000) {
                        angle.value[i] = Math.random() * Math.PI * 2;
                        passive.state[i] = C.PassiveState.Moving;
                        passive.stateStart[i] = now;
                    }
                } else {
                    if (elapsed >= 2500) {
                        passive.state[i] = C.PassiveState.Idle;
                        passive.stateStart[i] = now;
                    } else if (elapsed >= 500) {
                        // 0.5s pause, then a 2s parabolic ramp: gardn's
                        // 2 * ACCEL * (r - r^2), which peaks at r = 0.5.
                        const r = (elapsed - 500) / 2000;
                        const ramp = r - r * r;
                        const magnitude = accel * 2 * ramp;
                        accelX = Math.cos(angle.value[i]) * magnitude;
                        accelY = Math.sin(angle.value[i]) * magnitude;
                    }
                }

                integrate(pos, vel, i, accelX, accelY);
            }
        });
    };
}

/**
 * The bee cruise machine.
 *
 * gardn Ai.cc tick_bee_passive. Per tick at SIM_RATE 20 the heading advances by
 * 1.5·sin(lifetime/(SIM_RATE/2))/SIM_RATE, i.e. dθ/dt = 1.5·sin(2t) rad/s,
 * which integrates to ±0.75 rad of heading sway. `wobblePhase` de-synchronises
 * bees so they do not all weave in lockstep.
 */
export function beePassiveSystem(queries: EnemyPassiveQueries) {
    return (ctx: SystemContext): void => {
        const now = ctx.now;

        queries.beePassive.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const vel = chunk.cols(C.Velocity);
            const angle = chunk.cols(C.Angle);
            const speed = chunk.cols(C.Speed);
            const radius = chunk.cols(C.Radius);
            const passive = chunk.cols(C.PassiveMotion);
            const wobble = chunk.cols(C.Wobble);

            for (let i = 0; i < chunk.count; i++) {
                if (speed.current[i] <= 0) continue;

                const accel = speed.current[i] * ENEMY_SPEED_MULTIPLIER * 0.25 * sizeFactor(radius.value[i]);

                // Re-pick a random base heading every 5s.
                if (now - passive.stateStart[i] >= 5000) {
                    angle.value[i] = Math.random() * Math.PI * 2;
                    passive.stateStart[i] = now;
                }

                const t = now / 1000 + wobble.phase[i];
                angle.value[i] += 1.5 * Math.sin(2 * t) / 30;

                // Sustained (not ramped) accel of 3x the wander baseline gives a
                // terminal 3*speed/tick — gardn's bee cruise.
                let magnitude = accel * 3;
                if ((t * 1000) % 1500 < 500) magnitude *= 0.5;

                integrate(
                    pos, vel, i,
                    Math.cos(angle.value[i]) * magnitude,
                    Math.sin(angle.value[i]) * magnitude,
                );
            }
        });
    };
}

export function registerEnemyPassiveSystems(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: EnemyPassiveQueries,
): void {
    scheduler.add('defaultPassive', Phase.Simulation, defaultPassiveSystem(queries));
    scheduler.add('beePassive', Phase.Simulation, beePassiveSystem(queries));
}
