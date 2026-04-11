"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanvasInventoryPanel = void 0;
// Canvas-based inventory panel — replaces the prior DOM grid implementation.
// Renders rarity-grouped item slots into a single <canvas> and exposes hit
// testing / hover callbacks so InventoryManager can drive drag/drop & tooltips.
const inventoryCodec_1 = require("../inventoryCodec");
const ITEM_RARITY_COLORS = {
    common: '#7eef6d',
    uncommon: '#ffe65d',
    rare: '#4d52e3',
    epic: '#861fde',
    legendary: '#de1f1f',
    mythic: '#1fdbde',
    ultra: '#de1f65',
    super: '#2bffa4',
    unique: '#bf00ff'
};
const RARITY_ORDER = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
function darken(hex, percent = 30) {
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
function formatPetalName(petalType) {
    if (!petalType)
        return '';
    const name = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
    return name.replace(/_/g, ' ');
}
class CanvasInventoryPanel {
    constructor(game) {
        this.itemRects = [];
        this.contentHeight = 0;
        this.scrollY = 0;
        this.hoverIndex = -1;
        this.rafHandle = 0;
        this.running = false;
        this.imgCache = new Map();
        /** Callback fired when the user presses the left mouse button on an item. */
        this.onItemMouseDown = null;
        /** Callback fired when the hovered item changes (null when no item is hovered). */
        this.onItemHoverChange = null;
        // ===== input handlers =====
        this.handleMouseMove = (e) => {
            const hit = this.hitTestClient(e.clientX, e.clientY);
            const newIdx = hit ? this.findItemIndex(hit.rarity, hit.itemType) : -1;
            if (newIdx !== this.hoverIndex) {
                this.hoverIndex = newIdx;
                if (this.onItemHoverChange)
                    this.onItemHoverChange(hit);
            }
        };
        this.handleMouseLeave = () => {
            if (this.hoverIndex !== -1) {
                this.hoverIndex = -1;
                if (this.onItemHoverChange)
                    this.onItemHoverChange(null);
            }
        };
        this.handleMouseDown = (e) => {
            if (e.button !== 0)
                return;
            const hit = this.hitTestClient(e.clientX, e.clientY);
            if (hit && this.onItemMouseDown) {
                e.preventDefault();
                this.onItemMouseDown(hit.rarity, hit.itemType, e, hit);
            }
        };
        this.handleWheel = (e) => {
            e.preventDefault();
            this.scrollY += e.deltaY;
            const rect = this.canvas.getBoundingClientRect();
            const visibleH = Math.max(0, rect.height - CanvasInventoryPanel.CONTENT_TOP);
            const maxScroll = Math.max(0, this.contentHeight - visibleH);
            if (this.scrollY < 0)
                this.scrollY = 0;
            if (this.scrollY > maxScroll)
                this.scrollY = maxScroll;
        };
        this.game = game;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'inventory-canvas';
        this.canvas.style.cssText = `
            display: block;
            width: 100%;
            height: 100%;
            user-select: none;
        `;
        const ctx = this.canvas.getContext('2d');
        if (!ctx)
            throw new Error('CanvasInventoryPanel: failed to acquire 2d context');
        this.ctx = ctx;
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    }
    attachTo(parent) {
        parent.appendChild(this.canvas);
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        const loop = () => {
            if (!this.running)
                return;
            this.draw();
            this.rafHandle = requestAnimationFrame(loop);
        };
        loop();
    }
    stop() {
        this.running = false;
        if (this.rafHandle)
            cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
        this.hoverIndex = -1;
    }
    isRunning() {
        return this.running;
    }
    /** Returns true if the given client coordinates are within the canvas bounds. */
    containsClient(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }
    /** Hit-test client coordinates against the laid-out items. */
    hitTestClient(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return null;
        }
        // Reject hits in the title bar area above the scrollable content.
        if (clientY - rect.top < CanvasInventoryPanel.CONTENT_TOP)
            return null;
        // Convert to layout (CSS-pixel) space, inverting draw()'s translate.
        const x = clientX - rect.left;
        const y = (clientY - rect.top) - CanvasInventoryPanel.CONTENT_TOP + this.scrollY;
        for (const r of this.itemRects) {
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                const screenX = rect.left + r.x;
                const screenY = rect.top + r.y + CanvasInventoryPanel.CONTENT_TOP - this.scrollY;
                return {
                    rarity: r.rarity,
                    itemType: r.itemType,
                    rect: {
                        left: screenX,
                        top: screenY,
                        right: screenX + r.w,
                        bottom: screenY + r.h,
                        width: r.w,
                        height: r.h
                    }
                };
            }
        }
        return null;
    }
    syncCanvasSize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        return { dpr, cssW: rect.width, cssH: rect.height };
    }
    layout(cssW, cssH) {
        const player = this.game.getLocalPlayer();
        if (!player || !Array.isArray(player.inventory)) {
            this.itemRects = [];
            this.contentHeight = 0;
            return;
        }
        const invDict = (0, inventoryCodec_1.inventoryToDict)(player.inventory);
        const padding = 10;
        const sectionGap = 10;
        const labelHeight = 16;
        const itemSize = 50;
        const itemGap = 6;
        const innerWidth = Math.max(itemSize, cssW - padding * 2);
        const cols = Math.max(1, Math.floor((innerWidth + itemGap) / (itemSize + itemGap)));
        this.itemRects = [];
        let y = padding;
        for (const rarity of RARITY_ORDER) {
            const items = invDict[rarity];
            if (!items)
                continue;
            const entries = Object.entries(items).filter(([, c]) => c > 0);
            if (entries.length === 0)
                continue;
            // Reserve space for the rarity label drawn above the row.
            y += labelHeight + 2;
            const totalRows = Math.ceil(entries.length / cols);
            const lastRowItemCount = entries.length - (totalRows - 1) * cols;
            // Full rows are centered using all `cols` slots; the partial last
            // row is centered against just its own item count so it sits in the
            // middle of the panel rather than left-aligned.
            const fullRowWidth = cols * itemSize + (cols - 1) * itemGap;
            const fullRowStartX = padding + (innerWidth - fullRowWidth) / 2;
            const lastRowWidth = lastRowItemCount * itemSize + (lastRowItemCount - 1) * itemGap;
            const lastRowStartX = padding + (innerWidth - lastRowWidth) / 2;
            for (let i = 0; i < entries.length; i++) {
                const [itemType, count] = entries[i];
                const row = Math.floor(i / cols);
                const col = i % cols;
                const isLastRow = row === totalRows - 1;
                const startX = isLastRow ? lastRowStartX : fullRowStartX;
                const x = startX + col * (itemSize + itemGap);
                const yPos = y + row * (itemSize + itemGap);
                this.itemRects.push({
                    x,
                    y: yPos,
                    w: itemSize,
                    h: itemSize,
                    rarity,
                    itemType,
                    count: count
                });
            }
            y += totalRows * itemSize + (totalRows - 1) * itemGap;
            y += sectionGap;
        }
        this.contentHeight = y + padding;
        const visibleH = Math.max(0, cssH - CanvasInventoryPanel.CONTENT_TOP); // 30px reserved for title at top
        const maxScroll = Math.max(0, this.contentHeight - visibleH);
        if (this.scrollY > maxScroll)
            this.scrollY = maxScroll;
        if (this.scrollY < 0)
            this.scrollY = 0;
    }
    draw() {
        const { dpr, cssW, cssH } = this.syncCanvasSize();
        this.layout(cssW, cssH);
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, cssW, cssH);
        // Title bar
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Inventory', cssW / 2, 4);
        // Scrollable content area
        const contentTop = CanvasInventoryPanel.CONTENT_TOP;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, contentTop, cssW, cssH - contentTop);
        ctx.clip();
        ctx.translate(0, contentTop - this.scrollY);
        // Rarity labels — draw centered above the first rect of each rarity
        // group, flanked by rounded separator lines colored like the panel border.
        const seenRarity = new Set();
        for (const r of this.itemRects) {
            if (!seenRarity.has(r.rarity)) {
                seenRarity.add(r.rarity);
                const color = ITEM_RARITY_COLORS[r.rarity] || '#fff';
                const labelText = r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1).toLowerCase();
                const labelY = r.y - 3;
                ctx.font = 'bold 13px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                // Draw the label first so we know its measured width.
                ctx.lineWidth = 3;
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.strokeText(labelText, cssW / 2, labelY);
                ctx.fillStyle = color;
                ctx.fillText(labelText, cssW / 2, labelY);
                // Rounded separator lines on each side, matching the panel border.
                const textW = ctx.measureText(labelText).width;
                const gap = 8;
                const sidePad = 4;
                const lineY = labelY - 5; // visually align with text middle
                const leftEnd = cssW / 2 - textW / 2 - gap;
                const leftStart = sidePad;
                const rightStart = cssW / 2 + textW / 2 + gap;
                const rightEnd = cssW - sidePad;
                if (leftEnd > leftStart) {
                    ctx.save();
                    ctx.strokeStyle = CanvasInventoryPanel.SEPARATOR_COLOR;
                    ctx.lineWidth = 2;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(leftStart, lineY);
                    ctx.lineTo(leftEnd, lineY);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(rightStart, lineY);
                    ctx.lineTo(rightEnd, lineY);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }
        const now = performance.now();
        for (let i = 0; i < this.itemRects.length; i++) {
            const r = this.itemRects[i];
            const color = ITEM_RARITY_COLORS[r.rarity] || '#666';
            const dark = darken(color, 30);
            // Outer darker rounded rect + inner sharp fill (matches loadout-bar styling)
            ctx.fillStyle = dark;
            ctx.beginPath();
            ctx.roundRect(r.x, r.y, r.w, r.h, 5);
            ctx.fill();
            ctx.fillStyle = color;
            ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
            if (i === this.hoverIndex) {
                ctx.save();
                ctx.globalAlpha = 0.18;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
                ctx.restore();
            }
            this.drawItemIcon(ctx, r, now);
            // Count badge (top-right)
            const cs = String(r.count);
            ctx.font = 'bold 11px Ubuntu, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#000000';
            ctx.strokeText(cs, r.x + r.w - 3, r.y + 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(cs, r.x + r.w - 3, r.y + 2);
            // Petal name label (bottom)
            if (r.itemType.startsWith('petal_')) {
                const name = formatPetalName(r.itemType.replace('petal_', ''));
                ctx.font = 'bold 9px Ubuntu, sans-serif';
                const measured = ctx.measureText(name).width;
                if (measured > r.w - 6) {
                    const fs = Math.max(6, (9 * (r.w - 6)) / measured);
                    ctx.font = `bold ${fs.toFixed(1)}px Ubuntu, sans-serif`;
                }
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#000000';
                ctx.strokeText(name, r.x + r.w / 2, r.y + r.h - 2);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(name, r.x + r.w / 2, r.y + r.h - 2);
            }
        }
        ctx.restore(); // unclip & untranslate
        // Scrollbar indicator
        const visibleH = cssH - contentTop;
        if (this.contentHeight > visibleH) {
            const trackTop = contentTop;
            const trackH = visibleH;
            const thumbH = Math.max(20, (trackH * visibleH) / this.contentHeight);
            const thumbY = trackTop + (this.scrollY / (this.contentHeight - visibleH)) * (trackH - thumbH);
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(cssW - 6, thumbY, 4, thumbH);
        }
        ctx.restore();
    }
    drawItemIcon(ctx, r, time) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const iconSize = 30;
        if (r.itemType.startsWith('petal_')) {
            const petalType = r.itemType.replace('petal_', '');
            const pc = this.game.getPetalCanvas?.(petalType, r.rarity, time);
            if (pc) {
                ctx.drawImage(pc, cx - iconSize / 2, cy - iconSize / 2 - 4, iconSize, iconSize);
            }
        }
        else {
            const dataUrl = this.game.getItemSpriteDataUrl?.(r.itemType);
            if (dataUrl) {
                let img = this.imgCache.get(r.itemType);
                if (!img) {
                    img = new Image();
                    img.src = dataUrl;
                    this.imgCache.set(r.itemType, img);
                }
                if (img.complete && img.naturalWidth > 0) {
                    ctx.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
                }
            }
        }
    }
    findItemIndex(rarity, itemType) {
        for (let i = 0; i < this.itemRects.length; i++) {
            if (this.itemRects[i].rarity === rarity && this.itemRects[i].itemType === itemType)
                return i;
        }
        return -1;
    }
}
exports.CanvasInventoryPanel = CanvasInventoryPanel;
/** Vertical pixel offset reserved at the top of the canvas for the title bar.
 *  draw() translates the scrollable content area down by this amount, so the
 *  hit test must apply the inverse offset to convert client coords back into
 *  layout space. */
CanvasInventoryPanel.CONTENT_TOP = 30;
/** Color of the rounded separator lines flanking each rarity label.
 *  Matches the .inventory-panel CSS border color. */
CanvasInventoryPanel.SEPARATOR_COLOR = '#4a8bc2';
