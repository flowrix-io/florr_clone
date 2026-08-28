"use strict";
/**
 * Scroll arithmetic shared by the canvas overlay panels (leaderboard,
 * notifications, changelog).
 *
 * All three implement the same scrollbar by hand and had the same two
 * expressions — the clamp bound and the thumb-drag mapping — copied across
 * eight call sites, including the bare `- 40` / `- 45` chrome insets.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxScrollFor = maxScrollFor;
exports.scrollFromThumbDrag = scrollFromThumbDrag;
/** Height of the panel chrome (title bar + padding) above the scroll viewport. */
const PANEL_CHROME_HEIGHT = 40;
/** Track length used to map a thumb drag onto the content range. */
const SCROLLBAR_TRACK_INSET = 45;
/**
 * Furthest the content can scroll before its end reaches the viewport bottom.
 *
 * `headerHeight` is the chrome above the scrolling body. It defaults to the
 * common 40px, but must be passed when a panel draws a taller header — the
 * leaderboard draws 50 and used to clamp against 40, so it scrolled ten pixels
 * past its own content.
 */
function maxScrollFor(contentHeight, panelHeight, headerHeight = PANEL_CHROME_HEIGHT) {
    return Math.max(0, contentHeight - (panelHeight - headerHeight));
}
/**
 * New scroll offset for a scrollbar-thumb drag of `deltaY` pixels, clamped to
 * the content range.
 */
function scrollFromThumbDrag(dragStartScroll, deltaY, panelHeight, maxScroll) {
    const scrollRatio = deltaY / (panelHeight - SCROLLBAR_TRACK_INSET);
    return Math.max(0, Math.min(maxScroll, dragStartScroll + scrollRatio * maxScroll));
}
