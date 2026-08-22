import { Enemy } from '../server_utils';
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

/**
 * Check and resolve enemy-wall collisions using tile grid
 */
export function checkEnemyWallCollisions(enemy: Enemy): void {
    const mobStats = getMobStats(enemy.type, enemy.tier);
    const enemySize = (mobStats ? mobStats.size * 40 : ENEMY_SIZE)
        * getEnemySizeScale(!!enemy.ownerId, enemy.tier, enemy.type);
    const resolved = resolveEntityWallCollisions(enemy.x, enemy.y, enemySize / 2);
    // gardn Motion.cc: zero the velocity component along whatever axis the wall
    // pushed, so the mob actually stops at the wall instead of re-entering every
    // tick. Without this the passive-move integrator keeps feeding velocity into
    // the wall and the mob grinds sideways along it — visibly travelling one way
    // while enemy.angle (its intended heading, which we deliberately keep) points
    // another. Facing stays the direction the mob is TRYING to go; motion stops.
    if (resolved.x !== enemy.x) {
        enemy.velX = 0;
        enemy.knockbackX = 0;
    }
    if (resolved.y !== enemy.y) {
        enemy.velY = 0;
        enemy.knockbackY = 0;
    }
    enemy.x = resolved.x;
    enemy.y = resolved.y;
}

// Bound on wall-checked substeps per tick of knockback travel. Extreme
// impulses (apex jelly's knockback stat is 100000) would otherwise need
// thousands of steps in one tick; travel beyond the cap stays banked in
// knockbackX/Y and plays out over the following ticks (decaying as usual),
// so a would-be teleport becomes fast multi-tick motion walls can stop.
const KNOCKBACK_MAX_SUBSTEPS = 16;

/**
 * Apply this tick's knockback displacement (already decayed by the caller),
 * substepped so a large impulse can't tunnel through walls — or off the map
 * entirely, since past the world edge every tile reads as air — in a single
 * jump. Step size is bounded by half the hitbox (same invariant as
 * stepPlayerMovement) so consecutive wall checks sample overlapping
 * positions along the path. Hitting a wall zeroes velocity and knockback on
 * the blocked axis, matching checkEnemyWallCollisions; knockback left on the
 * other axis slides along the wall over subsequent ticks.
 */
export function applyEnemyKnockback(enemy: Enemy): void {
    const kx = enemy.knockbackX ?? 0;
    const ky = enemy.knockbackY ?? 0;
    const distance = Math.sqrt(kx * kx + ky * ky);
    if (distance === 0) return;

    const mobStats = getMobStats(enemy.type, enemy.tier);
    const halfSize = Math.max(1, (mobStats ? mobStats.size * 40 : ENEMY_SIZE)
        * getEnemySizeScale(!!enemy.ownerId, enemy.tier, enemy.type) / 2);

    // A displacement within one substep can't skip a tile: take it in one
    // jump (the pre-substep behavior) and let the end-of-tick wall pass
    // resolve any contact.
    if (distance <= halfSize) {
        enemy.x += kx;
        enemy.y += ky;
        return;
    }

    const dirX = kx / distance;
    const dirY = ky / distance;
    let remaining = Math.min(distance, halfSize * KNOCKBACK_MAX_SUBSTEPS);
    while (remaining > 0) {
        const stepLen = Math.min(halfSize, remaining);
        const trialX = enemy.x + dirX * stepLen;
        const trialY = enemy.y + dirY * stepLen;
        const resolved = resolveEntityWallCollisions(trialX, trialY, halfSize);
        enemy.x = resolved.x;
        enemy.y = resolved.y;
        const blockedX = resolved.x !== trialX;
        const blockedY = resolved.y !== trialY;
        if (blockedX) { enemy.velX = 0; enemy.knockbackX = 0; }
        if (blockedY) { enemy.velY = 0; enemy.knockbackY = 0; }
        if (blockedX || blockedY) return;
        remaining -= stepLen;
    }
}

/**
 * Check and resolve item-wall collisions using tile grid
 */
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
        * getEnemySizeScale(!!enemy.ownerId, enemy.tier, enemy.type);
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

