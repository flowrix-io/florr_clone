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

import type { Enemy } from '../../server_utils';
import type { Server as SocketIOServer } from '../../ws_server';
import { getXPFromEnemy } from '../../server_utils';

/** Kill-time dependencies injected by the caller (mirrors PlayerStateDependencies' kill subset). */
export interface KillContext {
    io: SocketIOServer | any;
    players: Record<string, any>;
    playerUserIds: Record<string, string>;
    database: any;
    savePlayerProgress: (player: any, userId: string) => void;
    addXPToPlayer: (player: any, xp: number, socketId?: string) => void;
    handleMobDrops: (enemy: Enemy, dropMultiplier?: number) => void;
    sendBossMobDefeatedMessage: (enemy: Enemy, io: any, players: Record<string, any>) => void;
    updateSpecialMobCounts: () => void;
    cleanupEnemy: (enemy: Enemy) => void;
    trackMobKill: (
        enemy: Enemy,
        players: Record<string, any>,
        playerUserIds: Record<string, string>,
        database: any,
        io?: any,
        savePlayerProgress?: (player: any, userId: string) => void,
    ) => void;
}

export interface KillOptions {
    /** Player to credit for the kill (XP + loot + boss message + trackMobKill). */
    killerPlayerId?: string;
    /** Whether to io.emit('enemyDestroyed', id). Default true. */
    emitDestroyed?: boolean;
    /**
     * When/how to run trackMobKill:
     *   - 'sync-snapshot' (default) copy damageContributors, pass a snapshot synchronously
     *   - 'deferred'       same snapshot, but via setImmediate (mob-projectile)
     *   - 'none'           don't track (petal_actions' explode/lightning)
     */
    trackMobKillTiming?: 'sync-snapshot' | 'deferred' | 'none';
    /**
     * Only call trackMobKill when damageContributorsCopy.size > 0.
     * The first petal-collision handler (updatePlayerState) guards on this;
     * every other site calls whenever the copy exists.
     */
    requireNonEmptyContributors?: boolean;
    /**
     * Drop the per-enemy cleanup step. petal_actions' explode/lightning never
     * called cleanupEnemy historically (minor per-enemy-map leak); preserve.
     */
    skipCleanup?: boolean;
}

/**
 * Minimal death marker for physics.checkEnemyEnemyCollisions: set isDead and
 * emit enemyDestroyed. The full XP/loot/cleanup/splice is deferred to the
 * moveEnemies post-melee sweep (which credits via damageContributors).
 */
export function markDeadAndEmit(enemy: Enemy, io: any): void {
    (enemy as any).isDead = true;
    if (io) io.emit('enemyDestroyed', enemy.id);
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
export function killEnemy(
    enemy: Enemy,
    index: number,
    enemies: Enemy[],
    ctx: KillContext,
    opts: KillOptions = {},
): void {
    const {
        killerPlayerId,
        emitDestroyed = true,
        trackMobKillTiming = 'sync-snapshot',
        requireNonEmptyContributors = false,
        skipCleanup = false,
    } = opts;

    (enemy as any).isDead = true;

    // --- resolve the player who gets credit ---
    const creditedPlayerId = killerPlayerId;
    const creditedPlayer = killerPlayerId !== undefined ? ctx.players[killerPlayerId] : undefined;

    // --- XP + drops + boss message + special-mob count (only when someone gets credit) ---
    if (creditedPlayer) {
        // Leaderboard reward tiers: top 10 accounts get 0.5x XP / 1.2x drop rate,
        // top 20 get 0.75x XP / 1.1x drop rate.
        const { xpMultiplier, dropMultiplier } = ctx.database.getLeaderboardRewardMultipliers(ctx.playerUserIds[creditedPlayerId!]);
        const xpGained = Math.round(getXPFromEnemy(enemy) * xpMultiplier);
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

    if (!skipCleanup) ctx.cleanupEnemy(enemy);
    if (index >= 0 && index < enemies.length) {
        enemies.splice(index, 1);
    }
    if (emitDestroyed) ctx.io.emit('enemyDestroyed', enemy.id);

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
            } as unknown as Enemy;
            if (trackMobKillTiming === 'deferred') {
                setImmediate(() => {
                    ctx.trackMobKill(enemyDataForTracking, ctx.players, ctx.playerUserIds, ctx.database, ctx.io, ctx.savePlayerProgress);
                });
            } else {
                ctx.trackMobKill(enemyDataForTracking, ctx.players, ctx.playerUserIds, ctx.database, ctx.io, ctx.savePlayerProgress);
            }
        }
    }
    // trackMobKillTiming === 'none': no tracking.
}
