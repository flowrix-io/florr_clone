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
        this.dataUrlCache = new Map(); // Cache data URL strings to avoid recreating them
        this.canvasCache = new Map(); // Cache for offscreen canvases (primary storage)
        this.animatedCache = {};
        this.preloadingComplete = false; // Track if preloading phase is complete
        this.initPromise = this.initialize();
    }
    async initialize() {
        if (this.initialized) {
            return Promise.resolve();
        }
        try {
            // Try to load the WebAssembly module
            console.log('[SVGRenderer] Attempting to load WASM module...');
            // @ts-ignore - WebAssembly module type
            // Use dynamic import with a string literal to avoid webpack processing
            // Path is relative to the served root (dist directory)
            const moduleFactory = await Promise.resolve().then(() => __importStar(require(/* webpackIgnore: true */ './svg_renderer_wasm.js')));
            console.log('[SVGRenderer] Module factory loaded, initializing...');
            // Configure locateFile to find the WASM file in the dist directory
            const mod = await moduleFactory.default({
                locateFile: (path, prefix) => {
                    // If it's the WASM file, return the correct path
                    if (path.endsWith('.wasm')) {
                        console.log(`[SVGRenderer] locateFile called for WASM: ${path}, returning: ./svg_renderer_wasm.wasm`);
                        return './svg_renderer_wasm.wasm';
                    }
                    // For other files, use the default behavior
                    return prefix + path;
                }
            });
            console.log('[SVGRenderer] Module initialized, creating renderer instance...');
            this.module = mod;
            this.renderer = new mod.SVGRenderer();
            this.initialized = true;
            this.fallbackMode = false; // Explicitly set to false when WASM loads successfully
            console.log('[SVGRenderer] C++ renderer initialized successfully, WASM mode active');
        }
        catch (error) {
            console.error('[SVGRenderer] Failed to load C++ renderer, using fallback mode:', error);
            console.error('[SVGRenderer] Error details:', error instanceof Error ? error.stack : error);
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
    async loadSVGAsImageBitmap(svgString, cacheKey) {
        // Check cache first - reuse existing image bitmap if available
        if (this.imageCache.has(cacheKey)) {
            const cached = this.imageCache.get(cacheKey);
            // If it's an ImageBitmap, return it
            if (cached && typeof cached.close === 'function') {
                return cached;
            }
        }
        // createImageBitmap doesn't support raw SVG Blobs directly
        // We need to use an Image element, but we'll use a blob URL instead of data URL
        // Blob URLs are more efficient and don't create the same request overhead
        if (typeof createImageBitmap === 'undefined') {
            console.warn('[SVGRenderer] createImageBitmap not available, falling back');
            return null;
        }
        try {
            // Create blob URL from SVG (more efficient than data URL)
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            const blobUrl = URL.createObjectURL(blob);
            // Create Image element and load from blob URL
            const img = new Image();
            const imageBitmap = await new Promise((resolve, reject) => {
                img.onload = async () => {
                    try {
                        // Use createImageBitmap on the loaded image
                        const bitmap = await createImageBitmap(img);
                        // Revoke blob URL immediately to free memory
                        URL.revokeObjectURL(blobUrl);
                        resolve(bitmap);
                    }
                    catch (error) {
                        URL.revokeObjectURL(blobUrl);
                        reject(error);
                    }
                };
                img.onerror = () => {
                    URL.revokeObjectURL(blobUrl);
                    reject(new Error('Failed to load SVG image'));
                };
                img.src = blobUrl;
            });
            // Cache the ImageBitmap
            this.imageCache.set(cacheKey, imageBitmap);
            return imageBitmap;
        }
        catch (error) {
            console.error('[SVGRenderer] Error creating image bitmap:', error);
            return null;
        }
    }
    // Legacy method - kept for fallback but should not be used (creates data URLs)
    loadSVGAsImage(svgString, cacheKey) {
        // This method creates data URLs and should be avoided
        // Use loadSVGAsImageBitmap instead
        console.warn('[SVGRenderer] loadSVGAsImage called - this creates data URLs and should be avoided');
        return null;
    }
    async renderSVGToOffscreenCanvas(svgString, width, height) {
        // Prevent blob URL creation during gameplay - only allow during preloading
        if (this.preloadingComplete) {
            if (Math.random() < 0.01) { // Only log occasionally to avoid spam
                console.warn('[SVGRenderer] renderSVGToOffscreenCanvas called after preloading complete (preloadingComplete=' + this.preloadingComplete + ') - blob URLs should not be created during gameplay');
            }
            return null;
        }
        try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return null;
            }
            // createImageBitmap doesn't support raw SVG Blobs directly
            // We need to use an Image element with a blob URL (more efficient than data URL)
            // createImageBitmap is available in modern browsers
            if (typeof createImageBitmap === 'undefined') {
                console.warn('[SVGRenderer] createImageBitmap not available');
                return null;
            }
            // Create blob URL from SVG (more efficient than data URL)
            // NOTE: This should only happen during preloading phase
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            const blobUrl = URL.createObjectURL(blob);
            // Create Image element and load from blob URL
            const img = new Image();
            const imageBitmap = await new Promise((resolve, reject) => {
                img.onload = async () => {
                    try {
                        // Use createImageBitmap on the loaded image with resize options
                        const bitmap = await createImageBitmap(img, { resizeWidth: width, resizeHeight: height });
                        // Revoke blob URL immediately to free memory
                        URL.revokeObjectURL(blobUrl);
                        resolve(bitmap);
                    }
                    catch (error) {
                        URL.revokeObjectURL(blobUrl);
                        reject(error);
                    }
                };
                img.onerror = () => {
                    URL.revokeObjectURL(blobUrl);
                    reject(new Error('Failed to load SVG image'));
                };
                img.src = blobUrl;
            });
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(imageBitmap, 0, 0, width, height);
            imageBitmap.close(); // Free memory
            return canvas;
        }
        catch (error) {
            console.error('[SVGRenderer] Error rendering SVG to canvas:', error);
            return null;
        }
    }
    renderSVGToCanvas(ctx, svgString, x, y, width, height, rotation = 0, time = Date.now()) {
        // Get animated SVG string
        let animatedSVG;
        if (this.fallbackMode || !this.renderer) {
            // Fallback: use browser's native SVG rendering
            if (Math.random() < 0.001) {
                console.log(`[SVGRenderer] Using fallback mode: fallbackMode=${this.fallbackMode}, renderer=${!!this.renderer}`);
            }
            animatedSVG = this.applyAnimationsToSVG(svgString, time);
        }
        else {
            // Use C++ renderer to get animated SVG string
            try {
                animatedSVG = this.renderer.renderSVG(svgString, time);
                // Debug: Check if animation was applied
                if (Math.random() < 0.01) {
                    const hasAnimateTransform = svgString.includes('animateTransform');
                    const stillHasAnimateTransform = animatedSVG.includes('animateTransform');
                    const hasTransform = animatedSVG.includes('transform=');
                    // Extract transform values to see what's being generated
                    const transformMatches = animatedSVG.match(/transform="([^"]*)"/g);
                    const transforms = transformMatches ? transformMatches.map(m => m.match(/transform="([^"]*)"/)?.[1]) : [];
                    console.log('[SVGRenderer] WASM renderer result:', {
                        originalHasAnim: hasAnimateTransform,
                        stillHasAnim: stillHasAnimateTransform,
                        hasTransform: hasTransform,
                        originalLength: svgString.length,
                        animatedLength: animatedSVG.length,
                        changed: svgString !== animatedSVG,
                        time: time,
                        transforms: transforms.slice(0, 3) // Show first 3 transforms
                    });
                    // Show a sample of the animated SVG
                    if (transforms.length > 0) {
                        const sampleStart = animatedSVG.indexOf(transforms[0] || '');
                        if (sampleStart > 0) {
                            const sample = animatedSVG.substring(Math.max(0, sampleStart - 50), Math.min(animatedSVG.length, sampleStart + 200));
                            console.log('[SVGRenderer] Sample animated SVG:', sample);
                        }
                    }
                }
            }
            catch (error) {
                // Fallback to JavaScript animation
                console.error('[SVGRenderer] Error calling WASM renderSVG, falling back to JS:', error);
                this.fallbackMode = true;
                animatedSVG = this.applyAnimationsToSVG(svgString, time);
            }
        }
        // For animated SVGs, we need to use a time-based cache key to ensure
        // the animation updates each frame. Use 15fps (67ms buckets) for smooth but not laggy animation
        // Use modulo to wrap time within animation cycle (2000ms = 30 frames * 67ms)
        // This ensures cache keys match between preloading and rendering
        const animationCycleDuration = 2000; // 30 frames * 67ms = 2 seconds
        const relativeTime = time % animationCycleDuration;
        const timeBucket = Math.floor(relativeTime / 67); // Update every ~67ms for 15fps
        // Normalize SVG string for consistent cache key generation
        // Remove whitespace differences, normalize attributes, and use a stable key
        // This ensures cache keys match between preloading and rendering
        let normalizedSVG = svgString.replace(/\s+/g, ' ').trim();
        // Remove xmlns attribute variations (they don't affect rendering)
        normalizedSVG = normalizedSVG.replace(/\s+xmlns="[^"]*"/g, '');
        // Use a more stable key based on viewBox and key attributes (more reliable than first N chars)
        const viewBoxMatch = normalizedSVG.match(/viewBox="([^"]*)"/);
        const widthMatch = normalizedSVG.match(/width="([^"]*)"/);
        const keyParts = [
            viewBoxMatch ? viewBoxMatch[1] : '',
            widthMatch ? widthMatch[1] : '',
            normalizedSVG.length.toString()
        ];
        const baseCacheKey = keyParts.join('|');
        const animatedCacheKey = `${baseCacheKey}_${timeBucket}`;
        // Debug: Log cache lookup occasionally
        if (Math.random() < 0.01) {
            console.log(`[SVGRenderer] Cache lookup: key="${animatedCacheKey.substring(0, 60)}...", hasCache=${this.canvasCache.has(animatedCacheKey)}, cacheSize=${this.canvasCache.size}, timeBucket=${timeBucket}, relativeTime=${relativeTime.toFixed(1)}`);
            // Show what keys exist for this SVG
            const matchingKeys = Array.from(this.canvasCache.keys()).filter(k => k.startsWith(baseCacheKey.substring(0, 50)));
            console.log(`[SVGRenderer] Matching keys for this SVG:`, matchingKeys.slice(0, 5).map(k => {
                const match = k.match(/_(\d+)$/);
                return match ? `timeBucket=${match[1]}` : k.substring(0, 30);
            }));
        }
        // Check if we already have this frame as a canvas (preferred - no data URLs)
        if (this.canvasCache.has(animatedCacheKey)) {
            const cachedCanvas = this.canvasCache.get(animatedCacheKey);
            if (cachedCanvas.width > 0 && cachedCanvas.height > 0) {
                // Use cached canvas immediately
                if (x !== 0 || y !== 0 || rotation !== 0) {
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(rotation);
                    ctx.drawImage(cachedCanvas, -width / 2, -height / 2, width, height);
                    ctx.restore();
                }
                else {
                    ctx.drawImage(cachedCanvas, -width / 2, -height / 2, width, height);
                }
                return true;
            }
        }
        // If exact frame not cached, try to find the closest available frame
        // This handles cases where pre-rendering is still in progress
        // Extract base key and find frames with matching base
        const baseKeyMatch = animatedCacheKey.match(/^(.+)_(\d+)$/);
        if (baseKeyMatch) {
            const baseKey = baseKeyMatch[1];
            const targetBucket = parseInt(baseKeyMatch[2], 10);
            // Find all cached frames for this SVG (same base key)
            const availableBuckets = [];
            for (const key of this.canvasCache.keys()) {
                const match = key.match(/^(.+)_(\d+)$/);
                if (match && match[1] === baseKey) {
                    availableBuckets.push(parseInt(match[2], 10));
                }
            }
            if (availableBuckets.length > 0) {
                // Find closest bucket (wrapping around animation cycle)
                availableBuckets.sort((a, b) => a - b);
                let closestBucket = availableBuckets[0];
                let minDistance = Math.abs(targetBucket - closestBucket);
                // Also check wrapping distance (e.g., if target is 29 and we have 0, distance is 1)
                for (const bucket of availableBuckets) {
                    const distance = Math.abs(targetBucket - bucket);
                    const wrapDistance = Math.min(distance, 30 - distance); // 30 frames total
                    if (wrapDistance < minDistance) {
                        minDistance = wrapDistance;
                        closestBucket = bucket;
                    }
                }
                // Use closest available frame (increase threshold to 10 frames to handle more cases)
                // This is better than showing fallback circles while pre-rendering continues
                if (minDistance <= 10) {
                    const closestKey = `${baseKey}_${closestBucket}`;
                    const closestCanvas = this.canvasCache.get(closestKey);
                    if (closestCanvas && closestCanvas.width > 0 && closestCanvas.height > 0) {
                        // Use closest cached canvas
                        if (x !== 0 || y !== 0 || rotation !== 0) {
                            ctx.save();
                            ctx.translate(x, y);
                            ctx.rotate(rotation);
                            ctx.drawImage(closestCanvas, -width / 2, -height / 2, width, height);
                            ctx.restore();
                        }
                        else {
                            ctx.drawImage(closestCanvas, -width / 2, -height / 2, width, height);
                        }
                        return true;
                    }
                }
            }
        }
        // If no cached canvas (exact or close), we should not create blob URLs during gameplay
        // Return false and let the caller use a fallback
        // The canvas should have been pre-rendered during initialization
        // If we're here, it means we need a frame that wasn't pre-rendered yet
        // Log cache miss occasionally to debug
        if (Math.random() < 0.01) {
            console.warn(`[SVGRenderer] Canvas not cached for key: ${animatedCacheKey.substring(0, 60)}... (should have been pre-rendered), cacheSize=${this.canvasCache.size}`);
            // Show a few sample keys from cache
            const sampleKeys = Array.from(this.canvasCache.keys()).slice(0, 3);
            console.log(`[SVGRenderer] Sample cache keys:`, sampleKeys.map(k => k.substring(0, 60)));
        }
        return false;
    }
    // Public method to cache a canvas directly (for preloading)
    cacheCanvas(key, canvas) {
        this.canvasCache.set(key, canvas);
    }
    // Public method to check if a canvas is cached
    isCanvasCached(key) {
        return this.canvasCache.has(key);
    }
    clearCache() {
        if (this.renderer) {
            this.renderer.clearCache();
        }
        this.imageCache.clear();
        this.dataUrlCache.clear(); // Clear data URL cache too
        this.canvasCache.clear();
        this.animatedCache = {};
    }
    isInitialized() {
        return this.initialized;
    }
    isUsingFallback() {
        return this.fallbackMode;
    }
    // Mark preloading as complete - prevents blob URL creation after this point
    markPreloadingComplete() {
        this.preloadingComplete = true;
    }
    // Check if preloading is complete
    isPreloadingComplete() {
        return this.preloadingComplete;
    }
    /**
     * Get animated SVG string for a given time
     * Used for preloading animation frames
     */
    getAnimatedSVGString(svgString, time) {
        if (this.fallbackMode || !this.renderer) {
            return this.applyAnimationsToSVG(svgString, time);
        }
        else {
            try {
                return this.renderer.renderSVG(svgString, time);
            }
            catch (error) {
                console.error('[SVGRenderer] Error getting animated SVG, using fallback:', error);
                return this.applyAnimationsToSVG(svgString, time);
            }
        }
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
