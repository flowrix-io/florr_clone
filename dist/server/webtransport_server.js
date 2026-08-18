"use strict";
/**
 * WebTransport (HTTP/3 over QUIC) listener, offered alongside the WebSocket one.
 *
 * Clients choose between the two by themselves (see net/transport.ts); this
 * module's job is to make the choice available and to present each accepted
 * session to WSServer as an ordinary socket, so every game handler works
 * unchanged regardless of how the bytes arrived.
 *
 * Everything here is optional and best-effort:
 *
 *   - The QUIC stack (`@fails-components/webtransport`) is an optional native
 *     dependency. If it is not installed, or its prebuilt binary does not match
 *     the host, startup logs one line and the server runs WebSocket-only.
 *   - It needs TLS, so it is skipped when the server is running plain HTTP.
 *   - It binds UDP on the same port number the HTTP/WebSocket listener uses for
 *     TCP, so no extra firewall rule beyond "also allow UDP on that port".
 *
 * A deployment behind a proxy that only forwards TCP — Cloudflare's proxy, an
 * ordinary reverse proxy — will simply never complete a QUIC handshake, and
 * every client falls back to WebSocket after one attempt.
 *
 * The module is ESM-only, so it is pulled in with a real dynamic `import()`
 * (see `esmImport` below) rather than `require`, which this CommonJS build
 * would otherwise be rewritten into.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWebTransportStats = getWebTransportStats;
exports.getWebTransportAdvertisement = getWebTransportAdvertisement;
exports.startWebTransportServer = startWebTransportServer;
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const ws_server_1 = require("../ws_server");
const stream_framing_1 = require("../net/stream_framing");
const webtransport_limits_1 = require("./webtransport_limits");
/**
 * `import()` that survives TypeScript's CommonJS emit. `tsc` rewrites a literal
 * dynamic import into `require()`, which cannot load an ESM-only package.
 */
const esmImport = new Function('specifier', 'return import(specifier)');
const DEFAULT_PATH = '/wt';
/**
 * Upper bound on how long a session may sit accepted without opening its
 * message stream. Without this a peer that completes the QUIC handshake and
 * then goes quiet holds a session object forever — the cheapest possible way to
 * exhaust the session limit, since it costs the attacker one handshake.
 */
const STREAM_WAIT_MS = 10000;
/**
 * Close a session that has sent nothing for this long. The WebSocket route gets
 * the equivalent from uWS (`idleTimeout` with automatic pings); WebTransport has
 * no built-in, so a half-open session would otherwise sit there forever. Real
 * clients send a heartbeat every second (see socket.ts), so this is ~60× the
 * expected quiet period.
 */
const IDLE_TIMEOUT_MS = envInt('WT_IDLE_TIMEOUT_MS', 60000);
/** How often the idle sweep runs; always well under the timeout it enforces. */
const IDLE_SWEEP_MS = Math.max(1000, Math.min(15000, Math.floor(IDLE_TIMEOUT_MS / 4)));
/**
 * A session needs exactly one bidirectional stream. Opening more is either a
 * broken client or someone looking for an allocation that is not accounted for,
 * so extras are refused rather than queued.
 */
