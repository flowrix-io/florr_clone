import express from 'express';
import { createServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { database } from './database';
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
import { ServerPlayer, PlayerProgress, PlayerInventory } from './player';
import { executePetalActions, updatePlayerEffects, getDamageMultiplier, getSpeedMultiplier, getShieldAmount, executePetalActionsOnSpawn, updatePetalActions, handlePetalCollision, cleanupPetalActions, updatePetalPosition, spawnPet, despawnPet } from './petal_actions';
import { RARITY_LEVELS, Rarity } from './petals';
import { PLAYER_DAMAGE, WORLD_WIDTH, WORLD_HEIGHT, ZONE_BOUNDARIES, ENEMY_TIERS, KNOCKBACK_RECOVERY_SPEED, FISH_DETECTION_RADIUS, ENEMY_SIZE, PLAYER_SIZE, KNOCKBACK_FORCE, DROP_CHANCES, PLAYER_MAX_HEALTH, HEALTH_PER_LEVEL, DAMAGE_PER_LEVEL, BASE_XP_REQUIREMENT, XP_MULTIPLIER, RESPAWN_INVULNERABILITY_TIME, enemies, players, dots, obstacles, OBSTACLE_COUNT, ENEMY_CORAL_PROBABILITY, ENEMY_CORAL_HEALTH, SAND_COUNT, DECORATION_COUNT, WORLD_MAP, MapElement, BiomeSpawnEntry, isWall, isTeleporter, ACTUAL_WORLD_HEIGHT, ACTUAL_WORLD_WIDTH, SCALE_FACTOR, MAX_SPEED, MOUSE_NONLINEAR_SCALE, MOUSE_NONLINEAR_EXPONENT, VIEWPORT_BUFFER, ENEMY_DESPAWN_TIME, ENEMIES_PER_VIEWPORT, ORIGINAL_ENEMY_DENSITY, ORIGINAL_ENEMY_COUNT, VIEWPORT_WITH_BUFFER_AREA, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, TOTAL_WORLD_AREA, getServerConfigs, getServerConfigByPort, ServerConfig } from './constants';
import { Enemy, Obstacle, createDecoration, getRandomPositionInZone, Decoration, Sand, createSand, getXPFromEnemy, PoisonEffect } from './server_utils';
import { MobProjectile, PlayerProjectile } from './enemy';
import { Item, ItemWithRarity, WorldItem } from './item';
import { getAllPetalTypes, getPetalStats } from './petals';
import { MOB_CONFIG, getMobStats, getAllMobTypes, calculateMobDrops, DropItem } from './mobs';

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
    checkPlayerWallCollisions,
    checkEnemyWallCollisions,
    checkItemWallCollisions,
    checkProjectileWallCollision,
    hasLineOfSight,
    getExtendedWallForCollision,
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
    PlayerStateDependencies
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
    recalculatePlayerStats
} from './server/playerManager';
import { setupTransferEndpoints, transferPlayerToServer as transferPlayerToServerModule } from './server/crossServer';
import { 
    createEnemy as createEnemyModule, 
    createSpecialMob as createSpecialMobModule,
    spawnSpecialMobs as spawnSpecialMobsModule,
    updateSpecialMobCounts as updateSpecialMobCountsModule,
    EnemySpawnerHelpers
} from './server/enemySpawner';

const app = express();

// Re-export functions that are used elsewhere
export { trackDamage, sendBossMobDefeatedMessage };

