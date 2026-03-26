import { Server as SocketIOServer } from '../ws_server';
import { Enemy } from '../server_utils';
import { 
    players,
    enemies
} from '../constants';
import {
    ultraMobCount,
    superMobCount,
    uniqueMobCount,
    superMobPerSection,
    setSuperMobInSection,
    getSuperMobInSection,
    clearSuperMobFromSection
} from './gameState';
import {
    ENEMY_TIERS,
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    SCALE_FACTOR,
    VIEWPORT_BUFFER,
    VIEWPORT_WIDTH,
    VIEWPORT_HEIGHT,
    ORIGINAL_ENEMY_COUNT,
    TOTAL_WORLD_AREA,
    MapElement,
    BiomeSpawnEntry,
    getTileState,
    WALL_TILE_SIZE
} from '../constants';
import { WORLD_MAP, WALL_GRID } from '../map_data';
import { getMobStats, getAllMobTypes } from '../mobs';

// Tier order from lowest to highest
const TIER_ORDER: Enemy['tier'][] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];

// Sections (0-8) where all rarities have equal spawn chance
// Section layout:
//   0 | 1 | 2
//   ---------
//   3 | 4 | 5
//   ---------
//   6 | 7 | 8
export const EQUAL_RARITY_SECTIONS: number[] = [7];

