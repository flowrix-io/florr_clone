import { Enemy } from '../server_utils';
import { ServerPlayer } from '../player';
import { WorldItem } from '../item';
import {
    isWall,
    SCALE_FACTOR,
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    PLAYER_SIZE,
    ENEMY_SIZE,
    WALL_TILE_SIZE,
    worldToTileX,
    worldToTileY,
    tileToWorldX,
    tileToWorldY,
    getTileState,
    WallTileState,
    getTileJaggedEdges,
    getMaxJaggedOffset,
    JAGGED_MAX_OFFSET
} from '../constants';
import { WORLD_MAP, WALL_GRID } from '../map_data';
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
 * Collision result including effective (jagged) boundaries
 */
interface TileCollisionResult {
    collided: boolean;
    tileX: number;
    tileY: number;
    state: WallTileState;
    effectiveLeft: number;
    effectiveRight: number;
    effectiveTop: number;
    effectiveBottom: number;
}

/**
 * Check if a position collides with a wall or water tile, accounting for jagged edges
 */
function checkTileCollision(worldX: number, worldY: number, halfSize: number): TileCollisionResult | null {
    // Expand search range by JAGGED_MAX_OFFSET to catch jagged protrusions
    const minTileX = worldToTileX(worldX - halfSize - JAGGED_MAX_OFFSET);
    const maxTileX = worldToTileX(worldX + halfSize + JAGGED_MAX_OFFSET);
    const minTileY = worldToTileY(worldY - halfSize - JAGGED_MAX_OFFSET);
    const maxTileY = worldToTileY(worldY + halfSize + JAGGED_MAX_OFFSET);

    const entityLeft = worldX - halfSize;
    const entityRight = worldX + halfSize;
    const entityTop = worldY - halfSize;
    const entityBottom = worldY + halfSize;

    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const state = getTileState(WALL_GRID, tileToWorldX(tileX), tileToWorldY(tileY));
            if (state !== 1 && state !== 2) continue;

            const tileWorldX = tileToWorldX(tileX);
            const tileWorldY = tileToWorldY(tileY);

            // Start with base tile boundaries
            let effectiveLeft = tileWorldX;
            let effectiveRight = tileWorldX + WALL_TILE_SIZE;
            let effectiveTop = tileWorldY;
            let effectiveBottom = tileWorldY + WALL_TILE_SIZE;

            // For wall tiles (state=1) and water tiles (state=2), extend boundaries with jagged/curved edges
            if (state === 1 || state === 2) {
                const jaggedEdges = getTileJaggedEdges(WALL_GRID, tileX, tileY);

                if (jaggedEdges.top) {
                    const minT = Math.max(0, entityLeft - tileWorldX);
                    const maxT = Math.min(WALL_TILE_SIZE, entityRight - tileWorldX);
                    if (maxT > minT) {
                        effectiveTop = tileWorldY - getMaxJaggedOffset(jaggedEdges.top, minT, maxT);
                    }
                }
                if (jaggedEdges.bottom) {
                    const minT = Math.max(0, entityLeft - tileWorldX);
                    const maxT = Math.min(WALL_TILE_SIZE, entityRight - tileWorldX);
                    if (maxT > minT) {
                        effectiveBottom = tileWorldY + WALL_TILE_SIZE + getMaxJaggedOffset(jaggedEdges.bottom, minT, maxT);
                    }
                }
                if (jaggedEdges.left) {
                    const minT = Math.max(0, entityTop - tileWorldY);
                    const maxT = Math.min(WALL_TILE_SIZE, entityBottom - tileWorldY);
                    if (maxT > minT) {
                        effectiveLeft = tileWorldX - getMaxJaggedOffset(jaggedEdges.left, minT, maxT);
                    }
                }
                if (jaggedEdges.right) {
                    const minT = Math.max(0, entityTop - tileWorldY);
                    const maxT = Math.min(WALL_TILE_SIZE, entityBottom - tileWorldY);
                    if (maxT > minT) {
                        effectiveRight = tileWorldX + WALL_TILE_SIZE + getMaxJaggedOffset(jaggedEdges.right, minT, maxT);
                    }
                }
            }

            // Check overlap with effective boundaries
            if (
                entityRight > effectiveLeft &&
                entityLeft < effectiveRight &&
                entityBottom > effectiveTop &&
                entityTop < effectiveBottom
            ) {
                return {
                    collided: true, tileX, tileY, state,
                    effectiveLeft, effectiveRight, effectiveTop, effectiveBottom
                };
            }
        }
    }

    return null;
}

/**
 * Resolve collision with a tile by pushing entity away from effective (jagged) boundaries
 */
