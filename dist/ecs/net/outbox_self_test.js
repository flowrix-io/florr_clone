"use strict";
/**
 * Self-test for the wire outbox.
 *
 * Pins the four properties the rest of the server relies on, each of which has
 * a matching bug class if it breaks:
 *
 *  - ORDER. Events leave in the order they were produced, across every route.
 *    An `enemySpawned` that overtakes its own `enemyDestroyed` is a permanent
 *    ghost entity on the client.
 *  - SCOPE. `near` reaches exactly the sockets whose box contains the point,
 *    plus the always-notify owner, and never the same socket twice.
 *  - ONE RECIPIENT LIST PER FLUSH. The whole reason for batching: N events in a
 *    tick must not rebuild the viewer list N times.
 *  - NOTHING IS LOST. A sink that throws, or one that enqueues while the queue
 *    is being drained, must not cost the other events.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOutboxSelfTest = runOutboxSelfTest;
const outbox_1 = require("./outbox");
const system_1 = require("../system");
function runOutboxSelfTest() {
    const failures = [];
    const check = (name, condition, detail) => {
        if (!condition)
            failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name, actual, expected) => {
        if (actual !== expected)
            failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    /** A recording sink; `socketId: null` means it went to everyone. */
    function makeSink() {
        const sent = [];
        return {
            sent,
            sink: {
                all: (event, payload) => { sent.push({ socketId: null, event, payload }); },
                to: (socketId, event, payload) => { sent.push({ socketId, event, payload }); },
            },
        };
    }
    /**
     * Three viewers on a line, each with a 100x100 half-box: `a` at the origin,
     * `b` 150 away (out of a's box, in its own), `c` far off at 10000.
     */
    function makeViewers() {
        const viewers = [
            { socketId: 'a', x: 0, y: 0, halfWidth: 100, halfHeight: 100 },
            { socketId: 'b', x: 150, y: 0, halfWidth: 100, halfHeight: 100 },
            { socketId: 'c', x: 10000, y: 0, halfWidth: 100, halfHeight: 100 },
        ];
        let calls = 0;
        return {
            collectCalls: () => calls,
            source: {
                collectViewers: (out) => { calls++; for (const v of viewers)
                    out.push(v); },
                // Split halves resolve back to their owning socket.
                socketIdOf: (playerId) => playerId.replace('_split2', ''),
            },
        };
    }
    // -- routes ---------------------------------------------------------------
    {
        const { sink, sent } = makeSink();
        const { source } = makeViewers();
        const outbox = new outbox_1.WireOutbox(sink, source);
        outbox.all('enemyDestroyed', 'm1');
        outbox.toSocket('a', 'itemsSpawned', [1]);
        outbox.toPlayer('b_split2', 'petalRestored', { slot: 0 });
        checkEqual('nothing is sent before the flush', sent.length, 0);
        checkEqual('everything queued is counted', outbox.pending(), 3);
        outbox.flush();
        checkEqual('all three routes delivered', sent.length, 3);
        checkEqual('all -> broadcast', sent[0].socketId, null);
        checkEqual('toSocket -> that socket', sent[1].socketId, 'a');
        checkEqual('toPlayer resolves the split half', sent[2].socketId, 'b');
        checkEqual('the queue is empty afterwards', outbox.pending(), 0);
        sent.length = 0;
        outbox.flush();
        checkEqual('flushing an empty queue sends nothing', sent.length, 0);
    }
    // -- production order is wire order ---------------------------------------
    {
        const { sink, sent } = makeSink();
        const { source } = makeViewers();
        const outbox = new outbox_1.WireOutbox(sink, source);
        // The ghost-entity ordering: a mob spawns near the origin and dies in
        // the same tick. Different routes; the spawn must still go first.
        outbox.near(0, 0, 'enemySpawned', 'm1');
        outbox.all('enemyDestroyed', 'm1');
        outbox.flush();
        checkEqual('spawn precedes destroy', sent[0].event, 'enemySpawned');
        checkEqual('destroy follows spawn', sent[sent.length - 1].event, 'enemyDestroyed');
    }
    // -- viewport scoping -----------------------------------------------------
    {
        const { sink, sent } = makeSink();
        const { source } = makeViewers();
        const outbox = new outbox_1.WireOutbox(sink, source);
        outbox.near(0, 0, 'lightningStrike', { x: 0, y: 0 });
        outbox.flush();
        checkEqual('only the viewer whose box contains it', sent.length, 1);
        checkEqual('and it is the right one', sent[0].socketId, 'a');
        // Exactly on the boundary is OUT, matching the `>=` test the legacy
        // emitToViewers used — changing it would shift what every client sees.
        // Probed along y, where only `a` is in play: the viewers sit on the x
        // axis, so a point beside `a` on x would also fall inside `b`'s box.
        sent.length = 0;
        outbox.near(0, 100, 'lightningStrike', {});
        outbox.flush();
        checkEqual('the box edge is exclusive', sent.length, 0);
        sent.length = 0;
        outbox.near(0, 99, 'lightningStrike', {});
        outbox.flush();
        checkEqual('just inside the edge is in', sent.length, 1);
        checkEqual('and reaches the viewer it belongs to', sent[0].socketId, 'a');
    }
    // -- alwaysTo -------------------------------------------------------------
    {
        const { sink, sent } = makeSink();
        const { source } = makeViewers();
        const outbox = new outbox_1.WireOutbox(sink, source);
        // The owner is nowhere near the point (their camera is on a split half
        // somewhere else) but must still receive their own effect.
        outbox.near(10000, 0, 'petalBroken', {}, 'a');
        outbox.flush();
        checkEqual('owner plus the one viewer in range', sent.length, 2);
        checkEqual('the owner is first', sent[0].socketId, 'a');
        checkEqual('the in-range viewer follows', sent[1].socketId, 'c');
        // Owner IS in range: they must not get it twice.
        sent.length = 0;
        outbox.near(0, 0, 'petalBroken', {}, 'a');
        outbox.flush();
        checkEqual('an in-range owner is not double-sent', sent.length, 1);
        checkEqual('and it is the owner', sent[0].socketId, 'a');
    }
    // -- the recipient list is built once per flush ---------------------------
    {
        const { sink } = makeSink();
        const { source, collectCalls } = makeViewers();
        const outbox = new outbox_1.WireOutbox(sink, source);
        for (let i = 0; i < 25; i++)
            outbox.near(0, 0, 'enemySpawned', i);
        outbox.flush();
        checkEqual('25 scoped events, one viewer walk', collectCalls(), 1);
        // Routes that need no scoping must not pay for one at all.
        outbox.all('enemyDestroyed', 'm1');
        outbox.toSocket('a', 'itemsSpawned', []);
        outbox.flush();
        checkEqual('unscoped routes never collect viewers', collectCalls(), 1);
    }
    // -- a failing sink does not cost the other events ------------------------
    {
        const sent = [];
        const sink = {
            all: (event, payload) => {
                if (event === 'playerDied')
                    throw new Error('socket exploded');
                sent.push({ socketId: null, event, payload });
            },
            to: (socketId, event, payload) => { sent.push({ socketId, event, payload }); },
        };
        const { source } = makeViewers();
        const outbox = new outbox_1.WireOutbox(sink, source);
        outbox.all('enemyDestroyed', 'm1');
        outbox.all('playerDied', { playerId: 'p1' });
        outbox.all('enemiesDamaged', []);
        outbox.flush();
        checkEqual('the two healthy events still went out', sent.length, 2);
        checkEqual('the queue is drained despite the throw', outbox.pending(), 0);
    }
    // -- enqueueing from inside a flush ---------------------------------------
    {
        const sent = [];
        let outbox;
        const sink = {
            all: (event, payload) => {
                sent.push({ socketId: null, event, payload });
                // A sink that reacts by raising another event — the queue is
                // mid-drain, and this must survive to the next flush rather
                // than being wiped by the compaction.
                if (event === 'playerDied')
                    outbox.all('playerRespawned', { playerId: 'p1' });
            },
            to: () => { },
        };
        const { source } = makeViewers();
        outbox = new outbox_1.WireOutbox(sink, source);
        outbox.all('playerDied', { playerId: 'p1' });
        outbox.flush();
        checkEqual('the re-entrant event is held, not delivered inline', sent.length, 1);
        checkEqual('and it is still queued', outbox.pending(), 1);
        outbox.flush();
        checkEqual('the next flush delivers it', sent.length, 2);
        checkEqual('with the right event', sent[1].event, 'playerRespawned');
    }
    // -- the entity gate ------------------------------------------------------
    {
        const { sink, sent } = makeSink();
        const { source } = makeViewers();
        const dead = new Set();
        const outbox = new outbox_1.WireOutbox(sink, source, {
            isLiveForWire: (entity) => !dead.has(entity),
        });
        const alive = 11;
        const doomed = 22;
        // The failure this exists for: a mob spawns and is removed inside one
        // tick by a path that does NOT emit enemyDestroyed. Without the gate the
        // client is left holding a mob it will never hear about again.
        outbox.nearFor(doomed, 0, 0, 'enemySpawned', { id: 'm2' });
        outbox.nearFor(alive, 0, 0, 'enemySpawned', { id: 'm1' });
        dead.add(doomed);
        outbox.flush();
        checkEqual('the dead subject is dropped', sent.length, 1);
        checkEqual('the live one still goes out', sent[0].payload.id, 'm1');
        checkEqual('and the drop is counted', outbox.droppedByGate(), 1);
        // Every route honours it.
        sent.length = 0;
        outbox.allFor(doomed, 'enemyDestroyed', 'm2');
        outbox.toSocketFor(doomed, 'a', 'itemsSpawned', []);
        outbox.toPlayerFor(doomed, 'a', 'petalRestored', {});
        outbox.flush();
        checkEqual('all gated routes drop a dead subject', sent.length, 0);
        // Ungated events are never affected — they name no entity.
        sent.length = 0;
        outbox.all('debugStats', {});
        outbox.flush();
        checkEqual('ungated events are untouched', sent.length, 1);
    }
    // -- no gate installed ----------------------------------------------------
    {
        // Benches and tests construct an outbox with no world behind it; gated
        // events must still be delivered rather than silently vanishing.
        const { sink, sent } = makeSink();
        const { source } = makeViewers();
        const outbox = new outbox_1.WireOutbox(sink, source);
        outbox.allFor(33, 'enemyDestroyed', 'm3');
        outbox.flush();
        checkEqual('without a gate everything is deliverable', sent.length, 1);
    }
    // -- scheduling -----------------------------------------------------------
    {
        const { sink } = makeSink();
        const { source } = makeViewers();
        const outbox = new outbox_1.WireOutbox(sink, source);
        const registered = [];
        (0, outbox_1.registerWireOutboxSystem)({ add: (name, phase) => { registered.push({ name, phase }); return undefined; } }, outbox);
        checkEqual('one system is registered', registered.length, 1);
        checkEqual('under a stable name', registered[0].name, 'wireOutboxFlush');
        // Networking is last: the drain must see everything the tick produced.
        checkEqual('in the networking phase', registered[0].phase, system_1.Phase.Networking);
    }
    // -- the opcode table covers what the server actually emits ---------------
    {
        // Compile-time in the real code (WireEvent is a literal union), but pin
        // it here too so a rename in wire_events.ts fails the suite rather than
        // silently putting a 15-byte name on every frame.
        const hot = [
            'enemySpawned', 'enemyDestroyed', 'enemiesDamaged',
            'playerDamaged', 'playerDied', 'petalBroken', 'petalRestored',
            'itemsSpawned', 'itemRemoved', 'itemPickedUp',
        ];
        check('the hot events all have opcodes', hot.length === 10);
    }
    return failures;
}
