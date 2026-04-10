/**
 * TypeScript bindings for C++ SVG renderer
 * This module provides an interface to the WebAssembly-compiled C++ SVG renderer
 */

import { getMobAnimationFrameTime } from './constants';

interface SVGRendererModule {
    SVGRenderer: new () => SVGRendererInstance;
    onRuntimeInitialized?: () => void;
}

interface SVGRendererInstance {
    renderSVG(svgString: string, time: number): string; // Returns animated SVG string
    clearCache(): void;
    getCacheSize(): number;
}

// Cache for animated SVG strings
interface AnimatedSVGCache {
    [key: string]: {
        original: string;
        lastUpdate: number;
        animated: string;
    };
}

class SVGRendererWrapper {
    private module: SVGRendererModule | null = null;
    private renderer: SVGRendererInstance | null = null;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;
    private fallbackMode: boolean = false;
    private imageCache: Map<string, HTMLImageElement | ImageBitmap> = new Map();
    private dataUrlCache: Map<string, string> = new Map(); // Cache data URL strings to avoid recreating them
    private canvasCache: Map<string, HTMLCanvasElement> = new Map(); // Cache for offscreen canvases (primary storage)
    private animatedCache: AnimatedSVGCache = {};
    private preloadingComplete: boolean = false; // Track if preloading phase is complete
    private baseCacheKeyMap: Map<string, string> = new Map(); // Cache normalized base keys per SVG string
    private cycleLengthMap: Map<string, number> = new Map(); // Per-SVG framesPerCycle for smooth looping

