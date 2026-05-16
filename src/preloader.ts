/**
 * Preloader - Handles loading all game assets and systems before showing the title screen
 */
import { getBiomeSvgContent } from './biome_svgs';
import { SVGCanvasCompiler, renderCompiledSVGToCanvas } from './svg_canvas_renderer';

export interface PreloadedAssets {
    sprites: {
        player: HTMLImageElement;
        coral: HTMLImageElement;
        palm: HTMLImageElement;
        healthPotion: HTMLImageElement;
        speedBoost: HTMLImageElement;
        shield: HTMLImageElement;
        wall: HTMLImageElement;
        exit: HTMLImageElement;
    };
    backgroundTexture: HTMLImageElement;
    petalImages: Record<string, HTMLCanvasElement | HTMLCanvasElement[]>; // Canvas for static, array of canvases for animated
}

export class Preloader {
    private progress: number = 0;
    private totalAssets: number = 0;
    private loadedAssets: number = 0;
    private onProgressCallback?: (progress: number) => void;

    constructor(onProgress?: (progress: number) => void) {
        this.onProgressCallback = onProgress;
    }

    /**
     * Load all game assets
     */
    async loadAssets(): Promise<PreloadedAssets> {
        console.log('[Preloader] Starting asset loading...');
        
        const assets: PreloadedAssets = {
            sprites: {
                player: new Image(),
                coral: new Image(),
                palm: new Image(),
                healthPotion: new Image(),
                speedBoost: new Image(),
                shield: new Image(),
                wall: new Image(),
                exit: new Image(),
            },
            backgroundTexture: new Image(),
            petalImages: {},
        };

        // Calculate total assets to load - we'll update this after loading petal config
        this.totalAssets = Object.keys(assets.sprites).length + 1; // sprites + background
        this.loadedAssets = 0;

        try {
            // Only the three consumable item PNGs remain — everything else is
            // procedural / SVG-driven now.
            await Promise.all([
                this.loadSprite(assets.sprites.healthPotion, 'health_potion.png'),
                this.loadSprite(assets.sprites.speedBoost, 'speed_boost.png'),
                this.loadSprite(assets.sprites.shield, 'shield.png'),
            ]);

            // Load background
            await this.loadBackground(assets.backgroundTexture);

            // Load petal images
            await this.loadPetalImages(assets);

            console.log('[Preloader] All assets loaded successfully');
            this.updateProgress(100);
            
            return assets;
        } catch (error) {
            console.error('[Preloader] Error loading assets:', error);
            throw error;
        }
    }

    /**
     * Load a single sprite
     */
    private async loadSprite(sprite: HTMLImageElement, filename: string): Promise<void> {
        try {
            sprite.crossOrigin = "anonymous";
            sprite.src = await this.getAssetUrl(filename);

            return new Promise((resolve, reject) => {
                sprite.onload = () => {
                    this.loadedAssets++;
                    this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                    console.log(`[Preloader] Loaded ${filename} (${this.loadedAssets}/${this.totalAssets})`);
                    resolve();
                };
                sprite.onerror = (e) => {
                    console.error(`[Preloader] Failed to load sprite: ${filename}`, e);
                    // Don't reject, just resolve to continue loading other assets
                    this.loadedAssets++;
                    this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                    resolve();
                };
            });
        } catch (error) {
            console.error(`[Preloader] Error loading sprite ${filename}:`, error);
            this.loadedAssets++;
            this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
        }
    }

    /**
     * Load background texture from SVG using canvas commands
     */
    private async loadBackground(backgroundTexture: HTMLImageElement): Promise<void> {
        try {
            const svgText = getBiomeSvgContent('land.svg');
            if (!svgText) {
                throw new Error('land.svg not found in bundled SVGs');
            }

            // Render SVG to canvas using canvas commands, then convert to image
            const canvas = await this.renderSVGToCanvas(svgText, 400, 400);
            const dataUrl = canvas.toDataURL('image/png');

            return new Promise((resolve, _reject) => {
                backgroundTexture.onload = () => {
                    this.loadedAssets++;
                    this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                    console.log('[Preloader] Background loaded');
                    resolve();
                };
                backgroundTexture.onerror = () => {
                    console.error('[Preloader] Failed to load background, using fallback');
                    this.createFallbackBackground(backgroundTexture);
                    this.loadedAssets++;
                    this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                    resolve();
                };
                backgroundTexture.src = dataUrl;
            });
        } catch (error) {
            console.error('[Preloader] Error loading background:', error);
            this.createFallbackBackground(backgroundTexture);
            this.loadedAssets++;
            this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
        }
    }

