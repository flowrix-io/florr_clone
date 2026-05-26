// Canvas-based crafting panel — replaces the prior DOM crafting implementation.
// Renders the crafting UI (5 slots, craft button, success chance, inventory grid)
// into a single <canvas>, following the same pattern as CanvasInventoryPanel.
import { inventoryToDict, ITEM_KEY_TO_ID } from '../inventoryCodec';
import { ITEM_RARITY_COLORS } from '../petals';
import { drawPetalGroup } from './petal-icon';

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
    getPetalStats?(petalType: string, rarity: string): any;
    getItemSpriteDataUrl?(itemType: string): string | null;
}


/** Column order for the crafting inventory grid: common on left, no apex. */
const CRAFT_RARITY_COLS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];

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

/** Info about a crafting item the player has selected. */
export interface CraftingItem {
    type: string;       // 'petal' or item type
    rarity: string;
    petalType?: string; // set when type === 'petal'
}

export class CanvasCraftingPanel {
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

    // ----- Crafting state (driven by InventoryManager) -----
    /** The items currently placed in the crafting slots. */
    private craftingItems: CraftingItem[] = [];
    /** Computed success chance (0-100). */
    private successChance: number = 0;
    /** Result item to display after a successful craft. */
    private successResult: { type: string; rarity: string; petalType?: string; count: number } | null = null;

    // ----- Animation state -----
    /** 'idle' = normal, 'spinning' = slots rotating, 'result' = showing outcome */
    private animState: 'idle' | 'spinning' | 'result' = 'idle';
    /** Timestamp when the spin animation started. */
    private spinStartTime: number = 0;
    /** Duration of the spin in ms. */
    private static readonly SPIN_DURATION = 1500;
    /** Current spin angle offset in radians (applied to slot positions). */
    private spinAngle: number = 0;
    /** The item being crafted during animation (snapshot taken at craft time). */
    private animCraftItem: CraftingItem | null = null;
    /** Result display start time. */
    private resultStartTime: number = 0;
    /** Duration to show the result before going back to idle. */
    private static readonly RESULT_DURATION = 2000;
    /** On failure: how many petals remain in slots (1-4). */
    private failRemainingCount: number = 0;
    /** Whether the result was a success. */
    private resultSuccess: boolean = false;
    /** Pending server result, received while still spinning. */
    private pendingResult: { success: boolean; result?: { type: string; rarity: string; petalType?: string; count: number }; remaining: number } | null = null;

    // ----- Layout rects (CSS pixels) -----
    private closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    private craftBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    private slotRects: { x: number; y: number; w: number; h: number }[] = [];
    private closeBtnHovered = false;
    private craftBtnHovered = false;
    /** The Y offset where the scrollable inventory area starts. */
    private inventoryTop: number = 0;

    // ----- Panel colors -----
    private static readonly PANEL_BG = '#d8a05d';
    private static readonly PANEL_BORDER = '#c4914a';
    private static readonly SLOT_BG = '#b8884a';
    private static readonly SLOT_BORDER = '#a07040';
    private static readonly CLOSE_BG = '#dc7e92';
    private static readonly CLOSE_BORDER = '#b56476';
    private static readonly CRAFT_BTN_BG = '#8a7a6a';
    private static readonly CRAFT_BTN_BORDER = '#6a5a4a';

    // ----- Callbacks -----
    public onClose: (() => void) | null = null;
    public onCraft: (() => void) | null = null;
    public onItemClick: ((rarity: string, itemType: string, shiftKey: boolean) => void) | null = null;
    public onSlotClick: (() => void) | null = null;

