import { 
    PLAYER_DAMAGE, WORLD_WIDTH, WORLD_HEIGHT, ZONE_BOUNDARIES, 
    ENEMY_TIERS, KNOCKBACK_RECOVERY_SPEED, FISH_DETECTION_RADIUS,
    ENEMY_SIZE, ENEMY_SIZE_MULTIPLIERS, PLAYER_SIZE, KNOCKBACK_FORCE,
    DROP_CHANCES, PLAYER_MAX_HEALTH, HEALTH_PER_LEVEL, DAMAGE_PER_LEVEL,
    BASE_XP_REQUIREMENT, XP_MULTIPLIER, RESPAWN_INVULNERABILITY_TIME,
    enemies, players, items, dots, obstacles, OBSTACLE_COUNT,
    ENEMY_CORAL_PROBABILITY, ENEMY_CORAL_HEALTH, SAND_COUNT, DECORATION_COUNT
} from './constants';
import { Enemy, Obstacle, createDecoration, getRandomPositionInZone, Decoration, Sand, createSand } from './server_utils';
import { Item } from './item';
import { ServerPlayer } from './player';
import { SignalingServer } from './signaling';

// Custom WebSocket connection interface
interface GameConnection {
    id: string;
    peerId: string;
    userId?: string;
    username?: string;
}

class GameServer {
    private connections: Map<string, GameConnection> = new Map();
    private isRunning: boolean = false;
    private decorations: Decoration[] = [];
    private sands: Sand[] = [];
    private ENEMY_COUNT = 200;
    private signalingServer: SignalingServer | null = null;

    constructor() {
        this.initializeGameState();
    }

    private calculateXPRequirement(level: number): number {
        return Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, level - 1));
    }

    private initializeGameState() {
        // Initialize game elements
        for (let i = 0; i < this.ENEMY_COUNT; i++) {
            enemies.push(this.createEnemy());
        }

        for (let i = 0; i < OBSTACLE_COUNT; i++) {
            obstacles.push(this.createObstacle());
        }

        for (let i = 0; i < DECORATION_COUNT; i++) {
            this.decorations.push(createDecoration());
        }

        for (let i = 0; i < SAND_COUNT; i++) {
            this.sands.push(createSand());
        }
    }

    start() {
        if (this.isRunning) return;
        
        try {
            this.signalingServer = new SignalingServer();
            
            this.signalingServer.onMessage((message) => {
                this.handleMessage(message);
            });

            this.isRunning = true;
            this.startGameLoops();
            this.postMessage('status', { online: true });
            this.postMessage('log', 'Server started successfully');

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.postMessage('log', `Failed to start server: ${errorMessage}`);
        }
    }

    private handleMessage(message: any) {
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
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    private handleAuthentication(data: any) {
        const connection: GameConnection = {
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
        players[connection.id] = {
            id: connection.id,
            name: data.playerName || 'Anonymous',
            x: 200,
            y: WORLD_HEIGHT / 2,
            angle: 0,
            score: 0,
            velocityX: 0,
            velocityY: 0,
            health: PLAYER_MAX_HEALTH,
            maxHealth: PLAYER_MAX_HEALTH,
            damage: PLAYER_DAMAGE,
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
                    players,
                    enemies,
                    items,
                    obstacles,
                    decorations: this.decorations,
                    sands: this.sands
                }
            }
        });

        // Broadcast new player to others
        this.broadcast({
            type: 'playerJoined',
            data: players[connection.id]
        });
    }

    private broadcast(message: any) {
        if (!this.signalingServer) return;
        this.signalingServer.broadcast(message);
    }

    stop() {
        if (!this.isRunning) return;
        
        this.connections.clear();
        this.isRunning = false;
        this.signalingServer = null;
        this.postMessage('status', { online: false });
        this.postMessage('log', 'Server stopped');
    }

    private startGameLoops() {
        // Game update loop
        setInterval(() => {
            this.moveEnemies();
            this.updateStats();
            this.broadcast({
                type: 'gameState',
                data: {
                    players,
                    enemies,
                    items
                }
            });
        }, 100);

        // Health regeneration loop
        setInterval(() => {
            Object.values(players).forEach(player => {
                if (player.health < player.maxHealth) {
                    player.health = Math.min(player.maxHealth, player.health + 5);
                }
            });
        }, 1000);
    }

    private createEnemy(): Enemy {
        // Enemy creation logic (unchanged)
        const x = Math.random() * WORLD_WIDTH;
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
            x: x,
            y: Math.random() * WORLD_HEIGHT,
            angle: Math.random() * Math.PI * 2,
            health: tierData.health,
            speed: tierData.speed,
            damage: tierData.damage,
            knockbackX: 0,
            knockbackY: 0
        };
    }

    private createObstacle(): Obstacle {
        // Obstacle creation logic (unchanged)
        const isEnemy = Math.random() < ENEMY_CORAL_PROBABILITY;
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

    private moveEnemies() {
        // Enemy movement logic (implement your existing logic here)
    }

    private updateStats() {
        this.postMessage('stats', {
            players: Object.keys(players).length,
            enemies: enemies.length
        });
    }

    private postMessage(type: string, data: any) {
        self.postMessage({ type, data });
    }

    private handlePlayerMovement(data: {
        id: string;
        x: number;
        y: number;
        angle: number;
        velocityX: number;
        velocityY: number;
    }) {
        const player = players[data.id];
        if (!player) return;

        // Update player position and movement data
        player.x = Math.max(0, Math.min(WORLD_WIDTH - PLAYER_SIZE, data.x));
        player.y = Math.max(0, Math.min(WORLD_HEIGHT - PLAYER_SIZE, data.y));
        player.angle = data.angle;
        player.velocityX = data.velocityX;
        player.velocityY = data.velocityY;

        // Check for collisions with enemies
        for (const enemy of enemies) {
            const enemySize = ENEMY_SIZE * ENEMY_SIZE_MULTIPLIERS[enemy.tier];
            
            if (
                player.x < enemy.x + enemySize &&
                player.x + PLAYER_SIZE > enemy.x &&
                player.y < enemy.y + enemySize &&
                player.y + PLAYER_SIZE > enemy.y
            ) {
                if (!player.isInvulnerable) {
                    // Handle collision
                    player.health -= enemy.damage;
                    
                    // Calculate knockback
                    const dx = enemy.x - player.x;
                    const dy = enemy.y - player.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const normalizedDx = dx / distance;
                    const normalizedDy = dy / distance;

                    player.x -= normalizedDx * KNOCKBACK_FORCE;
                    player.y -= normalizedDy * KNOCKBACK_FORCE;

                    // Check if player dies
                    if (player.health <= 0) {
                        this.broadcast({
                            type: 'playerDied',
                            data: { playerId: player.id }
                        });
                        
                        // Reset player
                        player.health = player.maxHealth;
                        player.x = 200;
                        player.y = WORLD_HEIGHT / 2;
                        player.isInvulnerable = true;
                        
                        setTimeout(() => {
                            if (players[player.id]) {
                                players[player.id].isInvulnerable = false;
                            }
                        }, RESPAWN_INVULNERABILITY_TIME);
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
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    switch(type) {
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