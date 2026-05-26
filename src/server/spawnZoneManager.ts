import {
    enemies,
    MapElement,
    SCALE_FACTOR,
    ORIGINAL_ENEMY_COUNT,
    TOTAL_WORLD_AREA
} from '../constants';
import {
    EnemySpawnerHelpers,
    createEnemyInZone,
    getAllSpawnZones,
    isZoneNearAnyViewport,
    countMobsInZone
} from './enemySpawner';

/**
 * Wave-based spawning for spawn zones.
 *
 * The density loop in server.ts handles open-world spawning but skips spawn
 * zones; this module owns spawning inside spawn zones. When a zone is near
 * any player's viewport it does an initial fill, then alternates between
 * big "wave" spawns every WAVE_INTERVAL_MS and small "trickle" spawns in
 * between. When no viewport overlaps the zone the state resets so the next
 * approach kicks off another initial fill (keeping zones "fresh" for
 * returning players).
 */

const WAVE_INTERVAL_MS = 45_000;
const TRICKLE_INTERVAL_MS = 4_000;
const TRICKLE_MIN = 1;
const TRICKLE_MAX = 2;

// Cap per-tick spawn batches so a single tick doesn't push hundreds of mobs
// at once (which would briefly spike the broadcast packet size).
const MAX_INITIAL_SPAWNS_PER_TICK = 12;
const MAX_WAVE_SPAWNS_PER_TICK = 12;

interface SpawnZoneState {
    zone: MapElement;
    targetMobCount: number;
    initialized: boolean;
    lastWaveTime: number;
    lastTrickleTime: number;
    // Accumulator for staggering an initial fill / wave fill across multiple
    // ticks so we don't blast all the mobs in a single tick.
    pendingFillCount: number;
}

let zoneStates: SpawnZoneState[] | null = null;

function computeTargetMobCount(zone: MapElement): number {
    // Use the same density as the global open-world target so a zone roughly
    // matches the rest of the world's mob density when fully populated.
    const density = ORIGINAL_ENEMY_COUNT / TOTAL_WORLD_AREA;
    const areaWorld = (zone.width * SCALE_FACTOR) * (zone.height * SCALE_FACTOR);
    return Math.max(1, Math.ceil(density * areaWorld));
}

function ensureInitialized(): void {
    if (zoneStates !== null) return;
    const zones = getAllSpawnZones();
    zoneStates = zones.map(zone => ({
        zone,
        targetMobCount: computeTargetMobCount(zone),
        initialized: false,
        lastWaveTime: 0,
        lastTrickleTime: 0,
        pendingFillCount: 0
    }));
}

function spawnUpTo(state: SpawnZoneState, helpers: EnemySpawnerHelpers, maxThisTick: number): number {
    let spawned = 0;
    for (let i = 0; i < maxThisTick; i++) {
        const enemy = createEnemyInZone(helpers, state.zone);
        if (!enemy) break;
        enemies.push(enemy);
        spawned++;
    }
    return spawned;
}

/**
 * Tick the spawn-zone manager. Should be called on a steady interval
 * (e.g. once per second) from server.ts.
 */
export function updateSpawnZones(helpers: EnemySpawnerHelpers): void {
    ensureInitialized();
    if (!zoneStates || zoneStates.length === 0) return;

    const viewports = helpers.getPlayerViewports();
    if (viewports.length === 0) {
        // No real players online — let everything reset so a returning player
        // gets a fresh initial spawn.
        for (const state of zoneStates) {
            state.initialized = false;
            state.pendingFillCount = 0;
        }
        return;
    }

    const now = Date.now();

    for (const state of zoneStates) {
        const nearViewport = isZoneNearAnyViewport(state.zone, viewports);
        if (!nearViewport) {
            // Reset so re-approach triggers another initial fill.
            state.initialized = false;
            state.pendingFillCount = 0;
            continue;
        }

        if (!state.initialized) {
            // First time the zone enters a player's viewport — queue up a
            // full fill of the zone.
            const currentInZone = countMobsInZone(state.zone);
            state.pendingFillCount = Math.max(0, state.targetMobCount - currentInZone);
            state.initialized = true;
            state.lastWaveTime = now;
            state.lastTrickleTime = now;
        }

        // Drain any pending fill (initial spawn or wave) at most a chunk per tick.
        if (state.pendingFillCount > 0) {
            const chunk = Math.min(state.pendingFillCount, MAX_INITIAL_SPAWNS_PER_TICK);
            const spawned = spawnUpTo(state, helpers, chunk);
            state.pendingFillCount = Math.max(0, state.pendingFillCount - spawned);
            // If we couldn't spawn anything this tick (e.g., all positions
            // blocked by petals or walls), drop the residual so we don't
            // spin forever on an unfillable zone — the next wave will retry.
            if (spawned === 0) {
                state.pendingFillCount = 0;
            }
            continue;
        }

        // Big wave every WAVE_INTERVAL_MS — refill back to target.
        if (now - state.lastWaveTime >= WAVE_INTERVAL_MS) {
            const currentInZone = countMobsInZone(state.zone);
            const deficit = Math.max(0, state.targetMobCount - currentInZone);
            state.pendingFillCount = Math.min(deficit, MAX_WAVE_SPAWNS_PER_TICK * 4);
            state.lastWaveTime = now;
            state.lastTrickleTime = now;
            continue;
        }

        // Trickle a small number of mobs between waves to keep the zone
        // populated as players cull it down. Only trickle if we're below
        // the target so we don't oversaturate.
        if (now - state.lastTrickleTime >= TRICKLE_INTERVAL_MS) {
            state.lastTrickleTime = now;
            const currentInZone = countMobsInZone(state.zone);
            if (currentInZone < state.targetMobCount) {
                const count = TRICKLE_MIN + Math.floor(Math.random() * (TRICKLE_MAX - TRICKLE_MIN + 1));
                spawnUpTo(state, helpers, Math.min(count, state.targetMobCount - currentInZone));
            }
        }
    }
}
