"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAltPressed = isAltPressed;
exports.setAltPressed = setAltPressed;
exports.onAltChange = onAltChange;
exports.installAltKeyTracking = installAltKeyTracking;
/**
 * ALT-key state, shared by every tooltip that swaps to detailed values while
 * ALT is held (the in-game inventory and the title-screen one).
 *
 * Was `window.altKeyPressed` + `window.altKeyTrackingSetup`: two globals whose
 * only job was to let two modules that don't import each other agree on one
 * boolean. Same job, module scope, plus a subscriber list so listeners don't
 * have to be registered through another global array.
 */
let altPressed = false;
const listeners = new Set();
function isAltPressed() {
    return altPressed;
}
function setAltPressed(pressed) {
    if (pressed === altPressed)
        return;
    altPressed = pressed;
    for (const listener of listeners)
        listener(pressed);
}
/** Subscribe to ALT press/release. Returns an unsubscribe function. */
function onAltChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
let trackingInstalled = false;
/**
 * Installs the document-level ALT listeners once per page. Callers that only
 * want to *read* the state don't need this; whoever cares that it stays fresh
 * calls it (idempotent).
 */
function installAltKeyTracking() {
    if (trackingInstalled)
        return;
    trackingInstalled = true;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Alt')
            setAltPressed(true);
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Alt')
            setAltPressed(false);
    });
    // Alt-Tab away and the keyup never arrives; the flag would stick on.
    window.addEventListener('blur', () => setAltPressed(false));
}
