/**
 * Title-screen icon-button strip rendered on the shared title canvas.
 *
 * Two groups: a horizontal row at top-left (settings / changelog /
 * notifications / leaderboard / guild / discord) and a vertical column at
 * bottom-left (inventory / skills / mob gallery / shop / craft). Mirrors the
 * legacy DOM `gardn-icon-btn` look — solid bg, darker border, 32x32 SVG icon, hover
 * brightens, press dims, changelog button can shake when there's unread.
 */

import { GAME_ICONS_NET_ICONS } from '../game-icons-net-icons';
import { drawRoundedRect } from '../graphics/shapes';

export type TitleButtonId =
    | 'settings'
    | 'changelog'
    | 'notifications'
    | 'leaderboard'
    | 'guild'
    | 'skins'
    | 'discord'
    | 'debug'
    | 'exit'
    | 'inventory'
    | 'skills'
    | 'mobGallery'
    | 'shop'
    | 'craft';

export interface TitleButtonHandlers {
    onClick: (id: TitleButtonId) => void;
}

interface ButtonDef {
    id: TitleButtonId;
    iconName: string;     // key into GAME_ICONS_NET_ICONS
    bg: string;
    border: string;
    group: 'top' | 'bottom';
}

interface ButtonRect extends ButtonDef {
    x: number;
    y: number;
    w: number;
    h: number;
    icon: HTMLImageElement | null;
    visible: boolean;
    /** performance.now() when this button last became visible; 0 = no slide active */
    slideInStart: number;
}

const SLIDE_DURATION_MS = 50;
const SLIDE_STAGGER_MS = 40;

function easeOutCubic(t: number): number {
    return 1 - (1 - t) ** 3;
}

const BUTTON_SIZE = 42;
const BUTTON_GAP = 10;
const GROUP_INSET = 20;
const BORDER_WIDTH = 4;
// The DOM rule sets svg width/height to 32px, but the button's content box
// (border-box 42 minus 2×4 border minus 2×5 padding = 24×24) is smaller than
// 32, so flex shrinks the SVG main-axis size and preserveAspectRatio="meet"
// scales the icon down uniformly. Visible icon ≈ 24×24, matching that here.
const ICON_SIZE = 24;
const CORNER_RADIUS = 3;

const BUTTON_DEFS: ButtonDef[] = [
    { id: 'settings',      iconName: 'settings',      bg: '#b3b3b3', border: '#8f8f8f', group: 'top' },
    { id: 'changelog',     iconName: 'changelog',     bg: '#00db3e', border: '#00af32', group: 'top' },
    { id: 'notifications', iconName: 'notifications', bg: '#4a90e2', border: '#3b73b5', group: 'top' },
    { id: 'leaderboard',   iconName: 'leaderboard',   bg: '#e8a023', border: '#ba801c', group: 'top' },
    { id: 'guild',         iconName: 'guild',         bg: '#27dade', border: '#1fb3b0', group: 'top' },
    { id: 'skins',         iconName: 'skins',         bg: '#c45cff', border: '#9a3fd0', group: 'top' },
    { id: 'discord',       iconName: 'discord',       bg: '#5865f2', border: '#4752c4', group: 'top' },
    // Debug slot: only visible when "Enable Debug Menu" is on in settings.
    { id: 'debug',         iconName: 'debug',         bg: '#666666', border: '#4d4d4d', group: 'top' },
    // Exit slot: only visible in-game; appended to the right of the top row.
    { id: 'exit',          iconName: 'exit_button',   bg: '#ff0000', border: '#cc0000', group: 'top' },

    { id: 'inventory',  iconName: 'inventory',   bg: '#00b3ff', border: '#008fcc', group: 'bottom' },
    { id: 'skills',     iconName: 'skills',      bg: '#9d4edd', border: '#7e3eb1', group: 'bottom' },
    { id: 'mobGallery', iconName: 'mob_gallery', bg: '#d6c206', border: '#ab9b05', group: 'bottom' },
    { id: 'shop',       iconName: 'stars',       bg: '#36d153', border: '#2ba742', group: 'bottom' },
    { id: 'craft',      iconName: 'craft',       bg: '#ff9d00', border: '#cc7e00', group: 'bottom' },
];

