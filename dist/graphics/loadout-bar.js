"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanvasLoadoutBar = exports.LOADOUT_SLOT_COUNT = void 0;
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
exports.LOADOUT_SLOT_COUNT = 10;
class CanvasLoadoutBar {
    constructor(game) {
        this.slots = [];
        this.trash = { x: 0, y: 0, w: 0, h: 0 };
        this.visible = false;
        // Local cooldown tracking for visual sweep animation (keyed by slot index)
        this.cooldownEnd = new Map();
        this.cooldownStart = new Map();
        this.lastOnCooldown = new Map();
        // Hover / drag state
        this.hoveredSlot = -1; // -1 none, 0..N-1 slot, N trash
        // Slot currently being dragged by the user (source) — hidden from its home position while dragging
        this.draggingSlotIndex = -1;
        this.dragScreenX = 0;
        this.dragScreenY = 0;
        // Keyboard-selected slot (T to cycle) — simplified: only used as an indicator
        this.keySelected = -1;
        // Shown-with-animation (slide-in/out)
        this.slideAnim = 0; // 0..1
        this.game = game;
    }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    isVisible() { return this.visible; }
    layout(canvasWidth, canvasHeight) {
        const slotSize = 70;
        const gap = 5;
        const count = exports.LOADOUT_SLOT_COUNT;
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
    hitTest(screenX, screenY) {
        for (let i = 0; i < this.slots.length; i++) {
            const s = this.slots[i];
            if (screenX >= s.x && screenX <= s.x + s.w && screenY >= s.y && screenY <= s.y + s.h) {
                return i;
            }
        }
        const t = this.trash;
        if (screenX >= t.x && screenX <= t.x + t.w && screenY >= t.y && screenY <= t.y + t.h) {
            return exports.LOADOUT_SLOT_COUNT; // trash
        }
        return -1;
    }
    /** Notify bar that a slot entered cooldown for the given duration. */
    triggerCooldown(slotIndex, durationMs) {
        const now = performance.now();
        this.cooldownStart.set(slotIndex, now);
        this.cooldownEnd.set(slotIndex, now + durationMs);
    }
    /** Set keyboard-highlight position (use -1 to clear). */
    setKeySelected(i) { this.keySelected = i; }
    setHover(screenX, screenY) {
        this.hoveredSlot = this.hitTest(screenX, screenY);
    }
    setDragPos(screenX, screenY) {
        this.dragScreenX = screenX;
        this.dragScreenY = screenY;
    }
    beginDrag(slotIndex, screenX, screenY) {
        this.draggingSlotIndex = slotIndex;
        this.dragScreenX = screenX;
        this.dragScreenY = screenY;
    }
    endDrag() {
        this.draggingSlotIndex = -1;
    }
    draw(ctx) {
        const player = this.game.getLocalPlayer();
        if (!player || !player.loadout)
            return;
        this.layout(ctx.canvas.width, ctx.canvas.height);
        // Slide animation
        const target = this.visible ? 1 : 0;
        this.slideAnim += (target - this.slideAnim) * 0.2;
        if (Math.abs(this.slideAnim - target) < 0.005)
            this.slideAnim = target;
        if (this.slideAnim <= 0.005)
            return;
        // Sync client-side cooldown with server-driven onCooldown flag to keep visuals aligned
        for (let i = 0; i < exports.LOADOUT_SLOT_COUNT; i++) {
            const item = player.loadout[i] || null;
            const on = !!(item && item.onCooldown);
            const prev = this.lastOnCooldown.get(i) === true;
            if (on && !prev) {
                // Entered cooldown via server; use existing timer if set, else 10s default
                if (!this.cooldownEnd.has(i))
                    this.triggerCooldown(i, 10000);
            }
            else if (!on && prev) {
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
        this.drawSlot(ctx, this.trash, '#cf8888', true, this.hoveredSlot === exports.LOADOUT_SLOT_COUNT);
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
        for (let i = 0; i < exports.LOADOUT_SLOT_COUNT; i++) {
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
        for (let i = 0; i < exports.LOADOUT_SLOT_COUNT; i++) {
            if (i === this.draggingSlotIndex)
                continue;
            const item = player.loadout[i] || null;
            if (!item)
                continue;
            const slot = this.slots[i];
            this.drawItemInSlot(ctx, slot, item, i);
        }
        // Dragged petal is drawn by the DOM overlay drag canvas (document-level).
        ctx.restore();
    }
    drawSlot(ctx, rect, fill, isTrash, hovered) {
        const r = Math.max(3, rect.w / 20);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, r);
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
    drawItemInSlot(ctx, rect, item, slotIndex) {
        var _a;
        // Rarity-colored inset
        const r = Math.max(3, rect.w / 20);
        if (item.rarity && ITEM_RARITY_COLORS[item.rarity]) {
            const c = ITEM_RARITY_COLORS[item.rarity];
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.w, rect.h, r);
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
        }
        else {
            const dataUrl = this.game.getItemSpriteDataUrl?.(item.type);
            if (dataUrl) {
                let img = this._iconCache?.[item.type];
                if (!img) {
                    img = new Image();
                    img.src = dataUrl;
                    ((_a = this)._iconCache || (_a._iconCache = {}))[item.type] = img;
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
                }
                else {
                    const overlayH = rect.h * (1 - t);
                    ctx.save();
                    ctx.beginPath();
                    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, r);
                    ctx.clip();
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(rect.x, rect.y, rect.w, overlayH);
                    ctx.restore();
                }
            }
        }
    }
}
exports.CanvasLoadoutBar = CanvasLoadoutBar;
