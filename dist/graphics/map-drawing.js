"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preloadCustomTileTextures = preloadCustomTileTextures;
const core_1 = require("./core");
const constants_1 = require("../constants");
const tileTextureCache = new Map();
/** Inject `xmlns="http://www.w3.org/2000/svg"` into the root <svg> tag if it's
 *  missing — without it, browsers refuse to rasterize SVG loaded as an Image. */
function normalizeSvgForImage(svg) {
    if (svg.includes('xmlns="http://www.w3.org/2000/svg"') || svg.includes("xmlns='http://www.w3.org/2000/svg'")) {
        return svg;
    }
    return svg.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
}
/**
 * Kick off the (idempotent) Blob → Image → offscreen-canvas rasterization for
 * a tile type's textureSvg. ctx-free so it can run at startup before any
 * canvas exists. Pattern binding happens later in getTileTexturePattern.
 */
function ensureTileTextureLoaded(cfg, onReady) {
    if (!cfg.textureSvg)
        return;
    if (tileTextureCache.has(cfg.id))
        return;
    const entry = { canvas: null, pattern: null, patternCtx: null, ready: false, failed: false };
    tileTextureCache.set(cfg.id, entry);
    const tileSize = cfg.textureTileSize && cfg.textureTileSize > 0 ? cfg.textureTileSize : core_1.WALL_TILE_SIZE;
    try {
        const svg = normalizeSvgForImage(cfg.textureSvg);
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const off = document.createElement('canvas');
            off.width = tileSize;
            off.height = tileSize;
            const offCtx = off.getContext('2d');
            if (!offCtx) {
                entry.failed = true;
                return;
            }
            // Stretch the SVG to exactly one tile so adjacent cells line up.
            offCtx.drawImage(img, 0, 0, tileSize, tileSize);
            entry.canvas = off;
            entry.ready = true;
            onReady?.();
        };
        img.onerror = () => {
            entry.failed = true;
            URL.revokeObjectURL(url);
            console.warn(`[tile texture] failed to load SVG for tile ${cfg.id} (${cfg.name})`);
        };
        img.src = url;
    }
    catch (err) {
        entry.failed = true;
        console.warn(`[tile texture] error preparing SVG for tile ${cfg.id}:`, err);
    }
}
/**
 * Eagerly rasterize every registered tile type's textureSvg so the cache is
 * hot before the player ever sees one. Without this, the first frame a tile
 * enters the viewport falls back to cfg.color until the async image load
 * finishes — visible as a brief flicker on the user's first encounter.
 */
function preloadCustomTileTextures() {
    for (const cfg of (0, constants_1.getAllTileTypes)()) {
        ensureTileTextureLoaded(cfg);
    }
}
/**
 * Look up (and lazily create) the CanvasPattern for a tile type, scaled to
 * exactly fit one game tile so the pattern repeats seamlessly without visible
 * wrap-around inside each cell. Returns null until the SVG finishes loading.
 */
