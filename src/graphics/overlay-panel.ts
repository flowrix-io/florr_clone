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
import { drawRoundedRect } from './shapes';
import { drawText } from './text';

/** An axis-aligned rect in canvas space, as the panels store button bounds. */
export interface PanelRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Standard pill-button size for the panel header row. */
export const PANEL_BUTTON_HEIGHT = 30;
/** Distance from the panel's top edge to the header button row. */
export const PANEL_BUTTON_TOP = 10;
/** Width of the square close button. */
export const CLOSE_BUTTON_SIZE = 30;

/** Hit test against a stored bounds rect; a null rect never hits. */
export function pointInRect(rect: PanelRect | null | undefined, x: number, y: number): boolean {
    if (!rect) return false;
    return x >= rect.x && x <= rect.x + rect.width &&
           y >= rect.y && y <= rect.y + rect.height;
}

/** The panel's rounded card: fill plus a 2px border. */
export function drawPanelBackground(
    ctx: CanvasRenderingContext2D,
    offsetX: number, offsetY: number,
    width: number, height: number,
    fill: string, stroke: string,
): void {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, offsetX, offsetY, width, height, 10);
    ctx.fill();
    ctx.stroke();
}

/** The panel's heading, top-left inside the padding. */
export function drawPanelTitle(
    ctx: CanvasRenderingContext2D,
    title: string,
    offsetX: number, offsetY: number, padding: number,
): void {
    ctx.textBaseline = 'top';
    drawText(ctx, title, offsetX + padding, offsetY + padding, {
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
export function drawPillButton(
    ctx: CanvasRenderingContext2D,
    rect: PanelRect,
    label: string,
    fill: string,
    fontSize: number = 14,
): PanelRect {
    ctx.fillStyle = fill;
    drawRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 5);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawText(ctx, label, rect.x + rect.width / 2, rect.y + rect.height / 2, {
        size: fontSize, fill: '#FFFFFF', strokeWidth: 0,
    });
    ctx.textAlign = 'left';
    return rect;
}

/** Where a header button of `width` sits, counting `fromRight` px in from the panel's right edge. */
export function headerButtonRect(
    offsetX: number, offsetY: number, panelWidth: number,
    fromRight: number, width: number,
): PanelRect {
    return {
        x: offsetX + panelWidth - fromRight,
        y: offsetY + PANEL_BUTTON_TOP,
        width,
        height: PANEL_BUTTON_HEIGHT,
    };
}

/** The red ✕ in the panel's top-right corner. Returns its hit bounds. */
export function drawCloseButton(
    ctx: CanvasRenderingContext2D,
    offsetX: number, offsetY: number, panelWidth: number,
): PanelRect {
    const rect = headerButtonRect(offsetX, offsetY, panelWidth, 50, CLOSE_BUTTON_SIZE);
    return drawPillButton(ctx, rect, '✕', '#ff4444', 16);
}

/** Geometry of the scrollbar track down the panel's right edge. */
export interface ScrollbarLayout {
    x: number;
    trackY: number;
    trackHeight: number;
    width: number;
}

/**
 * Where the scrollbar sits. `headerHeight` is the chrome above the scrolling
 * body — the single number that decides the track, the thumb and the grab zone,
 * which is why it is threaded through rather than written as a literal.
 */
export function scrollbarLayout(
    offsetX: number, offsetY: number,
    panelWidth: number, panelHeight: number,
    headerHeight: number, scrollbarWidth: number,
): ScrollbarLayout {
    return {
        x: offsetX + panelWidth - scrollbarWidth - 5,
        trackY: offsetY + headerHeight,
        trackHeight: panelHeight - headerHeight - 5,
        width: scrollbarWidth,
    };
}

/** Draws the scrollbar track and thumb. Caller decides whether it is needed. */
export function drawScrollbar(
    ctx: CanvasRenderingContext2D,
    layout: ScrollbarLayout,
    opts: {
        contentHeight: number;
        panelHeight: number;
        headerHeight: number;
        scrollY: number;
        maxScroll: number;
        thumbColor: string;
    },
): void {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    drawRoundedRect(ctx, layout.x, layout.trackY, layout.width, layout.trackHeight, 5);
    ctx.fill();

    const viewportHeight = opts.panelHeight - opts.headerHeight;
    const thumbHeight = (viewportHeight - 5) * viewportHeight / opts.contentHeight;
    const thumbY = layout.trackY + (opts.scrollY / opts.maxScroll) * (layout.trackHeight - thumbHeight);
    ctx.fillStyle = opts.thumbColor;
    drawRoundedRect(ctx, layout.x, thumbY, layout.width, thumbHeight, 5);
    ctx.fill();
}

/** True when (x, y) is inside the scrollbar's grab zone. */
export function pointInScrollbar(layout: ScrollbarLayout, panelBottom: number, x: number, y: number): boolean {
    return x >= layout.x && x <= layout.x + layout.width &&
           y >= layout.trackY && y <= panelBottom - 5;
}
