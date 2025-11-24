"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RARITY_TP_COSTS = void 0;
exports.createInitialBasicPetals = createInitialBasicPetals;
exports.createInitialInventory = createInitialInventory;
exports.addItem = addItem;
exports.removeItem = removeItem;
exports.hasItem = hasItem;
exports.respawnPlayer = respawnPlayer;
exports.isBiomeSafeForSpawn = isBiomeSafeForSpawn;
exports.getSpawnPositionInBiome = getSpawnPositionInBiome;
exports.calculateXPRequirement = calculateXPRequirement;
exports.calculateTotalXP = calculateTotalXP;
exports.calculateLevelFromTotalXP = calculateLevelFromTotalXP;
exports.calculateCurrentLevelXP = calculateCurrentLevelXP;
exports.calculateMaxHealthFromLevel = calculateMaxHealthFromLevel;
exports.calculateDamageFromLevel = calculateDamageFromLevel;
exports.getSkillMultiplier = getSkillMultiplier;
exports.applyPetalHealthBonus = applyPetalHealthBonus;
exports.addXPToPlayer = addXPToPlayer;
exports.savePlayerProgress = savePlayerProgress;
const petals_1 = require("../petals");
const constants_1 = require("../constants");
const RARITY_TP_COSTS = {
    common: 0,
    uncommon: 1,
    rare: 2,
    epic: 3,
    legendary: 4,
    mythic: 5,
    ultra: 6,
    super: 7,
    unique: 8
};
exports.RARITY_TP_COSTS = RARITY_TP_COSTS;
// Helper function to create initial basic petals for new players
function createInitialBasicPetals() {
    const basicPetalStats = (0, petals_1.getPetalStats)('basic', 'common');
    if (!basicPetalStats) {
        console.error('Failed to get basic petal stats');
        return [];
    }
    return Array(5).fill(null).map(() => ({
        type: 'petal',
        rarity: 'common',
        petalType: 'basic',
        health: basicPetalStats.health,
        maxHealth: basicPetalStats.health,
        onCooldown: false
    }));
}
// Helper function to create initial inventory with basic petals
function createInitialInventory() {
    return {
        common: {
            'petal_basic': 5
        }
    };
}
function addItem(inventory, rarity, type, count) {
    if (!inventory[rarity]) {
        inventory[rarity] = {};
    }
    if (!inventory[rarity][type]) {
        inventory[rarity][type] = 0;
    }
    inventory[rarity][type] += count;
}
function removeItem(inventory, rarity, type, count) {
    if (inventory[rarity] && inventory[rarity][type] && inventory[rarity][type] >= count) {
        inventory[rarity][type] -= count;
        if (inventory[rarity][type] === 0) {
            delete inventory[rarity][type];
            if (Object.keys(inventory[rarity]).length === 0) {
                delete inventory[rarity];
            }
        }
        return true;
    }
    return false;
}
function hasItem(inventory, rarity, type, count) {
    return inventory[rarity]?.[type] >= count;
}
function respawnPlayer(player, io) {
    // Find valid spawn points for player's level
    const validSpawnPoints = constants_1.WORLD_MAP.filter(element => element.type === 'spawn' &&
        element.properties?.spawnType === getSpawnTypeForLevel(player.level));
    if (validSpawnPoints.length > 0) {
        // Choose random spawn point
        const spawn = validSpawnPoints[Math.floor(Math.random() * validSpawnPoints.length)];
        player.x = (spawn.x + Math.random() * spawn.width) * constants_1.SCALE_FACTOR;
        player.y = (spawn.y + Math.random() * spawn.height) * constants_1.SCALE_FACTOR;
    }
    else {
        // Fallback to old spawn logic if no valid spawn points
        console.warn('No valid spawn points found for level', player.level);
        player.x = Math.random() * constants_1.ACTUAL_WORLD_WIDTH;
        player.y = Math.random() * constants_1.ACTUAL_WORLD_HEIGHT;
    }
    // Rest of respawnPlayer remains the same
    player.health = player.maxHealth;
    player.score = Math.max(0, player.score - 10);
    player.isInvulnerable = true;
    player.lastDamageTime = 0;
    player.isDead = false;
    setTimeout(() => {
        player.isInvulnerable = false;
        // Notify client that invulnerability has ended
        io.emit('playerInvulnerabilityEnded', { playerId: player.id });
    }, constants_1.RESPAWN_INVULNERABILITY_TIME);
}
// Helper function to determine spawn type based on level
function getSpawnTypeForLevel(level) {
    if (level <= 5)
        return 'common';
    if (level <= 10)
        return 'uncommon';
    if (level <= 15)
        return 'rare';
    if (level <= 25)
        return 'epic';
    if (level <= 40)
        return 'legendary';
    return 'mythic';
}
// Helper function to check if a biome only allows mob rarities less than "rare" (common or uncommon)
function isBiomeSafeForSpawn(biome) {
    // If biome has no spawn table, it uses default spawn logic which can include rare+ tiers
    // So we only allow spawning in biomes with explicit spawn tables
    if (!biome.properties?.spawnTable || biome.properties.spawnTable.length === 0) {
        return false;
    }
    // Check that all tiers in the spawn table are common or uncommon
    const safeTiers = ['common', 'uncommon'];
    for (const entry of biome.properties.spawnTable) {
        if (!safeTiers.includes(entry.tier)) {
            return false; // Found a tier that is rare or higher
        }
    }
    return true; // All tiers are safe (common or uncommon)
}
// Helper function to find a spawn position within a specific biome
function getSpawnPositionInBiome(biomeName) {
    // Find all biome elements with the specified name
    const biomes = constants_1.WORLD_MAP.filter(element => element.type === 'biome' &&
        element.properties?.biomeName === biomeName &&
        element.width > 0 &&
        element.height > 0);
    if (biomes.length === 0) {
        console.warn(`No valid biomes found with name: ${biomeName}`);
        return null;
    }
    // Filter to only biomes that are safe for spawning (only common/uncommon mobs)
    const safeBiomes = biomes.filter(biome => isBiomeSafeForSpawn(biome));
    if (safeBiomes.length === 0) {
        console.warn(`No safe spawn areas found in ${biomeName} biome (all areas have rare+ mobs)`);
        return null;
    }
    // Choose a random biome from the safe ones
    const biome = safeBiomes[Math.floor(Math.random() * safeBiomes.length)];
    // Generate a random position within the biome, with some padding from edges
    const padding = 50; // Padding from biome edges
    const x = biome.x + padding + Math.random() * Math.max(0, biome.width - padding * 2);
    const y = biome.y + padding + Math.random() * Math.max(0, biome.height - padding * 2);
    console.log(`Spawning in ${biomeName} biome at (${x.toFixed(0)}, ${y.toFixed(0)})`);
    return { x: x * constants_1.SCALE_FACTOR, y: y * constants_1.SCALE_FACTOR };
}
// XP calculation functions
function calculateXPRequirement(level) {
    return Math.floor(constants_1.BASE_XP_REQUIREMENT * Math.pow(constants_1.XP_MULTIPLIER, level - 1));
}
function calculateTotalXP(level, currentLevelXP) {
    let totalXP = currentLevelXP;
    for (let i = 1; i < level; i++) {
        totalXP += calculateXPRequirement(i);
    }
    return totalXP;
}
function calculateLevelFromTotalXP(totalXP) {
    let level = 1;
    let xpNeeded = 0;
    while (xpNeeded + calculateXPRequirement(level) <= totalXP) {
        xpNeeded += calculateXPRequirement(level);
        level++;
    }
    return level;
}
function calculateCurrentLevelXP(totalXP, level) {
    let xpNeeded = 0;
    for (let i = 1; i < level; i++) {
        xpNeeded += calculateXPRequirement(i);
    }
    return totalXP - xpNeeded;
}
function calculateMaxHealthFromLevel(level) {
    return constants_1.PLAYER_MAX_HEALTH + Math.ceil(Math.pow(level, 1.5) * constants_1.HEALTH_PER_LEVEL);
}
function calculateDamageFromLevel(level) {
    return constants_1.PLAYER_DAMAGE + Math.ceil(Math.pow(level, 1.5) * constants_1.DAMAGE_PER_LEVEL);
}
function getSkillMultiplier(skillTier) {
    if (!skillTier)
        return 1;
    const multipliers = {
        common: 1,
        uncommon: 1.1,
        rare: 1.2,
        epic: 1.3,
        legendary: 1.4,
        mythic: 1.5,
        ultra: 1.6,
        super: 1.7,
        unique: 1.8
    };
    return multipliers[skillTier] || 1;
}
function applyPetalHealthBonus(petal, player) {
    if (!petal || petal.type !== 'petal' || !petal.petalType)
        return;
    const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity || 'common');
    if (!petalStats)
        return;
    const petalHealthMultiplier = getSkillMultiplier(player.skills?.petalHealth);
    const maxHealth = Math.round(petalStats.health * petalHealthMultiplier);
    petal.maxHealth = maxHealth;
    if (petal.health !== undefined) {
        petal.health = Math.min(petal.health, maxHealth);
    }
}
function addXPToPlayer(player, xp, socketId, io) {
    // Calculate current total XP
    const currentTotalXP = calculateTotalXP(player.level, player.xp);
    // Add the new XP
    const newTotalXP = currentTotalXP + xp;
    // Calculate new level from total XP
    const oldLevel = player.level;
    const newLevel = calculateLevelFromTotalXP(newTotalXP);
    const newCurrentLevelXP = calculateCurrentLevelXP(newTotalXP, newLevel);
    // Update player stats
    player.xp = newCurrentLevelXP;
    player.level = newLevel;
    player.xpToNextLevel = calculateXPRequirement(newLevel);
    // Check if level increased and handle level ups
    if (newLevel > oldLevel) {
        // Award TP for each level gained (1 TP per level)
        const levelsGained = newLevel - oldLevel;
        if (!player.tp)
            player.tp = 0;
        player.tp += levelsGained;
        // Initialize skills if not present
        if (!player.skills) {
            player.skills = {};
        }
        // Update maxHealth and damage based on new level and skills (using multipliers)
        const healthMultiplier = getSkillMultiplier(player.skills.playerHealth);
        const damageMultiplier = getSkillMultiplier(player.skills.damage);
        player.maxHealth = Math.round(calculateMaxHealthFromLevel(newLevel) * healthMultiplier);
        player.damage = Math.round(calculateDamageFromLevel(newLevel) * damageMultiplier);
        // Heal to full when leveling up
        player.health = player.maxHealth;
        // Emit level up event for each level gained
        for (let level = oldLevel + 1; level <= newLevel; level++) {
            io.emit('levelUp', {
                playerId: player.id,
                level: level,
                maxHealth: calculateMaxHealthFromLevel(level),
                damage: calculateDamageFromLevel(level)
            });
        }
        // Emit skills update
        io.emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });
    }
}
function savePlayerProgress(player, userId, database) {
    if (userId) {
        // Calculate total XP from current level and XP
        const totalXP = calculateTotalXP(player.level, player.xp);
        // Filter loadout to only save type and rarity (not status fields)
        const cleanLoadout = (player.loadout || []).map(item => {
            if (!item)
                return null;
            return {
                type: item.type,
                rarity: item.rarity,
                petalType: item.petalType
            };
        });
        database.savePlayer(userId, {
            totalXP: totalXP,
            inventory: player.inventory,
            loadout: cleanLoadout,
            tp: player.tp || 0,
            skills: player.skills || {}
        });
    }
}
