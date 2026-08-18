"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redeemedCodes = exports.sendBossMobDefeatedMessage = exports.trackDamage = void 0;
exports.handleMobDrops = handleMobDrops;
exports.updateSpecialMobCounts = updateSpecialMobCounts;
exports.addXPToPlayer = addXPToPlayer;
exports.addMazeXPToPlayer = addMazeXPToPlayer;
exports.saveCodeToDatabase = saveCodeToDatabase;
exports.deleteCodeFromDatabase = deleteCodeFromDatabase;
exports.simulateTickSpike = simulateTickSpike;
exports.cancelSimulatedTickSpike = cancelSimulatedTickSpike;
exports.getSimulatedTickSpikeInfo = getSimulatedTickSpikeInfo;
exports.scheduleRestart = scheduleRestart;
exports.cancelScheduledRestart = cancelScheduledRestart;
exports.getScheduledRestartInfo = getScheduledRestartInfo;
exports.rotateMazeToDay = rotateMazeToDay;
exports.adminChangeMaze = adminChangeMaze;
const ws_server_1 = require("./ws_server");
const uws_app_1 = require("./server/uws_app");
const webtransport_server_1 = require("./server/webtransport_server");
const devCert_1 = require("./server/devCert");
const path_1 = __importDefault(require("path"));
const v8_1 = __importDefault(require("v8"));
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
const inventoryCodec_1 = require("./inventoryCodec");
const petal_actions_1 = require("./petal_actions");
const constants_2 = require("./constants");
const map_data_1 = require("./map_data");
const server_utils_1 = require("./server_utils");
const mobs_2 = require("./mobs");
// Import from refactored modules
const utils_1 = require("./server/utils");
Object.defineProperty(exports, "trackDamage", { enumerable: true, get: function () { return utils_1.trackDamage; } });
Object.defineProperty(exports, "sendBossMobDefeatedMessage", { enumerable: true, get: function () { return utils_1.sendBossMobDefeatedMessage; } });
const guildManager_1 = require("./server/guildManager");
const physics_1 = require("./server/physics");
const ecsRuntime_1 = require("./server/ecsRuntime");
const ecsSync_1 = require("./server/ecsSync");
const projectileEncoder_1 = require("./ecs/net/projectileEncoder");
const tickBroadcast_1 = require("./server/tickBroadcast");
const connection_1 = require("./server/connection");
const playerState_1 = require("./server/playerState");
const gameState_1 = require("./server/gameState");
const itemManager_1 = require("./server/itemManager");
const botManager_1 = require("./server/botManager");
const playerManager_1 = require("./server/playerManager");
const maze_1 = require("./maze");
const mazeSpawner_1 = require("./server/mazeSpawner");
const crossServer_1 = require("./server/crossServer");
const enemySpawner_1 = require("./server/enemySpawner");
const pvpArenaSpawner_1 = require("./server/pvpArenaSpawner");
const spawnZoneManager_1 = require("./server/spawnZoneManager");
const enemyGrid_1 = require("./server/enemyGrid");
const enemyRegistry_1 = require("./server/enemyRegistry");
const positions_1 = require("./server/shared/positions");
const killHandler_1 = require("./server/shared/killHandler");
const rarity_1 = require("./server/shared/rarity");
const apiKeyApi_1 = require("./server/apiKeyApi");
const gameState_2 = require("./server/gameState");
// Build today's maze up front so its spawn point and wall collision are live
// before the first player connects. Daily rotation happens in an interval
// further down (near the other spawn timers).
(0, maze_1.setActiveMazeDay)((0, maze_1.getCurrentMazeDay)());
// Load persisted guilds into memory now that database + guildManager are both ready.
(0, guildManager_1.loadGuildsFromDatabase)();
(0, botManager_1.initializeBotGuilds)();
// Build the uWebSockets.js-backed app. SSL is configured later (before listen)
// because the SSL/non-SSL choice depends on cert files we don't want to read twice.
let app;
/** The TLS material the server is actually serving with, or null on plain HTTP. */
let tlsPaths = null;
{
    const certDir = path_1.default.resolve(__dirname, '..');
    // resolveTlsPaths regenerates the committed localhost certificate once it
    // expires, so `npm start` on a dev box never serves a dead one. A real
    // certificate for a real hostname is always left exactly as it is.
    tlsPaths = constants_1.USE_HTTPS
        ? (0, devCert_1.resolveTlsPaths)({ certPath: path_1.default.join(certDir, 'cert.crt'), keyPath: path_1.default.join(certDir, 'cert.key') }, { certPath: path_1.default.join(certDir, 'dev-cert.crt'), keyPath: path_1.default.join(certDir, 'dev-cert.key') })
        : null;
    if (tlsPaths) {
        app = (0, uws_app_1.createApp)({ ssl: tlsPaths });
        console.log(`[SERVER] Using HTTPS protocol (${path_1.default.basename(tlsPaths.certPath)})`);
    }
    else {
        if (constants_1.USE_HTTPS)
            console.warn(`[SERVER] HTTPS certificates not found, falling back to HTTP`);
        app = (0, uws_app_1.createApp)();
        console.log(`[SERVER] Using HTTP protocol`);
    }
}
// Wrapper function for handleMobDrops that passes io (will be set up later)
let ioInstance;
function handleMobDrops(enemy, dropMultiplier = 1, io) {
    const enemyData = {
        type: enemy.type,
        tier: enemy.tier,
        x: enemy.x,
        y: enemy.y,
        damageContributors: enemy.damageContributors ? new Map(enemy.damageContributors) : undefined
    };
    (0, itemManager_1.handleMobDrops)(enemyData, io || ioInstance, dropMultiplier);
}
// Resolves the leaderboard XP/drop-rate reward multipliers for a mob-kill credit.
// Top 10 players: 0.5x XP, 1.2x drop rate. Top 20 players: 0.75x XP, 1.1x drop rate.
function getLeaderboardRewardMultipliers(playerId) {
    return database_1.database.getLeaderboardRewardMultipliers(gameState_1.playerUserIds[playerId]);
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
// JSON body parsing is built into the shim; the no-op preserves a registration
// slot for symmetry with the previous Express setup.
app.use((0, uws_app_1.jsonParser)());
// Add CORS middleware with specific origin
app.use((req, res, next) => {
    const origin = req.headers.origin || 'https://localhost:8080';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    }
    else {
        next();
    }
});
// Authentication endpoints.
//
// Login and register hand back an opaque session token; that token — never the
// password — is what the client keeps and what every later request presents.
// Bearer header only, never a query parameter, so tokens stay out of access
// logs and Referer headers.
const bearerToken = (req) => {
    const header = req.header('Authorization');
    if (!header)
        return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1] : undefined;
};
app.post('/auth/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    const user = database_1.database.createUser(username, password);
    if (user) {
        // No session here — /auth/login is the only place a token is minted, so
        // there is exactly one path to audit. The guest flow logs in right after.
        res.status(201).json({ message: 'User created successfully', username: user.username });
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
        res.json({
            message: 'Login successful',
            userId: user.id,
            username: user.username,
            token: database_1.database.createSession(user)
        });
    }
    else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});
