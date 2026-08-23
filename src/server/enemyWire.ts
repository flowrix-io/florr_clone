/**
 * The `enemySpawned` payload.
 *
 * `io.emit('enemySpawned', enemy)` used to put the WHOLE legacy shell on the
 * wire — all 56 fields, including `_mobStats` (the entire nested stat block),
 * `_radius`, `damageContributors`, and every piece of server-only AI state
 * (wander targets, passive timers, target ids). Prod measured it at 785 bytes
 * per mob, unscoped, one full fan-out per spawn. An admin `spawn <mob> <rarity>
 * 100` at 23 clients was therefore ~1.8 MB emitted in one synchronous burst —
 * a stall on the server encoding it and on every client decoding it.
 *
 * The client needs far less than that: `EnemyUpdate` in ecs/client/ingest.ts is
 * the whole contract, and `enemySpawned` feeds the same ingest path as the
 * delta stream. Everything else was never read.
 *
 * Undefined fields are simply left off — the codec skips absent keys, so a
 * common wild mob costs only what it actually carries.
 */

import { Enemy } from '../server_utils';
import { mobAiType, mobAngle, mobHealth, mobIsChasing, mobMaxHealth, mobX, mobY } from './mobFields';
import { getWireOutbox } from './wireOutbox';
import { getEntityWorld } from './entityRegistry';

export interface EnemySpawnWire {
    id: string;
    x: number;
    y: number;
    angle: number;
    health: number;
    maxHealth: number;
    type: string;
    tier: string;
    ownerId?: string;
    aiType?: string;
    isChasing?: boolean;
    reversed?: boolean;
}

/** Project a mob shell down to exactly what the client's ingest reads. */
export function enemySpawnPayload(e: Enemy): EnemySpawnWire {
    const wire: EnemySpawnWire = {
        id: e.id,
        x: mobX(e.entity),
        y: mobY(e.entity),
        angle: mobAngle(e.entity),
        health: mobHealth(e.entity),
        maxHealth: mobMaxHealth(e.entity),
        type: e.type,
        tier: e.tier,
    };
    // Optional half of the contract — omitted when absent so the common wild
    // mob does not pay for a pet/boss-only field.
    if (e.ownerId !== undefined) wire.ownerId = e.ownerId;
    if (mobAiType(e.entity) !== undefined) wire.aiType = mobAiType(e.entity) as string;
    if (mobIsChasing(e.entity)) wire.isChasing = true;
    if ((e as any).reversed !== undefined) wire.reversed = (e as any).reversed;
    return wire;
}

/**
 * Announce a new mob to everyone who can see it.
 *
 * ENTITY-GATED, and that is the point of routing every spawn through one
 * function. Events are delivered at the end of the tick that produced them, so a
 * mob that spawns and dies within the same tick would otherwise put its
 * `enemySpawned` on the wire after it was already gone. When the removal path
 * also emits `enemyDestroyed` the client recovers, because the outbox preserves
 * production order — but several removal paths deliberately do NOT emit (the
 * melee sweep, bulk despawns), and for those the client is left holding a mob
 * that will never move, never die and never be mentioned again. The gate makes
 * that unrepresentable rather than a rule each caller has to remember.
 */
export function emitEnemySpawned(enemy: Enemy): void {
    const entity = getEntityWorld().lookup(enemy.id);
    if (entity === undefined) return;
    getWireOutbox().nearFor(entity, mobX(enemy.entity), mobY(enemy.entity), 'enemySpawned', enemySpawnPayload(enemy));
}
