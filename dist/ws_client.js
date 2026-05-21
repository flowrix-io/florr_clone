"use strict";
/**
 * Lightweight WebSocket client wrapper that provides a socket.io-compatible API.
 * Uses browser-native WebSocket for minimal overhead.
 *
 * Wire format: custom tag-based binary encoding of [eventName, ...args] arrays
 * (see binary_codec.ts). Frames are sent as binary WebSocket messages.
 * System events: ["__sys", type, data] for connection handshake.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSClientSocket = void 0;
exports.io = io;
const binary_codec_1 = require("./binary_codec");
class WSClientSocket {
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
    constructor(url, _options) {
        this.id = null;
        this.connected = false;
        this.ws = null;
        this.handlers = new Map();
        this.onceHandlers = new Map();
        this.anyHandlers = new Set();
        this.reconnectTimer = null;
        this.shouldReconnect = true;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 10000;
        this.currentReconnectDelay = 1000;
        this.pendingMessages = [];
        this.eventBytes = new Map();
        this.url = url;
        this.connect();
    }
    connect() {
        try {
            // Convert http(s) to ws(s)
            const wsUrl = this.url.replace(/^http/, 'ws') + '/ws';
            this.ws = new WebSocket(wsUrl);
            // Receive binary frames as ArrayBuffer rather than Blob (Blob would force
            // an async decode path); msgpack accepts Uint8Array views.
            this.ws.binaryType = 'arraybuffer';
            this.ws.onopen = () => {
                // Wait for __sys id message before firing 'connect'
                this.currentReconnectDelay = this.reconnectDelay;
            };
            this.ws.onmessage = (event) => {
                try {
                    // Binary frames arrive as ArrayBuffer (binaryType set above).
                    let msg;
                    let wireBytes = 0;
                    if (event.data instanceof ArrayBuffer) {
                        wireBytes = event.data.byteLength;
                        msg = (0, binary_codec_1.decode)(new Uint8Array(event.data));
                    }
                    else {
                        return;
                    }
                    if (!Array.isArray(msg) || msg.length < 1)
                        return;
                    const [eventName, ...args] = msg;
                    if (typeof eventName === 'string') {
                        this.recordBytes(eventName, wireBytes, 'in');
                    }
                    // Handle system events
                    if (eventName === '__sys') {
                        const [type, data] = args;
                        if (type === 'id') {
                            this.id = data;
                            this.connected = true;
                            // Send any pending messages
                            for (const pending of this.pendingMessages) {
                                this.ws?.send(pending);
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
            };
            this.ws.onclose = () => {
                const wasConnected = this.connected;
                this.connected = false;
                if (wasConnected) {
                    this.fireEvent('disconnect');
                }
                // Auto-reconnect with exponential backoff
                if (this.shouldReconnect) {
                    this.reconnectTimer = setTimeout(() => {
                        this.currentReconnectDelay = Math.min(this.currentReconnectDelay * 1.5, this.maxReconnectDelay);
                        this.connect();
                    }, this.currentReconnectDelay);
                }
            };
            this.ws.onerror = () => {
                this.fireEvent('connect_error', new Error('WebSocket connection failed'));
            };
        }
        catch (e) {
            this.fireEvent('connect_error', e);
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
        const msg = (0, binary_codec_1.encode)([event, ...args]);
        this.recordBytes(event, msg.byteLength, 'out');
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        }
        else {
            // Queue messages until connected
            this.pendingMessages.push(msg);
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
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
}
exports.WSClientSocket = WSClientSocket;
// socket.io-compatible factory function
function io(url, options) {
    return new WSClientSocket(url, options);
}
