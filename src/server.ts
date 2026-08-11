import { Server } from './ws_server';
import { createApp, UApp, staticFiles, jsonParser } from './server/uws_app';
import path from 'path';
import v8 from 'v8';
import fs from 'fs';
import { database, Notification } from './database';
import { USE_HTTPS, SERVER_PROTOCOL } from './constants';

// Check for and migrate any plain text passwords on server startup
if (database.checkForPlainTextPasswords()) {
    console.log('[SERVER] Detecting plain text passwords, running migration...');
    const migrated = database.migratePasswords();
    console.log(`[SERVER] Password migration completed: ${migrated} passwords updated`);
} else {
    console.log('[SERVER] All passwords are already hashed');
}

// Migrate player data from old format to new format on server startup
const migratedPlayers = database.migratePlayerData();
if (migratedPlayers > 0) {
    console.log(`[SERVER] Migrated ${migratedPlayers} players to new XP format`);
}

// Remove eggs for mobs that should not have eggs
import { BASE_MOB_CONFIGS } from './mobs';
const invalidEggTypes = new Set<string>();
for (const mobType in BASE_MOB_CONFIGS) {
    if (mobType.endsWith('_pet')) continue;
    if (BASE_MOB_CONFIGS[mobType].noEggDrop) {
        invalidEggTypes.add(`petal_${mobType}_egg`);
    }
}
if (invalidEggTypes.size > 0) {
    const cleanedPlayers = database.removeInvalidEggs(invalidEggTypes);
    if (cleanedPlayers > 0) {
        console.log(`[SERVER] Removed invalid eggs from ${cleanedPlayers} players (${[...invalidEggTypes].join(', ')})`);
    }
}

import { ServerPlayer } from './player';
import { getInventoryCodecSignature } from './inventoryCodec';
import { getDamageMultiplier, updatePetalActions, despawnAllPlayerPets } from './petal_actions';
import { ENEMY_TIERS, ENEMY_SIZE, PLAYER_SIZE, enemies, players, obstacles, SAND_COUNT, DECORATION_COUNT, ACTUAL_WORLD_HEIGHT, ACTUAL_WORLD_WIDTH, VIEWPORT_BUFFER, ENEMIES_PER_VIEWPORT, ORIGINAL_ENEMY_DENSITY, ORIGINAL_ENEMY_COUNT, VIEWPORT_WITH_BUFFER_AREA, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, TOTAL_WORLD_AREA, getServerConfigByPort, isInPvpArena } from './constants';
import { WALL_GRID } from './map_data';
import { Enemy, createDecoration, createSand, getXPFromEnemy, isCentipedeHeadType, isGlitchInfectingType } from './server_utils';
import { WorldItem } from './item';
import { getMobStats, getAllMobTypes, getEnemySizeScale } from './mobs';

// Import from refactored modules
import {
    trackDamage,
    calculateDPS,
    sendBossMobDefeatedMessage,
    cleanupEnemy,
    trackMobKill,
    markEnemyDamaged,
    markEnemyPoisonDamaged,
    pendingEnemyDamageUpdates,
    getActivePlayerForSocket,
    getOriginalSocketId
} from './server/utils';
import {
    loadGuildsFromDatabase,
} from './server/guildManager';
import {
    checkItemWallCollisions,
} from './server/physics';
import { createEcsRuntime, EcsRuntime } from './server/ecsRuntime';
import { configureCutover, ensurePlayerEntity, syncFromEcs, syncToEcs } from './server/ecsSync';
import { Entity } from './ecs';
import {
    diffRemoved,
    encodeProjectilesInBox,
    ProjectileWire,
} from './ecs/net/projectileEncoder';
import {
    buildPlayerSnapshots,
    broadcastGameState,
} from './server/tickBroadcast';
import { AuthenticatedSocket } from './server/shared/socketTypes';
import { registerConnectionHandlers } from './server/connection';
import {
    updatePlayerState,
    getPlayerViewports,
    isPositionInPlayerPetalRange,
    validatePlayerPositions,
    isPositionNearAnyPlayer,
    getEnemiesInViewportCount,
    PlayerStateDependencies,
    trySecondChance,
    applySlow
} from './server/playerState';
import {
    CommandHandlerDependencies
} from './server/commands';
import {
    items,
    superMobCount,
    decorations,
    sands,
    ENEMY_COUNT,
    playerUserIds,
    petalLastProjectileTime,
    petalLastRadiationTime,
    knownMobProjectilesByPlayer,
    knownPlayerProjectilesByPlayer,
    allocateMobProjectileId,
    allocatePlayerProjectileId,
    itemExpirationTimeouts,
    ITEM_EXPIRATION_TIMES,
    groundPollens,
    webFields,
    WEB_SLOW_FACTOR,
    WEB_SLOW_LINGER_MS,
    GROUND_POLLEN_DAMAGE_INTERVAL_MS
} from './server/gameState';
import { handleMobDrops as handleMobDropsModule } from './server/itemManager';
import { updateBotAI, maintainBotCount, initializeBotGuilds } from './server/botManager';
import {
    respawnPlayer as respawnPlayerModule,
    calculateLevelFromTotalXP,
    addXPToPlayer as addXPToPlayerModule,
    addMazeXPToPlayer as addMazeXPToPlayerModule,
    savePlayerProgress as savePlayerProgressModule,
    getMazeSpawnPosition,
    isMazeTrackLive,
    getOutsideTotalXP,
    calculatePlayerModifiers
} from './server/playerManager';
import {
    getActiveMaze,
    setActiveMazeDay,
    getCurrentMazeDay,
    isInMazeRegion,
    MAZE_BIOMES
} from './maze';
import { spawnMazeMobs, spawnMazeBosses, clearMazeEnemies, invalidateMazeMobPool, hasMazePlayers } from './server/mazeSpawner';
import { setupTransferEndpoints, transferPlayerToServer as transferPlayerToServerModule } from './server/crossServer';
import {
    createEnemy as createEnemyModule,
    spawnSpecialMobs as spawnSpecialMobsModule,
    updateSpecialMobCounts as updateSpecialMobCountsModule,
    spawnCentipedeBodySegments,
    spawnInitialSpawns,
    getSectionAtPosition,
    EnemySpawnerHelpers
} from './server/enemySpawner';
import { spawnArenaMobs } from './server/pvpArenaSpawner';
import { updateSpawnZones } from './server/spawnZoneManager';
import { rebuildEnemyGrid, queryEnemiesNear } from './server/enemyGrid';
import { buildEnemy } from './server/shared/buildEnemy';
import { isInOutOfBoundsZone, clampToWorld, isWallAt, samplePointInViewport } from './server/shared/positions';
import { killEnemy } from './server/shared/killHandler';
import { downgradeRarity } from './server/shared/rarity';
import type { KillContext } from './server/shared/killHandler';
import { registerApiKeyRoutes, recordBossEvent, stripHtml } from './server/apiKeyApi';
import { setSuperMobInSection } from './server/gameState';

// Build today's maze up front so its spawn point and wall collision are live
// before the first player connects. Daily rotation happens in an interval
// further down (near the other spawn timers).
setActiveMazeDay(getCurrentMazeDay());

// Load persisted guilds into memory now that database + guildManager are both ready.
loadGuildsFromDatabase();
initializeBotGuilds();

// Build the uWebSockets.js-backed app. SSL is configured later (before listen)
// because the SSL/non-SSL choice depends on cert files we don't want to read twice.
let app: UApp;
{
    const certDir = path.resolve(__dirname, '..');
    const keyPath = path.join(certDir, 'cert.key');
    const certPath = path.join(certDir, 'cert.crt');
    if (USE_HTTPS && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        app = createApp({ ssl: { keyPath, certPath } });
        console.log(`[SERVER] Using HTTPS protocol`);
    } else {
        if (USE_HTTPS) console.warn(`[SERVER] HTTPS certificates not found, falling back to HTTP`);
        app = createApp();
        console.log(`[SERVER] Using HTTP protocol`);
    }
}

// Re-export functions that are used elsewhere
export { trackDamage, sendBossMobDefeatedMessage };

// Wrapper function for handleMobDrops that passes io (will be set up later)
let ioInstance: any;
export function handleMobDrops(enemy: Enemy, dropMultiplier: number = 1, io?: any) {
    const enemyData = {
        type: enemy.type,
        tier: enemy.tier,
        x: enemy.x,
        y: enemy.y,
        damageContributors: enemy.damageContributors ? new Map(enemy.damageContributors) : undefined
    };
    handleMobDropsModule(enemyData, io || ioInstance, dropMultiplier);
}

// Resolves the leaderboard XP/drop-rate reward multipliers for a mob-kill credit.
// Top 10 players: 0.5x XP, 1.2x drop rate. Top 20 players: 0.75x XP, 1.1x drop rate.
function getLeaderboardRewardMultipliers(playerId: string): { xpMultiplier: number; dropMultiplier: number } {
    return database.getLeaderboardRewardMultipliers(playerUserIds[playerId]);
}

