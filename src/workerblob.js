// Worker code starts here
const WORLD_WIDTH = 10000;  // Changed from 2000 to 10000
const WORLD_HEIGHT = 2000;
const FISH_DETECTION_RADIUS = 500;  // How far fish can detect players
const PLAYER_BASE_SPEED = 5;  // Base player speed to match
const FISH_RETURN_SPEED = 0.5;  // Speed at which fish return to their normal behavior
const ENEMY_COUNT = 100;
const OBSTACLE_COUNT = 20;
const ENEMY_CORAL_PROBABILITY = 0.3;
const ENEMY_CORAL_HEALTH = 50;
const ENEMY_CORAL_DAMAGE = 5;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_DAMAGE = 10;
const ITEM_COUNT = 10;
const MAX_INVENTORY_SIZE = 5;
const PLAYER_SIZE = 40;
const COLLISION_RADIUS = PLAYER_SIZE / 2;
const ENEMY_SIZE = 40;
const RESPAWN_INVULNERABILITY_TIME = 3000;
const KNOCKBACK_FORCE = 20;
const KNOCKBACK_RECOVERY_SPEED = 0.9;
const DECORATION_COUNT = 100;  // Number of palms to spawn
var BASE_XP_REQUIREMENT = 100;
var XP_MULTIPLIER = 1.5;
var HEALTH_PER_LEVEL = 10;
var DAMAGE_PER_LEVEL = 2;
var DROP_CHANCES = {
    common: 0.1, // 10% chance
    uncommon: 0.2, // 20% chance
    rare: 0.3, // 30% chance
    epic: 0.4, // 40% chance
    legendary: 0.5, // 50% chance
    mythic: 0.75 // 75% chance
};

const ENEMY_TIERS = {
    common: { health: 20, speed: 0.5, damage: 5, probability: 0.4 },
    uncommon: { health: 40, speed: 0.75, damage: 10, probability: 0.3 },
    rare: { health: 60, speed: 1, damage: 15, probability: 0.15 },
    epic: { health: 80, speed: 1.25, damage: 20, probability: 0.1 },
    legendary: { health: 100, speed: 1.5, damage: 25, probability: 0.04 },
    mythic: { health: 150, speed: 2, damage: 30, probability: 0.01 }
};
var ZONE_BOUNDARIES = {
    common: { start: 0, end: 2000 },
    uncommon: { start: 2000, end: 4000 },
    rare: { start: 4000, end: 6000 },
    epic: { start: 6000, end: 8000 },
    legendary: { start: 8000, end: 9000 },
    mythic: { start: 9000, end: WORLD_WIDTH }
};
var ENEMY_SIZE_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.2,
    rare: 1.4,
    epic: 1.6,
    legendary: 1.8,
    mythic: 2.0
};

const players = {};
const enemies = [];
const obstacles = [];
const items = [];
const dots = [];
const decorations = [];
const sands = [];

