import { Enemy } from '../enemy';
import { Entity } from '../ecs';
import { MapElement, getDisableUltraParticles, getGpuAcceleration } from '../constants';
import { ITEM_RARITY_COLORS } from '../petals';
import { getSVGRenderer } from '../svg_renderer';
import { FloatingText, ExplosionEffect, ExplosionParticle, PetalBreakEffect, LightningEffect, PetalParticleEffect, PetalParticle, FallingStar } from './types';
import { getBaseDeviceScale } from '../zoom-compensation';
import { markMainCanvasCtxCommitted } from './canvas_ctx_state';

export { Player, FaceFlags, EquipmentFlags } from '../player';
export { Enemy } from '../enemy';
export { Item, WorldItem } from '../item';
export { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE, getMobAnimationFrameTime, getHighQualityMobs, WALL_GRID, WALL_TILE_SIZE, WALL_GRID_WIDTH, WALL_GRID_HEIGHT, worldToTileX, worldToTileY, tileToWorldX, tileToWorldY, getTileState, WallTileState, SECTION_CONFIGS, seededRandom, getTileJaggedEdges, JaggedPoint } from '../constants';
export { getPetalStats, getAllPetalTypes, isUndroppableEggPetalType } from '../petals';
export { getMobStats, getAllMobTypes, getMobTypesBySection, getEnemySizeScale, MOB_CONFIG, PETAL_RING_ORBIT_SCALE, PETAL_RING_PETAL_SCALE, PETAL_RING_ROTATION_SPEED } from '../mobs';
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
        // Match the main canvas's backing (GPU vs software) — see the
        // getContext call in the constructor and getGpuAcceleration.
        this.worldCtx = this.worldCanvas.getContext('2d', { willReadFrequently: !getGpuAcceleration() });
    }
    public dynamicSkybox: boolean = false;
    public mobDeathAnimation: boolean = true;
    public itemSprites: Record<string, HTMLImageElement> = {};
    public petalImageCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]> = {};
    public petalGlowCache: Record<string, HTMLCanvasElement | HTMLCanvasElement[]> = {};
    public spawnZoneElements: MapElement[] = [];
    public mobSVGCache: Record<string, string> = {};
    // Baked radial-gradient glow sprites for emissive mobs/petals, keyed by
    // `${hexColor}_${radius}` (radius is already quantized per mob config).
    public glowSpriteCache: Record<string, HTMLCanvasElement> = {};
    // Baked mob name + rarity + bar-background overlays, keyed
    // `${type}_${tier}_${barWidth}`. Cells in the shared atlas sheets — a
    // per-label canvas would put ~80 unique sources back on the hot path.
    public mobLabelCache: Record<string, { canvas: HTMLCanvasElement; sx: number; sy: number; w: number; h: number }> = {};
    // Baked minimap static layers (bg/zones/walls/teleporters); key is the
    // section-snapped scroll + ALT-glow state. Player dots stay dynamic.
    public minimapStaticCache: { key: string; canvas: HTMLCanvasElement } | null = null;
    // Same idea for the maze minimap's walkable/zone layers, keyed per maze.
    public mazeMinimapStaticCache: { key: string; canvas: HTMLCanvasElement } | null = null;
    // Boss-bar candidates (super/unique mobs), refreshed at 4Hz by drawBossBars
    // instead of scanning the whole enemies Map every frame.
    // Entity HANDLES, not objects. A handle packs a generation, so a recycled
    // slot can never silently alias the stale candidate to a different mob —
    // which is the aliasing the "always re-resolve by id" comment used to guard
    // against by hand.
    public _bossCandidates: Entity[] = [];
    public _bossCandidatesAt: number = 0;
    // World (camera) transform snapshot, refreshed by drawGameObjects each
    // frame. Lets drawEnemy position mobs with one setTransform instead of
    // save()/translate/rotate/restore — ctx.save() snapshots the full context
    // state and was ~40% of the whole mobs section under CPU throttling.
    // Plain numbers, NOT a DOMMatrix: DOMMatrix fields are native accessors
    // and the DOMMatrix setTransform overload is far slower than the
    // 6-number one (measured — it gave the savings right back).
    public _worldBaseTf: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
    // Scratch lists of the mobs drawn this frame (and their sizes), reused
    // across frames. drawGameObjects fills them during the body loop and
    // drains them in the single world-frame health-bar pass.
    public _hbEnemies: Entity[] = [];
    public _hbSizes: number[] = [];
    public svgRenderer = getSVGRenderer();

    // Section-based texture loading state
    public currentSection: number = -1;
    public loadedSections: Set<number> = new Set();
    public loadingMobs: Set<string> = new Set();
    public mobBaseCacheKeys: Map<string, string> = new Map();

    // In-world teleporter wipe (see graphics/iris-transition.ts). Scene changes
    // use AppShell's transition, not this.
    public irisTransitionActive: boolean = false;
    public irisTransitionStartTime: number = 0;
    public irisScreenshot: HTMLCanvasElement | null = null;
    public irisClosing: boolean = false;
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
        // willReadFrequently:true forces software (CPU) rasterization — this is
        // the "Enable GPU Acceleration" setting's off state (see getGpuAcceleration).
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: !getGpuAcceleration() })!;
        // The main-canvas 2D context's backing (GPU vs software) is locked in
        // by the getContext call above and can't change on a live canvas — the
        // settings toggle reloads the page when this flag is set.
        markMainCanvasCtxCommitted();
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

    // --- Mob rendering ----------------------------------------------------
    // Mobs draw straight from their compiled SVG canvas commands every frame
    // (see drawEnemy). A bitmap bake in front of this was tried (e847451) and
    // removed after measurement: it saved ~0.5ms/frame at 100 mobs while
    // costing first-sight bake stalls (18ms in a single frame — the "lagspike
    // when moving"), an atlas that reached GBs because nothing ever evicted it,
    // and animation quantized to the baked frame count. Past ~256px the live
    // path is faster than blitting a bake anyway. Don't reintroduce it without
    // numbers that beat those. The shared atlas below stays — mob LABEL
    // overlays still use it, and they're small, static, and few.

    // ---- Shared atlas sheets ------------------------------------------
    // All baked mob frames and label overlays are shelf-packed into a few
    // large shared canvases. This is the load-bearing property of the whole
    // bake system: canvas 2D pays a per-unique-source cost on every frame it
    // references a source (software: op-buffer image pinning; GPU: texture
    // bind/upload). ~80 distinct source canvases per frame measured 20-200ms
    // per frame (software) and GPU upload thrash (Pi at GPU 100%); the same
    // draws against 1-3 shared sheets are ~free. Do NOT go back to
    // per-mob-type canvases.
    public _atlasSheets: HTMLCanvasElement[] = [];
    private _atlasCursor = { sheet: -1, x: 0, y: 0, rowH: 0 };
    // 2048² (16MB) per sheet, NOT larger: Chrome's GPU image cache has a
    // per-item size cap — a 4096² (64MB) canvas source never caches and
    // re-uploads every frame (~10ms/frame each, measured). 2048² sheets stay
    // resident. Frames larger than a sheet get their own dedicated canvas.
    private static readonly ATLAS_SHEET_SIDE = 2048;
    private static readonly ATLAS_PAD = 2; // gutter so bilinear sampling can't bleed neighbors

    /** Shelf-pack a w×h cell into the shared sheets; returns sheet + origin. */
    public atlasAlloc(w: number, h: number): { canvas: HTMLCanvasElement; x: number; y: number } {
        const S = Graphics.ATLAS_SHEET_SIDE;
        const wp = Math.min(S, w + Graphics.ATLAS_PAD);
        const hp = Math.min(S, h + Graphics.ATLAS_PAD);
        const cur = this._atlasCursor;
        if (cur.sheet >= 0) {
            if (cur.x + wp > S) { cur.y += cur.rowH; cur.x = 0; cur.rowH = 0; }
            if (cur.y + hp > S) cur.sheet = -1; // sheet full → open a new one
        }
        if (cur.sheet < 0) {
            const c = document.createElement('canvas');
            c.width = c.height = S;
            this._atlasSheets.push(c);
            cur.sheet = this._atlasSheets.length - 1;
            cur.x = 0; cur.y = 0; cur.rowH = 0;
        }
        const out = { canvas: this._atlasSheets[cur.sheet], x: cur.x, y: cur.y };
        cur.x += wp;
        if (hp > cur.rowH) cur.rowH = hp;
        return out;
    }


    /**
     * Baked radial glow sprite (transparent gradient disc). Replaces the
     * per-entity-per-frame createRadialGradient + rgba-string building in the
     * emissive mob/petal paths. The sprite is drawn with drawImage at the
     * emitter's position; alpha handling is unchanged.
     */
    public getGlowSprite(hexColor: string, radius: number): HTMLCanvasElement {
        // Bake capped at 256px radius and let drawImage scale up — a radial
        // gradient upscales invisibly, and an uncapped light_radius 2000 glow
        // bakes a 4000x4000 (61MB) texture: pure texel bandwidth + memory on
        // weak GPUs. The cap also quantizes the cache key.
        const r = Math.min(256, Math.max(2, radius | 0));
        const key = `${hexColor}_${r}`;
        let c = this.glowSpriteCache[key];
        if (!c) {
            c = document.createElement('canvas');
            c.width = c.height = r * 2;
            const cctx = c.getContext('2d')!;
            const rr = parseInt(hexColor.slice(1, 3), 16);
            const gg = parseInt(hexColor.slice(3, 5), 16);
            const bb = parseInt(hexColor.slice(5, 7), 16);
            const grad = cctx.createRadialGradient(r, r, 0, r, r, r);
            grad.addColorStop(0, `rgba(${rr},${gg},${bb},0.6)`);
            grad.addColorStop(0.4, `rgba(${rr},${gg},${bb},0.25)`);
            grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
            cctx.fillStyle = grad;
            cctx.beginPath();
            cctx.arc(r, r, r, 0, Math.PI * 2);
            cctx.fill();
            this.glowSpriteCache[key] = c;
        }
        return c;
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

    // Poison ticks are shown in the game's poison purple (the same colour a
    // poisoned flower and the iris petals use) rather than damage red.
    public static readonly POISON_TEXT_COLOR = '#ce76db';

    public showDamageText(enemyId: string, x: number, y: number, damage: number, fromPoison: boolean = false) {
        const now = Date.now();
        // Poison accumulates under its own key: sharing one bucket would let a
        // poison tick land inside a petal hit's throttle window and repaint the
        // whole total purple (or the reverse).
        const key = fromPoison ? `${enemyId}|p` : enemyId;
        const lastTime = this.lastDamageTextTime.get(key) || 0;

        if (now - lastTime < this.DAMAGE_TEXT_COOLDOWN) {
            const currentAccumulated = this.accumulatedDamage.get(key) || 0;
            this.accumulatedDamage.set(key, currentAccumulated + damage);
            return;
        }

        const accumulated = this.accumulatedDamage.get(key) || 0;
        const totalDamage = accumulated + damage;

        if (totalDamage > 0) {
            this.lastDamageTextTime.set(key, now);
            this.accumulatedDamage.delete(key);
            const color = fromPoison ? Graphics.POISON_TEXT_COLOR : '#ff0000';
            // Nudge poison numbers sideways so a simultaneous petal hit and
            // poison tick don't stack directly on top of each other.
            this.showFloatingText(x + (fromPoison ? 14 : 0), y - 20, `-${Math.round(totalDamage)}`, color, 16);
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
        if (getDisableUltraParticles()) {
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

    // The panel managers are long-lived singletons owned by the title screen
    // and bound to the shared canvas once, when it is created. Handing them to
    // Graphics only says "draw these in my render pass" — it must NOT re-point
    // them at a canvas. Each of these setters used to call setCanvas(), which
    // re-ran the manager's setupMouseListeners() and left the previous set
    // attached, leaking a full set of pointer listeners per join.
    public setChangelogManager(changelogManager: any): void {
        this.changelogManager = changelogManager;
    }

    public setNotificationsManager(notificationsManager: any): void {
        this.notificationsManager = notificationsManager;
    }

    public setLeaderboardManager(leaderboardManager: any): void {
        this.leaderboardManager = leaderboardManager;
    }

    public setGuildMenuManager(guildMenuManager: any): void {
        this.guildMenuManager = guildMenuManager;
    }

    public skinStudioManager: any = null;
    public setSkinStudio(skinStudioManager: any): void {
        this.skinStudioManager = skinStudioManager;
    }

    /**
     * Wire the title-screen canvas-button strip into the in-game render loop
     * so the same icon buttons (settings/changelog/.../exit + bottom-left
     * panels) draw on top of the gameCanvas while the game is running.
     * Mouse events on the gameCanvas are intercepted in the capture phase so
     * a click on a button doesn't also leak through to player controls.
     */
    public titleCanvasButtons: any = null;
    /**
     * Draw-only. The icon strip's input is bound once, at boot, by
     * TitleScreen.setupCanvasUIListeners() on the canvas both scenes share —
     * so the game only needs to know what to paint.
     *
     * This used to attach a full second set of pointer listeners (plus
     * document-level mouseup/touchend that were never removed) every time a
     * Game was constructed, i.e. one more leaked set per join.
     */
    public setTitleCanvasButtons(buttons: any): void {
        this.titleCanvasButtons = buttons;
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
