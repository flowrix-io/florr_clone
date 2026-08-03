"use strict";
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
exports.setPreloadedAssets = setPreloadedAssets;
exports.getPreloadedAssets = getPreloadedAssets;
/**
 * Preloader - Handles loading all game assets and systems before showing the title screen
 */
const biome_svgs_1 = require("./biome_svgs");
const svg_canvas_renderer_1 = require("./svg_canvas_renderer");
class Preloader {
    constructor(onProgress) {
        this.progress = 0;
        this.totalAssets = 0;
        this.loadedAssets = 0;
        this.svgCompiler = new svg_canvas_renderer_1.SVGCanvasCompiler();
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
     * Load background texture from SVG using canvas commands
     */
    async loadBackground(backgroundTexture) {
        try {
            const svgText = (0, biome_svgs_1.getBiomeSvgContent)('land.svg');
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
        // Use canvas commands to render fallback SVG
        const compiled = this.svgCompiler.compile(svg);
        const canvas = (0, svg_canvas_renderer_1.renderCompiledSVGToCanvas)(compiled, 400, 400);
        backgroundTexture.src = canvas.toDataURL('image/png');
    }
    /**
     * Render SVG string to offscreen canvas using compiled canvas commands.
     * No data URLs, no Image elements — direct canvas drawing.
     */
    async renderSVGToCanvas(svgString, width = 100, height = 100, time = 0) {
        const compiled = this.svgCompiler.compile(svgString);
        return (0, svg_canvas_renderer_1.renderCompiledSVGToCanvas)(compiled, width, height, time);
    }
    /**
     * Check if SVG has animations
     */
    hasAnimations(svgString) {
        return /<animate(?:Transform)?\b/i.test(svgString);
    }
    /**
     * Get animation duration from SVG (in milliseconds)
     */
    getAnimationDuration(svgString) {
        const matches = svgString.matchAll(/\bdur=(["'])(.*?)\1/gi);
        let maxDuration = 0;
        for (const match of matches) {
            const dur = match[2].trim();
            if (dur.endsWith('ms')) {
                maxDuration = Math.max(maxDuration, parseFloat(dur));
            }
            else if (dur.endsWith('s')) {
                maxDuration = Math.max(maxDuration, parseFloat(dur) * 1000);
            }
        }
        return maxDuration || 2000; // Default 2 seconds
    }
    /**
     * Load petal images from PETAL_CONFIG and render to offscreen canvases
     */
    async loadPetalImages(assets) {
        try {
            const { PETAL_CONFIG } = await Promise.resolve().then(() => __importStar(require('./petals')));
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
                                    const time = frame * 42;
                                    // Render SVG with canvas commands at this time
                                    const canvas = await this.renderSVGToCanvas(svgString, 100, 100, time);
                                    canvases.push(canvas);
                                }
                                assets.petalImages[key] = canvases;
                                this.loadedAssets += frameCount;
                                this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                                console.log(`[Preloader] Loaded animated petal: ${key} (${frameCount} frames)`);
                            }
                            else {
                                // Static SVG - render once using canvas commands
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
/**
 * Assets loaded once at boot and shared by everything that draws petals or
 * sprites. Was `window.preloadedAssets`; the sprite atlas has no business
 * being on the global object, and the readers all live in this bundle.
 */
let preloadedAssets = null;
function setPreloadedAssets(assets) {
    preloadedAssets = assets;
}
function getPreloadedAssets() {
    return preloadedAssets;
}
