"use strict";
/**
 * The wire-event outbox — ECS-owned event emission.
 *
 * Every gameplay event used to leave the server the moment the code that caused
 * it ran: `io.emit('enemyDestroyed', id)` inside the reaper, `emitToViewers(...)`
 * inside the spawn loop, and so on. Two problems with that, both of which this
 * file exists to fix.
 *
 * 1. SCOPING COST. A viewport-scoped emit has to know who can see the point it
 *    happened at, and the old helpers rebuilt that answer from scratch on every
 *    single call — walk `players`, map each to its socket, dedupe, resolve the
 *    active split half, read viewport dimensions. That is fine for one event and
 *    quadratic for a wave: spawning an ant-hole cluster or a centipede fires one
 *    emit per segment, each re-deriving the same recipient list. Queueing the
 *    events and flushing them together lets the recipient list be built ONCE per
 *    flush and reused by every event in it, which turns O(events × players) of
 *    map lookups into O(players + events × viewers) of float compares.
 *
 * 2. ORDER. Immediate emission means wire order is whatever order the tick
 *    happened to touch subsystems in, interleaved with the separately-timed
 *    `gameStateUpdate` broadcast. Draining from one queue in Phase.Networking
 *    makes it a property of the schedule instead: all events for a tick leave
 *    together, in the order they were produced, and always before the next state
 *    frame that could mention the entities they refer to. That ordering is what
 *    the ghost-entity class of bug lives in — a delta describing a mob a client
 *    was never told had spawned, or one it was already told had died.
 *
 * What this file must NOT know is how to actually send anything, or who the
 * players are: `io`, `players` and the viewport constants all live in the legacy
 * server graph, and importing that here would drag a port-binding module into
 * `npm run test:ecs`. Both arrive as injected interfaces, bound once by the
 * composition root (see server/wireOutbox.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WireOutbox = void 0;
exports.registerWireOutboxSystem = registerWireOutboxSystem;
const system_1 = require("../system");
const ROUTE_ALL = 0;
const ROUTE_SOCKET = 1;
const ROUTE_NEAR = 2;
const ROUTE_PLAYER = 3;
/** Stop logging delivery failures after this many, so a broken socket can't spam. */
const MAX_LOGGED_DELIVERY_ERRORS = 5;
/**
 * A queue of pending wire events, drained in Phase.Networking.
 *
 * Storage is parallel arrays with an explicit `count` rather than an array of
 * event objects: the queue is refilled and drained every tick at 30Hz, and one
 * allocation per event is exactly the kind of steady garbage that shows up as
 * GC pauses in a tick-cadence probe. Slots are reused; only the payload
 * references are cleared, because those can retain arbitrarily large objects.
 */
