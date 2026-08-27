"use strict";
/**
 * The two skill-tier multiplier curves, defined once.
 *
 * Six hand-copies of these tables used to live across the client and the
 * server, and they had already drifted into two genuinely different curves.
 * They are kept as two *named* tables rather than collapsed into one because
 * the split is load-bearing: changing either number changes gameplay balance.
 *
 * Pure data — no imports, safe for both the client bundle and the server.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EFFECT_SKILL_MULTIPLIERS = exports.STAT_SKILL_MULTIPLIERS = void 0;
exports.getStatSkillMultiplier = getStatSkillMultiplier;
exports.getEffectSkillMultiplier = getEffectSkillMultiplier;
/**
 * Applied to the player's own *stats*: max health, body damage, and the health
 * of equipped petals. Authoritative — server/playerManager.ts computes real HP
 * and damage from this.
 */
exports.STAT_SKILL_MULTIPLIERS = {
    common: 1,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.3,
    legendary: 1.4,
    mythic: 1.5,
    ultra: 1.6,
    super: 1.7,
    unique: 1.8,
    apex: 1.9
};
/**
 * Applied to petal *effects*: healing output and petal damage. Steeper than the
 * stat curve. Note that the inventory/skills UIs currently render stat figures
 * with this curve, so displayed flower health and body damage read higher than
 * the server actually grants — a pre-existing mismatch, preserved deliberately
 * here rather than silently rebalanced.
 */
exports.EFFECT_SKILL_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.35,
    legendary: 1.6,
    mythic: 2.0,
    ultra: 2.6,
    super: 3.3,
    unique: 4.0,
    apex: 4.8
};
/** Look up a stat multiplier; unset or unknown tiers are neutral. */
function getStatSkillMultiplier(skillTier) {
    if (!skillTier)
        return 1;
    return exports.STAT_SKILL_MULTIPLIERS[skillTier] || 1;
}
/** Look up an effect multiplier; unset or unknown tiers are neutral. */
function getEffectSkillMultiplier(skillTier) {
    if (!skillTier)
        return 1.0;
    return exports.EFFECT_SKILL_MULTIPLIERS[skillTier] || 1.0;
}
