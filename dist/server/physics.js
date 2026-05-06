"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExtendedWallForCollision = getExtendedWallForCollision;
exports.checkPlayerWallCollisions = checkPlayerWallCollisions;
exports.checkEnemyWallCollisions = checkEnemyWallCollisions;
exports.checkItemWallCollisions = checkItemWallCollisions;
exports.checkProjectileWallCollision = checkProjectileWallCollision;
exports.hasLineOfSight = hasLineOfSight;
exports.checkEnemyEnemyCollisions = checkEnemyEnemyCollisions;
exports.checkPlayerEnemyCollision = checkPlayerEnemyCollision;
const server_utils_1 = require("../server_utils");
const constants_1 = require("../constants");
const map_data_1 = require("../map_data");
const mobs_1 = require("../mobs");
const utils_1 = require("./utils");
// Boundary threshold for wall extension (same as out-of-bounds zone)
const BOUNDARY_THRESHOLD = 100;
const COLLISION_BUFFER = 5; // Buffer between entities and walls
/**
 * Extend walls near world boundaries for collision detection
 * Returns an extended wall that reaches the nearest boundary if the wall is close to it
 */
function getExtendedWallForCollision(wall) {
    const extendedWall = { ...wall };
    // Check left boundary (x = 0)
    if (wall.x < BOUNDARY_THRESHOLD) {
        const extension = wall.x;
        extendedWall.x = 0;
        extendedWall.width += extension;
    }
    // Check right boundary (x = ACTUAL_WORLD_WIDTH)
    if (wall.x + wall.width > constants_1.ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD) {
        const extension = constants_1.ACTUAL_WORLD_WIDTH - (wall.x + wall.width);
        if (extension > 0) {
            extendedWall.width += extension;
        }
        else {
            // Wall already extends beyond, clamp to boundary
            extendedWall.width = constants_1.ACTUAL_WORLD_WIDTH - wall.x;
        }
    }
    // Check top boundary (y = 0)
    if (wall.y < BOUNDARY_THRESHOLD) {
        const extension = wall.y;
        extendedWall.y = 0;
        extendedWall.height += extension;
    }
    // Check bottom boundary (y = ACTUAL_WORLD_HEIGHT)
    if (wall.y + wall.height > constants_1.ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD) {
        const extension = constants_1.ACTUAL_WORLD_HEIGHT - (wall.y + wall.height);
        if (extension > 0) {
            extendedWall.height += extension;
        }
        else {
            // Wall already extends beyond, clamp to boundary
            extendedWall.height = constants_1.ACTUAL_WORLD_HEIGHT - wall.y;
        }
    }
    return extendedWall;
}
/**
 * Check if two rectangles overlap
 */
function rectanglesOverlap(left1, right1, top1, bottom1, left2, right2, top2, bottom2) {
    return right1 > left2 && left1 < right2 && bottom1 > top2 && top1 < bottom2;
}
/**
 * Resolve rectangle-rectangle collision by pushing entity away from wall
 */
function resolveRectangleCollision(entityX, entityY, entityHalfSize, wallLeft, wallRight, wallTop, wallBottom) {
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
    }
    else if (minOverlap === overlapRight) {
        newX = wallRight + entityHalfSize + COLLISION_BUFFER;
    }
    else if (minOverlap === overlapTop) {
        newY = wallTop - entityHalfSize - COLLISION_BUFFER;
    }
    else if (minOverlap === overlapBottom) {
        newY = wallBottom + entityHalfSize + COLLISION_BUFFER;
    }
    return { x: newX, y: newY };
}
/**
 * Resolve player-wall collision using penetration depth method
 */
function resolvePlayerWallCollision(playerX, playerY, playerSize, wallX, wallY, wallWidth, wallHeight) {
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
            if (overlapX > 0)
                newX += penX;
            else
                newX -= penX;
        }
        else {
            if (overlapY > 0)
                newY += penY;
            else
                newY -= penY;
        }
        return { x: newX, y: newY };
    }
    return { x: playerX, y: playerY };
}
/**
 * Check if a position collides with a wall or water tile, accounting for jagged edges
 */
