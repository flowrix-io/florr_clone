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
 *
 * The scoping itself now lives in the ECS outbox (ecs/net/outbox.ts, drained in
 * Phase.Networking). This module is the thin call-site-facing name for it. The
 * difference is that the recipient list used to be rebuilt from `players` on
 * every single call — so spawning a centipede or an ant-hole cluster re-derived
 * it once per segment — and is now built once per flush and shared by every
 * event in the tick.
 */

import { getWireOutbox } from './wireOutbox';
import { WireEvent } from '../wire_events';

/**
 * Send `event` only to sockets whose viewport contains (x, y).
 *
 * `alwaysTo` is a player id that receives it regardless of distance — used for
 * the owner of an effect, who must see their own action even if the camera has
 * been moved elsewhere.
 *
 * Queued, not sent: delivery happens at the end of the tick that produced it
 * (or, for events raised outside a tick, at the end of the current JS turn —
 * still ahead of any broadcast frame).
 */
export function emitToViewers(
    x: number,
    y: number,
    event: WireEvent,
    payload: unknown,
    alwaysTo?: string,
): void {
    getWireOutbox().near(x, y, event, payload, alwaysTo);
}
