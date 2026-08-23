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

import { Server as SocketIOServer } from '../ws_server';
import { players, VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from '../constants';
import { getOriginalSocketId, getActivePlayerForSocket } from './utils';
import { WireEvent } from '../wire_events';
import { WireOutbox, WireSink, WireViewer, ViewerSource, EntityGate } from '../ecs/net/outbox';
import { hasEntityHost, getEntityWorld, isLiveForWire } from './entityRegistry';
import { Entity } from '../ecs';

let outbox: WireOutbox | undefined;

/**
 * Reused viewer records. The recipient list is rebuilt on every flush (30Hz),
 * and a fresh object per player per flush is exactly the steady garbage the
 * outbox's parallel-array storage exists to avoid — so the slots are pooled and
 * refilled in place.
 */
const viewerPool: WireViewer[] = [];
/** Dedupe scratch: one socket can back several player records (split halves). */
const seenSockets = new Set<string>();

/** Install the outbox. Called once, from server.ts, before the first tick. */
export function bindWireOutbox(io: SocketIOServer): WireOutbox {
    const sink: WireSink = {
        all(event: WireEvent, payload: unknown): void {
            io.emit(event, payload);
        },
        to(socketId: string, event: WireEvent, payload: unknown): void {
            // Direct map lookup rather than `io.to(id).emit(...)`: `to()`
            // allocates a closure wrapper per call, and the outbox makes one
            // call per recipient per event.
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.connected) socket.emit(event, payload);
        },
    };

    const viewerSource: ViewerSource = {
        collectViewers(out: WireViewer[]): void {
            seenSockets.clear();
            let n = 0;
            for (const playerId in players) {
                const socketId = getOriginalSocketId(playerId);
                if (seenSockets.has(socketId)) continue;
                seenSockets.add(socketId);

                // Bots live in `players` with no socket. The old per-event loop
                // box-tested them anyway and then no-op'd on `io.to()`; dropping
                // them here shrinks the inner walk by the bot count, which on
                // prod is 23 of 24 "viewers".
                if (!io.sockets.sockets.has(socketId)) continue;

                // The camera follows the ACTIVE half: the splitter petal can put
                // it on `${id}_split2`, standing somewhere else entirely.
                const viewer = getActivePlayerForSocket(socketId);
                if (!viewer) continue;

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
                slot.halfWidth = (viewer.viewportWidth || VIEWPORT_WIDTH) * 2;
                slot.halfHeight = (viewer.viewportHeight || VIEWPORT_HEIGHT) * 2;
                out.push(slot);
                n++;
            }
        },

        socketIdOf(playerId: string): string {
            return getOriginalSocketId(playerId);
        },
    };

    // The one liveness rule, shared by every kind. Before the entity host is
    // installed nothing has been admitted yet, so nothing can have died —
    // reporting "live" is both correct and the only answer available.
    const gate: EntityGate = {
        isLiveForWire: (entity: Entity) =>
            !hasEntityHost() || isLiveForWire(getEntityWorld(), entity),
    };

    outbox = new WireOutbox(sink, viewerSource, gate);
    return outbox;
}

/**
 * The bound outbox.
 *
 * Throws rather than silently dropping: an unbound outbox would swallow every
 * spawn, death and pickup event in the game, which presents as a client that
 * renders a frozen world.
 */
export function getWireOutbox(): WireOutbox {
    if (!outbox) {
        throw new Error(
            'wireOutbox: not bound. server.ts must call bindWireOutbox(io) at '
            + 'startup — without it no gameplay event can reach the wire.',
        );
    }
    return outbox;
}
