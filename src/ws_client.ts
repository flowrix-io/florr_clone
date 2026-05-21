/**
 * Lightweight WebSocket client wrapper that provides a socket.io-compatible API.
 * Uses browser-native WebSocket for minimal overhead.
 *
 * Wire format: custom tag-based binary encoding of [eventName, ...args] arrays
 * (see binary_codec.ts). Frames are sent as binary WebSocket messages.
 * System events: ["__sys", type, data] for connection handshake.
 */

import { encode, decode } from './binary_codec';

// Per-event bandwidth profiling. The wrapper records the true wire-byte size of every
// frame (encoded length, not a JSON estimate) split by event name and direction.
// game.ts reads these via getEventStats() to render a top-consumers overlay.
export interface EventByteStats { in: number; out: number; }

export class WSClientSocket {
    id: string | null = null;
    connected: boolean = false;
    private ws: WebSocket | null = null;
    private url: string;
    private handlers: Map<string, Set<(...args: any[]) => void>> = new Map();
    private onceHandlers: Map<string, Set<(...args: any[]) => void>> = new Map();
    private anyHandlers: Set<(event: string, ...args: any[]) => void> = new Set();
    private reconnectTimer: any = null;
    private shouldReconnect: boolean = true;
    private reconnectDelay: number = 1000;
    private maxReconnectDelay: number = 10000;
    private currentReconnectDelay: number = 1000;
    private pendingMessages: Uint8Array[] = [];

    private eventBytes: Map<string, EventByteStats> = new Map();

    /** Return a snapshot of per-event byte counts since last reset. */
    getEventStats(): Map<string, EventByteStats> {
        return this.eventBytes;
    }

    /** Reset all per-event byte counts (typically called once per second). */
    resetEventStats(): void {
        this.eventBytes.clear();
    }

    private recordBytes(event: string, bytes: number, dir: 'in' | 'out') {
        let s = this.eventBytes.get(event);
        if (!s) { s = { in: 0, out: 0 }; this.eventBytes.set(event, s); }
        if (dir === 'in') s.in += bytes; else s.out += bytes;
    }

    constructor(url: string, _options?: any) {
        this.url = url;
        this.connect();
    }

    private connect(): void {
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

            this.ws.onmessage = (event: MessageEvent) => {
                try {
                    // Binary frames arrive as ArrayBuffer (binaryType set above).
                    let msg: any;
                    let wireBytes = 0;
                    if (event.data instanceof ArrayBuffer) {
                        wireBytes = event.data.byteLength;
                        msg = decode(new Uint8Array(event.data));
                    } else {
                        return;
                    }
                    if (!Array.isArray(msg) || msg.length < 1) return;

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
                } catch (e) {
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
                        this.currentReconnectDelay = Math.min(
                            this.currentReconnectDelay * 1.5,
                            this.maxReconnectDelay
                        );
                        this.connect();
                    }, this.currentReconnectDelay);
                }
            };

            this.ws.onerror = () => {
                this.fireEvent('connect_error', new Error('WebSocket connection failed'));
            };
        } catch (e) {
            this.fireEvent('connect_error', e);
        }
    }

    private fireEvent(event: string, ...args: any[]): void {
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

    emit(event: string, ...args: any[]): this {
        const msg = encode([event, ...args]);
        this.recordBytes(event, msg.byteLength, 'out');
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        } else {
            // Queue messages until connected
            this.pendingMessages.push(msg);
        }
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

    disconnect(): void {
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

// socket.io-compatible factory function
export function io(url: string, options?: any): WSClientSocket {
    return new WSClientSocket(url, options);
}

// Re-export for type compatibility
export type Socket = WSClientSocket;
