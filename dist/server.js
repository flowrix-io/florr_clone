"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const https_1 = require("https");
const socket_io_1 = require("socket.io");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const database_1 = require("./database");
const constants_1 = require("./constants");
const server_utils_1 = require("./server_utils");
const petals_1 = require("./petals");
const mobs_1 = require("./mobs");
const app = (0, express_1.default)();
const items = [];
const decorations = [];
const sands = [];
let ENEMY_COUNT = 1000;
const playerUserIds = {}; // Maps player ID to user ID
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
// Serve static files from the dist directory
app.use(express_1.default.static(path_1.default.join(__dirname, '../dist'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));
const httpsServer = (0, https_1.createServer)({
    key: fs_1.default.readFileSync('cert.key'),
    cert: fs_1.default.readFileSync('cert.crt')
}, app);
const io = new socket_io_1.Server(httpsServer, {
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
const PORT = process.env.PORT || 3000;
// Remove or comment out these lines since we're not using grid generation anymore
// const MAZE_CELL_SIZE = 1000;
// const MAZE_WALL_THICKNESS = 100;
// Replace the initializeObstacles function with this:
function initializeMapObstacles() {
    const mapObstacles = [];
    // Convert wall elements from WORLD_MAP to obstacles
    constants_1.WORLD_MAP.filter(constants_1.isWall).forEach(wall => {
        mapObstacles.push({
            id: Math.random().toString(36).substr(2, 9),
            x: wall.x * constants_1.SCALE_FACTOR,
            y: wall.y * constants_1.SCALE_FACTOR,
            width: wall.width * constants_1.SCALE_FACTOR,
            height: wall.height * constants_1.SCALE_FACTOR,
            type: 'coral',
            isEnemy: false
        });
    });
    return mapObstacles;
}
// Update the server initialization code
// Replace the old obstacle initialization with:
constants_1.obstacles.push(...initializeMapObstacles());
// Viewport optimization functions
function getPlayerViewports() {
    const viewports = [];
    for (const playerId in constants_1.players) {
        const player = constants_1.players[playerId];
        if (player && player.x !== undefined && player.y !== undefined &&
            !isNaN(player.x) && !isNaN(player.y) &&
            player.x >= 0 && player.x <= constants_1.ACTUAL_WORLD_WIDTH &&
            player.y >= 0 && player.y <= constants_1.ACTUAL_WORLD_HEIGHT) {
            viewports.push({
                x: player.x - constants_1.VIEWPORT_WIDTH / 2,
                y: player.y - constants_1.VIEWPORT_HEIGHT / 2,
                width: constants_1.VIEWPORT_WIDTH,
                height: constants_1.VIEWPORT_HEIGHT
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
            x: viewport.x - constants_1.VIEWPORT_BUFFER,
            y: viewport.y - constants_1.VIEWPORT_BUFFER,
            width: viewport.width + (constants_1.VIEWPORT_BUFFER * 2),
            height: viewport.height + (constants_1.VIEWPORT_BUFFER * 2)
        };
        if (x >= extendedViewport.x && x <= extendedViewport.x + extendedViewport.width &&
            y >= extendedViewport.y && y <= extendedViewport.y + extendedViewport.height) {
            return true;
        }
    }
    return false;
}
function getEnemiesInViewportCount() {
    const viewports = getPlayerViewports();
    // If no players are connected, count all enemies (for initial server startup)
    if (viewports.length === 0) {
        return constants_1.enemies.length;
    }
    let count = 0;
    for (const enemy of constants_1.enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            count++;
        }
    }
    return count;
}
function updateEnemyViewportStatus() {
    const currentTime = Date.now();
    for (const enemy of constants_1.enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            enemy.lastViewportCheck = currentTime;
        }
    }
}
function validatePlayerPositions() {
    // Clean up any invalid player positions that might affect viewport calculations
    for (const playerId in constants_1.players) {
        const player = constants_1.players[playerId];
        if (player) {
            // Reset invalid positions to a safe default
            if (isNaN(player.x) || isNaN(player.y) ||
                player.x < 0 || player.x > constants_1.ACTUAL_WORLD_WIDTH ||
                player.y < 0 || player.y > constants_1.ACTUAL_WORLD_HEIGHT) {
                console.log(`[SERVER] Fixing invalid position for player ${playerId}: (${player.x}, ${player.y})`);
                // Reset to center of world
                player.x = constants_1.ACTUAL_WORLD_WIDTH / 2;
                player.y = constants_1.ACTUAL_WORLD_HEIGHT / 2;
                // Notify client of position correction
                io.to(playerId).emit('positionCorrected', { x: player.x, y: player.y });
            }
        }
    }
}
function calculateCurrentDensity() {
    const playerCount = Object.keys(constants_1.players).length;
    const totalEnemies = constants_1.enemies.length;
    const enemiesInViewport = getEnemiesInViewportCount();
    if (playerCount > 0) {
        const totalViewportArea = constants_1.VIEWPORT_WITH_BUFFER_AREA * playerCount;
        const currentDensity = enemiesInViewport / totalViewportArea;
        const densityRatio = currentDensity / constants_1.ORIGINAL_ENEMY_DENSITY;
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
    const playerCount = Object.keys(constants_1.players).length;
    if (playerCount > 0) {
        // Calculate target enemy count based on current viewport density
        const viewports = getPlayerViewports();
        const totalViewportArea = viewports.reduce((total, viewport) => {
            const extendedViewport = {
                x: viewport.x - constants_1.VIEWPORT_BUFFER,
                y: viewport.y - constants_1.VIEWPORT_BUFFER,
                width: viewport.width + (constants_1.VIEWPORT_BUFFER * 2),
                height: viewport.height + (constants_1.VIEWPORT_BUFFER * 2)
            };
            return total + (extendedViewport.width * extendedViewport.height);
        }, 0);
        const targetDensity = constants_1.ORIGINAL_ENEMY_COUNT / constants_1.TOTAL_WORLD_AREA;
        const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
        const currentViewportEnemies = getEnemiesInViewportCount();
        if (currentViewportEnemies < targetEnemyCount) {
            const enemiesToSpawn = Math.min(5, targetEnemyCount - currentViewportEnemies);
            let spawned = 0;
            for (let i = 0; i < enemiesToSpawn; i++) {
                const newEnemy = createEnemy();
                if (newEnemy) {
                    constants_1.enemies.push(newEnemy);
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
    for (let i = constants_1.enemies.length - 1; i >= 0; i--) {
        const enemy = constants_1.enemies[i];
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
        const enemy = constants_1.enemies[index];
        constants_1.enemies.splice(index, 1);
        io.emit('enemyDestroyed', enemy.id);
        console.log(`[SERVER] Despawned enemy ${enemy.id} (${enemy.type} ${enemy.tier}) - outside viewport for 30+ seconds`);
    }
}
// Update the createEnemy function to spawn only in player viewports
function createEnemy() {
    const playerCount = Object.keys(constants_1.players).length;
    // Don't spawn if no players are connected
    if (playerCount === 0) {
        return null;
    }
    // Calculate target enemy count based on viewport density
    const viewports = getPlayerViewports();
    const totalViewportArea = viewports.reduce((total, viewport) => {
        const extendedViewport = {
            x: viewport.x - constants_1.VIEWPORT_BUFFER,
            y: viewport.y - constants_1.VIEWPORT_BUFFER,
            width: viewport.width + (constants_1.VIEWPORT_BUFFER * 2),
            height: viewport.height + (constants_1.VIEWPORT_BUFFER * 2)
        };
        return total + (extendedViewport.width * extendedViewport.height);
    }, 0);
    // Calculate target density: same as 1000 enemies across the whole world
    const targetDensity = constants_1.ORIGINAL_ENEMY_COUNT / constants_1.TOTAL_WORLD_AREA;
    const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
    // Don't spawn if we already have enough enemies in viewport
    if (getEnemiesInViewportCount() >= targetEnemyCount) {
        return null;
    }
    let validPosition = false;
    let x = 0, y = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // Increased attempts for viewport-only spawning
    while (!validPosition && attempts < MAX_ATTEMPTS) {
        attempts++;
        // Pick a random player and spawn near their viewport
        const randomPlayerId = Object.keys(constants_1.players)[Math.floor(Math.random() * Object.keys(constants_1.players).length)];
        const player = constants_1.players[randomPlayerId];
        // Generate position within player's viewport (with buffer)
        const viewportBuffer = constants_1.VIEWPORT_BUFFER;
        const minX = player.x - constants_1.VIEWPORT_WIDTH / 2 - viewportBuffer;
        const maxX = player.x + constants_1.VIEWPORT_WIDTH / 2 + viewportBuffer;
        const minY = player.y - constants_1.VIEWPORT_HEIGHT / 2 - viewportBuffer;
        const maxY = player.y + constants_1.VIEWPORT_HEIGHT / 2 + viewportBuffer;
        x = minX + Math.random() * (maxX - minX);
        y = minY + Math.random() * (maxY - minY);
        // Clamp to world boundaries
        x = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_WIDTH, x));
        y = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_HEIGHT, y));
        // Check if position is in a safe zone
        const inSafeZone = constants_1.WORLD_MAP.some(element => element.type === 'safe_zone' &&
            x >= element.x * constants_1.SCALE_FACTOR &&
            x <= (element.x + element.width) * constants_1.SCALE_FACTOR &&
            y >= element.y * constants_1.SCALE_FACTOR &&
            y <= (element.y + element.height) * constants_1.SCALE_FACTOR);
        // Check if position collides with walls
        const collidesWithWall = constants_1.WORLD_MAP.some(element => element.type === 'wall' &&
            x >= element.x * constants_1.SCALE_FACTOR &&
            x <= (element.x + element.width) * constants_1.SCALE_FACTOR &&
            y >= element.y * constants_1.SCALE_FACTOR &&
            y <= (element.y + element.height) * constants_1.SCALE_FACTOR);
        if (!inSafeZone && !collidesWithWall) {
            validPosition = true;
        }
    }
    // If we couldn't find a valid position, return null
    if (!validPosition) {
        return null;
    }
    // Select mob type and tier using mob configs
    const tierRoll = Math.random();
    let tier = 'common';
    let cumulativeProbability = 0;
    for (const [t, data] of Object.entries(constants_1.ENEMY_TIERS)) {
        cumulativeProbability += data.probability;
        if (tierRoll < cumulativeProbability) {
            tier = t;
            break;
        }
    }
    // Select mob type (fish, octopus, or shark)
    const allMobTypes = (0, mobs_1.getAllMobTypes)();
    if (allMobTypes.length === 0) {
        console.error("No mob types found in MOB_CONFIG.");
        return null;
    }
    const mobType = allMobTypes[Math.floor(Math.random() * allMobTypes.length)];
    // Get mob stats from config
    const mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats) {
        console.error(`No mob stats found for ${mobType} ${tier}`);
        return null;
    }
    console.log(`[DEBUG] Spawning ${mobType} (${tier}) mob with stats:`, {
        health: mobStats.health,
        damage: mobStats.damage,
        speed: mobStats.speed,
        isHostile: mobStats.is_hostile,
        range: mobStats.range
    });
    const currentTime = Date.now();
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: mobType,
        tier,
        x,
        y,
        angle: Math.random() * Math.PI * 2,
        health: mobStats.health,
        maxHealth: mobStats.health,
        speed: mobStats.speed,
        damage: mobStats.damage,
        knockbackX: 0,
        knockbackY: 0,
        isHostile: mobStats.is_hostile,
        range: mobStats.range,
        spawnTime: currentTime,
        lastViewportCheck: currentTime // Mark as in viewport since we spawned it there
    };
}
// Update respawnPlayer to use spawn points from the map
function respawnPlayer(player) {
    // Find valid spawn points for player's level
    const validSpawnPoints = constants_1.WORLD_MAP.filter(element => element.type === 'spawn' &&
        element.properties?.spawnType === getSpawnTypeForLevel(player.level));
    if (validSpawnPoints.length > 0) {
        // Choose random spawn point
        const spawn = validSpawnPoints[Math.floor(Math.random() * validSpawnPoints.length)];
        player.x = (spawn.x + Math.random() * spawn.width) * constants_1.SCALE_FACTOR;
        player.y = (spawn.y + Math.random() * spawn.height) * constants_1.SCALE_FACTOR;
    }
    else {
        // Fallback to old spawn logic if no valid spawn points
        console.warn('No valid spawn points found for level', player.level);
        player.x = Math.random() * constants_1.ACTUAL_WORLD_WIDTH;
        player.y = Math.random() * constants_1.ACTUAL_WORLD_HEIGHT;
    }
    // Rest of respawnPlayer remains the same
    player.health = player.maxHealth;
    player.score = Math.max(0, player.score - 10);
    player.isInvulnerable = true;
    player.lastDamageTime = 0;
    setTimeout(() => {
        player.isInvulnerable = false;
        // Notify client that invulnerability has ended
        io.emit('playerInvulnerabilityEnded', { playerId: player.id });
    }, constants_1.RESPAWN_INVULNERABILITY_TIME);
}
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
function addItem(inventory, rarity, type, count) {
    if (!inventory[rarity]) {
        inventory[rarity] = {};
    }
    if (!inventory[rarity][type]) {
        inventory[rarity][type] = 0;
    }
    inventory[rarity][type] += count;
}
function removeItem(inventory, rarity, type, count) {
    if (inventory[rarity] && inventory[rarity][type] && inventory[rarity][type] >= count) {
        inventory[rarity][type] -= count;
        if (inventory[rarity][type] === 0) {
            delete inventory[rarity][type];
            if (Object.keys(inventory[rarity]).length === 0) {
                delete inventory[rarity];
            }
        }
        return true;
    }
    return false;
}
function hasItem(inventory, rarity, type, count) {
    return inventory[rarity]?.[type] >= count;
}
// Initialize enemies - now only spawn when players connect
console.log(`[SERVER] Enemy spawning system initialized - enemies will spawn when players connect`);
console.log(`[SERVER] Density Configuration:`);
console.log(`  Original Density: ${constants_1.ORIGINAL_ENEMY_DENSITY.toFixed(8)} enemies/pixel²`);
console.log(`  Target: Maintain same density as ${constants_1.ORIGINAL_ENEMY_COUNT} enemies across entire world`);
console.log(`  Despawn Rule: Enemies outside viewport for 30+ seconds will despawn`);
// Initialize decorations
for (let i = 0; i < constants_1.DECORATION_COUNT; i++) {
    decorations.push((0, server_utils_1.createDecoration)());
}
// Initialize sands
for (let i = 0; i < constants_1.SAND_COUNT; i++) {
    sands.push((0, server_utils_1.createSand)());
}
io.on('connection', (socket) => {
    console.log('A user connected');
    // Send map data to the client
    socket.emit('mapData', constants_1.WORLD_MAP);
    socket.on('playerInput', (inputData) => {
        const player = constants_1.players[socket.id];
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
            playerUserIds[socket.id] = user.id; // Store the mapping
            // console.log('User authenticated, loading saved progress for userId:', user.id);
            const savedProgress = database_1.database.getPlayerByUserId(user.id);
            // console.log('Loaded saved progress:', savedProgress);
            constants_1.players[socket.id] = {
                id: socket.id,
                name: credentials.playerName || 'Anonymous',
                x: 200,
                y: constants_1.WORLD_HEIGHT / 2,
                angle: 0,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                health: savedProgress?.maxHealth || constants_1.PLAYER_MAX_HEALTH,
                maxHealth: savedProgress?.maxHealth || constants_1.PLAYER_MAX_HEALTH,
                damage: savedProgress?.damage || constants_1.PLAYER_DAMAGE,
                inventory: savedProgress?.inventory || {},
                loadout: savedProgress?.loadout || Array(10).fill(null),
                isInvulnerable: true,
                level: savedProgress?.level || 1,
                xp: savedProgress?.xp || 0,
                xpToNextLevel: calculateXPRequirement(savedProgress?.level || 1),
                knockbackX: 0,
                knockbackY: 0,
                inputs: { keys: [] }
            };
            // Save initial state and log the result
            // console.log('Saving initial player state');
            savePlayerProgress(constants_1.players[socket.id], user.id);
            // Trigger viewport update when new player joins
            triggerViewportUpdate();
            // Remove initial invulnerability after the specified time
            setTimeout(() => {
                if (constants_1.players[socket.id]) {
                    constants_1.players[socket.id].isInvulnerable = false;
                    // Notify client that invulnerability has ended
                    io.emit('playerInvulnerabilityEnded', { playerId: socket.id });
                }
            }, constants_1.RESPAWN_INVULNERABILITY_TIME);
            // Send success response and game state
            socket.emit('authenticated', {
                success: true,
                player: constants_1.players[socket.id]
            });
            // Send current game state
            socket.emit('currentPlayers', constants_1.players);
            socket.emit('enemiesUpdate', constants_1.enemies);
            socket.emit('obstaclesUpdate', constants_1.obstacles);
            socket.emit('itemsUpdate', items);
            socket.emit('decorationsUpdate', decorations);
            socket.emit('sandsUpdate', sands);
            // Notify other players
            socket.broadcast.emit('newPlayer', constants_1.players[socket.id]);
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
        if (constants_1.players[socket.id] && socket.userId) {
            // console.log('Saving player progress for userId:', socket.userId);
            savePlayerProgress(constants_1.players[socket.id], socket.userId);
        }
        delete constants_1.players[socket.id];
        delete playerUserIds[socket.id]; // Clean up the mapping
        io.emit('playerDisconnected', socket.id);
        // Trigger viewport update when player disconnects
        triggerViewportUpdate();
    });
    socket.on('collectDot', (dotIndex) => {
        if (dotIndex >= 0 && dotIndex < constants_1.dots.length) {
            constants_1.dots.splice(dotIndex, 1);
            constants_1.players[socket.id].score++;
            io.emit('dotCollected', { playerId: socket.id, dotIndex });
            // Generate a new dot
            constants_1.dots.push({
                x: Math.random() * 800,
                y: Math.random() * 600
            });
        }
    });
    socket.on('useItem', (itemData) => {
        const player = constants_1.players[socket.id];
        if (!player)
            return;
        // For now, we don't check if the item is in the loadout on the server,
        // we trust the client. This could be improved for security.
        const item = {
            type: itemData.type,
            rarity: itemData.rarity,
        };
        const rarityMultipliers = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4
        };
        const multiplier = item.rarity ? rarityMultipliers[item.rarity] : 1;
        switch (item.type) {
            case 'health_potion':
                player.health = Math.min(player.maxHealth, player.health + (50 * multiplier));
                // console.log('Applied health potion effect:', player.health);
                break;
            case 'speed_boost':
                player.speed_boost = true;
                io.emit('speedBoostActive', player.id);
                // console.log('Applied speed boost effect');
                setTimeout(() => {
                    if (constants_1.players[socket.id]) {
                        constants_1.players[socket.id].speed_boost = false;
                        // console.log('Speed boost wore off');
                    }
                }, 5000 * multiplier);
                break;
            case 'shield':
                player.isInvulnerable = true;
                // console.log('Applied shield effect');
                setTimeout(() => {
                    if (constants_1.players[socket.id]) {
                        constants_1.players[socket.id].isInvulnerable = false;
                        // console.log('Shield wore off');
                    }
                }, 3000 * multiplier);
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
    // Add save handler for when players gain XP or level up
    // Update the addXPToPlayer function to save progress
    function addXPToPlayer(player, xp) {
        player.xp += xp;
        while (player.xp >= player.xpToNextLevel) {
            player.xp -= player.xpToNextLevel;
            player.level++;
            player.xpToNextLevel = calculateXPRequirement(player.level);
            handleLevelUp(player);
        }
        // Save progress after XP gain using the socket's userId
        if (socket.userId) {
            savePlayerProgress(player, socket.userId);
        }
        io.emit('xpGained', {
            playerId: player.id,
            xp: xp,
            totalXp: player.xp,
            level: player.level,
            xpToNextLevel: player.xpToNextLevel,
            maxHealth: player.maxHealth,
            damage: player.damage
        });
    }
    // Add a name update handler
    socket.on('updateName', (newName) => {
        const player = constants_1.players[socket.id];
        if (player) {
            player.name = newName;
            io.emit('playerUpdated', player);
        }
    });
    socket.on('updateLoadout', (data) => {
        const player = constants_1.players[socket.id];
        if (player) {
            player.loadout = data.loadout;
            player.inventory = data.inventory;
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
        const chatMessage = {
            sender: socket.username,
            content: message,
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
    // Add to socket connection handler after other socket events
    socket.on('craftItems', (data) => {
        const player = constants_1.players[socket.id];
        if (!player)
            return;
        if (data.items.length === 0)
            return;
        const firstItem = data.items[0];
        const { type, rarity } = firstItem;
        if (!rarity)
            return;
        // Verify all items are same type and rarity
        const validCraft = data.items.every(item => item.type === type && item.rarity === rarity);
        if (!validCraft) {
            socket.emit('craftingFailed', 'Items must be of same type and rarity');
            return;
        }
        // Check if player has enough items
        if (!hasItem(player.inventory, rarity, type, data.items.length)) {
            socket.emit('craftingFailed', 'Not enough items to craft');
            return;
        }
        // Define rarity upgrade path
        const rarityUpgrades = {
            common: 'uncommon',
            uncommon: 'rare',
            rare: 'epic',
            epic: 'legendary',
            legendary: 'mythic'
        };
        const newRarity = rarityUpgrades[rarity];
        if (!newRarity) {
            socket.emit('craftingFailed', 'Cannot upgrade mythic items');
            return;
        }
        // Remove crafting items from inventory
        removeItem(player.inventory, rarity, type, data.items.length);
        // Add new item to inventory
        addItem(player.inventory, newRarity, type, 1);
        const newItem = {
            type: type,
            rarity: newRarity
        };
        // Notify clients
        socket.emit('craftingSuccess', {
            newItem,
            inventory: player.inventory
        });
        // Save player progress
        if (socket.userId) {
            savePlayerProgress(player, socket.userId);
        }
    });
});
// Add these constants at the top of the file
const ENEMY_SPEED_MULTIPLIER = 2;
const ENEMY_CHASE_RANGE = 500;
const ENEMY_WANDER_RANGE = 200;
function moveEnemies() {
    const currentTime = Date.now();
    constants_1.enemies.forEach(enemy => {
        // Apply knockback if it exists
        if (enemy.knockbackX) {
            enemy.knockbackX *= constants_1.KNOCKBACK_RECOVERY_SPEED;
            enemy.x += enemy.knockbackX;
            if (Math.abs(enemy.knockbackX) < 0.1)
                enemy.knockbackX = 0;
        }
        if (enemy.knockbackY) {
            enemy.knockbackY *= constants_1.KNOCKBACK_RECOVERY_SPEED;
            enemy.y += enemy.knockbackY;
            if (Math.abs(enemy.knockbackY) < 0.1)
                enemy.knockbackY = 0;
        }
        // Find closest player
        let closestPlayer;
        let closestDistance = Infinity;
        // Convert players object to array and explicitly type it
        const playerArray = Object.values(constants_1.players);
        closestPlayer = playerArray[0];
        playerArray.forEach(player => {
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
            const dx = closestPlayer.x - enemy.x;
            const dy = closestPlayer.y - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 0) {
                const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER;
                enemy.x += (dx / distance) * speed;
                enemy.y += (dy / distance) * speed;
                enemy.angle = Math.atan2(dy, dx);
            }
        }
        else {
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
                    enemy.angle = Math.atan2(dy, dx);
                }
            }
        }
        // Constrain to world boundaries
        enemy.x = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_WIDTH - constants_1.ENEMY_SIZE, enemy.x));
        enemy.y = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_HEIGHT - constants_1.ENEMY_SIZE, enemy.y));
        // Check for wall collisions
        constants_1.WORLD_MAP.filter(constants_1.isWall).forEach(wall => {
            const scaledWall = {
                x: wall.x * constants_1.SCALE_FACTOR,
                y: wall.y * constants_1.SCALE_FACTOR,
                width: wall.width * constants_1.SCALE_FACTOR,
                height: wall.height * constants_1.SCALE_FACTOR
            };
            if (enemy.x >= scaledWall.x &&
                enemy.x <= scaledWall.x + scaledWall.width &&
                enemy.y >= scaledWall.y &&
                enemy.y <= scaledWall.y + scaledWall.height) {
                // Push enemy away from wall
                const centerX = scaledWall.x + scaledWall.width / 2;
                const centerY = scaledWall.y + scaledWall.height / 2;
                const dx = enemy.x - centerX;
                const dy = enemy.y - centerY;
                const angle = Math.atan2(dy, dx);
                enemy.x = scaledWall.x + scaledWall.width / 2 + Math.cos(angle) * (scaledWall.width / 2 + 50);
                enemy.y = scaledWall.y + scaledWall.height / 2 + Math.sin(angle) * (scaledWall.height / 2 + 50);
            }
        });
    });
    io.emit('enemiesUpdate', constants_1.enemies);
}
function updatePlayerState(player, deltaTime) {
    if (!player || !player.inputs) {
        return;
    }
    let targetVelocityX = 0;
    let targetVelocityY = 0;
    if (player.inputs.useMouse && player.inputs.mouseX !== undefined && player.inputs.mouseY !== undefined) {
        const dx = player.inputs.mouseX - player.x;
        const dy = player.inputs.mouseY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 5) {
            const speed = constants_1.MAX_SPEED * (player.speed_boost ? 2 : 1);
            targetVelocityX = (dx / distance) * speed;
            targetVelocityY = (dy / distance) * speed;
            player.angle = Math.atan2(dy, dx);
        }
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
        const speed = constants_1.MAX_SPEED * (player.speed_boost ? 2 : 1);
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
    const padding = 5;
    const clampedX = Math.max(constants_1.PLAYER_SIZE / 2 + padding, Math.min(constants_1.ACTUAL_WORLD_WIDTH - constants_1.PLAYER_SIZE / 2 - padding, newX));
    const clampedY = Math.max(constants_1.PLAYER_SIZE / 2 + padding, Math.min(constants_1.ACTUAL_WORLD_HEIGHT - constants_1.PLAYER_SIZE / 2 - padding, newY));
    newX = clampedX;
    newY = clampedY;
    for (const element of constants_1.WORLD_MAP) {
        if (element.type === 'wall' && element.width > 0 && element.height > 0) {
            const wallX = element.x * constants_1.SCALE_FACTOR;
            const wallY = element.y * constants_1.SCALE_FACTOR;
            const wallWidth = element.width * constants_1.SCALE_FACTOR;
            const wallHeight = element.height * constants_1.SCALE_FACTOR;
            if (newX < wallX + wallWidth &&
                newX + constants_1.PLAYER_SIZE > wallX &&
                newY < wallY + wallHeight &&
                newY + constants_1.PLAYER_SIZE > wallY) {
                const overlapX = (newX + constants_1.PLAYER_SIZE / 2) - (wallX + wallWidth / 2);
                const overlapY = (newY + constants_1.PLAYER_SIZE / 2) - (wallY + wallHeight / 2);
                const combinedHalfWidths = constants_1.PLAYER_SIZE / 2 + wallWidth / 2;
                const combinedHalfHeights = constants_1.PLAYER_SIZE / 2 + wallHeight / 2;
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
    for (const enemy of constants_1.enemies) {
        const enemySize = constants_1.ENEMY_SIZE * constants_1.ENEMY_SIZE_MULTIPLIERS[enemy.tier];
        if (newX < enemy.x + enemySize &&
            newX + constants_1.PLAYER_SIZE > enemy.x &&
            newY < enemy.y + enemySize &&
            newY + constants_1.PLAYER_SIZE > enemy.y) {
            collision = true;
            // if (!player.isInvulnerable) {
            player.health -= enemy.damage;
            player.lastDamageTime = Date.now();
            player.isInvulnerable = true;
            // Set invulnerability timer (1 second after taking damage)
            setTimeout(() => {
                if (constants_1.players[player.id]) {
                    constants_1.players[player.id].isInvulnerable = false;
                    // Notify client that invulnerability has ended
                    io.emit('playerInvulnerabilityEnded', { playerId: player.id });
                }
            }, 1000);
            // Calculate knockback direction first
            const dx = enemy.x - newX;
            const dy = enemy.y - newY;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            const normalizedDx = dx / distance;
            const normalizedDy = dy / distance;
            const knockbackDistance = 25;
            const knockbackX = -normalizedDx * knockbackDistance;
            const knockbackY = -normalizedDy * knockbackDistance;
            // Apply knockback to player position
            newX -= normalizedDx * knockbackDistance;
            newY -= normalizedDy * knockbackDistance;
            io.emit('playerDamaged', {
                playerId: player.id,
                health: player.health,
                maxHealth: player.maxHealth,
                isInvulnerable: player.isInvulnerable,
                knockbackX: knockbackX,
                knockbackY: knockbackY
            });
            enemy.health -= player.damage;
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            if (enemy.health <= 0) {
                const index = constants_1.enemies.findIndex(e => e.id === enemy.id);
                if (index !== -1) {
                    const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                    (0, server_utils_1.addXPToPlayer)(player, xpGained);
                    if (Math.random() < constants_1.DROP_CHANCES[enemy.tier]) {
                        const dropChance = constants_1.DROP_CHANCES[enemy.tier];
                        if (Math.random() < dropChance) {
                            // Determine item type - 60% chance for consumables, 40% chance for petals
                            let itemType;
                            let petalType;
                            if (Math.random() < 0.6) {
                                // Drop consumable item
                                itemType = ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)];
                            }
                            else {
                                // Drop petal
                                itemType = 'petal';
                                const petalTypes = (0, petals_1.getAllPetalTypes)();
                                petalType = petalTypes[Math.floor(Math.random() * petalTypes.length)];
                            }
                            const newItem = {
                                id: Math.random().toString(36).substr(2, 9),
                                type: itemType,
                                x: enemy.x,
                                y: enemy.y,
                                rarity: enemy.tier,
                                petalType: petalType
                            };
                            items.push(newItem);
                            io.emit('itemSpawned', newItem);
                        }
                    }
                    constants_1.enemies.splice(index, 1);
                    io.emit('enemyDestroyed', enemy.id);
                    // Try to spawn a new enemy, but only if we can find a valid position
                    const newEnemy = createEnemy();
                    if (newEnemy) {
                        constants_1.enemies.push(newEnemy);
                    }
                }
            }
            if (player.health <= 0) {
                break;
            }
            // }
            break;
        }
    }
    // Check for petal-enemy collisions
    if (player.loadout) {
        for (let i = 0; i < player.loadout.length; i++) {
            const petal = player.loadout[i];
            if (!petal || petal.type !== 'petal' || !petal.petalType || !petal.rarity || !petal.health || petal.health <= 0) {
                continue;
            }
            const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
            if (!petalStats)
                continue;
            // Calculate petal position around player
            const currentTime = Date.now();
            const petalExtension = player.inputs.petalExtension || 1.0;
            const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
            const angleStep = (Math.PI * 2) / player.loadout.filter(p => p && p.type === 'petal').length;
            const petalIndex = player.loadout.filter(p => p && p.type === 'petal').indexOf(petal);
            const rotationSpeed = petalStats.speed * 0.002; // Convert to radians per ms
            const baseAngle = petalIndex * angleStep;
            const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
            const totalAngle = baseAngle + rotationAngle;
            const petalX = player.x + Math.cos(totalAngle) * baseRadius;
            const petalY = player.y + Math.sin(totalAngle) * baseRadius;
            // Check collision with enemies
            for (const enemy of constants_1.enemies) {
                const enemySize = constants_1.ENEMY_SIZE * constants_1.ENEMY_SIZE_MULTIPLIERS[enemy.tier];
                const petalSize = 12 * petalStats.size;
                if (petalX < enemy.x + enemySize &&
                    petalX + petalSize > enemy.x &&
                    petalY < enemy.y + enemySize &&
                    petalY + petalSize > enemy.y) {
                    // Petal hits enemy - deal damage to both
                    enemy.health -= petalStats.damage;
                    petal.health -= 1; // Petal loses 1 health per hit
                    io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                    // Check if petal breaks
                    if (petal.health <= 0) {
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
                            if (constants_1.players[player.id] && player.loadout[i] && player.loadout[i].onCooldown) {
                                // Restore petal after cooldown
                                player.loadout[i] = {
                                    ...originalPetal,
                                    health: originalPetal.maxHealth, // Restore full health
                                    onCooldown: false
                                };
                                io.emit('petalRestored', {
                                    playerId: player.id,
                                    slotIndex: i,
                                    petal: player.loadout[i]
                                });
                                // console.log(`Petal ${petal.petalType} restored for player ${player.id} after ${cooldownTime}ms`);
                            }
                        }, cooldownTime);
                        io.emit('petalBroken', {
                            playerId: player.id,
                            slotIndex: i,
                            petalType: petal.petalType,
                            rarity: petal.rarity
                        });
                    }
                    // Check if enemy dies
                    if (enemy.health <= 0) {
                        const index = constants_1.enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                            (0, server_utils_1.addXPToPlayer)(player, xpGained);
                            if (Math.random() < constants_1.DROP_CHANCES[enemy.tier]) {
                                const dropChance = constants_1.DROP_CHANCES[enemy.tier];
                                if (Math.random() < dropChance) {
                                    // Determine item type - 60% chance for consumables, 40% chance for petals
                                    let itemType;
                                    let petalType;
                                    if (Math.random() < 0.6) {
                                        // Drop consumable item
                                        itemType = ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)];
                                    }
                                    else {
                                        // Drop petal
                                        itemType = 'petal';
                                        const petalTypes = (0, petals_1.getAllPetalTypes)();
                                        petalType = petalTypes[Math.floor(Math.random() * petalTypes.length)];
                                    }
                                    const newItem = {
                                        id: Math.random().toString(36).substr(2, 9),
                                        type: itemType,
                                        x: enemy.x,
                                        y: enemy.y,
                                        rarity: enemy.tier,
                                        petalType: petalType
                                    };
                                    items.push(newItem);
                                    io.emit('itemSpawned', newItem);
                                }
                            }
                            constants_1.enemies.splice(index, 1);
                            io.emit('enemyDestroyed', enemy.id);
                            // Try to spawn a new enemy, but only if we can find a valid position
                            const newEnemy = createEnemy();
                            if (newEnemy) {
                                constants_1.enemies.push(newEnemy);
                            }
                        }
                    }
                }
            }
        }
    }
    // Check for item collisions (independent of enemy collisions)
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const distance = Math.sqrt((newX - item.x) ** 2 + (newY - item.y) ** 2);
        if (distance < constants_1.PLAYER_SIZE) {
            // Add item to player's inventory instead of immediately activating it
            const rarity = item.rarity || 'common';
            const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
            addItem(player.inventory, rarity, itemKey, 1);
            // Remove item from world
            items.splice(i, 1);
            // Emit events to update client
            io.emit('itemPickedUp', item.id);
            io.to(player.id).emit('inventoryUpdated', player.inventory);
            // Save player progress to persist inventory changes
            const userId = playerUserIds[player.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
        }
    }
    player.x = newX;
    player.y = newY;
    if (player.health <= 0) {
        respawnPlayer(player);
        io.emit('playerDied', player.id);
        io.emit('playerRespawned', player);
    }
}
function start_loop() {
    const TICK_RATE = 30;
    const TICK_INTERVAL = 1000 / TICK_RATE;
    const deltaTime = 1 / TICK_RATE;
    setInterval(() => {
        for (const id in constants_1.players) {
            updatePlayerState(constants_1.players[id], deltaTime);
        }
        moveEnemies();
        // Update viewport status for all enemies
        updateEnemyViewportStatus();
        // Despawn enemies that have been outside viewport for too long
        despawnDistantEnemies();
        const playersForBroadcast = Object.values(constants_1.players).map(p => ({
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
            enemies: constants_1.enemies,
        });
    }, TICK_INTERVAL);
}
httpsServer.listen(PORT, () => {
    console.log(`Server is running on https://localhost:${PORT}`);
});
// Add XP calculation functions
function calculateXPRequirement(level) {
    return Math.floor(constants_1.BASE_XP_REQUIREMENT * Math.pow(constants_1.XP_MULTIPLIER, level - 1));
}
// Optional: Clean up old player data periodically
// setInterval(() => {
//     database.cleanupOldPlayers(30); // Clean up players not seen in 30 days
// }, 24 * 60 * 60 * 1000); // Run once per day
// Add this function near the other helper functions
function handleLevelUp(player) {
    player.maxHealth += constants_1.HEALTH_PER_LEVEL;
    player.health = player.maxHealth; // Heal to full when leveling up
    player.damage += constants_1.DAMAGE_PER_LEVEL;
    io.emit('levelUp', {
        playerId: player.id,
        level: player.level,
        maxHealth: player.maxHealth,
        damage: player.damage
    });
}
// Add these constants at the top with other constants
const HEALTH_REGEN_RATE = 5; // Health points recovered per tick
const HEALTH_REGEN_INTERVAL = 1000; // Milliseconds between health regeneration ticks
const HEALTH_REGEN_COMBAT_DELAY = 0; // Delay before health starts regenerating after taking damage
// Add health regeneration interval
setInterval(() => {
    Object.values(constants_1.players).forEach(player => {
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
    // Log current enemy distribution and density analysis
    const densityInfo = calculateCurrentDensity();
    // if (densityInfo) {
    //     console.log(`[SERVER] Viewport refresh: ${densityInfo.enemiesInViewport}/${densityInfo.totalEnemies} enemies in viewport`);
    // }
}, 10000); // 10 seconds
// Add density maintenance interval (every 2 seconds)
setInterval(() => {
    const playerCount = Object.keys(constants_1.players).length;
    if (playerCount > 0) {
        // Calculate target enemy count based on current viewport density
        const viewports = getPlayerViewports();
        const totalViewportArea = viewports.reduce((total, viewport) => {
            const extendedViewport = {
                x: viewport.x - constants_1.VIEWPORT_BUFFER,
                y: viewport.y - constants_1.VIEWPORT_BUFFER,
                width: viewport.width + (constants_1.VIEWPORT_BUFFER * 2),
                height: viewport.height + (constants_1.VIEWPORT_BUFFER * 2)
            };
            return total + (extendedViewport.width * extendedViewport.height);
        }, 0);
        const targetDensity = constants_1.ORIGINAL_ENEMY_COUNT / constants_1.TOTAL_WORLD_AREA;
        const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
        const currentViewportEnemies = getEnemiesInViewportCount();
        if (currentViewportEnemies < targetEnemyCount) {
            const enemiesToSpawn = Math.min(3, targetEnemyCount - currentViewportEnemies);
            let spawned = 0;
            for (let i = 0; i < enemiesToSpawn; i++) {
                const newEnemy = createEnemy();
                if (newEnemy) {
                    constants_1.enemies.push(newEnemy);
                    spawned++;
                }
            }
            if (spawned > 0) {
                console.log(`[SERVER] Density maintenance: spawned ${spawned} enemies (target: ${targetEnemyCount}, current: ${currentViewportEnemies})`);
            }
        }
    }
}, 2000); // 2 seconds
// Move savePlayerProgress outside the socket connection handler
function savePlayerProgress(player, userId) {
    if (userId) {
        // console.log('Saving player progress for userId:', userId);
        const saveResult = database_1.database.savePlayer(userId, {
            level: player.level,
            xp: player.xp,
            maxHealth: player.maxHealth,
            damage: player.damage,
            inventory: player.inventory,
            loadout: player.loadout
        });
        // if (saveResult) {
        //     console.log('Successfully saved player progress');
        // } else {
        //     console.error('Failed to save player progress');
        // }
    }
    else {
        // console.warn('Attempted to save player progress without userId');
    }
}
// Add periodic saving
const SAVE_INTERVAL = 60000; // Save every minute
setInterval(() => {
    Object.entries(constants_1.players).forEach(([socketId, player]) => {
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
    const player = constants_1.players[playerId];
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
// Add console command handler after the httpsServer.listen() call
process.stdin.on('data', (data) => {
    const command = data.toString().trim();
    if (command.startsWith('save')) {
        const parts = command.split(' ');
        if (parts.length === 2) {
            const playerId = parts[1];
            const player = constants_1.players[playerId];
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
            Object.entries(constants_1.players).forEach(([socketId, player]) => {
                const socket = io.sockets.sockets.get(socketId);
                if (socket?.userId) {
                    savePlayerProgress(player, socket.userId);
                    savedCount++;
                }
            });
            // console.log(`Saved progress for ${savedCount} players`);
        }
    }
    else if (command === 'list-players') {
        Object.entries(constants_1.players).forEach(([socketId, player]) => {
            console.log(`Player ID: ${socketId}, Name: ${player.name}, Level: ${player.level}`);
        });
    }
    else if (command === 'list-sockets') {
        io.sockets.sockets.forEach((socket) => {
            console.log(`Socket ID: ${socket.id}`);
        });
    }
    else if (command.startsWith('set_max_enemies')) {
        const newCount = parseInt(command.split(' ')[1]);
        if (!isNaN(newCount) && newCount >= 0) {
            ENEMY_COUNT = newCount;
            console.log(`Max enemies set to ${ENEMY_COUNT}`);
            adjustEnemyCount();
        }
        else {
            console.log('Invalid enemy count. Please provide a valid number.');
        }
    }
});
// Add this function after the command handler
function adjustEnemyCount() {
    const playerCount = Object.keys(constants_1.players).length;
    const targetEnemyCount = playerCount > 0 ? constants_1.ENEMIES_PER_VIEWPORT * playerCount : ENEMY_COUNT;
    // Remove excess enemies if current count is higher than target
    while (constants_1.enemies.length > targetEnemyCount) {
        const removedEnemy = constants_1.enemies.pop();
        if (removedEnemy) {
            io.emit('enemyDestroyed', removedEnemy.id);
        }
    }
    // Add new enemies if current count is lower than target
    while (constants_1.enemies.length < targetEnemyCount) {
        const enemy = createEnemy();
        if (enemy) {
            constants_1.enemies.push(enemy);
        }
        else {
            // If we can't spawn more enemies (no valid positions), break the loop
            break;
        }
    }
    // Update all clients with the new enemy state
    io.emit('enemiesUpdate', constants_1.enemies);
    console.log(`[SERVER] Adjusted enemy count to ${constants_1.enemies.length}/${targetEnemyCount} (${playerCount} players)`);
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
