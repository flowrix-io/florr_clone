import { Server as SocketIOServer } from '../ws_server';
import { mobAngle, mobX, mobY } from './mobFields';
import { Enemy, LiveEnemy, isCentipedeHeadType, isCentipedeBodyType, getCentipedeBodyType } from '../server_utils';
import { 
    players
} from '../constants';
import {
    ultraMobCount,
    superMobCount,
    uniqueMobCount,
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
    isTileIdBlocking
} from '../constants';
import { WORLD_MAP, WALL_GRID } from '../map_data';
import { isInMazeRegion } from '../maze';
import { getMobStats, getAllMobTypes, getEnemySizeScale } from '../mobs';
import { recordBossEvent } from './apiKeyApi';
import { calculatePlayerModifiers } from './playerManager';
import {
    upgradeRarity as upgradeTier,
    downgradeRarity as downgradeTier,
    getMobDowngradeChance,
} from './shared/rarity';
import { pickWeighted } from './shared/weighted';
import { markCentipedeHead, spawnEnemy, liveEnemies} from './enemyRegistry';
import { isInOutOfBoundsZone, isWallAt, samplePointInViewport } from './shared/positions';

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
    return pickWeighted(EQUAL_RARITY_TIER_WEIGHTS).tier;
}

// Helper function to select a mob type using spawn_weight for weighted random selection
function selectWeightedMobType(eligibleMobTypes: string[], tier: string): string {
    const pool = eligibleMobTypes.map(type => ({
        type,
        weight: getMobStats(type, tier)?.spawn_weight ?? 1,
    }));
    return pickWeighted(pool).type;
}

// Helper function to get section number (0-8) from world position
const SECTION_SIZE = 20000;
export function getSectionAtPosition(x: number, y: number): number {
    const sectionX = Math.max(0, Math.min(2, Math.floor(x / SECTION_SIZE)));
    const sectionY = Math.max(0, Math.min(2, Math.floor(y / SECTION_SIZE)));
    return sectionY * 3 + sectionX;
}

