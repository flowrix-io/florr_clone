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
 * DESTRUCTION is still legacy-driven: ~14 sites splice `enemies[]` (the reaper,
 * killHandler, pet despawns, the maze rotation, the distance despawner), and
 * lifecycle is not part of this cutover. `reconcileEnemyEntities` in ecsSync.ts
 * is the removal half of the bridge: once per tick it destroys any mob entity
 * whose shell has left the array. That is a reconcile, not a convention — no
 * splice site has to remember anything.
 */

import { Enemy, LiveEnemy, makeEnemy } from '../server_utils';
import { enemies } from '../constants';
import { getMobStats } from '../mobs';
import { Entity, NULL_ENTITY, World } from '../ecs';
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

    const id = Math.random().toString(36).slice(2, 11);
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
    attachMobBehaviour(world, entity, enemy, now);
    linkEnemyReferences(world, enemy, activeHost.resolvePlayer);

    enemies.push(enemy);
    return enemy;
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

    const world = requireHost().getWorld();
    const entity = world.lookup(head.id);
    if (entity === undefined) return;
    world.add(entity, C.CentipedeSegment, {
        leader: NULL_ENTITY,
        head: entity,
        segmentIndex: 0,
    });
}
