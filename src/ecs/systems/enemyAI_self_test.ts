/**
 * Self-test for the passive-movement and centipede-chain ports.
 *
 * These pin the behaviours that are easiest to lose in a port and hardest to
 * notice afterwards: the passive integrator's PER-TICK units, the phase
 * durations of the state machine, the size-proportional hop scaling, and the
 * chain repair that keeps a severed centipede alive without spinning the tick.
 */

import * as C from '../components';
import { Entity, NULL_ENTITY } from '../entity';
import { spawnMob } from '../prefabs';
import { Scheduler } from '../system';
import { World } from '../world';
import {
    createEnemyPassiveQueries,
    MAX_WANDER_STEP,
    registerEnemyPassiveSystems,
} from './enemyPassive';
import { createCentipedeQueries, registerCentipedeSystems } from './centipede';

const TICK_MS = 1000 / 30;
const TICK_SECONDS = 1 / 30;

export function runEnemyAiSelfTest(): string[] {
    const failures: string[] = [];

    const check = (name: string, condition: boolean, detail?: string) => {
        if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name: string, actual: unknown, expected: unknown) => {
        if (actual !== expected) failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    const checkClose = (name: string, actual: number, expected: number, tolerance: number) => {
        if (!(Math.abs(actual - expected) <= tolerance)) {
            failures.push(`${name}: expected ~${expected} (+-${tolerance}), got ${actual}`);
        }
    };

    /** No-op wall resolver, so chain assertions are about the chain only. */
    const noWalls = (x: number, y: number) => ({ x, y });

    function makeHarness() {
        const world = new World();
        const scheduler = new Scheduler(world);
        registerEnemyPassiveSystems(scheduler, createEnemyPassiveQueries(world));
        registerCentipedeSystems(scheduler, createCentipedeQueries(world), noWalls);

        let now = 100_000;
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

    function addMob(world: World, id: string, x: number, y: number, speed: number, radius: number): Entity {
        return spawnMob(world, {
            id, type: 'bee', tier: 'common', x, y,
            health: 10, maxHealth: 10, speed, damage: 1, radius, now: 0,
        });
    }

    // -- default passive: phase timing ----------------------------------------
    {
        const h = makeHarness();
        const mob = addMob(h.world, 'passive', 0, 0, 50, 50);
        h.world.add(mob, C.PassiveMotion, { state: C.PassiveState.Idle, stateStart: h.now });
        h.world.add(mob, C.IsIdle);
        h.world.set(mob, C.Angle, 'value', 0);

        // Idle lasts ~1s: nothing moves before then.
        h.tick(20); // ~667ms
        checkEqual('idle mob has not moved', h.world.get(mob, C.Position, 'x'), 0);
        checkEqual('still idle', h.world.get(mob, C.PassiveMotion, 'state'), C.PassiveState.Idle);

        h.tick(12); // past 1s total
        checkEqual('transitions to moving after ~1s',
            h.world.get(mob, C.PassiveMotion, 'state'), C.PassiveState.Moving);

        // The move phase opens with a 0.5s pause before the ramp.
        const xAtMoveStart = h.world.get(mob, C.Position, 'x') as number;
        h.tick(12); // ~400ms into the move phase, still inside the pause
        checkClose('no motion during the 0.5s pause',
            h.world.get(mob, C.Position, 'x') as number, xAtMoveStart, 1e-6);

        // Then it accelerates.
        h.tick(20);
        check('mob accelerates after the pause',
            Math.abs((h.world.get(mob, C.Position, 'x') as number) - xAtMoveStart) > 0.5);

        // And returns to idle at 2.5s into the move phase (75 ticks).
        h.tick(60);
        checkEqual('returns to idle after the move phase',
            h.world.get(mob, C.PassiveMotion, 'state'), C.PassiveState.Idle);
    }

    // -- default passive: per-tick units, not per-second -----------------------
    {
        // The integrator must NOT scale by deltaTime. If it did, a mob would
        // travel ~30x less per tick and the phase-tuned hop distances would all
        // be wrong. Assert against the closed form: with a constant accel `a`
        // and friction f, one tick gives v = a and dx = a.
        // Speed is kept low enough that the result stays below MAX_WANDER_STEP,
        // otherwise the drift clamp hides what is being measured.
        const h = makeHarness();
        const mob = addMob(h.world, 'units', 0, 0, 10, 50);
        h.world.add(mob, C.PassiveMotion, { state: C.PassiveState.Moving, stateStart: h.now - 1500 });
        h.world.add(mob, C.IsIdle);
        h.world.set(mob, C.Angle, 'value', 0);

        const before = h.world.get(mob, C.Position, 'x') as number;
        h.tick();
        const travelled = (h.world.get(mob, C.Position, 'x') as number) - before;

        // accel = speed * 2 * 0.25 * (radius/50) = 10*2*0.25*1 = 5
        // ramp at elapsed ~1533ms: r = (1533-500)/2000 = 0.517, r - r^2 = 0.2497
        // magnitude = 5 * 2 * 0.2497 = 2.497, and the first tick's velocity is
        // exactly that (previous velocity was 0), so position advances by it.
        checkClose('one tick advances by the accel magnitude, unscaled by dt', travelled, 2.497, 0.15);
        // dt-scaling would divide this by ~30.
        check('travel is per-tick sized, not per-second sized', travelled > 0.5,
            `got ${travelled}, which looks dt-scaled`);
    }

    // -- default passive: hops scale with size --------------------------------
    {
        // Both mobs stay under MAX_WANDER_STEP so the clamp does not flatten
        // them to the same value — the scaling is what is being measured.
        const h = makeHarness();
        const small = addMob(h.world, 'small', 0, 0, 5, 50);
        const big = addMob(h.world, 'big', 0, 5000, 5, 200);
        for (const m of [small, big]) {
            h.world.add(m, C.PassiveMotion, { state: C.PassiveState.Moving, stateStart: h.now - 1500 });
            h.world.add(m, C.IsIdle);
            h.world.set(m, C.Angle, 'value', 0);
        }

        const smallBefore = h.world.get(small, C.Position, 'x') as number;
        const bigBefore = h.world.get(big, C.Position, 'x') as number;
        h.tick();
        const smallMoved = Math.abs((h.world.get(small, C.Position, 'x') as number) - smallBefore);
        const bigMoved = Math.abs((h.world.get(big, C.Position, 'x') as number) - bigBefore);

        // 10x the radius should cover more ground — the "big mobs look frozen"
        // bug is what happens when this scaling is missing.
        check('bigger mobs cover more ground per tick', bigMoved > smallMoved * 2,
            `small ${smallMoved}, big ${bigMoved}`);
    }

    // -- drift is clamped ------------------------------------------------------
    {
        // Straight radius-proportional scaling would drift an apex mob at ~7x a
        // player's top speed; the clamp is what stops that.
        const h = makeHarness();
        const huge = addMob(h.world, 'huge', 0, 0, 200, 900);
        h.world.add(huge, C.PassiveMotion, { state: C.PassiveState.Moving, stateStart: h.now - 1500 });
        h.world.add(huge, C.IsIdle);
        h.world.set(huge, C.Angle, 'value', 0);

        h.tick(10);
        const vx = h.world.get(huge, C.Velocity, 'x') as number;
        const vy = h.world.get(huge, C.Velocity, 'y') as number;
        const speed = Math.sqrt(vx * vx + vy * vy);
        check('passive drift is clamped to the wander step', speed <= MAX_WANDER_STEP + 1e-3,
            `drift ${speed} exceeds ${MAX_WANDER_STEP}`);
    }

    // -- immobile mobs never drift ---------------------------------------------
    {
        const h = makeHarness();
        const hole = addMob(h.world, 'hole', 100, 100, 0, 200);
        h.world.add(hole, C.PassiveMotion, { state: C.PassiveState.Moving, stateStart: h.now - 1500 });
        h.world.add(hole, C.IsIdle);

        h.tick(30);
        checkEqual('zero-speed mob stays put (x)', h.world.get(hole, C.Position, 'x'), 100);
        checkEqual('zero-speed mob stays put (y)', h.world.get(hole, C.Position, 'y'), 100);
    }

    // -- bees cruise instead of stop-and-go ------------------------------------
    {
        const h = makeHarness();
        const bee = addMob(h.world, 'bee', 0, 0, 50, 50);
        h.world.add(bee, C.PassiveMotion, { state: C.PassiveState.Idle, stateStart: h.now });
        h.world.add(bee, C.IsIdle);
        h.world.add(bee, C.Wobble, { phase: 0.7 });
        h.world.set(bee, C.Angle, 'value', 0);

        // A bee must move immediately — no 1s idle phase.
        h.tick(3);
        const moved = Math.abs(h.world.get(bee, C.Position, 'x') as number)
            + Math.abs(h.world.get(bee, C.Position, 'y') as number);
        check('bee cruises without an idle phase', moved > 0.1, `moved ${moved}`);

        // Heading wobbles rather than holding straight.
        const a1 = h.world.get(bee, C.Angle, 'value') as number;
        h.tick(15);
        const a2 = h.world.get(bee, C.Angle, 'value') as number;
        check('bee heading wobbles', Math.abs(a2 - a1) > 1e-4);
    }

    // -- a bee is routed to the bee machine only -------------------------------
    {
        // Archetype routing replaces the per-mob `type === 'bee'` compare, so a
        // mob with Wobble must not also run the default machine.
        const h = makeHarness();
        const bee = addMob(h.world, 'routed', 0, 0, 50, 50);
        h.world.add(bee, C.PassiveMotion, { state: C.PassiveState.Idle, stateStart: h.now });
        h.world.add(bee, C.IsIdle);
        h.world.add(bee, C.Wobble, { phase: 0 });

        h.tick(40);
        // The default machine would have flipped state to Moving and back; the
        // bee machine never touches `state` at all.
        checkEqual('bee machine leaves the state field alone',
            h.world.get(bee, C.PassiveMotion, 'state'), C.PassiveState.Idle);
    }

    // -- centipede propagation --------------------------------------------------
    {
        const h = makeHarness();
        const head = addMob(h.world, 'head', 0, 0, 0, 20);
        h.world.add(head, C.CentipedeSegment, { leader: NULL_ENTITY, head, segmentIndex: 0 });
        h.world.add(head, C.MobAI, {
            aiType: C.AiType.Hostile, isChasing: 1,
            targetPlayer: NULL_ENTITY, targetEnemy: NULL_ENTITY, targetPet: NULL_ENTITY, range: 0,
        });

        const segments: Entity[] = [];
        let leader = head;
        for (let i = 1; i <= 3; i++) {
            const seg = addMob(h.world, `seg${i}`, i * 100, 0, 0, 20);
            h.world.add(seg, C.CentipedeSegment, { leader, head, segmentIndex: i });
            h.world.add(seg, C.MobAI, {
                aiType: C.AiType.Hostile, isChasing: 0,
                targetPlayer: NULL_ENTITY, targetEnemy: NULL_ENTITY, targetPet: NULL_ENTITY, range: 0,
            });
            segments.push(seg);
            leader = seg;
        }

        h.tick();

        // Spacing is radius*2*0.9 = 36 between consecutive links.
        const spacing = 20 * 2 * 0.9;
        let previousX = 0;
        for (let i = 0; i < segments.length; i++) {
            const x = h.world.get(segments[i], C.Position, 'x') as number;
            checkClose(`segment ${i + 1} sits one spacing behind its leader`, x - previousX, spacing, 1e-3);
            previousX = x;
        }

        // Segments inherit the head's chase state.
        checkEqual('segment inherits head chase state',
            h.world.get(segments[0], C.MobAI, 'isChasing'), 1);

        // The head itself is not repositioned by this pass.
        checkEqual('head is left to normal AI', h.world.get(head, C.Position, 'x'), 0);
    }

    // -- severed chain repair ---------------------------------------------------
    {
        const h = makeHarness();
        const head = addMob(h.world, 'h2', 0, 0, 0, 20);
        h.world.add(head, C.CentipedeSegment, { leader: NULL_ENTITY, head, segmentIndex: 0 });

        const segments: Entity[] = [];
        let leader = head;
        for (let i = 1; i <= 4; i++) {
            const seg = addMob(h.world, `s${i}`, i * 40, 0, 0, 20);
            h.world.add(seg, C.CentipedeSegment, { leader, head, segmentIndex: i });
            segments.push(seg);
            leader = seg;
        }

        // Kill the middle segment, severing the chain.
        h.world.destroy(segments[1]); // was index 2
        h.tick();

        // The segment behind the gap is promoted to a head of its own.
        const promoted = segments[2];
        checkEqual('promoted segment has no leader',
            h.world.get(promoted, C.CentipedeSegment, 'leader'), NULL_ENTITY);
        checkEqual('promoted segment heads itself',
            h.world.get(promoted, C.CentipedeSegment, 'head'), promoted);
        checkEqual('promoted segment is index 0',
            h.world.get(promoted, C.CentipedeSegment, 'segmentIndex'), 0);

        // And the tail is re-chained under it.
        checkEqual('tail re-chained to the new head',
            h.world.get(segments[3], C.CentipedeSegment, 'head'), promoted);
        checkEqual('tail re-indexed under the new head',
            h.world.get(segments[3], C.CentipedeSegment, 'segmentIndex'), 1);

        // The front half is untouched.
        checkEqual('front half keeps the original head',
            h.world.get(segments[0], C.CentipedeSegment, 'head'), head);
    }

    // -- cycle in the follower graph does not hang ------------------------------
    {
        // Two severed segments pointing at each other made the original's
        // find-loop return chain members forever and spin the tick at 100% CPU.
        const h = makeHarness();
        const ghost = h.world.create();

        const a = addMob(h.world, 'cyc_a', 0, 0, 0, 20);
        const b = addMob(h.world, 'cyc_b', 40, 0, 0, 20);
        // Both orphaned (their recorded leader is a dead entity), and mutually
        // referential once repaired.
        h.world.add(a, C.CentipedeSegment, { leader: ghost, head: a, segmentIndex: 1 });
        h.world.add(b, C.CentipedeSegment, { leader: a, head: a, segmentIndex: 2 });
        h.world.destroy(ghost);

        // Introduce the cycle: a follows b while b follows a.
        h.world.set(a, C.CentipedeSegment, 'leader', b);

        const started = Date.now();
        h.tick();
        const elapsed = Date.now() - started;

        check('cycle repair terminates promptly', elapsed < 1000, `took ${elapsed}ms`);
        check('both segments survived', h.world.isAlive(a) && h.world.isAlive(b));
    }

    // -- a coincident segment does not produce NaN ------------------------------
    {
        const h = makeHarness();
        const head = addMob(h.world, 'h3', 500, 500, 0, 20);
        h.world.add(head, C.CentipedeSegment, { leader: NULL_ENTITY, head, segmentIndex: 0 });
        // Exactly on top of its leader: the distance is 0.
        const seg = addMob(h.world, 's_co', 500, 500, 0, 20);
        h.world.add(seg, C.CentipedeSegment, { leader: head, head, segmentIndex: 1 });

        h.tick();
        const x = h.world.get(seg, C.Position, 'x') as number;
        const y = h.world.get(seg, C.Position, 'y') as number;
        check('coincident segment stays finite', Number.isFinite(x) && Number.isFinite(y),
            `got (${x}, ${y})`);
    }

    return failures;
}