class WireOutbox {
    constructor(sink, viewerSource) {
        this.sink = sink;
        this.viewerSource = viewerSource;
        this.events = [];
        this.payloads = [];
        this.routes = [];
        /** Socket id for ROUTE_SOCKET; the always-notify player id for ROUTE_NEAR. */
        this.targets = [];
        this.xs = [];
        this.ys = [];
        this.count = 0;
        this.nearCount = 0;
        this.viewers = [];
        this.flushScheduled = false;
        this.flushing = false;
        this.deliveryErrors = 0;
        this.boundFlush = () => this.flush();
    }
    /** Events queued but not yet delivered. For tests and the debug menu. */
    pending() {
        return this.count;
    }
    /** Send to every connected socket. */
    all(event, payload) {
        this.enqueue(ROUTE_ALL, event, payload, '', 0, 0);
    }
    /** Send to one socket id. */
    toSocket(socketId, event, payload) {
        this.enqueue(ROUTE_SOCKET, event, payload, socketId, 0, 0);
    }
    /**
     * Send to the socket that owns a PLAYER id.
     *
     * Distinct from `toSocket` because the two are not the same string: a split
     * half is `${socketId}_split2`, and addressing that directly reaches nobody.
     * Resolution is deferred to flush time, which is also when the split state
     * is settled.
     */
    toPlayer(playerId, event, payload) {
        this.enqueue(ROUTE_PLAYER, event, payload, playerId, 0, 0);
    }
    /**
     * Send only to sockets whose visible box contains (x, y).
     *
     * `alwaysTo` is a player id that receives it regardless of distance — the
     * owner of an effect must see their own action even when the splitter petal
     * has moved their camera somewhere else entirely.
     */
    near(x, y, event, payload, alwaysTo) {
        this.enqueue(ROUTE_NEAR, event, payload, alwaysTo ?? '', x, y);
        this.nearCount++;
    }
    /**
     * Deliver everything queued.
     *
     * Called from the Phase.Networking system below for tick-time events, and
     * from a microtask for anything queued outside a tick (socket handlers,
     * admin commands) so those never wait for the next tick to go out.
     */
    flush() {
        this.flushScheduled = false;
        // Re-entrant call from inside a sink: leave the queue alone, the
        // in-progress flush owns it and will pick up anything appended.
        if (this.flushing || this.count === 0)
            return;
        this.flushing = true;
        // Snapshot the length: a sink that enqueues during delivery appends past
        // this point, and those events belong to the NEXT flush, not this loop.
        const processed = this.count;
        try {
            if (this.nearCount > 0) {
                this.viewers.length = 0;
                this.viewerSource.collectViewers(this.viewers);
            }
            for (let i = 0; i < processed; i++)
                this.deliver(i);
        }
        finally {
            this.compact(processed);
            this.flushing = false;
            if (this.count > 0)
                this.schedule();
        }
    }
    enqueue(route, event, payload, target, x, y) {
        const i = this.count++;
        this.routes[i] = route;
        this.events[i] = event;
        this.payloads[i] = payload;
        this.targets[i] = target;
        this.xs[i] = x;
        this.ys[i] = y;
        this.schedule();
    }
    /**
     * Guarantee a flush happens by the end of the current JS turn.
     *
     * A microtask, not a timer: microtasks run before any macrotask, so an event
     * queued in a socket handler is on the wire before the next broadcast
     * interval or tick can fire. During a tick this fires too, but finds an
     * empty queue because the Networking system already drained it.
     */
    schedule() {
        if (this.flushScheduled || this.flushing)
            return;
        this.flushScheduled = true;
        queueMicrotask(this.boundFlush);
    }
    deliver(i) {
        const event = this.events[i];
        const payload = this.payloads[i];
        try {
            const route = this.routes[i];
            if (route === ROUTE_ALL) {
                this.sink.all(event, payload);
            }
            else if (route === ROUTE_SOCKET) {
                this.sink.to(this.targets[i], event, payload);
            }
            else if (route === ROUTE_PLAYER) {
                this.sink.to(this.viewerSource.socketIdOf(this.targets[i]), event, payload);
            }
            else {
                this.deliverNear(i, event, payload);
            }
        }
        catch (error) {
            // One unwritable socket must not cost the rest of the tick's events.
            if (this.deliveryErrors++ < MAX_LOGGED_DELIVERY_ERRORS) {
                console.error(`wireOutbox: failed to deliver "${event}":`, error);
            }
        }
    }
    deliverNear(i, event, payload) {
        const alwaysTo = this.targets[i];
        // The owner goes first and is then skipped in the viewer walk, which is
        // also what dedupes them: they are usually a viewer as well.
        let ownerSocketId = '';
        if (alwaysTo !== '') {
            ownerSocketId = this.viewerSource.socketIdOf(alwaysTo);
            this.sink.to(ownerSocketId, event, payload);
        }
        const x = this.xs[i];
        const y = this.ys[i];
        const viewers = this.viewers;
        for (let v = 0; v < viewers.length; v++) {
            const viewer = viewers[v];
            if (viewer.socketId === ownerSocketId)
                continue;
            const dx = x - viewer.x;
            const dy = y - viewer.y;
            if ((dx < 0 ? -dx : dx) >= viewer.halfWidth)
                continue;
            if ((dy < 0 ? -dy : dy) >= viewer.halfHeight)
                continue;
            this.sink.to(viewer.socketId, event, payload);
        }
    }
    /**
     * Drop the first `processed` entries, keeping anything a sink appended
     * during the flush. Payload slots are nulled so the queue never pins a
     * delivered object alive until its slot is reused.
     */
    compact(processed) {
        const remaining = this.count - processed;
        for (let i = 0; i < remaining; i++) {
            const from = processed + i;
            this.routes[i] = this.routes[from];
            this.events[i] = this.events[from];
            this.payloads[i] = this.payloads[from];
            this.targets[i] = this.targets[from];
            this.xs[i] = this.xs[from];
            this.ys[i] = this.ys[from];
        }
        for (let i = remaining; i < this.count; i++)
            this.payloads[i] = undefined;
        this.count = remaining;
        // Recount rather than track: `near` is the only route that needs the
        // viewer list, and a leftover tail is small by construction.
        let near = 0;
        for (let i = 0; i < remaining; i++)
            if (this.routes[i] === ROUTE_NEAR)
                near++;
        this.nearCount = near;
    }
}
exports.WireOutbox = WireOutbox;
/**
 * Drain the outbox at the end of the tick.
 *
 * Phase.Networking, so it runs after every system that could have produced an
 * event and before the tick returns — which is what puts the whole tick's events
 * ahead of the next `gameStateUpdate` frame on the wire.
 */
function registerWireOutboxSystem(scheduler, outbox) {
    scheduler.add('wireOutboxFlush', system_1.Phase.Networking, () => outbox.flush());
}
