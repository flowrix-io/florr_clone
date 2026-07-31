import { applyZoomCompensation, canvasCoords } from './zoom-compensation';
import { Player, PlayerInventory } from './player';
import { Enemy } from './enemy';
import { WorldItem } from './item';
import { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, MOUSE_FULL_SPEED_DISTANCE } from './constants';
import { WORLD_MAP } from './map_data';
import { ITEM_RARITY_COLORS, getPetalStats } from './petals';
import { Graphics } from './graphics';
import { Chat } from './chat';
import { GuildMenuManager } from './guildMenu';
import { SkinStudio, getSkinStudio } from './skinStudio';
import { initMultiPlayerMode, Socket } from './socket';
import { InventoryManager } from './inventory';
import { SkillsManager } from './skills';
import { ShopManager } from './shop';
import { PreloadedAssets } from './preloader';
import { Tutorial } from './tutorial';
import { debugMenuPanel, isDebugMenuEnabled } from './debug_menu';
import { AssetLoader } from './asset_loader';
import { CanvasLoadoutBar, LOADOUT_SLOT_COUNT } from './graphics/loadout-bar';
import { MobileControls, resolveMobileControlsEnabled } from './graphics/mobile-controls';

export class Game {
    public canvas: HTMLCanvasElement;
    public graphics: Graphics;
    private socket!: Socket;  // Using the definite assignment assertion
    private players: Map<string, Player> = new Map();
    private activePlayerId: string | null = null; // Track active player ID for split players
    private cameraX = 0;
    private cameraY = 0;
    private playerEye: { x: number, y: number } = { x: 0, y: 0 };
    private zoomLevel = 1.0;
    // Viewport animation properties
    private isAnimatingViewport = false;
    private animationStartTime = 0;
    private animationDuration = 1000; // 1 second for each animation phase
    private animationStartPos = { x: 0, y: 0 };
    private animationTargetPos = { x: 0, y: 0 };
    private animationPhase: 'to_mob' | 'at_mob' | 'to_player' | 'none' = 'none';
    private savedPlayerPos = { x: 0, y: 0 };
    private readonly MIN_ZOOM = 0.5;
    private readonly MAX_ZOOM = 3.0;
    private readonly ZOOM_STEP = 0.1;
    private keysPressed: Set<string> = new Set();
    private mouseButtonsPressed: Set<number> = new Set(); // Track mouse buttons: 0 = left, 2 = right
    private petalExtension: number = 1.0; // 1.0 = normal, >1.0 = extended, <1.0 = retracted
    private enemies: Map<string, Enemy> = new Map();
    private mobProjectiles: Map<string, any> = new Map(); // Store mob projectiles
    private playerProjectiles: Map<string, any> = new Map(); // Store player projectiles
    public groundPollens: Map<string, any> = new Map(); // Store ground pollen drops from broken pollen petals
    public webFields: Map<string, any> = new Map(); // Store web fields left by thrown web petals
    private items: Map<string, WorldItem> = new Map();
    private pickedUpItems: Set<string> = new Set(); // Track items picked up by this player
    get isInventoryOpen(): boolean {
        return this.inventoryManager?.getIsInventoryOpen() ?? false;
    }
    private gameLoopId: number | null = null;
    // Add enemy size multipliers as a class property
    // Add property to track if player is dead
    private isPlayerDead: boolean = false;
    // Add control mode property
    private useMouseControls: boolean = localStorage.getItem('useMouseControls') === 'true';
    private mobileControlsEnabled: boolean = resolveMobileControlsEnabled();
    private mobileControls: MobileControls = new MobileControls();
    private mouseX: number = 0;
    private mouseY: number = 0;
    private normalizedMouseXOnScreen: number = 0;
    private normalizedMouseYOnScreen: number = 0;
    private lastMouseTargetX: number = 0;
    private lastMouseTargetY: number = 0;
    private hasValidMouseTarget: boolean = false;
    private showHitboxes: boolean = false;  // Changed from true to false
    private showStats: boolean = false;  // Combined setting for FPS, counters, and memory
    public mobDeathAnimation: boolean = true;  // Mob death animation setting (default true)
    public interpolationAmount: number = 0.3;  // Interpolation factor (0 = no interpolation/snap, 1 = instant)
    private lastInterpolationTime: number = 0;
    // Client-side prediction state for the local player. The local flower is
    // simulated locally with the same gardn physics the server uses, so input is
    // The local flower renders with gardn-style eased interpolation toward the
    // authoritative server position (see predictLocalPlayer()); predInit tracks
    // whether it has snapped onto the first authoritative position yet (reset on
    // death so it re-snaps on respawn). inputSeq stamps outgoing inputs.
    private inputSeq: number = 0;
    private predInit: boolean = false;
    // One covered frame must render after the camera snaps before the join
    // iris reveals, so the first visible frame is guaranteed to have been drawn
    // with the authoritative camera rather than the origin (see gameLoop /
    // startIrisRevealHold). This also used to absorb the first-sight mob bitmap
    // bakes behind the cover; there is no bake any more (mobs draw live), so
    // that part is moot — the covered frame is now purely a camera guarantee.
    private _irisCoveredFrameRendered: boolean = false;
    private fpsCounter: number = 0;
    private fpsUpdateTime: number = 0;
    // Rolling per-frame work-time average (ms). If this is well under
    // 1000/displayHz, the FPS cap is vsync/browser, not CPU work.
    private frameTimeAvgMs: number = 0;
    private frameTimeSamples: number = 0;
    private frameTimeAccum: number = 0;
    // Per-section render times (items/mobs/projectiles), same 1s rollover as
    // frameTimeAvgMs. The raw per-frame values twitch too much to read, so the
    // overlay shows the avg and the worst frame of the last second instead.
    private sectionMsAvg = { items: 0, mobs: 0, proj: 0 };
    private sectionMsMax = { items: 0, mobs: 0, proj: 0 };
    private sectionMsAccum = { items: 0, mobs: 0, proj: 0 };
    private sectionMsPeak = { items: 0, mobs: 0, proj: 0 };
    // Connection quality tracking for slow connection optimization
    private averagePing: number = 0;
    private pingSamples: number[] = [];
    private readonly MAX_PING_SAMPLES = 10;
    private lastInputSendTime: number = 0;
    private readonly MIN_INPUT_INTERVAL = 33; // ~30 TPS (match server tick rate)
    private connectionQuality: 'good' | 'medium' | 'slow' = 'good';
    private frameCount: number = 0;
    private incomingThroughput: number = 0;
    private outgoingThroughput: number = 0;
    // Top per-event consumers (bytes/sec) refreshed once per second by the FPS counter,
    // displayed in the stats overlay. Helps isolate which event is eating bandwidth.
    private topBandwidthEvents: { event: string; bytes: number; dir: 'in' | 'out' }[] = [];
    private nameInput: HTMLInputElement | null;
    private exitButton: HTMLElement | null;
    private playerHue: number = 0;
    private playerColor: string = 'hsl(0, 100%, 50%)';
    // Add to class properties
    private inventoryPanel: HTMLDivElement | null = null;
    private saveIndicator: HTMLDivElement | null = null;
    private saveIndicatorTimeout: NodeJS.Timeout | null = null;
    // Add to Game class properties
    public readonly ITEM_RARITY_COLORS = ITEM_RARITY_COLORS;
    // Add to Game class properties
    private isCraftingOpen: boolean = false;

    // Add map rendering properties

    private heartbeatInterval: NodeJS.Timeout | null = null;       // Add this property for server update time

    // Asset loader instance
    private assetLoader: AssetLoader;

    // Add chat property
    private chat: Chat | null = null;
    public guildMenu: GuildMenuManager | null = null;
    public skinStudio: SkinStudio = getSkinStudio();

    // Add property
    public inventoryManager!: InventoryManager;
    public loadoutBar!: CanvasLoadoutBar;
    private skillsManager!: SkillsManager;
    public shopManager!: ShopManager;
    private controls!: { [key: string]: string };
    private tutorial: Tutorial;
    private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
    private abortController: AbortController = new AbortController();
    private createdElements: HTMLElement[] = []; // Track DOM elements for cleanup