    constructor() {
        this.initPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        if (this.initialized) {
            return Promise.resolve();
        }

        try {
            // Try to load the WebAssembly module
            console.log('[SVGRenderer] Attempting to load WASM module...');
            // @ts-ignore - WebAssembly module type
            // Use dynamic import with a string literal to avoid webpack processing
            // Path is relative to the served root (dist directory)
            const moduleFactory = await import(/* webpackIgnore: true */ './svg_renderer_wasm.js');
            console.log('[SVGRenderer] Module factory loaded, initializing...');
            
            // Configure locateFile to find the WASM file in the dist directory
            const mod: SVGRendererModule = await moduleFactory.default({
                locateFile: (path: string, prefix: string) => {
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
        } catch (error) {
            console.error('[SVGRenderer] Failed to load C++ renderer, using fallback mode:', error);
            console.error('[SVGRenderer] Error details:', error instanceof Error ? error.stack : error);
            this.fallbackMode = true;
            this.initialized = true; // Mark as initialized so we can use fallback
        }
    }

    public async waitForInit(): Promise<void> {
        if (this.initPromise) {
            await this.initPromise;
        }
    }

    private applyAnimationsToSVG(svgString: string, time: number): string {
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
            } else if (dur.includes('ms')) {
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

    private async loadSVGAsImageBitmap(svgString: string, cacheKey: string): Promise<ImageBitmap | null> {
        // Check cache first - reuse existing image bitmap if available
        if (this.imageCache.has(cacheKey)) {
            const cached = this.imageCache.get(cacheKey)!;
            // If it's an ImageBitmap, return it
            if (cached && typeof (cached as any).close === 'function') {
                return cached as ImageBitmap;
            }
        }

        // createImageBitmap doesn't support raw SVG directly
        // We need to use an Image element with a data URL
        if (typeof createImageBitmap === 'undefined') {
            console.warn('[SVGRenderer] createImageBitmap not available, falling back');
            return null;
        }
        
        try {
            // Create data URL from SVG
            const base64 = btoa(unescape(encodeURIComponent(svgString)));
            const dataUrl = `data:image/svg+xml;base64,${base64}`;
            
            // Create Image element and load from data URL
            const img = new Image();
            const imageBitmap = await new Promise<ImageBitmap>((resolve, reject) => {
                img.onload = async () => {
                    try {
                        // Use createImageBitmap on the loaded image
                        const bitmap = await createImageBitmap(img);
                        resolve(bitmap);
                    } catch (error) {
                        reject(error);
                    }
                };
                img.onerror = () => {
                    reject(new Error('Failed to load SVG image'));
                };
                img.src = dataUrl;
            });
            
            // Cache the ImageBitmap
            this.imageCache.set(cacheKey, imageBitmap);
            
            return imageBitmap;
        } catch (error) {
            console.error('[SVGRenderer] Error creating image bitmap:', error);
            return null;
        }
    }
    
    // Legacy method - kept for fallback but should not be used (creates data URLs)
    private loadSVGAsImage(svgString: string, cacheKey: string): HTMLImageElement | null {
        // This method creates data URLs and should be avoided
        // Use loadSVGAsImageBitmap instead
        console.warn('[SVGRenderer] loadSVGAsImage called - this creates data URLs and should be avoided');
        return null;
    }
    
    public async renderSVGToOffscreenCanvas(svgString: string, width: number, height: number): Promise<HTMLCanvasElement | null> {
        // Prevent data URL creation during gameplay - only allow during preloading
        if (this.preloadingComplete) {
            if (Math.random() < 0.01) { // Only log occasionally to avoid spam
                console.warn('[SVGRenderer] renderSVGToOffscreenCanvas called after preloading complete (preloadingComplete=' + this.preloadingComplete + ') - data URLs should not be created during gameplay');
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
            
            // createImageBitmap doesn't support raw SVG directly
            // We need to use an Image element with a data URL
            // createImageBitmap is available in modern browsers
            if (typeof createImageBitmap === 'undefined') {
                console.warn('[SVGRenderer] createImageBitmap not available');
                return null;
            }
            
            // Set SVG width/height to target size so the browser rasterizes at
            // full resolution (Firefox rasterizes at the SVG's intrinsic size,
            // which is often only 32x32, causing blurriness when upscaled).
            let resizedSVG = svgString.replace(
                /(<svg\b[^>]*?)(\s+width="[^"]*")/i, `$1 width="${width}"`
            ).replace(
                /(<svg\b[^>]*?)(\s+height="[^"]*")/i, `$1 height="${height}"`
            );

            // Create data URL from SVG
            // NOTE: This should only happen during preloading phase
            const base64 = btoa(unescape(encodeURIComponent(resizedSVG)));
            const dataUrl = `data:image/svg+xml;base64,${base64}`;
            
            // Create Image element and load from data URL
            const img = new Image();
            const imageBitmap = await new Promise<ImageBitmap>((resolve, reject) => {
                img.onload = async () => {
                    try {
                        // Use createImageBitmap on the loaded image with resize options
                        const bitmap = await createImageBitmap(img, { resizeWidth: width, resizeHeight: height });
                        resolve(bitmap);
                    } catch (error) {
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
        } catch (error) {
            console.error('[SVGRenderer] Error rendering SVG to canvas:', error);
            return null;
        }
    }
    

    public renderSVGToCanvas(
        ctx: CanvasRenderingContext2D,
        svgString: string,
        x: number,
        y: number,
        width: number,
        height: number,
        rotation: number = 0,
        time: number = Date.now(),
        disableAntiAliasing: boolean = false
    ): boolean {
        // Get animated SVG string
        let animatedSVG: string;
        
        if (this.fallbackMode || !this.renderer) {
            // Fallback: use browser's native SVG rendering
            animatedSVG = this.applyAnimationsToSVG(svgString, time);
        } else {
            // Use C++ renderer to get animated SVG string
            try {
                animatedSVG = this.renderer.renderSVG(svgString, time);
            } catch (error) {
                // Fallback to JavaScript animation
                console.error('[SVGRenderer] Error calling WASM renderSVG, falling back to JS:', error);
                this.fallbackMode = true;
                animatedSVG = this.applyAnimationsToSVG(svgString, time);
            }
        }
        
        // Use cached base key to avoid expensive regex normalization per enemy per frame
        let baseCacheKey = this.baseCacheKeyMap.get(svgString);
        if (!baseCacheKey) {
            // Normalize SVG string for consistent cache key generation (only once per unique SVG)
            let normalizedSVG = svgString.replace(/\s+/g, ' ').trim();
            normalizedSVG = normalizedSVG.replace(/\s+xmlns="[^"]*"/g, '');
            const viewBoxMatch = normalizedSVG.match(/viewBox="([^"]*)"/);
            const widthMatch = normalizedSVG.match(/width="([^"]*)"/);
            baseCacheKey = [
                viewBoxMatch ? viewBoxMatch[1] : '',
                widthMatch ? widthMatch[1] : '',
                normalizedSVG.length.toString()
            ].join('|');
            this.baseCacheKeyMap.set(svgString, baseCacheKey);
        }

        // For animated SVGs, we need to use a time-based cache key to ensure
        // the animation updates each frame. Use per-SVG cycle length for smooth looping.
        const frameTime = this.getFrameTime();
        const framesPerCycle = this.getCycleLength(baseCacheKey);
        const animationCycleDuration = framesPerCycle * frameTime;
        const relativeTime = time % animationCycleDuration;
        const timeBucket = Math.floor(relativeTime / frameTime);
        const animatedCacheKey = `${baseCacheKey}_${timeBucket}`;
        
        // Check if we already have this frame as a canvas (preferred - no data URLs)
        if (this.canvasCache.has(animatedCacheKey)) {
            const cachedCanvas = this.canvasCache.get(animatedCacheKey)!;
            if (cachedCanvas.width > 0 && cachedCanvas.height > 0) {
                // Disable anti-aliasing if requested
                const originalSmoothing = ctx.imageSmoothingEnabled;
                if (disableAntiAliasing) {
                    ctx.imageSmoothingEnabled = false;
                }
                
                // Use cached canvas immediately
                if (x !== 0 || y !== 0 || rotation !== 0) {
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(rotation);
                    ctx.drawImage(cachedCanvas, -width / 2, -height / 2, width, height);
                    ctx.restore();
                } else {
                    ctx.drawImage(cachedCanvas, -width / 2, -height / 2, width, height);
                }
                
                // Restore original smoothing setting
                if (disableAntiAliasing) {
                    ctx.imageSmoothingEnabled = originalSmoothing;
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
            const availableBuckets: number[] = [];
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
                    const wrapDistance = Math.min(distance, framesPerCycle - distance);
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
                        // Disable anti-aliasing if requested
                        const originalSmoothing = ctx.imageSmoothingEnabled;
                        if (disableAntiAliasing) {
                            ctx.imageSmoothingEnabled = false;
                        }
                        
                        // Use closest cached canvas
                        if (x !== 0 || y !== 0 || rotation !== 0) {
                            ctx.save();
                            ctx.translate(x, y);
                            ctx.rotate(rotation);
                            ctx.drawImage(closestCanvas, -width / 2, -height / 2, width, height);
                            ctx.restore();
                        } else {
                            ctx.drawImage(closestCanvas, -width / 2, -height / 2, width, height);
                        }
                        
                        // Restore original smoothing setting
                        if (disableAntiAliasing) {
                            ctx.imageSmoothingEnabled = originalSmoothing;
                        }
                        
                        return true;
                    }
                }
            }
        }
        
        // If no cached canvas (exact or close), we should not create data URLs during gameplay
        // Return false and let the caller use a fallback
        // The canvas should have been pre-rendered during initialization
        // If we're here, it means we need a frame that wasn't pre-rendered yet
        
        return false;
    }
    
    // Public method to cache a canvas directly (for preloading)
    public cacheCanvas(key: string, canvas: HTMLCanvasElement): void {
        this.canvasCache.set(key, canvas);
    }

    // Public method to check if a canvas is cached
    public isCanvasCached(key: string): boolean {
        return this.canvasCache.has(key);
    }

    // Set the cycle length (framesPerCycle) for a specific baseCacheKey
    public setCycleLength(baseCacheKey: string, framesPerCycle: number): void {
        this.cycleLengthMap.set(baseCacheKey, framesPerCycle);
    }

    // Get the cycle length for a baseCacheKey (defaults to 30 for backwards compatibility)
    public getCycleLength(baseCacheKey: string): number {
        return this.cycleLengthMap.get(baseCacheKey) || 30;
    }

    // Get framesPerCycle for a given SVG string (looks up baseCacheKey first)
    public getFramesPerCycleForSVG(svgString: string): number {
        const baseCacheKey = this.baseCacheKeyMap.get(svgString);
        if (baseCacheKey) {
            return this.getCycleLength(baseCacheKey);
        }
        return 30;
    }

    public clearCache(): void {
        if (this.renderer) {
            this.renderer.clearCache();
        }
        this.imageCache.clear();
        this.dataUrlCache.clear(); // Clear data URL cache too
        this.canvasCache.clear();
        this.animatedCache = {};
    }

    /**
     * Clear canvas cache entries that match a specific base cache key prefix
     * Used for section-based texture unloading
     */
    public clearCacheEntriesWithPrefix(prefix: string): number {
        let cleared = 0;
        const keysToDelete: string[] = [];

        for (const key of this.canvasCache.keys()) {
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.canvasCache.delete(key);
            cleared++;
        }

        return cleared;
    }

    /**
     * Get the number of entries in the canvas cache
     * Used for monitoring memory usage
     */
    public getCanvasCacheSize(): number {
        return this.canvasCache.size;
    }

    /**
     * Delete a specific canvas cache entry
     */
    public deleteCacheEntry(key: string): boolean {
        return this.canvasCache.delete(key);
    }

    public isInitialized(): boolean {
        return this.initialized;
    }

    public isUsingFallback(): boolean {
        return this.fallbackMode;
    }
    
    // Mark preloading as complete - prevents data URL creation after this point
    public markPreloadingComplete(): void {
        this.preloadingComplete = true;
    }
    
    // Check if preloading is complete
    public isPreloadingComplete(): boolean {
        return this.preloadingComplete;
    }

    /**
     * Get the frame time in milliseconds based on configured framerate
     */
    private getFrameTime(): number {
        return getMobAnimationFrameTime();
    }

    /**
     * Get animated SVG string for a given time
     * Used for preloading animation frames
     */
    public getAnimatedSVGString(svgString: string, time: number): string {
        if (this.fallbackMode || !this.renderer) {
            return this.applyAnimationsToSVG(svgString, time);
        } else {
            try {
                return this.renderer.renderSVG(svgString, time);
            } catch (error) {
                console.error('[SVGRenderer] Error getting animated SVG, using fallback:', error);
                return this.applyAnimationsToSVG(svgString, time);
            }
        }
    }
}

// Singleton instance
let svgRendererInstance: SVGRendererWrapper | null = null;

export function getSVGRenderer(): SVGRendererWrapper {
    if (!svgRendererInstance) {
        svgRendererInstance = new SVGRendererWrapper();
    }
    return svgRendererInstance;
}

export { SVGRendererWrapper };

