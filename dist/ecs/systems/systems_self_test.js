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
const droppedItems_1 = require("./droppedItems");
const movement_1 = require("./movement");
const afflictions_1 = require("./afflictions");
const lifetime_1 = require("./lifetime");
const interning_1 = require("../interning");
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
        /** Hook-call log: [kind, entity] pairs the tests assert against. */
        const hookCalls = [];
        // No walls in these worlds: the wall test is exercised by
        // projectileCollision_self_test.ts, which stubs a real one.
        (0, movement_1.registerMovementSystems)(scheduler, (0, movement_1.createMovementQueries)(world), { hitsWall: () => false });
        (0, afflictions_1.registerAfflictionSystems)(scheduler, (0, afflictions_1.createAfflictionQueries)(world), {
            mobPoison: {
                creditDamage: (victim) => { hookCalls.push({ kind: 'credit', entity: victim }); },
                markPoisonDamaged: (victim) => { hookCalls.push({ kind: 'poisonDamaged', entity: victim }); },
                // What the live hook achieves through the legacy shell splice +
                // registry drain: the victim stops existing to the simulation.
                onPoisonKill: (victim) => {
                    hookCalls.push({ kind: 'poisonKill', entity: victim });
                    if (!world.has(victim, C.IsDead))
                        world.add(victim, C.IsDead);
                },
            },
            playerPoison: {
                tickPoison: (player) => { hookCalls.push({ kind: 'tickPoison', entity: player }); },
                onPoisonLapsed: (player) => { hookCalls.push({ kind: 'poisonLapsed', entity: player }); },
            },
        });
        (0, lifetime_1.registerLifetimeSystems)(scheduler, (0, lifetime_1.createLifetimeQueries)(world), {
            // No exemptions and no legacy shells in these worlds: despawn and
            // reap are plain entity destruction, which is what the live hooks'
            // registry drain amounts to once the shell is gone.
            neverDespawns: () => false,
            isProtectedAt: () => false,
            despawn: (entity) => { world.destroy(entity); },
            reap: (entity) => { world.destroy(entity); },
        });
        let now = 10000;
        return {
            world,
            scheduler,
            hookCalls,
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
            shooter, fromPlayer: true, netId: 1, now: h.now,
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
            shooter, fromPlayer: false, netId: 2, now: h.now,
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
            fromPlayer: false, netId: 3, now: h.now,
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
    // -- poison application: one stack per pair, outlast rule -----------------
    {
        const h = makeHarness();
        const stacks = h.world.query([C.PoisonStack]);
        const victim = (0, prefabs_1.spawnMob)(h.world, {
            id: 'v3', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 100, maxHealth: 100, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        const biterA = h.world.create();
        const biterB = h.world.create();
        (0, afflictions_1.applyPoisonStack)(h.world, stacks, victim, biterA, 0.005, h.now + 6000);
        (0, afflictions_1.applyPoisonStack)(h.world, stacks, victim, biterB, 0.001, h.now + 1000);
        checkEqual('one stack per (victim, source) pair', stacks.count(), 2);
        // gardn's rule: a short weak poison must NOT stomp a long strong one...
        (0, afflictions_1.applyPoisonStack)(h.world, stacks, victim, biterA, 0.001, h.now + 1000);
        let strong = 0;
        stacks.chunks(chunk => {
            const s = chunk.cols(C.PoisonStack);
            for (let i = 0; i < chunk.count; i++) {
                if (s.source[i] === biterA)
                    strong = s.damagePerMs[i];
            }
        });
        checkClose('a shorter bite does not replace a longer one', strong, 0.005, 1e-6);
        // ...but a bite that outlasts the ticking one takes over.
        (0, afflictions_1.applyPoisonStack)(h.world, stacks, victim, biterA, 0.002, h.now + 60000);
        stacks.chunks(chunk => {
            const s = chunk.cols(C.PoisonStack);
            for (let i = 0; i < chunk.count; i++) {
                if (s.source[i] === biterA)
                    strong = s.damagePerMs[i];
            }
        });
        checkClose('an outlasting bite takes over', strong, 0.002, 1e-6);
        checkEqual('refreshing never duplicates the stack', stacks.count(), 2);
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
    // The per-tick body (armor, the health write, death) is a legacy hook —
    // player health is still shell-owned. What the ECS owns, and what is
    // pinned here, is the visit set (only poisoned, living flowers) and the
    // expiry that removes the component and fires the lapse hook once.
    {
        const h = makeHarness();
        const player = (0, prefabs_1.spawnPlayer)(h.world, {
            socketId: 'sock-1', name: 'p', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: h.now,
        });
        const bystander = (0, prefabs_1.spawnPlayer)(h.world, {
            socketId: 'sock-2', name: 'b', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: h.now,
        });
        h.world.add(player, C.Poisoned, {
            damagePerSecond: 30, until: h.now + TICK_MS * 2,
            sourceType: 0, sourceTier: 0,
        });
        h.tick();
        checkEqual('poisoned flower is ticked', h.hookCalls.filter(c => c.kind === 'tickPoison' && c.entity === player).length, 1);
        check('unpoisoned flower is not visited', !h.hookCalls.some(c => c.kind === 'tickPoison' && c.entity === bystander));
        h.tick(3);
        check('lapsed player poison is removed', !h.world.has(player, C.Poisoned));
        checkEqual('lapse hook fires exactly once', h.hookCalls.filter(c => c.kind === 'poisonLapsed').length, 1);
        checkEqual('a lapsed poison stops ticking', h.hookCalls.filter(c => c.kind === 'tickPoison').length, 1);
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
    // -- mob timed despawn (despawnAt escorts) --------------------------------
    // Ground-effect and item expiry are pinned by their own suites; the mob
    // sweep is the one registered here, and it must NOT touch non-mob Expires
    // carriers — their removal emits belong to their own systems.
    {
        const h = makeHarness();
        const escort = (0, prefabs_1.spawnMob)(h.world, {
            id: 'escort', type: 'worker_ant', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        h.world.add(escort, C.Expires, { at: h.now + TICK_MS * 2 });
        const owner = h.world.create();
        const pollen = (0, prefabs_1.spawnGroundPollen)(h.world, {
            id: 'pollen_t', x: 0, y: 0, owner, damage: 10, radius: 50,
            rarity: 'rare', expiresAt: h.now + TICK_MS * 2,
        });
        const web = (0, prefabs_1.spawnWebField)(h.world, {
            id: 'web_t', x: 0, y: 0, owner, radius: 60,
            rarity: 'rare', expiresAt: h.now + TICK_MS * 2,
        });
        h.tick();
        check('escort alive before its deadline', h.world.isAlive(escort));
        h.tick(3);
        check('escort despawns on its deadline', !h.world.isAlive(escort));
        check('mob expiry leaves expired pollen to its own system', h.world.isAlive(pollen));
        check('mob expiry leaves expired webs to their own system', h.world.isAlive(web));
    }
    // -- dropped items: wall push, bounds, expiry -----------------------------
    {
        const world = new world_1.World();
        const scheduler = new system_1.Scheduler(world);
        const removed = [];
        (0, droppedItems_1.registerDroppedItemSystems)(scheduler, (0, droppedItems_1.createDroppedItemQueries)(world), {
            // Stand-in tile grid: nothing may sit left of x=10.
            resolveWall: (x, y) => ({ x: Math.max(x, 10), y }),
            isOutOfBounds: (x) => x > 1000,
            onRemoved: (e) => { removed.push(e); },
        });
        let now = 10000;
        const spawn = (id, x, expiresAt) => {
            const payload = { id, x, y: 0 };
            return (0, prefabs_1.spawnDroppedItem)(world, {
                id, x, y: 0, petalType: 0xffff, rarity: 'common',
                kind: 0, eligiblePlayers: undefined, pickedUpBy: undefined,
                payload, spawnTime: now, expiresAt,
            });
        };
        const walled = spawn('walled', 4, now + 100000);
        const oob = spawn('oob', 2000, now + 100000);
        const expiring = spawn('expiring', 500, now + TICK_MS * 2);
        const keeper = spawn('keeper', 500, now + 100000);
        for (let i = 0; i < 3; i++) {
            now += TICK_MS;
            scheduler.tick(TICK_SECONDS, TICK_MS, now);
        }
        checkEqual('item is pushed out of the wall', world.get(walled, C.Position, 'x'), 10);
        checkEqual('wall push mirrors onto the payload', world.get(walled, C.DroppedItem, 'payload').x, 10);
        check('out-of-bounds item is removed', !world.isAlive(oob));
        check('expired item is removed', !world.isAlive(expiring));
        check('a live in-bounds item survives', world.isAlive(keeper));
        checkEqual('each removal fires the emit hook once', removed.length, 2);
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
    // -- unseen despawn: exemptions and maze protection -----------------------
    {
        const world = new world_1.World();
        const scheduler = new system_1.Scheduler(world);
        const despawned = [];
        (0, lifetime_1.registerLifetimeSystems)(scheduler, (0, lifetime_1.createLifetimeQueries)(world), {
            // Stand-in for the boss-tier / target-dummy check.
            neverDespawns: (e) => world.get(e, C.MobKind, 'tier') === (0, interning_1.rarityToId)('ultra'),
            // Stand-in for "occupied maze": everything left of x=0 is protected.
            isProtectedAt: (x) => x < 0,
            despawn: (e) => { despawned.push(e); world.destroy(e); },
            reap: (e) => { world.destroy(e); },
        });
        let now = 10000;
        const spec = (id, x, tier) => ({
            id, type: 'bee', tier, x, y: 0,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius: 10, now,
        });
        const boss = (0, prefabs_1.spawnMob)(world, spec('boss', 10, 'ultra'));
        const protectedMob = (0, prefabs_1.spawnMob)(world, spec('mazemob', -10, 'common'));
        const plain = (0, prefabs_1.spawnMob)(world, spec('plain', 10, 'common'));
        for (const e of [boss, protectedMob, plain]) {
            world.set(e, C.ViewportTracked, 'lastInViewport', now - lifetime_1.UNSEEN_DESPAWN_MS - 1000);
        }
        for (let i = 0; i < 6; i++) {
            now += TICK_MS;
            scheduler.tick(TICK_SECONDS, TICK_MS, now);
        }
        check('exempt mob never despawns', world.isAlive(boss));
        check('protected mob is spared', world.isAlive(protectedMob));
        check('protection refreshes the timer, not just skips', world.get(protectedMob, C.ViewportTracked, 'lastInViewport') > now - 1000);
        check('plain unseen mob goes through the despawn hook', !world.isAlive(plain) && despawned.length === 1 && despawned[0] === plain);
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
        check('combat runs before lifetime', indexOf('poisonStacks') < indexOf('mobExpiry'));
        check('reaper runs last in lifetime', indexOf('reaper') > indexOf('unseenDespawn'));
        check('reaper runs after mob expiry', indexOf('reaper') > indexOf('mobExpiry'));
    }
    return failures;
}
