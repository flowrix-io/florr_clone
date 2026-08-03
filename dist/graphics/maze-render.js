"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
const squad_state_1 = require("../squad_state");
const maze_1 = require("../maze");
// Ground fallback colors while the biome section texture is still loading.
const MAZE_GROUND_FALLBACK = {
    garden: '#00d885',
    desert: '#ecdcb8',
    ocean: '#5b9ad3',
};
// Zone tint per depth band (common → mythic), matching the game's rarity colors.
const MAZE_ZONE_COLORS = [
    'rgba(126, 239, 109, 0.30)',
    'rgba(255, 230, 93, 0.30)',
    'rgba(77, 82, 227, 0.30)',
    'rgba(134, 31, 222, 0.30)',
    'rgba(31, 219, 222, 0.30)',
    'rgba(222, 31, 101, 0.30)',
];
// Canvas start angle for the quarter-circle fillet, keyed by the corner-code
// (top, left) bits — same mapping rrolf uses in RenderArena.c.
function filletStartAngle(top, left) {
    if (top === 0 && left === 1)
        return Math.PI / 2;
    if (top === 1 && left === 1)
        return Math.PI;
    if (top === 1 && left === 0)
        return Math.PI * 3 / 2;
    return 0;
}
/**
 * Trace the black wall shape for a rounded-corner cell value (4-7 convex floor
 * corner, 12-15 concave wall corner) into the current path. Radius is one full
 * cell and the arc is centred on the shared corner vertex — the rrolf wall look.
 */
function traceCornerCell(ctx, x0, y0, g, value) {
    const left = (value >> 1) & 1;
    const top = value & 1;
    const concave = (value >> 3) & 1;
    const cx = x0 + left * g; // arc centre = shared corner vertex
    const cy = y0 + top * g;
    // Convex floor corners fill only the curved triangle at the vertex opposite
    // the arc centre; concave wall corners fill the whole cell minus the curved
    // triangle at that opposite vertex — both start their path accordingly.
    const sx = concave ? cx : x0 + (1 - left) * g;
    const sy = concave ? cy : y0 + (1 - top) * g;
    const a0 = filletStartAngle(top, left);
    ctx.moveTo(sx, sy);
    ctx.arc(cx, cy, g, a0, a0 + Math.PI / 2, false);
}
/**
 * Draw the maze world: tiled biome ground with rrolf-style walls on top —
 * a 50%-opacity pure-black overlay, no outline, every corridor/void junction
 * rounded by a quarter-circle fillet of one full cell radius.
 */
