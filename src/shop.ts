/**
 * Canvas-based shop UI. Previously this panel was built out of ~hundreds of
 * DOM elements (one card per petal × rarity combination) which were expensive
 * to mount and recompute on every state change. Everything below renders into
 * a single <canvas> with hit-testing for clicks, hovers, scroll, modals, and
 * a custom text input — zero per-item DOM cost regardless of catalogue size.
 */
import { Player } from './player';
import { Socket } from './socket';
import { getPetalStats, getAllPetalTypes, RARITY_LEVELS, Rarity, ITEM_RARITY_COLORS } from './petals';
import { GAME_ICONS_NET_ICONS } from './game-icons-net-icons';

interface GameInterface {
    getLocalPlayer(): Player | undefined;
    getSocket(): Socket | undefined;
    showFloatingText(x: number, y: number, text: string, color: string, fontSize: number): void;
    showFallingStars?(): void;
    canvas: HTMLCanvasElement;
    getPetalStats?(petalType: string, rarity: string): any;
    getItemSprites?(): Record<string, HTMLImageElement>;
    getItemSpriteDataUrl?(itemType: string): string | null;
    getPetalCanvas?(petalType: string, rarity: string, time?: number): HTMLCanvasElement | null;
}

// Shop pricing configuration — base price per petal type, multiplied by rarity.
const SHOP_PRICES: { [petalType: string]: number } = {
    basic: 10, rose: 15, stinger: 20, light: 12, rock: 18, sand: 14,
    yggdrasil: 120, dandelion: 13, clover: 16, bone: 17, cactus: 19,
    poison_cactus: 22, iris: 18, lightning: 25, missile: 21, jelly: 20,
    yucca: 15, leaf: 14, cutter: 50, lightning_cutter: 60, wing: 23,
    square: 1000, golden_leaf: 18, blood_leaf: 24, target_dummy_egg: 100000000,
    splitter: 1000000,
};
const DEFAULT_SHOP_PRICE = 10;

function getShopPrice(petalType: string, rarity: Rarity): number {
    const basePrice = SHOP_PRICES[petalType] || DEFAULT_SHOP_PRICE;
    const rarityIndex = RARITY_LEVELS.indexOf(rarity);
    return Math.floor(basePrice * Math.pow(3.5, rarityIndex));
}

/* -------------------------- Layout constants -------------------------- */
const PANEL_W = 700;
const PANEL_PADDING = 20;
const HEADER_H = 90;
const CODE_SECTION_H = 110;
const TABS_H = 50;
const ITEM_SIZE = 44;        // each shop card is 44×44 (room for 32px icon + 12px price bar)
const ITEM_ICON = 32;
const ITEM_PRICE_BAR_H = 12;
const ITEM_GAP = 8;
const SCROLLBAR_W = 6;
const CARET_BLINK_MS = 530;

interface HitRegion {
    x: number; y: number; w: number; h: number;
    kind: 'tab' | 'item' | 'redeem' | 'input' | 'modal-button' | 'close';
    payload?: any;
    disabled?: boolean;
}

interface ConfirmModal {
    type: 'confirm';
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
}
interface AlertModal {
    type: 'alert';
    message: string;
    color?: string;
    onClose?: () => void;
}
type Modal = ConfirmModal | AlertModal;

/* ------------------------------ ShopManager ----------------------------- */
export class ShopManager {
    private game: GameInterface;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private isShopOpen = false;
    private animTarget = 0;          // 0 = hidden, 1 = visible (drives whether draw() runs after closeShop)
    private rafScheduled = false;
    private lastFrame = 0;

    private activeTab: 'shop' | 'challenges' = 'shop';
    private scrollOffsets: { shop: number; challenges: number } = { shop: 0, challenges: 0 };
    private contentHeights: { shop: number; challenges: number } = { shop: 0, challenges: 0 };
    private hover: HitRegion | null = null;
    private regions: HitRegion[] = [];

    private codeText = '';
    private codeCaret = 0;
    private codeFocused = false;
    private caretAnchorMs = 0;       // when caret last reset (so blink restarts on input)

    private modal: Modal | null = null;
    private starIcon: HTMLImageElement | null = null;

    private readonly allPetalTypes: string[];
    private readonly ITEM_RARITY_COLORS = ITEM_RARITY_COLORS;
    private readonly buyableRarities: Rarity[];

    // Bound handlers (so we can remove them in cleanup)
    private readonly onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
    private readonly onMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
    private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
    private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    private readonly onPaste = (e: ClipboardEvent) => this.handlePaste(e);
    private readonly onResize = () => { this.resize(); this.requestDraw(); };

