"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RARITY_ORDER = void 0;
exports.getCraftingChance = getCraftingChance;
exports.upgradeRarity = upgradeRarity;
exports.downgradeRarity = downgradeRarity;
exports.getDropUpgradeChance = getDropUpgradeChance;
exports.getDropDowngradeChance = getDropDowngradeChance;
exports.getMobDowngradeChance = getMobDowngradeChance;
exports.stallPower = stallPower;
/** Rarity/tier order from lowest to highest. */
exports.RARITY_ORDER = [
    'common', 'uncommon', 'rare', 'epic', 'legendary',
    'mythic', 'ultra', 'super', 'unique', 'apex',
];
/**
 * Crafting chance for upgrading from one rarity to the next.
 * Halves at each step from a base of 64.
 */
function getCraftingChance(rarityIndex) {
    const baseChance = 64;
    return baseChance / Math.pow(2, rarityIndex);
}
/** Upgrade a rarity by one tier if possible (no-op at the top). */
function upgradeRarity(rarity) {
    const currentIndex = exports.RARITY_ORDER.indexOf(rarity);
    if (currentIndex >= 0 && currentIndex < exports.RARITY_ORDER.length - 1) {
        return exports.RARITY_ORDER[currentIndex + 1];
    }
    return rarity;
}
/** Downgrade a rarity by one tier if possible (no-op at common). */
function downgradeRarity(rarity) {
    const currentIndex = exports.RARITY_ORDER.indexOf(rarity);
    if (currentIndex > 0 && currentIndex < exports.RARITY_ORDER.length) {
        return exports.RARITY_ORDER[currentIndex - 1];
    }
    return rarity;
}
/**
 * Upgrade chance for a drop: crafting chance of the upgraded rarity, / 3.
 * The crafting chance for upgrading TO a rarity is calculated FROM the
 * previous rarity (same as crafting from currentRarity to nextRarity).
 */
function getDropUpgradeChance(currentRarity) {
    const currentIndex = exports.RARITY_ORDER.indexOf(currentRarity);
    if (currentIndex === -1 || currentIndex >= exports.RARITY_ORDER.length - 1) {
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
function getDropDowngradeChance(currentRarity) {
    const currentIndex = exports.RARITY_ORDER.indexOf(currentRarity);
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
function getMobDowngradeChance(currentRarity) {
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
function stallPower(sourceRarity, mobTier) {
    const src = exports.RARITY_ORDER.indexOf(sourceRarity);
    const mob = exports.RARITY_ORDER.indexOf(mobTier);
    if (src < 0 || mob < 0)
        return 1;
    return Math.min(1, Math.pow(3, src - mob));
}
