/**
 * Shared petal presentation helpers.
 *
 * Name formatting, number abbreviation, skill-adjusted final stats and the
 * petal tooltip were each hand-copied across inventory.ts,
 * title_screen/inventory_manager.ts, graphics/inventory-panel.ts and
 * graphics/crafting-panel.ts. They live here once so the inventory, the title
 * screen and the canvas panels can never drift apart again.
 */

import { getPetalStats } from '../petals';
import { getEffectSkillMultiplier } from '../skill_multipliers';
import {
    showTooltip as showTooltipOverlay,
    hideTooltip as hideTooltipOverlay,
    petalTooltipLines,
    TooltipAnchor,
} from './tooltip';

/** The subset of a player this module needs: their skill tiers. */
export interface SkillTiers {
    damage?: string;
    petalHealth?: string;
    [key: string]: string | undefined;
}

/**
 * Title-cases a petal type for display: "blood_leaf" -> "Blood Leaf",
 * "rose" -> "Rose".
 *
 * Every word is capitalised, which is what the loadout bar has always done.
 * The inventory and the canvas panels used to capitalise only the first word
 * ("Blood leaf"), so the same petal read differently depending on where you
 * looked; they now all use this.
 */
export function formatPetalName(petalType: string): string {
    if (!petalType) return '';
    return petalType
        .split(/[_\s]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

/** 1000 -> "1K", 1500 -> "1.5K", up to billions. */
export function abbreviateNumber(value: number): string {
    if (value < 1000) {
        return value.toString();
    } else if (value < 1000000) {
        const k = value / 1000;
        return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
    } else if (value < 1000000000) {
        const m = value / 1000000;
        return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
    } else {
        const b = value / 1000000000;
        return b % 1 === 0 ? `${b}B` : `${b.toFixed(1)}B`;
    }
}

/**
 * Petal damage after the damage skill. Player modifiers from other petals
 * affect *player* damage, not petal damage, so they are deliberately not
 * applied here.
 */
export function finalPetalDamage(petalType: string, rarity: string, skills: SkillTiers | undefined): number {
    const stats = getPetalStats(petalType, rarity);
    if (!stats) return 0;
    return Math.round(stats.damage * getEffectSkillMultiplier(skills?.damage));
}

/** Petal health after the petal-health skill. */
export function finalPetalHealth(petalType: string, rarity: string, skills: SkillTiers | undefined): number {
    const stats = getPetalStats(petalType, rarity);
    if (!stats) return 0;
    return Math.round(stats.health * getEffectSkillMultiplier(skills?.petalHealth));
}

/**
 * Shows the shared petal tooltip (graphics/tooltip.ts) next to an anchor rect,
 * with the caller's skill-adjusted final stats. No-op for unknown petals.
 */
export function showPetalTooltip(
    anchor: TooltipAnchor,
    petalType: string,
    rarity: string,
    skills: SkillTiers | undefined,
): void {
    const stats = getPetalStats(petalType, rarity);
    if (!stats) return;
    showTooltipOverlay(anchor, petalTooltipLines(
        stats,
        rarity,
        finalPetalHealth(petalType, rarity, skills),
        finalPetalDamage(petalType, rarity, skills),
        abbreviateNumber,
    ));
}

/** Clears a pending tooltip timer and hides the overlay. Returns null so
 *  callers can write `this.tooltipTimeout = clearPetalTooltip(...)`. */
export function clearPetalTooltip(tooltipTimeout: number | null): null {
    if (tooltipTimeout !== null) clearTimeout(tooltipTimeout);
    hideTooltipOverlay();
    return null;
}
