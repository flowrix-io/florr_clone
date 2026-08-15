/**
 * Connection lifecycle: input, authentication, and teardown.
 *
 * `authenticate` is the heavyweight one — it loads or creates the account,
 * restores inventory/loadout/skills, places the flower in a biome, and primes
 * every client-side cache. `endPlayerSession` is the single teardown path,
 * shared by an explicit leaveGame and a dropped socket.
 */

import { PVP_ARENA_SPAWN_X, PVP_ARENA_SPAWN_Y, RESPAWN_INVULNERABILITY_TIME, SCALE_FACTOR, WORLD_HEIGHT, dots, obstacles, players } from '../../constants';
import { database } from '../../database';
import { dictToInventory } from '../../inventoryCodec';
import { Item } from '../../item';
import { WORLD_MAP } from '../../map_data';
import { getActiveMaze } from '../../maze';
import { cleanupPlayerPetalActionState, despawnAllPlayerPets, spawnPet } from '../../petal_actions';
import { getEffectivePetalCooldown, getPetalStats } from '../../petals';
import { PlayerSkills, ServerPlayer } from '../../player';
import { decorations, knownMobProjectilesByPlayer, knownPlayerProjectilesByPlayer, lobbyPlayers, petalCooldownTimeouts, petalLastProjectileTime, petalLastRadiationTime, playerUserIds, sands } from '../gameState';
import { broadcastGuildUpdate, getGuildForUsername, syncGuildToOnlineMembers } from '../guildManager';
import { applyPetalHealthBonus, calculateCurrentLevelXP, calculateDamageFromLevel, calculateLevelFromTotalXP, calculateMaxHealthFromLevel, calculateXPRequirement, createInitialBasicPetals, createInitialInventory, enterMazeState, enterPvpArena, findSafeSpawnPosition, getMazeSpawnPosition, getSkillMultiplier, getSpawnPositionInBiome, recalculatePlayerStats, reconcileTP } from '../playerManager';
import { cleanupPetalPhysicsStates, getEnemiesInViewport200Percent } from '../playerState';
import { sanitizePlayersForClient, sanitizePublicPlayerForClient } from '../playerWire';
import { AuthenticatedSocket } from '../shared/socketTypes';
import { handlePlayerDisconnect as handleSquadDisconnect } from '../squadManager';
import { revokeTempAdmin } from '../tempAdmin';
import { getEligibleItemsForSocket } from '../tickBroadcast';
import { getActivePlayerForSocket } from '../utils';
import { ConnectionContext } from './context';
import { kickDuplicateSessions } from './sessionGuard';

