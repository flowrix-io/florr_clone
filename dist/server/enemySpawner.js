"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EQUAL_RARITY_SECTIONS = void 0;
exports.createEnemy = createEnemy;
exports.createSpecialMob = createSpecialMob;
exports.updateSpecialMobCounts = updateSpecialMobCounts;
exports.spawnSpecialMobs = spawnSpecialMobs;
const constants_1 = require("../constants");
const gameState_1 = require("./gameState");
const constants_2 = require("../constants");
const mobs_1 = require("../mobs");
// Tier order from lowest to highest
const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
// Sections (0-8) where all rarities have equal spawn chance
// Section layout:
//   0 | 1 | 2
//   ---------
//   3 | 4 | 5
//   ---------
//   6 | 7 | 8
exports.EQUAL_RARITY_SECTIONS = [7];
// Tier spawn weights for equal rarity sections
// Ultra: 5%, Super: 0.1%, remaining 94.9% split equally among common-mythic
const EQUAL_RARITY_TIER_WEIGHTS = [
    { tier: 'common', weight: 0.94 / 6 },
    { tier: 'uncommon', weight: 0.94 / 6 },
    { tier: 'rare', weight: 0.94 / 6 },
    { tier: 'epic', weight: 0.94 / 6 },
    { tier: 'legendary', weight: 0.94 / 6 },
    { tier: 'mythic', weight: 0.94 / 6 },
    { tier: 'ultra', weight: 0.05 },
    { tier: 'super', weight: 0.001 }
];
// Helper function to select tier from equal rarity weights
function selectEqualRarityTier() {
    const roll = Math.random();
    let cumulative = 0;
    for (const entry of EQUAL_RARITY_TIER_WEIGHTS) {
        cumulative += entry.weight;
        if (roll < cumulative) {
            return entry.tier;
        }
    }
    return 'common'; // Fallback
}
// Boundary threshold for out-of-bounds zone (same as wall extension threshold)
const BOUNDARY_THRESHOLD = 100;
// Helper function to check if a position is in the out-of-bounds zone
function isInOutOfBoundsZone(x, y) {
    return x < BOUNDARY_THRESHOLD ||
        x > constants_2.ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
        y < BOUNDARY_THRESHOLD ||
        y > constants_2.ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
}
// Helper function to get section number (0-8) from world position
const SECTION_SIZE = 20000;
function getSectionAtPosition(x, y) {
    const sectionX = Math.max(0, Math.min(2, Math.floor(x / SECTION_SIZE)));
    const sectionY = Math.max(0, Math.min(2, Math.floor(y / SECTION_SIZE)));
    return sectionY * 3 + sectionX;
}
// Helper function to upgrade a tier by one level (if possible)
function upgradeTier(tier) {
    const currentIndex = TIER_ORDER.indexOf(tier);
    if (currentIndex >= 0 && currentIndex < TIER_ORDER.length - 1) {
        return TIER_ORDER[currentIndex + 1];
    }
    return tier; // Already at max tier
}
// Helper function to downgrade a tier by one level (if possible)
function downgradeTier(tier) {
    const currentIndex = TIER_ORDER.indexOf(tier);
    if (currentIndex > 0 && currentIndex < TIER_ORDER.length) {
        return TIER_ORDER[currentIndex - 1];
    }
    return tier; // Already at lowest tier
}
// Calculate crafting chance for upgrading from one rarity to the next
// (same formula as in itemManager.ts)
function getCraftingChance(rarityIndex) {
    const baseChance = 64;
    return baseChance / Math.pow(2, rarityIndex);
}
// Calculate downgrade chance for a mob (1 / (1 + craft chance to that rarity))
// The crafting chance for upgrading TO a rarity is calculated FROM the previous rarity
function getMobDowngradeChance(currentTier) {
    const currentIndex = TIER_ORDER.indexOf(currentTier);
    if (currentIndex === -1 || currentIndex === 0) {
        return 0; // Invalid tier or already at lowest tier (common)
    }
    // Crafting chance for upgrading TO the current tier is calculated FROM the previous tier
    // (craft chance from currentIndex-1 to currentIndex)
    const craftingChanceToCurrentTier = getCraftingChance(currentIndex - 1);
    // Downgrade chance is 1 / (1 + craft chance to that rarity)
    return 1 / (1 + craftingChanceToCurrentTier);
}
// Helper function to get spawn zone type for a given position
function getSpawnZoneType(x, y) {
    for (const element of constants_2.WORLD_MAP) {
        if (element.type === 'spawn' && element.properties?.spawnType) {
            const scaledX = x / constants_2.SCALE_FACTOR;
            const scaledY = y / constants_2.SCALE_FACTOR;
            if (scaledX >= element.x &&
                scaledX <= element.x + element.width &&
                scaledY >= element.y &&
                scaledY <= element.y + element.height) {
                return element.properties.spawnType;
            }
        }
    }
    return null; // Not in any spawn zone
}
// Helper function to get biome at a given position
function getBiomeAtPosition(x, y) {
    for (const element of constants_2.WORLD_MAP) {
        if (element.type === 'biome') {
            const scaledX = x / constants_2.SCALE_FACTOR;
            const scaledY = y / constants_2.SCALE_FACTOR;
            if (scaledX >= element.x &&
                scaledX <= element.x + element.width &&
                scaledY >= element.y &&
                scaledY <= element.y + element.height) {
                return element;
            }
        }
    }
    return null; // Not in any biome
}
// Helper function to select a spawn from a biome's spawn table
function selectSpawnFromBiomeTable(spawnTable) {
    if (!spawnTable || spawnTable.length === 0)
        return null;
    // Calculate total weight
    const totalWeight = spawnTable.reduce((sum, entry) => sum + entry.weight, 0);
    // Random selection based on weights
    let random = Math.random() * totalWeight;
    for (const entry of spawnTable) {
        random -= entry.weight;
        if (random <= 0) {
            return {
                mobType: entry.mobType,
                tier: entry.tier,
                reversed: entry.reversed
            };
        }
    }
    // Fallback to first entry
    return {
        mobType: spawnTable[0].mobType,
        tier: spawnTable[0].tier,
        reversed: spawnTable[0].reversed
    };
}
// Helper function to get random position in a specific zone type
function getRandomPositionInZoneType(zoneType) {
    const zones = constants_2.WORLD_MAP.filter(element => element.type === 'spawn' &&
        element.properties?.spawnType === zoneType);
    if (zones.length === 0)
        return null;
    const zone = zones[Math.floor(Math.random() * zones.length)];
    let x = (zone.x + Math.random() * zone.width) * constants_2.SCALE_FACTOR;
    let y = (zone.y + Math.random() * zone.height) * constants_2.SCALE_FACTOR;
    // Ensure position is within world boundaries
    x = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
    y = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
    // Skip if position is in out-of-bounds zone (retry if needed)
    if (isInOutOfBoundsZone(x, y)) {
        // Try one more time with a different zone if available
        if (zones.length > 1) {
            const otherZone = zones.find(z => z !== zone) || zones[0];
            x = (otherZone.x + Math.random() * otherZone.width) * constants_2.SCALE_FACTOR;
            y = (otherZone.y + Math.random() * otherZone.height) * constants_2.SCALE_FACTOR;
            x = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
            // If still in out-of-bounds zone, return null
            if (isInOutOfBoundsZone(x, y)) {
                return null;
            }
        }
        else {
            return null;
        }
    }
    return { x, y };
}
/**
 * Create a new enemy at a valid position
 */
