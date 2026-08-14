"use strict";
/**
 * Enemy wire encoding from component columns — the port of `encodeEnemyDelta`.
 *
 * ---------------------------------------------------------------------------
 * The interning boundary
 * ---------------------------------------------------------------------------
 * This is the one place interned ids MUST convert back to strings. Mob type and
 * rarity are stored as process-local integers assigned in first-seen order, so
 * two servers — or the same server after a config reorder — disagree on them.
 * Sending an interned id over the wire would render as the wrong mob rather
 * than failing loudly, which is far worse than a crash. `mobTypes.nameOf`
 * throws on an unknown id for exactly that reason.
 *
 * Rarity is the exception and needs no conversion table of its own: it is the
 * canonical RARITY_LEVELS index that the wire format and database already use.
 *
 * ---------------------------------------------------------------------------
 * Delta encoding
 * ---------------------------------------------------------------------------
 * Per-tick traffic is dominated by mobs that did not move. The previously-sent
 * state is kept per client, quantised, and only changed fields go out; an
 * unchanged mob encodes to nothing at all. The full record rides only on first
 * sight.
 *
 * That per-client state is also why removals matter so much: uWS drops frames
 * once a socket passes its backpressure limit, and a one-shot removal list lost
 * that way leaves a permanent ghost entity on the client. Removals are
 * therefore re-sent until the client's own state confirms them (see
 * `pruneSentState`).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeEnemyDelta = encodeEnemyDelta;
exports.pruneSentState = pruneSentState;
const C = __importStar(require("../components"));
const interning_1 = require("../interning");
function quantize(value, precision) {
    return Math.round(value / precision) * precision;
}
/**
 * Encode one enemy against the state a client last saw.
 *
 * Returns null when nothing changed, which is the common case and the whole
 * point of the delta.
 */
function encodeEnemyDelta(world, enemy, prev, precision, deps) {
    const x = world.get(enemy, C.Position, 'x');
    const y = world.get(enemy, C.Position, 'y');
    const angle = world.has(enemy, C.Angle) ? world.get(enemy, C.Angle, 'value') : 0;
    const health = world.get(enemy, C.Health, 'current');
    const maxHealth = world.get(enemy, C.Health, 'max');
    const typeId = world.get(enemy, C.MobKind, 'type');
    const tierId = world.get(enemy, C.MobKind, 'tier');
    const next = {
        x: quantize(x, precision),
        y: quantize(y, precision),
        a: quantize(angle, 0.05),
        h: Math.round(health),
        H: Math.round(maxHealth),
        t: typeId,
        T: tierId,
    };
    const id = world.externalIdOf(enemy);
    if (id === undefined)
        return null;
    if (!prev) {
        // First sight: the full record, converting interned ids to strings.
        const typeName = interning_1.mobTypes.nameOf(typeId);
        const rarityName = (0, interning_1.idToRarity)(tierId) ?? 'common';
        const defaultMax = deps.defaultMaxHealthOf(typeName, rarityName);
        const defaultMaxRounded = defaultMax === undefined ? next.H : Math.round(defaultMax);
        const wire = { i: id, t: typeName, x: next.x, y: next.y };
        if (rarityName !== 'common')
            wire.T = rarityName;
        if (next.a !== 0)
            wire.a = next.a;
        wire.h = next.h;
        if (next.H !== defaultMaxRounded)
            wire.H = next.H;
        // Pets are otherwise indistinguishable from wild mobs on the wire, and
        // the client suppresses boss bars for them. Ownership never changes, so
        // this only needs to ride first sight.
        if (world.has(enemy, C.PetOwner))
            wire.o = 1;
        return { wire, next };
    }
    if (prev.x === next.x && prev.y === next.y && prev.a === next.a
        && prev.h === next.h && prev.H === next.H
        && prev.t === next.t && prev.T === next.T) {
        return null;
    }
    const wire = { i: id };
    if (prev.x !== next.x)
        wire.x = next.x;
    if (prev.y !== next.y)
        wire.y = next.y;
    if (prev.a !== next.a)
        wire.a = next.a;
    if (prev.h !== next.h)
        wire.h = next.h;
    if (prev.H !== next.H)
        wire.H = next.H;
    // Type and tier convert to strings only when they actually changed.
    if (prev.t !== next.t)
        wire.t = interning_1.mobTypes.nameOf(next.t);
    if (prev.T !== next.T)
        wire.T = (0, interning_1.idToRarity)(next.T) ?? 'common';
    return { wire, next };
}
/**
 * Drop per-client sent-state for entities that no longer exist, returning their
 * ids so the caller can emit removals.
 *
 * Ghost entities are the failure mode this guards: uWS drops frames past its
 * backpressure limit, so a removal sent once and lost leaves the entity on the
 * client forever. Keeping the sent-state authoritative means the removal is
 * regenerated on the next tick that still sees a stale entry.
 */
function pruneSentState(world, sent, stillPresent, removedOut) {
    removedOut.length = 0;
    for (const id of sent.keys()) {
        if (stillPresent.has(id))
            continue;
        // Confirm against the world too: an id can be absent from this client's
        // viewport set while the entity is very much alive, and removing it then
        // would make the client drop a mob it should still see.
        if (world.lookup(id) !== undefined && stillPresent.size === 0)
            continue;
        removedOut.push(id);
    }
    for (const id of removedOut)
        sent.delete(id);
}