// Tier spawn weights for equal rarity sections
// Ultra: 5%, Super: 0.1%, remaining 94.9% split equally among common-mythic
const EQUAL_RARITY_TIER_WEIGHTS: { tier: Enemy['tier'], weight: number }[] = [
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
function selectEqualRarityTier(): Enemy['tier'] {
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
function isInOutOfBoundsZone(x: number, y: number): boolean {
    return x < BOUNDARY_THRESHOLD ||
           x > ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
           y < BOUNDARY_THRESHOLD ||
           y > ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
}

// Helper function to get section number (0-8) from world position
const SECTION_SIZE = 20000;
export function getSectionAtPosition(x: number, y: number): number {
    const sectionX = Math.max(0, Math.min(2, Math.floor(x / SECTION_SIZE)));
    const sectionY = Math.max(0, Math.min(2, Math.floor(y / SECTION_SIZE)));
    return sectionY * 3 + sectionX;
}

// Helper function to upgrade a tier by one level (if possible)
function upgradeTier(tier: Enemy['tier']): Enemy['tier'] {
    const currentIndex = TIER_ORDER.indexOf(tier);
    if (currentIndex >= 0 && currentIndex < TIER_ORDER.length - 1) {
        return TIER_ORDER[currentIndex + 1];
    }
    return tier; // Already at max tier
}

// Helper function to downgrade a tier by one level (if possible)
function downgradeTier(tier: Enemy['tier']): Enemy['tier'] {
    const currentIndex = TIER_ORDER.indexOf(tier);
    if (currentIndex > 0 && currentIndex < TIER_ORDER.length) {
        return TIER_ORDER[currentIndex - 1];
    }
    return tier; // Already at lowest tier
}

// Calculate crafting chance for upgrading from one rarity to the next
// (same formula as in itemManager.ts)
function getCraftingChance(rarityIndex: number): number {
    const baseChance = 64;
    return baseChance / Math.pow(2, rarityIndex);
}

// Calculate downgrade chance for a mob (1 / (1 + craft chance to that rarity))
// The crafting chance for upgrading TO a rarity is calculated FROM the previous rarity
function getMobDowngradeChance(currentTier: Enemy['tier']): number {
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
function getSpawnZoneType(x: number, y: number): string | null {
    for (const element of WORLD_MAP) {
        if (element.type === 'spawn' && element.properties?.spawnType) {
            const scaledX = x / SCALE_FACTOR;
            const scaledY = y / SCALE_FACTOR;
            
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
function getBiomeAtPosition(x: number, y: number): MapElement | null {
    for (const element of WORLD_MAP) {
        if (element.type === 'biome') {
            const scaledX = x / SCALE_FACTOR;
            const scaledY = y / SCALE_FACTOR;
            
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
function selectSpawnFromBiomeTable(spawnTable: BiomeSpawnEntry[]): { mobType: string | undefined, tier: Enemy['tier'], reversed?: boolean } | null {
    if (!spawnTable || spawnTable.length === 0) return null;
    
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

// Helper function to get random position in a zone type within a specific section (0-8)
// Returns null if no such zone exists in the section
function getRandomPositionInZoneTypeInSection(zoneType: string, section: number): { x: number, y: number } | null {
    if (section < 0 || section > 8) return null;

    const sectionX = section % 3;
    const sectionY = Math.floor(section / 3);

    const sectionMinX = sectionX * SECTION_SIZE;
    const sectionMaxX = (sectionX + 1) * SECTION_SIZE;
    const sectionMinY = sectionY * SECTION_SIZE;
    const sectionMaxY = (sectionY + 1) * SECTION_SIZE;

    // Find zones of the specified type that overlap with this section
    const zonesInSection = WORLD_MAP.filter(element => {
        if (element.type !== 'spawn' || element.properties?.spawnType !== zoneType) {
            return false;
        }

        // Check if zone overlaps with section (convert zone coords to world coords)
        const zoneMinX = element.x * SCALE_FACTOR;
        const zoneMaxX = (element.x + element.width) * SCALE_FACTOR;
        const zoneMinY = element.y * SCALE_FACTOR;
        const zoneMaxY = (element.y + element.height) * SCALE_FACTOR;

        // Check for overlap
        return zoneMinX < sectionMaxX && zoneMaxX > sectionMinX &&
               zoneMinY < sectionMaxY && zoneMaxY > sectionMinY;
    });

    if (zonesInSection.length === 0) return null;

    // Try to find a valid position within the zone AND within the section
    for (let attempt = 0; attempt < 50; attempt++) {
        const zone = zonesInSection[Math.floor(Math.random() * zonesInSection.length)];

        // Calculate the intersection of zone and section
        const zoneMinX = zone.x * SCALE_FACTOR;
        const zoneMaxX = (zone.x + zone.width) * SCALE_FACTOR;
        const zoneMinY = zone.y * SCALE_FACTOR;
        const zoneMaxY = (zone.y + zone.height) * SCALE_FACTOR;

        const intersectMinX = Math.max(zoneMinX, sectionMinX);
        const intersectMaxX = Math.min(zoneMaxX, sectionMaxX);
        const intersectMinY = Math.max(zoneMinY, sectionMinY);
        const intersectMaxY = Math.min(zoneMaxY, sectionMaxY);

        if (intersectMinX >= intersectMaxX || intersectMinY >= intersectMaxY) {
            continue; // No valid intersection
        }

        const x = intersectMinX + Math.random() * (intersectMaxX - intersectMinX);
        const y = intersectMinY + Math.random() * (intersectMaxY - intersectMinY);

        // Ensure position is within world boundaries
        const clampedX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
        const clampedY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));

        // Skip if position is in out-of-bounds zone
        if (isInOutOfBoundsZone(clampedX, clampedY)) {
            continue;
        }

        return { x: clampedX, y: clampedY };
    }

    return null;
}

// Helper function to get random position in a specific zone type
function getRandomPositionInZoneType(zoneType: string): { x: number, y: number } | null {
    const zones = WORLD_MAP.filter(element => 
        element.type === 'spawn' && 
        element.properties?.spawnType === zoneType
    );
    
    if (zones.length === 0) return null;
    
    const zone = zones[Math.floor(Math.random() * zones.length)];
    let x = (zone.x + Math.random() * zone.width) * SCALE_FACTOR;
    let y = (zone.y + Math.random() * zone.height) * SCALE_FACTOR;
    
    // Ensure position is within world boundaries
    x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
    y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));
    
    // Skip if position is in out-of-bounds zone (retry if needed)
    if (isInOutOfBoundsZone(x, y)) {
        // Try one more time with a different zone if available
        if (zones.length > 1) {
            const otherZone = zones.find(z => z !== zone) || zones[0];
            x = (otherZone.x + Math.random() * otherZone.width) * SCALE_FACTOR;
            y = (otherZone.y + Math.random() * otherZone.height) * SCALE_FACTOR;
            x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));
            // If still in out-of-bounds zone, return null
            if (isInOutOfBoundsZone(x, y)) {
                return null;
            }
        } else {
            return null;
        }
    }
    
    return { x, y };
}

// Helper functions that need to be passed from server.ts
export interface EnemySpawnerHelpers {
    getPlayerViewports: () => Array<{x: number, y: number, width: number, height: number}>;
    isPositionInPlayerPetalRange: (x: number, y: number, mobSize: number) => boolean;
    getEnemiesInViewportCount: () => number;
}

/**
 * Create a new enemy at a valid position
 */
export function createEnemy(helpers: EnemySpawnerHelpers): Enemy | null {
    const playerCount = Object.keys(players).length;
    
    // Don't spawn if no players are connected
    if (playerCount === 0) {
        return null as any;
    }
    
    // Calculate target enemy count based on viewport density
    const viewports = helpers.getPlayerViewports();
    const totalViewportArea = viewports.reduce((total, viewport) => {
        const extendedViewport = {
            x: viewport.x - VIEWPORT_BUFFER,
            y: viewport.y - VIEWPORT_BUFFER,
            width: viewport.width + (VIEWPORT_BUFFER * 2),
            height: viewport.height + (VIEWPORT_BUFFER * 2)
        };
        return total + (extendedViewport.width * extendedViewport.height);
    }, 0);
    
    // Calculate target density: same as 9000 enemies across the whole world (9x density)
    const targetDensity = ORIGINAL_ENEMY_COUNT / TOTAL_WORLD_AREA;
    const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
    
    // Don't spawn if we already have enough enemies in viewport
    if (helpers.getEnemiesInViewportCount() >= targetEnemyCount) {
        return null as any;
    }

    let validPosition = false;
    let x = 0, y = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // Increased attempts for viewport-only spawning

    while (!validPosition && attempts < MAX_ATTEMPTS) {
        attempts++;
        
        // Pick a random player and spawn near their viewport
        const randomPlayerId = Object.keys(players)[Math.floor(Math.random() * Object.keys(players).length)];
        const player = players[randomPlayerId];
        
        // Generate position within player's viewport (with buffer)
        const vpW = player.viewportWidth || VIEWPORT_WIDTH;
        const vpH = player.viewportHeight || VIEWPORT_HEIGHT;
        const viewportBuffer = VIEWPORT_BUFFER;
        const minX = player.x - vpW/2 - viewportBuffer;
        const maxX = player.x + vpW/2 + viewportBuffer;
        const minY = player.y - vpH/2 - viewportBuffer;
        const maxY = player.y + vpH/2 + viewportBuffer;

        x = minX + Math.random() * (maxX - minX);
        y = minY + Math.random() * (maxY - minY);

        // Clamp to world boundaries
        x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
        y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));

        // Skip if position is in out-of-bounds zone
        if (isInOutOfBoundsZone(x, y)) {
            continue;
        }

        // Check if position is in a safe zone
        const inSafeZone = WORLD_MAP.some(element =>
            element.type === 'safe_zone' &&
            x >= element.x * SCALE_FACTOR &&
            x <= (element.x + element.width) * SCALE_FACTOR &&
            y >= element.y * SCALE_FACTOR &&
            y <= (element.y + element.height) * SCALE_FACTOR
        );

        // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
        const tileState = getTileState(WALL_GRID, x, y);
        const collidesWithWall = tileState === 1 || tileState === 2;

        if (!inSafeZone && !collidesWithWall) {
            validPosition = true;
        }
    }

    // If we couldn't find a valid position, return null
    if (!validPosition) {
        return null as any;
    }

    // --- Phase 2: Find final position (petal range & mob spacing retries) ---
    // We need a preliminary mob size estimate for spacing checks.
    // Use a common tier size as approximation; the actual mob is selected after position is finalized.
    const PRELIMINARY_MOB_SIZE = 40; // Base mob size for spacing checks

    // Check if the spawn position would overlap with any player's petal range
    if (helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE)) {
        let newValidPosition = false;
        let newAttempts = 0;
        const MAX_NEW_ATTEMPTS = 50;

        while (!newValidPosition && newAttempts < MAX_NEW_ATTEMPTS) {
            newAttempts++;

            const randomPlayerId = Object.keys(players)[Math.floor(Math.random() * Object.keys(players).length)];
            const player = players[randomPlayerId];

            const vpW = player.viewportWidth || VIEWPORT_WIDTH;
            const vpH = player.viewportHeight || VIEWPORT_HEIGHT;
            const viewportBuffer = VIEWPORT_BUFFER;
            const minX = player.x - vpW/2 - viewportBuffer;
            const maxX = player.x + vpW/2 + viewportBuffer;
            const minY = player.y - vpH/2 - viewportBuffer;
            const maxY = player.y + vpH/2 + viewportBuffer;

            x = minX + Math.random() * (maxX - minX);
            y = minY + Math.random() * (maxY - minY);

            x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));

            if (isInOutOfBoundsZone(x, y)) continue;

            const inSafeZone = WORLD_MAP.some(element =>
                element.type === 'safe_zone' &&
                x >= element.x * SCALE_FACTOR &&
                x <= (element.x + element.width) * SCALE_FACTOR &&
                y >= element.y * SCALE_FACTOR &&
                y <= (element.y + element.height) * SCALE_FACTOR
            );
            const tileState = getTileState(WALL_GRID, x, y);
            const collidesWithWall = tileState === 1 || tileState === 2;
            const inPetalRange = helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE);

            if (!inSafeZone && !collidesWithWall && !inPetalRange) {
                newValidPosition = true;
            }
        }

        if (!newValidPosition) {
            return null as any;
        }
    }

    // Check if spawn position is too close to other mobs
    const MIN_MOB_SPAWN_DISTANCE = 80;
    const halfPrelimSize = PRELIMINARY_MOB_SIZE / 2;
    const tooCloseToOtherMob = enemies.some((otherEnemy: Enemy) => {
        const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);
        const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
        const otherHalfSize = otherMobSize / 2;
        const dx = otherEnemy.x - x;
        const dy = otherEnemy.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < halfPrelimSize + otherHalfSize + MIN_MOB_SPAWN_DISTANCE;
    });

    if (tooCloseToOtherMob) {
        let newValidPosition = false;
        let newAttempts = 0;
        const MAX_NEW_ATTEMPTS = 50;

        while (!newValidPosition && newAttempts < MAX_NEW_ATTEMPTS) {
            newAttempts++;

            const randomPlayerId = Object.keys(players)[Math.floor(Math.random() * Object.keys(players).length)];
            const player = players[randomPlayerId];

            const vpW = player.viewportWidth || VIEWPORT_WIDTH;
            const vpH = player.viewportHeight || VIEWPORT_HEIGHT;
            const viewportBuffer = VIEWPORT_BUFFER;
            const minX = player.x - vpW/2 - viewportBuffer;
            const maxX = player.x + vpW/2 + viewportBuffer;
            const minY = player.y - vpH/2 - viewportBuffer;
            const maxY = player.y + vpH/2 + viewportBuffer;

            x = minX + Math.random() * (maxX - minX);
            y = minY + Math.random() * (maxY - minY);

            x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));

            if (isInOutOfBoundsZone(x, y)) continue;

            const inSafeZone = WORLD_MAP.some(element =>
                element.type === 'safe_zone' &&
                x >= element.x * SCALE_FACTOR &&
                x <= (element.x + element.width) * SCALE_FACTOR &&
                y >= element.y * SCALE_FACTOR &&
                y <= (element.y + element.height) * SCALE_FACTOR
            );
            const tileState = getTileState(WALL_GRID, x, y);
            const collidesWithWall = tileState === 1 || tileState === 2;
            const inPetalRange = helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE);
            const tooClose = enemies.some((otherEnemy: Enemy) => {
                const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);
                const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
                const otherHalfSize = otherMobSize / 2;
                const dx = otherEnemy.x - x;
                const dy = otherEnemy.y - y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                return distance < halfPrelimSize + otherHalfSize + MIN_MOB_SPAWN_DISTANCE;
            });

            if (!inSafeZone && !collidesWithWall && !inPetalRange && !tooClose) {
                newValidPosition = true;
            }
        }

        if (!newValidPosition) {
            return null as any;
        }
    }

    // --- Phase 3: Select tier and mob type based on the FINAL position ---
    // Position is now fully finalized - select tier and mob based on where the mob actually is.
    const biome = getBiomeAtPosition(x, y);
    let tier: Enemy['tier'] = 'common';
    let mobType: Enemy['type'];
    let reversed: boolean | undefined = undefined;

    if (biome && biome.properties?.spawnTable && biome.properties.spawnTable.length > 0) {
        // In a biome - use the biome's spawn table
        const spawnSelection = selectSpawnFromBiomeTable(biome.properties.spawnTable);

        if (spawnSelection) {
            tier = spawnSelection.tier;
            reversed = spawnSelection.reversed;

            if (spawnSelection.mobType) {
                mobType = spawnSelection.mobType as Enemy['type'];

                if (mobType === 'target_dummy') {
                    const existingDummy = enemies.find((e: Enemy) => e.type === 'target_dummy' && e.tier === tier);
                    if (existingDummy) {
                        return null as any;
                    }
                }
            } else {
                const allMobTypes = getAllMobTypes();
                if (allMobTypes.length === 0) {
                    return null as any;
                }
                const currentSection = getSectionAtPosition(x, y);
                const eligibleMobTypes = allMobTypes.filter(type => {
                    if (type === 'target_dummy') return false;
                    const stats = getMobStats(type, tier);
                    return stats && stats.section === currentSection;
                });
                if (eligibleMobTypes.length === 0) {
                    return null as any;
                }
                mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)] as Enemy['type'];
            }
        } else {
            const allMobTypes = getAllMobTypes();
            if (allMobTypes.length === 0) {
                return null as any;
            }
            const currentSection = getSectionAtPosition(x, y);
            const eligibleMobTypes = allMobTypes.filter(type => {
                if (type === 'target_dummy') return false;
                const stats = getMobStats(type, 'common');
                return stats && stats.section === currentSection;
            });
            if (eligibleMobTypes.length === 0) {
                return null as any;
            }
            mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)] as Enemy['type'];
        }

        // Tier upgrade or downgrade
        const upgradeRoll = Math.random();
        if (upgradeRoll < 0.02) {
            tier = upgradeTier(tier);
        } else {
            const downgradeChance = getMobDowngradeChance(tier);
            if (downgradeChance > 0 && Math.random() < downgradeChance) {
                tier = downgradeTier(tier);
            }
        }
    } else {
        // Check if position is in a spawn zone
        const spawnZoneType = getSpawnZoneType(x, y);

        if (spawnZoneType) {
            tier = spawnZoneType as Enemy['tier'];
        } else {
            const currentSection = getSectionAtPosition(x, y);

            if (EQUAL_RARITY_SECTIONS.includes(currentSection)) {
                tier = selectEqualRarityTier();
            } else {
                const tierRoll = Math.random();
                let cumulativeProbability = 0;

                for (const [t, data] of Object.entries(ENEMY_TIERS)) {
                    cumulativeProbability += data.probability;
                    if (tierRoll < cumulativeProbability) {
                        tier = t as Enemy['tier'];
                        break;
                    }
                }
            }
        }

        // Tier upgrade or downgrade
        const upgradeRoll = Math.random();
        if (upgradeRoll < 0.02) {
            tier = upgradeTier(tier);
        } else {
            const downgradeChance = getMobDowngradeChance(tier);
            if (downgradeChance > 0 && Math.random() < downgradeChance) {
                tier = downgradeTier(tier);
            }
        }

        // Select mob type - filter to mobs belonging to this section
        const allMobTypes = getAllMobTypes();
        if (allMobTypes.length === 0) {
            return null as any;
        }

        const currentSection = getSectionAtPosition(x, y);
        const eligibleMobTypes = allMobTypes.filter(type => {
            if (type === 'target_dummy') return false;
            const stats = getMobStats(type, tier);
            return stats && stats.section === currentSection;
        });

        if (eligibleMobTypes.length === 0) {
            return null as any;
        }

        mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)] as Enemy['type'];
    }

    // Get mob stats from config
    let mobStats = getMobStats(mobType, tier);
    if (!mobStats) {
        return null as any;
    }

    const currentTime = Date.now();
    const enemy: Enemy = {
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
        lastViewportCheck: currentTime  // Mark as in viewport since we spawned it there
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
 * @param tier - The tier of the mob to create
 * @param helpers - Helper functions for spawning
 * @param targetSection - Optional: specific section (0-8) to spawn in (for super bosses)
 */
export function createSpecialMob(
    tier: 'ultra' | 'super' | 'unique',
    helpers: EnemySpawnerHelpers,
    targetSection?: number
): Enemy | null {
    let zoneType: string;

    if (tier === 'ultra') {
        zoneType = 'legendary';
    } else if (tier === 'super') {
        zoneType = 'mythic';
    } else { // unique
        zoneType = 'mythic';
    }

    let position: { x: number, y: number } | null = null;

    // For super bosses, spawn in the mythic zone within the target section
    if (tier === 'super' && targetSection !== undefined) {
        position = getRandomPositionInZoneTypeInSection('mythic', targetSection);
        // If no mythic zone in this section, don't spawn here
        if (!position) {
            return null;
        }
    } else {
        // For ultra and unique, use zone-based spawning
        position = getRandomPositionInZoneType(zoneType);
    }

    if (!position) {
        console.error(`No valid position found for ${tier} mob spawning`);
        return null;
    }

    // Determine the section for mob type selection
    const spawnSection = getSectionAtPosition(position.x, position.y);

    const allMobTypes = getAllMobTypes();
    if (allMobTypes.length === 0) {
        console.error("No mob types found in MOB_CONFIG.");
        return null;
    }

    // Filter to mobs that belong to this section and exclude target_dummy
    const eligibleMobTypes = allMobTypes.filter(type => {
        if (type === 'target_dummy') {
            return false; // Never spawn target dummies as boss mobs
        }
        const stats = getMobStats(type, tier);
        return stats && stats.section === spawnSection;
    });

    // If no mobs for this section, fall back to any eligible mob
    let mobType: Enemy['type'];
    if (eligibleMobTypes.length === 0) {
        const fallbackMobTypes = allMobTypes.filter(type => type !== 'target_dummy');
        if (fallbackMobTypes.length === 0) {
            console.error("No eligible mob types found for boss spawning (excluding target dummies).");
            return null;
        }
        mobType = fallbackMobTypes[Math.floor(Math.random() * fallbackMobTypes.length)] as Enemy['type'];
    } else {
        mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)] as Enemy['type'];
    }
    const mobStats = getMobStats(mobType, tier);
    
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
export function updateSpecialMobCounts() {
    // Optimize: count in single pass instead of 3 separate filters
    let ultra = 0;
    let super_ = 0;
    let unique = 0;

    // Reset per-section tracking for super mobs
    const activeSuperSections: Set<number> = new Set();

    for (const enemy of enemies) {
        if (enemy.type === 'target_dummy') continue;
        if (enemy.tier === 'ultra') ultra++;
        else if (enemy.tier === 'super') {
            super_++;
            // Track which sections have super bosses
            const section = getSectionAtPosition(enemy.x, enemy.y);
            activeSuperSections.add(section);
            setSuperMobInSection(section, enemy.id);
        }
        else if (enemy.tier === 'unique') unique++;
    }

    // Clear sections that no longer have super bosses
    for (let section = 0; section < 9; section++) {
        if (!activeSuperSections.has(section)) {
            clearSuperMobFromSection(section);
        }
    }

    ultraMobCount.value = ultra;
    superMobCount.value = super_;
    uniqueMobCount.value = unique;
}

