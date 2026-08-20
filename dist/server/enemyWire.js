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
/** Project a mob shell down to exactly what the client's ingest reads. */
function enemySpawnPayload(e) {
    const wire = {
        id: e.id,
        x: e.x,
        y: e.y,
        angle: e.angle,
        health: e.health,
        maxHealth: e.maxHealth,
        type: e.type,
        tier: e.tier,
    };
    // Optional half of the contract — omitted when absent so the common wild
    // mob does not pay for a pet/boss-only field.
    if (e.ownerId !== undefined)
        wire.ownerId = e.ownerId;
    if (e.aiType !== undefined)
        wire.aiType = e.aiType;
    if (e.isChasing !== undefined)
        wire.isChasing = e.isChasing;
    if (e.reversed !== undefined)
        wire.reversed = e.reversed;
    return wire;
}
