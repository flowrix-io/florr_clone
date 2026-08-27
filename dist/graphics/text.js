"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEXT_STROKE_SCALE = void 0;
exports.drawText = drawText;
/** gardn Renderer::TextArgs::stroke_scale — outline width per px of font size. */
exports.TEXT_STROKE_SCALE = 0.12;
function drawText(ctx, text, x, y, opts = {}) {
    const size = opts.size ?? 14;
    ctx.font = opts.font ?? `${opts.weight ? opts.weight + ' ' : ''}${size}px Ubuntu, sans-serif`;
    if (opts.align)
        ctx.textAlign = opts.align;
    if (opts.baseline)
        ctx.textBaseline = opts.baseline;
    const stroke = opts.stroke === undefined ? '#000000' : opts.stroke;
    const strokeWidth = opts.strokeWidth ?? size * exports.TEXT_STROKE_SCALE;
    if (stroke && strokeWidth > 0) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        // The outline strokes with the AMBIENT lineJoin, exactly like the
        // hand-rolled strokeText/fillText pairs this replaced — forcing
        // 'round' here changed glyph corners at miter-join sites and leaked
        // into later shape strokes. Callers that want round-joined outlines
        // set ctx.lineJoin themselves (as the originals did).
        if (opts.maxWidth !== undefined)
            ctx.strokeText(text, x, y, opts.maxWidth);
        else
            ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = opts.fill ?? '#ffffff';
    if (opts.maxWidth !== undefined)
        ctx.fillText(text, x, y, opts.maxWidth);
    else
        ctx.fillText(text, x, y);
}
