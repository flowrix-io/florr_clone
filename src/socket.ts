import { io, Socket } from './ws_client';
import { Player, ServerPlayer } from './player';
import { Enemy, Obstacle } from './enemy';
import { Item, WorldItem } from './item';
import { getMobStats } from './mobs';
import { setCustomSkins, upsertCustomSkin, removeCustomSkin } from './graphics/player-skins';
import { CustomSkin } from './skin_format';
import { setActiveMazeDay } from './maze';

function padLoadout(arr: (Item | null)[] | undefined, size: number): (Item | null)[] {
    const out: (Item | null)[] = new Array(size).fill(null);
    if (arr) for (let i = 0; i < Math.min(arr.length, size); i++) out[i] = arr[i] || null;
    return out;
}

// Full-player broadcasts (currentPlayers, newPlayer, updatePlayers, transfers)
// spread the whole server player object, which carries that tick's raw
// petalPositions: absolute coords with no per-petal interpolation targets, and —
// for a flower outside the recipient's petal-detail range — never refreshed
// again. Rendering those would pin the ring to coords the flower has since moved
// away from. The gameStateUpdate `p` channel is the only valid source, so drop
// the raw array at ingestion and let that channel (re)build it.
function withoutRawPetalPositions<T extends { petalPositions?: any }>(player: T): T {
    if (player.petalPositions) player.petalPositions = undefined;
    return player;
}

// After the splitter petal runs, this client owns two flowers — `socket.id` and
// `${socket.id}_split2` — but drives only one at a time (`game.activePlayerId`,
// flipped by the server's `playerSwitched`). The camera, prediction, inventory
// panel and loadout bar all follow that ACTIVE half (game.getLocalPlayer()), so
// every "is this me?" event check has to as well. Comparing against
// `socket.id` alone answered for the abandoned half: the death screen never
// appeared when the clone died, its broken petals never refreshed the loadout
// bar, and shop/inventory updates landed on a player object nothing rendered.
function localPlayerId(game: any): string {
    return game.activePlayerId || game.socket?.id || '';
}

function localPlayer(game: any): Player | undefined {
    return game.players.get(localPlayerId(game));
}

// True for the half currently being driven — use for camera/UI/death state.
function isLocalPlayerId(game: any, id: string | undefined): boolean {
    return !!id && id === localPlayerId(game);
}

// True for EITHER half — use for things that belong to the account rather than
// to the flower on screen (loot eligibility, shared inventory, pickup anims).
function isOwnPlayerId(game: any, id: string | undefined): boolean {
    if (!id) return false;
    const socketId = game.socket?.id;
    if (!socketId) return false;
    return id === socketId || id === game.activePlayerId || id === `${socketId}_split2`;
}