// Target dummies never despawn and are effectively unkillable, so any duplicate
// that slips through is permanent. Cap them at one of each rarity per section.
function targetDummyExistsInSection(tier: Enemy['tier'], section: number): boolean {
    for (const e of liveEnemies()) {
        if (e.type !== 'target_dummy') continue;
        if (e.tier !== tier) continue;
        if (getSectionAtPosition(mobX(e.entity), mobY(e.entity)) === section) return true;
    }
    return false;
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

// True if position falls in any spawn zone — used to keep the density loop
// out of zones now that the zone manager owns wave-based spawning.
function isPositionInAnySpawnZone(x: number, y: number): boolean {
    return getSpawnZoneType(x, y) !== null;
}

export function getAllSpawnZones(): MapElement[] {
    return WORLD_MAP.filter(el => el.type === 'spawn' && !!el.properties?.spawnType);
}

export function isZoneNearAnyViewport(
    zone: MapElement,
    viewports: Array<{x: number, y: number, width: number, height: number}>
): boolean {
    const zMinX = zone.x * SCALE_FACTOR;
    const zMaxX = (zone.x + zone.width) * SCALE_FACTOR;
    const zMinY = zone.y * SCALE_FACTOR;
    const zMaxY = (zone.y + zone.height) * SCALE_FACTOR;
    for (const v of viewports) {
        const vMinX = v.x - VIEWPORT_BUFFER;
        const vMaxX = v.x + v.width + VIEWPORT_BUFFER;
        const vMinY = v.y - VIEWPORT_BUFFER;
        const vMaxY = v.y + v.height + VIEWPORT_BUFFER;
        if (zMinX < vMaxX && zMaxX > vMinX && zMinY < vMaxY && zMaxY > vMinY) {
            return true;
        }
    }
    return false;
}

export function countMobsInZone(zone: MapElement): number {
    const minX = zone.x * SCALE_FACTOR;
    const maxX = (zone.x + zone.width) * SCALE_FACTOR;
    const minY = zone.y * SCALE_FACTOR;
    const maxY = (zone.y + zone.height) * SCALE_FACTOR;
    let count = 0;
    for (const e of liveEnemies()) {
        if (mobX(e.entity) >= minX && mobX(e.entity) <= maxX && mobY(e.entity) >= minY && mobY(e.entity) <= maxY) count++;
    }
    return count;
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
 * Create a new enemy at a valid position.
 *
 * The mob is ADMITTED here (entity + `liveEnemies()[]`) rather than returned for the
 * caller to push — see server/enemyRegistry.ts. The return value is only for
 * bookkeeping the caller still owns (the ambient-super announcement, spawn
 * counters).
 */
/**
 * Loop-invariant spawn-budget cache.
 *
 * createEnemy is called in BURSTS — the density-maintenance pass runs it up to
 * `3 × playerCount` times (~189 at 63 players), the join pass `5 × playerCount`
 * — and every call used to recompute all three budget inputs from scratch:
 * the viewport list, the target count, and a full `getEnemiesInViewportCount()`
 * scan over every mob in the world. At ~1600 mobs that is ~300k viewport tests
 * per pass to spawn at most 189 mobs, and a CPU profile at 63 players put
 * createEnemy at 4.2% of wall — the largest non-idle cost on the server.
 *
 * None of those inputs can move faster than the viewport cache they are derived
 * from, so they share its TTL. Mobs spawned inside the window are counted in
 * `_spawnedSinceRefresh` so the "already at target" guard still converges
 * mid-burst instead of overshooting to the full requested count.
 */
/**
 * Scratch buffers for the mob-spacing rejection test.
 *
 * `_spacingR2[i]` is the SQUARED rejection radius for `liveEnemies()[i]` — squared so
 * the test is a plain compare against dx²+dy² with no Math.sqrt. Positions are
 * copied in alongside it so the hot loop touches two flat Float64Arrays instead
 * of chasing 1600 object pointers per attempt.
 *
 * Rebuilt once per createEnemy call; the retry loop reuses it across all 50
 * position attempts, which is where the saving is.
 */
let _spacingR2 = new Float64Array(0);
let _spacingX = new Float64Array(0);
let _spacingY = new Float64Array(0);
let _spacingCount = 0;

function buildSpacingRadii(baseRadius: number): void {
    const n = liveEnemies().length;
    if (_spacingR2.length < n) {
        const cap = n + 256;
        _spacingR2 = new Float64Array(cap);
        _spacingX = new Float64Array(cap);
        _spacingY = new Float64Array(cap);
    }
    for (let i = 0; i < n; i++) {
        const e = liveEnemies()[i];
        const stats = getMobStats(e.type, e.tier);
        const otherHalfSize = (stats ? stats.size * 40 : 40) / 2;
        const r = baseRadius + otherHalfSize;
        _spacingR2[i] = r * r;
        _spacingX[i] = mobX(e.entity);
        _spacingY[i] = mobY(e.entity);
    }
    _spacingCount = n;
}

/** Squared-distance form of the original `distance < halfPrelim + otherHalf + MIN` test. */
function isTooCloseToMob(x: number, y: number): boolean {
    for (let i = 0; i < _spacingCount; i++) {
        const dx = _spacingX[i] - x;
        const dy = _spacingY[i] - y;
        if (dx * dx + dy * dy < _spacingR2[i]) return true;
    }
    return false;
}

const SPAWN_BUDGET_TTL_MS = 16;
let _spawnBudgetAt = -1;
let _cachedTargetEnemyCount = 0;
let _cachedViewportEnemies = 0;
let _spawnedSinceRefresh = 0;

export function createEnemy(helpers: EnemySpawnerHelpers): LiveEnemy | null {
    const playerCount = Object.keys(players).length;

    // Don't spawn if no players are connected
    if (playerCount === 0) {
        return null as any;
    }

    const nowMs = Date.now();
    if (nowMs - _spawnBudgetAt >= SPAWN_BUDGET_TTL_MS) {
        _spawnBudgetAt = nowMs;

        // Plain loop, not reduce with an object literal per viewport: the
        // extended box was only ever used for its area, so the intermediate
        // allocation was pure garbage (23 objects × 189 calls per pass).
        const viewports = helpers.getPlayerViewports();
        let totalViewportArea = 0;
        for (let i = 0; i < viewports.length; i++) {
            const v = viewports[i];
            totalViewportArea +=
                (v.width + VIEWPORT_BUFFER * 2) * (v.height + VIEWPORT_BUFFER * 2);
        }

        // Target density: same as 9000 enemies across the whole world (9x density)
        const targetDensity = ORIGINAL_ENEMY_COUNT / TOTAL_WORLD_AREA;
        _cachedTargetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
        _cachedViewportEnemies = helpers.getEnemiesInViewportCount();
        _spawnedSinceRefresh = 0;
    }

    // Don't spawn if we already have enough enemies in viewport
    if (_cachedViewportEnemies + _spawnedSinceRefresh >= _cachedTargetEnemyCount) {
        return null as any;
    }

    // Pick the player with the fewest enemies in their viewport to balance density.
    // Only real (human) players drive spawning — bots shouldn't trigger mob spawns
    // of their own, otherwise the world fills up with enemies per bot. Maze players
    // are excluded too: the maze has its own spawner (mazeSpawner.ts) and their
    // far-away coordinates would only burn spawn attempts here.
    const realPlayerIds = Object.keys(players).filter(id => !id.startsWith('bot_') && !players[id]?.inMaze);
    if (realPlayerIds.length === 0) {
        return null as any;
    }
    let targetPlayerId = realPlayerIds[Math.floor(Math.random() * realPlayerIds.length)];

    if (realPlayerIds.length > 1) {
        let minCount = Infinity;
        for (const pid of realPlayerIds) {
            const p = players[pid];
            if (!p) continue;
            const vpW = p.viewportWidth || VIEWPORT_WIDTH;
            const vpH = p.viewportHeight || VIEWPORT_HEIGHT;
            const minX = p.x - vpW/2 - VIEWPORT_BUFFER;
            const maxX = p.x + vpW/2 + VIEWPORT_BUFFER;
            const minY = p.y - vpH/2 - VIEWPORT_BUFFER;
            const maxY = p.y + vpH/2 + VIEWPORT_BUFFER;
            let count = 0;
            for (const enemy of liveEnemies()) {
                if (mobX(enemy.entity) >= minX && mobX(enemy.entity) <= maxX && mobY(enemy.entity) >= minY && mobY(enemy.entity) <= maxY) {
                    count++;
                }
            }
            if (count < minCount) {
                minCount = count;
                targetPlayerId = pid;
            }
        }
    }

    let validPosition = false;
    let x = 0, y = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // Increased attempts for viewport-only spawning

    while (!validPosition && attempts < MAX_ATTEMPTS) {
        attempts++;

        // Spawn near the player with the lowest mob density
        const player = players[targetPlayerId] || players[realPlayerIds[0]];

        // Generate position within player's viewport (with buffer), clamped to world.
        const point = samplePointInViewport(player);
        x = point.x;
        y = point.y;

        // Skip if position is in out-of-bounds zone
        if (isInOutOfBoundsZone(x, y)) {
            continue;
        }

        // Spawn zones are populated by spawnZoneManager (wave-based), so the
        // density loop must skip them or it would double-fill the area.
        const inSpawnZone = isPositionInAnySpawnZone(x, y);

        if (!isWallAt(x, y) && !inSpawnZone) {
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

            // Use same target player for phase 2 retries
            const player = players[targetPlayerId] || players[realPlayerIds[0]];

            const point = samplePointInViewport(player);
            x = point.x;
            y = point.y;

            if (isInOutOfBoundsZone(x, y)) continue;

            const inPetalRange = helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE);
            const inSpawnZone = isPositionInAnySpawnZone(x, y);

            if (!isWallAt(x, y) && !inPetalRange && !inSpawnZone) {
                newValidPosition = true;
            }
        }

        if (!newValidPosition) {
            return null as any;
        }
    }

    // Ant Hell (section 4) spawn throttle: the section's roster is entirely
    // ants, and their hostile soldiers chase at player speed — at full
    // open-world density they stack up and overwhelm players. Rejecting a
    // fraction of density-loop spawns here settles the section ~30% below the
    // global density target.
    const ANT_HELL_SECTION = 4;
    const ANT_HELL_SPAWN_SCALE = 0.7;
    if (getSectionAtPosition(x, y) === ANT_HELL_SECTION && Math.random() > ANT_HELL_SPAWN_SCALE) {
        return null as any;
    }

    // Check if spawn position is too close to other mobs
    const MIN_MOB_SPAWN_DISTANCE = 80;
    const halfPrelimSize = PRELIMINARY_MOB_SIZE / 2;
    // Rejection radii for every live mob, computed ONCE for this spawn. The
    // retry loop below re-tests up to 50 fresh positions against the same mob
    // set, and the previous form re-derived all ~1600 radii through getMobStats
    // (a dictionary lookup) on every one of those attempts — up to ~81k lookups
    // and ~81k sqrt calls for a single spawn. Profiled at 63 players this was
    // the bulk of createEnemy's 4.2% self time.
    buildSpacingRadii(halfPrelimSize + MIN_MOB_SPAWN_DISTANCE);
    const tooCloseToOtherMob = isTooCloseToMob(x, y);

    if (tooCloseToOtherMob) {
        let newValidPosition = false;
        let newAttempts = 0;
        const MAX_NEW_ATTEMPTS = 50;

        while (!newValidPosition && newAttempts < MAX_NEW_ATTEMPTS) {
            newAttempts++;

            // Use same target player for mob spacing retries
            const player = players[targetPlayerId] || players[realPlayerIds[0]];

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

            const tileState = getTileState(WALL_GRID, x, y);
            const collidesWithWall = isTileIdBlocking(tileState);
            const inPetalRange = helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE);
            const inSpawnZone = isPositionInAnySpawnZone(x, y);
            // Radii were built before the retry loop — same mob set, same values.
            const tooClose = isTooCloseToMob(x, y);

            if (!collidesWithWall && !inPetalRange && !inSpawnZone && !tooClose) {
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

    // The mob is spawning in the spawn zone of the target player (whose viewport drove
    // this spawn). Luck grants +1% tier-upgrade chance per point on top of the base 2%.
    const targetPlayer = players[targetPlayerId];
    const targetLuck = targetPlayer ? (calculatePlayerModifiers(targetPlayer).luck ?? 0) : 0;
    const luckUpgradeBonus = targetLuck * 0.01;

    if (biome && biome.properties?.spawnTable && biome.properties.spawnTable.length > 0) {
        // In a biome - use the biome's spawn table
        const spawnSelection = selectSpawnFromBiomeTable(biome.properties.spawnTable);

        if (spawnSelection) {
            tier = spawnSelection.tier;
            reversed = spawnSelection.reversed;

            if (spawnSelection.mobType) {
                mobType = spawnSelection.mobType as Enemy['type'];
            } else {
                const allMobTypes = getAllMobTypes();
                if (allMobTypes.length === 0) {
                    return null as any;
                }
                const currentSection = getSectionAtPosition(x, y);
                const eligibleMobTypes = allMobTypes.filter(type => {
                    if (type === 'target_dummy') return false;
                    const stats = getMobStats(type, tier);
                    return stats && stats.section.includes(currentSection);
                });
                if (eligibleMobTypes.length === 0) {
                    return null as any;
                }
                mobType = selectWeightedMobType(eligibleMobTypes, tier) as Enemy['type'];
            }
        } else {
            const allMobTypes = getAllMobTypes();
            if (allMobTypes.length === 0) {
                return null as any;
            }
            const currentSection = getSectionAtPosition(x, y);
            const eligibleMobTypes = allMobTypes.filter(type => {
                if (type === 'target_dummy') return false;
                if (isCentipedeBodyType(type)) return false;
                const stats = getMobStats(type, 'common');
                return stats && stats.section.includes(currentSection);
            });
            if (eligibleMobTypes.length === 0) {
                return null as any;
            }
            mobType = selectWeightedMobType(eligibleMobTypes, tier) as Enemy['type'];
        }

        // Tier upgrade or downgrade. Target dummies keep exactly the rarity the
        // biome asked for — drifting off it would produce a rarity the
        // one-per-section check never cleared, and dummies are permanent.
        if (mobType !== 'target_dummy') {
            const upgradeRoll = Math.random();
            if (upgradeRoll < 0.02 + luckUpgradeBonus) {
                tier = upgradeTier(tier);
            } else {
                const downgradeChance = getMobDowngradeChance(tier);
                if (downgradeChance > 0 && Math.random() < downgradeChance) {
                    tier = downgradeTier(tier);
                }
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

        if (spawnZoneType === 'ultra') {
            // Ultra zones spawn exactly 99% ultra and 1% super — no upgrade/
            // downgrade noise. Special-mob bookkeeping for the resulting super
            // (count tracking, chat broadcast, recordBossEvent) is performed by
            // the createEnemy wrapper in server.ts when this returns a super.
            tier = Math.random() < 0.01 ? 'super' : 'ultra';
        } else {
            // Tier upgrade or downgrade
            const upgradeRoll = Math.random();
            if (upgradeRoll < 0.02 + luckUpgradeBonus) {
                tier = upgradeTier(tier);
            } else {
                const downgradeChance = getMobDowngradeChance(tier);
                if (downgradeChance > 0 && Math.random() < downgradeChance) {
                    tier = downgradeTier(tier);
                }
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
            if (isCentipedeBodyType(type)) return false;
            const stats = getMobStats(type, tier);
            return stats && stats.section.includes(currentSection);
        });

        if (eligibleMobTypes.length === 0) {
            return null as any;
        }

        mobType = selectWeightedMobType(eligibleMobTypes, tier) as Enemy['type'];
    }

    // Checked against the FINAL tier, after any upgrade/downgrade roll.
    if (mobType === 'target_dummy' && targetDummyExistsInSection(tier, getSectionAtPosition(x, y))) {
        return null as any;
    }

    // Get mob stats from config
    let mobStats = getMobStats(mobType, tier);
    if (!mobStats) {
        return null as any;
    }

    // Final overlap check using the ACTUAL mob size (Phase 2 used a preliminary estimate)
    const actualMobSize = mobStats.size * 40;
    const actualHalfSize = actualMobSize / 2;
    const overlapsExistingMob = liveEnemies().some((otherEnemy: Enemy) => {
        const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);
        const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
        const otherHalfSize = otherMobSize / 2;
        const dx = mobX(otherEnemy.entity) - x;
        const dy = mobY(otherEnemy.entity) - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < actualHalfSize + otherHalfSize;
    });
    if (overlapsExistingMob) {
        return null as any;
    }

    const enemy = spawnEnemy(mobType, tier, x, y, { reversed });
    if (!enemy) return null as any;

    // Counted against the cached budget above so a burst of calls inside one
    // TTL window stops at the target instead of spawning the full request.
    _spawnedSinceRefresh++;

    // DPS tracking buffers are allocated lazily on first damage event in trackDamage().

    // Chain and cluster spawns come AFTER the parent is admitted, so their
    // leader/hole references resolve to a live entity on the spot instead of
    // waiting for a second linking pass.
    if (isCentipedeHeadType(mobType)) {
        spawnCentipedeBodySegments(enemy);
    }

    // Pre-spawn configured mobs around this one (e.g. ant-hole guardians).
    if (mobStats.initial_spawns && mobStats.initial_spawns.length > 0) {
        spawnInitialSpawns(enemy);
    }

    return enemy;
}

/**
 * Create an enemy inside the given spawn zone. Used by the spawnZoneManager
 * to fill zones during initial spawn / wave / trickle phases.
 *
 * Picks a random position inside zone bounds (rejecting walls, petal range,
 * and mob-spacing conflicts) and then runs the same Phase 3 tier-and-mob-type
 * selection used by createEnemy. Tier comes from the zone's spawnType (or
 * the biome's spawn table if one overlays the zone).
 */
export function createEnemyInZone(
    helpers: EnemySpawnerHelpers,
    zone: MapElement
): LiveEnemy | null {
    const playerCount = Object.keys(players).length;
    if (playerCount === 0) return null;

    const realPlayerIds = Object.keys(players).filter(id => !id.startsWith('bot_'));
    if (realPlayerIds.length === 0) return null;

    // Pick the player closest to the zone center for luck/section attribution.
    const zoneCenterX = (zone.x + zone.width / 2) * SCALE_FACTOR;
    const zoneCenterY = (zone.y + zone.height / 2) * SCALE_FACTOR;
    let targetPlayerId = realPlayerIds[0];
    let bestDist = Infinity;
    for (const pid of realPlayerIds) {
        const p = players[pid];
        if (!p) continue;
        const dx = p.x - zoneCenterX;
        const dy = p.y - zoneCenterY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
            bestDist = d2;
            targetPlayerId = pid;
        }
    }

    const zMinX = zone.x * SCALE_FACTOR;
    const zMaxX = (zone.x + zone.width) * SCALE_FACTOR;
    const zMinY = zone.y * SCALE_FACTOR;
    const zMaxY = (zone.y + zone.height) * SCALE_FACTOR;

    const PRELIMINARY_MOB_SIZE = 40;
    const MIN_MOB_SPAWN_DISTANCE = 80;
    const halfPrelimSize = PRELIMINARY_MOB_SIZE / 2;
    const MAX_ATTEMPTS = 60;

    let x = 0;
    let y = 0;
    let validPosition = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        x = zMinX + Math.random() * (zMaxX - zMinX);
        y = zMinY + Math.random() * (zMaxY - zMinY);
        x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
        y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));

        if (isInOutOfBoundsZone(x, y)) continue;

        const tileState = getTileState(WALL_GRID, x, y);
        if (isTileIdBlocking(tileState)) continue;

        if (helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE)) continue;

        const tooClose = liveEnemies().some((otherEnemy: Enemy) => {
            const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);
            const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
            const otherHalfSize = otherMobSize / 2;
            const dx = mobX(otherEnemy.entity) - x;
            const dy = mobY(otherEnemy.entity) - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance < halfPrelimSize + otherHalfSize + MIN_MOB_SPAWN_DISTANCE;
        });
        if (tooClose) continue;

        validPosition = true;
        break;
    }

    if (!validPosition) return null;

    // --- Phase 3: tier + mob type, mirroring createEnemy's logic ---
    const biome = getBiomeAtPosition(x, y);
    let tier: Enemy['tier'] = 'common';
    let mobType: Enemy['type'];
    let reversed: boolean | undefined = undefined;

    const targetPlayer = players[targetPlayerId];
    const targetLuck = targetPlayer ? (calculatePlayerModifiers(targetPlayer).luck ?? 0) : 0;
    const luckUpgradeBonus = targetLuck * 0.01;

    if (biome && biome.properties?.spawnTable && biome.properties.spawnTable.length > 0) {
        const spawnSelection = selectSpawnFromBiomeTable(biome.properties.spawnTable);
        if (spawnSelection) {
            tier = spawnSelection.tier;
            reversed = spawnSelection.reversed;

            if (spawnSelection.mobType) {
                mobType = spawnSelection.mobType as Enemy['type'];
            } else {
                const allMobTypes = getAllMobTypes();
                if (allMobTypes.length === 0) return null;
                const currentSection = getSectionAtPosition(x, y);
                const eligibleMobTypes = allMobTypes.filter(type => {
                    if (type === 'target_dummy') return false;
                    const stats = getMobStats(type, tier);
                    return stats && stats.section.includes(currentSection);
                });
                if (eligibleMobTypes.length === 0) return null;
                mobType = selectWeightedMobType(eligibleMobTypes, tier) as Enemy['type'];
            }
        } else {
            const allMobTypes = getAllMobTypes();
            if (allMobTypes.length === 0) return null;
            const currentSection = getSectionAtPosition(x, y);
            const eligibleMobTypes = allMobTypes.filter(type => {
                if (type === 'target_dummy') return false;
                if (isCentipedeBodyType(type)) return false;
                const stats = getMobStats(type, 'common');
                return stats && stats.section.includes(currentSection);
            });
            if (eligibleMobTypes.length === 0) return null;
            mobType = selectWeightedMobType(eligibleMobTypes, tier) as Enemy['type'];
        }

        // Target dummies keep the biome's exact rarity (see createEnemy).
        if (mobType !== 'target_dummy') {
            const upgradeRoll = Math.random();
            if (upgradeRoll < 0.02 + luckUpgradeBonus) {
                tier = upgradeTier(tier);
            } else {
                const downgradeChance = getMobDowngradeChance(tier);
                if (downgradeChance > 0 && Math.random() < downgradeChance) {
                    tier = downgradeTier(tier);
                }
            }
        }
    } else {
        // Force the explicit zone we were asked to spawn for, so overlapping
        // zones don't get cross-tier spawns from getSpawnZoneType's first-match.
        tier = (zone.properties?.spawnType ?? 'common') as Enemy['tier'];

        if (tier === 'ultra') {
            tier = Math.random() < 0.01 ? 'super' : 'ultra';
        } else {
            const upgradeRoll = Math.random();
            if (upgradeRoll < 0.02 + luckUpgradeBonus) {
                tier = upgradeTier(tier);
            } else {
                const downgradeChance = getMobDowngradeChance(tier);
                if (downgradeChance > 0 && Math.random() < downgradeChance) {
                    tier = downgradeTier(tier);
                }
            }
        }

        const allMobTypes = getAllMobTypes();
        if (allMobTypes.length === 0) return null;
        const currentSection = getSectionAtPosition(x, y);
        const eligibleMobTypes = allMobTypes.filter(type => {
            if (type === 'target_dummy') return false;
            if (isCentipedeBodyType(type)) return false;
            const stats = getMobStats(type, tier);
            return stats && stats.section.includes(currentSection);
        });
        if (eligibleMobTypes.length === 0) return null;
        mobType = selectWeightedMobType(eligibleMobTypes, tier) as Enemy['type'];
    }

    // Checked against the FINAL tier, after any upgrade/downgrade roll.
    if (mobType === 'target_dummy' && targetDummyExistsInSection(tier, getSectionAtPosition(x, y))) {
        return null;
    }

    const mobStats = getMobStats(mobType, tier);
    if (!mobStats) return null;

    const actualMobSize = mobStats.size * 40;
    const actualHalfSize = actualMobSize / 2;
    const overlapsExistingMob = liveEnemies().some((otherEnemy: Enemy) => {
        const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);
        const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
        const otherHalfSize = otherMobSize / 2;
        const dx = mobX(otherEnemy.entity) - x;
        const dy = mobY(otherEnemy.entity) - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < actualHalfSize + otherHalfSize;
    });
    if (overlapsExistingMob) return null;

    const enemy = spawnEnemy(mobType, tier, x, y, { reversed });
    if (!enemy) return null;

    // DPS tracking buffers are allocated lazily on first damage event in trackDamage().

    if (isCentipedeHeadType(mobType)) {
        spawnCentipedeBodySegments(enemy);
    }

    if (mobStats.initial_spawns && mobStats.initial_spawns.length > 0) {
        spawnInitialSpawns(enemy);
    }

    return enemy;
}

