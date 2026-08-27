"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EQUAL_RARITY_SECTIONS = void 0;
exports.getSectionAtPosition = getSectionAtPosition;
exports.getAllSpawnZones = getAllSpawnZones;
exports.isZoneNearAnyViewport = isZoneNearAnyViewport;
exports.countMobsInZone = countMobsInZone;
exports.createEnemy = createEnemy;
exports.createEnemyInZone = createEnemyInZone;
exports.spawnInitialSpawns = spawnInitialSpawns;
exports.spawnCentipedeBodySegments = spawnCentipedeBodySegments;
exports.createSpecialMob = createSpecialMob;
exports.updateSpecialMobCounts = updateSpecialMobCounts;
exports.spawnSpecialMobs = spawnSpecialMobs;
const mobFields_1 = require("./mobFields");
const server_utils_1 = require("../server_utils");
const constants_1 = require("../constants");
const gameState_1 = require("./gameState");
const constants_2 = require("../constants");
const map_data_1 = require("../map_data");
const maze_1 = require("../maze");
const mobs_1 = require("../mobs");
const apiKeyApi_1 = require("./apiKeyApi");
const playerManager_1 = require("./playerManager");
const rarity_1 = require("./shared/rarity");
const weighted_1 = require("./shared/weighted");
const enemyRegistry_1 = require("./enemyRegistry");
const positions_1 = require("./shared/positions");
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
/** Base chance for a spawning mob to drift one tier up, before luck. */
const TIER_UPGRADE_CHANCE = 0.02;
/**
 * Rolls a spawning mob's tier one step up or down, or leaves it alone.
 *
 * Four identical copies of this roll lived across createEnemy and
 * createEnemyInZone, each with the 0.02 base chance written out by hand.
 * An upgrade is tried first; only if it misses is a downgrade rolled, so the
 * two can never both apply.
 */
