"use strict";
/**
 * Session-scoped admin grants — the `grant_admin` console command.
 *
 * A real admin (an account with `admin: true` in the database) can hand the
 * admin console to another player for the rest of their current life. The grant
 * is deliberately weak:
 *
 *   * memory only — nothing is written to the account record, so a restart
 *     wipes every outstanding grant;
 *   * keyed by socket id, not username, so it belongs to ONE connection and
 *     cannot be carried into a second tab or a later login;
 *   * cleared the moment the player respawns, returns to the title screen or
 *     disconnects (see respawnPlayer and endPlayerSession).
 *
 * It only unlocks the `/admin` + `/cmd` console (and the admin section of
 * `/help`). Everything else that keys off admin status — API-key scope, chat
 * image-moderation bypass, custom-skin takedowns, leaderboard hiding — stays
 * tied to the persistent account flag, so a temporary admin cannot mint
 * themselves anything that outlives the grant. Granting is likewise restricted
 * to real admins so a grantee cannot extend the chain.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantTempAdmin = grantTempAdmin;
exports.revokeTempAdmin = revokeTempAdmin;
exports.hasTempAdmin = hasTempAdmin;
exports.getTempAdmin = getTempAdmin;
exports.listTempAdmins = listTempAdmins;
/** socket id (splitter halves normalized to the original) -> grant */
const grants = new Map();
/**
 * Splitter halves are one person on one socket, so both `_split1` and `_split2`
 * ids must land on the same grant. Stripping the suffix is the same fallback
 * getOriginalSocketId() uses; it's inlined here to keep this module import-free
 * (playerManager and commands both depend on it).
 */
function normalizeId(socketId) {
    return socketId.replace('_split1', '').replace('_split2', '');
}
/** Give `socketId` the admin console until they respawn or the socket ends. */
function grantTempAdmin(socketId, grantedBy) {
    grants.set(normalizeId(socketId), { grantedBy, grantedAt: Date.now() });
}
/** Drop the grant. Returns true if there was one to drop. */
function revokeTempAdmin(socketId) {
    return grants.delete(normalizeId(socketId));
}
function hasTempAdmin(socketId) {
    return grants.has(normalizeId(socketId));
}
function getTempAdmin(socketId) {
    return grants.get(normalizeId(socketId));
}
/** Every outstanding grant, for the `list_admins` command. */
function listTempAdmins() {
    return Array.from(grants.entries()).map(([socketId, grant]) => ({ socketId, grant }));
}
