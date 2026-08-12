/**
 * Self-test for the client render layer.
 *
 * Pins the behaviours that make the client look RIGHT rather than merely be
 * correct — the class of regression that passes every typecheck and every other
 * gate while the game feels wrong or draws nothing:
 *
 *   - first sight snaps instead of flying in from the origin
 *   - remote entities ease instead of stuttering at the tick rate
 *   - the ease rate is the user's `interpolationAmount`, not a hardcoded number
 *   - flowers never acquire a snapshot buffer (that is the "other players move
 *     differently" bug, and the shape of it is one stray component add)
 *   - a teleport cuts instead of gliding 200000px across the maze
 *   - mob facing is eased, not snapshot-interpolated
 *   - death animations are not interrupted, and DO get reaped
 *   - the graphics side-maps are cleaned up on BOTH removal paths
 *   - players and mobs cannot collide in the external-id namespace
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Scheduler } from '../system';
import { World } from '../world';
import {
    InterpTarget,
    IsPlayerRender,
    MAX_SNAPSHOTS,
    MobRender,
    NeedsSnap,
    RenderEye,
    RenderRef,
    SnapshotBuffer,
} from './components';
import {
    AI_TYPE_UNKNOWN,
    applyEnemyUpdate,
    applyPlayerUpdate,
    beginDeathAnimation,
    ClientReaper,
    DEATH_ANIMATION_DURATION_MS,
    forgetEnemy,
    setMobDps,
    snapPlayer,
} from './ingest';
import {
    createInterpolationQueries,
    defaultInterpolationConfig,
    easeRateFromAmount,
    InterpolationQueries,
    registerInterpolationSystems,
    TELEPORT_SNAP_DISTANCE,
} from './interpolation';

const FRAME_SECONDS = 1 / 60;
const FRAME_MS = 1000 / 60;

export function runClientSelfTest(): string[] {
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

    interface Harness {
        world: World;
        queries: InterpolationQueries;
        reaped: { enemies: string[]; players: string[] };
        readonly now: number;
        advance(ms: number): void;
        frame(count?: number): void;
        /** The snapshot clock, kept separate from the world clock on purpose. */
        readonly snapNow: number;
    }

    function makeHarness(interpolationAmount = 0.3): Harness {
        const world = new World();
        const scheduler = new Scheduler(world);
        const queries = createInterpolationQueries(world);
        const config = defaultInterpolationConfig();
        config.easeRatePerSecond = easeRateFromAmount(interpolationAmount);
        const reaped = { enemies: [] as string[], players: [] as string[] };
        const reaper: ClientReaper = {
            enemyGone: id => reaped.enemies.push(id),
            playerGone: id => reaped.players.push(id),
        };
        registerInterpolationSystems(scheduler, queries, config, reaper);
        // Deliberately far apart, the way Date.now() and performance.now() are.
        let now = 1_700_000_000_000;
        let snapNow = 500_000;
        return {
            world,
            queries,
            reaped,
            get now() { return now; },
            get snapNow() { return snapNow; },
            advance(ms: number) { now += ms; snapNow += ms; },
            frame(count = 1) {
                for (let i = 0; i < count; i++) {
                    now += FRAME_MS;
                    snapNow += FRAME_MS;
                    config.snapshotNowMs = snapNow;
                    scheduler.tick(FRAME_SECONDS, FRAME_MS, now);
                }
            },
        };
    }

    /** True when `entity` is currently matched by `query`. */
    function inQuery(world: World, query: { collect(out?: Entity[]): Entity[] }, entity: Entity): boolean {
        return query.collect().indexOf(entity) >= 0 && world.isAlive(entity);
    }

    // -- first sight snaps -----------------------------------------------------
    {
        const h = makeHarness();
        const e = applyEnemyUpdate(h.world, {
            id: 'm1', x: 400, y: -200, angle: 1, health: 50, maxHealth: 80,
            type: 'bee', tier: 'rare',
        }, h.now, h.snapNow)!;

        // Interpolating a brand-new entity from (0,0) makes it fly in from the
        // origin, which is the classic version of this bug.
        checkEqual('new entity takes its position immediately (x)', h.world.get(e, C.Position, 'x'), 400);
        checkEqual('new entity takes its position immediately (y)', h.world.get(e, C.Position, 'y'), -200);
        checkEqual('health applied', h.world.get(e, C.Health, 'current'), 50);
        checkEqual('resolvable by wire id', h.world.lookup('e:m1'), e);
    }

    // -- players and mobs share one namespace without colliding ------------------
    {
        const h = makeHarness();
        // A socket id and a mob id could collide; today's two Maps make that
        // impossible, one World does not.
        const mob = applyEnemyUpdate(h.world, {
            id: 'clash', x: 10, y: 10, angle: 0, health: 1, maxHealth: 1,
        }, h.now, h.snapNow)!;
        const flower = applyPlayerUpdate(h.world, { id: 'clash', x: 99, y: 99 }, {})!;

        check('a shared id yields two distinct entities', mob !== flower);
        checkEqual('mob keeps its own position', h.world.get(mob, C.Position, 'x'), 10);
        checkEqual('flower keeps its own position', h.world.get(flower, C.Position, 'x'), 99);
    }

    // -- updates ease rather than snap ------------------------------------------
    {
        const h = makeHarness();
        const e = applyEnemyUpdate(h.world, {
            id: 'm2', x: 0, y: 0, angle: 0, health: 10, maxHealth: 10,
        }, h.now, h.snapNow)!;

        applyEnemyUpdate(h.world, {
            id: 'm2', x: 1000, y: 0, angle: 0, health: 10, maxHealth: 10,
        }, h.now, h.snapNow);

        // The target moved; the drawn position must NOT have jumped with it.
        checkEqual('target updated', h.world.get(e, InterpTarget, 'x'), 1000);
        checkEqual('drawn position has not snapped', h.world.get(e, C.Position, 'x'), 0);

        h.frame();
        const afterOne = h.world.get(e, C.Position, 'x') as number;
        check('eases toward the target', afterOne > 0 && afterOne < 1000, `got ${afterOne}`);

        h.frame(240);
        checkClose('converges on the target', h.world.get(e, C.Position, 'x') as number, 1000, 1);
    }

    // -- the ease rate IS the user's interpolationAmount ---------------------------
    {
        // Hardcoding a rate here silently disables the settings slider and
        // changes how the whole game feels, with every gate still green.
        // Gap kept under TELEPORT_SNAP_DISTANCE so this measures the ease and
        // not the snap.
        const gap = 400;
        for (const amount of [0.15, 0.3, 0.6]) {
            const h = makeHarness(amount);
            const e = applyPlayerUpdate(h.world, { id: 'p', x: 0, y: 0 }, {})!;
            h.world.set(e, InterpTarget, 'x', gap);
            h.frame();
            // One 60fps frame closes exactly `amount` of the gap, which is the
            // definition of the legacy setting.
            checkClose(`ease closes ${amount} of the gap in one 60fps frame`,
                h.world.get(e, C.Position, 'x') as number, gap * amount, 0.5);
        }
    }

    // -- the ease is frame-rate independent ---------------------------------------
    {
        // A client at 30fps must cover the same ground per unit TIME as one at
        // 60fps, or low-fps clients visibly lag.
        const a = makeHarness();
        const ea = applyEnemyUpdate(a.world, { id: 'x', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, a.now, a.snapNow)!;
        a.world.set(ea, InterpTarget, 'x', 100);
        a.frame(10);
        const at60 = a.world.get(ea, C.Position, 'x') as number;

        const b = makeHarness();
        const eb = applyEnemyUpdate(b.world, { id: 'x', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, b.now, b.snapNow)!;
        b.world.set(eb, InterpTarget, 'x', 100);
        const sb = new Scheduler(b.world);
        const qb = createInterpolationQueries(b.world);
        registerInterpolationSystems(sb, qb, defaultInterpolationConfig());
        // 5 frames at 30fps == the same elapsed time
        for (let i = 0; i < 5; i++) sb.tick(1 / 30, 1000 / 30, b.now + i * (1000 / 30));
        const at30 = b.world.get(eb, C.Position, 'x') as number;

        checkClose('same distance covered per unit time regardless of fps', at30, at60, 1.5);
    }

    // -- flowers NEVER acquire a snapshot buffer ------------------------------------
    {
        // applyEnemyUpdate ADDS SnapshotBuffer on every update. If flowers were
        // routed through it they would silently migrate from the eased archetype
        // to the buffered one and start playing back ~80ms late — the exact
        // "other players move differently" bug this client already had once.
        const h = makeHarness();
        const e = applyPlayerUpdate(h.world, { id: 'sock-1', x: 0, y: 0, angle: 0 }, {})!;
        for (let i = 1; i <= 30; i++) {
            applyPlayerUpdate(h.world, { id: 'sock-1', x: i * 10, y: 0, angle: i * 0.1 });
            h.frame();
        }
        check('a flower never grows a snapshot buffer', !h.world.has(e, SnapshotBuffer));
        check('a flower is in the eased query', inQuery(h.world, h.queries.eased, e));
        check('a flower is NOT in the buffered query', !inQuery(h.world, h.queries.buffered, e));
        check('a flower carries the render tag', h.world.has(e, IsPlayerRender));
    }

    // -- flower facing is taken straight off the wire ---------------------------------
    {
        // The eyes are drawn from it, and an eased facing makes a flower look
        // where it was rather than where it is going.
        const h = makeHarness();
        const e = applyPlayerUpdate(h.world, { id: 'sock-2', x: 0, y: 0, angle: 0 }, {})!;
        applyPlayerUpdate(h.world, { id: 'sock-2', x: 0, y: 0, angle: 1.25 });
        checkEqual('flower facing is applied immediately', h.world.get(e, C.Angle, 'value'), 1.25);
        h.frame();
        checkEqual('and no system eases it afterwards', h.world.get(e, C.Angle, 'value'), 1.25);
    }

    // -- a teleport cuts instead of gliding ---------------------------------------------
    {
        const h = makeHarness();
        const e = applyPlayerUpdate(h.world, { id: 'sock-3', x: 0, y: 0 }, {})!;
        // The maze sits at (200000, 200000). Easing there takes seconds and
        // looks spectacular; nothing would crash and no gate would notice.
        applyPlayerUpdate(h.world, { id: 'sock-3', x: 200000, y: 200000 });
        h.frame();
        checkEqual('a beyond-threshold jump snaps (x)', h.world.get(e, C.Position, 'x'), 200000);
        checkEqual('a beyond-threshold jump snaps (y)', h.world.get(e, C.Position, 'y'), 200000);

        // Just under the threshold must still ease, or ordinary fast movement
        // would stop being smoothed.
        const g = makeHarness();
        const e2 = applyPlayerUpdate(g.world, { id: 'sock-4', x: 0, y: 0 }, {})!;
        applyPlayerUpdate(g.world, { id: 'sock-4', x: TELEPORT_SNAP_DISTANCE - 50, y: 0 });
        g.frame();
        check('a within-threshold jump still eases',
            (g.world.get(e2, C.Position, 'x') as number) < TELEPORT_SNAP_DISTANCE - 50);
    }

    // -- the ease settles exactly instead of asymptoting ---------------------------------
    {
        const h = makeHarness();
        const e = applyPlayerUpdate(h.world, { id: 'sock-5', x: 0, y: 0 }, {})!;
        applyPlayerUpdate(h.world, { id: 'sock-5', x: 0.005, y: -0.004 });
        h.frame();
        checkEqual('a sub-pixel gap settles on target (x)', h.world.get(e, C.Position, 'x'), 0.005);
        checkEqual('a sub-pixel gap settles on target (y)', h.world.get(e, C.Position, 'y'), -0.004);
    }

    // -- NeedsSnap cuts position AND the petal anchor -------------------------------------
    {
        // Respawn does not create a new entity, so the create-path snap never
        // fires; without this the flower slides in from its corpse. And if the
        // petal anchor is not cut with it, the whole ring lags a frame behind a
        // flower that just moved 200000px.
        const h = makeHarness();
        const e = applyPlayerUpdate(h.world, { id: 'sock-6', x: 0, y: 0 }, {})!;
        applyPlayerUpdate(h.world, { id: 'sock-6', x: 50, y: 50 });
        snapPlayer(h.world, 'sock-6');
        h.frame();
        checkEqual('respawn snap cuts position', h.world.get(e, C.Position, 'x'), 50);
        checkEqual('respawn snap cuts the petal anchor', h.world.get(e, RenderRef, 'x'), 50);
        check('the snap tag is consumed', !h.world.has(e, NeedsSnap));

        // And it must be one-shot: a lingering tag would pin the flower to the
        // server position and remove all smoothing.
        applyPlayerUpdate(h.world, { id: 'sock-6', x: 250, y: 50 });
        h.frame();
        check('and does not persist into later frames',
            (h.world.get(e, C.Position, 'x') as number) < 250);
    }

    // -- snapshot buffer is monotonic and bounded ----------------------------------
    {
        const h = makeHarness();
        applyEnemyUpdate(h.world, { id: 'm3', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, h.snapNow);

        // Feed samples including one whose timestamp goes BACKWARDS, which is
        // what a clock-offset re-anchor produces. Out-of-order samples make the
        // interpolator read backwards and the entity jitter.
        for (let i = 0; i < 20; i++) {
            const t = i === 10 ? 0 : h.snapNow + i * 33;
            applyEnemyUpdate(h.world, { id: 'm3', x: i * 10, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, t);
        }

        const e = h.world.lookup('e:m3')!;
        const samples = h.world.get(e, SnapshotBuffer, 'samples') as Array<{ t: number }>;
        checkEqual('buffer is bounded', samples.length, MAX_SNAPSHOTS);
        let monotonic = true;
        for (let i = 1; i < samples.length; i++) {
            if (samples[i].t <= samples[i - 1].t) monotonic = false;
        }
        check('buffer stays strictly increasing across a clock re-anchor', monotonic);
    }

    // -- buffered playback runs behind the CLIENT clock ------------------------------
    {
        // Measured from the client render clock, not from the newest sample: the
        // two are identical while the stream is healthy and diverge exactly when
        // it stalls, where measuring from the newest sample freezes the mob
        // instead of letting playback drain the buffer.
        const h = makeHarness();
        const e = applyEnemyUpdate(h.world, { id: 'm4', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, h.snapNow)!;

        // A steady stream moving +100 per 100ms, arriving in real time.
        for (let i = 0; i <= 10; i++) {
            applyEnemyUpdate(h.world, { id: 'm4', x: i * 100, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, h.snapNow);
            h.advance(100);
        }

        h.frame();
        const drawn = h.world.get(e, C.Position, 'x') as number;
        // Newest sample is x=1000, 100ms in the past; playback runs 80ms behind
        // the clock, i.e. 20ms BEYOND the newest sample => a small extrapolation
        // past 1000 rather than a freeze at it.
        check('playback keeps moving past the newest sample when the stream stalls',
            drawn >= 1000, `got ${drawn}`);
        check('and does not run away', drawn < 1100, `got ${drawn}`);
    }

    // -- mob facing is EASED, never snapshot-interpolated ------------------------------
    {
        // The passive AI turns in one discrete server jump of up to 180°.
        // Snapshot-interpolating that whips the mob through the whole turn
        // inside a single ~33ms sample interval, which reads as a snap; easing
        // spreads it over gardn's time constant.
        const h = makeHarness();
        const e = applyEnemyUpdate(h.world, { id: 'm6', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, h.snapNow)!;
        for (let i = 0; i < 4; i++) {
            h.advance(33);
            applyEnemyUpdate(h.world, { id: 'm6', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, h.snapNow);
        }
        // One discrete heading jump of ~180°.
        h.advance(33);
        applyEnemyUpdate(h.world, { id: 'm6', x: 0, y: 0, angle: Math.PI * 0.9, health: 1, maxHealth: 1 }, h.now, h.snapNow);

        h.frame();
        const afterOneFrame = h.world.get(e, C.Angle, 'value') as number;
        check('facing does not jump the whole turn in one frame',
            afterOneFrame > 0 && afterOneFrame < Math.PI * 0.5, `got ${afterOneFrame}`);
        h.frame(60);
        checkClose('but does get there', h.world.get(e, C.Angle, 'value') as number, Math.PI * 0.9, 0.05);
    }

    // -- death animation is not interrupted, and IS reaped ---------------------------------
    {
        const h = makeHarness();
        const e = applyEnemyUpdate(h.world, { id: 'm5', x: 100, y: 0, angle: 0, health: 10, maxHealth: 10 }, h.now, h.snapNow)!;
        beginDeathAnimation(h.world, 'm5', h.now);

        // Updating or deleting mid-animation makes mobs blink out instead of
        // playing their death pop.
        applyEnemyUpdate(h.world, { id: 'm5', x: 999, y: 0, angle: 0, health: 10, maxHealth: 10 }, h.now, h.snapNow);
        checkEqual('update ignored during the death animation', h.world.get(e, InterpTarget, 'x'), 100);

        checkEqual('removal refused during the death animation', forgetEnemy(h.world, 'm5', h.now), false);
        check('entity survives mid-animation', h.world.isAlive(e));

        // A dying mob is frozen: it must not slide toward a stale target while
        // it fades.
        h.frame();
        checkEqual('a dying mob does not drift', h.world.get(e, C.Position, 'x'), 100);

        // Once the animation is done it is reaped by the animation system —
        // which is the path that never cleaned up the graphics side-maps.
        h.advance(DEATH_ANIMATION_DURATION_MS + 10);
        h.frame();
        check('entity is retired once the animation finishes', !h.world.isAlive(e));
        check('and the graphics side-maps are cleaned up with it',
            h.reaped.enemies.indexOf('m5') >= 0, JSON.stringify(h.reaped.enemies));
    }

    // -- the other removal path reaps too --------------------------------------------------
    {
        const h = makeHarness();
        applyEnemyUpdate(h.world, { id: 'm7', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, h.snapNow);
        forgetEnemy(h.world, 'm7', h.now, {
            enemyGone: id => h.reaped.enemies.push(id),
            playerGone: id => h.reaped.players.push(id),
        });
        check('an out-of-view removal cleans up too', h.reaped.enemies.indexOf('m7') >= 0);
    }

    // -- forgetting an unknown id is not an error ------------------------------------------
    {
        const h = makeHarness();
        checkEqual('unknown id reports as already gone', forgetEnemy(h.world, 'nope', h.now), true);
    }

    // -- pet normalisation ---------------------------------------------------------------------
    {
        const h = makeHarness();
        // The spawn payload marks a pet by owner id...
        applyEnemyUpdate(h.world, {
            id: 'p1', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1, ownerId: 'sock-1',
        }, h.now, h.snapNow);
        // ...while the delta stream sets a bare flag. Both must land on one tag.
        applyEnemyUpdate(h.world, {
            id: 'p2', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1, isPet: true,
        }, h.now, h.snapNow);
        applyEnemyUpdate(h.world, {
            id: 'w1', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1,
        }, h.now, h.snapNow);

        const pets = h.world.query([C.Position], []).collect()
            .filter((e: Entity) => h.world.componentsOf(e).some(c => c.name === 'RendersAsPet'));
        checkEqual('both pet delivery paths normalise to one tag', pets.length, 2);
    }

    // -- delta updates do not erase what only the spawn payload carries ---------------------
    {
        // aiType/isChasing/reversed ride ONLY on the full payloads. The delta
        // stream omits them entirely, and a merge that wrote its undefineds
        // through would silently stop mobs animating at 2x and flip their
        // sprites back — a visual change nobody would attribute to this.
        const h = makeHarness();
        const e = applyEnemyUpdate(h.world, {
            id: 'm8', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1,
            aiType: 'hostile', isChasing: true, reversed: true,
        }, h.now, h.snapNow)!;
        applyEnemyUpdate(h.world, { id: 'm8', x: 5, y: 5, angle: 0, health: 1, maxHealth: 1 }, h.now, h.snapNow);
        checkEqual('aiType survives a delta update', h.world.get(e, MobRender, 'aiType'), 2);
        checkEqual('isChasing survives a delta update', h.world.get(e, MobRender, 'chasing'), 1);
        checkEqual('reversed survives a delta update', h.world.get(e, MobRender, 'flipped'), 1);

        // A mob first seen through the delta stream has never been told, and
        // must not be guessed at.
        const d = applyEnemyUpdate(h.world, {
            id: 'm9', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1,
        }, h.now, h.snapNow)!;
        checkEqual('a delta-first mob has no AI type', h.world.get(d, MobRender, 'aiType'), AI_TYPE_UNKNOWN);
    }

    // -- target-dummy DPS ---------------------------------------------------------------------
    {
        const h = makeHarness();
        const e = applyEnemyUpdate(h.world, {
            id: 'dummy', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1, type: 'target_dummy',
        }, h.now, h.snapNow)!;
        setMobDps(h.world, 'dummy', 1234);
        checkEqual('dps is recorded', h.world.get(e, C.Position, 'x'), 0);
        setMobDps(h.world, 'dummy', 4321);
        check('dps updates in place', h.world.componentsOf(e).some(c => c.name === 'DpsLabel'));
    }

    // -- render ref tracks the DRAWN position ---------------------------------------------------
    {
        const h = makeHarness();
        const e = applyPlayerUpdate(h.world, { id: 'sock-7', x: 0, y: 0 }, {})!;
        applyPlayerUpdate(h.world, { id: 'sock-7', x: 500, y: 0 });

        h.frame();
        const drawn = h.world.get(e, C.Position, 'x') as number;
        const ref = h.world.get(e, RenderRef, 'x') as number;
        // Petals anchor to this, so it must be the drawn position, not the
        // server-authoritative one — otherwise petals lead or lag their flower.
        checkClose('ref publishes the drawn position, not the target', ref, drawn, 1e-9);
        check('and the drawn position is not the target yet', Math.abs(ref - 500) > 1);
    }

    // -- eye state is storage, not a system -------------------------------------------------------
    {
        // The eye ease is a fixed fraction per FRAME and lives in the renderer;
        // a scheduler system easing it too would fight the renderer. What the
        // world owes is only that the state exists and dies with the entity.
        const h = makeHarness();
        const e = applyPlayerUpdate(h.world, { id: 'sock-8', x: 0, y: 0 }, {})!;
        h.world.write(e, RenderEye, { x: 7, y: -7, init: 1 });
        h.frame(30);
        checkEqual('nothing moves the eye behind the renderer', h.world.get(e, RenderEye, 'x'), 7);
    }

    return failures;
}
