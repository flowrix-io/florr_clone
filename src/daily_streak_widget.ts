/**
 * DailyStreakWidget
 *
 * Persistent canvas widget in the top-right corner showing the player's
 * daily streak. Panel chrome (rounded corners + darkened border) mirrors
 * the canvas inventory panel so the two read as part of the same UI kit.
 */

import { drawText } from './graphics/text';
import { darken } from './graphics/shapes';

export interface DailyStreakState {
    streak: number;
    newDay: boolean;
    starsAwarded: number;
    nextClaimAtMs: number;
    streakExpiresAtMs: number;
}


function formatDuration(ms: number): string {
    if (ms <= 0) return '0s';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

export class DailyStreakWidget {
    private static readonly PANEL_BG = '#66ffff';
    private static readonly PANEL_BORDER = darken(DailyStreakWidget.PANEL_BG);
    private static readonly PANEL_RADIUS = 3;
    private static readonly BORDER_W = 4;
    private static readonly WIDTH = 220;
    private static readonly HEIGHT = 150;
    // How long the star wobbles after a claim before the widget settles.
    private static readonly PULSE_MS = 3000;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private state: DailyStreakState | null = null;
    private rafId: number | null = null;
    private timerId: number | null = null;
    private running = false;
    // Matches the canvas's initial state: appended with no display override.
    private visible = true;
    private pulseUntilMs = 0;
    private lastSig = '';

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'dailyStreakWidget';
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = DailyStreakWidget.WIDTH * dpr;
        this.canvas.height = DailyStreakWidget.HEIGHT * dpr;
        const s = this.canvas.style;
        s.setProperty('position', 'fixed', 'important');
        s.setProperty('top', '16px', 'important');
        s.setProperty('right', '16px', 'important');
        s.setProperty('left', 'auto', 'important');
        s.setProperty('bottom', 'auto', 'important');
        s.setProperty('width', `${DailyStreakWidget.WIDTH}px`, 'important');
        s.setProperty('height', `${DailyStreakWidget.HEIGHT}px`, 'important');
        s.setProperty('z-index', '3000', 'important');
        s.setProperty('pointer-events', 'none', 'important');
        s.setProperty('margin', '0', 'important');
        s.setProperty('filter', 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))');
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('2D context unavailable');
        this.ctx = ctx;
        this.ctx.scale(dpr, dpr);
        document.body.appendChild(this.canvas);
    }

    update(state: DailyStreakState): void {
        this.state = state;
        // Wobble to celebrate a fresh claim, but only briefly. `newDay` is sent
        // once at login and stays true for the whole session, so keying the
        // animation off it alone meant the widget never stopped animating.
        if (state.newDay) this.pulseUntilMs = performance.now() + DailyStreakWidget.PULSE_MS;
        this.lastSig = '';
        // Restart the schedule so the new state (and any pulse) shows on this
        // frame instead of at the next one-second tick.
        this.stopAnimating();
        if (this.visible) this.startAnimating();
    }

    show(): void {
        this.canvas.style.setProperty('display', 'block', 'important');
        this.visible = true;
        this.lastSig = '';
        if (this.state) this.startAnimating();
    }

    hide(): void {
        this.canvas.style.setProperty('display', 'none', 'important');
        this.visible = false;
        // A display:none canvas keeps its bitmap, so there is nothing to redraw
        // until it comes back — drop the timer entirely rather than tick blind.
        this.stopAnimating();
    }

    private startAnimating(): void {
        if (this.running) return;
        this.running = true;
        this.step();
    }

    private stopAnimating(): void {
        this.running = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    }

    /**
     * One draw-if-needed step, which then reschedules itself.
     *
     * A full redraw is not cheap — two roundRect fills, a Path2D star stroked at
     * 36px with round joins, and five stroked text runs — and this used to run on
     * every display frame for as long as the title screen was up, even though the
     * only thing that changes is a second-granularity countdown. Now the rAF loop
     * runs solely while the post-claim wobble is animating; once that settles the
     * widget wakes once per second, on the second boundary, and redraws only when
     * the rendered text actually differs (so an hours-away countdown, which reads
     * `2h 14m`, costs one redraw per minute).
     */
    private step(): void {
        this.rafId = null;
        this.timerId = null;
        if (!this.running) return;

        const pulseLeft = this.pulseUntilMs - performance.now();
        const pulsing = pulseLeft > 0;
        this.drawIfChanged(pulsing ? pulseLeft / DailyStreakWidget.PULSE_MS : 0);

        if (pulsing) {
            this.rafId = requestAnimationFrame(() => this.step());
        } else {
            // Land just past the next whole second so the countdown ticks over
            // promptly instead of drifting up to a second behind.
            this.timerId = window.setTimeout(() => this.step(), 1000 - (Date.now() % 1000) + 5);
        }
    }

    /** Skip the redraw entirely when nothing on the widget would look different. */
    private drawIfChanged(pulseAmount: number): void {
        const state = this.state;
        if (!state) return;
        const now = Date.now();
        const text = this.computeText(state, now);
        if (pulseAmount > 0) {
            // The star is mid-wobble; every frame differs regardless of the text.
            this.lastSig = '';
        } else {
            const sig = `${text.cycleDay}|${text.status}|${text.nextText}|${text.resetText}`;
            if (sig === this.lastSig) return;
            this.lastSig = sig;
        }
        this.draw(state, text, pulseAmount);
    }

    /** Everything the widget renders that can change over time. */
    private computeText(state: DailyStreakState, now: number) {
        const claimed = now < state.nextClaimAtMs;
        return {
            cycleDay: state.streak > 0 ? ((state.streak - 1) % 5) + 1 : 0,
            status: claimed ? `Claimed · Day ${state.streak}` : 'Ready to claim!',
            claimed,
            nextText: claimed ? `Next: ${formatDuration(state.nextClaimAtMs - now)}` : 'Next: now',
            resetText: `Resets: ${formatDuration(state.streakExpiresAtMs - now)}`,
        };
    }

    private draw(
        state: DailyStreakState,
        text: ReturnType<DailyStreakWidget['computeText']>,
        pulseAmount: number,
    ): void {
        const ctx = this.ctx;
        const W = DailyStreakWidget.WIDTH;
        const H = DailyStreakWidget.HEIGHT;
        ctx.clearRect(0, 0, W, H);

        const radius = DailyStreakWidget.PANEL_RADIUS;
        const borderW = DailyStreakWidget.BORDER_W;
        ctx.fillStyle = DailyStreakWidget.PANEL_BORDER;
        ctx.beginPath();
        (ctx as any).roundRect(0, 0, W, H, radius);
        ctx.fill();
        ctx.fillStyle = DailyStreakWidget.PANEL_BG;
        ctx.beginPath();
        (ctx as any).roundRect(borderW, borderW, W - borderW * 2, H - borderW * 2, Math.max(0, radius - 2));
        ctx.fill();

        const cycleDay = text.cycleDay;

        // ----- Single star centered near the top -----
        const starCx = W / 2;
        const starCy = 40;
        // Amplitude decays with the remaining pulse time so the wobble eases out
        // instead of snapping back to rest when the animation stops.
        const pulse = pulseAmount > 0
            ? 1 + Math.sin(performance.now() / 140) * 0.08 * pulseAmount
            : 1;
        this.drawStar(ctx, starCx, starCy, 22 * pulse, cycleDay > 0, state.newDay);

        // Number inside star (cycle day)
        if (cycleDay > 0) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const label = `${cycleDay}`;
            drawText(ctx, label, starCx, starCy + 1, { size: 16, weight: 'bold', fill: '#ffffff', strokeWidth: 3 });
        }

        // ----- Claim status below the star -----
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const statusY = 74;
        drawText(ctx, text.status, W / 2, statusY, { size: 13, weight: 'bold', fill: text.claimed ? '#ffffff' : '#ffe65d', strokeWidth: 3 });

        // ----- Countdown lines -----
        ctx.textAlign = 'left';

        const nextText = text.nextText;
        const resetText = text.resetText;

        const lineY1 = 100;
        const lineY2 = 120;
        drawText(ctx, nextText, 12, lineY1, { size: 11, fill: '#ffffff', strokeWidth: 2.5 });
        drawText(ctx, resetText, 12, lineY2, { size: 11, fill: '#ffffff', strokeWidth: 2.5 });
    }

    // Path from GAME_ICONS_NET_ICONS 'stars' (viewBox 0 0 512 512).
    private static readonly STAR_PATH = new Path2D(
        'M256 38.013c-22.458 0-66.472 110.3-84.64 123.502-18.17 13.2-136.674 20.975-143.614 42.334-6.94 21.358 84.362 97.303 91.302 118.662 6.94 21.36-22.286 136.465-4.116 149.665 18.17 13.2 118.61-50.164 141.068-50.164 22.458 0 122.9 63.365 141.068 50.164 18.17-13.2-11.056-128.306-4.116-149.665 6.94-21.36 98.242-97.304 91.302-118.663-6.94-21.36-125.444-29.134-143.613-42.335-18.168-13.2-62.182-123.502-84.64-123.502z'
    );

    private drawStar(
        ctx: CanvasRenderingContext2D,
        cx: number, cy: number, r: number,
        earned: boolean, highlight: boolean,
    ): void {
        ctx.save();
        // The SVG is 512x512 centered at (256,256); fit so radius r ≈ half the icon.
        const scale = (r * 2) / 512;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-256, -256);
        ctx.lineWidth = 36;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        ctx.stroke(DailyStreakWidget.STAR_PATH);
        ctx.fillStyle = earned ? (highlight ? '#fff28a' : '#ffe65d') : '#8a4858';
        ctx.fill(DailyStreakWidget.STAR_PATH);
        ctx.restore();
    }
}
