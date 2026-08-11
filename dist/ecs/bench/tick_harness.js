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
exports.DEFAULT_CONFIG = void 0;
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
function runTickHarness(config = exports.DEFAULT_CONFIG) {
    const { players, enemies } = buildLegacyWorld(config);
    const runtime = (0, ecsRuntime_1.createEcsRuntime)({
        lookupPlayer: () => undefined,
        creditDamage: () => { },
        onEnemyDamaged: () => { },
        onEnemyKilled: () => { },
    });
    const now0 = 1000000;
    (0, ecsBridge_1.importWorld)(runtime.world, players, enemies, now0);
    const world = runtime.world;
    const positioned = world.query([C.Position]);
    // The viewport-status pass is NOT ported yet. Without it nothing refreshes
    // ViewportTracked, so unseenDespawn reaps every mob at the 30-second mark
    // and the rest of the run measures an almost-empty world. Standing in for
    // it here keeps the population realistic; remove this once the real pass
    // exists.
    const tracked = world.query([C.ViewportTracked]);
    const refreshViewport = (now) => {
        tracked.chunks(chunk => {
            const v = chunk.cols(C.ViewportTracked);
            for (let i = 0; i < chunk.count; i++)
                v.lastInViewport[i] = now;
        });
    };
    let badCoordinates = 0;
    let firstBadTick = -1;
    let maxTickMs = 0;
    runtime.scheduler.profiling = true;
    const startingEntities = world.size();
    // Warm up the JIT before timing.
    for (let t = 0; t < 60; t++) {
        const now = now0 + t * (1000 / 30);
        refreshViewport(now);
        runtime.tick(1 / 30, 1000 / 30, now);
    }
    runtime.scheduler.drainTimings();
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    for (let t = 0; t < config.ticks; t++) {
        const now = now0 + (60 + t) * (1000 / 30);
        refreshViewport(now);
        const tickStart = performance.now();
        runtime.tick(1 / 30, 1000 / 30, now);
        const elapsed = performance.now() - tickStart;
        if (elapsed > maxTickMs)
            maxTickMs = elapsed;
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
    const timings = runtime.scheduler.drainTimings()
        .map(t => ({ name: t.name, avgMs: t.avgMs, maxMs: t.maxMs }));
    return {
        ticks: config.ticks,
        startingEntities,
        entities: world.size(),
        msPerTick: totalMs / config.ticks,
        maxTickMs,
        heapMB,
        badCoordinates,
        firstBadTick,
        timings,
    };
}
/** Console entry point. */
function main() {
    console.log('ECS tick harness — full scheduler over a populated world\n');
    const result = runTickHarness();
    console.log(`entities:      ${result.startingEntities} at start -> ${result.entities} after the run`);
    console.log(`ticks:         ${result.ticks}`);
    console.log(`mean tick:     ${result.msPerTick.toFixed(3)} ms   (budget 33.3 ms at 30Hz)`);
    console.log(`worst tick:    ${result.maxTickMs.toFixed(3)} ms`);
    console.log(`heap growth:   ${result.heapMB.toFixed(1)} MB over the run`);
    console.log(`bad coords:    ${result.badCoordinates}${result.firstBadTick >= 0 ? ` (first at tick ${result.firstBadTick})` : ''}`);
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
    console.log('\nOK: simulation stable, within tick budget.');
}
