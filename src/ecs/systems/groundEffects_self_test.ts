/**
 * Self-test for the ground-effect systems (pollen puffs, web fields).
 *
 * Pins the behaviour ported from server.ts's updateGroundPollens /
 * updateWebFields: the per-victim damage cadence, owner attribution and the
 * damage multiplier, the unscaled-radius overlap test, kill-once semantics,
 * the web slow refresh, and expiry emitting before destruction.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Scheduler } from '../system';
import { World } from '../world';
import { rarityToId } from '../interning';
import { GridQueryResult, SpatialGrid } from '../spatial/grid';
import { spawnGroundPollen, spawnMob, spawnWebField } from '../prefabs';
import {
    createGroundEffectQueries,
    GROUND_POLLEN_DAMAGE_INTERVAL_MS,
    GroundEffectDeps,
    GroundEffectKind,
    registerGroundEffectSystems,
    WEB_SLOW_FACTOR,
    WEB_SLOW_LINGER_MS,
} from './groundEffects';

const TICK_SECONDS = 1 / 30;
const TICK_MS = 1000 / 30;

export function runGroundEffectsSelfTest(): string[] {
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

    interface RecordedCall {
        kind: string;
        victim?: Entity;
        owner?: Entity;
        amount?: number;
        until?: number;
        factor?: number;
        rarityId?: number;
        effectKind?: GroundEffectKind;
        id?: string;
    }

    /**
     * A world with the ground-effect systems registered, a real grid the test
     * rebuilds per tick (standing in for the one tickProjectiles rebuilds), and
     * recording dependency stubs.
     */
    function makeHarness(overrides?: Partial<GroundEffectDeps>) {
        const world = new World();
        const scheduler = new Scheduler(world);
        const grid = new SpatialGrid();
        const gridResult = new GridQueryResult(64);
        const gridSource = world.query([C.Position, C.Radius, C.IsEnemy], [C.IsDead, C.PetOwner]);
        const calls: RecordedCall[] = [];

        const deps: GroundEffectDeps = {
            damageMultiplierOf: () => 2,
            creditDamage: (victim, owner, amount) => calls.push({ kind: 'credit', victim, owner, amount }),
            markEnemyDamaged: (victim) => calls.push({ kind: 'damaged', victim }),
            onKill: (victim, owner) => calls.push({ kind: 'kill', victim, owner }),
            applySlow: (victim, factor, until, rarityId) =>
                calls.push({ kind: 'slow', victim, factor, until, rarityId }),
            emitExpired: (effectKind, id) => calls.push({ kind: 'expired', effectKind, id }),
            // Stand-in for the "unscaled config radius" lookup.
            pollenTargetRadiusOf: () => 20,
            ...overrides,
        };
        registerGroundEffectSystems(scheduler, createGroundEffectQueries(world), grid, gridResult, deps);

        let now = 10_000;
        return {
            world,
            scheduler,
            calls,
            get now() { return now; },
            tick(times = 1) {
                for (let i = 0; i < times; i++) {
                    now += TICK_MS;
                    grid.ensureStampCapacity(world.size() * 4 + 64);
                    grid.rebuild(world, gridSource);
                    scheduler.tick(TICK_SECONDS, TICK_MS, now);
                }
            },
        };
    }

    const mobSpec = (id: string, x: number, y: number) => ({
        id, type: 'bee', tier: 'common', x, y,
        health: 100, maxHealth: 100, speed: 50, damage: 1, radius: 10, now: 10_000,
    });

    // -- pollen damages, attributes and rate-limits ---------------------------
    {
        const h = makeHarness();
        const owner = h.world.create();
        const near = spawnMob(h.world, mobSpec('near', 30, 0));
        const far = spawnMob(h.world, mobSpec('far', 200, 0));
        spawnGroundPollen(h.world, {
            id: 'p1', x: 0, y: 0, owner, damage: 10, radius: 50,
            rarity: 'rare', expiresAt: h.now + 60_000,
        });

        h.tick();
        // damage 10 x multiplier 2, radius 50 + target radius 20 covers dist 30.
        checkClose('pollen chips overlapping mob', h.world.get(near, C.Health, 'current') as number, 80);
        checkClose('pollen ignores distant mob', h.world.get(far, C.Health, 'current') as number, 100);
        const credit = h.calls.find(c => c.kind === 'credit');
        check('pollen credits the owner', credit !== undefined
            && credit.victim === near && credit.owner === owner && credit.amount === 20);
        check('pollen marks the victim damaged',
            h.calls.some(c => c.kind === 'damaged' && c.victim === near));

        // Within the 500ms window nothing further lands...
        h.tick(3);
        checkClose('damage is rate-limited per victim', h.world.get(near, C.Health, 'current') as number, 80);

        // ...and once it lapses the next tick chips again.
        const ticksTo500 = Math.ceil(GROUND_POLLEN_DAMAGE_INTERVAL_MS / TICK_MS);
        h.tick(ticksTo500);
        checkClose('damage resumes after the interval', h.world.get(near, C.Health, 'current') as number, 60);
    }

    // -- pets and the dead are exempt ----------------------------------------
    {
        const h = makeHarness();
        const owner = h.world.create();
        const pet = spawnMob(h.world, mobSpec('pet', 10, 0));
        h.world.add(pet, C.PetOwner, { owner, image: '' });
        const dead = spawnMob(h.world, mobSpec('dead', -10, 0));
        h.world.add(dead, C.IsDead);
        spawnGroundPollen(h.world, {
            id: 'p2', x: 0, y: 0, owner, damage: 10, radius: 50,
            rarity: 'rare', expiresAt: h.now + 60_000,
        });

        h.tick();
        checkClose('pets are exempt from pollen', h.world.get(pet, C.Health, 'current') as number, 100);
        checkClose('dead mobs are exempt from pollen', h.world.get(dead, C.Health, 'current') as number, 100);
    }

    // -- a gone owner means unattributed, unmultiplied damage -----------------
    {
        const h = makeHarness();
        const owner = h.world.create();
        const mob = spawnMob(h.world, mobSpec('m', 30, 0));
        spawnGroundPollen(h.world, {
            id: 'p3', x: 0, y: 0, owner, damage: 10, radius: 50,
            rarity: 'rare', expiresAt: h.now + 60_000,
        });
        h.world.destroy(owner);

        h.tick();
        checkClose('ownerless pollen still damages, at 1x',
            h.world.get(mob, C.Health, 'current') as number, 90);
        check('ownerless pollen credits nobody', !h.calls.some(c => c.kind === 'credit'));
    }

    // -- the killing chip fires the kill hook exactly once --------------------
    {
        const h = makeHarness();
        const owner = h.world.create();
        const mob = spawnMob(h.world, mobSpec('victim', 30, 0));
        h.world.set(mob, C.Health, 'current', 5);
        spawnGroundPollen(h.world, {
            id: 'p4', x: 0, y: 0, owner, damage: 10, radius: 50,
            rarity: 'rare', expiresAt: h.now + 60_000,
        });

        h.tick();
        checkEqual('lethal chip clamps health at zero', h.world.get(mob, C.Health, 'current'), 0);
        checkEqual('kill hook fires once', h.calls.filter(c => c.kind === 'kill').length, 1);
        const kill = h.calls.find(c => c.kind === 'kill');
        check('kill hook names victim and killer', kill?.victim === mob && kill?.owner === owner);

        // The corpse (health 0, not yet reaped legacy-side) takes nothing more.
        h.tick(Math.ceil(GROUND_POLLEN_DAMAGE_INTERVAL_MS / TICK_MS) + 1);
        checkEqual('corpse is not re-killed', h.calls.filter(c => c.kind === 'kill').length, 1);
    }

    // -- pollen expiry emits, then destroys -----------------------------------
    {
        const h = makeHarness();
        const owner = h.world.create();
        const pollen = spawnGroundPollen(h.world, {
            id: 'p5', x: 0, y: 0, owner, damage: 10, radius: 50,
            rarity: 'rare', expiresAt: h.now + TICK_MS * 2,
        });

        h.tick();
        check('pollen alive before its deadline', h.world.isAlive(pollen));
        h.tick(2);
        check('pollen destroyed at its deadline', !h.world.isAlive(pollen));
        check('pollen expiry was emitted', h.calls.some(c =>
            c.kind === 'expired' && c.effectKind === 'pollen' && c.id === 'p5'));
    }

    // -- webs slow what stands in them ---------------------------------------
    {
        const h = makeHarness();
        const owner = h.world.create();
        const inside = spawnMob(h.world, mobSpec('inside', 40, 0));
        const outside = spawnMob(h.world, mobSpec('outside', 300, 0));
        spawnWebField(h.world, {
            id: 'w1', x: 0, y: 0, owner, radius: 60,
            rarity: 'epic', expiresAt: h.now + 60_000,
        });

        h.tick();
        const slow = h.calls.find(c => c.kind === 'slow');
        check('web slows the mob inside it', slow !== undefined && slow.victim === inside);
        check('web slow carries the design factor and linger',
            slow !== undefined && slow.factor === WEB_SLOW_FACTOR && slow.until === h.now + WEB_SLOW_LINGER_MS);
        checkEqual('web slow carries the petal rarity', slow?.rarityId, rarityToId('epic'));
        check('web ignores the mob outside it',
            !h.calls.some(c => c.kind === 'slow' && c.victim === outside));

        // The slow refreshes every tick while the mob stands in the field.
        h.tick();
        checkEqual('web refreshes the slow per tick',
            h.calls.filter(c => c.kind === 'slow' && c.victim === inside).length, 2);
    }

    // -- web expiry emits, then destroys --------------------------------------
    {
        const h = makeHarness();
        const owner = h.world.create();
        const web = spawnWebField(h.world, {
            id: 'w2', x: 0, y: 0, owner, radius: 60,
            rarity: 'common', expiresAt: h.now + TICK_MS * 2,
        });

        h.tick(3);
        check('web destroyed at its deadline', !h.world.isAlive(web));
        check('web expiry was emitted', h.calls.some(c =>
            c.kind === 'expired' && c.effectKind === 'web' && c.id === 'w2'));
    }

    return failures;
}
