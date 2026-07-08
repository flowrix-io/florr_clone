// Canvas-based loadout bar inspired by gardn/Client/Ui/InGame/Loadout
import { Item } from '../item';
import { ITEM_RARITY_COLORS } from '../petals';
import { drawPetalGroup } from './petal-icon';

interface SlotRect { x: number; y: number; w: number; h: number }

interface GameAPI {
    canvas: HTMLCanvasElement;
    getLocalPlayer(): any;
    getPetalCanvas?(petalType: string, rarity: string, time?: number): HTMLCanvasElement | null;
    getPetalStats?(petalType: string, rarity: string): any;
    getItemSpriteDataUrl?(itemType: string): string | null;
    inventoryManager: any;
}


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

export const LOADOUT_PRIMARY_COUNT = 10;
export const LOADOUT_SECONDARY_COUNT = 10;
export const LOADOUT_SLOT_COUNT = LOADOUT_PRIMARY_COUNT + LOADOUT_SECONDARY_COUNT;

export class CanvasLoadoutBar {
    private game: GameAPI;
    private scale: number;
    private slots: SlotRect[] = [];
    private trash: SlotRect = { x: 0, y: 0, w: 0, h: 0 };
    private visible: boolean = false;

    // Local cooldown tracking for visual sweep animation (keyed by slot index)
    private cooldownEnd: Map<number, number> = new Map();
    private cooldownStart: Map<number, number> = new Map();
    private lastOnCooldown: Map<number, boolean> = new Map();

    // Hover / drag state
    private hoveredSlot: number = -1; // -1 none, 0..N-1 slot, N trash
    // Slot currently being dragged by the user (source) — hidden from its home position while dragging
    public draggingSlotIndex: number = -1;
    public dragScreenX: number = 0;
    public dragScreenY: number = 0;

    // Secondary-row selection driven by Q/E. -1 = none, else 0..(LOADOUT_PRIMARY_COUNT-1)
    public selectedSecondary: number = -1;
    private lastSelectTime: number = 0;
    private readonly SELECT_TIMEOUT_MS = 5000;

    // Shown-with-animation (slide-in/out)
    private slideAnim: number = 0; // 0..1

    constructor(game: GameAPI, scale: number = 1) {
        this.game = game;
        this.scale = scale;
    }

    public show() { this.visible = true; }
    public hide() { this.visible = false; }
    public isVisible() { return this.visible; }

    /**
     * Lay out slot rectangles. By default the layout uses (0, 0, canvasWidth,
     * canvasHeight) — i.e. centered horizontally on the canvas, anchored to the
     * canvas bottom. Pass originX/originY to render into a sub-rect (used by
     * the title screen, where the loadout bar shares the full-screen title
     * canvas with everything else and lives in a custom region).
     */
    public layout(canvasWidth: number, canvasHeight: number, originX: number = 0, originY: number = 0) {
        // Sizes/gaps mirror gardn's HContainer layouts
        //   Primary HContainer(children, margin=5,  gap=20) — slot 70x70
        //   Secondary HContainer(children, margin=10, gap=15) — slot 50x50
        //   VContainer stacks primary above secondary with 0/0 margins
        //   Trash is appended to the secondary row (50x50, #cf8888) with a [T] label to its right
        const cols = LOADOUT_PRIMARY_COUNT;
        const s = this.scale;
        const primarySize = 70 * s;
        const secondarySize = 50 * s;
        const primaryGap = 20 * s;
        const secondaryGap = 15 * s;
        const primaryMargin = 5 * s;   // HContainer vertical padding for primary row
        const secondaryMargin = 10 * s; // HContainer vertical padding for secondary row

        const primaryRowW = cols * primarySize + (cols - 1) * primaryGap;
        // Secondary row width includes the trash slot appended with gap after the last slot
        const secondaryRowW = cols * secondarySize + (cols - 1) * secondaryGap + secondaryGap + secondarySize;

        const primaryStartX = originX + (canvasWidth - primaryRowW) / 2;
        const secondaryStartX = originX + (canvasWidth - secondaryRowW) / 2;

        // Bottom anchor: leave 34px mobile/keyboard padding + secondary margin
        const bottomPad = 34 + secondaryMargin;
        const secondaryY = originY + canvasHeight - bottomPad - secondarySize;
        const primaryY = secondaryY - secondaryMargin - primaryMargin - primarySize;

        this.slots = [];
        // Primary row (top) — slots 0..9
        for (let i = 0; i < cols; i++) {
            this.slots.push({
                x: primaryStartX + i * (primarySize + primaryGap),
                y: primaryY,
                w: primarySize,
                h: primarySize
            });
        }
        // Secondary row (bottom) — slots 10..19
        for (let i = 0; i < cols; i++) {
            this.slots.push({
                x: secondaryStartX + i * (secondarySize + secondaryGap),
                y: secondaryY,
                w: secondarySize,
                h: secondarySize
            });
        }
        // Trash slot at the end of the secondary row, same size as secondary
        this.trash = {
            x: secondaryStartX + cols * (secondarySize + secondaryGap),
            y: secondaryY,
            w: secondarySize,
            h: secondarySize
        };
    }