app.post('/auth/verify', (req, res) => {
    const token = bearerToken(req) || req.body?.token;
    if (!token) {
        return res.status(400).json({ message: 'Session token is required' });
    }
    const user = database_1.database.getUserBySession(token);
    if (user) {
        res.json({ valid: true, username: user.username });
    }
    else {
        res.status(401).json({ valid: false });
    }
});
app.post('/auth/logout', (req, res) => {
    // Revoking here is the point: a logged-out browser's leftover token must
    // stop working even if someone later reads it out of localStorage.
    const token = bearerToken(req) || req.body?.token;
    if (token)
        database_1.database.destroySession(token);
    res.json({ message: 'Logged out successfully' });
});
// Cross-server player transfer endpoints - setup will be called after io is created
// Serve static files from the dist directory
app.use('/', (0, uws_app_1.staticFiles)(path_1.default.join(__dirname, '../dist'), {
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
app.use('/assets', (0, uws_app_1.staticFiles)(path_1.default.join(__dirname, '../assets'), {
    setHeaders: (res, filePath) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Cross-Origin-Resource-Policy', 'cross-origin');
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));
// Serve favicon from dist directory (it's copied there during build)
app.use('/favicon.ico', (0, uws_app_1.staticFiles)(path_1.default.join(__dirname, '../dist/favicon.ico')));
// Notification endpoints
app.use((0, uws_app_1.jsonParser)());
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
// Leaderboard endpoint
app.get('/api/leaderboard', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const includeAdmins = req.query.includeAdmins === 'true';
    const { entries, totalAccounts, dailyActiveUsers } = database_1.database.getLeaderboard(limit, includeAdmins);
    // Admin-only fields are gated on a session token in the Authorization
    // header. This used to take ?username=&password= — which wrote every
    // player's password into the access log of every request.
    const token = bearerToken(req);
    let isAdmin = false;
    if (token) {
        const user = database_1.database.getUserBySession(token);
        isAdmin = !!user && database_1.database.isUserAdmin(user.username);
    }
    const payload = {
        leaderboard: entries,
        totalAccounts
    };
    if (isAdmin) {
        payload.dailyActiveUsers = dailyActiveUsers;
    }
    res.json(payload);
});
// The uWS app was created above; SSL vs plain was selected there based on
// USE_HTTPS + cert availability. HTTP routes and the WebSocket route share
// a single port; app.listen() is called at the bottom of this file.
// Publish the inventory wire-format fingerprint before any client can connect,
// so a client running a build with a different petal→id table is told to reload
// instead of silently decoding every inventory entry as the wrong petal.
ws_server_1.Server.protocolSignature = (0, inventoryCodec_1.getInventoryCodecSignature)();
console.log(`[SERVER] Inventory codec signature: ${ws_server_1.Server.protocolSignature}`);
const io = new ws_server_1.Server(app);
// Set ioInstance for use in modules
ioInstance = io;
// Get current server port and configuration
const PORT = process.env.PORT || 3000;
const CURRENT_SERVER_PORT = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
const CURRENT_SERVER_CONFIG = (0, constants_2.getServerConfigByPort)(CURRENT_SERVER_PORT) || { port: CURRENT_SERVER_PORT, host: 'localhost', name: `Server${CURRENT_SERVER_PORT}` };
// Bring up the WebTransport (HTTP/3) listener next to the WebSocket one, so
// clients that can speak QUIC get it and everyone else keeps using WebSockets.
// It shares the port number over UDP, needs TLS, and is entirely optional —
// startWebTransportServer resolves to null instead of throwing when anything
// is missing. Started before listen() so /transport-info can answer
// definitively from the first request.
const WT_PORT = process.env.WT_PORT ? parseInt(process.env.WT_PORT, 10) : CURRENT_SERVER_PORT;
// WT_CERT_PATH/WT_KEY_PATH let WebTransport use a certificate of its own. That
// matters in development: browsers only accept the certificate-hash shortcut
// for a short-lived ECDSA certificate (see scripts/gen-wt-cert.js), which is not
// what you want the HTTPS listener serving.
const WT_CERT_PATH = process.env.WT_CERT_PATH || tlsPaths?.certPath;
const WT_KEY_PATH = process.env.WT_KEY_PATH || tlsPaths?.keyPath;
const webTransportReady = (WT_CERT_PATH && WT_KEY_PATH)
    ? (0, webtransport_server_1.startWebTransportServer)(io, {
        port: WT_PORT,
        certPath: path_1.default.resolve(WT_CERT_PATH),
        keyPath: path_1.default.resolve(WT_KEY_PATH),
        host: process.env.WT_HOST,
    }).catch(e => { console.warn('[WT] Startup failed:', e); return null; })
    : Promise.resolve(null);
if (!WT_CERT_PATH)
    console.log('[SERVER] No TLS certificate — WebTransport disabled, WebSocket only');
/**
 * Transport capability probe. The client hits this before connecting and picks
 * WebTransport only if this says the server has it (see net/transport.ts);
 * anything else — a 404 from an older server, a timeout — means WebSocket.
 * Deliberately unauthenticated: it exposes nothing a connection attempt would
 * not, and it has to work before a session exists.
 */
app.get('/transport-info', async (_req, res) => {
    await webTransportReady;
    const advertisement = (0, webtransport_server_1.getWebTransportAdvertisement)();
    res.setHeader('Cache-Control', 'no-store');
    if (!advertisement) {
        res.json({ webtransport: false });
        return;
    }
    // WT_PUBLIC_HOST covers deployments where the QUIC listener is not reachable
    // at the same hostname the page was served from.
    const host = process.env.WT_PUBLIC_HOST;
    res.json(host ? { ...advertisement, host } : advertisement);
});
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
const gameState_3 = require("./server/gameState");
// Update the server initialization code
// Replace the old obstacle initialization with:
constants_2.obstacles.push(...(0, gameState_3.initializeMapObstacles)());
// Viewport optimization functions moved to playerState module
function updateEnemyViewportStatus() {
    const currentTime = Date.now();
    for (const enemy of constants_2.enemies) {
        // isPositionNearAnyPlayer (not isPositionInAnyViewport): maze/PVP
        // players sit outside the world rectangle and are excluded from the
        // world-clamped viewport list, which made every maze mob look
        // permanently out-of-view and churn through 30s despawns.
        if ((0, playerState_1.isPositionNearAnyPlayer)(enemy.x, enemy.y)) {
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
                // createEnemy admits the mob itself (entity + enemies[]).
                if (createEnemy())
                    spawned++;
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
    // The maze is a bounded, persistently-populated dungeon (rrolf-style):
    // its mobs are capped by mazeSpawner and spawned across ALL corridors, so
    // while anyone is inside, none of them distance-despawn — otherwise the
    // deep zones would always be empty except a bubble around each player.
    // Once the maze has no players left, the normal 30s timer cleans it up.
    const mazeOccupied = (0, mazeSpawner_1.hasMazePlayers)();
    for (let i = constants_2.enemies.length - 1; i >= 0; i--) {
        const enemy = constants_2.enemies[i];
        // Special mobs (ultra, super, unique, apex) never despawn
        if (enemy.tier === 'ultra' || enemy.tier === 'super' || enemy.tier === 'unique' || enemy.tier === 'apex') {
            continue;
        }
        // Target dummies never despawn
        if (enemy.type === 'target_dummy') {
            continue;
        }
        if (mazeOccupied && (0, maze_1.isInMazeRegion)(enemy.x, enemy.y)) {
            enemy.lastViewportCheck = undefined;
            continue;
        }
        // Check if enemy is currently outside any player's viewport (the
        // near-player check includes maze/PVP players, whose out-of-world
        // coordinates are invisible to the world-clamped viewport list).
        const inViewport = (0, playerState_1.isPositionNearAnyPlayer)(enemy.x, enemy.y);
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
        (0, enemyRegistry_1.removeEnemyAt)(index);
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
// Remove every wild mob from the world at once (admin "kill all" command).
// Pets (enemies with an ownerId) are left alone: they belong to players and are
// tracked/despawned through the pet system, so splicing them here would corrupt
// that bookkeeping. Returns the number of mobs cleared. No XP/loot is awarded —
// this is a clean despawn, not a scored kill.
function clearAllMobs() {
    let removed = 0;
    for (let i = constants_2.enemies.length - 1; i >= 0; i--) {
        const enemy = constants_2.enemies[i];
        if (enemy.ownerId)
            continue; // keep player pets
        (0, utils_1.cleanupEnemy)(enemy);
        (0, enemyRegistry_1.removeEnemyAt)(i);
        io.emit('enemyDestroyed', enemy.id);
        removed++;
    }
    // Special-mob counters (ultra/super/unique, section tracking) are derived from
    // the enemies array, so refresh them after the bulk removal.
    updateSpecialMobCounts();
    return removed;
}
// Wrapper for createEnemy. The mob is already in `enemies` and already has an
// entity by the time this returns — see server/enemyRegistry.ts.
function createEnemy() {
    const enemy = (0, enemySpawner_1.createEnemy)(enemySpawnerHelpers);
    if (enemy && enemy.tier === 'super' && enemy.type !== 'target_dummy') {
        // Ambient super spawn (e.g. via the 1% ultra-zone upgrade). The module
        // function only constructs the enemy — special-mob bookkeeping and the
        // chat broadcast that normally fire from spawnSpecialMobs need to run
        // here so the new super is counted, section-tracked, and announced.
        announceAmbientSuper(enemy);
    }
    return enemy;
}
// /spawn admits mobs directly via spawnEnemy(), bypassing spawnSpecialMobs()/
// announceAmbientSuper() entirely, so boss-tier mobs it creates never fired the
// chat banner or the boss-event log. This mirrors that announcement for any
// tier normally treated as a boss (super, unique, apex), regardless of spawn origin.
function announceBossSpawn(bossMob, tier) {
    const mobSection = (0, enemySpawner_1.getSectionAtPosition)(bossMob.x, bossMob.y);
    const spawnTimestamp = Date.now();
    const tierColor = constants_2.ENEMY_TIERS[tier].color;
    Object.entries(constants_2.players).forEach(([playerId, player]) => {
        const playerSection = (0, enemySpawner_1.getSectionAtPosition)(player.x, player.y);
        const somewhere = playerSection === mobSection ? '' : ' somewhere';
        io.to(playerId).emit('chatMessage', {
            sender: '',
            content: `<b style="color: ${tierColor};">A ${tier} ${bossMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
            timestamp: spawnTimestamp
        });
    });
    const message = `A ${tier} ${bossMob.type.replace('_', ' ')} has spawned!`;
    (0, apiKeyApi_1.recordBossEvent)({
        type: 'spawn',
        tier,
        mobType: bossMob.type,
        x: bossMob.x,
        y: bossMob.y,
        timestamp: spawnTimestamp,
        message: (0, apiKeyApi_1.stripHtml)(message)
    });
}
function announceAmbientSuper(superMob) {
    gameState_1.superMobCount.value++;
    const mobSection = (0, enemySpawner_1.getSectionAtPosition)(superMob.x, superMob.y);
    (0, gameState_2.setSuperMobInSection)(mobSection, superMob.id);
    const spawnTimestamp = Date.now();
    Object.entries(constants_2.players).forEach(([playerId, player]) => {
        const playerSection = (0, enemySpawner_1.getSectionAtPosition)(player.x, player.y);
        const somewhere = playerSection === mobSection ? '' : ' somewhere';
        io.to(playerId).emit('chatMessage', {
            sender: '',
            content: `<b style="color: ${constants_2.ENEMY_TIERS.super.color};">A super ${superMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
            timestamp: spawnTimestamp
        });
    });
    const message = `A super ${superMob.type.replace('_', ' ')} has spawned!`;
    (0, apiKeyApi_1.recordBossEvent)({
        type: 'spawn',
        tier: 'super',
        mobType: superMob.type,
        x: superMob.x,
        y: superMob.y,
        timestamp: spawnTimestamp,
        message: (0, apiKeyApi_1.stripHtml)(message)
    });
    console.log(`[SERVER] Ambient super mob spawned: ${superMob.type} at (${superMob.x}, ${superMob.y})`);
}
// Function to spawn a specific mob with a specific rarity at optional coordinates
function spawnMob(mobType, rarity, x, y, count = 1, stack = false) {
    // Clamp requested amount to a sane range so an admin typo can't flood the world.
    const MAX_SPAWN_COUNT = 500;
    count = Math.max(1, Math.min(MAX_SPAWN_COUNT, Math.floor(count) || 1));
    // Validate mob type
    const allMobTypes = (0, mobs_2.getAllMobTypes)();
    if (!allMobTypes.includes(mobType)) {
        console.log(`Invalid mob type: ${mobType}`);
        console.log(`Available mob types: ${allMobTypes.join(', ')}`);
        return;
    }
    // Validate rarity
    const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
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
        const clamped = (0, positions_1.clampToWorld)(spawnX, spawnY);
        spawnX = clamped.x;
        spawnY = clamped.y;
        if ((0, positions_1.isInOutOfBoundsZone)(spawnX, spawnY)) {
            console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) are in out-of-bounds zone. Finding alternative position...`);
            spawnX = undefined;
            spawnY = undefined;
        }
        else if (!(0, positions_1.isWallAt)(spawnX, spawnY)) {
            validPosition = true;
        }
        else {
            console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) collide with a wall. Finding alternative position...`);
            spawnX = undefined;
            spawnY = undefined;
        }
    }
    // If coordinates weren't provided or were invalid, find a valid position
    if (!validPosition) {
        // Try to spawn near a player if available
        const playerIds = Object.keys(constants_2.players);
        const samplePoint = () => {
            if (playerIds.length > 0) {
                const player = constants_2.players[playerIds[Math.floor(Math.random() * playerIds.length)]];
                return (0, positions_1.samplePointInViewport)(player);
            }
            return { x: Math.random() * constants_2.ACTUAL_WORLD_WIDTH, y: Math.random() * constants_2.ACTUAL_WORLD_HEIGHT };
        };
        while (!validPosition && attempts < MAX_ATTEMPTS) {
            attempts++;
            const point = samplePoint();
            spawnX = point.x;
            spawnY = point.y;
            // Skip if position is in out-of-bounds zone or collides with a wall
            // (state 1 = wall, state 2 = water).
            if ((0, positions_1.isInOutOfBoundsZone)(spawnX, spawnY))
                continue;
            if (!(0, positions_1.isWallAt)(spawnX, spawnY))
                validPosition = true;
        }
    }
    if (!validPosition || spawnX === undefined || spawnY === undefined) {
        console.log(`Failed to find valid spawn position for ${mobType} after ${MAX_ATTEMPTS} attempts`);
        return;
    }
    // Create the mob(s). When `count` > 1 the same validated base position is
    // reused; whether the copies stay piled or spread out is decided by `stack`:
    //
    //   stack === true  -> every copy spawns at the EXACT same (x, y). The
    //     enemy-enemy collision pass only separates pairs whose distance > 0
    //     (see checkEnemyEnemyCollisions), so a perfect overlap never resolves
    //     and the mobs stay in a permanent pile.
    //   stack === false -> each copy is offset by up to one collision radius, so
    //     distance > 0 and the collision pass eases them apart over the next few
    //     ticks — i.e. spawning "triggers" mob-to-mob collision.
    const jitterRadius = mobStats.size ? (mobStats.size * 40) / 2 : constants_2.ENEMY_SIZE / 2;
    for (let n = 0; n < count; n++) {
        let ex = spawnX;
        let ey = spawnY;
        if (!stack && count > 1) {
            const jitterAngle = Math.random() * Math.PI * 2;
            const jitterDist = Math.random() * jitterRadius;
            const clamped = (0, positions_1.clampToWorld)(spawnX + Math.cos(jitterAngle) * jitterDist, spawnY + Math.sin(jitterAngle) * jitterDist);
            ex = clamped.x;
            ey = clamped.y;
        }
        // Admits the mob (ECS entity + enemies[]); the `beforeCount` reads below
        // still work because admission appends in creation order.
        const enemy = (0, enemyRegistry_1.spawnEnemy)(mobType, tier, ex, ey);
        if (!enemy)
            continue;
        // DPS tracking buffers are allocated lazily on first damage event in trackDamage().
        // Notify all clients
        io.emit('enemySpawned', enemy);
        // Boss-tier mobs normally announce themselves via spawnSpecialMobs()/
        // announceAmbientSuper(), neither of which runs for an admin-triggered
        // spawn — fire the same chat banner + boss-event log here.
        if ((tier === 'super' || tier === 'unique' || tier === 'apex') && enemy.type !== 'target_dummy') {
            announceBossSpawn(enemy, tier);
        }
        // Centipedes need their trailing body chain; without it the head behaves
        // like any other mob and the chain-specific features (severing, avoidance)
        // have nothing to act on.
        if ((0, server_utils_1.isCentipedeHeadType)(mobType)) {
            const beforeCount = constants_2.enemies.length;
            (0, enemySpawner_1.spawnCentipedeBodySegments)(enemy);
            for (let i = beforeCount; i < constants_2.enemies.length; i++) {
                io.emit('enemySpawned', constants_2.enemies[i]);
            }
        }
        // Mobs with initial_spawns (e.g. ant holes) arrive with a pre-spawned cluster.
        if (mobStats.initial_spawns && mobStats.initial_spawns.length > 0) {
            const beforeCount = constants_2.enemies.length;
            (0, enemySpawner_1.spawnInitialSpawns)(enemy);
            for (let j = beforeCount; j < constants_2.enemies.length; j++) {
                io.emit('enemySpawned', constants_2.enemies[j]);
            }
        }
    }
    const stackNote = count > 1 ? (stack ? ' (stacked)' : ' (unstacked)') : '';
    console.log(`Spawned ${count > 1 ? count + 'x ' : ''}${tier} ${mobType} at (${Math.round(spawnX)}, ${Math.round(spawnY)})${stackNote}`);
}
// respawnPlayer moved to playerManager module - using wrapper function defined earlier
// Helper functions moved to playerManager module - using imports
// Initialize enemies - now only spawn when players connect
console.log(`[SERVER] Enemy spawning system initialized - enemies will spawn when players connect`);
console.log(`[SERVER] Density Configuration:`);
console.log(`  Original Density: ${constants_2.ORIGINAL_ENEMY_DENSITY.toFixed(8)} enemies/pixel²`);
console.log(`  Target: Maintain same density as ${constants_2.ORIGINAL_ENEMY_COUNT} enemies across entire world (9x density)`);
console.log(`  Despawn Rule: Enemies outside viewport for 30+ seconds will despawn`);
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
    unique: 26,
    apex: 30
};
// Functions moved to playerManager module - using imports
function saveAfterXP(player, socketId) {
    if (!socketId)
        return;
    const socket = ioInstance.sockets.sockets.get(socketId);
    if (socket?.userId) {
        (0, playerManager_1.savePlayerProgress)(player, socket.userId, database_1.database);
    }
}
// The live track's XP bar / level / stats changed — tell the owning client.
function emitLiveXPGain(player, xp) {
    ioInstance.to(player.id).emit('xpGained', {
        playerId: player.id,
        xp: xp,
        totalXp: player.xp,
        level: player.level,
        xpToNextLevel: player.xpToNextLevel,
        maxHealth: player.maxHealth,
        damage: player.damage
    });
}
/**
 * Grant OUTSIDE XP. All mob and boss kills come through here. Inside the maze
 * this silently banks into the parked outside total — the maze XP bar must not
 * move, so we send `outsideXpGained` instead of `xpGained`.
 */
function addXPToPlayer(player, xp, socketId) {
    const banked = (0, playerManager_1.isMazeTrackLive)(player);
    (0, playerManager_1.addXPToPlayer)(player, xp, socketId, ioInstance);
    if (banked) {
        const outsideTotalXP = (0, playerManager_1.getOutsideTotalXP)(player);
        ioInstance.to(player.id).emit('outsideXpGained', {
            playerId: player.id,
            xp: xp,
            outsideLevel: (0, playerManager_1.calculateLevelFromTotalXP)(outsideTotalXP),
            outsideTotalXp: outsideTotalXP
        });
    }
    else {
        emitLiveXPGain(player, xp);
    }
    saveAfterXP(player, socketId);
}
/**
 * Grant MAZE XP. Only absorbing calls this. Outside the maze it accumulates
 * into the parked maze total (absorbing is maze-only today, so this is just
 * defensive) and no client event is sent.
 */
function addMazeXPToPlayer(player, xp, socketId) {
    const live = (0, playerManager_1.isMazeTrackLive)(player);
    (0, playerManager_1.addMazeXPToPlayer)(player, xp, ioInstance);
    if (live)
        emitLiveXPGain(player, xp);
    saveAfterXP(player, socketId);
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
// Register the API-key authenticated REST API. Must run after redeemedCodes
// + saveCodeToDatabase/deleteCodeFromDatabase are defined above.
(0, apiKeyApi_1.registerApiKeyRoutes)(app, {
    redeemedCodes: exports.redeemedCodes,
    saveCodeToDatabase,
    deleteCodeFromDatabase
});
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
    // Add new enemies if current count is lower than target. createEnemy admits
    // the mob itself, so the loop is bounded by it returning null (no valid
    // position) rather than by a push here.
    while (constants_2.enemies.length < targetEnemyCount) {
        if (!createEnemy())
            break;
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
    clearAllMobs,
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
    trackMobKill: utils_1.trackMobKill,
    // Lazy on purpose: this bag is built at module scope, long before the ECS
    // runtime is constructed on first tick.
    projectiles: {
        spawn: (spec) => getEcsRuntime().spawnPlayerProjectile(spec),
        forEachBlocking: (x, y, petalRadius, visit) => getEcsRuntime().forEachMobProjectileHitting(x, y, petalRadius, visit),
    },
    // Same lazy-on-purpose reason as `projectiles` above: this bag is built at
    // module scope, and the ECS world it needs does not exist until first tick.
    petalRing: {
        open: (player, slotCount, rotationSpeedModifier, deltaTime, now) => (0, ecsSync_1.openPetalRing)(getEcsRuntime().world, player, now, slotCount, rotationSpeedModifier, deltaTime),
    },
};
/**
 * What the ECS player-movement window needs from the legacy modifier pipeline.
 *
 * One function, and it is injected rather than imported by ecsSync because
 * `getSpeedMultiplier` lives in petal_actions.ts, which pulls in this module at
 * module scope and binds port 3000 on require. server.ts is already the place
 * that owns both halves, so the edge lives here.
 */
const playerSyncDeps = {
    speedBoostOf: playerState_1.computeSpeedBoost,
};
// Kill-handler context for the consolidated death sequence (see shared/killHandler).
// Mirrors the kill-related subset of playerStateDeps; built once at boot.
const killCtx = {
    io,
    players: constants_2.players,
    playerUserIds: gameState_1.playerUserIds,
    database: database_1.database,
    removeEnemyAt: enemyRegistry_1.removeEnemyAt,
    savePlayerProgress,
    addXPToPlayer,
    handleMobDrops,
    sendBossMobDefeatedMessage: utils_1.sendBossMobDefeatedMessage,
    updateSpecialMobCounts,
    cleanupEnemy: utils_1.cleanupEnemy,
    trackMobKill: utils_1.trackMobKill,
};
io.on('connection', (socket) => {
    (0, connection_1.registerConnectionHandlers)(socket, io, {
        savePlayerProgress,
        savePlayerProgressImmediate,
        addXPToPlayer,
        addMazeXPToPlayer,
        respawnPlayer,
        triggerViewportUpdate,
        redeemedCodes: exports.redeemedCodes,
        saveCodeToDatabase,
        deleteCodeFromDatabase,
        RARITY_TP_COSTS,
        commandDeps,
    });
});
/**
 * Restore the speed of mobs whose slow (web/honey/pincer) has lapsed. Slows are
 * applied by scaling `enemy.speed` down and parking the original in `baseSpeed`
 * (see applySlow in playerState.ts), so every movement branch respects them
 * without knowing they exist — this is the only place that undoes one.
 */
function updateSlowEffects() {
    const currentTime = Date.now();
    for (const enemy of constants_2.enemies) {
        if (enemy.slowUntil === undefined)
            continue;
        if (currentTime < enemy.slowUntil)
            continue;
        if (enemy.baseSpeed !== undefined)
            enemy.speed = enemy.baseSpeed;
        enemy.slowUntil = undefined;
    }
}
/**
 * Tick the poison a mob's bite left on a flower (evil centipede). Lotus's
 * poisonArmor is subtracted from the per-second rate, so enough of it makes the
 * flower immune outright rather than merely slowing the bleed.
 */
function updatePlayerPoison(deltaTime) {
    const currentTime = Date.now();
    for (const id in constants_2.players) {
        const player = constants_2.players[id];
        if (!player.poisonUntil)
            continue;
        if (player.isDead || currentTime >= player.poisonUntil) {
            player.poisonUntil = undefined;
            player.poisonDamage = undefined;
            player.poisonSource = undefined;
            continue;
        }
        if (player.isInvulnerable)
            continue;
        const armor = (0, playerManager_1.calculatePlayerModifiers)(player).poisonArmor ?? 0;
        const dps = Math.max(0, (player.poisonDamage ?? 0) - armor);
        if (dps <= 0)
            continue;
        player.health -= dps * deltaTime;
        player.lastDamageTime = currentTime;
        if (player.health <= 0 && !(0, playerState_1.trySecondChance)(player, io)) {
            player.health = 0;
            player.isDead = true;
            if (player.poisonSource)
                player.killedBy = player.poisonSource;
            (0, petal_actions_1.despawnAllPlayerPets)(player.id, io);
            io.emit('playerDied', { playerId: player.id });
        }
        io.emit('playerDamaged', {
            playerId: player.id,
            health: player.health,
            maxHealth: player.maxHealth,
            isInvulnerable: player.isInvulnerable,
            knockbackX: 0,
            knockbackY: 0,
            damageDealt: dps * deltaTime
        });
    }
}
/**
 * Mobs that summon escorts on a timer while they live (queen ant), plus the
 * expiry of what they summoned. The escort is capped and time-limited so a
 * long-lived queen can't flood the section.
 */
function updatePeriodicSpawns() {
    const currentTime = Date.now();
    for (let i = constants_2.enemies.length - 1; i >= 0; i--) {
        const enemy = constants_2.enemies[i];
        if (enemy.despawnAt !== undefined && currentTime >= enemy.despawnAt && !enemy.isDead) {
            enemy.isDead = true;
            (0, utils_1.cleanupEnemy)(enemy);
            (0, enemyRegistry_1.removeEnemyAt)(i);
            io.emit('enemyDestroyed', enemy.id);
        }
    }
    for (const enemy of constants_2.enemies) {
        if (enemy.isDead)
            continue;
        const stats = enemy._mobStats ?? (0, mobs_2.getMobStats)(enemy.type, enemy.tier);
        const spawnCfg = stats?.periodic_spawn;
        if (!spawnCfg)
            continue;
        const last = enemy.lastPeriodicSpawnTime ?? 0;
        if (currentTime - last < spawnCfg.intervalMs)
            continue;
        enemy.lastPeriodicSpawnTime = currentTime;
        let alive = 0;
        for (const other of constants_2.enemies) {
            if (other.parentHoleId === enemy.id && other.type === spawnCfg.mobType)
                alive++;
        }
        if (alive >= spawnCfg.maxAlive)
            continue;
        // Behind the summoner, like gardn's queen ant.
        const radius = (stats.size * 40) / 2 * (0, mobs_2.getEnemySizeScale)(!!enemy.ownerId, enemy.tier);
        const behindX = enemy.x - Math.cos(enemy.angle) * radius;
        const behindY = enemy.y - Math.sin(enemy.angle) * radius;
        let spawnTier = enemy.tier;
        for (let step = 0; step < -(spawnCfg.spawnRarityOffset ?? 0); step++) {
            spawnTier = (0, rarity_1.downgradeRarity)(spawnTier);
        }
        // despawnAt and the inherited target are constructor arguments, not
        // post-spawn patches: both reach ECS components (Expires, MobAI.target)
        // at construction and nothing re-reads the legacy fields afterwards.
        const child = (0, enemyRegistry_1.spawnEnemy)(spawnCfg.mobType, spawnTier, behindX, behindY, {
            parentHoleId: enemy.id,
            ownerId: enemy.ownerId,
            despawnAt: currentTime + spawnCfg.lifetimeMs,
            targetPlayerId: enemy.targetPlayerId,
        });
        if (!child)
            continue;
        io.emit('enemySpawned', child);
    }
}
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
            (0, utils_1.markEnemyPoisonDamaged)(enemy);
            // Check if enemy dies from poison (only process once per enemy)
            if (enemy.health <= 0 && !enemy.isDead) {
                // Mark enemy as dead to prevent multiple death handlers
                enemy.isDead = true;
                const index = constants_2.enemies.findIndex(e => e.id === enemy.id);
                if (index !== -1) {
                    // Award XP to all players who contributed poison damage
                    const baseXpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
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
                    const { xpMultiplier, dropMultiplier } = topContributor
                        ? getLeaderboardRewardMultipliers(topContributor)
                        : { xpMultiplier: 1, dropMultiplier: 1 };
                    // Award XP to the top contributor
                    if (topContributor && constants_2.players[topContributor]) {
                        addXPToPlayer(constants_2.players[topContributor], Math.round(baseXpGained * xpMultiplier), topContributor);
                    }
                    // Track mob kill for eligible players (use debounced save to prevent lag)
                    (0, utils_1.trackMobKill)(enemy, constants_2.players, gameState_1.playerUserIds, database_1.database, io, savePlayerProgress);
                    // Handle mob drops (includes all eligible players)
                    handleMobDrops(enemy, dropMultiplier);
                    (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
                    // Clean up enemy data structures before removal to prevent memory leaks
                    (0, utils_1.cleanupEnemy)(enemy);
                    (0, enemyRegistry_1.removeEnemyAt)(index);
                    updateSpecialMobCounts();
                    io.emit('enemyDestroyed', enemy.id);
                    // Try to spawn a new enemy (admits itself)
                    createEnemy();
                }
            }
        }
    });
}
/**
 * Spawn child waves from any mob with `spawn_waves` whose health dropped this
 * tick. Each wave is tied to an HP threshold; every wave crossed on the way
 * down spawns its listed mobs, so multiple waves can fire on a single big hit.
 * Mirrors the kAntHole damage behavior from the gardn reference project.
 */
function spawnWaveMobs() {
    for (const enemy of constants_2.enemies) {
        if (enemy.isDead)
            continue;
        // _mobStats is cached on grid insertion; only hole-type mobs have
        // spawn_waves, so this skips ~all 1400 enemies without a stats lookup.
        const parentStats = enemy._mobStats ?? (0, mobs_2.getMobStats)(enemy.type, enemy.tier);
        if (!parentStats || !parentStats.spawn_waves || parentStats.spawn_waves.length === 0)
            continue;
        const waves = parentStats.spawn_waves;
        const numWaves = waves.length - 1;
        const prev = enemy._spawnWavePrevHealth;
        if (prev === undefined) {
            enemy._spawnWavePrevHealth = enemy.health;
            continue;
        }
        if (enemy.health >= prev) {
            enemy._spawnWavePrevHealth = enemy.health;
            continue;
        }
        const maxHp = enemy.maxHealth || 1;
        // Clamp to the valid wave range [0, numWaves]. Without this, a large overkill
        // drives enemy.health far negative, so endWave becomes a huge negative number
        // and the loop spins from startWave down to it — millions of iterations that all
        // just `continue` (out-of-range waveIndex): a tight, flat-heap 100% CPU hang.
        const startWave = Math.min(numWaves, Math.floor((prev / maxHp) * numWaves));
        const endWave = Math.max(0, Math.ceil((enemy.health / maxHp) * numWaves));
        const parentRadius = (parentStats.size * 40) / 2 * (0, mobs_2.getEnemySizeScale)(!!enemy.ownerId, enemy.tier);
        for (let i = startWave; i >= endWave; i--) {
            const waveIndex = numWaves - i;
            if (waveIndex < 0 || waveIndex >= waves.length)
                continue;
            const wave = waves[waveIndex];
            for (const childType of wave) {
                const angle = Math.random() * Math.PI * 2;
                const dist = parentRadius + 10 + Math.random() * parentRadius;
                const child = (0, enemyRegistry_1.spawnEnemy)(childType, enemy.tier, enemy.x + Math.cos(angle) * dist, enemy.y + Math.sin(angle) * dist, { parentHoleId: enemy.id });
                if (!child)
                    continue;
                io.emit('enemySpawned', child);
            }
        }
        enemy._spawnWavePrevHealth = enemy.health;
    }
}
/**
 * Advance every enemy by one tick, on the ECS.
 *
 * Legacy state is pushed in, the ECS scheduler runs AI / drift / chains /
 * mob collision, and the results are written back onto the same Enemy objects
 * that petals, the broadcast and the reaper already read — so nothing
 * downstream knows the simulation moved. See server/ecsSync.ts for the
 * ownership split and why lifecycle deliberately stays with legacy.
 */
function moveEnemies() {
    const now = Date.now();
    const runtime = getEcsRuntime();
    (0, ecsSync_1.syncToEcs)(runtime.world, constants_2.enemies, constants_2.players, now);
    // deltaTime is nominal here on purpose: the ported mob step is a FIXED
    // per-call step, exactly as the legacy one was, and moveEnemies is called
    // mobCatchupCalls times rather than being handed a larger dt.
    runtime.tick(1 / 30, 1000 / 30, now);
    (0, ecsSync_1.syncFromEcs)(runtime.world, constants_2.enemies);
    // Reaping stays here: it awards XP, rolls drops and touches the database,
    // none of which is ported.
    reapDeadEnemies();
    // Enemies reach clients via enemySpawned/enemyDestroyed, not a bulk update here.
}
/**
 * The ECS runtime, built on first use so nothing is constructed on servers
 * running with the simulation switched off.
 */
let _ecsRuntime;
function getEcsRuntime() {
    if (_ecsRuntime)
        return _ecsRuntime;
    _ecsRuntime = (0, ecsRuntime_1.createEcsRuntime)({
        lookupPlayer: (socketId) => constants_2.players[socketId],
        // The post-movement player pipeline. Iterates `players` in the same
        // order the bare loop did, because that order decides who lands the
        // killing blow when two players hit one mob on the same tick — see
        // EcsRuntimeOptions.runPlayerPipeline.
        runPlayerPipeline: (deltaTime) => {
            for (const id in constants_2.players) {
                (0, playerState_1.updatePlayerState)(constants_2.players[id], deltaTime, playerStateDeps);
            }
        },
        // Pet kills are credited to the owning PLAYER, matching trackDamage.
        creditDamage: (victim, ownerPlayer, amount) => {
            const world = _ecsRuntime.world;
            const victimId = world.externalIdOf(victim);
            const ownerId = world.externalIdOf(ownerPlayer);
            if (!victimId || !ownerId)
                return;
            const enemy = constants_2.enemies.find(e => e.id === victimId);
            if (enemy)
                (0, utils_1.trackDamage)(enemy, ownerId, amount);
        },
        onEnemyDamaged: (victim) => {
            const world = _ecsRuntime.world;
            const victimId = world.externalIdOf(victim);
            if (!victimId)
                return;
            const enemy = constants_2.enemies.find(e => e.id === victimId);
            if (enemy)
                (0, utils_1.markEnemyDamaged)(enemy);
        },
        // Death is left to reapDeadEnemies: syncFromEcs zeroes the legacy
        // health, and the existing reaper awards XP and drops from there.
        onEnemyKilled: () => { },
        isNearAnyPlayer: playerState_1.isPositionNearAnyPlayer,
        // --- projectiles -------------------------------------------------
        // The wire-id counters stay in gameState because they are broadcast
        // bookkeeping, not simulation state.
        allocateProjectileNetId: (fromPlayer) => fromPlayer ? (0, gameState_1.allocatePlayerProjectileId)() : (0, gameState_1.allocateMobProjectileId)(),
        resolvePlayerEntity: (socketId) => {
            const player = constants_2.players[socketId];
            if (!player)
                return undefined;
            return (0, ecsSync_1.ensurePlayerEntity)(_ecsRuntime.world, player, Date.now());
        },
        playerRadiusOf: (entity) => {
            const player = playerFromEntity(entity);
            return (constants_2.PLAYER_SIZE / 2) * (player?.sizeMultiplier ?? 1.0);
        },
        damageMultiplierOf: (entity) => {
            const player = playerFromEntity(entity);
            return player ? (0, petal_actions_1.getDamageMultiplier)(player) : undefined;
        },
        onPlayerHit: applyProjectileHitToPlayer,
        emitEnemyDamaged: (victim, health) => {
            const enemyId = _ecsRuntime.world.externalIdOf(victim);
            if (enemyId)
                io.emit('enemyDamaged', { enemyId, health });
        },
        onProjectileKill: (victim, killer, timing) => {
            const world = _ecsRuntime.world;
            const victimId = world.externalIdOf(victim);
            if (!victimId)
                return;
            const index = constants_2.enemies.findIndex(e => e.id === victimId);
            if (index < 0)
                return;
            (0, killHandler_1.killEnemy)(constants_2.enemies[index], index, constants_2.enemies, killCtx, {
                killerPlayerId: world.externalIdOf(killer),
                trackMobKillTiming: timing,
            });
        },
    });
    (0, ecsSync_1.configureCutover)(_ecsRuntime);
    // Bot AI is a Phase.Input system, registered from HERE rather than from
    // createEcsRuntime: server/botManager.ts reaches the squad manager, the
    // world map and the chat socket, and importing it inside the ECS
    // composition root would drag all of that into every module that only
    // wanted a world. See registerBotInputSystem for why it lands on the input
    // scheduler and nowhere else.
    (0, botManager_1.registerBotInputSystem)(_ecsRuntime.inputScheduler, io);
    console.log('[ECS] mob simulation initialised');
    return _ecsRuntime;
}
/**
 * Give the spawn registry its world.
 *
 * A module-scope statement, so it is impossible for a spawn to happen before
 * the wiring exists — a mob admitted without an entity would be a statue, and
 * nothing would report it. `getWorld` is a thunk rather than a world so the
 * runtime stays lazily constructed; the registry is the first thing to ask for
 * it if a mob spawns before the first tick.
 *
 * `resolvePlayer` goes through ensurePlayerEntity, not a bare lookup: pets are
 * spawned by petal actions inside updatePlayerState, which runs BEFORE
 * moveEnemies' syncToEcs, so a player summoning on their very first tick would
 * otherwise hand their pet a null owner that nothing ever repairs.
 */
(0, enemyRegistry_1.bindEnemySpawnHost)({
    getWorld: () => getEcsRuntime().world,
    resolvePlayer: (socketId) => {
        const player = constants_2.players[socketId];
        if (!player)
            return undefined;
        return (0, ecsSync_1.ensurePlayerEntity)(getEcsRuntime().world, player, Date.now());
    },
});
/** The ServerPlayer behind an ECS entity, if it is still in the world. */
function playerFromEntity(entity) {
    const id = _ecsRuntime.world.externalIdOf(entity);
    return id ? constants_2.players[id] : undefined;
}
/**
 * Apply a mob projectile's hit to a player.
 *
 * This stays on the legacy side because every line of it is legacy-owned state:
 * the direct x/y write is what the client reconciles its prediction against,
 * `playerDamaged` is emitted UNCONDITIONALLY (that is what keeps a client's
 * health bar and knockback in sync even while invulnerable), and glitch
 * infection applies even when the damage does not — a glitch mob's shot marks
 * you on contact, and the mark lasts until respawn.
 */
function applyProjectileHitToPlayer(entity, damage, knockbackX, knockbackY, sourceTypeName) {
    const player = playerFromEntity(entity);
    if (!player)
        return false;
    // Written straight onto the player: the ECS must not do this itself, because
    // syncToEcs pushes each player's legacy position back INTO the ECS every
    // tick and would overwrite the write before it could be broadcast.
    player.x += knockbackX;
    player.y += knockbackY;
    if ((0, server_utils_1.isGlitchInfectingType)(sourceTypeName))
        player.glitched = true;
    let damageDealt = 0;
    if (!player.isInvulnerable) {
        damageDealt = damage;
        player.health -= damageDealt;
        if (player.health <= 0) {
            player.isDead = true;
            player.health = 0;
            (0, petal_actions_1.despawnAllPlayerPets)(player.id, io);
            io.emit('playerDied', { playerId: player.id });
        }
    }
    io.emit('playerDamaged', {
        playerId: player.id,
        health: player.health,
        maxHealth: player.maxHealth,
        isInvulnerable: player.isInvulnerable,
        knockbackX,
        knockbackY,
        damageDealt,
    });
    // Reported back so the rest of an incoming volley skips a flower that just
    // died, exactly as the legacy `if (player.isDead) continue` did.
    return !player.isDead;
}
// A dying ant hole sometimes has a digger under it (gardn Death.cc, gated on
// DIGGER_SPAWN_CHANCE). This is the digger's ONLY spawn path — its section list
// is empty, so nothing else in the game can roll one.
const DIGGER_SPAWN_CHANCE = 0.05;
const DIGGER_SPAWNING_HOLES = new Set(['ant_hole', 'fire_ant_hole']);
/**
 * Remove every enemy that died this tick, awarding its XP and loot to whoever
 * dealt the most damage. Runs after melee combat so mob-vs-mob kills are
 * collected in the same pass.
 */
function reapDeadEnemies() {
    for (let i = constants_2.enemies.length - 1; i >= 0; i--) {
        const enemy = constants_2.enemies[i];
        if (!enemy.isDead && enemy.health > 0)
            continue;
        // A pet kill is credited to its owner: contributors are keyed by player.
        if (enemy.damageContributors && enemy.damageContributors.size > 0) {
            let topContributor;
            let maxDamage = 0;
            enemy.damageContributors.forEach((damage, playerId) => {
                if (damage > maxDamage) {
                    maxDamage = damage;
                    topContributor = playerId;
                }
            });
            if (topContributor && constants_2.players[topContributor]) {
                const { xpMultiplier, dropMultiplier } = getLeaderboardRewardMultipliers(topContributor);
                addXPToPlayer(constants_2.players[topContributor], Math.round((0, server_utils_1.getXPFromEnemy)(enemy) * xpMultiplier), topContributor);
                (0, utils_1.trackMobKill)(enemy, constants_2.players, gameState_1.playerUserIds, database_1.database, io, savePlayerProgress);
                handleMobDrops(enemy, dropMultiplier);
                (0, utils_1.sendBossMobDefeatedMessage)(enemy, io, constants_2.players);
            }
        }
        // A wild hole can leave a digger behind. Pet holes are excluded — a
        // player's own summon shouldn't hatch a hostile. Appending is safe here:
        // the loop walks backwards, so the new mob is never visited this pass
        // (and it spawns at full health, so it wouldn't be reaped anyway).
        if (DIGGER_SPAWNING_HOLES.has(enemy.type) && !enemy.ownerId && Math.random() < DIGGER_SPAWN_CHANCE) {
            const digger = (0, enemyRegistry_1.spawnEnemy)('digger', enemy.tier, enemy.x, enemy.y);
            if (digger)
                io.emit('enemySpawned', digger);
        }
        // Clean up enemy data structures before removal to prevent memory leaks
        (0, utils_1.cleanupEnemy)(enemy);
        (0, enemyRegistry_1.removeEnemyAt)(i);
        updateSpecialMobCounts();
    }
}
/**
 * Delta-sync projectiles to every client that can see them.
 *
 * This is the ONLY part of the projectile pipeline that is still legacy, and it
 * stays legacy on purpose: the known-sets, the split-player camera rule and the
 * socket bookkeeping are per-client wire state, not simulation state.
 *
 * Projectiles travel in straight lines at constant velocity, so a client can
 * dead-reckon them perfectly from a single spawn message — there is no per-tick
 * position update at all. (Earlier versions sent periodic re-syncs to "correct"
 * the client; under latency jitter they only ever snapped projectiles to a
 * stale server position and produced visible stutter.)
 *
 *   mpSpawn / ppSpawn  — projectiles newly in this player's viewport
 *   mpRemove / ppRemove — ids that left the viewport or were destroyed
 */
const projectileSpawnBuffer = [];
const projectileRemovedBuffer = [];
function broadcastProjectiles() {
    const runtime = getEcsRuntime();
    for (let kind = 0; kind < 2; kind++) {
        const fromPlayer = kind === 1;
        const query = fromPlayer ? runtime.projectileQueries.player : runtime.projectileQueries.mob;
        const knownByPlayer = fromPlayer ? gameState_1.knownPlayerProjectilesByPlayer : gameState_1.knownMobProjectilesByPlayer;
        const spawnEvent = fromPlayer ? 'ppSpawn' : 'mpSpawn';
        const removeEvent = fromPlayer ? 'ppRemove' : 'mpRemove';
        for (const playerId of Object.keys(constants_2.players)) {
            const socket = io.sockets.sockets.get(playerId);
            if (!socket || !socket.userId)
                continue;
            // Box the client's CAMERA flower, which is the active half while split.
            const player = (0, utils_1.getActivePlayerForSocket)(playerId);
            if (!player)
                continue;
            const vw = (player.viewportWidth || constants_2.VIEWPORT_WIDTH) * 1.5;
            const vh = (player.viewportHeight || constants_2.VIEWPORT_HEIGHT) * 1.5;
            let known = knownByPlayer.get(playerId);
            if (!known) {
                known = new Set();
                knownByPlayer.set(playerId, known);
            }
            // A fresh set per client per tick: it becomes that client's new
            // known-set, so it cannot be a shared scratch buffer.
            const stillKnown = new Set();
            (0, projectileEncoder_1.encodeProjectilesInBox)(query, player.x, player.y, vw, vh, known, projectileSpawnBuffer, stillKnown);
            (0, projectileEncoder_1.diffRemoved)(known, stillKnown, projectileRemovedBuffer);
            knownByPlayer.set(playerId, stillKnown);
            if (projectileSpawnBuffer.length)
                io.to(playerId).emit(spawnEvent, projectileSpawnBuffer.slice());
            if (projectileRemovedBuffer.length)
                io.to(playerId).emit(removeEvent, projectileRemovedBuffer.slice());
        }
    }
}
// Tick ground pollen drops: deal damage to enemies in radius (rate-limited per
// enemy so a mob standing on it takes recurring chip damage rather than a
// single hit), expire after lifetime, and emit state to nearby players.
function updateGroundPollens() {
    const currentTime = Date.now();
    for (let i = gameState_1.groundPollens.length - 1; i >= 0; i--) {
        const pollen = gameState_1.groundPollens[i];
        if (currentTime >= pollen.expiresAt) {
            gameState_1.groundPollens.splice(i, 1);
            io.emit('groundPollenRemoved', pollen.id);
            continue;
        }
        const player = constants_2.players[pollen.playerId];
        const damageMultiplier = player ? (0, petal_actions_1.getDamageMultiplier)(player) : 1;
        const finalDamage = pollen.damage * damageMultiplier;
        for (let j = constants_2.enemies.length - 1; j >= 0; j--) {
            const enemy = constants_2.enemies[j];
            if (enemy.ownerId)
                continue;
            if (enemy.isDead)
                continue;
            const dx = enemy.x - pollen.x;
            const dy = enemy.y - pollen.y;
            const mobStats = (0, mobs_2.getMobStats)(enemy.type, enemy.tier);
            const enemyRadius = mobStats ? (mobStats.size * 40) / 2 : constants_2.ENEMY_SIZE / 2;
            const minDistance = pollen.radius + enemyRadius;
            if (dx * dx + dy * dy >= minDistance * minDistance)
                continue;
            const lastDmg = pollen.lastDamageByEnemy.get(enemy.id) || 0;
            if (currentTime - lastDmg < gameState_1.GROUND_POLLEN_DAMAGE_INTERVAL_MS)
                continue;
            pollen.lastDamageByEnemy.set(enemy.id, currentTime);
            if (player)
                (0, utils_1.trackDamage)(enemy, pollen.playerId, finalDamage);
            enemy.health = Math.max(0, enemy.health - finalDamage);
            (0, utils_1.markEnemyDamaged)(enemy);
            if (enemy.health <= 0 && !enemy.isDead) {
                (0, killHandler_1.killEnemy)(enemy, j, constants_2.enemies, killCtx, {
                    killerPlayerId: pollen.playerId,
                    trackMobKillTiming: 'sync-snapshot',
                });
            }
        }
    }
}
// Reusable buffer for the web-field enemy-grid query (see updateWebFields).
const _webQueryBuffer = [];
/**
 * Web fields left behind by thrown web petals: expire them, and halve the speed
 * of everything standing in one. gardn does this in Collision.cc by clamping
 * `speed_ratio` for any entity overlapping a kWeb entity, which it recomputes
 * from scratch each tick; here the field keeps refreshing a short timed slow, so
 * a mob that walks out is back to full speed a fraction of a second later.
 */
function updateWebFields() {
    const currentTime = Date.now();
    for (let i = gameState_1.webFields.length - 1; i >= 0; i--) {
        const web = gameState_1.webFields[i];
        if (currentTime >= web.expiresAt) {
            gameState_1.webFields.splice(i, 1);
            io.emit('webRemoved', web.id);
            continue;
        }
        const caught = (0, enemyGrid_1.queryEnemiesNear)(web.x, web.y, web.radius, _webQueryBuffer);
        for (let j = 0; j < caught.length; j++) {
            const enemy = caught[j];
            if (enemy.isDead)
                continue;
            const dx = enemy.x - web.x;
            const dy = enemy.y - web.y;
            const reach = web.radius + (enemy._radius ?? constants_2.ENEMY_SIZE / 2);
            if (dx * dx + dy * dy >= reach * reach)
                continue;
            // The field carries the rarity of the petal that was thrown, so a
            // high-rarity web still bites on mobs that shrug off a common one.
            (0, playerState_1.applySlow)(enemy, gameState_1.WEB_SLOW_FACTOR, currentTime + gameState_1.WEB_SLOW_LINGER_MS, web.rarity);
        }
    }
}
// updatePlayerState moved to playerState module - using imported function
// Admin test hook: force every tick's `deltaTime` to a fixed value for a
// window, so a slow/GC-stalled tick (real load, e.g. a mob-dense maze) can be
// reproduced on demand instead of waiting for it to happen live. This is what
// caught the petal orbit spring instability (playerState.ts) — the spring is
// unconditionally unstable once dt exceeds ~0.089s, which the server's own
// MAX_DELTA (below) already allows. Use `/admin simtick <deltaSeconds>
// <durationSeconds>` to hold dt there and watch for other divergence bugs
// (petals, mob AI, projectiles, wall collision) instead of guessing.
let simulatedTickSpikeUntilMs = 0;
let simulatedTickSpikeDeltaSec = 0;
const MAX_SIMULATED_TICK_DELTA_SEC = 10; // generous headroom past MAX_DELTA=0.1 for stress testing
const MAX_SIMULATED_TICK_DURATION_MS = 5 * 60 * 1000;
/** Force every tick's deltaTime to `deltaSeconds` for `durationMs` (admin test hook). */
function simulateTickSpike(deltaSeconds, durationMs) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
        return { ok: false, message: 'deltaSeconds must be a positive number.' };
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return { ok: false, message: 'durationMs must be a positive number.' };
    }
    if (deltaSeconds > MAX_SIMULATED_TICK_DELTA_SEC) {
        return { ok: false, message: `deltaSeconds capped at ${MAX_SIMULATED_TICK_DELTA_SEC}.` };
    }
    if (durationMs > MAX_SIMULATED_TICK_DURATION_MS) {
        return { ok: false, message: `durationMs capped at ${MAX_SIMULATED_TICK_DURATION_MS}.` };
    }
    simulatedTickSpikeDeltaSec = deltaSeconds;
    simulatedTickSpikeUntilMs = performance.now() + durationMs;
    return { ok: true, message: `Simulating a ${deltaSeconds}s tick delta for ${(durationMs / 1000).toFixed(1)}s. Use "simtick cancel" to stop early.` };
}
/** Cancel an active simulated tick spike. Returns true if one was active. */
function cancelSimulatedTickSpike() {
    const wasActive = simulatedTickSpikeUntilMs > performance.now();
    simulatedTickSpikeUntilMs = 0;
    return wasActive;
}
/** Info about the active simulated tick spike, or null if none is running. */
function getSimulatedTickSpikeInfo() {
    const remaining = simulatedTickSpikeUntilMs - performance.now();
    if (remaining <= 0)
        return null;
    return { deltaSeconds: simulatedTickSpikeDeltaSec, remainingMs: remaining };
}
/**
 * Advance the world by one simulated tick: players, petals, damage-over-time,
 * mobs and projectiles.
 *
 * `mobCatchupCalls` is greater than 1 only while an admin-simulated tick spike
 * is active. moveEnemies() takes a fixed step per call rather than scaling by
 * deltaTime, so it is replayed to cover the ground a real 30 Hz tick rate would
 * have — otherwise mobs would lag behind the (correctly dt-compensated) players.
 */
