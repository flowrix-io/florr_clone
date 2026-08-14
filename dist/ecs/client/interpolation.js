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
 *   jitter and packet loss at high ping. Their FACING is not taken from that
 *   buffer — see mobAngleEaseSystem.
 *
 *   PLAYERS have no buffer at all. Every flower, local and remote, eases toward
 *   its target at the same fixed rate, so the local player's motion and every
 *   remote flower's motion look identical. Adding buffered playback for players
 *   would make remote flowers lag the local one visibly. Their facing is not
 *   eased at all: it comes straight off the wire, because it drives the eyes.
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
exports.SETTLE_EPSILON = exports.TELEPORT_SNAP_DISTANCE = void 0;
exports.defaultInterpolationConfig = defaultInterpolationConfig;
exports.easeRateFromAmount = easeRateFromAmount;
exports.createInterpolationQueries = createInterpolationQueries;
exports.snapSystem = snapSystem;
exports.easeToTargetSystem = easeToTargetSystem;
exports.snapshotPlaybackSystem = snapshotPlaybackSystem;
exports.mobAngleEaseSystem = mobAngleEaseSystem;
exports.renderRefSystem = renderRefSystem;
exports.deathAnimationSystem = deathAnimationSystem;
exports.registerInterpolationSystems = registerInterpolationSystems;
const C = __importStar(require("../components"));
const system_1 = require("../system");
const components_1 = require("./components");
const ingest_1 = require("./ingest");
/** The legacy defaults: interpolationAmount 0.3 and an 80ms render delay. */
function defaultInterpolationConfig() {
    return {
        easeRatePerSecond: easeRateFromAmount(0.3),
        snapshotDelayMs: 80,
        snapshotNowMs: 0,
    };
}
/**
 * The user's `interpolationAmount` (fraction of the gap closed per frame at
 * 60fps) as a frame-rate independent exponential rate. Same shape as gardn's
 * `Ui::lerp_amount = 1 - (1 - k)^(dt*60)`.
 */
function easeRateFromAmount(amount) {
    const k = Math.min(0.999, Math.max(0.001, amount));
    return -Math.log(1 - k) * 60;
}
/**
 * Beyond this gap an ease is a glide across the map, not a smoothing — snap.
 * Portals, `playerTeleported` and the maze at (200000, 200000) all produce it.
 */
exports.TELEPORT_SNAP_DISTANCE = 600;
/** Below this the ease is invisible; settle exactly instead of asymptoting. */
exports.SETTLE_EPSILON = 0.01;
function createInterpolationQueries(world) {
    return {
        // A mob mid-death-pop is frozen: its ingest is refused, so easing it
        // toward a stale target would slide the corpse while it fades.
        eased: world.query([C.Position, components_1.InterpTarget], [components_1.SnapshotBuffer, C.DeathAnimation]),
        buffered: world.query([C.Position, components_1.InterpTarget, components_1.SnapshotBuffer], [C.DeathAnimation]),
        mobAngles: world.query([C.Angle, components_1.InterpTarget, C.IsEnemy], [C.DeathAnimation]),
        refs: world.query([C.Position, components_1.RenderRef]),
        dying: world.query([C.DeathAnimation]),
        snapping: world.query([components_1.NeedsSnap, C.Position, components_1.InterpTarget]),
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
/**
 * Cut tagged entities onto their target, then drop the tag.
 *
 * Runs before the eases so a snapped entity does not also ease this frame (it
 * would be a no-op — target and position are equal — but the ordering is the
 * thing that makes that true).
 */
function snapSystem(queries) {
    return (ctx) => {
        queries.snapping.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const target = chunk.cols(components_1.InterpTarget);
            const ref = chunk.has(components_1.RenderRef) ? chunk.cols(components_1.RenderRef) : undefined;
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                pos.x[i] = target.x[i];
                pos.y[i] = target.y[i];
                if (ref) {
                    ref.x[i] = target.x[i];
                    ref.y[i] = target.y[i];
                }
                ctx.cmd.remove(entities[i], components_1.NeedsSnap);
            }
        });
    };
}
/** Ease every unbuffered entity toward its interpolation target. */
function easeToTargetSystem(queries, config) {
    return (ctx) => {
        // Frame-rate independent exponential ease.
        const t = 1 - Math.exp(-config.easeRatePerSecond * ctx.deltaTime);
        queries.eased.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const target = chunk.cols(components_1.InterpTarget);
            // Only flowers get the teleport snap and the settle. Mobs in this
            // query are brand-new ones that have not been updated yet, and the
            // legacy client eased them with a plain lerp and nothing else.
            const isFlower = chunk.has(components_1.IsPlayerRender);
            for (let i = 0; i < chunk.count; i++) {
                const dx = target.x[i] - pos.x[i];
                const dy = target.y[i] - pos.y[i];
                if (isFlower && dx * dx + dy * dy > exports.TELEPORT_SNAP_DISTANCE * exports.TELEPORT_SNAP_DISTANCE) {
                    pos.x[i] = target.x[i];
                    pos.y[i] = target.y[i];
                }
                else if (isFlower && Math.abs(dx) < exports.SETTLE_EPSILON && Math.abs(dy) < exports.SETTLE_EPSILON) {
                    pos.x[i] = target.x[i];
                    pos.y[i] = target.y[i];
                }
                else {
                    pos.x[i] += dx * t;
                    pos.y[i] += dy * t;
                }
            }
        });
    };
}
/**
 * Play buffered mobs back from their snapshot history, `snapshotDelayMs` behind
 * the client render clock.
 *
 * Running behind is what makes this absorb jitter: there is normally a sample
 * on each side of the playback point to interpolate between, so a late or
 * dropped packet does not stall the entity. POSITION ONLY — facing is handled
 * by mobAngleEaseSystem.
 */
