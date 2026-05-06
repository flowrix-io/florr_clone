"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingEnemyDamageUpdates = void 0;
exports.markEnemyDamaged = markEnemyDamaged;
exports.trackDamage = trackDamage;
exports.calculateDPS = calculateDPS;
exports.getOriginalSocketId = getOriginalSocketId;
exports.getEligiblePlayers = getEligiblePlayers;
exports.sendBossMobDefeatedMessage = sendBossMobDefeatedMessage;
exports.trackMobKill = trackMobKill;
exports.cleanupEnemy = cleanupEnemy;
const server_utils_1 = require("../server_utils");
const constants_1 = require("../constants");
const petal_actions_1 = require("../petal_actions");
const squadManager_1 = require("./squadManager");
const botManager_1 = require("./botManager");
const apiKeyApi_1 = require("./apiKeyApi");
// Per-tick batch of enemies that took damage. Keyed by enemy.id with the
// post-damage health snapshot. Using a module-level Map (cleared on flush)
// avoids monkey-patching `pendingDamageUpdate` / `lastDamageHealth` onto
// every damaged enemy and the per-tick `delete` that follows — both of which
// V8 punishes by transitioning the enemy object to dictionary (slow) mode.
exports.pendingEnemyDamageUpdates = new Map();
function markEnemyDamaged(enemy) {
    exports.pendingEnemyDamageUpdates.set(enemy.id, enemy.health);
}
// Helper function to track damage dealt to an enemy
function trackDamage(enemy, playerId, damage) {
    if (!enemy.damageContributors) {
        enemy.damageContributors = new Map();
    }
    const currentDamage = enemy.damageContributors.get(playerId) || 0;
    enemy.damageContributors.set(playerId, currentDamage + damage);
    // Provoke neutral mobs when they take damage from a player
    if (enemy.aiType === 'neutral' && !enemy.targetPlayerId) {
        enemy.targetPlayerId = playerId;
    }
    // Centipede chain: damaging any segment provokes the head and the whole chain.
    // Only applies when the chain's head is neutral (above rare).
    if ((0, server_utils_1.isCentipedeHeadType)(enemy.type) || (0, server_utils_1.isCentipedeBodyType)(enemy.type)) {
        const headId = enemy.headId ?? ((0, server_utils_1.isCentipedeHeadType)(enemy.type) ? enemy.id : undefined);
        if (headId) {
            const head = constants_1.enemies.find(e => e.id === headId);
            if (head && head.aiType === 'neutral' && !head.targetPlayerId) {
                head.targetPlayerId = playerId;
            }
        }
    }
    // Track DPS for target dummies — exclude bot damage so the reading
    // reflects the real player's actual DPS.
    if (enemy.type === 'target_dummy' && !(0, botManager_1.isBot)(playerId)) {
        const now = Date.now();
        if (!enemy.dpsStartTime) {
            enemy.dpsStartTime = now;
        }
        if (!enemy.dpsHistoryTimes) {
            enemy.dpsHistoryTimes = [];
            enemy.dpsHistoryDamages = [];
        }
        const times = enemy.dpsHistoryTimes;
        const damages = enemy.dpsHistoryDamages;
        times.push(now);
        damages.push(damage);
        // Drop entries older than 60s by trimming the front in place — avoids
        // reallocating a fresh array on every damage tick.
        const cutoff = now - 60000;
        let drop = 0;
        while (drop < times.length && times[drop] <= cutoff)
            drop++;
        if (drop > 0) {
            times.splice(0, drop);
            damages.splice(0, drop);
        }
    }
}
// Calculate DPS for target dummies
function calculateDPS(enemy) {
    const times = enemy.dpsHistoryTimes;
    const damages = enemy.dpsHistoryDamages;
    if (enemy.type !== 'target_dummy' || !times || !damages || times.length === 0) {
        return 0;
    }
    const now = Date.now();
    const timeWindow = 10000; // 10 seconds window
    const cutoffTime = now - timeWindow;
    let recentDamage = 0;
    for (let i = times.length - 1; i >= 0; i--) {
        if (times[i] <= cutoffTime)
            break;
        recentDamage += damages[i];
    }
    return recentDamage / (timeWindow / 1000);
}
// Helper function to get the original socket ID from a split player ID
// Split players have IDs like "socketId_split2", but sockets are keyed by the original socket ID
function getOriginalSocketId(playerId) {
    // Check if this is a split player ID
    if (playerId.includes('_split')) {
        // Find the split state that contains this player
        for (const [originalId, state] of petal_actions_1.splitPlayers.entries()) {
            if (state.player1.id === playerId || state.player2.id === playerId) {
                return originalId;
            }
        }
        // Fallback: remove _split suffix
        return playerId.replace('_split2', '').replace('_split1', '');
    }
    // Not a split player, return as-is
    return playerId;
}
// Helper function to get eligible players for a drop based on damage ranking
// Squad members' damage is pooled (averaged) and they count as a single loot entry.
// Returns individual player socket IDs (squads are expanded back to members).
function getEligiblePlayers(enemy) {
    if (!enemy.damageContributors || enemy.damageContributors.size === 0) {
        return [];
    }
    // Pool squad damage: squad members' damage is averaged into a single squad entry
    const pooled = (0, squadManager_1.getPooledDamageContributors)(enemy.damageContributors);
    // Sort entities (players or squad IDs) by pooled damage (highest first)
    const sortedEntities = Array.from(pooled.entries())
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
    // Determine placement requirement based on mob rarity
    const isUltraOrAbove = ['ultra', 'super', 'unique'].includes(enemy.tier);
    const placementRequirement = isUltraOrAbove ? 15 : 4;
    // Get top N entities (a squad counts as 1 slot)
    const topEntities = sortedEntities.slice(0, placementRequirement);
    // Expand squad IDs back to individual player socket IDs
    return (0, squadManager_1.expandEligibleToPlayerIds)(topEntities);
}
// Helper function to send boss mob defeated message in chat
function sendBossMobDefeatedMessage(enemy, io, players) {
    // Check if this is a boss mob whose defeat is broadcast.
    // Ultras spawn silently and so they also die silently — only super/unique are announced.
    const isBroadcastBoss = ['super', 'unique'].includes(enemy.tier);
    if (!isBroadcastBoss) {
        return;
    }
    // Get the top damage dealer
    if (!enemy.damageContributors || enemy.damageContributors.size === 0) {
        return;
    }
    // Sort players by damage dealt (highest first)
    const sortedPlayers = Array.from(enemy.damageContributors.entries())
        .sort((a, b) => b[1] - a[1]);
    if (sortedPlayers.length === 0) {
        return;
    }
    // Get the top damage dealer's player ID
    const topDamagerId = sortedPlayers[0][0];
    const topDamager = players[topDamagerId];
    if (!topDamager) {
        return;
    }
    // Capitalize the first letter of the rarity
    const rarity = enemy.tier.charAt(0).toUpperCase() + enemy.tier.slice(1);
    // Get the original socket ID (in case this is a split player)
    const originalSocketId = getOriginalSocketId(topDamagerId);
    // Get the username from the socket
    const socket = io.sockets.sockets.get(originalSocketId);
    const username = socket?.username || 'Unknown';
    // Send chat message
    const content = `<b style="color: ${constants_1.ENEMY_TIERS[enemy.tier].color};">A ${rarity} ${enemy.type.replace('_', ' ')} has been defeated by <span style="color: #00ff00;">@${username}</span> [<span style="color: yellow;">${topDamager.name}</span>]</b>`;
    const timestamp = Date.now();
    io.emit('chatMessage', {
        sender: '',
        content,
        timestamp
    });
    (0, apiKeyApi_1.recordBossEvent)({
        type: 'defeat',
        tier: enemy.tier,
        mobType: enemy.type,
        x: enemy.x,
        y: enemy.y,
        timestamp,
        message: (0, apiKeyApi_1.stripHtml)(content),
        defeatedBy: { username, playerName: topDamager.name }
    });
}
// Helper function to track mob kills for eligible players
function trackMobKill(enemy, players, playerUserIds, database, io, savePlayerProgress) {
    // console.log('[Server] trackMobKill called', { 
    //     enemyType: enemy.type, 
    //     enemyTier: enemy.tier,
    //     hasIo: !!io,
    //     hasDamageContributors: !!enemy.damageContributors,
    //     damageContributorsSize: enemy.damageContributors?.size || 0
    // });
    const eligiblePlayers = getEligiblePlayers(enemy);
    // console.log('[Server] Eligible players for mob kill:', eligiblePlayers);
    if (eligiblePlayers.length === 0) {
        // console.log('[Server] No eligible players for mob kill');
        return;
    }
    for (const playerId of eligiblePlayers) {
        const player = players[playerId];
        if (!player)
            continue;
        // Initialize mobKills if it doesn't exist
        if (!player.mobKills) {
            player.mobKills = {};
        }
        // Initialize mob type entry if it doesn't exist
        if (!player.mobKills[enemy.type]) {
            player.mobKills[enemy.type] = {};
        }
        // Increment kill count for this mob type and rarity
        const currentCount = player.mobKills[enemy.type][enemy.tier] || 0;
        player.mobKills[enemy.type][enemy.tier] = currentCount + 1;
        // Award stars for mythic+ mob kills (challenge system)
        const mythicPlusTiers = ['mythic', 'ultra', 'super', 'unique'];
        if (mythicPlusTiers.includes(enemy.tier)) {
            // Initialize stars if it doesn't exist
            if (player.stars === undefined) {
                player.stars = 0;
            }
            // Award stars based on tier
            const starRewards = {
                mythic: 1,
                ultra: 5,
                super: 25,
                unique: 100
            };
            const starsAwarded = starRewards[enemy.tier] || 0;
            player.stars += starsAwarded;
            // Notify player of stars earned
            if (io && starsAwarded > 0) {
                // Map split player ID to original socket ID for socket room targeting
                const originalSocketId = getOriginalSocketId(playerId);
                io.to(originalSocketId).emit('starsEarned', {
                    amount: starsAwarded,
                    total: player.stars,
                    mobName: enemy.type,
                    tier: enemy.tier
                });
            }
        }
        // Use debounced save if provided, otherwise fall back to direct save (for backwards compatibility)
        // Use original socket ID to look up user ID (playerUserIds is keyed by socket ID)
        const originalSocketId = getOriginalSocketId(playerId);
        const userId = playerUserIds[originalSocketId];
        if (userId) {
            if (savePlayerProgress) {
                // Use debounced save to prevent lag
                savePlayerProgress(player, userId);
            }
            else if (database) {
                // Fallback: direct save (should be avoided in production)
                database.savePlayer(userId, {
                    mobKills: player.mobKills
                });
            }
        }
        // Emit playerUpdated only to the eligible player (not all clients)
        if (io) {
            const originalSocketId = getOriginalSocketId(playerId);
            const playerUpdate = {
                ...player,
                mobKills: player.mobKills
            };
            io.to(originalSocketId).emit('playerUpdated', playerUpdate);
        }
    }
}
// Helper function to drop references the enemy holds before it leaves the
// `enemies` array. The point is to release the auxiliary heap (the Maps,
// arrays, and pooled damage tracker) — NOT to alter the enemy's V8 shape.
// We assign `undefined` instead of `delete`-ing so the enemy stays in fast
// hidden-class mode if anything (squad damage copies, centipede chain refs,
// pending kill credits) happens to keep the corpse alive a bit longer.
function cleanupEnemy(enemy) {
    if (enemy.damageContributors) {
        enemy.damageContributors.clear();
        enemy.damageContributors = undefined;
    }
    if (enemy.poisonEffects) {
        enemy.poisonEffects.length = 0;
        enemy.poisonEffects = undefined;
    }
    if (enemy.dpsHistoryTimes) {
        enemy.dpsHistoryTimes.length = 0;
        enemy.dpsHistoryTimes = undefined;
    }
    if (enemy.dpsHistoryDamages) {
        enemy.dpsHistoryDamages.length = 0;
        enemy.dpsHistoryDamages = undefined;
    }
    enemy.dpsStartTime = undefined;
    enemy.currentDPS = undefined;
    enemy.wanderTargetX = undefined;
    enemy.wanderTargetY = undefined;
    enemy.lastWanderTime = undefined;
    enemy.lastViewportCheck = undefined;
    enemy.lastProjectileTime = undefined;
    enemy.lastMeleeAttackTime = undefined;
}
// Collision detection functions have been moved to physics.ts
