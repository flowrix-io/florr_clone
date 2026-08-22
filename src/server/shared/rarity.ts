/**
 * Shared rarity/tier math.
 *
 * This was previously duplicated across `server/enemySpawner.ts`,
 * `server/itemManager.ts`, `server/botManager.ts`, `server/mazeSpawner.ts`,
 * and `mob_drops.ts` — each with its own `RARITY_ORDER` array and its own
 * copy of the craft/upgrade/downgrade formulas. They were byte-identical or
 * near-identical; this module is the single source of truth.
 *
 * "Rarity" and "tier" are the same axis — mobs call it `tier`, items call it
 * `rarity`. Both are strings from `RARITY_ORDER`.
 */

export type Rarity =
    | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
    | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';

/** Rarity/tier order from lowest to highest. */
export const RARITY_ORDER: Rarity[] = [
    'common', 'uncommon', 'rare', 'epic', 'legendary',
    'mythic', 'ultra', 'super', 'unique', 'apex',
];

/**
 * Crafting chance for upgrading from one rarity to the next.
 * Halves at each step from a base of 64.
 */
export function getCraftingChance(rarityIndex: number): number {
    const baseChance = 64;
    return baseChance / Math.pow(2, rarityIndex);
}

/** Upgrade a rarity by one tier if possible (no-op at the top). */
export function upgradeRarity(rarity: Rarity): Rarity {
    const currentIndex = RARITY_ORDER.indexOf(rarity);
    if (currentIndex >= 0 && currentIndex < RARITY_ORDER.length - 1) {
        return RARITY_ORDER[currentIndex + 1];
    }
    return rarity;
}

/** Downgrade a rarity by one tier if possible (no-op at common). */
export function downgradeRarity(rarity: Rarity): Rarity {
    const currentIndex = RARITY_ORDER.indexOf(rarity);
    if (currentIndex > 0 && currentIndex < RARITY_ORDER.length) {
        return RARITY_ORDER[currentIndex - 1];
    }
    return rarity;
}

/**
 * Upgrade chance for a drop: crafting chance of the upgraded rarity, / 3.
 * The crafting chance for upgrading TO a rarity is calculated FROM the
 * previous rarity (same as crafting from currentRarity to nextRarity).
 */
export function getDropUpgradeChance(currentRarity: Rarity): number {
    const currentIndex = RARITY_ORDER.indexOf(currentRarity);
    if (currentIndex === -1 || currentIndex >= RARITY_ORDER.length - 1) {
        return 0; // Invalid rarity or already at max tier
    }
    const craftingChance = getCraftingChance(currentIndex);
    return craftingChance / 3;
}

/**
 * Downgrade chance for a drop: 1 / (1 + craft chance to that rarity).
 * The crafting chance for upgrading TO a rarity is calculated FROM the
 * previous rarity (craft chance from currentIndex-1 to currentIndex).
 */
export function getDropDowngradeChance(currentRarity: Rarity): number {
    const currentIndex = RARITY_ORDER.indexOf(currentRarity);
    if (currentIndex === -1 || currentIndex === 0) {
        return 0; // Invalid rarity or already at lowest tier (common)
    }
    const craftingChanceToCurrentRarity = getCraftingChance(currentIndex - 1);
    return 1 / (1 + craftingChanceToCurrentRarity);
}

/**
 * Downgrade chance for a mob (1 / (1 + craft chance to that rarity)).
 * Same formula as `getDropDowngradeChance`; kept as a separate export because
 * mob-spawn code historically referenced it by this name.
 */
export function getMobDowngradeChance(currentRarity: Rarity): number {
    return getDropDowngradeChance(currentRarity);
}

/**
 * How much of a slow (web/honey/pincer) actually lands on a mob: 1 at equal
 * rarity, falling 3x per tier the mob is above the slow's source, clamped at 1
 * so out-rareing the mob only buys reliability against tougher mobs, never a
 * slow stronger than the petal's own design value.
 *
 * Moved here from playerState.ts when slows became ECS-owned: both the legacy
 * petal loop and the ECS composition root need it, and importing playerState
 * from the composition root would drag in a module that binds a port.
 */
export function stallPower(sourceRarity: string, mobTier: string): number {
    const src = RARITY_ORDER.indexOf(sourceRarity as Rarity);
    const mob = RARITY_ORDER.indexOf(mobTier as Rarity);
    if (src < 0 || mob < 0) return 1;
    return Math.min(1, Math.pow(3, src - mob));
}
