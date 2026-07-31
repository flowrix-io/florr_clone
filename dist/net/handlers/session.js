"use strict";
/**
 * Connection lifecycle and player identity.
 *
 * Connect/disconnect, heartbeat, cross-server transfer, teleporters, and the
 * splitter petal's two-flower bookkeeping — everything about *which* socket and
 * *which* flower this client is, before any world state arrives.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSessionHandlers = registerSessionHandlers;
const player_skins_1 = require("../../graphics/player-skins");
const maze_1 = require("../../maze");
const ws_client_1 = require("../../ws_client");
const playerRefs_1 = require("../playerRefs");
/**
 * @param reRegisterAll Re-attaches every handler group to a fresh socket. A
 * cross-server transfer swaps game.socket wholesale, so the new socket needs
 * the full listener set re-bound. Passed in rather than imported to keep this
 * module free of a cycle back through the registration barrel.
 */
function registerSessionHandlers(game, reRegisterAll) {
    // Per-event wire-byte counters now live on the WSClientSocket wrapper (see
    // ws_client.ts getEventStats). The wrapper records true encoded byte sizes,
    // so we no longer need the old JSON-stringify estimator here.
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
            game.socket = (0, ws_client_1.io)(newServerUrl);
            // Store transfer data for claiming after reconnect
            game.pendingTransfer = {
                transferToken: transferData.transferToken,
                targetX: transferData.targetX,
                targetY: transferData.targetY,
                newServerUrl: newServerUrl
            };
            // Set up listeners for new connection (this will handle the connect event)
            reRegisterAll(game);
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
    // Daily maze descriptor: build the identical maze locally from the day
    // number (shared generator), so wall rendering and movement prediction
    // resolve exactly what the server resolves. Re-sent on daily rotation.
    game.socket.on('mazeInfo', (data) => {
        if (typeof data?.day !== 'number')
            return;
        const maze = (0, maze_1.setActiveMazeDay)(data.day);
        console.log(`[CLIENT] Maze day ${maze.dayNumber} (${maze.biome})`);
    });
    // Handle same-server teleportation
    game.socket.on('playerTeleported', (data) => {
        console.log(`[CLIENT] Player ${data.playerId} teleported to (${data.newX}, ${data.newY})`);
        const player = game.players.get(data.playerId);
        const isCurrentPlayer = (0, playerRefs_1.isLocalPlayerId)(game, data.playerId);
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
        const currentPlayer = (0, playerRefs_1.localPlayer)(game);
        if (currentPlayer) {
            currentPlayer.teleporterCharging = true;
            currentPlayer.teleporterChargeStart = Date.now();
        }
    });
    // Handle teleporter exit (player left teleporter before teleporting)
    game.socket.on('teleporterExited', () => {
        console.log('[CLIENT] Left teleporter before teleporting');
        // Clear spinning state on the current player
        const currentPlayer = (0, playerRefs_1.localPlayer)(game);
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
            // The camera just jumped to the other flower, so everything keyed to
            // "the half I'm driving" has to follow it in the same frame: the
            // death overlay belongs to the half that died, and the loadout bar
            // renders the active half's petals (the two halves carry separate
            // loadouts).
            const active = game.players.get(data.activePlayerId);
            if (active) {
                if (active.isDead && !game.isPlayerDead) {
                    game.isPlayerDead = true;
                    game.showDeathScreen(active.killedBy);
                }
                else if (!active.isDead && game.isPlayerDead) {
                    game.isPlayerDead = false;
                    game.hideDeathScreen();
                }
            }
            game.inventoryManager?.updateLoadoutDisplay();
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
    });
    game.socket.on('currentPlayers', (players) => {
        //console.log('Received current players:', players);
        game.players.clear();
        Object.values(players).forEach(player => {
            // Don't override health with max health
            game.players.set(player.id, (0, playerRefs_1.withoutRawPetalPositions)({
                ...player,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0
            }));
        });
        // Update loadout display after player loadout and inventory is received
        if (game.socket.id && game.players.has(game.socket.id) && game.inventoryManager) {
            game.inventoryManager.updateLoadoutDisplay();
        }
    });
    game.socket.on('newPlayer', (player) => {
        //console.log('New player joined:', player);
        game.players.set(player.id, (0, playerRefs_1.withoutRawPetalPositions)({
            ...player,
            imageLoaded: true,
            score: 0,
            velocityX: 0,
            velocityY: 0
        }));
        if (player.id === game.socket.id && game.inventoryManager) {
            game.inventoryManager.updateLoadoutDisplay();
        }
    });
    game.socket.on('playerMoved', (player) => {
        const now = performance.now();
        game.lastHeartbeat = now; // Update heartbeat on any server message
        const existingPlayer = game.players.get(player.id);
        if (existingPlayer) {
            // Positions are targets only — game.ts eases every flower (local and
            // remote) toward them at the same rate. (This handler is dead anyway:
            // the server never emits 'playerMoved'; gameStateUpdate carries P.)
            existingPlayer.targetX = player.x;
            existingPlayer.targetY = player.y;
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
            game.players.set(player.id, (0, playerRefs_1.withoutRawPetalPositions)({
                ...player,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                targetX: player.x,
                targetY: player.y
            }));
        }
    });
    game.socket.on('guildTagUpdate', (data) => {
        const player = game.players.get(data.id);
        if (!player)
            return;
        player.guildName = data.guildName || undefined;
    });
    // Guild menu lifecycle events. Registered here (not inside GuildMenuManager)
    // so they stay wired to whatever socket instance the game is actually using.
    game.socket.on('guildUpdate', (data) => {
        const menu = window.currentGame?.guildMenu;
        if (!menu)
            return;
        menu.applyGuildUpdate(data);
    });
    game.socket.on('guildInviteReceived', (data) => {
        const menu = window.currentGame?.guildMenu;
        if (!menu)
            return;
        menu.applyInviteReceived(data);
    });
    // Custom skins: keep the shared client registry in sync (so any player wearing
    // a skin renders) and refresh the Skin Studio gallery if it's open.
    game.socket.on('skinsUpdate', (data) => {
        (0, player_skins_1.setCustomSkins)(data?.skins);
        window.currentGame?.skinStudio?.applyCatalog(data?.skins || [], !!data?.isAdmin);
    });
    game.socket.on('skinPublished', (skin) => {
        (0, player_skins_1.upsertCustomSkin)(skin);
        window.currentGame?.skinStudio?.applySkinPublished(skin);
    });
    game.socket.on('skinDeleted', (id) => {
        (0, player_skins_1.removeCustomSkin)(id);
        window.currentGame?.skinStudio?.applySkinDeleted(id);
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
}
