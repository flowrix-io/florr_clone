import express from 'express';
import { createServer } from 'https';
import { Server, Socket } from 'socket.io';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { database } from './database';

// Check for and migrate any plain text passwords on server startup
if (database.checkForPlainTextPasswords()) {
    console.log('[SERVER] Detecting plain text passwords, running migration...');
    const migrated = database.migratePasswords();
    console.log(`[SERVER] Password migration completed: ${migrated} passwords updated`);
} else {
    console.log('[SERVER] All passwords are already hashed');
}
import { ServerPlayer, PlayerProgress, PlayerInventory } from './player';
import { PLAYER_DAMAGE, WORLD_WIDTH, WORLD_HEIGHT, ZONE_BOUNDARIES, ENEMY_TIERS, KNOCKBACK_RECOVERY_SPEED, FISH_DETECTION_RADIUS, ENEMY_SIZE, ENEMY_SIZE_MULTIPLIERS, PLAYER_SIZE, KNOCKBACK_FORCE, DROP_CHANCES, PLAYER_MAX_HEALTH, HEALTH_PER_LEVEL, DAMAGE_PER_LEVEL, BASE_XP_REQUIREMENT, XP_MULTIPLIER, RESPAWN_INVULNERABILITY_TIME, enemies, players, dots, obstacles, OBSTACLE_COUNT, ENEMY_CORAL_PROBABILITY, ENEMY_CORAL_HEALTH, SAND_COUNT, DECORATION_COUNT, WORLD_MAP, MapElement, isWall, isTeleporter, ACTUAL_WORLD_HEIGHT, ACTUAL_WORLD_WIDTH, SCALE_FACTOR, MAX_SPEED, VIEWPORT_BUFFER, ENEMY_DESPAWN_TIME, ENEMIES_PER_VIEWPORT, ORIGINAL_ENEMY_DENSITY, ORIGINAL_ENEMY_COUNT, VIEWPORT_WITH_BUFFER_AREA, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, TOTAL_WORLD_AREA, getServerConfigs, getServerConfigByPort, ServerConfig } from './constants';
import { Enemy, Obstacle, createDecoration, getRandomPositionInZone, Decoration, Sand, createSand, getXPFromEnemy } from './server_utils';
import { Item, ItemWithRarity, WorldItem } from './item';
import { getAllPetalTypes, getPetalStats } from './petals';
import { MOB_CONFIG, getMobStats, getAllMobTypes } from './mobs';
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
        players[tempSocketId] = {
            ...playerData,
            id: tempSocketId,
            x: targetX || 200,
            y: targetY || WORLD_HEIGHT / 2,
            isTransferred: true, // Mark as transferred so client can reconnect
            transferToken: Math.random().toString(36).substr(2, 9) // Token for client to claim this player
        };
        
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
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

const httpsServer = createServer({
    key: fs.readFileSync('cert.key'),
    cert: fs.readFileSync('cert.crt')
}, app);

