"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RARITY_TP_COSTS = exports.createInitialInventory = exports.hasItem = exports.removeItem = exports.addItem = void 0;
exports.createInitialBasicPetals = createInitialBasicPetals;
exports.enterPvpArena = enterPvpArena;
exports.exitPvpArena = exitPvpArena;
exports.getMazeSpawnPosition = getMazeSpawnPosition;
exports.enterMazeState = enterMazeState;
exports.applyMazeRarityShift = applyMazeRarityShift;
exports.getMazeAbsorbableCount = getMazeAbsorbableCount;
exports.exitMazeState = exitMazeState;
exports.buildMazeRegularState = buildMazeRegularState;
exports.enforceMazeLoadoutCap = enforceMazeLoadoutCap;
exports.findSafeSpawnPosition = findSafeSpawnPosition;
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
exports.calculatePlayerModifiers = calculatePlayerModifiers;
exports.recalculatePlayerStats = recalculatePlayerStats;
exports.addXPToPlayer = addXPToPlayer;
exports.savePlayerProgress = savePlayerProgress;
const petals_1 = require("../petals");
const constants_1 = require("../constants");
const maze_1 = require("../maze");
const petals_2 = require("../petals");
const inventoryCodec_1 = require("../inventoryCodec");
const inventoryCodec_2 = require("../inventoryCodec");
const gameState_1 = require("./gameState");
const map_data_1 = require("../map_data");
const inventoryCodec_3 = require("../inventoryCodec");
Object.defineProperty(exports, "addItem", { enumerable: true, get: function () { return inventoryCodec_3.addItem; } });
Object.defineProperty(exports, "removeItem", { enumerable: true, get: function () { return inventoryCodec_3.removeItem; } });
Object.defineProperty(exports, "hasItem", { enumerable: true, get: function () { return inventoryCodec_3.hasItem; } });
Object.defineProperty(exports, "createInitialInventory", { enumerable: true, get: function () { return inventoryCodec_3.createInitialInventory; } });
const mobs_1 = require("../mobs");
const RARITY_TP_COSTS = {
    common: 0,
    uncommon: 1,
    rare: 2,
    epic: 3,
    legendary: 4,
    mythic: 5,
    ultra: 6,
    super: 7,
    unique: 8,
    apex: 9
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
        onCooldown: true
    }));
}
/**
 * Build the fixed PVP loadout: 5 common basic petals, then 5 empty extra slots.
 */
function createPvpLoadout() {
    return createInitialBasicPetals().concat(Array(5).fill(null));
}
/**
 * Enter the PVP arena: stash the regular inventory/loadout, give the player a
 * fresh PVP loadout (5 common basics) and an empty PVP inventory, reset PVP
 * score, and recalc stats so the fixed PVP max health applies. Idempotent —
 * calling this while already in PVP just resets the PVP loadout/inventory.
 */
function enterPvpArena(player, io) {
    if (!player.regularInventory) {
        player.regularInventory = player.inventory || [];
        player.regularLoadout = player.loadout || [];
    }
    player.inventory = [];
    player.loadout = createPvpLoadout();
    player.pvpScore = 0;
    player.inPvpArena = true;
    recalculatePlayerStats(player, io);
    player.health = player.maxHealth;
    if (io) {
        io.to(player.id).emit('inventoryUpdated', player.inventory);
    }
}
/**
 * Leave the PVP arena: transfer 25% of the PVP inventory back to the regular
 * inventory, restore the regular inventory/loadout, recalc stats, full-heal,
 * and emit the inventory update.
 */