core_1.Graphics.prototype.drawMazeWorld = function () {
    const maze = (0, maze_1.getActiveMaze)();
    if (!maze)
        return;
    const visibleW = this.viewW / this.zoomLevel;
    const visibleH = this.viewH / this.zoomLevel;
    const vpLeft = this.cameraX;
    const vpTop = this.cameraY;
    const vpRight = vpLeft + visibleW;
    const vpBottom = vpTop + visibleH;
    const mazeRight = maze_1.MAZE_ORIGIN_X + maze.worldSize;
    const mazeBottom = maze_1.MAZE_ORIGIN_Y + maze.worldSize;
    if (vpRight < maze_1.MAZE_ORIGIN_X || vpLeft > mazeRight || vpBottom < maze_1.MAZE_ORIGIN_Y || vpTop > mazeBottom) {
        return;
    }
    const ctx = this.ctx;
    const left = Math.max(vpLeft, maze_1.MAZE_ORIGIN_X);
    const top = Math.max(vpTop, maze_1.MAZE_ORIGIN_Y);
    const right = Math.min(vpRight, mazeRight);
    const bottom = Math.min(vpBottom, mazeBottom);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    // 1. Ground: tile the biome's section texture (garden/desert/ocean).
    const tex = this.sectionTextures.get(maze_1.MAZE_BIOME_SECTIONS[maze.biome]);
    if (tex && tex.complete && tex.naturalWidth > 0) {
        const tw = tex.width;
        const th = tex.height;
        const OVERLAP = 2; // slight overdraw to avoid seams between tiles
        const startX = maze_1.MAZE_ORIGIN_X + Math.floor((left - maze_1.MAZE_ORIGIN_X) / tw) * tw;
        const startY = maze_1.MAZE_ORIGIN_Y + Math.floor((top - maze_1.MAZE_ORIGIN_Y) / th) * th;
        for (let ty = startY; ty < bottom; ty += th) {
            for (let tx = startX; tx < right; tx += tw) {
                ctx.drawImage(tex, tx, ty, tw + OVERLAP, th + OVERLAP);
            }
        }
    }
    else {
        ctx.fillStyle = MAZE_GROUND_FALLBACK[maze.biome] || '#00d885';
        ctx.fillRect(left, top, right - left, bottom - top);
    }
    // 2. Walls: semi-transparent black carved by the corner-coded cell grid.
    const g = maze_1.MAZE_CELL_SIZE;
    const minGx = Math.max(0, Math.floor((left - maze_1.MAZE_ORIGIN_X) / g));
    const maxGx = Math.min(maze.gridDim - 1, Math.floor((right - maze_1.MAZE_ORIGIN_X) / g));
    const minGy = Math.max(0, Math.floor((top - maze_1.MAZE_ORIGIN_Y) / g));
    const maxGy = Math.min(maze.gridDim - 1, Math.floor((bottom - maze_1.MAZE_ORIGIN_Y) / g));
    // All wall shapes go into ONE path filled once: filling cell-by-cell at
    // 50% alpha leaves antialiased hairline seams on every interior cell
    // boundary of a contiguous wall mass (each fill blends its own edge
    // coverage); a single nonzero fill rasterizes the union with full
    // coverage across shared edges.
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
            const v = (0, maze_1.getMazeCellValue)(gx, gy);
            if (v === 1)
                continue; // plain floor — nothing to draw
            const x0 = maze_1.MAZE_ORIGIN_X + gx * g;
            const y0 = maze_1.MAZE_ORIGIN_Y + gy * g;
            if (v === 0) {
                ctx.rect(x0, y0, g, g);
            }
            else {
                traceCornerCell(ctx, x0, y0, g, v);
            }
        }
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
};
/**
 * Maze minimap: the whole maze rasterized rrolf-style — walkable corridors as
 * light shapes (with the same rounded corners) tinted by depth zone, walls
 * dark. Returns false when the local player isn't in the maze so the regular
 * minimap can draw instead.
 */