// Wrapper function for handleMobDrops that passes io (will be set up later)
let ioInstance: any;
export function handleMobDrops(enemy: Enemy) {
    handleMobDropsModule(enemy, ioInstance);
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

// Create server based on protocol configuration
let server: http.Server | https.Server;

if (USE_HTTPS) {
    try {
        server = createServer({
            key: fs.readFileSync('cert.key'),
            cert: fs.readFileSync('cert.crt')
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

const io = new Server(server, {
    cors: {
        origin: function (origin, callback) {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);

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
            const enemiesToSpawn = Math.min(5, targetEnemyCount - currentViewportEnemies);
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
    return createEnemyModule(enemySpawnerHelpers);
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
    const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
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
        }
        
        // Check if position is in a safe zone
        const inSafeZone = WORLD_MAP.some(element =>
            element.type === 'safe_zone' &&
            spawnX! >= element.x * SCALE_FACTOR &&
            spawnX! <= (element.x + element.width) * SCALE_FACTOR &&
            spawnY! >= element.y * SCALE_FACTOR &&
            spawnY! <= (element.y + element.height) * SCALE_FACTOR
        );

        // Check if position collides with walls
        const collidesWithWall = WORLD_MAP.some(element =>
            element.type === 'wall' &&
            spawnX! >= element.x * SCALE_FACTOR &&
            spawnX! <= (element.x + element.width) * SCALE_FACTOR &&
            spawnY! >= element.y * SCALE_FACTOR &&
            spawnY! <= (element.y + element.height) * SCALE_FACTOR
        );

        if (!inSafeZone && !collidesWithWall) {
            validPosition = true;
        } else {
            console.log(`Warning: Provided coordinates (${spawnX}, ${spawnY}) are in a safe zone or wall. Finding alternative position...`);
            spawnX = undefined;
            spawnY = undefined;
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
            const viewportBuffer = VIEWPORT_BUFFER;
            const minX = player.x - VIEWPORT_WIDTH/2 - viewportBuffer;
            const maxX = player.x + VIEWPORT_WIDTH/2 + viewportBuffer;
            const minY = player.y - VIEWPORT_HEIGHT/2 - viewportBuffer;
            const maxY = player.y + VIEWPORT_HEIGHT/2 + viewportBuffer;
            
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

            // Check if position collides with walls
            const collidesWithWall = WORLD_MAP.some(element =>
                element.type === 'wall' &&
                spawnX! >= element.x * SCALE_FACTOR &&
                spawnX! <= (element.x + element.width) * SCALE_FACTOR &&
                spawnY! >= element.y * SCALE_FACTOR &&
                spawnY! <= (element.y + element.height) * SCALE_FACTOR
            );

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

                // Check if position collides with walls
                const collidesWithWall = WORLD_MAP.some(element =>
                    element.type === 'wall' &&
                    spawnX! >= element.x * SCALE_FACTOR &&
                    spawnX! <= (element.x + element.width) * SCALE_FACTOR &&
                    spawnY! >= element.y * SCALE_FACTOR &&
                    spawnY! <= (element.y + element.height) * SCALE_FACTOR
                );

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
    enemies.push(enemy);
    
    // Notify all clients
    io.emit('enemySpawned', enemy);
    
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
        const socket = Array.from(ioInstance.sockets.sockets.values()).find((s: any) => s.id === socketId) as AuthenticatedSocket;
        if (socket?.userId) {
            savePlayerProgressModule(player, socket.userId, database);
        }
    }
}

// Wrapper for respawnPlayer that passes io
function respawnPlayer(player: ServerPlayer) {
    respawnPlayerModule(player, ioInstance);
}

// Wrapper for savePlayerProgress that passes database
function savePlayerProgress(player: ServerPlayer, userId: string) {
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

    // Update all clients with the new enemy state
    io.emit('enemiesUpdate', enemies);
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

    // Send map data to the client
    socket.emit('mapData', WORLD_MAP);

    socket.on('playerInput', (inputData: any) => {
        const player = players[socket.id];
        if (player) {
            player.inputs = inputData;
        }
    });

    // Handle authentication
    socket.on('authenticate', async (credentials: { username: string, password: string, playerName: string, spawnBiome?: string }) => {
        const user = database.getUser(credentials.username, credentials.password);

        if (user) {
            socket.userId = user.id;
            socket.username = user.username;
            playerUserIds[socket.id] = user.id; // Store the mapping

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
            
            if (credentials.spawnBiome && credentials.spawnBiome !== 'default') {
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
                const validSpawnPoints = WORLD_MAP.filter(element =>
                    element.type === 'spawn' &&
                    element.properties?.spawnType === 'common'
                );
                
                if (validSpawnPoints.length > 0) {
                    // Try to find a safe spawn position in valid spawn points
                    // Shuffle spawn points to try different ones
                    const shuffledSpawnPoints = [...validSpawnPoints].sort(() => Math.random() - 0.5);
                    
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
                        const spawn = validSpawnPoints[0];
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
                name: credentials.playerName || 'Unnamed',
                x: spawnX,
                y: spawnY,
                angle: 0,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                health: baseMaxHealth, // Will be recalculated with modifiers
                maxHealth: baseMaxHealth, // Will be recalculated with modifiers
                damage: baseDamage, // Will be recalculated with modifiers
                inventory: savedProgress?.inventory || createInitialInventory(),
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
                mobKills: (savedProgress as any)?.mobKills || {}
            };
            
            // Recalculate player stats with modifiers after loadout is set
            recalculatePlayerStats(players[socket.id], io);

            // Start cooldown timers for all petals that are on cooldown
            const player = players[socket.id];
            if (player && player.loadout) {
                for (let i = 0; i < player.loadout.length; i++) {
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
                            const timeout = setTimeout(() => {
                                petalCooldownTimeouts.delete(timeoutKey);
                                if (players[socket.id] && players[socket.id].loadout[i] && players[socket.id].loadout[i]!.onCooldown) {
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
            
            // Send initial skills update
            socket.emit('skillsUpdated', {
                playerId: players[socket.id].id,
                tp: players[socket.id].tp || 0,
                skills: players[socket.id].skills || {}
            });

            // Send current game state
            socket.emit('currentPlayers', players);
            socket.emit('enemiesUpdate', enemies);
            socket.emit('obstaclesUpdate', obstacles);
            
            // Filter items to only send ones this player is eligible for and hasn't picked up yet
            const eligibleItems = items.filter(item => {
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
        if (players[socket.id] && socket.userId) {
            // console.log('Saving player progress for userId:', socket.userId);
            savePlayerProgress(players[socket.id], socket.userId);
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
        
        delete players[socket.id];
        delete playerUserIds[socket.id]; // Clean up the mapping
        
        // Remove all event listeners to prevent memory leaks
        // Socket.IO will handle cleanup, but we can be explicit for unauthenticated connections
        socket.removeAllListeners();
        
        // Only emit to authenticated players (not to unauthenticated title screen connections)
        const authenticatedSockets = Array.from(io.sockets.sockets.values())
            .filter((s: any) => (s as AuthenticatedSocket).userId);
        if (authenticatedSockets.length > 0) {
            io.emit('playerDisconnected', socket.id);
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
        const player = players[socket.id];
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
                    if (players[socket.id]) {
                        players[socket.id].speed_boost = 1;
                        // console.log('Speed boost wore off');
                    }
                }, 5000 * multiplier);
                break;
            case 'shield':
                player.isInvulnerable = true;
                // console.log('Applied shield effect');
                setTimeout(() => {
                    if (players[socket.id]) {
                        players[socket.id].isInvulnerable = false;
                        // console.log('Shield wore off');
                    }
                }, 3000 * multiplier);
                break;
            case 'petal':
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
    socket.on('updateName', (newName: string) => {
        const player = players[socket.id];
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
    function validateInventoryAndLoadout(
        newInventory: PlayerInventory, 
        newLoadout: (Item | null)[], 
        oldLoadout: (Item | null)[],
        oldInventory: PlayerInventory
    ): (Item | null)[] {
        // Validate inventory structure
        if (!newInventory || typeof newInventory !== 'object') {
            console.warn('[SERVER] Invalid inventory structure, using empty inventory');
            newInventory = {};
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

            const rarityInventory = inventory[item.rarity];
            if (!rarityInventory || typeof rarityInventory !== 'object') {
                return false;
            }

            const itemCount = rarityInventory[inventoryKey];
            return itemCount !== undefined && itemCount !== null && itemCount > 0;
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

    socket.on('updateLoadout', (data: { loadout: (Item | null)[]; inventory: PlayerInventory }) => {
        // console.log('[PET DEBUG] updateLoadout called for socket:', socket.id);
        const player = players[socket.id];
        if (!player) {
            console.warn('[SERVER] updateLoadout: Player not found for socket:', socket.id);
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
            const serverInventory = { ...oldInventory };
            
            // Validate inventory and loadout - unequip items that don't exist in inventory
            const validatedLoadout = validateInventoryAndLoadout(serverInventory, data.loadout, oldLoadout, serverInventory);
            
            // Calculate inventory changes based on loadout changes
            // Items that were unequipped should be added back to inventory
            // Items that were newly equipped should be removed from inventory
            oldLoadout.forEach((oldItem, index) => {
                const newItem = validatedLoadout[index];
                
                // Helper to get inventory key for an item
                const getInventoryKey = (item: Item | null): string | null => {
                    if (!item || !item.rarity) return null;
                    if (item.type === 'petal') {
                        if (!item.petalType) return null;
                        return `petal_${item.petalType}`;
                    }
                    return item.type;
                };
                
                // Helper to check if items match
                const itemsMatch = (item1: Item | null, item2: Item | null): boolean => {
                    if (!item1 || !item2) return false;
                    if (item1.type !== item2.type) return false;
                    if (item1.rarity !== item2.rarity) return false;
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
                        addItem(serverInventory, oldItem.rarity, oldKey, 1);
                    }
                    
                    // If the unequipped item was a petal with petMobType, despawn the pet
                    if (oldItem.type === 'petal' && oldItem.petalType && oldItem.rarity) {
                        const oldPetalStats = getPetalStats(oldItem.petalType, oldItem.rarity);
                        if (oldPetalStats?.petMobType) {
                            const petToDespawn = enemies.find(e => 
                                e.ownerId === player.id && 
                                e.type === oldPetalStats.petMobType
                            );
                            if (petToDespawn) {
                                // console.log(`[PET] Despawning pet ${oldPetalStats.petMobType} for player ${player.id} when petal unequipped`);
                                despawnPet(petToDespawn, io);
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
                            removeItem(serverInventory, newItem.rarity, newKey, 1);
                        } else {
                            console.warn(`[SERVER] Attempted to equip ${newKey} (${newItem.rarity}) but it doesn't exist in inventory`);
                        }
                    }
                }
            });
            
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
                            setTimeout(() => {
                                if (players[socket.id] && players[socket.id].loadout[index] && 
                                    players[socket.id].loadout[index]!.onCooldown) {
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
                                    players[socket.id].loadout[index] = restoredPetal;
                                    
                                    io.emit('petalRestored', {
                                        playerId: players[socket.id].id,
                                        slotIndex: index,
                                        petal: players[socket.id].loadout[index]
                                    });
                                    
                                    // Check if this petal should spawn a pet when restored
                                    // Get fresh petal stats to ensure we have the latest petMobType
                                    if (restoredPetal.petalType && restoredPetal.rarity) {
                                        const restoredPetalStats = getPetalStats(restoredPetal.petalType, restoredPetal.rarity);
                                        // console.log(`[PET DEBUG] Restored petal stats:`, restoredPetalStats ? { petMobType: restoredPetalStats.petMobType, petMobRarity: restoredPetalStats.petMobRarity } : 'null');
                                        if (restoredPetalStats?.petMobType && restoredPetal.rarity) {
                                            const petMobType = restoredPetalStats.petMobType;
                                            // Pet inherits the petal's rarity
                                            const player = players[socket.id];
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
                            const player = players[socket.id];
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
            
            // Recalculate player stats based on equipped petal modifiers
            recalculatePlayerStats(player, io);
            
            io.emit('playerUpdated', player);
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

        // Check for commands
        if (message.startsWith('/')) {
            const command = message.substring(1).toLowerCase();
            
            if (command === 'help') {
                const isAdmin = socket.username ? database.isUserAdmin(socket.username) : false;
                let helpText = 'Available commands:\n';
                helpText += '/list_ultra - List all ultra mobs <br/>';
                helpText += '/list_super - List all super mobs <br/>';
                helpText += '/list_unique - List all unique mobs <br/>';
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
                    io.emit('chatMessage', {
                        sender: 'System',
                        content: 'No ultra mobs currently spawned.',
                        timestamp: Date.now()
                    });
                } else {
                    ultraMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / SCALE_FACTOR);
                        const y = Math.round(mob.y / SCALE_FACTOR);
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
                const superMobs = enemies.filter(e => e.tier === 'super' && e.type !== 'target_dummy');
                if (superMobs.length === 0) {
                    io.emit('chatMessage', {
                        sender: 'System',
                        content: 'No super mobs currently spawned.',
                        timestamp: Date.now()
                    });
                } else {
                    superMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / SCALE_FACTOR);
                        const y = Math.round(mob.y / SCALE_FACTOR);
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
                const uniqueMobs = enemies.filter(e => e.tier === 'unique' && e.type !== 'target_dummy');
                if (uniqueMobs.length === 0) {
                    io.emit('chatMessage', {
                        sender: 'System',
                        content: 'No unique mobs currently spawned.',
                        timestamp: Date.now()
                    });
                } else {
                    uniqueMobs.forEach((mob, index) => {
                        const x = Math.round(mob.x / SCALE_FACTOR);
                        const y = Math.round(mob.y / SCALE_FACTOR);
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
    });

    // Add this after socket handlers but before socket.on('authenticate'...)
    socket.on('requestChatHistory', () => {
        socket.emit('chatHistory', chatHistory);
    });

    // Handle ping/pong for heartbeat monitoring
    socket.on('ping', (clientTime: number) => {
        socket.emit('pong', clientTime);
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
        const validSkills = ['damage', 'petalHealth', 'playerHealth', 'healingMultiplier'];
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
                       countSpentTP(player.skills?.healingMultiplier);

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

        // Emit skills update
        io.emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });

        // Emit player update to sync stats
        io.emit('playerUpdated', player);
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
            const removed = removeItem(player.inventory, rarity, itemKey, data.items.length);
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
                addItem(player.inventory, newRarity, itemKey, successfulCrafts);
                
                // Send global notification for super or unique petal crafts
                if ((newRarity === 'super' || newRarity === 'unique') && type === 'petal' && petalType) {
                    const petalStats = getPetalStats(petalType, newRarity);
                    if (petalStats) {
                        const rarityColors: Record<string, string> = {
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
        } catch (error) {
            console.error('[CRAFT] Error during crafting:', error);
            socket.emit('craftingFailed', 'An error occurred during crafting');
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
            enemy.health -= poisonDamageThisTick;
            
            // Track poison damage for all contributing players
            activePoisons.forEach(poison => {
                trackDamage(enemy, poison.playerId, poison.damage * deltaTime * 1000);
            });
            
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            
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
                    
                    // Track mob kill for eligible players
                    trackMobKill(enemy, players, playerUserIds, database, io);
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

function moveEnemies() {
    const currentTime = Date.now();

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
                        
                        // Check if this position is safe (not in wall) and has line of sight to owner
                        const mobStats = getMobStats(enemy.type, enemy.tier);
                        const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
                        const halfSize = enemySize / 2;
                        
                        // Check if position is inside a wall
                        let isInWall = false;
                        for (const element of WORLD_MAP) {
                            if (element.type === 'wall' && element.width > 0 && element.height > 0) {
                                const wallX = element.x * SCALE_FACTOR;
                                const wallY = element.y * SCALE_FACTOR;
                                const wallWidth = element.width * SCALE_FACTOR;
                                const wallHeight = element.height * SCALE_FACTOR;
                                
                                const extendedWall = getExtendedWallForCollision({
                                    x: wallX,
                                    y: wallY,
                                    width: wallWidth,
                                    height: wallHeight
                                });
                                
                                if (
                                    teleportX - halfSize < extendedWall.x + extendedWall.width &&
                                    teleportX + halfSize > extendedWall.x &&
                                    teleportY - halfSize < extendedWall.y + extendedWall.height &&
                                    teleportY + halfSize > extendedWall.y
                                ) {
                                    isInWall = true;
                                    break;
                                }
                            }
                        }
                        
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
                        const mobStats = getMobStats(enemy.type, enemy.tier);
                        const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
                        const halfSize = enemySize / 2;
                        
                        // Check if owner's position is safe for pet
                        let isOwnerPosInWall = false;
                        for (const element of WORLD_MAP) {
                            if (element.type === 'wall' && element.width > 0 && element.height > 0) {
                                const wallX = element.x * SCALE_FACTOR;
                                const wallY = element.y * SCALE_FACTOR;
                                const wallWidth = element.width * SCALE_FACTOR;
                                const wallHeight = element.height * SCALE_FACTOR;
                                
                                const extendedWall = getExtendedWallForCollision({
                                    x: wallX,
                                    y: wallY,
                                    width: wallWidth,
                                    height: wallHeight
                                });
                                
                                if (
                                    owner.x - halfSize < extendedWall.x + extendedWall.width &&
                                    owner.x + halfSize > extendedWall.x &&
                                    owner.y - halfSize < extendedWall.y + extendedWall.height &&
                                    owner.y + halfSize > extendedWall.y
                                ) {
                                    isOwnerPosInWall = true;
                                    break;
                                }
                            }
                        }
                        
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
                                    maxDistance: projectileConfig.distance,
                                    petalType: projectileConfig.petalType,
                                    petalRarity: projectileRarity,
                                    damage: petalStats.damage,
                                    size: petalStats.size,
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
        if (!targetPlayer) {
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
        if (target && enemy.isHostile) {
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
                enemy.x += (dx / distance) * speed;
                enemy.y += (dy / distance) * speed;
                // Only update angle if mob has speed > 0
                if (enemy.speed > 0) {
                    enemy.angle = Math.atan2(dy, dx);
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
                                maxDistance: projectileConfig.distance,
                                petalType: projectileConfig.petalType,
                                petalRarity: projectileRarity,
                                damage: petalStats.damage,
                                size: petalStats.size,
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
                trackMobKill(enemy, players, playerUserIds, database);
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
    
    io.emit('enemiesUpdate', enemies);
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
        
        // Check if projectile has traveled max distance
        if (projectile.distance >= projectile.maxDistance) {
            mobProjectiles.splice(i, 1);
            continue;
        }
        
        // Check for wall collisions
        const projectileSize = projectile.size * 20; // Convert to pixels
        const halfSize = projectileSize / 2;
        
        if (checkProjectileWallCollision(projectile.x, projectile.y, halfSize)) {
            mobProjectiles.splice(i, 1);
            continue;
        }
        
        // Check for collision with player petals first (treat mob projectiles as enemy petals)
        let hitPlayerPetal = false;
        const playerArray: ServerPlayer[] = Object.values(players);
        for (const player of playerArray) {
            if (player.isDead || !player.loadout) continue;
            
            // Build array of petal instances considering count property
            const petalInstances: Array<{petal: any, instanceIndex: number, loadoutIndex: number}> = [];
            try {
                for (let loadoutIdx = 0; loadoutIdx < player.loadout.length; loadoutIdx++) {
                    const petal = player.loadout[loadoutIdx];
                    if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                        const petalStats = getPetalStats(petal.petalType, petal.rarity);
                        if (!petalStats) continue;
                        
                        const count = petalStats.count || 1;
                        if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                            continue;
                        }
                        
                        for (let j = 0; j < count; j++) {
                            petalInstances.push({ petal: petal, instanceIndex: j, loadoutIndex: loadoutIdx });
                        }
                    }
                }
            } catch (error) {
                console.error('Error building petal instances for projectile collision:', error);
                continue;
            }
            
            if (petalInstances.length === 0) continue;
            
            const currentTime = Date.now();
            const petalExtension = player.inputs?.petalExtension || 1.0;
            const baseRadius = 60 * petalExtension;
            const angleStep = petalInstances.length > 0 ? (Math.PI * 2) / petalInstances.length : 0;
            
            for (let idx = 0; idx < petalInstances.length; idx++) {
                const {petal, instanceIndex, loadoutIndex} = petalInstances[idx];
                
                if (!petal || !petal.health || petal.health <= 0 || petal.onCooldown) {
                    continue;
                }
                
                const petalStats = getPetalStats(petal.petalType, petal.rarity);
                if (!petalStats) continue;
                
                // Get effective size (custom size if set, otherwise base stats)
                const effectiveSize = (petal as any).customSize !== undefined ? (petal as any).customSize : petalStats.size;
                
                const rotationSpeed = (petalStats.speed ?? 1.0) * 0.002;
                const baseAngle = idx * angleStep;
                const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
                const totalAngle = baseAngle + rotationAngle;
                
                const petalRange = petalStats.range ?? 1.0;
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
                    const projectilePetalStats = getPetalStats(projectile.petalType, projectile.petalRarity);
                    const projectileDamage = projectilePetalStats ? projectilePetalStats.damage : projectile.damage;
                    
                    // Damage the player petal
                    petal.health -= projectileDamage;
                    
                    // Damage the mob projectile
                    projectile.health -= petalStats.damage;
                    
                    hitPlayerPetal = true;
                    
                    // Remove projectile if destroyed
                    if (projectile.health <= 0) {
                        mobProjectiles.splice(i, 1);
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
        
        // Check for collision with wild mobs (enemies without ownerId) if this is a pet projectile
        const projectileEnemy = enemies.find(e => e.id === projectile.enemyId);
        const isPetProjectile = projectileEnemy?.ownerId;
        const petOwnerId = projectileEnemy?.ownerId;
        
        if (!hitPlayerPetal && projectile.health > 0 && isPetProjectile && petOwnerId) {
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
                    
                    targetEnemy.health -= projectileDamage;
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
                            const xpGained = getXPFromEnemy(targetEnemy);
                            addXPToPlayer(owner, xpGained, petOwnerId);
                            trackMobKill(targetEnemy, players, playerUserIds, database);
                            handleMobDrops(targetEnemy);
                            sendBossMobDefeatedMessage(targetEnemy, io, players);
                        }
                        // Clean up enemy data structures before removal to prevent memory leaks
                        cleanupEnemy(targetEnemy);
                        updateSpecialMobCounts();
                        enemies.splice(j, 1);
                        io.emit('enemyDestroyed', targetEnemy.id);
                    }
                    
                    // Remove projectile after hitting enemy
                    mobProjectiles.splice(i, 1);
                    break;
                }
            }
        }
        
        // Only check for direct player collision if we didn't hit a petal and projectile still exists
        // Skip projectiles from pets (enemies with ownerId)
        if (!hitPlayerPetal && projectile.health > 0 && !isPetProjectile) {
            for (const player of playerArray) {
                if (player.isDead) continue;
                
                const dx = player.x - projectile.x;
                const dy = player.y - projectile.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const hitRadius = PLAYER_SIZE / 2 + halfSize;
                
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
                    mobProjectiles.splice(i, 1);
                    break;
                }
            }
        }
    }
    
    // Emit projectile updates to clients
    io.emit('mobProjectilesUpdate', mobProjectiles);
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
                
                // Check if enemy dies (only process once per enemy)
                if (enemy.health <= 0 && !(enemy as any).isDead) {
                    // Mark enemy as dead to prevent multiple death handlers
                    (enemy as any).isDead = true;
                    
                    const xpGained = getXPFromEnemy(enemy);
                    addXPToPlayer(player, xpGained, projectile.playerId);
                    trackMobKill(enemy, players, playerUserIds, database, io);
                    handleMobDrops(enemy);
                    sendBossMobDefeatedMessage(enemy, io, players);
                    // Clean up enemy data structures before removal to prevent memory leaks
                    cleanupEnemy(enemy);
                    updateSpecialMobCounts();
                    enemies.splice(j, 1);
                    io.emit('enemyDestroyed', enemy.id);
                }
                
                // Remove projectile after hitting enemy
                playerProjectiles.splice(i, 1);
                break;
            }
        }
    }
    
    // Emit projectile updates to clients
    io.emit('playerProjectilesUpdate', playerProjectiles);
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
        
        // Skip game processing if there are no authenticated players
        if (authenticatedPlayerIds.length === 0) {
            return;
        }

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
        
        // Despawn enemies that have been outside viewport for too long
        despawnDistantEnemies();

        // Check and fix item-wall collisions for all items
        for (const item of items) {
            checkItemWallCollisions(item);
        }

        // Delete items that go out of bounds
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.x < 0 || item.x >= ACTUAL_WORLD_WIDTH || item.y < 0 || item.y >= ACTUAL_WORLD_HEIGHT) {
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

        const playersForBroadcast = Object.values(players).map(p => ({
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            angle: p.angle,
            health: p.health,
            maxHealth: p.maxHealth,
            level: p.level,
            score: p.score,
            petalExtension: p.inputs?.petalExtension || 1.0
        }));

        // Only emit gameStateUpdate to authenticated players, not all sockets
        // This prevents memory leaks from sending updates to unauthenticated title screen connections
        for (const playerId of authenticatedPlayerIds) {
            io.to(playerId).emit('gameStateUpdate',
                {
                players: playersForBroadcast,
                enemies: enemies,
                    // Items are sent via itemSpawned/itemRemoved events to eligible players only
                    // Don't send items here to avoid showing items to ineligible players
                    items: [],
                    dots: dots,
                    timestamp: Date.now()
                }
            );
        }
    }, TICK_INTERVAL);
}

// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on ${SERVER_PROTOCOL}://localhost:${PORT}`);
});

start_loop();

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
        
        if (currentViewportEnemies < targetEnemyCount) {
            const enemiesToSpawn = Math.min(3, targetEnemyCount - currentViewportEnemies);
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