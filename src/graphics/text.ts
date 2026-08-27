/**
 * The one text-drawing function for all canvas UI.
 *
 * Mirrors gardn's Renderer::draw_text: set fill + stroke, stroke first at
 * `size * 0.12` line width (gardn's stroke_scale default), then fill on top.
 * Every UI file previously hand-rolled this as a strokeText/fillText pair
 * with its own font/lineWidth bookkeeping; they all route through here now.
 *
 * Deliberately does NOT touch textAlign/textBaseline unless asked, so call
 * sites that set alignment once for a block of text keep working unchanged.
 */

/** gardn Renderer::TextArgs::stroke_scale — outline width per px of font size. */
export const TEXT_STROKE_SCALE = 0.12;

export interface DrawTextOptions {
    /** Font size in px. Ignored when `font` is given. Default 14. */
    size?: number;
    /** 'bold' etc. Ignored when `font` is given. */
    weight?: string;
    /** Full CSS font override (e.g. '12px monospace'); wins over size/weight. */
    font?: string;
    /** Fill color. Default white, like gardn. */
    fill?: string;
    /** Outline color. Default black; pass null to skip the outline. */
    stroke?: string | null;
    /** Outline width. Default size * TEXT_STROKE_SCALE; 0 skips the outline. */
    strokeWidth?: number;
    /** Optional textAlign; ambient canvas state is left alone when omitted. */
    align?: CanvasTextAlign;
    /** Optional textBaseline; ambient canvas state is left alone when omitted. */
    baseline?: CanvasTextBaseline;
    /** Optional fillText/strokeText maxWidth clamp. */
    maxWidth?: number;
}

export function drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    opts: DrawTextOptions = {},
): void {
    const size = opts.size ?? 14;
    ctx.font = opts.font ?? `${opts.weight ? opts.weight + ' ' : ''}${size}px Ubuntu, sans-serif`;
    if (opts.align) ctx.textAlign = opts.align;
    if (opts.baseline) ctx.textBaseline = opts.baseline;

    const stroke = opts.stroke === undefined ? '#000000' : opts.stroke;
    const strokeWidth = opts.strokeWidth ?? size * TEXT_STROKE_SCALE;
    if (stroke && strokeWidth > 0) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        // The outline strokes with the AMBIENT lineJoin, exactly like the
        // hand-rolled strokeText/fillText pairs this replaced — forcing
        // 'round' here changed glyph corners at miter-join sites and leaked
        // into later shape strokes. Callers that want round-joined outlines
        // set ctx.lineJoin themselves (as the originals did).
        if (opts.maxWidth !== undefined) ctx.strokeText(text, x, y, opts.maxWidth);
        else ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = opts.fill ?? '#ffffff';
    if (opts.maxWidth !== undefined) ctx.fillText(text, x, y, opts.maxWidth);
    else ctx.fillText(text, x, y);
}
