"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WireEventRegistry = void 0;
/**
 * The listener bookkeeping shared by both ends of the wire.
 *
 * WSClientSocket (ws_client.ts) and WSSocket (ws_server.ts) are separate
 * classes with genuinely different `emit` paths — the client queues durable
 * frames while disconnected, the server reports backpressure status — but they
 * carried byte-identical copies of the registry half: the three handler maps,
 * on/off/once/onAny, removeAllListeners, listeners, and the dispatch loop.
 * That half lives here; each socket extends this and keeps only its own
 * transport behaviour.
 */
class WireEventRegistry {
    constructor() {
        this.handlers = new Map();
        this.onceHandlers = new Map();
        this.anyHandlers = new Set();
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
     * Dispatches a decoded frame to the event's handlers. `once` handlers all
     * fire and are then dropped as a group, matching the prior behaviour on
     * both sides.
     */
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
    /** Fires the onAny taps, then the event's own handlers. */
    fireAnyAndEvent(event, ...args) {
        for (const handler of this.anyHandlers) {
            handler(event, ...args);
        }
        this.fireEvent(event, ...args);
    }
}
exports.WireEventRegistry = WireEventRegistry;
