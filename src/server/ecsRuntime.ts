/**
 * ECS composition root for the server.
 *
 * This is the one place that knows both the ECS layer and the game's existing
 * modules, so everything above it stays decoupled: `src/ecs/**` never imports
 * constants.ts, petal_actions.ts or the map, which is what keeps the ECS
 * typecheckable and testable on its own in about a second.
 *
 * It is also where the injected dependencies get their REAL implementations —
 * most importantly `stepPlayerMovement`, which is passed through verbatim
 * rather than reimplemented so the server and the client's movement prediction
 * keep executing the same physics.
 *
 * Nothing calls this yet. It exists so the tick loop can be moved over one
 * system at a time with the wiring already in place and verified.
 */

import {
    MAX_SPEED,
    PLAYER_SIZE,
    VIEWPORT_WIDTH,
    getTileState,
    isTileIdBlocking,
    resolveEntityWallCollisions,
    stepPlayerMovement,
} from '../constants';
import { WALL_GRID } from '../map_data';
import { hasLineOfSight } from './physics';
import { getPetalStats, getRarityIndex } from '../petals';
import { getMobStats, SIZE_SCALING } from '../mobs';
import { getSpeedMultiplier } from '../petal_actions';
import { ServerPlayer } from '../player';

import { Entity, Phase, Scheduler, World } from '../ecs';
import * as C from '../ecs/components';
import { GridQueryResult, SpatialGrid } from '../ecs/spatial/grid';
import { idToRarity, mobTypes } from '../ecs/interning';
import { createFireVolley, ProjectileConfig } from '../ecs/systems/projectileFiring';
import {
    createMobCollisionQueries,
    registerMobCollisionSystem,
} from '../ecs/systems/mobCollision';
import {
    createAfflictionQueries,
    registerAfflictionSystems,
} from '../ecs/systems/afflictions';
import {
    createLifetimeQueries,
    registerLifetimeSystems,
} from '../ecs/systems/lifetime';
import {
    createCentipedeQueries,
    registerCentipedeSystems,
} from '../ecs/systems/centipede';
import {
    createEnemyAIQueries,
    registerEnemyAISystem,
} from '../ecs/systems/enemyAI';
import {
    createEnemyPassiveQueries,
    registerEnemyPassiveSystems,
} from '../ecs/systems/enemyPassive';
import {
    createMovementQueries,
    registerMovementSystems,
} from '../ecs/systems/movement';
import {
    createPlayerMovementQueries,
    registerPlayerMovementSystem,
} from '../ecs/systems/playerMovement';

/**
 * Everything the server needs to drive the ECS for one tick.
 */
export interface EcsRuntime {
    world: World;
    scheduler: Scheduler;
    grid: SpatialGrid;
    /** Reusable broad-phase result buffer. */
    gridResult: GridQueryResult;
    /** Advance one tick. `now` is sampled once by the caller. */
    tick(deltaTime: number, deltaMs: number, now: number): void;
}

/**
 * Bridge for the speed multiplier while players still live in the legacy
 * `players` map.
 *
 * `getSpeedMultiplier` reads the loadout and the active effect list, neither of
 * which is ported yet. Rather than fork that logic, the runtime resolves the
 * entity back to its ServerPlayer and calls the real function. When the loadout
 * and effects become components this collapses to a pure column read and the
 * lookup goes away.
 */
export interface LegacyPlayerLookup {
    (socketId: string): ServerPlayer | undefined;
}

export interface EcsRuntimeOptions {
    lookupPlayer: LegacyPlayerLookup;
    /**
     * Credit pet-dealt damage to the pet's OWNER, for XP and drop attribution.
     *
     * Injected rather than imported: the original called `trackDamage` from
     * server.ts via a lazy `require()` in the middle of the collision loop, a
     * circular import that only worked because it was deferred. Passing the
     * hook in removes the cycle outright.
     */
    creditDamage(victim: Entity, ownerPlayer: Entity, amount: number): void;
    /** Queue the victim into this tick's batched damage broadcast. */
    onEnemyDamaged(victim: Entity): void;
    /** The victim died: award XP and drops, and emit to clients. */
    onEnemyKilled(victim: Entity): void;
}

