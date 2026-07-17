"use strict";
/**
 * Compact binary codec for the WebSocket wire protocol. Dependency-free.
 *
 * Tag layout (single byte, little-endian payloads):
 *   0x00–0x7F  positive fixint (0–127)              — 1 byte total
 *   0x80–0x9F  fixstr len 0–31                       — 1 + N bytes
 *   0xA0–0xBF  fixarr len 0–31
 *   0xC0–0xDF  fixmap len 0–31
 *   0xE0       null
 *   0xE1       undefined
 *   0xE2       false
 *   0xE3       true
 *   0xE4       int8                                  — 2 bytes
 *   0xE5       int16                                 — 3 bytes
 *   0xE6       int32                                 — 5 bytes
 *   0xE7       uint32                                — 5 bytes
 *   0xE8       float32                               — 5 bytes
 *   0xE9       float64                               — 9 bytes
 *   0xEA       str8 (1-byte len, lengths 32–255)
 *   0xEB       str16 (2-byte len, lengths up to 65535)
 *   0xEC       arr16 (2-byte len)
 *   0xED       map16 (2-byte len)
 *   0xEE       bin8 (1-byte len + bytes)
 *   0xEF       bin16 (2-byte len + bytes)
 *
 * Number policy:
 *   Integer values pick the smallest int slot that fits; larger ones spill to float64.
 *   Non-integer values are stored as float32 — ~7 sig figs is more than enough for
 *   positions, angles, and speeds on this map, and it saves 4 bytes vs float64.
 *   Date.now()-style millisecond timestamps are integers > 2^32 → they take the
 *   float64 slot (9 bytes), preserving full precision.
 *
 * Objects: only own enumerable string keys are encoded. The decoder rebuilds plain
 * objects (no class instances). Cyclic references are not supported.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encode = encode;
exports.decode = decode;
const TAG_NULL = 0xE0;
const TAG_UNDEF = 0xE1;
const TAG_FALSE = 0xE2;
const TAG_TRUE = 0xE3;
const TAG_INT8 = 0xE4;
const TAG_INT16 = 0xE5;
const TAG_INT32 = 0xE6;
const TAG_UINT32 = 0xE7;
const TAG_FLOAT32 = 0xE8;
const TAG_FLOAT64 = 0xE9;
const TAG_STR8 = 0xEA;
const TAG_STR16 = 0xEB;
const TAG_ARR16 = 0xEC;
const TAG_MAP16 = 0xED;
const TAG_BIN8 = 0xEE;
const TAG_BIN16 = 0xEF;
const FIXSTR_BASE = 0x80;
const FIXARR_BASE = 0xA0;
const FIXMAP_BASE = 0xC0;
// Reuse across calls. TextEncoder/Decoder are stateless and thread-safe within a worker.
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });
class Writer {
    constructor(initialSize) {
        this.pos = 0;
        this.buf = new Uint8Array(initialSize);
        this.dv = new DataView(this.buf.buffer);
    }
    grow(min) {
        let n = this.buf.length * 2;
        while (n < min)
            n *= 2;
        const nb = new Uint8Array(n);
        nb.set(this.buf);
        this.buf = nb;
        this.dv = new DataView(this.buf.buffer);
    }
    ensure(n) {
        if (this.pos + n > this.buf.length)
            this.grow(this.pos + n);
    }
    u8(v) { this.ensure(1); this.buf[this.pos++] = v; }
    i8(v) { this.ensure(1); this.dv.setInt8(this.pos, v); this.pos += 1; }
    u16(v) { this.ensure(2); this.dv.setUint16(this.pos, v, true); this.pos += 2; }
    i16(v) { this.ensure(2); this.dv.setInt16(this.pos, v, true); this.pos += 2; }
    i32(v) { this.ensure(4); this.dv.setInt32(this.pos, v, true); this.pos += 4; }
    u32(v) { this.ensure(4); this.dv.setUint32(this.pos, v, true); this.pos += 4; }
    f32(v) { this.ensure(4); this.dv.setFloat32(this.pos, v, true); this.pos += 4; }
    f64(v) { this.ensure(8); this.dv.setFloat64(this.pos, v, true); this.pos += 8; }
    bytes(b) { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
    writeValue(v) {
        if (v === null) {
            this.u8(TAG_NULL);
            return;
        }
        if (v === undefined) {
            this.u8(TAG_UNDEF);
            return;
        }
        if (v === true) {
            this.u8(TAG_TRUE);
            return;
        }
        if (v === false) {
            this.u8(TAG_FALSE);
            return;
        }
        const t = typeof v;
        if (t === 'number') {
            // NaN/Infinity aren't representable as integers, fall through to float.
            if (Number.isInteger(v)) {
                if (v >= 0 && v <= 0x7F) {
                    this.u8(v);
                    return;
                }
                if (v >= -0x80 && v <= 0x7F) {
                    this.u8(TAG_INT8);
                    this.i8(v);
                    return;
                }
                if (v >= -0x8000 && v <= 0x7FFF) {
                    this.u8(TAG_INT16);
                    this.i16(v);
                    return;
                }
                if (v >= -0x80000000 && v <= 0x7FFFFFFF) {
                    this.u8(TAG_INT32);
                    this.i32(v);
                    return;
                }
                if (v >= 0 && v <= 0xFFFFFFFF) {
                    this.u8(TAG_UINT32);
                    this.u32(v);
                    return;
                }
                // Larger integers (e.g. ms timestamps) fall back to float64 — lossless up to 2^53.
                this.u8(TAG_FLOAT64);
                this.f64(v);
                return;
            }
            // Non-integer floats: float32 is enough precision for positions, angles, and speeds.
            this.u8(TAG_FLOAT32);
            this.f32(v);
            return;
        }
        if (t === 'string') {
            const bytes = TEXT_ENCODER.encode(v);
            const n = bytes.length;
            if (n <= 31) {
                this.u8(FIXSTR_BASE | n);
            }
            else if (n <= 0xFF) {
                this.u8(TAG_STR8);
                this.u8(n);
            }
            else if (n <= 0xFFFF) {
                this.u8(TAG_STR16);
                this.u16(n);
            }
            else {
                throw new Error('binary_codec: string too long (' + n + ')');
            }
            this.bytes(bytes);
            return;
        }
        if (v instanceof Uint8Array) {
            const n = v.length;
            if (n <= 0xFF) {
                this.u8(TAG_BIN8);
                this.u8(n);
            }
            else if (n <= 0xFFFF) {
                this.u8(TAG_BIN16);
                this.u16(n);
            }
            else
                throw new Error('binary_codec: binary too long (' + n + ')');
            this.bytes(v);
            return;
        }
        if (Array.isArray(v)) {
            const n = v.length;
            if (n <= 31) {
                this.u8(FIXARR_BASE | n);
            }
            else if (n <= 0xFFFF) {
                this.u8(TAG_ARR16);
                this.u16(n);
            }
            else {
                throw new Error('binary_codec: array too long (' + n + ')');
            }
            for (let i = 0; i < n; i++)
                this.writeValue(v[i]);
            return;
        }
        if (t === 'object') {
            const keys = Object.keys(v);
            const n = keys.length;
            if (n <= 31) {
                this.u8(FIXMAP_BASE | n);
            }
            else if (n <= 0xFFFF) {
                this.u8(TAG_MAP16);
                this.u16(n);
            }
            else {
                throw new Error('binary_codec: map too long (' + n + ')');
            }
            for (let i = 0; i < n; i++) {
                const k = keys[i];
                this.writeValue(k);
                this.writeValue(v[k]);
            }
            return;
        }
        // Functions, symbols, bigint, etc. aren't sent across the wire in this app.
        throw new Error('binary_codec: unsupported type ' + t);
    }
    finish() {
        // Return a tight view; don't allocate a new buffer (caller treats output as read-only).
        return this.buf.subarray(0, this.pos);
    }
}
function encode(value) {
    const w = new Writer(256);
    w.writeValue(value);
    return w.finish();
}
class Reader {
    constructor(buf) {
        this.pos = 0;
        this.buf = buf;
        this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    readStr(n) {
        const out = TEXT_DECODER.decode(this.buf.subarray(this.pos, this.pos + n));
        this.pos += n;
        return out;
    }
    readArr(n) {
        const a = new Array(n);
        for (let i = 0; i < n; i++)
            a[i] = this.read();
        return a;
    }
    readMap(n) {
        const o = {};
        for (let i = 0; i < n; i++) {
            const tag = this.buf[this.pos++];
            let k;
            if (tag >= FIXSTR_BASE && tag <= FIXSTR_BASE + 31) {
                k = this.readStr(tag & 0x1F);
            }
            else if (tag === TAG_STR8) {
                k = this.readStr(this.buf[this.pos++]);
            }
            else if (tag === TAG_STR16) {
                const len = this.dv.getUint16(this.pos, true);
                this.pos += 2;
                k = this.readStr(len);
            }
            else {
                // Non-string keys are not expected but tolerate via generic path.
                this.pos--;
                k = String(this.read());
            }
            o[k] = this.read();
        }
        return o;
    }
    readBytes(n) {
        // slice copies — required so the caller's view isn't aliased to the input buffer.
        const out = this.buf.slice(this.pos, this.pos + n);
        this.pos += n;
        return out;
    }
    read() {
        const tag = this.buf[this.pos++];
        if (tag <= 0x7F)
            return tag;
        if (tag >= FIXSTR_BASE && tag <= FIXSTR_BASE + 31)
            return this.readStr(tag & 0x1F);
        if (tag >= FIXARR_BASE && tag <= FIXARR_BASE + 31)
            return this.readArr(tag & 0x1F);
        if (tag >= FIXMAP_BASE && tag <= FIXMAP_BASE + 31)
            return this.readMap(tag & 0x1F);
        switch (tag) {
            case TAG_NULL: return null;
            case TAG_UNDEF: return undefined;
            case TAG_FALSE: return false;
            case TAG_TRUE: return true;
            case TAG_INT8: {
                const v = this.dv.getInt8(this.pos);
                this.pos += 1;
                return v;
            }
            case TAG_INT16: {
                const v = this.dv.getInt16(this.pos, true);
                this.pos += 2;
                return v;
            }
            case TAG_INT32: {
                const v = this.dv.getInt32(this.pos, true);
                this.pos += 4;
                return v;
            }
            case TAG_UINT32: {
                const v = this.dv.getUint32(this.pos, true);
                this.pos += 4;
                return v;
            }
            case TAG_FLOAT32: {
                const v = this.dv.getFloat32(this.pos, true);
                this.pos += 4;
                return v;
            }
            case TAG_FLOAT64: {
                const v = this.dv.getFloat64(this.pos, true);
                this.pos += 8;
                return v;
            }
            case TAG_STR8: {
                const n = this.buf[this.pos++];
                return this.readStr(n);
            }
            case TAG_STR16: {
                const n = this.dv.getUint16(this.pos, true);
                this.pos += 2;
                return this.readStr(n);
            }
            case TAG_ARR16: {
                const n = this.dv.getUint16(this.pos, true);
                this.pos += 2;
                return this.readArr(n);
            }
            case TAG_MAP16: {
                const n = this.dv.getUint16(this.pos, true);
                this.pos += 2;
                return this.readMap(n);
            }
            case TAG_BIN8: {
                const n = this.buf[this.pos++];
                return this.readBytes(n);
            }
            case TAG_BIN16: {
                const n = this.dv.getUint16(this.pos, true);
                this.pos += 2;
                return this.readBytes(n);
            }
        }
        throw new Error('binary_codec: unknown tag 0x' + tag.toString(16));
    }
}
function decode(buf) {
    return new Reader(buf).read();
}
