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
import { ServerPlayer, PlayerProgress, PlayerInventory } from './player';
import { executePetalActions, updatePlayerEffects, getDamageMultiplier, getSpeedMultiplier, getShieldAmount, executePetalActionsOnSpawn, updatePetalActions, handlePetalCollision, cleanupPetalActions, updatePetalPosition } from './petal_actions';
import { PLAYER_DAMAGE, WORLD_WIDTH, WORLD_HEIGHT, ZONE_BOUNDARIES, ENEMY_TIERS, KNOCKBACK_RECOVERY_SPEED, FISH_DETECTION_RADIUS, ENEMY_SIZE, PLAYER_SIZE, KNOCKBACK_FORCE, DROP_CHANCES, PLAYER_MAX_HEALTH, HEALTH_PER_LEVEL, DAMAGE_PER_LEVEL, BASE_XP_REQUIREMENT, XP_MULTIPLIER, RESPAWN_INVULNERABILITY_TIME, enemies, players, dots, obstacles, OBSTACLE_COUNT, ENEMY_CORAL_PROBABILITY, ENEMY_CORAL_HEALTH, SAND_COUNT, DECORATION_COUNT, WORLD_MAP, MapElement, BiomeSpawnEntry, isWall, isTeleporter, ACTUAL_WORLD_HEIGHT, ACTUAL_WORLD_WIDTH, SCALE_FACTOR, MAX_SPEED, MOUSE_NONLINEAR_SCALE, MOUSE_NONLINEAR_EXPONENT, VIEWPORT_BUFFER, ENEMY_DESPAWN_TIME, ENEMIES_PER_VIEWPORT, ORIGINAL_ENEMY_DENSITY, ORIGINAL_ENEMY_COUNT, VIEWPORT_WITH_BUFFER_AREA, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, TOTAL_WORLD_AREA, getServerConfigs, getServerConfigByPort, ServerConfig } from './constants';
import { Enemy, Obstacle, createDecoration, getRandomPositionInZone, Decoration, Sand, createSand, getXPFromEnemy, PoisonEffect } from './server_utils';
import { MobProjectile, PlayerProjectile } from './enemy';
import { Item, ItemWithRarity, WorldItem } from './item';
import { getAllPetalTypes, getPetalStats } from './petals';
import { MOB_CONFIG, getMobStats, getAllMobTypes, calculateMobDrops, DropItem } from './mobs';
const app = express();

const items: WorldItem[] = [];

// Special mob tracking
let ultraMobCount = 0;
let superMobCount = 0;
let uniqueMobCount = 0;

const decorations: Decoration[] = [];
const sands: Sand[] = [];
let ENEMY_COUNT = 1000;
const playerUserIds: Record<string, string> = {}; // Maps player ID to user ID
const mobProjectiles: MobProjectile[] = []; // Track all active mob projectiles
const playerProjectiles: PlayerProjectile[] = []; // Track all active player projectiles
const petalLastProjectileTime: Map<string, number> = new Map(); // Track last projectile time per petal instance

// Item expiration times based on rarity (in milliseconds)
const ITEM_EXPIRATION_TIMES: Record<string, number> = {
    common: 10000,      // 10 seconds
    uncommon: 20000,    // 20 seconds
    rare: 30000,        // 30 seconds
    epic: 40000,        // 40 seconds
    legendary: 50000,   // 50 seconds
    mythic: 60000,      // 60 seconds
    ultra: 80000,       // 80 seconds
    super: 120000,      // 120 seconds
    unique: 300000      // 300 seconds (5 minutes)
};

// Helper function to track damage dealt to an enemy
export function trackDamage(enemy: Enemy, playerId: string, damage: number) {
    if (!enemy.damageContributors) {
        enemy.damageContributors = new Map();
    }
    const currentDamage = enemy.damageContributors.get(playerId) || 0;
    enemy.damageContributors.set(playerId, currentDamage + damage);
    // console.log(`[DAMAGE] Player ${playerId} dealt ${damage} to ${enemy.type} (${enemy.tier}) - total: ${currentDamage + damage}`);
}

// Helper function to get eligible players for a drop based on damage ranking
function getEligiblePlayers(enemy: Enemy): string[] {
    if (!enemy.damageContributors || enemy.damageContributors.size === 0) {
        return [];
    }
    
    // Sort players by damage dealt (highest first)
    const sortedPlayers = Array.from(enemy.damageContributors.entries())
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
    
    // Determine placement requirement based on mob rarity
    const isUltraOrAbove = ['ultra', 'super', 'unique'].includes(enemy.tier);
    const placementRequirement = isUltraOrAbove ? 15 : 4;
    
    // Return top N players who qualify
    return sortedPlayers.slice(0, placementRequirement);
}

// Function to handle mob drops when a mob dies
export function handleMobDrops(enemy: Enemy) {
    const mobType = enemy.type || 'bee'; // Default to bee if type is not set
    const drops = calculateMobDrops(mobType, enemy.tier);
    
    // Get list of eligible players based on damage ranking
    const eligiblePlayers = getEligiblePlayers(enemy);
    
    // If no players dealt damage, don't drop anything
    if (eligiblePlayers.length === 0) {
        console.log(`[DROP] Mob ${enemy.type} (${enemy.tier}) died with no damage contributors - no drops`);
        return;
    }
    
    console.log(`[DROP] Mob ${enemy.type} (${enemy.tier}) drops for ${eligiblePlayers.length} eligible players`);
    
    for (const drop of drops) {
        // Determine quantity
        const quantity = 1; // Simplified to always drop 1 item
        
        // Create items for each quantity
        for (let q = 0; q < quantity; q++) {
            const offsetX = (Math.random() - 0.5) * 100;
            const offsetY = (Math.random() - 0.5) * 100;
            
            const itemId = Math.random().toString(36).substr(2, 9);
            const spawnTime = Date.now();
            
            const newItem: WorldItem = {
                id: itemId,
                type: drop.type === 'consumable' ? drop.itemType as Item['type'] : 'petal',
                x: enemy.x + offsetX,
                y: enemy.y + offsetY,
                rarity: drop.rarity,
                petalType: drop.type === 'petal' ? drop.itemType : undefined,
                eligiblePlayers: eligiblePlayers,
                pickedUpBy: new Set(),
                spawnTime: spawnTime
            };
            
            items.push(newItem);
            
            // Only send itemSpawned event to eligible players
            for (const playerId of eligiblePlayers) {
                io.to(playerId).emit('itemSpawned', newItem);
            }
            
            // Schedule automatic removal after expiration time
            const expirationTime = ITEM_EXPIRATION_TIMES[drop.rarity] || 10000;
            setTimeout(() => {
                const itemIndex = items.findIndex(item => item.id === itemId);
                if (itemIndex !== -1) {
                    const expiredItem = items[itemIndex];
                    items.splice(itemIndex, 1);
                    
                    // Notify eligible players that item expired
                    if (expiredItem.eligiblePlayers) {
                        for (const playerId of expiredItem.eligiblePlayers) {
                            io.to(playerId).emit('itemRemoved', itemId);
                        }
                    }
                    
                    console.log(`[DROP] Item ${itemId} (${drop.rarity}) expired after ${expirationTime}ms`);
                }
            }, expirationTime);
        }
    }
}

// Helper function to create initial basic petals for new players
function createInitialBasicPetals() {
    const basicPetalStats = getPetalStats('basic', 'common');
    if (!basicPetalStats) {
        console.error('Failed to get basic petal stats');
        return [];
    }
    
    return Array(5).fill(null).map(() => ({
        type: 'petal' as const,
        rarity: 'common' as const,
        petalType: 'basic',
        health: basicPetalStats.health,
        maxHealth: basicPetalStats.health,
        onCooldown: false
    }));
}

// Helper function to create initial inventory with basic petals
function createInitialInventory(): PlayerInventory {
    return {
        common: {
            'petal_basic': 5
        }
    };
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

// Cross-server player transfer endpoints
app.post('/transfer/player', (req, res) => {
    const { playerData, targetX, targetY } = req.body;
    
    if (!playerData) {
        return res.status(400).json({ message: 'Player data is required' });
    }
    
    try {
        // Handle incoming player transfer from another server
        console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Receiving transferred player: ${playerData.name}`);
        
        // Create a temporary socket ID for the transferred player
        const tempSocketId = `transfer_${Date.now()}_${Math.random()}`;
        
        // Add the transferred player to this server
        const transferToken = Math.random().toString(36).substr(2, 9);
        players[tempSocketId] = {
            ...playerData,
            id: tempSocketId,
            x: targetX || 200,
            y: targetY || WORLD_HEIGHT / 2,
            isTransferred: true, // Mark as transferred so client can reconnect
            transferToken: transferToken // Token for client to claim this player
        };
        
        // Set a timeout to clean up unclaimed transfers after 30 seconds
        setTimeout(() => {
            if (players[tempSocketId] && players[tempSocketId].isTransferred) {
                console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Cleaning up unclaimed transfer: ${tempSocketId}`);
                delete players[tempSocketId];
            }
        }, 30000);
        
        res.json({ 
            success: true, 
            tempPlayerId: tempSocketId,
            transferToken: players[tempSocketId].transferToken,
            serverInfo: CURRENT_SERVER_CONFIG
        });
        
    } catch (error) {
        console.error('Error handling player transfer:', error);
        res.status(500).json({ message: 'Failed to transfer player' });
    }
});