export function createEcsRuntime(options: EcsRuntimeOptions): EcsRuntime {
    const { lookupPlayer, creditDamage, onEnemyDamaged, onEnemyKilled } = options;
    const world = new World();
    const scheduler = new Scheduler(world);
    const grid = new SpatialGrid();
    const gridResult = new GridQueryResult(256);

    /**
     * The grid is fed by the same predicate the old rebuild used: wild, living
     * mobs only. Pets are excluded because callers of the broad phase expect not
     * to have to filter them, and the dead because they are pending reaping.
     */
    const gridSource = world.query(
        [C.Position, C.Radius, C.IsEnemy],
        [C.IsDead, C.PetOwner],
    );

    // Spatial index first: bot targeting queries it, exactly as before.
    scheduler.add('rebuildSpatialGrid', Phase.SpatialIndex, () => {
        grid.rebuild(world, gridSource);
    });

    registerPlayerMovementSystem(scheduler, createPlayerMovementQueries(world), {
        maxSpeed: MAX_SPEED,
        playerSize: PLAYER_SIZE,
        // Passed through, never reimplemented — the client predicts with this
        // same function and any fork would desync open movement.
        step: stepPlayerMovement,
        speedMultiplier: (entity: Entity): number => {
            const socketId = world.externalIdOf(entity);
            if (socketId === undefined) return 1;
            const player = lookupPlayer(socketId);
            return player ? getSpeedMultiplier(player) : 1;
        },
    });

    registerMovementSystems(scheduler, createMovementQueries(world));

    // Mobs that chase at exactly the player's base speed, so a fleeing flower
    // can never outrun them. Resolved to interned ids once, since the AI tests
    // this per chasing mob per tick.
    const playerSpeedChaserIds = new Set<number>(
        [
            'bee',
            'ladybug', 'shiny_ladybug', 'dark_ladybug',
            'soldier_ant', 'worker_ant', 'baby_ant',
            'soldier_fire_ant', 'worker_fire_ant', 'baby_fire_ant',
        ].map(name => mobTypes.intern(name)),
    );

    /** Resolve a mob entity's config from its interned type and rarity index. */
    const statsOf = (mob: Entity) => {
        const typeName = mobTypes.nameOf(world.get(mob, C.MobKind, 'type') as number);
        const rarityName = idToRarity(world.get(mob, C.MobKind, 'tier') as number);
        return rarityName ? getMobStats(typeName, rarityName) : null;
    };

    const fireVolley = createFireVolley(world, {
        projectileConfigOf: (shooter) =>
            (statsOf(shooter)?.projectile as ProjectileConfig | undefined),
        cooldownOf: (shooter) => statsOf(shooter)?.cooldown ?? 0,
        petalStatsOf: (petalType, rarityIndex) => {
            const rarityName = idToRarity(rarityIndex);
            return rarityName ? (getPetalStats(petalType, rarityName) ?? undefined) : undefined;
        },
        sizeScalingOf: (rarityIndex) => {
            const rarityName = idToRarity(rarityIndex);
            return (rarityName ? SIZE_SCALING[rarityName] : undefined) ?? 1;
        },
        mobTypeNameOf: (shooter) => mobTypes.nameOf(world.get(shooter, C.MobKind, 'type') as number),
        rarityNameOf: (rarityIndex) => idToRarity(rarityIndex) ?? 'common',
    });

    registerEnemyAISystem(scheduler, createEnemyAIQueries(world), {
        hasLineOfSight,
        resolveWall: (x, y, halfSize) => resolveEntityWallCollisions(x, y, halfSize),
        isBlocked: (x, y) => isTileIdBlocking(getTileState(WALL_GRID, x, y)),
        fireVolley,
        hasProjectile: (shooter) => !!statsOf(shooter)?.projectile,
        isPlayerSpeedChaser: (typeId) => playerSpeedChaserIds.has(typeId),
        playerChaseStep: MAX_SPEED / 30,
        sandstormSuckTier: getRarityIndex('super'),
        maxTargetDistance: VIEWPORT_WIDTH * 5,
    });

    registerMobCollisionSystem(scheduler, createMobCollisionQueries(world), {
        resolveWall: (x, y, halfSize) => resolveEntityWallCollisions(x, y, halfSize),
        noMobCollision: (mob) => !!statsOf(mob)?.no_mob_collision,
        creditDamage,
        onDamaged: onEnemyDamaged,
        onKilled: onEnemyKilled,
    });

    registerEnemyPassiveSystems(scheduler, createEnemyPassiveQueries(world));

    // The centipede passes take the real tile-grid resolver, so a chain pushed
    // into geometry is corrected the same way every other wall contact is.
    registerCentipedeSystems(
        scheduler,
        createCentipedeQueries(world),
        (x, y, halfSize) => resolveEntityWallCollisions(x, y, halfSize),
    );

    registerAfflictionSystems(scheduler, createAfflictionQueries(world));
    registerLifetimeSystems(scheduler, createLifetimeQueries(world));

    return {
        world,
        scheduler,
        grid,
        gridResult,
        tick(deltaTime: number, deltaMs: number, now: number): void {
            // The stamp table is indexed by entity slot, so it has to keep up
            // with the world as the population grows.
            grid.ensureStampCapacity(world.size() * 4 + 1024);
            scheduler.tick(deltaTime, deltaMs, now);
        },
    };
}
