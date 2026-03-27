import { Graphics, getAllMobTypes, getMobStats, getMobTypesBySection, getMobAnimationFrameTime, getHighQualityMobs } from './core';

declare module './core' {
    interface Graphics {
        preloadMobImages(): Promise<void>;
        parseSVGAnimationDurations(svg: string): number[];
        calculateFramesPerCycle(svg: string, frameTime: number): number;
        preloadMobFrames(mobStats: any, cacheKey: string, preloadPromises: Promise<void>[], baseCacheKey?: string): void;
        getOffscreenCanvasMemoryMB(): number;
        loadSectionMobs(section: number): void;
        unloadSectionMobs(section: number): void;
        loadMobFrames(mobStats: any, cacheKey: string): void;
    }
}

Graphics.prototype.preloadMobImages = async function(this: Graphics) {
    // Initialize SVG renderer
    await this.svgRenderer.waitForInit();

    const allMobTypes = getAllMobTypes();
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
    const highQualityMobs = getHighQualityMobs();

    // Pre-render mob canvases for immediate use (no fallback circles)
    const preloadPromises: Promise<void>[] = [];

    // ALWAYS load ALL SVG strings upfront (low memory cost, ensures rendering works)
    // This is required for mobs to render even before their frames are cached
    for (const mobType of allMobTypes) {
        for (const rarity of rarities) {
            const mobStats = getMobStats(mobType, rarity);
            if (mobStats && mobStats.image) {
                const cacheKey = `${mobType}_${rarity}`;
                this.mobSVGCache[cacheKey] = mobStats.image;
            }
        }
    }

    // Pre-render ALL mob frames at startup to avoid rendering issues
    const mobTypesToPrerender = new Set<string>(allMobTypes);

    // Mark all sections as loaded since we're preloading everything
    for (let section = 0; section < 9; section++) {
        this.loadedSections.add(section);
    }
    this.currentSection = 0;

    if (highQualityMobs) {
        // High quality mode: Pre-render frames for each rarity separately (old approach)
        // This uses more memory but ensures each rarity has its own frames
        for (const mobType of mobTypesToPrerender) {
            for (const rarity of rarities) {
                const mobStats = getMobStats(mobType, rarity);
                if (mobStats && mobStats.image) {
                    const cacheKey = `${mobType}_${rarity}`;
                    this.preloadMobFrames(mobStats, cacheKey, preloadPromises);
                }
            }
        }
    } else {
        // Optimized mode: Pre-render animation frames only once per unique SVG
        // Track which SVG baseCacheKeys we've already pre-rendered frames for
        // This allows different rarities of the same mob type to share animation frames
        const preloadedBaseCacheKeys = new Set<string>();

        for (const mobType of mobTypesToPrerender) {
            for (const rarity of rarities) {
                const mobStats = getMobStats(mobType, rarity);
                if (mobStats && mobStats.image) {
                    const cacheKey = `${mobType}_${rarity}`;

                    // Normalize SVG string for consistent cache key generation (same as in renderSVGToCanvas)
                    let normalizedSVG = mobStats.image.replace(/\s+/g, ' ').trim();
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

                    // Store base cache key for later unloading
                    this.mobBaseCacheKeys.set(cacheKey, baseCacheKey);

                    // Skip if we've already pre-rendered frames for this SVG (shared across rarities)
                    if (preloadedBaseCacheKeys.has(baseCacheKey)) {
                        continue;
                    }

                    // Mark this baseCacheKey as pre-rendered
                    preloadedBaseCacheKeys.add(baseCacheKey);

                    // Pre-render frames for this unique SVG
                    this.preloadMobFrames(mobStats, cacheKey, preloadPromises, baseCacheKey);
                }
            }
        }
    }

    // Wait for all pre-renders to complete (but don't block - they'll cache in background)
    if (preloadPromises.length === 0) {
        this.svgRenderer.markPreloadingComplete();
    } else {
        Promise.all(preloadPromises).then(() => {
            this.svgRenderer.markPreloadingComplete();
        }).catch((error) => {
            console.warn('[Graphics] Some mob canvases failed to pre-render:', error);
            this.svgRenderer.markPreloadingComplete();
        });
    }
};

/**
 * Parse all animation durations from an SVG string.
 * Returns durations in milliseconds.
 */
Graphics.prototype.parseSVGAnimationDurations = function(this: Graphics, svg: string): number[] {
    const durations: number[] = [];
    const durRegex = /dur="([^"]*)"/g;
    let match;
    while ((match = durRegex.exec(svg)) !== null) {
        const durStr = match[1];
        let ms: number;
        if (durStr.endsWith('ms')) {
            ms = parseFloat(durStr);
        } else if (durStr.endsWith('s')) {
            ms = parseFloat(durStr) * 1000;
        } else {
            ms = parseFloat(durStr) * 1000; // assume seconds
        }
        if (ms > 0 && !isNaN(ms)) {
            durations.push(Math.round(ms));
        }
    }
    return durations;
};

