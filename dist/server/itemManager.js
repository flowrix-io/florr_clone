"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMobDrops = handleMobDrops;
const mobs_1 = require("../mobs");
const gameState_1 = require("./gameState");
const itemRegistry_1 = require("./itemRegistry");
const utils_1 = require("./utils");
// Shared with the item spawner and the spawner's rendered petal ring — see
// getDroppablePetalTypes() in petals.ts. It caches, so this stays cheap per drop.
function getEligiblePetalTypes() {
    return (0, petals_1.getDroppablePetalTypes)();
}
const petals_1 = require("../petals");
const rarity_1 = require("./shared/rarity");
// Function to handle mob drops when a mob dies
// Accepts enemy data object instead of live enemy to avoid issues with cleaned up enemies
function handleMobDrops(enemyData, io, dropRateMultiplier = 1) {
    const mobType = enemyData.type || 'bee'; // Default to bee if type is not set
    let drops = (0, mobs_1.calculateMobDrops)(mobType, enemyData.tier);
    // Leaderboard drop-rate bonus (e.g. 1.2x = 20% chance of an extra full drop roll).
    const bonusDropChance = dropRateMultiplier - 1;
    if (bonusDropChance > 0 && Math.random() < bonusDropChance) {
        drops = drops.concat((0, mobs_1.calculateMobDrops)(mobType, enemyData.tier));
    }
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
            const baseUpgradeChance = (0, rarity_1.getDropUpgradeChance)(drop.rarity);
            const upgradeChance = enemyData.tier === 'ultra' ? baseUpgradeChance * 20 : baseUpgradeChance;
            const upgradeRoll = upgradeChance > 0 ? Math.random() * 100 : 1;
            if (upgradeRoll < upgradeChance) {
                // Upgrade succeeded
                finalRarity = (0, rarity_1.upgradeRarity)(drop.rarity);
            }
            else {
                // Upgrade didn't happen, try downgrade
                const downgradeChance = (0, rarity_1.getDropDowngradeChance)(drop.rarity);
                if (downgradeChance > 0 && Math.random() < downgradeChance) {
                    finalRarity = (0, rarity_1.downgradeRarity)(drop.rarity);
                }
            }
            // Prevent rare+ mobs from dropping below a minimum rarity
            // Rare mobs: min tier - 1, Epic+ mobs: min tier - 2
            const mobRarityIndex = rarity_1.RARITY_ORDER.indexOf(enemyData.tier);
            if (mobRarityIndex >= 2) {
                const minRarityIndex = mobRarityIndex >= 3
                    ? mobRarityIndex - 2
                    : mobRarityIndex - 1;
                const finalRarityIndex = rarity_1.RARITY_ORDER.indexOf(finalRarity);
                if (finalRarityIndex < minRarityIndex) {
                    finalRarity = rarity_1.RARITY_ORDER[minRarityIndex];
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
            // Admit the drop as an entity. No wall fix here: the droppedItems
            // system resolves walls every tick (the old code deferred the fix
            // to a setImmediate anyway, so the spawn emit has never carried
            // resolved coordinates). The Expires deadline replaces the old
            // per-item setTimeout outright.
            const expirationTime = gameState_1.ITEM_EXPIRATION_TIMES[finalRarity] || 10000;
            (0, itemRegistry_1.spawnWorldItem)(newItem, spawnTime + expirationTime);
            // Queue for batched emission at end of frame to prevent stuttering.
            (0, itemRegistry_1.queueItemSpawnEmission)(newItem, eligiblePlayers.map(playerId => (0, utils_1.getOriginalSocketId)(playerId)));
        }
    }
}
