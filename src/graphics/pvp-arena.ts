import { Graphics, Player } from './core';
import { PVP_ARENA_CENTER_X, PVP_ARENA_CENTER_Y, PVP_ARENA_RADIUS } from '../constants';

declare module './core' {
    interface Graphics {
        drawPvpArenaBoundary(): void;
        drawPvpLeaderboard(players: Map<string, Player>, currentPlayerId: string): void;
    }
}

// Gardn's "???" zone uses a plain medium-gray floor with a faint dark grid.
// We replicate that inside the arena circle and paint a darker void outside.
const ARENA_FLOOR_COLOR = '#777777';
const ARENA_VOID_COLOR = '#1a1a1a';
const ARENA_GRID_CELL = 50;
const ARENA_GRID_STROKE = 'rgba(0, 0, 0, 0.18)';

// Render the arena floor, grid, dark surrounding void, and boundary ring in world space.
// Only draws when the camera is currently showing the arena.
Graphics.prototype.drawPvpArenaBoundary = function(this: Graphics): void {
    const ctx = this.ctx;

    // Viewport in world coordinates.
    const visibleWidth = this.canvas.width / this.zoomLevel;
    const visibleHeight = this.canvas.height / this.zoomLevel;
    const vpLeft = this.cameraX;
    const vpTop = this.cameraY;
    const vpRight = vpLeft + visibleWidth;
    const vpBottom = vpTop + visibleHeight;

    // Cheap bounding-box cull: skip entirely if the viewport can't see the arena.
    const arenaLeft = PVP_ARENA_CENTER_X - PVP_ARENA_RADIUS;
    const arenaRight = PVP_ARENA_CENTER_X + PVP_ARENA_RADIUS;
    const arenaTop = PVP_ARENA_CENTER_Y - PVP_ARENA_RADIUS;
    const arenaBottom = PVP_ARENA_CENTER_Y + PVP_ARENA_RADIUS;
    if (vpRight < arenaLeft || vpLeft > arenaRight || vpBottom < arenaTop || vpTop > arenaBottom) {
        return;
    }

    ctx.save();

    // Dark void fills the whole visible area. The floor draw below paints over it
    // inside the arena circle, leaving the darker color only outside.
    ctx.fillStyle = ARENA_VOID_COLOR;
    ctx.fillRect(vpLeft, vpTop, visibleWidth, visibleHeight);

    // Clip to the arena circle and paint the gray "???" floor + grid inside.
    ctx.save();
    ctx.beginPath();
    ctx.arc(PVP_ARENA_CENTER_X, PVP_ARENA_CENTER_Y, PVP_ARENA_RADIUS, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = ARENA_FLOOR_COLOR;
    ctx.fillRect(vpLeft, vpTop, visibleWidth, visibleHeight);

    // Grid aligned to arena center so lines stay steady as the camera moves.
    ctx.strokeStyle = ARENA_GRID_STROKE;
    ctx.lineWidth = 1 / this.zoomLevel;

    const gridLeft = Math.max(vpLeft, arenaLeft);
    const gridRight = Math.min(vpRight, arenaRight);
    const gridTop = Math.max(vpTop, arenaTop);
    const gridBottom = Math.min(vpBottom, arenaBottom);

    const firstX = PVP_ARENA_CENTER_X + Math.ceil((gridLeft - PVP_ARENA_CENTER_X) / ARENA_GRID_CELL) * ARENA_GRID_CELL;
    const firstY = PVP_ARENA_CENTER_Y + Math.ceil((gridTop - PVP_ARENA_CENTER_Y) / ARENA_GRID_CELL) * ARENA_GRID_CELL;

    ctx.beginPath();
    for (let x = firstX; x <= gridRight; x += ARENA_GRID_CELL) {
        ctx.moveTo(x, gridTop);
        ctx.lineTo(x, gridBottom);
    }
    for (let y = firstY; y <= gridBottom; y += ARENA_GRID_CELL) {
        ctx.moveTo(gridLeft, y);
        ctx.lineTo(gridRight, y);
    }
    ctx.stroke();
    ctx.restore();

    // Boundary ring (hard edge — players are clamped here).
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.65)';
    ctx.beginPath();
    ctx.arc(PVP_ARENA_CENTER_X, PVP_ARENA_CENTER_Y, PVP_ARENA_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 200, 200, 0.4)';
    ctx.beginPath();
    ctx.arc(PVP_ARENA_CENTER_X, PVP_ARENA_CENTER_Y, PVP_ARENA_RADIUS - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
};

// Render a small live leaderboard in the top-right corner showing every player
// currently inside the arena (including the local player), sorted by PVP score.
Graphics.prototype.drawPvpLeaderboard = function(this: Graphics, players: Map<string, Player>, currentPlayerId: string): void {
    const local = players.get(currentPlayerId) as any;
    if (!local || !local.inPvpArena) return;

    const arenaPlayers: Array<{ name: string; score: number; isSelf: boolean }> = [];
    players.forEach((p, id) => {
        if (!(p as any).inPvpArena) return;
        arenaPlayers.push({
            name: p.name || 'unknown',
            score: (p as any).pvpScore || 0,
            isSelf: id === currentPlayerId,
        });
    });
    if (arenaPlayers.length === 0) return;

    arenaPlayers.sort((a, b) => b.score - a.score);
    const topN = arenaPlayers.slice(0, 10);
    const maxScore = Math.max(1, topN[0].score);

    const ctx = this.ctx;
    const PANEL_W = 260;
    const ROW_H = 22;
    const HEADER_H = 28;
    const PADDING = 8;
    const PANEL_H = HEADER_H + topN.length * ROW_H + PADDING;
    const x = this.canvas.width - PANEL_W - 16;
    const y = 16;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Panel background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.8)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, PANEL_W, PANEL_H, 8);
    ctx.fill();
    ctx.stroke();

    // Header
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Ubuntu, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('PVP Arena', x + PADDING, y + HEADER_H / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 200, 200, 0.85)';
    ctx.fillText(`${arenaPlayers.length} fighting`, x + PANEL_W - PADDING, y + HEADER_H / 2);

    // Rows
    ctx.font = '12px Ubuntu, sans-serif';
    for (let i = 0; i < topN.length; i++) {
        const entry = topN[i];
        const rowY = y + HEADER_H + i * ROW_H;
        const ratio = entry.score / maxScore;

        // Bar
        ctx.fillStyle = entry.isSelf ? 'rgba(255, 215, 0, 0.55)' : 'rgba(220, 60, 60, 0.5)';
        ctx.fillRect(x + PADDING, rowY + 2, (PANEL_W - PADDING * 2) * ratio, ROW_H - 4);

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        const label = `${i + 1}. ${entry.name.length > 18 ? entry.name.slice(0, 17) + '\u2026' : entry.name}`;
        ctx.fillText(label, x + PADDING + 4, rowY + ROW_H / 2);
        ctx.textAlign = 'right';
        ctx.fillText(`${entry.score}`, x + PANEL_W - PADDING - 4, rowY + ROW_H / 2);
    }

    ctx.restore();
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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
