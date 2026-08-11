/**
 * Self-test for projectile firing and mob-vs-mob collision.
 *
 * Stat lookups and damage hooks are stubs, so each case isolates the ported
 * decision — cooldown gating, volley fan geometry, rarity scaling, pair dedup,
 * chain exemption, pet melee direction and kill attribution.
 */

import * as C from '../components';
import { Entity, NULL_ENTITY } from '../entity';
import { makePet, spawnMob, spawnPlayer } from '../prefabs';
import { Scheduler } from '../system';
import { World } from '../world';
import { createFireVolley, FiringDeps, ProjectileConfig } from './projectileFiring';
import {
    createMobCollisionQueries,
    MobCollisionDeps,
    registerMobCollisionSystem,
} from './mobCollision';

const TICK_MS = 1000 / 30;
const TICK_SECONDS = 1 / 30;

export function runCombatSelfTest(): string[] {
    const failures: string[] = [];

    const check = (name: string, condition: boolean, detail?: string) => {
        if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name: string, actual: unknown, expected: unknown) => {
        if (actual !== expected) failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    const checkClose = (name: string, actual: number, expected: number, tolerance = 1e-6) => {
        if (!(Math.abs(actual - expected) <= tolerance)) {
            failures.push(`${name}: expected ~${expected}, got ${actual}`);
        }
    };

    function addMob(world: World, id: string, x: number, y: number, radius = 20, damage = 5, health = 100): Entity {
        return spawnMob(world, {
            id, type: 'hornet', tier: 'rare', x, y,
            health, maxHealth: health, speed: 50, damage, radius, now: 0,
        });
    }

    // =====================================================================
    // Projectile firing
    // =====================================================================

    function makeFiring(config: ProjectileConfig | undefined, cooldown = 2000) {
        const world = new World();
        const deps: FiringDeps = {
            projectileConfigOf: () => config,
            cooldownOf: () => cooldown,
            petalStatsOf: () => ({ damage: 7, health: 3, size: 2 }),
            // SIZE_SCALING for 'rare' in the real table; any constant works so
            // long as the two divisors are applied to it.
            sizeScalingOf: () => 9,
            mobTypeNameOf: () => 'hornet',
            rarityNameOf: () => 'rare',
        };
        return { world, fire: createFireVolley(world, deps) };
    }

    const baseConfig: ProjectileConfig = {
        petalType: 'stinger',
        speed: 400,
        spreadAngle: 0.2,
        count: 1,
        distance: 900,
    };

    // -- a single shot -------------------------------------------------------
    {
        const { world, fire } = makeFiring(baseConfig);
        const shooter = addMob(world, 'shooter', 100, 50);

        fire(shooter, 0, 10_000);

        const projectiles = world.query([C.IsProjectile]).collect();
        checkEqual('one projectile spawned', projectiles.length, 1);

        const p = projectiles[0];
        checkEqual('spawns at the shooter', world.get(p, C.Position, 'x'), 100);
        checkClose('inherits the aim angle', world.get(p, C.Angle, 'value') as number, 0);
        // Config speed is px/sec; flight is px/ms.
        checkClose('speed converted to px/ms', world.get(p, C.Speed, 'current') as number, 0.4, 1e-7);
        // distance * (SIZE_SCALING / 9) = 900 * 1
        checkClose('travel distance scaled by rarity',
            world.get(p, C.Projectile, 'maxDistance') as number, 900, 1e-3);
        // size * (SIZE_SCALING / 3) = 2 * 3
        checkClose('size scaled by rarity', world.get(p, C.Projectile, 'size') as number, 6, 1e-3);
        checkEqual('damage from petal stats', world.get(p, C.Damage, 'value'), 7);
        checkEqual('health from petal stats', world.get(p, C.Health, 'current'), 3);
        checkEqual('is a mob projectile, not a player one', world.has(p, C.FromPlayer), false);
        checkEqual('origin points at the shooter', world.get(p, C.ProjectileOrigin, 'shooter'), shooter);
    }

    // -- cooldown gating ------------------------------------------------------
    {
        const { world, fire } = makeFiring(baseConfig, 2000);
        const shooter = addMob(world, 's2', 0, 0);

        fire(shooter, 0, 10_000);
        checkEqual('first volley fires', world.query([C.IsProjectile]).count(), 1);

        fire(shooter, 0, 11_000); // inside the cooldown
        checkEqual('second volley suppressed by cooldown', world.query([C.IsProjectile]).count(), 1);

        fire(shooter, 0, 12_100); // past it
        checkEqual('volley fires again once the cooldown elapses',
            world.query([C.IsProjectile]).count(), 2);
    }

    // -- multi-shot fan is centred on the aim ---------------------------------
    {
        const { world, fire } = makeFiring({ ...baseConfig, count: 3, spreadAngle: 0.2 });
        const shooter = addMob(world, 's3', 0, 0);

        fire(shooter, 1.0, 10_000);
        const angles = world.query([C.IsProjectile]).collect()
            .map(p => world.get(p, C.Angle, 'value') as number)
            .sort((a, b) => a - b);

        checkEqual('three projectiles', angles.length, 3);
        checkClose('fan is centred on the aim angle', angles[1], 1.0, 1e-6);
        checkClose('lower edge offset by the spread', angles[0], 0.8, 1e-6);
        checkClose('upper edge offset by the spread', angles[2], 1.2, 1e-6);
    }

    // -- no config, no shot ----------------------------------------------------
    {
        const { world, fire } = makeFiring(undefined);
        const shooter = addMob(world, 's4', 0, 0);
        fire(shooter, 0, 10_000);
        checkEqual('a mob with no projectile config never fires',
            world.query([C.IsProjectile]).count(), 0);
    }

    // -- a dead shooter does not fire -------------------------------------------
    {
        const { world, fire } = makeFiring(baseConfig);
        const shooter = addMob(world, 's5', 0, 0);
        world.destroy(shooter);
        fire(shooter, 0, 10_000);
        checkEqual('a destroyed shooter fires nothing',
            world.query([C.IsProjectile]).count(), 0);
    }

    // =====================================================================
    // Mob-vs-mob collision
    // =====================================================================

    interface CollisionEvents {
        damaged: Entity[];
        killed: Entity[];
        credits: Array<{ victim: Entity; player: Entity; amount: number }>;
    }

    function makeCollision(noCollisionFor: Set<number> = new Set()) {
        const world = new World();
        const scheduler = new Scheduler(world);
        const events: CollisionEvents = { damaged: [], killed: [], credits: [] };

        const deps: MobCollisionDeps = {
            resolveWall: (x, y) => ({ x, y }),
            noMobCollision: (mob) => noCollisionFor.has(mob),
            creditDamage: (victim, player, amount) => { events.credits.push({ victim, player, amount }); },
            onDamaged: (victim) => { events.damaged.push(victim); },
            onKilled: (victim) => { events.killed.push(victim); },
        };

        registerMobCollisionSystem(scheduler, createMobCollisionQueries(world), deps);

        let now = 20_000;
        return {
            world,
            events,
            tick(times = 1) {
                for (let i = 0; i < times; i++) {
                    now += TICK_MS;
                    scheduler.tick(TICK_SECONDS, TICK_MS, now);
                }
            },
        };
    }

    // -- overlapping mobs push apart --------------------------------------------
    {
        const h = makeCollision();
        const a = addMob(h.world, 'a', 0, 0, 20);
        const b = addMob(h.world, 'b', 10, 0, 20);

        h.tick();
        const ax = h.world.get(a, C.Position, 'x') as number;
        const bx = h.world.get(b, C.Position, 'x') as number;
        check('overlapping mobs separate', bx - ax > 10, `gap was ${bx - ax}`);
        check('separation is symmetric', Math.abs((0 - ax) - (bx - 10)) < 1e-6);
    }

    // -- separation is capped per tick --------------------------------------------
    {
        // Deeply overlapped mobs ease apart over several ticks rather than
        // teleporting.
        const h = makeCollision();
        const a = addMob(h.world, 'a2', 0, 0, 200);
        addMob(h.world, 'b2', 1, 0, 200);

        h.tick();
        const moved = Math.abs(h.world.get(a, C.Position, 'x') as number);
        check('per-tick push is capped', moved <= 10 + 1e-6, `moved ${moved}`);
    }

    // -- distant mobs are untouched -------------------------------------------------
    {
        const h = makeCollision();
        const a = addMob(h.world, 'a3', 0, 0, 20);
        addMob(h.world, 'b3', 5000, 0, 20);

        h.tick();
        checkEqual('distant mobs do not interact', h.world.get(a, C.Position, 'x'), 0);
    }

    // -- centipede segments never push each other -------------------------------------
    {
        const h = makeCollision();
        const head = addMob(h.world, 'head', 0, 0, 20);
        const seg = addMob(h.world, 'seg', 10, 0, 20);
        h.world.add(head, C.CentipedeSegment, { leader: NULL_ENTITY, head, segmentIndex: 0 });
        h.world.add(seg, C.CentipedeSegment, { leader: head, head, segmentIndex: 1 });

        h.tick();
        checkEqual('same-chain segments are exempt (head)', h.world.get(head, C.Position, 'x'), 0);
        checkEqual('same-chain segments are exempt (segment)', h.world.get(seg, C.Position, 'x'), 10);
    }

    // -- different chains DO push ------------------------------------------------------
    {
        const h = makeCollision();
        const headA = addMob(h.world, 'ha', 0, 0, 20);
        const headB = addMob(h.world, 'hb', 10, 0, 20);
        h.world.add(headA, C.CentipedeSegment, { leader: NULL_ENTITY, head: headA, segmentIndex: 0 });
        h.world.add(headB, C.CentipedeSegment, { leader: NULL_ENTITY, head: headB, segmentIndex: 0 });

        h.tick();
        check('separate chains still collide',
            (h.world.get(headB, C.Position, 'x') as number) > 10);
    }

    // -- no_mob_collision mobs are exempt -----------------------------------------------
    {
        // Ant holes neither push nor get pushed. The exempt set is keyed by
        // handle, and spawn order is deterministic, so the hole is built first
        // and its handle registered before the pass runs.
        const exempt = new Set<number>();
        const h = makeCollision(exempt);
        const hole = addMob(h.world, 'hole', 0, 0, 200);
        const ant = addMob(h.world, 'ant', 10, 0, 20);
        exempt.add(hole);

        h.tick();
        checkEqual('a no_mob_collision mob does not push', h.world.get(ant, C.Position, 'x'), 10);
        checkEqual('and is not pushed itself', h.world.get(hole, C.Position, 'x'), 0);
    }

    // -- pet vs wild melee, both directions ------------------------------------------------
    {
        const h = makeCollision();
        const owner = spawnPlayer(h.world, {
            socketId: 'owner', name: 'owner', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: 0,
        });
        const pet = addMob(h.world, 'pet', 0, 0, 20, 7, 100);
        makePet(h.world, pet, owner);
        const wild = addMob(h.world, 'wild', 10, 0, 20, 4, 100);

        h.tick();

        checkEqual('wild mob took the pet\'s damage', h.world.get(wild, C.Health, 'current'), 93);
        checkEqual('pet took the wild mob\'s damage', h.world.get(pet, C.Health, 'current'), 96);
        checkEqual('both were marked damaged', h.events.damaged.length, 2);

        // Only pet-dealt damage is credited, and to the OWNER, since
        // contributors are keyed by player.
        checkEqual('exactly one damage credit', h.events.credits.length, 1);
        checkEqual('credited against the wild mob', h.events.credits[0].victim, wild);
        checkEqual('credited to the pet owner', h.events.credits[0].player, owner);
        checkEqual('credited the pet damage', h.events.credits[0].amount, 7);
    }

    // -- pet vs pet does no damage -----------------------------------------------------------
    {
        const h = makeCollision();
        const owner = spawnPlayer(h.world, {
            socketId: 'o2', name: 'o2', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: 0,
        });
        const petA = addMob(h.world, 'petA', 0, 0, 20, 7);
        const petB = addMob(h.world, 'petB', 10, 0, 20, 7);
        makePet(h.world, petA, owner);
        makePet(h.world, petB, owner);

        h.tick();
        checkEqual('pets do not damage each other', h.world.get(petA, C.Health, 'current'), 100);
        checkEqual('no damage events', h.events.damaged.length, 0);
    }

    // -- wild vs wild does no damage -----------------------------------------------------------
    {
        const h = makeCollision();
        const a = addMob(h.world, 'w1', 0, 0, 20, 9);
        addMob(h.world, 'w2', 10, 0, 20, 9);

        h.tick();
        checkEqual('wild mobs do not damage each other', h.world.get(a, C.Health, 'current'), 100);
        checkEqual('no damage events', h.events.damaged.length, 0);
    }

    // -- a melee kill is reported once ----------------------------------------------------------
    {
        const h = makeCollision();
        const owner = spawnPlayer(h.world, {
            socketId: 'o3', name: 'o3', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: 0,
        });
        const pet = addMob(h.world, 'killer', 0, 0, 20, 500, 100);
        makePet(h.world, pet, owner);
        const wild = addMob(h.world, 'victim', 10, 0, 20, 1, 100);

        h.tick();
        checkEqual('victim is dead', h.world.get(wild, C.Health, 'current'), 0);
        check('victim is tagged dead', h.world.has(wild, C.IsDead));
        checkEqual('kill reported exactly once', h.events.killed.length, 1);
        checkEqual('kill reported for the victim', h.events.killed[0], wild);

        // A second tick must not re-report a mob that is already dead.
        h.tick();
        checkEqual('dead mob is not killed twice', h.events.killed.length, 1);
    }

    // -- each pair is handled once per tick ----------------------------------------------------
    {
        // A mob spanning several cells would otherwise be visited once per cell,
        // and damage is applied per visit — so a duplicate is a double hit.
        const h = makeCollision();
        const owner = spawnPlayer(h.world, {
            socketId: 'o4', name: 'o4', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: 0,
        });
        const pet = addMob(h.world, 'bigpet', 0, 0, 600, 3, 100);
        makePet(h.world, pet, owner);
        const wild = addMob(h.world, 'bigwild', 50, 0, 600, 2, 100);

        h.tick();
        checkEqual('wild took the pet damage exactly once', h.world.get(wild, C.Health, 'current'), 97);
        checkEqual('pet took the wild damage exactly once', h.world.get(pet, C.Health, 'current'), 98);
    }

    // -- degenerate positions are skipped, not fatal ----------------------------------------------
    {
        const h = makeCollision();
        const good = addMob(h.world, 'good', 0, 0, 20);
        addMob(h.world, 'nan', NaN, 0, 20);
        addMob(h.world, 'huge', 1e20, 1e20, 20);

        const started = Date.now();
        h.tick();
        const elapsed = Date.now() - started;

        check('degenerate mobs do not hang the pass', elapsed < 1000, `took ${elapsed}ms`);
        checkEqual('the good mob is untouched', h.world.get(good, C.Position, 'x'), 0);
    }

    return failures;
}
