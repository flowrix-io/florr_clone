import { Server as SocketIOServer, Socket } from 'socket.io';
import { ServerPlayer } from '../player';
import { Enemy } from '../server_utils';
import { database } from '../database';
import { getAllMobTypes } from '../mobs';
import { players, enemies, ENEMIES_PER_VIEWPORT } from '../constants';
import { ENEMY_COUNT } from './gameState';

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

/**
 * Execute a server command (can be called from stdin or chat)
 */
export function executeServerCommand(
    command: string, 
    executor: string | undefined,
    deps: CommandHandlerDependencies
): void {
    const trimmedCommand = command.trim();
    const { io, savePlayerProgress, spawnMob, spawnSpecialMobs, createEnemy, adjustEnemyCount } = deps;
    
    if (executor) {
        console.log(`[ADMIN] ${executor} executed: ${trimmedCommand}`);
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
        }
    } else if (trimmedCommand === 'list-players') {
        Object.entries(players).forEach(([socketId, player]) => {
            console.log(`Player ID: ${socketId}, Name: ${player.name}, Level: ${player.level}`);
        });
    } else if (trimmedCommand === 'list-sockets') {
        io.sockets.sockets.forEach((socket) => {
            console.log(`Socket ID: ${socket.id}`);
        });
    } else if (trimmedCommand.startsWith('set_max_enemies')) {
        const newCount = parseInt(trimmedCommand.split(' ')[1]);
        if (!isNaN(newCount) && newCount >= 0) {
            ENEMY_COUNT.value = newCount;
            console.log(`Max enemies set to ${ENEMY_COUNT.value}`);
            adjustEnemyCount();
        } else {
            console.log('Invalid enemy count. Please provide a valid number.');
        }
    } else if (trimmedCommand === 'spawn_special_mobs') {
        spawnSpecialMobs();
    } else if (trimmedCommand.startsWith('spawn')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 3) {
            // spawn <mobType> <rarity>
            const mobType = parts[1];
            const rarity = parts[2];
            spawnMob(mobType, rarity);
        } else if (parts.length === 5) {
            // spawn <mobType> <rarity> <x> <y>
            const mobType = parts[1];
            const rarity = parts[2];
            const x = parseFloat(parts[3]);
            const y = parseFloat(parts[4]);
            if (isNaN(x) || isNaN(y)) {
                console.log('Invalid coordinates. Usage: spawn <mobType> <rarity> [x] [y]');
            } else {
                spawnMob(mobType, rarity, x, y);
            }
        } else {
            console.log('Usage: spawn <mobType> <rarity> [x] [y]');
            console.log('  Examples:');
            console.log('    spawn bee rare');
            console.log('    spawn octopus legendary 1000 2000');
            console.log(`Available mob types: ${getAllMobTypes().join(', ')}`);
            console.log('Valid rarities: common, uncommon, rare, epic, legendary, mythic, ultra, super, unique');
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
            
            // Try to find player by ID first, then by name
            let targetPlayer: ServerPlayer | undefined;
            let targetPlayerId: string | undefined;
            
            // Check if it's a socket ID
            if (players[playerIdentifier]) {
                targetPlayer = players[playerIdentifier];
                targetPlayerId = playerIdentifier;
            } else {
                // Search by name
                for (const [socketId, player] of Object.entries(players)) {
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
            } else {
                console.log(`Player "${playerIdentifier}" not found. Use list-players to see available players.`);
            }
        } else {
            console.log('Usage: teleport <playerId/name> <x> <y>');
            console.log('  Examples:');
            console.log('    teleport abc123 1000 2000');
            console.log('    teleport PlayerName 5000 3000');
            console.log('    tp abc123 1000 2000  (shorthand)');
        }
    }
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
            executeServerCommand(command, socket.username, deps);
            
            // Send confirmation to admin
            io.to(socket.id).emit('chatMessage', {
                sender: 'System',
                content: `[ADMIN] Command executed: ${command}`,
                timestamp: Date.now()
            });
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
           'Available server commands: save, list-players, list-sockets, set_max_enemies, spawn_special_mobs, spawn <mobType> <rarity> [x] [y], teleport <playerId/name> <x> <y>';
}

