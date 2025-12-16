import { Enemy } from '../server_utils';
import { ServerPlayer } from '../player';
import { WorldItem } from '../item';
import { 
    WORLD_MAP, 
    isWall, 
    SCALE_FACTOR, 
    ACTUAL_WORLD_WIDTH, 
    ACTUAL_WORLD_HEIGHT,
    PLAYER_SIZE,
    ENEMY_SIZE
} from '../constants';
import { getMobStats } from '../mobs';

// Boundary threshold for wall extension (same as out-of-bounds zone)
const BOUNDARY_THRESHOLD = 100;
const COLLISION_BUFFER = 5; // Buffer between entities and walls

/**
 * Extend walls near world boundaries for collision detection
 * Returns an extended wall that reaches the nearest boundary if the wall is close to it
 */
export function getExtendedWallForCollision(wall: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    const extendedWall = { ...wall };
    
    // Check left boundary (x = 0)
    if (wall.x < BOUNDARY_THRESHOLD) {
        const extension = wall.x;
        extendedWall.x = 0;
        extendedWall.width += extension;
    }
    
    // Check right boundary (x = ACTUAL_WORLD_WIDTH)
    if (wall.x + wall.width > ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD) {
        const extension = ACTUAL_WORLD_WIDTH - (wall.x + wall.width);
        if (extension > 0) {
            extendedWall.width += extension;
        } else {
            // Wall already extends beyond, clamp to boundary
            extendedWall.width = ACTUAL_WORLD_WIDTH - wall.x;
        }
    }
    
    // Check top boundary (y = 0)
    if (wall.y < BOUNDARY_THRESHOLD) {
        const extension = wall.y;
        extendedWall.y = 0;
        extendedWall.height += extension;
    }
    
    // Check bottom boundary (y = ACTUAL_WORLD_HEIGHT)
    if (wall.y + wall.height > ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD) {
        const extension = ACTUAL_WORLD_HEIGHT - (wall.y + wall.height);
        if (extension > 0) {
            extendedWall.height += extension;
        } else {
            // Wall already extends beyond, clamp to boundary
            extendedWall.height = ACTUAL_WORLD_HEIGHT - wall.y;
        }
    }
    
    return extendedWall;
}

/**
 * Check if two rectangles overlap
 */
function rectanglesOverlap(
    left1: number, right1: number, top1: number, bottom1: number,
    left2: number, right2: number, top2: number, bottom2: number
): boolean {
    return right1 > left2 && left1 < right2 && bottom1 > top2 && top1 < bottom2;
}

/**
 * Resolve rectangle-rectangle collision by pushing entity away from wall
 */
function resolveRectangleCollision(
    entityX: number, entityY: number, entityHalfSize: number,
    wallLeft: number, wallRight: number, wallTop: number, wallBottom: number
): { x: number; y: number } {
    const entityLeft = entityX - entityHalfSize;
    const entityRight = entityX + entityHalfSize;
    const entityTop = entityY - entityHalfSize;
    const entityBottom = entityY + entityHalfSize;

    // Calculate overlap amounts
    const overlapLeft = entityRight - wallLeft;
    const overlapRight = wallRight - entityLeft;
    const overlapTop = entityBottom - wallTop;
    const overlapBottom = wallBottom - entityTop;

    // Find the minimum overlap to determine push direction
    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

    let newX = entityX;
    let newY = entityY;

    // Push entity away from wall in the direction of minimum overlap
    if (minOverlap === overlapLeft) {
        newX = wallLeft - entityHalfSize - COLLISION_BUFFER;
    } else if (minOverlap === overlapRight) {
        newX = wallRight + entityHalfSize + COLLISION_BUFFER;
    } else if (minOverlap === overlapTop) {
        newY = wallTop - entityHalfSize - COLLISION_BUFFER;
    } else if (minOverlap === overlapBottom) {
        newY = wallBottom + entityHalfSize + COLLISION_BUFFER;
    }

    return { x: newX, y: newY };
}

/**
 * Resolve player-wall collision using penetration depth method
 */
