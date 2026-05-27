import https from 'https';
import http from 'http';
import { Server as SocketIOServer } from '../ws_server';
import type { UApp } from './uws_app';
import { ServerPlayer } from '../player';
import {
    WORLD_HEIGHT,
    getServerConfigByPort,
    ServerConfig,
    players
} from '../constants';
import { playerUserIds } from './gameState';
import { savePlayerProgress } from './playerManager';

/**
 * Setup cross-server transfer endpoints
 */
export function setupTransferEndpoints(
    app: UApp,
    io: SocketIOServer,
    currentServerConfig: ServerConfig,
    currentServerPort: number
) {
    // Cross-server player transfer endpoints
    app.post('/transfer/player', (req, res) => {
        const { playerData, targetX, targetY } = req.body;
        
        if (!playerData) {
            return res.status(400).json({ message: 'Player data is required' });
        }
        
        try {
            // Handle incoming player transfer from another server
            console.log(`[SERVER ${currentServerConfig.name}] Receiving transferred player: ${playerData.name}`);
            
            // Create a temporary socket ID for the transferred player
            const tempSocketId = `transfer_${Date.now()}_${Math.random()}`;
            
            // Add the transferred player to this server
            const transferToken = Math.random().toString(36).substr(2, 9);
            players[tempSocketId] = {
                ...playerData,
                id: tempSocketId,
                x: targetX || 200,
                y: targetY || WORLD_HEIGHT / 2,
                isTransferred: true, // Mark as transferred so client can reconnect
                transferToken: transferToken // Token for client to claim this player
            };
            
            // Set a timeout to clean up unclaimed transfers after 30 seconds
            setTimeout(() => {
                if (players[tempSocketId] && players[tempSocketId].isTransferred) {
                    console.log(`[SERVER ${currentServerConfig.name}] Cleaning up unclaimed transfer: ${tempSocketId}`);
                    delete players[tempSocketId];
                }
            }, 30000);
            
            res.json({ 
                success: true, 
                tempPlayerId: tempSocketId,
                transferToken: players[tempSocketId].transferToken,
                serverInfo: currentServerConfig
            });
            
        } catch (error) {
            console.error('Error handling player transfer:', error);
            res.status(500).json({ message: 'Failed to transfer player' });
        }
    });

    app.post('/transfer/claim', (req, res) => {
        const { transferToken, newSocketId } = req.body;
        
        if (!transferToken || !newSocketId) {
            return res.status(400).json({ message: 'Transfer token and new socket ID are required' });
        }
        
        // Find the transferred player by token
        const tempPlayerId = Object.keys(players).find(id => 
            players[id].transferToken === transferToken && players[id].isTransferred
        );
        
        if (!tempPlayerId) {
            return res.status(404).json({ message: 'Invalid transfer token or player not found' });
        }
        
        // Move player data to new socket ID
        const playerData = players[tempPlayerId];
        delete playerData.isTransferred;
        delete playerData.transferToken;
        playerData.id = newSocketId;
        
        players[newSocketId] = playerData;
        delete players[tempPlayerId];
        
        console.log(`[SERVER ${currentServerConfig.name}] Player transfer claimed: ${playerData.name} -> ${newSocketId}`);
        res.json({ success: true, playerData });
    });
}

/**
 * Transfer a player to another server
 */