function loadIconImage(iconName: string): HTMLImageElement | null {
    const entry = GAME_ICONS_NET_ICONS.find((i: any) => i.name === iconName);
    if (!entry || !entry.value) return null;
    let svg = entry.value as string;
    // The DOM path forces SVGs to 32x32 via a `.gardn-icon-btn svg { width:
    // 32px !important; ... }` rule. We can't apply external CSS to an Image
    // loaded from a data URL — the SVG's own attributes/inline style wins.
    // game-icons-net ships SVGs with `style="height:512px; width:512px"` AND
    // a viewBox of 0 0 512 512, so without intervention the Image's intrinsic
    // size is 512x512, drawImage downscales 16x and the icon paths render
    // visibly thicker / blurrier than the DOM version. Strip the inline style
    // so the width/height attributes we add take effect.
    svg = svg.replace(/\s*style="[^"]*"/, '');
    if (svg.includes('viewBox="0 0 512 512"') && !/<svg[^>]*\swidth=/.test(svg)) {
        svg = svg.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
    } else if (/width="512px"/.test(svg)) {
        svg = svg.replace('width="512px"', 'width="32"').replace('height="512px"', 'height="32"');
    }
    const img = new Image();
    try {
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    } catch {
        return null;
    }
    return img;
}



export class TitleCanvasButtons {
    private buttons: ButtonRect[];
    private hoveredId: TitleButtonId | null = null;
    private pressedId: TitleButtonId | null = null;
    private shakeIds: Set<TitleButtonId> = new Set();
    private handlers: TitleButtonHandlers;
    /** True when the icon strip should not paint (e.g. while connecting). */
    public visible: boolean = true;
    private _initialAnimTriggered = false;

    constructor(handlers: TitleButtonHandlers) {
        this.handlers = handlers;
        this.buttons = BUTTON_DEFS.map((d) => ({
            ...d,
            x: 0, y: 0, w: BUTTON_SIZE, h: BUTTON_SIZE,
            icon: loadIconImage(d.iconName),
            // Exit is in-game only — start hidden; TitleScreen.showExitButton
            // flips it on. Debug is settings-gated — setDebugVisible drives it.
            // Other buttons default to visible.
            visible: d.id !== 'exit' && d.id !== 'debug',
            slideInStart: 0,
        }));
    }

    /** Show or hide the in-game exit button. */
    public setExitVisible(visible: boolean): void {
        const b = this.buttons.find((x) => x.id === 'exit');
        if (!b) return;
        if (visible && !b.visible) b.slideInStart = performance.now();
        else if (!visible) b.slideInStart = 0;
        b.visible = visible;
    }

    /** Show or hide the settings-gated debug button. */
    public setDebugVisible(visible: boolean): void {
        const b = this.buttons.find((x) => x.id === 'debug');
        if (!b) return;
        if (visible && !b.visible) b.slideInStart = performance.now();
        else if (!visible) b.slideInStart = 0;
        b.visible = visible;
    }

    /** Re-layout button rectangles for the current canvas size. Only visible
     *  buttons participate in positioning. */
    public layout(canvasWidth: number, canvasHeight: number): void {
        const top = this.buttons.filter((b) => b.group === 'top' && b.visible);
        top.forEach((b, i) => {
            b.x = GROUP_INSET + i * (BUTTON_SIZE + BUTTON_GAP);
            b.y = GROUP_INSET;
        });
        const bottom = this.buttons.filter((b) => b.group === 'bottom' && b.visible);
        // Stack from top to bottom so the first entry sits at the top of the
        // column (matches the legacy flex-column layout).
        const colHeight = bottom.length * BUTTON_SIZE + (bottom.length - 1) * BUTTON_GAP;
        const colTop = canvasHeight - GROUP_INSET - colHeight;
        bottom.forEach((b, i) => {
            b.x = GROUP_INSET;
            b.y = colTop + i * (BUTTON_SIZE + BUTTON_GAP);
        });
        // canvasWidth currently unused — both groups anchor to the left edge.
        void canvasWidth;
    }

    public setShake(id: TitleButtonId, shake: boolean): void {
        if (shake) this.shakeIds.add(id);
        else this.shakeIds.delete(id);
    }

