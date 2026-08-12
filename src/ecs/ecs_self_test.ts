/**
 * Self-test for the ECS core.
 *
 * Exercises the invariants that are expensive to debug once systems are built
 * on top: handle generations, swap-remove row fixups, archetype moves carrying
 * field data, reference-field clearing (the heap-leak guard), deferred
 * structural changes, and the f64-coordinate decision that the maze depends on.
 *
 * Exported as a function with no side effects at import time so it can be
 * driven from a runner script without a test framework — the project has none.
 */

import { createMask, maskContainsAll, maskIntersects, maskSet } from './archetype';
import { allComponents, defineComponent, defineTag } from './component';
import { entityGeneration, entityIndex, makeEntity, Entity, NULL_ENTITY } from './entity';
import { Phase, Scheduler } from './system';
import { World } from './world';
import { mobTypes, rarityToId, idToRarity } from './interning';
import * as C from './components';

const Position = defineComponent('TestPosition', { x: 'f64', y: 'f64' });
const Velocity = defineComponent('TestVelocity', { x: 'f32', y: 'f32' });
const Health = defineComponent('TestHealth', { current: 'f32', max: 'f32' });
const Payload = defineComponent('TestPayload', { data: 'obj', label: 'str' });
const IsPet = defineTag('TestIsPet');

type Failure = string;

