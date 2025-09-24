import express from 'express';
import { createServer } from 'https';
import { Server, Socket } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { database } from './database';
import { ServerPlayer, PlayerProgress, PlayerInventory } from './player';
import { PLAYER_DAMAGE, WORLD_WIDTH, WORLD_HEIGHT, ZONE_BOUNDARIES, ENEMY_TIERS, KNOCKBACK_RECOVERY_SPEED, FISH_DETECTION_RADIUS, ENEMY_SIZE, ENEMY_SIZE_MULTIPLIERS, PLAYER_SIZE, KNOCKBACK_FORCE, DROP_CHANCES, PLAYER_MAX_HEALTH, HEALTH_PER_LEVEL, DAMAGE_PER_LEVEL, BASE_XP_REQUIREMENT, XP_MULTIPLIER, RESPAWN_INVULNERABILITY_TIME, enemies, players, dots, obstacles, OBSTACLE_COUNT, ENEMY_CORAL_PROBABILITY, ENEMY_CORAL_HEALTH, SAND_COUNT, DECORATION_COUNT, WORLD_MAP, MapElement, isWall, ACTUAL_WORLD_HEIGHT, ACTUAL_WORLD_WIDTH, SCALE_FACTOR, MAX_SPEED, VIEWPORT_BUFFER, ENEMY_DESPAWN_TIME, ENEMIES_PER_VIEWPORT, ORIGINAL_ENEMY_DENSITY, ORIGINAL_ENEMY_COUNT, VIEWPORT_WITH_BUFFER_AREA, VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from './constants';
import { Enemy, Obstacle, createDecoration, getRandomPositionInZone, Decoration, Sand, createSand, getXPFromEnemy, addXPToPlayer } from './server_utils';
import { Item, ItemWithRarity, WorldItem } from './item';
import { getAllPetalTypes, getPetalStats } from './petals';
import { MOB_CONFIG, getMobStats } from './mobs';
const app = express();

const items: WorldItem[] = [];

const decorations: Decoration[] = [];
const sands: Sand[] = [];
let ENEMY_COUNT = 1000;
const playerUserIds: Record<string, string> = {}; // Maps player ID to user ID
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

const PORT = process.env.PORT || 3000;

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
        const targetEnemyCount = ENEMIES_PER_VIEWPORT * playerCount;
        const currentViewportEnemies = getEnemiesInViewportCount();
        
        if (currentViewportEnemies < targetEnemyCount) {
            const enemiesToSpawn = Math.min(5, targetEnemyCount - currentViewportEnemies); // Spawn up to 5 at a time
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
        
        // Skip if enemy was never in viewport (newly spawned)
        if (!enemy.lastViewportCheck) {
            continue;
        }
        
        // Check if enemy has been outside viewport for too long
        if (currentTime - enemy.lastViewportCheck > ENEMY_DESPAWN_TIME) {
            enemiesToRemove.push(i);
        }
    }
    
    // Remove enemies and notify clients
    for (const index of enemiesToRemove) {
        const enemy = enemies[index];
        enemies.splice(index, 1);
        io.emit('enemyDestroyed', enemy.id);
    }
}