function rollTierDrift(tier, luckUpgradeBonus) {
    if (Math.random() < TIER_UPGRADE_CHANCE + luckUpgradeBonus) {
        return (0, rarity_1.upgradeRarity)(tier);
    }
    const downgradeChance = (0, rarity_1.getMobDowngradeChance)(tier);
    if (downgradeChance > 0 && Math.random() < downgradeChance) {
        return (0, rarity_1.downgradeRarity)(tier);
    }
    return tier;
}
function selectEqualRarityTier() {
    return (0, weighted_1.pickWeighted)(EQUAL_RARITY_TIER_WEIGHTS).tier;
}
// Helper function to select a mob type using spawn_weight for weighted random selection
function selectWeightedMobType(eligibleMobTypes, tier) {
    const pool = eligibleMobTypes.map(type => ({
        type,
        weight: (0, mobs_1.getMobStats)(type, tier)?.spawn_weight ?? 1,
    }));
    return (0, weighted_1.pickWeighted)(pool).type;
}
// Helper function to get section number (0-8) from world position
const SECTION_SIZE = 20000;
function getSectionAtPosition(x, y) {
    const sectionX = Math.max(0, Math.min(2, Math.floor(x / SECTION_SIZE)));
    const sectionY = Math.max(0, Math.min(2, Math.floor(y / SECTION_SIZE)));
    return sectionY * 3 + sectionX;
}
// Target dummies never despawn and are effectively unkillable, so any duplicate
// that slips through is permanent. Cap them at one of each rarity per section.
function targetDummyExistsInSection(tier, section) {
    for (const e of (0, enemyRegistry_1.liveEnemies)()) {
        if (e.type !== 'target_dummy')
            continue;
        if (e.tier !== tier)
            continue;
        if (getSectionAtPosition((0, mobFields_1.mobX)(e.entity), (0, mobFields_1.mobY)(e.entity)) === section)
            return true;
    }
    return false;
}
// Helper function to get spawn zone type for a given position
function getSpawnZoneType(x, y) {
    for (const element of map_data_1.WORLD_MAP) {
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
// True if position falls in any spawn zone — used to keep the density loop
// out of zones now that the zone manager owns wave-based spawning.
function isPositionInAnySpawnZone(x, y) {
    return getSpawnZoneType(x, y) !== null;
}
function getAllSpawnZones() {
    return map_data_1.WORLD_MAP.filter(el => el.type === 'spawn' && !!el.properties?.spawnType);
}
function isZoneNearAnyViewport(zone, viewports) {
    const zMinX = zone.x * constants_2.SCALE_FACTOR;
    const zMaxX = (zone.x + zone.width) * constants_2.SCALE_FACTOR;
    const zMinY = zone.y * constants_2.SCALE_FACTOR;
    const zMaxY = (zone.y + zone.height) * constants_2.SCALE_FACTOR;
    for (const v of viewports) {
        const vMinX = v.x - constants_2.VIEWPORT_BUFFER;
        const vMaxX = v.x + v.width + constants_2.VIEWPORT_BUFFER;
        const vMinY = v.y - constants_2.VIEWPORT_BUFFER;
        const vMaxY = v.y + v.height + constants_2.VIEWPORT_BUFFER;
        if (zMinX < vMaxX && zMaxX > vMinX && zMinY < vMaxY && zMaxY > vMinY) {
            return true;
        }
    }
    return false;
}
function countMobsInZone(zone) {
    const minX = zone.x * constants_2.SCALE_FACTOR;
    const maxX = (zone.x + zone.width) * constants_2.SCALE_FACTOR;
    const minY = zone.y * constants_2.SCALE_FACTOR;
    const maxY = (zone.y + zone.height) * constants_2.SCALE_FACTOR;
    let count = 0;
    for (const e of (0, enemyRegistry_1.liveEnemies)()) {
        if ((0, mobFields_1.mobX)(e.entity) >= minX && (0, mobFields_1.mobX)(e.entity) <= maxX && (0, mobFields_1.mobY)(e.entity) >= minY && (0, mobFields_1.mobY)(e.entity) <= maxY)
            count++;
    }
    return count;
}
// Helper function to get biome at a given position
function getBiomeAtPosition(x, y) {
    for (const element of map_data_1.WORLD_MAP) {
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
// Helper function to get random position in a zone type within a specific section (0-8)
// Returns null if no such zone exists in the section
function getRandomPositionInZoneTypeInSection(zoneType, section) {
    if (section < 0 || section > 8)
        return null;
    const sectionX = section % 3;
    const sectionY = Math.floor(section / 3);
    const sectionMinX = sectionX * SECTION_SIZE;
    const sectionMaxX = (sectionX + 1) * SECTION_SIZE;
    const sectionMinY = sectionY * SECTION_SIZE;
    const sectionMaxY = (sectionY + 1) * SECTION_SIZE;
    // Find zones of the specified type that overlap with this section
    const zonesInSection = map_data_1.WORLD_MAP.filter(element => {
        if (element.type !== 'spawn' || element.properties?.spawnType !== zoneType) {
            return false;
        }
        // Check if zone overlaps with section (convert zone coords to world coords)
        const zoneMinX = element.x * constants_2.SCALE_FACTOR;
        const zoneMaxX = (element.x + element.width) * constants_2.SCALE_FACTOR;
        const zoneMinY = element.y * constants_2.SCALE_FACTOR;
        const zoneMaxY = (element.y + element.height) * constants_2.SCALE_FACTOR;
        // Check for overlap
        return zoneMinX < sectionMaxX && zoneMaxX > sectionMinX &&
            zoneMinY < sectionMaxY && zoneMaxY > sectionMinY;
    });
    if (zonesInSection.length === 0)
        return null;
    // Try to find a valid position within the zone AND within the section
    for (let attempt = 0; attempt < 50; attempt++) {
        const zone = zonesInSection[Math.floor(Math.random() * zonesInSection.length)];
        // Calculate the intersection of zone and section
        const zoneMinX = zone.x * constants_2.SCALE_FACTOR;
        const zoneMaxX = (zone.x + zone.width) * constants_2.SCALE_FACTOR;
        const zoneMinY = zone.y * constants_2.SCALE_FACTOR;
        const zoneMaxY = (zone.y + zone.height) * constants_2.SCALE_FACTOR;
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
        const clampedX = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
        const clampedY = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
        // Skip if position is in out-of-bounds zone
        if ((0, positions_1.isInOutOfBoundsZone)(clampedX, clampedY)) {
            continue;
        }
        return { x: clampedX, y: clampedY };
    }
    return null;
}
// Helper function to get random position in a specific zone type
function getRandomPositionInZoneType(zoneType) {
    const zones = map_data_1.WORLD_MAP.filter(element => element.type === 'spawn' &&
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
    if ((0, positions_1.isInOutOfBoundsZone)(x, y)) {
        // Try one more time with a different zone if available
        if (zones.length > 1) {
            const otherZone = zones.find(z => z !== zone) || zones[0];
            x = (otherZone.x + Math.random() * otherZone.width) * constants_2.SCALE_FACTOR;
            y = (otherZone.y + Math.random() * otherZone.height) * constants_2.SCALE_FACTOR;
            x = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
            // If still in out-of-bounds zone, return null
            if ((0, positions_1.isInOutOfBoundsZone)(x, y)) {
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
function buildSpacingRadii(baseRadius) {
    const n = (0, enemyRegistry_1.liveEnemies)().length;
    if (_spacingR2.length < n) {
        const cap = n + 256;
        _spacingR2 = new Float64Array(cap);
        _spacingX = new Float64Array(cap);
        _spacingY = new Float64Array(cap);
    }
    for (let i = 0; i < n; i++) {
        const e = (0, enemyRegistry_1.liveEnemies)()[i];
        const stats = (0, mobs_1.getMobStats)(e.type, e.tier);
        const otherHalfSize = (stats ? stats.size * 40 : 40) / 2;
        const r = baseRadius + otherHalfSize;
        _spacingR2[i] = r * r;
        _spacingX[i] = (0, mobFields_1.mobX)(e.entity);
        _spacingY[i] = (0, mobFields_1.mobY)(e.entity);
    }
    _spacingCount = n;
}
/** Squared-distance form of the original `distance < halfPrelim + otherHalf + MIN` test. */
function isTooCloseToMob(x, y) {
    for (let i = 0; i < _spacingCount; i++) {
        const dx = _spacingX[i] - x;
        const dy = _spacingY[i] - y;
        if (dx * dx + dy * dy < _spacingR2[i])
            return true;
    }
    return false;
}
const SPAWN_BUDGET_TTL_MS = 16;
let _spawnBudgetAt = -1;
let _cachedTargetEnemyCount = 0;
let _cachedViewportEnemies = 0;
let _spawnedSinceRefresh = 0;
function createEnemy(helpers) {
    const playerCount = Object.keys(constants_1.players).length;
    // Don't spawn if no players are connected
    if (playerCount === 0) {
        return null;
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
                (v.width + constants_2.VIEWPORT_BUFFER * 2) * (v.height + constants_2.VIEWPORT_BUFFER * 2);
        }
        // Target density: same as 9000 enemies across the whole world (9x density)
        const targetDensity = constants_2.ORIGINAL_ENEMY_COUNT / constants_2.TOTAL_WORLD_AREA;
        _cachedTargetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
        _cachedViewportEnemies = helpers.getEnemiesInViewportCount();
        _spawnedSinceRefresh = 0;
    }
    // Don't spawn if we already have enough enemies in viewport
    if (_cachedViewportEnemies + _spawnedSinceRefresh >= _cachedTargetEnemyCount) {
        return null;
    }
    // Pick the player with the fewest enemies in their viewport to balance density.
    // Only real (human) players drive spawning — bots shouldn't trigger mob spawns
    // of their own, otherwise the world fills up with enemies per bot. Maze players
    // are excluded too: the maze has its own spawner (mazeSpawner.ts) and their
    // far-away coordinates would only burn spawn attempts here.
    const realPlayerIds = Object.keys(constants_1.players).filter(id => !id.startsWith('bot_') && !constants_1.players[id]?.inMaze);
    if (realPlayerIds.length === 0) {
        return null;
    }
    let targetPlayerId = realPlayerIds[Math.floor(Math.random() * realPlayerIds.length)];
    if (realPlayerIds.length > 1) {
        let minCount = Infinity;
        for (const pid of realPlayerIds) {
            const p = constants_1.players[pid];
            if (!p)
                continue;
            const vpW = p.viewportWidth || constants_2.VIEWPORT_WIDTH;
            const vpH = p.viewportHeight || constants_2.VIEWPORT_HEIGHT;
            const minX = p.x - vpW / 2 - constants_2.VIEWPORT_BUFFER;
            const maxX = p.x + vpW / 2 + constants_2.VIEWPORT_BUFFER;
            const minY = p.y - vpH / 2 - constants_2.VIEWPORT_BUFFER;
            const maxY = p.y + vpH / 2 + constants_2.VIEWPORT_BUFFER;
            let count = 0;
            for (const enemy of (0, enemyRegistry_1.liveEnemies)()) {
                if ((0, mobFields_1.mobX)(enemy.entity) >= minX && (0, mobFields_1.mobX)(enemy.entity) <= maxX && (0, mobFields_1.mobY)(enemy.entity) >= minY && (0, mobFields_1.mobY)(enemy.entity) <= maxY) {
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
        const player = constants_1.players[targetPlayerId] || constants_1.players[realPlayerIds[0]];
        // Generate position within player's viewport (with buffer), clamped to world.
        const point = (0, positions_1.samplePointInViewport)(player);
        x = point.x;
        y = point.y;
        // Skip if position is in out-of-bounds zone
        if ((0, positions_1.isInOutOfBoundsZone)(x, y)) {
            continue;
        }
        // Spawn zones are populated by spawnZoneManager (wave-based), so the
        // density loop must skip them or it would double-fill the area.
        const inSpawnZone = isPositionInAnySpawnZone(x, y);
        if (!(0, positions_1.isWallAt)(x, y) && !inSpawnZone) {
            validPosition = true;
        }
    }
    // If we couldn't find a valid position, return null
    if (!validPosition) {
        return null;
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
            const player = constants_1.players[targetPlayerId] || constants_1.players[realPlayerIds[0]];
            const point = (0, positions_1.samplePointInViewport)(player);
            x = point.x;
            y = point.y;
            if ((0, positions_1.isInOutOfBoundsZone)(x, y))
                continue;
            const inPetalRange = helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE);
            const inSpawnZone = isPositionInAnySpawnZone(x, y);
            if (!(0, positions_1.isWallAt)(x, y) && !inPetalRange && !inSpawnZone) {
                newValidPosition = true;
            }
        }
        if (!newValidPosition) {
            return null;
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
        return null;
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
            const player = constants_1.players[targetPlayerId] || constants_1.players[realPlayerIds[0]];
            const vpW = player.viewportWidth || constants_2.VIEWPORT_WIDTH;
            const vpH = player.viewportHeight || constants_2.VIEWPORT_HEIGHT;
            const viewportBuffer = constants_2.VIEWPORT_BUFFER;
            const minX = player.x - vpW / 2 - viewportBuffer;
            const maxX = player.x + vpW / 2 + viewportBuffer;
            const minY = player.y - vpH / 2 - viewportBuffer;
            const maxY = player.y + vpH / 2 + viewportBuffer;
            x = minX + Math.random() * (maxX - minX);
            y = minY + Math.random() * (maxY - minY);
            x = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
            if ((0, positions_1.isInOutOfBoundsZone)(x, y))
                continue;
            const tileState = (0, constants_2.getTileState)(map_data_1.WALL_GRID, x, y);
            const collidesWithWall = (0, constants_2.isTileIdBlocking)(tileState);
            const inPetalRange = helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE);
            const inSpawnZone = isPositionInAnySpawnZone(x, y);
            // Radii were built before the retry loop — same mob set, same values.
            const tooClose = isTooCloseToMob(x, y);
            if (!collidesWithWall && !inPetalRange && !inSpawnZone && !tooClose) {
                newValidPosition = true;
            }
        }
        if (!newValidPosition) {
            return null;
        }
    }
    // --- Phase 3: Select tier and mob type based on the FINAL position ---
    // Position is now fully finalized - select tier and mob based on where the mob actually is.
    const biome = getBiomeAtPosition(x, y);
    let tier = 'common';
    let mobType;
    let reversed = undefined;
    // The mob is spawning in the spawn zone of the target player (whose viewport drove
    // this spawn). Luck grants +1% tier-upgrade chance per point on top of the base 2%.
    const targetPlayer = constants_1.players[targetPlayerId];
    const targetLuck = targetPlayer ? ((0, playerManager_1.calculatePlayerModifiers)(targetPlayer).luck ?? 0) : 0;
    const luckUpgradeBonus = targetLuck * 0.01;
    if (biome && biome.properties?.spawnTable && biome.properties.spawnTable.length > 0) {
        // In a biome - use the biome's spawn table
        const spawnSelection = selectSpawnFromBiomeTable(biome.properties.spawnTable);
        if (spawnSelection) {
            tier = spawnSelection.tier;
            reversed = spawnSelection.reversed;
            if (spawnSelection.mobType) {
                mobType = spawnSelection.mobType;
            }
            else {
                const allMobTypes = (0, mobs_1.getAllMobTypes)();
                if (allMobTypes.length === 0) {
                    return null;
                }
                const currentSection = getSectionAtPosition(x, y);
                const eligibleMobTypes = allMobTypes.filter(type => {
                    if (type === 'target_dummy')
                        return false;
                    const stats = (0, mobs_1.getMobStats)(type, tier);
                    return stats && stats.section.includes(currentSection);
                });
                if (eligibleMobTypes.length === 0) {
                    return null;
                }
                mobType = selectWeightedMobType(eligibleMobTypes, tier);
            }
        }
        else {
            const allMobTypes = (0, mobs_1.getAllMobTypes)();
            if (allMobTypes.length === 0) {
                return null;
            }
            const currentSection = getSectionAtPosition(x, y);
            const eligibleMobTypes = allMobTypes.filter(type => {
                if (type === 'target_dummy')
                    return false;
                if ((0, server_utils_1.isCentipedeBodyType)(type))
                    return false;
                const stats = (0, mobs_1.getMobStats)(type, 'common');
                return stats && stats.section.includes(currentSection);
            });
            if (eligibleMobTypes.length === 0) {
                return null;
            }
            mobType = selectWeightedMobType(eligibleMobTypes, tier);
        }
        // Tier upgrade or downgrade. Target dummies keep exactly the rarity the
        // biome asked for — drifting off it would produce a rarity the
        // one-per-section check never cleared, and dummies are permanent.
        if (mobType !== 'target_dummy') {
            tier = rollTierDrift(tier, luckUpgradeBonus);
        }
    }
    else {
        // Check if position is in a spawn zone
        const spawnZoneType = getSpawnZoneType(x, y);
        if (spawnZoneType) {
            tier = spawnZoneType;
        }
        else {
            const currentSection = getSectionAtPosition(x, y);
            if (exports.EQUAL_RARITY_SECTIONS.includes(currentSection)) {
                tier = selectEqualRarityTier();
            }
            else {
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
        if (spawnZoneType === 'ultra') {
            // Ultra zones spawn exactly 99% ultra and 1% super — no upgrade/
            // downgrade noise. Special-mob bookkeeping for the resulting super
            // (count tracking, chat broadcast, recordBossEvent) is performed by
            // the createEnemy wrapper in server.ts when this returns a super.
            tier = Math.random() < 0.01 ? 'super' : 'ultra';
        }
        else {
            // Tier upgrade or downgrade
            tier = rollTierDrift(tier, luckUpgradeBonus);
        }
        // Select mob type - filter to mobs belonging to this section
        const allMobTypes = (0, mobs_1.getAllMobTypes)();
        if (allMobTypes.length === 0) {
            return null;
        }
        const currentSection = getSectionAtPosition(x, y);
        const eligibleMobTypes = allMobTypes.filter(type => {
            if (type === 'target_dummy')
                return false;
            if ((0, server_utils_1.isCentipedeBodyType)(type))
                return false;
            const stats = (0, mobs_1.getMobStats)(type, tier);
            return stats && stats.section.includes(currentSection);
        });
        if (eligibleMobTypes.length === 0) {
            return null;
        }
        mobType = selectWeightedMobType(eligibleMobTypes, tier);
    }
    // Checked against the FINAL tier, after any upgrade/downgrade roll.
    if (mobType === 'target_dummy' && targetDummyExistsInSection(tier, getSectionAtPosition(x, y))) {
        return null;
    }
    // Get mob stats from config
    let mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats) {
        return null;
    }
    // Final overlap check using the ACTUAL mob size (Phase 2 used a preliminary estimate)
    const actualMobSize = mobStats.size * 40;
    const actualHalfSize = actualMobSize / 2;
    const overlapsExistingMob = (0, enemyRegistry_1.liveEnemies)().some((otherEnemy) => {
        const otherMobStats = (0, mobs_1.getMobStats)(otherEnemy.type, otherEnemy.tier);
        const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
        const otherHalfSize = otherMobSize / 2;
        const dx = (0, mobFields_1.mobX)(otherEnemy.entity) - x;
        const dy = (0, mobFields_1.mobY)(otherEnemy.entity) - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < actualHalfSize + otherHalfSize;
    });
    if (overlapsExistingMob) {
        return null;
    }
    const enemy = (0, enemyRegistry_1.spawnEnemy)(mobType, tier, x, y, { reversed });
    if (!enemy)
        return null;
    // Counted against the cached budget above so a burst of calls inside one
    // TTL window stops at the target instead of spawning the full request.
    _spawnedSinceRefresh++;
    // DPS tracking buffers are allocated lazily on first damage event in trackDamage().
    // Chain and cluster spawns come AFTER the parent is admitted, so their
    // leader/hole references resolve to a live entity on the spot instead of
    // waiting for a second linking pass.
    if ((0, server_utils_1.isCentipedeHeadType)(mobType)) {
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
function createEnemyInZone(helpers, zone) {
    const playerCount = Object.keys(constants_1.players).length;
    if (playerCount === 0)
        return null;
    const realPlayerIds = Object.keys(constants_1.players).filter(id => !id.startsWith('bot_'));
    if (realPlayerIds.length === 0)
        return null;
    // Pick the player closest to the zone center for luck/section attribution.
    const zoneCenterX = (zone.x + zone.width / 2) * constants_2.SCALE_FACTOR;
    const zoneCenterY = (zone.y + zone.height / 2) * constants_2.SCALE_FACTOR;
    let targetPlayerId = realPlayerIds[0];
    let bestDist = Infinity;
    for (const pid of realPlayerIds) {
        const p = constants_1.players[pid];
        if (!p)
            continue;
        const dx = p.x - zoneCenterX;
        const dy = p.y - zoneCenterY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
            bestDist = d2;
            targetPlayerId = pid;
        }
    }
    const zMinX = zone.x * constants_2.SCALE_FACTOR;
    const zMaxX = (zone.x + zone.width) * constants_2.SCALE_FACTOR;
    const zMinY = zone.y * constants_2.SCALE_FACTOR;
    const zMaxY = (zone.y + zone.height) * constants_2.SCALE_FACTOR;
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
        x = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, x));
        y = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, y));
        if ((0, positions_1.isInOutOfBoundsZone)(x, y))
            continue;
        const tileState = (0, constants_2.getTileState)(map_data_1.WALL_GRID, x, y);
        if ((0, constants_2.isTileIdBlocking)(tileState))
            continue;
        if (helpers.isPositionInPlayerPetalRange(x, y, PRELIMINARY_MOB_SIZE))
            continue;
        const tooClose = (0, enemyRegistry_1.liveEnemies)().some((otherEnemy) => {
            const otherMobStats = (0, mobs_1.getMobStats)(otherEnemy.type, otherEnemy.tier);
            const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
            const otherHalfSize = otherMobSize / 2;
            const dx = (0, mobFields_1.mobX)(otherEnemy.entity) - x;
            const dy = (0, mobFields_1.mobY)(otherEnemy.entity) - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance < halfPrelimSize + otherHalfSize + MIN_MOB_SPAWN_DISTANCE;
        });
        if (tooClose)
            continue;
        validPosition = true;
        break;
    }
    if (!validPosition)
        return null;
    // --- Phase 3: tier + mob type, mirroring createEnemy's logic ---
    const biome = getBiomeAtPosition(x, y);
    let tier = 'common';
    let mobType;
    let reversed = undefined;
    const targetPlayer = constants_1.players[targetPlayerId];
    const targetLuck = targetPlayer ? ((0, playerManager_1.calculatePlayerModifiers)(targetPlayer).luck ?? 0) : 0;
    const luckUpgradeBonus = targetLuck * 0.01;
    if (biome && biome.properties?.spawnTable && biome.properties.spawnTable.length > 0) {
        const spawnSelection = selectSpawnFromBiomeTable(biome.properties.spawnTable);
        if (spawnSelection) {
            tier = spawnSelection.tier;
            reversed = spawnSelection.reversed;
            if (spawnSelection.mobType) {
                mobType = spawnSelection.mobType;
            }
            else {
                const allMobTypes = (0, mobs_1.getAllMobTypes)();
                if (allMobTypes.length === 0)
                    return null;
                const currentSection = getSectionAtPosition(x, y);
                const eligibleMobTypes = allMobTypes.filter(type => {
                    if (type === 'target_dummy')
                        return false;
                    const stats = (0, mobs_1.getMobStats)(type, tier);
                    return stats && stats.section.includes(currentSection);
                });
                if (eligibleMobTypes.length === 0)
                    return null;
                mobType = selectWeightedMobType(eligibleMobTypes, tier);
            }
        }
        else {
            const allMobTypes = (0, mobs_1.getAllMobTypes)();
            if (allMobTypes.length === 0)
                return null;
            const currentSection = getSectionAtPosition(x, y);
            const eligibleMobTypes = allMobTypes.filter(type => {
                if (type === 'target_dummy')
                    return false;
                if ((0, server_utils_1.isCentipedeBodyType)(type))
                    return false;
                const stats = (0, mobs_1.getMobStats)(type, 'common');
                return stats && stats.section.includes(currentSection);
            });
            if (eligibleMobTypes.length === 0)
                return null;
            mobType = selectWeightedMobType(eligibleMobTypes, tier);
        }
        // Target dummies keep the biome's exact rarity (see createEnemy).
        if (mobType !== 'target_dummy') {
            tier = rollTierDrift(tier, luckUpgradeBonus);
        }
    }
    else {
        // Force the explicit zone we were asked to spawn for, so overlapping
        // zones don't get cross-tier spawns from getSpawnZoneType's first-match.
        tier = (zone.properties?.spawnType ?? 'common');
        if (tier === 'ultra') {
            tier = Math.random() < 0.01 ? 'super' : 'ultra';
        }
        else {
            tier = rollTierDrift(tier, luckUpgradeBonus);
        }
        const allMobTypes = (0, mobs_1.getAllMobTypes)();
        if (allMobTypes.length === 0)
            return null;
        const currentSection = getSectionAtPosition(x, y);
        const eligibleMobTypes = allMobTypes.filter(type => {
            if (type === 'target_dummy')
                return false;
            if ((0, server_utils_1.isCentipedeBodyType)(type))
                return false;
            const stats = (0, mobs_1.getMobStats)(type, tier);
            return stats && stats.section.includes(currentSection);
        });
        if (eligibleMobTypes.length === 0)
            return null;
        mobType = selectWeightedMobType(eligibleMobTypes, tier);
    }
    // Checked against the FINAL tier, after any upgrade/downgrade roll.
    if (mobType === 'target_dummy' && targetDummyExistsInSection(tier, getSectionAtPosition(x, y))) {
        return null;
    }
    const mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats)
        return null;
    const actualMobSize = mobStats.size * 40;
    const actualHalfSize = actualMobSize / 2;
    const overlapsExistingMob = (0, enemyRegistry_1.liveEnemies)().some((otherEnemy) => {
        const otherMobStats = (0, mobs_1.getMobStats)(otherEnemy.type, otherEnemy.tier);
        const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
        const otherHalfSize = otherMobSize / 2;
        const dx = (0, mobFields_1.mobX)(otherEnemy.entity) - x;
        const dy = (0, mobFields_1.mobY)(otherEnemy.entity) - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < actualHalfSize + otherHalfSize;
    });
    if (overlapsExistingMob)
        return null;
    const enemy = (0, enemyRegistry_1.spawnEnemy)(mobType, tier, x, y, { reversed });
    if (!enemy)
        return null;
    // DPS tracking buffers are allocated lazily on first damage event in trackDamage().
    if ((0, server_utils_1.isCentipedeHeadType)(mobType)) {
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
function spawnInitialSpawns(parent) {
    const children = [];
    const parentStats = (0, mobs_1.getMobStats)(parent.type, parent.tier);
    if (!parentStats || !parentStats.initial_spawns)
        return children;
    const parentRadius = (parentStats.size * 40) / 2;
    // `parent` is a LiveEnemy, which is the type-level statement that it has
    // already been admitted — so each child's HoleTether resolves immediately.
    for (const childType of parentStats.initial_spawns) {
        const angle = Math.random() * Math.PI * 2;
        const dist = parentRadius + 30 + Math.random() * parentRadius;
        const child = (0, enemyRegistry_1.spawnEnemy)(childType, parent.tier, (0, mobFields_1.mobX)(parent.entity) + Math.cos(angle) * dist, (0, mobFields_1.mobY)(parent.entity) + Math.sin(angle) * dist, { parentHoleId: parent.id });
        if (child)
            children.push(child);
    }
    return children;
}
/**
 * Attach the body-segment chain to a centipede head. Used by every centipede
 * spawn path (natural spawn, admin command, egg/pet spawn) so the head never
 * appears alone.
 */
function spawnCentipedeBodySegments(head) {
    const segments = [];
    // Stamps the head's own chain fields on BOTH representations. The chain
    // passes are ECS-owned now, so setting only the legacy fields would leave
    // the head out of its own chain.
    (0, enemyRegistry_1.markCentipedeHead)(head);
    const bodyType = (0, server_utils_1.getCentipedeBodyType)(head.type);
    const bodyStats = (0, mobs_1.getMobStats)(bodyType, head.tier);
    if (!bodyStats)
        return segments;
    const segmentCount = 9; // head + 9 body = 10 total
    // Segments inherit the head's ownership, so a pet chain lays out at the
    // pet size scale — same spacing formula the follow pass uses each tick.
    const segmentSize = bodyStats.size * 40 * (0, mobs_1.getEnemySizeScale)(!!head.ownerId, head.tier, bodyType, head.id);
    const spacing = segmentSize * 0.9;
    const dirX = -Math.cos((0, mobFields_1.mobAngle)(head.entity));
    const dirY = -Math.sin((0, mobFields_1.mobAngle)(head.entity));
    let prevId = head.id;
    let prevX = (0, mobFields_1.mobX)(head.entity);
    let prevY = (0, mobFields_1.mobY)(head.entity);
    for (let i = 1; i <= segmentCount; i++) {
        const segX = prevX + dirX * spacing;
        const segY = prevY + dirY * spacing;
        // Facing is passed in rather than patched on afterwards: the entity's
        // Angle is written at construction, so a post-spawn `segment.angle = ...`
        // would only move the legacy half and the chain would start out bent.
        const segment = (0, enemyRegistry_1.spawnEnemy)(bodyType, head.tier, segX, segY, {
            angle: (0, mobFields_1.mobAngle)(head.entity),
            // undefined for wild centipedes, set for pet ones — either way the key exists.
            ownerId: head.ownerId,
            leaderId: prevId,
            headId: head.id,
            segmentIndex: i,
        });
        if (!segment)
            break;
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
function createSpecialMob(tier, helpers, targetSection, acceptPosition) {
    let zoneType;
    if (tier === 'ultra') {
        // Ultras spawn in zones explicitly tagged as ultra spawn zones.
        zoneType = 'ultra';
    }
    else if (tier === 'super') {
        // 75% of supers spawn in ultra zones, 25% in mythic zones.
        zoneType = Math.random() < 0.75 ? 'ultra' : 'mythic';
    }
    else { // unique
        // Uniques spawn exclusively in ultra zones.
        zoneType = 'ultra';
    }
    let position = null;
    if (tier === 'super' && targetSection !== undefined) {
        // Mythic supers stay section-bound (existing behaviour). Ultra-zone supers
        // are not section-bound — there's no guarantee that an ultra zone exists
        // in every section, so we just pick from any ultra zone.
        if (zoneType === 'mythic') {
            position = getRandomPositionInZoneTypeInSection('mythic', targetSection);
        }
        else {
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
    }
    else {
        // For ultra and unique, use zone-based spawning
        position = getRandomPositionInZoneType(zoneType);
    }
    if (!position) {
        console.error(`No valid position found for ${tier} mob spawning`);
        return null;
    }
    // Determine the section for mob type selection
    const spawnSection = getSectionAtPosition(position.x, position.y);
    const allMobTypes = (0, mobs_1.getAllMobTypes)();
    if (allMobTypes.length === 0) {
        console.error("No mob types found in MOB_CONFIG.");
        return null;
    }
    // Filter to mobs that belong to this section and exclude target_dummy
    const eligibleMobTypes = allMobTypes.filter(type => {
        if (type === 'target_dummy') {
            return false; // Never spawn target dummies as boss mobs
        }
        const stats = (0, mobs_1.getMobStats)(type, tier);
        return stats && stats.section.includes(spawnSection);
    });
    // If no mobs for this section, fall back to any eligible mob
    let mobType;
    if (eligibleMobTypes.length === 0) {
        const fallbackMobTypes = allMobTypes.filter(type => type !== 'target_dummy');
        if (fallbackMobTypes.length === 0) {
            console.error("No eligible mob types found for boss spawning (excluding target dummies).");
            return null;
        }
        mobType = fallbackMobTypes[Math.floor(Math.random() * fallbackMobTypes.length)];
    }
    else {
        mobType = selectWeightedMobType(eligibleMobTypes, tier);
    }
    const mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats) {
        console.error(`No mob stats found for ${mobType} ${tier}`);
        return null;
    }
    // Check if position is in out-of-bounds zone
    if ((0, positions_1.isInOutOfBoundsZone)(position.x, position.y)) {
        console.error(`Spawn position for ${tier} mob is in out-of-bounds zone. Trying alternative position...`);
        // Try to find a new position in the same zone type
        const newPosition = getRandomPositionInZoneType(zoneType);
        if (!newPosition) {
            console.error(`Could not find valid position for ${tier} mob outside out-of-bounds zone`);
            return null;
        }
        if ((0, positions_1.isInOutOfBoundsZone)(newPosition.x, newPosition.y)) {
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
    const overlapsExistingMob = (0, enemyRegistry_1.liveEnemies)().some((otherEnemy) => {
        const otherMobStats = (0, mobs_1.getMobStats)(otherEnemy.type, otherEnemy.tier);
        const otherMobSize = otherMobStats ? otherMobStats.size * 40 : 40;
        const otherHalfSize = otherMobSize / 2;
        const dx = (0, mobFields_1.mobX)(otherEnemy.entity) - position.x;
        const dy = (0, mobFields_1.mobY)(otherEnemy.entity) - position.y;
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
    return (0, enemyRegistry_1.spawnEnemy)(mobType, tier, position.x, position.y, { bossWireShape: true });
}
/**
 * Function to update special mob counts
 */
function updateSpecialMobCounts() {
    // Optimize: count in single pass instead of 3 separate filters
    let ultra = 0;
    let super_ = 0;
    let unique = 0;
    // Reset per-section tracking for super mobs
    const activeSuperSections = new Set();
    for (const enemy of (0, enemyRegistry_1.liveEnemies)()) {
        if (enemy.type === 'target_dummy')
            continue;
        // Maze bosses are managed by mazeSpawner — counting them here would
        // suppress the main world's ultra/super spawns while the maze is
        // populated.
        if ((0, maze_1.isInMazeRegion)((0, mobFields_1.mobX)(enemy.entity), (0, mobFields_1.mobY)(enemy.entity)))
            continue;
        if (enemy.tier === 'ultra')
            ultra++;
        else if (enemy.tier === 'super') {
            super_++;
            // Track which sections have super bosses
            const section = getSectionAtPosition((0, mobFields_1.mobX)(enemy.entity), (0, mobFields_1.mobY)(enemy.entity));
            activeSuperSections.add(section);
            (0, gameState_1.setSuperMobInSection)(section, enemy.id);
        }
        else if (enemy.tier === 'unique')
            unique++;
    }
    // Clear sections that no longer have super bosses
    for (let section = 0; section < 9; section++) {
        if (!activeSuperSections.has(section)) {
            (0, gameState_1.clearSuperMobFromSection)(section);
        }
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
    // Spawn ultra mob if none exists. Ultras spawn silently — no chat broadcast.
    if (gameState_1.ultraMobCount.value === 0) {
        const ultraMob = createSpecialMob('ultra', helpers);
        if (ultraMob) {
            gameState_1.ultraMobCount.value = 1;
            console.log(`[SERVER] Spawned ultra mob: ${ultraMob.type} at (${(0, mobFields_1.mobX)(ultraMob.entity)}, ${(0, mobFields_1.mobY)(ultraMob.entity)})`);
        }
    }
    // Spawn super mob in each section that doesn't have one. Supers land in
    // either ultra zones (75%) or mythic zones (25%); since ultra zones aren't
    // section-bound, an iteration's spawn may land in a different section than
    // the one we're filling. The attempt is abandoned if the destination section
    // is already covered, which prevents many supers from piling into the same
    // ultra zone when several sections happen to roll the ultra branch.
    for (let section = 0; section < 9; section++) {
        const existingSuperMobId = (0, gameState_1.getSuperMobInSection)(section);
        if (!existingSuperMobId) {
            // The destination-section check is a veto on the POSITION, run
            // before the mob is built — dropping an already-admitted boss would
            // leave its entity behind.
            const superMob = createSpecialMob('super', helpers, section, (x, y) => !(0, gameState_1.getSuperMobInSection)(getSectionAtPosition(x, y)));
            if (superMob) {
                const mobSection = getSectionAtPosition((0, mobFields_1.mobX)(superMob.entity), (0, mobFields_1.mobY)(superMob.entity));
                gameState_1.superMobCount.value++;
                (0, gameState_1.setSuperMobInSection)(mobSection, superMob.id);
                // Don't send spawn notification for target dummies
                if (superMob.type !== 'target_dummy') {
                    const spawnTimestamp = Date.now();
                    // Send personalized message to each player based on their section
                    Object.entries(constants_1.players).forEach(([playerId, player]) => {
                        const playerSection = getSectionAtPosition(player.x, player.y);
                        const isSameSection = playerSection === mobSection;
                        const somewhere = isSameSection ? '' : ' somewhere';
                        io.to(playerId).emit('chatMessage', {
                            sender: '',
                            content: `<b style="color: ${constants_2.ENEMY_TIERS.super.color};">A super ${superMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
                            timestamp: spawnTimestamp
                        });
                    });
                    (0, apiKeyApi_1.recordBossEvent)({
                        type: 'spawn',
                        tier: 'super',
                        mobType: superMob.type,
                        x: (0, mobFields_1.mobX)(superMob.entity),
                        y: (0, mobFields_1.mobY)(superMob.entity),
                        timestamp: spawnTimestamp,
                        message: `A super ${superMob.type.replace('_', ' ')} has spawned!`
                    });
                }
                console.log(`[SERVER] Spawned super mob in section ${section}: ${superMob.type} at (${(0, mobFields_1.mobX)(superMob.entity)}, ${(0, mobFields_1.mobY)(superMob.entity)})`);
            }
        }
    }
    // Spawn unique mob with 1/4 chance if any super mob exists
    if (gameState_1.superMobCount.value > 0 && gameState_1.uniqueMobCount.value === 0 && Math.random() < 0.25) {
        const uniqueMob = createSpecialMob('unique', helpers);
        if (uniqueMob) {
            gameState_1.uniqueMobCount.value = 1;
            // Don't send spawn notification for target dummies
            if (uniqueMob.type !== 'target_dummy') {
                const mobSection = getSectionAtPosition((0, mobFields_1.mobX)(uniqueMob.entity), (0, mobFields_1.mobY)(uniqueMob.entity));
                const spawnTimestamp = Date.now();
                // Send personalized message to each player based on their section
                Object.entries(constants_1.players).forEach(([playerId, player]) => {
                    const playerSection = getSectionAtPosition(player.x, player.y);
                    const isSameSection = playerSection === mobSection;
                    const somewhere = isSameSection ? '' : ' somewhere';
                    io.to(playerId).emit('chatMessage', {
                        sender: '',
                        content: `<b style="color: ${constants_2.ENEMY_TIERS.unique.color};">A unique ${uniqueMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
                        timestamp: spawnTimestamp
                    });
                });
                (0, apiKeyApi_1.recordBossEvent)({
                    type: 'spawn',
                    tier: 'unique',
                    mobType: uniqueMob.type,
                    x: (0, mobFields_1.mobX)(uniqueMob.entity),
                    y: (0, mobFields_1.mobY)(uniqueMob.entity),
                    timestamp: spawnTimestamp,
                    message: `A unique ${uniqueMob.type.replace('_', ' ')} has spawned!`
                });
            }
            console.log(`[SERVER] Spawned unique mob: ${uniqueMob.type} at (${(0, mobFields_1.mobX)(uniqueMob.entity)}, ${(0, mobFields_1.mobY)(uniqueMob.entity)})`);
        }
    }
}
