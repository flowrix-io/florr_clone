"use strict";
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
 *
 * Both routes go through the ECS outbox (ecs/net/outbox.ts) now, so they are
 * ordered with the rest of the tick's events and share its recipient list
 * instead of walking `players` per petal.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitPetalRestored = emitPetalRestored;
exports.emitPetalBroken = emitPetalBroken;
const wireOutbox_1 = require("./wireOutbox");
/**
 * Reload finished. Owner-only: nothing another client renders depends on it.
 *
 * Split halves share one socket, so the owner id has to come from the outbox's
 * player→socket mapping — `players[playerId]` is not the socket key.
 */
function emitPetalRestored(playerId, payload) {
    (0, wireOutbox_1.getWireOutbox)().toPlayer(playerId, 'petalRestored', payload);
}
/**
 * Petal broke. The owner always gets it (loadout UI reload animation); other
 * clients get it only when the breaking flower is inside their visibility box,
 * because for them it is purely a particle burst.
 */
function emitPetalBroken(playerId, payload, x, y) {
    (0, wireOutbox_1.getWireOutbox)().near(x, y, 'petalBroken', payload, playerId);
}
