import { Server as SocketIOServer } from '../ws_server';
import { ServerPlayer } from '../player';
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
import { ID_TO_RARITY, ID_TO_ITEM_KEY } from '../inventoryCodec';
import { playerUserIds } from './gameState';
import { WORLD_MAP, WALL_GRID } from '../map_data';
import { MapElement } from '../constants';
import {
    addItem,
    removeItem,
    hasItem,
    createInitialInventory,
    inventoryToDict
} from '../inventoryCodec';
import { getMobStats } from '../mobs';

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
        io.to(player.id).emit('inventoryUpdated', player.inventory);
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
        io.to(player.id).emit('inventoryUpdated', player.inventory);
    }
    if (savePlayerProgress) {
        const userId = playerUserIds[player.id];
        if (userId) savePlayerProgress(player, userId);
    }
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
        aggroRadius: 0
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

export function addXPToPlayer(
    player: ServerPlayer, 
    xp: number, 
    socketId: string | undefined,
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

export function savePlayerProgress(
    player: ServerPlayer, 
    userId: string,
    database: any
) {
    if (userId) {
        // Calculate total XP from current level and XP
        const totalXP = calculateTotalXP(player.level, player.xp);

        // While in PVP, the live `inventory`/`loadout` are the temporary PVP
        // versions; save the stashed regular versions so PVP play doesn't clobber
        // the player's persisted data.
        const inventoryToSave = player.inPvpArena
            ? (player.regularInventory || [])
            : (player.inventory || []);
        const loadoutSource = player.inPvpArena
            ? (player.regularLoadout || [])
            : (player.loadout || []);

        // Filter loadout to only save type and rarity (not status fields)
        const cleanLoadout = loadoutSource.map(item => {
            if (!item) return null;
            return {
                type: item.type,
                rarity: item.rarity,
                petalType: item.petalType
            };
        });

        database.savePlayer(userId, {
            totalXP: totalXP,
            inventory: inventoryToDict(inventoryToSave),
            loadout: cleanLoadout,
            tp: player.tp || 0,
            skills: player.skills || {},
            mobKills: player.mobKills || {},
            stars: player.stars || 0,
            renderFlags: player.renderFlags || 0,
            equippedSkinId: player.equippedSkinId || ''
        } as any);
    }
}

export { RARITY_TP_COSTS };

