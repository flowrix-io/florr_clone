"use strict";
/**
 * Transport selection for the game socket.
 *
 * The socket wrapper (ws_client.ts) does not know or care how bytes reach the
 * server; it hands `Uint8Array` messages to a `ClientTransport` and gets
 * `Uint8Array` messages back. Two implementations exist:
 *
 *   - WebSocket        — always available, the historical transport.
 *   - WebTransport     — HTTP/3 over QUIC. No TCP head-of-line blocking, so a
 *                        lost packet stalls one stream rather than the whole
 *                        connection, and the handshake is 1-RTT (0-RTT on a
 *                        resumed session).
 *
 * `connectTransport()` picks between them automatically:
 *
 *   1. WebTransport is skipped outright unless the browser implements it, the
 *      origin is https (the API is secure-context only), and it has not
 *      already failed once this session for this origin.
 *   2. The server is asked what it supports via `GET /transport-info`. The
 *      answer is memoised per origin so repeated connects (preconnect,
 *      reconnect, cross-server transfer) cost no extra round trip.
 *   3. WebTransport is attempted with a short deadline. Anything at all going
 *      wrong — no UDP path (a proxy that only forwards TCP, a firewall that
 *      drops QUIC), an untrusted certificate, a timeout — falls through to
 *      WebSocket, and the failure is remembered so the next connect goes
 *      straight to WebSocket.
 *
 * The fallback is what makes this safe to leave on by default: the worst case
 * is one wasted round trip on the first connection of a session.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setTransportPreference = setTransportPreference;
exports.getTransportPreference = getTransportPreference;
exports.prefetchTransportInfo = prefetchTransportInfo;
exports.connectTransport = connectTransport;
const stream_framing_1 = require("./stream_framing");
/** How long to wait for `/transport-info` before assuming WebSocket only. */
const INFO_TIMEOUT_MS = 1500;
/** How long the WebTransport handshake gets before we give up and use WebSocket. */
const WT_CONNECT_TIMEOUT_MS = 2500;
/** How long to wait for the WebSocket to open before treating it as failed. */
const WS_CONNECT_TIMEOUT_MS = 10000;
/**
 * Largest single message this client will reassemble from the server.
 *
 * Deliberately far above the 64KB the *server* accepts from clients: the
 * asymmetry is the point. The server is guarding its heap against strangers,
 * whereas here the peer is the game server, which legitimately sends large
 * frames — the wall grid alone is ~40KB and a crowded world update can exceed
 * that. Still bounded, so a corrupt or truncated stream cannot allocate freely.
 */
const MAX_SERVER_FRAME_BYTES = 8 * 1024 * 1024;
const DEFAULT_WT_PATH = '/wt';
let preference = readPreferenceOverride();
function setTransportPreference(next) {
    preference = next;
}
function getTransportPreference() {
    return preference;
}
function readPreferenceOverride() {
    try {
        const raw = new URLSearchParams(window.location.search).get('transport')
            || localStorage.getItem('transportPreference')
            || '';
        if (raw === 'ws' || raw === 'websocket')
            return 'websocket';
        if (raw === 'wt' || raw === 'webtransport')
            return 'webtransport';
    }
    catch {
        // No window/localStorage (tests, workers) — auto is the right default.
    }
    return 'auto';
}
/**
 * When WebTransport last failed per origin, so a reconnect storm does not pay
 * the connect timeout over and over.
 *
 * The cooldown is the whole design. Remembering a failure *permanently* — which
 * is what a plain "already failed" flag does — turns any transient hiccup into a
 * permanent downgrade: restart the server, regenerate its certificate, or lose
 * the network for a moment while the page is open, and that tab is pinned to
 * WebSocket until it is closed, long after the server is healthy again. Since
 * the failure is stored in sessionStorage it even survives reloads, so the
 * obvious way to fix it does not. Expiring the entry means a blip costs one
 * attempt per minute instead of the rest of the session.
 */
