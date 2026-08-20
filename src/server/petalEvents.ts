/**
 * Scoped delivery for the two petal reload events.
 *
 * These were both `io.emit` — a full broadcast to every connected socket —
 * which made their cost O(players²). Measured on prod at 23 players:
 * petalRestored ran 18,191 msg/s at 257 B each = 4.6 MB/s (75.6% of ALL
 * outbound bandwidth) and petalBroken another 507 KB/s, against a
 * gameStateUpdate channel of only 193 KB/s. The server was generating 6.0 MB/s
 * while the NIC could only push 2.7, so frames piled into per-socket send
 * queues (387 KB backlogged = ~3.5 s of latency, the reported 3000 ms ping)
 * and the tick loop was starved down to ~2.4 Hz.
 *
 * The fix is scope, not encoding. Only the OWNER needs reload state: a remote
 * flower's petals are drawn from the `petalPositions` stream inside
 * gameStateUpdate, and the client already hides an instance the server sent no
 * position for — see the `else if (serverPositions) continue` branch in
 * graphics/player-drawing.ts, whose comment calls out exactly this case
 * ("it's broken (per-instance health/cooldown) or just restored"). That stream
 * is already delta-encoded and viewport-scoped, so it carries remote reload
 * state for free and self-heals after a dropped frame. Re-sending the whole
 * Item to 22 other clients was pure duplication.
 *
 * petalBroken additionally triggers a one-shot break VFX at the flower, which
 * is worth sending only to clients whose viewport actually contains it.
 */

import { Server as SocketIOServer } from '../ws_server';
import { players, VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from '../constants';
import { getOriginalSocketId, getActivePlayerForSocket } from './utils';

/**
 * Reload finished. Owner-only: nothing another client renders depends on it.
 *
 * Split halves share one socket, so the owner id has to come from
 * getOriginalSocketId — `players[playerId]` is not the socket key.
 */
export function emitPetalRestored(
    io: SocketIOServer,
    playerId: string,
    payload: unknown
): void {
    io.to(getOriginalSocketId(playerId)).emit('petalRestored', payload);
}

/**
 * Petal broke. The owner always gets it (loadout UI reload animation); other
 * clients get it only when the breaking flower is inside their visibility box,
 * because for them it is purely a particle burst.
 *
 * The box matches the one the tick broadcast culls entities with: ±200% of the
 * recipient's viewport, centred on their ACTIVE half (the splitter petal can
 * put the camera on `${id}_split2`, which stands somewhere else entirely).
 */
export function emitPetalBroken(
    io: SocketIOServer,
    playerId: string,
    payload: unknown,
    x: number,
    y: number
): void {
    const ownerSocketId = getOriginalSocketId(playerId);
    io.to(ownerSocketId).emit('petalBroken', payload);

    // One socket can back several player records (split halves), so dedupe by
    // socket id — seeded with the owner, who was just sent to.
    const sent = new Set<string>([ownerSocketId]);

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

        io.to(socketId).emit('petalBroken', payload);
    }
}
