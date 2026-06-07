"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackgroundAnimation = void 0;
const zoom_compensation_1 = require("../zoom-compensation");
const biome_svgs_1 = require("../biome_svgs");
const biomes_1 = require("./biomes");
const floating_petals_1 = require("./floating_petals");
/**
 * Owns the title-screen canvas. Draws the scrolling biome background, runs the
 * floating-petal renderer, and exposes the canvas/context so TitleScreen can
 * paint UI on top of the same canvas via the per-frame `onFrame` callback.
 *
 * This is the single visible canvas on the title screen: bg + petals + UI all
 * land here, and pointer events for the title UI register against it.
 */
class BackgroundAnimation {
    constructor() {
        this.backgroundTime = 0;
        this.animationId = 0;
        this.petalsVisible = true;
        this.onFrame = null;
        this.animate = () => {
            this.backgroundTime += 16;
            this.drawScrollingBackground();
            if (this.petalsVisible) {
                // drawScrollingBackground already set the base scale(dpr); pass
                // logical dimensions so petals fill the screen at native res.
                const dpr = (0, zoom_compensation_1.getBaseDeviceScale)();
                this.floatingPetalManager.draw(this.backgroundCtx, this.backgroundCanvas.width / dpr, this.backgroundCanvas.height / dpr);
            }
            if (this.onFrame)
                this.onFrame();
            this.animationId = requestAnimationFrame(this.animate);
        };
        this.backgroundCanvas = document.createElement('canvas');
        this.backgroundCanvas.id = 'title-background-canvas';
        this.backgroundCanvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: auto;
            z-index: 1000;
        `;
        (0, zoom_compensation_1.applyZoomCompensation)(this.backgroundCanvas, true, true);
        this.backgroundCtx = this.backgroundCanvas.getContext('2d');
        this.backgroundTexture = new Image();
        this.floatingPetalManager = new floating_petals_1.FloatingPetalManager();
    }
    getCanvas() { return this.backgroundCanvas; }
    getCtx() { return this.backgroundCtx; }
    /** Mounts the canvas into document.body. */
    mount() {
        document.body.appendChild(this.backgroundCanvas);
    }
    async loadTexture(biomeName) {
        const biome = biomeName || localStorage.getItem('spawnBiome') || 'default';
        const svgFile = (0, biomes_1.getBiomeSvgFile)(biome);
        return new Promise((resolve) => {
            this.backgroundTexture.onload = () => {
                console.log(`Title screen background loaded successfully for biome: ${biome}`);
                resolve();
            };
            this.backgroundTexture.onerror = (error) => {
                console.error(`Failed to load title screen background for biome ${biome}:`, error);
                this.createFallbackImage();
                resolve();
            };
            const svgText = (0, biome_svgs_1.getBiomeSvgContent)(svgFile);
            if (!svgText) {
                this.createFallbackImage();
                resolve();
                return;
            }
            try {
                const base64 = btoa(unescape(encodeURIComponent(svgText)));
                const dataUrl = `data:image/svg+xml;base64,${base64}`;
                this.backgroundTexture.src = dataUrl;
            }
            catch (error) {
                console.error('Error encoding SVG:', error);
                this.createFallbackImage();
                resolve();
            }
        });
    }
    createFallbackImage() {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#00d885';
        ctx.fillRect(0, 0, 400, 400);
        this.backgroundTexture.src = canvas.toDataURL();
    }
    drawScrollingBackground() {
        // HiDPI: physical backing store + a base scale(dpr) so the title screen
        // renders at native resolution while the code below works in logical
        // (CSS) coordinates — same scheme as the in-game canvas.
        (0, zoom_compensation_1.applyZoomCompensation)(this.backgroundCanvas, true, true);
        const dpr = (0, zoom_compensation_1.getBaseDeviceScale)();
        this.backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const logicalW = this.backgroundCanvas.width / dpr;
        const logicalH = this.backgroundCanvas.height / dpr;
        if (!this.backgroundTexture || !this.backgroundTexture.complete || this.backgroundTexture.naturalWidth === 0) {
            this.backgroundCtx.fillStyle = '#00d885';
            this.backgroundCtx.fillRect(0, 0, logicalW, logicalH);
            return;
        }
        const bgWidth = this.backgroundTexture.width;
        const bgHeight = this.backgroundTexture.height;
        const radius = 2000;
        const centerX = logicalW / 2;
        const centerY = logicalH / 2;
        const cameraX = centerX + Math.cos(this.backgroundTime * 0.00002) * radius;
        const cameraY = centerY + Math.sin(this.backgroundTime * 0.00002) * radius;
        const visibleWidth = logicalW;
        const visibleHeight = logicalH;
        const startX = Math.floor(cameraX / bgWidth) * bgWidth;
        const startY = Math.floor(cameraY / bgHeight) * bgHeight;
        const TILE_OVERLAP = 2;
        const scaledWidth = bgWidth + TILE_OVERLAP;
        const scaledHeight = bgHeight + TILE_OVERLAP;
        const tilesX = Math.ceil(visibleWidth / bgWidth) + 2;
        const tilesY = Math.ceil(visibleHeight / bgHeight) + 2;
        try {
            for (let i = 0; i <= tilesX; i++) {
                for (let j = 0; j <= tilesY; j++) {
                    const baseX = startX + (i * bgWidth) - cameraX;
                    const baseY = startY + (j * bgHeight) - cameraY;
                    const x = Math.floor(baseX - TILE_OVERLAP / 2);
                    const y = Math.floor(baseY - TILE_OVERLAP / 2);
                    this.backgroundCtx.drawImage(this.backgroundTexture, x, y, scaledWidth, scaledHeight);
                }
            }
        }
        catch (error) {
            console.log('Error drawing background:', error);
        }
    }
    start(onFrame) {
        this.onFrame = onFrame ?? null;
        if (!this.animationId) {
            this.animate();
        }
    }
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = 0;
        }
    }
    hide() {
        this.backgroundCanvas.style.display = 'none';
    }
    show() {
        this.backgroundCanvas.style.display = 'block';
    }
    hideFloatingPetals() {
        this.petalsVisible = false;
        this.floatingPetalManager.hide();
    }
    showFloatingPetals() {
        this.petalsVisible = true;
        this.floatingPetalManager.show();
    }
    startFloatingPetals() {
        this.floatingPetalManager.startAnimation();
    }
    stopFloatingPetals() {
        this.floatingPetalManager.stopAnimation();
    }
    destroyFloatingPetals() {
        this.floatingPetalManager.destroy();
    }
}
exports.BackgroundAnimation = BackgroundAnimation;
