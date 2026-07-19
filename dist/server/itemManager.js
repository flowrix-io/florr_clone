"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMobDrops = handleMobDrops;
const mobs_1 = require("../mobs");
const gameState_1 = require("./gameState");
const utils_1 = require("./utils");
// Cache eligible petal types to avoid expensive filtering on every drop
let cachedEligiblePetalTypes = null;
function getEligiblePetalTypes() {
    if (cachedEligiblePetalTypes === null) {
        const allPetalTypes = (0, petals_1.getAllPetalTypes)();
        cachedEligiblePetalTypes = allPetalTypes.filter(type => {
            const stats = (0, petals_1.getPetalStats)(type, 'common');
            return stats && !stats.isAdminPetal && !(0, petals_1.isUndroppableEggPetalType)(type) && type !== 'cutter' && type !== 'lightning_cutter';
        });
    }
    return cachedEligiblePetalTypes;
}
const physics_1 = require("./physics");
const petals_1 = require("../petals");
// Rarity order from lowest to highest
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
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
// Accepts enemy data object instead of live enemy to avoid issues with cleaned up enemies
function handleMobDrops(enemyData, io) {
    const mobType = enemyData.type || 'bee'; // Default to bee if type is not set
    const drops = (0, mobs_1.calculateMobDrops)(mobType, enemyData.tier);
    // Get list of eligible players based on damage ranking
    let eligiblePlayers = (0, utils_1.getEligiblePlayers)(enemyData);
    // For split players, also include both split player IDs and the original socket ID in eligible players
    // This ensures both split players can pick up items if either one dealt damage
    const expandedEligiblePlayers = new Set(eligiblePlayers);
    // Use static import instead of dynamic require to avoid blocking
    const { splitPlayers } = require('../petal_actions');
    for (const playerId of eligiblePlayers) {
        const originalSocketId = (0, utils_1.getOriginalSocketId)(playerId);
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
            }
            else {
                // Upgrade didn't happen, try downgrade
                const downgradeChance = getDropDowngradeChance(drop.rarity);
                if (downgradeChance > 0 && Math.random() < downgradeChance) {
                    finalRarity = downgradeRarity(drop.rarity);
                }
            }
            // Prevent rare+ mobs from dropping below a minimum rarity
            // Rare mobs: min tier - 1, Epic+ mobs: min tier - 2
            const mobRarityIndex = RARITY_ORDER.indexOf(enemyData.tier);
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
                }
                else {
                    // Fallback to basic if no eligible petals (shouldn't happen)
                    petalType = 'basic';
                }
            }
            const newItem = {
                id: itemId,
                type: drop.type === 'consumable' ? drop.itemType : 'petal',
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
                (0, physics_1.checkItemWallCollisions)(newItem);
            });
            gameState_1.items.push(newItem);
            // Mark item for batched emission at end of frame to prevent stuttering
            // Store eligible players for this item
            newItem.pendingSpawnEmission = true;
            newItem.eligibleSocketIds = eligiblePlayers.map(playerId => (0, utils_1.getOriginalSocketId)(playerId));
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
