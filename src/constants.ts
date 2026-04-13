import { ServerPlayer } from "./player";
import { Dot } from "./enemy";
import { Obstacle } from "./enemy";
import { Enemy } from "./server_utils";
import { Item } from "./item";

// Mob animation framerate utility - cached to avoid localStorage reads per frame
let _cachedMobAnimFPS: number | null = null;
let _cachedMobAnimFrameTime: number | null = null;
let _cachedHighQualityMobs: boolean | null = null;

export function getMobAnimationFramerate(): number {
    if (_cachedMobAnimFPS === null) {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('mobAnimationFramerate') : null;
        _cachedMobAnimFPS = saved ? parseInt(saved, 10) : 15;
    }
    return _cachedMobAnimFPS;
}

export function getMobAnimationFrameTime(): number {
    if (_cachedMobAnimFrameTime === null) {
        _cachedMobAnimFrameTime = 1000 / getMobAnimationFramerate();
    }
    return _cachedMobAnimFrameTime;
}

// High quality mobs setting utility - cached
export function getHighQualityMobs(): boolean {
    if (_cachedHighQualityMobs === null) {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('highQualityMobs') : null;
        _cachedHighQualityMobs = saved === 'true';
    }
    return _cachedHighQualityMobs;
}

// Call this when settings change to invalidate caches
export function invalidateSettingsCache(): void {
    _cachedMobAnimFPS = null;
    _cachedMobAnimFrameTime = null;
    _cachedHighQualityMobs = null;
}

// Server protocol configuration
export const USE_HTTPS = typeof process !== 'undefined' && process.env ? process.env.USE_HTTPS !== 'false' : true;  // Default to HTTPS, set USE_HTTPS=false to use HTTP
export const SERVER_PROTOCOL = USE_HTTPS ? 'https' : 'http';

// Viewport optimization constants
export const VIEWPORT_BUFFER = 500;  // Extra distance beyond viewport to keep enemies active
export const ENEMY_DESPAWN_TIME = 30000;  // 30 seconds in milliseconds

// Viewport dimensions
export const VIEWPORT_WIDTH = 1920;
export const VIEWPORT_HEIGHT = 1080;
export const VIEWPORT_AREA = VIEWPORT_WIDTH * VIEWPORT_HEIGHT;  // 2,073,600 pixels²

export const players: Record<string, ServerPlayer> = {};
export const dots: Dot[] = [];
export const enemies: Enemy[] = [];
export const obstacles: Obstacle[] = [];
export const items: Item[] = [];

export const WORLD_WIDTH = 60000;
export const WORLD_HEIGHT = 60000;
export const ACTUAL_WORLD_WIDTH = 60000;
export const ACTUAL_WORLD_HEIGHT = 60000;

// Wall grid system constants
export const WALL_TILE_SIZE = 300; // Size of each wall tile in pixels (3x larger for better performance)
export const WALL_GRID_WIDTH = Math.ceil(ACTUAL_WORLD_WIDTH / WALL_TILE_SIZE);
export const WALL_GRID_HEIGHT = Math.ceil(ACTUAL_WORLD_HEIGHT / WALL_TILE_SIZE);

// Wall tile states: 0 = air, 1 = wall, 2 = water
export type WallTileState = 0 | 1 | 2;

// Wall grid type: 2D array where [y][x] = tile state
export type WallGrid = WallTileState[][];

// Density calculation constants (defined after world dimensions)
export const TOTAL_WORLD_AREA = ACTUAL_WORLD_WIDTH * ACTUAL_WORLD_HEIGHT;  // 400,000,000 pixels²
export const ORIGINAL_ENEMY_COUNT = 9000;
export const ORIGINAL_ENEMY_DENSITY = ORIGINAL_ENEMY_COUNT / TOTAL_WORLD_AREA;  // 0.0000225 enemies per pixel² (9x density)
export const VIEWPORT_WITH_BUFFER_AREA = (VIEWPORT_WIDTH + VIEWPORT_BUFFER * 2) * (VIEWPORT_HEIGHT + VIEWPORT_BUFFER * 2);  // 6,073,600 pixels²
export const ENEMIES_PER_VIEWPORT = Math.ceil(ORIGINAL_ENEMY_DENSITY * VIEWPORT_WITH_BUFFER_AREA);  // ~135 enemies per viewport (9x density)
export const OLD_WORLD_WIDTH = 10000;
export const OLD_WORLD_HEIGHT = 2000;
export const PVP_WORLD_WIDTH = 30000;
export const PVP_WORLD_HEIGHT = 30000;
export const SCALE_FACTOR = 1;
//export let ENEMY_COUNT = 200;
export const OBSTACLE_COUNT = 20;
export const ENEMY_CORAL_PROBABILITY = 0.3;
export const ENEMY_CORAL_HEALTH = 50;
export const ENEMY_CORAL_DAMAGE = 5;