function createEnemy(helpers) {
    const playerCount = Object.keys(constants_1.players).length;
    // Don't spawn if no players are connected
    if (playerCount === 0) {
        return null;
    }
    // Calculate target enemy count based on viewport density
    const viewports = helpers.getPlayerViewports();
    const totalViewportArea = viewports.reduce((total, viewport) => {
        const extendedViewport = {
            x: viewport.x - constants_2.VIEWPORT_BUFFER,
            y: viewport.y - constants_2.VIEWPORT_BUFFER,
            width: viewport.width + (constants_2.VIEWPORT_BUFFER * 2),
            height: viewport.height + (constants_2.VIEWPORT_BUFFER * 2)
        };
        return total + (extendedViewport.width * extendedViewport.height);
    }, 0);
    // Calculate target density: same as 9000 enemies across the whole world (9x density)
    const targetDensity = constants_2.ORIGINAL_ENEMY_COUNT / constants_2.TOTAL_WORLD_AREA;
    const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
    // Don't spawn if we already have enough enemies in viewport
    if (helpers.getEnemiesInViewportCount() >= targetEnemyCount) {
        return null;
    }
    let validPosition = false;
    let x = 0, y = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // Increased attempts for viewport-only spawning
    while (!validPosition && attempts < MAX_ATTEMPTS) {
        attempts++;
        // Pick a random player and spawn near their viewport
        const randomPlayerId = Object.keys(constants_1.players)[Math.floor(Math.random() * Object.keys(constants_1.players).length)];
        const player = constants_1.players[randomPlayerId];
        // Generate position within player's viewport (with buffer)
        const viewportBuffer = constants_2.VIEWPORT_BUFFER;
        const minX = player.x - constants_2.VIEWPORT_WIDTH / 2 - viewportBuffer;
        const maxX = player.x + constants_2.VIEWPORT_WIDTH / 2 + viewportBuffer;
        const minY = player.y - constants_2.VIEWPORT_HEIGHT / 2 - viewportBuffer;
        const maxY = player.y + constants_2.VIEWPORT_HEIGHT / 2 + viewportBuffer;
        x = minX + Math.random() * (maxX - minX);
        y = minY + Math.random() * (maxY - minY);
        // Clamp to world boundaries
        x = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
        y = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
        // Skip if position is in out-of-bounds zone
        if (isInOutOfBoundsZone(x, y)) {
            continue;
        }
        // Check if position is in a safe zone
        const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
            x >= element.x * constants_2.SCALE_FACTOR &&
            x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
            y >= element.y * constants_2.SCALE_FACTOR &&
            y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
        // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
        const tileState = (0, constants_2.getTileState)(constants_2.WALL_GRID, x, y);
        const collidesWithWall = tileState === 1 || tileState === 2;
        if (!inSafeZone && !collidesWithWall) {
            validPosition = true;
        }
    }
    // If we couldn't find a valid position, return null
    if (!validPosition) {
        return null;
    }
    // Check if position is in a biome first
    const biome = getBiomeAtPosition(x, y);
    let tier = 'common';
    let mobType;
    let reversed = undefined;
    if (biome && biome.properties?.spawnTable && biome.properties.spawnTable.length > 0) {
        // In a biome - use the biome's spawn table
        const spawnSelection = selectSpawnFromBiomeTable(biome.properties.spawnTable);
        if (spawnSelection) {
            tier = spawnSelection.tier;
            reversed = spawnSelection.reversed;
            // If spawn table specifies a mob type, use it; otherwise pick randomly
            if (spawnSelection.mobType) {
                mobType = spawnSelection.mobType;
                // For target dummies, check if one of this tier already exists
                if (mobType === 'target_dummy') {
                    const existingDummy = constants_1.enemies.find((e) => e.type === 'target_dummy' && e.tier === tier);
                    if (existingDummy) {
                        // Target dummy of this tier already exists, don't spawn another
                        return null;
                    }
                }
            }
            else {
                // No specific mob type - spawn any mob of this tier that belongs to the current section
                const allMobTypes = (0, mobs_1.getAllMobTypes)();
                if (allMobTypes.length === 0) {
                    console.error("No mob types found in MOB_CONFIG.");
                    return null;
                }
                // Filter to mobs that belong to this section and exclude target_dummy
                const currentSection = getSectionAtPosition(x, y);
                const eligibleMobTypes = allMobTypes.filter(type => {
                    if (type === 'target_dummy') {
                        return false; // Never spawn target dummies as normal mobs
                    }
                    const stats = (0, mobs_1.getMobStats)(type, tier);
                    return stats && stats.section === currentSection;
                });
                if (eligibleMobTypes.length === 0) {
                    // No eligible mobs for this tier and section
                    return null;
                }
                mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)];
            }
        }
        else {
            // Fallback if spawn table selection fails - use section filtering
            const allMobTypes = (0, mobs_1.getAllMobTypes)();
            if (allMobTypes.length === 0) {
                console.error("No mob types found in MOB_CONFIG.");
                return null;
            }
            // Filter to mobs that belong to this section and exclude target_dummy
            const currentSection = getSectionAtPosition(x, y);
            const eligibleMobTypes = allMobTypes.filter(type => {
                if (type === 'target_dummy') {
                    return false; // Never spawn target dummies as normal mobs
                }
                const stats = (0, mobs_1.getMobStats)(type, 'common');
                return stats && stats.section === currentSection;
            });
            if (eligibleMobTypes.length === 0) {
                // No eligible mobs for this section
                return null;
            }
            mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)];
        }
        // Tier upgrade or downgrade (mutually exclusive)
        // Try upgrade first, if it doesn't happen, try downgrade
        const upgradeRoll = Math.random();
        if (upgradeRoll < 0.02) {
            // Upgrade succeeded
            tier = upgradeTier(tier);
        }
        else {
            // Upgrade didn't happen, try downgrade
            const downgradeChance = getMobDowngradeChance(tier);
            if (downgradeChance > 0 && Math.random() < downgradeChance) {
                tier = downgradeTier(tier);
            }
        }
    }
    else {
        // Check if position is in a spawn zone
        const spawnZoneType = getSpawnZoneType(x, y);
        if (spawnZoneType) {
            // In a spawn zone - only spawn the specific rarity for this zone
            tier = spawnZoneType;
        }
        else {
            // Outside spawn zones and biomes - check if section has equal rarity spawning
            const currentSection = getSectionAtPosition(x, y);
            if (exports.EQUAL_RARITY_SECTIONS.includes(currentSection)) {
                // Weighted spawn chance for all tiers
                tier = selectEqualRarityTier();
            }
            else {
                // Use normal probability distribution
                const tierRoll = Math.random();
                let cumulativeProbability = 0;
                for (const [t, data] of Object.entries(constants_2.ENEMY_TIERS)) {
                    cumulativeProbability += data.probability;
                    if (tierRoll < cumulativeProbability) {
                        tier = t;
                        break;
                    }
                }
            }
        }
        // Tier upgrade or downgrade (mutually exclusive)
        // Try upgrade first, if it doesn't happen, try downgrade
        const upgradeRoll = Math.random();
        if (upgradeRoll < 0.02) {
            // Upgrade succeeded
            tier = upgradeTier(tier);
        }
        else {
            // Upgrade didn't happen, try downgrade
            const downgradeChance = getMobDowngradeChance(tier);
            if (downgradeChance > 0 && Math.random() < downgradeChance) {
                tier = downgradeTier(tier);
            }
        }
        // Select mob type (fish, octopus, or shark)
        // Filter out biome-only mobs when spawning outside biomes
        const allMobTypes = (0, mobs_1.getAllMobTypes)();
        if (allMobTypes.length === 0) {
            console.error("No mob types found in MOB_CONFIG.");
            return null;
        }
        // Filter to only allow mobs that belong to this section
        // Also exclude target_dummy (they should only spawn from explicit map biome entries)
        const currentSection = getSectionAtPosition(x, y);
        const eligibleMobTypes = allMobTypes.filter(type => {
            if (type === 'target_dummy') {
                return false; // Never spawn target dummies as normal mobs
            }
            const stats = (0, mobs_1.getMobStats)(type, tier);
            return stats && stats.section === currentSection;
        });
        if (eligibleMobTypes.length === 0) {
            // No eligible mobs for this tier outside biomes
            return null;
        }
        mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)];
    }
    // Get mob stats from config
    const mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats) {
        console.error(`No mob stats found for ${mobType} ${tier}`);
        return null;
    }
    // Check if the spawn position would overlap with any player's petal range
    const mobSize = mobStats.size * 40;
    if (helpers.isPositionInPlayerPetalRange(x, y, mobSize)) {
        // Position is too close to player petal range, try to find a new position
        let newValidPosition = false;
        let newAttempts = 0;
        const MAX_NEW_ATTEMPTS = 50;
        while (!newValidPosition && newAttempts < MAX_NEW_ATTEMPTS) {
            newAttempts++;
            // Pick a random player and spawn near their viewport
            const randomPlayerId = Object.keys(constants_1.players)[Math.floor(Math.random() * Object.keys(constants_1.players).length)];
            const player = constants_1.players[randomPlayerId];
            // Generate position within player's viewport (with buffer)
            const viewportBuffer = constants_2.VIEWPORT_BUFFER;
            const minX = player.x - constants_2.VIEWPORT_WIDTH / 2 - viewportBuffer;
            const maxX = player.x + constants_2.VIEWPORT_WIDTH / 2 + viewportBuffer;
            const minY = player.y - constants_2.VIEWPORT_HEIGHT / 2 - viewportBuffer;
            const maxY = player.y + constants_2.VIEWPORT_HEIGHT / 2 + viewportBuffer;
            x = minX + Math.random() * (maxX - minX);
            y = minY + Math.random() * (maxY - minY);
            // Clamp to world boundaries
            x = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
            // Skip if position is in out-of-bounds zone
            if (isInOutOfBoundsZone(x, y)) {
                continue;
            }
            // Check if position is in a safe zone
            const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                x >= element.x * constants_2.SCALE_FACTOR &&
                x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                y >= element.y * constants_2.SCALE_FACTOR &&
                y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
            // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
            const tileState = (0, constants_2.getTileState)(constants_2.WALL_GRID, x, y);
            const collidesWithWall = tileState === 1 || tileState === 2;
            // Check if position is safe from petal range
            const inPetalRange = helpers.isPositionInPlayerPetalRange(x, y, mobSize);
            if (!inSafeZone && !collidesWithWall && !inPetalRange) {
                newValidPosition = true;
            }
        }
        // If we still couldn't find a valid position, return null
        if (!newValidPosition) {
            return null;
        }
    }
    // Check if spawn position is too close to other mobs
    const MIN_MOB_SPAWN_DISTANCE = 80; // Minimum distance between mob spawns (2x base mob size)
    const halfMobSize = mobSize / 2;
    const tooCloseToOtherMob = constants_1.enemies.some((otherEnemy) => {
        const otherMobStats = (0, mobs_1.getMobStats)(otherEnemy.type, otherEnemy.tier);
        const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
        const otherHalfSize = otherMobSize / 2;
        const dx = otherEnemy.x - x;
        const dy = otherEnemy.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = halfMobSize + otherHalfSize + MIN_MOB_SPAWN_DISTANCE;
        return distance < minDistance;
    });
    if (tooCloseToOtherMob) {
        // Position is too close to another mob, try to find a new position
        let newValidPosition = false;
        let newAttempts = 0;
        const MAX_NEW_ATTEMPTS = 50;
        while (!newValidPosition && newAttempts < MAX_NEW_ATTEMPTS) {
            newAttempts++;
            // Pick a random player and spawn near their viewport
            const randomPlayerId = Object.keys(constants_1.players)[Math.floor(Math.random() * Object.keys(constants_1.players).length)];
            const player = constants_1.players[randomPlayerId];
            // Generate position within player's viewport (with buffer)
            const viewportBuffer = constants_2.VIEWPORT_BUFFER;
            const minX = player.x - constants_2.VIEWPORT_WIDTH / 2 - viewportBuffer;
            const maxX = player.x + constants_2.VIEWPORT_WIDTH / 2 + viewportBuffer;
            const minY = player.y - constants_2.VIEWPORT_HEIGHT / 2 - viewportBuffer;
            const maxY = player.y + constants_2.VIEWPORT_HEIGHT / 2 + viewportBuffer;
            x = minX + Math.random() * (maxX - minX);
            y = minY + Math.random() * (maxY - minY);
            // Clamp to world boundaries
            x = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
            // Skip if position is in out-of-bounds zone
            if (isInOutOfBoundsZone(x, y)) {
                continue;
            }
            // Check if position is in a safe zone
            const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                x >= element.x * constants_2.SCALE_FACTOR &&
                x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                y >= element.y * constants_2.SCALE_FACTOR &&
                y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
            // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
            const tileState = (0, constants_2.getTileState)(constants_2.WALL_GRID, x, y);
            const collidesWithWall = tileState === 1 || tileState === 2;
            // Check if position is safe from petal range
            const inPetalRange = helpers.isPositionInPlayerPetalRange(x, y, mobSize);
            // Check if position is far enough from other mobs
            const tooClose = constants_1.enemies.some((otherEnemy) => {
                const otherMobStats = (0, mobs_1.getMobStats)(otherEnemy.type, otherEnemy.tier);
                const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
                const otherHalfSize = otherMobSize / 2;
                const dx = otherEnemy.x - x;
                const dy = otherEnemy.y - y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const minDistance = halfMobSize + otherHalfSize + MIN_MOB_SPAWN_DISTANCE;
                return distance < minDistance;
            });
            if (!inSafeZone && !collidesWithWall && !inPetalRange && !tooClose) {
                newValidPosition = true;
            }
        }
        // If we still couldn't find a valid position, return null
        if (!newValidPosition) {
            return null;
        }
    }
    const currentTime = Date.now();
    const enemy = {
        id: Math.random().toString(36).substr(2, 9),
        type: mobType,
        tier,
        x,
        y,
        angle: Math.random() * Math.PI * 2,
        health: mobStats.health,
        maxHealth: mobStats.health,
        speed: mobStats.speed,
        damage: mobStats.damage,
        knockbackX: 0,
        knockbackY: 0,
        isHostile: mobStats.is_hostile,
        range: mobStats.range,
        reversed: reversed ?? mobStats.reversed ?? false,
        spawnTime: currentTime,
        lastViewportCheck: currentTime // Mark as in viewport since we spawned it there
    };
    // Initialize DPS tracking for target dummies
    if (mobType === 'target_dummy') {
        enemy.dpsStartTime = currentTime;
        enemy.dpsHistory = [];
        enemy.currentDPS = 0;
    }
    return enemy;
}
/**
 * Function to create special mobs (ultra, super, unique)
 */
