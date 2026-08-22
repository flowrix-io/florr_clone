"use strict";
/**
 * Self-test for the enemy wire encoder.
 *
 * Pins the delta protocol the client depends on, now that the broadcast
 * encodes from component columns: the first-sight record and its
 * omit-if-default rules (common tier, zero angle, config maxHealth), the
 * changed-fields-only delta, null for an unchanged mob, quantisation, the
 * interned-id -> wire-string conversion, and the pet marker riding only the
 * first-sight record.
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
exports.runEnemyEncoderSelfTest = runEnemyEncoderSelfTest;
const C = __importStar(require("../components"));
const world_1 = require("../world");
const interning_1 = require("../interning");
const prefabs_1 = require("../prefabs");
const enemyEncoder_1 = require("./enemyEncoder");
function runEnemyEncoderSelfTest() {
    const failures = [];
    const check = (name, condition, detail) => {
        if (!condition)
            failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name, actual, expected) => {
        if (actual !== expected)
            failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    const deps = {
        // Stand-in mob config: every (type, rarity) defaults to 100 max health.
        defaultMaxHealthOf: () => 100,
    };
    const world = new world_1.World();
    const spec = (id, over = {}) => ({
        id, type: 'bee', tier: 'common', x: 100.26, y: 200.74, angle: 0,
        health: 80, maxHealth: 100, speed: 50, damage: 1, radius: 10, now: 0,
        ...over,
    });
    // -- first sight ----------------------------------------------------------
    {
        const mob = (0, prefabs_1.spawnMob)(world, spec('m1'));
        const result = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, undefined, 0.5, deps);
        check('first sight always encodes', result !== null);
        const wire = result.wire;
        checkEqual('id rides the wire', wire.i, 'm1');
        checkEqual('type converts to its wire string', wire.t, 'bee');
        check('common tier is omitted', wire.T === undefined);
        checkEqual('x quantises to the precision grid', wire.x, 100.5);
        checkEqual('y quantises to the precision grid', wire.y, 200.5);
        check('zero angle is omitted', wire.a === undefined);
        checkEqual('health rides the wire', wire.h, 80);
        check('config-default maxHealth is omitted', wire.H === undefined);
        check('wild mobs carry no pet marker', wire.o === undefined);
    }
    // -- first sight, nothing default -----------------------------------------
    {
        const mob = (0, prefabs_1.spawnMob)(world, spec('m2', {
            tier: 'ultra', angle: 1.234, health: 5000, maxHealth: 5000,
        }));
        (0, prefabs_1.makePet)(world, mob, world.create());
        const result = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, undefined, 0.5, deps);
        checkEqual('non-common tier rides as its name', result.wire.T, 'ultra');
        checkEqual('angle quantises to 0.05', result.wire.a, Math.round(1.234 / 0.05) * 0.05);
        checkEqual('non-default maxHealth rides the wire', result.wire.H, 5000);
        checkEqual('pets carry the marker on first sight', result.wire.o, 1);
    }
    // -- unchanged mobs encode to nothing -------------------------------------
    {
        const mob = (0, prefabs_1.spawnMob)(world, spec('m3'));
        const first = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, undefined, 0.5, deps);
        const again = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, first.next, 0.5, deps);
        checkEqual('an unchanged mob encodes to null', again, null);
        // Sub-quantum movement is still "unchanged" — that is the point of
        // quantising the SENT state rather than the live one.
        world.set(mob, C.Position, 'x', 100.3);
        checkEqual('sub-quantum movement stays null', (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, first.next, 0.5, deps), null);
    }
    // -- deltas carry only what changed ---------------------------------------
    {
        const mob = (0, prefabs_1.spawnMob)(world, spec('m4'));
        const first = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, undefined, 0.5, deps);
        world.set(mob, C.Health, 'current', 42.4);
        const delta = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, first.next, 0.5, deps);
        checkEqual('changed health rides the delta', delta.wire.h, 42);
        check('unchanged fields are omitted from the delta', delta.wire.x === undefined && delta.wire.y === undefined
            && delta.wire.a === undefined && delta.wire.t === undefined
            && delta.wire.T === undefined && delta.wire.H === undefined);
        check('pet marker never rides a delta', delta.wire.o === undefined);
        // The next baseline carries the change, so repeating is null again.
        checkEqual('delta advances the baseline', (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, delta.next, 0.5, deps), null);
    }
    // -- a tier change converts back to a wire string -------------------------
    {
        const mob = (0, prefabs_1.spawnMob)(world, spec('m5'));
        const first = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, undefined, 0.5, deps);
        world.set(mob, C.MobKind, 'tier', (0, interning_1.rarityToId)('epic'));
        const delta = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, first.next, 0.5, deps);
        checkEqual('tier change rides as its name', delta.wire.T, 'epic');
    }
    // -- precision is per-client ----------------------------------------------
    {
        const mob = (0, prefabs_1.spawnMob)(world, spec('m6', { x: 100.26, y: 0 }));
        const fine = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, undefined, 0.5, deps);
        const coarse = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, undefined, 1, deps);
        checkEqual('fine grid keeps the half unit', fine.wire.x, 100.5);
        checkEqual('slow-connection grid rounds to whole units', coarse.wire.x, 100);
    }
    // -- SentEnemyState round-trips through a Map (the per-socket store) ------
    {
        const mob = (0, prefabs_1.spawnMob)(world, spec('m7'));
        const store = new Map();
        const first = (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, store.get('m7'), 0.5, deps);
        store.set('m7', first.next);
        checkEqual('stored baseline suppresses re-send', (0, enemyEncoder_1.encodeEnemyDelta)(world, mob, store.get('m7'), 0.5, deps), null);
    }
    return failures;
}
