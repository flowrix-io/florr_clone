"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextEntityId = nextEntityId;
/**
 * The one source of entity ids — sockets/players AND mobs.
 *
 * It has to be ONE sequence, not one per kind: players and mobs are both looked
 * up through `world.lookup(id)` against the same ECS World (see ecsSync.ts), so
 * ids share a single namespace. Two independent counters would hand player "5"
 * and mob "5" the same key and silently cross-wire two entities.
 *
 * Ids are integer-valued. Socket ids used to be
 * `randomUUID().replace(/-/g,'').slice(0,20)` — 20 characters, and since the id
 * is the `i` field of every entity delta, a byte-attribution probe put entity
 * ids at 17.6% of every frame. An integer costs 1 byte up to 127 and 3 up to
 * 32767, against 21 for the old form.
 *
 * The VALUE is an integer but the TYPE stays a string, deliberately. Ids are
 * built on textually all over the codebase — split halves are `${id}_split2`,
 * bots are detected by a `bot_` prefix, and 38 call sites do startsWith /
 * includes / replace on them. Making the internal type numeric would mean
 * rewriting the split-half identity rules, which several dupe-glitch invariants
 * depend on. So the string stays, and the conversion to a real integer happens
 * at the wire boundary only (packId/unpackId in wire_fields.ts), where it is
 * lossless: `String(Number("123")) === "123"` for canonical digit strings, and
 * non-numeric ids like `bot_x` or `7_split2` simply travel as strings.
 *
 * Ids are never persisted, so restarting the counter at 1 is safe.
 *
 * NOTE: these ids are sequential and therefore guessable, where the old UUIDs
 * were not. That is only safe while no handler authorises an action from a
 * CLIENT-SUPPLIED entity id — authority must come from the socket the message
 * arrived on. Keep it that way.
 */
let _nextEntityId = 1;
function nextEntityId() {
    return String(_nextEntityId++);
}
