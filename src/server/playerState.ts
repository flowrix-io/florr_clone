import { Server as SocketIOServer } from 'socket.io';
import { ServerPlayer } from '../player';
import { Enemy, getXPFromEnemy } from '../server_utils';
import { PlayerProjectile } from '../enemy';
import { WorldItem } from '../item';
import { RARITY_LEVELS, Rarity, getAllPetalTypes, getPetalStats } from '../petals';
import { 
    players, 
    enemies, 
    PLAYER_SIZE, 
    ENEMY_SIZE, 
    MAX_SPEED, 
    ACTUAL_WORLD_WIDTH, 
    ACTUAL_WORLD_HEIGHT,
    VIEWPORT_WIDTH,
    VIEWPORT_HEIGHT,
    VIEWPORT_BUFFER,
    SCALE_FACTOR,
    WORLD_MAP,
    isTeleporter,
    RESPAWN_INVULNERABILITY_TIME,
    ServerConfig
} from '../constants';
import {
    items,
    playerUserIds,
    mobProjectiles,
    playerProjectiles,
    petalLastProjectileTime,
    ITEM_EXPIRATION_TIMES
} from './gameState';
import {
    checkPlayerWallCollisions,
    checkPlayerEnemyCollision
} from './physics';
import {
    checkItemWallCollisions
} from './physics';
import {
    updatePlayerEffects,
    getDamageMultiplier,
    getSpeedMultiplier,
    getShieldAmount,
    executePetalActionsOnSpawn,
    updatePetalActions,
    handlePetalCollision,
    updatePetalPosition,
    executePetalActions
} from '../petal_actions';
import { getMobStats } from '../mobs';
import { addItem, applyPetalHealthBonus } from './playerManager';
import { trackDamage, sendBossMobDefeatedMessage } from './utils';
import { transferPlayerToServer as transferPlayerToServerModule } from './crossServer';

// Interface for player state dependencies
export interface PlayerStateDependencies {
    io: SocketIOServer;
    addXPToPlayer: (player: ServerPlayer, xp: number, socketId?: string) => void;
    handleMobDrops: (enemy: Enemy) => void;
    sendBossMobDefeatedMessage: (enemy: Enemy, io: SocketIOServer, players: Record<string, ServerPlayer>) => void;
    updateSpecialMobCounts: () => void;
    createEnemy: () => Enemy | null;
    savePlayerProgress: (player: ServerPlayer, userId: string) => void;
    transferPlayerToServer: (player: ServerPlayer, targetServerPort: number, targetX: number, targetY: number, io: SocketIOServer, database: any, USE_HTTPS: boolean, currentServerConfig: ServerConfig, currentServerPort: number) => Promise<boolean>;
    currentServerConfig: any;
    currentServerPort: number;
    useHttps: boolean;
    database: any;
}

/**
 * Get viewports for all players
 */
export function getPlayerViewports(): Array<{x: number, y: number, width: number, height: number}> {
    const viewports: Array<{x: number, y: number, width: number, height: number}> = [];
    
    for (const playerId in players) {
        const player = players[playerId];
        if (player && player.x !== undefined && player.y !== undefined && 
            !isNaN(player.x) && !isNaN(player.y) &&
            player.x >= 0 && player.x <= ACTUAL_WORLD_WIDTH &&
            player.y >= 0 && player.y <= ACTUAL_WORLD_HEIGHT) {
            
            viewports.push({
                x: player.x - VIEWPORT_WIDTH / 2,
                y: player.y - VIEWPORT_HEIGHT / 2,
                width: VIEWPORT_WIDTH,
                height: VIEWPORT_HEIGHT
            });
        }
    }
    
    return viewports;
}

/**
 * Check if a position is in any player's viewport
 */
