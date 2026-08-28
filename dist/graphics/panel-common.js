"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lighten = exports.darken = void 0;
exports.syncCanvasSize = syncCanvasSize;
exports.findItemIndex = findItemIndex;
exports.drawItemIcon = drawItemIcon;
exports.drawItemSlot = drawItemSlot;
// Shared building blocks for the canvas UI panels (inventory, crafting,
// mob gallery, skills). CanvasInventoryPanel and CanvasCraftingPanel were
// forked from one another and carried byte-identical copies of the item-slot
// renderer, the icon renderer, the colour helper and the DPR canvas sizing;
// those live here once.
const petals_1 = require("../petals");
const petal_icon_1 = require("./petal-icon");
const text_1 = require("./text");
const petal_display_1 = require("./petal-display");
const shapes_1 = require("./shapes");
Object.defineProperty(exports, "darken", { enumerable: true, get: function () { return shapes_1.darken; } });
Object.defineProperty(exports, "lighten", { enumerable: true, get: function () { return shapes_1.lighten; } });
/**
 * Matches the canvas backing store to its CSS box at the current device pixel
 * ratio. Returns the ratio and CSS size so the caller can set up its transform.
 *
 * Note: CanvasInventoryPanel deliberately does NOT use this — it caches its CSS
 * size and must re-arm its dirty flag when the backing store is reset. See
 * its own syncCanvasSize().
 */
function syncCanvasSize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    return { dpr, cssW: rect.width, cssH: rect.height };
}
/** Index of the cell matching rarity+itemType, or -1. */
function findItemIndex(rects, rarity, itemType) {
    for (let i = 0; i < rects.length; i++) {
        if (rects[i].rarity === rarity && rects[i].itemType === itemType)
            return i;
    }
    return -1;
}
/**
 * Draws the item's icon in the upper portion of the slot, leaving room for the
 * outlined name text at the bottom. Non-petal sprites are lazily decoded into
 * the caller-owned `imgCache` (a null entry means "no sprite for this type").
 */
function drawItemIcon(ctx, r, time, game, imgCache) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h * 0.4;
    const iconSize = 32;
    if (r.itemType.startsWith('petal_')) {
        const petalType = r.itemType.replace('petal_', '');
        const pc = game.getPetalCanvas?.(petalType, r.rarity, time);
        if (pc) {
            const stats = game.getPetalStats?.(petalType, r.rarity);
            (0, petal_icon_1.drawPetalGroup)(ctx, pc, stats?.count, cx, cy, iconSize);
        }
    }
    else {
        if (!imgCache.has(r.itemType)) {
            const dataUrl = game.getItemSpriteDataUrl?.(r.itemType);
            if (dataUrl) {
                const img = new Image();
                img.src = dataUrl;
                imgCache.set(r.itemType, img);
            }
            else {
                imgCache.set(r.itemType, null);
            }
        }
        const img = imgCache.get(r.itemType);
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
        }
    }
}
/**
 * Draws one full item slot: rarity-coloured rounded border and fill, hover
 * highlight, icon, outlined name, count badge, and the grey-out for items the
 * caller reports as disabled (e.g. ultra+ petals inside the maze).
 */
function drawItemSlot(ctx, r, hovered, time, game, imgCache, isItemDisabled) {
    const baseColor = petals_1.ITEM_RARITY_COLORS[r.rarity] || '#dc7e92';
    const borderColor = (0, shapes_1.darken)(baseColor, 25);
    const radius = 6;
    const borderW = 3;
    // Outer rounded border + inner fill.
    ctx.save();
    ctx.fillStyle = borderColor;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, radius);
    ctx.fill();
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.roundRect(r.x + borderW, r.y + borderW, r.w - borderW * 2, r.h - borderW * 2, Math.max(0, radius - 2));
    ctx.fill();
    if (hovered) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(r.x + borderW, r.y + borderW, r.w - borderW * 2, r.h - borderW * 2, Math.max(0, radius - 2));
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.restore();
    drawItemIcon(ctx, r, time, game, imgCache);
    // Item name — outlined white text at the bottom of the slot.
    const displayName = r.itemType.startsWith('petal_')
        ? (0, petal_display_1.formatPetalName)(r.itemType.replace('petal_', ''))
        : (0, petal_display_1.formatPetalName)(r.itemType);
    if (displayName) {
        ctx.save();
        let fontSize = 10;
        ctx.font = `bold ${fontSize}px Ubuntu, sans-serif`;
        const maxTextW = r.w - 8;
        const measured = ctx.measureText(displayName).width;
        if (measured > maxTextW) {
            fontSize = Math.max(7, (fontSize * maxTextW) / measured);
            ctx.font = `bold ${fontSize.toFixed(1)}px Ubuntu, sans-serif`;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        const tx = r.x + r.w / 2;
        const ty = r.y + r.h - 5;
        (0, text_1.drawText)(ctx, displayName, tx, ty, { font: ctx.font, fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        ctx.restore();
    }
    // Count badge: outlined white "xN" in the top-right corner of the slot.
    if (r.count > 1) {
        const text = `x${r.count}`;
        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        const tx = r.x + r.w - 4;
        const ty = r.y + 3;
        (0, text_1.drawText)(ctx, text, tx, ty, { size: 11, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        ctx.restore();
    }
    // Disabled items (e.g. ultra+ petals in the maze): grey the whole slot out
    // so it reads as unusable — interactions are blocked in the input handlers
    // via the same isItemDisabled hook.
    if (isItemDisabled && isItemDisabled(r.rarity, r.itemType)) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, radius);
        ctx.fill();
        ctx.restore();
    }
}
