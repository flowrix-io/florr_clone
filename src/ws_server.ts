/**
 * Lightweight WebSocket server wrapper that provides a socket.io-compatible API.
 * Now backed by uWebSockets.js for ~3-5× higher throughput and lower per-conn
 * memory than the previous `ws`-based implementation.
 *
 * Wire format: custom tag-based binary encoding of [eventName, ...args] arrays
 * (see binary_codec.ts). Sent as binary WebSocket frames.
 *
 * System events: ["__sys", type, data] for connection handshake.
 *
 * Integration: this module no longer owns the HTTP server. The caller creates
 * a UApp (see server/uws_app.ts), passes it in, then calls UApp.listen() *after*
 * constructing the Server (which registers the `/ws` upgrade route on the same app).
 */

import uWS, { WebSocket as UWS_WebSocket } from 'uWebSockets.js';
import type { UApp } from './server/uws_app';
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

interface SocketUserData {
    socket: WSSocket | null;
}

export class WSSocket {
    id: string;
    private ws: UWS_WebSocket<SocketUserData> | null;
    private handlers: Map<string, Set<(...args: any[]) => void>> = new Map();
    private onceHandlers: Map<string, Set<(...args: any[]) => void>> = new Map();
    private anyHandlers: Set<(event: string, ...args: any[]) => void> = new Set();
    private server: WSServer;
    private _connected: boolean = true;

    // Allow dynamic properties (userId, username, etc.)
    [key: string]: any;

    constructor(ws: UWS_WebSocket<SocketUserData>, id: string, server: WSServer) {
        this.ws = ws;
        this.id = id;
        this.server = server;
    }

    /** @internal Called by WSServer when uWS delivers a message frame. */
    _handleMessage(message: ArrayBuffer): void {
        try {
            // The ArrayBuffer is only valid during this sync handler — but we
            // decode synchronously and the decoder copies any embedded byte
            // payloads, so wrapping in a view (no copy) is safe.
            const bytes = new Uint8Array(message);
            const msg = decode(bytes) as any;
            if (!Array.isArray(msg) || msg.length < 1) return;
            if (typeof msg[0] === 'string') recordBytes(msg[0], bytes.byteLength, 'in');
            const [event, ...args] = msg;

            for (const handler of this.anyHandlers) {
                handler(event, ...args);
            }

            const handlers = this.handlers.get(event);
            if (handlers) {
                for (const handler of handlers) {
                    handler(...args);
                }
            }

            const onceHandlers = this.onceHandlers.get(event);
            if (onceHandlers) {
                for (const handler of onceHandlers) {
                    handler(...args);
                }
                this.onceHandlers.delete(event);
            }
        } catch {
            // Ignore malformed messages
        }
    }

    /** @internal Called by WSServer when uWS reports the connection closed. */
    _handleClose(): void {
        this._connected = false;
        this.ws = null;
        const handlers = this.handlers.get('disconnect');
        if (handlers) {
            for (const handler of handlers) {
                handler();
            }
        }
        this.server._removeSocket(this.id);
    }

    get connected(): boolean {
        return this._connected && this.ws !== null;
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
        if (!this.ws || !this._connected) return false;
        try {
            const payload = encode([event, ...args]);
            recordBytes(event, payload.byteLength, 'out');
            // (data, isBinary, compress) — compress=false matches the perMessageDeflate
            // disable from the previous `ws`-backed implementation.
            this.ws.send(payload, true, false);
            return true;
        } catch {
            return false;
        }
    }

    /** @internal Send a pre-encoded payload (used by WSServer.emit for broadcasts). */
    sendRaw(payload: Uint8Array, event?: string): boolean {
        if (!this.ws || !this._connected) return false;
        try {
            this.ws.send(payload, true, false);
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
        const ws = this.ws;
        this.ws = null;
        if (ws) {
            try { ws.close(); } catch { /* already closed */ }
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
    private sockets_map: Map<string, WSSocket> = new Map();
    private connectionHandlers: Set<(socket: WSSocket) => void> = new Set();

    // Compatible with io.sockets.sockets
    sockets = {
        sockets: this.sockets_map
    };

    constructor(uApp: UApp, _options?: any) {
        this.sockets.sockets = this.sockets_map;

        // perMessageDeflate is disabled: compression only helps on large/repetitive
        // frames. This protocol's frames are small, frequent binary arrays — the
        // per-peer compressor cost outweighs the bandwidth savings.
        uApp.ws<SocketUserData>('/ws', {
            compression: uWS.DISABLED,
            maxPayloadLength: 16 * 1024 * 1024,
            idleTimeout: 120,
            sendPingsAutomatically: true,

            open: (ws) => {
                const id = randomUUID().replace(/-/g, '').slice(0, 20);
                const socket = new WSSocket(ws, id, this);
                ws.getUserData().socket = socket;
                this.sockets_map.set(id, socket);

                // Send the client its ID
                ws.send(encode(['__sys', 'id', id]), true, false);

                // Notify connection handlers
                for (const handler of this.connectionHandlers) {
                    handler(socket);
                }
            },

            message: (ws, message, _isBinary) => {
                const socket = ws.getUserData().socket;
                if (socket) socket._handleMessage(message);
            },

            close: (ws, _code, _msg) => {
                const socket = ws.getUserData().socket;
                if (socket) {
                    ws.getUserData().socket = null;
                    socket._handleClose();
                }
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