    constructor(game: GameInterface) {
        this.game = game;
        this.allPetalTypes = getAllPetalTypes();
        this.buyableRarities = (RARITY_LEVELS as readonly Rarity[]).filter(r => r !== 'unique');

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'shopCanvas';
        this.canvas.style.cssText = `
            position: fixed;
            top: 33.33vh;
            left: 100px;
            width: ${PANEL_W}px;
            height: 66.67vh;
            transform: translateY(100vh);
            transition: transform 0.3s ease-out;
            z-index: 1000;
            display: none;
            border-radius: 3px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.3);
            cursor: default;
        `;
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d')!;

        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mousedown', this.onMouseDown);
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
        window.addEventListener('keydown', this.onKeyDown);
        // Paste is its own event because preventDefault on Cmd-V keydown
        // suppresses the system paste flow, but the browser still fires a
        // `paste` event on the document afterwards — that's where we get the
        // actual clipboard text without needing the async clipboard permission.
        document.addEventListener('paste', this.onPaste);
        window.addEventListener('resize', this.onResize);

        this.preloadStarIcon();
        this.resize();
    }

    /* ----------------------------- Public API ----------------------------- */

    public openShop(): void {
        if (this.isShopOpen) return;
        this.isShopOpen = true;
        this.canvas.style.display = 'block';
        // Two-step show so the CSS transition kicks in.
        requestAnimationFrame(() => {
            this.canvas.style.transform = 'translateY(0)';
        });
        this.animTarget = 1;
        this.requestDraw();
    }

    public closeShop(): void {
        if (!this.isShopOpen) return;
        this.isShopOpen = false;
        this.codeFocused = false;
        this.modal = null;
        this.canvas.style.transform = 'translateY(100vh)';
        setTimeout(() => {
            if (!this.isShopOpen) this.canvas.style.display = 'none';
        }, 300);
    }

    public isShopOpenState(): boolean { return this.isShopOpen; }

    public toggleShop(): void {
        if (this.isShopOpen) this.closeShop();
        else this.openShop();
    }

    public updateStarsDisplay(): void {
        if (this.isShopOpen) this.requestDraw();
    }

    public handlePurchaseSuccess(): void {
        this.requestDraw();
        if (this.game.showFloatingText) {
            this.game.showFloatingText(
                this.game.canvas.width / 2,
                this.game.canvas.height / 2,
                'Purchase Successful!',
                '#4a90e2',
                24
            );
        }
    }

    public handlePurchaseError(message: string): void {
        this.modal = { type: 'alert', message: `Purchase failed: ${message}`, color: '#e74c3c' };
        this.requestDraw();
    }

    public handleCodeRedeemSuccess(stars: number): void {
        this.requestDraw();
        if (this.game.showFallingStars) this.game.showFallingStars();
        if (this.game.showFloatingText) {
            const player = this.game.getLocalPlayer();
            const x = player ? player.x : this.game.canvas.width / 2;
            const y = player ? player.y - 30 : this.game.canvas.height / 2;
            this.game.showFloatingText(
                x, y,
                `Code redeemed successfully! +${stars} Stars!`,
                '#ffd700',
                24
            );
        }
    }

    public handleCodeRedeemError(message: string): void {
        this.modal = { type: 'alert', message: `Code redemption failed: ${message}`, color: '#e74c3c' };
        this.requestDraw();
    }

    public cleanup(): void {
        this.canvas.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('mousedown', this.onMouseDown);
        this.canvas.removeEventListener('wheel', this.onWheel);
        window.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('paste', this.onPaste);
        window.removeEventListener('resize', this.onResize);
        this.canvas.remove();
    }

    /* --------------------------- Internal setup --------------------------- */

    private preloadStarIcon(): void {
        const icon = GAME_ICONS_NET_ICONS.find(i => i.name === 'stars');
        if (!icon) return;
        // The shipped SVG uses fill="#fff"; we want gold for the shop.
        const colored = icon.value.replace(/fill="#fff"/g, 'fill="#ffd700"');
        const img = new Image();
        img.onload = () => { this.starIcon = img; this.requestDraw(); };
        img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(colored);
    }

