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

export const LOADOUT_SLOT_COUNT = 10;

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
        const slotSize = 70;
        const gap = 5;
        const count = LOADOUT_SLOT_COUNT;
        const totalW = count * slotSize + (count - 1) * gap;
        const startX = (canvasWidth - totalW) / 2;
        const y = canvasHeight - 20 - slotSize;
        this.slots = [];
        for (let i = 0; i < count; i++) {
            this.slots.push({ x: startX + i * (slotSize + gap), y, w: slotSize, h: slotSize });
        }
        this.trash = { x: startX + totalW + 20, y: y + 10, w: 50, h: 50 };
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

        // Draw trash slot first (red)
        this.drawSlot(ctx, this.trash, '#cf8888', true, this.hoveredSlot === LOADOUT_SLOT_COUNT);

        // Key hints above trash
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.font = 'bold 14px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const trashLbl = 'Delete';
        ctx.strokeText(trashLbl, this.trash.x + this.trash.w / 2, this.trash.y + this.trash.h / 2);
        ctx.fillText(trashLbl, this.trash.x + this.trash.w / 2, this.trash.y + this.trash.h / 2);
        ctx.restore();

        const keyBindings = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

        // Draw each slot background
        for (let i = 0; i < LOADOUT_SLOT_COUNT; i++) {
            const slot = this.slots[i];
            this.drawSlot(ctx, slot, '#eeeeee', false, this.hoveredSlot === i);

            // Key binding label above slot
            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.font = 'bold 14px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const label = `[${keyBindings[i]}]`;
            const lx = slot.x + slot.w / 2;
            const ly = slot.y - 14;
            ctx.strokeText(label, lx, ly);
            ctx.fillText(label, lx, ly);
            ctx.restore();
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

    private drawSlot(ctx: CanvasRenderingContext2D, rect: SlotRect, fill: string, isTrash: boolean, hovered: boolean) {
        const r = Math.max(3, rect.w / 20);
        ctx.save();
        ctx.beginPath();
        (ctx as any).roundRect(rect.x, rect.y, rect.w, rect.h, r);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = rect.w / 12;
        ctx.strokeStyle = darken(fill, 30);
        ctx.stroke();
        if (hovered) {
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        ctx.restore();
    }

    private drawItemInSlot(ctx: CanvasRenderingContext2D, rect: SlotRect, item: Item, slotIndex: number) {
        // Rarity-colored inset
        const r = Math.max(3, rect.w / 20);
        if (item.rarity && ITEM_RARITY_COLORS[item.rarity]) {
            const c = ITEM_RARITY_COLORS[item.rarity];
            ctx.save();
            ctx.beginPath();
            (ctx as any).roundRect(rect.x, rect.y, rect.w, rect.h, r);
            ctx.fillStyle = c;
            ctx.fill();
            ctx.lineWidth = rect.w / 12;
            ctx.strokeStyle = darken(c, 30);
            ctx.stroke();
            ctx.restore();
        }

        // Draw petal or item sprite
        const iconSize = rect.w * 0.6;
        const ix = rect.x + (rect.w - iconSize) / 2;
        const iy = rect.y + (rect.h - iconSize) / 2;

        if (item.type === 'petal' && item.petalType && item.rarity) {
            const pc = this.game.getPetalCanvas?.(item.petalType, item.rarity, performance.now());
            if (pc) {
                ctx.drawImage(pc, ix, iy, iconSize, iconSize);
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
                if (img.complete && img.naturalWidth > 0) {
                    ctx.drawImage(img, ix, iy, iconSize, iconSize);
                }
            }
        }

        // Health bar for petals
        if (item.health !== undefined && item.maxHealth !== undefined && item.maxHealth > 0 && slotIndex >= 0) {
            const pct = Math.max(0, Math.min(1, item.health / item.maxHealth));
            const barH = 4;
            const barY = rect.y + rect.h - barH - 2;
            ctx.save();
            ctx.fillStyle = 'rgba(255,0,0,0.5)';
            ctx.fillRect(rect.x + 4, barY, rect.w - 8, barH);
            ctx.fillStyle = 'rgba(0,255,0,0.8)';
            ctx.fillRect(rect.x + 4, barY, (rect.w - 8) * pct, barH);
            ctx.restore();
        }

        // Cooldown overlay (vertical sweep similar to existing CSS animation)
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
                    const overlayH = rect.h * (1 - t);
                    ctx.save();
                    ctx.beginPath();
                    (ctx as any).roundRect(rect.x, rect.y, rect.w, rect.h, r);
                    ctx.clip();
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(rect.x, rect.y, rect.w, overlayH);
                    ctx.restore();
                }
            }
        }
    }
}
