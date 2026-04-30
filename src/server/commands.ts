import { Server as SocketIOServer, Socket } from '../ws_server';
import { ServerPlayer } from '../player';
import { Enemy } from '../server_utils';
import { database, RedeemedCode, Notification } from '../database';
import { getAllMobTypes } from '../mobs';
import { players, enemies, ENEMIES_PER_VIEWPORT } from '../constants';
import { ENEMY_COUNT } from './gameState';
import { redeemedCodes, saveCodeToDatabase, deleteCodeFromDatabase, scheduleRestart, cancelScheduledRestart, getScheduledRestartInfo } from '../server';
import { getAllPetalTypes, getPetalStats, RARITY_LEVELS } from '../petals';
import { addItem } from './playerManager';
import { setTargetBotCount, getTargetBotCount, MAX_BOT_COUNT } from './botManager';
import {
    forceJoinGuild,
    getGuildByName,
    listGuilds,
    broadcastGuildUpdate,
    sendGuildSystemMessage,
    findSocketIdByUsername as findGuildSocketIdByUsername,
    syncGuildToOnlineMembers,
    MAX_GUILD_SIZE
} from './guildManager';

// AuthenticatedSocket interface (matches definition in server.ts)
interface AuthenticatedSocket extends Socket {
    userId?: string;
    username?: string;
}

// Interface for command handler dependencies
export interface CommandHandlerDependencies {
    io: SocketIOServer;
    savePlayerProgress: (player: ServerPlayer, userId: string) => void;
    spawnMob: (mobType: string, rarity: string, x?: number, y?: number) => void;
    spawnSpecialMobs: () => void;
    createEnemy: () => Enemy | null;
    adjustEnemyCount: () => void;
}

// Helper function to send message to admin or console
function sendOutput(message: string, socketId?: string, io?: SocketIOServer): void {
    console.log(message);
    if (socketId && io) {
        io.to(socketId).emit('chatMessage', {
            sender: 'System',
            content: message.replace(/\n/g, '<br/>'),
            timestamp: Date.now()
        });
    }
}

/**
 * Execute a server command (can be called from stdin or chat)
 */
