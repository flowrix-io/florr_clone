import { Server as SocketIOServer } from 'socket.io';
import { Enemy } from '../server_utils';
import { WorldItem, Item } from '../item';
import { calculateMobDrops, DropItem } from '../mobs';
import { items, ITEM_EXPIRATION_TIMES } from './gameState';
import { getEligiblePlayers } from './utils';

// Function to handle mob drops when a mob dies
export function handleMobDrops(enemy: Enemy, io: SocketIOServer) {
    const mobType = enemy.type || 'bee'; // Default to bee if type is not set
    const drops = calculateMobDrops(mobType, enemy.tier);
    
    // Get list of eligible players based on damage ranking
    const eligiblePlayers = getEligiblePlayers(enemy);
    
    // If no players dealt damage, don't drop anything
    if (eligiblePlayers.length === 0) {
        console.log(`[DROP] Mob ${enemy.type} (${enemy.tier}) died with no damage contributors - no drops`);
        return;
    }
    
    console.log(`[DROP] Mob ${enemy.type} (${enemy.tier}) drops for ${eligiblePlayers.length} eligible players`);
    
    for (const drop of drops) {
        // Determine quantity
        const quantity = 1; // Simplified to always drop 1 item
        
        // Create items for each quantity
        for (let q = 0; q < quantity; q++) {
            const offsetX = (Math.random() - 0.5) * 100;
            const offsetY = (Math.random() - 0.5) * 100;
            
            const itemId = Math.random().toString(36).substr(2, 9);
            const spawnTime = Date.now();
            
            const newItem: WorldItem = {
                id: itemId,
                type: drop.type === 'consumable' ? drop.itemType as Item['type'] : 'petal',
                x: enemy.x + offsetX,
                y: enemy.y + offsetY,
                rarity: drop.rarity,
                petalType: drop.type === 'petal' ? drop.itemType : undefined,
                eligiblePlayers: eligiblePlayers,
                pickedUpBy: new Set(),
                spawnTime: spawnTime
            };
            
            items.push(newItem);
            
            // Only send itemSpawned event to eligible players
            for (const playerId of eligiblePlayers) {
                io.to(playerId).emit('itemSpawned', newItem);
            }
            
            // Schedule automatic removal after expiration time
            const expirationTime = ITEM_EXPIRATION_TIMES[drop.rarity] || 10000;
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
                    
                    console.log(`[DROP] Item ${itemId} (${drop.rarity}) expired after ${expirationTime}ms`);
                }
            }, expirationTime);
        }
    }
}

