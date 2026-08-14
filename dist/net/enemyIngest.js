"use strict";
/**
 * Ingestion of enemy state from the server, shared by the bulk-update handlers
 * in handlers/world.ts and the per-tick delta decoder in handlers/gameState.ts.
 *
 * Both paths must treat a mid-death-animation enemy identically — updating or
 * deleting one out from under the animation makes mobs blink out instead of
 * playing their death pop — so the logic lives in one place: the client world
 * (src/client_world.ts), which this file is a thin binding over.
 *
 * The `Enemy` record handed in is transient. Nothing retains it; the world
 * copies what it needs into components and drops it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.worldNow = worldNow;
exports.applyEnemyUpdate = applyEnemyUpdate;
exports.forgetEnemy = forgetEnemy;
/**
 * The clock the death animation is stamped and compared against.
 *
 * `Date.now()`, matching `Graphics.frameTimestamp`. NOT `performance.now()`,
 * which is what snapshot timestamps use — the two are ~1.7e12 ms apart and
 * mixing them means animations that never start or entities that are never
 * reaped. See the header of ecs/client/ingest.ts.
 */
function worldNow() {
    return Date.now();
}
function applyEnemyUpdate(game, enemy, snapTimeMs) {
    game.clientWorld.ingestEnemy(enemy, worldNow(), snapTimeMs ?? performance.now());
}
function forgetEnemy(game, enemyId) {
    game.clientWorld.forgetEnemy(enemyId, worldNow());
}
