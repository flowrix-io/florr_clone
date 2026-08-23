"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.enemySpawnPayload = enemySpawnPayload;
exports.emitEnemySpawned = emitEnemySpawned;
const mobFields_1 = require("./mobFields");
const wireOutbox_1 = require("./wireOutbox");
const entityRegistry_1 = require("./entityRegistry");
/** Project a mob shell down to exactly what the client's ingest reads. */
function enemySpawnPayload(e) {
    const wire = {
        id: e.id,
        x: (0, mobFields_1.mobX)(e.entity),
        y: (0, mobFields_1.mobY)(e.entity),
        angle: (0, mobFields_1.mobAngle)(e.entity),
        health: (0, mobFields_1.mobHealth)(e.entity),
        maxHealth: (0, mobFields_1.mobMaxHealth)(e.entity),
        type: e.type,
        tier: e.tier,
    };
    // Optional half of the contract — omitted when absent so the common wild
    // mob does not pay for a pet/boss-only field.
    if (e.ownerId !== undefined)
        wire.ownerId = e.ownerId;
    if ((0, mobFields_1.mobAiType)(e.entity) !== undefined)
        wire.aiType = (0, mobFields_1.mobAiType)(e.entity);
    if ((0, mobFields_1.mobIsChasing)(e.entity))
        wire.isChasing = true;
    if (e.reversed !== undefined)
        wire.reversed = e.reversed;
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
function emitEnemySpawned(enemy) {
    const entity = (0, entityRegistry_1.getEntityWorld)().lookup(enemy.id);
    if (entity === undefined)
        return;
    (0, wireOutbox_1.getWireOutbox)().nearFor(entity, (0, mobFields_1.mobX)(enemy.entity), (0, mobFields_1.mobY)(enemy.entity), 'enemySpawned', enemySpawnPayload(enemy));
}
