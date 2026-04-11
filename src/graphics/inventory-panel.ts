// Canvas-based inventory panel — replaces the prior DOM grid implementation.
// Renders rarity-grouped item slots into a single <canvas> and exposes hit
// testing / hover callbacks so InventoryManager can drive drag/drop & tooltips.
import { inventoryToDict } from '../inventoryCodec';

interface ItemRect {
    x: number;
    y: number;
    w: number;
    h: number;
    rarity: string;
    itemType: string;
    count: number;
}

interface GameAPI {
    getLocalPlayer(): any;
    getPetalCanvas?(petalType: string, rarity: string, time?: number): HTMLCanvasElement | null;
    getItemSpriteDataUrl?(itemType: string): string | null;
}

const ITEM_RARITY_COLORS: Record<string, string> = {
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

function formatPetalName(petalType: string): string {
    if (!petalType) return '';
    const name = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
    return name.replace(/_/g, ' ');
}

export interface InventoryHitInfo {
    rarity: string;
    itemType: string;
    /** Client-space rect of the hovered item, suitable for tooltip positioning. */
    rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
}

export class CanvasInventoryPanel {
    private game: GameAPI;
    public canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    private itemRects: ItemRect[] = [];
    private contentHeight: number = 0;
    private scrollY: number = 0;
    private hoverIndex: number = -1;

    private rafHandle: number = 0;
    private running: boolean = false;
    private imgCache: Map<string, HTMLImageElement> = new Map();

    /** When true, items of the same rarity+type are stacked into one slot
     *  with an `xN` count badge. When false, each item gets its own slot. */
    private stackMode: boolean = true;
    /** Substring filter (lowercased) applied to formatted petal/item names. */
    private searchFilter: string = '';

    /** Title bar is now drawn by the surrounding DOM, so the canvas content
     *  starts at y=0. */
    private static readonly CONTENT_TOP = 0;

    /** Color of the rounded separator lines flanking each rarity label.
     *  Matches the .inventory-panel CSS border color. */
    private static readonly SEPARATOR_COLOR = '#4a8bc2';

    /** Callback fired when the user presses the left mouse button on an item. */
    public onItemMouseDown: ((rarity: string, itemType: string, e: MouseEvent, hit: InventoryHitInfo) => void) | null = null;
    /** Callback fired when the hovered item changes (null when no item is hovered). */
    public onItemHoverChange: ((hit: InventoryHitInfo | null) => void) | null = null;

    public setStackMode(stack: boolean) {
        this.stackMode = stack;
    }

    public setSearchFilter(text: string) {
        this.searchFilter = (text || '').trim().toLowerCase();
    }

    constructor(game: GameAPI) {
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
        if (!ctx) throw new Error('CanvasInventoryPanel: failed to acquire 2d context');
        this.ctx = ctx;

        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    }

    public attachTo(parent: HTMLElement) {
        parent.appendChild(this.canvas);
    }

    public start() {
        if (this.running) return;
        this.running = true;
        const loop = () => {
            if (!this.running) return;
            this.draw();
            this.rafHandle = requestAnimationFrame(loop);
        };
        loop();
    }

    public stop() {
        this.running = false;
        if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
        this.hoverIndex = -1;
    }

    public isRunning(): boolean {
        return this.running;
    }

    /** Returns true if the given client coordinates are within the canvas bounds. */
    public containsClient(clientX: number, clientY: number): boolean {
        const rect = this.canvas.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    /** Hit-test client coordinates against the laid-out items. */
    public hitTestClient(clientX: number, clientY: number): InventoryHitInfo | null {
        const rect = this.canvas.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return null;
        }
        // Reject hits in the title bar area above the scrollable content.
        if (clientY - rect.top < CanvasInventoryPanel.CONTENT_TOP) return null;
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

    private layout(cssW: number, cssH: number) {
        const player = this.game.getLocalPlayer();
        if (!player || !Array.isArray(player.inventory)) {
            this.itemRects = [];
            this.contentHeight = 0;
            return;
        }
        const invDict = inventoryToDict(player.inventory);

        const padding = 12;
        const sectionGap = 14;
        const labelHeight = 22;
        const itemSize = 56;
        const itemGap = 8;
        const innerWidth = Math.max(itemSize, cssW - padding * 2);
        // Force exactly 5 columns (matches the reference design). The panel
        // width in styles.css is sized to fit 5 of these slots side-by-side.
        const cols = 5;

        this.itemRects = [];
        let y = padding;

        for (const rarity of RARITY_ORDER) {
            const items = invDict[rarity];
            if (!items) continue;
            // Filter by search text (matches petal name or item type) and stack mode.
            const rawEntries = Object.entries(items).filter(([, c]) => (c as number) > 0);
            const entries = rawEntries.filter(([type]) => this.matchesSearch(type));
            if (entries.length === 0) continue;

            // In stack mode, each entry renders once with its count badge.
            // In unstacked mode, expand each entry to `count` individual slots.
            const expanded: { type: string; count: number }[] = this.stackMode
                ? entries.map(([type, count]) => ({ type, count: count as number }))
                : entries.flatMap(([type, count]) =>
                      Array.from({ length: count as number }, () => ({ type, count: 1 }))
                  );

            // Reserve space for the rarity label drawn above the row.
            y += labelHeight;

            const totalRows = Math.ceil(expanded.length / cols);
            const lastRowItemCount = expanded.length - (totalRows - 1) * cols;

            // Full rows are centered using all `cols` slots; the partial last
            // row is centered against just its own item count so it sits in the
            // middle of the panel rather than left-aligned.
            const fullRowWidth = cols * itemSize + (cols - 1) * itemGap;
            const fullRowStartX = padding + (innerWidth - fullRowWidth) / 2;
            const lastRowWidth = lastRowItemCount * itemSize + (lastRowItemCount - 1) * itemGap;
            const lastRowStartX = padding + (innerWidth - lastRowWidth) / 2;

            for (let i = 0; i < expanded.length; i++) {
                const { type: itemType, count } = expanded[i];
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
                    count,
                });
            }

            y += totalRows * itemSize + (totalRows - 1) * itemGap;
            y += sectionGap;
        }

        this.contentHeight = y + padding;

        const visibleH = Math.max(0, cssH - CanvasInventoryPanel.CONTENT_TOP);
        const maxScroll = Math.max(0, this.contentHeight - visibleH);
        if (this.scrollY > maxScroll) this.scrollY = maxScroll;
        if (this.scrollY < 0) this.scrollY = 0;
    }

    private matchesSearch(itemType: string): boolean {
        if (!this.searchFilter) return true;
        const display = itemType.startsWith('petal_')
            ? formatPetalName(itemType.replace('petal_', ''))
            : formatPetalName(itemType);
        return display.toLowerCase().includes(this.searchFilter)
            || itemType.toLowerCase().includes(this.searchFilter);
    }

    public draw() {
        const { dpr, cssW, cssH } = this.syncCanvasSize();
        this.layout(cssW, cssH);

        const ctx = this.ctx;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, cssW, cssH);

        // Scrollable content area (the surrounding DOM owns the title/header).
        const contentTop = CanvasInventoryPanel.CONTENT_TOP;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, contentTop, cssW, cssH - contentTop);
        ctx.clip();
        ctx.translate(0, contentTop - this.scrollY);

        // Rarity labels — centered above the first rect of each group, with
        // rounded separator lines on either side.
        const seenRarity = new Set<string>();
        for (const r of this.itemRects) {
            if (!seenRarity.has(r.rarity)) {
                seenRarity.add(r.rarity);
                const color = ITEM_RARITY_COLORS[r.rarity] || '#fff';
                const labelText = r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1).toLowerCase();
                const labelY = r.y - 4;
                ctx.font = 'bold 14px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.lineWidth = 3;
                ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                ctx.strokeText(labelText, cssW / 2, labelY);
                ctx.fillStyle = color;
                ctx.fillText(labelText, cssW / 2, labelY);

                const textW = ctx.measureText(labelText).width;
                const gap = 10;
                const sidePad = 6;
                const lineY = labelY - 6;
                const leftEnd = cssW / 2 - textW / 2 - gap;
                const leftStart = sidePad;
                const rightStart = cssW / 2 + textW / 2 + gap;
                const rightEnd = cssW - sidePad;
                if (leftEnd > leftStart) {
                    ctx.save();
                    ctx.strokeStyle = CanvasInventoryPanel.SEPARATOR_COLOR;
                    ctx.lineWidth = 3;
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
            this.drawItemSlot(ctx, r, i === this.hoverIndex, now);
        }

        ctx.restore(); // unclip & untranslate

        // Scrollbar indicator
        const visibleH = cssH - contentTop;
        if (this.contentHeight > visibleH) {
            const trackTop = contentTop;
            const trackH = visibleH;
            const thumbH = Math.max(20, (trackH * visibleH) / this.contentHeight);
            const thumbY = trackTop + (this.scrollY / (this.contentHeight - visibleH)) * (trackH - thumbH);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(cssW - 6, thumbY, 4, thumbH);
        }

        ctx.restore();
    }

    /** Draws one item slot in the screenshot's style: per-rarity colored
     *  rounded square with a darker border, centered icon, outlined white
     *  name text at the bottom, and an outlined `xN` count in the top-right. */
    private drawItemSlot(ctx: CanvasRenderingContext2D, r: ItemRect, hovered: boolean, time: number) {
        const baseColor = ITEM_RARITY_COLORS[r.rarity] || '#dc7e92';
        const borderColor = darken(baseColor, 25);
        const radius = 6;
        const borderW = 3;

        // Outer rounded border + inner fill.
        ctx.save();
        ctx.fillStyle = borderColor;
        ctx.beginPath();
        (ctx as any).roundRect(r.x, r.y, r.w, r.h, radius);
        ctx.fill();
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        (ctx as any).roundRect(r.x + borderW, r.y + borderW, r.w - borderW * 2, r.h - borderW * 2, Math.max(0, radius - 2));
        ctx.fill();
        if (hovered) {
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            (ctx as any).roundRect(r.x + borderW, r.y + borderW, r.w - borderW * 2, r.h - borderW * 2, Math.max(0, radius - 2));
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.restore();

        // Item icon (slightly above center to leave room for the name text).
        this.drawItemIcon(ctx, r, time);

        // Item name — outlined white text at the bottom of the slot.
        const displayName = r.itemType.startsWith('petal_')
            ? formatPetalName(r.itemType.replace('petal_', ''))
            : formatPetalName(r.itemType);
        if (displayName) {
            ctx.save();
            let fontSize = 10;
            ctx.font = `bold ${fontSize}px Ubuntu, sans-serif`;
            const maxTextW = r.w - 8;
            let measured = ctx.measureText(displayName).width;
            if (measured > maxTextW) {
                fontSize = Math.max(7, (fontSize * maxTextW) / measured);
                ctx.font = `bold ${fontSize.toFixed(1)}px Ubuntu, sans-serif`;
            }
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#000000';
            const tx = r.x + r.w / 2;
            const ty = r.y + r.h - 5;
            ctx.strokeText(displayName, tx, ty);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(displayName, tx, ty);
            ctx.restore();
        }

        // Count badge: outlined white "xN" in the top-right corner of the slot.
        if (r.count > 1) {
            const text = `x${r.count}`;
            ctx.save();
            ctx.font = 'bold 11px Ubuntu, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#000000';
            const tx = r.x + r.w - 4;
            const ty = r.y + 3;
            ctx.strokeText(text, tx, ty);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, tx, ty);
            ctx.restore();
        }
    }

    private drawItemIcon(ctx: CanvasRenderingContext2D, r: ItemRect, time: number) {
        const cx = r.x + r.w / 2;
        // Sit the icon in the upper portion of the slot to leave room for the
        // outlined name text at the bottom.
        const cy = r.y + r.h * 0.4;
        const iconSize = 32;
        if (r.itemType.startsWith('petal_')) {
            const petalType = r.itemType.replace('petal_', '');
            const pc = this.game.getPetalCanvas?.(petalType, r.rarity, time);
            if (pc) {
                ctx.drawImage(pc, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
            }
        } else {
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

    // ===== input handlers =====
    private handleMouseMove = (e: MouseEvent) => {
        const hit = this.hitTestClient(e.clientX, e.clientY);
        const newIdx = hit ? this.findItemIndex(hit.rarity, hit.itemType) : -1;
        if (newIdx !== this.hoverIndex) {
            this.hoverIndex = newIdx;
            if (this.onItemHoverChange) this.onItemHoverChange(hit);
        }
    };

    private handleMouseLeave = () => {
        if (this.hoverIndex !== -1) {
            this.hoverIndex = -1;
            if (this.onItemHoverChange) this.onItemHoverChange(null);
        }
    };

    private handleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const hit = this.hitTestClient(e.clientX, e.clientY);
        if (hit && this.onItemMouseDown) {
            e.preventDefault();
            this.onItemMouseDown(hit.rarity, hit.itemType, e, hit);
        }
    };

    private handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.scrollY += e.deltaY;
        const rect = this.canvas.getBoundingClientRect();
        const visibleH = Math.max(0, rect.height - CanvasInventoryPanel.CONTENT_TOP);
        const maxScroll = Math.max(0, this.contentHeight - visibleH);
        if (this.scrollY < 0) this.scrollY = 0;
        if (this.scrollY > maxScroll) this.scrollY = maxScroll;
    };

    private findItemIndex(rarity: string, itemType: string): number {
        for (let i = 0; i < this.itemRects.length; i++) {
            if (this.itemRects[i].rarity === rarity && this.itemRects[i].itemType === itemType) return i;
        }
        return -1;
    }
}
