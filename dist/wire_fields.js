"use strict";
/**
 * Positional field layouts for the per-tick delta entries.
 *
 * Every entity entry used to travel as a MAP — `{"i":"2g","t":"dandelion",
 * "x":1816.5,...}`. This codec writes each key as a string, so a 1-character
 * key costs 2 bytes (fixstr tag + the character). A byte-attribution probe of
 * real gameStateUpdate frames at 12 clients found map keys were 37.3% of the
 * whole frame — 289 of 777 bytes, the single largest line item, ahead of
 * positions (31%) and entity ids (17.6%).
 *
 * So an entry is written instead as `[mask, ...presentValues]`: one integer
 * whose bit i says "field i is present", followed by the values in declaration
 * order. Field names never reach the wire.
 *
 * ORDERING IS LOAD-BEARING, twice over:
 *   - It is the protocol. Encoder and decoder both read these arrays, so the
 *     order must never be changed without bumping the handshake signature
 *     (wireFieldsSignature is folded into it, so any edit here does that
 *     automatically and stale clients are told to reload).
 *   - Most-frequent fields come FIRST so the mask stays small. The codec
 *     encodes 0-127 in one byte, so keeping the common case under bit 7 makes
 *     the mask itself free relative to the keys it replaces.
 *
 * Packing happens at the wire boundary only: the client rehydrates entries into
 * the same objects it always had, so no consumer downstream of the decode knows
 * this format exists.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PETAL_FIELDS = exports.PLAYER_FIELDS = exports.ENEMY_FIELDS = void 0;
exports.packId = packId;
exports.unpackId = unpackId;
exports.packFields = packFields;
exports.unpackFields = unpackFields;
exports.wireFieldsSignature = wireFieldsSignature;
/** Enemy delta. i/x/y/a/h are the common case and stay inside one mask byte. */
exports.ENEMY_FIELDS = ['i', 'x', 'y', 'a', 'h', 'H', 't', 'T', 'o'];
/** Player delta. Self-only fields (vx/vy/u/sm) sit high; they are rare. */
exports.PLAYER_FIELDS = [
    'i', 'x', 'y', 'a', 'h', 'H', 'e', 'f', 'm', 'q', 'r', 'n', 'k', 'l', 's',
    'v', 'M', 'V', 'z', 'c', 'p', 'sm', 'u', 'vx', 'vy',
];
/** One petal position inside a player's `p` array. */
exports.PETAL_FIELDS = ['L', 'I', 'x', 'y', 'N'];
/**
 * Entity id -> wire form. Ids are integer-valued strings (see entity_ids.ts),
 * so a canonical decimal one becomes a real integer: 1 byte up to 127, 3 up to
 * 32767, against 1 + length as a string. Ids that are NOT plain decimals — bot
 * ids (`bot_x`) and split halves (`7_split2`) — travel unchanged as strings.
 *
 * The guard is `String(n) === id`, which is what makes the round trip lossless:
 * it rejects leading zeros, signs, exponent forms and anything else where
 * String(Number(id)) would not reproduce the original key.
 */
function packId(id) {
    if (typeof id !== 'string')
        return id;
    const n = +id;
    return Number.isInteger(n) && n >= 0 && String(n) === id ? n : id;
}
/** Inverse of packId. Numbers become their decimal string; strings pass through. */
function unpackId(v) {
    return typeof v === 'number' ? String(v) : v;
}
/**
 * Map -> `[mask, ...values]`. Fields whose value is `undefined` are absent,
 * which is exactly the "unchanged this tick" convention the delta encoders
 * already used by simply not setting the key.
 */
function packFields(obj, fields) {
    const out = [0];
    let mask = 0;
    for (let i = 0; i < fields.length; i++) {
        const v = obj[fields[i]];
        if (v !== undefined) {
            mask |= (1 << i);
            out.push(fields[i] === 'i' ? packId(v) : v);
        }
    }
    out[0] = mask;
    return out;
}
/** `[mask, ...values]` -> map. Non-arrays pass through untouched. */
function unpackFields(arr, fields) {
    if (!Array.isArray(arr))
        return arr;
    const mask = arr[0];
    const o = {};
    let k = 1;
    for (let i = 0; i < fields.length; i++) {
        if (mask & (1 << i)) {
            const v = arr[k++];
            o[fields[i]] = fields[i] === 'i' ? unpackId(v) : v;
        }
    }
    return o;
}
/** Fingerprint of all three layouts, mixed into the handshake signature. */
function wireFieldsSignature() {
    let h = 2166136261;
    for (const list of [exports.ENEMY_FIELDS, exports.PLAYER_FIELDS, exports.PETAL_FIELDS]) {
        for (const n of list) {
            for (let i = 0; i < n.length; i++)
                h = Math.imul(h ^ n.charCodeAt(i), 16777619);
            h = Math.imul(h ^ 44, 16777619);
        }
        h = Math.imul(h ^ 59, 16777619);
    }
    return (h >>> 0).toString(36);
}
