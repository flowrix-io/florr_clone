import { Server } from 'socket.io';

interface Player {
    id: string;
    x: number;
    y: number;
    angle: number;
    score: number;
    velocityX: number;
    velocityY: number;
    health: number;
    maxHealth: number;
    damage: number;
    inventory: Item[];
    isInvulnerable?: boolean;
    knockbackX?: number;
    knockbackY?: number;
    level: number;
    xp: number;
    xpToNextLevel: number;
    lastDamageTime?: number;
}

interface Enemy {
    id: string;
    type: 'octopus' | 'fish';
    tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
    x: number;
    y: number;
    angle: number;
    health: number;
    speed: number;
    damage: number;
    knockbackX?: number;
    knockbackY?: number;
}

interface Item {
    id: string;
    type: 'health_potion' | 'speed_boost' | 'shield';
    x: number;
    y: number;
}

interface Obstacle {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    type: 'coral';
    isEnemy: boolean;
    health?: number;
}

interface Dot {
    x: number;
    y: number;
}

// Add constants at the top
const WORLD_WIDTH = 10000;  // Increased from 2000 to 10000
const WORLD_HEIGHT = 2000;  // Keep height the same

// Update enemy count for the larger map
const ENEMY_COUNT = 50;  // Increased from 10 to 50

// Add zone boundaries for different tier enemies
const ZONE_BOUNDARIES = {
    common: { start: 0, end: 2000 },
    uncommon: { start: 2000, end: 4000 },
    rare: { start: 4000, end: 6000 },
    epic: { start: 6000, end: 8000 },
    legendary: { start: 8000, end: 9000 },
    mythic: { start: 9000, end: WORLD_WIDTH }
};

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
const KNOCKBACK_FORCE = 100; // Increased from 20 to 100
const KNOCKBACK_RECOVERY_SPEED = 0.9;

const ENEMY_TIERS = {
    common: { health: 20, speed: 0.5, damage: 5, probability: 0.4 },
    uncommon: { health: 40, speed: 0.75, damage: 10, probability: 0.3 },
    rare: { health: 60, speed: 1, damage: 15, probability: 0.15 },
    epic: { health: 80, speed: 1.25, damage: 20, probability: 0.1 },
    legendary: { health: 100, speed: 1.5, damage: 25, probability: 0.04 },
    mythic: { health: 150, speed: 2, damage: 30, probability: 0.01 }
};

const players: Record<string, Player> = {};
const enemies: Enemy[] = [];
const obstacles: Obstacle[] = [];
const items: Item[] = [];
const dots: Dot[] = [];

// Add XP-related constants to the worker
const BASE_XP_REQUIREMENT = 100;
const XP_MULTIPLIER = 1.5;
const MAX_LEVEL = 50;
const HEALTH_PER_LEVEL = 10;
const DAMAGE_PER_LEVEL = 2;

// Add enemy size multipliers constant
const ENEMY_SIZE_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.2,
    rare: 1.4,
    epic: 1.6,
    legendary: 1.8,
    mythic: 2.0
};

// Add Decoration interface
interface Decoration {
    x: number;
    y: number;
    scale: number;  // For random sizes
}

// Add decorations array and constants
const DECORATION_COUNT = 100;  // Number of palms to spawn
const decorations: Decoration[] = [];

// Add createDecoration function
function createDecoration(): Decoration {
    return {
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        scale: 0.5 + Math.random() * 1.5  // Random size between 0.5x and 2x
    };
}

// Add Sand interface
interface Sand {
    x: number;
    y: number;
    radius: number;  // Random size for each sand blob
    rotation: number;  // For slight variation in shape
}

// Add sand array and constants
const SAND_COUNT = 50;  // Reduced from 200 to 50
const MIN_SAND_RADIUS = 50;  // Increased from 30 to 50
const MAX_SAND_RADIUS = 120; // Increased from 80 to 120
const sands: Sand[] = [];

