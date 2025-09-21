import { WORLD_WIDTH, WORLD_HEIGHT, SAND_COUNT, MIN_SAND_RADIUS, MAX_SAND_RADIUS, MAZE_CELL_SIZE, MAZE_WALL_THICKNESS, ENEMY_CORAL_HEALTH, OBSTACLE_COUNT } from "./constants";

const sands: Sand[] = [];

export interface Dot {
  x: number;
  y: number;
}

export interface Enemy {
  id: string;
  type: 'octopus' | 'fish';
  tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
  x: number;
  y: number;
  angle: number;
  health: number;
  speed: number;
  damage: number;
  knockbackX?: number;
  knockbackY?: number;
  isHostile?: boolean;
  wanderTarget?: { x: number; y: number };
  lastWanderTime?: number;
}

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'coral';
  isEnemy: boolean;
  health?: number;
}

export interface Item {
  id: string;
  type: 'health_potion' | 'speed_boost' | 'shield';
  x: number;
  y: number;
}

export interface Sand {
  x: number;
  y: number;
  radius: number;  // Random size for each sand blob
  rotation: number;  // For slight variation in shape
}

export interface Decoration {
  x: number;
  y: number;
  scale: number;  // For random sizes
}

interface MazeCell {
    x: number;
    y: number;
    walls: {
        north: boolean;
        south: boolean;
        east: boolean;
        west: boolean;
    };
    visited: boolean;
}

interface MazeWall {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function getRandomPositionInZone(zoneIndex: number) {
  const zoneWidth = WORLD_WIDTH / 6;  // 6 zones
  const startX = zoneIndex * zoneWidth;
  
  // For legendary and mythic zones, ensure they're in the rightmost areas
  if (zoneIndex >= 4) {  // Legendary and Mythic zones
      const adjustedStartX = WORLD_WIDTH - (6 - zoneIndex) * (zoneWidth / 2);  // Start from right side
      return {
          x: adjustedStartX + Math.random() * (WORLD_WIDTH - adjustedStartX),
          y: Math.random() * WORLD_HEIGHT
      };
  }
  
  return {
      x: startX + Math.random() * zoneWidth,
      y: Math.random() * WORLD_HEIGHT
  };
}


export function createDecoration() {
  const zoneIndex = Math.floor(Math.random() * 6);  // 6 zones
  const pos = getRandomPositionInZone(zoneIndex);
  return {
      x: pos.x,
      y: pos.y,
      scale: 0.5 + Math.random() * 1.5
  };
}

export function createSand(): Sand {
  // Create sand patches with more spacing
  const sectionWidth = WORLD_WIDTH  // Divide world into sections
  const sectionIndex = sands.length;
  
  return {
      x: (sectionIndex * sectionWidth) + Math.random() * sectionWidth,  // Spread out along x-axis
      y: Math.random() * WORLD_HEIGHT,
      radius: MIN_SAND_RADIUS + Math.random() * (MAX_SAND_RADIUS - MIN_SAND_RADIUS),
      rotation: Math.random() * Math.PI * 2
  };
}

function generateMaze(width: number, height: number): MazeCell[][] {
    const maze: MazeCell[][] = [];
    
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
    function carve(x: number, y: number) {
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
                maze[y][x].walls[dir.wall as 'north' | 'south' | 'east' | 'west'] = false;
                maze[nextY][nextX].walls[dir.opposite as 'north' | 'south' | 'east' | 'west'] = false;
                carve(nextX, nextY);
            }
        }
    }

    // Start from random position
    carve(Math.floor(Math.random() * width), Math.floor(Math.random() * height));
    return maze;
}

function mazeToWalls(maze: MazeCell[][]): Obstacle[] {
    const walls: Obstacle[] = [];
    const cellSize = MAZE_CELL_SIZE;
    const wallThickness = MAZE_WALL_THICKNESS;

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

export function initializeObstacles(): Obstacle[] {
    const mazeWidth = Math.floor(WORLD_WIDTH / MAZE_CELL_SIZE);
    const mazeHeight = Math.floor(WORLD_HEIGHT / MAZE_CELL_SIZE);
    const maze = generateMaze(mazeWidth, mazeHeight);
    const walls = mazeToWalls(maze);

    // Add some random enemy coral obstacles in the corridors
    const enemyCorals = Array(OBSTACLE_COUNT).fill(null).map(() => ({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        width: 50 + Math.random() * 50,
        height: 50 + Math.random() * 50,
        type: 'coral' as const,
        isEnemy: true,
        health: ENEMY_CORAL_HEALTH
    }));

    return [...walls, ...enemyCorals];
}