    /** Total vertical footprint from the bottom of the canvas (both rows +
     *  margins/padding), mirroring the math in layout(). Lets other bottom-
     *  anchored HUD elements (e.g. MobileControls) sit above the bar instead
     *  of guessing its height. */
    public getTotalHeight(): number {
        const s = this.scale;
        const primarySize = 70 * s;
        const secondarySize = 50 * s;
        const primaryMargin = 5 * s;
        const secondaryMargin = 10 * s;
        const bottomPad = 34 + secondaryMargin;
        return bottomPad + secondarySize + secondaryMargin + primaryMargin + primarySize;
    }

    /** Hit-test screen coordinates against slots and trash. Returns -1 / 0..N-1 / N (trash). */
    public hitTest(screenX: number, screenY: number): number {
        for (let i = 0; i < this.slots.length; i++) {
            const s = this.slots[i];
            if (screenX >= s.x && screenX <= s.x + s.w && screenY >= s.y && screenY <= s.y + s.h) {
                return i;
            }
        }
        const t = this.trash;
        if (screenX >= t.x && screenX <= t.x + t.w && screenY >= t.y && screenY <= t.y + t.h) {
            return LOADOUT_SLOT_COUNT; // trash
        }
        return -1;
    }

    /** Notify bar that a slot entered cooldown for the given duration. */
    public triggerCooldown(slotIndex: number, durationMs: number) {
        const now = performance.now();
        this.cooldownStart.set(slotIndex, now);
        this.cooldownEnd.set(slotIndex, now + durationMs);
    }

    /** Clear secondary-row selection. */
    public clearSecondarySelection() {
        this.selectedSecondary = -1;
    }

    /** Advance secondary selection to next non-empty slot (E key). */
    public cycleSecondaryForward() {
        const player = this.game.getLocalPlayer();
        const loadout: (Item | null)[] | undefined = player?.loadout;
        if (!loadout) return;
        this.lastSelectTime = performance.now();
        const start = this.selectedSecondary;
        let cur = start === -1 ? -1 : start;
        for (let i = 0; i < LOADOUT_PRIMARY_COUNT; i++) {
            cur = (cur + 1) % LOADOUT_PRIMARY_COUNT;
            const item = loadout[LOADOUT_PRIMARY_COUNT + cur];
            if (item) {
                this.selectedSecondary = cur;
                return;
            }
        }
        // No non-empty secondary slots
        this.selectedSecondary = -1;
    }

    /** Move secondary selection back to previous non-empty slot (Q key). */
    public cycleSecondaryBackward() {
        const player = this.game.getLocalPlayer();
        const loadout: (Item | null)[] | undefined = player?.loadout;
        if (!loadout) return;
        this.lastSelectTime = performance.now();
        if (this.selectedSecondary === -1) { this.cycleSecondaryForward(); return; }
        let cur = this.selectedSecondary;
        for (let i = 0; i < LOADOUT_PRIMARY_COUNT; i++) {
            cur = (cur - 1 + LOADOUT_PRIMARY_COUNT) % LOADOUT_PRIMARY_COUNT;
            const item = loadout[LOADOUT_PRIMARY_COUNT + cur];
            if (item) {
                this.selectedSecondary = cur;
                return;
            }
        }
        this.selectedSecondary = -1;
    }

