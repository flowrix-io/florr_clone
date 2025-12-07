"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendBossMobDefeatedMessage = exports.trackDamage = void 0;
exports.handleMobDrops = handleMobDrops;
exports.updateSpecialMobCounts = updateSpecialMobCounts;
exports.addXPToPlayer = addXPToPlayer;
const express_1 = __importDefault(require("express"));
const https_1 = require("https");
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const database_1 = require("./database");
const constants_1 = require("./constants");
// Check for and migrate any plain text passwords on server startup
if (database_1.database.checkForPlainTextPasswords()) {
    console.log('[SERVER] Detecting plain text passwords, running migration...');
    const migrated = database_1.database.migratePasswords();
    console.log(`[SERVER] Password migration completed: ${migrated} passwords updated`);
}
else {
    console.log('[SERVER] All passwords are already hashed');
}
// Migrate player data from old format to new format on server startup
const migratedPlayers = database_1.database.migratePlayerData();
if (migratedPlayers > 0) {
    console.log(`[SERVER] Migrated ${migratedPlayers} players to new XP format`);
}
const petal_actions_1 = require("./petal_actions");
const petals_1 = require("./petals");
const constants_2 = require("./constants");
const server_utils_1 = require("./server_utils");
const petals_2 = require("./petals");
const mobs_1 = require("./mobs");
// Import from refactored modules
const utils_1 = require("./server/utils");
Object.defineProperty(exports, "trackDamage", { enumerable: true, get: function () { return utils_1.trackDamage; } });
Object.defineProperty(exports, "sendBossMobDefeatedMessage", { enumerable: true, get: function () { return utils_1.sendBossMobDefeatedMessage; } });
const gameState_1 = require("./server/gameState");
const itemManager_1 = require("./server/itemManager");
const playerManager_1 = require("./server/playerManager");
const crossServer_1 = require("./server/crossServer");
const enemySpawner_1 = require("./server/enemySpawner");
const app = (0, express_1.default)();
// Wrapper function for handleMobDrops that passes io (will be set up later)
let ioInstance;
function handleMobDrops(enemy) {
    (0, itemManager_1.handleMobDrops)(enemy, ioInstance);
}
// Wrapper function for updateTargetDummyDPS
function updateTargetDummyDPS() {
    if (!ioInstance)
        return; // Guard against ioInstance not being set yet
    const targetDummies = constants_2.enemies.filter(e => e.type === 'target_dummy');
    for (const dummy of targetDummies) {
        const dps = (0, utils_1.calculateDPS)(dummy);
        dummy.currentDPS = dps;
        // Send DPS update to all clients
        ioInstance.emit('targetDummyDPS', {
            enemyId: dummy.id,
            dps: dps
        });
    }
}
// Add body parser middleware for JSON
app.use(express_1.default.json());
// Add CORS middleware with specific origin
app.use((req, res, next) => {
    const origin = req.headers.origin || 'https://localhost:8080';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    }
    else {
        next();
    }
});
// Authentication endpoints
app.post('/auth/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    const user = database_1.database.createUser(username, password);
    if (user) {
        res.status(201).json({ message: 'User created successfully' });
    }
    else {
        res.status(400).json({ message: 'Username already exists' });
    }
});
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    const user = database_1.database.getUser(username, password);
    if (user) {
        // You might want to set up a session here
        res.json({ message: 'Login successful', userId: user.id });
    }
    else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});