function exitPvpArena(player, io, savePlayerProgress) {
    const pvpInventory = player.inventory || [];
    const restored = player.regularInventory || (0, inventoryCodec_3.createInitialInventory)();
    for (let i = 0; i < pvpInventory.length; i += 3) {
        const rarityId = pvpInventory[i];
        const itemId = pvpInventory[i + 1];
        const count = pvpInventory[i + 2];
        const kept = Math.floor(count * constants_1.PVP_INVENTORY_KEEP_RATIO);
        if (kept <= 0)
            continue;
        const rarity = inventoryCodec_2.ID_TO_RARITY.get(rarityId);
        const itemKey = inventoryCodec_2.ID_TO_ITEM_KEY.get(itemId);
        if (!rarity || !itemKey)
            continue;
        (0, inventoryCodec_3.addItem)(restored, rarity, itemKey, kept);
    }
    player.inventory = restored;
    player.loadout = player.regularLoadout || createPvpLoadout();
    player.regularInventory = undefined;
    player.regularLoadout = undefined;
    player.pvpScore = 0;
    player.inPvpArena = false;
    recalculatePlayerStats(player, io);
    player.health = player.maxHealth;
    if (io) {
        io.to(player.id).emit('inventoryUpdated', player.inventory);
    }
    if (savePlayerProgress) {
        const userId = gameState_1.playerUserIds[player.id];
        if (userId)
            savePlayerProgress(player, userId);
    }
}
/**
 * Random point inside the maze spawn room (small jitter so players don't
 * stack exactly on one pixel).
 */
function getMazeSpawnPosition() {
    const maze = (0, maze_1.getActiveMaze)();
    if (!maze) {
        // Maze not initialized (shouldn't happen — server sets it at startup).
        return { x: constants_1.ACTUAL_WORLD_WIDTH / 2, y: constants_1.ACTUAL_WORLD_HEIGHT / 2 };
    }
    const jitter = maze_1.MAZE_CELL_SIZE * 0.6;
    return {
        x: maze.spawnX + (Math.random() - 0.5) * jitter,
        y: maze.spawnY + (Math.random() - 0.5) * jitter,
    };
}
/** Inventory item key for a loadout item, or null if it has none. */
function loadoutItemKey(item) {
    if (item.type === 'petal')
        return item.petalType ? `petal_${item.petalType}` : null;
    return item.type;
}
/**
 * Put a player into maze state: shift the LOADOUT down one rarity, strip
 * anything still above the equip cap, and snapshot entry holdings for the
 * Absorb tab. This is the single entry point (auth + respawn) — the three
 * steps must run in this order, because the cap strip returns petals to the
 * inventory at regular-world rarity and the snapshot must count them there,
 * not double-count or mark them absorbable.
 */
function enterMazeState(player, io) {
    player.inMaze = true;
    applyMazeRarityShift(player);
    enforceMazeLoadoutCap(player, io);
    snapshotMazeEntryCounts(player);
}
/**
 * Shift the player's equipped LOADOUT down one rarity for the maze ("petals
 * obtained in regular maps decrease 1 in rarity going in"). The INVENTORY is
 * not touched: it stays in regular-world terms for the whole run — the
 * loadout is locked inside the maze (updateLoadout rejects every change), so
 * shifted loadout and regular inventory can never mix. Slots that are
 * already common can't shift; they're recorded in player.mazeFlooredSlots so
 * buildMazeRegularState won't hand them a free +1 on the way out (slot
 * indices are stable precisely because the loadout is locked). Idempotent
 * per maze session via mazeRarityShifted.
 *
 * Persisted saves are NEVER stored in shifted terms — savePlayerProgress
 * translates through buildMazeRegularState — so a crash mid-maze can't
 * corrupt anyone's loadout.
 */
function applyMazeRarityShift(player) {
    if (player.mazeRarityShifted)
        return;
    const floored = [];
    const loadout = player.loadout || [];
    for (let i = 0; i < loadout.length; i++) {
        const item = loadout[i];
        if (!item || !item.rarity)
            continue;
        const idx = (0, petals_2.getRarityIndex)(item.rarity);
        if (idx > 0) {
            item.rarity = petals_2.RARITY_LEVELS[idx - 1];
            // Re-derive petal health for the new (lower) rarity.
            applyPetalHealthBonus(item, player);
        }
        else if (idx === 0) {
            floored.push(i);
        }
    }
    player.mazeFlooredSlots = floored;
    player.mazeRarityShifted = true;
}
/**
 * Snapshot everything held at maze entry (inventory in regular terms plus
 * loadout in shifted terms), keyed "rarityId|itemId". Absorbing is limited
 * to the surplus over this snapshot — i.e. petals obtained during this maze
 * run (see getMazeAbsorbableCount). The client receives it via the
 * authenticated/playerRespawned player object and computes the same numbers
 * for greying out the Absorb tab. Kept across in-maze deaths: only the
 * first call of a maze session takes the snapshot.
 */
