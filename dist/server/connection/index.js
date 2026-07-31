"use strict";
/**
 * Client message handlers for one connected socket.
 *
 * `registerConnectionHandlers` is the whole of what `io.on('connection')` does:
 * attach every `socket.on` listener this client will need. The listeners are
 * grouped by concern into the sibling modules imported below — see context.ts
 * for why they are split and what they share.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerConnectionHandlers = registerConnectionHandlers;
const maze_1 = require("../../maze");
const session_1 = require("./session");
const inventory_1 = require("./inventory");
const chat_1 = require("./chat");
const social_1 = require("./social");
const profile_1 = require("./profile");
const skills_1 = require("./skills");
/**
 * Attach every handler for a newly connected socket.
 *
 * Registration order does not matter — the event names are disjoint and nothing
 * is dispatched until the socket receives its first message.
 */
function registerConnectionHandlers(socket, io, deps) {
    console.log('A user connected');
    // Tell the client which daily maze to build. The layout is generated
    // deterministically from the day number by the shared maze module, so
    // this tiny message is all the "map data" the maze ever needs.
    {
        const maze = (0, maze_1.getActiveMaze)() || (0, maze_1.setActiveMazeDay)((0, maze_1.getCurrentMazeDay)());
        socket.emit('mazeInfo', { day: maze.dayNumber, biome: maze.biome });
    }
    // The map itself is bundled with the client via src/map_data.ts — no longer
    // streamed here. The server still imports WORLD_MAP / WALL_GRID locally for
    // collision, spawn, and pathfinding logic.
    const ctx = { socket, io, deps };
    (0, session_1.registerSessionHandlers)(ctx);
    (0, inventory_1.registerInventoryHandlers)(ctx);
    (0, chat_1.registerChatHandlers)(ctx);
    (0, social_1.registerSocialHandlers)(ctx);
    (0, profile_1.registerProfileHandlers)(ctx);
    (0, skills_1.registerSkillHandlers)(ctx);
}
