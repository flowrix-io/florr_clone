"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SVGRendererWrapper = void 0;
exports.getSVGRenderer = getSVGRenderer;
const svg_canvas_renderer_1 = require("./svg_canvas_renderer");
class SVGRendererWrapper {
    constructor() {
        this.compiler = new svg_canvas_renderer_1.SVGCanvasCompiler();
        this.initialized = false;
        this.initPromise = null;
        this.preloadingComplete = false;
        // Compiled SVG cache (keyed by SVG string)
        this.compiledCache = new Map();
        this.initPromise = this.initialize();
    }
    async initialize() {
        // No WASM needed anymore — we use canvas commands directly
        this.initialized = true;
        console.log('[SVGRenderer] Canvas-command renderer initialized');
    }
    async waitForInit() {
        if (this.initPromise) {
            await this.initPromise;
        }
    }
    /**
     * Compile an SVG string into canvas drawing commands (cached).
     */
    compileSVG(svgString) {
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
    renderSVGToCanvas(ctx, svgString, x, y, width, height, rotation = 0, time = Date.now(), disableAntiAliasing = false, tint = null) {
        if (!svgString)
            return false;
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
            (0, svg_canvas_renderer_1.drawCompiledSVG)(ctx, compiled, x, y, width, height, rotation, time, tint);
            if (toggleSmoothing) {
                ctx.imageSmoothingEnabled = originalSmoothing;
            }
            return true;
        }
        catch (error) {
            console.error('[SVGRenderer] Error rendering SVG:', error);
            return false;
        }
    }
    /**
     * Render an SVG to an offscreen canvas using canvas commands.
     * Used for petal preloading where cached canvases are still needed.
     */
    async renderSVGToOffscreenCanvas(svgString, width, height, time = 0) {
        if (!svgString)
            return null;
        try {
            const compiled = this.compileSVG(svgString);
            return (0, svg_canvas_renderer_1.renderCompiledSVGToCanvas)(compiled, width, height, time);
        }
        catch (error) {
            console.error('[SVGRenderer] Error rendering SVG to offscreen canvas:', error);
            return null;
        }
    }
    /**
     * Get animated SVG string for a given time.
     * Still used for petal preloading where we need animated frames.
     */
    getAnimatedSVGString(svgString, time) {
        // For canvas-command rendering, we don't need animated SVG strings for mobs.
        // But petals still use this path through renderSVGToOffscreenCanvas.
        // Just return the original — animation is handled at draw time.
        return svgString;
    }
    // --- Cache management ---
    cacheCanvas(_key, _canvas) {
        // No-op: canvas frame caching is no longer used for mobs
    }
    isCanvasCached(_key) {
        return false;
    }
    setCycleLength(_baseCacheKey, _framesPerCycle) {
        // No-op: frame-based cycles are no longer used
    }
    getCycleLength(_baseCacheKey) {
        return 30;
    }
    getFramesPerCycleForSVG(_svgString) {
        return 30;
    }
    clearCache() {
        this.compiledCache.clear();
        this.compiler.clearCache();
    }
    clearCacheEntriesWithPrefix(_prefix) {
        return 0;
    }
    getCanvasCacheSize() {
        return this.compiledCache.size;
    }
    deleteCacheEntry(_key) {
        return false;
    }
    isInitialized() {
        return this.initialized;
    }
    isUsingFallback() {
        return false;
    }
    markPreloadingComplete() {
        this.preloadingComplete = true;
    }
    isPreloadingComplete() {
        return this.preloadingComplete;
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
