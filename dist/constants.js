"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOCKBACK_RECOVERY_SPEED = exports.KNOCKBACK_FORCE = exports.MOUSE_NONLINEAR_EXPONENT = exports.MOUSE_NONLINEAR_SCALE = exports.MAX_SPEED = exports.RESPAWN_INVULNERABILITY_TIME = exports.MAX_INVENTORY_SIZE = exports.ENEMY_TIERS = exports.MAX_SAND_RADIUS = exports.MIN_SAND_RADIUS = exports.SAND_COUNT = exports.DECORATION_COUNT = exports.ENEMY_DAMAGE = exports.PLAYER_DAMAGE = exports.ENEMY_MAX_HEALTH = exports.PLAYER_MAX_HEALTH = exports.ENEMY_CORAL_DAMAGE = exports.ENEMY_CORAL_HEALTH = exports.ENEMY_CORAL_PROBABILITY = exports.OBSTACLE_COUNT = exports.SCALE_FACTOR = exports.PVP_WORLD_HEIGHT = exports.PVP_WORLD_WIDTH = exports.OLD_WORLD_HEIGHT = exports.OLD_WORLD_WIDTH = exports.ENEMIES_PER_VIEWPORT = exports.VIEWPORT_WITH_BUFFER_AREA = exports.ORIGINAL_ENEMY_DENSITY = exports.ORIGINAL_ENEMY_COUNT = exports.TOTAL_WORLD_AREA = exports.BUILTIN_TILE_TYPES = exports.WALL_GRID_HEIGHT = exports.WALL_GRID_WIDTH = exports.WALL_TILE_SIZE = exports.ACTUAL_WORLD_HEIGHT = exports.ACTUAL_WORLD_WIDTH = exports.WORLD_HEIGHT = exports.WORLD_WIDTH = exports.items = exports.obstacles = exports.enemies = exports.dots = exports.players = exports.VIEWPORT_AREA = exports.VIEWPORT_HEIGHT = exports.VIEWPORT_WIDTH = exports.ENEMY_DESPAWN_TIME = exports.VIEWPORT_BUFFER = exports.SERVER_PROTOCOL = exports.USE_HTTPS = void 0;
exports.JAGGED_NUM_SEGMENTS = exports.JAGGED_MAX_OFFSET = exports.WALL_GRID = exports.DEFAULT_SERVER_CONFIGS = exports.MAZE_WALL_THICKNESS = exports.MAZE_CELL_SIZE = exports.DROP_CHANCES = exports.ENEMY_SIZE_MULTIPLIERS = exports.SECTION_CONFIGS = exports.ZONE_BOUNDARIES = exports.PVP_MAX_HEALTH = exports.PVP_INVENTORY_KEEP_RATIO = exports.PVP_EXIT_RETURN_Y = exports.PVP_EXIT_RETURN_X = exports.PVP_ARENA_SPAWN_Y = exports.PVP_ARENA_SPAWN_X = exports.PVP_ARENA_RADIUS = exports.PVP_ARENA_CENTER_Y = exports.PVP_ARENA_CENTER_X = exports.TELEPORTER_COOLDOWN = exports.TELEPORTER_SUCTION_FORCE = exports.TELEPORTER_SUCTION_RADIUS = exports.TELEPORTER_RADIUS = exports.ENEMY_SIZE = exports.PLAYER_SIZE = exports.DAMAGE_PER_LEVEL = exports.HEALTH_PER_LEVEL = exports.XP_MULTIPLIER = exports.BASE_XP_REQUIREMENT = void 0;
exports.getMobAnimationFramerate = getMobAnimationFramerate;
exports.getMobAnimationFrameTime = getMobAnimationFrameTime;
exports.getHighQualityMobs = getHighQualityMobs;
exports.invalidateSettingsCache = invalidateSettingsCache;
exports.registerTileType = registerTileType;
exports.setCustomTileTypes = setCustomTileTypes;
exports.getTileTypeConfig = getTileTypeConfig;
exports.getAllTileTypes = getAllTileTypes;
exports.isTileIdSolid = isTileIdSolid;
exports.isTileIdWater = isTileIdWater;
exports.isTileIdBlocking = isTileIdBlocking;
exports.isInPvpArena = isInPvpArena;
exports.isWall = isWall;
exports.isSpawn = isSpawn;
exports.isTeleporter = isTeleporter;
exports.isSafeZone = isSafeZone;
exports.getServerConfigs = getServerConfigs;
exports.getServerConfigByPort = getServerConfigByPort;
exports.createEmptyWallGrid = createEmptyWallGrid;
exports.worldToTileX = worldToTileX;
exports.worldToTileY = worldToTileY;
exports.tileToWorldX = tileToWorldX;
exports.tileToWorldY = tileToWorldY;
exports.getTileState = getTileState;
exports.setTileState = setTileState;
exports.collidesWithWallTile = collidesWithWallTile;
exports.isInWater = isInWater;
exports.seededRandom = seededRandom;
exports.isTileEdgeExposed = isTileEdgeExposed;
exports.generateJaggedEdgePoints = generateJaggedEdgePoints;
exports.getTileJaggedEdges = getTileJaggedEdges;
exports.encodeTileGridRLE = encodeTileGridRLE;
exports.decodeTileGridRLE = decodeTileGridRLE;
exports.tilesToWallGrid = tilesToWallGrid;
exports.wallGridToFlat = wallGridToFlat;
exports.getMaxJaggedOffset = getMaxJaggedOffset;
// Mob animation framerate utility - cached to avoid localStorage reads per frame
let _cachedMobAnimFPS = null;
let _cachedMobAnimFrameTime = null;
let _cachedHighQualityMobs = null;
function getMobAnimationFramerate() {
    if (_cachedMobAnimFPS === null) {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('mobAnimationFramerate') : null;
        _cachedMobAnimFPS = saved ? parseInt(saved, 10) : 15;
    }
    return _cachedMobAnimFPS;
}
function getMobAnimationFrameTime() {
    if (_cachedMobAnimFrameTime === null) {
        _cachedMobAnimFrameTime = 1000 / getMobAnimationFramerate();
    }
    return _cachedMobAnimFrameTime;
}
// High quality mobs setting utility - cached
function getHighQualityMobs() {
    if (_cachedHighQualityMobs === null) {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('highQualityMobs') : null;
        _cachedHighQualityMobs = saved === 'true';
    }
    return _cachedHighQualityMobs;
}
// Call this when settings change to invalidate caches
function invalidateSettingsCache() {
    _cachedMobAnimFPS = null;
    _cachedMobAnimFrameTime = null;
    _cachedHighQualityMobs = null;
}
// Server protocol configuration
exports.USE_HTTPS = typeof process !== 'undefined' && process.env ? process.env.USE_HTTPS !== 'false' : true; // Default to HTTPS, set USE_HTTPS=false to use HTTP
exports.SERVER_PROTOCOL = exports.USE_HTTPS ? 'https' : 'http';
// Viewport optimization constants
exports.VIEWPORT_BUFFER = 500; // Extra distance beyond viewport to keep enemies active
exports.ENEMY_DESPAWN_TIME = 30000; // 30 seconds in milliseconds
// Viewport dimensions
exports.VIEWPORT_WIDTH = 1920;
exports.VIEWPORT_HEIGHT = 1080;
exports.VIEWPORT_AREA = exports.VIEWPORT_WIDTH * exports.VIEWPORT_HEIGHT; // 2,073,600 pixels²
exports.players = {};
exports.dots = [];
exports.enemies = [];
exports.obstacles = [];
exports.items = [];
exports.WORLD_WIDTH = 60000;
exports.WORLD_HEIGHT = 60000;
exports.ACTUAL_WORLD_WIDTH = 60000;
exports.ACTUAL_WORLD_HEIGHT = 60000;
// Wall grid system constants
exports.WALL_TILE_SIZE = 300; // Size of each wall tile in pixels (3x larger for better performance)
exports.WALL_GRID_WIDTH = Math.ceil(exports.ACTUAL_WORLD_WIDTH / exports.WALL_TILE_SIZE);
exports.WALL_GRID_HEIGHT = Math.ceil(exports.ACTUAL_WORLD_HEIGHT / exports.WALL_TILE_SIZE);
/** Built-in tile types — IDs 0-2 are reserved and always present. */
exports.BUILTIN_TILE_TYPES = [
    { id: 0, name: 'air', solid: false, water: false, color: '#00000000', style: 'flat' },
    { id: 1, name: 'wall', solid: true, water: false, color: '#666666', style: 'wall' },
    { id: 2, name: 'water', solid: false, water: true, color: '#4169E1', borderColor: '#2a4fa0', style: 'water' },
];
/** Mutable registry: built-ins + custom types loaded from the map bundle. */
const TILE_TYPE_REGISTRY = (() => {
    const m = new Map();
    for (const t of exports.BUILTIN_TILE_TYPES)
        m.set(t.id, t);
    return m;
})();
/** Register or override a tile type (typically called once at startup with custom map types). */
function registerTileType(config) {
    if (config.id < 0 || config.id > 255 || !Number.isInteger(config.id)) {
        throw new Error(`TileTypeConfig.id must be an integer in [0, 255], got ${config.id}`);
    }
    if (config.id < exports.BUILTIN_TILE_TYPES.length) {
        // Allow overriding built-in colors/styles but keep semantic flags (solid/water) sane.
        const builtin = exports.BUILTIN_TILE_TYPES[config.id];
        if (config.solid !== builtin.solid || config.water !== builtin.water) {
            console.warn(`[TileRegistry] Refusing to change solid/water flags of built-in tile ${builtin.name} (id=${builtin.id})`);
            config = { ...config, solid: builtin.solid, water: builtin.water };
        }
    }
    TILE_TYPE_REGISTRY.set(config.id, config);
}
/** Replace the entire custom-tile portion of the registry. Built-ins are restored first. */
function setCustomTileTypes(configs) {
    TILE_TYPE_REGISTRY.clear();
    for (const t of exports.BUILTIN_TILE_TYPES)
        TILE_TYPE_REGISTRY.set(t.id, t);
    for (const c of configs) {
        if (c.id < exports.BUILTIN_TILE_TYPES.length)
            continue; // skip attempts to redefine built-ins via this path
        registerTileType(c);
    }
}
/** Look up a tile type by ID. Falls back to air for unknown IDs (so forward-compat reads don't crash). */
function getTileTypeConfig(id) {
    return TILE_TYPE_REGISTRY.get(id) || exports.BUILTIN_TILE_TYPES[0];
}
/** Iterate all currently registered tile types (built-in + custom). */
function getAllTileTypes() {
    return Array.from(TILE_TYPE_REGISTRY.values()).sort((a, b) => a.id - b.id);
}
/** True if the given tile ID is solid (blocks movement). */
function isTileIdSolid(id) {
    return getTileTypeConfig(id).solid;
}
/** True if the given tile ID is water. */
function isTileIdWater(id) {
    return getTileTypeConfig(id).water;
}
/**
 * True if a tile blocks player/enemy positioning — i.e. it is either solid
 * (collides) or water (not walkable). Used for movement collision, spawn
 * validation, line-of-sight, and pathfinding obstacle checks. Equivalent to
 * `isTileIdSolid(id) || isTileIdWater(id)`, exposed as a single helper so
 * custom tile types automatically participate everywhere the legacy 0/1/2
 * system used `state === 1 || state === 2`.
 */
