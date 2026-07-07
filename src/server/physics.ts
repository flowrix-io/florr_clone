import { Enemy, isCentipedeHeadType } from '../server_utils';
import { WorldItem } from '../item';
import {
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    PLAYER_SIZE,
    ENEMY_SIZE,
    getTileState,
    isTileIdBlocking,
    resolveEntityWallCollisions,
    checkTileCollision
} from '../constants';
import { WALL_GRID } from '../map_data';
import { getMobStats } from '../mobs';
import { markEnemyDamaged } from './utils';

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
    const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
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
        
        // Any blocking tile (solid/water — built-in or custom) blocks line of sight
        const state = getTileState(WALL_GRID, sampleX, sampleY);
        if (isTileIdBlocking(state)) {
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

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const mobStats = getMobStats(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
        const halfSize = enemySize / 2;

        // Only check enemies that come after this one to avoid double-processing
        for (let j = i + 1; j < enemies.length; j++) {
            const otherEnemy = enemies[j];

            // Skip collision resolution between segments of the same centipede chain:
            // the chain-follow pass keeps them in formation, so physical push-apart
            // creates tangling/spin artifacts. The head's AI steers around its own
            // segments instead (see centipede avoidance in moveEnemies).
            const thisHeadId = enemy.headId ?? (isCentipedeHeadType(enemy.type) ? enemy.id : undefined);
            const otherHeadId = otherEnemy.headId ?? (isCentipedeHeadType(otherEnemy.type) ? otherEnemy.id : undefined);
            if (thisHeadId && otherHeadId && thisHeadId === otherHeadId) {
                continue;
            }

            // Get other enemy's size
            const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);

            // Mobs flagged with no_mob_collision (e.g. ant holes) don't push
            // or get pushed by other mobs.
            if (mobStats?.no_mob_collision || otherMobStats?.no_mob_collision) {
                continue;
            }

            const thisMobIsPet = !!enemy.ownerId;
            const otherMobIsPet = !!otherEnemy.ownerId;

            const otherEnemySize = otherMobStats ? otherMobStats.size * 40 : ENEMY_SIZE;
            const otherHalfSize = otherEnemySize / 2;

            // Calculate distance between mobs
            const dx = otherEnemy.x - enemy.x;
            const dy = otherEnemy.y - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = halfSize + otherHalfSize + MOB_COLLISION_BUFFER;

            // Check if mobs are colliding
            if (distance < minDistance && distance > 0) {
                // Cap the per-tick separation so mobs that spawn (or wander) deeply
                // overlapped ease apart over a few ticks instead of teleporting.
                // Steady walking-into-each-other overlap is far below the cap, so
                // normal contact still resolves fully within the tick.
                const MAX_PUSH_PER_TICK = 10;
                const push = Math.min((minDistance - distance) / 2, MAX_PUSH_PER_TICK);
                const pushX = (dx / distance) * push;
                const pushY = (dy / distance) * push;

                // Push both mobs away from each other
                enemy.x -= pushX;
                enemy.y -= pushY;
                otherEnemy.x += pushX;
                otherEnemy.y += pushY;

                // Separation must not shove either mob into a wall (this pass runs
                // after the per-enemy wall pass, so a violation would be visible to
                // clients for a full tick).
                const wr1 = resolveEntityWallCollisions(enemy.x, enemy.y, halfSize);
                enemy.x = wr1.x; enemy.y = wr1.y;
                const wr2 = resolveEntityWallCollisions(otherEnemy.x, otherEnemy.y, otherHalfSize);
                otherEnemy.x = wr2.x; otherEnemy.y = wr2.y;
                
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

                            if (io) markEnemyDamaged(otherEnemy);

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

                            if (io) markEnemyDamaged(otherEnemy);

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

                            if (io) markEnemyDamaged(enemy);

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

                            if (io) markEnemyDamaged(enemy);

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

