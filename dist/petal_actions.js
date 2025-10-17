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
// Global state for tracking petal actions
const petalActionStates = new Map();
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
            explodePetal(petalX, petalY, petalSize, action.value || 30, enemies, io);
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
function explodePetal(x, y, petalSize, damage, enemies, io) {
    const explosionRadius = petalSize * 40 * 3; // Convert petal size to pixels and make explosion 3x larger
    console.log(`[EXPLOSION] Starting explosion at (${x}, ${y}) with radius ${explosionRadius} and damage ${damage}`);
    for (const enemy of enemies) {
        const distance = Math.sqrt((enemy.x - x) ** 2 + (enemy.y - y) ** 2);
        if (distance <= explosionRadius) {
            console.log(`[EXPLOSION] Enemy ${enemy.id} hit! Distance: ${distance}, Damage: ${damage}`);
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
        }
    }
    // Emit explosion effect to clients
    io.emit('petalExplosion', {
        x: x,
        y: y,
        radius: explosionRadius,
        damage: damage
    });
    console.log(`[EXPLOSION] Explosion complete at (${x}, ${y}) with radius ${explosionRadius} and damage ${damage}`);
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
        isDelayed: false,
        delayEndTime: 0,
        isActive: true,
        context: context
    };
    petalActionStates.set(petalId, actionState);
    // Start executing actions immediately
    executeNextAction(petalId, context);
    return petalId;
}
// Execute the next action in the sequence
function executeNextAction(petalId, context) {
    const actionState = petalActionStates.get(petalId);
    if (!actionState || !actionState.isActive)
        return;
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
            explodePetal(petalX, petalY, petalSize, action.value || 30, enemies, io);
            advanceAction(petalId, context);
            break;
        case 'break':
            // Mark petal for breaking
            markPetalForBreak(petalId, context);
            advanceAction(petalId, context);
            break;
        case 'delay':
            // Set delay state
            actionState.isDelayed = true;
            actionState.delayEndTime = Date.now() + (action.value || 1000);
            // Don't advance action yet, it will be handled in updatePetalActions
            break;
        case 'restart':
            // Restart from beginning
            actionState.currentActionIndex = 0;
            executeNextAction(petalId, context);
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
    actionState.isDelayed = false;
    actionState.isWaitingForCollision = false;
    // Execute next action after a small delay to prevent infinite loops
    setTimeout(() => {
        executeNextAction(petalId, context);
    }, 10);
}
// Mark petal for breaking
function markPetalForBreak(petalId, context) {
    const { player, loadoutIndex } = context;
    if (loadoutIndex !== undefined && player.loadout[loadoutIndex]) {
        player.loadout[loadoutIndex].health = 0;
    }
}
// Update all active petal actions (call this in game loop)
function updatePetalActions(deltaTime) {
    const currentTime = Date.now();
    for (const [petalId, actionState] of petalActionStates) {
        if (!actionState.isActive)
            continue;
        // Handle delayed actions
        if (actionState.isDelayed && currentTime >= actionState.delayEndTime) {
            actionState.isDelayed = false;
            // Continue with next action
            const context = getActionContext(actionState);
            if (context) {
                executeNextAction(petalId, context);
            }
        }
    }
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
        actionState.context.petalX = x;
        actionState.context.petalY = y;
    }
}