function snapshotMazeEntryCounts(player) {
    if (player.mazeEntryCounts)
        return;
    const entryCounts = {};
    const inv = player.inventory || [];
    for (let i = 0; i + 2 < inv.length; i += 3) {
        const key = `${inv[i]}|${inv[i + 1]}`;
        entryCounts[key] = (entryCounts[key] || 0) + inv[i + 2];
    }
    for (const item of player.loadout || []) {
        if (!item || !item.rarity)
            continue;
        const rarityId = (0, petals_2.getRarityIndex)(item.rarity);
        const itemKey = loadoutItemKey(item);
        const itemId = itemKey !== null ? inventoryCodec_1.ITEM_KEY_TO_ID.get(itemKey) : undefined;
        if (rarityId < 0 || itemId === undefined)
            continue;
        const key = `${rarityId}|${itemId}`;
        entryCounts[key] = (entryCounts[key] || 0) + 1;
    }
    player.mazeEntryCounts = entryCounts;
}
/**
 * How many of a given (rarity, itemKey) stack the player may absorb: the
 * amount by which their current holdings (inventory + loadout) exceed what
 * they brought into the maze. Only this surplus was obtained during the maze
 * run. Counting loadout on both sides keeps equip/unequip neutral — moving a
 * brought petal out of a slot can't make it absorbable. Absorbing removes
 * from the inventory only, so callers must also bound by the inventory count
 * (the absorb handler's hasItem check already does).
 */
function getMazeAbsorbableCount(player, rarity, itemKey) {
    if (!player.inMaze || !player.mazeRarityShifted || !player.mazeEntryCounts)
        return 0;
    const rarityId = (0, petals_2.getRarityIndex)(rarity);
    const itemId = inventoryCodec_1.ITEM_KEY_TO_ID.get(itemKey);
    if (rarityId < 0 || itemId === undefined)
        return 0;
    let total = (0, inventoryCodec_3.getItemCount)(player.inventory || [], rarity, itemKey);
    for (const item of player.loadout || []) {
        if (!item || item.rarity !== rarity)
            continue;
        if (loadoutItemKey(item) === itemKey)
            total++;
    }
    const entry = player.mazeEntryCounts[`${rarityId}|${itemId}`] || 0;
    return Math.max(0, total - entry);
}
/**
 * Leave maze terms in place: translate the LIVE loadout back to
 * regular-world rarities and clear the shift bookkeeping. Used when a player
 * is moved out of the maze without a re-authentication (e.g. admin teleport);
 * the normal exit path — leaving via the title screen — converts implicitly
 * through the save translation instead.
 */
function exitMazeState(player) {
    if (player.mazeRarityShifted) {
        const regular = buildMazeRegularState(player);
        player.inventory = regular.inventory;
        player.loadout = regular.loadout;
        player.mazeRarityShifted = false;
        player.mazeFlooredSlots = undefined;
        player.mazeEntryCounts = undefined;
        // Re-derive petal health for the restored (higher) rarities.
        for (const item of player.loadout) {
            if (item && item.type === 'petal')
                applyPetalHealthBonus(item, player);
        }
    }
    player.inMaze = false;
}
/**
 * Translate a maze-shifted player back into regular-world terms. Only the
 * LOADOUT is shifted inside the maze: +1 to undo the entry shift, except the
 * slots recorded in mazeFlooredSlots (common at entry, couldn't shift down —
 * they stay common so a round trip can't mint free uncommons). The inventory
 * lives in regular terms for the whole run — drops are upgraded the moment
 * they're picked up — so it passes through unchanged. Slot-keyed flooring is
 * safe because the loadout is locked inside the maze (updateLoadout rejects
 * all changes; petal break/restore recreates the same petal in place).
 * Pure — returns copies; the live player state is untouched. Used by
 * savePlayerProgress while the player is inside the maze, which also makes
 * leaving via the title screen "just work": the last save IS the exit
 * conversion.
 */
