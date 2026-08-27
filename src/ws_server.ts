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

import uWS, { WebSocket as UWS_WebSocket } from 'uWebSockets.js';
import type { UApp } from './server/uws_app';
import { nextEntityId } from './entity_ids';
import { encode, decode } from './binary_codec';
import { WIRE_EVENTS, WIRE_EVENT_IDS } from './wire_events';
import { WireEventRegistry } from './wire_event_registry';

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
    /** The transport wrapping this uWS socket; cleared when uWS reports close. */
    transport: UwsTransport | null;
    /** Peer IP, captured at upgrade — see the `upgrade` handler below. */
    remoteAddress: string;
    /** Forwarding header the peer presented, if any — see WSSocket.proxiedFor. */
    proxiedFor: string;
}

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
export const MAX_INBOUND_MESSAGE_BYTES = 64 * 1024;

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

/**
 * The connection underneath a WSSocket, reduced to what this layer needs.
 *
 * Implementations must preserve message boundaries: whatever `send()` is handed
 * arrives at the client as exactly one message (WebSocket frames do this
 * natively; the WebTransport implementation length-prefixes its byte stream).
 */
export interface ServerTransport {
    readonly kind: 'websocket' | 'webtransport';
    /** See WSSocket.remoteAddress. */
    readonly remoteAddress: string;
    /** See WSSocket.proxiedFor. */
    readonly proxiedFor: string;
    /**
     * Deliver one message. Returns uWS' send status so stateful delta protocols
     * can detect drops: 1 = sent, 0 = queued behind backpressure (drains in
     * order), 2 = DROPPED because buffered bytes exceeded the cap, -1 = the
     * connection is gone or the send threw.
     */
    send(payload: Uint8Array): number;
    /**
     * @param graceful Shut down cleanly, letting queued messages flush, rather
     * than tearing the connection down immediately.
     */
    close(graceful: boolean): void;
}

/** uWebSockets.js-backed transport — the WebSocket half of the pair. */
class UwsTransport implements ServerTransport {
    readonly kind = 'websocket' as const;
    private ws: UWS_WebSocket<SocketUserData> | null;

    constructor(
        ws: UWS_WebSocket<SocketUserData>,
        readonly remoteAddress: string,
        readonly proxiedFor: string,
    ) {
        this.ws = ws;
    }

    send(payload: Uint8Array): number {
        if (!this.ws) return -1;
        try {
            // (data, isBinary, compress) — compress=false matches the perMessageDeflate
            // disable from the previous `ws`-backed implementation.
            return this.ws.send(payload, SEND_BINARY, SEND_COMPRESSED);
        } catch {
            return -1;
        }
    }

    close(graceful: boolean): void {
        const ws = this.ws;
        this.ws = null;
        if (!ws) return;
        try {
            if (graceful) ws.end(1000);
            else ws.close();
        } catch { /* already closed */ }
    }

    /** uWS already reported the close; drop the handle without calling back in. */
    detach(): void {
        this.ws = null;
    }
}

export class WSSocket extends WireEventRegistry {
    id: string;
    private transport: ServerTransport | null;
    private server: WSServer;
    private _connected: boolean = true;
    /** Guards _handleClose against firing 'disconnect' twice. */
    private _closeFired: boolean = false;

    // Token buckets for the inbound rate limit; refilled lazily on each message
    // so an idle socket costs nothing to track.
    private msgTokens: number = MAX_MESSAGE_BURST;
    private byteTokens: number = MAX_INBOUND_BYTE_BURST;
    private lastRefill: number = Date.now();

    // Event names whose frames the transport discarded (send status 2) since
    // last consumed. The server tick loop reads + clears this to trigger the
    // appropriate per-channel resync — a dropped frame otherwise silently
    // desyncs any stateful protocol (delta updates, one-shot spawns/removes).
    droppedEvents: Set<string> | null = null;