function resolvePlayerWallCollision(
    playerX: number, playerY: number, playerSize: number,
    wallX: number, wallY: number, wallWidth: number, wallHeight: number
): { x: number; y: number } {
    const overlapX = (playerX + playerSize / 2) - (wallX + wallWidth / 2);
    const overlapY = (playerY + playerSize / 2) - (wallY + wallHeight / 2);
    const combinedHalfWidths = playerSize / 2 + wallWidth / 2;
    const combinedHalfHeights = playerSize / 2 + wallHeight / 2;

    if (Math.abs(overlapX) < combinedHalfWidths && Math.abs(overlapY) < combinedHalfHeights) {
        const penX = combinedHalfWidths - Math.abs(overlapX);
        const penY = combinedHalfHeights - Math.abs(overlapY);

        let newX = playerX;
        let newY = playerY;

        if (penX < penY) {
            if (overlapX > 0) newX += penX; else newX -= penX;
        } else {
            if (overlapY > 0) newY += penY; else newY -= penY;
        }

        return { x: newX, y: newY };
    }

    return { x: playerX, y: playerY };
}

/**
 * Check and resolve player-wall collisions
 */
export function checkPlayerWallCollisions(
    playerX: number, 
    playerY: number, 
    playerSize: number = PLAYER_SIZE
): { x: number; y: number; collided: boolean } {
    let newX = playerX;
    let newY = playerY;
    let collided = false;

    for (const element of WORLD_MAP) {
        if (element.type === 'wall' && element.width > 0 && element.height > 0) {
            const wallX = element.x * SCALE_FACTOR;
            const wallY = element.y * SCALE_FACTOR;
            const wallWidth = element.width * SCALE_FACTOR;
            const wallHeight = element.height * SCALE_FACTOR;

            // Extend wall to boundaries if it's close to them
            const extendedWall = getExtendedWallForCollision({
                x: wallX,
                y: wallY,
                width: wallWidth,
                height: wallHeight
            });

            if (
                newX < extendedWall.x + extendedWall.width &&
                newX + playerSize > extendedWall.x &&
                newY < extendedWall.y + extendedWall.height &&
                newY + playerSize > extendedWall.y
            ) {
                const resolved = resolvePlayerWallCollision(
                    newX, newY, playerSize,
                    extendedWall.x, extendedWall.y, extendedWall.width, extendedWall.height
                );
                newX = resolved.x;
                newY = resolved.y;
                collided = true;
            }
        }
    }

    return { x: newX, y: newY, collided };
}

/**
 * Check and resolve enemy-wall collisions
 */
export function checkEnemyWallCollisions(enemy: Enemy): void {
    const mobStats = getMobStats(enemy.type, enemy.tier);
    const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
    const halfSize = enemySize / 2;

    WORLD_MAP.filter(isWall).forEach(wall => {
        const scaledWall = {
            x: wall.x * SCALE_FACTOR,
            y: wall.y * SCALE_FACTOR,
            width: wall.width * SCALE_FACTOR,
            height: wall.height * SCALE_FACTOR
        };

        // Extend wall to boundaries if it's close to them
        const extendedWall = getExtendedWallForCollision(scaledWall);

        // Check if enemy (with size) overlaps with wall
        const enemyLeft = enemy.x - halfSize;
        const enemyRight = enemy.x + halfSize;
        const enemyTop = enemy.y - halfSize;
        const enemyBottom = enemy.y + halfSize;

        const wallLeft = extendedWall.x;
        const wallRight = extendedWall.x + extendedWall.width;
        const wallTop = extendedWall.y;
        const wallBottom = extendedWall.y + extendedWall.height;

        // Check for overlap
        if (rectanglesOverlap(
            enemyLeft, enemyRight, enemyTop, enemyBottom,
            wallLeft, wallRight, wallTop, wallBottom
        )) {
            const resolved = resolveRectangleCollision(
                enemy.x, enemy.y, halfSize,
                wallLeft, wallRight, wallTop, wallBottom
            );
            enemy.x = resolved.x;
            enemy.y = resolved.y;
        }
    });
}

/**
 * Check and resolve item-wall collisions
 */
export function checkItemWallCollisions(item: WorldItem): void {
    const ITEM_SIZE = 15; // Item radius (30x30 hitbox)
    const halfSize = ITEM_SIZE;
    
    WORLD_MAP.filter(isWall).forEach(wall => {
        const scaledWall = {
            x: wall.x * SCALE_FACTOR,
            y: wall.y * SCALE_FACTOR,
            width: wall.width * SCALE_FACTOR,
            height: wall.height * SCALE_FACTOR
        };

        // Extend wall to boundaries if it's close to them
        const extendedWall = getExtendedWallForCollision(scaledWall);

        // Check if item (with size) overlaps with wall
        const itemLeft = item.x - halfSize;
        const itemRight = item.x + halfSize;
        const itemTop = item.y - halfSize;
        const itemBottom = item.y + halfSize;

        const wallLeft = extendedWall.x;
        const wallRight = extendedWall.x + extendedWall.width;
        const wallTop = extendedWall.y;
        const wallBottom = extendedWall.y + extendedWall.height;

        // Check for overlap
        if (rectanglesOverlap(
            itemLeft, itemRight, itemTop, itemBottom,
            wallLeft, wallRight, wallTop, wallBottom
        )) {
            const resolved = resolveRectangleCollision(
                item.x, item.y, halfSize,
                wallLeft, wallRight, wallTop, wallBottom
            );
            item.x = resolved.x;
            item.y = resolved.y;
        }
    });
}