function buildMazeRegularState(player) {
    const maxIdx = petals_2.RARITY_LEVELS.length - 1;
    const floored = new Set(player.mazeFlooredSlots || []);
    const loadout = (player.loadout || []).map((item, slot) => {
        if (!item || !item.rarity)
            return item ? { ...item } : null;
        const idx = (0, petals_2.getRarityIndex)(item.rarity);
        if (idx < 0 || floored.has(slot))
            return { ...item };
        return { ...item, rarity: petals_2.RARITY_LEVELS[Math.min(idx + 1, maxIdx)] };
    });
    return { inventory: [...(player.inventory || [])], loadout };
}
/**
 * Enforce the maze petal cap: only petals up to mythic (in shifted maze
 * terms — regular-world ultra) may stay equipped in active slots (0-9).
 * Anything above is moved back into the inventory at its REGULAR-WORLD
 * rarity (shifted + 1): this runs right after the entry shift, and the
 * inventory is never in maze terms. Returns true if anything was stripped.
 */
function enforceMazeLoadoutCap(player, io) {
    if (!player.loadout)
        return false;
    const maxIdx = petals_2.RARITY_LEVELS.length - 1;
    let changed = false;
    const activeLen = Math.min(player.loadout.length, 10);
    for (let i = 0; i < activeLen; i++) {
        const item = player.loadout[i];
        if (!item || !item.rarity)
            continue;
        const idx = (0, petals_2.getRarityIndex)(item.rarity);
        if (idx <= maze_1.MAZE_MAX_PETAL_RARITY_INDEX)
            continue;
        const key = loadoutItemKey(item);
        if (key) {
            if (!player.inventory)
                player.inventory = [];
            const regularRarity = player.mazeRarityShifted
                ? petals_2.RARITY_LEVELS[Math.min(idx + 1, maxIdx)]
                : item.rarity;
            (0, inventoryCodec_3.addItem)(player.inventory, regularRarity, key, 1);
        }
        player.loadout[i] = null;
        changed = true;
    }
    if (changed) {
        recalculatePlayerStats(player, io);
        if (io) {
            io.to(player.id).emit('inventoryUpdated', player.inventory);
        }
    }
    return changed;
}
/**
 * Check if a position is inside a wall or water tile
 */