    /** Paint all buttons. Call after the title UI pass. */
    public draw(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
        if (!this.visible) return;
        this.layout(canvasWidth, canvasHeight);

        const t = performance.now();

        // On the very first draw, assign staggered start times to all initially
        // visible buttons so they cascade in from the left.
        if (!this._initialAnimTriggered) {
            this._initialAnimTriggered = true;
            let stagger = 0;
            for (const b of this.buttons) {
                if (b.visible) {
                    b.slideInStart = t + stagger;
                    stagger += SLIDE_STAGGER_MS;
                }
            }
        }

        ctx.save();
        for (const b of this.buttons) {
            if (!b.visible) continue;
            const hovered = this.hoveredId === b.id;
            const pressed = this.pressedId === b.id;

            // Slide-in offset: button enters from the left edge.
            let xOffset = 0;
            if (b.slideInStart > 0) {
                const elapsed = t - b.slideInStart;
                if (elapsed < 0) {
                    // Stagger delay not yet reached — hold fully off-screen.
                    xOffset = -(b.x + BUTTON_SIZE);
                } else {
                    const progress = Math.min(1, elapsed / SLIDE_DURATION_MS);
                    if (progress < 1) {
                        xOffset = -(b.x + BUTTON_SIZE) * (1 - easeOutCubic(progress));
                    } else {
                        b.slideInStart = 0;
                    }
                }
            }

            ctx.save();

            if (xOffset !== 0) ctx.translate(xOffset, 0);

            // Shake transform: rotate around the button center, ~0.8s loop,
            // matches the legacy CSS @keyframes shake.
            if (this.shakeIds.has(b.id)) {
                const phase = (t % 800) / 800;
                const ang = Math.sin(phase * Math.PI * 2) * (12 * Math.PI / 180);
                ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
                ctx.rotate(ang);
                ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
            }

            // Border + bg via two filled rects (matches CSS border-radius +
            // border-width semantics: outer corner at radius=3, inner corner
            // sharp because radius (3) - border-width (4) clamps to 0).
            // A stroke would put the line CENTER on the path, blowing the
            // outer corner radius up to 3 + half-stroke.
            ctx.fillStyle = b.border;
            drawRoundedRect(ctx, b.x, b.y, b.w, b.h, CORNER_RADIUS);
            ctx.fill();
            ctx.fillStyle = b.bg;
            drawRoundedRect(ctx, b.x + BORDER_WIDTH, b.y + BORDER_WIDTH, b.w - 2 * BORDER_WIDTH, b.h - 2 * BORDER_WIDTH, 0);
            ctx.fill();

            // Hover/press tint via globalAlpha overlay (matches CSS filter).
            if (hovered || pressed) {
                ctx.fillStyle = pressed ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
                drawRoundedRect(ctx, b.x, b.y, b.w, b.h, CORNER_RADIUS);
                ctx.fill();
            }

            // Icon centered. Skip if the SVG hasn't decoded yet — the next
            // frame will pick it up once the Image fires its load event.
            if (b.icon && b.icon.complete && b.icon.naturalWidth > 0) {
                const ix = b.x + (b.w - ICON_SIZE) / 2;
                const iy = b.y + (b.h - ICON_SIZE) / 2;
                ctx.drawImage(b.icon, ix, iy, ICON_SIZE, ICON_SIZE);
            }

            ctx.restore();
        }
        ctx.restore();
    }

    public hitTest(x: number, y: number): TitleButtonId | null {
        for (const b of this.buttons) {
            if (!b.visible) continue;
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                return b.id;
            }
        }
        return null;
    }

    /** Update hover state from a mouse-move on the title canvas. */
    public setHover(x: number, y: number): void {
        this.hoveredId = this.hitTest(x, y);
    }

    public clearHover(): void {
        this.hoveredId = null;
    }

    /** True if the press landed on a button (so the caller can skip its
     *  own UI on this mousedown). */
    public press(x: number, y: number): boolean {
        const hit = this.hitTest(x, y);
        this.pressedId = hit;
        return hit !== null;
    }

    public release(): void {
        this.pressedId = null;
    }

    /**
     * Fire a click if the mouseup landed on the same button as mousedown.
     * Returns true if a click was dispatched.
     */
    public releaseClick(x: number, y: number): boolean {
        const pressed = this.pressedId;
        this.pressedId = null;
        if (!pressed) return false;
        const hit = this.hitTest(x, y);
        if (hit !== pressed) return false;
        this.handlers.onClick(hit);
        return true;
    }

    /** Did the cursor land on any button? Used by the title canvas's hit
     *  tester to short-circuit other UI when the user is over a button. */
    public isPointOnButton(x: number, y: number): boolean {
        return this.hitTest(x, y) !== null;
    }
}
