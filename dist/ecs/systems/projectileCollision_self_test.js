"use strict";
/**
 * Self-test for projectile flight, collision and damage.
 *
 * Every stat lookup and side effect is a stub, so each case isolates one ported
 * decision. The cases were chosen from the list of things that would silently
 * change behaviour if the port got them wrong rather than crash:
 *
 *   - the unit conventions (projectile speed is px/MILLISECOND)
 *   - the per-kind expiry ordering (mob after collisions, player before)
 *   - the DEAD-SHOOTER rule, which is the one place "resolve live" beats
 *     "stamp at spawn" and reads like a bug
 *   - exactly-once damage, including across the grid's fat insertion, where a
 *     missing dedup stamp is a silent 2-4x damage multiplier
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
exports.runProjectileCollisionSelfTest = runProjectileCollisionSelfTest;
const C = __importStar(require("../components"));
const entity_1 = require("../entity");
const grid_1 = require("../spatial/grid");
const prefabs_1 = require("../prefabs");
const system_1 = require("../system");
const world_1 = require("../world");
const movement_1 = require("./movement");
const projectileCollision_1 = require("./projectileCollision");
const TICK_MS = 1000 / 30;
const TICK_SECONDS = 1 / 30;
function runProjectileCollisionSelfTest() {
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
        if (!(Math.abs(actual - expected) <= tolerance)) {
            failures.push(`${name}: expected ~${expected}, got ${actual}`);
        }
    };
    function makeHarness(options = {}) {
        const world = new world_1.World();
        const scheduler = new system_1.Scheduler(world);
        const grid = new grid_1.SpatialGrid();
        const gridResult = new grid_1.GridQueryResult(64);
        const recorded = {
            playerHits: [],
            credits: [],
            immediateBroadcasts: 0,
            batchedBroadcasts: 0,
            kills: [],
        };
        const gridSource = world.query([C.Position, C.Radius, C.IsEnemy], [C.IsDead, C.PetOwner]);
        (0, movement_1.registerMovementSystems)(scheduler, (0, movement_1.createMovementQueries)(world), {
            hitsWall: (x, y) => (options.wallAt ? options.wallAt(x, y) : false),
        });
        const deps = {
            petalDamageOf: () => options.petalDamage,
            massOf: () => options.mass ?? 1,
            playerRadiusOf: () => options.playerRadius ?? 25,
            damageMultiplierOf: () => ('damageMultiplier' in options ? options.damageMultiplier : 1),
            onPlayerHit: (player, damage, kx, ky, source) => {
                recorded.playerHits.push({ player, damage, kx, ky, source });
                return !(options.playerDiesOnHit ?? false);
            },
            creditDamage: (victim, player, amount) => {
                recorded.credits.push({ victim, player, amount });
            },
            emitEnemyDamaged: () => { recorded.immediateBroadcasts++; },
            markEnemyDamaged: () => { recorded.batchedBroadcasts++; },
            onProjectileKill: (victim, killer, timing) => {
                recorded.kills.push({ victim, killer, timing });
            },
        };
        (0, projectileCollision_1.registerProjectileCollisionSystem)(scheduler, (0, projectileCollision_1.createProjectileCollisionQueries)(world), grid, gridResult, deps);
        let now = 10000;
        return {
            world,
            grid,
            recorded,
            get now() { return now; },
            tick(times = 1) {
                for (let i = 0; i < times; i++) {
                    now += TICK_MS;
                    // Mirrors EcsRuntime.tickProjectiles: the grid is refreshed
                    // so hit tests see where mobs actually are this tick.
                    grid.ensureStampCapacity(world.size() * 4 + 1024);
                    grid.rebuild(world, gridSource);
                    scheduler.tick(TICK_SECONDS, TICK_MS, now);
                }
            },
        };
    }
    let nextNetId = 1;
    function addMob(world, id, x, y, radius = 20, health = 100) {
        return (0, prefabs_1.spawnMob)(world, {
            id, type: 'hornet', tier: 'rare', x, y,
            health, maxHealth: health, speed: 50, damage: 5, radius, now: 0,
        });
    }
    function addPlayer(world, id, x, y) {
        return (0, prefabs_1.spawnPlayer)(world, {
            socketId: id, name: id, x, y,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: 0,
        });
    }
    function shoot(world, shooter, x, y, angle, fromPlayer, options = {}) {
        return (0, prefabs_1.spawnProjectile)(world, {
            x, y, angle,
            speed: options.speed ?? 0,
            maxDistance: options.maxDistance ?? 10000,
            damage: options.damage ?? 7,
            health: options.health ?? 10,
            // Radius is size*20/2, so size 2 is a 20px radius.
            size: options.size ?? 2,
            petalType: 'stinger',
            petalRarity: 'rare',
            shooter,
            sourceType: options.sourceType,
            sourceTier: options.sourceType === undefined ? undefined : 'rare',
            fromPlayer,
            netId: nextNetId++,
            now: 0,
        });
    }
    // =====================================================================
    // Units and wall stop
    // =====================================================================
    // -- speed is pixels per MILLISECOND -------------------------------------
    {
        const h = makeHarness();
        const shooter = h.world.create();
        const p = shoot(h.world, shooter, 0, 0, 0, true, { speed: 1 });
        h.tick();
        // 1 px/ms over a 33.3ms tick. Read as px/sec this would be 0.033px.
        checkClose('flight integrates speed * deltaMs', h.world.get(p, C.Position, 'x'), TICK_MS, 1e-3);
    }
    // -- a projectile stops at a wall ----------------------------------------
    {
        const h = makeHarness({ wallAt: (x) => x > 50 });
        const shooter = h.world.create();
        const p = shoot(h.world, shooter, 0, 0, 0, false, { speed: 1 });
        h.tick();
        check('projectile survives short of the wall', h.world.isAlive(p));
        h.tick(2);
        check('projectile is destroyed by a wall', !h.world.isAlive(p));
    }
    // =====================================================================
    // Mob projectile vs player
    // =====================================================================
    // -- hits once, is consumed, knocks back ---------------------------------
    {
        const h = makeHarness({ playerRadius: 25 });
        const shooter = addMob(h.world, 'shooter', -500, 0);
        const player = addPlayer(h.world, 'sock-1', 0, 0);
        // Radius 20 + player 25 = 45; sitting 30px away is a hit.
        const p = shoot(h.world, shooter, -30, 0, 0, false, { damage: 9, sourceType: 'hornet' });
        h.tick();
        checkEqual('mob projectile hits exactly one player', h.recorded.playerHits.length, 1);
        const hit = h.recorded.playerHits[0] ?? { player: entity_1.NULL_ENTITY, damage: -1, kx: -1, ky: -1, source: '' };
        checkEqual('hit reports the right player', hit.player, player);
        // The player path uses the STAMPED damage, not the petal table.
        checkEqual('player takes the stamped damage', hit.damage, 9);
        checkClose('knockback pushes along the impact normal', hit.kx, projectileCollision_1.PLAYER_KNOCKBACK_FORCE);
        checkClose('knockback has no lateral component', hit.ky, 0);
        checkEqual('source mob type survives to the hit', hit.source, 'hornet');
        check('projectile is consumed by the hit', !h.world.isAlive(p));
    }
    // -- one projectile cannot hit two stacked players ------------------------
    {
        const h = makeHarness({ playerRadius: 25 });
        const shooter = addMob(h.world, 'shooter', -500, 0);
        addPlayer(h.world, 'sock-1', 0, 0);
        addPlayer(h.world, 'sock-2', 0, 0);
        shoot(h.world, shooter, -30, 0, 0, false);
        h.tick();
        checkEqual('a projectile hits one player only', h.recorded.playerHits.length, 1);
    }
    // -- a player killed by one shot is skipped by the rest of the volley -----
    //
    // The legacy loop re-tested `player.isDead` on the live object for every
    // candidate. The ECS IsDead tag only catches up on the next syncToEcs, so
    // the hook has to report the death back or a volley keeps hitting a corpse.
    {
        const h = makeHarness({ playerRadius: 25, playerDiesOnHit: true });
        const shooter = addMob(h.world, 'shooter', -500, 0);
        addPlayer(h.world, 'sock-1', 0, 0);
        shoot(h.world, shooter, -30, 0, 0, false);
        shoot(h.world, shooter, -31, 0, 0, false);
        h.tick();
        checkEqual('a killed player is not hit again the same tick', h.recorded.playerHits.length, 1);
    }
    // -- a LIVE pet's shot passes through players ----------------------------
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'sock-owner', -1000, -1000);
        const pet = addMob(h.world, 'pet', -500, 0);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        addPlayer(h.world, 'sock-1', 0, 0);
        const p = shoot(h.world, pet, -30, 0, 0, false);
        h.tick();
        checkEqual('a live pet cannot shoot a player', h.recorded.playerHits.length, 0);
        check('the shot is not consumed by the player', h.world.isAlive(p));
    }
    // -- a DEAD pet's shot DOES hit players -----------------------------------
    //
    // This is the quirk the port had to preserve. Pet-ness was resolved live
    // from `enemyById.get(projectile.enemyId)` and a missing shooter read as
    // "not a pet", so a pet's in-flight shots turn hostile the moment it dies.
    // Stamping ownership at spawn would silently change that.
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'sock-owner', -1000, -1000);
        const pet = addMob(h.world, 'pet', -500, 0);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        addPlayer(h.world, 'sock-1', 0, 0);
        const p = shoot(h.world, pet, -30, 0, 0, false);
        h.world.destroy(pet);
        h.tick();
        checkEqual('a dead pet\'s shot hits players', h.recorded.playerHits.length, 1);
        check('and is consumed doing so', !h.world.isAlive(p));
    }
    // =====================================================================
    // Pet projectile vs wild mob
    // =====================================================================
    {
        const h = makeHarness({ petalDamage: 12, mass: 2 });
        const owner = addPlayer(h.world, 'sock-owner', -1000, -1000);
        const pet = addMob(h.world, 'pet', -500, 0);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        const wild = addMob(h.world, 'wild', 0, 0, 20, 100);
        const p = shoot(h.world, pet, -30, 0, 0, false, { damage: 7 });
        h.tick();
        // Three of the four damage paths re-look the value up from the petal
        // table rather than trusting the stamp. This is one of them.
        checkClose('pet shot uses the looked-up petal damage', h.world.get(wild, C.Health, 'current'), 88);
        const petCredit = h.recorded.credits[0];
        checkEqual('damage is credited to the pet OWNER, not the pet', petCredit && petCredit.player, owner);
        checkClose('credited amount matches', petCredit ? petCredit.amount : -1, 12);
        // The pet path broadcasts per hit; the player path batches. Preserved.
        checkEqual('pet hit broadcasts immediately', h.recorded.immediateBroadcasts, 1);
        checkEqual('pet hit does not use the batch', h.recorded.batchedBroadcasts, 0);
        // Knockback is 20/mass, SET rather than accumulated.
        checkClose('mob knockback divides by mass', h.world.get(wild, C.Knockback, 'x'), projectileCollision_1.MOB_KNOCKBACK_FORCE / 2, 1e-3);
        check('pet shot is consumed', !h.world.isAlive(p));
    }
    // -- a pet kill defers kill tracking --------------------------------------
    {
        const h = makeHarness({ petalDamage: 500 });
        const owner = addPlayer(h.world, 'sock-owner', -1000, -1000);
        const pet = addMob(h.world, 'pet', -500, 0);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        const wild = addMob(h.world, 'wild', 0, 0, 20, 100);
        shoot(h.world, pet, -30, 0, 0, false);
        h.tick();
        checkEqual('pet kill is reported once', h.recorded.kills.length, 1);
        const petKill = h.recorded.kills[0];
        checkEqual('pet kill is credited to the owner', petKill && petKill.killer, owner);
        // Deferred because trackMobKill emits playerUpdated to everyone, which
        // does not belong inside the projectile pass's tick budget.
        checkEqual('pet kill defers kill tracking', petKill && petKill.timing, 'deferred');
        check('the victim is marked dead', h.world.has(wild, C.IsDead));
    }
    // =====================================================================
    // Player projectile vs mob
    // =====================================================================
    {
        const h = makeHarness({ damageMultiplier: 2, mass: 1 });
        const player = addPlayer(h.world, 'sock-1', -500, 0);
        const wild = addMob(h.world, 'wild', 0, 0, 20, 100);
        const p = shoot(h.world, player, -30, 0, 0, true, { damage: 7 });
        h.tick();
        // Unlike the pet path this one uses the STAMPED damage and DOES apply
        // getDamageMultiplier. Both halves of that asymmetry are long-standing.
        checkClose('player shot uses stamped damage * multiplier', h.world.get(wild, C.Health, 'current'), 86);
        checkEqual('player shot uses the batched broadcast', h.recorded.batchedBroadcasts, 1);
        checkEqual('player shot does not broadcast immediately', h.recorded.immediateBroadcasts, 0);
        check('player shot is consumed', !h.world.isAlive(p));
    }
    // -- a player projectile never hits a pet ---------------------------------
    {
        const h = makeHarness({ damageMultiplier: 1 });
        const player = addPlayer(h.world, 'sock-1', -500, 0);
        const owner = addPlayer(h.world, 'sock-2', -900, 0);
        const pet = addMob(h.world, 'pet', 0, 0, 20, 100);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        const p = shoot(h.world, player, -30, 0, 0, true);
        h.tick();
        checkClose('pets take no player-projectile damage', h.world.get(pet, C.Health, 'current'), 100);
        check('and the shot flies on', h.world.isAlive(p));
    }
    // -- a kill by a player projectile tracks synchronously -------------------
    {
        const h = makeHarness({ damageMultiplier: 1 });
        const player = addPlayer(h.world, 'sock-1', -500, 0);
        addMob(h.world, 'wild', 0, 0, 20, 5);
        shoot(h.world, player, -30, 0, 0, true, { damage: 50 });
        h.tick();
        checkEqual('player kill is reported once', h.recorded.kills.length, 1);
        checkEqual('player kill tracks synchronously', h.recorded.kills[0] && h.recorded.kills[0].timing, 'sync-snapshot');
    }
    // -- a departed shooter's projectile deals nothing ------------------------
    {
        const h = makeHarness({ damageMultiplier: undefined });
        const player = addPlayer(h.world, 'sock-1', -500, 0);
        const wild = addMob(h.world, 'wild', 0, 0, 20, 100);
        const p = shoot(h.world, player, -30, 0, 0, true);
        h.tick();
        checkClose('a disconnected shooter deals no damage', h.world.get(wild, C.Health, 'current'), 100);
        check('but the projectile is still dropped', !h.world.isAlive(p));
        checkEqual('and nothing is credited', h.recorded.credits.length, 0);
    }
    // =====================================================================
    // Exactly-once damage
    // =====================================================================
    // -- a mob spanning several grid cells is damaged ONCE ---------------------
    //
    // The grid uses fat insertion: an entity sits in every cell its own radius
    // overlaps, so a 700px-radius mob occupies four 512px cells and comes back
    // four times without the per-query dedup stamp. Callers apply damage per
    // candidate, so a missing stamp is silent quadruple damage.
    {
        const h = makeHarness({ damageMultiplier: 1 });
        const player = addPlayer(h.world, 'sock-1', -5000, 0);
        // Centred on a cell corner so it genuinely straddles four buckets.
        const big = addMob(h.world, 'big', 512, 512, 700, 10000);
        const p = shoot(h.world, player, 512, 512, 0, true, { damage: 100 });
        h.tick();
        checkClose('a multi-cell mob takes damage exactly once', h.world.get(big, C.Health, 'current'), 9900);
        checkEqual('and is credited exactly once', h.recorded.credits.length, 1);
        check('the shot is consumed', !h.world.isAlive(p));
    }
    // -- one projectile cannot damage two mobs --------------------------------
    {
        const h = makeHarness({ damageMultiplier: 1 });
        const player = addPlayer(h.world, 'sock-1', -5000, 0);
        addMob(h.world, 'a', 0, 0, 20, 100);
        addMob(h.world, 'b', 5, 0, 20, 100);
        shoot(h.world, player, 0, 0, 0, true, { damage: 10 });
        h.tick();
        checkEqual('a projectile damages one mob only', h.recorded.credits.length, 1);
    }
    // =====================================================================
    // Projectile vs projectile
    // =====================================================================
    {
        const h = makeHarness({ petalDamage: 6 });
        const mobShooter = addMob(h.world, 'shooter', -900, 0);
        const player = addPlayer(h.world, 'sock-1', -900, 0);
        const mobShot = shoot(h.world, mobShooter, 0, 0, 0, false, { health: 4 });
        const playerShot = shoot(h.world, player, 10, 0, 0, true, { health: 20 });
        h.tick();
        // Mutual, with BOTH sides re-looked-up from the petal table.
        check('the weaker projectile dies', !h.world.isAlive(mobShot));
        check('the stronger one survives', h.world.isAlive(playerShot));
        checkClose('the survivor took the other side\'s damage', h.world.get(playerShot, C.Health, 'current'), 14);
    }
    // -- exactly coincident projectiles pass through each other ----------------
    //
    // The `distance > 0` guard. Removing it makes the normal a zero-length
    // vector for anything downstream that divides by it.
    {
        const h = makeHarness({ petalDamage: 6 });
        const mobShooter = addMob(h.world, 'shooter', -900, 0);
        const player = addPlayer(h.world, 'sock-1', -900, 0);
        const mobShot = shoot(h.world, mobShooter, 0, 0, 0, false, { health: 4 });
        const playerShot = shoot(h.world, player, 0, 0, 0, true, { health: 20 });
        h.tick();
        check('coincident projectiles do not trade damage', h.world.isAlive(mobShot) && h.world.isAlive(playerShot));
    }
    // =====================================================================
    // Expiry ordering — the two kinds differ, on purpose
    // =====================================================================
    // -- a mob shot at its maximum range still lands its last hit -------------
    {
        const h = makeHarness({ playerRadius: 25 });
        const shooter = addMob(h.world, 'shooter', -500, 0);
        addPlayer(h.world, 'sock-1', 0, 0);
        // One tick of flight lands it on the player AND at max distance.
        const travel = TICK_MS;
        shoot(h.world, shooter, -travel - 30, 0, 0, false, { speed: 1, maxDistance: travel });
        h.tick();
        checkEqual('a mob shot expiring this tick still hits', h.recorded.playerHits.length, 1);
    }
    // -- a player shot at its maximum range does NOT ---------------------------
    {
        const h = makeHarness({ damageMultiplier: 1 });
        const player = addPlayer(h.world, 'sock-1', -5000, 0);
        const wild = addMob(h.world, 'wild', 0, 0, 20, 100);
        const travel = TICK_MS;
        shoot(h.world, player, -travel, 0, 0, true, { speed: 1, maxDistance: travel, damage: 10 });
        h.tick();
        checkClose('a player shot expiring this tick does not hit', h.world.get(wild, C.Health, 'current'), 100);
    }
    // =====================================================================
    // Wiring
    // =====================================================================
    {
        const world = new world_1.World();
        const scheduler = new system_1.Scheduler(world);
        (0, movement_1.registerMovementSystems)(scheduler, (0, movement_1.createMovementQueries)(world), { hitsWall: () => false });
        (0, projectileCollision_1.registerProjectileCollisionSystem)(scheduler, (0, projectileCollision_1.createProjectileCollisionQueries)(world), new grid_1.SpatialGrid(), new grid_1.GridQueryResult(8), {
            petalDamageOf: () => undefined,
            massOf: () => 1,
            playerRadiusOf: () => 25,
            damageMultiplierOf: () => 1,
            onPlayerHit: () => true,
            creditDamage: () => { },
            emitEnemyDamaged: () => { },
            markEnemyDamaged: () => { },
            onProjectileKill: () => { },
        });
        const names = scheduler.names();
        // Flight must have moved everything before anything is hit-tested.
        check('flight runs before collision', names.indexOf('projectileFlight') < names.indexOf('projectileCollision'));
    }
    return failures;
}
