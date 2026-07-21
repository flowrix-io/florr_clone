/**
 * Shared spawn-position helpers.
 *
 * These were previously inlined or locally redefined across `server.ts`
 * (`spawnMob` had three near-identical boundary-check loops), `enemySpawner.ts`
 * (`isInOutOfBoundsZone` + four copies of the viewport-sampling block), and
 * others. The math is identical everywhere; this is the single source.
 */

import {
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    VIEWPORT_WIDTH,
    VIEWPORT_HEIGHT,
    VIEWPORT_BUFFER,
    WALL_GRID,
    getTileState,
    isTileIdBlocking,
} from '../../constants';

/** Margin from the world edge inside which spawns are rejected (matches wall extension). */
export const BOUNDARY_THRESHOLD = 100;

/** True if a position falls in the out-of-bounds border band. */
export function isInOutOfBoundsZone(x: number, y: number): boolean {
    return x < BOUNDARY_THRESHOLD ||
           x > ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
           y < BOUNDARY_THRESHOLD ||
           y > ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
}

/** Clamp a point into the playable world rectangle. */
export function clampToWorld(x: number, y: number): { x: number; y: number } {
    return {
        x: Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x)),
        y: Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y)),
    };
}

/** True if a wall/water tile covers this point. */
export function isWallAt(x: number, y: number): boolean {
    return isTileIdBlocking(getTileState(WALL_GRID, x, y));
}

/** Minimal player shape needed to sample a spawn point in their viewport. */
interface ViewportOwner {
    x: number;
    y: number;
    viewportWidth?: number;
    viewportHeight?: number;
}

/**
 * Pick a uniformly-random point inside a player's viewport (plus the standard
 * spawn buffer), clamped to world bounds. Used by the open-world spawner and
 * the admin `spawnMob` fallback.
 */
export function samplePointInViewport(player: ViewportOwner): { x: number; y: number } {
    const vpW = player.viewportWidth || VIEWPORT_WIDTH;
    const vpH = player.viewportHeight || VIEWPORT_HEIGHT;
    const minX = player.x - vpW / 2 - VIEWPORT_BUFFER;
    const maxX = player.x + vpW / 2 + VIEWPORT_BUFFER;
    const minY = player.y - vpH / 2 - VIEWPORT_BUFFER;
    const maxY = player.y + vpH / 2 + VIEWPORT_BUFFER;
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    return clampToWorld(x, y);
}