// Helper function to get random position in a specific zone
function getRandomPositionInZone(zoneIndex) {
    const zoneWidth = WORLD_WIDTH / 6;  // 6 zones
    const startX = zoneIndex * zoneWidth;
    
    // For legendary and mythic zones, ensure they're in the rightmost areas
    if (zoneIndex >= 4) {  // Legendary and Mythic zones
        const adjustedStartX = WORLD_WIDTH - (6 - zoneIndex) * (zoneWidth / 2);  // Start from right side
        return {
            x: adjustedStartX + Math.random() * (WORLD_WIDTH - adjustedStartX),
            y: Math.random() * WORLD_HEIGHT
        };
    }
    
    return {
        x: startX + Math.random() * zoneWidth,
        y: Math.random() * WORLD_HEIGHT
    };
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
    player.xp += xp;
    while (player.xp >= player.xpToNextLevel) {
        player.xp -= player.xpToNextLevel;
        player.level++;
        player.xpToNextLevel = calculateXPRequirement(player.level);
        handleLevelUp(player);
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

// Add these constants at the top with other constants


function moveEnemies() {
    if (!enemies || !enemies.length) return;  // Guard against undefined enemies array
    
    enemies.forEach(enemy => {
        if (!enemy) return;  // Guard against undefined enemy objects
        
        try {
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

            // Find nearest player for fish behavior
            let nearestPlayer = null;
            let nearestDistance = Infinity;
            
            Object.values(players).forEach(player => {
                const dx = player.x - enemy.x;
                const dy = player.y - enemy.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestPlayer = player;
                }
            });

            // Different movement patterns based on enemy type
            if (enemy.type === 'octopus') {
                // Random movement for octopus
                enemy.x += (Math.random() * 4 - 2) * (enemy.speed || 1);
                enemy.y += (Math.random() * 4 - 2) * (enemy.speed || 1);
            } else {
                // Fish behavior
                if (nearestPlayer && nearestDistance < FISH_DETECTION_RADIUS) {
                    // Fish detected player - match player speed
                    const dx = nearestPlayer.x - enemy.x;
                    const dy = nearestPlayer.y - enemy.y;
                    const angle = Math.atan2(dy, dx);
                    
                    // Update enemy angle for proper facing direction
                    enemy.angle = angle;
                    
                    // Calculate chase speed based on player's current speed
                    const playerSpeed = 16;
                    
                    // Match player speed but consider enemy tier for slight variations
                    const tierSpeedMultiplier = ENEMY_TIERS[enemy.tier].speed;
                    const chaseSpeed = playerSpeed * tierSpeedMultiplier;
                    
                    // Move towards player matching their speed
                    enemy.x += Math.cos(angle) * chaseSpeed;
                    enemy.y += Math.sin(angle) * chaseSpeed;
                    
                    // Mark fish as hostile
                    enemy.isHostile = true;
                } else {
                    // Normal fish behavior
                    enemy.isHostile = false;
                    
                    // Return to normal speed gradually
                    const normalSpeed = ENEMY_TIERS[enemy.tier].speed * 2;
                    enemy.x += Math.cos(enemy.angle || 0) * normalSpeed;
                    enemy.y += Math.sin(enemy.angle || 0) * normalSpeed;
                    
                    // Randomly change direction occasionally
                    if (Math.random() < 0.02) {
                        enemy.angle = Math.random() * Math.PI * 2;
                    }
                }
            }

            // Keep enemies in their respective zones
            const zoneWidth = WORLD_WIDTH / 6;
            const tierZones = {
                common: 0,
                uncommon: 1,
                rare: 2,
                epic: 3,
                legendary: 4,
                mythic: 5
            };
            
            const zoneIndex = tierZones[enemy.tier] || 0;
            const zoneStartX = zoneIndex * zoneWidth;
            const zoneEndX = (zoneIndex + 1) * zoneWidth;
            
            // Add some overlap between zones (10% on each side)
            const overlap = zoneWidth * 0.1;
            const minX = Math.max(0, zoneStartX - overlap);
            const maxX = Math.min(WORLD_WIDTH, zoneEndX + overlap);
            
            // Constrain enemy position to its zone
            enemy.x = Math.max(minX, Math.min(maxX, enemy.x));
            enemy.y = Math.max(0, Math.min(WORLD_HEIGHT, enemy.y));
        } catch (error) {
            console.error('Error moving enemy:', error, enemy);
        }
    });

    try {
        // Filter out any undefined enemies before emitting
        const validEnemies = enemies.filter(enemy => enemy !== undefined);
        socket.emit('enemiesUpdate', validEnemies);
    } catch (error) {
        console.error('Error emitting enemies update:', error);
    }
}

// Update creation functions to use zones
function createDecoration() {
    const zoneIndex = Math.floor(Math.random() * 6);  // 6 zones
    const pos = getRandomPositionInZone(zoneIndex);
    return {
        x: pos.x,
        y: pos.y,
        scale: 0.5 + Math.random() * 1.5
    };
}

function createEnemy() {
    const tierRoll = Math.random();
    let tier = 'common';
    let cumulativeProbability = 0;
    for (const [t, data] of Object.entries(ENEMY_TIERS)) {
        cumulativeProbability += data.probability;
        if (tierRoll < cumulativeProbability) {
            tier = t;
            break;
        }
    }
    const tierData = ENEMY_TIERS[tier];
    
    // Map tiers to specific zones, ensuring legendary and mythic are in the rightmost areas
    const tierZones = {
        common: 0,
        uncommon: 1,
        rare: 2,
        epic: 3,
        legendary: 4,
        mythic: 5
    };
    
    const pos = getRandomPositionInZone(tierZones[tier]);
    
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: Math.random() < 0.5 ? 'octopus' : 'fish',
        tier,
        x: pos.x,
        y: pos.y,
        angle: Math.random() * Math.PI * 2,
        health: tierData.health,
        speed: tierData.speed,
        damage: tierData.damage,
        knockbackX: 0,
        knockbackY: 0
    };
}

