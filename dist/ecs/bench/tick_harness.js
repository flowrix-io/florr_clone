"use strict";
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
exports.TICK_BUDGET_MS = exports.DEFAULT_CONFIG = void 0;
exports.assertNoServerBooted = assertNoServerBooted;
exports.runTickHarness = runTickHarness;
exports.main = main;
const server_utils_1 = require("../../server_utils");
const ecsRuntime_1 = require("../../server/ecsRuntime");
const ecsBridge_1 = require("../../server/ecsBridge");
const C = __importStar(require("../components"));
const limits_1 = require("./limits");
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** A mix that exercises every AI branch the port touches. */
const MOB_MIX = [
    { type: 'bee', tier: 'common', ai: 'neutral', weight: 25 },
    { type: 'ladybug', tier: 'common', ai: 'passive', weight: 20 },
    { type: 'soldier_ant', tier: 'uncommon', ai: 'hostile', weight: 20 },
    { type: 'hornet', tier: 'rare', ai: 'hostile', weight: 15 },
    { type: 'mantis', tier: 'epic', ai: 'hostile', weight: 8 },
    { type: 'centipede', tier: 'rare', ai: 'neutral', weight: 5 },
    { type: 'ant_hole', tier: 'mythic', ai: 'passive', weight: 4 },
    { type: 'bee', tier: 'legendary', ai: 'neutral', weight: 3 },
];
function pick(rng) {
    const total = MOB_MIX.reduce((s, m) => s + m.weight, 0);
    let r = rng() * total;
    for (const m of MOB_MIX) {
        r -= m.weight;
        if (r <= 0)
            return m;
    }
    return MOB_MIX[0];
}
exports.DEFAULT_CONFIG = {
    mobs: 1400,
    players: 30,
    petFraction: 0.08,
    ticks: 2000,
    extent: 12000,
    seed: 20260810,
};
/** Build a legacy world, then let the bridge convert it. */
function buildLegacyWorld(config) {
    const rng = mulberry32(config.seed);
    const players = [];
    const enemies = [];
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
        });
    }
    let centipedeHead;
    for (let i = 0; i < config.mobs; i++) {
        const m = pick(rng);
        const id = `mob-${i}`;
        const isPet = rng() < config.petFraction;
        const enemy = (0, server_utils_1.makeEnemy)({
            id,
            type: m.type,
            tier: m.tier,
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
        if (isPet)
            enemy.ownerId = `sock-${Math.floor(rng() * config.players)}`;
        // Build a few real centipede chains so the chain passes have work.
        if (m.type === 'centipede') {
            if (!centipedeHead || rng() < 0.2) {
                centipedeHead = id;
                enemy.headId = id;
                enemy.segmentIndex = 0;
            }
            else {
                enemy.headId = centipedeHead;
                enemy.leaderId = centipedeHead;
                enemy.segmentIndex = 1;
            }
        }
        enemies.push(enemy);
    }
    return { players, enemies };
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
function assertNoServerBooted() {
    const loaded = Object.keys(require.cache).filter(p => /[/\\]dist[^/\\]*[/\\]server\.js$/.test(p));
    if (loaded.length > 0) {
        throw new Error('The harness imported the game server (' + loaded.join(', ') + '). '
            + 'Something in the ECS import graph now pulls in server.ts, which binds a '
            + 'port and opens the database at module scope. Break that import before running.');
    }
}
/** Stand-in for `(PLAYER_SIZE / 2) * sizeMultiplier`; the real one reads legacy state. */
const PLAYER_HIT_RADIUS = 25;
/** One tick at 30Hz. Every timing assertion below is against this and nothing else. */
exports.TICK_BUDGET_MS = 1000 / 30;
/**
 * The `q`th percentile of `sorted` by nearest-rank, which is the conservative
 * choice: with 2000 samples p99 is the 20th-worst tick, and no interpolation
 * smooths a spike away.
 */
function percentile(sorted, q) {
    if (sorted.length === 0)
        return 0;
    const rank = Math.ceil(q * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
function runTickHarness(config = exports.DEFAULT_CONFIG) {
    assertNoServerBooted();
    const { players, enemies } = buildLegacyWorld(config);
    let netIdCounter = 0;
    let playerHits = 0;
    const runtime = (0, ecsRuntime_1.createEcsRuntime)({
        lookupPlayer: () => undefined,
        // Harness drives the schedulers directly; the pipeline is the game\'s.
        runPlayerPipeline: () => { },
        creditDamage: () => { },
        onEnemyDamaged: () => { },
        onEnemyKilled: () => { },
        // Mirrors the real near-a-player test closely enough to exercise the
        // viewport pass: mobs within a viewport-ish radius of a player stay.
        isNearAnyPlayer: (x, y) => {
            for (let i = 0; i < players.length; i++) {
                const dx = players[i].x - x;
                const dy = players[i].y - y;
                if (dx * dx + dy * dy < 2200 * 2200)
                    return true;
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
        emitEnemyDamaged: () => { },
        onProjectileKill: () => { },
    });
    const now0 = 1000000;
    (0, ecsBridge_1.importWorld)(runtime.world, players, enemies, now0);
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
    // Every tick is kept, not just the worst: the distribution is the finding.
    // The array is pre-sized so the sampling never itself allocates mid-run.
    const tickMs = new Array(config.ticks).fill(0);
    runtime.scheduler.profiling = true;
    // Projectiles and players run on their own schedulers; without these they
    // are absent from the tick-budget report entirely.
    runtime.projectileScheduler.profiling = true;
    runtime.playerScheduler.profiling = true;
    const startingEntities = world.size();
    // Warm up the JIT before timing.
    for (let t = 0; t < 60; t++) {
        const now = now0 + t * (1000 / 30);
        // Players first, matching runSimulationStep: the movement window opens
        // before the mob tick, not inside it.
        runtime.tickPlayers(1 / 30, 1000 / 30, now);
        runtime.tick(1 / 30, 1000 / 30, now);
        runtime.tickProjectiles(1000 / 30, now);
    }
    runtime.scheduler.drainTimings();
    runtime.projectileScheduler.drainTimings();
    runtime.playerScheduler.drainTimings();
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    for (let t = 0; t < config.ticks; t++) {
        const now = now0 + (60 + t) * (1000 / 30);
        const tickStart = performance.now();
        runtime.tickPlayers(1 / 30, 1000 / 30, now);
        runtime.tick(1 / 30, 1000 / 30, now);
        // Exactly once per simulation step, with the real elapsed time — the
        // same split server.ts uses. Mob volleys leak entities forever without
        // it, because flight is what retires a projectile.
        runtime.tickProjectiles(1000 / 30, now);
        const elapsed = performance.now() - tickStart;
        tickMs[t] = elapsed;
        if (elapsed > maxTickMs)
            maxTickMs = elapsed;
        if (t === (config.ticks >> 1))
            projectilesMid = projectiles.count();
        // The composition check: nothing may drift to a coordinate that breaks
        // the grid loops or renders as NaN.
        positioned.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            for (let i = 0; i < chunk.count; i++) {
                const x = pos.x[i];
                const y = pos.y[i];
                if (!Number.isFinite(x) || !Number.isFinite(y)
                    || Math.abs(x) > limits_1.MAX_SANE_WORLD_COORD_LIMIT
                    || Math.abs(y) > limits_1.MAX_SANE_WORLD_COORD_LIMIT) {
                    badCoordinates++;
                    if (firstBadTick < 0)
                        firstBadTick = t;
                }
            }
        });
    }
    const totalMs = performance.now() - started;
    const heapMB = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);
    // Sorted after the run, never during it — sorting inside the loop would add
    // its own cost to the very samples being measured.
    const sortedTicks = tickMs.slice().sort((a, b) => a - b);
    let overBudgetTicks = 0;
    for (let i = sortedTicks.length - 1; i >= 0; i--) {
        if (sortedTicks[i] <= exports.TICK_BUDGET_MS)
            break;
        overBudgetTicks++;
    }
    const timings = [
        ...runtime.scheduler.drainTimings(),
        ...runtime.projectileScheduler.drainTimings(),
        ...runtime.playerScheduler.drainTimings(),
    ]
        .map(t => ({ name: t.name, avgMs: t.avgMs, maxMs: t.maxMs }))
        .sort((a, b) => b.avgMs - a.avgMs);
    return {
        ticks: config.ticks,
        startingEntities,
        entities: world.size(),
        msPerTick: totalMs / config.ticks,
        maxTickMs,
        p50TickMs: percentile(sortedTicks, 0.50),
        p95TickMs: percentile(sortedTicks, 0.95),
        p99TickMs: percentile(sortedTicks, 0.99),
        overBudgetTicks,
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
function main() {
    console.log('ECS tick harness — full scheduler over a populated world\n');
    const result = runTickHarness();
    console.log(`entities:      ${result.startingEntities} at start -> ${result.entities} after the run`);
    console.log(`ticks:         ${result.ticks}`);
    console.log(`mean tick:     ${result.msPerTick.toFixed(3)} ms   (budget ${exports.TICK_BUDGET_MS.toFixed(1)} ms at 30Hz)`);
    console.log(`tick p50/p95:  ${result.p50TickMs.toFixed(3)} / ${result.p95TickMs.toFixed(3)} ms`);
    console.log(`tick p99:      ${result.p99TickMs.toFixed(3)} ms   <- asserted`);
    console.log(`worst tick:    ${result.maxTickMs.toFixed(3)} ms   (reported, not asserted)`);
    console.log(`over budget:   ${result.overBudgetTicks} of ${result.ticks} ticks `
        + `(${(100 * result.overBudgetTicks / result.ticks).toFixed(2)}%)`);
    console.log(`heap growth:   ${result.heapMB.toFixed(1)} MB over the run`);
    console.log(`bad coords:    ${result.badCoordinates}${result.firstBadTick >= 0 ? ` (first at tick ${result.firstBadTick})` : ''}`);
    console.log(`projectiles:   ${result.projectilesMid} at half-way -> ${result.projectilesEnd} at the end   (${result.playerHits} player hits)`);
    console.log('\nper-system (mean ms/call, slowest first):');
    for (const t of result.timings) {
        console.log(`  ${t.name.padEnd(22)} ${t.avgMs.toFixed(4)}   max ${t.maxMs.toFixed(3)}`);
    }
    // Collected rather than returned on: a run that both spikes and leaks should
    // report both, and stopping at the first finding is how the mean-only
    // assertion managed to hide everything behind it for so long.
    const failures = [];
    if (result.badCoordinates > 0) {
        failures.push('entities reached non-finite or absurd coordinates.');
    }
    if (result.msPerTick > exports.TICK_BUDGET_MS) {
        failures.push(`mean tick ${result.msPerTick.toFixed(3)} ms exceeds the `
            + `${exports.TICK_BUDGET_MS.toFixed(1)} ms budget.`);
    }
    // The assertion the mean cannot make. p99 over budget means roughly one
    // stuttering tick every three seconds of play, for every player on the box.
    if (result.p99TickMs > exports.TICK_BUDGET_MS) {
        failures.push(`p99 tick ${result.p99TickMs.toFixed(3)} ms exceeds the `
            + `${exports.TICK_BUDGET_MS.toFixed(1)} ms budget — one tick in a hundred stutters.`);
    }
    // And the assertion p99 cannot make. 2000 ticks hide twenty spikes below
    // p99, so a run can drop frames repeatedly with a healthy p99. There is no
    // budget under which a 100ms tick is fine; if this fires, find the spike
    // rather than raising the number.
    //
    // Reading the per-system table when it does fire: a spike belonging to ONE
    // system shows up as that system's `max` accounting for the whole overshoot
    // while every other system's max stays at its usual value — that is an
    // algorithmic outlier and it is fixable in that system. A spike where the
    // two heaviest systems are BOTH elevated and their maxes sum to roughly the
    // whole tick is a process-wide stall (GC, compaction) that happened to
    // straddle them; the lead there is the run's heap growth, not the systems.
    // The worst tick is REPORTED, never asserted on.
    //
    // It was briefly a hard failure, and both reviewers rejected that for the
    // right reason: the max is exactly the quantity that spikes, so asserting on
    // it turns a required gate into a coin flip. A gate that fails at random is
    // worse than one that is too lenient — it trains everyone to ignore the
    // gate, and then it stops catching the thing it was added for. p99 above is
    // the stable statistic and it is the one that fails the build.
    if (result.maxTickMs > exports.TICK_BUDGET_MS) {
        console.warn(`\n  NOTE: worst tick ${result.maxTickMs.toFixed(3)} ms exceeded the `
            + `${exports.TICK_BUDGET_MS.toFixed(1)} ms budget (${result.overBudgetTicks} tick(s) over) — `
            + Math.ceil(result.maxTickMs / exports.TICK_BUDGET_MS) + ' frame(s) dropped in one go.\n'
            + '  Not a failure: single spikes are usually GC. If p99 is also near '
            + 'budget, or the per-system maxes show ONE system elevated, it is '
            + 'algorithmic and worth chasing.');
    }
    // Projectiles must reach a steady state. Unbounded growth means nothing is
    // retiring them, which also grows grid.ensureStampCapacity every tick.
    if (result.projectilesEnd > result.projectilesMid * 2 + 100) {
        failures.push('projectile population is still growing — they are not being retired.');
    }
    if (failures.length > 0) {
        console.error(`\n${failures.length} FAILURE(S):`);
        for (const f of failures)
            console.error('  FAIL: ' + f);
        process.exitCode = 1;
        return;
    }
    console.log('\nOK: simulation stable, mean and p99 within budget.');
}
