"use strict";
/**
 * The player's own presentation: display name and custom skins.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProfileHandlers = registerProfileHandlers;
const constants_1 = require("../../constants");
const database_1 = require("../../database");
const skin_format_1 = require("../../skin_format");
function registerProfileHandlers(ctx) {
    const { io, socket } = ctx;
    const { savePlayerProgressImmediate } = ctx.deps;
    socket.on('updateName', (newName) => {
        const player = constants_1.players[socket.id];
        if (player) {
            player.name = newName.slice(0, 20);
            // Name changes need to go to all players
            io.emit('playerUpdated', { id: player.id, name: player.name });
        }
    });
    // ── Custom skin studio ────────────────────────────────────────────────
    // Any logged-in (non-guest) player may publish a data-driven skin. The
    // payload is sanitized through the shared validator before it is stored or
    // broadcast, so an untrusted client can never get arbitrary content onto
    // other players' screens. Published skins are broadcast to everyone so they
    // render on whoever equips them.
    const skinNotify = (content) => io.to(socket.id).emit('chatMessage', { sender: 'Skins', content, timestamp: Date.now() });
    socket.on('publishSkin', (payload) => {
        if (!socket.username)
            return;
        // Guests can play but shouldn't spam the shared catalog.
        if (/^User\d{8}$/.test(socket.username)) {
            skinNotify('Create a (non-guest) account to publish skins.');
            return;
        }
        const result = (0, skin_format_1.sanitizeSkin)(payload);
        if ('error' in result) {
            skinNotify(result.error);
            return;
        }
        if (database_1.database.countCustomSkinsByAuthor(socket.username) >= skin_format_1.MAX_SKINS_PER_USER) {
            skinNotify(`You've reached the limit of ${skin_format_1.MAX_SKINS_PER_USER} published skins. Delete one first.`);
            return;
        }
        const id = 'sk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        const skin = {
            id,
            name: result.name,
            author: socket.username,
            shapes: result.shapes,
            createdAt: Date.now(),
        };
        database_1.database.saveCustomSkin(skin);
        io.emit('skinPublished', skin); // everyone needs it to render wearers
        skinNotify(`Published "${skin.name}". It's now in the Browse tab.`);
    });
    socket.on('deleteSkin', (rawId) => {
        if (!socket.username)
            return;
        const id = typeof rawId === 'string' ? rawId : '';
        const skin = database_1.database.getCustomSkin(id);
        if (!skin)
            return;
        const isAdmin = database_1.database.isUserAdmin(socket.username);
        const isOwner = skin.author.toLowerCase() === socket.username.toLowerCase();
        if (!isAdmin && !isOwner) {
            skinNotify('You can only take down your own skins.');
            return;
        }
        database_1.database.deleteCustomSkin(id);
        io.emit('skinDeleted', id);
        skinNotify(isOwner ? `Deleted "${skin.name}".` : `Took down "${skin.name}" by ${skin.author}.`);
    });
    socket.on('equipSkin', (rawId) => {
        if (!socket.username)
            return;
        const player = constants_1.players[socket.id];
        if (!player)
            return;
        const id = typeof rawId === 'string' ? rawId : '';
        if (id && !database_1.database.getCustomSkin(id)) {
            skinNotify('That skin no longer exists.');
            return;
        }
        player.equippedSkinId = id;
        // A custom skin replaces any built-in skin flag so they don't conflict.
        if (id)
            player.renderFlags = 0;
        if (socket.userId)
            savePlayerProgressImmediate(player, socket.userId);
    });
}