function createObstacle() {
    const zoneIndex = Math.floor(Math.random() * 6);
    const pos = getRandomPositionInZone(zoneIndex);
    const isEnemy = Math.random() < ENEMY_CORAL_PROBABILITY;
    return {
        id: Math.random().toString(36).substr(2, 9),
        x: pos.x,
        y: pos.y,
        width: 50 + Math.random() * 50,
        height: 50 + Math.random() * 50,
        type: 'coral',
        isEnemy,
        health: isEnemy ? ENEMY_CORAL_HEALTH : undefined
    };
}

function createItem() {
    const zoneIndex = Math.floor(Math.random() * 6);
    const pos = getRandomPositionInZone(zoneIndex);
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)],
        x: pos.x,
        y: pos.y
    };
}

function initializeGame(messageData) {
    console.log('Initializing game state in worker');
    
    // Extract saved progress data with defaults
    const savedProgress = messageData.savedProgress || {};
    const level = parseInt(savedProgress.level) || 1;
    const xp = parseInt(savedProgress.xp) || 0;
    
    // Calculate stats based on level
    const maxHealth = PLAYER_MAX_HEALTH + (HEALTH_PER_LEVEL * (level - 1));
    const damage = PLAYER_DAMAGE + (DAMAGE_PER_LEVEL * (level - 1));
    const xpToNextLevel = calculateXPRequirement(level);

    // Start player in the first zone (common)
    players[socket.id] = {
        id: socket.id,
        x: WORLD_WIDTH / 12,  // Center of first zone
        y: WORLD_HEIGHT / 2,
        angle: 0,
        score: 0,
        velocityX: 0,
        velocityY: 0,
        health: maxHealth,  // Start with full health
        inventory: [],
        isInvulnerable: true,
        level: level,
        xp: xp,
        xpToNextLevel: xpToNextLevel,
        maxHealth: maxHealth,
        damage: damage,
        lastDamageTaken: 0,
        isRegenerating: false,
        loadout: Array(10).fill(null),  // Initialize with 10 null slots
    };

    console.log('Initialized player with stats:', {
        level,
        xp,
        maxHealth,
        damage,
        xpToNextLevel
    });

    // Ensure specific number of legendary and mythic enemies
    const legendaryCount = Math.floor(ENEMY_COUNT * 0.04);  // 4% of total
    const mythicCount = Math.floor(ENEMY_COUNT * 0.01);     // 1% of total
    
    // Spawn legendary enemies
    for (let i = 0; i < legendaryCount; i++) {
        const enemy = createEnemy();
        enemy.tier = 'legendary';
        const pos = getRandomPositionInZone(4);  // Zone 4 for legendary
        enemy.x = pos.x;
        enemy.y = pos.y;
        enemies.push(enemy);
    }
    
    // Spawn mythic enemies
    for (let i = 0; i < mythicCount; i++) {
        const enemy = createEnemy();
        enemy.tier = 'mythic';
        const pos = getRandomPositionInZone(5);  // Zone 5 for mythic
        enemy.x = pos.x;
        enemy.y = pos.y;
        enemies.push(enemy);
    }
    
    // Spawn remaining enemies
    const remainingCount = ENEMY_COUNT - legendaryCount - mythicCount;
    for (let i = 0; i < remainingCount; i++) {
        enemies.push(createEnemy());
    }

    for (let i = 0; i < OBSTACLE_COUNT; i++) {
        obstacles.push(createObstacle());
    }

    for (let i = 0; i < ITEM_COUNT; i++) {
        items.push(createItem());
    }

    for (let i = 0; i < DECORATION_COUNT; i++) {
        decorations.push(createDecoration());
    }

    // Emit initial state
    socket.emit('currentPlayers', players);
    socket.emit('enemiesUpdate', enemies);
    socket.emit('obstaclesUpdate', obstacles);
    socket.emit('itemsUpdate', items);
    socket.emit('decorationsUpdate', decorations);
    socket.emit('playerMoved', players[socket.id]);
}

