import { PetalAction, parsePetalActions } from './petals';
import { ServerPlayer } from './player';
import { Enemy, getXPFromEnemy } from './server_utils';
import { addXPToPlayer, handleMobDrops, updateSpecialMobCounts, sendBossMobDefeatedMessage } from './server';
import { players } from './constants';

// Action execution context
export interface ActionContext {
    player: ServerPlayer;
    petalX: number;
    petalY: number;
    petalSize: number;
    petalDamage: number; // Add petal damage for rarity scaling
    enemies: Enemy[];
    io: any; // Socket.IO instance
    petalId?: string; // Unique ID for the petal instance
    loadoutIndex?: number; // Index in player loadout
    instanceIndex?: number; // Instance index for multi-count petals
}

// Control flow state
interface ControlFlowState {
    ifStack: boolean[]; // Stack of if condition results
    loopStack: Array<{ startIndex: number; count: number; currentIteration: number }>; // Stack of loop states
    labels: Map<string, number>; // Map of label names to action indices
}

// Petal action state for tracking execution
export interface PetalActionState {
    petalId: string;
    playerId: string;
    loadoutIndex: number;
    instanceIndex: number;
    actions: PetalAction[];
    currentActionIndex: number;
    isWaitingForCollision: boolean;
    isActive: boolean;
    context: ActionContext; // Store the context for delayed actions
    delayRemaining: number; // Remaining delay time in seconds (for consistent rate)
    controlFlow: ControlFlowState; // Control flow state
    lastUpdateTime: number; // Last update timestamp for consistent rate
}

// Player effect tracking
export interface PlayerEffect {
    type: 'damage_boost' | 'speed_boost' | 'shield';
    value: number;
    duration: number;
    startTime: number;
}

// Global state for tracking petal actions
const petalActionStates: Map<string, PetalActionState> = new Map();

// Global memory for petal actions (shared across all petals)
export const globalPetalMemory: Map<string, number> = new Map();

// Explosion throttle state
let lastExplosionTime: number = 0;
const EXPLOSION_THROTTLE_MS: number = 20;

// Execute petal actions
export function executePetalActions(actionString: string, context: ActionContext, trigger: 'on_hit' | 'on_break' = 'on_break'): void {
    if (!actionString) return;

    const actions = parsePetalActions(actionString);
    
    for (const action of actions) {
        executeAction(action, context, trigger);
    }
}

// Execute a single action
function executeAction(action: PetalAction, context: ActionContext, trigger: 'on_hit' | 'on_break'): void {
    const { player, petalX, petalY, petalSize, enemies, io } = context;

    switch (action.type) {
        case 'heal':
                healPlayer(player, action.value || 10, io);
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
                strikeLightning(petalX, petalY, action.value || 100, enemies, io, player, context.petalDamage);
            break;

        default:
            console.warn(`Unknown action type: ${action.type}`);
    }
}

