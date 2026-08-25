import { Enemy } from '../server_utils';
import { mobX, mobY } from './mobFields';
import { WorldItem } from '../item';
import {
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    PLAYER_SIZE,
    ENEMY_SIZE,
    resolveEntityWallCollisions,
    checkTileCollision,
} from '../constants';
import { getMobStats, getEnemySizeScale } from '../mobs';

// Boundary threshold for wall extension (same as out-of-bounds zone)
const BOUNDARY_THRESHOLD = 100;

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
 * Check and resolve player-wall collisions using tile grid
 */
export function checkPlayerWallCollisions(
    playerX: number,
    playerY: number,
    playerSize: number = PLAYER_SIZE
): { x: number; y: number; collided: boolean } {
    // Delegate to the shared resolver in constants.ts so the client's movement
    // prediction resolves walls/water identically and doesn't fight this result.
    return resolveEntityWallCollisions(playerX, playerY, playerSize / 2);
}

export function checkItemWallCollisions(item: WorldItem): void {
    const ITEM_SIZE = 15; // Item radius (30x30 hitbox)
    const resolved = resolveEntityWallCollisions(item.x, item.y, ITEM_SIZE);
    item.x = resolved.x;
    item.y = resolved.y;
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

// hasLineOfSight now lives in ./lineOfSight so callers that only need a
// raycast do not have to import this module (which boots the server).
export { hasLineOfSight } from './lineOfSight';

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
    const enemySize = (mobStats ? mobStats.size * 40 : ENEMY_SIZE)
        * getEnemySizeScale(!!enemy.ownerId, enemy.tier, enemy.type, enemy.id);
    const enemyRadius = enemySize / 2;
    const playerRadius = playerSize / 2;

    // Use circular hitbox collision
    const dx = mobX(enemy.entity) - playerX;
    const dy = mobY(enemy.entity) - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = enemyRadius + playerRadius;

    return {
        collided: distance < minDistance && distance > 0,
        distance,
        dx,
        dy
    };
}

