"use strict";
/**
 * Mob-death handling, consolidated.
 *
 * Historically this was copy-pasted across many sites in server.ts,
 * server/playerState.ts, server/physics.ts, and petal_actions.ts. The sites
 * drift in ways that looked accidental but are load-bearing (see the option
 * flags below), so `killEnemy` takes an explicit options bag — each call site
 * spells out which quirk it wants, and the behavior is byte-identical to the
 * original inline block.
 *
 * What lives here:
 *   - `killEnemy` — the full death sequence (XP, drops, cleanup, splice)
 *     (only set isDead + emit enemyDestroyed; the full cleanup runs later in the
 *     moveEnemies sweep).
 *   - `killEnemy` — the "full" death sequence used by mob-projectile,
 *     player-projectile, ground-pollen, raindrop-aura, and the two
 *     petal-collision handlers in updatePlayerState. Also covers the two
 *     "partial" sites in petal_actions (explodePetal/strikeLightning) via flags.
 *
 * What does NOT live here:
 *   - The poison handler (server.ts updatePoisonEffects) and the melee sweep
 *     (server.ts moveEnemies) have unique shapes — poison runs
 *     handleMobDrops/sendBoss/trackMobKill unconditionally of who gets credit,
 *     and melee omits the enemyDestroyed emit while running
 *     updateSpecialMobCounts unconditionally. Forcing them in here would need
 *     several more flags for one-off behavior; they stay inline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.awardKillXp = awardKillXp;
exports.killEnemy = killEnemy;
const server_utils_1 = require("../../server_utils");
const lootRecipients_1 = require("../lootRecipients");
const lootEligibility_1 = require("./lootEligibility");
const wireOutbox_1 = require("../wireOutbox");
/** The single biggest damage dealer, for rewards that need one player to key off. */
function topDamageContributor(enemy) {
    if (!enemy.damageContributors)
        return undefined;
    let top;
    let best = 0;
    enemy.damageContributors.forEach((damage, playerId) => {
        if (damage > best) {
            best = damage;
            top = playerId;
        }
    });
    return top;
}
/**
 * Award a mob's XP to everyone who earned loot rights on it.
 *
 * Each recipient gets the mob's FULL XP — this is not a split. The leaderboard
 * multiplier is applied PER RECIPIENT, because it is a property of that
 * player's account (top-10 accounts earn less per kill), not of the mob.
 *
 * Recipients are de-duplicated by ACCOUNT, not by player id: a split flower is
 * two player records for one person, and both halves can appear in the damage
 * tally. Paying both would hand that person double XP for one kill.
 *
 * Imported directly rather than injected like the rest of this file's
 * dependencies: `lootRecipients` reaches only the squad registry and a pure
 * rule, so it closes no cycle — and a direct import means no kill path can
 * forget to wire it and silently go back to paying one player.
 *
 * Exported because the kill paths that do NOT go through `killEnemy` — the
 * poison death sequence and the reaper — have to award XP the same way.
 */
function awardKillXp(enemy, ctx) {
    const recipients = (0, lootRecipients_1.getLootRecipients)(enemy);
    if (recipients.length === 0)
        return;
    (0, lootEligibility_1.payFullXpToEach)(
    // Only players still in the world can be paid.
    recipients.filter(id => ctx.players[id] !== undefined), (0, server_utils_1.getXPFromEnemy)(enemy), playerId => ctx.playerUserIds[playerId], playerId => ctx.database.getLeaderboardRewardMultipliers(ctx.playerUserIds[playerId]).xpMultiplier, (playerId, xp) => ctx.addXPToPlayer(ctx.players[playerId], xp, playerId));
}
/**
 * Run the full death sequence for `enemy` and remove it from the world.
 *
 * The caller supplies neither an index nor the container: removal is by
 * identity, and removing a mob that has already left is a no-op.
 *
 * `enemy` is marked isDead on entry. Order of operations:
 *   1. resolve credited player (killerPlayerId)
 *   2. if credited: XP, drops, boss message, updateSpecialMobCounts
 *   3. snapshot damageContributors (cleanup clears them)
 *   4. cleanupEnemy, splice, emit enemyDestroyed
 *   5. trackMobKill (sync-snapshot or deferred), gated on credit + contributor copy
 */