app.post('/transfer/claim', (req, res) => {
    const { transferToken, newSocketId } = req.body;
    
    if (!transferToken || !newSocketId) {
        return res.status(400).json({ message: 'Transfer token and new socket ID are required' });
    }
    
    // Find the transferred player by token
    const tempPlayerId = Object.keys(players).find(id => 
        players[id].transferToken === transferToken && players[id].isTransferred
    );
    
    if (!tempPlayerId) {
        return res.status(404).json({ message: 'Invalid transfer token or player not found' });
    }
    
    // Move player data to new socket ID
    const playerData = players[tempPlayerId];
    delete playerData.isTransferred;
    delete playerData.transferToken;
    playerData.id = newSocketId;
    
    players[newSocketId] = playerData;
    delete players[tempPlayerId];
    
    console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Player transfer claimed: ${playerData.name} -> ${newSocketId}`);
    res.json({ success: true, playerData });
});

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, '../dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    }
}));

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

// Get current server port and configuration
const PORT = process.env.PORT || 3000;
const CURRENT_SERVER_PORT = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
const SERVER_CONFIGS = getServerConfigs();
const CURRENT_SERVER_CONFIG = getServerConfigByPort(CURRENT_SERVER_PORT) || { port: CURRENT_SERVER_PORT, host: 'localhost', name: `Server${CURRENT_SERVER_PORT}` };

// Remove or comment out these lines since we're not using grid generation anymore
// const MAZE_CELL_SIZE = 1000;
// const MAZE_WALL_THICKNESS = 100;

// Replace the initializeObstacles function with this:
function initializeMapObstacles(): Obstacle[] {
    const mapObstacles: Obstacle[] = [];

    // Convert wall elements from WORLD_MAP to obstacles
    WORLD_MAP.filter(isWall).forEach(wall => {
        mapObstacles.push({
            id: Math.random().toString(36).substr(2, 9),
            x: wall.x * SCALE_FACTOR,
            y: wall.y * SCALE_FACTOR,
            width: wall.width * SCALE_FACTOR,
            height: wall.height * SCALE_FACTOR,
            type: 'coral',
            isEnemy: false
        });
    });

    return mapObstacles;
}

// Update the server initialization code
// Replace the old obstacle initialization with:
obstacles.push(...initializeMapObstacles());

// Viewport optimization functions
function getPlayerViewports(): Array<{x: number, y: number, width: number, height: number}> {
    const viewports: Array<{x: number, y: number, width: number, height: number}> = [];
    
    for (const playerId in players) {
        const player = players[playerId];
        if (player && player.x !== undefined && player.y !== undefined && 
            !isNaN(player.x) && !isNaN(player.y) &&
            player.x >= 0 && player.x <= ACTUAL_WORLD_WIDTH &&
            player.y >= 0 && player.y <= ACTUAL_WORLD_HEIGHT) {
            
            viewports.push({
                x: player.x - VIEWPORT_WIDTH / 2,
                y: player.y - VIEWPORT_HEIGHT / 2,
                width: VIEWPORT_WIDTH,
                height: VIEWPORT_HEIGHT
            });
        }
    }
    
    return viewports;
}

function isPositionInAnyViewport(x: number, y: number): boolean {
    const viewports = getPlayerViewports();
    
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    
    for (const viewport of viewports) {
        const extendedViewport = {
            x: viewport.x - VIEWPORT_BUFFER,
            y: viewport.y - VIEWPORT_BUFFER,
            width: viewport.width + (VIEWPORT_BUFFER * 2),
            height: viewport.height + (VIEWPORT_BUFFER * 2)
        };
        
        if (x >= extendedViewport.x && x <= extendedViewport.x + extendedViewport.width &&
            y >= extendedViewport.y && y <= extendedViewport.y + extendedViewport.height) {
            return true;
        }
    }
    
    return false;
}

function isPositionInPlayerPetalRange(x: number, y: number, mobSize: number): boolean {
    // Check if the mob spawn position would overlap with any player's petal range
    for (const playerId in players) {
        const player = players[playerId];
        if (!player || !player.loadout) continue;
        
        // Calculate player's maximum petal range
        const petalExtension = player.inputs?.petalExtension || 1.0;
        const baseRadius = 60 * petalExtension;
        
        // Find the largest petal size in the player's loadout
        let maxPetalSize = 0;
        for (const item of player.loadout) {
            if (item && item.type === 'petal' && item.petalType && item.rarity) {
                const petalStats = getPetalStats(item.petalType, item.rarity);
                if (petalStats) {
                    const petalSize = 40 * petalStats.size;
                    maxPetalSize = Math.max(maxPetalSize, petalSize);
                }
            }
        }
        
        // Calculate the maximum range from player center (base radius + half petal size + half mob size)
        const maxRange = baseRadius + (maxPetalSize / 2) + (mobSize / 2);
        
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

function getEnemiesInViewportCount(): number {
    const viewports = getPlayerViewports();
    
    // If no players are connected, count all enemies (for initial server startup)
    if (viewports.length === 0) {
        return enemies.length;
    }
    
    let count = 0;
    for (const enemy of enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            count++;
        }
    }
    
    return count;
}

function updateEnemyViewportStatus() {
    const currentTime = Date.now();
    
    for (const enemy of enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            enemy.lastViewportCheck = currentTime;
        }
    }
}

function validatePlayerPositions() {
    // Clean up any invalid player positions that might affect viewport calculations
    for (const playerId in players) {
        const player = players[playerId];
        if (player) {
            // Reset invalid positions to a safe default
            if (isNaN(player.x) || isNaN(player.y) || 
                player.x < 0 || player.x > ACTUAL_WORLD_WIDTH ||
                player.y < 0 || player.y > ACTUAL_WORLD_HEIGHT) {
                
                console.log(`[SERVER] Fixing invalid position for player ${playerId}: (${player.x}, ${player.y})`);
                
                // Reset to center of world
                player.x = ACTUAL_WORLD_WIDTH / 2;
                player.y = ACTUAL_WORLD_HEIGHT / 2;
                
                // Notify client of position correction
                io.to(playerId).emit('positionCorrected', { x: player.x, y: player.y });
            }
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
        enemies.splice(index, 1);
        io.emit('enemyDestroyed', enemy.id);
        // console.log(`[SERVER] Despawned enemy ${enemy.id} (${enemy.type} ${enemy.tier}) - outside viewport for 30+ seconds`);
    }
}

// Helper function to get spawn zone type for a given position
function getSpawnZoneType(x: number, y: number): string | null {
    for (const element of WORLD_MAP) {
        if (element.type === 'spawn' && element.properties?.spawnType) {
            const scaledX = x / SCALE_FACTOR;
            const scaledY = y / SCALE_FACTOR;
            
            if (scaledX >= element.x && 
                scaledX <= element.x + element.width && 
                scaledY >= element.y && 
                scaledY <= element.y + element.height) {
                return element.properties.spawnType;
            }
        }
    }
    return null; // Not in any spawn zone
}

// Helper function to get biome at a given position
function getBiomeAtPosition(x: number, y: number): MapElement | null {
    for (const element of WORLD_MAP) {
        if (element.type === 'biome') {
            const scaledX = x / SCALE_FACTOR;
            const scaledY = y / SCALE_FACTOR;
            
            if (scaledX >= element.x && 
                scaledX <= element.x + element.width && 
                scaledY >= element.y && 
                scaledY <= element.y + element.height) {
                return element;
            }
        }
    }
    return null; // Not in any biome
}

// Helper function to select a spawn from a biome's spawn table
function selectSpawnFromBiomeTable(spawnTable: BiomeSpawnEntry[]): { mobType: string | undefined, tier: Enemy['tier'] } | null {
    if (!spawnTable || spawnTable.length === 0) return null;
    
    // Calculate total weight
    const totalWeight = spawnTable.reduce((sum, entry) => sum + entry.weight, 0);
    
    // Random selection based on weights
    let random = Math.random() * totalWeight;
    
    for (const entry of spawnTable) {
        random -= entry.weight;
        if (random <= 0) {
            return {
                mobType: entry.mobType,
                tier: entry.tier
            };
        }
    }
    
    // Fallback to first entry
    return {
        mobType: spawnTable[0].mobType,
        tier: spawnTable[0].tier
    };
}

// Helper function to get random position in a specific zone type
function getRandomPositionInZoneType(zoneType: string): { x: number, y: number } | null {
    const zones = WORLD_MAP.filter(element => 
        element.type === 'spawn' && 
        element.properties?.spawnType === zoneType
    );
    
    if (zones.length === 0) return null;
    
    const zone = zones[Math.floor(Math.random() * zones.length)];
    let x = (zone.x + Math.random() * zone.width) * SCALE_FACTOR;
    let y = (zone.y + Math.random() * zone.height) * SCALE_FACTOR;
    
    // Ensure position is within world boundaries
    x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
    y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));
    
    return { x, y };
}

// Function to create special mobs (ultra, super, unique)
function createSpecialMob(tier: 'ultra' | 'super' | 'unique'): Enemy | null {
    let zoneType: string;
    
    if (tier === 'ultra') {
        zoneType = 'legendary';
    } else if (tier === 'super') {
        zoneType = 'mythic';
    } else { // unique
        zoneType = 'mythic';
    }
    
    const position = getRandomPositionInZoneType(zoneType);
    if (!position) {
        console.error(`No ${zoneType} zones found for ${tier} mob spawning`);
        return null;
    }
    
    const allMobTypes = getAllMobTypes();
    if (allMobTypes.length === 0) {
        console.error("No mob types found in MOB_CONFIG.");
        return null;
    }
    
    const mobType = allMobTypes[Math.floor(Math.random() * allMobTypes.length)] as Enemy['type'];
    const mobStats = getMobStats(mobType, tier);
    
    if (!mobStats) {
        console.error(`No mob stats found for ${mobType} ${tier}`);
        return null;
    }
    
    // Check if the spawn position would overlap with any player's petal range
    const mobSize = mobStats.size * 40;
    if (isPositionInPlayerPetalRange(position.x, position.y, mobSize)) {
        // Position is too close to player petal range, try to find a new position
        let newValidPosition = false;
        let newAttempts = 0;
        const MAX_NEW_ATTEMPTS = 50;
        
        while (!newValidPosition && newAttempts < MAX_NEW_ATTEMPTS) {
            newAttempts++;
            
            // Try to find a new position in the same zone type
            const newPosition = getRandomPositionInZoneType(zoneType);
            if (!newPosition) {
                continue; // Try again
            }
            
            // Check if the new position is safe from petal range
            const inPetalRange = isPositionInPlayerPetalRange(newPosition.x, newPosition.y, mobSize);
            
            if (!inPetalRange) {
                position.x = newPosition.x;
                position.y = newPosition.y;
                newValidPosition = true;
            }
        }
        
        // If we still couldn't find a valid position, return null
        if (!newValidPosition) {
            return null;
        }
    }
    
    const currentTime = Date.now();
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: mobType,
        tier: tier,
        x: position.x,
        y: position.y,
        angle: Math.random() * Math.PI * 2,
        health: mobStats.health,
        maxHealth: mobStats.health,
        speed: mobStats.speed,
        damage: mobStats.damage,
        knockbackX: 0,
        knockbackY: 0,
        isHostile: mobStats.is_hostile,
        range: mobStats.range
    };
}

// Function to update special mob counts
export function updateSpecialMobCounts() {
    ultraMobCount = enemies.filter(e => e.tier === 'ultra').length;
    superMobCount = enemies.filter(e => e.tier === 'super').length;
    uniqueMobCount = enemies.filter(e => e.tier === 'unique').length;
}

// Function to spawn special mobs
function spawnSpecialMobs() {
    // Update counts first
    updateSpecialMobCounts();
    
    // Spawn ultra mob if none exists
    if (ultraMobCount === 0) {
        const ultraMob = createSpecialMob('ultra');
        if (ultraMob) {
            enemies.push(ultraMob);
            ultraMobCount = 1;
            io.emit('chatMessage', {
                sender: 'System',
                content: 'An ultra mob has spawned in a legendary zone!',
                timestamp: Date.now()
            });
            console.log(`[SERVER] Spawned ultra mob: ${ultraMob.type} at (${ultraMob.x}, ${ultraMob.y})`);
        }
    }
    
    // Spawn super mob if none exists
    if (superMobCount === 0) {
        const superMob = createSpecialMob('super');
        if (superMob) {
            enemies.push(superMob);
            superMobCount = 1;
            io.emit('chatMessage', {
                sender: 'System',
                content: 'A super mob has spawned in a mythic zone!',
                timestamp: Date.now()
            });
            console.log(`[SERVER] Spawned super mob: ${superMob.type} at (${superMob.x}, ${superMob.y})`);
        }
    }
    
    // Spawn unique mob with 1/4 chance if super mob exists
    if (superMobCount > 0 && uniqueMobCount === 0 && Math.random() < 0.25) {
        const uniqueMob = createSpecialMob('unique');
        if (uniqueMob) {
            enemies.push(uniqueMob);
            uniqueMobCount = 1;
            io.emit('chatMessage', {
                sender: 'System',
                content: 'A unique mob has spawned in a mythic zone!',
                timestamp: Date.now()
            });
            console.log(`[SERVER] Spawned unique mob: ${uniqueMob.type} at (${uniqueMob.x}, ${uniqueMob.y})`);
        }
    }
}

// Update the createEnemy function to spawn only in player viewports
function createEnemy(): Enemy {
    const playerCount = Object.keys(players).length;
    
    // Don't spawn if no players are connected
    if (playerCount === 0) {
        return null as any;
    }
    
    // Calculate target enemy count based on viewport density
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
    
    // Calculate target density: same as 9000 enemies across the whole world (9x density)
    const targetDensity = ORIGINAL_ENEMY_COUNT / TOTAL_WORLD_AREA;
    const targetEnemyCount = Math.ceil(targetDensity * totalViewportArea);
    
    // Don't spawn if we already have enough enemies in viewport
    if (getEnemiesInViewportCount() >= targetEnemyCount) {
        return null as any;
    }

    let validPosition = false;
    let x = 0, y = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // Increased attempts for viewport-only spawning

    while (!validPosition && attempts < MAX_ATTEMPTS) {
        attempts++;
        
        // Pick a random player and spawn near their viewport
        const randomPlayerId = Object.keys(players)[Math.floor(Math.random() * Object.keys(players).length)];
        const player = players[randomPlayerId];
        
        // Generate position within player's viewport (with buffer)
        const viewportBuffer = VIEWPORT_BUFFER;
        const minX = player.x - VIEWPORT_WIDTH/2 - viewportBuffer;
        const maxX = player.x + VIEWPORT_WIDTH/2 + viewportBuffer;
        const minY = player.y - VIEWPORT_HEIGHT/2 - viewportBuffer;
        const maxY = player.y + VIEWPORT_HEIGHT/2 + viewportBuffer;
        
        x = minX + Math.random() * (maxX - minX);
        y = minY + Math.random() * (maxY - minY);
        
        // Clamp to world boundaries
        x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
        y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));

        // Check if position is in a safe zone
        const inSafeZone = WORLD_MAP.some(element =>
            element.type === 'safe_zone' &&
            x >= element.x * SCALE_FACTOR &&
            x <= (element.x + element.width) * SCALE_FACTOR &&
            y >= element.y * SCALE_FACTOR &&
            y <= (element.y + element.height) * SCALE_FACTOR
        );

        // Check if position collides with walls
        const collidesWithWall = WORLD_MAP.some(element =>
            element.type === 'wall' &&
            x >= element.x * SCALE_FACTOR &&
            x <= (element.x + element.width) * SCALE_FACTOR &&
            y >= element.y * SCALE_FACTOR &&
            y <= (element.y + element.height) * SCALE_FACTOR
        );

        if (!inSafeZone && !collidesWithWall) {
            validPosition = true;
        }
    }

    // If we couldn't find a valid position, return null
    if (!validPosition) {
        return null as any;
    }

    // Check if position is in a biome first
    const biome = getBiomeAtPosition(x, y);
    let tier: Enemy['tier'] = 'common';
    let mobType: Enemy['type'];

    if (biome && biome.properties?.spawnTable && biome.properties.spawnTable.length > 0) {
        // In a biome - use the biome's spawn table
        const spawnSelection = selectSpawnFromBiomeTable(biome.properties.spawnTable);
        
        if (spawnSelection) {
            tier = spawnSelection.tier;
            
            // If spawn table specifies a mob type, use it; otherwise pick randomly
            if (spawnSelection.mobType) {
                mobType = spawnSelection.mobType as Enemy['type'];
            } else {
                const allMobTypes = getAllMobTypes();
                if (allMobTypes.length === 0) {
                    console.error("No mob types found in MOB_CONFIG.");
                    return null as any;
                }
                mobType = allMobTypes[Math.floor(Math.random() * allMobTypes.length)] as Enemy['type'];
            }
        } else {
            // Fallback if spawn table selection fails
            const allMobTypes = getAllMobTypes();
            if (allMobTypes.length === 0) {
                console.error("No mob types found in MOB_CONFIG.");
                return null as any;
            }
            mobType = allMobTypes[Math.floor(Math.random() * allMobTypes.length)] as Enemy['type'];
        }
    } else {
        // Check if position is in a spawn zone
        const spawnZoneType = getSpawnZoneType(x, y);

        if (spawnZoneType) {
            // In a spawn zone - only spawn the specific rarity for this zone
            tier = spawnZoneType as Enemy['tier'];
        } else {
            // Outside spawn zones and biomes - use normal probability distribution
            const tierRoll = Math.random();
            let cumulativeProbability = 0;

            for (const [t, data] of Object.entries(ENEMY_TIERS)) {
                cumulativeProbability += data.probability;
                if (tierRoll < cumulativeProbability) {
                    tier = t as Enemy['tier'];
                    break;
                }
            }
        }

        // Select mob type (fish, octopus, or shark)
        // Filter out biome-only mobs when spawning outside biomes
        const allMobTypes = getAllMobTypes();
        if (allMobTypes.length === 0) {
            console.error("No mob types found in MOB_CONFIG.");
            return null as any;
        }
        
        // Filter to only allow non-biome-only mobs in regular spawn zones
        const eligibleMobTypes = allMobTypes.filter(type => {
            const stats = getMobStats(type, tier);
            return stats && !stats.biomeOnly;
        });
        
        if (eligibleMobTypes.length === 0) {
            // No eligible mobs for this tier outside biomes
            return null as any;
        }
        
        mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)] as Enemy['type'];
    }

    // Get mob stats from config
    const mobStats = getMobStats(mobType, tier);
    if (!mobStats) {
        console.error(`No mob stats found for ${mobType} ${tier}`);
        return null as any;
    }

    // Check if the spawn position would overlap with any player's petal range
    const mobSize = mobStats.size * 40;
    if (isPositionInPlayerPetalRange(x, y, mobSize)) {
        // Position is too close to player petal range, try to find a new position
        let newValidPosition = false;
        let newAttempts = 0;
        const MAX_NEW_ATTEMPTS = 50;
        
        while (!newValidPosition && newAttempts < MAX_NEW_ATTEMPTS) {
            newAttempts++;
            
            // Pick a random player and spawn near their viewport
            const randomPlayerId = Object.keys(players)[Math.floor(Math.random() * Object.keys(players).length)];
            const player = players[randomPlayerId];
            
            // Generate position within player's viewport (with buffer)
            const viewportBuffer = VIEWPORT_BUFFER;
            const minX = player.x - VIEWPORT_WIDTH/2 - viewportBuffer;
            const maxX = player.x + VIEWPORT_WIDTH/2 + viewportBuffer;
            const minY = player.y - VIEWPORT_HEIGHT/2 - viewportBuffer;
            const maxY = player.y + VIEWPORT_HEIGHT/2 + viewportBuffer;
            
            x = minX + Math.random() * (maxX - minX);
            y = minY + Math.random() * (maxY - minY);
            
            // Clamp to world boundaries
            x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH, x));
            y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT, y));

            // Check if position is in a safe zone
            const inSafeZone = WORLD_MAP.some(element =>
                element.type === 'safe_zone' &&
                x >= element.x * SCALE_FACTOR &&
                x <= (element.x + element.width) * SCALE_FACTOR &&
                y >= element.y * SCALE_FACTOR &&
                y <= (element.y + element.height) * SCALE_FACTOR
            );

            // Check if position collides with walls
            const collidesWithWall = WORLD_MAP.some(element =>
                element.type === 'wall' &&
                x >= element.x * SCALE_FACTOR &&
                x <= (element.x + element.width) * SCALE_FACTOR &&
                y >= element.y * SCALE_FACTOR &&
                y <= (element.y + element.height) * SCALE_FACTOR
            );

            // Check if position is safe from petal range
            const inPetalRange = isPositionInPlayerPetalRange(x, y, mobSize);

            if (!inSafeZone && !collidesWithWall && !inPetalRange) {
                newValidPosition = true;
            }
        }
        
        // If we still couldn't find a valid position, return null
        if (!newValidPosition) {
            return null as any;
        }
    }

    // console.log(`[DEBUG] Spawning ${mobType} (${tier}) mob with stats:`, {
    //     health: mobStats.health,
    //     damage: mobStats.damage,
    //     speed: mobStats.speed,
    //     isHostile: mobStats.is_hostile,
    //     range: mobStats.range
    // });

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
        lastViewportCheck: currentTime  // Mark as in viewport since we spawned it there
    };
}

// Update respawnPlayer to use spawn points from the map
function respawnPlayer(player: ServerPlayer) {
    // Find valid spawn points for player's level
    const validSpawnPoints = WORLD_MAP.filter(element =>
        element.type === 'spawn' &&
        element.properties?.spawnType === getSpawnTypeForLevel(player.level)
    );

    if (validSpawnPoints.length > 0) {
        // Choose random spawn point
        const spawn = validSpawnPoints[Math.floor(Math.random() * validSpawnPoints.length)];
        player.x = (spawn.x + Math.random() * spawn.width) * SCALE_FACTOR;
        player.y = (spawn.y + Math.random() * spawn.height) * SCALE_FACTOR;
    } else {
        // Fallback to old spawn logic if no valid spawn points
        console.warn('No valid spawn points found for level', player.level);
        player.x = Math.random() * ACTUAL_WORLD_WIDTH;
        player.y = Math.random() * ACTUAL_WORLD_HEIGHT;
    }

    // Rest of respawnPlayer remains the same
    player.health = player.maxHealth;
    player.score = Math.max(0, player.score - 10);
    player.isInvulnerable = true;
    player.lastDamageTime = 0;
    player.isDead = false;

    setTimeout(() => {
        player.isInvulnerable = false;
        // Notify client that invulnerability has ended
        io.emit('playerInvulnerabilityEnded', { playerId: player.id });
    }, RESPAWN_INVULNERABILITY_TIME);
}

// Helper function to determine spawn type based on level
function getSpawnTypeForLevel(level: number): NonNullable<MapElement['properties']>['spawnType'] {
    if (level <= 5) return 'common';
    if (level <= 10) return 'uncommon';
    if (level <= 15) return 'rare';
    if (level <= 25) return 'epic';
    if (level <= 40) return 'legendary';
    return 'mythic';
}

// Helper function to check if a biome only allows mob rarities less than "rare" (common or uncommon)
function isBiomeSafeForSpawn(biome: MapElement): boolean {
    // If biome has no spawn table, it uses default spawn logic which can include rare+ tiers
    // So we only allow spawning in biomes with explicit spawn tables
    if (!biome.properties?.spawnTable || biome.properties.spawnTable.length === 0) {
        return false;
    }

    // Check that all tiers in the spawn table are common or uncommon
    const safeTiers = ['common', 'uncommon'];
    for (const entry of biome.properties.spawnTable) {
        if (!safeTiers.includes(entry.tier)) {
            return false; // Found a tier that is rare or higher
        }
    }

    return true; // All tiers are safe (common or uncommon)
}

// Helper function to find a spawn position within a specific biome
function getSpawnPositionInBiome(biomeName: string): { x: number, y: number } | null {
    // Find all biome elements with the specified name
    const biomes = WORLD_MAP.filter(element => 
        element.type === 'biome' && 
        element.properties?.biomeName === biomeName &&
        element.width > 0 && 
        element.height > 0
    );

    if (biomes.length === 0) {
        console.warn(`No valid biomes found with name: ${biomeName}`);
        return null;
    }

    // Filter to only biomes that are safe for spawning (only common/uncommon mobs)
    const safeBiomes = biomes.filter(biome => isBiomeSafeForSpawn(biome));

    if (safeBiomes.length === 0) {
        console.warn(`No safe spawn areas found in ${biomeName} biome (all areas have rare+ mobs)`);
        return null;
    }

    // Choose a random biome from the safe ones
    const biome = safeBiomes[Math.floor(Math.random() * safeBiomes.length)];
    
    // Generate a random position within the biome, with some padding from edges
    const padding = 50; // Padding from biome edges
    const x = biome.x + padding + Math.random() * Math.max(0, biome.width - padding * 2);
    const y = biome.y + padding + Math.random() * Math.max(0, biome.height - padding * 2);
    
    console.log(`Spawning in ${biomeName} biome at (${x.toFixed(0)}, ${y.toFixed(0)})`);
    return { x: x * SCALE_FACTOR, y: y * SCALE_FACTOR };
}

function addItem(inventory: PlayerInventory, rarity: string, type: string, count: number) {
    if (!inventory[rarity]) {
        inventory[rarity] = {};
    }
    if (!inventory[rarity][type]) {
        inventory[rarity][type] = 0;
    }
    inventory[rarity][type] += count;
}

function removeItem(inventory: PlayerInventory, rarity: string, type: string, count: number): boolean {
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

function hasItem(inventory: PlayerInventory, rarity: string, type: string, count: number): boolean {
    return inventory[rarity]?.[type] >= count;
}


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

// XP and level management functions
export function addXPToPlayer(player: ServerPlayer, xp: number, socketId?: string): void {
    player.xp += xp;
    while (player.xp >= player.xpToNextLevel) {
        player.xp -= player.xpToNextLevel;
        player.level++;
        player.xpToNextLevel = calculateXPRequirement(player.level);
        handleLevelUp(player);
    }

    // Save progress after XP gain if we have the socket ID
    if (socketId) {
        const socket = Array.from(io.sockets.sockets.values()).find(s => s.id === socketId) as AuthenticatedSocket;
        if (socket?.userId) {
            savePlayerProgress(player, socket.userId);
        }
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
                    const spawn = validSpawnPoints[Math.floor(Math.random() * validSpawnPoints.length)];
                    spawnX = (spawn.x + Math.random() * spawn.width) * SCALE_FACTOR;
                    spawnY = (spawn.y + Math.random() * spawn.height) * SCALE_FACTOR;
                }
            }

            players[socket.id] = {
                id: socket.id,
                name: credentials.playerName || 'Unnamed',
                x: spawnX,
                y: spawnY,
                angle: 0,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                health: savedProgress?.maxHealth || PLAYER_MAX_HEALTH,
                maxHealth: savedProgress?.maxHealth || PLAYER_MAX_HEALTH,
                damage: savedProgress?.damage || PLAYER_DAMAGE,
                inventory: savedProgress?.inventory || createInitialInventory(),
                loadout: savedProgress?.loadout || createInitialBasicPetals().concat(Array(5).fill(null)),
                isInvulnerable: true,
                level: savedProgress?.level || 1,
                xp: savedProgress?.xp || 0,
                xpToNextLevel: calculateXPRequirement(savedProgress?.level || 1),
                knockbackX: 0,
                knockbackY: 0,
                inputs: { keys: [] },
                speed_boost: 1
            };

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
        delete players[socket.id];
        delete playerUserIds[socket.id]; // Clean up the mapping
        io.emit('playerDisconnected', socket.id);
        
        // Trigger viewport update when player disconnects
        triggerViewportUpdate();
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
    socket.on('updateName', (newName: string) => {
        const player = players[socket.id];
        if (player) {
            player.name = newName;
            io.emit('playerUpdated', player);
        }
    });

    socket.on('updateLoadout', (data: { loadout: (Item | null)[]; inventory: PlayerInventory }) => {
        const player = players[socket.id];
        if (player) {
            player.loadout = data.loadout;
            player.inventory = data.inventory;
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

        // Check for commands
        if (message.startsWith('/')) {
            const command = message.substring(1).toLowerCase();
            
            if (command === 'list_ultra') {
                const ultraMobs = enemies.filter(e => e.tier === 'ultra');
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
                const superMobs = enemies.filter(e => e.tier === 'super');
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
                const uniqueMobs = enemies.filter(e => e.tier === 'unique');
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

        const chatMessage: ChatMessage = {
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
    socket.on('craftItems', (data: { items: Item[] }) => {
        const player = players[socket.id];
        if (!player) return;

        if (data.items.length < 5 || data.items.length % 5 !== 0) {
            socket.emit('craftingFailed', 'Invalid number of items for crafting');
            return;
        }

        const firstItem = data.items[0];
        const { type, rarity, petalType } = firstItem;

        if (!rarity) return;

        const itemKey = type === 'petal' && petalType ? `petal_${petalType}` : type;

        const validCraft = data.items.every(item =>
            item.type === type && item.rarity === rarity && item.petalType === petalType
        );

        if (!validCraft) {
            socket.emit('craftingFailed', 'Items must be of same type and rarity');
            return;
        }

        if (!hasItem(player.inventory, rarity, itemKey, data.items.length)) {
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
            socket.emit('craftingFailed', 'Cannot upgrade unique items');
            return;
        }

        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        const rarityIndex = rarities.indexOf(rarity);
        const baseChance = 64;
        const successChance = baseChance / Math.pow(2, rarityIndex);
        
        removeItem(player.inventory, rarity, itemKey, data.items.length);

        let successfulCrafts = 0;
        const numBatches = data.items.length / 5;
        for (let i = 0; i < numBatches; i++) {
            if (Math.random() * 100 < successChance) {
                successfulCrafts++;
            }
        }

        if (successfulCrafts > 0) {
            addItem(player.inventory, newRarity, itemKey, successfulCrafts);
        }

        socket.emit('craftingFinished', {
            successCount: successfulCrafts,
            failCount: numBatches - successfulCrafts,
            newItem: { type: itemKey, rarity: newRarity },
            inventory: player.inventory
        });
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
            
            // Check if enemy dies from poison
            if (enemy.health <= 0) {
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
                    
                    // Handle mob drops
                    handleMobDrops(enemy);
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

        // Find closest living player
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
            const mobStats = getMobStats(enemy.type, enemy.tier);
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

                    // Get petal stats for damage and size
                    const petalStats = getPetalStats(projectileConfig.petalType, projectileConfig.petalRarity);
                    if (petalStats) {
                        // Create projectiles
                        for (let i = 0; i < projectileCount; i++) {
                            // Calculate spread angle for multiple projectiles
                            let projectileAngle = angleToPlayer;
                            if (projectileCount > 1) {
                                const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                                projectileAngle = angleToPlayer + spreadOffset;
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
                                petalRarity: projectileConfig.petalRarity,
                                damage: petalStats.damage,
                                size: petalStats.size
                            };

                            mobProjectiles.push(projectile);
                        }

                        // Update last shot time
                        enemy.lastProjectileTime = currentTime;
                    }
                }
            }
        } else {
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
        const mobStats = getMobStats(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;
        const halfSize = enemySize / 2;

        // Constrain to world boundaries (accounting for enemy size)
        enemy.x = Math.max(halfSize, Math.min(ACTUAL_WORLD_WIDTH - halfSize, enemy.x));
        enemy.y = Math.max(halfSize, Math.min(ACTUAL_WORLD_HEIGHT - halfSize, enemy.y));

        // Check for wall collisions with proper size consideration
        WORLD_MAP.filter(isWall).forEach(wall => {
            const scaledWall = {
                x: wall.x * SCALE_FACTOR,
                y: wall.y * SCALE_FACTOR,
                width: wall.width * SCALE_FACTOR,
                height: wall.height * SCALE_FACTOR
            };

            // Check if enemy (with size) overlaps with wall
            const enemyLeft = enemy.x - halfSize;
            const enemyRight = enemy.x + halfSize;
            const enemyTop = enemy.y - halfSize;
            const enemyBottom = enemy.y + halfSize;

            const wallLeft = scaledWall.x;
            const wallRight = scaledWall.x + scaledWall.width;
            const wallTop = scaledWall.y;
            const wallBottom = scaledWall.y + scaledWall.height;

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
                } else if (minOverlap === overlapRight) {
                    // Push right
                    enemy.x = wallRight + halfSize + 5; // 5px buffer
                } else if (minOverlap === overlapTop) {
                    // Push up
                    enemy.y = wallTop - halfSize - 5; // 5px buffer
                } else if (minOverlap === overlapBottom) {
                    // Push down
                    enemy.y = wallBottom + halfSize + 5; // 5px buffer
                }

                // Ensure enemy stays within world boundaries after push
                enemy.x = Math.max(halfSize, Math.min(ACTUAL_WORLD_WIDTH - halfSize, enemy.x));
                enemy.y = Math.max(halfSize, Math.min(ACTUAL_WORLD_HEIGHT - halfSize, enemy.y));
            }
        });

        // Check for mob-to-mob collisions (only check enemies that come after this one to avoid double-processing)
        const currentIndex = enemies.indexOf(enemy);
        for (let i = currentIndex + 1; i < enemies.length; i++) {
            const otherEnemy = enemies[i];
            
            // Get other enemy's size
            const otherMobStats = getMobStats(otherEnemy.type, otherEnemy.tier);
            const otherEnemySize = otherMobStats ? otherMobStats.size * 40 : ENEMY_SIZE;
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

                // Ensure both mobs stay within world boundaries after push
                enemy.x = Math.max(halfSize, Math.min(ACTUAL_WORLD_WIDTH - halfSize, enemy.x));
                enemy.y = Math.max(halfSize, Math.min(ACTUAL_WORLD_HEIGHT - halfSize, enemy.y));
                otherEnemy.x = Math.max(otherHalfSize, Math.min(ACTUAL_WORLD_WIDTH - otherHalfSize, otherEnemy.x));
                otherEnemy.y = Math.max(otherHalfSize, Math.min(ACTUAL_WORLD_HEIGHT - otherHalfSize, otherEnemy.y));
            }
        }
    });

    io.emit('enemiesUpdate', enemies);
}

// Update and move mob projectiles
function updateMobProjectiles(deltaTimeMs: number) {
    const currentTime = Date.now();
    
    for (let i = mobProjectiles.length - 1; i >= 0; i--) {
        const projectile = mobProjectiles[i];
        
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
        let hitWall = false;
        
        WORLD_MAP.filter(isWall).forEach(wall => {
            const scaledWall = {
                x: wall.x * SCALE_FACTOR,
                y: wall.y * SCALE_FACTOR,
                width: wall.width * SCALE_FACTOR,
                height: wall.height * SCALE_FACTOR
            };
            
            const projLeft = projectile.x - halfSize;
            const projRight = projectile.x + halfSize;
            const projTop = projectile.y - halfSize;
            const projBottom = projectile.y + halfSize;
            
            if (projRight > scaledWall.x && projLeft < scaledWall.x + scaledWall.width &&
                projBottom > scaledWall.y && projTop < scaledWall.y + scaledWall.height) {
                hitWall = true;
            }
        });
        
        if (hitWall) {
            mobProjectiles.splice(i, 1);
            continue;
        }
        
        // Check for player collisions
        const playerArray: ServerPlayer[] = Object.values(players);
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
                        const knockbackForce = 25;
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
    
    // Emit projectile updates to clients
    io.emit('mobProjectilesUpdate', mobProjectiles);
}

// Update and move player projectiles
function updatePlayerProjectiles(deltaTimeMs: number) {
    const currentTime = Date.now();
    
    for (let i = playerProjectiles.length - 1; i >= 0; i--) {
        const projectile = playerProjectiles[i];
        
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
        let hitWall = false;
        
        WORLD_MAP.filter(isWall).forEach(wall => {
            const scaledWall = {
                x: wall.x * SCALE_FACTOR,
                y: wall.y * SCALE_FACTOR,
                width: wall.width * SCALE_FACTOR,
                height: wall.height * SCALE_FACTOR
            };
            
            const projLeft = projectile.x - halfSize;
            const projRight = projectile.x + halfSize;
            const projTop = projectile.y - halfSize;
            const projBottom = projectile.y + halfSize;
            
            if (projRight > scaledWall.x && projLeft < scaledWall.x + scaledWall.width &&
                projBottom > scaledWall.y && projTop < scaledWall.y + scaledWall.height) {
                hitWall = true;
            }
        });
        
        if (hitWall) {
            playerProjectiles.splice(i, 1);
            continue;
        }
        
        // Check for enemy collisions
        for (let j = enemies.length - 1; j >= 0; j--) {
            const enemy = enemies[j];
            
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
                
                trackDamage(enemy, projectile.playerId, finalDamage);
                enemy.health -= finalDamage;
                io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                
                // Apply knockback
                if (distance > 0) {
                    const knockbackForce = 10;
                    const normalizedDx = dx / distance;
                    const normalizedDy = dy / distance;
                    enemy.knockbackX = normalizedDx * knockbackForce;
                    enemy.knockbackY = normalizedDy * knockbackForce;
                }
                
                // Check if enemy dies
                if (enemy.health <= 0) {
                    const xpGained = getXPFromEnemy(enemy);
                    addXPToPlayer(player, xpGained, projectile.playerId);
                    handleMobDrops(enemy);
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

function updatePlayerState(player: ServerPlayer, deltaTime: number) {
    if (!player || !player.inputs) {
        return;
    }

    // Don't update movement for dead players
    if (player.isDead) {
        return;
    }

    // Update player effects
    updatePlayerEffects(player, deltaTime);

    let targetVelocityX = 0;
    let targetVelocityY = 0;

    if (player.inputs.useMouse && player.inputs.mouseX !== undefined && player.inputs.mouseY !== undefined) {
        const dx = player.inputs.mouseX - player.x;
        const dy = player.inputs.mouseY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            // Nonlinear speed calculation: small distances = slower, large distances = faster
            // Uses a power curve: speed scales with (distance/scale)^exponent
            // This gives fine control for small movements and faster response for large movements
            const normalizedDistance = Math.min(distance / MOUSE_NONLINEAR_SCALE, 1.0);
            const speedMultiplier = Math.pow(normalizedDistance, MOUSE_NONLINEAR_EXPONENT);
            const speed = MAX_SPEED * player.speed_boost * getSpeedMultiplier(player) * speedMultiplier;
            targetVelocityX = (dx / distance) * speed;
            targetVelocityY = (dy / distance) * speed;
            player.angle = Math.atan2(dy, dx);
        }
    } else if (player.inputs.keys) {
        if (player.inputs.keys.includes('ArrowLeft') || player.inputs.keys.includes('a')) targetVelocityX -= 1;
        if (player.inputs.keys.includes('ArrowRight') || player.inputs.keys.includes('d')) targetVelocityX += 1;
        if (player.inputs.keys.includes('ArrowUp') || player.inputs.keys.includes('w')) targetVelocityY -= 1;
        if (player.inputs.keys.includes('ArrowDown') || player.inputs.keys.includes('s')) targetVelocityY += 1;

        if (targetVelocityX !== 0 && targetVelocityY !== 0) {
            const length = Math.sqrt(targetVelocityX * targetVelocityX + targetVelocityY * targetVelocityY);
            targetVelocityX /= length;
            targetVelocityY /= length;
        }

        const speed = MAX_SPEED * player.speed_boost * getSpeedMultiplier(player);
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
    const clampedX = Math.max(PLAYER_SIZE / 2 + padding, Math.min(ACTUAL_WORLD_WIDTH - PLAYER_SIZE / 2 - padding, newX));
    const clampedY = Math.max(PLAYER_SIZE / 2 + padding, Math.min(ACTUAL_WORLD_HEIGHT - PLAYER_SIZE / 2 - padding, newY));

    newX = clampedX;
    newY = clampedY;

    for (const element of WORLD_MAP) {
        if (element.type === 'wall' && element.width > 0 && element.height > 0) {
            const wallX = element.x * SCALE_FACTOR;
            const wallY = element.y * SCALE_FACTOR;
            const wallWidth = element.width * SCALE_FACTOR;
            const wallHeight = element.height * SCALE_FACTOR;

            if (
                newX < wallX + wallWidth &&
                newX + PLAYER_SIZE > wallX &&
                newY < wallY + wallHeight &&
                newY + PLAYER_SIZE > wallY
            ) {
                const overlapX = (newX + PLAYER_SIZE / 2) - (wallX + wallWidth / 2);
                const overlapY = (newY + PLAYER_SIZE / 2) - (wallY + wallHeight / 2);
                const combinedHalfWidths = PLAYER_SIZE / 2 + wallWidth / 2;
                const combinedHalfHeights = PLAYER_SIZE / 2 + wallHeight / 2;

                if (Math.abs(overlapX) < combinedHalfWidths && Math.abs(overlapY) < combinedHalfHeights) {
                    const penX = combinedHalfWidths - Math.abs(overlapX);
                    const penY = combinedHalfHeights - Math.abs(overlapY);

                    const oldX = newX;
                    const oldY = newY;

                    if (penX < penY) {
                        if (overlapX > 0) newX += penX; else newX -= penX;
                    } else {
                        if (overlapY > 0) newY += penY; else newY -= penY;
                    }

                    // Debug: Log wall collision
                    // console.log(`[SERVER] Player ${player.id} wall collision: wall(${wallX.toFixed(1)}, ${wallY.toFixed(1)}, ${wallWidth.toFixed(1)}x${wallHeight.toFixed(1)}) player moved (${oldX.toFixed(1)}, ${oldY.toFixed(1)}) -> (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
                }
            }
        }
    }

    let collision = false;
    for (const enemy of enemies) {
        // Get enemy size based on mob stats
        const mobStats = getMobStats(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE;

        // Calculate enemy hitbox bounds (enemy.x, enemy.y is center point)
        const enemyLeft = enemy.x - enemySize / 2;
        const enemyRight = enemy.x + enemySize / 2;
        const enemyTop = enemy.y - enemySize / 2;
        const enemyBottom = enemy.y + enemySize / 2;

        if (
            newX < enemyRight &&
            newX + PLAYER_SIZE > enemyLeft &&
            newY < enemyBottom &&
            newY + PLAYER_SIZE > enemyTop
        ) {
            collision = true;
            // Don't damage dead players (corpses)
            if (!player.isDead) {
                const shieldAmount = getShieldAmount(player);
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
                    if (players[player.id]) {
                        players[player.id].isInvulnerable = false;
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

                // Track damage dealt by this player
                trackDamage(enemy, player.id, player.damage);
                enemy.health -= player.damage;
                io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });

                if (enemy.health <= 0) {
                    const index = enemies.findIndex(e => e.id === enemy.id);
                    if (index !== -1) {
                        const xpGained = getXPFromEnemy(enemy);
                        addXPToPlayer(player, xpGained, player.id);
                        // Handle mob drops using the new drop table system
                        handleMobDrops(enemy);
                        enemies.splice(index, 1);
                        updateSpecialMobCounts();
                        io.emit('enemyDestroyed', enemy.id);
                        // Try to spawn a new enemy, but only if we can find a valid position
                        const newEnemy = createEnemy();
                        if (newEnemy) {
                            enemies.push(newEnemy);
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
        const petalInstances: Array<{petal: any, instanceIndex: number, loadoutIndex: number}> = [];
        try {
            for (let i = 0; i < player.loadout.length; i++) {
                const petal = player.loadout[i];
                if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                    const petalStats = getPetalStats(petal.petalType, petal.rarity);
                    if (!petalStats) continue;
                    
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
                                enemies: enemies,
                                io: io,
                                petalId: petalId,
                                loadoutIndex: i,
                                instanceIndex: j
                            };
                            executePetalActionsOnSpawn(petalStats.actions, actionContext);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error building petal instances:', error);
        }

        const currentTime = Date.now();
        const petalExtension = player.inputs.petalExtension || 1.0;
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = petalInstances.length > 0 ? (Math.PI * 2) / petalInstances.length : 0;

        for (let idx = 0; idx < petalInstances.length; idx++) {
            const {petal, instanceIndex, loadoutIndex} = petalInstances[idx];
            
            if (!petal || !petal.health || petal.health <= 0) {
                continue;
            }

            const petalStats = getPetalStats(petal.petalType, petal.rarity);
            if (!petalStats) continue;
            
            const rotationSpeed = (petalStats.speed ?? 1.0) * 0.002; // Convert to radians per ms
            const baseAngle = idx * angleStep;
            const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
            const totalAngle = baseAngle + rotationAngle;

            const petalX = player.x + Math.cos(totalAngle) * baseRadius;
            const petalY = player.y + Math.sin(totalAngle) * baseRadius;
            
            // Update petal position in action context
            const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
            updatePetalPosition(petalId, petalX, petalY);

            // Check if petal can shoot projectiles (only when extended)
            if (petalExtension > 1.0 && petalStats.projectile) {
                const projectileConfig = petalStats.projectile;
                const lastShotTime = petalLastProjectileTime.get(petalId) || 0;
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

                        const projectile: PlayerProjectile = {
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
                            size: petalStats.size
                        };

                        playerProjectiles.push(projectile);
                    }

                    // Update last shot time for this petal instance
                    petalLastProjectileTime.set(petalId, currentTime);
                }
            }

            // Check collision with enemies
            for (const enemy of enemies) {
                // Get mob stats to determine proper hitbox size
                const mobStats = getMobStats(enemy.type, enemy.tier);
                const enemySize = mobStats ? mobStats.size * 40 : ENEMY_SIZE; // Use mob size or fallback to base size
                const petalSize = 40 * petalStats.size; // Use same base size as enemies for consistency

                // Calculate enemy hitbox bounds (enemy.x, enemy.y is center point)
                const enemyLeft = enemy.x - enemySize / 2;
                const enemyRight = enemy.x + enemySize / 2;
                const enemyTop = enemy.y - enemySize / 2;
                const enemyBottom = enemy.y + enemySize / 2;

                // Calculate petal hitbox bounds (petalX, petalY is center point)
                const petalLeft = petalX - petalSize / 2;
                const petalRight = petalX + petalSize / 2;
                const petalTop = petalY - petalSize / 2;
                const petalBottom = petalY + petalSize / 2;

                if (
                    petalLeft < enemyRight &&
                    petalRight > enemyLeft &&
                    petalTop < enemyBottom &&
                    petalBottom > enemyTop
                ) {
                    // Petal hits enemy - deal damage to both
                    const damageMultiplier = getDamageMultiplier(player);
                    const finalDamage = petalStats.damage * damageMultiplier;
                    
                    // Track damage dealt by this player
                    trackDamage(enemy, player.id, finalDamage);
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
                        } else {
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

                        // Apply knockback to enemy
                        enemy.knockbackX = normalizedDx * knockbackForce;
                        enemy.knockbackY = normalizedDy * knockbackForce;
                    }

                    io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });

                    // Handle petal collision for wait_until_collision actions
                    const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
                    const collisionContext = {
                        player: player,
                        petalX: petalX,
                        petalY: petalY,
                        petalSize: petalSize,
                        petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                        enemies: enemies,
                        io: io,
                        petalId: petalId,
                        loadoutIndex: loadoutIndex,
                        instanceIndex: instanceIndex
                    };
                    handlePetalCollision(petalId, collisionContext);

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
                                enemies: enemies,
                                io: io
                            };
                            executePetalActions(petalStats.actions, actionContext, 'on_break');
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
                            if (players[player.id] && player.loadout[loadoutIndex] && player.loadout[loadoutIndex]!.onCooldown) {
                                // Restore petal after cooldown
                                player.loadout[loadoutIndex] = {
                                    ...originalPetal,
                                    health: originalPetal.maxHealth, // Restore full health
                                    onCooldown: false
                                };
                                
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
                        const index = enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            const xpGained = getXPFromEnemy(enemy);
                            addXPToPlayer(player, xpGained, player.id);
                            // Handle mob drops using the new drop table system
                            handleMobDrops(enemy);
                            enemies.splice(index, 1);
                            updateSpecialMobCounts();
                            io.emit('enemyDestroyed', enemy.id);
                            // Try to spawn a new enemy, but only if we can find a valid position
                            const newEnemy = createEnemy();
                            if (newEnemy) {
                                enemies.push(newEnemy);
                            }
                        }
                    }
                }
            }

            // Check for corpse revival if this is a yggdrasil petal (always active)
            if (petal.petalType === 'yggdrasil') {
                const revivalRange = 80; // Range for automatic revival
                
                for (const [otherPlayerId, otherPlayer] of Object.entries(players)) {
                    if (otherPlayerId !== player.id && otherPlayer.isDead) {
                        const distance = Math.sqrt(
                            (petalX - otherPlayer.x) ** 2 + (petalY - otherPlayer.y) ** 2
                        );
                        
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
                                if (players[otherPlayerId]) {
                                    players[otherPlayerId].isInvulnerable = false;
                                    io.emit('playerInvulnerabilityEnded', { playerId: otherPlayerId });
                                }
                            }, RESPAWN_INVULNERABILITY_TIME);
                            
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
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const distance = Math.sqrt((newX - item.x) ** 2 + (newY - item.y) ** 2);
        if (distance < PLAYER_SIZE) {
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
            addItem(player.inventory, rarity, itemKey, 1);
            
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
            const userId = playerUserIds[player.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
            
            // Remove item from world if all eligible players have picked it up
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                const allPickedUp = item.eligiblePlayers.every(playerId => 
                    item.pickedUpBy && item.pickedUpBy.has(playerId)
                );
                if (allPickedUp) {
                    items.splice(i, 1);
                    // Notify only eligible players that the item is gone
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
            }
        }
    }

    // Check for teleporter interactions with 1-second delay
    let currentTeleporter: string | null = null;
    const currentTime = Date.now();
    
    // Check if player is currently in a teleporter
    for (const element of WORLD_MAP.filter(isTeleporter)) {
        const teleporterId = `teleporter_${element.x}_${element.y}_${element.width}_${element.height}`;
        const teleporterX = element.x * SCALE_FACTOR;
        const teleporterY = element.y * SCALE_FACTOR;
        const teleporterWidth = element.width * SCALE_FACTOR;
        const teleporterHeight = element.height * SCALE_FACTOR;

        // Check if player is inside teleporter bounds (using proper collision detection)
        if (
            newX + PLAYER_SIZE > teleporterX &&
            newX < teleporterX + teleporterWidth &&
            newY + PLAYER_SIZE > teleporterY &&
            newY < teleporterY + teleporterHeight &&
            element.properties?.teleportTo
        ) {
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
                    transferPlayerToServer(
                        player,
                        teleportTo.serverPort,
                        teleportTo.x * SCALE_FACTOR,
                        teleportTo.y * SCALE_FACTOR
                    ).catch(error => {
                        console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Failed to transfer player ${player.name}:`, error);
                        // Optionally notify the player about the failed transfer
                        io.to(player.id).emit('transferFailed', { message: 'Failed to connect to target server' });
                        // Reset cooldown on failure
                        player.teleportCooldown = undefined;
                    });
                    
                    // Don't update player position this tick as they're being transferred
                    return;
                } else {
                    // Same-server teleportation
                    newX = teleportTo.x * SCALE_FACTOR;
                    newY = teleportTo.y * SCALE_FACTOR;
                    
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
        for (const id in players) {
            updatePlayerState(players[id], deltaTime);
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

        const playersForBroadcast = Object.values(players).map(p => ({
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
            enemies: enemies,
        });
    }, TICK_INTERVAL);
}

server.listen(PORT, () => {
    console.log(`Server is running on ${SERVER_PROTOCOL}://localhost:${PORT}`);
});

// Add XP calculation functions
function calculateXPRequirement(level: number): number {
    return Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, level - 1));
}

// Cross-server player transfer functionality
async function transferPlayerToServer(player: ServerPlayer, targetServerPort: number, targetX: number, targetY: number): Promise<boolean> {
    const targetServerConfig = getServerConfigByPort(targetServerPort);
    
    if (!targetServerConfig) {
        console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Target server config not found for port ${targetServerPort}`);
        return false;
    }
    
    if (targetServerPort === CURRENT_SERVER_PORT) {
        console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Cannot transfer player to the same server`);
        return false;
    }
    
    try {
        // Save player progress before transfer
        const userId = playerUserIds[player.id];
        if (userId) {
            savePlayerProgress(player, userId);
        }
        
        // Prepare player data for transfer (remove socket-specific data)
        const playerDataForTransfer = {
            name: player.name,
            score: player.score,
            health: player.health,
            maxHealth: player.maxHealth,
            damage: player.damage,
            inventory: player.inventory,
            loadout: player.loadout,
            level: player.level,
            xp: player.xp,
            xpToNextLevel: player.xpToNextLevel,
            angle: player.angle,
            velocityX: 0,
            velocityY: 0,
            knockbackX: 0,
            knockbackY: 0,
            inputs: { keys: [] },
            speed_boost: player.speed_boost
        };
        
        // Create HTTPS request to target server
        const postData = JSON.stringify({
            playerData: playerDataForTransfer,
            targetX,
            targetY
        });
        
        const options = {
            hostname: targetServerConfig.host,
            port: targetServerConfig.port,
            path: '/transfer/player',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            // For self-signed certificates in development (only if using HTTPS)
            rejectUnauthorized: USE_HTTPS ? false : undefined
        };
        
        return new Promise((resolve) => {
            const req = USE_HTTPS ? 
                https.request(options, (res) => {
                    let responseData = '';
                    
                    res.on('data', (chunk) => {
                        responseData += chunk;
                    });
                    
                    res.on('end', () => {
                    try {
                        const response = JSON.parse(responseData);
                        if (response.success) {
                            console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Successfully transferred player ${player.name} to ${targetServerConfig.name}`);
                            
                            // Notify client about successful transfer
                            io.to(player.id).emit('playerTransferred', {
                                targetServer: targetServerConfig,
                                transferToken: response.transferToken,
                                targetX,
                                targetY
                            });
                            
                            // Remove player from current server immediately
                            delete players[player.id];
                            delete playerUserIds[player.id];
                            io.emit('playerLeft', player.id);
                            
                            resolve(true);
                        } else {
                            console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Failed to transfer player: ${response.message}`);
                            resolve(false);
                        }
                    } catch (error) {
                        console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Error parsing transfer response:`, error);
                        resolve(false);
                    }
                });
            }) :
                http.request(options, (res) => {
                    let responseData = '';
                    
                    res.on('data', (chunk) => {
                        responseData += chunk;
                    });
                    
                    res.on('end', () => {
                        try {
                            const response = JSON.parse(responseData);
                            if (response.success) {
                                console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Successfully transferred player ${player.name} to ${targetServerConfig.name}`);
                                
                                // Notify client about successful transfer
                                io.to(player.id).emit('playerTransferred', {
                                    targetServer: targetServerConfig,
                                    transferToken: response.transferToken,
                                    targetX,
                                    targetY
                                });
                                
                                // Remove player from current server immediately
                                delete players[player.id];
                                delete playerUserIds[player.id];
                                io.emit('playerLeft', player.id);
                                
                                resolve(true);
                            } else {
                                console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Failed to transfer player: ${response.message}`);
                                resolve(false);
                            }
                        } catch (error) {
                            console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Error parsing transfer response:`, error);
                            resolve(false);
                        }
                    });
                });
            
            req.on('error', (error) => {
                console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Error transferring player:`, error);
                resolve(false);
            });
            
            req.write(postData);
            req.end();
        });
        
    } catch (error) {
        console.error(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Error during player transfer:`, error);
        return false;
    }
}


