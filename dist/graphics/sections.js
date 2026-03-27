"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
// Method to get biome at a position
core_1.Graphics.prototype.getBiomeAtPosition = function (x, y) {
    for (const element of this.mapData) {
        if (element.type === 'biome') {
            if (x >= element.x && x <= element.x + element.width &&
                y >= element.y && y <= element.y + element.height) {
                return element;
            }
        }
    }
    return null;
};
// Get section index (0-8) from world position
core_1.Graphics.prototype.getSectionAtPosition = function (x, y) {
    const SECTION_SIZE = 20000;
    const sectionX = Math.max(0, Math.min(2, Math.floor(x / SECTION_SIZE)));
    const sectionY = Math.max(0, Math.min(2, Math.floor(y / SECTION_SIZE)));
    return sectionY * 3 + sectionX;
};
/**
 * Get adjacent sections for a given section (including diagonals)
 * Section grid:
 * [0][1][2]
 * [3][4][5]
 * [6][7][8]
 */
core_1.Graphics.prototype.getAdjacentSections = function (section) {
    const sectionX = section % 3;
    const sectionY = Math.floor(section / 3);
    const adjacent = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0)
                continue; // Skip self
            const newX = sectionX + dx;
            const newY = sectionY + dy;
            if (newX >= 0 && newX < 3 && newY >= 0 && newY < 3) {
                adjacent.push(newY * 3 + newX);
            }
        }
    }
    return adjacent;
};
/**
 * Update current section tracking
 * Called during render to track player's current section
 * Note: All frames are pre-loaded at startup, so no dynamic loading needed
 */
core_1.Graphics.prototype.updateSectionTextures = function (playerX, playerY) {
    const newSection = this.getSectionAtPosition(playerX, playerY);
    if (newSection !== this.currentSection) {
        this.currentSection = newSection;
    }
};
// Method to find the closest wall or biome edge to an out-of-bounds position
// Returns the texture to use for tiling (wall texture or biome texture)
core_1.Graphics.prototype.getClosestEdgeTexture = function (x, y) {
    // Check if position is out of bounds
    const isOutOfBounds = x < 0 || x >= core_1.ACTUAL_WORLD_WIDTH || y < 0 || y >= core_1.ACTUAL_WORLD_HEIGHT;
    if (!isOutOfBounds) {
        return { texture: null, isBiome: false };
    }
    let closestDistance = Infinity;
    let closestElement = null;
    let closestIsWall = false;
    // Check walls first
    for (const element of this.mapData) {
        if (element.type === 'wall') {
            // Calculate distance to wall edges
            const wallLeft = element.x;
            const wallRight = element.x + element.width;
            const wallTop = element.y;
            const wallBottom = element.y + element.height;
            // Find closest point on wall rectangle to (x, y)
            const closestX = Math.max(wallLeft, Math.min(x, wallRight));
            const closestY = Math.max(wallTop, Math.min(y, wallBottom));
            const distance = Math.sqrt((x - closestX) ** 2 + (y - closestY) ** 2);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestElement = element;
                closestIsWall = true;
            }
        }
    }
    // Check biomes
    for (const element of this.mapData) {
        if (element.type === 'biome') {
            // Calculate distance to biome edges
            const biomeLeft = element.x;
            const biomeRight = element.x + element.width;
            const biomeTop = element.y;
            const biomeBottom = element.y + element.height;
            // Find closest point on biome rectangle to (x, y)
            const closestX = Math.max(biomeLeft, Math.min(x, biomeRight));
            const closestY = Math.max(biomeTop, Math.min(y, biomeBottom));
            const distance = Math.sqrt((x - closestX) ** 2 + (y - closestY) ** 2);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestElement = element;
                closestIsWall = false;
            }
        }
    }
    // Return appropriate texture
    if (closestElement) {
        if (closestIsWall) {
            return { texture: this.wallTexture, isBiome: false };
        }
        else {
            // It's a biome - get its texture
            const biomeName = closestElement.properties?.biomeName;
            if (biomeName) {
                const biomeTexture = this.biomeTextures.get(biomeName);
                if (biomeTexture && biomeTexture.complete && biomeTexture.naturalWidth > 0) {
                    return { texture: biomeTexture, isBiome: true };
                }
            }
            // Fallback to default background if biome texture not available
            return { texture: this.backgroundTexture, isBiome: false };
        }
    }
    // Default fallback
    return { texture: this.backgroundTexture, isBiome: false };
};