export function registerSessionHandlers(ctx: ConnectionContext): void {
    const { io, socket } = ctx;
    const { respawnPlayer, savePlayerProgress, savePlayerProgressImmediate, triggerViewportUpdate } = ctx.deps;

    socket.on('playerInput', (inputData: any) => {
        const player = players[socket.id];
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
                if (activePlayer && players[activePlayer.id]) {
                    players[activePlayer.id].inputs = inputData;
                    players[activePlayer.id].lastProcessedInputSeq = inputData.seq;
                    // The camera is on the active half, so the streaming boxes
                    // are built from ITS viewport — keep it sized like the
                    // client's window instead of whatever it inherited at split.
                    players[activePlayer.id].viewportWidth = player.viewportWidth;
                    players[activePlayer.id].viewportHeight = player.viewportHeight;
                }
            } else {
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
    socket.on('authenticate', async (credentials: { token?: string, playerName: string, spawnBiome?: string, lobby?: boolean }) => {
        const user = credentials.token ? database.getUserBySession(credentials.token) : null;
        const lobby = credentials.lobby === true;
        // Only the world cares about the biome, and a lobby session has none —
        // so a lobby auth can never put the account into maze or PVP state.
        const spawnBiome = lobby ? 'default' : (credentials.spawnBiome || 'default');

        if (user) {
            // One account, one connection (loopback excepted — see sessionGuard).
            // This runs before the account is read back from disk below so that
            // the kicked tab's progress is already flushed when we load it.
            kickDuplicateSessions(io, socket, user.id, savePlayerProgressImmediate);

            // Any lobby session on this socket is being replaced — by the real
            // spawn below, or by a fresh lobby load. Flush it first: a talent
            // spend or shop purchase may still be sitting in a debounced save,
            // and everything past this point rebuilds the player from disk.
            const previousLobby = lobbyPlayers[socket.id];
            if (previousLobby) {
                delete lobbyPlayers[socket.id];
                savePlayerProgressImmediate(previousLobby, user.id);
            }

            socket.userId = user.id;
            socket.username = user.username;
            playerUserIds[socket.id] = user.id; // Store the mapping

            // Award daily streak bonus before loading progress so saved stars are up-to-date
            const streakResult = database.processDailyStreak(user.id);
            // console.log('User authenticated, loading saved progress for userId:', user.id);
            const savedProgress = database.getPlayerByUserId(user.id);
            // console.log('Loaded saved progress:', savedProgress);

            // Calculate level, maxHealth, and damage from total XP
            const totalXP = savedProgress?.totalXP || 0;
            const level = calculateLevelFromTotalXP(totalXP);
            const currentLevelXP = calculateCurrentLevelXP(totalXP, level);
            const baseMaxHealth = calculateMaxHealthFromLevel(level);
            const baseDamage = calculateDamageFromLevel(level);

            // Determine spawn position based on selected biome. Skipped for a
            // lobby session: it is never placed in the world, and the default
            // branch below is a map scan plus a safe-spot search that would
            // otherwise run for every client that merely opened the page.
            let spawnX = 200;
            let spawnY = WORLD_HEIGHT / 2;

            if (lobby) {
                // no world position
            } else if (spawnBiome === 'pvp') {
                // PVP arena lives outside the regular map — skip biome lookup and drop the player at the arena spawn.
                spawnX = PVP_ARENA_SPAWN_X;
                spawnY = PVP_ARENA_SPAWN_Y;
                console.log(`Player ${credentials.playerName} spawning in PVP arena`);
            } else if (spawnBiome === 'maze') {
                // The maze also lives outside the regular map; drop the player at the maze entrance.
                const mazeSpawn = getMazeSpawnPosition();
                spawnX = mazeSpawn.x;
                spawnY = mazeSpawn.y;
                console.log(`Player ${credentials.playerName} spawning in the maze`);
            } else if (spawnBiome !== 'default') {
                const biomeSpawn = getSpawnPositionInBiome(spawnBiome);
                if (biomeSpawn) {
                    spawnX = biomeSpawn.x;
                    spawnY = biomeSpawn.y;
                    console.log(`Player ${credentials.playerName} spawning in ${spawnBiome} biome`);
                } else {
                    console.log(`Failed to find biome ${spawnBiome}, using default spawn`);
                }
            } else {
                // Use default spawn logic for common spawn zones
                // Helper to get section from map coordinates
                const SECTION_SIZE = 20000;
                const getSectionFromMapCoords = (x: number, y: number): number => {
                    const worldX = x * SCALE_FACTOR;
                    const worldY = y * SCALE_FACTOR;
                    const sectionX = Math.max(0, Math.min(2, Math.floor(worldX / SECTION_SIZE)));
                    const sectionY = Math.max(0, Math.min(2, Math.floor(worldY / SECTION_SIZE)));
                    return sectionY * 3 + sectionX;
                };

                const validSpawnPoints = WORLD_MAP.filter(element =>
                    element.type === 'spawn' &&
                    element.properties?.spawnType === 'common'
                );

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

                    let safeSpawnPosition: { x: number; y: number } | null = null;
                    for (const spawn of shuffledSpawnPoints) {
                        safeSpawnPosition = findSafeSpawnPosition(spawn);
                        if (safeSpawnPosition) {
                            break;
                        }
                    }

                    if (safeSpawnPosition) {
                        spawnX = safeSpawnPosition.x;
                        spawnY = safeSpawnPosition.y;
                    } else {
                        // Fallback: use random position in first spawn point (even if not completely safe)
                        console.warn('No safe spawn position found in common spawn zones, using fallback');
                        const spawn = preferredSpawnPoints[0];
                        spawnX = (spawn.x + spawn.width / 2) * SCALE_FACTOR;
                        spawnY = (spawn.y + spawn.height / 2) * SCALE_FACTOR;
                    }
                }
            }

            // Initialize skills from saved progress or defaults
            const savedSkills: PlayerSkills = (savedProgress as any)?.skills || {};

            // Use the saved TP if it was explicitly persisted (authoritative),
            // otherwise reconcile it from level minus what the tree cost. This
            // prevents TP duplication when refreshing/re-authenticating.
            const hasSavedTP = savedProgress && (savedProgress as any).tp !== undefined;
            const currentTP = hasSavedTP ? (savedProgress as any).tp : reconcileTP(level, savedSkills);

            // The maze's own permanent progression track, parked until the
            // player actually enters the maze (enterMazeProgression swaps it in).
            const mazeTotalXP: number = (savedProgress as any)?.mazeTotalXP || 0;
            const mazeSkills: PlayerSkills = (savedProgress as any)?.mazeSkills || {};
            const hasSavedMazeTP = savedProgress && (savedProgress as any).mazeTp !== undefined;
            const mazeTP = hasSavedMazeTP
                ? (savedProgress as any).mazeTp
                : reconcileTP(calculateLevelFromTotalXP(mazeTotalXP), mazeSkills);

            // Reconstruct loadout from saved data (only type/rarity/petalType saved)
            const reconstructLoadout = (savedLoadout: any[] | undefined): (Item | null)[] => {
                if (!savedLoadout || !Array.isArray(savedLoadout)) {
                    return createInitialBasicPetals().concat(Array(5).fill(null));
                }
                return savedLoadout.map((item: any) => {
                    if (!item || !item.type) return null;
                    if (item.type === 'petal' && item.petalType) {
                        const petalStats = getPetalStats(item.petalType, item.rarity || 'common');
                        if (petalStats) {
                            const petalHealthMultiplier = getSkillMultiplier(savedSkills.petalHealth);
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
            const reconstructedMazeLoadout: (Item | null)[] | undefined =
                Array.isArray((savedProgress as any)?.mazeLoadout)
                    ? reconstructLoadout((savedProgress as any).mazeLoadout)
                    : undefined;

            const sessionPlayer: ServerPlayer = {
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
                inventory: savedProgress?.inventory ? dictToInventory(savedProgress.inventory as any) : createInitialInventory(),
                loadout: reconstructedLoadout,
                mazeLoadout: reconstructedMazeLoadout,
                isInvulnerable: true,
                level: level,
                xp: currentLevelXP,
                xpToNextLevel: calculateXPRequirement(level),
                knockbackX: 0,
                knockbackY: 0,
                inputs: { keys: [] },
                speed_boost: 1,
                tp: currentTP,
                skills: savedSkills,
                mazeTotalXP: mazeTotalXP,
                mazeTp: mazeTP,
                mazeSkills: mazeSkills,
                mobKills: (savedProgress as any)?.mobKills || {},
                stars: (savedProgress as any)?.stars || 0,
                renderFlags: (savedProgress as any)?.renderFlags || 0,
                equippedSkinId: (savedProgress as any)?.equippedSkinId || '',
                spawnBiome: spawnBiome,
                inPvpArena: false,
                inMaze: spawnBiome === 'maze',
                pvpScore: 0
            };

            // The one line that decides whether this client is playing or just
            // looking at the title screen. `players` is the world; `lobbyPlayers`
            // is not reachable from any world loop.
            if (lobby) lobbyPlayers[socket.id] = sessionPlayer;
            else players[socket.id] = sessionPlayer;

            // If the player chose PVP from the title screen, swap to the PVP
            // loadout/inventory now (this also stashes the regular versions and
            // recalcs stats to apply the PVP-fixed max health).
            if (spawnBiome === 'pvp') {
                enterPvpArena(sessionPlayer, io);
            } else {
                if (sessionPlayer.inMaze) {
                    // Maze entry: the regular loadout is stashed pristine and the
                    // player runs on a derived loadout that drops one rarity, with
                    // over-cap petals benched (saves persist the pristine stash, so
                    // the regular loadout is never changed), and the absorb baseline
                    // is snapshotted — all before pets/cooldowns are set up below.
                    enterMazeState(sessionPlayer, io);
                }
                // Recalculate player stats with modifiers after loadout is set
                recalculatePlayerStats(sessionPlayer, io);
            }

            // Start cooldown timers for all petals that are on cooldown.
            // World state, so a lobby session gets none: it has no flower for a
            // pet to orbit, and its loadout is rebuilt from disk on entry.
            const player = lobby ? null : sessionPlayer;
            if (player && player.loadout) {
                for (let i = 0; i < player.loadout.length; i++) {
                    // Secondary loadout (slots 10+) is storage only — no pets, no cooldowns.
                    if (i >= 10) break;
                    const petal = player.loadout[i];
                    if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                        const petalStats = getPetalStats(petal.petalType, petal.rarity);

                        // Spawn pets for equipped petals with petMobType (only if not on cooldown)
                        if (petalStats?.petMobType && !petal.onCooldown && petal.rarity) {
                            const petMobType = petalStats.petMobType;
                            // Pet inherits the petal's rarity
                            // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${player.id} on spawn`);
                            spawnPet(petMobType, petal.rarity, player.x, player.y, player.id, io, false, petalStats.petCount ?? 1);
                        }

                        // Handle cooldown timers
                        if (petal.onCooldown && petalStats) {
                            const cooldownTime = getEffectivePetalCooldown(petal.petalType, petal.rarity, petalStats);
                            // Stamp the deadline the tick-loop backstop reads, so the
                            // spawn-in reload isn't cut short by it (or left without an
                            // end if this timer dies with the process).
                            petal.cooldownEndTime = Date.now() + cooldownTime;
                            const timeoutKey = `${socket.id}-${i}`;
                            // Snapshot identity so a stale timer doesn't clobber a swapped slot
                            const snapshotPetalType = petal.petalType;
                            const snapshotRarity = petal.rarity;
                            const timeout = setTimeout(() => {
                                petalCooldownTimeouts.delete(timeoutKey);
                                const current = players[socket.id]?.loadout[i];
                                if (!players[socket.id] || !current || !current.onCooldown) return;
                                if (current.type !== 'petal' ||
                                    current.petalType !== snapshotPetalType ||
                                    current.rarity !== snapshotRarity) return;
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
                                    applyPetalHealthBonus(restoredPetal, players[socket.id]);
                                    players[socket.id].loadout[i] = restoredPetal;

                                    io.emit('petalRestored', {
                                        playerId: players[socket.id].id,
                                        slotIndex: i,
                                        petal: players[socket.id].loadout[i]
                                    });

                                    // Spawn pet when petal is restored (if it has petMobType)
                                    if (petalStats.petMobType && petal.rarity) {
                                        const petMobType = petalStats.petMobType;
                                        // Pet inherits the petal's rarity
                                        const restoredPlayer = players[socket.id];
                                        if (restoredPlayer && !restoredPlayer.isDead) {
                                            // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${restoredPlayer.id} when petal restored on spawn`);
                                            spawnPet(petMobType, petal.rarity, restoredPlayer.x, restoredPlayer.y, restoredPlayer.id, io, false, petalStats.petCount ?? 1);
                                        }
                                    }
                                }
                            }, cooldownTime);
                            petalCooldownTimeouts.set(timeoutKey, timeout);
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
                    if (players[socket.id]) {
                        players[socket.id].isInvulnerable = false;
                        // Notify client that invulnerability has ended
                        io.emit('playerInvulnerabilityEnded', { playerId: socket.id });
                    }
                }, RESPAWN_INVULNERABILITY_TIME);
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
                const mazeNow = getActiveMaze();
                const biomeName = mazeNow ? mazeNow.biome.charAt(0).toUpperCase() + mazeNow.biome.slice(1) : '';
                socket.emit('chatMessage', {
                    sender: 'System',
                    content: `<span style="color: #c77dff;">Entered the ${biomeName} Maze. Your equipped petals act one rarity lower in here and return to normal when you leave. You cannot equip new petals in the maze — set up your loadout on the title screen before entering. Petals found in the maze enter your inventory one rarity higher; petals above Ultra are unequipped at the entrance. The maze has its own level, talent points and talent tree, kept separately from your outside ones: only absorbing raises your maze level, while mobs killed in here give XP to your outside level.</span>`,
                    timestamp: Date.now()
                });
            }

            // Send the user's current guild (if any) and notify online guild members so online list refreshes.
            if (socket.username) {
                const userGuild = getGuildForUsername(socket.username);
                if (userGuild) {
                    sessionPlayer.guildName = userGuild.name;
                    broadcastGuildUpdate(userGuild, io);
                    syncGuildToOnlineMembers([socket.username], userGuild, io);
                } else {
                    socket.emit('guildUpdate', null);
                }
            }

            // Send the full catalog of published user-created skins plus this
            // client's admin flag (used only to show/hide the takedown button —
            // deletes are re-checked server-side). Seeds the client skin registry
            // so remote players wearing custom skins render correctly.
            socket.emit('skinsUpdate', {
                skins: database.getAllCustomSkins(),
                isAdmin: socket.username ? database.isUserAdmin(socket.username) : false,
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
                socket.emit('currentPlayers', sanitizePlayersForClient(players, socket.id));
                // Only send enemies in viewport with 200% buffer on connection
                const enemiesInViewport = getEnemiesInViewport200Percent();
                socket.emit('enemiesUpdate', enemiesInViewport);
                socket.emit('obstaclesUpdate', obstacles);

                // Filter items to only send ones this player is eligible for and hasn't picked up yet
                socket.emit('itemsUpdate', getEligibleItemsForSocket(socket.id));

                socket.emit('decorationsUpdate', decorations);
                socket.emit('sandsUpdate', sands);

                // Notify other players
                socket.broadcast.emit('newPlayer', sanitizePublicPlayerForClient(sessionPlayer));
            }
        } else {
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
    const endPlayerSession = (removeListeners: boolean) => {
        console.log('A user disconnected');

        // A temporary admin grant is scoped to one life in one session — it must
        // not survive a return to the title screen and a fresh spawn either.
        revokeTempAdmin(socket.id);

        // A title-screen session has no world state to tear down, but it does
        // hold account state (talent spends, shop buys) that the 60s autosave
        // never sees — it only walks `players`. Flush it before dropping it.
        const lobbyPlayer = lobbyPlayers[socket.id];
        if (lobbyPlayer) {
            delete lobbyPlayers[socket.id];
            if (socket.userId) savePlayerProgressImmediate(lobbyPlayer, socket.userId);
        }

        // Clean up squad membership
        handleSquadDisconnect(socket.id, io);

        // Refresh online status for this user's guildmates (guild itself is persistent).
        if (socket.username) {
            const userGuild = getGuildForUsername(socket.username);
            if (userGuild) {
                // Delay one tick so this socket is already removed from io.sockets before recomputing online list.
                const leavingUsername = socket.username;
                setImmediate(() => {
                    const g = getGuildForUsername(leavingUsername);
                    if (g) broadcastGuildUpdate(g, io);
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
            if (players[originalId] && socket.userId) {
                savePlayerProgressImmediate(players[originalId], socket.userId);
            }

            // Clean up petal cooldown timeouts for both split players
            const splitPlayerIds = [splitState.player1.id, splitState.player2.id, originalId];
            for (const playerId of splitPlayerIds) {
                for (let i = 0; i < 10; i++) {
                    const timeoutKey = `${playerId}-${i}`;
                    const timeout = petalCooldownTimeouts.get(timeoutKey);
                    if (timeout) {
                        clearTimeout(timeout);
                        petalCooldownTimeouts.delete(timeoutKey);
                    }
                }

                // Clean up petalLastProjectileTime entries
                const keysToDelete: string[] = [];
                petalLastProjectileTime.forEach((value, key) => {
                    if (key.startsWith(playerId)) {
                        keysToDelete.push(key);
                    }
                });
                keysToDelete.forEach(key => {
                    petalLastProjectileTime.delete(key);
                    petalLastRadiationTime.delete(key);
                });

                // Clean up petal physics states
                cleanupPetalPhysicsStates(playerId);
                cleanupPlayerPetalActionState(playerId);

                // Remove player from players map
                delete players[playerId];
                delete playerUserIds[playerId];
                knownMobProjectilesByPlayer.delete(playerId);
                knownPlayerProjectilesByPlayer.delete(playerId);

                // Emit playerDisconnected event for this split player
                io.emit('playerDisconnected', playerId);
            }

            // Despawn all pets owned by any of the split players
            for (const playerId of splitPlayerIds) {
                despawnAllPlayerPets(playerId, io);
            }

            // Remove split state
            splitPlayers.delete(originalId);
        } else {
            // Normal player - standard cleanup
            if (players[socket.id] && socket.userId) {
                // console.log('Saving player progress for userId:', socket.userId);
                savePlayerProgressImmediate(players[socket.id], socket.userId);
            }

            // Clean up petal cooldown timeouts for this player
            for (let i = 0; i < 10; i++) {
                const timeoutKey = `${socket.id}-${i}`;
                const timeout = petalCooldownTimeouts.get(timeoutKey);
                if (timeout) {
                    clearTimeout(timeout);
                    petalCooldownTimeouts.delete(timeoutKey);
                }
            }

            // Clean up petalLastProjectileTime entries for this player
            const keysToDelete: string[] = [];
            petalLastProjectileTime.forEach((value, key) => {
                if (key.startsWith(socket.id)) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(key => {
                petalLastProjectileTime.delete(key);
                petalLastRadiationTime.delete(key);
            });

            // Clean up petal physics states for this player
            cleanupPetalPhysicsStates(socket.id);
            cleanupPlayerPetalActionState(socket.id);

            // Despawn all pets owned by this player
            despawnAllPlayerPets(socket.id, io);

            delete players[socket.id];
            delete playerUserIds[socket.id]; // Clean up the mapping
            knownMobProjectilesByPlayer.delete(socket.id);
            knownPlayerProjectilesByPlayer.delete(socket.id);
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
                .filter((s: any) => (s as AuthenticatedSocket).userId);
            if (authenticatedSockets.length > 0) {
                io.emit('playerDisconnected', socket.id);
            }
        }

        // Trigger viewport update when player disconnects (only if there are authenticated players)
        if (Object.keys(players).length > 0) {
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

    socket.on('collectDot', (dotIndex: number) => {
        if (dotIndex >= 0 && dotIndex < dots.length) {
            dots.splice(dotIndex, 1);
            players[socket.id].score++;
            io.emit('dotCollected', { playerId: socket.id, dotIndex });
            // Generate a new dot
            dots.push({
                x: Math.random() * 800,
                y: Math.random() * 600
            });
        }
    });

    socket.on('ping', (clientTime: number) => {
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
        } else if (socket.averagePing > 100) {
            socket.connectionQuality = 'medium';
        } else {
            socket.connectionQuality = 'good';
        }
    });

    // Handle respawn request
    socket.on('requestRespawn', () => {
        // Respawn the half the client is actually driving: when the splitter
        // clone dies, `players[socket.id]` is the OTHER half and still alive,
        // so this used to silently do nothing and the death screen never left.
        const player = getActivePlayerForSocket(socket.id);
        if (player && player.isDead) {
            respawnPlayer(player);
            player.isDead = false;
            io.emit('playerRespawned', player);
        }
    });
}
