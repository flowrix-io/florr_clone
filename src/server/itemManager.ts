import { Server as SocketIOServer } from '../ws_server';
import { Enemy } from '../server_utils';
import { WorldItem, Item } from '../item';
import { calculateMobDrops } from '../mobs';
import { items, ITEM_EXPIRATION_TIMES, itemExpirationTimeouts } from './gameState';
import { getEligiblePlayers, getOriginalSocketId } from './utils';

// Cache eligible petal types to avoid expensive filtering on every drop
let cachedEligiblePetalTypes: string[] | null = null;
function getEligiblePetalTypes(): string[] {
    if (cachedEligiblePetalTypes === null) {
        const allPetalTypes = getAllPetalTypes();
        cachedEligiblePetalTypes = allPetalTypes.filter(type => {
            const stats = getPetalStats(type, 'common');
            return stats && !stats.isAdminPetal && !isUndroppableEggPetalType(type) && type !== 'cutter' && type !== 'lightning_cutter';
        });
    }
    return cachedEligiblePetalTypes;
}
import { checkItemWallCollisions } from './physics';
import { getAllPetalTypes, getPetalStats, isUndroppableEggPetalType } from '../petals';
import {
    RARITY_ORDER,
    Rarity,
    getDropUpgradeChance,
    getDropDowngradeChance,
    upgradeRarity,
    downgradeRarity,
} from './shared/rarity';

