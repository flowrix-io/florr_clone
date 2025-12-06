import { Server as SocketIOServer } from 'socket.io';
import { Enemy } from '../server_utils';
import { WorldItem, Item } from '../item';
import { calculateMobDrops, DropItem } from '../mobs';
import { items, ITEM_EXPIRATION_TIMES } from './gameState';
import { getEligiblePlayers, checkItemWallCollisions } from './utils';
import { getAllPetalTypes, getPetalStats } from '../petals';

// Rarity type
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique';

// Rarity order from lowest to highest
const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];

// Calculate crafting chance for upgrading from one rarity to the next
function getCraftingChance(rarityIndex: number): number {
    const baseChance = 64;
    return baseChance / Math.pow(2, rarityIndex);
}

// Calculate upgrade chance for a drop (crafting chance of upgraded rarity / 3)
// The crafting chance for upgrading TO a rarity is calculated FROM the previous rarity
function getDropUpgradeChance(currentRarity: Rarity): number {
    const currentIndex = RARITY_ORDER.indexOf(currentRarity);
    if (currentIndex === -1 || currentIndex >= RARITY_ORDER.length - 1) {
        return 0; // Invalid rarity or already at max tier
    }
    
    // Crafting chance for upgrading TO the next tier is calculated FROM the current tier
    // (same as crafting from currentRarity to nextRarity)
    const craftingChance = getCraftingChance(currentIndex);
    
    // Upgrade chance is crafting chance divided by 3
    return craftingChance / 3;
}

// Upgrade a rarity by one tier if possible
function upgradeRarity(rarity: Rarity): Rarity {
    const currentIndex = RARITY_ORDER.indexOf(rarity);
    if (currentIndex >= 0 && currentIndex < RARITY_ORDER.length - 1) {
        return RARITY_ORDER[currentIndex + 1];
    }
    return rarity; // Already at max tier
}

// Function to handle mob drops when a mob dies
export function handleMobDrops(enemy: Enemy, io: SocketIOServer) {
    const mobType = enemy.type || 'bee'; // Default to bee if type is not set
    const drops = calculateMobDrops(mobType, enemy.tier);
    
    // Get list of eligible players based on damage ranking
    const eligiblePlayers = getEligiblePlayers(enemy);
    
    // If no players dealt damage, don't drop anything
    if (eligiblePlayers.length === 0) {
        return;
    }
    
    for (const drop of drops) {
        // Determine quantity
        const quantity = 1; // Simplified to always drop 1 item
        
        // Create items for each quantity
        for (let q = 0; q < quantity; q++) {
            const offsetX = (Math.random() - 0.5) * 100;
            const offsetY = (Math.random() - 0.5) * 100;
            
            const itemId = Math.random().toString(36).substr(2, 9);
            const spawnTime = Date.now();
            
            // Apply drop upgrade chance: upgrade to next tier based on crafting chance / 3
            let finalRarity = drop.rarity;
            const upgradeChance = getDropUpgradeChance(drop.rarity);
            if (upgradeChance > 0 && Math.random() * 100 < upgradeChance) {
                finalRarity = upgradeRarity(drop.rarity);
            }
            
            // Handle random petal selection for garbage mob
            let petalType = drop.type === 'petal' ? drop.itemType : undefined;
            if (petalType === 'random') {
                const allPetalTypes = getAllPetalTypes();
                // Filter out admin petals and cutter types
                const eligiblePetalTypes = allPetalTypes.filter(type => {
                    const stats = getPetalStats(type, 'common');
                    return stats && !stats.isAdminPetal && type !== 'cutter' && type !== 'lightning_cutter';
                });
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
                x: enemy.x + offsetX,
                y: enemy.y + offsetY,
                rarity: finalRarity,
                petalType: petalType,
                eligiblePlayers: eligiblePlayers,
                pickedUpBy: new Set(),
                spawnTime: spawnTime
            };
            
            // Check and fix wall collisions before adding item
            checkItemWallCollisions(newItem);
            
            items.push(newItem);
            
            // Only send itemSpawned event to eligible players
            for (const playerId of eligiblePlayers) {
                io.to(playerId).emit('itemSpawned', newItem);
            }
            
            // Schedule automatic removal after expiration time
            const expirationTime = ITEM_EXPIRATION_TIMES[finalRarity] || 10000;
            setTimeout(() => {
                const itemIndex = items.findIndex(item => item.id === itemId);
                if (itemIndex !== -1) {
                    const expiredItem = items[itemIndex];
                    items.splice(itemIndex, 1);
                    
                    // Notify eligible players that item expired
                    if (expiredItem.eligiblePlayers) {
                        for (const playerId of expiredItem.eligiblePlayers) {
                            io.to(playerId).emit('itemRemoved', itemId);
                        }
                    }
                }
            }, expirationTime);
        }
    }
}

