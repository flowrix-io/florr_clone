"use strict";
/**
 * The server's view of a connected socket.
 *
 * `AuthenticatedSocket` carries the per-connection state the tick loop needs:
 * who the player is, how good their connection is, and what was last sent to
 * them (the delta-compression baseline). It lived as a local interface in
 * server.ts, which meant the broadcast code could not be lifted out of that
 * file without duplicating it — server/commands.ts already carries a narrower
 * copy for its own use.
 */
Object.defineProperty(exports, "__esModule", { value: true });
