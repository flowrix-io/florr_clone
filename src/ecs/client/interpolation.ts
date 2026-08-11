/**
 * Client render interpolation.
 *
 * Server state arrives at 30Hz; the client draws at display rate. These systems
 * are what turn one into the other. `Position` is the DRAWN position and
 * `InterpTarget` is the authoritative one it chases — applying server positions
 * directly makes every remote entity stutter at the tick rate.
 *
 * Note players and mobs interpolate DIFFERENTLY, deliberately:
 *
 *   MOBS carry a snapshot buffer and are played back on a delay, which absorbs
 *   jitter and packet loss at high ping.
 *
 *   PLAYERS have no buffer at all. Every flower, local and remote, eases toward
 *   its target at the same fixed rate, so the local player's predicted motion
 *   and every remote flower's motion look identical. Adding buffered playback
 *   for players would make remote flowers lag the local one visibly.
 */

import * as C from '../components';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';
import { InterpTarget, RenderEye, RenderRef, SnapshotBuffer } from './components';
import { DEATH_ANIMATION_DURATION_MS } from './ingest';

/**
 * Fraction of the remaining gap closed per frame at 60fps.
 *
 * Applied as an exponential ease so the rate is frame-rate independent: a
 * client running at 30fps closes the same fraction per unit TIME as one at
 * 144fps, rather than easing half as fast.
 */
export const EASE_RATE_PER_SECOND = 12;

/** How far behind now mob playback runs, absorbing jitter. */
export const SNAPSHOT_DELAY_MS = 100;

export interface InterpolationQueries {
    /** Entities eased straight toward their target (players, and mobs with no buffer). */
    eased: Query;
    /** Mobs played back from their snapshot history. */
    buffered: Query;
    eyes: Query;
    refs: Query;
    dying: Query;
}

export function createInterpolationQueries(world: World): InterpolationQueries {
    return {
        eased: world.query([C.Position, InterpTarget], [SnapshotBuffer]),
        buffered: world.query([C.Position, InterpTarget, SnapshotBuffer]),
        eyes: world.query([RenderEye]),
        refs: world.query([C.Position, RenderRef]),
        dying: world.query([C.DeathAnimation]),
    };
}

/** Shortest signed angular difference, so facing never spins the long way. */
function angleDelta(from: number, to: number): number {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

/** Ease every unbuffered entity toward its interpolation target. */
export function easeToTargetSystem(queries: InterpolationQueries) {
    return (ctx: SystemContext): void => {
        // Frame-rate independent exponential ease.
        const t = 1 - Math.exp(-EASE_RATE_PER_SECOND * ctx.deltaTime);

        queries.eased.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const target = chunk.cols(InterpTarget);
            const angle = chunk.has(C.Angle) ? chunk.cols(C.Angle) : undefined;

            for (let i = 0; i < chunk.count; i++) {
                pos.x[i] += (target.x[i] - pos.x[i]) * t;
                pos.y[i] += (target.y[i] - pos.y[i]) * t;
                if (angle) {
                    angle.value[i] += angleDelta(angle.value[i], target.angle[i]) * t;
                }
            }
        });
    };
}

/**
 * Play buffered mobs back from their snapshot history, `SNAPSHOT_DELAY_MS`
 * behind the newest sample.
 *
 * Running behind the newest sample is what makes this absorb jitter: there is
 * always a sample on each side of the playback point to interpolate between, so
 * a late or dropped packet does not stall the entity.
 */
