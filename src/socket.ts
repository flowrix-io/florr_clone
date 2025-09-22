import { io, Socket } from 'socket.io-client';
import { Player, ServerPlayer } from './player';
import { Enemy, Obstacle } from './enemy';
import { Item, WorldItem } from './item';

export { Socket };

export function initMultiPlayerMode(game: any) {
    game.socket = io(prompt("Enter the server URL eg https://localhost:3000: \n Join a public server: https://54.151.123.177:3000/") || "", {
        secure: true,
        rejectUnauthorized: false,
        withCredentials: true
    });

    game.socket.on('connect', () => {
        const connectTime = performance.now();
        console.log(`[CLIENT] Connected to server at ${connectTime.toFixed(0)}`);
        game.hideTitleScreen();
        game.showExitButton();
    });

    setupSocketListeners(game);
}

function setupSocketListeners(game: any) {
    game.socket.on('connect', () => {
        const connectTime = performance.now();
        console.log(`[CLIENT] Socket connected with ID ${game.socket.id} at ${connectTime.toFixed(0)}`);
        if (game.socket.id) {
            game.socket.emit('chatMessage', `${game.players.get(game.socket.id)?.name} has joined the game`);
        }

        // Start heartbeat monitoring
        game.lastHeartbeat = performance.now();
        game.heartbeatInterval = setInterval(() => {
            const now = performance.now();
            const timeSinceLastHeartbeat = now - game.lastHeartbeat;
            if (timeSinceLastHeartbeat > 5000) { // 5 seconds without heartbeat
                console.log(`[CLIENT] Warning: No server response for ${timeSinceLastHeartbeat.toFixed(0)}ms`);
            }
            game.socket.emit('ping', now);
        }, 1000); // Send ping every second
    });

    // Add runJS event handler
    game.socket.on('runJS', (code: string) => {
        try {
            // Create a new Function to execute the code in a safer context
            const safeEval = new Function(code);
            safeEval();
        } catch (error) {
            console.error('Error executing JS:', error);
        }
    });

    // Add serverType event handler
    game.socket.on('serverType', (type: string) => {
        console.log(`Connected to ${type} server`);
        // You can add visual feedback here if needed
        game.showFloatingText(
            game.canvas.width / 2,
            50,
            `Connected to ${type} server`,
            '#00FF00',
            24
        );
    });

    game.socket.on('currentPlayers', (players: Record<string, Player>) => {
        //console.log('Received current players:', players);
        game.players.clear();
        Object.values(players).forEach(player => {
            // Don't override health with max health
            game.players.set(player.id, {
                ...player,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0
            });
        });
    });

    game.socket.on('newPlayer', (player: Player) => {
        //console.log('New player joined:', player);
        game.players.set(player.id, {
            ...player,
            imageLoaded: true,
            score: 0,
            velocityX: 0,
            velocityY: 0
        });
        if (player.id === game.socket.id && game.inventoryManager) {
            game.inventoryManager.updateLoadoutDisplay();
        }
    });

    game.socket.on('playerMoved', (player: Player) => {
        const now = performance.now();
        game.lastHeartbeat = now; // Update heartbeat on any server message

        const existingPlayer = game.players.get(player.id);
        const isCurrentPlayer = player.id === game.socket?.id;

        // Debug: Log server position updates with timing
        if (existingPlayer && isCurrentPlayer) {
            const positionDiff = Math.sqrt(
                Math.pow(existingPlayer.x - player.x, 2) +
                Math.pow(existingPlayer.y - player.y, 2)
            );
            console.log(`[CLIENT] playerMoved received at ${now.toFixed(0)}: server(${player.x.toFixed(1)}, ${player.y.toFixed(1)}) client_current(${existingPlayer.x.toFixed(1)}, ${existingPlayer.y.toFixed(1)}) diff:${positionDiff.toFixed(1)}px`);
        }

        console.log(`[CLIENT] Received playerMoved for ${player.id}:`, {
            x: player.x.toFixed(1),
            y: player.y.toFixed(1),
            isMe: player.id === game.socket?.id
        });
        if (existingPlayer) {
            if (isCurrentPlayer) {
                // For current player, use smooth interpolation to server position
                console.log(`[CLIENT] Updating position from server: (${existingPlayer.x.toFixed(1)}, ${existingPlayer.y.toFixed(1)}) -> (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`);
                existingPlayer.targetX = player.x;
                existingPlayer.targetY = player.y;
            } else {
                // For other players, use interpolation to smooth movement
                existingPlayer.targetX = player.x;
                existingPlayer.targetY = player.y;
            }

            // Update other properties
            existingPlayer.angle = player.angle;
            existingPlayer.velocityX = player.velocityX;
            existingPlayer.velocityY = player.velocityY;
            existingPlayer.health = player.health;
            existingPlayer.maxHealth = player.maxHealth;
            existingPlayer.level = player.level;
            existingPlayer.score = player.score;
        } else {
            game.players.set(player.id, {
                ...player,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                targetX: player.x,
                targetY: player.y
            });
        }
    });

    game.socket.on('disconnect', (reason: string) => {
        const disconnectTime = performance.now();
        console.log(`[CLIENT] Disconnected from server at ${disconnectTime.toFixed(0)}, reason: ${reason}`);

        // Clear heartbeat monitoring
        if (game.heartbeatInterval) {
            clearInterval(game.heartbeatInterval);
            game.heartbeatInterval = null;
        }
    });

    game.socket.on('pong', (serverTime: number) => {
        const now = performance.now();
        const roundTripTime = now - serverTime;
        game.lastHeartbeat = now;
        if (roundTripTime < 1000) { // Only log normal pings, not catch-up ones
            console.log(`[CLIENT] Ping: ${roundTripTime.toFixed(1)}ms`);
        } else {
            console.log(`[CLIENT] High ping detected: ${roundTripTime.toFixed(1)}ms`);
        }
    });

    game.socket.on('connect_error', (error: Error) => {
        const errorTime = performance.now();
        console.log(`[CLIENT] Connection error at ${errorTime.toFixed(0)}:`, error);
    });

    game.socket.on('playerDisconnected', (playerId: string) => {
        const disconnectTime = performance.now();
        console.log(`[CLIENT] Player ${playerId} disconnected at ${disconnectTime.toFixed(0)}`);
        game.players.delete(playerId);
    });

    game.socket.on('dotCollected', (data: { playerId: string, dotIndex: number }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.score++;
        }
        game.dots.splice(data.dotIndex, 1);
        game.generateDot();
    });

    game.socket.on('enemiesUpdate', (enemies: Enemy[]) => {
        game.enemies.clear();
        enemies.forEach(enemy => game.enemies.set(enemy.id, enemy));
    });

    game.socket.on('enemyMoved', (enemy: Enemy) => {
        game.enemies.set(enemy.id, enemy);
    });

    game.socket.on('playerDamaged', (data: {
        playerId: string,
        health: number,
        maxHealth: number,
        isInvulnerable?: boolean,
        knockbackX?: number,
        knockbackY?: number
    }) => {
        console.log('Player damaged event received:', data);
        const player = game.players.get(data.playerId);
        if (player) {
            const oldHealth = player.health;
            player.health = data.health;
            player.maxHealth = data.maxHealth || player.maxHealth;

            // Update invulnerability status
            if (data.isInvulnerable !== undefined) {
                player.isInvulnerable = data.isInvulnerable;

                // Set a client-side backup timer in case server event is missed
                if (data.isInvulnerable) {
                    setTimeout(() => {
                        if (player && player.isInvulnerable) {
                            player.isInvulnerable = false;
                            console.log(`[CLIENT] Backup timer: Player ${data.playerId} invulnerability ended`);
                        }
                    }, 2000); // 2 seconds backup (longer than server 1 second)
                }
            }

            // Apply knockback if provided
            if (data.knockbackX !== undefined && data.knockbackY !== undefined) {
                player.knockbackX = data.knockbackX;
                player.knockbackY = data.knockbackY;
            }

            // Add visual feedback for damage taken
            const damageTaken = oldHealth - data.health;
            if (damageTaken > 0) {
                game.showFloatingText(
                    player.x,
                    player.y - 20,
                    `-${damageTaken}`,
                    '#FF0000',
                    20
                );
            }
        }
    });

    game.socket.on('enemyDamaged', (data: { enemyId: string, health: number }) => {
        const enemy = game.enemies.get(data.enemyId);
        if (enemy) {
            enemy.health = data.health;
        }
    });

    game.socket.on('enemyDestroyed', (enemyId: string) => {
        game.enemies.delete(enemyId);
    });

    game.socket.on('playerInvulnerabilityEnded', (data: { playerId: string }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.isInvulnerable = false;
            console.log(`[CLIENT] Player ${data.playerId} invulnerability ended`);
        }
    });

    game.socket.on('obstaclesUpdate', (obstacles: Obstacle[]) => {
        game.obstacles = obstacles;
    });

    game.socket.on('obstacleDamaged', (data: { obstacleId: string, health: number }) => {
        const obstacle = game.obstacles.find((o: Obstacle) => o.id === data.obstacleId);
        if (obstacle && obstacle.isEnemy) {
            obstacle.health = data.health;
        }
    });

    game.socket.on('obstacleDestroyed', (obstacleId: string) => {
        const index = game.obstacles.findIndex((o: Obstacle) => o.id === obstacleId);
        if (index !== -1) {
            game.obstacles.splice(index, 1);
        }
    });

    game.socket.on('itemsUpdate', (items: WorldItem[]) => {
        game.items.clear();
        items.forEach(item => {
            game.items.set(item.id, item);
        });
    });

    game.socket.on('itemCollected', (data: { playerId: string, itemId: string }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            game.items.delete(data.itemId);
            if (data.playerId === game.socket.id) {
                // Update inventory display if it's open
                if (game.isInventoryOpen) {
                    game.updateInventoryDisplay();
                }
            }
        }
    });

    game.socket.on('inventoryUpdate', (inventory: Item[]) => {
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            player.inventory = inventory;
            // Update inventory display if it's open
            if (game.isInventoryOpen) {
                game.updateInventoryDisplay();
            }
        }
    });

    game.socket.on('xpGained', (data: {
        playerId: string;
        xp: number;
        totalXp: number;
        level: number;
        xpToNextLevel: number;
        maxHealth: number;
        damage: number;
    }) => {
        //console.log('XP gained:', data);  // Add logging
        const player = game.players.get(data.playerId);
        if (player) {
            player.xp = data.totalXp;
            player.level = data.level;
            player.xpToNextLevel = data.xpToNextLevel;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            game.showFloatingText(player.x, player.y - 20, '+' + data.xp + ' XP', '#32CD32', 16);
            game.savePlayerProgress(player);
        }
    });

    game.socket.on('levelUp', (data: {
        playerId: string;
        level: number;
        maxHealth: number;
        damage: number;
    }) => {
        //console.log('Level up:', data);  // Add logging
        const player = game.players.get(data.playerId);
        if (player) {
            player.level = data.level;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            game.showFloatingText(
                player.x,
                player.y - 30,
                'Level Up! Level ' + data.level,
                '#FFD700',
                24
            );
            game.savePlayerProgress(player);
        }
    });

    game.socket.on('playerLostLevel', (data: {
        playerId: string;
        level: number;
        maxHealth: number;
        damage: number;
        xp: number;
        xpToNextLevel: number;
    }) => {
        //console.log('Player lost level:', data);
        const player = game.players.get(data.playerId);
        if (player) {
            player.level = data.level;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            player.xp = data.xp;
            player.xpToNextLevel = data.xpToNextLevel;

            // Show level loss message
            game.showFloatingText(
                player.x,
                player.y - 30,
                'Level Lost! Level ' + data.level,
                '#FF0000',
                24
            );

            // Save the new progress
            game.savePlayerProgress(player);
        }
    });

    game.socket.on('playerRespawned', (player: Player) => {
        const existingPlayer = game.players.get(player.id);
        if (existingPlayer) {
            Object.assign(existingPlayer, player);
            if (player.id === game.socket.id) {
                game.isPlayerDead = false;
                game.hideDeathScreen();
            }
            // Show respawn message
            game.showFloatingText(
                player.x,
                player.y - 50,
                'Respawned!',
                '#FFFFFF',
                20
            );
        }
    });

    game.socket.on('playerDied', (playerId: string) => {
        if (playerId === game.socket.id) {
            game.isPlayerDead = true;
            game.showDeathScreen();
        }
    });

    game.socket.on('decorationsUpdate', (decorations: Array<{
        x: number;
        y: number;
        scale: number;
    }>) => {
        game.decorations = decorations;
    });

    game.socket.on('sandsUpdate', (sands: Array<{
        x: number;
        y: number;
        radius: number;
        rotation: number;
    }>) => {
        game.sands = sands;
    });

    game.socket.on('playerUpdated', (updatedPlayer: Player) => {
        const player = game.players.get(updatedPlayer.id);
        if (player) {
            Object.assign(player, updatedPlayer);
            // Update displays if this is the current player
            if (updatedPlayer.id === game.socket?.id) {
                if (game.isInventoryOpen) {
                    game.updateInventoryDisplay();
                }
                if (game.inventoryManager) {
                    game.inventoryManager.updateLoadoutDisplay();
                }
            }
        }
    });

    game.socket.on('speedBoostActive', (playerId: string) => {
        console.log('Speed boost active:', playerId);
        if (playerId === game.socket.id) {
            game.speedBoostActive = true;
            console.log('Speed boost active for client');
        }
    });

    game.socket.on('savePlayerProgress', () => {
        game.showSaveIndicator();
    });

    game.socket.on('craftingSuccess', (data: { newItem: Item; inventory: Item[] }) => {
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            player.inventory = data.inventory;

            game.showFloatingText(
                game.canvas.width / 2,
                50,
                `Successfully crafted ${data.newItem.rarity} ${data.newItem.type}!`,
                game.ITEM_RARITY_COLORS[data.newItem.rarity || 'common'],
                24
            );

            game.updateInventoryDisplay();
        }
    });

    game.socket.on('craftingFailed', (message: string) => {
        game.showFloatingText(
            game.canvas.width / 2,
            50,
            message,
            '#FF0000',
            20
        );

        // Return items to inventory
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            game.craftingSlots.forEach((slot: { item: Item | null }) => {
                if (slot.item) {
                    player.inventory.push(slot.item);
                }
            });
            game.craftingSlots.forEach((slot: { item: Item | null }) => slot.item = null);

            game.updateCraftingDisplay();
            game.updateInventoryDisplay();
        }
    });

    // Listen for server game state updates for better synchronization
    game.socket.on('gameStateUpdate', (data: { players: Player[], enemies: any[], items: any[], dots: any[], timestamp: number }) => {
        const serverPlayers = data.players;

        serverPlayers.forEach(serverPlayer => {
            const existingPlayer = game.players.get(serverPlayer.id);
            if (existingPlayer) {
                existingPlayer.targetX = serverPlayer.x;
                existingPlayer.targetY = serverPlayer.y;
                existingPlayer.angle = serverPlayer.angle;
                existingPlayer.health = serverPlayer.health;
                existingPlayer.maxHealth = serverPlayer.maxHealth;
                existingPlayer.level = serverPlayer.level;
            } else {
                game.players.set(serverPlayer.id, {
                    ...serverPlayer,
                    imageLoaded: true,
                    score: 0,
                    velocityX: 0,
                    velocityY: 0,
                    targetX: serverPlayer.x,
                    targetY: serverPlayer.y
                });
            }
        });
    });

    game.socket.on('updatePlayers', (serverPlayers: ServerPlayer[]) => {
        const serverPlayerIds = serverPlayers.map(p => p.id);
        // Remove players that are no longer sent by the server
        game.players.forEach((player: Player, playerId: string) => {
            if (!serverPlayerIds.includes(playerId)) {
                game.players.delete(playerId);
            }
        });

        serverPlayers.forEach(serverPlayer => {
            let player = game.players.get(serverPlayer.id);
            if (player) {
                // Update existing player
                player.x = serverPlayer.x;
                player.y = serverPlayer.y;
                player.angle = serverPlayer.angle;
                player.score = serverPlayer.score;
                player.health = serverPlayer.health;
                player.maxHealth = serverPlayer.maxHealth;
                player.damage = serverPlayer.damage;
                player.inventory = serverPlayer.inventory;
                player.loadout = serverPlayer.loadout;
                player.isInvulnerable = serverPlayer.isInvulnerable;
                player.knockbackX = serverPlayer.knockbackX;
                player.knockbackY = serverPlayer.knockbackY;
                player.level = serverPlayer.level;
                player.xp = serverPlayer.xp;
                player.xpToNextLevel = serverPlayer.xpToNextLevel;
                player.lastDamageTime = serverPlayer.lastDamageTime;
                player.speed_boost = serverPlayer.speed_boost;
            } else {
                // Add new player
                player = {
                    ...serverPlayer,
                    image: new Image(),
                    imageLoaded: false,
                    targetX: serverPlayer.x,
                    targetY: serverPlayer.y,
                };
                player.image.src = 'assets/player.png';
                player.image.onload = () => {
                    player!.imageLoaded = true;
                };
                game.players.set(serverPlayer.id, player);
            }
        });
    });

    game.socket.on('updateEnemies', (serverEnemies: Enemy[]) => {
        game.enemies.clear();
        serverEnemies.forEach(enemy => {
            game.enemies.set(enemy.id, enemy);
        });
    });

    game.socket.on('updateItems', (serverItems: WorldItem[]) => {
        game.items.clear();
        serverItems.forEach(item => {
            game.items.set(item.id, item);
        });
    });

    game.socket.on('playerDied', (data: { playerId: string }) => {
        if (data.playerId === game.socket.id) {
            game.isPlayerDead = true;
            game.showDeathScreen();
        }
    });
}
