import { Server } from './ws_server';
import { mobAngle, mobStatsOf, mobTargetPlayerId, mobX, mobY, setMobCurrentDPS } from './server/mobFields';
import { bindWireOutbox, getWireOutbox } from './server/wireOutbox';
import { emitPlayerDamaged } from './server/playerWire';
import { registerWireOutboxSystem } from './ecs/net/outbox';
import { emitEnemySpawned } from './server/enemyWire';
import { createApp, UApp, staticFiles, jsonParser } from './server/uws_app';
import { startWebTransportServer, getWebTransportAdvertisement } from './server/webtransport_server';
import { resolveTlsPaths } from './server/devCert';
import path from 'path';
import v8 from 'v8';
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
import { wireEventsSignature } from './wire_events';
import { wireFieldsSignature } from './wire_fields';
import { getDamageMultiplier, updatePetalBehaviours, despawnAllPlayerPets, despawnPetAndReloadEgg } from './petal_actions';
import { ENEMY_TIERS, ENEMY_SIZE, PLAYER_SIZE, players, obstacles, ACTUAL_WORLD_HEIGHT, ACTUAL_WORLD_WIDTH, VIEWPORT_BUFFER, ENEMIES_PER_VIEWPORT, ORIGINAL_ENEMY_DENSITY, ORIGINAL_ENEMY_COUNT, VIEWPORT_WITH_BUFFER_AREA, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, TOTAL_WORLD_AREA, getServerConfigByPort, isInPvpArena } from './constants';
import { WALL_GRID } from './map_data';
import { Enemy, LiveEnemy, isCentipedeHeadType, isGlitchInfectingType } from './server_utils';
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
    markEnemyDamagedById,
} from './server/utils';
import {
    loadGuildsFromDatabase,
} from './server/guildManager';
// (checkItemWallCollisions is no longer imported here: the droppedItems ECS
// system resolves item-wall overlap through the runtime's injected resolver.)
import { createEcsRuntime, EcsRuntime } from './server/ecsRuntime';
import {
    configureCutover,
    ensurePlayerEntity,
    openPetalRing,
    syncPlayersFromEcs,
    syncPlayersToEcs,
    syncToEcs,
} from './server/ecsSync';
import { Entity } from './ecs';
import {
    diffRemoved,
    encodeProjectilesInBox,
    ProjectileWire,
} from './ecs/net/projectileEncoder';
import {
    bindBroadcastWorld,
    buildPlayerSnapshots,
    broadcastGameState,
} from './server/tickBroadcast';
import { AuthenticatedSocket } from './server/shared/socketTypes';
import { registerConnectionHandlers } from './server/connection';
import {
    updatePlayerPreMovement,
    updatePlayerState,
    getPlayerViewports,
    isPositionInPlayerPetalRange,
    validatePlayerPositions,
    isPositionNearAnyPlayer,
    getEnemiesInViewportCount,
    PlayerStateDependencies,
    trySecondChance,
} from './server/playerState';
import {
    CommandHandlerDependencies
} from './server/commands';
import {
    superMobCount,
    ENEMY_COUNT,
    playerUserIds,
    petalLastProjectileTime,
    petalLastRadiationTime,
    knownMobProjectilesByPlayer,
    knownPlayerProjectilesByPlayer,
    allocateMobProjectileId,
    allocatePlayerProjectileId,
} from './server/gameState';
import { spawnGroundPollen, spawnWebField } from './ecs/prefabs';
import * as EC from './ecs/components';
import { handleMobDrops as handleMobDropsModule } from './server/itemManager';
import { registerBotInputSystem, maintainBotCount, initializeBotGuilds } from './server/botManager';
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
import { rebuildEnemyGrid } from './server/enemyGrid';
import { drainRemovedEnemies, spawnEnemy, removeEnemy, collectEnemies, liveEnemies, isEnemyLive } from './server/enemyRegistry';

