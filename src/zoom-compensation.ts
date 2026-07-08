/**
 * Compensates for browser zoom so the game renders at consistent dimensions
 * regardless of the user's browser zoom level.
 *
 * Uses devicePixelRatio to detect browser zoom. We capture the base DPR at
 * load time (e.g. 2.0 on Retina) so we can distinguish browser zoom changes
 * from the display's native scaling. Unlike outerWidth/innerWidth, DPR does
 * not fluctuate during normal window resizes.
 */

const baseDPR = window.devicePixelRatio || 1;

export function getBrowserZoom(): number {
    return (window.devicePixelRatio || 1) / baseDPR;
}

/**
 * The display's native device-pixel ratio captured at load (e.g. 2.0 on
 * Retina). The main canvas is sized in CSS pixels (so UI stays the right
 * size); multiplying by this gives the *physical* pixel resolution, which is
 * what the world is rendered at so "100%" render resolution is truly 1:1 with
 * the screen instead of being upscaled from CSS pixels.
 */
export function getBaseDeviceScale(): number {
    return baseDPR;
}

/**
 * Resizes a canvas to fill the viewport, compensating for browser zoom.
 * Sets canvas buffer size, CSS size, and transform so the canvas always
 * appears at the "100% zoom" dimensions.
 *
 * `antialiasing = false` switches the CSS scaler to nearest-neighbor so any
 * stretched textures (including the lower-res buffer used by the Render
 * Resolution setting) don't get blurred by the browser.
 *
 * `hidpi = true` makes the backing store the display's *physical* pixel
 * resolution (logical size × baseDPR) while keeping the on-screen (CSS) size
 * the same. Drawing code is expected to apply a `scale(baseDPR)` base
 * transform and work in *logical* coordinates (see Graphics.viewW/viewH), so
 * everything — world and UI — is rendered at native resolution and "100%"
 * render resolution is truly 1:1 with the screen. Used for the main game
 * canvas; the title screen passes `false` and stays at CSS resolution.
 */
export function applyZoomCompensation(canvas: HTMLCanvasElement, antialiasing: boolean = true, hidpi: boolean = false): void {
    const zoom = getBrowserZoom();
    const dpr = hidpi ? baseDPR : 1;
    // Logical (CSS) size — what layout/coordinate code reasons in.
    const cssW = Math.round(window.innerWidth * zoom);
    const cssH = Math.round(window.innerHeight * zoom);
    // Backing store — physical pixels when hidpi, so rendering is crisp.
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.style.transform = `scale(${1 / zoom})`;
    canvas.style.transformOrigin = '0 0';
    canvas.style.imageRendering = antialiasing ? 'auto' : 'pixelated';
}

/**
 * Converts a mouse event to *logical* canvas coordinates (the coordinate
 * space drawing code uses).
 *
 * For a `hidpi` canvas the backing store is baseDPR× the CSS size, so we
 * divide that factor back out — `canvas.width / rect.width` is `zoom ×
 * baseDPR`, and dividing by baseDPR leaves `zoom`, mapping a CSS-pixel event
 * onto the logical (viewW/viewH) space. For a normal (CSS-resolution) canvas
 * — e.g. the title screen's uiCanvas — the backing store already *is* the
 * logical space, so no division is applied.
 */
export function canvasCoords(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }, hidpi: boolean = false): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const s = hidpi ? baseDPR : 1;
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width) / s,
        y: (e.clientY - rect.top) * (canvas.height / rect.height) / s,
    };
}
