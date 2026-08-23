/**
 * The admission point for wild mobs.
 *
 * ---------------------------------------------------------------------------
 * Who owns a mob
 * ---------------------------------------------------------------------------
 * A mob is ONE thing with TWO representations, and both are load-bearing:
 *
 *   the ECS entity   is what the simulation moves, aims, collides and shoots.
 *   the legacy shell (`Enemy` in `enemies[]`) is what the broadcast encodes and
 *                    what the reaper walks to award XP and drops. Broadcast and
 *                    persistence stay legacy, so the shell is not optional.
 *
 * Either one alone is a bug that fails SILENTLY:
 *   entity with no shell  -> invisible to every client, never reaped, immortal.
 *   shell with no entity  -> never simulated; a statue that still deals contact
 *                            damage and still shows up on the wire.
 *
 * So creation is made atomic and structural rather than conventional:
 * `spawnEnemy` is the ONLY producer of `LiveEnemy`, and it produces the shell
 * and the entity together. There is no ordering in which one exists without the
 * other, because the shell is not stored anywhere — it is reached THROUGH the
 * entity, via C.LegacyShell, and projected back out by `liveEnemies()`.
 *
 * ---------------------------------------------------------------------------
 * The other half
 * ---------------------------------------------------------------------------
 * DESTRUCTION is now symmetric with creation: `removeEnemy` is the only way a
 * mob leaves, and it retires the entity — which IS the mob, so there is no
 * second representation left to forget to update.
 *
 * This replaced a per-tick RECONCILE (`reconcileEnemyEntities` in ecsSync.ts),
 * and then the audit that replaced THAT. Both existed to find disagreement
 * between two hand-maintained representations; there is now one representation,
 * so there is no disagreement to find.
 *
 * Entity destruction is DEFERRED, not done inline — the reason, the queue and
 * the drain are all generic and now live in server/entityRegistry.ts, which
 * every kind shares. The shell leaves `enemies[]` immediately (legacy semantics
 * are unchanged, since that is the array every legacy consumer reads) while the
 * entity is retired at one safe point in the tick, exactly where the reconcile
 * used to run.
 *
 * What is left in THIS file is the only genuinely mob-specific part: turning a
 * (type, tier) mob-config lookup into a shell and an entity that agree.
 */

import { Enemy, LiveEnemy, makeEnemy } from '../server_utils';

import { nextEntityId } from '../entity_ids';
import { getMobStats } from '../mobs';
import { Entity, NULL_ENTITY, Query, World } from '../ecs';
import * as C from '../ecs/components';
import { spawnMob } from '../ecs/prefabs';
import { aiTypeOf, attachMobBehaviour, linkEnemyReferences, radiusOf } from './ecsBridge';
import {
    requireEntityHost,
    getEntityWorld,
    retire,
    isPendingRetirement,
    drainRetired,
    entityRetirementVersion,
    cachedQuery,
} from './entityRegistry';

/**
 * Whether this mob's shell has been removed and its entity awaits the drain.
 *
 * Kept as a named re-export because "pending removal" reads better at the
 * broadcast's call site than the generic name, and because every caller that
 * asks about a MOB should keep working if the mob lifecycle ever diverges.
 */
export const isPendingEntityRemoval = isPendingRetirement;

/**
 * Retire the entities of everything removed since the last drain.
 *
 * Generic now: mobs, drops and anything else that was retired this tick go
 * together, from the same safe point in the tick.
 */
export const drainRemovedEnemies = drainRetired;

// ---------------------------------------------------------------------------
// The mob view
// ---------------------------------------------------------------------------

/**
 * Every live mob's shell, PROJECTED OUT OF THE WORLD.
 *
 * `enemies[]` used to be a container in its own right: a second place a mob
 * could exist, maintained by hand alongside the ECS and kept honest by an audit
 * that periodically compared the two and repaired the difference. It is now a
 * derived view — rebuilt from the mob query, never appended to, never spliced —
 * so the two representations cannot disagree. A mob exists exactly when its
 * entity does. That is the whole point of the change, and it is what let
 * `maintainEnemyEntities`'s orphan-adoption path and the audit's repair half
 * stop being load-bearing.
 *
 * REBUILD POLICY. Rebuilding on every read would cost ~1400 pointer copies per
 * call at prod population, against ~55 read sites per tick — far too much. So
 * the view is cached and invalidated by two counters: `World.version()` (any
 * create/destroy, which covers entities destroyed directly by ECS systems as
 * well as ones removed through this file) and the retirement counter (a mob
 * removed this tick is gone from the game IMMEDIATELY even though its entity
 * survives until the end-of-tick drain — that is the legacy semantic every
 * caller expects, and dropping it would let a killed mob be killed twice).
 *
 * ORDER is archetype order, not creation order. Nothing depends on mob order:
 * `syncToEcs` is world-driven, `syncFromEcs` ignores the array entirely, the
 * grid rebuild is a bucket sort, and the two spawn sites that DID care were
 * changed to take the children their spawner returns instead of slicing a
 * range off the end of the array.
 */
