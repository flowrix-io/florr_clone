import { applyZoomCompensation, getBaseDeviceScale } from '../zoom-compensation';
import { getBiomeSvgContent } from '../biome_svgs';
import { getBiomeSvgFile } from './biomes';
import { FloatingPetalManager } from './floating_petals';

/**
 * Draws the title screen's scrolling biome background and floating petals.
 *
 * It does NOT own a canvas or an animation loop. It paints into the one canvas
 * the whole client shares (`#gameCanvas`, see AppShell) and is stepped by the
 * shell's single frame loop through `drawFrame()`. It used to create its own
 * `title-background-canvas` and run its own requestAnimationFrame — that second
 * surface and second loop were what made every title↔game handover a
 * synchronisation problem.
 */
export class BackgroundAnimation {
    private backgroundCanvas: HTMLCanvasElement;
    private backgroundCtx: CanvasRenderingContext2D;
    private backgroundTexture: HTMLImageElement;
    private backgroundTime: number = 0;

    private floatingPetalManager: FloatingPetalManager;
    private petalsVisible: boolean = true;

    constructor() {
        // Adopt the shared canvas rather than creating a second one.
        const shared = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
        if (!shared) throw new Error('BackgroundAnimation: #gameCanvas is missing');
        this.backgroundCanvas = shared;
        applyZoomCompensation(this.backgroundCanvas, true, true);
        this.backgroundCtx = this.backgroundCanvas.getContext('2d')!;
        this.backgroundTexture = new Image();
        this.floatingPetalManager = new FloatingPetalManager();
    }

    public getCanvas(): HTMLCanvasElement { return this.backgroundCanvas; }
    public getCtx(): CanvasRenderingContext2D { return this.backgroundCtx; }


    public async loadTexture(biomeName?: string): Promise<void> {
        const biome = biomeName || localStorage.getItem('spawnBiome') || 'default';
        const svgFile = getBiomeSvgFile(biome);

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

            const svgText = getBiomeSvgContent(svgFile);
            if (!svgText) {
                this.createFallbackImage();
                resolve();
                return;
            }

            try {
                const base64 = btoa(unescape(encodeURIComponent(svgText)));
                const dataUrl = `data:image/svg+xml;base64,${base64}`;
                this.backgroundTexture.src = dataUrl;
            } catch (error) {
                console.error('Error encoding SVG:', error);
                this.createFallbackImage();
                resolve();
            }
        });
    }

    private createFallbackImage(): void {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#00d885';
        ctx.fillRect(0, 0, 400, 400);
        this.backgroundTexture.src = canvas.toDataURL();
    }

    private drawScrollingBackground(): void {
        // HiDPI: physical backing store + a base scale(dpr) so the title screen
        // renders at native resolution while the code below works in logical
        // (CSS) coordinates — same scheme as the in-game canvas.
        applyZoomCompensation(this.backgroundCanvas, true, true);
        const dpr = getBaseDeviceScale();
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
        } catch (error) {
            console.log('Error drawing background:', error);
        }
    }

    /**
     * One frame of background + petals. Called by the title scene, which is
     * itself called by the shell's loop — this class never schedules anything.
     */
    public drawFrame(): void {
        this.backgroundTime += 16;
        this.drawScrollingBackground();
        if (this.petalsVisible) {
            // drawScrollingBackground already set the base scale(dpr); pass
            // logical dimensions so petals fill the screen at native res.
            const dpr = getBaseDeviceScale();
            this.floatingPetalManager.draw(
                this.backgroundCtx,
                this.backgroundCanvas.width / dpr,
                this.backgroundCanvas.height / dpr,
            );
        }
    }

    public hideFloatingPetals(): void {
        this.petalsVisible = false;
        this.floatingPetalManager.hide();
    }

    public showFloatingPetals(): void {
        this.petalsVisible = true;
        this.floatingPetalManager.show();
    }

    public startFloatingPetals(): void {
        this.floatingPetalManager.startAnimation();
    }

    public stopFloatingPetals(): void {
        this.floatingPetalManager.stopAnimation();
    }

    public destroyFloatingPetals(): void {
        this.floatingPetalManager.destroy();
    }
}
