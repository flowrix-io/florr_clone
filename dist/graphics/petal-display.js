"use strict";
/**
 * Shared petal presentation helpers.
 *
 * Name formatting, number abbreviation, skill-adjusted final stats and the
 * petal tooltip were each hand-copied across inventory.ts,
 * title_screen/inventory_manager.ts, graphics/inventory-panel.ts and
 * graphics/crafting-panel.ts. They live here once so the inventory, the title
 * screen and the canvas panels can never drift apart again.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPetalName = formatPetalName;
exports.abbreviateNumber = abbreviateNumber;
exports.finalPetalDamage = finalPetalDamage;
exports.finalPetalHealth = finalPetalHealth;
exports.showPetalTooltip = showPetalTooltip;
exports.clearPetalTooltip = clearPetalTooltip;
const petals_1 = require("../petals");
const skill_multipliers_1 = require("../skill_multipliers");
const tooltip_1 = require("./tooltip");
/** "blood_leaf" -> "Blood leaf". */
function formatPetalName(petalType) {
    if (!petalType)
        return '';
    const name = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
    return name.replace(/_/g, ' ');
}
/** 1000 -> "1K", 1500 -> "1.5K", up to billions. */
function abbreviateNumber(value) {
    if (value < 1000) {
        return value.toString();
    }
    else if (value < 1000000) {
        const k = value / 1000;
        return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
    }
    else if (value < 1000000000) {
        const m = value / 1000000;
        return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
    }
    else {
        const b = value / 1000000000;
        return b % 1 === 0 ? `${b}B` : `${b.toFixed(1)}B`;
    }
}
/**
 * Petal damage after the damage skill. Player modifiers from other petals
 * affect *player* damage, not petal damage, so they are deliberately not
 * applied here.
 */
function finalPetalDamage(petalType, rarity, skills) {
    const stats = (0, petals_1.getPetalStats)(petalType, rarity);
    if (!stats)
        return 0;
    return Math.round(stats.damage * (0, skill_multipliers_1.getEffectSkillMultiplier)(skills?.damage));
}
/** Petal health after the petal-health skill. */
function finalPetalHealth(petalType, rarity, skills) {
    const stats = (0, petals_1.getPetalStats)(petalType, rarity);
    if (!stats)
        return 0;
    return Math.round(stats.health * (0, skill_multipliers_1.getEffectSkillMultiplier)(skills?.petalHealth));
}
/**
 * Shows the shared petal tooltip (graphics/tooltip.ts) next to an anchor rect,
 * with the caller's skill-adjusted final stats. No-op for unknown petals.
 */
function showPetalTooltip(anchor, petalType, rarity, skills) {
    const stats = (0, petals_1.getPetalStats)(petalType, rarity);
    if (!stats)
        return;
    (0, tooltip_1.showTooltip)(anchor, (0, tooltip_1.petalTooltipLines)(stats, rarity, finalPetalHealth(petalType, rarity, skills), finalPetalDamage(petalType, rarity, skills), abbreviateNumber));
}
/** Clears a pending tooltip timer and hides the overlay. Returns null so
 *  callers can write `this.tooltipTimeout = clearPetalTooltip(...)`. */
function clearPetalTooltip(tooltipTimeout) {
    if (tooltipTimeout !== null)
        clearTimeout(tooltipTimeout);
    (0, tooltip_1.hideTooltip)();
    return null;
}
