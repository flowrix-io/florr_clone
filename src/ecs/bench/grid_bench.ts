/**
 * Broad-phase grid benchmark: production enemyGrid.ts vs the ECS SpatialGrid.
 *
 * This exists to de-risk the perf invariants before the rest of the game is
 * ported onto ECS storage. The collision grid is the single hottest structure
 * on the server — it is rebuilt every tick over ~1400 mobs and then queried
 * once per petal instance per player — so if the ECS layout is going to lose
 * anywhere, it loses here.
 *
 * Fairness rules this benchmark holds itself to:
 *
 *  - The BASELINE is the real `server/enemyGrid.ts` operating on real
 *    `makeEnemy()` objects, not a reimplementation. That matters because
 *    makeEnemy's fixed field order is what keeps every mob on one V8 hidden
 *    class; a hand-rolled stand-in would have a different object size and shape
 *    and would misrepresent the baseline's cache behaviour.
 *
 *  - Both sides get IDENTICAL positions and radii, drawn from one seeded PRNG,
 *    and identical query positions.
 *
 *  - The measured region includes the NARROW PHASE that every real caller runs
 *    immediately after a query (`dist < ownRadius + otherRadius`). Measuring
 *    only the broad phase would flatter the ECS side, which deliberately
 *    carries position and radius out of the grid so the narrow phase needs no
 *    pointer chase — that is the design being tested, so it has to be paid for.
 *
 *  - Both sides must report the SAME hit count. A faster grid that returns
 *    different candidates is not a faster grid.
 */

import { Enemy, LiveEnemy } from '../../server_utils';
import { spawnEnemy } from '../../server/enemyRegistry';
import { bindEntityHost } from '../../server/entityRegistry';
import { mobRadiusOf, mobX, mobY } from '../../server/mobFields';
import { getMobStats, getEnemySizeScale } from '../../mobs';
import { rebuildEnemyGrid, queryEnemiesNear } from '../../server/enemyGrid';
import * as C from '../components';
import { World } from '../world';
import { spawnMob } from '../prefabs';
import { GridQueryResult, SpatialGrid } from '../spatial/grid';

/** Deterministic PRNG so both sides see exactly the same world. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Mob mix roughly matching a populated server: mostly small, a few large. */
const MOB_MIX: Array<{ type: string; tier: string; weight: number }> = [
    { type: 'bee', tier: 'common', weight: 30 },
    { type: 'ladybug', tier: 'common', weight: 25 },
    { type: 'soldier_ant', tier: 'uncommon', weight: 20 },
    { type: 'hornet', tier: 'rare', weight: 12 },
    { type: 'mantis', tier: 'epic', weight: 7 },
    { type: 'bee', tier: 'legendary', weight: 4 },
    { type: 'ant_hole', tier: 'mythic', weight: 2 },
];

function pickMob(rng: () => number) {
    const total = MOB_MIX.reduce((s, m) => s + m.weight, 0);
    let r = rng() * total;
    for (const m of MOB_MIX) {
        r -= m.weight;
        if (r <= 0) return m;
    }
    return MOB_MIX[0];
}

/** The radius formula from enemyGrid's lazy cache, applied identically to both. */
function radiusFor(type: string, tier: string): number {
    const stats = getMobStats(type as never, tier as never);
    const base = stats ? (stats.size * 40) / 2 : 20;
    return base * getEnemySizeScale(false, tier as never, type);
}

interface Spec {
    type: string;
    tier: string;
    x: number;
    y: number;
    radius: number;
}

interface QuerySpec {
    x: number;
    y: number;
    radius: number;
}

function buildSpecs(count: number, extent: number, seed: number): Spec[] {
    const rng = mulberry32(seed);
    const specs: Spec[] = [];
    for (let i = 0; i < count; i++) {
        const m = pickMob(rng);
        specs.push({
            type: m.type,
            tier: m.tier,
            x: (rng() - 0.5) * extent,
            y: (rng() - 0.5) * extent,
            radius: radiusFor(m.type, m.tier),
        });
    }
    return specs;
}

