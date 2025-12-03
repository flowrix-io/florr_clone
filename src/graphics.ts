import { Player } from './player';
import { Enemy } from './enemy';
import { Item, WorldItem } from './item';
import { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE, getMobAnimationFrameTime, getHighQualityMobs } from './constants';
import { getPetalStats } from './petals';
import { getMobStats, getAllMobTypes, MOB_CONFIG } from './mobs';
import { getSVGRenderer } from './svg_renderer';

export interface FloatingText {
    x: number;
    y: number;
    text: string;
    color: string;
    fontSize: number;
    alpha: number;
    yOffset: number;
    lifetime: number;
}

export interface ExplosionEffect {
    x: number;
    y: number;
    radius: number;
    maxRadius: number;
    alpha: number;
    lifetime: number;
    startTime: number;
    particles: ExplosionParticle[];
}

export interface ExplosionParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
}

export interface LightningEffect {
    x: number;
    y: number;
    targets: { x: number; y: number; enemyId: string }[];
    damage: number;
    lifetime: number;
    startTime: number;
    alpha: number;
}

export interface PetalBreakEffect {
    x: number;
    y: number;
    petalType: string;
    alpha: number;
    scale: number;
    lifetime: number;
    startTime: number;
}

export interface PetalParticleEffect {
    x: number;
    y: number;
    rarity: string;
    particles: PetalParticle[];
    lifetime: number;
    startTime: number;
}

export interface PetalParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
    baseColor: string; // White base color
}

export class Graphics {
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    private cameraX: number = 0;
    private cameraY: number = 0;
    private zoomLevel: number = 1.0;
    private playerSprite: HTMLImageElement;
    private floatingTexts: FloatingText[] = [];
    private explosionEffects: ExplosionEffect[] = [];
    private petalBreakEffects: PetalBreakEffect[] = [];
    private lightningEffects: LightningEffect[] = [];
    private petalParticleEffects: PetalParticleEffect[] = [];
    private mapData: MapElement[] = [];

