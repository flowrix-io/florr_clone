/**
 * AssetLoader - Handles loading and management of game assets
 */

import { PreloadedAssets } from './preloader';
import { MapElement, SECTION_CONFIGS } from './constants';
import { getBiomeSvgContent } from './biome_svgs';

export interface GameAssets {
    sprites: {
        player: HTMLImageElement;
        coral: HTMLImageElement;
        palm: HTMLImageElement;
        healthPotion: HTMLImageElement;
        speedBoost: HTMLImageElement;
        shield: HTMLImageElement;
        wall: HTMLImageElement;
        background: HTMLImageElement;
    };
    itemSprites: Record<string, HTMLImageElement>;
    biomeTextures: Map<string, HTMLImageElement>;
    sectionTextures: Map<number, HTMLImageElement>;
    walls: Array<{
        x: number;
        y: number;
        element: SVGElement;
    }>;
}

export class AssetLoader {
    private assets: GameAssets;
    private backgroundLoadAttempted: boolean = false;

    constructor() {
        this.assets = {
            sprites: {
                player: new Image(),
                coral: new Image(),
                palm: new Image(),
                healthPotion: new Image(),
                speedBoost: new Image(),
                shield: new Image(),
                wall: new Image(),
                background: new Image(),
            },
            itemSprites: {},
            biomeTextures: new Map(),
            sectionTextures: new Map(),
            walls: [],
        };
    }

    /**
     * Initialize assets from preloaded assets
     */
    initializeFromPreloaded(preloadedAssets: PreloadedAssets): void {
        console.log('[AssetLoader] Initializing from preloaded assets');
        this.assets.sprites.player = preloadedAssets.sprites.player;
        this.assets.sprites.coral = preloadedAssets.sprites.coral;
        this.assets.sprites.palm = preloadedAssets.sprites.palm;
        this.assets.sprites.healthPotion = preloadedAssets.sprites.healthPotion;
        this.assets.sprites.speedBoost = preloadedAssets.sprites.speedBoost;
        this.assets.sprites.shield = preloadedAssets.sprites.shield;
        this.assets.sprites.wall = preloadedAssets.sprites.wall;
        this.assets.sprites.background = preloadedAssets.backgroundTexture;
        
        // Set up item sprites from preloaded assets
        this.assets.itemSprites = {
            health_potion: preloadedAssets.sprites.healthPotion,
            speed_boost: preloadedAssets.sprites.speedBoost,
            shield: preloadedAssets.sprites.shield,
        };
    }

    /**
     * Load sprites dynamically (fallback when preloaded assets not available)
     */
    async loadSprites(): Promise<void> {
        console.log('[AssetLoader] Loading sprites dynamically');
        
        const loadSprite = async (sprite: HTMLImageElement, filename: string): Promise<void> => {
            try {
                sprite.crossOrigin = "anonymous";
                sprite.src = await this.getAssetUrl(filename);

                return new Promise((resolve, reject) => {
                    sprite.onload = () => resolve();
                    sprite.onerror = (e) => {
                        console.error(`Failed to load sprite: ${filename}`, e);
                        reject(e);
                    };
                });
            } catch (error) {
                console.error(`Error loading sprite ${filename}:`, error);
                // Don't throw error, just log it and continue
            }
        };

        try {
            await Promise.allSettled([
                loadSprite(this.assets.sprites.player, 'player.png'),
                loadSprite(this.assets.sprites.coral, 'coral.png'),
                loadSprite(this.assets.sprites.palm, 'palm.png')
            ]);
        } catch (error) {
            console.error('Error loading sprites:', error);
            // Continue even if some sprites fail to load
        }
    }

    /**
     * Set up item sprites from preloaded assets
     */
    setupItemSpritesFromPreloaded(preloadedAssets: PreloadedAssets): void {
        console.log('[AssetLoader] Setting up item sprites from preloaded assets');
        this.assets.itemSprites = {
            health_potion: preloadedAssets.sprites.healthPotion,
            speed_boost: preloadedAssets.sprites.speedBoost,
            shield: preloadedAssets.sprites.shield,
        };
    }