export function isPositionInAnyViewport(x: number, y: number): boolean {
    const viewports = getPlayerViewports();
    
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    
    for (const viewport of viewports) {
        const extendedViewport = {
            x: viewport.x - VIEWPORT_BUFFER,
            y: viewport.y - VIEWPORT_BUFFER,
            width: viewport.width + (VIEWPORT_BUFFER * 2),
            height: viewport.height + (VIEWPORT_BUFFER * 2)
        };
        
        if (x >= extendedViewport.x && x <= extendedViewport.x + extendedViewport.width &&
            y >= extendedViewport.y && y <= extendedViewport.y + extendedViewport.height) {
            return true;
        }
    }
    
    return false;
}

/**
 * Check if a position is within any player's petal range
 */
export function isPositionInPlayerPetalRange(x: number, y: number, mobSize: number): boolean {
    // Check if the mob spawn position would overlap with any player's petal range
    for (const playerId in players) {
        const player = players[playerId];
        if (!player || !player.loadout) continue;
        
        // Calculate player's maximum petal range
        const petalExtension = player.inputs?.petalExtension || 1.0;
        const baseRadius = 60 * petalExtension;
        
        // Find the largest petal size and range in the player's loadout
        let maxPetalSize = 0;
        let maxPetalRange = 1.0;
        for (const item of player.loadout) {
            if (item && item.type === 'petal' && item.petalType && item.rarity) {
                const petalStats = getPetalStats(item.petalType, item.rarity);
                if (petalStats) {
                    const effectiveSize = (item as any).customSize !== undefined ? (item as any).customSize : petalStats.size;
                    const petalSize = 40 * effectiveSize;
                    maxPetalSize = Math.max(maxPetalSize, petalSize);
                    const petalRange = petalStats.range ?? 1.0;
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
export function getEnemiesInViewportCount(): number {
    const viewports = getPlayerViewports();
    
    // If no players are connected, count all enemies (for initial server startup)
    if (viewports.length === 0) {
        return enemies.length;
    }
    
    let count = 0;
    for (const enemy of enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            count++;
        }
    }
    
    return count;
}

/**
 * Validate and fix invalid player positions
 */
export function validatePlayerPositions(io: SocketIOServer): void {
    // Clean up any invalid player positions that might affect viewport calculations
    for (const playerId in players) {
        const player = players[playerId];
        if (player) {
            // Reset invalid positions to a safe default
            if (isNaN(player.x) || isNaN(player.y) || 
                player.x < 0 || player.x > ACTUAL_WORLD_WIDTH ||
                player.y < 0 || player.y > ACTUAL_WORLD_HEIGHT) {
                
                console.log(`[SERVER] Fixing invalid position for player ${playerId}: (${player.x}, ${player.y})`);
                
                // Reset to center of world
                player.x = ACTUAL_WORLD_WIDTH / 2;
                player.y = ACTUAL_WORLD_HEIGHT / 2;
                
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
export function updatePlayerState(
    player: ServerPlayer, 
    deltaTime: number,
    deps: PlayerStateDependencies
): void {
    if (!player || !player.inputs) {
        return;
    }

    // Don't update movement for dead players
    if (player.isDead) {
        return;
    }

    const { io, addXPToPlayer, handleMobDrops, sendBossMobDefeatedMessage, updateSpecialMobCounts, createEnemy, savePlayerProgress, transferPlayerToServer, currentServerConfig, currentServerPort, useHttps, database } = deps;

    // Update player effects
    updatePlayerEffects(player, deltaTime);

    let targetVelocityX = 0;
    let targetVelocityY = 0;

    if (player.inputs.useMouse && 
        player.inputs.mouseDirectionX !== undefined && 
        player.inputs.mouseDirectionY !== undefined &&
        player.inputs.mouseSpeedMultiplier !== undefined) {
        // Client has already calculated the direction and speed multiplier
        // Server just needs to apply MAX_SPEED, speed_boost, and other multipliers
        const speed = MAX_SPEED * player.speed_boost * getSpeedMultiplier(player) * player.inputs.mouseSpeedMultiplier;
        targetVelocityX = player.inputs.mouseDirectionX * speed;
        targetVelocityY = player.inputs.mouseDirectionY * speed;
        player.angle = Math.atan2(player.inputs.mouseDirectionY, player.inputs.mouseDirectionX);
    } else if (player.inputs.keys) {
        if (player.inputs.keys.includes('ArrowLeft') || player.inputs.keys.includes('a')) targetVelocityX -= 1;
        if (player.inputs.keys.includes('ArrowRight') || player.inputs.keys.includes('d')) targetVelocityX += 1;
        if (player.inputs.keys.includes('ArrowUp') || player.inputs.keys.includes('w')) targetVelocityY -= 1;
        if (player.inputs.keys.includes('ArrowDown') || player.inputs.keys.includes('s')) targetVelocityY += 1;

        if (targetVelocityX !== 0 && targetVelocityY !== 0) {
            const length = Math.sqrt(targetVelocityX * targetVelocityX + targetVelocityY * targetVelocityY);
            targetVelocityX /= length;
            targetVelocityY /= length;
        }

        const speed = MAX_SPEED * player.speed_boost * getSpeedMultiplier(player);
        targetVelocityX *= speed;
        targetVelocityY *= speed;

        if (targetVelocityX !== 0 || targetVelocityY !== 0) {
            player.angle = Math.atan2(targetVelocityY, targetVelocityX);
        }
    }

    player.velocityX = targetVelocityX;
    player.velocityY = targetVelocityY;

    let newX = player.x + player.velocityX * deltaTime;
    let newY = player.y + player.velocityY * deltaTime;

    // Check for wall collisions
    const wallCollision = checkPlayerWallCollisions(newX, newY, PLAYER_SIZE);
    newX = wallCollision.x;
    newY = wallCollision.y;

    let collision = false;
    for (const enemy of enemies) {
        const collisionInfo = checkPlayerEnemyCollision(newX, newY, PLAYER_SIZE, enemy);
        
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
                    const shieldAmount = getShieldAmount(player);
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
                        if (players[player.id]) {
                            players[player.id].isInvulnerable = false;
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
                } else {
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
                trackDamage(enemy, player.id, player.damage);
                
                // Skip further processing if enemy is already dead (being processed)
                if ((enemy as any).isDead) {
                    continue;
                }
                
                enemy.health -= player.damage;
                io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });

                if (enemy.health <= 0 && !(enemy as any).isDead) {
                    // Mark enemy as dead to prevent multiple death handlers
                    (enemy as any).isDead = true;
                    
                    const index = enemies.findIndex(e => e.id === enemy.id);
                    if (index !== -1) {
                        const xpGained = getXPFromEnemy(enemy);
                        addXPToPlayer(player, xpGained, player.id);
                        // Handle mob drops using the new drop table system (includes all eligible players)
                        handleMobDrops(enemy);
                        sendBossMobDefeatedMessage(enemy, io, players);
                        enemies.splice(index, 1);
                        updateSpecialMobCounts();
                        io.emit('enemyDestroyed', enemy.id);
                        // Try to spawn a new enemy, but only if we can find a valid position
                        const newEnemy = createEnemy();
                        if (newEnemy) {
                            enemies.push(newEnemy);
                        }
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
        const petalInstances: Array<{petal: any, instanceIndex: number, loadoutIndex: number}> = [];
        try {
            for (let i = 0; i < player.loadout.length; i++) {
                const petal = player.loadout[i];
                if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                    const petalStats = getPetalStats(petal.petalType, petal.rarity);
                    if (!petalStats) continue;
                    
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
                            const effectiveSize = (petal as any).customSize !== undefined ? (petal as any).customSize : petalStats.size;
                            const actionContext = {
                                player: player,
                                petalX: player.x, // Will be updated with actual position in game loop
                                petalY: player.y, // Will be updated with actual position in game loop
                                petalSize: effectiveSize * 40,
                                petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                                enemies: enemies,
                                io: io,
                                petalId: petalId,
                                loadoutIndex: i,
                                instanceIndex: j
                            };
                            executePetalActionsOnSpawn(petalStats.actions, actionContext);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error building petal instances:', error);
        }

        const currentTime = Date.now();
        const petalExtension = player.inputs.petalExtension || 1.0;
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = petalInstances.length > 0 ? (Math.PI * 2) / petalInstances.length : 0;

        for (let idx = 0; idx < petalInstances.length; idx++) {
            const {petal, instanceIndex, loadoutIndex} = petalInstances[idx];
            
            if (!petal || !petal.health || petal.health <= 0) {
                continue;
            }
            
            // Skip petals that are on cooldown
            if (petal.onCooldown) {
                continue;
            }

            const petalStats = getPetalStats(petal.petalType, petal.rarity);
            if (!petalStats) continue;
            
            // Get effective size (custom size if set, otherwise base stats)
            const effectiveSize = (petal as any).customSize !== undefined ? (petal as any).customSize : petalStats.size;
            
            const rotationSpeed = (petalStats.speed ?? 1.0) * 0.002; // Convert to radians per ms
            const baseAngle = idx * angleStep;
            const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
            const totalAngle = baseAngle + rotationAngle;

            // Apply petal range multiplier to base radius
            const petalRange = petalStats.range ?? 1.0;
            const petalRadius = baseRadius * petalRange;
            const petalX = player.x + Math.cos(totalAngle) * petalRadius;
            const petalY = player.y + Math.sin(totalAngle) * petalRadius;
            
            // Update petal position in action context
            const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
            updatePetalPosition(petalId, petalX, petalY);

            // Check if petal can shoot projectiles (only when extended)
            if (petalExtension > 1.0 && petalStats.projectile) {
                const projectileConfig = petalStats.projectile;
                const lastShotTime = petalLastProjectileTime.get(petalId) || 0;
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

                        const projectile: PlayerProjectile = {
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

                        playerProjectiles.push(projectile);
                    }

                    // Update last shot time for this petal instance
                    petalLastProjectileTime.set(petalId, currentTime);
                }
            }

            // Check collision with enemies
            for (const enemy of enemies) {
                // Get mob stats to determine proper hitbox size
                const mobStats = getMobStats(enemy.type, enemy.tier);
                const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE; // Use mob size or fallback to base size
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
                    // Petal hits enemy - deal damage to both
                    const damageMultiplier = getDamageMultiplier(player);
                    const finalDamage = petalStats.damage * damageMultiplier;
                    
                    // Track damage dealt by this player (always track, even if enemy is dead)
                    trackDamage(enemy, player.id, finalDamage);
                    
                    // Skip further processing if enemy is already dead (being processed)
                    if ((enemy as any).isDead) {
                        continue;
                    }
                    
                    enemy.health -= finalDamage;
                    petal.health -= mobStats ? mobStats.damage : 1; // Petal loses health equal to mob damage, fallback to 1 if mobStats is null

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
                        } else {
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

                    io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });

                    // Check if item spawner was hit and has 1% chance to spawn a random petal
                    if (enemy.type === 'item_spawner' && Math.random() < 0.01) {
                        // Get all petal types and filter out admin petals
                        const allPetalTypes = getAllPetalTypes();
                        const nonAdminPetalTypes = allPetalTypes.filter(petalType => {
                            // Check if the petal is an admin petal by checking any rarity
                            const commonStats = getPetalStats(petalType, 'common');
                            return !commonStats?.isAdminPetal;
                        });

                        if (nonAdminPetalTypes.length > 0) {
                            // Pick a random petal type
                            const randomPetalType = nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)];
                            
                            // Pick a random rarity with weighted probabilities (rarer items are much rarer)
                            // Weighted distribution: common is most common, rarer items are exponentially rarer
                            const rarityWeights: { [key: string]: number } = {
                                'common': 30.0,      // 50%
                                'uncommon': 10.0,    // 20%
                                'rare': 10.0,        // 12%
                                'epic': 5.0,         // 8%
                                'legendary': 5.0,    // 5%
                                'mythic': 5.0,       // 3%
                                'ultra': 5.0,        // 1.5%
                                'super': 5.0,        // 0.4%
                                'unique': 0.05        // 0.1%
                            };
                            
                            // Calculate total weight
                            const totalWeight = RARITY_LEVELS.reduce((sum, rarity) => sum + (rarityWeights[rarity] || 0), 0);
                            
                            // Pick a rarity based on weighted probability
                            let randomRarity: Rarity = 'common'; // Default fallback
                            const random = Math.random() * totalWeight;
                            let cumulativeWeight = 0;
                            
                            for (const rarity of RARITY_LEVELS) {
                                cumulativeWeight += rarityWeights[rarity] || 0;
                                if (random <= cumulativeWeight) {
                                    randomRarity = rarity;
                                    break;
                                }
                            }
                            
                            // Calculate spawner's hitbox radius to ensure items spawn outside it
                            const spawnerMobStats = getMobStats(enemy.type, enemy.tier);
                            const spawnerSize = spawnerMobStats ? spawnerMobStats.size * 40 : ENEMY_SIZE;
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
                            
                            const newItem: WorldItem = {
                                id: itemId,
                                type: 'petal',
                                x: enemy.x + offsetX,
                                y: enemy.y + offsetY,
                                rarity: randomRarity,
                                petalType: randomPetalType,
                                eligiblePlayers: [player.id], // Only the player who hit it can pick it up
                                pickedUpBy: new Set(),
                                spawnTime: spawnTime
                            };
                            
                            // Check and fix wall collisions before adding item
                            checkItemWallCollisions(newItem);
                            
                            items.push(newItem);
                            
                            // Send itemSpawned event to the player
                            io.to(player.id).emit('itemSpawned', newItem);
                            
                            // Schedule automatic removal after expiration time
                            const expirationTime = ITEM_EXPIRATION_TIMES[randomRarity] || 10000;
                            setTimeout(() => {
                                const itemIndex = items.findIndex(item => item.id === itemId);
                                if (itemIndex !== -1) {
                                    const expiredItem = items[itemIndex];
                                    items.splice(itemIndex, 1);
                                    
                                    // Notify the player that item expired
                                    io.to(player.id).emit('itemRemoved', itemId);
                                    
                                    console.log(`[ITEM_SPAWNER] Petal ${randomPetalType} (${randomRarity}) expired after ${expirationTime}ms`);
                                }
                            }, expirationTime);
                            
                            console.log(`[ITEM_SPAWNER] Spawned random petal: ${randomPetalType} (${randomRarity}) for player ${player.name}`);
                        }
                    }

            // Check collision with mob projectiles (treat them as enemy petals)
            for (let projIdx = mobProjectiles.length - 1; projIdx >= 0; projIdx--) {
                const mobProjectile = mobProjectiles[projIdx];
                
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
                    const damageMultiplier = getDamageMultiplier(player);
                    const finalDamage = petalStats.damage * damageMultiplier;
                    
                    // Damage the mob projectile
                    mobProjectile.health -= finalDamage;
                    
                    // Damage the player petal (mob projectile acts as enemy petal)
                    const projectilePetalStats = getPetalStats(mobProjectile.petalType, mobProjectile.petalRarity);
                    const projectileDamage = projectilePetalStats ? projectilePetalStats.damage : mobProjectile.damage;
                    petal.health -= projectileDamage;
                    
                    // Remove projectile if destroyed
                    if (mobProjectile.health <= 0) {
                        mobProjectiles.splice(projIdx, 1);
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
                        enemies: enemies,
                        io: io,
                        petalId: petalId,
                        loadoutIndex: loadoutIndex,
                        instanceIndex: instanceIndex
                    };
                    handlePetalCollision(petalId, collisionContext);

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
                                enemies: enemies,
                                io: io
                            };
                            executePetalActions(petalStats.actions, actionContext, 'on_break');
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
                            if (players[player.id] && player.loadout[loadoutIndex] && player.loadout[loadoutIndex]!.onCooldown) {
                                // Restore petal after cooldown
                                const restoredPetal = {
                                    ...originalPetal,
                                    health: originalPetal.maxHealth, // Restore full health
                                    onCooldown: false
                                };
                                // Apply petal health bonus
                                applyPetalHealthBonus(restoredPetal, player);
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
                    if (enemy.health <= 0 && !(enemy as any).isDead) {
                        // Mark enemy as dead to prevent multiple death handlers
                        (enemy as any).isDead = true;
                        
                        const index = enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            const xpGained = getXPFromEnemy(enemy);
                            addXPToPlayer(player, xpGained, player.id);
                            // Handle mob drops using the new drop table system (includes all eligible players)
                            handleMobDrops(enemy);
                            sendBossMobDefeatedMessage(enemy, io, players);
                            enemies.splice(index, 1);
                            updateSpecialMobCounts();
                            io.emit('enemyDestroyed', enemy.id);
                            // Try to spawn a new enemy, but only if we can find a valid position
                            const newEnemy = createEnemy();
                            if (newEnemy) {
                                enemies.push(newEnemy);
                            }
                        }
                    }
                }
            }

            // Check for corpse revival if this is a yggdrasil petal (always active)
            if (petal.petalType === 'yggdrasil') {
                const revivalRange = 80; // Range for automatic revival
                
                for (const [otherPlayerId, otherPlayer] of Object.entries(players)) {
                    if (otherPlayerId !== player.id && otherPlayer.isDead) {
                        const distance = Math.sqrt(
                            (petalX - otherPlayer.x) ** 2 + (petalY - otherPlayer.y) ** 2
                        );
                        
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
                                if (players[otherPlayerId]) {
                                    players[otherPlayerId].isInvulnerable = false;
                                    io.emit('playerInvulnerabilityEnded', { playerId: otherPlayerId });
                                }
                            }, RESPAWN_INVULNERABILITY_TIME);
                            
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
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const distance = Math.sqrt((newX - item.x) ** 2 + (newY - item.y) ** 2);
        if (distance < PLAYER_SIZE) {
            // Check if player has already picked up this item
            if (item.pickedUpBy && item.pickedUpBy.has(player.id)) {
                continue; // Skip if already picked up by this player
            }
            
            // Check if player is eligible to pick up this item
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                if (!item.eligiblePlayers.includes(player.id)) {
                    // Player is not eligible - skip this item
                    // Debug log to help diagnose pickup issues
                    console.log(`[PICKUP] Player ${player.id} (${player.name}) tried to pick up item ${item.id} but is not eligible. Eligible players:`, item.eligiblePlayers);
                    continue;
                }
            }
            
            // Add item to player's inventory
            const rarity = item.rarity || 'common';
            const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
            addItem(player.inventory, rarity, itemKey, 1);
            
            // Mark as picked up by this player (don't remove from world)
            if (!item.pickedUpBy) {
                item.pickedUpBy = new Set();
            }
            item.pickedUpBy.add(player.id);
            
            // console.log(`[PICKUP] Player ${player.id} (${player.name}) picked up item ${item.id} (${itemKey}, ${rarity})`);
            
            // Emit events to update client
            // Only send itemPickedUp to the player who picked it up, not to everyone
            io.to(player.id).emit('itemPickedUp', item.id);
            io.to(player.id).emit('inventoryUpdated', player.inventory);
            
            // Save player progress to persist inventory changes
            const userId = playerUserIds[player.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
            
            // Remove item from world if all eligible players have picked it up
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                const allPickedUp = item.eligiblePlayers.every(playerId => 
                    item.pickedUpBy && item.pickedUpBy.has(playerId)
                );
                if (allPickedUp) {
                    items.splice(i, 1);
                    // Notify only eligible players that the item is gone
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
            }
        }
    }

    // Check for teleporter interactions with 1-second delay
    let currentTeleporter: string | null = null;
    const currentTime = Date.now();
    
    // Check if player is currently in a teleporter
    for (const element of WORLD_MAP.filter(isTeleporter)) {
        const teleporterId = `teleporter_${element.x}_${element.y}_${element.width}_${element.height}`;
        const teleporterX = element.x * SCALE_FACTOR;
        const teleporterY = element.y * SCALE_FACTOR;
        const teleporterWidth = element.width * SCALE_FACTOR;
        const teleporterHeight = element.height * SCALE_FACTOR;

        // Check if player is inside teleporter bounds (using proper collision detection)
        if (
            newX + PLAYER_SIZE > teleporterX &&
            newX < teleporterX + teleporterWidth &&
            newY + PLAYER_SIZE > teleporterY &&
            newY < teleporterY + teleporterHeight &&
            element.properties?.teleportTo
        ) {
            currentTeleporter = teleporterId;
            
            // Check if player just entered this teleporter
            if (player.currentTeleporter !== teleporterId) {
                player.currentTeleporter = teleporterId;
                player.teleporterEnterTime = currentTime;
                
                // Notify client that player entered teleporter (for UI feedback)
                io.to(player.id).emit('teleporterEntered', {
                    teleporterId,
                    timeRequired: 1000, // 1 second
                    teleportTo: element.properties.teleportTo
                });
                
                console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} entered teleporter, waiting 1 second...`);
            }
            
            // Check if player has been in teleporter for 1 second and is not on cooldown
            const timeInTeleporter = currentTime - (player.teleporterEnterTime || currentTime);
            const isOnCooldown = player.teleportCooldown && currentTime < player.teleportCooldown;
            
            if (timeInTeleporter >= 1000 && !isOnCooldown) {
                const teleportTo = element.properties.teleportTo;
                
                // Set cooldown to prevent rapid teleportations
                player.teleportCooldown = currentTime + 2000; // 2 second cooldown
                
                // Check if this is a cross-server teleporter
                if (teleportTo.serverPort && teleportTo.serverPort !== currentServerPort) {
                    // Cross-server teleportation
                    console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleporting to server port ${teleportTo.serverPort} after 1 second delay`);
                    
                    // Reset teleporter state
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    
                    // Attempt to transfer player to target server
                    transferPlayerToServer(
                        player,
                        teleportTo.serverPort,
                        teleportTo.x * SCALE_FACTOR,
                        teleportTo.y * SCALE_FACTOR,
                        io,
                        database,
                        useHttps,
                        currentServerConfig,
                        currentServerPort
                    ).catch(error => {
                        console.error(`[SERVER ${currentServerConfig.name}] Failed to transfer player ${player.name}:`, error);
                        // Optionally notify the player about the failed transfer
                        io.to(player.id).emit('transferFailed', { message: 'Failed to connect to target server' });
                        // Reset cooldown on failure
                        player.teleportCooldown = undefined;
                    });
                    
                    // Don't update player position this tick as they're being transferred
                    return;
                } else {
                    // Same-server teleportation
                    newX = teleportTo.x * SCALE_FACTOR;
                    newY = teleportTo.y * SCALE_FACTOR;
                    
                    // Reset teleporter state
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    
                    console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleported to (${newX}, ${newY}) after 1 second delay`);
                    
                    // Emit teleport event to client for visual effects
                    io.to(player.id).emit('playerTeleported', {
                        newX,
                        newY,
                        playerId: player.id
                    });
                }
            }
            
            break; // Player can only be in one teleporter at a time
        }
    }
    
    // If player is no longer in any teleporter, reset teleporter state
    if (!currentTeleporter && player.currentTeleporter) {
        console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} left teleporter`);
        player.currentTeleporter = undefined;
        player.teleporterEnterTime = undefined;
        
        // Notify client that player left teleporter
        io.to(player.id).emit('teleporterExited');
    }

    player.x = newX;
    player.y = newY;

    if (player.health <= 0 && !player.isDead) {
        // Mark player as dead instead of respawning immediately
        player.isDead = true;
        // Set random rotation for the corpse
        player.angle = Math.random() * Math.PI * 2;
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