/** Snapshot buffer: the bulk-clear loop removes while iterating. */
const mobScratch: LiveEnemy[] = [];
import { bindEntityHost } from './server/entityRegistry';
import { isInOutOfBoundsZone, clampToWorld, isWallAt, samplePointInViewport } from './server/shared/positions';
import { awardKillXp, killEnemy } from './server/shared/killHandler';
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
/** The TLS material the server is actually serving with, or null on plain HTTP. */
let tlsPaths: { keyPath: string; certPath: string } | null = null;
{
    const certDir = path.resolve(__dirname, '..');
    // resolveTlsPaths regenerates the committed localhost certificate once it
    // expires, so `npm start` on a dev box never serves a dead one. A real
    // certificate for a real hostname is always left exactly as it is.
    tlsPaths = USE_HTTPS
        ? resolveTlsPaths(
            { certPath: path.join(certDir, 'cert.crt'), keyPath: path.join(certDir, 'cert.key') },
            { certPath: path.join(certDir, 'dev-cert.crt'), keyPath: path.join(certDir, 'dev-cert.key') },
        )
        : null;
    if (tlsPaths) {
        app = createApp({ ssl: tlsPaths });
        console.log(`[SERVER] Using HTTPS protocol (${path.basename(tlsPaths.certPath)})`);
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
        x: mobX(enemy.entity),
        y: mobY(enemy.entity),
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
    
    const targetDummies = liveEnemies().filter(e => e.type === 'target_dummy');
    
    for (const dummy of targetDummies) {
        const dps = calculateDPS(dummy);
        setMobCurrentDPS(dummy.entity, dps);

        // Send DPS update to all clients
        getWireOutbox().all('targetDummyDPS', {
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
Server.protocolSignature = `${getInventoryCodecSignature()}.${wireEventsSignature()}.${wireFieldsSignature()}`;
console.log(`[SERVER] Inventory codec signature: ${Server.protocolSignature}`);

const io = new Server(app);

// Set ioInstance for use in modules
ioInstance = io;

// Every gameplay event leaves through the ECS outbox (drained in
// Phase.Networking, see registerWireOutboxSystem below). Bound here, at the
// first moment `io` exists, rather than beside the other bindings further down:
// module-scope initialisation between the two points can already raise world
// events, and an unbound outbox throws rather than silently swallowing them.
bindWireOutbox(io);

// Get current server port and configuration
const PORT = process.env.PORT || 3000;
const CURRENT_SERVER_PORT = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
const CURRENT_SERVER_CONFIG = getServerConfigByPort(CURRENT_SERVER_PORT) || { port: CURRENT_SERVER_PORT, host: 'localhost', name: `Server${CURRENT_SERVER_PORT}` };

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
const webTransportReady: Promise<unknown> = (WT_CERT_PATH && WT_KEY_PATH)
    ? startWebTransportServer(io, {
        port: WT_PORT,
        certPath: path.resolve(WT_CERT_PATH),
        keyPath: path.resolve(WT_KEY_PATH),
        host: process.env.WT_HOST,
    }).catch(e => { console.warn('[WT] Startup failed:', e); return null; })
    : Promise.resolve(null);
if (!WT_CERT_PATH) console.log('[SERVER] No TLS certificate — WebTransport disabled, WebSocket only');

/**
 * Transport capability probe. The client hits this before connecting and picks
 * WebTransport only if this says the server has it (see net/transport.ts);
 * anything else — a 404 from an older server, a timeout — means WebSocket.
 * Deliberately unauthenticated: it exposes nothing a connection attempt would
 * not, and it has to work before a session exists.
 */
app.get('/transport-info', async (_req, res) => {
    await webTransportReady;
    const advertisement = getWebTransportAdvertisement();
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

// updateEnemyViewportStatus / despawnDistantEnemies are gone: viewport
// tracking and distance-despawn are ECS-owned now (ecs/systems/viewport.ts
// refreshes ViewportTracked; the unseenDespawn sweep in ecs/systems/lifetime.ts
// removes 30s-unseen mobs through the onMobDespawn hook, with the same
// boss/target-dummy/occupied-maze exemptions). Both run strided on the mob
// scheduler, exactly as the legacy passes were.

function calculateCurrentDensity() {
    const playerCount = Object.keys(players).length;
    const totalEnemies = liveEnemies().length;
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

    // No forced viewport/despawn pass here any more: both are strided ECS
    // systems (~6Hz), so they run within 166ms of this call anyway — and the
    // despawn timer is 30 seconds, so "immediately" and "next stride" are the
    // same outcome.

    // Log current enemy distribution and density analysis
    const densityInfo = calculateCurrentDensity();
    if (densityInfo) {
        console.log(`[SERVER] Viewport update: ${densityInfo.enemiesInViewport}/${densityInfo.totalEnemies} enemies in viewport`);
    }
    
    // Try to spawn new enemies if we're below the target count
    const reading = measureViewportDensity();
    const spawned = spawnToViewportDensity(reading, 5);
    if (spawned > 0) {
        console.log(`[SERVER] Player join spawn: ${spawned} enemies (target: ${reading.targetEnemyCount}, current: ${reading.currentViewportEnemies})`);
    }
}

/** How far the players' combined viewport is below its target mob density. */
interface ViewportDensityReading {
    playerCount: number;
    targetEnemyCount: number;
    currentViewportEnemies: number;
}

/**
 * Measures the current open-world mob density against its target.
 *
 * Kept separate from the spawn step because the density-maintenance tick takes
 * its reading BEFORE the arena and maze spawners run, and then spawns against
 * that pre-arena reading — folding the two together would silently let arena
 * and maze mobs count towards the open-world target.
 */
function measureViewportDensity(): ViewportDensityReading {
    const playerCount = Object.keys(players).length;
    if (playerCount === 0) {
        return { playerCount, targetEnemyCount: 0, currentViewportEnemies: 0 };
    }

    // Target count follows the current viewport density, buffered on each side.
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
    return {
        playerCount,
        targetEnemyCount: Math.ceil(targetDensity * totalViewportArea),
        currentViewportEnemies: getEnemiesInViewportCount(),
    };
}

/**
 * Spawns open-world mobs towards `reading`'s target, capped at
 * `perPlayerCap` per connected player so each player's viewport fills at the
 * same rate. Returns how many mobs were admitted.
 *
 * The join burst and the maintenance tick carried their own copy of this and
 * had drifted apart on that cap, which is why it is an explicit argument.
 */
function spawnToViewportDensity(reading: ViewportDensityReading, perPlayerCap: number): number {
    const { playerCount, targetEnemyCount, currentViewportEnemies } = reading;
    if (playerCount === 0 || currentViewportEnemies >= targetEnemyCount) return 0;

    const enemiesToSpawn = Math.min(perPlayerCap * playerCount, targetEnemyCount - currentViewportEnemies);
    let spawned = 0;
    for (let i = 0; i < enemiesToSpawn; i++) {
        // createEnemy admits the mob itself (entity + liveEnemies()[]).
        if (createEnemy()) spawned++;
    }
    return spawned;
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
    for (const enemy of collectEnemies(mobScratch)) {
        if (enemy.ownerId) continue; // keep player pets
        cleanupEnemy(enemy);
        removeEnemy(enemy);
        getWireOutbox().all('enemyDestroyed', enemy.id);
        removed++;
    }
    // Special-mob counters (ultra/super/unique, section tracking) are derived from
    // the enemies array, so refresh them after the bulk removal.
    updateSpecialMobCounts();
    return removed;
}

// Wrapper for createEnemy. The mob is already in `enemies` and already has an
// entity by the time this returns — see server/enemyRegistry.ts.
function createEnemy(): LiveEnemy | null {
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

// /spawn admits mobs directly via spawnEnemy(), bypassing spawnSpecialMobs()/
// announceAmbientSuper() entirely, so boss-tier mobs it creates never fired the
// chat banner or the boss-event log. This mirrors that announcement for any
// tier normally treated as a boss (super, unique, apex), regardless of spawn origin.
function announceBossSpawn(bossMob: Enemy, tier: 'super' | 'unique' | 'apex'): void {
    const mobSection = getSectionAtPosition(mobX(bossMob.entity), mobY(bossMob.entity));
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
        x: mobX(bossMob.entity),
        y: mobY(bossMob.entity),
        timestamp: spawnTimestamp,
        message: stripHtml(message)
    });
}

function announceAmbientSuper(superMob: Enemy): void {
    superMobCount.value++;
    const mobSection = getSectionAtPosition(mobX(superMob.entity), mobY(superMob.entity));
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
        x: mobX(superMob.entity),
        y: mobY(superMob.entity),
        timestamp: spawnTimestamp,
        message: stripHtml(message)
    });
    console.log(`[SERVER] Ambient super mob spawned: ${superMob.type} at (${mobX(superMob.entity)}, ${mobY(superMob.entity)})`);
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

        // Admits the mob. The child spawners below RETURN what they admitted —
        // they used to be read back off the tail of `liveEnemies()[]`, which only
        // worked while that array was a creation-ordered container.
        const enemy = spawnEnemy(mobType, tier, ex, ey);
        if (!enemy) continue;

        // DPS tracking buffers are allocated lazily on first damage event in trackDamage().

        // Notify all clients
        emitEnemySpawned(enemy);

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
            for (const segment of spawnCentipedeBodySegments(enemy)) {
                emitEnemySpawned(segment);
            }
        }

        // Mobs with initial_spawns (e.g. ant holes) arrive with a pre-spawned cluster.
        if (mobStats.initial_spawns && mobStats.initial_spawns.length > 0) {
            for (const child of spawnInitialSpawns(enemy)) {
                emitEnemySpawned(child);
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
    getWireOutbox().toSocket(player.id, 'xpGained', {
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
        getWireOutbox().toSocket(player.id, 'outsideXpGained', {
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
    
    // Remove excess enemies if current count is higher than target.
    // This used to `enemies.pop()`, which dropped the shell and LEFT THE ENTITY
    // BEHIND for the audit to find — an immortal, invisible mob until then.
    // Going through removeEnemy retires both, because there is only one now.
    while (liveEnemies().length > targetEnemyCount) {
        const view = liveEnemies();
        const removedEnemy = view[view.length - 1];
        if (!removedEnemy) break;
        removeEnemy(removedEnemy);
        getWireOutbox().all('enemyDestroyed', removedEnemy.id);
    }

    // Add new enemies if current count is lower than target. createEnemy admits
    // the mob itself, so the loop is bounded by it returning null (no valid
    // position) rather than by a push here.
    while (liveEnemies().length < targetEnemyCount) {
        if (!createEnemy()) break;
    }

    // Don't send enemiesUpdate here - enemies are sent via enemySpawned/enemyDestroyed events
    console.log(`[SERVER] Adjusted enemy count to ${liveEnemies().length}/${targetEnemyCount} (${playerCount} players)`);
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
    },
    // Same lazy-on-purpose reason as `projectiles` above: this bag is built at
    // module scope, and the ECS world it needs does not exist until first tick.
    petalRing: {
        open: (player, slotCount, rotationSpeedModifier, deltaTime, now) => openPetalRing(
            getEcsRuntime().world, player, now, slotCount, rotationSpeedModifier, deltaTime,
        ),
    },
    // Ground pollen and web fields live in the ECS; breaking petals spawn them
    // through here. `ensurePlayerEntity` rather than a bare lookup: a flower can
    // break a petal on its very first tick, before syncToEcs has imported it.
    groundEffects: {
        spawnPollen: (spec) => {
            const player = players[spec.playerId];
            if (!player) return;
            const world = getEcsRuntime().world;
            spawnGroundPollen(world, {
                id: spec.id,
                x: spec.x,
                y: spec.y,
                owner: ensurePlayerEntity(world, player, Date.now()),
                damage: spec.damage,
                radius: spec.radius,
                rarity: spec.rarity,
                expiresAt: spec.expiresAt,
            });
        },
        spawnWeb: (spec) => {
            const player = players[spec.playerId];
            if (!player) return;
            const world = getEcsRuntime().world;
            spawnWebField(world, {
                id: spec.id,
                x: spec.x,
                y: spec.y,
                owner: ensurePlayerEntity(world, player, Date.now()),
                radius: spec.radius,
                rarity: spec.rarity,
                expiresAt: spec.expiresAt,
            });
        },
    },
    // Mob slows are ECS-owned; sticky petals apply theirs through the runtime,
    // which runs the rarity contest and writes the Speed/Slowed pair.
    slows: {
        apply: (enemyId, baseFactor, until, sourceRarity) => {
            const runtime = getEcsRuntime();
            const victim = runtime.world.lookup(enemyId);
            if (victim === undefined) return;
            runtime.slowEnemy(victim, baseFactor, until, sourceRarity, Date.now());
        },
    },
    // Mob poison is ECS-owned; poisonous petals apply their stacks through the
    // runtime (one per mob+player, gardn's outlast rule).
    poisons: {
        apply: (enemyId, playerId, damagePerMs, endTime) => {
            const runtime = getEcsRuntime();
            const victim = runtime.world.lookup(enemyId);
            const player = players[playerId];
            if (victim === undefined || !player) return;
            const source = ensurePlayerEntity(runtime.world, player, Date.now());
            runtime.poisonEnemy(victim, source, damagePerMs, endTime);
        },
    },
};

// There is no playerSyncDeps any more: the playerModifiers system derives the
// speed/size/magnetism/aggro values from the Loadout component, the mirrored
// effect list and the mirrored speed_boost base — syncPlayersToEcs pushes only
// inputs legacy still writes.

// Kill-handler context for the consolidated death sequence (see shared/killHandler).
// Mirrors the kill-related subset of playerStateDeps; built once at boot.
const killCtx: KillContext = {
    io,
    players,
    playerUserIds,
    database,
    removeEnemy,
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


// updateSlowEffects is gone: slows are ECS-owned end to end. Application goes
// through EcsRuntime.slowEnemy (petal contacts, web fields), and the ECS
// slowExpiry system — registered in Phase.Input so a lapsed slow is restored
// BEFORE the AI and movement read speed, exactly where this function ran —
// restores Speed.current from Speed.base when the timer lapses.

// updatePlayerPoison is gone: the ECS playerPoison system (Phase.Combat on the
// mob scheduler) visits exactly the poisoned flowers — the Poisoned component
// is mirrored from the shell in syncToEcs — and runs the legacy per-tick body
// through the tickPlayerPoison / onPlayerPoisonLapsed hooks above.

// updatePeriodicSpawns is gone: its two halves are ECS systems. The timed
// despawn of escorts is `mobExpiry` (ecs/systems/lifetime.ts, through the
// onMobDespawn hook), and the interval summon is `periodicSpawns`
// (ecs/systems/spawning.ts, through the onSpawnEscort hook above).

/**
 * A mob just died to poison: the death sequence the poison pass has always
 * run, now invoked from the ECS poisonStacks system's kill hook. Differs from
 * killEnemy in three ways it always has: XP goes to the TOP CONTRIBUTOR (there
 * is no single "killer" for a bleed), the kill emits `enemyDestroyed` itself,
 * and a replacement mob is spawned immediately.
 */
function handlePoisonDeath(enemy: Enemy): void {
    if ((enemy as any).isDead) return;
    (enemy as any).isDead = true;

    const index = liveEnemies().findIndex(e => e.id === enemy.id);
    if (index === -1) return;

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

    const { dropMultiplier } = topContributor
        ? getLeaderboardRewardMultipliers(topContributor)
        : { dropMultiplier: 1 };

    // XP goes to every player who earned loot rights, each at the mob's FULL
    // value — same rule as every other death path. The top contributor still
    // decides the DROP multiplier, since that is one roll for the whole mob.
    awardKillXp(enemy, killCtx);

    // Track mob kill for eligible players (use debounced save to prevent lag)
    trackMobKill(enemy, players, playerUserIds, database, io, savePlayerProgress);
    handleMobDrops(enemy, dropMultiplier);
    sendBossMobDefeatedMessage(enemy, io, players);
    // Clean up enemy data structures before removal to prevent memory leaks
    cleanupEnemy(enemy);
    removeEnemy(enemy);
    updateSpecialMobCounts();
    getWireOutbox().all('enemyDestroyed', enemy.id);

    // Try to spawn a new enemy (admits itself)
    createEnemy();
}


// spawnWaveMobs is gone: the health-threshold bookkeeping is the ECS
// `spawnWaves` system (ecs/systems/spawning.ts, on SpawnWaveState), and the
// actual wave contents spawn through the onSpawnWaves hook above. The overkill
// clamp that fixed the 100% CPU hang lives in the system.


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

    syncToEcs(runtime.world, players, now);
    // deltaTime is nominal here on purpose: the ported mob step is a FIXED
    // per-call step, exactly as the legacy one was, and moveEnemies is called
    // mobCatchupCalls times rather than being handed a larger dt.
    //
    // Reaping happens inside this tick now — the reaper system is the last
    // thing in the Lifetime phase, driving the onReapEnemy hook (XP, drops and
    // the database stay behind that hook, unported).
    runtime.tick(1 / 30, 1000 / 30, now);
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
        // The post-movement player pipeline. Iterates `players` in the same
        // order the bare loop did, because that order decides who lands the
        // killing blow when two players hit one mob on the same tick — see
        // EcsRuntimeOptions.runPlayerPipeline.
        runPlayerPipeline: (deltaTime) => {
            for (const id in players) {
                updatePlayerState(players[id], deltaTime, playerStateDeps);
            }
        },
        runPetalBehaviours: () => updatePetalBehaviours(),
        // Pet kills are credited to the owning PLAYER, matching trackDamage.
        creditDamage: (victim, ownerPlayer, amount) => {
            const world = _ecsRuntime!.world;
            const victimId = world.externalIdOf(victim);
            const ownerId = world.externalIdOf(ownerPlayer);
            if (!victimId || !ownerId) return;
            const enemy = liveEnemies().find(e => e.id === victimId);
            if (enemy) trackDamage(enemy, ownerId, amount);
        },
        onEnemyDamaged: (victim) => {
            const world = _ecsRuntime!.world;
            const victimId = world.externalIdOf(victim);
            if (!victimId) return;
            const enemy = liveEnemies().find(e => e.id === victimId);
            if (enemy) markEnemyDamaged(enemy);
        },
        // Death is left to reapDeadEnemies: syncFromEcs zeroes the legacy
        // health, and the existing reaper awards XP and drops from there.
        onEnemyKilled: () => { /* handled by reapDeadEnemies */ },
        onPetOutOfView: (pet) => {
            const world = _ecsRuntime!.world;
            if (!world.has(pet, EC.LegacyShell)) return;
            const enemy = world.get(pet, EC.LegacyShell, 'ref') as Enemy | undefined;
            if (enemy) despawnPetAndReloadEgg(enemy, io);
        },
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
            // Batched into the tick's single `enemiesDamaged`, not broadcast per
            // hit. Per-hit this was one full fan-out to EVERY socket for every
            // projectile that connected — measured on prod at 8,912 msg/s and
            // 391 KB/s, the third-largest event on the wire.
            if (enemyId) markEnemyDamagedById(enemyId, health);
        },
        onProjectileKill: (victim, killer, timing) => {
            const world = _ecsRuntime!.world;
            const victimId = world.externalIdOf(victim);
            if (!victimId) return;
            const index = liveEnemies().findIndex(e => e.id === victimId);
            if (index < 0) return;
            killEnemy(liveEnemies()[index], killCtx, {
                killerPlayerId: world.externalIdOf(killer),
                trackMobKillTiming: timing,
            });
        },
        onGroundEffectExpired: (kind, id) => {
            getWireOutbox().all(kind === 'pollen' ? 'groundPollenRemoved' : 'webRemoved', id);
        },
        // The PVP arena and the maze live well outside the regular world
        // rectangle, so items inside them are exempt from the bounds check.
        isItemOutOfBounds: (x, y) => {
            const outOfBounds = x < 0 || x >= ACTUAL_WORLD_WIDTH || y < 0 || y >= ACTUAL_WORLD_HEIGHT;
            return outOfBounds && !isInPvpArena(x, y) && !isInMazeRegion(x, y);
        },
        onWorldItemRemoved: (victim) => {
            const world = _ecsRuntime!.world;
            const item = world.get(victim, EC.DroppedItem, 'payload') as WorldItem | undefined;
            if (!item?.eligiblePlayers) return;
            // Split halves are addressed by their original socket, the same
            // mapping every other item event uses.
            for (const playerId of item.eligiblePlayers) {
                getWireOutbox().toPlayer(playerId, 'itemRemoved', item.id);
            }
        },
        onEnemyPoisonDamaged: (victim) => {
            const world = _ecsRuntime!.world;
            if (!world.has(victim, EC.LegacyShell)) return;
            const enemy = world.get(victim, EC.LegacyShell, 'ref') as Enemy | undefined;
            if (enemy) markEnemyPoisonDamaged(enemy);
        },
        onPoisonKill: (victim) => {
            const world = _ecsRuntime!.world;
            if (!world.has(victim, EC.LegacyShell)) return;
            const enemy = world.get(victim, EC.LegacyShell, 'ref') as Enemy | undefined;
            if (enemy) handlePoisonDeath(enemy);
        },
        // The whole body is legacy player state on purpose: armor comes from
        // the modifier pipeline, the health write lands on the ServerPlayer,
        // and death runs second-chance, pet despawn and two emits. What the
        // ECS owns is the query (only poisoned flowers are visited) and the
        // expiry.
        tickPlayerPoison: (victim, deltaTime) => {
            const player = playerFromEntity(victim);
            if (!player || player.isDead || player.isInvulnerable) return;

            const armor = calculatePlayerModifiers(player).poisonArmor ?? 0;
            const dps = Math.max(0, (player.poisonDamage ?? 0) - armor);
            if (dps <= 0) return;

            player.health -= dps * deltaTime;
            player.lastDamageTime = Date.now();

            if (player.health <= 0 && !trySecondChance(player, io)) {
                player.health = 0;
                player.isDead = true;
                if (player.poisonSource) player.killedBy = player.poisonSource;
                despawnAllPlayerPets(player.id, io);
                getWireOutbox().all('playerDied', { playerId: player.id });
            }

            emitPlayerDamaged(player, { knockbackX: 0, knockbackY: 0, damageDealt: dps * deltaTime });
        },
        onPlayerPoisonLapsed: (victim) => {
            const player = playerFromEntity(victim);
            if (!player) return;
            player.poisonUntil = undefined;
            player.poisonDamage = undefined;
            player.poisonSource = undefined;
        },
        // The maze is a bounded, persistently-populated dungeon (rrolf-style):
        // while anyone is inside, none of its mobs distance-despawn — otherwise
        // the deep zones would always be empty except a bubble around each
        // player. Once it empties, the normal 30s timer cleans it up.
        isDespawnProtectedAt: (x, y) => hasMazePlayers() && isInMazeRegion(x, y),
        onMobDespawn: (victim) => {
            const world = _ecsRuntime!.world;
            if (!world.has(victim, EC.LegacyShell)) return;
            const enemy = world.get(victim, EC.LegacyShell, 'ref') as Enemy | undefined;
            if (!enemy) return;
            // Mark dead first so any legacy pass still holding the shell this
            // tick skips it (the timed-despawn path always did this), then
            // clean up + splice + emit — the sequence both legacy despawn
            // passes ran.
            (enemy as { isDead?: boolean }).isDead = true;
            cleanupEnemy(enemy);
            if (removeEnemy(enemy)) getWireOutbox().all('enemyDestroyed', enemy.id);
        },
        // The reaper's death sequence — the body of the old reapDeadEnemies
        // loop, per victim. XP to the top damage contributor (a pet kill
        // credits its owner: contributors are keyed by player), then the
        // digger roll, then removal.
        onReapEnemy: (victim) => {
            const world = _ecsRuntime!.world;
            if (!world.has(victim, EC.LegacyShell)) return;
            const enemy = world.get(victim, EC.LegacyShell, 'ref') as Enemy | undefined;
            if (!enemy) return;
            if (!isEnemyLive(enemy)) return; // a direct kill path already removed it

            if (enemy.damageContributors && enemy.damageContributors.size > 0) {
                let topContributor: string | undefined;
                let maxDamage = 0;
                enemy.damageContributors.forEach((damage, playerId) => {
                    if (damage > maxDamage) {
                        maxDamage = damage;
                        topContributor = playerId;
                    }
                });

                // Same rule as every other death path: full XP to each looter.
                awardKillXp(enemy, killCtx);
                if (topContributor && players[topContributor]) {
                    const { dropMultiplier } = getLeaderboardRewardMultipliers(topContributor);
                    trackMobKill(enemy, players, playerUserIds, database, io, savePlayerProgress);
                    handleMobDrops(enemy, dropMultiplier);
                    sendBossMobDefeatedMessage(enemy, io, players);
                }
            }

            // A wild hole can leave a digger behind. Pet holes are excluded — a
            // player's own summon shouldn't hatch a hostile. The digger spawns
            // at full health, so it cannot be reaped by this same pass.
            if (DIGGER_SPAWNING_HOLES.has(enemy.type) && !enemy.ownerId && Math.random() < DIGGER_SPAWN_CHANCE) {
                const digger = spawnEnemy('digger', enemy.tier, mobX(enemy.entity), mobY(enemy.entity));
                if (digger) emitEnemySpawned(digger);
            }

            // Clean up enemy data structures before removal to prevent memory leaks
            cleanupEnemy(enemy);
            removeEnemy(enemy);
            updateSpecialMobCounts();
            // Emit like every OTHER death path does. The legacy reaper relied
            // on the broadcast's R list alone, and that leaks: the join
            // snapshot preloads mobs from a 4x-viewport halo around EVERY
            // player, while the delta broadcast tracks only a ~2x box around
            // this client — a preloaded mob reaped outside that box gets no R
            // and, without this, no event either: a permanent client ghost.
            getWireOutbox().all('enemyDestroyed', enemy.id);
        },
        // Queen-ant escorts: the summon half of the legacy updatePeriodicSpawns
        // (the interval clock lives on the PeriodicSpawner component now).
        onSpawnEscort: (summoner) => {
            const world = _ecsRuntime!.world;
            if (!world.has(summoner, EC.LegacyShell)) return;
            const enemy = world.get(summoner, EC.LegacyShell, 'ref') as Enemy | undefined;
            if (!enemy || (enemy as { isDead?: boolean }).isDead) return;
            const stats = mobStatsOf(enemy.entity) ?? getMobStats(enemy.type, enemy.tier);
            const spawnCfg = stats?.periodic_spawn;
            if (!spawnCfg) return;

            let alive = 0;
            for (const other of liveEnemies()) {
                if (other.parentHoleId === enemy.id && other.type === spawnCfg.mobType) alive++;
            }
            if (alive >= spawnCfg.maxAlive) return;

            // Behind the summoner, like gardn's queen ant.
            const radius = (stats!.size * 40) / 2 * getEnemySizeScale(!!enemy.ownerId, enemy.tier, spawnCfg.mobType, enemy.id);
            const behindX = mobX(enemy.entity) - Math.cos(mobAngle(enemy.entity)) * radius;
            const behindY = mobY(enemy.entity) - Math.sin(mobAngle(enemy.entity)) * radius;
            let spawnTier = enemy.tier;
            for (let step = 0; step < -(spawnCfg.spawnRarityOffset ?? 0); step++) {
                spawnTier = downgradeRarity(spawnTier);
            }
            // despawnAt and the inherited target are constructor arguments, not
            // post-spawn patches: both reach ECS components (Expires,
            // MobAI.target) at construction and nothing re-reads the legacy
            // fields afterwards.
            const child = spawnEnemy(spawnCfg.mobType, spawnTier, behindX, behindY, {
                parentHoleId: enemy.id,
                ownerId: enemy.ownerId,
                despawnAt: Date.now() + spawnCfg.lifetimeMs,
                targetPlayerId: mobTargetPlayerId(enemy.entity),
            });
            if (!child) return;
            emitEnemySpawned(child);
        },
        // Ant-hole waves: the spawn half of the legacy spawnWaveMobs (the
        // health-threshold bookkeeping lives on SpawnWaveState now).
        onSpawnWaves: (parent, startWave, endWave) => {
            const world = _ecsRuntime!.world;
            if (!world.has(parent, EC.LegacyShell)) return;
            const enemy = world.get(parent, EC.LegacyShell, 'ref') as Enemy | undefined;
            if (!enemy || (enemy as { isDead?: boolean }).isDead) return;
            const parentStats = mobStatsOf(enemy.entity) ?? getMobStats(enemy.type, enemy.tier);
            if (!parentStats || !parentStats.spawn_waves || parentStats.spawn_waves.length === 0) return;
            const waves = parentStats.spawn_waves;
            const numWaves = waves.length - 1;
            const parentRadius = (parentStats.size * 40) / 2 * getEnemySizeScale(!!enemy.ownerId, enemy.tier, enemy.type, enemy.id);

            for (let i = startWave; i >= endWave; i--) {
                const waveIndex = numWaves - i;
                if (waveIndex < 0 || waveIndex >= waves.length) continue;
                const wave = waves[waveIndex];

                for (const childType of wave) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = parentRadius + 10 + Math.random() * parentRadius;
                    const child = spawnEnemy(
                        childType,
                        enemy.tier,
                        mobX(enemy.entity) + Math.cos(angle) * dist,
                        mobY(enemy.entity) + Math.sin(angle) * dist,
                        { parentHoleId: enemy.id },
                    );
                    if (!child) continue;
                    emitEnemySpawned(child);
                }
            }
        },
    });
    configureCutover(_ecsRuntime);
    // Bot AI is a Phase.Input system, registered from HERE rather than from
    // createEcsRuntime: server/botManager.ts reaches the squad manager, the
    // world map and the chat socket, and importing it inside the ECS
    // composition root would drag all of that into every module that only
    // wanted a world. See registerBotInputSystem for why it lands on the input
    // scheduler and nowhere else.
    registerBotInputSystem(_ecsRuntime.inputScheduler, io);
    // The wire outbox drains in Phase.Networking on the WORLD scheduler, which
    // is the last one to run in a step (see runSimulationStep) — so everything
    // a tick produced leaves together, in production order, and ahead of the
    // separately-timed gameStateUpdate frame that could mention the same
    // entities. Registered from here for the same reason bot AI is: the binding
    // in server/wireOutbox.ts reaches `players`, the viewport constants and the
    // socket server, none of which the ECS composition root may import.
    registerWireOutboxSystem(_ecsRuntime.worldScheduler, getWireOutbox());
    console.log('[ECS] mob simulation initialised');
    return _ecsRuntime;
}

/**
 * Give the entity registry its world — ONE host for every kind.
 *
 * Mobs, drops, players and projectiles all reach the world through this; there
 * is no per-kind host any more, because nothing about admission or retirement
 * was ever kind-specific (see server/entityRegistry.ts).
 *
 * A module-scope statement, so it is impossible for a spawn to happen before
 * the wiring exists — a mob admitted without an entity would be a statue, and
 * nothing would report it. `getWorld` is a thunk rather than a world so the
 * runtime stays lazily constructed; the registry is the first thing to ask for
 * it if something spawns before the first tick.
 *
 * `resolvePlayer` goes through ensurePlayerEntity, not a bare lookup: pets are
 * spawned by petal actions inside updatePlayerState, which runs BEFORE
 * moveEnemies' syncToEcs, so a player summoning on their very first tick would
 * otherwise hand their pet a null owner that nothing ever repairs.
 */
bindEntityHost({
    getWorld: () => getEcsRuntime().world,
    resolvePlayer: (socketId) => {
        const player = players[socketId];
        if (!player) return undefined;
        return ensurePlayerEntity(getEcsRuntime().world, player, Date.now());
    },
});

// The broadcast encodes enemies straight from component columns now.
bindBroadcastWorld(() => getEcsRuntime().world);

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
            getWireOutbox().all('playerDied', { playerId: player.id });
        }
    }

    emitPlayerDamaged(player, { knockbackX, knockbackY, damageDealt });

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
// reapDeadEnemies is gone: the ECS reaper (last system in the mob scheduler's
// Lifetime phase) sweeps [IsDead, IsEnemy] and runs the death sequence through
// the onReapEnemy hook above. IsDead reaches the entity from every damage
// path: syncToEcs marks it for legacy petal damage, mobCollision and the
// poison stacks mark it themselves, and the direct kill paths (projectiles,
// pollen) remove the shell before the reaper ever sees the mob.

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

// updateGroundPollens / updateWebFields are gone: pollen puffs and web fields
// are ECS entities now (ecs/systems/groundEffects.ts), ticked by
// runtime.tickWorld inside runSimulationStep. Their expiry emits and the web
// slow still land on the legacy side through the runtime's injected hooks.

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
    for (const id in players) {
        updatePlayerPreMovement(players[id], deltaTime, playerStateDeps);
    }
    const movementNow = Date.now();
    syncPlayersToEcs(playerRuntime.world, players, movementNow);
    // dt-SCALED, so exactly once per simulation step — never replayed for
    // catch-up the way the fixed-step mob tick is. Replaying it would move every
    // flower mobCatchupCalls times its distance.
    playerRuntime.tickPlayers(deltaTime, deltaMs, movementNow);
    syncPlayersFromEcs(playerRuntime.world, players);

    // The player pipeline now runs as a scheduled system rather than a bare
    // loop here, so it is phase-ordered and appears in the per-system timings.
    // It still runs at exactly this point — after the movement window closed
    // with syncPlayersFromEcs — and still iterates players in the same order.
    // The pipeline scheduler runs updatePlayerState for every player AND the
    // petal interval behaviours, in that order, as phase-ordered systems.
    playerRuntime.tickPlayerPipeline(deltaTime, deltaMs, movementNow);

    // Mob and player poison tick as ECS systems now (poisonStacks /
    // playerPoison, Phase.Combat on the mob scheduler — registered ahead of
    // mobCollision, matching the legacy poison-before-melee order). Mob slow
    // expiry is the ECS slowExpiry system, in Phase.Input — still before
    // movement reads speed.

    // Queen-ant escorts, their despawn timers and ant-hole waves are ECS
    // systems now (spawning.ts on the world scheduler; mobExpiry on the mob
    // scheduler's Lifetime phase).

    for (let i = 0; i < mobCatchupCalls; i++) {
        moveEnemies();
    }

    // Projectiles are dt-SCALED, so unlike moveEnemies they run exactly ONCE
    // with the real elapsed milliseconds. Replaying them the way mobs are
    // replayed would fly every shot mobCatchupCalls times its distance.
    const projectileRuntime = getEcsRuntime();
    projectileRuntime.tickProjectiles(deltaMs, Date.now());

    // Ground effects (pollen damage, web slows, their expiry) tick right after
    // projectiles: they reuse the grid tickProjectiles just rebuilt, and their
    // health writes ride the same write-back below. Note they used to run
    // OUTSIDE the runSimTick gate (after runSimulationStep in the loop), so
    // under an admin-simulated tick spike they now advance per simulated tick
    // like everything else instead of per real tick — which is how a genuinely
    // slow server always behaved.
    projectileRuntime.tickWorld(deltaMs, Date.now());

    // No write-back here any more. This used to need one: projectile and
    // ground-effect damage landed on the components, and without repeating
    // syncFromEcs the next tick's syncToEcs would push the stale legacy
    // `enemy.health` straight back over it — mobs unkillable by ranged attacks.
    // With the components as the only storage there is no stale copy to lose to.

    broadcastProjectiles();

    // Retire the entities of every mob removed THIS step (kills, despawns,
    // expiries) before the tick ends. The broadcast timer fires between ticks
    // and reads the WORLD now, so an entity that outlived its shell until the
    // next tick's drain would go back on the wire for a frame right after the
    // client was told it died. Nothing is iterating entity handles here — this
    // is the same safe point the per-tick drain in maintainEnemyEntities uses,
    // which stays as the safety net for off-tick removals.
    drainRemovedEnemies(projectileRuntime.world);
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
    getWireOutbox().all('enemiesDamaged', damagedEnemies);
}

// The item spawn batch is gone. Drops used to be announced with a batched
// `itemsSpawned` per recipient per tick; they are part of the gameStateUpdate
// entity stream now, so they are announced by simply existing — and, unlike a
// one-shot event, a frame lost to backpressure repairs itself next tick.

// updateWorldItems / removeWorldItem are gone: dropped items are ECS entities
// (server/itemRegistry.ts admits them; ecs/systems/droppedItems.ts does the
// per-tick wall push, bounds check and expiry through the isItemOutOfBounds /
// onWorldItemRemoved hooks). The per-item removal setTimeout — and the
// itemExpirationTimeouts map that tracked it — no longer exist: the deadline
// is an Expires component swept with everything else.

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

    // Same pair for the broadcast loop below. Kept separate from the tick's so
    // the two timers, which fire at different rates, never clobber each other's
    // list mid-pass.
    const broadcastPlayerIds: string[] = [];
    const broadcastSockets: AuthenticatedSocket[] = [];

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
        maintainBotCount(io, authenticatedPlayerIds.length, getEcsRuntime().world);

        // Skip game processing if there are no authenticated players
        if (authenticatedPlayerIds.length === 0) {
            return;
        }

        // Build a spatial grid of liveEnemies() once per tick. Player/petal collision
        // loops in updatePlayerState query this instead of scanning all liveEnemies().
        // Must run BEFORE the input tick: bot targeting queries this grid.
        rebuildEnemyGrid(liveEnemies());

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

        if (runSimTick) runSimulationStep(deltaTime, deltaMs, mobCatchupCalls);

        // Ground pollen and web fields tick inside runSimulationStep now
        // (runtime.tickWorld) — they are ECS entities. Viewport tracking and
        // the 30s distance-despawn are ECS systems too (viewportStatus /
        // unseenDespawn on the mob scheduler), strided at the same ~6Hz with
        // the same offset the legacy passes used.

        // Wave mobs from damaged spawners (e.g. ant holes) spawn inside
        // runSimulationStep now (the spawnWaves system on the world
        // scheduler), still before the damage batch below is emitted.

        flushEnemyDamageBatch();

        evictStalePetalTimers();

        // NOTE: the gameStateUpdate broadcast no longer runs here — it is on its
        // own BROADCAST_INTERVAL timer below, so simulation rate and send rate
        // are independent. tickDurMs therefore now measures simulation only.

        // Record how long this tick's work actually took (idle early-return
        // ticks never reach here, so they don't dilute the average).
        const tickDurMs = performance.now() - nowMs;
        debugTickAccumMs += tickDurMs;
        debugTickSamples++;
        if (tickDurMs > debugTickMaxMs) debugTickMaxMs = tickDurMs;
    }, TICK_INTERVAL);

    // -----------------------------------------------------------------------
    // Broadcast loop — decoupled from the simulation tick.
    //
    // Simulation runs at TICK_RATE (30Hz) because physics and combat want the
    // resolution; the wire does not. Sending every tick meant the per-recipient
    // encode+cull+delta pass (O(recipients × entities)) ran 30 times a second
    // and its socket writes landed inside the tick's 33.3ms budget. At 20Hz
    // that work happens 1/3 less often and, being a separate macrotask, no
    // longer inflates tickDurMs.
    //
    // Firing on its own timer is safe despite reading live world state: Node is
    // single-threaded and the tick callback runs to completion, so this can only
    // ever land BETWEEN ticks — never on a half-updated world.
    //
    // The client already interpolates between snapshots (see the render-ref
    // easing in graphics/player-drawing.ts), so a lower snapshot rate costs
    // smoothness only if it drops below the interpolation window.
    // -----------------------------------------------------------------------
    const BROADCAST_RATE = 20;
    const BROADCAST_INTERVAL = 1000 / BROADCAST_RATE;

    setInterval(() => {
        // Rebuilt here rather than reused from the tick: at 20Hz vs 30Hz the
        // two loops interleave unevenly, and a socket that dropped in between
        // would otherwise still be in the list.
        broadcastPlayerIds.length = 0;
        broadcastSockets.length = 0;
        for (const id in players) {
            const socket = io.sockets.sockets.get(id) as AuthenticatedSocket | undefined;
            if (socket && socket.userId) {
                broadcastPlayerIds.push(id);
                broadcastSockets.push(socket);
            }
        }
        if (broadcastPlayerIds.length === 0) return;

        broadcastGameState(broadcastPlayerIds, broadcastSockets, buildPlayerSnapshots());
    }, BROADCAST_INTERVAL);

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
    if (Object.keys(players).length === 0) return;

    // Read the open-world deficit BEFORE the arena/maze spawners run, so their
    // mobs never count against the open-world target (matches prior behaviour).
    const reading = measureViewportDensity();

    // Keep the PVP arena populated with garden mobs + spiders. These
    // spawners admit their own mobs now — see server/enemyRegistry.ts.
    spawnArenaMobs(3);

    // Keep the maze corridors populated (tier by depth zone) and its
    // ultra bosses alive in the deepest rooms. 40 per half-second fills a
    // fresh maze (~1300-mob target at full world density) in ~17s; at
    // steady state the target cap throttles this down to a
    // kill-replacement trickle.
    spawnMazeMobs(40);
    spawnMazeBosses();

    spawnToViewportDensity(reading, 3);
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
        getWireOutbox().all('enemyDestroyed', id);
    }

    const maze = setActiveMazeDay(day);
    invalidateMazeMobPool();
    getWireOutbox().all('mazeInfo', { day: maze.dayNumber, biome: maze.biome });
    console.log(`[MAZE] Rotated to day ${maze.dayNumber} (${maze.biome})`);

    for (const pid in players) {
        const p = players[pid];
        if (!p?.inMaze) continue;
        const spawn = getMazeSpawnPosition();
        p.x = spawn.x;
        p.y = spawn.y;
        // `players` includes splitter halves, which own no socket of their own.
        getWireOutbox().toPlayer(pid, 'playerTeleported', { newX: spawn.x, newY: spawn.y, playerId: pid });
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