function isPositionInsideWall(x, y, playerSize = constants_1.PLAYER_SIZE) {
    const halfSize = playerSize / 2;
    // Check all tiles that the entity would overlap with
    const minTileX = (0, constants_1.worldToTileX)(x - halfSize);
    const maxTileX = (0, constants_1.worldToTileX)(x + halfSize);
    const minTileY = (0, constants_1.worldToTileY)(y - halfSize);
    const maxTileY = (0, constants_1.worldToTileY)(y + halfSize);
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const tileWorldX = tileX * constants_1.WALL_TILE_SIZE;
            const tileWorldY = tileY * constants_1.WALL_TILE_SIZE;
            const state = (0, constants_1.getTileState)(map_data_1.WALL_GRID, tileWorldX, tileWorldY);
            // Any blocking tile (solid/water — built-in or custom) blocks spawning
            if ((0, constants_1.isTileIdBlocking)(state)) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Check if there are too many hostile mobs near a position
 * @param x X coordinate
 * @param y Y coordinate
 * @param radius Radius to check for mobs (default 200 pixels)
 * @param maxMobs Maximum number of mobs allowed in the radius (default 5)
 * @returns true if there are too many mobs nearby
 */
function hasTooManyMobsNearby(x, y, radius = 200, maxMobs = 5) {
    let mobCount = 0;
    for (const enemy of constants_1.enemies) {
        const dx = enemy.x - x;
        const dy = enemy.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= radius) {
            mobCount++;
            if (mobCount > maxMobs) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Check if a position would directly overlap with any mob
 */
function isOverlappingMob(x, y, playerSize = constants_1.PLAYER_SIZE) {
    const playerRadius = playerSize / 2;
    for (const enemy of constants_1.enemies) {
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const mobRadius = mobStats ? (mobStats.size * 40) / 2 : 20;
        const dx = enemy.x - x;
        const dy = enemy.y - y;
        const distSq = dx * dx + dy * dy;
        const minDist = playerRadius + mobRadius;
        if (distSq < minDist * minDist) {
            return true;
        }
    }
    return false;
}
/**
 * Check if a spawn position is safe (not in wall, not overlapping mobs, and not too many mobs nearby)
 */
function isSafeSpawnPosition(x, y, playerSize = constants_1.PLAYER_SIZE) {
    // Check if position is inside a wall
    if (isPositionInsideWall(x, y, playerSize)) {
        return false;
    }
    // Check if position would overlap with any mob
    if (isOverlappingMob(x, y, playerSize)) {
        return false;
    }
    // Check if there are too many mobs nearby
    if (hasTooManyMobsNearby(x, y)) {
        return false;
    }
    return true;
}
/**
 * Find a safe spawn position by trying multiple random positions
 * @param spawnArea The spawn area to search within
 * @param maxAttempts Maximum number of attempts to find a safe position (default 50)
 * @returns A safe spawn position or null if none found
 */
function findSafeSpawnPosition(spawnArea, maxAttempts = 50) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const x = (spawnArea.x + Math.random() * spawnArea.width) * constants_1.SCALE_FACTOR;
        const y = (spawnArea.y + Math.random() * spawnArea.height) * constants_1.SCALE_FACTOR;
        if (isSafeSpawnPosition(x, y)) {
            return { x, y };
        }
    }
    // If no safe position found after maxAttempts, return null
    return null;
}
function respawnPlayer(player, io) {
    let spawnPosition = null;
    // PVP arena: either the player picked "PVP" on the title screen, or they
    // died while inside the arena. Either way, drop them at the arena spawn
    // and start a fresh PVP session.
    const wantsPvp = player.spawnBiome === 'pvp'
        || player.inPvpArena
        || (0, constants_1.isInPvpArena)(player.x, player.y);
    if (wantsPvp) {
        spawnPosition = { x: constants_1.PVP_ARENA_SPAWN_X, y: constants_1.PVP_ARENA_SPAWN_Y };
        // Resets PVP loadout/inventory and applies PVP-fixed max health.
        // Idempotent — safe whether the player is mid-arena or freshly spawning.
        enterPvpArena(player, io);
    }
    // Maze: players who chose the maze (or died inside it) respawn at the
    // maze entrance. Petals absorbed in the maze stay in the real inventory.
    const wantsMaze = !wantsPvp && (player.spawnBiome === 'maze'
        || player.inMaze
        || (0, maze_1.isInMazeRegion)(player.x, player.y));
    if (wantsMaze) {
        spawnPosition = getMazeSpawnPosition();
        // Shift the loadout down, strip over-cap slots, snapshot absorb
        // baseline — all no-ops if already in maze state this session.
        enterMazeState(player, io);
    }
    else {
        // Not a maze respawn: make sure no maze-term state leaks out (also
        // converts the live inventory back if the player somehow left the
        // maze without a re-auth).
        exitMazeState(player);
    }
    // First, try to spawn in the biome the player selected on the title screen
    if (!spawnPosition && player.spawnBiome && player.spawnBiome !== 'default') {
        spawnPosition = getSpawnPositionInBiome(player.spawnBiome);
    }
    // If no spawn found in the player's selected biome, fall back to level-based spawn points
    if (!spawnPosition) {
        const validSpawnPoints = map_data_1.WORLD_MAP.filter(element => element.type === 'spawn' &&
            element.properties?.spawnType === getSpawnTypeForLevel(player.level));
        if (validSpawnPoints.length > 0) {
            // Try to find a safe spawn position in valid spawn points
            // Shuffle spawn points to try different ones
            const shuffledSpawnPoints = [...validSpawnPoints].sort(() => Math.random() - 0.5);
            for (const spawn of shuffledSpawnPoints) {
                const safePosition = findSafeSpawnPosition(spawn);
                if (safePosition) {
                    spawnPosition = safePosition;
                    break;
                }
            }
        }
        // If no safe position found in spawn points, try fallback
        if (!spawnPosition) {
            console.warn('No safe spawn position found in spawn points for level', player.level, '- trying fallback');
            // Try random positions in the world as fallback
            for (let attempt = 0; attempt < 50; attempt++) {
                const x = Math.random() * constants_1.ACTUAL_WORLD_WIDTH;
                const y = Math.random() * constants_1.ACTUAL_WORLD_HEIGHT;
                if (isSafeSpawnPosition(x, y)) {
                    spawnPosition = { x, y };
                    break;
                }
            }
        }
        // Final fallback: use first spawn point or center of world (even if not safe)
        if (!spawnPosition) {
            console.warn('No safe spawn position found after all attempts - using unsafe fallback');
            const validSpawnPointsFallback = map_data_1.WORLD_MAP.filter(element => element.type === 'spawn' &&
                element.properties?.spawnType === getSpawnTypeForLevel(player.level));
            if (validSpawnPointsFallback.length > 0) {
                const spawn = validSpawnPointsFallback[0];
                spawnPosition = {
                    x: (spawn.x + spawn.width / 2) * constants_1.SCALE_FACTOR,
                    y: (spawn.y + spawn.height / 2) * constants_1.SCALE_FACTOR
                };
            }
            else {
                spawnPosition = {
                    x: constants_1.ACTUAL_WORLD_WIDTH / 2,
                    y: constants_1.ACTUAL_WORLD_HEIGHT / 2
                };
            }
        }
    }
    player.x = spawnPosition.x;
    player.y = spawnPosition.y;
    // Recalculate stats so PVP spawns get the fixed PVP max health and regular
    // spawns get their leveled max health before we full-heal below.
    recalculatePlayerStats(player, io);
    player.health = player.maxHealth;
    player.score = Math.max(0, player.score - 10);
    player.isInvulnerable = true;
    player.lastDamageTime = 0;
    player.isDead = false;
    player.secondChanceCooldownUntil = undefined; // Reset second chance cooldown on respawn
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
    const biomes = map_data_1.WORLD_MAP.filter(element => element.type === 'biome' &&
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
    // Shuffle biomes to try different ones
    const shuffledBiomes = [...safeBiomes].sort(() => Math.random() - 0.5);
    // Try to find a safe spawn position in any of the safe biomes
    for (const biome of shuffledBiomes) {
        // Generate spawn area with padding from edges
        const padding = 50; // Padding from biome edges
        const spawnArea = {
            x: biome.x + padding,
            y: biome.y + padding,
            width: Math.max(0, biome.width - padding * 2),
            height: Math.max(0, biome.height - padding * 2)
        };
        if (spawnArea.width > 0 && spawnArea.height > 0) {
            const safePosition = findSafeSpawnPosition(spawnArea);
            if (safePosition) {
                console.log(`Spawning in ${biomeName} biome at (${safePosition.x.toFixed(0)}, ${safePosition.y.toFixed(0)})`);
                return safePosition;
            }
        }
    }
    // Fallback: return a position even if not completely safe (better than nothing)
    const biome = safeBiomes[0];
    const padding = 50;
    const x = biome.x + padding + Math.random() * Math.max(0, biome.width - padding * 2);
    const y = biome.y + padding + Math.random() * Math.max(0, biome.height - padding * 2);
    console.warn(`Could not find completely safe spawn in ${biomeName} biome, using fallback position`);
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
        unique: 1.8,
        apex: 1.9
    };
    return multipliers[skillTier] || 1;
}
function applyPetalHealthBonus(petal, player) {
    if (!petal || petal.type !== 'petal' || !petal.petalType)
        return;
    const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity || 'common');
    if (!petalStats)
        return;
    // Skills are disabled inside the PVP arena.
    const petalHealthMultiplier = player.inPvpArena ? 1 : getSkillMultiplier(player.skills?.petalHealth);
    const maxHealth = Math.round(petalStats.health * petalHealthMultiplier);
    petal.maxHealth = maxHealth;
    if (petal.health !== undefined) {
        petal.health = Math.min(petal.health, maxHealth);
    }
}
/**
 * Calculate combined player modifiers from all equipped petals
 */
