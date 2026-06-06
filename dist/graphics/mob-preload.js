"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
/**
 * Pre-compile mob SVGs into canvas drawing commands.
 *
 * With the canvas-command renderer, we no longer pre-render pixel frames.
 * Instead, we compile each unique SVG once into a command tree that gets
 * drawn directly at render time with real-time animation interpolation.
 */
core_1.Graphics.prototype.preloadMobImages = async function () {
    await this.svgRenderer.waitForInit();
    const allMobTypes = (0, core_1.getAllMobTypes)();
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
    // Cache all SVG strings and pre-compile them into canvas commands
    for (const mobType of allMobTypes) {
        for (const rarity of rarities) {
            const mobStats = (0, core_1.getMobStats)(mobType, rarity);
            if (mobStats && mobStats.image) {
                const cacheKey = `${mobType}_${rarity}`;
                this.mobSVGCache[cacheKey] = mobStats.image;
                // Pre-compile SVG into canvas drawing commands (cached in renderer)
                this.svgRenderer.compileSVG(mobStats.image);
            }
        }
    }
    // Mark all sections as loaded
    for (let section = 0; section < 9; section++) {
        this.loadedSections.add(section);
    }
    this.currentSection = 0;
    // No frame rendering needed — mark preloading complete immediately
    this.svgRenderer.markPreloadingComplete();
    console.log('[Graphics] Mob SVGs compiled into canvas commands');
};
/**
 * Parse all animation durations from an SVG string.
 * Returns durations in milliseconds.
 * Kept for API compatibility.
 */
core_1.Graphics.prototype.parseSVGAnimationDurations = function (svg) {
    const durations = [];
    const durRegex = /dur="([^"]*)"/g;
    let match;
    while ((match = durRegex.exec(svg)) !== null) {
        const durStr = match[1];
        let ms;
        if (durStr.endsWith('ms')) {
            ms = parseFloat(durStr);
        }
        else if (durStr.endsWith('s')) {
            ms = parseFloat(durStr) * 1000;
        }
        else {
            ms = parseFloat(durStr) * 1000;
        }
        if (ms > 0 && !isNaN(ms)) {
            durations.push(Math.round(ms));
        }
    }
    return durations;
};
/**
 * Kept for API compatibility.
 */
core_1.Graphics.prototype.calculateFramesPerCycle = function (_svg, _frameTime) {
    return 30;
};
/**
 * No-op: frame pre-rendering is no longer needed.
 * SVGs are compiled into canvas commands at load time and drawn directly.
 */
core_1.Graphics.prototype.preloadMobFrames = function (mobStats, _cacheKey, _preloadPromises, _baseCacheKey) {
    // Just ensure the SVG is compiled
    if (mobStats && mobStats.image) {
        this.svgRenderer.compileSVG(mobStats.image);
    }
};
/**
 * Returns 0 — no offscreen canvas memory used with canvas-command rendering.
 */
core_1.Graphics.prototype.getOffscreenCanvasMemoryMB = function () {
    return 0;
};
core_1.Graphics.prototype.loadSectionMobs = function (section) {
    const mobTypes = (0, core_1.getMobTypesBySection)(section);
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
    this.loadedSections.add(section);
    // Pre-compile SVGs for this section's mobs
    for (const mobType of mobTypes) {
        for (const rarity of rarities) {
            const mobStats = (0, core_1.getMobStats)(mobType, rarity);
            if (mobStats && mobStats.image) {
                const cacheKey = `${mobType}_${rarity}`;
                this.mobSVGCache[cacheKey] = mobStats.image;
                this.svgRenderer.compileSVG(mobStats.image);
            }
        }
    }
};
/**
 * No-op: canvas-command rendering doesn't have per-section pixel caches.
 */
core_1.Graphics.prototype.unloadSectionMobs = function (section) {
    this.loadedSections.delete(section);
};
/**
 * No-op: frame rendering is no longer needed.
 */
core_1.Graphics.prototype.loadMobFrames = function (mobStats, _cacheKey) {
    if (mobStats && mobStats.image) {
        this.svgRenderer.compileSVG(mobStats.image);
    }
};
