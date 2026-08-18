"use strict";
/**
 * Lightweight socket client wrapper that provides a socket.io-compatible API.
 *
 * The underlying connection is a `ClientTransport` (see net/transport.ts),
 * which picks WebTransport or WebSocket automatically per connection attempt
 * and falls back to WebSocket whenever WebTransport is unavailable. Everything
 * below is transport-agnostic: it deals in whole binary messages.
 *
 * Wire format: custom tag-based binary encoding of [eventName, ...args] arrays
 * (see binary_codec.ts), sent as one binary message per array.
 * System events: ["__sys", type, data] for connection handshake.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSClientSocket = void 0;
exports.io = io;
const binary_codec_1 = require("./binary_codec");
const inventoryCodec_1 = require("./inventoryCodec");
const transport_1 = require("./net/transport");
/**
 * Guards against a client whose wire format no longer matches the server's.
 *
 * The server publishes its inventory codec signature in the connection
 * handshake (see ws_server.ts). If ours differs, this bundle would decode the
 * server's [rarityId, itemId, count] inventory triplets against a different
 * petal→id table and render — and then edit — petals the player has never
 * owned. There is no safe way to continue, so reload to pick up the matching
 * build (index.html fetches bundle.bin with cache: 'no-store', so a reload is
 * guaranteed to get the current one).
 *
 * Returns true if the connection is safe to use.
 */
