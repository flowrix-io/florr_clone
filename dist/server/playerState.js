"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupPetalPhysicsStates = cleanupPetalPhysicsStates;
exports.getPlayerViewports = getPlayerViewports;
exports.isPositionInAnyViewport = isPositionInAnyViewport;
exports.isPositionInAnyViewport200Percent = isPositionInAnyViewport200Percent;
exports.getEnemiesInViewport200Percent = getEnemiesInViewport200Percent;
exports.isPositionInPlayerPetalRange = isPositionInPlayerPetalRange;
exports.getEnemiesInViewportCount = getEnemiesInViewportCount;
exports.validatePlayerPositions = validatePlayerPositions;
exports.updatePlayerState = updatePlayerState;
const server_utils_1 = require("../server_utils");
const petals_1 = require("../petals");
const constants_1 = require("../constants");
const map_data_1 = require("../map_data");
const gameState_1 = require("./gameState");
const physics_1 = require("./physics");
const physics_2 = require("./physics");
const petal_actions_1 = require("../petal_actions");
const mobs_1 = require("../mobs");
const playerManager_1 = require("./playerManager");
const utils_1 = require("./utils");
// Map to store petal physics state (keyed by petalId)
const petalPhysicsStates = new Map();
// Map to track last damage time for petals with damageCooldown (keyed by petalId)
const petalLastDamageTime = new Map();
// Physics constants
const ATTRACTION_FORCE = 200; // Attraction force towards mobs (pixels per second^2) - increased from 150
const SPRING_FORCE = 400; // Spring force back to orbit position (pixels per second^2) - reduced from 300
const DAMPING = 0.52; // Velocity damping per frame (0-1, lower = more damping)
const MAX_ATTRACTION_DISTANCE = 2000; // Maximum distance to attract to mobs (pixels) - increased significantly to match combat ranges
const MIN_ATTRACTION_DISTANCE = 1; // Minimum distance to avoid division by zero (pixels) - reduced from 30
const SPAWN_SMOOTH_TIME = 300; // Time in ms to smoothly ramp up forces after spawn - reduced from 500
/**
 * Clean up petal physics states for a player
 */
function cleanupPetalPhysicsStates(playerId) {
    const keysToDelete = [];
    petalPhysicsStates.forEach((_value, key) => {
        if (key.startsWith(playerId)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => {
        petalPhysicsStates.delete(key);
        petalLastDamageTime.delete(key);
    });
}
/**
 * Get viewports for all players
 */
function getPlayerViewports() {
    const viewports = [];
    for (const playerId in constants_1.players) {
        const player = constants_1.players[playerId];
        if (player && player.x !== undefined && player.y !== undefined &&
            !isNaN(player.x) && !isNaN(player.y) &&
            player.x >= 0 && player.x <= constants_1.ACTUAL_WORLD_WIDTH &&
            player.y >= 0 && player.y <= constants_1.ACTUAL_WORLD_HEIGHT) {
            // Use per-player viewport size if available, otherwise fall back to default
            const vpWidth = player.viewportWidth || constants_1.VIEWPORT_WIDTH;
            const vpHeight = player.viewportHeight || constants_1.VIEWPORT_HEIGHT;
            viewports.push({
                x: player.x - vpWidth / 2,
                y: player.y - vpHeight / 2,
                width: vpWidth,
                height: vpHeight
            });
        }
    }
    return viewports;
}
/**
 * Check if a position is in any player's viewport
 */
function isPositionInAnyViewport(x, y) {
    const viewports = getPlayerViewports();
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    for (const viewport of viewports) {
        const extendedViewport = {
            x: viewport.x - constants_1.VIEWPORT_BUFFER,
            y: viewport.y - constants_1.VIEWPORT_BUFFER,
            width: viewport.width + (constants_1.VIEWPORT_BUFFER * 2),
            height: viewport.height + (constants_1.VIEWPORT_BUFFER * 2)
        };
        if (x >= extendedViewport.x && x <= extendedViewport.x + extendedViewport.width &&
            y >= extendedViewport.y && y <= extendedViewport.y + extendedViewport.height) {
            return true;
        }
    }
    return false;
}
/**
 * Check if a position is in any player's viewport with 200% buffer (for websocket optimization)
 */
function isPositionInAnyViewport200Percent(x, y) {
    const viewports = getPlayerViewports();
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    // Use 200% of VIEWPORT_BUFFER (2x)
    const buffer200Percent = constants_1.VIEWPORT_BUFFER * 2;
    for (const viewport of viewports) {
        const extendedViewport = {
            x: viewport.x - buffer200Percent,
            y: viewport.y - buffer200Percent,
            width: viewport.width + (buffer200Percent * 2),
            height: viewport.height + (buffer200Percent * 2)
        };
        if (x >= extendedViewport.x && x <= extendedViewport.x + extendedViewport.width &&
            y >= extendedViewport.y && y <= extendedViewport.y + extendedViewport.height) {
            return true;
        }
    }
    return false;
}
/**
 * Filter enemies to only include those in any player's viewport with 200% buffer
 */
function getEnemiesInViewport200Percent() {
    return constants_1.enemies.filter(enemy => isPositionInAnyViewport200Percent(enemy.x, enemy.y));
}
/**
 * Check if a position is within any player's petal range
 */
function isPositionInPlayerPetalRange(x, y, mobSize) {
    // Check if the mob spawn position would overlap with any player's petal range
    for (const playerId in constants_1.players) {
        const player = constants_1.players[playerId];
        if (!player || !player.loadout)
            continue;
        // Calculate player's maximum petal range
        const petalExtension = player.inputs?.petalExtension || 1.0;
        const baseRadius = 60 * petalExtension;
        // Find the largest petal size and range in the player's loadout
        const playerRangeMod = (0, playerManager_1.calculatePlayerModifiers)(player).range ?? 1.0;
        let maxPetalSize = 0;
        let maxPetalRange = 1.0;
        for (const item of player.loadout) {
            if (item && item.type === 'petal' && item.petalType && item.rarity) {
                const petalStats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
                if (petalStats) {
                    const effectiveSize = item.customSize !== undefined ? item.customSize : petalStats.size;
                    const petalSize = 40 * effectiveSize;
                    maxPetalSize = Math.max(maxPetalSize, petalSize);
                    const petalRange = (petalStats.range ?? 1.0) * playerRangeMod;
                    maxPetalRange = Math.max(maxPetalRange, petalRange);
                }
            }
        }
        // Calculate the maximum range from player center (base radius * max range multiplier + half petal size + half mob size)
        const maxRange = (baseRadius * maxPetalRange) + (maxPetalSize / 2) + (mobSize / 2);
        // Check if the mob spawn position is within this range
        const dx = x - player.x;
        const dy = y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= maxRange) {
            return true; // Position is within petal range
        }
    }
    return false; // Position is safe from petal range
}
/**
 * Get count of enemies in viewport
 */
function getEnemiesInViewportCount() {
    const viewports = getPlayerViewports();
    // If no players are connected, count all enemies (for initial server startup)
    if (viewports.length === 0) {
        return constants_1.enemies.length;
    }
    let count = 0;
    for (const enemy of constants_1.enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            count++;
        }
    }
    return count;
}
/**
 * Validate and fix invalid player positions
 */