export const PLAYER_MAX_HEALTH = 100;
export const ENEMY_MAX_HEALTH = 50;
export const PLAYER_DAMAGE = 5;
export const ENEMY_DAMAGE = 20;
export const DECORATION_COUNT = 100;
export const SAND_COUNT = 50;  // Reduced from 200 to 50
export const MIN_SAND_RADIUS = 50;  // Increased from 30 to 50
export const MAX_SAND_RADIUS = 120; // Increased from 80 to 120

export const ENEMY_TIERS = {
  common: { health: 5, speed: 0.5, damage: 5, probability: 0.4, color: '#7eef6d' },
  uncommon: { health: 40, speed: 0.75, damage: 10, probability: 0.3, color: '#ffe65d' },
  rare: { health: 60, speed: 1, damage: 15, probability: 0.15, color: '#4d52e3' },
  epic: { health: 80, speed: 1.25, damage: 20, probability: 0.1, color: '#861fde' },
  legendary: { health: 100, speed: 1.5, damage: 25, probability: 0.04, color: '#1fdbde' },
  mythic: { health: 150, speed: 2, damage: 30, probability: 0.01, color: '#de1f65' },
  ultra: { health: 450, speed: 2, damage: 90, probability: 0.0, color: '#de1f65' },
  super: { health: 1350, speed: 3, damage: 270, probability: 0.0, color: '#2bffa4' },
  unique: { health: 4050, speed: 4, damage: 810, probability: 0.0, color: '#ffffff' },
  apex: { health: 12150, speed: 5, damage: 2430, probability: 0.0, color: '#ff00ff' }
};

export const MAX_INVENTORY_SIZE = 5;

export const RESPAWN_INVULNERABILITY_TIME = 3000; // 3 seconds of invulnerability after respawn

export const MAX_SPEED = 160;
// Nonlinear mouse movement parameters
export const MOUSE_NONLINEAR_SCALE = 200; // Reference distance for nonlinear scaling (pixels)
export const MOUSE_NONLINEAR_EXPONENT = 0.6; // Power curve exponent (0.6 = slower for small distances, faster for large)

// Add knockback constants at the top with other constants
export const KNOCKBACK_FORCE = 5; // Reduced for faster movement with many enemies
export const KNOCKBACK_RECOVERY_SPEED = 0.7; // Faster decay to reduce movement resistance

// Add XP-related constants
export const BASE_XP_REQUIREMENT = 100;
export const XP_MULTIPLIER = 1.08;
export const HEALTH_PER_LEVEL = 10;
export const DAMAGE_PER_LEVEL = 1;
export const PLAYER_SIZE = 40;
export const ENEMY_SIZE = 40;
export const TELEPORTER_RADIUS = 60; // Radius for point-based teleporter interaction
export const TELEPORTER_SUCTION_RADIUS = 150; // Larger radius for suction pull effect
export const TELEPORTER_SUCTION_FORCE = 400; // Force magnitude (enough to overcome knockback of 25)
export const TELEPORTER_COOLDOWN = 5000; // 5 second cooldown after teleporting

// Define zone boundaries for different tiers
export const ZONE_BOUNDARIES = {
    common: { start: 0, end: 12000 },
    uncommon: { start: 12000, end: 24000 },
    rare: { start: 24000, end: 36000 },
    epic: { start: 36000, end: 48000 },
    legendary: { start: 48000, end: 54000 },
    mythic: { start: 54000, end: WORLD_WIDTH }
};

