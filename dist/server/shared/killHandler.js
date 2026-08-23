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
exports.killEnemy = killEnemy;
const server_utils_1 = require("../../server_utils");
const wireOutbox_1 = require("../wireOutbox");
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
    if (creditedPlayer) {
        // Leaderboard reward tiers: top 10 accounts get 0.5x XP / 1.2x drop rate,
        // top 20 get 0.75x XP / 1.1x drop rate.
        const { xpMultiplier, dropMultiplier } = ctx.database.getLeaderboardRewardMultipliers(ctx.playerUserIds[creditedPlayerId]);
        const xpGained = Math.round((0, server_utils_1.getXPFromEnemy)(enemy) * xpMultiplier);
        ctx.addXPToPlayer(creditedPlayer, xpGained, creditedPlayerId);
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
