"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOSE_BUTTON_SIZE = exports.PANEL_BUTTON_TOP = exports.PANEL_BUTTON_HEIGHT = void 0;
exports.pointInRect = pointInRect;
exports.drawPanelBackground = drawPanelBackground;
exports.drawPanelTitle = drawPanelTitle;
exports.drawPillButton = drawPillButton;
exports.headerButtonRect = headerButtonRect;
exports.drawCloseButton = drawCloseButton;
exports.scrollbarLayout = scrollbarLayout;
exports.drawScrollbar = drawScrollbar;
exports.pointInScrollbar = pointInScrollbar;
/**
 * The chrome shared by the full-screen canvas overlays: the leaderboard, the
 * notifications list and the changelog.
 *
 * All three are the same panel — rounded card, title, a row of pill buttons in
 * the top-right, a clipped scrolling body and a scrollbar down the right edge —
 * and each drew every one of those by hand. The close button alone existed
 * three times with the same magic offsets, and the pill button five times.
 *
 * These are pure draw/hit helpers rather than a base class: the three panels
 * differ in what they put in the body, and inheritance would only share the
 * parts that are already shared here.
 */
const shapes_1 = require("./shapes");
const text_1 = require("./text");
/** Standard pill-button size for the panel header row. */
exports.PANEL_BUTTON_HEIGHT = 30;
/** Distance from the panel's top edge to the header button row. */
exports.PANEL_BUTTON_TOP = 10;
/** Width of the square close button. */
exports.CLOSE_BUTTON_SIZE = 30;
/** Hit test against a stored bounds rect; a null rect never hits. */
function pointInRect(rect, x, y) {
    if (!rect)
        return false;
    return x >= rect.x && x <= rect.x + rect.width &&
        y >= rect.y && y <= rect.y + rect.height;
}
/** The panel's rounded card: fill plus a 2px border. */
function drawPanelBackground(ctx, offsetX, offsetY, width, height, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    (0, shapes_1.drawRoundedRect)(ctx, offsetX, offsetY, width, height, 10);
    ctx.fill();
    ctx.stroke();
}
/** The panel's heading, top-left inside the padding. */
function drawPanelTitle(ctx, title, offsetX, offsetY, padding) {
    ctx.textBaseline = 'top';
    (0, text_1.drawText)(ctx, title, offsetX + padding, offsetY + padding, {
        size: 20, weight: 'bold', fill: '#FFFFFF', strokeWidth: 2,
    });
}
/**
 * A rounded header button with a centred label. Returns the rect so the caller
 * can store it as the button's hit bounds.
 *
 * Restores `textAlign` to 'left' on the way out, which every call site relied
 * on the previous copies doing.
 */
function drawPillButton(ctx, rect, label, fill, fontSize = 14) {
    ctx.fillStyle = fill;
    (0, shapes_1.drawRoundedRect)(ctx, rect.x, rect.y, rect.width, rect.height, 5);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (0, text_1.drawText)(ctx, label, rect.x + rect.width / 2, rect.y + rect.height / 2, {
        size: fontSize, fill: '#FFFFFF', strokeWidth: 0,
    });
    ctx.textAlign = 'left';
    return rect;
}
/** Where a header button of `width` sits, counting `fromRight` px in from the panel's right edge. */
function headerButtonRect(offsetX, offsetY, panelWidth, fromRight, width) {
    return {
        x: offsetX + panelWidth - fromRight,
        y: offsetY + exports.PANEL_BUTTON_TOP,
        width,
        height: exports.PANEL_BUTTON_HEIGHT,
    };
}
/** The red ✕ in the panel's top-right corner. Returns its hit bounds. */
function drawCloseButton(ctx, offsetX, offsetY, panelWidth) {
    const rect = headerButtonRect(offsetX, offsetY, panelWidth, 50, exports.CLOSE_BUTTON_SIZE);
    return drawPillButton(ctx, rect, '✕', '#ff4444', 16);
}
/**
 * Where the scrollbar sits. `headerHeight` is the chrome above the scrolling
 * body — the single number that decides the track, the thumb and the grab zone,
 * which is why it is threaded through rather than written as a literal.
 */
function scrollbarLayout(offsetX, offsetY, panelWidth, panelHeight, headerHeight, scrollbarWidth) {
    return {
        x: offsetX + panelWidth - scrollbarWidth - 5,
        trackY: offsetY + headerHeight,
        trackHeight: panelHeight - headerHeight - 5,
        width: scrollbarWidth,
    };
}
/** Draws the scrollbar track and thumb. Caller decides whether it is needed. */
function drawScrollbar(ctx, layout, opts) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    (0, shapes_1.drawRoundedRect)(ctx, layout.x, layout.trackY, layout.width, layout.trackHeight, 5);
    ctx.fill();
    const viewportHeight = opts.panelHeight - opts.headerHeight;
    const thumbHeight = (viewportHeight - 5) * viewportHeight / opts.contentHeight;
    const thumbY = layout.trackY + (opts.scrollY / opts.maxScroll) * (layout.trackHeight - thumbHeight);
    ctx.fillStyle = opts.thumbColor;
    (0, shapes_1.drawRoundedRect)(ctx, layout.x, thumbY, layout.width, thumbHeight, 5);
    ctx.fill();
}
/** True when (x, y) is inside the scrollbar's grab zone. */
function pointInScrollbar(layout, panelBottom, x, y) {
    return x >= layout.x && x <= layout.x + layout.width &&
        y >= layout.trackY && y <= panelBottom - 5;
}
