// Canvas-based inventory panel — replaces the prior DOM grid implementation.
// Renders rarity-grouped item slots into a single <canvas> and exposes hit
// testing / hover callbacks so InventoryManager can drive drag/drop & tooltips.
import { inventoryToDict, ITEM_KEY_TO_ID } from '../inventoryCodec';
import { ITEM_RARITY_COLORS } from '../petals';
import { drawText } from './text';
import { formatPetalName } from './petal-display';
import {
    ItemRect,
    PanelGameAPI as GameAPI,
    findItemIndex,
    drawItemSlot,
} from './panel-common';



const RARITY_ORDER = ['apex', 'unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];


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
    private imgCache: Map<string, HTMLImageElement | null> = new Map();

    // Canvas size — updated by ResizeObserver, avoiding getBoundingClientRect() every frame.
    private cachedCssW: number = 0;
    private cachedCssH: number = 0;
    private resizeObserver: ResizeObserver | null = null;

    // Layout dirty-tracking — skip inventoryToDict() + grid when nothing changed.
    private layoutDirty: boolean = true;
    private lastInventoryHash: number = -1;
    private lastSearchFilter: string = '\0';
    private lastStackMode: boolean | undefined = undefined;
    private lastLayoutW: number = -1;
    private cachedFilter: string = '';

    // Canvas redraw dirty-tracking — skip the full canvas paint when nothing is visible.
    private canvasDirty: boolean = true;
    /** Scopes the invalidation listeners registered in attachTo() to this panel's lifetime. */
    private readonly listenerAbort: AbortController = new AbortController();
    private lastHoverIndex: number = -2;
    private lastScrollY: number = -1;
    private hasAnimatedPetals: boolean = false;

    /**
     * True from dragstart until dragend (+ a small grace window) so we can
     * suppress the `click` event that some browsers fire spuriously after a
     * successful HTML5 drag of a `draggable=true` element. Without this,
     * click-to-auto-equip fires after every drag-to-loadout, double-equipping
     * the dragged item into the first empty slot.
     */
    private dragInProgress: boolean = false;
    private suppressClickUntil: number = 0;

    /** Display mode toggle.
     *  - true  ("stacked"): only one slot per item *type*; the highest rarity
     *    the player owns sits on top and hides the lower-rarity copies.
     *  - false ("unstacked"): one slot per unique (rarity, type) pair, each
     *    with its own count badge — items still appear under every rarity
     *    section in which the player owns them. */
    private stackMode: boolean = false;
    /** Substring filter (lowercased) applied to formatted petal/item names. */
    private searchFilter: string = '';

    // ===== Canvas-drawn header / chrome state =====
    /** Computed each frame in layout(). The pixel offset where the items area
     *  starts (after the title/subtitle/controls header). */
    private contentTop: number = 0;
    /** Hit-test rects (canvas-local CSS pixels), recomputed each frame. */
    private closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    private stackToggleRect = { x: 0, y: 0, w: 0, h: 0 };
    private stackBoxRect = { x: 0, y: 0, w: 0, h: 0 };
    private searchBoxRect = { x: 0, y: 0, w: 0, h: 0 };
    /** Hover index for the close button (drawn brighter when hovered). */
    private closeBtnHovered: boolean = false;
    /** Lerp factor (0..1) used to animate the gardn-style toggle button. */
    private toggleLerp: number = 0;
    /** Real DOM <input> overlaid on top of the canvas for the search field —
     *  matches gardn's TextInput approach (canvas paints the background, the
     *  HTML input handles all keyboard input, IME, copy/paste, etc.). */
    private searchInputEl: HTMLInputElement | null = null;

    /** Color of the rounded separator lines flanking each rarity label.
     *  Matches the .inventory-panel CSS border color. */
    private static readonly SEPARATOR_COLOR = '#4a8bc2';
    /** Panel background and border colors (drawn by the canvas itself). */
    private static readonly PANEL_BG = '#599fdc';
    private static readonly PANEL_BORDER = '#4a8bc2';
    private static readonly CLOSE_BG = '#dc7e92';
    private static readonly CLOSE_BORDER = '#b56476';

    /**
     * Callback fired on item mousedown. If set, the panel calls preventDefault
     * to suppress the browser's HTML5 drag and `click` won't fire — use this
     * when you have a custom JS-level drag system (in-game inventory).
     */
    public onItemMouseDown: ((rarity: string, itemType: string, e: MouseEvent, hit: InventoryHitInfo) => void) | null = null;
    /**
     * Callback fired when the user clicks an item (mouseup without drag).
     * Only fires if `onItemMouseDown` is unset — wire this for plain
     * click-to-action behavior like auto-equip-to-first-empty-slot.
     */
    public onItemClick: ((rarity: string, itemType: string, e: MouseEvent, hit: InventoryHitInfo) => void) | null = null;
    /**
     * Callback fired on dragstart over an item. Set whatever data you need
     * onto e.dataTransfer here (e.g. text/plain JSON of {rarity, type}); the
     * loadout drop handler will read it. Setting this is required for HTML5
     * drag-to-loadout to work; otherwise dragstart is canceled.
     */
    public onItemDragStart: ((rarity: string, itemType: string, e: DragEvent, hit: InventoryHitInfo) => void) | null = null;
    /** Callback fired when the hovered item changes (null when no item is hovered). */
    public onItemHoverChange: ((hit: InventoryHitInfo | null) => void) | null = null;
    /** Callback fired when the close button is clicked. */
    public onClose: (() => void) | null = null;
    /**
     * When set, items for which this returns true render greyed-out and are
     * blocked from mousedown/click/drag (e.g. ultra+ petals while in the maze,
     * which the server refuses to equip).
     */
    public isItemDisabled: ((rarity: string, itemType: string) => boolean) | null = null;

    public setStackMode(stack: boolean) {
        this.stackMode = stack;
    }

    public setSearchFilter(text: string) {
        this.searchFilter = text || '';
        if (this.searchInputEl) this.searchInputEl.value = this.searchFilter;
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
        this.canvas.addEventListener('click', this.handleClick);
        this.canvas.addEventListener('dragstart', this.handleDragStart);
        this.canvas.addEventListener('dragend', this.handleDragEnd);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
        this.canvas.draggable = true;
    }

    public attachTo(parent: HTMLElement) {
        parent.appendChild(this.canvas);
        // Seed cached size immediately (getBoundingClientRect called once only).
        const initRect = this.canvas.getBoundingClientRect();
        this.cachedCssW = initRect.width;
        this.cachedCssH = initRect.height;
        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                if (entry.target === this.canvas) {
                    this.cachedCssW = entry.contentRect.width;
                    this.cachedCssH = entry.contentRect.height;
                    this.layoutDirty = true;
                }
            }
        });
        this.resizeObserver.observe(this.canvas);

        // Recover the painted output whenever it can no longer be trusted.
        //
        // draw() repaints only when it can see a reason to (inventory hash,
        // hover, scroll, lerp, animated petals) and otherwise keeps whatever is
        // already on the canvas — this is the only panel that does that; the
        // craft and mob-gallery canvases repaint every frame and so can't get
        // stuck. But the *browser* can invalidate the canvas behind our back: it
        // may discard the backing store of a hidden tab under memory pressure,
        // and a GPU context loss blanks it outright. Neither changes any state
        // draw() inspects, so the panel keeps early-returning and the stale or
        // blank frame survives until something happens to move the scroll —
        // which is exactly the "scroll down and back up and it fixes itself"
        // symptom. Force a full relayout+repaint on the way back in.
        const invalidate = () => { this.layoutDirty = true; this.canvasDirty = true; };
        const signal = this.listenerAbort.signal;
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) invalidate();
        }, { signal });
        window.addEventListener('focus', invalidate, { signal });
        this.canvas.addEventListener('contextlost', invalidate, { signal });
        this.canvas.addEventListener('contextrestored', invalidate, { signal });
        // Mount a real <input> for the search field, positioned absolutely on
        // top of the canvas. The canvas paints the background; the input
        // handles every keystroke (gardn's TextInput approach).
        this.searchInputEl = document.createElement('input');
        this.searchInputEl.type = 'text';
        this.searchInputEl.style.cssText = `
            position: absolute;
            background: transparent;
            border: none;
            outline: none;
            color: #000000;
            font-family: Ubuntu, sans-serif;
            font-size: 13px;
            padding: 0 8px;
            margin: 0;
            box-sizing: border-box;
            display: none;
        `;
        this.searchInputEl.addEventListener('input', () => {
            this.searchFilter = this.searchInputEl?.value || '';
        });
        parent.appendChild(this.searchInputEl);
    }

    public start() {
        if (this.running) return;
        this.running = true;
        if (this.searchInputEl) this.searchInputEl.style.display = 'block';
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
        if (this.searchInputEl) {
            this.searchInputEl.blur();
            this.searchInputEl.style.display = 'none';
        }
    }

    public isRunning(): boolean {
        return this.running;
    }

    /** Tear down DOM resources. Call when the panel is destroyed. */
    public destroy() {
        this.stop();
        this.listenerAbort.abort();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        if (this.searchInputEl) {
            this.searchInputEl.remove();
            this.searchInputEl = null;
        }
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
        // Reject hits in the header area above the scrollable content.
        if (clientY - rect.top < this.contentTop) return null;
        // Convert to layout (CSS-pixel) space, inverting draw()'s translate.
        const x = clientX - rect.left;
        const y = (clientY - rect.top) - this.contentTop + this.scrollY;
        for (const r of this.itemRects) {
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                const screenX = rect.left + r.x;
                const screenY = rect.top + r.y + this.contentTop - this.scrollY;
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
        const dpr = window.devicePixelRatio || 1;
        const cssW = this.cachedCssW > 0 ? this.cachedCssW : this.canvas.offsetWidth;
        const cssH = this.cachedCssH > 0 ? this.cachedCssH : this.canvas.offsetHeight;
        const w = Math.max(1, Math.floor(cssW * dpr));
        const h = Math.max(1, Math.floor(cssH * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
            // Assigning width/height resets the backing store to transparent
            // black. This panel is the only one that keeps its painted output
            // across frames, so without re-arming the dirty flag draw() can
            // early-out and leave the panel blank. A CSS resize is covered by
            // the ResizeObserver, but the backing store also tracks
            // devicePixelRatio — moving the window to another monitor or
            // zooming changes `w` with cssW unchanged, which nothing else sees.
            this.canvasDirty = true;
        }
        return { dpr, cssW, cssH };
    }

    private layoutHeader(cssW: number) {
        // The header area at the top of the canvas: title, subtitle, controls,
        // close button. All measurements in canvas-local CSS pixels.
        const panelPad = 14;
        const titleH = 26;
        const subtitleH = 16;
        const controlsH = 26;
        const gap = 6;

        // Close button — top-right square.
        const closeSize = 26;
        this.closeBtnRect = {
            x: cssW - panelPad - closeSize,
            y: panelPad - 4,
            w: closeSize,
            h: closeSize,
        };

        // Controls row Y (after title + subtitle + gaps).
        const controlsY = panelPad + titleH + 2 + subtitleH + gap;

        // Stack toggle: small square checkbox + "Stack" label, left-aligned.
        const boxSize = 18;
        const stackLabelW = 48; // approximate width of "Stack" text + spacing
        const stackToggleW = boxSize + 4 + stackLabelW;
        this.stackBoxRect = {
            x: panelPad,
            y: controlsY + (controlsH - boxSize) / 2,
            w: boxSize,
            h: boxSize,
        };
        this.stackToggleRect = {
            x: panelPad,
            y: controlsY,
            w: stackToggleW,
            h: controlsH,
        };

        // Search box fills the rest of the controls row.
        const searchX = panelPad + stackToggleW + 8;
        this.searchBoxRect = {
            x: searchX,
            y: controlsY,
            w: cssW - searchX - panelPad,
            h: controlsH,
        };

        this.contentTop = controlsY + controlsH + gap;
    }

    private hashInventory(inv: number[]): number {
        let h = inv.length;
        for (let i = 0; i < inv.length; i++) {
            h = (Math.imul(h, 31) + inv[i]) | 0;
        }
        return h;
    }

    private layout(cssW: number, cssH: number) {
        this.layoutHeader(cssW);

        const player = this.game.getLocalPlayer();
        const inv: number[] | null = player && Array.isArray(player.inventory) ? player.inventory : null;

        const invHash = inv ? this.hashInventory(inv) : 0;
        const needsLayout = this.layoutDirty
            || invHash !== this.lastInventoryHash
            || this.searchFilter !== this.lastSearchFilter
            || this.stackMode !== this.lastStackMode
            || cssW !== this.lastLayoutW;

        // Reclamp scroll every frame — cheap, and cssH can change independently.
        const visibleH = Math.max(0, cssH - this.contentTop - 14);
        const maxScroll = Math.max(0, this.contentHeight - visibleH);
        if (this.scrollY > maxScroll) this.scrollY = maxScroll;
        if (this.scrollY < 0) this.scrollY = 0;

        if (!needsLayout) return;

        this.layoutDirty = false;
        this.lastInventoryHash = invHash;
        this.lastSearchFilter = this.searchFilter;
        this.lastStackMode = this.stackMode;
        this.lastLayoutW = cssW;
        this.cachedFilter = this.searchFilter.trim().toLowerCase();

        if (!inv) {
            this.itemRects = [];
            this.contentHeight = 0;
            return;
        }
        const invDict = inventoryToDict(inv);

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

        // Helper that lays out a flat list of entries as a centered 5-column
        // grid starting at the current `y`, then advances `y` past the rows.
        const layoutGrid = (entries: [string, number][], rarityForEntry: (idx: number) => string) => {
            if (entries.length === 0) return;
            const totalRows = Math.ceil(entries.length / cols);
            const lastRowItemCount = entries.length - (totalRows - 1) * cols;
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
                this.itemRects.push({
                    x: startX + col * (itemSize + itemGap),
                    y: y + row * (itemSize + itemGap),
                    w: itemSize,
                    h: itemSize,
                    rarity: rarityForEntry(i),
                    itemType,
                    count: count as number,
                });
            }
            y += totalRows * itemSize + (totalRows - 1) * itemGap;
        };

        if (this.stackMode) {
            // Stacked mode: one slot per item type, drawn at its highest rarity.
            // No rarity sections — items are sorted by their numerical item ID
            // (the canonical petal ordering) rather than by rarity.
            const seen = new Map<string, { rarity: string; count: number }>();
            for (const rarity of RARITY_ORDER) {
                const items = invDict[rarity];
                if (!items) continue;
                for (const [type, count] of Object.entries(items)) {
                    if ((count as number) > 0 && !seen.has(type)) {
                        seen.set(type, { rarity, count: count as number });
                    }
                }
            }
            const sortedTypes: string[] = [];
            for (const [type] of seen) {
                if (this.matchesSearch(type)) sortedTypes.push(type);
            }
            sortedTypes.sort((a, b) => {
                const ia = ITEM_KEY_TO_ID.get(a);
                const ib = ITEM_KEY_TO_ID.get(b);
                // Items without an ID sort to the end so the rest stay ordered.
                if (ia === undefined && ib === undefined) return a.localeCompare(b);
                if (ia === undefined) return 1;
                if (ib === undefined) return -1;
                return ia - ib;
            });
            const flat: [string, number][] = sortedTypes.map(t => [t, seen.get(t)!.count]);
            const rarities: string[] = sortedTypes.map(t => seen.get(t)!.rarity);
            layoutGrid(flat, i => rarities[i]);
            y += sectionGap;
        } else {
            // Unstacked mode: one slot per unique (rarity, type) pair, grouped
            // under per-rarity section labels.
            for (const rarity of RARITY_ORDER) {
                const items = invDict[rarity];
                if (!items) continue;
                const entries = Object.entries(items)
                    .filter(([, c]) => (c as number) > 0)
                    .filter(([type]) => this.matchesSearch(type)) as [string, number][];
                if (entries.length === 0) continue;
                y += labelHeight;
                layoutGrid(entries, () => rarity);
                y += sectionGap;
            }
        }

        this.contentHeight = y + padding;

        // Check whether any visible slot contains an animated petal (frame varies with time).
        this.hasAnimatedPetals = this.itemRects.some(r => {
            if (!r.itemType.startsWith('petal_')) return false;
            const pt = r.itemType.replace('petal_', '');
            const c0 = this.game.getPetalCanvas?.(pt, r.rarity, 0);
            const c1 = this.game.getPetalCanvas?.(pt, r.rarity, 100);
            return c0 !== null && c0 !== c1;
        });
        this.canvasDirty = true;
    }

    private matchesSearch(itemType: string): boolean {
        if (!this.cachedFilter) return true;
        const display = itemType.startsWith('petal_')
            ? formatPetalName(itemType.replace('petal_', ''))
            : formatPetalName(itemType);
        return display.toLowerCase().includes(this.cachedFilter)
            || itemType.toLowerCase().includes(this.cachedFilter);
    }

    public draw() {
        const { dpr, cssW, cssH } = this.syncCanvasSize();
        this.layout(cssW, cssH);

        const lerpTarget = this.stackMode ? 1 : 0;
        const lerpDone = Math.abs(this.toggleLerp - lerpTarget) < 0.01;
        const needsRedraw = this.canvasDirty
            || this.hoverIndex !== this.lastHoverIndex
            || this.scrollY !== this.lastScrollY
            || !lerpDone
            || this.hasAnimatedPetals;

        if (!needsRedraw) return;

        this.canvasDirty = false;
        this.lastHoverIndex = this.hoverIndex;
        this.lastScrollY = this.scrollY;

        const ctx = this.ctx;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, cssW, cssH);

        // ----- Panel background + border -----
        const panelRadius = 3;
        const borderW = 4;
        ctx.fillStyle = CanvasInventoryPanel.PANEL_BORDER;
        ctx.beginPath();
        (ctx as any).roundRect(0, 0, cssW, cssH, panelRadius);
        ctx.fill();
        ctx.fillStyle = CanvasInventoryPanel.PANEL_BG;
        ctx.beginPath();
        (ctx as any).roundRect(borderW, borderW, cssW - borderW * 2, cssH - borderW * 2, Math.max(0, panelRadius - 2));
        ctx.fill();

        // ----- Header (title, subtitle, controls, close button) -----
        this.drawHeader(ctx, cssW);

        // ----- Scrollable items area -----
        const contentTop = this.contentTop;
        ctx.save();
        ctx.beginPath();
        ctx.rect(borderW, contentTop, cssW - borderW * 2, cssH - contentTop - borderW);
        ctx.clip();
        ctx.translate(0, contentTop - this.scrollY);

        // Rarity labels — centered above the first rect of each group, with
        // rounded separator lines on either side. Skipped in stacked mode,
        // which deliberately renders one flat grid without per-rarity sections.
        const visibleH = cssH - contentTop - 14;
        const viewTop = this.scrollY;
        const viewBottom = this.scrollY + visibleH;

        const seenRarity = new Set<string>();
        if (!this.stackMode) for (const r of this.itemRects) {
            if (!seenRarity.has(r.rarity)) {
                seenRarity.add(r.rarity);
                const labelY = r.y - 4;
                if (labelY < viewTop - 22 || labelY >= viewBottom) continue;
                const color = ITEM_RARITY_COLORS[r.rarity] || '#fff';
                const labelText = r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1).toLowerCase();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                drawText(ctx, labelText, cssW / 2, labelY, { size: 14, weight: 'bold', fill: color, stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3 });

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
            if (r.y + r.h <= viewTop || r.y >= viewBottom) continue;
            this.drawItemSlot(ctx, r, i === this.hoverIndex, now);
        }

        ctx.restore(); // unclip & untranslate

        // Scrollbar indicator (vertical strip on the right side of the items area).
        if (this.contentHeight > visibleH) {
            const trackTop = contentTop;
            const trackH = visibleH;
            const thumbH = Math.max(20, (trackH * visibleH) / this.contentHeight);
            const thumbY = trackTop + (this.scrollY / (this.contentHeight - visibleH)) * (trackH - thumbH);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(cssW - 10, thumbY, 4, thumbH);
        }

        ctx.restore();
    }

    /** Draws the title, subtitle, stack toggle, search box, and close button. */
    private drawHeader(ctx: CanvasRenderingContext2D, cssW: number) {
        // ----- Title -----
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        drawText(ctx, 'Inventory', cssW / 2, 14, { size: 22, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 4 });

        // ----- Subtitle -----
        drawText(ctx, 'Drag a petal to equip it', cssW / 2, 14 + 26 + 2, { size: 13, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        ctx.restore();

        // ----- Stack toggle (gardn ToggleButton style) -----
        // Outer dark gray rounded square with a darker border, inner rect
        // that lerps between dark gray (off) and #cfcfcf (on).
        const box = this.stackBoxRect;
        const target = this.stackMode ? 1 : 0;
        this.toggleLerp += (target - this.toggleLerp) * 0.25;
        if (Math.abs(this.toggleLerp - target) < 0.01) this.toggleLerp = target;
        const lineW = 4;
        const radius = 5;
        const outerColor = '#3a3a3a';
        const innerOff = '#666666';
        const innerOn = '#cfcfcf';
        // Mix innerOff → innerOn by toggleLerp
        const mix = (a: string, b: string, t: number) => {
            const ah = parseInt(a.slice(1), 16);
            const bh = parseInt(b.slice(1), 16);
            const ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
            const br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
            const r = Math.round(ar + (br - ar) * t);
            const g = Math.round(ag + (bg - ag) * t);
            const bch = Math.round(ab + (bb - ab) * t);
            return `#${((r << 16) | (g << 8) | bch).toString(16).padStart(6, '0')}`;
        };
        ctx.save();
        ctx.fillStyle = outerColor;
        ctx.beginPath();
        (ctx as any).roundRect(box.x, box.y, box.w, box.h, radius);
        ctx.fill();
        ctx.fillStyle = mix(innerOff, innerOn, this.toggleLerp);
        ctx.fillRect(box.x + lineW, box.y + lineW, box.w - lineW * 2, box.h - lineW * 2);
        ctx.restore();

        // "Stack" label next to the toggle.
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        const labelX = box.x + box.w + 5;
        const labelY = box.y + box.h / 2 + 1;
        drawText(ctx, 'Stack', labelX, labelY, { size: 14, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        ctx.restore();

        // ----- Search box background (gardn TextInput fill) -----
        // The actual editable text is rendered by a real <input> overlaid on
        // top of this rect (positioned in draw() below).
        const sb = this.searchBoxRect;
        ctx.save();
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        (ctx as any).roundRect(sb.x, sb.y, sb.w, sb.h, 5);
        ctx.fill();
        ctx.fillStyle = '#eeeeee';
        ctx.fillRect(sb.x + 4, sb.y + 4, sb.w - 8, sb.h - 8);
        ctx.restore();

        // ----- Close button -----
        const cb = this.closeBtnRect;
        ctx.save();
        ctx.fillStyle = CanvasInventoryPanel.CLOSE_BORDER;
        ctx.beginPath();
        (ctx as any).roundRect(cb.x, cb.y, cb.w, cb.h, 4);
        ctx.fill();
        ctx.fillStyle = this.closeBtnHovered ? '#e8a0b0' : CanvasInventoryPanel.CLOSE_BG;
        ctx.beginPath();
        (ctx as any).roundRect(cb.x + 2, cb.y + 2, cb.w - 4, cb.h - 4, 3);
        ctx.fill();
        // ✕ glyph
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        const pad = 7;
        ctx.beginPath();
        ctx.moveTo(cb.x + pad, cb.y + pad);
        ctx.lineTo(cb.x + cb.w - pad, cb.y + cb.h - pad);
        ctx.moveTo(cb.x + cb.w - pad, cb.y + pad);
        ctx.lineTo(cb.x + pad, cb.y + cb.h - pad);
        ctx.stroke();
        ctx.restore();

        // ----- Position the real <input> on top of the search box -----
        if (this.searchInputEl) {
            const inset = 4;
            this.searchInputEl.style.left = `${sb.x + inset}px`;
            this.searchInputEl.style.top = `${sb.y + inset}px`;
            this.searchInputEl.style.width = `${sb.w - inset * 2}px`;
            this.searchInputEl.style.height = `${sb.h - inset * 2}px`;
        }
    }

    private pointInRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    /** Draws one item slot in the screenshot's style: per-rarity colored
     *  rounded square with a darker border, centered icon, outlined white
     *  name text at the bottom, and an outlined `xN` count in the top-right. */
    private drawItemSlot(ctx: CanvasRenderingContext2D, r: ItemRect, hovered: boolean, time: number) {
        drawItemSlot(ctx, r, hovered, time, this.game, this.imgCache, this.isItemDisabled);
    }


    // ===== input handlers =====
    private toLocal(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private handleMouseMove = (e: MouseEvent) => {
        const { x, y } = this.toLocal(e);
        // Close button hover (used for visual brighten on next draw).
        const hoverClose = this.pointInRect(x, y, this.closeBtnRect);
        if (hoverClose !== this.closeBtnHovered) this.closeBtnHovered = hoverClose;

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
        this.closeBtnHovered = false;
    };

    private handleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const { x, y } = this.toLocal(e);

        // Close button.
        if (this.pointInRect(x, y, this.closeBtnRect)) {
            e.preventDefault();
            if (this.onClose) this.onClose();
            return;
        }
        // Stack toggle (whole label area is clickable).
        if (this.pointInRect(x, y, this.stackToggleRect)) {
            e.preventDefault();
            this.stackMode = !this.stackMode;
            return;
        }
        // Search box clicks fall through to the real <input> overlay (on top
        // of the canvas), so we don't handle them here.

        const hit = this.hitTestClient(e.clientX, e.clientY);
        if (!hit) return;
        // Disabled items can't be picked up / equipped.
        if (this.isItemDisabled && this.isItemDisabled(hit.rarity, hit.itemType)) {
            e.preventDefault();
            return;
        }
        // Legacy mousedown callback (in-game uses this for its custom JS-level
        // drag). preventDefault suppresses the browser's HTML5 drag so the
        // custom system has full control.
        if (this.onItemMouseDown) {
            e.preventDefault();
            this.onItemMouseDown(hit.rarity, hit.itemType, e, hit);
            return;
        }
        // No mousedown handler: don't preventDefault — let dragstart fire
        // (when onItemDragStart is wired) or let click fire (auto-equip).
    };

    private handleClick = (e: MouseEvent) => {
        if (e.button !== 0) return;
        // If the consumer is using onItemMouseDown for its own drag system,
        // its mousedown preventDefault'd already and click is suppressed for
        // the dragged element anyway. Skip here to avoid double-handling.
        if (this.onItemMouseDown) return;
        // Some browsers fire `click` right after a successful HTML5 drag-and-
        // drop on a draggable=true element. Without this guard, dragging an
        // item to a loadout slot also auto-equips it via the click path.
        if (this.dragInProgress || performance.now() < this.suppressClickUntil) return;
        const { x, y } = this.toLocal(e);
        if (this.pointInRect(x, y, this.closeBtnRect)) return;
        if (this.pointInRect(x, y, this.stackToggleRect)) return;
        const hit = this.hitTestClient(e.clientX, e.clientY);
        if (hit && this.isItemDisabled && this.isItemDisabled(hit.rarity, hit.itemType)) return;
        if (hit && this.onItemClick) {
            e.preventDefault();
            this.onItemClick(hit.rarity, hit.itemType, e, hit);
        }
    };

    private handleDragStart = (e: DragEvent) => {
        const hit = this.hitTestClient(e.clientX, e.clientY);
        if (!hit) {
            // Drag started on chrome / empty area — cancel so the canvas
            // doesn't drag itself as an image.
            e.preventDefault();
            return;
        }
        // Disabled items can't be dragged to the loadout.
        if (this.isItemDisabled && this.isItemDisabled(hit.rarity, hit.itemType)) {
            e.preventDefault();
            return;
        }
        if (this.onItemDragStart) {
            this.dragInProgress = true;
            this.onItemDragStart(hit.rarity, hit.itemType, e, hit);
        } else {
            e.preventDefault();
        }
    };

    private handleDragEnd = () => {
        if (!this.dragInProgress) return;
        this.dragInProgress = false;
        // Some browsers queue a phantom `click` after the dragend completes
        // (especially Chrome on draggable=true elements). Hold off click
        // handling for a short grace window so that phantom click is dropped.
        this.suppressClickUntil = performance.now() + 200;
    };

    private handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.scrollY += e.deltaY;
        const rect = this.canvas.getBoundingClientRect();
        const visibleH = Math.max(0, rect.height - this.contentTop - 14);
        const maxScroll = Math.max(0, this.contentHeight - visibleH);
        if (this.scrollY < 0) this.scrollY = 0;
        if (this.scrollY > maxScroll) this.scrollY = maxScroll;
    };

    private findItemIndex(rarity: string, itemType: string): number {
        return findItemIndex(this.itemRects, rarity, itemType);
    }
}