function getTileTexturePattern(cfg, ctx, onReady) {
    if (!cfg.textureSvg)
        return null;
    const entry = tileTextureCache.get(cfg.id);
    if (entry) {
        if (entry.failed || !entry.ready)
            return null;
        // If the bound context is the one we have a cached pattern for, reuse it.
        if (entry.pattern && entry.patternCtx === ctx)
            return entry.pattern;
        // Different ctx (or no pattern yet) — create one bound to this ctx.
        if (entry.canvas) {
            entry.pattern = ctx.createPattern(entry.canvas, 'repeat');
            entry.patternCtx = ctx;
            return entry.pattern;
        }
        return null;
    }
    ensureTileTextureLoaded(cfg, onReady);
    return null;
}
core_1.Graphics.prototype.drawMap = function (world_map_data) {
    // Calculate viewport accounting for zoom level
    const scaledWidth = this.canvas.width / this.zoomLevel;
    const scaledHeight = this.canvas.height / this.zoomLevel;
    const viewport = {
        left: this.cameraX,
        top: this.cameraY,
        right: this.cameraX + scaledWidth,
        bottom: this.cameraY + scaledHeight
    };
    // Wall grid is rendered via the static map cache (see render.ts) —
    // skip it here so we don't redraw it on top per frame.
    // Draw all map elements (spawn areas, biomes, teleporters)
    world_map_data.forEach(element => {
        const x = element.x;
        const y = element.y;
        const width = element.width;
        const height = element.height;
        // Teleporters are points — expand visibility check by visual radius
        const margin = element.type === 'teleporter' ? 140 : 0;
        // Only draw elements that are visible in the viewport (accounting for zoom)
        if (x + width + margin >= viewport.left &&
            x - margin <= viewport.right &&
            y + height + margin >= viewport.top &&
            y - margin <= viewport.bottom) {
            // Draw area fill for non-teleporter elements
            if (element.type !== 'teleporter') {
                this.ctx.fillStyle = this.MAP_COLORS[element.type] || 'rgba(128, 128, 128, 0.0)';
                this.ctx.fillRect(x, y, width, height);
            }
            // Add visual indicators for special elements
            if (element.type === 'teleporter') {
                this.drawTeleporter(x, y, width, height);
            }
            else if (element.type === 'spawn') {
                this.drawSpawnPoint(x, y, width, height, element.properties?.spawnType);
            }
            // Draw debug info if hitboxes are enabled
            if (this.showHitboxes) {
                this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                this.ctx.strokeRect(x, y, width, height);
                this.ctx.fillStyle = 'white';
                this.ctx.font = '12px Ubuntu, sans-serif';
                this.ctx.fillText(`${Math.round(x)},${Math.round(y)}`, x, y - 5);
            }
        }
    });
};
core_1.Graphics.prototype.drawWallGrid = function (viewport) {
    if (!core_1.WALL_GRID || !core_1.WALL_GRID.length) {
        return;
    }
    // Calculate which tiles are visible in the viewport
    const minTileX = Math.max(0, (0, core_1.worldToTileX)(viewport.left));
    const maxTileX = Math.min(core_1.WALL_GRID[0]?.length - 1 || 0, (0, core_1.worldToTileX)(viewport.right));
    const minTileY = Math.max(0, (0, core_1.worldToTileY)(viewport.top));
    const maxTileY = Math.min(core_1.WALL_GRID.length - 1, (0, core_1.worldToTileY)(viewport.bottom));
    // Pass 1: Draw all tile fills (walls and water rectangles)
    // Slight overlap prevents sub-pixel background bleed between adjacent tiles
    const OVERLAP = 1.5;
    const OVERLAP_SIZE = core_1.WALL_TILE_SIZE + OVERLAP * 2;
    // Resolve the pattern for a tile type from its inline SVG texture.
    // Returns null until the SVG finishes rasterizing — caller falls back
    // to the configured color for that one frame.
    const resolveTilePattern = (cfg) => {
        if (cfg.textureSvg) {
            return getTileTexturePattern(cfg, this.ctx, () => { });
        }
        return null;
    };
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const state = core_1.WALL_GRID[tileY]?.[tileX] || 0;
            if (state === 0)
                continue;
            const cfg = (0, constants_1.getTileTypeConfig)(state);
            const worldX = (0, core_1.tileToWorldX)(tileX);
            const worldY = (0, core_1.tileToWorldY)(tileY);
            const drawX = worldX - OVERLAP;
            const drawY = worldY - OVERLAP;
            const pattern = resolveTilePattern(cfg);
            if (pattern) {
                this.ctx.save();
                this.ctx.fillStyle = pattern;
                this.ctx.fillRect(drawX, drawY, OVERLAP_SIZE, OVERLAP_SIZE);
                this.ctx.restore();
            }
            else if (cfg.style === 'water') {
                this.ctx.fillStyle = cfg.color;
                this.ctx.fillRect(drawX, drawY, OVERLAP_SIZE, OVERLAP_SIZE);
                this.ctx.fillStyle = 'rgba(65, 105, 225, 0.3)';
                this.ctx.fillRect(drawX, drawY, OVERLAP_SIZE, OVERLAP_SIZE);
            }
            else {
                this.ctx.fillStyle = cfg.color;
                this.ctx.fillRect(drawX, drawY, OVERLAP_SIZE, OVERLAP_SIZE);
            }
        }
    }
    // Pass 2: Draw all edges on top so they aren't covered by adjacent tile fills
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const state = core_1.WALL_GRID[tileY]?.[tileX] || 0;
            if (state === 0)
                continue;
            const cfg = (0, constants_1.getTileTypeConfig)(state);
            const worldX = (0, core_1.tileToWorldX)(tileX);
            const worldY = (0, core_1.tileToWorldY)(tileY);
            if (cfg.style === 'wall') {
                const pattern = resolveTilePattern(cfg);
                if (!pattern)
                    continue;
                const jaggedEdges = (0, core_1.getTileJaggedEdges)(core_1.WALL_GRID, tileX, tileY);
                if (jaggedEdges.top)
                    this.drawJaggedEdge(worldX, worldY, 'top', jaggedEdges.top, pattern);
                if (jaggedEdges.bottom)
                    this.drawJaggedEdge(worldX, worldY, 'bottom', jaggedEdges.bottom, pattern);
                if (jaggedEdges.left)
                    this.drawJaggedEdge(worldX, worldY, 'left', jaggedEdges.left, pattern);
                if (jaggedEdges.right)
                    this.drawJaggedEdge(worldX, worldY, 'right', jaggedEdges.right, pattern);
            }
            else if (cfg.style === 'water') {
                const edges = (0, core_1.getTileJaggedEdges)(core_1.WALL_GRID, tileX, tileY);
                const fill = cfg.color;
                const stroke = cfg.borderColor || cfg.color;
                if (edges.top)
                    this.drawSmoothedEdge(worldX, worldY, 'top', edges.top, fill, stroke);
                if (edges.bottom)
                    this.drawSmoothedEdge(worldX, worldY, 'bottom', edges.bottom, fill, stroke);
                if (edges.left)
                    this.drawSmoothedEdge(worldX, worldY, 'left', edges.left, fill, stroke);
                if (edges.right)
                    this.drawSmoothedEdge(worldX, worldY, 'right', edges.right, fill, stroke);
            }
        }
    }
};
core_1.Graphics.prototype.drawTeleporter = function (x, y, width, height) {
    const time = performance.now() / 1000;
    const cx = x + width / 2;
    const cy = y + height / 2;
    // Soft white glow (180x180 area)
    const glow = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, 130);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    glow.addColorStop(0.4, 'rgba(255, 255, 255, 0.1)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 130, 0, Math.PI * 2);
    this.ctx.fill();
    // Rotating filled squares (180x180 outer)
    const squares = [
        { size: 180, speed: 0.8, opacity: 0.12 },
        { size: 120, speed: -1.3, opacity: 0.18 },
        { size: 70, speed: 1.8, opacity: 0.25 },
    ];
    for (const sq of squares) {
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.rotate(time * sq.speed);
        this.ctx.fillStyle = `rgba(255, 255, 255, ${sq.opacity})`;
        this.ctx.fillRect(-sq.size / 2, -sq.size / 2, sq.size, sq.size);
        this.ctx.restore();
    }
    // White particles spiraling inward
    const numParticles = 12;
    for (let i = 0; i < numParticles; i++) {
        const seed = i * 137.508;
        const cycle = (time * 0.8 + seed) % 3;
        const progress = cycle / 3;
        const angle = seed + time * 0.5 + progress * 2;
        const radius = (1 - progress) * 120;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        const alpha = progress * 0.7;
        const size = (1 - progress) * 3 + 0.5;
        this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        this.ctx.beginPath();
        this.ctx.arc(px, py, size, 0, Math.PI * 2);
        this.ctx.fill();
    }
    // Center dot
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    this.ctx.fill();
};
core_1.Graphics.prototype.getTierColor = function (tier) {
    const colors = {
        common: 'rgba(128, 128, 128, 0.3)',
        uncommon: 'rgba(0, 128, 0, 0.3)',
        rare: 'rgba(0, 0, 255, 0.3)',
        epic: 'rgba(128, 0, 128, 0.3)',
        legendary: 'rgba(255, 165, 0, 0.3)',
        mythic: 'rgba(255, 0, 0, 0.3)'
    };
    return colors[tier] || colors.common;
};
core_1.Graphics.prototype.drawSpawnPoint = function (x, y, width, height, type) {
    // Spawn points are invisible - rendering handled by spawn zones
};
const SPAWN_ZONE_COLORS = {
    common: 'rgba(126, 239, 109, 0.25)',
    uncommon: 'rgba(255, 230, 93, 0.25)',
    rare: 'rgba(77, 82, 227, 0.25)',
    epic: 'rgba(134, 31, 222, 0.25)',
    legendary: 'rgba(222, 31, 31, 0.25)',
    mythic: 'rgba(31, 219, 222, 0.25)',
    ultra: 'rgba(222, 31, 101, 0.25)',
    super: 'rgba(43, 255, 164, 0.25)',
    unique: 'rgba(191, 0, 255, 0.25)',
    apex: 'rgba(255, 0, 255, 0.25)'
};
core_1.Graphics.prototype.drawSpawnZones = function (mapData) {
    const scaledWidth = this.canvas.width / this.zoomLevel;
    const scaledHeight = this.canvas.height / this.zoomLevel;
    const viewLeft = this.cameraX;
    const viewTop = this.cameraY;
    const viewRight = viewLeft + scaledWidth;
    const viewBottom = viewTop + scaledHeight;
    // Prefer cached pre-filtered list; fall back to scanning mapData for external callers.
    const elements = (mapData === this.mapData && this.spawnZoneElements.length > 0)
        ? this.spawnZoneElements
        : mapData;
    const ctx = this.ctx;
    let lastFill = '';
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.type !== 'spawn')
            continue;
        const x = element.x;
        const y = element.y;
        const w = element.width;
        const h = element.height;
        if (x + w < viewLeft || x > viewRight || y + h < viewTop || y > viewBottom)
            continue;
        const spawnType = element.properties?.spawnType || 'common';
        const fill = SPAWN_ZONE_COLORS[spawnType] || SPAWN_ZONE_COLORS.common;
        if (fill !== lastFill) {
            ctx.fillStyle = fill;
            lastFill = fill;
        }
        ctx.fillRect(x, y, w, h);
    }
};
