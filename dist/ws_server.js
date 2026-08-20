"use strict";
/**
 * Lightweight socket server wrapper that provides a socket.io-compatible API.
 * The WebSocket transport is backed by uWebSockets.js for ~3-5× higher
 * throughput and lower per-conn memory than the previous `ws`-based
 * implementation.
 *
 * Wire format: custom tag-based binary encoding of [eventName, ...args] arrays
 * (see binary_codec.ts). Sent as one binary message per array.
 *
 * System events: ["__sys", type, data] for connection handshake.
 *
 * Transports: a WSSocket owns a `ServerTransport`, not a uWS WebSocket. The
 * uWS `/ws` route registered here is one implementation; server/webtransport_server.ts
 * registers HTTP/3 sessions as another via `attachTransport()`. Everything above
 * the transport — handlers, broadcast, backpressure accounting — is shared, and
 * clients pick a transport per connection (see net/transport.ts).
 *
 * Integration: this module no longer owns the HTTP server. The caller creates
 * a UApp (see server/uws_app.ts), passes it in, then calls UApp.listen() *after*
 * constructing the Server (which registers the `/ws` upgrade route on the same app).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = exports.WSServer = exports.WSSocket = exports.MAX_INBOUND_MESSAGE_BYTES = void 0;
exports.getServerEventStats = getServerEventStats;
exports.resetServerEventStats = resetServerEventStats;
const uWebSockets_js_1 = __importDefault(require("uWebSockets.js"));
const entity_ids_1 = require("./entity_ids");
const binary_codec_1 = require("./binary_codec");
const wire_events_1 = require("./wire_events");
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
/**
 * Largest message a client may send, on either transport.
 *
 * Every inbound event is small: player input is a handful of numbers, and the
 * biggest one — publishSkin — is bounded by MAX_SKIN_SHAPES × MAX_POLY_POINTS
 * to a few KB (see skin_format.ts). 64KB is ~10× the largest legitimate message
 * and ~250× smaller than the 16MB uWS default this replaces, which mattered
 * because the receiver buffers a whole message before it can look at it: the
 * old ceiling let one unauthenticated peer per socket reserve 16MB against a
 * heap capped at 192MB (see the --max-old-space-size in package.json).
 */
exports.MAX_INBOUND_MESSAGE_BYTES = 64 * 1024;
/**
 * Inbound message-rate ceiling, as a token bucket: sustained rate plus a burst
 * allowance so normal traffic never grazes it.
 *
 * A real client sends ~31 messages a second — input at the 30 TPS tick cadence
 * (game.ts MIN_INPUT_INTERVAL) plus a 1 Hz heartbeat — with short bursts when a
 * reconnect flushes queued messages. The limits below leave roughly 6× headroom
 * on the sustained rate, so tripping one means something is wrong rather than
 * merely busy. Without this, one authenticated-or-not socket can spin a core in
 * decode() for free, which no amount of bandwidth provisioning fixes.
 */
