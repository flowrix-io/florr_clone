"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RARITY_TP_COSTS = exports.calculatePlayerModifiers = exports.getSkillMultiplier = exports.createInitialInventory = exports.hasItem = exports.removeItem = exports.addItem = void 0;
exports.createInitialBasicPetals = createInitialBasicPetals;
exports.enterPvpArena = enterPvpArena;
exports.exitPvpArena = exitPvpArena;
exports.getMazeSpawnPosition = getMazeSpawnPosition;
exports.enterMazeState = enterMazeState;
exports.enterMazeProgression = enterMazeProgression;
exports.exitMazeProgression = exitMazeProgression;
exports.buildCollection = buildCollection;
exports.capLoadoutToCollection = capLoadoutToCollection;
exports.buildRegularFromMaze = buildRegularFromMaze;
exports.applyMazeLoadout = applyMazeLoadout;
exports.getMazeAbsorbableCount = getMazeAbsorbableCount;
exports.exitMazeState = exitMazeState;
exports.isPositionInsideWall = isPositionInsideWall;
exports.findSafeSpawnPosition = findSafeSpawnPosition;
exports.isBiomeSafeForSpawn = isBiomeSafeForSpawn;
exports.getSpawnPositionInBiome = getSpawnPositionInBiome;
exports.calculateXPRequirement = calculateXPRequirement;
exports.calculateTotalXP = calculateTotalXP;
exports.calculateLevelFromTotalXP = calculateLevelFromTotalXP;
exports.calculateCurrentLevelXP = calculateCurrentLevelXP;
exports.calculateMaxHealthFromLevel = calculateMaxHealthFromLevel;
exports.countSpentTP = countSpentTP;
exports.reconcileTP = reconcileTP;
exports.isMazeTrackLive = isMazeTrackLive;
exports.getOutsideTotalXP = getOutsideTotalXP;
exports.getMazeTotalXP = getMazeTotalXP;
exports.getAbsorbingTier = getAbsorbingTier;
exports.calculateDamageFromLevel = calculateDamageFromLevel;
exports.applyPetalHealthBonus = applyPetalHealthBonus;
exports.recalculatePlayerStats = recalculatePlayerStats;
exports.addXPToPlayer = addXPToPlayer;
exports.addMazeXPToPlayer = addMazeXPToPlayer;
exports.savePlayerProgress = savePlayerProgress;
const mobFields_1 = require("./mobFields");
const enemyRegistry_1 = require("./enemyRegistry");
const playerWire_1 = require("./playerWire");
const petals_1 = require("../petals");
const skill_multipliers_1 = require("../skill_multipliers");
Object.defineProperty(exports, "getSkillMultiplier", { enumerable: true, get: function () { return skill_multipliers_1.getStatSkillMultiplier; } });
const playerModifiers_1 = require("./shared/playerModifiers");
Object.defineProperty(exports, "calculatePlayerModifiers", { enumerable: true, get: function () { return playerModifiers_1.calculatePlayerModifiers; } });
const constants_1 = require("../constants");
const maze_1 = require("../maze");
const petals_2 = require("../petals");
const inventoryCodec_1 = require("../inventoryCodec");
const inventoryCodec_2 = require("../inventoryCodec");
const gameState_1 = require("./gameState");
const utils_1 = require("./utils");
const map_data_1 = require("../map_data");
const inventoryCodec_3 = require("../inventoryCodec");
Object.defineProperty(exports, "addItem", { enumerable: true, get: function () { return inventoryCodec_3.addItem; } });
Object.defineProperty(exports, "removeItem", { enumerable: true, get: function () { return inventoryCodec_3.removeItem; } });
Object.defineProperty(exports, "hasItem", { enumerable: true, get: function () { return inventoryCodec_3.hasItem; } });
Object.defineProperty(exports, "createInitialInventory", { enumerable: true, get: function () { return inventoryCodec_3.createInitialInventory; } });
const mobs_1 = require("../mobs");
const wireOutbox_1 = require("./wireOutbox");
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
        io.to((0, utils_1.getOriginalSocketId)(player.id)).emit('inventoryUpdated', player.inventory);
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
        io.to((0, utils_1.getOriginalSocketId)(player.id)).emit('inventoryUpdated', player.inventory);
        // Push the restored regular loadout authoritatively so the client stops
        // holding the PVP loadout the instant it leaves the arena. Without this
        // the client keeps the PVP petals until the next tick sync and can emit
        // a stale `updateLoadout` that the server would persist as the regular
        // loadout (the mode-tag guard in the updateLoadout handler is the other
        // half of that fix).
        (0, wireOutbox_1.getWireOutbox)().toSocket((0, utils_1.getOriginalSocketId)(player.id), 'playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(player));
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
 * Put a player into maze state: swap in the SEPARATE maze loadout preset (see
 * applyMazeLoadout), stash the pristine regular loadout for restore on exit,
 * and snapshot entry holdings for the Absorb tab. This is the single entry
 * point (auth + respawn). The regular loadout is NEVER mutated — it is stashed
 * verbatim in `regularLoadout` and restored untouched on exit — so entering the
 * maze can't change or destroy the player's persisted regular loadout. The
 * steps must run in order: enterMazeProgression first so the maze talent tree
 * is live when applyMazeLoadout re-derives petal health, then the snapshot last
 * so it counts the maze-terms holdings.
 */
function enterMazeState(player, io) {
    player.inMaze = true;
    // Must run first: applyMazeLoadout re-derives petal health through
    // applyPetalHealthBonus, which reads player.skills — that has to already
    // be the maze tree, not the outside one.
    enterMazeProgression(player);
    applyMazeLoadout(player, io);
    snapshotMazeEntryCounts(player);
    emitSkillsUpdate(player, io);
}
/** Push the now-live track's TP pool and talent tree to the owning client. */
function emitSkillsUpdate(player, io) {
    if (!io)
        return;
    io.to((0, utils_1.getOriginalSocketId)(player.id)).emit('skillsUpdated', {
        playerId: player.id,
        tp: player.tp || 0,
        skills: player.skills || {}
    });
}
/**
 * Park the outside level/TP/talents and make the maze track live. The maze
 * track is permanent — it is loaded from the DB at auth and written back on
 * exit and on every save — so re-entering resumes the maze level you left at.
 * Idempotent per maze session via mazeXPSwapped.
 */
function enterMazeProgression(player) {
    if (player.mazeXPSwapped)
        return;
    player.regularTotalXP = calculateTotalXP(player.level, player.xp);
    player.regularTp = player.tp || 0;
    player.regularSkills = player.skills || {};
    const mazeTotalXP = player.mazeTotalXP || 0;
    applyTotalXPToLive(player, mazeTotalXP);
    player.skills = player.mazeSkills || {};
    player.tp = player.mazeTp ?? reconcileTP(player.level, player.skills);
    player.mazeXPSwapped = true;
}
/**
 * Write the live maze track back to its parked fields and restore the outside
 * track. Runs before the loadout translation in exitMazeState so that the
 * restored petals derive their health from the OUTSIDE petalHealth talent.
 */
function exitMazeProgression(player) {
    if (!player.mazeXPSwapped)
        return;
    player.mazeTotalXP = calculateTotalXP(player.level, player.xp);
    player.mazeTp = player.tp || 0;
    player.mazeSkills = player.skills || {};
    applyTotalXPToLive(player, player.regularTotalXP || 0);
    player.skills = player.regularSkills || {};
    player.tp = player.regularTp || 0;
    player.regularTotalXP = undefined;
    player.regularTp = undefined;
    player.regularSkills = undefined;
    player.mazeXPSwapped = false;
}
/** Shallow clone of a PlayerInventory (flat numeric triples). */
function cloneInventory(inv) {
    return inv ? [...inv] : [];
}
/**
 * Everything the player currently owns = free inventory + everything equipped
 * in the given loadout. Equipping physically removes a petal from the
 * inventory, so inventory ∪ loadout is the full collection. Returned in
 * regular-world terms (callers pass regular-terms inputs).
 */
function buildCollection(inventory, loadout) {
    const collection = cloneInventory(inventory);
    for (const item of loadout || []) {
        if (!item || !item.rarity)
            continue;
        const key = loadoutItemKey(item);
        if (key)
            (0, inventoryCodec_3.addItem)(collection, item.rarity, key, 1);
    }
    return collection;
}
/**
 * Cap a loadout PRESET to what the collection actually contains: walk the slots
 * in order and keep a petal only while an unused copy remains in a working copy
 * of the collection, else null that slot. Lets a preset reference petals that
 * are also equipped in the OTHER loadout (shared presets) while never
 * over-committing beyond the owned count. Pure — returns a fresh array.
 */
function capLoadoutToCollection(loadout, collection) {
    const remaining = cloneInventory(collection);
    return (loadout || []).map(item => {
        if (!item || !item.rarity)
            return item ? { ...item } : null;
        const key = loadoutItemKey(item);
        if (key && (0, inventoryCodec_3.hasItem)(remaining, item.rarity, key, 1)) {
            (0, inventoryCodec_3.removeItem)(remaining, item.rarity, key, 1);
            return { type: item.type, rarity: item.rarity, petalType: item.petalType };
        }
        return null;
    });
}
/**
 * Regular-world state for a player currently inside the maze. player.inventory
 * holds the maze inventory (collection − mazePreset, regular terms) and
 * player.mazeLoadout holds the preset (regular terms), so their union is the
 * full collection. Restore the stashed regular loadout preset (capped to that
 * collection — a petal absorbed away mid-run drops out) and split the remainder
 * into the regular free inventory. Pure; used by both savePlayerProgress and
 * exitMazeState so a crash mid-maze and a clean exit produce identical results.
 */
function buildRegularFromMaze(player) {
    const collection = buildCollection(player.inventory, player.mazeLoadout);
    const loadout = capLoadoutToCollection(player.regularLoadout, collection);
    const inventory = cloneInventory(collection);
    for (const item of loadout) {
        if (!item || !item.rarity)
            continue;
        const key = loadoutItemKey(item);
        if (key)
            (0, inventoryCodec_3.removeItem)(inventory, item.rarity, key, 1);
    }
    return { inventory, loadout };
}
/**
 * Enter the maze on the player's SEPARATE maze loadout preset — the regular
 * loadout is never touched. Steps:
 *   1. collection = regular inventory + regular loadout (everything owned).
 *   2. Stash the pristine regular loadout in `regularLoadout` for exit restore.
 *   3. Resolve the maze preset: player.mazeLoadout if set, else default to a
 *      copy of the regular loadout (so players who never customise get the old
 *      "enter on your regular build" behaviour). Cap it to the collection.
 *   4. Maze inventory = collection − preset, so a maze-equipped petal isn't also
 *      shown/absorbable in the inventory. Regular terms; live during the run.
 *   5. Live loadout = preset shifted DOWN one rarity ("petals decrease 1 rarity
 *      going in"), with active-slot (0-9) petals still above the maze cap
 *      (MAZE_MAX_PETAL_RARITY_INDEX = regular super+) BENCHED — left out of the
 *      live loadout but preserved in the preset, so they return on exit and are
 *      never dumped into the inventory. Secondary slots 10+ shift, never capped.
 * Idempotent per maze session via mazeRarityShifted. Saves persist the
 * regular-world translation via buildRegularFromMaze, so the DB never holds maze
 * terms and a crash can't corrupt the regular loadout.
 */
function applyMazeLoadout(player, io) {
    if (player.mazeRarityShifted)
        return;
    // Everything owned at entry.
    const collection = buildCollection(player.inventory, player.loadout);
    // Stash the pristine regular loadout for exit restore.
    if (!player.regularLoadout) {
        player.regularLoadout = (player.loadout || []).map(item => (item ? { ...item } : null));
    }
    // Maze preset (regular terms): configured maze loadout, or default to the
    // regular loadout the first time. Capped to what's actually owned.
    const rawPreset = player.mazeLoadout !== undefined ? player.mazeLoadout : (player.loadout || []);
    const preset = capLoadoutToCollection(rawPreset, collection);
    player.mazeLoadout = preset.map(item => (item ? { ...item } : null));
    // Maze inventory = collection − preset.
    const mazeInventory = cloneInventory(collection);
    for (const item of preset) {
        if (!item || !item.rarity)
            continue;
        const key = loadoutItemKey(item);
        if (key)
            (0, inventoryCodec_3.removeItem)(mazeInventory, item.rarity, key, 1);
    }
    player.inventory = mazeInventory;
    // Live loadout = preset shifted down, over-cap active slots benched.
    const maxCapIdx = maze_1.MAZE_MAX_PETAL_RARITY_INDEX;
    player.loadout = preset.map((item, slot) => {
        if (!item || !item.rarity)
            return null;
        const idx = (0, petals_2.getRarityIndex)(item.rarity);
        const shiftedIdx = idx > 0 ? idx - 1 : 0;
        if (slot < 10 && shiftedIdx > maxCapIdx)
            return null;
        const shifted = { ...item, rarity: petals_2.RARITY_LEVELS[shiftedIdx] };
        if (shifted.type === 'petal')
            applyPetalHealthBonus(shifted, player);
        return shifted;
    });
    player.mazeRarityShifted = true;
    recalculatePlayerStats(player, io);
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
 * Take a player out of maze state: rebuild the regular-world state (regular
 * loadout preset restored from the stash and capped to the current collection,
 * the rest split back into the regular free inventory) and clear the maze
 * bookkeeping. Petals picked up / absorbed during the run are already folded
 * into player.inventory (the maze inventory), so buildRegularFromMaze carries
 * them across. Used when a player is moved out of the maze without a
 * re-authentication (respawn outside, admin teleport); leaving via the title
 * screen restores implicitly because the last save wrote the same translation.
 */
function exitMazeState(player, io) {
    const wasSwapped = player.mazeXPSwapped;
    // Restore the outside talents before petal health is re-derived below:
    // applyPetalHealthBonus must see the outside petalHealth tier.
    exitMazeProgression(player);
    if (wasSwapped)
        emitSkillsUpdate(player, io);
    if (player.mazeRarityShifted) {
        const regular = buildRegularFromMaze(player);
        player.inventory = regular.inventory;
        player.loadout = regular.loadout;
        player.regularLoadout = undefined;
        player.mazeRarityShifted = false;
        player.mazeEntryCounts = undefined;
        // Re-derive petal health for the restored rarities under outside talents.
        for (const item of player.loadout) {
            if (item && item.type === 'petal')
                applyPetalHealthBonus(item, player);
        }
        recalculatePlayerStats(player, io);
    }
    player.inMaze = false;
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
    for (const enemy of (0, enemyRegistry_1.liveEnemies)()) {
        const dx = (0, mobFields_1.mobX)(enemy.entity) - x;
        const dy = (0, mobFields_1.mobY)(enemy.entity) - y;
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
    for (const enemy of (0, enemyRegistry_1.liveEnemies)()) {
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const mobRadius = (mobStats ? (mobStats.size * 40) / 2 : 20)
            * (0, mobs_1.getEnemySizeScale)(!!enemy.ownerId, enemy.tier, enemy.type, enemy.id);
        const dx = (0, mobFields_1.mobX)(enemy.entity) - x;
        const dy = (0, mobFields_1.mobY)(enemy.entity) - y;
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
/*
 * `respawnPlayer` and `getSpawnTypeForLevel` used to live here and have been
 * deleted: nothing could reach either of them.
 *
 * `respawnPlayer`'s only caller was a `requestRespawn` socket handler, and no
 * client ever emitted that event — the death screen's button clicks
 * `exitButton`, which returns to the title screen, and re-entering the game
 * re-authenticates. So the LIVE player spawn path is, and has only ever been,
 * the `authenticate` handler in connection/session.ts. The handler and the
 * `requestRespawn` wire opcode are gone too.
 *
 * That matters beyond dead weight, because the two disagreed. `respawnPlayer`
 * chose a spawn zone by `getSpawnTypeForLevel(player.level)`, so it read as if
 * high-level players spawn in high-tier zones. `authenticate` does no such
 * thing: 'default' picks a `spawnType === 'common'` zone (preferring section 0)
 * and a named biome goes through `getSpawnPositionInBiome`, which admits only
 * biomes passing `isBiomeSafeForSpawn`. Level never enters into it. Anything
 * deriving "where can a player be?" from the deleted function got a wrong
 * answer — `botManager.getSpawnAnchorElements` did exactly that, which is why
 * it now mirrors `authenticate` instead.
 */
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
/**
 * TP already spent on a talent tree: for each skill, the sum of every tier
 * cost from common up to the unlocked tier. Used to reconcile a track's TP
 * pool from its level when no explicit TP figure was persisted.
 */
function countSpentTP(skills) {
    if (!skills)
        return 0;
    let total = 0;
    for (const tier of Object.values(skills)) {
        const index = tier ? (0, petals_2.getRarityIndex)(tier) : -1;
        for (let i = 0; i <= index; i++)
            total += RARITY_TP_COSTS[petals_2.RARITY_LEVELS[i]];
    }
    return total;
}
/** Unspent TP for a track that earned 1 TP per level and spent some on `skills`. */
function reconcileTP(level, skills) {
    return Math.max(0, level - countSpentTP(skills));
}
/** True while the live level/xp/tp/skills describe the MAZE track. */
function isMazeTrackLive(player) {
    return !!(player.inMaze && player.mazeXPSwapped);
}
/** Total XP on the OUTSIDE track, wherever the player currently stands. */
function getOutsideTotalXP(player) {
    return isMazeTrackLive(player)
        ? (player.regularTotalXP || 0)
        : calculateTotalXP(player.level, player.xp);
}
/** Total XP on the MAZE track, wherever the player currently stands. */
function getMazeTotalXP(player) {
    return isMazeTrackLive(player)
        ? calculateTotalXP(player.level, player.xp)
        : (player.mazeTotalXP || 0);
}
/**
 * The talent tree the `absorbing` skill is read from. Absorbing only pays out
 * inside the maze but is bought outside, so it stays an outside-tree talent —
 * moving it would silently void every TP already spent on it.
 */
function getAbsorbingTier(player) {
    return isMazeTrackLive(player)
        ? player.regularSkills?.absorbing
        : player.skills?.absorbing;
}
/** Point the live level/xp/xpToNextLevel triple at a given totalXP. */
function applyTotalXPToLive(player, totalXP) {
    const level = calculateLevelFromTotalXP(totalXP);
    player.level = level;
    player.xp = calculateCurrentLevelXP(totalXP, level);
    player.xpToNextLevel = calculateXPRequirement(level);
}
function calculateDamageFromLevel(level) {
    return constants_1.PLAYER_DAMAGE + Math.ceil(Math.pow(level, 1.5) * constants_1.DAMAGE_PER_LEVEL);
}
function applyPetalHealthBonus(petal, player) {
    if (!petal || petal.type !== 'petal' || !petal.petalType)
        return;
    const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity || 'common');
    if (!petalStats)
        return;
    // Skills are disabled inside the PVP arena.
    const petalHealthMultiplier = player.inPvpArena ? 1 : (0, skill_multipliers_1.getStatSkillMultiplier)(player.skills?.petalHealth);
    const maxHealth = Math.round(petalStats.health * petalHealthMultiplier);
    petal.maxHealth = maxHealth;
    if (petal.health !== undefined) {
        petal.health = Math.min(petal.health, maxHealth);
    }
}
/**
 * Recalculate and apply player stats based on level, skills, and equipped petal modifiers
 */
function recalculatePlayerStats(player, io) {
    // Get base stats from level
    const baseMaxHealth = calculateMaxHealthFromLevel(player.level);
    const baseDamage = calculateDamageFromLevel(player.level);
    // Apply skill multipliers — disabled in the PVP arena.
    const healthMultiplier = player.inPvpArena ? 1 : (0, skill_multipliers_1.getStatSkillMultiplier)(player.skills?.playerHealth);
    const damageMultiplier = player.inPvpArena ? 1 : (0, skill_multipliers_1.getStatSkillMultiplier)(player.skills?.damage);
    // Get petal modifiers
    const petalModifiers = (0, playerModifiers_1.calculatePlayerModifiers)(player);
    // Store old maxHealth to calculate health percentage
    const oldMaxHealth = player.maxHealth || 0;
    // Apply all multipliers (use 1.0 as fallback if modifier is undefined).
    // PVP arena overrides max health to a fixed value so all players are on equal footing.
    const newMaxHealth = player.inPvpArena
        ? constants_1.PVP_MAX_HEALTH
        : Math.round(baseMaxHealth * healthMultiplier * (petalModifiers.maxHealth ?? 1.0));
    player.damage = Math.round(baseDamage * damageMultiplier * (petalModifiers.damage ?? 1.0));
    // Clamp to what the collision system can contain. Beyond 6x the hitbox
    // (PLAYER_SIZE 40 → 240px) approaches WALL_TILE_SIZE (300px), and the
    // per-tile min-overlap wall resolver cannot reliably contain a body as
    // large as the tiles themselves — stacked size petals (two apex airs = 9x)
    // let players squeeze through walls. 6x keeps every single-copy build
    // intact (largest is air apex × soil apex = 5.4x) and, as before, guards
    // the Infinity/NaN/<=0 degenerate hitbox that hangs the tile-collision
    // scans (see checkTileCollision's guard).
    const rawSizeMult = petalModifiers.playerRadius ?? 1.0;
    player.sizeMultiplier = (Number.isFinite(rawSizeMult) && rawSizeMult > 0) ? Math.min(rawSizeMult, 6) : 1.0;
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
        (0, wireOutbox_1.getWireOutbox)().toSocket((0, utils_1.getOriginalSocketId)(player.id), 'playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(player));
    }
}
/**
 * Grant XP on the OUTSIDE track. Every mob and boss kill routes here — kills
 * made *inside* the maze included, which is the whole point of the split: maze
 * mobs feed your outside level only. When the maze track is live the XP is
 * banked into the parked outside total, so it produces no level-up, no TP and
 * no stat change until the player leaves.
 */
function addXPToPlayer(player, xp, socketId, io) {
    if (isMazeTrackLive(player)) {
        player.regularTotalXP = Math.max(0, (player.regularTotalXP || 0) + xp);
        return;
    }
    applyXPToLiveTrack(player, xp, io);
}
/**
 * Grant XP on the MAZE track. Only absorbing does this, and it grants outside
 * XP too (see the absorbItems handler) — absorbing is the sole way to raise
 * your maze level.
 */
function addMazeXPToPlayer(player, xp, io) {
    if (isMazeTrackLive(player)) {
        applyXPToLiveTrack(player, xp, io);
        return;
    }
    player.mazeTotalXP = Math.max(0, (player.mazeTotalXP || 0) + xp);
}
/**
 * Apply XP to whichever track is currently live, handling level-ups, TP awards
 * and the stat recalculation that follows.
 */
function applyXPToLiveTrack(player, xp, io) {
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
            (0, wireOutbox_1.getWireOutbox)().toSocket((0, utils_1.getOriginalSocketId)(player.id), 'levelUp', {
                playerId: player.id,
                level: level,
                maxHealth: calculateMaxHealthFromLevel(level),
                damage: calculateDamageFromLevel(level)
            });
        }
        // Emit skills update only to the affected player
        io.to((0, utils_1.getOriginalSocketId)(player.id)).emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });
    }
}
function savePlayerProgress(player, userId, database) {
    if (userId) {
        // Both progression tracks are persisted every save, read through the
        // accessors rather than off the live fields — inside the maze the live
        // level/tp/skills are the MAZE track, and writing those into totalXP
        // would destroy the player's outside level.
        const totalXP = getOutsideTotalXP(player);
        const mazeTotalXP = getMazeTotalXP(player);
        const mazeLive = isMazeTrackLive(player);
        const outsideTp = mazeLive ? (player.regularTp || 0) : (player.tp || 0);
        const outsideSkills = mazeLive ? (player.regularSkills || {}) : (player.skills || {});
        const mazeTp = mazeLive ? (player.tp || 0) : (player.mazeTp || 0);
        const mazeSkills = mazeLive ? (player.skills || {}) : (player.mazeSkills || {});
        // While in PVP OR the maze, the live `loadout`/`inventory` are temporary
        // mode-specific versions and the persisted REGULAR state must be
        // reconstructed so mode play never clobbers it (crash-safe, and the last
        // save doubles as the exit conversion when leaving via the title screen).
        // PVP stashes both regular versions. The maze runs on its own preset with
        // a maze inventory (collection − preset); buildRegularFromMaze folds the
        // preset back in and restores the regular loadout to get regular-world
        // terms. The maze loadout preset itself is persisted separately below.
        let inventoryToSave;
        let loadoutSource;
        if (player.inPvpArena) {
            inventoryToSave = player.regularInventory || [];
            loadoutSource = player.regularLoadout || [];
        }
        else if (player.inMaze && player.mazeRarityShifted) {
            const regular = buildRegularFromMaze(player);
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
        // The separate maze loadout preset (regular-world terms) is persisted on
        // every save so it survives across sessions, independent of the regular
        // loadout. undefined = never customised (defaults to the regular loadout
        // on first maze entry); an explicit array (incl. all-null) is respected.
        const cleanMazeLoadout = player.mazeLoadout === undefined
            ? undefined
            : player.mazeLoadout.map(item => item
                ? { type: item.type, rarity: item.rarity, petalType: item.petalType }
                : null);
        database.savePlayer(userId, {
            totalXP: totalXP,
            mazeTotalXP: mazeTotalXP,
            inventory: (0, inventoryCodec_3.inventoryToDict)(inventoryToSave),
            loadout: cleanLoadout,
            mazeLoadout: cleanMazeLoadout,
            tp: outsideTp,
            skills: outsideSkills,
            mazeTp: mazeTp,
            mazeSkills: mazeSkills,
            mobKills: player.mobKills || {},
            stars: player.stars || 0,
            renderFlags: player.renderFlags || 0,
            equippedSkinId: player.equippedSkinId || ''
        });
    }
}