    /**
     * Set up item sprites dynamically
     */
    async setupItemSprites(): Promise<void> {
        this.assets.itemSprites = {};
        const itemTypes = ['health_potion', 'speed_boost', 'shield'];

        try {
            await Promise.all(itemTypes.map(async type => {
                const sprite = new Image();
                sprite.crossOrigin = "anonymous";
                const url = await this.getAssetUrl(`${type}.png`);

                await new Promise<void>((resolve, reject) => {
                    sprite.onload = () => {
                        this.assets.itemSprites[type] = sprite;
                        resolve();
                    };
                    sprite.onerror = (error) => {
                        console.error(`Failed to load sprite for ${type}:`, error);
                        reject(error);
                    };
                    sprite.src = url;
                });
            }));

            console.log('All item sprites loaded successfully:', Object.keys(this.assets.itemSprites));
        } catch (error) {
            console.error('Error loading item sprites:', error);
        }
    }

    /**
     * Load background from SVG
     */
    async loadBackgroundFromSVG(): Promise<void> {
        if (this.backgroundLoadAttempted) {
            return; // Prevent infinite loop
        }
        this.backgroundLoadAttempted = true;

        try {
            // Load the land.svg from bundled content
            const svgText = getBiomeSvgContent('land.svg');
            if (!svgText) {
                throw new Error('land.svg not found in bundled SVGs');
            }

            // Convert SVG to data URL (base64) so it's persistent
            const base64 = btoa(unescape(encodeURIComponent(svgText)));
            const dataUrl = `data:image/svg+xml;base64,${base64}`;
            
            // Load directly into backgroundTexture
            this.assets.sprites.background.onload = () => {
                console.log('Background SVG loaded successfully');
                // Remove error handler after successful load
                this.assets.sprites.background.onerror = null;
            };
            this.assets.sprites.background.onerror = (error) => {
                console.error('Failed to load background SVG:', error);
                // Remove error handler to prevent infinite loop
                this.assets.sprites.background.onerror = null;
                // Create a fallback programmatic SVG if loading fails
                this.createFallbackBackground();
            };
            this.assets.sprites.background.src = dataUrl;
        } catch (error) {
            console.error('Error loading background SVG:', error);
            // Create a fallback programmatic SVG if loading fails
            this.createFallbackBackground();
        }
    }

    /**
     * Create fallback background
     */
    private createFallbackBackground(): void {
        console.log('Using fallback background');
        
        try {
            const svg = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"></svg>`;
            
            // Convert to persistent base64 data URL
            const base64 = btoa(unescape(encodeURIComponent(svg)));
            const dataUrl = `data:image/svg+xml;base64,${base64}`;
            
            // Clear any existing handlers to prevent loops
            this.assets.sprites.background.onload = () => {
                console.log('Fallback background loaded successfully');
                this.assets.sprites.background.onload = null;
                this.assets.sprites.background.onerror = null;
            };
            
            // If even the fallback fails, don't try again - just log it
            this.assets.sprites.background.onerror = (error) => {
                console.error('Fallback background also failed to load:', error);
                this.assets.sprites.background.onerror = null;
                this.assets.sprites.background.onload = null;
                // Don't throw or retry - just let the graphics system use the fallback color
            };
            
            this.assets.sprites.background.src = dataUrl;
        } catch (error) {
            console.error('Error creating fallback background:', error);
            // Clear handlers to prevent any further errors
            this.assets.sprites.background.onerror = null;
            this.assets.sprites.background.onload = null;
        }
    }

