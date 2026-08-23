"use strict";
/**
 * Connection lifecycle: input, authentication, and teardown.
 *
 * `authenticate` is the heavyweight one — it loads or creates the account,
 * restores inventory/loadout/skills, places the flower in a biome, and primes
 * every client-side cache. `endPlayerSession` is the single teardown path,
 * shared by an explicit leaveGame and a dropped socket.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSessionHandlers = registerSessionHandlers;
const constants_1 = require("../../constants");
const database_1 = require("../../database");
const inventoryCodec_1 = require("../../inventoryCodec");
const map_data_1 = require("../../map_data");
const maze_1 = require("../../maze");
const petal_actions_1 = require("../../petal_actions");
const petals_1 = require("../../petals");
const gameState_1 = require("../gameState");
const guildManager_1 = require("../guildManager");
const playerManager_1 = require("../playerManager");
const playerState_1 = require("../playerState");
const playerWire_1 = require("../playerWire");
const squadManager_1 = require("../squadManager");
const tempAdmin_1 = require("../tempAdmin");
const tickBroadcast_1 = require("../tickBroadcast");
const utils_1 = require("../utils");
const sessionGuard_1 = require("./sessionGuard");
const petalEvents_1 = require("../petalEvents");
function registerSessionHandlers(ctx) {
    const { io, socket } = ctx;
    const { respawnPlayer, savePlayerProgress, savePlayerProgressImmediate, triggerViewportUpdate } = ctx.deps;
    socket.on('playerInput', (inputData) => {
        const player = constants_1.players[socket.id];
        if (player) {
            // Update per-player viewport dimensions if provided
            if (inputData.viewportWidth && inputData.viewportHeight &&
                isFinite(inputData.viewportWidth) && isFinite(inputData.viewportHeight) &&
                inputData.viewportWidth > 0 && inputData.viewportHeight > 0) {
                player.viewportWidth = inputData.viewportWidth;
                player.viewportHeight = inputData.viewportHeight;
            }
            // Check if player is split and route inputs to active player
            const { splitPlayers } = require('../../petal_actions');
            const originalId = socket.id.replace('_split2', '').replace('_split1', '');
            const splitState = splitPlayers.get(originalId);
            if (splitState) {
                // Player is split - route inputs to active player
                const activePlayer = splitState.activeIndex === 0 ? splitState.player1 : splitState.player2;
                if (activePlayer && constants_1.players[activePlayer.id]) {
                    constants_1.players[activePlayer.id].inputs = inputData;
                    constants_1.players[activePlayer.id].lastProcessedInputSeq = inputData.seq;
                    // The camera is on the active half, so the streaming boxes
                    // are built from ITS viewport — keep it sized like the
                    // client's window instead of whatever it inherited at split.
                    constants_1.players[activePlayer.id].viewportWidth = player.viewportWidth;
                    constants_1.players[activePlayer.id].viewportHeight = player.viewportHeight;
                }
            }
            else {
                // Normal player - apply inputs directly
                player.inputs = inputData;
                player.lastProcessedInputSeq = inputData.seq;
            }
        }
    });
    // Handle authentication.
    //
    // A session token from /auth/login is the only credential this accepts —
    // passwords are verified over HTTPS at login and nowhere else, so one never
    // rides the socket or sits in a client's storage waiting to be replayed.
    //
    // `lobby` marks the title screen's background authentication. It loads the
    // account exactly the same way — the title screen's inventory, loadout,
    // crafting, talent and shop panels all need it — but parks the player in
    // `lobbyPlayers` and stops short of every world-facing step below: no spawn
    // position, no pets, no cooldown timers, no world-state dump and no
    // `newPlayer` broadcast. The player only enters the world when the client
    // authenticates again WITHOUT the flag, which is what pressing Ready does.
    socket.on('authenticate', async (credentials) => {
        const user = credentials.token ? database_1.database.getUserBySession(credentials.token) : null;
        const lobby = credentials.lobby === true;
        // Only the world cares about the biome, and a lobby session has none —
        // so a lobby auth can never put the account into maze or PVP state.
        const spawnBiome = lobby ? 'default' : (credentials.spawnBiome || 'default');
        if (user) {
            // One account, one connection (loopback excepted — see sessionGuard).
            // This runs before the account is read back from disk below so that
            // the kicked tab's progress is already flushed when we load it.
            (0, sessionGuard_1.kickDuplicateSessions)(io, socket, user.id, savePlayerProgressImmediate);
            // Any lobby session on this socket is being replaced — by the real
            // spawn below, or by a fresh lobby load. Flush it first: a talent
            // spend or shop purchase may still be sitting in a debounced save,
            // and everything past this point rebuilds the player from disk.
            const previousLobby = gameState_1.lobbyPlayers[socket.id];
            if (previousLobby) {
                delete gameState_1.lobbyPlayers[socket.id];
                savePlayerProgressImmediate(previousLobby, user.id);
            }
            socket.userId = user.id;
            socket.username = user.username;
            gameState_1.playerUserIds[socket.id] = user.id; // Store the mapping
            // Award daily streak bonus before loading progress so saved stars are up-to-date
            const streakResult = database_1.database.processDailyStreak(user.id);
            // console.log('User authenticated, loading saved progress for userId:', user.id);
            const savedProgress = database_1.database.getPlayerByUserId(user.id);
            // console.log('Loaded saved progress:', savedProgress);
            // Calculate level, maxHealth, and damage from total XP
            const totalXP = savedProgress?.totalXP || 0;
            const level = (0, playerManager_1.calculateLevelFromTotalXP)(totalXP);
            const currentLevelXP = (0, playerManager_1.calculateCurrentLevelXP)(totalXP, level);
            const baseMaxHealth = (0, playerManager_1.calculateMaxHealthFromLevel)(level);
            const baseDamage = (0, playerManager_1.calculateDamageFromLevel)(level);
            // Determine spawn position based on selected biome. Skipped for a
            // lobby session: it is never placed in the world, and the default
            // branch below is a map scan plus a safe-spot search that would
            // otherwise run for every client that merely opened the page.
            let spawnX = 200;
            let spawnY = constants_1.WORLD_HEIGHT / 2;
            if (lobby) {
                // no world position
            }
            else if (spawnBiome === 'pvp') {
                // PVP arena lives outside the regular map — skip biome lookup and drop the player at the arena spawn.
                spawnX = constants_1.PVP_ARENA_SPAWN_X;
                spawnY = constants_1.PVP_ARENA_SPAWN_Y;
                console.log(`Player ${credentials.playerName} spawning in PVP arena`);
            }
            else if (spawnBiome === 'maze') {
                // The maze also lives outside the regular map; drop the player at the maze entrance.
                const mazeSpawn = (0, playerManager_1.getMazeSpawnPosition)();
                spawnX = mazeSpawn.x;
                spawnY = mazeSpawn.y;
                console.log(`Player ${credentials.playerName} spawning in the maze`);
            }
            else if (spawnBiome !== 'default') {
                const biomeSpawn = (0, playerManager_1.getSpawnPositionInBiome)(spawnBiome);
                if (biomeSpawn) {
                    spawnX = biomeSpawn.x;
                    spawnY = biomeSpawn.y;
                    console.log(`Player ${credentials.playerName} spawning in ${spawnBiome} biome`);
                }
                else {
                    console.log(`Failed to find biome ${spawnBiome}, using default spawn`);
                }
            }
            else {
                // Use default spawn logic for common spawn zones
                // Helper to get section from map coordinates
                const SECTION_SIZE = 20000;
                const getSectionFromMapCoords = (x, y) => {
                    const worldX = x * constants_1.SCALE_FACTOR;
                    const worldY = y * constants_1.SCALE_FACTOR;
                    const sectionX = Math.max(0, Math.min(2, Math.floor(worldX / SECTION_SIZE)));
                    const sectionY = Math.max(0, Math.min(2, Math.floor(worldY / SECTION_SIZE)));
                    return sectionY * 3 + sectionX;
                };
                const validSpawnPoints = map_data_1.WORLD_MAP.filter(element => element.type === 'spawn' &&
                    element.properties?.spawnType === 'common');
                if (validSpawnPoints.length > 0) {
                    // Prioritize spawn points in section 0 (first section) for default spawning
                    const section0SpawnPoints = validSpawnPoints.filter(spawn => {
                        const centerX = spawn.x + spawn.width / 2;
                        const centerY = spawn.y + spawn.height / 2;
                        return getSectionFromMapCoords(centerX, centerY) === 0;
                    });
                    // Use section 0 spawn points if available, otherwise fall back to all common spawns
                    const preferredSpawnPoints = section0SpawnPoints.length > 0 ? section0SpawnPoints : validSpawnPoints;
                    // Shuffle spawn points to try different ones
                    const shuffledSpawnPoints = [...preferredSpawnPoints].sort(() => Math.random() - 0.5);
                    let safeSpawnPosition = null;
                    for (const spawn of shuffledSpawnPoints) {
                        safeSpawnPosition = (0, playerManager_1.findSafeSpawnPosition)(spawn);
                        if (safeSpawnPosition) {
                            break;
                        }
                    }
                    if (safeSpawnPosition) {
                        spawnX = safeSpawnPosition.x;
                        spawnY = safeSpawnPosition.y;
                    }
                    else {
                        // Fallback: use random position in first spawn point (even if not completely safe)
                        console.warn('No safe spawn position found in common spawn zones, using fallback');
                        const spawn = preferredSpawnPoints[0];
                        spawnX = (spawn.x + spawn.width / 2) * constants_1.SCALE_FACTOR;
                        spawnY = (spawn.y + spawn.height / 2) * constants_1.SCALE_FACTOR;
                    }
                }
            }
            // Initialize skills from saved progress or defaults
            const savedSkills = savedProgress?.skills || {};
            // Use the saved TP if it was explicitly persisted (authoritative),
            // otherwise reconcile it from level minus what the tree cost. This
            // prevents TP duplication when refreshing/re-authenticating.
            const hasSavedTP = savedProgress && savedProgress.tp !== undefined;
            const currentTP = hasSavedTP ? savedProgress.tp : (0, playerManager_1.reconcileTP)(level, savedSkills);
            // The maze's own permanent progression track, parked until the
            // player actually enters the maze (enterMazeProgression swaps it in).
            const mazeTotalXP = savedProgress?.mazeTotalXP || 0;
            const mazeSkills = savedProgress?.mazeSkills || {};
            const hasSavedMazeTP = savedProgress && savedProgress.mazeTp !== undefined;
            const mazeTP = hasSavedMazeTP
                ? savedProgress.mazeTp
                : (0, playerManager_1.reconcileTP)((0, playerManager_1.calculateLevelFromTotalXP)(mazeTotalXP), mazeSkills);
            // Reconstruct loadout from saved data (only type/rarity/petalType saved)
            const reconstructLoadout = (savedLoadout) => {
                if (!savedLoadout || !Array.isArray(savedLoadout)) {
                    return (0, playerManager_1.createInitialBasicPetals)().concat(Array(5).fill(null));
                }
                return savedLoadout.map((item) => {
                    if (!item || !item.type)
                        return null;
                    if (item.type === 'petal' && item.petalType) {
                        const petalStats = (0, petals_1.getPetalStats)(item.petalType, item.rarity || 'common');
                        if (petalStats) {
                            const petalHealthMultiplier = (0, playerManager_1.getSkillMultiplier)(savedSkills.petalHealth);
                            const maxHealth = Math.round(petalStats.health * petalHealthMultiplier);
                            return {
                                type: 'petal',
                                rarity: item.rarity || 'common',
                                petalType: item.petalType,
                                health: maxHealth,
                                maxHealth: maxHealth,
                                onCooldown: true
                            };
                        }
                    }
                    return item; // For non-petal items, return as-is
                });
            };
            const reconstructedLoadout = reconstructLoadout(savedProgress?.loadout);
            // Separate maze loadout preset. Only reconstruct it if the player has
            // actually saved one; otherwise leave it undefined so the first maze
            // entry defaults it to a copy of the regular loadout (and so a save
            // for a never-customised player doesn't erase anything).
            const reconstructedMazeLoadout = Array.isArray(savedProgress?.mazeLoadout)
                ? reconstructLoadout(savedProgress.mazeLoadout)
                : undefined;
            const sessionPlayer = {
                id: socket.id,
                name: (credentials.playerName || 'Unnamed').slice(0, 20),
                x: spawnX,
                y: spawnY,
                angle: 0,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                health: baseMaxHealth, // Will be recalculated with modifiers
                maxHealth: baseMaxHealth, // Will be recalculated with modifiers
                damage: baseDamage, // Will be recalculated with modifiers
                inventory: savedProgress?.inventory ? (0, inventoryCodec_1.dictToInventory)(savedProgress.inventory) : (0, playerManager_1.createInitialInventory)(),
                loadout: reconstructedLoadout,
                mazeLoadout: reconstructedMazeLoadout,
                isInvulnerable: true,
                level: level,
                xp: currentLevelXP,
                xpToNextLevel: (0, playerManager_1.calculateXPRequirement)(level),
                knockbackX: 0,
                knockbackY: 0,
                inputs: { keys: [] },
                speed_boost: 1,
                tp: currentTP,
                skills: savedSkills,
                mazeTotalXP: mazeTotalXP,
                mazeTp: mazeTP,
                mazeSkills: mazeSkills,
                mobKills: savedProgress?.mobKills || {},
                stars: savedProgress?.stars || 0,
                renderFlags: savedProgress?.renderFlags || 0,
                equippedSkinId: savedProgress?.equippedSkinId || '',
                spawnBiome: spawnBiome,
                inPvpArena: false,
                inMaze: spawnBiome === 'maze',
                pvpScore: 0
            };
            // The one line that decides whether this client is playing or just
            // looking at the title screen. `players` is the world; `lobbyPlayers`
            // is not reachable from any world loop.
            if (lobby)
                gameState_1.lobbyPlayers[socket.id] = sessionPlayer;
            else
                constants_1.players[socket.id] = sessionPlayer;
            // If the player chose PVP from the title screen, swap to the PVP
            // loadout/inventory now (this also stashes the regular versions and
            // recalcs stats to apply the PVP-fixed max health).
            if (spawnBiome === 'pvp') {
                (0, playerManager_1.enterPvpArena)(sessionPlayer, io);
            }
            else {
                if (sessionPlayer.inMaze) {
                    // Maze entry: the regular loadout is stashed pristine and the
                    // player runs on a derived loadout that drops one rarity, with
                    // over-cap petals benched (saves persist the pristine stash, so
                    // the regular loadout is never changed), and the absorb baseline
                    // is snapshotted — all before pets/cooldowns are set up below.
                    (0, playerManager_1.enterMazeState)(sessionPlayer, io);
                }
                // Recalculate player stats with modifiers after loadout is set
                (0, playerManager_1.recalculatePlayerStats)(sessionPlayer, io);
            }
            // Start cooldown timers for all petals that are on cooldown.
            // World state, so a lobby session gets none: it has no flower for a
            // pet to orbit, and its loadout is rebuilt from disk on entry.
            const player = lobby ? null : sessionPlayer;
            if (player && player.loadout) {
                for (let i = 0; i < player.loadout.length; i++) {
                    // Secondary loadout (slots 10+) is storage only — no pets, no cooldowns.
                    if (i >= 10)
                        break;
                    const petal = player.loadout[i];
                    if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                        const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
                        // Spawn pets for equipped petals with petMobType (only if not on cooldown)
                        if (petalStats?.petMobType && !petal.onCooldown && petal.rarity) {
                            const petMobType = petalStats.petMobType;
                            // Pet inherits the petal's rarity
                            // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${player.id} on spawn`);
                            (0, petal_actions_1.spawnPet)(petMobType, petal.rarity, player.x, player.y, player.id, io, false, petalStats.petCount ?? 1);
                        }
                        // Handle cooldown timers
                        if (petal.onCooldown && petalStats) {
                            const cooldownTime = (0, petals_1.getEffectivePetalCooldown)(petal.petalType, petal.rarity, petalStats);
                            // Stamp the deadline the tick-loop backstop reads, so the
                            // spawn-in reload isn't cut short by it (or left without an
                            // end if this timer dies with the process).
                            petal.cooldownEndTime = Date.now() + cooldownTime;
                            const timeoutKey = `${socket.id}-${i}`;
                            // Snapshot identity so a stale timer doesn't clobber a swapped slot
                            const snapshotPetalType = petal.petalType;
                            const snapshotRarity = petal.rarity;
                            const timeout = setTimeout(() => {
                                gameState_1.petalCooldownTimeouts.delete(timeoutKey);
                                const current = constants_1.players[socket.id]?.loadout[i];
                                if (!constants_1.players[socket.id] || !current || !current.onCooldown)
                                    return;
                                if (current.type !== 'petal' ||
                                    current.petalType !== snapshotPetalType ||
                                    current.rarity !== snapshotRarity)
                                    return;
                                {
                                    // Restore petal after cooldown
                                    const restoredPetal = {
                                        type: petal.type,
                                        petalType: petal.petalType,
                                        rarity: petal.rarity,
                                        health: petal.maxHealth,
                                        maxHealth: petal.maxHealth,
                                        onCooldown: false
                                    };
                                    // Apply petal health bonus
                                    (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, constants_1.players[socket.id]);
                                    constants_1.players[socket.id].loadout[i] = restoredPetal;
                                    (0, petalEvents_1.emitPetalRestored)(constants_1.players[socket.id].id, {
                                        playerId: constants_1.players[socket.id].id,
                                        slotIndex: i,
                                        petal: constants_1.players[socket.id].loadout[i]
                                    });
                                    // Spawn pet when petal is restored (if it has petMobType)
                                    if (petalStats.petMobType && petal.rarity) {
                                        const petMobType = petalStats.petMobType;
                                        // Pet inherits the petal's rarity
                                        const restoredPlayer = constants_1.players[socket.id];
                                        if (restoredPlayer && !restoredPlayer.isDead) {
                                            // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${restoredPlayer.id} when petal restored on spawn`);
                                            (0, petal_actions_1.spawnPet)(petMobType, petal.rarity, restoredPlayer.x, restoredPlayer.y, restoredPlayer.id, io, false, petalStats.petCount ?? 1);
                                        }
                                    }
                                }
                            }, cooldownTime);
                            gameState_1.petalCooldownTimeouts.set(timeoutKey, timeout);
                        }
                    }
                }
            }
            // Save initial state and log the result
            // console.log('Saving initial player state');
            savePlayerProgress(sessionPlayer, user.id);
            if (!lobby) {
                // Trigger viewport update when new player joins
                triggerViewportUpdate();
                // Remove initial invulnerability after the specified time
                setTimeout(() => {
                    if (constants_1.players[socket.id]) {
                        constants_1.players[socket.id].isInvulnerable = false;
                        // Notify client that invulnerability has ended
                        io.emit('playerInvulnerabilityEnded', { playerId: socket.id });
                    }
                }, constants_1.RESPAWN_INVULNERABILITY_TIME);
            }
            // Send success response and game state
            socket.emit('authenticated', {
                success: true,
                player: sessionPlayer
            });
            socket.emit('dailyStreakStatus', {
                starsAwarded: streakResult.starsAwarded,
                streak: streakResult.streak,
                newDay: streakResult.newDay,
                nextClaimAtMs: streakResult.nextClaimAtMs,
                streakExpiresAtMs: streakResult.streakExpiresAtMs,
                totalStars: sessionPlayer.stars
            });
            // Explain the maze rules once on entry — otherwise the rarity
            // shift looks like petals silently vanishing a tier.
            if (sessionPlayer.inMaze) {
                const mazeNow = (0, maze_1.getActiveMaze)();
                const biomeName = mazeNow ? mazeNow.biome.charAt(0).toUpperCase() + mazeNow.biome.slice(1) : '';
                socket.emit('chatMessage', {
                    sender: 'System',
                    content: `<span style="color: #c77dff;">Entered the ${biomeName} Maze. Your equipped petals act one rarity lower in here and return to normal when you leave. You cannot equip new petals in the maze — set up your loadout on the title screen before entering. Petals found in the maze enter your inventory one rarity higher; petals above Ultra are unequipped at the entrance. The maze has its own level, talent points and talent tree, kept separately from your outside ones: only absorbing raises your maze level, while mobs killed in here give XP to your outside level.</span>`,
                    timestamp: Date.now()
                });
            }
            // Send the user's current guild (if any) and notify online guild members so online list refreshes.
            if (socket.username) {
                const userGuild = (0, guildManager_1.getGuildForUsername)(socket.username);
                if (userGuild) {
                    sessionPlayer.guildName = userGuild.name;
                    (0, guildManager_1.broadcastGuildUpdate)(userGuild, io);
                    (0, guildManager_1.syncGuildToOnlineMembers)([socket.username], userGuild, io);
                }
                else {
                    socket.emit('guildUpdate', null);
                }
            }
            // Send the full catalog of published user-created skins plus this
            // client's admin flag (used only to show/hide the takedown button —
            // deletes are re-checked server-side). Seeds the client skin registry
            // so remote players wearing custom skins render correctly.
            socket.emit('skinsUpdate', {
                skins: database_1.database.getAllCustomSkins(),
                isAdmin: socket.username ? database_1.database.isUserAdmin(socket.username) : false,
            });
            // Send initial skills update
            socket.emit('skillsUpdated', {
                playerId: sessionPlayer.id,
                tp: sessionPlayer.tp || 0,
                skills: sessionPlayer.skills || {}
            });
            // Everything below puts this client in the world and the world in
            // this client. A lobby session gets none of it: nobody is told a
            // flower appeared, and the title screen has no use for the world
            // dump (it also never receives a gameStateUpdate, since those are
            // built from `players`).
            if (!lobby) {
                // Send current game state
                socket.emit('currentPlayers', (0, playerWire_1.sanitizePlayersForClient)(constants_1.players, socket.id));
                // Only send enemies in viewport with 200% buffer on connection
                const enemiesInViewport = (0, playerState_1.getEnemiesInViewport200Percent)();
                socket.emit('enemiesUpdate', enemiesInViewport);
                socket.emit('obstaclesUpdate', constants_1.obstacles);
                // Filter items to only send ones this player is eligible for and hasn't picked up yet
                socket.emit('itemsUpdate', (0, tickBroadcast_1.getEligibleItemsForSocket)(socket.id));
                // Notify other players
                socket.broadcast.emit('newPlayer', (0, playerWire_1.sanitizePublicPlayerForClient)(sessionPlayer));
            }
        }
        else {
            socket.emit('authenticated', {
                success: false,
                error: 'Invalid credentials'
            });
        }
    });
    // Ends a player's active session. `removeListeners` is true for a real socket
    // 'disconnect' (full teardown) and false for 'leaveGame' (return to title): the
    // latter keeps the socket — and the player's ground-loot eligibility, which is
    // keyed to the socket id — alive so loot doesn't despawn and the client is not
    // counted as disconnected.
    const endPlayerSession = (removeListeners) => {
        console.log('A user disconnected');
        // A temporary admin grant is scoped to one life in one session — it must
        // not survive a return to the title screen and a fresh spawn either.
        (0, tempAdmin_1.revokeTempAdmin)(socket.id);
        // A title-screen session has no world state to tear down, but it does
        // hold account state (talent spends, shop buys) that the 60s autosave
        // never sees — it only walks `players`. Flush it before dropping it.
        const lobbyPlayer = gameState_1.lobbyPlayers[socket.id];
        if (lobbyPlayer) {
            delete gameState_1.lobbyPlayers[socket.id];
            if (socket.userId)
                savePlayerProgressImmediate(lobbyPlayer, socket.userId);
        }
        // Clean up squad membership
        (0, squadManager_1.handlePlayerDisconnect)(socket.id, io);
        // Refresh online status for this user's guildmates (guild itself is persistent).
        if (socket.username) {
            const userGuild = (0, guildManager_1.getGuildForUsername)(socket.username);
            if (userGuild) {
                // Delay one tick so this socket is already removed from io.sockets before recomputing online list.
                const leavingUsername = socket.username;
                setImmediate(() => {
                    const g = (0, guildManager_1.getGuildForUsername)(leavingUsername);
                    if (g)
                        (0, guildManager_1.broadcastGuildUpdate)(g, io);
                });
            }
        }
        // Check if player is split and clean up both split players
        const { splitPlayers } = require('../../petal_actions');
        const originalId = socket.id.replace('_split2', '').replace('_split1', '');
        const splitState = splitPlayers.get(originalId);
        if (splitState) {
            // Player is split - clean up both split players
            console.log(`[DISCONNECT] Cleaning up split players for ${originalId}`);
            // Save progress for the original player if authenticated
            if (constants_1.players[originalId] && socket.userId) {
                savePlayerProgressImmediate(constants_1.players[originalId], socket.userId);
            }
            // Clean up petal cooldown timeouts for both split players
            const splitPlayerIds = [splitState.player1.id, splitState.player2.id, originalId];
            for (const playerId of splitPlayerIds) {
                for (let i = 0; i < 10; i++) {
                    const timeoutKey = `${playerId}-${i}`;
                    const timeout = gameState_1.petalCooldownTimeouts.get(timeoutKey);
                    if (timeout) {
                        clearTimeout(timeout);
                        gameState_1.petalCooldownTimeouts.delete(timeoutKey);
                    }
                }
                // Clean up petalLastProjectileTime entries
                const keysToDelete = [];
                gameState_1.petalLastProjectileTime.forEach((value, key) => {
                    if (key.startsWith(playerId)) {
                        keysToDelete.push(key);
                    }
                });
                keysToDelete.forEach(key => {
                    gameState_1.petalLastProjectileTime.delete(key);
                    gameState_1.petalLastRadiationTime.delete(key);
                });
                // Clean up petal physics states
                (0, playerState_1.cleanupPetalPhysicsStates)(playerId);
                (0, petal_actions_1.cleanupPlayerPetalActionState)(playerId);
                // Remove player from players map
                delete constants_1.players[playerId];
                delete gameState_1.playerUserIds[playerId];
                gameState_1.knownMobProjectilesByPlayer.delete(playerId);
                gameState_1.knownPlayerProjectilesByPlayer.delete(playerId);
                // Emit playerDisconnected event for this split player
                io.emit('playerDisconnected', playerId);
            }
            // Despawn all pets owned by any of the split players
            for (const playerId of splitPlayerIds) {
                (0, petal_actions_1.despawnAllPlayerPets)(playerId, io);
            }
            // Remove split state
            splitPlayers.delete(originalId);
        }
        else {
            // Normal player - standard cleanup
            if (constants_1.players[socket.id] && socket.userId) {
                // console.log('Saving player progress for userId:', socket.userId);
                savePlayerProgressImmediate(constants_1.players[socket.id], socket.userId);
            }
            // Clean up petal cooldown timeouts for this player
            for (let i = 0; i < 10; i++) {
                const timeoutKey = `${socket.id}-${i}`;
                const timeout = gameState_1.petalCooldownTimeouts.get(timeoutKey);
                if (timeout) {
                    clearTimeout(timeout);
                    gameState_1.petalCooldownTimeouts.delete(timeoutKey);
                }
            }
            // Clean up petalLastProjectileTime entries for this player
            const keysToDelete = [];
            gameState_1.petalLastProjectileTime.forEach((value, key) => {
                if (key.startsWith(socket.id)) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(key => {
                gameState_1.petalLastProjectileTime.delete(key);
                gameState_1.petalLastRadiationTime.delete(key);
            });
            // Clean up petal physics states for this player
            (0, playerState_1.cleanupPetalPhysicsStates)(socket.id);
            (0, petal_actions_1.cleanupPlayerPetalActionState)(socket.id);
            // Despawn all pets owned by this player
            (0, petal_actions_1.despawnAllPlayerPets)(socket.id, io);
            delete constants_1.players[socket.id];
            delete gameState_1.playerUserIds[socket.id]; // Clean up the mapping
            gameState_1.knownMobProjectilesByPlayer.delete(socket.id);
            gameState_1.knownPlayerProjectilesByPlayer.delete(socket.id);
        }
        // Remove all event listeners to prevent memory leaks.
        // Skipped on 'leaveGame' (return to title): the socket stays connected and
        // must keep its listeners so the player can re-authenticate and rejoin.
        if (removeListeners) {
            socket.removeAllListeners();
        }
        // Only emit to authenticated players (not to unauthenticated title screen connections)
        // Note: playerDisconnected events for split players are already emitted above
        if (!splitState) {
            const authenticatedSockets = Array.from(io.sockets.sockets.values())
                .filter((s) => s.userId);
            if (authenticatedSockets.length > 0) {
                io.emit('playerDisconnected', socket.id);
            }
        }
        // Trigger viewport update when player disconnects (only if there are authenticated players)
        if (Object.keys(constants_1.players).length > 0) {
            triggerViewportUpdate();
        }
    };
    // Real socket drop: full teardown (strip listeners, the socket is gone).
    socket.on('disconnect', () => endPlayerSession(true));
    // Soft leave: the player returned to the title screen. Remove them from the
    // active world (save progress, despawn pets, notify other players) but KEEP
    // the socket connected so the same connection is reused on the next play and
    // their ground loot — eligibility keyed by socket id — does not despawn.
    socket.on('leaveGame', () => endPlayerSession(false));
    socket.on('collectDot', (dotIndex) => {
        if (dotIndex >= 0 && dotIndex < constants_1.dots.length) {
            constants_1.dots.splice(dotIndex, 1);
            constants_1.players[socket.id].score++;
            io.emit('dotCollected', { playerId: socket.id, dotIndex });
            // Generate a new dot
            constants_1.dots.push({
                x: Math.random() * 800,
                y: Math.random() * 600
            });
        }
    });
    socket.on('ping', (clientTime) => {
        socket.emit('pong', clientTime);
        // Track connection quality based on ping
        const serverTime = Date.now();
        const ping = serverTime - clientTime;
        // Initialize connection quality tracking if not exists
        if (!socket.pingSamples) {
            socket.pingSamples = [];
            socket.connectionQuality = 'good';
            socket.averagePing = 0;
        }
        // Add ping sample
        socket.pingSamples.push(ping);
        if (socket.pingSamples.length > 10) {
            socket.pingSamples.shift();
        }
        // Calculate average ping
        socket.averagePing = socket.pingSamples.reduce((a, b) => a + b, 0) / socket.pingSamples.length;
        // Determine connection quality
        if (socket.averagePing > 200) {
            socket.connectionQuality = 'slow';
        }
        else if (socket.averagePing > 100) {
            socket.connectionQuality = 'medium';
        }
        else {
            socket.connectionQuality = 'good';
        }
    });
    // Handle respawn request
    socket.on('requestRespawn', () => {
        // Respawn the half the client is actually driving: when the splitter
        // clone dies, `players[socket.id]` is the OTHER half and still alive,
        // so this used to silently do nothing and the death screen never left.
        const player = (0, utils_1.getActivePlayerForSocket)(socket.id);
        if (player && player.isDead) {
            respawnPlayer(player);
            player.isDead = false;
            io.emit('playerRespawned', player);
        }
    });
}
