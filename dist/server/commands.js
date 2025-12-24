"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeServerCommand = executeServerCommand;
exports.handleAdminCommand = handleAdminCommand;
exports.setupStdinCommandHandler = setupStdinCommandHandler;
exports.getAdminHelpText = getAdminHelpText;
const database_1 = require("../database");
const mobs_1 = require("../mobs");
const constants_1 = require("../constants");
const gameState_1 = require("./gameState");
const server_1 = require("../server");
// Helper function to send message to admin or console
function sendOutput(message, socketId, io) {
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
function executeServerCommand(command, executor, deps, socketId) {
    const trimmedCommand = command.trim();
    const { io, savePlayerProgress, spawnMob, spawnSpecialMobs, createEnemy, adjustEnemyCount } = deps;
    if (executor) {
        sendOutput(`[ADMIN] ${executor} executed: ${trimmedCommand}`, socketId, io);
    }
    if (trimmedCommand.startsWith('save')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2) {
            const playerId = parts[1];
            const player = constants_1.players[playerId];
            const socket = io.sockets.sockets.get(playerId);
            if (player && socket?.userId) {
                savePlayerProgress(player, socket.userId);
                socket.emit('savePlayerProgress', player);
                sendOutput(`Saved player ${player.name} (${playerId})`, socketId, io);
            }
            else {
                sendOutput(`Player ${playerId} not found`, socketId, io);
            }
        }
        else if (parts.length === 1) {
            // Save all players
            let savedCount = 0;
            Object.entries(constants_1.players).forEach(([socketId, player]) => {
                const socket = io.sockets.sockets.get(socketId);
                if (socket?.userId) {
                    savePlayerProgress(player, socket.userId);
                    savedCount++;
                }
            });
            sendOutput(`Saved ${savedCount} player(s)`, socketId, io);
        }
    }
    else if (trimmedCommand === 'list-players') {
        const playerList = [];
        Object.entries(constants_1.players).forEach(([socketId, player]) => {
            playerList.push(`Player ID: ${socketId}, Name: ${player.name}, Level: ${player.level}`);
        });
        if (playerList.length === 0) {
            sendOutput('No players online', socketId, io);
        }
        else {
            sendOutput(`Players (${playerList.length}):`, socketId, io);
            playerList.forEach(msg => sendOutput(msg, socketId, io));
        }
    }
    else if (trimmedCommand === 'list-sockets') {
        const socketList = [];
        io.sockets.sockets.forEach((socket) => {
            socketList.push(`Socket ID: ${socket.id}`);
        });
        if (socketList.length === 0) {
            sendOutput('No sockets connected', socketId, io);
        }
        else {
            sendOutput(`Sockets (${socketList.length}):`, socketId, io);
            socketList.forEach(msg => sendOutput(msg, socketId, io));
        }
    }
    else if (trimmedCommand.startsWith('set_max_enemies')) {
        const newCount = parseInt(trimmedCommand.split(' ')[1]);
        if (!isNaN(newCount) && newCount >= 0) {
            gameState_1.ENEMY_COUNT.value = newCount;
            sendOutput(`Max enemies set to ${gameState_1.ENEMY_COUNT.value}`, socketId, io);
            adjustEnemyCount();
        }
        else {
            sendOutput('Invalid enemy count. Please provide a valid number.', socketId, io);
        }
    }
    else if (trimmedCommand === 'spawn_special_mobs') {
        spawnSpecialMobs();
        sendOutput('Special mobs spawned', socketId, io);
    }
    else if (trimmedCommand.startsWith('spawn')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 3) {
            // spawn <mobType> <rarity>
            const mobType = parts[1];
            const rarity = parts[2];
            spawnMob(mobType, rarity);
            sendOutput(`Spawned ${rarity} ${mobType}`, socketId, io);
        }
        else if (parts.length === 5) {
            // spawn <mobType> <rarity> <x> <y>
            const mobType = parts[1];
            const rarity = parts[2];
            const x = parseFloat(parts[3]);
            const y = parseFloat(parts[4]);
            if (isNaN(x) || isNaN(y)) {
                sendOutput('Invalid coordinates. Usage: spawn <mobType> <rarity> [x] [y]', socketId, io);
            }
            else {
                spawnMob(mobType, rarity, x, y);
                sendOutput(`Spawned ${rarity} ${mobType} at (${x}, ${y})`, socketId, io);
            }
        }
        else {
            sendOutput('Usage: spawn <mobType> <rarity> [x] [y]', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    spawn bee rare', socketId, io);
            sendOutput('    spawn octopus legendary 1000 2000', socketId, io);
            sendOutput(`Available mob types: ${(0, mobs_1.getAllMobTypes)().join(', ')}`, socketId, io);
            sendOutput('Valid rarities: common, uncommon, rare, epic, legendary, mythic, ultra, super, unique', socketId, io);
        }
    }
    else if (trimmedCommand.startsWith('teleport ') || trimmedCommand.startsWith('tp ')) {
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
            // Try to find player by ID first, then by name
            let targetPlayer;
            let targetPlayerId;
            // Check if it's a socket ID
            if (constants_1.players[playerIdentifier]) {
                targetPlayer = constants_1.players[playerIdentifier];
                targetPlayerId = playerIdentifier;
            }
            else {
                // Search by name
                for (const [socketId, player] of Object.entries(constants_1.players)) {
                    if (player.name.toLowerCase() === playerIdentifier.toLowerCase()) {
                        targetPlayer = player;
                        targetPlayerId = socketId;
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
            }
            else {
                sendOutput(`Player "${playerIdentifier}" not found. Use list-players to see available players.`, socketId, io);
            }
        }
        else {
            sendOutput('Usage: teleport <playerId/name> <x> <y>', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    teleport abc123 1000 2000', socketId, io);
            sendOutput('    teleport PlayerName 5000 3000', socketId, io);
            sendOutput('    tp abc123 1000 2000  (shorthand)', socketId, io);
        }
    }
    else if (trimmedCommand.startsWith('generate_code') || trimmedCommand.startsWith('gen_code')) {
        // generate_code <stars> [maxUses] (default maxUses is 1)
        const parts = trimmedCommand.split(' ');
        if (parts.length >= 2) {
            const stars = parseInt(parts[1]);
            // Default maxUses to 1 if not specified, or -1 for unlimited if explicitly set to 0
            let maxUses = 1; // Default to 1
            if (parts.length >= 3) {
                const maxUsesInput = parseInt(parts[2]);
                if (maxUsesInput === 0) {
                    maxUses = undefined; // 0 means unlimited
                }
                else if (!isNaN(maxUsesInput) && maxUsesInput > 0) {
                    maxUses = maxUsesInput;
                }
            }
            if (isNaN(stars) || stars <= 0) {
                sendOutput('Invalid stars amount. Usage: generate_code <stars> [maxUses]', socketId, io);
                sendOutput('  Default maxUses is 1. Use 0 for unlimited.', socketId, io);
                return;
            }
            // Generate a unique code
            let code;
            let attempts = 0;
            do {
                code = generateCode();
                attempts++;
                if (attempts > 100) {
                    sendOutput('Failed to generate unique code after 100 attempts', socketId, io);
                    return;
                }
            } while (server_1.redeemedCodes.has(code));
            // Create the code entry
            const codeData = {
                code: code,
                stars: stars,
                maxUses: maxUses,
                uses: 0,
                usedBy: [],
                createdBy: executor,
                createdAt: Date.now()
            };
            server_1.redeemedCodes.set(code, codeData);
            (0, server_1.saveCodeToDatabase)(code, codeData);
            sendOutput('[CODE GENERATED]', socketId, io);
            sendOutput(`Code: ${code}`, socketId, io);
            sendOutput(`Stars: ${stars}`, socketId, io);
            if (maxUses) {
                sendOutput(`Max Uses: ${maxUses}`, socketId, io);
            }
            else {
                sendOutput('Max Uses: Unlimited', socketId, io);
            }
            sendOutput(`Created by: ${executor || 'Console'}`, socketId, io);
            sendOutput('Players can redeem this code in the shop!', socketId, io);
        }
        else {
            sendOutput('Usage: generate_code <stars> [maxUses]', socketId, io);
            sendOutput('  Default maxUses is 1. Use 0 for unlimited.', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    generate_code 100  (single use)', socketId, io);
            sendOutput('    generate_code 500 10  (max 10 uses)', socketId, io);
            sendOutput('    generate_code 1000 0  (unlimited uses)', socketId, io);
            sendOutput('    gen_code 1000  (shorthand, single use)', socketId, io);
        }
    }
    else if (trimmedCommand === 'list_codes') {
        if (server_1.redeemedCodes.size === 0) {
            sendOutput('No codes have been generated.', socketId, io);
        }
        else {
            sendOutput(`[GENERATED CODES] (${server_1.redeemedCodes.size} total)`, socketId, io);
            server_1.redeemedCodes.forEach((codeData, code) => {
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
    }
    else if (trimmedCommand.startsWith('delete_code ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2) {
            const code = parts[1].toUpperCase();
            if (server_1.redeemedCodes.has(code)) {
                server_1.redeemedCodes.delete(code);
                (0, server_1.deleteCodeFromDatabase)(code);
                sendOutput(`Code ${code} has been deleted.`, socketId, io);
            }
            else {
                sendOutput(`Code ${code} not found.`, socketId, io);
            }
        }
        else {
            sendOutput('Usage: delete_code <code>', socketId, io);
        }
    }
    else if (trimmedCommand.startsWith('notification ') || trimmedCommand.startsWith('notify ')) {
        // notification <type> <message> or notify <type> <message>
        const parts = trimmedCommand.split(' ');
        if (parts.length >= 3) {
            const type = parts[1].toLowerCase();
            const message = parts.slice(2).join(' '); // Join remaining parts as message
            // Validate type
            const validTypes = ['super_craft', 'unique_craft', 'star_code'];
            if (!validTypes.includes(type)) {
                sendOutput(`Invalid notification type. Valid types: ${validTypes.join(', ')}`, socketId, io);
                return;
            }
            // Create notification
            const notification = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: type,
                message: message,
                timestamp: Date.now()
            };
            database_1.database.addNotification(notification);
            sendOutput(`Notification created: ${message}`, socketId, io);
        }
        else {
            sendOutput('Usage: notification <type> <message>', socketId, io);
            sendOutput('  Or: notify <type> <message> (shorthand)', socketId, io);
            sendOutput('  Valid types: super_craft, unique_craft, star_code', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    notification star_code Special event starting now!', socketId, io);
            sendOutput('    notify unique_craft New unique petal discovered!', socketId, io);
        }
    }
    else if (trimmedCommand === 'clear_notifications' || trimmedCommand === 'clear_notifs') {
        const count = database_1.database.clearAllNotifications();
        sendOutput(`Cleared ${count} notification(s)`, socketId, io);
    }
}
// Generate a random code
function generateCode() {
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
function handleAdminCommand(message, socket, io, deps) {
    if (!socket.username)
        return false;
    // Check for admin commands (only admins can use /admin or /cmd)
    if ((message.startsWith('/admin ') || message.startsWith('/cmd ')) && socket.username) {
        const isAdmin = database_1.database.isUserAdmin(socket.username);
        if (isAdmin) {
            // Extract the command after /admin or /cmd
            const command = message.substring(message.indexOf(' ') + 1);
            executeServerCommand(command, socket.username, deps, socket.id);
            return true; // Message was handled
        }
        else {
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
function setupStdinCommandHandler(deps) {
    process.stdin.on('data', (data) => {
        const command = data.toString().trim();
        executeServerCommand(command, undefined, deps);
    });
}
/**
 * Get help text for admin commands (for /help command)
 */
function getAdminHelpText() {
    return '<br/><br/>Admin commands:<br/>' +
        '/admin <command> - Execute server command<br/>' +
        '/cmd <command> - Execute server command (alternative)<br/>' +
        'Available server commands: save, list-players, list-sockets, set_max_enemies, spawn_special_mobs, spawn <mobType> <rarity> [x] [y], teleport <playerId/name> <x> <y>, notification <type> <message>, clear_notifications';
}
