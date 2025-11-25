"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEnemy = createEnemy;
exports.createSpecialMob = createSpecialMob;
exports.updateSpecialMobCounts = updateSpecialMobCounts;
exports.spawnSpecialMobs = spawnSpecialMobs;
const constants_1 = require("../constants");
const gameState_1 = require("./gameState");
const constants_2 = require("../constants");
const mobs_1 = require("../mobs");
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
        // Check if position is in a safe zone
        const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
            x >= element.x * constants_2.SCALE_FACTOR &&
            x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
            y >= element.y * constants_2.SCALE_FACTOR &&
            y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
        // Check if position collides with walls
        const collidesWithWall = constants_2.WORLD_MAP.some(element => element.type === 'wall' &&
            x >= element.x * constants_2.SCALE_FACTOR &&
            x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
            y >= element.y * constants_2.SCALE_FACTOR &&
            y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
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
                const allMobTypes = (0, mobs_1.getAllMobTypes)();
                if (allMobTypes.length === 0) {
                    console.error("No mob types found in MOB_CONFIG.");
                    return null;
                }
                // Filter out target_dummy from random selection (they should only spawn from explicit spawn table entries)
                const eligibleMobTypes = allMobTypes.filter(type => type !== 'target_dummy');
                if (eligibleMobTypes.length === 0) {
                    console.error("No eligible mob types found (excluding target dummies).");
                    return null;
                }
                mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)];
            }
        }
        else {
            // Fallback if spawn table selection fails
            const allMobTypes = (0, mobs_1.getAllMobTypes)();
            if (allMobTypes.length === 0) {
                console.error("No mob types found in MOB_CONFIG.");
                return null;
            }
            // Filter out target_dummy from random selection
            const eligibleMobTypes = allMobTypes.filter(type => type !== 'target_dummy');
            if (eligibleMobTypes.length === 0) {
                console.error("No eligible mob types found (excluding target dummies).");
                return null;
            }
            mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)];
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
            // Outside spawn zones and biomes - use normal probability distribution
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
        // Select mob type (fish, octopus, or shark)
        // Filter out biome-only mobs when spawning outside biomes
        const allMobTypes = (0, mobs_1.getAllMobTypes)();
        if (allMobTypes.length === 0) {
            console.error("No mob types found in MOB_CONFIG.");
            return null;
        }
        // Filter to only allow non-biome-only mobs in regular spawn zones
        // Also exclude target_dummy (they should only spawn from explicit map biome entries)
        const eligibleMobTypes = allMobTypes.filter(type => {
            if (type === 'target_dummy') {
                return false; // Never spawn target dummies as normal mobs
            }
            const stats = (0, mobs_1.getMobStats)(type, tier);
            return stats && !stats.biomeOnly;
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
            // Check if position is in a safe zone
            const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                x >= element.x * constants_2.SCALE_FACTOR &&
                x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                y >= element.y * constants_2.SCALE_FACTOR &&
                y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
            // Check if position collides with walls
            const collidesWithWall = constants_2.WORLD_MAP.some(element => element.type === 'wall' &&
                x >= element.x * constants_2.SCALE_FACTOR &&
                x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                y >= element.y * constants_2.SCALE_FACTOR &&
                y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
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
            // Check if position is in a safe zone
            const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                x >= element.x * constants_2.SCALE_FACTOR &&
                x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                y >= element.y * constants_2.SCALE_FACTOR &&
                y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
            // Check if position collides with walls
            const collidesWithWall = constants_2.WORLD_MAP.some(element => element.type === 'wall' &&
                x >= element.x * constants_2.SCALE_FACTOR &&
                x <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                y >= element.y * constants_2.SCALE_FACTOR &&
                y <= (element.y + element.height) * constants_2.SCALE_FACTOR);
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
    const position = getRandomPositionInZoneType(zoneType);
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
    // Exclude target dummies from boss mob counting
    gameState_1.ultraMobCount.value = constants_1.enemies.filter((e) => e.tier === 'ultra' && e.type !== 'target_dummy').length;
    gameState_1.superMobCount.value = constants_1.enemies.filter((e) => e.tier === 'super' && e.type !== 'target_dummy').length;
    gameState_1.uniqueMobCount.value = constants_1.enemies.filter((e) => e.tier === 'unique' && e.type !== 'target_dummy').length;
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