function snapshotPlaybackSystem(queries, config) {
    return (ctx) => {
        const easeT = 1 - Math.exp(-config.easeRatePerSecond * ctx.deltaTime);
        const renderTime = config.snapshotNowMs - config.snapshotDelayMs;
        queries.buffered.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const target = chunk.cols(components_1.InterpTarget);
            const buffer = chunk.cols(components_1.SnapshotBuffer);
            for (let i = 0; i < chunk.count; i++) {
                const samples = buffer.samples[i];
                // Too little history to interpolate: fall back to the plain ease
                // rather than freezing on the newest sample.
                if (!samples || samples.length < 2) {
                    pos.x[i] += (target.x[i] - pos.x[i]) * easeT;
                    pos.y[i] += (target.y[i] - pos.y[i]) * easeT;
                    continue;
                }
                // Walk back from the newest pair to the one bracketing
                // renderTime, matching the legacy scan direction.
                let b = samples.length - 1;
                while (b > 1 && samples[b - 1].t > renderTime)
                    b--;
                const before = samples[b - 1];
                const after = samples[b];
                const span = after.t - before.t;
                if (span <= 0) {
                    pos.x[i] = after.x;
                    pos.y[i] = after.y;
                    continue;
                }
                if (after.t <= renderTime) {
                    // renderTime is newer than every sample — the stream has not
                    // caught up. Extrapolate at most one tick forward rather
                    // than freezing.
                    const overshoot = Math.min((renderTime - after.t) / span, 1);
                    pos.x[i] = after.x + (after.x - before.x) * overshoot;
                    pos.y[i] = after.y + (after.y - before.y) * overshoot;
                    continue;
                }
                // Clamp: renderTime can predate the oldest pair right after the
                // buffer seeds, and a negative alpha extrapolates backwards.
                const f = Math.max(0, (renderTime - before.t) / span);
                pos.x[i] = before.x + (after.x - before.x) * f;
                pos.y[i] = before.y + (after.y - before.y) * f;
            }
        });
    };
}
/**
 * Ease each mob's facing toward its last authoritative angle.
 *
 * Deliberately NOT interpolated from the snapshot buffer. The passive AI
 * changes heading in one discrete server jump of up to 180°; snapshot
 * interpolation whips the mob through that whole turn inside a single ~33ms
 * sample interval, which reads as a snap. Easing spreads it over gardn's time
 * constant instead. `InterpTarget.angle` is the last value off the wire — never
 * the render-mutated `Angle`, or the mob chases its own tail and wobbles after
 * finishing a turn.
 */
function mobAngleEaseSystem(queries, config) {
    return (ctx) => {
        const t = 1 - Math.exp(-config.easeRatePerSecond * ctx.deltaTime);
        queries.mobAngles.chunks(chunk => {
            const angle = chunk.cols(C.Angle);
            const target = chunk.cols(components_1.InterpTarget);
            for (let i = 0; i < chunk.count; i++) {
                angle.value[i] += angleDelta(angle.value[i], target.angle[i]) * t;
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
/**
 * Retire entities whose death animation has finished playing.
 *
 * The reaper is called BEFORE the destroy is queued, while the entity is still
 * resolvable to its wire id — the graphics side-maps are keyed by that id and
 * nothing else would ever clear them.
 */
function deathAnimationSystem(queries, reaper) {
    return (ctx) => {
        queries.dying.chunks(chunk => {
            const anim = chunk.cols(C.DeathAnimation);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (ctx.now - anim.startTime[i] >= ingest_1.DEATH_ANIMATION_DURATION_MS) {
                    const entity = entities[i];
                    if (reaper) {
                        const key = ctx.world.externalIdOf(entity);
                        if (key !== undefined && key.startsWith('e:'))
                            reaper.enemyGone(key.slice(2));
                    }
                    ctx.cmd.destroy(entity);
                }
            }
        });
    };
}
function registerInterpolationSystems(scheduler, queries, config, reaper) {
    scheduler.add('snap', system_1.Phase.Simulation, snapSystem(queries));
    scheduler.add('snapshotPlayback', system_1.Phase.Simulation, snapshotPlaybackSystem(queries, config));
    scheduler.add('easeToTarget', system_1.Phase.Simulation, easeToTargetSystem(queries, config));
    scheduler.add('mobAngleEase', system_1.Phase.Simulation, mobAngleEaseSystem(queries, config));
    // After the eases, so the published ref is this frame's drawn position.
    scheduler.add('renderRef', system_1.Phase.Networking, renderRefSystem(queries));
    scheduler.add('deathAnimation', system_1.Phase.Lifetime, deathAnimationSystem(queries, reaper));
}
