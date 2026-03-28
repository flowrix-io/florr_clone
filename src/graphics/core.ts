import { Player, FaceFlags, EquipmentFlags } from '../player';
import { Enemy } from '../enemy';
import { Item, WorldItem } from '../item';
import { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE, getMobAnimationFrameTime, getHighQualityMobs, WALL_GRID, WALL_TILE_SIZE, WALL_GRID_WIDTH, WALL_GRID_HEIGHT, worldToTileX, worldToTileY, tileToWorldX, tileToWorldY, getTileState, WallTileState, SECTION_CONFIGS, seededRandom, getTileJaggedEdges, JaggedPoint } from '../constants';
import { getPetalStats, getAllPetalTypes } from '../petals';
import { getMobStats, getAllMobTypes, getMobTypesBySection, MOB_CONFIG } from '../mobs';
import { getSVGRenderer } from '../svg_renderer';
import { FloatingText, ExplosionEffect, ExplosionParticle, PetalBreakEffect, LightningEffect, PetalParticleEffect, PetalParticle, FallingStar, FlowerRenderAttributes } from './types';

export { Player, FaceFlags, EquipmentFlags } from '../player';
export { Enemy } from '../enemy';
export { Item, WorldItem } from '../item';
export { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE, getMobAnimationFrameTime, getHighQualityMobs, WALL_GRID, WALL_TILE_SIZE, WALL_GRID_WIDTH, WALL_GRID_HEIGHT, worldToTileX, worldToTileY, tileToWorldX, tileToWorldY, getTileState, WallTileState, SECTION_CONFIGS, seededRandom, getTileJaggedEdges, JaggedPoint } from '../constants';
export { getPetalStats, getAllPetalTypes } from '../petals';
export { getMobStats, getAllMobTypes, getMobTypesBySection, MOB_CONFIG } from '../mobs';
export { getSVGRenderer } from '../svg_renderer';
export { FloatingText, ExplosionEffect, ExplosionParticle, PetalBreakEffect, LightningEffect, PetalParticleEffect, PetalParticle, FallingStar, FlowerRenderAttributes } from './types';

export class Graphics {
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    public cameraX: number = 0;
    public cameraY: number = 0;
    public zoomLevel: number = 1.0;
    public playerSprite: HTMLImageElement;
    public frameTimestamp: number = 0;
    public floatingTexts: FloatingText[] = [];
    public lastDamageTextTime: Map<string, number> = new Map();
    public accumulatedDamage: Map<string, number> = new Map();
    public readonly MAX_FLOATING_TEXTS = 50;
    public readonly DAMAGE_TEXT_COOLDOWN = 100;
    public explosionEffects: ExplosionEffect[] = [];
    public petalBreakEffects: PetalBreakEffect[] = [];
    public lightningEffects: LightningEffect[] = [];
    public petalParticleEffects: PetalParticleEffect[] = [];
    public fallingStars: FallingStar[] = [];
    public readonly MAX_FALLING_STARS = 20;
    public mapData: MapElement[] = [];
    public changelogManager: any = null;
    public notificationsManager: any = null;

    public readonly MINIMAP_WIDTH = 200;
    public readonly MINIMAP_HEIGHT = 200;
    public readonly MINIMAP_PADDING = 10;
    public minimapScrollX = 0;
    public minimapScrollY = 0;
    public minimapZoom = 1.0;
    public readonly MINIMAP_MIN_ZOOM = 0.5;
    public readonly MINIMAP_MAX_ZOOM = 3.0;
    public readonly MINIMAP_ZOOM_STEP = 0.2;
    public playerEye: { x: number, y: number } = { x: 0, y: 0 };

