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

// Render a live leaderboard styled to match gardn's: green pill header with the
// player count on top, dark-gray rounded container below, and each row is a dark
// pill with a flower-colored progress bar behind centered "Name - Score" text.
Graphics.prototype.drawPvpLeaderboard = function(this: Graphics, players: Map<string, Player>, currentPlayerId: string): void {
    const local = players.get(currentPlayerId) as any;
    if (!local || !local.inPvpArena) return;

    const arenaPlayers: Array<{ name: string; score: number; color: string }> = [];
    players.forEach((p) => {
        if (!(p as any).inPvpArena) return;
        arenaPlayers.push({
            name: p.name || 'Unnamed',
            score: (p as any).pvpScore || 0,
            color: (p as any).flowerColor || '#FFE763',
        });
    });
    if (arenaPlayers.length === 0) return;

    arenaPlayers.sort((a, b) => b.score - a.score);
    const topN = arenaPlayers.slice(0, 10);
    const maxScore = Math.max(1, topN[0].score);

    const ctx = this.ctx;

    // Layout — sized in the same proportions as gardn's leaderboard.
    const ROW_W = 200;
    const ROW_H = 20;
    const ROW_GAP = 4;
    const HEADER_H = 36;
    const HEADER_PAD_X = 14;
    const PANEL_PAD = 10;
    const BORDER = 5;
    const RADIUS = 7;

    const headerW = ROW_W + HEADER_PAD_X * 2;
    const panelW = headerW + PANEL_PAD * 2;
    const rowsH = topN.length * ROW_H + Math.max(0, topN.length - 1) * ROW_GAP;
    const panelH = HEADER_H + PANEL_PAD * 2 + rowsH + PANEL_PAD;

    const x = this.canvas.width - panelW - 20;
    const y = 20;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineJoin = 'round';

    // Outer dark-gray container.
    ctx.fillStyle = '#555555';
    ctx.strokeStyle = '#454545';
    ctx.lineWidth = BORDER;
    roundRect(ctx, x, y, panelW, panelH, RADIUS);
    ctx.stroke();
    ctx.fill();

    // Green pill header.
    const headerX = x + (panelW - headerW) / 2;
    const headerY = y + PANEL_PAD;
    ctx.fillStyle = '#55bb55';
    ctx.strokeStyle = '#469646';
    ctx.lineWidth = BORDER;
    roundRect(ctx, headerX, headerY, headerW, HEADER_H, RADIUS);
    ctx.stroke();
    ctx.fill();

    const headerText = arenaPlayers.length === 1 ? '1 Flower' : `${arenaPlayers.length} Flowers`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px Ubuntu, sans-serif';
    ctx.lineWidth = 18 * 0.18;
    ctx.strokeStyle = '#222222';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(headerText, headerX + headerW / 2, headerY + HEADER_H / 2);
    ctx.fillText(headerText, headerX + headerW / 2, headerY + HEADER_H / 2);

    // Rows.
    const rowsX = x + (panelW - ROW_W) / 2;
    const rowsY = headerY + HEADER_H + PANEL_PAD;
    const rowFontSize = ROW_H * 0.75;
    ctx.font = `bold ${rowFontSize}px Ubuntu, sans-serif`;

    for (let i = 0; i < topN.length; i++) {
        const entry = topN[i];
        const rowY = rowsY + i * (ROW_H + ROW_GAP);
        const cx = rowsX + ROW_W / 2;
        const cy = rowY + ROW_H / 2;
        const ratio = Math.max(0, Math.min(1, entry.score / maxScore));

        // Dark track pill drawn as a thick rounded line (matches gardn's look).
        const trackInset = ROW_H / 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = ROW_H;
        ctx.beginPath();
        ctx.moveTo(rowsX + trackInset, cy);
        ctx.lineTo(rowsX + ROW_W - trackInset, cy);
        ctx.stroke();

        // Colored progress fill, slightly narrower so the dark track shows.
        if (ratio > 0) {
            ctx.strokeStyle = entry.color;
            ctx.lineWidth = ROW_H * 0.8;
            const segLen = (ROW_W - ROW_H) * ratio;
            ctx.beginPath();
            ctx.moveTo(rowsX + trackInset, cy);
            ctx.lineTo(rowsX + trackInset + segLen, cy);
            ctx.stroke();
        }

        // Centered "Name - Score" with dark outline.
        const label = `${entry.name} - ${formatScore(entry.score)}`;
        ctx.lineWidth = rowFontSize * 0.18;
        ctx.strokeStyle = '#222222';
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(label, cx, cy);
        ctx.fillText(label, cx, cy);
    }

    ctx.restore();
};

function formatScore(s: number): string {
    if (s >= 1_000_000) return (s / 1_000_000).toFixed(s >= 10_000_000 ? 0 : 1) + 'M';
    if (s >= 1_000) return (s / 1_000).toFixed(s >= 10_000 ? 0 : 1) + 'k';
    return Math.floor(s).toString();
}

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
