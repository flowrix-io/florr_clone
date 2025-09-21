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
const app = (0, express_1.default)();
const decorations = [];
const sands = [];
let ENEMY_COUNT = 1000;
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
// Update the createEnemy function to respect safe zones
function createEnemy() {
    let validPosition = false;
    let x = 0, y = 0;
    while (!validPosition) {
        x = Math.random() * constants_1.ACTUAL_WORLD_WIDTH;
        y = Math.random() * constants_1.ACTUAL_WORLD_HEIGHT;
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
    // Rest of createEnemy function remains the same
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
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: Math.random() < 0.5 ? 'octopus' : 'fish',
        tier,
        x,
        y,
        angle: Math.random() * Math.PI * 2,
        health: constants_1.ENEMY_TIERS[tier].health,
        speed: constants_1.ENEMY_TIERS[tier].speed,
        damage: constants_1.ENEMY_TIERS[tier].damage,
        knockbackX: 0,
        knockbackY: 0
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
// Initialize enemies
for (let i = 0; i < ENEMY_COUNT; i++) {
    constants_1.enemies.push(createEnemy());
}
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
    // Handle authentication
    socket.on('authenticate', async (credentials) => {
        const user = database_1.database.getUser(credentials.username, credentials.password);
        if (user) {
            socket.userId = user.id;
            socket.username = user.username;
            console.log('User authenticated, loading saved progress for userId:', user.id);
            const savedProgress = database_1.database.getPlayerByUserId(user.id);
            console.log('Loaded saved progress:', savedProgress);
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
                inventory: savedProgress?.inventory || [],
                loadout: savedProgress?.loadout || Array(10).fill(null),
                isInvulnerable: true,
                level: savedProgress?.level || 1,
                xp: savedProgress?.xp || 0,
                xpToNextLevel: calculateXPRequirement(savedProgress?.level || 1)
            };
            // Save initial state and log the result
            console.log('Saving initial player state');
            savePlayerProgress(constants_1.players[socket.id], user.id);
            // Remove initial invulnerability after the specified time
            setTimeout(() => {
                if (constants_1.players[socket.id]) {
                    constants_1.players[socket.id].isInvulnerable = false;
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
            socket.emit('itemsUpdate', constants_1.items);
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
    // Update disconnect handler
    socket.on('disconnect', () => {
        console.log('A user disconnected');
        if (constants_1.players[socket.id] && socket.userId) {
            // Save progress with user ID
            savePlayerProgress(constants_1.players[socket.id], socket.userId);
        }
        delete constants_1.players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
    socket.on('playerMovement', (movementData) => {
        const player = constants_1.players[socket.id];
        if (!player) {
            return;
        }
        let newX = movementData.x;
        let newY = movementData.y;
        // Only log significant movements for performance
        const moveDistance = Math.sqrt((newX - player.x) ** 2 + (newY - player.y) ** 2);
        if (moveDistance > 10) {
            console.log(`[SERVER] Large movement: ${moveDistance.toFixed(1)} pixels`);
        }
        // Apply knockback to player position if it exists
        if (player.knockbackX) {
            player.knockbackX *= constants_1.KNOCKBACK_RECOVERY_SPEED;
            newX += player.knockbackX;
            if (Math.abs(player.knockbackX) < 0.1)
                player.knockbackX = 0;
        }
        if (player.knockbackY) {
            player.knockbackY *= constants_1.KNOCKBACK_RECOVERY_SPEED;
            newY += player.knockbackY;
            if (Math.abs(player.knockbackY) < 0.1)
                player.knockbackY = 0;
        }
        // Ensure player stays within world bounds
        newX = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_WIDTH, newX));
        newY = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_HEIGHT, newY));
        // Check for wall collisions
        let collision = false;
        for (const element of constants_1.WORLD_MAP) {
            if (element.type === 'wall') {
                const wallX = element.x * constants_1.SCALE_FACTOR;
                const wallY = element.y * constants_1.SCALE_FACTOR;
                const wallWidth = element.width * constants_1.SCALE_FACTOR;
                const wallHeight = element.height * constants_1.SCALE_FACTOR;
                if (newX < wallX + wallWidth &&
                    newX + constants_1.PLAYER_SIZE > wallX &&
                    newY < wallY + wallHeight &&
                    newY + constants_1.PLAYER_SIZE > wallY) {
                    collision = true;
                    // Restore previous valid position
                    newX = player.x;
                    newY = player.y;
                    break;
                }
            }
        }
        // Check for item collisions
        const ITEM_PICKUP_RADIUS = 40; // Radius for item pickup
        for (let i = constants_1.items.length - 1; i >= 0; i--) {
            const item = constants_1.items[i]; // Cast to ItemWithRarity
            const dx = newX - item.x;
            const dy = newY - item.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < ITEM_PICKUP_RADIUS) {
                // Create a copy of the current inventory
                const newInventory = [...player.inventory];
                // Add item to player's inventory copy
                newInventory.push({
                    id: item.id,
                    type: item.type,
                    x: item.x,
                    y: item.y,
                    rarity: item.rarity // Ensure rarity is included
                });
                // Update player's inventory with the new copy
                player.inventory = newInventory;
                // Remove item from world
                constants_1.items.splice(i, 1);
                // Notify clients
                socket.emit('inventoryUpdate', newInventory); // Send the new inventory
                io.emit('itemCollected', {
                    playerId: socket.id,
                    itemId: item.id,
                    inventory: newInventory // Include complete inventory in update
                });
                io.emit('itemsUpdate', constants_1.items);
                // Log inventory state
                console.log('Updated inventory:', {
                    playerId: socket.id,
                    inventorySize: newInventory.length,
                    newItem: item,
                    inventory: newInventory
                });
            }
        }
        // Check collision with enemies first
        for (const enemy of constants_1.enemies) {
            const enemySize = constants_1.ENEMY_SIZE * constants_1.ENEMY_SIZE_MULTIPLIERS[enemy.tier];
            if (newX < enemy.x + enemySize &&
                newX + constants_1.PLAYER_SIZE > enemy.x &&
                newY < enemy.y + enemySize &&
                newY + constants_1.PLAYER_SIZE > enemy.y) {
                collision = true;
                console.log(`[SERVER] Enemy collision detected: player(${newX.toFixed(1)}, ${newY.toFixed(1)}, ${constants_1.PLAYER_SIZE}x${constants_1.PLAYER_SIZE}) vs enemy(${enemy.x.toFixed(1)}, ${enemy.y.toFixed(1)}, ${enemySize}x${enemySize}) tier:${enemy.tier} id:${enemy.id}`);
                if (!player.isInvulnerable) {
                    // Enemy damages player
                    const healthBefore = player.health;
                    player.health -= enemy.damage;
                    player.lastDamageTime = Date.now(); // Add this line
                    console.log(`[SERVER] Player damaged: ${healthBefore} -> ${player.health} (damage: ${enemy.damage})`);
                    io.emit('playerDamaged', { playerId: player.id, health: player.health });
                    // Player damages enemy
                    const enemyHealthBefore = enemy.health;
                    enemy.health -= player.damage;
                    console.log(`[SERVER] Enemy damaged: ${enemyHealthBefore} -> ${enemy.health} (damage: ${player.damage})`);
                    io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                    // Calculate knockback direction
                    const dx = enemy.x - newX;
                    const dy = enemy.y - newY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const normalizedDx = dx / distance;
                    const normalizedDy = dy / distance;
                    // Apply knockback to player's position immediately
                    const oldX = newX, oldY = newY;
                    newX -= normalizedDx * constants_1.KNOCKBACK_FORCE;
                    newY -= normalizedDy * constants_1.KNOCKBACK_FORCE;
                    console.log(`[SERVER] Knockback applied: (${oldX.toFixed(1)}, ${oldY.toFixed(1)}) -> (${newX.toFixed(1)}, ${newY.toFixed(1)}) force:${constants_1.KNOCKBACK_FORCE}`);
                    // Store knockback for gradual recovery
                    player.knockbackX = -normalizedDx * constants_1.KNOCKBACK_FORCE;
                    player.knockbackY = -normalizedDy * constants_1.KNOCKBACK_FORCE;
                    // Check if enemy dies
                    if (enemy.health <= 0) {
                        const index = constants_1.enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            // Award XP before removing the enemy
                            const xpGained = getXPFromEnemy(enemy);
                            addXPToPlayer(player, xpGained);
                            // Check for item drop
                            const dropChance = constants_1.DROP_CHANCES[enemy.tier];
                            if (Math.random() < dropChance) {
                                const newItem = {
                                    id: Math.random().toString(36).substr(2, 9),
                                    type: ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)],
                                    x: enemy.x,
                                    y: enemy.y,
                                    rarity: enemy.tier // Match the enemy's tier for the item rarity
                                };
                                // Add item to the world
                                constants_1.items.push(newItem);
                                // Notify all clients about the new item
                                io.emit('itemsUpdate', constants_1.items);
                            }
                            constants_1.enemies.splice(index, 1);
                            io.emit('enemyDestroyed', enemy.id);
                            // Only spawn new enemy if below ENEMY_COUNT
                            if (constants_1.enemies.length < ENEMY_COUNT) {
                                constants_1.enemies.push(createEnemy());
                            }
                        }
                    }
                    // Check if player dies
                    if (player.health <= 0) {
                        console.log(`[SERVER] Player died during enemy collision, health: ${player.health} - EARLY RETURN!`);
                        respawnPlayer(player);
                        io.emit('playerDied', player.id);
                        io.emit('playerRespawned', player);
                        return;
                    }
                }
                break;
            }
        }
        // Update player position if no collision
        if (!collision) {
            player.x = newX;
            player.y = newY;
            player.angle = movementData.angle;
            player.velocityX = movementData.velocityX;
            player.velocityY = movementData.velocityY;
        }
        if (player.health <= 0) {
            respawnPlayer(player);
            io.emit('playerDied', player.id);
            io.emit('playerRespawned', player);
            return;
        }
        // Always emit the updated position
        io.emit('playerMoved', player);
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
    socket.on('useItem', (itemId) => {
        console.log('useItem event received:', itemId); // Add debug log
        const player = constants_1.players[socket.id];
        if (!player) {
            console.log('Player not found:', socket.id);
            return;
        }
        // Find the item in the loadout
        const loadoutSlot = player.loadout.findIndex(item => item?.id === itemId);
        console.log('Found item in loadout slot:', loadoutSlot); // Add debug log
        if (loadoutSlot === -1) {
            console.log('Item not found in loadout:', itemId);
            return; // Item not found in loadout
        }
        const item = player.loadout[loadoutSlot]; // Cast to ItemWithRarity
        if (!item) {
            console.log('Item is null');
            return;
        }
        if (item.onCooldown) {
            console.log('Item is on cooldown:', itemId);
            return;
        }
        console.log('Using item:', {
            itemId,
            type: item.type,
            rarity: item.rarity,
            loadoutSlot
        });
        // Rest of the code remains the same...
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
                console.log('Applied health potion effect:', player.health);
                break;
            case 'speed_boost':
                player.speed_boost = true;
                io.emit('speedBoostActive', player.id);
                console.log('Applied speed boost effect');
                setTimeout(() => {
                    if (constants_1.players[socket.id]) {
                        constants_1.players[socket.id].speed_boost = false;
                        console.log('Speed boost wore off');
                    }
                }, 5000 * multiplier);
                break;
            case 'shield':
                player.isInvulnerable = true;
                console.log('Applied shield effect');
                setTimeout(() => {
                    if (constants_1.players[socket.id]) {
                        constants_1.players[socket.id].isInvulnerable = false;
                        console.log('Shield wore off');
                    }
                }, 3000 * multiplier);
                break;
        }
        // Notify clients about the item use without removing it
        io.emit('itemUsed', {
            playerId: socket.id,
            itemId: itemId,
            type: item.type,
            rarity: item.rarity
        });
        console.log('Emitted itemUsed event');
        // Add cooldown to the item
        const cooldownTime = 10000; // 10 seconds base cooldown
        item.onCooldown = true;
        console.log('Added cooldown to item');
        setTimeout(() => {
            if (player.loadout[loadoutSlot] === item) {
                item.onCooldown = false;
                io.emit('itemCooldownComplete', {
                    playerId: socket.id,
                    itemId: itemId
                });
                console.log('Cooldown complete for item:', itemId);
            }
        }, cooldownTime * (1 / multiplier));
        // Update the player state
        io.emit('playerUpdated', player);
        console.log('Updated player state');
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
    io.on('connection', (socket) => {
        // ... existing connection code ...
        socket.on('craftItems', (data) => {
            const player = constants_1.players[socket.id];
            if (!player)
                return;
            // Verify all items exist in player's inventory
            const validItems = data.items.every(craftItem => player.inventory.some(invItem => invItem.id === craftItem.id));
            if (!validItems) {
                socket.emit('craftingFailed', 'Invalid items selected for crafting');
                return;
            }
            // Verify all items are same type and rarity
            const firstItem = data.items[0];
            const validCraft = data.items.every(item => item.type === firstItem.type &&
                item.rarity === firstItem.rarity);
            if (!validCraft) {
                socket.emit('craftingFailed', 'Items must be of same type and rarity');
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
            const currentRarity = firstItem.rarity || 'common';
            if (!rarityUpgrades[currentRarity]) {
                socket.emit('craftingFailed', 'Cannot upgrade mythic items');
                return;
            }
            // Remove crafting items from inventory
            player.inventory = player.inventory.filter(invItem => !data.items.some(craftItem => craftItem.id === invItem.id));
            // Create new upgraded item
            const newItem = {
                id: Math.random().toString(36).substr(2, 9),
                type: firstItem.type,
                x: player.x,
                y: player.y,
                rarity: rarityUpgrades[currentRarity]
            };
            // Add new item to inventory
            player.inventory.push(newItem);
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
// Update the start_loop function to use a fixed time step with proper game state broadcasting
async function start_loop() {
    const TICK_RATE = 60; // 60 updates per second
    const TICK_TIME = 1000 / TICK_RATE;
    const BROADCAST_RATE = 30; // 30 broadcasts per second for smooth sync
    const BROADCAST_TIME = 1000 / BROADCAST_RATE;
    let lastBroadcastTime = 0;
    while (true) {
        const startTime = Date.now();
        // Update game logic
        moveEnemies();
        // Broadcast game state at controlled rate
        if (startTime - lastBroadcastTime >= BROADCAST_TIME) {
            // Broadcast complete game state for synchronization
            io.emit('gameStateUpdate', {
                players: Object.values(constants_1.players).map(p => ({
                    id: p.id,
                    name: p.name,
                    x: p.x,
                    y: p.y,
                    angle: p.angle,
                    health: p.health,
                    maxHealth: p.maxHealth,
                    level: p.level,
                    score: p.score
                })),
                timestamp: startTime
            });
            lastBroadcastTime = startTime;
        }
        const elapsedTime = Date.now() - startTime;
        const sleepTime = Math.max(0, TICK_TIME - elapsedTime);
        await new Promise(resolve => setTimeout(resolve, sleepTime));
    }
}
httpsServer.listen(PORT, () => {
    console.log(`Server is running on https://localhost:${PORT}`);
});
// Add XP calculation functions
function calculateXPRequirement(level) {
    return Math.floor(constants_1.BASE_XP_REQUIREMENT * Math.pow(constants_1.XP_MULTIPLIER, level - 1));
}
function getXPFromEnemy(enemy) {
    const tierMultipliers = {
        common: 10,
        uncommon: 20,
        rare: 40,
        epic: 80,
        legendary: 160,
        mythic: 320
    };
    return tierMultipliers[enemy.tier];
}
// Optional: Clean up old player data periodically
setInterval(() => {
    database_1.database.cleanupOldPlayers(30); // Clean up players not seen in 30 days
}, 24 * 60 * 60 * 1000); // Run once per day
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
// Move savePlayerProgress outside the socket connection handler
function savePlayerProgress(player, userId) {
    if (userId) {
        console.log('Saving player progress for userId:', userId);
        const saveResult = database_1.database.savePlayer(player.id, userId, {
            level: player.level,
            xp: player.xp,
            maxHealth: player.maxHealth,
            damage: player.damage,
            inventory: player.inventory,
            loadout: player.loadout
        });
        if (saveResult) {
            console.log('Successfully saved player progress');
        }
        else {
            console.error('Failed to save player progress');
        }
    }
    else {
        console.warn('Attempted to save player progress without userId');
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
                console.log(`Progress saved for player ${playerId}`);
            }
            else {
                console.log(`Player ${playerId} not found or not authenticated`);
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
            console.log(`Saved progress for ${savedCount} players`);
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
    // Remove excess enemies if current count is higher than ENEMY_COUNT
    while (constants_1.enemies.length > ENEMY_COUNT) {
        constants_1.enemies.pop();
        io.emit('enemyDestroyed', constants_1.enemies[constants_1.enemies.length - 1].id);
    }
    // Add new enemies if current count is lower than ENEMY_COUNT
    while (constants_1.enemies.length < ENEMY_COUNT) {
        constants_1.enemies.push(createEnemy());
    }
    // Update all clients with the new enemy state
    io.emit('enemiesUpdate', constants_1.enemies);
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
