/**
 * TypeScript bindings for C++ SVG renderer
 * This module provides an interface to the WebAssembly-compiled C++ SVG renderer
 */

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
    private imageCache: Map<string, HTMLImageElement> = new Map();
    private canvasCache: Map<string, HTMLCanvasElement> = new Map(); // Cache for offscreen canvases
    private animatedCache: AnimatedSVGCache = {};

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

    private loadSVGAsImage(svgString: string, cacheKey: string): HTMLImageElement | null {
        // Check cache first
        if (this.imageCache.has(cacheKey)) {
            const cached = this.imageCache.get(cacheKey)!;
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
        } catch (error) {
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
    
    private renderSVGToOffscreenCanvas(svgString: string, width: number, height: number): HTMLCanvasElement | null {
        const cacheKey = `${svgString.substring(0, 50)}_${width}_${height}`;
        
        // Check canvas cache
        if (this.canvasCache.has(cacheKey)) {
            return this.canvasCache.get(cacheKey)!;
        }
        
        // Create offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) return null;
        
        // Render SVG to offscreen canvas
        const img = this.loadSVGAsImage(svgString, cacheKey);
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, width, height);
            this.canvasCache.set(cacheKey, canvas);
            return canvas;
        } else if (img) {
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

    public renderSVGToCanvas(
        ctx: CanvasRenderingContext2D,
        svgString: string,
        x: number,
        y: number,
        width: number,
        height: number,
        rotation: number = 0,
        time: number = Date.now()
    ): boolean {
        // Get animated SVG string
        let animatedSVG: string;
        
        if (this.fallbackMode || !this.renderer) {
            // Fallback: use browser's native SVG rendering
            if (Math.random() < 0.001) {
                console.log(`[SVGRenderer] Using fallback mode: fallbackMode=${this.fallbackMode}, renderer=${!!this.renderer}`);
            }
            animatedSVG = this.applyAnimationsToSVG(svgString, time);
        } else {
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
            } catch (error) {
                // Fallback to JavaScript animation
                console.error('[SVGRenderer] Error calling WASM renderSVG, falling back to JS:', error);
                this.fallbackMode = true;
                animatedSVG = this.applyAnimationsToSVG(svgString, time);
            }
        }
        
        // For animated SVGs, we need to use a time-based cache key to ensure
        // the animation updates each frame. However, we can't cache every frame,
        // so we'll use a time bucket (e.g., every 16ms for ~60fps)
        const timeBucket = Math.floor(time / 16); // Update every ~16ms
        const baseCacheKey = svgString.length > 100 ? svgString.substring(0, 100) : svgString;
        const animatedCacheKey = `${baseCacheKey}_${timeBucket}`;
        const img = this.loadSVGAsImage(animatedSVG, animatedCacheKey);
        
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
            } else {
                // Transforms already applied, just draw
                ctx.drawImage(img, -width / 2, -height / 2, width, height);
            }
            return true; // Successfully rendered
        }
        
        // Image is still loading - try to draw anyway if it's a data URL (might work)
        // For data URLs, the browser might render them even if not fully loaded
        if (img.src && img.src.startsWith('data:')) {
            try {
                if (x !== 0 || y !== 0 || rotation !== 0) {
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(rotation);
                    ctx.drawImage(img, -width / 2, -height / 2, width, height);
                    ctx.restore();
                } else {
                    ctx.drawImage(img, -width / 2, -height / 2, width, height);
                }
                return true; // Attempted to render, even if not fully loaded
            } catch (error) {
                // Drawing failed, fall back
                return false;
            }
        }
        
        // Image is still loading and not a data URL - return false so fallback can be used
        return false;
    }

    public clearCache(): void {
        if (this.renderer) {
            this.renderer.clearCache();
        }
        this.imageCache.clear();
        this.canvasCache.clear();
        this.animatedCache = {};
    }

    public isInitialized(): boolean {
        return this.initialized;
    }

    public isUsingFallback(): boolean {
        return this.fallbackMode;
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

