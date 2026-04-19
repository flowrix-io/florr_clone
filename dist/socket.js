"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initMultiPlayerMode = initMultiPlayerMode;
const ws_client_1 = require("./ws_client");
function padLoadout(arr, size) {
    const out = new Array(size).fill(null);
    if (arr)
        for (let i = 0; i < Math.min(arr.length, size); i++)
            out[i] = arr[i] || null;
    return out;
}
function initMultiPlayerMode(game, serverIp) {
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
    }
    else if (window.preconnectedSocket && !window.preconnectedSocket.connected) {
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
        game.socket = (0, ws_client_1.io)(serverUrl, {
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
        });
        game.socket.on('connect_error', (error) => {
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
    // If socket is already connected (preconnected), the 'connect' handler in
    // setupSocketListeners won't fire, so we need to manually run its initialization.
    if (game.socket.connected) {
        console.log(`[CLIENT] Socket already connected, running post-connect init`);
        const connectingDiv = document.getElementById('connectingDiv');
        if (connectingDiv) {
            connectingDiv.remove();
        }
        // Update chat system
        if (game.chat) {
            game.chat.updateSocket(game.socket);
        }
        game._hasConnected = true;
        // Start heartbeat monitoring
        if (game.heartbeatInterval) {
            clearInterval(game.heartbeatInterval);
        }
        game.lastHeartbeat = performance.now();
        game.heartbeatInterval = setInterval(() => {
            const now = performance.now();
            const timeSinceLastHeartbeat = now - game.lastHeartbeat;
            if (timeSinceLastHeartbeat > 5000) {
                console.log(`[CLIENT] Warning: No server response for ${timeSinceLastHeartbeat.toFixed(0)}ms`);
            }
            game.socket.emit('ping', now);
        }, 1000);
    }
}
function setupSocketListeners(game) {
    // Track incoming bytes for network stats
    game.socket.onAny((_event, ...args) => {
        if (game.trackSocketBytes) {
            let bytes = 0;
            for (const arg of args) {
                if (typeof arg === 'string') {
                    bytes += arg.length;
                }
                else if (arg instanceof ArrayBuffer) {
                    bytes += arg.byteLength;
                }
                else if (arg !== undefined) {
                    try {
                        bytes += JSON.stringify(arg).length;
                    }
                    catch {
                        bytes += 64;
                    }
                }
            }
            game.trackSocketBytes(bytes, 'in');
        }
    });
    // Track outgoing bytes by wrapping emit
    const originalEmit = game.socket.emit.bind(game.socket);
    game.socket.emit = (event, ...args) => {
        if (game.trackSocketBytes) {
            let bytes = event.length;
            for (const arg of args) {
                if (typeof arg === 'string') {
                    bytes += arg.length;
                }
                else if (arg instanceof ArrayBuffer) {
                    bytes += arg.byteLength;
                }
                else if (typeof arg === 'function') {
                    // callback, skip
                }
                else if (arg !== undefined) {
                    try {
                        bytes += JSON.stringify(arg).length;
                    }
                    catch {
                        bytes += 64;
                    }
                }
            }
            game.trackSocketBytes(bytes, 'out');
        }
        return originalEmit(event, ...args);
    };
    game.socket.on('connect', () => {
        const connectTime = performance.now();
        console.log(`[CLIENT] Socket connected with ID ${game.socket.id} at ${connectTime.toFixed(0)}`);
        // Hide disconnect message on reconnect
        game.hideDisconnectMessage();
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
                        if (!data.playerData.inventory || !Array.isArray(data.playerData.inventory)) {
                            data.playerData.inventory = [];
                            console.warn('[CLIENT] Transferred player had invalid inventory, initialized empty array');
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
                            inventory: data.playerData.inventory || [],
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
        else if (game._hasConnected) {
            // Reconnection after disconnect (e.g. server restart/build update)
            // Reload the page to get fresh client code and clean state
            console.log('[CLIENT] Reconnected after disconnect, reloading page...');
            window.location.reload();
            return;
        }
        else {
            // Initial connection (authentication handled by game.authenticate())
            // Update chat system to use new socket
            if (game.chat) {
                game.chat.updateSocket(game.socket);
            }
        }
        game._hasConnected = true;
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
            // Clear spinning state since we're transferring
            const transferPlayer = game.players.get(game.socket.id);
            if (transferPlayer) {
                transferPlayer.teleporterCharging = false;
                transferPlayer.teleporterChargeStart = undefined;
            }
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
            game.socket = (0, ws_client_1.io)(newServerUrl, {
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
        const player = game.players.get(data.playerId);
        const isCurrentPlayer = data.playerId === game.socket.id;
        if (isCurrentPlayer && player && game.graphics) {
            // Freeze the current frame and iris close over it
            const screenshot = game.graphics.captureScreenshot();
            game.graphics.startIrisClose(screenshot, () => {
                player.x = data.newX;
                player.y = data.newY;
                player.teleporterCharging = false;
                player.teleporterChargeStart = undefined;
                // Open iris to reveal new location
                game.graphics.startIrisTransition(null);
            });
        }
        else if (player) {
            // Other players just teleport instantly
            player.x = data.newX;
            player.y = data.newY;
        }
    });
    // Handle teleporter entry (player entered teleporter)
    game.socket.on('teleporterEntered', (data) => {
        console.log(`[CLIENT] Entered teleporter, waiting ${data.timeRequired}ms to teleport`);
        // Set spinning state on the current player
        const currentPlayer = game.players.get(game.socket.id);
        if (currentPlayer) {
            currentPlayer.teleporterCharging = true;
            currentPlayer.teleporterChargeStart = Date.now();
        }
    });
    // Handle teleporter exit (player left teleporter before teleporting)
    game.socket.on('teleporterExited', () => {
        console.log('[CLIENT] Left teleporter before teleporting');
        // Clear spinning state on the current player
        const currentPlayer = game.players.get(game.socket.id);
        if (currentPlayer) {
            currentPlayer.teleporterCharging = false;
            currentPlayer.teleporterChargeStart = undefined;
        }
    });
    // Handle player split event
    game.socket.on('playerSplit', (data) => {
        console.log(`[CLIENT] Player split: original=${data.originalId}, player1=${data.player1Id}, player2=${data.player2Id}`);
        // Set active player to player1 initially
        if (data.originalId === game.socket.id) {
            game.activePlayerId = data.player1Id;
        }
    });
    // Handle player switch event
    game.socket.on('playerSwitched', (data) => {
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
        // Update loadout display after player loadout and inventory is received
        if (game.socket.id && game.players.has(game.socket.id) && game.inventoryManager) {
            game.inventoryManager.updateLoadoutDisplay();
        }
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
        if (existingPlayer) {
            if (isCurrentPlayer) {
                // For current player, use smooth interpolation to server position
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
    game.socket.on('guildTagUpdate', (data) => {
        const player = game.players.get(data.id);
        if (!player)
            return;
        player.guildName = data.guildName || undefined;
    });
    game.socket.on('disconnect', (reason) => {
        const disconnectTime = performance.now();
        console.log(`[CLIENT] Disconnected from server at ${disconnectTime.toFixed(0)}, reason: ${reason}`);
        // Clear heartbeat monitoring
        if (game.heartbeatInterval) {
            clearInterval(game.heartbeatInterval);
            game.heartbeatInterval = null;
        }
        // Show disconnect message (but not during intentional transfers)
        if (!game.pendingTransfer) {
            game.showDisconnectMessage();
        }
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
        // Update connection quality for slow connection optimization
        if (game.updateConnectionQuality) {
            game.updateConnectionQuality(roundTripTime);
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
        // Only used on initial connection - update all enemies
        const serverEnemyIds = new Set(enemies.map(e => e.id));
        // Remove enemies that left the viewport - no death animation
        for (const [enemyId] of game.enemies) {
            if (!serverEnemyIds.has(enemyId)) {
                handleEnemyOutOfView(enemyId);
            }
        }
        // Update or add enemies - uses same path as all enemy updates
        enemies.forEach(enemy => {
            handleEnemyUpdate(enemy);
        });
    });
    game.socket.on('enemySpawned', (enemy) => {
        // Add newly spawned enemy - uses same path as all enemy updates
        handleEnemyUpdate(enemy);
    });
    game.socket.on('mobProjectilesUpdate', (projectiles) => {
        game.mobProjectiles.clear();
        projectiles.forEach(projectile => game.mobProjectiles.set(projectile.id, projectile));
    });
    game.socket.on('playerProjectilesUpdate', (projectiles) => {
        game.playerProjectiles.clear();
        projectiles.forEach(projectile => game.playerProjectiles.set(projectile.id, projectile));
    });
    game.socket.on('enemyMoved', (enemy) => {
        // Enemy movement update - uses same path as all enemy updates
        handleEnemyUpdate(enemy);
    });
    game.socket.on('playerDamaged', (data) => {
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
            // Use explicit damageDealt if provided, otherwise compute from health delta
            const damageTaken = data.damageDealt ?? (oldHealth - data.health);
            if (damageTaken > 0) {
                game.showFloatingText(player.x, player.y - 20, `-${Math.round(damageTaken)}`, '#FF0000', 20);
            }
        }
    });
    // Unified handler for enemy damage - all damage goes through the same path
    function handleEnemyDamage(data) {
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
    }
    // Unified handler for enemy updates - all enemy updates go through the same path
    function handleEnemyUpdate(enemy) {
        // If enemy is already in death animation, don't update it (let animation complete)
        const existingEnemy = game.enemies.get(enemy.id);
        if (existingEnemy && existingEnemy.deathAnimationStartTime) {
            const DEATH_ANIMATION_DURATION = 200; // Must match duration in graphics.ts
            const elapsed = Date.now() - existingEnemy.deathAnimationStartTime;
            if (elapsed < DEATH_ANIMATION_DURATION) {
                // Enemy is still animating, don't update it
                return;
            }
        }
        if (existingEnemy) {
            // Update existing enemy: set interpolation targets instead of snapping
            existingEnemy.targetX = enemy.x;
            existingEnemy.targetY = enemy.y;
            existingEnemy.targetAngle = enemy.angle;
            existingEnemy.health = enemy.health;
            existingEnemy.maxHealth = enemy.maxHealth;
            // Update other fields directly
            if (enemy.type)
                existingEnemy.type = enemy.type;
            if (enemy.tier)
                existingEnemy.tier = enemy.tier;
        }
        else {
            // New enemy: set position immediately (no interpolation on first appearance)
            enemy.targetX = enemy.x;
            enemy.targetY = enemy.y;
            enemy.targetAngle = enemy.angle;
            game.enemies.set(enemy.id, enemy);
        }
    }
    // Handler for enemy killed - plays death animation
    function handleEnemyRemoval(enemyId) {
        // Show any accumulated damage before cleaning up
        const enemy = game.enemies.get(enemyId);
        if (enemy) {
            // Only start death animation if it hasn't already started
            if (!enemy.deathAnimationStartTime) {
                const accumulated = game.graphics.getAccumulatedDamage(enemyId);
                if (accumulated > 0) {
                    // Show final accumulated damage
                    game.graphics.showFloatingText(enemy.x, enemy.y - 20, `-${Math.round(accumulated)}`, '#ff0000', 16);
                }
                // Start death animation instead of immediately removing
                enemy.deathAnimationStartTime = Date.now();
            }
        }
        // Clean up accumulated damage for this enemy
        game.graphics.clearEnemyDamage(enemyId);
        // Don't delete immediately - let the animation complete first
    }
    // Handler for enemy leaving viewport - no death animation
    function handleEnemyOutOfView(enemyId) {
        const enemy = game.enemies.get(enemyId);
        // Don't remove enemies mid-death-animation - let the animation finish
        if (enemy?.deathAnimationStartTime)
            return;
        game.graphics.clearEnemyDamage(enemyId);
        game.enemies.delete(enemyId);
    }
    game.socket.on('enemyDamaged', (data) => {
        // Legacy handler for single enemy damage - uses same path as batched
        handleEnemyDamage(data);
    });
    game.socket.on('enemiesDamaged', (damagedEnemies) => {
        // Batch handler for multiple enemy damage updates - uses same path
        for (const data of damagedEnemies) {
            handleEnemyDamage(data);
        }
    });
    game.socket.on('targetDummyDPS', (data) => {
        const enemy = game.enemies.get(data.enemyId);
        if (enemy && enemy.type === 'target_dummy') {
            enemy.currentDPS = data.dps;
        }
    });
    game.socket.on('enemyDestroyed', (enemyId) => {
        // Enemy removal - uses same path as all enemy removals
        handleEnemyRemoval(enemyId);
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
    const registerSpawnAnim = (item) => {
        if (!game.graphics.itemSpawnAnim) {
            game.graphics.itemSpawnAnim = new Map();
        }
        game.graphics.itemSpawnAnim.set(item.id, {
            angle: Math.random() * Math.PI * 2,
            distance: 30 + Math.random() * 20,
            rotation: (Math.random() - 0.5) * Math.PI * 2,
            startTime: Date.now()
        });
    };
    game.socket.on('itemSpawned', (item) => {
        // Legacy handler for single item spawn (kept for backwards compatibility)
        game.items.set(item.id, item);
        registerSpawnAnim(item);
        if (item.rarity) {
            game.graphics.showItemDropBurst(item.x, item.y, item.rarity);
        }
    });
    game.socket.on('itemsSpawned', (items) => {
        // Batch handler for multiple item spawns
        for (const item of items) {
            game.items.set(item.id, item);
            registerSpawnAnim(item);
            if (item.rarity) {
                game.graphics.showItemDropBurst(item.x, item.y, item.rarity);
            }
        }
    });
    // Petal action event handlers
    game.socket.on('playerHealed', (data) => {
        const player = game.players.get(data.playerId);
        if (player) {
            const oldHealth = player.health;
            player.health = data.health;
            // Show healing effect
            if (data.healAmount > 0) {
                const roundedHeal = Math.round(data.healAmount * 10) / 10;
                const formattedHeal = roundedHeal % 1 === 0 ? roundedHeal.toString() : roundedHeal.toFixed(1);
                game.showFloatingText(player.x, player.y - 20, `+${formattedHeal}`, '#00FF00', 20);
            }
        }
    });
    game.socket.on('petalExplosion', (data) => {
        // Show explosion effect
        game.showExplosionEffect(data.x, data.y, data.radius);
    });
    // Debounce loadout UI updates to prevent multiple DOM re-renders when many petals break/restore at once
    let loadoutUpdateTimeout = null;
    function scheduleLoadoutUIUpdate() {
        if (loadoutUpdateTimeout)
            return;
        loadoutUpdateTimeout = setTimeout(() => {
            loadoutUpdateTimeout = null;
            if (game.isInventoryOpen) {
                game.updateInventoryDisplay();
            }
            if (game.inventoryManager) {
                game.inventoryManager.updateLoadoutDisplay();
            }
        }, 50);
    }
    game.socket.on('petalBroken', (data) => {
        const player = game.players.get(data.playerId);
        if (player && player.loadout && player.loadout[data.slotIndex]) {
            player.loadout[data.slotIndex].health = 0;
            player.loadout[data.slotIndex].onCooldown = true;
            game.showPetalBreakEffect(player.x, player.y, data.petalType);
            if (data.playerId === game.socket.id) {
                scheduleLoadoutUIUpdate();
            }
        }
    });
    game.socket.on('petalRestored', (data) => {
        const player = game.players.get(data.playerId);
        if (player && player.loadout) {
            player.loadout[data.slotIndex] = data.petal;
            if (data.playerId === game.socket.id) {
                scheduleLoadoutUIUpdate();
            }
        }
    });
    const PICKUP_ANIM_MS = 150;
    const DESPAWN_ANIM_MS = 300;
    const registerPickupAnim = (itemId, playerId) => {
        const item = game.items.get(itemId);
        if (!item)
            return;
        if (!game.graphics.itemDeathAnim) {
            game.graphics.itemDeathAnim = new Map();
        }
        if (game.graphics.itemDeathAnim.has(itemId))
            return; // already animating
        game.graphics.itemDeathAnim.set(itemId, {
            type: 'pickup',
            targetPlayerId: playerId,
            startX: item.x,
            startY: item.y,
            startTime: Date.now()
        });
        setTimeout(() => {
            game.items.delete(itemId);
            game.graphics.itemDeathAnim?.delete(itemId);
            if (game.pickedUpItems)
                game.pickedUpItems.delete(itemId);
        }, PICKUP_ANIM_MS);
    };
    const registerDespawnAnim = (itemId) => {
        const item = game.items.get(itemId);
        if (!item)
            return;
        if (!game.graphics.itemDeathAnim) {
            game.graphics.itemDeathAnim = new Map();
        }
        if (game.graphics.itemDeathAnim.has(itemId))
            return; // already animating (e.g. pickup)
        game.graphics.itemDeathAnim.set(itemId, {
            type: 'despawn',
            startX: item.x,
            startY: item.y,
            startTime: Date.now()
        });
        setTimeout(() => {
            game.items.delete(itemId);
            game.graphics.itemDeathAnim?.delete(itemId);
            if (game.pickedUpItems)
                game.pickedUpItems.delete(itemId);
        }, DESPAWN_ANIM_MS);
    };
    game.socket.on('itemPickedUp', (itemId) => {
        // Local player picked up this item — animate toward them
        registerPickupAnim(itemId, game.socket?.id);
    });
    game.socket.on('itemRemoved', (itemId) => {
        // If not already animating (e.g. pickup), show despawn animation
        registerDespawnAnim(itemId);
    });
    game.socket.on('itemCollected', (data) => {
        const player = game.players.get(data.playerId);
        if (player) {
            registerPickupAnim(data.itemId, data.playerId);
            if (data.playerId === game.socket.id) {
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
    // Debounce mob gallery updates to prevent lag when multiple mobs die
    let mobGalleryUpdateTimeout = null;
    game.socket.on('playerUpdated', (updatedPlayer) => {
        // console.log('[MobGallery] Received playerUpdated event', {
        //     playerId: updatedPlayer.id,
        //     hasMobKills: !!updatedPlayer.mobKills,
        //     mobKills: updatedPlayer.mobKills
        // });
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
        }
        else {
            let loadoutChanged = false;
            let inventoryChanged = false;
            let mobKillsChanged = false;
            if (updatedPlayer.id === game.socket?.id) {
                // Use reference check - server always sends new objects when data changes
                loadoutChanged = updatedPlayer.loadout !== undefined && player.loadout !== updatedPlayer.loadout;
                inventoryChanged = updatedPlayer.inventory !== undefined && player.inventory !== updatedPlayer.inventory;
                mobKillsChanged = updatedPlayer.mobKills !== undefined && player.mobKills !== updatedPlayer.mobKills;
            }
            // Set position as interpolation targets to avoid camera jitter
            const prevX = player.x;
            const prevY = player.y;
            const newX = updatedPlayer.x;
            const newY = updatedPlayer.y;
            Object.assign(player, updatedPlayer);
            // Restore interpolated position, update targets
            if (newX !== undefined && newY !== undefined) {
                player.x = prevX;
                player.y = prevY;
                player.targetX = newX;
                player.targetY = newY;
            }
            // Update displays if this is the current player
            if (updatedPlayer.id === game.socket?.id) {
                if (game.isInventoryOpen && inventoryChanged) {
                    game.updateInventoryDisplay();
                }
                // Only update loadout display if loadout actually changed
                if (game.inventoryManager && loadoutChanged) {
                    game.inventoryManager.updateLoadoutDisplay();
                }
                // Show notification when mobs are killed while gallery is open
                if (game.inventoryManager && mobKillsChanged) {
                    // console.log('[MobGallery] Calling updateMobGalleryIfOpen, isOpen:', game.inventoryManager.getIsMobGalleryOpen());
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
    game.socket.on('skillsUpdated', (data) => {
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
    game.socket.on('speedBoostActive', (playerId) => {
        if (playerId === game.socket.id) {
            game.speedBoostActive = true;
        }
    });
    game.socket.on('savePlayerProgress', () => {
        game.showSaveIndicator();
    });
    game.socket.on('craftingFinished', (data) => {
        console.log('[CLIENT] craftingFinished received:', data);
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            player.inventory = data.inventory;
            if (game.inventoryManager.isCraftingOpen) {
                // Parse item type and petalType from itemKey
                const itemKey = data.newItem.type;
                let itemType = 'petal';
                let petalType;
                if (itemKey.startsWith('petal_')) {
                    itemType = 'petal';
                    petalType = itemKey.substring(6);
                }
                else {
                    itemType = itemKey;
                }
                const displayItem = {
                    type: itemType,
                    rarity: data.newItem.rarity,
                    petalType: petalType
                };
                game.inventoryManager.showCraftingSuccess(displayItem, data.successCount, data.petalsReturned || 0);
            }
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
    game.socket.on('craftingFailed', (message) => {
        console.log('[CLIENT] craftingFailed received:', message);
        game.showFloatingText(game.canvas.width / 2, 50, `Crafting failed: ${message}`, '#FF0000', 20);
        if (game.inventoryManager.isCraftingOpen) {
            game.inventoryManager.updateCraftingDisplay();
        }
    });
    // Shop handlers
    game.socket.on('shopPurchaseSuccess', (data) => {
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
    game.socket.on('shopPurchaseError', (message) => {
        console.log('[CLIENT] shopPurchaseError received:', message);
        if (game.shopManager) {
            game.shopManager.handlePurchaseError(message);
        }
    });
    game.socket.on('codeRedeemSuccess', (data) => {
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
    game.socket.on('codeRedeemError', (message) => {
        console.log('[CLIENT] codeRedeemError received:', message);
        if (game.shopManager) {
            game.shopManager.handleCodeRedeemError(message);
        }
    });
    game.socket.on('starsEarned', (data) => {
        console.log('[CLIENT] starsEarned received:', data);
        // Update player stars
        const player = game.getLocalPlayer();
        if (player) {
            player.stars = data.total;
            // Show floating text
            game.showFloatingText(game.canvas.width / 2, game.canvas.height / 2, `+${data.amount} ⭐ Stars!`, '#ffd700', 24);
        }
        // Update shop display (including challenges tab if open)
        if (game.shopManager) {
            game.shopManager.updateStarsDisplay();
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
                // Sync face/equipment flags and mouth (skip if locally forced)
                if (!existingPlayer.forcedFlags) {
                    existingPlayer.faceFlags = serverPlayer.faceFlags || 0;
                    existingPlayer.equipFlags = serverPlayer.equipFlags || 0;
                    if ('mouth' in serverPlayer) {
                        existingPlayer.mouth = serverPlayer.mouth;
                    }
                }
                // Sync petal extension from server (if available in gameStateUpdate)
                if ('petalExtension' in serverPlayer) {
                    existingPlayer.petalExtension = serverPlayer.petalExtension || 1.0;
                }
                // Sync petal positions from server for interpolation
                if ('petalPositions' in serverPlayer && Array.isArray(serverPlayer.petalPositions)) {
                    const serverPetalPositions = serverPlayer.petalPositions;
                    if (!existingPlayer.petalPositions) {
                        // Initialize with current positions
                        existingPlayer.petalPositions = serverPetalPositions.map((pos) => ({
                            ...pos,
                            targetX: pos.x,
                            targetY: pos.y
                        }));
                    }
                    else {
                        // Update target positions for interpolation
                        serverPetalPositions.forEach((serverPos) => {
                            const existingPos = existingPlayer.petalPositions.find((p) => p.loadoutIndex === serverPos.loadoutIndex && p.instanceIndex === serverPos.instanceIndex);
                            if (existingPos) {
                                existingPos.targetX = serverPos.x;
                                existingPos.targetY = serverPos.y;
                                existingPos.noPhysics = serverPos.noPhysics;
                            }
                            else {
                                // New petal position
                                existingPlayer.petalPositions.push({
                                    ...serverPos,
                                    targetX: serverPos.x,
                                    targetY: serverPos.y
                                });
                            }
                        });
                        // Remove positions that no longer exist
                        existingPlayer.petalPositions = existingPlayer.petalPositions.filter((pos) => serverPetalPositions.some((sp) => sp.loadoutIndex === pos.loadoutIndex && sp.instanceIndex === pos.instanceIndex));
                    }
                }
                // Preserve XP values - don't overwrite them from gameStateUpdate
                // as they are managed separately by xpGained events
            }
            else {
                const newPlayer = {
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
                    newPlayer.petalExtension = serverPlayer.petalExtension || 1.0;
                }
                // Initialize petal positions if available
                if ('petalPositions' in serverPlayer && Array.isArray(serverPlayer.petalPositions)) {
                    newPlayer.petalPositions = serverPlayer.petalPositions.map((pos) => ({
                        ...pos,
                        targetX: pos.x,
                        targetY: pos.y
                    }));
                }
                game.players.set(serverPlayer.id, newPlayer);
            }
        });
        if (serverEnemies) {
            // Build set of all enemy IDs still in viewport (changed + unchanged)
            const serverEnemyIds = new Set(serverEnemies.map((e) => e.id));
            if (data.unchanged) {
                for (const id of data.unchanged) {
                    serverEnemyIds.add(id);
                }
            }
            // Remove enemies that left the viewport - no death animation
            for (const [enemyId] of game.enemies) {
                if (!serverEnemyIds.has(enemyId)) {
                    handleEnemyOutOfView(enemyId);
                }
            }
            // Update or add enemies that changed - unchanged ones keep their current state
            serverEnemies.forEach((enemy) => {
                handleEnemyUpdate(enemy);
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
                // Suppress stale server-driven loadout/inventory overwrites during in-flight
                // optimistic updates (swaps, drops, etc.) that haven't been round-tripped yet.
                const inv = game.inventoryManager;
                const suppressMs = inv?.LOADOUT_SYNC_SUPPRESS_MS ?? 0;
                const lastLocal = inv?.lastLocalLoadoutChange ?? 0;
                const isLocal = serverPlayer.id === game.socket?.id;
                const suppress = isLocal && Date.now() - lastLocal < suppressMs;
                if (!suppress) {
                    player.inventory = serverPlayer.inventory;
                    player.loadout = padLoadout(serverPlayer.loadout, 20);
                }
                else {
                    // Still overlay server-side per-petal state (cooldowns, health) onto matching
                    // client slots so cooldown animations tick correctly while we hold the swap.
                    const serverPad = padLoadout(serverPlayer.loadout, 20);
                    for (let i = 0; i < player.loadout.length && i < serverPad.length; i++) {
                        const local = player.loadout[i];
                        const remote = serverPad[i];
                        if (local && remote &&
                            local.type === remote.type &&
                            local.rarity === remote.rarity &&
                            (local.type !== 'petal' || local.petalType === remote.petalType)) {
                            local.health = remote.health;
                            local.maxHealth = remote.maxHealth;
                            local.onCooldown = remote.onCooldown;
                        }
                    }
                }
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
                // Update mobKills if it changed (use reference check - server sends new objects)
                if (serverPlayer.mobKills !== undefined) {
                    const mobKillsChanged = player.mobKills !== serverPlayer.mobKills;
                    player.mobKills = serverPlayer.mobKills;
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
                player.loadout = padLoadout(serverPlayer.loadout, 20);
                player.image.src = 'assets/player.png';
                player.image.onload = () => {
                    player.imageLoaded = true;
                };
                game.players.set(serverPlayer.id, player);
            }
        });
    });
    game.socket.on('updateEnemies', (serverEnemies) => {
        // Clear all enemies first - full refresh, no death animation
        for (const [enemyId] of game.enemies) {
            handleEnemyOutOfView(enemyId);
        }
        // Add all enemies - uses same path as all enemy updates
        serverEnemies.forEach(enemy => {
            handleEnemyUpdate(enemy);
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