    /**
     * Load biome-specific background textures
     */
    async loadBiomeTextures(mapData: MapElement[], graphics?: any): Promise<void> {
        // Find all biomes in the map data
        const biomes = mapData.filter(element => element.type === 'biome' && element.properties?.biomeName && element.properties?.backgroundTexture);
        
        // Track which textures we've already loaded to avoid duplicates
        const loadedTextures = new Set<string>();
        
        for (const biome of biomes) {
            const biomeName = biome.properties!.biomeName!;
            const textureFile = biome.properties!.backgroundTexture!;
            
            // Skip if we've already loaded this texture
            if (loadedTextures.has(biomeName)) {
                continue;
            }
            loadedTextures.add(biomeName);
            
            try {
                // Check if it's an SVG file
                if (textureFile.endsWith('.svg')) {
                    const svgText = getBiomeSvgContent(textureFile);
                    if (!svgText) {
                        console.error(`Biome texture ${textureFile} not found in bundled SVGs`);
                        continue;
                    }

                    // Convert SVG to data URL (base64)
                    const base64 = btoa(unescape(encodeURIComponent(svgText)));
                    const dataUrl = `data:image/svg+xml;base64,${base64}`;
                    
                    // Create an image element for the biome texture
                    const biomeTexture = new Image();
                    biomeTexture.onload = () => {
                        console.log(`Biome texture '${biomeName}' loaded successfully from ${textureFile}`);
                        this.assets.biomeTextures.set(biomeName, biomeTexture);
                        // Also set it in graphics if provided
                        if (graphics && graphics.setBiomeTexture) {
                            graphics.setBiomeTexture(biomeName, biomeTexture);
                        }
                    };
                    biomeTexture.onerror = (error) => {
                        console.error(`Failed to load biome texture '${biomeName}' from ${textureFile}:`, error);
                    };
                    biomeTexture.src = dataUrl;
                } else {
                    // For non-SVG images, load directly
                    const biomeTexture = new Image();
                    biomeTexture.onload = () => {
                        console.log(`Biome texture '${biomeName}' loaded successfully from ${textureFile}`);
                        this.assets.biomeTextures.set(biomeName, biomeTexture);
                        // Also set it in graphics if provided
                        if (graphics && graphics.setBiomeTexture) {
                            graphics.setBiomeTexture(biomeName, biomeTexture);
                        }
                    };
                    biomeTexture.onerror = (error) => {
                        console.error(`Failed to load biome texture '${biomeName}' from ${textureFile}:`, error);
                    };
                    biomeTexture.src = `./${textureFile}`;
                }
            } catch (error) {
                console.error(`Error loading biome texture '${biomeName}' from ${textureFile}:`, error);
            }
        }
    }

    /**
     * Load section-specific background textures from SECTION_CONFIGS
     * Sections with SVG paths (not hex colors) will have their textures loaded
     */
    async loadSectionTextures(graphics?: any): Promise<void> {
        for (let i = 0; i < SECTION_CONFIGS.length; i++) {
            const config = SECTION_CONFIGS[i];
            const background = config.background;

            // Skip if no background or if it's a hex color (starts with #)
            if (!background || background.startsWith('#')) {
                continue;
            }

            // It's a texture path (e.g., 'land.svg', 'desert.svg')
            const textureFile = background;

            try {
                // Check if it's an SVG file
                if (textureFile.endsWith('.svg')) {
                    const svgText = getBiomeSvgContent(textureFile);
                    if (!svgText) {
                        console.error(`Section texture ${textureFile} not found in bundled SVGs`);
                        continue;
                    }

                    // Convert SVG to data URL (base64)
                    const base64 = btoa(unescape(encodeURIComponent(svgText)));
                    const dataUrl = `data:image/svg+xml;base64,${base64}`;

                    // Create an image element for the section texture
                    const sectionTexture = new Image();
                    sectionTexture.onload = () => {
                        console.log(`Section ${i + 1} texture loaded successfully from ${textureFile}`);
                        this.assets.sectionTextures.set(i, sectionTexture);
                        // Also set it in graphics if provided
                        if (graphics && graphics.setSectionTexture) {
                            graphics.setSectionTexture(i, sectionTexture);
                        }
                    };
                    sectionTexture.onerror = (error) => {
                        console.error(`Failed to load section ${i + 1} texture from ${textureFile}:`, error);
                    };
                    sectionTexture.src = dataUrl;
                } else {
                    // For non-SVG images, load directly
                    const sectionTexture = new Image();
                    sectionTexture.onload = () => {
                        console.log(`Section ${i + 1} texture loaded successfully from ${textureFile}`);
                        this.assets.sectionTextures.set(i, sectionTexture);
                        // Also set it in graphics if provided
                        if (graphics && graphics.setSectionTexture) {
                            graphics.setSectionTexture(i, sectionTexture);
                        }
                    };
                    sectionTexture.onerror = (error) => {
                        console.error(`Failed to load section ${i + 1} texture from ${textureFile}:`, error);
                    };
                    sectionTexture.src = `./${textureFile}`;
                }
            } catch (error) {
                console.error(`Error loading section ${i + 1} texture from ${textureFile}:`, error);
            }
        }
    }

