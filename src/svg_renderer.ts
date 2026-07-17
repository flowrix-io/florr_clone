/**
 * SVG Renderer — Canvas-command based rendering
 *
 * Instead of rasterizing SVGs to pixel caches (via data URLs + Image + ImageBitmap),
 * this module compiles SVGs into Canvas 2D drawing commands and executes them directly.
 *
 * For mobs: SVGs are compiled once, then drawn each frame using canvas commands
 *           with real-time animation interpolation. No per-frame pixel caches needed.
 *
 * For petals: SVGs are compiled, rendered to offscreen canvases, and cached.
 *             This eliminates the data URL + Image intermediary.
 */

import { SVGCanvasCompiler, CompiledSVG, drawCompiledSVG, renderCompiledSVGToCanvas } from './svg_canvas_renderer';

class SVGRendererWrapper {
    private compiler: SVGCanvasCompiler = new SVGCanvasCompiler();
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;
    private preloadingComplete: boolean = false;

    // Compiled SVG cache (keyed by SVG string)
    private compiledCache: Map<string, CompiledSVG> = new Map();

    constructor() {
        this.initPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        // No WASM needed anymore — we use canvas commands directly
        this.initialized = true;
        console.log('[SVGRenderer] Canvas-command renderer initialized');
    }

    public async waitForInit(): Promise<void> {
        if (this.initPromise) {
            await this.initPromise;
        }
    }

    /**
     * Compile an SVG string into canvas drawing commands (cached).
     */
    public compileSVG(svgString: string): CompiledSVG {
        let compiled = this.compiledCache.get(svgString);
        if (!compiled) {
            compiled = this.compiler.compile(svgString);
            this.compiledCache.set(svgString, compiled);
        }
        return compiled;
    }

    /**
     * Render an SVG to a canvas context using compiled canvas commands.
     * Animations are evaluated in real-time based on the time parameter.
     */
    public renderSVGToCanvas(
        ctx: CanvasRenderingContext2D,
        svgString: string,
        x: number,
        y: number,
        width: number,
        height: number,
        rotation: number = 0,
        time: number = Date.now(),
        disableAntiAliasing: boolean = false,
        tint: { color: string; amount: number } | null = null
    ): boolean {
        if (!svgString) return false;

        try {
            const compiled = this.compileSVG(svgString);

            // imageSmoothingEnabled only affects drawImage, so touching it for a
            // path-only SVG is a pure cost — and not a free one: a smoothing
            // write per mob breaks Chrome's canvas op batching (a pipeline flush
            // each), which is why the mob pass sets it once globally instead.
            // EVERY mob comes through here now, so almost all of them are
            // path-only and must not pay it; only the <image> SVGs that want the
            // pixelated look do.
            const toggleSmoothing = disableAntiAliasing && compiled.hasImage;
            const originalSmoothing = ctx.imageSmoothingEnabled;
            if (toggleSmoothing) {
                ctx.imageSmoothingEnabled = false;
            }

            drawCompiledSVG(ctx, compiled, x, y, width, height, rotation, time, tint);

            if (toggleSmoothing) {
                ctx.imageSmoothingEnabled = originalSmoothing;
            }

            return true;
        } catch (error) {
            console.error('[SVGRenderer] Error rendering SVG:', error);
            return false;
        }
    }

    /**
     * Render an SVG to an offscreen canvas using canvas commands.
     * Used for petal preloading where cached canvases are still needed.
     */
    public async renderSVGToOffscreenCanvas(
        svgString: string,
        width: number,
        height: number,
        time: number = 0
    ): Promise<HTMLCanvasElement | null> {
        if (!svgString) return null;

        try {
            const compiled = this.compileSVG(svgString);
            return renderCompiledSVGToCanvas(compiled, width, height, time);
        } catch (error) {
            console.error('[SVGRenderer] Error rendering SVG to offscreen canvas:', error);
            return null;
        }
    }

    /**
     * Get animated SVG string for a given time.
     * Still used for petal preloading where we need animated frames.
     */
    public getAnimatedSVGString(svgString: string, time: number): string {
        // For canvas-command rendering, we don't need animated SVG strings for mobs.
        // But petals still use this path through renderSVGToOffscreenCanvas.
        // Just return the original — animation is handled at draw time.
        return svgString;
    }

    // --- Cache management ---

    public cacheCanvas(_key: string, _canvas: HTMLCanvasElement): void {
        // No-op: canvas frame caching is no longer used for mobs
    }

    public isCanvasCached(_key: string): boolean {
        return false;
    }

    public setCycleLength(_baseCacheKey: string, _framesPerCycle: number): void {
        // No-op: frame-based cycles are no longer used
    }

    public getCycleLength(_baseCacheKey: string): number {
        return 30;
    }

    public getFramesPerCycleForSVG(_svgString: string): number {
        return 30;
    }

    public clearCache(): void {
        this.compiledCache.clear();
        this.compiler.clearCache();
    }

    public clearCacheEntriesWithPrefix(_prefix: string): number {
        return 0;
    }

    public getCanvasCacheSize(): number {
        return this.compiledCache.size;
    }

    public deleteCacheEntry(_key: string): boolean {
        return false;
    }

    public isInitialized(): boolean {
        return this.initialized;
    }

    public isUsingFallback(): boolean {
        return false;
    }

    public markPreloadingComplete(): void {
        this.preloadingComplete = true;
    }

    public isPreloadingComplete(): boolean {
        return this.preloadingComplete;
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
