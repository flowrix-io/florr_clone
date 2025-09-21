"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Add constants at the top
var WORLD_WIDTH = 10000; // Increased from 2000 to 10000
var WORLD_HEIGHT = 2000; // Keep height the same
// Update enemy count for the larger map
var ENEMY_COUNT = 50; // Increased from 10 to 50
// Add zone boundaries for different tier enemies
var ZONE_BOUNDARIES = {
    common: { start: 0, end: 2000 },
    uncommon: { start: 2000, end: 4000 },
    rare: { start: 4000, end: 6000 },
    epic: { start: 6000, end: 8000 },
    legendary: { start: 8000, end: 9000 },
    mythic: { start: 9000, end: WORLD_WIDTH }
};
var ENEMY_CORAL_PROBABILITY = 0.3;
var ENEMY_CORAL_HEALTH = 50;
var ENEMY_CORAL_DAMAGE = 5;
var PLAYER_MAX_HEALTH = 100;
var PLAYER_DAMAGE = 10;
var ITEM_COUNT = 10;
var MAX_INVENTORY_SIZE = 5;
var PLAYER_SIZE = 40;
var COLLISION_RADIUS = PLAYER_SIZE / 2;
var ENEMY_SIZE = 40;
var RESPAWN_INVULNERABILITY_TIME = 3000;
var KNOCKBACK_FORCE = 100; // Increased from 20 to 100
var KNOCKBACK_RECOVERY_SPEED = 0.9;
var ENEMY_TIERS = {
    common: { health: 20, speed: 0.5, damage: 5, probability: 0.4 },
    uncommon: { health: 40, speed: 0.75, damage: 10, probability: 0.3 },
    rare: { health: 60, speed: 1, damage: 15, probability: 0.15 },
    epic: { health: 80, speed: 1.25, damage: 20, probability: 0.1 },
    legendary: { health: 100, speed: 1.5, damage: 25, probability: 0.04 },
    mythic: { health: 150, speed: 2, damage: 30, probability: 0.01 }
};
var players = {};
var enemies = [];
var obstacles = [];
var items = [];
var dots = [];
// Add XP-related constants to the worker
var BASE_XP_REQUIREMENT = 100;
var XP_MULTIPLIER = 1.5;
var MAX_LEVEL = 50;
var HEALTH_PER_LEVEL = 10;
var DAMAGE_PER_LEVEL = 2;
// Add enemy size multipliers constant
var ENEMY_SIZE_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.2,
    rare: 1.4,
    epic: 1.6,
    legendary: 1.8,
    mythic: 2.0
};
// Add decorations array and constants
var DECORATION_COUNT = 100; // Number of palms to spawn
var decorations = [];
// Add createDecoration function
function createDecoration() {
    return {
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        scale: 0.5 + Math.random() * 1.5 // Random size between 0.5x and 2x
    };
}
// Add sand array and constants
var SAND_COUNT = 50; // Reduced from 200 to 50
var MIN_SAND_RADIUS = 50; // Increased from 30 to 50
var MAX_SAND_RADIUS = 120; // Increased from 80 to 120
var sands = [];
// Add createSand function to make patches more spread out
function createSand() {
    // Create sand patches with more spacing
    var sectionWidth = WORLD_WIDTH / (SAND_COUNT / 2); // Divide world into sections
    var sectionIndex = sands.length;
    return {
        x: (sectionIndex * sectionWidth) + Math.random() * sectionWidth, // Spread out along x-axis
        y: Math.random() * WORLD_HEIGHT,
        radius: MIN_SAND_RADIUS + Math.random() * (MAX_SAND_RADIUS - MIN_SAND_RADIUS),
        rotation: Math.random() * Math.PI * 2
    };
}
function calculateXPRequirement(level) {
    return Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, level - 1));
}
function getXPFromEnemy(enemy) {
    var tierMultipliers = {
        common: 10,
        uncommon: 20,
        rare: 40,
        epic: 80,
        legendary: 160,
        mythic: 320
    };
    return tierMultipliers[enemy.tier];
}
function addXPToPlayer(player, xp) {
    if (player.level >= MAX_LEVEL)
        return;
    player.xp += xp;
    while (player.xp >= player.xpToNextLevel && player.level < MAX_LEVEL) {
        player.xp -= player.xpToNextLevel;
        player.level++;
        player.xpToNextLevel = calculateXPRequirement(player.level);
        handleLevelUp(player);
    }
    if (player.level >= MAX_LEVEL) {
        player.xp = 0;
        player.xpToNextLevel = 0;
    }
    socket.emit('xpGained', {
        playerId: player.id,
        xp: xp,
        totalXp: player.xp,
        level: player.level,
        xpToNextLevel: player.xpToNextLevel,
        maxHealth: player.maxHealth,
        damage: player.damage
    });
}
function handleLevelUp(player) {
    player.maxHealth += HEALTH_PER_LEVEL;
    player.health = player.maxHealth;
    player.damage += DAMAGE_PER_LEVEL;
    socket.emit('levelUp', {
        playerId: player.id,
        level: player.level,
        maxHealth: player.maxHealth,
        damage: player.damage
    });
}
// Update createEnemy to use position-based tier selection
function createEnemy() {
    // First, decide the x position
    var x = Math.random() * WORLD_WIDTH;
    // Determine tier based on x position
    var tier = 'common';
    for (var _i = 0, _a = Object.entries(ZONE_BOUNDARIES); _i < _a.length; _i++) {
        var _b = _a[_i], t = _b[0], zone = _b[1];
        if (x >= zone.start && x < zone.end) {
            tier = t;
            break;
        }
    }
    var tierData = ENEMY_TIERS[tier];
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: Math.random() < 0.5 ? 'octopus' : 'fish',
        tier: tier,
        x: x, // Use the determined x position
        y: Math.random() * WORLD_HEIGHT,
        angle: Math.random() * Math.PI * 2,
        health: tierData.health,
        speed: tierData.speed,
        damage: tierData.damage,
        knockbackX: 0,
        knockbackY: 0
    };
}
function createObstacle() {
    var isEnemy = Math.random() < ENEMY_CORAL_PROBABILITY;
    return {
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        width: 50 + Math.random() * 50,
        height: 50 + Math.random() * 50,
        type: 'coral',
        isEnemy: isEnemy,
        health: isEnemy ? ENEMY_CORAL_HEALTH : undefined
    };
}
function createItem() {
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)],
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT
    };
}
// Update moveEnemies to keep enemies in their zones
function moveEnemies() {
    enemies.forEach(function (enemy) {
        // Store original x position
        var originalX = enemy.x;
        // Apply existing movement logic
        if (enemy.knockbackX) {
            enemy.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
            enemy.x += enemy.knockbackX;
            if (Math.abs(enemy.knockbackX) < 0.1)
                enemy.knockbackX = 0;
        }
        if (enemy.knockbackY) {
            enemy.knockbackY *= KNOCKBACK_RECOVERY_SPEED;
            enemy.y += enemy.knockbackY;
            if (Math.abs(enemy.knockbackY) < 0.1)
                enemy.knockbackY = 0;
        }
        if (enemy.type === 'octopus') {
            enemy.x += (Math.random() * 4 - 2) * enemy.speed;
            enemy.y += (Math.random() * 4 - 2) * enemy.speed;
        }
        else {
            enemy.x += Math.cos(enemy.angle) * 2 * enemy.speed;
            enemy.y += Math.sin(enemy.angle) * 2 * enemy.speed;
        }
        // Keep enemy within its zone boundaries
        var zone = ZONE_BOUNDARIES[enemy.tier];
        if (enemy.x < zone.start || enemy.x >= zone.end) {
            // If enemy would leave its zone, reverse direction or reset position
            if (enemy.type === 'fish') {
                enemy.angle = Math.PI - enemy.angle; // Reverse direction
            }
            enemy.x = Math.max(zone.start, Math.min(zone.end - 1, enemy.x));
        }
        // Wrap around only for Y axis
        enemy.y = (enemy.y + WORLD_HEIGHT) % WORLD_HEIGHT;
        if (enemy.type === 'fish' && Math.random() < 0.02) {
            enemy.angle = Math.random() * Math.PI * 2;
        }
    });
}
// Mock socket connection for single player
var MockSocket = /** @class */ (function () {
    function MockSocket() {
        this.eventHandlers = new Map();
        this.id = 'player1'; // Changed to public readonly
        this.broadcast = {
            emit: function (event, data) {
                // In single player, broadcast events are ignored
            }
        };
    }
    MockSocket.prototype.on = function (event, handler) {
        var _a;
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        (_a = this.eventHandlers.get(event)) === null || _a === void 0 ? void 0 : _a.push(handler);
    };
    MockSocket.prototype.emit = function (event, data) {
        // Forward to main thread
        self.postMessage({
            type: 'socketEvent',
            event: event,
            data: data
        });
    };
    // Add getter for id if needed
    MockSocket.prototype.getId = function () {
        return this.id;
    };
    return MockSocket;
}());
// Mock io for single player
var mockIo = {
    emit: function (event, data) {
        self.postMessage({
            type: 'socketEvent',
            event: event,
            data: data
        });
    }
};
var socket = new MockSocket();
// Initialize game state
function initializeGame(messageData) {
    console.log('Initializing game state in worker', messageData);
    var savedProgress = (messageData === null || messageData === void 0 ? void 0 : messageData.savedProgress) || {
        level: 1,
        xp: 0,
        maxHealth: PLAYER_MAX_HEALTH,
        damage: PLAYER_DAMAGE
    };
    console.log('Using saved progress:', savedProgress);
    // Initialize player at the left side of the map
    players[socket.id] = {
        id: socket.id,
        x: 200, // Start near the left edge
        y: WORLD_HEIGHT / 2,
        angle: 0,
        score: 0,
        velocityX: 0,
        velocityY: 0,
        health: savedProgress.maxHealth,
        maxHealth: savedProgress.maxHealth,
        damage: savedProgress.damage,
        inventory: [],
        isInvulnerable: true,
        level: savedProgress.level,
        xp: savedProgress.xp,
        xpToNextLevel: calculateXPRequirement(savedProgress.level)
    };
    // Remove initial invulnerability after the specified time
    setTimeout(function () {
        if (players[socket.id]) {
            players[socket.id].isInvulnerable = false;
        }
    }, RESPAWN_INVULNERABILITY_TIME);
    // Create enemies
    for (var i = 0; i < ENEMY_COUNT; i++) {
        enemies.push(createEnemy());
    }
    // Create obstacles
    for (var i = 0; i < 20; i++) {
        obstacles.push(createObstacle());
    }
    // Create items
    for (var i = 0; i < ITEM_COUNT; i++) {
        items.push(createItem());
    }
    // Create dots
    for (var i = 0; i < 20; i++) {
        dots.push({
            x: Math.random() * WORLD_WIDTH,
            y: Math.random() * WORLD_HEIGHT
        });
    }
    // Create decorations
    for (var i = 0; i < DECORATION_COUNT; i++) {
        decorations.push(createDecoration());
    }
    // Create sand blobs
    for (var i = 0; i < SAND_COUNT; i++) {
        sands.push(createSand());
    }
    console.log('Sending initial game state');
    // Send all initial state in the correct order
    socket.emit('currentPlayers', players);
    socket.emit('enemiesUpdate', enemies);
    socket.emit('obstaclesUpdate', obstacles);
    socket.emit('itemsUpdate', items);
    socket.emit('playerMoved', players[socket.id]); // Ensure player position is set
    socket.emit('decorationsUpdate', decorations);
    socket.emit('sandsUpdate', sands);
}
// Handle messages from main thread
self.onmessage = function (event) {
    var _a = event.data, type = _a.type, socketEvent = _a.event, data = _a.data, savedProgress = _a.savedProgress;
    console.log('Worker received message:', type, { data: data, savedProgress: savedProgress }); // Debug log
    switch (type) {
        case 'init':
            // Pass savedProgress directly from the event.data
            initializeGame({ savedProgress: event.data.savedProgress });
            break;
        case 'socketEvent':
            switch (socketEvent) {
                case 'playerMovement':
                    var player = players[socket.id];
                    if (player) {
                        var newX = data.x;
                        var newY = data.y;
                        // Apply knockback to player position if it exists
                        if (player.knockbackX) {
                            player.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
                            newX += player.knockbackX;
                            if (Math.abs(player.knockbackX) < 0.1)
                                player.knockbackX = 0;
                        }
                        if (player.knockbackY) {
                            player.knockbackY *= KNOCKBACK_RECOVERY_SPEED;
                            newY += player.knockbackY;
                            if (Math.abs(player.knockbackY) < 0.1)
                                player.knockbackY = 0;
                        }
                        var collision = false;
                        var _loop_1 = function (enemy) {
                            var enemySize = ENEMY_SIZE * ENEMY_SIZE_MULTIPLIERS[enemy.tier];
                            if (newX < enemy.x + enemySize &&
                                newX + PLAYER_SIZE > enemy.x &&
                                newY < enemy.y + enemySize &&
                                newY + PLAYER_SIZE > enemy.y) {
                                collision = true;
                                if (!player.isInvulnerable) {
                                    // Enemy damages player
                                    player.health -= enemy.damage;
                                    socket.emit('playerDamaged', { playerId: player.id, health: player.health });
                                    // Player damages enemy
                                    enemy.health -= player.damage; // Use player.damage instead of PLAYER_DAMAGE
                                    socket.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
                                    // Calculate knockback direction
                                    var dx = enemy.x - newX;
                                    var dy = enemy.y - newY;
                                    var distance = Math.sqrt(dx * dx + dy * dy);
                                    var normalizedDx = dx / distance;
                                    var normalizedDy = dy / distance;
                                    // Apply knockback to player's position immediately
                                    newX -= normalizedDx * KNOCKBACK_FORCE;
                                    newY -= normalizedDy * KNOCKBACK_FORCE;
                                    // Store knockback for gradual recovery
                                    player.knockbackX = -normalizedDx * KNOCKBACK_FORCE;
                                    player.knockbackY = -normalizedDy * KNOCKBACK_FORCE;
                                    // Check if enemy dies
                                    if (enemy.health <= 0) {
                                        var index = enemies.findIndex(function (e) { return e.id === enemy.id; });
                                        if (index !== -1) {
                                            // Award XP before removing the enemy
                                            var xpGained = getXPFromEnemy(enemy);
                                            addXPToPlayer(player, xpGained);
                                            // Check for item drop and add directly to inventory
                                            var dropChance = DROP_CHANCES[enemy.tier];
                                            if (Math.random() < dropChance && player.inventory.length < MAX_INVENTORY_SIZE) {
                                                // Create item and add directly to player's inventory
                                                var newItem = {
                                                    id: Math.random().toString(36).substr(2, 9),
                                                    type: ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)],
                                                    x: enemy.x,
                                                    y: enemy.y
                                                };
                                                player.inventory.push(newItem);
                                                // Notify about item pickup
                                                socket.emit('inventoryUpdate', player.inventory);
                                                socket.emit('itemCollected', {
                                                    playerId: player.id,
                                                    itemId: newItem.id,
                                                    itemType: newItem.type
                                                });
                                            }
                                            // Remove the dead enemy and create a new one
                                            enemies.splice(index, 1);
                                            socket.emit('enemyDestroyed', enemy.id);
                                            enemies.push(createEnemy());
                                        }
                                    }
                                    // Check if player dies
                                    if (player.health <= 0) {
                                        respawnPlayer(player);
                                        socket.emit('playerDied', player.id);
                                        socket.emit('playerRespawned', player);
                                        return { value: void 0 };
                                    }
                                }
                                return "break";
                            }
                        };
                        // Check collision with enemies first
                        for (var _i = 0, enemies_1 = enemies; _i < enemies_1.length; _i++) {
                            var enemy = enemies_1[_i];
                            var state_1 = _loop_1(enemy);
                            if (typeof state_1 === "object")
                                return state_1.value;
                            if (state_1 === "break")
                                break;
                        }
                        // Check collision with obstacles
                        for (var _b = 0, obstacles_1 = obstacles; _b < obstacles_1.length; _b++) {
                            var obstacle = obstacles_1[_b];
                            if (newX < obstacle.x + obstacle.width &&
                                newX + PLAYER_SIZE > obstacle.x &&
                                newY < obstacle.y + obstacle.height &&
                                newY + PLAYER_SIZE > obstacle.y) {
                                collision = true;
                                if (obstacle.isEnemy && !player.isInvulnerable) {
                                    player.health -= ENEMY_CORAL_DAMAGE;
                                    socket.emit('playerDamaged', { playerId: player.id, health: player.health });
                                    if (player.health <= 0) {
                                        respawnPlayer(player);
                                        socket.emit('playerDied', player.id);
                                        socket.emit('playerRespawned', player);
                                        return; // Exit early if player dies
                                    }
                                }
                                break;
                            }
                        }
                        // Update player position
                        // Even if there was a collision, we want to apply the knockback
                        player.x = Math.max(0, Math.min(WORLD_WIDTH - PLAYER_SIZE, newX));
                        player.y = Math.max(0, Math.min(WORLD_HEIGHT - PLAYER_SIZE, newY));
                        player.angle = data.angle;
                        player.velocityX = data.velocityX;
                        player.velocityY = data.velocityY;
                        // Always emit the player's position
                        socket.emit('playerMoved', player);
                    }
                    break;
                case 'collectItem':
                    var itemIndex = items.findIndex(function (item) { return item.id === data.itemId; });
                    if (itemIndex !== -1 && players[socket.id].inventory.length < MAX_INVENTORY_SIZE) {
                        var item = items[itemIndex];
                        players[socket.id].inventory.push(item);
                        items.splice(itemIndex, 1);
                        items.push(createItem());
                        socket.emit('itemCollected', { playerId: socket.id, itemId: data.itemId });
                    }
                    break;
                case 'useItem':
                    var playerUsingItem = players[socket.id];
                    var inventoryIndex = playerUsingItem.inventory.findIndex(function (item) { return item.id === data.itemId; });
                    if (inventoryIndex !== -1) {
                        var item = playerUsingItem.inventory[inventoryIndex];
                        playerUsingItem.inventory.splice(inventoryIndex, 1);
                        switch (item.type) {
                            case 'health_potion':
                                playerUsingItem.health = Math.min(playerUsingItem.health + 50, PLAYER_MAX_HEALTH);
                                break;
                            case 'speed_boost':
                                // Implement speed boost
                                break;
                            case 'shield':
                                // Implement shield
                                break;
                        }
                        socket.emit('itemUsed', { playerId: socket.id, itemId: data.itemId });
                    }
                    break;
                case 'requestRespawn':
                    var deadPlayer = players[socket.id];
                    if (deadPlayer) {
                        respawnPlayer(deadPlayer);
                    }
                    break;
                // ... (handle other socket events)
            }
            break;
    }
};
// Game loop (like server's setInterval)
setInterval(function () {
    moveEnemies();
    mockIo.emit('enemiesUpdate', enemies);
}, 100);
// Add error handling
self.onerror = function (error) {
    console.error('Worker error:', error);
};
// Update respawnPlayer to not lose levels
function respawnPlayer(player) {
    // Determine spawn zone based on player level without losing levels
    var spawnX;
    if (player.level <= 5) {
        spawnX = Math.random() * ZONE_BOUNDARIES.common.end;
    }
    else if (player.level <= 10) {
        spawnX = ZONE_BOUNDARIES.uncommon.start + Math.random() * (ZONE_BOUNDARIES.uncommon.end - ZONE_BOUNDARIES.uncommon.start);
    }
    else if (player.level <= 15) {
        spawnX = ZONE_BOUNDARIES.rare.start + Math.random() * (ZONE_BOUNDARIES.rare.end - ZONE_BOUNDARIES.rare.start);
    }
    else if (player.level <= 25) {
        spawnX = ZONE_BOUNDARIES.epic.start + Math.random() * (ZONE_BOUNDARIES.epic.end - ZONE_BOUNDARIES.epic.start);
    }
    else if (player.level <= 40) {
        spawnX = ZONE_BOUNDARIES.legendary.start + Math.random() * (ZONE_BOUNDARIES.legendary.end - ZONE_BOUNDARIES.legendary.start);
    }
    else {
        spawnX = ZONE_BOUNDARIES.mythic.start + Math.random() * (ZONE_BOUNDARIES.mythic.end - ZONE_BOUNDARIES.mythic.start);
    }
    // Reset health and position but keep level and stats
    player.health = player.maxHealth;
    player.x = spawnX;
    player.y = Math.random() * WORLD_HEIGHT;
    player.score = Math.max(0, player.score - 10); // Still lose some score
    player.inventory = [];
    player.isInvulnerable = true;
    // Just notify about respawn without level loss
    socket.emit('playerRespawned', player);
    setTimeout(function () {
        player.isInvulnerable = false;
    }, RESPAWN_INVULNERABILITY_TIME);
}
// Add drop chance constants
var DROP_CHANCES = {
    common: 0.1, // 10% chance
    uncommon: 0.2, // 20% chance
    rare: 0.3, // 30% chance
    epic: 0.4, // 40% chance
    legendary: 0.5, // 50% chance
    mythic: 0.75 // 75% chance
};