/**
 * Check if a projectile hits a wall
 */
export function checkProjectileWallCollision(
    projectileX: number,
    projectileY: number,
    projectileHalfSize: number
): boolean {
    const projLeft = projectileX - projectileHalfSize;
    const projRight = projectileX + projectileHalfSize;
    const projTop = projectileY - projectileHalfSize;
    const projBottom = projectileY + projectileHalfSize;

    for (const wall of WORLD_MAP.filter(isWall)) {
        const scaledWall = {
            x: wall.x * SCALE_FACTOR,
            y: wall.y * SCALE_FACTOR,
            width: wall.width * SCALE_FACTOR,
            height: wall.height * SCALE_FACTOR
        };
        
        // Extend wall to boundaries if it's close to them
        const extendedWall = getExtendedWallForCollision(scaledWall);
        
        if (rectanglesOverlap(
            projLeft, projRight, projTop, projBottom,
            extendedWall.x, extendedWall.x + extendedWall.width,
            extendedWall.y, extendedWall.y + extendedWall.height
        )) {
            return true;
        }
    }
    
    return false;
}

/**
 * Check if there's a clear line of sight between two points (no walls blocking)
 * Uses raycasting with sample points along the line
 */
export function hasLineOfSight(x1: number, y1: number, x2: number, y2: number, sampleCount: number = 20): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // If points are very close, assume clear line of sight
    if (distance < 10) {
        return true;
    }
    
    // Sample points along the line
    for (let i = 0; i <= sampleCount; i++) {
        const t = i / sampleCount;
        const sampleX = x1 + dx * t;
        const sampleY = y1 + dy * t;
        
        // Check if this sample point is inside any wall
        for (const element of WORLD_MAP) {
            if (element.type === 'wall' && element.width > 0 && element.height > 0) {
                const wallX = element.x * SCALE_FACTOR;
                const wallY = element.y * SCALE_FACTOR;
                const wallWidth = element.width * SCALE_FACTOR;
                const wallHeight = element.height * SCALE_FACTOR;
                
                // Extend wall to boundaries if it's close to them
                const extendedWall = getExtendedWallForCollision({
                    x: wallX,
                    y: wallY,
                    width: wallWidth,
                    height: wallHeight
                });
                
                // Check if sample point is inside the wall
                if (
                    sampleX >= extendedWall.x &&
                    sampleX <= extendedWall.x + extendedWall.width &&
                    sampleY >= extendedWall.y &&
                    sampleY <= extendedWall.y + extendedWall.height
                ) {
                    return false; // Wall blocking line of sight
                }
            }
        }
    }
    
    return true; // Clear line of sight
}

/**
 * Check and resolve enemy-enemy collisions and melee combat
 */
