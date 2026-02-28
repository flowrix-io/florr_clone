"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Graphics = void 0;
const constants_1 = require("./constants");
const petals_1 = require("./petals");
const mobs_1 = require("./mobs");
const svg_renderer_1 = require("./svg_renderer");
class Graphics {
    /**
     * Get the canvas to use for a petal at a given time
     * Returns the canvas for static petals, or the appropriate frame for animated petals
     */
    getPetalCanvas(petalKey, time = Date.now()) {
        const petalImage = this.petalImageCache[petalKey];
        if (!petalImage) {
            return null;
        }
        if (Array.isArray(petalImage)) {
            // Animated petal - select frame based on time (24fps = 42ms per frame)
            const frameIndex = Math.floor((time / 42) % petalImage.length);
            return petalImage[frameIndex];
        }
        else {
            // Static petal
            return petalImage;
        }
    }
    constructor(canvas, playerSprite, wallTexture, octopusSprite, fishSprite, healthPotionSprite, speedBoostSprite, shieldSprite, backgroundTexture) {
        this.cameraX = 0;
        this.cameraY = 0;
        this.zoomLevel = 1.0;
        this.frameTimestamp = 0; // Cached Date.now() for current frame
        this.floatingTexts = [];
        this.lastDamageTextTime = new Map(); // Track last damage text time per enemy
        this.accumulatedDamage = new Map(); // Accumulate throttled damage per enemy
        this.MAX_FLOATING_TEXTS = 50; // Limit total floating texts
        this.DAMAGE_TEXT_COOLDOWN = 100; // Minimum ms between damage texts per enemy
        this.explosionEffects = [];
        this.petalBreakEffects = [];
        this.lightningEffects = [];
        this.petalParticleEffects = [];
        this.fallingStars = [];
        this.MAX_FALLING_STARS = 20;
        this.mapData = [];
        this.changelogManager = null;
        this.notificationsManager = null;
        this.MINIMAP_WIDTH = 200;
        this.MINIMAP_HEIGHT = 200;
        this.MINIMAP_PADDING = 10;
        this.minimapScrollX = 0; // Scroll offset for minimap X
        this.minimapScrollY = 0; // Scroll offset for minimap Y
        this.minimapZoom = 1.0; // Zoom level for minimap (1.0 = 20000x20000 area)
        this.MINIMAP_MIN_ZOOM = 0.5; // Show 40000x40000 area
        this.MINIMAP_MAX_ZOOM = 3.0; // Show 6667x6667 area
        this.MINIMAP_ZOOM_STEP = 0.2;
        this.playerEye = { x: 0, y: 0 };
        // Petal physics state
        this.petalPhysicsStates = new Map();
        this.ATTRACTION_FORCE = 50; // Attraction force towards mobs (pixels per second^2) - increased from 150
        this.SPRING_FORCE = 700; // Spring force back to orbit position (pixels per second^2) - reduced from 300
        this.DAMPING = 0.72; // Velocity damping per frame (0-1, lower = more damping)
        this.MAX_ATTRACTION_DISTANCE = 2000; // Maximum distance to attract to mobs (pixels) - increased significantly to match combat ranges
        this.MIN_ATTRACTION_DISTANCE = 1; // Minimum distance to avoid division by zero (pixels) - reduced from 30
        this.SPAWN_SMOOTH_TIME = 300; // Time in ms to smoothly ramp up forces after spawn - reduced from 500
        this.wallTexture = new Image();
        this.octopusSprite = new Image();
        this.fishSprite = new Image();
        this.healthPotionSprite = new Image();
        this.speedBoostSprite = new Image();
        this.shieldSprite = new Image();
        this.backgroundTexture = new Image();
        this.biomeTextures = new Map(); // Store biome-specific background textures
        this.sectionTextures = new Map(); // Store section-specific background textures (indexed 0-8)
        this.MAP_COLORS = {
            wall: 'rgba(102, 102, 102, 0.0)', // handled elsewhere
            spawn: 'rgba(76, 175, 80, 0.0)',
            teleporter: 'rgba(33, 150, 243, 0.0)', // handled elsewhere
            safe_zone: 'rgba(255, 193, 7, 0.0)', // No safe zone tint(invalid zone, not used)
            biome: 'rgba(128, 64, 192, 0.0)' // Purple tint for biomes on minimap
        };
        this.ENEMY_COLORS = {
            common: '#7eef6d',
            uncommon: '#ffe65d',
            rare: '#4d52e3',
            epic: '#861fde',
            legendary: '#de1f1f',
            mythic: '#1fdbde',
            ultra: '#de1f65',
            super: '#2bffa4',
            unique: '#bf00ff'
        };
        this.ENEMY_SIZE_MULTIPLIERS = {
            common: 1.0,
            uncommon: 1.2,
            rare: 1.4,
            epic: 1.6,
            legendary: 1.8,
            mythic: 2.0,
            ultra: 2.5,
            super: 3.0,
            unique: 3.5
        };
        this.ENEMY_MAX_HEALTH = {
            common: 20,
            uncommon: 40,
            rare: 60,
            epic: 80,
            legendary: 100,
            mythic: 150,
            ultra: 450,
            super: 1350,
            unique: 4050
        };
        this.ITEM_RARITY_COLORS = {
            common: '#7eef6d',
            uncommon: '#ffe65d',
            rare: '#4d52e3',
            epic: '#861fde',
            legendary: '#de1f1f',
            mythic: '#1fdbde',
            ultra: '#de1f65',
            super: '#2bffa4',
            unique: '#bf00ff'
        };
        this.showHitboxes = false;
        this.showRarityGlow = false; // Show petal rarity glow (toggled by ALT key)
        this.dynamicSkybox = false;
        this.mobDeathAnimation = true; // Mob death animation setting (default true)
        this.itemSprites = {};
        this.petalImageCache = {}; // Canvas for static, array for animated
        this.mobSVGCache = {}; // Store original SVG strings for WASM rendering
        this.svgRenderer = (0, svg_renderer_1.getSVGRenderer)();
        this.lastEnemyDebugLog = 0;
        // Section-based texture loading state
        this.currentSection = -1; // Current player section (0-8)
        this.loadedSections = new Set(); // Sections with loaded textures
        this.loadingMobs = new Set(); // Mobs currently being loaded (prevents duplicate loads)
        this.mobBaseCacheKeys = new Map(); // Map mob cache key to base cache key for unloading
        // Iris transition (circle reveal) animation
        this.irisTransitionActive = false;
        this.irisTransitionStartTime = 0;
        this.irisScreenshot = null;
        this.irisClosing = false;
        this.irisOnComplete = null;
        this.IRIS_TRANSITION_DURATION = 800; // ms
        this.IRIS_OUTLINE_WIDTH = 6;
        this.wallGridLogOnce = false;
        /**
         * Draw a garbage mob as a pile of random petals
         */
        this.cachedEligiblePetalTypes = null;
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        this.playerSprite = playerSprite;
        this.wallTexture = wallTexture;
        this.octopusSprite = octopusSprite;
        this.fishSprite = fishSprite;
        this.healthPotionSprite = healthPotionSprite;
        this.speedBoostSprite = speedBoostSprite;
        this.shieldSprite = shieldSprite;
        this.backgroundTexture = backgroundTexture;
        // Preload all mob SVG images
        this.preloadMobImages();
    }
    startIrisTransition(screenshot) {
        this.irisTransitionActive = true;
        this.irisTransitionStartTime = Date.now();
        this.irisScreenshot = screenshot;
        this.irisClosing = false;
        this.irisOnComplete = null;
    }
    startIrisClose(screenshot, onComplete) {
        this.irisTransitionActive = true;
        this.irisTransitionStartTime = Date.now();
        this.irisScreenshot = screenshot;
        this.irisClosing = true;
        this.irisOnComplete = onComplete;
    }
    drawIrisTransition() {
        const elapsed = Date.now() - this.irisTransitionStartTime;
        const progress = Math.min(elapsed / this.IRIS_TRANSITION_DURATION, 1);
        if (progress >= 1) {
            // Draw final frame for closing (fully covered)
            if (this.irisClosing) {
                this.ctx.save();
                if (this.irisScreenshot) {
                    this.ctx.drawImage(this.irisScreenshot, 0, 0, this.canvas.width, this.canvas.height);
                }
                else {
                    this.ctx.fillStyle = 'black';
                    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                }
                this.ctx.restore();
            }
            this.irisTransitionActive = false;
            this.irisScreenshot = null;
            if (this.irisOnComplete) {
                const cb = this.irisOnComplete;
                this.irisOnComplete = null;
                cb();
            }
            return;
        }
        // Opening: circle grows (ease out), Closing: circle shrinks (ease in)
        let eased;
        if (this.irisClosing) {
            eased = Math.pow(1 - progress, 3); // starts big (1), shrinks to 0
        }
        else {
            eased = 1 - Math.pow(1 - progress, 3); // starts small (0), grows to 1
        }
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
        const currentRadius = eased * maxRadius;
        this.ctx.save();
        // Clip to the area outside the circle (title screen overlay region)
        this.ctx.beginPath();
        this.ctx.rect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.arc(centerX, centerY, Math.max(currentRadius, 0), 0, Math.PI * 2, true);
        this.ctx.clip();
        // Draw captured title screen screenshot as overlay
        if (this.irisScreenshot) {
            this.ctx.drawImage(this.irisScreenshot, 0, 0, this.canvas.width, this.canvas.height);
        }
        else {
            this.ctx.fillStyle = 'black';
            this.ctx.fill();
        }
        this.ctx.restore();
        // Draw black outline ring around the circle edge
        if (currentRadius > 0) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
            this.ctx.strokeStyle = 'black';
            this.ctx.lineWidth = this.IRIS_OUTLINE_WIDTH;
            this.ctx.stroke();
            this.ctx.restore();
        }
    }
    async preloadMobImages() {
        // Initialize SVG renderer
        await this.svgRenderer.waitForInit();
        const allMobTypes = (0, mobs_1.getAllMobTypes)();
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        const highQualityMobs = (0, constants_1.getHighQualityMobs)();
        // Pre-render mob canvases for immediate use (no fallback circles)
        const preloadPromises = [];
        // ALWAYS load ALL SVG strings upfront (low memory cost, ensures rendering works)
        // This is required for mobs to render even before their frames are cached
        for (const mobType of allMobTypes) {
            for (const rarity of rarities) {
                const mobStats = (0, mobs_1.getMobStats)(mobType, rarity);
                if (mobStats && mobStats.image) {
                    const cacheKey = `${mobType}_${rarity}`;
                    this.mobSVGCache[cacheKey] = mobStats.image;
                }
            }
        }
        console.log('[Graphics] Loaded', Object.keys(this.mobSVGCache).length, 'mob SVG strings');
        // Pre-render ALL mob frames at startup to avoid rendering issues
        // (Mobs from unloaded sections would appear as circles otherwise)
        const mobTypesToPrerender = new Set(allMobTypes);
        // Mark all sections as loaded since we're preloading everything
        for (let section = 0; section < 9; section++) {
            this.loadedSections.add(section);
        }
        this.currentSection = 0;
        console.log(`[Graphics] Pre-rendering frames for ALL ${mobTypesToPrerender.size} mob types`);
        if (highQualityMobs) {
            // High quality mode: Pre-render frames for each rarity separately (old approach)
            // This uses more memory but ensures each rarity has its own frames
            for (const mobType of mobTypesToPrerender) {
                for (const rarity of rarities) {
                    const mobStats = (0, mobs_1.getMobStats)(mobType, rarity);
                    if (mobStats && mobStats.image) {
                        const cacheKey = `${mobType}_${rarity}`;
                        this.preloadMobFrames(mobStats, cacheKey, preloadPromises);
                    }
                }
            }
        }
        else {
            // Optimized mode: Pre-render animation frames only once per unique SVG
            // Track which SVG baseCacheKeys we've already pre-rendered frames for
            // This allows different rarities of the same mob type to share animation frames
            const preloadedBaseCacheKeys = new Set();
            for (const mobType of mobTypesToPrerender) {
                for (const rarity of rarities) {
                    const mobStats = (0, mobs_1.getMobStats)(mobType, rarity);
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
            // No mobs to pre-render, mark as complete immediately
            console.log('[Graphics] No mobs to pre-render, marking preloading complete');
            this.svgRenderer.markPreloadingComplete();
        }
        else {
            console.log(`[Graphics] Starting pre-render of ${preloadPromises.length} mob types...`);
            Promise.all(preloadPromises).then(() => {
                console.log('[Graphics] Pre-rendered mob canvases - marking preloading complete');
                // Mark preloading as complete to prevent data URL creation during gameplay
                this.svgRenderer.markPreloadingComplete();
                console.log('[Graphics] Preloading complete flag set:', this.svgRenderer.isPreloadingComplete());
            }).catch((error) => {
                console.warn('[Graphics] Some mob canvases failed to pre-render:', error);
                // Still mark as complete to prevent data URLs even if some failed
                this.svgRenderer.markPreloadingComplete();
                console.log('[Graphics] Preloading complete flag set (after error):', this.svgRenderer.isPreloadingComplete());
            });
        }
        console.log('[Graphics] Loaded', Object.keys(this.mobSVGCache).length, 'mob SVG strings for WASM rendering (section-based loading)');
    }
    // Method to get mob animation frame time in milliseconds
    getMobAnimationFrameTime() {
        return (0, constants_1.getMobAnimationFrameTime)();
    }
    static gcd(a, b) {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b > 0) {
            [a, b] = [b, a % b];
        }
        return a;
    }
    static lcm(a, b) {
        if (a === 0 || b === 0)
            return 0;
        return Math.abs(Math.round(a) * Math.round(b)) / Graphics.gcd(a, b);
    }
    /**
     * Parse all animation durations from an SVG string.
     * Returns durations in milliseconds.
     */
    parseSVGAnimationDurations(svg) {
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
                ms = parseFloat(durStr) * 1000; // assume seconds
            }
            if (ms > 0 && !isNaN(ms)) {
                durations.push(Math.round(ms));
            }
        }
        return durations;
    }
    /**
     * Calculate the optimal framesPerCycle for a mob SVG based on its animation durations.
     * Uses LCM of all durations to ensure all animations loop seamlessly.
     * Caps at MAX_FRAMES_PER_CYCLE to limit memory usage.
     */
    calculateFramesPerCycle(svg, frameTime) {
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
            }
            else {
                // Shortest duration itself exceeds max - use max frames
                framesPerCycle = MAX_FRAMES_PER_CYCLE;
            }
        }
        framesPerCycle = Math.max(MIN_FRAMES_PER_CYCLE, Math.min(MAX_FRAMES_PER_CYCLE, framesPerCycle));
        return framesPerCycle;
    }
    /**
     * Pre-render animation frames for a mob
     * @param mobStats The mob stats containing the SVG image
     * @param cacheKey The cache key for this mob (e.g., "bee_common")
     * @param preloadPromises Array to push the preload promise to
     * @param baseCacheKey Optional base cache key for optimized mode
     */
    preloadMobFrames(mobStats, cacheKey, preloadPromises, baseCacheKey) {
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
        const frameTime = this.getMobAnimationFrameTime();
        const framesPerCycle = this.calculateFramesPerCycle(mobStats.image, frameTime);
        // Store cycle length in the renderer for use during rendering
        this.svgRenderer.setCycleLength(baseCacheKey, framesPerCycle);
        const promise = (async () => {
            try {
                const highQualityMobs = (0, constants_1.getHighQualityMobs)();
                const mobSize = highQualityMobs ? mobStats.size * 40 : 256;
                for (let frame = 0; frame < framesPerCycle; frame++) {
                    if (this.svgRenderer.isPreloadingComplete()) {
                        console.log(`[Graphics] Preloading marked complete, stopping pre-render for ${cacheKey} at frame ${frame}`);
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
                        // Cache the canvas directly
                        this.svgRenderer.cacheCanvas(animatedCacheKey, canvas);
                        // Debug: Log first few cached frames
                        if (frame < 3) {
                            console.log(`[Graphics] Pre-rendered frame ${frame} for ${cacheKey} (baseCacheKey="${baseCacheKey.substring(0, 60)}...", timeBucket=${timeBucket})`);
                        }
                    }
                }
            }
            catch (error) {
                console.error(`[Graphics] Failed to pre-render canvas for ${cacheKey} (baseCacheKey=${baseCacheKey}):`, error);
            }
        })();
        preloadPromises.push(promise);
    }
    /**
     * Get the total memory used by offscreen canvases in MB
     */
    getOffscreenCanvasMemoryMB() {
        try {
            const canvasCache = this.svgRenderer.canvasCache;
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
        }
        catch (error) {
            console.warn('[Graphics] Error calculating canvas memory:', error);
            return 0;
        }
    }
    // Method to set a biome texture
    setBiomeTexture(biomeName, texture) {
        this.biomeTextures.set(biomeName, texture);
    }
    // Method to set a section texture (for SVG backgrounds)
    setSectionTexture(sectionIndex, texture) {
        this.sectionTextures.set(sectionIndex, texture);
    }
    // Method to get biome at a position
    getBiomeAtPosition(x, y) {
        for (const element of this.mapData) {
            if (element.type === 'biome') {
                if (x >= element.x && x <= element.x + element.width &&
                    y >= element.y && y <= element.y + element.height) {
                    return element;
                }
            }
        }
        return null;
    }
    // Get section index (0-8) from world position
    getSectionAtPosition(x, y) {
        const SECTION_SIZE = 20000;
        const sectionX = Math.max(0, Math.min(2, Math.floor(x / SECTION_SIZE)));
        const sectionY = Math.max(0, Math.min(2, Math.floor(y / SECTION_SIZE)));
        return sectionY * 3 + sectionX;
    }
    /**
     * Get adjacent sections for a given section (including diagonals)
     * Section grid:
     * [0][1][2]
     * [3][4][5]
     * [6][7][8]
     */
    getAdjacentSections(section) {
        const sectionX = section % 3;
        const sectionY = Math.floor(section / 3);
        const adjacent = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0)
                    continue; // Skip self
                const newX = sectionX + dx;
                const newY = sectionY + dy;
                if (newX >= 0 && newX < 3 && newY >= 0 && newY < 3) {
                    adjacent.push(newY * 3 + newX);
                }
            }
        }
        return adjacent;
    }
    /**
     * Update current section tracking
     * Called during render to track player's current section
     * Note: All frames are pre-loaded at startup, so no dynamic loading needed
     */
    updateSectionTextures(playerX, playerY) {
        const newSection = this.getSectionAtPosition(playerX, playerY);
        if (newSection !== this.currentSection) {
            this.currentSection = newSection;
        }
    }
    /**
     * Load mob textures for a specific section
     */
    loadSectionMobs(section) {
        const mobTypes = (0, mobs_1.getMobTypesBySection)(section);
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        console.log(`[Graphics] Loading animation frames for ${mobTypes.length} mob types in section ${section}`);
        this.loadedSections.add(section);
        // SVG strings are already all cached at startup
        // Only need to pre-render animation frames for this section
        for (const mobType of mobTypes) {
            for (const rarity of rarities) {
                const cacheKey = `${mobType}_${rarity}`;
                const mobStats = (0, mobs_1.getMobStats)(mobType, rarity);
                if (mobStats && mobStats.image) {
                    this.loadMobFrames(mobStats, cacheKey);
                }
            }
        }
    }
    /**
     * Unload mob animation frame canvases for a specific section
     * Note: SVG strings are kept in memory (low cost) to ensure mobs can always render
     */
    unloadSectionMobs(section) {
        const mobTypes = (0, mobs_1.getMobTypesBySection)(section);
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        console.log(`[Graphics] Unloading animation frames for ${mobTypes.length} mob types from section ${section}`);
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
        console.log(`[Graphics] Cleared ${clearedCount} cached canvas entries for section ${section}`);
    }
    /**
     * Load mob animation frames for a specific mob
     * Similar to preloadMobFrames but without adding to promise array
     */
    loadMobFrames(mobStats, cacheKey) {
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
        const frameTime = (0, constants_1.getMobAnimationFrameTime)();
        const framesPerCycle = this.calculateFramesPerCycle(mobStats.image, frameTime);
        this.svgRenderer.setCycleLength(baseCacheKey, framesPerCycle);
        // Pre-render frames asynchronously
        (async () => {
            try {
                const highQualityMobs = (0, constants_1.getHighQualityMobs)();
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
            }
            catch (error) {
                console.error(`[Graphics] Failed to load frames for ${cacheKey}:`, error);
            }
            finally {
                this.loadingMobs.delete(cacheKey);
            }
        })();
    }
    /**
     * Load animation frames on-demand (no-op since all frames are pre-loaded at startup)
     */
    loadMobOnDemand(mobType, rarity) {
        // All frames are pre-loaded at startup, no on-demand loading needed
    }
    // Method to find the closest wall or biome edge to an out-of-bounds position
    // Returns the texture to use for tiling (wall texture or biome texture)
    getClosestEdgeTexture(x, y) {
        // Check if position is out of bounds
        const isOutOfBounds = x < 0 || x >= constants_1.ACTUAL_WORLD_WIDTH || y < 0 || y >= constants_1.ACTUAL_WORLD_HEIGHT;
        if (!isOutOfBounds) {
            return { texture: null, isBiome: false };
        }
        let closestDistance = Infinity;
        let closestElement = null;
        let closestIsWall = false;
        // Check walls first
        for (const element of this.mapData) {
            if (element.type === 'wall') {
                // Calculate distance to wall edges
                const wallLeft = element.x;
                const wallRight = element.x + element.width;
                const wallTop = element.y;
                const wallBottom = element.y + element.height;
                // Find closest point on wall rectangle to (x, y)
                const closestX = Math.max(wallLeft, Math.min(x, wallRight));
                const closestY = Math.max(wallTop, Math.min(y, wallBottom));
                const distance = Math.sqrt((x - closestX) ** 2 + (y - closestY) ** 2);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestElement = element;
                    closestIsWall = true;
                }
            }
        }
        // Check biomes
        for (const element of this.mapData) {
            if (element.type === 'biome') {
                // Calculate distance to biome edges
                const biomeLeft = element.x;
                const biomeRight = element.x + element.width;
                const biomeTop = element.y;
                const biomeBottom = element.y + element.height;
                // Find closest point on biome rectangle to (x, y)
                const closestX = Math.max(biomeLeft, Math.min(x, biomeRight));
                const closestY = Math.max(biomeTop, Math.min(y, biomeBottom));
                const distance = Math.sqrt((x - closestX) ** 2 + (y - closestY) ** 2);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestElement = element;
                    closestIsWall = false;
                }
            }
        }
        // Return appropriate texture
        if (closestElement) {
            if (closestIsWall) {
                return { texture: this.wallTexture, isBiome: false };
            }
            else {
                // It's a biome - get its texture
                const biomeName = closestElement.properties?.biomeName;
                if (biomeName) {
                    const biomeTexture = this.biomeTextures.get(biomeName);
                    if (biomeTexture && biomeTexture.complete && biomeTexture.naturalWidth > 0) {
                        return { texture: biomeTexture, isBiome: true };
                    }
                }
                // Fallback to default background if biome texture not available
                return { texture: this.backgroundTexture, isBiome: false };
            }
        }
        // Default fallback
        return { texture: this.backgroundTexture, isBiome: false };
    }
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    setCamera(x, y, zoom = 1.0) {
        this.cameraX = x;
        this.cameraY = y;
        this.zoomLevel = zoom;
    }
    setMap(mapData) {
        this.mapData = mapData;
    }
    showFloatingText(x, y, text, color, fontSize) {
        // Limit total floating texts to prevent performance issues
        if (this.floatingTexts.length >= this.MAX_FLOATING_TEXTS) {
            // Remove oldest text
            this.floatingTexts.shift();
        }
        this.floatingTexts.push({
            x,
            y,
            text,
            color,
            fontSize,
            alpha: 1.0,
            yOffset: 0,
            lifetime: 100
        });
    }
    // Throttled version for damage text to prevent spam - accumulates damage when throttled
    showDamageText(enemyId, x, y, damage) {
        const now = Date.now();
        const lastTime = this.lastDamageTextTime.get(enemyId) || 0;
        // Accumulate damage if throttled
        if (now - lastTime < this.DAMAGE_TEXT_COOLDOWN) {
            const currentAccumulated = this.accumulatedDamage.get(enemyId) || 0;
            this.accumulatedDamage.set(enemyId, currentAccumulated + damage);
            return; // Will show accumulated damage when cooldown expires
        }
        // Show accumulated damage if any, otherwise show current damage
        const accumulated = this.accumulatedDamage.get(enemyId) || 0;
        const totalDamage = accumulated + damage;
        if (totalDamage > 0) {
            this.lastDamageTextTime.set(enemyId, now);
            this.accumulatedDamage.delete(enemyId); // Clear accumulated damage
            this.showFloatingText(x, y - 20, `-${Math.round(totalDamage)}`, '#ff0000', 16);
        }
    }
    // Get accumulated damage for an enemy (for showing on death)
    getAccumulatedDamage(enemyId) {
        return this.accumulatedDamage.get(enemyId) || 0;
    }
    // Clean up accumulated damage when enemy dies
    // Public method to clear petal physics states for a specific player (used when switching split players)
    clearPetalPhysicsForPlayer(playerId) {
        const keysToDelete = [];
        this.petalPhysicsStates.forEach((value, key) => {
            if (key.startsWith(playerId)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => this.petalPhysicsStates.delete(key));
    }
    clearEnemyDamage(enemyId) {
        this.lastDamageTextTime.delete(enemyId);
        this.accumulatedDamage.delete(enemyId);
    }
    showExplosionEffect(x, y, radius) {
        // Create particles for the explosion
        const particles = [];
        const particleCount = Math.min(50, Math.max(10, radius / 5)); // Scale particle count with radius
        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
            const speed = 2 + Math.random() * 3;
            const particleLife = 800 + Math.random() * 400;
            particles.push({
                x: x + (Math.random() - 0.5) * 10,
                y: y + (Math.random() - 0.5) * 10,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: particleLife,
                maxLife: particleLife,
                size: 2 + Math.random() * 3,
                color: Math.random() > 0.5 ? '#FF4500' : '#FFD700'
            });
        }
        // Create explosion effect
        this.explosionEffects.push({
            x,
            y,
            radius,
            maxRadius: radius,
            alpha: 1.0,
            lifetime: 1000,
            startTime: Date.now(),
            particles
        });
    }
    showPetalBreakEffect(x, y, petalType) {
        // Create petal break effect
        this.petalBreakEffects.push({
            x,
            y,
            petalType,
            alpha: 1.0,
            scale: 1.0,
            lifetime: 300,
            startTime: Date.now()
        });
    }
    showFallingStars() {
        // Limit to MAX_FALLING_STARS
        const currentCount = this.fallingStars.length;
        const starsToAdd = Math.min(this.MAX_FALLING_STARS - currentCount, this.MAX_FALLING_STARS);
        if (starsToAdd <= 0)
            return; // Already at max
        for (let i = 0; i < starsToAdd; i++) {
            this.fallingStars.push({
                x: Math.random() * this.canvas.width,
                y: -20 - Math.random() * 50, // Start above screen
                vy: 2 + Math.random() * 3, // Falling speed
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.1,
                size: 8 + Math.random() * 12,
                alpha: 0.8 + Math.random() * 0.2,
                lifetime: 2000 + Math.random() * 1000,
                maxLife: 2000 + Math.random() * 1000
            });
        }
    }
    showLightningEffect(x, y, targets, damage) {
        // Create lightning effect
        this.lightningEffects.push({
            x,
            y,
            targets,
            damage,
            lifetime: 500, // Lightning effect lasts 500ms
            startTime: Date.now(),
            alpha: 1.0
        });
    }
    showPetalParticleEffect(x, y, rarity) {
        // Only create particle effects for ultra, super, and unique petals
        if (!['ultra', 'super', 'unique'].includes(rarity)) {
            return;
        }
        // Create particles for the petal
        const particles = [];
        const particleCount = 8; // Number of particles radiating from the petal
        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
            const speed = 0.5 + Math.random() * 0.5; // Slow, gentle movement
            const particleLife = 2000 + Math.random() * 1000; // 2-3 seconds
            // Get rarity color for tinting
            const rarityColor = this.ITEM_RARITY_COLORS[rarity] || '#ffffff';
            particles.push({
                x: x + (Math.random() - 0.5) * 4,
                y: y + (Math.random() - 0.5) * 4,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: particleLife,
                maxLife: particleLife,
                size: 1 + Math.random() * 2,
                color: rarityColor,
                baseColor: '#ffffff' // White base color
            });
        }
        // Create petal particle effect
        this.petalParticleEffects.push({
            x,
            y,
            rarity,
            particles,
            lifetime: 3000, // Effect lasts 3 seconds
            startTime: Date.now()
        });
    }
    /**
     * Sample the background color at a specific world position and return darkened color with alpha 0.5
     */
    sampleColorAtPosition(worldX, worldY) {
        // Get the current transform state to properly convert coordinates
        // Note: getImageData uses canvas pixel coordinates, not transformed coordinates
        const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
        const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;
        // Convert world coordinates to canvas pixel coordinates
        // Account for zoom and camera position
        const canvasX = Math.floor((worldX - validCameraX) * this.zoomLevel);
        const canvasY = Math.floor((worldY - validCameraY) * this.zoomLevel);
        // Make sure we're within canvas bounds
        if (canvasX >= 0 && canvasX < this.canvas.width && canvasY >= 0 && canvasY < this.canvas.height) {
            try {
                // Use a small region (3x3) for more reliable sampling
                const sampleSize = 3;
                const startX = Math.max(0, canvasX - Math.floor(sampleSize / 2));
                const startY = Math.max(0, canvasY - Math.floor(sampleSize / 2));
                const endX = Math.min(this.canvas.width, startX + sampleSize);
                const endY = Math.min(this.canvas.height, startY + sampleSize);
                const actualWidth = endX - startX;
                const actualHeight = endY - startY;
                if (actualWidth > 0 && actualHeight > 0) {
                    const imageData = this.ctx.getImageData(startX, startY, actualWidth, actualHeight);
                    const pixelCount = imageData.data.length / 4; // Each pixel is 4 bytes (RGBA)
                    if (pixelCount > 0) {
                        let rSum = 0, gSum = 0, bSum = 0;
                        for (let i = 0; i < imageData.data.length; i += 4) {
                            rSum += imageData.data[i];
                            gSum += imageData.data[i + 1];
                            bSum += imageData.data[i + 2];
                        }
                        const avgR = Math.round(rSum / pixelCount);
                        const avgG = Math.round(gSum / pixelCount);
                        const avgB = Math.round(bSum / pixelCount);
                        // Darken the color by reducing each component by 30%
                        const darkenFactor = 0.9; // 90% of original = 10% darker
                        const darkR = Math.round(avgR * darkenFactor);
                        const darkG = Math.round(avgG * darkenFactor);
                        const darkB = Math.round(avgB * darkenFactor);
                        // Return darkened rgba color with alpha 0.5
                        return `rgba(${darkR}, ${darkG}, ${darkB}, 0.5)`;
                    }
                }
            }
            catch (error) {
                // Fallback if sampling fails
            }
        }
        // Fallback: use default background color (#00d885) darkened with alpha 0.5
        // Darken by 30%: 0 * 0.7 = 0, 216 * 0.7 = 151, 133 * 0.7 = 93
        return 'rgba(0, 151, 93, 0.5)';
    }
    /**
     * Check if a wall edge is exposed (no adjacent wall)
     */
    isEdgeExposed(wall, edge, allWalls) {
        const tolerance = 1; // Small tolerance for floating point comparison
        const x = wall.x;
        const y = wall.y;
        const width = wall.width;
        const height = wall.height;
        switch (edge) {
            case 'top':
                // Check if there's a wall directly above
                return !allWalls.some(other => other !== wall &&
                    other.type === 'wall' &&
                    Math.abs(other.y + other.height - y) < tolerance &&
                    other.x < x + width &&
                    other.x + other.width > x);
            case 'bottom':
                // Check if there's a wall directly below
                return !allWalls.some(other => other !== wall &&
                    other.type === 'wall' &&
                    Math.abs(other.y - (y + height)) < tolerance &&
                    other.x < x + width &&
                    other.x + other.width > x);
            case 'left':
                // Check if there's a wall directly to the left
                return !allWalls.some(other => other !== wall &&
                    other.type === 'wall' &&
                    Math.abs(other.x + other.width - x) < tolerance &&
                    other.y < y + height &&
                    other.y + other.height > y);
            case 'right':
                // Check if there's a wall directly to the right
                return !allWalls.some(other => other !== wall &&
                    other.type === 'wall' &&
                    Math.abs(other.x - (x + width)) < tolerance &&
                    other.y < y + height &&
                    other.y + other.height > y);
        }
    }
    /**
     * Draw spiky edges on a wall using the tiled texture pattern
     * Spikes are randomly positioned and can connect together, with softer curves
     */
    drawWallSpikes(x, y, width, height, wall, allWalls, pattern) {
        const minSpikeHeight = 8;
        const maxSpikeHeight = 25;
        const minSpikeWidth = 25;
        const maxSpikeWidth = 50;
        const minSpikeSpacing = 0;
        const maxSpikeSpacing = 20;
        const clusterChance = 0.3; // 30% chance of spikes connecting/clustering
        // Use wall position as seed for consistent randomness
        const baseSeed = (wall.x * 1000 + wall.y) * 1000;
        this.ctx.save();
        this.ctx.fillStyle = pattern;
        // Top edge spikes
        if (this.isEdgeExposed(wall, 'top', allWalls)) {
            this.drawRandomSpikesOnEdge(x, y, width, 0, 'top', baseSeed + 1, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance);
        }
        // Bottom edge spikes
        if (this.isEdgeExposed(wall, 'bottom', allWalls)) {
            this.drawRandomSpikesOnEdge(x, y + height, width, 0, 'bottom', baseSeed + 2, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance);
        }
        // Left edge spikes
        if (this.isEdgeExposed(wall, 'left', allWalls)) {
            this.drawRandomSpikesOnEdge(x, y, 0, height, 'left', baseSeed + 3, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance);
        }
        // Right edge spikes
        if (this.isEdgeExposed(wall, 'right', allWalls)) {
            this.drawRandomSpikesOnEdge(x + width, y, 0, height, 'right', baseSeed + 4, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance);
        }
        this.ctx.restore();
    }
    /**
     * Draw shadows around wall spikes
     */
    drawWallSpikeShadows(x, y, width, height, wall, allWalls, shadowSize) {
        const minSpikeHeight = 8;
        const maxSpikeHeight = 25;
        const minSpikeWidth = 25;
        const maxSpikeWidth = 50;
        const minSpikeSpacing = 0;
        const maxSpikeSpacing = 20;
        const clusterChance = 0.3;
        // Use wall position as seed for consistent randomness (same as drawWallSpikes)
        const baseSeed = (wall.x * 1000 + wall.y) * 1000;
        this.ctx.save();
        // Top edge spike shadows
        if (this.isEdgeExposed(wall, 'top', allWalls)) {
            this.drawRandomSpikeShadowsOnEdge(x, y, width, 0, 'top', baseSeed + 1, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance, shadowSize);
        }
        // Bottom edge spike shadows
        if (this.isEdgeExposed(wall, 'bottom', allWalls)) {
            this.drawRandomSpikeShadowsOnEdge(x, y + height, width, 0, 'bottom', baseSeed + 2, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance, shadowSize);
        }
        // Left edge spike shadows
        if (this.isEdgeExposed(wall, 'left', allWalls)) {
            this.drawRandomSpikeShadowsOnEdge(x, y, 0, height, 'left', baseSeed + 3, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance, shadowSize);
        }
        // Right edge spike shadows
        if (this.isEdgeExposed(wall, 'right', allWalls)) {
            this.drawRandomSpikeShadowsOnEdge(x + width, y, 0, height, 'right', baseSeed + 4, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance, shadowSize);
        }
        this.ctx.restore();
    }
    /**
     * Draw random spikes along an edge with clustering support
     */
    drawRandomSpikesOnEdge(startX, startY, edgeWidth, edgeHeight, direction, seed, minHeight, maxHeight, minWidth, maxWidth, minSpacing, maxSpacing, clusterChance) {
        const edgeLength = direction === 'top' || direction === 'bottom' ? edgeWidth : edgeHeight;
        const spikes = [];
        let currentPos = 0;
        let seedOffset = 0;
        // Generate random spike positions with clustering
        let inCluster = false;
        let clusterSpikeCount = 0;
        let clusterMaxSpikes = 0;
        let prevSpikeEnd = 0; // Track where previous spike ends to prevent overlap
        while (prevSpikeEnd < edgeLength) {
            const rand = (0, constants_1.seededRandom)(seed + seedOffset++);
            // Check if we should start a new cluster
            if (!inCluster && rand < clusterChance) {
                inCluster = true;
                clusterSpikeCount = 0;
                clusterMaxSpikes = 2 + Math.floor((0, constants_1.seededRandom)(seed + seedOffset++) * 3); // 2-4 spikes in cluster
            }
            // Calculate spacing from previous spike end
            let spacing = 0;
            if (inCluster && clusterSpikeCount > 0) {
                // Small spacing within cluster
                spacing = minSpacing * 0.3 + (minSpacing * 0.5) * (0, constants_1.seededRandom)(seed + seedOffset++);
            }
            else if (!inCluster) {
                // Normal spacing for non-clustered spikes
                spacing = minSpacing + (maxSpacing - minSpacing) * rand;
            }
            // Position spike after previous spike with spacing
            currentPos = prevSpikeEnd + spacing;
            if (currentPos >= edgeLength)
                break;
            const spikeWidth = minWidth + (maxWidth - minWidth) * (0, constants_1.seededRandom)(seed + seedOffset++);
            const spikeHeight = minHeight + (maxHeight - minHeight) * (0, constants_1.seededRandom)(seed + seedOffset++);
            // Clustered spikes are wider and can vary in height
            const finalWidth = inCluster ? spikeWidth * (1.3 + (0, constants_1.seededRandom)(seed + seedOffset++) * 0.7) : spikeWidth;
            const finalHeight = inCluster ? spikeHeight * (1.1 + (0, constants_1.seededRandom)(seed + seedOffset++) * 0.2) : spikeHeight;
            // Ensure spike doesn't go beyond edge
            if (currentPos + finalWidth > edgeLength) {
                break;
            }
            spikes.push({
                pos: currentPos,
                width: finalWidth,
                height: finalHeight,
                isCluster: inCluster
            });
            // Update position to end of current spike
            prevSpikeEnd = currentPos + finalWidth;
            // Update cluster state
            if (inCluster) {
                clusterSpikeCount++;
                if (clusterSpikeCount >= clusterMaxSpikes) {
                    inCluster = false;
                    // Add extra spacing after cluster ends
                    prevSpikeEnd += minSpacing * 0.5;
                }
            }
        }
        // Draw the spikes with straight lines (less sharp trapezoid shape)
        spikes.forEach((spike, index) => {
            // Use actual position without overlap adjustment
            const spikeX = direction === 'top' || direction === 'bottom'
                ? startX + spike.pos
                : startX;
            const spikeY = direction === 'left' || direction === 'right'
                ? startY + spike.pos
                : startY;
            const spikeWidth = spike.width;
            const spikeHeight = spike.height;
            // Make spikes less sharp by using a flat top instead of sharp point
            // Top width is 20-40% of base width for less sharp appearance
            const topWidth = spikeWidth * (0.2 + (0, constants_1.seededRandom)((spike.pos * 1000) % 1000) * 0.2);
            this.ctx.beginPath();
            if (direction === 'top') {
                // Trapezoid spike pointing upward with flat top
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY - spikeHeight);
                this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY - spikeHeight);
                this.ctx.lineTo(spikeX + spikeWidth, spikeY);
            }
            else if (direction === 'bottom') {
                // Trapezoid spike pointing downward with flat bottom
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY + spikeHeight);
                this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY + spikeHeight);
                this.ctx.lineTo(spikeX + spikeWidth, spikeY);
            }
            else if (direction === 'left') {
                // Trapezoid spike pointing left with flat left side
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
                this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
                this.ctx.lineTo(spikeX, spikeY + spikeWidth);
            }
            else if (direction === 'right') {
                // Trapezoid spike pointing right with flat right side
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
                this.ctx.lineTo(spikeX + spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
                this.ctx.lineTo(spikeX, spikeY + spikeWidth);
            }
            this.ctx.closePath();
            // Fill with pattern
            this.ctx.fill();
            // Draw outline only on outer edges (not on the base that connects to wall)
            this.ctx.strokeStyle = '#783f01';
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            if (direction === 'top') {
                // Draw outline on left side, top, and right side (skip bottom base)
                // Start from left side of base, go up left edge
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY - spikeHeight);
                // Draw top edge
                this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY - spikeHeight);
                // Draw right edge down to base
                this.ctx.lineTo(spikeX + spikeWidth, spikeY);
                // Don't draw the base edge
            }
            else if (direction === 'bottom') {
                // Draw outline on left side, bottom, and right side (skip top base)
                // Start from left side of base, go down left edge
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY + spikeHeight);
                // Draw bottom edge
                this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY + spikeHeight);
                // Draw right edge up to base
                this.ctx.lineTo(spikeX + spikeWidth, spikeY);
                // Don't draw the base edge
            }
            else if (direction === 'left') {
                // Draw outline on top, left side, and bottom (skip right base)
                // Start from top of base, go left along top edge
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
                // Draw left edge
                this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
                // Draw bottom edge back to base
                this.ctx.lineTo(spikeX, spikeY + spikeWidth);
                // Don't draw the base edge
            }
            else if (direction === 'right') {
                // Draw outline on top, right side, and bottom (skip left base)
                // Start from top of base, go right along top edge
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
                // Draw right edge
                this.ctx.lineTo(spikeX + spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
                // Draw bottom edge back to base
                this.ctx.lineTo(spikeX, spikeY + spikeWidth);
                // Don't draw the base edge
            }
            this.ctx.stroke();
        });
    }
    /**
     * Draw shadows around random spikes along an edge (mirrors drawRandomSpikesOnEdge logic)
     */
    drawRandomSpikeShadowsOnEdge(startX, startY, edgeWidth, edgeHeight, direction, seed, minHeight, maxHeight, minWidth, maxWidth, minSpacing, maxSpacing, clusterChance, shadowSize) {
        const edgeLength = direction === 'top' || direction === 'bottom' ? edgeWidth : edgeHeight;
        const spikes = [];
        let currentPos = 0;
        let seedOffset = 0;
        // Generate random spike positions with clustering (same logic as drawRandomSpikesOnEdge)
        let inCluster = false;
        let clusterSpikeCount = 0;
        let clusterMaxSpikes = 0;
        let prevSpikeEnd = 0;
        while (prevSpikeEnd < edgeLength) {
            const rand = (0, constants_1.seededRandom)(seed + seedOffset++);
            if (!inCluster && rand < clusterChance) {
                inCluster = true;
                clusterSpikeCount = 0;
                clusterMaxSpikes = 2 + Math.floor((0, constants_1.seededRandom)(seed + seedOffset++) * 3);
            }
            let spacing = 0;
            if (inCluster && clusterSpikeCount > 0) {
                spacing = minSpacing * 0.3 + (minSpacing * 0.5) * (0, constants_1.seededRandom)(seed + seedOffset++);
            }
            else if (!inCluster) {
                spacing = minSpacing + (maxSpacing - minSpacing) * rand;
            }
            currentPos = prevSpikeEnd + spacing;
            if (currentPos >= edgeLength)
                break;
            const spikeWidth = minWidth + (maxWidth - minWidth) * (0, constants_1.seededRandom)(seed + seedOffset++);
            const spikeHeight = minHeight + (maxHeight - minHeight) * (0, constants_1.seededRandom)(seed + seedOffset++);
            const finalWidth = inCluster ? spikeWidth * (1.3 + (0, constants_1.seededRandom)(seed + seedOffset++) * 0.7) : spikeWidth;
            const finalHeight = inCluster ? spikeHeight * (1.1 + (0, constants_1.seededRandom)(seed + seedOffset++) * 0.2) : spikeHeight;
            if (currentPos + finalWidth > edgeLength) {
                break;
            }
            spikes.push({
                pos: currentPos,
                width: finalWidth,
                height: finalHeight,
                isCluster: inCluster
            });
            prevSpikeEnd = currentPos + finalWidth;
            if (inCluster) {
                clusterSpikeCount++;
                if (clusterSpikeCount >= clusterMaxSpikes) {
                    inCluster = false;
                    prevSpikeEnd += minSpacing * 0.5;
                }
            }
        }
        // Draw shadows around each spike
        spikes.forEach((spike) => {
            const spikeX = direction === 'top' || direction === 'bottom'
                ? startX + spike.pos
                : startX;
            const spikeY = direction === 'left' || direction === 'right'
                ? startY + spike.pos
                : startY;
            const spikeWidth = spike.width;
            const spikeHeight = spike.height;
            const topWidth = spikeWidth * (0.2 + (0, constants_1.seededRandom)((spike.pos * 1000) % 1000) * 0.2);
            // Sample color at the center of the shadow area for this spike
            let shadowCenterX;
            let shadowCenterY;
            if (direction === 'top') {
                shadowCenterX = spikeX + spikeWidth / 2;
                shadowCenterY = spikeY - spikeHeight - shadowSize / 2;
            }
            else if (direction === 'bottom') {
                shadowCenterX = spikeX + spikeWidth / 2;
                shadowCenterY = spikeY + spikeHeight + shadowSize / 2;
            }
            else if (direction === 'left') {
                shadowCenterX = spikeX - spikeHeight - shadowSize / 2;
                shadowCenterY = spikeY + spikeWidth / 2;
            }
            else { // right
                shadowCenterX = spikeX + spikeHeight + shadowSize / 2;
                shadowCenterY = spikeY + spikeWidth / 2;
            }
            const shadowColor = this.sampleColorAtPosition(shadowCenterX, shadowCenterY);
            // Set fill style before drawing the path
            this.ctx.fillStyle = shadowColor;
            this.ctx.beginPath();
            // Draw shadow path that extends around all edges of the spike shape
            // The shadow extends shadowSize pixels outward from each edge
            if (direction === 'top') {
                // Shadow around top spike - create outer path
                const leftX = spikeX + (spikeWidth - topWidth) / 2;
                const rightX = spikeX + (spikeWidth + topWidth) / 2;
                const topY = spikeY - spikeHeight;
                // Start from left base, go around the spike
                this.ctx.moveTo(spikeX - shadowSize, spikeY);
                // Left edge shadow
                this.ctx.lineTo(leftX - shadowSize, topY - shadowSize);
                // Top edge shadow
                this.ctx.lineTo(rightX + shadowSize, topY - shadowSize);
                // Right edge shadow
                this.ctx.lineTo(spikeX + spikeWidth + shadowSize, spikeY);
            }
            else if (direction === 'bottom') {
                // Shadow around bottom spike - create outer path
                const leftX = spikeX + (spikeWidth - topWidth) / 2;
                const rightX = spikeX + (spikeWidth + topWidth) / 2;
                const bottomY = spikeY + spikeHeight;
                // Start from left base, go around the spike
                this.ctx.moveTo(spikeX - shadowSize, spikeY);
                // Left edge shadow
                this.ctx.lineTo(leftX - shadowSize, bottomY + shadowSize);
                // Bottom edge shadow
                this.ctx.lineTo(rightX + shadowSize, bottomY + shadowSize);
                // Right edge shadow
                this.ctx.lineTo(spikeX + spikeWidth + shadowSize, spikeY);
            }
            else if (direction === 'left') {
                // Shadow around left spike - create outer path
                const topY = spikeY + (spikeWidth - topWidth) / 2;
                const bottomY = spikeY + (spikeWidth + topWidth) / 2;
                const leftX = spikeX - spikeHeight;
                // Start from top base, go around the spike
                this.ctx.moveTo(spikeX, spikeY - shadowSize);
                // Top edge shadow
                this.ctx.lineTo(leftX - shadowSize, topY - shadowSize);
                // Left edge shadow
                this.ctx.lineTo(leftX - shadowSize, bottomY + shadowSize);
                // Bottom edge shadow
                this.ctx.lineTo(spikeX, spikeY + spikeWidth + shadowSize);
            }
            else if (direction === 'right') {
                // Shadow around right spike - create outer path
                const topY = spikeY + (spikeWidth - topWidth) / 2;
                const bottomY = spikeY + (spikeWidth + topWidth) / 2;
                const rightX = spikeX + spikeHeight;
                // Start from top base, go around the spike
                this.ctx.moveTo(spikeX, spikeY - shadowSize);
                // Top edge shadow
                this.ctx.lineTo(rightX + shadowSize, topY - shadowSize);
                // Right edge shadow
                this.ctx.lineTo(rightX + shadowSize, bottomY + shadowSize);
                // Bottom edge shadow
                this.ctx.lineTo(spikeX, spikeY + spikeWidth + shadowSize);
            }
            this.ctx.closePath();
            this.ctx.fill();
        });
    }
    /**
     * Draw a jagged edge protrusion on an exposed wall tile edge
     */
    drawJaggedEdge(worldX, worldY, edge, points, pattern) {
        this.ctx.save();
        this.ctx.fillStyle = pattern;
        // Draw filled region between straight tile edge and jagged polyline
        this.ctx.beginPath();
        if (edge === 'top') {
            this.ctx.moveTo(worldX + points[0].t, worldY);
            for (const pt of points) {
                this.ctx.lineTo(worldX + pt.t, worldY - pt.offset);
            }
            this.ctx.lineTo(worldX + points[points.length - 1].t, worldY);
        }
        else if (edge === 'bottom') {
            const baseY = worldY + constants_1.WALL_TILE_SIZE;
            this.ctx.moveTo(worldX + points[0].t, baseY);
            for (const pt of points) {
                this.ctx.lineTo(worldX + pt.t, baseY + pt.offset);
            }
            this.ctx.lineTo(worldX + points[points.length - 1].t, baseY);
        }
        else if (edge === 'left') {
            this.ctx.moveTo(worldX, worldY + points[0].t);
            for (const pt of points) {
                this.ctx.lineTo(worldX - pt.offset, worldY + pt.t);
            }
            this.ctx.lineTo(worldX, worldY + points[points.length - 1].t);
        }
        else if (edge === 'right') {
            const baseX = worldX + constants_1.WALL_TILE_SIZE;
            this.ctx.moveTo(baseX, worldY + points[0].t);
            for (const pt of points) {
                this.ctx.lineTo(baseX + pt.offset, worldY + pt.t);
            }
            this.ctx.lineTo(baseX, worldY + points[points.length - 1].t);
        }
        this.ctx.closePath();
        this.ctx.fill();
        // Draw dark brown outline matching wall dot color
        this.ctx.strokeStyle = '#783f01';
        this.ctx.lineWidth = 3;
        this.ctx.lineJoin = 'round';
        this.ctx.beginPath();
        if (edge === 'top') {
            this.ctx.moveTo(worldX + points[0].t, worldY - points[0].offset);
            for (let i = 1; i < points.length; i++) {
                this.ctx.lineTo(worldX + points[i].t, worldY - points[i].offset);
            }
        }
        else if (edge === 'bottom') {
            const baseY = worldY + constants_1.WALL_TILE_SIZE;
            this.ctx.moveTo(worldX + points[0].t, baseY + points[0].offset);
            for (let i = 1; i < points.length; i++) {
                this.ctx.lineTo(worldX + points[i].t, baseY + points[i].offset);
            }
        }
        else if (edge === 'left') {
            this.ctx.moveTo(worldX - points[0].offset, worldY + points[0].t);
            for (let i = 1; i < points.length; i++) {
                this.ctx.lineTo(worldX - points[i].offset, worldY + points[i].t);
            }
        }
        else if (edge === 'right') {
            const baseX = worldX + constants_1.WALL_TILE_SIZE;
            this.ctx.moveTo(baseX + points[0].offset, worldY + points[0].t);
            for (let i = 1; i < points.length; i++) {
                this.ctx.lineTo(baseX + points[i].offset, worldY + points[i].t);
            }
        }
        this.ctx.stroke();
        this.ctx.restore();
    }
    /**
     * Draw a smooth curved edge protrusion on an exposed water tile edge.
     * Uses quadratic bezier curves through the jagged points for a smooth water look.
     */
    drawSmoothedEdge(worldX, worldY, edge, points, fillColor, strokeColor) {
        if (points.length < 3)
            return;
        this.ctx.save();
        this.ctx.fillStyle = fillColor;
        // Helper to get world coords from a JaggedPoint for each edge direction
        const getXY = (pt) => {
            if (edge === 'top')
                return [worldX + pt.t, worldY - pt.offset];
            if (edge === 'bottom')
                return [worldX + pt.t, worldY + constants_1.WALL_TILE_SIZE + pt.offset];
            if (edge === 'left')
                return [worldX - pt.offset, worldY + pt.t];
            // right
            return [worldX + constants_1.WALL_TILE_SIZE + pt.offset, worldY + pt.t];
        };
        const getBase = (pt) => {
            if (edge === 'top')
                return [worldX + pt.t, worldY];
            if (edge === 'bottom')
                return [worldX + pt.t, worldY + constants_1.WALL_TILE_SIZE];
            if (edge === 'left')
                return [worldX, worldY + pt.t];
            // right
            return [worldX + constants_1.WALL_TILE_SIZE, worldY + pt.t];
        };
        // Draw filled region with smooth curves
        this.ctx.beginPath();
        const [startBaseX, startBaseY] = getBase(points[0]);
        this.ctx.moveTo(startBaseX, startBaseY);
        // Smooth curve through the jagged points using quadratic bezier
        const [firstX, firstY] = getXY(points[0]);
        this.ctx.lineTo(firstX, firstY);
        for (let i = 1; i < points.length - 1; i++) {
            const [px, py] = getXY(points[i]);
            const [nx, ny] = getXY(points[i + 1]);
            const cpx = px;
            const cpy = py;
            const endx = (px + nx) / 2;
            const endy = (py + ny) / 2;
            this.ctx.quadraticCurveTo(cpx, cpy, endx, endy);
        }
        const [lastX, lastY] = getXY(points[points.length - 1]);
        this.ctx.lineTo(lastX, lastY);
        const [endBaseX, endBaseY] = getBase(points[points.length - 1]);
        this.ctx.lineTo(endBaseX, endBaseY);
        this.ctx.closePath();
        this.ctx.fill();
        // Draw smooth outline along the curved edge only
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2;
        this.ctx.lineJoin = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(firstX, firstY);
        for (let i = 1; i < points.length - 1; i++) {
            const [px, py] = getXY(points[i]);
            const [nx, ny] = getXY(points[i + 1]);
            const endx = (px + nx) / 2;
            const endy = (py + ny) / 2;
            this.ctx.quadraticCurveTo(px, py, endx, endy);
        }
        this.ctx.lineTo(lastX, lastY);
        this.ctx.stroke();
        this.ctx.restore();
    }
    drawMap(world_map_data) {
        // Calculate viewport accounting for zoom level
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + scaledWidth,
            bottom: this.cameraY + scaledHeight
        };
        // Draw wall grid tiles
        this.drawWallGrid(viewport);
        // Draw all map elements (spawn areas, biomes, teleporters, safe zones)
        world_map_data.forEach(element => {
            const x = element.x;
            const y = element.y;
            const width = element.width;
            const height = element.height;
            // Only draw elements that are visible in the viewport (accounting for zoom)
            if (x + width >= viewport.left &&
                x <= viewport.right &&
                y + height >= viewport.top &&
                y <= viewport.bottom) {
                // Draw other elements normally (no more wall type)
                this.ctx.fillStyle = this.MAP_COLORS[element.type] || 'rgba(128, 128, 128, 0.0)';
                this.ctx.fillRect(x, y, width, height);
                // Add visual indicators for special elements
                if (element.type === 'teleporter') {
                    this.drawTeleporter(x, y, width, height);
                }
                else if (element.type === 'spawn') {
                    this.drawSpawnPoint(x, y, width, height, element.properties?.spawnType);
                }
                // Draw debug info if hitboxes are enabled
                if (this.showHitboxes) {
                    this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                    this.ctx.strokeRect(x, y, width, height);
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Ubuntu, sans-serif';
                    this.ctx.fillText(`${Math.round(x)},${Math.round(y)}`, x, y - 5);
                }
            }
        });
    }
    /**
     * Draw the wall grid (walls and water tiles)
     */
    drawWallGrid(viewport) {
        if (!constants_1.WALL_GRID || !constants_1.WALL_GRID.length) {
            if (!this.wallGridLogOnce) {
                console.warn('[Graphics] WALL_GRID is empty or undefined');
                this.wallGridLogOnce = true;
            }
            return;
        }
        // Log once
        if (!this.wallGridLogOnce) {
            let nonZero = 0;
            for (let y = 0; y < constants_1.WALL_GRID.length; y++) {
                for (let x = 0; x < constants_1.WALL_GRID[y].length; x++) {
                    if (constants_1.WALL_GRID[y][x] !== 0)
                        nonZero++;
                }
            }
            console.log(`[Graphics] WALL_GRID: ${constants_1.WALL_GRID.length}x${constants_1.WALL_GRID[0]?.length || 0}, non-zero tiles: ${nonZero}`);
            this.wallGridLogOnce = true;
        }
        // Calculate which tiles are visible in the viewport
        const minTileX = Math.max(0, (0, constants_1.worldToTileX)(viewport.left));
        const maxTileX = Math.min(constants_1.WALL_GRID[0]?.length - 1 || 0, (0, constants_1.worldToTileX)(viewport.right));
        const minTileY = Math.max(0, (0, constants_1.worldToTileY)(viewport.top));
        const maxTileY = Math.min(constants_1.WALL_GRID.length - 1, (0, constants_1.worldToTileY)(viewport.bottom));
        // Pass 1: Draw all tile fills (walls and water rectangles)
        for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
            for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
                const state = constants_1.WALL_GRID[tileY]?.[tileX] || 0;
                if (state === 0)
                    continue;
                const worldX = (0, constants_1.tileToWorldX)(tileX);
                const worldY = (0, constants_1.tileToWorldY)(tileY);
                if (state === 1) {
                    const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                    if (pattern) {
                        this.ctx.save();
                        this.ctx.fillStyle = pattern;
                        this.ctx.fillRect(worldX, worldY, constants_1.WALL_TILE_SIZE, constants_1.WALL_TILE_SIZE);
                        this.ctx.restore();
                    }
                    else {
                        this.ctx.fillStyle = '#666666';
                        this.ctx.fillRect(worldX, worldY, constants_1.WALL_TILE_SIZE, constants_1.WALL_TILE_SIZE);
                    }
                }
                else if (state === 2) {
                    this.ctx.fillStyle = '#4169E1';
                    this.ctx.fillRect(worldX, worldY, constants_1.WALL_TILE_SIZE, constants_1.WALL_TILE_SIZE);
                    this.ctx.fillStyle = 'rgba(65, 105, 225, 0.3)';
                    this.ctx.fillRect(worldX, worldY, constants_1.WALL_TILE_SIZE, constants_1.WALL_TILE_SIZE);
                }
            }
        }
        // Pass 2: Draw all edges on top so they aren't covered by adjacent tile fills
        for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
            for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
                const state = constants_1.WALL_GRID[tileY]?.[tileX] || 0;
                if (state === 0)
                    continue;
                const worldX = (0, constants_1.tileToWorldX)(tileX);
                const worldY = (0, constants_1.tileToWorldY)(tileY);
                if (state === 1) {
                    const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                    if (pattern) {
                        const jaggedEdges = (0, constants_1.getTileJaggedEdges)(constants_1.WALL_GRID, tileX, tileY);
                        if (jaggedEdges.top)
                            this.drawJaggedEdge(worldX, worldY, 'top', jaggedEdges.top, pattern);
                        if (jaggedEdges.bottom)
                            this.drawJaggedEdge(worldX, worldY, 'bottom', jaggedEdges.bottom, pattern);
                        if (jaggedEdges.left)
                            this.drawJaggedEdge(worldX, worldY, 'left', jaggedEdges.left, pattern);
                        if (jaggedEdges.right)
                            this.drawJaggedEdge(worldX, worldY, 'right', jaggedEdges.right, pattern);
                    }
                }
                else if (state === 2) {
                    const waterEdges = (0, constants_1.getTileJaggedEdges)(constants_1.WALL_GRID, tileX, tileY);
                    const waterFill = '#4169E1';
                    const waterStroke = '#2a4fa0';
                    if (waterEdges.top)
                        this.drawSmoothedEdge(worldX, worldY, 'top', waterEdges.top, waterFill, waterStroke);
                    if (waterEdges.bottom)
                        this.drawSmoothedEdge(worldX, worldY, 'bottom', waterEdges.bottom, waterFill, waterStroke);
                    if (waterEdges.left)
                        this.drawSmoothedEdge(worldX, worldY, 'left', waterEdges.left, waterFill, waterStroke);
                    if (waterEdges.right)
                        this.drawSmoothedEdge(worldX, worldY, 'right', waterEdges.right, waterFill, waterStroke);
                }
            }
        }
    }
    drawTeleporter(x, y, width, height) {
        // Create a pulsing effect
        const time = Date.now() / 1000;
        const pulseSize = 0.2 * Math.sin(time * 2) + 0.8; // Pulse between 0.6 and 1.0
        // Draw outer glow
        const gradient = this.ctx.createRadialGradient(x + width / 2, y + height / 2, 0, x + width / 2, y + height / 2, (width / 2) * pulseSize);
        gradient.addColorStop(0, 'rgba(0, 183, 255, 0.6)');
        gradient.addColorStop(0.6, 'rgba(0, 106, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 47, 255, 0)');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x, y, width, height);
        // Draw portal rings
        const numRings = 3;
        this.ctx.lineWidth = 4;
        for (let i = 0; i < numRings; i++) {
            const ringSize = ((i + 1) / numRings) * width / 2 * pulseSize;
            const opacity = 1 - (i / numRings);
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.ellipse(x + width / 2, y + height / 2, ringSize, ringSize * 0.4, 0, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        // Add some particle effects
        const numParticles = 8;
        const particleTime = time * 3;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        for (let i = 0; i < numParticles; i++) {
            const angle = (i / numParticles) * Math.PI * 2 + particleTime;
            const particleX = x + width / 2 + Math.cos(angle) * width / 3 * pulseSize;
            const particleY = y + height / 2 + Math.sin(angle) * height / 4 * pulseSize;
            this.ctx.beginPath();
            this.ctx.arc(particleX, particleY, 3, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }
    getTierColor(tier) {
        const colors = {
            common: 'rgba(128, 128, 128, 0.3)',
            uncommon: 'rgba(0, 128, 0, 0.3)',
            rare: 'rgba(0, 0, 255, 0.3)',
            epic: 'rgba(128, 0, 128, 0.3)',
            legendary: 'rgba(255, 165, 0, 0.3)',
            mythic: 'rgba(255, 0, 0, 0.3)'
        };
        return colors[tier] || colors.common;
    }
    drawSpawnPoint(x, y, width, height, type) {
        // // Draw spawn area indicator
        // const color = type ? this.getTierColor(type) : 'rgba(76, 175, 80, 0.3)';
        // this.ctx.fillStyle = color;
        // this.ctx.fillRect(x, y, width, height);
        // // Add spawn point marker
        // this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        // this.ctx.lineWidth = 2;
        // this.ctx.beginPath();
        // this.ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
        // this.ctx.stroke();
        // // Add tier label
        // if (type) {
        //     this.ctx.fillStyle = 'white';
        //     this.ctx.font = '20px Ubuntu, sans-serif';
        //     this.ctx.textAlign = 'center';
        //     this.ctx.fillText(type.toUpperCase(), x + width / 2, y + height / 2);
        // }
    }
    drawSpawnZones(mapData) {
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + scaledWidth,
            bottom: this.cameraY + scaledHeight
        };
        const spawnColors = {
            common: 'rgba(126, 239, 109, 0.25)',
            uncommon: 'rgba(255, 230, 93, 0.25)',
            rare: 'rgba(77, 82, 227, 0.25)',
            epic: 'rgba(134, 31, 222, 0.25)',
            legendary: 'rgba(222, 31, 31, 0.25)',
            mythic: 'rgba(31, 219, 222, 0.25)',
            ultra: 'rgba(222, 31, 101, 0.25)',
            super: 'rgba(43, 255, 164, 0.25)',
            unique: 'rgba(191, 0, 255, 0.25)'
        };
        mapData.forEach(element => {
            if (element.type !== 'spawn')
                return;
            const { x, y, width, height } = element;
            if (x + width < viewport.left || x > viewport.right ||
                y + height < viewport.top || y > viewport.bottom)
                return;
            const spawnType = element.properties?.spawnType || 'common';
            this.ctx.fillStyle = spawnColors[spawnType] || spawnColors.common;
            this.ctx.fillRect(x, y, width, height);
        });
    }
    drawUI(players, socket) {
        // Draw player stats
        const player = players.get(socket);
        if (player) {
            // Draw flower in top left (moved down for exit button)
            const flowerCenterX = 50;
            const flowerCenterY = 120; // 50 + 70 pixels down
            const flowerEye = { x: 2, y: 0 }; // Centered eyes for UI flower
            // Position bars to slightly overlap the flower
            const healthBarWidth = 200;
            const healthBarHeight = 20;
            const healthX = flowerCenterX + 12; // Bars start slightly inside the flower
            const healthY = 97.5; // 30 + 70 pixels down
            const textX = flowerCenterX + 35; // Text is completely outside the flower
            // Draw health bar with rounded ends
            const clampedHealth = Math.max(0, player.health); // Cap health at 0
            const healthFillWidth = (clampedHealth / player.maxHealth) * healthBarWidth;
            const radius = healthBarHeight / 2;
            // Health bar background (rounded)
            this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
            this.ctx.beginPath();
            this.ctx.roundRect(healthX - 2, healthY - 2, healthBarWidth + 4, healthBarHeight + 4, radius);
            this.ctx.fill();
            // Health bar fill (rounded)
            this.ctx.fillStyle = '#73ff54';
            this.ctx.beginPath();
            this.ctx.roundRect(healthX, healthY, healthFillWidth, healthBarHeight, radius);
            this.ctx.fill();
            // Health text with black outline
            this.ctx.font = '14px Ubuntu, sans-serif';
            const healthTextX = textX;
            const healthTextY = healthY + 15;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 3;
            const healthText = `${this.formatNumber(Math.round(clampedHealth))}/${this.formatNumber(player.maxHealth)}`;
            this.ctx.strokeText(healthText, healthTextX, healthTextY);
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(healthText, healthTextX, healthTextY);
            // Draw XP bar with rounded ends
            const xpBarY = healthY + healthBarHeight + 5;
            const xpFillWidth = (player.xp / player.xpToNextLevel) * healthBarWidth;
            // XP bar background (rounded)
            this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
            this.ctx.beginPath();
            this.ctx.roundRect(healthX - 2, xpBarY - 2, healthBarWidth + 4, healthBarHeight + 4, radius);
            this.ctx.fill();
            // XP bar fill (rounded) with new color
            this.ctx.fillStyle = '#faffc9';
            this.ctx.beginPath();
            this.ctx.roundRect(healthX, xpBarY, xpFillWidth, healthBarHeight, radius);
            this.ctx.fill();
            // XP text with black outline
            const xpTextX = textX;
            const xpTextY = xpBarY + 15;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 3;
            const xpText = `LVL ${player.level} - ${this.formatNumber(player.xp)}/${this.formatNumber(player.xpToNextLevel)}`;
            this.ctx.strokeText(xpText, xpTextX, xpTextY);
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(xpText, xpTextX, xpTextY);
            this.ctx.save();
            // Draw black outline around flower
            this.ctx.beginPath();
            this.ctx.arc(flowerCenterX, flowerCenterY, 27, 0, Math.PI * 2, false);
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 4;
            this.ctx.stroke();
            this.drawFlower({ x: flowerCenterX, y: flowerCenterY }, flowerEye);
            this.ctx.restore();
        }
        // Draw floating texts
        this.drawFloatingTexts();
        // Draw minimap
        this.drawMinimap(players, socket);
    }
    drawBossBars(enemies) {
        // Calculate viewport accounting for zoom level
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + scaledWidth,
            bottom: this.cameraY + scaledHeight
        };
        // Find all ultra, super, and unique mobs in view
        const bossMobs = [];
        for (const enemy of enemies.values()) {
            if (enemy.tier === 'ultra' || enemy.tier === 'super' || enemy.tier === 'unique') {
                // Check if enemy is in viewport (same logic as drawGameObjects)
                const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                const baseSize = mobStats ? mobStats.size * 40 : 40;
                const visualScale = mobStats?.visual_scale ?? 1.0;
                const enemySize = baseSize * visualScale;
                // Add a buffer margin to ensure mobs are completely out before considering them out of viewport
                const cullingBuffer = Math.max(enemySize, 100); // At least 100px buffer, or enemy size if larger
                // Mob is in viewport if it's NOT completely outside (with buffer)
                if (!(enemy.x + enemySize / 2 + cullingBuffer < viewport.left ||
                    enemy.x - enemySize / 2 - cullingBuffer > viewport.right ||
                    enemy.y + enemySize / 2 + cullingBuffer < viewport.top ||
                    enemy.y - enemySize / 2 - cullingBuffer > viewport.bottom)) {
                    bossMobs.push(enemy);
                }
            }
        }
        // Draw boss bars at the top of the screen
        if (bossMobs.length > 0) {
            const bossBarWidth = 400;
            const bossBarHeight = 24;
            const nameFontSize = 20;
            const nameMargin = 8; // Space between name and bar
            const bossBarSpacing = 60; // Space between multiple boss bars (increased to accommodate name)
            const topMargin = 20; // Margin from top of screen
            const centerX = this.canvas.width / 2;
            bossMobs.forEach((enemy, index) => {
                const nameY = topMargin + (index * bossBarSpacing);
                const bossBarY = nameY + nameFontSize + nameMargin;
                const bossBarX = centerX - bossBarWidth / 2;
                // Get mob stats for name
                const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                const mobName = mobStats ? mobStats.name : `${enemy.tier} ${enemy.type}`;
                // Draw mob name above the bar (larger font, centered)
                this.ctx.font = `${nameFontSize}px Ubuntu, sans-serif`;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 4;
                const nameTextWidth = this.ctx.measureText(mobName).width;
                const nameX = centerX - nameTextWidth / 2;
                this.ctx.strokeText(mobName, nameX, nameY);
                this.ctx.fillStyle = 'white';
                this.ctx.fillText(mobName, nameX, nameY);
                // Draw health bar with rounded ends
                const clampedHealth = Math.max(0, enemy.health);
                const healthFillWidth = (clampedHealth / enemy.maxHealth) * bossBarWidth;
                const radius = bossBarHeight / 2;
                // Boss bar background (rounded)
                this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
                this.ctx.beginPath();
                this.ctx.roundRect(bossBarX - 2, bossBarY - 2, bossBarWidth + 4, bossBarHeight + 4, radius);
                this.ctx.fill();
                // Boss bar fill (rounded) - same color as player health bar
                this.ctx.fillStyle = '#73ff54';
                this.ctx.beginPath();
                this.ctx.roundRect(bossBarX, bossBarY, healthFillWidth, bossBarHeight, radius);
                this.ctx.fill();
                // Draw health text (centered on the bar)
                this.ctx.font = '16px Ubuntu, sans-serif';
                const textY = bossBarY + 18;
                const healthText = `${this.formatNumber(Math.round(clampedHealth))}/${this.formatNumber(enemy.maxHealth)}`;
                const healthTextWidth = this.ctx.measureText(healthText).width;
                const healthTextX = centerX - healthTextWidth / 2;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 3;
                this.ctx.strokeText(healthText, healthTextX, textY);
                this.ctx.fillStyle = 'white';
                this.ctx.fillText(healthText, healthTextX, textY);
            });
        }
    }
    formatNumber(num) {
        if (this.showRarityGlow) {
            return String(Math.round(num));
        }
        if (num >= 1e12) {
            return (num / 1e12).toFixed(1) + 'T';
        }
        else if (num >= 1e9) {
            return (num / 1e9).toFixed(1) + 'B';
        }
        else if (num >= 1e6) {
            return (num / 1e6).toFixed(1) + 'M';
        }
        else if (num >= 1e3) {
            return (num / 1e3).toFixed(1) + 'K';
        }
        else {
            return String(Math.round(num));
        }
    }
    s(size) {
        return 1 * size;
    }
    drawFlower(center, eye) {
        this.ctx.lineCap = "round";
        this.ctx.lineWidth = this.s(1.7);
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, this.s(26.5), 0, Math.PI * 2, false);
        this.ctx.fillStyle = "#CFBB50";
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, this.s(23.5), 0, Math.PI * 2, false);
        this.ctx.fillStyle = "#FFE763";
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.moveTo(center.x - this.s(6), center.y + this.s(10));
        this.ctx.quadraticCurveTo(center.x, center.y + this.s(14.5), center.x + this.s(6), center.y + this.s(10));
        this.ctx.strokeStyle = "#000";
        this.ctx.fillStyle = "#000";
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.ellipse(center.x + this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.ellipse(center.x - this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.fill();
        this.ctx.clip();
        this.ctx.beginPath();
        this.ctx.fillStyle = "#fff";
        this.ctx.arc(center.x + this.s(7) + eye.x, center.y + eye.y - this.s(4.8), this.s(3), 0, Math.PI * 2, false);
        this.ctx.arc(center.x - this.s(7) + eye.x, center.y + eye.y - this.s(4.8), this.s(3), 0, Math.PI * 2, false);
        this.ctx.fill();
        this.ctx.lineWidth = this.s(1);
        this.ctx.beginPath();
        this.ctx.ellipse(center.x + this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.ellipse(center.x - this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.stroke();
    }
    drawPlayer(player, socket, petalExtension = 1.0, enemies = new Map()) {
        this.ctx.save();
        this.ctx.translate(player.x, player.y);
        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = 'red';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-constants_1.PLAYER_SIZE / 2, -constants_1.PLAYER_SIZE / 2, constants_1.PLAYER_SIZE, constants_1.PLAYER_SIZE);
            this.ctx.restore();
        }
        // Draw player name
        // Reset any effects that might interfere with text rendering
        this.ctx.globalAlpha = 1.0;
        this.ctx.shadowBlur = 0;
        this.ctx.shadowColor = 'transparent';
        this.ctx.fillStyle = 'black';
        this.ctx.textAlign = 'center';
        this.ctx.font = '14px Ubuntu, sans-serif';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(player.name || 'Unnamed', 0, -50);
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(player.name || 'Unnamed', 0, -50);
        // Apply invulnerability visual effect
        if (player.isInvulnerable) {
            const flashRate = 200; // Flash every 200ms
            const currentTime = this.frameTimestamp;
            const shouldFlash = Math.floor(currentTime / flashRate) % 2 === 0;
            if (shouldFlash) {
                this.ctx.globalAlpha = 0.3; // Make player semi-transparent when flashing
            }
            // Draw invulnerability glow effect
            this.ctx.shadowColor = '#FFFF00';
            this.ctx.shadowBlur = 15;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 0;
        }
        // Draw player sprite
        if (player.id === socket) {
            // Calculate target eye position
            const targetEye = {
                x: Math.cos(player.angle) * this.s(2),
                y: Math.sin(player.angle) * this.s(4.4)
            };
            // Smooth interpolation of eye position (lerp factor controls smoothness)
            const lerpFactor = 0.15; // Lower = smoother, higher = more responsive
            this.playerEye.x += (targetEye.x - this.playerEye.x) * lerpFactor;
            this.playerEye.y += (targetEye.y - this.playerEye.y) * lerpFactor;
            // Apply hue rotation for current player
            const offscreen = document.createElement('canvas');
            offscreen.width = this.playerSprite.width;
            offscreen.height = this.playerSprite.height;
            const offCtx = offscreen.getContext('2d');
            offCtx.drawImage(this.playerSprite, 0, 0);
            const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
            offCtx.putImageData(imageData, 0, 0);
            this.ctx.save(); // Save before flower drawing to contain the clip
            this.drawFlower(this.playerSprite, this.playerEye);
            this.ctx.restore(); // Restore after flower drawing to remove the clip
        }
        else {
            // For other players, use their own smooth eye interpolation
            if (!player.eye) {
                player.eye = { x: 0, y: 0 };
                player.targetEye = { x: 0, y: 0 };
            }
            // Calculate target eye position for this player
            player.targetEye = {
                x: Math.sin(player.angle) * this.s(2),
                y: Math.cos(player.angle) * this.s(-4.4)
            };
            // Smooth interpolation
            const lerpFactor = 0.15;
            player.eye.x += (player.targetEye.x - player.eye.x) * lerpFactor;
            player.eye.y += (player.targetEye.y - player.eye.y) * lerpFactor;
            this.ctx.save(); // Save before flower drawing to contain the clip
            this.drawFlower(this.playerSprite, player.eye);
            this.ctx.restore(); // Restore after flower drawing to remove the clip
        }
        // Reset effects after drawing
        if (player.isInvulnerable) {
            this.ctx.globalAlpha = 1.0;
            this.ctx.shadowBlur = 0;
        }
        // Draw petals around player (while still in player's transform context)
        // This ensures petals are positioned relative to the player
        this.drawPlayerPetals(player, petalExtension, enemies, socket);
        this.ctx.restore();
    }
    drawPlayerPetals(player, petalExtension = 1.0, enemies = new Map(), currentPlayerId) {
        // Safety check: ensure player loadout exists before filtering
        if (!player.loadout || !Array.isArray(player.loadout)) {
            return; // Skip drawing petals if loadout is not properly initialized
        }
        // IMPORTANT: This function is called from within drawPlayer(), which means:
        // - The context has: scale(zoomLevel), translate(-cameraX, -cameraY), translate(player.x, player.y)
        // - We need to draw petals relative to the player position (which is already translated)
        // - So we should use relative coordinates (0, 0 is player center) or translate from player position
        // Get all petals from player loadout and expand based on count property
        const petalInstances = [];
        try {
            player.loadout.forEach((item, loadoutIndex) => {
                if (item && item.type === 'petal' && item.petalType && item.rarity) {
                    const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
                    if (!stats)
                        return;
                    const count = stats.count || 1; // Use count from stats, default to 1
                    // Validate count is a valid number
                    if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                        console.warn('Invalid petal count:', count, 'for', item.petalType, item.rarity);
                        return;
                    }
                    // Create multiple instances based on count
                    for (let i = 0; i < count; i++) {
                        petalInstances.push({ petal: item, instanceIndex: i, loadoutIndex });
                    }
                }
            });
        }
        catch (error) {
            console.error('Error building petal instances:', error);
            return;
        }
        if (petalInstances.length === 0) {
            // Clean up physics states for this player if no petals
            const keysToDelete = [];
            this.petalPhysicsStates.forEach((value, key) => {
                if (key.startsWith(player.id)) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(key => this.petalPhysicsStates.delete(key));
            return;
        }
        const currentTime = Date.now();
        // Clean up physics states for petals that no longer exist in loadout
        const activePetalIds = new Set();
        petalInstances.forEach(({ loadoutIndex, instanceIndex }) => {
            activePetalIds.add(`${player.id}_${loadoutIndex}_${instanceIndex}`);
        });
        const keysToDelete = [];
        this.petalPhysicsStates.forEach((value, key) => {
            if (key.startsWith(player.id) && !activePetalIds.has(key)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => this.petalPhysicsStates.delete(key));
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = (Math.PI * 2) / petalInstances.length; // Evenly space petals
        // Calculate player range modifier from equipped petals
        let playerRangeModifier = 1.0;
        for (const item of player.loadout) {
            if (item && item.type === 'petal' && item.petalType && item.rarity) {
                const pStats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
                if (pStats?.playerModifiers?.range !== undefined) {
                    playerRangeModifier *= pStats.playerModifiers.range;
                }
            }
        }
        // Calculate deltaTime (approximate, using frame timing)
        // Use a default of 1/60 seconds (60 FPS) if we can't calculate it
        const lastFrameTime = this.lastFrameTime || currentTime;
        const deltaTime = Math.min((currentTime - lastFrameTime) / 1000, 1 / 30); // Cap at 30 FPS minimum
        this.lastFrameTime = currentTime;
        petalInstances.forEach(({ petal, instanceIndex, loadoutIndex }, index) => {
            if (!petal || !petal.petalType || !petal.rarity) {
                return;
            }
            const stats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
            if (!stats) {
                return;
            }
            // Skip drawing if petal is on cooldown
            if (petal.onCooldown) {
                return;
            }
            // Calculate rotation angle
            const rotationSpeed = (stats.speed ?? 1.0) * 0.002; // Convert to radians per ms
            const baseAngle = index * angleStep;
            const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
            // Fixed-direction petals don't orbit - they stay at a fixed relative position
            const totalAngle = stats.fixedDirection !== undefined ? baseAngle : baseAngle + rotationAngle;
            // Apply petal range multiplier and player range modifier to base radius
            const petalRange = (stats.range ?? 1.0) * playerRangeModifier;
            const petalRadius = baseRadius * petalRange;
            // Use server-provided petal positions if available (for all players)
            let petalX;
            let petalY;
            // Check if we have server-provided petal positions
            const serverPetalPos = player.petalPositions?.find((p) => p.loadoutIndex === loadoutIndex && p.instanceIndex === instanceIndex);
            if (stats.fixedDirection !== undefined) {
                // Fixed-direction petals stay directly on the player
                petalX = 0;
                petalY = 0;
            }
            else if (serverPetalPos) {
                // Use server-provided position (already interpolated on client)
                // Convert from world coordinates to relative coordinates for rendering
                petalX = serverPetalPos.x - player.x;
                petalY = serverPetalPos.y - player.y;
            }
            else {
                // Fallback: Calculate target orbit position if server positions not available yet
                // This can happen during initial load or if server hasn't sent positions yet
                const targetX = player.x + Math.cos(totalAngle) * petalRadius;
                const targetY = player.y + Math.sin(totalAngle) * petalRadius;
                petalX = targetX - player.x;
                petalY = targetY - player.y;
            }
            // Petal positions are now provided by the server and interpolated on the client
            // No client-side physics simulation needed
            // Draw petal - set up transforms first (same pattern as mobs)
            // Check for custom size first, then use base stats
            const effectiveSize = petal.customSize !== undefined ? petal.customSize : stats.size;
            const size = 12 * effectiveSize;
            const petalSize = size;
            // Save context state before drawing this petal
            // IMPORTANT: Each petal needs its own save/restore to prevent transform interference
            // At this point, the context has: scale(zoomLevel), translate(-cameraX, -cameraY), translate(player.x, player.y)
            // So (0, 0) is the player's center
            this.ctx.save();
            // Apply transforms for this specific petal
            // petalX and petalY are relative to player center (0, 0)
            // IMPORTANT: The order MUST be translate then rotate for rotation to happen around petal position
            // If we rotate first, it rotates around (0, 0) which is the player center
            // If we translate first, then rotate, it rotates around the petal position
            // Step 1: Translate to petal's orbital position (relative to player)
            this.ctx.translate(petalX, petalY);
            // Step 2: Rotate around the petal's position (which is now at origin after translate)
            // If fixedDirection is set, the petal always faces that angle instead of spinning
            if (stats.fixedDirection !== undefined) {
                this.ctx.rotate(stats.fixedDirection);
            }
            else {
                // IMPORTANT: Use only rotationAngle (not totalAngle) so the petal spins around its own center
                // totalAngle includes the orbital position, which would make it rotate around the player
                // rotationAngle is just the spinning motion, independent of orbital position
                this.ctx.rotate(rotationAngle + Math.PI / 2);
            }
            // Step 3: Apply visual offset shift if specified
            const vOffX = stats.visualOffsetX ?? 0;
            const vOffY = stats.visualOffsetY ?? 0;
            if (vOffX !== 0 || vOffY !== 0) {
                this.ctx.translate(vOffX, vOffY);
            }
            // Reset any global state that might interfere
            this.ctx.globalAlpha = 1.0;
            this.ctx.globalCompositeOperation = 'source-over';
            // Draw petal - the transforms are already applied (translate to petal position, then rotate)
            // Try to use cached SVG image
            const petalKey = `${petal.petalType}_${petal.rarity}`;
            const petalCanvas = this.getPetalCanvas(petalKey, this.frameTimestamp);
            if (petalCanvas && petalCanvas.width > 0 && petalCanvas.height > 0) {
                try {
                    // Use cached canvas image
                    // Draw centered at origin (which is now the petal position after translate)
                    this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                    // Add rarity glow effect (only when ALT key is held)
                    if (this.showRarityGlow) {
                        const glowColor = this.ITEM_RARITY_COLORS[petal.rarity] || stats.color;
                        this.ctx.save();
                        this.ctx.shadowColor = glowColor;
                        this.ctx.shadowBlur = 8;
                        for (let g = 0; g < 6; g++) {
                            this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                        }
                        this.ctx.restore();
                    }
                }
                catch (error) {
                    console.error(`[Graphics] Error drawing petal image for ${index}:`, error);
                }
            }
            else {
                // Fallback to colored circle if image not loaded
                const hue = (index * 40) % 360;
                const fallbackColor = `hsl(${hue}, 70%, 50%)`;
                this.ctx.fillStyle = fallbackColor;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            }
            // Always restore context state after drawing this petal
            // This restores to the state before this petal's save() (which should have player transform)
            this.ctx.restore();
            // Create particle effects for ultra, super, and unique petals
            // IMPORTANT: These effects should NOT modify the context state, as the next petal needs the same starting state
            if (['ultra', 'super', 'unique'].includes(petal.rarity)) {
                // Only create particles occasionally to avoid performance issues
                if (Math.random() < 0.1) { // 10% chance per frame
                    // Convert relative petal coordinates to absolute world coordinates
                    // petalX and petalY are relative to player center, so add player position
                    const worldX = player.x + petalX;
                    const worldY = player.y + petalY;
                    this.showPetalParticleEffect(worldX, worldY, petal.rarity);
                }
            }
        });
    }
    // Removed mobImageCache and loadSVGAsImage - mobs now use canvas rendering via svgRenderer
    // No data URLs are created for mob rendering
    drawMobProjectile(projectile, currentTime, petalStats) {
        if (!projectile || typeof projectile.x !== 'number' || typeof projectile.y !== 'number') {
            return;
        }
        // Get petal stats for rendering (use cached if provided)
        if (!petalStats) {
            petalStats = (0, petals_1.getPetalStats)(projectile.petalType, projectile.petalRarity);
            if (!petalStats) {
                return;
            }
        }
        // Fast path for gas projectiles - they're just simple green circles, no rotation needed
        if (projectile.petalType === 'gas' && projectile.petalRarity === 'common') {
            const petalSize = projectile.size * 20; // Use projectile's scaled size
            const radius = petalSize / 2;
            // Draw directly without transforms - much faster
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
            this.ctx.beginPath();
            this.ctx.arc(projectile.x, projectile.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }
        const petalSize = projectile.size * 20; // Use projectile's scaled size
        this.ctx.save();
        this.ctx.translate(projectile.x, projectile.y);
        this.ctx.rotate(projectile.angle);
        // Draw petal using the same method as player petals
        const petalKey = `${projectile.petalType}_${projectile.petalRarity}`;
        // Only pass time for animated petals - for static petals like gas, we can skip it
        // Check if petal is animated by checking if the cached image is an array
        const petalImage = this.petalImageCache[petalKey];
        const isAnimated = Array.isArray(petalImage);
        const petalCanvas = isAnimated && currentTime !== undefined
            ? this.getPetalCanvas(petalKey, currentTime)
            : this.getPetalCanvas(petalKey);
        if (petalCanvas && petalCanvas.width > 0 && petalCanvas.height > 0) {
            try {
                // Draw the petal canvas image centered at origin
                this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                // Add rarity glow effect for non-common projectiles
                if (projectile.petalRarity !== 'common') {
                    this.ctx.save();
                    this.ctx.shadowColor = petalStats.color;
                    this.ctx.shadowBlur = 5;
                    this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                    this.ctx.restore();
                }
            }
            catch (error) {
                console.error(`[Graphics] Error drawing projectile petal image:`, error);
                // Fallback to colored circle if image fails
                this.ctx.fillStyle = petalStats.color;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, petalSize / 2, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
        else {
            // Fallback to colored circle if petal canvas not available
            this.ctx.fillStyle = petalStats.color;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, petalSize / 2, 0, Math.PI * 2);
            this.ctx.fill();
            // Add a border for visibility
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }
        this.ctx.restore();
    }
    drawEnemy(enemy) {
        // Validate enemy has required properties
        if (!enemy || typeof enemy.x !== 'number' || typeof enemy.y !== 'number') {
            console.error('[Graphics] Invalid enemy data:', enemy);
            return;
        }
        // Check if enemy is in death animation (only if setting is enabled)
        const DEATH_ANIMATION_DURATION = 200; // 200ms animation
        let isDying = false;
        let deathProgress = 0;
        if (this.mobDeathAnimation && enemy.deathAnimationStartTime) {
            const elapsed = this.frameTimestamp - enemy.deathAnimationStartTime;
            if (elapsed < DEATH_ANIMATION_DURATION) {
                isDying = true;
                deathProgress = Math.min(1.0, elapsed / DEATH_ANIMATION_DURATION); // 0 to 1, clamped
            }
        }
        // Get enemy size from mob stats
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        // Use visual_scale for rendering (affects visual only, not hitbox)
        const baseSize = mobStats ? mobStats.size * 40 : 40;
        const visualScale = mobStats?.visual_scale ?? 1.0;
        let enemySize = baseSize * visualScale;
        // Apply death animation effects: scale up, fade out, red tint
        let deathScale = 1.0;
        let deathAlpha = 1.0;
        if (isDying) {
            // Scale up from 1.0 to 3.0 over the animation (much larger)
            deathScale = 1.0 + (deathProgress * 2.0);
            // Fade out more intensely using cubic ease-out curve
            const easeOutProgress = deathProgress * deathProgress * deathProgress; // Cubic ease-out (more intense)
            deathAlpha = 1.0 - easeOutProgress;
            // Apply scale to size
            enemySize *= deathScale;
        }
        // Always set up the transform for the enemy position
        // The context already has camera transforms applied, so we translate to world position
        this.ctx.save();
        this.ctx.translate(enemy.x, enemy.y);
        // Only apply rotation if hideRotation is not set
        if (!mobStats?.hideRotation) {
            this.ctx.rotate(enemy.angle || 0);
        }
        // Flip horizontally if reversed is true
        if (enemy.reversed || mobStats?.reversed) {
            this.ctx.scale(-1, 1);
        }
        // Apply death animation: transparency (before drawing, preserves transparency)
        if (isDying) {
            this.ctx.globalAlpha = deathAlpha;
        }
        // Special rendering for garbage mob - render as a pile of random petals
        if (enemy.type === 'garbage') {
            this.drawGarbagePile(enemy, enemySize);
            // Apply red tint overlay for death animation using composite operations
            if (isDying) {
                const tintIntensity = 0.15 + (deathProgress * 0.15);
                this.ctx.globalCompositeOperation = 'source-atop';
                this.ctx.fillStyle = `rgba(255, 0, 0, ${tintIntensity})`;
                this.ctx.fillRect(-enemySize / 2, -enemySize / 2, enemySize, enemySize);
                this.ctx.globalCompositeOperation = 'source-over';
            }
            this.ctx.restore();
            // Don't draw health bar during death animation
            if (!isDying) {
                // Draw health bar and tier (after restore, so we need to set up transforms again)
                this.drawEnemyHealthBar(enemy, enemySize);
            }
            return;
        }
        // Disable anti-aliasing for mobs (pixelated look)
        this.ctx.imageSmoothingEnabled = false;
        // Debug: Always draw something visible to verify coordinates work
        // This ensures we can see enemies even if images/sprites fail
        const cacheKey = `${enemy.type}_${enemy.tier}`;
        const mobSVG = this.mobSVGCache[cacheKey];
        // Use relative time for animation (wraps within animation cycle)
        // Per-mob cycle duration ensures animations loop seamlessly
        const frameTime = (0, constants_1.getMobAnimationFrameTime)();
        const framesPerCycle = this.svgRenderer.getFramesPerCycleForSVG(mobSVG);
        const animationCycleDuration = framesPerCycle * frameTime;
        let currentTime = this.frameTimestamp % animationCycleDuration;
        // If enemy is chasing, play animation 2x faster
        if (enemy.isChasing && enemy.isHostile) {
            // Multiply time by 2 to make animation play 2x faster
            currentTime = (currentTime * 2) % animationCycleDuration;
        }
        // Try to use WASM SVG renderer with animations first
        let rendered = false;
        // Check if WASM renderer is available and not in fallback mode
        // Note: We check isInitialized() but not isUsingFallback() because
        // the renderer might use WASM for animation even if image loading falls back
        if (mobSVG && this.svgRenderer.isInitialized()) {
            try {
                // Use SVG renderer to render animated SVG (synchronous - uses cached canvases)
                // x, y, rotation are 0 because transforms are already applied by the context
                // Pass true to indicate this is a mob render (disable anti-aliasing)
                rendered = this.svgRenderer.renderSVGToCanvas(this.ctx, mobSVG, 0, // x (already translated)
                0, // y (already translated)
                enemySize, enemySize, 0, // rotation (already rotated)
                currentTime, true // disableAntiAliasing flag
                );
                // Debug: Log when WASM rendering is attempted
            }
            catch (error) {
                console.error(`[Graphics] Error rendering enemy SVG with WASM for ${cacheKey}:`, error);
            }
        }
        // If WASM renderer didn't work, use sprite fallback (no data URLs)
        if (!rendered) {
            // Determine which sprite to use based on enemy type
            let sprite = null;
            if (enemy.type === 'octopus') {
                sprite = this.octopusSprite;
            }
            else if (enemy.type === 'fish' || enemy.type === 'shark') {
                sprite = this.fishSprite;
            }
            // For other types (bee, ladybug, soldier_ant), sprite will be null
            // Try to use sprite if available and loaded
            // Note: The scale(-1, 1) is already applied at the beginning if reversed is true
            if (sprite && sprite.complete && sprite.naturalWidth > 0 && sprite.naturalHeight > 0) {
                try {
                    this.ctx.drawImage(sprite, -enemySize / 2, -enemySize / 2, enemySize, enemySize);
                    rendered = true;
                }
                catch (error) {
                    // Sprite draw failed, fall through to circle
                }
            }
            // If nothing rendered yet, draw a colored circle as fallback
            // This should ALWAYS render something visible
            if (!rendered) {
                const tierColor = this.ENEMY_COLORS[enemy.tier] || '#ff0000';
                // Ensure we're in the right context state
                this.ctx.globalAlpha = 1.0;
                this.ctx.fillStyle = tierColor;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, enemySize / 2, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            }
            // No async loading - mobs use canvas rendering via svgRenderer (no data URLs)
        }
        // Draw hitbox if enabled (before restore, so it's in enemy's coordinate space)
        // Use baseSize for hitbox (actual collision size, not visual size)
        if (this.showHitboxes) {
            this.ctx.strokeStyle = this.ENEMY_COLORS[enemy.tier];
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.beginPath();
            this.ctx.arc(0, 0, baseSize / 2, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        // Apply red tint overlay for death animation using composite operations
        if (isDying) {
            const tintIntensity = 0.15 + (deathProgress * 0.15);
            this.ctx.globalCompositeOperation = 'source-atop';
            this.ctx.fillStyle = `rgba(255, 0, 0, ${tintIntensity})`;
            this.ctx.fillRect(-enemySize / 2, -enemySize / 2, enemySize, enemySize);
            this.ctx.globalCompositeOperation = 'source-over';
        }
        this.ctx.restore();
        // Don't draw health bar during death animation
        if (!isDying) {
            // Draw health bar and tier
            this.drawEnemyHealthBar(enemy, enemySize);
        }
    }
    getEligiblePetalTypes() {
        if (!this.cachedEligiblePetalTypes) {
            const allPetalTypes = (0, petals_1.getAllPetalTypes)();
            this.cachedEligiblePetalTypes = allPetalTypes.filter(petalType => {
                const stats = (0, petals_1.getPetalStats)(petalType, 'common');
                return stats && !stats.isAdminPetal && petalType !== 'cutter' && petalType !== 'lightning_cutter';
            });
        }
        return this.cachedEligiblePetalTypes;
    }
    drawGarbagePile(enemy, enemySize) {
        // Get base size for hitbox calculation
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const baseSize = mobStats ? mobStats.size * 40 : 40;
        // Use enemy position as seed for deterministic random petal selection
        const seed = Math.floor(enemy.x * 1000 + enemy.y * 1000);
        const eligiblePetalTypes = this.getEligiblePetalTypes();
        const numPetals = 5 + Math.floor((seed % 5)); // 5-9 petals
        // Disable anti-aliasing for pixelated look
        this.ctx.imageSmoothingEnabled = false;
        // Draw multiple petals in a pile formation
        for (let i = 0; i < numPetals; i++) {
            // Use seeded random for consistent petal selection per garbage mob
            const petalSeed = (seed + i * 1000) % 1000000;
            const randomValue = (petalSeed / 1000000);
            const petalType = eligiblePetalTypes[Math.floor(randomValue * eligiblePetalTypes.length)];
            const rarity = 'common'; // Use common rarity for garbage pile
            const stats = (0, petals_1.getPetalStats)(petalType, rarity);
            if (!stats)
                continue;
            // Calculate position in pile - spread out to fill the hitbox
            const angle = (i / numPetals) * Math.PI * 2;
            // Use larger radius to fill the hitbox area (baseSize is the hitbox diameter)
            const maxRadius = (baseSize / 2) * 0.8; // 80% of hitbox radius
            const radiusVariation = (petalSeed % 300) / 1000; // 0-0.3 variation
            const radius = maxRadius * (0.7 + radiusVariation); // 70-100% of max radius
            const petalX = Math.cos(angle) * radius;
            const petalY = Math.sin(angle) * radius + ((i % 3) * 3); // Slight stacking
            // Random rotation for each petal
            const rotation = (petalSeed % 360) * (Math.PI / 180);
            // Draw petal - make it large enough to fill the hitbox
            this.ctx.save();
            this.ctx.translate(petalX, petalY);
            this.ctx.rotate(rotation);
            // Make petals large - use baseSize to ensure they fill the hitbox
            // Each petal should be about 60-80% of the hitbox diameter
            const petalBaseSize = baseSize * (0.6 + (petalSeed % 200) / 1000); // 60-80% of hitbox
            const size = petalBaseSize * stats.size;
            const petalKey = `${petalType}_${rarity}`;
            const petalCanvas = this.getPetalCanvas(petalKey, this.frameTimestamp);
            if (petalCanvas) {
                this.ctx.drawImage(petalCanvas, -size / 2, -size / 2, size, size);
            }
            else {
                // Fallback to colored circle
                this.ctx.fillStyle = stats.color;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            }
            this.ctx.restore();
        }
        // Draw hitbox if enabled
        if (this.showHitboxes) {
            const baseSize = enemySize;
            this.ctx.strokeStyle = this.ENEMY_COLORS[enemy.tier];
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0;
            this.ctx.shadowBlur = 0;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, baseSize / 2, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }
    /**
     * Draw health bar and tier for an enemy
     */
    drawEnemyHealthBar(enemy, enemySize) {
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const mobName = mobStats ? mobStats.name : `${enemy.tier} ${enemy.type}`;
        this.ctx.save();
        this.ctx.translate(enemy.x, enemy.y);
        const minHealthBarWidth = 60; // Minimum size: common hornet (size 1.0 * 40 * visual_scale 1.5)
        const healthBarWidth = Math.max(enemySize, minHealthBarWidth);
        const healthBarHeight = 8;
        const healthBarY = enemySize / 2 + 8;
        const radius = healthBarHeight / 2;
        // Draw mob name above health bar, left-aligned
        this.ctx.textAlign = 'left';
        this.ctx.font = '12px Ubuntu, sans-serif';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        const nameX = -healthBarWidth / 2;
        const nameY = healthBarY - 4;
        this.ctx.strokeText(mobName, nameX, nameY);
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(mobName, nameX, nameY);
        // Health bar background (rounded)
        this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
        this.ctx.beginPath();
        this.ctx.roundRect(-healthBarWidth / 2 - 1, healthBarY - 1, healthBarWidth + 2, healthBarHeight + 2, radius);
        this.ctx.fill();
        // Health bar fill (rounded) - same green as player health bar
        const clampedHealth = Math.max(0, Math.min(enemy.health, enemy.maxHealth));
        const healthFillWidth = (clampedHealth / enemy.maxHealth) * healthBarWidth;
        this.ctx.fillStyle = '#73ff54';
        this.ctx.beginPath();
        this.ctx.roundRect(-healthBarWidth / 2, healthBarY, healthFillWidth, healthBarHeight, radius);
        this.ctx.fill();
        // Draw rarity below the health bar at bottom right
        this.ctx.textAlign = 'right';
        this.ctx.fillStyle = this.ENEMY_COLORS[enemy.tier];
        this.ctx.font = '10px Ubuntu, sans-serif';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        const tierX = healthBarWidth / 2;
        const tierY = healthBarY + healthBarHeight + 12;
        const tierLabel = enemy.tier.charAt(0).toUpperCase() + enemy.tier.slice(1);
        this.ctx.strokeText(tierLabel, tierX, tierY);
        this.ctx.fillText(tierLabel, tierX, tierY);
        // Draw DPS for target dummies
        if (enemy.type === 'target_dummy' && enemy.currentDPS !== undefined) {
            const dps = enemy.currentDPS || 0;
            const formattedDPS = this.formatNumber(dps);
            const dpsText = `DPS: ${formattedDPS}`;
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '10px Ubuntu, sans-serif';
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            const dpsY = tierY + 14;
            this.ctx.strokeText(dpsText, tierX, dpsY);
            this.ctx.fillText(dpsText, tierX, dpsY);
        }
        this.ctx.restore();
    }
    /**
     * Darken a hex color by a specified percentage
     * @param hex - Hex color string (e.g., '#7eef6d')
     * @param percent - Percentage to darken (0-100, default 30)
     * @returns Darkened hex color string
     */
    darkenColor(hex, percent = 30) {
        // Remove # if present
        const num = parseInt(hex.replace('#', ''), 16);
        // Extract RGB components
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        // Darken each component
        const factor = 1 - (percent / 100);
        const newR = Math.round(r * factor);
        const newG = Math.round(g * factor);
        const newB = Math.round(b * factor);
        // Convert back to hex
        return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
    }
    drawItem(item) {
        this.ctx.save();
        this.ctx.translate(item.x, item.y);
        // Draw item rarity glow
        if (item.rarity) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.roundRect(-25, -25, 50, 50, 5);
            this.ctx.lineWidth = 3;
            this.ctx.strokeStyle = this.darkenColor(this.ITEM_RARITY_COLORS[item.rarity], 30);
            this.ctx.stroke();
            this.ctx.fillStyle = `${this.ITEM_RARITY_COLORS[item.rarity]}`;
            this.ctx.fill();
            this.ctx.restore();
        }
        // Handle different item types
        if (item.type === 'petal') {
            // Draw petal procedurally
            this.drawWorldPetal(item);
        }
        else {
            // Draw other items with sprites
            const sprite = this.itemSprites[item.type];
            if (sprite) {
                this.ctx.drawImage(sprite, -15, -15, 30, 30);
            }
        }
        // Draw item name
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px Ubuntu, sans-serif';
        this.ctx.textAlign = 'center';
        let itemName = "";
        if (item.type === 'petal' && item.petalType) {
            itemName = item.petalType[0].toUpperCase() + item.petalType.slice(1).toLowerCase() || "";
        }
        else {
            itemName = item.type[0].toUpperCase() + item.type.slice(1).toLowerCase();
        }
        itemName = itemName.replace('_', ' ');
        // Ensure item name is not blurred by setting shadow blur to 0
        this.ctx.shadowBlur = 0;
        this.ctx.globalAlpha = 1.0;
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(itemName, 0, 20);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText(itemName, 0, 20);
        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = 'yellow';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-15, -15, 30, 30);
            this.ctx.restore();
        }
        this.ctx.restore();
    }
    drawWorldPetal(item) {
        if (!item.petalType || !item.rarity)
            return;
        const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
        if (!stats)
            return;
        // Draw petal using cached image
        const size = 12 * stats.size;
        const petalKey = `${item.petalType}_${item.rarity}`;
        const petalCanvas = this.getPetalCanvas(petalKey, this.frameTimestamp);
        if (petalCanvas) {
            // Use consistent scaling to maintain aspect ratio
            const petalSize = size;
            this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
            // Add rarity glow effect
            if (item.rarity !== 'common') {
                this.ctx.shadowColor = stats.color;
                this.ctx.shadowBlur = 5;
                this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
            }
        }
        else {
            // Fallback to colored circle if image not loaded
            this.ctx.fillStyle = stats.color;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        }
        // Create particle effects for ultra, super, and unique world petals
        if (['ultra', 'super', 'unique'].includes(item.rarity)) {
            // Only create particles occasionally to avoid performance issues
            if (Math.random() < 0.05) { // 5% chance per frame for world petals
                this.showPetalParticleEffect(item.x, item.y, item.rarity);
            }
        }
    }
    drawFloatingTexts() {
        this.floatingTexts = this.floatingTexts.filter(text => {
            text.y -= 1;
            text.alpha -= 1 / text.lifetime;
            if (text.alpha <= 0)
                return false;
            this.ctx.save();
            // Apply camera transform to convert world coordinates to screen coordinates
            this.ctx.scale(this.zoomLevel, this.zoomLevel);
            const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
            const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;
            this.ctx.translate(-validCameraX, -validCameraY);
            this.ctx.globalAlpha = text.alpha;
            this.ctx.fillStyle = text.color;
            this.ctx.font = `${text.fontSize}px Ubuntu, sans-serif`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText(text.text, text.x, text.y);
            this.ctx.restore();
            return true;
        });
    }
    drawExplosionEffects() {
        this.explosionEffects = this.explosionEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            if (progress >= 1)
                return false;
            this.ctx.save();
            this.ctx.globalAlpha = effect.alpha * (1 - progress);
            // Draw expanding circle
            const currentRadius = effect.radius * progress;
            this.ctx.strokeStyle = '#FF4500';
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(effect.x, effect.y, currentRadius, 0, Math.PI * 2);
            this.ctx.stroke();
            // Draw inner circle
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(effect.x, effect.y, currentRadius * 0.5, 0, Math.PI * 2);
            this.ctx.stroke();
            // Draw particles
            effect.particles = effect.particles.filter(particle => {
                const particleProgress = particle.life / particle.maxLife;
                if (particleProgress <= 0)
                    return false;
                // Update particle position
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.life -= 16; // Assuming 60fps, reduce by ~16ms per frame
                // Draw particle
                this.ctx.globalAlpha = particleProgress * effect.alpha;
                this.ctx.fillStyle = particle.color;
                this.ctx.beginPath();
                this.ctx.arc(particle.x, particle.y, particle.size * particleProgress, 0, Math.PI * 2);
                this.ctx.fill();
                return true;
            });
            this.ctx.restore();
            return true;
        });
    }
    drawPetalBreakEffects() {
        this.petalBreakEffects = this.petalBreakEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            if (progress >= 1)
                return false;
            this.ctx.save();
            this.ctx.globalAlpha = effect.alpha * (1 - progress);
            // Draw petal fragments
            const fragmentCount = 6;
            for (let i = 0; i < fragmentCount; i++) {
                const angle = (i / fragmentCount) * Math.PI * 2;
                const distance = progress * 30;
                const fragmentX = effect.x + Math.cos(angle) * distance;
                const fragmentY = effect.y + Math.sin(angle) * distance;
                this.ctx.fillStyle = '#FF69B4';
                this.ctx.beginPath();
                this.ctx.arc(fragmentX, fragmentY, 3, 0, Math.PI * 2);
                this.ctx.fill();
            }
            this.ctx.restore();
            return true;
        });
    }
    drawLightningEffects() {
        this.lightningEffects = this.lightningEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            if (progress >= 1)
                return false;
            this.ctx.save();
            this.ctx.globalAlpha = effect.alpha * (1 - progress);
            // Draw lightning bolts as white lines between targets
            this.ctx.strokeStyle = '#FFFFFF';
            this.ctx.lineWidth = 2;
            this.ctx.lineCap = 'round';
            // Draw lines from origin to each target
            effect.targets.forEach(target => {
                this.ctx.beginPath();
                this.ctx.moveTo(effect.x, effect.y);
                this.ctx.lineTo(target.x, target.y);
                this.ctx.stroke();
            });
            // Draw lines between targets to create a web effect
            for (let i = 0; i < effect.targets.length; i++) {
                for (let j = i + 1; j < effect.targets.length; j++) {
                    const target1 = effect.targets[i];
                    const target2 = effect.targets[j];
                    this.ctx.beginPath();
                    this.ctx.moveTo(target1.x, target1.y);
                    this.ctx.lineTo(target2.x, target2.y);
                    this.ctx.stroke();
                }
            }
            // Draw bright center point
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.beginPath();
            this.ctx.arc(effect.x, effect.y, 5, 0, Math.PI * 2);
            this.ctx.fill();
            // Draw target points
            effect.targets.forEach(target => {
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.beginPath();
                this.ctx.arc(target.x, target.y, 3, 0, Math.PI * 2);
                this.ctx.fill();
            });
            this.ctx.restore();
            return true;
        });
    }
    drawPetalParticleEffects() {
        this.petalParticleEffects = this.petalParticleEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            if (progress >= 1)
                return false;
            this.ctx.save();
            // Draw particles
            effect.particles = effect.particles.filter(particle => {
                const particleProgress = particle.life / particle.maxLife;
                if (particleProgress <= 0)
                    return false;
                // Update particle position
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.life -= 16; // Assuming 60fps, reduce by ~16ms per frame
                // Draw particle with white base color and faint rarity tinting
                this.ctx.globalAlpha = particleProgress * 0.6; // More visible particles
                // Create a gradient from white base to rarity color
                const gradient = this.ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.size);
                gradient.addColorStop(0, particle.baseColor); // White center
                gradient.addColorStop(0.7, particle.baseColor); // Mostly white
                gradient.addColorStop(1, particle.color); // Faint rarity color at edges
                this.ctx.fillStyle = gradient;
                this.ctx.beginPath();
                this.ctx.arc(particle.x, particle.y, particle.size * particleProgress, 0, Math.PI * 2);
                this.ctx.fill();
                return true;
            });
            this.ctx.restore();
            return true;
        });
    }
    drawFallingStars() {
        this.fallingStars = this.fallingStars.filter(star => {
            // Update position
            star.y += star.vy;
            star.rotation += star.rotationSpeed;
            // Update lifetime
            star.lifetime -= 16; // Assuming ~60fps
            const progress = star.lifetime / star.maxLife;
            // Remove if off screen or lifetime expired
            if (star.y > this.canvas.height + 50 || progress <= 0) {
                return false;
            }
            // Draw star (in screen coordinates)
            this.ctx.save();
            this.ctx.globalAlpha = star.alpha * progress;
            this.ctx.translate(star.x, star.y);
            this.ctx.rotate(star.rotation);
            // Draw a star shape
            this.ctx.fillStyle = '#ffd700';
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 1;
            const points = 5;
            const outerRadius = star.size / 2;
            const innerRadius = outerRadius * 0.4;
            this.ctx.beginPath();
            for (let i = 0; i < points * 2; i++) {
                const angle = (i * Math.PI) / points - Math.PI / 2;
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                if (i === 0) {
                    this.ctx.moveTo(x, y);
                }
                else {
                    this.ctx.lineTo(x, y);
                }
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
            this.ctx.restore();
            return true;
        });
    }
    // Minimap scrolling methods (disabled - minimap now auto-follows player's section)
    scrollMinimap(deltaX, deltaY) {
        // Minimap scrolling is disabled - it automatically shows the current 9th section
        // This method is kept for backward compatibility but does nothing
    }
    setMinimapScroll(x, y) {
        // Clamp to section boundaries (each section is 20000x20000)
        const SECTION_SIZE = 20000;
        const sectionX = Math.floor(x / SECTION_SIZE);
        const sectionY = Math.floor(y / SECTION_SIZE);
        // Clamp to valid sections (0-2 for both X and Y)
        const clampedSectionX = Math.max(0, Math.min(2, sectionX));
        const clampedSectionY = Math.max(0, Math.min(2, sectionY));
        // Set scroll to the start of the clamped section
        this.minimapScrollX = clampedSectionX * SECTION_SIZE;
        this.minimapScrollY = clampedSectionY * SECTION_SIZE;
    }
    centerMinimapOnPlayer(playerX, playerY) {
        // Use the followPlayerOnMinimap method which handles 9-section division
        this.followPlayerOnMinimap(playerX, playerY);
    }
    zoomInMinimap() {
        this.minimapZoom = Math.min(this.minimapZoom + this.MINIMAP_ZOOM_STEP, this.MINIMAP_MAX_ZOOM);
    }
    zoomOutMinimap() {
        this.minimapZoom = Math.max(this.minimapZoom - this.MINIMAP_ZOOM_STEP, this.MINIMAP_MIN_ZOOM);
    }
    setMinimapZoom(zoom) {
        this.minimapZoom = Math.max(this.MINIMAP_MIN_ZOOM, Math.min(this.MINIMAP_MAX_ZOOM, zoom));
    }
    getMinimapZoom() {
        return this.minimapZoom;
    }
    followPlayerOnMinimap(playerX, playerY) {
        // Automatically show the 9th section the player is in (3x3 grid, each section is 20000x20000)
        const SECTION_SIZE = 20000;
        const sectionX = Math.floor(playerX / SECTION_SIZE);
        const sectionY = Math.floor(playerY / SECTION_SIZE);
        // Clamp to valid sections (0-2 for both X and Y)
        const clampedSectionX = Math.max(0, Math.min(2, sectionX));
        const clampedSectionY = Math.max(0, Math.min(2, sectionY));
        // Set minimap to show this section (centered)
        const sectionCenterX = clampedSectionX * SECTION_SIZE + SECTION_SIZE / 2;
        const sectionCenterY = clampedSectionY * SECTION_SIZE + SECTION_SIZE / 2;
        this.setMinimapScroll(sectionCenterX - SECTION_SIZE / 2, sectionCenterY - SECTION_SIZE / 2);
    }
    // Add minimap drawing
    drawMinimap(players, socket) {
        const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
        const minimapY = this.MINIMAP_PADDING;
        // Always show exactly one section (20000x20000) - no zoom
        const MINIMAP_AREA_SIZE = 20000;
        const minimapScale = {
            x: this.MINIMAP_WIDTH / MINIMAP_AREA_SIZE,
            y: this.MINIMAP_HEIGHT / MINIMAP_AREA_SIZE
        };
        // Draw minimap background (white instead of black)
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.fillRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
        // Set up clipping region for minimap to prevent drawing outside bounds
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
        this.ctx.clip();
        // Draw spawn zones on minimap when ALT is held (below walls/water)
        if (this.showRarityGlow) {
            const minimapSpawnColors = {
                common: 'rgba(126, 239, 109, 0.4)',
                uncommon: 'rgba(255, 230, 93, 0.4)',
                rare: 'rgba(77, 82, 227, 0.4)',
                epic: 'rgba(134, 31, 222, 0.4)',
                legendary: 'rgba(222, 31, 31, 0.4)',
                mythic: 'rgba(31, 219, 222, 0.4)',
                ultra: 'rgba(222, 31, 101, 0.4)',
                super: 'rgba(43, 255, 164, 0.4)',
                unique: 'rgba(191, 0, 255, 0.4)'
            };
            this.mapData.forEach(element => {
                if (element.type !== 'spawn')
                    return;
                const scaledX = minimapX + ((element.x - this.minimapScrollX) * minimapScale.x);
                const scaledY = minimapY + ((element.y - this.minimapScrollY) * minimapScale.y);
                const scaledWidth = element.width * minimapScale.x;
                const scaledHeight = element.height * minimapScale.y;
                if (scaledX + scaledWidth > minimapX && scaledX < minimapX + this.MINIMAP_WIDTH &&
                    scaledY + scaledHeight > minimapY && scaledY < minimapY + this.MINIMAP_HEIGHT) {
                    const spawnType = element.properties?.spawnType || 'common';
                    this.ctx.fillStyle = minimapSpawnColors[spawnType] || minimapSpawnColors.common;
                    this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                }
            });
        }
        // Draw wall grid tiles on minimap
        const SECTION_SIZE = 20000;
        const sectionX = Math.floor(this.minimapScrollX / SECTION_SIZE);
        const sectionY = Math.floor(this.minimapScrollY / SECTION_SIZE);
        const minTileX = Math.max(0, (0, constants_1.worldToTileX)(sectionX * SECTION_SIZE));
        const maxTileX = Math.min(constants_1.WALL_GRID_WIDTH - 1, (0, constants_1.worldToTileX)((sectionX + 1) * SECTION_SIZE));
        const minTileY = Math.max(0, (0, constants_1.worldToTileY)(sectionY * SECTION_SIZE));
        const maxTileY = Math.min(constants_1.WALL_GRID_HEIGHT - 1, (0, constants_1.worldToTileY)((sectionY + 1) * SECTION_SIZE));
        for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
            for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
                const state = (0, constants_1.getTileState)(constants_1.WALL_GRID, (0, constants_1.tileToWorldX)(tileX), (0, constants_1.tileToWorldY)(tileY));
                if (state === 0)
                    continue; // Skip air tiles
                const worldX = (0, constants_1.tileToWorldX)(tileX);
                const worldY = (0, constants_1.tileToWorldY)(tileY);
                const scaledX = minimapX + ((worldX - this.minimapScrollX) * minimapScale.x);
                const scaledY = minimapY + ((worldY - this.minimapScrollY) * minimapScale.y);
                const tileSize = constants_1.WALL_TILE_SIZE * minimapScale.x;
                if (state === 1) {
                    this.ctx.fillStyle = '#000000'; // Black for walls
                }
                else if (state === 2) {
                    this.ctx.fillStyle = '#4169E1'; // Blue for water
                }
                this.ctx.fillRect(scaledX, scaledY, tileSize, tileSize);
            }
        }
        // Draw map elements (spawn, biome, teleporter, safe_zone) on minimap
        this.mapData.forEach(element => {
            const scaledX = minimapX + ((element.x - this.minimapScrollX) * minimapScale.x);
            const scaledY = minimapY + ((element.y - this.minimapScrollY) * minimapScale.y);
            const scaledWidth = element.width * minimapScale.x;
            const scaledHeight = element.height * minimapScale.y;
            // Only draw if the element is within the visible minimap area
            if (scaledX + scaledWidth > minimapX && scaledX < minimapX + this.MINIMAP_WIDTH &&
                scaledY + scaledHeight > minimapY && scaledY < minimapY + this.MINIMAP_HEIGHT) {
                if (element.type === 'teleporter') {
                    this.ctx.fillStyle = element.properties?.teleportTo?.serverPort ? '#FFD700' : '#2196F3'; // Gold for cross-server, blue for same-server
                }
                else if (element.type === 'safe_zone') {
                    this.ctx.fillStyle = '#FFC107'; // Yellow for safe zone
                }
                else {
                    return; // Skip unknown types
                }
                this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
            }
        });
        // Draw all players on minimap with solid colors (with scroll offset)
        players.forEach(player => {
            const playerMinimapX = minimapX + ((player.x - this.minimapScrollX) * minimapScale.x);
            const playerMinimapY = minimapY + ((player.y - this.minimapScrollY) * minimapScale.y);
            // Only draw if player is within the visible minimap area
            if (playerMinimapX > minimapX && playerMinimapX < minimapX + this.MINIMAP_WIDTH &&
                playerMinimapY > minimapY && playerMinimapY < minimapY + this.MINIMAP_HEIGHT) {
                this.ctx.fillStyle = player.id === socket ? '#FF0000' : '#000000'; // Red for current player, black for others
                this.ctx.beginPath();
                this.ctx.arc(playerMinimapX, playerMinimapY, 4, // Slightly larger dots
                0, Math.PI * 2);
                this.ctx.fill();
            }
        });
        // Draw viewport rectangle in black (with scroll offset)
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX + ((this.cameraX - this.minimapScrollX) * minimapScale.x), minimapY + ((this.cameraY - this.minimapScrollY) * minimapScale.y), (this.canvas.width / this.zoomLevel) * minimapScale.x, (this.canvas.height / this.zoomLevel) * minimapScale.y);
        // Restore context to remove clipping region
        this.ctx.restore();
        // Draw section boundary (the minimap shows exactly one section)
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
        // Get section config for custom name
        const sectionIndex = sectionY * 3 + sectionX;
        const sectionConfig = constants_1.SECTION_CONFIGS[sectionIndex];
        const sectionName = sectionConfig?.name || `Section ${sectionIndex + 1}`;
        // Draw section title below the minimap using level bar font (Ubuntu)
        this.ctx.font = '14px Ubuntu, sans-serif';
        this.ctx.textAlign = 'center';
        // Draw text with black outline like the level bar
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(sectionName, minimapX + this.MINIMAP_WIDTH / 2, minimapY + this.MINIMAP_HEIGHT + 18);
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(sectionName, minimapX + this.MINIMAP_WIDTH / 2, minimapY + this.MINIMAP_HEIGHT + 18);
        this.ctx.textAlign = 'left';
    }
    drawScrollingBackground() {
        // If background texture is not loaded or is broken, just fill with section colors/textures
        if (!this.backgroundTexture || !this.backgroundTexture.complete || this.backgroundTexture.naturalWidth === 0) {
            const SECTION_SIZE = 20000;
            // Calculate visible area and clamp to world boundaries
            const visibleWidth = this.canvas.width / this.zoomLevel;
            const visibleHeight = this.canvas.height / this.zoomLevel;
            // Draw each visible section with its background color or texture
            const startSectionX = Math.max(0, Math.floor(this.cameraX / SECTION_SIZE));
            const startSectionY = Math.max(0, Math.floor(this.cameraY / SECTION_SIZE));
            const endSectionX = Math.min(2, Math.floor((this.cameraX + visibleWidth) / SECTION_SIZE));
            const endSectionY = Math.min(2, Math.floor((this.cameraY + visibleHeight) / SECTION_SIZE));
            for (let sy = startSectionY; sy <= endSectionY; sy++) {
                for (let sx = startSectionX; sx <= endSectionX; sx++) {
                    const sectionIndex = sy * 3 + sx;
                    const sectionConfig = constants_1.SECTION_CONFIGS[sectionIndex];
                    const sectionTexture = this.sectionTextures.get(sectionIndex);
                    const sectionStartX = sx * SECTION_SIZE;
                    const sectionStartY = sy * SECTION_SIZE;
                    const sectionEndX = (sx + 1) * SECTION_SIZE;
                    const sectionEndY = (sy + 1) * SECTION_SIZE;
                    // Clamp to visible area
                    const fillX = Math.max(sectionStartX, this.cameraX);
                    const fillY = Math.max(sectionStartY, this.cameraY);
                    const fillEndX = Math.min(sectionEndX, this.cameraX + visibleWidth, constants_1.ACTUAL_WORLD_WIDTH);
                    const fillEndY = Math.min(sectionEndY, this.cameraY + visibleHeight, constants_1.ACTUAL_WORLD_HEIGHT);
                    const fillWidth = fillEndX - fillX;
                    const fillHeight = fillEndY - fillY;
                    if (fillWidth > 0 && fillHeight > 0) {
                        // Check if section has a loaded texture
                        if (sectionTexture && sectionTexture.complete && sectionTexture.naturalWidth > 0) {
                            // Tile the section texture
                            const texWidth = sectionTexture.width;
                            const texHeight = sectionTexture.height;
                            const startTileX = Math.floor(fillX / texWidth) * texWidth;
                            const startTileY = Math.floor(fillY / texHeight) * texHeight;
                            for (let ty = startTileY; ty < fillEndY; ty += texHeight) {
                                for (let tx = startTileX; tx < fillEndX; tx += texWidth) {
                                    this.ctx.drawImage(sectionTexture, tx, ty, texWidth, texHeight);
                                }
                            }
                        }
                        else {
                            // Use solid color (or default if background is a path that hasn't loaded)
                            const background = sectionConfig?.background;
                            if (background && background.startsWith('#')) {
                                this.ctx.fillStyle = background;
                            }
                            else {
                                this.ctx.fillStyle = '#00d885'; // Default color
                            }
                            this.ctx.fillRect(fillX, fillY, fillWidth, fillHeight);
                        }
                    }
                }
            }
            return;
        }
        // Calculate the visible area in world coordinates
        const visibleWidth = this.canvas.width / this.zoomLevel;
        const visibleHeight = this.canvas.height / this.zoomLevel;
        // Get the size of the background texture (400x400 from the SVG)
        const defaultBgWidth = this.backgroundTexture.width;
        const defaultBgHeight = this.backgroundTexture.height;
        // Calculate the starting position for tiling (offset by camera position)
        const startX = Math.floor(this.cameraX / defaultBgWidth) * defaultBgWidth;
        const startY = Math.floor(this.cameraY / defaultBgHeight) * defaultBgHeight;
        // Calculate how many tiles we need to draw
        const tilesX = Math.ceil(visibleWidth / defaultBgWidth) + 1;
        const tilesY = Math.ceil(visibleHeight / defaultBgHeight) + 1;
        // Draw the tiled background, but only within world boundaries
        // Use integer coordinates to avoid sub-pixel rendering gaps
        for (let i = 0; i <= tilesX; i++) {
            for (let j = 0; j <= tilesY; j++) {
                const tileX = Math.floor(startX + (i * defaultBgWidth));
                const tileY = Math.floor(startY + (j * defaultBgHeight));
                // Check if tile is within world boundaries
                // Only draw if tile overlaps with world bounds (0 to ACTUAL_WORLD_WIDTH/HEIGHT)
                const tileRight = tileX + defaultBgWidth;
                const tileBottom = tileY + defaultBgHeight;
                // Check if tile is completely outside world boundaries
                const isCompletelyOutOfBounds = tileRight <= 0 || tileX >= constants_1.ACTUAL_WORLD_WIDTH ||
                    tileBottom <= 0 || tileY >= constants_1.ACTUAL_WORLD_HEIGHT;
                // If dynamic skybox is enabled and tile is out of bounds, use closest edge texture
                if (isCompletelyOutOfBounds) {
                    if (this.dynamicSkybox) {
                        // Get the center of the tile to find closest edge
                        const tileCenterX = tileX + defaultBgWidth / 2;
                        const tileCenterY = tileY + defaultBgHeight / 2;
                        const edgeTexture = this.getClosestEdgeTexture(tileCenterX, tileCenterY);
                        if (edgeTexture.texture && edgeTexture.texture.complete && edgeTexture.texture.naturalWidth > 0) {
                            const TILE_OVERLAP = 2;
                            const textureWidth = edgeTexture.texture.width;
                            const textureHeight = edgeTexture.texture.height;
                            const scaledWidth = textureWidth + TILE_OVERLAP;
                            const scaledHeight = textureHeight + TILE_OVERLAP;
                            const adjustedTileX = tileX - TILE_OVERLAP / 2;
                            const adjustedTileY = tileY - TILE_OVERLAP / 2;
                            // Draw the edge texture tiled
                            this.ctx.drawImage(edgeTexture.texture, adjustedTileX, adjustedTileY, scaledWidth, scaledHeight);
                        }
                    }
                    // Skip tiles that are completely outside world boundaries (when dynamic skybox is off)
                    continue;
                }
                // Scale each tile up by 2 pixels to prevent rendering artifacts and gaps
                const TILE_OVERLAP = 2;
                const scaledWidth = defaultBgWidth + TILE_OVERLAP;
                const scaledHeight = defaultBgHeight + TILE_OVERLAP;
                // Adjust position to center the overlap (draw 1 pixel to the left and top)
                const adjustedTileX = tileX - TILE_OVERLAP / 2;
                const adjustedTileY = tileY - TILE_OVERLAP / 2;
                const adjustedTileRight = adjustedTileX + scaledWidth;
                const adjustedTileBottom = adjustedTileY + scaledHeight;
                // Check if tile needs clamping to world boundaries
                const needsClamping = adjustedTileX < 0 || adjustedTileY < 0 ||
                    adjustedTileRight > constants_1.ACTUAL_WORLD_WIDTH ||
                    adjustedTileBottom > constants_1.ACTUAL_WORLD_HEIGHT;
                // Check if this tile overlaps with any biome
                const biome = this.getBiomeAtPosition(tileX + defaultBgWidth / 2, tileY + defaultBgHeight / 2);
                if (needsClamping) {
                    // Clamp tile position and size to world boundaries
                    let drawX = Math.floor(Math.max(0, adjustedTileX));
                    let drawY = Math.floor(Math.max(0, adjustedTileY));
                    let drawWidth = scaledWidth;
                    let drawHeight = scaledHeight;
                    let sourceX = 0;
                    let sourceY = 0;
                    // Clamp to left boundary
                    if (adjustedTileX < 0) {
                        sourceX = Math.floor(-adjustedTileX);
                        drawWidth -= sourceX;
                        drawX = 0;
                    }
                    // Clamp to top boundary
                    if (adjustedTileY < 0) {
                        sourceY = Math.floor(-adjustedTileY);
                        drawHeight -= sourceY;
                        drawY = 0;
                    }
                    // Clamp to right boundary
                    if (adjustedTileRight > constants_1.ACTUAL_WORLD_WIDTH) {
                        drawWidth = Math.floor(constants_1.ACTUAL_WORLD_WIDTH - drawX);
                    }
                    // Clamp to bottom boundary
                    if (adjustedTileBottom > constants_1.ACTUAL_WORLD_HEIGHT) {
                        drawHeight = Math.floor(constants_1.ACTUAL_WORLD_HEIGHT - drawY);
                    }
                    // Skip if dimensions are invalid
                    if (drawWidth <= 0 || drawHeight <= 0) {
                        continue;
                    }
                    // Use 9-parameter drawImage for clipped tiles
                    if (biome && biome.properties?.biomeName && biome.properties?.backgroundTexture) {
                        const biomeTexture = this.biomeTextures.get(biome.properties.biomeName);
                        if (biomeTexture && biomeTexture.complete && biomeTexture.naturalWidth > 0) {
                            const biomeWidth = biomeTexture.width;
                            const biomeHeight = biomeTexture.height;
                            this.ctx.drawImage(biomeTexture, sourceX, sourceY, Math.min(drawWidth, biomeWidth), Math.min(drawHeight, biomeHeight), drawX, drawY, drawWidth, drawHeight);
                        }
                        else {
                            this.ctx.drawImage(this.backgroundTexture, sourceX, sourceY, Math.min(drawWidth, defaultBgWidth), Math.min(drawHeight, defaultBgHeight), drawX, drawY, drawWidth, drawHeight);
                        }
                    }
                    else {
                        // Check if section has a custom background (color or texture)
                        const sectionIndex = this.getSectionAtPosition(tileX + defaultBgWidth / 2, tileY + defaultBgHeight / 2);
                        const sectionConfig = constants_1.SECTION_CONFIGS[sectionIndex];
                        const sectionTexture = this.sectionTextures.get(sectionIndex);
                        const defaultColor = '#00d885';
                        // Check for section texture first
                        if (sectionTexture && sectionTexture.complete && sectionTexture.naturalWidth > 0) {
                            const secTexWidth = sectionTexture.width;
                            const secTexHeight = sectionTexture.height;
                            this.ctx.drawImage(sectionTexture, sourceX, sourceY, Math.min(drawWidth, secTexWidth), Math.min(drawHeight, secTexHeight), drawX, drawY, drawWidth, drawHeight);
                        }
                        else if (sectionConfig?.background && sectionConfig.background.startsWith('#') && sectionConfig.background !== defaultColor) {
                            // Draw section background color
                            this.ctx.fillStyle = sectionConfig.background;
                            this.ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
                        }
                        else {
                            this.ctx.drawImage(this.backgroundTexture, sourceX, sourceY, Math.min(drawWidth, defaultBgWidth), Math.min(drawHeight, defaultBgHeight), drawX, drawY, drawWidth, drawHeight);
                        }
                    }
                }
                else {
                    // Tile is fully within bounds - draw with 2 pixel overlap
                    // Use integer coordinates to avoid sub-pixel rendering gaps
                    const drawX = Math.floor(adjustedTileX);
                    const drawY = Math.floor(adjustedTileY);
                    if (biome && biome.properties?.biomeName && biome.properties?.backgroundTexture) {
                        const biomeTexture = this.biomeTextures.get(biome.properties.biomeName);
                        if (biomeTexture && biomeTexture.complete && biomeTexture.naturalWidth > 0) {
                            const biomeWidth = biomeTexture.width;
                            const biomeHeight = biomeTexture.height;
                            // Draw biome texture scaled up by 2 pixels
                            this.ctx.drawImage(biomeTexture, drawX, drawY, biomeWidth + TILE_OVERLAP, biomeHeight + TILE_OVERLAP);
                        }
                        else {
                            // Draw default texture scaled up by 2 pixels
                            this.ctx.drawImage(this.backgroundTexture, drawX, drawY, scaledWidth, scaledHeight);
                        }
                    }
                    else {
                        // Check if section has a custom background (color or texture)
                        const sectionIndex = this.getSectionAtPosition(tileX + defaultBgWidth / 2, tileY + defaultBgHeight / 2);
                        const sectionConfig = constants_1.SECTION_CONFIGS[sectionIndex];
                        const sectionTexture = this.sectionTextures.get(sectionIndex);
                        const defaultColor = '#00d885';
                        // Check for section texture first
                        if (sectionTexture && sectionTexture.complete && sectionTexture.naturalWidth > 0) {
                            // Draw section texture scaled up by 2 pixels
                            this.ctx.drawImage(sectionTexture, drawX, drawY, sectionTexture.width + TILE_OVERLAP, sectionTexture.height + TILE_OVERLAP);
                        }
                        else if (sectionConfig?.background && sectionConfig.background.startsWith('#') && sectionConfig.background !== defaultColor) {
                            // Draw section background color
                            this.ctx.fillStyle = sectionConfig.background;
                            this.ctx.fillRect(drawX, drawY, scaledWidth, scaledHeight);
                        }
                        else {
                            // Draw default texture scaled up by 2 pixels - this ensures no gaps
                            this.ctx.drawImage(this.backgroundTexture, drawX, drawY, scaledWidth, scaledHeight);
                        }
                    }
                }
            }
        }
    }
    drawGameObjects(players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension = 1.0) {
        // Calculate viewport accounting for zoom level
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + scaledWidth,
            bottom: this.cameraY + scaledHeight
        };
        // Draw enemies first (including pets) - below players and petals
        const enemyCount = enemies.size;
        for (const enemy of enemies.values()) {
            // Calculate actual enemy size for accurate culling
            const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
            const baseSize = mobStats ? mobStats.size * 40 : 40;
            const visualScale = mobStats?.visual_scale ?? 1.0;
            const enemySize = baseSize * visualScale;
            // Add a buffer margin to ensure mobs are completely out before culling
            // This prevents culling when mobs are barely outside the viewport
            const cullingBuffer = Math.max(enemySize, 100); // At least 100px buffer, or enemy size if larger
            // Only cull if the mob is completely outside the viewport (with buffer)
            // A mob is completely outside if all of its edges are outside the viewport bounds
            if (enemy.x + enemySize / 2 + cullingBuffer < viewport.left ||
                enemy.x - enemySize / 2 - cullingBuffer > viewport.right ||
                enemy.y + enemySize / 2 + cullingBuffer < viewport.top ||
                enemy.y - enemySize / 2 - cullingBuffer > viewport.bottom) {
                continue;
            }
            try {
                this.drawEnemy(enemy);
            }
            catch (error) {
                console.error('[Graphics] Error drawing enemy:', error, enemy);
                // Draw a simple fallback circle if rendering fails
                try {
                    this.ctx.save();
                    this.ctx.translate(enemy.x, enemy.y);
                    this.ctx.fillStyle = '#ff0000';
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 20, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.restore();
                }
                catch (fallbackError) {
                    console.error('[Graphics] Fallback rendering also failed:', fallbackError);
                }
            }
        }
        // Draw players (with petals) - above enemies
        for (const player of players.values()) {
            if (player.x > viewport.left - constants_1.PLAYER_SIZE && player.x < viewport.right + constants_1.PLAYER_SIZE &&
                player.y > viewport.top - constants_1.PLAYER_SIZE && player.y < viewport.bottom + constants_1.PLAYER_SIZE) {
                if (player.isDead) {
                    // Draw corpse for dead players
                    this.drawCorpse(player.x, player.y, player.angle);
                }
                else {
                    // Use each player's own petal extension, or fallback to the passed value (for current player)
                    const playerPetalExtension = player.id === currentPlayerId
                        ? petalExtension
                        : (player.petalExtension || 1.0);
                    // Draw normal player (pass enemies for petal physics)
                    this.drawPlayer(player, currentPlayerId, playerPetalExtension, enemies);
                }
            }
        }
        // Draw items
        for (const item of items.values()) {
            // Add similar viewport culling for items
            this.drawItem(item);
        }
        // Cache current time once per frame for animated projectiles
        const currentTime = Date.now();
        // Batch ALL gas projectiles (mob + player) for optimal performance
        const allGasProjectiles = [];
        const otherProjectiles = [];
        const MAX_GAS_PROJECTILES = 500; // Limit to prevent performance issues
        // Process mob projectiles
        for (const projectile of mobProjectiles.values()) {
            const petalStats = (0, petals_1.getPetalStats)(projectile.petalType, projectile.petalRarity);
            if (!petalStats) {
                continue;
            }
            const projectileSize = projectile.size * 20; // Use projectile's scaled size
            const cullingBuffer = Math.max(projectileSize, 50);
            // Viewport culling
            if (projectile.x + projectileSize / 2 + cullingBuffer < viewport.left ||
                projectile.x - projectileSize / 2 - cullingBuffer > viewport.right ||
                projectile.y + projectileSize / 2 + cullingBuffer < viewport.top ||
                projectile.y - projectileSize / 2 - cullingBuffer > viewport.bottom) {
                continue;
            }
            if (projectile.petalType === 'gas' && projectile.petalRarity === 'common') {
                if (allGasProjectiles.length < MAX_GAS_PROJECTILES) {
                    allGasProjectiles.push({
                        x: projectile.x,
                        y: projectile.y,
                        radius: projectileSize / 2 // Already uses scaled size
                    });
                }
            }
            else {
                otherProjectiles.push({ projectile, petalStats });
            }
        }
        // Process player projectiles
        for (const projectile of playerProjectiles.values()) {
            const petalStats = (0, petals_1.getPetalStats)(projectile.petalType, projectile.petalRarity);
            if (!petalStats) {
                continue;
            }
            const projectileSize = petalStats.size * 20;
            const cullingBuffer = Math.max(projectileSize, 50);
            // Viewport culling
            if (projectile.x + projectileSize / 2 + cullingBuffer < viewport.left ||
                projectile.x - projectileSize / 2 - cullingBuffer > viewport.right ||
                projectile.y + projectileSize / 2 + cullingBuffer < viewport.top ||
                projectile.y - projectileSize / 2 - cullingBuffer > viewport.bottom) {
                continue;
            }
            if (projectile.petalType === 'gas' && projectile.petalRarity === 'common') {
                if (allGasProjectiles.length < MAX_GAS_PROJECTILES) {
                    allGasProjectiles.push({
                        x: projectile.x,
                        y: projectile.y,
                        radius: projectileSize / 2
                    });
                }
            }
            else {
                otherProjectiles.push({ projectile, petalStats });
            }
        }
        // Batch draw ALL gas projectiles in a single operation (much faster)
        if (allGasProjectiles.length > 0) {
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
            this.ctx.beginPath();
            for (const gas of allGasProjectiles) {
                this.ctx.arc(gas.x, gas.y, gas.radius, 0, Math.PI * 2);
            }
            this.ctx.fill();
        }
        // Draw other projectiles normally
        for (const { projectile, petalStats } of otherProjectiles) {
            this.drawMobProjectile(projectile, currentTime, petalStats);
        }
    }
    render(players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension = 1.0) {
        // Cache timestamp for this frame to avoid Date.now() per enemy
        this.frameTimestamp = Date.now();
        // Update section-based texture loading based on player position
        const currentPlayer = players.get(currentPlayerId);
        if (currentPlayer) {
            this.updateSectionTextures(currentPlayer.x, currentPlayer.y);
        }
        this.ctx.save();
        // Clear the canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Apply zoom scaling
        this.ctx.scale(this.zoomLevel, this.zoomLevel);
        // Translate the context by the camera position
        // Ensure camera position is valid (not NaN or Infinity)
        const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
        const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;
        this.ctx.translate(-validCameraX, -validCameraY);
        // Draw scrolling background
        this.drawScrollingBackground();
        // Draw spawn zones below walls/water when ALT is held
        if (this.showRarityGlow) {
            this.drawSpawnZones(this.mapData);
        }
        // Draw the map
        this.drawMap(this.mapData);
        // Draw game objects
        this.drawGameObjects(players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension);
        // Draw explosion effects (in world coordinates, before camera restore)
        this.drawExplosionEffects();
        this.drawPetalBreakEffects();
        this.drawLightningEffects();
        this.drawPetalParticleEffects();
        this.ctx.restore();
        // Draw UI elements (not affected by camera)
        this.drawUI(players, currentPlayerId);
        // Draw falling stars (screen coordinates)
        this.drawFallingStars();
        // Draw boss bars for ultra, super, and unique mobs in view
        this.drawBossBars(enemies);
        // Draw changelog and notifications menus
        // Ensure canvas z-index is low so UI elements stay on top
        if (this.canvas) {
            this.canvas.style.zIndex = '0';
        }
        if (this.changelogManager) {
            this.changelogManager.render();
        }
        if (this.notificationsManager) {
            this.notificationsManager.render();
        }
        // Draw iris circle-reveal transition on top of everything
        if (this.irisTransitionActive) {
            this.drawIrisTransition();
        }
    }
    setChangelogManager(changelogManager) {
        this.changelogManager = changelogManager;
        if (changelogManager && this.canvas) {
            changelogManager.setCanvas(this.canvas);
        }
    }
    setNotificationsManager(notificationsManager) {
        this.notificationsManager = notificationsManager;
        if (notificationsManager && this.canvas) {
            notificationsManager.setCanvas(this.canvas);
        }
    }
    setupItemSprites(itemSprites) {
        this.itemSprites = itemSprites;
    }
    setPetalImagesFromPreloaded(imageCache) {
        this.petalImageCache = imageCache;
    }
    async preloadPetalImages() {
        // This method is now deprecated - petal images should be preloaded via Preloader
        // This is kept as a fallback but should not be used
        console.warn('[Graphics] preloadPetalImages called - this should be handled by Preloader');
    }
    drawCorpse(x, y, angle) {
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);
        // Draw the corpse SVG
        this.ctx.fillStyle = '#ffe763';
        this.ctx.strokeStyle = '#cfbb50';
        this.ctx.lineWidth = 3;
        // Draw the main circle (face)
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 25, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        // Draw the X eyes
        this.ctx.strokeStyle = '#222222';
        this.ctx.lineWidth = 1.5;
        this.ctx.lineCap = 'round';
        // Left eye X
        this.ctx.beginPath();
        this.ctx.moveTo(-10, -8);
        this.ctx.lineTo(-4, -2);
        this.ctx.moveTo(-4, -8);
        this.ctx.lineTo(-10, -2);
        this.ctx.stroke();
        // Right eye X
        this.ctx.beginPath();
        this.ctx.moveTo(10, -8);
        this.ctx.lineTo(4, -2);
        this.ctx.moveTo(4, -8);
        this.ctx.lineTo(10, -2);
        this.ctx.stroke();
        // Draw the sad mouth
        this.ctx.beginPath();
        this.ctx.moveTo(-6, 10);
        this.ctx.quadraticCurveTo(0, 15, 6, 10);
        this.ctx.stroke();
        this.ctx.restore();
    }
}
exports.Graphics = Graphics;
