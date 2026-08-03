import type { Socket } from '../ws_client';

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
let preconnectedSocket: Socket | null = null;

export function getPreconnectedSocket(): Socket | null {
    return preconnectedSocket;
}

export function setPreconnectedSocket(socket: Socket | null): void {
    preconnectedSocket = socket;
}

/** The preconnected socket, but only if it is actually connected. */
export function getLivePreconnectedSocket(): Socket | null {
    return preconnectedSocket && (preconnectedSocket as any).connected ? preconnectedSocket : null;
}

type PreconnectHooks = {
    /** Open a preconnected socket if there isn't one already. */
    preconnect: () => void;
    /** Hand a still-connected in-game socket back to the title screen. */
    reuseSocketForTitleScreen: (socket: Socket) => void;
};

let hooks: PreconnectHooks | null = null;

export function setPreconnectHooks(next: PreconnectHooks): void {
    hooks = next;
}

export function requestPreconnect(): void {
    hooks?.preconnect();
}

export function reuseSocketForTitleScreen(socket: Socket): void {
    hooks?.reuseSocketForTitleScreen(socket);
}
