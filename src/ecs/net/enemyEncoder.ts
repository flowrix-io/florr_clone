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

import * as C from '../components';
import { Entity } from '../entity';
import { idToRarity, mobTypes } from '../interning';
import { World } from '../world';

/** The quantised state last sent to a client for one enemy. */
export interface SentEnemyState {
    /** Wire kind tag; owned by the broadcast, carried here so one map holds all kinds. */
    K?: number;
    x: number;
    y: number;
    a: number;
    h: number;
    H: number;
    /** Interned type id — compared numerically, converted only on the wire. */
    t: number;
    /** Rarity index. */
    T: number;
}

/** The delta payload for one enemy. Field names match the existing protocol. */
export interface EnemyWire {
    /** Set by the broadcast on an entity's first appearance. */
    K?: number;
    i: string;
    t?: string;
    T?: string;
    x?: number;
    y?: number;
    a?: number;
    h?: number;
    H?: number;
    /** Pet marker; rides only the first-sight record. */
    o?: 1;
}

function quantize(value: number, precision: number): number {
    return Math.round(value / precision) * precision;
}

export interface EnemyEncoderDeps {
    /**
     * Default max health for a (type, rarity), so the common case can omit `H`.
     * Injected because it reads mob config.
     */
    defaultMaxHealthOf(typeName: string, rarityName: string): number | undefined;
}

/**
 * Encode one enemy against the state a client last saw.
 *
 * Returns null when nothing changed, which is the common case and the whole
 * point of the delta.
 */
export function encodeEnemyDelta(
    world: World,
    enemy: Entity,
    prev: SentEnemyState | undefined,
    precision: number,
    deps: EnemyEncoderDeps,
): { wire: EnemyWire; next: SentEnemyState } | null {
    const x = world.get(enemy, C.Position, 'x') as number;
    const y = world.get(enemy, C.Position, 'y') as number;
    const angle = world.has(enemy, C.Angle) ? (world.get(enemy, C.Angle, 'value') as number) : 0;
    const health = world.get(enemy, C.Health, 'current') as number;
    const maxHealth = world.get(enemy, C.Health, 'max') as number;
    const typeId = world.get(enemy, C.MobKind, 'type') as number;
    const tierId = world.get(enemy, C.MobKind, 'tier') as number;

    const next: SentEnemyState = {
        x: quantize(x, precision),
        y: quantize(y, precision),
        a: quantize(angle, 0.05),
        h: Math.round(health),
        H: Math.round(maxHealth),
        t: typeId,
        T: tierId,
    };

    const id = world.externalIdOf(enemy);
    if (id === undefined) return null;

    if (!prev) {
        // First sight: the full record, converting interned ids to strings.
        const typeName = mobTypes.nameOf(typeId);
        const rarityName = idToRarity(tierId) ?? 'common';
        const defaultMax = deps.defaultMaxHealthOf(typeName, rarityName);
        const defaultMaxRounded = defaultMax === undefined ? next.H : Math.round(defaultMax);

        const wire: EnemyWire = { i: id, t: typeName, x: next.x, y: next.y };
        if (rarityName !== 'common') wire.T = rarityName;
        if (next.a !== 0) wire.a = next.a;
        wire.h = next.h;
        if (next.H !== defaultMaxRounded) wire.H = next.H;
        // Pets are otherwise indistinguishable from wild mobs on the wire, and
        // the client suppresses boss bars for them. Ownership never changes, so
        // this only needs to ride first sight.
        if (world.has(enemy, C.PetOwner)) wire.o = 1;
        return { wire, next };
    }

    if (prev.x === next.x && prev.y === next.y && prev.a === next.a
        && prev.h === next.h && prev.H === next.H
        && prev.t === next.t && prev.T === next.T) {
        return null;
    }

    const wire: EnemyWire = { i: id };
    if (prev.x !== next.x) wire.x = next.x;
    if (prev.y !== next.y) wire.y = next.y;
    if (prev.a !== next.a) wire.a = next.a;
    if (prev.h !== next.h) wire.h = next.h;
    if (prev.H !== next.H) wire.H = next.H;
    // Type and tier convert to strings only when they actually changed.
    if (prev.t !== next.t) wire.t = mobTypes.nameOf(next.t);
    if (prev.T !== next.T) wire.T = idToRarity(next.T) ?? 'common';
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
export function pruneSentState(
    world: World,
    sent: Map<string, SentEnemyState>,
    stillPresent: Set<string>,
    removedOut: string[],
): void {
    removedOut.length = 0;
    for (const id of sent.keys()) {
        if (stillPresent.has(id)) continue;
        // Confirm against the world too: an id can be absent from this client's
        // viewport set while the entity is very much alive, and removing it then
        // would make the client drop a mob it should still see.
        if (world.lookup(id) !== undefined && stillPresent.size === 0) continue;
        removedOut.push(id);
    }
    for (const id of removedOut) sent.delete(id);
}
