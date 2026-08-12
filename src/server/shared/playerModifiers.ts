/**
 * The equipped-petal modifier aggregation, as a module with NO side effects.
 *
 * This is `calculatePlayerModifiers`, moved out of server/playerManager.ts
 * verbatim. Nothing about the arithmetic changed; what changed is what you have
 * to load to call it.
 *
 * ---------------------------------------------------------------------------
 * Why it had to move
 * ---------------------------------------------------------------------------
 * Requiring server/playerManager.ts pulls server/utils.ts, which imports
 * petal_actions.ts and server/playerState.ts at module scope — and both of those
 * bind port 3000 and open the account database the moment they are required. So
 * any module that wanted the real modifier maths and also wanted to be loadable
 * from a headless gate had exactly two options: boot a second game server, or
 * hand-copy the formula.
 *
 * server/botManager.ts took the second option, three times over
 * (`getBotSpeedMod`, `getBotRangeMod`, and the `playerRangeMod` term inside
 * `computePetalReach`). Hand copies of a formula do not fail when they drift —
 * a bot whose reach estimate is 30px optimistic simply parks where its petals
 * cannot connect, forever, with every gate green. Removing the reason to copy is
 * the fix; `server/bots/botReach.ts` now calls this.
 *
 * Two details of the original that a "tidy-up" would quietly break, and that the
 * ECS's own `systems/playerModifiers.ts` deliberately does NOT match yet:
 *
 *   - `rotationSpeed` stacks ADDITIVELY (`+= x - 1`), not multiplicatively.
 *   - only the PRIMARY ten slots contribute. Slots 10+ are storage.
 */

import { ServerPlayer } from '../../player';
import { getPetalStats, PlayerModifiers } from '../../petals';

/** Slots beyond this index are storage and contribute no modifiers. */
export const PRIMARY_LOADOUT_SLOTS = 10;

/**
 * Calculate combined player modifiers from all equipped petals.
 */
export function calculatePlayerModifiers(player: ServerPlayer): PlayerModifiers {
    const modifiers: PlayerModifiers = {
        damage: 1.0,
        maxHealth: 1.0,
        speed: 1.0,
        range: 1.0,
        rotationSpeed: 1.0,
        playerRadius: 1.0,
        magnetism: 0,
        luck: 1.0,
        petalAttractionRadius: 30,
        aggroRadius: 0,
        poisonArmor: 0
    };

    if (!player.loadout) return modifiers;

    // Sum up modifiers from all equipped petals.
    // Secondary loadout (slots 10+) is storage only — its petals contribute no modifiers.
    for (let i = 0; i < player.loadout.length; i++) {
        if (i >= PRIMARY_LOADOUT_SLOTS) break;
        const item = player.loadout[i];
        if (!item || item.type !== 'petal' || !item.petalType || !item.rarity) continue;

        const petalStats = getPetalStats(item.petalType, item.rarity);
        if (!petalStats || !petalStats.playerModifiers) continue;

        const petalModifiers = petalStats.playerModifiers;

        // Multiplicative stacking: multiply all modifiers together
        if (petalModifiers.damage !== undefined && modifiers.damage !== undefined) {
            modifiers.damage *= petalModifiers.damage;
        }
        if (petalModifiers.maxHealth !== undefined && modifiers.maxHealth !== undefined) {
            modifiers.maxHealth *= petalModifiers.maxHealth;
        }
        if (petalModifiers.speed !== undefined && modifiers.speed !== undefined) {
            modifiers.speed *= petalModifiers.speed;
        }
        if (petalModifiers.range !== undefined && modifiers.range !== undefined) {
            modifiers.range *= petalModifiers.range;
        }
        if (petalModifiers.rotationSpeed !== undefined && modifiers.rotationSpeed !== undefined) {
            modifiers.rotationSpeed += petalModifiers.rotationSpeed - 1;
        }
        if (petalModifiers.playerRadius !== undefined && modifiers.playerRadius !== undefined) {
            modifiers.playerRadius *= petalModifiers.playerRadius;
        }
        if (petalModifiers.magnetism !== undefined && modifiers.magnetism !== undefined) {
            modifiers.magnetism += petalModifiers.magnetism;
        }
        if (petalModifiers.luck !== undefined && modifiers.luck !== undefined) {
            modifiers.luck += petalModifiers.luck;
        }
        if (petalModifiers.petalAttractionRadius !== undefined && modifiers.petalAttractionRadius !== undefined) {
            modifiers.petalAttractionRadius += petalModifiers.petalAttractionRadius;
        }
        if (petalModifiers.aggroRadius !== undefined && modifiers.aggroRadius !== undefined) {
            modifiers.aggroRadius += petalModifiers.aggroRadius;
        }
        // Poison armor does NOT stack: gardn takes the strongest equipped lotus
        // (`player.poison_armor = std::fmax(...)` in Process/Flower.cc), the same
        // way salt's damage reflection is documented as not stacking with itself.
        if (petalModifiers.poisonArmor !== undefined && modifiers.poisonArmor !== undefined) {
            modifiers.poisonArmor = Math.max(modifiers.poisonArmor, petalModifiers.poisonArmor);
        }
    }

    return modifiers;
}
