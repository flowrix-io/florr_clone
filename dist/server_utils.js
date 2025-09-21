"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRandomPositionInZone = getRandomPositionInZone;
exports.createDecoration = createDecoration;
exports.createSand = createSand;
exports.initializeObstacles = initializeObstacles;
const constants_1 = require("./constants");
const sands = [];
function getRandomPositionInZone(zoneIndex) {
    const zoneWidth = constants_1.WORLD_WIDTH / 6; // 6 zones
    const startX = zoneIndex * zoneWidth;
    // For legendary and mythic zones, ensure they're in the rightmost areas
    if (zoneIndex >= 4) { // Legendary and Mythic zones
        const adjustedStartX = constants_1.WORLD_WIDTH - (6 - zoneIndex) * (zoneWidth / 2); // Start from right side
        return {
            x: adjustedStartX + Math.random() * (constants_1.WORLD_WIDTH - adjustedStartX),
            y: Math.random() * constants_1.WORLD_HEIGHT
        };
    }
    return {
        x: startX + Math.random() * zoneWidth,
        y: Math.random() * constants_1.WORLD_HEIGHT
    };
}
function createDecoration() {
    const zoneIndex = Math.floor(Math.random() * 6); // 6 zones
    const pos = getRandomPositionInZone(zoneIndex);
    return {
        x: pos.x,
        y: pos.y,
        scale: 0.5 + Math.random() * 1.5
    };
}
function createSand() {
    // Create sand patches with more spacing
    const sectionWidth = constants_1.WORLD_WIDTH; // Divide world into sections
    const sectionIndex = sands.length;
    return {
        x: (sectionIndex * sectionWidth) + Math.random() * sectionWidth, // Spread out along x-axis
        y: Math.random() * constants_1.WORLD_HEIGHT,
        radius: constants_1.MIN_SAND_RADIUS + Math.random() * (constants_1.MAX_SAND_RADIUS - constants_1.MIN_SAND_RADIUS),
        rotation: Math.random() * Math.PI * 2
    };
}
function generateMaze(width, height) {
    const maze = [];
    // Initialize maze grid
    for (let y = 0; y < height; y++) {
        maze[y] = [];
        for (let x = 0; x < width; x++) {
            maze[y][x] = {
                x: x,
                y: y,
                walls: {
                    north: true,
                    south: true,
                    east: true,
                    west: true
                },
                visited: false
            };
        }
    }
    // Recursive backtracking to generate maze
    function carve(x, y) {
        maze[y][x].visited = true;
        // Create the directions array without 'as const'
        const baseDirections = [
            { dx: 0, dy: -1, wall: 'north', opposite: 'south' },
            { dx: 0, dy: 1, wall: 'south', opposite: 'north' },
            { dx: 1, dy: 0, wall: 'east', opposite: 'west' },
            { dx: -1, dy: 0, wall: 'west', opposite: 'east' }
        ];
        // Create a mutable copy of the directions array
        const directions = [...baseDirections];
        // Shuffle directions
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }
        for (const dir of directions) {
            const nextX = x + dir.dx;
            const nextY = y + dir.dy;
            if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height && !maze[nextY][nextX].visited) {
                maze[y][x].walls[dir.wall] = false;
                maze[nextY][nextX].walls[dir.opposite] = false;
                carve(nextX, nextY);
            }
        }
    }
    // Start from random position
    carve(Math.floor(Math.random() * width), Math.floor(Math.random() * height));
    return maze;
}
function mazeToWalls(maze) {
    const walls = [];
    const cellSize = constants_1.MAZE_CELL_SIZE;
    const wallThickness = constants_1.MAZE_WALL_THICKNESS;
    for (let y = 0; y < maze.length; y++) {
        for (let x = 0; x < maze[y].length; x++) {
            const cell = maze[y][x];
            const baseX = x * cellSize;
            const baseY = y * cellSize;
            if (cell.walls.north) {
                walls.push({
                    id: `wall_${x}_${y}_n`,
                    x: baseX,
                    y: baseY,
                    width: cellSize,
                    height: wallThickness,
                    type: 'coral',
                    isEnemy: false
                });
            }
            if (cell.walls.west) {
                walls.push({
                    id: `wall_${x}_${y}_w`,
                    x: baseX,
                    y: baseY,
                    width: wallThickness,
                    height: cellSize,
                    type: 'coral',
                    isEnemy: false
                });
            }
            // Add outer walls
            if (x === maze[y].length - 1) {
                walls.push({
                    id: `wall_${x}_${y}_e`,
                    x: baseX + cellSize - wallThickness,
                    y: baseY,
                    width: wallThickness,
                    height: cellSize,
                    type: 'coral',
                    isEnemy: false
                });
            }
            if (y === maze.length - 1) {
                walls.push({
                    id: `wall_${x}_${y}_s`,
                    x: baseX,
                    y: baseY + cellSize - wallThickness,
                    width: cellSize,
                    height: wallThickness,
                    type: 'coral',
                    isEnemy: false
                });
            }
        }
    }
    return walls;
}
function initializeObstacles() {
    const mazeWidth = Math.floor(constants_1.WORLD_WIDTH / constants_1.MAZE_CELL_SIZE);
    const mazeHeight = Math.floor(constants_1.WORLD_HEIGHT / constants_1.MAZE_CELL_SIZE);
    const maze = generateMaze(mazeWidth, mazeHeight);
    const walls = mazeToWalls(maze);
    // Add some random enemy coral obstacles in the corridors
    const enemyCorals = Array(constants_1.OBSTACLE_COUNT).fill(null).map(() => ({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * constants_1.WORLD_WIDTH,
        y: Math.random() * constants_1.WORLD_HEIGHT,
        width: 50 + Math.random() * 50,
        height: 50 + Math.random() * 50,
        type: 'coral',
        isEnemy: true,
        health: constants_1.ENEMY_CORAL_HEALTH
    }));
    return [...walls, ...enemyCorals];
}
