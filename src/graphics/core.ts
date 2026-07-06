import { Enemy } from '../enemy';
import { MapElement } from '../constants';
import { ITEM_RARITY_COLORS } from '../petals';
import { getSVGRenderer } from '../svg_renderer';
import { FloatingText, ExplosionEffect, ExplosionParticle, PetalBreakEffect, LightningEffect, PetalParticleEffect, PetalParticle, FallingStar } from './types';
import { getBaseDeviceScale } from '../zoom-compensation';

export { Player, FaceFlags, EquipmentFlags } from '../player';
export { Enemy } from '../enemy';
export { Item, WorldItem } from '../item';
export { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE, getMobAnimationFrameTime, getHighQualityMobs, WALL_GRID, WALL_TILE_SIZE, WALL_GRID_WIDTH, WALL_GRID_HEIGHT, worldToTileX, worldToTileY, tileToWorldX, tileToWorldY, getTileState, WallTileState, SECTION_CONFIGS, seededRandom, getTileJaggedEdges, JaggedPoint } from '../constants';
export { getPetalStats, getAllPetalTypes, isUndroppableEggPetalType } from '../petals';
export { getMobStats, getAllMobTypes, getMobTypesBySection, MOB_CONFIG } from '../mobs';
export { getSVGRenderer } from '../svg_renderer';
export { FloatingText, ExplosionEffect, ExplosionParticle, PetalBreakEffect, LightningEffect, PetalParticleEffect, PetalParticle, FallingStar, FlowerRenderAttributes } from './types';