    constructor(game: GameAPI) {
        this.game = game;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'crafting-canvas';
        this.canvas.style.cssText = `
            display: block;
            width: 100%;
            height: 100%;
            user-select: none;
        `;
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('CanvasCraftingPanel: failed to acquire 2d context');
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

    public destroy() {
        this.stop();
    }

    // ----- Public state setters (called by InventoryManager) -----

    public setCraftingItems(items: CraftingItem[]) {
        this.craftingItems = items;
    }

    public setSuccessChance(chance: number) {
        this.successChance = chance;
    }

    public setSuccessResult(result: { type: string; rarity: string; petalType?: string; count: number } | null) {
        this.successResult = result;
    }

    /** Start the spinning animation. Called when the user clicks Craft. */
    public startCraftAnimation(item: CraftingItem) {
        this.animState = 'spinning';
        this.spinStartTime = performance.now();
        this.spinAngle = 0;
        this.animCraftItem = item;
        this.pendingResult = null;
        this.successResult = null;
    }

    /** Called when the server responds with crafting results. */
    public showCraftResult(success: boolean, result: { type: string; rarity: string; petalType?: string; count: number } | null, petalsReturned: number) {
        const data = { success, result: result || undefined, remaining: petalsReturned };
        if (this.animState === 'spinning') {
            // Store for when spin finishes
            this.pendingResult = data;
        } else {
            this.transitionToResult(data);
        }
    }

    private transitionToResult(data: { success: boolean; result?: { type: string; rarity: string; petalType?: string; count: number }; remaining: number }) {
        this.animState = 'result';
        this.resultStartTime = performance.now();
        this.resultSuccess = data.success;
        if (data.success && data.result) {
            this.successResult = data.result;
        } else {
            this.successResult = null;
        }
        this.failRemainingCount = data.remaining;
    }

    public isAnimating(): boolean {
        return this.animState !== 'idle';
    }

    // ----- Canvas size sync -----

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

    // ----- Layout -----

    private layoutCraftingArea(cssW: number): number {
        const panelPad = 14;
        const slotSize = 40;

        // Close button — top-right.
        const closeSize = 26;
        this.closeBtnRect = {
            x: cssW - panelPad - closeSize,
            y: panelPad - 4,
            w: closeSize,
            h: closeSize,
        };

        // 5 crafting slots arranged in a circle (original layout)
        const containerSize = 180;
        const radius = 70;
        const containerCx = cssW / 2;
        const containerCy = 50 + containerSize / 2;

        // Update spin angle based on animation state
        if (this.animState === 'spinning') {
            const elapsed = performance.now() - this.spinStartTime;
            const t = Math.min(1, elapsed / CanvasCraftingPanel.SPIN_DURATION);
            // Ease-out: fast start, slows down at end. Total ~6 full rotations.
            const totalRotations = 6;
            const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
            this.spinAngle = eased * totalRotations * 2 * Math.PI;

            if (t >= 1) {
                // Spin done — check for pending result
                this.spinAngle = 0;
                if (this.pendingResult) {
                    this.transitionToResult(this.pendingResult);
                    this.pendingResult = null;
                } else {
                    // Server hasn't responded yet, keep spinning (hold at end)
                    this.spinAngle = totalRotations * 2 * Math.PI;
                }
            }
        }

        this.slotRects = [];
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * 2 * Math.PI + this.spinAngle;
            const x = containerCx + radius * Math.cos(angle) - slotSize / 2;
            const y = containerCy + radius * Math.sin(angle) - slotSize / 2;
            this.slotRects.push({ x, y, w: slotSize, h: slotSize });
        }

        // Craft button — right of the circle
        const craftBtnW = 80;
        const craftBtnH = 32;
        const craftBtnX = containerCx + containerSize / 2 + 10;
        const craftBtnY = containerCy - craftBtnH / 2;
        this.craftBtnRect = { x: craftBtnX, y: craftBtnY, w: craftBtnW, h: craftBtnH };

        // Return the Y position after the crafting area
        return 50 + containerSize + 10;
    }

