/**
 * Lightweight WebSocket server wrapper that provides a socket.io-compatible API.
 * Uses raw WebSocket (ws) for minimal protocol overhead.
 *
 * Message format: JSON arrays: ["eventName", ...args]
 * System events: ["__sys", type, data] for connection handshake
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { IncomingMessage, Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';

export class WSSocket {
    id: string;
    private ws: WebSocket;
    private handlers: Map<string, Set<(...args: any[]) => void>> = new Map();
    private onceHandlers: Map<string, Set<(...args: any[]) => void>> = new Map();
    private anyHandlers: Set<(event: string, ...args: any[]) => void> = new Set();
    private server: WSServer;
    private _connected: boolean = true;

    // Allow dynamic properties (userId, username, etc.)
    [key: string]: any;

    constructor(ws: WebSocket, id: string, server: WSServer) {
        this.ws = ws;
        this.id = id;
        this.server = server;

        ws.on('message', (raw: RawData) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (!Array.isArray(msg) || msg.length < 1) return;
                const [event, ...args] = msg;

                // Fire onAny handlers
                for (const handler of this.anyHandlers) {
                    handler(event, ...args);
                }

                // Fire event-specific handlers
                const handlers = this.handlers.get(event);
                if (handlers) {
                    for (const handler of handlers) {
                        handler(...args);
                    }
                }

                // Fire and remove once handlers
                const onceHandlers = this.onceHandlers.get(event);
                if (onceHandlers) {
                    for (const handler of onceHandlers) {
                        handler(...args);
                    }
                    this.onceHandlers.delete(event);
                }
            } catch (e) {
                // Ignore malformed messages
            }
        });

        ws.on('close', () => {
            this._connected = false;
            const handlers = this.handlers.get('disconnect');
            if (handlers) {
                for (const handler of handlers) {
                    handler();
                }
            }
            server._removeSocket(this.id);
        });

        ws.on('error', () => {
            // Handled by close event
        });
    }

    get connected(): boolean {
        return this._connected && this.ws.readyState === WebSocket.OPEN;
    }

    on(event: string, handler: (...args: any[]) => void): this {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(handler);
        return this;
    }

    once(event: string, handler: (...args: any[]) => void): this {
        if (!this.onceHandlers.has(event)) {
            this.onceHandlers.set(event, new Set());
        }
        this.onceHandlers.get(event)!.add(handler);
        return this;
    }

    onAny(handler: (event: string, ...args: any[]) => void): this {
        this.anyHandlers.add(handler);
        return this;
    }

    emit(event: string, ...args: any[]): boolean {
        if (this.ws.readyState !== WebSocket.OPEN) return false;
        try {
            this.ws.send(JSON.stringify([event, ...args]));
            return true;
        } catch {
            return false;
        }
    }

    removeAllListeners(event?: string): this {
        if (event) {
            this.handlers.delete(event);
            this.onceHandlers.delete(event);
        } else {
            this.handlers.clear();
            this.onceHandlers.clear();
            this.anyHandlers.clear();
        }
        return this;
    }

    listeners(event: string): Function[] {
        return Array.from(this.handlers.get(event) || []);
    }

    disconnect(): void {
        this._connected = false;
        try {
            this.ws.close();
        } catch {
            // Already closed
        }
    }

    get broadcast() {
        const self = this;
        return {
            emit(event: string, ...args: any[]) {
                self.server._broadcastExcept(self.id, event, ...args);
            }
        };
    }
}

export class WSServer {
    private wss: WebSocketServer;
    private sockets_map: Map<string, WSSocket> = new Map();
    private connectionHandlers: Set<(socket: WSSocket) => void> = new Set();

    // Compatible with io.sockets.sockets
    sockets = {
        sockets: this.sockets_map
    };

    constructor(httpServer: HttpServer, _options?: any) {
        this.sockets.sockets = this.sockets_map;

        this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

        this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
            const id = randomUUID().replace(/-/g, '').slice(0, 20);
            const socket = new WSSocket(ws, id, this);
            this.sockets_map.set(id, socket);

            // Send the client its ID
            ws.send(JSON.stringify(['__sys', 'id', id]));

            // Notify connection handlers
            for (const handler of this.connectionHandlers) {
                handler(socket);
            }
        });
    }

    on(event: 'connection', handler: (socket: WSSocket) => void): this {
        if (event === 'connection') {
            this.connectionHandlers.add(handler);
        }
        return this;
    }

    /** Broadcast to all connected clients */
    emit(event: string, ...args: any[]): void {
        const msg = JSON.stringify([event, ...args]);
        for (const [, socket] of this.sockets_map) {
            if (socket.connected) {
                try {
                    socket.emit(event, ...args);
                } catch {
                    // Skip failed sends
                }
            }
        }
    }

    /** Send to a specific client by ID */
    to(id: string) {
        const self = this;
        return {
            emit(event: string, ...args: any[]) {
                const socket = self.sockets_map.get(id);
                if (socket && socket.connected) {
                    socket.emit(event, ...args);
                }
            }
        };
    }

    /** @internal Remove a disconnected socket */
    _removeSocket(id: string): void {
        this.sockets_map.delete(id);
    }

    /** @internal Broadcast to all except one socket */
    _broadcastExcept(excludeId: string, event: string, ...args: any[]): void {
        for (const [id, socket] of this.sockets_map) {
            if (id !== excludeId && socket.connected) {
                socket.emit(event, ...args);
            }
        }
    }
}

// Re-export types for compatibility
export type { WSSocket as Socket };
export { WSServer as Server };
