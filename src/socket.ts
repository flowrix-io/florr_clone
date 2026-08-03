import { io, Socket } from './ws_client';
import { registerSessionHandlers } from './net/handlers/session';
import { registerWorldHandlers } from './net/handlers/world';
import { registerItemHandlers } from './net/handlers/items';
import { registerProgressionHandlers } from './net/handlers/progression';
import { registerGameStateHandlers } from './net/handlers/gameState';
import { getPreconnectedSocket, setPreconnectedSocket } from './net/preconnect';

export { Socket };

export function initMultiPlayerMode(game: any, serverIp: string) {
    // Remove connecting message immediately
    const connectingDiv = document.getElementById('connectingDiv');
    if (connectingDiv) {
        connectingDiv.remove();
    }
    
    // Check if there's a preconnected socket available
    const preconnected = getPreconnectedSocket();
    if (preconnected && preconnected.connected) {
        console.log(`[CLIENT] Using preconnected socket (ID: ${preconnected.id})`);
        game.socket = preconnected;
        // Remove only the mapData listener from preconnect, keep all other listeners
        game.socket.removeAllListeners('mapData');
        // Clear the preconnected socket reference since we're now using it
        setPreconnectedSocket(null);
        // Socket is already connected
        console.log(`[CLIENT] Preconnected socket already connected, proceeding with authentication`);
    } else if (preconnected && !preconnected.connected) {
        console.log(`[CLIENT] Preconnected socket exists but not connected yet, creating new connection instead`);
        // If preconnected socket exists but isn't connected, create a new one
        setPreconnectedSocket(null);
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

/**
 * Attach every server-message handler for this client.
 *
 * The handlers used to be ~1680 lines inlined here. They are independent of one
 * another, so they now live in src/net/handlers/* grouped by concern, each
 * exporting one register*Handlers(game).
 */
function setupSocketListeners(game: any) {
    // Per-event wire-byte counters live on the WSClientSocket wrapper (see
    // ws_client.ts getEventStats). The wrapper records true encoded byte sizes,
    // so there is no JSON-stringify estimator here.
    registerSessionHandlers(game, setupSocketListeners);
    registerWorldHandlers(game);
    registerItemHandlers(game);
    registerProgressionHandlers(game);
    registerGameStateHandlers(game);
}