export function executeServerCommand(
    command: string, 
    executor: string | undefined,
    deps: CommandHandlerDependencies,
    socketId?: string
): void {
    const trimmedCommand = command.trim();
    const { io, savePlayerProgress, spawnMob, spawnSpecialMobs, createEnemy, adjustEnemyCount } = deps;
    
    if (executor) {
        sendOutput(`[ADMIN] ${executor} executed: ${trimmedCommand}`, socketId, io);
    }

    if (trimmedCommand.startsWith('save')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2) {
            const playerId = parts[1];
            const player = players[playerId];
            const socket = io.sockets.sockets.get(playerId) as AuthenticatedSocket;

            if (player && socket?.userId) {
                savePlayerProgress(player, socket.userId);
                socket.emit('savePlayerProgress', player);
                sendOutput(`Saved player ${player.name} (${playerId})`, socketId, io);
            } else {
                sendOutput(`Player ${playerId} not found`, socketId, io);
            }
        } else if (parts.length === 1) {
            // Save all players
            let savedCount = 0;
            Object.entries(players).forEach(([socketId, player]) => {
                const socket = io.sockets.sockets.get(socketId) as AuthenticatedSocket;
                if (socket?.userId) {
                    savePlayerProgress(player, socket.userId);
                    savedCount++;
                }
            });
            sendOutput(`Saved ${savedCount} player(s)`, socketId, io);
        }
    } else if (trimmedCommand === 'list-players') {
        const playerList: string[] = [];
        Object.entries(players).forEach(([socketId, player]) => {
            const socket = io.sockets.sockets.get(socketId) as AuthenticatedSocket;
            const username = socket?.username || 'Unknown';
            playerList.push(`Player ID: ${socketId}, Username: ${username}, Nickname: ${player.name}, Level: ${player.level}`);
        });
        if (playerList.length === 0) {
            sendOutput('No players online', socketId, io);
        } else {
            sendOutput(`Players (${playerList.length}):`, socketId, io);
            playerList.forEach(msg => sendOutput(msg, socketId, io));
        }
    } else if (trimmedCommand === 'list-sockets') {
        const socketList: string[] = [];
        io.sockets.sockets.forEach((socket) => {
            socketList.push(`Socket ID: ${socket.id}`);
        });
        if (socketList.length === 0) {
            sendOutput('No sockets connected', socketId, io);
        } else {
            sendOutput(`Sockets (${socketList.length}):`, socketId, io);
            socketList.forEach(msg => sendOutput(msg, socketId, io));
        }
    } else if (trimmedCommand.startsWith('set_max_enemies')) {
        const newCount = parseInt(trimmedCommand.split(' ')[1]);
        if (!isNaN(newCount) && newCount >= 0) {
            ENEMY_COUNT.value = newCount;
            sendOutput(`Max enemies set to ${ENEMY_COUNT.value}`, socketId, io);
            adjustEnemyCount();
        } else {
            sendOutput('Invalid enemy count. Please provide a valid number.', socketId, io);
        }
    } else if (trimmedCommand.startsWith('set_bot_count')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2 && parts[1].toLowerCase() === 'default') {
            setTargetBotCount(null);
            sendOutput('Bot count override cleared (using default formula).', socketId, io);
        } else {
            const newCount = parseInt(parts[1]);
            if (isNaN(newCount) || newCount < 0) {
                const current = getTargetBotCount();
                sendOutput(
                    `Usage: set_bot_count <0-${MAX_BOT_COUNT}|default> — current override: ${current === null ? 'default' : current}`,
                    socketId, io
                );
            } else if (newCount > MAX_BOT_COUNT) {
                sendOutput(`Bot count capped at ${MAX_BOT_COUNT}.`, socketId, io);
            } else {
                setTargetBotCount(newCount);
                sendOutput(`Bot count target set to ${newCount}.`, socketId, io);
            }
        }
    } else if (trimmedCommand === 'spawn_special_mobs') {
        spawnSpecialMobs();
        sendOutput('Special mobs spawned', socketId, io);
    } else if (trimmedCommand.startsWith('spawn')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 3) {
            // spawn <mobType> <rarity>
            const mobType = parts[1];
            const rarity = parts[2];
            spawnMob(mobType, rarity);
            sendOutput(`Spawned ${rarity} ${mobType}`, socketId, io);
        } else if (parts.length === 5) {
            // spawn <mobType> <rarity> <x> <y>
            const mobType = parts[1];
            const rarity = parts[2];
            const x = parseFloat(parts[3]);
            const y = parseFloat(parts[4]);
            if (isNaN(x) || isNaN(y)) {
                sendOutput('Invalid coordinates. Usage: spawn <mobType> <rarity> [x] [y]', socketId, io);
            } else {
                spawnMob(mobType, rarity, x, y);
                sendOutput(`Spawned ${rarity} ${mobType} at (${x}, ${y})`, socketId, io);
            }
        } else {
            sendOutput('Usage: spawn <mobType> <rarity> [x] [y]', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    spawn bee rare', socketId, io);
            sendOutput('    spawn bee legendary 1000 2000', socketId, io);
            sendOutput(`Available mob types: ${getAllMobTypes().join(', ')}`, socketId, io);
            sendOutput('Valid rarities: common, uncommon, rare, epic, legendary, mythic, ultra, super, unique', socketId, io);
        }
    } else if (trimmedCommand.startsWith('teleport ') || trimmedCommand.startsWith('tp ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 4) {
            // teleport <playerId/name> <x> <y>
            const playerIdentifier = parts[1];
            const x = parseFloat(parts[2]);
            const y = parseFloat(parts[3]);
            
            if (isNaN(x) || isNaN(y)) {
                console.log('Invalid coordinates. Usage: teleport <playerId/name> <x> <y>');
                return;
            }
            
            // Try to find player by ID first, then by username
            let targetPlayer: ServerPlayer | undefined;
            let targetPlayerId: string | undefined;

            // Check if it's a socket ID
            if (players[playerIdentifier]) {
                targetPlayer = players[playerIdentifier];
                targetPlayerId = playerIdentifier;
            } else {
                // Search by username
                for (const [sid, player] of Object.entries(players)) {
                    const s = io.sockets.sockets.get(sid) as AuthenticatedSocket;
                    if (s?.username && s.username.toLowerCase() === playerIdentifier.toLowerCase()) {
                        targetPlayer = player;
                        targetPlayerId = sid;
                        break;
                    }
                }
            }

            if (targetPlayer && targetPlayerId) {
                // Teleport the player
                targetPlayer.x = x;
                targetPlayer.y = y;

                // Emit teleport event to client for visual effects
                io.to(targetPlayerId).emit('playerTeleported', {
                    newX: x,
                    newY: y,
                    playerId: targetPlayerId
                });

                sendOutput(`Teleported player ${targetPlayer.name} (${targetPlayerId}) to (${x}, ${y})`, socketId, io);
            } else {
                sendOutput(`Player "${playerIdentifier}" not found. Use list-players to see available players.`, socketId, io);
            }
        } else {
            sendOutput('Usage: teleport <playerId/username> <x> <y>', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    teleport abc123 1000 2000', socketId, io);
            sendOutput('    teleport Username 5000 3000', socketId, io);
            sendOutput('    tp abc123 1000 2000  (shorthand)', socketId, io);
        }
    } else if (trimmedCommand.startsWith('generate_code') || trimmedCommand.startsWith('gen_code')) {
        // generate_code <stars> [maxUses] (default maxUses is 1)
        const parts = trimmedCommand.split(' ');
        if (parts.length >= 2) {
            const stars = parseInt(parts[1]);
            // Default maxUses to 1 if not specified, or -1 for unlimited if explicitly set to 0
            let maxUses: number | undefined = 1; // Default to 1
            if (parts.length >= 3) {
                const maxUsesInput = parseInt(parts[2]);
                if (maxUsesInput === 0) {
                    maxUses = undefined; // 0 means unlimited
                } else if (!isNaN(maxUsesInput) && maxUsesInput > 0) {
                    maxUses = maxUsesInput;
                }
            }
            
            if (isNaN(stars) || stars <= 0) {
                sendOutput('Invalid stars amount. Usage: generate_code <stars> [maxUses]', socketId, io);
                sendOutput('  Default maxUses is 1. Use 0 for unlimited.', socketId, io);
                return;
            }
            
            // Generate a unique code
            let code: string;
            let attempts = 0;
            do {
                code = generateCode();
                attempts++;
                if (attempts > 100) {
                    sendOutput('Failed to generate unique code after 100 attempts', socketId, io);
                    return;
                }
            } while (redeemedCodes.has(code));
            
            // Create the code entry
            const codeData: RedeemedCode = {
                code: code,
                stars: stars,
                maxUses: maxUses,
                uses: 0,
                usedBy: [],
                createdBy: executor,
                createdAt: Date.now()
            };
            redeemedCodes.set(code, codeData);
            saveCodeToDatabase(code, codeData);
            
            sendOutput('[CODE GENERATED]', socketId, io);
            sendOutput(`Code: ${code}`, socketId, io);
            sendOutput(`Stars: ${stars}`, socketId, io);
            if (maxUses) {
                sendOutput(`Max Uses: ${maxUses}`, socketId, io);
            } else {
                sendOutput('Max Uses: Unlimited', socketId, io);
            }
            sendOutput(`Created by: ${executor || 'Console'}`, socketId, io);
            sendOutput('Players can redeem this code in the shop!', socketId, io);
        } else {
            sendOutput('Usage: generate_code <stars> [maxUses]', socketId, io);
            sendOutput('  Default maxUses is 1. Use 0 for unlimited.', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    generate_code 100  (single use)', socketId, io);
            sendOutput('    generate_code 500 10  (max 10 uses)', socketId, io);
            sendOutput('    generate_code 1000 0  (unlimited uses)', socketId, io);
            sendOutput('    gen_code 1000  (shorthand, single use)', socketId, io);
        }
    } else if (trimmedCommand === 'list_codes') {
        if (redeemedCodes.size === 0) {
            sendOutput('No codes have been generated.', socketId, io);
        } else {
            sendOutput(`[GENERATED CODES] (${redeemedCodes.size} total)`, socketId, io);
            redeemedCodes.forEach((codeData, code) => {
                sendOutput(`Code: ${code}`, socketId, io);
                sendOutput(`  Stars: ${codeData.stars}`, socketId, io);
                sendOutput(`  Uses: ${codeData.uses}${codeData.maxUses ? `/${codeData.maxUses}` : ' (unlimited)'}`, socketId, io);
                sendOutput(`  Created by: ${codeData.createdBy || 'Unknown'}`, socketId, io);
                if (codeData.createdAt) {
                    const date = new Date(codeData.createdAt);
                    sendOutput(`  Created: ${date.toLocaleString()}`, socketId, io);
                }
            });
        }
    } else if (trimmedCommand.startsWith('delete_code ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2) {
            const code = parts[1].toUpperCase();
            if (redeemedCodes.has(code)) {
                redeemedCodes.delete(code);
                deleteCodeFromDatabase(code);
                sendOutput(`Code ${code} has been deleted.`, socketId, io);
            } else {
                sendOutput(`Code ${code} not found.`, socketId, io);
            }
        } else {
            sendOutput('Usage: delete_code <code>', socketId, io);
        }
    } else if (trimmedCommand.startsWith('notification ') || trimmedCommand.startsWith('notify ')) {
        // notification <type> <message> or notify <type> <message>
        const parts = trimmedCommand.split(' ');
        if (parts.length >= 3) {
            const type = parts[1].toLowerCase();
            const message = parts.slice(2).join(' '); // Join remaining parts as message
            
            // Validate type
            const validTypes: Notification['type'][] = ['super_craft', 'unique_craft', 'star_code'];
            if (!validTypes.includes(type as Notification['type'])) {
                sendOutput(`Invalid notification type. Valid types: ${validTypes.join(', ')}`, socketId, io);
                return;
            }
            
            // Create notification
            const notification: Notification = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: type as Notification['type'],
                message: message,
                timestamp: Date.now()
            };
            
            database.addNotification(notification);
            sendOutput(`Notification created: ${message}`, socketId, io);
        } else {
            sendOutput('Usage: notification <type> <message>', socketId, io);
            sendOutput('  Or: notify <type> <message> (shorthand)', socketId, io);
            sendOutput('  Valid types: super_craft, unique_craft, star_code', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    notification star_code Special event starting now!', socketId, io);
            sendOutput('    notify unique_craft New unique petal discovered!', socketId, io);
        }
    } else if (trimmedCommand === 'clear_notifications' || trimmedCommand === 'clear_notifs') {
        const count = database.clearAllNotifications();
        sendOutput(`Cleared ${count} notification(s)`, socketId, io);
    } else if (trimmedCommand.startsWith('give ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 4) {
            // give <playerId/name> <itemType> <rarity>
            const playerIdentifier = parts[1];
            const itemType = parts[2].toLowerCase();
            const rarity = parts[3].toLowerCase();
            
            // Validate rarity
            if (!RARITY_LEVELS.includes(rarity as any)) {
                sendOutput(`Invalid rarity. Valid rarities: ${RARITY_LEVELS.join(', ')}`, socketId, io);
                return;
            }
            
            // Try to find player by ID first, then by username
            let targetPlayer: ServerPlayer | undefined;
            let targetPlayerId: string | undefined;
            let targetSocket: AuthenticatedSocket | undefined;

            // Check if it's a socket ID
            if (players[playerIdentifier]) {
                targetPlayer = players[playerIdentifier];
                targetPlayerId = playerIdentifier;
                targetSocket = io.sockets.sockets.get(playerIdentifier) as AuthenticatedSocket;
            } else {
                // Search by username
                for (const [sid, player] of Object.entries(players)) {
                    const s = io.sockets.sockets.get(sid) as AuthenticatedSocket;
                    if (s?.username && s.username.toLowerCase() === playerIdentifier.toLowerCase()) {
                        targetPlayer = player;
                        targetPlayerId = sid;
                        targetSocket = s;
                        break;
                    }
                }
            }
            
            if (targetPlayer && targetPlayerId) {
                // Check if it's a consumable item
                const consumableTypes = ['health_potion', 'speed_boost', 'shield'];
                let itemKey: string;
                let itemDisplayName: string;
                
                if (consumableTypes.includes(itemType)) {
                    // It's a consumable
                    itemKey = itemType;
                    itemDisplayName = itemType;
                } else {
                    // It's a petal - validate it exists and has the specified rarity
                    const petalStats = getPetalStats(itemType, rarity);
                    if (!petalStats) {
                        sendOutput(`Petal type "${itemType}" does not exist or does not have rarity "${rarity}"`, socketId, io);
                        return;
                    }
                    
                    itemKey = `petal_${itemType}`;
                    itemDisplayName = `${itemType} petal`;
                }
                
                // Add item to player's inventory
                addItem(targetPlayer.inventory, rarity, itemKey, 1);
                
                // Emit inventory update to the player
                if (targetSocket) {
                    io.to(targetPlayerId).emit('inventoryUpdated', targetPlayer.inventory);
                }
                
                // Save player progress if user is authenticated
                if (targetSocket?.userId) {
                    savePlayerProgress(targetPlayer, targetSocket.userId);
                }
                
                sendOutput(`Gave ${rarity} ${itemDisplayName} to ${targetPlayer.name} (${targetPlayerId})`, socketId, io);
            } else {
                sendOutput(`Player "${playerIdentifier}" not found. Use list-players to see available players.`, socketId, io);
            }
        } else {
            sendOutput('Usage: give <playerId/username> <itemType> <rarity>', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    give abc123 basic rare', socketId, io);
            sendOutput('    give Username rose legendary', socketId, io);
            sendOutput('    give abc123 health_potion epic', socketId, io);
            sendOutput('  Item types:', socketId, io);
            sendOutput('    Petals: any petal type (e.g., basic, rose, stinger)', socketId, io);
            sendOutput('    Consumables: health_potion, speed_boost, shield', socketId, io);
            sendOutput(`  Valid rarities: ${RARITY_LEVELS.join(', ')}`, socketId, io);
        }
    } else if (trimmedCommand.startsWith('guild_force_join') || trimmedCommand.startsWith('guild_force') || trimmedCommand.startsWith('guild-force-join')) {
        // Admins reference guilds by name. Guild names can contain spaces, so parse
        // as: <command> <guild name tokens...> <username>. The last whitespace-
        // separated token is the username; everything in between is the guild name.
        const rest = trimmedCommand.replace(/^(guild_force_join|guild_force|guild-force-join)\s*/, '');
        const tokens = rest.trim().split(/\s+/).filter(t => t.length > 0);
        if (tokens.length < 2) {
            sendOutput('Usage: guild_force_join <guild name> <username>', socketId, io);
        } else {
            const targetUsername = tokens[tokens.length - 1];
            const guildName = tokens.slice(0, -1).join(' ');
            const { guild, prevGuild, error } = forceJoinGuild(guildName, targetUsername);
            if (error || !guild) {
                sendOutput(error || 'Force-join failed.', socketId, io);
            } else {
                sendOutput(`Force-joined ${targetUsername} into guild "${guild.name}".`, socketId, io);
                if (prevGuild && prevGuild.name !== guild.name) {
                    broadcastGuildUpdate(prevGuild, io);
                }
                syncGuildToOnlineMembers([targetUsername], guild, io);
                broadcastGuildUpdate(guild, io);
                sendGuildSystemMessage(guild, io, `${targetUsername} was added to the guild by an admin.`);
                const targetSid = findGuildSocketIdByUsername(targetUsername, io);
                if (targetSid) {
                    io.to(targetSid).emit('chatMessage', {
                        sender: 'System',
                        content: `<span style="color: #ffb74d;">You were added to guild "${guild.name}" by an admin.</span>`,
                        timestamp: Date.now()
                    });
                }
            }
        }
    } else if (trimmedCommand === 'guild_list' || trimmedCommand === 'list_guilds') {
        const all = listGuilds();
        if (all.length === 0) {
            sendOutput('No guilds exist.', socketId, io);
        } else {
            sendOutput(`Guilds (${all.length}):`, socketId, io);
            all.forEach(g => {
                sendOutput(`  "${g.name}" — ${g.memberUsernames.length}/${MAX_GUILD_SIZE} — leader @${g.leaderUsername}`, socketId, io);
            });
        }
    } else if (trimmedCommand.startsWith('guild_info') || trimmedCommand.startsWith('guild-info')) {
        const name = trimmedCommand.replace(/^(guild_info|guild-info)\s*/, '').trim();
        if (!name) {
            sendOutput('Usage: guild_info <guild name>', socketId, io);
        } else {
            const g = getGuildByName(name);
            if (!g) {
                sendOutput(`Guild "${name}" not found.`, socketId, io);
            } else {
                sendOutput(`"${g.name}" — leader @${g.leaderUsername} — ${g.memberUsernames.length}/${MAX_GUILD_SIZE}`, socketId, io);
                sendOutput(`Members: ${g.memberUsernames.join(', ')}`, socketId, io);
            }
        }
    } else if (trimmedCommand === 'delete_guests') {
        const count = database.deleteGuestAccounts();
        sendOutput(`Deleted ${count} guest account(s) and their player data.`, socketId, io);
    } else if (trimmedCommand === 'list_today_logins' || trimmedCommand === 'list_active') {
        const active = database.getTodayLogins();
        if (active.length === 0) {
            sendOutput('No accounts active in the last 24 hours.', socketId, io);
        } else {
            sendOutput(`Accounts active in last 24 hours (${active.length}):`, socketId, io);
            const now = Date.now();
            active.forEach(({ username, lastActiveAt }) => {
                const minutesAgo = Math.floor((now - lastActiveAt) / 60000);
                const when = minutesAgo < 1
                    ? 'just now'
                    : minutesAgo < 60
                        ? `${minutesAgo}m ago`
                        : `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago`;
                sendOutput(`  ${username} — ${when}`, socketId, io);
            });
        }
    } else if (trimmedCommand === 'restart' || trimmedCommand.startsWith('restart ')) {
        // restart                       -> default 60s
        // restart <seconds>             -> seconds
        // restart <number>(s|m|h)       -> with unit
        // restart cancel                -> cancel pending restart
        // restart status                -> show pending restart info
        const arg = trimmedCommand.slice('restart'.length).trim();
        if (arg === 'status' || arg === '') {
            if (arg === '') {
                // No arg = schedule default 60s
                const ok = scheduleRestart(60 * 1000, 'admin');
                if (ok) sendOutput('Restart scheduled in 60 seconds. Use "restart cancel" to abort.', socketId, io);
                else sendOutput('Cannot schedule: a restart is already firing.', socketId, io);
            } else {
                const info = getScheduledRestartInfo();
                if (!info) sendOutput('No restart scheduled.', socketId, io);
                else {
                    const m = Math.floor(info.remainingMs / 60000);
                    const s = Math.floor((info.remainingMs % 60000) / 1000);
                    sendOutput(`Restart scheduled in ${m}m ${s}s (reason: ${info.reason}).`, socketId, io);
                }
            }
        } else if (arg === 'cancel' || arg === 'abort') {
            const ok = cancelScheduledRestart();
            sendOutput(ok ? 'Pending restart cancelled.' : 'No pending restart to cancel.', socketId, io);
        } else {
            // Parse number with optional s/m/h suffix
            const match = arg.match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs)?$/i);
            if (!match) {
                sendOutput('Usage: restart [<seconds>|<N>(s|m|h)|cancel|status]', socketId, io);
            } else {
                const n = parseInt(match[1], 10);
                const unit = (match[2] || 's').toLowerCase();
                let ms = n * 1000;
                if (unit.startsWith('m') && !unit.startsWith('ms')) ms = n * 60 * 1000;
                else if (unit.startsWith('h')) ms = n * 60 * 60 * 1000;
                if (ms < 0 || !Number.isFinite(ms)) {
                    sendOutput('Invalid duration.', socketId, io);
                } else {
                    const ok = scheduleRestart(ms, 'admin');
                    if (ok) {
                        const totalSec = Math.round(ms / 1000);
                        sendOutput(`Restart scheduled in ${totalSec}s. Use "restart cancel" to abort.`, socketId, io);
                    } else {
                        sendOutput('Cannot schedule: a restart is already firing.', socketId, io);
                    }
                }
            }
        }
    }
}

