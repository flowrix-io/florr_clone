/**
 * Primitive canvas shape and colour helpers shared by every canvas UI surface.
 *
 * `drawRoundedRect` previously existed as nine hand-copies in three subtly
 * different flavours (plain, radius-clamped, and native-fast-path) and `darken`
 * as six identical ones. Both are defined once here.
 */

/**
 * Builds a rounded-rectangle path; the caller fills or strokes it.
 *
 * The radius is clamped to half the shorter side. Most of the former copies
 * omitted that clamp and drew a self-intersecting path when asked for a radius
 * larger than the box — the clamp is identical for every well-formed call and
 * draws a correct pill instead of a broken shape for the rest. The native
 * `ctx.roundRect` is used when present, which scales radii the same way.
 */
export function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
): void {
    if (typeof (ctx as any).roundRect === 'function') {
        ctx.beginPath();
        (ctx as any).roundRect(x, y, w, h, r);
        return;
    }
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
}

/** Darkens a #rrggbb colour by `percent`. */
export function darken(hex: string, percent: number = 30): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const f = 1 - percent / 100;
    const nr = Math.round(r * f);
    const ng = Math.round(g * f);
    const nb = Math.round(b * f);
    return `#${((nr << 16) | (ng << 8) | nb).toString(16).padStart(6, '0')}`;
}

/** Lightens a #rrggbb colour by `percent` (interpolates towards white). */
export function lighten(hex: string, percent: number = 30): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const f = percent / 100;
    const nr = Math.round(r + (255 - r) * f);
    const ng = Math.round(g + (255 - g) * f);
    const nb = Math.round(b + (255 - b) * f);
    return `#${((nr << 16) | (ng << 8) | nb).toString(16).padStart(6, '0')}`;
}