const PROTO_RELOAD_KEY = 'protoMismatchReloadAt';
function verifyProtocol(serverSig) {
    const ourSig = (0, inventoryCodec_1.getInventoryCodecSignature)();
    if (!serverSig || !ourSig || serverSig === ourSig) {
        try {
            sessionStorage.removeItem(PROTO_RELOAD_KEY);
        }
        catch { }
        return true;
    }
    console.error(`[CLIENT] Protocol mismatch: server=${serverSig} client=${ourSig}`);
    // Reload at most once per session for this. If the fresh bundle still
    // disagrees the mismatch is not staleness (a half-finished deploy, a proxy
    // serving an old bundle.bin), and reloading forever would just spin.
    let alreadyTried = false;
    try {
        alreadyTried = !!sessionStorage.getItem(PROTO_RELOAD_KEY);
        sessionStorage.setItem(PROTO_RELOAD_KEY, String(Date.now()));
    }
    catch {
        // sessionStorage unavailable (private mode) — treat as first attempt.
    }
    if (alreadyTried) {
        console.error('[CLIENT] Still mismatched after reloading; refusing to connect.');
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;'
            + 'justify-content:center;background:rgba(0,0,0,0.85);color:#fff;font:16px sans-serif;'
            + 'text-align:center;padding:24px;';
        el.textContent = 'This page is out of date and could not update itself. '
            + 'Please hard-refresh (Ctrl/Cmd+Shift+R) to keep playing.';
        document.body.appendChild(el);
        return false;
    }
    window.location.reload();
    return false;
}
class WSClientSocket {
    /**
     * Which transport the live connection actually negotiated, or null while
     * disconnected. Surfaced for diagnostics (the debug overlay) — nothing in
     * the game logic should branch on it.
     */
    get transportKind() {
        return this.transport ? this.transport.kind : null;
    }
    /** Return a snapshot of per-event byte counts since last reset. */
    getEventStats() {
        return this.eventBytes;
    }
    /** Reset all per-event byte counts (typically called once per second). */
    resetEventStats() {
        this.eventBytes.clear();
    }
    recordBytes(event, bytes, dir) {
        let s = this.eventBytes.get(event);
        if (!s) {
            s = { in: 0, out: 0 };
            this.eventBytes.set(event, s);
        }
        if (dir === 'in')
            s.in += bytes;
        else
            s.out += bytes;
    }
    isVolatile(event) {
        return WSClientSocket.VOLATILE_EVENTS.has(event);
    }
    constructor(url, _options) {
        this.id = null;
        this.connected = false;
        this.transport = null;
        this.handlers = new Map();
        this.onceHandlers = new Map();
        this.anyHandlers = new Set();
        this.reconnectTimer = null;
        this.shouldReconnect = true;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 10000;
        this.currentReconnectDelay = 1000;
        this.pendingMessages = [];
        /** Cleared only if the server's handshake signature is incompatible with ours. */
        this.protocolOk = true;
        /**
         * Bumped on every connect attempt. A transport that finishes handshaking
         * after its attempt was superseded — the socket was disconnected, or a
         * reconnect already started — sees a stale sequence number and closes
         * itself instead of installing over the live connection.
         */
        this.connectSeq = 0;
        this.eventBytes = new Map();
        this.url = url;
        this.connect();
    }
    connect() {
        const attempt = ++this.connectSeq;
        (0, transport_1.connectTransport)(this.url).then(transport => this.adoptTransport(attempt, transport), err => {
            if (attempt !== this.connectSeq)
                return;
            this.fireEvent('connect_error', err instanceof Error ? err : new Error(String(err)));
            this.scheduleReconnect();
        });
    }
    /** Install a freshly-opened transport, unless its attempt was superseded. */
    adoptTransport(attempt, transport) {
        if (attempt !== this.connectSeq || !this.shouldReconnect) {
            // Disconnected (or reconnected) while this handshake was in flight.
            transport.close();
            return;
        }
        this.transport = transport;
        // Reaching an open transport is the success signal the backoff resets
        // on; 'connect' itself waits for the __sys id handshake below.
        this.currentReconnectDelay = this.reconnectDelay;
        transport.onmessage = (data) => this.handleMessage(data);
        transport.onclose = () => {
            if (this.transport !== transport)
                return;
            this.transport = null;
            const wasConnected = this.connected;
            this.connected = false;
            if (wasConnected) {
                this.fireEvent('disconnect');
            }
            this.scheduleReconnect();
        };
    }
    scheduleReconnect() {
        if (!this.shouldReconnect || this.reconnectTimer)
            return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.currentReconnectDelay = Math.min(this.currentReconnectDelay * 1.5, this.maxReconnectDelay);
            this.connect();
        }, this.currentReconnectDelay);
    }
    handleMessage(data) {
        try {
            const wireBytes = data.byteLength;
            const msg = (0, binary_codec_1.decode)(data);
            if (!Array.isArray(msg) || msg.length < 1)
                return;
            const [eventName, ...args] = msg;
            if (typeof eventName === 'string') {
                this.recordBytes(eventName, wireBytes, 'in');
            }
            // Handle system events
            if (eventName === '__sys') {
                const [type, payload] = args;
                if (type === 'proto') {
                    // Arrives ahead of 'id'. A mismatch reloads the page,
                    // so latch it and never fire 'connect' — the game must
                    // not authenticate against a server it cannot decode.
                    this.protocolOk = verifyProtocol(payload);
                    if (!this.protocolOk) {
                        this.shouldReconnect = false;
                        this.transport?.close();
                    }
                    return;
                }
                if (type === 'id') {
                    if (!this.protocolOk)
                        return;
                    this.id = payload;
                    this.connected = true;
                    // Send any pending messages
                    for (const pending of this.pendingMessages) {
                        this.transport?.send(pending);
                    }
                    this.pendingMessages = [];
                    this.fireEvent('connect');
                }
                return;
            }
            // Fire onAny handlers
            for (const handler of this.anyHandlers) {
                handler(eventName, ...args);
            }
            // Fire event-specific handlers
            this.fireEvent(eventName, ...args);
        }
        catch (e) {
            // Ignore malformed messages
        }
    }
    fireEvent(event, ...args) {
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
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event).add(handler);
        return this;
    }
    off(event, handler) {
        if (handler) {
            this.handlers.get(event)?.delete(handler);
            this.onceHandlers.get(event)?.delete(handler);
        }
        else {
            this.handlers.delete(event);
            this.onceHandlers.delete(event);
        }
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
        const transport = this.transport;
        if (transport && transport.open && this.isVolatile(event) &&
            transport.bufferedAmount > WSClientSocket.MAX_VOLATILE_BUFFERED_BYTES) {
            return this;
        }
        const msg = (0, binary_codec_1.encode)([event, ...args]);
        if (transport && transport.open) {
            transport.send(msg);
            this.recordBytes(event, msg.byteLength, 'out');
        }
        else if (!this.isVolatile(event)) {
            // Queue durable messages until connected. Stale input/heartbeat frames
            // are intentionally dropped; sending old controls after congestion clears
            // feels worse than missing a tick.
            this.pendingMessages.push(msg);
            this.recordBytes(event, msg.byteLength, 'out');
        }
        else {
            // Drop volatile messages while disconnected or still handshaking.
        }
        return this;
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
        this.shouldReconnect = false;
        // Invalidate any handshake still in flight, so a transport that opens
        // after this call closes itself instead of reviving the socket.
        this.connectSeq++;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.transport) {
            this.transport.onclose = null;
            this.transport.close();
            this.transport = null;
        }
        this.connected = false;
    }
}
exports.WSClientSocket = WSClientSocket;
WSClientSocket.VOLATILE_EVENTS = new Set(['playerInput', 'ping']);
WSClientSocket.MAX_VOLATILE_BUFFERED_BYTES = 16 * 1024;
// socket.io-compatible factory function
function io(url, options) {
    return new WSClientSocket(url, options);
}
