import { Server as SocketIOServer } from '../ws_server';
import { ServerPlayer, PlayerInventory, PlayerSkills } from '../player';
import { sanitizePlayerForClient } from './playerWire';
import { Item } from '../item';
import { getPetalStats, PlayerModifiers } from '../petals';
import {
    SCALE_FACTOR,
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    RESPAWN_INVULNERABILITY_TIME,
    PLAYER_MAX_HEALTH,
    HEALTH_PER_LEVEL,
    PLAYER_DAMAGE,
    DAMAGE_PER_LEVEL,
    BASE_XP_REQUIREMENT,
    XP_MULTIPLIER,
    enemies,
    PLAYER_SIZE,
    getTileState,
    isTileIdBlocking,
    WALL_TILE_SIZE,
    worldToTileX,
    worldToTileY,
    PVP_ARENA_SPAWN_X,
    PVP_ARENA_SPAWN_Y,
    isInPvpArena,
    PVP_MAX_HEALTH,
    PVP_INVENTORY_KEEP_RATIO
} from '../constants';
import {
    getActiveMaze,
    isInMazeRegion,
    MAZE_CELL_SIZE,
    MAZE_MAX_PETAL_RARITY_INDEX
} from '../maze';
import { getRarityIndex, RARITY_LEVELS } from '../petals';
import { ITEM_KEY_TO_ID } from '../inventoryCodec';
import { ID_TO_RARITY, ID_TO_ITEM_KEY } from '../inventoryCodec';
import { playerUserIds } from './gameState';
import { getOriginalSocketId } from './utils';
import { WORLD_MAP, WALL_GRID } from '../map_data';
import { MapElement } from '../constants';
import {
    addItem,
    removeItem,
    hasItem,
    getItemCount,
    createInitialInventory,
    inventoryToDict
} from '../inventoryCodec';
import { getMobStats, getEnemySizeScale } from '../mobs';

// Re-export inventory functions so existing imports keep working
export { addItem, removeItem, hasItem, createInitialInventory };

const RARITY_TP_COSTS: Record<string, number> = {
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

// Helper function to create initial basic petals for new players
export function createInitialBasicPetals() {
    const basicPetalStats = getPetalStats('basic', 'common');
    if (!basicPetalStats) {
        console.error('Failed to get basic petal stats');
        return [];
    }

    return Array(5).fill(null).map(() => ({
        type: 'petal' as const,
        rarity: 'common' as const,
        petalType: 'basic',
        health: basicPetalStats.health,
        maxHealth: basicPetalStats.health,
        onCooldown: true
    }));
}

/**
 * Build the fixed PVP loadout: 5 common basic petals, then 5 empty extra slots.
 */
function createPvpLoadout(): (Item | null)[] {
    return createInitialBasicPetals().concat(Array(5).fill(null));
}

/**
 * Enter the PVP arena: stash the regular inventory/loadout, give the player a
 * fresh PVP loadout (5 common basics) and an empty PVP inventory, reset PVP
 * score, and recalc stats so the fixed PVP max health applies. Idempotent —
 * calling this while already in PVP just resets the PVP loadout/inventory.
 */
export function enterPvpArena(player: ServerPlayer, io?: SocketIOServer): void {
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
        io.to(getOriginalSocketId(player.id)).emit('inventoryUpdated', player.inventory);
    }
}

/**
 * Leave the PVP arena: transfer 25% of the PVP inventory back to the regular
 * inventory, restore the regular inventory/loadout, recalc stats, full-heal,
 * and emit the inventory update.
 */
export function exitPvpArena(
    player: ServerPlayer,
    io?: SocketIOServer,
    savePlayerProgress?: (player: ServerPlayer, userId: string) => void
): void {
    const pvpInventory = player.inventory || [];
    const restored = player.regularInventory || createInitialInventory();
    for (let i = 0; i < pvpInventory.length; i += 3) {
        const rarityId = pvpInventory[i];
        const itemId = pvpInventory[i + 1];
        const count = pvpInventory[i + 2];
        const kept = Math.floor(count * PVP_INVENTORY_KEEP_RATIO);
        if (kept <= 0) continue;
        const rarity = ID_TO_RARITY.get(rarityId);
        const itemKey = ID_TO_ITEM_KEY.get(itemId);
        if (!rarity || !itemKey) continue;
        addItem(restored, rarity, itemKey, kept);
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
        io.to(getOriginalSocketId(player.id)).emit('inventoryUpdated', player.inventory);
        // Push the restored regular loadout authoritatively so the client stops
        // holding the PVP loadout the instant it leaves the arena. Without this
        // the client keeps the PVP petals until the next tick sync and can emit
        // a stale `updateLoadout` that the server would persist as the regular
        // loadout (the mode-tag guard in the updateLoadout handler is the other
        // half of that fix).
        io.to(getOriginalSocketId(player.id)).emit('playerUpdated', sanitizePlayerForClient(player));
    }
    if (savePlayerProgress) {
        const userId = playerUserIds[player.id];
        if (userId) savePlayerProgress(player, userId);
    }
}

