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

import type { Enemy } from '../../server_utils';
import type { Server as SocketIOServer } from '../../ws_server';
import { getXPFromEnemy } from '../../server_utils';
import { getLootRecipients } from '../lootRecipients';
import { payFullXpToEach } from './lootEligibility';
import { getWireOutbox } from '../wireOutbox';

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
    /**
     * Remove this mob from the game — it retires the ECS entity, which IS the
     * mob's existence now that `liveEnemies()` projects the shell list out of
     * the world rather than maintaining one.
     *
     * Injected rather than imported for the same reason everything else here
     * is: this module is reached from petal_actions and playerState, and a
     * direct import of the registry would drag the ECS world into both.
     *
     * By IDENTITY, not by index. The old `removeEnemyAt(index)` required the
     * caller to hold a live index into a container that no longer exists, and
     * an index is only valid until the next removal — which is exactly the kind
     * of coupling a shrinking array forces on every loop that kills.
     */
    removeEnemy: (enemy: Enemy) => boolean;
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
export function awardKillXp(enemy: Enemy, ctx: KillContext): void {
    const recipients = getLootRecipients(enemy);
    if (recipients.length === 0) return;

    payFullXpToEach(
        // Only players still in the world can be paid.
        recipients.filter(id => ctx.players[id] !== undefined),
        getXPFromEnemy(enemy),
        playerId => ctx.playerUserIds[playerId],
        playerId => ctx.database.getLeaderboardRewardMultipliers(ctx.playerUserIds[playerId]).xpMultiplier,
        (playerId, xp) => ctx.addXPToPlayer(ctx.players[playerId], xp, playerId),
    );
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
export function killEnemy(
    enemy: Enemy,
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
    // XP goes to everyone who earned loot rights, and each of them gets the
    // mob's FULL value — it is not a share divided between them. Killing blow
    // no longer decides it: a last hit on something you barely damaged wins no
    // loot slot, so it wins no XP either.
    awardKillXp(enemy, ctx);

    if (creditedPlayer) {
        // Leaderboard reward tiers: top 10 accounts get 0.5x XP / 1.2x drop rate,
        // top 20 get 0.75x XP / 1.1x drop rate. Only the DROP half is keyed to
        // the credited player; XP is per-recipient, above.
        const { dropMultiplier } = ctx.database.getLeaderboardRewardMultipliers(ctx.playerUserIds[creditedPlayerId!]);
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
    ctx.removeEnemy(enemy);
    if (emitDestroyed) getWireOutbox().all('enemyDestroyed', enemy.id);

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