function isTileIdBlocking(id) {
    const cfg = getTileTypeConfig(id);
    return cfg.solid || cfg.water;
}
// Density calculation constants (defined after world dimensions)
exports.TOTAL_WORLD_AREA = exports.ACTUAL_WORLD_WIDTH * exports.ACTUAL_WORLD_HEIGHT; // 400,000,000 pixels²
exports.ORIGINAL_ENEMY_COUNT = 9000;
exports.ORIGINAL_ENEMY_DENSITY = exports.ORIGINAL_ENEMY_COUNT / exports.TOTAL_WORLD_AREA; // 0.0000225 enemies per pixel² (9x density)
exports.VIEWPORT_WITH_BUFFER_AREA = (exports.VIEWPORT_WIDTH + exports.VIEWPORT_BUFFER * 2) * (exports.VIEWPORT_HEIGHT + exports.VIEWPORT_BUFFER * 2); // 6,073,600 pixels²
exports.ENEMIES_PER_VIEWPORT = Math.ceil(exports.ORIGINAL_ENEMY_DENSITY * exports.VIEWPORT_WITH_BUFFER_AREA); // ~135 enemies per viewport (9x density)
exports.OLD_WORLD_WIDTH = 10000;
exports.OLD_WORLD_HEIGHT = 2000;
exports.PVP_WORLD_WIDTH = 30000;
exports.PVP_WORLD_HEIGHT = 30000;
exports.SCALE_FACTOR = 1;
//export let ENEMY_COUNT = 200;
exports.OBSTACLE_COUNT = 20;
exports.ENEMY_CORAL_PROBABILITY = 0.3;
exports.ENEMY_CORAL_HEALTH = 50;
exports.ENEMY_CORAL_DAMAGE = 5;
exports.PLAYER_MAX_HEALTH = 100;
exports.ENEMY_MAX_HEALTH = 50;
exports.PLAYER_DAMAGE = 5;
exports.ENEMY_DAMAGE = 20;
exports.DECORATION_COUNT = 100;
exports.SAND_COUNT = 50; // Reduced from 200 to 50
exports.MIN_SAND_RADIUS = 50; // Increased from 30 to 50
exports.MAX_SAND_RADIUS = 120; // Increased from 80 to 120
exports.ENEMY_TIERS = {
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
exports.MAX_INVENTORY_SIZE = 5;
exports.RESPAWN_INVULNERABILITY_TIME = 3000; // 3 seconds of invulnerability after respawn
exports.MAX_SPEED = 160;
// Nonlinear mouse movement parameters
exports.MOUSE_NONLINEAR_SCALE = 200; // Reference distance for nonlinear scaling (pixels)
exports.MOUSE_NONLINEAR_EXPONENT = 0.6; // Power curve exponent (0.6 = slower for small distances, faster for large)
// Add knockback constants at the top with other constants
exports.KNOCKBACK_FORCE = 5; // Reduced for faster movement with many enemies
exports.KNOCKBACK_RECOVERY_SPEED = 0.7; // Faster decay to reduce movement resistance
// Add XP-related constants
exports.BASE_XP_REQUIREMENT = 100;
exports.XP_MULTIPLIER = 1.08;
exports.HEALTH_PER_LEVEL = 10;
exports.DAMAGE_PER_LEVEL = 1;
exports.PLAYER_SIZE = 40;
exports.ENEMY_SIZE = 40;
exports.TELEPORTER_RADIUS = 60; // Radius for point-based teleporter interaction
exports.TELEPORTER_SUCTION_RADIUS = 150; // Larger radius for suction pull effect
exports.TELEPORTER_SUCTION_FORCE = 400; // Force magnitude (enough to overcome knockback of 25)
exports.TELEPORTER_COOLDOWN = 5000; // 5 second cooldown after teleporting
// PVP arena: a circular zone where players can damage each other.
// Placed well outside the regular world bounds (60000x60000) so it shares no
// coordinate space with the map — there is no walkable path between them.
// Entry is exclusively via the "PVP" choice on the title screen; exit is via
// the teleporter at the arena center.
exports.PVP_ARENA_CENTER_X = 150000;
exports.PVP_ARENA_CENTER_Y = 150000;
exports.PVP_ARENA_RADIUS = 2500;
// Spawn point inside the arena (offset from center so players don't sit on the exit teleporter)
exports.PVP_ARENA_SPAWN_X = exports.PVP_ARENA_CENTER_X + 1500;
exports.PVP_ARENA_SPAWN_Y = exports.PVP_ARENA_CENTER_Y;
// Where the exit teleporter drops players when they leave the arena.
exports.PVP_EXIT_RETURN_X = 19000;
exports.PVP_EXIT_RETURN_Y = 17400;
// Fraction of petals gained inside PVP that survive the trip back to the regular inventory.
exports.PVP_INVENTORY_KEEP_RATIO = 0.25;
// All players in the PVP arena share the same fixed max health regardless of level/petals.
exports.PVP_MAX_HEALTH = 100;
function isInPvpArena(x, y) {
    const dx = x - exports.PVP_ARENA_CENTER_X;
    const dy = y - exports.PVP_ARENA_CENTER_Y;
    return dx * dx + dy * dy <= exports.PVP_ARENA_RADIUS * exports.PVP_ARENA_RADIUS;
}
// Define zone boundaries for different tiers
exports.ZONE_BOUNDARIES = {
    common: { start: 0, end: 12000 },
    uncommon: { start: 12000, end: 24000 },
    rare: { start: 24000, end: 36000 },
    epic: { start: 36000, end: 48000 },
    legendary: { start: 48000, end: 54000 },
    mythic: { start: 54000, end: exports.WORLD_WIDTH }
};
// Default section configurations (indexed 0-8, displayed as sections 1-9)
exports.SECTION_CONFIGS = [
    { name: 'Garden', background: 'land.svg' }, // Section 1 (top-left)
    { name: 'Desert', background: 'desert.svg' }, // Section 2 (top-center)
    { name: 'Hel', background: 'hel.svg' }, // Section 3 (top-right)
    { name: 'Ocean', background: 'ocean.svg' }, // Section 4 (middle-left)
    { name: 'Ant Hell', background: 'ant_hell.svg' }, // Section 5 (center)
    { name: 'Jungle', background: 'jungle.svg' }, // Section 6 (middle-right)
    { name: 'Sewers', background: 'sewers.svg' }, // Section 7 (bottom-left)
    { name: 'Computer', background: '#000000' }, // Section 8 (bottom-center)
    { name: 'Unknown', background: '#000000' }, // Section 9 (bottom-right)
];
// Add enemy size multipliers like in singleplayer
exports.ENEMY_SIZE_MULTIPLIERS = {
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
exports.DROP_CHANCES = {
    common: 0.1, // 10% chance
    uncommon: 0.2, // 20% chance
    rare: 0.3, // 30% chance
    epic: 0.4, // 40% chance
    legendary: 0.5, // 50% chance
    mythic: 0.75, // 75% chance
    ultra: 0.9, // 90% chance
    super: 0.95, // 95% chance
    unique: 1.0 // 100% chance
};
// Add maze configuration
exports.MAZE_CELL_SIZE = 1000; // Size of each maze cell
exports.MAZE_WALL_THICKNESS = 100; // Thickness of maze walls
// Add map element type guards
function isWall(element) {
    return element.type === 'wall';
}
function isSpawn(element) {
    return element.type === 'spawn';
}
function isTeleporter(element) {
    return element.type === 'teleporter';
}
function isSafeZone(element) {
    return element.type === 'safe_zone';
}
// Default server configuration - can be overridden via environment variables or config file
exports.DEFAULT_SERVER_CONFIGS = [
    { port: 3000, host: 'localhost', name: 'Server1' },
    { port: 3001, host: 'localhost', name: 'Server2' },
    { port: 3002, host: 'localhost', name: 'Server3' }
];
// Get server configuration from environment or use defaults
function getServerConfigs() {
    const configStr = typeof process !== 'undefined' && process.env ? process.env.SERVER_CONFIGS : undefined;
    if (configStr) {
        try {
            const configs = JSON.parse(configStr);
            return configs.map((config) => ({
                ...config,
                protocol: config.protocol || exports.SERVER_PROTOCOL
            }));
        }
        catch (error) {
            console.error('Failed to parse SERVER_CONFIGS environment variable:', error);
        }
    }
    return exports.DEFAULT_SERVER_CONFIGS.map(config => ({
        ...config,
        protocol: config.protocol || exports.SERVER_PROTOCOL
    }));
}
// Find server config by port
function getServerConfigByPort(port) {
    return getServerConfigs().find(config => config.port === port);
}
// Helper function to create empty wall grid
function createEmptyWallGrid() {
    const grid = [];
    for (let y = 0; y < exports.WALL_GRID_HEIGHT; y++) {
        grid[y] = new Array(exports.WALL_GRID_WIDTH).fill(0);
    }
    return grid;
}
// Wall grid - populated from server data at runtime
exports.WALL_GRID = createEmptyWallGrid();
// Helper functions for wall grid coordinate conversion
function worldToTileX(worldX) {
    return Math.floor(worldX / exports.WALL_TILE_SIZE);
}
function worldToTileY(worldY) {
    return Math.floor(worldY / exports.WALL_TILE_SIZE);
}
function tileToWorldX(tileX) {
    return tileX * exports.WALL_TILE_SIZE;
}
function tileToWorldY(tileY) {
    return tileY * exports.WALL_TILE_SIZE;
}
// Get tile state at world coordinates
function getTileState(grid, worldX, worldY) {
    const tileX = worldToTileX(worldX);
    const tileY = worldToTileY(worldY);
    if (tileY < 0 || tileY >= grid.length || tileX < 0 || tileX >= (grid[0]?.length || 0)) {
        return 0; // Out of bounds = air
    }
    return grid[tileY][tileX];
}
// Set tile state at world coordinates
function setTileState(grid, worldX, worldY, state) {
    const tileX = worldToTileX(worldX);
    const tileY = worldToTileY(worldY);
    if (tileY >= 0 && tileY < grid.length && tileX >= 0 && tileX < (grid[0]?.length || 0)) {
        grid[tileY][tileX] = state;
    }
}
// Check if a point collides with a wall tile (any solid tile type)
function collidesWithWallTile(grid, worldX, worldY) {
    return isTileIdSolid(getTileState(grid, worldX, worldY));
}
// Check if a point is in water (any water-flagged tile type)
function isInWater(grid, worldX, worldY) {
    return isTileIdWater(getTileState(grid, worldX, worldY));
}
// --- Jagged Edge System (shared between client and server) ---
/** Deterministic seeded random number generator */
function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}
exports.JAGGED_MAX_OFFSET = 20;
exports.JAGGED_NUM_SEGMENTS = 7;
const JAGGED_EDGE_CACHE = new Map();
/** Check if a tile edge is exposed (adjacent tile is air, or solid adjacent to water) */
function isTileEdgeExposed(grid, tileX, tileY, edge) {
    let adjX = tileX, adjY = tileY;
    if (edge === 'top')
        adjY--;
    else if (edge === 'bottom')
        adjY++;
    else if (edge === 'left')
        adjX--;
    else if (edge === 'right')
        adjX++;
    if (adjY < 0 || adjY >= grid.length || adjX < 0 || adjX >= (grid[0]?.length || 0)) {
        return true; // Out of bounds = exposed
    }
    const adjState = grid[adjY][adjX];
    if (adjState === 0)
        return true; // Adjacent to air = exposed
    // Solid (wall-style) tiles show edges against water; water doesn't draw edges against solid.
    const currentState = grid[tileY]?.[tileX] || 0;
    if (isTileIdSolid(currentState) && isTileIdWater(adjState))
        return true;
    return false;
}
/** Generate jagged edge points for one edge of a tile */
function generateJaggedEdgePoints(tileX, tileY, edge) {
    const edgeIndex = edge === 'top' ? 0 : edge === 'bottom' ? 1 : edge === 'left' ? 2 : 3;
    const baseSeed = ((tileX * 73856093) ^ (tileY * 19349669)) + edgeIndex * 1000;
    const points = [];
    points.push({ t: 0, offset: 0 });
    const segmentLength = exports.WALL_TILE_SIZE / (exports.JAGGED_NUM_SEGMENTS + 1);
    for (let i = 1; i <= exports.JAGGED_NUM_SEGMENTS; i++) {
        const seed = baseSeed + i;
        const jitter = (seededRandom(seed) - 0.5) * segmentLength * 0.4;
        const t = Math.max(1, Math.min(exports.WALL_TILE_SIZE - 1, i * segmentLength + jitter));
        const offset = seededRandom(seed + 100) * exports.JAGGED_MAX_OFFSET;
        points.push({ t, offset });
    }
    points.push({ t: exports.WALL_TILE_SIZE, offset: 0 });
    points.sort((a, b) => a.t - b.t);
    return points;
}
/** Get jagged edge data for a tile (cached) */
function getTileJaggedEdges(grid, tileX, tileY) {
    const key = `${tileX},${tileY}`;
    const cached = JAGGED_EDGE_CACHE.get(key);
    if (cached)
        return cached;
    const edges = {
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
// --- Tile grid RLE codec (used to bundle the wall grid as a compact base64 blob) ---
/**
 * Run-length encode a flat array of 8-bit tile IDs into a base64 string.
 *
 * Wire format: a sequence of variable-length records.
 *   byte 0: high 7 bits = run length (1-127), low 1 bit = continuation flag
 *   if continuation: next 2 bytes are an extra big-endian count to add
 *   final byte: tile id (0-255)
 *
 * For typical tile grids (large air/water runs), this hits ~1% of the raw size.
 */
function encodeTileGridRLE(flat) {
    const out = [];
    let i = 0;
    const len = flat.length;
    while (i < len) {
        const v = flat[i] & 0xff;
        let run = 1;
        while (i + run < len && (flat[i + run] & 0xff) === v && run < 0x7fffff)
            run++;
        i += run;
        if (run <= 127) {
            out.push((run << 1) & 0xff, v);
        }
        else {
            // 7-bit base length + 16-bit extension; total max = 127 + 65535 = 65662 (we cap at 0x7fffff above just in case)
            while (run > 0) {
                const base = Math.min(127, run);
                const ext = Math.min(0xffff, run - base);
                if (ext > 0) {
                    out.push(((base << 1) | 1) & 0xff, (ext >> 8) & 0xff, ext & 0xff, v);
                    run -= base + ext;
                }
                else {
                    out.push((base << 1) & 0xff, v);
                    run -= base;
                }
            }
        }
    }
    return bytesToBase64(new Uint8Array(out));
}
/** Decode a base64 RLE string back into a flat Uint8Array of tile IDs. */
function decodeTileGridRLE(b64, expectedLength) {
    const buf = base64ToBytes(b64);
    const out = [];
    let p = 0;
    while (p < buf.length) {
        const header = buf[p++];
        const cont = header & 1;
        let count = header >>> 1;
        if (cont) {
            count += (buf[p++] << 8) | buf[p++];
        }
        const v = buf[p++];
        for (let k = 0; k < count; k++)
            out.push(v);
    }
    const arr = Uint8Array.from(out);
    if (expectedLength !== undefined && arr.length !== expectedLength) {
        console.warn(`[decodeTileGridRLE] length mismatch: got ${arr.length}, expected ${expectedLength}`);
    }
    return arr;
}
/** Decode a flat tile array into a 2D WallGrid of the configured dimensions. */
function tilesToWallGrid(flat, width = exports.WALL_GRID_WIDTH, height = exports.WALL_GRID_HEIGHT) {
    const grid = new Array(height);
    for (let y = 0; y < height; y++) {
        const row = new Array(width);
        const base = y * width;
        for (let x = 0; x < width; x++)
            row[x] = flat[base + x] | 0;
        grid[y] = row;
    }
    return grid;
}
/** Flatten a WallGrid into a Uint8Array (row-major). */
function wallGridToFlat(grid, width = exports.WALL_GRID_WIDTH, height = exports.WALL_GRID_HEIGHT) {
    const flat = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const row = grid[y] || [];
        for (let x = 0; x < width; x++)
            flat[y * width + x] = (row[x] | 0) & 0xff;
    }
    return flat;
}
// Tiny base64 helpers that work in both Node and the browser.
function bytesToBase64(bytes) {
    const B = globalThis.Buffer;
    if (B)
        return B.from(bytes).toString('base64');
    let bin = '';
    for (let i = 0; i < bytes.length; i++)
        bin += String.fromCharCode(bytes[i]);
    return (typeof btoa === 'function' ? btoa(bin) : '');
}
function base64ToBytes(b64) {
    const B = globalThis.Buffer;
    if (B)
        return new Uint8Array(B.from(b64, 'base64'));
    const bin = (typeof atob === 'function' ? atob(b64) : '');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** Get the maximum jagged protrusion within a range [minT, maxT] on an edge */
function getMaxJaggedOffset(points, minT, maxT) {
    let maxOffset = 0;
    for (const pt of points) {
        if (pt.t >= minT && pt.t <= maxT) {
            if (pt.offset > maxOffset)
                maxOffset = pt.offset;
        }
    }
    // Interpolate at range boundaries for segments that cross them
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i], p1 = points[i + 1];
        if (p1.t < minT || p0.t > maxT)
            continue;
        if (p0.t < minT && p1.t > minT) {
            const frac = (minT - p0.t) / (p1.t - p0.t);
            const interpOffset = p0.offset + frac * (p1.offset - p0.offset);
            if (interpOffset > maxOffset)
                maxOffset = interpOffset;
        }
        if (p0.t < maxT && p1.t > maxT) {
            const frac = (maxT - p0.t) / (p1.t - p0.t);
            const interpOffset = p0.offset + frac * (p1.offset - p0.offset);
            if (interpOffset > maxOffset)
                maxOffset = interpOffset;
        }
    }
    return maxOffset;
}
