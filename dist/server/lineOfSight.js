"use strict";
/**
 * Line-of-sight raycasting, extracted from physics.ts.
 *
 * This lives in its own module because importing physics.ts pulls in the mob
 * death/damage path, which transitively boots the whole game server at module
 * scope — it listens on a port, spawns bots and schedules restarts. Anything
 * that only needs to ask "is there a wall between these two points?" (the ECS
 * composition root, the headless harness, bots) must be able to do so without
 * starting a server.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasLineOfSight = hasLineOfSight;
const constants_1 = require("../constants");
const map_data_1 = require("../map_data");
const maze_1 = require("../maze");
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
    // Maze region uses its own wall grid (WALL_GRID doesn't cover it).
    if ((0, maze_1.isInMazeRegion)(x1, y1) || (0, maze_1.isInMazeRegion)(x2, y2)) {
        return !(0, maze_1.mazeBlocksLine)(x1, y1, x2, y2);
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
