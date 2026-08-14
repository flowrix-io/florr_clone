"use strict";
/**
 * Client-only render components.
 *
 * These exist ONLY in the browser world and have no server counterpart. The
 * server is authoritative about where things are; the client additionally has
 * to decide where to *draw* them, which is a different problem — it needs
 * interpolation targets, a snapshot history for high-ping smoothing, and eased
 * cosmetic state like eye offsets.
 *
 * Keeping them in their own module makes the split explicit: if a server system
 * ever queries one of these, that is a bug, and the import path says so.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RendersAsPet = exports.LegacyPlayer = exports.DpsLabel = exports.MobRender = exports.NeedsSnap = exports.IsPlayerRender = exports.IsLocalPlayer = exports.RenderEye = exports.RenderRef = exports.MAX_SNAPSHOTS = exports.SnapshotBuffer = exports.InterpTarget = void 0;
exports.pushSnapshot = pushSnapshot;
const component_1 = require("../component");
/**
 * Where this entity is easing TOWARD.
 *
 * The server position is never applied directly — snapping to it makes remote
 * entities stutter at the tick rate. `Position` is the drawn position and this
 * is the authoritative one it chases.
 */
exports.InterpTarget = (0, component_1.defineComponent)('InterpTarget', {
    x: 'f64',
    y: 'f64',
    angle: 'f32',
});
/**
 * Ring buffer of recent server samples, for high-ping interpolation.
 *
 * Held as an `obj` column: it is a short array of small records, read only by
 * the interpolation system, and exploding it into typed arrays would mean a
 * fixed stride per entity for a buffer most entities barely use.
 *
 * The buffer must stay monotonic in `t` even across a clock-offset re-anchor,
 * otherwise the interpolator reads samples out of order and entities jitter
 * backwards. `pushSnapshot` enforces that.
 */
exports.SnapshotBuffer = (0, component_1.defineComponent)('SnapshotBuffer', {
    /** Array<{ t: number; x: number; y: number; angle: number }>. */
    samples: 'obj',
});
/** Longest snapshot history kept per entity. */
exports.MAX_SNAPSHOTS = 12;
/**
 * The eased render position republished for every player, used to anchor that
 * player's absolute server-sent petal positions.
 *
 * Petals arrive in world coordinates but must be drawn relative to where the
 * flower is actually being *drawn* this frame, not where the server says it is
 * — otherwise petals visibly lead or lag their owner.
 */
exports.RenderRef = (0, component_1.defineComponent)('RenderRef', {
    x: 'f64',
    y: 'f64',
});
/**
 * Eased eye offset, purely cosmetic.
 *
 * STORAGE ONLY — no system eases this. The eye follow is a fixed fraction per
 * FRAME (0.15) rather than a rate per second, and it is applied by the flower
 * and mob-flower renderers at the moment they draw. Adding a scheduler system
 * for it would either duplicate that ease or replace it with a frame-rate
 * independent one, which changes how eyes track at any refresh rate other than
 * 60Hz. Living in a component is still what matters: `destroy` clears it, so a
 * disconnected player's eye state cannot outlive them the way a side Map would.
 *
 * `init` distinguishes "never drawn" from "eased to (0,0)": mobs start their
 * eye ON the target (a mob popping in should not roll its eyes into place),
 * flowers start at the origin.
 */
exports.RenderEye = (0, component_1.defineComponent)('RenderEye', {
    x: 'f32',
    y: 'f32',
    init: 'bool',
});
/**
 * The entity this client controls.
 *
 * Tagged rather than compared by id so the prediction system routes by
 * archetype: exactly one entity carries it, and only that one is predicted
 * forward from local input.
 *
 * After the splitter petal this client owns TWO flowers but drives one; the tag
 * follows the ACTIVE half and flips on `playerSwitched`. Binding it to the
 * socket id instead answers for the abandoned half (see the split-active-half
 * invariant) — camera, death screen and loadout bar all read through it.
 */
exports.IsLocalPlayer = (0, component_1.defineTag)('IsLocalPlayer');
/**
 * Drawn as a flower.
 *
 * The renderer's player pass queries this rather than "has Position and is not
 * a mob": one World holds both, and an untagged position query would sweep mobs
 * into the flower renderer.
 */
exports.IsPlayerRender = (0, component_1.defineTag)('IsPlayerRender');
/**
 * Cut to the interpolation target on the next tick instead of easing to it.
 *
 * Respawn and teleport move a flower further than any ease should cross. The
 * legacy client did this with a `predInit` boolean that only covered the local
 * flower's first frame; as a tag it covers every entity and every reason
 * (portal, `playerTeleported`, respawn) through one path.
 */
exports.NeedsSnap = (0, component_1.defineTag)('NeedsSnap');
/**
 * Mob render state that is neither position nor identity.
 *
 * `aiType`/`chasing` together double the sprite animation speed for a mob that
 * is actively hunting, and `flipped` mirrors it horizontally. All three arrive
 * ONLY on the full `enemySpawned`/`enemiesUpdate` payloads — the per-tick delta
 * wire does not carry them — so a mob first seen through the delta stream has
 * them at their zero defaults, exactly as it had them `undefined` before.
 */
exports.MobRender = (0, component_1.defineComponent)('MobRender', {
    /** Matches components/mob.ts AiType; 255 = "the server never told us". */
    aiType: 'u8',
    chasing: 'bool',
    flipped: 'bool',
});
/** Measured DPS shown beside a target dummy's health bar. */
exports.DpsLabel = (0, component_1.defineComponent)('DpsLabel', {
    value: 'f32',
});
/**
 * The client's plain `Player` object, for everything this pass did NOT move.
 *
 * Position, facing, the eased eye and the petal-ring anchor are ECS columns and
 * have been DELETED from the `Player` interface, so no renderer can read a
 * stale copy of them. The other ~45 fields — name, health, loadout, inventory,
 * cosmetics, maze/PVP state — are account and UI data that no system iterates,
 * and splitting them into columns would buy nothing while breaking every panel
 * that takes a `Player`.
 *
 * Typed `obj` because src/ecs must not import src/player.ts (it reaches
 * petal_actions.ts, which is server-side); the client casts on the way out.
 */
exports.LegacyPlayer = (0, component_1.defineComponent)('LegacyPlayer', {
    ref: 'obj',
});
/**
 * Rendered as somebody's pet.
 *
 * The full `enemySpawned` payload identifies a pet by owner id while the delta
 * stream sets a bare marker; this tag is the single normalised form the
 * renderer reads, so it never has to know which path delivered the entity.
 */
exports.RendersAsPet = (0, component_1.defineTag)('RendersAsPet');
/** Push a sample, keeping the buffer monotonic and bounded. */
function pushSnapshot(samples, t, x, y, angle) {
    const last = samples.length > 0 ? samples[samples.length - 1] : undefined;
    // A clock re-anchor can hand us a timestamp at or before the previous one.
    // Nudging past it keeps the series strictly increasing so the interpolator
    // never reads backwards.
    const time = last !== undefined && t <= last.t ? last.t + 1 : t;
    samples.push({ t: time, x, y, angle });
    if (samples.length > exports.MAX_SNAPSHOTS)
        samples.shift();
}
