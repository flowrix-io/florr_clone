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
const imageAssets_1 = require("./imageAssets");
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
                octopus: new Image(),
                fish: new Image(),
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
                this.loadSprite(assets.sprites.octopus, 'octopus.png'),
                this.loadSprite(assets.sprites.fish, 'fish.png'),
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
     * Load petal images from PETAL_CONFIG
     */
    async loadPetalImages(assets) {
        try {
            const { PETAL_CONFIG } = await Promise.resolve().then(() => __importStar(require('./petals')));
            // Count total petal images to load
            let petalCount = 0;
            Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
                petalCount += Object.keys(rarities).length;
            });
            // Update total assets count
            this.totalAssets += petalCount;
            const loadPromises = [];
            Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
                Object.entries(rarities).forEach(([rarity, stats]) => {
                    const key = `${petalType}_${rarity}`;
                    const img = new Image();
                    const promise = new Promise((resolve, reject) => {
                        img.onload = () => {
                            assets.petalImages[key] = img;
                            this.loadedAssets++;
                            this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                            console.log(`[Preloader] Loaded petal: ${key}`);
                            resolve();
                        };
                        img.onerror = (error) => {
                            console.error(`[Preloader] Failed to load petal ${key}:`, error);
                            // Don't reject, just continue
                            this.loadedAssets++;
                            this.updateProgress((this.loadedAssets / this.totalAssets) * 100);
                            resolve();
                        };
                        // Convert SVG string to data URL (no blob needed)
                        const encodedSVG = encodeURIComponent(stats.image ?? '');
                        img.src = `data:image/svg+xml;charset=utf-8,${encodedSVG}`;
                    });
                    loadPromises.push(promise);
                });
            });
            await Promise.all(loadPromises);
            console.log(`[Preloader] Loaded ${Object.keys(assets.petalImages).length} petal images`);
        }
        catch (error) {
            console.error('[Preloader] Error loading petal images:', error);
        }
    }
    /**
     * Get asset URL (handles file:// protocol)
     */
    async getAssetUrl(filename) {
        const assetKey = filename.replace('.png', '');
        // If running from file:// protocol, use base64 data
        if (window.location.protocol === 'file:') {
            const base64Data = imageAssets_1.IMAGE_ASSETS[assetKey];
            if (base64Data) {
                return base64Data;
            }
            console.error(`[Preloader] No base64 data found for asset: ${filename}`);
        }
        // Otherwise use normal URL
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
