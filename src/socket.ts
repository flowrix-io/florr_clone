import { io, Socket } from 'socket.io-client';
import { Player, PlayerInventory, ServerPlayer } from './player';
import { Enemy, Obstacle } from './enemy';
import { Item, WorldItem } from './item';

export { Socket };

export function initMultiPlayerMode(game: any, serverIp: string) {
    // Remove connecting message immediately
    const connectingDiv = document.getElementById('connectingDiv');
    if (connectingDiv) {
        connectingDiv.remove();
    }
    
    // Check if there's a preconnected socket available
    if (window.preconnectedSocket && window.preconnectedSocket.connected) {
        console.log(`[CLIENT] Using preconnected socket (ID: ${window.preconnectedSocket.id})`);
        game.socket = window.preconnectedSocket;
        // Remove only the mapData listener from preconnect, keep all other listeners
        const mapDataListeners = game.socket.listeners('mapData');
        game.socket.removeAllListeners('mapData');
        // Clear the preconnected socket reference since we're now using it
        window.preconnectedSocket = null;
        // Socket is already connected
        console.log(`[CLIENT] Preconnected socket already connected, proceeding with authentication`);
    } else if (window.preconnectedSocket && !window.preconnectedSocket.connected) {
        console.log(`[CLIENT] Preconnected socket exists but not connected yet, creating new connection instead`);
        // If preconnected socket exists but isn't connected, create a new one
        window.preconnectedSocket = null;
        // Fall through to create new connection
    }
    
    // Create new connection if no preconnected socket or it wasn't connected
    if (!game.socket) {
        // Use provided server IP or current origin as default
        const serverUrl = serverIp || window.location.origin;
        
        console.log(`[CLIENT] Connecting to server: ${serverUrl}`);
        
        game.socket = io(serverUrl, {
            secure: serverUrl.startsWith('https'),
            rejectUnauthorized: false,
            withCredentials: true,
            transports: ['websocket', 'polling'] // Explicitly set transports
        });

        game.socket.on('connect', () => {
            const connectTime = performance.now();
            console.log(`[CLIENT] Connected to server at ${connectTime.toFixed(0)}`);
            // Remove connecting message when connected
            const connectingDiv = document.getElementById('connectingDiv');
            if (connectingDiv) {
                connectingDiv.remove();
            }
            game.hideTitleScreen();
            game.showExitButton();
        });
        
        game.socket.on('connect_error', (error: Error) => {
            console.error(`[CLIENT] Connection error:`, error);
            // Remove connecting message on error
            const connectingDiv = document.getElementById('connectingDiv');
            if (connectingDiv) {
                connectingDiv.remove();
            }
        });
    }

    // Only setup listeners if socket is assigned
    if (game.socket) {
        setupSocketListeners(game);
    }
    
    // If socket is already connected (preconnected), hide title screen now
    if (game.socket.connected) {
        console.log(`[CLIENT] Socket already connected, hiding title screen`);
        game.hideTitleScreen();
        // Remove connecting message
        const connectingDiv = document.getElementById('connectingDiv');
        if (connectingDiv) {
            connectingDiv.remove();
        }
    }
}

