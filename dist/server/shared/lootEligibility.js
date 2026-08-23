"use strict";
/**
 * Who may loot a mob.
 *
 * Pure policy: no world, no sockets, no squad registry — the caller supplies the
 * ranking and the membership lookup. That is what makes the rule testable
 * without booting a server (requiring server/utils.ts pulls in the whole game,
 * listening port and all).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASE_LOOT_SLOTS = void 0;
exports.lootSlotsForTier = lootSlotsForTier;
exports.selectLootRecipients = selectLootRecipients;
exports.payFullXpToEach = payFullXpToEach;
/**
 * How many players may loot a mob of each tier.
 *
 * Everything up to and including mythic shares the base count; the boss tiers
 * open up because they take a crowd to kill, and one shared number for all of
 * them meant a super or unique was capped as tightly as an ultra.
 *
 * `apex` was not part of the spec these numbers came from. It sits above
 * unique, so it inherits unique's count rather than falling back to the base 4.
 */
const LOOT_SLOTS_BY_TIER = {
    ultra: 15,
    super: 20,
    unique: 25,
    apex: 25,
};
/** common, uncommon, rare, epic, legendary, mythic. */
exports.BASE_LOOT_SLOTS = 4;
/** Loot slots for a mob tier. */
function lootSlotsForTier(tier) {
    return LOOT_SLOTS_BY_TIER[tier] ?? exports.BASE_LOOT_SLOTS;
}
/**
 * Pick the players who may loot, best-first, capped by tier.
 *
 * `rankedEntities` is best-first and may contain squad ids as well as player
 * ids — squads rank as ONE contender so a squad wins a slot together instead of
 * competing with itself. `membersOf` expands an entity into its player ids.
 *
 * The cap is spent in PLAYERS, which is the whole point: the old rule capped
 * ENTITIES and then expanded squads afterwards with no limit, so "4 players may
 * loot" meant "4 squads may loot" and four squads of ten took forty slots. A
 * player who dealt no damage is never eligible, squad member or not.
 */
function selectLootRecipients(contributors, tier, rankedEntities, membersOf) {
    const slots = lootSlotsForTier(tier);
    if (slots <= 0 || contributors.size === 0)
        return [];
    const eligible = [];
    const taken = new Set();
    for (const entityId of rankedEntities) {
        if (eligible.length >= slots)
            break;
        // Within one entity, slots go to the members who earned them.
        const members = membersOf(entityId)
            .filter(playerId => (contributors.get(playerId) ?? 0) > 0)
            .sort((a, b) => (contributors.get(b) ?? 0) - (contributors.get(a) ?? 0));
        for (const playerId of members) {
            if (eligible.length >= slots)
                break;
            if (taken.has(playerId))
                continue;
            taken.add(playerId);
            eligible.push(playerId);
        }
    }
    return eligible;
}
/**
 * Pay each recipient the mob's FULL xp.
 *
 * Not a share: four looters on a mob worth 30 xp receive 30 each, not 7 or 8.
 *
 * De-duplicated by ACCOUNT rather than player id, because a split flower is two
 * player records for one person and both halves can appear in the damage tally
 * — paying both would double that person's xp for one kill. A recipient with no
 * account (a bot) falls back to its own id, which keeps bots distinct from each
 * other rather than collapsing them all into one payee.
 *
 * The leaderboard multiplier is applied PER RECIPIENT: it is a property of that
 * player's account (top-10 accounts earn less per kill), not of the mob, so it
 * cannot be resolved once for the whole payout.
 */
function payFullXpToEach(recipients, baseXp, accountOf, multiplierOf, pay) {
    const paidAccounts = new Set();
    for (const playerId of recipients) {
        const account = accountOf(playerId) ?? playerId;
        if (paidAccounts.has(account))
            continue;
        paidAccounts.add(account);
        pay(playerId, Math.round(baseXp * multiplierOf(playerId)));
    }
}