/**
 * Calculate the optimal framesPerCycle for a mob SVG based on its animation durations.
 * Uses LCM of all durations to ensure all animations loop seamlessly.
 * Caps at MAX_FRAMES_PER_CYCLE to limit memory usage.
 */
Graphics.prototype.calculateFramesPerCycle = function(this: Graphics, svg: string, frameTime: number): number {
    const MAX_FRAMES_PER_CYCLE = 60;
    const MIN_FRAMES_PER_CYCLE = 6;
    const DEFAULT_FRAMES = 30;

    const durations = this.parseSVGAnimationDurations(svg);
    if (durations.length === 0) {
        return DEFAULT_FRAMES;
    }

    // Deduplicate durations
    const uniqueDurations = [...new Set(durations)];

    // Compute LCM of all durations
    let cycleDuration = uniqueDurations[0];
    for (let i = 1; i < uniqueDurations.length; i++) {
        cycleDuration = Graphics.lcm(cycleDuration, uniqueDurations[i]);
        // Safety: if LCM grows too large, stop and cap
        if (cycleDuration > MAX_FRAMES_PER_CYCLE * frameTime) {
            break;
        }
    }

    let framesPerCycle = Math.ceil(cycleDuration / frameTime);

    if (framesPerCycle > MAX_FRAMES_PER_CYCLE) {
        // LCM is too large. Find the largest cycle ≤ MAX that is a multiple
        // of the shortest animation duration (most visually critical).
        const shortestDuration = Math.min(...uniqueDurations);
        const maxCycleDuration = MAX_FRAMES_PER_CYCLE * frameTime;
        // How many full repetitions of the shortest duration fit in the max?
        const reps = Math.floor(maxCycleDuration / shortestDuration);
        if (reps >= 1) {
            cycleDuration = reps * shortestDuration;
            framesPerCycle = Math.ceil(cycleDuration / frameTime);
        } else {
            // Shortest duration itself exceeds max - use max frames
            framesPerCycle = MAX_FRAMES_PER_CYCLE;
        }
    }

    framesPerCycle = Math.max(MIN_FRAMES_PER_CYCLE, Math.min(MAX_FRAMES_PER_CYCLE, framesPerCycle));
    return framesPerCycle;
};

/**
 * Pre-render animation frames for a mob
 * @param mobStats The mob stats containing the SVG image
 * @param cacheKey The cache key for this mob (e.g., "bee_common")
 * @param preloadPromises Array to push the preload promise to
 * @param baseCacheKey Optional base cache key for optimized mode
 */
Graphics.prototype.preloadMobFrames = function(
    this: Graphics,
    mobStats: any,
    cacheKey: string,
    preloadPromises: Promise<void>[],
    baseCacheKey?: string
): void {
    // If baseCacheKey is not provided, generate it from the SVG
    if (!baseCacheKey) {
        let normalizedSVG = mobStats.image.replace(/\s+/g, ' ').trim();
        normalizedSVG = normalizedSVG.replace(/\s+xmlns="[^"]*"/g, '');
        const viewBoxMatch = normalizedSVG.match(/viewBox="([^"]*)"/);
        const widthMatch = normalizedSVG.match(/width="([^"]*)"/);
        const keyParts = [
            viewBoxMatch ? viewBoxMatch[1] : '',
            widthMatch ? widthMatch[1] : '',
            normalizedSVG.length.toString()
        ];
        baseCacheKey = keyParts.join('|');
    }

    // Calculate per-mob cycle based on SVG animation durations (LCM)
    const frameTime = getMobAnimationFrameTime();
    const framesPerCycle = this.calculateFramesPerCycle(mobStats.image, frameTime);

    // Store cycle length in the renderer for use during rendering
    this.svgRenderer.setCycleLength(baseCacheKey!, framesPerCycle);

    const promise = (async () => {
        try {
            const highQualityMobs = getHighQualityMobs();
            const mobSize = highQualityMobs ? mobStats.size * 40 : 256;

            for (let frame = 0; frame < framesPerCycle; frame++) {
                if (this.svgRenderer.isPreloadingComplete()) {
                    break;
                }

                const time = frame * frameTime;
                const animationCycleDuration = framesPerCycle * frameTime;
                const relativeTime = time % animationCycleDuration;
                const timeBucket = Math.floor(relativeTime / frameTime);
                const animatedCacheKey = `${baseCacheKey}_${timeBucket}`;

                // Skip if already cached
                if (this.svgRenderer.isCanvasCached(animatedCacheKey)) {
                    continue;
                }

                // Pre-render this animation frame
                const animatedSVG = this.svgRenderer.getAnimatedSVGString(mobStats.image, time);
                const canvas = await this.svgRenderer.renderSVGToOffscreenCanvas(animatedSVG, mobSize, mobSize);
                if (canvas) {
                    this.svgRenderer.cacheCanvas(animatedCacheKey, canvas);
                }
            }
        } catch (error) {
            console.error(`[Graphics] Failed to pre-render canvas for ${cacheKey} (baseCacheKey=${baseCacheKey}):`, error);
        }
    })();
    preloadPromises.push(promise);
};

