/**
 * Lightweight WebSocket server wrapper that provides a socket.io-compatible API.
 * Uses raw WebSocket (ws) for minimal protocol overhead.
 *
 * Wire format: custom tag-based binary encoding of [eventName, ...args] arrays
 * (see binary_codec.ts). Sent as binary WebSocket frames. ~50–70% smaller than
 * the previous JSON-array format because numbers travel as 1–9 raw bytes
 * (vs. their decimal-string length) and repeated short property names cost
 * 1 + N bytes instead of `"name":` plus quotes.
 *
 * System events: ["__sys", type, data] for connection handshake.
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { IncomingMessage, Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { encode, decode } from './binary_codec';

// Per-event bandwidth profiling. Aggregated across all sockets; reset by the periodic
// logger in server.ts. The numbers reflect actual wire bytes (encoded length).
export interface EventByteStats { in: number; out: number; count_in: number; count_out: number; }
const eventByteStats: Map<string, EventByteStats> = new Map();
function recordBytes(event: string, bytes: number, dir: 'in' | 'out') {
    let s = eventByteStats.get(event);
    if (!s) { s = { in: 0, out: 0, count_in: 0, count_out: 0 }; eventByteStats.set(event, s); }
    if (dir === 'in') { s.in += bytes; s.count_in++; } else { s.out += bytes; s.count_out++; }
}
export function getServerEventStats(): Map<string, EventByteStats> { return eventByteStats; }
export function resetServerEventStats(): void { eventByteStats.clear(); }

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
                // `raw` is a Buffer, an array of fragmented Buffers, or an ArrayBuffer
                // depending on ws config. Normalize to a single Uint8Array for the codec.
                let bytes: Uint8Array;
                if (Array.isArray(raw)) {
                    bytes = Buffer.concat(raw);
                } else if (raw instanceof ArrayBuffer) {
                    bytes = new Uint8Array(raw);
                } else {
                    bytes = raw as Buffer;
                }
                const msg = decode(bytes) as any;
                if (!Array.isArray(msg) || msg.length < 1) return;
                if (typeof msg[0] === 'string') recordBytes(msg[0], bytes.byteLength, 'in');
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
            // Binary frame; ws sends Uint8Array as a binary WebSocket message.
            const payload = encode([event, ...args]);
            recordBytes(event, payload.byteLength, 'out');
            this.ws.send(payload);
            return true;
        } catch {
            return false;
        }
    }

    /** @internal Send a pre-encoded payload (used by WSServer.emit for broadcasts). */
    sendRaw(payload: Uint8Array, event?: string): boolean {
        if (this.ws.readyState !== WebSocket.OPEN) return false;
        try {
            this.ws.send(payload);
            if (event) recordBytes(event, payload.byteLength, 'out');
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

        // perMessageDeflate is disabled: ws's default zlib context is ~300 KB
        // per connection and compression only helps on large/repetitive frames.
        // This protocol's frames are small, frequent JSON arrays — the per-peer
        // memory cost outweighs the bandwidth savings.
        this.wss = new WebSocketServer({ server: httpServer, path: '/ws', perMessageDeflate: false });

        this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
            const id = randomUUID().replace(/-/g, '').slice(0, 20);
            const socket = new WSSocket(ws, id, this);
            this.sockets_map.set(id, socket);

            // Send the client its ID
            ws.send(encode(['__sys', 'id', id]));

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
        // Encode once, send to all peers. WSSocket.emit would re-encode per peer; here
        // we send the shared buffer directly to avoid N redundant encodes for broadcasts.
        const payload = encode([event, ...args]);
        for (const [, socket] of this.sockets_map) {
            if (socket.connected) {
                try {
                    socket.sendRaw(payload, event);
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
