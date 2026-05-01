import express from 'express';
import { createServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { Server, Socket } from './ws_server';
import path from 'path';
import v8 from 'v8';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { database, Notification, ApiKey } from './database';
import { USE_HTTPS, SERVER_PROTOCOL, PVP_ARENA_SPAWN_X, PVP_ARENA_SPAWN_Y } from './constants';

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

import { ServerPlayer, PlayerProgress, PlayerInventory, FaceFlags, EquipmentFlags } from './player';
import { dictToInventory, ID_TO_RARITY, ID_TO_ITEM_KEY } from './inventoryCodec';
import { updatePlayerEffects, getDamageMultiplier, getSpeedMultiplier, getShieldAmount, executePetalActionsOnSpawn, updatePetalActions, handlePetalCollision, cleanupPetalActions, updatePetalPosition, spawnPet, despawnPet, despawnAllPlayerPets } from './petal_actions';
import { RARITY_LEVELS, Rarity } from './petals';
import { PLAYER_DAMAGE, WORLD_WIDTH, WORLD_HEIGHT, ZONE_BOUNDARIES, ENEMY_TIERS, KNOCKBACK_RECOVERY_SPEED, ENEMY_SIZE, PLAYER_SIZE, KNOCKBACK_FORCE, DROP_CHANCES, PLAYER_MAX_HEALTH, HEALTH_PER_LEVEL, DAMAGE_PER_LEVEL, BASE_XP_REQUIREMENT, XP_MULTIPLIER, RESPAWN_INVULNERABILITY_TIME, enemies, players, dots, obstacles, OBSTACLE_COUNT, ENEMY_CORAL_PROBABILITY, ENEMY_CORAL_HEALTH, SAND_COUNT, DECORATION_COUNT, MapElement, MapData, BiomeSpawnEntry, isWall, isTeleporter, ACTUAL_WORLD_HEIGHT, ACTUAL_WORLD_WIDTH, SCALE_FACTOR, MAX_SPEED, MOUSE_NONLINEAR_SCALE, MOUSE_NONLINEAR_EXPONENT, VIEWPORT_BUFFER, ENEMY_DESPAWN_TIME, ENEMIES_PER_VIEWPORT, ORIGINAL_ENEMY_DENSITY, ORIGINAL_ENEMY_COUNT, VIEWPORT_WITH_BUFFER_AREA, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, TOTAL_WORLD_AREA, getServerConfigs, getServerConfigByPort, ServerConfig, getTileState, SECTION_CONFIGS, isInPvpArena, isTileIdBlocking } from './constants';
import { WORLD_MAP, WALL_GRID } from './map_data';
import { Enemy, Obstacle, createDecoration, getRandomPositionInZone, Decoration, Sand, createSand, getXPFromEnemy, PoisonEffect, isCentipedeHeadType, isCentipedeBodyType } from './server_utils';
import { MobProjectile, PlayerProjectile } from './enemy';
import { Item, ItemWithRarity, WorldItem } from './item';
import { getAllPetalTypes, getPetalStats } from './petals';
import { MOB_CONFIG, getMobStats, getAllMobTypes, calculateMobDrops, DropItem, SIZE_SCALING } from './mobs';

// Import from refactored modules
import {
    trackDamage,
    calculateDPS,
    getEligiblePlayers,
    sendBossMobDefeatedMessage,
    cleanupEnemy,
    trackMobKill
} from './server/utils';
import {
    createSquad,
    inviteToSquad,
    acceptInvite,
    declineInvite,
    leaveSquad as leaveSquadFn,
    getSquadForPlayer,
    sendSquadChatMessage,
    sendSquadSystemMessage,
    findPlayerByUsername,
    findBotByName,
    handlePlayerDisconnect as handleSquadDisconnect,
    playerSquadMap,
    listPublicSquads,
    joinPublicSquad,
    setSquadVisibility,
    addBotToSquad,
    MAX_SQUAD_SIZE
} from './server/squadManager';
import {
    loadGuildsFromDatabase,
    createGuild,
    inviteToGuild,
    acceptGuildInvite,
    declineGuildInvite,
    leaveGuild as leaveGuildFn,
    kickFromGuild,
    forceJoinGuild,
    getGuildForUsername,
    listGuilds,
    buildGuildUpdate,
    broadcastGuildUpdate,
    sendGuildSystemMessage,
    sendGuildChatMessage,
    findSocketIdByUsername as findGuildSocketIdByUsername,
    pendingGuildInvites,
    syncGuildToOnlineMembers,
    MAX_GUILD_SIZE,
    Guild
} from './server/guildManager';
import {
    checkPlayerWallCollisions,
    checkEnemyWallCollisions,
    checkItemWallCollisions,
    checkProjectileWallCollision,
    hasLineOfSight,
    checkEnemyEnemyCollisions,
    checkPlayerEnemyCollision
} from './server/physics';
import {
    updatePlayerState,
    getPlayerViewports,
    isPositionInPlayerPetalRange,
    validatePlayerPositions,
    isPositionInAnyViewport,
    getEnemiesInViewportCount,
    getEnemiesInViewport200Percent,
    PlayerStateDependencies,
    cleanupPetalPhysicsStates
} from './server/playerState';
import {
    executeServerCommand,
    handleAdminCommand,
    setupStdinCommandHandler,
    getAdminHelpText,
    CommandHandlerDependencies
} from './server/commands';
import { 
    items, 
    ultraMobCount, 
    superMobCount, 
    uniqueMobCount,
    decorations,
    sands,
    ENEMY_COUNT,
    playerUserIds,
    mobProjectiles,
    playerProjectiles,
    petalLastProjectileTime,
    itemExpirationTimeouts,
    petalCooldownTimeouts,
    ITEM_EXPIRATION_TIMES,
    getItems,
    getMobProjectiles,
    getPlayerProjectiles,
    setEnemyCount,
    getEnemyCount
} from './server/gameState';
import { handleMobDrops as handleMobDropsModule } from './server/itemManager';
import { updateBotAI, maintainBotCount, triggerBotRaid, initializeBotGuilds, getBotLevelForName, getBotLoadoutForName } from './server/botManager';
import {
    createInitialBasicPetals,
    createInitialInventory,
    addItem,
    removeItem,
    hasItem,
    respawnPlayer as respawnPlayerModule,
    getSpawnPositionInBiome,
    isBiomeSafeForSpawn,
    findSafeSpawnPosition,
    calculateXPRequirement,
    calculateTotalXP,
    calculateLevelFromTotalXP,
    calculateCurrentLevelXP,
    calculateMaxHealthFromLevel,
    calculateDamageFromLevel,
    getSkillMultiplier,
    applyPetalHealthBonus,
    addXPToPlayer as addXPToPlayerModule,
    savePlayerProgress as savePlayerProgressModule,
    recalculatePlayerStats,
    enterPvpArena
} from './server/playerManager';
import { setupTransferEndpoints, transferPlayerToServer as transferPlayerToServerModule } from './server/crossServer';
import {
    createEnemy as createEnemyModule,
    createSpecialMob as createSpecialMobModule,
    spawnSpecialMobs as spawnSpecialMobsModule,
    updateSpecialMobCounts as updateSpecialMobCountsModule,
    spawnCentipedeBodySegments,
    spawnInitialSpawns,
    getSectionAtPosition,
    EnemySpawnerHelpers
} from './server/enemySpawner';
import { spawnArenaMobs } from './server/pvpArenaSpawner';
import { registerApiKeyRoutes, recordBossEvent, stripHtml } from './server/apiKeyApi';
import { setSuperMobInSection } from './server/gameState';

// Load persisted guilds into memory now that database + guildManager are both ready.
loadGuildsFromDatabase();
initializeBotGuilds();

const app = express();

// Re-export functions that are used elsewhere
export { trackDamage, sendBossMobDefeatedMessage };

// Wrapper function for handleMobDrops that passes io (will be set up later)
let ioInstance: any;
export function handleMobDrops(enemy: Enemy, io?: any) {
    const enemyData = {
        type: enemy.type,
        tier: enemy.tier,
        x: enemy.x,
        y: enemy.y,
        damageContributors: enemy.damageContributors ? new Map(enemy.damageContributors) : undefined
    };
    handleMobDropsModule(enemyData, io || ioInstance);
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
// Add body parser middleware for JSON
app.use(express.json());

// Add CORS middleware with specific origin
app.use((req, res, next) => {
    const origin = req.headers.origin || 'https://localhost:8080';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Authentication endpoints
app.post('/auth/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = database.createUser(username, password);
    if (user) {
        res.status(201).json({ message: 'User created successfully' });
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
        // You might want to set up a session here
        res.json({ message: 'Login successful', userId: user.id });
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

app.post('/auth/verify', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = database.getUser(username, password);
    if (user) {
        res.json({ valid: true });
    } else {
        res.status(401).json({ valid: false });
    }
});

app.post('/auth/logout', (req, res) => {
    // Handle any cleanup needed
    res.json({ message: 'Logged out successfully' });
});

// Cross-server player transfer endpoints - setup will be called after io is created

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, '../dist'), {
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

app.use('/assets', express.static(path.join(__dirname, '../assets'), {
    setHeaders: (res, filePath) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Cross-Origin-Resource-Policy', 'cross-origin');
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Serve favicon from dist directory (it's copied there during build)
app.use('/favicon.ico', express.static(path.join(__dirname, '../dist/favicon.ico')));

// Notification endpoints
app.use(express.json());
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
    const { entries, totalAccounts, dailyActiveUsers } = database.getLeaderboard(limit);
    const authUsername = typeof req.query.username === 'string' ? req.query.username : undefined;
    const authPassword = typeof req.query.password === 'string' ? req.query.password : undefined;
    let isAdmin = false;
    if (authUsername && authPassword) {
        const user = database.getUser(authUsername, authPassword);
        isAdmin = !!user && database.isUserAdmin(authUsername);
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

// Create server based on protocol configuration
let server: http.Server | https.Server;

if (USE_HTTPS) {
    try {
        const certDir = path.resolve(__dirname, '..');
        server = createServer({
            key: fs.readFileSync(path.join(certDir, 'cert.key')),
            cert: fs.readFileSync(path.join(certDir, 'cert.crt'))
        }, app);
        console.log(`[SERVER] Using HTTPS protocol`);
    } catch (error) {
        console.warn(`[SERVER] HTTPS certificates not found, falling back to HTTP`);
        server = createHttpServer(app);
        console.log(`[SERVER] Using HTTP protocol (fallback)`);
    }
} else {
    server = createHttpServer(app);
    console.log(`[SERVER] Using HTTP protocol`);
}

const io = new Server(server);

// Set ioInstance for use in modules
ioInstance = io;

// Get current server port and configuration
const PORT = process.env.PORT || 3000;
const CURRENT_SERVER_PORT = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
const SERVER_CONFIGS = getServerConfigs();
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
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
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
    
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        
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
function spawnMob(mobType: string, rarity: string, x?: number, y?: number): void {
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
        // Validate provided coordinates
        spawnX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, spawnX));
        spawnY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, spawnY));
        
        // Check if position is in out-of-bounds zone
        const BOUNDARY_THRESHOLD = 100;
        const isInOutOfBoundsZone = spawnX < BOUNDARY_THRESHOLD || 
                                    spawnX > ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
                                    spawnY < BOUNDARY_THRESHOLD || 
                                    spawnY > ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
        
        if (isInOutOfBoundsZone) {
            console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) are in out-of-bounds zone. Finding alternative position...`);
            spawnX = undefined;
            spawnY = undefined;
        } else {
            // Check if position is in a safe zone
            const inSafeZone = WORLD_MAP.some(element =>
                element.type === 'safe_zone' &&
                spawnX! >= element.x * SCALE_FACTOR &&
                spawnX! <= (element.x + element.width) * SCALE_FACTOR &&
                spawnY! >= element.y * SCALE_FACTOR &&
                spawnY! <= (element.y + element.height) * SCALE_FACTOR
            );

            // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
            const tileState = getTileState(WALL_GRID, spawnX!, spawnY!);
            const collidesWithWall = isTileIdBlocking(tileState);

            if (!inSafeZone && !collidesWithWall) {
                validPosition = true;
            } else {
                console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) are in a safe zone or wall. Finding alternative position...`);
                spawnX = undefined;
                spawnY = undefined;
            }
        }
    }

    // If coordinates weren't provided or were invalid, find a valid position
    if (!validPosition) {
        // Try to spawn near a player if available
        const playerIds = Object.keys(players);
        if (playerIds.length > 0) {
        while (!validPosition && attempts < MAX_ATTEMPTS) {
            attempts++;
            const randomPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
            const player = players[randomPlayerId];
            
            // Spawn within viewport of a random player
            const vpW = player.viewportWidth || VIEWPORT_WIDTH;
            const vpH = player.viewportHeight || VIEWPORT_HEIGHT;
            const viewportBuffer = VIEWPORT_BUFFER;
            const minX = player.x - vpW/2 - viewportBuffer;
            const maxX = player.x + vpW/2 + viewportBuffer;
            const minY = player.y - vpH/2 - viewportBuffer;
            const maxY = player.y + vpH/2 + viewportBuffer;
            
            spawnX = minX + Math.random() * (maxX - minX);
            spawnY = minY + Math.random() * (maxY - minY);
            
            // Clamp to world boundaries
            spawnX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, spawnX));
            spawnY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, spawnY));

            // Skip if position is in out-of-bounds zone
            const BOUNDARY_THRESHOLD = 100;
            const isInOutOfBoundsZone = spawnX! < BOUNDARY_THRESHOLD || 
                                        spawnX! > ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
                                        spawnY! < BOUNDARY_THRESHOLD || 
                                        spawnY! > ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
            
            if (isInOutOfBoundsZone) {
                continue;
            }

            // Check if position is in a safe zone
            const inSafeZone = WORLD_MAP.some(element =>
                element.type === 'safe_zone' &&
                spawnX! >= element.x * SCALE_FACTOR &&
                spawnX! <= (element.x + element.width) * SCALE_FACTOR &&
                spawnY! >= element.y * SCALE_FACTOR &&
                spawnY! <= (element.y + element.height) * SCALE_FACTOR
            );

            // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
            const tileState2 = getTileState(WALL_GRID, spawnX!, spawnY!);
            const collidesWithWall = isTileIdBlocking(tileState2);

            if (!inSafeZone && !collidesWithWall) {
                validPosition = true;
            }
        }
        } else {
            // No players online, spawn at random valid position
            while (!validPosition && attempts < MAX_ATTEMPTS) {
                attempts++;
                spawnX = Math.random() * ACTUAL_WORLD_WIDTH;
                spawnY = Math.random() * ACTUAL_WORLD_HEIGHT;

                // Skip if position is in out-of-bounds zone
                const BOUNDARY_THRESHOLD = 100;
                const isInOutOfBoundsZone = spawnX! < BOUNDARY_THRESHOLD || 
                                            spawnX! > ACTUAL_WORLD_WIDTH - BOUNDARY_THRESHOLD ||
                                            spawnY! < BOUNDARY_THRESHOLD || 
                                            spawnY! > ACTUAL_WORLD_HEIGHT - BOUNDARY_THRESHOLD;
                
                if (isInOutOfBoundsZone) {
                    continue;
                }

                // Check if position is in a safe zone
                const inSafeZone = WORLD_MAP.some(element =>
                    element.type === 'safe_zone' &&
                    spawnX! >= element.x * SCALE_FACTOR &&
                    spawnX! <= (element.x + element.width) * SCALE_FACTOR &&
                    spawnY! >= element.y * SCALE_FACTOR &&
                    spawnY! <= (element.y + element.height) * SCALE_FACTOR
                );

                // Check if position collides with wall tiles (state 1 = wall, state 2 = water)
                const tileState3 = getTileState(WALL_GRID, spawnX!, spawnY!);
                const collidesWithWall = isTileIdBlocking(tileState3);

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
    const enemy: Enemy = {
        id: Math.random().toString(36).substr(2, 9),
        type: mobType as Enemy['type'],
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
        aiType: mobStats.ai_type,
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
    enemies.push(enemy);

    // Notify all clients
    io.emit('enemySpawned', enemy);

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

    console.log(`Spawned ${tier} ${mobType} at (${Math.round(spawnX)}, ${Math.round(spawnY)})`);
}

// respawnPlayer moved to playerManager module - using wrapper function defined earlier

// Helper function to determine spawn type based on level
function getSpawnTypeForLevel(level: number): NonNullable<MapElement['properties']>['spawnType'] {
    if (level <= 5) return 'common';
    if (level <= 10) return 'uncommon';
    if (level <= 15) return 'rare';
    if (level <= 25) return 'epic';
    if (level <= 40) return 'legendary';
    return 'mythic';
}

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

interface AuthenticatedSocket extends Socket {
    userId?: string;
    username?: string;
    connectionQuality?: 'good' | 'medium' | 'slow';
    averagePing?: number;
    pingSamples?: number[];
    lastUpdateTime?: number;
    lastGameState?: any; // For delta compression
    lastStateHash?: number; // Lightweight hash for skip-if-unchanged
    lastSentEnemies?: Map<string, { x: number; y: number; h: number; H: number; t: any; T: any; L: string | undefined }>;
    lastSentPlayers?: Map<string, {
        x: number; y: number; a: number;
        h: number; H: number;
        l: number; s: number;
        e: number;
        f: number; q: number; m: number;
        v: number; V: number; z: number;
        n: string;
        petalsSig: string;
    }>;
}

// Skill multipliers based on rarity tier
const SKILL_MULTIPLIERS: Record<string, number> = {
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
const RARITY_TP_COSTS: Record<string, number> = {
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
export function addXPToPlayer(player: ServerPlayer, xp: number, socketId?: string): void {
    addXPToPlayerModule(player, xp, socketId, ioInstance);
    
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
        const socket = ioInstance.sockets.sockets.get(socketId) as AuthenticatedSocket;
        if (socket?.userId) {
            savePlayerProgressModule(player, socket.userId, database);
        }
    }
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
    trackMobKill
};

io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('A user connected');

    // Map is bundled with the client via src/map_data.ts — no longer streamed
    // here. The server still imports WORLD_MAP / WALL_GRID locally for
    // collision, spawn, and pathfinding logic.

    socket.on('playerInput', (inputData: any) => {
        const player = players[socket.id];
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
                if (activePlayer && players[activePlayer.id]) {
                    players[activePlayer.id].inputs = inputData;
                }
            } else {
                // Normal player - apply inputs directly
                player.inputs = inputData;
            }
        }
    });

    // Handle authentication
    socket.on('authenticate', async (credentials: { username: string, password: string, playerName: string, spawnBiome?: string }) => {
        const user = database.getUser(credentials.username, credentials.password);

        if (user) {
            socket.userId = user.id;
            socket.username = user.username;
            playerUserIds[socket.id] = user.id; // Store the mapping

            // Award daily streak bonus before loading progress so saved stars are up-to-date
            const streakResult = database.processDailyStreak(user.id);
            // console.log('User authenticated, loading saved progress for userId:', user.id);
            const savedProgress = database.getPlayerByUserId(user.id);
            // console.log('Loaded saved progress:', savedProgress);

            // Calculate level, maxHealth, and damage from total XP
            const totalXP = savedProgress?.totalXP || 0;
            const level = calculateLevelFromTotalXP(totalXP);
            const currentLevelXP = calculateCurrentLevelXP(totalXP, level);
            const baseMaxHealth = calculateMaxHealthFromLevel(level);
            const baseDamage = calculateDamageFromLevel(level);

            // Determine spawn position based on selected biome
            let spawnX = 200;
            let spawnY = WORLD_HEIGHT / 2;
            
            if (credentials.spawnBiome === 'pvp') {
                // PVP arena lives outside the regular map — skip biome lookup and drop the player at the arena spawn.
                spawnX = PVP_ARENA_SPAWN_X;
                spawnY = PVP_ARENA_SPAWN_Y;
                console.log(`Player ${credentials.playerName} spawning in PVP arena`);
            } else if (credentials.spawnBiome && credentials.spawnBiome !== 'default') {
                const biomeSpawn = getSpawnPositionInBiome(credentials.spawnBiome);
                if (biomeSpawn) {
                    spawnX = biomeSpawn.x;
                    spawnY = biomeSpawn.y;
                    console.log(`Player ${credentials.playerName} spawning in ${credentials.spawnBiome} biome`);
                } else {
                    console.log(`Failed to find biome ${credentials.spawnBiome}, using default spawn`);
                }
            } else {
                // Use default spawn logic for common spawn zones
                // Helper to get section from map coordinates
                const SECTION_SIZE = 20000;
                const getSectionFromMapCoords = (x: number, y: number): number => {
                    const worldX = x * SCALE_FACTOR;
                    const worldY = y * SCALE_FACTOR;
                    const sectionX = Math.max(0, Math.min(2, Math.floor(worldX / SECTION_SIZE)));
                    const sectionY = Math.max(0, Math.min(2, Math.floor(worldY / SECTION_SIZE)));
                    return sectionY * 3 + sectionX;
                };

                const validSpawnPoints = WORLD_MAP.filter(element =>
                    element.type === 'spawn' &&
                    element.properties?.spawnType === 'common'
                );

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

                    let safeSpawnPosition: { x: number; y: number } | null = null;
                    for (const spawn of shuffledSpawnPoints) {
                        safeSpawnPosition = findSafeSpawnPosition(spawn);
                        if (safeSpawnPosition) {
                            break;
                        }
                    }

                    if (safeSpawnPosition) {
                        spawnX = safeSpawnPosition.x;
                        spawnY = safeSpawnPosition.y;
                    } else {
                        // Fallback: use random position in first spawn point (even if not completely safe)
                        console.warn('No safe spawn position found in common spawn zones, using fallback');
                        const spawn = preferredSpawnPoints[0];
                        spawnX = (spawn.x + spawn.width / 2) * SCALE_FACTOR;
                        spawnY = (spawn.y + spawn.height / 2) * SCALE_FACTOR;
                    }
                }
            }

            // Initialize skills from saved progress or defaults
            const savedSkills: { damage?: string; petalHealth?: string; playerHealth?: string; healingMultiplier?: string } = 
                (savedProgress as any)?.skills || {};
            
            // Check if TP was explicitly saved in the database
            const hasSavedTP = savedProgress && (savedProgress as any).tp !== undefined;
            const savedTP: number = hasSavedTP ? (savedProgress as any).tp : 0;
            
            // Calculate TP from level (1 TP per level)
            // Count spent TP by summing costs of unlocked tiers
            const countSpentTP = (tier: string | undefined): number => {
                if (!tier) return 0;
                const index = RARITY_LEVELS.indexOf(tier as Rarity);
                if (index < 0) return 0;
                // Sum costs from common up to this tier
                let total = 0;
                for (let i = 0; i <= index; i++) {
                    total += RARITY_TP_COSTS[RARITY_LEVELS[i]];
                }
                return total;
            };
            const spentTP = countSpentTP(savedSkills.damage) + countSpentTP(savedSkills.petalHealth) + 
                          countSpentTP(savedSkills.playerHealth) + countSpentTP(savedSkills.healingMultiplier);
            
            // Use savedTP if it was explicitly saved (authoritative), otherwise calculate from level - spentTP
            // This prevents TP duplication when refreshing/re-authenticating
            const currentTP = hasSavedTP ? savedTP : Math.max(0, level - spentTP);

            // Reconstruct loadout from saved data (only type/rarity/petalType saved)
            const reconstructLoadout = (savedLoadout: any[] | undefined): (Item | null)[] => {
                if (!savedLoadout || !Array.isArray(savedLoadout)) {
                    return createInitialBasicPetals().concat(Array(5).fill(null));
                }
                return savedLoadout.map((item: any) => {
                    if (!item || !item.type) return null;
                    if (item.type === 'petal' && item.petalType) {
                        const petalStats = getPetalStats(item.petalType, item.rarity || 'common');
                        if (petalStats) {
                            const petalHealthMultiplier = getSkillMultiplier(savedSkills.petalHealth);
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

            players[socket.id] = {
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
                inventory: savedProgress?.inventory ? dictToInventory(savedProgress.inventory as any) : createInitialInventory(),
                loadout: reconstructedLoadout,
                isInvulnerable: true,
                level: level,
                xp: currentLevelXP,
                xpToNextLevel: calculateXPRequirement(level),
                knockbackX: 0,
                knockbackY: 0,
                inputs: { keys: [] },
                speed_boost: 1,
                tp: currentTP,
                skills: savedSkills,
                mobKills: (savedProgress as any)?.mobKills || {},
                stars: (savedProgress as any)?.stars || 0,
                spawnBiome: credentials.spawnBiome || 'default',
                inPvpArena: false,
                pvpScore: 0
            };

            // If the player chose PVP from the title screen, swap to the PVP
            // loadout/inventory now (this also stashes the regular versions and
            // recalcs stats to apply the PVP-fixed max health).
            if (credentials.spawnBiome === 'pvp') {
                enterPvpArena(players[socket.id], io);
            } else {
                // Recalculate player stats with modifiers after loadout is set
                recalculatePlayerStats(players[socket.id], io);
            }

            // Start cooldown timers for all petals that are on cooldown
            const player = players[socket.id];
            if (player && player.loadout) {
                for (let i = 0; i < player.loadout.length; i++) {
                    // Secondary loadout (slots 10+) is storage only — no pets, no cooldowns.
                    if (i >= 10) break;
                    const petal = player.loadout[i];
                    if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                        const petalStats = getPetalStats(petal.petalType, petal.rarity);

                        // Spawn pets for equipped petals with petMobType (only if not on cooldown)
                        if (petalStats?.petMobType && !petal.onCooldown && petal.rarity) {
                            const petMobType = petalStats.petMobType;
                            // Pet inherits the petal's rarity
                            // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${player.id} on spawn`);
                            spawnPet(petMobType, petal.rarity, player.x, player.y, player.id, io);
                        }
                        
                        // Handle cooldown timers
                        if (petal.onCooldown && petalStats) {
                            const cooldownTime = petalStats.cooldown || 10000;
                            const timeoutKey = `${socket.id}-${i}`;
                            // Snapshot identity so a stale timer doesn't clobber a swapped slot
                            const snapshotPetalType = petal.petalType;
                            const snapshotRarity = petal.rarity;
                            const timeout = setTimeout(() => {
                                petalCooldownTimeouts.delete(timeoutKey);
                                const current = players[socket.id]?.loadout[i];
                                if (!players[socket.id] || !current || !current.onCooldown) return;
                                if (current.type !== 'petal' ||
                                    current.petalType !== snapshotPetalType ||
                                    current.rarity !== snapshotRarity) return;
                                {
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
                                    applyPetalHealthBonus(restoredPetal, players[socket.id]);
                                    players[socket.id].loadout[i] = restoredPetal;
                                    
                                    io.emit('petalRestored', {
                                        playerId: players[socket.id].id,
                                        slotIndex: i,
                                        petal: players[socket.id].loadout[i]
                                    });
                                    
                                    // Spawn pet when petal is restored (if it has petMobType)
                                    if (petalStats.petMobType && petal.rarity) {
                                        const petMobType = petalStats.petMobType;
                                        // Pet inherits the petal's rarity
                                        const restoredPlayer = players[socket.id];
                                        if (restoredPlayer && !restoredPlayer.isDead) {
                                            // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${restoredPlayer.id} when petal restored on spawn`);
                                            spawnPet(petMobType, petal.rarity, restoredPlayer.x, restoredPlayer.y, restoredPlayer.id, io);
                                        }
                                    }
                                }
                            }, cooldownTime);
                            petalCooldownTimeouts.set(timeoutKey, timeout);
                        }
                    }
                }
            }

            // Save initial state and log the result
            // console.log('Saving initial player state');
            savePlayerProgress(players[socket.id], user.id);
            
            // Trigger viewport update when new player joins
            triggerViewportUpdate();

            // Remove initial invulnerability after the specified time
            setTimeout(() => {
                if (players[socket.id]) {
                    players[socket.id].isInvulnerable = false;
                    // Notify client that invulnerability has ended
                    io.emit('playerInvulnerabilityEnded', { playerId: socket.id });
                }
            }, RESPAWN_INVULNERABILITY_TIME);

            // Send success response and game state
            socket.emit('authenticated', {
                success: true,
                player: players[socket.id]
            });

            socket.emit('dailyStreakStatus', {
                starsAwarded: streakResult.starsAwarded,
                streak: streakResult.streak,
                newDay: streakResult.newDay,
                nextClaimAtMs: streakResult.nextClaimAtMs,
                streakExpiresAtMs: streakResult.streakExpiresAtMs,
                totalStars: players[socket.id].stars
            });

            // Send the user's current guild (if any) and notify online guild members so online list refreshes.
            if (socket.username) {
                const userGuild = getGuildForUsername(socket.username);
                if (userGuild) {
                    if (players[socket.id]) players[socket.id].guildName = userGuild.name;
                    broadcastGuildUpdate(userGuild, io);
                    syncGuildToOnlineMembers([socket.username], userGuild, io);
                } else {
                    socket.emit('guildUpdate', null);
                }
            }
            
            // Send initial skills update
            socket.emit('skillsUpdated', {
                playerId: players[socket.id].id,
                tp: players[socket.id].tp || 0,
                skills: players[socket.id].skills || {}
            });

            // Send current game state
            socket.emit('currentPlayers', players);
            // Only send enemies in viewport with 200% buffer on connection
            const enemiesInViewport = getEnemiesInViewport200Percent();
            socket.emit('enemiesUpdate', enemiesInViewport);
            socket.emit('obstaclesUpdate', obstacles);
            
            // Filter items to only send ones this player is eligible for and hasn't picked up yet
            // Check if player is split and get all split player IDs
            const { splitPlayers } = require('./petal_actions');
            const originalId = socket.id.replace('_split2', '').replace('_split1', '');
            const splitState = splitPlayers.get(originalId);
            const playerIds = splitState ? [splitState.player1.id, splitState.player2.id, originalId] : [socket.id];
            
            const eligibleItems = items.filter(item => {
                // If item has eligibility list, check if this player (or any split player) is eligible
                if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                    const isEligible = playerIds.some(playerId => item.eligiblePlayers!.includes(playerId));
                    if (!isEligible) {
                        return false; // Not eligible
                    }
                }
                
                // Check if this player (or any split player) has already picked up this item
                if (item.pickedUpBy) {
                    const alreadyPickedUp = playerIds.some(playerId => item.pickedUpBy!.has(playerId));
                    if (alreadyPickedUp) {
                        return false; // Already picked up
                    }
                }
                
                return true;
            });
            socket.emit('itemsUpdate', eligibleItems);
            
            socket.emit('decorationsUpdate', decorations);
            socket.emit('sandsUpdate', sands);

            // Notify other players
            socket.broadcast.emit('newPlayer', players[socket.id]);
        } else {
            socket.emit('authenticated', {
                success: false,
                error: 'Invalid credentials'
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');

        // Clean up squad membership
        handleSquadDisconnect(socket.id, io);

        // Refresh online status for this user's guildmates (guild itself is persistent).
        if (socket.username) {
            const userGuild = getGuildForUsername(socket.username);
            if (userGuild) {
                // Delay one tick so this socket is already removed from io.sockets before recomputing online list.
                const leavingUsername = socket.username;
                setImmediate(() => {
                    const g = getGuildForUsername(leavingUsername);
                    if (g) broadcastGuildUpdate(g, io);
                });
            }
        }

        // Check if player is split and clean up both split players
        const { splitPlayers } = require('./petal_actions');
        const originalId = socket.id.replace('_split2', '').replace('_split1', '');
        const splitState = splitPlayers.get(originalId);
        
        if (splitState) {
            // Player is split - clean up both split players
            console.log(`[DISCONNECT] Cleaning up split players for ${originalId}`);
            
            // Save progress for the original player if authenticated
            if (players[originalId] && socket.userId) {
                savePlayerProgressImmediate(players[originalId], socket.userId);
            }
            
            // Clean up petal cooldown timeouts for both split players
            const splitPlayerIds = [splitState.player1.id, splitState.player2.id, originalId];
            for (const playerId of splitPlayerIds) {
                for (let i = 0; i < 10; i++) {
                    const timeoutKey = `${playerId}-${i}`;
                    const timeout = petalCooldownTimeouts.get(timeoutKey);
                    if (timeout) {
                        clearTimeout(timeout);
                        petalCooldownTimeouts.delete(timeoutKey);
                    }
                }
                
                // Clean up petalLastProjectileTime entries
                const keysToDelete: string[] = [];
                petalLastProjectileTime.forEach((value, key) => {
                    if (key.startsWith(playerId)) {
                        keysToDelete.push(key);
                    }
                });
                keysToDelete.forEach(key => petalLastProjectileTime.delete(key));
                
                // Clean up petal physics states
                cleanupPetalPhysicsStates(playerId);
                
                // Remove player from players map
                delete players[playerId];
                delete playerUserIds[playerId];
                
                // Emit playerDisconnected event for this split player
                io.emit('playerDisconnected', playerId);
            }
            
            // Despawn all pets owned by any of the split players
            for (const playerId of splitPlayerIds) {
                despawnAllPlayerPets(playerId, io);
            }

            // Remove split state
            splitPlayers.delete(originalId);
        } else {
            // Normal player - standard cleanup
            if (players[socket.id] && socket.userId) {
                // console.log('Saving player progress for userId:', socket.userId);
                savePlayerProgressImmediate(players[socket.id], socket.userId);
            }
            
            // Clean up petal cooldown timeouts for this player
            for (let i = 0; i < 10; i++) {
                const timeoutKey = `${socket.id}-${i}`;
                const timeout = petalCooldownTimeouts.get(timeoutKey);
                if (timeout) {
                    clearTimeout(timeout);
                    petalCooldownTimeouts.delete(timeoutKey);
                }
            }
            
            // Clean up petalLastProjectileTime entries for this player
            const keysToDelete: string[] = [];
            petalLastProjectileTime.forEach((value, key) => {
                if (key.startsWith(socket.id)) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(key => petalLastProjectileTime.delete(key));
            
            // Clean up petal physics states for this player
            cleanupPetalPhysicsStates(socket.id);

            // Despawn all pets owned by this player
            despawnAllPlayerPets(socket.id, io);

            delete players[socket.id];
            delete playerUserIds[socket.id]; // Clean up the mapping
        }
        
        // Remove all event listeners to prevent memory leaks
        // Socket.IO will handle cleanup, but we can be explicit for unauthenticated connections
        socket.removeAllListeners();
        
        // Only emit to authenticated players (not to unauthenticated title screen connections)
        // Note: playerDisconnected events for split players are already emitted above
        if (!splitState) {
            const authenticatedSockets = Array.from(io.sockets.sockets.values())
                .filter((s: any) => (s as AuthenticatedSocket).userId);
            if (authenticatedSockets.length > 0) {
                io.emit('playerDisconnected', socket.id);
            }
        }
        
        // Trigger viewport update when player disconnects (only if there are authenticated players)
        if (Object.keys(players).length > 0) {
            triggerViewportUpdate();
        }
    });

    socket.on('collectDot', (dotIndex: number) => {
        if (dotIndex >= 0 && dotIndex < dots.length) {
            dots.splice(dotIndex, 1);
            players[socket.id].score++;
            io.emit('dotCollected', { playerId: socket.id, dotIndex });
            // Generate a new dot
            dots.push({
                x: Math.random() * 800,
                y: Math.random() * 600
            });
        }
    });

    socket.on('useItem', (itemData: { type: string, rarity: string, petalType?: string }) => {
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
        
        const player = players[targetPlayerId];
        if (!player) return;

        // For now, we don't check if the item is in the loadout on the server,
        // we trust the client. This could be improved for security.
        const item: ItemWithRarity = {
            type: itemData.type as any,
            rarity: itemData.rarity as any,
            petalType: itemData.petalType as any,
        };

        const rarityMultipliers: Record<string, number> = {
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

        const speedBoostMultipliers: Record<string, number> = {
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
                    if (players[targetPlayerId]) {
                        players[targetPlayerId].speed_boost = 1;
                        // console.log('Speed boost wore off');
                    }
                }, 5000 * multiplier);
                break;
            case 'shield':
                player.isInvulnerable = true;
                // console.log('Applied shield effect');
                setTimeout(() => {
                    if (players[targetPlayerId]) {
                        players[targetPlayerId].isInvulnerable = false;
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
                    } else {
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
    socket.on('updateName', (newName: string) => {
        const player = players[socket.id];
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
    function validateInventoryAndLoadout(
        newInventory: PlayerInventory, 
        newLoadout: (Item | null)[], 
        oldLoadout: (Item | null)[],
        oldInventory: PlayerInventory
    ): (Item | null)[] {
        // Validate inventory structure
        if (!newInventory || !Array.isArray(newInventory)) {
            console.warn('[SERVER] Invalid inventory structure, using empty inventory');
            newInventory = [];
        }

        // Create a validated copy of the loadout
        const validatedLoadout = [...newLoadout];
        let hasChanges = false;

        // Helper function to check if an item exists in inventory
        function itemExistsInInventory(inventory: PlayerInventory, item: Item): boolean {
            if (!item.rarity) return false;

            let inventoryKey: string;
            if (item.type === 'petal') {
                if (!item.petalType) return false;
                inventoryKey = `petal_${item.petalType}`;
            } else {
                inventoryKey = item.type;
            }

            return hasItem(inventory, item.rarity, inventoryKey, 1);
        }

        // Helper function to check if an item matches (same type, rarity, petalType)
        function itemsMatch(item1: Item | null, item2: Item | null): boolean {
            if (!item1 || !item2) return false;
            if (item1.type !== item2.type) return false;
            if (item1.rarity !== item2.rarity) return false;
            if (item1.type === 'petal') {
                return item1.petalType === item2.petalType;
            }
            return true;
        }

        // Build a reservoir of available items = oldInventory + all items in oldLoadout.
        // This lets us accept swaps between loadout slots (the items *conceptually* exist,
        // just not in inventory proper).
        const reservoir: Record<string, number> = {};
        const keyOfItem = (it: Item): string | null => {
            if (!it.rarity) return null;
            if (it.type === 'petal') {
                if (!it.petalType) return null;
                return `${it.rarity}|petal_${it.petalType}`;
            }
            return `${it.rarity}|${it.type}`;
        };
        // Seed reservoir with every item in oldInventory (compact triples: [rid,iid,count,...])
        if (Array.isArray(oldInventory)) {
            for (let i = 0; i + 2 < oldInventory.length; i += 3) {
                const rid = oldInventory[i];
                const iid = oldInventory[i + 1];
                const count = oldInventory[i + 2];
                const rarity = ID_TO_RARITY.get(rid);
                const itemKey = ID_TO_ITEM_KEY.get(iid);
                if (!rarity || !itemKey) continue;
                const k = `${rarity}|${itemKey}`;
                reservoir[k] = (reservoir[k] || 0) + count;
            }
        }
        // Add every item currently in oldLoadout
        for (const it of oldLoadout || []) {
            if (!it) continue;
            const k = keyOfItem(it);
            if (!k) continue;
            reservoir[k] = (reservoir[k] || 0) + 1;
        }

        // Consume reservoir for each item in newLoadout
        validatedLoadout.forEach((item, index) => {
            if (!item) return;
            if (!item.rarity) {
                console.warn(`[SERVER] Item at slot ${index} missing rarity, unequipping`);
                validatedLoadout[index] = null;
                hasChanges = true;
                return;
            }
            const k = keyOfItem(item);
            if (!k || (reservoir[k] || 0) <= 0) {
                console.warn(`[SERVER] Item ${item.type === 'petal' ? `petal_${item.petalType}` : item.type} (${item.rarity}) not available (reservoir exhausted), unequipping`);
                validatedLoadout[index] = null;
                hasChanges = true;
                return;
            }
            reservoir[k]--;

            // If this slot didn't have this exact item before, mark a change for downstream diffing
            const oldItem = oldLoadout[index];
            if (!itemsMatch(item, oldItem)) hasChanges = true;
        });

        return validatedLoadout;
    }

    socket.on('updateLoadout', (data: { loadout: (Item | null)[]; inventory: PlayerInventory }) => {
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
        
        const player = players[targetPlayerId];
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
            const oldInventory = player.inventory || [];

            // IMPORTANT: Use server's inventory as source of truth, NOT client's
            // This prevents console-added items from being accepted
            // For split players, we need to use the shared inventory directly (not a copy)
            // If split, use the shared inventory directly; otherwise create a copy for validation
            const serverInventory = splitState ? oldInventory : [...oldInventory];
            
            // Validate inventory and loadout - unequip items that don't exist in inventory
            const validatedLoadout = validateInventoryAndLoadout(serverInventory, data.loadout, oldLoadout, serverInventory);
            
            // Calculate inventory changes based on loadout changes
            // Split into two passes so swaps between slots net out correctly:
            //   Pass 1: add every unequipped item back to inventory
            //   Pass 2: remove every newly-equipped item from inventory
            // (Doing both in a single pass can temporarily leave the inventory short
            //  during swaps, causing the removal of the other swap-partner to fail.)
            const loadoutIterationLength = Math.max(oldLoadout.length, validatedLoadout.length);
            const getInventoryKey = (item: Item | null): string | null => {
                if (!item || !item.rarity) return null;
                if (item.type === 'petal') {
                    if (!item.petalType) return null;
                    return `petal_${item.petalType}`;
                }
                return item.type;
            };
            const itemsMatch = (item1: Item | null, item2: Item | null): boolean => {
                if (!item1 || !item2) return false;
                if (item1.type !== item2.type) return false;
                if (item1.rarity !== item2.rarity) return false;
                if (item1.type === 'petal') return item1.petalType === item2.petalType;
                return true;
            };

            // Pass 1: add unequipped items back, despawn pets for removed petals
            for (let index = 0; index < loadoutIterationLength; index++) {
                const oldItem = oldLoadout[index] || null;
                const newItem = validatedLoadout[index];
                if (!oldItem) continue;
                if (newItem && itemsMatch(oldItem, newItem)) continue;

                const oldKey = getInventoryKey(oldItem);
                if (oldKey && oldItem.rarity) {
                    addItem(serverInventory, oldItem.rarity, oldKey, 1);
                }

                // If the unequipped item was a petal with petMobType, despawn all pets of that type
                // (apex eggs spawn multiple pets, so we need to clear them all)
                if (oldItem.type === 'petal' && oldItem.petalType && oldItem.rarity) {
                    const oldPetalStats = getPetalStats(oldItem.petalType, oldItem.rarity);
                    if (oldPetalStats?.petMobType) {
                        for (let i = enemies.length - 1; i >= 0; i--) {
                            const e = enemies[i];
                            if (e.ownerId === player.id && e.type === oldPetalStats.petMobType) {
                                despawnPet(e, io);
                            }
                        }
                    }
                }
            }

            // Pass 2: remove newly-equipped items from inventory
            for (let index = 0; index < loadoutIterationLength; index++) {
                const oldItem = oldLoadout[index] || null;
                const newItem = validatedLoadout[index];
                if (!newItem) continue;
                if (oldItem && itemsMatch(oldItem, newItem)) continue;

                const newKey = getInventoryKey(newItem);
                if (newKey && newItem.rarity) {
                    if (hasItem(serverInventory, newItem.rarity, newKey, 1)) {
                        removeItem(serverInventory, newItem.rarity, newKey, 1);
                    } else {
                        console.warn(`[SERVER] Attempted to equip ${newKey} (${newItem.rarity}) but it doesn't exist in inventory`);
                    }
                }
            }
            
            // Apply petal health bonuses to all petals in loadout
            validatedLoadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal') {
                    applyPetalHealthBonus(petal, player);
                    
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
                        
                        const petalStats = getPetalStats(petal.petalType, petal.rarity || 'common');
                        // console.log(`[PET DEBUG] Petal stats for ${petal.petalType}:`, petalStats ? { petMobType: petalStats.petMobType, petMobRarity: petalStats.petMobRarity } : 'null');
                        
                        if (petalStats) {
                            const cooldownTime = petalStats.cooldown || 10000;
                            // Capture targetPlayerId in closure for setTimeout
                            const targetId = targetPlayerId;
                            // Snapshot the petal identity at scheduling time so a stale timer
                            // cannot overwrite a slot that has since been swapped to a different petal.
                            const snapshotPetalType = petal.petalType;
                            const snapshotRarity = petal.rarity;
                            setTimeout(() => {
                                const current = players[targetId]?.loadout[index];
                                if (!players[targetId] || !current || !current.onCooldown) return;
                                // Only restore if the slot still holds the same petal identity
                                if (current.type !== 'petal' ||
                                    current.petalType !== snapshotPetalType ||
                                    current.rarity !== snapshotRarity) {
                                    return;
                                }
                                {
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
                                    applyPetalHealthBonus(restoredPetal, players[targetId]);
                                    players[targetId].loadout[index] = restoredPetal;
                                    
                                    io.emit('petalRestored', {
                                        playerId: players[targetId].id,
                                        slotIndex: index,
                                        petal: players[targetId].loadout[index]
                                    });
                                    
                                    // Check if this petal should spawn a pet when restored
                                    // Get fresh petal stats to ensure we have the latest petMobType
                                    if (restoredPetal.petalType && restoredPetal.rarity) {
                                        const restoredPetalStats = getPetalStats(restoredPetal.petalType, restoredPetal.rarity);
                                        // console.log(`[PET DEBUG] Restored petal stats:`, restoredPetalStats ? { petMobType: restoredPetalStats.petMobType, petMobRarity: restoredPetalStats.petMobRarity } : 'null');
                                        if (restoredPetalStats?.petMobType && restoredPetal.rarity) {
                                            const petMobType = restoredPetalStats.petMobType;
                                            // Pet inherits the petal's rarity
                                            const player = players[targetPlayerId];
                                            if (player && !player.isDead) {
                                                // console.log(`[PET] Spawning pet ${petMobType} (${restoredPetal.rarity}) for player ${player.id} when petal restored`);
                                                spawnPet(petMobType, restoredPetal.rarity, player.x, player.y, player.id, io);
                                            } else {
                                                // console.log(`[PET DEBUG] Player check failed: player=${!!player}, isDead=${player?.isDead}`);
                                            }
                                        } else {
                                            // console.log(`[PET DEBUG] No petMobType in restored petal stats`);
                                        }
                                    } else {
                                        // console.log(`[PET DEBUG] Missing petalType or rarity: petalType=${restoredPetal.petalType}, rarity=${restoredPetal.rarity}`);
                                    }
                                }
                            }, cooldownTime);
                        }
                    }
                    
                    // Check if this petal should spawn a pet when first equipped (spawn immediately)
                    if (isNewPetal && petal.petalType) {
                        const petalStatsForSpawn = getPetalStats(petal.petalType, petal.rarity || 'common');
                        // console.log(`[PET DEBUG] Checking for immediate spawn: petalStatsForSpawn=`, petalStatsForSpawn ? { petMobType: petalStatsForSpawn.petMobType, petMobRarity: petalStatsForSpawn.petMobRarity } : 'null');
                        if (petalStatsForSpawn?.petMobType && petal.rarity) {
                            const petMobType = petalStatsForSpawn.petMobType;
                            // Pet inherits the petal's rarity
                            
                            // Spawn pet immediately when petal is first equipped
                            const player = players[targetPlayerId];
                            // console.log(`[PET DEBUG] Player check: player=`, !!player, `isDead=`, player?.isDead);
                            if (player && !player.isDead) {
                                // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${player.id} when petal equipped`);
                                spawnPet(petMobType, petal.rarity, player.x, player.y, player.id, io);
                            } else {
                                // console.log(`[PET DEBUG] Failed to spawn: player=${!!player}, isDead=${player?.isDead}`);
                            }
                        } else {
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
                } else if (splitState.player2.id === socket.id) {
                    splitState.player1.inventory = serverInventory;
                }
            }
            
            // Recalculate player stats based on equipped petal modifiers
            recalculatePlayerStats(player, io);

            // Only the player needs their own loadout update
            socket.emit('playerUpdated', player);

            // Persist to DB so title-screen edits survive re-authentication when the game starts
            if (socket.userId) {
                savePlayerProgressImmediate(player, socket.userId);
            }
        }
    });

    // Add after other imports
    interface ChatMessage {
        sender: string;
        content: string;
        timestamp: number;
    }

    // Add to class-level variables after other declarations
    const chatHistory: ChatMessage[] = [];
    const MAX_CHAT_HISTORY = 100;  // Keep last 100 messages

    // Add this inside the socket.io connection handler (after other socket handlers)
    socket.on('chatMessage', (message: string) => {
        if (!socket.username) return;  // Ensure user is authenticated

        // Check for admin commands
        if (handleAdminCommand(message, socket, io, commandDeps)) {
                return; // Don't process as regular chat message
        }

        // Normalize hyphenated squad commands to the space form so a single parser handles both.
        // /squad-find-public -> /squad find-public, /squad-invite -> /squad invite, etc.
        let normalizedMessage = message;
        if (normalizedMessage.startsWith('/squad-find-public')) {
            normalizedMessage = '/squad find-public' + normalizedMessage.substring('/squad-find-public'.length);
        } else {
            const squadDashMatch = normalizedMessage.match(/^\/squad-([a-z]+)(\s|$)/i);
            if (squadDashMatch) {
                normalizedMessage = `/squad ${squadDashMatch[1]}${normalizedMessage.substring(squadDashMatch[0].length - squadDashMatch[2].length)}`;
            }
        }

        // Check for squad commands
        if (normalizedMessage.startsWith('/squad ') || normalizedMessage === '/squad') {
            const args = normalizedMessage.substring('/squad'.length).trim().split(/\s+/);
            const subCommand = (args[0] || '').toLowerCase();

            if (subCommand === 'create') {
                const visibility = (args[1] || '').toLowerCase();
                const isPublic = visibility === 'public';
                const squad = createSquad(socket.id, isPublic);
                if (!squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are already in a squad.', timestamp: Date.now() });
                } else {
                    const player = players[socket.id];
                    if (player) player.squadId = squad.id;
                    io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                    const label = isPublic ? 'public' : 'private';
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">${label} squad created! Use /squad-invite &lt;username&gt; to invite players${isPublic ? ', or wait for others to join via /squad-find-public' : ''}.</span>`, timestamp: Date.now() });
                }
            } else if ((subCommand === 'invite') && args[1]) {
                const targetUsername = args[1];
                // Try human first, then bot by display name.
                let targetId: string | null = findPlayerByUsername(targetUsername, io);
                let targetIsBot = false;
                if (!targetId) {
                    const botId = findBotByName(targetUsername);
                    if (botId) {
                        targetId = botId;
                        targetIsBot = true;
                    }
                }

                if (!targetId) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: `Player "${targetUsername}" not found.`, timestamp: Date.now() });
                } else if (targetId === socket.id) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You cannot invite yourself.', timestamp: Date.now() });
                } else if (targetIsBot) {
                    // Bots skip the invite flow and join directly.
                    const squad = getSquadForPlayer(socket.id);
                    if (!squad) {
                        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad. Use /squad create first.', timestamp: Date.now() });
                    } else if (squad.leaderId !== socket.id) {
                        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Only the squad leader can invite players.', timestamp: Date.now() });
                    } else {
                        const { error } = addBotToSquad(squad.id, targetId);
                        if (error) {
                            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
                        } else {
                            const botPlayer = players[targetId];
                            if (botPlayer) botPlayer.squadId = squad.id;
                            sendSquadSystemMessage(squad, io, `${botPlayer ? botPlayer.name : targetUsername} has joined the squad.`);
                            for (const memberId of squad.memberIds) {
                                if (memberId.startsWith('bot_')) continue;
                                io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                            }
                        }
                    }
                } else {
                    const error = inviteToSquad(socket.id, targetId, socket.username);
                    if (error) {
                        io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
                    } else {
                        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
                        io.to(targetId).emit('squadInviteReceived', { fromUsername: socket.username });
                        io.to(targetId).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} has invited you to their squad. Use /squad accept or /squad decline.</span>`, timestamp: Date.now() });
                    }
                }
            } else if (subCommand === 'find-public') {
                const publicSquads = listPublicSquads();
                if (publicSquads.length === 0) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'No public squads available. Create one with /squad create public.', timestamp: Date.now() });
                } else {
                    const lines = publicSquads.map(sq => {
                        const leader = players[sq.leaderId];
                        const leaderName = leader ? leader.name : 'Unknown';
                        return `${sq.id} &mdash; leader: ${leaderName} (${sq.memberIds.length}/${MAX_SQUAD_SIZE}) [/squad-join ${sq.id}]`;
                    });
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Public squads:<br/>${lines.join('<br/>')}</span>`, timestamp: Date.now() });
                }
            } else if (subCommand === 'join' && args[1]) {
                const { squad, error } = joinPublicSquad(args[1], socket.id);
                if (error || !squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to join squad.', timestamp: Date.now() });
                } else {
                    const player = players[socket.id];
                    if (player) player.squadId = squad.id;
                    const playerName = player ? player.name : socket.username;
                    sendSquadSystemMessage(squad, io, `${playerName} has joined the squad.`);
                    for (const memberId of squad.memberIds) {
                        if (memberId.startsWith('bot_')) continue;
                        io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                    }
                }
            } else if (subCommand === 'public' || subCommand === 'private') {
                const { squad, error } = setSquadVisibility(socket.id, subCommand === 'public');
                if (error || !squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to update squad.', timestamp: Date.now() });
                } else {
                    sendSquadSystemMessage(squad, io, `Squad is now ${subCommand}.`);
                }
            } else if (subCommand === 'accept') {
                const { squad, error } = acceptInvite(socket.id);
                if (error) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
                } else {
                    const player = players[socket.id];
                    if (player) player.squadId = squad.id;
                    const playerName = player ? player.name : socket.username;
                    sendSquadSystemMessage(squad, io, `${playerName} has joined the squad.`);
                    for (const memberId of squad.memberIds) {
                        io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                    }
                }
            } else if (subCommand === 'decline') {
                declineInvite(socket.id);
                io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Squad invite declined.', timestamp: Date.now() });
            } else if (subCommand === 'leave') {
                const squad = getSquadForPlayer(socket.id);
                if (!squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
                } else {
                    const player = players[socket.id];
                    const playerName = player ? player.name : socket.username;
                    if (player) player.squadId = undefined;
                    const membersBefore = [...squad.memberIds];
                    leaveSquadFn(socket.id, io);
                    io.to(socket.id).emit('squadUpdate', null);
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You have left the squad.', timestamp: Date.now() });
                    // Notify remaining members
                    const remainingId = membersBefore.find(id => id !== socket.id);
                    if (remainingId) {
                        const remainingSquad = getSquadForPlayer(remainingId);
                        if (remainingSquad) {
                            sendSquadSystemMessage(remainingSquad, io, `${playerName} has left the squad.`);
                            for (const memberId of remainingSquad.memberIds) {
                                io.to(memberId).emit('squadUpdate', { squadId: remainingSquad.id, memberIds: remainingSquad.memberIds, leaderId: remainingSquad.leaderId });
                            }
                        }
                    }
                }
            } else if (subCommand === 'info') {
                const squad = getSquadForPlayer(socket.id);
                if (!squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
                } else {
                    const memberNames = squad.memberIds.map(id => {
                        const p = players[id];
                        const isBotMember = id.startsWith('bot_');
                        const s = io.sockets.sockets.get(id) as any;
                        const name = p ? p.name : 'Unknown';
                        const username = isBotMember ? name : (s?.username || 'Unknown');
                        const isLeader = id === squad.leaderId ? ' (Leader)' : '';
                        return `@${username} [${name}]${isLeader}`;
                    });
                    const visibility = squad.isPublic ? 'public' : 'private';
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Squad ${squad.id} [${visibility}] (${squad.memberIds.length}/${MAX_SQUAD_SIZE}):<br/>${memberNames.join('<br/>')}</span>`, timestamp: Date.now() });
                }
            } else {
                io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Squad commands: /squad-create [public|private], /squad-invite &lt;username&gt;, /squad-find-public, /squad-join &lt;squadId&gt;, /squad-public, /squad-private, /squad-accept, /squad-decline, /squad-leave, /squad-info', timestamp: Date.now() });
            }
            return;
        }

        // Normalize hyphenated guild commands to the space form (mirrors the squad approach).
        let normalizedGuildMessage = message;
        const guildDashMatch = normalizedGuildMessage.match(/^\/guild-([a-z]+)(\s|$)/i);
        if (guildDashMatch) {
            normalizedGuildMessage = `/guild ${guildDashMatch[1]}${normalizedGuildMessage.substring(guildDashMatch[0].length - guildDashMatch[2].length)}`;
        }

        if (normalizedGuildMessage.startsWith('/guild ') || normalizedGuildMessage === '/guild') {
            if (!socket.username) return;
            const args = normalizedGuildMessage.substring('/guild'.length).trim().split(/\s+/);
            const subCommand = (args[0] || '').toLowerCase();
            const emitSystem = (content: string) => io.to(socket.id).emit('chatMessage', { sender: 'System', content, timestamp: Date.now() });

            if (subCommand === 'create') {
                const guildName = args.slice(1).join(' ').trim();
                if (!guildName) {
                    emitSystem('Usage: /guild-create &lt;name&gt;');
                } else {
                    const { guild, error } = createGuild(socket.username, guildName);
                    if (error || !guild) {
                        emitSystem(error || 'Failed to create guild.');
                    } else {
                        emitSystem(`<span style="color: #ffb74d;">Guild "${guild.name}" created. Use /guild-invite &lt;username&gt; to invite players.</span>`);
                        syncGuildToOnlineMembers([socket.username], guild, io);
                        broadcastGuildUpdate(guild, io);
                    }
                }
            } else if (subCommand === 'invite' && args[1]) {
                const { guild, error } = inviteToGuild(socket.username, args[1]);
                if (error || !guild) {
                    emitSystem(error || 'Failed to invite.');
                } else {
                    emitSystem(`<span style="color: #ffb74d;">Guild invite sent to ${args[1]}.</span>`);
                    const targetSid = findGuildSocketIdByUsername(args[1], io);
                    if (targetSid) {
                        io.to(targetSid).emit('guildInviteReceived', { guildName: guild.name, fromUsername: socket.username });
                        io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">@${socket.username} has invited you to guild "${guild.name}". Use /guild-accept or /guild-decline.</span>`, timestamp: Date.now() });
                    }
                }
            } else if (subCommand === 'accept') {
                const { guild, error } = acceptGuildInvite(socket.username);
                if (error || !guild) {
                    emitSystem(error || 'Failed to accept invite.');
                } else {
                    sendGuildSystemMessage(guild, io, `${socket.username} has joined the guild.`);
                    syncGuildToOnlineMembers([socket.username], guild, io);
                    broadcastGuildUpdate(guild, io);
                }
            } else if (subCommand === 'decline') {
                declineGuildInvite(socket.username);
                emitSystem('Guild invite declined.');
            } else if (subCommand === 'leave') {
                const existed = getGuildForUsername(socket.username);
                const leavingUsername = socket.username;
                const { guild, disbanded, promotedTo, error } = leaveGuildFn(socket.username);
                if (error) {
                    emitSystem(error);
                } else {
                    emitSystem('You have left the guild.');
                    socket.emit('guildUpdate', null);
                    syncGuildToOnlineMembers([leavingUsername], null, io);
                    if (disbanded) {
                        // nothing more to do
                    } else if (guild) {
                        sendGuildSystemMessage(guild, io, `${socket.username} has left the guild.`);
                        if (promotedTo) {
                            sendGuildSystemMessage(guild, io, `${promotedTo} is now the guild leader.`);
                        }
                        broadcastGuildUpdate(guild, io);
                    }
                    // silence unused var warning for narrowing
                    void existed;
                }
            } else if (subCommand === 'kick' && args[1]) {
                const target = args[1];
                const { guild, error } = kickFromGuild(socket.username, target);
                if (error || !guild) {
                    emitSystem(error || 'Failed to kick.');
                } else {
                    sendGuildSystemMessage(guild, io, `${target} was kicked from the guild by ${socket.username}.`);
                    const targetSid = findGuildSocketIdByUsername(target, io);
                    if (targetSid) {
                        io.to(targetSid).emit('guildUpdate', null);
                        io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">You were kicked from guild "${guild.name}".</span>`, timestamp: Date.now() });
                    }
                    syncGuildToOnlineMembers([target], null, io);
                    broadcastGuildUpdate(guild, io);
                }
            } else if (subCommand === 'info') {
                const guild = getGuildForUsername(socket.username);
                if (!guild) {
                    emitSystem('You are not in a guild.');
                } else {
                    const payload = buildGuildUpdate(guild, io);
                    const onlineSet = new Set(payload.onlineUsernames.map(u => u.toLowerCase()));
                    const lines = guild.memberUsernames.map(u => {
                        const isLeader = u.toLowerCase() === guild.leaderUsername.toLowerCase();
                        const online = onlineSet.has(u.toLowerCase());
                        const dot = online ? '<span style="color: #6eff6e;">&#9679;</span>' : '<span style="color: #888;">&#9679;</span>';
                        return `${dot} @${u}${isLeader ? ' <span style="color: #ffd54f;">(Leader)</span>' : ''}`;
                    });
                    emitSystem(`<span style="color: #ffb74d;">Guild "${guild.name}" (${guild.memberUsernames.length}/${MAX_GUILD_SIZE}):<br/>${lines.join('<br/>')}</span>`);
                }
            } else if (subCommand === 'squad') {
                // Form a squad from online guildmates. Leader becomes squad leader; invites are sent to others.
                const guild = getGuildForUsername(socket.username);
                if (!guild) {
                    emitSystem('You are not in a guild.');
                } else {
                    let squad = getSquadForPlayer(socket.id);
                    if (!squad) {
                        squad = createSquad(socket.id, false);
                        if (squad) {
                            const player = players[socket.id];
                            if (player) player.squadId = squad.id;
                            io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                        }
                    }
                    if (!squad) {
                        emitSystem('Failed to create a squad.');
                    } else if (squad.leaderId !== socket.id) {
                        emitSystem('Only your squad leader can invite guildmates into the squad.');
                    } else {
                        let invited = 0;
                        for (const member of guild.memberUsernames) {
                            if (member.toLowerCase() === socket.username.toLowerCase()) continue;
                            if (squad.memberIds.length + 1 /* pending */ >= MAX_SQUAD_SIZE) break;
                            const sid = findGuildSocketIdByUsername(member, io);
                            if (!sid) continue;
                            const err = inviteToSquad(socket.id, sid, socket.username);
                            if (!err) {
                                invited++;
                                io.to(sid).emit('squadInviteReceived', { fromUsername: socket.username });
                                io.to(sid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
                            }
                        }
                        if (invited === 0) {
                            emitSystem('No online guildmates available to invite (or squad is full).');
                        } else {
                            emitSystem(`<span style="color: #ffb74d;">Sent squad invites to ${invited} online guildmate(s).</span>`);
                        }
                    }
                }
            } else if (subCommand === 'squad-invite' && args[1]) {
                // Invite a single guild member to your squad (UI button uses socket event instead).
                const targetUsername = args[1];
                const guild = getGuildForUsername(socket.username);
                if (!guild || !guild.memberUsernames.some(u => u.toLowerCase() === targetUsername.toLowerCase())) {
                    emitSystem(`${targetUsername} is not in your guild.`);
                } else {
                    const targetSid = findGuildSocketIdByUsername(targetUsername, io);
                    if (!targetSid) {
                        emitSystem(`${targetUsername} is offline.`);
                    } else {
                        let squad = getSquadForPlayer(socket.id);
                        if (!squad) {
                            squad = createSquad(socket.id, false);
                            if (squad) {
                                const player = players[socket.id];
                                if (player) player.squadId = squad.id;
                                io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                            }
                        }
                        if (!squad) {
                            emitSystem('Failed to create a squad.');
                        } else {
                            const err = inviteToSquad(socket.id, targetSid, socket.username);
                            if (err) emitSystem(err);
                            else {
                                emitSystem(`<span style="color: #4fc3f7;">Squad invite sent to ${targetUsername}.</span>`);
                                io.to(targetSid).emit('squadInviteReceived', { fromUsername: socket.username });
                                io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
                            }
                        }
                    }
                }
            } else if (subCommand === 'list') {
                const all = listGuilds();
                if (all.length === 0) {
                    emitSystem('No guilds exist yet.');
                } else {
                    const lines = all.map(g => `"${g.name}" — ${g.memberUsernames.length}/${MAX_GUILD_SIZE} — leader @${g.leaderUsername}`);
                    emitSystem(`<span style="color: #ffb74d;">Guilds:<br/>${lines.join('<br/>')}</span>`);
                }
            } else {
                emitSystem('Guild commands: /guild-create &lt;name&gt;, /guild-invite &lt;username&gt;, /guild-accept, /guild-decline, /guild-leave, /guild-kick &lt;username&gt;, /guild-info, /guild-squad, /guild-list');
            }
            return;
        }

        // Check for guild chat shorthand: /g <message>
        if (message.startsWith('/g ')) {
            if (!socket.username) return;
            const guildMsg = message.substring(3).trim();
            if (guildMsg) {
                const guild = getGuildForUsername(socket.username);
                if (!guild) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a guild.', timestamp: Date.now() });
                } else {
                    const player = players[socket.id];
                    const playerName = player ? player.name : socket.username;
                    sendGuildChatMessage(guild, io, socket.username, playerName, guildMsg);
                }
            }
            return;
        }

        // Check for squad chat shorthand: /s <message>
        if (message.startsWith('/s ')) {
            const squadMsg = message.substring(3).trim();
            if (squadMsg) {
                const squad = getSquadForPlayer(socket.id);
                if (!squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
                } else {
                    const player = players[socket.id];
                    const playerName = player ? player.name : socket.username;
                    sendSquadChatMessage(squad, io, socket.username, playerName, squadMsg);
                }
            }
            return;
        }

        // Check for commands
        if (message.startsWith('/')) {
            const command = message.substring(1).toLowerCase();

            if (command === 'help') {
                const isAdmin = socket.username ? database.isUserAdmin(socket.username) : false;
                let helpText = 'Available commands:\n';
                helpText += '/list_ultra - List all ultra mobs <br/>';
                helpText += '/list_super - List all super mobs <br/>';
                helpText += '/list_unique - List all unique mobs <br/>';
                helpText += '/biome - Show the most populated biome <br/>';
                helpText += '/level-from-string &lt;name&gt; - Show what level a bot named &lt;name&gt; would roll <br/>';
                helpText += '/loadout-from-string &lt;name&gt; - Show the loadout a bot named &lt;name&gt; would roll <br/>';
                helpText += '/create-api-key [label] - Issue an API key tied to your account for /api/v1/* <br/>';
                helpText += '/delete-api-key &lt;key-or-prefix&gt; - Revoke one of your API keys <br/>';
                helpText += '<br/><b>Squad commands (groups of 4, share loot as one instance):</b><br/>';
                helpText += '/squad-create [public|private] - Create a new squad (defaults to private)<br/>';
                helpText += '/squad-invite &lt;username&gt; - Invite a player to your squad<br/>';
                helpText += '/squad-find-public - List joinable public squads<br/>';
                helpText += '/squad-join &lt;squadId&gt; - Join a public squad<br/>';
                helpText += '/squad-public / /squad-private - Toggle your squad\'s visibility (leader only)<br/>';
                helpText += '/squad-accept / /squad-decline - Respond to an invite<br/>';
                helpText += '/squad-leave - Leave your squad<br/>';
                helpText += '/squad-info - Show squad members<br/>';
                helpText += '/s &lt;message&gt; - Send a message to your squad<br/>';
                helpText += '<br/><b>Guild commands (up to 200 members, persistent):</b><br/>';
                helpText += '/guild-create &lt;name&gt; - Create a new guild (5-char alphanumeric ID)<br/>';
                helpText += '/guild-invite &lt;username&gt; - Invite a player (leader only)<br/>';
                helpText += '/guild-accept / /guild-decline - Respond to a guild invite<br/>';
                helpText += '/guild-leave - Leave your guild<br/>';
                helpText += '/guild-kick &lt;username&gt; - Kick a member (leader only)<br/>';
                helpText += '/guild-info - Show guild info<br/>';
                helpText += '/guild-squad - Invite online guildmates into a squad<br/>';
                helpText += '/guild-list - List all guilds<br/>';
                helpText += '/guild-menu - Toggle guild menu panel (client, also "G" key)<br/>';
                helpText += '/g &lt;message&gt; - Send a message to your guild<br/>';
                helpText += '<br/>Chat supports HTML tags: <b>bold</b>, <i>italic</i>, <u>underline</u>, <span style="color: red">colored text</span>, <blink>blinking text</blink>';
                
                if (isAdmin) {
                    helpText += getAdminHelpText();
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
                const ultraMobs = enemies.filter(e => e.tier === 'ultra' && e.type !== 'target_dummy');
                if (ultraMobs.length === 0) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No ultra mobs currently spawned.',
                        timestamp: Date.now()
                    });
                } else {
                    ultraMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / SCALE_FACTOR);
                        const y = Math.round(mob.y / SCALE_FACTOR);
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
                const superMobs = enemies.filter(e => e.tier === 'super' && e.type !== 'target_dummy');
                if (superMobs.length === 0) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No super mobs currently spawned.',
                        timestamp: Date.now()
                    });
                } else {
                    superMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / SCALE_FACTOR);
                        const y = Math.round(mob.y / SCALE_FACTOR);
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
                const uniqueMobs = enemies.filter(e => e.tier === 'unique' && e.type !== 'target_dummy');
                if (uniqueMobs.length === 0) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No unique mobs currently spawned.',
                        timestamp: Date.now()
                    });
                } else {
                    uniqueMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / SCALE_FACTOR);
                        const y = Math.round(mob.y / SCALE_FACTOR);
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
            
            if (command === 'biome') {
                // Count players/bots per section (3x3 grid, 20000px each).
                // Mirrors getSectionAtPosition in src/graphics/sections.ts.
                const SECTION_SIZE = 20000;
                const counts = new Map<number, number>();
                for (const pid in players) {
                    const p = players[pid];
                    if (!p || p.isDead) continue;
                    const sx = Math.max(0, Math.min(2, Math.floor(p.x / SECTION_SIZE)));
                    const sy = Math.max(0, Math.min(2, Math.floor(p.y / SECTION_SIZE)));
                    const idx = sy * 3 + sx;
                    counts.set(idx, (counts.get(idx) ?? 0) + 1);
                }

                if (counts.size === 0) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No players are currently in any section.',
                        timestamp: Date.now()
                    });
                } else {
                    const sectionLabel = (idx: number) =>
                        SECTION_CONFIGS[idx]?.name || `Section ${idx + 1}`;
                    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
                    const [topIdx, topCount] = sorted[0];
                    const breakdown = sorted
                        .map(([idx, count]) => `${sectionLabel(idx)}: ${count}`)
                        .join('<br/>');
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: `<span style="color: #4fc3f7;">Most populated biome: <b>${sectionLabel(topIdx)}</b> (${topCount} player${topCount === 1 ? '' : 's'})</span><br/>${breakdown}`,
                        timestamp: Date.now()
                    });
                }
                return;
            }

            if (command === 'delete-api-key' || command.startsWith('delete-api-key ')) {
                if (!socket.username) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'You must be logged in to delete an API key.',
                        timestamp: Date.now()
                    });
                    return;
                }
                const spaceIdx = message.indexOf(' ');
                const arg = spaceIdx === -1 ? '' : message.substring(spaceIdx + 1).trim();
                if (!arg) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'Usage: /delete-api-key &lt;key-or-prefix&gt;',
                        timestamp: Date.now()
                    });
                    return;
                }
                // Only operate on keys owned by this user; an admin still has to use
                // an out-of-band path (editing inventory.json) to remove someone
                // else's key, so this command can never escalate across users.
                const ownedKeys = database.getAllApiKeys().filter(k => k.username === socket.username);
                let target = ownedKeys.find(k => k.key === arg);
                if (!target) {
                    const prefixMatches = ownedKeys.filter(k => k.key.startsWith(arg));
                    if (prefixMatches.length === 1) {
                        target = prefixMatches[0];
                    } else if (prefixMatches.length > 1) {
                        io.to(socket.id).emit('chatMessage', {
                            sender: 'System',
                            content: `Prefix "${arg}" is ambiguous — matches ${prefixMatches.length} of your keys. Provide more characters.`,
                            timestamp: Date.now()
                        });
                        return;
                    }
                }
                if (!target) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No API key of yours matched that key or prefix.',
                        timestamp: Date.now()
                    });
                    return;
                }
                database.deleteApiKey(target.key);
                io.to(socket.id).emit('chatMessage', {
                    sender: 'System',
                    content: `Deleted API key "${target.label}" (${target.key.substring(0, 10)}...).`,
                    timestamp: Date.now()
                });
                return;
            }

            if (command === 'create-api-key' || command.startsWith('create-api-key ')) {
                if (!socket.username) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'You must be logged in to create an API key.',
                        timestamp: Date.now()
                    });
                    return;
                }
                const spaceIdx = message.indexOf(' ');
                const label = spaceIdx === -1 ? socket.username : message.substring(spaceIdx + 1).trim() || socket.username;
                // 64 random alphanumeric chars after the sk_ prefix.
                let body = '';
                while (body.length < 64) {
                    body += Math.random().toString(36).substring(2);
                }
                const key = `sk_${body.substring(0, 64)}`;
                const entry: ApiKey = {
                    key,
                    username: socket.username,
                    label,
                    createdAt: Date.now()
                };
                database.saveApiKey(entry);
                const isAdmin = database.isUserAdmin(socket.username);
                const scopeNote = isAdmin
                    ? 'Your account is admin, so this key has admin scope (can create star codes, broadcast notifications, etc.).'
                    : 'Your account is not admin, so this key has user scope only (read events, whoami). Admin endpoints will return 403.';
                io.to(socket.id).emit('chatMessage', {
                    sender: 'System',
                    content: `<b>[API KEY CREATED]</b><br/>Label: ${label}<br/>Key: <b>${key}</b><br/>Send this on requests as the X-API-Key header, or append ?api_key=&lt;key&gt; to the URL. Save it now — the full key is not shown again.<br/>${scopeNote}`,
                    timestamp: Date.now()
                });
                return;
            }

            if (command.startsWith('level-from-string')) {
                const spaceIdx = message.indexOf(' ');
                const name = spaceIdx === -1 ? '' : message.substring(spaceIdx + 1).trim();
                if (!name) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'Usage: /level-from-string &lt;name&gt;',
                        timestamp: Date.now()
                    });
                } else {
                    const level = getBotLevelForName(name);
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: `"${name}" would be level ${level}.`,
                        timestamp: Date.now()
                    });
                }
                return;
            }

            if (command.startsWith('loadout-from-string')) {
                const spaceIdx = message.indexOf(' ');
                const name = spaceIdx === -1 ? '' : message.substring(spaceIdx + 1).trim();
                if (!name) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'Usage: /loadout-from-string &lt;name&gt;',
                        timestamp: Date.now()
                    });
                } else {
                    const loadout = getBotLoadoutForName(name);
                    const lines = loadout.map((item: any, i: number) =>
                        `Slot ${i + 1}: ${item.rarity} ${item.petalType}`
                    );
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: `"${name}" loadout:<br/>${lines.join('<br/>')}`,
                        timestamp: Date.now()
                    });
                }
                return;
            }

            // Unknown command
            io.to(socket.id).emit('chatMessage', {
                sender: 'System',
                content: 'Unknown command. Available commands: /list_ultra, /list_super, /list_unique, /biome, /level-from-string, /loadout-from-string, /create-api-key, /delete-api-key',
                timestamp: Date.now()
            });
            return;
        }

        const player = players[socket.id];
        const playerName = player ? player.name : socket.username;
        
        const chatMessage: ChatMessage = {
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

        // Trigger a bot raid if the message mentions a raid-eligible boss tier.
        // Only supers and uniques count — never ultras. triggerBotRaid picks
        // the actual target (uniques preferred) or no-ops if none exist.
        if (/\b(super|unique)\b/i.test(message)) {
            const target = triggerBotRaid();
            if (target) {
                // io.emit('chatMessage', {
                //     sender: 'System',
                //     content: `<span style="color: #ff8866;">Bots are raiding a ${target.tier}!</span>`,
                //     timestamp: Date.now()
                // });
            }
        }
    });

    // Add this after socket handlers but before socket.on('authenticate'...)
    socket.on('requestChatHistory', () => {
        socket.emit('chatHistory', chatHistory);
    });

    // --- Squad events ---
    socket.on('squadCreate', () => {
        if (!socket.username) return;
        const squad = createSquad(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are already in a squad.', timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        if (player) player.squadId = squad.id;
        io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: '<span style="color: #4fc3f7;">Squad created! Use /squad invite &lt;username&gt; to invite players.</span>', timestamp: Date.now() });
    });

    socket.on('squadInvite', (targetUsername: string) => {
        if (!socket.username) return;
        const targetSocketId = findPlayerByUsername(targetUsername, io);
        if (!targetSocketId) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `Player "${targetUsername}" not found.`, timestamp: Date.now() });
            return;
        }
        if (targetSocketId === socket.id) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You cannot invite yourself.', timestamp: Date.now() });
            return;
        }
        const error = inviteToSquad(socket.id, targetSocketId, socket.username);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        io.to(targetSocketId).emit('squadInviteReceived', { fromUsername: socket.username });
        io.to(targetSocketId).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} has invited you to their squad. Use /squad accept or /squad decline.</span>`, timestamp: Date.now() });
    });

    socket.on('squadAccept', () => {
        if (!socket.username) return;
        const { squad, error } = acceptInvite(socket.id);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        if (player) player.squadId = squad.id;
        const playerName = player ? player.name : socket.username;
        sendSquadSystemMessage(squad, io, `${playerName} has joined the squad.`);
        // Send squad update to all members
        for (const memberId of squad.memberIds) {
            io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
        }
    });

    socket.on('squadDecline', () => {
        if (!socket.username) return;
        declineInvite(socket.id);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Squad invite declined.', timestamp: Date.now() });
    });

    socket.on('squadLeave', () => {
        if (!socket.username) return;
        const squad = getSquadForPlayer(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        const playerName = player ? player.name : socket.username;
        if (player) player.squadId = undefined;

        leaveSquadFn(socket.id, io);
        io.to(socket.id).emit('squadUpdate', null);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You have left the squad.', timestamp: Date.now() });

        // Notify remaining members
        const remainingSquad = getSquadForPlayer(squad.memberIds.find(id => id !== socket.id) || '');
        if (remainingSquad) {
            sendSquadSystemMessage(remainingSquad, io, `${playerName} has left the squad.`);
            for (const memberId of remainingSquad.memberIds) {
                io.to(memberId).emit('squadUpdate', { squadId: remainingSquad.id, memberIds: remainingSquad.memberIds, leaderId: remainingSquad.leaderId });
            }
        }
    });

    // --- Guild events (also triggerable by /guild-* chat commands, but exposed directly for the UI menu) ---
    socket.on('guildCreate', (name: string) => {
        if (!socket.username) return;
        const { guild, error } = createGuild(socket.username, typeof name === 'string' ? name : '');
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to create guild.', timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">Guild "${guild.name}" created.</span>`, timestamp: Date.now() });
        syncGuildToOnlineMembers([socket.username], guild, io);
        broadcastGuildUpdate(guild, io);
    });

    socket.on('guildInvite', (targetUsername: string) => {
        if (!socket.username || typeof targetUsername !== 'string') return;
        const { guild, error } = inviteToGuild(socket.username, targetUsername);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to invite.', timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">Guild invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        const targetSid = findGuildSocketIdByUsername(targetUsername, io);
        if (targetSid) {
            io.to(targetSid).emit('guildInviteReceived', { guildName: guild.name, fromUsername: socket.username });
            io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">@${socket.username} has invited you to guild "${guild.name}". Use /guild-accept or /guild-decline.</span>`, timestamp: Date.now() });
        }
    });

    socket.on('guildAccept', () => {
        if (!socket.username) return;
        const { guild, error } = acceptGuildInvite(socket.username);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to accept invite.', timestamp: Date.now() });
            return;
        }
        sendGuildSystemMessage(guild, io, `${socket.username} has joined the guild.`);
        syncGuildToOnlineMembers([socket.username], guild, io);
        broadcastGuildUpdate(guild, io);
    });

    socket.on('guildDecline', () => {
        if (!socket.username) return;
        declineGuildInvite(socket.username);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Guild invite declined.', timestamp: Date.now() });
    });

    socket.on('guildLeave', () => {
        if (!socket.username) return;
        const leavingUsername = socket.username;
        const { guild, disbanded, promotedTo, error } = leaveGuildFn(socket.username);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('guildUpdate', null);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You have left the guild.', timestamp: Date.now() });
        syncGuildToOnlineMembers([leavingUsername], null, io);
        if (!disbanded && guild) {
            sendGuildSystemMessage(guild, io, `${socket.username} has left the guild.`);
            if (promotedTo) sendGuildSystemMessage(guild, io, `${promotedTo} is now the guild leader.`);
            broadcastGuildUpdate(guild, io);
        }
    });

    socket.on('guildKick', (targetUsername: string) => {
        if (!socket.username || typeof targetUsername !== 'string') return;
        const { guild, error } = kickFromGuild(socket.username, targetUsername);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to kick.', timestamp: Date.now() });
            return;
        }
        sendGuildSystemMessage(guild, io, `${targetUsername} was kicked from the guild by ${socket.username}.`);
        const targetSid = findGuildSocketIdByUsername(targetUsername, io);
        if (targetSid) {
            io.to(targetSid).emit('guildUpdate', null);
            io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">You were kicked from guild "${guild.name}".</span>`, timestamp: Date.now() });
        }
        syncGuildToOnlineMembers([targetUsername], null, io);
        broadcastGuildUpdate(guild, io);
    });

    socket.on('guildInviteToSquad', (targetUsername: string) => {
        if (!socket.username || typeof targetUsername !== 'string') return;
        const guild = getGuildForUsername(socket.username);
        if (!guild || !guild.memberUsernames.some(u => u.toLowerCase() === targetUsername.toLowerCase())) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `${targetUsername} is not in your guild.`, timestamp: Date.now() });
            return;
        }
        const targetSid = findGuildSocketIdByUsername(targetUsername, io);
        if (!targetSid) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `${targetUsername} is offline.`, timestamp: Date.now() });
            return;
        }
        let squad = getSquadForPlayer(socket.id);
        if (!squad) {
            squad = createSquad(socket.id, false);
            if (squad) {
                const player = players[socket.id];
                if (player) player.squadId = squad.id;
                io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
            }
        }
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Failed to create a squad.', timestamp: Date.now() });
            return;
        }
        const err = inviteToSquad(socket.id, targetSid, socket.username);
        if (err) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: err, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Squad invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        io.to(targetSid).emit('squadInviteReceived', { fromUsername: socket.username });
        io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
    });

    socket.on('guildSquadAll', () => {
        if (!socket.username) return;
        const guild = getGuildForUsername(socket.username);
        if (!guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a guild.', timestamp: Date.now() });
            return;
        }
        let squad = getSquadForPlayer(socket.id);
        if (!squad) {
            squad = createSquad(socket.id, false);
            if (squad) {
                const player = players[socket.id];
                if (player) player.squadId = squad.id;
                io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
            }
        }
        if (!squad || squad.leaderId !== socket.id) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Only your squad leader can invite guildmates into the squad.', timestamp: Date.now() });
            return;
        }
        let invited = 0;
        for (const member of guild.memberUsernames) {
            if (member.toLowerCase() === socket.username.toLowerCase()) continue;
            if (squad.memberIds.length + 1 >= MAX_SQUAD_SIZE) break;
            const sid = findGuildSocketIdByUsername(member, io);
            if (!sid) continue;
            const err = inviteToSquad(socket.id, sid, socket.username);
            if (!err) {
                invited++;
                io.to(sid).emit('squadInviteReceived', { fromUsername: socket.username });
                io.to(sid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
            }
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: invited === 0 ? 'No online guildmates available to invite (or squad is full).' : `<span style="color: #ffb74d;">Sent squad invites to ${invited} online guildmate(s).</span>`, timestamp: Date.now() });
    });

    socket.on('guildChat', (message: string) => {
        if (!socket.username || typeof message !== 'string') return;
        const guild = getGuildForUsername(socket.username);
        if (!guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a guild.', timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        const playerName = player ? player.name : socket.username;
        sendGuildChatMessage(guild, io, socket.username, playerName, message);
    });

    socket.on('squadChat', (message: string) => {
        if (!socket.username) return;
        const squad = getSquadForPlayer(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        const playerName = player ? player.name : socket.username;
        sendSquadChatMessage(squad, io, socket.username, playerName, message);
    });

    // Handle ping/pong for heartbeat monitoring and connection quality tracking
    socket.on('ping', (clientTime: number) => {
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
        } else if (socket.averagePing > 100) {
            socket.connectionQuality = 'medium';
        } else {
            socket.connectionQuality = 'good';
        }
    });

    // Handle respawn request
    socket.on('requestRespawn', () => {
        const player = players[socket.id];
        if (player && player.isDead) {
            respawnPlayer(player);
            player.isDead = false;
            io.emit('playerRespawned', player);
        }
    });

    // Add near other interfaces at the top
    interface CraftingRequest {
        items: Item[];
    }

    // Add to socket connection handler after other socket events
    socket.on('upgradeSkill', (data: { skillId: string; rarity: string }) => {
        const player = players[socket.id];
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
        const validSkills = ['damage', 'petalHealth', 'playerHealth', 'healingMultiplier', 'secondChance'];
        if (!validSkills.includes(data.skillId)) {
            socket.emit('skillUpgradeError', { message: 'Invalid skill ID' });
            return;
        }

        // Validate rarity
        if (!RARITY_LEVELS.includes(data.rarity as Rarity)) {
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
        const skillKey = data.skillId as keyof typeof player.skills;
        const currentTier = player.skills[skillKey];
        const currentIndex = currentTier ? RARITY_LEVELS.indexOf(currentTier as Rarity) : -1;
        const targetIndex = RARITY_LEVELS.indexOf(data.rarity as Rarity);

        // Check if this is the next tier in sequence
        if (targetIndex !== currentIndex + 1) {
            socket.emit('skillUpgradeError', { message: 'Must upgrade tiers in order' });
            return;
        }

        // Second Chance requires rare Flower Health (playerHealth) as prerequisite
        if (data.skillId === 'secondChance') {
            const playerHealthTier = player.skills.playerHealth;
            const playerHealthIdx = playerHealthTier ? RARITY_LEVELS.indexOf(playerHealthTier as Rarity) : -1;
            const rareIdx = RARITY_LEVELS.indexOf('rare' as Rarity);
            if (playerHealthIdx < rareIdx) {
                socket.emit('skillUpgradeError', { message: 'Requires rare Flower Health' });
                return;
            }
        }

        // Upgrade the skill to the new tier
        player.skills[skillKey] = data.rarity;
        player.tp -= tpCost;

        // Recalculate player stats based on level, skills, and petal modifiers
        // This will automatically scale health proportionally if maxHealth changes
        recalculatePlayerStats(player, io);

        // Apply petal health bonuses to all equipped petals and respawn them
        if (player.loadout) {
            player.loadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal') {
                    applyPetalHealthBonus(petal, player);
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
        const player = players[socket.id];
        if (!player) {
            socket.emit('skillResetError', { message: 'Player not found' });
            return;
        }

        // Count how many TP were spent (sum costs of all tiers unlocked)
        const countSpentTP = (tier: string | undefined): number => {
            if (!tier) return 0;
            const index = RARITY_LEVELS.indexOf(tier as Rarity);
            if (index < 0) return 0;
            // Sum costs from common up to this tier
            let total = 0;
            for (let i = 0; i <= index; i++) {
                total += RARITY_TP_COSTS[RARITY_LEVELS[i]];
            }
            return total;
        };

        const spentTP = countSpentTP(player.skills?.damage) +
                       countSpentTP(player.skills?.petalHealth) +
                       countSpentTP(player.skills?.playerHealth) +
                       countSpentTP(player.skills?.healingMultiplier) +
                       countSpentTP(player.skills?.secondChance);

        // Reset all skills
        player.skills = {};

        // Refund all TP (player's level gives TP, so refund = level - current TP)
        player.tp = player.level;

        // Recalculate player stats (without skill multipliers, but with petal modifiers)
        // This will automatically scale health proportionally if maxHealth changes
        recalculatePlayerStats(player, io);

        // Reconstruct all petals without petal health bonuses
        if (player.loadout) {
            player.loadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal' && petal.petalType) {
                    const petalStats = getPetalStats(petal.petalType, petal.rarity || 'common');
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

    socket.on('craftItems', (data: { items: Item[] }) => {
        try {
            console.log('[CRAFT] Craft request received:', { itemCount: data.items?.length, playerId: socket.id });
            
            const player = players[socket.id];
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

            const validCraft = data.items.every(item =>
                item.type === type && item.rarity === rarity && item.petalType === petalType
            );

            if (!validCraft) {
                console.log('[CRAFT] Invalid craft - items not matching');
                socket.emit('craftingFailed', 'Items must be of same type and rarity');
                return;
            }

            if (!hasItem(player.inventory, rarity, itemKey, data.items.length)) {
                console.log('[CRAFT] Not enough items in inventory');
                socket.emit('craftingFailed', 'Not enough items to craft');
                return;
            }

            const rarityUpgrades: Record<string, string> = {
                common: 'uncommon',
                uncommon: 'rare',
                rare: 'epic',
                epic: 'legendary',
                legendary: 'mythic',
                mythic: 'ultra',
                ultra: 'super',
                super: 'unique',
                unique: 'apex'
            };

            const newRarity = rarityUpgrades[rarity];
            if (!newRarity) {
                console.log('[CRAFT] Cannot upgrade apex items');
                socket.emit('craftingFailed', 'Cannot upgrade apex items');
                return;
            }

            const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
            const rarityIndex = rarities.indexOf(rarity);
            const baseChance = 64;
            const successChance = baseChance / Math.pow(2, rarityIndex);
            
            // Remove items from inventory - check if removal was successful
            const removed = removeItem(player.inventory, rarity, itemKey, data.items.length);
            if (!removed) {
                console.log('[CRAFT] Failed to remove items from inventory');
                socket.emit('craftingFailed', 'Failed to remove items from inventory');
                return;
            }

            let successfulCrafts = 0;
            let totalLost = 0;
            const numBatches = data.items.length / 5;
            for (let i = 0; i < numBatches; i++) {
                if (Math.random() * 100 < successChance) {
                    successfulCrafts++;
                    totalLost += 5; // All 5 consumed on success
                } else {
                    // On failure, lose 1-4 petals (return 1-4 back)
                    const lost = 1 + Math.floor(Math.random() * 4); // 1 to 4
                    totalLost += lost;
                }
            }

            // Return the petals that weren't lost
            const toReturn = data.items.length - totalLost;
            if (toReturn > 0) {
                addItem(player.inventory, rarity, itemKey, toReturn);
            }

            if (successfulCrafts > 0) {
                addItem(player.inventory, newRarity, itemKey, successfulCrafts);
                
                // Send global notification for super or unique petal crafts
                if ((newRarity === 'super' || newRarity === 'unique' || newRarity === 'apex') && type === 'petal' && petalType) {
                    const petalStats = getPetalStats(petalType, newRarity);
                    if (petalStats) {
                        const rarityColors: Record<string, string> = {
                            super: '#2bffa4',
                            unique: '#ffffff',
                            apex: '#ff00ff'
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
                        const notification: Notification = {
                            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            type: newRarity === 'unique' ? 'unique_craft' : 'super_craft',
                            message: plainMessage,
                            timestamp: Date.now()
                        };
                        database.addNotification(notification);
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
                inventory: player.inventory,
                petalsReturned: data.items.length - totalLost
            });
            
            console.log('[CRAFT] craftingFinished event emitted');
        } catch (error) {
            console.error('[CRAFT] Error during crafting:', error);
            socket.emit('craftingFailed', 'An error occurred during crafting');
        }
    });

    // Shop handlers
    socket.on('shopBuy', (data: { petalType: string, rarity: string, price: number }) => {
        try {
            const player = players[socket.id];
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
            const petalStats = getPetalStats(data.petalType, data.rarity);
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
            addItem(player.inventory, data.rarity, itemKey, 1);

            // Save progress
            const userId = playerUserIds[socket.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }

            // Emit success (only to this player)
            socket.emit('shopPurchaseSuccess', {
                inventory: player.inventory,
                stars: player.stars
            });

            socket.emit('playerUpdated', player);
        } catch (error) {
            console.error('[SHOP] Error during purchase:', error);
            socket.emit('shopPurchaseError', 'An error occurred during purchase');
        }
    });

    socket.on('redeemCode', (data: { code: string }) => {
        try {
            const player = players[socket.id];
            if (!player) {
                socket.emit('codeRedeemError', 'Player not found');
                return;
            }

            const code = data.code.trim().toUpperCase();
            const redeemedCode = redeemedCodes.get(code);
            
            if (!redeemedCode) {
                socket.emit('codeRedeemError', 'Invalid code');
                return;
            }

            // Check if code is already used by this player
            const userId = playerUserIds[socket.id];
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
                redeemedCodes.delete(code);
                deleteCodeFromDatabase(code);
            } else {
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
            const notification: Notification = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'star_code',
                message: `Star code "${code}" redeemed by @${username} [${playerNickname}]! +${redeemedCode.stars} ⭐ Stars`,
                timestamp: Date.now()
            };
            database.addNotification(notification);

            socket.emit('playerUpdated', player);
        } catch (error) {
            console.error('[SHOP] Error during code redemption:', error);
            socket.emit('codeRedeemError', 'An error occurred during code redemption');
        }
    });
});

// Add these constants at the top of the file
const ENEMY_SPEED_MULTIPLIER = 2;
const ENEMY_CHASE_RANGE = 500;
const ENEMY_WANDER_RANGE = 200;

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
            if (!(enemy as any).pendingDamageUpdate) {
                (enemy as any).pendingDamageUpdate = true;
            }
            (enemy as any).lastDamageHealth = enemy.health;
            
            // Check if enemy dies from poison (only process once per enemy)
            if (enemy.health <= 0 && !(enemy as any).isDead) {
                // Mark enemy as dead to prevent multiple death handlers
                (enemy as any).isDead = true;
                
                const index = enemies.findIndex(e => e.id === enemy.id);
                if (index !== -1) {
                    // Award XP to all players who contributed poison damage
                    const xpGained = getXPFromEnemy(enemy);
                    
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
                    
                    // Award XP to the top contributor
                    if (topContributor && players[topContributor]) {
                        addXPToPlayer(players[topContributor], xpGained, topContributor);
                    }
                    
                    // Track mob kill for eligible players (use debounced save to prevent lag)
                    trackMobKill(enemy, players, playerUserIds, database, io, savePlayerProgress);
                    // Handle mob drops (includes all eligible players)
                    handleMobDrops(enemy);
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

// Steering vector that keeps a centipede head (or promoted severed-chain head) from
// running into its own body. Direct followers are excluded since the chain-follow pass
// positions them right behind the head and avoiding them would paralyze the head.
function computeOwnSegmentAvoidance(enemy: Enemy): { x: number; y: number } | null {
    const isCentipedeHead =
        (isCentipedeHeadType(enemy.type) || isCentipedeBodyType(enemy.type)) && !enemy.leaderId;
    if (!isCentipedeHead) return null;

    const AVOID_RADIUS = 140;
    const AVOID_WEIGHT = 2.5;
    let ax = 0;
    let ay = 0;
    for (const seg of enemies) {
        if (seg === enemy) continue;
        if (!isCentipedeBodyType(seg.type)) continue;
        if (seg.headId !== enemy.id) continue;
        if (seg.leaderId === enemy.id) continue;
        const sdx = enemy.x - seg.x;
        const sdy = enemy.y - seg.y;
        const sd = Math.sqrt(sdx * sdx + sdy * sdy);
        if (sd > 0 && sd < AVOID_RADIUS) {
            const strength = (AVOID_RADIUS - sd) / AVOID_RADIUS;
            ax += (sdx / sd) * strength * AVOID_WEIGHT;
            ay += (sdy / sd) * strength * AVOID_WEIGHT;
        }
    }
    if (ax === 0 && ay === 0) return null;
    return { x: ax, y: ay };
}

/**
 * Spawn child waves from any mob with `spawn_waves` whose health dropped this
 * tick. Each wave is tied to an HP threshold; every wave crossed on the way
 * down spawns its listed mobs, so multiple waves can fire on a single big hit.
 * Mirrors the kAntHole damage behavior from the gardn reference project.
 */
function spawnWaveMobs() {
    const currentTime = Date.now();

    for (const enemy of enemies) {
        if ((enemy as any).isDead) continue;

        const parentStats = getMobStats(enemy.type, enemy.tier);
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
        const startWave = Math.floor((prev / maxHp) * numWaves);
        const endWave = Math.ceil((enemy.health / maxHp) * numWaves);
        const parentRadius = (parentStats.size * 40) / 2;

        for (let i = startWave; i >= endWave; i--) {
            const waveIndex = numWaves - i;
            if (waveIndex < 0 || waveIndex >= waves.length) continue;
            const wave = waves[waveIndex];

            for (const childType of wave) {
                const childStats = getMobStats(childType, enemy.tier);
                if (!childStats) continue;
                const angle = Math.random() * Math.PI * 2;
                const dist = parentRadius + 10 + Math.random() * parentRadius;
                const child: Enemy = {
                    id: Math.random().toString(36).substr(2, 9),
                    type: childType as Enemy['type'],
                    tier: enemy.tier,
                    x: enemy.x + Math.cos(angle) * dist,
                    y: enemy.y + Math.sin(angle) * dist,
                    angle: Math.random() * Math.PI * 2,
                    health: childStats.health,
                    maxHealth: childStats.health,
                    speed: childStats.speed,
                    damage: childStats.damage,
                    knockbackX: 0,
                    knockbackY: 0,
                    aiType: childStats.ai_type,
                    range: childStats.range,
                    reversed: childStats.reversed ?? false,
                    spawnTime: currentTime,
                    lastViewportCheck: currentTime,
                };
                enemies.push(child);
                io.emit('enemySpawned', child);
            }
        }

        (enemy as any)._spawnWavePrevHealth = enemy.health;
    }
}

function moveEnemies() {
    const currentTime = Date.now();

    // Detect severed centipede chains: any body segment whose leader no longer
    // exists is promoted to a new chain head. Subsequent segments are re-chained
    // under the new head so they continue following it.
    const enemyById = new Map<string, Enemy>();
    for (const e of enemies) enemyById.set(e.id, e);
    for (const enemy of enemies) {
        if (!isCentipedeBodyType(enemy.type) || !enemy.leaderId) continue;
        if (enemyById.has(enemy.leaderId)) continue;
        enemy.leaderId = undefined;
        enemy.headId = enemy.id;
        enemy.segmentIndex = 0;
        let leader: Enemy = enemy;
        let nextIndex = 1;
        while (true) {
            const follower = enemies.find(e => e.leaderId === leader.id);
            if (!follower) break;
            follower.headId = enemy.id;
            follower.segmentIndex = nextIndex++;
            leader = follower;
        }
    }

    enemies.forEach(enemy => {
        // Apply knockback if it exists
        if (enemy.knockbackX) {
            enemy.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
            enemy.x += enemy.knockbackX;
            if (Math.abs(enemy.knockbackX) < 0.1) enemy.knockbackX = 0;
        }
        if (enemy.knockbackY) {
            enemy.knockbackY *= KNOCKBACK_RECOVERY_SPEED;
            enemy.y += enemy.knockbackY;
            if (Math.abs(enemy.knockbackY) < 0.1) enemy.knockbackY = 0;
        }

        // Centipede body segments skip normal AI unless they've been promoted
        // to a chain head (leaderId cleared after the previous segment died).
        // Promoted heads run AI so each half of a severed centipede keeps moving.
        if (isCentipedeBodyType(enemy.type) && enemy.leaderId) {
            return;
        }

        // Check if this is a pet (has ownerId)
        const isPet = !!enemy.ownerId;

        if (isPet) {
            // Pet behavior: follow owner and attack wild mobs
            const owner = players[enemy.ownerId!];
            
            if (owner && !owner.isDead) {
                // Check if there's a clear line of sight to owner
                const hasLOS = hasLineOfSight(enemy.x, enemy.y, owner.x, owner.y);
                
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
                } else {
                    // No line of sight - teleport pet to near owner
                    // Try positions around the owner in a circle
                    const teleportDistance = 80; // Distance from owner to teleport
                    const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
                    
                    let teleported = false;
                    for (const angle of angles) {
                        const teleportX = owner.x + Math.cos(angle) * teleportDistance;
                        const teleportY = owner.y + Math.sin(angle) * teleportDistance;
                        
                        // Check if teleport position is in a wall tile
                        const teleportTileState = getTileState(WALL_GRID, teleportX, teleportY);
                        const isInWall = isTileIdBlocking(teleportTileState);

                        // If position is safe and has line of sight, teleport there
                        if (!isInWall && hasLineOfSight(teleportX, teleportY, owner.x, owner.y)) {
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
                        const ownerTileState = getTileState(WALL_GRID, owner.x, owner.y);
                        const isOwnerPosInWall = isTileIdBlocking(ownerTileState);

                        if (!isOwnerPosInWall) {
                            enemy.x = owner.x;
                            enemy.y = owner.y;
                        }
                    }
                }
                
                    // Attack wild mobs (enemies without ownerId) if pet is movable
                    if (enemy.speed > 0) {
                        let closestWildMob: Enemy | undefined;
                        let closestWildMobDistance = Infinity;
                        
                        for (const otherEnemy of enemies) {
                            // Skip self, pets, and enemies without ownerId are wild
                            if (otherEnemy.id === enemy.id || otherEnemy.ownerId) {
                                continue;
                            }
                            
                            const mobDx = otherEnemy.x - enemy.x;
                            const mobDy = otherEnemy.y - enemy.y;
                            const mobDistance = Math.sqrt(mobDx * mobDx + mobDy * mobDy);
                            
                            // Only consider mobs with line of sight
                            if (mobDistance < closestWildMobDistance && mobDistance < (enemy.range || ENEMY_CHASE_RANGE)) {
                                if (hasLineOfSight(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y)) {
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
                        } else {
                            enemy.isChasing = false;
                        }
                    }
            } else {
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
            const mobStats = getMobStats(enemy.type, enemy.tier);
            if (mobStats?.projectile && enemy.speed > 0) {
                // Find closest wild mob for projectile target
                let projectileTarget: Enemy | undefined;
                let projectileTargetDistance = Infinity;
                
                for (const otherEnemy of enemies) {
                    if (otherEnemy.id === enemy.id || otherEnemy.ownerId) {
                        continue;
                    }
                    
                    const mobDx = otherEnemy.x - enemy.x;
                    const mobDy = otherEnemy.y - enemy.y;
                    const mobDistance = Math.sqrt(mobDx * mobDx + mobDy * mobDy);
                    
                    // Only consider mobs with line of sight
                    if (mobDistance < projectileTargetDistance && mobDistance < (enemy.range || ENEMY_CHASE_RANGE)) {
                        if (hasLineOfSight(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y)) {
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
                        const petalStats = getPetalStats(projectileConfig.petalType, projectileRarity);
                        
                        if (petalStats) {
                            for (let i = 0; i < projectileCount; i++) {
                                let projectileAngle = angleToTarget;
                                if (projectileCount > 1) {
                                    const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                                    projectileAngle = angleToTarget + spreadOffset;
                                }
                                
                                // Scale projectile distance and size by mob's rarity size scaling
                                const distanceScale = (SIZE_SCALING[enemy.tier] || 1) / 9;
                                const sizeScale = (SIZE_SCALING[enemy.tier] || 1) / 3;
                                const scaledDistance = projectileConfig.distance * distanceScale;
                                const scaledSize = petalStats.size * sizeScale;

                                const projectile: MobProjectile = {
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

                                mobProjectiles.push(projectile);
                            }
                            
                            enemy.lastProjectileTime = currentTime;
                        }
                    }
                }
            }
            
            // Skip regular enemy behavior for pets - handle wall collisions and move to next enemy
            const mobStatsForSize = getMobStats(enemy.type, enemy.tier);
            checkEnemyWallCollisions(enemy);
            // Continue to next iteration (pets skip regular enemy behavior)
        } else {
            // Regular enemy behavior (not a pet)
        // Calculate 5x view distance threshold
        const MAX_TARGET_DISTANCE = VIEWPORT_WIDTH * 5;
        
        // Check if we have an existing target that's still in range
        let targetPlayer: ServerPlayer | undefined;
        let targetDistance = Infinity;
        
        if (enemy.targetPlayerId && players[enemy.targetPlayerId]) {
            const existingTarget = players[enemy.targetPlayerId];
            if (!existingTarget.isDead) {
                const dx = existingTarget.x - enemy.x;
                const dy = existingTarget.y - enemy.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // Keep targeting if within 5x view distance AND has line of sight
                // If wall blocks line of sight, stop targeting
                if (distance <= MAX_TARGET_DISTANCE && hasLineOfSight(enemy.x, enemy.y, existingTarget.x, existingTarget.y)) {
                    targetPlayer = existingTarget;
                    targetDistance = distance;
                } else {
                    // Player moved too far away or wall blocking, clear target
                    enemy.targetPlayerId = undefined;
                }
            } else {
                // Target is dead, clear target
                enemy.targetPlayerId = undefined;
            }
        }
        
        // If no existing target or existing target is out of range, look for new targets
        // Neutral and sandstorm mobs don't actively scan for targets — neutral only targets via provocation
        if (!targetPlayer && enemy.aiType !== 'neutral' && enemy.aiType !== 'sandstorm' && enemy.aiType !== 'passive') {
            // Find closest living player with line of sight (for initial targeting)
            let closestPlayer: ServerPlayer | undefined;
            let closestDistance = Infinity;

            // Convert players object to array and explicitly type it
            const playerArray: ServerPlayer[] = Object.values(players);

            playerArray.forEach(player => {
                // Skip dead players (corpses)
                if (player.isDead) {
                    return;
                }

                const dx = player.x - enemy.x;
                const dy = player.y - enemy.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                // Only consider players with line of sight for initial targeting
                if (distance < closestDistance && hasLineOfSight(enemy.x, enemy.y, player.x, player.y)) {
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
        let closestPet: Enemy | undefined;
        let closestPetDistance = Infinity;
        
        if (!targetPlayer) {
            for (const otherEnemy of enemies) {
                if (otherEnemy.ownerId && otherEnemy.id !== enemy.id) {
                    const petDx = otherEnemy.x - enemy.x;
                    const petDy = otherEnemy.y - enemy.y;
                    const petDistance = Math.sqrt(petDx * petDx + petDy * petDy);
                    // Only consider pets with line of sight
                    if (petDistance < closestPetDistance && petDistance < (enemy.range || ENEMY_CHASE_RANGE)) {
                        if (hasLineOfSight(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y)) {
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
        // Neutral mobs only chase if provoked (have a targetPlayerId from taking damage)
        const isProvoked = enemy.aiType === 'neutral' && !!enemy.targetPlayerId;
        if (target && (enemy.aiType === 'hostile' || isProvoked)) {
            const isTargetingPlayer = target === targetPlayer;
            const targetX = isTargetingPlayer ? targetPlayer!.x : closestPet!.x;
            const targetY = isTargetingPlayer ? targetPlayer!.y : closestPet!.y;
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
                let moveX = dx / distance;
                let moveY = dy / distance;
                const avoid = computeOwnSegmentAvoidance(enemy);
                if (avoid) {
                    moveX += avoid.x;
                    moveY += avoid.y;
                    const mag = Math.sqrt(moveX * moveX + moveY * moveY);
                    if (mag > 0) {
                        moveX /= mag;
                        moveY /= mag;
                    }
                }
                enemy.x += moveX * speed;
                enemy.y += moveY * speed;
                if (enemy.speed !== 0) {
                    enemy.angle = Math.atan2(moveY * speed, moveX * speed);
                }
            }

            // Check if mob can shoot projectiles
            const mobStats = getMobStats(enemy.type, enemy.tier);
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
                    const petalStats = getPetalStats(projectileConfig.petalType, projectileRarity);
                    if (petalStats) {
                        // Create projectiles
                        for (let i = 0; i < projectileCount; i++) {
                            // Calculate spread angle for multiple projectiles
                            let projectileAngle = angleToTarget;
                            if (projectileCount > 1) {
                                const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                                projectileAngle = angleToTarget + spreadOffset;
                            }

                            // Scale projectile distance and size by mob's rarity size scaling
                            const distanceScale = (SIZE_SCALING[enemy.tier] || 1) / 9;
                            const sizeScale = (SIZE_SCALING[enemy.tier] || 1) / 3;
                            const scaledDistance = projectileConfig.distance * distanceScale;
                            const scaledSize = petalStats.size * sizeScale;

                            const projectile: MobProjectile = {
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

                            mobProjectiles.push(projectile);
                        }

                        // Update last shot time
                        enemy.lastProjectileTime = currentTime;
                    }
                }
            }
        } else if (enemy.aiType === 'sandstorm') {
            // Sandstorm AI: fast random movement, changes direction frequently
            enemy.isChasing = false;
            const SANDSTORM_DIRECTION_CHANGE_INTERVAL = 300; // Change direction every 300ms
            if (!enemy.wanderTarget || currentTime - (enemy.lastWanderTime || 0) > SANDSTORM_DIRECTION_CHANGE_INTERVAL) {
                // Pick a random direction and move far in that direction
                const randomAngle = Math.random() * Math.PI * 2;
                const wanderDistance = ENEMY_WANDER_RANGE * 2;
                enemy.wanderTarget = {
                    x: enemy.x + Math.cos(randomAngle) * wanderDistance,
                    y: enemy.y + Math.sin(randomAngle) * wanderDistance
                };
                enemy.lastWanderTime = currentTime;
            }

            if (enemy.wanderTarget && enemy.speed > 0) {
                const dx = enemy.wanderTarget.x - enemy.x;
                const dy = enemy.wanderTarget.y - enemy.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance > 5) {
                    // Sandstorms move at full speed (not the 0.5x wander speed)
                    const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER;
                    enemy.x += (dx / distance) * speed;
                    enemy.y += (dy / distance) * speed;
                    enemy.angle = Math.atan2(dy, dx);
                }
            }

            // Suck in nearby players if sandstorm is super rarity or above
            const sandstormRarityIndex = RARITY_LEVELS.indexOf(enemy.tier as Rarity);
            const superRarityIndex = RARITY_LEVELS.indexOf('super');
            if (sandstormRarityIndex >= superRarityIndex) {
                const SANDSTORM_SUCK_RANGE = 400;
                const SANDSTORM_SUCK_FORCE = 1.5;
                const playerArray: ServerPlayer[] = Object.values(players);
                for (const player of playerArray) {
                    if (player.isDead) continue;
                    const dx = enemy.x - player.x;
                    const dy = enemy.y - player.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < SANDSTORM_SUCK_RANGE && distance > 0) {
                        // Pull strength increases as player gets closer
                        const pullStrength = SANDSTORM_SUCK_FORCE * (1 - distance / SANDSTORM_SUCK_RANGE);
                        player.x += (dx / distance) * pullStrength;
                        player.y += (dy / distance) * pullStrength;
                    }
                }
            }
        } else {
            // Not chasing - clear target if we had one
            enemy.isChasing = false;
            if (enemy.targetPlayerId) {
                // Check if target is still within max distance
                const existingTarget = players[enemy.targetPlayerId];
                if (existingTarget && !existingTarget.isDead) {
                    const dx = existingTarget.x - enemy.x;
                    const dy = existingTarget.y - enemy.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance > MAX_TARGET_DISTANCE) {
                        enemy.targetPlayerId = undefined;
                    }
                } else {
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
                    let moveX = dx / distance;
                    let moveY = dy / distance;
                    const avoid = computeOwnSegmentAvoidance(enemy);
                    if (avoid) {
                        moveX += avoid.x;
                        moveY += avoid.y;
                        const mag = Math.sqrt(moveX * moveX + moveY * moveY);
                        if (mag > 0) {
                            moveX /= mag;
                            moveY /= mag;
                        }
                    }
                    enemy.x += moveX * speed;
                    enemy.y += moveY * speed;
                    if (enemy.speed !== 0) {
                        enemy.angle = Math.atan2(moveY * speed, moveX * speed);
                    }
                }
            }
        }

        // Get enemy size based on mob stats
        const mobStats = getMobStats(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
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
        checkEnemyWallCollisions(enemy);
        }
    });

    // Second pass: propagate centipede chain positions from each head down to its body segments
    // Process each head's chain in order so segments always see their leader's freshly-updated position.
    // A "head" is either an original centipede or a body segment promoted after a chain was severed.
    const centipedeHeads = enemies.filter(e => (isCentipedeHeadType(e.type) || isCentipedeBodyType(e.type)) && !e.leaderId);
    for (const head of centipedeHeads) {
        const chain = enemies
            .filter(e => isCentipedeBodyType(e.type) && e.headId === head.id)
            .sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));
        for (const segment of chain) {
            const leader = enemies.find(e => e.id === segment.leaderId);
            if (!leader) continue;
            const segStats = getMobStats(segment.type, segment.tier);
            const segmentSize = segStats ? segStats.size * 40 : 40;
            const spacing = segmentSize * 0.9;
            const dx = segment.x - leader.x;
            const dy = segment.y - leader.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            segment.x = leader.x + (dx / dist) * spacing;
            segment.y = leader.y + (dy / dist) * spacing;
            segment.angle = Math.atan2(leader.y - segment.y, leader.x - segment.x);
            segment.isChasing = head.isChasing;
            checkEnemyWallCollisions(segment);
        }
    }

    // Check for mob-to-mob collisions and melee combat
    checkEnemyEnemyCollisions(enemies, io);
    
    // Remove dead enemies after melee combat and handle XP/loot
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if ((enemy as any).isDead || enemy.health <= 0) {
            // Check if this was killed by a pet - find the pet that killed it
            // We'll use damage contributors to determine who gets XP/loot
            if (enemy.damageContributors && enemy.damageContributors.size > 0) {
                // Find the top contributor (could be a pet owner)
                let topContributor: string | undefined;
                let maxDamage = 0;
                
                enemy.damageContributors.forEach((damage, playerId) => {
                    if (damage > maxDamage) {
                        maxDamage = damage;
                        topContributor = playerId;
                    }
                });
                
            // Award XP and handle drops for the top contributor
            if (topContributor && players[topContributor]) {
                const xpGained = getXPFromEnemy(enemy);
                addXPToPlayer(players[topContributor], xpGained, topContributor);
                trackMobKill(enemy, players, playerUserIds, database, io, savePlayerProgress);
                handleMobDrops(enemy);
                sendBossMobDefeatedMessage(enemy, io, players);
            }
        }
        
        // Clean up enemy data structures before removal to prevent memory leaks
        cleanupEnemy(enemy);
        enemies.splice(i, 1);
        updateSpecialMobCounts();
        }
    }
    
    // Don't send enemiesUpdate here - enemies are sent via enemySpawned/enemyDestroyed events
}

// Update and move mob projectiles
function updateMobProjectiles(deltaTimeMs: number) {
    const currentTime = Date.now();
    
    for (let i = mobProjectiles.length - 1; i >= 0; i--) {
        const projectile = mobProjectiles[i];
        
        // Remove projectile if it has no health
        if (projectile.health <= 0) {
            mobProjectiles.splice(i, 1);
            continue;
        }
        
        // Move projectile (speed is already in pixels per millisecond)
        const moveDistance = projectile.speed * deltaTimeMs;
        projectile.x += Math.cos(projectile.angle) * moveDistance;
        projectile.y += Math.sin(projectile.angle) * moveDistance;
        projectile.distance += moveDistance;

        // Check for wall collisions
        const projectileSize = projectile.size * 20; // Convert to pixels
        const halfSize = projectileSize / 2;

        if (checkProjectileWallCollision(projectile.x, projectile.y, halfSize)) {
            mobProjectiles.splice(i, 1);
            continue;
        }

        // Check for collision with player body first (before petals)
        const playerArray: ServerPlayer[] = Object.values(players);
        const projectileEnemy = enemies.find(e => e.id === projectile.enemyId);
        const isPetProjectile = projectileEnemy?.ownerId;
        const petOwnerId = projectileEnemy?.ownerId;
        let hitPlayer = false;

        if (!isPetProjectile) {
            for (const player of playerArray) {
                if (player.isDead) continue;

                const dx = player.x - projectile.x;
                const dy = player.y - projectile.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const hitRadius = (PLAYER_SIZE / 2) * (player.sizeMultiplier ?? 1.0) + halfSize;

                if (distance < hitRadius) {
                    // Calculate knockback direction
                    let knockbackX = 0;
                    let knockbackY = 0;
                    if (distance > 0) {
                        const knockbackForce = 25;
                        const normalizedDx = dx / distance;
                        const normalizedDy = dy / distance;
                        knockbackX = normalizedDx * knockbackForce;
                        knockbackY = normalizedDy * knockbackForce;
                        // Apply knockback to server-side position
                        player.x += knockbackX;
                        player.y += knockbackY;
                    }

                    // Hit player - apply damage
                    let damageDealt = 0;
                    if (!player.isInvulnerable) {
                        damageDealt = projectile.damage;
                        player.health -= damageDealt;

                        // Check if player dies
                        if (player.health <= 0) {
                            player.isDead = true;
                            player.health = 0;
                            despawnAllPlayerPets(player.id, io);
                            io.emit('playerDied', { playerId: player.id });
                        }
                    }

                    // Always emit knockback and current health state
                    io.emit('playerDamaged', {
                        playerId: player.id,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        isInvulnerable: player.isInvulnerable,
                        knockbackX: knockbackX,
                        knockbackY: knockbackY,
                        damageDealt: damageDealt
                    });

                    // Remove projectile after hitting player
                    mobProjectiles.splice(i, 1);
                    hitPlayer = true;
                    break;
                }
            }
        }

        if (hitPlayer) continue;

        // Check for collision with wild mobs (enemies without ownerId) if this is a pet projectile
        if (projectile.health > 0 && isPetProjectile && petOwnerId) {
            // Pet projectile can hit wild mobs
            for (let j = enemies.length - 1; j >= 0; j--) {
                const targetEnemy = enemies[j];
                
                // Skip if target is a pet or the same enemy that shot the projectile
                if (targetEnemy.ownerId || targetEnemy.id === projectile.enemyId) {
                    continue;
                }
                
                const targetMobStats = getMobStats(targetEnemy.type, targetEnemy.tier);
                const targetEnemySize = targetMobStats ? targetMobStats.size * 40 : ENEMY_SIZE;
                const targetEnemyHalfSize = targetEnemySize / 2;
                
                const dx = targetEnemy.x - projectile.x;
                const dy = targetEnemy.y - projectile.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const hitRadius = targetEnemyHalfSize + halfSize;
                
                if (distance < hitRadius) {
                    // Pet projectile hits wild mob
                    const projectilePetalStats = getPetalStats(projectile.petalType, projectile.petalRarity);
                    const projectileDamage = projectilePetalStats ? projectilePetalStats.damage : projectile.damage;
                    
                    // Track damage with pet owner's ID
                    trackDamage(targetEnemy, petOwnerId, projectileDamage);
                    
                    // Skip further processing if enemy is already dead
                    if ((targetEnemy as any).isDead) {
                        mobProjectiles.splice(i, 1);
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
                    if (targetEnemy.health <= 0 && !(targetEnemy as any).isDead) {
                        (targetEnemy as any).isDead = true;
                        
                        const owner = players[petOwnerId];
                        if (owner) {
                            // Follow same path as lightning damage - synchronous execution
                            const xpGained = getXPFromEnemy(targetEnemy);
                            addXPToPlayer(owner, xpGained, petOwnerId);
                            handleMobDrops(targetEnemy);
                            sendBossMobDefeatedMessage(targetEnemy, io, players);
                            updateSpecialMobCounts();
                        }
                        
                        // Remove enemy from array
                        cleanupEnemy(targetEnemy);
                        enemies.splice(j, 1);
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
                                trackMobKill(enemyDataForTracking as Enemy, players, playerUserIds, database, io, savePlayerProgress);
                            });
                        }
                    }
                    
                    // Remove projectile after hitting enemy
                    mobProjectiles.splice(i, 1);
                    break;
                }
            }
        }

        // Check if projectile has traveled max distance (after collision checks)
        if (projectile.distance >= projectile.maxDistance) {
            mobProjectiles.splice(i, 1);
            continue;
        }
    }

    // Emit projectile updates to nearby players only (spatial filtering)
    for (const playerId of Object.keys(players)) {
        const player = players[playerId];
        if (!player) continue;
        const socket = io.sockets.sockets.get(playerId) as AuthenticatedSocket;
        if (!socket || !socket.userId) continue;
        const vw = (player.viewportWidth || VIEWPORT_WIDTH) * 1.5;
        const vh = (player.viewportHeight || VIEWPORT_HEIGHT) * 1.5;
        const filtered = mobProjectiles.filter(p =>
            Math.abs(p.x - player.x) < vw && Math.abs(p.y - player.y) < vh
        );
        io.to(playerId).emit('mobProjectilesUpdate', filtered);
    }
}

// Update and move player projectiles
function updatePlayerProjectiles(deltaTimeMs: number) {
    const currentTime = Date.now();
    
    for (let i = playerProjectiles.length - 1; i >= 0; i--) {
        const projectile = playerProjectiles[i];
        
        // Remove projectile if it has no health
        if (projectile.health <= 0) {
            playerProjectiles.splice(i, 1);
            continue;
        }
        
        // Move projectile
        const moveDistance = projectile.speed * deltaTimeMs;
        projectile.x += Math.cos(projectile.angle) * moveDistance;
        projectile.y += Math.sin(projectile.angle) * moveDistance;
        projectile.distance += moveDistance;
        
        // Check if projectile has traveled max distance
        if (projectile.distance >= projectile.maxDistance) {
            playerProjectiles.splice(i, 1);
            continue;
        }
        
        // Check for wall collisions
        const projectileSize = projectile.size * 20; // Convert to pixels
        const halfSize = projectileSize / 2;
        
        if (checkProjectileWallCollision(projectile.x, projectile.y, halfSize)) {
            playerProjectiles.splice(i, 1);
            continue;
        }
        
        // Check for collision with mob projectiles (projectile vs projectile)
        for (let mobProjIdx = mobProjectiles.length - 1; mobProjIdx >= 0; mobProjIdx--) {
            const mobProjectile = mobProjectiles[mobProjIdx];
            
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
                const playerProjPetalStats = getPetalStats(projectile.petalType, projectile.petalRarity);
                const playerProjDamage = playerProjPetalStats ? playerProjPetalStats.damage : projectile.damage;
                
                const mobProjPetalStats = getPetalStats(mobProjectile.petalType, mobProjectile.petalRarity);
                const mobProjDamage = mobProjPetalStats ? mobProjPetalStats.damage : mobProjectile.damage;
                
                // Damage both projectiles
                projectile.health -= mobProjDamage;
                mobProjectile.health -= playerProjDamage;
                
                // Remove projectiles if destroyed
                if (projectile.health <= 0) {
                    playerProjectiles.splice(i, 1);
                    break; // Exit mob projectile loop
                }
                if (mobProjectile.health <= 0) {
                    mobProjectiles.splice(mobProjIdx, 1);
                }
            }
        }
        
        // Skip enemy collision if projectile was destroyed
        if (projectile.health <= 0) {
            continue;
        }
        
        // Check for enemy collisions
        for (let j = enemies.length - 1; j >= 0; j--) {
            const enemy = enemies[j];
            
            // Skip all pets (pets should not be damaged by any player's projectiles)
            if (enemy.ownerId) {
                continue;
            }
            
            const mobStats = getMobStats(enemy.type, enemy.tier);
            const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
            const enemyHalfSize = enemySize / 2;
            
            const dx = enemy.x - projectile.x;
            const dy = enemy.y - projectile.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const hitRadius = enemyHalfSize + halfSize;
            
            if (distance < hitRadius) {
                // Hit enemy
                const player = players[projectile.playerId];
                if (!player) {
                    // Player disconnected, remove projectile
                    playerProjectiles.splice(i, 1);
                    break;
                }
                
                const damageMultiplier = getDamageMultiplier(player);
                const finalDamage = projectile.damage * damageMultiplier;
                
                // Track damage dealt by this player (always track, even if enemy is dead)
                trackDamage(enemy, projectile.playerId, finalDamage);
                
                // Skip further processing if enemy is already dead (being processed)
                if ((enemy as any).isDead) {
                    continue;
                }
                
                enemy.health = Math.max(0, enemy.health - finalDamage);
                // Mark enemy for batched damage update at end of frame
            if (!(enemy as any).pendingDamageUpdate) {
                (enemy as any).pendingDamageUpdate = true;
            }
            (enemy as any).lastDamageHealth = enemy.health;
                
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
                if (enemy.health <= 0 && !(enemy as any).isDead) {
                    // Mark enemy as dead to prevent multiple death handlers
                    (enemy as any).isDead = true;
                    
                    const player = players[projectile.playerId];
                    if (player) {
                        // Follow same path as lightning damage - synchronous execution
                        const xpGained = getXPFromEnemy(enemy);
                        addXPToPlayer(player, xpGained, projectile.playerId);
                        handleMobDrops(enemy);
                        sendBossMobDefeatedMessage(enemy, io, players);
                        updateSpecialMobCounts();
                    }
                    
                    // Remove enemy from array
                    cleanupEnemy(enemy);
                    enemies.splice(j, 1);
                    // Emit enemy destroyed event
                    io.emit('enemyDestroyed', enemy.id);
                    
                    // Call trackMobKill synchronously to ensure it runs
                    // Copy enemy data before cleanup to ensure trackMobKill has all needed info
                    const damageContributorsCopy = enemy.damageContributors ? new Map(enemy.damageContributors) : undefined;
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
                        trackMobKill(enemyDataForTracking as Enemy, players, playerUserIds, database, io, savePlayerProgress);
                    }
                }
                
                // Remove projectile after hitting enemy
                playerProjectiles.splice(i, 1);
                break;
            }
        }
    }
    
    // Emit projectile updates to nearby players only (spatial filtering)
    for (const playerId of Object.keys(players)) {
        const player = players[playerId];
        if (!player) continue;
        const socket = io.sockets.sockets.get(playerId) as AuthenticatedSocket;
        if (!socket || !socket.userId) continue;
        const vw = (player.viewportWidth || VIEWPORT_WIDTH) * 1.5;
        const vh = (player.viewportHeight || VIEWPORT_HEIGHT) * 1.5;
        const filtered = playerProjectiles.filter(p =>
            Math.abs(p.x - player.x) < vw && Math.abs(p.y - player.y) < vh
        );
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
        const authenticatedPlayerIds = Object.keys(players).filter(id => {
            const socket = io.sockets.sockets.get(id) as AuthenticatedSocket;
            return socket && socket.userId;
        });

        // Keep bot population aligned with real player count. Despawns all bots
        // when nobody is online so the server goes fully idle.
        maintainBotCount(io, authenticatedPlayerIds.length);

        // Skip game processing if there are no authenticated players
        if (authenticatedPlayerIds.length === 0) {
            return;
        }

        // Populate bot inputs before running the normal update pipeline so
        // bots move/attack just like real players.
        updateBotAI(io);

        for (const id in players) {
            updatePlayerState(players[id], deltaTime, playerStateDeps);
        }

        // Update petal actions
        updatePetalActions(deltaTime);

        // Update poison effects
        updatePoisonEffects(deltaTime);

        moveEnemies();
        
        // Update mob projectiles
        updateMobProjectiles(TICK_INTERVAL); // Pass milliseconds
        
        // Update player projectiles
        updatePlayerProjectiles(TICK_INTERVAL); // Pass milliseconds

        // Update viewport status for all enemies
        updateEnemyViewportStatus();
        
        // Spawn wave mobs from damaged spawners (e.g. ant holes) before emitting damage batch
        spawnWaveMobs();

        // Batch all enemy damage updates into a single event
        const damagedEnemies: Array<{ enemyId: string, health: number }> = [];
        for (const enemy of enemies) {
            if ((enemy as any).pendingDamageUpdate) {
                const health = (enemy as any).lastDamageHealth !== undefined ? (enemy as any).lastDamageHealth : enemy.health;
                damagedEnemies.push({ enemyId: enemy.id, health: health });
                delete (enemy as any).pendingDamageUpdate;
                delete (enemy as any).lastDamageHealth;
            }
        }
        
        // Emit batched enemy damage updates in a single event
        if (damagedEnemies.length > 0) {
            io.emit('enemiesDamaged', damagedEnemies);
        }
        
        // Batch all item spawn emissions into a single event per player
        const itemsByPlayer = new Map<string, WorldItem[]>();
        for (const item of items) {
            if ((item as any).pendingSpawnEmission && (item as any).eligibleSocketIds) {
                const socketIds = (item as any).eligibleSocketIds as string[];
                for (const socketId of socketIds) {
                    if (!itemsByPlayer.has(socketId)) {
                        itemsByPlayer.set(socketId, []);
                    }
                    itemsByPlayer.get(socketId)!.push(item);
                }
                delete (item as any).pendingSpawnEmission;
                delete (item as any).eligibleSocketIds;
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
        for (const item of items) {
            checkItemWallCollisions(item);
        }

        // Delete items that go out of bounds. The PVP arena lives well outside
        // the regular world rectangle, so items inside it must be exempted.
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            const outOfBounds = item.x < 0 || item.x >= ACTUAL_WORLD_WIDTH || item.y < 0 || item.y >= ACTUAL_WORLD_HEIGHT;
            if (outOfBounds && !isInPvpArena(item.x, item.y)) {
                // Clean up expiration timeout
                const timeout = itemExpirationTimeouts.get(item.id);
                if (timeout) {
                    clearTimeout(timeout);
                    itemExpirationTimeouts.delete(item.id);
                }
                // Notify eligible players that item is being removed
                if (item.eligiblePlayers) {
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
                items.splice(i, 1);
            }
        }
        
        // Periodic cleanup: Remove expired items (check every tick)
        const currentTime = Date.now();
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.spawnTime && item.rarity) {
                const expirationTime = ITEM_EXPIRATION_TIMES[item.rarity] || 10000;
                if (currentTime - item.spawnTime >= expirationTime) {
                    // Clean up expiration timeout if it still exists
                    const timeout = itemExpirationTimeouts.get(item.id);
                    if (timeout) {
                        clearTimeout(timeout);
                        itemExpirationTimeouts.delete(item.id);
                    }
                    // Notify eligible players that item expired
                    if (item.eligiblePlayers) {
                        for (const playerId of item.eligiblePlayers) {
                            io.to(playerId).emit('itemRemoved', item.id);
                        }
                    }
                    items.splice(i, 1);
                }
            }
        }
        
        // Periodic cleanup: Clean up old petalLastProjectileTime entries (keep only last 1000 entries)
        if (petalLastProjectileTime.size > 1000) {
            // Sort by value (time) and keep only the most recent 1000
            const entries = Array.from(petalLastProjectileTime.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 1000);
            petalLastProjectileTime.clear();
            entries.forEach(([key, value]) => petalLastProjectileTime.set(key, value));
        }

        // Helper function to quantize positions (reduce precision to save bandwidth)
        const quantize = (value: number, precision: number = 1): number => {
            return Math.round(value / precision) * precision;
        };

        // Send compact delta updates per client. Protocol uses short keys and
        // omits fields that haven't changed since the last send to that client.
        // See client handler in socket.ts for the matching format.
        for (const playerId of authenticatedPlayerIds) {
            const socket = io.sockets.sockets.get(playerId) as AuthenticatedSocket;
            if (!socket || !socket.userId) continue;

            const quality = socket.connectionQuality || 'good';
            const now = Date.now();

            // Adaptive update rate: 30 TPS for good, lower for weaker connections
            let shouldUpdate = true;
            if (socket.lastUpdateTime) {
                const timeSinceLastUpdate = now - socket.lastUpdateTime;
                if (quality === 'slow' && timeSinceLastUpdate < 100) {
                    shouldUpdate = false;
                } else if (quality === 'medium' && timeSinceLastUpdate < 67) {
                    shouldUpdate = false;
                }
            }
            if (!shouldUpdate) continue;

            const precision = quality === 'slow' ? 2 : quality === 'medium' ? 1 : 0.5;
            const anglePrecision = quality === 'slow' ? 0.1 : 0.05;
            const player = players[playerId];

            if (!socket.lastSentPlayers) socket.lastSentPlayers = new Map();
            const lastPlayers = socket.lastSentPlayers;
            const changedPlayers: any[] = [];
            const currentPlayerIds = new Set<string>();

            for (const p of Object.values(players)) {
                currentPlayerIds.add(p.id);
                const isSelf = p.id === playerId;

                const petalExtension = p.inputs?.petalExtension || 1.0;
                let faceFlags = 0;
                let mouth = 14.5;
                if (petalExtension > 1.0) { faceFlags |= FaceFlags.Attacking; mouth = 4; }
                if (petalExtension < 1.0) { faceFlags |= FaceFlags.Defending; mouth = 4; }
                let equipFlags = 0;
                if (p.loadout) {
                    for (let i = 0; i < p.loadout.length && i < 10; i++) {
                        const item = p.loadout[i];
                        if (!item || item.type !== 'petal' || !item.petalType) continue;
                        const stats = getPetalStats(item.petalType, item.rarity ?? 'common');
                        if (stats?.equipFlags) equipFlags |= stats.equipFlags;
                        if (stats?.faceFlags) faceFlags |= stats.faceFlags;
                    }
                }

                const sx = isSelf ? p.x : quantize(p.x, precision);
                const sy = isSelf ? p.y : quantize(p.y, precision);
                const sa = isSelf ? p.angle : quantize(p.angle, anglePrecision);
                const sh = Math.round(p.health);
                const sH = Math.round(p.maxHealth);
                const sl = p.level;
                const ss = p.score;
                const se = quantize(petalExtension, 0.1);
                const sv = p.inPvpArena ? 1 : 0;
                const sV = p.pvpScore || 0;
                const sz = p.sizeMultiplier ?? 1.0;
                const sn = p.name;

                // Build petal positions array and a signature to detect changes cheaply.
                const petalsRaw = p.petalPositions || [];
                const petalsOut: any[] = [];
                let petalsSig = '';
                for (const pos of petalsRaw) {
                    const px = quantize(pos.x, precision);
                    const py = quantize(pos.y, precision);
                    const np = pos.noPhysics ? 1 : 0;
                    petalsSig += pos.loadoutIndex + ',' + pos.instanceIndex + ',' + px + ',' + py + ',' + np + ';';
                    const petal: any = { L: pos.loadoutIndex, I: pos.instanceIndex, x: px, y: py };
                    if (np) petal.N = 1;
                    petalsOut.push(petal);
                }

                const prev = lastPlayers.get(p.id);
                const delta: any = { i: p.id };
                let changed = false;
                // For each field: when prev exists, send only if value changed (so transitions
                // back to default are still emitted). When prev is missing (first send), send
                // only if non-default — the client applies defaults to missing fields.
                if (prev ? prev.x !== sx : true) { delta.x = sx; changed = true; }
                if (prev ? prev.y !== sy : true) { delta.y = sy; changed = true; }
                if (prev ? prev.a !== sa : sa !== 0) { delta.a = sa; changed = true; }
                if (prev ? prev.h !== sh : true) { delta.h = sh; changed = true; }
                if (prev ? prev.H !== sH : true) { delta.H = sH; changed = true; }
                if (prev ? prev.l !== sl : sl !== 1) { delta.l = sl; changed = true; }
                if (prev ? prev.s !== ss : ss !== 0) { delta.s = ss; changed = true; }
                if (prev ? prev.e !== se : se !== 1.0) { delta.e = se; changed = true; }
                if (prev ? prev.f !== faceFlags : faceFlags !== 0) { delta.f = faceFlags; changed = true; }
                if (prev ? prev.q !== equipFlags : equipFlags !== 0) { delta.q = equipFlags; changed = true; }
                if (prev ? prev.m !== mouth : mouth !== 14.5) { delta.m = mouth; changed = true; }
                if (prev ? prev.v !== sv : sv !== 0) { delta.v = sv; changed = true; }
                if (prev ? prev.V !== sV : sV !== 0) { delta.V = sV; changed = true; }
                if (prev ? prev.z !== sz : sz !== 1.0) { delta.z = sz; changed = true; }
                if (prev ? prev.n !== sn : true) { delta.n = sn; changed = true; }
                if (prev ? prev.petalsSig !== petalsSig : petalsOut.length > 0) { delta.p = petalsOut; changed = true; }

                if (changed) {
                    changedPlayers.push(delta);
                    lastPlayers.set(p.id, {
                        x: sx, y: sy, a: sa, h: sh, H: sH,
                        l: sl, s: ss, e: se,
                        f: faceFlags, q: equipFlags, m: mouth,
                        v: sv, V: sV, z: sz, n: sn,
                        petalsSig,
                    });
                }
            }
            // Drop tracking for players that are no longer present (disconnects).
            for (const id of lastPlayers.keys()) {
                if (!currentPlayerIds.has(id)) lastPlayers.delete(id);
            }

            // Filter enemies to this player's viewport (200% buffer)
            const vw = (player?.viewportWidth || VIEWPORT_WIDTH) * 2;
            const vh = (player?.viewportHeight || VIEWPORT_HEIGHT) * 2;
            const px0 = player?.x || 0;
            const py0 = player?.y || 0;
            const viewportEnemies = enemies.filter(e =>
                Math.abs(e.x - px0) < vw && Math.abs(e.y - py0) < vh
            );

            if (!socket.lastSentEnemies) socket.lastSentEnemies = new Map();
            const lastEnemies = socket.lastSentEnemies;
            const changedEnemies: any[] = [];
            const unchangedIds: string[] = [];
            const currentEnemyIds = new Set<string>();

            for (const e of viewportEnemies) {
                currentEnemyIds.add(e.id);
                const ex = quantize(e.x, 1);
                const ey = quantize(e.y, 1);
                const eh = Math.round(e.health);
                const eH = Math.round(e.maxHealth);
                const eL = e.leaderId;
                const prev = lastEnemies.get(e.id);

                // Default maxHealth comes from the mob config for (type, tier). When the
                // server-side enemy matches that default, omit H entirely; the client looks
                // it up the same way. Same for the default tier 'common'.
                const defaultStats = getMobStats(e.type, e.tier);
                const defaultMaxH = defaultStats ? Math.round(defaultStats.health) : eH;
                if (!prev) {
                    const ed: any = { i: e.id, t: e.type, x: ex, y: ey };
                    if (e.tier !== 'common') ed.T = e.tier;
                    ed.h = eh;
                    if (eH !== defaultMaxH) ed.H = eH;
                    if (eL !== undefined) ed.L = eL;
                    changedEnemies.push(ed);
                    lastEnemies.set(e.id, { x: ex, y: ey, h: eh, H: eH, t: e.type, T: e.tier, L: eL });
                } else if (prev.x !== ex || prev.y !== ey || prev.h !== eh || prev.H !== eH || prev.t !== e.type || prev.T !== e.tier || prev.L !== eL) {
                    const ed: any = { i: e.id };
                    if (prev.x !== ex) ed.x = ex;
                    if (prev.y !== ey) ed.y = ey;
                    if (prev.h !== eh) ed.h = eh;
                    if (prev.H !== eH) ed.H = eH;
                    if (prev.t !== e.type) ed.t = e.type;
                    if (prev.T !== e.tier) ed.T = e.tier;
                    if (prev.L !== eL) ed.L = eL ?? null;
                    changedEnemies.push(ed);
                    lastEnemies.set(e.id, { x: ex, y: ey, h: eh, H: eH, t: e.type, T: e.tier, L: eL });
                } else {
                    unchangedIds.push(e.id);
                }
            }

            for (const id of lastEnemies.keys()) {
                if (!currentEnemyIds.has(id)) lastEnemies.delete(id);
            }

            // Build compact payload. Omit empty fields entirely.
            const gameState: any = { t: now };
            if (changedPlayers.length > 0) gameState.P = changedPlayers;
            if (changedEnemies.length > 0) gameState.E = changedEnemies;
            if (unchangedIds.length > 0) gameState.U = unchangedIds;

            socket.lastUpdateTime = now;
            io.to(playerId).emit('gameStateUpdate', gameState);
        }
    }, TICK_INTERVAL);
}

// Start the server
server.listen(PORT, () => {
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

// Memory watchdog: log every 10s, restart process if heap usage > 80% of V8 heap limit.
// Requires a process supervisor (systemd, pm2, docker --restart, etc.) to actually bring the server back up.
const MEMORY_RESTART_THRESHOLD = 0.8;
const MEMORY_CHECK_INTERVAL = 10000;
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

    if (heapUsedPct >= MEMORY_RESTART_THRESHOLD && !memoryRestartInProgress) {
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

// Add special mob spawning timer (every 1 minute)
setInterval(() => {
    const playerCount = Object.keys(players).length;
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
    Object.entries(players).forEach(([socketId, player]) => {
        const socket = io.sockets.sockets.get(socketId) as AuthenticatedSocket;
        if (socket && socket.userId) {
            socket.emit('savePlayerProgress', player);
            savePlayerProgress(player, socket.userId);
        }
    });
}, SAVE_INTERVAL);