function runSimulationStep(deltaTime, deltaMs, mobCatchupCalls) {
    // --- the player movement window --------------------------------------
    // Integration is an ECS pass over every flower at once, so the per-player
    // work that used to bracket it inside updatePlayerState is now two loops
    // with the window between them. The ORDER of the three stages is what
    // preserves behaviour, and it is the same order one player used to see:
    //
    //   pre-movement   effect expiry (decides this tick's speed factor) and the
    //                  glitch-ring knockback (writes x/y directly)
    //   movement       the ECS integrates velocity into position
    //   post-movement  mob contact, petals, pickups, walls, teleporters — all
    //                  still legacy, all still committing to player.x/y at the
    //                  end of updatePlayerState
    //
    // Crucially this runs BEFORE moveEnemies, exactly where the legacy movement
    // sat. Mobs still see each flower's fully committed end-of-tick position,
    // so mob-vs-player contact timing is unchanged by the cutover.
    const playerRuntime = getEcsRuntime();
    for (const id in constants_2.players) {
        (0, playerState_1.updatePlayerPreMovement)(constants_2.players[id], deltaTime, playerStateDeps);
    }
    const movementNow = Date.now();
    (0, ecsSync_1.syncPlayersToEcs)(playerRuntime.world, constants_2.players, movementNow, playerSyncDeps);
    // dt-SCALED, so exactly once per simulation step — never replayed for
    // catch-up the way the fixed-step mob tick is. Replaying it would move every
    // flower mobCatchupCalls times its distance.
    playerRuntime.tickPlayers(deltaTime, deltaMs, movementNow);
    (0, ecsSync_1.syncPlayersFromEcs)(playerRuntime.world, constants_2.players);
    // The player pipeline now runs as a scheduled system rather than a bare
    // loop here, so it is phase-ordered and appears in the per-system timings.
    // It still runs at exactly this point — after the movement window closed
    // with syncPlayersFromEcs — and still iterates players in the same order.
    playerRuntime.tickPlayerPipeline(deltaTime, deltaMs, movementNow);
    (0, petal_actions_1.updatePetalBehaviours)();
    updatePoisonEffects(deltaTime);
    updatePlayerPoison(deltaTime);
    // Expire mob slows before movement runs so a lapsed slow doesn't cost the
    // mob a tick of speed.
    updateSlowEffects();
    // Queen-ant style escorts (and their despawn timers)
    updatePeriodicSpawns();
    for (let i = 0; i < mobCatchupCalls; i++) {
        moveEnemies();
    }
    // Projectiles are dt-SCALED, so unlike moveEnemies they run exactly ONCE
    // with the real elapsed milliseconds. Replaying them the way mobs are
    // replayed would fly every shot mobCatchupCalls times its distance.
    const projectileRuntime = getEcsRuntime();
    projectileRuntime.tickProjectiles(deltaMs, Date.now());
    // Projectile damage lands on ECS components, but this runs OUTSIDE the
    // syncToEcs/syncFromEcs window inside moveEnemies. Without a second
    // write-back, next tick's syncToEcs would push the legacy (undamaged)
    // enemy.health straight back over C.Health and every projectile hit on a
    // mob would be silently discarded — mobs unkillable by ranged attacks.
    // syncFromEcs already merges health with MIN and carries knockback, so it
    // is exactly the right pass to repeat here.
    (0, ecsSync_1.syncFromEcs)(projectileRuntime.world, constants_2.enemies);
    broadcastProjectiles();
}
/**
 * Emit this tick's enemy damage as one batched event.
 *
 * The pending Map is keyed by enemy.id with the post-damage health snapshot —
 * this avoids monkey-patching `pendingDamageUpdate`/`lastDamageHealth` onto
 * every damaged enemy and the per-tick `delete` (which forces V8 to put the
 * enemy into dictionary mode for the rest of its life).
 */
