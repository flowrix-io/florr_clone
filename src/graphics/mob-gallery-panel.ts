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

import { getAllMobTypes, getMobStats, getMobRarities, MobStats } from '../mobs';
import { ITEM_RARITY_COLORS, RARITY_LEVELS } from '../petals';

export type MobKills = Record<string, Record<string, number>>;

interface CellRect {
    x: number; y: number; w: number; h: number;
    mobType: string;
    rarity: string;
    /** True if the mob exists at this rarity (kill count regardless). */
    valid: boolean;
    /** True if the player has killed at least one. */
    killed: boolean;
    killCount: number;
    stats: MobStats | null;
}

const PANEL_PAD = 16;
const TITLE_HEIGHT = 32;
const HEADER_HEIGHT = 26;     // first row: rarity column headers
const CELL_HEIGHT = 60;
const ROW_GAP = 5;
const SCROLLBAR_WIDTH = 12;

function darken(hex: string, percent: number = 30): string {
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

function abbreviateNumber(n: number): string {
    if (!isFinite(n)) return '∞';
    if (n < 1000) return Math.round(n).toString();
    if (n < 1e6) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (n < 1e9) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

export class CanvasMobGalleryPanel {
    public canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private parentEl: HTMLElement | null = null;

    private kills: MobKills = {};
    private rarities: string[] = RARITY_LEVELS.filter((r) => r !== 'apex');
    private cellRects: CellRect[] = [];
    private contentHeight: number = 0;
    private scrollY: number = 0;
    private hoverIndex: number = -1;
    private rafHandle: number = 0;
    private running: boolean = false;
    private imgCache: Map<string, HTMLImageElement> = new Map();
    private closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    private closeBtnHovered: boolean = false;
    private isScrollDragging: boolean = false;
    private dragStartY: number = 0;
    private dragStartScroll: number = 0;

    public onClose: (() => void) | null = null;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'mob-gallery-canvas';
        this.canvas.style.cssText = `
            display: block;
            width: 100%;
            height: 100%;
            user-select: none;
        `;
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('CanvasMobGalleryPanel: 2d context unavailable');
        this.ctx = ctx;

        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
        // Document-level mouseup ends scroll drag when the release lands
        // outside the canvas — same pattern other canvas panels use.
        document.addEventListener('mouseup', this.handleDocumentMouseUp);
    }

    private handleDocumentMouseUp = () => {
        this.isScrollDragging = false;
    };

    public attachTo(parent: HTMLElement) {
        this.parentEl = parent;
        parent.appendChild(this.canvas);
    }

    public start() {
        if (this.running) return;
        this.running = true;
        const tick = () => {
            if (!this.running) return;
            this.draw();
            this.rafHandle = requestAnimationFrame(tick);
        };
        this.rafHandle = requestAnimationFrame(tick);
    }

    public stop() {
        this.running = false;
        if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
    }

    public setKills(kills: MobKills | undefined) {
        this.kills = kills || {};
    }

    /** Resize the canvas backing buffer to the parent's CSS box. */
    private syncCanvasSize(): { dpr: number; cssW: number; cssH: number } {
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

    private layout(cssW: number) {
        // Mirror the legacy DOM grid layout: each row is a mob type, columns
        // are rarities (sans apex), and each cell stretches to fill the row
        // width evenly. Mob name is rendered inside the cell (bottom).
        this.cellRects = [];
        const types = getAllMobTypes();
        const usable = cssW - PANEL_PAD * 2 - SCROLLBAR_WIDTH - 4;
        const cellW = Math.floor(usable / this.rarities.length);
        const startX = PANEL_PAD;
        let cursorY = TITLE_HEIGHT + HEADER_HEIGHT + PANEL_PAD;

        for (const mobType of types) {
            const validRarities = new Set(getMobRarities(mobType));
            for (let i = 0; i < this.rarities.length; i++) {
                const rarity = this.rarities[i];
                const x = startX + i * cellW;
                const valid = validRarities.has(rarity);
                const killCount = this.kills[mobType]?.[rarity] || 0;
                this.cellRects.push({
                    x,
                    y: cursorY,
                    w: cellW,
                    h: CELL_HEIGHT,
                    mobType,
                    rarity,
                    valid,
                    killed: killCount > 0,
                    killCount,
                    stats: valid ? getMobStats(mobType, rarity) : null,
                });
            }
            cursorY += CELL_HEIGHT + ROW_GAP;
        }
        this.contentHeight = cursorY - (TITLE_HEIGHT + HEADER_HEIGHT + PANEL_PAD);
    }

    private getMobImage(stats: MobStats): HTMLImageElement | null {
        if (!stats.image) return null;
        const key = stats.image;
        let img = this.imgCache.get(key);
        if (img) return img;
        img = new Image();
        try {
            img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(stats.image)))}`;
        } catch {
            return null;
        }
        this.imgCache.set(key, img);
        return img;
    }

    private draw() {
        const { dpr, cssW, cssH } = this.syncCanvasSize();
        const ctx = this.ctx;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Clear backing buffer.
        ctx.clearRect(0, 0, cssW, cssH);

        // Panel chrome.
        ctx.fillStyle = '#e6d64c';
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.strokeStyle = '#a89d36';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, cssW - 4, cssH - 4);

        // Title.
        ctx.font = 'bold 22px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText('Mob Gallery', cssW / 2, TITLE_HEIGHT / 2 + PANEL_PAD / 2);
        ctx.fillText('Mob Gallery', cssW / 2, TITLE_HEIGHT / 2 + PANEL_PAD / 2);

        // Close button (top-right).
        const closeSize = 26;
        const cx = cssW - closeSize - PANEL_PAD / 2;
        const cy = PANEL_PAD / 2;
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

        // Clip the scrollable region.
        const contentY = TITLE_HEIGHT + PANEL_PAD;
        const contentH = cssH - contentY - PANEL_PAD;
        ctx.save();
        ctx.beginPath();
        ctx.rect(PANEL_PAD, contentY, cssW - PANEL_PAD * 2 - SCROLLBAR_WIDTH - 4, contentH);
        ctx.clip();
        ctx.translate(0, -this.scrollY);

        // Rarity column headers.
        const usable = cssW - PANEL_PAD * 2 - SCROLLBAR_WIDTH - 4;
        const cellW = Math.floor(usable / this.rarities.length);
        const startX = PANEL_PAD;
        ctx.font = 'bold 13px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 2;
        for (let i = 0; i < this.rarities.length; i++) {
            const rarity = this.rarities[i];
            const x = startX + i * cellW;
            const headerY = contentY + HEADER_HEIGHT / 2;
            ctx.fillStyle = ITEM_RARITY_COLORS[rarity] || '#fff';
            ctx.strokeStyle = '#000';
            const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
            ctx.strokeText(label, x + cellW / 2, headerY);
            ctx.fillText(label, x + cellW / 2, headerY);
        }

        // Cells.
        for (let i = 0; i < this.cellRects.length; i++) {
            const c = this.cellRects[i];
            const isHover = i === this.hoverIndex;
            // Cell background.
            if (c.killed && c.valid && c.stats) {
                const rarityColor = ITEM_RARITY_COLORS[c.rarity] || '#fff';
                ctx.fillStyle = rarityColor;
                ctx.strokeStyle = darken(rarityColor);
                ctx.lineWidth = 3;
            } else if (c.valid) {
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
            } else {
                ctx.fillStyle = 'rgba(0,0,0,0.1)';
                ctx.strokeStyle = '#222';
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
            } else if (c.valid) {
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
        const maxScroll = Math.max(0, this.contentHeight - (contentH - HEADER_HEIGHT));
        if (maxScroll > 0) {
            const trackX = cssW - PANEL_PAD - SCROLLBAR_WIDTH;
            const trackY = contentY + HEADER_HEIGHT;
            const trackH = contentH - HEADER_HEIGHT;
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            roundedRect(ctx, trackX, trackY, SCROLLBAR_WIDTH, trackH, 4);
            ctx.fill();
            const thumbH = Math.max(20, trackH * (trackH / (this.contentHeight + HEADER_HEIGHT)));
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

    private drawTooltip(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, c: CellRect) {
        const stats = c.stats!;
        const rarityColor = ITEM_RARITY_COLORS[c.rarity] || '#fff';
        const lines: { text: string; color: string; bold?: boolean }[] = [];
        const titleText = `${c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1)} ${stats.name || c.mobType}`;
        lines.push({ text: titleText, color: rarityColor, bold: true });
        if (stats.description) {
            for (const w of wrapText(ctx, stats.description, 280, '12px Ubuntu, sans-serif')) {
                lines.push({ text: w, color: '#ccc' });
            }
        }
        lines.push({ text: `HP: ${abbreviateNumber(stats.health)}`, color: '#4CAF50' });
        lines.push({ text: `Damage: ${abbreviateNumber(stats.damage)}`, color: '#f44336' });
        lines.push({ text: `Speed: ${stats.speed.toFixed(1)}`, color: '#2196F3' });
        lines.push({ text: `XP: ${abbreviateNumber(stats.xp)}`, color: '#FF9800' });

        const padX = 10;
        const padY = 8;
        const lineH = 18;
        const titleH = 22;
        let maxW = 0;
        ctx.font = 'bold 14px Ubuntu, sans-serif';
        maxW = Math.max(maxW, ctx.measureText(lines[0].text).width);
        ctx.font = '12px Ubuntu, sans-serif';
        for (let i = 1; i < lines.length; i++) {
            maxW = Math.max(maxW, ctx.measureText(lines[i].text).width);
        }
        const w = maxW + padX * 2;
        const h = padY * 2 + titleH + (lines.length - 1) * lineH;

        // Position next to the cell, clamped to canvas bounds.
        let tx = c.x + c.w + 8 - this.scrollY * 0; // tooltip is in screen space
        let ty = c.y - this.scrollY;               // adjust for scroll
        if (tx + w > cssW - 4) tx = c.x - w - 8;
        if (ty + h > cssH - 4) ty = cssH - h - 4;
        if (ty < TITLE_HEIGHT + PANEL_PAD) ty = TITLE_HEIGHT + PANEL_PAD;

        ctx.fillStyle = 'rgba(0,0,0,0.95)';
        ctx.strokeStyle = rarityColor;
        ctx.lineWidth = 2;
        roundedRect(ctx, tx, ty, w, h, 6);
        ctx.fill();
        ctx.stroke();

        let cy = ty + padY;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 14px Ubuntu, sans-serif';
        ctx.fillStyle = lines[0].color;
        ctx.fillText(lines[0].text, tx + padX, cy);
        cy += titleH;
        ctx.font = '12px Ubuntu, sans-serif';
        for (let i = 1; i < lines.length; i++) {
            ctx.fillStyle = lines[i].color;
            ctx.fillText(lines[i].text, tx + padX, cy);
            cy += lineH;
        }
    }

    // ===== input =====
    private toLocal(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private hitTestCell(localX: number, localY: number): number {
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

    private handleMouseMove = (e: MouseEvent) => {
        const { x, y } = this.toLocal(e);
        this.closeBtnHovered = pointInRect(x, y, this.closeBtnRect);
        if (this.isScrollDragging) {
            const cssH = this.canvas.getBoundingClientRect().height;
            const contentH = cssH - (TITLE_HEIGHT + PANEL_PAD) - PANEL_PAD;
            const trackH = contentH - HEADER_HEIGHT;
            const maxScroll = Math.max(0, this.contentHeight - (contentH - HEADER_HEIGHT));
            const dy = y - this.dragStartY;
            this.scrollY = Math.max(0, Math.min(maxScroll, this.dragStartScroll + dy * (maxScroll / Math.max(1, trackH))));
        } else {
            // Only hit-test cells inside the scrollable content.
            const contentY = TITLE_HEIGHT + PANEL_PAD;
            const cssH = this.canvas.getBoundingClientRect().height;
            const contentH = cssH - contentY - PANEL_PAD;
            if (y < contentY || y > contentY + contentH) {
                this.hoverIndex = -1;
            } else {
                this.hoverIndex = this.hitTestCell(x, y);
            }
        }
    };

    private handleMouseLeave = () => {
        this.hoverIndex = -1;
        this.closeBtnHovered = false;
        this.isScrollDragging = false;
    };

    private handleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const { x, y } = this.toLocal(e);
        // Close button.
        if (pointInRect(x, y, this.closeBtnRect)) {
            e.preventDefault();
            if (this.onClose) this.onClose();
            return;
        }
        // Scrollbar drag.
        const cssW = this.canvas.getBoundingClientRect().width;
        const cssH = this.canvas.getBoundingClientRect().height;
        const contentY = TITLE_HEIGHT + PANEL_PAD;
        const contentH = cssH - contentY - PANEL_PAD;
        const maxScroll = Math.max(0, this.contentHeight - (contentH - HEADER_HEIGHT));
        if (maxScroll > 0) {
            const trackX = cssW - PANEL_PAD - SCROLLBAR_WIDTH;
            const trackY = contentY + HEADER_HEIGHT;
            const trackH = contentH - HEADER_HEIGHT;
            if (x >= trackX && x <= trackX + SCROLLBAR_WIDTH && y >= trackY && y <= trackY + trackH) {
                e.preventDefault();
                this.isScrollDragging = true;
                this.dragStartY = y;
                this.dragStartScroll = this.scrollY;
                return;
            }
        }
    };

    private handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const cssH = this.canvas.getBoundingClientRect().height;
        const contentY = TITLE_HEIGHT + PANEL_PAD;
        const contentH = cssH - contentY - PANEL_PAD;
        const maxScroll = Math.max(0, this.contentHeight - (contentH - HEADER_HEIGHT));
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY + e.deltaY));
    };
}

function pointInRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
    const prevFont = ctx.font;
    ctx.font = font;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
        const candidate = line ? line + ' ' + w : w;
        if (ctx.measureText(candidate).width > maxWidth && line) {
            lines.push(line);
            line = w;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);
    ctx.font = prevFont;
    return lines;
}