function resolveTileCollision(
    entityX: number,
    entityY: number,
    entityHalfSize: number,
    collision: TileCollisionResult
): { x: number; y: number } {
    const entityLeft = entityX - entityHalfSize;
    const entityRight = entityX + entityHalfSize;
    const entityTop = entityY - entityHalfSize;
    const entityBottom = entityY + entityHalfSize;

    // Calculate overlap amounts against effective boundaries
    const overlapLeft = entityRight - collision.effectiveLeft;
    const overlapRight = collision.effectiveRight - entityLeft;
    const overlapTop = entityBottom - collision.effectiveTop;
    const overlapBottom = collision.effectiveBottom - entityTop;

    // Find the minimum overlap to determine push direction
    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

    let newX = entityX;
    let newY = entityY;

    // Push entity away from tile in the direction of minimum overlap
    if (minOverlap === overlapLeft) {
        newX = collision.effectiveLeft - entityHalfSize - COLLISION_BUFFER;
    } else if (minOverlap === overlapRight) {
        newX = collision.effectiveRight + entityHalfSize + COLLISION_BUFFER;
    } else if (minOverlap === overlapTop) {
        newY = collision.effectiveTop - entityHalfSize - COLLISION_BUFFER;
    } else if (minOverlap === overlapBottom) {
        newY = collision.effectiveBottom + entityHalfSize + COLLISION_BUFFER;
    }

    return { x: newX, y: newY };
}

/**
 * Check and resolve player-wall collisions using tile grid
 */
export function checkPlayerWallCollisions(
    playerX: number,
    playerY: number,
    playerSize: number = PLAYER_SIZE
): { x: number; y: number; collided: boolean } {
    let newX = playerX;
    let newY = playerY;
    let collided = false;
    const halfSize = playerSize / 2;

    // Iteratively resolve collisions (max 4 iterations to handle corners)
    for (let i = 0; i < 4; i++) {
        const collision = checkTileCollision(newX, newY, halfSize);
        if (collision && collision.collided) {
            const resolved = resolveTileCollision(
                newX, newY, halfSize, collision
            );
            newX = resolved.x;
            newY = resolved.y;
            collided = true;
        } else {
            break; // No more collisions
        }
    }

    return { x: newX, y: newY, collided };
}

/**
 * Check and resolve enemy-wall collisions using tile grid
 */
export function checkEnemyWallCollisions(enemy: Enemy): void {
    const mobStats = getMobStats(enemy.type, enemy.tier);
    const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
    const halfSize = enemySize / 2;

    // Iteratively resolve collisions (max 4 iterations to handle corners)
    for (let i = 0; i < 4; i++) {
        const collision = checkTileCollision(enemy.x, enemy.y, halfSize);
        if (collision && collision.collided) {
            const resolved = resolveTileCollision(
                enemy.x, enemy.y, halfSize, collision
            );
            enemy.x = resolved.x;
            enemy.y = resolved.y;
        } else {
            break; // No more collisions
        }
    }
}

/**
 * Check and resolve item-wall collisions using tile grid
 */
export function checkItemWallCollisions(item: WorldItem): void {
    const ITEM_SIZE = 15; // Item radius (30x30 hitbox)
    const halfSize = ITEM_SIZE;

    // Iteratively resolve collisions (max 4 iterations to handle corners)
    for (let i = 0; i < 4; i++) {
        const collision = checkTileCollision(item.x, item.y, halfSize);
        if (collision && collision.collided) {
            const resolved = resolveTileCollision(
                item.x, item.y, halfSize, collision
            );
            item.x = resolved.x;
            item.y = resolved.y;
        } else {
            break; // No more collisions
        }
    }
}

/**
 * Check if a projectile hits a wall or water tile
 */
export function checkProjectileWallCollision(
    projectileX: number,
    projectileY: number,
    projectileHalfSize: number
): boolean {
    // Check the tile the projectile is in
    const collision = checkTileCollision(projectileX, projectileY, projectileHalfSize);
    return collision !== null && collision.collided;
}

/**
 * Check if there's a clear line of sight between two points (no walls or water blocking)
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
        
        // Check if this sample point is in a wall or water tile
        const state = getTileState(WALL_GRID, sampleX, sampleY);
        if (state === 1 || state === 2) { // Wall or water blocks line of sight
            return false;
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
                                // Mark enemy for batched damage update at end of frame
                                if (!(otherEnemy as any).pendingDamageUpdate) {
                                    (otherEnemy as any).pendingDamageUpdate = true;
                                }
                                (otherEnemy as any).lastDamageHealth = otherEnemy.health;
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
                                // Mark enemy for batched damage update at end of frame
                                if (!(otherEnemy as any).pendingDamageUpdate) {
                                    (otherEnemy as any).pendingDamageUpdate = true;
                                }
                                (otherEnemy as any).lastDamageHealth = otherEnemy.health;
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
                                // Mark enemy for batched damage update at end of frame
                                if (!(enemy as any).pendingDamageUpdate) {
                                    (enemy as any).pendingDamageUpdate = true;
                                }
                                (enemy as any).lastDamageHealth = enemy.health;
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
                                // Mark enemy for batched damage update at end of frame
                                if (!(enemy as any).pendingDamageUpdate) {
                                    (enemy as any).pendingDamageUpdate = true;
                                }
                                (enemy as any).lastDamageHealth = enemy.health;
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

