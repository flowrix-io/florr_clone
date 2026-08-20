"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitToViewers = emitToViewers;
const constants_1 = require("../constants");
const utils_1 = require("./utils");
/**
 * Send `event` only to sockets whose viewport contains (x, y).
 *
 * `alwaysTo` is a player id that receives it regardless of distance — used for
 * the owner of an effect, who must see their own action even if the camera has
 * been moved elsewhere.
 */
function emitToViewers(io, x, y, event, payload, alwaysTo) {
    // One socket can back several player records (split halves), so dedupe by
    // socket id.
    const sent = new Set();
    if (alwaysTo) {
        const ownerSocketId = (0, utils_1.getOriginalSocketId)(alwaysTo);
        sent.add(ownerSocketId);
        io.to(ownerSocketId).emit(event, payload);
    }
    for (const otherId in constants_1.players) {
        const socketId = (0, utils_1.getOriginalSocketId)(otherId);
        if (sent.has(socketId))
            continue;
        sent.add(socketId);
        // Bots live in `players` with no socket; io.to() no-ops for them.
        const viewer = (0, utils_1.getActivePlayerForSocket)(socketId);
        if (!viewer)
            continue;
        const halfW = (viewer.viewportWidth || constants_1.VIEWPORT_WIDTH) * 2;
        const halfH = (viewer.viewportHeight || constants_1.VIEWPORT_HEIGHT) * 2;
        const dx = x - viewer.x;
        const dy = y - viewer.y;
        if ((dx < 0 ? -dx : dx) >= halfW || (dy < 0 ? -dy : dy) >= halfH)
            continue;
        io.to(socketId).emit(event, payload);
    }
}