// Run `fn` on every flower this client owns. Account-wide state (inventory,
// stars) is ONE object shared by both halves on the server, so applying a
// snapshot to a single half leaves the other showing a stale bag the moment
// the player switches.
function forEachOwnPlayer(game: any, fn: (player: any) => void): void {
    const socketId = game.socket?.id;
    if (!socketId) return;
    const seen = new Set<string>();
    for (const id of [socketId, game.activePlayerId, `${socketId}_split2`]) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const p = game.players.get(id);
        if (p) fn(p);
    }
}

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
        
        game.socket = io(serverUrl);

        game.socket.on('connect', () => {
            const connectTime = performance.now();
            console.log(`[CLIENT] Connected to server at ${connectTime.toFixed(0)}`);
            // Remove connecting message when connected
            const connectingDiv = document.getElementById('connectingDiv');
            if (connectingDiv) {
                connectingDiv.remove();
            }
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

function setupSocketListeners(game: any) {
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
                } else {
                    console.error('[CLIENT] Failed to claim transferred player:', data.message);
                    game.showTransferMessage('Transfer failed. Please try again.');
                }
            })
            .catch(error => {
                console.error('[CLIENT] Error claiming transferred player:', error);
                game.showTransferMessage('Transfer failed. Please try again.');
            });
        } else if (game._hasConnected) {
            // Reconnection after disconnect (e.g. server restart/build update)
            // Reload the page to get fresh client code and clean state
            console.log('[CLIENT] Reconnected after disconnect, reloading page...');
            window.location.reload();
            return;
        } else {
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
    game.socket.on('playerTransferred', async (transferData: any) => {
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
            game.socket = io(newServerUrl);
            
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

    // Daily maze descriptor: build the identical maze locally from the day
    // number (shared generator), so wall rendering and movement prediction
    // resolve exactly what the server resolves. Re-sent on daily rotation.
    game.socket.on('mazeInfo', (data: { day: number; biome?: string }) => {
        if (typeof data?.day !== 'number') return;
        const maze = setActiveMazeDay(data.day);
        console.log(`[CLIENT] Maze day ${maze.dayNumber} (${maze.biome})`);
    });

    // Handle same-server teleportation
    game.socket.on('playerTeleported', (data: any) => {
        console.log(`[CLIENT] Player ${data.playerId} teleported to (${data.newX}, ${data.newY})`);

        const player = game.players.get(data.playerId);
        const isCurrentPlayer = isLocalPlayerId(game, data.playerId);

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
        } else if (player) {
            // Other players just teleport instantly
            player.x = data.newX;
            player.y = data.newY;
        }
    });

    // Handle teleporter entry (player entered teleporter)
    game.socket.on('teleporterEntered', (data: any) => {
        console.log(`[CLIENT] Entered teleporter, waiting ${data.timeRequired}ms to teleport`);

        // Set spinning state on the current player
        const currentPlayer = localPlayer(game);
        if (currentPlayer) {
            currentPlayer.teleporterCharging = true;
            currentPlayer.teleporterChargeStart = Date.now();
        }
    });

    // Handle teleporter exit (player left teleporter before teleporting)
    game.socket.on('teleporterExited', () => {
        console.log('[CLIENT] Left teleporter before teleporting');

        // Clear spinning state on the current player
        const currentPlayer = localPlayer(game);
        if (currentPlayer) {
            currentPlayer.teleporterCharging = false;
            currentPlayer.teleporterChargeStart = undefined;
        }
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
                } else if (!active.isDead && game.isPlayerDead) {
                    game.isPlayerDead = false;
                    game.hideDeathScreen();
                }
            }
            game.inventoryManager?.updateLoadoutDisplay();
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
    });

    game.socket.on('currentPlayers', (players: Record<string, Player>) => {
        //console.log('Received current players:', players);
        game.players.clear();
        Object.values(players).forEach(player => {
            // Don't override health with max health
            game.players.set(player.id, withoutRawPetalPositions({
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

    game.socket.on('newPlayer', (player: Player) => {
        //console.log('New player joined:', player);
        game.players.set(player.id, withoutRawPetalPositions({
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

    game.socket.on('playerMoved', (player: Player) => {
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
        } else {
            game.players.set(player.id, withoutRawPetalPositions({
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

    game.socket.on('guildTagUpdate', (data: { id: string; guildName: string | null }) => {
        const player = game.players.get(data.id);
        if (!player) return;
        player.guildName = data.guildName || undefined;
    });

    // Guild menu lifecycle events. Registered here (not inside GuildMenuManager)
    // so they stay wired to whatever socket instance the game is actually using.
    game.socket.on('guildUpdate', (data: any) => {
        const menu = (window as any).currentGame?.guildMenu;
        if (!menu) return;
        menu.applyGuildUpdate(data);
    });
    game.socket.on('guildInviteReceived', (data: { guildName: string; fromUsername: string }) => {
        const menu = (window as any).currentGame?.guildMenu;
        if (!menu) return;
        menu.applyInviteReceived(data);
    });

    // Custom skins: keep the shared client registry in sync (so any player wearing
    // a skin renders) and refresh the Skin Studio gallery if it's open.
    game.socket.on('skinsUpdate', (data: { skins: CustomSkin[]; isAdmin?: boolean }) => {
        setCustomSkins(data?.skins);
        (window as any).currentGame?.skinStudio?.applyCatalog(data?.skins || [], !!data?.isAdmin);
    });
    game.socket.on('skinPublished', (skin: CustomSkin) => {
        upsertCustomSkin(skin);
        (window as any).currentGame?.skinStudio?.applySkinPublished(skin);
    });
    game.socket.on('skinDeleted', (id: string) => {
        removeCustomSkin(id);
        (window as any).currentGame?.skinStudio?.applySkinDeleted(id);
    });

    game.socket.on('disconnect', (reason: string) => {
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

    game.socket.on('pong', (serverTime: number) => {
        const now = performance.now();
        const roundTripTime = now - serverTime;
        game.lastHeartbeat = now;
        if (roundTripTime < 1000) { // Only log normal pings, not catch-up ones
            console.log(`[CLIENT] Ping: ${roundTripTime.toFixed(1)}ms`);
        } else {
            console.log(`[CLIENT] High ping detected: ${roundTripTime.toFixed(1)}ms`);
        }
        
        // Update connection quality for slow connection optimization
        if (game.updateConnectionQuality) {
            game.updateConnectionQuality(roundTripTime);
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

    game.socket.on('enemySpawned', (enemy: Enemy) => {
        // Add newly spawned enemy - uses same path as all enemy updates
        handleEnemyUpdate(enemy);
    });

    // Delta projectile protocol — see server.ts updateMobProjectiles for the wire format.
    // The client adds projectiles on mpSpawn / ppSpawn, removes them on mpRemove /
    // ppRemove, and dead-reckons positions each frame in Game.update() using the
    // angle/speed stored on the projectile. No periodic re-sync: straight-line motion
    // is deterministic, and sync packets only ever caused stutter under latency jitter.
    const expandSpawn = (s: any) => ({
        id: s.i,
        x: s.x,
        y: s.y,
        angle: s.a,
        speed: s.s,
        distance: 0,
        maxDistance: s.mD,
        petalType: s.pT,
        petalRarity: s.pR,
        size: s.sz,
        _lastClientTickMs: performance.now()
    });

    game.socket.on('mpSpawn', (spawned: any[]) => {
        const nowMs = performance.now();
        for (const s of spawned) {
            const proj = expandSpawn(s);
            proj._lastClientTickMs = nowMs;
            game.mobProjectiles.set(proj.id, proj);
        }
    });
    game.socket.on('mpRemove', (ids: number[]) => {
        for (const id of ids) game.mobProjectiles.delete(id);
    });

    game.socket.on('ppSpawn', (spawned: any[]) => {
        const nowMs = performance.now();
        for (const s of spawned) {
            const proj = expandSpawn(s);
            proj._lastClientTickMs = nowMs;
            game.playerProjectiles.set(proj.id, proj);
        }
    });
    game.socket.on('ppRemove', (ids: number[]) => {
        for (const id of ids) game.playerProjectiles.delete(id);
    });

    game.socket.on('groundPollenSpawned', (pollen: any) => {
        game.groundPollens.set(pollen.id, {
            ...pollen,
            spawnedAt: Date.now()
        });
    });

    game.socket.on('groundPollenRemoved', (id: string) => {
        game.groundPollens.delete(id);
    });

    game.socket.on('enemyMoved', (enemy: Enemy) => {
        // Enemy movement update - uses same path as all enemy updates
        handleEnemyUpdate(enemy);
    });

    game.socket.on('playerDamaged', (data: {
        playerId: string,
        health: number,
        maxHealth: number,
        isInvulnerable?: boolean,
        knockbackX?: number,
        knockbackY?: number,
        damageDealt?: number
    }) => {
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
                game.showFloatingText(
                    player.x,
                    player.y - 20,
                    `-${Math.round(damageTaken)}`,
                    '#FF0000',
                    20
                );
            }
        }
    });

    // Unified handler for enemy damage - all damage goes through the same path
    function handleEnemyDamage(data: { enemyId: string, health: number }) {
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

    // Unified handler for enemy updates - all enemy updates go through the same path.
    // snapTimeMs is the de-jittered server-mapped timestamp for interpolation
    // snapshots (see gameStateUpdate); legacy callers omit it and get arrival time.
    function handleEnemyUpdate(enemy: Enemy, snapTimeMs?: number) {
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
            const sNow = snapTimeMs ?? performance.now();
            if (!existingEnemy._snapshots) existingEnemy._snapshots = [];
            const buf = existingEnemy._snapshots;
            // Keep the buffer monotonic even across a clock-offset re-anchor.
            const t = buf.length > 0 && sNow <= buf[buf.length - 1].t ? buf[buf.length - 1].t + 1 : sNow;
            buf.push({ t, x: enemy.x, y: enemy.y, angle: enemy.angle });
            if (buf.length > 12) buf.shift();
            existingEnemy.health = enemy.health;
            existingEnemy.maxHealth = enemy.maxHealth;
            // Update other fields directly
            if (enemy.type) existingEnemy.type = enemy.type;
            if (enemy.tier) existingEnemy.tier = enemy.tier;
        } else {
            // New enemy: set position immediately (no interpolation on first appearance)
            enemy.targetX = enemy.x;
            enemy.targetY = enemy.y;
            enemy.targetAngle = enemy.angle;
            game.enemies.set(enemy.id, enemy);
        }
    }

    // Handler for enemy killed - plays death animation
    function handleEnemyRemoval(enemyId: string) {
        // Show any accumulated damage before cleaning up
        const enemy = game.enemies.get(enemyId);
        if (enemy) {
            // Only start death animation if it hasn't already started
            if (!enemy.deathAnimationStartTime) {
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

                // Start death animation instead of immediately removing
                enemy.deathAnimationStartTime = Date.now();
            }
        }

        // Clean up accumulated damage for this enemy
        game.graphics.clearEnemyDamage(enemyId);
        // Don't delete immediately - let the animation complete first
    }

    // Handler for enemy leaving viewport - no death animation
    function handleEnemyOutOfView(enemyId: string) {
        const enemy = game.enemies.get(enemyId);
        // Don't remove enemies mid-death-animation - let the animation finish
        if (enemy?.deathAnimationStartTime) return;
        game.graphics.clearEnemyDamage(enemyId);
        game.enemies.delete(enemyId);
    }

    game.socket.on('enemyDamaged', (data: { enemyId: string, health: number }) => {
        // Legacy handler for single enemy damage - uses same path as batched
        handleEnemyDamage(data);
    });

    game.socket.on('enemiesDamaged', (damagedEnemies: Array<{ enemyId: string, health: number }>) => {
        // Batch handler for multiple enemy damage updates - uses same path
        for (const data of damagedEnemies) {
            handleEnemyDamage(data);
        }
    });

    game.socket.on('targetDummyDPS', (data: { enemyId: string, dps: number }) => {
        const enemy = game.enemies.get(data.enemyId);
        if (enemy && enemy.type === 'target_dummy') {
            enemy.currentDPS = data.dps;
        }
    });

    game.socket.on('enemyDestroyed', (enemyId: string) => {
        // Enemy removal - uses same path as all enemy removals
        handleEnemyRemoval(enemyId);
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
        // This full replace is also the server's drop-recovery payload (a
        // spawn/remove frame to us was discarded under backpressure). Clear
        // animation entries for items that no longer exist — their items are
        // gone from the map, so they'd linger in these Maps forever.
        game.graphics.itemSpawnAnim?.forEach((_: any, id: string) => {
            if (!game.items.has(id)) game.graphics.itemSpawnAnim!.delete(id);
        });
        game.graphics.itemDeathAnim?.forEach((_: any, id: string) => {
            if (!game.items.has(id)) game.graphics.itemDeathAnim!.delete(id);
        });
    });

    const registerSpawnAnim = (item: WorldItem) => {
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

    game.socket.on('itemSpawned', (item: WorldItem) => {
        // Legacy handler for single item spawn (kept for backwards compatibility)
        game.items.set(item.id, item);
        registerSpawnAnim(item);
        if (item.rarity) {
            game.graphics.showItemDropBurst(item.x, item.y, item.rarity);
        }
    });

    game.socket.on('itemsSpawned', (items: WorldItem[]) => {
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
    game.socket.on('playerHealed', (data: { playerId: string, health: number, healAmount: number }) => {
        const player = game.players.get(data.playerId);
        if (player) {
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
    });

    // Debounce loadout UI updates to prevent multiple DOM re-renders when many petals break/restore at once
    let loadoutUpdateTimeout: NodeJS.Timeout | null = null;
    function scheduleLoadoutUIUpdate() {
        if (loadoutUpdateTimeout) return;
        loadoutUpdateTimeout = setTimeout(() => {
            loadoutUpdateTimeout = null;
            if (game.isInventoryOpen) {
                game.inventoryManager.updateInventoryDisplay();
            }
            if (game.inventoryManager) {
                game.inventoryManager.updateLoadoutDisplay();
            }
        }, 50);
    }

    game.socket.on('petalBroken', (data: { playerId: string, slotIndex: number, petalType: string, rarity: string }) => {
        const player = game.players.get(data.playerId);
        if (player && player.loadout && player.loadout[data.slotIndex]) {
            player.loadout[data.slotIndex]!.health = 0;
            player.loadout[data.slotIndex]!.onCooldown = true;
            game.showPetalBreakEffect(player.x, player.y, data.petalType);
            if (isLocalPlayerId(game, data.playerId)) {
                scheduleLoadoutUIUpdate();
            }
        }
    });

    game.socket.on('petalRestored', (data: { playerId: string, slotIndex: number, petal: any }) => {
        const player = game.players.get(data.playerId);
        if (player && player.loadout) {
            player.loadout[data.slotIndex] = data.petal;
            if (isLocalPlayerId(game, data.playerId)) {
                scheduleLoadoutUIUpdate();
            }
        }
    });

    const PICKUP_ANIM_MS = 150;
    const DESPAWN_ANIM_MS = 300;

    const registerPickupAnim = (itemId: string, playerId?: string) => {
        const item = game.items.get(itemId);
        if (!item) return;
        if (!game.graphics.itemDeathAnim) {
            game.graphics.itemDeathAnim = new Map();
        }
        if (game.graphics.itemDeathAnim.has(itemId)) return; // already animating
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
            if (game.pickedUpItems) game.pickedUpItems.delete(itemId);
        }, PICKUP_ANIM_MS);
    };

    const registerDespawnAnim = (itemId: string) => {
        const item = game.items.get(itemId);
        if (!item) return;
        if (!game.graphics.itemDeathAnim) {
            game.graphics.itemDeathAnim = new Map();
        }
        if (game.graphics.itemDeathAnim.has(itemId)) return; // already animating (e.g. pickup)
        game.graphics.itemDeathAnim.set(itemId, {
            type: 'despawn',
            startX: item.x,
            startY: item.y,
            startTime: Date.now()
        });
        setTimeout(() => {
            game.items.delete(itemId);
            game.graphics.itemDeathAnim?.delete(itemId);
            if (game.pickedUpItems) game.pickedUpItems.delete(itemId);
        }, DESPAWN_ANIM_MS);
    };

    game.socket.on('itemPickedUp', (itemId: string) => {
        // Local player picked up this item — animate toward the half that's
        // actually on screen (the pickup is emitted to the socket, not per half).
        registerPickupAnim(itemId, localPlayerId(game));
    });

    game.socket.on('itemRemoved', (itemId: string) => {
        // If not already animating (e.g. pickup), show despawn animation
        registerDespawnAnim(itemId);
    });

    game.socket.on('itemCollected', (data: { playerId: string, itemId: string }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            registerPickupAnim(data.itemId, data.playerId);
            if (isOwnPlayerId(game, data.playerId)) {
                if (game.isInventoryOpen) {
                    game.inventoryManager.updateInventoryDisplay();
                }
            }
        }
    });

    game.socket.on('inventoryUpdate', (inventory: Item[]) => {
        const player = localPlayer(game);
        if (player) {
            forEachOwnPlayer(game, p => { p.inventory = inventory; });
            game.inventoryManager?.reconcileStagedWithInventory();
            // Update inventory display if it's open
            if (game.isInventoryOpen) {
                game.inventoryManager.updateInventoryDisplay();
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
            game.savePlayerProgress(player);
        }
    });

    // XP banked onto the OUTSIDE track while the player stands in the maze —
    // every mob kill in there. The XP bar shows the maze level, so it must not
    // move; we just record where the outside level has got to.
    game.socket.on('outsideXpGained', (data: {
        playerId: string;
        xp: number;
        outsideLevel: number;
        outsideTotalXp: number;
    }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.outsideLevel = data.outsideLevel;
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
            game.savePlayerProgress(player);
        }
    });


    game.socket.on('playerRespawned', (player: Player) => {
        const existingPlayer = game.players.get(player.id);
        if (existingPlayer) {
            Object.assign(existingPlayer, player);
            // Reset the isDead flag
            existingPlayer.isDead = false;
            if (isLocalPlayerId(game, player.id)) {
                game.isPlayerDead = false;
                game.hideDeathScreen();
            }
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
        } else {
            let loadoutChanged = false;
            let inventoryChanged = false;
            let mobKillsChanged = false;

            if (isOwnPlayerId(game, updatedPlayer.id)) {
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
            // The full server player carries its raw petalPositions. Assigning
            // them would wipe the client's per-petal interpolation state and
            // snap every petal to its un-smoothed server spot — the whole
            // orbit visibly jumps ahead by the interpolation lag. This event
            // fires on every mob kill (trackMobKill) and on loadout changes,
            // which is exactly when the jump was seen. Petal positions are
            // owned by the gameStateUpdate delta pipeline; keep the client's.
            const prevPetalPositions = player.petalPositions;
            Object.assign(player, updatedPlayer);
            if (prevPetalPositions) player.petalPositions = prevPetalPositions;
            // Restore interpolated position, update targets
            if (newX !== undefined && newY !== undefined) {
                player.x = prevX;
                player.y = prevY;
                player.targetX = newX;
                player.targetY = newY;
            }
            // The snapshot resurrected any craft-slot staged items into the
            // inventory (staging is client-side only) — re-deduct them so the
            // slots and inventory don't double-count (craft dupe glitch).
            if (inventoryChanged) {
                game.inventoryManager?.reconcileStagedWithInventory();
            }

            // Update displays if this is the current player. Both halves count:
            // the inventory is shared, and a switch delivers the newly active
            // half's loadout under ITS id — the loadout bar has to follow it.
            if (isOwnPlayerId(game, updatedPlayer.id)) {
                if (game.isInventoryOpen && inventoryChanged) {
                    game.inventoryManager.updateInventoryDisplay();
                }
                // Only update loadout display if loadout actually changed
                if (game.inventoryManager && loadoutChanged) {
                    game.inventoryManager.updateLoadoutDisplay();
                    // Equipped clovers affect the displayed craft success chance
                    if (game.inventoryManager.isCraftingOpen) {
                        game.inventoryManager.updateCraftingDisplay();
                    }
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

    // Incremental mob-gallery counter. The server used to re-send the entire
    // player (inventory, loadout and the whole mobKills table — ~9.9KB on a
    // late-game save) on every single kill just to move one number; this is the
    // ~12-byte version of that. `c` is the authoritative count, not a delta, so
    // a dropped frame self-heals on the next kill of the same type.
    game.socket.on('mobKillUpdate', (data: { t: string; r: string; c: number }) => {
        forEachOwnPlayer(game, p => {
            if (!p.mobKills) p.mobKills = {};
            if (!p.mobKills[data.t]) p.mobKills[data.t] = {};
            p.mobKills[data.t][data.r] = data.c;
        });
        // Same debounce as the old playerUpdated path — several mobs dying in
        // one tick would otherwise re-render the gallery once per kill.
        if (game.inventoryManager) {
            if (mobGalleryUpdateTimeout) clearTimeout(mobGalleryUpdateTimeout);
            mobGalleryUpdateTimeout = setTimeout(() => {
                game.inventoryManager.updateMobGalleryIfOpen();
                mobGalleryUpdateTimeout = null;
            }, 100);
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
            if (isLocalPlayerId(game, data.playerId) && game.skillsManager) {
                game.skillsManager.updateSkills(data.tp, data.skills);
            }
        }
    });

    game.socket.on('speedBoostActive', (playerId: string) => {
        if (isOwnPlayerId(game, playerId)) {
            game.speedBoostActive = true;
        }
    });

    game.socket.on('savePlayerProgress', () => {
        game.showSaveIndicator();
    });

    // Absorb tab of the craft menu: server destroyed the petals and granted XP.
    game.socket.on('itemsAbsorbed', (data: { xpGained: number, absorbedCount: number, inventory: any }) => {
        const player = localPlayer(game);
        if (player && data.inventory) {
            forEachOwnPlayer(game, p => { p.inventory = data.inventory; });
            game.inventoryManager?.reconcileStagedWithInventory();
        }
        game.inventoryManager?.handleItemsAbsorbed(data);
    });

    game.socket.on('absorbFailed', (data: { message?: string, inventory?: any }) => {
        console.warn('[CLIENT] absorbFailed:', data?.message);
        const player = localPlayer(game);
        if (player && data?.inventory) {
            forEachOwnPlayer(game, p => { p.inventory = data.inventory; });
            game.inventoryManager?.reconcileStagedWithInventory();
        }
        game.inventoryManager?.handleAbsorbFailed();
    });

    game.socket.on('craftingFinished', (data: { successCount: number, failCount: number, newItem: Item, inventory: any, petalsReturned?: number }) => {
        console.log('[CLIENT] craftingFinished received:', data);
        const player = localPlayer(game);
        if (player) {
            forEachOwnPlayer(game, p => { p.inventory = data.inventory; });
            // Anything staged into the slots after this craft was sent is
            // still present in the snapshot — re-deduct it (dupe guard).
            game.inventoryManager?.reconcileStagedWithInventory();

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

                game.inventoryManager.showCraftingSuccess(displayItem, data.successCount, data.petalsReturned || 0);
            }

            if (game.inventoryManager.isCraftingOpen) {
                game.inventoryManager.updateCraftingDisplay();
            }
        }
    });

    game.socket.on('craftingFailed', (message: string) => {
        console.log('[CLIENT] craftingFailed received:', message);
        if (game.inventoryManager.isCraftingOpen) {
            game.inventoryManager.updateCraftingDisplay();
        }
    });

    // Shop handlers
    game.socket.on('shopPurchaseSuccess', (data: { inventory: any, stars: number }) => {
        console.log('[CLIENT] shopPurchaseSuccess received:', data);
        const player = localPlayer(game);
        if (player) {
            forEachOwnPlayer(game, p => { p.inventory = data.inventory; p.stars = data.stars; });
            game.inventoryManager?.reconcileStagedWithInventory();
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
        const player = localPlayer(game);
        if (player) {
            forEachOwnPlayer(game, p => { p.stars = data.totalStars; });
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
        }
        // Update shop display (including challenges tab if open)
        if (game.shopManager) {
            game.shopManager.updateStarsDisplay();
        }
    });

    // Listen for server game state updates for better synchronization.
    // Pure delta protocol — server only sends what *changed* this tick:
    //   P = newly-changed players (delta fields)
    //   E = newly-changed enemies (delta fields, or full fields on first sight)
    //   R = enemies to remove (left viewport or died)
    //   F = 1 marks a full-resync snapshot (server detected a dropped frame):
    //       E lists every viewport enemy, so unmentioned enemies are stale.
    // Otherwise, unmentioned entities keep their current state.
    // Per-player keys: i,n,x,y,a,h,H,l,s,e,f,q,r,k,m,v,V,z, p (petalPositions array).
    // Per-petal keys: L=loadoutIndex,I=instanceIndex,x,y,N=noPhysics.
    // Per-enemy keys: i,t=type,T=tier,x,y,a,h,H. Missing fields = unchanged.
    game.socket.on('gameStateUpdate', (data: any) => {
        const serverPlayers: any[] | undefined = data.P;
        const serverEnemies: any[] | undefined = data.E;
        const removedEnemyIds: string[] | undefined = data.R;
        const removedPlayerIds: string[] | undefined = data.D;

        // De-jittered snapshot timeline. Stamping snapshots with *arrival* time
        // lets network jitter distort the timeline: under latency, TCP delivers
        // several ticks in a burst with near-identical timestamps, and the
        // interpolator plays 100ms of movement in a few ms (stutter / rubber-
        // banding). Instead, map the server's tick timestamp (data.T) into
        // client time with a slowly-adapting offset: spacing between snapshots
        // then stays the server's true tick spacing no matter how packets
        // arrive. The 0.02 gain tracks genuine clock drift but barely reacts
        // to per-packet jitter; a >2s divergence means reconnect/clock jump,
        // so re-anchor immediately.
        const arrivalMs = performance.now();
        let snapTimeMs = arrivalMs;
        if (typeof data.T === 'number') {
            const g: any = game;
            const off = arrivalMs - data.T;
            if (g._srvClockOffset === undefined || Math.abs(off - g._srvClockOffset) > 2000) {
                g._srvClockOffset = off;
            } else {
                g._srvClockOffset += (off - g._srvClockOffset) * 0.02;
            }
            snapTimeMs = data.T + g._srvClockOffset;
        }

        if (serverPlayers) {
            for (const sp of serverPlayers) {
                const id = sp.i;
                const existing = game.players.get(id);
                if (existing) {
                    // Players (self AND remote) only carry target*: game.ts eases
                    // every flower toward it with the same gardn exponential lerp,
                    // so remote players move exactly like the local one. They used
                    // to also feed the enemies' time-based `_snapshots` buffer,
                    // which replayed the server path at an 80ms render delay — a
                    // visibly different motion curve from the local flower's ease.
                    // Enemies still use snapshots (see the E-loop).
                    if (sp.x !== undefined) existing.targetX = sp.x;
                    if (sp.y !== undefined) existing.targetY = sp.y;
                    if (sp.a !== undefined) existing.angle = sp.a;
                    if (sp.vx !== undefined) existing.velocityX = sp.vx;
                    if (sp.vy !== undefined) existing.velocityY = sp.vy;
                    if (sp.h !== undefined) existing.health = sp.h;
                    if (sp.H !== undefined) existing.maxHealth = sp.H;
                    if (sp.l !== undefined) existing.level = sp.l;
                    if (sp.n !== undefined) existing.name = sp.n;
                    if (!existing.forcedFlags) {
                        if (sp.f !== undefined) existing.faceFlags = sp.f;
                        if (sp.q !== undefined) existing.equipFlags = sp.q;
                        if (sp.r !== undefined) existing.renderFlags = sp.r;
                        if (sp.m !== undefined) existing.mouth = sp.m;
                    }
                    if (sp.k !== undefined) existing.equippedSkinId = sp.k;
                    if (sp.v !== undefined) (existing as any).inPvpArena = !!sp.v;
                    if (sp.M !== undefined) (existing as any).inMaze = !!sp.M;
                    if (sp.V !== undefined) (existing as any).pvpScore = sp.V;
                    if (sp.z !== undefined) (existing as any).sizeMultiplier = sp.z;
                    if (sp.s !== undefined) (existing as any).score = sp.s;
                    if (sp.sm !== undefined) existing.speedFactor = sp.sm;
                    if (sp.e !== undefined) existing.petalExtension = sp.e || 1.0;
                    if (Array.isArray(sp.p)) {
                        const serverPetalPositions = sp.p;
                        if (!existing.petalPositions) {
                            existing.petalPositions = serverPetalPositions.map((pos: any) => ({
                                loadoutIndex: pos.L,
                                instanceIndex: pos.I,
                                x: pos.x,
                                y: pos.y,
                                noPhysics: !!pos.N,
                                targetX: pos.x,
                                targetY: pos.y,
                            }));
                        } else {
                            serverPetalPositions.forEach((serverPos: any) => {
                                const existingPos = existing.petalPositions!.find(
                                    (p: any) => p.loadoutIndex === serverPos.L && p.instanceIndex === serverPos.I
                                );
                                if (existingPos) {
                                    existingPos.targetX = serverPos.x;
                                    existingPos.targetY = serverPos.y;
                                    existingPos.noPhysics = !!serverPos.N;
                                } else {
                                    existing.petalPositions!.push({
                                        loadoutIndex: serverPos.L,
                                        instanceIndex: serverPos.I,
                                        x: serverPos.x,
                                        y: serverPos.y,
                                        noPhysics: !!serverPos.N,
                                        targetX: serverPos.x,
                                        targetY: serverPos.y,
                                    } as any);
                                }
                            });
                            existing.petalPositions = existing.petalPositions!.filter((pos: any) =>
                                serverPetalPositions.some((sp2: any) =>
                                    sp2.L === pos.loadoutIndex && sp2.I === pos.instanceIndex
                                )
                            );
                        }
                    }
                } else {
                    // First sight: server omits fields equal to defaults. Apply matching defaults here.
                    const newPlayer: any = {
                        id,
                        name: sp.n,
                        x: sp.x,
                        y: sp.y,
                        angle: sp.a ?? 0,
                        health: sp.h,
                        maxHealth: sp.H,
                        level: sp.l ?? 1,
                        score: sp.s ?? 0,
                        petalExtension: sp.e ?? 1.0,
                        faceFlags: sp.f ?? 0,
                        equipFlags: sp.q ?? 0,
                        renderFlags: sp.r ?? 0,
                        equippedSkinId: sp.k ?? '',
                        mouth: sp.m ?? 14.5,
                        inPvpArena: !!sp.v,
                        inMaze: !!sp.M,
                        pvpScore: sp.V ?? 0,
                        sizeMultiplier: sp.z ?? 1.0,
                        imageLoaded: true,
                        velocityX: 0,
                        velocityY: 0,
                        targetX: sp.x,
                        targetY: sp.y,
                        xp: 0,
                        xpToNextLevel: 100,
                    };
                    if (sp.vx !== undefined) newPlayer.velocityX = sp.vx;
                    if (sp.vy !== undefined) newPlayer.velocityY = sp.vy;
                    if (Array.isArray(sp.p)) {
                        newPlayer.petalPositions = sp.p.map((pos: any) => ({
                            loadoutIndex: pos.L,
                            instanceIndex: pos.I,
                            x: pos.x,
                            y: pos.y,
                            noPhysics: !!pos.N,
                            targetX: pos.x,
                            targetY: pos.y,
                        }));
                    }
                    game.players.set(id, newPlayer);
                }
            }
        }

        // Players the server has culled: out of our visibility box, or gone.
        // Without this every flower we ever saw stayed in the map forever,
        // frozen at its last-known position and still drawn on the minimap.
        // Never drop a flower we own — the local halves are always streamed.
        if (removedPlayerIds) {
            for (const id of removedPlayerIds) {
                if (isOwnPlayerId(game, id)) continue;
                game.players.delete(id);
            }
        }

        // Explicit removes only: drop just the enemies the server told us to drop.
        // Stationary / unchanged enemies aren't mentioned at all and stay as-is.
        if (removedEnemyIds) {
            for (const id of removedEnemyIds) handleEnemyOutOfView(id);
        }

        // Full-resync snapshot: a frame to us was dropped under backpressure, so
        // one of our enemies may be a ghost whose one-shot removal never arrived.
        // E now lists the entire viewport — anything we hold beyond it is stale.
        // (Mid-death-animation enemies are skipped by handleEnemyOutOfView and
        // cleaned up by the game loop's 200ms animation timer.)
        if (data.F) {
            const mentioned = new Set<string>();
            if (serverEnemies) for (const e of serverEnemies) mentioned.add(e.i);
            for (const id of Array.from(game.enemies.keys()) as string[]) {
                if (!mentioned.has(id)) handleEnemyOutOfView(id);
            }
            // Same for players: after a resync the server re-sends every visible
            // flower as a first-sight record, so anything P doesn't mention is a
            // ghost whose D entry was lost with the dropped frame.
            const mentionedPlayers = new Set<string>();
            if (serverPlayers) for (const sp of serverPlayers) mentionedPlayers.add(sp.i);
            for (const id of Array.from(game.players.keys()) as string[]) {
                if (!mentionedPlayers.has(id) && !isOwnPlayerId(game, id)) game.players.delete(id);
            }
        }

        if (serverEnemies) {
            for (const e of serverEnemies) {
                const existing = game.enemies.get(e.i);
                if (existing && existing.type && existing.tier) {
                    // Partial update - merge only fields that are present.
                    const merged: any = {
                        id: e.i,
                        type: e.t !== undefined ? e.t : existing.type,
                        tier: e.T !== undefined ? e.T : existing.tier,
                        x: e.x !== undefined ? e.x : (existing.targetX ?? existing.x),
                        y: e.y !== undefined ? e.y : (existing.targetY ?? existing.y),
                        // Fall back to targetAngle (last authoritative server angle), NOT
                        // existing.angle: the render loop mutates .angle mid-interpolation,
                        // so using it here feeds the client's own lagging rendered angle
                        // back into the snapshot buffer as if it were fresh server data —
                        // the mob then chases its own tail and wobbles after finishing a turn.
                        angle: e.a !== undefined ? e.a : (existing.targetAngle ?? existing.angle),
                        health: e.h !== undefined ? e.h : existing.health,
                        maxHealth: e.H !== undefined ? e.H : existing.maxHealth,
                    };
                    handleEnemyUpdate(merged, snapTimeMs);
                } else {
                    // First sight (or recovery if existing was malformed). Server omits
                    // tier/maxHealth/angle when they match defaults — apply fallbacks.
                    if (e.t === undefined) {
                        // Defensive: drop malformed entries rather than render an undefined-typed mob.
                        continue;
                    }
                    const tier = e.T ?? 'common';
                    const defaultStats = getMobStats(e.t, tier);
                    const maxHealth = e.H ?? (defaultStats ? defaultStats.health : e.h);
                    handleEnemyUpdate({
                        id: e.i,
                        type: e.t,
                        tier,
                        x: e.x,
                        y: e.y,
                        angle: e.a ?? 0,
                        health: e.h,
                        maxHealth,
                    } as any, snapTimeMs);
                }
            }
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
                // Suppress stale server-driven loadout/inventory overwrites during in-flight
                // optimistic updates (swaps, drops, etc.) that haven't been round-tripped yet.
                const inv = (game as any).inventoryManager;
                const suppressMs = inv?.LOADOUT_SYNC_SUPPRESS_MS ?? 0;
                const lastLocal = inv?.lastLocalLoadoutChange ?? 0;
                const isLocal = isLocalPlayerId(game, serverPlayer.id);
                const suppress = isLocal && Date.now() - lastLocal < suppressMs;
                if (!suppress) {
                    player.inventory = serverPlayer.inventory;
                    player.loadout = padLoadout(serverPlayer.loadout, 20);
                    if (isLocal) game.inventoryManager?.reconcileStagedWithInventory();
                } else {
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
                    if (mobKillsChanged && isLocalPlayerId(game, serverPlayer.id) && game.inventoryManager) {
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
                player = withoutRawPetalPositions({
                    ...serverPlayer,
                    image: new Image(),
                    imageLoaded: false,
                    targetX: serverPlayer.x,
                    targetY: serverPlayer.y,
                });
                player.loadout = padLoadout(serverPlayer.loadout, 20);
                game.players.set(serverPlayer.id, player);
            }
        });
    });

    game.socket.on('updateEnemies', (serverEnemies: Enemy[]) => {
        // Clear all enemies first - full refresh, no death animation
        for (const [enemyId] of game.enemies) {
            handleEnemyOutOfView(enemyId);
        }
        
        // Add all enemies - uses same path as all enemy updates
        serverEnemies.forEach(enemy => {
            handleEnemyUpdate(enemy);
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

        if (isLocalPlayerId(game, data.playerId)) {
            game.isPlayerDead = true;
            game.showDeathScreen(data.killedBy);
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
        
        // If the revived player is the local player, hide death screen
        if (isLocalPlayerId(game, data.revivedPlayerId)) {
            game.isPlayerDead = false;
            game.hideDeathScreen();
        }
    });
}