    /**
     * The peer's IP as the transport reported it on the accepted connection —
     * never a client-supplied header, so it cannot be spoofed. On the WebSocket
     * transport this is uWS' uncompressed IPv6 text form, e.g.
     * `0000:0000:0000:0000:0000:ffff:7f00:0001` for an IPv4 peer on a dual-stack
     * listener. Used to decide whether a connection is loopback (see
     * server/connection/sessionGuard.ts). May be '' if the transport cannot
     * report one, which reads as "not local" downstream.
     */
    readonly remoteAddress: string;

    /**
     * The client IP a forwarding proxy claimed for this connection
     * (`CF-Connecting-IP`, else the first `X-Forwarded-For` hop), or '' when the
     * connection arrived direct.
     *
     * Unlike `remoteAddress` this IS client-supplied text and must never be
     * trusted as an identity. Its one load-bearing use is the opposite: a
     * connection that carries it came through a proxy, which means a loopback
     * `remoteAddress` is that proxy on this host — Cloudflare Tunnel, say — and
     * NOT a local player. See sessionGuard.isLocalSocket.
     */
    readonly proxiedFor: string;

    /** Which transport carried this connection — 'websocket' or 'webtransport'. */
    readonly transportKind: 'websocket' | 'webtransport';

    // Allow dynamic properties (userId, username, etc.)
    [key: string]: any;