    /**
     * Create fallback background if SVG fails to load
     */
    private createFallbackBackground(backgroundTexture: HTMLImageElement) {
        const svg = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
            <rect width="400" height="400" x="0" y="0" fill="#00d885"/>
            <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(60, 60) rotate(45)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
            <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(180, 80) rotate(-20)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
            <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(300, 70) rotate(120)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
            <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(100, 200) rotate(180)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
            <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(250, 280) rotate(210)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
            <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(340, 230) rotate(-90)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
            <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(80, 300) rotate(75)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
            <circle cx="150" cy="50" r="18" fill="#00f295"/>
            <circle cx="280" cy="180" r="18" fill="#00f295"/>
            <circle cx="50" cy="150" r="18" fill="#00f295"/>
            <circle cx="200" cy="350" r="18" fill="#00f295"/>
            <circle cx="360" cy="320" r="18" fill="#00f295"/>
        </svg>`;

        // Use canvas commands to render fallback SVG
        const compiled = this.svgCompiler.compile(svg);
        const canvas = renderCompiledSVGToCanvas(compiled, 400, 400);
        backgroundTexture.src = canvas.toDataURL('image/png');
    }

    private svgCompiler = new SVGCanvasCompiler();

    /**
     * Render SVG string to offscreen canvas using compiled canvas commands.
     * No data URLs, no Image elements — direct canvas drawing.
     */
    private async renderSVGToCanvas(svgString: string, width: number = 100, height: number = 100, time: number = 0): Promise<HTMLCanvasElement> {
        const compiled = this.svgCompiler.compile(svgString);
        return renderCompiledSVGToCanvas(compiled, width, height, time);
    }

    /**
     * Check if SVG has animations
     */
    private hasAnimations(svgString: string): boolean {
        return /<animate(?:Transform)?\b/i.test(svgString);
    }

    /**
     * Get animation duration from SVG (in milliseconds)
     */
    private getAnimationDuration(svgString: string): number {
        const matches = svgString.matchAll(/\bdur=(["'])(.*?)\1/gi);
        let maxDuration = 0;
        for (const match of matches) {
            const dur = match[2].trim();
            if (dur.endsWith('ms')) {
                maxDuration = Math.max(maxDuration, parseFloat(dur));
            } else if (dur.endsWith('s')) {
                maxDuration = Math.max(maxDuration, parseFloat(dur) * 1000);
            }
        }
        return maxDuration || 2000; // Default 2 seconds
    }

    /**
     * Load petal images from PETAL_CONFIG and render to offscreen canvases
     */
    private async loadPetalImages(assets: PreloadedAssets): Promise<void> {
        try {
            const { PETAL_CONFIG } = await import('./petals');

            // Count total petal images to load
            let petalCount = 0;
            Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
                petalCount += Object.keys(rarities).length;
            });
            
            // Update total assets count (multiply by estimated frames for animated SVGs)
            this.totalAssets += petalCount * 2; // Estimate: some will be animated
            
            const loadPromises: Promise<void>[] = [];

            Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
                Object.entries(rarities as Record<string, any>).forEach(([rarity, stats]) => {
                    const key = `${petalType}_${rarity}`;
                    const svgString = stats.image ?? '';

                    if (!svgString) {
                        this.loadedAssets++;
                        this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                        return;
                    }

                    const promise = (async () => {
                        try {
                            const hasAnim = this.hasAnimations(svgString);

                            if (hasAnim) {
                                // Render all animation frames (24fps = 42ms per frame)
                                const duration = this.getAnimationDuration(svgString);
                                const frameCount = Math.ceil(duration / 42); // 24fps
                                const canvases: HTMLCanvasElement[] = [];

                                for (let frame = 0; frame < frameCount; frame++) {
                                    const time = frame * 42;
                                    // Render SVG with canvas commands at this time
                                    const canvas = await this.renderSVGToCanvas(svgString, 100, 100, time);
                                    canvases.push(canvas);
                                }

                                assets.petalImages[key] = canvases;
                                this.loadedAssets += frameCount;
                                this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                                console.log(`[Preloader] Loaded animated petal: ${key} (${frameCount} frames)`);
                            } else {
                                // Static SVG - render once using canvas commands
                                const canvas = await this.renderSVGToCanvas(svgString, 100, 100);
                                assets.petalImages[key] = canvas;
                                this.loadedAssets++;
                                this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                                console.log(`[Preloader] Loaded static petal: ${key}`);
                            }
                        } catch (error) {
                            console.error(`[Preloader] Failed to load petal ${key}:`, error);
                            this.loadedAssets++;
                            this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                        }
                    })();

                    loadPromises.push(promise);
                });
            });
            
            await Promise.all(loadPromises);
            console.log(`[Preloader] Loaded ${Object.keys(assets.petalImages).length} petal images as canvases`);
        } catch (error) {
            console.error('[Preloader] Error loading petal images:', error);
        }
    }

    /**
     * Get asset URL
     */
    private async getAssetUrl(filename: string): Promise<string> {
        return `./assets/${filename}`;
    }

    /**
     * Update progress and call callback
     */
    private updateProgress(progress: number) {
        this.progress = Math.min(100, Math.max(0, progress));
        if (this.onProgressCallback) {
            this.onProgressCallback(this.progress);
        }
    }

    /**
     * Get current progress
     */
    getProgress(): number {
        return this.progress;
    }
}