// Optional: Clean up old player data periodically
// setInterval(() => {
//     database.cleanupOldPlayers(30); // Clean up players not seen in 30 days
// }, 24 * 60 * 60 * 1000); // Run once per day

// Add this function near the other helper functions
function handleLevelUp(player: ServerPlayer): void {
    player.maxHealth += HEALTH_PER_LEVEL;
    player.health = player.maxHealth;  // Heal to full when leveling up
    player.damage += DAMAGE_PER_LEVEL;

    io.emit('levelUp', {
        playerId: player.id,
        level: player.level,
        maxHealth: player.maxHealth,
        damage: player.damage
    });
}

// Add these constants at the top with other constants
const HEALTH_REGEN_RATE = 5;  // Health points recovered per tick
const HEALTH_REGEN_INTERVAL = 1000;  // Milliseconds between health regeneration ticks
const HEALTH_REGEN_COMBAT_DELAY = 0;  // Delay before health starts regenerating after taking damage

// Add health regeneration interval
setInterval(() => {
    Object.values(players).forEach(player => {
        // Check if enough time has passed since last damage
        const now = Date.now();
        if (player.lastDamageTime && now - player.lastDamageTime < HEALTH_REGEN_COMBAT_DELAY) {
            return;  // Skip regeneration if player was recently damaged
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
                // console.log(`[SERVER] Density maintenance: spawned ${spawned} enemies (target: ${targetEnemyCount}, current: ${currentViewportEnemies})`);
            // }
        }
    }
}, 2000); // 2 seconds

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

// Move savePlayerProgress outside the socket connection handler
function savePlayerProgress(player: ServerPlayer, userId: string) {
    if (userId) {
        // console.log('Saving player progress for userId:', userId);

        const saveResult = database.savePlayer(userId, {
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
    } else {
        // console.warn('Attempted to save player progress without userId');
    }
}

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

// Add after other app.use declarations but before socket.io setup
app.post('/admin/save-progress', (req, res) => {
    const { playerId } = req.body;

    if (!playerId) {
        return res.status(400).json({ message: 'Player ID is required' });
    }

    const player = players[playerId];
    const socket = io.sockets.sockets.get(playerId) as AuthenticatedSocket;

    if (!player || !socket?.userId) {
        return res.status(404).json({ message: 'Player not found or not authenticated' });
    }

    try {
        savePlayerProgress(player, socket.userId);
        res.json({ message: 'Progress saved successfully' });
    } catch (error) {
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
            const player = players[playerId];
            const socket = io.sockets.sockets.get(playerId) as AuthenticatedSocket;

            if (player && socket?.userId) {
                savePlayerProgress(player, socket.userId);
                socket.emit('savePlayerProgress', player);
                // console.log(`Progress saved for player ${playerId}`);
            } else {
                // console.log(`Player ${playerId} not found or not authenticated`);
            }
        } else if (parts.length === 1) {
            // Save all players
            let savedCount = 0;
            Object.entries(players).forEach(([socketId, player]) => {
                const socket = io.sockets.sockets.get(socketId) as AuthenticatedSocket;
                if (socket?.userId) {
                    savePlayerProgress(player, socket.userId);
                    savedCount++;
                }
            });
            // console.log(`Saved progress for ${savedCount} players`);
        }
    } else if (command === 'list-players') {
        Object.entries(players).forEach(([socketId, player]) => {
            console.log(`Player ID: ${socketId}, Name: ${player.name}, Level: ${player.level}`);
        });
    } else if (command === 'list-sockets') {
        io.sockets.sockets.forEach((socket) => {
            console.log(`Socket ID: ${socket.id}`);
        });
    } else if (command.startsWith('set_max_enemies')) {
        const newCount = parseInt(command.split(' ')[1]);
        if (!isNaN(newCount) && newCount >= 0) {
            ENEMY_COUNT = newCount;
            console.log(`Max enemies set to ${ENEMY_COUNT}`);
            adjustEnemyCount();
        } else {
            console.log('Invalid enemy count. Please provide a valid number.');
        }
    } else if (command === 'spawn_special_mobs') {
        spawnSpecialMobs();
    }
});

// Add this function after the command handler
function adjustEnemyCount() {
    const playerCount = Object.keys(players).length;
    const targetEnemyCount = playerCount > 0 ? ENEMIES_PER_VIEWPORT * playerCount : ENEMY_COUNT;
    
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

// Add after other app.use declarations
app.use('/assets', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});

// If you're serving assets from a specific directory, update the static file serving
app.use('/assets', express.static(path.join(__dirname, '../assets'), {
    setHeaders: (res, path) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Cross-Origin-Resource-Policy', 'cross-origin');
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Add near the top with other static file configurations
app.use('/favicon.ico', express.static(path.join(__dirname, '../assets/favicon.ico')));

start_loop();