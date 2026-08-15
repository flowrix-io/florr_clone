/**
 * The client end of the one-account-one-connection rule (see
 * server/connection/sessionGuard.ts).
 *
 * When another tab or device signs into this account, the server flushes this
 * session's progress, emits `sessionReplaced` and closes the socket. Two things
 * have to happen here, in this order: stop reconnecting, and say why. Without
 * the first, the socket's auto-reconnect would re-authenticate, kick the tab
 * that just took over, and the two tabs would trade the account back and forth
 * forever.
 *
 * The server exempts loopback connections, so this never fires while developing
 * against a local server with several tabs open.
 */

import { getCurrentGame } from '../app_refs';

let replaced = false;

/** True once this page has been signed out by a session elsewhere. */
export function isSessionReplaced(): boolean {
    return replaced;
}

/**
 * Bind the handler to a socket. Safe to call for every socket the page owns
 * (title-screen preconnect, in-game, post-transfer) — the overlay is shown once.
 */
export function attachSessionReplacedHandler(socket: any): void {
    socket.on('sessionReplaced', (data?: { message?: string }) => {
        if (replaced) return;
        replaced = true;
        // Before the overlay: disconnect() clears the reconnect timer, which is
        // what stops the two tabs from fighting over the account.
        try { socket.disconnect(); } catch { /* already closed */ }
        // This tab is finished, so closing or reloading it must not be argued
        // with — least of all by a page whose own button reloads.
        getCurrentGame()?.suppressUnloadWarning();
        showSessionReplacedOverlay(data?.message);
    });
}

function showSessionReplacedOverlay(message?: string): void {
    if (document.getElementById('session-replaced-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'session-replaced-overlay';
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        background: rgba(0, 0, 0, 0.88);
        color: #fff;
        font-family: Ubuntu, sans-serif;
        text-align: center;
        padding: 24px;
    `;

    const text = document.createElement('div');
    text.style.cssText = 'font-size: 20px; max-width: 480px; line-height: 1.4;';
    text.textContent = message || 'You signed in from another tab or device.';

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size: 14px; opacity: 0.75;';
    hint.textContent = 'Only one tab can play an account at a time.';

    const button = document.createElement('button');
    button.textContent = 'Play here instead';
    button.style.cssText = `
        margin-top: 8px;
        padding: 10px 22px;
        font-size: 16px;
        font-family: Ubuntu, sans-serif;
        cursor: pointer;
        border: none;
        border-radius: 6px;
        background: #4caf50;
        color: #fff;
    `;
    // Reloading re-authenticates, which kicks whichever tab took over — the
    // rule is one live session, not first-come-first-served.
    button.onclick = () => window.location.reload();

    overlay.append(text, hint, button);
    document.body.appendChild(overlay);
}