    private resize(): void {
        const dpr = window.devicePixelRatio || 1;
        const cssW = PANEL_W;
        const cssH = window.innerHeight * (2 / 3);
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.canvas.style.width = `${cssW}px`;
        this.canvas.style.height = `${cssH}px`;
        // All drawing logic uses CSS pixels.
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    private requestDraw(): void {
        if (this.rafScheduled) return;
        this.rafScheduled = true;
        requestAnimationFrame((t) => {
            this.rafScheduled = false;
            this.draw(t);
        });
    }

    /* ------------------------------ Drawing ------------------------------ */

    private draw(t: number): void {
        if (!this.isShopOpen && this.animTarget === 0) return;

        const dt = this.lastFrame === 0 ? 0 : (t - this.lastFrame);
        this.lastFrame = t;
        // The slide-in is CSS-driven; we just need to keep redrawing while
        // the caret blinks, when content scrolls, or when state changes. So
        // we don't actually need an internal anim progress, but we do need
        // to keep ticking the caret while focused.
        void dt;

        const cssW = PANEL_W;
        const cssH = window.innerHeight * (2 / 3);
        const ctx = this.ctx;

        // Reset region list — populated as we draw interactive elements.
        this.regions = [];

        // Background — clear then paint panel fill + border in one rounded path.
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.fillStyle = '#42f563';
        roundRect(ctx, 0, 0, cssW, cssH, 3);
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#36d153';
        ctx.stroke();

        this.drawHeader(cssW);
        this.drawCodeSection(cssW);
        this.drawTabs(cssW);

        // Tab content area (clipped, scrollable)
        const contentTop = PANEL_PADDING + HEADER_H + CODE_SECTION_H + TABS_H;
        const contentH = cssH - contentTop - PANEL_PADDING;
        ctx.save();
        ctx.beginPath();
        ctx.rect(PANEL_PADDING, contentTop, cssW - PANEL_PADDING * 2, contentH);
        ctx.clip();
        if (this.activeTab === 'shop') {
            this.drawShopItems(PANEL_PADDING, contentTop, cssW - PANEL_PADDING * 2, contentH);
        } else {
            this.drawChallenges(PANEL_PADDING, contentTop, cssW - PANEL_PADDING * 2, contentH);
        }
        ctx.restore();

        // Scrollbar
        this.drawScrollbar(cssW - PANEL_PADDING + 6, contentTop, contentH);

        if (this.modal) this.drawModal(cssW, cssH);

        // Re-schedule draws for caret blink while input focused, or if a modal
        // alert is animating (none currently — just blink).
        if (this.codeFocused && !this.modal) this.requestDraw();
    }

    private drawHeader(cssW: number): void {
        const ctx = this.ctx;
        const player = this.game.getLocalPlayer();
        const stars = player?.stars ?? 0;

        // Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Shop', cssW / 2, PANEL_PADDING + 18);

        // Stars (icon + count, centered)
        const text = stars.toLocaleString();
        ctx.font = 'bold 24px Ubuntu, sans-serif';
        const textW = ctx.measureText(text).width;
        const iconSize = 28;
        const gap = 10;
        const totalW = iconSize + gap + textW;
        const startX = (cssW - totalW) / 2;
        const yIcon = PANEL_PADDING + 50;

        if (this.starIcon && this.starIcon.complete) {
            ctx.drawImage(this.starIcon, startX, yIcon, iconSize, iconSize);
        } else {
            ctx.fillStyle = '#ffd700';
            ctx.font = '28px serif';
            ctx.textAlign = 'left';
            ctx.fillText('⭐', startX, yIcon + iconSize - 5);
            ctx.font = 'bold 24px Ubuntu, sans-serif';
        }
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, startX + iconSize + gap, yIcon + iconSize / 2);

        // Close (X) button in top-right
        const cb = { x: cssW - PANEL_PADDING - 24, y: PANEL_PADDING - 4, w: 24, h: 24 };
        const closeHover = this.hover?.kind === 'close';
        ctx.fillStyle = closeHover ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)';
        roundRect(ctx, cb.x, cb.y, cb.w, cb.h, 4);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cb.x + 6, cb.y + 6); ctx.lineTo(cb.x + cb.w - 6, cb.y + cb.h - 6);
        ctx.moveTo(cb.x + cb.w - 6, cb.y + 6); ctx.lineTo(cb.x + 6, cb.y + cb.h - 6);
        ctx.stroke();
        this.regions.push({ ...cb, kind: 'close' });
    }

    private drawCodeSection(cssW: number): void {
        const ctx = this.ctx;
        const x = PANEL_PADDING;
        const y = PANEL_PADDING + HEADER_H;
        const w = cssW - PANEL_PADDING * 2;
        const h = CODE_SECTION_H - 10;

        // Section background
        ctx.fillStyle = 'rgba(74, 144, 226, 0.15)';
        ctx.strokeStyle = '#4a90e2';
        ctx.lineWidth = 2;
        roundRect(ctx, x, y, w, h, 10);
        ctx.fill();
        ctx.stroke();

        // Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Redeem Code', x + 15, y + 12);

        // Input + button
        const fieldY = y + 45;
        const fieldH = 40;
        const buttonW = 110;
        const buttonGap = 10;
        const fieldX = x + 15;
        const fieldW = w - 30 - buttonGap - buttonW;
        const buttonX = fieldX + fieldW + buttonGap;

        // Input box
        const inputHover = this.hover?.kind === 'input';
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.strokeStyle = this.codeFocused ? '#ffffff' : (inputHover ? '#7eb9f7' : '#4a90e2');
        ctx.lineWidth = 2;
        roundRect(ctx, fieldX, fieldY, fieldW, fieldH, 5);
        ctx.fill();
        ctx.stroke();

        // Text + caret (clipped to field)
        ctx.save();
        ctx.beginPath();
        ctx.rect(fieldX + 4, fieldY, fieldW - 8, fieldH);
        ctx.clip();
        ctx.font = '16px Ubuntu, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.codeText ? '#ffffff' : 'rgba(255,255,255,0.45)';
        const display = this.codeText || (this.codeFocused ? '' : 'Enter code...');
        const textY = fieldY + fieldH / 2;
        const beforeCaret = this.codeText.slice(0, this.codeCaret);
        const beforeCaretW = ctx.measureText(beforeCaret).width;
        // Auto-scroll text so the caret stays inside the visible area.
        const visibleW = fieldW - 16;
        const scrollX = Math.max(0, beforeCaretW - visibleW);
        ctx.fillText(display, fieldX + 8 - scrollX, textY);

        if (this.codeFocused && this.shouldShowCaret()) {
            const caretX = fieldX + 8 - scrollX + beforeCaretW;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(caretX, fieldY + 8);
            ctx.lineTo(caretX, fieldY + fieldH - 8);
            ctx.stroke();
        }
        ctx.restore();

        this.regions.push({ x: fieldX, y: fieldY, w: fieldW, h: fieldH, kind: 'input' });

        // Redeem button
        const btnHover = this.hover?.kind === 'redeem';
        ctx.fillStyle = btnHover ? '#5fa1ed' : '#4a90e2';
        roundRect(ctx, buttonX, fieldY, buttonW, fieldH, 5);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Redeem', buttonX + buttonW / 2, fieldY + fieldH / 2);
        this.regions.push({ x: buttonX, y: fieldY, w: buttonW, h: fieldH, kind: 'redeem' });
    }

    private drawTabs(cssW: number): void {
        const ctx = this.ctx;
        const y = PANEL_PADDING + HEADER_H + CODE_SECTION_H;
        const tabW = 130;
        const tabH = 40;
        const tabs: Array<{ id: 'shop' | 'challenges'; label: string }> = [
            { id: 'shop', label: 'Shop' },
            { id: 'challenges', label: 'Challenges' },
        ];

        for (let i = 0; i < tabs.length; i++) {
            const t = tabs[i];
            const tx = PANEL_PADDING + i * (tabW + 10);
            const active = this.activeTab === t.id;
            const hov = this.hover?.kind === 'tab' && this.hover.payload === t.id;
            ctx.fillStyle = active ? 'rgba(255,255,255,0.25)' : (hov ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)');
            roundRect(ctx, tx, y, tabW, tabH, 6);
            ctx.fill();
            ctx.fillStyle = active ? '#ffffff' : 'rgba(255,255,255,0.7)';
            ctx.font = 'bold 16px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(t.label, tx + tabW / 2, y + tabH / 2);
            if (active) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(tx, y + tabH - 2, tabW, 2);
            }
            this.regions.push({ x: tx, y, w: tabW, h: tabH, kind: 'tab', payload: t.id });
        }

        // Divider under tabs
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PANEL_PADDING, y + tabH);
        ctx.lineTo(cssW - PANEL_PADDING, y + tabH);
        ctx.stroke();
    }

    private drawShopItems(x: number, y: number, w: number, h: number): void {
        const ctx = this.ctx;
        const player = this.game.getLocalPlayer();
        const stars = player?.stars ?? 0;

        const cardSize = ITEM_SIZE;
        const cols = Math.max(1, Math.floor((w + ITEM_GAP) / (cardSize + ITEM_GAP)));
        const scroll = this.scrollOffsets.shop;
        let col = 0, row = 0;
        const startX = x + 6;
        const startY = y + 6;

        for (const petalType of this.allPetalTypes) {
            const commonStats = getPetalStats(petalType, 'common');
            if (commonStats?.isAdminPetal) continue;

            for (const rarity of this.buyableRarities) {
                const stats = getPetalStats(petalType, rarity);
                if (!stats) continue;

                const price = getShopPrice(petalType, rarity);
                const cx = startX + col * (cardSize + ITEM_GAP);
                const cy = startY + row * (cardSize + ITEM_GAP) - scroll;
                col++;
                if (col >= cols) { col = 0; row++; }

                // Skip cards entirely outside the visible window. We also skip
                // their hit-regions — otherwise scrolled-off cards leak click
                // targets up into the tabs/header area above the content rect.
                if (cy + cardSize <= y || cy >= y + h) continue;

                const disabled = stars < price;
                const hov = !disabled && this.hover?.kind === 'item' &&
                    this.hover.payload?.petalType === petalType && this.hover.payload?.rarity === rarity;
                const rarityColor = this.ITEM_RARITY_COLORS[rarity] || '#ffffff';

                // Background
                ctx.save();
                if (hov) {
                    ctx.shadowColor = 'rgba(0,0,0,0.4)';
                    ctx.shadowBlur = 6;
                    ctx.shadowOffsetY = 2;
                }
                ctx.fillStyle = rarityColor;
                ctx.globalAlpha = disabled ? 0.45 : 1;
                roundRect(ctx, cx, cy, cardSize, cardSize, 4);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.restore();

                // Border
                ctx.strokeStyle = hov ? '#ffffff' : 'rgba(0,0,0,0.3)';
                ctx.lineWidth = 2;
                roundRect(ctx, cx, cy, cardSize, cardSize, 4);
                ctx.stroke();

                // Petal icon
                ctx.save();
                ctx.globalAlpha = disabled ? 0.5 : 1;
                if (this.game.getPetalCanvas) {
                    const petalCv = this.game.getPetalCanvas(petalType, rarity);
                    if (petalCv) {
                        const iconX = cx + (cardSize - ITEM_ICON) / 2;
                        const iconY = cy + 2;
                        ctx.drawImage(petalCv, iconX, iconY, ITEM_ICON, ITEM_ICON);
                    }
                }
                ctx.restore();

                // Price bar
                ctx.fillStyle = 'rgba(0,0,0,0.8)';
                ctx.fillRect(cx, cy + cardSize - ITEM_PRICE_BAR_H, cardSize, ITEM_PRICE_BAR_H);
                ctx.fillStyle = disabled ? '#e74c3c' : '#ffd700';
                ctx.font = 'bold 9px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(
                    formatPrice(price),
                    cx + cardSize / 2,
                    cy + cardSize - ITEM_PRICE_BAR_H / 2
                );

                this.regions.push({
                    x: cx, y: cy, w: cardSize, h: cardSize, kind: 'item',
                    payload: { petalType, rarity, price, stats }, disabled
                });
            }
        }

        const totalRows = row + (col > 0 ? 1 : 0);
        this.contentHeights.shop = totalRows * (cardSize + ITEM_GAP) + 12;
    }

    private drawChallenges(x: number, y: number, w: number, _h: number): void {
        const ctx = this.ctx;
        const player = this.game.getLocalPlayer();
        const currentStars = player?.stars ?? 0;
        const scroll = this.scrollOffsets.challenges;

        let cursorY = y + 10 - scroll;

        // Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Earn Stars by Defeating Mythic+ Mobs', x + w / 2, cursorY);
        cursorY += 32;

        // Current stars line
        const text = `${currentStars.toLocaleString()} Stars`;
        ctx.font = 'bold 18px Ubuntu, sans-serif';
        const textW = ctx.measureText(text).width;
        const iconSize = 22;
        const gap = 8;
        const totalW = iconSize + gap + textW;
        const tx = x + (w - totalW) / 2;
        if (this.starIcon && this.starIcon.complete) {
            ctx.drawImage(this.starIcon, tx, cursorY, iconSize, iconSize);
        }
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx + iconSize + gap, cursorY + iconSize / 2);
        cursorY += 40;

        const challengeTiers = [
            { tier: 'mythic', stars: 1, color: '#1fdbde', description: 'Defeat any Mythic tier mob' },
            { tier: 'ultra', stars: 5, color: '#de1f65', description: 'Defeat any Ultra tier mob' },
            { tier: 'super', stars: 25, color: '#2bffa4', description: 'Defeat any Super tier mob' },
            { tier: 'unique', stars: 100, color: '#bf00ff', description: 'Defeat any Unique tier mob' },
        ];

        const cardW = w - 12;
        const cardH = 92;
        for (const c of challengeTiers) {
            // Card background
            ctx.fillStyle = c.color;
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 2;
            roundRect(ctx, x + 6, cursorY, cardW, cardH, 10);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(`${c.tier.charAt(0).toUpperCase() + c.tier.slice(1)} Challenge`, x + 18, cursorY + 12);

            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.font = '14px Ubuntu, sans-serif';
            ctx.fillText(c.description, x + 18, cursorY + 36);

            // Reward
            const rewardText = `${c.stars} Star${c.stars !== 1 ? 's' : ''}`;
            const rIconSize = 18;
            if (this.starIcon && this.starIcon.complete) {
                ctx.drawImage(this.starIcon, x + 18, cursorY + 60, rIconSize, rIconSize);
            }
            ctx.fillStyle = '#ffd700';
            ctx.font = 'bold 16px Ubuntu, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(rewardText, x + 18 + rIconSize + 8, cursorY + 60 + rIconSize / 2);

            cursorY += cardH + 12;
        }

        this.contentHeights.challenges = cursorY - (y + 10 - scroll) + 10;
    }

    private drawScrollbar(x: number, y: number, h: number): void {
        const tabKey = this.activeTab;
        const total = this.contentHeights[tabKey];
        if (total <= h) return;
        const offset = this.scrollOffsets[tabKey];
        const trackH = h;
        const thumbH = Math.max(20, (h / total) * trackH);
        const thumbY = y + (offset / (total - h)) * (trackH - thumbH);
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        roundRect(ctx, x, y, SCROLLBAR_W, trackH, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        roundRect(ctx, x, thumbY, SCROLLBAR_W, thumbH, 3);
        ctx.fill();
    }

    private drawModal(cssW: number, cssH: number): void {
        const m = this.modal!;
        const ctx = this.ctx;
        // Dim overlay
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, cssW, cssH);

        const boxW = Math.min(440, cssW - 60);
        const boxH = 170;
        const bx = (cssW - boxW) / 2;
        const by = (cssH - boxH) / 2;

        ctx.fillStyle = '#2c3e50';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        roundRect(ctx, bx, by, boxW, boxH, 10);
        ctx.fill();
        ctx.stroke();

        // Message — wrap to fit
        ctx.fillStyle = m.type === 'alert' && m.color ? m.color : '#ffffff';
        ctx.font = '16px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        wrapText(ctx, m.message, bx + boxW / 2, by + 30, boxW - 30, 22);

        // Buttons
        const btnH = 36;
        const btnGap = 12;
        const buttons: Array<{ label: string; bg: string; action: 'confirm' | 'cancel' | 'close' }> =
            m.type === 'confirm'
                ? [
                    { label: 'Cancel', bg: '#7f8c8d', action: 'cancel' },
                    { label: 'Buy', bg: '#4a90e2', action: 'confirm' },
                ]
                : [
                    { label: 'OK', bg: '#4a90e2', action: 'close' },
                ];
        const btnW = 100;
        const totalBtnW = buttons.length * btnW + (buttons.length - 1) * btnGap;
        let bxStart = bx + (boxW - totalBtnW) / 2;
        const btnY = by + boxH - btnH - 18;
        for (const b of buttons) {
            const hov = this.hover?.kind === 'modal-button' && this.hover.payload === b.action;
            ctx.fillStyle = hov ? lighten(b.bg, 0.15) : b.bg;
            roundRect(ctx, bxStart, btnY, btnW, btnH, 6);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 15px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.label, bxStart + btnW / 2, btnY + btnH / 2);
            this.regions.push({
                x: bxStart, y: btnY, w: btnW, h: btnH,
                kind: 'modal-button', payload: b.action
            });
            bxStart += btnW + btnGap;
        }
    }

    private shouldShowCaret(): boolean {
        const since = performance.now() - this.caretAnchorMs;
        return Math.floor(since / CARET_BLINK_MS) % 2 === 0;
    }

    /* ----------------------------- Input handling ----------------------------- */

    private getMouseLocal(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private hitTest(x: number, y: number): HitRegion | null {
        // If a modal is open, only modal regions are hittable.
        const regions = this.modal
            ? this.regions.filter(r => r.kind === 'modal-button')
            : this.regions;
        // Iterate in reverse so the last-drawn region (top-most) wins.
        for (let i = regions.length - 1; i >= 0; i--) {
            const r = regions[i];
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
        }
        return null;
    }

    private handleMouseMove(e: MouseEvent): void {
        if (!this.isShopOpen) return;
        const { x, y } = this.getMouseLocal(e);
        const r = this.hitTest(x, y);
        const same = (a: HitRegion | null, b: HitRegion | null) => {
            if (!a && !b) return true;
            if (!a || !b) return false;
            return a.kind === b.kind && JSON.stringify(a.payload) === JSON.stringify(b.payload);
        };
        if (!same(this.hover, r)) {
            this.hover = r;
            this.canvas.style.cursor = r && !r.disabled ? 'pointer' : 'default';
            if (r?.kind === 'input') this.canvas.style.cursor = 'text';
            this.requestDraw();
        }
    }

    private handleMouseDown(e: MouseEvent): void {
        if (!this.isShopOpen) return;
        const { x, y } = this.getMouseLocal(e);
        const r = this.hitTest(x, y);

        // Click outside input blurs it.
        if (!this.modal) {
            if (r?.kind !== 'input' && this.codeFocused) {
                this.codeFocused = false;
                this.requestDraw();
            }
        }

        if (!r) return;
        if (r.disabled) return;

        switch (r.kind) {
            case 'tab':
                this.activeTab = r.payload;
                this.requestDraw();
                break;
            case 'item':
                this.requestBuy(r.payload);
                break;
            case 'redeem':
                this.submitCode();
                break;
            case 'input':
                if (!this.codeFocused) {
                    this.codeFocused = true;
                    this.caretAnchorMs = performance.now();
                }
                // Position caret based on click x (approximate; full hit-test
                // would require per-glyph measurement). Place at end for now.
                this.codeCaret = this.codeText.length;
                this.requestDraw();
                break;
            case 'close':
                this.closeShop();
                break;
            case 'modal-button':
                this.resolveModal(r.payload);
                break;
        }
    }

    private handleWheel(e: WheelEvent): void {
        if (!this.isShopOpen || this.modal) return;
        e.preventDefault();
        const cssH = window.innerHeight * (2 / 3);
        const contentTop = PANEL_PADDING + HEADER_H + CODE_SECTION_H + TABS_H;
        const contentH = cssH - contentTop - PANEL_PADDING;
        const tabKey = this.activeTab;
        const total = this.contentHeights[tabKey];
        const max = Math.max(0, total - contentH);
        this.scrollOffsets[tabKey] = clamp(this.scrollOffsets[tabKey] + e.deltaY, 0, max);
        this.requestDraw();
    }

    private handleKeyDown(e: KeyboardEvent): void {
        if (!this.isShopOpen) return;

        // Modal keys take precedence.
        if (this.modal) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (this.modal.type === 'confirm') this.resolveModal('cancel');
                else this.resolveModal('close');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.modal.type === 'confirm') this.resolveModal('confirm');
                else this.resolveModal('close');
            }
            return;
        }

        // Esc closes the shop when nothing is focused (parity with the prior UX
        // of pressing the shop hotkey to dismiss).
        if (e.key === 'Escape' && !this.codeFocused) {
            this.closeShop();
            return;
        }

        if (!this.codeFocused) return;

        // Let Cmd/Ctrl+V keep its default behaviour — preventing default on
        // the keydown suppresses the follow-up `paste` event that our
        // document-level listener depends on. Same for Cmd/Ctrl+C/X (no
        // selection model yet) and Cmd/Ctrl+A.
        const isClipboardCombo = (e.ctrlKey || e.metaKey) &&
            (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'a');
        if (isClipboardCombo) {
            // Paste flow: navigator.clipboard.readText() is a fallback; the
            // primary handler is the document `paste` event triggered by the
            // browser's default action.
            if (e.key.toLowerCase() === 'v') this.tryClipboardRead();
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Backspace') {
            if (this.codeCaret > 0) {
                this.codeText = this.codeText.slice(0, this.codeCaret - 1) + this.codeText.slice(this.codeCaret);
                this.codeCaret--;
                this.caretAnchorMs = performance.now();
            }
        } else if (e.key === 'Delete') {
            if (this.codeCaret < this.codeText.length) {
                this.codeText = this.codeText.slice(0, this.codeCaret) + this.codeText.slice(this.codeCaret + 1);
                this.caretAnchorMs = performance.now();
            }
        } else if (e.key === 'ArrowLeft') {
            this.codeCaret = Math.max(0, this.codeCaret - 1);
            this.caretAnchorMs = performance.now();
        } else if (e.key === 'ArrowRight') {
            this.codeCaret = Math.min(this.codeText.length, this.codeCaret + 1);
            this.caretAnchorMs = performance.now();
        } else if (e.key === 'Home') {
            this.codeCaret = 0;
            this.caretAnchorMs = performance.now();
        } else if (e.key === 'End') {
            this.codeCaret = this.codeText.length;
            this.caretAnchorMs = performance.now();
        } else if (e.key === 'Enter') {
            this.submitCode();
        } else if (e.key === 'Escape') {
            this.codeFocused = false;
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Single printable character
            if (this.codeText.length < 64) {
                this.codeText = this.codeText.slice(0, this.codeCaret) + e.key + this.codeText.slice(this.codeCaret);
                this.codeCaret++;
                this.caretAnchorMs = performance.now();
            }
        } else {
            return;
        }
        this.requestDraw();
    }

    /* ----------------------------- Actions ----------------------------- */

    private requestBuy(payload: { petalType: string; rarity: Rarity; price: number; stats: any }): void {
        const { petalType, rarity, price, stats } = payload;
        const player = this.game.getLocalPlayer();
        if (!player || (player.stars ?? 0) < price) return;
        const petalName = stats?.name || petalType;
        this.modal = {
            type: 'confirm',
            message: `Buy ${petalName} (${rarity}) for ${price.toLocaleString()} stars?`,
            onConfirm: () => {
                const socket = this.game.getSocket();
                if (socket) socket.emit('shopBuy', { petalType, rarity, price });
            }
        };
        this.requestDraw();
    }

    private handlePaste(e: ClipboardEvent): void {
        // Only intercept paste when the canvas input is the "focused" field —
        // otherwise we'd hijack pastes meant for the real <input>s elsewhere
        // (chat, guild menu, etc.).
        if (!this.isShopOpen || !this.codeFocused || this.modal) return;
        const text = e.clipboardData?.getData('text');
        if (text === undefined || text === '') return;
        e.preventDefault();
        this.insertText(text);
    }

    private insertText(text: string): void {
        if (!text) return;
        // Strip non-printable chars (newlines, control chars) — codes are
        // single-line strings. Cap at 64 to match the typed-input limit.
        const sanitized = text.replace(/[^\x20-\x7E]/g, '').slice(0, 64 - this.codeText.length);
        if (!sanitized) return;
        this.codeText = this.codeText.slice(0, this.codeCaret) + sanitized + this.codeText.slice(this.codeCaret);
        this.codeCaret += sanitized.length;
        this.caretAnchorMs = performance.now();
        this.requestDraw();
    }

    private tryClipboardRead(): void {
        // Async clipboard API requires HTTPS/localhost + a recent user gesture.
        // We swallow errors here because the document-level `paste` listener
        // (installed in the constructor) is the primary path; this only runs
        // as a fallback for browsers that don't dispatch paste on the document.
        const clip = (navigator as Navigator).clipboard;
        if (!clip || typeof clip.readText !== 'function') return;
        try {
            const p = clip.readText();
            if (!p || typeof p.then !== 'function') return;
            p.then(t => this.insertText(t)).catch(err => {
                console.warn('[shop] clipboard.readText failed:', err);
            });
        } catch (err) {
            console.warn('[shop] clipboard.readText threw:', err);
        }
    }

    private submitCode(): void {
        const code = this.codeText.trim();
        if (!code) {
            this.modal = { type: 'alert', message: 'Please enter a code', color: '#e74c3c' };
            this.requestDraw();
            return;
        }
        const socket = this.game.getSocket();
        if (!socket) return;
        socket.emit('redeemCode', { code });
        this.codeText = '';
        this.codeCaret = 0;
        this.requestDraw();
    }

    private resolveModal(action: 'confirm' | 'cancel' | 'close'): void {
        const m = this.modal;
        if (!m) return;
        this.modal = null;
        if (m.type === 'confirm') {
            if (action === 'confirm') m.onConfirm();
            else m.onCancel?.();
        } else {
            m.onClose?.();
        }
        this.requestDraw();
    }
}

/* ----------------------------- Helpers ----------------------------- */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    if (typeof (ctx as any).roundRect === 'function') {
        ctx.beginPath();
        (ctx as any).roundRect(x, y, w, h, r);
        return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxWidth: number, lineH: number): void {
    const words = text.split(/\s+/);
    let line = '';
    let cy = y;
    for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, cx, cy);
            cy += lineH;
            line = w;
        } else {
            line = test;
        }
    }
    if (line) ctx.fillText(line, cx, cy);
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : (v > hi ? hi : v);
}

function lighten(hex: string, amt: number): string {
    // Cheap "lighten" for hover hint — interpolate towards white.
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const lr = Math.round(r + (255 - r) * amt);
    const lg = Math.round(g + (255 - g) * amt);
    const lb = Math.round(b + (255 - b) * amt);
    return `rgb(${lr},${lg},${lb})`;
}

function formatPrice(n: number): string {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10_000) return (n / 1_000).toFixed(0) + 'k';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toString();
}