    /** Tick selection timeout; call each frame. */
    private updateSecondarySelectionTimeout() {
        if (this.selectedSecondary === -1) return;
        if (performance.now() - this.lastSelectTime > this.SELECT_TIMEOUT_MS) {
            this.selectedSecondary = -1;
        }
    }

    public setHover(screenX: number, screenY: number) {
        this.hoveredSlot = this.hitTest(screenX, screenY);
    }

    public setDragPos(screenX: number, screenY: number) {
        this.dragScreenX = screenX;
        this.dragScreenY = screenY;
    }

    public beginDrag(slotIndex: number, screenX: number, screenY: number) {
        this.draggingSlotIndex = slotIndex;
        this.dragScreenX = screenX;
        this.dragScreenY = screenY;
    }

    public endDrag() {
        this.draggingSlotIndex = -1;
    }

    public draw(ctx: CanvasRenderingContext2D, bounds?: { x: number; y: number; width: number; height: number }) {
        const player = this.game.getLocalPlayer();
        if (!player || !player.loadout) return;
        if (bounds) {
            this.layout(bounds.width, bounds.height, bounds.x, bounds.y);
        } else {
            this.layout(ctx.canvas.width, ctx.canvas.height);
        }

        // Slide animation
        const target = this.visible ? 1 : 0;
        this.slideAnim += (target - this.slideAnim) * 0.2;
        if (Math.abs(this.slideAnim - target) < 0.005) this.slideAnim = target;
        if (this.slideAnim <= 0.005) return;

        this.updateSecondarySelectionTimeout();

        // Sync client-side cooldown with server-driven onCooldown flag to keep visuals aligned
        for (let i = 0; i < LOADOUT_SLOT_COUNT; i++) {
            const item: Item | null = player.loadout[i] || null;
            const on = !!(item && item.onCooldown);
            const prev = this.lastOnCooldown.get(i) === true;
            if (on && !prev) {
                // Entered cooldown via server; use existing timer if set, else 10s default
                if (!this.cooldownEnd.has(i)) this.triggerCooldown(i, 10000);
            } else if (!on && prev) {
                // Cleared by server — end animation
                this.cooldownEnd.delete(i);
                this.cooldownStart.delete(i);
            }
            this.lastOnCooldown.set(i, on);
        }

        ctx.save();
        // Slide-in from below
        const slideOff = (1 - this.slideAnim) * 120;
        ctx.translate(0, slideOff);

        const keyBindings = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

        // Draw trash slot (red) + [T] key hint to its right (gardn: translate(width/2 + 16, 0))
        this.drawSlot(ctx, this.trash, '#cf8888', true, this.hoveredSlot === LOADOUT_SLOT_COUNT);
        this.drawKeyLabel(ctx, '[T]', this.trash.x + this.trash.w + 16, this.trash.y + this.trash.h / 2, 16, 'left');

        // "Delete" text inside trash — shown only when a drag is in progress (matches gardn delete_text_opacity)
        const isDragging = this.draggingSlotIndex >= 0
            || !!(this.game.inventoryManager && (this.game.inventoryManager as any).isDragging);
        if (isDragging) {
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.font = `bold ${Math.round(this.trash.h / 4)}px Ubuntu, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const cx = this.trash.x + this.trash.w / 2;
            const cy = this.trash.y + this.trash.h / 2;
            ctx.strokeText('Delete', cx, cy);
            ctx.fillText('Delete', cx, cy);
            ctx.restore();
        }

        // Draw each slot background
        for (let i = 0; i < LOADOUT_SLOT_COUNT; i++) {
            const slot = this.slots[i];
            const isSelectedSecondary = i >= LOADOUT_PRIMARY_COUNT
                && i - LOADOUT_PRIMARY_COUNT === this.selectedSecondary;
            this.drawSlot(ctx, slot, '#eeeeee', false, this.hoveredSlot === i || isSelectedSecondary);

            // Gardn draws [X] key labels above each primary slot (position < loadout_count),
            // translate(0, -height/2 - 15) → 15px above the top edge, font size 16
            if (i < LOADOUT_PRIMARY_COUNT) {
                const label = `[${keyBindings[i]}]`;
                const lx = slot.x + slot.w / 2;
                const ly = slot.y - 15;
                this.drawKeyLabel(ctx, label, lx, ly, 16, 'center');
            }
        }

        // Draw selection ring around selected secondary slot
        if (this.selectedSecondary >= 0) {
            const slot = this.slots[LOADOUT_PRIMARY_COUNT + this.selectedSecondary];
            if (slot) {
                const wobble = Math.sin(performance.now() / 150) * 0.06;
                ctx.save();
                const cx = slot.x + slot.w / 2;
                const cy = slot.y + slot.h / 2;
                ctx.translate(cx, cy);
                ctx.rotate(wobble);
                const pad = 6;
                ctx.lineWidth = 4;
                ctx.strokeStyle = '#ffffff';
                ctx.beginPath();
                (ctx as any).roundRect(-slot.w / 2 - pad, -slot.h / 2 - pad, slot.w + pad * 2, slot.h + pad * 2, slot.w / 20 + 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        // Draw petal icons (skip the one being dragged)
        for (let i = 0; i < LOADOUT_SLOT_COUNT; i++) {
            if (i === this.draggingSlotIndex) continue;
            const item: Item | null = player.loadout[i] || null;
            if (!item) continue;
            const slot = this.slots[i];
            this.drawItemInSlot(ctx, slot, item, i);
        }

        // Dragged petal is drawn by the DOM overlay drag canvas (document-level).

        ctx.restore();
    }

    private drawKeyLabel(
        ctx: CanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        size: number,
        align: 'left' | 'center' | 'right'
    ) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.font = `bold ${size}px Ubuntu, sans-serif`;
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    private drawSlot(ctx: CanvasRenderingContext2D, rect: SlotRect, fill: string, _isTrash: boolean, hovered: boolean) {
        // Matches gardn Element::on_render: darker rounded outer fill + sharp inner fill
        // (rather than a fill + stroke). line_width = w/12, round_radius = w/20.
        const lineW = rect.w / 12;
        const radius = rect.w / 20;
        const dark = darken(fill, 20);
        ctx.save();
        // Outer rounded fill (darker)
        ctx.fillStyle = dark;
        ctx.beginPath();
        (ctx as any).roundRect(rect.x, rect.y, rect.w, rect.h, radius);
        ctx.fill();
        // Inner sharp fill inset by line_width
        ctx.fillStyle = fill;
        ctx.fillRect(rect.x + lineW, rect.y + lineW, rect.w - 2 * lineW, rect.h - 2 * lineW);
        if (hovered) {
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(rect.x + lineW, rect.y + lineW, rect.w - 2 * lineW, rect.h - 2 * lineW);
        }
        ctx.restore();
    }

    private drawItemInSlot(ctx: CanvasRenderingContext2D, rect: SlotRect, item: Item, slotIndex: number) {
        // Gardn's draw_loadout_background is designed at 60x60. The petal element's width is
        // animated toward the parent slot's width, and scaled by width/60 at render. Mirror that.
        const rarity = item.rarity && ITEM_RARITY_COLORS[item.rarity] ? item.rarity : 'common';
        const c = ITEM_RARITY_COLORS[rarity];
        const cDark = darken(c, 30);

        const scale = rect.w / 60;
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        // Outer rounded rect (60x60, radius 3 at design units) — darker rarity shade
        ctx.fillStyle = cDark;
        ctx.beginPath();
        (ctx as any).roundRect(-30, -30, 60, 60, 3);
        ctx.fill();

        // Inner sharp rect (50x50) — base rarity color
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.rect(-25, -25, 50, 50);
        ctx.fill();

        // Clip subsequent drawing to the inner rect
        ctx.save();
        ctx.beginPath();
        ctx.rect(-25, -25, 50, 50);
        ctx.clip();

        // Cooldown pie wedge (gardn: partial_arc radius 90, swept by reload)
        if (slotIndex >= 0) {
            const endAt = this.cooldownEnd.get(slotIndex);
            const startAt = this.cooldownStart.get(slotIndex);
            if (endAt !== undefined && startAt !== undefined) {
                const now = performance.now();
                const total = Math.max(1, endAt - startAt);
                const t = (now - startAt) / total;
                if (t >= 1) {
                    this.cooldownEnd.delete(slotIndex);
                    this.cooldownStart.delete(slotIndex);
                } else {
                    // Gardn's smootherstep easing on (1 - reload)
                    let rld = 1 - t;
                    rld = rld * rld * rld * (rld * (6.0 * rld - 15.0) + 10.0);
                    const startA = -Math.PI / 2 - rld * Math.PI * 10;
                    const endA = -Math.PI / 2 - rld * Math.PI * 8;
                    ctx.fillStyle = 'rgba(0,0,0,0.25)';
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    // partial_arc with anticlockwise=false → canvas arc with anticlockwise=true since gardn flips Y
                    ctx.arc(0, 0, 90, startA, endA, false);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        }

        // Petal icon: gardn translates(0, -5) then scales 0.833 (50/60)
        ctx.save();
        ctx.translate(0, -5);
        ctx.scale(0.833, 0.833);
        // Draw at design-size 60x60 centered on origin
        if (item.type === 'petal' && item.petalType && item.rarity) {
            const pc = this.game.getPetalCanvas?.(item.petalType, item.rarity, performance.now());
            if (pc) {
                const stats = this.game.getPetalStats?.(item.petalType, item.rarity);
                drawPetalGroup(ctx, pc, stats?.count, 0, 0, 60);
            }
        } else {
            const dataUrl = this.game.getItemSpriteDataUrl?.(item.type);
            if (dataUrl) {
                let img = (this as any)._iconCache?.[item.type] as HTMLImageElement | undefined;
                if (!img) {
                    img = new Image();
                    img.src = dataUrl;
                    ((this as any)._iconCache ||= {})[item.type] = img;
                }
                if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, -30, -30, 60, 60);
            }
        }
        ctx.restore();

        // Petal name text (gardn: translate(0,20), text_width auto-fit to 50px)
        if (item.type === 'petal' && item.petalType) {
            const name = this.formatPetalName(item.petalType);
            // Fit text to ~50 units wide in design coords; default size = 12
            ctx.font = 'bold 12px Ubuntu, sans-serif';
            const measured = ctx.measureText(name).width;
            const fontSize = measured > 0 && measured > 50 ? Math.max(6, (12 * 50) / measured) : 12;
            ctx.font = `bold ${fontSize.toFixed(2)}px Ubuntu, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3 / scale;
            ctx.strokeText(name, 0, 20);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(name, 0, 20);
        }

        ctx.restore(); // unclip
        ctx.restore(); // undo translate/scale

        // Health bar for petals (outside gardn but we keep it; drawn in screen coords under the slot)
        if (item.health !== undefined && item.maxHealth !== undefined && item.maxHealth > 0 && slotIndex >= 0) {
            const pct = Math.max(0, Math.min(1, item.health / item.maxHealth));
            const barH = 3;
            const barY = rect.y + rect.h - barH - 2;
            ctx.save();
            ctx.fillStyle = 'rgba(255,0,0,0.5)';
            ctx.fillRect(rect.x + 4, barY, rect.w - 8, barH);
            ctx.fillStyle = 'rgba(0,255,0,0.85)';
            ctx.fillRect(rect.x + 4, barY, (rect.w - 8) * pct, barH);
            ctx.restore();
        }
    }

    private formatPetalName(petalType: string): string {
        // Turn "dandelion_petal" / "rose" into "Dandelion Petal" / "Rose"
        return petalType
            .split(/[_\s]+/)
            .filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    }
}
