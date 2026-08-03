/**
 * Whether the main canvas's 2D context has been created this session.
 *
 * The GPU-vs-software backing is fixed at getContext() time and can't switch on
 * a live canvas, so the "Enable GPU Acceleration" setting has to reload the
 * page — but only once a context exists (before that it applies cleanly on the
 * first join). Was `window.__mainCanvasCtxCommitted`.
 *
 * Deliberately a leaf module with no imports: the setter is in graphics/core
 * and the reader is in the settings menu, and neither should have to import
 * the other.
 */
let committed = false;

export function markMainCanvasCtxCommitted(): void {
    committed = true;
}

export function isMainCanvasCtxCommitted(): boolean {
    return committed;
}