function calculatePlayerModifiers(player) {
    const modifiers = {
        damage: 1.0,
        maxHealth: 1.0,
        speed: 1.0,
        range: 1.0,
        rotationSpeed: 1.0,
        playerRadius: 1.0,
        magnetism: 0,
        luck: 1.0,
        petalAttractionRadius: 30,
        aggroRadius: 0
    };
    if (!player.loadout)
        return modifiers;
    // Sum up modifiers from all equipped petals.
    // Secondary loadout (slots 10+) is storage only — its petals contribute no modifiers.
    for (let i = 0; i < player.loadout.length; i++) {
        if (i >= 10)
            break;
        const item = player.loadout[i];
        if (!item || item.type !== 'petal' || !item.petalType || !item.rarity)
            continue;
        const petalStats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
        if (!petalStats || !petalStats.playerModifiers)
            continue;
        const petalModifiers = petalStats.playerModifiers;
        // Multiplicative stacking: multiply all modifiers together
        if (petalModifiers.damage !== undefined && modifiers.damage !== undefined) {
            modifiers.damage *= petalModifiers.damage;
        }
        if (petalModifiers.maxHealth !== undefined && modifiers.maxHealth !== undefined) {
            modifiers.maxHealth *= petalModifiers.maxHealth;
        }
        if (petalModifiers.speed !== undefined && modifiers.speed !== undefined) {
            modifiers.speed *= petalModifiers.speed;
        }
        if (petalModifiers.range !== undefined && modifiers.range !== undefined) {
            modifiers.range *= petalModifiers.range;
        }
        if (petalModifiers.rotationSpeed !== undefined && modifiers.rotationSpeed !== undefined) {
            modifiers.rotationSpeed += petalModifiers.rotationSpeed - 1;
        }
        if (petalModifiers.playerRadius !== undefined && modifiers.playerRadius !== undefined) {
            modifiers.playerRadius *= petalModifiers.playerRadius;
        }
        if (petalModifiers.magnetism !== undefined && modifiers.magnetism !== undefined) {
            modifiers.magnetism += petalModifiers.magnetism;
        }
        if (petalModifiers.luck !== undefined && modifiers.luck !== undefined) {
            modifiers.luck += petalModifiers.luck;
        }
        if (petalModifiers.petalAttractionRadius !== undefined && modifiers.petalAttractionRadius !== undefined) {
            modifiers.petalAttractionRadius += petalModifiers.petalAttractionRadius;
        }
        if (petalModifiers.aggroRadius !== undefined && modifiers.aggroRadius !== undefined) {
            modifiers.aggroRadius += petalModifiers.aggroRadius;
        }
    }
    return modifiers;
}
/**
 * Recalculate and apply player stats based on level, skills, and equipped petal modifiers
 */
