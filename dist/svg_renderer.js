"use strict";
/**
 * TypeScript bindings for C++ SVG renderer
 * This module provides an interface to the WebAssembly-compiled C++ SVG renderer
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
exports.SVGRendererWrapper = void 0;
exports.getSVGRenderer = getSVGRenderer;
class SVGRendererWrapper {
    constructor() {
        this.module = null;
        this.renderer = null;
        this.initialized = false;
        this.initPromise = null;
        this.fallbackMode = false;
        this.imageCache = new Map();
        this.canvasCache = new Map(); // Cache for offscreen canvases
        this.animatedCache = {};
        this.initPromise = this.initialize();
    }
    async initialize() {
        if (this.initialized) {
            return Promise.resolve();
        }
        try {
            // Try to load the WebAssembly module
            // @ts-ignore - WebAssembly module type
            const moduleFactory = await Promise.resolve().then(() => __importStar(require('../dist/svg_renderer.js')));
            const mod = await moduleFactory.default();
            this.module = mod;
            this.renderer = new mod.SVGRenderer();
            this.initialized = true;
            console.log('[SVGRenderer] C++ renderer initialized successfully');
        }
        catch (error) {
            console.warn('[SVGRenderer] Failed to load C++ renderer, using fallback mode:', error);
            this.fallbackMode = true;
            this.initialized = true; // Mark as initialized so we can use fallback
        }
    }
    async waitForInit() {
        if (this.initPromise) {
            await this.initPromise;
        }
    }
    applyAnimationsToSVG(svgString, time) {
        // Simple animation application - extract and update animateTransform
        // This is a fallback if C++ renderer is not available
        let result = svgString;
        // Handle rotation animations
        const rotationRegex = /<animateTransform[^>]*type="rotate"[^>]*from="([^"]*)"[^>]*to="([^"]*)"[^>]*dur="([^"]*)"[^>]*>/g;
        result = result.replace(rotationRegex, (match, from, to, dur) => {
            // Parse duration
            let duration = 1000;
            if (dur.includes('s')) {
                duration = parseFloat(dur) * 1000;
            }
            else if (dur.includes('ms')) {
                duration = parseFloat(dur);
            }
            // Calculate current rotation
            const fromAngle = parseFloat(from.split(' ')[0] || '0');
            const toAngle = parseFloat(to.split(' ')[0] || '360');
            const progress = (time % duration) / duration;
            const currentAngle = fromAngle + (toAngle - fromAngle) * progress;
            return match.replace(`from="${from}"`, `from="${currentAngle} 0 0"`);
        });
        return result;
    }
    loadSVGAsImage(svgString, cacheKey) {
        // Check cache first
        if (this.imageCache.has(cacheKey)) {
            const cached = this.imageCache.get(cacheKey);
            // Return cached image if it's loaded, otherwise return null to trigger async load
            if (cached.complete && cached.naturalWidth > 0) {
                return cached;
            }
            return cached; // Return even if not loaded yet - will be drawn when ready
        }
        // Use data URL instead of blob URL - more efficient, no need to revoke
        // For SVG, we can use a simpler encoding - just escape the string properly
        // Using base64 encoding for better compatibility
        try {
            const base64SVG = btoa(unescape(encodeURIComponent(svgString)));
            const dataUrl = `data:image/svg+xml;base64,${base64SVG}`;
            const img = new Image();
            img.src = dataUrl;
            // Cache the image (even if not loaded yet, it will be cached when loaded)
            this.imageCache.set(cacheKey, img);
            return img;
        }
        catch (error) {
            console.error('[SVGRenderer] Error encoding SVG:', error);
            // Fallback to URI encoding
            const encodedSVG = encodeURIComponent(svgString);
            const dataUrl = `data:image/svg+xml;charset=utf-8,${encodedSVG}`;
            const img = new Image();
            img.src = dataUrl;
            this.imageCache.set(cacheKey, img);
            return img;
        }
    }
    renderSVGToOffscreenCanvas(svgString, width, height) {
        const cacheKey = `${svgString.substring(0, 50)}_${width}_${height}`;
        // Check canvas cache
        if (this.canvasCache.has(cacheKey)) {
            return this.canvasCache.get(cacheKey);
        }
        // Create offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return null;
        // Render SVG to offscreen canvas
        const img = this.loadSVGAsImage(svgString, cacheKey);
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, width, height);
            this.canvasCache.set(cacheKey, canvas);
            return canvas;
        }
        else if (img) {
            // Set up async rendering
            img.onload = () => {
                if (ctx) {
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                }
            };
            this.canvasCache.set(cacheKey, canvas);
            return canvas;
        }
        return null;
    }
    renderSVGToCanvas(ctx, svgString, x, y, width, height, rotation = 0, time = Date.now()) {
        // Get animated SVG string
        let animatedSVG;
        if (this.fallbackMode || !this.renderer) {
            // Fallback: use browser's native SVG rendering
            animatedSVG = this.applyAnimationsToSVG(svgString, time);
        }
        else {
            // Use C++ renderer to get animated SVG string
            try {
                animatedSVG = this.renderer.renderSVG(svgString, time);
            }
            catch (error) {
                // Fallback to JavaScript animation
                this.fallbackMode = true;
                animatedSVG = this.applyAnimationsToSVG(svgString, time);
            }
        }
        // Use the animated SVG as the cache key to ensure we cache the correct version
        // For static SVGs (no animation), this will be the same as the original
        // For animated SVGs, we need to cache based on the animated version
        // But to avoid creating too many cache entries, we use a hash of the original SVG
        // and apply animation at render time
        const baseCacheKey = svgString.length > 100 ? svgString.substring(0, 100) : svgString;
        const img = this.loadSVGAsImage(animatedSVG, baseCacheKey);
        if (!img) {
            return false; // Failed to create image
        }
        // Check if image is ready - use both complete and naturalWidth checks
        const isReady = img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
        if (isReady) {
            // Image is loaded, draw it directly
            // Note: The context passed in may already have transforms applied (translate/rotate)
            // So we apply additional transforms relative to the current state
            // If x,y,rotation are 0, it means transforms are already applied by the caller
            if (x !== 0 || y !== 0 || rotation !== 0) {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(rotation);
                ctx.drawImage(img, -width / 2, -height / 2, width, height);
                ctx.restore();
            }
            else {
                // Transforms already applied, just draw
                ctx.drawImage(img, -width / 2, -height / 2, width, height);
            }
            return true; // Successfully rendered
        }
        // Image is still loading - return false so fallback can be used
        return false;
    }
    clearCache() {
        if (this.renderer) {
            this.renderer.clearCache();
        }
        this.imageCache.clear();
        this.canvasCache.clear();
        this.animatedCache = {};
    }
    isInitialized() {
        return this.initialized;
    }
    isUsingFallback() {
        return this.fallbackMode;
    }
}
exports.SVGRendererWrapper = SVGRendererWrapper;
// Singleton instance
let svgRendererInstance = null;
function getSVGRenderer() {
    if (!svgRendererInstance) {
        svgRendererInstance = new SVGRendererWrapper();
    }
    return svgRendererInstance;
}