export function checkEnemyEnemyCollisions(enemies: Enemy[], io?: any): void {
    const MOB_COLLISION_BUFFER = 5; // Buffer between mobs
    const MELEE_ATTACK_COOLDOWN = 1000; // 1 second cooldown between melee attacks
    const currentTime = Date.now();

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const mobStats = getMobStats(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
        const halfSize = enemySize / 2;

        // Only check enemies that come after this one to avoid double-processing
        for (let j = i + 1; j < enemies.length; j++) {
            const otherEnemy = enemies[j];
            
            // Skip collision resolution if both mobs are passive and not chasing
            // BUT allow pets (enemies with ownerId) to collide with each other
            const thisMobIsPassive = !enemy.isHostile && !enemy.isChasing;
            const otherMobIsPassive = !otherEnemy.isHostile && !otherEnemy.isChasing;
            const thisMobIsPet = !!enemy.ownerId;
            const otherMobIsPet = !!otherEnemy.ownerId;
            
            // Allow pet-to-pet collisions, but skip if both are passive wild mobs
            if (thisMobIsPassive && otherMobIsPassive && !thisMobIsPet && !otherMobIsPet) {
                continue; // Both are passive wild mobs, don't push each other
            }
            
            // Get other enemy's size
            const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);
            const otherEnemySize = otherMobStats ? otherMobStats.size * 40 : ENEMY_SIZE;
            const otherHalfSize = otherEnemySize / 2;

            // Calculate distance between mobs
            const dx = otherEnemy.x - enemy.x;
            const dy = otherEnemy.y - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = halfSize + otherHalfSize + MOB_COLLISION_BUFFER;

            // Check if mobs are colliding
            if (distance < minDistance && distance > 0) {
                // Calculate push direction (away from each other)
                const pushX = (dx / distance) * (minDistance - distance) / 2;
                const pushY = (dy / distance) * (minDistance - distance) / 2;

                // Push both mobs away from each other
                enemy.x -= pushX;
                enemy.y -= pushY;
                otherEnemy.x += pushX;
                otherEnemy.y += pushY;
                
                // Handle melee combat between pets and wild mobs
                // Pet attacks wild mob OR wild mob attacks pet - damage every tick (no cooldown)
                if ((thisMobIsPet && !otherMobIsPet) || (!thisMobIsPet && otherMobIsPet)) {
                    // Enemy attacks otherEnemy
                    if (thisMobIsPet && !otherMobIsPet && enemy.ownerId) {
                        // Enemy (pet) attacks otherEnemy (wild mob)
                        if (!(otherEnemy as any).isDead && otherEnemy.health > 0) {
                            // Track damage with pet owner's ID
                            const { trackDamage } = require('../server');
                            trackDamage(otherEnemy, enemy.ownerId, enemy.damage);
                            
                            otherEnemy.health = Math.max(0, otherEnemy.health - enemy.damage);
                            
                            if (io) {
                                io.emit('enemyDamaged', { enemyId: otherEnemy.id, health: otherEnemy.health });
                            }
                            
                            if (otherEnemy.health <= 0) {
                                (otherEnemy as any).isDead = true;
                                if (io) {
                                    io.emit('enemyDestroyed', otherEnemy.id);
                                }
                            }
                        }
                    } else if (!thisMobIsPet && otherMobIsPet) {
                        // Enemy (wild mob) attacks otherEnemy (pet)
                        if (!(otherEnemy as any).isDead && otherEnemy.health > 0) {
                            otherEnemy.health = Math.max(0, otherEnemy.health - enemy.damage);
                            
                            if (io) {
                                io.emit('enemyDamaged', { enemyId: otherEnemy.id, health: otherEnemy.health });
                            }
                            
                            if (otherEnemy.health <= 0) {
                                (otherEnemy as any).isDead = true;
                                if (io) {
                                    io.emit('enemyDestroyed', otherEnemy.id);
                                }
                            }
                        }
                    }
                    
                    // otherEnemy attacks enemy
                    if (otherMobIsPet && !thisMobIsPet && otherEnemy.ownerId) {
                        // otherEnemy (pet) attacks enemy (wild mob)
                        if (!(enemy as any).isDead && enemy.health > 0) {
                            // Track damage with pet owner's ID
                            const { trackDamage } = require('../server');
                            trackDamage(enemy, otherEnemy.ownerId, otherEnemy.damage);
                            
                            enemy.health = Math.max(0, enemy.health - otherEnemy.damage);
                            
                            if (io) {
                                io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                            }
                            
                            if (enemy.health <= 0) {
                                (enemy as any).isDead = true;
                                if (io) {
                                    io.emit('enemyDestroyed', enemy.id);
                                }
                            }
                        }
                    } else if (!otherMobIsPet && thisMobIsPet) {
                        // otherEnemy (wild mob) attacks enemy (pet)
                        if (!(enemy as any).isDead && enemy.health > 0) {
                            enemy.health = Math.max(0, enemy.health - otherEnemy.damage);
                            
                            if (io) {
                                io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                            }
                            
                            if (enemy.health <= 0) {
                                (enemy as any).isDead = true;
                                if (io) {
                                    io.emit('enemyDestroyed', enemy.id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Check player-enemy collision and return collision info
 */
export function checkPlayerEnemyCollision(
    playerX: number,
    playerY: number,
    playerSize: number,
    enemy: Enemy
): { collided: boolean; distance: number; dx: number; dy: number } {
    const mobStats = getMobStats(enemy.type, enemy.tier);
    const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
    const enemyRadius = enemySize / 2;
    const playerRadius = playerSize / 2;

    // Use circular hitbox collision
    const dx = enemy.x - playerX;
    const dy = enemy.y - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = enemyRadius + playerRadius;

    return {
        collided: distance < minDistance && distance > 0,
        distance,
        dx,
        dy
    };
}

