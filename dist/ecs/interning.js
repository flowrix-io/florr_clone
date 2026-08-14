"use strict";
/**
 * String interning for component storage.
 *
 * Components store identity-ish strings — mob type, petal type — as small
 * integers so they live in typed arrays alongside the numeric fields instead of
 * forcing a `str` column (a plain JS array of pointers) into otherwise tight
 * hot loops. `enemy.type === 'bee'` becomes an integer compare, and the mob
 * type column stops being a source of cache misses in the collision and AI
 * passes that touch every mob every tick.
 *
 * ---------------------------------------------------------------------------
 * Interned ids are PROCESS-LOCAL. Never persist or transmit them.
 * ---------------------------------------------------------------------------
 * Ids are assigned in first-seen order, so two servers — or the same server
 * after a code change that reorders a config — will disagree. Anything crossing
 * a process boundary (the binary wire codec, the inventory database,
 * cross-server transfers) must convert back to the string, or use a numbering
 * that is itself canonical.
 *
 * RARITY is the deliberate exception and does NOT use this class: it has a
 * fixed, already-canonical order in `RARITY_LEVELS` that the wire format and
 * database both depend on, so rarity is stored as that index directly. See
 * `rarityToId`/`idToRarity` below.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RARITY_COUNT = exports.petalTypes = exports.mobTypes = exports.StringInterner = void 0;
exports.rarityToId = rarityToId;
exports.idToRarity = idToRarity;
const petals_1 = require("../petals");
class StringInterner {
    constructor(label, seed = []) {
        this.label = label;
        this.toId = new Map();
        this.toName = [];
        for (const s of seed)
            this.intern(s);
    }
    /** Id for `value`, assigning a new one on first sight. */
    intern(value) {
        const existing = this.toId.get(value);
        if (existing !== undefined)
            return existing;
        const id = this.toName.length;
        this.toName.push(value);
        this.toId.set(value, id);
        return id;
    }
    /** Id for `value`, or -1 if it has never been interned. */
    idOf(value) {
        const id = this.toId.get(value);
        return id === undefined ? -1 : id;
    }
    /**
     * The string behind an id. Throws on an unknown id rather than returning
     * undefined: a bad id means a column holds garbage, and silently yielding
     * `undefined` would surface much later as an unrenderable mob.
     */
    nameOf(id) {
        const name = this.toName[id];
        if (name === undefined) {
            throw new Error(`${this.label}: no interned string for id ${id}`);
        }
        return name;
    }
    /** Number of distinct strings interned so far. */
    get size() {
        return this.toName.length;
    }
    /** Every interned string, indexed by id. Diagnostics and debug dumps. */
    entries() {
        return this.toName;
    }
}
exports.StringInterner = StringInterner;
/**
 * Mob type names (`'bee'`, `'centipede_body'`, ...).
 *
 * Left unseeded: mob_configs.ts is the authoritative key set and importing it
 * here would drag the whole config graph into every module that just wants to
 * read a component. Types are interned as mobs are created instead.
 */
exports.mobTypes = new StringInterner('mobType');
/** Petal type names (`'basic'`, `'rose'`, ...), interned on first use. */
exports.petalTypes = new StringInterner('petalType');
/**
 * Rarity as its canonical index in RARITY_LEVELS.
 *
 * Unlike the interners above this numbering IS stable and shared with the wire
 * codec and the database, so it is safe to persist.
 */
function rarityToId(rarity) {
    return petals_1.RARITY_LEVELS.indexOf(rarity);
}
/** Inverse of `rarityToId`. Returns undefined for an out-of-range id. */
function idToRarity(id) {
    return petals_1.RARITY_LEVELS[id];
}
/** Number of rarity tiers, for sizing per-rarity tables. */
exports.RARITY_COUNT = petals_1.RARITY_LEVELS.length;