function flushEnemyDamageBatch() {
    if (utils_1.pendingEnemyDamageUpdates.size === 0)
        return;
    const damagedEnemies = [];
    utils_1.pendingEnemyDamageUpdates.forEach((pending, enemyId) => {
        // `p` is omitted for ordinary damage so the common case stays two
        // fields on the wire.
        damagedEnemies.push(pending.poisonOnly
            ? { enemyId, health: pending.health, p: 1 }
            : { enemyId, health: pending.health });
    });
    utils_1.pendingEnemyDamageUpdates.clear();
    io.emit('enemiesDamaged', damagedEnemies);
}
/** Emit items that spawned this tick, batched into one event per recipient. */
function flushItemSpawnBatch() {
    const itemsByPlayer = new Map();
    for (const item of gameState_1.items) {
        if (!item.pendingSpawnEmission || !item.eligibleSocketIds)
            continue;
        for (const socketId of item.eligibleSocketIds) {
            let list = itemsByPlayer.get(socketId);
            if (!list) {
                list = [];
                itemsByPlayer.set(socketId, list);
            }
            list.push(item);
        }
        delete item.pendingSpawnEmission;
        delete item.eligibleSocketIds;
    }
    for (const [socketId, itemsToSend] of itemsByPlayer) {
        if (itemsToSend.length > 0) {
            io.to(socketId).emit('itemsSpawned', itemsToSend);
        }
    }
}
/** Drop `items[index]`, clearing its expiry timer and telling eligible clients. */
function removeWorldItem(index, item) {
    const timeout = gameState_1.itemExpirationTimeouts.get(item.id);
    if (timeout) {
        clearTimeout(timeout);
        gameState_1.itemExpirationTimeouts.delete(item.id);
    }
    if (item.eligiblePlayers) {
        for (const playerId of item.eligiblePlayers) {
            io.to(playerId).emit('itemRemoved', item.id);
        }
    }
    gameState_1.items.splice(index, 1);
}
/**
 * Per-tick world-item maintenance: push items out of walls, then drop the ones
 * that left the world or outlived their rarity's expiration time.
 */
