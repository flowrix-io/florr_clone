"use strict";
/**
 * Preloader - Handles loading all game assets and systems before showing the title screen
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Preloader = void 0;
class Preloader {
    constructor(onProgress) {
        this.progress = 0;
        this.totalAssets = 0;
        this.loadedAssets = 0;
        this.onProgressCallback = onProgress;
    }
    /**
     * Load all game assets
     */
    async loadAssets() {
        console.log('[Preloader] Starting asset loading...');
        const assets = {
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
            // Load all sprites in parallel
            await Promise.all([
                this.loadSprite(assets.sprites.player, 'player.png'),
                this.loadSprite(assets.sprites.coral, 'coral.png'),
                this.loadSprite(assets.sprites.palm, 'palm.png'),
                this.loadSprite(assets.sprites.healthPotion, 'health_potion.png'),
                this.loadSprite(assets.sprites.speedBoost, 'speed_boost.png'),
                this.loadSprite(assets.sprites.shield, 'shield.png'),
                this.loadSprite(assets.sprites.wall, 'wall.png'),
                this.loadSprite(assets.sprites.exit, 'exit.png'),
            ]);
            // Load background
            await this.loadBackground(assets.backgroundTexture);
            // Load petal images
            await this.loadPetalImages(assets);
            console.log('[Preloader] All assets loaded successfully');
            this.updateProgress(100);
            return assets;
        }
        catch (error) {
            console.error('[Preloader] Error loading assets:', error);
            throw error;
        }
    }
    /**
     * Load a single sprite
     */
    async loadSprite(sprite, filename) {
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
        }
        catch (error) {
            console.error(`[Preloader] Error loading sprite ${filename}:`, error);
            this.loadedAssets++;
            this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
        }
    }
    /**
     * Load background texture from SVG
     */
    async loadBackground(backgroundTexture) {
        try {
            const response = await fetch('./land.svg');
            if (!response.ok) {
                throw new Error(`Failed to fetch land.svg: ${response.status}`);
            }
            const svgText = await response.text();
            // Convert SVG to data URL
            const base64 = btoa(unescape(encodeURIComponent(svgText)));
            const dataUrl = `data:image/svg+xml;base64,${base64}`;
            return new Promise((resolve, reject) => {
                backgroundTexture.onload = () => {
                    this.loadedAssets++;
                    this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                    console.log('[Preloader] Background loaded');
                    resolve();
                };
                backgroundTexture.onerror = (error) => {
                    console.error('[Preloader] Failed to load background, using fallback');
                    this.createFallbackBackground(backgroundTexture);
                    this.loadedAssets++;
                    this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                    resolve();
                };
                backgroundTexture.src = dataUrl;
            });
        }
        catch (error) {
            console.error('[Preloader] Error loading background:', error);
            this.createFallbackBackground(backgroundTexture);
            this.loadedAssets++;
            this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
        }
    }
    /**
     * Create fallback background if SVG fails to load
     */
    createFallbackBackground(backgroundTexture) {
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
        const base64 = btoa(unescape(encodeURIComponent(svg)));
        const dataUrl = `data:image/svg+xml;base64,${base64}`;
        backgroundTexture.src = dataUrl;
    }
    /**
     * Render SVG string to offscreen canvas using createImageBitmap (no data URLs, no requests)
     */
    async renderSVGToCanvas(svgString, width = 100, height = 100) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get canvas context');
        }
        // createImageBitmap doesn't support raw SVG directly
        // We need to use an Image element with a data URL
        // createImageBitmap is available in modern browsers
        if (typeof createImageBitmap === 'undefined') {
            throw new Error('createImageBitmap not available');
        }
        // Create data URL from SVG
        const base64 = btoa(unescape(encodeURIComponent(svgString)));
        const dataUrl = `data:image/svg+xml;base64,${base64}`;
        // Create Image element and load from data URL
        const img = new Image();
        const imageBitmap = await new Promise((resolve, reject) => {
            img.onload = async () => {
                try {
                    // Use createImageBitmap on the loaded image with resize options
                    const bitmap = await createImageBitmap(img, { resizeWidth: width, resizeHeight: height });
                    resolve(bitmap);
                }
                catch (error) {
                    reject(error);
                }
            };
            img.onerror = () => {
                reject(new Error('Failed to load SVG image'));
            };
            img.src = dataUrl;
        });
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(imageBitmap, 0, 0, width, height);
        imageBitmap.close(); // Free memory
        return canvas;
    }
    /**
     * Check if SVG has animations
     */
    hasAnimations(svgString) {
        return svgString.includes('<animateTransform') || svgString.includes('<animate');
    }
    /**
     * Get animation duration from SVG (in milliseconds)
     */
    getAnimationDuration(svgString) {
        // Look for dur attribute in animateTransform
        const durMatch = svgString.match(/dur="([^"]*)"/);
        if (durMatch) {
            const dur = durMatch[1];
            if (dur.includes('s')) {
                return parseFloat(dur) * 1000;
            }
            else if (dur.includes('ms')) {
                return parseFloat(dur);
            }
        }
        return 2000; // Default 2 seconds
    }
    /**
     * Load petal images from PETAL_CONFIG and render to offscreen canvases
     */
    async loadPetalImages(assets) {
        try {
            const { PETAL_CONFIG } = await Promise.resolve().then(() => __importStar(require('./petals')));
            const { getSVGRenderer } = await Promise.resolve().then(() => __importStar(require('./svg_renderer')));
            const svgRenderer = getSVGRenderer();
            await svgRenderer.waitForInit();
            // Count total petal images to load
            let petalCount = 0;
            Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
                petalCount += Object.keys(rarities).length;
            });
            // Update total assets count (multiply by estimated frames for animated SVGs)
            this.totalAssets += petalCount * 2; // Estimate: some will be animated
            const loadPromises = [];
            Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
                Object.entries(rarities).forEach(([rarity, stats]) => {
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
                                const canvases = [];
                                for (let frame = 0; frame < frameCount; frame++) {
                                    const time = frame * 42; // Time in ms for this frame
                                    // Get animated SVG string from renderer
                                    const animatedSVG = svgRenderer.getAnimatedSVGString(svgString, time);
                                    const canvas = await this.renderSVGToCanvas(animatedSVG, 100, 100);
                                    canvases.push(canvas);
                                }
                                assets.petalImages[key] = canvases;
                                this.loadedAssets += frameCount;
                                this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                                console.log(`[Preloader] Loaded animated petal: ${key} (${frameCount} frames)`);
                            }
                            else {
                                // Static SVG - render once
                                const canvas = await this.renderSVGToCanvas(svgString, 100, 100);
                                assets.petalImages[key] = canvas;
                                this.loadedAssets++;
                                this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                                console.log(`[Preloader] Loaded static petal: ${key}`);
                            }
                        }
                        catch (error) {
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
        }
        catch (error) {
            console.error('[Preloader] Error loading petal images:', error);
        }
    }
    /**
     * Get asset URL
     */
    async getAssetUrl(filename) {
        return `./assets/${filename}`;
    }
    /**
     * Update progress and call callback
     */
    updateProgress(progress) {
        this.progress = Math.min(100, Math.max(0, progress));
        if (this.onProgressCallback) {
            this.onProgressCallback(this.progress);
        }
    }
    /**
     * Get current progress
     */
    getProgress() {
        return this.progress;
    }
}
exports.Preloader = Preloader;
