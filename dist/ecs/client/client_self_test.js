"use strict";
/**
 * Self-test for the client render layer.
 *
 * Pins the behaviours that make the client look right rather than merely be
 * correct: first sight snaps instead of flying in from the origin, remote
 * entities ease instead of stuttering at the tick rate, death animations are
 * not interrupted, and the snapshot buffer stays monotonic across a clock
 * re-anchor.
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
exports.runClientSelfTest = runClientSelfTest;
const C = __importStar(require("../components"));
const system_1 = require("../system");
const world_1 = require("../world");
const components_1 = require("./components");
const ingest_1 = require("./ingest");
const interpolation_1 = require("./interpolation");
const FRAME_SECONDS = 1 / 60;
const FRAME_MS = 1000 / 60;
function runClientSelfTest() {
    const failures = [];
    const check = (name, condition, detail) => {
        if (!condition)
            failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name, actual, expected) => {
        if (actual !== expected)
            failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    const checkClose = (name, actual, expected, tolerance) => {
        if (!(Math.abs(actual - expected) <= tolerance)) {
            failures.push(`${name}: expected ~${expected} (+-${tolerance}), got ${actual}`);
        }
    };
    function makeHarness() {
        const world = new world_1.World();
        const scheduler = new system_1.Scheduler(world);
        (0, interpolation_1.registerInterpolationSystems)(scheduler, (0, interpolation_1.createInterpolationQueries)(world));
        let now = 500000;
        return {
            world,
            get now() { return now; },
            advance(ms) { now += ms; },
            frame(count = 1) {
                for (let i = 0; i < count; i++) {
                    now += FRAME_MS;
                    scheduler.tick(FRAME_SECONDS, FRAME_MS, now);
                }
            },
        };
    }
    // -- first sight snaps -----------------------------------------------------
    {
        const h = makeHarness();
        const e = (0, ingest_1.applyEnemyUpdate)(h.world, {
            id: 'm1', x: 400, y: -200, angle: 1, health: 50, maxHealth: 80,
            type: 'bee', tier: 'rare',
        }, h.now);
        // Interpolating a brand-new entity from (0,0) makes it fly in from the
        // origin, which is the classic version of this bug.
        checkEqual('new entity takes its position immediately (x)', h.world.get(e, C.Position, 'x'), 400);
        checkEqual('new entity takes its position immediately (y)', h.world.get(e, C.Position, 'y'), -200);
        checkEqual('health applied', h.world.get(e, C.Health, 'current'), 50);
        checkEqual('resolvable by wire id', h.world.lookup('m1'), e);
    }
    // -- updates ease rather than snap ------------------------------------------
    {
        const h = makeHarness();
        const e = (0, ingest_1.applyEnemyUpdate)(h.world, {
            id: 'm2', x: 0, y: 0, angle: 0, health: 10, maxHealth: 10,
        }, h.now);
        (0, ingest_1.applyEnemyUpdate)(h.world, {
            id: 'm2', x: 1000, y: 0, angle: 0, health: 10, maxHealth: 10,
        }, h.now);
        // The target moved; the drawn position must NOT have jumped with it.
        checkEqual('target updated', h.world.get(e, components_1.InterpTarget, 'x'), 1000);
        checkEqual('drawn position has not snapped', h.world.get(e, C.Position, 'x'), 0);
        h.frame();
        const afterOne = h.world.get(e, C.Position, 'x');
        check('eases toward the target', afterOne > 0 && afterOne < 1000, `got ${afterOne}`);
        h.frame(120);
        checkClose('converges on the target', h.world.get(e, C.Position, 'x'), 1000, 1);
    }
    // -- the ease is frame-rate independent ---------------------------------------
    {
        // A client at 30fps must cover the same ground per unit TIME as one at
        // 60fps, or low-fps clients visibly lag.
        const a = makeHarness();
        const ea = (0, ingest_1.applyEnemyUpdate)(a.world, { id: 'x', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, a.now);
        a.world.set(ea, components_1.InterpTarget, 'x', 100);
        const scheduler30 = new system_1.Scheduler(a.world);
        (0, interpolation_1.registerInterpolationSystems)(scheduler30, (0, interpolation_1.createInterpolationQueries)(a.world));
        // 10 frames at 60fps
        a.frame(10);
        const at60 = a.world.get(ea, C.Position, 'x');
        const b = makeHarness();
        const eb = (0, ingest_1.applyEnemyUpdate)(b.world, { id: 'x', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, b.now);
        b.world.set(eb, components_1.InterpTarget, 'x', 100);
        const sb = new system_1.Scheduler(b.world);
        (0, interpolation_1.registerInterpolationSystems)(sb, (0, interpolation_1.createInterpolationQueries)(b.world));
        // 5 frames at 30fps == the same elapsed time
        for (let i = 0; i < 5; i++)
            sb.tick(1 / 30, 1000 / 30, b.now + i * (1000 / 30));
        const at30 = b.world.get(eb, C.Position, 'x');
        checkClose('same distance covered per unit time regardless of fps', at30, at60, 1.5);
    }
    // -- snapshot buffer is monotonic and bounded ----------------------------------
    {
        const h = makeHarness();
        (0, ingest_1.applyEnemyUpdate)(h.world, { id: 'm3', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now);
        // Feed samples including one whose timestamp goes BACKWARDS, which is
        // what a clock-offset re-anchor produces. Out-of-order samples make the
        // interpolator read backwards and the entity jitter.
        for (let i = 0; i < 20; i++) {
            const t = i === 10 ? 0 : h.now + i * 33;
            (0, ingest_1.applyEnemyUpdate)(h.world, { id: 'm3', x: i * 10, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, t);
        }
        const e = h.world.lookup('m3');
        const samples = h.world.get(e, components_1.SnapshotBuffer, 'samples');
        checkEqual('buffer is bounded', samples.length, components_1.MAX_SNAPSHOTS);
        let monotonic = true;
        for (let i = 1; i < samples.length; i++) {
            if (samples[i].t <= samples[i - 1].t)
                monotonic = false;
        }
        check('buffer stays strictly increasing across a clock re-anchor', monotonic);
    }
    // -- buffered playback runs behind the newest sample ------------------------------
    {
        const h = makeHarness();
        const e = (0, ingest_1.applyEnemyUpdate)(h.world, { id: 'm4', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now);
        // A steady stream moving +100 per 100ms, so playback position is
        // predictable.
        let t = h.now;
        for (let i = 0; i <= 10; i++) {
            (0, ingest_1.applyEnemyUpdate)(h.world, { id: 'm4', x: i * 100, y: 0, angle: 0, health: 1, maxHealth: 1 }, h.now, t);
            t += 100;
        }
        h.frame();
        const drawn = h.world.get(e, C.Position, 'x');
        // Newest sample is x=1000 at the newest t; playback runs
        // SNAPSHOT_DELAY_MS behind, i.e. one 100ms step back => x≈900.
        const expected = 1000 - interpolation_1.SNAPSHOT_DELAY_MS;
        checkClose('plays back behind the newest sample', drawn, expected, 25);
        check('does not draw the newest sample directly', drawn < 1000);
    }
    // -- death animation is not interrupted ---------------------------------------------
    {
        const h = makeHarness();
        const e = (0, ingest_1.applyEnemyUpdate)(h.world, { id: 'm5', x: 100, y: 0, angle: 0, health: 10, maxHealth: 10 }, h.now);
        (0, ingest_1.beginDeathAnimation)(h.world, 'm5', h.now);
        // Updating or deleting mid-animation makes mobs blink out instead of
        // playing their death pop.
        (0, ingest_1.applyEnemyUpdate)(h.world, { id: 'm5', x: 999, y: 0, angle: 0, health: 10, maxHealth: 10 }, h.now);
        checkEqual('update ignored during the death animation', h.world.get(e, components_1.InterpTarget, 'x'), 100);
        checkEqual('removal refused during the death animation', (0, ingest_1.forgetEnemy)(h.world, 'm5', h.now), false);
        check('entity survives mid-animation', h.world.isAlive(e));
        // Once the animation is done it is reaped by the animation system.
        h.advance(ingest_1.DEATH_ANIMATION_DURATION_MS + 10);
        h.frame();
        check('entity is retired once the animation finishes', !h.world.isAlive(e));
    }
    // -- forgetting an unknown id is not an error ------------------------------------------
    {
        const h = makeHarness();
        checkEqual('unknown id reports as already gone', (0, ingest_1.forgetEnemy)(h.world, 'nope', h.now), true);
    }
    // -- pet normalisation ---------------------------------------------------------------------
    {
        const h = makeHarness();
        // The spawn payload marks a pet by owner id...
        (0, ingest_1.applyEnemyUpdate)(h.world, {
            id: 'p1', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1, ownerId: 'sock-1',
        }, h.now);
        // ...while the delta stream sets a bare flag. Both must land on one tag.
        (0, ingest_1.applyEnemyUpdate)(h.world, {
            id: 'p2', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1, isPet: true,
        }, h.now);
        (0, ingest_1.applyEnemyUpdate)(h.world, {
            id: 'w1', x: 0, y: 0, angle: 0, health: 1, maxHealth: 1,
        }, h.now);
        const pets = h.world.query([C.Position], []).collect()
            .filter((e) => h.world.componentsOf(e).some(c => c.name === 'RendersAsPet'));
        checkEqual('both pet delivery paths normalise to one tag', pets.length, 2);
    }
    // -- render ref tracks the DRAWN position ---------------------------------------------------
    {
        const h = makeHarness();
        const e = h.world.create();
        h.world.add(e, C.Position, { x: 0, y: 0 });
        h.world.add(e, components_1.InterpTarget, { x: 500, y: 0, angle: 0 });
        h.world.add(e, components_1.RenderRef, { x: 0, y: 0 });
        h.frame();
        const drawn = h.world.get(e, C.Position, 'x');
        const ref = h.world.get(e, components_1.RenderRef, 'x');
        // Petals anchor to this, so it must be the drawn position, not the
        // server-authoritative one — otherwise petals lead or lag their flower.
        checkClose('ref publishes the drawn position, not the target', ref, drawn, 1e-9);
        check('and the drawn position is not the target yet', Math.abs(ref - 500) > 1);
    }
    // -- eye easing ------------------------------------------------------------------------------
    {
        const h = makeHarness();
        const e = h.world.create();
        h.world.add(e, components_1.RenderEye, { x: 0, y: 0, targetX: 10, targetY: -10 });
        h.frame(60);
        checkClose('eye eases toward its target x', h.world.get(e, components_1.RenderEye, 'x'), 10, 0.5);
        checkClose('eye eases toward its target y', h.world.get(e, components_1.RenderEye, 'y'), -10, 0.5);
    }
    return failures;
}