function validatePlayerPositions(io) {
    // Clean up any invalid player positions that might affect viewport calculations
    for (const playerId in constants_1.players) {
        const player = constants_1.players[playerId];
        if (player) {
            // Reset invalid positions to a safe default
            if (isNaN(player.x) || isNaN(player.y) ||
                player.x < 0 || player.x > constants_1.ACTUAL_WORLD_WIDTH ||
                player.y < 0 || player.y > constants_1.ACTUAL_WORLD_HEIGHT) {
                console.log(`[SERVER] Fixing invalid position for player ${playerId}: (${player.x}, ${player.y})`);
                // Reset to center of world
                player.x = constants_1.ACTUAL_WORLD_WIDTH / 2;
                player.y = constants_1.ACTUAL_WORLD_HEIGHT / 2;
                // Notify client of position correction
                io.to(playerId).emit('positionCorrected', { x: player.x, y: player.y });
            }
        }
    }
}
/**
 * Update player state (movement, collisions, etc.)
 * This is the main function that handles all player state updates
 */
function updatePlayerState(player, deltaTime, deps) {
    if (!player || !player.inputs) {
        return;
    }
    // Don't update movement for dead players
    if (player.isDead) {
        return;
    }
    const { io, addXPToPlayer, handleMobDrops, sendBossMobDefeatedMessage, updateSpecialMobCounts, createEnemy, savePlayerProgress, transferPlayerToServer, currentServerConfig, currentServerPort, useHttps, database, trackMobKill } = deps;
    // Update player effects
    (0, petal_actions_1.updatePlayerEffects)(player, deltaTime);
    // Apply passive healing from petals
    if (player.loadout && !player.isDead) {
        let totalPassiveHeal = 0;
        for (const petal of player.loadout) {
            if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
                if (petalStats && petalStats.passiveHeal) {
                    // Passive heal is already scaled by rarity (sqrt(3) per level) in generatePetalStats
                    // Now apply healing skill multiplier
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
                    const healingMultiplier = player.skills?.healingMultiplier
                        ? (SKILL_MULTIPLIERS[player.skills.healingMultiplier] || 1.0)
                        : 1.0;
                    // Calculate heal per second, then multiply by deltaTime (in seconds)
                    const healPerSecond = petalStats.passiveHeal * healingMultiplier;
                    const healThisFrame = healPerSecond * deltaTime;
                    totalPassiveHeal += healThisFrame;
                }
            }
        }
        if (totalPassiveHeal > 0) {
            const oldHealth = player.health;
            player.health = Math.min(player.maxHealth, player.health + totalPassiveHeal);
            if (player.health !== oldHealth) {
                io.emit('playerHealed', {
                    playerId: player.id,
                    health: player.health,
                    healAmount: player.health - oldHealth
                });
            }
        }
    }
    let targetVelocityX = 0;
    let targetVelocityY = 0;
    if (player.inputs.useMouse &&
        player.inputs.mouseDirectionX !== undefined &&
        player.inputs.mouseDirectionY !== undefined &&
        player.inputs.mouseSpeedMultiplier !== undefined) {
        // Client has already calculated the direction and speed multiplier
        // Server just needs to apply MAX_SPEED, speed_boost, and other multipliers
        const speed = constants_1.MAX_SPEED * player.speed_boost * (0, petal_actions_1.getSpeedMultiplier)(player) * player.inputs.mouseSpeedMultiplier;
        targetVelocityX = player.inputs.mouseDirectionX * speed;
        targetVelocityY = player.inputs.mouseDirectionY * speed;
        player.angle = Math.atan2(player.inputs.mouseDirectionY, player.inputs.mouseDirectionX);
    }
    else if (player.inputs.keys) {
        if (player.inputs.keys.includes('ArrowLeft') || player.inputs.keys.includes('a'))
            targetVelocityX -= 1;
        if (player.inputs.keys.includes('ArrowRight') || player.inputs.keys.includes('d'))
            targetVelocityX += 1;
        if (player.inputs.keys.includes('ArrowUp') || player.inputs.keys.includes('w'))
            targetVelocityY -= 1;
        if (player.inputs.keys.includes('ArrowDown') || player.inputs.keys.includes('s'))
            targetVelocityY += 1;
        if (targetVelocityX !== 0 && targetVelocityY !== 0) {
            const length = Math.sqrt(targetVelocityX * targetVelocityX + targetVelocityY * targetVelocityY);
            targetVelocityX /= length;
            targetVelocityY /= length;
        }
        const speed = constants_1.MAX_SPEED * player.speed_boost * (0, petal_actions_1.getSpeedMultiplier)(player);
        targetVelocityX *= speed;
        targetVelocityY *= speed;
        if (targetVelocityX !== 0 || targetVelocityY !== 0) {
            player.angle = Math.atan2(targetVelocityY, targetVelocityX);
        }
    }
    // Apply movement smoothing using linear interpolation
    // Smoothing factor represents how fast to reach target velocity (higher = faster response)
    // Using exponential smoothing that works with deltaTime in seconds
    const SMOOTHING_RATE = 20.0; // Velocity change per second (higher = faster response, lower = smoother)
    const smoothingFactor = 1 - Math.exp(-SMOOTHING_RATE * deltaTime);
    // Smoothly interpolate from current velocity to target velocity
    player.velocityX = player.velocityX + (targetVelocityX - player.velocityX) * smoothingFactor;
    player.velocityY = player.velocityY + (targetVelocityY - player.velocityY) * smoothingFactor;
    let newX = player.x + player.velocityX * deltaTime;
    let newY = player.y + player.velocityY * deltaTime;
    // Check for wall collisions
    const wallCollision = (0, physics_1.checkPlayerWallCollisions)(newX, newY, constants_1.PLAYER_SIZE);
    newX = wallCollision.x;
    newY = wallCollision.y;
    let collision = false;
    for (const enemy of constants_1.enemies) {
        // Skip pets (enemies with ownerId) - they don't damage players
        if (enemy.ownerId) {
            continue;
        }
        const collisionInfo = (0, physics_1.checkPlayerEnemyCollision)(newX, newY, constants_1.PLAYER_SIZE, enemy);
        if (collisionInfo.collided) {
            collision = true;
            // Don't damage dead players (corpses)
            if (!player.isDead) {
                // Calculate knockback direction
                const dx = enemy.x - newX;
                const dy = enemy.y - newY;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const normalizedDx = dx / distance;
                const normalizedDy = dy / distance;
                const knockbackDistance = 25;
                const knockbackX = -normalizedDx * knockbackDistance;
                const knockbackY = -normalizedDy * knockbackDistance;
                // Apply knockback to player position
                newX -= normalizedDx * knockbackDistance;
                newY -= normalizedDy * knockbackDistance;
                // Item spawner doesn't deal damage to players, but still applies knockback
                if (enemy.type !== 'item_spawner') {
                    const shieldAmount = (0, petal_actions_1.getShieldAmount)(player);
                    const damageToPlayer = Math.max(0, enemy.damage - shieldAmount);
                    player.health -= damageToPlayer;
                    player.lastDamageTime = Date.now();
                    player.isInvulnerable = true;
                    // Track which enemy dealt the killing blow
                    if (player.health <= 0) {
                        player.killedBy = { type: enemy.type, tier: enemy.tier };
                    }
                    // Set invulnerability timer (1 second after taking damage)
                    setTimeout(() => {
                        if (constants_1.players[player.id]) {
                            constants_1.players[player.id].isInvulnerable = false;
                            // Notify client that invulnerability has ended
                            io.emit('playerInvulnerabilityEnded', { playerId: player.id });
                        }
                    }, 1000);
                    io.emit('playerDamaged', {
                        playerId: player.id,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        isInvulnerable: player.isInvulnerable,
                        knockbackX: knockbackX,
                        knockbackY: knockbackY
                    });
                }
                else {
                    // Emit knockback event for item spawner (without damage)
                    io.emit('playerDamaged', {
                        playerId: player.id,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        isInvulnerable: player.isInvulnerable,
                        knockbackX: knockbackX,
                        knockbackY: knockbackY
                    });
                }
                // Track damage dealt by this player (always track, even if enemy is dead)
                (0, utils_1.trackDamage)(enemy, player.id, player.damage);
                // if (enemy.health - player.damage <= 0) {
                //     console.log('[Server] About to kill enemy with petal', {
                //         enemyId: enemy.id,
                //         enemyType: enemy.type,
                //         currentHealth: enemy.health,
                //         damage: player.damage,
                //         playerId: player.id,
                //         hasDamageContributors: !!enemy.damageContributors,
                //         damageContributorsSize: enemy.damageContributors?.size || 0
                //     });
                // }
                // Skip further processing if enemy is already dead (being processed)
                if (enemy.isDead) {
                    continue;
                }
                const oldHealth = enemy.health;
                enemy.health = Math.max(0, enemy.health - player.damage);
                // Mark enemy for batched damage update at end of frame
                if (!enemy.pendingDamageUpdate) {
                    enemy.pendingDamageUpdate = true;
                }
                enemy.lastDamageHealth = enemy.health;
                if (enemy.health <= 0 && !enemy.isDead) {
                    // console.log('[Server] Enemy health reached 0 from petal damage', {
                    //     enemyId: enemy.id,
                    //     enemyType: enemy.type,
                    //     enemyTier: enemy.tier,
                    //     oldHealth,
                    //     newHealth: enemy.health,
                    //     playerId: player.id,
                    //     hasDamageContributors: !!enemy.damageContributors,
                    //     damageContributorsSize: enemy.damageContributors?.size || 0
                    // });
                    // Mark enemy as dead to prevent multiple death handlers
                    enemy.isDead = true;
                    const index = constants_1.enemies.findIndex(e => e.id === enemy.id);
                    // console.log('[Server] Enemy death handler - found index:', index, 'enemyId:', enemy.id);
                    if (index !== -1) {
                        // Copy enemy data BEFORE cleanup to ensure trackMobKill has all needed info
                        const damageContributorsCopy = enemy.damageContributors ? new Map(enemy.damageContributors) : undefined;
                        // console.log('[Server] Enemy killed by petal collision - BEFORE cleanup', {
                        //     enemyType: enemy.type,
                        //     enemyTier: enemy.tier,
                        //     hasDamageContributors: !!enemy.damageContributors,
                        //     damageContributorsSize: enemy.damageContributors?.size || 0,
                        //     damageContributorsEntries: enemy.damageContributors ? Array.from(enemy.damageContributors.entries()) : [],
                        //     hasDamageContributorsCopy: !!damageContributorsCopy,
                        //     copySize: damageContributorsCopy?.size || 0,
                        //     hasIo: !!io
                        // });
                        // Follow same path as lightning damage - synchronous execution
                        const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                        addXPToPlayer(player, xpGained, player.id);
                        handleMobDrops(enemy);
                        sendBossMobDefeatedMessage(enemy, io, constants_1.players);
                        updateSpecialMobCounts();
                        // Remove enemy from array
                        (0, utils_1.cleanupEnemy)(enemy);
                        constants_1.enemies.splice(index, 1);
                        // Emit enemy destroyed event
                        io.emit('enemyDestroyed', enemy.id);
                        // Call trackMobKill synchronously to ensure it runs (was deferred but causing issues)
                        if (damageContributorsCopy && damageContributorsCopy.size > 0) {
                            const enemyDataForTracking = {
                                type: enemy.type,
                                tier: enemy.tier,
                                damageContributors: damageContributorsCopy
                            };
                            // console.log('[Server] Calling trackMobKill synchronously', {
                            //     enemyType: enemyDataForTracking.type,
                            //     enemyTier: enemyDataForTracking.tier,
                            //     hasIo: !!io,
                            //     damageContributorsSize: enemyDataForTracking.damageContributors.size
                            // });
                            trackMobKill(enemyDataForTracking, constants_1.players, gameState_1.playerUserIds, database, io, savePlayerProgress);
                        }
                        else {
                            // console.warn('[Server] No damageContributorsCopy or empty, skipping trackMobKill', {
                            //     hasCopy: !!damageContributorsCopy,
                            //     copySize: damageContributorsCopy?.size || 0
                            // });
                        }
                    }
                    else {
                        // console.warn('[Server] Enemy not found in enemies array when trying to process death');
                    }
                }
                if (player.health <= 0) {
                    break;
                }
            }
            break;
        }
    }
    // Check for petal-enemy collisions
    if (player.loadout) {
        // Build array of petal instances considering count property
        const petalInstances = [];
        try {
            for (let i = 0; i < player.loadout.length; i++) {
                const petal = player.loadout[i];
                if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                    const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
                    if (!petalStats)
                        continue;
                    const count = petalStats.count || 1; // Use count from stats, default to 1
                    // Validate count is a valid number
                    if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                        console.warn('Invalid petal count:', count, 'for', petal.petalType, petal.rarity);
                        continue;
                    }
                    // Create multiple instances based on count
                    for (let j = 0; j < count; j++) {
                        petalInstances.push({ petal, instanceIndex: j, loadoutIndex: i });
                        // Execute petal actions immediately when spawned
                        if (petalStats.actions) {
                            const petalId = `${player.id}_${i}_${j}`;
                            const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
                            const actionContext = {
                                player: player,
                                petalX: player.x, // Will be updated with actual position in game loop
                                petalY: player.y, // Will be updated with actual position in game loop
                                petalSize: effectiveSize * 40,
                                petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                                enemies: constants_1.enemies,
                                io: io,
                                petalId: petalId,
                                loadoutIndex: i,
                                instanceIndex: j
                            };
                            (0, petal_actions_1.executePetalActionsOnSpawn)(petalStats.actions, actionContext);
                        }
                    }
                }
            }
        }
        catch (error) {
            console.error('Error building petal instances:', error);
        }
        const currentTime = Date.now();
        const petalExtension = player.inputs.petalExtension || 1.0;
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = petalInstances.length > 0 ? (Math.PI * 2) / petalInstances.length : 0;
        const playerRangeModifier = (0, playerManager_1.calculatePlayerModifiers)(player).range ?? 1.0;
        // Initialize petal positions array
        player.petalPositions = [];
        for (let idx = 0; idx < petalInstances.length; idx++) {
            const { petal, instanceIndex, loadoutIndex } = petalInstances[idx];
            if (!petal) {
                continue;
            }
            // Skip petals that are on cooldown
            if (petal.onCooldown) {
                continue;
            }
            // If petal has 0 health but isn't on cooldown, break it immediately
            if (!petal.health || petal.health <= 0) {
                const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
                if (petalStats) {
                    // Execute petal actions before breaking
                    if (petalStats.actions) {
                        const baseRadius = 60 + (player.level * 2);
                        const angleStep = petalInstances.length > 0 ? (Math.PI * 2) / petalInstances.length : 0;
                        const rotationSpeed = (petalStats.speed ?? 1.0) * 0.002;
                        const baseAngle = idx * angleStep;
                        const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
                        const totalAngle = baseAngle + rotationAngle;
                        const petalRange = (petalStats.range ?? 1.0) * playerRangeModifier;
                        const petalRadius = baseRadius * petalRange;
                        const petalX = player.x + Math.cos(totalAngle) * petalRadius;
                        const petalY = player.y + Math.sin(totalAngle) * petalRadius;
                        const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
                        const petalSize = 40 * effectiveSize;
                        const actionContext = {
                            player: player,
                            petalX: petalX,
                            petalY: petalY,
                            petalSize: petalSize,
                            petalDamage: petalStats.damage,
                            enemies: constants_1.enemies,
                            io: io
                        };
                        (0, petal_actions_1.executePetalActions)(petalStats.actions, actionContext, 'on_break');
                    }
                    // Petal breaks - set on cooldown instead of removing
                    petal.onCooldown = true;
                    // Store original petal data for restoration
                    const originalPetal = {
                        type: petal.type,
                        petalType: petal.petalType,
                        rarity: petal.rarity,
                        maxHealth: petal.maxHealth
                    };
                    // Add cooldown (similar to other items)
                    const cooldownTime = petalStats.cooldown || 10000; // Use petal-specific cooldown or default to 10 seconds
                    setTimeout(() => {
                        if (constants_1.players[player.id] && player.loadout[loadoutIndex] && player.loadout[loadoutIndex].onCooldown) {
                            // Restore petal after cooldown
                            const restoredPetal = {
                                ...originalPetal,
                                health: originalPetal.maxHealth, // Restore full health
                                onCooldown: false
                            };
                            // Apply petal health bonus
                            (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, player);
                            player.loadout[loadoutIndex] = restoredPetal;
                            io.emit('petalRestored', {
                                playerId: player.id,
                                slotIndex: loadoutIndex,
                                petal: player.loadout[loadoutIndex]
                            });
                            // console.log(`Petal ${petal.petalType} restored for player ${player.id} after ${cooldownTime}ms`);
                        }
                    }, cooldownTime);
                    io.emit('petalBroken', {
                        playerId: player.id,
                        slotIndex: loadoutIndex,
                        petalType: petal.petalType,
                        rarity: petal.rarity
                    });
                }
                continue;
            }
            const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
            if (!petalStats)
                continue;
            // Get effective size (custom size if set, otherwise base stats)
            const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
            const rotationSpeed = (petalStats.speed ?? 1.0) * 0.002; // Convert to radians per ms
            const baseAngle = idx * angleStep;
            const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
            // Fixed-direction petals don't orbit - they stay at a fixed relative position
            const totalAngle = petalStats.fixedDirection !== undefined ? baseAngle : baseAngle + rotationAngle;
            // Apply petal range multiplier and player range modifier to base radius
            const petalRange = (petalStats.range ?? 1.0) * playerRangeModifier;
            const petalRadius = baseRadius * petalRange;
            // Calculate target orbit position (where petal should be without physics)
            const targetX = player.x + Math.cos(totalAngle) * petalRadius;
            const targetY = player.y + Math.sin(totalAngle) * petalRadius;
            // Petal ID is needed for actions, projectiles, and collisions regardless of physics
            const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
            // Skip physics for petals with range 0 (they should stay at player position)
            let petalX;
            let petalY;
            if (petalStats.fixedDirection !== undefined) {
                // Fixed-direction petals stay directly on the player
                petalX = player.x;
                petalY = player.y;
            }
            else if (petalRange === 0) {
                // No physics for range 0 petals - use target position directly
                petalX = targetX;
                petalY = targetY;
            }
            else {
                // Get per-petal physics values (use defaults if not specified)
                const petalAttractionForce = petalStats.attractionForce ?? ATTRACTION_FORCE;
                const petalSpringForce = petalStats.springForce ?? SPRING_FORCE;
                const petalDamping = petalStats.damping ?? DAMPING;
                const petalMaxAttractionDistance = petalStats.maxAttractionDistance ?? MAX_ATTRACTION_DISTANCE;
                const petalMinAttractionDistance = petalStats.minAttractionDistance ?? MIN_ATTRACTION_DISTANCE;
                const petalSpawnSmoothTime = petalStats.spawnSmoothTime ?? SPAWN_SMOOTH_TIME;
                // Get or initialize petal physics state
                let physicsState = petalPhysicsStates.get(petalId);
                if (!physicsState) {
                    // Initialize physics state at target orbit position (prevents petals from appearing inside player on reload)
                    physicsState = {
                        x: targetX,
                        y: targetY,
                        vx: 0,
                        vy: 0,
                        spawnTime: currentTime
                    };
                    petalPhysicsStates.set(petalId, physicsState);
                }
                // Calculate smooth initialization factor (ramp up forces over spawn smooth time)
                const timeSinceSpawn = physicsState.spawnTime ? currentTime - physicsState.spawnTime : petalSpawnSmoothTime;
                const smoothFactor = Math.min(1.0, timeSinceSpawn / petalSpawnSmoothTime);
                // Calculate attraction force towards nearby mobs
                let attractionFx = 0;
                let attractionFy = 0;
                // physicsState.x and physicsState.y are already in world coordinates (since targetX/Y are in world coords)
                const worldPetalX = physicsState.x;
                const worldPetalY = physicsState.y;
                for (const enemy of constants_1.enemies) {
                    // Skip pets
                    if (enemy.ownerId) {
                        continue;
                    }
                    // Get mob stats to determine hitbox size
                    const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                    const enemySize = mobStats ? mobStats.size * 40 : constants_1.ENEMY_SIZE; // Use mob size or fallback to base size
                    const enemyRadius = enemySize / 2;
                    const dx = enemy.x - worldPetalX;
                    const dy = enemy.y - worldPetalY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    // Calculate max attraction distance including mob's hitbox radius
                    // This allows attraction to work when petal is near the mob's edge, not just its center
                    const maxAttractionDistanceWithHitbox = petalMaxAttractionDistance + enemyRadius;
                    // Only attract if within range (distance from center to center, accounting for hitbox)
                    if (distance > 0 && distance < maxAttractionDistanceWithHitbox && distance > petalMinAttractionDistance) {
                        // Inverse square law for attraction (stronger when closer)
                        const forceStrength = petalAttractionForce / (distance * distance);
                        const normalizedDx = dx / distance;
                        const normalizedDy = dy / distance;
                        // Apply smooth factor to attraction (gradually increase after spawn)
                        // Note: Force is in world coordinates, but we need to apply it to relative velocity
                        attractionFx += normalizedDx * forceStrength * deltaTime * smoothFactor;
                        attractionFy += normalizedDy * forceStrength * deltaTime * smoothFactor;
                    }
                }
                // Calculate spring force back to orbit position
                const springDx = targetX - physicsState.x;
                const springDy = targetY - physicsState.y;
                const springDistance = Math.sqrt(springDx * springDx + springDy * springDy);
                let springFx = 0;
                let springFy = 0;
                if (springDistance > 0) {
                    const normalizedSpringDx = springDx / springDistance;
                    const normalizedSpringDy = springDy / springDistance;
                    // Spring force is proportional to distance from target
                    // Apply smooth factor to spring force (gradually increase after spawn)
                    springFx = normalizedSpringDx * petalSpringForce * springDistance * deltaTime * smoothFactor;
                    springFy = normalizedSpringDy * petalSpringForce * springDistance * deltaTime * smoothFactor;
                }
                // Apply forces to velocity
                physicsState.vx += attractionFx + springFx;
                physicsState.vy += attractionFy + springFy;
                // Apply damping to velocity
                physicsState.vx *= petalDamping;
                physicsState.vy *= petalDamping;
                // Update position based on velocity
                physicsState.x += physicsState.vx * deltaTime;
                physicsState.y += physicsState.vy * deltaTime;
                // Use physics-based position
                petalX = physicsState.x;
                petalY = physicsState.y;
            }
            // Update petal position in action context
            (0, petal_actions_1.updatePetalPosition)(petalId, petalX, petalY);
            // Store petal position for client synchronization
            player.petalPositions.push({
                loadoutIndex,
                instanceIndex,
                x: petalX,
                y: petalY
            });
            // Check if petal can shoot projectiles (only when extended)
            if (petalExtension > 1.0 && petalStats.projectile) {
                const projectileConfig = petalStats.projectile;
                const lastShotTime = gameState_1.petalLastProjectileTime.get(petalId) || 0;
                const cooldown = petalStats.cooldown || 2000;
                // Check if cooldown has passed
                if (currentTime - lastShotTime >= cooldown) {
                    // Calculate projectile angle - shoot in the direction the petal is facing (tangent to rotation)
                    // The petal is at totalAngle, so the projectile should go in that direction
                    const projectileAngle = totalAngle;
                    const projectileSpeed = projectileConfig.speed || 200; // pixels per second
                    const spreadAngle = projectileConfig.spreadAngle || 0.2; // radians
                    const projectileCount = projectileConfig.count || 1;
                    // Create projectiles
                    for (let i = 0; i < projectileCount; i++) {
                        // Calculate spread angle for multiple projectiles
                        let finalAngle = projectileAngle;
                        if (projectileCount > 1) {
                            const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                            finalAngle = projectileAngle + spreadOffset;
                        }
                        const projectile = {
                            id: `${petalId}_projectile_${currentTime}_${i}`,
                            playerId: player.id,
                            x: petalX,
                            y: petalY,
                            startX: petalX,
                            startY: petalY,
                            angle: finalAngle,
                            speed: projectileSpeed / 1000, // Convert to pixels per millisecond
                            distance: 0,
                            maxDistance: projectileConfig.distance,
                            petalType: petal.petalType,
                            petalRarity: petal.rarity,
                            damage: petalStats.damage,
                            size: effectiveSize,
                            health: petalStats.health,
                            maxHealth: petalStats.health
                        };
                        gameState_1.playerProjectiles.push(projectile);
                    }
                    // Update last shot time for this petal instance
                    gameState_1.petalLastProjectileTime.set(petalId, currentTime);
                }
            }
            // Check collision with enemies
            for (const enemy of constants_1.enemies) {
                // Skip all pets (pets should not be damaged by any player's petals)
                if (enemy.ownerId) {
                    continue;
                }
                // Get mob stats to determine proper hitbox size
                const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                const enemySize = mobStats ? mobStats.size * 40 : constants_1.ENEMY_SIZE; // Use mob size or fallback to base size
                const petalSize = 40 * effectiveSize; // Use effective size (custom or base)
                // Use circular hitbox collision (matching player-to-mob and mob-to-mob collision)
                // Both petal and enemy positions are center points
                const enemyRadius = enemySize / 2;
                const petalRadius = petalSize / 2;
                const dx = enemy.x - petalX;
                const dy = enemy.y - petalY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const minDistance = enemyRadius + petalRadius;
                if (distance < minDistance && distance > 0) {
                    // Check if petal has a damage cooldown and is still on cooldown
                    const damageCooldownKey = `${player.id}_${loadoutIndex}_${instanceIndex}`;
                    if (petalStats.damageCooldown) {
                        const lastDmgTime = petalLastDamageTime.get(damageCooldownKey) || 0;
                        if (currentTime - lastDmgTime < petalStats.damageCooldown) {
                            continue; // Skip damage, petal stays active
                        }
                    }
                    // Petal hits enemy - deal damage to both
                    const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
                    const finalDamage = petalStats.damage * damageMultiplier;
                    // console.log('[Server] Petal collision detected', {
                    //     enemyId: enemy.id,
                    //     enemyType: enemy.type,
                    //     enemyHealth: enemy.health,
                    //     finalDamage,
                    //     playerId: player.id,
                    //     petalType: petal.petalType
                    // });
                    // Track damage dealt by this player (always track, even if enemy is dead)
                    (0, utils_1.trackDamage)(enemy, player.id, finalDamage);
                    // Skip further processing if enemy is already dead (being processed)
                    if (enemy.isDead) {
                        continue;
                    }
                    enemy.health = Math.max(0, enemy.health - finalDamage);
                    // Petals with damageCooldown don't take damage from mobs (they can't break)
                    if (petalStats.damageCooldown) {
                        petalLastDamageTime.set(damageCooldownKey, currentTime);
                    }
                    else {
                        const mobDamage = mobStats ? mobStats.damage : 1; // Petal loses health equal to mob damage, fallback to 1 if mobStats is null
                        petal.health = Math.max(0, petal.health - mobDamage);
                    }
                    // Apply poison effect if the petal has poison
                    if (petalStats.poison && petalStats.poison > 0 && petalStats.poisonDuration && petalStats.poisonDuration > 0) {
                        if (!enemy.poisonEffects) {
                            enemy.poisonEffects = [];
                        }
                        // Add or refresh poison effect
                        const currentTime = Date.now();
                        const endTime = currentTime + petalStats.poisonDuration;
                        // Check if there's already a poison effect from this player
                        const existingPoisonIndex = enemy.poisonEffects.findIndex(p => p.playerId === player.id);
                        if (existingPoisonIndex >= 0) {
                            // Refresh the existing poison effect with the new damage and duration
                            enemy.poisonEffects[existingPoisonIndex] = {
                                damage: petalStats.poison,
                                endTime: endTime,
                                playerId: player.id
                            };
                        }
                        else {
                            // Add a new poison effect
                            enemy.poisonEffects.push({
                                damage: petalStats.poison,
                                endTime: endTime,
                                playerId: player.id
                            });
                        }
                    }
                    // Apply knockback to enemy
                    const knockbackForce = petalStats.knockback || 0;
                    if (knockbackForce > 0) {
                        // Calculate knockback direction from petal to enemy
                        const dx = enemy.x - petalX;
                        const dy = enemy.y - petalY;
                        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                        const normalizedDx = dx / distance;
                        const normalizedDy = dy / distance;
                        // Apply knockback to enemy, accounting for mass (heavier mobs are harder to knock back)
                        // Mass is already calculated from size (which includes rarity), so higher rarity = more mass
                        const mobMass = mobStats ? mobStats.mass : 1.0; // Default mass of 1.0 if mobStats is null
                        const effectiveKnockback = knockbackForce / mobMass; // Divide by mass so heavier mobs resist knockback more
                        enemy.knockbackX = normalizedDx * effectiveKnockback;
                        enemy.knockbackY = normalizedDy * effectiveKnockback;
                    }
                    // Mark enemy for batched damage update at end of frame
                    if (!enemy.pendingDamageUpdate) {
                        enemy.pendingDamageUpdate = true;
                    }
                    enemy.lastDamageHealth = enemy.health;
                    // Check if item spawner was hit and has 1% chance to spawn a random petal
                    if (enemy.type === 'item_spawner' && Math.random() < 0.01) {
                        // Get all petal types and filter out admin petals
                        const allPetalTypes = (0, petals_1.getAllPetalTypes)();
                        const nonAdminPetalTypes = allPetalTypes.filter(petalType => {
                            // Check if the petal is an admin petal by checking any rarity
                            const commonStats = (0, petals_1.getPetalStats)(petalType, 'common');
                            return !commonStats?.isAdminPetal;
                        });
                        if (nonAdminPetalTypes.length > 0) {
                            // Pick a random petal type
                            const randomPetalType = nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)];
                            // Pick a random rarity with weighted probabilities (rarer items are much rarer)
                            // Weighted distribution: common is most common, rarer items are exponentially rarer
                            const rarityWeights = {
                                'common': 30.0, // 50%
                                'uncommon': 10.0, // 20%
                                'rare': 10.0, // 12%
                                'epic': 5.0, // 8%
                                'legendary': 5.0, // 5%
                                'mythic': 5.0, // 3%
                                'ultra': 5.0, // 1.5%
                                'super': 5.0, // 0.4%
                                'unique': 0.05 // 0.1%
                            };
                            // Calculate total weight
                            const totalWeight = petals_1.RARITY_LEVELS.reduce((sum, rarity) => sum + (rarityWeights[rarity] || 0), 0);
                            // Pick a rarity based on weighted probability
                            let randomRarity = 'common'; // Default fallback
                            const random = Math.random() * totalWeight;
                            let cumulativeWeight = 0;
                            for (const rarity of petals_1.RARITY_LEVELS) {
                                cumulativeWeight += rarityWeights[rarity] || 0;
                                if (random <= cumulativeWeight) {
                                    randomRarity = rarity;
                                    break;
                                }
                            }
                            // Calculate spawner's hitbox radius to ensure items spawn outside it
                            const spawnerMobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                            const spawnerSize = spawnerMobStats ? spawnerMobStats.size * 40 : constants_1.ENEMY_SIZE;
                            const spawnerRadius = spawnerSize / 2;
                            const minSpawnDistance = spawnerRadius + 30; // Spawn at least 30px outside the hitbox
                            const maxSpawnDistance = spawnerRadius + 100; // Spawn up to 100px away
                            // Spawn item at a random angle and distance outside the spawner's hitbox
                            const spawnAngle = Math.random() * Math.PI * 2;
                            const spawnDistance = minSpawnDistance + Math.random() * (maxSpawnDistance - minSpawnDistance);
                            const offsetX = Math.cos(spawnAngle) * spawnDistance;
                            const offsetY = Math.sin(spawnAngle) * spawnDistance;
                            const itemId = Math.random().toString(36).substr(2, 9);
                            const spawnTime = Date.now();
                            // Determine eligible players - include split player IDs if player is split
                            let eligiblePlayersForItem = [player.id];
                            const { splitPlayers } = require('../petal_actions');
                            const originalId = player.id.replace('_split2', '').replace('_split1', '');
                            const splitState = splitPlayers.get(originalId);
                            if (splitState) {
                                // Player is split - include both split player IDs
                                eligiblePlayersForItem = [splitState.player1.id, splitState.player2.id, originalId];
                            }
                            const newItem = {
                                id: itemId,
                                type: 'petal',
                                x: enemy.x + offsetX,
                                y: enemy.y + offsetY,
                                rarity: randomRarity,
                                petalType: randomPetalType,
                                eligiblePlayers: eligiblePlayersForItem, // Include all split player IDs
                                pickedUpBy: new Set(),
                                spawnTime: spawnTime
                            };
                            // Check and fix wall collisions before adding item
                            (0, physics_2.checkItemWallCollisions)(newItem);
                            gameState_1.items.push(newItem);
                            // Send itemSpawned event to eligible players (map split player IDs to original socket IDs)
                            const { getOriginalSocketId } = require('./utils');
                            for (const eligiblePlayerId of eligiblePlayersForItem) {
                                const originalSocketId = getOriginalSocketId(eligiblePlayerId);
                                io.to(originalSocketId).emit('itemSpawned', newItem);
                            }
                            // Schedule automatic removal after expiration time
                            const expirationTime = gameState_1.ITEM_EXPIRATION_TIMES[randomRarity] || 10000;
                            const timeout = setTimeout(() => {
                                gameState_1.itemExpirationTimeouts.delete(itemId);
                                const itemIndex = gameState_1.items.findIndex(item => item.id === itemId);
                                if (itemIndex !== -1) {
                                    const expiredItem = gameState_1.items[itemIndex];
                                    gameState_1.items.splice(itemIndex, 1);
                                    // Notify eligible players that item expired
                                    const { getOriginalSocketId } = require('./utils');
                                    if (expiredItem.eligiblePlayers) {
                                        for (const playerId of expiredItem.eligiblePlayers) {
                                            const originalSocketId = getOriginalSocketId(playerId);
                                            io.to(originalSocketId).emit('itemRemoved', itemId);
                                        }
                                    }
                                    console.log(`[ITEM_SPAWNER] Petal ${randomPetalType} (${randomRarity}) expired after ${expirationTime}ms`);
                                }
                            }, expirationTime);
                            gameState_1.itemExpirationTimeouts.set(itemId, timeout);
                            console.log(`[ITEM_SPAWNER] Spawned random petal: ${randomPetalType} (${randomRarity}) for player ${player.name}`);
                        }
                    }
                    // Check collision with mob projectiles (treat them as enemy petals)
                    for (let projIdx = gameState_1.mobProjectiles.length - 1; projIdx >= 0; projIdx--) {
                        const mobProjectile = gameState_1.mobProjectiles[projIdx];
                        // Skip destroyed projectiles
                        if (!mobProjectile || mobProjectile.health <= 0) {
                            continue;
                        }
                        const projectileSize = mobProjectile.size * 20; // Convert to pixels
                        const projectileRadius = projectileSize / 2;
                        const petalSize = 40 * effectiveSize; // Use effective size (custom or base)
                        const petalRadius = petalSize / 2;
                        const dx = mobProjectile.x - petalX;
                        const dy = mobProjectile.y - petalY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const minDistance = projectileRadius + petalRadius;
                        if (distance < minDistance && distance > 0) {
                            // Player petal hits mob projectile - deal damage to both
                            const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
                            const finalDamage = petalStats.damage * damageMultiplier;
                            // Damage the mob projectile
                            mobProjectile.health -= finalDamage;
                            // Damage the player petal (mob projectile acts as enemy petal)
                            const projectilePetalStats = (0, petals_1.getPetalStats)(mobProjectile.petalType, mobProjectile.petalRarity);
                            const projectileDamage = projectilePetalStats ? projectilePetalStats.damage : mobProjectile.damage;
                            petal.health = Math.max(0, petal.health - projectileDamage);
                            // Remove projectile if destroyed
                            if (mobProjectile.health <= 0) {
                                gameState_1.mobProjectiles.splice(projIdx, 1);
                            }
                        }
                    }
                    // Handle petal collision for wait_until_collision actions
                    const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
                    const collisionContext = {
                        player: player,
                        petalX: petalX,
                        petalY: petalY,
                        petalSize: petalSize,
                        petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                        enemies: constants_1.enemies,
                        io: io,
                        petalId: petalId,
                        loadoutIndex: loadoutIndex,
                        instanceIndex: instanceIndex
                    };
                    (0, petal_actions_1.handlePetalCollision)(petalId, collisionContext);
                    // Check if petal breaks
                    if (petal.health <= 0) {
                        // Execute petal actions before breaking
                        if (petalStats.actions) {
                            const actionContext = {
                                player: player,
                                petalX: petalX,
                                petalY: petalY,
                                petalSize: petalSize,
                                petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                                enemies: constants_1.enemies,
                                io: io
                            };
                            (0, petal_actions_1.executePetalActions)(petalStats.actions, actionContext, 'on_break');
                        }
                        // Petal breaks - set on cooldown instead of removing
                        petal.onCooldown = true;
                        // Store original petal data for restoration
                        const originalPetal = {
                            type: petal.type,
                            petalType: petal.petalType,
                            rarity: petal.rarity,
                            maxHealth: petal.maxHealth
                        };
                        // Add cooldown (similar to other items)
                        const cooldownTime = petalStats.cooldown || 10000; // Use petal-specific cooldown or default to 10 seconds
                        setTimeout(() => {
                            if (constants_1.players[player.id] && player.loadout[loadoutIndex] && player.loadout[loadoutIndex].onCooldown) {
                                // Restore petal after cooldown
                                const restoredPetal = {
                                    ...originalPetal,
                                    health: originalPetal.maxHealth, // Restore full health
                                    onCooldown: false
                                };
                                // Apply petal health bonus
                                (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, player);
                                player.loadout[loadoutIndex] = restoredPetal;
                                io.emit('petalRestored', {
                                    playerId: player.id,
                                    slotIndex: loadoutIndex,
                                    petal: player.loadout[loadoutIndex]
                                });
                                // console.log(`Petal ${petal.petalType} restored for player ${player.id} after ${cooldownTime}ms`);
                            }
                        }, cooldownTime);
                        io.emit('petalBroken', {
                            playerId: player.id,
                            slotIndex: loadoutIndex,
                            petalType: petal.petalType,
                            rarity: petal.rarity
                        });
                    }
                    // Check if enemy dies (only process once per enemy)
                    if (enemy.health <= 0 && !enemy.isDead) {
                        // console.log('[Server] Enemy died from petal collision', {
                        //     enemyId: enemy.id,
                        //     enemyType: enemy.type,
                        //     enemyTier: enemy.tier,
                        //     enemyHealth: enemy.health,
                        //     playerId: player.id,
                        //     hasDamageContributors: !!enemy.damageContributors,
                        //     damageContributorsSize: enemy.damageContributors?.size || 0
                        // });
                        // Mark enemy as dead to prevent multiple death handlers
                        enemy.isDead = true;
                        const index = constants_1.enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            // console.log('[Server] Enemy death handler - found index', { enemyId: enemy.id });
                            // CRITICAL: Copy damageContributors BEFORE cleanupEnemy clears it
                            const damageContributorsCopy = enemy.damageContributors ? new Map(enemy.damageContributors) : undefined;
                            // console.log('[Server] Enemy killed by petal collision (second handler) - BEFORE cleanup', {
                            //     enemyType: enemy.type,
                            //     enemyTier: enemy.tier,
                            //     hasDamageContributors: !!enemy.damageContributors,
                            //     damageContributorsSize: enemy.damageContributors?.size || 0,
                            //     hasDamageContributorsCopy: !!damageContributorsCopy,
                            //     copySize: damageContributorsCopy?.size || 0,
                            //     hasIo: !!io
                            // });
                            // Follow same path as lightning damage - synchronous execution
                            const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                            addXPToPlayer(player, xpGained, player.id);
                            handleMobDrops(enemy);
                            sendBossMobDefeatedMessage(enemy, io, constants_1.players);
                            updateSpecialMobCounts();
                            // Remove enemy from array
                            (0, utils_1.cleanupEnemy)(enemy);
                            constants_1.enemies.splice(index, 1);
                            // Emit enemy destroyed event
                            io.emit('enemyDestroyed', enemy.id);
                            // Call trackMobKill synchronously to ensure it runs
                            // Use the copy we made BEFORE cleanupEnemy
                            if (damageContributorsCopy) {
                                const enemyDataForTracking = {
                                    type: enemy.type,
                                    tier: enemy.tier,
                                    damageContributors: damageContributorsCopy
                                };
                                // console.log('[Server] Calling trackMobKill synchronously (second handler)', {
                                //     enemyType: enemyDataForTracking.type,
                                //     enemyTier: enemyDataForTracking.tier,
                                //     hasIo: !!io,
                                //     damageContributorsSize: enemyDataForTracking.damageContributors.size
                                // });
                                trackMobKill(enemyDataForTracking, constants_1.players, gameState_1.playerUserIds, database, io, savePlayerProgress);
                            }
                            else {
                                // console.warn('[Server] No damageContributorsCopy (second handler), skipping trackMobKill');
                            }
                        }
                    }
                }
            }
            // Check for corpse revival if this is a yggdrasil petal (always active)
            if (petal.petalType === 'yggdrasil') {
                const revivalRange = 80; // Range for automatic revival
                for (const [otherPlayerId, otherPlayer] of Object.entries(constants_1.players)) {
                    if (otherPlayerId !== player.id && otherPlayer.isDead) {
                        const distance = Math.sqrt((petalX - otherPlayer.x) ** 2 + (petalY - otherPlayer.y) ** 2);
                        if (distance <= revivalRange) {
                            // Break the yggdrasil petal when it revives someone
                            petal.health = 0; // This will trigger the petal breaking logic below
                            // Revive the target player
                            otherPlayer.isDead = false;
                            otherPlayer.health = otherPlayer.maxHealth;
                            otherPlayer.isInvulnerable = true;
                            otherPlayer.lastDamageTime = 0;
                            // Notify all clients about the revival
                            io.emit('playerRevived', {
                                revivedPlayerId: otherPlayerId,
                                revivingPlayerId: player.id,
                                revivedPlayerName: otherPlayer.name,
                                revivingPlayerName: player.name
                            });
                            // Give revived player temporary invulnerability
                            setTimeout(() => {
                                if (constants_1.players[otherPlayerId]) {
                                    constants_1.players[otherPlayerId].isInvulnerable = false;
                                    io.emit('playerInvulnerabilityEnded', { playerId: otherPlayerId });
                                }
                            }, constants_1.RESPAWN_INVULNERABILITY_TIME);
                            console.log(`Player ${player.name} automatically revived ${otherPlayer.name} using yggdrasil petal (petal broke)`);
                            // Break out of the loop since we've used the petal
                            break;
                        }
                    }
                }
            }
        }
    }
    // Check for item collisions (independent of enemy collisions)
    // Optimize: use squared distance comparison to avoid Math.sqrt
    const pickupRadiusSquared = constants_1.PLAYER_SIZE * constants_1.PLAYER_SIZE;
    for (let i = gameState_1.items.length - 1; i >= 0; i--) {
        const item = gameState_1.items[i];
        const dx = newX - item.x;
        const dy = newY - item.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < pickupRadiusSquared) {
            // Check if player has already picked up this item
            if (item.pickedUpBy && item.pickedUpBy.has(player.id)) {
                continue; // Skip if already picked up by this player
            }
            // Check if player is eligible to pick up this item
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                let isEligible = false;
                // First, check if player ID is directly eligible
                if (item.eligiblePlayers.includes(player.id)) {
                    isEligible = true;
                }
                else {
                    // Check if this player is part of a split pair
                    const { splitPlayers } = require('../petal_actions');
                    const originalId = player.id.replace('_split2', '').replace('_split1', '');
                    const splitState = splitPlayers.get(originalId);
                    if (splitState) {
                        // Player is split - check if any of the split player IDs or original ID is eligible
                        isEligible = item.eligiblePlayers.includes(splitState.player1.id) ||
                            item.eligiblePlayers.includes(splitState.player2.id) ||
                            item.eligiblePlayers.includes(originalId);
                    }
                    else {
                        // Not split - check if original socket ID is eligible (for items created with original ID)
                        const { getOriginalSocketId } = require('./utils');
                        const originalSocketId = getOriginalSocketId(player.id);
                        if (player.id !== originalSocketId) {
                            isEligible = item.eligiblePlayers.includes(originalSocketId);
                        }
                    }
                }
                if (!isEligible) {
                    // Player is not eligible - skip this item
                    // Debug log to help diagnose pickup issues
                    console.log(`[PICKUP] Player ${player.id} (${player.name}) tried to pick up item ${item.id} but is not eligible. Eligible players:`, item.eligiblePlayers);
                    continue;
                }
            }
            // Add item to player's inventory (which may be shared with split player)
            const rarity = item.rarity || 'common';
            const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
            (0, playerManager_1.addItem)(player.inventory, rarity, itemKey, 1);
            // Mark as picked up by this player (don't remove from world)
            if (!item.pickedUpBy) {
                item.pickedUpBy = new Set();
            }
            item.pickedUpBy.add(player.id);
            // console.log(`[PICKUP] Player ${player.id} (${player.name}) picked up item ${item.id} (${itemKey}, ${rarity})`);
            // Check if this player is split and update the other split player's inventory reference
            const { splitPlayers } = require('../petal_actions');
            const originalId = player.id.replace('_split2', '').replace('_split1', '');
            const splitState = splitPlayers.get(originalId);
            if (splitState) {
                // Both players share the same inventory, so update the other player's reference
                if (splitState.player1.id === player.id) {
                    splitState.player2.inventory = player.inventory;
                }
                else if (splitState.player2.id === player.id) {
                    splitState.player1.inventory = player.inventory;
                }
            }
            // Emit events to update client
            // Map split player IDs to original socket IDs for socket room targeting
            const { getOriginalSocketId } = require('./utils');
            const originalSocketId = getOriginalSocketId(player.id);
            io.to(originalSocketId).emit('itemPickedUp', item.id);
            io.to(originalSocketId).emit('inventoryUpdated', player.inventory);
            // Save player progress to persist inventory changes
            const userId = gameState_1.playerUserIds[player.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
            // Remove item from world if all eligible players have picked it up
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                const allPickedUp = item.eligiblePlayers.every(playerId => item.pickedUpBy && item.pickedUpBy.has(playerId));
                if (allPickedUp) {
                    // Clean up expiration timeout if item is removed early
                    const timeout = gameState_1.itemExpirationTimeouts.get(item.id);
                    if (timeout) {
                        clearTimeout(timeout);
                        gameState_1.itemExpirationTimeouts.delete(item.id);
                    }
                    gameState_1.items.splice(i, 1);
                    // Notify only eligible players that the item is gone
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
            }
        }
    }
    // Check for teleporter interactions
    let currentTeleporter = null;
    const currentTime = Date.now();
    const isOnCooldown = player.teleportCooldown && currentTime < player.teleportCooldown;
    for (const element of map_data_1.WORLD_MAP.filter(constants_1.isTeleporter)) {
        if (!element.properties?.teleportTo)
            continue;
        const teleporterId = `teleporter_${element.x}_${element.y}`;
        const teleporterCX = (element.x + element.width / 2) * constants_1.SCALE_FACTOR;
        const teleporterCY = (element.y + element.height / 2) * constants_1.SCALE_FACTOR;
        const playerCX = newX + constants_1.PLAYER_SIZE / 2;
        const playerCY = newY + constants_1.PLAYER_SIZE / 2;
        const dx = playerCX - teleporterCX;
        const dy = playerCY - teleporterCY;
        const distSq = dx * dx + dy * dy;
        const suctionRadius = constants_1.TELEPORTER_SUCTION_RADIUS * constants_1.SCALE_FACTOR;
        const activationRadius = constants_1.TELEPORTER_RADIUS * constants_1.SCALE_FACTOR;
        // Apply suction force if player is within suction radius and NOT on cooldown
        if (distSq <= suctionRadius * suctionRadius && !isOnCooldown) {
            const dist = Math.sqrt(distSq) || 1;
            // Stronger pull as player gets closer
            const pullStrength = constants_1.TELEPORTER_SUCTION_FORCE * (1 - dist / suctionRadius) * deltaTime;
            newX -= (dx / dist) * pullStrength;
            newY -= (dy / dist) * pullStrength;
        }
        // Check if player is within activation radius
        if (distSq <= activationRadius * activationRadius) {
            currentTeleporter = teleporterId;
            // Check if player just entered this teleporter
            if (player.currentTeleporter !== teleporterId) {
                player.currentTeleporter = teleporterId;
                player.teleporterEnterTime = currentTime;
                io.to(player.id).emit('teleporterEntered', {
                    teleporterId,
                    timeRequired: 1000,
                    teleportTo: element.properties.teleportTo
                });
                console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} entered teleporter, waiting 1 second...`);
            }
            // Check if player has been in teleporter for 1 second and is not on cooldown
            const timeInTeleporter = currentTime - (player.teleporterEnterTime || currentTime);
            if (timeInTeleporter >= 1000 && !isOnCooldown) {
                const teleportTo = element.properties.teleportTo;
                // Set 5 second player-based cooldown
                player.teleportCooldown = currentTime + constants_1.TELEPORTER_COOLDOWN;
                if (teleportTo.serverPort && teleportTo.serverPort !== currentServerPort) {
                    console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleporting to server port ${teleportTo.serverPort} after 1 second delay`);
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    transferPlayerToServer(player, teleportTo.serverPort, teleportTo.x * constants_1.SCALE_FACTOR, teleportTo.y * constants_1.SCALE_FACTOR, io, database, useHttps, currentServerConfig, currentServerPort).catch(error => {
                        console.error(`[SERVER ${currentServerConfig.name}] Failed to transfer player ${player.name}:`, error);
                        io.to(player.id).emit('transferFailed', { message: 'Failed to connect to target server' });
                        player.teleportCooldown = undefined;
                    });
                    return;
                }
                else {
                    newX = teleportTo.x * constants_1.SCALE_FACTOR;
                    newY = teleportTo.y * constants_1.SCALE_FACTOR;
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleported to (${newX}, ${newY}) after 1 second delay`);
                    io.to(player.id).emit('playerTeleported', {
                        newX,
                        newY,
                        playerId: player.id
                    });
                }
            }
            break;
        }
    }
    // If player is no longer in any teleporter, reset teleporter state
    if (!currentTeleporter && player.currentTeleporter) {
        console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} left teleporter`);
        player.currentTeleporter = undefined;
        player.teleporterEnterTime = undefined;
        io.to(player.id).emit('teleporterExited');
    }
    player.x = newX;
    player.y = newY;
    if (player.health <= 0 && !player.isDead) {
        // Mark player as dead instead of respawning immediately
        player.isDead = true;
        // Set random rotation for the corpse
        player.angle = Math.random() * Math.PI * 2;
        // Despawn all pets owned by this player
        (0, petal_actions_1.despawnAllPlayerPets)(player.id, io);
        io.emit('playerDied', {
            playerId: player.id,
            x: player.x,
            y: player.y,
            angle: player.angle,
            killedBy: player.killedBy
        });
        // No automatic respawn - player must manually respawn via continue button
    }
}