// Skill multipliers based on rarity tier
const SKILL_MULTIPLIERS: Record<string, number> = {
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

function getSkillMultiplier(skillTier: string | undefined): number {
    if (!skillTier) return 1.0;
    return SKILL_MULTIPLIERS[skillTier] || 1.0;
}

// Heal the player
function healPlayer(player: ServerPlayer, healAmount: number, io: any): void {
    const oldHealth = player.health;
    // Apply healing multiplier skill bonus
    const healingMultiplier = getSkillMultiplier(player.skills?.healingMultiplier);
    const modifiedHealAmount = healAmount * healingMultiplier;
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
function applyDamageBoost(player: ServerPlayer, multiplier: number, duration: number): void {
    const effect: PlayerEffect = {
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
function applySpeedBoost(player: ServerPlayer, multiplier: number, duration: number): void {
    const effect: PlayerEffect = {
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
function applyShield(player: ServerPlayer, shieldAmount: number, duration: number): void {
    const effect: PlayerEffect = {
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
function explodePetal(x: number, y: number, petalSize: number, damage: number, enemies: Enemy[], io: any, player?: ServerPlayer): void {
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
        const distance = Math.sqrt((enemy.x - x) ** 2 + (enemy.y - y) ** 2);
        
        if (distance <= explosionRadius) {
            // Track damage if player is provided
            if (player) {
                const { trackDamage } = require('./server');
                trackDamage(enemy, player.id, damage);
            }
            
            enemy.health -= damage;
            
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
                    const xpGained = getXPFromEnemy(enemy);
                    addXPToPlayer(player, xpGained, player.id);
                    handleMobDrops(enemy);
                    sendBossMobDefeatedMessage(enemy, io, players);
                    updateSpecialMobCounts();
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

// Strike lightning and deal damage to multiple targets in radius
function strikeLightning(x: number, y: number, radius: number, enemies: Enemy[], io: any, player?: ServerPlayer, petalDamage?: number): void {
    const targets: { x: number; y: number; enemyId: string }[] = [];
    
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
            
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            
            // Check if enemy dies
            if (enemy.health <= 0) {
                // Handle XP and drops if player is provided
                if (player) {
                    const xpGained = getXPFromEnemy(enemy);
                    addXPToPlayer(player, xpGained, player.id);
                    handleMobDrops(enemy);
                    sendBossMobDefeatedMessage(enemy, io, players);
                    updateSpecialMobCounts();
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

// Mark petal for breaking
function markPetalForBreak(petalId: string, context: ActionContext): void {
    const { player, loadoutIndex, io } = context;
    if (loadoutIndex !== undefined && player.loadout[loadoutIndex]) {
        const petal = player.loadout[loadoutIndex];
        if (!petal) return;
        
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
            if (player.loadout[loadoutIndex] && player.loadout[loadoutIndex]!.onCooldown) {
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

// Update player effects (call this in the game loop)
export function updatePlayerEffects(player: ServerPlayer, deltaTime: number): void {
    if (!player.effects) return;

    const currentTime = Date.now();
    const expiredEffects: number[] = [];

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
export function getDamageMultiplier(player: ServerPlayer): number {
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
export function getSpeedMultiplier(player: ServerPlayer): number {
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
export function getShieldAmount(player: ServerPlayer): number {
    if (!player.effects) return 0;

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
function getMemoryValue(key: string, context: ActionContext): number {
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
                        // Get petal damage from stats
                        if (petal.petalType && petal.rarity) {
                            const { getPetalStats } = require('./petals');
                            const petalStats = getPetalStats(petal.petalType, petal.rarity);
                            return petalStats?.damage || 0;
                        }
                        return 0;
                    case 'size':
                        // Get petal size from stats
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
        
        // Count across all players
        for (const playerId in players) {
            const player = players[playerId];
            if (!player || !player.loadout) continue;
            
            for (const item of player.loadout) {
                if (item && item.type === 'petal' && item.petalType === petalType && item.rarity) {
                    const { getPetalStats } = require('./petals');
                    const petalStats = getPetalStats(item.petalType, item.rarity);
                    if (petalStats) {
                        const count = petalStats.count || 1;
                        totalCount += count;
                    }
                }
            }
        }
        
        return totalCount;
    }
    
    // Regular memory key
    return globalPetalMemory.get(key) || 0;
}

// Evaluate a condition expression
function evaluateCondition(condition: string, context: ActionContext, state: PetalActionState): boolean {
    if (!condition) return false;
    
    // Parse condition: supports comparisons like "health < 50", "memory:count > 5", etc.
    // Handle both "memory:key operator value" and "memory:key==value" formats
    let parts: string[] = [];
    
    // Try to split by spaces first
    const spaceSplit = condition.trim().split(/\s+/);
    if (spaceSplit.length >= 3) {
        parts = spaceSplit;
    } else {
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
        } else {
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
    
    let leftValue: number = 0;
    
    // Check if it's a memory reference
    if (left.startsWith('memory:')) {
        const memKey = left.substring(7);
        leftValue = getMemoryValue(memKey, context);
    } else {
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
                    leftValue = context.player.loadout[context.loadoutIndex]!.health || 0;
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
    
    // Debug logging for important conditions
    if (left.includes('extended') || left.includes('counter')) {
        console.log(`[CONDITION] ${condition} -> ${leftValue} ${operator} ${right} = ${result}`);
    }
    
    return result;
}

// Build label map for goto support
function buildLabelMap(actions: PetalAction[]): Map<string, number> {
    const labels = new Map<string, number>();
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action.type === 'label' && action.stringValue) {
            labels.set(action.stringValue, i);
        }
    }
    return labels;
}

// Execute petal actions immediately when spawned
export function executePetalActionsOnSpawn(actionString: string, context: ActionContext): string {
    if (!actionString || !context.petalId) {
        return '';
    }

    const petalId = context.petalId;
    
    // Check if action state already exists - if so, just update the context
    const existingState = petalActionStates.get(petalId);
    if (existingState) {
        // Update context with new position and other dynamic values
        existingState.context.petalX = context.petalX;
        existingState.context.petalY = context.petalY;
        existingState.context.petalSize = context.petalSize;
        existingState.context.petalDamage = context.petalDamage;
        existingState.context.enemies = context.enemies;
        return petalId;
    }

    const actions = parsePetalActions(actionString);
    
    // Build label map
    const labels = buildLabelMap(actions);
    
    // Create action state for this petal
    const actionState: PetalActionState = {
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
function executeNextAction(petalId: string, deltaTime: number): void {
    const actionState = petalActionStates.get(petalId);
    if (!actionState || !actionState.isActive) {
        if (!actionState) {
            console.log(`[PETAL_ACTIONS] No action state found for ${petalId}`);
        }
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
            if (action.type === 'if') depth++;
            else if (action.type === 'endif') {
                depth--;
                if (depth === 0) {
                    // Found matching endif, skip the entire if block
                    actionState.currentActionIndex = i + 1;
                    controlFlow.ifStack.pop();
                    return;
                }
            } else if (action.type === 'else' && depth === 1) {
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
        // Actions completed, clean up
        petalActionStates.delete(petalId);
        return;
    }

    const action = actions[currentActionIndex];
    const { player, petalX, petalY, petalSize, enemies, io } = actionState.context;

    // Debug logging for action execution (only log important actions to reduce spam)
    if (action.type === 'lightning' || action.type === 'speed_boost' || action.type === 'restart') {
        console.log(`[PETAL_ACTIONS] ${petalId} executing action ${currentActionIndex}/${actions.length}: ${action.type}`);
    }

    // Debug: log action type if it's not recognized
    if (!['heal', 'damage_boost', 'speed_boost', 'shield', 'explode', 'lightning', 'break', 'delay', 'restart', 'wait_until_collision', 'if', 'else', 'endif', 'loop', 'endloop', 'goto', 'label', 'set_memory', 'get_memory', 'add_memory', 'multiply_memory', 'set_petal_damage', 'set_petal_health', 'set_petal_size', 'add_petal_damage', 'add_petal_health', 'add_petal_size', 'set_player_damage', 'set_player_max_health', 'set_player_speed', 'add_player_damage', 'add_player_max_health', 'add_player_speed', 'compare', 'compare_gt', 'compare_lt', 'compare_gte', 'compare_lte', 'compare_eq', 'compare_neq'].includes(action.type)) {
        console.warn(`[DEBUG] Unrecognized action type: "${action.type}" (typeof: ${typeof action.type})`);
    }

    switch (action.type) {
        case 'heal':
            healPlayer(player, action.value || 10, io);
            actionState.currentActionIndex++;
            break;

        case 'damage_boost':
            applyDamageBoost(player, action.value || 1.5, action.duration || 5000);
            actionState.currentActionIndex++;
            break;

        case 'speed_boost':
            console.log(`[SPEED_BOOST] Applying speed boost: ${action.value || 1.5}x for ${action.duration || 5000}ms`);
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
            console.log(`[LIGHTNING] Striking lightning at (${petalX}, ${petalY}) with radius ${action.value || 100}, enemies: ${enemies.length}`);
            strikeLightning(petalX, petalY, action.value || 100, enemies, io, player, actionState.context.petalDamage);
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
            console.log(`[RESTART] Restarting petal actions for ${petalId}`);
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
            const conditionResult = evaluateCondition(action.condition || '', actionState.context, actionState);
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
                    if (action.type === 'if') depth++;
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
            } else {
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
                } else {
                    // Loop complete
                    controlFlow.loopStack.pop();
                    actionState.currentActionIndex++;
                }
            } else {
                actionState.currentActionIndex++;
            }
            break;

        case 'goto':
            // Jump to label
            const labelName = action.stringValue || '';
            const labelIndex = controlFlow.labels.get(labelName);
            if (labelIndex !== undefined) {
                actionState.currentActionIndex = labelIndex + 1; // +1 to skip the label action itself
            } else {
                console.warn(`Label not found: ${labelName}`);
                actionState.currentActionIndex++;
            }
            break;

        case 'label':
            // Label marker - just skip it
            actionState.currentActionIndex++;
            break;

        case 'set_memory':
            // Set global memory value (only for regular memory keys, not special keys)
            const memKey = action.stringValue || '';
            const memValue = action.value || 0;
            // Only allow setting regular memory keys (not special keys like player:, loadout:, petal:count:)
            if (!memKey.startsWith('player:') && !memKey.startsWith('loadout:') && !memKey.startsWith('petal:count:')) {
                globalPetalMemory.set(memKey, memValue);
            } else {
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
            // Add to global memory value (only for regular memory keys)
            const addMemKey = action.stringValue || '';
            const addMemValue = action.value || 0;
            // Only allow modifying regular memory keys
            if (!addMemKey.startsWith('player:') && !addMemKey.startsWith('loadout:') && !addMemKey.startsWith('petal:count:')) {
                const currentMemValue = globalPetalMemory.get(addMemKey) || 0;
                globalPetalMemory.set(addMemKey, currentMemValue + addMemValue);
            } else {
                console.warn(`Cannot modify special memory key: ${addMemKey}`);
            }
            actionState.currentActionIndex++;
            break;

        case 'multiply_memory':
            // Multiply global memory value (only for regular memory keys)
            const multMemKey = action.stringValue || '';
            const multMemValue = action.value || 1;
            // Only allow modifying regular memory keys
            if (!multMemKey.startsWith('player:') && !multMemKey.startsWith('loadout:') && !multMemKey.startsWith('petal:count:')) {
                const currentMultMemValue = globalPetalMemory.get(multMemKey) || 0;
                globalPetalMemory.set(multMemKey, currentMultMemValue * multMemValue);
            } else {
                console.warn(`Cannot modify special memory key: ${multMemKey}`);
            }
            actionState.currentActionIndex++;
            break;

        case 'set_petal_damage':
            // Set petal damage (modifies context)
            actionState.context.petalDamage = action.value || 0;
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
            // Set petal size (modifies context)
            actionState.context.petalSize = action.value || 1;
            actionState.currentActionIndex++;
            break;

        case 'add_petal_damage':
            // Add to petal damage
            actionState.context.petalDamage += action.value || 0;
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
            // Add to petal size
            actionState.context.petalSize += action.value || 0;
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
            } else {
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
                globalPetalMemory.set(compareResultKey, compareResult);
            }
            actionState.currentActionIndex++;
            break;

        default:
            console.warn(`Unknown action type: ${action.type}`, action);
            actionState.currentActionIndex++;
    }
}

// Update all active petal actions (call this in game loop with consistent rate)
export function updatePetalActions(deltaTime: number): void {
    const currentTime = Date.now();
    
    // Update all active petal actions
    for (const [petalId, actionState] of petalActionStates.entries()) {
        if (!actionState.isActive) continue;
        
        // Execute next action (this will handle delays and progress through actions)
        executeNextAction(petalId, deltaTime);
    }
}

// Handle petal collision for wait_until_collision actions
export function handlePetalCollision(petalId: string, context: ActionContext): void {
    const actionState = petalActionStates.get(petalId);
    if (!actionState || !actionState.isWaitingForCollision) return;

    actionState.isWaitingForCollision = false;
    actionState.currentActionIndex++;
}

// Clean up petal action state
export function cleanupPetalActions(petalId: string): void {
    petalActionStates.delete(petalId);
}

// Update petal position in action context
export function updatePetalPosition(petalId: string, x: number, y: number): void {
    const actionState = petalActionStates.get(petalId);
    if (actionState) {
        actionState.context.petalX = x;
        actionState.context.petalY = y;
    }
}