/**
 * Function to spawn special mobs
 */
export function spawnSpecialMobs(
    helpers: EnemySpawnerHelpers,
    io: SocketIOServer
) {
    // Update counts first
    updateSpecialMobCounts();

    // Spawn ultra mob if none exists
    if (ultraMobCount.value === 0) {
        const ultraMob = createSpecialMob('ultra', helpers);
        if (ultraMob) {
            enemies.push(ultraMob);
            ultraMobCount.value = 1;
            // Don't send spawn notification for target dummies
            if (ultraMob.type !== 'target_dummy') {
                io.emit('chatMessage', {
                    sender: '',
                    content: `<b style="color: ${ENEMY_TIERS.ultra.color};">An ultra ${ultraMob.type.replace('_', ' ')} has spawned in a legendary zone!</b>`,
                    timestamp: Date.now()
                });
            }
            console.log(`[SERVER] Spawned ultra mob: ${ultraMob.type} at (${ultraMob.x}, ${ultraMob.y})`);
        }
    }

    // Spawn super mob in each section that doesn't have one
    for (let section = 0; section < 9; section++) {
        const existingSuperMobId = getSuperMobInSection(section);
        if (!existingSuperMobId) {
            const superMob = createSpecialMob('super', helpers, section);
            if (superMob) {
                enemies.push(superMob);
                superMobCount.value++;
                setSuperMobInSection(section, superMob.id);

                // Don't send spawn notification for target dummies
                if (superMob.type !== 'target_dummy') {
                    const mobSection = getSectionAtPosition(superMob.x, superMob.y);

                    // Send personalized message to each player based on their section
                    Object.entries(players).forEach(([playerId, player]) => {
                        const playerSection = getSectionAtPosition(player.x, player.y);
                        const isSameSection = playerSection === mobSection;
                        const somewhere = isSameSection ? '' : ' somewhere';

                        io.to(playerId).emit('chatMessage', {
                            sender: '',
                            content: `<b style="color: ${ENEMY_TIERS.super.color};">A super ${superMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
                            timestamp: Date.now()
                        });
                    });
                }
                console.log(`[SERVER] Spawned super mob in section ${section}: ${superMob.type} at (${superMob.x}, ${superMob.y})`);
            }
        }
    }

    // Spawn unique mob with 1/4 chance if any super mob exists
    if (superMobCount.value > 0 && uniqueMobCount.value === 0 && Math.random() < 0.25) {
        const uniqueMob = createSpecialMob('unique', helpers);
        if (uniqueMob) {
            enemies.push(uniqueMob);
            uniqueMobCount.value = 1;
            // Don't send spawn notification for target dummies
            if (uniqueMob.type !== 'target_dummy') {
                const mobSection = getSectionAtPosition(uniqueMob.x, uniqueMob.y);

                // Send personalized message to each player based on their section
                Object.entries(players).forEach(([playerId, player]) => {
                    const playerSection = getSectionAtPosition(player.x, player.y);
                    const isSameSection = playerSection === mobSection;
                    const somewhere = isSameSection ? '' : ' somewhere';

                    io.to(playerId).emit('chatMessage', {
                        sender: '',
                        content: `<b style="color: ${ENEMY_TIERS.unique.color};">A unique ${uniqueMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
                        timestamp: Date.now()
                    });
                });
            }
            console.log(`[SERVER] Spawned unique mob: ${uniqueMob.type} at (${uniqueMob.x}, ${uniqueMob.y})`);
        }
    }
}

