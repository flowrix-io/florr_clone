import { ClientWorld } from '../client_world';
import { Entity } from '../ecs';
import { Graphics, SECTION_CONFIGS, WALL_GRID, WALL_TILE_SIZE, WALL_GRID_WIDTH, WALL_GRID_HEIGHT, worldToTileX, worldToTileY, tileToWorldX, tileToWorldY, getTileState } from './core';
import { getTileTypeConfig, isTileIdSolid } from '../constants';
import { getSquadMemberIds } from '../squad_state';
import { drawText } from './text';

/** Reused entity snapshot; see ClientWorld.collectPlayers. */
const minimapScratch: Entity[] = [];

const MINIMAP_SPAWN_COLORS: Record<string, string> = {
    common: 'rgba(126, 239, 109, 0.4)',
    uncommon: 'rgba(255, 230, 93, 0.4)',
    rare: 'rgba(77, 82, 227, 0.4)',
    epic: 'rgba(134, 31, 222, 0.4)',
    legendary: 'rgba(222, 31, 31, 0.4)',
    mythic: 'rgba(31, 219, 222, 0.4)',
    ultra: 'rgba(222, 31, 101, 0.4)',
    super: 'rgba(43, 255, 164, 0.4)',
    unique: 'rgba(191, 0, 255, 0.4)',
    apex: 'rgba(0, 255, 255, 0.4)'
};

declare module './core' {
    interface Graphics {
        scrollMinimap(deltaX: number, deltaY: number): void;
        setMinimapScroll(x: number, y: number): void;
        centerMinimapOnPlayer(playerX: number, playerY: number): void;
        zoomInMinimap(): void;
        zoomOutMinimap(): void;
        setMinimapZoom(zoom: number): void;
        getMinimapZoom(): number;
        followPlayerOnMinimap(playerX: number, playerY: number): void;
        drawMinimap(world: ClientWorld, socket: string): void;
        bakeMinimapStatic(minimapScale: { x: number; y: number }): HTMLCanvasElement;
    }
}

// Renders the minimap's static layers (background, spawn zones, wall tiles,
// teleporter dots) into an offscreen canvas in minimap-local coordinates.
// Rebaked only when the section-snapped scroll or the ALT-glow toggle changes.
Graphics.prototype.bakeMinimapStatic = function(this: Graphics, minimapScale: { x: number; y: number }): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.MINIMAP_WIDTH;
    canvas.height = this.MINIMAP_HEIGHT;
    const ctx = canvas.getContext('2d')!;

    // Background (white instead of black)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(0, 0, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);

    // Spawn zones when ALT is held (below walls/water)
    if (this.showRarityGlow) {
        const spawnElements = this.spawnZoneElements.length > 0 ? this.spawnZoneElements : this.mapData;
        const sx = minimapScale.x;
        const sy = minimapScale.y;
        let lastFill = '';
        for (let i = 0; i < spawnElements.length; i++) {
            const element = spawnElements[i];
            if (element.type !== 'spawn') continue;
            const scaledX = (element.x - this.minimapScrollX) * sx;
            const scaledY = (element.y - this.minimapScrollY) * sy;
            const scaledWidth = element.width * sx;
            const scaledHeight = element.height * sy;
            if (scaledX + scaledWidth <= 0 || scaledX >= this.MINIMAP_WIDTH ||
                scaledY + scaledHeight <= 0 || scaledY >= this.MINIMAP_HEIGHT) continue;
            const spawnType = element.properties?.spawnType || 'common';
            const fill = MINIMAP_SPAWN_COLORS[spawnType] || MINIMAP_SPAWN_COLORS.common;
            if (fill !== lastFill) {
                ctx.fillStyle = fill;
                lastFill = fill;
            }
            ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
        }
    }

    // Wall grid tiles
    const SECTION_SIZE = 20000;
    const sectionX = Math.floor(this.minimapScrollX / SECTION_SIZE);
    const sectionY = Math.floor(this.minimapScrollY / SECTION_SIZE);
    const minTileX = Math.max(0, worldToTileX(sectionX * SECTION_SIZE));
    const maxTileX = Math.min(WALL_GRID_WIDTH - 1, worldToTileX((sectionX + 1) * SECTION_SIZE));
    const minTileY = Math.max(0, worldToTileY(sectionY * SECTION_SIZE));
    const maxTileY = Math.min(WALL_GRID_HEIGHT - 1, worldToTileY((sectionY + 1) * SECTION_SIZE));

    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const state = getTileState(WALL_GRID, tileToWorldX(tileX), tileToWorldY(tileY));
            if (state === 0) continue; // Skip air tiles

            const worldX = tileToWorldX(tileX);
            const worldY = tileToWorldY(tileY);
            const scaledX = (worldX - this.minimapScrollX) * minimapScale.x;
            const scaledY = (worldY - this.minimapScrollY) * minimapScale.y;
            const tileSize = WALL_TILE_SIZE * minimapScale.x;

            // Walls render as solid black for high-contrast minimap silhouettes;
            // anything else (water, custom tile types) uses its configured color.
            if (isTileIdSolid(state)) {
                ctx.fillStyle = '#000000';
            } else {
                ctx.fillStyle = getTileTypeConfig(state).color;
            }
            ctx.fillRect(scaledX, scaledY, tileSize, tileSize);
        }
    }

    // Map elements (teleporter dots)
    this.mapData.forEach(element => {
        const scaledX = (element.x - this.minimapScrollX) * minimapScale.x;
        const scaledY = (element.y - this.minimapScrollY) * minimapScale.y;
        const scaledWidth = element.width * minimapScale.x;
        const scaledHeight = element.height * minimapScale.y;

        if (scaledX + scaledWidth > 0 && scaledX < this.MINIMAP_WIDTH &&
            scaledY + scaledHeight > 0 && scaledY < this.MINIMAP_HEIGHT) {
            if (element.type === 'teleporter') {
                const dotX = scaledX + scaledWidth / 2;
                const dotY = scaledY + scaledHeight / 2;
                ctx.fillStyle = element.properties?.teleportTo?.serverPort ? '#FFD700' : '#00FF00';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }
    });

    return canvas;
};

