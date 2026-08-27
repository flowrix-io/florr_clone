"use strict";
/**
 * The one tooltip implementation, styled after gardn's petal tooltips
 * (Client/Ui/InGame/Tooltip.cc): 50%-black rounded box (radius 6, no border),
 * left-aligned outlined text — name 20px white, rarity 14px in the rarity
 * color, a 10px spacer, then 12px body text.
 *
 * Two entry points share the same painter:
 *  - paintTooltip(): draws the box onto a caller's canvas (skills panel,
 *    mob gallery — panels that render tooltips inside their own frame loop).
 *  - showTooltip()/hideTooltip(): a singleton DOM overlay whose backing
 *    canvas is painted by the same painter (inventory item grids, where the
 *    tooltip must float above DOM/canvas panels).
 *
 * Lines may carry an `altText`; while ALT is held the alt variant renders
 * instead (the "show full values" behavior both inventory managers used to
 * reimplement). The DOM overlay re-paints itself on ALT changes; canvas
 * panels pick the swap up on their next frame automatically.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLTIP_STAT_COLOR = void 0;
exports.measureTooltip = measureTooltip;
exports.paintTooltip = paintTooltip;
exports.showTooltip = showTooltip;
exports.hideTooltip = hideTooltip;
exports.capitalizeRarity = capitalizeRarity;
exports.petalTooltipLines = petalTooltipLines;
const text_1 = require("./text");
const petals_1 = require("../petals");
const alt_key_1 = require("../alt_key");
// gardn tooltip chrome.
const TOOLTIP_BG = 'rgba(0, 0, 0, 0.5)';
const TOOLTIP_RADIUS = 6;
const PAD_X = 10;
const PAD_Y = 8;
const LINE_GAP = 2;
function fontFor(size) {
    return `${size}px Ubuntu, sans-serif`;
}
function lineHeight(size) {
    return Math.ceil(size * 1.2);
}
/** Resolves alt variants, wraps long lines, and stacks rows top-down. */
function layoutRows(ctx, lines) {
    const alt = (0, alt_key_1.isAltPressed)();
    const rows = [];
    let y = 0;
    let textW = 0;
    for (const line of lines) {
        const size = line.size ?? 12;
        const color = line.color ?? '#ffffff';
        const text = alt && line.altText !== undefined ? line.altText : line.text;
        y += line.gapBefore ?? 0;
        let pieces = [text];
        ctx.font = fontFor(size);
        if (line.maxWidth !== undefined && ctx.measureText(text).width > line.maxWidth) {
            pieces = [];
            let current = '';
            for (const word of text.split(' ')) {
                const candidate = current ? `${current} ${word}` : word;
                if (current && ctx.measureText(candidate).width > line.maxWidth) {
                    pieces.push(current);
                    current = word;
                }
                else {
                    current = candidate;
                }
            }
            if (current)
                pieces.push(current);
        }
        for (const piece of pieces) {
            const w = ctx.measureText(piece).width;
            if (w > textW)
                textW = w;
            rows.push({ text: piece, size, color, y });
            y += lineHeight(size) + LINE_GAP;
        }
    }
    return { rows, textW, textH: Math.max(0, y - LINE_GAP) };
}
/** Box size for a tooltip, without painting it. */
function measureTooltip(ctx, lines, opts = {}) {
    const { textW, textH } = layoutRows(ctx, lines);
    return {
        w: Math.max(textW, opts.minContentW ?? 0) + PAD_X * 2,
        h: textH + (opts.extraH ?? 0) + PAD_Y * 2,
    };
}
/** Paints the gardn-style box + text rows at (x, y); returns the layout so
 *  callers can draw extra content (drop tables, …) into the reserved space. */