    private readonly MINIMAP_WIDTH = 200;
    private readonly MINIMAP_HEIGHT = 200;
    private readonly MINIMAP_PADDING = 10;
    private minimapScrollX = 0; // Scroll offset for minimap X
    private minimapScrollY = 0; // Scroll offset for minimap Y
    private minimapZoom = 1.0; // Zoom level for minimap (1.0 = 20000x20000 area)
    private readonly MINIMAP_MIN_ZOOM = 0.5; // Show 40000x40000 area
    private readonly MINIMAP_MAX_ZOOM = 3.0; // Show 6667x6667 area
    private readonly MINIMAP_ZOOM_STEP = 0.2;
    private playerEye: { x: number, y: number } = { x: 0, y: 0 };
    private wallTexture: HTMLImageElement = new Image();
    private octopusSprite: HTMLImageElement = new Image();
    private fishSprite: HTMLImageElement = new Image();
    private healthPotionSprite: HTMLImageElement = new Image();
    private speedBoostSprite: HTMLImageElement = new Image();
    private shieldSprite: HTMLImageElement = new Image();
    private backgroundTexture: HTMLImageElement = new Image();
    private biomeTextures: Map<string, HTMLImageElement> = new Map(); // Store biome-specific background textures
    private readonly MAP_COLORS = {
        wall: 'rgba(102, 102, 102, 0.0)', // handled elsewhere
        spawn: 'rgba(76, 175, 80, 0.0)',
        teleporter: 'rgba(33, 150, 243, 0.0)', // handled elsewhere
        safe_zone: 'rgba(255, 193, 7, 0.0)', // No safe zone tint(invalid zone, not used)
        biome: 'rgba(128, 64, 192, 0.0)' // Purple tint for biomes on minimap
    };
    private readonly ENEMY_COLORS = {
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
    private readonly ENEMY_SIZE_MULTIPLIERS: Record<Enemy['tier'], number> = {
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
    private readonly ENEMY_MAX_HEALTH: Record<Enemy['tier'], number> = {
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
    private readonly ITEM_RARITY_COLORS = {
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
    public showHitboxes: boolean = false;
    private itemSprites: Record<string, HTMLImageElement> = {};
    public petalImageCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]> = {}; // Canvas for static, array for animated
    private mobSVGCache: Record<string, string> = {}; // Store original SVG strings for WASM rendering
    private svgRenderer = getSVGRenderer();
    private lastEnemyDebugLog: number = 0;

    /**
     * Get the canvas to use for a petal at a given time
     * Returns the canvas for static petals, or the appropriate frame for animated petals
     */
    private getPetalCanvas(petalKey: string, time: number = Date.now()): HTMLCanvasElement | null {
        const petalImage = this.petalImageCache[petalKey];
        if (!petalImage) {
            return null;
        }
        
        if (Array.isArray(petalImage)) {
            // Animated petal - select frame based on time (24fps = 42ms per frame)
            const frameIndex = Math.floor((time / 42) % petalImage.length);
            return petalImage[frameIndex];
        } else {
            // Static petal
            return petalImage;
        }
    }

    constructor(
        canvas: HTMLCanvasElement, 
        playerSprite: HTMLImageElement, 
        wallTexture: HTMLImageElement,
        octopusSprite: HTMLImageElement,
        fishSprite: HTMLImageElement,
        healthPotionSprite: HTMLImageElement,
        speedBoostSprite: HTMLImageElement,
        shieldSprite: HTMLImageElement,
        backgroundTexture: HTMLImageElement
    ) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d')!;
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

    private async preloadMobImages() {
        // Initialize SVG renderer
        await this.svgRenderer.waitForInit();
        
        const mobTypes = getAllMobTypes();
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        const highQualityMobs = getHighQualityMobs();
        
        // Pre-render mob canvases for immediate use (no fallback circles)
        const preloadPromises: Promise<void>[] = [];
        
        // First pass: Store all SVG strings in cache (needed for rendering)
        for (const mobType of mobTypes) {
            for (const rarity of rarities) {
                const mobStats = getMobStats(mobType, rarity);
                if (mobStats && mobStats.image) {
                    const cacheKey = `${mobType}_${rarity}`;
                    // Store SVG string for WASM rendering
                    this.mobSVGCache[cacheKey] = mobStats.image;
                }
            }
        }
        
        if (highQualityMobs) {
            // High quality mode: Pre-render frames for each rarity separately (old approach)
            // This uses more memory but ensures each rarity has its own frames
            for (const mobType of mobTypes) {
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
            
            for (const mobType of mobTypes) {
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
        } else {
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
        
        console.log('[Graphics] Loaded', Object.keys(this.mobSVGCache).length, 'mob SVG strings for WASM rendering');
    }

    // Method to get mob animation frame time in milliseconds
    private getMobAnimationFrameTime(): number {
        return getMobAnimationFrameTime();
    }

    /**
     * Pre-render animation frames for a mob
     * @param mobStats The mob stats containing the SVG image
     * @param cacheKey The cache key for this mob (e.g., "bee_common")
     * @param preloadPromises Array to push the preload promise to
     * @param baseCacheKey Optional base cache key for optimized mode
     */
    private preloadMobFrames(
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

        // Pre-render multiple animation frames to avoid data URL creation during gameplay
        // Pre-render frames for a full animation cycle (configurable framerate)
        // For most mobs, animations are typically 1-2 seconds, so pre-render ~30 frames (2 seconds)
        const promise = (async () => {
            try {
                // Use 256x256 for canvas size when high quality is off (better image quality)
                // When high quality is on, use the mob's actual size
                const highQualityMobs = getHighQualityMobs();
                const mobSize = highQualityMobs ? mobStats.size * 40 : 256;
                
                // Pre-render multiple frames (30 frames per animation cycle)
                const framesToPreload = 30;
                for (let frame = 0; frame < framesToPreload; frame++) {
                    // Check if preloading was marked complete (user might have set it manually)
                    // If so, stop pre-rendering to avoid data URL creation
                    if (this.svgRenderer.isPreloadingComplete()) {
                        console.log(`[Graphics] Preloading marked complete, stopping pre-render for ${cacheKey} at frame ${frame}`);
                        break;
                    }
                    
                    const frameTime = this.getMobAnimationFrameTime(); // Get milliseconds per frame from settings
                    const time = frame * frameTime; // Time in ms for this frame
                    // Use same relative time calculation as renderSVGToCanvas
                    const framesPerCycle = 30; // Number of frames in a complete animation cycle
                    const animationCycleDuration = framesPerCycle * frameTime; // Total cycle duration
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
            } catch (error) {
                console.error(`[Graphics] Failed to pre-render canvas for ${cacheKey} (baseCacheKey=${baseCacheKey}):`, error);
            }
        })();
        preloadPromises.push(promise);
    }

    /**
     * Get the total memory used by offscreen canvases in MB
     */
    public getOffscreenCanvasMemoryMB(): number {
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
    }

    // Method to set a biome texture
    public setBiomeTexture(biomeName: string, texture: HTMLImageElement) {
        this.biomeTextures.set(biomeName, texture);
    }

    // Method to get biome at a position
    private getBiomeAtPosition(x: number, y: number): MapElement | null {
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

    public clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    public setCamera(x: number, y: number, zoom: number = 1.0) {
        this.cameraX = x;
        this.cameraY = y;
        this.zoomLevel = zoom;
    }
    
    public setMap(mapData: MapElement[]) {
        this.mapData = mapData;
    }

    public showFloatingText(x: number, y: number, text: string, color: string, fontSize: number) {
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

    public showExplosionEffect(x: number, y: number, radius: number) {
        // Create particles for the explosion
        const particles: ExplosionParticle[] = [];
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
        
        console.log(`[GRAPHICS] Created explosion effect at (${x}, ${y}) with ${particles.length} particles`);
    }

    public showPetalBreakEffect(x: number, y: number, petalType: string) {
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

    public showLightningEffect(x: number, y: number, targets: { x: number; y: number; enemyId: string }[], damage: number) {
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
        
        console.log(`[GRAPHICS] Created lightning effect at (${x}, ${y}) with ${targets.length} targets`);
    }

    public showPetalParticleEffect(x: number, y: number, rarity: string) {
        // Only create particle effects for ultra, super, and unique petals
        if (!['ultra', 'super', 'unique'].includes(rarity)) {
            return;
        }

        // Create particles for the petal
        const particles: PetalParticle[] = [];
        const particleCount = 8; // Number of particles radiating from the petal
        
        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
            const speed = 0.5 + Math.random() * 0.5; // Slow, gentle movement
            const particleLife = 2000 + Math.random() * 1000; // 2-3 seconds
            
            // Get rarity color for tinting
            const rarityColor = this.ITEM_RARITY_COLORS[rarity as keyof typeof this.ITEM_RARITY_COLORS] || '#ffffff';
            
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
     * Check if a wall edge is exposed (no adjacent wall)
     */
    private isEdgeExposed(
        wall: MapElement,
        edge: 'top' | 'bottom' | 'left' | 'right',
        allWalls: MapElement[]
    ): boolean {
        const tolerance = 1; // Small tolerance for floating point comparison
        const x = wall.x;
        const y = wall.y;
        const width = wall.width;
        const height = wall.height;

        switch (edge) {
            case 'top':
                // Check if there's a wall directly above
                return !allWalls.some(other => 
                    other !== wall &&
                    other.type === 'wall' &&
                    Math.abs(other.y + other.height - y) < tolerance &&
                    other.x < x + width &&
                    other.x + other.width > x
                );
            case 'bottom':
                // Check if there's a wall directly below
                return !allWalls.some(other => 
                    other !== wall &&
                    other.type === 'wall' &&
                    Math.abs(other.y - (y + height)) < tolerance &&
                    other.x < x + width &&
                    other.x + other.width > x
                );
            case 'left':
                // Check if there's a wall directly to the left
                return !allWalls.some(other => 
                    other !== wall &&
                    other.type === 'wall' &&
                    Math.abs(other.x + other.width - x) < tolerance &&
                    other.y < y + height &&
                    other.y + other.height > y
                );
            case 'right':
                // Check if there's a wall directly to the right
                return !allWalls.some(other => 
                    other !== wall &&
                    other.type === 'wall' &&
                    Math.abs(other.x - (x + width)) < tolerance &&
                    other.y < y + height &&
                    other.y + other.height > y
                );
        }
    }

    /**
     * Simple seeded random number generator for consistent spikes per wall
     */
    private seededRandom(seed: number): number {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }

    /**
     * Draw spiky edges on a wall using the tiled texture pattern
     * Spikes are randomly positioned and can connect together, with softer curves
     */
    private drawWallSpikes(
        x: number,
        y: number,
        width: number,
        height: number,
        wall: MapElement,
        allWalls: MapElement[],
        pattern: CanvasPattern
    ): void {
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
            this.drawRandomSpikesOnEdge(
                x, y, width, 0,
                'top',
                baseSeed + 1,
                minSpikeHeight, maxSpikeHeight,
                minSpikeWidth, maxSpikeWidth,
                minSpikeSpacing, maxSpikeSpacing,
                clusterChance
            );
        }

        // Bottom edge spikes
        if (this.isEdgeExposed(wall, 'bottom', allWalls)) {
            this.drawRandomSpikesOnEdge(
                x, y + height, width, 0,
                'bottom',
                baseSeed + 2,
                minSpikeHeight, maxSpikeHeight,
                minSpikeWidth, maxSpikeWidth,
                minSpikeSpacing, maxSpikeSpacing,
                clusterChance
            );
        }

        // Left edge spikes
        if (this.isEdgeExposed(wall, 'left', allWalls)) {
            this.drawRandomSpikesOnEdge(
                x, y, 0, height,
                'left',
                baseSeed + 3,
                minSpikeHeight, maxSpikeHeight,
                minSpikeWidth, maxSpikeWidth,
                minSpikeSpacing, maxSpikeSpacing,
                clusterChance
            );
        }

        // Right edge spikes
        if (this.isEdgeExposed(wall, 'right', allWalls)) {
            this.drawRandomSpikesOnEdge(
                x + width, y, 0, height,
                'right',
                baseSeed + 4,
                minSpikeHeight, maxSpikeHeight,
                minSpikeWidth, maxSpikeWidth,
                minSpikeSpacing, maxSpikeSpacing,
                clusterChance
            );
        }

        this.ctx.restore();
    }

    /**
     * Draw random spikes along an edge with clustering support
     */
    private drawRandomSpikesOnEdge(
        startX: number,
        startY: number,
        edgeWidth: number,
        edgeHeight: number,
        direction: 'top' | 'bottom' | 'left' | 'right',
        seed: number,
        minHeight: number,
        maxHeight: number,
        minWidth: number,
        maxWidth: number,
        minSpacing: number,
        maxSpacing: number,
        clusterChance: number
    ): void {
        const edgeLength = direction === 'top' || direction === 'bottom' ? edgeWidth : edgeHeight;
        const spikes: Array<{ pos: number; width: number; height: number; isCluster: boolean }> = [];
        
        let currentPos = 0;
        let seedOffset = 0;

        // Generate random spike positions with clustering
        let inCluster = false;
        let clusterSpikeCount = 0;
        let clusterMaxSpikes = 0;
        let prevSpikeEnd = 0; // Track where previous spike ends to prevent overlap

        while (prevSpikeEnd < edgeLength) {
            const rand = this.seededRandom(seed + seedOffset++);
            
            // Check if we should start a new cluster
            if (!inCluster && rand < clusterChance) {
                inCluster = true;
                clusterSpikeCount = 0;
                clusterMaxSpikes = 2 + Math.floor(this.seededRandom(seed + seedOffset++) * 3); // 2-4 spikes in cluster
            }
            
            // Calculate spacing from previous spike end
            let spacing = 0;
            if (inCluster && clusterSpikeCount > 0) {
                // Small spacing within cluster
                spacing = minSpacing * 0.3 + (minSpacing * 0.5) * this.seededRandom(seed + seedOffset++);
            } else if (!inCluster) {
                // Normal spacing for non-clustered spikes
                spacing = minSpacing + (maxSpacing - minSpacing) * rand;
            }
            
            // Position spike after previous spike with spacing
            currentPos = prevSpikeEnd + spacing;

            if (currentPos >= edgeLength) break;

            const spikeWidth = minWidth + (maxWidth - minWidth) * this.seededRandom(seed + seedOffset++);
            const spikeHeight = minHeight + (maxHeight - minHeight) * this.seededRandom(seed + seedOffset++);
            
            // Clustered spikes are wider and can vary in height
            const finalWidth = inCluster ? spikeWidth * (1.3 + this.seededRandom(seed + seedOffset++) * 0.7) : spikeWidth;
            const finalHeight = inCluster ? spikeHeight * (1.1 + this.seededRandom(seed + seedOffset++) * 0.2) : spikeHeight;

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
            const topWidth = spikeWidth * (0.2 + this.seededRandom((spike.pos * 1000) % 1000) * 0.2);

            this.ctx.beginPath();

            if (direction === 'top') {
                // Trapezoid spike pointing upward with flat top
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY - spikeHeight);
                this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY - spikeHeight);
                this.ctx.lineTo(spikeX + spikeWidth, spikeY);
            } else if (direction === 'bottom') {
                // Trapezoid spike pointing downward with flat bottom
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY + spikeHeight);
                this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY + spikeHeight);
                this.ctx.lineTo(spikeX + spikeWidth, spikeY);
            } else if (direction === 'left') {
                // Trapezoid spike pointing left with flat left side
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
                this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
                this.ctx.lineTo(spikeX, spikeY + spikeWidth);
            } else if (direction === 'right') {
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
            } else if (direction === 'bottom') {
                // Draw outline on left side, bottom, and right side (skip top base)
                // Start from left side of base, go down left edge
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY + spikeHeight);
                // Draw bottom edge
                this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY + spikeHeight);
                // Draw right edge up to base
                this.ctx.lineTo(spikeX + spikeWidth, spikeY);
                // Don't draw the base edge
            } else if (direction === 'left') {
                // Draw outline on top, left side, and bottom (skip right base)
                // Start from top of base, go left along top edge
                this.ctx.moveTo(spikeX, spikeY);
                this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
                // Draw left edge
                this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
                // Draw bottom edge back to base
                this.ctx.lineTo(spikeX, spikeY + spikeWidth);
                // Don't draw the base edge
            } else if (direction === 'right') {
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

    public drawMap(world_map_data: MapElement[]) {
        // Calculate viewport accounting for zoom level
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + scaledWidth,
            bottom: this.cameraY + scaledHeight
        };

        // Draw all map elements
        world_map_data.forEach(element => {
            const x = element.x;
            const y = element.y;
            const width = element.width;
            const height = element.height;

            // Only draw elements that are visible in the viewport (accounting for zoom)
            if (
                x + width >= viewport.left &&
                x <= viewport.right &&
                y + height >= viewport.top &&
                y <= viewport.bottom
            ) {
                if (element.type === 'wall') {
                    // Draw wall texture tiled
                    const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                    if (pattern) {
                        this.ctx.save();
                        this.ctx.fillStyle = pattern;
                        this.ctx.fillRect(x, y, width, height);
                        
                        // Draw spiky edges on exposed edges
                        this.drawWallSpikes(x, y, width, height, element, world_map_data, pattern);
                        
                        this.ctx.restore();
                    }
                } else {
                    // Draw other elements normally
                    this.ctx.fillStyle = this.MAP_COLORS[element.type];
                    this.ctx.fillRect(x, y, width, height);

                    // Add visual indicators for special elements
                    if (element.type === 'teleporter') {
                        this.drawTeleporter(x, y, width, height);
                    } else if (element.type === 'spawn') {
                        this.drawSpawnPoint(x, y, width, height, element.properties?.spawnType);
                    }
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

    private drawTeleporter(x: number, y: number, width: number, height: number) {
        // Create a pulsing effect
        const time = Date.now() / 1000;
        const pulseSize = 0.2 * Math.sin(time * 2) + 0.8; // Pulse between 0.6 and 1.0

        // Draw outer glow
        const gradient = this.ctx.createRadialGradient(
            x + width / 2, y + height / 2, 0,
            x + width / 2, y + height / 2, (width / 2) * pulseSize
        );
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
            this.ctx.ellipse(
                x + width / 2,
                y + height / 2,
                ringSize,
                ringSize * 0.4,
                0,
                0,
                Math.PI * 2
            );
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

    private getTierColor(tier: string): string {
        const colors = {
            common: 'rgba(128, 128, 128, 0.3)',
            uncommon: 'rgba(0, 128, 0, 0.3)',
            rare: 'rgba(0, 0, 255, 0.3)',
            epic: 'rgba(128, 0, 128, 0.3)',
            legendary: 'rgba(255, 165, 0, 0.3)',
            mythic: 'rgba(255, 0, 0, 0.3)'
        };
        return colors[tier as keyof typeof colors] || colors.common;
    }

    public drawSpawnPoint(x: number, y: number, width: number, height: number, type?: string) {
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

    public drawUI(players: Map<string, Player>, socket: string) {
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
            this.ctx.strokeText(
                `${Math.round(clampedHealth)}/${player.maxHealth}`,
                healthTextX,
                healthTextY
            );
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(
                `${Math.round(clampedHealth)}/${player.maxHealth}`,
                healthTextX,
                healthTextY
            );

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
            this.ctx.strokeText(
                `LVL ${player.level} - ${player.xp}/${player.xpToNextLevel}`,
                xpTextX,
                xpTextY
            );
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(
                `LVL ${player.level} - ${player.xp}/${player.xpToNextLevel}`,
                xpTextX,
                xpTextY
            );

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

    public drawBossBars(enemies: Map<string, Enemy>) {
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
        const bossMobs: Enemy[] = [];
        for (const enemy of enemies.values()) {
            if (enemy.tier === 'ultra' || enemy.tier === 'super' || enemy.tier === 'unique') {
                // Check if enemy is in viewport (same logic as drawGameObjects)
                const mobStats = getMobStats(enemy.type, enemy.tier);
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
                const mobStats = getMobStats(enemy.type, enemy.tier);
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
                const healthText = `${Math.round(clampedHealth)}/${enemy.maxHealth}`;
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

    private formatNumber(num: number): string {
        if (num >= 1e12) {
            return (num / 1e12).toFixed(1) + 'T';
        } else if (num >= 1e9) {
            return (num / 1e9).toFixed(1) + 'B';
        } else if (num >= 1e6) {
            return (num / 1e6).toFixed(1) + 'M';
        } else if (num >= 1e3) {
            return (num / 1e3).toFixed(1) + 'K';
        } else {
            return num.toFixed(1);
        }
    }

    private s(size: number): number {
        return 1 * size;
    }
    private drawFlower(center: { x: number, y: number }, eye: { x: number, y: number }) {
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

    public drawPlayer(player: Player, socket: string, petalExtension: number = 1.0) {
        this.ctx.save();
        this.ctx.translate(player.x, player.y);

        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = 'red';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
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
            const currentTime = Date.now();
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
            this.playerEye = {
                x: Math.cos(player.angle) * this.s(2),
                y: Math.sin(player.angle) * this.s(4.4)
            };

            // Smooth interpolation of eye position (lerp factor controls smoothness)
            const lerpFactor = 0.15; // Lower = smoother, higher = more responsive
            this.playerEye.x += (this.playerEye.x - this.playerEye.x) * lerpFactor;
            this.playerEye.y += (this.playerEye.y - this.playerEye.y) * lerpFactor;

            // Apply hue rotation for current player
            const offscreen = document.createElement('canvas');
            offscreen.width = this.playerSprite.width;
            offscreen.height = this.playerSprite.height;
            const offCtx = offscreen.getContext('2d')!;

            offCtx.drawImage(this.playerSprite, 0, 0);
            const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
            offCtx.putImageData(imageData, 0, 0);

            this.ctx.save(); // Save before flower drawing to contain the clip
            this.drawFlower(this.playerSprite, this.playerEye);
            this.ctx.restore(); // Restore after flower drawing to remove the clip
        } else {
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
        this.drawPlayerPetals(player, petalExtension);
        
        this.ctx.restore();
    }

    private drawPlayerPetals(player: Player, petalExtension: number = 1.0) {
        // Safety check: ensure player loadout exists before filtering
        if (!player.loadout || !Array.isArray(player.loadout)) {
            return; // Skip drawing petals if loadout is not properly initialized
        }
        
        // IMPORTANT: This function is called from within drawPlayer(), which means:
        // - The context has: scale(zoomLevel), translate(-cameraX, -cameraY), translate(player.x, player.y)
        // - We need to draw petals relative to the player position (which is already translated)
        // - So we should use relative coordinates (0, 0 is player center) or translate from player position
        
        
        // Get all petals from player loadout and expand based on count property
        const petalInstances: Array<{petal: any, instanceIndex: number}> = [];
        try {
            player.loadout.forEach(item => {
                if (item && item.type === 'petal' && item.petalType && item.rarity) {
                    const stats = getPetalStats(item.petalType, item.rarity);
                    if (!stats) return;
                    
                    const count = stats.count || 1; // Use count from stats, default to 1
                    
                    // Validate count is a valid number
                    if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                        console.warn('Invalid petal count:', count, 'for', item.petalType, item.rarity);
                        return;
                    }
                    
                    // Create multiple instances based on count
                    for (let i = 0; i < count; i++) {
                        petalInstances.push({ petal: item, instanceIndex: i });
                    }
                }
            });
        } catch (error) {
            console.error('Error building petal instances:', error);
            return;
        }
        
        if (petalInstances.length === 0) return;


        const currentTime = Date.now();
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = (Math.PI * 2) / petalInstances.length; // Evenly space petals

        petalInstances.forEach(({petal, instanceIndex}, index) => {
            if (!petal || !petal.petalType || !petal.rarity) {
                return;
            }
            
            const stats = getPetalStats(petal.petalType, petal.rarity);
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
            const totalAngle = baseAngle + rotationAngle;

            // Apply petal range multiplier to base radius
            const petalRange = stats.range ?? 1.0;
            const petalRadius = baseRadius * petalRange;

            // Calculate position around player
            // Since we're already in the player's transform context (translate(player.x, player.y)),
            // we need to use RELATIVE coordinates from the player center (0, 0)
            const petalX = Math.cos(totalAngle) * petalRadius;
            const petalY = Math.sin(totalAngle) * petalRadius;

            // Draw petal - set up transforms first (same pattern as mobs)
            const size = 12 * stats.size;
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
            // IMPORTANT: Use only rotationAngle (not totalAngle) so the petal spins around its own center
            // totalAngle includes the orbital position, which would make it rotate around the player
            // rotationAngle is just the spinning motion, independent of orbital position
            this.ctx.rotate(rotationAngle + Math.PI / 2);
            
            // Reset any global state that might interfere
            this.ctx.globalAlpha = 1.0;
            this.ctx.globalCompositeOperation = 'source-over';
            
            // Draw petal - the transforms are already applied (translate to petal position, then rotate)
            // Try to use cached SVG image
            const petalKey = `${petal.petalType}_${petal.rarity}`;
            const petalCanvas = this.getPetalCanvas(petalKey, Date.now());
            
            if (petalCanvas && petalCanvas.width > 0 && petalCanvas.height > 0) {
                try {
                    // Use cached canvas image
                    // Draw centered at origin (which is now the petal position after translate)
                    this.ctx.drawImage(
                        petalCanvas, 
                        -petalSize / 2, 
                        -petalSize / 2, 
                        petalSize, 
                        petalSize
                    );
                    
                    // Add rarity glow effect
                    if (petal.rarity !== 'common') {
                        this.ctx.save();
                        this.ctx.shadowColor = stats.color;
                        this.ctx.shadowBlur = 5;
                        this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                        this.ctx.restore();
                    }
                } catch (error) {
                    console.error(`[Graphics] Error drawing petal image for ${index}:`, error);
                }
            } else {
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
            
            // Draw health bar for petals (after restore, so we need to set up transforms again)
            if (petal.health !== undefined && petal.maxHealth !== undefined && petal.maxHealth > 0) {
                // Health bar should be drawn at the petal's position
                // Since we already restored, we need to save/restore again and set up transforms
                this.ctx.save();
                this.ctx.translate(petalX, petalY);
                
                const healthBarWidth = size;
                const healthBarHeight = 3;
                const healthBarY = -size * 0.7 / 2 - 8;

                // Health bar background
                this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight);

                // Health bar fill
                const healthPercentage = petal.health / petal.maxHealth;
                this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
                this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth * healthPercentage, healthBarHeight);
                
                this.ctx.restore();
            }
        });
    }

    // Removed mobImageCache and loadSVGAsImage - mobs now use canvas rendering via svgRenderer
    // No data URLs are created for mob rendering

    public drawMobProjectile(projectile: any) {
        if (!projectile || typeof projectile.x !== 'number' || typeof projectile.y !== 'number') {
            return;
        }

        // Get petal stats for rendering
        const petalStats = getPetalStats(projectile.petalType, projectile.petalRarity);
        if (!petalStats) {
            return;
        }

        const petalSize = petalStats.size * 20; // Convert to pixels

        this.ctx.save();
        this.ctx.translate(projectile.x, projectile.y);
        this.ctx.rotate(projectile.angle);

        // Draw petal using the same method as player petals
        const petalKey = `${projectile.petalType}_${projectile.petalRarity}`;
        const petalCanvas = this.getPetalCanvas(petalKey, Date.now());
        
        if (petalCanvas && petalCanvas.width > 0 && petalCanvas.height > 0) {
            try {
                // Draw the petal canvas image centered at origin
                this.ctx.drawImage(
                    petalCanvas, 
                    -petalSize / 2, 
                    -petalSize / 2, 
                    petalSize, 
                    petalSize
                );
                
                // Add rarity glow effect for non-common projectiles
                if (projectile.petalRarity !== 'common') {
                    this.ctx.save();
                    this.ctx.shadowColor = petalStats.color;
                    this.ctx.shadowBlur = 5;
                    this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                    this.ctx.restore();
                }
            } catch (error) {
                console.error(`[Graphics] Error drawing projectile petal image:`, error);
                // Fallback to colored circle if image fails
                this.ctx.fillStyle = petalStats.color;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, petalSize / 2, 0, Math.PI * 2);
                this.ctx.fill();
            }
        } else {
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

    public drawEnemy(enemy: Enemy) {
        // Validate enemy has required properties
        if (!enemy || typeof enemy.x !== 'number' || typeof enemy.y !== 'number') {
            console.error('[Graphics] Invalid enemy data:', enemy);
            return;
        }
        
        // Get enemy size from mob stats
        const mobStats = getMobStats(enemy.type, enemy.tier);
        // Use visual_scale for rendering (affects visual only, not hitbox)
        const baseSize = mobStats ? mobStats.size * 40 : 40;
        const visualScale = mobStats?.visual_scale ?? 1.0;
        const enemySize = baseSize * visualScale;

        // Always set up the transform for the enemy position
        // The context already has camera transforms applied, so we translate to world position
        this.ctx.save();
        this.ctx.translate(enemy.x, enemy.y);
        this.ctx.rotate(enemy.angle || 0);
        
        // Flip horizontally if reversed is true
        if (enemy.reversed || mobStats?.reversed) {
            this.ctx.scale(-1, 1);
        }
        
        // Disable anti-aliasing for mobs (pixelated look)
        this.ctx.imageSmoothingEnabled = false;
        
        // Debug: Always draw something visible to verify coordinates work
        // This ensures we can see enemies even if images/sprites fail
        
        const cacheKey = `${enemy.type}_${enemy.tier}`;
        const mobSVG = this.mobSVGCache[cacheKey];
        
        // Ensure we're using the exact same SVG string that was pre-rendered
        // The SVG string should match exactly what's in mobSVGCache
        if (!mobSVG) {
            // No SVG cached for this mob type/rarity
            if (Math.random() < 0.01) {
                console.warn(`[Graphics] No SVG cached for ${cacheKey}`);
            }
        }
        
        // Use relative time for animation (wraps within animation cycle)
        // This ensures cache keys match with pre-rendered frames
        const animationCycleDuration = 2100; // 50 frames * 42ms = 2.1 seconds
        let currentTime = Date.now() % animationCycleDuration;
        
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
                rendered = this.svgRenderer.renderSVGToCanvas(
                    this.ctx,
                    mobSVG,
                    0, // x (already translated)
                    0, // y (already translated)
                    enemySize,
                    enemySize,
                    0, // rotation (already rotated)
                    currentTime,
                    true // disableAntiAliasing flag
                );
                
                // Debug: Log when WASM rendering is attempted
            } catch (error) {
                console.error(`[Graphics] Error rendering enemy SVG with WASM for ${cacheKey}:`, error);
            }
        } else {
            // Debug: Log why WASM renderer wasn't used
            if (mobSVG && Math.random() < 0.01) {
                if (!this.svgRenderer.isInitialized()) {
                    console.log(`[Graphics] WASM renderer not initialized for ${cacheKey}`);
                } else if (!mobSVG) {
                    console.log(`[Graphics] No SVG found in cache for ${cacheKey}`);
                }
            }
        }
        
        // If WASM renderer didn't work, use sprite fallback (no data URLs)
        if (!rendered) {
            // Determine which sprite to use based on enemy type
            let sprite: HTMLImageElement | null = null;
            if (enemy.type === 'octopus') {
                sprite = this.octopusSprite;
            } else if (enemy.type === 'fish' || enemy.type === 'shark') {
                sprite = this.fishSprite;
            }
            // For other types (bee, ladybug, soldier_ant), sprite will be null
            
            // Try to use sprite if available and loaded
            // Note: The scale(-1, 1) is already applied at the beginning if reversed is true
            if (sprite && sprite.complete && sprite.naturalWidth > 0 && sprite.naturalHeight > 0) {
                try {
                    this.ctx.drawImage(
                        sprite,
                        -enemySize / 2,
                        -enemySize / 2,
                        enemySize,
                        enemySize
                    );
                    rendered = true;
                } catch (error) {
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
                
                // Debug: Log when fallback circle is drawn
                if (Math.random() < 0.1) { // 10% chance
                    console.log(`[Graphics] Drew fallback circle for enemy at (${enemy.x.toFixed(1)}, ${enemy.y.toFixed(1)})`);
                }
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

        // Draw health bar (before restore, so it's in enemy's coordinate space)
        const healthBarWidth = enemySize;
        const healthBarHeight = 5;
        const healthBarY = -enemySize / 2 - 10;

        this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight);

        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
        this.ctx.fillRect(
            -healthBarWidth / 2,
            healthBarY,
            (enemy.health / enemy.maxHealth) * healthBarWidth,
            healthBarHeight
        );
        
        this.ctx.restore();

        // Draw enemy tier with tier color (after restore, so we need to set up transforms again)
        this.ctx.save();
        this.ctx.translate(enemy.x, enemy.y);
        this.ctx.fillStyle = this.ENEMY_COLORS[enemy.tier];
        this.ctx.textAlign = 'center';
        this.ctx.font = '12px Ubuntu, sans-serif'; // Made text bold for better visibility

        // Add black outline to text for better visibility
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.strokeText(enemy.tier.toUpperCase(), 0, enemySize / 2 + 20);

        // Draw the text
        this.ctx.fillText(enemy.tier.toUpperCase(), 0, enemySize / 2 + 20);

        // Draw DPS for target dummies
        if (enemy.type === 'target_dummy' && enemy.currentDPS !== undefined) {
            const dps = enemy.currentDPS || 0;
            const formattedDPS = this.formatNumber(dps);
            const dpsText = `DPS: ${formattedDPS}`;
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '10px Ubuntu, sans-serif';
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            const dpsY = enemySize / 2 + 40;
            this.ctx.strokeText(dpsText, 0, dpsY);
            this.ctx.fillText(dpsText, 0, dpsY);
        }

        this.ctx.restore();
    }

    /**
     * Darken a hex color by a specified percentage
     * @param hex - Hex color string (e.g., '#7eef6d')
     * @param percent - Percentage to darken (0-100, default 30)
     * @returns Darkened hex color string
     */
    private darkenColor(hex: string, percent: number = 30): string {
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

    private drawItem(item: WorldItem) {
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
        } else {
            // Draw other items with sprites
            const sprite = this.itemSprites[item.type];
            if (sprite) {
                this.ctx.drawImage(sprite, -15, -15, 30, 30);
            }
        }

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

    private drawWorldPetal(item: WorldItem) {
        if (!item.petalType || !item.rarity) return;

        const stats = getPetalStats(item.petalType, item.rarity);
        if (!stats) return;

        // Draw petal using cached image
        const size = 12 * stats.size;
        const petalKey = `${item.petalType}_${item.rarity}`;
        const petalCanvas = this.getPetalCanvas(petalKey, Date.now());
        
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
        } else {
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

    private drawFloatingTexts() {
        this.floatingTexts = this.floatingTexts.filter(text => {
            text.y -= 1;
            text.alpha -= 1 / text.lifetime;

            if (text.alpha <= 0) return false;

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

    private drawExplosionEffects() {
        this.explosionEffects = this.explosionEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            
            if (progress >= 1) return false;

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
                if (particleProgress <= 0) return false;
                
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

    private drawPetalBreakEffects() {
        this.petalBreakEffects = this.petalBreakEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            
            if (progress >= 1) return false;

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

    private drawLightningEffects() {
        this.lightningEffects = this.lightningEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            
            if (progress >= 1) return false;

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

    private drawPetalParticleEffects() {
        this.petalParticleEffects = this.petalParticleEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            
            if (progress >= 1) return false;

            this.ctx.save();
            
            // Draw particles
            effect.particles = effect.particles.filter(particle => {
                const particleProgress = particle.life / particle.maxLife;
                if (particleProgress <= 0) return false;
                
                // Update particle position
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.life -= 16; // Assuming 60fps, reduce by ~16ms per frame
                
                // Draw particle with white base color and faint rarity tinting
                this.ctx.globalAlpha = particleProgress * 0.6; // More visible particles
                
                // Create a gradient from white base to rarity color
                const gradient = this.ctx.createRadialGradient(
                    particle.x, particle.y, 0,
                    particle.x, particle.y, particle.size
                );
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

    // Minimap scrolling methods
    public scrollMinimap(deltaX: number, deltaY: number) {
        const MINIMAP_AREA_SIZE = 20000 / this.minimapZoom;
        const MAX_SCROLL_X = ACTUAL_WORLD_WIDTH - MINIMAP_AREA_SIZE;
        const MAX_SCROLL_Y = ACTUAL_WORLD_HEIGHT - MINIMAP_AREA_SIZE;
        
        this.minimapScrollX = Math.max(0, Math.min(MAX_SCROLL_X, this.minimapScrollX + deltaX));
        this.minimapScrollY = Math.max(0, Math.min(MAX_SCROLL_Y, this.minimapScrollY + deltaY));
    }

    public setMinimapScroll(x: number, y: number) {
        const MINIMAP_AREA_SIZE = 20000 / this.minimapZoom;
        const MAX_SCROLL_X = ACTUAL_WORLD_WIDTH - MINIMAP_AREA_SIZE;
        const MAX_SCROLL_Y = ACTUAL_WORLD_HEIGHT - MINIMAP_AREA_SIZE;
        
        this.minimapScrollX = Math.max(0, Math.min(MAX_SCROLL_X, x));
        this.minimapScrollY = Math.max(0, Math.min(MAX_SCROLL_Y, y));
    }

    public centerMinimapOnPlayer(playerX: number, playerY: number) {
        const MINIMAP_AREA_SIZE = 20000 / this.minimapZoom;
        const HALF_AREA = MINIMAP_AREA_SIZE / 2;
        
        this.setMinimapScroll(
            playerX - HALF_AREA,
            playerY - HALF_AREA
        );
    }

    public zoomInMinimap() {
        this.minimapZoom = Math.min(this.minimapZoom + this.MINIMAP_ZOOM_STEP, this.MINIMAP_MAX_ZOOM);
    }

    public zoomOutMinimap() {
        this.minimapZoom = Math.max(this.minimapZoom - this.MINIMAP_ZOOM_STEP, this.MINIMAP_MIN_ZOOM);
    }

    public setMinimapZoom(zoom: number) {
        this.minimapZoom = Math.max(this.MINIMAP_MIN_ZOOM, Math.min(this.MINIMAP_MAX_ZOOM, zoom));
    }

    public getMinimapZoom(): number {
        return this.minimapZoom;
    }

    public followPlayerOnMinimap(playerX: number, playerY: number) {
        // Automatically center minimap on player
        this.centerMinimapOnPlayer(playerX, playerY);
    }

    // Add minimap drawing
    private drawMinimap(players: Map<string, Player>, socket: string) {
        const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
        const minimapY = this.MINIMAP_PADDING;
        
        // Define the area to show on minimap (scaled by zoom level)
        const MINIMAP_AREA_SIZE = 20000 / this.minimapZoom;
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

        // Draw only walls on minimap (with scroll offset)
        this.mapData.forEach(element => {
            // Only draw walls
            if (element.type === 'wall') {
                const scaledX = minimapX + ((element.x - this.minimapScrollX) * minimapScale.x);
                const scaledY = minimapY + ((element.y - this.minimapScrollY) * minimapScale.y);
                const scaledWidth = element.width * minimapScale.x;
                const scaledHeight = element.height * minimapScale.y;

                // Only draw if the element is within the visible minimap area
                if (scaledX + scaledWidth > minimapX && scaledX < minimapX + this.MINIMAP_WIDTH &&
                    scaledY + scaledHeight > minimapY && scaledY < minimapY + this.MINIMAP_HEIGHT) {
                    this.ctx.fillStyle = '#000000'; // Black for walls
                    this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                }
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
                this.ctx.arc(
                    playerMinimapX,
                    playerMinimapY,
                    4, // Slightly larger dots
                    0,
                    Math.PI * 2
                );
                this.ctx.fill();
            }
        });

        // Draw viewport rectangle in black (with scroll offset)
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(
            minimapX + ((this.cameraX - this.minimapScrollX) * minimapScale.x),
            minimapY + ((this.cameraY - this.minimapScrollY) * minimapScale.y),
            (this.canvas.width / this.zoomLevel) * minimapScale.x,
            (this.canvas.height / this.zoomLevel) * minimapScale.y
        );

        // Restore context to remove clipping region
        this.ctx.restore();

        // Draw border
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    }

    private drawScrollingBackground() {
        // If background texture is not loaded or is broken, just fill with a color
        if (!this.backgroundTexture || !this.backgroundTexture.complete || this.backgroundTexture.naturalWidth === 0) {
            this.ctx.fillStyle = '#00d885'; // Default green color from the SVG
            this.ctx.fillRect(
                this.cameraX,
                this.cameraY,
                this.canvas.width / this.zoomLevel,
                this.canvas.height / this.zoomLevel
            );
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

        // Draw the tiled background
        for (let i = 0; i <= tilesX; i++) {
            for (let j = 0; j <= tilesY; j++) {
                const tileX = startX + (i * defaultBgWidth);
                const tileY = startY + (j * defaultBgHeight);
                
                // Check if this tile overlaps with any biome
                const biome = this.getBiomeAtPosition(tileX + defaultBgWidth / 2, tileY + defaultBgHeight / 2);
                
                if (biome && biome.properties?.biomeName && biome.properties?.backgroundTexture) {
                    // Use biome-specific texture if available
                    const biomeTexture = this.biomeTextures.get(biome.properties.biomeName);
                    
                    if (biomeTexture && biomeTexture.complete && biomeTexture.naturalWidth > 0) {
                        const biomeWidth = biomeTexture.width;
                        const biomeHeight = biomeTexture.height;
                        this.ctx.drawImage(biomeTexture, tileX, tileY, biomeWidth, biomeHeight);
                    } else {
                        // Fallback to default texture if biome texture not loaded
                        this.ctx.drawImage(this.backgroundTexture, tileX, tileY, defaultBgWidth, defaultBgHeight);
                    }
                } else {
                    // Use default texture
                    this.ctx.drawImage(this.backgroundTexture, tileX, tileY, defaultBgWidth, defaultBgHeight);
                }
            }
        }
    }

    public drawGameObjects(players: Map<string, Player>, enemies: Map<string, Enemy>, items: Map<string, WorldItem>, mobProjectiles: Map<string, any>, playerProjectiles: Map<string, any>, currentPlayerId: string, petalExtension: number = 1.0) {
        // Calculate viewport accounting for zoom level
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + scaledWidth,
            bottom: this.cameraY + scaledHeight
        };

        // Draw players
        for (const player of players.values()) {
            if (player.x > viewport.left - PLAYER_SIZE && player.x < viewport.right + PLAYER_SIZE &&
                player.y > viewport.top - PLAYER_SIZE && player.y < viewport.bottom + PLAYER_SIZE) {
                
                if (player.isDead) {
                    // Draw corpse for dead players
                    this.drawCorpse(player.x, player.y, player.angle);
                } else {
                    // Draw normal player
                    this.drawPlayer(player, currentPlayerId, petalExtension);
                }
            }
        }

        // Draw enemies
        const enemyCount = enemies.size;
        
        for (const enemy of enemies.values()) {
            // Calculate actual enemy size for accurate culling
            const mobStats = getMobStats(enemy.type, enemy.tier);
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
            } catch (error) {
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
                } catch (fallbackError) {
                    console.error('[Graphics] Fallback rendering also failed:', fallbackError);
                }
            }
        }

        // Draw items
        for (const item of items.values()) {
            // Add similar viewport culling for items
            this.drawItem(item);
        }

        // Draw mob projectiles
        for (const projectile of mobProjectiles.values()) {
            this.drawMobProjectile(projectile);
        }

        // Draw player projectiles
        for (const projectile of playerProjectiles.values()) {
            this.drawMobProjectile(projectile); // Reuse same drawing method
        }
    }

    public render(players: Map<string, Player>, enemies: Map<string, Enemy>, items: Map<string, WorldItem>, mobProjectiles: Map<string, any>, playerProjectiles: Map<string, any>, currentPlayerId: string, petalExtension: number = 1.0) {
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
        
        // Draw boss bars for ultra, super, and unique mobs in view
        this.drawBossBars(enemies);
    }
    public setupItemSprites(itemSprites: Record<string, HTMLImageElement>) {
        this.itemSprites = itemSprites;
    }

    public setPetalImagesFromPreloaded(imageCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]>) {
        this.petalImageCache = imageCache;
    }

    public async preloadPetalImages() {
        // This method is now deprecated - petal images should be preloaded via Preloader
        // This is kept as a fallback but should not be used
        console.warn('[Graphics] preloadPetalImages called - this should be handled by Preloader');
    }

    public drawCorpse(x: number, y: number, angle: number) {
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