// Add createSand function to make patches more spread out
function createSand(): Sand {
    // Create sand patches with more spacing
    const sectionWidth = WORLD_WIDTH / (SAND_COUNT / 2);  // Divide world into sections
    const sectionIndex = sands.length;
    
    return {
        x: (sectionIndex * sectionWidth) + Math.random() * sectionWidth,  // Spread out along x-axis
        y: Math.random() * WORLD_HEIGHT,
        radius: MIN_SAND_RADIUS + Math.random() * (MAX_SAND_RADIUS - MIN_SAND_RADIUS),
        rotation: Math.random() * Math.PI * 2
    };
}

function calculateXPRequirement(level: number): number {
    return Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, level - 1));
}

function getXPFromEnemy(enemy: Enemy): number {
    const tierMultipliers: Record<Enemy['tier'], number> = {
        common: 10,
        uncommon: 20,
        rare: 40,
        epic: 80,
        legendary: 160,
        mythic: 320
    };
    return tierMultipliers[enemy.tier];
}

function addXPToPlayer(player: Player, xp: number): void {
    if (player.level >= MAX_LEVEL) return;

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

function handleLevelUp(player: Player): void {
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
function createEnemy(): Enemy {
    // First, decide the x position
    const x = Math.random() * WORLD_WIDTH;
    
    // Determine tier based on x position
    let tier: Enemy['tier'] = 'common';
    for (const [t, zone] of Object.entries(ZONE_BOUNDARIES)) {
        if (x >= zone.start && x < zone.end) {
            tier = t as Enemy['tier'];
            break;
        }
    }

    const tierData = ENEMY_TIERS[tier];

    return {
        id: Math.random().toString(36).substr(2, 9),
        type: Math.random() < 0.5 ? 'octopus' : 'fish',
        tier,
        x: x,  // Use the determined x position
        y: Math.random() * WORLD_HEIGHT,
        angle: Math.random() * Math.PI * 2,
        health: tierData.health,
        speed: tierData.speed,
        damage: tierData.damage,
        knockbackX: 0,
        knockbackY: 0
    };
}

function createObstacle(): Obstacle {
    const isEnemy = Math.random() < ENEMY_CORAL_PROBABILITY;
    return {
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        width: 50 + Math.random() * 50,
        height: 50 + Math.random() * 50,
        type: 'coral',
        isEnemy,
        health: isEnemy ? ENEMY_CORAL_HEALTH : undefined
    };
}

function createItem(): Item {
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)] as Item['type'],
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT
    };
}

// Update moveEnemies to keep enemies in their zones
function moveEnemies() {
    enemies.forEach(enemy => {
        // Store original x position
        const originalX = enemy.x;

        // Apply existing movement logic
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

        if (enemy.type === 'octopus') {
            enemy.x += (Math.random() * 4 - 2) * enemy.speed;
            enemy.y += (Math.random() * 4 - 2) * enemy.speed;
        } else {
            enemy.x += Math.cos(enemy.angle) * 2 * enemy.speed;
            enemy.y += Math.sin(enemy.angle) * 2 * enemy.speed;
        }

        // Keep enemy within its zone boundaries
        const zone = ZONE_BOUNDARIES[enemy.tier];
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
class MockSocket {
    private eventHandlers: Map<string, Function[]> = new Map();
    public readonly id: string = 'player1';  // Changed to public readonly

    on(event: string, handler: Function) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event)?.push(handler);
    }

    emit(event: string, data: any) {
        // Forward to main thread
        self.postMessage({
            type: 'socketEvent',
            event,
            data
        });
    }

    broadcast = {
        emit: (event: string, data: any) => {
            // In single player, broadcast events are ignored
        }
    };

    // Add getter for id if needed
    getId(): string {
        return this.id;
    }
}

// Mock io for single player
const mockIo = {
    emit: (event: string, data: any) => {
        self.postMessage({
            type: 'socketEvent',
            event,
            data
        });
    }
};

const socket = new MockSocket();

// Update the getImageAsDataURL function
async function getImageAsDataURL(imagePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                try {
                    const dataUrl = canvas.toDataURL();
                    resolve(dataUrl);
                } catch (error) {
                    console.error('Error converting to data URL:', error);
                    resolve(imagePath); // Fallback to original path
                }
            } else {
                reject(new Error('Could not get canvas context'));
            }
        };
        
        img.onerror = () => {
            console.error('Failed to load image:', imagePath);
            resolve(imagePath); // Fallback to original path
        };

        // Try to load image with timestamp to bypass cache
        const timestamp = new Date().getTime();
        img.src = `${imagePath}?t=${timestamp}`;
    });
}

