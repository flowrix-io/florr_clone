"use strict";
/**
 * Length-prefixed framing for byte-stream transports.
 *
 * WebSocket delivers discrete messages, so the wire protocol (see
 * binary_codec.ts) can hand a whole encoded `[event, ...args]` array to
 * `send()` and get exactly that back on the other side. A WebTransport
 * bidirectional stream is a raw *byte* stream: writes coalesce and split
 * arbitrarily, so the message boundary has to be carried in-band.
 *
 * Frame layout: a 4-byte little-endian unsigned length, then that many
 * payload bytes. Nothing else — the payload is the same binary_codec blob a
 * WebSocket frame would have carried, so both transports feed byte-identical
 * messages to the existing handlers.
 *
 * Shared by the browser client (net/transport.ts) and the server
 * (server/webtransport_server.ts); keep it free of DOM and node imports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameReader = exports.MAX_CHUNK_BYTES = exports.MAX_FRAME_BYTES = exports.FRAME_HEADER_BYTES = void 0;
exports.frameMessage = frameMessage;
exports.FRAME_HEADER_BYTES = 4;
/**
 * Absolute ceiling on a frame, and the default when a caller names no limit.
 *
 * Every reader that faces the network should pass its own, smaller value,
 * because this number is an *allocation an untrusted peer chooses*: a stream
 * carries no framing of its own, so the reader must hold a partial frame until
 * the rest arrives, and a peer that declares a huge frame then dribbles bytes
 * keeps that much memory reserved for as long as it likes.
 *
 * The two directions deserve very different limits, which is why this is a
 * parameter rather than a constant:
 *
 *   - Server reading a client: MAX_INBOUND_MESSAGE_BYTES (ws_server.ts), a tight
 *     64KB, because no legitimate client message comes close and the server's
 *     heap is the thing under attack.
 *   - Client reading the server: generous — the server legitimately sends large
 *     frames (WALL_GRID alone encodes to ~40KB, and a busy gameStateUpdate can
 *     be larger), and the peer is the game server rather than a stranger. It is
 *     still bounded, so a corrupt stream cannot allocate without limit.
 */
exports.MAX_FRAME_BYTES = 16 * 1024 * 1024;
/**
 * Floor for the per-chunk sanity bound. One delivered chunk may legitimately
 * carry several coalesced frames, so the effective limit is this or twice the
 * frame cap, whichever is larger — enough that correctly flow-controlled
 * streams never trip it, while a misbehaving transport still cannot turn a
 * single read into an arbitrary allocation.
 */
exports.MAX_CHUNK_BYTES = 1024 * 1024;
/** Prefix `payload` with its length, ready to write to a stream. */
function frameMessage(payload) {
    const out = new Uint8Array(exports.FRAME_HEADER_BYTES + payload.byteLength);
    const len = payload.byteLength;
    out[0] = len & 0xff;
    out[1] = (len >>> 8) & 0xff;
    out[2] = (len >>> 16) & 0xff;
    out[3] = (len >>> 24) & 0xff;
    out.set(payload, exports.FRAME_HEADER_BYTES);
    return out;
}
/**
 * Reassembles whole frames out of arbitrarily-chopped stream chunks.
 *
 * The payload handed to `onFrame` is a *view into the reader's own buffer* and
 * is only valid for the duration of that call — the next `push()` may overwrite
 * it. Both call sites decode synchronously (binary_codec copies any bytes it
 * retains), which is why this avoids a per-message copy on the hot path.
 */
class FrameReader {
    /**
     * @param maxFrameBytes largest frame this reader will accept, and therefore
     * the bound on how much it will ever buffer for one peer.
     */
    constructor(maxFrameBytes = exports.MAX_FRAME_BYTES) {
        this.buf = new Uint8Array(0);
        this.start = 0;
        this.end = 0;
        this.maxFrameBytes = Math.min(maxFrameBytes, exports.MAX_FRAME_BYTES);
        this.maxChunkBytes = Math.max(exports.MAX_CHUNK_BYTES, this.maxFrameBytes * 2);
    }
    /**
     * Feed one stream chunk. Throws if the peer announces — or leaves buffered —
     * a frame larger than the cap; the caller must treat that as fatal and drop
     * the connection rather than try to resynchronise, because a stream whose
     * length prefixes cannot be trusted has no resynchronisation point.
     */
    push(chunk, onFrame) {
        // A single chunk may legitimately carry many coalesced frames, so its
        // size is not bounded by the frame cap — only by how much the peer's
        // flow-control window let it send before we drained. Anything past that
        // means the transport handed us something it should not have.
        if (chunk.byteLength > this.maxChunkBytes) {
            throw new Error(`Implausible stream chunk: ${chunk.byteLength} bytes`);
        }
        this.append(chunk);
        for (;;) {
            const available = this.end - this.start;
            if (available < exports.FRAME_HEADER_BYTES)
                break;
            const b = this.buf;
            const s = this.start;
            const len = (b[s] | (b[s + 1] << 8) | (b[s + 2] << 16) | (b[s + 3] << 24)) >>> 0;
            if (len > this.maxFrameBytes) {
                throw new Error(`Oversized stream frame: ${len} bytes declared`);
            }
            if (available - exports.FRAME_HEADER_BYTES < len)
                break;
            const from = s + exports.FRAME_HEADER_BYTES;
            this.start = from + len;
            onFrame(b.subarray(from, from + len));
        }
        if (this.start === this.end) {
            this.start = 0;
            this.end = 0;
        }
        // Whatever is left is one incomplete frame, so the loop above has
        // already validated its declared length — this cannot trip unless that
        // reasoning breaks. It is kept because it is the invariant that bounds
        // this object's memory, and a silent violation of it is a heap leak an
        // unauthenticated peer controls.
        const residual = this.end - this.start;
        if (residual > this.maxFrameBytes + exports.FRAME_HEADER_BYTES) {
            throw new Error(`Stream buffer overrun: ${residual} bytes pending`);
        }
    }
    append(chunk) {
        const kept = this.end - this.start;
        const needed = kept + chunk.byteLength;
        if (this.buf.byteLength < needed) {
            const next = new Uint8Array(Math.max(needed, this.buf.byteLength * 2, 4096));
            next.set(this.buf.subarray(this.start, this.end));
            this.buf = next;
            this.start = 0;
            this.end = kept;
        }
        else if (this.buf.byteLength - this.end < chunk.byteLength) {
            // Enough room overall, just not at the tail — slide the unread
            // remainder back to the front instead of reallocating.
            this.buf.copyWithin(0, this.start, this.end);
            this.start = 0;
            this.end = kept;
        }
        this.buf.set(chunk, this.end);
        this.end += chunk.byteLength;
    }
}
exports.FrameReader = FrameReader;
