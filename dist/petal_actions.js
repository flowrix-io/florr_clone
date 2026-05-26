"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitPlayers = exports.globalPetalMemory = void 0;
exports.executePetalActions = executePetalActions;
exports.despawnPet = despawnPet;
exports.despawnAllPlayerPets = despawnAllPlayerPets;
exports.spawnPet = spawnPet;
exports.updatePlayerEffects = updatePlayerEffects;
exports.getDamageMultiplier = getDamageMultiplier;
exports.getSpeedMultiplier = getSpeedMultiplier;
exports.getShieldAmount = getShieldAmount;
exports.executePetalActionsOnSpawn = executePetalActionsOnSpawn;
exports.updatePetalActions = updatePetalActions;
exports.handlePetalCollision = handlePetalCollision;
exports.cleanupPetalActions = cleanupPetalActions;
exports.splitPlayer = splitPlayer;
exports.switchPlayer = switchPlayer;
exports.updatePetalPosition = updatePetalPosition;
const petals_1 = require("./petals");
const server_utils_1 = require("./server_utils");
const server_1 = require("./server");
const constants_1 = require("./constants");
const mobs_1 = require("./mobs");
const enemySpawner_1 = require("./server/enemySpawner");
// Global state for tracking petal actions
const petalActionStates = new Map();
// Global memory for petal actions (shared across all petals)
exports.globalPetalMemory = new Map();
exports.splitPlayers = new Map();
// Track which petals have already executed split_player to prevent re-execution
const splitExecutedPetalIds = new Set();
// Explosion throttle state
let lastExplosionTime = 0;
const EXPLOSION_THROTTLE_MS = 20;
// Lightning rate limiter for lightning_cutter (2 per second = 500ms minimum between strikes)
const lightningCutterStrikeTimes = new Map(); // playerId -> array of strike times
const LIGHTNING_CUTTER_RATE_LIMIT_MS = 500; // Minimum 500ms between strikes (2 per second)
const LIGHTNING_CUTTER_MAX_STRIKES = 2; // Maximum 2 strikes per second
// Execute petal actions
function executePetalActions(actionString, context, trigger = 'on_break') {
    if (!actionString)
        return;
    const actions = (0, petals_1.parsePetalActions)(actionString);
    for (const action of actions) {
        executeAction(action, context, trigger);
    }
}
// Execute a single action (legacy function for immediate execution like on_break)
// Note: Control flow actions (if/else/endif, loop/endloop, delay, etc.) are not supported here
// They should use the state-based execution system via executePetalActionsOnSpawn
function executeAction(action, context, trigger) {
    const { player, petalX, petalY, petalSize, enemies, io } = context;
    switch (action.type) {
        case 'heal':
            healPlayer(player, action.value || 10, io, context);
            break;
        case 'break':
            // This action is handled by the petal breaking logic in the server
            // We don't need to do anything here as the petal will be marked as broken
            break;
        case 'damage_boost':
            applyDamageBoost(player, action.value || 1.5, action.duration || 5000);
            break;
        case 'speed_boost':
            applySpeedBoost(player, action.value || 1.5, action.duration || 5000);
            break;
        case 'shield':
            applyShield(player, action.value || 50, action.duration || 3000);
            break;
        case 'explode':
            explodePetal(petalX, petalY, petalSize, action.value || 30, enemies, io, player);
            break;
        case 'lightning':
            strikeLightning(petalX, petalY, action.value || 100, enemies, io, player, context.petalDamage, context);
            break;
        // Control flow and state-based actions are not supported in immediate execution
        // These should use executePetalActionsOnSpawn instead
        case 'delay':
        case 'restart':
        case 'wait_until_collision':
        case 'if':
        case 'else':
        case 'endif':
        case 'loop':
        case 'endloop':
        case 'goto':
        case 'label':
        case 'set_memory':
        case 'get_memory':
        case 'add_memory':
        case 'multiply_memory':
        case 'set_petal_damage':
        case 'set_petal_health':
        case 'set_petal_size':
        case 'add_petal_damage':
        case 'add_petal_health':
        case 'add_petal_size':
        case 'set_player_damage':
        case 'set_player_max_health':
        case 'set_player_speed':
        case 'add_player_damage':
        case 'add_player_max_health':
        case 'add_player_speed':
        case 'compare':
        case 'compare_gt':
        case 'compare_lt':
        case 'compare_gte':
        case 'compare_lte':
        case 'compare_eq':
        case 'compare_neq':
            // These actions require state-based execution and are not supported in immediate mode
            // Silently skip them to avoid console spam
            break;
        default:
            // Only warn about truly unknown action types
            if (!['heal', 'break', 'damage_boost', 'speed_boost', 'shield', 'explode', 'lightning',
                'delay', 'restart', 'wait_until_collision', 'if', 'else', 'endif', 'loop', 'endloop',
                'goto', 'label', 'set_memory', 'get_memory', 'add_memory', 'multiply_memory',
                'set_petal_damage', 'set_petal_health', 'set_petal_size', 'add_petal_damage',
                'add_petal_health', 'add_petal_size', 'set_player_damage', 'set_player_max_health',
                'set_player_speed', 'add_player_damage', 'add_player_max_health', 'add_player_speed',
                'compare', 'compare_gt', 'compare_lt', 'compare_gte', 'compare_lte', 'compare_eq', 'compare_neq'].includes(action.type)) {
                console.warn(`Unknown action type: ${action.type}`);
            }
            break;
    }
}
// Skill multipliers based on rarity tier
const SKILL_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.35,
    legendary: 1.6,
    mythic: 2.0,
    ultra: 2.6,
    super: 3.3,
    unique: 4.0
};
function getSkillMultiplier(skillTier) {
    if (!skillTier)
        return 1.0;
    return SKILL_MULTIPLIERS[skillTier] || 1.0;
}
// Heal the player
function healPlayer(player, healAmount, io, context) {
    const oldHealth = player.health;
    // Apply rarity scaling (sqrt(3) per rarity level)
    let rarityMultiplier = 1.0;
    if (context && context.loadoutIndex !== undefined) {
        const petal = player.loadout[context.loadoutIndex];
        if (petal && petal.type === 'petal' && petal.rarity) {
            const rarityIndex = petals_1.RARITY_LEVELS.indexOf(petal.rarity);
            if (rarityIndex >= 0) {
                rarityMultiplier = Math.pow(Math.sqrt(3), rarityIndex);
            }
        }
    }
    // Apply healing multiplier skill bonus
    const healingMultiplier = getSkillMultiplier(player.skills?.healingMultiplier);
    const modifiedHealAmount = healAmount * rarityMultiplier * healingMultiplier * 3;
    player.health = Math.min(player.maxHealth, player.health + modifiedHealAmount);
    if (player.health !== oldHealth) {
        io.emit('playerHealed', {
            playerId: player.id,
            health: player.health,
            healAmount: player.health - oldHealth
        });
    }
}
// Apply damage boost to player
function applyDamageBoost(player, multiplier, duration) {
    const effect = {
        type: 'damage_boost',
        value: multiplier,
        duration: duration,
        startTime: Date.now()
    };
    // Initialize effects array if it doesn't exist
    if (!player.effects) {
        player.effects = [];
    }
    // Remove existing damage boost effects
    player.effects = player.effects.filter(e => e.type !== 'damage_boost');
    // Add new effect
    player.effects.push(effect);
    console.log(`Player ${player.id} gained damage boost: ${multiplier}x for ${duration}ms`);
}
// Apply speed boost to player
function applySpeedBoost(player, multiplier, duration) {
    const effect = {
        type: 'speed_boost',
        value: multiplier,
        duration: duration,
        startTime: Date.now()
    };
    // Initialize effects array if it doesn't exist
    if (!player.effects) {
        player.effects = [];
    }
    // Remove existing speed boost effects
    player.effects = player.effects.filter(e => e.type !== 'speed_boost');
    // Add new effect
    player.effects.push(effect);
    console.log(`Player ${player.id} gained speed boost: ${multiplier}x for ${duration}ms`);
}
// Apply shield to player
function applyShield(player, shieldAmount, duration) {
    const effect = {
        type: 'shield',
        value: shieldAmount,
        duration: duration,
        startTime: Date.now()
    };
    // Initialize effects array if it doesn't exist
    if (!player.effects) {
        player.effects = [];
    }
    // Remove existing shield effects
    player.effects = player.effects.filter(e => e.type !== 'shield');
    // Add new effect
    player.effects.push(effect);
    console.log(`Player ${player.id} gained shield: ${shieldAmount} for ${duration}ms`);
}
// Explode petal and deal area damage
function explodePetal(x, y, petalSize, damage, enemies, io, player) {
    // Throttle explosions to 1 per 20ms
    const currentTime = Date.now();
    if (currentTime - lastExplosionTime < EXPLOSION_THROTTLE_MS) {
        return;
    }
    lastExplosionTime = currentTime;
    const explosionRadius = petalSize * 40 * 3; // Convert petal size to pixels and make explosion 3x larger
    // Process enemies in reverse order to avoid index issues when removing
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        // Skip all pets (pets should not be damaged by any player's explosions)
        if (enemy.ownerId) {
            continue;
        }
        const distance = Math.sqrt((enemy.x - x) ** 2 + (enemy.y - y) ** 2);
        if (distance <= explosionRadius) {
            // Track damage if player is provided
            if (player) {
                const { trackDamage } = require('./server');
                trackDamage(enemy, player.id, damage);
            }
            enemy.health = Math.max(0, enemy.health - damage);
            // Apply knockback
            const knockbackForce = 20;
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            const normalizedDx = dx / (distance || 1);
            const normalizedDy = dy / (distance || 1);
            enemy.knockbackX = normalizedDx * knockbackForce;
            enemy.knockbackY = normalizedDy * knockbackForce;
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            // Check if enemy dies
            if (enemy.health <= 0) {
                // Handle XP and drops if player is provided
                if (player) {
                    const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                    (0, server_1.addXPToPlayer)(player, xpGained, player.id);
                    (0, server_1.handleMobDrops)(enemy);
                    (0, server_1.sendBossMobDefeatedMessage)(enemy, io, constants_1.players);
                    (0, server_1.updateSpecialMobCounts)();
                }
                // Remove enemy from array
                enemies.splice(i, 1);
                // Emit enemy destroyed event
                io.emit('enemyDestroyed', enemy.id);
            }
        }
    }
    // Emit explosion effect to clients
    io.emit('petalExplosion', {
        x: x,
        y: y,
        radius: explosionRadius,
        damage: damage
    });
}
// Check if lightning strike is allowed for lightning_cutter (rate limit: 2 per second)
function canStrikeLightning(player, context) {
    if (!player)
        return true; // Allow if no player (shouldn't happen but be safe)
    // Check if this is from a lightning_cutter petal
    let isLightningCutter = false;
    if (context && context.loadoutIndex !== undefined) {
        const petal = player.loadout[context.loadoutIndex];
        if (petal && petal.type === 'petal' && petal.petalType === 'lightning_cutter') {
            isLightningCutter = true;
        }
    }
    // Only apply rate limit to lightning_cutter
    if (!isLightningCutter)
        return true;
    const currentTime = Date.now();
    let playerStrikes = lightningCutterStrikeTimes.get(player.id) || [];
    // Remove strikes older than 1 second
    playerStrikes = playerStrikes.filter(time => currentTime - time < 1000);
    // Check if we've already hit the max strikes per second
    if (playerStrikes.length >= LIGHTNING_CUTTER_MAX_STRIKES) {
        return false; // Rate limit exceeded (already 2 strikes in the last second)
    }
    // Check minimum time between strikes (500ms)
    if (playerStrikes.length > 0) {
        const lastStrike = playerStrikes[playerStrikes.length - 1];
        if (currentTime - lastStrike < LIGHTNING_CUTTER_RATE_LIMIT_MS) {
            return false; // Too soon since last strike
        }
    }
    // Update strike times
    playerStrikes.push(currentTime);
    lightningCutterStrikeTimes.set(player.id, playerStrikes);
    return true;
}
// Strike lightning and deal damage to multiple targets in radius
function strikeLightning(x, y, radius, enemies, io, player, petalDamage, context) {
    // Check rate limit for lightning_cutter
    if (!canStrikeLightning(player, context)) {
        return; // Rate limit exceeded, skip this lightning strike
    }
    const targets = [];
    // Find all enemies within the lightning radius
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        // Skip all pets (pets should not be damaged by any player's lightning)
        if (enemy.ownerId) {
            continue;
        }
        const distance = Math.sqrt((enemy.x - x) ** 2 + (enemy.y - y) ** 2);
        if (distance <= radius) {
            targets.push({
                x: enemy.x,
                y: enemy.y,
                enemyId: enemy.id
            });
            // Deal damage to the enemy - use petal damage for rarity scaling
            const damage = petalDamage || 25; // Use petal damage if available, fallback to 25
            // Track damage if player is provided
            if (player) {
                const { trackDamage } = require('./server');
                trackDamage(enemy, player.id, damage);
            }
            enemy.health = Math.max(0, enemy.health - damage);
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            // Check if enemy dies
            if (enemy.health <= 0) {
                // Handle XP and drops if player is provided
                if (player) {
                    const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                    (0, server_1.addXPToPlayer)(player, xpGained, player.id);
                    (0, server_1.handleMobDrops)(enemy);
                    (0, server_1.sendBossMobDefeatedMessage)(enemy, io, constants_1.players);
                    (0, server_1.updateSpecialMobCounts)();
                }
                // Remove enemy from array
                enemies.splice(i, 1);
                // Emit enemy destroyed event
                io.emit('enemyDestroyed', enemy.id);
            }
        }
    }
    // Emit lightning effect to clients
    io.emit('lightningStrike', {
        x: x,
        y: y,
        targets: targets,
        damage: petalDamage || 25
    });
}
// Helper function to find a player's pet by mob type
function findPlayerPetByMobType(ownerId, mobType) {
    return constants_1.enemies.find(enemy => enemy.ownerId === ownerId &&
        enemy.type === mobType);
}
// Helper function to despawn a pet
function despawnPet(pet, io) {
    // For centipede pets, drop the whole chain — otherwise the first orphaned
    // body segment would auto-promote into a new free-roaming head.
    if ((0, server_utils_1.isCentipedeHeadType)(pet.type)) {
        for (let i = constants_1.enemies.length - 1; i >= 0; i--) {
            const e = constants_1.enemies[i];
            if (e.id === pet.id || ((0, server_utils_1.isCentipedeBodyType)(e.type) && e.headId === pet.id)) {
                constants_1.enemies.splice(i, 1);
                io.emit('enemyDestroyed', e.id);
            }
        }
        return;
    }
    const index = constants_1.enemies.findIndex(e => e.id === pet.id);
    if (index !== -1) {
        constants_1.enemies.splice(index, 1);
        io.emit('enemyDestroyed', pet.id);
        // console.log(`Despawned pet ${pet.tier} ${pet.type} for player ${pet.ownerId}`);
    }
}
// Despawn all pets owned by a player
function despawnAllPlayerPets(playerId, io) {
    for (let i = constants_1.enemies.length - 1; i >= 0; i--) {
        if (constants_1.enemies[i].ownerId === playerId) {
            io.emit('enemyDestroyed', constants_1.enemies[i].id);
            constants_1.enemies.splice(i, 1);
        }
    }
}
// Spawn a pet mob that belongs to a player
function spawnPet(mobType, rarity, x, y, ownerId, io, skipDuplicateCheck = false) {
    // Validate mob type
    const allMobTypes = (0, mobs_1.getAllMobTypes)();
    if (!allMobTypes.includes(mobType)) {
        console.log(`Invalid mob type for pet: ${mobType}`);
        return;
    }
    // Validate rarity
    const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
    if (!validRarities.includes(rarity.toLowerCase())) {
        console.log(`Invalid rarity for pet: ${rarity}`);
        return;
    }
    // Apex eggs spawn 3 unique pets instead of a single apex pet
    if (rarity.toLowerCase() === 'apex') {
        for (let i = constants_1.enemies.length - 1; i >= 0; i--) {
            if (constants_1.enemies[i].ownerId === ownerId && constants_1.enemies[i].type === mobType) {
                despawnPet(constants_1.enemies[i], io);
            }
        }
        for (let i = 0; i < 3; i++) {
            spawnPet(mobType, 'unique', x, y, ownerId, io, true);
        }
        return;
    }
    // Check if player already has a pet of this mob type - despawn it first
    if (!skipDuplicateCheck) {
        const existingPet = findPlayerPetByMobType(ownerId, mobType);
        if (existingPet) {
            // console.log(`[PET] Player ${ownerId} already has a ${mobType} pet, despawning old one`);
            despawnPet(existingPet, io);
        }
    }
    const tier = rarity.toLowerCase();
    const mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats) {
        console.log(`No stats found for pet ${mobType} with rarity ${tier}`);
        return;
    }
    // Calculate range bonus: +200 per rarity level
    const { RARITY_LEVELS } = require('./petals');
    const rarityIndex = RARITY_LEVELS.indexOf(rarity.toLowerCase());
    const rangeBonus = rarityIndex >= 0 ? rarityIndex * 200 : 0;
    const petRange = (mobStats.range || 0) + rangeBonus;
    // Create the pet enemy
    const currentTime = Date.now();
    const pet = {
        id: Math.random().toString(36).substr(2, 9),
        type: mobType,
        tier: tier,
        x: x,
        y: y,
        angle: Math.random() * Math.PI * 2,
        health: mobStats.health,
        maxHealth: mobStats.health,
        speed: mobStats.speed,
        damage: mobStats.damage,
        knockbackX: 0,
        knockbackY: 0,
        aiType: 'passive', // Pets are not hostile to players
        range: petRange,
        reversed: mobStats.reversed ?? false,
        ownerId: ownerId, // Set the owner
        spawnTime: currentTime,
        lastViewportCheck: currentTime,
        petImage: mobStats.petImage // Use pet image if available
    };
    // Add to enemies array
    constants_1.enemies.push(pet);
    // Notify all clients
    io.emit('enemySpawned', pet);
    // Centipede pets need their trailing body chain too, with ownerId propagated
    // to each segment so they follow the owner alongside the head.
    if ((0, server_utils_1.isCentipedeHeadType)(mobType)) {
        const beforeCount = constants_1.enemies.length;
        (0, enemySpawner_1.spawnCentipedeBodySegments)(pet);
        for (let i = beforeCount; i < constants_1.enemies.length; i++) {
            io.emit('enemySpawned', constants_1.enemies[i]);
        }
    }
    // console.log(`Spawned pet ${tier} ${mobType} for player ${ownerId} at (${Math.round(x)}, ${Math.round(y)})`);
}
// Mark petal for breaking
function markPetalForBreak(petalId, context) {
    const { player, loadoutIndex, io } = context;
    if (loadoutIndex !== undefined && player.loadout[loadoutIndex]) {
        const petal = player.loadout[loadoutIndex];
        if (!petal)
            return;
        // Set health to 0
        petal.health = 0;
        // Mark as on cooldown
        petal.onCooldown = true;
        // Store original petal data for restoration
        const originalPetal = {
            type: petal.type,
            petalType: petal.petalType,
            rarity: petal.rarity,
            maxHealth: petal.maxHealth
        };
        // Emit petal broken event to clients
        io.emit('petalBroken', {
            playerId: player.id,
            loadoutIndex: loadoutIndex,
            petalType: petal.petalType
        });
        // Get cooldown time from petal stats
        const PETAL_CONFIG = require('./petals').PETAL_CONFIG;
        const petalStats = (petal.petalType && petal.rarity) ? PETAL_CONFIG[petal.petalType]?.[petal.rarity] : undefined;
        const cooldownTime = petalStats?.cooldown || 10000;
        // Schedule petal restoration.
        // Snapshot identity so a stale timer doesn't clobber a swapped slot.
        const snapshotPetalType = originalPetal.petalType;
        const snapshotRarity = originalPetal.rarity;
        setTimeout(() => {
            const current = player.loadout[loadoutIndex];
            if (!current || !current.onCooldown)
                return;
            if (current.type !== 'petal' ||
                current.petalType !== snapshotPetalType ||
                current.rarity !== snapshotRarity)
                return;
            // Restore petal after cooldown
            player.loadout[loadoutIndex] = {
                ...originalPetal,
                health: originalPetal.maxHealth,
                onCooldown: false
            };
            // Emit restoration event
            io.emit('petalRestored', {
                playerId: player.id,
                loadoutIndex: loadoutIndex,
                petal: player.loadout[loadoutIndex]
            });
            // Clean up action state
            cleanupPetalActions(petalId);
        }, cooldownTime);
        // Deactivate action state
        const actionState = petalActionStates.get(petalId);
        if (actionState) {
            actionState.isActive = false;
        }
    }
}
// Update player effects (call this in the game loop)
function updatePlayerEffects(player, deltaTime) {
    if (!player.effects)
        return;
    const currentTime = Date.now();
    const expiredEffects = [];
    // Check for expired effects
    for (let i = 0; i < player.effects.length; i++) {
        const effect = player.effects[i];
        if (currentTime - effect.startTime >= effect.duration) {
            expiredEffects.push(i);
        }
    }
    // Remove expired effects
    for (let i = expiredEffects.length - 1; i >= 0; i--) {
        const effectIndex = expiredEffects[i];
        const effect = player.effects[effectIndex];
        console.log(`Player ${player.id} effect expired: ${effect.type}`);
        player.effects.splice(effectIndex, 1);
    }
}
// Get current damage multiplier from effects and skills
function getDamageMultiplier(player) {
    let multiplier = 1.0;
    // Apply skill multiplier first
    const skillMultiplier = getSkillMultiplier(player.skills?.damage);
    multiplier *= skillMultiplier;
    // Then apply petal effect multipliers
    if (player.effects) {
        for (const effect of player.effects) {
            if (effect.type === 'damage_boost') {
                multiplier *= effect.value;
            }
        }
    }
    return multiplier;
}
// Get current speed multiplier from effects and petal modifiers
function getSpeedMultiplier(player) {
    let multiplier = 1.0;
    // Apply petal modifiers first
    const { calculatePlayerModifiers } = require('./server/playerManager');
    const petalModifiers = calculatePlayerModifiers(player);
    if (petalModifiers.speed !== undefined) {
        multiplier *= petalModifiers.speed;
    }
    // Then apply temporary effect multipliers
    if (player.effects) {
        for (const effect of player.effects) {
            if (effect.type === 'speed_boost') {
                multiplier *= effect.value;
            }
        }
    }
    return multiplier;
}
// Get current shield amount from effects
function getShieldAmount(player) {
    if (!player.effects)
        return 0;
    let shield = 0;
    for (const effect of player.effects) {
        if (effect.type === 'shield') {
            shield += effect.value;
        }
    }
    return shield;
}
// Get memory value, handling special keys for player stats, loadout, and petal counts
// Special memory keys:
//   player:health - Player's current health
//   player:maxHealth - Player's maximum health
//   player:damage - Player's damage stat
//   player:speed - Player's speed multiplier
//   player:extended - 1 if petals are extended (petalExtension > 1.0), 0 otherwise
//   loadout:<slot>:exists - 1 if slot has a petal, 0 otherwise
//   loadout:<slot>:health - Health of petal in slot
//   loadout:<slot>:maxHealth - Maximum health of petal in slot
//   loadout:<slot>:damage - Damage of petal in slot
//   loadout:<slot>:size - Size of petal in slot
//   loadout:<slot>:onCooldown - 1 if petal is on cooldown, 0 otherwise
//   petal:count:<petalType> - Total count of that petal type equipped globally across all players
function getMemoryValue(key, context) {
    // Handle special memory keys
    if (key.startsWith('player:')) {
        const playerKey = key.substring(7);
        switch (playerKey) {
            case 'health':
                return context.player.health;
            case 'maxHealth':
                return context.player.maxHealth;
            case 'damage':
                return context.player.damage;
            case 'speed':
                return context.player.speed_boost || 1.0;
            case 'extended':
                // Returns 1 if petals are extended (petalExtension > 1.0), 0 otherwise
                const petalExtension = context.player.inputs?.petalExtension || 1.0;
                return petalExtension > 1.0 ? 1 : 0;
            default:
                return 0;
        }
    }
    // Handle loadout keys: loadout:<slot>:<property>
    if (key.startsWith('loadout:')) {
        const parts = key.substring(8).split(':');
        if (parts.length >= 2) {
            const slotIndex = parseInt(parts[0]);
            const property = parts[1];
            if (!isNaN(slotIndex) && slotIndex >= 0 && slotIndex < context.player.loadout.length) {
                const petal = context.player.loadout[slotIndex];
                if (!petal || petal.type !== 'petal') {
                    return property === 'exists' ? 0 : 0;
                }
                switch (property) {
                    case 'exists':
                        return 1;
                    case 'health':
                        return petal.health || 0;
                    case 'maxHealth':
                        return petal.maxHealth || 0;
                    case 'onCooldown':
                        return petal.onCooldown ? 1 : 0;
                    case 'damage':
                        // Get petal damage - check custom value first, then base stats
                        if (petal.customDamage !== undefined) {
                            return petal.customDamage;
                        }
                        if (petal.petalType && petal.rarity) {
                            const { getPetalStats } = require('./petals');
                            const petalStats = getPetalStats(petal.petalType, petal.rarity);
                            return petalStats?.damage || 0;
                        }
                        return 0;
                    case 'size':
                        // Get petal size - check custom value first, then base stats
                        if (petal.customSize !== undefined) {
                            return petal.customSize;
                        }
                        if (petal.petalType && petal.rarity) {
                            const { getPetalStats } = require('./petals');
                            const petalStats = getPetalStats(petal.petalType, petal.rarity);
                            return petalStats?.size || 0;
                        }
                        return 0;
                    default:
                        return 0;
                }
            }
        }
        return 0;
    }
    // Handle petal count keys: petal:count:<petalType>
    if (key.startsWith('petal:count:')) {
        const petalType = key.substring(13);
        let totalCount = 0;
        // Count across all players.
        // Secondary loadout (slots 10+) is storage only — its petals are not in orbit and don't count.
        for (const playerId in constants_1.players) {
            const player = constants_1.players[playerId];
            if (!player || !player.loadout)
                continue;
            for (let i = 0; i < player.loadout.length && i < 10; i++) {
                const item = player.loadout[i];
                if (item && item.type === 'petal' && item.petalType === petalType) {
                    const { getPetalStats } = require('./petals');
                    if (item.rarity) {
                        const petalStats = getPetalStats(item.petalType, item.rarity);
                        if (petalStats) {
                            const count = petalStats.count || 1;
                            totalCount += count;
                        }
                        else {
                            // If no stats found, count as 1
                            totalCount += 1;
                        }
                    }
                    else {
                        // If no rarity, count as 1
                        totalCount += 1;
                    }
                }
            }
        }
        return totalCount;
    }
    // Regular memory key
    return exports.globalPetalMemory.get(key) || 0;
}
// Evaluate a condition expression
function evaluateCondition(condition, context, state) {
    if (!condition)
        return false;
    // Parse condition: supports comparisons like "health < 50", "memory:count > 5", etc.
    // Handle both "memory:key operator value" and "memory:key==value" formats
    let parts = [];
    // Try to split by spaces first
    const spaceSplit = condition.trim().split(/\s+/);
    if (spaceSplit.length >= 3) {
        parts = spaceSplit;
    }
    else {
        // Try to parse operators without spaces: ==, !=, <=, >=, <, >
        const operatorMatch = condition.match(/(==|!=|<=|>=|<|>)/);
        if (operatorMatch) {
            const operator = operatorMatch[0];
            const operatorIndex = condition.indexOf(operator);
            parts = [
                condition.substring(0, operatorIndex).trim(),
                operator,
                condition.substring(operatorIndex + operator.length).trim()
            ];
        }
        else {
            return false;
        }
    }
    if (parts.length < 3) {
        console.warn(`[CONDITION] Invalid condition format: ${condition}`);
        return false;
    }
    const left = parts[0];
    const operator = parts[1];
    const right = parseFloat(parts[2]);
    if (isNaN(right)) {
        console.warn(`[CONDITION] Invalid right side (not a number): ${parts[2]}`);
        return false;
    }
    let leftValue = 0;
    // Check if it's a memory reference
    if (left.startsWith('memory:')) {
        const memKey = left.substring(7);
        leftValue = getMemoryValue(memKey, context);
    }
    else {
        // Check player/petal properties (backward compatibility)
        switch (left.toLowerCase()) {
            case 'health':
                leftValue = context.player.health;
                break;
            case 'maxhealth':
                leftValue = context.player.maxHealth;
                break;
            case 'damage':
                leftValue = context.player.damage;
                break;
            case 'petalhealth':
                if (context.loadoutIndex !== undefined && context.player.loadout[context.loadoutIndex]) {
                    leftValue = context.player.loadout[context.loadoutIndex].health || 0;
                }
                break;
            case 'petaldamage':
                leftValue = context.petalDamage;
                break;
            default:
                console.warn(`[CONDITION] Unknown left side: ${left}`);
                return false;
        }
    }
    // Perform comparison
    const result = (() => {
        switch (operator) {
            case '>':
                return leftValue > right;
            case '<':
                return leftValue < right;
            case '>=':
                return leftValue >= right;
            case '<=':
                return leftValue <= right;
            case '==':
            case '=':
                return Math.abs(leftValue - right) < 0.001; // Float comparison
            case '!=':
                return Math.abs(leftValue - right) >= 0.001;
            default:
                console.warn(`[CONDITION] Unknown operator: ${operator}`);
                return false;
        }
    })();
    // Only log condition errors, not successful evaluations
    // (removed verbose logging to reduce console spam)
    return result;
}
// Build label map for goto support
function buildLabelMap(actions) {
    const labels = new Map();
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action.type === 'label' && action.stringValue) {
            labels.set(action.stringValue, i);
        }
    }
    return labels;
}
// Execute petal actions immediately when spawned
function executePetalActionsOnSpawn(actionString, context) {
    if (!actionString || !context.petalId) {
        return '';
    }
    const petalId = context.petalId;
    // Check if action state already exists - if so, just update the context
    const existingState = petalActionStates.get(petalId);
    if (existingState) {
        // If action state exists but is inactive (completed), don't re-execute
        if (!existingState.isActive) {
            return petalId;
        }
        // Update context with new position and other dynamic values
        existingState.context.petalX = context.petalX;
        existingState.context.petalY = context.petalY;
        existingState.context.petalSize = context.petalSize;
        existingState.context.petalDamage = context.petalDamage;
        existingState.context.enemies = context.enemies;
        return petalId;
    }
    // Check if this petal has already executed split_player - if so, don't create new action state
    if (splitExecutedPetalIds.has(petalId)) {
        return petalId;
    }
    const actions = (0, petals_1.parsePetalActions)(actionString);
    // Build label map
    const labels = buildLabelMap(actions);
    // Create action state for this petal
    const actionState = {
        petalId,
        playerId: context.player.id,
        loadoutIndex: context.loadoutIndex || 0,
        instanceIndex: context.instanceIndex || 0,
        actions,
        currentActionIndex: 0,
        isWaitingForCollision: false,
        isActive: true,
        context: context,
        delayRemaining: 0,
        controlFlow: {
            ifStack: [],
            loopStack: [],
            labels: labels
        },
        lastUpdateTime: Date.now()
    };
    petalActionStates.set(petalId, actionState);
    return petalId;
}
// Execute the next action in the sequence (called from update loop)
function executeNextAction(petalId, deltaTime) {
    const actionState = petalActionStates.get(petalId);
    if (!actionState || !actionState.isActive) {
        return;
    }
    // Don't execute if we're waiting for collision
    if (actionState.isWaitingForCollision) {
        return;
    }
    // Handle delay (consistent rate)
    if (actionState.delayRemaining > 0) {
        actionState.delayRemaining -= deltaTime;
        if (actionState.delayRemaining > 0) {
            return; // Still waiting
        }
        // Delay complete, advance to next action and continue execution
        actionState.currentActionIndex++;
        // Continue to execute the next action immediately
    }
    const { actions, currentActionIndex, controlFlow } = actionState;
    // Skip to end of current if block if we're in a false if
    if (controlFlow.ifStack.length > 0 && !controlFlow.ifStack[controlFlow.ifStack.length - 1]) {
        // We're in a false if block, skip until we find else or endif
        let depth = 1;
        let i = currentActionIndex;
        while (i < actions.length && depth > 0) {
            const action = actions[i];
            if (action.type === 'if')
                depth++;
            else if (action.type === 'endif') {
                depth--;
                if (depth === 0) {
                    // Found matching endif, skip the entire if block
                    actionState.currentActionIndex = i + 1;
                    controlFlow.ifStack.pop();
                    return;
                }
            }
            else if (action.type === 'else' && depth === 1) {
                // Found else, execute else block
                controlFlow.ifStack[controlFlow.ifStack.length - 1] = true;
                actionState.currentActionIndex = i + 1;
                return;
            }
            i++;
        }
        // If we get here, we didn't find a matching endif (shouldn't happen with valid code)
        if (depth > 0) {
            console.warn(`Unmatched if statement in petal actions for ${petalId}`);
            actionState.currentActionIndex = actions.length; // Skip to end
            return;
        }
    }
    if (currentActionIndex >= actions.length) {
        // Actions completed - mark as inactive but don't delete state
        // This prevents re-execution on next frame
        const actionState = petalActionStates.get(petalId);
        if (actionState) {
            actionState.isActive = false;
        }
        return;
    }
    const action = actions[currentActionIndex];
    const { player, petalX, petalY, petalSize, enemies, io } = actionState.context;
    // Removed verbose action logging to reduce console spam
    // Debug: log action type if it's not recognized
    if (!['heal', 'damage_boost', 'speed_boost', 'shield', 'explode', 'lightning', 'break', 'delay', 'restart', 'wait_until_collision', 'if', 'else', 'endif', 'loop', 'endloop', 'goto', 'label', 'set_memory', 'get_memory', 'add_memory', 'multiply_memory', 'set_petal_damage', 'set_petal_health', 'set_petal_size', 'add_petal_damage', 'add_petal_health', 'add_petal_size', 'set_player_damage', 'set_player_max_health', 'set_player_speed', 'add_player_damage', 'add_player_max_health', 'add_player_speed', 'compare', 'compare_gt', 'compare_lt', 'compare_gte', 'compare_lte', 'compare_eq', 'compare_neq'].includes(action.type)) {
        console.warn(`[DEBUG] Unrecognized action type: "${action.type}" (typeof: ${typeof action.type})`);
    }
    switch (action.type) {
        case 'heal':
            healPlayer(player, action.value || 10, io, actionState.context);
            actionState.currentActionIndex++;
            break;
        case 'damage_boost':
            applyDamageBoost(player, action.value || 1.5, action.duration || 5000);
            actionState.currentActionIndex++;
            break;
        case 'speed_boost':
            applySpeedBoost(player, action.value || 1.5, action.duration || 5000);
            actionState.currentActionIndex++;
            break;
        case 'shield':
            applyShield(player, action.value || 50, action.duration || 3000);
            actionState.currentActionIndex++;
            break;
        case 'explode':
            explodePetal(petalX, petalY, petalSize, action.value || 30, enemies, io, player);
            actionState.currentActionIndex++;
            break;
        case 'lightning':
            strikeLightning(petalX, petalY, action.value || 100, enemies, io, player, actionState.context.petalDamage, actionState.context);
            actionState.currentActionIndex++;
            break;
        case 'break':
            markPetalForBreak(petalId, actionState.context);
            actionState.currentActionIndex++;
            break;
        case 'delay':
            // Set delay in seconds (consistent rate)
            actionState.delayRemaining = (action.value || 1000) / 1000; // Convert ms to seconds
            // Don't increment index yet, will be handled next frame
            break;
        case 'restart':
            // Restart from beginning
            actionState.currentActionIndex = 0;
            controlFlow.ifStack = [];
            controlFlow.loopStack = [];
            break;
        case 'wait_until_collision':
            // Set waiting state
            actionState.isWaitingForCollision = true;
            // Don't advance action yet, it will be handled when collision occurs
            break;
        case 'if':
            // Evaluate condition
            const conditionStr = action.condition || '';
            const conditionResult = evaluateCondition(conditionStr, actionState.context, actionState);
            controlFlow.ifStack.push(conditionResult);
            actionState.currentActionIndex++;
            break;
        case 'else':
            // If we're here and the if was true, skip to endif
            if (controlFlow.ifStack.length > 0 && controlFlow.ifStack[controlFlow.ifStack.length - 1]) {
                // If was true, skip else block
                let depth = 1;
                let i = currentActionIndex + 1;
                while (i < actions.length && depth > 0) {
                    const action = actions[i];
                    if (action.type === 'if')
                        depth++;
                    else if (action.type === 'endif') {
                        depth--;
                        if (depth === 0) {
                            actionState.currentActionIndex = i + 1;
                            controlFlow.ifStack.pop();
                            return;
                        }
                    }
                    i++;
                }
            }
            else {
                // If was false, execute else block
                if (controlFlow.ifStack.length > 0) {
                    controlFlow.ifStack[controlFlow.ifStack.length - 1] = true;
                }
                actionState.currentActionIndex++;
            }
            break;
        case 'endif':
            // End if block
            if (controlFlow.ifStack.length > 0) {
                controlFlow.ifStack.pop();
            }
            actionState.currentActionIndex++;
            break;
        case 'loop':
            // Start loop
            const loopCount = action.value || -1; // -1 means infinite
            controlFlow.loopStack.push({
                startIndex: currentActionIndex,
                count: loopCount,
                currentIteration: 0
            });
            actionState.currentActionIndex++;
            break;
        case 'endloop':
            // End loop - check if we should continue
            if (controlFlow.loopStack.length > 0) {
                const loop = controlFlow.loopStack[controlFlow.loopStack.length - 1];
                loop.currentIteration++;
                if (loop.count === -1 || loop.currentIteration < loop.count) {
                    // Continue loop
                    actionState.currentActionIndex = loop.startIndex + 1; // +1 to skip the loop action itself
                }
                else {
                    // Loop complete
                    controlFlow.loopStack.pop();
                    actionState.currentActionIndex++;
                }
            }
            else {
                actionState.currentActionIndex++;
            }
            break;
        case 'goto':
            // Jump to label
            const labelName = action.stringValue || '';
            const labelIndex = controlFlow.labels.get(labelName);
            if (labelIndex !== undefined) {
                actionState.currentActionIndex = labelIndex + 1; // +1 to skip the label action itself
            }
            else {
                console.warn(`Label not found: ${labelName}`);
                actionState.currentActionIndex++;
            }
            break;
        case 'label':
            // Label marker - just skip it
            actionState.currentActionIndex++;
            break;
        case 'set_memory':
            // Set global memory value or writable petal stats
            const memKey = action.stringValue || '';
            // Check if value is a memory reference (stored in condition field as a workaround)
            let memValue = action.value || 0;
            if (isNaN(memValue) && action.condition && action.condition.startsWith('memory:')) {
                // Resolve memory reference
                const memRefKey = action.condition.substring(7);
                memValue = getMemoryValue(memRefKey, actionState.context);
            }
            // Handle writable loadout stats: loadout:<slot>:damage, loadout:<slot>:size
            if (memKey.startsWith('loadout:')) {
                const parts = memKey.substring(8).split(':');
                if (parts.length >= 2) {
                    const slotIndex = parseInt(parts[0]);
                    const property = parts[1];
                    if (!isNaN(slotIndex) && slotIndex >= 0 && slotIndex < player.loadout.length) {
                        const petal = player.loadout[slotIndex];
                        if (petal && petal.type === 'petal') {
                            if (property === 'damage') {
                                petal.customDamage = memValue;
                            }
                            else if (property === 'size') {
                                petal.customSize = memValue;
                            }
                            else {
                                console.warn(`Cannot set loadout property: ${property} (only damage and size are writable)`);
                            }
                        }
                    }
                }
            }
            else if (!memKey.startsWith('player:') && !memKey.startsWith('petal:count:')) {
                // Regular memory key
                exports.globalPetalMemory.set(memKey, memValue);
            }
            else {
                console.warn(`Cannot set special memory key: ${memKey}`);
            }
            actionState.currentActionIndex++;
            break;
        case 'get_memory':
            // Get memory value (can be used in conditions via memory:key syntax)
            // This action doesn't do anything by itself, but values can be accessed via memory:key in conditions
            actionState.currentActionIndex++;
            break;
        case 'add_memory':
            // Add to global memory value or writable petal stats
            const addMemKey = action.stringValue || '';
            const addMemValue = action.value || 0;
            // Handle writable loadout stats: loadout:<slot>:damage, loadout:<slot>:size
            if (addMemKey.startsWith('loadout:')) {
                const parts = addMemKey.substring(8).split(':');
                if (parts.length >= 2) {
                    const slotIndex = parseInt(parts[0]);
                    const property = parts[1];
                    if (!isNaN(slotIndex) && slotIndex >= 0 && slotIndex < player.loadout.length) {
                        const petal = player.loadout[slotIndex];
                        if (petal && petal.type === 'petal') {
                            if (property === 'damage') {
                                const currentValue = getMemoryValue(`loadout:${slotIndex}:damage`, actionState.context);
                                petal.customDamage = currentValue + addMemValue;
                            }
                            else if (property === 'size') {
                                const currentValue = getMemoryValue(`loadout:${slotIndex}:size`, actionState.context);
                                petal.customSize = currentValue + addMemValue;
                            }
                            else {
                                console.warn(`Cannot modify loadout property: ${property} (only damage and size are writable)`);
                            }
                        }
                    }
                }
            }
            else if (!addMemKey.startsWith('player:') && !addMemKey.startsWith('petal:count:')) {
                // Regular memory key
                const currentMemValue = exports.globalPetalMemory.get(addMemKey) || 0;
                exports.globalPetalMemory.set(addMemKey, currentMemValue + addMemValue);
            }
            else {
                console.warn(`Cannot modify special memory key: ${addMemKey}`);
            }
            actionState.currentActionIndex++;
            break;
        case 'multiply_memory':
            // Multiply global memory value or writable petal stats
            const multMemKey = action.stringValue || '';
            const multMemValue = action.value || 1;
            // Handle writable loadout stats: loadout:<slot>:damage, loadout:<slot>:size
            if (multMemKey.startsWith('loadout:')) {
                const parts = multMemKey.substring(8).split(':');
                if (parts.length >= 2) {
                    const slotIndex = parseInt(parts[0]);
                    const property = parts[1];
                    if (!isNaN(slotIndex) && slotIndex >= 0 && slotIndex < player.loadout.length) {
                        const petal = player.loadout[slotIndex];
                        if (petal && petal.type === 'petal') {
                            if (property === 'damage') {
                                const currentValue = getMemoryValue(`loadout:${slotIndex}:damage`, actionState.context);
                                petal.customDamage = currentValue * multMemValue;
                            }
                            else if (property === 'size') {
                                const currentValue = getMemoryValue(`loadout:${slotIndex}:size`, actionState.context);
                                petal.customSize = currentValue * multMemValue;
                            }
                            else {
                                console.warn(`Cannot modify loadout property: ${property} (only damage and size are writable)`);
                            }
                        }
                    }
                }
            }
            else if (!multMemKey.startsWith('player:') && !multMemKey.startsWith('petal:count:')) {
                // Regular memory key
                const currentMultMemValue = exports.globalPetalMemory.get(multMemKey) || 0;
                exports.globalPetalMemory.set(multMemKey, currentMultMemValue * multMemValue);
            }
            else {
                console.warn(`Cannot modify special memory key: ${multMemKey}`);
            }
            actionState.currentActionIndex++;
            break;
        case 'set_petal_damage':
            // Set petal damage (modifies context and petal object)
            actionState.context.petalDamage = action.value || 0;
            // Also store on petal object for memory access
            if (actionState.loadoutIndex !== undefined && player.loadout[actionState.loadoutIndex]) {
                const petal = player.loadout[actionState.loadoutIndex];
                if (petal && petal.type === 'petal') {
                    petal.customDamage = action.value || 0;
                }
            }
            actionState.currentActionIndex++;
            break;
        case 'set_petal_health':
            // Set petal health
            if (actionState.loadoutIndex !== undefined && player.loadout[actionState.loadoutIndex]) {
                const petal = player.loadout[actionState.loadoutIndex];
                if (petal) {
                    petal.health = action.value || 0;
                    petal.maxHealth = Math.max(petal.maxHealth || 0, petal.health);
                }
            }
            actionState.currentActionIndex++;
            break;
        case 'set_petal_size':
            // Set petal size (modifies context and petal object)
            // Support memory references in stringValue if value is not provided
            let sizeValue = action.value;
            if (sizeValue === undefined || sizeValue === null || isNaN(sizeValue)) {
                // Try to get from stringValue if it's a memory reference
                if (action.stringValue && action.stringValue.startsWith('memory:')) {
                    const memKey = action.stringValue.substring(7);
                    sizeValue = getMemoryValue(memKey, actionState.context);
                }
                else {
                    sizeValue = 1; // Default
                }
            }
            actionState.context.petalSize = sizeValue;
            // Also store on petal object for memory access
            if (actionState.loadoutIndex !== undefined && player.loadout[actionState.loadoutIndex]) {
                const petal = player.loadout[actionState.loadoutIndex];
                if (petal && petal.type === 'petal') {
                    petal.customSize = sizeValue;
                }
            }
            actionState.currentActionIndex++;
            break;
        case 'add_petal_damage':
            // Add to petal damage (modifies context and petal object)
            actionState.context.petalDamage += action.value || 0;
            // Also update petal object
            if (actionState.loadoutIndex !== undefined && player.loadout[actionState.loadoutIndex]) {
                const petal = player.loadout[actionState.loadoutIndex];
                if (petal && petal.type === 'petal') {
                    const currentValue = getMemoryValue(`loadout:${actionState.loadoutIndex}:damage`, actionState.context);
                    petal.customDamage = currentValue + (action.value || 0);
                }
            }
            actionState.currentActionIndex++;
            break;
        case 'add_petal_health':
            // Add to petal health
            if (actionState.loadoutIndex !== undefined && player.loadout[actionState.loadoutIndex]) {
                const petal = player.loadout[actionState.loadoutIndex];
                if (petal) {
                    petal.health = Math.min((petal.health || 0) + (action.value || 0), petal.maxHealth || Infinity);
                }
            }
            actionState.currentActionIndex++;
            break;
        case 'add_petal_size':
            // Add to petal size (modifies context and petal object)
            actionState.context.petalSize += action.value || 0;
            // Also update petal object
            if (actionState.loadoutIndex !== undefined && player.loadout[actionState.loadoutIndex]) {
                const petal = player.loadout[actionState.loadoutIndex];
                if (petal && petal.type === 'petal') {
                    const currentValue = getMemoryValue(`loadout:${actionState.loadoutIndex}:size`, actionState.context);
                    petal.customSize = currentValue + (action.value || 0);
                }
            }
            actionState.currentActionIndex++;
            break;
        case 'set_player_damage':
            // Set player damage
            player.damage = action.value || 0;
            actionState.currentActionIndex++;
            break;
        case 'set_player_max_health':
            // Set player max health
            const newMaxHealth = action.value || 0;
            player.maxHealth = newMaxHealth;
            player.health = Math.min(player.health, newMaxHealth);
            actionState.currentActionIndex++;
            break;
        case 'set_player_speed':
            // Set player speed boost (modifies speed_boost property)
            player.speed_boost = action.value || 1;
            actionState.currentActionIndex++;
            break;
        case 'add_player_damage':
            // Add to player damage
            player.damage += action.value || 0;
            actionState.currentActionIndex++;
            break;
        case 'add_player_max_health':
            // Add to player max health
            const addedMaxHealth = action.value || 0;
            player.maxHealth += addedMaxHealth;
            player.health += addedMaxHealth; // Also add to current health
            actionState.currentActionIndex++;
            break;
        case 'add_player_speed':
            // Add to player speed boost
            player.speed_boost += action.value || 0;
            actionState.currentActionIndex++;
            break;
        case 'compare':
        case 'compare_gt':
        case 'compare_lt':
        case 'compare_gte':
        case 'compare_lte':
        case 'compare_eq':
        case 'compare_neq':
            // Comparison actions - store result in memory
            // Format: compare <left_key> <right_value> [result_key]
            // left_key can be a memory key (including special keys like player:health, loadout:0:health, etc.)
            const compareParts = (action.stringValue || '').split(' ');
            const compareLeftKey = compareParts[0] || 'compare_result';
            const compareRight = action.value || 0;
            const compareResultKey = compareParts[1] || 'compare_result';
            // Get left value using getMemoryValue (handles special keys)
            let compareLeft = 0;
            if (compareLeftKey.startsWith('memory:')) {
                const memKey = compareLeftKey.substring(7);
                compareLeft = getMemoryValue(memKey, actionState.context);
            }
            else {
                // Direct memory key
                compareLeft = getMemoryValue(compareLeftKey, actionState.context);
            }
            const compType = action.comparisonType || 'eq';
            let compareResult = 0;
            switch (compType) {
                case 'gt':
                    compareResult = compareLeft > compareRight ? 1 : 0;
                    break;
                case 'lt':
                    compareResult = compareLeft < compareRight ? 1 : 0;
                    break;
                case 'gte':
                    compareResult = compareLeft >= compareRight ? 1 : 0;
                    break;
                case 'lte':
                    compareResult = compareLeft <= compareRight ? 1 : 0;
                    break;
                case 'eq':
                    compareResult = Math.abs(compareLeft - compareRight) < 0.001 ? 1 : 0;
                    break;
                case 'neq':
                    compareResult = Math.abs(compareLeft - compareRight) >= 0.001 ? 1 : 0;
                    break;
            }
            // Store result in memory (only if it's a regular key)
            if (!compareResultKey.startsWith('player:') && !compareResultKey.startsWith('loadout:') && !compareResultKey.startsWith('petal:count:')) {
                exports.globalPetalMemory.set(compareResultKey, compareResult);
            }
            actionState.currentActionIndex++;
            break;
        case 'split_player':
            // Check if this petal has already executed split_player
            if (splitExecutedPetalIds.has(petalId)) {
                console.log(`[PetalActions] Petal ${petalId} already executed split_player, skipping`);
                actionState.currentActionIndex++;
                break;
            }
            splitPlayer(player, io);
            splitExecutedPetalIds.add(petalId);
            actionState.currentActionIndex++;
            break;
        case 'switch_player':
            switchPlayer(player, io);
            actionState.currentActionIndex++;
            break;
        default:
            console.warn(`Unknown action type: ${action.type}`, action);
            actionState.currentActionIndex++;
    }
}
// Update all active petal actions (call this in game loop with consistent rate)
function updatePetalActions(deltaTime) {
    // Update all active petal actions
    for (const [petalId, actionState] of petalActionStates.entries()) {
        if (!actionState.isActive)
            continue;
        // Execute next action (this will handle delays and progress through actions)
        executeNextAction(petalId, deltaTime);
    }
}
// Handle petal collision for wait_until_collision actions
function handlePetalCollision(petalId, context) {
    const actionState = petalActionStates.get(petalId);
    if (!actionState || !actionState.isWaitingForCollision)
        return;
    actionState.isWaitingForCollision = false;
    actionState.currentActionIndex++;
}
// Clean up petal action state
function cleanupPetalActions(petalId) {
    petalActionStates.delete(petalId);
}
// Split player into 2 players
function splitPlayer(player, io) {
    // Check if player is already split (check original ID and split IDs)
    const originalId = player.id.replace('_split2', '').replace('_split1', '');
    // If player is already split, don't split again
    if (exports.splitPlayers.has(originalId)) {
        console.log(`[PetalActions] Player ${player.name} (${player.id}) is already split, skipping`);
        return;
    }
    // Also check if this is already a split player
    if (player.id.includes('_split')) {
        console.log(`[PetalActions] Player ${player.id} is already a split player, skipping`);
        return;
    }
    // Check if split player already exists in players map
    const splitPlayer2Id = `${originalId}_split2`;
    if (constants_1.players[splitPlayer2Id]) {
        console.log(`[PetalActions] Split player ${splitPlayer2Id} already exists, skipping`);
        return;
    }
    // Share inventory (both players reference the same inventory object)
    // This allows items picked up by one player to be available to both
    // Deep clone loadout (including petal health, cooldowns, etc.)
    // Each player has their own loadout so they can equip different items
    const clonedLoadout = player.loadout.map(item => {
        if (!item)
            return null;
        if (item.type === 'petal') {
            return {
                ...item,
                health: item.health,
                maxHealth: item.maxHealth,
                onCooldown: item.onCooldown
            };
        }
        return { ...item };
    });
    // Deep clone mobKills (separate kill tracking per player)
    const clonedMobKills = {};
    if (player.mobKills) {
        for (const mobType in player.mobKills) {
            clonedMobKills[mobType] = { ...player.mobKills[mobType] };
        }
    }
    // Deep clone skills (separate skill trees per player)
    const clonedSkills = player.skills ? { ...player.skills } : undefined;
    // Deep clone effects (separate active effects per player)
    const clonedEffects = player.effects ? player.effects.map(effect => ({ ...effect })) : undefined;
    // Create a duplicate player with separate state but shared inventory
    const splitPlayer2 = {
        ...player,
        id: `${player.id}_split2`,
        x: player.x + 50, // Offset slightly to the right
        y: player.y,
        velocityX: 0, // Reset velocity
        velocityY: 0, // Reset velocity
        knockbackX: 0, // Reset knockback
        knockbackY: 0, // Reset knockback
        angle: player.angle, // Keep same angle
        inventory: player.inventory, // SHARED inventory (same reference)
        loadout: clonedLoadout, // Separate loadout
        mobKills: clonedMobKills, // Separate mob kills
        skills: clonedSkills, // Separate skills
        effects: clonedEffects, // Separate effects
        inputs: { keys: [] } // Separate input state
    };
    // Store split state using original ID
    exports.splitPlayers.set(originalId, {
        player1: player,
        player2: splitPlayer2,
        activeIndex: 0,
        originalId: originalId
    });
    // Add the split player to the players map
    constants_1.players[splitPlayer2.id] = splitPlayer2;
    // Recalculate stats for the split player (to apply petal modifiers from cloned loadout)
    const { recalculatePlayerStats } = require('./server/playerManager');
    recalculatePlayerStats(splitPlayer2, io);
    // Notify clients about the split
    io.emit('playerSplit', {
        originalId: originalId,
        player1Id: player.id,
        player2Id: splitPlayer2.id
    });
    // Send full player data including loadout to clients so they can render the split player's petals
    io.emit('playerUpdated', splitPlayer2);
    console.log(`[PetalActions] Player ${player.name} (${player.id}) split into 2 players with separate inventories and states`);
}
// Switch between split players
function switchPlayer(player, io, socketId) {
    // Find the split state by checking if player is one of the split players
    let splitState = undefined;
    let originalId = '';
    // First try to get by player.id (in case it's the original ID)
    splitState = exports.splitPlayers.get(player.id);
    if (splitState) {
        originalId = player.id;
    }
    else {
        // Search through all split states to find which one contains this player
        for (const [origId, state] of exports.splitPlayers.entries()) {
            if (state.player1.id === player.id || state.player2.id === player.id) {
                splitState = state;
                originalId = origId;
                break;
            }
        }
    }
    if (!splitState) {
        console.log(`[PetalActions] Player ${player.id} is not split, cannot switch`);
        return;
    }
    // Switch active player
    splitState.activeIndex = splitState.activeIndex === 0 ? 1 : 0;
    const activePlayerId = splitState.activeIndex === 0 ? splitState.player1.id : splitState.player2.id;
    // Get the actual player object from the players map to ensure we have the latest state
    const activePlayer = constants_1.players[activePlayerId];
    if (!activePlayer) {
        console.warn(`[PetalActions] Active player ${activePlayerId} not found in players map`);
        return;
    }
    // Notify the specific client (or all clients if socketId not provided)
    if (socketId) {
        io.to(socketId).emit('playerSwitched', {
            originalId: originalId,
            activePlayerId: activePlayerId
        });
        // Send full player data including loadout to the client so they can display the correct loadout
        io.to(socketId).emit('playerUpdated', activePlayer);
    }
    else {
        io.emit('playerSwitched', {
            originalId: originalId,
            activePlayerId: activePlayerId
        });
        // Send full player data including loadout to all clients
        io.emit('playerUpdated', activePlayer);
    }
    console.log(`[PetalActions] Switched to player ${splitState.activeIndex === 0 ? '1' : '2'} (activePlayerId=${activePlayerId})`);
}
// Update petal position in action context
function updatePetalPosition(petalId, x, y) {
    const actionState = petalActionStates.get(petalId);
    if (actionState) {
        actionState.context.petalX = x;
        actionState.context.petalY = y;
    }
}
