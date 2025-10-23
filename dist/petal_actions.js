"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executePetalActions = executePetalActions;
exports.updatePlayerEffects = updatePlayerEffects;
exports.getDamageMultiplier = getDamageMultiplier;
exports.getSpeedMultiplier = getSpeedMultiplier;
exports.getShieldAmount = getShieldAmount;
exports.executePetalActionsOnSpawn = executePetalActionsOnSpawn;
exports.updatePetalActions = updatePetalActions;
exports.handlePetalCollision = handlePetalCollision;
exports.cleanupPetalActions = cleanupPetalActions;
exports.updatePetalPosition = updatePetalPosition;
const petals_1 = require("./petals");
const server_utils_1 = require("./server_utils");
const server_1 = require("./server");
// Global state for tracking petal actions
const petalActionStates = new Map();
// Explosion throttle state
let lastExplosionTime = 0;
const EXPLOSION_THROTTLE_MS = 20;
// Execute petal actions
function executePetalActions(actionString, context, trigger = 'on_break') {
    if (!actionString)
        return;
    const actions = (0, petals_1.parsePetalActions)(actionString);
    for (const action of actions) {
        executeAction(action, context, trigger);
    }
}
// Execute a single action
function executeAction(action, context, trigger) {
    const { player, petalX, petalY, petalSize, enemies, io } = context;
    switch (action.type) {
        case 'heal':
            // if (trigger === 'on_break') {
            healPlayer(player, action.value || 10, io);
            // }
            break;
        case 'break':
            // This action is handled by the petal breaking logic in the server
            // We don't need to do anything here as the petal will be marked as broken
            break;
        case 'damage_boost':
            // if (trigger === 'on_break') {
            applyDamageBoost(player, action.value || 1.5, action.duration || 5000);
            // }
            break;
        case 'speed_boost':
            // if (trigger === 'on_break') {
            applySpeedBoost(player, action.value || 1.5, action.duration || 5000);
            // }
            break;
        case 'shield':
            // if (trigger === 'on_break') {
            applyShield(player, action.value || 50, action.duration || 3000);
            // }
            break;
        case 'explode':
            // if (trigger === 'on_break') {
            explodePetal(petalX, petalY, petalSize, action.value || 30, enemies, io, player);
            // }
            break;
        case 'lightning':
            // if (trigger === 'on_break') {
            strikeLightning(petalX, petalY, action.value || 100, enemies, io, player, context.petalDamage);
            // }
            break;
        default:
            console.warn(`Unknown action type: ${action.type}`);
    }
}
// Heal the player
function healPlayer(player, healAmount, io) {
    const oldHealth = player.health;
    player.health = Math.min(player.maxHealth, player.health + healAmount);
    if (player.health !== oldHealth) {
        io.emit('playerHealed', {
            playerId: player.id,
            health: player.health,
            healAmount: player.health - oldHealth
        });
        console.log(`Player ${player.id} healed for ${player.health - oldHealth} HP`);
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
        // console.log(`[EXPLOSION] Throttled explosion at (${x}, ${y})`);
        return;
    }
    lastExplosionTime = currentTime;
    const explosionRadius = petalSize * 40 * 3; // Convert petal size to pixels and make explosion 3x larger
    // console.log(`[EXPLOSION] Starting explosion at (${x}, ${y}) with radius ${explosionRadius} and damage ${damage}`);
    // Process enemies in reverse order to avoid index issues when removing
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        const distance = Math.sqrt((enemy.x - x) ** 2 + (enemy.y - y) ** 2);
        if (distance <= explosionRadius) {
            // console.log(`[EXPLOSION] Enemy ${enemy.id} hit! Distance: ${distance}, Damage: ${damage}`);
            // Track damage if player is provided
            if (player) {
                const { trackDamage } = require('./server');
                trackDamage(enemy, player.id, damage);
            }
            enemy.health -= damage;
            // Apply knockback
            const knockbackForce = 10;
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            const normalizedDx = dx / (distance || 1);
            const normalizedDy = dy / (distance || 1);
            enemy.knockbackX = normalizedDx * knockbackForce;
            enemy.knockbackY = normalizedDy * knockbackForce;
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            // Check if enemy dies
            if (enemy.health <= 0) {
                // console.log(`[EXPLOSION] Enemy ${enemy.id} killed by explosion!`);
                // Handle XP and drops if player is provided
                if (player) {
                    const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                    (0, server_1.addXPToPlayer)(player, xpGained, player.id);
                    (0, server_1.handleMobDrops)(enemy);
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
    // console.log(`[EXPLOSION] Explosion complete at (${x}, ${y}) with radius ${explosionRadius} and damage ${damage}`);
}
// Strike lightning and deal damage to multiple targets in radius
function strikeLightning(x, y, radius, enemies, io, player, petalDamage) {
    const targets = [];
    // Find all enemies within the lightning radius
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
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
            enemy.health -= damage;
            // Apply slight knockback
            const knockbackForce = 5;
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
    console.log(`[LIGHTNING] Lightning struck at (${x}, ${y}) with radius ${radius}, hit ${targets.length} targets`);
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
// Get current damage multiplier from effects
function getDamageMultiplier(player) {
    if (!player.effects)
        return 1.0;
    let multiplier = 1.0;
    for (const effect of player.effects) {
        if (effect.type === 'damage_boost') {
            multiplier *= effect.value;
        }
    }
    return multiplier;
}
// Get current speed multiplier from effects
function getSpeedMultiplier(player) {
    if (!player.effects)
        return 1.0;
    let multiplier = 1.0;
    for (const effect of player.effects) {
        if (effect.type === 'speed_boost') {
            multiplier *= effect.value;
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
// Execute petal actions immediately when spawned
function executePetalActionsOnSpawn(actionString, context) {
    if (!actionString || !context.petalId)
        return '';
    const actions = (0, petals_1.parsePetalActions)(actionString);
    const petalId = context.petalId;
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
        context: context
    };
    petalActionStates.set(petalId, actionState);
    // Start executing actions after a small delay to allow position update
    setTimeout(() => {
        executeNextAction(petalId, context);
    }, 50); // 50ms delay to allow first position update
    return petalId;
}
// Execute the next action in the sequence
function executeNextAction(petalId, context) {
    const actionState = petalActionStates.get(petalId);
    if (!actionState || !actionState.isActive)
        return;
    // Don't execute if we're waiting for collision
    if (actionState.isWaitingForCollision) {
        return;
    }
    const { actions, currentActionIndex } = actionState;
    if (currentActionIndex >= actions.length) {
        // Actions completed, clean up
        petalActionStates.delete(petalId);
        return;
    }
    const action = actions[currentActionIndex];
    const { player, petalX, petalY, petalSize, enemies, io } = context;
    switch (action.type) {
        case 'heal':
            healPlayer(player, action.value || 10, io);
            advanceAction(petalId, context);
            break;
        case 'damage_boost':
            applyDamageBoost(player, action.value || 1.5, action.duration || 5000);
            advanceAction(petalId, context);
            break;
        case 'speed_boost':
            applySpeedBoost(player, action.value || 1.5, action.duration || 5000);
            advanceAction(petalId, context);
            break;
        case 'shield':
            applyShield(player, action.value || 50, action.duration || 3000);
            advanceAction(petalId, context);
            break;
        case 'explode':
            // console.log(`[EXPLODE ACTION] Exploding at petal position (${petalX}, ${petalY}), player position (${player.x}, ${player.y})`);
            explodePetal(petalX, petalY, petalSize, action.value || 30, enemies, io, player);
            advanceAction(petalId, context);
            break;
        case 'lightning':
            // console.log(`[LIGHTNING ACTION] Striking lightning at petal position (${petalX}, ${petalY})`);
            strikeLightning(petalX, petalY, action.value || 100, enemies, io, player, context.petalDamage);
            advanceAction(petalId, context);
            break;
        case 'break':
            // Mark petal for breaking
            markPetalForBreak(petalId, context);
            advanceAction(petalId, context);
            break;
        case 'delay':
            // Use setTimeout to delay execution
            setTimeout(() => {
                advanceAction(petalId, context);
            }, action.value || 1000);
            break;
        case 'restart':
            // Restart from beginning
            actionState.currentActionIndex = -1; // Set to -1 so advanceAction increments to 0
            advanceAction(petalId, context);
            break;
        case 'wait_until_collision':
            // Set waiting state
            actionState.isWaitingForCollision = true;
            // Don't advance action yet, it will be handled when collision occurs
            break;
        default:
            console.warn(`Unknown action type: ${action.type}`);
            advanceAction(petalId, context);
    }
}
// Advance to the next action
function advanceAction(petalId, context) {
    const actionState = petalActionStates.get(petalId);
    if (!actionState)
        return;
    actionState.currentActionIndex++;
    actionState.isWaitingForCollision = false;
    // Execute next action after a small delay to prevent infinite loops
    setTimeout(() => {
        executeNextAction(petalId, context);
    }, 10);
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
        // Schedule petal restoration
        setTimeout(() => {
            // Check if player and petal still exist
            if (player.loadout[loadoutIndex] && player.loadout[loadoutIndex].onCooldown) {
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
            }
        }, cooldownTime);
        // Deactivate action state
        const actionState = petalActionStates.get(petalId);
        if (actionState) {
            actionState.isActive = false;
        }
    }
}
// Update all active petal actions (call this in game loop)
// Currently only used for cleanup, as delays are handled by setTimeout
function updatePetalActions(deltaTime) {
    // Delays are now handled by setTimeout in executeNextAction
    // This function is kept for potential future use (e.g., cleanup, state updates)
}
// Handle petal collision for wait_until_collision actions
function handlePetalCollision(petalId, context) {
    const actionState = petalActionStates.get(petalId);
    if (!actionState || !actionState.isWaitingForCollision)
        return;
    actionState.isWaitingForCollision = false;
    advanceAction(petalId, context);
}
// Get action context from state
function getActionContext(actionState) {
    return actionState.context;
}
// Clean up petal action state
function cleanupPetalActions(petalId) {
    petalActionStates.delete(petalId);
}
// Update petal position in action context
function updatePetalPosition(petalId, x, y) {
    const actionState = petalActionStates.get(petalId);
    if (actionState) {
        const oldX = actionState.context.petalX;
        const oldY = actionState.context.petalY;
        actionState.context.petalX = x;
        actionState.context.petalY = y;
        // Debug logging for position updates
        // if (Math.abs(oldX - x) > 1 || Math.abs(oldY - y) > 1) {
        //     console.log(`[POSITION UPDATE] Petal ${petalId}: (${oldX}, ${oldY}) -> (${x}, ${y})`);
        // }
    }
}
