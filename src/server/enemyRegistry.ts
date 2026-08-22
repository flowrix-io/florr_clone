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
 * `spawnEnemy` is the ONLY producer of `LiveEnemy`, `enemies` is a
 * `LiveEnemy[]`, and the entity is created BEFORE the array push. There is no
 * ordering in which one exists without the other, and `enemies.push(someEnemy)`
 * elsewhere does not compile.
 *
 * ---------------------------------------------------------------------------
 * The other half
 * ---------------------------------------------------------------------------
 * DESTRUCTION is now symmetric with creation: `removeEnemy`/`removeEnemyAt` are
 * the only ways a mob leaves, and they splice the shell and retire the entity
 * as one operation. Every former `enemies.splice(i, 1)` site calls one of them.
 *
 * This replaced a per-tick RECONCILE (`reconcileEnemyEntities` in ecsSync.ts),
 * which rebuilt a set of every live shell and swept every mob entity looking
 * for ones whose shell had gone. That was O(all mobs) every tick to discover
 * the ~0-5 removals a tick actually has, and it was the last thing keeping the
 * two representations related by SEARCH rather than by construction.
 *
 * The reconcile's real virtue was that no splice site had to remember anything,
 * and a convention gives that up — so `auditEnemyEntities` still runs, rarely,
 * and says so loudly if the two sides ever disagree. See it for what to do
 * about a report.
 *
 * Entity destruction is DEFERRED to `drainRemovedEnemies`, not done inline.
 * Kills arrive from inside loops that are mid-iteration over pooled entity
 * handles (the projectile sweep, the mob-collision entries list), and pulling
 * an entity's row out from under them is how a swap-remove corrupts an
 * iteration. The shell leaves `enemies[]` immediately — legacy semantics are
 * unchanged, since that is the array every legacy consumer reads — while the
 * entity is retired at one safe point in the tick, exactly where the reconcile
 * used to run.
 */

import { Enemy, LiveEnemy, makeEnemy } from '../server_utils';
import { enemies } from '../constants';
import { nextEntityId } from '../entity_ids';
import { getMobStats } from '../mobs';
import { Entity, NULL_ENTITY, Query, World } from '../ecs';
import * as C from '../ecs/components';
import { spawnMob } from '../ecs/prefabs';
import { aiTypeOf, attachMobBehaviour, linkEnemyReferences, radiusOf } from './ecsBridge';

/**
 * What the registry needs from the composition root.
 *
 * Injected rather than imported: the world lives on the EcsRuntime, which
 * server.ts builds lazily with hooks (drops, XP, the socket server) that only
 * server.ts has — and importing server.ts from here would boot a listening
 * server at module scope. `getWorld` is a thunk for the same reason: it must be
 * legal to install the host before the runtime is constructed.
 */
export interface EnemySpawnHost {
    getWorld(): World;
    /**
     * The entity for a player socket id, importing them if this is their first
     * tick. Pets spawn from petal actions, which run BEFORE the tick's
     * syncToEcs, so a bare `world.lookup` would hand the pet a null owner on the
     * one tick that matters.
     */
    resolvePlayer(socketId: string): Entity | undefined;
}

let host: EnemySpawnHost | undefined;

/** Install the ECS host. Called once, from the composition root. */
export function bindEnemySpawnHost(installed: EnemySpawnHost): void {
    host = installed;
}

function requireHost(): EnemySpawnHost {
    if (!host) {
        throw new Error(
            'enemyRegistry: no ECS host installed. server.ts must call '
            + 'bindEnemySpawnHost() at startup — without it a spawn would produce '
            + 'a legacy shell with no entity, which nothing would ever simulate.',
        );
    }
    return host;
}

export interface SpawnEnemyOptions {
    /** Facing. Defaults to random, as every spawner did. */
    angle?: number;
    /** Overrides the mob config's flip flag. */
    reversed?: boolean;
    range?: number;
    aiType?: Enemy['aiType'];

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

    const activeHost = requireHost();
    const world = activeHost.getWorld();
    const now = Date.now();

    const id = nextEntityId();
    const angle = opts?.angle ?? Math.random() * Math.PI * 2;
    const maxHealth = opts?.maxHealth ?? stats.health;
    const health = opts?.health ?? maxHealth;
    const damage = opts?.damage ?? stats.damage;
    const speed = stats.speed;

    // The legacy shell. Still built through makeEnemy so every enemy in the
    // process keeps the one hidden class that file exists to guarantee.
    const enemy = makeEnemy({
        id,
        type: type as Enemy['type'],
        tier,
        x,
        y,
        angle,
        health,
        maxHealth,
        speed,
        damage,
        knockbackX: 0,
        knockbackY: 0,
        aiType: opts?.aiType ?? stats.ai_type,
        range: opts?.range ?? stats.range,
        reversed: opts?.bossWireShape ? undefined : (opts?.reversed ?? stats.reversed ?? false),
        spawnTime: now,
        lastViewportCheck: opts?.bossWireShape ? undefined : now,
        parentHoleId: opts?.parentHoleId,
        ownerId: opts?.ownerId,
        petImage: opts?.petImage,
        leaderId: opts?.leaderId,
        headId: opts?.headId,
        segmentIndex: opts?.segmentIndex,
        challengeOwnerId: opts?.challengeOwnerId,
        challengeStarsReward: opts?.challengeStarsReward,
        targetPlayerId: opts?.targetPlayerId,
        despawnAt: opts?.despawnAt,
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
        aiType: aiTypeOf(enemy),
        range: enemy.range,
        stats,
        now,
    });
    attachMobBehaviour(world, entity, enemy, now, stats);
    linkEnemyReferences(world, enemy, activeHost.resolvePlayer);