// Section configuration for the 3x3 map grid (9 sections total)
// Each section is 20000x20000 pixels
// Section numbering: 1-9 (row-major order, top-left to bottom-right)
export interface SectionConfig {
    name: string;
    background?: string;  // Optional background color (hex like '#00d885') or SVG path (like 'land.svg')
}

// Default section configurations (indexed 0-8, displayed as sections 1-9)
export const SECTION_CONFIGS: SectionConfig[] = [
    { name: 'Garden', background: 'land.svg' },           // Section 1 (top-left)
    { name: 'Desert', background: 'desert.svg' },           // Section 2 (top-center)
    { name: 'Hel', background: 'hel.svg' },           // Section 3 (top-right)
    { name: 'Ocean', background: 'ocean.svg' },           // Section 4 (middle-left)
    { name: 'Ant Hell', background: 'ant_hell.svg' },       // Section 5 (center)
    { name: 'Jungle', background: 'jungle.svg' },           // Section 6 (middle-right)
    { name: 'Sewers', background: 'sewers.svg' },           // Section 7 (bottom-left)
    { name: 'Unknown', background: '#000000' },        // Section 8 (bottom-center)
    { name: 'Unknown', background: '#000000' },            // Section 9 (bottom-right)
];

// Add enemy size multipliers like in singleplayer
export const ENEMY_SIZE_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.2,
    rare: 1.4,
    epic: 1.6,
    legendary: 1.8,
    mythic: 2.0,
    ultra: 2.5,
    super: 3.0,
    unique: 3.5
};

// Add drop chances like in singleplayer
export const DROP_CHANCES = {
    common: 0.1,      // 10% chance
    uncommon: 0.2,    // 20% chance
    rare: 0.3,        // 30% chance
    epic: 0.4,        // 40% chance
    legendary: 0.5,   // 50% chance
    mythic: 0.75,     // 75% chance
    ultra: 0.9,       // 90% chance
    super: 0.95,      // 95% chance
    unique: 1.0       // 100% chance
};

// Add maze configuration
export const MAZE_CELL_SIZE = 1000;  // Size of each maze cell
export const MAZE_WALL_THICKNESS = 100;  // Thickness of maze walls

// Add map configuration

// Define spawn table entry for biomes
export interface BiomeSpawnEntry {
    mobType?: string;  // If not specified, uses any mob type
    tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
    weight: number;  // Relative probability (higher = more common)
    reversed?: boolean;  // Whether the mob image should be flipped horizontally
}

export interface MapElement {
    type: 'wall' | 'spawn' | 'teleporter' | 'safe_zone' | 'biome';
    x: number;
    y: number;
    width: number;
    height: number;
    properties?: {
        teleportTo?: { x: number; y: number; serverPort?: number };
        spawnType?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
        isNoCombat?: boolean;
        isSafeZone?: boolean;
        // Biome-specific properties
        biomeName?: string;  // Unique identifier for the biome
        spawnTable?: BiomeSpawnEntry[];  // Spawn table for this biome
        backgroundTexture?: string;  // Path to background texture (e.g., "land.svg", "desert.svg")
    };
}

// Map data structure that includes wall grid
export interface MapData {
    elements: MapElement[];
    wallGrid?: WallGrid;
}


// Add map element type guards
export function isWall(element: MapElement): boolean {
    return element.type === 'wall';
}

export function isSpawn(element: MapElement): boolean {
    return element.type === 'spawn';
}

export function isTeleporter(element: MapElement): boolean {
    return element.type === 'teleporter';
}

export function isSafeZone(element: MapElement): boolean {
    return element.type === 'safe_zone';
}

// Server configuration for cross-server teleportation
export interface ServerConfig {
    port: number;
    host: string;
    name: string;
    protocol?: string;  // Optional protocol, defaults to SERVER_PROTOCOL
}

// Default server configuration - can be overridden via environment variables or config file
export const DEFAULT_SERVER_CONFIGS: ServerConfig[] = [
    { port: 3000, host: 'localhost', name: 'Server1' },
    { port: 3001, host: 'localhost', name: 'Server2' },
    { port: 3002, host: 'localhost', name: 'Server3' }
];