export async function transferPlayerToServer(
    player: ServerPlayer, 
    targetServerPort: number, 
    targetX: number, 
    targetY: number,
    io: SocketIOServer,
    database: any,
    USE_HTTPS: boolean,
    currentServerConfig: ServerConfig,
    currentServerPort: number
): Promise<boolean> {
    const targetServerConfig = getServerConfigByPort(targetServerPort);
    
    if (!targetServerConfig) {
        console.error(`[SERVER ${currentServerConfig.name}] Target server config not found for port ${targetServerPort}`);
        return false;
    }
    
    if (targetServerPort === currentServerPort) {
        console.error(`[SERVER ${currentServerConfig.name}] Cannot transfer player to the same server`);
        return false;
    }
    
    try {
        // Save player progress before transfer
        const userId = playerUserIds[player.id];
        if (userId) {
            savePlayerProgress(player, userId, database);
        }
        
        // Prepare player data for transfer (remove socket-specific data)
        const playerDataForTransfer = {
            name: player.name,
            score: player.score,
            health: player.health,
            maxHealth: player.maxHealth,
            damage: player.damage,
            inventory: player.inventory,
            loadout: player.loadout,
            level: player.level,
            xp: player.xp,
            xpToNextLevel: player.xpToNextLevel,
            angle: player.angle,
            velocityX: 0,
            velocityY: 0,
            knockbackX: 0,
            knockbackY: 0,
            inputs: { keys: [] },
            speed_boost: player.speed_boost
        };
        
        // Create HTTPS request to target server
        const postData = JSON.stringify({
            playerData: playerDataForTransfer,
            targetX,
            targetY
        });
        
        const options = {
            hostname: targetServerConfig.host,
            port: targetServerConfig.port,
            path: '/transfer/player',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            // For self-signed certificates in development (only if using HTTPS)
            rejectUnauthorized: USE_HTTPS ? false : undefined
        };
        
        return new Promise((resolve) => {
            const req = USE_HTTPS ? 
                https.request(options, (res) => {
                    let responseData = '';
                    
                    res.on('data', (chunk) => {
                        responseData += chunk;
                    });
                    
                    res.on('end', () => {
                        try {
                            const response = JSON.parse(responseData);
                            if (response.success) {
                                console.log(`[SERVER ${currentServerConfig.name}] Successfully transferred player ${player.name} to ${targetServerConfig.name}`);
                                
                                // Notify client about successful transfer
                                io.to(player.id).emit('playerTransferred', {
                                    targetServer: targetServerConfig,
                                    transferToken: response.transferToken,
                                    targetX,
                                    targetY
                                });
                                
                                // Remove player from current server immediately
                                delete players[player.id];
                                delete playerUserIds[player.id];
                                io.emit('playerLeft', player.id);
                                
                                resolve(true);
                            } else {
                                console.error(`[SERVER ${currentServerConfig.name}] Failed to transfer player: ${response.message}`);
                                resolve(false);
                            }
                        } catch (error) {
                            console.error(`[SERVER ${currentServerConfig.name}] Error parsing transfer response:`, error);
                            resolve(false);
                        }
                    });
                }) :
                http.request(options, (res) => {
                    let responseData = '';
                    
                    res.on('data', (chunk) => {
                        responseData += chunk;
                    });
                    
                    res.on('end', () => {
                        try {
                            const response = JSON.parse(responseData);
                            if (response.success) {
                                console.log(`[SERVER ${currentServerConfig.name}] Successfully transferred player ${player.name} to ${targetServerConfig.name}`);
                                
                                // Notify client about successful transfer
                                io.to(player.id).emit('playerTransferred', {
                                    targetServer: targetServerConfig,
                                    transferToken: response.transferToken,
                                    targetX,
                                    targetY
                                });
                                
                                // Remove player from current server immediately
                                delete players[player.id];
                                delete playerUserIds[player.id];
                                io.emit('playerLeft', player.id);
                                
                                resolve(true);
                            } else {
                                console.error(`[SERVER ${currentServerConfig.name}] Failed to transfer player: ${response.message}`);
                                resolve(false);
                            }
                        } catch (error) {
                            console.error(`[SERVER ${currentServerConfig.name}] Error parsing transfer response:`, error);
                            resolve(false);
                        }
                    });
                });
            
            req.on('error', (error) => {
                console.error(`[SERVER ${currentServerConfig.name}] Error transferring player:`, error);
                resolve(false);
            });
            
            req.write(postData);
            req.end();
        });
        
    } catch (error) {
        console.error(`[SERVER ${currentServerConfig.name}] Error during player transfer:`, error);
        return false;
    }
}

