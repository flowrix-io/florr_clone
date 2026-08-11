/**
 * Headless ECS tick harness.
 *
 * Everything before this point was unit-tested in isolation. This runs the WHOLE
 * scheduler — spatial grid, player modifiers, enemy AI, passive drift, centipede
 * chains, projectile flight and firing, mob collision, afflictions, expiry,
 * reaping — over a populated world for thousands of ticks, using the real mob
 * configs, the real tile grid and the real physics.
 *
 * What it is checking is the thing unit tests structurally cannot: that the
 * systems compose. Specifically it asserts, every tick, that no entity has
 * acquired a non-finite or absurd coordinate. That single invariant catches most
 * of the ways a simulation quietly destroys itself — a divide-by-zero in a
 * steering vector, a NaN propagating from an empty loadout, an unclamped
 * velocity walking an entity past 2^53 where the grid loops stop terminating.
 *
 * It also reports per-system timings against the 33.3ms budget, which is the
 * number that decides whether the cutover is safe on the t3.micro and the Pi.
 */

import { makeEnemy, Enemy } from '../../server_utils';
import { ServerPlayer } from '../../player';
import { createEcsRuntime } from '../../server/ecsRuntime';
import { importWorld } from '../../server/ecsBridge';
import * as C from '../components';
import { MAX_SANE_WORLD_COORD_LIMIT } from './limits';

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A mix that exercises every AI branch the port touches. */
const MOB_MIX: Array<{ type: string; tier: string; ai: Enemy['aiType']; weight: number }> = [
    { type: 'bee', tier: 'common', ai: 'neutral', weight: 25 },
    { type: 'ladybug', tier: 'common', ai: 'passive', weight: 20 },
    { type: 'soldier_ant', tier: 'uncommon', ai: 'hostile', weight: 20 },
    { type: 'hornet', tier: 'rare', ai: 'hostile', weight: 15 },
    { type: 'mantis', tier: 'epic', ai: 'hostile', weight: 8 },
    { type: 'centipede', tier: 'rare', ai: 'neutral', weight: 5 },
    { type: 'ant_hole', tier: 'mythic', ai: 'passive', weight: 4 },
    { type: 'bee', tier: 'legendary', ai: 'neutral', weight: 3 },
];

function pick(rng: () => number) {
    const total = MOB_MIX.reduce((s, m) => s + m.weight, 0);
    let r = rng() * total;
    for (const m of MOB_MIX) {
        r -= m.weight;
        if (r <= 0) return m;
    }
    return MOB_MIX[0];
}

export interface HarnessConfig {
    mobs: number;
    players: number;
    /** Fraction of mobs that are pets belonging to a random player. */
    petFraction: number;
    ticks: number;
    extent: number;
    seed: number;
}

export const DEFAULT_CONFIG: HarnessConfig = {
    mobs: 1400,
    players: 30,
    petFraction: 0.08,
    ticks: 2000,
    extent: 12000,
    seed: 20260810,
};

/** Build a legacy world, then let the bridge convert it. */
function buildLegacyWorld(config: HarnessConfig) {
    const rng = mulberry32(config.seed);
    const players: ServerPlayer[] = [];
    const enemies: Enemy[] = [];

    for (let i = 0; i < config.players; i++) {
        players.push({
            id: `sock-${i}`,
            name: `bot${i}`,
            x: (rng() - 0.5) * config.extent,
            y: (rng() - 0.5) * config.extent,
            angle: 0,
            score: 0,
            velocityX: 0,
            velocityY: 0,
            health: 100,
            maxHealth: 100,
            damage: 10,
            inventory: [],
            loadout: [],
            level: 10,
            xp: 0,
            xpToNextLevel: 100,
            speed_boost: 1,
            inputs: { keys: [], useMouse: false },
        } as ServerPlayer);
    }

    let centipedeHead: string | undefined;
    for (let i = 0; i < config.mobs; i++) {
        const m = pick(rng);
        const id = `mob-${i}`;
        const isPet = rng() < config.petFraction;

        const enemy = makeEnemy({
            id,
            type: m.type as never,
            tier: m.tier as never,
            x: (rng() - 0.5) * config.extent,
            y: (rng() - 0.5) * config.extent,
            angle: rng() * Math.PI * 2,
            health: 100,
            maxHealth: 100,
            speed: m.type === 'ant_hole' ? 0 : 30 + rng() * 40,
            damage: 5,
        });
        enemy.aiType = m.ai;
        enemy.range = 500;
        if (isPet) enemy.ownerId = `sock-${Math.floor(rng() * config.players)}`;

        // Build a few real centipede chains so the chain passes have work.
        if (m.type === 'centipede') {
            if (!centipedeHead || rng() < 0.2) {
                centipedeHead = id;
                enemy.headId = id;
                enemy.segmentIndex = 0;
            } else {
                enemy.headId = centipedeHead;
                enemy.leaderId = centipedeHead;
                enemy.segmentIndex = 1;
            }
        }
        enemies.push(enemy);
    }

    return { players, enemies };
}