// Get server configuration from environment or use defaults
export function getServerConfigs(): ServerConfig[] {
    const configStr = typeof process !== 'undefined' && process.env ? process.env.SERVER_CONFIGS : undefined;
    if (configStr) {
        try {
            const configs = JSON.parse(configStr);
            return configs.map((config: ServerConfig) => ({ 
                ...config, 
                protocol: config.protocol || SERVER_PROTOCOL 
            }));
        } catch (error) {
            console.error('Failed to parse SERVER_CONFIGS environment variable:', error);
        }
    }
    return DEFAULT_SERVER_CONFIGS.map(config => ({ 
        ...config, 
        protocol: config.protocol || SERVER_PROTOCOL 
    }));
}

// Find server config by port
export function getServerConfigByPort(port: number): ServerConfig | undefined {
    return getServerConfigs().find(config => config.port === port);
}

// Helper function to create empty wall grid
export function createEmptyWallGrid(): WallGrid {
    const grid: WallGrid = [];
    for (let y = 0; y < WALL_GRID_HEIGHT; y++) {
        grid[y] = new Array(WALL_GRID_WIDTH).fill(0) as WallTileState[];
    }
    return grid;
}

// Wall grid - populated from server data at runtime
export const WALL_GRID: WallGrid = createEmptyWallGrid();

// Helper functions for wall grid coordinate conversion
export function worldToTileX(worldX: number): number {
    return Math.floor(worldX / WALL_TILE_SIZE);
}

export function worldToTileY(worldY: number): number {
    return Math.floor(worldY / WALL_TILE_SIZE);
}

export function tileToWorldX(tileX: number): number {
    return tileX * WALL_TILE_SIZE;
}

export function tileToWorldY(tileY: number): number {
    return tileY * WALL_TILE_SIZE;
}

// Get tile state at world coordinates
export function getTileState(grid: WallGrid, worldX: number, worldY: number): WallTileState {
    const tileX = worldToTileX(worldX);
    const tileY = worldToTileY(worldY);
    if (tileY < 0 || tileY >= grid.length || tileX < 0 || tileX >= (grid[0]?.length || 0)) {
        return 0; // Out of bounds = air
    }
    return grid[tileY][tileX];
}

// Set tile state at world coordinates
export function setTileState(grid: WallGrid, worldX: number, worldY: number, state: WallTileState): void {
    const tileX = worldToTileX(worldX);
    const tileY = worldToTileY(worldY);
    if (tileY >= 0 && tileY < grid.length && tileX >= 0 && tileX < (grid[0]?.length || 0)) {
        grid[tileY][tileX] = state;
    }
}

// Check if a point collides with a wall tile
export function collidesWithWallTile(grid: WallGrid, worldX: number, worldY: number): boolean {
    return getTileState(grid, worldX, worldY) === 1;
}

// Check if a point is in water
export function isInWater(grid: WallGrid, worldX: number, worldY: number): boolean {
    return getTileState(grid, worldX, worldY) === 2;
}

// --- Jagged Edge System (shared between client and server) ---

/** Deterministic seeded random number generator */
export function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

/** A point on a jagged edge in tile-local coordinates.
 *  t = distance along the edge (0..WALL_TILE_SIZE)
 *  offset = perpendicular distance outward into air (0..JAGGED_MAX_OFFSET) */
export interface JaggedPoint {
    t: number;
    offset: number;
}

/** Cached jagged edge data for a single tile. null = edge not exposed. */
export interface TileJaggedEdges {
    top: JaggedPoint[] | null;
    bottom: JaggedPoint[] | null;
    left: JaggedPoint[] | null;
    right: JaggedPoint[] | null;
}

export const JAGGED_MAX_OFFSET = 20;
export const JAGGED_NUM_SEGMENTS = 7;

const JAGGED_EDGE_CACHE: Map<string, TileJaggedEdges> = new Map();

