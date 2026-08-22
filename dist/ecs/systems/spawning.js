"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSpawningQueries = createSpawningQueries;
exports.periodicSpawnSystem = periodicSpawnSystem;
exports.spawnWaveSystem = spawnWaveSystem;
exports.registerSpawningSystems = registerSpawningSystems;
const C = __importStar(require("../components"));
const system_1 = require("../system");
function createSpawningQueries(world) {
    return {
        periodic: world.query([C.PeriodicSpawner], [C.IsDead]),
        waves: world.query([C.SpawnWaveState, C.Health], [C.IsDead]),
    };
}
/** Summoners spawn an escort each interval; the cap is enforced by the hook. */
function periodicSpawnSystem(queries, deps) {
    const { spawnIntervalOf, spawnEscort } = deps;
    const scratch = [];
    return (ctx) => {
        const { world, now } = ctx;
        scratch.length = 0;
        queries.periodic.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++)
                scratch.push(entities[i]);
        });
        for (let i = 0; i < scratch.length; i++) {
            const summoner = scratch[i];
            if (!world.isAlive(summoner))
                continue;
            const intervalMs = spawnIntervalOf(summoner);
            if (intervalMs === undefined)
                continue;
            const last = world.get(summoner, C.PeriodicSpawner, 'lastSpawnTime');
            if (now - last < intervalMs)
                continue;
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
function spawnWaveSystem(queries, deps) {
    const { waveCountOf, spawnWaves } = deps;
    const scratch = [];
    return (ctx) => {
        const { world } = ctx;
        scratch.length = 0;
        queries.waves.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++)
                scratch.push(entities[i]);
        });
        for (let i = 0; i < scratch.length; i++) {
            const parent = scratch[i];
            if (!world.isAlive(parent))
                continue;
            const health = world.get(parent, C.Health, 'current');
            const previous = world.get(parent, C.SpawnWaveState, 'previousHealth');
            if (health >= previous) {
                if (health !== previous)
                    world.set(parent, C.SpawnWaveState, 'previousHealth', health);
                continue;
            }
            const numWaves = waveCountOf(parent) - 1;
            if (numWaves >= 0) {
                const maxHp = world.get(parent, C.Health, 'max') || 1;
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
function registerSpawningSystems(scheduler, queries, deps) {
    scheduler.add('periodicSpawns', system_1.Phase.Spawning, periodicSpawnSystem(queries, deps));
    scheduler.add('spawnWaves', system_1.Phase.Spawning, spawnWaveSystem(queries, deps));
}