    /** Collect all item types that the player owns (excluding unique rarity), in a stable order. */
    private getOwnedItemTypes(invDict: Record<string, Record<string, number>>): string[] {
        const typeSet = new Set<string>();
        for (const rarity of CRAFT_RARITY_COLS) {
            const items = invDict[rarity];
            if (!items) continue;
            for (const [type, count] of Object.entries(items)) {
                if ((count as number) > 0) typeSet.add(type);
            }
        }
        // Sort by ITEM_KEY_TO_ID for canonical ordering
        const types = Array.from(typeSet);
        types.sort((a, b) => {
            const ia = ITEM_KEY_TO_ID.get(a);
            const ib = ITEM_KEY_TO_ID.get(b);
            if (ia === undefined && ib === undefined) return a.localeCompare(b);
            if (ia === undefined) return 1;
            if (ib === undefined) return -1;
            return ia - ib;
        });
        return types;
    }

    /** Which rarities actually exist in the player's inventory? Common on left, no unique. */
    private getOwnedRarities(invDict: Record<string, Record<string, number>>): string[] {
        const result: string[] = [];
        for (const rarity of CRAFT_RARITY_COLS) {
            const items = invDict[rarity];
            if (!items) continue;
            for (const count of Object.values(items)) {
                if ((count as number) > 0) { result.push(rarity); break; }
            }
        }
        return result;
    }

    private layoutInventory(cssW: number, cssH: number, startY: number) {
        const player = this.game.getLocalPlayer();
        if (!player || !Array.isArray(player.inventory)) {
            this.itemRects = [];
            this.contentHeight = 0;
            return;
        }
        const invDict = inventoryToDict(player.inventory);

        const padding = 12;
        const itemSize = 56;
        const itemGap = 4;

        // Rows = item types, Columns = rarities
        const itemTypes = this.getOwnedItemTypes(invDict);
        const rarities = this.getOwnedRarities(invDict);
        const cols = rarities.length;

        if (cols === 0 || itemTypes.length === 0) {
            this.itemRects = [];
            this.contentHeight = padding * 2;
            return;
        }

        // Center the grid
        const gridWidth = cols * itemSize + (cols - 1) * itemGap;
        const startX = padding + (Math.max(0, cssW - padding * 2 - gridWidth)) / 2;

        this.itemRects = [];
        let y = padding;

        for (let row = 0; row < itemTypes.length; row++) {
            const itemType = itemTypes[row];
            for (let col = 0; col < cols; col++) {
                const rarity = rarities[col];
                const count = (invDict[rarity]?.[itemType] as number) || 0;
                if (count > 0) {
                    this.itemRects.push({
                        x: startX + col * (itemSize + itemGap),
                        y: y,
                        w: itemSize,
                        h: itemSize,
                        rarity,
                        itemType,
                        count,
                    });
                } else {
                    // Empty slot placeholder (gray)
                    this.itemRects.push({
                        x: startX + col * (itemSize + itemGap),
                        y: y,
                        w: itemSize,
                        h: itemSize,
                        rarity: '',
                        itemType: '',
                        count: 0,
                    });
                }
            }
            y += itemSize + itemGap;
        }

        this.contentHeight = y + padding;

        const visibleH = Math.max(0, cssH - this.inventoryTop - 14);
        const maxScroll = Math.max(0, this.contentHeight - visibleH);
        if (this.scrollY > maxScroll) this.scrollY = maxScroll;
        if (this.scrollY < 0) this.scrollY = 0;
    }

    // ----- Drawing -----

    public draw() {
        const { dpr, cssW, cssH } = this.syncCanvasSize();

        // Layout the crafting area and get where inventory starts
        const afterCraftY = this.layoutCraftingArea(cssW);

        // Instruction text + separator line area
        const instructionY = afterCraftY;
        this.inventoryTop = instructionY + 30;

        this.layoutInventory(cssW, cssH, this.inventoryTop);

        const ctx = this.ctx;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, cssW, cssH);

        // ----- Panel background + border -----
        const panelRadius = 3;
        const borderW = 4;
        ctx.fillStyle = CanvasCraftingPanel.PANEL_BORDER;
        ctx.beginPath();
        (ctx as any).roundRect(0, 0, cssW, cssH, panelRadius);
        ctx.fill();
        ctx.fillStyle = CanvasCraftingPanel.PANEL_BG;
        ctx.beginPath();
        (ctx as any).roundRect(borderW, borderW, cssW - borderW * 2, cssH - borderW * 2, Math.max(0, panelRadius - 2));
        ctx.fill();

