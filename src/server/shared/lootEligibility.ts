import { isBotId } from './botId';

/**
 * Who may loot a mob.
 *
 * Pure policy: no world, no sockets, no squad registry — the caller supplies the
 * ranking and the membership lookup. That is what makes the rule testable
 * without booting a server (requiring server/utils.ts pulls in the whole game,
 * listening port and all).
 */

/**
 * Drop filler bots from a damage tally.
 *
 * Bots fight, so their damage lands in the tally like anyone's — and with a slot
 * cap of 4 on ordinary mobs, four bots on a mob shut a real player out of loot
 * they helped earn. That is invisible on a quiet local server and constant on a
 * live one, where the roster is topped up to ~23 bots: it is why loot can "work
 * locally and not in production".
 *
 * Nothing is lost by skipping them — a bot's inventory is not a real inventory —
 * and a mob only bots touched now drops nothing rather than littering the world
 * with loot no player is eligible for. Bot damage is already excluded from the
 * target-dummy DPS readout for the same reason.
 */
export function withoutBots(
    contributors: ReadonlyMap<string, number>,
): Map<string, number> {
    const out = new Map<string, number>();
    for (const [playerId, damage] of contributors) {
        if (!isBotId(playerId)) out.set(playerId, damage);
    }
    return out;
}

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
const LOOT_SLOTS_BY_TIER: Readonly<Record<string, number>> = {
    ultra: 15,
    super: 20,
    unique: 25,
    apex: 25,
};

/** common, uncommon, rare, epic, legendary, mythic. */
export const BASE_LOOT_SLOTS = 4;

/** Loot slots for a mob tier. */
export function lootSlotsForTier(tier: string): number {
    return LOOT_SLOTS_BY_TIER[tier] ?? BASE_LOOT_SLOTS;
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
export function selectLootRecipients(
    contributors: ReadonlyMap<string, number>,
    tier: string,
    rankedEntities: readonly string[],
    membersOf: (entityId: string) => string[],
): string[] {
    const slots = lootSlotsForTier(tier);
    if (slots <= 0 || contributors.size === 0) return [];

    const eligible: string[] = [];
    const taken = new Set<string>();

    for (const entityId of rankedEntities) {
        if (eligible.length >= slots) break;

        // Within one entity, slots go to the members who earned them.
        const members = membersOf(entityId)
            .filter(playerId => (contributors.get(playerId) ?? 0) > 0)
            .sort((a, b) => (contributors.get(b) ?? 0) - (contributors.get(a) ?? 0));

        for (const playerId of members) {
            if (eligible.length >= slots) break;
            if (taken.has(playerId)) continue;
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
export function payFullXpToEach(
    recipients: readonly string[],
    baseXp: number,
    accountOf: (playerId: string) => string | undefined,
    multiplierOf: (playerId: string) => number,
    pay: (playerId: string, xp: number) => void,
): void {
    const paidAccounts = new Set<string>();
    for (const playerId of recipients) {
        const account = accountOf(playerId) ?? playerId;
        if (paidAccounts.has(account)) continue;
        paidAccounts.add(account);
        pay(playerId, Math.round(baseXp * multiplierOf(playerId)));
    }
}