const WT_FAILURE_COOLDOWN_MS = 60000;
const wtFailedAt = new Map();
const WT_FAILED_KEY = 'wtUnavailableOrigins';
function loadFailedOrigins() {
    try {
        const raw = sessionStorage.getItem(WT_FAILED_KEY);
        if (!raw)
            return;
        const parsed = JSON.parse(raw);
        // Older builds stored a bare array of origins with no timestamp. There
        // is no way to tell how old those are, so they are discarded rather than
        // treated as fresh failures — which is also what heals a tab pinned by
        // one of them.
        if (Array.isArray(parsed)) {
            sessionStorage.removeItem(WT_FAILED_KEY);
            return;
        }
        for (const [origin, at] of Object.entries(parsed)) {
            if (typeof at === 'number')
                wtFailedAt.set(origin, at);
        }
    }
    catch {
        // sessionStorage unavailable or corrupt — start with an empty map.
    }
}
loadFailedOrigins();
function persistFailedOrigins() {
    try {
        sessionStorage.setItem(WT_FAILED_KEY, JSON.stringify(Object.fromEntries(wtFailedAt)));
    }
    catch {
        // Best effort; the in-memory map still suppresses retries this page load.
    }
}
function markWebTransportFailed(origin) {
    wtFailedAt.set(origin, Date.now());
    persistFailedOrigins();
}
/** Milliseconds left on the cooldown, or 0 if WebTransport is worth trying. */
function failureCooldownRemaining(origin) {
    const at = wtFailedAt.get(origin);
    if (at === undefined)
        return 0;
    const remaining = WT_FAILURE_COOLDOWN_MS - (Date.now() - at);
    if (remaining > 0)
        return remaining;
    // Cooled off: forget it so the next attempt is a clean one.
    wtFailedAt.delete(origin);
    persistFailedOrigins();
    return 0;
}
/** Per-origin `/transport-info`, shared by every connect to that origin. */
const infoCache = new Map();
function normaliseOrigin(serverUrl) {
    try {
        return new URL(serverUrl, window.location.href).origin;
    }
    catch {
        return serverUrl;
    }
}
async function fetchTransportInfo(origin) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INFO_TIMEOUT_MS);
    try {
        const res = await fetch(`${origin}/transport-info`, {
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch {
        // An old server has no such route, or the request timed out. Either way
        // the answer is "WebSocket only".
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
function getTransportInfo(origin) {
    let pending = infoCache.get(origin);
    if (!pending) {
        pending = fetchTransportInfo(origin);
        infoCache.set(origin, pending);
    }
    return pending;
}
/**
 * Warm the capability probe without opening a connection. The title screen
 * calls this so the first real connect never pays for the extra round trip.
 */
function prefetchTransportInfo(serverUrl) {
    if (preference === 'websocket')
        return;
    const origin = normaliseOrigin(serverUrl);
    if (!webTransportPossible(origin))
        return;
    void getTransportInfo(origin);
}
/**
 * Cheap local checks, before we spend a request asking the server anything.
 * Returns the reason WebTransport is off the table, or '' if it is worth trying.
 * Phrased for the console: every connection reports which transport it chose and
 * why, so "why am I on WebSocket?" is answerable from the client's own log.
 */
function webTransportBlockReason(origin) {
    if (preference === 'websocket')
        return 'transport preference is pinned to websocket';
    if (typeof WebTransport === 'undefined')
        return 'this browser does not implement WebTransport';
    // Secure-context only, and QUIC has no cleartext mode to fall back on.
    if (!origin.startsWith('https:'))
        return `${origin} is not https (WebTransport is secure-context only)`;
    if (preference !== 'webtransport') {
        const cooldown = failureCooldownRemaining(origin);
        if (cooldown > 0) {
            return `WebTransport failed for this origin recently, retrying in ${Math.ceil(cooldown / 1000)}s`;
        }
    }
    return '';
}
function webTransportPossible(origin) {
    return webTransportBlockReason(origin) === '';
}
function withTimeout(promise, ms, what) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
        promise.then(value => { clearTimeout(timer); resolve(value); }, err => { clearTimeout(timer); reject(err); });
    });
}
function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        out[i] = binary.charCodeAt(i);
    return out;
}
/** Build the `https://host:port/path` a WebTransport session connects to. */
function webTransportUrl(origin, info) {
    const base = new URL(origin);
    const host = info.host || base.hostname;
    const port = info.port || (base.port ? Number(base.port) : 443);
    const path = info.path || DEFAULT_WT_PATH;
    return `https://${host}:${port}${path}`;
}
class WebSocketTransport {
    constructor(ws) {
        this.ws = ws;
        this.kind = 'websocket';
        this.onmessage = null;
        this.onclose = null;
        this.closed = false;
        ws.onmessage = (event) => {
            // binaryType is 'arraybuffer' (set in connectWebSocket), so anything
            // else on the wire is a protocol violation we simply ignore.
            if (!(event.data instanceof ArrayBuffer))
                return;
            this.onmessage?.(new Uint8Array(event.data));
        };
        ws.onclose = () => this.fireClose();
        ws.onerror = () => this.fireClose();
    }
    get open() {
        return !this.closed && this.ws.readyState === WebSocket.OPEN;
    }
    get bufferedAmount() {
        return this.ws.bufferedAmount;
    }
    send(payload) {
        if (!this.open)
            return;
        this.ws.send(payload);
    }
    close() {
        this.closed = true;
        try {
            this.ws.close();
        }
        catch { /* already closing */ }
    }
    fireClose() {
        if (this.closed)
            return;
        this.closed = true;
        const cb = this.onclose;
        this.onclose = null;
        cb?.();
    }
}
class WebTransportTransport {
    constructor(transport, stream) {
        this.transport = transport;
        this.kind = 'webtransport';
        this.onmessage = null;
        this.onclose = null;
        this.closed = false;
        /**
         * Bytes written but not yet accepted by the stream. WebTransport exposes no
         * `bufferedAmount`, so this is tracked by hand to give the volatile-message
         * drop heuristic in ws_client.ts the same signal it gets from WebSocket.
         */
        this.pending = 0;
        this.writer = stream.writable.getWriter();
        void this.pump(stream.readable.getReader());
        // `closed` rejects on an unclean shutdown; both outcomes are just "gone".
        this.transport.closed.then(() => this.fireClose(), () => this.fireClose());
    }
    get open() {
        return !this.closed;
    }
    get bufferedAmount() {
        return this.pending;
    }
    send(payload) {
        if (this.closed)
            return;
        const framed = (0, stream_framing_1.frameMessage)(payload);
        this.pending += framed.byteLength;
        this.writer.write(framed).then(() => { this.pending -= framed.byteLength; }, () => { this.pending -= framed.byteLength; this.fireClose(); });
    }
    close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.onclose = null;
        try {
            this.transport.close();
        }
        catch { /* already closing */ }
    }
    async pump(reader) {
        const frames = new stream_framing_1.FrameReader(MAX_SERVER_FRAME_BYTES);
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (!value || value.byteLength === 0)
                    continue;
                frames.push(value, payload => this.onmessage?.(payload));
            }
        }
        catch {
            // Stream error or an oversized frame — treated as a dead connection.
        }
        this.fireClose();
    }
    fireClose() {
        if (this.closed)
            return;
        this.closed = true;
        const cb = this.onclose;
        this.onclose = null;
        try {
            this.transport.close();
        }
        catch { /* already gone */ }
        cb?.();
    }
}
function connectWebSocket(origin) {
    return new Promise((resolve, reject) => {
        let ws;
        try {
            ws = new WebSocket(origin.replace(/^http/, 'ws') + '/ws');
        }
        catch (e) {
            reject(e);
            return;
        }
        // ArrayBuffer rather than Blob: Blob would force an async decode path.
        ws.binaryType = 'arraybuffer';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            try {
                ws.close();
            }
            catch { /* already closing */ }
            reject(new Error('WebSocket connection timed out'));
        }, WS_CONNECT_TIMEOUT_MS);
        ws.onopen = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(new WebSocketTransport(ws));
        };
        // Only meaningful before open resolves; WebSocketTransport reinstalls
        // its own handlers the moment it takes ownership.
        ws.onerror = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            reject(new Error('WebSocket connection failed'));
        };
        ws.onclose = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            reject(new Error('WebSocket closed before opening'));
        };
    });
}
async function connectWebTransport(origin, info) {
    const options = {};
    if (info.certHashes && info.certHashes.length > 0) {
        options.serverCertificateHashes = info.certHashes.map(hash => ({
            algorithm: 'sha-256',
            value: base64ToBytes(hash),
        }));
    }
    const transport = new WebTransport(webTransportUrl(origin, info), options);
    let handedOff = false;
    try {
        await withTimeout(transport.ready, WT_CONNECT_TIMEOUT_MS, 'WebTransport handshake');
        // The client opens the stream so the server can treat "first incoming
        // bidirectional stream" as the connection being ready to use.
        const stream = await withTimeout(transport.createBidirectionalStream(), WT_CONNECT_TIMEOUT_MS, 'WebTransport stream open');
        handedOff = true;
        return new WebTransportTransport(transport, stream);
    }
    finally {
        if (!handedOff) {
            try {
                transport.close();
            }
            catch { /* never opened */ }
        }
    }
}
/**
 * Open the best transport available to `serverUrl`, resolving once it is ready
 * to carry messages. Rejects only if WebSocket — the universal fallback — also
 * fails.
 */