        // ----- Header -----
        this.drawHeader(ctx, cssW);

        // ----- Crafting slots -----
        this.drawCraftingSlots(ctx, cssW);

        // ----- Craft button -----
        this.drawCraftButton(ctx);

        // ----- Success chance text -----
        const cb = this.craftBtnRect;
        ctx.save();
        ctx.font = 'bold 12px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        const chanceText = `${this.successChance}% success chance`;
        const chanceX = cb.x + cb.w / 2;
        const chanceY = cb.y + cb.h + 6;
        ctx.strokeText(chanceText, chanceX, chanceY);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(chanceText, chanceX, chanceY);
        ctx.restore();

        // ----- Instruction text -----
        ctx.save();
        ctx.font = 'bold 13px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText('Combine 5 of the same petal to craft an upgrade', cssW / 2, instructionY + 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Combine 5 of the same petal to craft an upgrade', cssW / 2, instructionY + 4);
        ctx.restore();

        // ----- Scrollable inventory area -----
        const contentTop = this.inventoryTop;
        ctx.save();
        ctx.beginPath();
        ctx.rect(borderW, contentTop, cssW - borderW * 2, cssH - contentTop - borderW);
        ctx.clip();
        ctx.translate(0, contentTop - this.scrollY);

        // Draw inventory items (no separators — grid of rows=types, cols=rarities)
        const now = performance.now();
        for (let i = 0; i < this.itemRects.length; i++) {
            const r = this.itemRects[i];
            if (r.count === 0) {
                // Empty slot — draw gray placeholder
                this.drawEmptySlot(ctx, r);
            } else {
                this.drawItemSlot(ctx, r, i === this.hoverIndex, now);
            }
        }

        ctx.restore(); // unclip & untranslate

        // Scrollbar
        const visibleH = cssH - contentTop - 14;
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

    private drawHeader(ctx: CanvasRenderingContext2D, cssW: number) {
        // Title
        ctx.save();
        ctx.font = 'bold 22px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        ctx.strokeText('Craft', cssW / 2, 14);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Craft', cssW / 2, 14);
        ctx.restore();

        // Close button
        const cb = this.closeBtnRect;
        ctx.save();
        ctx.fillStyle = CanvasCraftingPanel.CLOSE_BORDER;
        ctx.beginPath();
        (ctx as any).roundRect(cb.x, cb.y, cb.w, cb.h, 4);
        ctx.fill();
        ctx.fillStyle = this.closeBtnHovered ? '#e8a0b0' : CanvasCraftingPanel.CLOSE_BG;
        ctx.beginPath();
        (ctx as any).roundRect(cb.x + 2, cb.y + 2, cb.w - 4, cb.h - 4, 3);
        ctx.fill();
        // X glyph
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
    }

    /** Get the center of the crafting circle area (independent of slot count). */
    private getCraftingCenter(cssW: number): { cx: number; cy: number } {
        return { cx: cssW / 2, cy: 50 + 180 / 2 };
    }

    private drawCraftingSlots(ctx: CanvasRenderingContext2D, cssW: number) {
        const now = performance.now();

        // Determine which item to show in slots
        const displayItem = this.animState !== 'idle' ? this.animCraftItem
            : (this.craftingItems.length > 0 ? this.craftingItems[0] : null);
        const hasItems = displayItem !== null;

        // Auto-transition result back to idle
        if (this.animState === 'result') {
            const elapsed = now - this.resultStartTime;
            if (elapsed >= CanvasCraftingPanel.RESULT_DURATION) {
                this.animState = 'idle';
                this.animCraftItem = null;
                this.successResult = null;
                this.spinAngle = 0;
            }
        }

        // Draw the slots
        for (let i = 0; i < this.slotRects.length; i++) {
            const s = this.slotRects[i];
            const radius = 6;
            const bw = 3;

            // On failure result, empty slots (beyond remaining count) use empty color
            const slotHasItem = hasItems && displayItem && !(
                this.animState === 'result' && !this.resultSuccess && i >= this.failRemainingCount
            );
            const bgColor = slotHasItem
                ? (ITEM_RARITY_COLORS[displayItem!.rarity] || CanvasCraftingPanel.SLOT_BG)
                : CanvasCraftingPanel.SLOT_BG;
            const borderColor = slotHasItem
                ? darken(ITEM_RARITY_COLORS[displayItem!.rarity] || CanvasCraftingPanel.SLOT_BORDER, 25)
                : CanvasCraftingPanel.SLOT_BORDER;

            ctx.save();
            ctx.fillStyle = borderColor;
            ctx.beginPath();
            (ctx as any).roundRect(s.x, s.y, s.w, s.h, radius);
            ctx.fill();
            ctx.fillStyle = bgColor;
            ctx.beginPath();
            (ctx as any).roundRect(s.x + bw, s.y + bw, s.w - bw * 2, s.h - bw * 2, Math.max(0, radius - 2));
            ctx.fill();
            ctx.restore();

            // On failure result, only draw petals in the first N remaining slots
            const showIcon = hasItems && displayItem && !(
                this.animState === 'result' && !this.resultSuccess && i >= this.failRemainingCount
            );
            if (showIcon) {
                this.drawCraftingSlotIcon(ctx, s, displayItem!, now);
            }
        }

        const center = this.getCraftingCenter(cssW);

        // Draw multiplier text in center (only when idle with items)
        if (this.animState === 'idle' && this.craftingItems.length > 0) {
            const attempts = Math.floor(this.craftingItems.length / 5);
            if (attempts > 0) {
                ctx.save();
                ctx.font = 'bold 24px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.lineWidth = 4;
                ctx.lineJoin = 'round';
                ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                ctx.strokeText(`x${attempts}`, center.cx, center.cy);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(`x${attempts}`, center.cx, center.cy);
                ctx.restore();
            }
        }

        // Draw success result in center
        if (this.animState === 'result' && this.resultSuccess && this.successResult) {
            const rColor = ITEM_RARITY_COLORS[this.successResult.rarity] || '#7eef6d';
            const resultSize = 60;
            const cx = center.cx;
            const cy = center.cy;

            ctx.save();
            ctx.fillStyle = darken(rColor, 25);
            ctx.beginPath();
            (ctx as any).roundRect(cx - resultSize / 2, cy - resultSize / 2, resultSize, resultSize, 8);
            ctx.fill();
            ctx.fillStyle = rColor;
            ctx.beginPath();
            (ctx as any).roundRect(cx - resultSize / 2 + 3, cy - resultSize / 2 + 3, resultSize - 6, resultSize - 6, 6);
            ctx.fill();

            const iconSize = 36;
            if (this.successResult.petalType) {
                const pc = this.game.getPetalCanvas?.(this.successResult.petalType, this.successResult.rarity, now);
                if (pc) {
                    const stats = this.game.getPetalStats?.(this.successResult.petalType, this.successResult.rarity);
                    drawPetalGroup(ctx, pc, stats?.count, cx, cy, iconSize);
                }
            } else {
                const dataUrl = this.game.getItemSpriteDataUrl?.(this.successResult.type);
                if (dataUrl) {
                    let img = this.imgCache.get(this.successResult.type);
                    if (!img) {
                        img = new Image();
                        img.src = dataUrl;
                        this.imgCache.set(this.successResult.type, img);
                    }
                    if (img.complete && img.naturalWidth > 0) {
                        ctx.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
                    }
                }
            }

            ctx.font = 'bold 18px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            const countText = `x${this.successResult.count}`;
            ctx.strokeText(countText, cx, cy + resultSize / 2 + 4);
            ctx.fillStyle = rColor;
            ctx.fillText(countText, cx, cy + resultSize / 2 + 4);
            ctx.restore();
        }

        // Draw "Failed" text in center on failure result
        if (this.animState === 'result' && !this.resultSuccess) {
            ctx.save();
            ctx.font = 'bold 20px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.strokeText('Failed!', center.cx, center.cy);
            ctx.fillStyle = '#ff4444';
            ctx.fillText('Failed!', center.cx, center.cy);
            ctx.restore();
        }
    }

    private drawCraftingSlotIcon(ctx: CanvasRenderingContext2D, s: { x: number; y: number; w: number; h: number }, item: CraftingItem, time: number) {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        const iconSize = 32;

        if (item.type === 'petal' && item.petalType) {
            const pc = this.game.getPetalCanvas?.(item.petalType, item.rarity, time);
            if (pc) {
                const stats = this.game.getPetalStats?.(item.petalType, item.rarity);
                drawPetalGroup(ctx, pc, stats?.count, cx, cy, iconSize);
            }
        } else {
            const dataUrl = this.game.getItemSpriteDataUrl?.(item.type);
            if (dataUrl) {
                let img = this.imgCache.get(item.type);
                if (!img) {
                    img = new Image();
                    img.src = dataUrl;
                    this.imgCache.set(item.type, img);
                }
                if (img.complete && img.naturalWidth > 0) {
                    ctx.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
                }
            }
        }
    }

    private static readonly RARITY_UPGRADES: Record<string, string> = {
        common: 'uncommon',
        uncommon: 'rare',
        rare: 'epic',
        epic: 'legendary',
        legendary: 'mythic',
        mythic: 'ultra',
        ultra: 'super',
        super: 'unique',
        unique: 'apex',
    };

    private drawCraftButton(ctx: CanvasRenderingContext2D) {
        const b = this.craftBtnRect;
        const radius = 6;
        const bw = 3;

        // Use next rarity color when items are present
        const currentRarity = this.craftingItems.length > 0
            ? this.craftingItems[0].rarity
            : (this.animCraftItem?.rarity || '');
        const nextRarity = CanvasCraftingPanel.RARITY_UPGRADES[currentRarity] || '';
        const nextColor = ITEM_RARITY_COLORS[nextRarity] || '';

        const btnBg = nextColor || CanvasCraftingPanel.CRAFT_BTN_BG;
        const btnBorder = nextColor ? darken(nextColor, 25) : CanvasCraftingPanel.CRAFT_BTN_BORDER;
        const btnHover = nextColor ? darken(nextColor, 10) : '#9a8a7a';

        ctx.save();
        ctx.fillStyle = btnBorder;
        ctx.beginPath();
        (ctx as any).roundRect(b.x, b.y, b.w, b.h, radius);
        ctx.fill();
        ctx.fillStyle = this.craftBtnHovered ? btnHover : btnBg;
        ctx.beginPath();
        (ctx as any).roundRect(b.x + bw, b.y + bw, b.w - bw * 2, b.h - bw * 2, Math.max(0, radius - 2));
        ctx.fill();

        // Button text
        ctx.font = 'bold 15px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText('Craft', b.x + b.w / 2, b.y + b.h / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Craft', b.x + b.w / 2, b.y + b.h / 2);
        ctx.restore();
    }

    private drawEmptySlot(ctx: CanvasRenderingContext2D, r: ItemRect) {
        const radius = 6;
        const bw = 3;
        ctx.save();
        ctx.fillStyle = CanvasCraftingPanel.SLOT_BORDER;
        ctx.beginPath();
        (ctx as any).roundRect(r.x, r.y, r.w, r.h, radius);
        ctx.fill();
        ctx.fillStyle = CanvasCraftingPanel.SLOT_BG;
        ctx.beginPath();
        (ctx as any).roundRect(r.x + bw, r.y + bw, r.w - bw * 2, r.h - bw * 2, Math.max(0, radius - 2));
        ctx.fill();
        ctx.restore();
    }

    private drawItemSlot(ctx: CanvasRenderingContext2D, r: ItemRect, hovered: boolean, time: number) {
        const baseColor = ITEM_RARITY_COLORS[r.rarity] || '#dc7e92';
        const borderColor = darken(baseColor, 25);
        const radius = 6;
        const borderW = 3;

        // Outer rounded border + inner fill
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

        // Item icon
        this.drawItemIcon(ctx, r, time);

        // Item name
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

        // Count badge
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
        const cy = r.y + r.h * 0.4;
        const iconSize = 32;
        if (r.itemType.startsWith('petal_')) {
            const petalType = r.itemType.replace('petal_', '');
            const pc = this.game.getPetalCanvas?.(petalType, r.rarity, time);
            if (pc) {
                const stats = this.game.getPetalStats?.(petalType, r.rarity);
                drawPetalGroup(ctx, pc, stats?.count, cx, cy, iconSize);
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

    // ----- Input handlers -----

    private toLocal(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private pointInRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    private handleMouseMove = (e: MouseEvent) => {
        const { x, y } = this.toLocal(e);
        this.closeBtnHovered = this.pointInRect(x, y, this.closeBtnRect);
        this.craftBtnHovered = this.pointInRect(x, y, this.craftBtnRect);

        // Hit test inventory items
        const hit = this.hitTestInventory(e.clientX, e.clientY);
        const newIdx = hit ? this.findItemIndex(hit.rarity, hit.itemType) : -1;
        if (newIdx !== this.hoverIndex) {
            this.hoverIndex = newIdx;
        }
    };

    private handleMouseLeave = () => {
        this.hoverIndex = -1;
        this.closeBtnHovered = false;
        this.craftBtnHovered = false;
    };

    private handleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const { x, y } = this.toLocal(e);

        // Close button
        if (this.pointInRect(x, y, this.closeBtnRect)) {
            e.preventDefault();
            if (this.onClose) this.onClose();
            return;
        }

        // Craft button
        if (this.pointInRect(x, y, this.craftBtnRect)) {
            e.preventDefault();
            if (this.onCraft) this.onCraft();
            return;
        }

        // Crafting slots — click to remove a batch
        if (this.animState === 'idle') {
            for (const s of this.slotRects) {
                if (this.pointInRect(x, y, s)) {
                    e.preventDefault();
                    if (this.onSlotClick) this.onSlotClick();
                    return;
                }
            }
        }

        // Inventory items
        const hit = this.hitTestInventory(e.clientX, e.clientY);
        if (hit && this.onItemClick) {
            e.preventDefault();
            this.onItemClick(hit.rarity, hit.itemType, e.shiftKey);
        }
    };

    private handleWheel = (e: WheelEvent) => {
        // Only scroll if the mouse is in the inventory area
        const { y } = this.toLocal(e);
        if (y < this.inventoryTop) return;
        e.preventDefault();
        this.scrollY += e.deltaY;
        const rect = this.canvas.getBoundingClientRect();
        const visibleH = Math.max(0, rect.height - this.inventoryTop - 14);
        const maxScroll = Math.max(0, this.contentHeight - visibleH);
        if (this.scrollY < 0) this.scrollY = 0;
        if (this.scrollY > maxScroll) this.scrollY = maxScroll;
    };

    private hitTestInventory(clientX: number, clientY: number): { rarity: string; itemType: string } | null {
        const rect = this.canvas.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return null;
        }
        if (clientY - rect.top < this.inventoryTop) return null;
        const x = clientX - rect.left;
        const y = (clientY - rect.top) - this.inventoryTop + this.scrollY;
        for (const r of this.itemRects) {
            if (r.count > 0 && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                return { rarity: r.rarity, itemType: r.itemType };
            }
        }
        return null;
    }

    private findItemIndex(rarity: string, itemType: string): number {
        for (let i = 0; i < this.itemRects.length; i++) {
            if (this.itemRects[i].rarity === rarity && this.itemRects[i].itemType === itemType) return i;
        }
        return -1;
    }
}