const MAX_EXTRA_STREAMS = 8;
/** Concurrent session ceilings; override per-deployment with the env vars. */
const MAX_SESSIONS = envInt('WT_MAX_SESSIONS', 256);
const MAX_SESSIONS_PER_ADDRESS = envInt('WT_MAX_SESSIONS_PER_IP', 8);
function envInt(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const value = parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
const admission = new webtransport_limits_1.SessionAdmission({
    maxSessions: MAX_SESSIONS,
    maxSessionsPerAddress: MAX_SESSIONS_PER_ADDRESS,
});
/** Live sessions, swept for idleness. */
const liveSessions = new Set();
let idleSweep = null;
function startIdleSweep() {
    if (idleSweep)
        return;
    idleSweep = setInterval(() => {
        const cutoff = Date.now() - IDLE_TIMEOUT_MS;
        for (const transport of liveSessions) {
            if (transport.lastActivity < cutoff) {
                console.warn(`[WT] Idle session from ${transport.remoteAddress || 'unknown ip'} — closing`);
                transport.close(false);
            }
        }
    }, IDLE_SWEEP_MS);
    // Never hold the process open for this.
    idleSweep.unref?.();
}
/** Diagnostics for the admin/status surface. */
function getWebTransportStats() {
    return { sessions: admission.activeSessions, maxSessions: MAX_SESSIONS };
}
/**
 * How long to wait for the QUIC listener to report itself ready. Bounded
 * because /transport-info awaits this promise; a listener that never comes up
 * must degrade to "WebSocket only" rather than stall the probe.
 */
const LISTEN_TIMEOUT_MS = 5000;
/** Mirrors the WebSocket route's maxBackpressure: past this, sends are dropped. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
/**
 * How long a graceful close waits for queued writes to flush. Callers use a
 * graceful disconnect precisely when the last message explains *why* the client
 * is being dropped, so tearing the session down before it drains would lose the
 * one message that mattered.
 */
const CLOSE_DRAIN_MS = 2000;
let advertisement = null;
/** Null until (and unless) a WebTransport listener is actually accepting sessions. */
function getWebTransportAdvertisement() {
    return advertisement;
}
/**
 * Base64 SHA-256 digest of the leaf certificate, in the form
 * `serverCertificateHashes` wants — but only when that certificate is eligible
 * for hash pinning.
 *
 * Hash pinning is what makes a self-signed development certificate usable
 * without browser flags, and browsers accept it only for a certificate that is
 * ECDSA P-256 with a validity window of at most 14 days (scripts/gen-wt-cert.js
 * produces a conforming one). Anything else — an RSA certificate, a 90-day
 * Let's Encrypt certificate — is *rejected* if hashes are supplied, so those
 * are left to ordinary CA validation instead. Testing the certificate against
 * the browsers' own rule means neither case needs a configuration flag.
 */
const MAX_PINNABLE_VALIDITY_MS = 14 * 24 * 60 * 60 * 1000;
function pinnableCertificateHashes(pem) {
    const block = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
    if (!block)
        return [];
    let cert;
    try {
        cert = new crypto_1.default.X509Certificate(block[0]);
    }
    catch {
        return [];
    }
    const key = cert.publicKey;
    if (key.asymmetricKeyType !== 'ec')
        return [];
    if (key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
        return [];
    const from = Date.parse(cert.validFrom);
    const to = Date.parse(cert.validTo);
    if (!Number.isFinite(from) || !Number.isFinite(to))
        return [];
    if (to - from > MAX_PINNABLE_VALIDITY_MS)
        return [];
    return [crypto_1.default.createHash('sha256').update(cert.raw).digest('base64')];
}
/** One accepted WebTransport session, presented to WSServer as a transport. */
class WebTransportSessionTransport {
    constructor(session, writer, remoteAddress) {
        this.session = session;
        this.remoteAddress = remoteAddress;
        this.kind = 'webtransport';
        this.proxiedFor = '';
        this.closed = false;
        /**
         * Bytes handed to the stream writer that it has not accepted yet.
         * WebTransport has no equivalent of uWS' maxBackpressure, so the drop
         * threshold that keeps a stalled client from growing an unbounded queue is
         * enforced here, and reported through the same send status the rest of the
         * server already handles.
         */
        this.buffered = 0;
        /** Set once the admission slot has been handed back. */
        this.slotReleased = false;
        /** Resolves when the most recent write has been accepted by the stream. */
        this.lastWrite = Promise.resolve();
        /** Set as soon as a close begins, so nothing new is queued behind it. */
        this.closing = false;
        this.onClose = null;
        /** Last time anything was received; drives the idle sweep. */
        this.lastActivity = Date.now();
        this.writer = writer;
    }
    /** Called once when the session ends, however it ended. */
    setCloseHandler(handler) {
        if (this.closed) {
            // Already gone before anyone was listening — do not swallow it.
            handler();
            return;
        }
        this.onClose = handler;
    }
    send(payload) {
        const writer = this.writer;
        if (!writer || this.closed || this.closing)
            return -1;
        if (this.buffered > MAX_BUFFERED_BYTES)
            return 2;
        const framed = (0, stream_framing_1.frameMessage)(payload);
        this.buffered += framed.byteLength;
        this.lastWrite = writer.write(framed).then(() => { this.buffered -= framed.byteLength; }, () => { this.buffered -= framed.byteLength; this.fireClose(); });
        // Streams accept writes asynchronously, so the honest answer is always
        // "queued, will drain in order" — status 0, never the synchronous 1.
        return 0;
    }
    close(graceful) {
        if (this.closed || this.closing)
            return;
        this.closing = true;
        if (!graceful) {
            this.fireClose();
            return;
        }
        // Let the queued writes land first, but never hang on a peer that has
        // stopped reading.
        const drained = this.lastWrite.catch(() => undefined);
        const deadline = new Promise(resolve => setTimeout(resolve, CLOSE_DRAIN_MS));
        void Promise.race([drained, deadline]).then(() => this.fireClose());
    }
    /** Record inbound traffic, so the idle sweep leaves a live session alone. */
    touch() {
        this.lastActivity = Date.now();
    }
    /** @internal The session reported itself closed; do not close it again. */
    markClosed() {
        if (this.closed)
            return;
        this.closed = true;
        this.closing = true;
        this.writer = null;
        this.releaseSlot();
        const handler = this.onClose;
        this.onClose = null;
        handler?.();
    }
    /**
     * Give the admission slot back exactly once, however the session ended.
     * Getting this wrong in either direction is a real outage: leak slots and
     * the listener refuses everyone after a while; release twice and the
     * per-address ceiling stops being one.
     */
    releaseSlot() {
        if (this.slotReleased)
            return;
        this.slotReleased = true;
        liveSessions.delete(this);
        admission.release(this.remoteAddress);
    }
    fireClose() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.closing = true;
        this.writer = null;
        this.releaseSlot();
        const handler = this.onClose;
        this.onClose = null;
        try {
            this.session.close();
        }
        catch { /* already gone */ }
        handler?.();
    }
}
/**
 * Reduce the QUIC stack's `[ip]:port` peer string to the bare IP, so it has the
 * same shape as the address uWS reports for a WebSocket (see
 * WSSocket.remoteAddress). The loopback test in server/connection/sessionGuard.ts
 * parses that address; left bracketed and port-suffixed it would parse as
 * nothing, and a developer's local WebTransport tab would silently lose the
 * one-account-one-connection exemption.
 */
function peerIp(peerAddress) {
    if (typeof peerAddress !== 'string' || peerAddress === '')
        return '';
    // `[::1]:52219`, `[::ffff:127.0.0.1]:60748`
    const bracketed = /^\[([^\]]+)\]:\d+$/.exec(peerAddress);
    if (bracketed)
        return bracketed[1];
    // `1.2.3.4:60748`, should a build report it unbracketed.
    const dotted = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(peerAddress);
    if (dotted)
        return dotted[1];
    return peerAddress;
}
/** Wait for the client's first bidirectional stream, which carries all messages. */
async function readFirstStream(session) {
    const reader = session.incomingBidirectionalStreams.getReader();
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('client never opened a stream')), STREAM_WAIT_MS);
    });
    const { value, done } = await Promise.race([reader.read(), timeout]);
    if (done || !value)
        throw new Error('session closed before opening a stream');
    // The reader stays held: extra streams must keep being consumed and closed,
    // or they queue inside the session forever (see drainExtraStreams).
    return { stream: value, reader };
}
/**
 * Keep consuming streams the client opens after the first and close them.
 *
 * An unread `incomingBidirectionalStreams` is an unbounded queue the peer
 * controls: every stream it opens is retained, along with whatever the flow
 * window let it send. Consuming and immediately discarding them keeps that
 * queue empty, and a client that keeps doing it is treated as hostile rather
 * than merely wrong.
 */
