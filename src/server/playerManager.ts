import { Server as SocketIOServer } from 'socket.io';
import { ServerPlayer, PlayerInventory } from '../player';
import { Item } from '../item';
import { getPetalStats, PlayerModifiers } from '../petals';
import { 
    WORLD_MAP, 
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
    players
} from '../constants';
import { MapElement } from '../constants';
import { RARITY_LEVELS, Rarity } from '../petals';
import { getDamageMultiplier } from '../petal_actions';

const RARITY_TP_COSTS: Record<string, number> = {
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

// Helper function to create initial inventory with basic petals
export function createInitialInventory(): PlayerInventory {
    return {
        common: {
            'petal_basic': 5
        }
    };
}

export function addItem(inventory: PlayerInventory, rarity: string, type: string, count: number) {
    if (!inventory[rarity]) {
        inventory[rarity] = {};
    }
    if (!inventory[rarity][type]) {
        inventory[rarity][type] = 0;
    }
    inventory[rarity][type] += count;
}

export function removeItem(inventory: PlayerInventory, rarity: string, type: string, count: number): boolean {
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

export function hasItem(inventory: PlayerInventory, rarity: string, type: string, count: number): boolean {
    return inventory[rarity]?.[type] >= count;
}

export function respawnPlayer(player: ServerPlayer, io: SocketIOServer) {
    // Find valid spawn points for player's level
    const validSpawnPoints = WORLD_MAP.filter(element =>
        element.type === 'spawn' &&
        element.properties?.spawnType === getSpawnTypeForLevel(player.level)
    );

    if (validSpawnPoints.length > 0) {
        // Choose random spawn point
        const spawn = validSpawnPoints[Math.floor(Math.random() * validSpawnPoints.length)];
        player.x = (spawn.x + Math.random() * spawn.width) * SCALE_FACTOR;
        player.y = (spawn.y + Math.random() * spawn.height) * SCALE_FACTOR;
    } else {
        // Fallback to old spawn logic if no valid spawn points
        console.warn('No valid spawn points found for level', player.level);
        player.x = Math.random() * ACTUAL_WORLD_WIDTH;
        player.y = Math.random() * ACTUAL_WORLD_HEIGHT;
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

    // Choose a random biome from the safe ones
    const biome = safeBiomes[Math.floor(Math.random() * safeBiomes.length)];
    
    // Generate a random position within the biome, with some padding from edges
    const padding = 50; // Padding from biome edges
    const x = biome.x + padding + Math.random() * Math.max(0, biome.width - padding * 2);
    const y = biome.y + padding + Math.random() * Math.max(0, biome.height - padding * 2);
    
    console.log(`Spawning in ${biomeName} biome at (${x.toFixed(0)}, ${y.toFixed(0)})`);
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
        unique: 1.8
    };
    return multipliers[skillTier] || 1;
}

export function applyPetalHealthBonus(petal: Item | null, player: ServerPlayer): void {
    if (!petal || petal.type !== 'petal' || !petal.petalType) return;
    
    const petalStats = getPetalStats(petal.petalType, petal.rarity || 'common');
    if (!petalStats) return;
    
    const petalHealthMultiplier = getSkillMultiplier(player.skills?.petalHealth);
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
        speed: 1.0
    };
    
    if (!player.loadout) return modifiers;
    
    // Sum up modifiers from all equipped petals
    for (const item of player.loadout) {
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
    
    // Apply skill multipliers
    const healthMultiplier = getSkillMultiplier(player.skills?.playerHealth);
    const damageMultiplier = getSkillMultiplier(player.skills?.damage);
    
    // Get petal modifiers
    const petalModifiers = calculatePlayerModifiers(player);
    
    // Store old maxHealth to calculate health percentage
    const oldMaxHealth = player.maxHealth || 0;
    
    // Apply all multipliers (use 1.0 as fallback if modifier is undefined)
    const newMaxHealth = Math.round(baseMaxHealth * healthMultiplier * (petalModifiers.maxHealth ?? 1.0));
    player.damage = Math.round(baseDamage * damageMultiplier * (petalModifiers.damage ?? 1.0));
    
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
    
    // Emit update if io is provided
    if (io) {
        io.emit('playerUpdated', player);
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

export function savePlayerProgress(
    player: ServerPlayer, 
    userId: string,
    database: any
) {
    if (userId) {
        // Calculate total XP from current level and XP
        const totalXP = calculateTotalXP(player.level, player.xp);

        // Filter loadout to only save type and rarity (not status fields)
        const cleanLoadout = (player.loadout || []).map(item => {
            if (!item) return null;
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
        } as any);
    }
}

export { RARITY_TP_COSTS };

