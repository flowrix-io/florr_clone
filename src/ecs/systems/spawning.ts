/**
 * Spawner systems: periodic escorts (queen ant) and damage-triggered waves
 * (ant holes) — the ports of `updatePeriodicSpawns`' summon half and
 * `spawnWaveMobs`.
 *
 * The systems own the TRIGGERS: the per-summoner interval clock
 * (PeriodicSpawner.lastSpawnTime) and the health-threshold bookkeeping
 * (SpawnWaveState.previousHealth). The spawns themselves go through hooks —
 * what an escort is, where it lands, its tier downgrade, the alive-cap and the
 * `enemySpawned` emit are all mob-config and registry business the ECS layer
 * does not hold.
 *
 * Both run in Phase.Spawning on the world scheduler, which the caller ticks
 * once per simulation step after projectiles — the position `spawnWaveMobs`
 * held in the loop, so a wave fires the same tick as the damage that crossed
 * its threshold, whichever weapon dealt it.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

export interface SpawningQueries {
    periodic: Query;
    waves: Query;
}

export function createSpawningQueries(world: World): SpawningQueries {
    return {
        periodic: world.query([C.PeriodicSpawner], [C.IsDead]),
        waves: world.query([C.SpawnWaveState, C.Health], [C.IsDead]),
    };
}

export interface SpawningDeps {
    /** The summoner's periodic_spawn interval in ms, or undefined if none. */
    spawnIntervalOf(summoner: Entity): number | undefined;
    /**
     * Summon one escort behind the summoner. The alive-cap, the tier
     * downgrade, the placement geometry and the emit live with the caller.
     */
    spawnEscort(summoner: Entity): void;
    /** How many waves the parent's spawn_waves config lists (0 = none). */
    waveCountOf(parent: Entity): number;
    /**
     * Health crossed one or more wave thresholds on the way down: spawn the
     * contents of waves `startWave` down to `endWave` (the caller re-derives
     * the wave lists from config).
     */
    spawnWaves(parent: Entity, startWave: number, endWave: number): void;
}

/** Summoners spawn an escort each interval; the cap is enforced by the hook. */
export function periodicSpawnSystem(queries: SpawningQueries, deps: SpawningDeps) {
    const { spawnIntervalOf, spawnEscort } = deps;
    const scratch: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { world, now } = ctx;

        scratch.length = 0;
        queries.periodic.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) scratch.push(entities[i] as Entity);
        });

        for (let i = 0; i < scratch.length; i++) {
            const summoner = scratch[i];
            if (!world.isAlive(summoner)) continue;
            const intervalMs = spawnIntervalOf(summoner);
            if (intervalMs === undefined) continue;

            const last = world.get(summoner, C.PeriodicSpawner, 'lastSpawnTime') as number;
            if (now - last < intervalMs) continue;
            // The interval is consumed whether or not the cap lets the escort
            // spawn — exactly as the legacy pass stamped the time before the
            // alive-count check.
            world.set(summoner, C.PeriodicSpawner, 'lastSpawnTime', now);
            spawnEscort(summoner);
        }
        scratch.length = 0;
    };
}

/**
 * Spawn child waves from any mob whose health dropped this tick. Each wave is
 * tied to an HP threshold; every wave crossed on the way down fires, so
 * multiple waves can trigger on a single big hit. Mirrors kAntHole from gardn.
 */
export function spawnWaveSystem(queries: SpawningQueries, deps: SpawningDeps) {
    const { waveCountOf, spawnWaves } = deps;
    const scratch: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { world } = ctx;

        scratch.length = 0;
        queries.waves.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) scratch.push(entities[i] as Entity);
        });

        for (let i = 0; i < scratch.length; i++) {
            const parent = scratch[i];
            if (!world.isAlive(parent)) continue;

            const health = world.get(parent, C.Health, 'current') as number;
            const previous = world.get(parent, C.SpawnWaveState, 'previousHealth') as number;
            if (health >= previous) {
                if (health !== previous) world.set(parent, C.SpawnWaveState, 'previousHealth', health);
                continue;
            }

            const numWaves = waveCountOf(parent) - 1;
            if (numWaves >= 0) {
                const maxHp = (world.get(parent, C.Health, 'max') as number) || 1;
                // Clamp to the valid wave range [0, numWaves]. Without this, a
                // large overkill drives health far negative, so endWave becomes
                // a huge negative number and the loop spins from startWave down
                // to it — millions of iterations that all just skip: a tight,
                // flat-heap 100% CPU hang.
                const startWave = Math.min(numWaves, Math.floor((previous / maxHp) * numWaves));
                const endWave = Math.max(0, Math.ceil((health / maxHp) * numWaves));
                spawnWaves(parent, startWave, endWave);
            }
            world.set(parent, C.SpawnWaveState, 'previousHealth', health);
        }
        scratch.length = 0;
    };
}

export function registerSpawningSystems(
    scheduler: {
        add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown;
    },
    queries: SpawningQueries,
    deps: SpawningDeps,
): void {
    scheduler.add('periodicSpawns', Phase.Spawning, periodicSpawnSystem(queries, deps));
    scheduler.add('spawnWaves', Phase.Spawning, spawnWaveSystem(queries, deps));
}
