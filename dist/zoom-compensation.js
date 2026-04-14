"use strict";
/**
 * Compensates for browser zoom so the game renders at consistent dimensions
 * regardless of the user's browser zoom level.
 *
 * Uses devicePixelRatio to detect browser zoom. We capture the base DPR at
 * load time (e.g. 2.0 on Retina) so we can distinguish browser zoom changes
 * from the display's native scaling. Unlike outerWidth/innerWidth, DPR does
 * not fluctuate during normal window resizes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBrowserZoom = getBrowserZoom;
exports.applyZoomCompensation = applyZoomCompensation;
exports.canvasCoords = canvasCoords;
const baseDPR = window.devicePixelRatio || 1;
function getBrowserZoom() {
    return (window.devicePixelRatio || 1) / baseDPR;
}
/**
 * Resizes a canvas to fill the viewport, compensating for browser zoom.
 * Sets canvas buffer size, CSS size, and transform so the canvas always
 * appears at the "100% zoom" dimensions.
 */
function applyZoomCompensation(canvas) {
    const zoom = getBrowserZoom();
    const width = Math.round(window.innerWidth * zoom);
    const height = Math.round(window.innerHeight * zoom);
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.style.transform = `scale(${1 / zoom})`;
    canvas.style.transformOrigin = '0 0';
}
/**
 * Converts mouse event CSS coordinates to canvas-space coordinates.
 * Accounts for the CSS transform applied by applyZoomCompensation.
 */
function canvasCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
}
