/**
 * Touch-only HUD for mobile play: a virtual joystick (movement + aim) plus
 * Attack/Retract buttons mirroring the desktop Space/Shift (or LMB/RMB)
 * petal-extension controls. Gated behind the "Request Mobile" setting —
 * see Game.mobileControlsEnabled.
 *
 * The joystick deliberately mirrors the existing "Use Mouse Controls" wire
 * format (direction vector + speed multiplier) rather than inventing a new
 * protocol — see Game.updatePlayerMovement().
 */

interface Point {
    x: number;
    y: number;
}

/**
 * Resolves the "Request Mobile" setting: respects an explicit user choice,
 * otherwise defaults on for coarse-pointer (touch) devices the first time
 * it's ever read. Shared by Game and SettingsMenu so first-run detection
 * agrees regardless of which one reads it first.
 */
export function resolveMobileControlsEnabled(): boolean {
    const stored = localStorage.getItem('requestMobile');
    if (stored === null) {
        return window.matchMedia('(pointer: coarse)').matches;
    }
    return stored === 'true';
}

// Gap above the loadout bar's footprint (see layout()'s loadoutBarHeight
// param) that all three controls anchor above, since the bar already
// extends nearly to the bottom edge on its own and leaves no room below.
const BOTTOM_CLEARANCE_GAP = 15;
// Left offset for the joystick's center. The existing in-game icon-button
// column (inventory/skills/mobGallery/shop/craft — see canvas_buttons.ts's
// BUTTON_DEFS 'bottom' group) also anchors to the bottom-left corner (its
// buttons span x=20 to x=62), so the joystick is shifted right past it
// rather than the natural x = margin + radius, to avoid the two overlapping.
const JOYSTICK_LEFT_CENTER = 150;
// Extra lift above the shared bottom anchor, on top of Attack/Retract's own
// clearance. The chat log (chat.ts's chatContainer) is a fixed 200px-tall
// box anchored 10px from the bottom-left corner, directly behind the
// joystick's column (x=100-400) — clearing the loadout bar alone still
// leaves the joystick sitting visually on top of it. Attack/Retract don't
// need this since they're offset further right, clear of the chat's width.
const JOYSTICK_EXTRA_LIFT = 60;
const JOYSTICK_BASE_RADIUS = 55;
const JOYSTICK_KNOB_RADIUS = 26;
const JOYSTICK_HIT_RADIUS = JOYSTICK_BASE_RADIUS * 1.3;
const JOYSTICK_DEAD_ZONE = 0.12; // fraction of base radius

const ATTACK_BUTTON_RADIUS = 46;
const ATTACK_BUTTON_MARGIN = 30;
const RETRACT_BUTTON_RADIUS = 34;
const RETRACT_BUTTON_GAP = 16;

export class MobileControls {
    private joystickCenter: Point = { x: 0, y: 0 };
    private joystickTouchId: number | null = null;
    private knobOffset: Point = { x: 0, y: 0 };

    private attackCenter: Point = { x: 0, y: 0 };
    private attackTouchId: number | null = null;

    private retractCenter: Point = { x: 0, y: 0 };
    private retractTouchId: number | null = null;

    /**
     * @param loadoutBarHeight Vertical footprint of the loadout bar from the
     * bottom of the canvas (CanvasLoadoutBar.getTotalHeight()). The bar is
     * centered and already extends nearly to the bottom edge on its own, so
     * there's no room below it — the joystick and Attack/Retract buttons
     * anchor above it instead of the raw screen edge.
     */
    public layout(viewW: number, viewH: number, loadoutBarHeight: number = 0): void {
        const bottomY = viewH - loadoutBarHeight - BOTTOM_CLEARANCE_GAP;
        this.joystickCenter = {
            x: JOYSTICK_LEFT_CENTER,
            y: bottomY - JOYSTICK_BASE_RADIUS - JOYSTICK_EXTRA_LIFT,
        };
        this.attackCenter = {
            x: viewW - ATTACK_BUTTON_MARGIN - ATTACK_BUTTON_RADIUS,
            y: bottomY - ATTACK_BUTTON_RADIUS,
        };
        this.retractCenter = {
            x: this.attackCenter.x - ATTACK_BUTTON_RADIUS - RETRACT_BUTTON_GAP - RETRACT_BUTTON_RADIUS,
            y: this.attackCenter.y,
        };
    }