// Wrapper function for updateTargetDummyDPS
function updateTargetDummyDPS() {
    if (!ioInstance) return; // Guard against ioInstance not being set yet
    
    const targetDummies = enemies.filter(e => e.type === 'target_dummy');
    
    for (const dummy of targetDummies) {
        const dps = calculateDPS(dummy);
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
app.use(jsonParser());

// Add CORS middleware with specific origin
app.use((req, res, next) => {
    const origin = req.headers.origin || 'https://localhost:8080';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Authentication endpoints.
//
// Login and register hand back an opaque session token; that token — never the
// password — is what the client keeps and what every later request presents.
// Bearer header only, never a query parameter, so tokens stay out of access
// logs and Referer headers.
const bearerToken = (req: { header(name: string): string | undefined }): string | undefined => {
    const header = req.header('Authorization');
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1] : undefined;
};

app.post('/auth/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = database.createUser(username, password);
    if (user) {
        // No session here — /auth/login is the only place a token is minted, so
        // there is exactly one path to audit. The guest flow logs in right after.
        res.status(201).json({ message: 'User created successfully', username: user.username });
    } else {
        res.status(400).json({ message: 'Username already exists' });
    }
});

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = database.getUser(username, password);
    if (user) {
        res.json({
            message: 'Login successful',
            userId: user.id,
            username: user.username,
            token: database.createSession(user)
        });
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

app.post('/auth/verify', (req, res) => {
    const token = bearerToken(req) || req.body?.token;

    if (!token) {
        return res.status(400).json({ message: 'Session token is required' });
    }

    const user = database.getUserBySession(token);
    if (user) {
        res.json({ valid: true, username: user.username });
    } else {
        res.status(401).json({ valid: false });
    }
});

app.post('/auth/logout', (req, res) => {
    // Revoking here is the point: a logged-out browser's leftover token must
    // stop working even if someone later reads it out of localStorage.
    const token = bearerToken(req) || req.body?.token;
    if (token) database.destroySession(token);
    res.json({ message: 'Logged out successfully' });
});

// Cross-server player transfer endpoints - setup will be called after io is created

// Serve static files from the dist directory
app.use('/', staticFiles(path.join(__dirname, '../dist'), {
    index: 'index.html',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    }
}));

// Explicitly serve index.html for root route (fallback)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// Serve assets with CORS headers
app.use('/assets', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});

app.use('/assets', staticFiles(path.join(__dirname, '../assets'), {
    setHeaders: (res, filePath) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Cross-Origin-Resource-Policy', 'cross-origin');
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Serve favicon from dist directory (it's copied there during build)
app.use('/favicon.ico', staticFiles(path.join(__dirname, '../dist/favicon.ico')));

// Notification endpoints
app.use(jsonParser());
app.get('/api/notifications', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const beforeTimestamp = req.query.before ? parseInt(req.query.before as string) : undefined;
    const notifications = database.getNotifications(limit, beforeTimestamp);
    res.json({ notifications });
});

app.post('/api/notifications', (req, res) => {
    const { type, message } = req.body;
    if (!type || !message) {
        return res.status(400).json({ message: 'Type and message are required' });
    }
    const notification: Notification = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        message,
        timestamp: Date.now()
    };
    database.addNotification(notification);
    res.json({ success: true, notification });
});

// Leaderboard endpoint
app.get('/api/leaderboard', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const includeAdmins = req.query.includeAdmins === 'true';
    const { entries, totalAccounts, dailyActiveUsers } = database.getLeaderboard(limit, includeAdmins);
    // Admin-only fields are gated on a session token in the Authorization
    // header. This used to take ?username=&password= — which wrote every
    // player's password into the access log of every request.
    const token = bearerToken(req);
    let isAdmin = false;
    if (token) {
        const user = database.getUserBySession(token);
        isAdmin = !!user && database.isUserAdmin(user.username);
    }
    const payload: { leaderboard: typeof entries; totalAccounts: number; dailyActiveUsers?: number } = {
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
Server.protocolSignature = getInventoryCodecSignature();
console.log(`[SERVER] Inventory codec signature: ${Server.protocolSignature}`);

const io = new Server(app);

// Set ioInstance for use in modules
ioInstance = io;

// Get current server port and configuration
const PORT = process.env.PORT || 3000;
const CURRENT_SERVER_PORT = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
const CURRENT_SERVER_CONFIG = getServerConfigByPort(CURRENT_SERVER_PORT) || { port: CURRENT_SERVER_PORT, host: 'localhost', name: `Server${CURRENT_SERVER_PORT}` };

// Setup cross-server transfer endpoints
setupTransferEndpoints(app, io, CURRENT_SERVER_CONFIG, CURRENT_SERVER_PORT);

// Create helper functions object for enemy spawner (must be defined before functions that use it)
const enemySpawnerHelpers: EnemySpawnerHelpers = {
    getPlayerViewports,
    isPositionInPlayerPetalRange,
    getEnemiesInViewportCount
};

// Remove or comment out these lines since we're not using grid generation anymore
// const MAZE_CELL_SIZE = 1000;
// const MAZE_WALL_THICKNESS = 100;

// Initialize map obstacles - using function from gameState module
import { initializeMapObstacles } from './server/gameState';

// Update the server initialization code
// Replace the old obstacle initialization with:
obstacles.push(...initializeMapObstacles());

// Viewport optimization functions moved to playerState module

function updateEnemyViewportStatus() {
    const currentTime = Date.now();

    for (const enemy of enemies) {
        // isPositionNearAnyPlayer (not isPositionInAnyViewport): maze/PVP
        // players sit outside the world rectangle and are excluded from the
        // world-clamped viewport list, which made every maze mob look
        // permanently out-of-view and churn through 30s despawns.
        if (isPositionNearAnyPlayer(enemy.x, enemy.y)) {
            enemy.lastViewportCheck = currentTime;
        }
    }
}

function calculateCurrentDensity() {
    const playerCount = Object.keys(players).length;
    const totalEnemies = enemies.length;
    const enemiesInViewport = getEnemiesInViewportCount();
    
    if (playerCount > 0) {
        const totalViewportArea = VIEWPORT_WITH_BUFFER_AREA * playerCount;
        const currentDensity = enemiesInViewport / totalViewportArea;
        const densityRatio = currentDensity / ORIGINAL_ENEMY_DENSITY;
        
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
    validatePlayerPositions(io);
    
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
    const playerCount = Object.keys(players).length;
    if (playerCount > 0) {
        // Calculate target enemy count based on current viewport density
        const viewports = getPlayerViewports();
        const totalViewportArea = viewports.reduce((total, viewport) => {
            const extendedViewport = {
                x: viewport.x - VIEWPORT_BUFFER,
                y: viewport.y - VIEWPORT_BUFFER,
                width: viewport.width + (VIEWPORT_BUFFER * 2),
                height: viewport.height + (VIEWPORT_BUFFER * 2)
            };
            return total + (extendedViewport.width * extendedViewport.height);
        }, 0);
        
        const targetDensity = ORIGINAL_ENEMY_COUNT / TOTAL_WORLD_AREA;
        const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
        const currentViewportEnemies = getEnemiesInViewportCount();
        
        if (currentViewportEnemies < targetEnemyCount) {
            // Scale spawn cap with player count so each player's viewport fills at the same rate
            const enemiesToSpawn = Math.min(5 * playerCount, targetEnemyCount - currentViewportEnemies);
            let spawned = 0;

            for (let i = 0; i < enemiesToSpawn; i++) {
                const newEnemy = createEnemy();
                if (newEnemy) {
                    enemies.push(newEnemy);
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
    const enemiesToRemove: number[] = [];

    // The maze is a bounded, persistently-populated dungeon (rrolf-style):
    // its mobs are capped by mazeSpawner and spawned across ALL corridors, so
    // while anyone is inside, none of them distance-despawn — otherwise the
    // deep zones would always be empty except a bubble around each player.
    // Once the maze has no players left, the normal 30s timer cleans it up.
    const mazeOccupied = hasMazePlayers();

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];

        // Special mobs (ultra, super, unique, apex) never despawn
        if (enemy.tier === 'ultra' || enemy.tier === 'super' || enemy.tier === 'unique' || enemy.tier === 'apex') {
            continue;
        }

        // Target dummies never despawn
        if (enemy.type === 'target_dummy') {
            continue;
        }

        if (mazeOccupied && isInMazeRegion(enemy.x, enemy.y)) {
            enemy.lastViewportCheck = undefined;
            continue;
        }

        // Check if enemy is currently outside any player's viewport (the
        // near-player check includes maze/PVP players, whose out-of-world
        // coordinates are invisible to the world-clamped viewport list).
        const inViewport = isPositionNearAnyPlayer(enemy.x, enemy.y);
        
        if (!inViewport) {
            // If enemy is outside viewport, update or set the last viewport check time
            if (!enemy.lastViewportCheck) {
                enemy.lastViewportCheck = currentTime;
            }
            
            // Despawn if enemy has been outside viewport for more than 30 seconds
            if (currentTime - enemy.lastViewportCheck > 30000) { // 30 seconds
                enemiesToRemove.push(i);
            }
        } else {
            // Enemy is in viewport, reset the last viewport check
            enemy.lastViewportCheck = undefined;
        }
    }
    
    // Remove enemies and notify clients
    for (const index of enemiesToRemove) {
        const enemy = enemies[index];
        // Clean up enemy data structures before removal to prevent memory leaks
        cleanupEnemy(enemy);
        enemies.splice(index, 1);
        io.emit('enemyDestroyed', enemy.id);
        // console.log(`[SERVER] Despawned enemy ${enemy.id} (${enemy.type} ${enemy.tier}) - outside viewport for 30+ seconds`);
    }
}

// createSpecialMob moved to enemySpawner module

// Wrapper functions for enemy spawner
export function updateSpecialMobCounts() {
    updateSpecialMobCountsModule();
}

function spawnSpecialMobs() {
    spawnSpecialMobsModule(enemySpawnerHelpers, io);
}

// Remove every wild mob from the world at once (admin "kill all" command).
// Pets (enemies with an ownerId) are left alone: they belong to players and are
// tracked/despawned through the pet system, so splicing them here would corrupt
// that bookkeeping. Returns the number of mobs cleared. No XP/loot is awarded —
// this is a clean despawn, not a scored kill.
function clearAllMobs(): number {
    let removed = 0;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (enemy.ownerId) continue; // keep player pets
        cleanupEnemy(enemy);
        enemies.splice(i, 1);
        io.emit('enemyDestroyed', enemy.id);
        removed++;
    }
    // Special-mob counters (ultra/super/unique, section tracking) are derived from
    // the enemies array, so refresh them after the bulk removal.
    updateSpecialMobCounts();
    return removed;
}

// Wrapper for createEnemy
function createEnemy(): Enemy | null {
    const enemy = createEnemyModule(enemySpawnerHelpers);
    if (enemy && enemy.tier === 'super' && enemy.type !== 'target_dummy') {
        // Ambient super spawn (e.g. via the 1% ultra-zone upgrade). The module
        // function only constructs the enemy — special-mob bookkeeping and the
        // chat broadcast that normally fire from spawnSpecialMobs need to run
        // here so the new super is counted, section-tracked, and announced.
        announceAmbientSuper(enemy);
    }
    return enemy;
}

// /spawn builds mobs directly via buildEnemy(), bypassing spawnSpecialMobs()/
// announceAmbientSuper() entirely, so boss-tier mobs it creates never fired the
// chat banner or the boss-event log. This mirrors that announcement for any
// tier normally treated as a boss (super, unique, apex), regardless of spawn origin.
function announceBossSpawn(bossMob: Enemy, tier: 'super' | 'unique' | 'apex'): void {
    const mobSection = getSectionAtPosition(bossMob.x, bossMob.y);
    const spawnTimestamp = Date.now();
    const tierColor = ENEMY_TIERS[tier].color;

    Object.entries(players).forEach(([playerId, player]) => {
        const playerSection = getSectionAtPosition(player.x, player.y);
        const somewhere = playerSection === mobSection ? '' : ' somewhere';
        io.to(playerId).emit('chatMessage', {
            sender: '',
            content: `<b style="color: ${tierColor};">A ${tier} ${bossMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
            timestamp: spawnTimestamp
        });
    });

    const message = `A ${tier} ${bossMob.type.replace('_', ' ')} has spawned!`;
    recordBossEvent({
        type: 'spawn',
        tier,
        mobType: bossMob.type,
        x: bossMob.x,
        y: bossMob.y,
        timestamp: spawnTimestamp,
        message: stripHtml(message)
    });
}

function announceAmbientSuper(superMob: Enemy): void {
    superMobCount.value++;
    const mobSection = getSectionAtPosition(superMob.x, superMob.y);
    setSuperMobInSection(mobSection, superMob.id);

    const spawnTimestamp = Date.now();
    Object.entries(players).forEach(([playerId, player]) => {
        const playerSection = getSectionAtPosition(player.x, player.y);
        const somewhere = playerSection === mobSection ? '' : ' somewhere';
        io.to(playerId).emit('chatMessage', {
            sender: '',
            content: `<b style="color: ${ENEMY_TIERS.super.color};">A super ${superMob.type.replace('_', ' ')} has spawned${somewhere}!</b>`,
            timestamp: spawnTimestamp
        });
    });

    const message = `A super ${superMob.type.replace('_', ' ')} has spawned!`;
    recordBossEvent({
        type: 'spawn',
        tier: 'super',
        mobType: superMob.type,
        x: superMob.x,
        y: superMob.y,
        timestamp: spawnTimestamp,
        message: stripHtml(message)
    });
    console.log(`[SERVER] Ambient super mob spawned: ${superMob.type} at (${superMob.x}, ${superMob.y})`);
}

// Function to spawn a specific mob with a specific rarity at optional coordinates
function spawnMob(mobType: string, rarity: string, x?: number, y?: number, count: number = 1, stack: boolean = false): void {
    // Clamp requested amount to a sane range so an admin typo can't flood the world.
    const MAX_SPAWN_COUNT = 500;
    count = Math.max(1, Math.min(MAX_SPAWN_COUNT, Math.floor(count) || 1));

    // Validate mob type
    const allMobTypes = getAllMobTypes();
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

    const tier = rarity.toLowerCase() as Enemy['tier'];
    const mobStats = getMobStats(mobType, tier);
    
    if (!mobStats) {
        console.log(`No stats found for ${mobType} with rarity ${tier}`);
        return;
    }

    // Find a valid spawn position
    let validPosition = false;
    let spawnX: number | undefined = x;
    let spawnY: number | undefined = y;
    let attempts = 0;
    const MAX_ATTEMPTS = 100;

    // If coordinates are provided, validate them
    if (spawnX !== undefined && spawnY !== undefined) {
        const clamped = clampToWorld(spawnX, spawnY);
        spawnX = clamped.x;
        spawnY = clamped.y;

        if (isInOutOfBoundsZone(spawnX, spawnY)) {
            console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) are in out-of-bounds zone. Finding alternative position...`);
            spawnX = undefined;
            spawnY = undefined;
        } else if (!isWallAt(spawnX, spawnY)) {
            validPosition = true;
        } else {
            console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) collide with a wall. Finding alternative position...`);
            spawnX = undefined;
            spawnY = undefined;
        }
    }

    // If coordinates weren't provided or were invalid, find a valid position
    if (!validPosition) {
        // Try to spawn near a player if available
        const playerIds = Object.keys(players);
        const samplePoint = (): { x: number; y: number } => {
            if (playerIds.length > 0) {
                const player = players[playerIds[Math.floor(Math.random() * playerIds.length)]];
                return samplePointInViewport(player);
            }
            return { x: Math.random() * ACTUAL_WORLD_WIDTH, y: Math.random() * ACTUAL_WORLD_HEIGHT };
        };

        while (!validPosition && attempts < MAX_ATTEMPTS) {
            attempts++;
            const point = samplePoint();
            spawnX = point.x;
            spawnY = point.y;

            // Skip if position is in out-of-bounds zone or collides with a wall
            // (state 1 = wall, state 2 = water).
            if (isInOutOfBoundsZone(spawnX, spawnY)) continue;
            if (!isWallAt(spawnX, spawnY)) validPosition = true;
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
    const jitterRadius = mobStats.size ? (mobStats.size * 40) / 2 : ENEMY_SIZE / 2;

    for (let n = 0; n < count; n++) {
        let ex = spawnX;
        let ey = spawnY;
        if (!stack && count > 1) {
            const jitterAngle = Math.random() * Math.PI * 2;
            const jitterDist = Math.random() * jitterRadius;
            const clamped = clampToWorld(
                spawnX + Math.cos(jitterAngle) * jitterDist,
                spawnY + Math.sin(jitterAngle) * jitterDist,
            );
            ex = clamped.x;
            ey = clamped.y;
        }

        const enemy = buildEnemy(mobType, tier, ex, ey);
        if (!enemy) continue;

        // DPS tracking buffers are allocated lazily on first damage event in trackDamage().

        // Add to enemies array
        enemies.push(enemy);

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
        if (isCentipedeHeadType(mobType)) {
            const beforeCount = enemies.length;
            spawnCentipedeBodySegments(enemy);
            for (let i = beforeCount; i < enemies.length; i++) {
                io.emit('enemySpawned', enemies[i]);
            }
        }

        // Mobs with initial_spawns (e.g. ant holes) arrive with a pre-spawned cluster.
        if (mobStats.initial_spawns && mobStats.initial_spawns.length > 0) {
            const beforeCount = enemies.length;
            spawnInitialSpawns(enemy);
            for (let j = beforeCount; j < enemies.length; j++) {
                io.emit('enemySpawned', enemies[j]);
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
console.log(`  Original Density: ${ORIGINAL_ENEMY_DENSITY.toFixed(8)} enemies/pixel²`);
console.log(`  Target: Maintain same density as ${ORIGINAL_ENEMY_COUNT} enemies across entire world (9x density)`);
console.log(`  Despawn Rule: Enemies outside viewport for 30+ seconds will despawn`);

// Initialize decorations
for (let i = 0; i < DECORATION_COUNT; i++) {
    decorations.push(createDecoration());
}

// Initialize sands
for (let i = 0; i < SAND_COUNT; i++) {
    sands.push(createSand());
}

// TP costs for each rarity tier (total = 100 TP for full tree)
const RARITY_TP_COSTS: Record<string, number> = {
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
function saveAfterXP(player: ServerPlayer, socketId?: string): void {
    if (!socketId) return;
    const socket = ioInstance.sockets.sockets.get(socketId) as AuthenticatedSocket;
    if (socket?.userId) {
        savePlayerProgressModule(player, socket.userId, database);
    }
}

// The live track's XP bar / level / stats changed — tell the owning client.
function emitLiveXPGain(player: ServerPlayer, xp: number): void {
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
export function addXPToPlayer(player: ServerPlayer, xp: number, socketId?: string): void {
    const banked = isMazeTrackLive(player);
    addXPToPlayerModule(player, xp, socketId, ioInstance);

    if (banked) {
        const outsideTotalXP = getOutsideTotalXP(player);
        ioInstance.to(player.id).emit('outsideXpGained', {
            playerId: player.id,
            xp: xp,
            outsideLevel: calculateLevelFromTotalXP(outsideTotalXP),
            outsideTotalXp: outsideTotalXP
        });
    } else {
        emitLiveXPGain(player, xp);
    }

    saveAfterXP(player, socketId);
}

/**
 * Grant MAZE XP. Only absorbing calls this. Outside the maze it accumulates
 * into the parked maze total (absorbing is maze-only today, so this is just
 * defensive) and no client event is sent.
 */
export function addMazeXPToPlayer(player: ServerPlayer, xp: number, socketId?: string): void {
    const live = isMazeTrackLive(player);
    addMazeXPToPlayerModule(player, xp, ioInstance);

    if (live) emitLiveXPGain(player, xp);
    saveAfterXP(player, socketId);
}

// Wrapper for respawnPlayer that passes io
function respawnPlayer(player: ServerPlayer) {
    respawnPlayerModule(player, ioInstance);
}

// Debounced save mechanism to prevent lag from frequent saves
const pendingSaves = new Map<string, NodeJS.Timeout>();

// Code redemption system - import from database
import { RedeemedCode } from './database';

export const redeemedCodes = new Map<string, RedeemedCode>();

// Load codes from database on server startup
function loadCodesFromDatabase(): void {
    const savedCodes = database.getAllCodes();
    redeemedCodes.clear();
    let loadedCount = 0;
    let removedCount = 0;
    
    for (const [code, codeData] of Object.entries(savedCodes)) {
        // Check if code has reached max uses - if so, remove it from database
        if (codeData.maxUses && codeData.uses >= codeData.maxUses) {
            database.deleteCode(code);
            removedCount++;
        } else {
            redeemedCodes.set(code, codeData);
            loadedCount++;
        }
    }
    
    console.log(`[SERVER] Loaded ${loadedCount} codes from database`);
    if (removedCount > 0) {
        console.log(`[SERVER] Removed ${removedCount} fully used codes from database`);
    }
}

// Save code to database
export function saveCodeToDatabase(code: string, codeData: RedeemedCode): void {
    database.saveCode(code, codeData);
}

// Delete code from database
export function deleteCodeFromDatabase(code: string): void {
    database.deleteCode(code);
}

// Load codes when server starts
loadCodesFromDatabase();

// Register the API-key authenticated REST API. Must run after redeemedCodes
// + saveCodeToDatabase/deleteCodeFromDatabase are defined above.
registerApiKeyRoutes(app, {
    redeemedCodes,
    saveCodeToDatabase,
    deleteCodeFromDatabase
});

// Wrapper for savePlayerProgress that passes database with debouncing
function savePlayerProgress(player: ServerPlayer, userId: string) {
    // Clear existing timeout for this player
    const existingTimeout = pendingSaves.get(userId);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }
    
    // Set a new timeout to save after 2 seconds of no activity
    // This batches multiple rapid pickups into a single save
    const timeout = setTimeout(() => {
        savePlayerProgressModule(player, userId, database);
        pendingSaves.delete(userId);
    }, 2000);
    
    pendingSaves.set(userId, timeout);
}

// Immediate save function for critical operations (disconnect, etc.)
function savePlayerProgressImmediate(player: ServerPlayer, userId: string) {
    // Clear any pending debounced save
    const existingTimeout = pendingSaves.get(userId);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        pendingSaves.delete(userId);
    }
    // Save immediately
    savePlayerProgressModule(player, userId, database);
}

// Function to adjust enemy count based on player count
function adjustEnemyCount() {
    const playerCount = Object.keys(players).length;
    const targetEnemyCount = playerCount > 0 ? ENEMIES_PER_VIEWPORT * playerCount : ENEMY_COUNT.value;
    
    // Remove excess enemies if current count is higher than target
    while (enemies.length > targetEnemyCount) {
        const removedEnemy = enemies.pop();
        if (removedEnemy) {
            io.emit('enemyDestroyed', removedEnemy.id);
        }
    }

    // Add new enemies if current count is lower than target
    while (enemies.length < targetEnemyCount) {
        const enemy = createEnemy();
        if (enemy) {
            enemies.push(enemy);
        } else {
            // If we can't spawn more enemies (no valid positions), break the loop
            break;
        }
    }

    // Don't send enemiesUpdate here - enemies are sent via enemySpawned/enemyDestroyed events
    console.log(`[SERVER] Adjusted enemy count to ${enemies.length}/${targetEnemyCount} (${playerCount} players)`);
}

// Command handler dependencies (defined after all functions it depends on)
const commandDeps: CommandHandlerDependencies = {
    io,
    savePlayerProgress,
    spawnMob,
    spawnSpecialMobs,
    clearAllMobs,
    createEnemy,
    adjustEnemyCount
};

// Player state handler dependencies
const playerStateDeps: PlayerStateDependencies = {
    io,
    addXPToPlayer,
    handleMobDrops,
    sendBossMobDefeatedMessage,
    updateSpecialMobCounts,
    createEnemy,
    savePlayerProgress,
    transferPlayerToServer: transferPlayerToServerModule,
    currentServerConfig: CURRENT_SERVER_CONFIG,
    currentServerPort: CURRENT_SERVER_PORT,
    useHttps: USE_HTTPS,
    database,
    trackMobKill,
    // Lazy on purpose: this bag is built at module scope, long before the ECS
    // runtime is constructed on first tick.
    projectiles: {
        spawn: (spec) => getEcsRuntime().spawnPlayerProjectile(spec),
        forEachBlocking: (x, y, petalRadius, visit) =>
            getEcsRuntime().forEachMobProjectileHitting(x, y, petalRadius, visit),
    }
};

// Kill-handler context for the consolidated death sequence (see shared/killHandler).
// Mirrors the kill-related subset of playerStateDeps; built once at boot.
const killCtx: KillContext = {
    io,
    players,
    playerUserIds,
    database,
    savePlayerProgress,
    addXPToPlayer,
    handleMobDrops,
    sendBossMobDefeatedMessage,
    updateSpecialMobCounts,
    cleanupEnemy,
    trackMobKill,
};

io.on('connection', (socket: AuthenticatedSocket) => {
    registerConnectionHandlers(socket, io, {
        savePlayerProgress,
        savePlayerProgressImmediate,
        addXPToPlayer,
        addMazeXPToPlayer,
        respawnPlayer,
        triggerViewportUpdate,
        redeemedCodes,
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
    for (const enemy of enemies) {
        if (enemy.slowUntil === undefined) continue;
        if (currentTime < enemy.slowUntil) continue;
        if (enemy.baseSpeed !== undefined) enemy.speed = enemy.baseSpeed;
        enemy.slowUntil = undefined;
    }
}

/**
 * Tick the poison a mob's bite left on a flower (evil centipede). Lotus's
 * poisonArmor is subtracted from the per-second rate, so enough of it makes the
 * flower immune outright rather than merely slowing the bleed.
 */
function updatePlayerPoison(deltaTime: number) {
    const currentTime = Date.now();
    for (const id in players) {
        const player = players[id];
        if (!player.poisonUntil) continue;
        if (player.isDead || currentTime >= player.poisonUntil) {
            player.poisonUntil = undefined;
            player.poisonDamage = undefined;
            player.poisonSource = undefined;
            continue;
        }
        if (player.isInvulnerable) continue;

        const armor = calculatePlayerModifiers(player).poisonArmor ?? 0;
        const dps = Math.max(0, (player.poisonDamage ?? 0) - armor);
        if (dps <= 0) continue;

        player.health -= dps * deltaTime;
        player.lastDamageTime = currentTime;

        if (player.health <= 0 && !trySecondChance(player, io)) {
            player.health = 0;
            player.isDead = true;
            if (player.poisonSource) player.killedBy = player.poisonSource;
            despawnAllPlayerPets(player.id, io);
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

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (enemy.despawnAt !== undefined && currentTime >= enemy.despawnAt && !enemy.isDead) {
            enemy.isDead = true;
            cleanupEnemy(enemy);
            enemies.splice(i, 1);
            io.emit('enemyDestroyed', enemy.id);
        }
    }

    for (const enemy of enemies) {
        if (enemy.isDead) continue;
        const stats = enemy._mobStats ?? getMobStats(enemy.type, enemy.tier);
        const spawnCfg = stats?.periodic_spawn;
        if (!spawnCfg) continue;

        const last = enemy.lastPeriodicSpawnTime ?? 0;
        if (currentTime - last < spawnCfg.intervalMs) continue;
        enemy.lastPeriodicSpawnTime = currentTime;

        let alive = 0;
        for (const other of enemies) {
            if (other.parentHoleId === enemy.id && other.type === spawnCfg.mobType) alive++;
        }
        if (alive >= spawnCfg.maxAlive) continue;

        // Behind the summoner, like gardn's queen ant.
        const radius = (stats!.size * 40) / 2 * getEnemySizeScale(!!enemy.ownerId, enemy.tier);
        const behindX = enemy.x - Math.cos(enemy.angle) * radius;
        const behindY = enemy.y - Math.sin(enemy.angle) * radius;
        let spawnTier = enemy.tier;
        for (let step = 0; step < -(spawnCfg.spawnRarityOffset ?? 0); step++) {
            spawnTier = downgradeRarity(spawnTier);
        }
        const child = buildEnemy(spawnCfg.mobType, spawnTier, behindX, behindY, {
            parentHoleId: enemy.id,
            ownerId: enemy.ownerId,
        });
        if (!child) continue;
        child.despawnAt = currentTime + spawnCfg.lifetimeMs;
        child.targetPlayerId = enemy.targetPlayerId;
        enemies.push(child);
        io.emit('enemySpawned', child);
    }
}

function updatePoisonEffects(deltaTime: number) {
    const currentTime = Date.now();

    enemies.forEach(enemy => {
        if (!enemy.poisonEffects || enemy.poisonEffects.length === 0) {
            return;
        }
        
        // Calculate total poison damage from all active effects
        let totalPoisonDamage = 0;
        const activePoisons: typeof enemy.poisonEffects = [];
        
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
                trackDamage(enemy, poison.playerId, poison.damage * deltaTime * 1000);
            });
            
            // Mark enemy for batched damage update at end of frame
            markEnemyPoisonDamaged(enemy);

            // Check if enemy dies from poison (only process once per enemy)
            if (enemy.health <= 0 && !(enemy as any).isDead) {
                // Mark enemy as dead to prevent multiple death handlers
                (enemy as any).isDead = true;
                
                const index = enemies.findIndex(e => e.id === enemy.id);
                if (index !== -1) {
                    // Award XP to all players who contributed poison damage
                    const baseXpGained = getXPFromEnemy(enemy);

                    // Find the player who dealt the most damage (including poison)
                    let topContributor: string | undefined;
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
                    if (topContributor && players[topContributor]) {
                        addXPToPlayer(players[topContributor], Math.round(baseXpGained * xpMultiplier), topContributor);
                    }

                    // Track mob kill for eligible players (use debounced save to prevent lag)
                    trackMobKill(enemy, players, playerUserIds, database, io, savePlayerProgress);
                    // Handle mob drops (includes all eligible players)
                    handleMobDrops(enemy, dropMultiplier);
                    sendBossMobDefeatedMessage(enemy, io, players);
                    // Clean up enemy data structures before removal to prevent memory leaks
                    cleanupEnemy(enemy);
                    enemies.splice(index, 1);
                    updateSpecialMobCounts();
                    io.emit('enemyDestroyed', enemy.id);
                    
                    // Try to spawn a new enemy
                    const newEnemy = createEnemy();
                    if (newEnemy) {
                        enemies.push(newEnemy);
                    }
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
    for (const enemy of enemies) {
        if ((enemy as any).isDead) continue;

        // _mobStats is cached on grid insertion; only hole-type mobs have
        // spawn_waves, so this skips ~all 1400 enemies without a stats lookup.
        const parentStats = enemy._mobStats ?? getMobStats(enemy.type, enemy.tier);
        if (!parentStats || !parentStats.spawn_waves || parentStats.spawn_waves.length === 0) continue;
        const waves = parentStats.spawn_waves;
        const numWaves = waves.length - 1;

        const prev = (enemy as any)._spawnWavePrevHealth;
        if (prev === undefined) {
            (enemy as any)._spawnWavePrevHealth = enemy.health;
            continue;
        }

        if (enemy.health >= prev) {
            (enemy as any)._spawnWavePrevHealth = enemy.health;
            continue;
        }

        const maxHp = enemy.maxHealth || 1;
        // Clamp to the valid wave range [0, numWaves]. Without this, a large overkill
        // drives enemy.health far negative, so endWave becomes a huge negative number
        // and the loop spins from startWave down to it — millions of iterations that all
        // just `continue` (out-of-range waveIndex): a tight, flat-heap 100% CPU hang.
        const startWave = Math.min(numWaves, Math.floor((prev / maxHp) * numWaves));
        const endWave = Math.max(0, Math.ceil((enemy.health / maxHp) * numWaves));
        const parentRadius = (parentStats.size * 40) / 2 * getEnemySizeScale(!!enemy.ownerId, enemy.tier);

        for (let i = startWave; i >= endWave; i--) {
            const waveIndex = numWaves - i;
            if (waveIndex < 0 || waveIndex >= waves.length) continue;
            const wave = waves[waveIndex];

            for (const childType of wave) {
                const angle = Math.random() * Math.PI * 2;
                const dist = parentRadius + 10 + Math.random() * parentRadius;
                const child = buildEnemy(
                    childType,
                    enemy.tier,
                    enemy.x + Math.cos(angle) * dist,
                    enemy.y + Math.sin(angle) * dist,
                    { parentHoleId: enemy.id },
                );
                if (!child) continue;
                enemies.push(child);
                io.emit('enemySpawned', child);
            }
        }

        (enemy as any)._spawnWavePrevHealth = enemy.health;
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

    syncToEcs(runtime.world, enemies, players, now);
    // deltaTime is nominal here on purpose: the ported mob step is a FIXED
    // per-call step, exactly as the legacy one was, and moveEnemies is called
    // mobCatchupCalls times rather than being handed a larger dt.
    runtime.tick(1 / 30, 1000 / 30, now);
    syncFromEcs(runtime.world, enemies);

    // Reaping stays here: it awards XP, rolls drops and touches the database,
    // none of which is ported.
    reapDeadEnemies();
    // Enemies reach clients via enemySpawned/enemyDestroyed, not a bulk update here.
}

/**
 * The ECS runtime, built on first use so nothing is constructed on servers
 * running with the simulation switched off.
 */
let _ecsRuntime: EcsRuntime | undefined;
function getEcsRuntime(): EcsRuntime {
    if (_ecsRuntime) return _ecsRuntime;
    _ecsRuntime = createEcsRuntime({
        lookupPlayer: (socketId: string) => players[socketId],
        // Pet kills are credited to the owning PLAYER, matching trackDamage.
        creditDamage: (victim, ownerPlayer, amount) => {
            const world = _ecsRuntime!.world;
            const victimId = world.externalIdOf(victim);
            const ownerId = world.externalIdOf(ownerPlayer);
            if (!victimId || !ownerId) return;
            const enemy = enemies.find(e => e.id === victimId);
            if (enemy) trackDamage(enemy, ownerId, amount);
        },
        onEnemyDamaged: (victim) => {
            const world = _ecsRuntime!.world;
            const victimId = world.externalIdOf(victim);
            if (!victimId) return;
            const enemy = enemies.find(e => e.id === victimId);
            if (enemy) markEnemyDamaged(enemy);
        },
        // Death is left to reapDeadEnemies: syncFromEcs zeroes the legacy
        // health, and the existing reaper awards XP and drops from there.
        onEnemyKilled: () => { /* handled by reapDeadEnemies */ },
        isNearAnyPlayer: isPositionNearAnyPlayer,

        // --- projectiles -------------------------------------------------
        // The wire-id counters stay in gameState because they are broadcast
        // bookkeeping, not simulation state.
        allocateProjectileNetId: (fromPlayer) =>
            fromPlayer ? allocatePlayerProjectileId() : allocateMobProjectileId(),
        resolvePlayerEntity: (socketId) => {
            const player = players[socketId];
            if (!player) return undefined;
            return ensurePlayerEntity(_ecsRuntime!.world, player, Date.now());
        },
        playerRadiusOf: (entity) => {
            const player = playerFromEntity(entity);
            return (PLAYER_SIZE / 2) * (player?.sizeMultiplier ?? 1.0);
        },
        damageMultiplierOf: (entity) => {
            const player = playerFromEntity(entity);
            return player ? getDamageMultiplier(player) : undefined;
        },
        onPlayerHit: applyProjectileHitToPlayer,
        emitEnemyDamaged: (victim, health) => {
            const enemyId = _ecsRuntime!.world.externalIdOf(victim);
            if (enemyId) io.emit('enemyDamaged', { enemyId, health });
        },
        onProjectileKill: (victim, killer, timing) => {
            const world = _ecsRuntime!.world;
            const victimId = world.externalIdOf(victim);
            if (!victimId) return;
            const index = enemies.findIndex(e => e.id === victimId);
            if (index < 0) return;
            killEnemy(enemies[index], index, enemies, killCtx, {
                killerPlayerId: world.externalIdOf(killer),
                trackMobKillTiming: timing,
            });
        },
    });
    configureCutover(_ecsRuntime);
    console.log('[ECS] mob simulation initialised');
    return _ecsRuntime;
}

/** The ServerPlayer behind an ECS entity, if it is still in the world. */
function playerFromEntity(entity: Entity): ServerPlayer | undefined {
    const id = _ecsRuntime!.world.externalIdOf(entity);
    return id ? players[id] : undefined;
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
function applyProjectileHitToPlayer(
    entity: Entity,
    damage: number,
    knockbackX: number,
    knockbackY: number,
    sourceTypeName: string,
): boolean {
    const player = playerFromEntity(entity);
    if (!player) return false;

    // Written straight onto the player: the ECS must not do this itself, because
    // syncToEcs pushes each player's legacy position back INTO the ECS every
    // tick and would overwrite the write before it could be broadcast.
    player.x += knockbackX;
    player.y += knockbackY;

    if (isGlitchInfectingType(sourceTypeName)) player.glitched = true;

    let damageDealt = 0;
    if (!player.isInvulnerable) {
        damageDealt = damage;
        player.health -= damageDealt;

        if (player.health <= 0) {
            player.isDead = true;
            player.health = 0;
            despawnAllPlayerPets(player.id, io);
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
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (!(enemy as any).isDead && enemy.health > 0) continue;

        // A pet kill is credited to its owner: contributors are keyed by player.
        if (enemy.damageContributors && enemy.damageContributors.size > 0) {
            let topContributor: string | undefined;
            let maxDamage = 0;
            enemy.damageContributors.forEach((damage, playerId) => {
                if (damage > maxDamage) {
                    maxDamage = damage;
                    topContributor = playerId;
                }
            });

            if (topContributor && players[topContributor]) {
                const { xpMultiplier, dropMultiplier } = getLeaderboardRewardMultipliers(topContributor);
                addXPToPlayer(players[topContributor], Math.round(getXPFromEnemy(enemy) * xpMultiplier), topContributor);
                trackMobKill(enemy, players, playerUserIds, database, io, savePlayerProgress);
                handleMobDrops(enemy, dropMultiplier);
                sendBossMobDefeatedMessage(enemy, io, players);
            }
        }

        // A wild hole can leave a digger behind. Pet holes are excluded — a
        // player's own summon shouldn't hatch a hostile. Appending is safe here:
        // the loop walks backwards, so the new mob is never visited this pass
        // (and it spawns at full health, so it wouldn't be reaped anyway).
        if (DIGGER_SPAWNING_HOLES.has(enemy.type) && !enemy.ownerId && Math.random() < DIGGER_SPAWN_CHANCE) {
            const digger = buildEnemy('digger', enemy.tier, enemy.x, enemy.y);
            if (digger) {
                enemies.push(digger);
                io.emit('enemySpawned', digger);
            }
        }

        // Clean up enemy data structures before removal to prevent memory leaks
        cleanupEnemy(enemy);
        enemies.splice(i, 1);
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
const projectileSpawnBuffer: ProjectileWire[] = [];
const projectileRemovedBuffer: number[] = [];

function broadcastProjectiles(): void {
    const runtime = getEcsRuntime();

    for (let kind = 0; kind < 2; kind++) {
        const fromPlayer = kind === 1;
        const query = fromPlayer ? runtime.projectileQueries.player : runtime.projectileQueries.mob;
        const knownByPlayer = fromPlayer ? knownPlayerProjectilesByPlayer : knownMobProjectilesByPlayer;
        const spawnEvent = fromPlayer ? 'ppSpawn' : 'mpSpawn';
        const removeEvent = fromPlayer ? 'ppRemove' : 'mpRemove';

        for (const playerId of Object.keys(players)) {
            const socket = io.sockets.sockets.get(playerId) as AuthenticatedSocket;
            if (!socket || !socket.userId) continue;
            // Box the client's CAMERA flower, which is the active half while split.
            const player = getActivePlayerForSocket(playerId);
            if (!player) continue;
            const vw = (player.viewportWidth || VIEWPORT_WIDTH) * 1.5;
            const vh = (player.viewportHeight || VIEWPORT_HEIGHT) * 1.5;

            let known = knownByPlayer.get(playerId);
            if (!known) {
                known = new Set();
                knownByPlayer.set(playerId, known);
            }

            // A fresh set per client per tick: it becomes that client's new
            // known-set, so it cannot be a shared scratch buffer.
            const stillKnown = new Set<number>();
            encodeProjectilesInBox(
                query, player.x, player.y, vw, vh,
                known, projectileSpawnBuffer, stillKnown,
            );
            diffRemoved(known, stillKnown, projectileRemovedBuffer);
            knownByPlayer.set(playerId, stillKnown);

            if (projectileSpawnBuffer.length) io.to(playerId).emit(spawnEvent, projectileSpawnBuffer.slice());
            if (projectileRemovedBuffer.length) io.to(playerId).emit(removeEvent, projectileRemovedBuffer.slice());
        }
    }
}

// Tick ground pollen drops: deal damage to enemies in radius (rate-limited per
// enemy so a mob standing on it takes recurring chip damage rather than a
// single hit), expire after lifetime, and emit state to nearby players.
function updateGroundPollens() {
    const currentTime = Date.now();

    for (let i = groundPollens.length - 1; i >= 0; i--) {
        const pollen = groundPollens[i];

        if (currentTime >= pollen.expiresAt) {
            groundPollens.splice(i, 1);
            io.emit('groundPollenRemoved', pollen.id);
            continue;
        }

        const player = players[pollen.playerId];
        const damageMultiplier = player ? getDamageMultiplier(player) : 1;
        const finalDamage = pollen.damage * damageMultiplier;

        for (let j = enemies.length - 1; j >= 0; j--) {
            const enemy = enemies[j];
            if (enemy.ownerId) continue;
            if ((enemy as any).isDead) continue;

            const dx = enemy.x - pollen.x;
            const dy = enemy.y - pollen.y;
            const mobStats = getMobStats(enemy.type, enemy.tier);
            const enemyRadius = mobStats ? (mobStats.size * 40) / 2 : ENEMY_SIZE / 2;
            const minDistance = pollen.radius + enemyRadius;
            if (dx * dx + dy * dy >= minDistance * minDistance) continue;

            const lastDmg = pollen.lastDamageByEnemy.get(enemy.id) || 0;
            if (currentTime - lastDmg < GROUND_POLLEN_DAMAGE_INTERVAL_MS) continue;
            pollen.lastDamageByEnemy.set(enemy.id, currentTime);

            if (player) trackDamage(enemy, pollen.playerId, finalDamage);
            enemy.health = Math.max(0, enemy.health - finalDamage);
            markEnemyDamaged(enemy);

            if (enemy.health <= 0 && !(enemy as any).isDead) {
                killEnemy(enemy, j, enemies, killCtx, {
                    killerPlayerId: pollen.playerId,
                    trackMobKillTiming: 'sync-snapshot',
                });
            }
        }
    }
}

// Reusable buffer for the web-field enemy-grid query (see updateWebFields).
const _webQueryBuffer: Enemy[] = [];

/**
 * Web fields left behind by thrown web petals: expire them, and halve the speed
 * of everything standing in one. gardn does this in Collision.cc by clamping
 * `speed_ratio` for any entity overlapping a kWeb entity, which it recomputes
 * from scratch each tick; here the field keeps refreshing a short timed slow, so
 * a mob that walks out is back to full speed a fraction of a second later.
 */
function updateWebFields() {
    const currentTime = Date.now();

    for (let i = webFields.length - 1; i >= 0; i--) {
        const web = webFields[i];

        if (currentTime >= web.expiresAt) {
            webFields.splice(i, 1);
            io.emit('webRemoved', web.id);
            continue;
        }

        const caught = queryEnemiesNear(web.x, web.y, web.radius, _webQueryBuffer);
        for (let j = 0; j < caught.length; j++) {
            const enemy = caught[j];
            if (enemy.isDead) continue;
            const dx = enemy.x - web.x;
            const dy = enemy.y - web.y;
            const reach = web.radius + (enemy._radius ?? ENEMY_SIZE / 2);
            if (dx * dx + dy * dy >= reach * reach) continue;
            // The field carries the rarity of the petal that was thrown, so a
            // high-rarity web still bites on mobs that shrug off a common one.
            applySlow(enemy, WEB_SLOW_FACTOR, currentTime + WEB_SLOW_LINGER_MS, web.rarity);
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
export function simulateTickSpike(deltaSeconds: number, durationMs: number): { ok: boolean; message: string } {
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
export function cancelSimulatedTickSpike(): boolean {
    const wasActive = simulatedTickSpikeUntilMs > performance.now();
    simulatedTickSpikeUntilMs = 0;
    return wasActive;
}

/** Info about the active simulated tick spike, or null if none is running. */
export function getSimulatedTickSpikeInfo(): { deltaSeconds: number; remainingMs: number } | null {
    const remaining = simulatedTickSpikeUntilMs - performance.now();
    if (remaining <= 0) return null;
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
function runSimulationStep(deltaTime: number, deltaMs: number, mobCatchupCalls: number): void {
    for (const id in players) {
        updatePlayerState(players[id], deltaTime, playerStateDeps);
    }

    updatePetalActions(deltaTime);

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
    syncFromEcs(projectileRuntime.world, enemies);

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
function flushEnemyDamageBatch(): void {
    if (pendingEnemyDamageUpdates.size === 0) return;

    const damagedEnemies: Array<{ enemyId: string, health: number, p?: 1 }> = [];
    pendingEnemyDamageUpdates.forEach((pending, enemyId) => {
        // `p` is omitted for ordinary damage so the common case stays two
        // fields on the wire.
        damagedEnemies.push(pending.poisonOnly
            ? { enemyId, health: pending.health, p: 1 }
            : { enemyId, health: pending.health });
    });
    pendingEnemyDamageUpdates.clear();
    io.emit('enemiesDamaged', damagedEnemies);
}

/** Emit items that spawned this tick, batched into one event per recipient. */
function flushItemSpawnBatch(): void {
    const itemsByPlayer = new Map<string, WorldItem[]>();

    for (const item of items) {
        if (!(item as any).pendingSpawnEmission || !(item as any).eligibleSocketIds) continue;
        for (const socketId of (item as any).eligibleSocketIds as string[]) {
            let list = itemsByPlayer.get(socketId);
            if (!list) { list = []; itemsByPlayer.set(socketId, list); }
            list.push(item);
        }
        delete (item as any).pendingSpawnEmission;
        delete (item as any).eligibleSocketIds;
    }

    for (const [socketId, itemsToSend] of itemsByPlayer) {
        if (itemsToSend.length > 0) {
            io.to(socketId).emit('itemsSpawned', itemsToSend);
        }
    }
}

/** Drop `items[index]`, clearing its expiry timer and telling eligible clients. */
function removeWorldItem(index: number, item: WorldItem): void {
    const timeout = itemExpirationTimeouts.get(item.id);
    if (timeout) {
        clearTimeout(timeout);
        itemExpirationTimeouts.delete(item.id);
    }
    if (item.eligiblePlayers) {
        for (const playerId of item.eligiblePlayers) {
            io.to(playerId).emit('itemRemoved', item.id);
        }
    }
    items.splice(index, 1);
}

/**
 * Per-tick world-item maintenance: push items out of walls, then drop the ones
 * that left the world or outlived their rarity's expiration time.
 */
function updateWorldItems(): void {
    for (const item of items) {
        checkItemWallCollisions(item);
    }

    // The PVP arena and the maze live well outside the regular world rectangle,
    // so items inside them are exempt from the bounds check.
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const outOfBounds = item.x < 0 || item.x >= ACTUAL_WORLD_WIDTH || item.y < 0 || item.y >= ACTUAL_WORLD_HEIGHT;
        if (outOfBounds && !isInPvpArena(item.x, item.y) && !isInMazeRegion(item.x, item.y)) {
            removeWorldItem(i, item);
        }
    }

    const currentTime = Date.now();
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (!item.spawnTime || !item.rarity) continue;
        const expirationTime = ITEM_EXPIRATION_TIMES[item.rarity] || 10000;
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
function evictStalePetalTimers(): void {
    for (const map of [petalLastProjectileTime, petalLastRadiationTime]) {
        if (map.size <= 1000) continue;
        let toRemove = map.size - 1000;
        for (const key of map.keys()) {
            if (toRemove-- <= 0) break;
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
    const authenticatedPlayerIds: string[] = [];
    const authenticatedSockets: AuthenticatedSocket[] = [];

    setInterval(() => {
        tickCounter++;
        // Smoothed real elapsed time since the previous tick (seconds). Computed
        // before the no-players early-return so it stays one tick wide across idle.
        const nowMs = performance.now();
        let rawDelta = lastTickMs > 0 ? (nowMs - lastTickMs) / 1000 : NOMINAL_DELTA;
        lastTickMs = nowMs;
        if (rawDelta > MAX_DELTA) rawDelta = MAX_DELTA;
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
            } else {
                runSimTick = false;
            }
        } else {
            simTickAccumulatorSec = 0;
        }

        authenticatedPlayerIds.length = 0;
        authenticatedSockets.length = 0;
        for (const id in players) {
            const socket = io.sockets.sockets.get(id) as AuthenticatedSocket | undefined;
            if (socket && socket.userId) {
                authenticatedPlayerIds.push(id);
                authenticatedSockets.push(socket);
            }
        }

        // Keep bot population aligned with real player count. Despawns all bots
        // when nobody is online so the server goes fully idle.
        maintainBotCount(io, authenticatedPlayerIds.length);

        // Skip game processing if there are no authenticated players
        if (authenticatedPlayerIds.length === 0) {
            return;
        }

        // Build a spatial grid of enemies once per tick. Player/petal collision
        // loops in updatePlayerState query this instead of scanning all enemies.
        // Must run BEFORE updateBotAI: bot targeting queries this grid.
        rebuildEnemyGrid(enemies);

        // Populate bot inputs before running the normal update pipeline so
        // bots move/attack just like real players.
        updateBotAI(io);

        if (runSimTick) runSimulationStep(deltaTime, deltaMs, mobCatchupCalls);

        // Update ground pollen drops (damage zones from broken pollen petals)
        updateGroundPollens();

        // Update web fields (slow zones from thrown web petals)
        updateWebFields();

        // Update viewport status for all enemies. Strided: this pass exists to
        // feed a 30-second despawn timer, so a ~166 ms cadence is equivalent —
        // no need to box-test all ~1400 enemies every tick.
        if (tickCounter % 5 === 0) updateEnemyViewportStatus();

        // Spawn wave mobs from damaged spawners (e.g. ant holes) before emitting damage batch
        spawnWaveMobs();

        flushEnemyDamageBatch();

        flushItemSpawnBatch();

        // Despawn enemies that have been outside viewport for too long.
        // Strided like updateEnemyViewportStatus (offset so the two 1400-enemy
        // passes never land on the same tick): the despawn threshold is 30 s.
        if (tickCounter % 5 === 2) despawnDistantEnemies();

        updateWorldItems();

        evictStalePetalTimers();

        // Encode and send this tick's gameStateUpdate to every client.
        broadcastGameState(authenticatedPlayerIds, authenticatedSockets, buildPlayerSnapshots());

        // Record how long this tick's work actually took (idle early-return
        // ticks never reach here, so they don't dilute the average).
        const tickDurMs = performance.now() - nowMs;
        debugTickAccumMs += tickDurMs;
        debugTickSamples++;
        if (tickDurMs > debugTickMaxMs) debugTickMaxMs = tickDurMs;
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
    console.log(`Server is running on ${SERVER_PROTOCOL}://localhost:${PORT}`);

    // Debug: verify WALL_GRID is loaded
    let nonZeroTiles = 0;
    for (let y = 0; y < WALL_GRID.length; y++) {
        for (let x = 0; x < WALL_GRID[y].length; x++) {
            if (WALL_GRID[y][x] !== 0) nonZeroTiles++;
        }
    }
    console.log(`[SERVER] WALL_GRID loaded: ${WALL_GRID.length}x${WALL_GRID[0]?.length || 0}, non-zero tiles: ${nonZeroTiles}`);
});

start_loop();

// Scheduled restart system: warns connected players before exiting so pm2 restarts the process.
const RESTART_WARNINGS_MS = [10 * 60 * 1000, 5 * 60 * 1000, 60 * 1000, 10 * 1000];
let scheduledRestartInProgress = false;
let scheduledRestartTimers: NodeJS.Timeout[] = [];
let scheduledRestartTargetMs: number | null = null;
let scheduledRestartReason: string = '';
const broadcastSystemMessage = (content: string) => {
    try {
        for (const s of io.sockets.sockets.values()) {
            try {
                s.emit('chatMessage', { sender: 'System', content, timestamp: Date.now() });
            } catch {}
        }
    } catch (e) {
        console.error('[RESTART] Error broadcasting system message', e);
    }
};
const formatRestartWarning = (ms: number, reason: string): string => {
    const reasonText = reason === 'daily' ? 'daily maintenance' : reason;
    if (ms >= 60000) {
        const m = Math.round(ms / 60000);
        return `<span style="color:#ffb74d;">⚠ Server will restart in ${m} minute${m === 1 ? '' : 's'} (${reasonText}).</span>`;
    }
    const s = Math.round(ms / 1000);
    return `<span style="color:#ff6b6b;">⚠ Server restarting in ${s} second${s === 1 ? '' : 's'}!</span>`;
};

/** Schedule a server restart in `delayMs` milliseconds. Replaces any existing scheduled restart. */
export function scheduleRestart(delayMs: number, reason: string = 'admin'): boolean {
    if (scheduledRestartInProgress) return false;
    if (delayMs < 0) delayMs = 0;

    for (const t of scheduledRestartTimers) clearTimeout(t);
    scheduledRestartTimers = [];
    scheduledRestartTargetMs = Date.now() + delayMs;
    scheduledRestartReason = reason;
    console.log(`[RESTART] Scheduled restart in ${delayMs}ms (reason: ${reason})`);

    for (const warnMs of RESTART_WARNINGS_MS) {
        if (warnMs >= delayMs) continue;
        scheduledRestartTimers.push(setTimeout(() => {
            if (scheduledRestartInProgress) return;
            broadcastSystemMessage(formatRestartWarning(warnMs, reason));
        }, delayMs - warnMs));
    }

    scheduledRestartTimers.push(setTimeout(() => {
        scheduledRestartInProgress = true;
        console.warn(`[RESTART] Scheduled restart triggered (reason: ${reason})`);
        broadcastSystemMessage(`<span style="color:#ff6b6b;">Server restarting now (${reason === 'daily' ? 'daily maintenance' : reason}). Reconnecting shortly...</span>`);
        try {
            for (const s of io.sockets.sockets.values()) {
                try { s.emit('serverRestarting', { reason }); } catch {}
            }
        } catch {}
        setTimeout(() => {
            console.warn('[RESTART] Exiting process for restart');
            process.exit(0);
        }, 1000);
    }, delayMs));
    return true;
}

/** Cancel a pending scheduled restart. */
export function cancelScheduledRestart(): boolean {
    if (scheduledRestartInProgress) return false;
    if (scheduledRestartTimers.length === 0) return false;
    for (const t of scheduledRestartTimers) clearTimeout(t);
    scheduledRestartTimers = [];
    scheduledRestartTargetMs = null;
    scheduledRestartReason = '';
    return true;
}

/** Info about the pending restart, or null if none scheduled. */
export function getScheduledRestartInfo(): { remainingMs: number; reason: string } | null {
    if (scheduledRestartTargetMs === null) return null;
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
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    const heapUsedPct = mem.heapUsed / heapLimit;
    const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
    const heapUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const heapLimitMB = (heapLimit / 1024 / 1024).toFixed(1);
    const playerCount = Object.keys(players).length;
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
                } catch {}
            }
        } catch (e) {
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
    const playerCount = Object.keys(players).length;
    if (playerCount > 0) {
        // Calculate target enemy count based on current viewport density
        const viewports = getPlayerViewports();
        const totalViewportArea = viewports.reduce((total, viewport) => {
            const extendedViewport = {
                x: viewport.x - VIEWPORT_BUFFER,
                y: viewport.y - VIEWPORT_BUFFER,
                width: viewport.width + (VIEWPORT_BUFFER * 2),
                height: viewport.height + (VIEWPORT_BUFFER * 2)
            };
            return total + (extendedViewport.width * extendedViewport.height);
        }, 0);
        
        const targetDensity = ORIGINAL_ENEMY_COUNT / TOTAL_WORLD_AREA;
        const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
        const currentViewportEnemies = getEnemiesInViewportCount();
        
        // Keep the PVP arena populated with garden mobs + spiders.
        const arenaMobs = spawnArenaMobs(3);
        for (const mob of arenaMobs) {
            enemies.push(mob);
        }

        // Keep the maze corridors populated (tier by depth zone) and its
        // ultra bosses alive in the deepest rooms. 40 per half-second fills a
        // fresh maze (~1300-mob target at full world density) in ~17s; at
        // steady state the target cap throttles this down to a
        // kill-replacement trickle.
        const mazeMobs = spawnMazeMobs(40);
        for (const mob of mazeMobs) {
            enemies.push(mob);
        }
        const mazeBosses = spawnMazeBosses();
        for (const boss of mazeBosses) {
            enemies.push(boss);
        }

        if (currentViewportEnemies < targetEnemyCount) {
            // Scale spawn cap with player count so each player's viewport fills at the same rate
            const enemiesToSpawn = Math.min(3 * playerCount, targetEnemyCount - currentViewportEnemies);
            let spawned = 0;

            for (let i = 0; i < enemiesToSpawn; i++) {
                const newEnemy = createEnemy();
                if (newEnemy) {
                    enemies.push(newEnemy);
                    spawned++;
                }
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
    updateSpawnZones(enemySpawnerHelpers);
}, 1000); // 1 second

// Add special mob spawning timer (every 1 minute)
setInterval(() => {
    const playerCount = Object.keys(players).length;
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
export function rotateMazeToDay(day: number): void {
    const removedIds = clearMazeEnemies();
    for (const id of removedIds) {
        io.emit('enemyDestroyed', id);
    }

    const maze = setActiveMazeDay(day);
    invalidateMazeMobPool();
    io.emit('mazeInfo', { day: maze.dayNumber, biome: maze.biome });
    console.log(`[MAZE] Rotated to day ${maze.dayNumber} (${maze.biome})`);

    for (const pid in players) {
        const p = players[pid];
        if (!p?.inMaze) continue;
        const spawn = getMazeSpawnPosition();
        p.x = spawn.x;
        p.y = spawn.y;
        // `players` includes splitter halves, which own no socket of their own.
        io.to(getOriginalSocketId(pid)).emit('playerTeleported', { newX: spawn.x, newY: spawn.y, playerId: pid });
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
export function adminChangeMaze(arg?: string): string {
    const active = getActiveMaze();
    const currentDay = active ? active.dayNumber : getCurrentMazeDay();
    const token = (arg || '').trim().toLowerCase();

    let targetDay: number;
    if (token === '' || token === 'next') {
        targetDay = currentDay + 1;
    } else if ((MAZE_BIOMES as readonly string[]).includes(token)) {
        const wantIndex = (MAZE_BIOMES as readonly string[]).indexOf(token);
        const currentIndex = ((currentDay % 3) + 3) % 3; // same formula generateMaze uses
        const advance = ((wantIndex - currentIndex) + 3) % 3;
        if (advance === 0) {
            // Layouts are fixed per biome — re-requesting the active biome
            // would rebuild the identical maze.
            return `Maze is already ${token}.`;
        }
        targetDay = currentDay + advance;
    } else if (/^-?\d+$/.test(token)) {
        targetDay = parseInt(token, 10);
    } else {
        return `Usage: change-maze [next|garden|desert|ocean|<dayNumber>] — current: day ${currentDay} (${active?.biome ?? 'none'})`;
    }

    if (active && targetDay === active.dayNumber) {
        return `Maze is already day ${targetDay} (${active.biome}).`;
    }

    mazeDayOffset = targetDay - getCurrentMazeDay();
    rotateMazeToDay(targetDay);
    const maze = getActiveMaze();
    return `Maze changed to day ${maze!.dayNumber} (${maze!.biome}). Offset from real day: ${mazeDayOffset >= 0 ? '+' : ''}${mazeDayOffset}.`;
}

// Daily maze rotation: at each UTC day boundary the maze gets a new layout
// and the biome cycles garden → desert → ocean (plus any admin offset from
// the change-maze command).
setInterval(() => {
    const day = getCurrentMazeDay() + mazeDayOffset;
    const currentMaze = getActiveMaze();
    if (currentMaze && currentMaze.dayNumber === day) return;
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
    Object.entries(players).forEach(([socketId, player]) => {
        const socket = io.sockets.sockets.get(socketId) as AuthenticatedSocket;
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
