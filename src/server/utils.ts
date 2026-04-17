import { Enemy, isCentipedeHeadType, isCentipedeBodyType } from '../server_utils';
import { ServerPlayer } from '../player';
import { ENEMY_TIERS, enemies } from '../constants';
import { splitPlayers } from '../petal_actions';
import { getPooledDamageContributors, expandEligibleToPlayerIds } from './squadManager';

// Helper function to track damage dealt to an enemy
export function trackDamage(enemy: Enemy, playerId: string, damage: number) {
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
    if (isCentipedeHeadType(enemy.type) || isCentipedeBodyType(enemy.type)) {
        const headId = enemy.headId ?? (isCentipedeHeadType(enemy.type) ? enemy.id : undefined);
        if (headId) {
            const head = enemies.find(e => e.id === headId);
            if (head && head.aiType === 'neutral' && !head.targetPlayerId) {
                head.targetPlayerId = playerId;
            }
        }
    }

    // Track DPS for target dummies
    if (enemy.type === 'target_dummy') {
        const now = Date.now();
        if (!enemy.dpsStartTime) {
            enemy.dpsStartTime = now;
            enemy.dpsHistory = [];
        }
        if (!enemy.dpsHistory) {
            enemy.dpsHistory = [];
        }
        enemy.dpsHistory.push({ time: now, damage: damage });
        
        // Keep only last 60 seconds of history
        const cutoffTime = now - 60000;
        enemy.dpsHistory = enemy.dpsHistory.filter(entry => entry.time > cutoffTime);
    }
}

// Calculate DPS for target dummies
export function calculateDPS(enemy: Enemy): number {
    if (enemy.type !== 'target_dummy' || !enemy.dpsHistory || enemy.dpsHistory.length === 0) {
        return 0;
    }
    
    const now = Date.now();
    const timeWindow = 10000; // 10 seconds window
    const cutoffTime = now - timeWindow;
    
    // Sum damage in the last 10 seconds
    const recentDamage = enemy.dpsHistory
        .filter(entry => entry.time > cutoffTime)
        .reduce((sum, entry) => sum + entry.damage, 0);
    
    // Calculate DPS (damage per second)
    const dps = recentDamage / (timeWindow / 1000);
    
    return dps;
}

// Helper function to get the original socket ID from a split player ID
// Split players have IDs like "socketId_split2", but sockets are keyed by the original socket ID
export function getOriginalSocketId(playerId: string): string {
    // Check if this is a split player ID
    if (playerId.includes('_split')) {
        // Find the split state that contains this player
        for (const [originalId, state] of splitPlayers.entries()) {
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
export function getEligiblePlayers(enemy: Enemy): string[] {
    if (!enemy.damageContributors || enemy.damageContributors.size === 0) {
        return [];
    }

    // Pool squad damage: squad members' damage is averaged into a single squad entry
    const pooled = getPooledDamageContributors(enemy.damageContributors);

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
    return expandEligibleToPlayerIds(topEntities);
}

// Helper function to send boss mob defeated message in chat
export function sendBossMobDefeatedMessage(
    enemy: Enemy, 
    io: any, 
    players: Record<string, ServerPlayer>
) {
    // Check if this is a boss mob (ultra, super, or unique tier)
    const isBossMob = ['ultra', 'super', 'unique'].includes(enemy.tier);
    if (!isBossMob) {
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
    const socket = io.sockets.sockets.get(originalSocketId) as any;
    const username = socket?.username || 'Unknown';
    
    // Send chat message
    io.emit('chatMessage', {
        sender: '',
        content: `<b style="color: ${ENEMY_TIERS[enemy.tier as keyof typeof ENEMY_TIERS].color};">A ${rarity} ${enemy.type.replace('_', ' ')} has been defeated by <span style="color: #00ff00;">@${username}</span> [<span style="color: yellow;">${topDamager.name}</span>]</b>`,
        timestamp: Date.now()
    });
}

// Helper function to track mob kills for eligible players
export function trackMobKill(
    enemy: Enemy, 
    players: Record<string, ServerPlayer>, 
    playerUserIds: Record<string, string>, 
    database: any, 
    io?: any,
    savePlayerProgress?: (player: ServerPlayer, userId: string) => void
): void {
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
        if (!player) continue;
        
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
            const starRewards: { [key: string]: number } = {
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
            } else if (database) {
                // Fallback: direct save (should be avoided in production)
                database.savePlayer(userId, {
                    mobKills: player.mobKills
                } as any);
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

// Helper function to clean up enemy data structures before removal
// This helps prevent memory leaks by clearing Maps and arrays
export function cleanupEnemy(enemy: Enemy): void {
    // Clear damage contributors Map
    if (enemy.damageContributors) {
        enemy.damageContributors.clear();
        delete enemy.damageContributors;
    }
    
    // Clear poison effects array
    if (enemy.poisonEffects) {
        enemy.poisonEffects.length = 0;
        delete enemy.poisonEffects;
    }
    
    // Clear DPS history for target dummies
    if (enemy.dpsHistory) {
        enemy.dpsHistory.length = 0;
        delete enemy.dpsHistory;
    }
    
    // Clear other optional properties
    delete enemy.dpsStartTime;
    delete enemy.currentDPS;
    delete enemy.wanderTarget;
    delete enemy.lastWanderTime;
    delete enemy.lastViewportCheck;
    delete enemy.lastProjectileTime;
    delete enemy.lastMeleeAttackTime;
}

// Collision detection functions have been moved to physics.ts

