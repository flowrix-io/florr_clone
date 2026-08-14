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

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/** The modifier contributions a single equipped petal makes. */
export interface PetalModifiers {
    /** Multiplied together across the loadout. */
    speedMultiplier?: number;
    /** Multiplied together; scales the flower's radius and hitbox. */
    playerRadius?: number;
    /** Summed; extra pixels of item pickup radius. */
    magnetism?: number;
    /** Summed; extra pixels of the range at which mobs detect this flower. */
    aggroRadius?: number;
    /** Multiplied; bends the petal orbit rate. */
    rotationSpeed?: number;
}

export interface PlayerModifierDeps {
    /**
     * Modifier contributions for one equipped loadout slot, or undefined for an
     * empty slot. Injected because it reads petal config.
     */
    petalModifiersOf(slot: unknown): PetalModifiers | undefined;
    /**
     * Speed multiplier contributed by active effects (boosts, debuffs).
     * Injected for the same reason.
     */
    effectSpeedMultiplier(effects: unknown): number;
}

/**
 * Upper bound on the effective size multiplier.
 *
 * Stacked size petals otherwise grow the hitbox without limit, and a hitbox
 * larger than the substep cap can be pushed through wall geometry — the
 * air/powder wall glitch. 6x is well above any intended build.
 */
export const MAX_SIZE_MULTIPLIER = 6;

export interface PlayerModifierQueries {
    players: Query;
}

export function createPlayerModifierQueries(world: World): PlayerModifierQueries {
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
export function playerModifierSystem(queries: PlayerModifierQueries, deps: PlayerModifierDeps) {
    const { petalModifiersOf, effectSpeedMultiplier } = deps;

    return (ctx: SystemContext): void => {
        const world = ctx.world;

        queries.players.chunks(chunk => {
            const loadout = chunk.cols(C.Loadout);
            const mods = chunk.cols(C.PlayerModifiers);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                const entity = entities[i] as Entity;
                const slots = loadout.slots[i] as unknown[] | undefined;

                let speed = 1;
                let size = 1;
                let magnetism = 0;
                let aggro = 0;
                let rotation = 1;

                if (slots) {
                    for (let s = 0; s < slots.length; s++) {
                        const slot = slots[s];
                        if (!slot) continue;
                        const m = petalModifiersOf(slot);
                        if (!m) continue;
                        if (m.speedMultiplier !== undefined) speed *= m.speedMultiplier;
                        if (m.playerRadius !== undefined) size *= m.playerRadius;
                        if (m.magnetism !== undefined) magnetism += m.magnetism;
                        if (m.aggroRadius !== undefined) aggro += m.aggroRadius;
                        if (m.rotationSpeed !== undefined) rotation *= m.rotationSpeed;
                    }
                }

                if (world.has(entity, C.PlayerEffects)) {
                    speed *= effectSpeedMultiplier(world.get(entity, C.PlayerEffects, 'list'));
                }

                // Guard the degenerate cases at the point of derivation rather
                // than in each consumer. A NaN or negative size makes the
                // movement substep count blow up and spin the loop.
                if (!(speed >= 0)) speed = 1;
                if (!(size > 0)) size = 1;
                if (size > MAX_SIZE_MULTIPLIER) size = MAX_SIZE_MULTIPLIER;
                if (!(magnetism >= 0)) magnetism = 0;
                if (!(aggro >= 0)) aggro = 0;
                if (!(rotation >= 0)) rotation = 1;

                // `speedBoost` is the multiplier movement combines with the
                // base speed; movement applies its own 8x clamp on the product.
                mods.speedBoost[i] = speed;
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

export function registerPlayerModifierSystem(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: PlayerModifierQueries,
    deps: PlayerModifierDeps,
): void {
    scheduler.add('playerModifiers', Phase.Input, playerModifierSystem(queries, deps));
}