/** Check if a tile edge is exposed (adjacent tile is air, or wall adjacent to water) */
export function isTileEdgeExposed(
    grid: WallGrid, tileX: number, tileY: number,
    edge: 'top' | 'bottom' | 'left' | 'right'
): boolean {
    let adjX = tileX, adjY = tileY;
    if (edge === 'top') adjY--;
    else if (edge === 'bottom') adjY++;
    else if (edge === 'left') adjX--;
    else if (edge === 'right') adjX++;

    if (adjY < 0 || adjY >= grid.length || adjX < 0 || adjX >= (grid[0]?.length || 0)) {
        return true; // Out of bounds = exposed
    }
    const adjState = grid[adjY][adjX];
    if (adjState === 0) return true; // Adjacent to air = exposed
    // Wall tiles (dirt) show edges against water
    const currentState = grid[tileY]?.[tileX] || 0;
    if (currentState === 1 && adjState === 2) return true;
    return false;
}

/** Generate jagged edge points for one edge of a tile */
export function generateJaggedEdgePoints(
    tileX: number, tileY: number,
    edge: 'top' | 'bottom' | 'left' | 'right'
): JaggedPoint[] {
    const edgeIndex = edge === 'top' ? 0 : edge === 'bottom' ? 1 : edge === 'left' ? 2 : 3;
    const baseSeed = ((tileX * 73856093) ^ (tileY * 19349669)) + edgeIndex * 1000;

    const points: JaggedPoint[] = [];
    points.push({ t: 0, offset: 0 });

    const segmentLength = WALL_TILE_SIZE / (JAGGED_NUM_SEGMENTS + 1);

    for (let i = 1; i <= JAGGED_NUM_SEGMENTS; i++) {
        const seed = baseSeed + i;
        const jitter = (seededRandom(seed) - 0.5) * segmentLength * 0.4;
        const t = Math.max(1, Math.min(WALL_TILE_SIZE - 1, i * segmentLength + jitter));
        const offset = seededRandom(seed + 100) * JAGGED_MAX_OFFSET;
        points.push({ t, offset });
    }

    points.push({ t: WALL_TILE_SIZE, offset: 0 });
    points.sort((a, b) => a.t - b.t);

    return points;
}

/** Get jagged edge data for a tile (cached) */
export function getTileJaggedEdges(grid: WallGrid, tileX: number, tileY: number): TileJaggedEdges {
    const key = `${tileX},${tileY}`;
    const cached = JAGGED_EDGE_CACHE.get(key);
    if (cached) return cached;

    const edges: TileJaggedEdges = {
        top: isTileEdgeExposed(grid, tileX, tileY, 'top')
            ? generateJaggedEdgePoints(tileX, tileY, 'top') : null,
        bottom: isTileEdgeExposed(grid, tileX, tileY, 'bottom')
            ? generateJaggedEdgePoints(tileX, tileY, 'bottom') : null,
        left: isTileEdgeExposed(grid, tileX, tileY, 'left')
            ? generateJaggedEdgePoints(tileX, tileY, 'left') : null,
        right: isTileEdgeExposed(grid, tileX, tileY, 'right')
            ? generateJaggedEdgePoints(tileX, tileY, 'right') : null,
    };

    JAGGED_EDGE_CACHE.set(key, edges);
    return edges;
}

/** Get the maximum jagged protrusion within a range [minT, maxT] on an edge */
export function getMaxJaggedOffset(points: JaggedPoint[], minT: number, maxT: number): number {
    let maxOffset = 0;

    for (const pt of points) {
        if (pt.t >= minT && pt.t <= maxT) {
            if (pt.offset > maxOffset) maxOffset = pt.offset;
        }
    }

    // Interpolate at range boundaries for segments that cross them
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i], p1 = points[i + 1];
        if (p1.t < minT || p0.t > maxT) continue;
        if (p0.t < minT && p1.t > minT) {
            const frac = (minT - p0.t) / (p1.t - p0.t);
            const interpOffset = p0.offset + frac * (p1.offset - p0.offset);
            if (interpOffset > maxOffset) maxOffset = interpOffset;
        }
        if (p0.t < maxT && p1.t > maxT) {
            const frac = (maxT - p0.t) / (p1.t - p0.t);
            const interpOffset = p0.offset + frac * (p1.offset - p0.offset);
            if (interpOffset > maxOffset) maxOffset = interpOffset;
        }
    }

    return maxOffset;
}

