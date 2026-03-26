/**
 * Lightweight WebSocket client wrapper that provides a socket.io-compatible API.
 * Uses browser-native WebSocket for minimal overhead.
 *
 * Message format: JSON arrays: ["eventName", ...args]
 * System events: ["__sys", type, data] for connection handshake
 */

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
    private pendingMessages: string[] = [];

    constructor(url: string, _options?: any) {
        this.url = url;
        this.connect();
    }

    private connect(): void {
        try {
            // Convert http(s) to ws(s)
            const wsUrl = this.url.replace(/^http/, 'ws') + '/ws';
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                // Wait for __sys id message before firing 'connect'
                this.currentReconnectDelay = this.reconnectDelay;
            };

            this.ws.onmessage = (event: MessageEvent) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (!Array.isArray(msg) || msg.length < 1) return;

                    const [eventName, ...args] = msg;

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
        const msg = JSON.stringify([event, ...args]);
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