Graphics.prototype.scrollMinimap = function(this: Graphics, deltaX: number, deltaY: number) {
    // Minimap scrolling is disabled - it automatically shows the current 9th section
    // This method is kept for backward compatibility but does nothing
};

Graphics.prototype.setMinimapScroll = function(this: Graphics, x: number, y: number) {
    // Clamp to section boundaries (each section is 20000x20000)
    const SECTION_SIZE = 20000;
    const sectionX = Math.floor(x / SECTION_SIZE);
    const sectionY = Math.floor(y / SECTION_SIZE);

    // Clamp to valid sections (0-2 for both X and Y)
    const clampedSectionX = Math.max(0, Math.min(2, sectionX));
    const clampedSectionY = Math.max(0, Math.min(2, sectionY));

    // Set scroll to the start of the clamped section
    this.minimapScrollX = clampedSectionX * SECTION_SIZE;
    this.minimapScrollY = clampedSectionY * SECTION_SIZE;
};

Graphics.prototype.centerMinimapOnPlayer = function(this: Graphics, playerX: number, playerY: number) {
    // Use the followPlayerOnMinimap method which handles 9-section division
    this.followPlayerOnMinimap(playerX, playerY);
};

Graphics.prototype.zoomInMinimap = function(this: Graphics) {
    this.minimapZoom = Math.min(this.minimapZoom + this.MINIMAP_ZOOM_STEP, this.MINIMAP_MAX_ZOOM);
};

Graphics.prototype.zoomOutMinimap = function(this: Graphics) {
    this.minimapZoom = Math.max(this.minimapZoom - this.MINIMAP_ZOOM_STEP, this.MINIMAP_MIN_ZOOM);
};

Graphics.prototype.setMinimapZoom = function(this: Graphics, zoom: number) {
    this.minimapZoom = Math.max(this.MINIMAP_MIN_ZOOM, Math.min(this.MINIMAP_MAX_ZOOM, zoom));
};

Graphics.prototype.getMinimapZoom = function(this: Graphics): number {
    return this.minimapZoom;
};

Graphics.prototype.followPlayerOnMinimap = function(this: Graphics, playerX: number, playerY: number) {
    // Automatically show the 9th section the player is in (3x3 grid, each section is 20000x20000)
    const SECTION_SIZE = 20000;
    const sectionX = Math.floor(playerX / SECTION_SIZE);
    const sectionY = Math.floor(playerY / SECTION_SIZE);

    // Clamp to valid sections (0-2 for both X and Y)
    const clampedSectionX = Math.max(0, Math.min(2, sectionX));
    const clampedSectionY = Math.max(0, Math.min(2, sectionY));

    // Set minimap to show this section (centered)
    const sectionCenterX = clampedSectionX * SECTION_SIZE + SECTION_SIZE / 2;
    const sectionCenterY = clampedSectionY * SECTION_SIZE + SECTION_SIZE / 2;

    this.setMinimapScroll(
        sectionCenterX - SECTION_SIZE / 2,
        sectionCenterY - SECTION_SIZE / 2
    );
};

