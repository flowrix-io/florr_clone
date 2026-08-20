/**
 * Viewport-scoped broadcast.
 *
 * `io.emit` fans out to EVERY connected socket, which makes any per-event cost
 * O(events × players). For anything positional — a spawn, an explosion, a
 * lightning flash — most recipients cannot see it and are paying to decode
 * something they will never draw.
 *
 * The box matches the one the tick broadcast culls entities with: ±200% of the
 * recipient's viewport, centred on their ACTIVE half (the splitter petal can
 * put the camera on `${id}_split2`, which stands somewhere else entirely).
 */

import { Server as SocketIOServer } from '../ws_server';
import { players, VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from '../constants';
import { getOriginalSocketId, getActivePlayerForSocket } from './utils';

/**
 * Send `event` only to sockets whose viewport contains (x, y).
 *
 * `alwaysTo` is a player id that receives it regardless of distance — used for
 * the owner of an effect, who must see their own action even if the camera has
 * been moved elsewhere.
 */
export function emitToViewers(
    io: SocketIOServer,
    x: number,
    y: number,
    event: string,
    payload: unknown,
    alwaysTo?: string,
): void {
    // One socket can back several player records (split halves), so dedupe by
    // socket id.
    const sent = new Set<string>();

    if (alwaysTo) {
        const ownerSocketId = getOriginalSocketId(alwaysTo);
        sent.add(ownerSocketId);
        io.to(ownerSocketId).emit(event, payload);
    }

    for (const otherId in players) {
        const socketId = getOriginalSocketId(otherId);
        if (sent.has(socketId)) continue;
        sent.add(socketId);

        // Bots live in `players` with no socket; io.to() no-ops for them.
        const viewer = getActivePlayerForSocket(socketId);
        if (!viewer) continue;

        const halfW = (viewer.viewportWidth || VIEWPORT_WIDTH) * 2;
        const halfH = (viewer.viewportHeight || VIEWPORT_HEIGHT) * 2;
        const dx = x - viewer.x;
        const dy = y - viewer.y;
        if ((dx < 0 ? -dx : dx) >= halfW || (dy < 0 ? -dy : dy) >= halfH) continue;

        io.to(socketId).emit(event, payload);
    }
}