async function connectTransport(serverUrl) {
    const origin = normaliseOrigin(serverUrl);
    const blocked = webTransportBlockReason(origin);
    if (blocked) {
        console.log(`[CLIENT] Transport: WebSocket — ${blocked}`);
        return connectWebSocket(origin);
    }
    try {
        const info = await getTransportInfo(origin);
        if (!info) {
            console.log('[CLIENT] Transport: WebSocket — server did not answer /transport-info');
            return connectWebSocket(origin);
        }
        if (!info.webtransport) {
            console.log('[CLIENT] Transport: WebSocket — server does not offer WebTransport');
            return connectWebSocket(origin);
        }
        const url = webTransportUrl(origin, info);
        const transport = await connectWebTransport(origin, info);
        console.log(`[CLIENT] Transport: WebTransport (HTTP/3) → ${url}`
            + (info.certHashes?.length ? ' [certificate pinned by hash]' : ''));
        return transport;
    }
    catch (e) {
        console.warn('[CLIENT] Transport: WebSocket — WebTransport attempt failed:', e);
        // Re-probing on every reconnect would add a stall per attempt for a
        // path that has already proven it cannot carry QUIC.
        markWebTransportFailed(origin);
        if (preference === 'webtransport')
            throw e;
        return connectWebSocket(origin);
    }
}
