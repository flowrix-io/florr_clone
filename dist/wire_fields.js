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
exports.PETAL_FIELDS = exports.WIRE_RARITIES = exports.WIRE_ITEM_TYPES = exports.ENTITY_FIELDS = void 0;
exports.packId = packId;
exports.unpackId = unpackId;
exports.packFields = packFields;
exports.unpackFields = unpackFields;
exports.wireFieldsSignature = wireFieldsSignature;
/**
 * The unified entity delta layout.
 *
 * There used to be one table per kind (ENEMY_FIELDS, PLAYER_FIELDS) feeding two
 * separate arrays in every frame, plus items on their own one-shot event
 * channel. This is the single table all three share.
 *
 * ORDER IS THE PROTOCOL, and here it is doing two jobs at once:
 *
 *  - Bits 0..6 are the SHARED hot fields — id, position, facing, health — which
 *    every kind sends every tick. A mask that fits in bits 0..6 is <= 127, which
 *    the codec writes as ONE byte, so the steady-state cost per entity is
 *    unchanged from the per-kind tables (their first six entries were already
 *    identical). `K` takes bit 6 and is absent in steady state.
 *  - Everything after bit 6 is kind-specific and rare: mob type/tier, the
 *    player's two dozen render/status fields, the item's drop description. A
 *    kind never pays mask bits for another kind's fields, because absent fields
 *    cost nothing but a zero bit.
 */
exports.ENTITY_FIELDS = [
    // -- shared hot path, bits 0..6 ---------------------------------------
    'i', 'x', 'y', 'a', 'h', 'H', 'K',
    // -- mob ---------------------------------------------------------------
    't', 'T', 'o',
    // -- player ------------------------------------------------------------
    'e', 'f', 'm', 'q', 'r', 'n', 'k', 'l', 's',
    'v', 'M', 'V', 'z', 'c', 'p', 'sm', 'u', 'vx', 'vy',
    // -- item --------------------------------------------------------------
    'I', 'R', 'P',
];
/**
 * Item kind and rarity, as small ints on the wire.
 *
 * These are CLOSED sets defined here, so both sides share the order and it is
 * folded into the handshake signature like every other layout in this file.
 * The petal TYPE is not here and travels as a string: petal type ids come from
 * a runtime interner whose numbering the client has no way to reproduce — the
 * same reason the mob encoder converts interned type/tier back to strings at
 * the wire boundary.
 */
exports.WIRE_ITEM_TYPES = ['petal', 'health_potion', 'speed_boost', 'shield'];
exports.WIRE_RARITIES = [
    'common', 'uncommon', 'rare', 'epic', 'legendary',
    'mythic', 'ultra', 'super', 'unique', 'apex',
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
    for (const list of [exports.ENTITY_FIELDS, exports.PETAL_FIELDS, exports.WIRE_ITEM_TYPES, exports.WIRE_RARITIES]) {
        for (const n of list) {
            for (let i = 0; i < n.length; i++)
                h = Math.imul(h ^ n.charCodeAt(i), 16777619);
            h = Math.imul(h ^ 44, 16777619);
        }
        h = Math.imul(h ^ 59, 16777619);
    }
    return (h >>> 0).toString(36);
}
