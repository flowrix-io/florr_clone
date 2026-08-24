"use strict";
/**
 * Who earned rights to a mob's rewards.
 *
 * This is the squad-aware wiring around the pure rule in
 * shared/lootEligibility.ts. It lives in its own module — rather than in
 * server/utils.ts, where it used to — because BOTH the drop path and the kill
 * path need it, and utils.ts sits in an import cycle with playerState and
 * petal_actions. Its only dependencies are the squad registry (which imports
 * nothing but the socket server and constants) and the pure rule, so anything
 * may import it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLootRecipients = getLootRecipients;
const squadManager_1 = require("./squadManager");
const lootEligibility_1 = require("./shared/lootEligibility");
/**
 * The players who may loot this mob — the top damage dealers, capped per tier.
 *
 * Squads pool their damage so they RANK as a single contender rather than
 * competing with themselves; the cap is then spent in PLAYERS, and within one
 * entity the slots go to its damage-dealing members best-first. See
 * shared/lootEligibility.ts for the rule and what it used to get wrong.
 */
function getLootRecipients(enemy) {
    const raw = enemy.damageContributors;
    if (!raw || raw.size === 0)
        return [];
    // Bots must not take loot slots from real players — see withoutBots for why
    // this is the difference between loot working locally and in production.
    const contributors = (0, lootEligibility_1.withoutBots)(raw);
    if (contributors.size === 0)
        return [];
    const pooled = (0, squadManager_1.getPooledDamageContributors)(contributors);
    const rankedEntities = Array.from(pooled.entries())
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
    return (0, lootEligibility_1.selectLootRecipients)(contributors, enemy.tier, rankedEntities, entityId => (0, squadManager_1.expandEligibleToPlayerIds)([entityId]));
}
