"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SNAPSHOT_DELAY_MS = exports.EASE_RATE_PER_SECOND = void 0;
exports.createInterpolationQueries = createInterpolationQueries;
exports.easeToTargetSystem = easeToTargetSystem;
exports.snapshotPlaybackSystem = snapshotPlaybackSystem;
exports.eyeEaseSystem = eyeEaseSystem;
exports.renderRefSystem = renderRefSystem;
exports.deathAnimationSystem = deathAnimationSystem;
exports.registerInterpolationSystems = registerInterpolationSystems;
const C = __importStar(require("../components"));
const system_1 = require("../system");
const components_1 = require("./components");
const ingest_1 = require("./ingest");
/**
 * Fraction of the remaining gap closed per frame at 60fps.
 *
 * Applied as an exponential ease so the rate is frame-rate independent: a
 * client running at 30fps closes the same fraction per unit TIME as one at
 * 144fps, rather than easing half as fast.
 */
exports.EASE_RATE_PER_SECOND = 12;
/** How far behind now mob playback runs, absorbing jitter. */
exports.SNAPSHOT_DELAY_MS = 100;
function createInterpolationQueries(world) {
    return {
        eased: world.query([C.Position, components_1.InterpTarget], [components_1.SnapshotBuffer]),
        buffered: world.query([C.Position, components_1.InterpTarget, components_1.SnapshotBuffer]),
        eyes: world.query([components_1.RenderEye]),
        refs: world.query([C.Position, components_1.RenderRef]),
        dying: world.query([C.DeathAnimation]),
    };
}
/** Shortest signed angular difference, so facing never spins the long way. */
function angleDelta(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI)
        d -= Math.PI * 2;
    if (d < -Math.PI)
        d += Math.PI * 2;
    return d;
}
/** Ease every unbuffered entity toward its interpolation target. */
function easeToTargetSystem(queries) {
    return (ctx) => {
        // Frame-rate independent exponential ease.
        const t = 1 - Math.exp(-exports.EASE_RATE_PER_SECOND * ctx.deltaTime);
        queries.eased.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const target = chunk.cols(components_1.InterpTarget);
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
function snapshotPlaybackSystem(queries) {
    return (ctx) => {
        const easeT = 1 - Math.exp(-exports.EASE_RATE_PER_SECOND * ctx.deltaTime);
        queries.buffered.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const target = chunk.cols(components_1.InterpTarget);
            const buffer = chunk.cols(components_1.SnapshotBuffer);
            const angle = chunk.has(C.Angle) ? chunk.cols(C.Angle) : undefined;
            for (let i = 0; i < chunk.count; i++) {
                const samples = buffer.samples[i];
                // Too little history to interpolate: fall back to the plain ease
                // rather than freezing on the newest sample.
                if (!samples || samples.length < 2) {
                    pos.x[i] += (target.x[i] - pos.x[i]) * easeT;
                    pos.y[i] += (target.y[i] - pos.y[i]) * easeT;
                    if (angle)
                        angle.value[i] += angleDelta(angle.value[i], target.angle[i]) * easeT;
                    continue;
                }
                const newest = samples[samples.length - 1].t;
                const playbackAt = newest - exports.SNAPSHOT_DELAY_MS;
                // Past the oldest sample we have — the stream stalled. Hold at
                // the oldest rather than extrapolating into nonsense.
                if (playbackAt <= samples[0].t) {
                    pos.x[i] = samples[0].x;
                    pos.y[i] = samples[0].y;
                    if (angle)
                        angle.value[i] = samples[0].angle;
                    continue;
                }
                let b = samples.length - 1;
                while (b > 0 && samples[b - 1].t > playbackAt)
                    b--;
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
function eyeEaseSystem(queries) {
    return (ctx) => {
        const t = 1 - Math.exp(-exports.EASE_RATE_PER_SECOND * ctx.deltaTime);
        queries.eyes.chunks(chunk => {
            const eye = chunk.cols(components_1.RenderEye);
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
function renderRefSystem(queries) {
    return () => {
        queries.refs.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const ref = chunk.cols(components_1.RenderRef);
            for (let i = 0; i < chunk.count; i++) {
                ref.x[i] = pos.x[i];
                ref.y[i] = pos.y[i];
            }
        });
    };
}
/** Retire entities whose death animation has finished playing. */
function deathAnimationSystem(queries) {
    return (ctx) => {
        queries.dying.chunks(chunk => {
            const anim = chunk.cols(C.DeathAnimation);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (ctx.now - anim.startTime[i] >= ingest_1.DEATH_ANIMATION_DURATION_MS) {
                    ctx.cmd.destroy(entities[i]);
                }
            }
        });
    };
}
function registerInterpolationSystems(scheduler, queries) {
    scheduler.add('snapshotPlayback', system_1.Phase.Simulation, snapshotPlaybackSystem(queries));
    scheduler.add('easeToTarget', system_1.Phase.Simulation, easeToTargetSystem(queries));
    scheduler.add('eyeEase', system_1.Phase.Simulation, eyeEaseSystem(queries));
    // After the eases, so the published ref is this frame's drawn position.
    scheduler.add('renderRef', system_1.Phase.Networking, renderRefSystem(queries));
    scheduler.add('deathAnimation', system_1.Phase.Lifetime, deathAnimationSystem(queries));
}