    private dist(a: Point, b: Point): number {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    public handleTouchStart(touches: { identifier: number; x: number; y: number }[]): void {
        for (const t of touches) {
            if (this.joystickTouchId === null && this.dist(t, this.joystickCenter) <= JOYSTICK_HIT_RADIUS) {
                this.joystickTouchId = t.identifier;
                this.updateKnob(t);
                continue;
            }
            if (this.attackTouchId === null && this.dist(t, this.attackCenter) <= ATTACK_BUTTON_RADIUS * 1.2) {
                this.attackTouchId = t.identifier;
                continue;
            }
            if (this.retractTouchId === null && this.dist(t, this.retractCenter) <= RETRACT_BUTTON_RADIUS * 1.2) {
                this.retractTouchId = t.identifier;
            }
        }
    }

    public handleTouchMove(touches: { identifier: number; x: number; y: number }[]): void {
        for (const t of touches) {
            if (t.identifier === this.joystickTouchId) {
                this.updateKnob(t);
            }
        }
    }

    public handleTouchEnd(touches: { identifier: number }[]): void {
        for (const t of touches) {
            if (t.identifier === this.joystickTouchId) {
                this.joystickTouchId = null;
                this.knobOffset = { x: 0, y: 0 };
            }
            if (t.identifier === this.attackTouchId) {
                this.attackTouchId = null;
            }
            if (t.identifier === this.retractTouchId) {
                this.retractTouchId = null;
            }
        }
    }

    private updateKnob(t: Point): void {
        const dx = t.x - this.joystickCenter.x;
        const dy = t.y - this.joystickCenter.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= JOYSTICK_BASE_RADIUS) {
            this.knobOffset = { x: dx, y: dy };
        } else {
            this.knobOffset = { x: (dx / dist) * JOYSTICK_BASE_RADIUS, y: (dy / dist) * JOYSTICK_BASE_RADIUS };
        }
    }

    public getJoystickVector(): { x: number; y: number; magnitude: number } | null {
        if (this.joystickTouchId === null) return null;
        const dist = Math.hypot(this.knobOffset.x, this.knobOffset.y);
        const deadZone = JOYSTICK_BASE_RADIUS * JOYSTICK_DEAD_ZONE;
        if (dist <= deadZone) return null;
        return {
            x: this.knobOffset.x / dist,
            y: this.knobOffset.y / dist,
            magnitude: Math.min(dist / JOYSTICK_BASE_RADIUS, 1),
        };
    }

    public isAttackPressed(): boolean {
        return this.attackTouchId !== null;
    }

    public isRetractPressed(): boolean {
        return this.retractTouchId !== null;
    }

    public draw(ctx: CanvasRenderingContext2D): void {
        ctx.save();

        // Joystick base.
        ctx.beginPath();
        ctx.arc(this.joystickCenter.x, this.joystickCenter.y, JOYSTICK_BASE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.stroke();

        // Joystick knob.
        const knobX = this.joystickCenter.x + this.knobOffset.x;
        const knobY = this.joystickCenter.y + this.knobOffset.y;
        ctx.beginPath();
        ctx.arc(knobX, knobY, JOYSTICK_KNOB_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = this.joystickTouchId !== null ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.4)';
        ctx.fill();

        // Attack button.
        this.drawButton(ctx, this.attackCenter, ATTACK_BUTTON_RADIUS, this.isAttackPressed(), 'rgba(220, 60, 60, 0.55)', 'rgba(255, 120, 120, 0.9)');
        this.drawBurstGlyph(ctx, this.attackCenter, ATTACK_BUTTON_RADIUS * 0.5);

        // Retract button.
        this.drawButton(ctx, this.retractCenter, RETRACT_BUTTON_RADIUS, this.isRetractPressed(), 'rgba(60, 110, 220, 0.55)', 'rgba(120, 170, 255, 0.9)');
        this.drawInwardArrowGlyph(ctx, this.retractCenter, RETRACT_BUTTON_RADIUS * 0.5);

        ctx.restore();
    }

    private drawButton(ctx: CanvasRenderingContext2D, center: Point, radius: number, pressed: boolean, fill: string, stroke: string): void {
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = stroke;
        ctx.stroke();
        if (pressed) {
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.fill();
        }
    }

    private drawBurstGlyph(ctx: CanvasRenderingContext2D, center: Point, size: number): void {
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * size * 0.35, Math.sin(a) * size * 0.35);
            ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawInwardArrowGlyph(ctx: CanvasRenderingContext2D, center: Point, size: number): void {
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const dir of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(dir * size, -size * 0.6);
            ctx.lineTo(dir * size * 0.3, 0);
            ctx.lineTo(dir * size, size * 0.6);
            ctx.stroke();
        }
        ctx.restore();
    }
}
