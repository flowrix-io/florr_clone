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
const mobs_1 = require("../mobs");
const petals_1 = require("../petals");
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
/**
 * Reproduce the DOM tooltip's drop-table calculation so the canvas tooltip
 * can render the same outcomes. For non-common mobs, each drop expands into
 * a 90% path (mob-rarity-1) and a 10% path (drop's listed rarity), with each
 * path branching into downgrade/same/upgrade outcomes. Common mobs use the
 * drop's listed rarity directly.
 */
function computeMobDrops(mobType, mobRarity) {
    const dropTable = mobs_1.MOB_DROP_TABLES[mobType];
    if (!dropTable)
        return [];
    const rarityIndex = DROP_RARITY_ORDER.indexOf(mobRarity);
    const isCommon = mobRarity === 'common';
    const ultraMultiplier = mobRarity === 'ultra' ? 20 : 1;
    let processedDrops;
    if (!isCommon) {
        const groups = new Map();
        for (const drop of dropTable.drops) {
            const key = `${drop.type}_${drop.itemType}`;
            if (!groups.has(key))
                groups.set(key, []);
            groups.get(key).push(drop);
        }
        processedDrops = [];
        for (const group of groups.values()) {
            const c = group.find((d) => d.rarity === 'common');
            const u = group.find((d) => d.rarity === 'uncommon');
            const others = group.filter((d) => d.rarity !== 'common' && d.rarity !== 'uncommon');
            if (c && u) {
                processedDrops.push({
                    ...u,
                    probability: c.probability + u.probability,
                    minQuantity: Math.min(c.minQuantity || 1, u.minQuantity || 1),
                    maxQuantity: Math.max(c.maxQuantity || 1, u.maxQuantity || 1),
                    rarity: 'uncommon',
                });
                processedDrops.push(...others);
            }
            else {
                processedDrops.push(...group);
            }
        }
    }
    else {
        processedDrops = dropTable.drops.slice();
    }
    const out = [];
    const pushOutcomes = (baseRarity, baseProb, drop) => {
        const upgrade = Math.min(100, getDropUpgradeChance(baseRarity) * ultraMultiplier);
        const downgrade = getDropDowngradeChance(baseRarity);
        const same = Math.max(0, 100 - upgrade - downgrade);
        const mul = drop.maxQuantity && drop.maxQuantity > 1 ? drop.maxQuantity : undefined;
        if (downgrade > 0) {
            out.push({
                itemType: drop.itemType,
                type: drop.type,
                rarity: downgradeRarity(baseRarity),
                probability: baseProb * downgrade,
                multiplier: mul,
            });
        }
        if (same > 0) {
            out.push({
                itemType: drop.itemType,
                type: drop.type,
                rarity: baseRarity,
                probability: baseProb * same,
                multiplier: mul,
            });
        }
        if (upgrade > 0) {
            out.push({
                itemType: drop.itemType,
                type: drop.type,
                rarity: upgradeRarity(baseRarity),
                probability: baseProb * upgrade,
                multiplier: mul,
            });
        }
    };
    for (const drop of processedDrops) {
        if (!isCommon && rarityIndex > 0 && rarityIndex < DROP_RARITY_ORDER.length) {
            const lower = DROP_RARITY_ORDER[rarityIndex - 1];
            // 90% path: scaled to mob-rarity-1 (always shown).
            pushOutcomes(lower, drop.probability * 0.9, drop);
            // 10% path: scaled to the drop's listed rarity. Common/uncommon
            // listed drop rates are common-mob-only — drops listed at those
            // rarities don't surface for non-common mobs in the 10% branch.
            if (drop.rarity !== 'common' && drop.rarity !== 'uncommon') {
                pushOutcomes(drop.rarity, drop.probability * 0.1, drop);
            }
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
function roundedRect(ctx, x, y, w, h, r) {
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
class CanvasMobGalleryPanel {
    constructor() {
        this.kills = {};
        this.rarities = petals_1.RARITY_LEVELS.filter((r) => r !== 'apex');
        this.cellRects = [];
        this.contentHeight = 0;
        this.scrollY = 0;
        this.hoverIndex = -1;
        this.rafHandle = 0;
        this.running = false;
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
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
        // Document-level mouseup ends scroll drag when the release lands
        // outside the canvas — same pattern other canvas panels use.
        document.addEventListener('mouseup', this.handleDocumentMouseUp);
    }
    attachTo(parent) {
        parent.appendChild(this.canvas);
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        const tick = () => {
            if (!this.running)
                return;
            this.draw();
            this.rafHandle = requestAnimationFrame(tick);
        };
        this.rafHandle = requestAnimationFrame(tick);
    }
    stop() {
        this.running = false;
        if (this.rafHandle)
            cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
    }
    setKills(kills) {
        this.kills = kills || {};
    }
    /** Resize the canvas backing buffer to the parent's CSS box. */
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
        roundedRect(ctx, 0, 0, cssW, cssH, PANEL_RADIUS);
        ctx.fill();
        ctx.fillStyle = PANEL_BG;
        roundedRect(ctx, PANEL_BORDER_W, PANEL_BORDER_W, cssW - PANEL_BORDER_W * 2, cssH - PANEL_BORDER_W * 2, 0);
        ctx.fill();
        // Title — white, 24px Ubuntu, with a black outline for readability
        // against the yellow panel.
        ctx.font = 'bold 24px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000000';
        ctx.strokeText('Mob Gallery', cssW / 2, PANEL_PAD + TITLE_HEIGHT / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Mob Gallery', cssW / 2, PANEL_PAD + TITLE_HEIGHT / 2);
        // Close button (top-right). Sits inside the panel padding.
        const closeSize = 26;
        const cx = cssW - PANEL_PAD - closeSize;
        const cy = PANEL_PAD + (TITLE_HEIGHT - closeSize) / 2;
        this.closeBtnRect = { x: cx, y: cy, w: closeSize, h: closeSize };
        ctx.fillStyle = this.closeBtnHovered ? '#ff6677' : '#cc4455';
        roundedRect(ctx, cx, cy, closeSize, closeSize, 4);
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
        for (let i = 0; i < this.cellRects.length; i++) {
            const c = this.cellRects[i];
            const isHover = i === this.hoverIndex;
            // Cell background.
            if (c.killed && c.valid && c.stats) {
                const rarityColor = petals_1.ITEM_RARITY_COLORS[c.rarity] || '#fff';
                ctx.fillStyle = rarityColor;
                ctx.strokeStyle = darken(rarityColor);
                ctx.lineWidth = 3;
            }
            else {
                // Locked + invalid: a softly-darkened panel-bg tint with a
                // matching darker border. Reads as "empty" against the panel
                // without going as dark as the panel's border accent did.
                ctx.fillStyle = darken(PANEL_BG, 15);
                ctx.strokeStyle = darken(PANEL_BG, 30);
                ctx.lineWidth = 2;
            }
            roundedRect(ctx, c.x, c.y, c.w, c.h, 5);
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
                ctx.font = 'bold 8px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                const name = c.stats.name || c.mobType;
                ctx.strokeText(name, c.x + c.w / 2, c.y + c.h - 4);
                ctx.fillText(name, c.x + c.w / 2, c.y + c.h - 4);
                // Kill count badge.
                const text = c.killCount.toString();
                ctx.font = 'bold 10px Ubuntu, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                const tw = ctx.measureText(text).width;
                const bx = c.x + c.w - tw - 8;
                const by = c.y + 2;
                ctx.fillStyle = 'rgba(0,0,0,0.8)';
                roundedRect(ctx, bx, by, tw + 6, 14, 3);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillText(text, bx + 3, by + 2);
            }
            else if (c.valid) {
                // Locked.
                ctx.font = 'bold 24px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#666';
                ctx.fillText('?', c.x + c.w / 2, c.y + c.h / 2);
            }
            // Hover highlight.
            if (isHover) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                roundedRect(ctx, c.x, c.y, c.w, c.h, 5);
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
            roundedRect(ctx, trackX, trackY, SCROLLBAR_WIDTH, trackH, 4);
            ctx.fill();
            const thumbH = Math.max(20, trackH * (trackH / this.contentHeight));
            const thumbY = trackY + (this.scrollY / maxScroll) * (trackH - thumbH);
            ctx.fillStyle = '#a89d36';
            roundedRect(ctx, trackX, thumbY, SCROLLBAR_WIDTH, thumbH, 4);
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
        const lines = [];
        const titleFont = 'bold 14px Ubuntu, sans-serif';
        const bodyFont = '12px Ubuntu, sans-serif';
        const headerFont = 'bold 12px Ubuntu, sans-serif';
        const probFont = 'bold 10px Ubuntu, sans-serif';
        const colHeaderFont = 'bold 10px Ubuntu, sans-serif';
        lines.push({
            text: `${c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1)} ${stats.name || c.mobType}`,
            color: rarityColor,
            font: titleFont,
        });
        if (stats.description) {
            for (const w of wrapText(ctx, stats.description, 280, bodyFont)) {
                lines.push({ text: w, color: '#ccc', font: bodyFont });
            }
        }
        lines.push({ text: `HP: ${abbreviateNumber(stats.health)}`, color: '#4CAF50', font: bodyFont });
        lines.push({ text: `Damage: ${abbreviateNumber(stats.damage)}`, color: '#f44336', font: bodyFont });
        lines.push({ text: `Speed: ${stats.speed.toFixed(1)}`, color: '#2196F3', font: bodyFont });
        lines.push({ text: `XP: ${abbreviateNumber(stats.xp)}`, color: '#FF9800', font: bodyFont });
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
        const padX = 10;
        const padY = 8;
        const lineH = 16;
        const titleH = 20;
        const dropsHeaderH = 20;
        const colHeaderH = 16;
        const cardSize = 32;
        const cardLabelH = 14;
        const cellW = 56; // per-rarity-column slot width
        const rowH = cardSize + 4 + cardLabelH; // card + gap + probability label
        const rowGapY = 4;
        // === Tooltip width = max(text body, drops table) + padding ===
        let textW = 0;
        for (const ln of lines) {
            if (!ln.text)
                continue;
            ctx.font = ln.font;
            const w = ctx.measureText(ln.text).width;
            if (w > textW)
                textW = w;
        }
        const tableW = colRarities.length * cellW;
        const w = Math.max(textW, tableW) + padX * 2;
        // === Tooltip height = text + drops header + col header + rows ===
        let textH = padY * 2;
        for (const ln of lines)
            textH += ln.font === titleFont ? titleH : lineH;
        const dropsH = hasDrops
            ? dropsHeaderH + colHeaderH + rowKeys.length * rowH + Math.max(0, rowKeys.length - 1) * rowGapY + 4
            : 0;
        const h = textH + dropsH;
        // Position next to the cell, clamped to canvas bounds.
        let tx = c.x + c.w + 8;
        let ty = c.y - this.scrollY;
        if (tx + w > cssW - 4)
            tx = c.x - w - 8;
        if (ty + h > cssH - 4)
            ty = cssH - h - 4;
        if (ty < this.contentTop())
            ty = this.contentTop();
        // Background.
        ctx.fillStyle = 'rgba(0,0,0,0.95)';
        ctx.strokeStyle = rarityColor;
        ctx.lineWidth = 2;
        roundedRect(ctx, tx, ty, w, h, 6);
        ctx.fill();
        ctx.stroke();
        // === Render text lines ===
        let cy = ty + padY;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (const ln of lines) {
            const lh = ln.font === titleFont ? titleH : lineH;
            if (ln.text) {
                ctx.font = ln.font;
                ctx.fillStyle = ln.color;
                ctx.fillText(ln.text, tx + padX, cy);
            }
            cy += lh;
        }
        // === Render drops table ===
        if (!hasDrops)
            return;
        // 'Drops:' header (gold).
        ctx.font = headerFont;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#FFD700';
        ctx.fillText('Drops:', tx + padX, cy);
        cy += dropsHeaderH;
        // Center the table horizontally inside the tooltip.
        const tableStartX = tx + (w - tableW) / 2;
        // Column header row: rarity labels colored by rarity.
        ctx.font = colHeaderFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        for (let i = 0; i < colRarities.length; i++) {
            const r = colRarities[i];
            const col = petals_1.ITEM_RARITY_COLORS[r] || '#fff';
            const cx = tableStartX + i * cellW + cellW / 2;
            const label = r.charAt(0).toUpperCase() + r.slice(1);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#000';
            ctx.strokeText(label, cx, cy + colHeaderH / 2);
            ctx.fillStyle = col;
            ctx.fillText(label, cx, cy + colHeaderH / 2);
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
        roundedRect(ctx, cardX, cardY, cardSize, cardSize, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        roundedRect(ctx, cardX + 0.5, cardY + 0.5, cardSize - 1, cardSize - 1, 4);
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
        roundedRect(ctx, cardX, cardY, cardSize, cardSize, 4);
        ctx.fill();
        ctx.strokeStyle = darken(rarityColor);
        ctx.lineWidth = 2;
        roundedRect(ctx, cardX + 1, cardY + 1, cardSize - 2, cardSize - 2, 4);
        ctx.stroke();
        // Item icon — petal canvas for petals, image sprite for everything
        // else. Same lookup pattern the loadout bar uses.
        const iconSize = cardSize - 8;
        const iconX = cardX + (cardSize - iconSize) / 2;
        const iconY = cardY + (cardSize - iconSize) / 2;
        const assets = window.preloadedAssets;
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
            ctx.font = 'bold 9px Ubuntu, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#FFD700';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            const text = `x${d.multiplier}`;
            ctx.strokeText(text, cardX + cardSize - 2, cardY + 2);
            ctx.fillText(text, cardX + cardSize - 2, cardY + 2);
        }
        // Probability label below the card.
        const probStr = d.probability < 0.01
            ? '<0.01%'
            : d.probability.toFixed(2) + '%';
        ctx.font = probFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeText(probStr, cellX + cellW / 2, cardY + cardSize + 4);
        ctx.fillText(probStr, cellX + cellW / 2, cardY + cardSize + 4);
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
function wrapText(ctx, text, maxWidth, font) {
    const prevFont = ctx.font;
    ctx.font = font;
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
        const candidate = line ? line + ' ' + w : w;
        if (ctx.measureText(candidate).width > maxWidth && line) {
            lines.push(line);
            line = w;
        }
        else {
            line = candidate;
        }
    }
    if (line)
        lines.push(line);
    ctx.font = prevFont;
    return lines;
}