function checkTileCollision(worldX, worldY, halfSize) {
    // Expand search range by JAGGED_MAX_OFFSET to catch jagged protrusions
    const minTileX = (0, constants_1.worldToTileX)(worldX - halfSize - constants_1.JAGGED_MAX_OFFSET);
    const maxTileX = (0, constants_1.worldToTileX)(worldX + halfSize + constants_1.JAGGED_MAX_OFFSET);
    const minTileY = (0, constants_1.worldToTileY)(worldY - halfSize - constants_1.JAGGED_MAX_OFFSET);
    const maxTileY = (0, constants_1.worldToTileY)(worldY + halfSize + constants_1.JAGGED_MAX_OFFSET);
    const entityLeft = worldX - halfSize;
    const entityRight = worldX + halfSize;
    const entityTop = worldY - halfSize;
    const entityBottom = worldY + halfSize;
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const state = (0, constants_1.getTileState)(map_data_1.WALL_GRID, (0, constants_1.tileToWorldX)(tileX), (0, constants_1.tileToWorldY)(tileY));
            // Skip non-blocking tiles (air or any custom tile that's neither solid nor water).
            if (!(0, constants_1.isTileIdBlocking)(state))
                continue;
            const tileWorldX = (0, constants_1.tileToWorldX)(tileX);
            const tileWorldY = (0, constants_1.tileToWorldY)(tileY);
            // Start with base tile boundaries
            let effectiveLeft = tileWorldX;
            let effectiveRight = tileWorldX + constants_1.WALL_TILE_SIZE;
            let effectiveTop = tileWorldY;
            let effectiveBottom = tileWorldY + constants_1.WALL_TILE_SIZE;
            // Only "wall" and "water" styles draw jagged/smoothed edges visually,
            // so only those should expand their collision past the cell boundary.
            // A "flat" (or default) style is drawn as a clean rectangle and must
            // collide as one — otherwise the random jagged offsets push the
            // collision past the visible edge and entities clip into thin air.
            const cfg = (0, constants_1.getTileTypeConfig)(state);
            const usesJaggedEdges = cfg.style === 'wall' || cfg.style === 'water';
            if (usesJaggedEdges) {
                const jaggedEdges = (0, constants_1.getTileJaggedEdges)(map_data_1.WALL_GRID, tileX, tileY);
                if (jaggedEdges.top) {
                    const minT = Math.max(0, entityLeft - tileWorldX);
                    const maxT = Math.min(constants_1.WALL_TILE_SIZE, entityRight - tileWorldX);
                    if (maxT > minT) {
                        effectiveTop = tileWorldY - (0, constants_1.getMaxJaggedOffset)(jaggedEdges.top, minT, maxT);
                    }
                }
                if (jaggedEdges.bottom) {
                    const minT = Math.max(0, entityLeft - tileWorldX);
                    const maxT = Math.min(constants_1.WALL_TILE_SIZE, entityRight - tileWorldX);
                    if (maxT > minT) {
                        effectiveBottom = tileWorldY + constants_1.WALL_TILE_SIZE + (0, constants_1.getMaxJaggedOffset)(jaggedEdges.bottom, minT, maxT);
                    }
                }
                if (jaggedEdges.left) {
                    const minT = Math.max(0, entityTop - tileWorldY);
                    const maxT = Math.min(constants_1.WALL_TILE_SIZE, entityBottom - tileWorldY);
                    if (maxT > minT) {
                        effectiveLeft = tileWorldX - (0, constants_1.getMaxJaggedOffset)(jaggedEdges.left, minT, maxT);
                    }
                }
                if (jaggedEdges.right) {
                    const minT = Math.max(0, entityTop - tileWorldY);
                    const maxT = Math.min(constants_1.WALL_TILE_SIZE, entityBottom - tileWorldY);
                    if (maxT > minT) {
                        effectiveRight = tileWorldX + constants_1.WALL_TILE_SIZE + (0, constants_1.getMaxJaggedOffset)(jaggedEdges.right, minT, maxT);
                    }
                }
            }
            // Check overlap with effective boundaries
            if (entityRight > effectiveLeft &&
                entityLeft < effectiveRight &&
                entityBottom > effectiveTop &&
                entityTop < effectiveBottom) {
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
function resolveTileCollision(entityX, entityY, entityHalfSize, collision) {
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
    }
    else if (minOverlap === overlapRight) {
        newX = collision.effectiveRight + entityHalfSize + COLLISION_BUFFER;
    }
    else if (minOverlap === overlapTop) {
        newY = collision.effectiveTop - entityHalfSize - COLLISION_BUFFER;
    }
    else if (minOverlap === overlapBottom) {
        newY = collision.effectiveBottom + entityHalfSize + COLLISION_BUFFER;
    }
    return { x: newX, y: newY };
}
/**
 * Check and resolve player-wall collisions using tile grid
 */
function checkPlayerWallCollisions(playerX, playerY, playerSize = constants_1.PLAYER_SIZE) {
    let newX = playerX;
    let newY = playerY;
    let collided = false;
    const halfSize = playerSize / 2;
    // Iteratively resolve collisions (max 4 iterations to handle corners)
    for (let i = 0; i < 4; i++) {
        const collision = checkTileCollision(newX, newY, halfSize);
        if (collision && collision.collided) {
            const resolved = resolveTileCollision(newX, newY, halfSize, collision);
            newX = resolved.x;
            newY = resolved.y;
            collided = true;
        }
        else {
            break; // No more collisions
        }
    }
    return { x: newX, y: newY, collided };
}
/**
 * Check and resolve enemy-wall collisions using tile grid
 */
function checkEnemyWallCollisions(enemy) {
    const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
    const enemySize = mobStats ? mobStats.size * 40 : constants_1.ENEMY_SIZE;
    const halfSize = enemySize / 2;
    // Iteratively resolve collisions (max 4 iterations to handle corners)
    for (let i = 0; i < 4; i++) {
        const collision = checkTileCollision(enemy.x, enemy.y, halfSize);
        if (collision && collision.collided) {
            const resolved = resolveTileCollision(enemy.x, enemy.y, halfSize, collision);
            enemy.x = resolved.x;
            enemy.y = resolved.y;
        }
        else {
            break; // No more collisions
        }
    }
}
/**
 * Check and resolve item-wall collisions using tile grid
 */
function checkItemWallCollisions(item) {
    const ITEM_SIZE = 15; // Item radius (30x30 hitbox)
    const halfSize = ITEM_SIZE;
    // Iteratively resolve collisions (max 4 iterations to handle corners)
    for (let i = 0; i < 4; i++) {
        const collision = checkTileCollision(item.x, item.y, halfSize);
        if (collision && collision.collided) {
            const resolved = resolveTileCollision(item.x, item.y, halfSize, collision);
            item.x = resolved.x;
            item.y = resolved.y;
        }
        else {
            break; // No more collisions
        }
    }
}
/**
 * Check if a projectile hits a wall or water tile
 */
function checkProjectileWallCollision(projectileX, projectileY, projectileHalfSize) {
    // Check the tile the projectile is in
    const collision = checkTileCollision(projectileX, projectileY, projectileHalfSize);
    return collision !== null && collision.collided;
}
/**
 * Check if there's a clear line of sight between two points (no walls or water blocking)
 * Uses raycasting with sample points along the line
 */
function hasLineOfSight(x1, y1, x2, y2, sampleCount = 20) {
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
        // Any blocking tile (solid/water — built-in or custom) blocks line of sight
        const state = (0, constants_1.getTileState)(map_data_1.WALL_GRID, sampleX, sampleY);
        if ((0, constants_1.isTileIdBlocking)(state)) {
            return false;
        }
    }
    return true; // Clear line of sight
}
/**
 * Check and resolve enemy-enemy collisions and melee combat
 */