function setupSocketListeners(game: any) {
    game.socket.on('connect', () => {
        const connectTime = performance.now();
        console.log(`[CLIENT] Socket connected with ID ${game.socket.id} at ${connectTime.toFixed(0)}`);
        
        // Handle cross-server transfer claim if pending
        if (game.pendingTransfer) {
            console.log(`[CLIENT] Connected to new server, claiming transferred player`);
            
            fetch(game.pendingTransfer.newServerUrl + '/transfer/claim', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    transferToken: game.pendingTransfer.transferToken,
                    newSocketId: game.socket.id
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('[CLIENT] Successfully claimed transferred player');
                    game.hideTransferMessage();
                    
                    // Ensure player data is properly initialized with defaults if needed
                    if (data.playerData && game.socket.id) {
                        // Clean up any existing player with the same ID to prevent duplicates
                        game.players.delete(game.socket.id);
                        
                        // Ensure loadout is properly initialized
                        if (!data.playerData.loadout || !Array.isArray(data.playerData.loadout)) {
                            data.playerData.loadout = [];
                            console.warn('[CLIENT] Transferred player had invalid loadout, initialized empty array');
                        }
                        
                        // Ensure inventory is properly initialized
                        if (!data.playerData.inventory || typeof data.playerData.inventory !== 'object') {
                            data.playerData.inventory = {};
                            console.warn('[CLIENT] Transferred player had invalid inventory, initialized empty object');
                        }
                        
                        // Create new player object with transferred data
                        const currentPlayer = {
                            id: game.socket.id,
                            name: data.playerData.name || 'Anonymous',
                            x: data.playerData.x || 200,
                            y: data.playerData.y || 200,
                            angle: data.playerData.angle || 0,
                            score: data.playerData.score || 0,
                            imageLoaded: false,
                            image: new Image(),
                            velocityX: 0,
                            velocityY: 0,
                            health: data.playerData.health || 100,
                            maxHealth: data.playerData.maxHealth || 100,
                            damage: data.playerData.damage || 10,
                            inventory: data.playerData.inventory || {},
                            loadout: data.playerData.loadout || [],
                            level: data.playerData.level || 1,
                            xp: data.playerData.xp || 0,
                            xpToNextLevel: data.playerData.xpToNextLevel || 100,
                            targetX: data.playerData.x || 200,
                            targetY: data.playerData.y || 200
                        };
                        
                        // Set the new player data
                        game.players.set(game.socket.id, currentPlayer);
                        console.log('[CLIENT] Player data updated after transfer');
                    }
                    
                    // Update chat system to use new socket
                    if (game.chat) {
                        game.chat.updateSocket(game.socket);
                    }
                    
                    // Clear pending transfer
                    delete game.pendingTransfer;
                } else {
                    console.error('[CLIENT] Failed to claim transferred player:', data.message);
                    game.showTransferMessage('Transfer failed. Please try again.');
                }
            })
            .catch(error => {
                console.error('[CLIENT] Error claiming transferred player:', error);
                game.showTransferMessage('Transfer failed. Please try again.');
            });
        } else {
            // Normal connection (not a transfer)
            if (game.socket.id) {
                game.socket.emit('chatMessage', `${game.players.get(game.socket.id)?.name} has joined the game`);
            }
            
            // Update chat system to use new socket (for reconnections)
            if (game.chat) {
                game.chat.updateSocket(game.socket);
            }
        }

        // Start heartbeat monitoring (clear any existing interval first)
        if (game.heartbeatInterval) {
            clearInterval(game.heartbeatInterval);
        }
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

    // Handle cross-server transfer
    game.socket.on('playerTransferred', async (transferData: any) => {
        console.log(`[CLIENT] Player being transferred to server ${transferData.targetServer.name} on port ${transferData.targetServer.port}`);
        
        try {
            // Hide teleporter UI since we're transferring
            game.hideTeleporterUI();
            
            // Disconnect from current server
            game.socket.disconnect();
            
            // Clear heartbeat interval
            if (game.heartbeatInterval) {
                clearInterval(game.heartbeatInterval);
            }
            
            // Show transfer message to player
            game.showTransferMessage(`Transferring to ${transferData.targetServer.name}...`);
            
            // Wait a moment for disconnect to complete
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Connect to new server
            const protocol = transferData.targetServer.protocol || 'https';
            const newServerUrl = `${protocol}://${transferData.targetServer.host}:${transferData.targetServer.port}`;
            game.socket = io(newServerUrl, {
                secure: newServerUrl.startsWith('https'),
                rejectUnauthorized: false,
                withCredentials: true
            });
            
            // Store transfer data for claiming after reconnect
            game.pendingTransfer = {
                transferToken: transferData.transferToken,
                targetX: transferData.targetX,
                targetY: transferData.targetY,
                newServerUrl: newServerUrl
            };
            
            // Set up listeners for new connection (this will handle the connect event)
            setupSocketListeners(game);
            
        } catch (error) {
            console.error('[CLIENT] Error during server transfer:', error);
            game.showTransferMessage('Transfer failed. Please try again.');
        }
    });

    // Handle transfer failure
    game.socket.on('transferFailed', (data: any) => {
        console.error('[CLIENT] Server transfer failed:', data.message);
        game.showTransferMessage('Transfer failed: ' + data.message);
    });

    // Handle same-server teleportation
    game.socket.on('playerTeleported', (data: any) => {
        console.log(`[CLIENT] Player ${data.playerId} teleported to (${data.newX}, ${data.newY})`);
        
        // Update player position if it's the current player
        const player = game.players.get(data.playerId);
        if (player) {
            player.x = data.newX;
            player.y = data.newY;
            
            // Add teleport effect
            game.addTeleportEffect(data.newX, data.newY);
        }
        
        // Hide teleporter UI if it's the current player
        if (data.playerId === game.socket.id) {
            game.hideTeleporterUI();
        }
    });

    // Handle teleporter entry (player entered teleporter)
    game.socket.on('teleporterEntered', (data: any) => {
        console.log(`[CLIENT] Entered teleporter, waiting ${data.timeRequired}ms to teleport`);
        
        // Show teleporter countdown UI
        game.showTeleporterUI(data.teleportTo, data.timeRequired);
    });

    // Handle teleporter exit (player left teleporter before teleporting)
    game.socket.on('teleporterExited', () => {
        console.log('[CLIENT] Left teleporter before teleporting');
        
        // Hide teleporter UI
        game.hideTeleporterUI();
    });

    // Handle player split event
    game.socket.on('playerSplit', (data: { originalId: string, player1Id: string, player2Id: string }) => {
        console.log(`[CLIENT] Player split: original=${data.originalId}, player1=${data.player1Id}, player2=${data.player2Id}`);
        // Set active player to player1 initially
        if (data.originalId === game.socket.id) {
            game.activePlayerId = data.player1Id;
        }
    });

    // Handle player switch event
    game.socket.on('playerSwitched', (data: { originalId: string, activePlayerId: string }) => {
        console.log(`[CLIENT] Player switched: original=${data.originalId}, active=${data.activePlayerId}`);
        // Update active player ID if this is our split
        if (data.originalId === game.socket.id || game.activePlayerId === data.originalId) {
            game.activePlayerId = data.activePlayerId;
            
            // Clear petal physics states for both split players to force reinitialization
            // This ensures petals properly move out when switching
            if (game.graphics && game.graphics.clearPetalPhysicsForPlayer) {
                game.graphics.clearPetalPhysicsForPlayer(data.originalId);
                game.graphics.clearPetalPhysicsForPlayer(`${data.originalId}_split2`);
            }
        }
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
        // Update loadout display after player loadout and inventory is received
        if (game.socket.id && game.players.has(game.socket.id) && game.inventoryManager) {
            game.inventoryManager.updateLoadoutDisplay();
        }
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
        
        // Hide teleporter UI on disconnect to prevent UI from staying visible
        game.hideTeleporterUI();
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

    // Handle player leaving (for cross-server transfers)
    game.socket.on('playerLeft', (playerId: string) => {
        console.log(`[CLIENT] Player ${playerId} left the server`);
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
        // Only used on initial connection - update all enemies
        const serverEnemyIds = new Set(enemies.map(e => e.id));
        
        // Remove enemies that no longer exist
        for (const [enemyId] of game.enemies) {
            if (!serverEnemyIds.has(enemyId)) {
                game.enemies.delete(enemyId);
            }
        }
        
        // Update or add enemies
        enemies.forEach(enemy => {
            game.enemies.set(enemy.id, enemy);
        });
    });

    game.socket.on('enemySpawned', (enemy: Enemy) => {
        // Add newly spawned enemy
        game.enemies.set(enemy.id, enemy);
    });

    game.socket.on('mobProjectilesUpdate', (projectiles: any[]) => {
        game.mobProjectiles.clear();
        projectiles.forEach(projectile => game.mobProjectiles.set(projectile.id, projectile));
    });

    game.socket.on('playerProjectilesUpdate', (projectiles: any[]) => {
        game.playerProjectiles.clear();
        projectiles.forEach(projectile => game.playerProjectiles.set(projectile.id, projectile));
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
            const oldHealth = enemy.health;
            enemy.health = data.health;
            
            // Calculate damage dealt and show floating damage number (throttled)
            if (oldHealth > data.health) {
                const damage = oldHealth - data.health;
                // Use throttled damage text to prevent spam when many enemies are damaged
                game.graphics.showDamageText(data.enemyId, enemy.x, enemy.y, damage);
            }
        }
    });

    game.socket.on('targetDummyDPS', (data: { enemyId: string, dps: number }) => {
        const enemy = game.enemies.get(data.enemyId);
        if (enemy && enemy.type === 'target_dummy') {
            enemy.currentDPS = data.dps;
        }
    });

    game.socket.on('enemyDestroyed', (enemyId: string) => {
        // Show any accumulated damage before cleaning up
        const enemy = game.enemies.get(enemyId);
        if (enemy) {
            const accumulated = game.graphics.getAccumulatedDamage(enemyId);
            if (accumulated > 0) {
                // Show final accumulated damage
                game.graphics.showFloatingText(
                    enemy.x,
                    enemy.y - 20,
                    `-${Math.round(accumulated)}`,
                    '#ff0000',
                    16
                );
            }
        }
        
        // Clean up accumulated damage for this enemy
        game.graphics.clearEnemyDamage(enemyId);
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

    game.socket.on('itemSpawned', (item: WorldItem) => {
        game.items.set(item.id, item);
    });

    // Petal action event handlers
    game.socket.on('playerHealed', (data: { playerId: string, health: number, healAmount: number }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            const oldHealth = player.health;
            player.health = data.health;
            
            // Show healing effect
            if (data.healAmount > 0) {
                const roundedHeal = Math.round(data.healAmount * 10) / 10;
                const formattedHeal = roundedHeal % 1 === 0 ? roundedHeal.toString() : roundedHeal.toFixed(1);
                game.showFloatingText(
                    player.x,
                    player.y - 20,
                    `+${formattedHeal}`,
                    '#00FF00',
                    20
                );
            }
        }
    });

    game.socket.on('petalExplosion', (data: { x: number, y: number, radius: number, damage: number }) => {
        // Show explosion effect
        game.showExplosionEffect(data.x, data.y, data.radius);
        console.log(`[CLIENT] Petal explosion at (${data.x}, ${data.y}) with radius ${data.radius}`);
    });

    game.socket.on('petalBroken', (data: { playerId: string, slotIndex: number, petalType: string, rarity: string }) => {
        const player = game.players.get(data.playerId);
        if (player && player.loadout[data.slotIndex]) {
            const petal = player.loadout[data.slotIndex];
            if (petal) {
                petal.health = 0;
                petal.onCooldown = true;
                
                // Show petal break effect
                game.showPetalBreakEffect(player.x, player.y, data.petalType);
                console.log(`[CLIENT] Petal ${data.petalType} (${data.rarity}) broke for player ${data.playerId}`);
            }
        }
    });

    game.socket.on('petalRestored', (data: { playerId: string, slotIndex: number, petal: any }) => {
        const player = game.players.get(data.playerId);
        if (player && player.loadout[data.slotIndex]) {
            player.loadout[data.slotIndex] = data.petal;
            console.log(`[CLIENT] Petal restored for player ${data.playerId} in slot ${data.slotIndex}`);
        }
    });

    game.socket.on('itemPickedUp', (itemId: string) => {
        console.log('Item picked up by me:', itemId);
        // Hide the item from this player's view (but keep it in the world for other eligible players)
        if (game.pickedUpItems) {
            game.pickedUpItems.add(itemId);
        }
    });
    
    game.socket.on('itemRemoved', (itemId: string) => {
        console.log('Item removed from world:', itemId);
        // Remove the item from the game when all eligible players have picked it up
        game.items.delete(itemId);
        // Also remove it from pickedUpItems set
        if (game.pickedUpItems) {
            game.pickedUpItems.delete(itemId);
        }
    });

    game.socket.on('petalBroken', (data: { playerId: string, slotIndex: number, petalType: string, rarity: string }) => {
        console.log('Petal broken:', data);
        const player = game.players.get(data.playerId);
        if (player && player.loadout) {
            // Set petal on cooldown instead of removing it
            if (player.loadout[data.slotIndex]) {
                player.loadout[data.slotIndex]!.onCooldown = true;
            }
            
            // Update inventory display if it's the current player
            if (data.playerId === game.socket.id) {
                if (game.isInventoryOpen) {
                    game.updateInventoryDisplay();
                }
                if (game.inventoryManager) {
                    game.inventoryManager.updateLoadoutDisplay();
                }
            }
        }
    });

    game.socket.on('petalRestored', (data: { playerId: string, slotIndex: number, petal: any }) => {
        console.log('Petal restored:', data);
        const player = game.players.get(data.playerId);
        if (player && player.loadout) {
            // Restore the petal to the loadout
            player.loadout[data.slotIndex] = data.petal;
            
            // Update inventory display if it's the current player
            if (data.playerId === game.socket.id) {
                if (game.isInventoryOpen) {
                    game.updateInventoryDisplay();
                }
                if (game.inventoryManager) {
                    game.inventoryManager.updateLoadoutDisplay();
                }
            }
        }
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
            // Reset the isDead flag
            existingPlayer.isDead = false;
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

    // Debounce mob gallery updates to prevent lag when multiple mobs die
    let mobGalleryUpdateTimeout: NodeJS.Timeout | null = null;
    
    game.socket.on('playerUpdated', (updatedPlayer: Player) => {
        let player = game.players.get(updatedPlayer.id);
        
        // If player doesn't exist yet, create it (e.g., for split players)
        if (!player) {
            player = {
                ...updatedPlayer,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                targetX: updatedPlayer.x,
                targetY: updatedPlayer.y
            };
            game.players.set(updatedPlayer.id, player);
        } else {
            // Optimize: Only check changes if we need to update UI
            // Use reference comparison first (faster), then deep comparison only if needed
            let loadoutChanged = false;
            let inventoryChanged = false;
            let mobKillsChanged = false;
            
            // Only do expensive JSON.stringify if we need to update UI
            if (updatedPlayer.id === game.socket?.id) {
                // Quick reference check first
                if (player.loadout !== updatedPlayer.loadout) {
                    loadoutChanged = JSON.stringify(player.loadout) !== JSON.stringify(updatedPlayer.loadout);
                }
                if (player.inventory !== updatedPlayer.inventory) {
                    inventoryChanged = JSON.stringify(player.inventory) !== JSON.stringify(updatedPlayer.inventory);
                }
                
                // Check mobKills (handle undefined cases)
                const oldMobKills = player.mobKills || {};
                const newMobKills = updatedPlayer.mobKills || {};
                if (oldMobKills !== newMobKills) {
                    mobKillsChanged = JSON.stringify(oldMobKills) !== JSON.stringify(newMobKills);
                }
            }
            
            Object.assign(player, updatedPlayer);
            
            // Update displays if this is the current player
            if (updatedPlayer.id === game.socket?.id) {
                if (game.isInventoryOpen && inventoryChanged) {
                    game.updateInventoryDisplay();
                }
                // Only update loadout display if loadout actually changed
                if (game.inventoryManager && loadoutChanged) {
                    game.inventoryManager.updateLoadoutDisplay();
                }
                // Debounce mob gallery update to prevent lag when multiple mobs die quickly
                if (game.inventoryManager && mobKillsChanged) {
                    if (mobGalleryUpdateTimeout) {
                        clearTimeout(mobGalleryUpdateTimeout);
                    }
                    mobGalleryUpdateTimeout = setTimeout(() => {
                        game.inventoryManager.updateMobGalleryIfOpen();
                        mobGalleryUpdateTimeout = null;
                    }, 100); // Small delay to batch multiple updates
                }
                // Update skills menu if open
                if (game.skillsManager && updatedPlayer.tp !== undefined && updatedPlayer.skills) {
                    game.skillsManager.updateSkills(updatedPlayer.tp, updatedPlayer.skills);
                }
            }
        }
    });

    game.socket.on('skillsUpdated', (data: {
        playerId: string;
        tp: number;
        skills: { [key: string]: string };
    }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.tp = data.tp;
            player.skills = data.skills;
            // Update skills menu if this is the current player and menu is open
            if (data.playerId === game.socket?.id && game.skillsManager) {
                game.skillsManager.updateSkills(data.tp, data.skills);
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

    game.socket.on('craftingFinished', (data: { successCount: number, failCount: number, newItem: Item, inventory: PlayerInventory }) => {
        console.log('[CLIENT] craftingFinished received:', data);
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            player.inventory = data.inventory;

            if (data.successCount > 0) {
                // Show success display in crafting panel
                if (game.inventoryManager.isCraftingOpen) {
                    // Parse item type and petalType from itemKey
                    const itemKey = data.newItem.type;
                    let itemType: Item['type'] = 'petal';
                    let petalType: string | undefined;
                    
                    if (itemKey.startsWith('petal_')) {
                        itemType = 'petal';
                        petalType = itemKey.substring(6);
                    } else {
                        itemType = itemKey as Item['type'];
                    }
                    
                    const displayItem: Item = {
                        type: itemType,
                        rarity: data.newItem.rarity,
                        petalType: petalType
                    };
                    
                    game.inventoryManager.showCraftingSuccess(displayItem, data.successCount);
                }
                
                game.showFloatingText(
                    game.canvas.width / 2,
                    50,
                    `Successfully crafted ${data.successCount}x ${data.newItem.rarity} ${data.newItem.type}!`,
                    game.ITEM_RARITY_COLORS[data.newItem.rarity || 'common'],
                    24
                );
            }
            if (data.failCount > 0) {
                game.showFloatingText(
                    game.canvas.width / 2,
                    80,
                    `Failed to craft ${data.failCount}x. Items were lost.`,
                    '#FF0000',
                    20
                );
            }

            if (game.inventoryManager.isCraftingOpen) {
                game.inventoryManager.updateCraftingDisplay();
            }
        }
    });

    game.socket.on('craftingFailed', (message: string) => {
        console.log('[CLIENT] craftingFailed received:', message);
        game.showFloatingText(
            game.canvas.width / 2,
            50,
            `Crafting failed: ${message}`,
            '#FF0000',
            20
        );
        
        if (game.inventoryManager.isCraftingOpen) {
            game.inventoryManager.updateCraftingDisplay();
        }
    });

    // Shop handlers
    game.socket.on('shopPurchaseSuccess', (data: { inventory: PlayerInventory, stars: number }) => {
        console.log('[CLIENT] shopPurchaseSuccess received:', data);
        const player = game.players.get(game.socket.id);
        if (player) {
            player.inventory = data.inventory;
            player.stars = data.stars;
            if (game.inventoryManager) {
                game.inventoryManager.updateInventoryDisplay();
            }
            if (game.shopManager) {
                game.shopManager.handlePurchaseSuccess();
                game.shopManager.updateStarsDisplay();
            }
        }
    });

    game.socket.on('shopPurchaseError', (message: string) => {
        console.log('[CLIENT] shopPurchaseError received:', message);
        if (game.shopManager) {
            game.shopManager.handlePurchaseError(message);
        }
    });

    game.socket.on('codeRedeemSuccess', (data: { code?: string, stars: number, totalStars: number }) => {
        console.log('[CLIENT] codeRedeemSuccess received:', data);
        const player = game.players.get(game.socket.id);
        if (player) {
            player.stars = data.totalStars;
            if (game.shopManager) {
                game.shopManager.handleCodeRedeemSuccess(data.stars);
                game.shopManager.updateStarsDisplay();
            }
        }
        // Notifications are now handled on the server side
    });

    game.socket.on('codeRedeemError', (message: string) => {
        console.log('[CLIENT] codeRedeemError received:', message);
        if (game.shopManager) {
            game.shopManager.handleCodeRedeemError(message);
        }
    });

    game.socket.on('starsEarned', (data: { amount: number, total: number, mobName: string, tier: string }) => {
        console.log('[CLIENT] starsEarned received:', data);
        // Update player stars
        const player = game.getLocalPlayer();
        if (player) {
            player.stars = data.total;
            // Show floating text
            game.showFloatingText(
                game.canvas.width / 2,
                game.canvas.height / 2,
                `+${data.amount} ⭐ Stars!`,
                '#ffd700',
                24
            );
        }
        // Update shop display (including challenges tab if open)
        if (game.shopManager) {
            game.shopManager.updateStarsDisplay();
        }
    });

    // Listen for server game state updates for better synchronization
    game.socket.on('gameStateUpdate', (data: { players: Player[], enemies: any[], items: any[], dots: any[], timestamp: number }) => {
        const serverPlayers = data.players;
        const serverEnemies = data.enemies;

        serverPlayers.forEach(serverPlayer => {
            const existingPlayer = game.players.get(serverPlayer.id);
            if (existingPlayer) {
                existingPlayer.targetX = serverPlayer.x;
                existingPlayer.targetY = serverPlayer.y;
                existingPlayer.angle = serverPlayer.angle;
                existingPlayer.health = serverPlayer.health;
                existingPlayer.maxHealth = serverPlayer.maxHealth;
                existingPlayer.level = serverPlayer.level;
                // Sync petal extension from server (if available in gameStateUpdate)
                if ('petalExtension' in serverPlayer) {
                    existingPlayer.petalExtension = (serverPlayer as any).petalExtension || 1.0;
                }
                // Preserve XP values - don't overwrite them from gameStateUpdate
                // as they are managed separately by xpGained events
            } else {
                const newPlayer: any = {
                    ...serverPlayer,
                    imageLoaded: true,
                    score: 0,
                    velocityX: 0,
                    velocityY: 0,
                    targetX: serverPlayer.x,
                    targetY: serverPlayer.y,
                    // Initialize XP values for new players
                    xp: 0,
                    xpToNextLevel: 100
                };
                // Sync petal extension if available
                if ('petalExtension' in serverPlayer) {
                    newPlayer.petalExtension = (serverPlayer as any).petalExtension || 1.0;
                }
                game.players.set(serverPlayer.id, newPlayer);
            }
        });

        if (serverEnemies) {
            // Optimize: Only update changed enemies instead of clearing entire map
            const serverEnemyIds = new Set(serverEnemies.map(e => e.id));
            
            // Remove enemies that no longer exist
            for (const [enemyId] of game.enemies) {
                if (!serverEnemyIds.has(enemyId)) {
                    game.enemies.delete(enemyId);
                }
            }
            
            // Update or add enemies
            serverEnemies.forEach(enemy => {
                game.enemies.set(enemy.id, enemy);
            });
        }
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
                // Sync petal extension from server
                player.petalExtension = serverPlayer.inputs?.petalExtension || 1.0;
                // Update mobKills if it changed
                if (serverPlayer.mobKills !== undefined) {
                    const mobKillsChanged = JSON.stringify(player.mobKills) !== JSON.stringify(serverPlayer.mobKills);
                    player.mobKills = serverPlayer.mobKills;
                    // Update mob gallery if it's open and mobKills changed
                    if (mobKillsChanged && serverPlayer.id === game.socket?.id && game.inventoryManager) {
                        game.inventoryManager.updateMobGalleryIfOpen();
                    }
                }
                // Also update tp and skills if present
                if (serverPlayer.tp !== undefined) {
                    player.tp = serverPlayer.tp;
                }
                if (serverPlayer.skills !== undefined) {
                    player.skills = serverPlayer.skills;
                }
                // Update stars if present
                if (serverPlayer.stars !== undefined) {
                    player.stars = serverPlayer.stars;
                    if (game.shopManager && game.shopManager.isShopOpenState()) {
                        game.shopManager.updateStarsDisplay();
                    }
                }
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

    game.socket.on('playerDied', (data: { playerId: string, x: number, y: number, angle: number, killedBy?: { type: string; tier: string } }) => {
        // Update the player's state to mark them as dead
        const player = game.players.get(data.playerId);
        if (player) {
            player.isDead = true;
            player.angle = data.angle; // Set the random rotation
        }
        
        if (data.playerId === game.socket.id) {
            game.isPlayerDead = true;
            game.showDeathScreen(data.killedBy);
        }
    });

    game.socket.on('playerRespawned', (player: any) => {
        // Update the player's state to mark them as alive
        const gamePlayer = game.players.get(player.id);
        if (gamePlayer) {
            gamePlayer.isDead = false;
            gamePlayer.health = player.health;
            gamePlayer.maxHealth = player.maxHealth;
            gamePlayer.x = player.x;
            gamePlayer.y = player.y;
        }
        
        if (player.id === game.socket.id) {
            game.isPlayerDead = false;
            game.hideDeathScreen();
        }
    });

    game.socket.on('playerRevived', (data: { 
        revivedPlayerId: string, 
        revivingPlayerId: string, 
        revivedPlayerName: string, 
        revivingPlayerName: string 
    }) => {
        // Update the revived player's state
        const revivedPlayer = game.players.get(data.revivedPlayerId);
        if (revivedPlayer) {
            revivedPlayer.isDead = false;
            revivedPlayer.health = revivedPlayer.maxHealth;
        }
        
        // Show revival message
        game.showFloatingText(
            game.canvas.width / 2,
            200,
            `${data.revivingPlayerName} revived ${data.revivedPlayerName}!`,
            '#32CD32',
            20
        );
        
        // If the revived player is the local player, hide death screen
        if (data.revivedPlayerId === game.socket.id) {
            game.isPlayerDead = false;
            game.hideDeathScreen();
        }
    });
}
