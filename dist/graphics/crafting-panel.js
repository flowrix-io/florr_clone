"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanvasCraftingPanel = void 0;
// Canvas-based crafting panel — replaces the prior DOM crafting implementation.
// Renders the crafting UI (5 slots, craft button, success chance, inventory grid)
// into a single <canvas>, following the same pattern as CanvasInventoryPanel.
const inventoryCodec_1 = require("../inventoryCodec");
const petals_1 = require("../petals");
const petal_icon_1 = require("./petal-icon");
const text_1 = require("./text");
/** Column order for the crafting inventory grid: common on left, no apex. */
const CRAFT_RARITY_COLS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
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
function formatPetalName(petalType) {
    if (!petalType)
        return '';
    const name = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
    return name.replace(/_/g, ' ');
}
class CanvasCraftingPanel {
    constructor(game) {
        this.itemRects = [];
        this.contentHeight = 0;
        this.scrollY = 0;
        this.hoverIndex = -1;
        this.rafHandle = 0;
        this.running = false;
        this.imgCache = new Map();
        // ----- Crafting state (driven by InventoryManager) -----
        /** The items currently placed in the crafting slots. */
        this.craftingItems = [];
        /** Computed success chance (0-100). */
        this.successChance = 0;
        /** Result item to display after a successful craft. */
        this.successResult = null;
        // ----- Animation state -----
        /** 'idle' = normal, 'spinning' = slots rotating, 'result' = showing outcome */
        this.animState = 'idle';
        /** Timestamp when the spin animation started. */
        this.spinStartTime = 0;
        /** Current spin angle offset in radians (applied to slot positions). */
        this.spinAngle = 0;
        /** The item being crafted during animation (snapshot taken at craft time). */
        this.animCraftItem = null;
        /** Result display start time. */
        this.resultStartTime = 0;
        /** On failure: how many petals remain in slots (1-4). */
        this.failRemainingCount = 0;
        /** Whether the result was a success. */
        this.resultSuccess = false;
        /** Pending server result, received while still spinning. */
        this.pendingResult = null;
        // ----- Layout rects (CSS pixels) -----
        this.closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
        this.switchBtnRect = { x: 0, y: 0, w: 0, h: 0 };
        this.craftBtnRect = { x: 0, y: 0, w: 0, h: 0 };
        this.slotRects = [];
        this.closeBtnHovered = false;
        this.switchBtnHovered = false;
        this.craftBtnHovered = false;
        /** The Y offset where the scrollable inventory area starts. */
        this.inventoryTop = 0;
        // ----- Mode: craft (default) or absorb (petals → XP) -----
        /** 'craft' = the normal tan crafting UI; 'absorb' = the purple absorb UI
         *  (old talents-menu colors), toggled by the Switch button next to the X. */
        this.mode = 'craft';
        /** XP the current slot contents would grant if absorbed (client preview). */
        this.absorbXpPreview = 0;
        /** XP granted by the last completed absorb (shown in the result state). */
        this.absorbResultXp = 0;
        // ----- Callbacks -----
        this.onClose = null;
        this.onCraft = null;
        this.onItemClick = null;
        this.onSlotClick = null;
        /** Fired when the Switch button (left of the X) is clicked. */
        this.onSwitchMode = null;
        /**
         * When set and returning false, the Switch button renders greyed out and
         * clicks on it are swallowed (absorb is maze-only, so the button is dead
         * outside the maze).
         */
        this.isSwitchEnabled = null;
        /**
         * When set, items in the panel's inventory grid for which this returns
         * true render greyed-out and can't be clicked into the slots (e.g.
         * non-petal items while the Absorb tab is active).
         */
        this.isItemDisabled = null;
        this.handleMouseMove = (e) => {
            const { x, y } = this.toLocal(e);
            this.closeBtnHovered = this.pointInRect(x, y, this.closeBtnRect);
            this.switchBtnHovered = this.pointInRect(x, y, this.switchBtnRect)
                && (!this.isSwitchEnabled || this.isSwitchEnabled());
            this.craftBtnHovered = this.pointInRect(x, y, this.craftBtnRect);
            // Hit test inventory items
            const hit = this.hitTestInventory(e.clientX, e.clientY);
            const newIdx = hit ? this.findItemIndex(hit.rarity, hit.itemType) : -1;
            if (newIdx !== this.hoverIndex) {
                this.hoverIndex = newIdx;
            }
        };
        this.handleMouseLeave = () => {
            this.hoverIndex = -1;
            this.closeBtnHovered = false;
            this.switchBtnHovered = false;
            this.craftBtnHovered = false;
        };
        this.handleMouseDown = (e) => {
            if (e.button !== 0)
                return;
            const { x, y } = this.toLocal(e);
            // Close button
            if (this.pointInRect(x, y, this.closeBtnRect)) {
                e.preventDefault();
                if (this.onClose)
                    this.onClose();
                return;
            }
            // Switch button (craft ⇄ absorb) — dead when disabled (outside the maze)
            if (this.pointInRect(x, y, this.switchBtnRect)) {
                e.preventDefault();
                if (this.isSwitchEnabled && !this.isSwitchEnabled())
                    return;
                if (this.onSwitchMode)
                    this.onSwitchMode();
                return;
            }
            // Craft button
            if (this.pointInRect(x, y, this.craftBtnRect)) {
                e.preventDefault();
                if (this.onCraft)
                    this.onCraft();
                return;
            }
            // Crafting slots — click to remove a batch
            if (this.animState === 'idle') {
                for (const s of this.slotRects) {
                    if (this.pointInRect(x, y, s)) {
                        e.preventDefault();
                        if (this.onSlotClick)
                            this.onSlotClick();
                        return;
                    }
                }
            }
            // Inventory items
            const hit = this.hitTestInventory(e.clientX, e.clientY);
            if (hit && this.isItemDisabled && this.isItemDisabled(hit.rarity, hit.itemType)) {
                e.preventDefault();
                return;
            }
            if (hit && this.onItemClick) {
                e.preventDefault();
                this.onItemClick(hit.rarity, hit.itemType, e.shiftKey);
            }
        };
        this.handleWheel = (e) => {
            // Only scroll if the mouse is in the inventory area
            const { y } = this.toLocal(e);
            if (y < this.inventoryTop)
                return;
            e.preventDefault();
            this.scrollY += e.deltaY;
            const rect = this.canvas.getBoundingClientRect();
            const visibleH = Math.max(0, rect.height - this.inventoryTop - 14);
            const maxScroll = Math.max(0, this.contentHeight - visibleH);
            if (this.scrollY < 0)
                this.scrollY = 0;
            if (this.scrollY > maxScroll)
                this.scrollY = maxScroll;
        };
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
        if (!ctx)
            throw new Error('CanvasCraftingPanel: failed to acquire 2d context');
        this.ctx = ctx;
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    }
    attachTo(parent) {
        parent.appendChild(this.canvas);
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        const loop = () => {
            if (!this.running)
                return;
            this.draw();
            this.rafHandle = requestAnimationFrame(loop);
        };
        loop();
    }
    stop() {
        this.running = false;
        if (this.rafHandle)
            cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
        this.hoverIndex = -1;
    }
    isRunning() {
        return this.running;
    }
    destroy() {
        this.stop();
    }
    // ----- Public state setters (called by InventoryManager) -----
    setCraftingItems(items) {
        this.craftingItems = items;
    }
    setSuccessChance(chance) {
        this.successChance = chance;
    }
    setSuccessResult(result) {
        this.successResult = result;
    }
    /** Switch between the craft and absorb UIs. */
    setMode(mode) {
        this.mode = mode;
    }
    getMode() {
        return this.mode;
    }
    /** XP preview for the petals currently in the slots (absorb mode). */
    setAbsorbXpPreview(xp) {
        this.absorbXpPreview = xp;
    }
    /** Show the "+N XP" result after the server confirms an absorb. */
    showAbsorbResult(xpGained) {
        // Never hijack an in-flight craft spin (e.g. a delayed absorb response
        // arriving after the player switched back and started crafting) — the
        // XP is already granted server-side; only the toast is skipped.
        if (this.animState === 'spinning')
            return;
        this.animState = 'result';
        this.resultStartTime = performance.now();
        this.resultSuccess = true;
        this.successResult = null;
        this.animCraftItem = null;
        this.failRemainingCount = 0;
        this.absorbResultXp = xpGained;
    }
    /** Start the spinning animation. Called when the user clicks Craft. */
    startCraftAnimation(item) {
        this.animState = 'spinning';
        this.spinStartTime = performance.now();
        this.spinAngle = 0;
        this.animCraftItem = item;
        this.pendingResult = null;
        this.successResult = null;
    }
    /** Called when the server responds with crafting results. */
    showCraftResult(success, result, petalsReturned) {
        const data = { success, result: result || undefined, remaining: petalsReturned };
        if (this.animState === 'spinning') {
            // Store for when spin finishes
            this.pendingResult = data;
        }
        else {
            this.transitionToResult(data);
        }
    }
    transitionToResult(data) {
        this.animState = 'result';
        this.resultStartTime = performance.now();
        this.resultSuccess = data.success;
        // A craft result always replaces any lingering absorb result — never
        // render "+N XP" superimposed on the crafted-item icon.
        this.absorbResultXp = 0;
        if (data.success && data.result) {
            this.successResult = data.result;
        }
        else {
            this.successResult = null;
        }
        this.failRemainingCount = data.remaining;
    }
    isAnimating() {
        return this.animState !== 'idle';
    }
    /** Drop the spin/result animation and go straight back to idle. Used by the
     *  craft watchdog: the spin holds at its final angle waiting for a server
     *  result, so a response that never arrives would otherwise leave the panel
     *  spinning until it is closed and reopened. */
    cancelCraftAnimation() {
        this.animState = 'idle';
        this.animCraftItem = null;
        this.pendingResult = null;
        this.successResult = null;
        this.spinAngle = 0;
        this.failRemainingCount = 0;
        this.absorbResultXp = 0;
    }
    // ----- Canvas size sync -----
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
    // ----- Layout -----
    layoutCraftingArea(cssW) {
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
        // Switch button (craft ⇄ absorb) — immediately left of the X.
        const switchW = 58;
        this.switchBtnRect = {
            x: this.closeBtnRect.x - 6 - switchW,
            y: this.closeBtnRect.y,
            w: switchW,
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
                }
                else {
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
    getOwnedItemTypes(invDict) {
        const typeSet = new Set();
        for (const rarity of CRAFT_RARITY_COLS) {
            const items = invDict[rarity];
            if (!items)
                continue;
            for (const [type, count] of Object.entries(items)) {
                if (count > 0)
                    typeSet.add(type);
            }
        }
        // Sort by ITEM_KEY_TO_ID for canonical ordering
        const types = Array.from(typeSet);
        types.sort((a, b) => {
            const ia = inventoryCodec_1.ITEM_KEY_TO_ID.get(a);
            const ib = inventoryCodec_1.ITEM_KEY_TO_ID.get(b);
            if (ia === undefined && ib === undefined)
                return a.localeCompare(b);
            if (ia === undefined)
                return 1;
            if (ib === undefined)
                return -1;
            return ia - ib;
        });
        return types;
    }
    /** `invDict` with the items currently sitting in the craft/absorb slots added
     *  back in. Staging deducts from the displayed inventory, so a stack clicked
     *  down to zero drops out of the grid entirely — its row (and possibly its
     *  rarity column) disappears and every cell below/right of it slides into a
     *  new position mid-click. The next click of a spam-click then lands on a
     *  DIFFERENT petal, which replaces the whole staged batch and hands it back
     *  to the inventory: the "plain clicking doesn't craft everything I clicked"
     *  bug. Used for the row/column set only — the counts drawn in the cells
     *  still come from the real inventory. */
    withStagedItems(invDict) {
        const merged = {};
        for (const rarity of Object.keys(invDict))
            merged[rarity] = { ...invDict[rarity] };
        for (const item of this.craftingItems) {
            const key = item.petalType ? `petal_${item.petalType}` : item.type;
            if (!merged[item.rarity])
                merged[item.rarity] = {};
            merged[item.rarity][key] = (merged[item.rarity][key] || 0) + 1;
        }
        return merged;
    }
    /** Which rarities actually exist in the player's inventory? Common on left, no unique. */
    getOwnedRarities(invDict) {
        const result = [];
        for (const rarity of CRAFT_RARITY_COLS) {
            const items = invDict[rarity];
            if (!items)
                continue;
            for (const count of Object.values(items)) {
                if (count > 0) {
                    result.push(rarity);
                    break;
                }
            }
        }
        return result;
    }
    layoutInventory(cssW, cssH, startY) {
        const player = this.game.getLocalPlayer();
        if (!player || !Array.isArray(player.inventory)) {
            this.itemRects = [];
            this.contentHeight = 0;
            return;
        }
        const invDict = (0, inventoryCodec_1.inventoryToDict)(player.inventory);
        const padding = 12;
        const itemSize = 56;
        const itemGap = 4;
        // Rows = item types, Columns = rarities. Keyed on inventory + staged so
        // the grid can't reflow under the cursor while petals sit in the slots.
        const layoutDict = this.craftingItems.length > 0 ? this.withStagedItems(invDict) : invDict;
        const itemTypes = this.getOwnedItemTypes(layoutDict);
        const rarities = this.getOwnedRarities(layoutDict);
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
                const count = invDict[rarity]?.[itemType] || 0;
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
                }
                else {
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
        if (this.scrollY > maxScroll)
            this.scrollY = maxScroll;
        if (this.scrollY < 0)
            this.scrollY = 0;
    }
    // ----- Drawing -----
    draw() {
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
        // ----- Panel background + border (purple in absorb mode) -----
        const absorb = this.mode === 'absorb';
        const panelRadius = 3;
        const borderW = 4;
        ctx.fillStyle = absorb ? CanvasCraftingPanel.ABSORB_PANEL_BORDER : CanvasCraftingPanel.PANEL_BORDER;
        ctx.beginPath();
        ctx.roundRect(0, 0, cssW, cssH, panelRadius);
        ctx.fill();
        ctx.fillStyle = absorb ? CanvasCraftingPanel.ABSORB_PANEL_BG : CanvasCraftingPanel.PANEL_BG;
        ctx.beginPath();
        ctx.roundRect(borderW, borderW, cssW - borderW * 2, cssH - borderW * 2, Math.max(0, panelRadius - 2));
        ctx.fill();
        // ----- Header -----
        this.drawHeader(ctx, cssW);
        // ----- Crafting slots -----
        this.drawCraftingSlots(ctx, cssW);
        // ----- Craft button -----
        this.drawCraftButton(ctx);
        // ----- Success chance / absorb XP text -----
        const cb = this.craftBtnRect;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        // A computed chance is always > 0 for a valid craft (even high tiers are
        // shown as fractions like 0.25%). A chance of 0 means there's nothing to
        // craft (empty slots / craft disabled), so show "?%" rather than "0%".
        const chanceText = absorb
            ? (this.absorbXpPreview > 0 ? `+${this.absorbXpPreview} XP` : `+? XP`)
            : (this.successChance > 0
                ? `${this.successChance}% success chance`
                : `?% success chance`);
        const chanceX = cb.x + cb.w / 2;
        const chanceY = cb.y + cb.h + 6;
        (0, text_1.drawText)(ctx, chanceText, chanceX, chanceY, { size: 12, weight: 'bold', fill: '#ffffff', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3 });
        ctx.restore();
        // ----- Instruction text -----
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        const instruction = absorb
            ? 'Absorb petals to convert them into XP'
            : 'Combine 5 of the same petal to craft an upgrade';
        (0, text_1.drawText)(ctx, instruction, cssW / 2, instructionY + 4, { size: 13, weight: 'bold', fill: '#ffffff', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3 });
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
            }
            else {
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
    drawHeader(ctx, cssW) {
        // Title
        const title = this.mode === 'absorb' ? 'Absorb' : 'Craft';
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        (0, text_1.drawText)(ctx, title, cssW / 2, 14, { size: 22, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 4 });
        ctx.restore();
        // Switch button (craft ⇄ absorb) — left of the X. Greyed out (and
        // inert) when disabled, i.e. outside the maze.
        const switchEnabled = !this.isSwitchEnabled || this.isSwitchEnabled();
        const sb = this.switchBtnRect;
        ctx.save();
        if (!switchEnabled)
            ctx.globalAlpha = 0.45;
        ctx.fillStyle = switchEnabled ? CanvasCraftingPanel.SWITCH_BORDER : '#5a5a5a';
        ctx.beginPath();
        ctx.roundRect(sb.x, sb.y, sb.w, sb.h, 4);
        ctx.fill();
        ctx.fillStyle = switchEnabled
            ? (this.switchBtnHovered ? '#a394e0' : CanvasCraftingPanel.SWITCH_BG)
            : '#8a8a8a';
        ctx.beginPath();
        ctx.roundRect(sb.x + 2, sb.y + 2, sb.w - 4, sb.h - 4, 3);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        (0, text_1.drawText)(ctx, 'Switch', sb.x + sb.w / 2, sb.y + sb.h / 2 + 1, { size: 12, weight: 'bold', fill: '#ffffff', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3 });
        ctx.restore();
        // Close button
        const cb = this.closeBtnRect;
        ctx.save();
        ctx.fillStyle = CanvasCraftingPanel.CLOSE_BORDER;
        ctx.beginPath();
        ctx.roundRect(cb.x, cb.y, cb.w, cb.h, 4);
        ctx.fill();
        ctx.fillStyle = this.closeBtnHovered ? '#e8a0b0' : CanvasCraftingPanel.CLOSE_BG;
        ctx.beginPath();
        ctx.roundRect(cb.x + 2, cb.y + 2, cb.w - 4, cb.h - 4, 3);
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
    getCraftingCenter(cssW) {
        return { cx: cssW / 2, cy: 50 + 180 / 2 };
    }
    drawCraftingSlots(ctx, cssW) {
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
                this.absorbResultXp = 0;
            }
        }
        // Draw the slots
        for (let i = 0; i < this.slotRects.length; i++) {
            const s = this.slotRects[i];
            const radius = 6;
            const bw = 3;
            // On failure result, empty slots (beyond remaining count) use empty color
            const slotHasItem = hasItems && displayItem && !(this.animState === 'result' && !this.resultSuccess && i >= this.failRemainingCount);
            const emptyBg = this.mode === 'absorb' ? CanvasCraftingPanel.ABSORB_SLOT_BG : CanvasCraftingPanel.SLOT_BG;
            const emptyBorder = this.mode === 'absorb' ? CanvasCraftingPanel.ABSORB_SLOT_BORDER : CanvasCraftingPanel.SLOT_BORDER;
            const bgColor = slotHasItem
                ? (petals_1.ITEM_RARITY_COLORS[displayItem.rarity] || emptyBg)
                : emptyBg;
            const borderColor = slotHasItem
                ? darken(petals_1.ITEM_RARITY_COLORS[displayItem.rarity] || emptyBorder, 25)
                : emptyBorder;
            ctx.save();
            ctx.fillStyle = borderColor;
            ctx.beginPath();
            ctx.roundRect(s.x, s.y, s.w, s.h, radius);
            ctx.fill();
            ctx.fillStyle = bgColor;
            ctx.beginPath();
            ctx.roundRect(s.x + bw, s.y + bw, s.w - bw * 2, s.h - bw * 2, Math.max(0, radius - 2));
            ctx.fill();
            ctx.restore();
            // On failure result, only draw petals in the first N remaining slots
            const showIcon = hasItems && displayItem && !(this.animState === 'result' && !this.resultSuccess && i >= this.failRemainingCount);
            if (showIcon) {
                this.drawCraftingSlotIcon(ctx, s, displayItem, now);
            }
        }
        const center = this.getCraftingCenter(cssW);
        // Draw multiplier text in center (only when idle with items)
        if (this.animState === 'idle' && this.craftingItems.length > 0) {
            const attempts = Math.floor(this.craftingItems.length / 5);
            if (attempts > 0) {
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.lineJoin = 'round';
                (0, text_1.drawText)(ctx, `x${attempts}`, center.cx, center.cy, { size: 24, weight: 'bold', fill: '#ffffff', stroke: 'rgba(0,0,0,0.8)', strokeWidth: 4 });
                ctx.restore();
            }
        }
        // Draw success result in center
        if (this.animState === 'result' && this.resultSuccess && this.successResult) {
            const rColor = petals_1.ITEM_RARITY_COLORS[this.successResult.rarity] || '#7eef6d';
            const resultSize = 60;
            const cx = center.cx;
            const cy = center.cy;
            ctx.save();
            ctx.fillStyle = darken(rColor, 25);
            ctx.beginPath();
            ctx.roundRect(cx - resultSize / 2, cy - resultSize / 2, resultSize, resultSize, 8);
            ctx.fill();
            ctx.fillStyle = rColor;
            ctx.beginPath();
            ctx.roundRect(cx - resultSize / 2 + 3, cy - resultSize / 2 + 3, resultSize - 6, resultSize - 6, 6);
            ctx.fill();
            const iconSize = 36;
            if (this.successResult.petalType) {
                const pc = this.game.getPetalCanvas?.(this.successResult.petalType, this.successResult.rarity, now);
                if (pc) {
                    const stats = this.game.getPetalStats?.(this.successResult.petalType, this.successResult.rarity);
                    (0, petal_icon_1.drawPetalGroup)(ctx, pc, stats?.count, cx, cy, iconSize);
                }
            }
            else {
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
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.lineJoin = 'round';
            const countText = `x${this.successResult.count}`;
            (0, text_1.drawText)(ctx, countText, cx, cy + resultSize / 2 + 4, { size: 18, weight: 'bold', fill: rColor, stroke: 'rgba(0,0,0,0.8)', strokeWidth: 3 });
            ctx.restore();
        }
        // Absorb result — "+N XP" in the center.
        if (this.animState === 'result' && this.resultSuccess && this.absorbResultXp > 0) {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            (0, text_1.drawText)(ctx, `+${this.absorbResultXp} XP`, center.cx, center.cy, { size: 22, weight: 'bold', fill: '#c9ffb3', stroke: 'rgba(0,0,0,0.8)', strokeWidth: 4 });
            ctx.restore();
        }
        // Draw "Failed" text in center on failure result
        if (this.animState === 'result' && !this.resultSuccess) {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            (0, text_1.drawText)(ctx, 'Failed!', center.cx, center.cy, { size: 20, weight: 'bold', fill: '#ff4444', stroke: 'rgba(0,0,0,0.8)', strokeWidth: 4 });
            ctx.restore();
        }
    }
    drawCraftingSlotIcon(ctx, s, item, time) {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        const iconSize = 32;
        if (item.type === 'petal' && item.petalType) {
            const pc = this.game.getPetalCanvas?.(item.petalType, item.rarity, time);
            if (pc) {
                const stats = this.game.getPetalStats?.(item.petalType, item.rarity);
                (0, petal_icon_1.drawPetalGroup)(ctx, pc, stats?.count, cx, cy, iconSize);
            }
        }
        else {
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
    drawCraftButton(ctx) {
        const b = this.craftBtnRect;
        const radius = 6;
        const bw = 3;
        let btnBg;
        let btnBorder;
        let btnHover;
        let label;
        if (this.mode === 'absorb') {
            btnBg = CanvasCraftingPanel.ABSORB_BTN_BG;
            btnBorder = CanvasCraftingPanel.ABSORB_BTN_BORDER;
            btnHover = '#c284f0';
            label = 'Absorb';
        }
        else {
            // Use next rarity color when items are present
            const currentRarity = this.craftingItems.length > 0
                ? this.craftingItems[0].rarity
                : (this.animCraftItem?.rarity || '');
            const nextRarity = CanvasCraftingPanel.RARITY_UPGRADES[currentRarity] || '';
            const nextColor = petals_1.ITEM_RARITY_COLORS[nextRarity] || '';
            btnBg = nextColor || CanvasCraftingPanel.CRAFT_BTN_BG;
            btnBorder = nextColor ? darken(nextColor, 25) : CanvasCraftingPanel.CRAFT_BTN_BORDER;
            btnHover = nextColor ? darken(nextColor, 10) : '#9a8a7a';
            label = 'Craft';
        }
        ctx.save();
        ctx.fillStyle = btnBorder;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, radius);
        ctx.fill();
        ctx.fillStyle = this.craftBtnHovered ? btnHover : btnBg;
        ctx.beginPath();
        ctx.roundRect(b.x + bw, b.y + bw, b.w - bw * 2, b.h - bw * 2, Math.max(0, radius - 2));
        ctx.fill();
        // Button text
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        (0, text_1.drawText)(ctx, label, b.x + b.w / 2, b.y + b.h / 2, { size: 15, weight: 'bold', fill: '#ffffff', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3 });
        ctx.restore();
    }
    drawEmptySlot(ctx, r) {
        const radius = 6;
        const bw = 3;
        const border = this.mode === 'absorb' ? CanvasCraftingPanel.ABSORB_SLOT_BORDER : CanvasCraftingPanel.SLOT_BORDER;
        const bg = this.mode === 'absorb' ? CanvasCraftingPanel.ABSORB_SLOT_BG : CanvasCraftingPanel.SLOT_BG;
        ctx.save();
        ctx.fillStyle = border;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, radius);
        ctx.fill();
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(r.x + bw, r.y + bw, r.w - bw * 2, r.h - bw * 2, Math.max(0, radius - 2));
        ctx.fill();
        ctx.restore();
    }
    drawItemSlot(ctx, r, hovered, time) {
        const baseColor = petals_1.ITEM_RARITY_COLORS[r.rarity] || '#dc7e92';
        const borderColor = darken(baseColor, 25);
        const radius = 6;
        const borderW = 3;
        // Outer rounded border + inner fill
        ctx.save();
        ctx.fillStyle = borderColor;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, radius);
        ctx.fill();
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.roundRect(r.x + borderW, r.y + borderW, r.w - borderW * 2, r.h - borderW * 2, Math.max(0, radius - 2));
        ctx.fill();
        if (hovered) {
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(r.x + borderW, r.y + borderW, r.w - borderW * 2, r.h - borderW * 2, Math.max(0, radius - 2));
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
            ctx.lineJoin = 'round';
            const tx = r.x + r.w / 2;
            const ty = r.y + r.h - 5;
            (0, text_1.drawText)(ctx, displayName, tx, ty, { font: ctx.font, fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
            ctx.restore();
        }
        // Count badge
        if (r.count > 1) {
            const text = `x${r.count}`;
            ctx.save();
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.lineJoin = 'round';
            const tx = r.x + r.w - 4;
            const ty = r.y + 3;
            (0, text_1.drawText)(ctx, text, tx, ty, { size: 11, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
            ctx.restore();
        }
        // Disabled items (e.g. non-petals in the Absorb tab): grey the slot out
        // so it reads as unusable; clicks are blocked in handleMouseDown.
        if (this.isItemDisabled && this.isItemDisabled(r.rarity, r.itemType)) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = '#3a3a3a';
            ctx.beginPath();
            ctx.roundRect(r.x, r.y, r.w, r.h, radius);
            ctx.fill();
            ctx.restore();
        }
    }
    drawItemIcon(ctx, r, time) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h * 0.4;
        const iconSize = 32;
        if (r.itemType.startsWith('petal_')) {
            const petalType = r.itemType.replace('petal_', '');
            const pc = this.game.getPetalCanvas?.(petalType, r.rarity, time);
            if (pc) {
                const stats = this.game.getPetalStats?.(petalType, r.rarity);
                (0, petal_icon_1.drawPetalGroup)(ctx, pc, stats?.count, cx, cy, iconSize);
            }
        }
        else {
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
    toLocal(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    pointInRect(x, y, r) {
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }
    hitTestInventory(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return null;
        }
        if (clientY - rect.top < this.inventoryTop)
            return null;
        const x = clientX - rect.left;
        const y = (clientY - rect.top) - this.inventoryTop + this.scrollY;
        for (const r of this.itemRects) {
            if (r.count > 0 && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                return { rarity: r.rarity, itemType: r.itemType };
            }
        }
        return null;
    }
    findItemIndex(rarity, itemType) {
        for (let i = 0; i < this.itemRects.length; i++) {
            if (this.itemRects[i].rarity === rarity && this.itemRects[i].itemType === itemType)
                return i;
        }
        return -1;
    }
}
exports.CanvasCraftingPanel = CanvasCraftingPanel;
/** Duration of the spin in ms. */
CanvasCraftingPanel.SPIN_DURATION = 1500;
/** Duration to show the result before going back to idle. */
CanvasCraftingPanel.RESULT_DURATION = 2000;
// ----- Panel colors -----
CanvasCraftingPanel.PANEL_BG = '#d8a05d';
CanvasCraftingPanel.PANEL_BORDER = '#c4914a';
CanvasCraftingPanel.SLOT_BG = '#b8884a';
CanvasCraftingPanel.SLOT_BORDER = '#a07040';
CanvasCraftingPanel.CLOSE_BG = '#dc7e92';
CanvasCraftingPanel.CLOSE_BORDER = '#b56476';
CanvasCraftingPanel.CRAFT_BTN_BG = '#8a7a6a';
CanvasCraftingPanel.CRAFT_BTN_BORDER = '#6a5a4a';
// Absorb mode — the old talents menu's purple.
CanvasCraftingPanel.ABSORB_PANEL_BG = '#9d4edd';
CanvasCraftingPanel.ABSORB_PANEL_BORDER = '#7a3ba8';
CanvasCraftingPanel.ABSORB_SLOT_BG = '#8b44c9';
CanvasCraftingPanel.ABSORB_SLOT_BORDER = '#7a3ba8';
CanvasCraftingPanel.ABSORB_BTN_BG = '#b06ae8';
CanvasCraftingPanel.ABSORB_BTN_BORDER = '#7a3ba8';
CanvasCraftingPanel.SWITCH_BG = '#8a7ac9';
CanvasCraftingPanel.SWITCH_BORDER = '#6a5aa8';
CanvasCraftingPanel.RARITY_UPGRADES = {
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
