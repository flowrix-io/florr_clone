/**
 * Client message handlers for one connected socket.
 *
 * `registerConnectionHandlers` is the whole of what `io.on('connection')` does:
 * attach every `socket.on` listener this client will need. The listeners are
 * grouped by concern into the sibling modules imported below — see context.ts
 * for why they are split and what they share.
 */

import { Server } from '../../ws_server';
import { getActiveMaze, setActiveMazeDay, getCurrentMazeDay } from '../../maze';
import { AuthenticatedSocket } from '../shared/socketTypes';
import { ConnectionContext, ConnectionDependencies } from './context';
import { registerSessionHandlers } from './session';
import { registerInventoryHandlers } from './inventory';
import { registerChatHandlers } from './chat';
import { registerSocialHandlers } from './social';
import { registerProfileHandlers } from './profile';
import { registerSkillHandlers } from './skills';

export { ConnectionContext, ConnectionDependencies } from './context';

/**
 * Attach every handler for a newly connected socket.
 *
 * Registration order does not matter — the event names are disjoint and nothing
 * is dispatched until the socket receives its first message.
 */
export function registerConnectionHandlers(
    socket: AuthenticatedSocket,
    io: Server,
    deps: ConnectionDependencies,
): void {
    console.log('A user connected');

    // Tell the client which daily maze to build. The layout is generated
    // deterministically from the day number by the shared maze module, so
    // this tiny message is all the "map data" the maze ever needs.
    {
        const maze = getActiveMaze() || setActiveMazeDay(getCurrentMazeDay());
        socket.emit('mazeInfo', { day: maze.dayNumber, biome: maze.biome });
    }

    // The map itself is bundled with the client via src/map_data.ts — no longer
    // streamed here. The server still imports WORLD_MAP / WALL_GRID locally for
    // collision, spawn, and pathfinding logic.

    const ctx: ConnectionContext = { socket, io, deps };

    registerSessionHandlers(ctx);
    registerInventoryHandlers(ctx);
    registerChatHandlers(ctx);
    registerSocialHandlers(ctx);
    registerProfileHandlers(ctx);
    registerSkillHandlers(ctx);
}
