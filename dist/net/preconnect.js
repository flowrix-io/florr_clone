"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPreconnectedSocket = getPreconnectedSocket;
exports.setPreconnectedSocket = setPreconnectedSocket;
exports.getLivePreconnectedSocket = getLivePreconnectedSocket;
exports.setPreconnectHooks = setPreconnectHooks;
exports.requestPreconnect = requestPreconnect;
exports.reuseSocketForTitleScreen = reuseSocketForTitleScreen;
/**
 * The socket opened from the title screen before the player presses play, plus
 * the two hand-off hooks index.ts owns.
 *
 * This was `window.preconnectedSocket` — an authenticated, writable socket
 * sitting on the global object, i.e. a ready-made `emit()` console for anyone
 * who opened devtools. It is module state now; index.ts registers the hooks at
 * boot so the title screen and the Game can ask for a (re)connect without
 * importing the entry module and creating a cycle.
 */
let preconnectedSocket = null;
function getPreconnectedSocket() {
    return preconnectedSocket;
}
function setPreconnectedSocket(socket) {
    preconnectedSocket = socket;
}
/** The preconnected socket, but only if it is actually connected. */
function getLivePreconnectedSocket() {
    return preconnectedSocket && preconnectedSocket.connected ? preconnectedSocket : null;
}
let hooks = null;
function setPreconnectHooks(next) {
    hooks = next;
}
function requestPreconnect() {
    hooks?.preconnect();
}
function reuseSocketForTitleScreen(socket) {
    hooks?.reuseSocketForTitleScreen(socket);
}