const io = new Server(httpsServer, {
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
        console.log(`[SERVER] Despawned enemy ${enemy.id} (${enemy.type} ${enemy.tier}) - outside viewport for 30+ seconds`);
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
function updateSpecialMobCounts() {
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
    
    // Calculate target density: same as 1000 enemies across the whole world
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

    // Check if position is in a spawn zone
    const spawnZoneType = getSpawnZoneType(x, y);
    let tier: Enemy['tier'] = 'common';

    if (spawnZoneType) {
        // In a spawn zone - only spawn the specific rarity for this zone
        tier = spawnZoneType as Enemy['tier'];
    } else {
        // Outside spawn zones - use normal probability distribution
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
    const allMobTypes = getAllMobTypes();
    if (allMobTypes.length === 0) {
        console.error("No mob types found in MOB_CONFIG.");
        return null as any;
    }
    const mobType = allMobTypes[Math.floor(Math.random() * allMobTypes.length)] as Enemy['type'];

    // Get mob stats from config
    const mobStats = getMobStats(mobType, tier);
    if (!mobStats) {
        console.error(`No mob stats found for ${mobType} ${tier}`);
        return null as any;
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
console.log(`  Target: Maintain same density as ${ORIGINAL_ENEMY_COUNT} enemies across entire world`);
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
function addXPToPlayer(player: ServerPlayer, xp: number, socketId?: string): void {
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
    socket.on('authenticate', async (credentials: { username: string, password: string, playerName: string }) => {
        const user = database.getUser(credentials.username, credentials.password);

        if (user) {
            socket.userId = user.id;
            socket.username = user.username;
            playerUserIds[socket.id] = user.id; // Store the mapping

            // console.log('User authenticated, loading saved progress for userId:', user.id);
            const savedProgress = database.getPlayerByUserId(user.id);
            // console.log('Loaded saved progress:', savedProgress);

            players[socket.id] = {
                id: socket.id,
                name: credentials.playerName || 'Anonymous',
                x: 200,
                y: WORLD_HEIGHT / 2,
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
            socket.emit('itemsUpdate', items);
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

    socket.on('useItem', (itemData: { type: string, rarity: string }) => {
        const player = players[socket.id];
        if (!player) return;

        // For now, we don't check if the item is in the loadout on the server,
        // we trust the client. This could be improved for security.
        const item: ItemWithRarity = {
            type: itemData.type as any,
            rarity: itemData.rarity as any,
        };

        const rarityMultipliers: Record<string, number> = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4
        };

        const speedBoostMultipliers: Record<string, number> = {
            common: 2,
            uncommon: 2.8,
            rare: 3.6,
            epic: 5.2,
            legendary: 6.8,
            mythic: 8.4
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

        // Find closest player
        let closestPlayer: ServerPlayer;
        let closestDistance = Infinity;

        // Convert players object to array and explicitly type it
        const playerArray: ServerPlayer[] = Object.values(players);
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
        } else {
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

        // Get enemy size based on tier
        const enemySize = ENEMY_SIZE * ENEMY_SIZE_MULTIPLIERS[enemy.tier];
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
    });

    io.emit('enemiesUpdate', enemies);
}

function updatePlayerState(player: ServerPlayer, deltaTime: number) {
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
            const speed = MAX_SPEED * player.speed_boost;
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

        const speed = MAX_SPEED * player.speed_boost;
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
        const enemySize = ENEMY_SIZE * ENEMY_SIZE_MULTIPLIERS[enemy.tier as keyof typeof ENEMY_SIZE_MULTIPLIERS];

        if (
            newX < enemy.x + enemySize &&
            newX + PLAYER_SIZE > enemy.x &&
            newY < enemy.y + enemySize &&
            newY + PLAYER_SIZE > enemy.y
        ) {
            collision = true;
            // if (!player.isInvulnerable) {
                player.health -= enemy.damage;
                player.lastDamageTime = Date.now();
                player.isInvulnerable = true;

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

                enemy.health -= player.damage;
                io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });

                if (enemy.health <= 0) {
                    const index = enemies.findIndex(e => e.id === enemy.id);
                    if (index !== -1) {
                        const xpGained = getXPFromEnemy(enemy);
                        addXPToPlayer(player, xpGained, player.id);
                        // Check for item drop
                            const dropChance = DROP_CHANCES[enemy.tier as keyof typeof DROP_CHANCES];
                            if (Math.random() < dropChance) {
                            // Special mobs get multiple drops
                            const isSpecialMob = enemy.tier === 'ultra' || enemy.tier === 'super' || enemy.tier === 'unique';
                            const dropCount = isSpecialMob ? 
                                (enemy.tier === 'ultra' ? 2 : enemy.tier === 'super' ? 3 : 4) : 1;
                            
                            for (let dropIndex = 0; dropIndex < dropCount; dropIndex++) {
                                // Determine item type - 60% chance for consumables, 40% chance for petals
                                let itemType: Item['type'];
                                let petalType: string | undefined;
                                
                                if (Math.random() < 0.6) {
                                    // Drop consumable item
                                    itemType = ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)] as Item['type'];
                                } else {
                                    // Drop petal
                                    itemType = 'petal';
                                    const petalTypes = getAllPetalTypes();
                                    petalType = petalTypes[Math.floor(Math.random() * petalTypes.length)];
                                }

                                // Add some random offset for multiple drops
                                const offsetX = isSpecialMob ? (Math.random() - 0.5) * 100 : 0;
                                const offsetY = isSpecialMob ? (Math.random() - 0.5) * 100 : 0;

                                const newItem: WorldItem = {
                                    id: Math.random().toString(36).substr(2, 9),
                                    type: itemType,
                                    x: enemy.x + offsetX,
                                    y: enemy.y + offsetY,
                                    rarity: enemy.tier,
                                    petalType: petalType
                                };
                                items.push(newItem);
                                io.emit('itemSpawned', newItem);
                            }
                            
                            // Special mobs also get a guaranteed petal drop
                            if (isSpecialMob) {
                                const petalTypes = getAllPetalTypes();
                                const petalType = petalTypes[Math.floor(Math.random() * petalTypes.length)];
                                
                                const guaranteedPetal: WorldItem = {
                                    id: Math.random().toString(36).substr(2, 9),
                                    type: 'petal',
                                    x: enemy.x + (Math.random() - 0.5) * 80,
                                    y: enemy.y + (Math.random() - 0.5) * 80,
                                    rarity: enemy.tier,
                                    petalType: petalType
                                };
                                items.push(guaranteedPetal);
                                io.emit('itemSpawned', guaranteedPetal);
                            }
                        }
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

            const petalStats = getPetalStats(petal.petalType, petal.rarity);
            if (!petalStats) continue;

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
            for (const enemy of enemies) {
                const enemySize = ENEMY_SIZE * ENEMY_SIZE_MULTIPLIERS[enemy.tier as keyof typeof ENEMY_SIZE_MULTIPLIERS];
                const petalSize = 12 * petalStats.size;

                if (
                    petalX < enemy.x + enemySize &&
                    petalX + petalSize > enemy.x &&
                    petalY < enemy.y + enemySize &&
                    petalY + petalSize > enemy.y
                ) {
                    // Petal hits enemy - deal damage to both
                    enemy.health -= petalStats.damage;
                    petal.health -= 1; // Petal loses 1 health per hit

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
                            if (players[player.id] && player.loadout[i] && player.loadout[i]!.onCooldown) {
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
                        const index = enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            const xpGained = getXPFromEnemy(enemy);
                            addXPToPlayer(player, xpGained, player.id);
                            if (Math.random() < DROP_CHANCES[enemy.tier as keyof typeof DROP_CHANCES]) {
                                const dropChance = DROP_CHANCES[enemy.tier as keyof typeof DROP_CHANCES];
                                if (Math.random() < dropChance) {
                                    // Determine item type - 60% chance for consumables, 40% chance for petals
                                    let itemType: Item['type'];
                                    let petalType: string | undefined;
                                    
                                    if (Math.random() < 0.6) {
                                        // Drop consumable item
                                        itemType = ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)] as Item['type'];
                                    } else {
                                        // Drop petal
                                        itemType = 'petal';
                                        const petalTypes = getAllPetalTypes();
                                        petalType = petalTypes[Math.floor(Math.random() * petalTypes.length)];
                                    }

                                    const newItem: WorldItem = {
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
        }
    }

    // Check for item collisions (independent of enemy collisions)
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const distance = Math.sqrt((newX - item.x) ** 2 + (newY - item.y) ** 2);
        if (distance < PLAYER_SIZE) {
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

    // Check for teleporter collisions
    for (const element of WORLD_MAP.filter(isTeleporter)) {
        const teleporterX = element.x * SCALE_FACTOR;
        const teleporterY = element.y * SCALE_FACTOR;
        const teleporterWidth = element.width * SCALE_FACTOR;
        const teleporterHeight = element.height * SCALE_FACTOR;

        // Check if player is inside teleporter bounds
        if (
            newX >= teleporterX &&
            newX <= teleporterX + teleporterWidth &&
            newY >= teleporterY &&
            newY <= teleporterY + teleporterHeight &&
            element.properties?.teleportTo
        ) {
            const teleportTo = element.properties.teleportTo;
            
            // Check if this is a cross-server teleporter
            if (teleportTo.serverPort && teleportTo.serverPort !== CURRENT_SERVER_PORT) {
                // Cross-server teleportation
                console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Player ${player.name} attempting cross-server teleport to port ${teleportTo.serverPort}`);
                
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
                });
                
                // Don't update player position this tick as they're being transferred
                return;
            } else {
                // Same-server teleportation (existing functionality)
                newX = teleportTo.x * SCALE_FACTOR;
                newY = teleportTo.y * SCALE_FACTOR;
                
                console.log(`[SERVER ${CURRENT_SERVER_CONFIG.name}] Player ${player.name} teleported to (${newX}, ${newY})`);
                
                // Emit teleport event to client for visual effects
                io.to(player.id).emit('playerTeleported', {
                    newX,
                    newY,
                    playerId: player.id
                });
            }
            
            break; // Only process one teleporter per update
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
        for (const id in players) {
            updatePlayerState(players[id], deltaTime);
        }

        moveEnemies();

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

httpsServer.listen(PORT, () => {
    console.log(`Server is running on https://localhost:${PORT}`);
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
            // For self-signed certificates in development
            rejectUnauthorized: false
        };
        
        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
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
                            
                            // Remove player from current server after short delay
                            setTimeout(() => {
                                delete players[player.id];
                                delete playerUserIds[player.id];
                                io.emit('playerLeft', player.id);
                            }, 1000);
                            
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
            
            if (spawned > 0) {
                console.log(`[SERVER] Density maintenance: spawned ${spawned} enemies (target: ${targetEnemyCount}, current: ${currentViewportEnemies})`);
            }
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