export function runEcsSelfTest(): Failure[] {
    const failures: Failure[] = [];

    const check = (name: string, condition: boolean, detail?: string) => {
        if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name: string, actual: unknown, expected: unknown) => {
        if (actual !== expected) failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };

    // -- handle packing -------------------------------------------------------
    {
        const e = makeEntity(1234, 5678);
        checkEqual('handle index roundtrip', entityIndex(e), 1234);
        checkEqual('handle generation roundtrip', entityGeneration(e), 5678);

        // The packing must survive generations far past what a 32-bit signed
        // bitwise encoding could hold — that is the whole reason for arithmetic
        // packing (see entity.ts).
        const big = makeEntity(16_777_215, 100_000_000);
        checkEqual('handle index roundtrip (max)', entityIndex(big), 16_777_215);
        checkEqual('handle generation roundtrip (large)', entityGeneration(big), 100_000_000);
        check('large handle stays an exact integer', Number.isSafeInteger(big));
    }

    // -- lifecycle and stale handles -----------------------------------------
    {
        const world = new World();
        const a = world.create();
        check('created entity is alive', world.isAlive(a));
        checkEqual('world size after create', world.size(), 1);

        world.destroy(a);
        check('destroyed entity is not alive', !world.isAlive(a));
        checkEqual('world size after destroy', world.size(), 0);

        // Recycling the slot must not resurrect the old handle.
        const b = world.create();
        checkEqual('slot is recycled', entityIndex(b), entityIndex(a));
        check('recycled slot has a new generation', entityGeneration(b) !== entityGeneration(a));
        check('stale handle stays dead after recycle', !world.isAlive(a));
        check('new handle is alive', world.isAlive(b));

        checkEqual('destroying twice is a no-op', world.destroy(a), false);
    }

    // -- component add/remove and archetype moves ----------------------------
    {
        const world = new World();
        const e = world.create();

        world.add(e, Position, { x: 10, y: 20 });
        world.add(e, Health, { current: 50, max: 100 });
        check('has Position', world.has(e, Position));
        check('has Health', world.has(e, Health));
        checkEqual('Position.x', world.get(e, Position, 'x'), 10);
        checkEqual('Health.max', world.get(e, Health, 'max'), 100);

        // Adding a third component moves the entity to a new archetype; the
        // already-written fields must come along.
        world.add(e, Velocity, { x: 1, y: 2 });
        checkEqual('Position.x survives archetype move', world.get(e, Position, 'x'), 10);
        checkEqual('Health.current survives archetype move', world.get(e, Health, 'current'), 50);
        checkEqual('Velocity.y after add', world.get(e, Velocity, 'y'), 2);

        world.remove(e, Health);
        check('Health removed', !world.has(e, Health));
        checkEqual('Position.y survives removal', world.get(e, Position, 'y'), 20);

        // A tag carries no data but changes the archetype.
        world.add(e, IsPet);
        check('tag present', world.has(e, IsPet));
        checkEqual('Position.x survives tag add', world.get(e, Position, 'x'), 10);

        // Re-adding an existing component must not wipe it.
        world.add(e, Position);
        checkEqual('re-add does not clear fields', world.get(e, Position, 'x'), 10);
    }

    // -- fresh components start zeroed, not recycled --------------------------
    {
        const world = new World();
        const first = world.create();
        world.add(first, Health, { current: 999, max: 999 });
        world.destroy(first);

        const second = world.create();
        world.add(second, Health);
        checkEqual('recycled row zeroes numeric fields', world.get(second, Health, 'current'), 0);
    }

    // -- swap-remove keeps rows dense and locations correct -------------------
    {
        const world = new World();
        const made: Entity[] = [];
        for (let i = 0; i < 50; i++) {
            const e = world.create();
            world.add(e, Position, { x: i, y: -i });
            made.push(e);
        }

        // Destroy from the front so every removal triggers a tail swap.
        for (let i = 0; i < 25; i++) world.destroy(made[i]);

        for (let i = 25; i < 50; i++) {
            const e = made[i];
            check(`survivor ${i} alive`, world.isAlive(e));
            checkEqual(`survivor ${i} keeps x after swaps`, world.get(e, Position, 'x'), i);
            checkEqual(`survivor ${i} keeps y after swaps`, world.get(e, Position, 'y'), -i);
        }
        checkEqual('surviving count', world.size(), 25);
    }

    // -- queries and SoA iteration --------------------------------------------
    {
        const world = new World();
        for (let i = 0; i < 100; i++) {
            const e = world.create();
            world.add(e, Position, { x: i, y: 0 });
            world.add(e, Velocity, { x: 2, y: 0 });
            // Half also get a tag, forcing two distinct archetypes.
            if (i % 2 === 0) world.add(e, IsPet);
        }

        const movers = world.query([Position, Velocity]);
        checkEqual('query matches both archetypes', movers.count(), 100);

        const pets = world.query([Position, IsPet]);
        checkEqual('tag query count', pets.count(), 50);

        const nonPets = world.query([Position], [IsPet]);
        checkEqual('exclusion query count', nonPets.count(), 50);

        // Integrate one step through the chunked API.
        let visitedChunks = 0;
        movers.chunks(chunk => {
            visitedChunks++;
            const p = chunk.cols(Position);
            const v = chunk.cols(Velocity);
            for (let i = 0; i < chunk.count; i++) p.x[i] += v.x[i];
        });
        checkEqual('chunk count', visitedChunks, 2);

        let sum = 0;
        movers.chunks(chunk => {
            const p = chunk.cols(Position);
            for (let i = 0; i < chunk.count; i++) sum += p.x[i];
        });
        // sum of 0..99 plus 2 per entity
        checkEqual('integration result', sum, 4950 + 200);

        // A chunk exposes every component its ARCHETYPE has, not just the ones
        // the query named — so asking a pet chunk for Velocity legitimately
        // works here, since these entities all carry it.
        let velocityReadable = true;
        try {
            pets.chunks(chunk => chunk.cols(Velocity));
        } catch {
            velocityReadable = false;
        }
        check('cols() serves components present on the archetype', velocityReadable);

        // But a component genuinely absent from the archetype must throw rather
        // than hand back undefined arrays that read as silent zeroes.
        let threw = false;
        try {
            pets.chunks(chunk => chunk.cols(Health));
        } catch {
            threw = true;
        }
        check('cols() throws for component absent from the archetype', threw);
    }

    // -- reference fields are released on destroy (heap-leak guard) -----------
    {
        const world = new World();
        const held: Array<{ big: number[] }> = [];

        const entities: Entity[] = [];
        for (let i = 0; i < 10; i++) {
            const e = world.create();
            const payload = { big: [i] };
            held.push(payload);
            world.add(e, Payload, { data: payload, label: `label-${i}` });
            entities.push(e);
        }
        checkEqual('obj field readable', (world.get(entities[3], Payload, 'data') as { big: number[] }).big[0], 3);
        checkEqual('str field readable', world.get(entities[3], Payload, 'label'), 'label-3');

        for (const e of entities) world.destroy(e);

        // After destroying everything the archetype's columns must not still
        // point at the payloads. Inspecting storage directly is the only way to
        // assert this without a heap snapshot.
        let leaked = 0;
        for (const archetype of world.archetypes) {
            const col = archetype.columns[Payload.id];
            if (!col) continue;
            const data = col.arrays.data as unknown[];
            const label = col.arrays.label as unknown[];
            for (let i = 0; i < data.length; i++) {
                if (data[i] !== undefined) leaked++;
                if (label[i] !== undefined) leaked++;
            }
        }
        checkEqual('no reference field retained after destroy', leaked, 0);
    }

    // -- external string ids --------------------------------------------------
    {
        const world = new World();
        const e = world.create();
        world.bindExternalId(e, 'socket-abc');
        checkEqual('lookup by external id', world.lookup('socket-abc'), e);
        checkEqual('external id of entity', world.externalIdOf(e), 'socket-abc');

        world.destroy(e);
        checkEqual('lookup after destroy', world.lookup('socket-abc'), undefined);

        // Rebinding must not leave the old key resolving to the entity.
        const f = world.create();
        world.bindExternalId(f, 'first');
        world.bindExternalId(f, 'second');
        checkEqual('old external id released on rebind', world.lookup('first'), undefined);
        checkEqual('new external id resolves', world.lookup('second'), f);
    }

    // -- deferred structural changes during iteration --------------------------
    {
        const world = new World();
        const scheduler = new Scheduler(world);

        for (let i = 0; i < 20; i++) {
            const e = world.create();
            world.add(e, Health, { current: i, max: 20 });
        }

        const mortal = world.query([Health]);
        let visited = 0;

        scheduler.add('reap', Phase.Lifetime, ctx => {
            mortal.chunks(chunk => {
                const h = chunk.cols(Health);
                for (let i = 0; i < chunk.count; i++) {
                    visited++;
                    // Destroying inline here would swap an unvisited row into
                    // position `i` and silently skip it; the command buffer is
                    // what makes this correct.
                    if (h.current[i] < 10) ctx.cmd.destroy(chunk.entities[i] as Entity);
                }
            });
        });

        scheduler.tick(1 / 30, 1000 / 30, 0);
        checkEqual('every entity visited exactly once', visited, 20);
        checkEqual('deferred destroys applied', world.size(), 10);
    }

    // -- scheduler ordering and striding ---------------------------------------
    {
        const world = new World();
        const scheduler = new Scheduler(world);
        const order: string[] = [];
        let stridedCalls = 0;

        // Registered out of phase order on purpose.
        scheduler.add('net', Phase.Networking, () => { order.push('net'); });
        scheduler.add('sim', Phase.Simulation, () => { order.push('sim'); });
        scheduler.add('grid', Phase.SpatialIndex, () => { order.push('grid'); });
        scheduler.add('strided', Phase.Lifetime, () => { stridedCalls++; }, { interval: 5, offset: 2 });

        scheduler.tick(1 / 30, 1000 / 30, 0);
        checkEqual('phase ordering', order.join(','), 'grid,sim,net');

        for (let i = 0; i < 19; i++) scheduler.tick(1 / 30, 1000 / 30, 0);
        // 20 ticks total, fires on ticks 2, 7, 12, 17
        checkEqual('strided system call count', stridedCalls, 4);

        let dupThrew = false;
        try {
            scheduler.add('sim', Phase.Simulation, () => {});
        } catch {
            dupThrew = true;
        }
        check('duplicate system name rejected', dupThrew);
    }

    // -- f64 world coordinates hold up at maze offsets -------------------------
    {
        // The maze sits at (200000, 200000). This is the concrete reason
        // Position uses f64: accumulating a small per-tick step out there must
        // not quantise away. With f32 the representable step at 200k is ~0.015,
        // so a 0.01px movement would round to nothing and the flower would stick.
        const world = new World();
        const e = world.create();
        world.add(e, Position, { x: 200000, y: 200000 });
        for (let i = 0; i < 100; i++) {
            world.set(e, Position, 'x', world.get(e, Position, 'x') + 0.01);
        }
        const moved = (world.get(e, Position, 'x') as number) - 200000;
        check('f64 position accumulates sub-pixel steps at maze offset',
            Math.abs(moved - 1) < 1e-6, `drifted to ${moved}`);

        // Demonstrate the failure the f64 choice avoids, so the rationale stays
        // testable rather than folklore.
        const f32 = new Float32Array(1);
        f32[0] = 200000;
        for (let i = 0; i < 100; i++) f32[0] += 0.01;
        check('f32 would have lost the same motion', Math.abs(f32[0] - 200000 - 1) > 0.1);
    }

    // -- the game component catalog -------------------------------------------
    {
        // Component ids must be dense and unique: archetype bitmasks are sized
        // from the count and index by id, so a gap or a collision corrupts
        // storage rather than failing loudly.
        const seenIds = new Set<number>();
        const seenNames = new Set<string>();
        let denseThroughout = true;
        const components = allComponents();
        for (let i = 0; i < components.length; i++) {
            const c = components[i];
            if (c.id !== i) denseThroughout = false;
            seenIds.add(c.id);
            seenNames.add(c.name);
        }
        check('component ids are dense', denseThroughout);
        checkEqual('component ids are unique', seenIds.size, components.length);
        checkEqual('component names are unique', seenNames.size, components.length);

        // Rarity ids are the canonical wire/database ordering, not interned.
        checkEqual('rarity id of common', rarityToId('common'), 0);
        checkEqual('rarity roundtrip', idToRarity(rarityToId('legendary')), 'legendary');
        checkEqual('unknown rarity is -1', rarityToId('not_a_rarity'), -1);

        // Interned ids are stable within the process and distinct per string.
        const bee = mobTypes.intern('bee');
        const hornet = mobTypes.intern('hornet');
        check('interned ids are distinct', bee !== hornet);
        checkEqual('interning is idempotent', mobTypes.intern('bee'), bee);
        checkEqual('interner resolves names', mobTypes.nameOf(hornet), 'hornet');
        checkEqual('unknown string is -1', mobTypes.idOf('not_a_mob'), -1);
    }

    // -- composing realistic game entities ------------------------------------
    {
        const world = new World();

        // A wild bee: moves, fights, wanders, despawns when unseen.
        const beeEntity = world.create();
        world.bindExternalId(beeEntity, 'mob-bee-1');
        world.add(beeEntity, C.Position, { x: 1500, y: -320 });
        world.add(beeEntity, C.Velocity, { x: 0, y: 0 });
        world.add(beeEntity, C.Angle, { value: 1.2 });
        world.add(beeEntity, C.Radius, { value: 22 });
        world.add(beeEntity, C.Speed, { current: 90, base: 90 });
        world.add(beeEntity, C.Health, { current: 40, max: 40 });
        world.add(beeEntity, C.Damage, { value: 15 });
        world.add(beeEntity, C.MobKind, { type: mobTypes.intern('bee'), tier: rarityToId('rare') });
        world.add(beeEntity, C.MobAI, {
            aiType: C.AiType.Neutral,
            isChasing: 0,
            targetPlayer: NULL_ENTITY,
            targetEnemy: NULL_ENTITY,
            targetPet: NULL_ENTITY,
            range: 400,
        });
        world.add(beeEntity, C.Wander, { targetX: 1600, targetY: -300, lastTime: 0 });
        world.add(beeEntity, C.Wobble, { phase: 0.5 });
        world.add(beeEntity, C.ViewportTracked, { lastInViewport: 0 });
        world.add(beeEntity, C.IsEnemy);

        checkEqual('bee tier reads back as rare',
            idToRarity(world.get(beeEntity, C.MobKind, 'tier')), 'rare');
        checkEqual('bee type reads back as bee',
            mobTypes.nameOf(world.get(beeEntity, C.MobKind, 'type')), 'bee');
        checkEqual('bee resolves by external id', world.lookup('mob-bee-1'), beeEntity);

        // A player: same spatial components, entirely different everything else.
        const playerEntity = world.create();
        world.bindExternalId(playerEntity, 'socket-xyz');
        world.add(playerEntity, C.Position, { x: 0, y: 0 });
        world.add(playerEntity, C.Velocity, { x: 0, y: 0 });
        world.add(playerEntity, C.Angle, { value: 0 });
        world.add(playerEntity, C.Radius, { value: 25 });
        world.add(playerEntity, C.Health, { current: 100, max: 100 });
        world.add(playerEntity, C.PlayerIdentity, { name: 'tester', userId: 'user-1' });
        world.add(playerEntity, C.PlayerInput, { keys: [], seq: 0, lastProcessedSeq: 0 });
        world.add(playerEntity, C.Progression, { level: 12, xp: 340, xpToNextLevel: 500, score: 340, tp: 3, skills: {} });
        world.add(playerEntity, C.Inventory, { items: [] });
        world.add(playerEntity, C.Loadout, { slots: [null, null] });
        world.add(playerEntity, C.IsPlayer);

        // Spatial systems see both; gameplay queries see only their own kind.
        const spatial = world.query([C.Position, C.Radius]);
        checkEqual('spatial query sees both kinds', spatial.count(), 2);
        checkEqual('enemy query sees only the bee', world.query([C.IsEnemy]).count(), 1);
        checkEqual('player query sees only the player', world.query([C.IsPlayer]).count(), 1);

        // The lobby exclusion: a title-screen player must be invisible to any
        // query that did not explicitly ask for lobby entities. This is what the
        // separate `lobbyPlayers` map used to guarantee structurally.
        const lobbyEntity = world.create();
        world.add(lobbyEntity, C.Position, { x: 0, y: 0 });
        world.add(lobbyEntity, C.Health, { current: 100, max: 100 });
        world.add(lobbyEntity, C.IsPlayer);
        world.add(lobbyEntity, C.IsLobby);

        const worldPlayers = world.query([C.IsPlayer], [C.IsLobby]);
        checkEqual('lobby player excluded from world queries', worldPlayers.count(), 1);
        checkEqual('all players including lobby', world.query([C.IsPlayer]).count(), 2);

        // Afflictions as components: only the afflicted are iterated.
        world.add(beeEntity, C.Slowed, { until: 5000 });
        const slowed = world.query([C.Slowed, C.Speed]);
        checkEqual('only the slowed bee matches', slowed.count(), 1);
        world.remove(beeEntity, C.Slowed);
        checkEqual('slow removal empties the query', slowed.count(), 0);
        checkEqual('bee keeps its speed after slow removal',
            world.get(beeEntity, C.Speed, 'base'), 90);

        // Poison stacks are their own entities pointing at a victim, so several
        // players can poison one mob without allocating an array per mob.
        for (let i = 0; i < 3; i++) {
            const stack = world.create();
            world.add(stack, C.PoisonStack, {
                target: beeEntity,
                source: playerEntity,
                damagePerMs: 0.05,
                endTime: 1000 + i,
            });
        }
        checkEqual('three poison stacks exist', world.query([C.PoisonStack]).count(), 3);

        // Killing the victim must leave the stacks detectably orphaned rather
        // than pointing at whatever recycles the slot.
        world.destroy(beeEntity);
        let orphaned = 0;
        world.query([C.PoisonStack]).chunks(chunk => {
            const p = chunk.cols(C.PoisonStack);
            for (let i = 0; i < chunk.count; i++) {
                if (!world.isAlive(p.target[i] as Entity)) orphaned++;
            }
        });
        checkEqual('stacks detect their dead target', orphaned, 3);
    }

    // -- component masks survive the sign bit --------------------------------
    {
        // JS bitwise operators yield a SIGNED int32, so a mask word with bit 31
        // set comes back from `&` negative and never equals the unsigned word it
        // was masked with. A query requiring a component whose id is 31 mod 32
        // then matches nothing at all — one system silently stops running, and
        // every typecheck and every other assertion here stays green. This bit
        // this project once the catalog grew past id 95.
        for (const id of [0, 1, 30, 31, 32, 63, 64, 95, 127]) {
            const archetype = createMask(160);
            const required = createMask(160);
            maskSet(archetype, id);
            maskSet(required, id);
            check(`mask containment holds for component id ${id}`,
                maskContainsAll(archetype, required));
            check(`mask intersection holds for component id ${id}`,
                maskIntersects(archetype, required));

            const other = createMask(160);
            maskSet(other, id === 0 ? 1 : id - 1);
            check(`mask containment rejects a missing component near id ${id}`,
                !maskContainsAll(other, required));
        }
    }

    return failures;
}
