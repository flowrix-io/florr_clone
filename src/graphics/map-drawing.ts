import { Graphics, MapElement, WALL_GRID, WALL_TILE_SIZE, WALL_GRID_WIDTH, WALL_GRID_HEIGHT, worldToTileX, worldToTileY, tileToWorldX, tileToWorldY, getTileState, WallTileState, getTileJaggedEdges, SECTION_CONFIGS } from './core';

declare module './core' {
    interface Graphics {
        drawMap(world_map_data: MapElement[]): void;
        drawWallGrid(viewport: { left: number; right: number; top: number; bottom: number }): void;
        drawTeleporter(x: number, y: number, width: number, height: number): void;
        getTierColor(tier: string): string;
        drawSpawnPoint(x: number, y: number, width: number, height: number, type?: string): void;
        drawSpawnZones(mapData: MapElement[]): void;
    }
}

Graphics.prototype.drawMap = function(this: Graphics, world_map_data: MapElement[]) {
    // Calculate viewport accounting for zoom level
    const scaledWidth = this.canvas.width / this.zoomLevel;
    const scaledHeight = this.canvas.height / this.zoomLevel;
    const viewport = {
        left: this.cameraX,
        top: this.cameraY,
        right: this.cameraX + scaledWidth,
        bottom: this.cameraY + scaledHeight
    };

    // Draw wall grid tiles
    this.drawWallGrid(viewport);

    // Draw all map elements (spawn areas, biomes, teleporters, safe zones)
    world_map_data.forEach(element => {
        const x = element.x;
        const y = element.y;
        const width = element.width;
        const height = element.height;

        // Teleporters are points — expand visibility check by visual radius
        const margin = element.type === 'teleporter' ? 140 : 0;
        // Only draw elements that are visible in the viewport (accounting for zoom)
        if (
            x + width + margin >= viewport.left &&
            x - margin <= viewport.right &&
            y + height + margin >= viewport.top &&
            y - margin <= viewport.bottom
        ) {
            // Draw area fill for non-teleporter elements
            if (element.type !== 'teleporter') {
                this.ctx.fillStyle = this.MAP_COLORS[element.type] || 'rgba(128, 128, 128, 0.0)';
                this.ctx.fillRect(x, y, width, height);
            }

            // Add visual indicators for special elements
            if (element.type === 'teleporter') {
                this.drawTeleporter(x, y, width, height);
            } else if (element.type === 'spawn') {
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

Graphics.prototype.drawWallGrid = function(this: Graphics, viewport: { left: number; right: number; top: number; bottom: number }): void {
    if (!WALL_GRID || !WALL_GRID.length) {
        return;
    }

    // Calculate which tiles are visible in the viewport
    const minTileX = Math.max(0, worldToTileX(viewport.left));
    const maxTileX = Math.min(WALL_GRID[0]?.length - 1 || 0, worldToTileX(viewport.right));
    const minTileY = Math.max(0, worldToTileY(viewport.top));
    const maxTileY = Math.min(WALL_GRID.length - 1, worldToTileY(viewport.bottom));

    // Pass 1: Draw all tile fills (walls and water rectangles)
    // Slight overlap prevents sub-pixel background bleed between adjacent tiles
    const OVERLAP = 1.5;
    const OVERLAP_SIZE = WALL_TILE_SIZE + OVERLAP * 2;
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const state = WALL_GRID[tileY]?.[tileX] || 0;
            if (state === 0) continue;

            const worldX = tileToWorldX(tileX);
            const worldY = tileToWorldY(tileY);
            const drawX = worldX - OVERLAP;
            const drawY = worldY - OVERLAP;

            if (state === 1) {
                const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                if (pattern) {
                    this.ctx.save();
                    this.ctx.fillStyle = pattern;
                    this.ctx.fillRect(drawX, drawY, OVERLAP_SIZE, OVERLAP_SIZE);
                    this.ctx.restore();
                } else {
                    this.ctx.fillStyle = '#666666';
                    this.ctx.fillRect(drawX, drawY, OVERLAP_SIZE, OVERLAP_SIZE);
                }
            } else if (state === 2) {
                this.ctx.fillStyle = '#4169E1';
                this.ctx.fillRect(drawX, drawY, OVERLAP_SIZE, OVERLAP_SIZE);
                this.ctx.fillStyle = 'rgba(65, 105, 225, 0.3)';
                this.ctx.fillRect(drawX, drawY, OVERLAP_SIZE, OVERLAP_SIZE);
            }
        }
    }

    // Pass 2: Draw all edges on top so they aren't covered by adjacent tile fills
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const state = WALL_GRID[tileY]?.[tileX] || 0;
            if (state === 0) continue;

            const worldX = tileToWorldX(tileX);
            const worldY = tileToWorldY(tileY);

            if (state === 1) {
                const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                if (pattern) {
                    const jaggedEdges = getTileJaggedEdges(WALL_GRID, tileX, tileY);
                    if (jaggedEdges.top) this.drawJaggedEdge(worldX, worldY, 'top', jaggedEdges.top, pattern);
                    if (jaggedEdges.bottom) this.drawJaggedEdge(worldX, worldY, 'bottom', jaggedEdges.bottom, pattern);
                    if (jaggedEdges.left) this.drawJaggedEdge(worldX, worldY, 'left', jaggedEdges.left, pattern);
                    if (jaggedEdges.right) this.drawJaggedEdge(worldX, worldY, 'right', jaggedEdges.right, pattern);
                }
            } else if (state === 2) {
                const waterEdges = getTileJaggedEdges(WALL_GRID, tileX, tileY);
                const waterFill = '#4169E1';
                const waterStroke = '#2a4fa0';
                if (waterEdges.top) this.drawSmoothedEdge(worldX, worldY, 'top', waterEdges.top, waterFill, waterStroke);
                if (waterEdges.bottom) this.drawSmoothedEdge(worldX, worldY, 'bottom', waterEdges.bottom, waterFill, waterStroke);
                if (waterEdges.left) this.drawSmoothedEdge(worldX, worldY, 'left', waterEdges.left, waterFill, waterStroke);
                if (waterEdges.right) this.drawSmoothedEdge(worldX, worldY, 'right', waterEdges.right, waterFill, waterStroke);
            }
        }
    }
};

Graphics.prototype.drawTeleporter = function(this: Graphics, x: number, y: number, width: number, height: number) {
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

Graphics.prototype.getTierColor = function(this: Graphics, tier: string): string {
    const colors = {
        common: 'rgba(128, 128, 128, 0.3)',
        uncommon: 'rgba(0, 128, 0, 0.3)',
        rare: 'rgba(0, 0, 255, 0.3)',
        epic: 'rgba(128, 0, 128, 0.3)',
        legendary: 'rgba(255, 165, 0, 0.3)',
        mythic: 'rgba(255, 0, 0, 0.3)'
    };
    return colors[tier as keyof typeof colors] || colors.common;
};

Graphics.prototype.drawSpawnPoint = function(this: Graphics, x: number, y: number, width: number, height: number, type?: string) {
    // Spawn points are invisible - rendering handled by spawn zones
};

const SPAWN_ZONE_COLORS: Record<string, string> = {
    common: 'rgba(126, 239, 109, 0.25)',
    uncommon: 'rgba(255, 230, 93, 0.25)',
    rare: 'rgba(77, 82, 227, 0.25)',
    epic: 'rgba(134, 31, 222, 0.25)',
    legendary: 'rgba(222, 31, 31, 0.25)',
    mythic: 'rgba(31, 219, 222, 0.25)',
    ultra: 'rgba(222, 31, 101, 0.25)',
    super: 'rgba(43, 255, 164, 0.25)',
    unique: 'rgba(191, 0, 255, 0.25)'
};

Graphics.prototype.drawSpawnZones = function(this: Graphics, mapData: MapElement[]) {
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
        if (element.type !== 'spawn') continue;
        const x = element.x;
        const y = element.y;
        const w = element.width;
        const h = element.height;
        if (x + w < viewLeft || x > viewRight || y + h < viewTop || y > viewBottom) continue;

        const spawnType = element.properties?.spawnType || 'common';
        const fill = SPAWN_ZONE_COLORS[spawnType] || SPAWN_ZONE_COLORS.common;
        if (fill !== lastFill) {
            ctx.fillStyle = fill;
            lastFill = fill;
        }
        ctx.fillRect(x, y, w, h);
    }
};