function buildQueries(count: number, extent: number, radius: number, seed: number): QuerySpec[] {
    const rng = mulberry32(seed);
    const qs: QuerySpec[] = [];
    for (let i = 0; i < count; i++) {
        qs.push({ x: (rng() - 0.5) * extent, y: (rng() - 0.5) * extent, radius });
    }
    return qs;
}

interface Result {
    label: string;
    msPerTick: number;
    hits: number;
    heapGrowthMB: number;
}

/** Baseline: the production grid over real Enemy objects. */
function runBaseline(specs: Spec[], queries: QuerySpec[], ticks: number): Result {
    // Mobs are admitted through the registry against a bench-local world:
    // `rebuildEnemyGrid` reads position and radius out of the components now, so
    // a bare shell would have nothing for it to read.
    const world = new World();
    bindEntityHost({ getWorld: () => world, resolvePlayer: () => undefined });
    const enemies: LiveEnemy[] = [];
    for (let i = 0; i < specs.length; i++) {
        const s = specs[i];
        const e = spawnEnemy(s.type, s.tier as never, s.x, s.y, {
            angle: 0, health: 100, maxHealth: 100, damage: 10,
        });
        if (e) enemies.push(e);
    }

    const out: Enemy[] = [];
    let hits = 0;

    // Warm up: JIT the loops. (There are no lazy stat caches any more —
    // radius and mob-config are components written at spawn.)
    for (let t = 0; t < 20; t++) {
        rebuildEnemyGrid(enemies);
        for (const q of queries) queryEnemiesNear(q.x, q.y, q.radius, out);
    }

    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    for (let t = 0; t < ticks; t++) {
        rebuildEnemyGrid(enemies);
        for (const q of queries) {
            queryEnemiesNear(q.x, q.y, q.radius, out);
            // Narrow phase, exactly as real callers do it.
            for (let i = 0; i < out.length; i++) {
                const e = out[i];
                const dx = mobX(e.entity) - q.x;
                const dy = mobY(e.entity) - q.y;
                const reach = q.radius + (mobRadiusOf(e.entity) as number);
                if (dx * dx + dy * dy < reach * reach) hits++;
            }
        }
    }

    const elapsed = performance.now() - start;
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
    enemies.length = 0;

    return {
        label: 'baseline (enemyGrid.ts + Enemy objects)',
        msPerTick: elapsed / ticks,
        hits: hits / ticks,
        heapGrowthMB: heapGrowth / (1024 * 1024),
    };
}

/** Candidate: the ECS SpatialGrid over component columns. */
function runEcs(specs: Spec[], queries: QuerySpec[], ticks: number): Result {
    const world = new World();
    for (let i = 0; i < specs.length; i++) {
        const s = specs[i];
        spawnMob(world, {
            id: `bench-${i}`,
            type: s.type,
            tier: s.tier,
            x: s.x,
            y: s.y,
            health: 100,
            maxHealth: 100,
            speed: 50,
            damage: 10,
            radius: s.radius,
            now: 0,
        });
    }

    const grid = new SpatialGrid();
    grid.ensureStampCapacity(specs.length * 4);
    const source = world.query([C.Position, C.Radius, C.IsEnemy], [C.IsDead, C.PetOwner]);
    const out = new GridQueryResult(256);
    let hits = 0;

    for (let t = 0; t < 20; t++) {
        grid.rebuild(world, source);
        for (const q of queries) grid.query(q.x, q.y, q.radius, out);
    }

    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    for (let t = 0; t < ticks; t++) {
        grid.rebuild(world, source);
        for (const q of queries) {
            grid.query(q.x, q.y, q.radius, out);
            const ox = out.x;
            const oy = out.y;
            const orad = out.radius;
            for (let i = 0; i < out.count; i++) {
                const dx = ox[i] - q.x;
                const dy = oy[i] - q.y;
                const reach = q.radius + orad[i];
                if (dx * dx + dy * dy < reach * reach) hits++;
            }
        }
    }

    const elapsed = performance.now() - start;
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;

    return {
        label: 'ecs (SpatialGrid + SoA columns)',
        msPerTick: elapsed / ticks,
        hits: hits / ticks,
        heapGrowthMB: heapGrowth / (1024 * 1024),
    };
}