app.post('/auth/verify', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    const user = database_1.database.getUser(username, password);
    if (user) {
        res.json({ valid: true });
    }
    else {
        res.status(401).json({ valid: false });
    }
});
app.post('/auth/logout', (req, res) => {
    // Handle any cleanup needed
    res.json({ message: 'Logged out successfully' });
});
// Cross-server player transfer endpoints - setup will be called after io is created
// Serve static files from the dist directory
app.use(express_1.default.static(path_1.default.join(__dirname, '../dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
        else if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    }
}));
// Create server based on protocol configuration
let server;
if (constants_1.USE_HTTPS) {
    try {
        server = (0, https_1.createServer)({
            key: fs_1.default.readFileSync('cert.key'),
            cert: fs_1.default.readFileSync('cert.crt')
        }, app);
        console.log(`[SERVER] Using HTTPS protocol`);
    }
    catch (error) {
        console.warn(`[SERVER] HTTPS certificates not found, falling back to HTTP`);
        server = (0, http_1.createServer)(app);
        console.log(`[SERVER] Using HTTP protocol (fallback)`);
    }
}
else {
    server = (0, http_1.createServer)(app);
    console.log(`[SERVER] Using HTTP protocol`);
}
const io = new socket_io_1.Server(server, {
    cors: {
        origin: function (origin, callback) {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin)
                return callback(null, true);
            // Use the origin of the request
            callback(null, origin);
        },
        methods: ["GET", "POST"],
        credentials: true
    }
});
// Set ioInstance for use in modules
ioInstance = io;
// Get current server port and configuration
const PORT = process.env.PORT || 3000;
const CURRENT_SERVER_PORT = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
const SERVER_CONFIGS = (0, constants_2.getServerConfigs)();
const CURRENT_SERVER_CONFIG = (0, constants_2.getServerConfigByPort)(CURRENT_SERVER_PORT) || { port: CURRENT_SERVER_PORT, host: 'localhost', name: `Server${CURRENT_SERVER_PORT}` };
// Setup cross-server transfer endpoints
(0, crossServer_1.setupTransferEndpoints)(app, io, CURRENT_SERVER_CONFIG, CURRENT_SERVER_PORT);
// Create helper functions object for enemy spawner (must be defined before functions that use it)
const enemySpawnerHelpers = {
    getPlayerViewports,
    isPositionInPlayerPetalRange,
    getEnemiesInViewportCount
};
// Remove or comment out these lines since we're not using grid generation anymore
// const MAZE_CELL_SIZE = 1000;
// const MAZE_WALL_THICKNESS = 100;
// Initialize map obstacles - using function from gameState module
const gameState_2 = require("./server/gameState");
// Update the server initialization code
// Replace the old obstacle initialization with:
constants_2.obstacles.push(...(0, gameState_2.initializeMapObstacles)());
// Viewport optimization functions
function getPlayerViewports() {
    const viewports = [];
    for (const playerId in constants_2.players) {
        const player = constants_2.players[playerId];
        if (player && player.x !== undefined && player.y !== undefined &&
            !isNaN(player.x) && !isNaN(player.y) &&
            player.x >= 0 && player.x <= constants_2.ACTUAL_WORLD_WIDTH &&
            player.y >= 0 && player.y <= constants_2.ACTUAL_WORLD_HEIGHT) {
            viewports.push({
                x: player.x - constants_2.VIEWPORT_WIDTH / 2,
                y: player.y - constants_2.VIEWPORT_HEIGHT / 2,
                width: constants_2.VIEWPORT_WIDTH,
                height: constants_2.VIEWPORT_HEIGHT
            });
        }
    }
    return viewports;
}
function isPositionInAnyViewport(x, y) {
    const viewports = getPlayerViewports();
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    for (const viewport of viewports) {
        const extendedViewport = {
            x: viewport.x - constants_2.VIEWPORT_BUFFER,
            y: viewport.y - constants_2.VIEWPORT_BUFFER,
            width: viewport.width + (constants_2.VIEWPORT_BUFFER * 2),
            height: viewport.height + (constants_2.VIEWPORT_BUFFER * 2)
        };
        if (x >= extendedViewport.x && x <= extendedViewport.x + extendedViewport.width &&
            y >= extendedViewport.y && y <= extendedViewport.y + extendedViewport.height) {
            return true;
        }
    }
    return false;
}
function isPositionInPlayerPetalRange(x, y, mobSize) {
    // Check if the mob spawn position would overlap with any player's petal range
    for (const playerId in constants_2.players) {
        const player = constants_2.players[playerId];
        if (!player || !player.loadout)
            continue;
        // Calculate player's maximum petal range
        const petalExtension = player.inputs?.petalExtension || 1.0;
        const baseRadius = 60 * petalExtension;
        // Find the largest petal size and range in the player's loadout
        let maxPetalSize = 0;
        let maxPetalRange = 1.0;
        for (const item of player.loadout) {
            if (item && item.type === 'petal' && item.petalType && item.rarity) {
                const petalStats = (0, petals_2.getPetalStats)(item.petalType, item.rarity);
                if (petalStats) {
                    const petalSize = 40 * petalStats.size;
                    maxPetalSize = Math.max(maxPetalSize, petalSize);
                    const petalRange = petalStats.range ?? 1.0;
                    maxPetalRange = Math.max(maxPetalRange, petalRange);
                }
            }
        }
        // Calculate the maximum range from player center (base radius * max range multiplier + half petal size + half mob size)
        const maxRange = (baseRadius * maxPetalRange) + (maxPetalSize / 2) + (mobSize / 2);
        // Check if the mob spawn position is within this range
        const dx = x - player.x;
        const dy = y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= maxRange) {
            return true; // Position is within petal range
        }
    }
    return false; // Position is safe from petal range
}
function getEnemiesInViewportCount() {
    const viewports = getPlayerViewports();
    // If no players are connected, count all enemies (for initial server startup)
    if (viewports.length === 0) {
        return constants_2.enemies.length;
    }
    let count = 0;
    for (const enemy of constants_2.enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            count++;
        }
    }
    return count;
}
function updateEnemyViewportStatus() {
    const currentTime = Date.now();
    for (const enemy of constants_2.enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            enemy.lastViewportCheck = currentTime;
        }
    }
}
function validatePlayerPositions() {
    // Clean up any invalid player positions that might affect viewport calculations
    for (const playerId in constants_2.players) {
        const player = constants_2.players[playerId];
        if (player) {
            // Reset invalid positions to a safe default
            if (isNaN(player.x) || isNaN(player.y) ||
                player.x < 0 || player.x > constants_2.ACTUAL_WORLD_WIDTH ||
                player.y < 0 || player.y > constants_2.ACTUAL_WORLD_HEIGHT) {
                console.log(`[SERVER] Fixing invalid position for player ${playerId}: (${player.x}, ${player.y})`);
                // Reset to center of world
                player.x = constants_2.ACTUAL_WORLD_WIDTH / 2;
                player.y = constants_2.ACTUAL_WORLD_HEIGHT / 2;
                // Notify client of position correction
                io.to(playerId).emit('positionCorrected', { x: player.x, y: player.y });
            }
        }
    }
}
function calculateCurrentDensity() {
    const playerCount = Object.keys(constants_2.players).length;
    const totalEnemies = constants_2.enemies.length;
    const enemiesInViewport = getEnemiesInViewportCount();
    if (playerCount > 0) {
        const totalViewportArea = constants_2.VIEWPORT_WITH_BUFFER_AREA * playerCount;
        const currentDensity = enemiesInViewport / totalViewportArea;
        const densityRatio = currentDensity / constants_2.ORIGINAL_ENEMY_DENSITY;
        // console.log(`[SERVER] Density Analysis:`);
        // console.log(`  Players: ${playerCount}`);
        // console.log(`  Total Enemies: ${totalEnemies}`);
        // console.log(`  Enemies in Viewport: ${enemiesInViewport}`);
        // console.log(`  Current Density: ${currentDensity.toFixed(8)} enemies/pixel²`);
        // console.log(`  Original Density: ${ORIGINAL_ENEMY_DENSITY.toFixed(8)} enemies/pixel²`);
        // console.log(`  Density Ratio: ${(densityRatio * 100).toFixed(1)}%`);
        return {
            playerCount,
            totalEnemies,
            enemiesInViewport,
            currentDensity,
            densityRatio
        };
    }
    return null;
}
function triggerViewportUpdate() {
    // console.log(`[SERVER] Triggering viewport update for ${Object.keys(players).length} players`);
    // Validate and fix any invalid player positions first
    validatePlayerPositions();
    // Force update all enemy viewport statuses
    updateEnemyViewportStatus();
    // Despawn any enemies that have been outside viewport for too long
    despawnDistantEnemies();
    // Log current enemy distribution and density analysis
    const densityInfo = calculateCurrentDensity();
    if (densityInfo) {
        console.log(`[SERVER] Viewport update: ${densityInfo.enemiesInViewport}/${densityInfo.totalEnemies} enemies in viewport`);
    }
    // Try to spawn new enemies if we're below the target count
    const playerCount = Object.keys(constants_2.players).length;
    if (playerCount > 0) {
        // Calculate target enemy count based on current viewport density
        const viewports = getPlayerViewports();
        const totalViewportArea = viewports.reduce((total, viewport) => {
            const extendedViewport = {
                x: viewport.x - constants_2.VIEWPORT_BUFFER,
                y: viewport.y - constants_2.VIEWPORT_BUFFER,
                width: viewport.width + (constants_2.VIEWPORT_BUFFER * 2),
                height: viewport.height + (constants_2.VIEWPORT_BUFFER * 2)
            };
            return total + (extendedViewport.width * extendedViewport.height);
        }, 0);
        const targetDensity = constants_2.ORIGINAL_ENEMY_COUNT / constants_2.TOTAL_WORLD_AREA;
        const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
        const currentViewportEnemies = getEnemiesInViewportCount();
        if (currentViewportEnemies < targetEnemyCount) {
            const enemiesToSpawn = Math.min(5, targetEnemyCount - currentViewportEnemies);
            let spawned = 0;
            for (let i = 0; i < enemiesToSpawn; i++) {
                const newEnemy = createEnemy();
                if (newEnemy) {
                    constants_2.enemies.push(newEnemy);
                    spawned++;
                }
            }
            if (spawned > 0) {
                console.log(`[SERVER] Player join spawn: ${spawned} enemies (target: ${targetEnemyCount}, current: ${currentViewportEnemies})`);
            }
        }
    }
}
function despawnDistantEnemies() {
    const currentTime = Date.now();
    const enemiesToRemove = [];
    for (let i = constants_2.enemies.length - 1; i >= 0; i--) {
        const enemy = constants_2.enemies[i];
        // Special mobs (ultra, super, unique) never despawn
        if (enemy.tier === 'ultra' || enemy.tier === 'super' || enemy.tier === 'unique') {
            continue;
        }
        // Target dummies never despawn
        if (enemy.type === 'target_dummy') {
            continue;
        }
        // Check if enemy is currently outside any player's viewport
        const inViewport = isPositionInAnyViewport(enemy.x, enemy.y);
        if (!inViewport) {
            // If enemy is outside viewport, update or set the last viewport check time
            if (!enemy.lastViewportCheck) {
                enemy.lastViewportCheck = currentTime;
            }
            // Despawn if enemy has been outside viewport for more than 30 seconds
            if (currentTime - enemy.lastViewportCheck > 30000) { // 30 seconds
                enemiesToRemove.push(i);
            }
        }
        else {
            // Enemy is in viewport, reset the last viewport check
            enemy.lastViewportCheck = undefined;
        }
    }
    // Remove enemies and notify clients
    for (const index of enemiesToRemove) {
        const enemy = constants_2.enemies[index];
        constants_2.enemies.splice(index, 1);
        io.emit('enemyDestroyed', enemy.id);
        // console.log(`[SERVER] Despawned enemy ${enemy.id} (${enemy.type} ${enemy.tier}) - outside viewport for 30+ seconds`);
    }
}
// createSpecialMob moved to enemySpawner module
// Wrapper functions for enemy spawner
function updateSpecialMobCounts() {
    (0, enemySpawner_1.updateSpecialMobCounts)();
}
function spawnSpecialMobs() {
    (0, enemySpawner_1.spawnSpecialMobs)(enemySpawnerHelpers, io);
}
// Wrapper for createEnemy
function createEnemy() {
    return (0, enemySpawner_1.createEnemy)(enemySpawnerHelpers);
}
// Function to spawn a specific mob with a specific rarity at optional coordinates
function spawnMob(mobType, rarity, x, y) {
    // Validate mob type
    const allMobTypes = (0, mobs_1.getAllMobTypes)();
    if (!allMobTypes.includes(mobType)) {
        console.log(`Invalid mob type: ${mobType}`);
        console.log(`Available mob types: ${allMobTypes.join(', ')}`);
        return;
    }
    // Validate rarity
    const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
    if (!validRarities.includes(rarity.toLowerCase())) {
        console.log(`Invalid rarity: ${rarity}`);
        console.log(`Valid rarities: ${validRarities.join(', ')}`);
        return;
    }
    const tier = rarity.toLowerCase();
    const mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats) {
        console.log(`No stats found for ${mobType} with rarity ${tier}`);
        return;
    }
    // Find a valid spawn position
    let validPosition = false;
    let spawnX = x;
    let spawnY = y;
    let attempts = 0;
    const MAX_ATTEMPTS = 100;
    // If coordinates are provided, validate them
    if (spawnX !== undefined && spawnY !== undefined) {
        // Validate provided coordinates
        spawnX = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, spawnX));
        spawnY = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, spawnY));
        // Check if position is in a safe zone
        const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
            spawnX >= element.x * constants_2.SCALE_FACTOR &&
            spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
            spawnY >= element.y * constants_2.SCALE_FACTOR &&
            spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
        // Check if position collides with walls
        const collidesWithWall = constants_2.WORLD_MAP.some(element => element.type === 'wall' &&
            spawnX >= element.x * constants_2.SCALE_FACTOR &&
            spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
            spawnY >= element.y * constants_2.SCALE_FACTOR &&
            spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
        if (!inSafeZone && !collidesWithWall) {
            validPosition = true;
        }
        else {
            console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) are in a safe zone or wall. Finding alternative position...`);
            spawnX = undefined;
            spawnY = undefined;
        }
    }
    // If coordinates weren't provided or were invalid, find a valid position
    if (!validPosition) {
        // Try to spawn near a player if available
        const playerIds = Object.keys(constants_2.players);
        if (playerIds.length > 0) {
            while (!validPosition && attempts < MAX_ATTEMPTS) {
                attempts++;
                const randomPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
                const player = constants_2.players[randomPlayerId];
                // Spawn within viewport of a random player
                const viewportBuffer = constants_2.VIEWPORT_BUFFER;
                const minX = player.x - constants_2.VIEWPORT_WIDTH / 2 - viewportBuffer;
                const maxX = player.x + constants_2.VIEWPORT_WIDTH / 2 + viewportBuffer;
                const minY = player.y - constants_2.VIEWPORT_HEIGHT / 2 - viewportBuffer;
                const maxY = player.y + constants_2.VIEWPORT_HEIGHT / 2 + viewportBuffer;
                spawnX = minX + Math.random() * (maxX - minX);
                spawnY = minY + Math.random() * (maxY - minY);
                // Clamp to world boundaries
                spawnX = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, spawnX));
                spawnY = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, spawnY));
                // Check if position is in a safe zone
                const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                    spawnX >= element.x * constants_2.SCALE_FACTOR &&
                    spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                    spawnY >= element.y * constants_2.SCALE_FACTOR &&
                    spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
                // Check if position collides with walls
                const collidesWithWall = constants_2.WORLD_MAP.some(element => element.type === 'wall' &&
                    spawnX >= element.x * constants_2.SCALE_FACTOR &&
                    spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                    spawnY >= element.y * constants_2.SCALE_FACTOR &&
                    spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
                if (!inSafeZone && !collidesWithWall) {
                    validPosition = true;
                }
            }
        }
        else {
            // No players online, spawn at random valid position
            while (!validPosition && attempts < MAX_ATTEMPTS) {
                attempts++;
                spawnX = Math.random() * constants_2.ACTUAL_WORLD_WIDTH;
                spawnY = Math.random() * constants_2.ACTUAL_WORLD_HEIGHT;
                // Check if position is in a safe zone
                const inSafeZone = constants_2.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                    spawnX >= element.x * constants_2.SCALE_FACTOR &&
                    spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                    spawnY >= element.y * constants_2.SCALE_FACTOR &&
                    spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
                // Check if position collides with walls
                const collidesWithWall = constants_2.WORLD_MAP.some(element => element.type === 'wall' &&
                    spawnX >= element.x * constants_2.SCALE_FACTOR &&
                    spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                    spawnY >= element.y * constants_2.SCALE_FACTOR &&
                    spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
                if (!inSafeZone && !collidesWithWall) {
                    validPosition = true;
                }
            }
        }
    }
    if (!validPosition || spawnX === undefined || spawnY === undefined) {
        console.log(`Failed to find valid spawn position for ${mobType} after ${MAX_ATTEMPTS} attempts`);
        return;
    }
    // Create the enemy
    const currentTime = Date.now();
    const enemy = {
        id: Math.random().toString(36).substr(2, 9),
        type: mobType,
        tier: tier,
        x: spawnX,
        y: spawnY,
        angle: Math.random() * Math.PI * 2,
        health: mobStats.health,
        maxHealth: mobStats.health,
        speed: mobStats.speed,
        damage: mobStats.damage,
        knockbackX: 0,
        knockbackY: 0,
        isHostile: mobStats.is_hostile,
        range: mobStats.range,
        reversed: mobStats.reversed ?? false,
        spawnTime: currentTime,
        lastViewportCheck: currentTime
    };
    // Initialize DPS tracking for target dummies
    if (mobType === 'target_dummy') {
        enemy.dpsStartTime = currentTime;
        enemy.dpsHistory = [];
        enemy.currentDPS = 0;
    }
    // Add to enemies array
    constants_2.enemies.push(enemy);
    // Notify all clients
    io.emit('enemySpawned', enemy);
    console.log(`Spawned ${tier} ${mobType} at (${Math.round(spawnX)}, ${Math.round(spawnY)})`);
}
// respawnPlayer moved to playerManager module - using wrapper function defined earlier
// Helper function to determine spawn type based on level
function getSpawnTypeForLevel(level) {
    if (level <= 5)
        return 'common';
    if (level <= 10)
        return 'uncommon';
    if (level <= 15)
        return 'rare';
    if (level <= 25)
        return 'epic';
    if (level <= 40)
        return 'legendary';
    return 'mythic';
}
// Helper functions moved to playerManager module - using imports
// Initialize enemies - now only spawn when players connect
console.log(`[SERVER] Enemy spawning system initialized - enemies will spawn when players connect`);
console.log(`[SERVER] Density Configuration:`);
console.log(`  Original Density: ${constants_2.ORIGINAL_ENEMY_DENSITY.toFixed(8)} enemies/pixel²`);
console.log(`  Target: Maintain same density as ${constants_2.ORIGINAL_ENEMY_COUNT} enemies across entire world (9x density)`);
console.log(`  Despawn Rule: Enemies outside viewport for 30+ seconds will despawn`);
// Initialize decorations
for (let i = 0; i < constants_2.DECORATION_COUNT; i++) {
    gameState_1.decorations.push((0, server_utils_1.createDecoration)());
}
// Initialize sands
for (let i = 0; i < constants_2.SAND_COUNT; i++) {
    gameState_1.sands.push((0, server_utils_1.createSand)());
}
// Skill multipliers based on rarity tier
const SKILL_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.35,
    legendary: 1.6,
    mythic: 2.0,
    ultra: 2.6,
    super: 3.3,
    unique: 4.0
};
// TP costs for each rarity tier (total = 100 TP for full tree)
const RARITY_TP_COSTS = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 5,
    legendary: 8,
    mythic: 12,
    ultra: 18,
    super: 25,
    unique: 26
};
// Functions moved to playerManager module - using imports
// Wrapper for addXPToPlayer that passes io and handles additional events
function addXPToPlayer(player, xp, socketId) {
    (0, playerManager_1.addXPToPlayer)(player, xp, socketId, ioInstance);
    // Emit xpGained event
    ioInstance.emit('xpGained', {
        playerId: player.id,
        xp: xp,
        totalXp: player.xp,
        level: player.level,
        xpToNextLevel: player.xpToNextLevel,
        maxHealth: player.maxHealth,
        damage: player.damage
    });
    // Save progress after XP gain if we have the socket ID
    if (socketId) {
        const socket = Array.from(ioInstance.sockets.sockets.values()).find((s) => s.id === socketId);
        if (socket?.userId) {
            (0, playerManager_1.savePlayerProgress)(player, socket.userId, database_1.database);
        }
    }
}
// Wrapper for respawnPlayer that passes io
function respawnPlayer(player) {
    (0, playerManager_1.respawnPlayer)(player, ioInstance);
}
// Wrapper for savePlayerProgress that passes database
function savePlayerProgress(player, userId) {
    (0, playerManager_1.savePlayerProgress)(player, userId, database_1.database);
}
io.on('connection', (socket) => {
    console.log('A user connected');
    // Send map data to the client
    socket.emit('mapData', constants_2.WORLD_MAP);
    socket.on('playerInput', (inputData) => {
        const player = constants_2.players[socket.id];
        if (player) {
            player.inputs = inputData;
        }
    });
    // Handle authentication
    socket.on('authenticate', async (credentials) => {
        const user = database_1.database.getUser(credentials.username, credentials.password);
        if (user) {
            socket.userId = user.id;
            socket.username = user.username;
            gameState_1.playerUserIds[socket.id] = user.id; // Store the mapping
            // console.log('User authenticated, loading saved progress for userId:', user.id);
            const savedProgress = database_1.database.getPlayerByUserId(user.id);
            // console.log('Loaded saved progress:', savedProgress);
            // Calculate level, maxHealth, and damage from total XP
            const totalXP = savedProgress?.totalXP || 0;
            const level = (0, playerManager_1.calculateLevelFromTotalXP)(totalXP);
            const currentLevelXP = (0, playerManager_1.calculateCurrentLevelXP)(totalXP, level);
            const baseMaxHealth = (0, playerManager_1.calculateMaxHealthFromLevel)(level);
            const baseDamage = (0, playerManager_1.calculateDamageFromLevel)(level);
            // Determine spawn position based on selected biome
            let spawnX = 200;
            let spawnY = constants_2.WORLD_HEIGHT / 2;
            if (credentials.spawnBiome && credentials.spawnBiome !== 'default') {
                const biomeSpawn = (0, playerManager_1.getSpawnPositionInBiome)(credentials.spawnBiome);
                if (biomeSpawn) {
                    spawnX = biomeSpawn.x;
                    spawnY = biomeSpawn.y;
                    console.log(`Player ${credentials.playerName} spawning in ${credentials.spawnBiome} biome`);
                }
                else {
                    console.log(`Failed to find biome ${credentials.spawnBiome}, using default spawn`);
                }
            }
            else {
                // Use default spawn logic for common spawn zones
                const validSpawnPoints = constants_2.WORLD_MAP.filter(element => element.type === 'spawn' &&
                    element.properties?.spawnType === 'common');
                if (validSpawnPoints.length > 0) {
                    const spawn = validSpawnPoints[Math.floor(Math.random() * validSpawnPoints.length)];
                    spawnX = (spawn.x + Math.random() * spawn.width) * constants_2.SCALE_FACTOR;
                    spawnY = (spawn.y + Math.random() * spawn.height) * constants_2.SCALE_FACTOR;
                }
            }
            // Initialize skills from saved progress or defaults
            const savedSkills = savedProgress?.skills || {};
            // Check if TP was explicitly saved in the database
            const hasSavedTP = savedProgress && savedProgress.tp !== undefined;
            const savedTP = hasSavedTP ? savedProgress.tp : 0;
            // Calculate TP from level (1 TP per level)
            // Count spent TP by summing costs of unlocked tiers
            const countSpentTP = (tier) => {
                if (!tier)
                    return 0;
                const index = petals_1.RARITY_LEVELS.indexOf(tier);
                if (index < 0)
                    return 0;
                // Sum costs from common up to this tier
                let total = 0;
                for (let i = 0; i <= index; i++) {
                    total += RARITY_TP_COSTS[petals_1.RARITY_LEVELS[i]];
                }
                return total;
            };
            const spentTP = countSpentTP(savedSkills.damage) + countSpentTP(savedSkills.petalHealth) +
                countSpentTP(savedSkills.playerHealth) + countSpentTP(savedSkills.healingMultiplier);
            // Use savedTP if it was explicitly saved (authoritative), otherwise calculate from level - spentTP
            // This prevents TP duplication when refreshing/re-authenticating
            const currentTP = hasSavedTP ? savedTP : Math.max(0, level - spentTP);
            // Reconstruct loadout from saved data (only type/rarity/petalType saved)
            const reconstructLoadout = (savedLoadout) => {
                if (!savedLoadout || !Array.isArray(savedLoadout)) {
                    return (0, playerManager_1.createInitialBasicPetals)().concat(Array(5).fill(null));
                }
                return savedLoadout.map((item) => {
                    if (!item || !item.type)
                        return null;
                    if (item.type === 'petal' && item.petalType) {
                        const petalStats = (0, petals_2.getPetalStats)(item.petalType, item.rarity || 'common');
                        if (petalStats) {
                            const petalHealthMultiplier = (0, playerManager_1.getSkillMultiplier)(savedSkills.petalHealth);
                            const maxHealth = Math.round(petalStats.health * petalHealthMultiplier);
                            return {
                                type: 'petal',
                                rarity: item.rarity || 'common',
                                petalType: item.petalType,
                                health: maxHealth,
                                maxHealth: maxHealth,
                                onCooldown: true
                            };
                        }
                    }
                    return item; // For non-petal items, return as-is
                });
            };
            const reconstructedLoadout = reconstructLoadout(savedProgress?.loadout);
            constants_2.players[socket.id] = {
                id: socket.id,
                name: credentials.playerName || 'Unnamed',
                x: spawnX,
                y: spawnY,
                angle: 0,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                health: Math.round(baseMaxHealth * (0, playerManager_1.getSkillMultiplier)(savedSkills.playerHealth)),
                maxHealth: Math.round(baseMaxHealth * (0, playerManager_1.getSkillMultiplier)(savedSkills.playerHealth)),
                damage: Math.round(baseDamage * (0, playerManager_1.getSkillMultiplier)(savedSkills.damage)),
                inventory: savedProgress?.inventory || (0, playerManager_1.createInitialInventory)(),
                loadout: reconstructedLoadout,
                isInvulnerable: true,
                level: level,
                xp: currentLevelXP,
                xpToNextLevel: (0, playerManager_1.calculateXPRequirement)(level),
                knockbackX: 0,
                knockbackY: 0,
                inputs: { keys: [] },
                speed_boost: 1,
                tp: currentTP,
                skills: savedSkills
            };
            // Start cooldown timers for all petals that are on cooldown
            const player = constants_2.players[socket.id];
            if (player && player.loadout) {
                for (let i = 0; i < player.loadout.length; i++) {
                    const petal = player.loadout[i];
                    if (petal && petal.type === 'petal' && petal.petalType && petal.rarity && petal.onCooldown) {
                        const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity);
                        if (petalStats) {
                            const cooldownTime = petalStats.cooldown || 10000;
                            setTimeout(() => {
                                if (constants_2.players[socket.id] && constants_2.players[socket.id].loadout[i] && constants_2.players[socket.id].loadout[i].onCooldown) {
                                    // Restore petal after cooldown
                                    const restoredPetal = {
                                        type: petal.type,
                                        petalType: petal.petalType,
                                        rarity: petal.rarity,
                                        health: petal.maxHealth,
                                        maxHealth: petal.maxHealth,
                                        onCooldown: false
                                    };
                                    // Apply petal health bonus
                                    (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, constants_2.players[socket.id]);
                                    constants_2.players[socket.id].loadout[i] = restoredPetal;
                                    io.emit('petalRestored', {
                                        playerId: constants_2.players[socket.id].id,
                                        slotIndex: i,
                                        petal: constants_2.players[socket.id].loadout[i]
                                    });
                                }
                            }, cooldownTime);
                        }
                    }
                }
            }
            // Save initial state and log the result
            // console.log('Saving initial player state');
            savePlayerProgress(constants_2.players[socket.id], user.id);
            // Trigger viewport update when new player joins
            triggerViewportUpdate();
            // Remove initial invulnerability after the specified time
            setTimeout(() => {
                if (constants_2.players[socket.id]) {
                    constants_2.players[socket.id].isInvulnerable = false;
                    // Notify client that invulnerability has ended
                    io.emit('playerInvulnerabilityEnded', { playerId: socket.id });
                }
            }, constants_2.RESPAWN_INVULNERABILITY_TIME);
            // Send success response and game state
            socket.emit('authenticated', {
                success: true,
                player: constants_2.players[socket.id]
            });
            // Send initial skills update
            socket.emit('skillsUpdated', {
                playerId: constants_2.players[socket.id].id,
                tp: constants_2.players[socket.id].tp || 0,
                skills: constants_2.players[socket.id].skills || {}
            });
            // Send current game state
            socket.emit('currentPlayers', constants_2.players);
            socket.emit('enemiesUpdate', constants_2.enemies);
            socket.emit('obstaclesUpdate', constants_2.obstacles);
            // Filter items to only send ones this player is eligible for and hasn't picked up yet
            const eligibleItems = gameState_1.items.filter(item => {
                // If item has eligibility list, check if this player is eligible
                if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                    if (!item.eligiblePlayers.includes(socket.id)) {
                        return false; // Not eligible
                    }
                }
                // Check if this player has already picked up this item
                if (item.pickedUpBy && item.pickedUpBy.has(socket.id)) {
                    return false; // Already picked up
                }
                return true;
            });
            socket.emit('itemsUpdate', eligibleItems);
            socket.emit('decorationsUpdate', gameState_1.decorations);
            socket.emit('sandsUpdate', gameState_1.sands);
            // Notify other players
            socket.broadcast.emit('newPlayer', constants_2.players[socket.id]);
        }
        else {
            socket.emit('authenticated', {
                success: false,
                error: 'Invalid credentials'
            });
        }
    });
    socket.on('disconnect', () => {
        console.log('A user disconnected');
        if (constants_2.players[socket.id] && socket.userId) {
            // console.log('Saving player progress for userId:', socket.userId);
            savePlayerProgress(constants_2.players[socket.id], socket.userId);
        }
        delete constants_2.players[socket.id];
        delete gameState_1.playerUserIds[socket.id]; // Clean up the mapping
        io.emit('playerDisconnected', socket.id);
        // Trigger viewport update when player disconnects
        triggerViewportUpdate();
    });
    socket.on('collectDot', (dotIndex) => {
        if (dotIndex >= 0 && dotIndex < constants_2.dots.length) {
            constants_2.dots.splice(dotIndex, 1);
            constants_2.players[socket.id].score++;
            io.emit('dotCollected', { playerId: socket.id, dotIndex });
            // Generate a new dot
            constants_2.dots.push({
                x: Math.random() * 800,
                y: Math.random() * 600
            });
        }
    });
    socket.on('useItem', (itemData) => {
        const player = constants_2.players[socket.id];
        if (!player)
            return;
        // For now, we don't check if the item is in the loadout on the server,
        // we trust the client. This could be improved for security.
        const item = {
            type: itemData.type,
            rarity: itemData.rarity,
            petalType: itemData.petalType,
        };
        const rarityMultipliers = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4,
            ultra: 5,
            super: 6,
            unique: 7
        };
        const speedBoostMultipliers = {
            common: 2,
            uncommon: 2.8,
            rare: 3.6,
            epic: 5.2,
            legendary: 6.8,
            mythic: 8.4,
            ultra: 10,
            super: 12,
            unique: 14
        };
        const multiplier = item.rarity ? rarityMultipliers[item.rarity] : 1;
        switch (item.type) {
            case 'health_potion':
                player.health = Math.min(player.maxHealth, player.health + (50 * multiplier));
                // console.log('Applied health potion effect:', player.health);
                break;
            case 'speed_boost':
                player.speed_boost = item.rarity ? rarityMultipliers[item.rarity] : 1;
                io.emit('speedBoostActive', player.id);
                // console.log('Applied speed boost effect');
                setTimeout(() => {
                    if (constants_2.players[socket.id]) {
                        constants_2.players[socket.id].speed_boost = 1;
                        // console.log('Speed boost wore off');
                    }
                }, 5000 * multiplier);
                break;
            case 'shield':
                player.isInvulnerable = true;
                // console.log('Applied shield effect');
                setTimeout(() => {
                    if (constants_2.players[socket.id]) {
                        constants_2.players[socket.id].isInvulnerable = false;
                        // console.log('Shield wore off');
                    }
                }, 3000 * multiplier);
                break;
            case 'petal':
                if (item.petalType === 'yggdrasil') {
                    // Yggdrasil petals are now always active - no activation needed
                    console.log(`Player ${player.name} used yggdrasil petal (always active)`);
                }
                break;
        }
        // Notify clients about the item use without removing it
        io.emit('itemUsed', {
            playerId: socket.id,
            item: itemData,
        });
        // Add cooldown to the item in player's loadout (client-side handles the visual)
        // Update the player state
        io.emit('playerUpdated', player);
    });
    // XP handling is now managed by the global addXPToPlayer function
    // Add a name update handler
    socket.on('updateName', (newName) => {
        const player = constants_2.players[socket.id];
        if (player) {
            player.name = newName;
            io.emit('playerUpdated', player);
        }
    });
    /**
     * Validates inventory structure and checks if items in loadout exist in inventory
     * When an item is equipped, it's removed from inventory, so we need to check:
     * 1. If item is newly equipped (not in old loadout), it must exist in the old inventory (before equipping)
     * 2. If item is already equipped (in old loadout), we allow it to stay (it was already validated)
     * 3. If item doesn't exist in old inventory and wasn't in old loadout, unequip it
     *
     * @param newInventory - The new inventory sent by client (after equipping changes)
     * @param newLoadout - The new loadout sent by client
     * @param oldLoadout - The previous loadout on the server
     * @param oldInventory - The previous inventory on the server (before client changes)
     * @returns A validated loadout with missing items unequipped (set to null)
     */
    function validateInventoryAndLoadout(newInventory, newLoadout, oldLoadout, oldInventory) {
        // Validate inventory structure
        if (!newInventory || typeof newInventory !== 'object') {
            console.warn('[SERVER] Invalid inventory structure, using empty inventory');
            newInventory = {};
        }
        // Create a validated copy of the loadout
        const validatedLoadout = [...newLoadout];
        let hasChanges = false;
        // Helper function to check if an item exists in inventory
        function itemExistsInInventory(inventory, item) {
            if (!item.rarity)
                return false;
            let inventoryKey;
            if (item.type === 'petal') {
                if (!item.petalType)
                    return false;
                inventoryKey = `petal_${item.petalType}`;
            }
            else {
                inventoryKey = item.type;
            }
            const rarityInventory = inventory[item.rarity];
            if (!rarityInventory || typeof rarityInventory !== 'object') {
                return false;
            }
            const itemCount = rarityInventory[inventoryKey];
            return itemCount !== undefined && itemCount !== null && itemCount > 0;
        }
        // Helper function to check if an item matches (same type, rarity, petalType)
        function itemsMatch(item1, item2) {
            if (!item1 || !item2)
                return false;
            if (item1.type !== item2.type)
                return false;
            if (item1.rarity !== item2.rarity)
                return false;
            if (item1.type === 'petal') {
                return item1.petalType === item2.petalType;
            }
            return true;
        }
        // Check each item in the new loadout
        validatedLoadout.forEach((item, index) => {
            if (!item) {
                return; // Skip null items
            }
            if (!item.rarity) {
                console.warn(`[SERVER] Item at slot ${index} missing rarity, unequipping`);
                validatedLoadout[index] = null;
                hasChanges = true;
                return;
            }
            // Check if this item was already in the old loadout
            const oldItem = oldLoadout[index];
            const wasAlreadyEquipped = itemsMatch(item, oldItem);
            if (wasAlreadyEquipped) {
                // Item was already equipped, allow it to stay (it's already removed from inventory)
                return;
            }
            // Item is newly equipped or changed - check if it exists in the old inventory
            // (before the client removed it for equipping)
            if (!itemExistsInInventory(oldInventory, item)) {
                console.warn(`[SERVER] Item ${item.type === 'petal' ? `petal_${item.petalType}` : item.type} (${item.rarity}) not found in inventory, unequipping`);
                validatedLoadout[index] = null;
                hasChanges = true;
                return;
            }
        });
        if (hasChanges) {
            console.log('[SERVER] Loadout validation: Some items were unequipped due to missing inventory');
        }
        return validatedLoadout;
    }
    socket.on('updateLoadout', (data) => {
        console.log('[SERVER] updateLoadout received from socket:', socket.id, 'player exists:', !!constants_2.players[socket.id], 'authenticated:', !!socket.username);
        const player = constants_2.players[socket.id];
        if (!player) {
            console.warn('[SERVER] updateLoadout: Player not found for socket:', socket.id);
            return;
        }
        if (!socket.username) {
            console.warn('[SERVER] updateLoadout: Socket not authenticated');
            return;
        }
        if (player) {
            // Track which slots had items before to detect changes
            const oldLoadout = player.loadout || [];
            const oldInventory = player.inventory || {};
            // IMPORTANT: Use server's inventory as source of truth, NOT client's
            // This prevents console-added items from being accepted
            const serverInventory = { ...oldInventory };
            // Validate inventory and loadout - unequip items that don't exist in inventory
            const validatedLoadout = validateInventoryAndLoadout(serverInventory, data.loadout, oldLoadout, serverInventory);
            // Calculate inventory changes based on loadout changes
            // Items that were unequipped should be added back to inventory
            // Items that were newly equipped should be removed from inventory
            oldLoadout.forEach((oldItem, index) => {
                const newItem = validatedLoadout[index];
                // Helper to get inventory key for an item
                const getInventoryKey = (item) => {
                    if (!item || !item.rarity)
                        return null;
                    if (item.type === 'petal') {
                        if (!item.petalType)
                            return null;
                        return `petal_${item.petalType}`;
                    }
                    return item.type;
                };
                // Helper to check if items match
                const itemsMatch = (item1, item2) => {
                    if (!item1 || !item2)
                        return false;
                    if (item1.type !== item2.type)
                        return false;
                    if (item1.rarity !== item2.rarity)
                        return false;
                    if (item1.type === 'petal') {
                        return item1.petalType === item2.petalType;
                    }
                    return true;
                };
                const oldKey = getInventoryKey(oldItem);
                const newKey = getInventoryKey(newItem);
                // If old item was unequipped (slot is now empty or different item)
                if (oldItem && (!newItem || !itemsMatch(oldItem, newItem))) {
                    if (oldKey && oldItem.rarity) {
                        // Add item back to inventory
                        (0, playerManager_1.addItem)(serverInventory, oldItem.rarity, oldKey, 1);
                        console.log(`[SERVER] Item ${oldKey} (${oldItem.rarity}) unequipped, added back to inventory`);
                    }
                }
                // If new item was equipped (slot had different item or was empty)
                if (newItem && (!oldItem || !itemsMatch(oldItem, newItem))) {
                    if (newKey && newItem.rarity) {
                        // Remove item from inventory (if it exists)
                        const rarityInv = serverInventory[newItem.rarity];
                        if (rarityInv && rarityInv[newKey] && rarityInv[newKey] > 0) {
                            (0, playerManager_1.removeItem)(serverInventory, newItem.rarity, newKey, 1);
                            console.log(`[SERVER] Item ${newKey} (${newItem.rarity}) equipped, removed from inventory`);
                        }
                        else {
                            console.warn(`[SERVER] Attempted to equip ${newKey} (${newItem.rarity}) but it doesn't exist in inventory`);
                        }
                    }
                }
            });
            // Apply petal health bonuses to all petals in loadout
            validatedLoadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal') {
                    (0, playerManager_1.applyPetalHealthBonus)(petal, player);
                    // Check if this is a new petal (different from old loadout) or newly equipped
                    const oldPetal = oldLoadout[index];
                    const isNewPetal = !oldPetal ||
                        oldPetal.type !== 'petal' ||
                        oldPetal.petalType !== petal.petalType ||
                        oldPetal.rarity !== petal.rarity;
                    // If it's a new petal, set it on cooldown and start the cooldown timer
                    if (isNewPetal && petal.petalType) {
                        petal.onCooldown = true;
                        const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity || 'common');
                        if (petalStats) {
                            const cooldownTime = petalStats.cooldown || 10000;
                            setTimeout(() => {
                                if (constants_2.players[socket.id] && constants_2.players[socket.id].loadout[index] &&
                                    constants_2.players[socket.id].loadout[index].onCooldown) {
                                    // Restore petal after cooldown
                                    const restoredPetal = {
                                        type: petal.type,
                                        petalType: petal.petalType,
                                        rarity: petal.rarity,
                                        health: petal.maxHealth,
                                        maxHealth: petal.maxHealth,
                                        onCooldown: false
                                    };
                                    // Apply petal health bonus
                                    (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, constants_2.players[socket.id]);
                                    constants_2.players[socket.id].loadout[index] = restoredPetal;
                                    io.emit('petalRestored', {
                                        playerId: constants_2.players[socket.id].id,
                                        slotIndex: index,
                                        petal: constants_2.players[socket.id].loadout[index]
                                    });
                                }
                            }, cooldownTime);
                        }
                    }
                }
            });
            // Use validated loadout and server's authoritative inventory
            player.loadout = validatedLoadout;
            player.inventory = serverInventory; // Use server's inventory, not client's
            io.emit('playerUpdated', player);
        }
    });
    // Add to class-level variables after other declarations
    const chatHistory = [];
    const MAX_CHAT_HISTORY = 100; // Keep last 100 messages
    // Add this inside the socket.io connection handler (after other socket handlers)
    socket.on('chatMessage', (message) => {
        if (!socket.username)
            return; // Ensure user is authenticated
        // Check for admin commands (only admins can use /admin or /cmd)
        if ((message.startsWith('/admin ') || message.startsWith('/cmd ')) && socket.username) {
            const isAdmin = database_1.database.isUserAdmin(socket.username);
            if (isAdmin) {
                // Extract the command after /admin or /cmd
                const command = message.substring(message.indexOf(' ') + 1);
                executeServerCommand(command, socket.username);
                // Send confirmation to admin
                io.to(socket.id).emit('chatMessage', {
                    sender: 'System',
                    content: `[ADMIN] Command executed: ${command}`,
                    timestamp: Date.now()
                });
                return; // Don't process as regular chat message
            }
            else {
                // Not an admin - pretend command doesn't exist
                io.to(socket.id).emit('chatMessage', {
                    sender: 'System',
                    content: 'Command does not exist.',
                    timestamp: Date.now()
                });
                return;
            }
        }
        // Check for commands
        if (message.startsWith('/')) {
            const command = message.substring(1).toLowerCase();
            if (command === 'help') {
                const isAdmin = socket.username ? database_1.database.isUserAdmin(socket.username) : false;
                let helpText = 'Available commands:\n';
                helpText += '/list_ultra - List all ultra mobs <br/>';
                helpText += '/list_super - List all super mobs <br/>';
                helpText += '/list_unique - List all unique mobs <br/>';
                helpText += '<br/>Chat supports HTML tags: <b>bold</b>, <i>italic</i>, <u>underline</u>, <span style="color: red">colored text</span>, <blink>blinking text</blink>';
                if (isAdmin) {
                    helpText += '<br/><br/>Admin commands:<br/>';
                    helpText += '/admin <command> - Execute server command\n';
                    helpText += '/cmd <command> - Execute server command (alternative)\n';
                    helpText += 'Available server commands: save, list-players, list-sockets, set_max_enemies, spawn_special_mobs, spawn <mobType> <rarity> [x] [y]';
                }
                io.to(socket.id).emit('chatMessage', {
                    sender: 'System',
                    content: helpText,
                    timestamp: Date.now()
                });
                return;
            }
            if (command === 'list_ultra') {
                // Exclude target dummies from list commands
                const ultraMobs = constants_2.enemies.filter(e => e.tier === 'ultra' && e.type !== 'target_dummy');
                if (ultraMobs.length === 0) {
                    io.emit('chatMessage', {
                        sender: 'System',
                        content: 'No ultra mobs currently spawned.',
                        timestamp: Date.now()
                    });
                }
                else {
                    ultraMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / constants_2.SCALE_FACTOR);
                        const y = Math.round(mob.y / constants_2.SCALE_FACTOR);
                        io.emit('chatMessage', {
                            sender: 'System',
                            content: `Ultra ${mob.type} at position (${x}, ${y})`,
                            timestamp: Date.now()
                        });
                        // Emit viewport animation event with delay for each mob
                        setTimeout(() => {
                            socket.emit('animateViewportToMob', {
                                x: mob.x,
                                y: mob.y,
                                mobType: mob.type,
                                rarity: 'ultra'
                            });
                        }, index * 2500); // 2.5 second delay between each mob animation
                    });
                }
                return;
            }
            if (command === 'list_super') {
                // Exclude target dummies from list commands
                const superMobs = constants_2.enemies.filter(e => e.tier === 'super' && e.type !== 'target_dummy');
                if (superMobs.length === 0) {
                    io.emit('chatMessage', {
                        sender: 'System',
                        content: 'No super mobs currently spawned.',
                        timestamp: Date.now()
                    });
                }
                else {
                    superMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / constants_2.SCALE_FACTOR);
                        const y = Math.round(mob.y / constants_2.SCALE_FACTOR);
                        io.emit('chatMessage', {
                            sender: 'System',
                            content: `Super ${mob.type} at position (${x}, ${y})`,
                            timestamp: Date.now()
                        });
                        // Emit viewport animation event with delay for each mob
                        setTimeout(() => {
                            socket.emit('animateViewportToMob', {
                                x: mob.x,
                                y: mob.y,
                                mobType: mob.type,
                                rarity: 'super'
                            });
                        }, index * 2500); // 2.5 second delay between each mob animation
                    });
                }
                return;
            }
            if (command === 'list_unique') {
                // Exclude target dummies from list commands
                const uniqueMobs = constants_2.enemies.filter(e => e.tier === 'unique' && e.type !== 'target_dummy');
                if (uniqueMobs.length === 0) {
                    io.emit('chatMessage', {
                        sender: 'System',
                        content: 'No unique mobs currently spawned.',
                        timestamp: Date.now()
                    });
                }
                else {
                    uniqueMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / constants_2.SCALE_FACTOR);
                        const y = Math.round(mob.y / constants_2.SCALE_FACTOR);
                        io.emit('chatMessage', {
                            sender: 'System',
                            content: `Unique ${mob.type} at position (${x}, ${y})`,
                            timestamp: Date.now()
                        });
                        // Emit viewport animation event with delay for each mob
                        setTimeout(() => {
                            socket.emit('animateViewportToMob', {
                                x: mob.x,
                                y: mob.y,
                                mobType: mob.type,
                                rarity: 'unique'
                            });
                        }, index * 2500); // 2.5 second delay between each mob animation
                    });
                }
                return;
            }
            // Unknown command
            io.emit('chatMessage', {
                sender: 'System',
                content: 'Unknown command. Available commands: /list_ultra, /list_super, /list_unique',
                timestamp: Date.now()
            });
            return;
        }
        const player = constants_2.players[socket.id];
        const playerName = player ? player.name : socket.username;
        const chatMessage = {
            sender: `@${socket.username}`,
            content: `[<span style="color: yellow;">${playerName}</span>] ${message}`,
            timestamp: Date.now()
        };
        // Add to history and trim if needed
        chatHistory.push(chatMessage);
        if (chatHistory.length > MAX_CHAT_HISTORY) {
            chatHistory.shift();
        }
        // Broadcast to all connected clients
        io.emit('chatMessage', chatMessage);
    });
    // Add this after socket handlers but before socket.on('authenticate'...)
    socket.on('requestChatHistory', () => {
        socket.emit('chatHistory', chatHistory);
    });
    // Handle ping/pong for heartbeat monitoring
    socket.on('ping', (clientTime) => {
        socket.emit('pong', clientTime);
    });
    // Handle respawn request
    socket.on('requestRespawn', () => {
        const player = constants_2.players[socket.id];
        if (player && player.isDead) {
            respawnPlayer(player);
            player.isDead = false;
            io.emit('playerRespawned', player);
        }
    });
    // Add to socket connection handler after other socket events
    socket.on('upgradeSkill', (data) => {
        const player = constants_2.players[socket.id];
        if (!player) {
            socket.emit('skillUpgradeError', { message: 'Player not found' });
            return;
        }
        // Initialize skills and TP if not present
        if (!player.skills) {
            player.skills = {};
        }
        if (player.tp === undefined) {
            player.tp = 0;
        }
        // Check if player has enough TP
        if (player.tp < 1) {
            socket.emit('skillUpgradeError', { message: 'Not enough Talent Points' });
            return;
        }
        // Validate skill ID
        const validSkills = ['damage', 'petalHealth', 'playerHealth', 'healingMultiplier'];
        if (!validSkills.includes(data.skillId)) {
            socket.emit('skillUpgradeError', { message: 'Invalid skill ID' });
            return;
        }
        // Validate rarity
        if (!petals_1.RARITY_LEVELS.includes(data.rarity)) {
            socket.emit('skillUpgradeError', { message: 'Invalid rarity tier' });
            return;
        }
        // Get TP cost for this tier
        const tpCost = RARITY_TP_COSTS[data.rarity] || 1;
        // Check if player has enough TP
        if (player.tp < tpCost) {
            socket.emit('skillUpgradeError', { message: `Not enough Talent Points (need ${tpCost} TP)` });
            return;
        }
        // Get current tier for this skill
        const skillKey = data.skillId;
        const currentTier = player.skills[skillKey];
        const currentIndex = currentTier ? petals_1.RARITY_LEVELS.indexOf(currentTier) : -1;
        const targetIndex = petals_1.RARITY_LEVELS.indexOf(data.rarity);
        // Check if this is the next tier in sequence
        if (targetIndex !== currentIndex + 1) {
            socket.emit('skillUpgradeError', { message: 'Must upgrade tiers in order' });
            return;
        }
        // Upgrade the skill to the new tier
        player.skills[skillKey] = data.rarity;
        player.tp -= tpCost;
        // Apply skill multipliers to player stats
        const healthMultiplier = (0, playerManager_1.getSkillMultiplier)(player.skills.playerHealth);
        const damageMultiplier = (0, playerManager_1.getSkillMultiplier)(player.skills.damage);
        player.maxHealth = Math.round((0, playerManager_1.calculateMaxHealthFromLevel)(player.level) * healthMultiplier);
        player.damage = Math.round((0, playerManager_1.calculateDamageFromLevel)(player.level) * damageMultiplier);
        // Ensure health doesn't exceed max health
        if (player.health > player.maxHealth) {
            player.health = player.maxHealth;
        }
        // Apply petal health bonuses to all equipped petals and respawn them
        if (player.loadout) {
            player.loadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal') {
                    (0, playerManager_1.applyPetalHealthBonus)(petal, player);
                    // Respawn petal (restore health to max and remove cooldown)
                    if (petal.maxHealth !== undefined) {
                        petal.health = petal.maxHealth;
                        petal.onCooldown = false;
                        // Emit petal restored event for each petal
                        io.emit('petalRestored', {
                            playerId: player.id,
                            slotIndex: index,
                            petal: petal
                        });
                    }
                }
            });
        }
        // Save progress
        if (socket.userId) {
            savePlayerProgress(player, socket.userId);
        }
        // Emit skills update
        io.emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });
        // Emit player update to sync stats
        io.emit('playerUpdated', player);
    });
    socket.on('resetSkills', () => {
        const player = constants_2.players[socket.id];
        if (!player) {
            socket.emit('skillResetError', { message: 'Player not found' });
            return;
        }
        // Count how many TP were spent (sum costs of all tiers unlocked)
        const countSpentTP = (tier) => {
            if (!tier)
                return 0;
            const index = petals_1.RARITY_LEVELS.indexOf(tier);
            if (index < 0)
                return 0;
            // Sum costs from common up to this tier
            let total = 0;
            for (let i = 0; i <= index; i++) {
                total += RARITY_TP_COSTS[petals_1.RARITY_LEVELS[i]];
            }
            return total;
        };
        const spentTP = countSpentTP(player.skills?.damage) +
            countSpentTP(player.skills?.petalHealth) +
            countSpentTP(player.skills?.playerHealth) +
            countSpentTP(player.skills?.healingMultiplier);
        // Reset all skills
        player.skills = {};
        // Refund all TP (player's level gives TP, so refund = level - current TP)
        player.tp = player.level;
        // Recalculate player stats without skill multipliers
        player.maxHealth = (0, playerManager_1.calculateMaxHealthFromLevel)(player.level);
        player.damage = (0, playerManager_1.calculateDamageFromLevel)(player.level);
        // Ensure health doesn't exceed max health
        if (player.health > player.maxHealth) {
            player.health = player.maxHealth;
        }
        // Reconstruct all petals without petal health bonuses
        if (player.loadout) {
            player.loadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal' && petal.petalType) {
                    const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity || 'common');
                    if (petalStats) {
                        petal.maxHealth = petalStats.health;
                        petal.health = petal.maxHealth;
                        petal.onCooldown = false;
                        // Emit petal restored event for each petal
                        io.emit('petalRestored', {
                            playerId: player.id,
                            slotIndex: index,
                            petal: petal
                        });
                    }
                }
            });
        }
        // Save progress
        if (socket.userId) {
            savePlayerProgress(player, socket.userId);
        }
        // Emit skills update
        io.emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });
        // Emit player update to sync stats
        io.emit('playerUpdated', player);
    });
    socket.on('craftItems', (data) => {
        try {
            console.log('[CRAFT] Craft request received:', { itemCount: data.items?.length, playerId: socket.id });
            const player = constants_2.players[socket.id];
            if (!player) {
                console.log('[CRAFT] Player not found');
                socket.emit('craftingFailed', 'Player not found');
                return;
            }
            if (!data.items || data.items.length < 5 || data.items.length % 5 !== 0) {
                console.log('[CRAFT] Invalid item count:', data.items?.length);
                socket.emit('craftingFailed', 'Invalid number of items for crafting');
                return;
            }
            const firstItem = data.items[0];
            const { type, rarity, petalType } = firstItem;
            if (!rarity) {
                console.log('[CRAFT] Missing rarity');
                socket.emit('craftingFailed', 'Items must have a rarity');
                return;
            }
            // Use the same format as when items are picked up: `${type}_${petalType}` for petals
            const itemKey = type === 'petal' && petalType ? `${type}_${petalType}` : type;
            console.log('[CRAFT] Crafting:', { type, rarity, petalType, itemKey, itemCount: data.items.length });
            const validCraft = data.items.every(item => item.type === type && item.rarity === rarity && item.petalType === petalType);
            if (!validCraft) {
                console.log('[CRAFT] Invalid craft - items not matching');
                socket.emit('craftingFailed', 'Items must be of same type and rarity');
                return;
            }
            if (!(0, playerManager_1.hasItem)(player.inventory, rarity, itemKey, data.items.length)) {
                console.log('[CRAFT] Not enough items in inventory');
                socket.emit('craftingFailed', 'Not enough items to craft');
                return;
            }
            const rarityUpgrades = {
                common: 'uncommon',
                uncommon: 'rare',
                rare: 'epic',
                epic: 'legendary',
                legendary: 'mythic',
                mythic: 'ultra',
                ultra: 'super',
                super: 'unique'
            };
            const newRarity = rarityUpgrades[rarity];
            if (!newRarity) {
                console.log('[CRAFT] Cannot upgrade unique items');
                socket.emit('craftingFailed', 'Cannot upgrade unique items');
                return;
            }
            const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
            const rarityIndex = rarities.indexOf(rarity);
            const baseChance = 64;
            const successChance = baseChance / Math.pow(2, rarityIndex);
            // Remove items from inventory - check if removal was successful
            const removed = (0, playerManager_1.removeItem)(player.inventory, rarity, itemKey, data.items.length);
            if (!removed) {
                console.log('[CRAFT] Failed to remove items from inventory');
                socket.emit('craftingFailed', 'Failed to remove items from inventory');
                return;
            }
            let successfulCrafts = 0;
            const numBatches = data.items.length / 5;
            for (let i = 0; i < numBatches; i++) {
                if (Math.random() * 100 < successChance) {
                    successfulCrafts++;
                }
            }
            if (successfulCrafts > 0) {
                (0, playerManager_1.addItem)(player.inventory, newRarity, itemKey, successfulCrafts);
                // Send global notification for super or unique petal crafts
                if ((newRarity === 'super' || newRarity === 'unique') && type === 'petal' && petalType) {
                    const petalStats = (0, petals_2.getPetalStats)(petalType, newRarity);
                    if (petalStats) {
                        const rarityColors = {
                            super: '#2bffa4',
                            unique: '#bf00ff'
                        };
                        const rarityColor = rarityColors[newRarity] || '#ffffff';
                        const petalName = petalStats.name.slice(0, -5);
                        const username = socket.username || 'Unknown';
                        const playerNickname = player.name || username;
                        io.emit('chatMessage', {
                            sender: '',
                            content: `<b style="color: ${rarityColor};">A ${petalName}has been crafted by <b style="color: #00ff00;">@${username}</b> [<b style="color: yellow;">${playerNickname}</b>]</b>`,
                            timestamp: Date.now()
                        });
                    }
                }
            }
            console.log('[CRAFT] Crafting complete:', { successfulCrafts, failCount: numBatches - successfulCrafts, newRarity });
            // Always emit craftingFinished, even if all crafts failed
            // This ensures the client gets feedback and updates inventory
            socket.emit('craftingFinished', {
                successCount: successfulCrafts,
                failCount: numBatches - successfulCrafts,
                newItem: successfulCrafts > 0 ? { type: itemKey, rarity: newRarity } : { type: itemKey, rarity: rarity },
                inventory: player.inventory
            });
            console.log('[CRAFT] craftingFinished event emitted');
        }
        catch (error) {
            console.error('[CRAFT] Error during crafting:', error);
            socket.emit('craftingFailed', 'An error occurred during crafting');
        }
    });
});
// Add these constants at the top of the file
const ENEMY_SPEED_MULTIPLIER = 2;
const ENEMY_CHASE_RANGE = 500;
const ENEMY_WANDER_RANGE = 200;
function updatePoisonEffects(deltaTime) {
    const currentTime = Date.now();
    constants_2.enemies.forEach(enemy => {
        if (!enemy.poisonEffects || enemy.poisonEffects.length === 0) {
            return;
        }
        // Calculate total poison damage from all active effects
        let totalPoisonDamage = 0;
        const activePoisons = [];
        enemy.poisonEffects.forEach(poison => {
            if (currentTime < poison.endTime) {
                // Poison is still active
                totalPoisonDamage += poison.damage;
                activePoisons.push(poison);
            }
        });
        // Update the enemy's poison effects list to only include active ones
        enemy.poisonEffects = activePoisons;
        // Apply poison damage
        if (totalPoisonDamage > 0) {
            const poisonDamageThisTick = totalPoisonDamage * deltaTime * 1000; // Convert deltaTime (seconds) to milliseconds
            enemy.health -= poisonDamageThisTick;
            // Track poison damage for all contributing players
            activePoisons.forEach(poison => {
                (0, utils_1.trackDamage)(enemy, poison.playerId, poison.damage * deltaTime * 1000);
            });
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            // Check if enemy dies from poison
            if (enemy.health <= 0) {
                const index = constants_2.enemies.findIndex(e => e.id === enemy.id);
                if (index !== -1) {
                    // Award XP to all players who contributed poison damage
                    const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                    // Find the player who dealt the most damage (including poison)
                    let topContributor;
                    let maxDamage = 0;
                    if (enemy.damageContributors) {
                        enemy.damageContributors.forEach((damage, playerId) => {
                            if (damage > maxDamage) {
                                maxDamage = damage;
                                topContributor = playerId;
                            }
                        });
                    }
                    // Award XP to the top contributor
                    if (topContributor && constants_2.players[topContributor]) {
                        addXPToPlayer(constants_2.players[topContributor], xpGained, topContributor);
                    }
                    // Handle mob drops
                    handleMobDrops(enemy);
                    (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
                    constants_2.enemies.splice(index, 1);
                    updateSpecialMobCounts();
                    io.emit('enemyDestroyed', enemy.id);
                    // Try to spawn a new enemy
                    const newEnemy = createEnemy();
                    if (newEnemy) {
                        constants_2.enemies.push(newEnemy);
                    }
                }
            }
        }
    });
}
function moveEnemies() {
    const currentTime = Date.now();
    constants_2.enemies.forEach(enemy => {
        // Apply knockback if it exists
        if (enemy.knockbackX) {
            enemy.knockbackX *= constants_2.KNOCKBACK_RECOVERY_SPEED;
            enemy.x += enemy.knockbackX;
            if (Math.abs(enemy.knockbackX) < 0.1)
                enemy.knockbackX = 0;
        }
        if (enemy.knockbackY) {
            enemy.knockbackY *= constants_2.KNOCKBACK_RECOVERY_SPEED;
            enemy.y += enemy.knockbackY;
            if (Math.abs(enemy.knockbackY) < 0.1)
                enemy.knockbackY = 0;
        }
        // Find closest living player
        let closestPlayer;
        let closestDistance = Infinity;
        // Convert players object to array and explicitly type it
        const playerArray = Object.values(constants_2.players);
        playerArray.forEach(player => {
            // Skip dead players (corpses)
            if (player.isDead) {
                return;
            }
            const dx = player.x - enemy.x;
            const dy = player.y - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestPlayer = player;
            }
        });
        // Move enemy based on behavior
        if (closestPlayer && closestDistance < (enemy.range || ENEMY_CHASE_RANGE) && enemy.isHostile) {
            // Chase player
            enemy.isChasing = true;
            const dx = closestPlayer.x - enemy.x;
            const dy = closestPlayer.y - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 0) {
                const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER;
                enemy.x += (dx / distance) * speed;
                enemy.y += (dy / distance) * speed;
                // Only update angle if mob has speed > 0
                if (enemy.speed > 0) {
                    enemy.angle = Math.atan2(dy, dx);
                }
            }
            // Check if mob can shoot projectiles
            const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
            if (mobStats?.projectile && closestPlayer) {
                const projectileConfig = mobStats.projectile;
                const lastShotTime = enemy.lastProjectileTime || 0;
                const cooldown = mobStats.cooldown || 2000;
                // Check if cooldown has passed
                if (currentTime - lastShotTime >= cooldown) {
                    // Calculate angle to player
                    const angleToPlayer = Math.atan2(dy, dx);
                    const projectileSpeed = projectileConfig.speed || 200; // pixels per second
                    const spreadAngle = projectileConfig.spreadAngle || 0.2; // radians
                    const projectileCount = projectileConfig.count || 1;
                    // Use enemy's tier/rarity for the projectile instead of hardcoded petalRarity
                    const projectileRarity = enemy.tier;
                    // Get petal stats for damage and size using enemy's rarity
                    const petalStats = (0, petals_2.getPetalStats)(projectileConfig.petalType, projectileRarity);
                    if (petalStats) {
                        // Create projectiles
                        for (let i = 0; i < projectileCount; i++) {
                            // Calculate spread angle for multiple projectiles
                            let projectileAngle = angleToPlayer;
                            if (projectileCount > 1) {
                                const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                                projectileAngle = angleToPlayer + spreadOffset;
                            }
                            const projectile = {
                                id: `${enemy.id}_projectile_${currentTime}_${i}`,
                                enemyId: enemy.id,
                                x: enemy.x,
                                y: enemy.y,
                                startX: enemy.x,
                                startY: enemy.y,
                                angle: projectileAngle,
                                speed: projectileSpeed / 1000, // Convert to pixels per millisecond
                                distance: 0,
                                maxDistance: projectileConfig.distance,
                                petalType: projectileConfig.petalType,
                                petalRarity: projectileRarity,
                                damage: petalStats.damage,
                                size: petalStats.size,
                                health: petalStats.health,
                                maxHealth: petalStats.health
                            };
                            gameState_1.mobProjectiles.push(projectile);
                        }
                        // Update last shot time
                        enemy.lastProjectileTime = currentTime;
                    }
                }
            }
        }
        else {
            // Not chasing
            enemy.isChasing = false;
            // Wander randomly
            if (!enemy.wanderTarget || currentTime - (enemy.lastWanderTime || 0) > 3000) {
                enemy.wanderTarget = {
                    x: enemy.x + (Math.random() * 2 - 1) * ENEMY_WANDER_RANGE,
                    y: enemy.y + (Math.random() * 2 - 1) * ENEMY_WANDER_RANGE
                };
                enemy.lastWanderTime = currentTime;
            }
            if (enemy.wanderTarget) {
                const dx = enemy.wanderTarget.x - enemy.x;
                const dy = enemy.wanderTarget.y - enemy.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > 5) {
                    const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER * 0.5; // Slower wandering
                    enemy.x += (dx / distance) * speed;
                    enemy.y += (dy / distance) * speed;
                    // Only update angle if mob has speed > 0
                    if (enemy.speed > 0) {
                        enemy.angle = Math.atan2(dy, dx);
                    }
                }
            }
        }
        // Get enemy size based on mob stats
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : constants_2.ENEMY_SIZE;
        const halfSize = enemySize / 2;
        // Check if enemy goes out of bounds - kill them
        if (enemy.x < 0 || enemy.x >= constants_2.ACTUAL_WORLD_WIDTH || enemy.y < 0 || enemy.y >= constants_2.ACTUAL_WORLD_HEIGHT) {
            enemy.health = 0;
            // Remove enemy immediately if out of bounds
            const index = constants_2.enemies.findIndex(e => e.id === enemy.id);
            if (index !== -1) {
                constants_2.enemies.splice(index, 1);
                io.emit('enemyDestroyed', enemy.id);
                updateSpecialMobCounts();
                // Try to spawn a new enemy to replace the one that went out of bounds
                const newEnemy = createEnemy();
                if (newEnemy) {
                    constants_2.enemies.push(newEnemy);
                }
            }
            // Skip wall collision checks if enemy is being removed
            return;
        }
        // Check for wall collisions with proper size consideration
        constants_2.WORLD_MAP.filter(constants_2.isWall).forEach(wall => {
            const scaledWall = {
                x: wall.x * constants_2.SCALE_FACTOR,
                y: wall.y * constants_2.SCALE_FACTOR,
                width: wall.width * constants_2.SCALE_FACTOR,
                height: wall.height * constants_2.SCALE_FACTOR
            };
            // Extend wall to boundaries if it's close to them
            const extendedWall = (0, utils_1.getExtendedWallForCollision)(scaledWall);
            // Check if enemy (with size) overlaps with wall
            const enemyLeft = enemy.x - halfSize;
            const enemyRight = enemy.x + halfSize;
            const enemyTop = enemy.y - halfSize;
            const enemyBottom = enemy.y + halfSize;
            const wallLeft = extendedWall.x;
            const wallRight = extendedWall.x + extendedWall.width;
            const wallTop = extendedWall.y;
            const wallBottom = extendedWall.y + extendedWall.height;
            // Check for overlap
            if (enemyRight > wallLeft && enemyLeft < wallRight &&
                enemyBottom > wallTop && enemyTop < wallBottom) {
                // Calculate overlap amounts
                const overlapLeft = enemyRight - wallLeft;
                const overlapRight = wallRight - enemyLeft;
                const overlapTop = enemyBottom - wallTop;
                const overlapBottom = wallBottom - enemyTop;
                // Find the minimum overlap to determine push direction
                const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
                // Push enemy away from wall in the direction of minimum overlap
                if (minOverlap === overlapLeft) {
                    // Push left
                    enemy.x = wallLeft - halfSize - 5; // 5px buffer
                }
                else if (minOverlap === overlapRight) {
                    // Push right
                    enemy.x = wallRight + halfSize + 5; // 5px buffer
                }
                else if (minOverlap === overlapTop) {
                    // Push up
                    enemy.y = wallTop - halfSize - 5; // 5px buffer
                }
                else if (minOverlap === overlapBottom) {
                    // Push down
                    enemy.y = wallBottom + halfSize + 5; // 5px buffer
                }
                // No boundary clamping - enemies can go out of bounds and will be killed
            }
        });
        // Check for mob-to-mob collisions (only check enemies that come after this one to avoid double-processing)
        // Only apply collision resolution if at least one mob is hostile or chasing (passive mobs don't push)
        const currentIndex = constants_2.enemies.indexOf(enemy);
        for (let i = currentIndex + 1; i < constants_2.enemies.length; i++) {
            const otherEnemy = constants_2.enemies[i];
            // Skip collision resolution if both mobs are passive and not chasing
            const thisMobIsPassive = !enemy.isHostile && !enemy.isChasing;
            const otherMobIsPassive = !otherEnemy.isHostile && !otherEnemy.isChasing;
            if (thisMobIsPassive && otherMobIsPassive) {
                continue; // Both are passive, don't push each other
            }
            // Get other enemy's size
            const otherMobStats = (0, mobs_1.getMobStats)(otherEnemy.type, otherEnemy.tier);
            const otherEnemySize = otherMobStats ? otherMobStats.size * 40 : constants_2.ENEMY_SIZE;
            const otherHalfSize = otherEnemySize / 2;
            // Calculate distance between mobs
            const dx = otherEnemy.x - enemy.x;
            const dy = otherEnemy.y - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = halfSize + otherHalfSize + 5; // 5px buffer between mobs
            // Check if mobs are colliding
            if (distance < minDistance && distance > 0) {
                // Calculate push direction (away from each other)
                const pushX = (dx / distance) * (minDistance - distance) / 2;
                const pushY = (dy / distance) * (minDistance - distance) / 2;
                // Push both mobs away from each other
                enemy.x -= pushX;
                enemy.y -= pushY;
                otherEnemy.x += pushX;
                otherEnemy.y += pushY;
                // No boundary clamping - enemies can go out of bounds and will be killed
            }
        }
    });
    io.emit('enemiesUpdate', constants_2.enemies);
}
// Update and move mob projectiles
function updateMobProjectiles(deltaTimeMs) {
    const currentTime = Date.now();
    for (let i = gameState_1.mobProjectiles.length - 1; i >= 0; i--) {
        const projectile = gameState_1.mobProjectiles[i];
        // Remove projectile if it has no health
        if (projectile.health <= 0) {
            gameState_1.mobProjectiles.splice(i, 1);
            continue;
        }
        // Move projectile (speed is already in pixels per millisecond)
        const moveDistance = projectile.speed * deltaTimeMs;
        projectile.x += Math.cos(projectile.angle) * moveDistance;
        projectile.y += Math.sin(projectile.angle) * moveDistance;
        projectile.distance += moveDistance;
        // Check if projectile has traveled max distance
        if (projectile.distance >= projectile.maxDistance) {
            gameState_1.mobProjectiles.splice(i, 1);
            continue;
        }
        // Check for wall collisions
        const projectileSize = projectile.size * 20; // Convert to pixels
        const halfSize = projectileSize / 2;
        let hitWall = false;
        constants_2.WORLD_MAP.filter(constants_2.isWall).forEach(wall => {
            const scaledWall = {
                x: wall.x * constants_2.SCALE_FACTOR,
                y: wall.y * constants_2.SCALE_FACTOR,
                width: wall.width * constants_2.SCALE_FACTOR,
                height: wall.height * constants_2.SCALE_FACTOR
            };
            // Extend wall to boundaries if it's close to them
            const extendedWall = (0, utils_1.getExtendedWallForCollision)(scaledWall);
            const projLeft = projectile.x - halfSize;
            const projRight = projectile.x + halfSize;
            const projTop = projectile.y - halfSize;
            const projBottom = projectile.y + halfSize;
            if (projRight > extendedWall.x && projLeft < extendedWall.x + extendedWall.width &&
                projBottom > extendedWall.y && projTop < extendedWall.y + extendedWall.height) {
                hitWall = true;
            }
        });
        if (hitWall) {
            gameState_1.mobProjectiles.splice(i, 1);
            continue;
        }
        // Check for collision with player petals first (treat mob projectiles as enemy petals)
        let hitPlayerPetal = false;
        const playerArray = Object.values(constants_2.players);
        for (const player of playerArray) {
            if (player.isDead || !player.loadout)
                continue;
            // Build array of petal instances considering count property
            const petalInstances = [];
            try {
                for (let loadoutIdx = 0; loadoutIdx < player.loadout.length; loadoutIdx++) {
                    const petal = player.loadout[loadoutIdx];
                    if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                        const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity);
                        if (!petalStats)
                            continue;
                        const count = petalStats.count || 1;
                        if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                            continue;
                        }
                        for (let j = 0; j < count; j++) {
                            petalInstances.push({ petal: petal, instanceIndex: j, loadoutIndex: loadoutIdx });
                        }
                    }
                }
            }
            catch (error) {
                console.error('Error building petal instances for projectile collision:', error);
                continue;
            }
            if (petalInstances.length === 0)
                continue;
            const currentTime = Date.now();
            const petalExtension = player.inputs?.petalExtension || 1.0;
            const baseRadius = 60 * petalExtension;
            const angleStep = petalInstances.length > 0 ? (Math.PI * 2) / petalInstances.length : 0;
            for (let idx = 0; idx < petalInstances.length; idx++) {
                const { petal, instanceIndex, loadoutIndex } = petalInstances[idx];
                if (!petal || !petal.health || petal.health <= 0 || petal.onCooldown) {
                    continue;
                }
                const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity);
                if (!petalStats)
                    continue;
                const rotationSpeed = (petalStats.speed ?? 1.0) * 0.002;
                const baseAngle = idx * angleStep;
                const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
                const totalAngle = baseAngle + rotationAngle;
                const petalRange = petalStats.range ?? 1.0;
                const petalRadius = baseRadius * petalRange;
                const petalX = player.x + Math.cos(totalAngle) * petalRadius;
                const petalY = player.y + Math.sin(totalAngle) * petalRadius;
                const petalSize = 40 * petalStats.size;
                const petalRadiusSize = petalSize / 2;
                const dx = projectile.x - petalX;
                const dy = projectile.y - petalY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const minDistance = halfSize + petalRadiusSize;
                if (distance < minDistance && distance > 0) {
                    // Mob projectile hits player petal - deal damage to both
                    const projectilePetalStats = (0, petals_2.getPetalStats)(projectile.petalType, projectile.petalRarity);
                    const projectileDamage = projectilePetalStats ? projectilePetalStats.damage : projectile.damage;
                    // Damage the player petal
                    petal.health -= projectileDamage;
                    // Damage the mob projectile
                    projectile.health -= petalStats.damage;
                    hitPlayerPetal = true;
                    // Remove projectile if destroyed
                    if (projectile.health <= 0) {
                        gameState_1.mobProjectiles.splice(i, 1);
                        hitPlayerPetal = true; // Mark as hit so we skip player collision check
                        break; // Exit petal loop
                    }
                    // If petal breaks, we continue to check other petals
                    // The petal breaking logic will be handled in updatePlayerState
                    break; // Exit petal loop
                }
            }
            if (hitPlayerPetal) {
                break; // Exit player loop if we hit a petal
            }
        }
        // Only check for direct player collision if we didn't hit a petal and projectile still exists
        if (!hitPlayerPetal && projectile.health > 0) {
            for (const player of playerArray) {
                if (player.isDead)
                    continue;
                const dx = player.x - projectile.x;
                const dy = player.y - projectile.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const hitRadius = constants_2.PLAYER_SIZE / 2 + halfSize;
                if (distance < hitRadius) {
                    // Hit player
                    if (!player.isInvulnerable) {
                        player.health -= projectile.damage;
                        io.emit('playerDamaged', {
                            playerId: player.id,
                            health: player.health,
                            maxHealth: player.maxHealth,
                            isInvulnerable: player.isInvulnerable
                        });
                        // Apply knockback
                        if (distance > 0) {
                            const knockbackForce = 250;
                            const normalizedDx = dx / distance;
                            const normalizedDy = dy / distance;
                            player.knockbackX = normalizedDx * knockbackForce;
                            player.knockbackY = normalizedDy * knockbackForce;
                        }
                        // Check if player dies
                        if (player.health <= 0) {
                            player.isDead = true;
                            player.health = 0;
                            io.emit('playerDied', { playerId: player.id });
                        }
                    }
                    // Remove projectile after hitting player
                    gameState_1.mobProjectiles.splice(i, 1);
                    break;
                }
            }
        }
    }
    // Emit projectile updates to clients
    io.emit('mobProjectilesUpdate', gameState_1.mobProjectiles);
}
// Update and move player projectiles
function updatePlayerProjectiles(deltaTimeMs) {
    const currentTime = Date.now();
    for (let i = gameState_1.playerProjectiles.length - 1; i >= 0; i--) {
        const projectile = gameState_1.playerProjectiles[i];
        // Remove projectile if it has no health
        if (projectile.health <= 0) {
            gameState_1.playerProjectiles.splice(i, 1);
            continue;
        }
        // Move projectile
        const moveDistance = projectile.speed * deltaTimeMs;
        projectile.x += Math.cos(projectile.angle) * moveDistance;
        projectile.y += Math.sin(projectile.angle) * moveDistance;
        projectile.distance += moveDistance;
        // Check if projectile has traveled max distance
        if (projectile.distance >= projectile.maxDistance) {
            gameState_1.playerProjectiles.splice(i, 1);
            continue;
        }
        // Check for wall collisions
        const projectileSize = projectile.size * 20; // Convert to pixels
        const halfSize = projectileSize / 2;
        let hitWall = false;
        constants_2.WORLD_MAP.filter(constants_2.isWall).forEach(wall => {
            const scaledWall = {
                x: wall.x * constants_2.SCALE_FACTOR,
                y: wall.y * constants_2.SCALE_FACTOR,
                width: wall.width * constants_2.SCALE_FACTOR,
                height: wall.height * constants_2.SCALE_FACTOR
            };
            // Extend wall to boundaries if it's close to them
            const extendedWall = (0, utils_1.getExtendedWallForCollision)(scaledWall);
            const projLeft = projectile.x - halfSize;
            const projRight = projectile.x + halfSize;
            const projTop = projectile.y - halfSize;
            const projBottom = projectile.y + halfSize;
            if (projRight > extendedWall.x && projLeft < extendedWall.x + extendedWall.width &&
                projBottom > extendedWall.y && projTop < extendedWall.y + extendedWall.height) {
                hitWall = true;
            }
        });
        if (hitWall) {
            gameState_1.playerProjectiles.splice(i, 1);
            continue;
        }
        // Check for collision with mob projectiles (projectile vs projectile)
        for (let mobProjIdx = gameState_1.mobProjectiles.length - 1; mobProjIdx >= 0; mobProjIdx--) {
            const mobProjectile = gameState_1.mobProjectiles[mobProjIdx];
            // Skip destroyed projectiles
            if (!mobProjectile || mobProjectile.health <= 0) {
                continue;
            }
            const mobProjSize = mobProjectile.size * 20;
            const mobProjHalfSize = mobProjSize / 2;
            const dx = mobProjectile.x - projectile.x;
            const dy = mobProjectile.y - projectile.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = halfSize + mobProjHalfSize;
            if (distance < minDistance && distance > 0) {
                // Player projectile hits mob projectile - deal damage to both
                const playerProjPetalStats = (0, petals_2.getPetalStats)(projectile.petalType, projectile.petalRarity);
                const playerProjDamage = playerProjPetalStats ? playerProjPetalStats.damage : projectile.damage;
                const mobProjPetalStats = (0, petals_2.getPetalStats)(mobProjectile.petalType, mobProjectile.petalRarity);
                const mobProjDamage = mobProjPetalStats ? mobProjPetalStats.damage : mobProjectile.damage;
                // Damage both projectiles
                projectile.health -= mobProjDamage;
                mobProjectile.health -= playerProjDamage;
                // Remove projectiles if destroyed
                if (projectile.health <= 0) {
                    gameState_1.playerProjectiles.splice(i, 1);
                    break; // Exit mob projectile loop
                }
                if (mobProjectile.health <= 0) {
                    gameState_1.mobProjectiles.splice(mobProjIdx, 1);
                }
            }
        }
        // Skip enemy collision if projectile was destroyed
        if (projectile.health <= 0) {
            continue;
        }
        // Check for enemy collisions
        for (let j = constants_2.enemies.length - 1; j >= 0; j--) {
            const enemy = constants_2.enemies[j];
            const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
            const enemySize = mobStats ? mobStats.size * 40 : constants_2.ENEMY_SIZE;
            const enemyHalfSize = enemySize / 2;
            const dx = enemy.x - projectile.x;
            const dy = enemy.y - projectile.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const hitRadius = enemyHalfSize + halfSize;
            if (distance < hitRadius) {
                // Hit enemy
                const player = constants_2.players[projectile.playerId];
                if (!player) {
                    // Player disconnected, remove projectile
                    gameState_1.playerProjectiles.splice(i, 1);
                    break;
                }
                const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
                const finalDamage = projectile.damage * damageMultiplier;
                (0, utils_1.trackDamage)(enemy, projectile.playerId, finalDamage);
                enemy.health -= finalDamage;
                io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                // Apply knockback, accounting for mass (heavier mobs are harder to knock back)
                if (distance > 0) {
                    const knockbackForce = 20;
                    const normalizedDx = dx / distance;
                    const normalizedDy = dy / distance;
                    // Mass is already calculated from size (which includes rarity), so higher rarity = more mass
                    const mobMass = mobStats ? mobStats.mass : 1.0; // Default mass of 1.0 if mobStats is null
                    const effectiveKnockback = knockbackForce / mobMass; // Divide by mass so heavier mobs resist knockback more
                    enemy.knockbackX = normalizedDx * effectiveKnockback;
                    enemy.knockbackY = normalizedDy * effectiveKnockback;
                }
                // Check if enemy dies
                if (enemy.health <= 0) {
                    const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                    addXPToPlayer(player, xpGained, projectile.playerId);
                    handleMobDrops(enemy);
                    (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
                    updateSpecialMobCounts();
                    constants_2.enemies.splice(j, 1);
                    io.emit('enemyDestroyed', enemy.id);
                }
                // Remove projectile after hitting enemy
                gameState_1.playerProjectiles.splice(i, 1);
                break;
            }
        }
    }
    // Emit projectile updates to clients
    io.emit('playerProjectilesUpdate', gameState_1.playerProjectiles);
}
function updatePlayerState(player, deltaTime) {
    if (!player || !player.inputs) {
        return;
    }
    // Don't update movement for dead players
    if (player.isDead) {
        return;
    }
    // Update player effects
    (0, petal_actions_1.updatePlayerEffects)(player, deltaTime);
    let targetVelocityX = 0;
    let targetVelocityY = 0;
    if (player.inputs.useMouse &&
        player.inputs.mouseDirectionX !== undefined &&
        player.inputs.mouseDirectionY !== undefined &&
        player.inputs.mouseSpeedMultiplier !== undefined) {
        // Client has already calculated the direction and speed multiplier
        // Server just needs to apply MAX_SPEED, speed_boost, and other multipliers
        const speed = constants_2.MAX_SPEED * player.speed_boost * (0, petal_actions_1.getSpeedMultiplier)(player) * player.inputs.mouseSpeedMultiplier;
        targetVelocityX = player.inputs.mouseDirectionX * speed;
        targetVelocityY = player.inputs.mouseDirectionY * speed;
        player.angle = Math.atan2(player.inputs.mouseDirectionY, player.inputs.mouseDirectionX);
    }
    else if (player.inputs.keys) {
        if (player.inputs.keys.includes('ArrowLeft') || player.inputs.keys.includes('a'))
            targetVelocityX -= 1;
        if (player.inputs.keys.includes('ArrowRight') || player.inputs.keys.includes('d'))
            targetVelocityX += 1;
        if (player.inputs.keys.includes('ArrowUp') || player.inputs.keys.includes('w'))
            targetVelocityY -= 1;
        if (player.inputs.keys.includes('ArrowDown') || player.inputs.keys.includes('s'))
            targetVelocityY += 1;
        if (targetVelocityX !== 0 && targetVelocityY !== 0) {
            const length = Math.sqrt(targetVelocityX * targetVelocityX + targetVelocityY * targetVelocityY);
            targetVelocityX /= length;
            targetVelocityY /= length;
        }
        const speed = constants_2.MAX_SPEED * player.speed_boost * (0, petal_actions_1.getSpeedMultiplier)(player);
        targetVelocityX *= speed;
        targetVelocityY *= speed;
        if (targetVelocityX !== 0 || targetVelocityY !== 0) {
            player.angle = Math.atan2(targetVelocityY, targetVelocityX);
        }
    }
    player.velocityX = targetVelocityX;
    player.velocityY = targetVelocityY;
    let newX = player.x + player.velocityX * deltaTime;
    let newY = player.y + player.velocityY * deltaTime;
    // Check if player goes out of bounds - kill them
    if (newX < 0 || newX >= constants_2.ACTUAL_WORLD_WIDTH || newY < 0 || newY >= constants_2.ACTUAL_WORLD_HEIGHT) {
        player.health = 0;
        player.killedBy = { type: 'out_of_bounds', tier: 'common' };
        // Don't update position, let them die at the boundary
        newX = player.x;
        newY = player.y;
    }
    for (const element of constants_2.WORLD_MAP) {
        if (element.type === 'wall' && element.width > 0 && element.height > 0) {
            const wallX = element.x * constants_2.SCALE_FACTOR;
            const wallY = element.y * constants_2.SCALE_FACTOR;
            const wallWidth = element.width * constants_2.SCALE_FACTOR;
            const wallHeight = element.height * constants_2.SCALE_FACTOR;
            // Extend wall to boundaries if it's close to them
            const extendedWall = (0, utils_1.getExtendedWallForCollision)({
                x: wallX,
                y: wallY,
                width: wallWidth,
                height: wallHeight
            });
            if (newX < extendedWall.x + extendedWall.width &&
                newX + constants_2.PLAYER_SIZE > extendedWall.x &&
                newY < extendedWall.y + extendedWall.height &&
                newY + constants_2.PLAYER_SIZE > extendedWall.y) {
                const overlapX = (newX + constants_2.PLAYER_SIZE / 2) - (extendedWall.x + extendedWall.width / 2);
                const overlapY = (newY + constants_2.PLAYER_SIZE / 2) - (extendedWall.y + extendedWall.height / 2);
                const combinedHalfWidths = constants_2.PLAYER_SIZE / 2 + extendedWall.width / 2;
                const combinedHalfHeights = constants_2.PLAYER_SIZE / 2 + extendedWall.height / 2;
                if (Math.abs(overlapX) < combinedHalfWidths && Math.abs(overlapY) < combinedHalfHeights) {
                    const penX = combinedHalfWidths - Math.abs(overlapX);
                    const penY = combinedHalfHeights - Math.abs(overlapY);
                    const oldX = newX;
                    const oldY = newY;
                    if (penX < penY) {
                        if (overlapX > 0)
                            newX += penX;
                        else
                            newX -= penX;
                    }
                    else {
                        if (overlapY > 0)
                            newY += penY;
                        else
                            newY -= penY;
                    }
                    // Debug: Log wall collision
                    // console.log(`[SERVER] Player ${player.id} wall collision: wall(${wallX.toFixed(1)}, ${wallY.toFixed(1)}, ${wallWidth.toFixed(1)}x${wallHeight.toFixed(1)}) player moved (${oldX.toFixed(1)}, ${oldY.toFixed(1)}) -> (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
                }
            }
        }
    }
    let collision = false;
    for (const enemy of constants_2.enemies) {
        // Get enemy size based on mob stats
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : constants_2.ENEMY_SIZE;
        const enemyRadius = enemySize / 2;
        const playerRadius = constants_2.PLAYER_SIZE / 2;
        // Use circular hitbox collision (matching mob-to-mob collision)
        // Both player and enemy positions are center points
        const dx = enemy.x - newX;
        const dy = enemy.y - newY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = enemyRadius + playerRadius;
        if (distance < minDistance && distance > 0) {
            collision = true;
            // Don't damage dead players (corpses)
            if (!player.isDead) {
                // Calculate knockback direction (reuse distance calculation from collision check)
                // Apply knockback for all enemies, including item spawner
                const normalizedDx = dx / distance;
                const normalizedDy = dy / distance;
                const knockbackDistance = 25;
                const knockbackX = -normalizedDx * knockbackDistance;
                const knockbackY = -normalizedDy * knockbackDistance;
                // Apply knockback to player position
                newX -= normalizedDx * knockbackDistance;
                newY -= normalizedDy * knockbackDistance;
                // Item spawner doesn't deal damage to players, but still applies knockback
                if (enemy.type !== 'item_spawner') {
                    const shieldAmount = (0, petal_actions_1.getShieldAmount)(player);
                    const damageToPlayer = Math.max(0, enemy.damage - shieldAmount);
                    player.health -= damageToPlayer;
                    player.lastDamageTime = Date.now();
                    player.isInvulnerable = true;
                    // Track which enemy dealt the killing blow
                    if (player.health <= 0) {
                        player.killedBy = { type: enemy.type, tier: enemy.tier };
                    }
                    // Set invulnerability timer (1 second after taking damage)
                    setTimeout(() => {
                        if (constants_2.players[player.id]) {
                            constants_2.players[player.id].isInvulnerable = false;
                            // Notify client that invulnerability has ended
                            io.emit('playerInvulnerabilityEnded', { playerId: player.id });
                        }
                    }, 1000);
                    io.emit('playerDamaged', {
                        playerId: player.id,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        isInvulnerable: player.isInvulnerable,
                        knockbackX: knockbackX,
                        knockbackY: knockbackY
                    });
                }
                else {
                    // Emit knockback event for item spawner (without damage)
                    io.emit('playerDamaged', {
                        playerId: player.id,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        isInvulnerable: player.isInvulnerable,
                        knockbackX: knockbackX,
                        knockbackY: knockbackY
                    });
                }
                // Track damage dealt by this player (even for item spawner, so players can still damage it)
                (0, utils_1.trackDamage)(enemy, player.id, player.damage);
                enemy.health -= player.damage;
                io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                if (enemy.health <= 0) {
                    const index = constants_2.enemies.findIndex(e => e.id === enemy.id);
                    if (index !== -1) {
                        const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                        addXPToPlayer(player, xpGained, player.id);
                        // Handle mob drops using the new drop table system
                        handleMobDrops(enemy);
                        (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
                        constants_2.enemies.splice(index, 1);
                        updateSpecialMobCounts();
                        io.emit('enemyDestroyed', enemy.id);
                        // Try to spawn a new enemy, but only if we can find a valid position
                        const newEnemy = createEnemy();
                        if (newEnemy) {
                            constants_2.enemies.push(newEnemy);
                        }
                    }
                }
                if (player.health <= 0) {
                    break;
                }
            }
            break;
        }
    }
    // Check for petal-enemy collisions
    if (player.loadout) {
        // Build array of petal instances considering count property
        const petalInstances = [];
        try {
            for (let i = 0; i < player.loadout.length; i++) {
                const petal = player.loadout[i];
                if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                    const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity);
                    if (!petalStats)
                        continue;
                    const count = petalStats.count || 1; // Use count from stats, default to 1
                    // Validate count is a valid number
                    if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                        console.warn('Invalid petal count:', count, 'for', petal.petalType, petal.rarity);
                        continue;
                    }
                    // Create multiple instances based on count
                    for (let j = 0; j < count; j++) {
                        petalInstances.push({ petal, instanceIndex: j, loadoutIndex: i });
                        // Execute petal actions immediately when spawned
                        if (petalStats.actions) {
                            const petalId = `${player.id}_${i}_${j}`;
                            const actionContext = {
                                player: player,
                                petalX: player.x, // Will be updated with actual position in game loop
                                petalY: player.y, // Will be updated with actual position in game loop
                                petalSize: petalStats.size * 40,
                                petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                                enemies: constants_2.enemies,
                                io: io,
                                petalId: petalId,
                                loadoutIndex: i,
                                instanceIndex: j
                            };
                            (0, petal_actions_1.executePetalActionsOnSpawn)(petalStats.actions, actionContext);
                        }
                    }
                }
            }
        }
        catch (error) {
            console.error('Error building petal instances:', error);
        }
        const currentTime = Date.now();
        const petalExtension = player.inputs.petalExtension || 1.0;
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = petalInstances.length > 0 ? (Math.PI * 2) / petalInstances.length : 0;
        for (let idx = 0; idx < petalInstances.length; idx++) {
            const { petal, instanceIndex, loadoutIndex } = petalInstances[idx];
            if (!petal || !petal.health || petal.health <= 0) {
                continue;
            }
            // Skip petals that are on cooldown
            if (petal.onCooldown) {
                continue;
            }
            const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity);
            if (!petalStats)
                continue;
            const rotationSpeed = (petalStats.speed ?? 1.0) * 0.002; // Convert to radians per ms
            const baseAngle = idx * angleStep;
            const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
            const totalAngle = baseAngle + rotationAngle;
            // Apply petal range multiplier to base radius
            const petalRange = petalStats.range ?? 1.0;
            const petalRadius = baseRadius * petalRange;
            const petalX = player.x + Math.cos(totalAngle) * petalRadius;
            const petalY = player.y + Math.sin(totalAngle) * petalRadius;
            // Update petal position in action context
            const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
            (0, petal_actions_1.updatePetalPosition)(petalId, petalX, petalY);
            // Check if petal can shoot projectiles (only when extended)
            if (petalExtension > 1.0 && petalStats.projectile) {
                const projectileConfig = petalStats.projectile;
                const lastShotTime = gameState_1.petalLastProjectileTime.get(petalId) || 0;
                const cooldown = petalStats.cooldown || 2000;
                // Check if cooldown has passed
                if (currentTime - lastShotTime >= cooldown) {
                    // Calculate projectile angle - shoot in the direction the petal is facing (tangent to rotation)
                    // The petal is at totalAngle, so the projectile should go in that direction
                    const projectileAngle = totalAngle;
                    const projectileSpeed = projectileConfig.speed || 200; // pixels per second
                    const spreadAngle = projectileConfig.spreadAngle || 0.2; // radians
                    const projectileCount = projectileConfig.count || 1;
                    // Create projectiles
                    for (let i = 0; i < projectileCount; i++) {
                        // Calculate spread angle for multiple projectiles
                        let finalAngle = projectileAngle;
                        if (projectileCount > 1) {
                            const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                            finalAngle = projectileAngle + spreadOffset;
                        }
                        const projectile = {
                            id: `${petalId}_projectile_${currentTime}_${i}`,
                            playerId: player.id,
                            x: petalX,
                            y: petalY,
                            startX: petalX,
                            startY: petalY,
                            angle: finalAngle,
                            speed: projectileSpeed / 1000, // Convert to pixels per millisecond
                            distance: 0,
                            maxDistance: projectileConfig.distance,
                            petalType: petal.petalType,
                            petalRarity: petal.rarity,
                            damage: petalStats.damage,
                            size: petalStats.size,
                            health: petalStats.health,
                            maxHealth: petalStats.health
                        };
                        gameState_1.playerProjectiles.push(projectile);
                    }
                    // Update last shot time for this petal instance
                    gameState_1.petalLastProjectileTime.set(petalId, currentTime);
                }
            }
            // Check collision with enemies
            for (const enemy of constants_2.enemies) {
                // Get mob stats to determine proper hitbox size
                const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                const enemySize = mobStats ? mobStats.size * 40 : constants_2.ENEMY_SIZE; // Use mob size or fallback to base size
                const petalSize = 40 * petalStats.size; // Use same base size as enemies for consistency
                // Use circular hitbox collision (matching player-to-mob and mob-to-mob collision)
                // Both petal and enemy positions are center points
                const enemyRadius = enemySize / 2;
                const petalRadius = petalSize / 2;
                const dx = enemy.x - petalX;
                const dy = enemy.y - petalY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const minDistance = enemyRadius + petalRadius;
                if (distance < minDistance && distance > 0) {
                    // Petal hits enemy - deal damage to both
                    const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
                    const finalDamage = petalStats.damage * damageMultiplier;
                    // Track damage dealt by this player
                    (0, utils_1.trackDamage)(enemy, player.id, finalDamage);
                    enemy.health -= finalDamage;
                    petal.health -= mobStats ? mobStats.damage : 1; // Petal loses health equal to mob damage, fallback to 1 if mobStats is null
                    // Apply poison effect if the petal has poison
                    if (petalStats.poison && petalStats.poison > 0 && petalStats.poisonDuration && petalStats.poisonDuration > 0) {
                        if (!enemy.poisonEffects) {
                            enemy.poisonEffects = [];
                        }
                        // Add or refresh poison effect
                        const currentTime = Date.now();
                        const endTime = currentTime + petalStats.poisonDuration;
                        // Check if there's already a poison effect from this player
                        const existingPoisonIndex = enemy.poisonEffects.findIndex(p => p.playerId === player.id);
                        if (existingPoisonIndex >= 0) {
                            // Refresh the existing poison effect with the new damage and duration
                            enemy.poisonEffects[existingPoisonIndex] = {
                                damage: petalStats.poison,
                                endTime: endTime,
                                playerId: player.id
                            };
                        }
                        else {
                            // Add a new poison effect
                            enemy.poisonEffects.push({
                                damage: petalStats.poison,
                                endTime: endTime,
                                playerId: player.id
                            });
                        }
                    }
                    // Apply knockback to enemy
                    const knockbackForce = petalStats.knockback || 0;
                    if (knockbackForce > 0) {
                        // Calculate knockback direction from petal to enemy
                        const dx = enemy.x - petalX;
                        const dy = enemy.y - petalY;
                        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                        const normalizedDx = dx / distance;
                        const normalizedDy = dy / distance;
                        // Apply knockback to enemy, accounting for mass (heavier mobs are harder to knock back)
                        // Mass is already calculated from size (which includes rarity), so higher rarity = more mass
                        const mobMass = mobStats ? mobStats.mass : 1.0; // Default mass of 1.0 if mobStats is null
                        const effectiveKnockback = knockbackForce / mobMass; // Divide by mass so heavier mobs resist knockback more
                        enemy.knockbackX = normalizedDx * effectiveKnockback;
                        enemy.knockbackY = normalizedDy * effectiveKnockback;
                    }
                    io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                    // Check if item spawner was hit and has 1% chance to spawn a random petal
                    if (enemy.type === 'item_spawner' && Math.random() < 0.01) {
                        // Get all petal types and filter out admin petals
                        const allPetalTypes = (0, petals_2.getAllPetalTypes)();
                        const nonAdminPetalTypes = allPetalTypes.filter(petalType => {
                            // Check if the petal is an admin petal by checking any rarity
                            const commonStats = (0, petals_2.getPetalStats)(petalType, 'common');
                            return !commonStats?.isAdminPetal;
                        });
                        if (nonAdminPetalTypes.length > 0) {
                            // Pick a random petal type
                            const randomPetalType = nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)];
                            // Pick a random rarity with weighted probabilities (rarer items are much rarer)
                            // Weighted distribution: common is most common, rarer items are exponentially rarer
                            const rarityWeights = {
                                'common': 30.0, // 50%
                                'uncommon': 10.0, // 20%
                                'rare': 10.0, // 12%
                                'epic': 5.0, // 8%
                                'legendary': 5.0, // 5%
                                'mythic': 5.0, // 3%
                                'ultra': 5.0, // 1.5%
                                'super': 5.0, // 0.4%
                                'unique': 0.05 // 0.1%
                            };
                            // Calculate total weight
                            const totalWeight = petals_1.RARITY_LEVELS.reduce((sum, rarity) => sum + (rarityWeights[rarity] || 0), 0);
                            // Pick a rarity based on weighted probability
                            let randomRarity = 'common'; // Default fallback
                            const random = Math.random() * totalWeight;
                            let cumulativeWeight = 0;
                            for (const rarity of petals_1.RARITY_LEVELS) {
                                cumulativeWeight += rarityWeights[rarity] || 0;
                                if (random <= cumulativeWeight) {
                                    randomRarity = rarity;
                                    break;
                                }
                            }
                            // Calculate spawner's hitbox radius to ensure items spawn outside it
                            const spawnerMobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                            const spawnerSize = spawnerMobStats ? spawnerMobStats.size * 40 : constants_2.ENEMY_SIZE;
                            const spawnerRadius = spawnerSize / 2;
                            const minSpawnDistance = spawnerRadius + 30; // Spawn at least 30px outside the hitbox
                            const maxSpawnDistance = spawnerRadius + 100; // Spawn up to 100px away
                            // Spawn item at a random angle and distance outside the spawner's hitbox
                            const spawnAngle = Math.random() * Math.PI * 2;
                            const spawnDistance = minSpawnDistance + Math.random() * (maxSpawnDistance - minSpawnDistance);
                            const offsetX = Math.cos(spawnAngle) * spawnDistance;
                            const offsetY = Math.sin(spawnAngle) * spawnDistance;
                            const itemId = Math.random().toString(36).substr(2, 9);
                            const spawnTime = Date.now();
                            const newItem = {
                                id: itemId,
                                type: 'petal',
                                x: enemy.x + offsetX,
                                y: enemy.y + offsetY,
                                rarity: randomRarity,
                                petalType: randomPetalType,
                                eligiblePlayers: [player.id], // Only the player who hit it can pick it up
                                pickedUpBy: new Set(),
                                spawnTime: spawnTime
                            };
                            // Check and fix wall collisions before adding item
                            (0, utils_1.checkItemWallCollisions)(newItem);
                            gameState_1.items.push(newItem);
                            // Send itemSpawned event to the player
                            io.to(player.id).emit('itemSpawned', newItem);
                            // Schedule automatic removal after expiration time
                            const expirationTime = gameState_1.ITEM_EXPIRATION_TIMES[randomRarity] || 10000;
                            setTimeout(() => {
                                const itemIndex = gameState_1.items.findIndex(item => item.id === itemId);
                                if (itemIndex !== -1) {
                                    const expiredItem = gameState_1.items[itemIndex];
                                    gameState_1.items.splice(itemIndex, 1);
                                    // Notify the player that item expired
                                    io.to(player.id).emit('itemRemoved', itemId);
                                    console.log(`[ITEM_SPAWNER] Petal ${randomPetalType} (${randomRarity}) expired after ${expirationTime}ms`);
                                }
                            }, expirationTime);
                            console.log(`[ITEM_SPAWNER] Spawned random petal: ${randomPetalType} (${randomRarity}) for player ${player.name}`);
                        }
                    }
                    // Check collision with mob projectiles (treat them as enemy petals)
                    for (let projIdx = gameState_1.mobProjectiles.length - 1; projIdx >= 0; projIdx--) {
                        const mobProjectile = gameState_1.mobProjectiles[projIdx];
                        // Skip destroyed projectiles
                        if (!mobProjectile || mobProjectile.health <= 0) {
                            continue;
                        }
                        const projectileSize = mobProjectile.size * 20; // Convert to pixels
                        const projectileRadius = projectileSize / 2;
                        const petalSize = 40 * petalStats.size;
                        const petalRadius = petalSize / 2;
                        const dx = mobProjectile.x - petalX;
                        const dy = mobProjectile.y - petalY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const minDistance = projectileRadius + petalRadius;
                        if (distance < minDistance && distance > 0) {
                            // Player petal hits mob projectile - deal damage to both
                            const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
                            const finalDamage = petalStats.damage * damageMultiplier;
                            // Damage the mob projectile
                            mobProjectile.health -= finalDamage;
                            // Damage the player petal (mob projectile acts as enemy petal)
                            const projectilePetalStats = (0, petals_2.getPetalStats)(mobProjectile.petalType, mobProjectile.petalRarity);
                            const projectileDamage = projectilePetalStats ? projectilePetalStats.damage : mobProjectile.damage;
                            petal.health -= projectileDamage;
                            // Remove projectile if destroyed
                            if (mobProjectile.health <= 0) {
                                gameState_1.mobProjectiles.splice(projIdx, 1);
                            }
                        }
                    }
                    // Handle petal collision for wait_until_collision actions
                    const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
                    const collisionContext = {
                        player: player,
                        petalX: petalX,
                        petalY: petalY,
                        petalSize: petalSize,
                        petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                        enemies: constants_2.enemies,
                        io: io,
                        petalId: petalId,
                        loadoutIndex: loadoutIndex,
                        instanceIndex: instanceIndex
                    };
                    (0, petal_actions_1.handlePetalCollision)(petalId, collisionContext);
                    // Check if petal breaks
                    if (petal.health <= 0) {
                        // Execute petal actions before breaking
                        if (petalStats.actions) {
                            const actionContext = {
                                player: player,
                                petalX: petalX,
                                petalY: petalY,
                                petalSize: petalSize,
                                petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                                enemies: constants_2.enemies,
                                io: io
                            };
                            (0, petal_actions_1.executePetalActions)(petalStats.actions, actionContext, 'on_break');
                        }
                        // Petal breaks - set on cooldown instead of removing
                        petal.onCooldown = true;
                        // Store original petal data for restoration
                        const originalPetal = {
                            type: petal.type,
                            petalType: petal.petalType,
                            rarity: petal.rarity,
                            maxHealth: petal.maxHealth
                        };
                        // Add cooldown (similar to other items)
                        const cooldownTime = petalStats.cooldown || 10000; // Use petal-specific cooldown or default to 10 seconds
                        setTimeout(() => {
                            if (constants_2.players[player.id] && player.loadout[loadoutIndex] && player.loadout[loadoutIndex].onCooldown) {
                                // Restore petal after cooldown
                                const restoredPetal = {
                                    ...originalPetal,
                                    health: originalPetal.maxHealth, // Restore full health
                                    onCooldown: false
                                };
                                // Apply petal health bonus
                                (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, player);
                                player.loadout[loadoutIndex] = restoredPetal;
                                io.emit('petalRestored', {
                                    playerId: player.id,
                                    slotIndex: loadoutIndex,
                                    petal: player.loadout[loadoutIndex]
                                });
                                // console.log(`Petal ${petal.petalType} restored for player ${player.id} after ${cooldownTime}ms`);
                            }
                        }, cooldownTime);
                        io.emit('petalBroken', {
                            playerId: player.id,
                            slotIndex: loadoutIndex,
                            petalType: petal.petalType,
                            rarity: petal.rarity
                        });
                    }
                    // Check if enemy dies
                    if (enemy.health <= 0) {
                        const index = constants_2.enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                            addXPToPlayer(player, xpGained, player.id);
                            // Handle mob drops using the new drop table system
                            handleMobDrops(enemy);
                            (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
                            constants_2.enemies.splice(index, 1);
                            updateSpecialMobCounts();
                            io.emit('enemyDestroyed', enemy.id);
                            // Try to spawn a new enemy, but only if we can find a valid position
                            const newEnemy = createEnemy();
                            if (newEnemy) {
                                constants_2.enemies.push(newEnemy);
                            }
                        }
                    }
                }
            }
            // Check for corpse revival if this is a yggdrasil petal (always active)
            if (petal.petalType === 'yggdrasil') {
                const revivalRange = 80; // Range for automatic revival
                for (const [otherPlayerId, otherPlayer] of Object.entries(constants_2.players)) {
                    if (otherPlayerId !== player.id && otherPlayer.isDead) {
                        const distance = Math.sqrt((petalX - otherPlayer.x) ** 2 + (petalY - otherPlayer.y) ** 2);
                        if (distance <= revivalRange) {
                            // Break the yggdrasil petal when it revives someone
                            petal.health = 0; // This will trigger the petal breaking logic below
                            // Revive the target player
                            otherPlayer.isDead = false;
                            otherPlayer.health = otherPlayer.maxHealth;
                            otherPlayer.isInvulnerable = true;
                            otherPlayer.lastDamageTime = 0;
                            // Notify all clients about the revival
                            io.emit('playerRevived', {
                                revivedPlayerId: otherPlayerId,
                                revivingPlayerId: player.id,
                                revivedPlayerName: otherPlayer.name,
                                revivingPlayerName: player.name
                            });
                            // Give revived player temporary invulnerability
                            setTimeout(() => {
                                if (constants_2.players[otherPlayerId]) {
                                    constants_2.players[otherPlayerId].isInvulnerable = false;
                                    io.emit('playerInvulnerabilityEnded', { playerId: otherPlayerId });
                                }
                            }, constants_2.RESPAWN_INVULNERABILITY_TIME);
                            console.log(`Player ${player.name} automatically revived ${otherPlayer.name} using yggdrasil petal (petal broke)`);
                            // Break out of the loop since we've used the petal
                            break;
                        }
                    }
                }
            }
        }
    }
    // Check for item collisions (independent of enemy collisions)
    for (let i = gameState_1.items.length - 1; i >= 0; i--) {
        const item = gameState_1.items[i];
        const distance = Math.sqrt((newX - item.x) ** 2 + (newY - item.y) ** 2);
        if (distance < constants_2.PLAYER_SIZE) {
            // Check if player has already picked up this item
            if (item.pickedUpBy && item.pickedUpBy.has(player.id)) {
                continue; // Skip if already picked up by this player
            }
            // Check if player is eligible to pick up this item
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                if (!item.eligiblePlayers.includes(player.id)) {
                    // Player is not eligible - skip this item
                    continue;
                }
            }
            // Add item to player's inventory
            const rarity = item.rarity || 'common';
            const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
            (0, playerManager_1.addItem)(player.inventory, rarity, itemKey, 1);
            // Mark as picked up by this player (don't remove from world)
            if (!item.pickedUpBy) {
                item.pickedUpBy = new Set();
            }
            item.pickedUpBy.add(player.id);
            // Emit events to update client
            // Only send itemPickedUp to the player who picked it up, not to everyone
            io.to(player.id).emit('itemPickedUp', item.id);
            io.to(player.id).emit('inventoryUpdated', player.inventory);
            // Save player progress to persist inventory changes
            const userId = gameState_1.playerUserIds[player.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
            // Remove item from world if all eligible players have picked it up
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                const allPickedUp = item.eligiblePlayers.every(playerId => item.pickedUpBy && item.pickedUpBy.has(playerId));
                if (allPickedUp) {
                    gameState_1.items.splice(i, 1);
                    // Notify only eligible players that the item is gone
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
            }
        }
    }
    // Check for teleporter interactions with 1-second delay
    let currentTeleporter = null;
    const currentTime = Date.now();
    // Check if player is currently in a teleporter
    for (const element of constants_2.WORLD_MAP.filter(constants_2.isTeleporter)) {
        const teleporterId = `teleporter_${element.x}_${element.y}_${element.width}_${element.height}`;
        const teleporterX = element.x * constants_2.SCALE_FACTOR;
        const teleporterY = element.y * constants_2.SCALE_FACTOR;
        const teleporterWidth = element.width * constants_2.SCALE_FACTOR;
        const teleporterHeight = element.height * constants_2.SCALE_FACTOR;
        // Check if player is inside teleporter bounds (using proper collision detection)
        if (newX + constants_2.PLAYER_SIZE > teleporterX &&
            newX < teleporterX + teleporterWidth &&
            newY + constants_2.PLAYER_SIZE > teleporterY &&
            newY < teleporterY + teleporterHeight &&
            element.properties?.teleportTo) {
            currentTeleporter = teleporterId;
            // Check if player just entered this teleporter
            if (player.currentTeleporter !== teleporterId) {
                player.currentTeleporter = teleporterId;
                player.teleporterEnterTime = currentTime;
                // Notify client that player entered teleporter (for UI feedback)
                io.to(player.id).emit('teleporterEntered', {
                    teleporterId,
                    timeRequired: 1000, // 1 second
                    teleportTo: element.properties.teleportTo
                });
                console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Player ${player.name} entered teleporter, waiting 1 second...`);
            }
            // Check if player has been in teleporter for 1 second and is not on cooldown
            const timeInTeleporter = currentTime - (player.teleporterEnterTime || currentTime);
            const isOnCooldown = player.teleportCooldown && currentTime < player.teleportCooldown;
            if (timeInTeleporter >= 1000 && !isOnCooldown) {
                const teleportTo = element.properties.teleportTo;
                // Set cooldown to prevent rapid teleportations
                player.teleportCooldown = currentTime + 2000; // 2 second cooldown
                // Check if this is a cross-server teleporter
                if (teleportTo.serverPort && teleportTo.serverPort !== CURRENT_SERVER_PORT) {
                    // Cross-server teleportation
                    console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Player ${player.name} teleporting to server port ${teleportTo.serverPort} after 1 second delay`);
                    // Reset teleporter state
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    // Attempt to transfer player to target server
                    (0, crossServer_1.transferPlayerToServer)(player, teleportTo.serverPort, teleportTo.x * constants_2.SCALE_FACTOR, teleportTo.y * constants_2.SCALE_FACTOR, io, database_1.database, constants_1.USE_HTTPS, CURRENT_SERVER_CONFIG, CURRENT_SERVER_PORT).catch(error => {
                        console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Failed to transfer player ${player.name}:`, error);
                        // Optionally notify the player about the failed transfer
                        io.to(player.id).emit('transferFailed', { message: 'Failed to connect to target server' });
                        // Reset cooldown on failure
                        player.teleportCooldown = undefined;
                    });
                    // Don't update player position this tick as they're being transferred
                    return;
                }
                else {
                    // Same-server teleportation
                    newX = teleportTo.x * constants_2.SCALE_FACTOR;
                    newY = teleportTo.y * constants_2.SCALE_FACTOR;
                    // Reset teleporter state
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Player ${player.name} teleported to (${newX}, ${newY}) after 1 second delay`);
                    // Emit teleport event to client for visual effects
                    io.to(player.id).emit('playerTeleported', {
                        newX,
                        newY,
                        playerId: player.id
                    });
                }
            }
            break; // Player can only be in one teleporter at a time
        }
    }
    // If player is no longer in any teleporter, reset teleporter state
    if (!currentTeleporter && player.currentTeleporter) {
        console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Player ${player.name} left teleporter`);
        player.currentTeleporter = undefined;
        player.teleporterEnterTime = undefined;
        // Notify client that player left teleporter
        io.to(player.id).emit('teleporterExited');
    }
    player.x = newX;
    player.y = newY;
    if (player.health <= 0 && !player.isDead) {
        // Mark player as dead instead of respawning immediately
        player.isDead = true;
        // Set random rotation for the corpse
        player.angle = Math.random() * Math.PI * 2;
        io.emit('playerDied', {
            playerId: player.id,
            x: player.x,
            y: player.y,
            angle: player.angle,
            killedBy: player.killedBy
        });
        // No automatic respawn - player must manually respawn via continue button
    }
}
function start_loop() {
    const TICK_RATE = 30;
    const TICK_INTERVAL = 1000 / TICK_RATE;
    const deltaTime = 1 / TICK_RATE;
    setInterval(() => {
        for (const id in constants_2.players) {
            updatePlayerState(constants_2.players[id], deltaTime);
        }
        // Update petal actions
        (0, petal_actions_1.updatePetalActions)(deltaTime);
        // Update poison effects
        updatePoisonEffects(deltaTime);
        moveEnemies();
        // Update mob projectiles
        updateMobProjectiles(TICK_INTERVAL); // Pass milliseconds
        // Update player projectiles
        updatePlayerProjectiles(TICK_INTERVAL); // Pass milliseconds
        // Update viewport status for all enemies
        updateEnemyViewportStatus();
        // Despawn enemies that have been outside viewport for too long
        despawnDistantEnemies();
        // Check and fix item-wall collisions for all items
        for (const item of gameState_1.items) {
            (0, utils_1.checkItemWallCollisions)(item);
        }
        // Delete items that go out of bounds
        for (let i = gameState_1.items.length - 1; i >= 0; i--) {
            const item = gameState_1.items[i];
            if (item.x < 0 || item.x >= constants_2.ACTUAL_WORLD_WIDTH || item.y < 0 || item.y >= constants_2.ACTUAL_WORLD_HEIGHT) {
                // Notify eligible players that item is being removed
                if (item.eligiblePlayers) {
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
                gameState_1.items.splice(i, 1);
            }
        }
        const playersForBroadcast = Object.values(constants_2.players).map(p => ({
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            angle: p.angle,
            health: p.health,
            maxHealth: p.maxHealth,
            level: p.level,
            score: p.score
        }));
        io.emit('gameStateUpdate', {
            players: playersForBroadcast,
            enemies: constants_2.enemies,
        });
    }, TICK_INTERVAL);
}
server.listen(PORT, () => {
    console.log(`Server is running on ${constants_1.SERVER_PROTOCOL}://localhost:${PORT}`);
});
// Add these constants at the top with other constants
const HEALTH_REGEN_RATE = 5; // Health points recovered per tick
const HEALTH_REGEN_INTERVAL = 1000; // Milliseconds between health regeneration ticks
const HEALTH_REGEN_COMBAT_DELAY = 0; // Delay before health starts regenerating after taking damage
// Add health regeneration interval
setInterval(() => {
    Object.values(constants_2.players).forEach(player => {
        // Check if enough time has passed since last damage
        const now = Date.now();
        if (player.lastDamageTime && now - player.lastDamageTime < HEALTH_REGEN_COMBAT_DELAY) {
            return; // Skip regeneration if player was recently damaged
        }
        // Regenerate health if not at max
        if (player.health < player.maxHealth) {
            player.health = Math.min(player.maxHealth, player.health + HEALTH_REGEN_RATE);
            io.emit('playerUpdated', player);
        }
    });
}, HEALTH_REGEN_INTERVAL);
// Add viewport refresh interval (every 10 seconds)
setInterval(() => {
    // console.log(`[SERVER] Refreshing viewport status for ${Object.keys(players).length} players`);
    // Validate and fix any invalid player positions first
    validatePlayerPositions();
    // Force update all enemy viewport statuses
    updateEnemyViewportStatus();
    // Despawn any enemies that have been outside viewport for too long
    despawnDistantEnemies();
}, 10000); // 10 seconds
// Add density maintenance interval (every 2 seconds)
setInterval(() => {
    const playerCount = Object.keys(constants_2.players).length;
    if (playerCount > 0) {
        // Calculate target enemy count based on current viewport density
        const viewports = getPlayerViewports();
        const totalViewportArea = viewports.reduce((total, viewport) => {
            const extendedViewport = {
                x: viewport.x - constants_2.VIEWPORT_BUFFER,
                y: viewport.y - constants_2.VIEWPORT_BUFFER,
                width: viewport.width + (constants_2.VIEWPORT_BUFFER * 2),
                height: viewport.height + (constants_2.VIEWPORT_BUFFER * 2)
            };
            return total + (extendedViewport.width * extendedViewport.height);
        }, 0);
        const targetDensity = constants_2.ORIGINAL_ENEMY_COUNT / constants_2.TOTAL_WORLD_AREA;
        const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
        const currentViewportEnemies = getEnemiesInViewportCount();
        if (currentViewportEnemies < targetEnemyCount) {
            const enemiesToSpawn = Math.min(3, targetEnemyCount - currentViewportEnemies);
            let spawned = 0;
            for (let i = 0; i < enemiesToSpawn; i++) {
                const newEnemy = createEnemy();
                if (newEnemy) {
                    constants_2.enemies.push(newEnemy);
                    spawned++;
                }
            }
            // if (spawned > 0) {
            // console.log(`[SERVER] Density maintenance: spawned ${spawned} enemies (target: ${targetEnemyCount}, current: ${currentViewportEnemies})`);
            // }
        }
    }
}, 500); // 0.5 seconds
// Add special mob spawning timer (every 1 minute)
setInterval(() => {
    const playerCount = Object.keys(constants_2.players).length;
    if (playerCount > 0) {
        spawnSpecialMobs();
    }
}, 60000); // 60 seconds
// Initial spawn of special mobs when server starts
setTimeout(() => {
    spawnSpecialMobs();
}, 5000); // 5 seconds after server start
// Update DPS for target dummies every second
setInterval(() => {
    updateTargetDummyDPS();
}, 1000); // 1 second
// savePlayerProgress moved to playerManager module - using wrapper function defined earlier
// Add periodic saving
const SAVE_INTERVAL = 60000; // Save every minute
setInterval(() => {
    Object.entries(constants_2.players).forEach(([socketId, player]) => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.userId) {
            socket.emit('savePlayerProgress', player);
            savePlayerProgress(player, socket.userId);
        }
    });
}, SAVE_INTERVAL);
// Add after other app.use declarations but before socket.io setup
app.post('/admin/save-progress', (req, res) => {
    const { playerId } = req.body;
    if (!playerId) {
        return res.status(400).json({ message: 'Player ID is required' });
    }
    const player = constants_2.players[playerId];
    const socket = io.sockets.sockets.get(playerId);
    if (!player || !socket?.userId) {
        return res.status(404).json({ message: 'Player not found or not authenticated' });
    }
    try {
        savePlayerProgress(player, socket.userId);
        res.json({ message: 'Progress saved successfully' });
    }
    catch (error) {
        console.error('Error saving progress:', error);
        res.status(500).json({ message: 'Failed to save progress' });
    }
});
// Function to execute server commands (can be called from stdin or chat)
function executeServerCommand(command, executor) {
    const trimmedCommand = command.trim();
    if (executor) {
        console.log(`[ADMIN] ${executor} executed: ${trimmedCommand}`);
    }
    if (trimmedCommand.startsWith('save')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2) {
            const playerId = parts[1];
            const player = constants_2.players[playerId];
            const socket = io.sockets.sockets.get(playerId);
            if (player && socket?.userId) {
                savePlayerProgress(player, socket.userId);
                socket.emit('savePlayerProgress', player);
                // console.log(`Progress saved for player ${playerId}`);
            }
            else {
                // console.log(`Player ${playerId} not found or not authenticated`);
            }
        }
        else if (parts.length === 1) {
            // Save all players
            let savedCount = 0;
            Object.entries(constants_2.players).forEach(([socketId, player]) => {
                const socket = io.sockets.sockets.get(socketId);
                if (socket?.userId) {
                    savePlayerProgress(player, socket.userId);
                    savedCount++;
                }
            });
            // console.log(`Saved progress for ${savedCount} players`);
        }
    }
    else if (trimmedCommand === 'list-players') {
        Object.entries(constants_2.players).forEach(([socketId, player]) => {
            console.log(`Player ID: ${socketId}, Name: ${player.name}, Level: ${player.level}`);
        });
    }
    else if (trimmedCommand === 'list-sockets') {
        io.sockets.sockets.forEach((socket) => {
            console.log(`Socket ID: ${socket.id}`);
        });
    }
    else if (trimmedCommand.startsWith('set_max_enemies')) {
        const newCount = parseInt(trimmedCommand.split(' ')[1]);
        if (!isNaN(newCount) && newCount >= 0) {
            gameState_1.ENEMY_COUNT.value = newCount;
            console.log(`Max enemies set to ${gameState_1.ENEMY_COUNT.value}`);
            adjustEnemyCount();
        }
        else {
            console.log('Invalid enemy count. Please provide a valid number.');
        }
    }
    else if (trimmedCommand === 'spawn_special_mobs') {
        spawnSpecialMobs();
    }
    else if (trimmedCommand.startsWith('spawn')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 3) {
            // spawn <mobType> <rarity>
            const mobType = parts[1];
            const rarity = parts[2];
            spawnMob(mobType, rarity);
        }
        else if (parts.length === 5) {
            // spawn <mobType> <rarity> <x> <y>
            const mobType = parts[1];
            const rarity = parts[2];
            const x = parseFloat(parts[3]);
            const y = parseFloat(parts[4]);
            if (isNaN(x) || isNaN(y)) {
                console.log('Invalid coordinates. Usage: spawn <mobType> <rarity> [x] [y]');
            }
            else {
                spawnMob(mobType, rarity, x, y);
            }
        }
        else {
            console.log('Usage: spawn <mobType> <rarity> [x] [y]');
            console.log('  Examples:');
            console.log('    spawn bee rare');
            console.log('    spawn octopus legendary 1000 2000');
            console.log(`Available mob types: ${(0, mobs_1.getAllMobTypes)().join(', ')}`);
            console.log('Valid rarities: common, uncommon, rare, epic, legendary, mythic, ultra, super, unique');
        }
    }
    else if (trimmedCommand.startsWith('teleport ') || trimmedCommand.startsWith('tp ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 4) {
            // teleport <playerId/name> <x> <y>
            const playerIdentifier = parts[1];
            const x = parseFloat(parts[2]);
            const y = parseFloat(parts[3]);
            if (isNaN(x) || isNaN(y)) {
                console.log('Invalid coordinates. Usage: teleport <playerId/name> <x> <y>');
                return;
            }
            // Try to find player by ID first, then by name
            let targetPlayer;
            let targetPlayerId;
            // Check if it's a socket ID
            if (constants_2.players[playerIdentifier]) {
                targetPlayer = constants_2.players[playerIdentifier];
                targetPlayerId = playerIdentifier;
            }
            else {
                // Search by name
                for (const [socketId, player] of Object.entries(constants_2.players)) {
                    if (player.name.toLowerCase() === playerIdentifier.toLowerCase()) {
                        targetPlayer = player;
                        targetPlayerId = socketId;
                        break;
                    }
                }
            }
            if (targetPlayer && targetPlayerId) {
                // Teleport the player
                targetPlayer.x = x;
                targetPlayer.y = y;
                // Emit teleport event to client for visual effects
                io.to(targetPlayerId).emit('playerTeleported', {
                    newX: x,
                    newY: y,
                    playerId: targetPlayerId
                });
                console.log(`Teleported player ${targetPlayer.name} (${targetPlayerId}) to (${x}, ${y})`);
            }
            else {
                console.log(`Player "${playerIdentifier}" not found. Use list-players to see available players.`);
            }
        }
        else {
            console.log('Usage: teleport <playerId/name> <x> <y>');
            console.log('  Examples:');
            console.log('    teleport abc123 1000 2000');
            console.log('    teleport PlayerName 5000 3000');
            console.log('    tp abc123 1000 2000  (shorthand)');
        }
    }
}
// Add console command handler after the httpsServer.listen() call
process.stdin.on('data', (data) => {
    const command = data.toString().trim();
    executeServerCommand(command);
});
// Add this function after the command handler
function adjustEnemyCount() {
    const playerCount = Object.keys(constants_2.players).length;
    const targetEnemyCount = playerCount > 0 ? constants_2.ENEMIES_PER_VIEWPORT * playerCount : gameState_1.ENEMY_COUNT.value;
    // Remove excess enemies if current count is higher than target
    while (constants_2.enemies.length > targetEnemyCount) {
        const removedEnemy = constants_2.enemies.pop();
        if (removedEnemy) {
            io.emit('enemyDestroyed', removedEnemy.id);
        }
    }
    // Add new enemies if current count is lower than target
    while (constants_2.enemies.length < targetEnemyCount) {
        const enemy = createEnemy();
        if (enemy) {
            constants_2.enemies.push(enemy);
        }
        else {
            // If we can't spawn more enemies (no valid positions), break the loop
            break;
        }
    }
    // Update all clients with the new enemy state
    io.emit('enemiesUpdate', constants_2.enemies);
    console.log(`[SERVER] Adjusted enemy count to ${constants_2.enemies.length}/${targetEnemyCount} (${playerCount} players)`);
}
// Add after other app.use declarations
app.use('/assets', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});
// If you're serving assets from a specific directory, update the static file serving
app.use('/assets', express_1.default.static(path_1.default.join(__dirname, '../assets'), {
    setHeaders: (res, path) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Cross-Origin-Resource-Policy', 'cross-origin');
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));
// Add near the top with other static file configurations
app.use('/favicon.ico', express_1.default.static(path_1.default.join(__dirname, '../assets/favicon.ico')));
start_loop();