// Function to handle mob drops when a mob dies
// Accepts enemy data object instead of live enemy to avoid issues with cleaned up enemies
export function handleMobDrops(enemyData: { type?: string, tier: string, x: number, y: number, damageContributors?: Map<string, number> }, io: SocketIOServer) {
    const mobType = enemyData.type || 'bee'; // Default to bee if type is not set
    const drops = calculateMobDrops(mobType, enemyData.tier);
    
    // Get list of eligible players based on damage ranking
    let eligiblePlayers = getEligiblePlayers(enemyData as Enemy);
    
    // For split players, also include both split player IDs and the original socket ID in eligible players
    // This ensures both split players can pick up items if either one dealt damage
    const expandedEligiblePlayers = new Set<string>(eligiblePlayers);
    // Use static import instead of dynamic require to avoid blocking
    const { splitPlayers } = require('../petal_actions');
    
    for (const playerId of eligiblePlayers) {
        const originalSocketId = getOriginalSocketId(playerId);
        
        // If this is a split player, add the original socket ID
        if (playerId !== originalSocketId) {
            expandedEligiblePlayers.add(originalSocketId);
        }
        
        // If this is the original socket ID, check if there's a split and add both split player IDs
        const splitState = splitPlayers.get(originalSocketId);
        if (splitState) {
            expandedEligiblePlayers.add(splitState.player1.id);
            expandedEligiblePlayers.add(splitState.player2.id);
        }
    }
    eligiblePlayers = Array.from(expandedEligiblePlayers);

    // Debug log to verify eligible players
    // if (eligiblePlayers.length > 0) {
    //     console.log(`[DROPS] Enemy ${enemy.id} (${enemy.type}, ${enemy.tier}) killed. Eligible players:`, eligiblePlayers);
    //     if (enemy.damageContributors) {
    //         console.log(`[DROPS] Damage contributors:`, Array.from(enemy.damageContributors.entries()));
    //     }
    // }
    
    // If no players dealt damage, don't drop anything
    if (eligiblePlayers.length === 0) {
        // console.log(`[DROPS] No eligible players for enemy ${enemy.id} - no drops`);
        return;
    }
    
    for (const drop of drops) {
        // Determine quantity — apex mobs drop 10x loot
        const quantity = enemyData.tier === 'apex' ? 10 : 1;
        
        // Create items for each quantity
        for (let q = 0; q < quantity; q++) {
            const offsetX = (Math.random() - 0.5) * 100;
            const offsetY = (Math.random() - 0.5) * 100;
            
            const itemId = Math.random().toString(36).substr(2, 9);
            const spawnTime = Date.now();
            
            // Apply drop upgrade or downgrade chance (mutually exclusive)
            // Try upgrade first, if it doesn't happen, try downgrade
            let finalRarity = drop.rarity;
            const baseUpgradeChance = getDropUpgradeChance(drop.rarity);
            const upgradeChance = enemyData.tier === 'ultra' ? baseUpgradeChance * 20 : baseUpgradeChance;
            const upgradeRoll = upgradeChance > 0 ? Math.random() * 100 : 1;

            if (upgradeRoll < upgradeChance) {
                // Upgrade succeeded
                finalRarity = upgradeRarity(drop.rarity);
            } else {
                // Upgrade didn't happen, try downgrade
                const downgradeChance = getDropDowngradeChance(drop.rarity);
                if (downgradeChance > 0 && Math.random() < downgradeChance) {
                    finalRarity = downgradeRarity(drop.rarity);
                }
            }

            // Prevent rare+ mobs from dropping below a minimum rarity
            // Rare mobs: min tier - 1, Epic+ mobs: min tier - 2
            const mobRarityIndex = RARITY_ORDER.indexOf(enemyData.tier as Rarity);
            if (mobRarityIndex >= 2) {
                const minRarityIndex = mobRarityIndex >= 3
                    ? mobRarityIndex - 2
                    : mobRarityIndex - 1;
                const finalRarityIndex = RARITY_ORDER.indexOf(finalRarity);
                if (finalRarityIndex < minRarityIndex) {
                    finalRarity = RARITY_ORDER[minRarityIndex];
                }
            }

            // Apex mobs never drop apex-rarity items
            if (enemyData.tier === 'apex' && finalRarity === 'apex') {
                finalRarity = 'unique';
            }
            
            // Handle random petal selection for garbage mob
            let petalType = drop.type === 'petal' ? drop.itemType : undefined;
            if (petalType === 'random') {
                const eligiblePetalTypes = getEligiblePetalTypes();
                if (eligiblePetalTypes.length > 0) {
                    petalType = eligiblePetalTypes[Math.floor(Math.random() * eligiblePetalTypes.length)];
                } else {
                    // Fallback to basic if no eligible petals (shouldn't happen)
                    petalType = 'basic';
                }
            }
            
            const newItem: WorldItem = {
                id: itemId,
                type: drop.type === 'consumable' ? drop.itemType as Item['type'] : 'petal',
                x: enemyData.x + offsetX,
                y: enemyData.y + offsetY,
                rarity: finalRarity,
                petalType: petalType,
                eligiblePlayers: eligiblePlayers,
                pickedUpBy: new Set(),
                spawnTime: spawnTime
            };
            
            // Check and fix wall collisions before adding item
            // Defer collision check to avoid blocking when many items spawn
            setImmediate(() => {
                checkItemWallCollisions(newItem);
            });
            
            items.push(newItem);
            
            // Mark item for batched emission at end of frame to prevent stuttering
            // Store eligible players for this item
            (newItem as any).pendingSpawnEmission = true;
            (newItem as any).eligibleSocketIds = eligiblePlayers.map(playerId => getOriginalSocketId(playerId));
            
            // Schedule automatic removal after expiration time
            const expirationTime = ITEM_EXPIRATION_TIMES[finalRarity] || 10000;
            const timeout = setTimeout(() => {
                itemExpirationTimeouts.delete(itemId);
                const itemIndex = items.findIndex(item => item.id === itemId);
                if (itemIndex !== -1) {
                    const expiredItem = items[itemIndex];
                    items.splice(itemIndex, 1);
                    
                    // Notify eligible players that item expired
                    // Map split player IDs to their original socket IDs for socket room targeting
                    if (expiredItem.eligiblePlayers) {
                        for (const playerId of expiredItem.eligiblePlayers) {
                            const originalSocketId = getOriginalSocketId(playerId);
                            io.to(originalSocketId).emit('itemRemoved', itemId);
                        }
                    }
                }
            }, expirationTime);
            itemExpirationTimeouts.set(itemId, timeout);
        }
    }
}

