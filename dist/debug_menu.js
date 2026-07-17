"use strict";
/**
 * Canvas-rendered debug panel, opened from the top-row icon strip (bug icon,
 * visible when the "Enable Debug Menu" checkbox in settings is on; J also
 * toggles it in-game). Shows rolling graphs of client frame time / memory and
 * server tick time / memory. Server samples arrive once per second on the
 * 'debugStats' socket event; client samples are aggregated per second from
 * recordClientFrame() calls made by the render loops.
 *
 * A single module-level instance is shared by TitleScreen (renders it on the
 * title canvas, routes button clicks) and Game (renders it on the game canvas,
 * feeds it socket + frame data), matching how TitleCanvasButtons is shared.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugMenuPanel = exports.DebugMenuPanel = exports.DEBUG_MENU_SETTING_KEY = void 0;
exports.isDebugMenuEnabled = isDebugMenuEnabled;
const render_utils_1 = require("./title_screen/render_utils");
exports.DEBUG_MENU_SETTING_KEY = 'debugMenuEnabled';
function isDebugMenuEnabled() {
    return localStorage.getItem(exports.DEBUG_MENU_SETTING_KEY) === 'true';
}
/** Samples kept per series — one per second, so ~2 minutes of history. */
const HISTORY = 120;
const MB = 1024 * 1024;
function pushSample(series, value) {
    series.push(value);
    if (series.length > HISTORY)
        series.shift();
}
class DebugMenuPanel {
    constructor() {
        this.open = false;
        this.closeHovered = false;
        // Per-second sample series (newest last)
        this.clientFrameMs = [];
        this.clientMemMB = [];
        this.serverTickAvgMs = [];
        this.serverTickMaxMs = [];
        this.serverHeapMB = [];
        this.serverRssMB = [];
        this.lastServerStats = null;
        // Frame-time aggregation state
        this.lastFrameTs = 0;
        this.frameAccumMs = 0;
        this.frameCount = 0;
        this.lastSampleTs = 0;
    }
    isMenuOpen() { return this.open; }
    /** Opens only when the settings checkbox is on; closing always works. */
    toggle() {
        if (this.open) {
            this.close();
            return;
        }
        if (!isDebugMenuEnabled())
            return;
        this.open = true;
    }
    close() {
        this.open = false;
        this.closeHovered = false;
    }
    /**
     * Call once per rendered frame (any loop — title or game). Aggregates
     * frame-to-frame deltas and rolls a sample once per second. Runs while the
     * panel is closed too, so graphs have history the moment it opens.
     */
    recordClientFrame() {
        const now = performance.now();
        if (this.lastFrameTs > 0) {
            const delta = now - this.lastFrameTs;
            // Ignore tab-hidden / loop-handover gaps; they aren't frame times.
            if (delta < 1000) {
                this.frameAccumMs += delta;
                this.frameCount++;
            }
        }
        this.lastFrameTs = now;
        if (now - this.lastSampleTs >= 1000) {
            this.lastSampleTs = now;
            if (this.frameCount > 0) {
                pushSample(this.clientFrameMs, this.frameAccumMs / this.frameCount);
            }
            this.frameAccumMs = 0;
            this.frameCount = 0;
            // Chrome-only; other browsers simply leave the series empty.
            const mem = performance.memory;
            if (mem && typeof mem.usedJSHeapSize === 'number') {
                pushSample(this.clientMemMB, mem.usedJSHeapSize / MB);
            }
        }
    }
    /** Feed a once-per-second stats packet from the server. */
    recordServerStats(stats) {
        if (!stats || typeof stats.heapUsed !== 'number')
            return;
        this.lastServerStats = stats;
        pushSample(this.serverHeapMB, stats.heapUsed / MB);
        pushSample(this.serverRssMB, stats.rss / MB);
        pushSample(this.serverTickAvgMs, stats.tickAvgMs || 0);
        pushSample(this.serverTickMaxMs, stats.tickMaxMs || 0);
    }
    getLayout() {
        const panelW = 420;
        const panelH = 500;
        const panelX = 20;
        const panelY = 70;
        const pad = 15;
        const headerH = 30;
        const contentX = panelX + pad;
        const contentW = panelW - 2 * pad;
        const contentTop = panelY + headerH + pad + 5;
        return { panelW, panelH, panelX, panelY, pad, headerH, contentX, contentW, contentTop };
    }
    render(ctx) {
        // The setting is the single source of truth: if it gets unchecked
        // while the panel is open (e.g. from the settings menu), the panel
        // closes itself on the next frame instead of lingering.
        if (this.open && !isDebugMenuEnabled())
            this.close();
        if (!this.open)
            return;
        const { panelW, panelH, panelX, panelY, pad, headerH, contentX, contentW, contentTop } = this.getLayout();
        ctx.save();
        // Panel chrome matches SettingsMenu: darker border rect + inner fill.
        ctx.fillStyle = (0, render_utils_1.hsvAdjust)('#aaaaaa', 0.8);
        ctx.beginPath();
        (0, render_utils_1.drawRoundedRect)(ctx, panelX, panelY, panelW, panelH, 5);
        ctx.fill();
        ctx.fillStyle = '#aaaaaa';
        ctx.beginPath();
        ctx.rect(panelX + 4, panelY + 4, panelW - 8, panelH - 8);
        ctx.fill();
        ctx.font = 'bold 20px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText('Debug', panelX + pad, panelY + pad + headerH / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Debug', panelX + pad, panelY + pad + headerH / 2);
        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        (0, render_utils_1.drawGardnButton)(ctx, closeBtnX, closeBtnY, 28, 28, '#cc4444', this.closeHovered, false, 'X', 16, 3, 3);
        // Four stacked graphs
        const graphH = 74;
        const labelH = 18;
        const gap = 12;
        let cy = contentTop;
        const last = (s) => (s.length > 0 ? s[s.length - 1] : undefined);
        const frameMs = last(this.clientFrameMs);
        this.drawGraph(ctx, contentX, cy, contentW, graphH, 'Client Frame Time', frameMs !== undefined ? `${frameMs.toFixed(1)} ms (${Math.round(1000 / Math.max(frameMs, 0.01))} FPS)` : 'collecting…', [{ series: this.clientFrameMs, color: '#5a9fdb' }], 'ms');
        cy += labelH + graphH + gap;
        const cliMem = last(this.clientMemMB);
        this.drawGraph(ctx, contentX, cy, contentW, graphH, 'Client Memory (JS heap)', cliMem !== undefined ? `${cliMem.toFixed(1)} MB` : 'unavailable (Chrome only)', [{ series: this.clientMemMB, color: '#7fdb7f' }], 'MB');
        cy += labelH + graphH + gap;
        const noServer = this.lastServerStats === null;
        const tickAvg = last(this.serverTickAvgMs);
        const tickMax = last(this.serverTickMaxMs);
        this.drawGraph(ctx, contentX, cy, contentW, graphH, 'Server Tick Time', noServer ? 'no data — join a game' : `avg ${tickAvg.toFixed(1)} / max ${tickMax.toFixed(1)} ms`, [
            { series: this.serverTickMaxMs, color: '#e07070' },
            { series: this.serverTickAvgMs, color: '#ffdd66' },
        ], 'ms');
        cy += labelH + graphH + gap;
        const srvHeap = last(this.serverHeapMB);
        const srvRss = last(this.serverRssMB);
        this.drawGraph(ctx, contentX, cy, contentW, graphH, 'Server Memory', noServer ? 'no data — join a game' : `heap ${srvHeap.toFixed(1)} / rss ${srvRss.toFixed(1)} MB`, [
            { series: this.serverRssMB, color: '#c9a0e8' },
            { series: this.serverHeapMB, color: '#e8a023' },
        ], 'MB');
        ctx.restore();
    }
    /**
     * One labeled graph block: label row on top, dark plot area below with all
     * series drawn as polylines on a shared auto-scaled Y axis (newest sample
     * anchored to the right edge). The first series' color tints the label
     * value text so multi-line graphs read without a legend.
     */
    drawGraph(ctx, x, y, w, h, label, valueText, lines, unit) {
        const labelH = 18;
        ctx.font = 'bold 13px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeText(label, x, y + labelH / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x, y + labelH / 2);
        ctx.font = 'bold 12px Ubuntu, sans-serif';
        ctx.textAlign = 'right';
        ctx.strokeText(valueText, x + w, y + labelH / 2);
        ctx.fillStyle = lines[lines.length - 1]?.color || '#ffffff';
        ctx.fillText(valueText, x + w, y + labelH / 2);
        const plotY = y + labelH;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        (0, render_utils_1.drawRoundedRect)(ctx, x, plotY, w, h, 3);
        ctx.fill();
        // Shared Y scale across the block's series, padded 15% so the peak
        // doesn't kiss the top edge.
        let maxV = 0;
        for (const line of lines) {
            for (const v of line.series)
                if (v > maxV)
                    maxV = v;
        }
        if (maxV <= 0) {
            ctx.font = '11px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#888888';
            ctx.fillText('no data yet', x + w / 2, plotY + h / 2);
            return;
        }
        const scaleMax = maxV * 1.15;
        // Midline + top-of-scale reference labels
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 2, plotY + h / 2);
        ctx.lineTo(x + w - 2, plotY + h / 2);
        ctx.stroke();
        ctx.font = '9px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillText(`${(scaleMax / 2).toFixed(1)} ${unit}`, x + 4, plotY + h / 2 - 5);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, plotY, w, h);
        ctx.clip();
        const stepX = w / (HISTORY - 1);
        for (const line of lines) {
            const s = line.series;
            if (s.length < 2)
                continue;
            ctx.strokeStyle = line.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < s.length; i++) {
                const px = x + w - (s.length - 1 - i) * stepX;
                const py = plotY + h - 2 - (s[i] / scaleMax) * (h - 4);
                if (i === 0)
                    ctx.moveTo(px, py);
                else
                    ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
        ctx.restore();
    }
    /** Returns true if the click was consumed (panel open). */
    handleClick(x, y) {
        if (!this.open)
            return false;
        const { panelW, panelH, panelX, panelY, pad } = this.getLayout();
        // Click outside closes, same as the settings panel.
        if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) {
            this.close();
            return true;
        }
        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        if (x >= closeBtnX && x <= closeBtnX + 28 && y >= closeBtnY && y <= closeBtnY + 28) {
            this.close();
        }
        return true;
    }
    handleHover(x, y) {
        if (!this.open)
            return;
        const { panelW, panelX, panelY, pad } = this.getLayout();
        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        this.closeHovered = x >= closeBtnX && x <= closeBtnX + 28 && y >= closeBtnY && y <= closeBtnY + 28;
    }
    /** True when the point is on the open panel — callers use this to stop
     *  mousedown from reaching gameplay (attacking) underneath. */
    isPointInside(x, y) {
        if (!this.open)
            return false;
        const { panelW, panelH, panelX, panelY } = this.getLayout();
        return x >= panelX && x <= panelX + panelW && y >= panelY && y <= panelY + panelH;
    }
}
exports.DebugMenuPanel = DebugMenuPanel;
/** Shared instance — see module doc comment. */
exports.debugMenuPanel = new DebugMenuPanel();
