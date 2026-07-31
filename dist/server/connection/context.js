"use strict";
/**
 * What one connected socket's handlers are given to work with.
 *
 * The `io.on('connection')` body in server.ts had grown to ~2850 lines: every
 * client message type, from authentication to crafting to admin chat commands,
 * inlined into a single arrow function. The handlers barely interact — each
 * `socket.on` is independent — so they are split by concern into sibling
 * modules here, each exporting one `register*Handlers(ctx)`.
 *
 * Only two things are genuinely shared: the socket itself, and a handful of
 * functions that still live in server.ts (persistence, XP, the redeem-code
 * store). Those are passed in via `deps`, the same pattern
 * `PlayerStateDependencies` and `CommandHandlerDependencies` already use.
 */
Object.defineProperty(exports, "__esModule", { value: true });
