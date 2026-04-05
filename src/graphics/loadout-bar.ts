// Canvas-based loadout bar inspired by gardn/Client/Ui/InGame/Loadout
import { Item } from '../item';

interface SlotRect { x: number; y: number; w: number; h: number }

interface GameAPI {
    canvas: HTMLCanvasElement;
    getLocalPlayer(): any;
    getPetalCanvas?(petalType: string, rarity: string, time?: number): HTMLCanvasElement | null;
    getItemSpriteDataUrl?(itemType: string): string | null;
    inventoryManager: any;
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

    // Keyboard-selected slot (T to cycle) — simplified: only used as an indicator
    public keySelected: number = -1;

    // Shown-with-animation (slide-in/out)
    private slideAnim: number = 0; // 0..1

    constructor(game: GameAPI) {
        this.game = game;
    }

    public show() { this.visible = true; }
    public hide() { this.visible = false; }
    public isVisible() { return this.visible; }

    public layout(canvasWidth: number, canvasHeight: number) {
        // Sizes/gaps mirror gardn's HContainer layouts
        //   Primary HContainer(children, margin=5,  gap=20) — slot 70x70
        //   Secondary HContainer(children, margin=10, gap=15) — slot 50x50
        //   VContainer stacks primary above secondary with 0/0 margins
        //   Trash is appended to the secondary row (50x50, #cf8888) with a [T] label to its right
        const cols = LOADOUT_PRIMARY_COUNT;
        const primarySize = 70;
        const secondarySize = 50;
        const primaryGap = 20;
        const secondaryGap = 15;
        const primaryMargin = 5;   // HContainer vertical padding for primary row
        const secondaryMargin = 10; // HContainer vertical padding for secondary row

        const primaryRowW = cols * primarySize + (cols - 1) * primaryGap;
        // Secondary row width includes the trash slot appended with gap after the last slot
        const secondaryRowW = cols * secondarySize + (cols - 1) * secondaryGap + secondaryGap + secondarySize;

        const primaryStartX = (canvasWidth - primaryRowW) / 2;
        const secondaryStartX = (canvasWidth - secondaryRowW) / 2;

        // Bottom anchor: leave 34px mobile/keyboard padding + secondary margin
        const bottomPad = 34 + secondaryMargin;
        const secondaryY = canvasHeight - bottomPad - secondarySize;
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

    /** Set keyboard-highlight position (use -1 to clear). */
    public setKeySelected(i: number) { this.keySelected = i; }

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

    public draw(ctx: CanvasRenderingContext2D) {
        const player = this.game.getLocalPlayer();
        if (!player || !player.loadout) return;
        this.layout(ctx.canvas.width, ctx.canvas.height);

        // Slide animation
        const target = this.visible ? 1 : 0;
        this.slideAnim += (target - this.slideAnim) * 0.2;
        if (Math.abs(this.slideAnim - target) < 0.005) this.slideAnim = target;
        if (this.slideAnim <= 0.005) return;

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
            this.drawSlot(ctx, slot, '#eeeeee', false, this.hoveredSlot === i);

            // Gardn draws [X] key labels above each primary slot (position < loadout_count),
            // translate(0, -height/2 - 15) → 15px above the top edge, font size 16
            if (i < LOADOUT_PRIMARY_COUNT) {
                const label = `[${keyBindings[i]}]`;
                const lx = slot.x + slot.w / 2;
                const ly = slot.y - 15;
                this.drawKeyLabel(ctx, label, lx, ly, 16, 'center');
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
            if (pc) ctx.drawImage(pc, -30, -30, 60, 60);
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
