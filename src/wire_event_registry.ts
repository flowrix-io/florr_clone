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
export class WireEventRegistry {
    protected handlers: Map<string, Set<(...args: any[]) => void>> = new Map();
    protected onceHandlers: Map<string, Set<(...args: any[]) => void>> = new Map();
    protected anyHandlers: Set<(event: string, ...args: any[]) => void> = new Set();

    on(event: string, handler: (...args: any[]) => void): this {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(handler);
        return this;
    }

    off(event: string, handler?: (...args: any[]) => void): this {
        if (handler) {
            this.handlers.get(event)?.delete(handler);
            this.onceHandlers.get(event)?.delete(handler);
        } else {
            this.handlers.delete(event);
            this.onceHandlers.delete(event);
        }
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

    /**
     * Dispatches a decoded frame to the event's handlers. `once` handlers all
     * fire and are then dropped as a group, matching the prior behaviour on
     * both sides.
     */
    protected fireEvent(event: string, ...args: any[]): void {
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
    protected fireAnyAndEvent(event: string, ...args: any[]): void {
        for (const handler of this.anyHandlers) {
            handler(event, ...args);
        }
        this.fireEvent(event, ...args);
    }
}