    /**
     * Load game assets (walls, etc.)
     */
    async loadAssets(): Promise<void> {
        try {
            // Create a simple wall SVG programmatically
            const wallSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            wallSVG.setAttribute("width", "100");
            wallSVG.setAttribute("height", "100");

            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("width", "100");
            rect.setAttribute("height", "100");
            rect.setAttribute("fill", "#666");
            wallSVG.appendChild(rect);

            // Store the wall SVG
            this.assets.walls = Array(100).fill(null).map(() => ({
                x: Math.random() * 10000, // WORLD_WIDTH
                y: Math.random() * 10000, // WORLD_HEIGHT
                element: wallSVG.cloneNode(true) as SVGElement
            }));

            console.log('Successfully initialized walls');
        } catch (error) {
            console.error('Failed to load game assets:', error);
            // Create empty walls array if loading fails
            this.assets.walls = [];
        }
    }

    /**
     * Get asset URL (handles file:// protocol)
     */
    private async getAssetUrl(filename: string): Promise<string> {
        return `./assets/${filename}`;
    }

    /**
     * Apply hue rotation to image data
     */
    applyHueRotation(ctx: CanvasRenderingContext2D, imageData: ImageData, playerHue: number): void {
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            // Skip fully transparent pixels
            if (data[i + 3] === 0) continue;

            // Convert RGB to HSL
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;

            if (max === min) {
                h = s = 0; // achromatic
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                    default: h = 0;
                }
                h /= 6;
            }

            // Only adjust hue if the pixel has some saturation
            if (s > 0.1) {  // Threshold for considering a pixel colored
                h = (h + playerHue / 360) % 1;

                // Convert back to RGB
                if (s === 0) {
                    data[i] = data[i + 1] = data[i + 2] = l * 255;
                } else {
                    const hue2rgb = (p: number, q: number, t: number) => {
                        if (t < 0) t += 1;
                        if (t > 1) t -= 1;
                        if (t < 1 / 6) return p + (q - p) * 6 * t;
                        if (t < 1 / 2) return q;
                        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                        return p;
                    };

                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;

                    data[i] = hue2rgb(p, q, h + 1 / 3) * 255;
                    data[i + 1] = hue2rgb(p, q, h) * 255;
                    data[i + 2] = hue2rgb(p, q, h - 1 / 3) * 255;
                }
            }
        }
    }

    /**
     * Update color preview canvas
     */
    updateColorPreview(colorPreviewCanvas: HTMLCanvasElement, playerHue: number): void {
        if (!this.assets.sprites.player.complete) return;

        const ctx = colorPreviewCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, colorPreviewCanvas.width, colorPreviewCanvas.height);

        // Draw the sprite centered in the preview
        const scale = Math.min(
            colorPreviewCanvas.width / this.assets.sprites.player.width,
            colorPreviewCanvas.height / this.assets.sprites.player.height
        );

        const x = (colorPreviewCanvas.width - this.assets.sprites.player.width * scale) / 2;
        const y = (colorPreviewCanvas.height - this.assets.sprites.player.height * scale) / 2;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.drawImage(this.assets.sprites.player, 0, 0);

        const imageData = ctx.getImageData(0, 0, colorPreviewCanvas.width, colorPreviewCanvas.height);
        this.applyHueRotation(ctx, imageData, playerHue);
        ctx.putImageData(imageData, 0, 0);
        ctx.restore();
    }

    /**
     * Load wall texture
     */
    loadWallTexture(): void {
        this.assets.sprites.wall.src = './assets/wall.png';
        this.assets.sprites.wall.onload = () => {
            console.log('Wall texture loaded successfully');
        };
    }

    // Getters for accessing assets
    get sprites() {
        return this.assets.sprites;
    }

    get itemSprites() {
        return this.assets.itemSprites;
    }

    get biomeTextures() {
        return this.assets.biomeTextures;
    }

    get walls() {
        return this.assets.walls;
    }

    get playerSprite() {
        return this.assets.sprites.player;
    }

    get coralSprite() {
        return this.assets.sprites.coral;
    }

    get palmSprite() {
        return this.assets.sprites.palm;
    }

    get healthPotionSprite() {
        return this.assets.sprites.healthPotion;
    }

    get speedBoostSprite() {
        return this.assets.sprites.speedBoost;
    }

    get shieldSprite() {
        return this.assets.sprites.shield;
    }

    get wallTexture() {
        return this.assets.sprites.wall;
    }

    get backgroundTexture() {
        return this.assets.sprites.background;
    }
}