const MAX_MESSAGES_PER_SEC = 200;
const MAX_MESSAGE_BURST = 400;
const MAX_INBOUND_BYTES_PER_SEC = 256 * 1024;
const MAX_INBOUND_BYTE_BURST = 512 * 1024;
/** uWebSockets.js-backed transport — the WebSocket half of the pair. */
class UwsTransport {
    constructor(ws, remoteAddress, proxiedFor) {
        this.remoteAddress = remoteAddress;
        this.proxiedFor = proxiedFor;
        this.kind = 'websocket';
        this.ws = ws;
    }
    send(payload) {
        if (!this.ws)
            return -1;
        try {
            // (data, isBinary, compress) — compress=false matches the perMessageDeflate
            // disable from the previous `ws`-backed implementation.
            return this.ws.send(payload, SEND_BINARY, SEND_COMPRESSED);
        }
        catch {
            return -1;
        }
    }
    close(graceful) {
        const ws = this.ws;
        this.ws = null;
        if (!ws)
            return;
        try {
            if (graceful)
                ws.end(1000);
            else
                ws.close();
        }
        catch { /* already closed */ }
    }
    /** uWS already reported the close; drop the handle without calling back in. */
    detach() {
        this.ws = null;
    }
}
class WSSocket {
    constructor(transport, id, server) {
        this.handlers = new Map();
        this.onceHandlers = new Map();
        this.anyHandlers = new Set();
        this._connected = true;
        /** Guards _handleClose against firing 'disconnect' twice. */
        this._closeFired = false;
        // Token buckets for the inbound rate limit; refilled lazily on each message
        // so an idle socket costs nothing to track.
        this.msgTokens = MAX_MESSAGE_BURST;
        this.byteTokens = MAX_INBOUND_BYTE_BURST;
        this.lastRefill = Date.now();
        // Event names whose frames the transport discarded (send status 2) since
        // last consumed. The server tick loop reads + clears this to trigger the
        // appropriate per-channel resync — a dropped frame otherwise silently
        // desyncs any stateful protocol (delta updates, one-shot spawns/removes).
        this.droppedEvents = null;
        this.transport = transport;
        this.id = id;
        this.server = server;
        this.remoteAddress = transport.remoteAddress;
        this.proxiedFor = transport.proxiedFor;
        this.transportKind = transport.kind;
    }
    /**
     * Spend one message (and its bytes) from the inbound budget.
     * @returns false if the socket has exceeded its allowance.
     */
    withinRateLimit(bytes) {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        if (elapsed > 0) {
            this.lastRefill = now;
            this.msgTokens = Math.min(MAX_MESSAGE_BURST, this.msgTokens + elapsed * MAX_MESSAGES_PER_SEC);
            this.byteTokens = Math.min(MAX_INBOUND_BYTE_BURST, this.byteTokens + elapsed * MAX_INBOUND_BYTES_PER_SEC);
        }
        if (this.msgTokens < 1 || this.byteTokens < bytes)
            return false;
        this.msgTokens -= 1;
        this.byteTokens -= bytes;
        return true;
    }
    /** @internal Called by the transport when a complete message arrives. */
    _handleMessage(message) {
        // A transport may deliver what it had already buffered after the socket
        // was disconnected. Those messages belong to a session that is over:
        // acting on them would run handlers for a closed socket, and re-warning
        // about each one would bury the reason it was closed in the first place.
        if (!this._connected)
            return;
        const size = message.byteLength;
        if (size > exports.MAX_INBOUND_MESSAGE_BYTES || !this.withinRateLimit(size)) {
            // Dropping the message alone is not enough: the protocol is
            // stateful, so a client that silently loses messages misbehaves in
            // harder-to-diagnose ways than one that is disconnected. Closing
            // also stops the flood at its source instead of once per message.
            console.warn(`[WS] Rate/size limit exceeded by ${this.id} `
                + `(${this.transportKind}, ${this.remoteAddress || 'unknown ip'}, ${size} bytes) — disconnecting`);
            this.disconnect();
            return;
        }
        try {
            // The backing memory is only valid during this sync handler — but we
            // decode synchronously and the decoder copies any embedded byte
            // payloads, so wrapping in a view (no copy) is safe.
            const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
            const msg = (0, binary_codec_1.decode)(bytes);
            if (!Array.isArray(msg) || msg.length < 1)
                return;
            // Event names travel as opcodes when they are in the shared table
            // (see wire_events.ts); anything else is still a plain string.
            if (typeof msg[0] === 'number')
                msg[0] = wire_events_1.WIRE_EVENTS[msg[0]] ?? msg[0];
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
    /** @internal Called by the transport when the connection is gone. */
    _handleClose() {
        if (this._closeFired)
            return;
        this._closeFired = true;
        this._connected = false;
        this.transport = null;
        const handlers = this.handlers.get('disconnect');
        if (handlers) {
            for (const handler of handlers) {
                handler();
            }
        }
        this.server._removeSocket(this.id);
    }
    get connected() {
        return this._connected && this.transport !== null;
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
     * Like emit, but returns the raw transport send status so callers can detect
     * silently dropped frames: 1 = sent, 0 = queued behind backpressure (will
     * drain in order), 2 = DROPPED because the socket's buffered amount
     * exceeded maxBackpressure, -1 = not connected / send threw. Stateful
     * delta protocols must treat 2 as "the client never saw this message"
     * and arrange a resync — see the gameStateUpdate loop in server.ts.
     */
    emitWithStatus(event, ...args) {
        if (!this.transport || !this._connected)
            return -1;
        // `?? event` not `|| event`: opcode 0 is a valid, falsy opcode.
        const payload = (0, binary_codec_1.encode)([wire_events_1.WIRE_EVENT_IDS.get(event) ?? event, ...args]);
        recordBytes(event, payload.byteLength, 'out');
        const status = this.transport.send(payload);
        if (status === 2)
            (this.droppedEvents ?? (this.droppedEvents = new Set())).add(event);
        return status;
    }
    /** @internal Send a pre-encoded payload (used by WSServer.emit for broadcasts). */
    sendRaw(payload, event) {
        if (!this.transport || !this._connected)
            return false;
        const status = this.transport.send(payload);
        if (status === -1)
            return false;
        if (status === 2 && event)
            (this.droppedEvents ?? (this.droppedEvents = new Set())).add(event);
        if (event)
            recordBytes(event, payload.byteLength, 'out');
        return true;
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
    /**
     * @param graceful Close with a WebSocket close frame (`end`) instead of
     * ripping the TCP connection down (`close`). A forceful close can discard
     * frames that are still queued, so anything that emits a final message to
     * the client — "you were signed in elsewhere" — must close gracefully or
     * the client never sees why it was dropped.
     */
    disconnect(graceful = false) {
        this._connected = false;
        const transport = this.transport;
        this.transport = null;
        transport?.close(graceful);
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
            // Was 16MB (uWS' default). See MAX_INBOUND_MESSAGE_BYTES: this is
            // what an unauthenticated peer can make the receiver hold.
            maxPayloadLength: exports.MAX_INBOUND_MESSAGE_BYTES,
            // Default is 64KB, past which uWS *silently drops* outgoing frames
            // (send() returns 2). Burst ticks in busy scenes can exceed that on
            // a momentarily-stalled link, and a dropped frame breaks the delta
            // protocol (one-shot enemy removals are lost → permanent ghosts).
            // 1MB lets bursts queue and drain instead; drops become rare and
            // are recovered via the F=1 resync path in server.ts.
            maxBackpressure: 1024 * 1024,
            idleTimeout: 120,
            sendPingsAutomatically: true,
            // The only reason this route defines `upgrade` at all: uWS exposes
            // the peer address on the HTTP request, and an upgraded WebSocket
            // reports an EMPTY one (getRemoteAddressAsText() → 0 bytes). So the
            // address is read here and carried across in the socket's userData.
            // Everything else below is uWS' own default upgrade, spelled out.
            upgrade: (res, req, context) => {
                let remoteAddress = '';
                try {
                    remoteAddress = Buffer.from(res.getRemoteAddressAsText()).toString();
                }
                catch {
                    // Leave it blank — blank reads as "not local" downstream.
                }
                // Forwarding headers are only readable here too (the request is
                // gone by `open`). Cloudflare rewrites CF-Connecting-IP with the
                // real client IP and does not pass a client's own copy through.
                const proxiedFor = req.getHeader('cf-connecting-ip')
                    || req.getHeader('x-forwarded-for').split(',')[0].trim();
                res.upgrade({ socket: null, transport: null, remoteAddress, proxiedFor }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
            },
            open: (ws) => {
                const data = ws.getUserData();
                const transport = new UwsTransport(ws, data.remoteAddress || '', data.proxiedFor || '');
                data.transport = transport;
                this.attachTransport(transport, socket => { data.socket = socket; });
            },
            message: (ws, message, _isBinary) => {
                const socket = ws.getUserData().socket;
                if (socket)
                    socket._handleMessage(message);
            },
            close: (ws, _code, _msg) => {
                const data = ws.getUserData();
                const socket = data.socket;
                // uWS has already torn the connection down; dropping the handle
                // first stops close()/send() from touching a freed socket.
                data.transport?.detach();
                data.transport = null;
                data.socket = null;
                if (socket)
                    socket._handleClose();
            }
        });
    }
    /**
     * Register an open transport as a socket: assign an id, run the connection
     * handshake, and notify the `connection` handlers.
     *
     * The caller owns delivering messages (`socket._handleMessage`) and the
     * close notification (`socket._handleClose`). Used by the uWS route above
     * and by server/webtransport_server.ts.
     *
     * @param onRegistered Runs once the socket exists but before the handshake
     * and the `connection` handlers. That ordering is load-bearing: a connection
     * handler may disconnect the socket immediately (a rejected session, a rate
     * limit), so the caller's routing from transport back to socket — its close
     * and message plumbing — has to already be in place, or that disconnect
     * would never reach `_handleClose` and the socket would leak.
     */
    attachTransport(transport, onRegistered) {
        // Integer-valued (see entity_ids.ts): 20 chars of hex per entity delta
        // was 17.6% of every frame.
        const id = (0, entity_ids_1.nextEntityId)();
        const socket = new WSSocket(transport, id, this);
        this.sockets_map.set(id, socket);
        onRegistered?.(socket);
        // Wire-compatibility token first: the client checks it before it
        // treats the connection as usable, so an incompatible build
        // never gets as far as authenticating and decoding an inventory.
        if (WSServer.protocolSignature) {
            transport.send((0, binary_codec_1.encode)(['__sys', 'proto', WSServer.protocolSignature]));
        }
        // Send the client its ID
        transport.send((0, binary_codec_1.encode)(['__sys', 'id', id]));
        // Notify connection handlers
        for (const handler of this.connectionHandlers) {
            handler(socket);
        }
        return socket;
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
        const payload = (0, binary_codec_1.encode)([wire_events_1.WIRE_EVENT_IDS.get(event) ?? event, ...args]);
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
/**
 * Opaque wire-compatibility token handed to every client in the connection
 * handshake. Set by the app at boot (see server.ts); this layer only relays
 * it and never interprets it. A client whose own token differs is running a
 * build that would decode this server's payloads incorrectly.
 */
WSServer.protocolSignature = '';