// Add the XP requirement calculation function if it's missing
function calculateXPRequirement(level) {
    return Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, level - 1));
}

// Mock Socket class implementation
class MockSocket {
    constructor() {
        this.eventHandlers = new Map();
        this.id = 'player1';
    }
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event)?.push(handler);
    }
    emit(event, data) {
        self.postMessage({
            type: 'socketEvent',
            event,
            data
        });
    }
    getId() {
        return this.id;
    }
}

const socket = new MockSocket();

// Message handler
self.onmessage = function(event) {
    const { type, event: socketEvent, data } = event.data;
    
    switch (type) {
        case 'init':
            initializeGame(event.data);
            break;
        case 'socketEvent':
            switch (socketEvent) {
case 'playerMovement':
    const currentPlayer = players[socket.id];
    if (currentPlayer) {
        let newX = data.x;
        let newY = data.y;

        // Apply knockback to player position if it exists
        if (currentPlayer.knockbackX) {
            currentPlayer.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
            newX += currentPlayer.knockbackX;
            if (Math.abs(currentPlayer.knockbackX) < 0.1) currentPlayer.knockbackX = 0;
        }
        if (currentPlayer.knockbackY) {
            currentPlayer.knockbackY *= KNOCKBACK_RECOVERY_SPEED;
            newY += currentPlayer.knockbackY;
            if (Math.abs(currentPlayer.knockbackY) < 0.1) currentPlayer.knockbackY = 0;
        }

        // Check for item collisions
        const ITEM_PICKUP_RADIUS = 40;  // Radius for item pickup
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            const dx = newX - item.x;
            const dy = newY - item.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < ITEM_PICKUP_RADIUS && currentPlayer.inventory.length < MAX_INVENTORY_SIZE) {
                // Add item to player's inventory
                currentPlayer.inventory.push(item);
                
                // Remove item from world
                items.splice(i, 1);
                
                // Create new item to maintain item count
                items.push(createItem());
                
                // Notify clients
                socket.emit('inventoryUpdate', currentPlayer.inventory);
                socket.emit('itemCollected', { 
                    playerId: socket.id, 
                    itemId: item.id 
                });
                socket.emit('itemsUpdate', items);
            }
        }

        // Rest of the existing collision checks...
        let collision = false;

        // Check collision with enemies first
        for (const enemy of enemies) {
            const enemySize = ENEMY_SIZE * ENEMY_SIZE_MULTIPLIERS[enemy.tier];
            
            if (
                newX < enemy.x + enemySize &&
                newX + PLAYER_SIZE > enemy.x &&
                newY < enemy.y + enemySize &&
                newY + PLAYER_SIZE > enemy.y
            ) {
                collision = true;
                console.log(enemy);
                if (true) {
                    // Enemy damages player
                    currentPlayer.health -= enemy.damage;
                    socket.emit('playerDamaged', { playerId: currentPlayer.id, health: currentPlayer.health });

                    // Player damages enemy
                    enemy.health -= currentPlayer.damage;
                    socket.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });

                    // Calculate knockback direction
                    const dx = enemy.x - newX;
                    const dy = enemy.y - newY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const normalizedDx = dx / distance;
                    const normalizedDy = dy / distance;

                    // Apply knockback to player's position immediately
                    newX -= normalizedDx * KNOCKBACK_FORCE;
                    newY -= normalizedDy * KNOCKBACK_FORCE;
                    
                    // Store knockback for gradual recovery
                    currentPlayer.knockbackX = -normalizedDx * KNOCKBACK_FORCE;
                    currentPlayer.knockbackY = -normalizedDy * KNOCKBACK_FORCE;

                    // Check if enemy dies
                    if (enemy.health <= 0) {
                        const index = enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            // Award XP before removing the enemy
                            const xpGained = getXPFromEnemy(enemy);
                            addXPToPlayer(currentPlayer, xpGained);
                            
                            // Check for item drop and add directly to inventory
                            const dropChance = DROP_CHANCES[enemy.tier];
                            if (Math.random() < dropChance && currentPlayer.inventory.length < MAX_INVENTORY_SIZE) {
                                // Create item and add directly to player's inventory
                                const newItem = {
                                    id: Math.random().toString(36).substr(2, 9),
                                    type: ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)],
                                    x: enemy.x,
                                    y: enemy.y
                                };
                                currentPlayer.inventory.push(newItem);
                                
                                // Notify about item pickup
                                socket.emit('inventoryUpdate', currentPlayer.inventory);
                                socket.emit('itemCollected', { 
                                    playerId: currentPlayer.id, 
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
                    if (currentPlayer.health <= 0) {
                        respawnPlayer(currentPlayer);
                        socket.emit('playerDied', currentPlayer.id);
                        socket.emit('playerRespawned', currentPlayer);
                        return;
                    }
                }
                break;
            }
        }

        // Check collision with obstacles
        for (const obstacle of obstacles) {
            if (
                newX + PLAYER_SIZE > obstacle.x && 
                newX < obstacle.x + obstacle.width &&
                newY + PLAYER_SIZE > obstacle.y &&
                newY < obstacle.y + obstacle.height
            ) {
                collision = true;
                if (obstacle.isEnemy) {
                    currentPlayer.health -= ENEMY_CORAL_DAMAGE;
                    socket.emit('playerDamaged', { playerId: currentPlayer.id, health: currentPlayer.health });

                    if (currentPlayer.health <= 0) {
                        respawnPlayer(currentPlayer);
                        socket.emit('playerDied', currentPlayer.id);
                        socket.emit('playerRespawned', currentPlayer);
                        return; // Exit early if player dies
                    }
                }
                break;
            }
        }

        // Update player position even if there was a collision (to apply knockback)
        currentPlayer.x = Math.max(0, Math.min(WORLD_WIDTH - PLAYER_SIZE, newX));
        currentPlayer.y = Math.max(0, Math.min(WORLD_HEIGHT - PLAYER_SIZE, newY));
        currentPlayer.angle = data.angle;
        currentPlayer.velocityX = data.velocityX;
        currentPlayer.velocityY = data.velocityY;

        // Always emit the updated position
        socket.emit('playerMoved', currentPlayer);
        if (currentPlayer.health < currentPlayer.maxHealth) {
            currentPlayer.health += 0.1;
        }
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
case 'updateLoadout':
    var player = players[socket.id];
    if (player) {
        player.loadout = data.loadout;
        player.inventory = data.inventory;
        socket.emit('playerUpdated', player);
    }
    break;
// ... (handle other socket events)
}
break;
}
};

// Start enemy movement interval
setInterval(() => {
try {
moveEnemies();
} catch (error) {
console.error('Error in moveEnemies interval:', error);
}
}, 100);