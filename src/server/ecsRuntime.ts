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
import { hasLineOfSight } from './lineOfSight';
import { checkProjectileWallCollision } from './physics';
import { getPetalStats, getRarityIndex } from '../petals';
import { getMobStats, SIZE_SCALING } from '../mobs';
import { ServerPlayer } from '../player';

import { Entity, Phase, Query, Scheduler, World } from '../ecs';
import * as C from '../ecs/components';
import { spawnProjectile } from '../ecs/prefabs';
import { GridQueryResult, SpatialGrid } from '../ecs/spatial/grid';
import { idToRarity, mobTypes, petalTypes } from '../ecs/interning';
import { createFireVolley, ProjectileConfig } from '../ecs/systems/projectileFiring';
import {
    createProjectileCollisionQueries,
    KillTiming,
    registerProjectileCollisionSystem,
} from '../ecs/systems/projectileCollision';
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
    createViewportQueries,
    registerViewportSystem,
} from '../ecs/systems/viewport';
import {
    createPlayerMovementQueries,
    registerPlayerMovementSystem,
} from '../ecs/systems/playerMovement';
import {
    createPlayerModifierQueries,
    registerPlayerModifierSystem,
} from '../ecs/systems/playerModifiers';

/** A player-fired projectile, as the legacy petal loop describes it. */
export interface PlayerProjectileSpawn {
    /** Socket id of the firing player. */
    playerId: string;
    x: number;
    y: number;
    angle: number;
    /** Pixels per MILLISECOND — the caller does the /1000, as it always did. */
    speed: number;
    maxDistance: number;
    petalType: string;
    petalRarity: string;
    damage: number;
    health: number;
    size: number;
    now: number;
}

/**
 * What a petal needs to know about a mob projectile it just blocked.
 *
 * Deliberately carries no entity handle: petals are still legacy code, and
 * handing them a handle would invite them to mutate the world directly. They
 * report the damage they dealt as the callback's return value instead.
 */
export interface BlockedMobProjectile {
    /** Damage this projectile deals to the petal that stopped it. */
    damage: number;
}

/**
 * Everything the server needs to drive the ECS for one tick.
 */