// Update the createEnemy function to respect safe zones and viewport optimization
function createEnemy(): Enemy {
    const playerCount = Object.keys(players).length;
    
    // Don't spawn if we already have enough enemies in viewport
    // Use a minimum of 1 player count to prevent division by zero during startup
    const effectivePlayerCount = Math.max(1, playerCount);
    const targetEnemyCount = ENEMIES_PER_VIEWPORT * effectivePlayerCount;
    
    if (getEnemiesInViewportCount() >= targetEnemyCount) {
        return null as any; // Return null to indicate no spawn needed
    }

    let validPosition = false;
    let x = 0, y = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 50; // Prevent infinite loops

    while (!validPosition && attempts < MAX_ATTEMPTS) {
        attempts++;
        x = Math.random() * ACTUAL_WORLD_WIDTH;
        y = Math.random() * ACTUAL_WORLD_HEIGHT;

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

        // Check if position is in any player's viewport (with buffer)
        const inViewport = isPositionInAnyViewport(x, y);

        if (!inSafeZone && !collidesWithWall && inViewport) {
            validPosition = true;
        }
    }

    // If we couldn't find a valid position, return null
    if (!validPosition) {
        return null as any;
    }

    // Select mob type and tier using mob configs
    const tierRoll = Math.random();
    let tier: Enemy['tier'] = 'common';
    let cumulativeProbability = 0;

    for (const [t, data] of Object.entries(ENEMY_TIERS)) {
        cumulativeProbability += data.probability;
        if (tierRoll < cumulativeProbability) {
            tier = t as Enemy['tier'];
            break;
        }
    }

    // Select mob type (fish, octopus, or shark)
    const mobTypeRoll = Math.random();
    let mobType: Enemy['type'] = 'fish';
    if (mobTypeRoll < 0.4) {
        mobType = 'fish';
    } else if (mobTypeRoll < 0.8) {
        mobType = 'octopus';
    } else {
        mobType = 'shark';
    }

    // Get mob stats from config
    const mobStats = getMobStats(mobType, tier);
    if (!mobStats) {
        console.error(`No mob stats found for ${mobType} ${tier}`);
        return null as any;
    }

    const currentTime = Date.now();
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: mobType,
        tier,
        x,
        y,
        angle: Math.random() * Math.PI * 2,
        health: mobStats.health,
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


// Initialize enemies
let successfulSpawns = 0;
for (let i = 0; i < ENEMY_COUNT; i++) {
    const enemy = createEnemy();
    if (enemy) {
        enemies.push(enemy);
        successfulSpawns++;
    }
}
console.log(`[SERVER] Initialized ${enemies.length} enemies (${successfulSpawns}/${ENEMY_COUNT} successful spawns)`);
console.log(`[SERVER] Density Configuration:`);
console.log(`  Original Density: ${ORIGINAL_ENEMY_DENSITY.toFixed(8)} enemies/pixel²`);
console.log(`  Enemies per Viewport: ${ENEMIES_PER_VIEWPORT}`);
console.log(`  Viewport Area (with buffer): ${VIEWPORT_WITH_BUFFER_AREA.toLocaleString()} pixels²`);
console.log(`  Target: Maintain same density as ${ORIGINAL_ENEMY_COUNT} enemies across entire world`);

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
                    if (players[socket.id]) {
                        players[socket.id].speed_boost = false;
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

    // Add save handler for when players gain XP or level up


    // Update the addXPToPlayer function to save progress
    function addXPToPlayer(player: ServerPlayer, xp: number): void {
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

        if (data.items.length === 0) return;

        const firstItem = data.items[0];
        const { type, rarity } = firstItem;

        if (!rarity) return;

        // Verify all items are same type and rarity
        const validCraft = data.items.every(item =>
            item.type === type && item.rarity === rarity
        );

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
        const rarityUpgrades: Record<string, string> = {
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
        
        const newItem: Item = {
            type: type,
            rarity: newRarity as Item['rarity']
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
        if (closestPlayer && closestDistance < ENEMY_CHASE_RANGE && enemy.type === 'fish') {
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

        // Constrain to world boundaries
        enemy.x = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - ENEMY_SIZE, enemy.x));
        enemy.y = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - ENEMY_SIZE, enemy.y));

        // Check for wall collisions
        WORLD_MAP.filter(isWall).forEach(wall => {
            const scaledWall = {
                x: wall.x * SCALE_FACTOR,
                y: wall.y * SCALE_FACTOR,
                width: wall.width * SCALE_FACTOR,
                height: wall.height * SCALE_FACTOR
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
            const speed = MAX_SPEED * (player.speed_boost ? 2 : 1);
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

        const speed = MAX_SPEED * (player.speed_boost ? 2 : 1);
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
                        addXPToPlayer(player, xpGained);
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
                            addXPToPlayer(player, xpGained);
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
        const targetEnemyCount = ENEMIES_PER_VIEWPORT * playerCount;
        const currentViewportEnemies = getEnemiesInViewportCount();
        
        if (currentViewportEnemies < targetEnemyCount) {
            const enemiesToSpawn = Math.min(3, targetEnemyCount - currentViewportEnemies); // Spawn up to 3 at a time
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
}, 2000); // 2 seconds

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