function drainExtraStreams(session, reader, transport) {
    void (async () => {
        let extras = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                extras++;
                try {
                    value.readable?.cancel();
                }
                catch { /* already gone */ }
                try {
                    value.writable?.abort();
                }
                catch { /* already gone */ }
                if (extras > MAX_EXTRA_STREAMS) {
                    console.warn(`[WT] ${transport.remoteAddress || 'unknown ip'} opened ${extras} extra streams — closing session`);
                    transport.close(false);
                    return;
                }
            }
        }
        catch {
            // Session went away; nothing to clean up here.
        }
    })();
    // Unidirectional streams are never part of this protocol, so anything
    // arriving on one is discarded rather than buffered.
    void (async () => {
        try {
            const uni = session.incomingUnidirectionalStreams.getReader();
            for (;;) {
                const { done, value } = await uni.read();
                if (done)
                    break;
                try {
                    value.cancel();
                }
                catch { /* already gone */ }
            }
        }
        catch {
            // No unidirectional support, or the session ended — either is fine.
        }
    })();
}
async function handleSession(io, session) {
    await session.ready;
    // `peerAddress` is the UDP peer as the QUIC stack saw it, never a
    // client-supplied header, so it carries the same trust as WSSocket.remoteAddress.
    // QUIC has already validated that the peer receives packets at this address,
    // so it is a sound key to charge a session limit against.
    const address = peerIp(session.peerAddress);
    const verdict = admission.tryAdmit(address);
    if (!verdict.admitted) {
        // Refused before any per-session state exists, so a rejected flood costs
        // this process a handshake and nothing else.
        console.warn(`[WT] Refusing session from ${address || 'unknown ip'}: ${verdict.reason}`);
        try {
            session.close();
        }
        catch { /* already gone */ }
        return;
    }
    let transport = null;
    try {
        const { stream, reader: streamReader } = await readFirstStream(session);
        const writer = stream.writable.getWriter();
        transport = new WebTransportSessionTransport(session, writer, address);
        liveSessions.add(transport);
        drainExtraStreams(session, streamReader, transport);
        // The close handler is wired before the connection handlers run, so a
        // session rejected during `connection` still reaches _handleClose.
        const active = transport;
        const socket = io.attachTransport(active, s => active.setCloseHandler(() => s._handleClose()));
        // Either end of the session going away must land on the same close path.
        session.closed.then(() => active.markClosed(), () => active.markClosed());
        const reader = stream.readable.getReader();
        const frames = new stream_framing_1.FrameReader(ws_server_1.MAX_INBOUND_MESSAGE_BYTES);
        for (;;) {
            // Two failure modes that read alike but mean opposite things: the
            // read rejecting is the session ending, which is what every normal
            // disconnect looks like and is not worth a line in the log; the
            // framing layer throwing is the peer sending something malformed,
            // which is.
            let chunk;
            try {
                const result = await reader.read();
                if (result.done)
                    break;
                chunk = result.value;
            }
            catch {
                break;
            }
            if (!chunk || chunk.byteLength === 0)
                continue;
            active.touch();
            try {
                frames.push(chunk, payload => socket._handleMessage(payload));
            }
            catch (e) {
                console.warn(`[WT] Dropping ${address || 'unknown ip'}: ${e?.message || e}`);
                break;
            }
        }
        // Tear the QUIC session down rather than just letting go of our side.
        // markClosed() would hand back the admission slot while leaving the peer
        // holding an open connection in the native layer — so a client that
        // keeps violating the framing could accumulate sessions this process no
        // longer counts. close() actually ends it, and is idempotent, so the
        // ordinary "client went away" path is unaffected.
        active.close(false);
    }
    catch (e) {
        // Never admitted a transport, so release the slot by hand.
        if (!transport) {
            admission.release(address);
            try {
                session.close();
            }
            catch { /* already gone */ }
        }
        throw e;
    }
}
/**
 * Start accepting WebTransport sessions and register each as a socket on `io`.
 *
 * Returns the advertisement clients need to reach it, or null if WebTransport
 * is unavailable for any reason — in which case nothing is published and every
 * client stays on WebSocket. Never throws.
 */
