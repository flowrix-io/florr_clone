"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMobDrops = handleMobDrops;
const mobs_1 = require("../mobs");
const gameState_1 = require("./gameState");
const utils_1 = require("./utils");
const physics_1 = require("./physics");
const petals_1 = require("../petals");
// Rarity order from lowest to highest
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
// Calculate crafting chance for upgrading from one rarity to the next
function getCraftingChance(rarityIndex) {
    const baseChance = 64;
    return baseChance / Math.pow(2, rarityIndex);
}
// Calculate upgrade chance for a drop (crafting chance of upgraded rarity / 3)
// The crafting chance for upgrading TO a rarity is calculated FROM the previous rarity
function getDropUpgradeChance(currentRarity) {
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
function upgradeRarity(rarity) {
    const currentIndex = RARITY_ORDER.indexOf(rarity);
    if (currentIndex >= 0 && currentIndex < RARITY_ORDER.length - 1) {
        return RARITY_ORDER[currentIndex + 1];
    }
    return rarity; // Already at max tier
}
// Calculate downgrade chance for a drop (1 / (1 + craft chance to that rarity))
// The crafting chance for upgrading TO a rarity is calculated FROM the previous rarity
function getDropDowngradeChance(currentRarity) {
    const currentIndex = RARITY_ORDER.indexOf(currentRarity);
    if (currentIndex === -1 || currentIndex === 0) {
        return 0; // Invalid rarity or already at lowest tier (common)
    }
    // Crafting chance for upgrading TO the current tier is calculated FROM the previous tier
    // (craft chance from currentIndex-1 to currentIndex)
    const craftingChanceToCurrentRarity = getCraftingChance(currentIndex - 1);
    // Downgrade chance is 1 / (1 + craft chance to that rarity)
    return 1 / (1 + craftingChanceToCurrentRarity);
}
// Downgrade a rarity by one tier if possible
function downgradeRarity(rarity) {
    const currentIndex = RARITY_ORDER.indexOf(rarity);
    if (currentIndex > 0 && currentIndex < RARITY_ORDER.length) {
        return RARITY_ORDER[currentIndex - 1];
    }
    return rarity; // Already at lowest tier
}
// Function to handle mob drops when a mob dies
function handleMobDrops(enemy, io) {
    const mobType = enemy.type || 'bee'; // Default to bee if type is not set
    const drops = (0, mobs_1.calculateMobDrops)(mobType, enemy.tier);
    // Get list of eligible players based on damage ranking
    let eligiblePlayers = (0, utils_1.getEligiblePlayers)(enemy);
    // For split players, also include the original socket ID in eligible players
    // This ensures both split players can pick up items if either one dealt damage
    const expandedEligiblePlayers = new Set(eligiblePlayers);
    for (const playerId of eligiblePlayers) {
        const originalSocketId = (0, utils_1.getOriginalSocketId)(playerId);
        if (playerId !== originalSocketId) {
            // This is a split player, add the original socket ID too
            expandedEligiblePlayers.add(originalSocketId);
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
        // Determine quantity
        const quantity = 1; // Simplified to always drop 1 item
        // Create items for each quantity
        for (let q = 0; q < quantity; q++) {
            const offsetX = (Math.random() - 0.5) * 100;
            const offsetY = (Math.random() - 0.5) * 100;
            const itemId = Math.random().toString(36).substr(2, 9);
            const spawnTime = Date.now();
            // Apply drop upgrade or downgrade chance (mutually exclusive)
            // Try upgrade first, if it doesn't happen, try downgrade
            let finalRarity = drop.rarity;
            const upgradeChance = getDropUpgradeChance(drop.rarity);
            const upgradeRoll = upgradeChance > 0 ? Math.random() * 100 : 1;
            if (upgradeRoll < upgradeChance) {
                // Upgrade succeeded
                finalRarity = upgradeRarity(drop.rarity);
            }
            else {
                // Upgrade didn't happen, try downgrade
                const downgradeChance = getDropDowngradeChance(drop.rarity);
                if (downgradeChance > 0 && Math.random() < downgradeChance) {
                    finalRarity = downgradeRarity(drop.rarity);
                }
            }
            // Handle random petal selection for garbage mob
            let petalType = drop.type === 'petal' ? drop.itemType : undefined;
            if (petalType === 'random') {
                const allPetalTypes = (0, petals_1.getAllPetalTypes)();
                // Filter out admin petals and cutter types
                const eligiblePetalTypes = allPetalTypes.filter(type => {
                    const stats = (0, petals_1.getPetalStats)(type, 'common');
                    return stats && !stats.isAdminPetal && type !== 'cutter' && type !== 'lightning_cutter';
                });
                if (eligiblePetalTypes.length > 0) {
                    petalType = eligiblePetalTypes[Math.floor(Math.random() * eligiblePetalTypes.length)];
                }
                else {
                    // Fallback to basic if no eligible petals (shouldn't happen)
                    petalType = 'basic';
                }
            }
            const newItem = {
                id: itemId,
                type: drop.type === 'consumable' ? drop.itemType : 'petal',
                x: enemy.x + offsetX,
                y: enemy.y + offsetY,
                rarity: finalRarity,
                petalType: petalType,
                eligiblePlayers: eligiblePlayers,
                pickedUpBy: new Set(),
                spawnTime: spawnTime
            };
            // Check and fix wall collisions before adding item
            (0, physics_1.checkItemWallCollisions)(newItem);
            gameState_1.items.push(newItem);
            // Only send itemSpawned event to eligible players
            // Map split player IDs to their original socket IDs for socket room targeting
            for (const playerId of eligiblePlayers) {
                const originalSocketId = (0, utils_1.getOriginalSocketId)(playerId);
                io.to(originalSocketId).emit('itemSpawned', newItem);
            }
            // Schedule automatic removal after expiration time
            const expirationTime = gameState_1.ITEM_EXPIRATION_TIMES[finalRarity] || 10000;
            const timeout = setTimeout(() => {
                gameState_1.itemExpirationTimeouts.delete(itemId);
                const itemIndex = gameState_1.items.findIndex(item => item.id === itemId);
                if (itemIndex !== -1) {
                    const expiredItem = gameState_1.items[itemIndex];
                    gameState_1.items.splice(itemIndex, 1);
                    // Notify eligible players that item expired
                    // Map split player IDs to their original socket IDs for socket room targeting
                    if (expiredItem.eligiblePlayers) {
                        for (const playerId of expiredItem.eligiblePlayers) {
                            const originalSocketId = (0, utils_1.getOriginalSocketId)(playerId);
                            io.to(originalSocketId).emit('itemRemoved', itemId);
                        }
                    }
                }
            }, expirationTime);
            gameState_1.itemExpirationTimeouts.set(itemId, timeout);
        }
    }
}