    // Petal physics state
    public petalPhysicsStates = new Map<string, { vx: number; vy: number; x: number; y: number; lastUpdateTime: number; spawnTime?: number; lastPlayerX?: number; lastPlayerY?: number }>();
    public readonly ATTRACTION_FORCE = 50;
    public readonly SPRING_FORCE = 700;
    public readonly DAMPING = 0.72;
    public readonly MAX_ATTRACTION_DISTANCE = 2000;
    public readonly MIN_ATTRACTION_DISTANCE = 1;
    public readonly SPAWN_SMOOTH_TIME = 300;
    public wallTexture: HTMLImageElement = new Image();
    public healthPotionSprite: HTMLImageElement = new Image();
    public speedBoostSprite: HTMLImageElement = new Image();
    public shieldSprite: HTMLImageElement = new Image();
    public backgroundTexture: HTMLImageElement = new Image();
    public biomeTextures: Map<string, HTMLImageElement> = new Map();
    public sectionTextures: Map<number, HTMLImageElement> = new Map();
    public readonly MAP_COLORS = {
        wall: 'rgba(102, 102, 102, 0.0)',
        spawn: 'rgba(76, 175, 80, 0.0)',
        teleporter: 'rgba(33, 150, 243, 0.0)',
        safe_zone: 'rgba(255, 193, 7, 0.0)',
        biome: 'rgba(128, 64, 192, 0.0)'
    };
    public readonly ENEMY_COLORS = {
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
    public readonly ENEMY_SIZE_MULTIPLIERS: Record<Enemy['tier'], number> = {
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
    public readonly ENEMY_MAX_HEALTH: Record<Enemy['tier'], number> = {
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
    public readonly ITEM_RARITY_COLORS = {
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
    // Track invulnerability fade-out per player: maps playerId -> timestamp when invulnerability ended
    public invulFadeStates: Map<string, { endTime: number, wasInvulnerable: boolean }> = new Map();
    public readonly INVUL_FADE_DURATION = 500; // ms to fade from yellow back to green

    public showHitboxes: boolean = false;
    public showRarityGlow: boolean = false;
    public altKeyPressed: boolean = false;
    public dynamicSkybox: boolean = false;
    public mobDeathAnimation: boolean = true;
    public itemSprites: Record<string, HTMLImageElement> = {};
    public petalImageCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]> = {};
    public mobSVGCache: Record<string, string> = {};
    public svgRenderer = getSVGRenderer();

    // Section-based texture loading state
    public currentSection: number = -1;
    public loadedSections: Set<number> = new Set();
    public loadingMobs: Set<string> = new Set();
    public mobBaseCacheKeys: Map<string, string> = new Map();

    // Iris transition (circle reveal) animation
    public irisTransitionActive: boolean = false;
    public irisTransitionStartTime: number = 0;
    public irisScreenshot: HTMLCanvasElement | null = null;
    public irisClosing: boolean = false;
    public irisOnComplete: (() => void) | null = null;
    public readonly IRIS_TRANSITION_DURATION: number = 800;
    public readonly IRIS_OUTLINE_WIDTH: number = 6;

    // Console log overlay
    public showConsoleLogs_: boolean = false;
    public consoleLogs: { text: string; color: string; timestamp: number }[] = [];
    public readonly MAX_CONSOLE_LOGS = 20;
    public readonly CONSOLE_LOG_LIFETIME = 10000;
    public originalConsoleLog: ((...args: any[]) => void) | null = null;
    public originalConsoleWarn: ((...args: any[]) => void) | null = null;
    public originalConsoleError: ((...args: any[]) => void) | null = null;

    // Cached eligible petal types for garbage pile drawing
    public cachedEligiblePetalTypes: string[] | null = null;

    constructor(
        canvas: HTMLCanvasElement,
        playerSprite: HTMLImageElement,
        wallTexture: HTMLImageElement,
        healthPotionSprite: HTMLImageElement,
        speedBoostSprite: HTMLImageElement,
        shieldSprite: HTMLImageElement,
        backgroundTexture: HTMLImageElement
    ) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d')!;
        this.playerSprite = playerSprite;
        this.wallTexture = wallTexture;
        this.healthPotionSprite = healthPotionSprite;
        this.speedBoostSprite = speedBoostSprite;
        this.shieldSprite = shieldSprite;
        this.backgroundTexture = backgroundTexture;

        // Preload all mob SVG images
        this.preloadMobImages();

        // Initialize console log overlay from saved setting
        if (localStorage.getItem('showConsoleLogs') === 'true') {
            this.setShowConsoleLogs(true);
        }
    }

    public getPetalCanvas(petalKey: string, time: number = Date.now()): HTMLCanvasElement | null {
        const petalImage = this.petalImageCache[petalKey];
        if (!petalImage) {
            return null;
        }

        if (Array.isArray(petalImage)) {
            const frameIndex = Math.floor((time / 42) % petalImage.length);
            return petalImage[frameIndex];
        } else {
            return petalImage;
        }
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
        if (this.floatingTexts.length >= this.MAX_FLOATING_TEXTS) {
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

    public showDamageText(enemyId: string, x: number, y: number, damage: number) {
        const now = Date.now();
        const lastTime = this.lastDamageTextTime.get(enemyId) || 0;

        if (now - lastTime < this.DAMAGE_TEXT_COOLDOWN) {
            const currentAccumulated = this.accumulatedDamage.get(enemyId) || 0;
            this.accumulatedDamage.set(enemyId, currentAccumulated + damage);
            return;
        }

        const accumulated = this.accumulatedDamage.get(enemyId) || 0;
        const totalDamage = accumulated + damage;

        if (totalDamage > 0) {
            this.lastDamageTextTime.set(enemyId, now);
            this.accumulatedDamage.delete(enemyId);
            this.showFloatingText(x, y - 20, `-${Math.round(totalDamage)}`, '#ff0000', 16);
        }
    }

    public getAccumulatedDamage(enemyId: string): number {
        return this.accumulatedDamage.get(enemyId) || 0;
    }

    public clearPetalPhysicsForPlayer(playerId: string): void {
        const keysToDelete: string[] = [];
        this.petalPhysicsStates.forEach((value, key) => {
            if (key.startsWith(playerId)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => this.petalPhysicsStates.delete(key));
    }

    public clearEnemyDamage(enemyId: string) {
        this.lastDamageTextTime.delete(enemyId);
        this.accumulatedDamage.delete(enemyId);
    }

    public showExplosionEffect(x: number, y: number, radius: number) {
        const particles: ExplosionParticle[] = [];
        const particleCount = Math.min(50, Math.max(10, radius / 5));

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

    public showPetalBreakEffect(x: number, y: number, petalType: string) {
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

    public showFallingStars() {
        const currentCount = this.fallingStars.length;
        const starsToAdd = Math.min(this.MAX_FALLING_STARS - currentCount, this.MAX_FALLING_STARS);

        if (starsToAdd <= 0) return;

        for (let i = 0; i < starsToAdd; i++) {
            this.fallingStars.push({
                x: Math.random() * this.canvas.width,
                y: -20 - Math.random() * 50,
                vy: 2 + Math.random() * 3,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.1,
                size: 8 + Math.random() * 12,
                alpha: 0.8 + Math.random() * 0.2,
                lifetime: 2000 + Math.random() * 1000,
                maxLife: 2000 + Math.random() * 1000
            });
        }
    }

    public showLightningEffect(x: number, y: number, targets: { x: number; y: number; enemyId: string }[], damage: number) {
        this.lightningEffects.push({
            x,
            y,
            targets,
            damage,
            lifetime: 500,
            startTime: Date.now(),
            alpha: 1.0
        });
    }

    public showPetalParticleEffect(x: number, y: number, rarity: string) {
        if (!['ultra', 'super', 'unique'].includes(rarity)) {
            return;
        }

        const particles: PetalParticle[] = [];
        const particleCount = 8;

        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
            const speed = 0.5 + Math.random() * 0.5;
            const particleLife = 2000 + Math.random() * 1000;

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
                baseColor: '#ffffff'
            });
        }

        this.petalParticleEffects.push({
            x,
            y,
            rarity,
            particles,
            lifetime: 3000,
            startTime: Date.now()
        });
    }

    public setBiomeTexture(biomeName: string, texture: HTMLImageElement) {
        this.biomeTextures.set(biomeName, texture);
    }

    public setSectionTexture(sectionIndex: number, texture: HTMLImageElement) {
        this.sectionTextures.set(sectionIndex, texture);
    }

    public setChangelogManager(changelogManager: any): void {
        this.changelogManager = changelogManager;
        if (changelogManager && this.canvas) {
            changelogManager.setCanvas(this.canvas);
        }
    }

    public setNotificationsManager(notificationsManager: any): void {
        this.notificationsManager = notificationsManager;
        if (notificationsManager && this.canvas) {
            notificationsManager.setCanvas(this.canvas);
        }
    }

    public setupItemSprites(itemSprites: Record<string, HTMLImageElement>) {
        this.itemSprites = itemSprites;
    }

    public setPetalImagesFromPreloaded(imageCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]>) {
        this.petalImageCache = imageCache;
    }

    public async preloadPetalImages() {
        console.warn('[Graphics] preloadPetalImages called - this should be handled by Preloader');
    }

    public static gcd(a: number, b: number): number {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b > 0) {
            [a, b] = [b, a % b];
        }
        return a;
    }

    public static lcm(a: number, b: number): number {
        if (a === 0 || b === 0) return 0;
        return Math.abs(Math.round(a) * Math.round(b)) / Graphics.gcd(a, b);
    }

    public static darkenColor(hex: string, factor: number): string {
        hex = hex.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
    }

    public static mixColors(c1: string, c2: string, t: number): string {
        c1 = c1.replace('#', '');
        c2 = c2.replace('#', '');
        const r1 = parseInt(c1.substring(0, 2), 16);
        const g1 = parseInt(c1.substring(2, 4), 16);
        const b1 = parseInt(c1.substring(4, 6), 16);
        const r2 = parseInt(c2.substring(0, 2), 16);
        const g2 = parseInt(c2.substring(2, 4), 16);
        const b2 = parseInt(c2.substring(4, 6), 16);
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
}