export interface EcsRuntime {
    world: World;
    scheduler: Scheduler;
    /**
     * The projectile half of the tick, on its own scheduler.
     *
     * Exposed so profiling and per-system timings cover it: it is a separate
     * Scheduler, so `scheduler.drainTimings()` alone would silently omit every
     * projectile system from the tick-budget report.
     */
    projectileScheduler: Scheduler;
    /**
     * The PLAYER half of the tick, on its own scheduler — see `tickPlayers`.
     *
     * Exposed for the same reason as the projectile scheduler: timings drained
     * from `scheduler` alone would omit it from the tick-budget report.
     */
    playerScheduler: Scheduler;
    /**
     * The INPUT half of the tick, on its own scheduler — see `tickInput`.
     *
     * Exposed for the same reason as the other two: timings drained from
     * `scheduler` alone would omit it from the tick-budget report.
     */
    inputScheduler: Scheduler;
    grid: SpatialGrid;
    /** Reusable broad-phase result buffer. */
    gridResult: GridQueryResult;
    /** Advance one tick. `now` is sampled once by the caller. */
    tick(deltaTime: number, deltaMs: number, now: number): void;
    /**
     * Advance every player one movement step.
     *
     * On its OWN scheduler, and this is the whole point of the split. The mob
     * scheduler runs inside `moveEnemies()`, which is AFTER `updatePlayerState`
     * in `runSimulationStep`; a player-movement system registered there would
     * move flowers a whole tick after the legacy code that used to move them,
     * shifting every mob-vs-player contact by one tick. Giving players their own
     * scheduler lets the caller run them at the exact point in the tick the
     * legacy movement occupied, so the sequence of COMMITTED player positions
     * that mobs, petals and the broadcast see is unchanged.
     *
     * Like the projectile scheduler and unlike the mob one, this is dt-SCALED,
     * so it runs exactly once per simulation step and is never replayed for
     * catch-up.
     */
    tickPlayers(deltaTime: number, deltaMs: number, now: number): void;
    /**
     * Sample this tick's inputs — today, run bot AI.
     *
     * On its OWN scheduler, and like the player split that is the entire point.
     * `Phase.Input` on the MOB scheduler runs inside `moveEnemies()`, which is
     * after `updatePlayerState`; an input system there would produce decisions
     * that legacy had already consumed this tick, one tick stale, with every
     * gate green. `Phase.Input` on the PLAYER scheduler runs inside the movement
     * window, after `syncPlayersToEcs` has already pushed `player.inputs` into
     * `C.PlayerInput` — a second writer racing a push that already won.
     *
     * So the caller ticks this one at the point in `start_loop` the legacy
     * `updateBotAI(io)` call occupied: after the enemy grid rebuild that bot
     * targeting queries, and before `runSimulationStep`. Nothing is registered
     * here by `createEcsRuntime` itself — `server.ts` registers bot AI, because
     * server/botManager.ts reaches the squad manager, the world map and the chat
     * socket, and importing it from this file would put all of that (and, until
     * recently, a second listening server) into the ECS composition root.
     *
     * dt-SCALED like the player and projectile schedulers: it runs exactly once
     * per real tick and is never replayed for catch-up.
     */
    tickInput(deltaTime: number, deltaMs: number, now: number): void;
    /**
     * Advance projectiles by one step of REAL elapsed time.
     *
     * Separate from `tick` on purpose. The mob step is a FIXED per-call step, so
     * server.ts replays `tick` `mobCatchupCalls` times to catch up after a stall;
     * projectiles are dt-SCALED, so replaying them would fly every shot N times
     * its distance. Registering the projectile systems on the main scheduler
     * would make an admin `simtick` spike do exactly that, silently.
     */
    tickProjectiles(deltaMs: number, now: number): void;
    /** Live projectile sets, for the (still legacy) viewport broadcast. */
    projectileQueries: { mob: Query; player: Query };
    /** Spawn a player-fired projectile. The petal loop that decides to fire is legacy. */
    spawnPlayerProjectile(spec: PlayerProjectileSpawn): void;
    /**
     * Run `visit` for every mob projectile overlapping a petal at (x, y).
     *
     * The callback returns the damage the petal deals back, which is applied
     * here — so the world mutation stays on this side of the boundary. This is
     * the one cross-boundary hook the cutover needs: petals are legacy and mob
     * projectiles are ECS entities.
     */
    forEachMobProjectileHitting(
        x: number,
        y: number,
        petalRadius: number,
        visit: (projectile: BlockedMobProjectile) => number,
    ): void;
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
    /**
     * Whether a world position is near enough to a live player to count as
     * seen, feeding the unseen-despawn timer.
     *
     * INJECTED, not imported. The real implementation lives in playerState.ts,
     * and importing that module here pulls in server.ts — which binds a port
     * and opens the database at module scope. The harness guard caught exactly
     * that when this was first written as an import.
     */
    isNearAnyPlayer(x: number, y: number): boolean;
    /**
     * Mint the next wire id for a projectile of this kind.
     *
     * The two monotonic counters stay in server/gameState.ts: they are broadcast
     * bookkeeping, and the user's instruction is that broadcast stays legacy.
     */
    allocateProjectileNetId(fromPlayer: boolean): number;
    /**
     * Resolve (importing if necessary) the entity for a socket id.
     *
     * Needed because a player can fire on the very first tick they exist, before
     * syncToEcs has imported them — the projectile would otherwise be stamped
     * with a dead shooter and deal nothing. Injected rather than importing
     * ecsSync, which would be a cycle.
     */
    resolvePlayerEntity(socketId: string): Entity | undefined;
    /**
     * A mob projectile connected with a player; see ProjectileCollisionDeps.
     * Returns whether the player is still alive after the hit.
     */
    onPlayerHit(
        player: Entity,
        damage: number,
        knockbackX: number,
        knockbackY: number,
        sourceTypeName: string,
    ): boolean;
    /** Emit `enemyDamaged` for this victim immediately (the pet-projectile path). */
    emitEnemyDamaged(victim: Entity, health: number): void;
    /** `getDamageMultiplier(player)`, or undefined when the player is gone. */
    damageMultiplierOf(player: Entity): number | undefined;
    /** A player's live hit radius, from their current sizeMultiplier. */
    playerRadiusOf(player: Entity): number;
    /** A projectile killed this mob: run the XP/drops/broadcast death sequence. */
    onProjectileKill(victim: Entity, killer: Entity, timing: KillTiming): void;
}