const mobShellSlot: { query?: Query; world?: World } = {};
const mobProjection: LiveEnemy[] = [];
let projectedWorld: World | undefined;
let projectedWorldVersion = -1;
let projectedRetirementVersion = -1;

export function liveEnemies(): readonly LiveEnemy[] {
    const world = getEntityWorld();
    const worldVersion = world.version();
    const retirementVersion = entityRetirementVersion();
    // The world identity is part of the key, not just its version: the benches
    // and self-tests build throwaway worlds in the same process, and a fresh
    // world's counter can coincide with the cached one — which would hand back
    // the PREVIOUS world's mobs.
    if (world === projectedWorld
        && worldVersion === projectedWorldVersion
        && retirementVersion === projectedRetirementVersion) {
        return mobProjection;
    }

    mobProjection.length = 0;
    cachedQuery(mobShellSlot, world, [C.IsEnemy, C.LegacyShell]).chunks(chunk => {
        const shells = chunk.cols(C.LegacyShell).ref as LiveEnemy[];
        const entities = chunk.entities;
        for (let i = 0; i < chunk.count; i++) {
            // Removed this tick: gone from the game now, entity retired later.
            if (isPendingRetirement(entities[i] as Entity)) continue;
            const shell = shells[i];
            if (shell !== undefined && shell !== null) mobProjection.push(shell);
        }
    });

    projectedWorld = world;
    projectedWorldVersion = worldVersion;
    projectedRetirementVersion = retirementVersion;
    return mobProjection;
}

/** Number of live mobs. */
export function liveEnemyCount(): number {
    return liveEnemies().length;
}

/**
 * Is this mob still in the game?
 *
 * Replaces `enemies.indexOf(enemy) >= 0`, which was both O(mobs) and a question
 * about a container that no longer exists. Asks the world instead: a mob is
 * live exactly while its entity is, minus the ones retired earlier this tick.
 */
export function isEnemyLive(enemy: Enemy): boolean {
    const entity = getEntityWorld().lookup(enemy.id);
    return entity !== undefined && !isPendingRetirement(entity);
}

/**
 * Copy every live mob's shell into `out` (cleared first), for loops that REMOVE.
 *
 * `liveEnemies()` hands back the shared projection, which is rebuilt IN PLACE
 * the moment anything is retired — so killing while iterating it would shift
 * rows out from under the loop. The item registry has the same rule for the
 * same reason (see collectWorldItems): iterating a copy is the point.
 *
 * Callers own their buffer so two passes can never scribble over each other.
 */
export function collectEnemies(out: LiveEnemy[]): LiveEnemy[] {
    out.length = 0;
    const view = liveEnemies();
    for (let i = 0; i < view.length; i++) out.push(view[i]);
    return out;
}

export interface SpawnEnemyOptions {
    /** Facing. Defaults to random, as every spawner did. */
    angle?: number;
    /** Overrides the mob config's flip flag. */
    reversed?: boolean;
    range?: number;
    aiType?: 'passive' | 'neutral' | 'hostile' | 'sandstorm';

    // --- stat overrides -------------------------------------------------
    // Pets are nerfed relative to their wild stat line. These are options
    // rather than post-spawn mutation on purpose: `damage` is written to the
    // ECS ONCE, at spawn, and syncToEcs never pushes it again — so a pet
    // patched after admission would deal wild damage in ECS-owned pet melee
    // forever while the legacy object showed the nerfed number.
    health?: number;
    maxHealth?: number;
    damage?: number;

    // --- relationships (the referenced mob/player must already exist) ----
    ownerId?: string;
    petImage?: string;
    parentHoleId?: string;
    leaderId?: string;
    headId?: string;
    segmentIndex?: number;
    challengeOwnerId?: string;
    challengeStarsReward?: number;
    /** Inherited by escorts from their summoner. */
    targetPlayerId?: string;
    /** Self-despawn timestamp (periodic-spawn escorts). */
    despawnAt?: number;

    /**
     * Historical boss wire shape: leaves `reversed` and `lastViewportCheck`
     * undefined so they stay OFF the enemySpawned payload.
     *
     * Ultra/super/unique spawns have always omitted both (see the note in
     * makeEnemy: undefined fields are dropped by JSON.stringify, so a concrete
     * default would add keys to every boss packet).
     */
    bossWireShape?: boolean;
}

