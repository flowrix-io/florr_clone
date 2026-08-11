/**
 * Self-test for the game systems and prefabs.
 *
 * Each case sets up a small world, runs real scheduler ticks, and asserts the
 * observable outcome — the point being to pin the ported BEHAVIOUR (unit
 * conventions, expiry thresholds, the order death is processed in) rather than
 * the implementation.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, Scheduler } from '../system';
import { World } from '../world';
import { spawnGroundPollen, spawnMob, spawnPlayer, spawnProjectile, spawnWebField } from '../prefabs';
import { createMovementQueries, registerMovementSystems } from './movement';
import { createAfflictionQueries, registerAfflictionSystems } from './afflictions';
import { createLifetimeQueries, registerLifetimeSystems, UNSEEN_DESPAWN_MS } from './lifetime';

const TICK_SECONDS = 1 / 30;
const TICK_MS = 1000 / 30;

export function runSystemsSelfTest(): string[] {
    const failures: string[] = [];

    const check = (name: string, condition: boolean, detail?: string) => {
        if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name: string, actual: unknown, expected: unknown) => {
        if (actual !== expected) failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    const checkClose = (name: string, actual: number, expected: number, tolerance = 1e-4) => {
        if (Math.abs(actual - expected) > tolerance) {
            failures.push(`${name}: expected ~${expected}, got ${actual}`);
        }
    };

    /** A world with every system registered, plus a clock the test advances. */
    function makeHarness() {
        const world = new World();
        const scheduler = new Scheduler(world);
        registerMovementSystems(scheduler, createMovementQueries(world));
        registerAfflictionSystems(scheduler, createAfflictionQueries(world));
        registerLifetimeSystems(scheduler, createLifetimeQueries(world));
        let now = 10_000;
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
        const p = spawnProjectile(h.world, {
            x: 0, y: 0, angle: 0, speed: 1, maxDistance: 100,
            damage: 5, health: 1, size: 2,
            petalType: 'basic', petalRarity: 'common',
            shooter, fromPlayer: true, now: h.now,
        });

        h.tick();
        checkClose('projectile advances speed*deltaMs', h.world.get(p, C.Position, 'x') as number, TICK_MS, 1e-3);
        checkClose('projectile y unchanged on +X heading', h.world.get(p, C.Position, 'y') as number, 0, 1e-6);
        checkClose('projectile accumulates distance', h.world.get(p, C.Projectile, 'distance') as number, TICK_MS, 1e-2);

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
        const p = spawnProjectile(h.world, {
            x: 100, y: 100, angle: Math.PI / 2, speed: 0.5, maxDistance: 10_000,
            damage: 1, health: 1, size: 1,
            petalType: 'basic', petalRarity: 'common',
            shooter, fromPlayer: false, now: h.now,
        });
        h.tick();
        const expected = 0.5 * TICK_MS;
        checkClose('angled projectile x holds', h.world.get(p, C.Position, 'x') as number, 100, 1e-3);
        checkClose('angled projectile y advances', h.world.get(p, C.Position, 'y') as number, 100 + expected, 1e-3);
    }

    // -- projectile origin survives the shooter -------------------------------
    {
        const h = makeHarness();
        const shooter = spawnMob(h.world, {
            id: 'shooter-1', type: 'hornet', tier: 'rare', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 50, damage: 5, radius: 20, now: h.now,
        });
        const p = spawnProjectile(h.world, {
            x: 0, y: 0, angle: 0, speed: 0.1, maxDistance: 10_000,
            damage: 5, health: 1, size: 2,
            petalType: 'stinger', petalRarity: 'rare',
            shooter, sourceType: 'hornet', sourceTier: 'rare',
            fromPlayer: false, now: h.now,
        });

        h.world.destroy(shooter);
        h.tick();

        check('projectile outlives its shooter', h.world.isAlive(p));
        check('dead shooter handle is detectable',
            !h.world.isAlive(h.world.get(p, C.ProjectileOrigin, 'shooter') as Entity));
        // The stamped source is what kill attribution reads once the shooter is gone.
        checkEqual('stamped source tier survives', h.world.get(p, C.ProjectileOrigin, 'sourceTier'), 2);
    }

    // -- passive drift --------------------------------------------------------
    {
        const h = makeHarness();
        const mob = spawnMob(h.world, {
            id: 'drifter', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        h.world.add(mob, C.PassiveMotion, { state: C.PassiveState.Moving, stateStart: h.now });
        h.world.write(mob, C.Velocity, { x: 300, y: 0 });

        h.tick();
        checkClose('passive drift integrates per second', h.world.get(mob, C.Position, 'x') as number, 300 * TICK_SECONDS, 1e-3);
        checkClose('passive drift applies friction', h.world.get(mob, C.Velocity, 'x') as number, 270, 1e-2);

        // A mob without PassiveMotion must not be integrated at all.
        const still = spawnMob(h.world, {
            id: 'still', type: 'bee', tier: 'common', x: 50, y: 0,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        h.world.write(still, C.Velocity, { x: 999, y: 999 });
        h.tick();
        checkEqual('non-drifting mob does not move', h.world.get(still, C.Position, 'x'), 50);
    }

    // -- poison stacks --------------------------------------------------------
    {
        const h = makeHarness();
        const victim = spawnMob(h.world, {
            id: 'victim', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 100, maxHealth: 100, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        const attacker = h.world.create();

        // Two stacks from the same attacker, as several petals can poison at once.
        for (let i = 0; i < 2; i++) {
            const stack = h.world.create();
            h.world.add(stack, C.PoisonStack, {
                target: victim, source: attacker,
                damagePerMs: 0.1, endTime: h.now + 10_000,
            });
        }

        h.tick();
        // Two stacks at 0.1 dmg/ms over one 33.3ms tick = ~6.67 damage.
        checkClose('both stacks damage the victim',
            h.world.get(victim, C.Health, 'current') as number, 100 - 2 * 0.1 * TICK_MS, 0.01);
        checkEqual('stacks persist while active', h.world.query([C.PoisonStack]).count(), 2);
    }

    // -- poison lapses and orphaning ------------------------------------------
    {
        const h = makeHarness();
        const victim = spawnMob(h.world, {
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
            damagePerMs: 0.01, endTime: h.now + 100_000,
        });
        h.world.destroy(victim);
        h.tick();
        checkEqual('orphaned stack is destroyed', h.world.query([C.PoisonStack]).count(), 0);
    }

    // -- poison kills and the reaper ------------------------------------------
    {
        const h = makeHarness();
        const doomed = spawnMob(h.world, {
            id: 'doomed', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 1, maxHealth: 1, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        const stack = h.world.create();
        h.world.add(stack, C.PoisonStack, {
            target: doomed, source: h.world.create(),
            damagePerMs: 5, endTime: h.now + 100_000,
        });

        h.tick();
        // Combat marks it dead; the Lifetime reaper destroys it in the same tick.
        check('poison kill is reaped', !h.world.isAlive(doomed));
        // The stack itself retires on the FOLLOWING tick, when it next looks at
        // its now-dead target. That one-tick lag is harmless (a stack with no
        // live victim applies no damage) and is the price of never mutating the
        // world mid-iteration.
        checkEqual('stack still queued the tick its victim died',
            h.world.query([C.PoisonStack]).count(), 1);
        h.tick();
        checkEqual('stack retires the tick after its victim died',
            h.world.query([C.PoisonStack]).count(), 0);
    }

    // -- player poison --------------------------------------------------------
    {
        const h = makeHarness();
        const player = spawnPlayer(h.world, {
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
        checkClose('player poison ticks per second',
            h.world.get(player, C.Health, 'current') as number, 100 - 30 * TICK_SECONDS, 0.01);

        h.tick(3);
        check('lapsed player poison is removed', !h.world.has(player, C.Poisoned));
        check('player survived', h.world.isAlive(player));
    }

    // -- slows ----------------------------------------------------------------
    {
        const h = makeHarness();
        const mob = spawnMob(h.world, {
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
        const pollen = spawnGroundPollen(h.world, {
            x: 0, y: 0, owner, damage: 10, radius: 50,
            rarity: 'rare', expiresAt: h.now + TICK_MS * 2,
        });
        const web = spawnWebField(h.world, {
            x: 0, y: 0, owner, radius: 60,
            rarity: 'rare', expiresAt: h.now + 100_000,
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
        const seen = spawnMob(h.world, {
            id: 'seen', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        const unseen = spawnMob(h.world, {
            id: 'unseen', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius: 10, now: h.now,
        });
        // Backdate the unseen mob past the threshold.
        h.world.set(unseen, C.ViewportTracked, 'lastInViewport', h.now - UNSEEN_DESPAWN_MS - 1000);

        // The sweep is strided (interval 5), so it needs several ticks to fire.
        h.tick(6);
        check('unseen mob despawns', !h.world.isAlive(unseen));
        check('recently seen mob survives', h.world.isAlive(seen));
    }

    // -- prefab archetypes ----------------------------------------------------
    {
        const world = new World();
        const now = 0;
        const mob = spawnMob(world, {
            id: 'm', type: 'bee', tier: 'common', x: 0, y: 0,
            health: 10, maxHealth: 10, speed: 50, damage: 1, radius: 10, now,
        });
        const player = spawnPlayer(world, {
            socketId: 's', name: 'p', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now,
        });
        const lobby = spawnPlayer(world, {
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
        checkEqual('world player query excludes lobby',
            world.query([C.IsPlayer], [C.IsLobby]).count(), 1);

        checkEqual('mob resolves by id', world.lookup('m'), mob);
        checkEqual('player resolves by socket id', world.lookup('s'), player);
    }

    // -- scheduler phase ordering across the real systems ---------------------
    {
        const h = makeHarness();
        const names = h.scheduler.names();
        const indexOf = (n: string) => names.indexOf(n);

        check('movement runs before combat', indexOf('projectileFlight') < indexOf('poisonStacks'));
        check('combat runs before lifetime', indexOf('poisonStacks') < indexOf('expiry'));
        check('reaper runs last in lifetime', indexOf('reaper') > indexOf('unseenDespawn'));
        check('reaper runs after expiry', indexOf('reaper') > indexOf('expiry'));
    }

    return failures;
}

/** Re-exported so the runner can name the phase enum in diagnostics. */
export { Phase };
