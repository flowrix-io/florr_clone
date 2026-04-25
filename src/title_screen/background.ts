import { applyZoomCompensation } from '../zoom-compensation';
import { getBiomeSvgContent } from '../biome_svgs';
import { getBiomeSvgFile } from './biomes';
import { FloatingPetalManager } from './floating_petals';

/**
 * Owns the title-screen scrolling background canvas and the floating-petal layer.
 * `start()` accepts an optional per-frame callback for unrelated work (used by
 * TitleScreen to drive changelog/notifications/leaderboard/guild canvas state).
 */
export class BackgroundAnimation {
    private backgroundCanvas: HTMLCanvasElement;
    private backgroundCtx: CanvasRenderingContext2D;
    private backgroundTexture: HTMLImageElement;
    private backgroundTime: number = 0;
    private animationId: number = 0;

    private floatingPetalsContainer: HTMLElement;
    private floatingPetalManager: FloatingPetalManager | null = null;

    private onFrame: (() => void) | null = null;

    constructor() {
        this.backgroundCanvas = document.createElement('canvas');
        this.backgroundCanvas.id = 'title-background-canvas';
        this.backgroundCanvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 1;
        `;
        applyZoomCompensation(this.backgroundCanvas);
        this.backgroundCtx = this.backgroundCanvas.getContext('2d')!;
        this.backgroundTexture = new Image();

        this.floatingPetalsContainer = document.createElement('div');
        this.floatingPetalsContainer.id = 'floating-petals-container';
        this.floatingPetalsContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 50;
            overflow: hidden;
        `;
    }

    /** Mounts both the bg canvas and the floating-petal container into document.body. */
    public mount(): void {
        document.body.appendChild(this.backgroundCanvas);
        document.body.appendChild(this.floatingPetalsContainer);
        this.floatingPetalManager = new FloatingPetalManager(this.floatingPetalsContainer);
    }

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
        applyZoomCompensation(this.backgroundCanvas);

        if (!this.backgroundTexture || !this.backgroundTexture.complete || this.backgroundTexture.naturalWidth === 0) {
            this.backgroundCtx.fillStyle = '#00d885';
            this.backgroundCtx.fillRect(0, 0, this.backgroundCanvas.width, this.backgroundCanvas.height);
            return;
        }

        const bgWidth = this.backgroundTexture.width;
        const bgHeight = this.backgroundTexture.height;

        const radius = 2000;
        const centerX = this.backgroundCanvas.width / 2;
        const centerY = this.backgroundCanvas.height / 2;

        const cameraX = centerX + Math.cos(this.backgroundTime * 0.00002) * radius;
        const cameraY = centerY + Math.sin(this.backgroundTime * 0.00002) * radius;

        const visibleWidth = this.backgroundCanvas.width;
        const visibleHeight = this.backgroundCanvas.height;

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

    private animate = (): void => {
        this.backgroundTime += 16;
        this.drawScrollingBackground();
        if (this.onFrame) this.onFrame();
        this.animationId = requestAnimationFrame(this.animate);
    };

    public start(onFrame?: () => void): void {
        this.onFrame = onFrame ?? null;
        if (!this.animationId) {
            this.animate();
        }
    }

    public stop(): void {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = 0;
        }
    }

    public hide(): void {
        this.backgroundCanvas.style.display = 'none';
    }

    public show(): void {
        this.backgroundCanvas.style.display = 'block';
    }

    public hideFloatingPetals(): void {
        this.floatingPetalManager?.stopAnimation();
        this.floatingPetalsContainer.style.display = 'none';
    }

    public showFloatingPetals(): void {
        this.floatingPetalManager?.startAnimation();
        this.floatingPetalsContainer.style.display = 'block';
    }

    public startFloatingPetals(): void {
        this.floatingPetalManager?.startAnimation();
    }

    public stopFloatingPetals(): void {
        this.floatingPetalManager?.stopAnimation();
    }

    public destroyFloatingPetals(): void {
        this.floatingPetalManager?.destroy();
    }
}
