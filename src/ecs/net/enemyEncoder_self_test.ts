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

import * as C from '../components';
import { World } from '../world';
import { rarityToId } from '../interning';
import { spawnMob, makePet } from '../prefabs';
import { encodeEnemyDelta, SentEnemyState } from './enemyEncoder';

export function runEnemyEncoderSelfTest(): string[] {
    const failures: string[] = [];

    const check = (name: string, condition: boolean, detail?: string) => {
        if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name: string, actual: unknown, expected: unknown) => {
        if (actual !== expected) failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };

    const deps = {
        // Stand-in mob config: every (type, rarity) defaults to 100 max health.
        defaultMaxHealthOf: () => 100,
    };

    const world = new World();
    const spec = (id: string, over: Partial<Parameters<typeof spawnMob>[1]> = {}) => ({
        id, type: 'bee', tier: 'common', x: 100.26, y: 200.74, angle: 0,
        health: 80, maxHealth: 100, speed: 50, damage: 1, radius: 10, now: 0,
        ...over,
    });

    // -- first sight ----------------------------------------------------------
    {
        const mob = spawnMob(world, spec('m1'));
        const result = encodeEnemyDelta(world, mob, undefined, 0.5, deps);
        check('first sight always encodes', result !== null);
        const wire = result!.wire;
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
        const mob = spawnMob(world, spec('m2', {
            tier: 'ultra', angle: 1.234, health: 5000, maxHealth: 5000,
        }));
        makePet(world, mob, world.create());
        const result = encodeEnemyDelta(world, mob, undefined, 0.5, deps)!;
        checkEqual('non-common tier rides as its name', result.wire.T, 'ultra');
        checkEqual('angle quantises to 0.05', result.wire.a, Math.round(1.234 / 0.05) * 0.05);
        checkEqual('non-default maxHealth rides the wire', result.wire.H, 5000);
        checkEqual('pets carry the marker on first sight', result.wire.o, 1);
    }

    // -- unchanged mobs encode to nothing -------------------------------------
    {
        const mob = spawnMob(world, spec('m3'));
        const first = encodeEnemyDelta(world, mob, undefined, 0.5, deps)!;
        const again = encodeEnemyDelta(world, mob, first.next, 0.5, deps);
        checkEqual('an unchanged mob encodes to null', again, null);

        // Sub-quantum movement is still "unchanged" — that is the point of
        // quantising the SENT state rather than the live one.
        world.set(mob, C.Position, 'x', 100.3);
        checkEqual('sub-quantum movement stays null',
            encodeEnemyDelta(world, mob, first.next, 0.5, deps), null);
    }

    // -- deltas carry only what changed ---------------------------------------
    {
        const mob = spawnMob(world, spec('m4'));
        const first = encodeEnemyDelta(world, mob, undefined, 0.5, deps)!;

        world.set(mob, C.Health, 'current', 42.4);
        const delta = encodeEnemyDelta(world, mob, first.next, 0.5, deps)!;
        checkEqual('changed health rides the delta', delta.wire.h, 42);
        check('unchanged fields are omitted from the delta',
            delta.wire.x === undefined && delta.wire.y === undefined
            && delta.wire.a === undefined && delta.wire.t === undefined
            && delta.wire.T === undefined && delta.wire.H === undefined);
        check('pet marker never rides a delta', delta.wire.o === undefined);

        // The next baseline carries the change, so repeating is null again.
        checkEqual('delta advances the baseline',
            encodeEnemyDelta(world, mob, delta.next, 0.5, deps), null);
    }

    // -- a tier change converts back to a wire string -------------------------
    {
        const mob = spawnMob(world, spec('m5'));
        const first = encodeEnemyDelta(world, mob, undefined, 0.5, deps)!;
        world.set(mob, C.MobKind, 'tier', rarityToId('epic'));
        const delta = encodeEnemyDelta(world, mob, first.next, 0.5, deps)!;
        checkEqual('tier change rides as its name', delta.wire.T, 'epic');
    }

    // -- precision is per-client ----------------------------------------------
    {
        const mob = spawnMob(world, spec('m6', { x: 100.26, y: 0 }));
        const fine = encodeEnemyDelta(world, mob, undefined, 0.5, deps)!;
        const coarse = encodeEnemyDelta(world, mob, undefined, 1, deps)!;
        checkEqual('fine grid keeps the half unit', fine.wire.x, 100.5);
        checkEqual('slow-connection grid rounds to whole units', coarse.wire.x, 100);
    }

    // -- SentEnemyState round-trips through a Map (the per-socket store) ------
    {
        const mob = spawnMob(world, spec('m7'));
        const store = new Map<string, SentEnemyState>();
        const first = encodeEnemyDelta(world, mob, store.get('m7'), 0.5, deps)!;
        store.set('m7', first.next);
        checkEqual('stored baseline suppresses re-send',
            encodeEnemyDelta(world, mob, store.get('m7'), 0.5, deps), null);
    }

    return failures;
}