/**
 * Create a mob. Returns null when the (type, tier) pair has no stats.
 *
 * Order matters: the shell is built as a plain value, the entity is created and
 * linked, and ADMISSION to `enemies[]` is the last thing that happens. So there
 * is no window in which the array holds a mob the simulation cannot see, and an
 * early return leaves nothing behind in either representation.
 *
 * This replaces the old `buildEnemy` + `enemies.push(...)` pair at every spawn
 * site. Both representations are derived from the SAME resolved locals below,
 * so they cannot disagree about health, damage, facing or radius.
 */
export function spawnEnemy(
    type: string,
    tier: Enemy['tier'],
    x: number,
    y: number,
    opts?: SpawnEnemyOptions,
): LiveEnemy | null {
    const stats = getMobStats(type, tier);
    if (!stats) return null;

    const activeHost = requireEntityHost();
    const world = activeHost.getWorld();
    const now = Date.now();

    const id = nextEntityId();
    const angle = opts?.angle ?? Math.random() * Math.PI * 2;
    const maxHealth = opts?.maxHealth ?? stats.health;
    const health = opts?.health ?? maxHealth;
    const damage = opts?.damage ?? stats.damage;
    const speed = stats.speed;
    const aiType = opts?.aiType ?? stats.ai_type;
    const range = opts?.range ?? stats.range;

    // The legacy shell. Still built through makeEnemy so every enemy in the
    // process keeps the one hidden class that file exists to guarantee.
    const enemy = makeEnemy({
        id,
        type: type as Enemy['type'],
        tier,
        parentHoleId: opts?.parentHoleId,
        ownerId: opts?.ownerId,
        petImage: opts?.petImage,
        leaderId: opts?.leaderId,
        headId: opts?.headId,
        segmentIndex: opts?.segmentIndex,
        challengeOwnerId: opts?.challengeOwnerId,
        challengeStarsReward: opts?.challengeStarsReward,
    }) as LiveEnemy;

    // The entity, from the same locals. `spawnMob` is the archetype every mob
    // shares; `attachMobBehaviour` adds the per-type extras (drift, bee wobble,
    // render flip, expiry); `linkEnemyReferences` resolves owner / hole / chain,
    // all of which already exist because a parent is always admitted first.
    const entity = spawnMob(world, {
        id,
        type,
        tier,
        x,
        y,
        angle,
        health,
        maxHealth,
        speed,
        damage,
        radius: radiusOf(enemy, stats),
        aiType: aiTypeOf(aiType),
        range,
        stats,
        now,
    });
    // The identity link, so every accessor in mobFields.ts can reach the
    // components from a shell without an id lookup.
    enemy.entity = entity;

    attachMobBehaviour(world, entity, enemy, now, stats);
    linkEnemyReferences(world, enemy, activeHost.resolvePlayer);

    // No array push: the entity IS the admission. `liveEnemies()` projects the
    // shell back out of the world on the next read.
    return enemy;
}

/**
 * Remove a mob — the destruction counterpart to `spawnEnemy`.
 *
 * By identity, because there is no container to hold an index into any more.
 * Retires the entity, which is what makes the mob stop existing: the next read
 * of `liveEnemies()` no longer projects it. Callers keep doing their own
 * `cleanupEnemy` and `enemyDestroyed` emit — those differ per site (the melee
 * sweep does not emit, the bulk clear emits once per mob and refreshes counters
 * afterwards) and folding them in here would need a flag per caller, which is
 * exactly the shape killHandler already regrets.
 *
 * Returns false when the mob has already left.
 */
export function removeEnemy(enemy: Enemy): boolean {
    const entity = getEntityWorld().lookup(enemy.id);
    if (entity === undefined || isPendingRetirement(entity)) return false;
    retire(entity);
    return true;
}

/**
 * Promote an already-admitted mob to the head of a centipede chain.
 *
 * Split out because the chain is laid down by `spawnCentipedeBodySegments`
 * AFTER the head exists, and the head's own CentipedeSegment (index 0, leader
 * none, head self) has to reach the entity too — the legacy fields alone are
 * read by nobody now that the chain passes are ECS-owned.
 */
export function markCentipedeHead(head: LiveEnemy): void {
    head.headId = head.id;
    head.segmentIndex = 0;

    const world = getEntityWorld();
    const entity = world.lookup(head.id);
    if (entity === undefined) return;
    world.add(entity, C.CentipedeSegment, {
        leader: NULL_ENTITY,
        head: entity,
        segmentIndex: 0,
    });
}