export function snapshotPlaybackSystem(queries: InterpolationQueries) {
    return (ctx: SystemContext): void => {
        const easeT = 1 - Math.exp(-EASE_RATE_PER_SECOND * ctx.deltaTime);

        queries.buffered.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const target = chunk.cols(InterpTarget);
            const buffer = chunk.cols(SnapshotBuffer);
            const angle = chunk.has(C.Angle) ? chunk.cols(C.Angle) : undefined;

            for (let i = 0; i < chunk.count; i++) {
                const samples = buffer.samples[i] as
                    Array<{ t: number; x: number; y: number; angle: number }> | undefined;

                // Too little history to interpolate: fall back to the plain ease
                // rather than freezing on the newest sample.
                if (!samples || samples.length < 2) {
                    pos.x[i] += (target.x[i] - pos.x[i]) * easeT;
                    pos.y[i] += (target.y[i] - pos.y[i]) * easeT;
                    if (angle) angle.value[i] += angleDelta(angle.value[i], target.angle[i]) * easeT;
                    continue;
                }

                const newest = samples[samples.length - 1].t;
                const playbackAt = newest - SNAPSHOT_DELAY_MS;

                // Past the oldest sample we have — the stream stalled. Hold at
                // the oldest rather than extrapolating into nonsense.
                if (playbackAt <= samples[0].t) {
                    pos.x[i] = samples[0].x;
                    pos.y[i] = samples[0].y;
                    if (angle) angle.value[i] = samples[0].angle;
                    continue;
                }

                let b = samples.length - 1;
                while (b > 0 && samples[b - 1].t > playbackAt) b--;
                const before = samples[b - 1];
                const after = samples[b];
                const span = after.t - before.t;
                const f = span > 0 ? (playbackAt - before.t) / span : 0;

                pos.x[i] = before.x + (after.x - before.x) * f;
                pos.y[i] = before.y + (after.y - before.y) * f;
                if (angle) {
                    angle.value[i] = before.angle + angleDelta(before.angle, after.angle) * f;
                }
            }
        });
    };
}

/** Ease cosmetic eye offsets toward their targets. */
export function eyeEaseSystem(queries: InterpolationQueries) {
    return (ctx: SystemContext): void => {
        const t = 1 - Math.exp(-EASE_RATE_PER_SECOND * ctx.deltaTime);
        queries.eyes.chunks(chunk => {
            const eye = chunk.cols(RenderEye);
            for (let i = 0; i < chunk.count; i++) {
                eye.x[i] += (eye.targetX[i] - eye.x[i]) * t;
                eye.y[i] += (eye.targetY[i] - eye.y[i]) * t;
            }
        });
    };
}

/**
 * Republish each flower's drawn position.
 *
 * Petals arrive from the server in absolute world coordinates but have to be
 * drawn relative to where their owner is actually being DRAWN this frame. Using
 * the server position instead makes petals visibly lead or lag the flower.
 */
export function renderRefSystem(queries: InterpolationQueries) {
    return (): void => {
        queries.refs.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const ref = chunk.cols(RenderRef);
            for (let i = 0; i < chunk.count; i++) {
                ref.x[i] = pos.x[i];
                ref.y[i] = pos.y[i];
            }
        });
    };
}

/** Retire entities whose death animation has finished playing. */
export function deathAnimationSystem(queries: InterpolationQueries) {
    return (ctx: SystemContext): void => {
        queries.dying.chunks(chunk => {
            const anim = chunk.cols(C.DeathAnimation);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (ctx.now - anim.startTime[i] >= DEATH_ANIMATION_DURATION_MS) {
                    ctx.cmd.destroy(entities[i] as never);
                }
            }
        });
    };
}

export function registerInterpolationSystems(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: InterpolationQueries,
): void {
    scheduler.add('snapshotPlayback', Phase.Simulation, snapshotPlaybackSystem(queries));
    scheduler.add('easeToTarget', Phase.Simulation, easeToTargetSystem(queries));
    scheduler.add('eyeEase', Phase.Simulation, eyeEaseSystem(queries));
    // After the eases, so the published ref is this frame's drawn position.
    scheduler.add('renderRef', Phase.Networking, renderRefSystem(queries));
    scheduler.add('deathAnimation', Phase.Lifetime, deathAnimationSystem(queries));
}
