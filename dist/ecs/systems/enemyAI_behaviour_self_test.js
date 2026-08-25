"use strict";
/**
 * Self-test for the wild-mob and pet AI port.
 *
 * Line of sight and wall resolution are injected as controllable stubs so each
 * case isolates one decision — targeting, tethering, chasing, pet follow — from
 * the terrain. What is pinned here is the decision logic and its cached-target
 * lifecycle, which is where a port silently changes how the game feels.
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
exports.runEnemyAiBehaviourSelfTest = runEnemyAiBehaviourSelfTest;
const C = __importStar(require("../components"));
const entity_1 = require("../entity");
const prefabs_1 = require("../prefabs");
const system_1 = require("../system");
const world_1 = require("../world");
const enemyAI_1 = require("./enemyAI");
const lod_1 = require("./lod");
const TICK_MS = 1000 / 30;
const TICK_SECONDS = 1 / 30;
const PLAYER_CHASE_STEP = 300 / 30;
function runEnemyAiBehaviourSelfTest() {
    const failures = [];
    const check = (name, condition, detail) => {
        if (!condition)
            failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name, actual, expected) => {
        if (actual !== expected)
            failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    function makeHarness(options = {}) {
        const world = new world_1.World();
        const scheduler = new system_1.Scheduler(world);
        const volleys = [];
        const lostPets = [];
        let losCalls = 0;
        const deps = {
            hasLineOfSight: () => {
                losCalls++;
                return !options.losBlocked;
            },
            resolveWall: (x, y) => ({ x, y }),
            isBlocked: (x, y) => (options.blockedTiles ? options.blockedTiles(x, y) : false),
            fireVolley: (shooter, aim) => { volleys.push({ shooter, aim }); },
            hasProjectile: () => true,
            isPlayerSpeedChaser: () => false,
            playerChaseStep: PLAYER_CHASE_STEP,
            sandstormSuckTier: 7,
            maxTargetDistance: 6400,
            // Left empty on purpose: an empty field treats every mob as active,
            // so these cases exercise the AI itself rather than the LOD stride.
            // systems/lod.ts has its own coverage.
            activity: new lod_1.MobActivityField(),
            viewHalfWidth: 960,
            viewHalfHeight: 540,
            onPetOutOfView: (pet) => { lostPets.push(pet); },
        };
        (0, enemyAI_1.registerEnemyAISystem)(scheduler, (0, enemyAI_1.createEnemyAIQueries)(world), deps);
        let now = 50000;
        return {
            world,
            volleys,
            lostPets,
            get losCalls() { return losCalls; },
            resetLosCalls() { losCalls = 0; },
            get now() { return now; },
            tick(times = 1) {
                for (let i = 0; i < times; i++) {
                    now += TICK_MS;
                    scheduler.tick(TICK_SECONDS, TICK_MS, now);
                }
            },
        };
    }
    function addMob(world, id, x, y, aiType, speed = 50, range = 500) {
        const mob = (0, prefabs_1.spawnMob)(world, {
            id, type: 'hornet', tier: 'common', x, y,
            health: 100, maxHealth: 100, speed, damage: 5, radius: 20,
            aiType, range, now: 0,
        });
        return mob;
    }
    function addPlayer(world, id, x, y) {
        return (0, prefabs_1.spawnPlayer)(world, {
            socketId: id, name: id, x, y,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: 0,
        });
    }
    // -- hostile mobs acquire and chase ---------------------------------------
    {
        const h = makeHarness();
        const mob = addMob(h.world, 'hostile', 0, 0, 2 /* C.AiType.Hostile */);
        const player = addPlayer(h.world, 'p1', 200, 0);
        h.tick();
        checkEqual('hostile mob acquires the player', h.world.get(mob, C.MobAI, 'targetPlayer'), player);
        checkEqual('mob is marked chasing', h.world.get(mob, C.MobAI, 'isChasing'), 1);
        check('mob moved toward the player', h.world.get(mob, C.Position, 'x') > 0);
        check('mob is not idling while chasing', !h.world.has(mob, C.IsIdle));
    }
    // -- out of range is not acquired ------------------------------------------
    {
        const h = makeHarness();
        const mob = addMob(h.world, 'far', 0, 0, 2 /* C.AiType.Hostile */, 50, 300);
        addPlayer(h.world, 'p2', 5000, 0);
        h.tick();
        checkEqual('distant player is not acquired', h.world.get(mob, C.MobAI, 'targetPlayer'), entity_1.NULL_ENTITY);
        check('unengaged mob idles', h.world.has(mob, C.IsIdle));
    }
    // -- occluded targets are not acquired -------------------------------------
    {
        const h = makeHarness({ losBlocked: true });
        const mob = addMob(h.world, 'blind', 0, 0, 2 /* C.AiType.Hostile */);
        addPlayer(h.world, 'p3', 100, 0);
        h.tick();
        checkEqual('occluded player is not acquired', h.world.get(mob, C.MobAI, 'targetPlayer'), entity_1.NULL_ENTITY);
    }
    // -- neutral mobs only chase once provoked ---------------------------------
    {
        const h = makeHarness();
        const mob = addMob(h.world, 'neutral', 0, 0, 1 /* C.AiType.Neutral */);
        const player = addPlayer(h.world, 'p4', 100, 0);
        h.tick();
        checkEqual('unprovoked neutral does not scan', h.world.get(mob, C.MobAI, 'targetPlayer'), entity_1.NULL_ENTITY);
        checkEqual('unprovoked neutral is not chasing', h.world.get(mob, C.MobAI, 'isChasing'), 0);
        // Provocation = damage assigning a cached target.
        h.world.set(mob, C.MobAI, 'targetPlayer', player);
        const before = h.world.get(mob, C.Position, 'x');
        h.tick();
        checkEqual('provoked neutral chases', h.world.get(mob, C.MobAI, 'isChasing'), 1);
        check('provoked neutral closes distance', h.world.get(mob, C.Position, 'x') > before);
    }
    // -- passive mobs never scan ------------------------------------------------
    {
        const h = makeHarness();
        const mob = addMob(h.world, 'passive', 0, 0, 0 /* C.AiType.Passive */);
        addPlayer(h.world, 'p5', 50, 0);
        h.tick();
        checkEqual('passive mob acquires nothing', h.world.get(mob, C.MobAI, 'targetPlayer'), entity_1.NULL_ENTITY);
        check('passive mob idles', h.world.has(mob, C.IsIdle));
    }
    // -- the cached target survives, and costs one ray -------------------------
    {
        const h = makeHarness();
        const mob = addMob(h.world, 'sticky', 0, 0, 2 /* C.AiType.Hostile */);
        const near = addPlayer(h.world, 'near', 200, 0);
        addPlayer(h.world, 'nearer', 50, 0);
        h.world.set(mob, C.MobAI, 'targetPlayer', near);
        h.resetLosCalls();
        h.tick();
        // Keeping the target rather than flip-flopping to whoever is momentarily
        // closest is deliberate, and it is what makes steady-state targeting one
        // raycast instead of a rescan.
        checkEqual('cached target is kept even with a closer player', h.world.get(mob, C.MobAI, 'targetPlayer'), near);
        checkEqual('revalidation costs a single ray', h.losCalls, 1);
    }
    // -- a dead target is dropped ------------------------------------------------
    {
        const h = makeHarness();
        const mob = addMob(h.world, 'drop', 0, 0, 2 /* C.AiType.Hostile */);
        const player = addPlayer(h.world, 'dying', 100, 0);
        h.world.set(mob, C.MobAI, 'targetPlayer', player);
        h.world.add(player, C.IsDead);
        h.tick();
        checkEqual('dead target is dropped', h.world.get(mob, C.MobAI, 'targetPlayer'), entity_1.NULL_ENTITY);
    }
    // -- a destroyed target does not alias a recycled entity ---------------------
    {
        // The id-based original could resolve a recycled id to a DIFFERENT mob
        // and silently retarget. Handles carry a generation, so this must read
        // as "target gone".
        const h = makeHarness();
        const mob = addMob(h.world, 'alias', 0, 0, 2 /* C.AiType.Hostile */, 0);
        const player = addPlayer(h.world, 'doomed', 100, 0);
        h.world.set(mob, C.MobAI, 'targetPlayer', player);
        h.world.destroy(player);
        const replacement = addPlayer(h.world, 'replacement', 4000, 4000);
        h.tick();
        const target = h.world.get(mob, C.MobAI, 'targetPlayer');
        check('destroyed target does not alias the recycled slot', target !== replacement, 'the mob retargeted onto whatever reused the slot');
    }
    // -- hole tether: mobs return home past the retreat radius -------------------
    {
        const h = makeHarness();
        const hole = addMob(h.world, 'hole', 0, 0, 0 /* C.AiType.Passive */, 0);
        const ant = addMob(h.world, 'ant', 1000, 0, 2 /* C.AiType.Hostile */);
        h.world.add(ant, C.HoleTether, { hole, returning: 0 });
        const player = addPlayer(h.world, 'kiter', 1100, 0);
        h.world.set(ant, C.MobAI, 'targetPlayer', player);
        h.tick();
        checkEqual('dragged past the retreat radius, the ant gives up', h.world.get(ant, C.MobAI, 'targetPlayer'), entity_1.NULL_ENTITY);
        checkEqual('and starts returning', h.world.get(ant, C.HoleTether, 'returning'), 1);
        check('and moves toward its hole', h.world.get(ant, C.Position, 'x') < 1000);
    }
    // -- hole tether: arriving home resumes normal AI ----------------------------
    {
        const h = makeHarness();
        const hole = addMob(h.world, 'hole2', 0, 0, 0 /* C.AiType.Passive */, 0);
        const ant = addMob(h.world, 'ant2', 50, 0, 2 /* C.AiType.Hostile */);
        h.world.add(ant, C.HoleTether, { hole, returning: 1 });
        h.world.add(ant, C.PassiveMotion, { state: 1 /* C.PassiveState.Moving */, stateStart: 0 });
        h.tick();
        checkEqual('within 100u the ant stops returning', h.world.get(ant, C.HoleTether, 'returning'), 0);
        checkEqual('and its passive machine is reset to idle', h.world.get(ant, C.PassiveMotion, 'state'), 0 /* C.PassiveState.Idle */);
    }
    // -- hole tether: a destroyed hole unparents ---------------------------------
    {
        const h = makeHarness();
        const hole = addMob(h.world, 'hole3', 0, 0, 0 /* C.AiType.Passive */, 0);
        const ant = addMob(h.world, 'ant3', 2000, 0, 2 /* C.AiType.Hostile */);
        h.world.add(ant, C.HoleTether, { hole, returning: 1 });
        h.world.destroy(hole);
        h.tick();
        check('destroyed hole unparents the mob, which roams free', !h.world.has(ant, C.HoleTether));
    }
    // -- pets follow their owner --------------------------------------------------
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'owner', 500, 0);
        const pet = addMob(h.world, 'pet', 0, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        h.tick();
        check('pet moves toward its owner', h.world.get(pet, C.Position, 'x') > 0);
    }
    // -- pets teleport when sight to the owner is lost ----------------------------
    {
        const h = makeHarness({ losBlocked: true });
        const owner = addPlayer(h.world, 'owner2', 3000, 3000);
        const pet = addMob(h.world, 'pet2', 0, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        h.tick();
        // With every ring position failing the sight test too, the pet falls back
        // to the owner's own tile.
        checkEqual('pet ends up on its owner when nothing is visible', h.world.get(pet, C.Position, 'x'), 3000);
    }
    // -- pets attack wild mobs, not each other ------------------------------------
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'owner3', 0, 0);
        const pet = addMob(h.world, 'pet3', 100, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        const otherPet = addMob(h.world, 'pet4', 120, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, otherPet, owner);
        const wild = addMob(h.world, 'wild', 150, 0, 2 /* C.AiType.Hostile */);
        h.tick();
        checkEqual('pet targets the wild mob', h.world.get(pet, C.MobAI, 'targetEnemy'), wild);
        check('pet does not target another pet', h.world.get(pet, C.MobAI, 'targetEnemy') !== otherPet);
    }
    // -- a pet's sight is its owner's screen ---------------------------------------
    {
        // Inside the pet's own aggro range but off the owner's screen: ignored.
        const h = makeHarness();
        const owner = addPlayer(h.world, 'ownerView', 0, 0);
        const pet = addMob(h.world, 'petView', 900, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        addMob(h.world, 'offscreen', 1300, 0, 2 /* C.AiType.Hostile */);
        h.tick();
        checkEqual('a mob off the owner\'s screen is not targeted', h.world.get(pet, C.MobAI, 'targetEnemy'), entity_1.NULL_ENTITY);
    }
    {
        // Beyond the pet's own range but on the owner's screen: targeted.
        const h = makeHarness();
        const owner = addPlayer(h.world, 'ownerView2', 0, 0);
        const pet = addMob(h.world, 'petView2', 0, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        const wild = addMob(h.world, 'onscreen', 800, 0, 2 /* C.AiType.Hostile */);
        h.tick();
        checkEqual('a mob on the owner\'s screen is targeted past the pet\'s own range', h.world.get(pet, C.MobAI, 'targetEnemy'), wild);
    }
    // -- passive pets never engage; neutral pets turn hostile ------------------------
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'ownerCalm', 0, 0);
        const passivePet = addMob(h.world, 'petPassive', 100, 0, 0 /* C.AiType.Passive */);
        (0, prefabs_1.makePet)(h.world, passivePet, owner);
        const neutralPet = addMob(h.world, 'petNeutral', 100, 50, 1 /* C.AiType.Neutral */);
        (0, prefabs_1.makePet)(h.world, neutralPet, owner);
        const wild = addMob(h.world, 'wildCalm', 150, 0, 2 /* C.AiType.Hostile */);
        h.tick();
        checkEqual('a passive pet takes no target', h.world.get(passivePet, C.MobAI, 'targetEnemy'), entity_1.NULL_ENTITY);
        check('a passive pet fires no volley', !h.volleys.some(v => v.shooter === passivePet));
        checkEqual('a neutral pet attacks like a hostile one', h.world.get(neutralPet, C.MobAI, 'targetEnemy'), wild);
    }
    // -- sandstorm pets shadow the owner's movement ----------------------------------
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'ownerStorm', 0, 0);
        const storm = addMob(h.world, 'petStorm', 100, 0, 3 /* C.AiType.Sandstorm */);
        (0, prefabs_1.makePet)(h.world, storm, owner);
        h.tick();
        checkEqual('a sandstorm pet stands still while its owner does', h.world.get(storm, C.Position, 'x'), 100);
        h.world.write(owner, C.Velocity, { x: 300, y: 0 });
        h.tick();
        const x = h.world.get(storm, C.Position, 'x');
        // Owner moves 300/30 = 10px per tick; the pet must beat that.
        check('a sandstorm pet moves the way its owner moves, slightly faster', x > 110, `expected x > 110, got ${x}`);
        checkEqual('a sandstorm pet never takes a target', h.world.get(storm, C.MobAI, 'targetEnemy'), entity_1.NULL_ENTITY);
    }
    // -- off-screen sandstorm and passive pets despawn instead of teleporting --------
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'ownerLost', 0, 0);
        const storm = addMob(h.world, 'lostStorm', 2000, 0, 3 /* C.AiType.Sandstorm */);
        (0, prefabs_1.makePet)(h.world, storm, owner);
        const calm = addMob(h.world, 'lostCalm', 0, 2000, 0 /* C.AiType.Passive */);
        (0, prefabs_1.makePet)(h.world, calm, owner);
        h.tick();
        check('an off-screen sandstorm pet is reported lost', h.lostPets.includes(storm));
        check('an off-screen passive pet is reported lost', h.lostPets.includes(calm));
        checkEqual('the lost sandstorm pet was not teleported', h.world.get(storm, C.Position, 'x'), 2000);
        checkEqual('the lost passive pet was not teleported', h.world.get(calm, C.Position, 'y'), 2000);
    }
    {
        // Sight lost but still on-screen: a passive pet holds position rather
        // than teleporting, and is not despawned.
        const h = makeHarness({ losBlocked: true });
        const owner = addPlayer(h.world, 'ownerWall', 500, 0);
        const calm = addMob(h.world, 'walledCalm', 0, 0, 0 /* C.AiType.Passive */);
        (0, prefabs_1.makePet)(h.world, calm, owner);
        h.tick();
        checkEqual('a sight-blocked on-screen passive pet is not despawned', h.lostPets.length, 0);
        checkEqual('and holds position instead of teleporting', h.world.get(calm, C.Position, 'x'), 0);
    }
    {
        // Hostile pets keep the teleport recovery.
        const h = makeHarness({ losBlocked: true });
        const owner = addPlayer(h.world, 'ownerHost', 3000, 3000);
        const pet = addMob(h.world, 'hostPet', 0, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        h.tick();
        checkEqual('a hostile pet still teleports to its owner', h.world.get(pet, C.Position, 'x'), 3000);
        checkEqual('and is never reported lost', h.lostPets.length, 0);
    }
    // -- wild mobs fall back to pets when no player is in range --------------------
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'owner4', 9000, 9000);
        const pet = addMob(h.world, 'pet5', 100, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        const wild = addMob(h.world, 'wild2', 0, 0, 2 /* C.AiType.Hostile */);
        h.tick();
        checkEqual('wild mob targets the pet when no player is near', h.world.get(wild, C.MobAI, 'targetPet'), pet);
        checkEqual('and chases it', h.world.get(wild, C.MobAI, 'isChasing'), 1);
    }
    // -- players outrank pets -------------------------------------------------------
    {
        const h = makeHarness();
        const owner = addPlayer(h.world, 'owner5', 9000, 9000);
        const pet = addMob(h.world, 'pet6', 100, 0, 2 /* C.AiType.Hostile */);
        (0, prefabs_1.makePet)(h.world, pet, owner);
        const player = addPlayer(h.world, 'target', 150, 0);
        const wild = addMob(h.world, 'wild3', 0, 0, 2 /* C.AiType.Hostile */);
        h.tick();
        checkEqual('the player is preferred', h.world.get(wild, C.MobAI, 'targetPlayer'), player);
        checkEqual('and no pet target is taken', h.world.get(wild, C.MobAI, 'targetPet'), entity_1.NULL_ENTITY);
    }
    // -- aggro bonus widens detection ------------------------------------------------
    {
        // Petals like Bulb raise a player's aggro radius, treated as being that
        // many pixels closer.
        const h = makeHarness();
        const mob = addMob(h.world, 'aggro', 0, 0, 2 /* C.AiType.Hostile */, 50, 100);
        const player = addPlayer(h.world, 'bulb', 300, 0);
        h.tick();
        checkEqual('outside plain range, nothing is acquired', h.world.get(mob, C.MobAI, 'targetPlayer'), entity_1.NULL_ENTITY);
        h.world.set(player, C.PlayerModifiers, 'aggroRadiusBonus', 400);
        h.tick();
        checkEqual('the aggro bonus brings the player into range', h.world.get(mob, C.MobAI, 'targetPlayer'), player);
    }
    // -- sandstorms drag players in ----------------------------------------------------
    {
        const h = makeHarness();
        const storm = (0, prefabs_1.spawnMob)(h.world, {
            id: 'storm', type: 'sandstorm', tier: 'super', x: 0, y: 0,
            health: 100, maxHealth: 100, speed: 50, damage: 5, radius: 40,
            aiType: 3 /* C.AiType.Sandstorm */, now: 0,
        });
        const player = addPlayer(h.world, 'sucked', 200, 0);
        h.tick();
        check('a super sandstorm pulls the player toward it', h.world.get(player, C.Position, 'x') < 200);
        checkEqual('the storm is not marked chasing', h.world.get(storm, C.MobAI, 'isChasing'), 0);
    }
    // -- low-rarity sandstorms do not suck -----------------------------------------------
    {
        const h = makeHarness();
        (0, prefabs_1.spawnMob)(h.world, {
            id: 'weakstorm', type: 'sandstorm', tier: 'common', x: 0, y: 0,
            health: 100, maxHealth: 100, speed: 50, damage: 5, radius: 40,
            aiType: 3 /* C.AiType.Sandstorm */, now: 0,
        });
        const player = addPlayer(h.world, 'safe', 200, 0);
        h.tick();
        checkEqual('a common sandstorm does not pull', h.world.get(player, C.Position, 'x'), 200);
    }
    // -- chasing mobs fire along the PRE-move offset ---------------------------------------
    {
        const h = makeHarness();
        const shooter = addMob(h.world, 'shooter', 0, 0, 2 /* C.AiType.Hostile */);
        addPlayer(h.world, 'victim', 0, 300);
        h.tick();
        checkEqual('one volley fired', h.volleys.length, 1);
        checkEqual('fired by the chasing mob', h.volleys[0].shooter, shooter);
        // The target is straight down (+Y), so the aim is +PI/2. Aiming after the
        // move would give a slightly different angle; the pre-move offset is
        // long-standing behaviour.
        check('aim uses the pre-move offset', Math.abs(h.volleys[0].aim - Math.PI / 2) < 1e-9, `aim was ${h.volleys[0].aim}`);
    }
    // -- lobby and dead players are invisible to AI -----------------------------------------
    {
        const h = makeHarness();
        const picky = addMob(h.world, 'picky', 0, 0, 2 /* C.AiType.Hostile */);
        const lobby = (0, prefabs_1.spawnPlayer)(h.world, {
            socketId: 'lobby', name: 'lobby', x: 50, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], lobby: true, now: 0,
        });
        const dead = addPlayer(h.world, 'dead', 60, 0);
        h.world.add(dead, C.IsDead);
        h.tick();
        const target = h.world.get(picky, C.MobAI, 'targetPlayer');
        check('a title-screen player is never targeted', target !== lobby);
        check('a dead player is never targeted', target !== dead);
        checkEqual('nothing was acquired', target, entity_1.NULL_ENTITY);
    }
    // -- centipede body segments skip AI -----------------------------------------------------
    {
        const h = makeHarness();
        const head = addMob(h.world, 'chead', 0, 0, 2 /* C.AiType.Hostile */);
        h.world.add(head, C.CentipedeSegment, { leader: entity_1.NULL_ENTITY, head, segmentIndex: 0 });
        const body = addMob(h.world, 'cbody', 100, 0, 2 /* C.AiType.Hostile */);
        h.world.add(body, C.CentipedeSegment, { leader: head, head, segmentIndex: 1 });
        addPlayer(h.world, 'bait', 0, 200);
        h.tick();
        // The body is positioned by the chain pass, not by AI, so it must not
        // have acquired a target of its own.
        checkEqual('body segment does not target', h.world.get(body, C.MobAI, 'targetPlayer'), entity_1.NULL_ENTITY);
        checkEqual('head does target', h.world.get(head, C.MobAI, 'targetPlayer') !== entity_1.NULL_ENTITY, true);
    }
    return failures;
}
