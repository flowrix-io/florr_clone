"use strict";
/**
 * Canvas-rendered Mob Gallery panel — replaces the legacy DOM grid version.
 *
 * Mounts a single <canvas> inside the parent panel element. Renders the
 * panel chrome (title bar + close button + scrollable grid + scrollbar),
 * a grid of cells indexed by [mobType][rarity], and an on-canvas tooltip
 * shown on hover. The host (InventoryManager / TitleScreenSubmanagers)
 * keeps its existing DOM wrapper for slide-in animation and z-index.
 *
 * Tooltip drop-table calculation has been intentionally left out for now;
 * the legacy DOM tooltip computed full upgrade/downgrade chances which
 * would otherwise balloon this file. Stats + description are still shown.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanvasMobGalleryPanel = void 0;
const panel_common_1 = require("./panel-common");
const mobs_1 = require("../mobs");
const petals_1 = require("../petals");
const preloader_1 = require("../preloader");
const text_1 = require("./text");
const tooltip_1 = require("./tooltip");
const panel_common_2 = require("./panel-common");
const shapes_1 = require("./shapes");
const shapes_2 = require("./shapes");
// Rarity progression for drop-rarity calculations. Mirrors the order used
// server-side (server/itemManager.ts) and in the legacy DOM tooltip.
const DROP_RARITY_ORDER = [
    'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique',
];
function getCraftingChance(rarityIndex) {
    const baseChance = 64;
    return baseChance / Math.pow(2, rarityIndex);
}
function getDropUpgradeChance(currentRarity) {
    const currentIndex = DROP_RARITY_ORDER.indexOf(currentRarity);
    if (currentIndex === -1 || currentIndex >= DROP_RARITY_ORDER.length - 1)
        return 0;
    return getCraftingChance(currentIndex) / 3;
}
function getDropDowngradeChance(currentRarity) {
    const currentIndex = DROP_RARITY_ORDER.indexOf(currentRarity);
    if (currentIndex === -1 || currentIndex === 0)
        return 0;
    const craftingChanceToCurrentRarity = getCraftingChance(currentIndex - 1);
    return (1 / (1 + craftingChanceToCurrentRarity)) * 100;
}
function upgradeRarity(r) {
    const idx = DROP_RARITY_ORDER.indexOf(r);
    return idx >= 0 && idx < DROP_RARITY_ORDER.length - 1 ? DROP_RARITY_ORDER[idx + 1] : r;
}
function downgradeRarity(r) {
    const idx = DROP_RARITY_ORDER.indexOf(r);
    return idx > 0 && idx < DROP_RARITY_ORDER.length ? DROP_RARITY_ORDER[idx - 1] : r;
}
// Mob-rarity order including apex (items themselves never display as apex).
const MOB_RARITY_ORDER = [...DROP_RARITY_ORDER, 'apex'];
/**
 * Mirror the server drop pipeline (mob_drops.ts + server/itemManager.ts) so
 * the canvas tooltip shows real rates:
 * - Common mobs roll each table entry independently at its listed probability.
 * - Unusual (uncommon) mobs drop every table entry, guaranteed, at table rarity.
 * - Above unusual, entries are weights normalized to 100% and exactly one drop
 *   is chosen per kill; it lands one tier below the mob 90% of the time and at
 *   its table rarity the other 10%.
 * Each outcome then branches into the pickup downgrade/same/upgrade split,
 * with rare+ mobs clamped to their minimum drop rarity.
 */
