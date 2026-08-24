"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOT_ID_PREFIX = void 0;
exports.isBotId = isBotId;
/**
 * How a bot is recognised.
 *
 * A leaf module on purpose: the loot rule needs this and so does botManager,
 * but botManager reaches half the server (the world map, the grid, the socket
 * server), so importing it from the reward path would close a cycle.
 */
exports.BOT_ID_PREFIX = 'bot_';
/** Whether this player id belongs to a filler bot rather than a real account. */
function isBotId(playerId) {
    return playerId.startsWith(exports.BOT_ID_PREFIX);
}