/**
 * Spawn the cluster of mobs declared in the parent's `initial_spawns` around
 * it, so mobs like ant holes are guarded the moment they appear.
 */
export function spawnInitialSpawns(parent: LiveEnemy): LiveEnemy[] {
    const children: LiveEnemy[] = [];
    const parentStats = getMobStats(parent.type, parent.tier);
    if (!parentStats || !parentStats.initial_spawns) return children;
    const parentRadius = (parentStats.size * 40) / 2;

    // `parent` is a LiveEnemy, which is the type-level statement that it has
    // already been admitted — so each child's HoleTether resolves immediately.
    for (const childType of parentStats.initial_spawns) {
        const angle = Math.random() * Math.PI * 2;
        const dist = parentRadius + 30 + Math.random() * parentRadius;
        const child = spawnEnemy(
            childType,
            parent.tier,
            mobX(parent.entity) + Math.cos(angle) * dist,
            mobY(parent.entity) + Math.sin(angle) * dist,
            { parentHoleId: parent.id },
        );
        if (child) children.push(child);
    }
    return children;
}

/**
 * Attach the body-segment chain to a centipede head. Used by every centipede
 * spawn path (natural spawn, admin command, egg/pet spawn) so the head never
 * appears alone.
 */
export function spawnCentipedeBodySegments(head: LiveEnemy): LiveEnemy[] {
    const segments: LiveEnemy[] = [];
    // Stamps the head's own chain fields on BOTH representations. The chain
    // passes are ECS-owned now, so setting only the legacy fields would leave
    // the head out of its own chain.
    markCentipedeHead(head);
    const bodyType = getCentipedeBodyType(head.type);
    const bodyStats = getMobStats(bodyType, head.tier);
    if (!bodyStats) return segments;

    const segmentCount = 9; // head + 9 body = 10 total
    // Segments inherit the head's ownership, so a pet chain lays out at the
    // pet size scale — same spacing formula the follow pass uses each tick.
    const segmentSize = bodyStats.size * 40 * getEnemySizeScale(!!head.ownerId, head.tier, bodyType, head.id);
    const spacing = segmentSize * 0.9;
    const dirX = -Math.cos(mobAngle(head.entity));
    const dirY = -Math.sin(mobAngle(head.entity));

    let prevId = head.id;
    let prevX = mobX(head.entity);
    let prevY = mobY(head.entity);

    for (let i = 1; i <= segmentCount; i++) {
        const segX = prevX + dirX * spacing;
        const segY = prevY + dirY * spacing;
        // Facing is passed in rather than patched on afterwards: the entity's
        // Angle is written at construction, so a post-spawn `segment.angle = ...`
        // would only move the legacy half and the chain would start out bent.
        const segment = spawnEnemy(bodyType, head.tier, segX, segY, {
            angle: mobAngle(head.entity),
            // undefined for wild centipedes, set for pet ones — either way the key exists.
            ownerId: head.ownerId,
            leaderId: prevId,
            headId: head.id,
            segmentIndex: i,
        });
        if (!segment) break;
        segments.push(segment);
        prevId = segment.id;
        prevX = segX;
        prevY = segY;
    }
    return segments;
}