function createSpecialMob(tier, helpers) {
    let zoneType;
    if (tier === 'ultra') {
        zoneType = 'legendary';
    }
    else if (tier === 'super') {
        zoneType = 'mythic';
    }
    else { // unique
        zoneType = 'mythic';
    }
    let position = getRandomPositionInZoneType(zoneType);
    if (!position) {
        console.error(`No ${zoneType} zones found for ${tier} mob spawning`);
        return null;
    }
    const allMobTypes = (0, mobs_1.getAllMobTypes)();
    if (allMobTypes.length === 0) {
        console.error("No mob types found in MOB_CONFIG.");
        return null;
    }
    // Filter out target_dummy from boss mob spawning
    const eligibleMobTypes = allMobTypes.filter(type => type !== 'target_dummy');
    if (eligibleMobTypes.length === 0) {
        console.error("No eligible mob types found for boss spawning (excluding target dummies).");
        return null;
    }
    const mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)];
    const mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats) {
        console.error(`No mob stats found for ${mobType} ${tier}`);
        return null;
    }
    // Check if position is in out-of-bounds zone
    if (isInOutOfBoundsZone(position.x, position.y)) {
        console.error(`Spawn position for ${tier} mob is in out-of-bounds zone. Trying alternative position...`);
        // Try to find a new position in the same zone type
        const newPosition = getRandomPositionInZoneType(zoneType);
        if (!newPosition) {
            console.error(`Could not find valid position for ${tier} mob outside out-of-bounds zone`);
            return null;
        }
        if (isInOutOfBoundsZone(newPosition.x, newPosition.y)) {
            console.error(`Could not find valid position for ${tier} mob outside out-of-bounds zone`);
            return null;
        }
        position = newPosition;
    }
    // Check if the spawn position would overlap with any player's petal range
    const mobSize = mobStats.size * 40;
    if (helpers.isPositionInPlayerPetalRange(position.x, position.y, mobSize)) {
        // Position is too close to player petal range, try to find a new position
        let newValidPosition = false;
        let newAttempts = 0;
        const MAX_NEW_ATTEMPTS = 50;
        while (!newValidPosition && newAttempts < MAX_NEW_ATTEMPTS) {
            newAttempts++;
            // Try to find a new position in the same zone type
            const newPosition = getRandomPositionInZoneType(zoneType);
            if (!newPosition) {
                continue; // Try again
            }
            // Check if the new position is safe from petal range
            const inPetalRange = helpers.isPositionInPlayerPetalRange(newPosition.x, newPosition.y, mobSize);
            if (!inPetalRange) {
                position.x = newPosition.x;
                position.y = newPosition.y;
                newValidPosition = true;
            }
        }
        // If we still couldn't find a valid position, return null
        if (!newValidPosition) {
            return null;
        }
    }
    const currentTime = Date.now();
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: mobType,
        tier: tier,
        x: position.x,
        y: position.y,
        angle: Math.random() * Math.PI * 2,
        health: mobStats.health,
        maxHealth: mobStats.health,
        speed: mobStats.speed,
        damage: mobStats.damage,
        knockbackX: 0,
        knockbackY: 0,
        isHostile: mobStats.is_hostile,
        range: mobStats.range
    };
}
/**
 * Function to update special mob counts
 */