function updateWorldItems() {
    for (const item of gameState_1.items) {
        (0, physics_1.checkItemWallCollisions)(item);
    }
    // The PVP arena and the maze live well outside the regular world rectangle,
    // so items inside them are exempt from the bounds check.
    for (let i = gameState_1.items.length - 1; i >= 0; i--) {
        const item = gameState_1.items[i];
        const outOfBounds = item.x < 0 || item.x >= constants_2.ACTUAL_WORLD_WIDTH || item.y < 0 || item.y >= constants_2.ACTUAL_WORLD_HEIGHT;
        if (outOfBounds && !(0, constants_2.isInPvpArena)(item.x, item.y) && !(0, maze_1.isInMazeRegion)(item.x, item.y)) {
            removeWorldItem(i, item);
        }
    }
    const currentTime = Date.now();
    for (let i = gameState_1.items.length - 1; i >= 0; i--) {
        const item = gameState_1.items[i];
        if (!item.spawnTime || !item.rarity)
            continue;
        const expirationTime = gameState_1.ITEM_EXPIRATION_TIMES[item.rarity] || 10000;
        if (currentTime - item.spawnTime >= expirationTime) {
            removeWorldItem(i, item);
        }
    }
}
/**
 * Cap the petal cooldown-tracking maps at 1000 entries each.
 *
 * JS Maps preserve insertion order, so the oldest entries are at the front.
 * Evicting from the front is O(k) instead of an O(n log n) sort + clear +
 * reinsert.
 */
