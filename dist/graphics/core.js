"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Graphics = exports.getSVGRenderer = exports.MOB_CONFIG = exports.getMobTypesBySection = exports.getAllMobTypes = exports.getMobStats = exports.isUndroppableEggPetalType = exports.getAllPetalTypes = exports.getPetalStats = exports.getTileJaggedEdges = exports.seededRandom = exports.SECTION_CONFIGS = exports.getTileState = exports.tileToWorldY = exports.tileToWorldX = exports.worldToTileY = exports.worldToTileX = exports.WALL_GRID_HEIGHT = exports.WALL_GRID_WIDTH = exports.WALL_TILE_SIZE = exports.WALL_GRID = exports.getHighQualityMobs = exports.getMobAnimationFrameTime = exports.PLAYER_SIZE = exports.ACTUAL_WORLD_HEIGHT = exports.ACTUAL_WORLD_WIDTH = exports.EquipmentFlags = exports.FaceFlags = void 0;
const petals_1 = require("../petals");
const svg_renderer_1 = require("../svg_renderer");
const zoom_compensation_1 = require("../zoom-compensation");
var player_1 = require("../player");
Object.defineProperty(exports, "FaceFlags", { enumerable: true, get: function () { return player_1.FaceFlags; } });
Object.defineProperty(exports, "EquipmentFlags", { enumerable: true, get: function () { return player_1.EquipmentFlags; } });
var constants_1 = require("../constants");
Object.defineProperty(exports, "ACTUAL_WORLD_WIDTH", { enumerable: true, get: function () { return constants_1.ACTUAL_WORLD_WIDTH; } });
Object.defineProperty(exports, "ACTUAL_WORLD_HEIGHT", { enumerable: true, get: function () { return constants_1.ACTUAL_WORLD_HEIGHT; } });
Object.defineProperty(exports, "PLAYER_SIZE", { enumerable: true, get: function () { return constants_1.PLAYER_SIZE; } });
Object.defineProperty(exports, "getMobAnimationFrameTime", { enumerable: true, get: function () { return constants_1.getMobAnimationFrameTime; } });
Object.defineProperty(exports, "getHighQualityMobs", { enumerable: true, get: function () { return constants_1.getHighQualityMobs; } });
Object.defineProperty(exports, "WALL_GRID", { enumerable: true, get: function () { return constants_1.WALL_GRID; } });
Object.defineProperty(exports, "WALL_TILE_SIZE", { enumerable: true, get: function () { return constants_1.WALL_TILE_SIZE; } });
Object.defineProperty(exports, "WALL_GRID_WIDTH", { enumerable: true, get: function () { return constants_1.WALL_GRID_WIDTH; } });
Object.defineProperty(exports, "WALL_GRID_HEIGHT", { enumerable: true, get: function () { return constants_1.WALL_GRID_HEIGHT; } });
Object.defineProperty(exports, "worldToTileX", { enumerable: true, get: function () { return constants_1.worldToTileX; } });
Object.defineProperty(exports, "worldToTileY", { enumerable: true, get: function () { return constants_1.worldToTileY; } });
Object.defineProperty(exports, "tileToWorldX", { enumerable: true, get: function () { return constants_1.tileToWorldX; } });
Object.defineProperty(exports, "tileToWorldY", { enumerable: true, get: function () { return constants_1.tileToWorldY; } });
Object.defineProperty(exports, "getTileState", { enumerable: true, get: function () { return constants_1.getTileState; } });
Object.defineProperty(exports, "SECTION_CONFIGS", { enumerable: true, get: function () { return constants_1.SECTION_CONFIGS; } });
Object.defineProperty(exports, "seededRandom", { enumerable: true, get: function () { return constants_1.seededRandom; } });
Object.defineProperty(exports, "getTileJaggedEdges", { enumerable: true, get: function () { return constants_1.getTileJaggedEdges; } });
var petals_2 = require("../petals");
Object.defineProperty(exports, "getPetalStats", { enumerable: true, get: function () { return petals_2.getPetalStats; } });
Object.defineProperty(exports, "getAllPetalTypes", { enumerable: true, get: function () { return petals_2.getAllPetalTypes; } });
Object.defineProperty(exports, "isUndroppableEggPetalType", { enumerable: true, get: function () { return petals_2.isUndroppableEggPetalType; } });
var mobs_1 = require("../mobs");
Object.defineProperty(exports, "getMobStats", { enumerable: true, get: function () { return mobs_1.getMobStats; } });
Object.defineProperty(exports, "getAllMobTypes", { enumerable: true, get: function () { return mobs_1.getAllMobTypes; } });
Object.defineProperty(exports, "getMobTypesBySection", { enumerable: true, get: function () { return mobs_1.getMobTypesBySection; } });
Object.defineProperty(exports, "MOB_CONFIG", { enumerable: true, get: function () { return mobs_1.MOB_CONFIG; } });
var svg_renderer_2 = require("../svg_renderer");
Object.defineProperty(exports, "getSVGRenderer", { enumerable: true, get: function () { return svg_renderer_2.getSVGRenderer; } });
// Blend a #rrggbb hex color toward white by `amount` in [0, 1] and return
// an `rgb(r,g,b)` string ready to assign to `ctx.fillStyle`. Used for drop
// burst particles so the per-frame draw loop stays free of string parsing.
function blendHexWithWhite(hex, amount) {
    const h = hex.charCodeAt(0) === 35 /* '#' */ ? hex.slice(1) : hex;
    const cr = parseInt(h.substring(0, 2), 16);
    const cg = parseInt(h.substring(2, 4), 16);
    const cb = parseInt(h.substring(4, 6), 16);
    const br = Math.round(cr + (255 - cr) * amount);
    const bg = Math.round(cg + (255 - cg) * amount);
    const bb = Math.round(cb + (255 - cb) * amount);
    return `rgb(${br},${bg},${bb})`;
}
class Graphics {
    /** Recompute logical dimensions + device scale from the (already-sized) main canvas. */
    syncViewMetrics() {
        this.uiScale = (0, zoom_compensation_1.getBaseDeviceScale)();
        this.viewW = this.canvas.width / this.uiScale;
        this.viewH = this.canvas.height / this.uiScale;
    }
    syncWorldCanvasSize() {
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
    constructor(canvas, playerSprite, wallTexture, healthPotionSprite, speedBoostSprite, shieldSprite, backgroundTexture) {
        this.cameraX = 0;
        this.cameraY = 0;
        this.zoomLevel = 1.0;
        this.frameTimestamp = 0;
        this.floatingTexts = [];
        this.lastDamageTextTime = new Map();
        this.accumulatedDamage = new Map();
        this.MAX_FLOATING_TEXTS = 50;
        this.DAMAGE_TEXT_COOLDOWN = 100;
        this.explosionEffects = [];
        this.petalBreakEffects = [];
        this.lightningEffects = [];
        this.petalParticleEffects = [];
        this.fallingStars = [];
        this.MAX_FALLING_STARS = 20;
        this.mapData = [];
        this.changelogManager = null;
        this.notificationsManager = null;
        this.leaderboardManager = null;
        this.guildMenuManager = null;
        this.MINIMAP_WIDTH = 200;
        this.MINIMAP_HEIGHT = 200;
        this.MINIMAP_PADDING = 10;
        this.minimapScrollX = 0;
        this.minimapScrollY = 0;
        this.minimapZoom = 1.0;
        this.MINIMAP_MIN_ZOOM = 0.5;
        this.MINIMAP_MAX_ZOOM = 3.0;
        this.MINIMAP_ZOOM_STEP = 0.2;
        this.playerEye = { x: 0, y: 0 };
        // Petal physics state
        this.petalPhysicsStates = new Map();
        this.ATTRACTION_FORCE = 50;
        this.SPRING_FORCE = 700;
        this.DAMPING = 0.72;
        this.MAX_ATTRACTION_DISTANCE = 2000;
        this.MIN_ATTRACTION_DISTANCE = 1;
        this.SPAWN_SMOOTH_TIME = 300;
        this.wallTexture = new Image();
        this.healthPotionSprite = new Image();
        this.speedBoostSprite = new Image();
        this.shieldSprite = new Image();
        this.backgroundTexture = new Image();
        this.biomeTextures = new Map();
        this.sectionTextures = new Map();
        this.MAP_COLORS = {
            wall: 'rgba(102, 102, 102, 0.0)',
            spawn: 'rgba(76, 175, 80, 0.0)',
            teleporter: 'rgba(33, 150, 243, 0.0)',
            biome: 'rgba(128, 64, 192, 0.0)'
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
            unique: '#ffffff',
            apex: '#ff00ff'
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
            unique: 3.5,
            apex: 4.0
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
            unique: 4050,
            apex: 12150
        };
        this.ITEM_RARITY_COLORS = petals_1.ITEM_RARITY_COLORS;
        // Track invulnerability fade-out per player: maps playerId -> timestamp when invulnerability ended
        this.invulFadeStates = new Map();
        this.INVUL_FADE_DURATION = 500; // ms to fade from yellow back to green
        this.showHitboxes = false;
        this.showRarityGlow = false;
        this.altKeyPressed = false;
        // Render scale (1.0 = full native resolution, lower = lower-res buffer
        // stretched to fill the screen). Trades sharpness for GPU work — useful
        // when many drops/effects are on screen.
        this.renderScale = 1.0;
        this.antialiasing = true;
        // HiDPI: the main canvas backing store is physical pixels (logical ×
        // uiScale). All drawing works in *logical* coordinates — render() applies
        // a base scale(uiScale) so world and UI render at native resolution.
        // viewW/viewH are the logical (CSS) dimensions; use these instead of
        // this.canvas.width/height for layout and world-view culling.
        this.uiScale = 1.0;
        this.viewW = 0;
        this.viewH = 0;
        // Low-res offscreen buffer used only when renderScale < 1: the world is
        // drawn here, then stretched up onto the main canvas, trading sharpness
        // for GPU fill work.
        this.worldCanvas = null;
        this.worldCtx = null;
        this.dynamicSkybox = false;
        this.mobDeathAnimation = true;
        this.itemSprites = {};
        this.petalImageCache = {};
        this.petalGlowCache = {};
        this.spawnZoneElements = [];
        this.mobSVGCache = {};
        this.svgRenderer = (0, svg_renderer_1.getSVGRenderer)();
        // Section-based texture loading state
        this.currentSection = -1;
        this.loadedSections = new Set();
        this.loadingMobs = new Set();
        this.mobBaseCacheKeys = new Map();
        // Iris transition (circle reveal) animation
        this.irisTransitionActive = false;
        this.irisTransitionStartTime = 0;
        this.irisScreenshot = null;
        this.irisClosing = false;
        this.irisTitleScreen = false;
        this.irisOnComplete = null;
        this.IRIS_TRANSITION_DURATION = 800;
        this.IRIS_OUTLINE_WIDTH = 6;
        // Canvas-based death screen
        this.deathScreenVisible = false;
        this.deathScreenKilledBy = '';
        this.deathScreenButtonRect = { x: 0, y: 0, w: 0, h: 0 };
        this.deathScreenCloseRect = { x: 0, y: 0, w: 0, h: 0 };
        this.deathScreenButtonHovered = false;
        this.deathScreenCloseHovered = false;
        // Console log overlay
        this.showConsoleLogs_ = false;
        this.consoleLogs = [];
        this.MAX_CONSOLE_LOGS = 20;
        this.CONSOLE_LOG_LIFETIME = 10000;
        this.originalConsoleLog = null;
        this.originalConsoleWarn = null;
        this.originalConsoleError = null;
        // Cached eligible petal types for garbage pile drawing
        this.cachedEligiblePetalTypes = null;
        // Per-section timing for the stats overlay. Filled in by drawGameObjects;
        // accumulated and rolled over once per second by Game.gameLoop alongside
        // the existing frame-time average.
        this.perfItemsMs = 0;
        this.perfItemsCount = 0;
        this.perfMobsMs = 0;
        this.perfProjectilesMs = 0;
        this.skinStudioManager = null;
        /**
         * Wire the title-screen canvas-button strip into the in-game render loop
         * so the same icon buttons (settings/changelog/.../exit + bottom-left
         * panels) draw on top of the gameCanvas while the game is running.
         * Mouse events on the gameCanvas are intercepted in the capture phase so
         * a click on a button doesn't also leak through to player controls.
         */
        this.titleCanvasButtons = null;
        this.titleButtonListenersAttached = false;
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
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
    getPetalCanvas(petalKey, time = Date.now()) {
        const petalImage = this.petalImageCache[petalKey];
        if (!petalImage) {
            return null;
        }
        if (Array.isArray(petalImage)) {
            const frameIndex = Math.floor((time / 42) % petalImage.length);
            return petalImage[frameIndex];
        }
        else {
            return petalImage;
        }
    }
    bakePetalGlow(src, glowColor) {
        const PAD = Graphics.PETAL_GLOW_PAD;
        const out = document.createElement('canvas');
        out.width = src.width + PAD * 2;
        out.height = src.height + PAD * 2;
        const octx = out.getContext('2d');
        if (!octx)
            return src;
        octx.drawImage(src, PAD, PAD);
        octx.shadowColor = glowColor;
        octx.shadowBlur = 8;
        for (let g = 0; g < 6; g++) {
            octx.drawImage(src, PAD, PAD);
        }
        return out;
    }
    getPetalGlowCanvas(petalKey, rarity, time = Date.now()) {
        let cached = this.petalGlowCache[petalKey];
        if (!cached) {
            const src = this.petalImageCache[petalKey];
            if (!src)
                return null;
            const glowColor = this.ITEM_RARITY_COLORS[rarity] || '#ffffff';
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
        this.spawnZoneElements = mapData.filter(e => e.type === 'spawn');
        // The cached chunks were rendered against the previous map data —
        // biome boundaries and section colors may have shifted, so flush.
        this.invalidateStaticMapCache?.();
    }
    showFloatingText(x, y, text, color, fontSize) {
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
    showDamageText(enemyId, x, y, damage) {
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
    getAccumulatedDamage(enemyId) {
        return this.accumulatedDamage.get(enemyId) || 0;
    }
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
        const particles = [];
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
    showPetalBreakEffect(x, y, petalType) {
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
        const currentCount = this.fallingStars.length;
        const starsToAdd = Math.min(this.MAX_FALLING_STARS - currentCount, this.MAX_FALLING_STARS);
        if (starsToAdd <= 0)
            return;
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
    showLightningEffect(x, y, targets, damage) {
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
    showPetalParticleEffect(x, y, rarity) {
        if (!['ultra', 'super', 'unique', 'apex'].includes(rarity)) {
            return;
        }
        const particles = [];
        const particleCount = 8;
        const rarityColor = this.ITEM_RARITY_COLORS[rarity] || '#ffffff';
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
    showItemDropBurst(x, y, rarity) {
        const rarityColor = this.ITEM_RARITY_COLORS[rarity] || '#ffffff';
        const blendedColor = blendHexWithWhite(rarityColor, 0.5);
        const particles = [];
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
    setBiomeTexture(biomeName, texture) {
        this.biomeTextures.set(biomeName, texture);
        // Any cached chunks rendered before this texture arrived used the
        // fallback color — drop them so they get re-baked with the texture.
        this.invalidateStaticMapCache?.();
    }
    setSectionTexture(sectionIndex, texture) {
        this.sectionTextures.set(sectionIndex, texture);
        this.invalidateStaticMapCache?.();
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
    setLeaderboardManager(leaderboardManager) {
        this.leaderboardManager = leaderboardManager;
        if (leaderboardManager && this.canvas) {
            leaderboardManager.setCanvas(this.canvas);
        }
    }
    setGuildMenuManager(guildMenuManager) {
        this.guildMenuManager = guildMenuManager;
        if (guildMenuManager && this.canvas) {
            guildMenuManager.setCanvas(this.canvas);
        }
    }
    setSkinStudio(skinStudioManager) {
        this.skinStudioManager = skinStudioManager;
        if (skinStudioManager && this.canvas) {
            skinStudioManager.setCanvas(this.canvas);
        }
    }
    setTitleCanvasButtons(buttons) {
        this.titleCanvasButtons = buttons;
        if (this.titleButtonListenersAttached || !this.canvas || !buttons)
            return;
        this.titleButtonListenersAttached = true;
        const toLocal = (e) => {
            const r = this.canvas.getBoundingClientRect();
            // Logical coordinates: divide the physical backing-store ratio by
            // the device scale so hit-testing matches the logical layout.
            const s = (0, zoom_compensation_1.getBaseDeviceScale)();
            return {
                x: (e.clientX - r.left) * (this.canvas.width / r.width) / s,
                y: (e.clientY - r.top) * (this.canvas.height / r.height) / s,
            };
        };
        // Capture phase + stopImmediatePropagation when the press/release lands
        // on a button — that prevents the bubble-phase player-control handlers
        // (registered later on the same canvas) from running.
        this.canvas.addEventListener('mousedown', (e) => {
            const { x, y } = toLocal(e);
            if (buttons.press(x, y)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);
        this.canvas.addEventListener('mouseup', (e) => {
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
        this.canvas.addEventListener('click', (e) => {
            const { x, y } = toLocal(e);
            if (buttons.isPointOnButton(x, y)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);
        // Hover doesn't need to block propagation — game cursor tracking still
        // wants to see the move events.
        this.canvas.addEventListener('mousemove', (e) => {
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
        // Touch equivalents of the capture-phase mouse handlers above. Needed
        // because mobile browsers only synthesize mousedown/mouseup once,
        // right after touchend — too late to show a "pressed" state or
        // reliably register a tap, so these buttons need real touch events.
        const toLocalTouch = (t) => {
            const r = this.canvas.getBoundingClientRect();
            const s = (0, zoom_compensation_1.getBaseDeviceScale)();
            return {
                x: (t.clientX - r.left) * (this.canvas.width / r.width) / s,
                y: (t.clientY - r.top) * (this.canvas.height / r.height) / s,
            };
        };
        this.canvas.addEventListener('touchstart', (e) => {
            const { x, y } = toLocalTouch(e.changedTouches[0]);
            if (buttons.press(x, y)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, { capture: true, passive: false });
        this.canvas.addEventListener('touchend', (e) => {
            const { x, y } = toLocalTouch(e.changedTouches[0]);
            if (buttons.releaseClick(x, y)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, { capture: true, passive: false });
        document.addEventListener('touchend', () => {
            buttons.release();
        });
        document.addEventListener('touchcancel', () => {
            buttons.release();
        });
    }
    setupItemSprites(itemSprites) {
        this.itemSprites = itemSprites;
    }
    setPetalImagesFromPreloaded(imageCache) {
        this.petalImageCache = imageCache;
        this.petalGlowCache = {};
    }
    async preloadPetalImages() {
        console.warn('[Graphics] preloadPetalImages called - this should be handled by Preloader');
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
    static darkenColor(hex, factor) {
        hex = hex.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
    }
    static mixColors(c1, c2, t) {
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
exports.Graphics = Graphics;
Graphics.PETAL_GLOW_PAD = 16;
