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

import { Enemy } from '../enemy';

/**
 * The clock the death animation is stamped and compared against.
 *
 * `Date.now()`, matching `Graphics.frameTimestamp`. NOT `performance.now()`,
 * which is what snapshot timestamps use — the two are ~1.7e12 ms apart and
 * mixing them means animations that never start or entities that are never
 * reaped. See the header of ecs/client/ingest.ts.
 */
export function worldNow(): number {
    return Date.now();
}

export function applyEnemyUpdate(game: any, enemy: Enemy, snapTimeMs?: number) {
    game.clientWorld.ingestEnemy(enemy, worldNow(), snapTimeMs ?? performance.now());
}

export function forgetEnemy(game: any, enemyId: string) {
    game.clientWorld.forgetEnemy(enemyId, worldNow());
}