function evictStalePetalTimers() {
    for (const map of [gameState_1.petalLastProjectileTime, gameState_1.petalLastRadiationTime]) {
        if (map.size <= 1000)
            continue;
        let toRemove = map.size - 1000;
        for (const key of map.keys()) {
            if (toRemove-- <= 0)
                break;
            map.delete(key);
        }
    }
}
function start_loop() {
    const TICK_RATE = 30;
    const TICK_INTERVAL = 1000 / TICK_RATE;
    const NOMINAL_DELTA = 1 / TICK_RATE;
    // setInterval doesn't fire at exactly TICK_RATE — GC pauses and CPU load make
    // ticks land late. Driving physics off a fixed 1/TICK_RATE makes the player's
    // real-world speed scale with the (variable) actual tick rate, so it feels slow
    // under load. But feeding the *raw* per-tick interval straight into movement
    // makes each tick advance by an uneven amount, so the (un-predicted, server-
    // authoritative) player position jumps unevenly and looks choppy on the client.
    //
    // So: low-pass-filter the timestep. Sustained slowdowns still pull the average
    // toward the real rate (speed stays correct), while one-off tick jitter is
    // smoothed out (motion stays smooth). Clamp the raw sample first so a long
    // GC/idle gap can't skew the filter or produce a giant step.
    const MAX_DELTA = NOMINAL_DELTA * 3;
    const DELTA_SMOOTH = 0.1; // low-pass factor (~10-tick time constant)
    let lastTickMs = 0;
    let smoothedDelta = NOMINAL_DELTA;
    // Monotonic tick index for strided per-enemy passes (viewport/despawn).
    let tickCounter = 0;
    // Real ticks keep firing at the normal ~30/s cadence even while a spike is
    // simulated (see simulateTickSpike above) — only the deltaTime value is
    // faked. Feeding every one of those real ticks the inflated deltaTime would
    // advance the world faster than real time instead of at the same rate in
    // fewer/bigger steps, which is what an actual slow tick does. So real
    // elapsed time is banked here, and the world (players, petals, mobs,
    // projectiles) is only actually advanced once enough has accumulated to
    // equal one simulated tick. Reset to 0 whenever no spike is active so it
    // never affects normal play.
    let simTickAccumulatorSec = 0;
    // Tick-duration accounting for the client debug menu graphs. Accumulated
    // per full tick below and drained once per second by the debugStats
    // interval after this loop.
    let debugTickAccumMs = 0;
    let debugTickSamples = 0;
    let debugTickMaxMs = 0;
    // Reused per tick to avoid per-tick allocation of the authenticated-id array
    // and an associated socket lookup that was previously done twice.
    const authenticatedPlayerIds = [];
    const authenticatedSockets = [];
    setInterval(() => {
        tickCounter++;
        // Smoothed real elapsed time since the previous tick (seconds). Computed
        // before the no-players early-return so it stays one tick wide across idle.
        const nowMs = performance.now();
        let rawDelta = lastTickMs > 0 ? (nowMs - lastTickMs) / 1000 : NOMINAL_DELTA;
        lastTickMs = nowMs;
        if (rawDelta > MAX_DELTA)
            rawDelta = MAX_DELTA;
        smoothedDelta += (rawDelta - smoothedDelta) * DELTA_SMOOTH;
        // Admin test hook: override the delta fed to game logic while a simulated
        // tick spike is active, without touching the real smoothing state — so
        // behavior snaps back to normal the instant the test window ends.
        const deltaTime = simulatedTickSpikeUntilMs > nowMs ? simulatedTickSpikeDeltaSec : smoothedDelta;
        const deltaMs = deltaTime * 1000;
        // See simTickAccumulatorSec above: while a spike is simulated, real ticks
        // keep firing at the normal ~30/s cadence, but feeding every one of them
        // the inflated deltaTime would advance the world MORE per real second than
        // normal (more calls, each moving further) — the opposite of a real slow
        // tick, which advances the world the *same* amount per real second, just
        // in fewer/bigger steps. So gate every deltaTime/deltaMs-consuming update
        // to fire only once enough real time has accumulated to equal one
        // simulated tick, matching how a genuinely slow-ticking server would.
        let runSimTick = true;
        // moveEnemies() isn't deltaTime-scaled (fixed per-call step — see above),
        // so a single throttled call would only move mobs the usual one tick's
        // worth of distance despite representing a whole simulated tick's worth
        // of real time, making them lag behind the (correctly dt-compensated)
        // players/petals. Replaying it mobCatchupCalls times on the tick that
        // fires makes mobs cover the same ground a real, uninterrupted 30Hz
        // tick rate would have, so their real-world speed matches everything
        // else's during the test instead of falling behind.
        let mobCatchupCalls = 1;
        if (simulatedTickSpikeUntilMs > nowMs) {
            simTickAccumulatorSec += rawDelta;
            if (simTickAccumulatorSec >= simulatedTickSpikeDeltaSec) {
                simTickAccumulatorSec -= simulatedTickSpikeDeltaSec;
                mobCatchupCalls = Math.max(1, Math.round(simulatedTickSpikeDeltaSec / NOMINAL_DELTA));
            }
            else {
                runSimTick = false;
            }
        }
        else {
            simTickAccumulatorSec = 0;
        }
        authenticatedPlayerIds.length = 0;
        authenticatedSockets.length = 0;
        for (const id in constants_2.players) {
            const socket = io.sockets.sockets.get(id);
            if (socket && socket.userId) {
                authenticatedPlayerIds.push(id);
                authenticatedSockets.push(socket);
            }
        }
        // Keep bot population aligned with real player count. Despawns all bots
        // when nobody is online so the server goes fully idle.
        (0, botManager_1.maintainBotCount)(io, authenticatedPlayerIds.length, getEcsRuntime().world);
        // Skip game processing if there are no authenticated players
        if (authenticatedPlayerIds.length === 0) {
            return;
        }
        // Build a spatial grid of enemies once per tick. Player/petal collision
        // loops in updatePlayerState query this instead of scanning all enemies.
        // Must run BEFORE the input tick: bot targeting queries this grid.
        (0, enemyGrid_1.rebuildEnemyGrid)(constants_2.enemies);
        // The INPUT phase: bot AI writes into `player.inputs` before the normal
        // update pipeline reads them, so bots move and attack just like real
        // players. This is exactly where the bare `updateBotAI(io)` call used to
        // sit, and the placement is load-bearing — see EcsRuntime.tickInput.
        // Unlike runSimulationStep below it is NOT gated on `runSimTick`: bot
        // decisions were made every real tick before the cutover and still are.
        // `Date.now()`, NOT the `nowMs` performance-clock sample above. Every
        // deadline bot AI keeps — respawn, flee, unstick, wander, squad and boss
        // announce cooldowns — is stored as an absolute timestamp and compared
        // against clocks taken elsewhere with `Date.now()` (respawnBot, the
        // maintain interval). Feeding a performance.now() epoch in here would put
        // two epochs into the same fields and nothing would fail: the timers would
        // just resolve at nonsense times. moveEnemies and the movement window
        // sample the same way, for the same reason.
        getEcsRuntime().tickInput(deltaTime, deltaMs, Date.now());
        if (runSimTick)
            runSimulationStep(deltaTime, deltaMs, mobCatchupCalls);
        // Update ground pollen drops (damage zones from broken pollen petals)
        updateGroundPollens();
        // Update web fields (slow zones from thrown web petals)
        updateWebFields();
        // Update viewport status for all enemies. Strided: this pass exists to
        // feed a 30-second despawn timer, so a ~166 ms cadence is equivalent —
        // no need to box-test all ~1400 enemies every tick.
        if (tickCounter % 5 === 0)
            updateEnemyViewportStatus();
        // Spawn wave mobs from damaged spawners (e.g. ant holes) before emitting damage batch
        spawnWaveMobs();
        flushEnemyDamageBatch();
        flushItemSpawnBatch();
        // Despawn enemies that have been outside viewport for too long.
        // Strided like updateEnemyViewportStatus (offset so the two 1400-enemy
        // passes never land on the same tick): the despawn threshold is 30 s.
        if (tickCounter % 5 === 2)
            despawnDistantEnemies();
        updateWorldItems();
        evictStalePetalTimers();
        // Encode and send this tick's gameStateUpdate to every client.
        (0, tickBroadcast_1.broadcastGameState)(authenticatedPlayerIds, authenticatedSockets, (0, tickBroadcast_1.buildPlayerSnapshots)());
        // Record how long this tick's work actually took (idle early-return
        // ticks never reach here, so they don't dilute the average).
        const tickDurMs = performance.now() - nowMs;
        debugTickAccumMs += tickDurMs;
        debugTickSamples++;
        if (tickDurMs > debugTickMaxMs)
            debugTickMaxMs = tickDurMs;
    }, TICK_INTERVAL);
    // Once per second, ship memory + tick-time stats to clients for the debug
    // menu graphs (~100 bytes per emit; skipped entirely while idle).
    setInterval(() => {
        if (authenticatedPlayerIds.length === 0) {
            debugTickAccumMs = 0;
            debugTickSamples = 0;
            debugTickMaxMs = 0;
            return;
        }
        const mem = process.memoryUsage();
        io.emit('debugStats', {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            tickAvgMs: debugTickSamples > 0 ? Math.round((debugTickAccumMs / debugTickSamples) * 100) / 100 : 0,
            tickMaxMs: Math.round(debugTickMaxMs * 100) / 100,
        });
        debugTickAccumMs = 0;
        debugTickSamples = 0;
        debugTickMaxMs = 0;
    }, 1000);
}
// Start the server. uWS listens on (port, cb); cb receives a truthy listen socket on success.
app.listen(typeof PORT === 'string' ? parseInt(PORT, 10) : PORT, (ok) => {
    if (!ok) {
        console.error(`[SERVER] Failed to bind to port ${PORT}`);
        process.exit(1);
    }
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
// Scheduled restart system: warns connected players before exiting so pm2 restarts the process.
const RESTART_WARNINGS_MS = [10 * 60 * 1000, 5 * 60 * 1000, 60 * 1000, 10 * 1000];
let scheduledRestartInProgress = false;
let scheduledRestartTimers = [];
let scheduledRestartTargetMs = null;
let scheduledRestartReason = '';
const broadcastSystemMessage = (content) => {
    try {
        for (const s of io.sockets.sockets.values()) {
            try {
                s.emit('chatMessage', { sender: 'System', content, timestamp: Date.now() });
            }
            catch { }
        }
    }
    catch (e) {
        console.error('[RESTART] Error broadcasting system message', e);
    }
};
const formatRestartWarning = (ms, reason) => {
    const reasonText = reason === 'daily' ? 'daily maintenance' : reason;
    if (ms >= 60000) {
        const m = Math.round(ms / 60000);
        return `<span style="color:#ffb74d;">⚠ Server will restart in ${m} minute${m === 1 ? '' : 's'} (${reasonText}).</span>`;
    }
    const s = Math.round(ms / 1000);
    return `<span style="color:#ff6b6b;">⚠ Server restarting in ${s} second${s === 1 ? '' : 's'}!</span>`;
};
/** Schedule a server restart in `delayMs` milliseconds. Replaces any existing scheduled restart. */
function scheduleRestart(delayMs, reason = 'admin') {
    if (scheduledRestartInProgress)
        return false;
    if (delayMs < 0)
        delayMs = 0;
    for (const t of scheduledRestartTimers)
        clearTimeout(t);
    scheduledRestartTimers = [];
    scheduledRestartTargetMs = Date.now() + delayMs;
    scheduledRestartReason = reason;
    console.log(`[RESTART] Scheduled restart in ${delayMs}ms (reason: ${reason})`);
    for (const warnMs of RESTART_WARNINGS_MS) {
        if (warnMs >= delayMs)
            continue;
        scheduledRestartTimers.push(setTimeout(() => {
            if (scheduledRestartInProgress)
                return;
            broadcastSystemMessage(formatRestartWarning(warnMs, reason));
        }, delayMs - warnMs));
    }
    scheduledRestartTimers.push(setTimeout(() => {
        scheduledRestartInProgress = true;
        console.warn(`[RESTART] Scheduled restart triggered (reason: ${reason})`);
        broadcastSystemMessage(`<span style="color:#ff6b6b;">Server restarting now (${reason === 'daily' ? 'daily maintenance' : reason}). Reconnecting shortly...</span>`);
        try {
            for (const s of io.sockets.sockets.values()) {
                try {
                    s.emit('serverRestarting', { reason });
                }
                catch { }
            }
        }
        catch { }
        setTimeout(() => {
            console.warn('[RESTART] Exiting process for restart');
            process.exit(0);
        }, 1000);
    }, delayMs));
    return true;
}
/** Cancel a pending scheduled restart. */
function cancelScheduledRestart() {
    if (scheduledRestartInProgress)
        return false;
    if (scheduledRestartTimers.length === 0)
        return false;
    for (const t of scheduledRestartTimers)
        clearTimeout(t);
    scheduledRestartTimers = [];
    scheduledRestartTargetMs = null;
    scheduledRestartReason = '';
    return true;
}
/** Info about the pending restart, or null if none scheduled. */
function getScheduledRestartInfo() {
    if (scheduledRestartTargetMs === null)
        return null;
    return { remainingMs: Math.max(0, scheduledRestartTargetMs - Date.now()), reason: scheduledRestartReason };
}
// Daily restart: 24h after startup
scheduleRestart(24 * 60 * 60 * 1000, 'daily');
// Memory watchdog: log every 5s, restart process if heap usage > 70% of V8 heap limit.
// Requires a process supervisor (systemd, pm2, docker --restart, etc.) to actually bring the server back up.
//
// Threshold is intentionally well below the V8 hard limit and the interval is short:
// as the heap approaches its limit V8 falls into a back-to-back full-GC death-spiral
// that blocks the event loop, so a watchdog that only trips at the last moment never
// gets a turn to run and the process dies with "FATAL ERROR: Reached heap limit" instead
// of restarting gracefully. Firing at 70% leaves headroom to restart while the loop is
// still responsive. Baseline heap under load is ~20-40%, so this won't false-trip.
const MEMORY_RESTART_THRESHOLD = 0.7;
const MEMORY_CHECK_INTERVAL = 5000;
let memoryRestartInProgress = false;
setInterval(() => {
    const mem = process.memoryUsage();
    const heapLimit = v8_1.default.getHeapStatistics().heap_size_limit;
    const heapUsedPct = mem.heapUsed / heapLimit;
    const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
    const heapUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const heapLimitMB = (heapLimit / 1024 / 1024).toFixed(1);
    const playerCount = Object.keys(constants_2.players).length;
    console.log(`[MEMORY] rss=${rssMB}MB heapUsed=${heapUsedMB}MB/${heapLimitMB}MB (${(heapUsedPct * 100).toFixed(1)}%) players=${playerCount}`);
    if ((heapUsedPct >= MEMORY_RESTART_THRESHOLD && !memoryRestartInProgress) || (mem.rss > 600 * 1024 * 1024 && !memoryRestartInProgress)) {
        memoryRestartInProgress = true;
        console.warn(`[MEMORY] Heap usage ${(heapUsedPct * 100).toFixed(1)}% >= ${MEMORY_RESTART_THRESHOLD * 100}% — restarting server`);
        // Notify connected players so the client can show a friendly message and reconnect
        try {
            const sockets = Array.from(io.sockets.sockets.values());
            for (const s of sockets) {
                try {
                    s.emit('chatMessage', { sender: 'System', content: '<span style="color:#ff6b6b;">Server is restarting to recover memory. You will be reconnected shortly.</span>', timestamp: Date.now() });
                    s.emit('serverRestarting', { reason: 'memory' });
                }
                catch { }
            }
        }
        catch (e) {
            console.error('[MEMORY] Error notifying clients of restart', e);
        }
        // Give the notify packets a moment to flush, then exit non-zero so the supervisor restarts us.
        setTimeout(() => {
            console.warn('[MEMORY] Exiting process for restart');
            process.exit(1);
        }, 1000);
    }
}, MEMORY_CHECK_INTERVAL);
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
        // Keep the PVP arena populated with garden mobs + spiders. These
        // spawners admit their own mobs now — see server/enemyRegistry.ts.
        (0, pvpArenaSpawner_1.spawnArenaMobs)(3);
        // Keep the maze corridors populated (tier by depth zone) and its
        // ultra bosses alive in the deepest rooms. 40 per half-second fills a
        // fresh maze (~1300-mob target at full world density) in ~17s; at
        // steady state the target cap throttles this down to a
        // kill-replacement trickle.
        (0, mazeSpawner_1.spawnMazeMobs)(40);
        (0, mazeSpawner_1.spawnMazeBosses)();
        if (currentViewportEnemies < targetEnemyCount) {
            // Scale spawn cap with player count so each player's viewport fills at the same rate
            const enemiesToSpawn = Math.min(3 * playerCount, targetEnemyCount - currentViewportEnemies);
            let spawned = 0;
            for (let i = 0; i < enemiesToSpawn; i++) {
                if (createEnemy())
                    spawned++;
            }
            // if (spawned > 0) {
            //     console.log(`[SERVER] Density maintenance: spawned ${spawned} enemies (target: ${targetEnemyCount}, current: ${currentViewportEnemies})`);
            // }
        }
    }
}, 500); // 0.5 seconds
// Spawn-zone manager tick: drives wave-based spawning inside spawn zones.
// The density loop above handles open-world spawns and skips spawn zones.
setInterval(() => {
    (0, spawnZoneManager_1.updateSpawnZones)(enemySpawnerHelpers);
}, 1000); // 1 second
// Add special mob spawning timer (every 1 minute)
setInterval(() => {
    const playerCount = Object.keys(constants_2.players).length;
    if (playerCount > 0) {
        spawnSpecialMobs();
    }
}, 60000); // 60 seconds
// Admin override for which "day" the maze uses. Kept as an offset from the
// real UTC day (rather than a pinned day) so an admin-forced maze isn't
// snapped back by the rotation check a minute later, and the maze still
// advances normally at each real day boundary.
let mazeDayOffset = 0;
/**
 * Swap the active maze to the given day number: clear the old maze's mobs
 * (the new walls would strand them), rebuild, broadcast 'mazeInfo' so every
 * client regenerates the same layout, and move everyone inside to the new
 * entrance. Shared by the daily rotation and the change-maze admin command.
 */
