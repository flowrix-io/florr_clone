"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Socket = void 0;
exports.initMultiPlayerMode = initMultiPlayerMode;
const socket_io_client_1 = require("socket.io-client");
Object.defineProperty(exports, "Socket", { enumerable: true, get: function () { return socket_io_client_1.Socket; } });
function initMultiPlayerMode(game, serverIp) {
    // Use provided server IP or current origin as default
    const serverUrl = serverIp || window.location.origin;
    console.log(`[CLIENT] Connecting to server: ${serverUrl}`);
    game.socket = (0, socket_io_client_1.io)(serverUrl, {
        secure: serverUrl.startsWith('https'),
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
function setupSocketListeners(game) {
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
                }
                else {
                    console.error('[CLIENT] Failed to claim transferred player:', data.message);
                    game.showTransferMessage('Transfer failed. Please try again.');
                }
            })
                .catch(error => {
                console.error('[CLIENT] Error claiming transferred player:', error);
                game.showTransferMessage('Transfer failed. Please try again.');
            });
        }
        else {
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
    game.socket.on('playerTransferred', async (transferData) => {
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
            game.socket = (0, socket_io_client_1.io)(newServerUrl, {
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
        }
        catch (error) {
            console.error('[CLIENT] Error during server transfer:', error);
            game.showTransferMessage('Transfer failed. Please try again.');
        }
    });
    // Handle transfer failure
    game.socket.on('transferFailed', (data) => {
        console.error('[CLIENT] Server transfer failed:', data.message);
        game.showTransferMessage('Transfer failed: ' + data.message);
    });
    // Handle same-server teleportation
    game.socket.on('playerTeleported', (data) => {
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
    game.socket.on('teleporterEntered', (data) => {
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
    // Add runJS event handler
    game.socket.on('runJS', (code) => {
        try {
            // Create a new Function to execute the code in a safer context
            const safeEval = new Function(code);
            safeEval();
        }
        catch (error) {
            console.error('Error executing JS:', error);
        }
    });
    // Add serverType event handler
    game.socket.on('serverType', (type) => {
        console.log(`Connected to ${type} server`);
        // You can add visual feedback here if needed
        game.showFloatingText(game.canvas.width / 2, 50, `Connected to ${type} server`, '#00FF00', 24);
    });
    game.socket.on('currentPlayers', (players) => {
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
    game.socket.on('newPlayer', (player) => {
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
    game.socket.on('playerMoved', (player) => {
        const now = performance.now();
        game.lastHeartbeat = now; // Update heartbeat on any server message
        const existingPlayer = game.players.get(player.id);
        const isCurrentPlayer = player.id === game.socket?.id;
        // Debug: Log server position updates with timing
        if (existingPlayer && isCurrentPlayer) {
            const positionDiff = Math.sqrt(Math.pow(existingPlayer.x - player.x, 2) +
                Math.pow(existingPlayer.y - player.y, 2));
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
            }
            else {
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
        }
        else {
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
    game.socket.on('disconnect', (reason) => {
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
    game.socket.on('pong', (serverTime) => {
        const now = performance.now();
        const roundTripTime = now - serverTime;
        game.lastHeartbeat = now;
        if (roundTripTime < 1000) { // Only log normal pings, not catch-up ones
            console.log(`[CLIENT] Ping: ${roundTripTime.toFixed(1)}ms`);
        }
        else {
            console.log(`[CLIENT] High ping detected: ${roundTripTime.toFixed(1)}ms`);
        }
    });
    game.socket.on('connect_error', (error) => {
        const errorTime = performance.now();
        console.log(`[CLIENT] Connection error at ${errorTime.toFixed(0)}:`, error);
    });
    game.socket.on('playerDisconnected', (playerId) => {
        const disconnectTime = performance.now();
        console.log(`[CLIENT] Player ${playerId} disconnected at ${disconnectTime.toFixed(0)}`);
        game.players.delete(playerId);
    });
    // Handle player leaving (for cross-server transfers)
    game.socket.on('playerLeft', (playerId) => {
        console.log(`[CLIENT] Player ${playerId} left the server`);
        game.players.delete(playerId);
    });
    game.socket.on('dotCollected', (data) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.score++;
        }
        game.dots.splice(data.dotIndex, 1);
        game.generateDot();
    });
    game.socket.on('enemiesUpdate', (enemies) => {
        game.enemies.clear();
        enemies.forEach(enemy => game.enemies.set(enemy.id, enemy));
    });
    game.socket.on('enemyMoved', (enemy) => {
        game.enemies.set(enemy.id, enemy);
    });
    game.socket.on('playerDamaged', (data) => {
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
                game.showFloatingText(player.x, player.y - 20, `-${damageTaken}`, '#FF0000', 20);
            }
        }
    });
    game.socket.on('enemyDamaged', (data) => {
        const enemy = game.enemies.get(data.enemyId);
        if (enemy) {
            enemy.health = data.health;
        }
    });
    game.socket.on('enemyDestroyed', (enemyId) => {
        game.enemies.delete(enemyId);
    });
    game.socket.on('playerInvulnerabilityEnded', (data) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.isInvulnerable = false;
            console.log(`[CLIENT] Player ${data.playerId} invulnerability ended`);
        }
    });
    game.socket.on('obstaclesUpdate', (obstacles) => {
        game.obstacles = obstacles;
    });
    game.socket.on('obstacleDamaged', (data) => {
        const obstacle = game.obstacles.find((o) => o.id === data.obstacleId);
        if (obstacle && obstacle.isEnemy) {
            obstacle.health = data.health;
        }
    });
    game.socket.on('obstacleDestroyed', (obstacleId) => {
        const index = game.obstacles.findIndex((o) => o.id === obstacleId);
        if (index !== -1) {
            game.obstacles.splice(index, 1);
        }
    });
    game.socket.on('itemsUpdate', (items) => {
        game.items.clear();
        items.forEach(item => {
            game.items.set(item.id, item);
        });
    });
    game.socket.on('itemSpawned', (item) => {
        console.log('Item spawned:', item);
        game.items.set(item.id, item);
    });
    game.socket.on('itemPickedUp', (itemId) => {
        console.log('Item picked up:', itemId);
        game.items.delete(itemId);
    });
    game.socket.on('petalBroken', (data) => {
        console.log('Petal broken:', data);
        const player = game.players.get(data.playerId);
        if (player && player.loadout) {
            // Set petal on cooldown instead of removing it
            if (player.loadout[data.slotIndex]) {
                player.loadout[data.slotIndex].onCooldown = true;
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
    game.socket.on('petalRestored', (data) => {
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
    game.socket.on('itemCollected', (data) => {
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
    game.socket.on('inventoryUpdate', (inventory) => {
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            player.inventory = inventory;
            // Update inventory display if it's open
            if (game.isInventoryOpen) {
                game.updateInventoryDisplay();
            }
        }
    });
    game.socket.on('xpGained', (data) => {
        console.log('XP gained:', data); // Add logging
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
    game.socket.on('levelUp', (data) => {
        //console.log('Level up:', data);  // Add logging
        const player = game.players.get(data.playerId);
        if (player) {
            player.level = data.level;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            game.showFloatingText(player.x, player.y - 30, 'Level Up! Level ' + data.level, '#FFD700', 24);
            game.savePlayerProgress(player);
        }
    });
    game.socket.on('playerLostLevel', (data) => {
        //console.log('Player lost level:', data);
        const player = game.players.get(data.playerId);
        if (player) {
            player.level = data.level;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            player.xp = data.xp;
            player.xpToNextLevel = data.xpToNextLevel;
            // Show level loss message
            game.showFloatingText(player.x, player.y - 30, 'Level Lost! Level ' + data.level, '#FF0000', 24);
            // Save the new progress
            game.savePlayerProgress(player);
        }
    });
    game.socket.on('playerRespawned', (player) => {
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
            game.showFloatingText(player.x, player.y - 50, 'Respawned!', '#FFFFFF', 20);
        }
    });
    game.socket.on('decorationsUpdate', (decorations) => {
        game.decorations = decorations;
    });
    game.socket.on('sandsUpdate', (sands) => {
        game.sands = sands;
    });
    game.socket.on('playerUpdated', (updatedPlayer) => {
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
    game.socket.on('speedBoostActive', (playerId) => {
        console.log('Speed boost active:', playerId);
        if (playerId === game.socket.id) {
            game.speedBoostActive = true;
            console.log('Speed boost active for client');
        }
    });
    game.socket.on('savePlayerProgress', () => {
        game.showSaveIndicator();
    });
    game.socket.on('craftingFinished', (data) => {
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            player.inventory = data.inventory;
            if (data.successCount > 0) {
                game.showFloatingText(game.canvas.width / 2, 50, `Successfully crafted ${data.successCount}x ${data.newItem.rarity} ${data.newItem.type}!`, game.ITEM_RARITY_COLORS[data.newItem.rarity || 'common'], 24);
            }
            if (data.failCount > 0) {
                game.showFloatingText(game.canvas.width / 2, 80, `Failed to craft ${data.failCount}x. Items were lost.`, '#FF0000', 20);
            }
            if (game.inventoryManager.isCraftingOpen) {
                game.inventoryManager.updateCraftingDisplay();
            }
        }
    });
    // Listen for server game state updates for better synchronization
    game.socket.on('gameStateUpdate', (data) => {
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
                // Preserve XP values - don't overwrite them from gameStateUpdate
                // as they are managed separately by xpGained events
            }
            else {
                game.players.set(serverPlayer.id, {
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
                });
            }
        });
        if (serverEnemies) {
            game.enemies.clear();
            serverEnemies.forEach(enemy => {
                game.enemies.set(enemy.id, enemy);
            });
        }
    });
    game.socket.on('updatePlayers', (serverPlayers) => {
        const serverPlayerIds = serverPlayers.map(p => p.id);
        // Remove players that are no longer sent by the server
        game.players.forEach((player, playerId) => {
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
            }
            else {
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
                    player.imageLoaded = true;
                };
                game.players.set(serverPlayer.id, player);
            }
        });
    });
    game.socket.on('updateEnemies', (serverEnemies) => {
        game.enemies.clear();
        serverEnemies.forEach(enemy => {
            game.enemies.set(enemy.id, enemy);
        });
    });
    game.socket.on('updateItems', (serverItems) => {
        game.items.clear();
        serverItems.forEach(item => {
            game.items.set(item.id, item);
        });
    });
    game.socket.on('playerDied', (data) => {
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
    game.socket.on('playerRespawned', (player) => {
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
    // Revival mode events
    game.socket.on('revivalModeActivated', (data) => {
        game.showFloatingText(game.canvas.width / 2, 100, data.message, '#FFD700', 20);
        // Enable revival mode on the game instance
        game.revivalMode = true;
        game.revivalModeEndTime = Date.now() + data.duration;
        // Change cursor to indicate revival mode (optional visual indicator)
        document.body.style.cursor = 'help';
    });
    game.socket.on('revivalModeDeactivated', () => {
        game.revivalMode = false;
        game.revivalModeEndTime = 0;
        // Reset cursor
        document.body.style.cursor = 'default';
        game.showFloatingText(game.canvas.width / 2, 100, 'Revival mode ended', '#FFA500', 16);
    });
    game.socket.on('playerRevived', (data) => {
        // Update the revived player's state
        const revivedPlayer = game.players.get(data.revivedPlayerId);
        if (revivedPlayer) {
            revivedPlayer.isDead = false;
            revivedPlayer.health = revivedPlayer.maxHealth;
        }
        // Show revival message
        game.showFloatingText(game.canvas.width / 2, 200, `${data.revivingPlayerName} revived ${data.revivedPlayerName}!`, '#32CD32', 20);
        // If the revived player is the local player, hide death screen
        if (data.revivedPlayerId === game.socket.id) {
            game.isPlayerDead = false;
            game.hideDeathScreen();
        }
    });
}