function paintTooltip(ctx, x, y, lines, opts = {}) {
    const { rows, textW, textH } = layoutRows(ctx, lines);
    const w = Math.max(textW, opts.minContentW ?? 0) + PAD_X * 2;
    const h = textH + (opts.extraH ?? 0) + PAD_Y * 2;
    ctx.save();
    ctx.fillStyle = TOOLTIP_BG;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, TOOLTIP_RADIUS);
    ctx.fill();
    // gardn strokes text with round joins (its renderer sets them globally);
    // scoped to this save/restore so panel code keeps its own join.
    ctx.lineJoin = 'round';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const row of rows) {
        (0, text_1.drawText)(ctx, row.text, x + PAD_X, y + PAD_Y + row.y, {
            size: row.size,
            fill: row.color,
        });
    }
    ctx.restore();
    return { x, y, w, h, contentX: x + PAD_X, textBottom: y + PAD_Y + textH };
}
let overlayEl = null;
let overlayCanvas = null;
let overlayLines = [];
let overlayAnchor = null;
let altHooked = false;
function paintOverlay() {
    if (!overlayEl || !overlayCanvas || !overlayAnchor)
        return;
    const ctx = overlayCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = measureTooltip(ctx, overlayLines);
    overlayCanvas.width = Math.ceil(w * dpr);
    overlayCanvas.height = Math.ceil(h * dpr);
    overlayCanvas.style.width = `${w}px`;
    overlayCanvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintTooltip(ctx, 0, 0, overlayLines);
    // Right of the anchor, else left; clamped vertically to the viewport.
    const a = overlayAnchor;
    let left = a.right + 10;
    if (left + w > window.innerWidth)
        left = a.left - w - 10;
    let top = a.top;
    if (top + h > window.innerHeight)
        top = window.innerHeight - h - 10;
    if (top < 0)
        top = 10;
    overlayEl.style.left = `${left}px`;
    overlayEl.style.top = `${top}px`;
}
/** Shows (or moves/re-renders) the singleton tooltip next to `anchor`. */
function showTooltip(anchor, lines) {
    (0, alt_key_1.installAltKeyTracking)();
    if (!altHooked) {
        altHooked = true;
        (0, alt_key_1.onAltChange)(() => {
            if (overlayEl && overlayLines.some((l) => l.altText !== undefined))
                paintOverlay();
        });
    }
    if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.className = 'petal-tooltip';
        overlayEl.style.cssText =
            'position: fixed; z-index: 10000; pointer-events: none; left: 0; top: 0;';
        overlayCanvas = document.createElement('canvas');
        overlayEl.appendChild(overlayCanvas);
        document.body.appendChild(overlayEl);
    }
    overlayLines = lines;
    overlayAnchor = anchor;
    paintOverlay();
}
function hideTooltip() {
    if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
        overlayCanvas = null;
    }
    overlayLines = [];
    overlayAnchor = null;
}
// ---------------------------------------------------------------------------
// Shared content builders.
// ---------------------------------------------------------------------------
function capitalizeRarity(rarity) {
    return rarity ? rarity.charAt(0).toUpperCase() + rarity.slice(1) : rarity;
}
/** gardn's dimmed stat-line color (0xffffff90). */
exports.TOOLTIP_STAT_COLOR = 'rgba(255, 255, 255, 0.56)';
/** The petal tooltip both inventory managers show: name / rarity / description
 *  / HP + damage (abbreviated, ALT swaps in the full values). */
function petalTooltipLines(stats, rarity, health, damage, abbreviate) {
    const lines = [
        { text: stats.name, size: 20 },
        { text: capitalizeRarity(rarity), size: 14, color: petals_1.ITEM_RARITY_COLORS[rarity] || '#ffffff' },
    ];
    if (stats.description) {
        lines.push({ text: stats.description, size: 12, gapBefore: 10, maxWidth: 230 });
    }
    lines.push({
        text: `HP: ${abbreviate(health)}`,
        altText: `HP: ${health}`,
        size: 12,
        color: exports.TOOLTIP_STAT_COLOR,
        gapBefore: stats.description ? 4 : 10,
    }, {
        text: `Damage: ${abbreviate(damage)}`,
        altText: `Damage: ${damage}`,
        size: 12,
        color: exports.TOOLTIP_STAT_COLOR,
    });
    return lines;
}