function rotateMazeToDay(day) {
    const removedIds = (0, mazeSpawner_1.clearMazeEnemies)();
    for (const id of removedIds) {
        io.emit('enemyDestroyed', id);
    }
    const maze = (0, maze_1.setActiveMazeDay)(day);
    (0, mazeSpawner_1.invalidateMazeMobPool)();
    io.emit('mazeInfo', { day: maze.dayNumber, biome: maze.biome });
    console.log(`[MAZE] Rotated to day ${maze.dayNumber} (${maze.biome})`);
    for (const pid in constants_2.players) {
        const p = constants_2.players[pid];
        if (!p?.inMaze)
            continue;
        const spawn = (0, playerManager_1.getMazeSpawnPosition)();
        p.x = spawn.x;
        p.y = spawn.y;
        // `players` includes splitter halves, which own no socket of their own.
        io.to((0, utils_1.getOriginalSocketId)(pid)).emit('playerTeleported', { newX: spawn.x, newY: spawn.y, playerId: pid });
    }
}
/**
 * Admin command backend: force a maze change immediately. Layouts are
 * hardcoded per biome, so changing the maze means changing the biome.
 *   change-maze              → next biome in the garden → desert → ocean cycle
 *   change-maze garden|desert|ocean → that biome's maze
 *   change-maze <dayNumber>  → the maze for that day number (biome = day % 3)
 * Returns a human-readable status string for the command output.
 */
