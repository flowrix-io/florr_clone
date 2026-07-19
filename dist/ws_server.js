"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = exports.WSServer = exports.WSSocket = void 0;
exports.getServerEventStats = getServerEventStats;
exports.resetServerEventStats = resetServerEventStats;
const uWebSockets_js_1 = __importDefault(require("uWebSockets.js"));
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
const SEND_BINARY = true;
const SEND_COMPRESSED = false;
class WSSocket {
    constructor(ws, id, server) {
        this.handlers = new Map();
        this.onceHandlers = new Map();
        this.anyHandlers = new Set();
        this._connected = true;
        // Event names whose frames uWS discarded (send status 2) since last
        // consumed. The server tick loop reads + clears this to trigger the
        // appropriate per-channel resync — a dropped frame otherwise silently
        // desyncs any stateful protocol (delta updates, one-shot spawns/removes).
        this.droppedEvents = null;
        this.ws = ws;
        this.id = id;
        this.server = server;
    }
    /** @internal Called by WSServer when uWS delivers a message frame. */
    _handleMessage(message) {
        try {
            // The ArrayBuffer is only valid during this sync handler — but we
            // decode synchronously and the decoder copies any embedded byte
            // payloads, so wrapping in a view (no copy) is safe.
            const bytes = new Uint8Array(message);
            const msg = (0, binary_codec_1.decode)(bytes);
            if (!Array.isArray(msg) || msg.length < 1)
                return;
            if (typeof msg[0] === 'string')
                recordBytes(msg[0], bytes.byteLength, 'in');
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
        }
        catch {
            // Ignore malformed messages
        }
    }
    /** @internal Called by WSServer when uWS reports the connection closed. */
    _handleClose() {
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
    get connected() {
        return this._connected && this.ws !== null;
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
        return this.emitWithStatus(event, ...args) !== -1;
    }
    /**
     * Like emit, but returns the raw uWS send status so callers can detect
     * silently dropped frames: 1 = sent, 0 = queued behind backpressure (will
     * drain in order), 2 = DROPPED because the socket's buffered amount
     * exceeded maxBackpressure, -1 = not connected / send threw. Stateful
     * delta protocols must treat 2 as "the client never saw this message"
     * and arrange a resync — see the gameStateUpdate loop in server.ts.
     */
    emitWithStatus(event, ...args) {
        if (!this.ws || !this._connected)
            return -1;
        try {
            const payload = (0, binary_codec_1.encode)([event, ...args]);
            recordBytes(event, payload.byteLength, 'out');
            // (data, isBinary, compress) — compress=false matches the perMessageDeflate
            // disable from the previous `ws`-backed implementation.
            const status = this.ws.send(payload, SEND_BINARY, SEND_COMPRESSED);
            if (status === 2)
                (this.droppedEvents ?? (this.droppedEvents = new Set())).add(event);
            return status;
        }
        catch {
            return -1;
        }
    }
    /** @internal Send a pre-encoded payload (used by WSServer.emit for broadcasts). */
    sendRaw(payload, event) {
        if (!this.ws || !this._connected)
            return false;
        try {
            const status = this.ws.send(payload, SEND_BINARY, SEND_COMPRESSED);
            if (status === 2 && event)
                (this.droppedEvents ?? (this.droppedEvents = new Set())).add(event);
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
        const ws = this.ws;
        this.ws = null;
        if (ws) {
            try {
                ws.close();
            }
            catch { /* already closed */ }
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
    constructor(uApp, _options) {
        this.sockets_map = new Map();
        this.connectionHandlers = new Set();
        // Compatible with io.sockets.sockets
        this.sockets = {
            sockets: this.sockets_map
        };
        this.sockets.sockets = this.sockets_map;
        // perMessageDeflate is disabled: compression only helps on large/repetitive
        // frames. This protocol's frames are small, frequent binary arrays — the
        // per-peer compressor cost outweighs the bandwidth savings.
        uApp.ws('/ws', {
            compression: uWebSockets_js_1.default.DISABLED,
            maxPayloadLength: 16 * 1024 * 1024,
            // Default is 64KB, past which uWS *silently drops* outgoing frames
            // (send() returns 2). Burst ticks in busy scenes can exceed that on
            // a momentarily-stalled link, and a dropped frame breaks the delta
            // protocol (one-shot enemy removals are lost → permanent ghosts).
            // 1MB lets bursts queue and drain instead; drops become rare and
            // are recovered via the F=1 resync path in server.ts.
            maxBackpressure: 1024 * 1024,
            idleTimeout: 120,
            sendPingsAutomatically: true,
            open: (ws) => {
                const id = (0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 20);
                const socket = new WSSocket(ws, id, this);
                ws.getUserData().socket = socket;
                this.sockets_map.set(id, socket);
                // Send the client its ID
                ws.send((0, binary_codec_1.encode)(['__sys', 'id', id]), SEND_BINARY, SEND_COMPRESSED);
                // Notify connection handlers
                for (const handler of this.connectionHandlers) {
                    handler(socket);
                }
            },
            message: (ws, message, _isBinary) => {
                const socket = ws.getUserData().socket;
                if (socket)
                    socket._handleMessage(message);
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