function recalculatePlayerStats(player, io) {
    // Get base stats from level
    const baseMaxHealth = calculateMaxHealthFromLevel(player.level);
    const baseDamage = calculateDamageFromLevel(player.level);
    // Apply skill multipliers — disabled in the PVP arena.
    const healthMultiplier = player.inPvpArena ? 1 : getSkillMultiplier(player.skills?.playerHealth);
    const damageMultiplier = player.inPvpArena ? 1 : getSkillMultiplier(player.skills?.damage);
    // Get petal modifiers
    const petalModifiers = calculatePlayerModifiers(player);
    // Store old maxHealth to calculate health percentage
    const oldMaxHealth = player.maxHealth || 0;
    // Apply all multipliers (use 1.0 as fallback if modifier is undefined).
    // PVP arena overrides max health to a fixed value so all players are on equal footing.
    const newMaxHealth = player.inPvpArena
        ? constants_1.PVP_MAX_HEALTH
        : Math.round(baseMaxHealth * healthMultiplier * (petalModifiers.maxHealth ?? 1.0));
    player.damage = Math.round(baseDamage * damageMultiplier * (petalModifiers.damage ?? 1.0));
    // Clamp to a sane range: an Infinity/NaN/<=0 or absurdly stacked playerRadius
    // (the product of many grow petals' modifiers) would give a degenerate hitbox that
    // hangs the tile-collision scans (see checkTileCollision's guard). 100x base keeps
    // any legitimate big-flower build intact while capping the pathological extreme.
    const rawSizeMult = petalModifiers.playerRadius ?? 1.0;
    player.sizeMultiplier = (Number.isFinite(rawSizeMult) && rawSizeMult > 0) ? Math.min(rawSizeMult, 100) : 1.0;
    player.magnetism = petalModifiers.magnetism ?? 0;
    player.aggroRadiusBonus = petalModifiers.aggroRadius ?? 0;
    // Scale current health proportionally if maxHealth changed
    if (oldMaxHealth > 0 && oldMaxHealth !== newMaxHealth) {
        // Calculate health percentage (0.0 to 1.0)
        const healthPercentage = Math.max(0, Math.min(1, player.health / oldMaxHealth));
        // Scale to new maxHealth, maintaining the same percentage
        player.health = Math.round(newMaxHealth * healthPercentage);
    }
    // Update maxHealth after scaling health
    player.maxHealth = newMaxHealth;
    // Ensure health doesn't exceed maxHealth (safety check)
    if (player.health > player.maxHealth) {
        player.health = player.maxHealth;
    }
    // Ensure health is not negative
    if (player.health < 0) {
        player.health = 0;
    }
    // Emit update only to the affected player
    if (io) {
        io.to(player.id).emit('playerUpdated', player);
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
    // PVP leaderboard score = XP gained from kills during this arena session.
    if (player.inPvpArena && xp > 0) {
        player.pvpScore = (player.pvpScore || 0) + xp;
    }
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
        // Update maxHealth and damage based on new level, skills, and petal modifiers
        recalculatePlayerStats(player, io);
        // Heal to full when leveling up
        player.health = player.maxHealth;
        // Emit level up event only to the affected player
        for (let level = oldLevel + 1; level <= newLevel; level++) {
            io.to(player.id).emit('levelUp', {
                playerId: player.id,
                level: level,
                maxHealth: calculateMaxHealthFromLevel(level),
                damage: calculateDamageFromLevel(level)
            });
        }
        // Emit skills update only to the affected player
        io.to(player.id).emit('skillsUpdated', {
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
        // While in PVP, the live `inventory`/`loadout` are the temporary PVP
        // versions; save the stashed regular versions so PVP play doesn't clobber
        // the player's persisted data. While in the maze, the live versions are
        // shifted down one rarity — persist the regular-world translation so the
        // DB never holds maze-term rarities (crash-safe, and the last save doubles
        // as the exit conversion when the player leaves via the title screen).
        let inventoryToSave;
        let loadoutSource;
        if (player.inPvpArena) {
            inventoryToSave = player.regularInventory || [];
            loadoutSource = player.regularLoadout || [];
        }
        else if (player.inMaze && player.mazeRarityShifted) {
            const regular = buildMazeRegularState(player);
            inventoryToSave = regular.inventory;
            loadoutSource = regular.loadout;
        }
        else {
            inventoryToSave = player.inventory || [];
            loadoutSource = player.loadout || [];
        }
        // Filter loadout to only save type and rarity (not status fields)
        const cleanLoadout = loadoutSource.map(item => {
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
            inventory: (0, inventoryCodec_3.inventoryToDict)(inventoryToSave),
            loadout: cleanLoadout,
            tp: player.tp || 0,
            skills: player.skills || {},
            mobKills: player.mobKills || {},
            stars: player.stars || 0,
            renderFlags: player.renderFlags || 0,
            equippedSkinId: player.equippedSkinId || ''
        });
    }
}