/**
 * Get the total memory used by offscreen canvases in MB
 */
Graphics.prototype.getOffscreenCanvasMemoryMB = function(this: Graphics): number {
    try {
        const canvasCache = (this.svgRenderer as any).canvasCache as Map<string, HTMLCanvasElement> | undefined;
        if (!canvasCache) {
            return 0;
        }

        let totalBytes = 0;

        for (const canvas of canvasCache.values()) {
            if (canvas && canvas.width && canvas.height) {
                // Each pixel is 4 bytes (RGBA)
                totalBytes += canvas.width * canvas.height * 4;
            }
        }

        // Convert bytes to MB
        return totalBytes / (1024 * 1024);
    } catch (error) {
        console.warn('[Graphics] Error calculating canvas memory:', error);
        return 0;
    }
};

Graphics.prototype.loadSectionMobs = function(this: Graphics, section: number): void {
    const mobTypes = getMobTypesBySection(section);
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];

    this.loadedSections.add(section);

    // SVG strings are already all cached at startup
    // Only need to pre-render animation frames for this section
    for (const mobType of mobTypes) {
        for (const rarity of rarities) {
            const cacheKey = `${mobType}_${rarity}`;
            const mobStats = getMobStats(mobType, rarity);
            if (mobStats && mobStats.image) {
                this.loadMobFrames(mobStats, cacheKey);
            }
        }
    }
};

/**
 * Unload mob animation frame canvases for a specific section
 * Note: SVG strings are kept in memory (low cost) to ensure mobs can always render
 */
Graphics.prototype.unloadSectionMobs = function(this: Graphics, section: number): void {
    const mobTypes = getMobTypesBySection(section);
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];

    this.loadedSections.delete(section);

    let clearedCount = 0;
    for (const mobType of mobTypes) {
        // Never unload target_dummy (used across all sections)
        if (mobType === 'target_dummy') {
            continue;
        }

        for (const rarity of rarities) {
            const cacheKey = `${mobType}_${rarity}`;

            // Get and remove base cache key (clears canvas frames, not SVG strings)
            const baseCacheKey = this.mobBaseCacheKeys.get(cacheKey);
            if (baseCacheKey) {
                // Clear all canvas cache entries with this base key
                clearedCount += this.svgRenderer.clearCacheEntriesWithPrefix(baseCacheKey);
                this.mobBaseCacheKeys.delete(cacheKey);
            }
        }
    }

};

/**
 * Load mob animation frames for a specific mob
 * Similar to preloadMobFrames but without adding to promise array
 */
Graphics.prototype.loadMobFrames = function(this: Graphics, mobStats: any, cacheKey: string): void {
    // Skip if already loading
    if (this.loadingMobs.has(cacheKey)) {
        return;
    }
    this.loadingMobs.add(cacheKey);

    // Generate base cache key from SVG
    let normalizedSVG = mobStats.image.replace(/\s+/g, ' ').trim();
    normalizedSVG = normalizedSVG.replace(/\s+xmlns="[^"]*"/g, '');
    const viewBoxMatch = normalizedSVG.match(/viewBox="([^"]*)"/);
    const widthMatch = normalizedSVG.match(/width="([^"]*)"/);
    const keyParts = [
        viewBoxMatch ? viewBoxMatch[1] : '',
        widthMatch ? widthMatch[1] : '',
        normalizedSVG.length.toString()
    ];
    const baseCacheKey = keyParts.join('|');

    // Store the base cache key for later unloading
    this.mobBaseCacheKeys.set(cacheKey, baseCacheKey);

    // Calculate per-mob cycle and store it
    const frameTime = getMobAnimationFrameTime();
    const framesPerCycle = this.calculateFramesPerCycle(mobStats.image, frameTime);
    this.svgRenderer.setCycleLength(baseCacheKey, framesPerCycle);

    // Pre-render frames asynchronously
    (async () => {
        try {
            const highQualityMobs = getHighQualityMobs();
            const mobSize = highQualityMobs ? mobStats.size * 40 : 256;

            for (let frame = 0; frame < framesPerCycle; frame++) {
                const time = frame * frameTime;
                const animationCycleDuration = framesPerCycle * frameTime;
                const relativeTime = time % animationCycleDuration;
                const timeBucket = Math.floor(relativeTime / frameTime);
                const animatedCacheKey = `${baseCacheKey}_${timeBucket}`;

                // Skip if already cached
                if (this.svgRenderer.isCanvasCached(animatedCacheKey)) {
                    continue;
                }

                // Pre-render this animation frame
                const animatedSVG = this.svgRenderer.getAnimatedSVGString(mobStats.image, time);
                const canvas = await this.svgRenderer.renderSVGToOffscreenCanvas(animatedSVG, mobSize, mobSize);
                if (canvas) {
                    this.svgRenderer.cacheCanvas(animatedCacheKey, canvas);
                }
            }
        } catch (error) {
            console.error(`[Graphics] Failed to load frames for ${cacheKey}:`, error);
        } finally {
            this.loadingMobs.delete(cacheKey);
        }
    })();
};
