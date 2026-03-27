import { Graphics, Player, MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, SECTION_CONFIGS, WALL_GRID, WALL_TILE_SIZE, WALL_GRID_WIDTH, WALL_GRID_HEIGHT, worldToTileX, worldToTileY, tileToWorldX, tileToWorldY, getTileState } from './core';

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
        drawMinimap(players: Map<string, Player>, socket: string): void;
    }
}

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

Graphics.prototype.drawMinimap = function(this: Graphics, players: Map<string, Player>, socket: string) {
    const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
    const minimapY = this.MINIMAP_PADDING;

    // Always show exactly one section (20000x20000) - no zoom
    const MINIMAP_AREA_SIZE = 20000;
    const minimapScale = {
        x: this.MINIMAP_WIDTH / MINIMAP_AREA_SIZE,
        y: this.MINIMAP_HEIGHT / MINIMAP_AREA_SIZE
    };

    // Draw minimap background (white instead of black)
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.fillRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);

    // Set up clipping region for minimap to prevent drawing outside bounds
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    this.ctx.clip();

    // Draw spawn zones on minimap when ALT is held (below walls/water)
    if (this.showRarityGlow) {
        const minimapSpawnColors: Record<string, string> = {
            common: 'rgba(126, 239, 109, 0.4)',
            uncommon: 'rgba(255, 230, 93, 0.4)',
            rare: 'rgba(77, 82, 227, 0.4)',
            epic: 'rgba(134, 31, 222, 0.4)',
            legendary: 'rgba(222, 31, 31, 0.4)',
            mythic: 'rgba(31, 219, 222, 0.4)',
            ultra: 'rgba(222, 31, 101, 0.4)',
            super: 'rgba(43, 255, 164, 0.4)',
            unique: 'rgba(191, 0, 255, 0.4)'
        };
        this.mapData.forEach(element => {
            if (element.type !== 'spawn') return;
            const scaledX = minimapX + ((element.x - this.minimapScrollX) * minimapScale.x);
            const scaledY = minimapY + ((element.y - this.minimapScrollY) * minimapScale.y);
            const scaledWidth = element.width * minimapScale.x;
            const scaledHeight = element.height * minimapScale.y;
            if (scaledX + scaledWidth > minimapX && scaledX < minimapX + this.MINIMAP_WIDTH &&
                scaledY + scaledHeight > minimapY && scaledY < minimapY + this.MINIMAP_HEIGHT) {
                const spawnType = element.properties?.spawnType || 'common';
                this.ctx.fillStyle = minimapSpawnColors[spawnType] || minimapSpawnColors.common;
                this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
            }
        });
    }

    // Draw wall grid tiles on minimap
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
            const scaledX = minimapX + ((worldX - this.minimapScrollX) * minimapScale.x);
            const scaledY = minimapY + ((worldY - this.minimapScrollY) * minimapScale.y);
            const tileSize = WALL_TILE_SIZE * minimapScale.x;

            if (state === 1) {
                this.ctx.fillStyle = '#000000'; // Black for walls
            } else if (state === 2) {
                this.ctx.fillStyle = '#4169E1'; // Blue for water
            }
            this.ctx.fillRect(scaledX, scaledY, tileSize, tileSize);
        }
    }

    // Draw map elements (spawn, biome, teleporter, safe_zone) on minimap
    this.mapData.forEach(element => {
        const scaledX = minimapX + ((element.x - this.minimapScrollX) * minimapScale.x);
        const scaledY = minimapY + ((element.y - this.minimapScrollY) * minimapScale.y);
        const scaledWidth = element.width * minimapScale.x;
        const scaledHeight = element.height * minimapScale.y;

        // Only draw if the element is within the visible minimap area
        if (scaledX + scaledWidth > minimapX && scaledX < minimapX + this.MINIMAP_WIDTH &&
            scaledY + scaledHeight > minimapY && scaledY < minimapY + this.MINIMAP_HEIGHT) {
            if (element.type === 'teleporter') {
                // Draw teleporter as a point on minimap
                const dotX = scaledX + scaledWidth / 2;
                const dotY = scaledY + scaledHeight / 2;
                this.ctx.fillStyle = element.properties?.teleportTo?.serverPort ? '#FFD700' : '#00FF00';
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            } else if (element.type === 'safe_zone') {
                this.ctx.fillStyle = '#FFC107'; // Yellow for safe zone
                this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
            } else {
                return; // Skip unknown types
            }
        }
    });

    // Draw all players on minimap with solid colors (with scroll offset)
    players.forEach(player => {
        const isCurrentPlayer = player.id === socket;
        // Only show other players when ALT is pressed, always show current player
        if (!isCurrentPlayer && !this.altKeyPressed) {
            return;
        }

        const playerMinimapX = minimapX + ((player.x - this.minimapScrollX) * minimapScale.x);
        const playerMinimapY = minimapY + ((player.y - this.minimapScrollY) * minimapScale.y);

        // Only draw if player is within the visible minimap area
        if (playerMinimapX > minimapX && playerMinimapX < minimapX + this.MINIMAP_WIDTH &&
            playerMinimapY > minimapY && playerMinimapY < minimapY + this.MINIMAP_HEIGHT) {
            if (isCurrentPlayer) {
                // Current player: blue dot with black outline, same size as portals
                this.ctx.fillStyle = '#0000FF'; // Blue for current player
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.arc(playerMinimapX, playerMinimapY, 3, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            } else {
                // Other players: black dot
                this.ctx.fillStyle = '#000000';
                this.ctx.beginPath();
                this.ctx.arc(playerMinimapX, playerMinimapY, 4, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    });

    // Draw viewport rectangle in black (with scroll offset) - only when hitboxes are enabled
    if (this.showHitboxes) {
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(
            minimapX + ((this.cameraX - this.minimapScrollX) * minimapScale.x),
            minimapY + ((this.cameraY - this.minimapScrollY) * minimapScale.y),
            (this.canvas.width / this.zoomLevel) * minimapScale.x,
            (this.canvas.height / this.zoomLevel) * minimapScale.y
        );
    }

    // Restore context to remove clipping region
    this.ctx.restore();

    // Draw section boundary (the minimap shows exactly one section)
    this.ctx.strokeStyle = '#FFD700';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);

    // Get section config for custom name
    const sectionIndex = sectionY * 3 + sectionX;
    const sectionConfig = SECTION_CONFIGS[sectionIndex];
    const sectionName = sectionConfig?.name || `Section ${sectionIndex + 1}`;

    // Draw section title below the minimap using level bar font (Ubuntu)
    this.ctx.font = '14px Ubuntu, sans-serif';
    this.ctx.textAlign = 'center';
    // Draw text with black outline like the level bar
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 3;
    this.ctx.strokeText(sectionName, minimapX + this.MINIMAP_WIDTH / 2, minimapY + this.MINIMAP_HEIGHT + 18);
    this.ctx.fillStyle = 'white';
    this.ctx.fillText(sectionName, minimapX + this.MINIMAP_WIDTH / 2, minimapY + this.MINIMAP_HEIGHT + 18);
    this.ctx.textAlign = 'left';
};