function updateSpecialMobCounts() {
    // Optimize: count in single pass instead of 3 separate filters
    let ultra = 0;
    let super_ = 0;
    let unique = 0;
    for (const enemy of constants_1.enemies) {
        if (enemy.type === 'target_dummy')
            continue;
        if (enemy.tier === 'ultra')
            ultra++;
        else if (enemy.tier === 'super')
            super_++;
        else if (enemy.tier === 'unique')
            unique++;
    }
    gameState_1.ultraMobCount.value = ultra;
    gameState_1.superMobCount.value = super_;
    gameState_1.uniqueMobCount.value = unique;
}
/**
 * Function to spawn special mobs
 */
function spawnSpecialMobs(helpers, io) {
    // Update counts first
    updateSpecialMobCounts();
    // Spawn ultra mob if none exists
    if (gameState_1.ultraMobCount.value === 0) {
        const ultraMob = createSpecialMob('ultra', helpers);
        if (ultraMob) {
            constants_1.enemies.push(ultraMob);
            gameState_1.ultraMobCount.value = 1;
            // Don't send spawn notification for target dummies
            if (ultraMob.type !== 'target_dummy') {
                io.emit('chatMessage', {
                    sender: '',
                    content: `<b style="color: ${constants_2.ENEMY_TIERS.ultra.color};">An ultra ${ultraMob.type.replace('_', ' ')} has spawned in a legendary zone!</b>`,
                    timestamp: Date.now()
                });
            }
            console.log(`[SERVER] Spawned ultra mob: ${ultraMob.type} at (${ultraMob.x}, ${ultraMob.y})`);
        }
    }
    // Spawn super mob if none exists
    if (gameState_1.superMobCount.value === 0) {
        const superMob = createSpecialMob('super', helpers);
        if (superMob) {
            constants_1.enemies.push(superMob);
            gameState_1.superMobCount.value = 1;
            // Don't send spawn notification for target dummies
            if (superMob.type !== 'target_dummy') {
                io.emit('chatMessage', {
                    sender: '',
                    content: `<b style="color: ${constants_2.ENEMY_TIERS.super.color};">A super ${superMob.type.replace('_', ' ')} has spawned in a mythic zone!</b>`,
                    timestamp: Date.now()
                });
            }
            console.log(`[SERVER] Spawned super mob: ${superMob.type} at (${superMob.x}, ${superMob.y})`);
        }
    }
    // Spawn unique mob with 1/4 chance if super mob exists
    if (gameState_1.superMobCount.value > 0 && gameState_1.uniqueMobCount.value === 0 && Math.random() < 0.25) {
        const uniqueMob = createSpecialMob('unique', helpers);
        if (uniqueMob) {
            constants_1.enemies.push(uniqueMob);
            gameState_1.uniqueMobCount.value = 1;
            // Don't send spawn notification for target dummies
            if (uniqueMob.type !== 'target_dummy') {
                io.emit('chatMessage', {
                    sender: '',
                    content: `<b style="color: ${constants_2.ENEMY_TIERS.unique.color};">A unique ${uniqueMob.type.replace('_', ' ')} has spawned in a mythic zone!</b>`,
                    timestamp: Date.now()
                });
            }
            console.log(`[SERVER] Spawned unique mob: ${uniqueMob.type} at (${uniqueMob.x}, ${uniqueMob.y})`);
        }
    }
}
