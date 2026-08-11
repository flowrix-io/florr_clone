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

import { MAX_SPEED, PLAYER_SIZE, stepPlayerMovement } from '../constants';
import { getSpeedMultiplier } from '../petal_actions';
import { ServerPlayer } from '../player';

import { Entity, Phase, Scheduler, World } from '../ecs';
import * as C from '../ecs/components';
import { GridQueryResult, SpatialGrid } from '../ecs/spatial/grid';
import {
    createAfflictionQueries,
    registerAfflictionSystems,
} from '../ecs/systems/afflictions';
import {
    createLifetimeQueries,
    registerLifetimeSystems,
} from '../ecs/systems/lifetime';
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

export function createEcsRuntime(lookupPlayer: LegacyPlayerLookup): EcsRuntime {
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
