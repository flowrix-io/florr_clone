"use strict";
/**
 * Self-test for the game systems and prefabs.
 *
 * Each case sets up a small world, runs real scheduler ticks, and asserts the
 * observable outcome — the point being to pin the ported BEHAVIOUR (unit
 * conventions, expiry thresholds, the order death is processed in) rather than
 * the implementation.
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
exports.Phase = void 0;
exports.runSystemsSelfTest = runSystemsSelfTest;
const C = __importStar(require("../components"));
const system_1 = require("../system");
Object.defineProperty(exports, "Phase", { enumerable: true, get: function () { return system_1.Phase; } });
const world_1 = require("../world");
const prefabs_1 = require("../prefabs");
const movement_1 = require("./movement");
const afflictions_1 = require("./afflictions");
const lifetime_1 = require("./lifetime");
const TICK_SECONDS = 1 / 30;
const TICK_MS = 1000 / 30;
function runSystemsSelfTest() {
    const failures = [];
    const check = (name, condition, detail) => {
        if (!condition)
            failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name, actual, expected) => {
        if (actual !== expected)
            failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    const checkClose = (name, actual, expected, tolerance = 1e-4) => {
        if (Math.abs(actual - expected) > tolerance) {
            failures.push(`${name}: expected ~${expected}, got ${actual}`);
        }
    };
    /** A world with every system registered, plus a clock the test advances. */
    function makeHarness() {
        const world = new world_1.World();
        const scheduler = new system_1.Scheduler(world);
        (0, movement_1.registerMovementSystems)(scheduler, (0, movement_1.createMovementQueries)(world));
        (0, afflictions_1.registerAfflictionSystems)(scheduler, (0, afflictions_1.createAfflictionQueries)(world));
        (0, lifetime_1.registerLifetimeSystems)(scheduler, (0, lifetime_1.createLifetimeQueries)(world));
        let now = 10000;
        return {
            world,
            scheduler,
            get now() { return now; },
            tick(times = 1) {
                for (let i = 0; i < times; i++) {
                    now += TICK_MS;
                    scheduler.tick(TICK_SECONDS, TICK_MS, now);
                }
            },
        };
    }
    // -- projectile flight ----------------------------------------------------
    {
        const h = makeHarness();
        const shooter = h.world.create();
        // Fired straight along +X at 1 px/ms, so after one 33.3ms tick it has
        // travelled exactly one tick's worth. Speed being per-MILLISECOND is the
        // existing convention and the thing most likely to be broken by a port.
        const p = (0, prefabs_1.spawnProjectile)(h.world, {
            x: 0, y: 0, angle: 0, speed: 1, maxDistance: 100,
            damage: 5, health: 1, size: 2,
            petalType: 'basic', petalRarity: 'common',
            shooter, fromPlayer: true, now: h.now,
        });
        h.tick();
        checkClose('projectile advances speed*deltaMs', h.world.get(p, C.Position, 'x'), TICK_MS, 1e-3);
        checkClose('projectile y unchanged on +X heading', h.world.get(p, C.Position, 'y'), 0, 1e-6);
        checkClose('projectile accumulates distance', h.world.get(p, C.Projectile, 'distance'), TICK_MS, 1e-2);
        // 100px at 1px/ms is 100ms — exactly 3 ticks of 33.33ms. So it is still
        // alive after 2 (66.7px) and retires on the 3rd, when distance reaches
        // maxDistance exactly and the >= test fires.
        h.tick();
        check('projectile survives just under max distance', h.world.isAlive(p));
        h.tick();
        check('projectile retires at max distance', !h.world.isAlive(p));
    }
    // -- angled flight --------------------------------------------------------
    {
        const h = makeHarness();
        const shooter = h.world.create();
        const p = (0, prefabs_1.spawnProjectile)(h.world, {
            x: 100, y: 100, angle: Math.PI / 2, speed: 0.5, maxDistance: 10000,
            damage: 1, health: 1, size: 1,
            petalType: 'basic', petalRarity: 'common',
            shooter, fromPlayer: false, now: h.now,
        });
        h.tick();
        const expected = 0.5 * TICK_MS;
        checkClose('angled projectile x holds', h.world.get(p, C.Position, 'x'), 100, 1e-3);
        checkClose('angled projectile y advances', h.world.get(p, C.Position, 'y'), 100 + expected, 1e-3);
    }
    // -- projectile origin survives the shooter -------------------------------
    {
        const h = makeHarness();
        const shooter = (0, prefabs_1.spawnMob)(h.world, {
            id: 'shooter-1', type: 'hornet', tier: 'rare', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 50, damage: 5, radius: 20, now: h.now,
        });
        const p = (0, prefabs_1.spawnProjectile)(h.world, {
            x: 0, y: 0, angle: 0, speed: 0.1, maxDistance: 10000,
            damage: 5, health: 1, size: 2,
            petalType: 'stinger', petalRarity: 'rare',
            shooter, sourceType: 'hornet', sourceTier: 'rare',
            fromPlayer: false, now: h.now,
        });
        h.world.destroy(shooter);
        h.tick();
        check('projectile outlives its shooter', h.world.isAlive(p));
        check('dead shooter handle is detectable', !h.world.isAlive(h.world.get(p, C.ProjectileOrigin, 'shooter')));
        // The stamped source is what kill attribution reads once the shooter is gone.
        checkEqual('stamped source tier survives', h.world.get(p, C.ProjectileOrigin, 'sourceTier'), 2);
    }
    // NOTE: passive mob drift used to be tested here against a dt-scaled
    // friction integrator in movement.ts. That system was wrong — the real
    // gardn passive step is per-tick with a state-machine acceleration — and
    // has been replaced by systems/enemyPassive.ts, which is covered by
    // enemyAI_self_test.ts.
    // -- poison stacks --------------------------------------------------------
    {
        const h = makeHarness();
        const victim = (0, prefabs_1.spawnMob)(h.world, {
            id: 'victim', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 100, maxHealth: 100, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        const attacker = h.world.create();
        // Two stacks from the same attacker, as several petals can poison at once.
        for (let i = 0; i < 2; i++) {
            const stack = h.world.create();
            h.world.add(stack, C.PoisonStack, {
                target: victim, source: attacker,
                damagePerMs: 0.1, endTime: h.now + 10000,
            });
        }
        h.tick();
        // Two stacks at 0.1 dmg/ms over one 33.3ms tick = ~6.67 damage.
        checkClose('both stacks damage the victim', h.world.get(victim, C.Health, 'current'), 100 - 2 * 0.1 * TICK_MS, 0.01);
        checkEqual('stacks persist while active', h.world.query([C.PoisonStack]).count(), 2);
    }
    // -- poison lapses and orphaning ------------------------------------------
    {
        const h = makeHarness();
        const victim = (0, prefabs_1.spawnMob)(h.world, {
            id: 'v2', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 100, maxHealth: 100, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        const lapsing = h.world.create();
        h.world.add(lapsing, C.PoisonStack, {
            target: victim, source: h.world.create(),
            damagePerMs: 0.01, endTime: h.now + TICK_MS * 2,
        });
        h.tick(3);
        checkEqual('lapsed stack is destroyed', h.world.query([C.PoisonStack]).count(), 0);
        check('victim survived a weak poison', h.world.isAlive(victim));
        // A stack whose victim dies must retire rather than apply to whatever
        // recycles the slot.
        const orphan = h.world.create();
        h.world.add(orphan, C.PoisonStack, {
            target: victim, source: h.world.create(),
            damagePerMs: 0.01, endTime: h.now + 100000,
        });
        h.world.destroy(victim);
        h.tick();
        checkEqual('orphaned stack is destroyed', h.world.query([C.PoisonStack]).count(), 0);
    }
    // -- poison kills and the reaper ------------------------------------------
    {
        const h = makeHarness();
        const doomed = (0, prefabs_1.spawnMob)(h.world, {
            id: 'doomed', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 1, maxHealth: 1, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        const stack = h.world.create();
        h.world.add(stack, C.PoisonStack, {
            target: doomed, source: h.world.create(),
            damagePerMs: 5, endTime: h.now + 100000,
        });
        h.tick();
        // Combat marks it dead; the Lifetime reaper destroys it in the same tick.
        check('poison kill is reaped', !h.world.isAlive(doomed));
        // The stack itself retires on the FOLLOWING tick, when it next looks at
        // its now-dead target. That one-tick lag is harmless (a stack with no
        // live victim applies no damage) and is the price of never mutating the
        // world mid-iteration.
        checkEqual('stack still queued the tick its victim died', h.world.query([C.PoisonStack]).count(), 1);
        h.tick();
        checkEqual('stack retires the tick after its victim died', h.world.query([C.PoisonStack]).count(), 0);
    }
    // -- player poison --------------------------------------------------------
    {
        const h = makeHarness();
        const player = (0, prefabs_1.spawnPlayer)(h.world, {
            socketId: 'sock-1', name: 'p', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: h.now,
        });
        h.world.add(player, C.Poisoned, {
            damagePerSecond: 30, until: h.now + TICK_MS * 2,
            sourceType: 0, sourceTier: 0,
        });
        h.tick();
        // Player poison is per SECOND, unlike mob stacks' per-millisecond.
        checkClose('player poison ticks per second', h.world.get(player, C.Health, 'current'), 100 - 30 * TICK_SECONDS, 0.01);
        h.tick(3);
        check('lapsed player poison is removed', !h.world.has(player, C.Poisoned));
        check('player survived', h.world.isAlive(player));
    }
    // -- slows ----------------------------------------------------------------
    {
        const h = makeHarness();
        const mob = (0, prefabs_1.spawnMob)(h.world, {
            id: 'slowed', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 200, damage: 1, radius: 10, now: h.now,
        });
        // A slow scales current down; base is untouched.
        h.world.set(mob, C.Speed, 'current', 100);
        h.world.add(mob, C.Slowed, { until: h.now + TICK_MS * 2 });
        h.tick();
        checkEqual('slow holds while active', h.world.get(mob, C.Speed, 'current'), 100);
        check('slowed component present', h.world.has(mob, C.Slowed));
        h.tick(3);
        checkEqual('speed restored from base', h.world.get(mob, C.Speed, 'current'), 200);
        check('slow component removed', !h.world.has(mob, C.Slowed));
    }
    // -- ground effects expire ------------------------------------------------
    {
        const h = makeHarness();
        const owner = h.world.create();
        const pollen = (0, prefabs_1.spawnGroundPollen)(h.world, {
            x: 0, y: 0, owner, damage: 10, radius: 50,
            rarity: 'rare', expiresAt: h.now + TICK_MS * 2,
        });
        const web = (0, prefabs_1.spawnWebField)(h.world, {
            x: 0, y: 0, owner, radius: 60,
            rarity: 'rare', expiresAt: h.now + 100000,
        });
        h.tick();
        check('pollen alive before deadline', h.world.isAlive(pollen));
        h.tick(3);
        check('pollen expires on deadline', !h.world.isAlive(pollen));
        check('web with a later deadline survives', h.world.isAlive(web));
    }
    // -- unseen despawn -------------------------------------------------------
    {
        const h = makeHarness();
        const seen = (0, prefabs_1.spawnMob)(h.world, {
            id: 'seen', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        const unseen = (0, prefabs_1.spawnMob)(h.world, {
            id: 'unseen', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        // Backdate the unseen mob past the threshold.
        h.world.set(unseen, C.ViewportTracked, 'lastInViewport', h.now - lifetime_1.UNSEEN_DESPAWN_MS - 1000);
        // The sweep is strided (interval 5), so it needs several ticks to fire.
        h.tick(6);
        check('unseen mob despawns', !h.world.isAlive(unseen));
        check('recently seen mob survives', h.world.isAlive(seen));
    }
    // -- prefab archetypes ----------------------------------------------------
    {
        const world = new world_1.World();
        const now = 0;
        const mob = (0, prefabs_1.spawnMob)(world, {
            id: 'm', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 50, damage: 1, radius: 10, now,
        });
        const player = (0, prefabs_1.spawnPlayer)(world, {
            socketId: 's', name: 'p', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now,
        });
        const lobby = (0, prefabs_1.spawnPlayer)(world, {
            socketId: 's2', name: 'lobby', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], lobby: true, now,
        });
        // A plain mob must NOT carry the optional behaviour components — that is
        // what keeps the common archetype narrow and the AI passes small.
        check('plain mob has no Wander', !world.has(mob, C.Wander));
        check('plain mob has no PetOwner', !world.has(mob, C.PetOwner));
        check('plain mob has no PassiveMotion', !world.has(mob, C.PassiveMotion));
        check('mob is viewport tracked', world.has(mob, C.ViewportTracked));
        check('player is not an enemy', !world.has(player, C.IsEnemy));
        check('lobby player is tagged', world.has(lobby, C.IsLobby));
        check('world player is not tagged lobby', !world.has(player, C.IsLobby));
        // The lobby guarantee: world queries must not see title-screen players.
        checkEqual('world player query excludes lobby', world.query([C.IsPlayer], [C.IsLobby]).count(), 1);
        checkEqual('mob resolves by id', world.lookup('m'), mob);
        checkEqual('player resolves by socket id', world.lookup('s'), player);
    }
    // -- scheduler phase ordering across the real systems ---------------------
    {
        const h = makeHarness();
        const names = h.scheduler.names();
        const indexOf = (n) => names.indexOf(n);
        check('movement runs before combat', indexOf('projectileFlight') < indexOf('poisonStacks'));
        check('combat runs before lifetime', indexOf('poisonStacks') < indexOf('expiry'));
        check('reaper runs last in lifetime', indexOf('reaper') > indexOf('unseenDespawn'));
        check('reaper runs after expiry', indexOf('reaper') > indexOf('expiry'));
    }
    return failures;
}
