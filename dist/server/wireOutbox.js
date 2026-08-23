"use strict";
/**
 * The composition root for the ECS wire outbox.
 *
 * ecs/net/outbox.ts owns the queue, the ordering and the viewport test but is
 * deliberately ignorant of this game: it cannot import `io` (ws_server), the
 * `players` map or the viewport constants without dragging server.ts — which
 * binds a port and opens the database at module scope — into `npm run test:ecs`.
 * This file is the one place that knows both halves, and it is bound once from
 * server.ts at startup, the same shape enemyRegistry and itemRegistry use.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindWireOutbox = bindWireOutbox;
exports.getWireOutbox = getWireOutbox;
const constants_1 = require("../constants");
const utils_1 = require("./utils");
const outbox_1 = require("../ecs/net/outbox");
const entityRegistry_1 = require("./entityRegistry");
let outbox;
/**
 * Reused viewer records. The recipient list is rebuilt on every flush (30Hz),
 * and a fresh object per player per flush is exactly the steady garbage the
 * outbox's parallel-array storage exists to avoid — so the slots are pooled and
 * refilled in place.
 */
const viewerPool = [];
/** Dedupe scratch: one socket can back several player records (split halves). */
const seenSockets = new Set();
/** Install the outbox. Called once, from server.ts, before the first tick. */
function bindWireOutbox(io) {
    const sink = {
        all(event, payload) {
            io.emit(event, payload);
        },
        to(socketId, event, payload) {
            // Direct map lookup rather than `io.to(id).emit(...)`: `to()`
            // allocates a closure wrapper per call, and the outbox makes one
            // call per recipient per event.
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.connected)
                socket.emit(event, payload);
        },
    };
    const viewerSource = {
        collectViewers(out) {
            seenSockets.clear();
            let n = 0;
            for (const playerId in constants_1.players) {
                const socketId = (0, utils_1.getOriginalSocketId)(playerId);
                if (seenSockets.has(socketId))
                    continue;
                seenSockets.add(socketId);
                // Bots live in `players` with no socket. The old per-event loop
                // box-tested them anyway and then no-op'd on `io.to()`; dropping
                // them here shrinks the inner walk by the bot count, which on
                // prod is 23 of 24 "viewers".
                if (!io.sockets.sockets.has(socketId))
                    continue;
                // The camera follows the ACTIVE half: the splitter petal can put
                // it on `${id}_split2`, standing somewhere else entirely.
                const viewer = (0, utils_1.getActivePlayerForSocket)(socketId);
                if (!viewer)
                    continue;
                let slot = viewerPool[n];
                if (slot === undefined) {
                    slot = viewerPool[n] = { socketId: '', x: 0, y: 0, halfWidth: 0, halfHeight: 0 };
                }
                slot.socketId = socketId;
                slot.x = viewer.x;
                slot.y = viewer.y;
                // ±200% of the viewport — the same box the tick broadcast culls
                // entities with, so an event can never arrive for an entity the
                // recipient was never sent.
                slot.halfWidth = (viewer.viewportWidth || constants_1.VIEWPORT_WIDTH) * 2;
                slot.halfHeight = (viewer.viewportHeight || constants_1.VIEWPORT_HEIGHT) * 2;
                out.push(slot);
                n++;
            }
        },
        socketIdOf(playerId) {
            return (0, utils_1.getOriginalSocketId)(playerId);
        },
    };
    // The one liveness rule, shared by every kind. Before the entity host is
    // installed nothing has been admitted yet, so nothing can have died —
    // reporting "live" is both correct and the only answer available.
    const gate = {
        isLiveForWire: (entity) => !(0, entityRegistry_1.hasEntityHost)() || (0, entityRegistry_1.isLiveForWire)((0, entityRegistry_1.getEntityWorld)(), entity),
    };
    outbox = new outbox_1.WireOutbox(sink, viewerSource, gate);
    return outbox;
}
/**
 * The bound outbox.
 *
 * Throws rather than silently dropping: an unbound outbox would swallow every
 * spawn, death and pickup event in the game, which presents as a client that
 * renders a frozen world.
 */
function getWireOutbox() {
    if (!outbox) {
        throw new Error('wireOutbox: not bound. server.ts must call bindWireOutbox(io) at '
            + 'startup — without it no gameplay event can reach the wire.');
    }
    return outbox;
}