// Blend a #rrggbb hex color toward white by `amount` in [0, 1] and return
// an `rgb(r,g,b)` string ready to assign to `ctx.fillStyle`. Used for drop
// burst particles so the per-frame draw loop stays free of string parsing.
function blendHexWithWhite(hex: string, amount: number): string {
    const h = hex.charCodeAt(0) === 35 /* '#' */ ? hex.slice(1) : hex;
    const cr = parseInt(h.substring(0, 2), 16);
    const cg = parseInt(h.substring(2, 4), 16);
    const cb = parseInt(h.substring(4, 6), 16);
    const br = Math.round(cr + (255 - cr) * amount);
    const bg = Math.round(cg + (255 - cg) * amount);
    const bb = Math.round(cb + (255 - cb) * amount);
    return `rgb(${br},${bg},${bb})`;
}

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
    public leaderboardManager: any = null;
    public guildMenuManager: any = null;

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
        unique: '#ffffff',
        apex: '#ff00ff'
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
        unique: 3.5,
        apex: 4.0
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
        unique: 4050,
        apex: 12150
    };
    public readonly ITEM_RARITY_COLORS = ITEM_RARITY_COLORS;
    // Track invulnerability fade-out per player: maps playerId -> timestamp when invulnerability ended
    public invulFadeStates: Map<string, { endTime: number, wasInvulnerable: boolean }> = new Map();
    public readonly INVUL_FADE_DURATION = 500; // ms to fade from yellow back to green

    public showHitboxes: boolean = false;
    public showRarityGlow: boolean = false;
    public altKeyPressed: boolean = false;

    // Render scale (1.0 = full native resolution, lower = lower-res buffer
    // stretched to fill the screen). Trades sharpness for GPU work — useful
    // when many drops/effects are on screen.
    public renderScale: number = 1.0;
    public antialiasing: boolean = true;

    // HiDPI: the main canvas backing store is physical pixels (logical ×
    // uiScale). All drawing works in *logical* coordinates — render() applies
    // a base scale(uiScale) so world and UI render at native resolution.
    // viewW/viewH are the logical (CSS) dimensions; use these instead of
    // this.canvas.width/height for layout and world-view culling.
    public uiScale: number = 1.0;
    public viewW: number = 0;
    public viewH: number = 0;

    /** Recompute logical dimensions + device scale from the (already-sized) main canvas. */
    public syncViewMetrics(): void {
        this.uiScale = getBaseDeviceScale();
        this.viewW = this.canvas.width / this.uiScale;
        this.viewH = this.canvas.height / this.uiScale;
    }

    // Low-res offscreen buffer used only when renderScale < 1: the world is
    // drawn here, then stretched up onto the main canvas, trading sharpness
    // for GPU fill work.
    public worldCanvas: HTMLCanvasElement | null = null;
    public worldCtx: CanvasRenderingContext2D | null = null;

    public syncWorldCanvasSize(): void {
        if (this.renderScale >= 1) {
            this.worldCanvas = null;
            this.worldCtx = null;
            return;
        }
        // Buffer is renderScale of the main canvas's *physical* resolution, so
        // 50% means half of native.
        const w = Math.max(1, Math.round(this.canvas.width * this.renderScale));
        const h = Math.max(1, Math.round(this.canvas.height * this.renderScale));
        if (!this.worldCanvas) {
            this.worldCanvas = document.createElement('canvas');
        }
        if (this.worldCanvas.width !== w || this.worldCanvas.height !== h) {
            this.worldCanvas.width = w;
            this.worldCanvas.height = h;
        }
        this.worldCtx = this.worldCanvas.getContext('2d');
    }
    public dynamicSkybox: boolean = false;
    public mobDeathAnimation: boolean = true;
    public itemSprites: Record<string, HTMLImageElement> = {};
    public petalImageCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]> = {};
    public petalGlowCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]> = {};
    public spawnZoneElements: MapElement[] = [];
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
    public irisTitleScreen: boolean = false;
    public irisOnComplete: (() => void) | null = null;
    public readonly IRIS_TRANSITION_DURATION: number = 800;
    public readonly IRIS_OUTLINE_WIDTH: number = 6;

    // Canvas-based death screen
    public deathScreenVisible: boolean = false;
    public deathScreenKilledBy: string = '';
    public deathScreenButtonRect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 0, h: 0 };
    public deathScreenCloseRect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 0, h: 0 };
    public deathScreenButtonHovered: boolean = false;
    public deathScreenCloseHovered: boolean = false;

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

    // Per-section timing for the stats overlay. Filled in by drawGameObjects;
    // accumulated and rolled over once per second by Game.gameLoop alongside
    // the existing frame-time average.
    public perfItemsMs: number = 0;
    public perfItemsCount: number = 0;
    public perfMobsMs: number = 0;
    public perfProjectilesMs: number = 0;

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

    public static readonly PETAL_GLOW_PAD = 16;

    private bakePetalGlow(src: HTMLCanvasElement, glowColor: string): HTMLCanvasElement {
        const PAD = Graphics.PETAL_GLOW_PAD;
        const out = document.createElement('canvas');
        out.width = src.width + PAD * 2;
        out.height = src.height + PAD * 2;
        const octx = out.getContext('2d');
        if (!octx) return src;
        octx.drawImage(src, PAD, PAD);
        octx.shadowColor = glowColor;
        octx.shadowBlur = 8;
        for (let g = 0; g < 6; g++) {
            octx.drawImage(src, PAD, PAD);
        }
        return out;
    }

    public getPetalGlowCanvas(petalKey: string, rarity: string, time: number = Date.now()): HTMLCanvasElement | null {
        let cached = this.petalGlowCache[petalKey];
        if (!cached) {
            const src = this.petalImageCache[petalKey];
            if (!src) return null;
            const glowColor = this.ITEM_RARITY_COLORS[rarity as keyof typeof this.ITEM_RARITY_COLORS] || '#ffffff';
            cached = Array.isArray(src)
                ? src.map(frame => this.bakePetalGlow(frame, glowColor))
                : this.bakePetalGlow(src, glowColor);
            this.petalGlowCache[petalKey] = cached;
        }
        if (Array.isArray(cached)) {
            const frameIndex = Math.floor((time / 42) % cached.length);
            return cached[frameIndex];
        }
        return cached;
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
        this.spawnZoneElements = mapData.filter(e => e.type === 'spawn');
        // The cached chunks were rendered against the previous map data —
        // biome boundaries and section colors may have shifted, so flush.
        this.invalidateStaticMapCache?.();
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
                x: Math.random() * this.viewW,
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
        if (!['ultra', 'super', 'unique', 'apex'].includes(rarity)) {
            return;
        }

        const particles: PetalParticle[] = [];
        const particleCount = 8;

        const rarityColor = this.ITEM_RARITY_COLORS[rarity as keyof typeof this.ITEM_RARITY_COLORS] || '#ffffff';
        const blendedColor = blendHexWithWhite(rarityColor, 0.5);

        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
            const speed = 0.5 + Math.random() * 0.5;
            const particleLife = 2000 + Math.random() * 1000;

            particles.push({
                x: x + (Math.random() - 0.5) * 4,
                y: y + (Math.random() - 0.5) * 4,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: particleLife,
                maxLife: particleLife,
                size: 1 + Math.random() * 2,
                color: blendedColor,
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

    public showItemDropBurst(x: number, y: number, rarity: string) {
        const rarityColor = this.ITEM_RARITY_COLORS[rarity as keyof typeof this.ITEM_RARITY_COLORS] || '#ffffff';
        const blendedColor = blendHexWithWhite(rarityColor, 0.5);

        const particles: PetalParticle[] = [];
        const particleCount = 10;

        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
            const speed = 1.5 + Math.random() * 1.5;
            const particleLife = 400 + Math.random() * 200;

            particles.push({
                x: x + (Math.random() - 0.5) * 4,
                y: y + (Math.random() - 0.5) * 4,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: particleLife,
                maxLife: particleLife,
                size: 2 + Math.random() * 2,
                color: blendedColor,
                baseColor: blendedColor
            });
        }

        this.petalParticleEffects.push({
            x,
            y,
            rarity,
            particles,
            lifetime: 700,
            startTime: Date.now()
        });
    }

    public setBiomeTexture(biomeName: string, texture: HTMLImageElement) {
        this.biomeTextures.set(biomeName, texture);
        // Any cached chunks rendered before this texture arrived used the
        // fallback color — drop them so they get re-baked with the texture.
        this.invalidateStaticMapCache?.();
    }

    public setSectionTexture(sectionIndex: number, texture: HTMLImageElement) {
        this.sectionTextures.set(sectionIndex, texture);
        this.invalidateStaticMapCache?.();
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

    public setLeaderboardManager(leaderboardManager: any): void {
        this.leaderboardManager = leaderboardManager;
        if (leaderboardManager && this.canvas) {
            leaderboardManager.setCanvas(this.canvas);
        }
    }

    public setGuildMenuManager(guildMenuManager: any): void {
        this.guildMenuManager = guildMenuManager;
        if (guildMenuManager && this.canvas) {
            guildMenuManager.setCanvas(this.canvas);
        }
    }

    public skinStudioManager: any = null;
    public setSkinStudio(skinStudioManager: any): void {
        this.skinStudioManager = skinStudioManager;
        if (skinStudioManager && this.canvas) {
            skinStudioManager.setCanvas(this.canvas);
        }
    }

    /**
     * Wire the title-screen canvas-button strip into the in-game render loop
     * so the same icon buttons (settings/changelog/.../exit + bottom-left
     * panels) draw on top of the gameCanvas while the game is running.
     * Mouse events on the gameCanvas are intercepted in the capture phase so
     * a click on a button doesn't also leak through to player controls.
     */
    public titleCanvasButtons: any = null;
    private titleButtonListenersAttached: boolean = false;
    public setTitleCanvasButtons(buttons: any): void {
        this.titleCanvasButtons = buttons;
        if (this.titleButtonListenersAttached || !this.canvas || !buttons) return;
        this.titleButtonListenersAttached = true;

        const toLocal = (e: MouseEvent): { x: number; y: number } => {
            const r = this.canvas!.getBoundingClientRect();
            // Logical coordinates: divide the physical backing-store ratio by
            // the device scale so hit-testing matches the logical layout.
            const s = getBaseDeviceScale();
            return {
                x: (e.clientX - r.left) * (this.canvas!.width / r.width) / s,
                y: (e.clientY - r.top) * (this.canvas!.height / r.height) / s,
            };
        };

        // Capture phase + stopImmediatePropagation when the press/release lands
        // on a button — that prevents the bubble-phase player-control handlers
        // (registered later on the same canvas) from running.
        this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
            const { x, y } = toLocal(e);
            if (buttons.press(x, y)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);

        this.canvas.addEventListener('mouseup', (e: MouseEvent) => {
            const { x, y } = toLocal(e);
            if (buttons.releaseClick(x, y)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);

        // Swallow the matching `click` event when the press/release landed on
        // a button. Without this, game.ts's click handler still fires —
        // forwarding to settings.handleClick when settings has just opened,
        // which interprets the off-panel click as click-outside-to-dismiss
        // and closes settings on the same click that opened it.
        this.canvas.addEventListener('click', (e: MouseEvent) => {
            const { x, y } = toLocal(e);
            if (buttons.isPointOnButton(x, y)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);

        // Hover doesn't need to block propagation — game cursor tracking still
        // wants to see the move events.
        this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
            const { x, y } = toLocal(e);
            buttons.setHover(x, y);
        });

        this.canvas.addEventListener('mouseleave', () => {
            buttons.clearHover();
        });

        // Document-level mouseup so a press that ends outside the canvas still
        // clears the pressed state — same pattern TitleScreen uses.
        document.addEventListener('mouseup', () => {
            buttons.release();
        });
    }

    public setupItemSprites(itemSprites: Record<string, HTMLImageElement>) {
        this.itemSprites = itemSprites;
    }

    public setPetalImagesFromPreloaded(imageCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]>) {
        this.petalImageCache = imageCache;
        this.petalGlowCache = {};
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
