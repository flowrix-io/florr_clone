"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redeemedCodes = exports.sendBossMobDefeatedMessage = exports.trackDamage = void 0;
exports.handleMobDrops = handleMobDrops;
exports.updateSpecialMobCounts = updateSpecialMobCounts;
exports.addXPToPlayer = addXPToPlayer;
exports.saveCodeToDatabase = saveCodeToDatabase;
exports.deleteCodeFromDatabase = deleteCodeFromDatabase;
const express_1 = __importDefault(require("express"));
const https_1 = require("https");
const http_1 = require("http");
const ws_server_1 = require("./ws_server");
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
// Remove eggs for mobs that should not have eggs
const mobs_1 = require("./mobs");
const invalidEggTypes = new Set();
for (const mobType in mobs_1.BASE_MOB_CONFIGS) {
    if (mobType.endsWith('_pet'))
        continue;
    if (mobs_1.BASE_MOB_CONFIGS[mobType].noEggDrop) {
        invalidEggTypes.add(`petal_${mobType}_egg`);
    }
}
if (invalidEggTypes.size > 0) {
    const cleanedPlayers = database_1.database.removeInvalidEggs(invalidEggTypes);
    if (cleanedPlayers > 0) {
        console.log(`[SERVER] Removed invalid eggs from ${cleanedPlayers} players (${[...invalidEggTypes].join(', ')})`);
    }
}
const player_1 = require("./player");
const petal_actions_1 = require("./petal_actions");
const petals_1 = require("./petals");
const constants_2 = require("./constants");
const map_data_1 = require("./map_data");
const server_utils_1 = require("./server_utils");
const petals_2 = require("./petals");
const mobs_2 = require("./mobs");
// Import from refactored modules
const utils_1 = require("./server/utils");
Object.defineProperty(exports, "trackDamage", { enumerable: true, get: function () { return utils_1.trackDamage; } });
Object.defineProperty(exports, "sendBossMobDefeatedMessage", { enumerable: true, get: function () { return utils_1.sendBossMobDefeatedMessage; } });
const physics_1 = require("./server/physics");
const playerState_1 = require("./server/playerState");
const commands_1 = require("./server/commands");
const gameState_1 = require("./server/gameState");
const itemManager_1 = require("./server/itemManager");
const playerManager_1 = require("./server/playerManager");
const crossServer_1 = require("./server/crossServer");
const enemySpawner_1 = require("./server/enemySpawner");
const app = (0, express_1.default)();
// Wrapper function for handleMobDrops that passes io (will be set up later)
let ioInstance;
function handleMobDrops(enemy, io) {
    const enemyData = {
        type: enemy.type,
        tier: enemy.tier,
        x: enemy.x,
        y: enemy.y,
        damageContributors: enemy.damageContributors ? new Map(enemy.damageContributors) : undefined
    };
    (0, itemManager_1.handleMobDrops)(enemyData, io || ioInstance);
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
    index: 'index.html',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
        else if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    }
}));
// Explicitly serve index.html for root route (fallback)
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../dist/index.html'));
});
// Serve assets with CORS headers
app.use('/assets', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});
app.use('/assets', express_1.default.static(path_1.default.join(__dirname, '../assets'), {
    setHeaders: (res, filePath) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Cross-Origin-Resource-Policy', 'cross-origin');
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));
// Serve favicon from dist directory (it's copied there during build)
app.use('/favicon.ico', express_1.default.static(path_1.default.join(__dirname, '../dist/favicon.ico')));
// Notification endpoints
app.use(express_1.default.json());
app.get('/api/notifications', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const beforeTimestamp = req.query.before ? parseInt(req.query.before) : undefined;
    const notifications = database_1.database.getNotifications(limit, beforeTimestamp);
    res.json({ notifications });
});
app.post('/api/notifications', (req, res) => {
    const { type, message } = req.body;
    if (!type || !message) {
        return res.status(400).json({ message: 'Type and message are required' });
    }
    const notification = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        message,
        timestamp: Date.now()
    };
    database_1.database.addNotification(notification);
    res.json({ success: true, notification });
});
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
const io = new ws_server_1.Server(server);
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
    getPlayerViewports: playerState_1.getPlayerViewports,
    isPositionInPlayerPetalRange: playerState_1.isPositionInPlayerPetalRange,
    getEnemiesInViewportCount: playerState_1.getEnemiesInViewportCount
};
// Remove or comment out these lines since we're not using grid generation anymore
// const MAZE_CELL_SIZE = 1000;
// const MAZE_WALL_THICKNESS = 100;
// Initialize map obstacles - using function from gameState module
const gameState_2 = require("./server/gameState");
// Update the server initialization code
// Replace the old obstacle initialization with:
constants_2.obstacles.push(...(0, gameState_2.initializeMapObstacles)());
// Viewport optimization functions moved to playerState module
function updateEnemyViewportStatus() {
    const currentTime = Date.now();
    for (const enemy of constants_2.enemies) {
        if ((0, playerState_1.isPositionInAnyViewport)(enemy.x, enemy.y)) {
            enemy.lastViewportCheck = currentTime;
        }
    }
}
function calculateCurrentDensity() {
    const playerCount = Object.keys(constants_2.players).length;
    const totalEnemies = constants_2.enemies.length;
    const enemiesInViewport = (0, playerState_1.getEnemiesInViewportCount)();
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
    (0, playerState_1.validatePlayerPositions)(io);
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
        const viewports = (0, playerState_1.getPlayerViewports)();
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
        const currentViewportEnemies = (0, playerState_1.getEnemiesInViewportCount)();
        if (currentViewportEnemies < targetEnemyCount) {
            // Scale spawn cap with player count so each player's viewport fills at the same rate
            const enemiesToSpawn = Math.min(5 * playerCount, targetEnemyCount - currentViewportEnemies);
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
        const inViewport = (0, playerState_1.isPositionInAnyViewport)(enemy.x, enemy.y);
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
        // Clean up enemy data structures before removal to prevent memory leaks
        (0, utils_1.cleanupEnemy)(enemy);
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
    const allMobTypes = (0, mobs_2.getAllMobTypes)();
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
    const mobStats = (0, mobs_2.getMobStats)(mobType, tier);
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
        // Check if position is in out-of-bounds zone
        const BOUNDARY_THRESHOLD = 100;
        const isInOutOfBoundsZone = spawnX < BOUNDARY_THRESHOLD ||
            spawnX > constants_2.ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
            spawnY < BOUNDARY_THRESHOLD ||
            spawnY > constants_2.ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
        if (isInOutOfBoundsZone) {
            console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) are in out-of-bounds zone. Finding alternative position...`);
            spawnX = undefined;
            spawnY = undefined;
        }
        else {
            // Check if position is in a safe zone
            const inSafeZone = map_data_1.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                spawnX >= element.x * constants_2.SCALE_FACTOR &&
                spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                spawnY >= element.y * constants_2.SCALE_FACTOR &&
                spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
            // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
            const tileState = (0, constants_2.getTileState)(map_data_1.WALL_GRID, spawnX, spawnY);
            const collidesWithWall = tileState === 1 || tileState === 2;
            if (!inSafeZone && !collidesWithWall) {
                validPosition = true;
            }
            else {
                console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) are in a safe zone or wall. Finding alternative position...`);
                spawnX = undefined;
                spawnY = undefined;
            }
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
                const vpW = player.viewportWidth || constants_2.VIEWPORT_WIDTH;
                const vpH = player.viewportHeight || constants_2.VIEWPORT_HEIGHT;
                const viewportBuffer = constants_2.VIEWPORT_BUFFER;
                const minX = player.x - vpW / 2 - viewportBuffer;
                const maxX = player.x + vpW / 2 + viewportBuffer;
                const minY = player.y - vpH / 2 - viewportBuffer;
                const maxY = player.y + vpH / 2 + viewportBuffer;
                spawnX = minX + Math.random() * (maxX - minX);
                spawnY = minY + Math.random() * (maxY - minY);
                // Clamp to world boundaries
                spawnX = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_WIDTH, spawnX));
                spawnY = Math.max(0, Math.min(constants_2.ACTUAL_WORLD_HEIGHT, spawnY));
                // Skip if position is in out-of-bounds zone
                const BOUNDARY_THRESHOLD = 100;
                const isInOutOfBoundsZone = spawnX < BOUNDARY_THRESHOLD ||
                    spawnX > constants_2.ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
                    spawnY < BOUNDARY_THRESHOLD ||
                    spawnY > constants_2.ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
                if (isInOutOfBoundsZone) {
                    continue;
                }
                // Check if position is in a safe zone
                const inSafeZone = map_data_1.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                    spawnX >= element.x * constants_2.SCALE_FACTOR &&
                    spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                    spawnY >= element.y * constants_2.SCALE_FACTOR &&
                    spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
                // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
                const tileState2 = (0, constants_2.getTileState)(map_data_1.WALL_GRID, spawnX, spawnY);
                const collidesWithWall = tileState2 === 1 || tileState2 === 2;
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
                // Skip if position is in out-of-bounds zone
                const BOUNDARY_THRESHOLD = 100;
                const isInOutOfBoundsZone = spawnX < BOUNDARY_THRESHOLD ||
                    spawnX > constants_2.ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
                    spawnY < BOUNDARY_THRESHOLD ||
                    spawnY > constants_2.ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
                if (isInOutOfBoundsZone) {
                    continue;
                }
                // Check if position is in a safe zone
                const inSafeZone = map_data_1.WORLD_MAP.some(element => element.type === 'safe_zone' &&
                    spawnX >= element.x * constants_2.SCALE_FACTOR &&
                    spawnX <= (element.x + element.width) * constants_2.SCALE_FACTOR &&
                    spawnY >= element.y * constants_2.SCALE_FACTOR &&
                    spawnY <= (element.y + element.height) * constants_2.SCALE_FACTOR);
                // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
                const tileState3 = (0, constants_2.getTileState)(map_data_1.WALL_GRID, spawnX, spawnY);
                const collidesWithWall = tileState3 === 1 || tileState3 === 2;
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
    // Emit xpGained event only to the affected player
    ioInstance.to(player.id).emit('xpGained', {
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
        const socket = ioInstance.sockets.sockets.get(socketId);
        if (socket?.userId) {
            (0, playerManager_1.savePlayerProgress)(player, socket.userId, database_1.database);
        }
    }
}
// Wrapper for respawnPlayer that passes io
function respawnPlayer(player) {
    (0, playerManager_1.respawnPlayer)(player, ioInstance);
}
// Debounced save mechanism to prevent lag from frequent saves
const pendingSaves = new Map();
exports.redeemedCodes = new Map();
// Load codes from database on server startup
function loadCodesFromDatabase() {
    const savedCodes = database_1.database.getAllCodes();
    exports.redeemedCodes.clear();
    let loadedCount = 0;
    let removedCount = 0;
    for (const [code, codeData] of Object.entries(savedCodes)) {
        // Check if code has reached max uses - if so, remove it from database
        if (codeData.maxUses && codeData.uses >= codeData.maxUses) {
            database_1.database.deleteCode(code);
            removedCount++;
        }
        else {
            exports.redeemedCodes.set(code, codeData);
            loadedCount++;
        }
    }
    console.log(`[SERVER] Loaded ${loadedCount} codes from database`);
    if (removedCount > 0) {
        console.log(`[SERVER] Removed ${removedCount} fully used codes from database`);
    }
}
// Save code to database
function saveCodeToDatabase(code, codeData) {
    database_1.database.saveCode(code, codeData);
}
// Delete code from database
function deleteCodeFromDatabase(code) {
    database_1.database.deleteCode(code);
}
// Load codes when server starts
loadCodesFromDatabase();
// Wrapper for savePlayerProgress that passes database with debouncing
function savePlayerProgress(player, userId) {
    // Clear existing timeout for this player
    const existingTimeout = pendingSaves.get(userId);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }
    // Set a new timeout to save after 2 seconds of no activity
    // This batches multiple rapid pickups into a single save
    const timeout = setTimeout(() => {
        (0, playerManager_1.savePlayerProgress)(player, userId, database_1.database);
        pendingSaves.delete(userId);
    }, 2000);
    pendingSaves.set(userId, timeout);
}
// Immediate save function for critical operations (disconnect, etc.)
function savePlayerProgressImmediate(player, userId) {
    // Clear any pending debounced save
    const existingTimeout = pendingSaves.get(userId);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        pendingSaves.delete(userId);
    }
    // Save immediately
    (0, playerManager_1.savePlayerProgress)(player, userId, database_1.database);
}
// Function to adjust enemy count based on player count
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
    // Don't send enemiesUpdate here - enemies are sent via enemySpawned/enemyDestroyed events
    console.log(`[SERVER] Adjusted enemy count to ${constants_2.enemies.length}/${targetEnemyCount} (${playerCount} players)`);
}
// Command handler dependencies (defined after all functions it depends on)
const commandDeps = {
    io,
    savePlayerProgress,
    spawnMob,
    spawnSpecialMobs,
    createEnemy,
    adjustEnemyCount
};
// Player state handler dependencies
const playerStateDeps = {
    io,
    addXPToPlayer,
    handleMobDrops,
    sendBossMobDefeatedMessage: utils_1.sendBossMobDefeatedMessage,
    updateSpecialMobCounts,
    createEnemy,
    savePlayerProgress,
    transferPlayerToServer: crossServer_1.transferPlayerToServer,
    currentServerConfig: CURRENT_SERVER_CONFIG,
    currentServerPort: CURRENT_SERVER_PORT,
    useHttps: constants_1.USE_HTTPS,
    database: database_1.database,
    trackMobKill: utils_1.trackMobKill
};
io.on('connection', (socket) => {
    console.log('A user connected');
    // Send map data to the client (includes elements and wallGrid)
    const mapData = {
        elements: map_data_1.WORLD_MAP,
        wallGrid: map_data_1.WALL_GRID
    };
    socket.emit('mapData', mapData);
    socket.on('playerInput', (inputData) => {
        const player = constants_2.players[socket.id];
        if (player) {
            // Update per-player viewport dimensions if provided
            if (inputData.viewportWidth && inputData.viewportHeight &&
                isFinite(inputData.viewportWidth) && isFinite(inputData.viewportHeight) &&
                inputData.viewportWidth > 0 && inputData.viewportHeight > 0) {
                player.viewportWidth = inputData.viewportWidth;
                player.viewportHeight = inputData.viewportHeight;
            }
            // Check if player is split and route inputs to active player
            const { splitPlayers } = require('./petal_actions');
            const originalId = socket.id.replace('_split2', '').replace('_split1', '');
            const splitState = splitPlayers.get(originalId);
            if (splitState) {
                // Player is split - route inputs to active player
                const activePlayer = splitState.activeIndex === 0 ? splitState.player1 : splitState.player2;
                if (activePlayer && constants_2.players[activePlayer.id]) {
                    constants_2.players[activePlayer.id].inputs = inputData;
                }
            }
            else {
                // Normal player - apply inputs directly
                player.inputs = inputData;
            }
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
                // Helper to get section from map coordinates
                const SECTION_SIZE = 20000;
                const getSectionFromMapCoords = (x, y) => {
                    const worldX = x * constants_2.SCALE_FACTOR;
                    const worldY = y * constants_2.SCALE_FACTOR;
                    const sectionX = Math.max(0, Math.min(2, Math.floor(worldX / SECTION_SIZE)));
                    const sectionY = Math.max(0, Math.min(2, Math.floor(worldY / SECTION_SIZE)));
                    return sectionY * 3 + sectionX;
                };
                const validSpawnPoints = map_data_1.WORLD_MAP.filter(element => element.type === 'spawn' &&
                    element.properties?.spawnType === 'common');
                if (validSpawnPoints.length > 0) {
                    // Prioritize spawn points in section 0 (first section) for default spawning
                    const section0SpawnPoints = validSpawnPoints.filter(spawn => {
                        const centerX = spawn.x + spawn.width / 2;
                        const centerY = spawn.y + spawn.height / 2;
                        return getSectionFromMapCoords(centerX, centerY) === 0;
                    });
                    // Use section 0 spawn points if available, otherwise fall back to all common spawns
                    const preferredSpawnPoints = section0SpawnPoints.length > 0 ? section0SpawnPoints : validSpawnPoints;
                    // Shuffle spawn points to try different ones
                    const shuffledSpawnPoints = [...preferredSpawnPoints].sort(() => Math.random() - 0.5);
                    let safeSpawnPosition = null;
                    for (const spawn of shuffledSpawnPoints) {
                        safeSpawnPosition = (0, playerManager_1.findSafeSpawnPosition)(spawn);
                        if (safeSpawnPosition) {
                            break;
                        }
                    }
                    if (safeSpawnPosition) {
                        spawnX = safeSpawnPosition.x;
                        spawnY = safeSpawnPosition.y;
                    }
                    else {
                        // Fallback: use random position in first spawn point (even if not completely safe)
                        console.warn('No safe spawn position found in common spawn zones, using fallback');
                        const spawn = preferredSpawnPoints[0];
                        spawnX = (spawn.x + spawn.width / 2) * constants_2.SCALE_FACTOR;
                        spawnY = (spawn.y + spawn.height / 2) * constants_2.SCALE_FACTOR;
                    }
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
                name: (credentials.playerName || 'Unnamed').slice(0, 20),
                x: spawnX,
                y: spawnY,
                angle: 0,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                health: baseMaxHealth, // Will be recalculated with modifiers
                maxHealth: baseMaxHealth, // Will be recalculated with modifiers
                damage: baseDamage, // Will be recalculated with modifiers
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
                skills: savedSkills,
                mobKills: savedProgress?.mobKills || {},
                stars: savedProgress?.stars || 0,
                spawnBiome: credentials.spawnBiome || 'default'
            };
            // Recalculate player stats with modifiers after loadout is set
            (0, playerManager_1.recalculatePlayerStats)(constants_2.players[socket.id], io);
            // Start cooldown timers for all petals that are on cooldown
            const player = constants_2.players[socket.id];
            if (player && player.loadout) {
                for (let i = 0; i < player.loadout.length; i++) {
                    const petal = player.loadout[i];
                    if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                        const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity);
                        // Spawn pets for equipped petals with petMobType (only if not on cooldown)
                        if (petalStats?.petMobType && !petal.onCooldown && petal.rarity) {
                            const petMobType = petalStats.petMobType;
                            // Pet inherits the petal's rarity
                            // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${player.id} on spawn`);
                            (0, petal_actions_1.spawnPet)(petMobType, petal.rarity, player.x, player.y, player.id, io);
                        }
                        // Handle cooldown timers
                        if (petal.onCooldown && petalStats) {
                            const cooldownTime = petalStats.cooldown || 10000;
                            const timeoutKey = `${socket.id}-${i}`;
                            const timeout = setTimeout(() => {
                                gameState_1.petalCooldownTimeouts.delete(timeoutKey);
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
                                    // Spawn pet when petal is restored (if it has petMobType)
                                    if (petalStats.petMobType && petal.rarity) {
                                        const petMobType = petalStats.petMobType;
                                        // Pet inherits the petal's rarity
                                        const restoredPlayer = constants_2.players[socket.id];
                                        if (restoredPlayer && !restoredPlayer.isDead) {
                                            // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${restoredPlayer.id} when petal restored on spawn`);
                                            (0, petal_actions_1.spawnPet)(petMobType, petal.rarity, restoredPlayer.x, restoredPlayer.y, restoredPlayer.id, io);
                                        }
                                    }
                                }
                            }, cooldownTime);
                            gameState_1.petalCooldownTimeouts.set(timeoutKey, timeout);
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
            // Only send enemies in viewport with 200% buffer on connection
            const enemiesInViewport = (0, playerState_1.getEnemiesInViewport200Percent)();
            socket.emit('enemiesUpdate', enemiesInViewport);
            socket.emit('obstaclesUpdate', constants_2.obstacles);
            // Filter items to only send ones this player is eligible for and hasn't picked up yet
            // Check if player is split and get all split player IDs
            const { splitPlayers } = require('./petal_actions');
            const originalId = socket.id.replace('_split2', '').replace('_split1', '');
            const splitState = splitPlayers.get(originalId);
            const playerIds = splitState ? [splitState.player1.id, splitState.player2.id, originalId] : [socket.id];
            const eligibleItems = gameState_1.items.filter(item => {
                // If item has eligibility list, check if this player (or any split player) is eligible
                if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                    const isEligible = playerIds.some(playerId => item.eligiblePlayers.includes(playerId));
                    if (!isEligible) {
                        return false; // Not eligible
                    }
                }
                // Check if this player (or any split player) has already picked up this item
                if (item.pickedUpBy) {
                    const alreadyPickedUp = playerIds.some(playerId => item.pickedUpBy.has(playerId));
                    if (alreadyPickedUp) {
                        return false; // Already picked up
                    }
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
        // Check if player is split and clean up both split players
        const { splitPlayers } = require('./petal_actions');
        const originalId = socket.id.replace('_split2', '').replace('_split1', '');
        const splitState = splitPlayers.get(originalId);
        if (splitState) {
            // Player is split - clean up both split players
            console.log(`[DISCONNECT] Cleaning up split players for ${originalId}`);
            // Save progress for the original player if authenticated
            if (constants_2.players[originalId] && socket.userId) {
                savePlayerProgressImmediate(constants_2.players[originalId], socket.userId);
            }
            // Clean up petal cooldown timeouts for both split players
            const splitPlayerIds = [splitState.player1.id, splitState.player2.id, originalId];
            for (const playerId of splitPlayerIds) {
                for (let i = 0; i < 10; i++) {
                    const timeoutKey = `${playerId}-${i}`;
                    const timeout = gameState_1.petalCooldownTimeouts.get(timeoutKey);
                    if (timeout) {
                        clearTimeout(timeout);
                        gameState_1.petalCooldownTimeouts.delete(timeoutKey);
                    }
                }
                // Clean up petalLastProjectileTime entries
                const keysToDelete = [];
                gameState_1.petalLastProjectileTime.forEach((value, key) => {
                    if (key.startsWith(playerId)) {
                        keysToDelete.push(key);
                    }
                });
                keysToDelete.forEach(key => gameState_1.petalLastProjectileTime.delete(key));
                // Clean up petal physics states
                (0, playerState_1.cleanupPetalPhysicsStates)(playerId);
                // Remove player from players map
                delete constants_2.players[playerId];
                delete gameState_1.playerUserIds[playerId];
                // Emit playerDisconnected event for this split player
                io.emit('playerDisconnected', playerId);
            }
            // Despawn all pets owned by any of the split players
            for (const playerId of splitPlayerIds) {
                (0, petal_actions_1.despawnAllPlayerPets)(playerId, io);
            }
            // Remove split state
            splitPlayers.delete(originalId);
        }
        else {
            // Normal player - standard cleanup
            if (constants_2.players[socket.id] && socket.userId) {
                // console.log('Saving player progress for userId:', socket.userId);
                savePlayerProgressImmediate(constants_2.players[socket.id], socket.userId);
            }
            // Clean up petal cooldown timeouts for this player
            for (let i = 0; i < 10; i++) {
                const timeoutKey = `${socket.id}-${i}`;
                const timeout = gameState_1.petalCooldownTimeouts.get(timeoutKey);
                if (timeout) {
                    clearTimeout(timeout);
                    gameState_1.petalCooldownTimeouts.delete(timeoutKey);
                }
            }
            // Clean up petalLastProjectileTime entries for this player
            const keysToDelete = [];
            gameState_1.petalLastProjectileTime.forEach((value, key) => {
                if (key.startsWith(socket.id)) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(key => gameState_1.petalLastProjectileTime.delete(key));
            // Clean up petal physics states for this player
            (0, playerState_1.cleanupPetalPhysicsStates)(socket.id);
            // Despawn all pets owned by this player
            (0, petal_actions_1.despawnAllPlayerPets)(socket.id, io);
            delete constants_2.players[socket.id];
            delete gameState_1.playerUserIds[socket.id]; // Clean up the mapping
        }
        // Remove all event listeners to prevent memory leaks
        // Socket.IO will handle cleanup, but we can be explicit for unauthenticated connections
        socket.removeAllListeners();
        // Only emit to authenticated players (not to unauthenticated title screen connections)
        // Note: playerDisconnected events for split players are already emitted above
        if (!splitState) {
            const authenticatedSockets = Array.from(io.sockets.sockets.values())
                .filter((s) => s.userId);
            if (authenticatedSockets.length > 0) {
                io.emit('playerDisconnected', socket.id);
            }
        }
        // Trigger viewport update when player disconnects (only if there are authenticated players)
        if (Object.keys(constants_2.players).length > 0) {
            triggerViewportUpdate();
        }
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
        // Check if player is split and route to the active player
        const { splitPlayers } = require('./petal_actions');
        const originalId = socket.id.replace('_split2', '').replace('_split1', '');
        const splitState = splitPlayers.get(originalId);
        // Determine which player should receive the item effect
        let targetPlayerId = socket.id;
        if (splitState) {
            // Player is split - route to the active player
            targetPlayerId = splitState.activeIndex === 0 ? splitState.player1.id : splitState.player2.id;
        }
        const player = constants_2.players[targetPlayerId];
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
                    if (constants_2.players[targetPlayerId]) {
                        constants_2.players[targetPlayerId].speed_boost = 1;
                        // console.log('Speed boost wore off');
                    }
                }, 5000 * multiplier);
                break;
            case 'shield':
                player.isInvulnerable = true;
                // console.log('Applied shield effect');
                setTimeout(() => {
                    if (constants_2.players[targetPlayerId]) {
                        constants_2.players[targetPlayerId].isInvulnerable = false;
                        // console.log('Shield wore off');
                    }
                }, 3000 * multiplier);
                break;
            case 'petal':
                // Handle splitter petal
                if (item.petalType === 'splitter') {
                    const { splitPlayer, switchPlayer, splitPlayers } = require('./petal_actions');
                    const originalId = socket.id; // Use socket.id as the original ID (before any splits)
                    if (splitPlayers.has(originalId)) {
                        // Already split - switch between players
                        // Get the current active player to switch from
                        const splitState = splitPlayers.get(originalId);
                        if (splitState) {
                            // Switch from the currently active player, pass socket.id so it only notifies this client
                            switchPlayer(splitState.activeIndex === 0 ? splitState.player1 : splitState.player2, io, socket.id);
                        }
                    }
                    else {
                        // Not split - split the player
                        splitPlayer(player, io);
                    }
                }
                break;
        }
        // Notify clients about the item use without removing it
        io.emit('itemUsed', {
            playerId: socket.id,
            item: itemData,
        });
        // Add cooldown to the item in player's loadout (client-side handles the visual)
        // Update the player state (only relevant to this player)
        socket.emit('playerUpdated', player);
    });
    // XP handling is now managed by the global addXPToPlayer function
    // Add a name update handler
    socket.on('updateName', (newName) => {
        const player = constants_2.players[socket.id];
        if (player) {
            player.name = newName.slice(0, 20);
            // Name changes need to go to all players
            io.emit('playerUpdated', { id: player.id, name: player.name });
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
        return validatedLoadout;
    }
    socket.on('updateLoadout', (data) => {
        // console.log('[PET DEBUG] updateLoadout called for socket:', socket.id);
        // Check if player is split and route to the active player
        const { splitPlayers } = require('./petal_actions');
        const originalId = socket.id.replace('_split2', '').replace('_split1', '');
        const splitState = splitPlayers.get(originalId);
        // Determine which player should receive the loadout update
        let targetPlayerId = socket.id;
        if (splitState) {
            // Player is split - route to the active player
            targetPlayerId = splitState.activeIndex === 0 ? splitState.player1.id : splitState.player2.id;
        }
        const player = constants_2.players[targetPlayerId];
        if (!player) {
            console.warn('[SERVER] updateLoadout: Player not found for socket:', socket.id, 'targetPlayerId:', targetPlayerId);
            return;
        }
        if (!socket.username) {
            console.warn('[SERVER] updateLoadout: Socket not authenticated');
            return;
        }
        // console.log('[PET DEBUG] updateLoadout: Player found, processing loadout...');
        if (player) {
            // Track which slots had items before to detect changes
            const oldLoadout = player.loadout || [];
            const oldInventory = player.inventory || {};
            // IMPORTANT: Use server's inventory as source of truth, NOT client's
            // This prevents console-added items from being accepted
            // For split players, we need to use the shared inventory directly (not a copy)
            // If split, use the shared inventory directly; otherwise create a copy for validation
            const serverInventory = splitState ? oldInventory : { ...oldInventory };
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
                    }
                    // If the unequipped item was a petal with petMobType, despawn the pet
                    if (oldItem.type === 'petal' && oldItem.petalType && oldItem.rarity) {
                        const oldPetalStats = (0, petals_2.getPetalStats)(oldItem.petalType, oldItem.rarity);
                        if (oldPetalStats?.petMobType) {
                            const petToDespawn = constants_2.enemies.find(e => e.ownerId === player.id &&
                                e.type === oldPetalStats.petMobType);
                            if (petToDespawn) {
                                // console.log(`[PET] Despawning pet ${oldPetalStats.petMobType} for player ${player.id} when petal unequipped`);
                                (0, petal_actions_1.despawnPet)(petToDespawn, io);
                            }
                        }
                    }
                }
                // If new item was equipped (slot had different item or was empty)
                if (newItem && (!oldItem || !itemsMatch(oldItem, newItem))) {
                    if (newKey && newItem.rarity) {
                        // Remove item from inventory (if it exists)
                        const rarityInv = serverInventory[newItem.rarity];
                        if (rarityInv && rarityInv[newKey] && rarityInv[newKey] > 0) {
                            (0, playerManager_1.removeItem)(serverInventory, newItem.rarity, newKey, 1);
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
                    // console.log(`[PET DEBUG] Petal at index ${index}: type=${petal.petalType}, rarity=${petal.rarity}, isNewPetal=${isNewPetal}`);
                    // If it's a new petal, set it on cooldown and start the cooldown timer
                    if (isNewPetal && petal.petalType) {
                        petal.onCooldown = true;
                        const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity || 'common');
                        // console.log(`[PET DEBUG] Petal stats for ${petal.petalType}:`, petalStats ? { petMobType: petalStats.petMobType, petMobRarity: petalStats.petMobRarity } : 'null');
                        if (petalStats) {
                            const cooldownTime = petalStats.cooldown || 10000;
                            // Capture targetPlayerId in closure for setTimeout
                            const targetId = targetPlayerId;
                            setTimeout(() => {
                                if (constants_2.players[targetId] && constants_2.players[targetId].loadout[index] &&
                                    constants_2.players[targetId].loadout[index].onCooldown) {
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
                                    (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, constants_2.players[targetId]);
                                    constants_2.players[targetId].loadout[index] = restoredPetal;
                                    io.emit('petalRestored', {
                                        playerId: constants_2.players[targetId].id,
                                        slotIndex: index,
                                        petal: constants_2.players[targetId].loadout[index]
                                    });
                                    // Check if this petal should spawn a pet when restored
                                    // Get fresh petal stats to ensure we have the latest petMobType
                                    if (restoredPetal.petalType && restoredPetal.rarity) {
                                        const restoredPetalStats = (0, petals_2.getPetalStats)(restoredPetal.petalType, restoredPetal.rarity);
                                        // console.log(`[PET DEBUG] Restored petal stats:`, restoredPetalStats ? { petMobType: restoredPetalStats.petMobType, petMobRarity: restoredPetalStats.petMobRarity } : 'null');
                                        if (restoredPetalStats?.petMobType && restoredPetal.rarity) {
                                            const petMobType = restoredPetalStats.petMobType;
                                            // Pet inherits the petal's rarity
                                            const player = constants_2.players[targetPlayerId];
                                            if (player && !player.isDead) {
                                                // console.log(`[PET] Spawning pet ${petMobType} (${restoredPetal.rarity}) for player ${player.id} when petal restored`);
                                                (0, petal_actions_1.spawnPet)(petMobType, restoredPetal.rarity, player.x, player.y, player.id, io);
                                            }
                                            else {
                                                // console.log(`[PET DEBUG] Player check failed: player=${!!player}, isDead=${player?.isDead}`);
                                            }
                                        }
                                        else {
                                            // console.log(`[PET DEBUG] No petMobType in restored petal stats`);
                                        }
                                    }
                                    else {
                                        // console.log(`[PET DEBUG] Missing petalType or rarity: petalType=${restoredPetal.petalType}, rarity=${restoredPetal.rarity}`);
                                    }
                                }
                            }, cooldownTime);
                        }
                    }
                    // Check if this petal should spawn a pet when first equipped (spawn immediately)
                    if (isNewPetal && petal.petalType) {
                        const petalStatsForSpawn = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity || 'common');
                        // console.log(`[PET DEBUG] Checking for immediate spawn: petalStatsForSpawn=`, petalStatsForSpawn ? { petMobType: petalStatsForSpawn.petMobType, petMobRarity: petalStatsForSpawn.petMobRarity } : 'null');
                        if (petalStatsForSpawn?.petMobType && petal.rarity) {
                            const petMobType = petalStatsForSpawn.petMobType;
                            // Pet inherits the petal's rarity
                            // Spawn pet immediately when petal is first equipped
                            const player = constants_2.players[targetPlayerId];
                            // console.log(`[PET DEBUG] Player check: player=`, !!player, `isDead=`, player?.isDead);
                            if (player && !player.isDead) {
                                // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${player.id} when petal equipped`);
                                (0, petal_actions_1.spawnPet)(petMobType, petal.rarity, player.x, player.y, player.id, io);
                            }
                            else {
                                // console.log(`[PET DEBUG] Failed to spawn: player=${!!player}, isDead=${player?.isDead}`);
                            }
                        }
                        else {
                            // console.log(`[PET DEBUG] No petMobType found in petalStatsForSpawn`);
                        }
                    }
                }
            });
            // Use validated loadout and server's authoritative inventory
            player.loadout = validatedLoadout;
            player.inventory = serverInventory; // Use server's inventory, not client's
            // Check if this player is split and update the other split player's inventory reference
            // (splitState was already declared above, so we can reuse it)
            if (splitState) {
                // Both players share the same inventory, so update the other player's reference
                if (splitState.player1.id === socket.id) {
                    splitState.player2.inventory = serverInventory;
                }
                else if (splitState.player2.id === socket.id) {
                    splitState.player1.inventory = serverInventory;
                }
            }
            // Recalculate player stats based on equipped petal modifiers
            (0, playerManager_1.recalculatePlayerStats)(player, io);
            // Only the player needs their own loadout update
            socket.emit('playerUpdated', player);
        }
    });
    // Add to class-level variables after other declarations
    const chatHistory = [];
    const MAX_CHAT_HISTORY = 100; // Keep last 100 messages
    // Add this inside the socket.io connection handler (after other socket handlers)
    socket.on('chatMessage', (message) => {
        if (!socket.username)
            return; // Ensure user is authenticated
        // Check for admin commands
        if ((0, commands_1.handleAdminCommand)(message, socket, io, commandDeps)) {
            return; // Don't process as regular chat message
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
                    helpText += (0, commands_1.getAdminHelpText)();
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
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No ultra mobs currently spawned.',
                        timestamp: Date.now()
                    });
                }
                else {
                    ultraMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / constants_2.SCALE_FACTOR);
                        const y = Math.round(mob.y / constants_2.SCALE_FACTOR);
                        io.to(socket.id).emit('chatMessage', {
                            sender: 'System',
                            content: `Ultra ${mob.type} at position (${x}, ${y})`,
                            timestamp: Date.now()
                        });
                        // Emit viewport animation event with delay for each mob
                        // setTimeout(() => { // too many ultra mobs, gets stuck
                        //     socket.emit('animateViewportToMob', {
                        //         x: mob.x,
                        //         y: mob.y,
                        //         mobType: mob.type,
                        //         rarity: 'ultra'
                        //     });
                        // }, index * 2500); // 2.5 second delay between each mob animation
                    });
                }
                return;
            }
            if (command === 'list_super') {
                // Exclude target dummies from list commands
                const superMobs = constants_2.enemies.filter(e => e.tier === 'super' && e.type !== 'target_dummy');
                if (superMobs.length === 0) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No super mobs currently spawned.',
                        timestamp: Date.now()
                    });
                }
                else {
                    superMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / constants_2.SCALE_FACTOR);
                        const y = Math.round(mob.y / constants_2.SCALE_FACTOR);
                        io.to(socket.id).emit('chatMessage', {
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
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No unique mobs currently spawned.',
                        timestamp: Date.now()
                    });
                }
                else {
                    uniqueMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / constants_2.SCALE_FACTOR);
                        const y = Math.round(mob.y / constants_2.SCALE_FACTOR);
                        io.to(socket.id).emit('chatMessage', {
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
            io.to(socket.id).emit('chatMessage', {
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
    // Handle ping/pong for heartbeat monitoring and connection quality tracking
    socket.on('ping', (clientTime) => {
        socket.emit('pong', clientTime);
        // Track connection quality based on ping
        const serverTime = Date.now();
        const ping = serverTime - clientTime;
        // Initialize connection quality tracking if not exists
        if (!socket.pingSamples) {
            socket.pingSamples = [];
            socket.connectionQuality = 'good';
            socket.averagePing = 0;
        }
        // Add ping sample
        socket.pingSamples.push(ping);
        if (socket.pingSamples.length > 10) {
            socket.pingSamples.shift();
        }
        // Calculate average ping
        socket.averagePing = socket.pingSamples.reduce((a, b) => a + b, 0) / socket.pingSamples.length;
        // Determine connection quality
        if (socket.averagePing > 200) {
            socket.connectionQuality = 'slow';
        }
        else if (socket.averagePing > 100) {
            socket.connectionQuality = 'medium';
        }
        else {
            socket.connectionQuality = 'good';
        }
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
        // Recalculate player stats based on level, skills, and petal modifiers
        // This will automatically scale health proportionally if maxHealth changes
        (0, playerManager_1.recalculatePlayerStats)(player, io);
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
        // Emit skills update (only to this player)
        socket.emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });
        // Emit player update to sync stats (only to this player)
        socket.emit('playerUpdated', player);
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
        // Recalculate player stats (without skill multipliers, but with petal modifiers)
        // This will automatically scale health proportionally if maxHealth changes
        (0, playerManager_1.recalculatePlayerStats)(player, io);
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
        // Emit skills update (only to this player)
        socket.emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });
        // Emit player update to sync stats (only to this player)
        socket.emit('playerUpdated', player);
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
                        const chatMessage = `<b style="color: ${rarityColor};">A ${petalName}has been crafted by <b style="color: #00ff00;">@${username}</b> [<b style="color: yellow;">${playerNickname}</b>]</b>`;
                        const plainMessage = `A ${petalName} has been crafted by @${username} [${playerNickname}]`;
                        io.emit('chatMessage', {
                            sender: '',
                            content: chatMessage,
                            timestamp: Date.now()
                        });
                        // Save to global notifications with player info
                        const notification = {
                            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            type: newRarity === 'unique' ? 'unique_craft' : 'super_craft',
                            message: plainMessage,
                            timestamp: Date.now()
                        };
                        database_1.database.addNotification(notification);
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
    // Shop handlers
    socket.on('shopBuy', (data) => {
        try {
            const player = constants_2.players[socket.id];
            if (!player) {
                socket.emit('shopPurchaseError', 'Player not found');
                return;
            }
            const stars = player.stars || 0;
            if (stars < data.price) {
                socket.emit('shopPurchaseError', 'Insufficient stars');
                return;
            }
            // Check if petal exists
            const petalStats = (0, petals_2.getPetalStats)(data.petalType, data.rarity);
            if (!petalStats) {
                socket.emit('shopPurchaseError', 'Invalid petal');
                return;
            }
            // Skip admin petals
            if (petalStats.isAdminPetal) {
                socket.emit('shopPurchaseError', 'Cannot purchase admin petals');
                return;
            }
            // Skip unique rarity - not purchasable
            if (data.rarity === 'unique') {
                socket.emit('shopPurchaseError', 'Cannot purchase unique rarity petals');
                return;
            }
            // Deduct stars
            player.stars = stars - data.price;
            // Add item to inventory
            const itemKey = `petal_${data.petalType}`;
            (0, playerManager_1.addItem)(player.inventory, data.rarity, itemKey, 1);
            // Save progress
            const userId = gameState_1.playerUserIds[socket.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
            // Emit success (only to this player)
            socket.emit('shopPurchaseSuccess', {
                inventory: player.inventory,
                stars: player.stars
            });
            socket.emit('playerUpdated', player);
        }
        catch (error) {
            console.error('[SHOP] Error during purchase:', error);
            socket.emit('shopPurchaseError', 'An error occurred during purchase');
        }
    });
    socket.on('redeemCode', (data) => {
        try {
            const player = constants_2.players[socket.id];
            if (!player) {
                socket.emit('codeRedeemError', 'Player not found');
                return;
            }
            const code = data.code.trim().toUpperCase();
            const redeemedCode = exports.redeemedCodes.get(code);
            if (!redeemedCode) {
                socket.emit('codeRedeemError', 'Invalid code');
                return;
            }
            // Check if code is already used by this player
            const userId = gameState_1.playerUserIds[socket.id];
            if (redeemedCode.usedBy && redeemedCode.usedBy.includes(userId || socket.id)) {
                socket.emit('codeRedeemError', 'Code already redeemed');
                return;
            }
            // Check if code has usage limit
            if (redeemedCode.maxUses && redeemedCode.uses >= redeemedCode.maxUses) {
                socket.emit('codeRedeemError', 'Code has reached maximum uses');
                return;
            }
            // Award stars
            if (player.stars === undefined) {
                player.stars = 0;
            }
            player.stars += redeemedCode.stars;
            // Track usage
            redeemedCode.uses++;
            if (!redeemedCode.usedBy) {
                redeemedCode.usedBy = [];
            }
            redeemedCode.usedBy.push(userId || socket.id);
            // Check if code has reached max uses
            const hasReachedMaxUses = redeemedCode.maxUses && redeemedCode.uses >= redeemedCode.maxUses;
            if (hasReachedMaxUses) {
                // Remove code from memory and database since it's fully used
                exports.redeemedCodes.delete(code);
                deleteCodeFromDatabase(code);
            }
            else {
                // Save code usage to database (only if not fully used)
                saveCodeToDatabase(code, redeemedCode);
            }
            // Save progress
            if (userId) {
                savePlayerProgress(player, userId);
            }
            // Emit success
            socket.emit('codeRedeemSuccess', {
                code: code,
                stars: redeemedCode.stars,
                totalStars: player.stars
            });
            // Save to global notifications with player info
            const username = socket.username || 'Unknown';
            const playerNickname = player.name || username;
            const notification = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'star_code',
                message: `Star code "${code}" redeemed by @${username} [${playerNickname}]! +${redeemedCode.stars} ⭐ Stars`,
                timestamp: Date.now()
            };
            database_1.database.addNotification(notification);
            socket.emit('playerUpdated', player);
        }
        catch (error) {
            console.error('[SHOP] Error during code redemption:', error);
            socket.emit('codeRedeemError', 'An error occurred during code redemption');
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
            enemy.health = Math.max(0, enemy.health - poisonDamageThisTick);
            // Track poison damage for all contributing players
            activePoisons.forEach(poison => {
                (0, utils_1.trackDamage)(enemy, poison.playerId, poison.damage * deltaTime * 1000);
            });
            // Mark enemy for batched damage update at end of frame
            if (!enemy.pendingDamageUpdate) {
                enemy.pendingDamageUpdate = true;
            }
            enemy.lastDamageHealth = enemy.health;
            // Check if enemy dies from poison (only process once per enemy)
            if (enemy.health <= 0 && !enemy.isDead) {
                // Mark enemy as dead to prevent multiple death handlers
                enemy.isDead = true;
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
                    // Track mob kill for eligible players (use debounced save to prevent lag)
                    (0, utils_1.trackMobKill)(enemy, constants_2.players, gameState_1.playerUserIds, database_1.database, io, savePlayerProgress);
                    // Handle mob drops (includes all eligible players)
                    handleMobDrops(enemy);
                    (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
                    // Clean up enemy data structures before removal to prevent memory leaks
                    (0, utils_1.cleanupEnemy)(enemy);
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
        // Check if this is a pet (has ownerId)
        const isPet = !!enemy.ownerId;
        if (isPet) {
            // Pet behavior: follow owner and attack wild mobs
            const owner = constants_2.players[enemy.ownerId];
            if (owner && !owner.isDead) {
                // Check if there's a clear line of sight to owner
                const hasLOS = (0, physics_1.hasLineOfSight)(enemy.x, enemy.y, owner.x, owner.y);
                if (hasLOS) {
                    // Follow owner if there's line of sight (no distance limit)
                    const dx = owner.x - enemy.x;
                    const dy = owner.y - enemy.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance > 0 && enemy.speed > 0) {
                        const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER;
                        enemy.x += (dx / distance) * speed;
                        enemy.y += (dy / distance) * speed;
                        enemy.angle = Math.atan2(dy, dx);
                    }
                }
                else {
                    // No line of sight - teleport pet to near owner
                    // Try positions around the owner in a circle
                    const teleportDistance = 80; // Distance from owner to teleport
                    const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
                    let teleported = false;
                    for (const angle of angles) {
                        const teleportX = owner.x + Math.cos(angle) * teleportDistance;
                        const teleportY = owner.y + Math.sin(angle) * teleportDistance;
                        // Check if teleport position is in a wall tile
                        const teleportTileState = (0, constants_2.getTileState)(map_data_1.WALL_GRID, teleportX, teleportY);
                        const isInWall = teleportTileState === 1 || teleportTileState === 2;
                        // If position is safe and has line of sight, teleport there
                        if (!isInWall && (0, physics_1.hasLineOfSight)(teleportX, teleportY, owner.x, owner.y)) {
                            enemy.x = teleportX;
                            enemy.y = teleportY;
                            const dx = owner.x - enemy.x;
                            const dy = owner.y - enemy.y;
                            if (dx !== 0 || dy !== 0) {
                                enemy.angle = Math.atan2(dy, dx);
                            }
                            teleported = true;
                            break;
                        }
                    }
                    // If no good teleport position found, try owner's position directly
                    if (!teleported) {
                        // Check if owner's position is safe for pet (not in wall tile)
                        const ownerTileState = (0, constants_2.getTileState)(map_data_1.WALL_GRID, owner.x, owner.y);
                        const isOwnerPosInWall = ownerTileState === 1 || ownerTileState === 2;
                        if (!isOwnerPosInWall) {
                            enemy.x = owner.x;
                            enemy.y = owner.y;
                        }
                    }
                }
                // Attack wild mobs (enemies without ownerId) if pet is movable
                if (enemy.speed > 0) {
                    let closestWildMob;
                    let closestWildMobDistance = Infinity;
                    for (const otherEnemy of constants_2.enemies) {
                        // Skip self, pets, and enemies without ownerId are wild
                        if (otherEnemy.id === enemy.id || otherEnemy.ownerId) {
                            continue;
                        }
                        const mobDx = otherEnemy.x - enemy.x;
                        const mobDy = otherEnemy.y - enemy.y;
                        const mobDistance = Math.sqrt(mobDx * mobDx + mobDy * mobDy);
                        // Only consider mobs with line of sight
                        if (mobDistance < closestWildMobDistance && mobDistance < (enemy.range || ENEMY_CHASE_RANGE)) {
                            if ((0, physics_1.hasLineOfSight)(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y)) {
                                closestWildMobDistance = mobDistance;
                                closestWildMob = otherEnemy;
                            }
                        }
                    }
                    // Attack closest wild mob
                    if (closestWildMob) {
                        const mobDx = closestWildMob.x - enemy.x;
                        const mobDy = closestWildMob.y - enemy.y;
                        const mobDistance = Math.sqrt(mobDx * mobDx + mobDy * mobDy);
                        if (mobDistance > 0) {
                            const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER;
                            enemy.x += (mobDx / mobDistance) * speed;
                            enemy.y += (mobDy / mobDistance) * speed;
                            enemy.angle = Math.atan2(mobDy, mobDx);
                            enemy.isChasing = true;
                        }
                    }
                    else {
                        enemy.isChasing = false;
                    }
                }
            }
            else {
                // Owner is dead or disconnected, pet wanders
                enemy.isChasing = false;
                if (!enemy.wanderTarget || currentTime - (enemy.lastWanderTime || 0) > 3000) {
                    enemy.wanderTarget = {
                        x: enemy.x + (Math.random() * 2 - 1) * ENEMY_WANDER_RANGE,
                        y: enemy.y + (Math.random() * 2 - 1) * ENEMY_WANDER_RANGE
                    };
                    enemy.lastWanderTime = currentTime;
                }
                if (enemy.wanderTarget && enemy.speed > 0) {
                    const dx = enemy.wanderTarget.x - enemy.x;
                    const dy = enemy.wanderTarget.y - enemy.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance > 5) {
                        const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER * 0.5;
                        enemy.x += (dx / distance) * speed;
                        enemy.y += (dy / distance) * speed;
                        enemy.angle = Math.atan2(dy, dx);
                    }
                }
            }
            // Handle pet projectiles (same as regular enemies)
            const mobStats = (0, mobs_2.getMobStats)(enemy.type, enemy.tier);
            if (mobStats?.projectile && enemy.speed > 0) {
                // Find closest wild mob for projectile target
                let projectileTarget;
                let projectileTargetDistance = Infinity;
                for (const otherEnemy of constants_2.enemies) {
                    if (otherEnemy.id === enemy.id || otherEnemy.ownerId) {
                        continue;
                    }
                    const mobDx = otherEnemy.x - enemy.x;
                    const mobDy = otherEnemy.y - enemy.y;
                    const mobDistance = Math.sqrt(mobDx * mobDx + mobDy * mobDy);
                    // Only consider mobs with line of sight
                    if (mobDistance < projectileTargetDistance && mobDistance < (enemy.range || ENEMY_CHASE_RANGE)) {
                        if ((0, physics_1.hasLineOfSight)(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y)) {
                            projectileTargetDistance = mobDistance;
                            projectileTarget = otherEnemy;
                        }
                    }
                }
                if (projectileTarget) {
                    const projectileConfig = mobStats.projectile;
                    const lastShotTime = enemy.lastProjectileTime || 0;
                    const cooldown = mobStats.cooldown || 2000;
                    if (currentTime - lastShotTime >= cooldown) {
                        const dx = projectileTarget.x - enemy.x;
                        const dy = projectileTarget.y - enemy.y;
                        const angleToTarget = Math.atan2(dy, dx);
                        const projectileSpeed = projectileConfig.speed || 200;
                        const spreadAngle = projectileConfig.spreadAngle || 0.2;
                        const projectileCount = projectileConfig.count || 1;
                        const projectileRarity = enemy.tier;
                        const petalStats = (0, petals_2.getPetalStats)(projectileConfig.petalType, projectileRarity);
                        if (petalStats) {
                            for (let i = 0; i < projectileCount; i++) {
                                let projectileAngle = angleToTarget;
                                if (projectileCount > 1) {
                                    const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                                    projectileAngle = angleToTarget + spreadOffset;
                                }
                                // Scale projectile distance and size by 1/9 of mob's rarity size scaling
                                const sizeScale = (mobs_2.SIZE_SCALING[enemy.tier] || 1) / 9;
                                const scaledDistance = projectileConfig.distance * sizeScale;
                                const scaledSize = petalStats.size * sizeScale;
                                const projectile = {
                                    id: `${enemy.id}_projectile_${currentTime}_${i}`,
                                    enemyId: enemy.id,
                                    x: enemy.x,
                                    y: enemy.y,
                                    startX: enemy.x,
                                    startY: enemy.y,
                                    angle: projectileAngle,
                                    speed: projectileSpeed / 1000,
                                    distance: 0,
                                    maxDistance: scaledDistance,
                                    petalType: projectileConfig.petalType,
                                    petalRarity: projectileRarity,
                                    damage: petalStats.damage,
                                    size: scaledSize, // Mob projectiles scale size with rarity
                                    health: petalStats.health,
                                    maxHealth: petalStats.health
                                };
                                gameState_1.mobProjectiles.push(projectile);
                            }
                            enemy.lastProjectileTime = currentTime;
                        }
                    }
                }
            }
            // Skip regular enemy behavior for pets - handle wall collisions and move to next enemy
            const mobStatsForSize = (0, mobs_2.getMobStats)(enemy.type, enemy.tier);
            (0, physics_1.checkEnemyWallCollisions)(enemy);
            // Continue to next iteration (pets skip regular enemy behavior)
        }
        else {
            // Regular enemy behavior (not a pet)
            // Calculate 5x view distance threshold
            const MAX_TARGET_DISTANCE = constants_2.VIEWPORT_WIDTH * 5;
            // Check if we have an existing target that's still in range
            let targetPlayer;
            let targetDistance = Infinity;
            if (enemy.targetPlayerId && constants_2.players[enemy.targetPlayerId]) {
                const existingTarget = constants_2.players[enemy.targetPlayerId];
                if (!existingTarget.isDead) {
                    const dx = existingTarget.x - enemy.x;
                    const dy = existingTarget.y - enemy.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    // Keep targeting if within 5x view distance AND has line of sight
                    // If wall blocks line of sight, stop targeting
                    if (distance <= MAX_TARGET_DISTANCE && (0, physics_1.hasLineOfSight)(enemy.x, enemy.y, existingTarget.x, existingTarget.y)) {
                        targetPlayer = existingTarget;
                        targetDistance = distance;
                    }
                    else {
                        // Player moved too far away or wall blocking, clear target
                        enemy.targetPlayerId = undefined;
                    }
                }
                else {
                    // Target is dead, clear target
                    enemy.targetPlayerId = undefined;
                }
            }
            // If no existing target or existing target is out of range, look for new targets
            if (!targetPlayer) {
                // Find closest living player with line of sight (for initial targeting)
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
                    // Only consider players with line of sight for initial targeting
                    if (distance < closestDistance && (0, physics_1.hasLineOfSight)(enemy.x, enemy.y, player.x, player.y)) {
                        closestDistance = distance;
                        closestPlayer = player;
                    }
                });
                // If we found a new target within chase range, start targeting them
                if (closestPlayer && closestDistance < (enemy.range || ENEMY_CHASE_RANGE)) {
                    enemy.targetPlayerId = closestPlayer.id;
                    targetPlayer = closestPlayer;
                    targetDistance = closestDistance;
                }
            }
            // Find closest pet (enemy with ownerId) as alternative target (only if no player target)
            let closestPet;
            let closestPetDistance = Infinity;
            if (!targetPlayer) {
                for (const otherEnemy of constants_2.enemies) {
                    if (otherEnemy.ownerId && otherEnemy.id !== enemy.id) {
                        const petDx = otherEnemy.x - enemy.x;
                        const petDy = otherEnemy.y - enemy.y;
                        const petDistance = Math.sqrt(petDx * petDx + petDy * petDy);
                        // Only consider pets with line of sight
                        if (petDistance < closestPetDistance && petDistance < (enemy.range || ENEMY_CHASE_RANGE)) {
                            if ((0, physics_1.hasLineOfSight)(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y)) {
                                closestPetDistance = petDistance;
                                closestPet = otherEnemy;
                            }
                        }
                    }
                }
            }
            // Prioritize players, but target pets if no player is in range
            const target = targetPlayer
                ? targetPlayer
                : (closestPet ? closestPet : null);
            // Move enemy based on behavior
            if (target && enemy.isHostile) {
                const isTargetingPlayer = target === targetPlayer;
                const targetX = isTargetingPlayer ? targetPlayer.x : closestPet.x;
                const targetY = isTargetingPlayer ? targetPlayer.y : closestPet.y;
                const currentTargetDistance = isTargetingPlayer ? targetDistance : closestPetDistance;
                // Chase target (player or pet)
                enemy.isChasing = true;
                const dx = targetX - enemy.x;
                const dy = targetY - enemy.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                // Update target distance for player targets
                if (isTargetingPlayer) {
                    targetDistance = distance;
                }
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
                const mobStats = (0, mobs_2.getMobStats)(enemy.type, enemy.tier);
                if (mobStats?.projectile && target) {
                    const projectileConfig = mobStats.projectile;
                    const lastShotTime = enemy.lastProjectileTime || 0;
                    const cooldown = mobStats.cooldown || 2000;
                    // Check if cooldown has passed
                    if (currentTime - lastShotTime >= cooldown) {
                        // Calculate angle to target (player or pet)
                        const angleToTarget = Math.atan2(dy, dx);
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
                                let projectileAngle = angleToTarget;
                                if (projectileCount > 1) {
                                    const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                                    projectileAngle = angleToTarget + spreadOffset;
                                }
                                // Scale projectile distance and size by 1/9 of mob's rarity size scaling
                                const sizeScale = (mobs_2.SIZE_SCALING[enemy.tier] || 1) / 9;
                                const scaledDistance = projectileConfig.distance * sizeScale;
                                const scaledSize = petalStats.size * sizeScale;
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
                                    maxDistance: scaledDistance,
                                    petalType: projectileConfig.petalType,
                                    petalRarity: projectileRarity,
                                    damage: petalStats.damage,
                                    size: scaledSize, // Mob projectiles scale size with rarity
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
                // Not chasing - clear target if we had one
                enemy.isChasing = false;
                if (enemy.targetPlayerId) {
                    // Check if target is still within max distance
                    const existingTarget = constants_2.players[enemy.targetPlayerId];
                    if (existingTarget && !existingTarget.isDead) {
                        const dx = existingTarget.x - enemy.x;
                        const dy = existingTarget.y - enemy.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (distance > MAX_TARGET_DISTANCE) {
                            enemy.targetPlayerId = undefined;
                        }
                    }
                    else {
                        enemy.targetPlayerId = undefined;
                    }
                }
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
            const mobStats = (0, mobs_2.getMobStats)(enemy.type, enemy.tier);
            const enemySize = mobStats ? mobStats.size * 40 : constants_2.ENEMY_SIZE;
            const halfSize = enemySize / 2;
            // // Check if enemy goes out of bounds - kill them -- no longer needed since enemies no longer spawn out of bounds
            // if (enemy.x < 0 || enemy.x >= ACTUAL_WORLD_WIDTH || enemy.y < 0 || enemy.y >= ACTUAL_WORLD_HEIGHT) {
            //     enemy.health = 0;
            //     // Remove enemy immediately if out of bounds
            //     const index = enemies.findIndex(e => e.id === enemy.id);
            //     if (index !== -1) {
            //         enemies.splice(index, 1);
            //         io.emit('enemyDestroyed', enemy.id);
            //         updateSpecialMobCounts();
            //         // Try to spawn a new enemy to replace the one that went out of bounds
            //         const newEnemy = createEnemy();
            //         if (newEnemy) {
            //             enemies.push(newEnemy);
            //         }
            //     }
            //     // Skip wall collision checks if enemy is being removed
            //     return;
            // }
            // Check for wall collisions
            (0, physics_1.checkEnemyWallCollisions)(enemy);
        }
    });
    // Check for mob-to-mob collisions and melee combat
    (0, physics_1.checkEnemyEnemyCollisions)(constants_2.enemies, io);
    // Remove dead enemies after melee combat and handle XP/loot
    for (let i = constants_2.enemies.length - 1; i >= 0; i--) {
        const enemy = constants_2.enemies[i];
        if (enemy.isDead || enemy.health <= 0) {
            // Check if this was killed by a pet - find the pet that killed it
            // We'll use damage contributors to determine who gets XP/loot
            if (enemy.damageContributors && enemy.damageContributors.size > 0) {
                // Find the top contributor (could be a pet owner)
                let topContributor;
                let maxDamage = 0;
                enemy.damageContributors.forEach((damage, playerId) => {
                    if (damage > maxDamage) {
                        maxDamage = damage;
                        topContributor = playerId;
                    }
                });
                // Award XP and handle drops for the top contributor
                if (topContributor && constants_2.players[topContributor]) {
                    const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                    addXPToPlayer(constants_2.players[topContributor], xpGained, topContributor);
                    (0, utils_1.trackMobKill)(enemy, constants_2.players, gameState_1.playerUserIds, database_1.database, io, savePlayerProgress);
                    handleMobDrops(enemy);
                    (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
                }
            }
            // Clean up enemy data structures before removal to prevent memory leaks
            (0, utils_1.cleanupEnemy)(enemy);
            constants_2.enemies.splice(i, 1);
            updateSpecialMobCounts();
        }
    }
    // Don't send enemiesUpdate here - enemies are sent via enemySpawned/enemyDestroyed events
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
        if ((0, physics_1.checkProjectileWallCollision)(projectile.x, projectile.y, halfSize)) {
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
            const playerRangeModifier = (0, playerManager_1.calculatePlayerModifiers)(player).range ?? 1.0;
            for (let idx = 0; idx < petalInstances.length; idx++) {
                const { petal, instanceIndex, loadoutIndex } = petalInstances[idx];
                if (!petal || !petal.health || petal.health <= 0 || petal.onCooldown) {
                    continue;
                }
                const petalStats = (0, petals_2.getPetalStats)(petal.petalType, petal.rarity);
                if (!petalStats)
                    continue;
                // Get effective size (custom size if set, otherwise base stats)
                const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
                const rotationSpeed = (petalStats.speed ?? 1.0) * 0.002;
                const baseAngle = idx * angleStep;
                const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
                const totalAngle = baseAngle + rotationAngle;
                const petalRange = (petalStats.range ?? 1.0) * playerRangeModifier;
                const petalRadius = baseRadius * petalRange;
                const petalX = player.x + Math.cos(totalAngle) * petalRadius;
                const petalY = player.y + Math.sin(totalAngle) * petalRadius;
                const petalSize = 40 * effectiveSize;
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
                    petal.health = Math.max(0, petal.health - projectileDamage);
                    // Damage the mob projectile
                    projectile.health -= petalStats.damage;
                    hitPlayerPetal = true;
                    // Remove projectile if destroyed
                    if (projectile.health <= 0) {
                        gameState_1.mobProjectiles.splice(i, 1);
                        hitPlayerPetal = true; // Mark as hit so we skip player collision check
                        break; // Exit petal loop
                    }
                    // If petal breaks, break it immediately
                    if (petal.health <= 0) {
                        // Execute petal actions before breaking
                        if (petalStats.actions) {
                            const actionContext = {
                                player: player,
                                petalX: petalX,
                                petalY: petalY,
                                petalSize: petalSize,
                                petalDamage: petalStats.damage,
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
                            }
                        }, cooldownTime);
                        io.emit('petalBroken', {
                            playerId: player.id,
                            slotIndex: loadoutIndex,
                            petalType: petal.petalType,
                            rarity: petal.rarity
                        });
                    }
                    break; // Exit petal loop
                }
            }
            if (hitPlayerPetal) {
                break; // Exit player loop if we hit a petal
            }
        }
        // Check for collision with wild mobs (enemies without ownerId) if this is a pet projectile
        const projectileEnemy = constants_2.enemies.find(e => e.id === projectile.enemyId);
        const isPetProjectile = projectileEnemy?.ownerId;
        const petOwnerId = projectileEnemy?.ownerId;
        if (!hitPlayerPetal && projectile.health > 0 && isPetProjectile && petOwnerId) {
            // Pet projectile can hit wild mobs
            for (let j = constants_2.enemies.length - 1; j >= 0; j--) {
                const targetEnemy = constants_2.enemies[j];
                // Skip if target is a pet or the same enemy that shot the projectile
                if (targetEnemy.ownerId || targetEnemy.id === projectile.enemyId) {
                    continue;
                }
                const targetMobStats = (0, mobs_2.getMobStats)(targetEnemy.type, targetEnemy.tier);
                const targetEnemySize = targetMobStats ? targetMobStats.size * 40 : constants_2.ENEMY_SIZE;
                const targetEnemyHalfSize = targetEnemySize / 2;
                const dx = targetEnemy.x - projectile.x;
                const dy = targetEnemy.y - projectile.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const hitRadius = targetEnemyHalfSize + halfSize;
                if (distance < hitRadius) {
                    // Pet projectile hits wild mob
                    const projectilePetalStats = (0, petals_2.getPetalStats)(projectile.petalType, projectile.petalRarity);
                    const projectileDamage = projectilePetalStats ? projectilePetalStats.damage : projectile.damage;
                    // Track damage with pet owner's ID
                    (0, utils_1.trackDamage)(targetEnemy, petOwnerId, projectileDamage);
                    // Skip further processing if enemy is already dead
                    if (targetEnemy.isDead) {
                        gameState_1.mobProjectiles.splice(i, 1);
                        break;
                    }
                    targetEnemy.health = Math.max(0, targetEnemy.health - projectileDamage);
                    io.emit('enemyDamaged', { enemyId: targetEnemy.id, health: targetEnemy.health });
                    // Apply knockback
                    if (distance > 0) {
                        const knockbackForce = 20;
                        const normalizedDx = dx / distance;
                        const normalizedDy = dy / distance;
                        const mobMass = targetMobStats ? targetMobStats.mass : 1.0;
                        const effectiveKnockback = knockbackForce / mobMass;
                        targetEnemy.knockbackX = normalizedDx * effectiveKnockback;
                        targetEnemy.knockbackY = normalizedDy * effectiveKnockback;
                    }
                    // Check if enemy dies
                    if (targetEnemy.health <= 0 && !targetEnemy.isDead) {
                        targetEnemy.isDead = true;
                        const owner = constants_2.players[petOwnerId];
                        if (owner) {
                            // Follow same path as lightning damage - synchronous execution
                            const xpGained = (0, server_utils_1.getXPFromEnemy)(targetEnemy);
                            addXPToPlayer(owner, xpGained, petOwnerId);
                            handleMobDrops(targetEnemy);
                            (0, utils_1.sendBossMobDefeatedMessage)(targetEnemy, io, constants_2.players);
                            updateSpecialMobCounts();
                        }
                        // Remove enemy from array
                        (0, utils_1.cleanupEnemy)(targetEnemy);
                        constants_2.enemies.splice(j, 1);
                        // Emit enemy destroyed event
                        io.emit('enemyDestroyed', targetEnemy.id);
                        // Defer trackMobKill since it's expensive (emits playerUpdated to all players)
                        // Copy enemy data before cleanup to ensure trackMobKill has all needed info
                        const damageContributorsCopy = targetEnemy.damageContributors ? new Map(targetEnemy.damageContributors) : undefined;
                        if (damageContributorsCopy && owner) {
                            const enemyDataForTracking = {
                                type: targetEnemy.type,
                                tier: targetEnemy.tier,
                                damageContributors: damageContributorsCopy
                            };
                            setImmediate(() => {
                                (0, utils_1.trackMobKill)(enemyDataForTracking, constants_2.players, gameState_1.playerUserIds, database_1.database, io, savePlayerProgress);
                            });
                        }
                    }
                    // Remove projectile after hitting enemy
                    gameState_1.mobProjectiles.splice(i, 1);
                    break;
                }
            }
        }
        // Only check for direct player collision if we didn't hit a petal and projectile still exists
        // Skip projectiles from pets (enemies with ownerId)
        if (!hitPlayerPetal && projectile.health > 0 && !isPetProjectile) {
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
                            (0, petal_actions_1.despawnAllPlayerPets)(player.id, io);
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
    // Emit projectile updates to nearby players only (spatial filtering)
    for (const playerId of Object.keys(constants_2.players)) {
        const player = constants_2.players[playerId];
        if (!player)
            continue;
        const socket = io.sockets.sockets.get(playerId);
        if (!socket || !socket.userId)
            continue;
        const vw = (player.viewportWidth || constants_2.VIEWPORT_WIDTH) * 1.5;
        const vh = (player.viewportHeight || constants_2.VIEWPORT_HEIGHT) * 1.5;
        const filtered = gameState_1.mobProjectiles.filter(p => Math.abs(p.x - player.x) < vw && Math.abs(p.y - player.y) < vh);
        io.to(playerId).emit('mobProjectilesUpdate', filtered);
    }
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
        if ((0, physics_1.checkProjectileWallCollision)(projectile.x, projectile.y, halfSize)) {
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
            // Skip all pets (pets should not be damaged by any player's projectiles)
            if (enemy.ownerId) {
                continue;
            }
            const mobStats = (0, mobs_2.getMobStats)(enemy.type, enemy.tier);
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
                // Track damage dealt by this player (always track, even if enemy is dead)
                (0, utils_1.trackDamage)(enemy, projectile.playerId, finalDamage);
                // Skip further processing if enemy is already dead (being processed)
                if (enemy.isDead) {
                    continue;
                }
                enemy.health = Math.max(0, enemy.health - finalDamage);
                // Mark enemy for batched damage update at end of frame
                if (!enemy.pendingDamageUpdate) {
                    enemy.pendingDamageUpdate = true;
                }
                enemy.lastDamageHealth = enemy.health;
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
                // Check if enemy dies (only process once per enemy)
                if (enemy.health <= 0 && !enemy.isDead) {
                    // Mark enemy as dead to prevent multiple death handlers
                    enemy.isDead = true;
                    const player = constants_2.players[projectile.playerId];
                    if (player) {
                        // Follow same path as lightning damage - synchronous execution
                        const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                        addXPToPlayer(player, xpGained, projectile.playerId);
                        handleMobDrops(enemy);
                        (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
                        updateSpecialMobCounts();
                    }
                    // Remove enemy from array
                    (0, utils_1.cleanupEnemy)(enemy);
                    constants_2.enemies.splice(j, 1);
                    // Emit enemy destroyed event
                    io.emit('enemyDestroyed', enemy.id);
                    // Call trackMobKill synchronously to ensure it runs
                    // Copy enemy data before cleanup to ensure trackMobKill has all needed info
                    const damageContributorsCopy = enemy.damageContributors ? new Map(enemy.damageContributors) : undefined;
                    console.log('[Server] Enemy killed by player projectile - BEFORE cleanup', {
                        enemyType: enemy.type,
                        enemyTier: enemy.tier,
                        hasDamageContributors: !!enemy.damageContributors,
                        damageContributorsSize: enemy.damageContributors?.size || 0,
                        hasDamageContributorsCopy: !!damageContributorsCopy,
                        hasIo: !!io,
                        hasPlayer: !!player
                    });
                    if (damageContributorsCopy && player) {
                        const enemyDataForTracking = {
                            type: enemy.type,
                            tier: enemy.tier,
                            damageContributors: damageContributorsCopy
                        };
                        console.log('[Server] Calling trackMobKill synchronously (projectile)', {
                            enemyType: enemyDataForTracking.type,
                            enemyTier: enemyDataForTracking.tier,
                            hasIo: !!io,
                            damageContributorsSize: enemyDataForTracking.damageContributors.size
                        });
                        (0, utils_1.trackMobKill)(enemyDataForTracking, constants_2.players, gameState_1.playerUserIds, database_1.database, io, savePlayerProgress);
                    }
                    else {
                        console.warn('[Server] No damageContributorsCopy or player (projectile), skipping trackMobKill');
                    }
                }
                // Remove projectile after hitting enemy
                gameState_1.playerProjectiles.splice(i, 1);
                break;
            }
        }
    }
    // Emit projectile updates to nearby players only (spatial filtering)
    for (const playerId of Object.keys(constants_2.players)) {
        const player = constants_2.players[playerId];
        if (!player)
            continue;
        const socket = io.sockets.sockets.get(playerId);
        if (!socket || !socket.userId)
            continue;
        const vw = (player.viewportWidth || constants_2.VIEWPORT_WIDTH) * 1.5;
        const vh = (player.viewportHeight || constants_2.VIEWPORT_HEIGHT) * 1.5;
        const filtered = gameState_1.playerProjectiles.filter(p => Math.abs(p.x - player.x) < vw && Math.abs(p.y - player.y) < vh);
        io.to(playerId).emit('playerProjectilesUpdate', filtered);
    }
}
// updatePlayerState moved to playerState module - using imported function
function start_loop() {
    const TICK_RATE = 30;
    const TICK_INTERVAL = 1000 / TICK_RATE;
    const deltaTime = 1 / TICK_RATE;
    setInterval(() => {
        // Get count of authenticated players (players with userId)
        const authenticatedPlayerIds = Object.keys(constants_2.players).filter(id => {
            const socket = io.sockets.sockets.get(id);
            return socket && socket.userId;
        });
        // Skip game processing if there are no authenticated players
        if (authenticatedPlayerIds.length === 0) {
            return;
        }
        for (const id in constants_2.players) {
            (0, playerState_1.updatePlayerState)(constants_2.players[id], deltaTime, playerStateDeps);
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
        // Batch all enemy damage updates into a single event
        const damagedEnemies = [];
        for (const enemy of constants_2.enemies) {
            if (enemy.pendingDamageUpdate) {
                const health = enemy.lastDamageHealth !== undefined ? enemy.lastDamageHealth : enemy.health;
                damagedEnemies.push({ enemyId: enemy.id, health: health });
                delete enemy.pendingDamageUpdate;
                delete enemy.lastDamageHealth;
            }
        }
        // Emit batched enemy damage updates in a single event
        if (damagedEnemies.length > 0) {
            io.emit('enemiesDamaged', damagedEnemies);
        }
        // Batch all item spawn emissions into a single event per player
        const itemsByPlayer = new Map();
        for (const item of gameState_1.items) {
            if (item.pendingSpawnEmission && item.eligibleSocketIds) {
                const socketIds = item.eligibleSocketIds;
                for (const socketId of socketIds) {
                    if (!itemsByPlayer.has(socketId)) {
                        itemsByPlayer.set(socketId, []);
                    }
                    itemsByPlayer.get(socketId).push(item);
                }
                delete item.pendingSpawnEmission;
                delete item.eligibleSocketIds;
            }
        }
        // Emit batched item spawns to each player
        for (const [socketId, itemsToSend] of itemsByPlayer) {
            if (itemsToSend.length > 0) {
                io.to(socketId).emit('itemsSpawned', itemsToSend);
            }
        }
        // Despawn enemies that have been outside viewport for too long
        despawnDistantEnemies();
        // Check and fix item-wall collisions for all items
        for (const item of gameState_1.items) {
            (0, physics_1.checkItemWallCollisions)(item);
        }
        // Delete items that go out of bounds
        for (let i = gameState_1.items.length - 1; i >= 0; i--) {
            const item = gameState_1.items[i];
            if (item.x < 0 || item.x >= constants_2.ACTUAL_WORLD_WIDTH || item.y < 0 || item.y >= constants_2.ACTUAL_WORLD_HEIGHT) {
                // Clean up expiration timeout
                const timeout = gameState_1.itemExpirationTimeouts.get(item.id);
                if (timeout) {
                    clearTimeout(timeout);
                    gameState_1.itemExpirationTimeouts.delete(item.id);
                }
                // Notify eligible players that item is being removed
                if (item.eligiblePlayers) {
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
                gameState_1.items.splice(i, 1);
            }
        }
        // Periodic cleanup: Remove expired items (check every tick)
        const currentTime = Date.now();
        for (let i = gameState_1.items.length - 1; i >= 0; i--) {
            const item = gameState_1.items[i];
            if (item.spawnTime && item.rarity) {
                const expirationTime = gameState_1.ITEM_EXPIRATION_TIMES[item.rarity] || 10000;
                if (currentTime - item.spawnTime >= expirationTime) {
                    // Clean up expiration timeout if it still exists
                    const timeout = gameState_1.itemExpirationTimeouts.get(item.id);
                    if (timeout) {
                        clearTimeout(timeout);
                        gameState_1.itemExpirationTimeouts.delete(item.id);
                    }
                    // Notify eligible players that item expired
                    if (item.eligiblePlayers) {
                        for (const playerId of item.eligiblePlayers) {
                            io.to(playerId).emit('itemRemoved', item.id);
                        }
                    }
                    gameState_1.items.splice(i, 1);
                }
            }
        }
        // Periodic cleanup: Clean up old petalLastProjectileTime entries (keep only last 1000 entries)
        if (gameState_1.petalLastProjectileTime.size > 1000) {
            // Sort by value (time) and keep only the most recent 1000
            const entries = Array.from(gameState_1.petalLastProjectileTime.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 1000);
            gameState_1.petalLastProjectileTime.clear();
            entries.forEach(([key, value]) => gameState_1.petalLastProjectileTime.set(key, value));
        }
        // Helper function to quantize positions (reduce precision to save bandwidth)
        const quantize = (value, precision = 1) => {
            return Math.round(value / precision) * precision;
        };
        // Helper function to create optimized player data
        // Only send fields that change frequently; name/level/score are sent via playerUpdated
        const createPlayerData = (p, quality) => {
            const precision = quality === 'slow' ? 2 : quality === 'medium' ? 1 : 0.5;
            const petalExtension = p.inputs?.petalExtension || 1.0;
            // Compute face flags and mouth
            let faceFlags = 0;
            let mouth = 14.5; // Default smile
            if (petalExtension > 1.0) {
                faceFlags |= player_1.FaceFlags.Attacking;
                mouth = 4; // Closed mouth, positions angry triangle over eyes
            }
            if (petalExtension < 1.0) {
                faceFlags |= player_1.FaceFlags.Defending;
                mouth = 4; // Closed mouth for defensive face
            }
            // Compute equipment and petal-driven face flags from loadout
            let equipFlags = 0;
            if (p.loadout) {
                for (const item of p.loadout) {
                    if (!item || item.type !== 'petal')
                        continue;
                    if (!item.petalType)
                        continue;
                    const stats = (0, petals_2.getPetalStats)(item.petalType, item.rarity ?? 'common');
                    if (stats?.equipFlags)
                        equipFlags |= stats.equipFlags;
                    if (stats?.faceFlags)
                        faceFlags |= stats.faceFlags;
                }
            }
            return {
                id: p.id,
                name: p.name,
                x: quantize(p.x, precision),
                y: quantize(p.y, precision),
                angle: quantize(p.angle, quality === 'slow' ? 0.1 : 0.05),
                health: Math.round(p.health),
                maxHealth: Math.round(p.maxHealth),
                level: p.level,
                score: p.score,
                petalExtension: quantize(petalExtension, 0.1),
                petalPositions: (p.petalPositions || []).map((pos) => ({
                    loadoutIndex: pos.loadoutIndex,
                    instanceIndex: pos.instanceIndex,
                    x: quantize(pos.x, precision),
                    y: quantize(pos.y, precision)
                })),
                faceFlags,
                equipFlags,
                mouth,
            };
        };
        // Helper function to create optimized enemy data
        const createEnemyData = (e, quality) => {
            const precision = quality === 'slow' ? 2 : quality === 'medium' ? 1 : 0.5;
            return {
                id: e.id,
                type: e.type,
                tier: e.tier,
                x: quantize(e.x, precision),
                y: quantize(e.y, precision),
                angle: quantize(e.angle, quality === 'slow' ? 0.1 : 0.05),
                health: Math.round(e.health),
                maxHealth: Math.round(e.maxHealth)
            };
        };
        // Send optimized updates to each player based on their connection quality
        for (const playerId of authenticatedPlayerIds) {
            const socket = io.sockets.sockets.get(playerId);
            if (!socket || !socket.userId)
                continue;
            const quality = socket.connectionQuality || 'good';
            const now = Date.now();
            // Adaptive update rate: 30 TPS for good, lower for weaker connections
            let shouldUpdate = true;
            if (socket.lastUpdateTime) {
                const timeSinceLastUpdate = now - socket.lastUpdateTime;
                if (quality === 'slow' && timeSinceLastUpdate < 100) { // ~10 TPS for slow
                    shouldUpdate = false;
                }
                else if (quality === 'medium' && timeSinceLastUpdate < 67) { // ~15 TPS for medium
                    shouldUpdate = false;
                }
                // 'good' quality: send every tick (~30 TPS)
            }
            if (!shouldUpdate)
                continue;
            const player = constants_2.players[playerId];
            // Create optimized player data
            const playersForBroadcast = Object.values(constants_2.players).map(p => createPlayerData(p, quality));
            // Filter enemies to this player's viewport (200% buffer)
            const vw = (player?.viewportWidth || constants_2.VIEWPORT_WIDTH) * 2;
            const vh = (player?.viewportHeight || constants_2.VIEWPORT_HEIGHT) * 2;
            const px = player?.x || 0;
            const py = player?.y || 0;
            const viewportEnemies = constants_2.enemies.filter(e => Math.abs(e.x - px) < vw && Math.abs(e.y - py) < vh);
            // Delta compression: only send full data for enemies that changed
            if (!socket.lastSentEnemies) {
                socket.lastSentEnemies = new Map();
            }
            const lastSent = socket.lastSentEnemies;
            const changedEnemies = [];
            const unchangedIds = [];
            const currentEnemyIds = new Set();
            for (const e of viewportEnemies) {
                currentEnemyIds.add(e.id);
                const prev = lastSent.get(e.id);
                const ex = quantize(e.x, 1);
                const ey = quantize(e.y, 1);
                const ea = quantize(e.angle, 0.05);
                const eh = Math.round(e.health);
                if (!prev || prev.x !== ex || prev.y !== ey || prev.a !== ea || prev.h !== eh) {
                    changedEnemies.push(createEnemyData(e, quality));
                    lastSent.set(e.id, { x: ex, y: ey, a: ea, h: eh });
                }
                else {
                    unchangedIds.push(e.id);
                }
            }
            // Clean up enemies that left viewport
            for (const id of lastSent.keys()) {
                if (!currentEnemyIds.has(id)) {
                    lastSent.delete(id);
                }
            }
            // Build compact game state
            const gameState = {
                players: playersForBroadcast,
                enemies: changedEnemies,
                timestamp: now
            };
            // Only include unchanged IDs if there are any (client uses this to know they're still in view)
            if (unchangedIds.length > 0) {
                gameState.unchanged = unchangedIds;
            }
            socket.lastUpdateTime = now;
            io.to(playerId).emit('gameStateUpdate', gameState);
        }
    }, TICK_INTERVAL);
}
// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on ${constants_1.SERVER_PROTOCOL}://localhost:${PORT}`);
    // Debug: verify WALL_GRID is loaded
    let nonZeroTiles = 0;
    for (let y = 0; y < map_data_1.WALL_GRID.length; y++) {
        for (let x = 0; x < map_data_1.WALL_GRID[y].length; x++) {
            if (map_data_1.WALL_GRID[y][x] !== 0)
                nonZeroTiles++;
        }
    }
    console.log(`[SERVER] WALL_GRID loaded: ${map_data_1.WALL_GRID.length}x${map_data_1.WALL_GRID[0]?.length || 0}, non-zero tiles: ${nonZeroTiles}`);
});
start_loop();
// Add density maintenance interval (every 0.5 seconds) to spawn enemies as viewport moves
setInterval(() => {
    const playerCount = Object.keys(constants_2.players).length;
    if (playerCount > 0) {
        // Calculate target enemy count based on current viewport density
        const viewports = (0, playerState_1.getPlayerViewports)();
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
        const currentViewportEnemies = (0, playerState_1.getEnemiesInViewportCount)();
        if (currentViewportEnemies < targetEnemyCount) {
            // Scale spawn cap with player count so each player's viewport fills at the same rate
            const enemiesToSpawn = Math.min(3 * playerCount, targetEnemyCount - currentViewportEnemies);
            let spawned = 0;
            for (let i = 0; i < enemiesToSpawn; i++) {
                const newEnemy = createEnemy();
                if (newEnemy) {
                    constants_2.enemies.push(newEnemy);
                    spawned++;
                }
            }
            // if (spawned > 0) {
            //     console.log(`[SERVER] Density maintenance: spawned ${spawned} enemies (target: ${targetEnemyCount}, current: ${currentViewportEnemies})`);
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
setInterval(() => {
    updateTargetDummyDPS();
}, 1000); // 1 second
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
