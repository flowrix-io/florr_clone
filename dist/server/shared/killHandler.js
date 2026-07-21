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
 *   - `markDeadAndEmit` — the 4 minimal sites in physics.checkEnemyEnemyCollisions
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
exports.markDeadAndEmit = markDeadAndEmit;
exports.killEnemy = killEnemy;
const server_utils_1 = require("../../server_utils");
/**
 * Minimal death marker for physics.checkEnemyEnemyCollisions: set isDead and
 * emit enemyDestroyed. The full XP/loot/cleanup/splice is deferred to the
 * moveEnemies post-melee sweep (which credits via damageContributors).
 */
function markDeadAndEmit(enemy, io) {
    enemy.isDead = true;
    if (io)
        io.emit('enemyDestroyed', enemy.id);
}
/**
 * Run the full death sequence for `enemy` and splice it from `enemies` at
 * `index`. The caller owns the index (loop variable or findIndex result);
 * if the enemy is no longer in the array, pass -1 and no splice happens.
 *
 * `enemy` is marked isDead on entry. Order of operations:
 *   1. resolve credited player (killerPlayerId)
 *   2. if credited: XP, drops, boss message, updateSpecialMobCounts
 *   3. snapshot damageContributors (cleanup clears them)
 *   4. cleanupEnemy, splice, emit enemyDestroyed
 *   5. trackMobKill (sync-snapshot or deferred), gated on credit + contributor copy
 */
function killEnemy(enemy, index, enemies, ctx, opts = {}) {
    const { killerPlayerId, emitDestroyed = true, trackMobKillTiming = 'sync-snapshot', requireNonEmptyContributors = false, skipCleanup = false, } = opts;
    enemy.isDead = true;
    // --- resolve the player who gets credit ---
    const creditedPlayerId = killerPlayerId;
    const creditedPlayer = killerPlayerId !== undefined ? ctx.players[killerPlayerId] : undefined;
    // --- XP + drops + boss message + special-mob count (only when someone gets credit) ---
    if (creditedPlayer) {
        const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
        ctx.addXPToPlayer(creditedPlayer, xpGained, creditedPlayerId);
        ctx.handleMobDrops(enemy);
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
    if (index >= 0 && index < enemies.length) {
        enemies.splice(index, 1);
    }
    if (emitDestroyed)
        ctx.io.emit('enemyDestroyed', enemy.id);
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