Graphics.prototype.drawMinimap = function(this: Graphics, world: ClientWorld, socket: string) {
    // Inside the maze, the section-based minimap is meaningless — draw the
    // maze layout instead (returns false when the player isn't in the maze).
    if (this.drawMazeMinimap(world, socket)) {
        return;
    }

    const minimapX = this.viewW - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
    const minimapY = this.MINIMAP_PADDING;

    // Always show exactly one section (20000x20000) - no zoom
    const MINIMAP_AREA_SIZE = 20000;
    const minimapScale = {
        x: this.MINIMAP_WIDTH / MINIMAP_AREA_SIZE,
        y: this.MINIMAP_HEIGHT / MINIMAP_AREA_SIZE
    };

    // Static layers (background, spawn zones, wall tiles, teleporter dots)
    // depend only on the section-snapped scroll position and the ALT-glow
    // toggle — bake them once and blit. The per-tile wall scan every frame was
    // one of the top per-frame costs under CPU throttling.
    const staticKey = `${this.minimapScrollX}_${this.minimapScrollY}_${this.showRarityGlow ? 1 : 0}`;
    if (!this.minimapStaticCache || this.minimapStaticCache.key !== staticKey) {
        this.minimapStaticCache = { key: staticKey, canvas: this.bakeMinimapStatic(minimapScale) };
    }
    this.ctx.drawImage(this.minimapStaticCache.canvas, minimapX, minimapY);

    // Set up clipping region for the dynamic layer (player dots)
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    this.ctx.clip();

    // Draw all players on minimap with solid colors (with scroll offset)
    const squadMemberIds: string[] = getSquadMemberIds();
    const squadMemberSet = new Set<string>(squadMemberIds);
    for (const entity of world.collectPlayers(minimapScratch)) {
        const playerId = world.playerId(entity);
        const isCurrentPlayer = playerId === socket;
        const isSquadMember = !isCurrentPlayer && squadMemberSet.has(playerId);
        // Only show other non-squad players when ALT is pressed. Always show current player and squadmates.
        if (!isCurrentPlayer && !isSquadMember && !this.altKeyPressed) {
            continue;
        }

        // The DRAWN position, so the dot tracks the flower rather than leading it.
        // Read off the f64 Position column: the maze sits at ~200000 and an f32
        // round-trip there quantises to ~0.015px steps.
        const playerMinimapX = minimapX + ((world.playerX(entity) - this.minimapScrollX) * minimapScale.x);
        const playerMinimapY = minimapY + ((world.playerY(entity) - this.minimapScrollY) * minimapScale.y);

        // Only draw if player is within the visible minimap area
        if (playerMinimapX > minimapX && playerMinimapX < minimapX + this.MINIMAP_WIDTH &&
            playerMinimapY > minimapY && playerMinimapY < minimapY + this.MINIMAP_HEIGHT) {
            if (isCurrentPlayer) {
                // Current player: blue dot with black outline, same size as portals
                this.ctx.fillStyle = '#0000FF';
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.arc(playerMinimapX, playerMinimapY, 3, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            } else if (isSquadMember) {
                // Squad members: pink dot with black outline so they stand out from ALT-revealed players.
                this.ctx.fillStyle = '#FF69B4';
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.arc(playerMinimapX, playerMinimapY, 4, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            } else {
                this.ctx.fillStyle = '#000000';
                this.ctx.beginPath();
                this.ctx.arc(playerMinimapX, playerMinimapY, 4, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }

    // Draw viewport rectangle in black (with scroll offset) - only when hitboxes are enabled
    if (this.showHitboxes) {
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(
            minimapX + ((this.cameraX - this.minimapScrollX) * minimapScale.x),
            minimapY + ((this.cameraY - this.minimapScrollY) * minimapScale.y),
            (this.viewW / this.zoomLevel) * minimapScale.x,
            (this.viewH / this.zoomLevel) * minimapScale.y
        );
    }

    // Restore context to remove clipping region
    this.ctx.restore();

    // Draw section boundary (the minimap shows exactly one section)
    this.ctx.strokeStyle = '#FFD700';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);

    // Get section config for custom name
    const SECTION_SIZE = 20000;
    const sectionX = Math.floor(this.minimapScrollX / SECTION_SIZE);
    const sectionY = Math.floor(this.minimapScrollY / SECTION_SIZE);
    const sectionIndex = sectionY * 3 + sectionX;
    const sectionConfig = SECTION_CONFIGS[sectionIndex];
    const sectionName = sectionConfig?.name || `Section ${sectionIndex + 1}`;

    // Draw section title below the minimap using level bar font (Ubuntu)
    this.ctx.textAlign = 'center';
    // Draw text with black outline like the level bar
    drawText(this.ctx, sectionName, minimapX + this.MINIMAP_WIDTH / 2, minimapY + this.MINIMAP_HEIGHT + 18, { size: 14, fill: 'white', stroke: '#000000', strokeWidth: 3 });
    this.ctx.textAlign = 'left';
};
