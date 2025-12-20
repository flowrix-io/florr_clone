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
/**
 * Execute a server command (can be called from stdin or chat)
 */
function executeServerCommand(command, executor, deps) {
    const trimmedCommand = command.trim();
    const { io, savePlayerProgress, spawnMob, spawnSpecialMobs, createEnemy, adjustEnemyCount } = deps;
    if (executor) {
        console.log(`[ADMIN] ${executor} executed: ${trimmedCommand}`);
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
        }
    }
    else if (trimmedCommand === 'list-players') {
        Object.entries(constants_1.players).forEach(([socketId, player]) => {
            console.log(`Player ID: ${socketId}, Name: ${player.name}, Level: ${player.level}`);
        });
    }
    else if (trimmedCommand === 'list-sockets') {
        io.sockets.sockets.forEach((socket) => {
            console.log(`Socket ID: ${socket.id}`);
        });
    }
    else if (trimmedCommand.startsWith('set_max_enemies')) {
        const newCount = parseInt(trimmedCommand.split(' ')[1]);
        if (!isNaN(newCount) && newCount >= 0) {
            gameState_1.ENEMY_COUNT.value = newCount;
            console.log(`Max enemies set to ${gameState_1.ENEMY_COUNT.value}`);
            adjustEnemyCount();
        }
        else {
            console.log('Invalid enemy count. Please provide a valid number.');
        }
    }
    else if (trimmedCommand === 'spawn_special_mobs') {
        spawnSpecialMobs();
    }
    else if (trimmedCommand.startsWith('spawn')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 3) {
            // spawn <mobType> <rarity>
            const mobType = parts[1];
            const rarity = parts[2];
            spawnMob(mobType, rarity);
        }
        else if (parts.length === 5) {
            // spawn <mobType> <rarity> <x> <y>
            const mobType = parts[1];
            const rarity = parts[2];
            const x = parseFloat(parts[3]);
            const y = parseFloat(parts[4]);
            if (isNaN(x) || isNaN(y)) {
                console.log('Invalid coordinates. Usage: spawn <mobType> <rarity> [x] [y]');
            }
            else {
                spawnMob(mobType, rarity, x, y);
            }
        }
        else {
            console.log('Usage: spawn <mobType> <rarity> [x] [y]');
            console.log('  Examples:');
            console.log('    spawn bee rare');
            console.log('    spawn octopus legendary 1000 2000');
            console.log(`Available mob types: ${(0, mobs_1.getAllMobTypes)().join(', ')}`);
            console.log('Valid rarities: common, uncommon, rare, epic, legendary, mythic, ultra, super, unique');
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
                console.log(`Teleported player ${targetPlayer.name} (${targetPlayerId}) to (${x}, ${y})`);
            }
            else {
                console.log(`Player "${playerIdentifier}" not found. Use list-players to see available players.`);
            }
        }
        else {
            console.log('Usage: teleport <playerId/name> <x> <y>');
            console.log('  Examples:');
            console.log('    teleport abc123 1000 2000');
            console.log('    teleport PlayerName 5000 3000');
            console.log('    tp abc123 1000 2000  (shorthand)');
        }
    }
    else if (trimmedCommand.startsWith('generate_code') || trimmedCommand.startsWith('gen_code')) {
        // generate_code <stars> [maxUses]
        const parts = trimmedCommand.split(' ');
        if (parts.length >= 2) {
            const stars = parseInt(parts[1]);
            const maxUses = parts.length >= 3 ? parseInt(parts[2]) : undefined;
            if (isNaN(stars) || stars <= 0) {
                console.log('Invalid stars amount. Usage: generate_code <stars> [maxUses]');
                return;
            }
            // Generate a unique code
            let code;
            let attempts = 0;
            do {
                code = generateCode();
                attempts++;
                if (attempts > 100) {
                    console.log('Failed to generate unique code after 100 attempts');
                    return;
                }
            } while (server_1.redeemedCodes.has(code));
            // Create the code entry
            server_1.redeemedCodes.set(code, {
                code: code,
                stars: stars,
                maxUses: maxUses,
                uses: 0,
                usedBy: [],
                createdBy: executor,
                createdAt: Date.now()
            });
            console.log(`\n[CODE GENERATED]`);
            console.log(`Code: ${code}`);
            console.log(`Stars: ${stars}`);
            if (maxUses) {
                console.log(`Max Uses: ${maxUses}`);
            }
            else {
                console.log(`Max Uses: Unlimited`);
            }
            console.log(`Created by: ${executor || 'Console'}`);
            console.log(`\nPlayers can redeem this code in the shop!\n`);
        }
        else {
            console.log('Usage: generate_code <stars> [maxUses]');
            console.log('  Examples:');
            console.log('    generate_code 100');
            console.log('    generate_code 500 10  (max 10 uses)');
            console.log('    gen_code 1000  (shorthand)');
        }
    }
    else if (trimmedCommand === 'list_codes') {
        if (server_1.redeemedCodes.size === 0) {
            console.log('No codes have been generated.');
        }
        else {
            console.log('\n[GENERATED CODES]');
            server_1.redeemedCodes.forEach((codeData, code) => {
                console.log(`\nCode: ${code}`);
                console.log(`  Stars: ${codeData.stars}`);
                console.log(`  Uses: ${codeData.uses}${codeData.maxUses ? `/${codeData.maxUses}` : ' (unlimited)'}`);
                console.log(`  Created by: ${codeData.createdBy || 'Unknown'}`);
                if (codeData.createdAt) {
                    const date = new Date(codeData.createdAt);
                    console.log(`  Created: ${date.toLocaleString()}`);
                }
            });
            console.log('');
        }
    }
    else if (trimmedCommand.startsWith('delete_code ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2) {
            const code = parts[1].toUpperCase();
            if (server_1.redeemedCodes.has(code)) {
                server_1.redeemedCodes.delete(code);
                console.log(`Code ${code} has been deleted.`);
            }
            else {
                console.log(`Code ${code} not found.`);
            }
        }
        else {
            console.log('Usage: delete_code <code>');
        }
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
            executeServerCommand(command, socket.username, deps);
            // Send confirmation to admin
            io.to(socket.id).emit('chatMessage', {
                sender: 'System',
                content: `[ADMIN] Command executed: ${command}`,
                timestamp: Date.now()
            });
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
        'Available server commands: save, list-players, list-sockets, set_max_enemies, spawn_special_mobs, spawn <mobType> <rarity> [x] [y], teleport <playerId/name> <x> <y>';
}