export interface Scenario {
    name: string;
    mobs: number;
    /** World extent in px; with `mobs` this sets density. */
    extent: number;
    queries: number;
    queryRadius: number;
    ticks: number;
}

export const SCENARIOS: Scenario[] = [
    // A populated server: ~1400 mobs, 30 players each with a Light-ish loadout
    // of ~70 petal instances issuing one query apiece.
    { name: 'live server (1400 mobs, 2100 queries)', mobs: 1400, extent: 20000, queries: 2100, queryRadius: 30, ticks: 120 },
    // Idle/low population.
    { name: 'quiet server (300 mobs, 200 queries)', mobs: 300, extent: 12000, queries: 200, queryRadius: 30, ticks: 200 },
    // Dense clump: a boss room or a heavily-farmed zone.
    { name: 'dense clump (1400 mobs, 4000px)', mobs: 1400, extent: 4000, queries: 2100, queryRadius: 30, ticks: 60 },
    // Stress: well past anything production sees, to show the scaling trend.
    { name: 'stress (5000 mobs, 6000 queries)', mobs: 5000, extent: 30000, queries: 6000, queryRadius: 30, ticks: 40 },
];

export function runGridBench(): void {
    console.log('Broad-phase grid benchmark — production enemyGrid.ts vs ECS SpatialGrid');
    console.log(`node ${process.version}, gc ${globalThis.gc ? 'exposed' : 'NOT exposed (heap numbers unreliable)'}\n`);

    for (const scenario of SCENARIOS) {
        const specs = buildSpecs(scenario.mobs, scenario.extent, 12345);
        const queries = buildQueries(scenario.queries, scenario.extent, scenario.queryRadius, 999);

        // Alternate which side runs first across scenarios would be better still,
        // but each side gets its own warmup and a forced GC, which is enough to
        // keep one from paying for the other's garbage.
        const baseline = runBaseline(specs, queries, scenario.ticks);
        const ecs = runEcs(specs, queries, scenario.ticks);

        const speedup = baseline.msPerTick / ecs.msPerTick;
        const agree = Math.round(baseline.hits) === Math.round(ecs.hits);

        console.log(`--- ${scenario.name} ---`);
        console.log(`  ${baseline.label}`);
        console.log(`      ${baseline.msPerTick.toFixed(3)} ms/tick   heap +${baseline.heapGrowthMB.toFixed(1)} MB`);
        console.log(`  ${ecs.label}`);
        console.log(`      ${ecs.msPerTick.toFixed(3)} ms/tick   heap +${ecs.heapGrowthMB.toFixed(1)} MB`);
        console.log(`  speedup: ${speedup.toFixed(2)}x   ${speedup >= 1 ? '(ecs faster)' : '(ECS SLOWER)'}`);
        console.log(`  narrow-phase hits/tick: baseline ${baseline.hits.toFixed(0)}, ecs ${ecs.hits.toFixed(0)} ` +
            `${agree ? '- agree' : '- MISMATCH, results are not comparable'}`);
        console.log('');

        if (!agree) {
            console.error('FAIL: the two grids returned different results; benchmark is meaningless until fixed.');
            process.exitCode = 1;
        }
    }

    // A 30Hz tick has a 33.3ms budget. Report the live scenario against it.
    console.log('Tick budget at 30Hz is 33.3 ms; the live scenario above is the number to watch.');
}