export interface HarnessResult {
    ticks: number;
    startingEntities: number;
    entities: number;
    msPerTick: number;
    maxTickMs: number;
    heapMB: number;
    /** Non-finite / absurd coordinate detections. Must be zero. */
    badCoordinates: number;
    firstBadTick: number;
    /**
     * Live projectiles at the halfway point and at the end.
     *
     * These two numbers are the leak check. Mob volleys spawn projectile
     * entities continuously, and only flight/collision retire them — with either
     * missing the population grows without bound, which drags
     * `grid.ensureStampCapacity` up with it every tick. A healthy run reaches a
     * steady state, so the two counts should be in the same ballpark.
     */
    projectilesMid: number;
    projectilesEnd: number;
    /** Mob projectiles that connected with a player over the run. */
    playerHits: number;
    timings: Array<{ name: string; avgMs: number; maxMs: number }>;
}

/**
 * Refuse to run if importing the ECS has dragged in the game server.
 *
 * server.ts starts a LISTENING SERVER at module scope — it binds :3000, opens
 * the account database, spawns bots and schedules restarts. Two modules used to
 * pull it in transitively (server/physics.ts and petal_actions.ts), so merely
 * importing the ECS composition root booted a real server that then outlived
 * the harness, held the port, and served stale code to anyone who connected.
 *
 * That is a much worse failure than a broken benchmark, so it is checked rather
 * than assumed: if the module ever reappears in the require graph, fail loudly
 * here instead of silently starting a second server.
 */
function assertNoServerBooted(): void {
    const loaded = Object.keys(require.cache).filter(p =>
        /[/\\]dist[^/\\]*[/\\]server\.js$/.test(p));
    if (loaded.length > 0) {
        throw new Error(
            'The harness imported the game server (' + loaded.join(', ') + '). '
            + 'Something in the ECS import graph now pulls in server.ts, which binds a '
            + 'port and opens the database at module scope. Break that import before running.',
        );
    }
}

/** Stand-in for `(PLAYER_SIZE / 2) * sizeMultiplier`; the real one reads legacy state. */
const PLAYER_HIT_RADIUS = 25;