    constructor(transport: ServerTransport, id: string, server: WSServer) {
        super();
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
    private withinRateLimit(bytes: number): boolean {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        if (elapsed > 0) {
            this.lastRefill = now;
            this.msgTokens = Math.min(MAX_MESSAGE_BURST, this.msgTokens + elapsed * MAX_MESSAGES_PER_SEC);
            this.byteTokens = Math.min(MAX_INBOUND_BYTE_BURST, this.byteTokens + elapsed * MAX_INBOUND_BYTES_PER_SEC);
        }
        if (this.msgTokens < 1 || this.byteTokens < bytes) return false;
        this.msgTokens -= 1;
        this.byteTokens -= bytes;
        return true;
    }

    /** @internal Called by the transport when a complete message arrives. */
    _handleMessage(message: ArrayBuffer | Uint8Array): void {
        // A transport may deliver what it had already buffered after the socket
        // was disconnected. Those messages belong to a session that is over:
        // acting on them would run handlers for a closed socket, and re-warning
        // about each one would bury the reason it was closed in the first place.
        if (!this._connected) return;

        const size = message.byteLength;
        if (size > MAX_INBOUND_MESSAGE_BYTES || !this.withinRateLimit(size)) {
            // Dropping the message alone is not enough: the protocol is
            // stateful, so a client that silently loses messages misbehaves in
            // harder-to-diagnose ways than one that is disconnected. Closing
            // also stops the flood at its source instead of once per message.
            console.warn(
                `[WS] Rate/size limit exceeded by ${this.id} `
                + `(${this.transportKind}, ${this.remoteAddress || 'unknown ip'}, ${size} bytes) — disconnecting`,
            );
            this.disconnect();
            return;
        }
        try {
            // The backing memory is only valid during this sync handler — but we
            // decode synchronously and the decoder copies any embedded byte
            // payloads, so wrapping in a view (no copy) is safe.
            const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
            const msg = decode(bytes) as any;
            if (!Array.isArray(msg) || msg.length < 1) return;
            // Event names travel as opcodes when they are in the shared table
            // (see wire_events.ts); anything else is still a plain string.
            if (typeof msg[0] === 'number') msg[0] = WIRE_EVENTS[msg[0]] ?? msg[0];
            if (typeof msg[0] === 'string') recordBytes(msg[0], bytes.byteLength, 'in');
            const [event, ...args] = msg;

            this.fireAnyAndEvent(event, ...args);
        } catch {
            // Ignore malformed messages
        }
    }

    /** @internal Called by the transport when the connection is gone. */
    _handleClose(): void {
        if (this._closeFired) return;
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

    get connected(): boolean {
        return this._connected && this.transport !== null;
    }

    emit(event: string, ...args: any[]): boolean {
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
    emitWithStatus(event: string, ...args: any[]): number {
        if (!this.transport || !this._connected) return -1;
        // `?? event` not `|| event`: opcode 0 is a valid, falsy opcode.
        const payload = encode([WIRE_EVENT_IDS.get(event) ?? event, ...args]);
        recordBytes(event, payload.byteLength, 'out');
        const status = this.transport.send(payload);
        if (status === 2) (this.droppedEvents ??= new Set()).add(event);
        return status;
    }

    /** @internal Send a pre-encoded payload (used by WSServer.emit for broadcasts). */
    sendRaw(payload: Uint8Array, event?: string): boolean {
        if (!this.transport || !this._connected) return false;
        const status = this.transport.send(payload);
        if (status === -1) return false;
        if (status === 2 && event) (this.droppedEvents ??= new Set()).add(event);
        if (event) recordBytes(event, payload.byteLength, 'out');
        return true;
    }

    /**
     * @param graceful Close with a WebSocket close frame (`end`) instead of
     * ripping the TCP connection down (`close`). A forceful close can discard
     * frames that are still queued, so anything that emits a final message to
     * the client — "you were signed in elsewhere" — must close gracefully or
     * the client never sees why it was dropped.
     */
    disconnect(graceful: boolean = false): void {
        this._connected = false;
        const transport = this.transport;
        this.transport = null;
        transport?.close(graceful);
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

    /**
     * Opaque wire-compatibility token handed to every client in the connection
     * handshake. Set by the app at boot (see server.ts); this layer only relays
     * it and never interprets it. A client whose own token differs is running a
     * build that would decode this server's payloads incorrectly.
     */
    public static protocolSignature: string = '';

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
            // Was 16MB (uWS' default). See MAX_INBOUND_MESSAGE_BYTES: this is
            // what an unauthenticated peer can make the receiver hold.
            maxPayloadLength: MAX_INBOUND_MESSAGE_BYTES,
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
                } catch {
                    // Leave it blank — blank reads as "not local" downstream.
                }
                // Forwarding headers are only readable here too (the request is
                // gone by `open`). Cloudflare rewrites CF-Connecting-IP with the
                // real client IP and does not pass a client's own copy through.
                const proxiedFor = req.getHeader('cf-connecting-ip')
                    || req.getHeader('x-forwarded-for').split(',')[0].trim();
                res.upgrade<SocketUserData>(
                    { socket: null, transport: null, remoteAddress, proxiedFor },
                    req.getHeader('sec-websocket-key'),
                    req.getHeader('sec-websocket-protocol'),
                    req.getHeader('sec-websocket-extensions'),
                    context,
                );
            },

            open: (ws) => {
                const data = ws.getUserData();
                const transport = new UwsTransport(ws, data.remoteAddress || '', data.proxiedFor || '');
                data.transport = transport;
                this.attachTransport(transport, socket => { data.socket = socket; });
            },

            message: (ws, message, _isBinary) => {
                const socket = ws.getUserData().socket;
                if (socket) socket._handleMessage(message);
            },

            close: (ws, _code, _msg) => {
                const data = ws.getUserData();
                const socket = data.socket;
                // uWS has already torn the connection down; dropping the handle
                // first stops close()/send() from touching a freed socket.
                data.transport?.detach();
                data.transport = null;
                data.socket = null;
                if (socket) socket._handleClose();
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
    attachTransport(transport: ServerTransport, onRegistered?: (socket: WSSocket) => void): WSSocket {
        // Integer-valued (see entity_ids.ts): 20 chars of hex per entity delta
        // was 17.6% of every frame.
        const id = nextEntityId();
        const socket = new WSSocket(transport, id, this);
        this.sockets_map.set(id, socket);
        onRegistered?.(socket);

        // Wire-compatibility token first: the client checks it before it
        // treats the connection as usable, so an incompatible build
        // never gets as far as authenticating and decoding an inventory.
        if (WSServer.protocolSignature) {
            transport.send(encode(['__sys', 'proto', WSServer.protocolSignature]));
        }

        // Send the client its ID
        transport.send(encode(['__sys', 'id', id]));

        // Notify connection handlers
        for (const handler of this.connectionHandlers) {
            handler(socket);
        }
        return socket;
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
        const payload = encode([WIRE_EVENT_IDS.get(event) ?? event, ...args]);
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