// Update initializeGame to handle image loading errors gracefully
async function initializeGame(messageData?: { savedProgress?: any }) {
    try {
        // Load all images first
        const imageUrls = await Promise.all([
            getImageAsDataURL('./assets/player.png'),
            getImageAsDataURL('./assets/background.png'),
            // Add other image URLs here
        ]);

        // Continue with game initialization using the loaded image URLs
        const [playerSpriteURL, backgroundURL] = imageUrls;

        const playerSprite = new Image();
        playerSprite.src = playerSpriteURL;

        const backgroundImage = new Image();
        backgroundImage.src = backgroundURL;

        console.log('Initializing game state in worker', messageData);
        
        const savedProgress = messageData?.savedProgress || {
            level: 1,
            xp: 0,
            maxHealth: PLAYER_MAX_HEALTH,
            damage: PLAYER_DAMAGE
        };

        console.log('Using saved progress:', savedProgress);
        
        // Initialize player at the left side of the map
        players[socket.id] = {
            id: socket.id,
            x: 200,  // Start near the left edge
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
        setTimeout(() => {
            if (players[socket.id]) {
                players[socket.id].isInvulnerable = false;
                // Notify client that invulnerability has ended
                socket.emit('playerInvulnerabilityEnded', { playerId: socket.id });
            }
        }, RESPAWN_INVULNERABILITY_TIME);

        // Create enemies
        for (let i = 0; i < ENEMY_COUNT; i++) {
            enemies.push(createEnemy());
        }

        // Create obstacles
        for (let i = 0; i < 20; i++) {
            obstacles.push(createObstacle());
        }

        // Create items
        for (let i = 0; i < ITEM_COUNT; i++) {
            items.push(createItem());
        }

        // Create dots
        for (let i = 0; i < 20; i++) {
            dots.push({
                x: Math.random() * WORLD_WIDTH,
                y: Math.random() * WORLD_HEIGHT
            });
        }

        // Create decorations
        for (let i = 0; i < DECORATION_COUNT; i++) {
            decorations.push(createDecoration());
        }

        // Create sand blobs
        for (let i = 0; i < SAND_COUNT; i++) {
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
    } catch (error) {
        console.error('Failed to initialize game:', error);
        // Continue with initialization even if image loading fails
        initializeGameState(messageData);
    }
}

// Separate game state initialization
function initializeGameState(messageData?: { savedProgress?: any }) {
    // Move the non-image related initialization here
    // ... rest of the initialization code ...
}

// Handle messages from main thread
self.onmessage = (event) => {
    const { type, event: socketEvent, data, savedProgress } = event.data;
    console.log('Worker received message:', type, { data, savedProgress });  // Debug log
    
    switch (type) {
        case 'init':
            // Pass savedProgress directly from the event.data
            initializeGame({ savedProgress: event.data.savedProgress });
            break;

        case 'socketEvent':
            switch (socketEvent) {
                case 'playerMovement':
                    const player = players[socket.id];
                    if (player) {
                        // Debug: Log received movement data
                        console.log(`[WORKER] Player ${socket.id} movement received: client(${data.x.toFixed(1)}, ${data.y.toFixed(1)}) server_current(${player.x.toFixed(1)}, ${player.y.toFixed(1)}) angle:${data.angle.toFixed(2)} velocity(${data.velocityX.toFixed(1)}, ${data.velocityY.toFixed(1)})`);
                        
                        let newX = data.x;
                        let newY = data.y;

                        // Apply knockback to player position if it exists
                        if (player.knockbackX) {
                            const oldKnockbackX = player.knockbackX;
                            player.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
                            newX += player.knockbackX;
                            if (Math.abs(player.knockbackX) < 0.1) player.knockbackX = 0;
                            console.log(`[WORKER] Player ${socket.id} knockback X: ${oldKnockbackX.toFixed(2)} -> ${player.knockbackX.toFixed(2)}, newX: ${newX.toFixed(1)}`);
                        }
                        if (player.knockbackY) {
                            const oldKnockbackY = player.knockbackY;
                            player.knockbackY *= KNOCKBACK_RECOVERY_SPEED;
                            newY += player.knockbackY;
                            if (Math.abs(player.knockbackY) < 0.1) player.knockbackY = 0;
                            console.log(`[WORKER] Player ${socket.id} knockback Y: ${oldKnockbackY.toFixed(2)} -> ${player.knockbackY.toFixed(2)}, newY: ${newY.toFixed(1)}`);
                        }

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
                                console.log(`[WORKER_TS] Enemy collision: player(${newX.toFixed(1)}, ${newY.toFixed(1)}, ${PLAYER_SIZE}x${PLAYER_SIZE}) vs enemy(${enemy.x.toFixed(1)}, ${enemy.y.toFixed(1)}, ${enemySize}x${enemySize}) tier:${enemy.tier}`);
                                if (!player.isInvulnerable) {
                                    // Enemy damages player
                                    player.health -= enemy.damage;
                                    player.lastDamageTime = Date.now();
                                    player.isInvulnerable = true;
                                    
                                    // Set invulnerability timer
                                    setTimeout(() => {
                                        if (player) {
                                            player.isInvulnerable = false;
                                            // Notify client that invulnerability has ended
                                            socket.emit('playerInvulnerabilityEnded', { playerId: player.id });
                                        }
                                    }, 1000); // 1 second of invulnerability after taking damage
                                    
                                    // Calculate knockback direction first
                                    const dx = enemy.x - newX;
                                    const dy = enemy.y - newY;
                                    const distance = Math.sqrt(dx * dx + dy * dy);
                                    const normalizedDx = dx / distance;
                                    const normalizedDy = dy / distance;
                                    
                                    socket.emit('playerDamaged', { 
                                        playerId: player.id, 
                                        health: player.health,
                                        maxHealth: player.maxHealth,
                                        isInvulnerable: player.isInvulnerable,
                                        knockbackX: -normalizedDx * KNOCKBACK_FORCE,
                                        knockbackY: -normalizedDy * KNOCKBACK_FORCE
                                    });

                                    // Player damages enemy
                                    enemy.health -= player.damage;  // Use player.damage instead of PLAYER_DAMAGE
                                    socket.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });

                                    // Apply knockback to player's position immediately
                                    newX -= normalizedDx * KNOCKBACK_FORCE;
                                    newY -= normalizedDy * KNOCKBACK_FORCE;
                                    
                                    // Store knockback for gradual recovery
                                    player.knockbackX = -normalizedDx * KNOCKBACK_FORCE;
                                    player.knockbackY = -normalizedDy * KNOCKBACK_FORCE;

                                    // Check if enemy dies
                                    if (enemy.health <= 0) {
                                        const index = enemies.findIndex(e => e.id === enemy.id);
                                        if (index !== -1) {
                                            // Award XP before removing the enemy
                                            const xpGained = getXPFromEnemy(enemy);
                                            addXPToPlayer(player, xpGained);
                                            
                                            // Check for item drop and add directly to inventory
                                            const dropChance = DROP_CHANCES[enemy.tier];
                                            if (Math.random() < dropChance && player.inventory.length < MAX_INVENTORY_SIZE) {
                                                // Create item and add directly to player's inventory
                                                const newItem = {
                                                    id: Math.random().toString(36).substr(2, 9),
                                                    type: ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)] as Item['type'],
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
                                        return;
                                    }
                                }
                                break;
                            }
                        }

                        // Check collision with obstacles
                        for (const obstacle of obstacles) {
                            if (
                                newX < obstacle.x + obstacle.width &&
                                newX + PLAYER_SIZE > obstacle.x &&
                                newY < obstacle.y + obstacle.height &&
                                newY + PLAYER_SIZE > obstacle.y
                            ) {
                                collision = true;
                                console.log(`[WORKER] Obstacle collision detected: player(${newX.toFixed(1)}, ${newY.toFixed(1)}, ${PLAYER_SIZE}x${PLAYER_SIZE}) vs obstacle(${obstacle.x.toFixed(1)}, ${obstacle.y.toFixed(1)}, ${obstacle.width}x${obstacle.height}) isEnemy:${obstacle.isEnemy}`);
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
                        const clampedX = Math.max(0, Math.min(WORLD_WIDTH - PLAYER_SIZE, newX));
                        const clampedY = Math.max(0, Math.min(WORLD_HEIGHT - PLAYER_SIZE, newY));
                        
                        // Debug: Log if position was clamped by world bounds
                        if (newX !== clampedX || newY !== clampedY) {
                            console.log(`[WORKER] World bounds collision: requested(${newX.toFixed(1)}, ${newY.toFixed(1)}) -> clamped(${clampedX.toFixed(1)}, ${clampedY.toFixed(1)})`);
                        }
                        
                        // Debug: Log final position update
                        console.log(`[WORKER] Player ${socket.id} final position update: (${player.x.toFixed(1)}, ${player.y.toFixed(1)}) -> (${clampedX.toFixed(1)}, ${clampedY.toFixed(1)})`);
                        
                        player.x = clampedX;
                        player.y = clampedY;
                        player.angle = data.angle;
                        player.velocityX = data.velocityX;
                        player.velocityY = data.velocityY;

                        // Always emit the player's position
                        socket.emit('playerMoved', player);
                    }
                    break;

                case 'collectItem':
                    const itemIndex = items.findIndex(item => item.id === data.itemId);
                    if (itemIndex !== -1 && players[socket.id].inventory.length < MAX_INVENTORY_SIZE) {
                        const item = items[itemIndex];
                        players[socket.id].inventory.push(item);
                        items.splice(itemIndex, 1);
                        items.push(createItem());
                        socket.emit('itemCollected', { playerId: socket.id, itemId: data.itemId });
                    }
                    break;

                case 'useItem':
                    const playerUsingItem = players[socket.id];
                    const inventoryIndex = playerUsingItem.inventory.findIndex(item => item.id === data.itemId);
                    if (inventoryIndex !== -1) {
                        const item = playerUsingItem.inventory[inventoryIndex];
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
                    const deadPlayer = players[socket.id];
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
setInterval(() => {
    moveEnemies();
    mockIo.emit('enemiesUpdate', enemies);
}, 100);

// Add error handling
self.onerror = (error) => {
    console.error('Worker error:', error);
};

// Update respawnPlayer to not lose levels
function respawnPlayer(player: Player) {
    // Determine spawn zone based on player level without losing levels
    let spawnX;
    if (player.level <= 5) {
        spawnX = Math.random() * ZONE_BOUNDARIES.common.end;
    } else if (player.level <= 10) {
        spawnX = ZONE_BOUNDARIES.uncommon.start + Math.random() * (ZONE_BOUNDARIES.uncommon.end - ZONE_BOUNDARIES.uncommon.start);
    } else if (player.level <= 15) {
        spawnX = ZONE_BOUNDARIES.rare.start + Math.random() * (ZONE_BOUNDARIES.rare.end - ZONE_BOUNDARIES.rare.start);
    } else if (player.level <= 25) {
        spawnX = ZONE_BOUNDARIES.epic.start + Math.random() * (ZONE_BOUNDARIES.epic.end - ZONE_BOUNDARIES.epic.start);
    } else if (player.level <= 40) {
        spawnX = ZONE_BOUNDARIES.legendary.start + Math.random() * (ZONE_BOUNDARIES.legendary.end - ZONE_BOUNDARIES.legendary.start);
    } else {
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

    setTimeout(() => {
        player.isInvulnerable = false;
        // Notify client that invulnerability has ended
        socket.emit('playerInvulnerabilityEnded', { playerId: player.id });
    }, RESPAWN_INVULNERABILITY_TIME);
}

// Add drop chance constants
const DROP_CHANCES = {
    common: 0.1,      // 10% chance
    uncommon: 0.2,    // 20% chance
    rare: 0.3,        // 30% chance
    epic: 0.4,        // 40% chance
    legendary: 0.5,   // 50% chance
    mythic: 0.75      // 75% chance
};