export function runTickHarness(config: HarnessConfig = DEFAULT_CONFIG): HarnessResult {
    assertNoServerBooted();
    const { players, enemies } = buildLegacyWorld(config);

    let netIdCounter = 0;
    let playerHits = 0;

    const runtime = createEcsRuntime({
        lookupPlayer: () => undefined,
        creditDamage: () => { /* attribution is exercised elsewhere */ },
        onEnemyDamaged: () => { /* broadcast batching is not under test here */ },
        onEnemyKilled: () => { /* drops/XP are not under test here */ },
        // Mirrors the real near-a-player test closely enough to exercise the
        // viewport pass: mobs within a viewport-ish radius of a player stay.
        isNearAnyPlayer: (x, y) => {
            for (let i = 0; i < players.length; i++) {
                const dx = players[i].x - x;
                const dy = players[i].y - y;
                if (dx * dx + dy * dy < 2200 * 2200) return true;
            }
            return false;
        },

        // --- projectiles ---------------------------------------------------
        // Wire ids and the player-side hooks are broadcast/legacy concerns; the
        // harness only needs them to be callable, since what is under test here
        // is that the systems compose without producing a bad coordinate.
        allocateProjectileNetId: () => ++netIdCounter,
        resolvePlayerEntity: (socketId) => runtime.world.lookup(socketId),
        playerRadiusOf: () => PLAYER_HIT_RADIUS,
        damageMultiplierOf: () => 1,
        onPlayerHit: () => { playerHits++; return true; },
        emitEnemyDamaged: () => { /* broadcast is not under test here */ },
        onProjectileKill: () => { /* drops/XP are not under test here */ },
    });

    const now0 = 1_000_000;
    importWorld(runtime.world, players, enemies, now0);

    const world = runtime.world;
    const positioned = world.query([C.Position]);
    const projectiles = world.query([C.IsProjectile]);
    // The viewport-status pass is now a real system (systems/viewport.ts), so
    // the harness no longer stands in for it. Mob lifetime here is whatever the
    // real near-a-player test decides.

    let badCoordinates = 0;
    let firstBadTick = -1;
    let maxTickMs = 0;
    let projectilesMid = 0;

    runtime.scheduler.profiling = true;
    // Projectiles run on their own scheduler; without this they are absent from
    // the tick-budget report entirely.
    runtime.projectileScheduler.profiling = true;

    const startingEntities = world.size();

    // Warm up the JIT before timing.
    for (let t = 0; t < 60; t++) {
        const now = now0 + t * (1000 / 30);
        runtime.tick(1 / 30, 1000 / 30, now);
        runtime.tickProjectiles(1000 / 30, now);
    }
    runtime.scheduler.drainTimings();
    runtime.projectileScheduler.drainTimings();

    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();

    for (let t = 0; t < config.ticks; t++) {
        const now = now0 + (60 + t) * (1000 / 30);
        const tickStart = performance.now();
        runtime.tick(1 / 30, 1000 / 30, now);
        // Exactly once per simulation step, with the real elapsed time — the
        // same split server.ts uses. Mob volleys leak entities forever without
        // it, because flight is what retires a projectile.
        runtime.tickProjectiles(1000 / 30, now);
        const elapsed = performance.now() - tickStart;
        if (elapsed > maxTickMs) maxTickMs = elapsed;
        if (t === (config.ticks >> 1)) projectilesMid = projectiles.count();

        // The composition check: nothing may drift to a coordinate that breaks
        // the grid loops or renders as NaN.
        positioned.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            for (let i = 0; i < chunk.count; i++) {
                const x = pos.x[i];
                const y = pos.y[i];
                if (!Number.isFinite(x) || !Number.isFinite(y)
                    || Math.abs(x) > MAX_SANE_WORLD_COORD_LIMIT
                    || Math.abs(y) > MAX_SANE_WORLD_COORD_LIMIT) {
                    badCoordinates++;
                    if (firstBadTick < 0) firstBadTick = t;
                }
            }
        });
    }

    const totalMs = performance.now() - started;
    const heapMB = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);

    const timings = [...runtime.scheduler.drainTimings(), ...runtime.projectileScheduler.drainTimings()]
        .map(t => ({ name: t.name, avgMs: t.avgMs, maxMs: t.maxMs }))
        .sort((a, b) => b.avgMs - a.avgMs);

    return {
        ticks: config.ticks,
        startingEntities,
        entities: world.size(),
        msPerTick: totalMs / config.ticks,
        maxTickMs,
        heapMB,
        badCoordinates,
        firstBadTick,
        projectilesMid,
        projectilesEnd: projectiles.count(),
        playerHits,
        timings,
    };
}

/** Console entry point. */
export function main(): void {
    console.log('ECS tick harness — full scheduler over a populated world\n');

    const result = runTickHarness();

    console.log(`entities:      ${result.startingEntities} at start -> ${result.entities} after the run`);
    console.log(`ticks:         ${result.ticks}`);
    console.log(`mean tick:     ${result.msPerTick.toFixed(3)} ms   (budget 33.3 ms at 30Hz)`);
    console.log(`worst tick:    ${result.maxTickMs.toFixed(3)} ms`);
    console.log(`heap growth:   ${result.heapMB.toFixed(1)} MB over the run`);
    console.log(`bad coords:    ${result.badCoordinates}${result.firstBadTick >= 0 ? ` (first at tick ${result.firstBadTick})` : ''}`);
    console.log(`projectiles:   ${result.projectilesMid} at half-way -> ${result.projectilesEnd} at the end   (${result.playerHits} player hits)`);
    console.log('\nper-system (mean ms/call, slowest first):');
    for (const t of result.timings) {
        console.log(`  ${t.name.padEnd(22)} ${t.avgMs.toFixed(4)}   max ${t.maxMs.toFixed(3)}`);
    }

    if (result.badCoordinates > 0) {
        console.error('\nFAIL: entities reached non-finite or absurd coordinates.');
        process.exitCode = 1;
        return;
    }
    if (result.msPerTick > 33.3) {
        console.error('\nFAIL: mean tick exceeds the 30Hz budget.');
        process.exitCode = 1;
        return;
    }
    // Projectiles must reach a steady state. Unbounded growth means nothing is
    // retiring them, which also grows grid.ensureStampCapacity every tick.
    if (result.projectilesEnd > result.projectilesMid * 2 + 100) {
        console.error('\nFAIL: projectile population is still growing — they are not being retired.');
        process.exitCode = 1;
        return;
    }
    console.log('\nOK: simulation stable, within tick budget.');
}