function adminChangeMaze(arg) {
    const active = (0, maze_1.getActiveMaze)();
    const currentDay = active ? active.dayNumber : (0, maze_1.getCurrentMazeDay)();
    const token = (arg || '').trim().toLowerCase();
    let targetDay;
    if (token === '' || token === 'next') {
        targetDay = currentDay + 1;
    }
    else if (maze_1.MAZE_BIOMES.includes(token)) {
        const wantIndex = maze_1.MAZE_BIOMES.indexOf(token);
        const currentIndex = ((currentDay % 3) + 3) % 3; // same formula generateMaze uses
        const advance = ((wantIndex - currentIndex) + 3) % 3;
        if (advance === 0) {
            // Layouts are fixed per biome — re-requesting the active biome
            // would rebuild the identical maze.
            return `Maze is already ${token}.`;
        }
        targetDay = currentDay + advance;
    }
    else if (/^-?\d+$/.test(token)) {
        targetDay = parseInt(token, 10);
    }
    else {
        return `Usage: change-maze [next|garden|desert|ocean|<dayNumber>] — current: day ${currentDay} (${active?.biome ?? 'none'})`;
    }
    if (active && targetDay === active.dayNumber) {
        return `Maze is already day ${targetDay} (${active.biome}).`;
    }
    mazeDayOffset = targetDay - (0, maze_1.getCurrentMazeDay)();
    rotateMazeToDay(targetDay);
    const maze = (0, maze_1.getActiveMaze)();
    return `Maze changed to day ${maze.dayNumber} (${maze.biome}). Offset from real day: ${mazeDayOffset >= 0 ? '+' : ''}${mazeDayOffset}.`;
}
// Daily maze rotation: at each UTC day boundary the maze gets a new layout
// and the biome cycles garden → desert → ocean (plus any admin offset from
// the change-maze command).
setInterval(() => {
    const day = (0, maze_1.getCurrentMazeDay)() + mazeDayOffset;
    const currentMaze = (0, maze_1.getActiveMaze)();
    if (currentMaze && currentMaze.dayNumber === day)
        return;
    rotateMazeToDay(day);
}, 60000); // check once a minute
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
            // No payload: the client handler only flashes the save indicator and
            // ignores its argument, so shipping the whole player here was ~9.9KB
            // per player per minute for nothing.
            socket.emit('savePlayerProgress');
            savePlayerProgress(player, socket.userId);
        }
    });
}, SAVE_INTERVAL);
// Periodic bandwidth profiling. Logs the top per-event wire-byte totals (real encoded
// sizes, not phantom JSON) every 5 seconds so we can see exactly what's eating
// bandwidth. Aggregates across all sockets — divide by player count for per-player.
// const BW_LOG_INTERVAL_MS = 5000;
// setInterval(() => {
//     const stats = getServerEventStats();
//     if (stats.size === 0) return;
//     const rows = Array.from(stats.entries())
//         .map(([event, s]) => ({ event, ...s, total: s.in + s.out }))
//         .sort((a, b) => b.total - a.total)
//         .slice(0, 10);
//     let totalIn = 0, totalOut = 0;
//     for (const [, s] of stats) { totalIn += s.in; totalOut += s.out; }
//     const fmt = (b: number) => b < 1024 ? `${b}B` : `${(b / 1024).toFixed(1)}KB`;
//     const perSec = BW_LOG_INTERVAL_MS / 1000;
//     console.log(`[bandwidth] total ${fmt(totalOut / perSec)}/s out, ${fmt(totalIn / perSec)}/s in (aggregate across all sockets)`);
//     for (const r of rows) {
//         const inPerSec = fmt(r.in / perSec);
//         const outPerSec = fmt(r.out / perSec);
//         console.log(`  ${r.event.padEnd(24)} out=${outPerSec.padStart(8)}/s (${r.count_out} msg) in=${inPerSec.padStart(8)}/s (${r.count_in} msg)`);
//     }
//     resetServerEventStats();
// }, BW_LOG_INTERVAL_MS);