    constructor(showHitboxes: boolean, serverIp: string, preloadedAssets?: PreloadedAssets | null, showStats: boolean = false, dynamicSkybox: boolean = false) {
        this.showHitboxes = showHitboxes;
        this.showStats = showStats;
        this.interpolationAmount = parseFloat(localStorage.getItem('interpolationAmount') || '0.15');
        const savedZoom = parseFloat(localStorage.getItem('zoomLevel') || '');
        this.zoomLevel = isNaN(savedZoom) ? 1.0 : Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, savedZoom));
        this.loadControls();
        console.log('[Game] Constructor called, using preloaded assets:', !!preloadedAssets, 'show stats:', showStats, 'dynamic skybox:', dynamicSkybox);
        
        // Initialize asset loader
        this.assetLoader = new AssetLoader();
        
        // Wait for canvas to be ready before proceeding
        this.waitForCanvas();
        this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;

        // Use preloaded assets if available
        if (preloadedAssets) {
            console.log('[Game] Using preloaded assets');
            this.assetLoader.initializeFromPreloaded(preloadedAssets);
        }

        this.graphics = new Graphics(
            this.canvas, 
            this.assetLoader.playerSprite,
            this.assetLoader.wallTexture,
            this.assetLoader.healthPotionSprite,
            this.assetLoader.speedBoostSprite,
            this.assetLoader.shieldSprite,
            this.assetLoader.backgroundTexture
        );
        this.graphics.showHitboxes = this.showHitboxes;
        this.graphics.dynamicSkybox = dynamicSkybox;
        this.graphics.mobDeathAnimation = this.mobDeathAnimation;

        // Set initial canvas size
        this.resizeCanvas();

        // Add resize listener (also fires on browser zoom changes)
        window.addEventListener('resize', () => this.resizeCanvas(), { signal: this.abortController.signal });

        // Register as the active game instance before starting the loop
        // (so any previous game loop will detect it's no longer active and stop)
        window.currentGame = this;

        // Initialize sprites and start game
        if (preloadedAssets) {
            // Assets already loaded, just set up item sprites and start
            console.log('[Game] Sprites already loaded, starting game immediately');
            this.assetLoader.setupItemSpritesFromPreloaded(preloadedAssets);
            this.graphics.setupItemSprites(this.assetLoader.itemSprites);
            // Only set petal images if they were loaded
            if (Object.keys(preloadedAssets.petalImages).length > 0) {
                this.graphics.setPetalImagesFromPreloaded(preloadedAssets.petalImages);
            } else {
                // Fallback: load petal images dynamically
                console.log('[Game] Petal images not preloaded, loading dynamically');
                this.graphics.preloadPetalImages().catch(console.error);
            }
            this.gameLoop();
        } else {
            // Load sprites dynamically (fallback)
            console.log('[Game] Loading sprites dynamically');
            Promise.all([
                this.assetLoader.loadSprites(),
                this.assetLoader.setupItemSprites(),
                this.graphics.preloadPetalImages()
            ]).then(() => {
                console.log('[Game] All sprites loaded successfully');
                this.graphics.setupItemSprites(this.assetLoader.itemSprites);
                this.gameLoop();
            }).catch(console.error);
        }

        // Set up color picker functionality
        const hueSlider = document.getElementById('hueSlider') as HTMLInputElement;
        const colorPreview = document.getElementById('colorPreview');

        if (hueSlider && colorPreview) {
            // Load saved hue from localStorage
            const savedHue = localStorage.getItem('playerHue');
            if (savedHue !== null) {
                this.playerHue = parseInt(savedHue);
                hueSlider.value = savedHue;
                this.playerColor = `hsl(${this.playerHue}, 100%, 50%)`;
                colorPreview.style.backgroundColor = this.playerColor;
            }

            // Preview color while sliding without saving
            hueSlider.addEventListener('input', (e) => {
                const value = (e.target as HTMLInputElement).value;
                colorPreview.style.backgroundColor = `hsl(${value}, 100%, 50%)`;
            }, { signal: this.abortController.signal });

            // Add update color button handler
            const updateColorButton = document.getElementById('updateColorButton');
            if (updateColorButton) {
                console.log('Update color button found');
                updateColorButton.addEventListener('click', () => {
                    const value = hueSlider.value;
                    localStorage.setItem('playerHue', value);
                    console.log('Player hue saved:', value);

                    // Update game state after saving
                    this.playerHue = parseInt(value);
                    this.playerColor = `hsl(${this.playerHue}, 100%, 50%)`;

                    // Color change saved
                }, { signal: this.abortController.signal });
            }
        }

        this.setupEventListeners();

        // Get title screen elements
        this.nameInput = document.getElementById('nameInput') as HTMLInputElement;

        // Initialize multiplayer mode after resource loading
        initMultiPlayerMode(this, serverIp);

        // Connect the live socket to the Skin Studio menu (opened from the top
        // button strip; its in-game canvas is wired in index.ts).
        this.skinStudio.setSocket(this.socket);

        // Move authentication to after socket initialization
        this.authenticate();

        this.socket.on('inventoryUpdated', (inventory: PlayerInventory) => {
            const player = this.getLocalPlayer();
            if (player) {
                player.inventory = inventory;
                this.inventoryManager?.reconcileStagedWithInventory();
                // Only update display if inventory UI is open to avoid unnecessary DOM updates
                if (this.isInventoryOpen) {
                    this.inventoryManager.updateInventoryDisplay();
                }
            }
        });

        // Add mouse move listener - always track mouse position so it's available when toggling mouse controls
        this.canvas.addEventListener('mousemove', (event) => {
            // Loadout bar hover/drag tracking (screen-space)
            const { x: sx, y: sy } = canvasCoords(this.canvas, event, true);
            // Settings panel hover/slider drag
            if (window.titleScreen && window.titleScreen.isSettingsOpen()) {
                window.titleScreen.handleSettingsMouseMoveExternal(sx);
                window.titleScreen.handleSettingsHoverExternal(sx, sy);
            }
            // Debug panel hover (close-button highlight)
            if (debugMenuPanel.isMenuOpen()) {
                debugMenuPanel.handleHover(sx, sy);
            }
            if (this.loadoutBar) {
                this.loadoutBar.setHover(sx, sy);
                if (this.loadoutBar.draggingSlotIndex >= 0) {
                    this.loadoutBar.setDragPos(sx, sy);
                }
            }
            // Convert screen coordinates to world coordinates accounting for zoom
            // Formula: worldX = (screenX / zoom) + cameraX
            // This gives the absolute world position of the mouse cursor
            const screenX = sx;
            const screenY = sy;
            const effectiveZoom = this.getEffectiveZoom();
            const worldX = screenX / effectiveZoom + this.cameraX;
            const worldY = screenY / effectiveZoom + this.cameraY;

            // Calculate normalized screen coordinates (-1 to 1, where 0,0 is center of screen)
            // X: -1 is left edge, 0 is center, 1 is right edge
            // Y: -1 is top edge, 0 is center, 1 is bottom edge
            this.normalizedMouseXOnScreen = ((screenX / this.graphics.viewW) * 2 - 1) / (this.graphics.viewH / this.graphics.viewW);
            this.normalizedMouseYOnScreen = (screenY / this.graphics.viewH) * 2 - 1;

            // Update current mouse position (for eye tracking, etc.)
            this.mouseX = worldX;
            this.mouseY = worldY;

            // Store the target position in world coordinates for continuous movement
            // This target will remain fixed even as the camera moves
            this.lastMouseTargetX = worldX;
            this.lastMouseTargetY = worldY;
            this.hasValidMouseTarget = true;
        }, { signal: this.abortController.signal });

        // Track mouse for death screen button hover
        this.canvas.addEventListener('mousemove', (event) => {
            if (this.isPlayerDead && this.graphics.deathScreenVisible) {
                const { x: sx, y: sy } = canvasCoords(this.canvas, event, true);
                const btn = this.graphics.deathScreenButtonRect;
                this.graphics.deathScreenButtonHovered =
                    sx >= btn.x && sx <= btn.x + btn.w &&
                    sy >= btn.y && sy <= btn.y + btn.h;
                const cls = this.graphics.deathScreenCloseRect;
                this.graphics.deathScreenCloseHovered =
                    sx >= cls.x && sx <= cls.x + cls.w &&
                    sy >= cls.y && sy <= cls.y + cls.h;
            }
        }, { signal: this.abortController.signal });

        // Add mouse button listeners for petal extension/retraction
        this.canvas.addEventListener('mousedown', (event) => {
            // Intercept clicks for canvas settings panel
            if (event.button === 0 && window.titleScreen && window.titleScreen.isSettingsOpen()) {
                const { x: sx, y: sy } = canvasCoords(this.canvas, event, true);
                if (window.titleScreen.handleSettingsMouseDownExternal(sx, sy)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
            // Debug panel swallows mousedown over it so interacting with it
            // doesn't trigger attacks underneath.
            if (event.button === 0 && debugMenuPanel.isMenuOpen()) {
                const { x: sx, y: sy } = canvasCoords(this.canvas, event, true);
                if (debugMenuPanel.isPointInside(sx, sy)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
            // Intercept clicks on the canvas death screen buttons
            if (event.button === 0 && this.isPlayerDead && this.graphics.deathScreenVisible) {
                const { x: sx, y: sy } = canvasCoords(this.canvas, event, true);
                const btn = this.graphics.deathScreenButtonRect;
                if (sx >= btn.x && sx <= btn.x + btn.w && sy >= btn.y && sy <= btn.y + btn.h) {
                    this.hideDeathScreen();
                    const exitButton = document.getElementById('exitButton');
                    exitButton?.click();
                    return;
                }
                const cls = this.graphics.deathScreenCloseRect;
                if (sx >= cls.x && sx <= cls.x + cls.w && sy >= cls.y && sy <= cls.y + cls.h) {
                    this.hideDeathScreen();
                    return;
                }
            }
            // Intercept left-clicks over the canvas loadout bar to start drag
            if (event.button === 0 && this.loadoutBar && this.loadoutBar.isVisible()) {
                const { x: sx, y: sy } = canvasCoords(this.canvas, event, true);
                const hit = this.loadoutBar.hitTest(sx, sy);
                if (hit >= 0 && hit < LOADOUT_SLOT_COUNT) {
                    const player = this.getLocalPlayer();
                    if (player && player.loadout && player.loadout[hit]) {
                        this.loadoutBar.beginDrag(hit, sx, sy);
                        // Also inform inventoryManager so document-level mouseup routes correctly
                        this.inventoryManager.beginCanvasLoadoutDrag(hit);
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                }
            }
            this.mouseButtonsPressed.add(event.button);
            // Prevent context menu on right click
            if (event.button === 2) {
                event.preventDefault();
            }
        }, { signal: this.abortController.signal });

        this.canvas.addEventListener('mouseup', (event) => {
            this.mouseButtonsPressed.delete(event.button);
            if (window.titleScreen) {
                window.titleScreen.handleSettingsMouseUpExternal();
            }
        }, { signal: this.abortController.signal });

        // Canvas click handler for settings panel
        this.canvas.addEventListener('click', (event) => {
            if (window.titleScreen && window.titleScreen.isSettingsOpen()) {
                const { x: sx, y: sy } = canvasCoords(this.canvas, event, true);
                if (window.titleScreen.handleSettingsClickExternal(sx, sy)) {
                    event.stopPropagation();
                }
            }
            if (debugMenuPanel.isMenuOpen()) {
                const { x: sx, y: sy } = canvasCoords(this.canvas, event, true);
                if (debugMenuPanel.handleClick(sx, sy)) {
                    event.stopPropagation();
                }
            }
        }, { signal: this.abortController.signal });

        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        }, { signal: this.abortController.signal });

        // Scroll wheel for settings panel
        this.canvas.addEventListener('wheel', (event) => {
            if (window.titleScreen && window.titleScreen.isSettingsOpen()) {
                window.titleScreen.handleSettingsWheelExternal(event.deltaY);
                event.preventDefault();
            }
        }, { passive: false, signal: this.abortController.signal });

        // Touch controls for the mobile joystick + attack/retract buttons.
        // Only active when Request Mobile is on; preventDefault stops the
        // page from scrolling/pinch-zooming while dragging the joystick.
        // Touches landing on the icon-button strip are intercepted earlier
        // (capture phase, see Graphics.setTitleCanvasButtons) and never reach
        // here via stopImmediatePropagation.
        const touchPoints = (touches: TouchList): { identifier: number; x: number; y: number }[] => {
            const points: { identifier: number; x: number; y: number }[] = [];
            for (let i = 0; i < touches.length; i++) {
                const t = touches[i];
                const { x, y } = canvasCoords(this.canvas, t, true);
                points.push({ identifier: t.identifier, x, y });
            }
            return points;
        };
        this.canvas.addEventListener('touchstart', (event) => {
            if (!this.mobileControlsEnabled) return;
            event.preventDefault();
            this.mobileControls.handleTouchStart(touchPoints(event.changedTouches));
        }, { passive: false, signal: this.abortController.signal });
        this.canvas.addEventListener('touchmove', (event) => {
            if (!this.mobileControlsEnabled) return;
            event.preventDefault();
            this.mobileControls.handleTouchMove(touchPoints(event.changedTouches));
        }, { passive: false, signal: this.abortController.signal });
        const endTouches = (event: TouchEvent) => {
            if (!this.mobileControlsEnabled) return;
            event.preventDefault();
            const ids = Array.from(event.changedTouches).map(t => ({ identifier: t.identifier }));
            this.mobileControls.handleTouchEnd(ids);
        };
        this.canvas.addEventListener('touchend', endTouches, { passive: false, signal: this.abortController.signal });
        this.canvas.addEventListener('touchcancel', endTouches, { passive: false, signal: this.abortController.signal });

        // Initialize exit button
        this.exitButton = document.getElementById('exitButton');

        // Add exit button click handler
        this.exitButton?.addEventListener('click', () => this.handleExit(), { signal: this.abortController.signal });

        // Set up item sprites
        this.assetLoader.setupItemSprites().then(() => {
            this.graphics.setupItemSprites(this.assetLoader.itemSprites);
        });

        // Add drag-and-drop event listeners
        // this.setupDragAndDrop(); // This method is now in inventory.ts

        // Create inventory panel
        this.inventoryPanel = document.createElement('div');
        this.inventoryPanel.id = 'inventoryPanel';
        this.inventoryPanel.className = 'inventory-panel';
        this.inventoryPanel.style.display = 'none';

        // Create inventory content
        const inventoryContent = document.createElement('div');
        inventoryContent.className = 'inventory-content';
        this.inventoryPanel.appendChild(inventoryContent);

        document.body.appendChild(this.inventoryPanel);
        this.createdElements.push(this.inventoryPanel);

        // Create save indicator
        this.saveIndicator = document.createElement('div');
        this.saveIndicator.className = 'save-indicator';
        this.saveIndicator.textContent = 'Progress Saved';
        this.saveIndicator.style.display = 'none';
        document.body.appendChild(this.saveIndicator);
        this.createdElements.push(this.saveIndicator);


        // Add this to the constructor after creating the loadout bar
        const style = document.createElement('style');
        style.textContent = `
          .loadout-slot.on-cooldown {
              position: relative;
              overflow: hidden;
          }
          .loadout-slot.on-cooldown::after {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: rgba(0, 0, 0, 0.5);
              animation: cooldown 10s linear;
          }
          @keyframes cooldown {
              from { height: 100%; }
              to { height: 0%; }
          }
      `;
        document.head.appendChild(style);
        this.createdElements.push(style);

        // Add to constructor after other UI initialization
        this.inventoryManager = new InventoryManager(this, this.chat);
        this.loadoutBar = new CanvasLoadoutBar(this, 0.75);
        // resizeCanvas() ran before loadoutBar existed, so mobileControls laid
        // out using a 0 clearance above it — redo it now that its real height
        // is available, so the joystick/buttons don't start out overlapping it.
        this.mobileControls.layout(this.graphics.viewW, this.graphics.viewH, this.loadoutBar.getTotalHeight());
        this.skillsManager = new SkillsManager(this);
        this.shopManager = new ShopManager(this);

        this.assetLoader.loadAssets();

        // Map is bundled with the client via src/map_data.ts (no longer streamed
        // from the server). The wall grid is populated as a side-effect of that
        // import, so we just need to wire the elements into the renderer.
        this.graphics.setMap(WORLD_MAP);
        this.renderMap(WORLD_MAP);
        this.assetLoader.loadBiomeTextures(WORLD_MAP, this.graphics);
        this.assetLoader.loadSectionTextures(this.graphics);
        this.updateTitleScreenBiomes(WORLD_MAP);
        // preconnectedMapData is legacy — clear it if the title screen ever set it.
        if (window.preconnectedMapData) window.preconnectedMapData = null;

        this.socket.on('debugStats', (stats: any) => {
            debugMenuPanel.recordServerStats(stats);
        });

        this.socket.on('zoneUpdate', (zones: any) => {
            // ... existing code ...
        });

        // Handle viewport animation to mobs
        this.socket.on('animateViewportToMob', (data: { x: number, y: number, mobType: string, rarity: string }) => {
            this.startViewportAnimation(data.x, data.y);
        });

        // Handle lightning strike effects
        this.socket.on('lightningStrike', (data: { x: number, y: number, targets: { x: number; y: number; enemyId: string }[], damage: number }) => {
            this.showLightningEffect(data.x, data.y, data.targets, data.damage);
        });

        // Load background image from land.svg
        this.assetLoader.loadBackgroundFromSVG();

        // In constructor, after this.socket = io(...), around line 572
        // this.socket = io(prompt("Enter the server URL eg https://localhost:3000: \n Join a public server: https://54.151.123.177:3000/") || "", {
        //     reconnection: true,
        //     reconnectionAttempts: Infinity,
        //     reconnectionDelay: 1000,
        //     reconnectionDelayMax: 5000,
        //     randomizationFactor: 0.5
        // });

        this.chat = new Chat(this.socket);

        // Warn before leaving the page
        this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler, { signal: this.abortController.signal });

        // Initialize tutorial
        this.tutorial = new Tutorial();
        document.getElementById('connectingDiv')?.remove();

        // Note: updateLoadoutDisplay() is now called after player data is received
        // in the 'authenticated' and 'currentPlayers' event handlers
    }

    /**
     * Waits for the canvas element to be ready in the DOM
     * Uses a synchronous polling approach to avoid async constructor issues
     */
    private waitForCanvas(): void {
        const startTime = Date.now();
        const timeout = 5000; // 5 second timeout
        const pollInterval = 50; // Check every 50ms
        
        while (!document.getElementById('gameCanvas')) {
            const elapsed = Date.now() - startTime;
            
            if (elapsed > timeout) {
                throw new Error('Canvas element not found after 5 seconds. Make sure the gameCanvas element exists in the DOM.');
            }
            
            // Synchronous wait using busy-waiting (not ideal but necessary for constructor)
            const waitUntil = Date.now() + pollInterval;
            while (Date.now() < waitUntil) {
                // Busy wait
            }
        }
        
        console.log('[Game] Canvas element found and ready');
    }


    private authenticate() {
        // Wait for socket to be ready
        if (!this.socket) {
            console.error('[Game] Socket not initialized, cannot authenticate');
            // Try again after a short delay
            setTimeout(() => {
                if (this.socket) {
                    this.authenticate();
                }
            }, 100);
            return;
        }

        // Wait for socket to be connected before authenticating
        if (!this.socket.connected) {
            console.log('[Game] Socket not connected yet, waiting for connection...');
            this.socket.once('connect', () => {
                console.log('[Game] Socket connected, now authenticating...');
                this.performAuthentication();
            });
            return;
        }

        console.log('[Game] Socket already connected, authenticating immediately...');
        this.performAuthentication();
    }

    private performAuthentication() {
        const credentials = {
            username: localStorage.getItem('username') || 'player1',
            password: localStorage.getItem('password') || 'password123',
            playerName: this.nameInput?.value || localStorage.getItem('playerName') || 'Unnamed',
            spawnBiome: localStorage.getItem('spawnBiome') || 'default'
        };

        console.log('[Game] Sending authentication request with username:', credentials.username);
        this.socket.emit('authenticate', credentials);

        // Remove any existing authenticated listeners to avoid duplicates
        this.socket.removeAllListeners('authenticated');
        
        this.socket.on('authenticated', (response: { success: boolean; error?: string; player?: any }) => {
            console.log('[Game] Received authentication response:', response);
            if (response.success) {
                console.log('[Game] Authentication successful');
                // Mark socket as authenticated on the client side
                const username = localStorage.getItem('username');
                if (username) {
                    (this.socket as any).username = username;
                }
                if (response.player) {
                    if (this.socket.id) {
                        // Update player data with saved progress
                        const player = this.players.get(this.socket.id);
                        if (player) {
                            Object.assign(player, response.player);
                            // Update loadout display after player loadout and inventory is received
                            this.inventoryManager.updateLoadoutDisplay();
                        }
                    }
                }
                
                // Start tutorial for new users after a short delay
                setTimeout(() => {
                    this.tutorial.start();
                }, 1000);
            } else {
                console.error('[Game] Authentication failed:', response.error);
                alert('Authentication failed: ' + response.error);
                localStorage.removeItem('currentUser');
                window.location.reload();
            }
        });
    }

    private setupEventListeners() {
        const signal = this.abortController.signal;
        // Map shift+digit symbols back to their digit (so loadout 1-9/0 still trigger when shift is held)
        const SHIFT_DIGIT_MAP: { [k: string]: string } = {
            '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
            '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
        };
        // Normalize a KeyboardEvent.key so case/shift state doesn't change the binding identity.
        // Single-char keys are lower-cased; shifted digits are mapped back to their digit.
        const normalizeKey = (raw: string): string => {
            if (raw.length !== 1) return raw;
            if (SHIFT_DIGIT_MAP[raw]) return SHIFT_DIGIT_MAP[raw];
            return raw.toLowerCase();
        };
        document.addEventListener('keydown', (event) => {
            // Don't interfere if an input/textarea is focused
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return;
            }

            const key = normalizeKey(event.key);

            if (this.chat && this.chat.isFocused) {
                if (key === 'Escape') {
                    this.chat.blur();
                }
                return;
            }

            // Prevent browser shortcuts for game keys only when chat is not focused
            const gameKeys = Object.values(this.controls).map(normalizeKey);
            if (gameKeys.includes(key) || /^[0-9]$/.test(key)) {
                event.preventDefault();
            }

            if (key === normalizeKey(this.controls.chat)) {
                this.chat?.focus();
                return;
            }

            // Zoom controls
            if (key === normalizeKey(this.controls.zoom_out)) {
                this.zoomOut();
                return;
            }

            if (key === normalizeKey(this.controls.zoom_in)) {
                this.zoomIn();
                return;
            }

            if (key === normalizeKey(this.controls.inventory)) {
                this.closeAllMenusExcept('inventory');
                this.inventoryManager.toggleInventory();
                return;
            }

            if (key === normalizeKey(this.controls.crafting)) {
                this.closeAllMenusExcept('crafting');
                this.inventoryManager.toggleCrafting();
                return;
            }

            if (key === normalizeKey(this.controls.skills)) {
                this.closeAllMenusExcept('skills');
                this.skillsManager.toggle();
                return;
            }

            if (key === 'g') {
                this.closeAllMenusExcept('mobGallery');
                this.inventoryManager.toggleMobGallery();
                return;
            }

            if (key === 'b') {
                this.closeAllMenusExcept('shop');
                this.shopManager.toggleShop();
                return;
            }

            if (key === normalizeKey(this.controls.toggle_mouse_controls)) {
                this.useMouseControls = !this.useMouseControls;
                localStorage.setItem('useMouseControls', this.useMouseControls.toString());
                return;
            }

            if (key === normalizeKey(this.controls.toggle_hitboxes)) {
                this.showHitboxes = !this.showHitboxes;
                this.graphics.showHitboxes = this.showHitboxes;
                localStorage.setItem('showHitboxes', this.showHitboxes.toString());
                return;
            }

            if (key === normalizeKey(this.controls.toggle_debug_menu)) {
                this.closeAllMenusExcept('debugMenu');
                debugMenuPanel.toggle();
                return;
            }

            // Minimap scroll controls
            if (key === normalizeKey(this.controls.minimap_scroll_up)) {
                this.graphics.scrollMinimap(0, -1000);
                return;
            }
            if (key === normalizeKey(this.controls.minimap_scroll_down)) {
                this.graphics.scrollMinimap(0, 1000);
                return;
            }
            if (key === normalizeKey(this.controls.minimap_scroll_left)) {
                this.graphics.scrollMinimap(-1000, 0);
                return;
            }
            if (key === normalizeKey(this.controls.minimap_scroll_right)) {
                this.graphics.scrollMinimap(1000, 0);
                return;
            }
            if (key === normalizeKey(this.controls.minimap_center_player)) {
                const currentPlayer = this.getLocalPlayer();
                if (currentPlayer) {
                    this.graphics.centerMinimapOnPlayer(currentPlayer.x, currentPlayer.y);
                }
                return;
            }
            if (key === normalizeKey(this.controls.minimap_zoom_in)) {
                this.graphics.zoomInMinimap();
                return;
            }
            if (key === normalizeKey(this.controls.minimap_zoom_out)) {
                this.graphics.zoomOutMinimap();
                return;
            }

            // Handle exit when dead - Enter returns to title screen
            if (key === 'Enter' && this.isPlayerDead) {
                this.hideDeathScreen();
                const exitButton = document.getElementById('exitButton');
                exitButton?.click();
                return;
            }

            // Gardn-style Q/E secondary-row selection cycling
            if (key === 'q') {
                this.loadoutBar?.cycleSecondaryBackward();
                return;
            }
            if (key === 'e') {
                this.loadoutBar?.cycleSecondaryForward();
                return;
            }

            const slotIndex = this.inventoryManager.getLoadoutKeyBindings().indexOf(key);
            if (slotIndex !== -1) {
                const uHeld = this.keysPressed.has('u');
                const numberKeysUseItems = localStorage.getItem('numberKeysUseItems') === 'true';
                // When the setting is enabled, number keys default to "use item" and U inverts to swap.
                const useMode = numberKeysUseItems ? !uHeld : uHeld;
                const selectedSecondary = this.loadoutBar?.selectedSecondary ?? -1;
                if (useMode) {
                    // Use the petal in that slot
                    this.inventoryManager.useLoadoutItem(slotIndex);
                } else if (selectedSecondary >= 0) {
                    // If a secondary slot is selected, number keys swap primary<->secondary (gardn)
                    const secondaryIdx = 10 + selectedSecondary;
                    this.inventoryManager.swapLoadoutItems(slotIndex, secondaryIdx);
                    // Move to next non-empty secondary (or clear if exhausted)
                    this.loadoutBar?.cycleSecondaryForward();
                } else {
                    // Swap with the petal directly below this slot in the secondary row
                    this.inventoryManager.swapLoadoutItems(slotIndex, 10 + slotIndex);
                }
                return;
            }

            // T deletes the selected secondary petal (gardn)
            if (key === 't') {
                const selectedSecondary = this.loadoutBar?.selectedSecondary ?? -1;
                if (selectedSecondary >= 0) {
                    const secondaryIdx = 10 + selectedSecondary;
                    this.inventoryManager.moveItemToInventory(secondaryIdx);
                    this.loadoutBar?.cycleSecondaryForward();
                    return;
                }
            }

            // Escape clears secondary selection
            if (key === 'Escape' && (this.loadoutBar?.selectedSecondary ?? -1) >= 0) {
                this.loadoutBar?.clearSecondarySelection();
                return;
            }

            this.keysPressed.add(key);

            // ALT key toggles rarity glow on petals
            if (event.key === 'Alt') {
                event.preventDefault();
                this.graphics.showRarityGlow = true;
                this.graphics.altKeyPressed = true;
            }
        }, { signal });

        document.addEventListener('keyup', (event) => {
            this.keysPressed.delete(normalizeKey(event.key));

            // ALT key toggles rarity glow on petals
            if (event.key === 'Alt') {
                this.graphics.showRarityGlow = false;
                this.graphics.altKeyPressed = false;
            }
        }, { signal });

        // Every "held" input is released by an event the browser stops
        // delivering the moment focus leaves the page: keyup for keys, mouseup
        // for buttons AND for the inventory drag gesture. Alt-tabbing (or
        // switching tabs) therefore leaves that state stuck until the user
        // happens to press and release the same input again.
        //
        // The drag is the damaging one: a surviving drag is dropped by the next
        // unrelated click after the user comes back, silently unequipping or
        // swapping a petal — see InventoryManager.cancelDrag. Held keys/buttons
        // are cosmetic by comparison (the flower walks on, petals stay
        // extended), but they're the same defect, so release everything here.
        const releaseHeldInput = () => {
            this.inventoryManager?.cancelDrag();
            this.keysPressed.clear();
            this.mouseButtonsPressed.clear();
            this.graphics.showRarityGlow = false;
            this.graphics.altKeyPressed = false;
        };
        window.addEventListener('blur', releaseHeldInput, { signal });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) releaseHeldInput();
        }, { signal });

        // Add name input change listener
        this.nameInput?.addEventListener('change', () => {
            if (this.socket && this.nameInput) {
                this.socket.emit('updateName', this.nameInput.value);
            }
        }, { signal });

        // Loadout is now canvas-rendered; no DOM drag listeners needed.

        // Add settings change listeners
        this.setupSettingsListeners();
    }

    private setupSettingsListeners(): void {
        // Settings are now canvas-based and write directly to localStorage.
        // Poll localStorage periodically to pick up changes made from the settings panel.
        const pollSettings = () => {
            if (window.currentGame !== this) return;
            const hitboxes = localStorage.getItem('showHitboxes') === 'true';
            if (this.showHitboxes !== hitboxes) {
                this.showHitboxes = hitboxes;
                this.graphics.showHitboxes = hitboxes;
            }
            const stats = localStorage.getItem('showStats') === 'true';
            if (this.showStats !== stats) {
                this.showStats = stats;
                if (stats) {
                    this.frameCount = 0;
                    this.fpsUpdateTime = performance.now();
                }
            }
            const mobDeath = localStorage.getItem('mobDeathAnimation') !== 'false';
            if (this.mobDeathAnimation !== mobDeath) {
                this.mobDeathAnimation = mobDeath;
                this.graphics.mobDeathAnimation = mobDeath;
            }
            const mouse = localStorage.getItem('useMouseControls') === 'true';
            if (this.useMouseControls !== mouse) {
                this.useMouseControls = mouse;
            }
        };
        // Check every 500ms
        const intervalId = setInterval(pollSettings, 500);
        this.abortController.signal.addEventListener('abort', () => clearInterval(intervalId));
    }

    /**
     * Calculate the total memory used by offscreen canvases in MB
     */
    private getOffscreenCanvasMemoryMB(): number {
        return this.graphics.getOffscreenCanvasMemoryMB();
    }

    // Camera zoom multiplier from equipped petals (Antennae/Observer). Values <1 zoom out.
    // Petals don't stack — only the smallest equipped value applies.
    private getEquippedZoomMultiplier(): number {
        const local = this.getLocalPlayer();
        if (!local || !local.loadout) return 1.0;
        let minZoom = 1.0;
        for (const item of local.loadout) {
            if (!item || item.type !== 'petal' || !item.petalType || !item.rarity) continue;
            const stats = getPetalStats(item.petalType, item.rarity);
            if (stats?.cameraZoom !== undefined && stats.cameraZoom < minZoom) {
                minZoom = stats.cameraZoom;
            }
        }
        return minZoom;
    }

    private getEffectiveZoom(): number {
        return this.zoomLevel * this.getEquippedZoomMultiplier();
    }

    private zoomIn() {
        this.zoomLevel = Math.min(this.zoomLevel + this.ZOOM_STEP, this.MAX_ZOOM);
        localStorage.setItem('zoomLevel', this.zoomLevel.toString());
    }

    private zoomOut() {
        this.zoomLevel = Math.max(this.zoomLevel - this.ZOOM_STEP, this.MIN_ZOOM);
        localStorage.setItem('zoomLevel', this.zoomLevel.toString());
    }

    public setMobileControlsEnabled(enabled: boolean): void {
        this.mobileControlsEnabled = enabled;
    }

    private updateCamera(player: Player) {
        if (this.isAnimatingViewport) {
            this.updateViewportAnimation();
            return;
        }

        // Validate player position before updating camera
        if (!player || isNaN(player.x) || isNaN(player.y) || !isFinite(player.x) || !isFinite(player.y)) {
            // Player position is invalid, don't update camera
            console.warn('[Game] Invalid player position, skipping camera update:', player);
            return;
        }

        // Center camera on player with zoom
        const effectiveZoom = this.getEffectiveZoom();
        const scaledWidth = this.graphics.viewW / effectiveZoom;
        const scaledHeight = this.graphics.viewH / effectiveZoom;

        const targetX = player.x - scaledWidth / 2;
        const targetY = player.y - scaledHeight / 2;

        // Clamp camera to world bounds with proper dimensions
        // this.cameraX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - scaledWidth, targetX)); // messes up mouse control
        // this.cameraY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - scaledHeight, targetY));
        this.cameraX = targetX;
        this.cameraY = targetY;
        this.graphics.setCamera(this.cameraX, this.cameraY, effectiveZoom);
        
        // Automatically follow player on minimap
        this.graphics.followPlayerOnMinimap(player.x, player.y);
    }

    private startViewportAnimation(mobX: number, mobY: number) {
        const localPlayer = this.getLocalPlayer();
        if (!localPlayer) return;

        // Save current player position
        this.savedPlayerPos = { x: localPlayer.x, y: localPlayer.y };
        
        // Set up animation to mob
        this.animationStartPos = { x: this.cameraX, y: this.cameraY };
        const effectiveZoom = this.getEffectiveZoom();
        const scaledWidth = this.graphics.viewW / effectiveZoom;
        const scaledHeight = this.graphics.viewH / effectiveZoom;

        this.animationTargetPos = {
            x: Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - scaledWidth, mobX - scaledWidth / 2)),
            y: Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - scaledHeight, mobY - scaledHeight / 2))
        };
        
        this.isAnimatingViewport = true;
        this.animationPhase = 'to_mob';
        this.animationStartTime = Date.now();
    }

    private updateViewportAnimation() {
        const currentTime = Date.now();
        const elapsed = currentTime - this.animationStartTime;
        
        if (this.animationPhase === 'to_mob') {
            // Animate to mob position
            const progress = Math.min(elapsed / this.animationDuration, 1);
            const easeProgress = this.easeInOutCubic(progress);
            
            this.cameraX = this.animationStartPos.x + (this.animationTargetPos.x - this.animationStartPos.x) * easeProgress;
            this.cameraY = this.animationStartPos.y + (this.animationTargetPos.y - this.animationStartPos.y) * easeProgress;
            
            if (progress >= 1) {
                // Switch to waiting phase
                this.animationPhase = 'at_mob';
                this.animationStartTime = currentTime;
            }
        } else if (this.animationPhase === 'at_mob') {
            // Wait at mob for 1 second
            if (elapsed >= this.animationDuration) {
                // Set up animation back to player
                this.animationStartPos = { x: this.cameraX, y: this.cameraY };

                const effectiveZoom = this.getEffectiveZoom();
                const scaledWidth = this.graphics.viewW / effectiveZoom;
                const scaledHeight = this.graphics.viewH / effectiveZoom;

                this.animationTargetPos = {
                    x: Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - scaledWidth, this.savedPlayerPos.x - scaledWidth / 2)),
                    y: Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - scaledHeight, this.savedPlayerPos.y - scaledHeight / 2))
                };
                
                this.animationPhase = 'to_player';
                this.animationStartTime = currentTime;
            }
        } else if (this.animationPhase === 'to_player') {
            // Animate back to player
            const progress = Math.min(elapsed / this.animationDuration, 1);
            const easeProgress = this.easeInOutCubic(progress);
            
            this.cameraX = this.animationStartPos.x + (this.animationTargetPos.x - this.animationStartPos.x) * easeProgress;
            this.cameraY = this.animationStartPos.y + (this.animationTargetPos.y - this.animationStartPos.y) * easeProgress;
            
            if (progress >= 1) {
                // Animation complete
                this.isAnimatingViewport = false;
                this.animationPhase = 'none';
            }
        }
        
        this.graphics.setCamera(this.cameraX, this.cameraY, this.getEffectiveZoom());
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    private gameLoop() {
        // Stop this loop if a different Game instance has taken over
        // (prevents duplicate loops after exit + re-enter)
        if (window.currentGame && window.currentGame !== this) return;

        const frameStartMs = this.showStats ? performance.now() : 0;

        // Calculate FPS and update stats
        if (this.showStats) {
            this.frameCount++;
            if (frameStartMs - this.fpsUpdateTime >= 1000) {
                this.fpsCounter = this.frameCount;
                this.frameCount = 0;
                this.fpsUpdateTime = frameStartMs;

                // Pull per-event wire-byte counters from the socket wrapper. These are
                // *real* encoded byte sizes, not phantom JSON. We snapshot, total, sort
                // the top consumers for the overlay, then reset so we report bytes/sec.
                let inBytes = 0;
                let outBytes = 0;
                const topEvents: { event: string; bytes: number; dir: 'in' | 'out' }[] = [];
                if (this.socket && (this.socket as any).getEventStats) {
                    const stats = (this.socket as any).getEventStats() as Map<string, { in: number; out: number }>;
                    for (const [event, s] of stats) {
                        inBytes += s.in;
                        outBytes += s.out;
                        if (s.in > 0) topEvents.push({ event, bytes: s.in, dir: 'in' });
                        if (s.out > 0) topEvents.push({ event, bytes: s.out, dir: 'out' });
                    }
                    topEvents.sort((a, b) => b.bytes - a.bytes);
                    this.topBandwidthEvents = topEvents.slice(0, 5);
                    (this.socket as any).resetEventStats?.();
                }
                this.incomingThroughput = inBytes;
                this.outgoingThroughput = outBytes;

                // Roll the per-frame work-time average over to the displayed
                // value once per second alongside FPS.
                this.frameTimeAvgMs = this.frameTimeSamples > 0
                    ? this.frameTimeAccum / this.frameTimeSamples
                    : 0;
                for (const k of ['items', 'mobs', 'proj'] as const) {
                    this.sectionMsAvg[k] = this.frameTimeSamples > 0
                        ? this.sectionMsAccum[k] / this.frameTimeSamples
                        : 0;
                    this.sectionMsMax[k] = this.sectionMsPeak[k];
                    this.sectionMsAccum[k] = 0;
                    this.sectionMsPeak[k] = 0;
                }
                this.frameTimeAccum = 0;
                this.frameTimeSamples = 0;
            }
        }

        this.update();

        // Release the join iris hold (see startIrisRevealHold) once the first
        // authoritative position has snapped the camera AND one covered frame
        // has rendered — that covered frame draws the now-visible mobs, baking
        // their bitmaps behind the cover so the reveal itself is jank-free.
        if (this.graphics.irisWaiting && this.predInit) {
            if (this._irisCoveredFrameRendered) {
                this.graphics.beginIrisReveal();
            } else {
                this._irisCoveredFrameRendered = true;
            }
        }

        // Filter out items that this player has already picked up.
        // The Map is reused across frames (clear + refill) — rebuilding it
        // allocated a Map + entries every frame.
        const visibleItems = this._visibleItemsScratch;
        visibleItems.clear();
        for (const [itemId, item] of this.items.entries()) {
            if (!this.pickedUpItems.has(itemId)) {
                visibleItems.set(itemId, item);
            }
        }
        
        // Use active player ID for rendering (or socket.id if not split)
        const activePlayerId = this.activePlayerId || this.socket?.id || '';
        this.graphics.render(this.players, this.enemies, visibleItems, this.mobProjectiles, this.playerProjectiles, activePlayerId, this.petalExtension, this.groundPollens, this.webFields);
        // Overlays drawn after render() must re-establish the HiDPI base
        // transform so they render at native resolution in logical coordinates.
        const ui = this.graphics.uiScale || 1;
        this.graphics.ctx.setTransform(ui, 0, 0, ui, 0, 0);
        // Draw canvas loadout bar on top of game UI (logical bounds)
        if (this.loadoutBar) {
            const localPlayer = this.getLocalPlayer();
            if (localPlayer) this.loadoutBar.show(); else this.loadoutBar.hide();
            this.loadoutBar.draw(this.graphics.ctx, { x: 0, y: 0, width: this.graphics.viewW, height: this.graphics.viewH });
        }
        if (this.mobileControlsEnabled) {
            this.mobileControls.draw(this.graphics.ctx);
        }
        if (this.showStats) {
            this.renderStatsOverlay();
        }
        // Render canvas-based settings overlay if open
        if (window.titleScreen && window.titleScreen.isSettingsOpen()) {
            window.titleScreen.renderSettingsOverlay(this.graphics.ctx);
        }
        // Debug menu: sample frame time every frame (graphs accumulate even
        // while the panel is closed), keep the top-row button's visibility in
        // sync with the settings checkbox, and draw the panel if open.
        debugMenuPanel.recordClientFrame();
        if (window.titleScreen) {
            window.titleScreen.getCanvasButtons().setDebugVisible(isDebugMenuEnabled());
        }
        debugMenuPanel.render(this.graphics.ctx);
        if (this.showStats) {
            this.frameTimeAccum += performance.now() - frameStartMs;
            this.frameTimeSamples++;
            const g = this.graphics;
            this.sectionMsAccum.items += g.perfItemsMs;
            this.sectionMsAccum.mobs += g.perfMobsMs;
            this.sectionMsAccum.proj += g.perfProjectilesMs;
            this.sectionMsPeak.items = Math.max(this.sectionMsPeak.items, g.perfItemsMs);
            this.sectionMsPeak.mobs = Math.max(this.sectionMsPeak.mobs, g.perfMobsMs);
            this.sectionMsPeak.proj = Math.max(this.sectionMsPeak.proj, g.perfProjectilesMs);
        }
        requestAnimationFrame(() => this.gameLoop());
    }

    private update() {
        // Clean up enemies that have completed their death animation
        const DEATH_ANIMATION_DURATION = 200; // Must match the duration in graphics.ts
        const enemiesToRemove: string[] = [];
        for (const [enemyId, enemy] of this.enemies.entries()) {
            if (enemy.deathAnimationStartTime) {
                const elapsed = Date.now() - enemy.deathAnimationStartTime;
                if (elapsed >= DEATH_ANIMATION_DURATION) {
                    enemiesToRemove.push(enemyId);
                }
            }
        }
        // Remove enemies after death animation completes
        for (const enemyId of enemiesToRemove) {
            this.enemies.delete(enemyId);
        }
        
        // Interpolate all players' positions using frame-rate-independent smoothing
        const now = performance.now();
        const frameDeltaMs = this.lastInterpolationTime > 0 ? now - this.lastInterpolationTime : 16.67;
        this.lastInterpolationTime = now;
        // One ease amount for the whole frame, shared by the local flower, remote
        // flowers, petals and enemy facing — so nothing eases at a different rate
        // than anything else. See easeAmount().
        const smoothingFactor = this.easeAmount(frameDeltaMs);

        // How far in the past remote enemies are rendered. 80ms = ~2.4 server ticks,
        // which guarantees a bracket pair even with moderate network jitter (±33ms).
        const RENDER_DELAY_MS = 80;
        const renderTime = now - RENDER_DELAY_MS;

        const localPlayerId = this.activePlayerId || this.socket?.id || '';
        for (const [pid, player] of this.players.entries()) {
            // EVERY flower — yours and everyone else's — renders with the same
            // gardn eased interpolation toward its authoritative server position,
            // so a remote player moving beside you glides exactly the way you do.
            // (Remote players used to use time-based snapshot interpolation with an
            // 80ms render delay instead: a faithful replay of the server path, so
            // they started, stopped and cornered sharply while the local flower —
            // which cannot afford that delay without adding input latency — eased.
            // Two different motion curves on identical entities read as "other
            // players move differently".) The local flower is stepped later this
            // frame by predictLocalPlayer(), which applies the SAME ease and also
            // republishes _refX/_refY for its server-anchored petal ring; don't
            // also step it here or the two would fight.
            const isLocalPredicted = pid === localPlayerId && !player.isDead;
            if (isLocalPredicted) {
                // no-op: handled by predictLocalPlayer()
            } else if (player.targetX !== undefined && player.targetY !== undefined) {
                this.easeToTarget(player, smoothingFactor);
            }

            // Interpolate petal positions
            if (player.petalPositions) {
                player.petalPositions.forEach((petalPos: any) => {
                    if (petalPos.targetX !== undefined && petalPos.targetY !== undefined) {
                        if (petalPos.noPhysics) {
                            // Snap directly to target — no interpolation lag
                            petalPos.x = petalPos.targetX;
                            petalPos.y = petalPos.targetY;
                        } else {
                            petalPos.x += (petalPos.targetX - petalPos.x) * smoothingFactor;
                            petalPos.y += (petalPos.targetY - petalPos.y) * smoothingFactor;
                        }
                    }
                });
            }
        }

        // Interpolate all enemies' positions (skip dying enemies)
        for (const enemy of this.enemies.values()) {
            if (enemy.deathAnimationStartTime) continue;
            const snaps = enemy._snapshots;
            if (snaps && snaps.length >= 2) {
                const interp = this.interpolateFromSnapshots(snaps, renderTime);
                if (interp) {
                    enemy.x = interp.x;
                    enemy.y = interp.y;
                }
            } else if (enemy.targetX !== undefined && enemy.targetY !== undefined) {
                // Fallback to lerp until buffer has at least two entries
                enemy.x += (enemy.targetX - enemy.x) * smoothingFactor;
                enemy.y += (enemy.targetY - enemy.y) * smoothingFactor;
            }

            // Facing: ease toward the authoritative angle (gardn's angle.step_angle)
            // instead of taking it straight from the snapshot interpolation. The
            // passive AI changes heading in one discrete server jump (up to 180°);
            // snapshot-interpolating that whips the mob through the whole turn in a
            // single ~33ms snapshot interval, which reads as a snap. Easing spreads
            // it over gardn's time constant (~150ms) for a smooth rotation. Uses
            // targetAngle (last authoritative), never the render-mutated .angle.
            if (enemy.targetAngle !== undefined) {
                let angleDiff = enemy.targetAngle - enemy.angle;
                if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                enemy.angle += angleDiff * smoothingFactor;
            }
        }

        // Dead-reckon projectiles locally so the server doesn't need to broadcast their
        // positions every tick. Projectiles travel in straight lines at constant velocity;
        // the server only sends spawn/remove events plus speed-throttled position re-syncs.
        const nowMs = performance.now();
        for (const proj of this.mobProjectiles.values()) {
            const last = proj._lastClientTickMs ?? nowMs;
            const dt = nowMs - last;
            proj._lastClientTickMs = nowMs;
            if (dt <= 0) continue;
            const move = proj.speed * dt;
            proj.x += Math.cos(proj.angle) * move;
            proj.y += Math.sin(proj.angle) * move;
            proj.distance += move;
            if (proj.maxDistance && proj.distance >= proj.maxDistance) {
                this.mobProjectiles.delete(proj.id);
            }
        }
        for (const proj of this.playerProjectiles.values()) {
            const last = proj._lastClientTickMs ?? nowMs;
            const dt = nowMs - last;
            proj._lastClientTickMs = nowMs;
            if (dt <= 0) continue;
            const move = proj.speed * dt;
            proj.x += Math.cos(proj.angle) * move;
            proj.y += Math.sin(proj.angle) * move;
            proj.distance += move;
            if (proj.maxDistance && proj.distance >= proj.maxDistance) {
                this.playerProjectiles.delete(proj.id);
            }
        }

        // Update petal extension based on key presses
        this.updatePetalExtension(frameDeltaMs);

        const player = this.getLocalPlayer();
        if (player) {
            this.updatePlayerMovement(player, 1); // Sends input to the server
            // Ease the local flower toward the authoritative server position
            // (gardn client model); when dead, fall back to plain server
            // interpolation (handled in the loop above) and reset so it re-snaps
            // cleanly onto the authoritative position on respawn.
            if (!player.isDead) {
                this.predictLocalPlayer(player, frameDeltaMs);
            } else {
                this.predInit = false;
            }
            this.updateCamera(player);
            this.updatePlayerEye();
        }
    }

    private updatePetalExtension(frameDeltaMs: number = 16.67) {
        // Frame-rate-independent extend/retract, in units/sec (so it's consistent at
        // any FPS). 12/sec fully extends (1.0 -> 2.0) in ~0.08s — snappy but still
        // animated. Clamp dt so a backgrounded tab (huge gap) can't overshoot in one
        // step.
        const dt = Math.min(frameDeltaMs, 100) / 1000;
        const extensionSpeed = 12.0 * dt; // How fast petals extend/retract
        const maxExtension = 2.0; // Maximum extension multiplier
        const minExtension = 0.7; // Minimum extension multiplier

        // Check for space key, left mouse button (button 0), or the mobile Attack button
        const extendPressed = this.keysPressed.has(' ') || this.mouseButtonsPressed.has(0) ||
            (this.mobileControlsEnabled && this.mobileControls.isAttackPressed());
        // Check for shift key, right mouse button (button 2), or the mobile Retract button
        const retractPressed = this.keysPressed.has('Shift') || this.mouseButtonsPressed.has(2) ||
            (this.mobileControlsEnabled && this.mobileControls.isRetractPressed());

        if (extendPressed) {
            // Space key or left mouse - extend petals
            this.petalExtension = Math.min(maxExtension, this.petalExtension + extensionSpeed);
        } else if (retractPressed) {
            // Shift key or right mouse - retract petals
            this.petalExtension = Math.max(minExtension, this.petalExtension - extensionSpeed);
        } else {
            // No keys or buttons pressed - return to normal
            const targetExtension = 1.0;
            if (this.petalExtension > targetExtension) {
                this.petalExtension = Math.max(targetExtension, this.petalExtension - extensionSpeed);
            } else if (this.petalExtension < targetExtension) {
                this.petalExtension = Math.min(targetExtension, this.petalExtension + extensionSpeed);
            }
        }
    }

    private updatePlayerMovement(player: Player, deltaTime: number) {
        let dx = 0;
        let dy = 0;

        if (this.keysPressed.has(this.controls.move_up) || this.keysPressed.has('ArrowUp')) {
            dy -= 1;
        }
        if (this.keysPressed.has(this.controls.move_down) || this.keysPressed.has('ArrowDown')) {
            dy += 1;
        }
        if (this.keysPressed.has(this.controls.move_left) || this.keysPressed.has('ArrowLeft')) {
            dx -= 1;
        }
        if (this.keysPressed.has(this.controls.move_right) || this.keysPressed.has('ArrowRight')) {
            dx += 1;
        }
        
        // Check if any menu is open
        const isAnyMenuOpen = this.isAnyMenuOpen();
        
        // Only send input, don't update position locally
        const inputData: any = {
            keys: Array.from(this.keysPressed),
            petalExtension: this.petalExtension,
            viewportWidth: this.graphics.viewW / this.getEffectiveZoom(),
            viewportHeight: this.graphics.viewH / this.getEffectiveZoom()
        };

        // Mobile joystick: reuses the same direction-vector + speed-multiplier
        // wire format as "Use Mouse Controls" (consumed by the server's
        // playerState.ts), just fed from touch instead of mouse-vs-center-of-screen.
        if (this.mobileControlsEnabled && !isAnyMenuOpen) {
            const jv = this.mobileControls.getJoystickVector();
            if (jv) {
                inputData.useMouse = true;
                inputData.mouseDirectionX = jv.x;
                inputData.mouseDirectionY = jv.y;
                // Linear deflection→speed, matching the gardn mouse law above
                // (full stick = full speed, easing to 0 at center; no floor).
                inputData.mouseSpeedMultiplier = Math.min(jv.magnitude, 1.0);
            } else {
                inputData.useMouse = false;
            }
        } else if (this.useMouseControls && !isAnyMenuOpen) {
            // Always use the stored target position (in world coordinates)
            // This ensures the target doesn't drift as the camera moves
            if (this.hasValidMouseTarget &&
                isFinite(this.lastMouseTargetX) && isFinite(this.lastMouseTargetY) &&
                !isNaN(this.lastMouseTargetX) && !isNaN(this.lastMouseTargetY)) {
            } else {
                // If no valid target yet, use current mouse position and set it as target
                if (isFinite(this.mouseX) && isFinite(this.mouseY) &&
                    !isNaN(this.mouseX) && !isNaN(this.mouseY)) {
                    this.lastMouseTargetX = this.mouseX;
                    this.lastMouseTargetY = this.mouseY;
                    this.hasValidMouseTarget = true;
                } else {
                    inputData.useMouse = false;
                    // Throttle input sending
                    const now = performance.now();
                    if (now - this.lastInputSendTime >= this.getInputInterval()) {
                        this.socket.emit('playerInput', inputData);
                        this.lastInputSendTime = now;
                    }
                    return;
                }
            }
            
            // Use normalized screen coordinates as direction vector (-1 to 1)
            // These represent the direction from center of screen to mouse cursor.
            // Because the camera keeps the flower screen-centered, this screen
            // offset is proportional to the world offset from the flower, so the
            // unit direction is identical in screen and world space.
            const dirX = this.normalizedMouseXOnScreen;
            const dirY = this.normalizedMouseYOnScreen;
            const screenFrac = Math.sqrt(dirX * dirX + dirY * dirY);

            // Only send mouse input if the cursor is off the flower's center.
            if (screenFrac > 0.001) {
                // Normalize the direction vector to ensure it's a unit vector
                const normalizedDirX = dirX / screenFrac;
                const normalizedDirY = dirY / screenFrac;

                // gardn control law (Server/Client.cc): speed scales LINEARLY with
                // the world-space distance from the flower to the cursor, reaching
                // full at MOUSE_FULL_SPEED_DISTANCE units and capping there.
                // normalizedMouse*OnScreen is measured in units of (screen offset
                // from center) / (viewH/2), so screenFrac * (viewH/2) is the pixel
                // offset and dividing by the live zoom converts it to world units.
                // Deriving it from the screen anchor (not mouseX-flowerX) keeps the
                // distance constant while the mouse is held still and the flower
                // cruises, and makes the feel identical at any zoom.
                const zoom = this.getEffectiveZoom() || 1;
                const worldDist = (screenFrac * (this.graphics.viewH / 2)) / zoom;
                const mult = Math.min(worldDist / MOUSE_FULL_SPEED_DISTANCE, 1.0);

                // Send normalized direction and speed multiplier to server
                // Server will apply MAX_SPEED, speed_boost, and other multipliers
                inputData.useMouse = true;
                inputData.mouseDirectionX = normalizedDirX;
                inputData.mouseDirectionY = normalizedDirY;
                inputData.mouseSpeedMultiplier = mult;
            } else {
                inputData.useMouse = false;
            }
        } else {
            inputData.useMouse = false;
            // Clear mouse target when menus open or mouse controls disabled
            if (isAnyMenuOpen || !this.useMouseControls) {
                this.hasValidMouseTarget = false;
            }
        }

        // Throttle input sending based on connection quality
        const now = performance.now();
        if (now - this.lastInputSendTime >= this.getInputInterval()) {
            inputData.seq = ++this.inputSeq;
            this.socket.emit('playerInput', inputData);
            this.lastInputSendTime = now;
        }
    }

    // Local flower rendering — gardn client model (Client/Simulation.cc +
    // Client/Game.cc). The flower's rendered position eases exponentially toward
    // the AUTHORITATIVE server position every frame. There is NO client-side
    // prediction and NO latency extrapolation, so nothing can overshoot (no
    // rubber-band) and every server correction — input, bubble propulsion,
    // knockback, wall resolution — arrives as a smooth ease instead of a snap.
    // The cost is a little input latency (~half-ping + the ease time constant),
    // which is exactly the tradeoff gardn makes for its buttery feel.
    //
    // The camera stays locked to this eased position (updateCamera), so the world
    // scrolls at the same smooth rate while the flower remains screen-centered —
    // which keeps the mouse-control mapping (cursor-relative-to-center) exact.
    //
    // Eases at the SAME rate (interpolationAmount) as remote entities and the
    // local server-anchored petal ring, and republishes it as _refX/_refY, so the
    // flower and its petals move in lockstep with no drift. gardn uses 0.2.
    private predictLocalPlayer(player: Player, frameDeltaMs: number) {
        if (player.targetX === undefined || player.targetY === undefined) return;

        // On first run / after respawn (predInit cleared while dead), snap onto
        // the authoritative position rather than gliding in from a stale spot.
        if (!this.predInit) {
            player.x = player.targetX;
            player.y = player.targetY;
            player._refX = player.targetX;
            player._refY = player.targetY;
            this.predInit = true;
            return;
        }

        // easeToTarget also republishes _refX/_refY, the petal-ring anchor.
        this.easeToTarget(player, this.easeAmount(frameDeltaMs));
    }

    // Frame-rate-independent exponential ease amount; same shape as gardn's
    // Ui::lerp_amount = 1 - (1 - k)^(dt*60). interpolationAmount is k at 60fps.
    // dt is clamped so a backgrounded tab's huge frame gap can't produce a
    // full-strength snap on the frame it resumes.
    private easeAmount(frameDeltaMs: number): number {
        const dtMs = Math.min(frameDeltaMs, 100);
        const k = Math.min(0.999, Math.max(0.001, this.interpolationAmount));
        const rate = -Math.log(1 - k) * 60;
        return 1 - Math.exp(-rate * dtMs / 1000);
    }

    // Step a flower's rendered position toward its authoritative server position.
    // Shared by the local flower and every remote one so they move identically.
    private easeToTarget(player: Player, amt: number) {
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        if (dx * dx + dy * dy > 600 * 600) {
            // Teleport / portal / big desync: snap instead of gliding across the map.
            player.x = player.targetX;
            player.y = player.targetY;
        } else if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
            // Settle exactly on target instead of asymptoting forever.
            player.x = player.targetX;
            player.y = player.targetY;
        } else {
            player.x += dx * amt;
            player.y += dy * amt;
        }
        // Petals are drawn as (serverPetalAbsolute - _refX) offset from the flower
        // render (player-drawing.ts). Anchoring _refX to the exact render position
        // keeps every petal ring — local and remote — centered with no drift.
        player._refX = player.x;
        player._refY = player.y;
    }

    // Reused result for interpolateFromSnapshots: it runs once per enemy per
    // FRAME (players ease toward target* instead), and the call site copies
    // x/y/angle out immediately, so a fresh object per call was pure GC pressure.
    private _interpScratch: { x: number; y: number; angle?: number } = { x: 0, y: 0, angle: undefined };
    // Reused per-frame container for the not-yet-picked-up item filter.
    private _visibleItemsScratch: Map<string, WorldItem> = new Map();

    // Snapshot interpolation: find the two snapshots bracketing `renderTime` and
    // return the linearly interpolated position. Returns null if the buffer is too
    // small or renderTime is newer than all snapshots (caller should fall back to lerp).
    // NOTE: returns a reused scratch object — copy fields out before the next call.
    private interpolateFromSnapshots(
        snaps: { t: number; x: number; y: number; angle?: number }[],
        renderTime: number
    ): { x: number; y: number; angle?: number } | null {
        if (snaps.length < 2) return null;
        const out = this._interpScratch;
        // Walk backward from the end to find the pair where snaps[i].t <= renderTime <= snaps[i+1].t
        let i = snaps.length - 2;
        while (i > 0 && snaps[i].t > renderTime) i--;
        const s0 = snaps[i];
        const s1 = snaps[i + 1];
        if (s1.t <= renderTime) {
            // renderTime is after ALL snapshots (buffer hasn't caught up yet) — extrapolate
            // from the latest pair at most one server tick forward to avoid freezing.
            const dt = s1.t - s0.t;
            if (dt <= 0) {
                out.x = s1.x; out.y = s1.y; out.angle = s1.angle;
                return out;
            }
            const overshoot = Math.min((renderTime - s1.t) / dt, 1);
            out.x = s1.x + (s1.x - s0.x) * overshoot;
            out.y = s1.y + (s1.y - s0.y) * overshoot;
            out.angle = s1.angle;
            return out;
        }
        const span = s1.t - s0.t;
        if (span <= 0) {
            out.x = s1.x; out.y = s1.y; out.angle = s1.angle;
            return out;
        }
        // Clamp: renderTime can predate the oldest pair right after the buffer
        // seeds; a negative alpha would extrapolate backward past s0.
        const alpha = Math.max(0, (renderTime - s0.t) / span);
        out.x = s0.x + (s1.x - s0.x) * alpha;
        out.y = s0.y + (s1.y - s0.y) * alpha;
        out.angle = (s0.angle !== undefined && s1.angle !== undefined)
            ? (() => {
                let da = s1.angle - s0.angle;
                if (da > Math.PI) da -= Math.PI * 2;
                if (da < -Math.PI) da += Math.PI * 2;
                return s0.angle + da * alpha;
            })()
            : undefined;
        return out;
    }

    private getInputInterval(): number {
        // Keep local controls at the server tick cadence even when RTT is high.
        // Lowering input rate under high ping makes the server steer from stale
        // controls longer, which increases correction size and feels glitchy.
        return this.MIN_INPUT_INTERVAL;
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    private renderStatsOverlay(): void {
        const ctx = this.graphics.ctx;
        const canvas = this.graphics.canvas;
        if (!ctx || !canvas) return;

        ctx.save();
        const lineHeight = 15;
        ctx.font = 'bold 11px Ubuntu, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000000';

        const x = this.graphics.viewW - 8;
        const player = this.socket?.id ? this.players.get(this.socket.id) : undefined;

        const lines: { text: string; color: string }[] = [];

        // Player position
        if (player) {
            lines.push({ text: `Pos: ${Math.round(player.x)}, ${Math.round(player.y)}`, color: '#ffd700' });
        }

        // Network
        const pingStr = this.averagePing > 0 ? `${Math.round(this.averagePing)}ms` : '--';
        lines.push({ text: `Ping: ${pingStr} (${this.connectionQuality}) | In: ${this.formatBytes(this.incomingThroughput)}/s | Out: ${this.formatBytes(this.outgoingThroughput)}/s`, color: '#a78bfa' });

        // Top per-event bandwidth consumers (real wire bytes/sec from the prior 1s window).
        // Arrow indicates direction: ← incoming, → outgoing.
        if (this.topBandwidthEvents.length > 0) {
            const parts = this.topBandwidthEvents.map(e =>
                `${e.dir === 'in' ? '←' : '→'} ${e.event} ${this.formatBytes(e.bytes)}/s`
            );
            lines.push({ text: `Top: ${parts.join(' | ')}`, color: '#a78bfa' });
        }

        // Counters
        lines.push({ text: `Players: ${this.players.size}`, color: '#4ecdc4' });
        lines.push({ text: `Mobs: ${this.enemies.size}`, color: '#ff6b6b' });

        // FPS & memory
        const memoryMB = this.getOffscreenCanvasMemoryMB();
        // ms/frame is the actual work cost; FPS is gated by the browser's
        // requestAnimationFrame cadence (typically the display refresh rate).
        // If ms/frame is well under the FPS cap's budget the cap is vsync.
        const ftStr = this.frameTimeAvgMs > 0 ? `${this.frameTimeAvgMs.toFixed(2)}ms` : '--';
        lines.push({ text: `FPS: ${this.fpsCounter} (${ftStr}/frame) | Memory: ${memoryMB.toFixed(2)} MB`, color: '#00ff00' });

        // Per-section render time, averaged over the last second with the
        // worst frame alongside (avg/peak). Helps isolate which subsystem is
        // eating frame budget when something feels slow — the avg is the
        // steady cost, the peak catches one-frame spikes that a raw last-frame
        // readout turns into unreadable flicker.
        const g = this.graphics;
        const sec = (k: 'items' | 'mobs' | 'proj') =>
            `${this.sectionMsAvg[k].toFixed(2)}/${this.sectionMsMax[k].toFixed(1)}ms`;
        lines.push({
            text: `Render avg/peak: items ${sec('items')} (${g.perfItemsCount}) | mobs ${sec('mobs')} | proj ${sec('proj')}`,
            color: '#facc15'
        });

        // Draw from bottom up
        let y = this.graphics.viewH - 8;
        for (const line of lines) {
            ctx.strokeText(line.text, x, y);
            ctx.fillStyle = line.color;
            ctx.fillText(line.text, x, y);
            y -= lineHeight;
        }
        ctx.restore();
    }

    // Bandwidth is tracked inside the WSClientSocket wrapper now (true wire bytes).
    // game.ts pulls per-event counters in gameLoop() once per second.

    public updateConnectionQuality(ping: number): void {
        // Add ping to samples
        this.pingSamples.push(ping);
        if (this.pingSamples.length > this.MAX_PING_SAMPLES) {
            this.pingSamples.shift();
        }
        
        // Calculate average ping
        this.averagePing = this.pingSamples.reduce((a, b) => a + b, 0) / this.pingSamples.length;
        
        // Determine connection quality
        if (this.averagePing > 200) {
            this.connectionQuality = 'slow';
        } else if (this.averagePing > 100) {
            this.connectionQuality = 'medium';
        } else {
            this.connectionQuality = 'good';
        }
    }

    private isAnyMenuOpen(): boolean {
        // Check inventory (check both Game property and DOM)
        if (this.isInventoryOpen) {
            return true;
        }
        const inventoryPanel = document.getElementById('inventoryPanel');
        if (inventoryPanel && inventoryPanel.style.display === 'block') {
            return true;
        }
        
        // Check crafting (check both Game property and DOM)
        if (this.isCraftingOpen) {
            return true;
        }
        const craftingPanel = document.querySelector('.crafting-panel');
        if (craftingPanel) {
            const style = window.getComputedStyle(craftingPanel);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
                return true;
            }
        }
        
        // Check skills
        if (this.skillsManager?.isSkillsOpen()) {
            return true;
        }
        
        // Check mob gallery
        if (this.inventoryManager && (this.inventoryManager as any).isMobGalleryOpen) {
            return true;
        }
        const mobGalleryPanel = document.getElementById('mobGalleryPanel');
        if (mobGalleryPanel) {
            const style = window.getComputedStyle(mobGalleryPanel);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
                return true;
            }
        }
        
        // Check shop
        if (this.shopManager && this.shopManager.isShopOpenState()) {
            return true;
        }
        const shopPanel = document.getElementById('shopPanel');
        if (shopPanel) {
            const style = window.getComputedStyle(shopPanel);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
                return true;
            }
        }
        
        // Settings menu is now canvas-based - check via titleScreen
        if ((window as any).titleScreen && (window as any).titleScreen.isSettingsOpen()) {
            return true;
        }
        
        // Check changelog (check if changelog panel exists and is visible)
        const changelogPanel = document.querySelector('.changelog-panel');
        if (changelogPanel) {
            const style = window.getComputedStyle(changelogPanel);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
                return true;
            }
        }
        
        return false;
    }

    private closeAllMenusExcept(except?: string) {
        if (except !== 'inventory') this.inventoryManager?.closeInventory();
        if (except !== 'crafting') this.inventoryManager?.closeCrafting();
        if (except !== 'mobGallery') this.inventoryManager?.closeMobGallery();
        if (except !== 'shop') this.shopManager?.closeShop();
        if (except !== 'skills') this.skillsManager?.hide();
        if (except !== 'debugMenu') debugMenuPanel.close();
    }

    private updatePlayerEye() {
        const player = this.getLocalPlayer();
        if (player) {
            const dx = this.mouseX - player.x;
            const dy = this.mouseY - player.y;
            const angle = Math.atan2(dy, dx);
            const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 10);
            this.playerEye = {
                x: Math.cos(angle) * distance,
                y: Math.sin(angle) * distance
            };
            if (player.eye) {
                player.eye.x = this.playerEye.x;
                player.eye.y = this.playerEye.y;
            }
        }
    }

    public showFloatingText(x: number, y: number, text: string, color: string, fontSize: number) {
        this.graphics.showFloatingText(x, y, text, color, fontSize);
    }

    public showExplosionEffect(x: number, y: number, radius: number) {
        this.graphics.showExplosionEffect(x, y, radius);
    }

    public showFallingStars() {
        this.graphics.showFallingStars();
    }

    public showLightningEffect(x: number, y: number, targets: { x: number; y: number; enemyId: string }[], damage: number) {
        this.graphics.showLightningEffect(x, y, targets, damage);
    }

    public showPetalBreakEffect(x: number, y: number, petalType: string) {
        this.graphics.showPetalBreakEffect(x, y, petalType);
    }

    private renderMap(mapData: MapElement[]) {
        // Store the map data and render it
        this.graphics.drawMap(mapData);
    }



    private resizeCanvas() {
        const renderScale = parseFloat(localStorage.getItem('renderScale') || '1');
        const antialiasing = localStorage.getItem('antialiasing') !== 'false';
        const safeScale = isNaN(renderScale) ? 1 : Math.max(0.25, Math.min(1, renderScale));
        // HiDPI: size the main canvas backing store to physical pixels.
        applyZoomCompensation(this.canvas, antialiasing, true);
        if (this.graphics) {
            this.graphics.renderScale = safeScale;
            this.graphics.antialiasing = antialiasing;
            // Recompute logical dims/device scale from the resized canvas, then
            // size the low-res render buffer off it.
            this.graphics.syncViewMetrics();
            this.graphics.syncWorldCanvasSize();
            this.mobileControls.layout(this.graphics.viewW, this.graphics.viewH, this.loadoutBar?.getTotalHeight() ?? 0);
        }
        if (this.graphics?.ctx) {
            this.graphics.ctx.imageSmoothingEnabled = antialiasing;
        }
    }

    // Change from private to public
    public connectGuildMenu(menu: GuildMenuManager) {
        this.guildMenu = menu;
        menu.setSocket(this.socket);
    }

    public cleanup() {
        // Stop the game loop immediately to prevent further drawing
        if (this.gameLoopId) {
            cancelAnimationFrame(this.gameLoopId);
            this.gameLoopId = null;
        }

        // Abort all event listeners registered with the signal
        this.abortController.abort();

        // Return to the title screen WITHOUT dropping the connection. Disconnecting
        // would reconnect later under a fresh socket id, which counts the player as
        // disconnected and orphans their ground loot (eligibility is keyed by socket
        // id). Instead: tell the server we've left the active world (it despawns our
        // pets and removes us from other players' view but keeps our loot), strip the
        // game's listeners, and hand the still-connected socket back to the title
        // screen so it is reused on the next play.
        if (this.socket) {
            const reuseSocket = (window as any).reuseSocketForTitleScreen;
            if (this.socket.connected && typeof reuseSocket === 'function') {
                this.socket.emit('leaveGame');
                this.socket.removeAllListeners();
                reuseSocket(this.socket);
            } else {
                // Not connected (or no title-screen handler available): fall back to
                // a hard teardown.
                this.socket.removeAllListeners();
                this.socket.disconnect();
            }
        }

        // Clear heartbeat interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Clear all game data
        this.players.clear();
        this.enemies.clear();
        this.items = new Map();

        // Reset game state
        this.isCraftingOpen = false;
        this.isPlayerDead = false;
        this.useMouseControls = localStorage.getItem('useMouseControls') === 'true';

        // Remove all dynamically created DOM elements
        for (const el of this.createdElements) {
            el.remove();
        }
        this.createdElements = [];

        // Hide canvas loadout bar
        if (this.loadoutBar) this.loadoutBar.hide();
        // Remove any legacy DOM loadout bar that may have been attached
        document.getElementById('loadoutBar')?.remove();

        // Remove other dynamic UI elements
        document.getElementById('disconnect-message')?.remove();
        document.getElementById('transfer-message')?.remove();
        document.getElementById('teleporter-ui')?.remove();

        // Reset camera position
        this.cameraX = 0;
        this.cameraY = 0;

        // Clear any remaining timeouts or intervals
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }

        this.keysPressed.clear();
        this.mouseButtonsPressed.clear();

        // Hide game canvas
        this.canvas.style.display = 'none';

        // Clean up sub-managers
        this.inventoryManager.cleanup();
        this.skillsManager.cleanup();
        this.shopManager.cleanup();
        this.chat?.cleanup();
        this.tutorial.cleanup();
        debugMenuPanel.close();
    }

    private handleExit() {
        this.cleanup();
    }




    // Method to load biome-specific background textures
    /**
     * Updates the title screen with available biomes from map data
     */
    private updateTitleScreenBiomes(mapData: MapElement[]): void {
        if (window.titleScreen && typeof window.titleScreen.updateBiomesFromMapData === 'function') {
            window.titleScreen.updateBiomesFromMapData(mapData);
        }
    }



    public getLocalPlayer() {
        // If we have an active player ID (from split), use that; otherwise use socket.id
        const playerId = this.activePlayerId || this.socket?.id || '';
        return this.players.get(playerId);
    }

    public getSocket() {
        return this.socket;
    }

    public getItemSprites(): Record<string, HTMLImageElement> {
        return this.assetLoader.itemSprites;
    }

    private itemSpriteDataUrls: Map<string, string> = new Map();

    public getItemSpriteDataUrl(itemType: string): string | null {
        // Check if we already have the data URL cached
        if (this.itemSpriteDataUrls.has(itemType)) {
            return this.itemSpriteDataUrls.get(itemType)!;
        }

        // Get the cached sprite
        const sprite = this.assetLoader.itemSprites[itemType];
        if (!sprite || !sprite.complete || sprite.naturalWidth === 0) {
            return null;
        }

        // Convert image to data URL using canvas
        try {
            const canvas = document.createElement('canvas');
            canvas.width = sprite.naturalWidth;
            canvas.height = sprite.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return null;
            }
            ctx.drawImage(sprite, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            this.itemSpriteDataUrls.set(itemType, dataUrl);
            return dataUrl;
        } catch (error) {
            console.error(`[Game] Error converting sprite to data URL for ${itemType}:`, error);
            return null;
        }
    }

    public getPetalStats(petalType: string, rarity: string): any {
        // Import the petals module dynamically to avoid circular dependencies
        const { getPetalStats } = require('./petals');
        return getPetalStats(petalType, rarity);
    }

    public getPetalCanvas(petalType: string, rarity: string, time: number = Date.now()): HTMLCanvasElement | null {
        const petalKey = `${petalType}_${rarity}`;
        const petalImage = this.graphics.petalImageCache[petalKey];
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

    public getMobCanvas(mobType: string, rarity: string): HTMLCanvasElement | null {
        // Get the SVG string from graphics cache
        const cacheKey = `${mobType}_${rarity}`;
        const svgString = (this.graphics as any).mobSVGCache?.[cacheKey];
        if (!svgString) {
            return null;
        }

        // Render SVG to canvas using data URL
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return null;
            }

            // Create data URL from SVG
            const base64 = btoa(unescape(encodeURIComponent(svgString)));
            const dataUrl = `data:image/svg+xml;base64,${base64}`;

            // Create image and draw to canvas
            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, 32, 32);
                ctx.drawImage(img, 0, 0, 32, 32);
            };
            img.onerror = () => {
                console.error(`[Game] Failed to load mob image for ${cacheKey}`);
            };
            img.src = dataUrl;
            
            // Return canvas (image will load asynchronously and draw when ready)
            // For gallery use, the img element approach is better, but this works for canvas-based rendering
            return canvas;
        } catch (error) {
            console.error(`[Game] Error creating mob canvas for ${cacheKey}:`, error);
            return null;
        }
    }

    private loadControls() {
        const savedControls = localStorage.getItem('controls');
        if (savedControls) {
            this.controls = { ...this.getDefaultControls(), ...JSON.parse(savedControls) };
        } else {
            this.controls = this.getDefaultControls();
        }
    }

    private getDefaultControls(): { [key: string]: string } {
        return {
            move_up: 'w',
            move_down: 's',
            move_left: 'a',
            move_right: 'd',
            inventory: 'z',
            crafting: 'c',
            skills: 'x',
            toggle_mouse_controls: 'k',
            toggle_hitboxes: 'h',
            toggle_debug_menu: 'j',
            zoom_in: '=',
            zoom_out: '-',
            chat: 'Enter',
            extend_petals: ' ',
            retract_petals: 'Shift',
            minimap_scroll_up: 'N',
            minimap_scroll_down: 'M',
            minimap_scroll_left: '<',
            minimap_scroll_right: '>',
            minimap_center_player: '?',
            minimap_zoom_in: 'PageUp',
            minimap_zoom_out: 'PageDown',
        };
    }
    public savePlayerProgress() {}
    public hideTitleScreen() {}
    public showDeathScreen(killedBy?: { type: string; tier: string }) {
        this.graphics.showDeathScreen(killedBy);
    }
    public hideDeathScreen() {
        this.graphics.hideDeathScreen();
    }

    public showTitleScreen() {
        document.getElementById('titleScreen')?.classList.remove('hidden');
    }
    public showSaveIndicator() {}

    // UI methods for disconnect/reconnect
    showDisconnectMessage() {
        let disconnectDiv = document.getElementById('disconnect-message');
        if (!disconnectDiv) {
            disconnectDiv = document.createElement('div');
            disconnectDiv.id = 'disconnect-message';
            disconnectDiv.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: rgba(200, 30, 30, 0.85);
                color: white;
                padding: 10px;
                font-size: 16px;
                font-family: Ubuntu, sans-serif;
                z-index: 1000;
                text-align: center;
            `;
            document.body.appendChild(disconnectDiv);
        }
        disconnectDiv.textContent = 'Disconnected from server. Reconnecting...';
    }

    hideDisconnectMessage() {
        const disconnectDiv = document.getElementById('disconnect-message');
        if (disconnectDiv) {
            disconnectDiv.remove();
        }
    }

    // UI methods for cross-server transfer
    showTransferMessage(message: string) {
        // Create or update transfer message UI
        let transferDiv = document.getElementById('transfer-message');
        if (!transferDiv) {
            transferDiv = document.createElement('div');
            transferDiv.id = 'transfer-message';
            transferDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px;
                border-radius: 10px;
                font-size: 18px;
                font-family: Ubuntu, sans-serif;
                z-index: 1000;
                text-align: center;
                border: 2px solid #00b3ff;
            `;
            document.body.appendChild(transferDiv);
        }
        transferDiv.textContent = message;
    }

    hideTransferMessage() {
        const transferDiv = document.getElementById('transfer-message');
        if (transferDiv) {
            transferDiv.remove();
        }
    }

}
