"use strict";
/**
 * Shared spawn-position helpers.
 *
 * These were previously inlined or locally redefined across `server.ts`
 * (`spawnMob` had three near-identical boundary-check loops), `enemySpawner.ts`
 * (`isInOutOfBoundsZone` + four copies of the viewport-sampling block), and
 * others. The math is identical everywhere; this is the single source.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOUNDARY_THRESHOLD = void 0;
exports.isInOutOfBoundsZone = isInOutOfBoundsZone;
exports.clampToWorld = clampToWorld;
exports.isWallAt = isWallAt;
exports.samplePointInViewport = samplePointInViewport;
const constants_1 = require("../../constants");
/** Margin from the world edge inside which spawns are rejected (matches wall extension). */
exports.BOUNDARY_THRESHOLD = 100;
/** True if a position falls in the out-of-bounds border band. */
function isInOutOfBoundsZone(x, y) {
    return x < exports.BOUNDARY_THRESHOLD ||
        x > constants_1.ACTUAL_WORLD_WIDTH - exports.BOUNDARY_THRESHOLD ||
        y < exports.BOUNDARY_THRESHOLD ||
        y > constants_1.ACTUAL_WORLD_HEIGHT - exports.BOUNDARY_THRESHOLD;
}
/** Clamp a point into the playable world rectangle. */
function clampToWorld(x, y) {
    return {
        x: Math.max(0, Math.min(constants_1.ACTUAL_WORLD_WIDTH, x)),
        y: Math.max(0, Math.min(constants_1.ACTUAL_WORLD_HEIGHT, y)),
    };
}
/** True if a wall/water tile covers this point. */
function isWallAt(x, y) {
    return (0, constants_1.isTileIdBlocking)((0, constants_1.getTileState)(constants_1.WALL_GRID, x, y));
}
/**
 * Pick a uniformly-random point inside a player's viewport (plus the standard
 * spawn buffer), clamped to world bounds. Used by the open-world spawner and
 * the admin `spawnMob` fallback.
 */
function samplePointInViewport(player) {
    const vpW = player.viewportWidth || constants_1.VIEWPORT_WIDTH;
    const vpH = player.viewportHeight || constants_1.VIEWPORT_HEIGHT;
    const minX = player.x - vpW / 2 - constants_1.VIEWPORT_BUFFER;
    const maxX = player.x + vpW / 2 + constants_1.VIEWPORT_BUFFER;
    const minY = player.y - vpH / 2 - constants_1.VIEWPORT_BUFFER;
    const maxY = player.y + vpH / 2 + constants_1.VIEWPORT_BUFFER;
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    return clampToWorld(x, y);
}
