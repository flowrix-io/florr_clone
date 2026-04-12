"use strict";
/**
 * Compensates for browser zoom so the game renders at consistent dimensions
 * regardless of the user's browser zoom level.
 *
 * Uses outerWidth/innerWidth ratio to detect zoom — outerWidth is unaffected
 * by browser zoom, so this works even if the page loads while already zoomed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBrowserZoom = getBrowserZoom;
exports.applyZoomCompensation = applyZoomCompensation;
exports.canvasCoords = canvasCoords;
function getBrowserZoom() {
    if (window.outerWidth && window.innerWidth) {
        return window.outerWidth / window.innerWidth;
    }
    return 1;
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