function killEnemy(enemy, ctx, opts = {}) {
    const { killerPlayerId, emitDestroyed = true, trackMobKillTiming = 'sync-snapshot', requireNonEmptyContributors = false, skipCleanup = false, } = opts;
    enemy.isDead = true;
    // --- resolve the player who gets credit ---
    const creditedPlayerId = killerPlayerId;
    const creditedPlayer = killerPlayerId !== undefined ? ctx.players[killerPlayerId] : undefined;
    // --- XP + drops + boss message + special-mob count (only when someone gets credit) ---
    // XP goes to everyone who earned loot rights, and each of them gets the
    // mob's FULL value — it is not a share divided between them. Killing blow
    // no longer decides it: a last hit on something you barely damaged wins no
    // loot slot, so it wins no XP either.
    awardKillXp(enemy, ctx);
    // Drops are gated on the SAME thing as xp: somebody earned rewards from
    // this mob. They used to require a CREDITED KILLER, which is a different
    // question — a death with damage on it but no attributed killing blow (an
    // explosion, a lightning strike, a mob finished by a pet whose owner left)
    // paid xp to every looter and then dropped nothing at all.
    //
    // The multiplier still needs ONE player to key off, since a drop is a
    // single roll for the whole mob: the credited killer when there is one, and
    // otherwise the biggest damage dealer — which is what the reaper path has
    // always used.
    const dropCreditId = creditedPlayer ? creditedPlayerId : topDamageContributor(enemy);
    if (dropCreditId !== undefined && ctx.players[dropCreditId] !== undefined) {
        // Leaderboard reward tiers: top 10 accounts get 0.5x XP / 1.2x drop rate,
        // top 20 get 0.75x XP / 1.1x drop rate. Only the DROP half is keyed to
        // one player; xp is per-recipient, above.
        const { dropMultiplier } = ctx.database.getLeaderboardRewardMultipliers(ctx.playerUserIds[dropCreditId]);
        ctx.handleMobDrops(enemy, dropMultiplier);
        ctx.sendBossMobDefeatedMessage(enemy, ctx.io, ctx.players);
        ctx.updateSpecialMobCounts();
    }
    // Snapshot damageContributors before cleanup clears them (sync-snapshot / deferred).
    const needSnapshot = trackMobKillTiming === 'sync-snapshot' || trackMobKillTiming === 'deferred';
    const damageContributorsCopy = needSnapshot && enemy.damageContributors
        ? new Map(enemy.damageContributors)
        : undefined;
    if (!skipCleanup)
        ctx.cleanupEnemy(enemy);
    ctx.removeEnemy(enemy);
    if (emitDestroyed)
        (0, wireOutbox_1.getWireOutbox)().all('enemyDestroyed', enemy.id);
    // --- kill tracking (snapshot modes run here, after cleanup) ---
    if (trackMobKillTiming === 'sync-snapshot' || trackMobKillTiming === 'deferred') {
        const qualifies = damageContributorsCopy &&
            (!requireNonEmptyContributors || damageContributorsCopy.size > 0) &&
            creditedPlayer;
        if (qualifies) {
            const enemyDataForTracking = {
                type: enemy.type,
                tier: enemy.tier,
                damageContributors: damageContributorsCopy,
            };
            if (trackMobKillTiming === 'deferred') {
                setImmediate(() => {
                    ctx.trackMobKill(enemyDataForTracking, ctx.players, ctx.playerUserIds, ctx.database, ctx.io, ctx.savePlayerProgress);
                });
            }
            else {
                ctx.trackMobKill(enemyDataForTracking, ctx.players, ctx.playerUserIds, ctx.database, ctx.io, ctx.savePlayerProgress);
            }
        }
    }
    // trackMobKillTiming === 'none': no tracking.
}
