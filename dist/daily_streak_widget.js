"use strict";
/**
 * DailyStreakWidget
 *
 * Persistent canvas widget in the top-right corner showing the player's
 * daily streak. Panel chrome (rounded corners + darkened border) mirrors
 * the canvas inventory panel so the two read as part of the same UI kit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailyStreakWidget = void 0;
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
function formatDuration(ms) {
    if (ms <= 0)
        return '0s';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0)
        return `${h}h ${m}m`;
    if (m > 0)
        return `${m}m ${s}s`;
    return `${s}s`;
}
class DailyStreakWidget {
    constructor() {
        this.state = null;
        this.rafId = null;
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
        if (!ctx)
            throw new Error('2D context unavailable');
        this.ctx = ctx;
        this.ctx.scale(dpr, dpr);
        document.body.appendChild(this.canvas);
    }
    update(state) {
        this.state = state;
        this.startAnimating();
    }
    show() {
        this.canvas.style.setProperty('display', 'block', 'important');
        if (this.state)
            this.startAnimating();
    }
    hide() {
        this.canvas.style.setProperty('display', 'none', 'important');
        this.stopAnimating();
    }
    startAnimating() {
        if (this.rafId !== null)
            return;
        const tick = () => {
            this.draw();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }
    stopAnimating() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
    draw() {
        const state = this.state;
        if (!state)
            return;
        const ctx = this.ctx;
        const W = DailyStreakWidget.WIDTH;
        const H = DailyStreakWidget.HEIGHT;
        ctx.clearRect(0, 0, W, H);
        const radius = DailyStreakWidget.PANEL_RADIUS;
        const borderW = DailyStreakWidget.BORDER_W;
        ctx.fillStyle = DailyStreakWidget.PANEL_BORDER;
        ctx.beginPath();
        ctx.roundRect(0, 0, W, H, radius);
        ctx.fill();
        ctx.fillStyle = DailyStreakWidget.PANEL_BG;
        ctx.beginPath();
        ctx.roundRect(borderW, borderW, W - borderW * 2, H - borderW * 2, Math.max(0, radius - 2));
        ctx.fill();
        const now = Date.now();
        const claimed = now < state.nextClaimAtMs;
        const cycleDay = state.streak > 0 ? ((state.streak - 1) % 5) + 1 : 0;
        // ----- Single star centered near the top -----
        const starCx = W / 2;
        const starCy = 40;
        const pulseMs = performance.now();
        const pulse = state.newDay ? 1 + Math.sin(pulseMs / 140) * 0.08 : 1;
        this.drawStar(ctx, starCx, starCy, 22 * pulse, cycleDay > 0, state.newDay);
        // Number inside star (cycle day)
        if (cycleDay > 0) {
            ctx.font = 'bold 16px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#000000';
            ctx.fillStyle = '#ffffff';
            const label = `${cycleDay}`;
            ctx.strokeText(label, starCx, starCy + 1);
            ctx.fillText(label, starCx, starCy + 1);
        }
        // ----- Claim status below the star -----
        ctx.font = 'bold 13px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000000';
        const statusY = 74;
        const status = claimed ? `Claimed · Day ${state.streak}` : 'Ready to claim!';
        ctx.strokeText(status, W / 2, statusY);
        ctx.fillStyle = claimed ? '#ffffff' : '#ffe65d';
        ctx.fillText(status, W / 2, statusY);
        // ----- Countdown lines -----
        ctx.font = '11px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.lineWidth = 2.5;
        const nextText = claimed
            ? `Next: ${formatDuration(state.nextClaimAtMs - now)}`
            : 'Next: now';
        const resetText = `Resets: ${formatDuration(state.streakExpiresAtMs - now)}`;
        const lineY1 = 100;
        const lineY2 = 120;
        ctx.strokeStyle = '#000000';
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(nextText, 12, lineY1);
        ctx.fillText(nextText, 12, lineY1);
        ctx.strokeText(resetText, 12, lineY2);
        ctx.fillText(resetText, 12, lineY2);
    }
    drawStar(ctx, cx, cy, r, earned, highlight) {
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
exports.DailyStreakWidget = DailyStreakWidget;
DailyStreakWidget.PANEL_BG = '#66ffff';
DailyStreakWidget.PANEL_BORDER = darken(DailyStreakWidget.PANEL_BG);
DailyStreakWidget.PANEL_RADIUS = 3;
DailyStreakWidget.BORDER_W = 4;
DailyStreakWidget.WIDTH = 220;
DailyStreakWidget.HEIGHT = 150;
// Path from GAME_ICONS_NET_ICONS 'stars' (viewBox 0 0 512 512).
DailyStreakWidget.STAR_PATH = new Path2D('M256 38.013c-22.458 0-66.472 110.3-84.64 123.502-18.17 13.2-136.674 20.975-143.614 42.334-6.94 21.358 84.362 97.303 91.302 118.662 6.94 21.36-22.286 136.465-4.116 149.665 18.17 13.2 118.61-50.164 141.068-50.164 22.458 0 122.9 63.365 141.068 50.164 18.17-13.2-11.056-128.306-4.116-149.665 6.94-21.36 98.242-97.304 91.302-118.663-6.94-21.36-125.444-29.134-143.613-42.335-18.168-13.2-62.182-123.502-84.64-123.502z');
