"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
core_1.Graphics.prototype.drawScrollingBackground = function () {
    // If background texture is not loaded or is broken, just fill with section colors/textures
    if (!this.backgroundTexture || !this.backgroundTexture.complete || this.backgroundTexture.naturalWidth === 0) {
        const SECTION_SIZE = 20000;
        // Calculate visible area and clamp to world boundaries
        const visibleWidth = this.viewW / this.zoomLevel;
        const visibleHeight = this.viewH / this.zoomLevel;
        // Draw each visible section with its background color or texture
        const startSectionX = Math.max(0, Math.floor(this.cameraX / SECTION_SIZE));
        const startSectionY = Math.max(0, Math.floor(this.cameraY / SECTION_SIZE));
        const endSectionX = Math.min(2, Math.floor((this.cameraX + visibleWidth) / SECTION_SIZE));
        const endSectionY = Math.min(2, Math.floor((this.cameraY + visibleHeight) / SECTION_SIZE));
        for (let sy = startSectionY; sy <= endSectionY; sy++) {
            for (let sx = startSectionX; sx <= endSectionX; sx++) {
                const sectionIndex = sy * 3 + sx;
                const sectionConfig = core_1.SECTION_CONFIGS[sectionIndex];
                const sectionTexture = this.sectionTextures.get(sectionIndex);
                const sectionStartX = sx * SECTION_SIZE;
                const sectionStartY = sy * SECTION_SIZE;
                const sectionEndX = (sx + 1) * SECTION_SIZE;
                const sectionEndY = (sy + 1) * SECTION_SIZE;
                // Clamp to visible area
                const fillX = Math.max(sectionStartX, this.cameraX);
                const fillY = Math.max(sectionStartY, this.cameraY);
                const fillEndX = Math.min(sectionEndX, this.cameraX + visibleWidth, core_1.ACTUAL_WORLD_WIDTH);
                const fillEndY = Math.min(sectionEndY, this.cameraY + visibleHeight, core_1.ACTUAL_WORLD_HEIGHT);
                const fillWidth = fillEndX - fillX;
                const fillHeight = fillEndY - fillY;
                if (fillWidth > 0 && fillHeight > 0) {
                    // Check if section has a loaded texture
                    if (sectionTexture && sectionTexture.complete && sectionTexture.naturalWidth > 0) {
                        // Tile the section texture
                        const texWidth = sectionTexture.width;
                        const texHeight = sectionTexture.height;
                        const startTileX = Math.floor(fillX / texWidth) * texWidth;
                        const startTileY = Math.floor(fillY / texHeight) * texHeight;
                        for (let ty = startTileY; ty < fillEndY; ty += texHeight) {
                            for (let tx = startTileX; tx < fillEndX; tx += texWidth) {
                                this.ctx.drawImage(sectionTexture, tx, ty, texWidth, texHeight);
                            }
                        }
                    }
                    else {
                        // Use solid color (or default if background is a path that hasn't loaded)
                        const background = sectionConfig?.background;
                        if (background && background.startsWith('#')) {
                            this.ctx.fillStyle = background;
                        }
                        else {
                            this.ctx.fillStyle = '#00d885'; // Default color
                        }
                        this.ctx.fillRect(fillX, fillY, fillWidth, fillHeight);
                    }
                }
            }
        }
        return;
    }
    // Calculate the visible area in world coordinates
    const visibleWidth = this.viewW / this.zoomLevel;
    const visibleHeight = this.viewH / this.zoomLevel;
    // Get the size of the background texture (400x400 from the SVG)
    const defaultBgWidth = this.backgroundTexture.width;
    const defaultBgHeight = this.backgroundTexture.height;
    // Calculate the starting position for tiling (offset by camera position)
    const startX = Math.floor(this.cameraX / defaultBgWidth) * defaultBgWidth;
    const startY = Math.floor(this.cameraY / defaultBgHeight) * defaultBgHeight;
    // Calculate how many tiles we need to draw
    const tilesX = Math.ceil(visibleWidth / defaultBgWidth) + 1;
    const tilesY = Math.ceil(visibleHeight / defaultBgHeight) + 1;
    // Draw the tiled background, but only within world boundaries
    // Use integer coordinates to avoid sub-pixel rendering gaps
    for (let i = 0; i <= tilesX; i++) {
        for (let j = 0; j <= tilesY; j++) {
            const tileX = Math.floor(startX + (i * defaultBgWidth));
            const tileY = Math.floor(startY + (j * defaultBgHeight));
            // Check if tile is within world boundaries
            // Only draw if tile overlaps with world bounds (0 to ACTUAL_WORLD_WIDTH/HEIGHT)
            const tileRight = tileX + defaultBgWidth;
            const tileBottom = tileY + defaultBgHeight;
            // Check if tile is completely outside world boundaries
            const isCompletelyOutOfBounds = tileRight <= 0 || tileX >= core_1.ACTUAL_WORLD_WIDTH ||
                tileBottom <= 0 || tileY >= core_1.ACTUAL_WORLD_HEIGHT;
            // If dynamic skybox is enabled and tile is out of bounds, use closest edge texture
            if (isCompletelyOutOfBounds) {
                if (this.dynamicSkybox) {
                    // Get the center of the tile to find closest edge
                    const tileCenterX = tileX + defaultBgWidth / 2;
                    const tileCenterY = tileY + defaultBgHeight / 2;
                    const edgeTexture = this.getClosestEdgeTexture(tileCenterX, tileCenterY);
                    if (edgeTexture.texture && edgeTexture.texture.complete && edgeTexture.texture.naturalWidth > 0) {
                        const TILE_OVERLAP = 2;
                        const textureWidth = edgeTexture.texture.width;
                        const textureHeight = edgeTexture.texture.height;
                        const scaledWidth = textureWidth + TILE_OVERLAP;
                        const scaledHeight = textureHeight + TILE_OVERLAP;
                        const adjustedTileX = tileX - TILE_OVERLAP / 2;
                        const adjustedTileY = tileY - TILE_OVERLAP / 2;
                        // Draw the edge texture tiled
                        this.ctx.drawImage(edgeTexture.texture, adjustedTileX, adjustedTileY, scaledWidth, scaledHeight);
                    }
                }
                // Skip tiles that are completely outside world boundaries (when dynamic skybox is off)
                continue;
            }
            // Scale each tile up by 2 pixels to prevent rendering artifacts and gaps
            const TILE_OVERLAP = 2;
            const scaledWidth = defaultBgWidth + TILE_OVERLAP;
            const scaledHeight = defaultBgHeight + TILE_OVERLAP;
            // Adjust position to center the overlap (draw 1 pixel to the left and top)
            const adjustedTileX = tileX - TILE_OVERLAP / 2;
            const adjustedTileY = tileY - TILE_OVERLAP / 2;
            const adjustedTileRight = adjustedTileX + scaledWidth;
            const adjustedTileBottom = adjustedTileY + scaledHeight;
            // Check if tile needs clamping to world boundaries
            const needsClamping = adjustedTileX < 0 || adjustedTileY < 0 ||
                adjustedTileRight > core_1.ACTUAL_WORLD_WIDTH ||
                adjustedTileBottom > core_1.ACTUAL_WORLD_HEIGHT;
            // Check if this tile overlaps with any biome
            const biome = this.getBiomeAtPosition(tileX + defaultBgWidth / 2, tileY + defaultBgHeight / 2);
            if (needsClamping) {
                // Clamp tile position and size to world boundaries
                let drawX = Math.floor(Math.max(0, adjustedTileX));
                let drawY = Math.floor(Math.max(0, adjustedTileY));
                let drawWidth = scaledWidth;
                let drawHeight = scaledHeight;
                let sourceX = 0;
                let sourceY = 0;
                // Clamp to left boundary
                if (adjustedTileX < 0) {
                    sourceX = Math.floor(-adjustedTileX);
                    drawWidth -= sourceX;
                    drawX = 0;
                }
                // Clamp to top boundary
                if (adjustedTileY < 0) {
                    sourceY = Math.floor(-adjustedTileY);
                    drawHeight -= sourceY;
                    drawY = 0;
                }
                // Clamp to right boundary
                if (adjustedTileRight > core_1.ACTUAL_WORLD_WIDTH) {
                    drawWidth = Math.floor(core_1.ACTUAL_WORLD_WIDTH - drawX);
                }
                // Clamp to bottom boundary
                if (adjustedTileBottom > core_1.ACTUAL_WORLD_HEIGHT) {
                    drawHeight = Math.floor(core_1.ACTUAL_WORLD_HEIGHT - drawY);
                }
                // Skip if dimensions are invalid
                if (drawWidth <= 0 || drawHeight <= 0) {
                    continue;
                }
                // Use 9-parameter drawImage for clipped tiles
                if (biome && biome.properties?.biomeName && biome.properties?.backgroundTexture) {
                    const biomeTexture = this.biomeTextures.get(biome.properties.biomeName);
                    if (biomeTexture && biomeTexture.complete && biomeTexture.naturalWidth > 0) {
                        const biomeWidth = biomeTexture.width;
                        const biomeHeight = biomeTexture.height;
                        this.ctx.drawImage(biomeTexture, sourceX, sourceY, Math.min(drawWidth, biomeWidth), Math.min(drawHeight, biomeHeight), drawX, drawY, drawWidth, drawHeight);
                    }
                    else {
                        this.ctx.drawImage(this.backgroundTexture, sourceX, sourceY, Math.min(drawWidth, defaultBgWidth), Math.min(drawHeight, defaultBgHeight), drawX, drawY, drawWidth, drawHeight);
                    }
                }
                else {
                    // Check if section has a custom background (color or texture)
                    const sectionIndex = this.getSectionAtPosition(tileX + defaultBgWidth / 2, tileY + defaultBgHeight / 2);
                    const sectionConfig = core_1.SECTION_CONFIGS[sectionIndex];
                    const sectionTexture = this.sectionTextures.get(sectionIndex);
                    const defaultColor = '#00d885';
                    // Check for section texture first
                    if (sectionTexture && sectionTexture.complete && sectionTexture.naturalWidth > 0) {
                        const secTexWidth = sectionTexture.width;
                        const secTexHeight = sectionTexture.height;
                        this.ctx.drawImage(sectionTexture, sourceX, sourceY, Math.min(drawWidth, secTexWidth), Math.min(drawHeight, secTexHeight), drawX, drawY, drawWidth, drawHeight);
                    }
                    else if (sectionConfig?.background && sectionConfig.background.startsWith('#') && sectionConfig.background !== defaultColor) {
                        // Draw section background color
                        this.ctx.fillStyle = sectionConfig.background;
                        this.ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
                    }
                    else {
                        this.ctx.drawImage(this.backgroundTexture, sourceX, sourceY, Math.min(drawWidth, defaultBgWidth), Math.min(drawHeight, defaultBgHeight), drawX, drawY, drawWidth, drawHeight);
                    }
                }
            }
            else {
                // Tile is fully within bounds - draw with 2 pixel overlap
                // Use integer coordinates to avoid sub-pixel rendering gaps
                const drawX = Math.floor(adjustedTileX);
                const drawY = Math.floor(adjustedTileY);
                if (biome && biome.properties?.biomeName && biome.properties?.backgroundTexture) {
                    const biomeTexture = this.biomeTextures.get(biome.properties.biomeName);
                    if (biomeTexture && biomeTexture.complete && biomeTexture.naturalWidth > 0) {
                        const biomeWidth = biomeTexture.width;
                        const biomeHeight = biomeTexture.height;
                        // Draw biome texture scaled up by 2 pixels
                        this.ctx.drawImage(biomeTexture, drawX, drawY, biomeWidth + TILE_OVERLAP, biomeHeight + TILE_OVERLAP);
                    }
                    else {
                        // Draw default texture scaled up by 2 pixels
                        this.ctx.drawImage(this.backgroundTexture, drawX, drawY, scaledWidth, scaledHeight);
                    }
                }
                else {
                    // Check if section has a custom background (color or texture)
                    const sectionIndex = this.getSectionAtPosition(tileX + defaultBgWidth / 2, tileY + defaultBgHeight / 2);
                    const sectionConfig = core_1.SECTION_CONFIGS[sectionIndex];
                    const sectionTexture = this.sectionTextures.get(sectionIndex);
                    const defaultColor = '#00d885';
                    // Check for section texture first
                    if (sectionTexture && sectionTexture.complete && sectionTexture.naturalWidth > 0) {
                        // Draw section texture scaled up by 2 pixels
                        this.ctx.drawImage(sectionTexture, drawX, drawY, sectionTexture.width + TILE_OVERLAP, sectionTexture.height + TILE_OVERLAP);
                    }
                    else if (sectionConfig?.background && sectionConfig.background.startsWith('#') && sectionConfig.background !== defaultColor) {
                        // Draw section background color
                        this.ctx.fillStyle = sectionConfig.background;
                        this.ctx.fillRect(drawX, drawY, scaledWidth, scaledHeight);
                    }
                    else {
                        // Draw default texture scaled up by 2 pixels - this ensures no gaps
                        this.ctx.drawImage(this.backgroundTexture, drawX, drawY, scaledWidth, scaledHeight);
                    }
                }
            }
        }
    }
};
