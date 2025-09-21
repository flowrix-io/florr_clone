"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("./constants");
const server_utils_1 = require("./server_utils");
const signaling_1 = require("./signaling");
class GameServer {
    constructor() {
        this.connections = new Map();
        this.isRunning = false;
        this.decorations = [];
        this.sands = [];
        this.ENEMY_COUNT = 200;
        this.signalingServer = null;
        this.initializeGameState();
    }
    calculateXPRequirement(level) {
        return Math.floor(constants_1.BASE_XP_REQUIREMENT * Math.pow(constants_1.XP_MULTIPLIER, level - 1));
    }
    initializeGameState() {
        // Initialize game elements
        for (let i = 0; i < this.ENEMY_COUNT; i++) {
            constants_1.enemies.push(this.createEnemy());
        }
        for (let i = 0; i < constants_1.OBSTACLE_COUNT; i++) {
            constants_1.obstacles.push(this.createObstacle());
        }
        for (let i = 0; i < constants_1.DECORATION_COUNT; i++) {
            this.decorations.push((0, server_utils_1.createDecoration)());
        }
        for (let i = 0; i < constants_1.SAND_COUNT; i++) {
            this.sands.push((0, server_utils_1.createSand)());
        }
    }
    start() {
        if (this.isRunning)
            return;
        try {
            this.signalingServer = new signaling_1.SignalingServer();
            this.signalingServer.onMessage((message) => {
                this.handleMessage(message);
            });
            this.isRunning = true;
            this.startGameLoops();
            this.postMessage('status', { online: true });
            this.postMessage('log', 'Server started successfully');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.postMessage('log', `Failed to start server: ${errorMessage}`);
        }
    }
    handleMessage(message) {
        try {
            switch (message.type) {
                case 'authenticate':
                    this.handleAuthentication(message.data);
                    break;
                case 'playerMovement':
                    this.handlePlayerMovement(message.data);
                    break;
                // Add other message handlers as needed
            }
        }
        catch (error) {
            console.error('Error handling message:', error);
        }
    }
    handleAuthentication(data) {
        const connection = {
            id: Math.random().toString(36).substr(2, 9),
            peerId: data.userId,
            userId: data.userId,
            username: data.username
        };
        // Verify that we have an active peer connection
        if (!this.signalingServer?.isConnected(connection.peerId)) {
            this.postMessage('log', `Failed to authenticate user ${connection.username}: No peer connection`);
            return;
        }
        this.connections.set(connection.id, connection);
        // Initialize player
        constants_1.players[connection.id] = {
            id: connection.id,
            name: data.playerName || 'Anonymous',
            x: 200,
            y: constants_1.WORLD_HEIGHT / 2,
            angle: 0,
            score: 0,
            velocityX: 0,
            velocityY: 0,
            health: constants_1.PLAYER_MAX_HEALTH,
            maxHealth: constants_1.PLAYER_MAX_HEALTH,
            damage: constants_1.PLAYER_DAMAGE,
            inventory: [],
            loadout: Array(10).fill(null),
            isInvulnerable: true,
            level: 1,
            xp: 0,
            xpToNextLevel: this.calculateXPRequirement(1)
        };
        // Send individual message to the newly connected player
        this.signalingServer?.sendToPeer(connection.peerId, {
            type: 'authenticated',
            data: {
                playerId: connection.id,
                gameState: {
                    players: constants_1.players,
                    enemies: constants_1.enemies,
                    items: constants_1.items,
                    obstacles: constants_1.obstacles,
                    decorations: this.decorations,
                    sands: this.sands
                }
            }
        });
        // Broadcast new player to others
        this.broadcast({
            type: 'playerJoined',
            data: constants_1.players[connection.id]
        });
    }
    broadcast(message) {
        if (!this.signalingServer)
            return;
        this.signalingServer.broadcast(message);
    }
    stop() {
        if (!this.isRunning)
            return;
        this.connections.clear();
        this.isRunning = false;
        this.signalingServer = null;
        this.postMessage('status', { online: false });
        this.postMessage('log', 'Server stopped');
    }
    startGameLoops() {
        // Game update loop
        setInterval(() => {
            this.moveEnemies();
            this.updateStats();
            this.broadcast({
                type: 'gameState',
                data: {
                    players: constants_1.players,
                    enemies: constants_1.enemies,
                    items: constants_1.items
                }
            });
        }, 100);
        // Health regeneration loop
        setInterval(() => {
            Object.values(constants_1.players).forEach(player => {
                if (player.health < player.maxHealth) {
                    player.health = Math.min(player.maxHealth, player.health + 5);
                }
            });
        }, 1000);
    }
    createEnemy() {
        // Enemy creation logic (unchanged)
        const x = Math.random() * constants_1.WORLD_WIDTH;
        let tier = 'common';
        for (const [t, zone] of Object.entries(constants_1.ZONE_BOUNDARIES)) {
            if (x >= zone.start && x < zone.end) {
                tier = t;
                break;
            }
        }
        const tierData = constants_1.ENEMY_TIERS[tier];
        return {
            id: Math.random().toString(36).substr(2, 9),
            type: Math.random() < 0.5 ? 'octopus' : 'fish',
            tier,
            x: x,
            y: Math.random() * constants_1.WORLD_HEIGHT,
            angle: Math.random() * Math.PI * 2,
            health: tierData.health,
            speed: tierData.speed,
            damage: tierData.damage,
            knockbackX: 0,
            knockbackY: 0
        };
    }
    createObstacle() {
        // Obstacle creation logic (unchanged)
        const isEnemy = Math.random() < constants_1.ENEMY_CORAL_PROBABILITY;
        return {
            id: Math.random().toString(36).substr(2, 9),
            x: Math.random() * constants_1.WORLD_WIDTH,
            y: Math.random() * constants_1.WORLD_HEIGHT,
            width: 50 + Math.random() * 50,
            height: 50 + Math.random() * 50,
            type: 'coral',
            isEnemy: isEnemy,
            health: isEnemy ? constants_1.ENEMY_CORAL_HEALTH : undefined
        };
    }
    moveEnemies() {
        // Enemy movement logic (implement your existing logic here)
    }
    updateStats() {
        this.postMessage('stats', {
            players: Object.keys(constants_1.players).length,
            enemies: constants_1.enemies.length
        });
    }
    postMessage(type, data) {
        self.postMessage({ type, data });
    }
    handlePlayerMovement(data) {
        const player = constants_1.players[data.id];
        if (!player)
            return;
        // Update player position and movement data
        player.x = Math.max(0, Math.min(constants_1.WORLD_WIDTH - constants_1.PLAYER_SIZE, data.x));
        player.y = Math.max(0, Math.min(constants_1.WORLD_HEIGHT - constants_1.PLAYER_SIZE, data.y));
        player.angle = data.angle;
        player.velocityX = data.velocityX;
        player.velocityY = data.velocityY;
        // Check for collisions with enemies
        for (const enemy of constants_1.enemies) {
            const enemySize = constants_1.ENEMY_SIZE * constants_1.ENEMY_SIZE_MULTIPLIERS[enemy.tier];
            if (player.x < enemy.x + enemySize &&
                player.x + constants_1.PLAYER_SIZE > enemy.x &&
                player.y < enemy.y + enemySize &&
                player.y + constants_1.PLAYER_SIZE > enemy.y) {
                if (!player.isInvulnerable) {
                    // Handle collision
                    player.health -= enemy.damage;
                    // Calculate knockback
                    const dx = enemy.x - player.x;
                    const dy = enemy.y - player.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const normalizedDx = dx / distance;
                    const normalizedDy = dy / distance;
                    player.x -= normalizedDx * constants_1.KNOCKBACK_FORCE;
                    player.y -= normalizedDy * constants_1.KNOCKBACK_FORCE;
                    // Check if player dies
                    if (player.health <= 0) {
                        this.broadcast({
                            type: 'playerDied',
                            data: { playerId: player.id }
                        });
                        // Reset player
                        player.health = player.maxHealth;
                        player.x = 200;
                        player.y = constants_1.WORLD_HEIGHT / 2;
                        player.isInvulnerable = true;
                        setTimeout(() => {
                            if (constants_1.players[player.id]) {
                                constants_1.players[player.id].isInvulnerable = false;
                            }
                        }, constants_1.RESPAWN_INVULNERABILITY_TIME);
                    }
                }
            }
        }
        // Broadcast updated player state
        this.broadcast({
            type: 'playerMoved',
            data: player
        });
    }
}
// Create server instance
const gameServer = new GameServer();
// Handle worker messages
self.onmessage = function (e) {
    const { type, data } = e.data;
    switch (type) {
        case 'start':
            gameServer.start();
            break;
        case 'stop':
            gameServer.stop();
            break;
        default:
            console.warn('Unknown message type:', type);
    }
};
