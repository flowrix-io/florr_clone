"use strict";
/**
 * Player modifier derivation — the ECS replacement for the `getSpeedMultiplier`
 * bridge that reached back into the legacy `players` map.
 *
 * Every per-tick modifier a flower carries (speed, size, magnetism, aggro
 * radius, petal rotation rate) is a pure function of two things: the equipped
 * loadout and the active effect list. Both are components, so this can be a
 * system that writes PlayerModifiers once per tick and lets every consumer —
 * movement, item pickup, mob aggro — read a plain column.
 *
 * That matters beyond tidiness. While `getSpeedMultiplier(player)` was injected,
 * a player existed in TWO representations at once: an entity for the systems and
 * a ServerPlayer for the modifier maths. In a codebase whose split-half and
 * staged-inventory bugs both came from exactly that shape, closing the window is
 * the point of this file.
 *
 * The PETAL STATS lookup stays injected — it reads petals.ts config, which the
 * ECS layer deliberately does not depend on — but the state it reads is now
 * entirely component data.
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
exports.MAX_SIZE_MULTIPLIER = void 0;
exports.createPlayerModifierQueries = createPlayerModifierQueries;
exports.playerModifierSystem = playerModifierSystem;
exports.registerPlayerModifierSystem = registerPlayerModifierSystem;
const C = __importStar(require("../components"));
const system_1 = require("../system");
/**
 * Upper bound on the effective size multiplier.
 *
 * Stacked size petals otherwise grow the hitbox without limit, and a hitbox
 * larger than the substep cap can be pushed through wall geometry — the
 * air/powder wall glitch. 6x is well above any intended build.
 */
exports.MAX_SIZE_MULTIPLIER = 6;
function createPlayerModifierQueries(world) {
    return {
        players: world.query([C.Loadout, C.PlayerModifiers, C.IsPlayer], [C.IsDead]),
    };
}
/**
 * Recompute every player's derived modifiers.
 *
 * Runs in the Input phase, before movement in Simulation, so the values are
 * fresh for the tick that consumes them.
 */
function playerModifierSystem(queries, deps) {
    const { petalModifiersOf, effectSpeedMultiplier, primarySlotCount } = deps;
    return (ctx) => {
        const world = ctx.world;
        queries.players.chunks(chunk => {
            const loadout = chunk.cols(C.Loadout);
            const mods = chunk.cols(C.PlayerModifiers);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                const entity = entities[i];
                const slots = loadout.slots[i];
                let speed = 1;
                let size = 1;
                let magnetism = 0;
                let aggro = 0;
                if (slots) {
                    // Primary slots only — slots 10+ are storage and have never
                    // contributed, exactly as shared/playerModifiers.ts folds.
                    // (rotationSpeed is deliberately NOT folded here: the ring
                    // still reads the legacy additive aggregation; see the
                    // petalOrbitPhase note below.)
                    const limit = Math.min(slots.length, primarySlotCount);
                    for (let s = 0; s < limit; s++) {
                        const slot = slots[s];
                        if (!slot)
                            continue;
                        const m = petalModifiersOf(slot);
                        if (!m)
                            continue;
                        if (m.speedMultiplier !== undefined)
                            speed *= m.speedMultiplier;
                        if (m.playerRadius !== undefined)
                            size *= m.playerRadius;
                        if (m.magnetism !== undefined)
                            magnetism += m.magnetism;
                        if (m.aggroRadius !== undefined)
                            aggro += m.aggroRadius;
                    }
                }
                if (world.has(entity, C.PlayerEffects)) {
                    speed *= effectSpeedMultiplier(world.get(entity, C.PlayerEffects, 'list'));
                }
                // Guard the degenerate cases at the point of derivation rather
                // than in each consumer, with EXACTLY the legacy semantics:
                // a non-finite or non-positive size collapses to 1 (not to the
                // clamp), because applyPetalHealthBonus did — a NaN or negative
                // size makes the movement substep count blow up and spin the
                // loop.
                if (!(speed >= 0))
                    speed = 1;
                if (!(Number.isFinite(size) && size > 0))
                    size = 1;
                else if (size > exports.MAX_SIZE_MULTIPLIER)
                    size = exports.MAX_SIZE_MULTIPLIER;
                if (!(magnetism >= 0))
                    magnetism = 0;
                if (!(aggro >= 0))
                    aggro = 0;
                // `speedBoost` is the full multiplier movement combines with
                // the base speed (movement applies its own 8x clamp on the
                // product): the consumable's base times the loadout and effect
                // folds — `player.speed_boost * getSpeedMultiplier(player)`,
                // derived from components.
                mods.speedBoost[i] = mods.speedBoostBase[i] * speed;
                mods.sizeMultiplier[i] = size;
                mods.magnetism[i] = magnetism;
                mods.aggroRadiusBonus[i] = aggro;
                // `petalOrbitPhase` is deliberately NOT integrated here any
                // more, even though the rotation modifier is derived here and
                // this looks like its home. The ring advances it instead
                // (petalRing.advanceOrbitPhase, driven from
                // server/ecsSync.openPetalRing), for two reasons:
                //
                //  - This system is DISABLED during the cutover (see
                //    LEGACY_OWNED_SYSTEMS in server/ecsSync.ts), so integrating
                //    only here would freeze every orbit. Integrating in BOTH
                //    places once it is re-enabled would silently double the
                //    rate, with nothing failing — the exact shape of bug this
                //    cutover keeps producing.
                //  - `rotation` above stacks MULTIPLICATIVELY, while the legacy
                //    `calculatePlayerModifiers` the ring still reads stacks it
                //    ADDITIVELY (`+= rotationSpeed - 1`). Those disagree for any
                //    two-petal build, so this value cannot drive the ring until
                //    that difference is reconciled deliberately.
                //
                // Whoever enables this system must move the ring's call here,
                // not add a second one.
            }
        });
    };
}
function registerPlayerModifierSystem(scheduler, queries, deps) {
    scheduler.add('playerModifiers', system_1.Phase.Input, playerModifierSystem(queries, deps));
}