/**
 * Function to create special mobs (ultra, super, unique)
 * @param tier - The tier of the mob to create
 * @param helpers - Helper functions for spawning
 * @param targetSection - Optional: specific section (0-8) to spawn in (for super bosses)
 * @param acceptPosition - Last-moment veto on the FINAL position, evaluated just
 *   before the mob is admitted. `spawnSpecialMobs` used to run this check on the
 *   returned mob and drop it if the destination section already had a super —
 *   which, now that creation also creates an entity, would leak one. The check
 *   only ever looked at the position, so it moves in front of construction.
 */
export function createSpecialMob(
    tier: 'ultra' | 'super' | 'unique',
    helpers: EnemySpawnerHelpers,
    targetSection?: number,
    acceptPosition?: (x: number, y: number) => boolean,
): LiveEnemy | null {
    let zoneType: string;

    if (tier === 'ultra') {
        // Ultras spawn in zones explicitly tagged as ultra spawn zones.
        zoneType = 'ultra';
    } else if (tier === 'super') {
        // 75% of supers spawn in ultra zones, 25% in mythic zones.
        zoneType = Math.random() < 0.75 ? 'ultra' : 'mythic';
    } else { // unique
        // Uniques spawn exclusively in ultra zones.
        zoneType = 'ultra';
    }

    let position: { x: number, y: number } | null = null;

    if (tier === 'super' && targetSection !== undefined) {
        // Mythic supers stay section-bound (existing behaviour). Ultra-zone supers
        // are not section-bound — there's no guarantee that an ultra zone exists
        // in every section, so we just pick from any ultra zone.
        if (zoneType === 'mythic') {
            position = getRandomPositionInZoneTypeInSection('mythic', targetSection);
        } else {
            position = getRandomPositionInZoneType('ultra');
        }
        // Fall back to the other zone type if the preferred one isn't available
        // here, so a half-configured map still spawns supers somewhere.
        if (!position) {
            position = zoneType === 'mythic'
                ? getRandomPositionInZoneType('ultra')
                : getRandomPositionInZoneTypeInSection('mythic', targetSection);
        }
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
        return stats && stats.section.includes(spawnSection);
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
        mobType = selectWeightedMobType(eligibleMobTypes, tier) as Enemy['type'];
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

    // Final overlap check with existing mobs using actual size
    const halfMobSize = mobSize / 2;
    const overlapsExistingMob = liveEnemies().some((otherEnemy: Enemy) => {
        const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);
        const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
        const otherHalfSize = otherMobSize / 2;
        const dx = mobX(otherEnemy.entity) - position.x;
        const dy = mobY(otherEnemy.entity) - position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < halfMobSize + otherHalfSize;
    });
    if (overlapsExistingMob) {
        return null;
    }

    // The position is final from here on, so this is where the caller's veto runs.
    if (acceptPosition && !acceptPosition(position.x, position.y)) {
        return null;
    }

    // `bossWireShape` preserves the historical key set: special mobs omit
    // `reversed` and `lastViewportCheck`, and undefined fields are dropped by
    // JSON.stringify, so concrete defaults would add keys to every boss packet
    // (see the makeEnemy docstring).
    return spawnEnemy(mobType, tier, position.x, position.y, { bossWireShape: true });
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

    for (const enemy of liveEnemies()) {
        if (enemy.type === 'target_dummy') continue;
        // Maze bosses are managed by mazeSpawner — counting them here would
        // suppress the main world's ultra/super spawns while the maze is
        // populated.
        if (isInMazeRegion(mobX(enemy.entity), mobY(enemy.entity))) continue;
        if (enemy.tier === 'ultra') ultra++;
        else if (enemy.tier === 'super') {
            super_++;
            // Track which sections have super bosses
            const section = getSectionAtPosition(mobX(enemy.entity), mobY(enemy.entity));
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

    // Spawn ultra mob if none exists. Ultras spawn silently — no chat broadcast.
    if (ultraMobCount.value === 0) {
        const ultraMob = createSpecialMob('ultra', helpers);
        if (ultraMob) {
            ultraMobCount.value = 1;
            console.log(`[SERVER] Spawned ultra mob: ${ultraMob.type} at (${mobX(ultraMob.entity)}, ${mobY(ultraMob.entity)})`);
        }
    }

    // Spawn super mob in each section that doesn't have one. Supers land in
    // either ultra zones (75%) or mythic zones (25%); since ultra zones aren't
    // section-bound, an iteration's spawn may land in a different section than
    // the one we're filling. The attempt is abandoned if the destination section
    // is already covered, which prevents many supers from piling into the same
    // ultra zone when several sections happen to roll the ultra branch.
    for (let section = 0; section < 9; section++) {
        const existingSuperMobId = getSuperMobInSection(section);
        if (!existingSuperMobId) {
            // The destination-section check is a veto on the POSITION, run
            // before the mob is built — dropping an already-admitted boss would
            // leave its entity behind.
            const superMob = createSpecialMob(
                'super', helpers, section,
                (x, y) => !getSuperMobInSection(getSectionAtPosition(x, y)),
            );
            if (superMob) {
                const mobSection = getSectionAtPosition(mobX(superMob.entity), mobY(superMob.entity));
                superMobCount.value++;
                setSuperMobInSection(mobSection, superMob.id);

                // Don't send spawn notification for target dummies
                if (superMob.type !== 'target_dummy') {
                    const spawnTimestamp = Date.now();

                    // Send personalized message to each player based on their section
                    Object.entries(players).forEach(([playerId, player]) => {
                        const playerSection = getSectionAtPosition(player.x, player.y);
                        const isSameSection = playerSection === mobSection;
                        const somewhere = isSameSection ? '' : ' somewhere';

                        io.to(playerId).emit('chatMessage', {
                            sender: '',
                            content: `<b style="color: ${ENEMY_TIERS.super.color};">A super ${superMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
                            timestamp: spawnTimestamp
                        });
                    });

                    recordBossEvent({
                        type: 'spawn',
                        tier: 'super',
                        mobType: superMob.type,
                        x: mobX(superMob.entity),
                        y: mobY(superMob.entity),
                        timestamp: spawnTimestamp,
                        message: `A super ${superMob.type.replace('_', ' ')} has spawned!`
                    });
                }
                console.log(`[SERVER] Spawned super mob in section ${section}: ${superMob.type} at (${mobX(superMob.entity)}, ${mobY(superMob.entity)})`);
            }
        }
    }

    // Spawn unique mob with 1/4 chance if any super mob exists
    if (superMobCount.value > 0 && uniqueMobCount.value === 0 && Math.random() < 0.25) {
        const uniqueMob = createSpecialMob('unique', helpers);
        if (uniqueMob) {
            uniqueMobCount.value = 1;
            // Don't send spawn notification for target dummies
            if (uniqueMob.type !== 'target_dummy') {
                const mobSection = getSectionAtPosition(mobX(uniqueMob.entity), mobY(uniqueMob.entity));
                const spawnTimestamp = Date.now();

                // Send personalized message to each player based on their section
                Object.entries(players).forEach(([playerId, player]) => {
                    const playerSection = getSectionAtPosition(player.x, player.y);
                    const isSameSection = playerSection === mobSection;
                    const somewhere = isSameSection ? '' : ' somewhere';

                    io.to(playerId).emit('chatMessage', {
                        sender: '',
                        content: `<b style="color: ${ENEMY_TIERS.unique.color};">A unique ${uniqueMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
                        timestamp: spawnTimestamp
                    });
                });

                recordBossEvent({
                    type: 'spawn',
                    tier: 'unique',
                    mobType: uniqueMob.type,
                    x: mobX(uniqueMob.entity),
                    y: mobY(uniqueMob.entity),
                    timestamp: spawnTimestamp,
                    message: `A unique ${uniqueMob.type.replace('_', ' ')} has spawned!`
                });
            }
            console.log(`[SERVER] Spawned unique mob: ${uniqueMob.type} at (${mobX(uniqueMob.entity)}, ${mobY(uniqueMob.entity)})`);
        }
    }
}