core_1.Graphics.prototype.drawMazeMinimap = function (players, socket) {
    const maze = (0, maze_1.getActiveMaze)();
    if (!maze)
        return false;
    const self = players.get(socket);
    if (!self || !(0, maze_1.isInMazeRegion)(self.x, self.y))
        return false;
    const minimapX = this.viewW - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
    const minimapY = this.MINIMAP_PADDING;
    const ctx = this.ctx;
    // The walkable-shape + zone-tint layers are pure functions of the maze
    // itself (rotates once per day) — bake once and blit. This was a full
    // gridDim² scan with per-cell beginPath/arc/fill, twice, every frame.
    const mazeKey = `${maze.biome}_${maze.gridDim}_${this.MINIMAP_WIDTH}`;
    if (!this.mazeMinimapStaticCache || this.mazeMinimapStaticCache.key !== mazeKey) {
        const canvas = document.createElement('canvas');
        canvas.width = this.MINIMAP_WIDTH;
        canvas.height = this.MINIMAP_HEIGHT;
        const bctx = canvas.getContext('2d');
        const s = this.MINIMAP_WIDTH / maze.gridDim; // pixels per maze cell
        // Dark backdrop = walls.
        bctx.fillStyle = 'rgba(20, 20, 25, 0.9)';
        bctx.fillRect(0, 0, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
        // Walkable shapes in white, corner cells with the same fillet geometry
        // (quarter-disc for convex floor corners, curved triangle for the carved
        // corner of concave wall cells) — the inverse of the world-view shapes.
        bctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        for (let gy = 0; gy < maze.gridDim; gy++) {
            for (let gx = 0; gx < maze.gridDim; gx++) {
                const v = maze.values[gy * maze.gridDim + gx];
                if (v === 0)
                    continue;
                const x0 = gx * s;
                const y0 = gy * s;
                bctx.beginPath();
                if (v === 1) {
                    bctx.rect(x0, y0, s + 0.5, s + 0.5);
                    bctx.fill();
                    continue;
                }
                const leftBit = (v >> 1) & 1;
                const topBit = v & 1;
                const concave = (v >> 3) & 1;
                const cx = x0 + leftBit * s;
                const cy = y0 + topBit * s;
                // Walkable area is the complement of the wall shape: convex floor
                // corners are the quarter-disc around the centre vertex; concave
                // wall cells contribute just the carved curved triangle.
                const sx = concave ? x0 + (1 - leftBit) * s : cx;
                const sy = concave ? y0 + (1 - topBit) * s : cy;
                const a0 = filletStartAngle(topBit, leftBit);
                bctx.moveTo(sx, sy);
                bctx.arc(cx, cy, s, a0, a0 + Math.PI / 2, false);
                bctx.fill();
            }
        }
        // Depth-zone tint over the corridors (common → mythic).
        let lastZone = -1;
        for (let gy = 0; gy < maze.gridDim; gy++) {
            for (let gx = 0; gx < maze.gridDim; gx++) {
                const v = maze.values[gy * maze.gridDim + gx];
                if (v === 0 || (v >= 12 && v <= 15))
                    continue; // walls carry no tint
                const zone = maze.zones[gy * maze.gridDim + gx];
                if (zone >= maze_1.MAZE_ZONE_TIERS.length)
                    continue;
                if (zone !== lastZone) {
                    bctx.fillStyle = MAZE_ZONE_COLORS[zone];
                    lastZone = zone;
                }
                bctx.fillRect(gx * s, gy * s, s + 0.5, s + 0.5);
            }
        }
        this.mazeMinimapStaticCache = { key: mazeKey, canvas };
    }
    this.ctx.drawImage(this.mazeMinimapStaticCache.canvas, minimapX, minimapY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    ctx.clip();
    // Player dots (same rules as the regular minimap: self always, squadmates
    // always, others only while ALT is held).
    const squadMemberIds = (0, squad_state_1.getSquadMemberIds)();
    const squadMemberSet = new Set(squadMemberIds);
    const worldToMapX = (wx) => minimapX + ((wx - maze_1.MAZE_ORIGIN_X) / maze.worldSize) * this.MINIMAP_WIDTH;
    const worldToMapY = (wy) => minimapY + ((wy - maze_1.MAZE_ORIGIN_Y) / maze.worldSize) * this.MINIMAP_HEIGHT;
    players.forEach(player => {
        if (!(0, maze_1.isInMazeRegion)(player.x, player.y))
            return;
        const isCurrentPlayer = player.id === socket;
        const isSquadMember = !isCurrentPlayer && squadMemberSet.has(player.id);
        if (!isCurrentPlayer && !isSquadMember && !this.altKeyPressed)
            return;
        const px = worldToMapX(player.x);
        const py = worldToMapY(player.y);
        ctx.fillStyle = isCurrentPlayer ? '#0000FF' : isSquadMember ? '#FF69B4' : '#000000';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, isCurrentPlayer ? 3 : 4, 0, Math.PI * 2);
        ctx.fill();
        if (isCurrentPlayer || isSquadMember)
            ctx.stroke();
    });
    ctx.restore();
    // Border + label.
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    const biomeName = maze.biome.charAt(0).toUpperCase() + maze.biome.slice(1);
    const label = `Maze — ${biomeName}`;
    ctx.font = '14px Ubuntu, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(label, minimapX + this.MINIMAP_WIDTH / 2, minimapY + this.MINIMAP_HEIGHT + 18);
    ctx.fillStyle = 'white';
    ctx.fillText(label, minimapX + this.MINIMAP_WIDTH / 2, minimapY + this.MINIMAP_HEIGHT + 18);
    ctx.textAlign = 'left';
    return true;
};
