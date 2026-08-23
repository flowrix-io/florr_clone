"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasLineOfSight = void 0;
exports.getExtendedWallForCollision = getExtendedWallForCollision;
exports.checkPlayerWallCollisions = checkPlayerWallCollisions;
exports.checkItemWallCollisions = checkItemWallCollisions;
exports.checkProjectileWallCollision = checkProjectileWallCollision;
exports.checkPlayerEnemyCollision = checkPlayerEnemyCollision;
const mobFields_1 = require("./mobFields");
const constants_1 = require("../constants");
const mobs_1 = require("../mobs");
// Boundary threshold for wall extension (same as out-of-bounds zone)
const BOUNDARY_THRESHOLD = 100;
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
 * Check and resolve player-wall collisions using tile grid
 */
function checkPlayerWallCollisions(playerX, playerY, playerSize = constants_1.PLAYER_SIZE) {
    // Delegate to the shared resolver in constants.ts so the client's movement
    // prediction resolves walls/water identically and doesn't fight this result.
    return (0, constants_1.resolveEntityWallCollisions)(playerX, playerY, playerSize / 2);
}
function checkItemWallCollisions(item) {
    const ITEM_SIZE = 15; // Item radius (30x30 hitbox)
    const resolved = (0, constants_1.resolveEntityWallCollisions)(item.x, item.y, ITEM_SIZE);
    item.x = resolved.x;
    item.y = resolved.y;
}
/**
 * Check if a projectile hits a wall or water tile
 */
function checkProjectileWallCollision(projectileX, projectileY, projectileHalfSize) {
    // Check the tile the projectile is in
    const collision = (0, constants_1.checkTileCollision)(projectileX, projectileY, projectileHalfSize);
    return collision !== null && collision.collided;
}
// hasLineOfSight now lives in ./lineOfSight so callers that only need a
// raycast do not have to import this module (which boots the server).
var lineOfSight_1 = require("./lineOfSight");
Object.defineProperty(exports, "hasLineOfSight", { enumerable: true, get: function () { return lineOfSight_1.hasLineOfSight; } });
/**
 * Check player-enemy collision and return collision info
 */
function checkPlayerEnemyCollision(playerX, playerY, playerSize, enemy) {
    const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
    const enemySize = (mobStats ? mobStats.size * 40 : constants_1.ENEMY_SIZE)
        * (0, mobs_1.getEnemySizeScale)(!!enemy.ownerId, enemy.tier, enemy.type);
    const enemyRadius = enemySize / 2;
    const playerRadius = playerSize / 2;
    // Use circular hitbox collision
    const dx = (0, mobFields_1.mobX)(enemy.entity) - playerX;
    const dy = (0, mobFields_1.mobY)(enemy.entity) - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = enemyRadius + playerRadius;
    return {
        collided: distance < minDistance && distance > 0,
        distance,
        dx,
        dy
    };
}