function checkEnemyEnemyCollisions(enemies, io) {
    const MOB_COLLISION_BUFFER = 5; // Buffer between mobs
    const MELEE_ATTACK_COOLDOWN = 1000; // 1 second cooldown between melee attacks
    const currentTime = Date.now();
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : constants_1.ENEMY_SIZE;
        const halfSize = enemySize / 2;
        // Only check enemies that come after this one to avoid double-processing
        for (let j = i + 1; j < enemies.length; j++) {
            const otherEnemy = enemies[j];
            // Skip collision resolution between segments of the same centipede chain:
            // the chain-follow pass keeps them in formation, so physical push-apart
            // creates tangling/spin artifacts. The head's AI steers around its own
            // segments instead (see centipede avoidance in moveEnemies).
            const thisHeadId = enemy.headId ?? ((0, server_utils_1.isCentipedeHeadType)(enemy.type) ? enemy.id : undefined);
            const otherHeadId = otherEnemy.headId ?? ((0, server_utils_1.isCentipedeHeadType)(otherEnemy.type) ? otherEnemy.id : undefined);
            if (thisHeadId && otherHeadId && thisHeadId === otherHeadId) {
                continue;
            }
            // Get other enemy's size
            const otherMobStats = (0, mobs_1.getMobStats)(otherEnemy.type, otherEnemy.tier);
            // Mobs flagged with no_mob_collision (e.g. ant holes) don't push
            // or get pushed by other mobs.
            if (mobStats?.no_mob_collision || otherMobStats?.no_mob_collision) {
                continue;
            }
            // Skip collision resolution if both mobs are passive and not chasing
            // BUT allow pets (enemies with ownerId) to collide with each other
            const thisMobIsPassive = (enemy.aiType === 'passive' || enemy.aiType === 'sandstorm') && !enemy.isChasing;
            const otherMobIsPassive = (otherEnemy.aiType === 'passive' || otherEnemy.aiType === 'sandstorm') && !otherEnemy.isChasing;
            const thisMobIsPet = !!enemy.ownerId;
            const otherMobIsPet = !!otherEnemy.ownerId;
            // Allow pet-to-pet collisions, but skip if both are passive wild mobs
            if (thisMobIsPassive && otherMobIsPassive && !thisMobIsPet && !otherMobIsPet) {
                continue; // Both are passive wild mobs, don't push each other
            }
            const otherEnemySize = otherMobStats ? otherMobStats.size * 40 : constants_1.ENEMY_SIZE;
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
                        if (!otherEnemy.isDead && otherEnemy.health > 0) {
                            // Track damage with pet owner's ID
                            const { trackDamage } = require('../server');
                            trackDamage(otherEnemy, enemy.ownerId, enemy.damage);
                            otherEnemy.health = Math.max(0, otherEnemy.health - enemy.damage);
                            if (io)
                                (0, utils_1.markEnemyDamaged)(otherEnemy);
                            if (otherEnemy.health <= 0) {
                                otherEnemy.isDead = true;
                                if (io) {
                                    io.emit('enemyDestroyed', otherEnemy.id);
                                }
                            }
                        }
                    }
                    else if (!thisMobIsPet && otherMobIsPet) {
                        // Enemy (wild mob) attacks otherEnemy (pet)
                        if (!otherEnemy.isDead && otherEnemy.health > 0) {
                            otherEnemy.health = Math.max(0, otherEnemy.health - enemy.damage);
                            if (io)
                                (0, utils_1.markEnemyDamaged)(otherEnemy);
                            if (otherEnemy.health <= 0) {
                                otherEnemy.isDead = true;
                                if (io) {
                                    io.emit('enemyDestroyed', otherEnemy.id);
                                }
                            }
                        }
                    }
                    // otherEnemy attacks enemy
                    if (otherMobIsPet && !thisMobIsPet && otherEnemy.ownerId) {
                        // otherEnemy (pet) attacks enemy (wild mob)
                        if (!enemy.isDead && enemy.health > 0) {
                            // Track damage with pet owner's ID
                            const { trackDamage } = require('../server');
                            trackDamage(enemy, otherEnemy.ownerId, otherEnemy.damage);
                            enemy.health = Math.max(0, enemy.health - otherEnemy.damage);
                            if (io)
                                (0, utils_1.markEnemyDamaged)(enemy);
                            if (enemy.health <= 0) {
                                enemy.isDead = true;
                                if (io) {
                                    io.emit('enemyDestroyed', enemy.id);
                                }
                            }
                        }
                    }
                    else if (!otherMobIsPet && thisMobIsPet) {
                        // otherEnemy (wild mob) attacks enemy (pet)
                        if (!enemy.isDead && enemy.health > 0) {
                            enemy.health = Math.max(0, enemy.health - otherEnemy.damage);
                            if (io)
                                (0, utils_1.markEnemyDamaged)(enemy);
                            if (enemy.health <= 0) {
                                enemy.isDead = true;
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
function checkPlayerEnemyCollision(playerX, playerY, playerSize, enemy) {
    const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
    const enemySize = mobStats ? mobStats.size * 40 : constants_1.ENEMY_SIZE;
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
