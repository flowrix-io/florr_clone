"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = exports.WSServer = exports.WSSocket = void 0;
exports.getServerEventStats = getServerEventStats;
exports.resetServerEventStats = resetServerEventStats;
const ws_1 = require("ws");
const crypto_1 = require("crypto");
const binary_codec_1 = require("./binary_codec");
const eventByteStats = new Map();
function recordBytes(event, bytes, dir) {
    let s = eventByteStats.get(event);
    if (!s) {
        s = { in: 0, out: 0, count_in: 0, count_out: 0 };
        eventByteStats.set(event, s);
    }
    if (dir === 'in') {
        s.in += bytes;
        s.count_in++;
    }
    else {
        s.out += bytes;
        s.count_out++;
    }
}
function getServerEventStats() { return eventByteStats; }
function resetServerEventStats() { eventByteStats.clear(); }
class WSSocket {
    constructor(ws, id, server) {
        this.handlers = new Map();
        this.onceHandlers = new Map();
        this.anyHandlers = new Set();
        this._connected = true;
        this.ws = ws;
        this.id = id;
        this.server = server;
        ws.on('message', (raw) => {
            try {
                // `raw` is a Buffer, an array of fragmented Buffers, or an ArrayBuffer
                // depending on ws config. Normalize to a single Uint8Array for the codec.
                let bytes;
                if (Array.isArray(raw)) {
                    bytes = Buffer.concat(raw);
                }
                else if (raw instanceof ArrayBuffer) {
                    bytes = new Uint8Array(raw);
                }
                else {
                    bytes = raw;
                }
                const msg = (0, binary_codec_1.decode)(bytes);
                if (!Array.isArray(msg) || msg.length < 1)
                    return;
                if (typeof msg[0] === 'string')
                    recordBytes(msg[0], bytes.byteLength, 'in');
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
            }
            catch (e) {
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
    get connected() {
        return this._connected && this.ws.readyState === ws_1.WebSocket.OPEN;
    }
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event).add(handler);
        return this;
    }
    once(event, handler) {
        if (!this.onceHandlers.has(event)) {
            this.onceHandlers.set(event, new Set());
        }
        this.onceHandlers.get(event).add(handler);
        return this;
    }
    onAny(handler) {
        this.anyHandlers.add(handler);
        return this;
    }
    emit(event, ...args) {
        if (this.ws.readyState !== ws_1.WebSocket.OPEN)
            return false;
        try {
            // Binary frame; ws sends Uint8Array as a binary WebSocket message.
            const payload = (0, binary_codec_1.encode)([event, ...args]);
            recordBytes(event, payload.byteLength, 'out');
            this.ws.send(payload);
            return true;
        }
        catch {
            return false;
        }
    }
    /** @internal Send a pre-encoded payload (used by WSServer.emit for broadcasts). */
    sendRaw(payload, event) {
        if (this.ws.readyState !== ws_1.WebSocket.OPEN)
            return false;
        try {
            this.ws.send(payload);
            if (event)
                recordBytes(event, payload.byteLength, 'out');
            return true;
        }
        catch {
            return false;
        }
    }
    removeAllListeners(event) {
        if (event) {
            this.handlers.delete(event);
            this.onceHandlers.delete(event);
        }
        else {
            this.handlers.clear();
            this.onceHandlers.clear();
            this.anyHandlers.clear();
        }
        return this;
    }
    listeners(event) {
        return Array.from(this.handlers.get(event) || []);
    }
    disconnect() {
        this._connected = false;
        try {
            this.ws.close();
        }
        catch {
            // Already closed
        }
    }
    get broadcast() {
        const self = this;
        return {
            emit(event, ...args) {
                self.server._broadcastExcept(self.id, event, ...args);
            }
        };
    }
}
exports.WSSocket = WSSocket;
class WSServer {
    constructor(httpServer, _options) {
        this.sockets_map = new Map();
        this.connectionHandlers = new Set();
        // Compatible with io.sockets.sockets
        this.sockets = {
            sockets: this.sockets_map
        };
        this.sockets.sockets = this.sockets_map;
        // perMessageDeflate is disabled: ws's default zlib context is ~300 KB
        // per connection and compression only helps on large/repetitive frames.
        // This protocol's frames are small, frequent JSON arrays — the per-peer
        // memory cost outweighs the bandwidth savings.
        this.wss = new ws_1.WebSocketServer({ server: httpServer, path: '/ws', perMessageDeflate: false });
        this.wss.on('connection', (ws, _req) => {
            const id = (0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 20);
            const socket = new WSSocket(ws, id, this);
            this.sockets_map.set(id, socket);
            // Send the client its ID
            ws.send((0, binary_codec_1.encode)(['__sys', 'id', id]));
            // Notify connection handlers
            for (const handler of this.connectionHandlers) {
                handler(socket);
            }
        });
    }
    on(event, handler) {
        if (event === 'connection') {
            this.connectionHandlers.add(handler);
        }
        return this;
    }
    /** Broadcast to all connected clients */
    emit(event, ...args) {
        // Encode once, send to all peers. WSSocket.emit would re-encode per peer; here
        // we send the shared buffer directly to avoid N redundant encodes for broadcasts.
        const payload = (0, binary_codec_1.encode)([event, ...args]);
        for (const [, socket] of this.sockets_map) {
            if (socket.connected) {
                try {
                    socket.sendRaw(payload, event);
                }
                catch {
                    // Skip failed sends
                }
            }
        }
    }
    /** Send to a specific client by ID */
    to(id) {
        const self = this;
        return {
            emit(event, ...args) {
                const socket = self.sockets_map.get(id);
                if (socket && socket.connected) {
                    socket.emit(event, ...args);
                }
            }
        };
    }
    /** @internal Remove a disconnected socket */
    _removeSocket(id) {
        this.sockets_map.delete(id);
    }
    /** @internal Broadcast to all except one socket */
    _broadcastExcept(excludeId, event, ...args) {
        for (const [id, socket] of this.sockets_map) {
            if (id !== excludeId && socket.connected) {
                socket.emit(event, ...args);
            }
        }
    }
}
exports.WSServer = WSServer;
exports.Server = WSServer;
