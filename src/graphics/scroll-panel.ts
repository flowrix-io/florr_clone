/**
 * Scroll arithmetic shared by the canvas overlay panels (leaderboard,
 * notifications, changelog).
 *
 * All three implement the same scrollbar by hand and had the same two
 * expressions — the clamp bound and the thumb-drag mapping — copied across
 * eight call sites, including the bare `- 40` / `- 45` chrome insets.
 */

/** Height of the panel chrome (title bar + padding) above the scroll viewport. */
const PANEL_CHROME_HEIGHT = 40;
/** Track length used to map a thumb drag onto the content range. */
const SCROLLBAR_TRACK_INSET = 45;

/** Furthest the content can scroll before its end reaches the viewport bottom. */
export function maxScrollFor(contentHeight: number, panelHeight: number): number {
    return Math.max(0, contentHeight - (panelHeight - PANEL_CHROME_HEIGHT));
}

/**
 * New scroll offset for a scrollbar-thumb drag of `deltaY` pixels, clamped to
 * the content range.
 */
export function scrollFromThumbDrag(
    dragStartScroll: number,
    deltaY: number,
    panelHeight: number,
    maxScroll: number,
): number {
    const scrollRatio = deltaY / (panelHeight - SCROLLBAR_TRACK_INSET);
    return Math.max(0, Math.min(maxScroll, dragStartScroll + scrollRatio * maxScroll));
}