export function createEcsRuntime(options: EcsRuntimeOptions): EcsRuntime {
    const { creditDamage, onEnemyDamaged, onEnemyKilled, isNearAnyPlayer } = options;
    const world = new World();
    const scheduler = new Scheduler(world);
    /**
     * Projectiles run on their OWN scheduler so they can be stepped with the
     * real elapsed time exactly once per simulation step, while the mob
     * scheduler above is replayed at a fixed step to catch up. See
     * EcsRuntime.tickProjectiles.
     */
    const projectileScheduler = new Scheduler(world);
    /**
     * Players run on their OWN scheduler so the caller can place them at the
     * point in the server tick the legacy movement occupied — before
     * `updatePlayerState`, and therefore before `moveEnemies` runs the mob
     * scheduler. See EcsRuntime.tickPlayers.
     */
    const playerScheduler = new Scheduler(world);
    /**
     * Inputs run on their OWN scheduler so the caller can place them where the
     * legacy `updateBotAI` call sat — before the whole simulation step, and
     * therefore before anything reads an input. See EcsRuntime.tickInput.
     */
    const inputScheduler = new Scheduler(world);
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

    // Derived modifiers are computed from the Loadout and PlayerEffects
    // COMPONENTS, closing the window where a player existed both as an entity
    // and as a ServerPlayer read for modifier maths. Only the petal stat table
    // is still injected, and that is config, not state.
    registerPlayerModifierSystem(playerScheduler, createPlayerModifierQueries(world), {
        petalModifiersOf: (slot) => {
            const item = slot as { petalType?: string; rarity?: string } | null;
            if (!item?.petalType) return undefined;
            const stats = getPetalStats(item.petalType, item.rarity ?? 'common');
            const modifiers = stats?.playerModifiers;
            if (!modifiers) return undefined;
            return {
                speedMultiplier: modifiers.speed,
                playerRadius: modifiers.playerRadius,
                magnetism: modifiers.magnetism,
                aggroRadius: modifiers.aggroRadius,
                rotationSpeed: modifiers.rotationSpeed,
            };
        },
        // Active speed effects still come from the legacy effect pipeline; the
        // effect LIST itself is already a component, so this reads component
        // state through a config-only helper.
        effectSpeedMultiplier: () => 1,
    });

    registerPlayerMovementSystem(playerScheduler, createPlayerMovementQueries(world), {
        maxSpeed: MAX_SPEED,
        playerSize: PLAYER_SIZE,
        // Passed through, never reimplemented — the client predicts with this
        // same function and any fork would desync open movement.
        step: stepPlayerMovement,
    });

    // Projectile flight and collision live on the projectile scheduler, NOT the
    // mob one — see EcsRuntime.tickProjectiles for why that split exists.
    registerMovementSystems(projectileScheduler, createMovementQueries(world), {
        hitsWall: checkProjectileWallCollision,
    });

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
        allocateNetId: () => options.allocateProjectileNetId(false),
    });

    const projectileQueries = createProjectileCollisionQueries(world);

    registerProjectileCollisionSystem(projectileScheduler, projectileQueries, grid, gridResult, {
        petalDamageOf: (petalType, rarityIndex) => {
            const rarityName = idToRarity(rarityIndex);
            if (!rarityName) return undefined;
            return getPetalStats(petalType, rarityName)?.damage;
        },
        massOf: (mob) => statsOf(mob)?.mass,
        playerRadiusOf: options.playerRadiusOf,
        damageMultiplierOf: options.damageMultiplierOf,
        onPlayerHit: options.onPlayerHit,
        creditDamage,
        emitEnemyDamaged: options.emitEnemyDamaged,
        markEnemyDamaged: onEnemyDamaged,
        onProjectileKill: options.onProjectileKill,
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

    // Feeds the unseen-despawn timer. Registered even while despawn itself is
    // legacy-owned, so ViewportTracked is accurate the moment lifecycle moves.
    registerViewportSystem(scheduler, createViewportQueries(world), {
        isNearAnyPlayer,
    });

    registerAfflictionSystems(scheduler, createAfflictionQueries(world));
    registerLifetimeSystems(scheduler, createLifetimeQueries(world));

    // ---------------------------------------------------------------------
    // The petal bridge
    // ---------------------------------------------------------------------
    // Petals are still legacy, so the one place the two halves have to meet is
    // "a petal blocked an incoming shot". Handles are snapshotted into a reused
    // buffer BEFORE any callback runs: the visit callback damages (and can
    // destroy) projectiles, and doing that while `chunks` is walking the
    // archetype would swap an unvisited row into the slot just passed.
    const blockScratch: Entity[] = [];
    const blockedView: BlockedMobProjectile = { damage: 0 };

    return {
        world,
        scheduler,
        projectileScheduler,
        playerScheduler,
        inputScheduler,
        grid,
        gridResult,
        projectileQueries: {
            mob: projectileQueries.mobProjectiles,
            player: projectileQueries.playerProjectiles,
        },

        tick(deltaTime: number, deltaMs: number, now: number): void {
            // The stamp table is indexed by entity slot, so it has to keep up
            // with the world as the population grows.
            grid.ensureStampCapacity(world.size() * 4 + 1024);
            scheduler.tick(deltaTime, deltaMs, now);
        },

        tickPlayers(deltaTime: number, deltaMs: number, now: number): void {
            // No grid work here: nothing in the player pass queries the spatial
            // index. Player-vs-mob contact is still resolved by the legacy
            // collision block in updatePlayerState, against the legacy grid.
            playerScheduler.tick(deltaTime, deltaMs, now);
        },

        tickInput(deltaTime: number, deltaMs: number, now: number): void {
            // No grid work: the systems here read the LEGACY enemy grid, which
            // server.ts rebuilds immediately before this call. See tickInput's
            // declaration for why that ordering is the contract rather than an
            // accident.
            inputScheduler.tick(deltaTime, deltaMs, now);
        },

        tickProjectiles(deltaMs: number, now: number): void {
            grid.ensureStampCapacity(world.size() * 4 + 1024);
            // Rebuilt here as well as in the mob tick. The legacy projectile
            // loops linear-scanned `enemies` and therefore saw POST-move mob
            // positions; the grid built at the top of the mob tick holds
            // pre-move ones. Refreshing it is what keeps hit tests landing where
            // the mobs actually are this tick.
            grid.rebuild(world, gridSource);
            projectileScheduler.tick(deltaMs / 1000, deltaMs, now);
        },

        spawnPlayerProjectile(spec: PlayerProjectileSpawn): void {
            const shooter = options.resolvePlayerEntity(spec.playerId);
            if (shooter === undefined) return;
            spawnProjectile(world, {
                x: spec.x,
                y: spec.y,
                angle: spec.angle,
                speed: spec.speed,
                maxDistance: spec.maxDistance,
                damage: spec.damage,
                health: spec.health,
                size: spec.size,
                petalType: spec.petalType,
                petalRarity: spec.petalRarity,
                shooter,
                // Player projectiles carry no mob source type: nothing reads one
                // (glitch infection is a mob-projectile rule).
                fromPlayer: true,
                netId: options.allocateProjectileNetId(true),
                now: spec.now,
            });
        },

        forEachMobProjectileHitting(
            x: number,
            y: number,
            petalRadius: number,
            visit: (projectile: BlockedMobProjectile) => number,
        ): void {
            blockScratch.length = 0;
            projectileQueries.mobProjectiles.chunks(chunk => {
                const pos = chunk.cols(C.Position);
                const rad = chunk.cols(C.Radius);
                const hp = chunk.cols(C.Health);
                const entities = chunk.entities;
                for (let i = 0; i < chunk.count; i++) {
                    if (hp.current[i] <= 0) continue;
                    const dx = pos.x[i] - x;
                    const dy = pos.y[i] - y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    // `distance > 0` matches the legacy petal test exactly.
                    if (!(distance < rad.value[i] + petalRadius && distance > 0)) continue;
                    blockScratch.push(entities[i] as Entity);
                }
            });

            for (let i = 0; i < blockScratch.length; i++) {
                const projectile = blockScratch[i];
                if (!world.isAlive(projectile)) continue;

                // Damage the petal takes: re-looked-up from the petal table with
                // the stamped value as the fallback, exactly as before.
                const typeName = petalTypes.nameOf(
                    world.get(projectile, C.Projectile, 'petalType') as number,
                );
                const rarityName = idToRarity(
                    world.get(projectile, C.Projectile, 'petalRarity') as number,
                );
                const stats = rarityName ? getPetalStats(typeName, rarityName) : null;
                blockedView.damage = stats
                    ? stats.damage
                    : (world.get(projectile, C.Damage, 'value') as number);

                const dealt = visit(blockedView);

                const health = (world.get(projectile, C.Health, 'current') as number) - dealt;
                world.set(projectile, C.Health, 'current', health);
                if (health <= 0) world.destroy(projectile);
            }
            blockScratch.length = 0;
        },
    };
}