// Generate a random code
function generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Handle admin command from chat message
 * Returns true if the message was handled as an admin command, false otherwise
 */
export function handleAdminCommand(
    message: string,
    socket: AuthenticatedSocket,
    io: SocketIOServer,
    deps: CommandHandlerDependencies
): boolean {
    if (!socket.username) return false;

    // Check for admin commands (only admins can use /admin or /cmd)
    if ((message.startsWith('/admin ') || message.startsWith('/cmd ')) && socket.username) {
        const isAdmin = database.isUserAdmin(socket.username);
        if (isAdmin) {
            // Extract the command after /admin or /cmd
            const command = message.substring(message.indexOf(' ') + 1);
            executeServerCommand(command, socket.username, deps, socket.id);
            return true; // Message was handled
        } else {
            // Not an admin - pretend command doesn't exist
            io.to(socket.id).emit('chatMessage', {
                sender: 'System',
                content: 'Command does not exist.',
                timestamp: Date.now()
            });
            return true; // Message was handled (even if rejected)
        }
    }
    
    return false; // Message was not an admin command
}

/**
 * Setup stdin command handler
 */
export function setupStdinCommandHandler(deps: CommandHandlerDependencies): void {
    process.stdin.on('data', (data) => {
        const command = data.toString().trim();
        executeServerCommand(command, undefined, deps);
    });
}

/**
 * Get help text for admin commands (for /help command)
 */
export function getAdminHelpText(): string {
    return '<br/><br/>Admin commands:<br/>' +
           '/admin <command> - Execute server command<br/>' +
           '/cmd <command> - Execute server command (alternative)<br/>' +
           'Available server commands: save, list-players, list-sockets, set_max_enemies, set_bot_count <0-' + MAX_BOT_COUNT + '|default>, spawn_special_mobs, spawn <mobType> <rarity> [x] [y], teleport <playerId/username> <x> <y>, give <playerId/username> <rarity>, notification <type> <message>, clear_notifications, delete_guests, list_today_logins, guild_list, guild_info <guild name>, guild_force_join <guild name> <username>, restart [<N>(s|m|h)|cancel|status]';
}