async function startWebTransportServer(io, options) {
    const path = options.path || DEFAULT_PATH;
    let cert;
    let privKey;
    try {
        cert = fs_1.default.readFileSync(options.certPath, 'utf8');
        privKey = fs_1.default.readFileSync(options.keyPath, 'utf8');
    }
    catch (e) {
        console.warn('[WT] Certificate unreadable, WebTransport disabled:', e);
        return null;
    }
    let Http3Server;
    try {
        ({ Http3Server } = await esmImport('@fails-components/webtransport'));
    }
    catch {
        console.log('[WT] @fails-components/webtransport not installed — WebSocket only');
        return null;
    }
    const hosts = options.host ? [options.host] : ['::', '0.0.0.0'];
    let server = null;
    let lastError = null;
    for (const host of hosts) {
        let candidate = null;
        try {
            candidate = new Http3Server({
                port: options.port,
                host,
                // Signs the QUIC stack's own address-validation tokens — the
                // mechanism that stops a spoofed source address from getting a
                // session, and with it the reflection/amplification abuse a UDP
                // listener is otherwise good for. It never leaves the process
                // and does not need to survive a restart, so a fresh random
                // value per boot is the right choice.
                secret: crypto_1.default.randomBytes(32).toString('hex'),
                cert,
                privKey,
                // Bound the native layer too, not just our own accounting
                // above: connections the C++ side accepts but JS has not seen
                // yet still cost memory.
                maxConnections: MAX_SESSIONS,
                // Flow-control windows cap how much a peer may have in flight
                // before we read it, which is the other half of the memory
                // bound — MAX_INBOUND_MESSAGE_BYTES limits one message, these
                // limit how much unread data can pile up behind it.
                initialStreamFlowControlWindow: ws_server_1.MAX_INBOUND_MESSAGE_BYTES,
                streamFlowControlWindowSizeLimit: 4 * ws_server_1.MAX_INBOUND_MESSAGE_BYTES,
                initialSessionFlowControlWindow: 2 * ws_server_1.MAX_INBOUND_MESSAGE_BYTES,
                sessionFlowControlWindowSizeLimit: 8 * ws_server_1.MAX_INBOUND_MESSAGE_BYTES,
            });
            candidate.startServer();
            await Promise.race([
                candidate.ready,
                new Promise((_, reject) => setTimeout(() => reject(new Error(`listener not ready after ${LISTEN_TIMEOUT_MS}ms`)), LISTEN_TIMEOUT_MS)),
            ]);
            server = candidate;
            break;
        }
        catch (e) {
            lastError = e;
            try {
                candidate?.stopServer();
            }
            catch { /* never started */ }
        }
    }
    if (!server) {
        console.warn(`[WT] Failed to start HTTP/3 listener on udp/${options.port}:`, lastError);
        return null;
    }
    // Accept sessions forever. Each is handled independently; one failing must
    // not stop the accept loop.
    void (async () => {
        try {
            const reader = server.sessionStream(path).getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                handleSession(io, value).catch(e => {
                    console.warn('[WT] Session dropped:', e?.message || e);
                    try {
                        value.close();
                    }
                    catch { /* already gone */ }
                });
            }
        }
        catch (e) {
            console.error('[WT] Accept loop stopped:', e);
        }
    })();
    startIdleSweep();
    const certHashes = pinnableCertificateHashes(cert);
    advertisement = {
        webtransport: true,
        port: options.port,
        path,
        ...(certHashes.length > 0 ? { certHashes } : {}),
    };
    console.log(`[WT] WebTransport listening on udp/${options.port}${path}`
        + (certHashes.length > 0
            ? ' (advertising certificate hashes)'
            : ' (relying on CA validation of the server certificate)'));
    console.log(`[WT] Limits: ${MAX_SESSIONS} sessions, ${MAX_SESSIONS_PER_ADDRESS}/address, `
        + `${ws_server_1.MAX_INBOUND_MESSAGE_BYTES / 1024}KB max message, ${IDLE_TIMEOUT_MS / 1000}s idle timeout`);
    return advertisement;
}