    enemies.push(enemy);
    return enemy;
}

/**
 * Entities whose shell has left `enemies[]` and which are waiting to be retired.
 *
 * Reused across ticks; see the header for why destruction is deferred at all.
 */
const pendingEntityRemovals: Entity[] = [];

/**
 * Remove the mob at `index` — the destruction counterpart to `spawnEnemy`.
 *
 * Splices the shell and queues its entity for retirement. Callers keep doing
 * their own `cleanupEnemy` and `enemyDestroyed` emit: those differ per site
 * (the melee sweep does not emit, the bulk clear emits once per mob and
 * refreshes counters afterwards) and folding them in here would need a flag per
 * caller, which is exactly the shape killHandler already regrets.
 *
 * Returns the removed shell, or undefined when the index is out of range.
 */
export function removeEnemyAt(index: number): Enemy | undefined {
    if (index < 0 || index >= enemies.length) return undefined;
    const enemy = enemies[index];
    enemies.splice(index, 1);

    const world = requireHost().getWorld();
    const entity = world.lookup(enemy.id);
    if (entity !== undefined) pendingEntityRemovals.push(entity);
    return enemy;
}

/**
 * Remove a mob by identity, for callers that hold the shell but not its index.
 *
 * Prefer `removeEnemyAt` inside a backwards loop that already has the index —
 * this one pays an `indexOf`. Returns false when the mob has already left.
 */
export function removeEnemy(enemy: Enemy): boolean {
    const index = enemies.indexOf(enemy as LiveEnemy);
    if (index < 0) return false;
    removeEnemyAt(index);
    return true;
}

/**
 * Retire the entities of mobs removed since the last drain.
 *
 * Called once per tick from the same point the reconcile occupied — after the
 * ECS has finished stepping and nothing is iterating a query or a pooled handle
 * list. Destroying is idempotent on a stale handle (`World.destroy` returns
 * false), so a mob removed twice in one tick is harmless.
 */
export function drainRemovedEnemies(world: World): void {
    if (pendingEntityRemovals.length === 0) return;
    for (let i = 0; i < pendingEntityRemovals.length; i++) {
        world.destroy(pendingEntityRemovals[i]);
    }
    pendingEntityRemovals.length = 0;
}

/**
 * Check that every shell has an entity and every mob entity has a live shell.
 *
 * The safety net the reconcile used to provide for free. Removal is a
 * CONVENTION now — a splice that bypasses `removeEnemy` leaves an orphan entity
 * that keeps moving, shooting and taking up grid space while being invisible to
 * every client, which is precisely the silent failure this module exists to
 * prevent. So the invariant is still checked, just at a cadence that costs
 * nothing instead of every tick.
 *
 * Repairs what it finds (an unreferenced entity is destroyed, a shell with no
 * entity is reported for `spawnEnemy`'s adoption path) and returns the number of
 * disagreements. A non-zero return means some site removed a mob without going
 * through here — log it and fix the site; do not treat the repair as the fix.
 */
export function auditEnemyEntities(world: World, query: Query): number {
    liveShells.clear();
    for (let i = 0; i < enemies.length; i++) liveShells.add(enemies[i]);

    let matched = 0;
    orphanScratch.length = 0;
    query.chunks(chunk => {
        const shells = chunk.cols(C.LegacyShell).ref as Enemy[];
        const entities = chunk.entities;
        for (let i = 0; i < chunk.count; i++) {
            if (liveShells.has(shells[i])) matched++;
            else orphanScratch.push(entities[i] as Entity);
        }
    });

    for (let i = 0; i < orphanScratch.length; i++) world.destroy(orphanScratch[i]);
    const orphanEntities = orphanScratch.length;
    orphanScratch.length = 0;

    const missingEntities = liveShells.size - matched;
    const disagreements = orphanEntities + Math.max(0, missingEntities);
    if (disagreements > 0) {
        console.warn(
            `[ECS] mob audit: ${orphanEntities} entity(s) with no shell (destroyed), `
            + `${missingEntities} shell(s) with no entity. Some site removed or added a mob `
            + 'without going through server/enemyRegistry.ts.',
        );
    }
    return disagreements;
}

const liveShells = new Set<Enemy>();
const orphanScratch: Entity[] = [];

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

    const world = requireHost().getWorld();
    const entity = world.lookup(head.id);
    if (entity === undefined) return;
    world.add(entity, C.CentipedeSegment, {
        leader: NULL_ENTITY,
        head: entity,
        segmentIndex: 0,
    });
}