/**
 * Random point inside the maze spawn room (small jitter so players don't
 * stack exactly on one pixel).
 */
export function getMazeSpawnPosition(): { x: number; y: number } {
    const maze = getActiveMaze();
    if (!maze) {
        // Maze not initialized (shouldn't happen — server sets it at startup).
        return { x: ACTUAL_WORLD_WIDTH / 2, y: ACTUAL_WORLD_HEIGHT / 2 };
    }
    const jitter = MAZE_CELL_SIZE * 0.6;
    return {
        x: maze.spawnX + (Math.random() - 0.5) * jitter,
        y: maze.spawnY + (Math.random() - 0.5) * jitter,
    };
}

/** Inventory item key for a loadout item, or null if it has none. */
function loadoutItemKey(item: Item): string | null {
    if (item.type === 'petal') return item.petalType ? `petal_${item.petalType}` : null;
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
export function enterMazeState(player: ServerPlayer, io?: SocketIOServer): void {
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
function emitSkillsUpdate(player: ServerPlayer, io?: SocketIOServer): void {
    if (!io) return;
    io.to(getOriginalSocketId(player.id)).emit('skillsUpdated', {
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
export function enterMazeProgression(player: ServerPlayer): void {
    if (player.mazeXPSwapped) return;
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
export function exitMazeProgression(player: ServerPlayer): void {
    if (!player.mazeXPSwapped) return;
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
function cloneInventory(inv?: PlayerInventory): PlayerInventory {
    return inv ? [...inv] : [];
}

/**
 * Everything the player currently owns = free inventory + everything equipped
 * in the given loadout. Equipping physically removes a petal from the
 * inventory, so inventory ∪ loadout is the full collection. Returned in
 * regular-world terms (callers pass regular-terms inputs).
 */
export function buildCollection(inventory: PlayerInventory | undefined, loadout: (Item | null)[] | undefined): PlayerInventory {
    const collection = cloneInventory(inventory);
    for (const item of loadout || []) {
        if (!item || !item.rarity) continue;
        const key = loadoutItemKey(item);
        if (key) addItem(collection, item.rarity, key, 1);
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
export function capLoadoutToCollection(loadout: (Item | null)[] | undefined, collection: PlayerInventory): (Item | null)[] {
    const remaining = cloneInventory(collection);
    return (loadout || []).map(item => {
        if (!item || !item.rarity) return item ? { ...item } : null;
        const key = loadoutItemKey(item);
        if (key && hasItem(remaining, item.rarity, key, 1)) {
            removeItem(remaining, item.rarity, key, 1);
            return { type: item.type, rarity: item.rarity, petalType: item.petalType } as Item;
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
export function buildRegularFromMaze(player: ServerPlayer): { inventory: PlayerInventory; loadout: (Item | null)[] } {
    const collection = buildCollection(player.inventory, player.mazeLoadout);
    const loadout = capLoadoutToCollection(player.regularLoadout, collection);
    const inventory = cloneInventory(collection);
    for (const item of loadout) {
        if (!item || !item.rarity) continue;
        const key = loadoutItemKey(item);
        if (key) removeItem(inventory, item.rarity, key, 1);
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
export function applyMazeLoadout(player: ServerPlayer, io?: SocketIOServer): void {
    if (player.mazeRarityShifted) return;
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
        if (!item || !item.rarity) continue;
        const key = loadoutItemKey(item);
        if (key) removeItem(mazeInventory, item.rarity, key, 1);
    }
    player.inventory = mazeInventory;
    // Live loadout = preset shifted down, over-cap active slots benched.
    const maxCapIdx = MAZE_MAX_PETAL_RARITY_INDEX;
    player.loadout = preset.map((item, slot) => {
        if (!item || !item.rarity) return null;
        const idx = getRarityIndex(item.rarity);
        const shiftedIdx = idx > 0 ? idx - 1 : 0;
        if (slot < 10 && shiftedIdx > maxCapIdx) return null;
        const shifted: Item = { ...item, rarity: RARITY_LEVELS[shiftedIdx] as Item['rarity'] };
        if (shifted.type === 'petal') applyPetalHealthBonus(shifted, player);
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
function snapshotMazeEntryCounts(player: ServerPlayer): void {
    if (player.mazeEntryCounts) return;
    const entryCounts: Record<string, number> = {};
    const inv = player.inventory || [];
    for (let i = 0; i + 2 < inv.length; i += 3) {
        const key = `${inv[i]}|${inv[i + 1]}`;
        entryCounts[key] = (entryCounts[key] || 0) + inv[i + 2];
    }
    for (const item of player.loadout || []) {
        if (!item || !item.rarity) continue;
        const rarityId = getRarityIndex(item.rarity);
        const itemKey = loadoutItemKey(item);
        const itemId = itemKey !== null ? ITEM_KEY_TO_ID.get(itemKey) : undefined;
        if (rarityId < 0 || itemId === undefined) continue;
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
export function getMazeAbsorbableCount(player: ServerPlayer, rarity: string, itemKey: string): number {
    if (!player.inMaze || !player.mazeRarityShifted || !player.mazeEntryCounts) return 0;
    const rarityId = getRarityIndex(rarity);
    const itemId = ITEM_KEY_TO_ID.get(itemKey);
    if (rarityId < 0 || itemId === undefined) return 0;
    let total = getItemCount(player.inventory || [], rarity, itemKey);
    for (const item of player.loadout || []) {
        if (!item || item.rarity !== rarity) continue;
        if (loadoutItemKey(item) === itemKey) total++;
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
export function exitMazeState(player: ServerPlayer, io?: SocketIOServer): void {
    const wasSwapped = player.mazeXPSwapped;
    // Restore the outside talents before petal health is re-derived below:
    // applyPetalHealthBonus must see the outside petalHealth tier.
    exitMazeProgression(player);
    if (wasSwapped) emitSkillsUpdate(player, io);
    if (player.mazeRarityShifted) {
        const regular = buildRegularFromMaze(player);
        player.inventory = regular.inventory;
        player.loadout = regular.loadout;
        player.regularLoadout = undefined;
        player.mazeRarityShifted = false;
        player.mazeEntryCounts = undefined;
        // Re-derive petal health for the restored rarities under outside talents.
        for (const item of player.loadout) {
            if (item && item.type === 'petal') applyPetalHealthBonus(item, player);
        }
        recalculatePlayerStats(player, io);
    }
    player.inMaze = false;
}

/**
 * Check if a position is inside a wall or water tile
 */
function isPositionInsideWall(x: number, y: number, playerSize: number = PLAYER_SIZE): boolean {
    const halfSize = playerSize / 2;

    // Check all tiles that the entity would overlap with
    const minTileX = worldToTileX(x - halfSize);
    const maxTileX = worldToTileX(x + halfSize);
    const minTileY = worldToTileY(y - halfSize);
    const maxTileY = worldToTileY(y + halfSize);

    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const tileWorldX = tileX * WALL_TILE_SIZE;
            const tileWorldY = tileY * WALL_TILE_SIZE;
            const state = getTileState(WALL_GRID, tileWorldX, tileWorldY);

            // Any blocking tile (solid/water — built-in or custom) blocks spawning
            if (isTileIdBlocking(state)) {
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
function hasTooManyMobsNearby(x: number, y: number, radius: number = 200, maxMobs: number = 5): boolean {
    let mobCount = 0;
    
    for (const enemy of enemies) {
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
function isOverlappingMob(x: number, y: number, playerSize: number = PLAYER_SIZE): boolean {
    const playerRadius = playerSize / 2;

    for (const enemy of enemies) {
        const mobStats = getMobStats(enemy.type, enemy.tier);
        const mobRadius = (mobStats ? (mobStats.size * 40) / 2 : 20)
            * getEnemySizeScale(!!enemy.ownerId, enemy.tier);
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
function isSafeSpawnPosition(x: number, y: number, playerSize: number = PLAYER_SIZE): boolean {
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
export function findSafeSpawnPosition(
    spawnArea: { x: number; y: number; width: number; height: number },
    maxAttempts: number = 50
): { x: number; y: number } | null {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const x = (spawnArea.x + Math.random() * spawnArea.width) * SCALE_FACTOR;
        const y = (spawnArea.y + Math.random() * spawnArea.height) * SCALE_FACTOR;
        
        if (isSafeSpawnPosition(x, y)) {
            return { x, y };
        }
    }
    
    // If no safe position found after maxAttempts, return null
    return null;
}

export function respawnPlayer(player: ServerPlayer, io: SocketIOServer) {
    let spawnPosition: { x: number; y: number } | null = null;

    // PVP arena: either the player picked "PVP" on the title screen, or they
    // died while inside the arena. Either way, drop them at the arena spawn
    // and start a fresh PVP session.
    const wantsPvp = player.spawnBiome === 'pvp'
        || player.inPvpArena
        || isInPvpArena(player.x, player.y);
    if (wantsPvp) {
        spawnPosition = { x: PVP_ARENA_SPAWN_X, y: PVP_ARENA_SPAWN_Y };
        // Resets PVP loadout/inventory and applies PVP-fixed max health.
        // Idempotent — safe whether the player is mid-arena or freshly spawning.
        enterPvpArena(player, io);
    }

    // Maze: players who chose the maze (or died inside it) respawn at the
    // maze entrance. Petals absorbed in the maze stay in the real inventory.
    const wantsMaze = !wantsPvp && (player.spawnBiome === 'maze'
        || player.inMaze
        || isInMazeRegion(player.x, player.y));
    if (wantsMaze) {
        spawnPosition = getMazeSpawnPosition();
        // Shift the loadout down, strip over-cap slots, snapshot absorb
        // baseline — all no-ops if already in maze state this session.
        enterMazeState(player, io);
    } else {
        // Not a maze respawn: make sure no maze-term state leaks out (also
        // converts the live inventory back if the player somehow left the
        // maze without a re-auth).
        exitMazeState(player, io);
    }

    // First, try to spawn in the biome the player selected on the title screen
    if (!spawnPosition && player.spawnBiome && player.spawnBiome !== 'default') {
        spawnPosition = getSpawnPositionInBiome(player.spawnBiome);
    }

    // If no spawn found in the player's selected biome, fall back to level-based spawn points
    if (!spawnPosition) {
        const validSpawnPoints = WORLD_MAP.filter(element =>
            element.type === 'spawn' &&
            element.properties?.spawnType === getSpawnTypeForLevel(player.level)
        );

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
                const x = Math.random() * ACTUAL_WORLD_WIDTH;
                const y = Math.random() * ACTUAL_WORLD_HEIGHT;

                if (isSafeSpawnPosition(x, y)) {
                    spawnPosition = { x, y };
                    break;
                }
            }
        }

        // Final fallback: use first spawn point or center of world (even if not safe)
        if (!spawnPosition) {
            console.warn('No safe spawn position found after all attempts - using unsafe fallback');
            const validSpawnPointsFallback = WORLD_MAP.filter(element =>
                element.type === 'spawn' &&
                element.properties?.spawnType === getSpawnTypeForLevel(player.level)
            );
            if (validSpawnPointsFallback.length > 0) {
                const spawn = validSpawnPointsFallback[0];
                spawnPosition = {
                    x: (spawn.x + spawn.width / 2) * SCALE_FACTOR,
                    y: (spawn.y + spawn.height / 2) * SCALE_FACTOR
                };
            } else {
                spawnPosition = {
                    x: ACTUAL_WORLD_WIDTH / 2,
                    y: ACTUAL_WORLD_HEIGHT / 2
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
    // Poison does not survive death
    player.poisonDamage = undefined;
    player.poisonUntil = undefined;
    player.poisonSource = undefined;

    setTimeout(() => {
        player.isInvulnerable = false;
        // Notify client that invulnerability has ended
        io.emit('playerInvulnerabilityEnded', { playerId: player.id });
    }, RESPAWN_INVULNERABILITY_TIME);
}

// Helper function to determine spawn type based on level
function getSpawnTypeForLevel(level: number): NonNullable<MapElement['properties']>['spawnType'] {
    if (level <= 5) return 'common';
    if (level <= 10) return 'uncommon';
    if (level <= 15) return 'rare';
    if (level <= 25) return 'epic';
    if (level <= 40) return 'legendary';
    return 'mythic';
}

// Helper function to check if a biome only allows mob rarities less than "rare" (common or uncommon)
export function isBiomeSafeForSpawn(biome: MapElement): boolean {
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
export function getSpawnPositionInBiome(biomeName: string): { x: number, y: number } | null {
    // Find all biome elements with the specified name
    const biomes = WORLD_MAP.filter(element => 
        element.type === 'biome' && 
        element.properties?.biomeName === biomeName &&
        element.width > 0 && 
        element.height > 0
    );

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
    return { x: x * SCALE_FACTOR, y: y * SCALE_FACTOR };
}

// XP calculation functions
export function calculateXPRequirement(level: number): number {
    return Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, level - 1));
}

export function calculateTotalXP(level: number, currentLevelXP: number): number {
    let totalXP = currentLevelXP;
    for (let i = 1; i < level; i++) {
        totalXP += calculateXPRequirement(i);
    }
    return totalXP;
}

export function calculateLevelFromTotalXP(totalXP: number): number {
    let level = 1;
    let xpNeeded = 0;
    while (xpNeeded + calculateXPRequirement(level) <= totalXP) {
        xpNeeded += calculateXPRequirement(level);
        level++;
    }
    return level;
}

export function calculateCurrentLevelXP(totalXP: number, level: number): number {
    let xpNeeded = 0;
    for (let i = 1; i < level; i++) {
        xpNeeded += calculateXPRequirement(i);
    }
    return totalXP - xpNeeded;
}

export function calculateMaxHealthFromLevel(level: number): number {
    return PLAYER_MAX_HEALTH + Math.ceil(Math.pow(level, 1.5) * HEALTH_PER_LEVEL);
}

/**
 * TP already spent on a talent tree: for each skill, the sum of every tier
 * cost from common up to the unlocked tier. Used to reconcile a track's TP
 * pool from its level when no explicit TP figure was persisted.
 */
export function countSpentTP(skills: PlayerSkills | undefined): number {
    if (!skills) return 0;
    let total = 0;
    for (const tier of Object.values(skills)) {
        const index = tier ? getRarityIndex(tier) : -1;
        for (let i = 0; i <= index; i++) total += RARITY_TP_COSTS[RARITY_LEVELS[i]];
    }
    return total;
}

/** Unspent TP for a track that earned 1 TP per level and spent some on `skills`. */
export function reconcileTP(level: number, skills: PlayerSkills | undefined): number {
    return Math.max(0, level - countSpentTP(skills));
}

/** True while the live level/xp/tp/skills describe the MAZE track. */
export function isMazeTrackLive(player: ServerPlayer): boolean {
    return !!(player.inMaze && player.mazeXPSwapped);
}

/** Total XP on the OUTSIDE track, wherever the player currently stands. */
export function getOutsideTotalXP(player: ServerPlayer): number {
    return isMazeTrackLive(player)
        ? (player.regularTotalXP || 0)
        : calculateTotalXP(player.level, player.xp);
}

/** Total XP on the MAZE track, wherever the player currently stands. */
export function getMazeTotalXP(player: ServerPlayer): number {
    return isMazeTrackLive(player)
        ? calculateTotalXP(player.level, player.xp)
        : (player.mazeTotalXP || 0);
}

/**
 * The talent tree the `absorbing` skill is read from. Absorbing only pays out
 * inside the maze but is bought outside, so it stays an outside-tree talent —
 * moving it would silently void every TP already spent on it.
 */
export function getAbsorbingTier(player: ServerPlayer): string | undefined {
    return isMazeTrackLive(player)
        ? player.regularSkills?.absorbing
        : player.skills?.absorbing;
}

/** Point the live level/xp/xpToNextLevel triple at a given totalXP. */
function applyTotalXPToLive(player: ServerPlayer, totalXP: number): void {
    const level = calculateLevelFromTotalXP(totalXP);
    player.level = level;
    player.xp = calculateCurrentLevelXP(totalXP, level);
    player.xpToNextLevel = calculateXPRequirement(level);
}

export function calculateDamageFromLevel(level: number): number {
    return PLAYER_DAMAGE + Math.ceil(Math.pow(level, 1.5) * DAMAGE_PER_LEVEL);
}

export function getSkillMultiplier(skillTier: string | undefined): number {
    if (!skillTier) return 1;
    const multipliers: Record<string, number> = {
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

export function applyPetalHealthBonus(petal: Item | null, player: ServerPlayer): void {
    if (!petal || petal.type !== 'petal' || !petal.petalType) return;

    const petalStats = getPetalStats(petal.petalType, petal.rarity || 'common');
    if (!petalStats) return;

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
export function calculatePlayerModifiers(player: ServerPlayer): PlayerModifiers {
    const modifiers: PlayerModifiers = {
        damage: 1.0,
        maxHealth: 1.0,
        speed: 1.0,
        range: 1.0,
        rotationSpeed: 1.0,
        playerRadius: 1.0,
        magnetism: 0,
        luck: 1.0,
        petalAttractionRadius: 30,
        aggroRadius: 0,
        poisonArmor: 0
    };
    
    if (!player.loadout) return modifiers;

    // Sum up modifiers from all equipped petals.
    // Secondary loadout (slots 10+) is storage only — its petals contribute no modifiers.
    for (let i = 0; i < player.loadout.length; i++) {
        if (i >= 10) break;
        const item = player.loadout[i];
        if (!item || item.type !== 'petal' || !item.petalType || !item.rarity) continue;
        
        const petalStats = getPetalStats(item.petalType, item.rarity);
        if (!petalStats || !petalStats.playerModifiers) continue;
        
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
        // Poison armor does NOT stack: gardn takes the strongest equipped lotus
        // (`player.poison_armor = std::fmax(...)` in Process/Flower.cc), the same
        // way salt's damage reflection is documented as not stacking with itself.
        if (petalModifiers.poisonArmor !== undefined && modifiers.poisonArmor !== undefined) {
            modifiers.poisonArmor = Math.max(modifiers.poisonArmor, petalModifiers.poisonArmor);
        }
    }

    return modifiers;
}

/**
 * Recalculate and apply player stats based on level, skills, and equipped petal modifiers
 */
export function recalculatePlayerStats(player: ServerPlayer, io?: SocketIOServer): void {
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
        ? PVP_MAX_HEALTH
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
        io.to(getOriginalSocketId(player.id)).emit('playerUpdated', sanitizePlayerForClient(player));
    }
}

/**
 * Grant XP on the OUTSIDE track. Every mob and boss kill routes here — kills
 * made *inside* the maze included, which is the whole point of the split: maze
 * mobs feed your outside level only. When the maze track is live the XP is
 * banked into the parked outside total, so it produces no level-up, no TP and
 * no stat change until the player leaves.
 */
export function addXPToPlayer(
    player: ServerPlayer,
    xp: number,
    socketId: string | undefined,
    io: SocketIOServer
): void {
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
export function addMazeXPToPlayer(
    player: ServerPlayer,
    xp: number,
    io: SocketIOServer
): void {
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
function applyXPToLiveTrack(
    player: ServerPlayer,
    xp: number,
    io: SocketIOServer
): void {
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
        if (!player.tp) player.tp = 0;
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
            io.to(getOriginalSocketId(player.id)).emit('levelUp', {
                playerId: player.id,
                level: level,
                maxHealth: calculateMaxHealthFromLevel(level),
                damage: calculateDamageFromLevel(level)
            });
        }

        // Emit skills update only to the affected player
        io.to(getOriginalSocketId(player.id)).emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });
    }
}

export function savePlayerProgress(
    player: ServerPlayer, 
    userId: string,
    database: any
) {
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
        let inventoryToSave: PlayerInventory;
        let loadoutSource: (Item | null)[];
        if (player.inPvpArena) {
            inventoryToSave = player.regularInventory || [];
            loadoutSource = player.regularLoadout || [];
        } else if (player.inMaze && player.mazeRarityShifted) {
            const regular = buildRegularFromMaze(player);
            inventoryToSave = regular.inventory;
            loadoutSource = regular.loadout;
        } else {
            inventoryToSave = player.inventory || [];
            loadoutSource = player.loadout || [];
        }

        // Filter loadout to only save type and rarity (not status fields)
        const cleanLoadout = loadoutSource.map(item => {
            if (!item) return null;
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
            inventory: inventoryToDict(inventoryToSave),
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
        } as any);
    }
}

export { RARITY_TP_COSTS };