function computeMobDrops(mobType, mobRarity) {
    const dropTable = mobs_1.MOB_DROP_TABLES[mobType];
    if (!dropTable || dropTable.drops.length === 0)
        return [];
    const rarityIndex = MOB_RARITY_ORDER.indexOf(mobRarity);
    const uncommonIndex = MOB_RARITY_ORDER.indexOf('uncommon');
    const ultraMultiplier = mobRarity === 'ultra' ? 20 : 1;
    // Server-side floor: rare mobs never drop below mob-1, epic+ below mob-2.
    const minRarityIndex = rarityIndex >= 3 ? rarityIndex - 2 : rarityIndex === 2 ? 1 : 0;
    const clampRarity = (r) => {
        const idx = DROP_RARITY_ORDER.indexOf(r);
        return idx >= 0 && idx < minRarityIndex ? DROP_RARITY_ORDER[minRarityIndex] : r;
    };
    const out = [];
    // baseProb is a 0-1 chance; outcome chances are percentages, so pushed
    // probabilities land on the 0-100 display scale.
    const pushOutcomes = (baseRarity, baseProb, drop) => {
        const upgrade = Math.min(100, getDropUpgradeChance(baseRarity) * ultraMultiplier);
        const downgrade = getDropDowngradeChance(baseRarity);
        const same = Math.max(0, 100 - upgrade - downgrade);
        const mul = drop.maxQuantity && drop.maxQuantity > 1 ? drop.maxQuantity : undefined;
        const push = (rarity, probability) => {
            if (probability <= 0)
                return;
            out.push({
                itemType: drop.itemType,
                type: drop.type,
                rarity: clampRarity(rarity),
                probability,
                multiplier: mul,
            });
        };
        push(downgradeRarity(baseRarity), baseProb * downgrade);
        push(baseRarity, baseProb * same);
        push(upgradeRarity(baseRarity), baseProb * upgrade);
    };
    const totalWeight = dropTable.drops.reduce((sum, d) => sum + d.probability, 0);
    for (const drop of dropTable.drops) {
        if (rarityIndex === uncommonIndex) {
            // Guaranteed full table at listed rarity.
            pushOutcomes(drop.rarity, 1, drop);
        }
        else if (rarityIndex > uncommonIndex && totalWeight > 0) {
            const share = drop.probability / totalWeight;
            const lower = DROP_RARITY_ORDER[Math.min(rarityIndex - 1, DROP_RARITY_ORDER.length - 1)];
            pushOutcomes(lower, share * 0.9, drop);
            pushOutcomes(drop.rarity, share * 0.1, drop);
        }
        else {
            pushOutcomes(drop.rarity, drop.probability, drop);
        }
    }
    return out;
}
// Layout constants chosen to mirror the legacy DOM:
//   .mob-gallery-panel { padding: 20px; border-radius: 3px; ... }
//   h2 'Mob Gallery'   { margin: 0 0 20px 0; font-size: 24px; ... }
//   .mob-gallery-grid  { display: flex; flex-direction: column; gap: 5px; }
//   .mob-gallery-row   { display: grid; grid-template-columns: repeat(N,1fr); gap: 0; }
//   .mob-gallery-cell  { height: 60px; border-radius: 5px; ... }
const PANEL_PAD = 20;
const PANEL_BG = '#e6d64c';
const PANEL_BORDER = '#a89d36';
const PANEL_BORDER_W = 4;
const PANEL_RADIUS = 3;
const TITLE_HEIGHT = 30;
const TITLE_MARGIN_BOTTOM = 20;
const CELL_HEIGHT = 60;
const ROW_GAP = 5;
const SCROLLBAR_WIDTH = 12;
function abbreviateNumber(n) {
    if (!isFinite(n))
        return '∞';
    if (n < 1000)
        return Math.round(n).toString();
    if (n < 1e6)
        return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (n < 1e9)
        return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
}
class CanvasMobGalleryPanel {
    constructor() {
        this.listenerAbort = new AbortController();
        this.kills = {};
        this.rarities = petals_1.RARITY_LEVELS.filter((r) => r !== 'apex');
        this.cellRects = [];
        this.contentHeight = 0;
        this.scrollY = 0;
        this.hoverIndex = -1;
        this.renderLoop = new panel_common_1.PanelRenderLoop(() => this.draw());
        this.imgCache = new Map();
        this.closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
        this.closeBtnHovered = false;
        this.isScrollDragging = false;
        this.dragStartY = 0;
        this.dragStartScroll = 0;
        this.onClose = null;
        this.handleDocumentMouseUp = () => {
            this.isScrollDragging = false;
        };
        this.handleMouseMove = (e) => {
            const { x, y } = this.toLocal(e);
            this.closeBtnHovered = pointInRect(x, y, this.closeBtnRect);
            const cssH = this.canvas.getBoundingClientRect().height;
            const contentY = this.contentTop();
            const contentH = cssH - contentY - PANEL_PAD;
            if (this.isScrollDragging) {
                const trackH = contentH;
                const maxScroll = Math.max(0, this.contentHeight - contentH);
                const dy = y - this.dragStartY;
                this.scrollY = Math.max(0, Math.min(maxScroll, this.dragStartScroll + dy * (maxScroll / Math.max(1, trackH))));
            }
            else {
                // Only hit-test cells inside the scrollable content.
                if (y < contentY || y > contentY + contentH) {
                    this.hoverIndex = -1;
                }
                else {
                    this.hoverIndex = this.hitTestCell(x, y);
                }
            }
        };
        this.handleMouseLeave = () => {
            this.hoverIndex = -1;
            this.closeBtnHovered = false;
            this.isScrollDragging = false;
        };
        this.handleMouseDown = (e) => {
            if (e.button !== 0)
                return;
            const { x, y } = this.toLocal(e);
            // Close button.
            if (pointInRect(x, y, this.closeBtnRect)) {
                e.preventDefault();
                if (this.onClose)
                    this.onClose();
                return;
            }
            // Scrollbar drag.
            const cssW = this.canvas.getBoundingClientRect().width;
            const cssH = this.canvas.getBoundingClientRect().height;
            const contentY = this.contentTop();
            const contentH = cssH - contentY - PANEL_PAD;
            const maxScroll = Math.max(0, this.contentHeight - contentH);
            if (maxScroll > 0) {
                const trackX = cssW - PANEL_PAD - SCROLLBAR_WIDTH;
                const trackY = contentY;
                const trackH = contentH;
                if (x >= trackX && x <= trackX + SCROLLBAR_WIDTH && y >= trackY && y <= trackY + trackH) {
                    e.preventDefault();
                    this.isScrollDragging = true;
                    this.dragStartY = y;
                    this.dragStartScroll = this.scrollY;
                    return;
                }
            }
        };
        this.handleWheel = (e) => {
            e.preventDefault();
            const cssH = this.canvas.getBoundingClientRect().height;
            const contentY = this.contentTop();
            const contentH = cssH - contentY - PANEL_PAD;
            const maxScroll = Math.max(0, this.contentHeight - contentH);
            this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY + e.deltaY));
        };
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'mob-gallery-canvas';
        this.canvas.style.cssText = `
            display: block;
            width: 100%;
            height: 100%;
            user-select: none;
        `;
        const ctx = this.canvas.getContext('2d');
        if (!ctx)
            throw new Error('CanvasMobGalleryPanel: 2d context unavailable');
        this.ctx = ctx;
        const signal = this.listenerAbort.signal;
        this.canvas.addEventListener('mousemove', this.handleMouseMove, { signal });
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave, { signal });
        this.canvas.addEventListener('mousedown', this.handleMouseDown, { signal });
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false, signal });
        // Document-level mouseup ends scroll drag when the release lands
        // outside the canvas — same pattern other canvas panels use. Bound to
        // the abort signal: this panel is rebuilt whenever the title screen is
        // re-shown, and document listeners outlive the canvas that owns them.
        document.addEventListener('mouseup', this.handleDocumentMouseUp, { signal });
    }
    /** Releases every listener registered in the constructor. */
    destroy() {
        this.stop();
        this.listenerAbort.abort();
    }
    attachTo(parent) {
        parent.appendChild(this.canvas);
    }
    start() {
        // Deferred first frame (unlike the other panels) — preserved.
        this.renderLoop.start(false);
    }
    stop() {
        this.renderLoop.stop();
    }
    setKills(kills) {
        this.kills = kills || {};
    }
    /** Resize the canvas backing buffer to the parent's CSS box. */
    syncCanvasSize() {
        return (0, panel_common_2.syncCanvasSize)(this.canvas);
    }
    /** Y at which the scrollable content area starts (just below the title). */
    contentTop() {
        return PANEL_PAD + TITLE_HEIGHT + TITLE_MARGIN_BOTTOM;
    }
    layout(cssW) {
        // Square cells (CELL_HEIGHT × CELL_HEIGHT) laid out left-to-right by
        // rarity, top-to-bottom by mob type. Centered horizontally in the
        // panel's usable width so the row sits neatly inside the chrome.
        this.cellRects = [];
        const types = (0, mobs_1.getAllMobTypes)();
        const usable = cssW - PANEL_PAD * 2 - SCROLLBAR_WIDTH - 4;
        const rowW = this.rarities.length * CELL_HEIGHT;
        const startX = PANEL_PAD + Math.max(0, (usable - rowW) / 2);
        const top = this.contentTop();
        let cursorY = top;
        for (const mobType of types) {
            const validRarities = new Set((0, mobs_1.getMobRarities)(mobType));
            for (let i = 0; i < this.rarities.length; i++) {
                const rarity = this.rarities[i];
                const x = startX + i * CELL_HEIGHT;
                const valid = validRarities.has(rarity);
                const killCount = this.kills[mobType]?.[rarity] || 0;
                this.cellRects.push({
                    x,
                    y: cursorY,
                    w: CELL_HEIGHT,
                    h: CELL_HEIGHT,
                    mobType,
                    rarity,
                    valid,
                    killed: killCount > 0,
                    killCount,
                    stats: valid ? (0, mobs_1.getMobStats)(mobType, rarity) : null,
                });
            }
            cursorY += CELL_HEIGHT + ROW_GAP;
        }
        this.contentHeight = cursorY - top;
    }
    getMobImage(stats) {
        if (!stats.image)
            return null;
        const key = stats.image;
        let img = this.imgCache.get(key);
        if (img)
            return img;
        img = new Image();
        try {
            img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(stats.image)))}`;
        }
        catch {
            return null;
        }
        this.imgCache.set(key, img);
        return img;
    }
    draw() {
        const { dpr, cssW, cssH } = this.syncCanvasSize();
        const ctx = this.ctx;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        // Panel chrome — bg + 4px border with 3px corner radius. Two-fill
        // technique to keep the outer corner radius exactly at 3 (a stroked
        // path centers the line on the path, so a 4px stroke would put the
        // outer corner at 5).
        ctx.fillStyle = PANEL_BORDER;
        (0, shapes_1.drawRoundedRect)(ctx, 0, 0, cssW, cssH, PANEL_RADIUS);
        ctx.fill();
        ctx.fillStyle = PANEL_BG;
        (0, shapes_1.drawRoundedRect)(ctx, PANEL_BORDER_W, PANEL_BORDER_W, cssW - PANEL_BORDER_W * 2, cssH - PANEL_BORDER_W * 2, 0);
        ctx.fill();
        // Title — white, 24px Ubuntu, with a black outline for readability
        // against the yellow panel.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        (0, text_1.drawText)(ctx, 'Mob Gallery', cssW / 2, PANEL_PAD + TITLE_HEIGHT / 2, { size: 24, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 4 });
        // Close button (top-right). Sits inside the panel padding.
        const closeSize = 26;
        const cx = cssW - PANEL_PAD - closeSize;
        const cy = PANEL_PAD + (TITLE_HEIGHT - closeSize) / 2;
        this.closeBtnRect = { x: cx, y: cy, w: closeSize, h: closeSize };
        ctx.fillStyle = this.closeBtnHovered ? '#ff6677' : '#cc4455';
        (0, shapes_1.drawRoundedRect)(ctx, cx, cy, closeSize, closeSize, 4);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + 7, cy + 7);
        ctx.lineTo(cx + closeSize - 7, cy + closeSize - 7);
        ctx.moveTo(cx + closeSize - 7, cy + 7);
        ctx.lineTo(cx + 7, cy + closeSize - 7);
        ctx.stroke();
        // Compute layout in CSS pixels.
        this.layout(cssW);
        // Clip the scrollable region (everything below the title).
        const contentY = this.contentTop();
        const contentH = cssH - contentY - PANEL_PAD;
        ctx.save();
        ctx.beginPath();
        ctx.rect(PANEL_PAD, contentY, cssW - PANEL_PAD * 2 - SCROLLBAR_WIDTH - 4, contentH);
        ctx.clip();
        ctx.translate(0, -this.scrollY);
        // Cells. (No rarity-header row — the legacy DOM didn't have one;
        // each cell carries its own mob name and is colored by rarity.)
        const viewTop = this.scrollY;
        const viewBottom = this.scrollY + contentH;
        for (let i = 0; i < this.cellRects.length; i++) {
            const c = this.cellRects[i];
            if (c.y + c.h <= viewTop || c.y >= viewBottom)
                continue;
            const isHover = i === this.hoverIndex;
            // Cell background.
            if (c.killed && c.valid && c.stats) {
                const rarityColor = petals_1.ITEM_RARITY_COLORS[c.rarity] || '#fff';
                ctx.fillStyle = rarityColor;
                ctx.strokeStyle = (0, shapes_2.darken)(rarityColor);
                ctx.lineWidth = 3;
            }
            else {
                // Locked + invalid: a softly-darkened panel-bg tint with a
                // matching darker border. Reads as "empty" against the panel
                // without going as dark as the panel's border accent did.
                ctx.fillStyle = (0, shapes_2.darken)(PANEL_BG, 15);
                ctx.strokeStyle = (0, shapes_2.darken)(PANEL_BG, 30);
                ctx.lineWidth = 2;
            }
            (0, shapes_1.drawRoundedRect)(ctx, c.x, c.y, c.w, c.h, 5);
            ctx.fill();
            ctx.stroke();
            // Icon / lock / blank.
            if (c.killed && c.valid && c.stats) {
                const img = this.getMobImage(c.stats);
                if (img && img.complete && img.naturalWidth > 0) {
                    const sz = 40;
                    ctx.drawImage(img, c.x + (c.w - sz) / 2, c.y + (c.h - sz) / 2 - 4, sz, sz);
                }
                // Mob name (small label at bottom of cell).
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                const name = c.stats.name || c.mobType;
                (0, text_1.drawText)(ctx, name, c.x + c.w / 2, c.y + c.h - 4, { size: 8, weight: 'bold', fill: '#fff', stroke: '#000', strokeWidth: 2 });
                // Kill count badge.
                const text = c.killCount.toString();
                ctx.font = 'bold 10px Ubuntu, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                const tw = ctx.measureText(text).width;
                const bx = c.x + c.w - tw - 8;
                const by = c.y + 2;
                ctx.fillStyle = 'rgba(0,0,0,0.8)';
                (0, shapes_1.drawRoundedRect)(ctx, bx, by, tw + 6, 14, 3);
                ctx.fill();
                (0, text_1.drawText)(ctx, text, bx + 3, by + 2, { size: 10, weight: 'bold', fill: '#fff', strokeWidth: 0 });
            }
            else if (c.valid) {
                // Locked.
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                (0, text_1.drawText)(ctx, '?', c.x + c.w / 2, c.y + c.h / 2, { size: 24, weight: 'bold', fill: '#666', strokeWidth: 0 });
            }
            // Hover highlight.
            if (isHover) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                (0, shapes_1.drawRoundedRect)(ctx, c.x, c.y, c.w, c.h, 5);
                ctx.stroke();
            }
        }
        ctx.restore(); // unclip / unscroll
        // Scrollbar (over the chrome, not the clipped content).
        const maxScroll = Math.max(0, this.contentHeight - contentH);
        if (maxScroll > 0) {
            const trackX = cssW - PANEL_PAD - SCROLLBAR_WIDTH;
            const trackY = contentY;
            const trackH = contentH;
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            (0, shapes_1.drawRoundedRect)(ctx, trackX, trackY, SCROLLBAR_WIDTH, trackH, 4);
            ctx.fill();
            const thumbH = Math.max(20, trackH * (trackH / this.contentHeight));
            const thumbY = trackY + (this.scrollY / maxScroll) * (trackH - thumbH);
            ctx.fillStyle = '#a89d36';
            (0, shapes_1.drawRoundedRect)(ctx, trackX, thumbY, SCROLLBAR_WIDTH, thumbH, 4);
            ctx.fill();
        }
        // Tooltip overlay.
        if (this.hoverIndex >= 0) {
            const c = this.cellRects[this.hoverIndex];
            if (c && c.valid && c.killed && c.stats) {
                this.drawTooltip(ctx, cssW, cssH, c);
            }
        }
        ctx.restore();
    }
    drawTooltip(ctx, cssW, cssH, c) {
        const stats = c.stats;
        const rarityColor = petals_1.ITEM_RARITY_COLORS[c.rarity] || '#fff';
        const probFont = 'bold 10px Ubuntu, sans-serif';
        // === Header text lines (gardn layout: name / rarity / spacer / body) ===
        const lines = [
            { text: stats.name || c.mobType, size: 20 },
            { text: (0, tooltip_1.capitalizeRarity)(c.rarity), size: 14, color: rarityColor },
        ];
        if (stats.description) {
            lines.push({ text: stats.description, size: 12, gapBefore: 10, maxWidth: 280 });
        }
        lines.push({ text: `HP: ${abbreviateNumber(stats.health)}`, size: 12, color: tooltip_1.TOOLTIP_STAT_COLOR, gapBefore: stats.description ? 4 : 10 }, { text: `Damage: ${abbreviateNumber(stats.damage)}`, size: 12, color: tooltip_1.TOOLTIP_STAT_COLOR }, { text: `Speed: ${stats.speed.toFixed(1)}`, size: 12, color: tooltip_1.TOOLTIP_STAT_COLOR }, { text: `XP: ${abbreviateNumber(stats.xp)}`, size: 12, color: tooltip_1.TOOLTIP_STAT_COLOR });
        // === Build drops table: rows = drop types, columns = rarities ===
        const flatDrops = computeMobDrops(c.mobType, c.rarity);
        // One row per unique (type, itemType); cells keyed by rarity.
        const rowKeys = [];
        const rowMeta = {};
        const cells = {};
        const usedRarities = new Set();
        for (const d of flatDrops) {
            const key = `${d.type}_${d.itemType}`;
            if (!(key in cells)) {
                rowKeys.push(key);
                rowMeta[key] = { type: d.type, itemType: d.itemType };
                cells[key] = {};
            }
            // Sum probabilities if multiple branches hit the same (item, rarity).
            const existing = cells[key][d.rarity];
            cells[key][d.rarity] = existing
                ? { ...existing, probability: existing.probability + d.probability }
                : d;
            usedRarities.add(d.rarity);
        }
        const colRarities = DROP_RARITY_ORDER.filter((r) => usedRarities.has(r));
        const hasDrops = rowKeys.length > 0 && colRarities.length > 0;
        // === Layout constants ===
        const dropsGapY = 6; // gap between the text block and the table
        const dropsHeaderH = 20;
        const colHeaderH = 16;
        const cardSize = 32;
        const cardLabelH = 14;
        const cellW = 56; // per-rarity-column slot width
        const rowH = cardSize + 4 + cardLabelH; // card + gap + probability label
        const rowGapY = 4;
        // === Box = shared gardn tooltip; reserve space below the text for the table ===
        const tableW = colRarities.length * cellW;
        const dropsH = hasDrops
            ? dropsGapY + dropsHeaderH + colHeaderH + rowKeys.length * rowH + Math.max(0, rowKeys.length - 1) * rowGapY
            : 0;
        const contentOpts = { minContentW: hasDrops ? tableW : 0, extraH: dropsH };
        const { w, h } = (0, tooltip_1.measureTooltip)(ctx, lines, contentOpts);
        // Position next to the cell, clamped to canvas bounds.
        let tx = c.x + c.w + 8;
        let ty = c.y - this.scrollY;
        if (tx + w > cssW - 4)
            tx = c.x - w - 8;
        if (ty + h > cssH - 4)
            ty = cssH - h - 4;
        if (ty < this.contentTop())
            ty = this.contentTop();
        const layout = (0, tooltip_1.paintTooltip)(ctx, tx, ty, lines, contentOpts);
        // === Render drops table ===
        if (!hasDrops)
            return;
        let cy = layout.textBottom + dropsGapY;
        // 'Drops:' header (gold).
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        (0, text_1.drawText)(ctx, 'Drops:', layout.contentX, cy, { size: 12, weight: 'bold', fill: '#FFD700' });
        cy += dropsHeaderH;
        // Center the table horizontally inside the tooltip.
        const tableStartX = tx + (w - tableW) / 2;
        // Column header row: rarity labels colored by rarity.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        for (let i = 0; i < colRarities.length; i++) {
            const r = colRarities[i];
            const col = petals_1.ITEM_RARITY_COLORS[r] || '#fff';
            const cx = tableStartX + i * cellW + cellW / 2;
            (0, text_1.drawText)(ctx, (0, tooltip_1.capitalizeRarity)(r), cx, cy + colHeaderH / 2, {
                size: 10, weight: 'bold', fill: col, strokeWidth: 2,
            });
        }
        cy += colHeaderH;
        // One row per drop type, one cell per rarity column. Cells without
        // a matching outcome render as a muted placeholder.
        for (let r = 0; r < rowKeys.length; r++) {
            const key = rowKeys[r];
            const meta = rowMeta[key];
            const rowCells = cells[key];
            const rowY = cy + r * (rowH + rowGapY);
            for (let i = 0; i < colRarities.length; i++) {
                const rarity = colRarities[i];
                const cellX = tableStartX + i * cellW;
                const entry = rowCells[rarity];
                if (entry) {
                    this.drawDropCard(ctx, cellX, rowY, cellW, cardSize, entry, probFont);
                }
                else {
                    this.drawEmptyDropCell(ctx, cellX, rowY, cellW, cardSize, meta.type, meta.itemType);
                }
            }
        }
    }
    /** Muted placeholder for a (drop type, rarity) pair that has no
     *  outcome — keeps each row width consistent with the column count. */
    drawEmptyDropCell(ctx, cellX, cellY, cellW, cardSize, _type, _itemType) {
        const cardX = cellX + (cellW - cardSize) / 2;
        const cardY = cellY;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        (0, shapes_1.drawRoundedRect)(ctx, cardX, cardY, cardSize, cardSize, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        (0, shapes_1.drawRoundedRect)(ctx, cardX + 0.5, cardY + 0.5, cardSize - 1, cardSize - 1, 4);
        ctx.stroke();
    }
    /** Paint one drop card: rarity-colored rounded square w/ darker border,
     *  item icon centered inside, probability text below. */
    drawDropCard(ctx, cellX, cellY, cellW, cardSize, d, probFont) {
        const rarityColor = petals_1.ITEM_RARITY_COLORS[d.rarity] || '#fff';
        const cardX = cellX + (cellW - cardSize) / 2;
        const cardY = cellY;
        // Card background + darker border.
        ctx.fillStyle = rarityColor;
        (0, shapes_1.drawRoundedRect)(ctx, cardX, cardY, cardSize, cardSize, 4);
        ctx.fill();
        ctx.strokeStyle = (0, shapes_2.darken)(rarityColor);
        ctx.lineWidth = 2;
        (0, shapes_1.drawRoundedRect)(ctx, cardX + 1, cardY + 1, cardSize - 2, cardSize - 2, 4);
        ctx.stroke();
        // Item icon — petal canvas for petals, image sprite for everything
        // else. Same lookup pattern the loadout bar uses.
        const iconSize = cardSize - 8;
        const iconX = cardX + (cardSize - iconSize) / 2;
        const iconY = cardY + (cardSize - iconSize) / 2;
        const assets = (0, preloader_1.getPreloadedAssets)();
        if (d.type === 'petal' && assets?.petalImages) {
            const entry = assets.petalImages[`${d.itemType}_${d.rarity}`];
            const petalCanvas = Array.isArray(entry)
                ? entry[Math.floor(Date.now() / 42) % entry.length]
                : entry;
            if (petalCanvas) {
                ctx.drawImage(petalCanvas, iconX, iconY, iconSize, iconSize);
            }
        }
        else if (assets?.itemSprites) {
            const sprite = assets.itemSprites[d.itemType];
            if (sprite && sprite.complete && sprite.naturalWidth > 0) {
                ctx.drawImage(sprite, iconX, iconY, iconSize, iconSize);
            }
        }
        // Multiplier badge in the top-right corner if quantity > 1.
        if (d.multiplier && d.multiplier > 1) {
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            const text = `x${d.multiplier}`;
            (0, text_1.drawText)(ctx, text, cardX + cardSize - 2, cardY + 2, { size: 9, weight: 'bold', fill: '#FFD700', stroke: '#000', strokeWidth: 2 });
        }
        // Probability label below the card. Aggregated branches can push the
        // expected count past 1 (e.g. duplicate table entries all guaranteed
        // at unusual tier) — cap the display at 100%.
        const probStr = d.probability < 0.01
            ? '<0.01%'
            : Math.min(100, d.probability).toFixed(2) + '%';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        (0, text_1.drawText)(ctx, probStr, cellX + cellW / 2, cardY + cardSize + 4, { font: probFont, fill: '#fff', stroke: '#000', strokeWidth: 2 });
    }
    // ===== input =====
    toLocal(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    hitTestCell(localX, localY) {
        // cellRects are stored in absolute canvas-local CSS pixel coords, but
        // draw() translates by -scrollY before painting them, so on-screen
        // they appear at r.y - scrollY. Convert mouse Y into the same
        // un-scrolled space before comparing.
        const yInGrid = localY + this.scrollY;
        for (let i = 0; i < this.cellRects.length; i++) {
            const r = this.cellRects[i];
            if (localX >= r.x && localX <= r.x + r.w && yInGrid >= r.y && yInGrid <= r.y + r.h) {
                return i;
            }
        }
        return -1;
    }
}
exports.CanvasMobGalleryPanel = CanvasMobGalleryPanel;
function pointInRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
