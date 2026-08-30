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

import { Server } from '../../ws_server';
import { ServerPlayer } from '../../player';
import { RedeemedCode } from '../../database';
import { CommandHandlerDependencies } from '../commands';
import { AuthenticatedSocket } from '../shared/socketTypes';

/**
 * The server.ts-scoped functions and state the handlers still need. Everything
 * else they use is imported directly by the module that needs it.
 */
export interface ConnectionDependencies {
    savePlayerProgress: (player: ServerPlayer, userId: string) => void;
    savePlayerProgressImmediate: (player: ServerPlayer, userId: string) => void;
    addXPToPlayer: (player: ServerPlayer, xp: number, socketId?: string) => void;
    addMazeXPToPlayer: (player: ServerPlayer, xp: number, socketId?: string) => void;
    triggerViewportUpdate: () => void;
    /** Redeem codes, keyed by code string; backed by the database. */
    redeemedCodes: Map<string, RedeemedCode>;
    saveCodeToDatabase: (code: string, codeData: RedeemedCode) => void;
    deleteCodeFromDatabase: (code: string) => void;
    /** TP cost per rarity tier, for the skill tree. */
    RARITY_TP_COSTS: Record<string, number>;
    /** Passed straight through to handleAdminCommand. */
    commandDeps: CommandHandlerDependencies;
}

export interface ConnectionContext {
    socket: AuthenticatedSocket;
    io: Server;
    deps: ConnectionDependencies;
}
