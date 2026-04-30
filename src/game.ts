import { applyZoomCompensation, canvasCoords } from './zoom-compensation';
import { Player, PlayerProgress, ServerPlayer, PlayerInventory } from './player';
import { Dot, Enemy, Obstacle } from './enemy';
import { Item, ItemWithRarity, WorldItem } from './item';
import { SVGLoader } from './SVGLoader';
import { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE, MOUSE_NONLINEAR_SCALE, MOUSE_NONLINEAR_EXPONENT } from './constants';
import { WORLD_MAP } from './map_data';
import { ITEM_RARITY_COLORS } from './petals';
import { Graphics } from './graphics';
import { Chat } from './chat';
import { GuildMenuManager } from './guildMenu';
import { initMultiPlayerMode, Socket } from './socket';
import { InventoryManager } from './inventory';
import { SkillsManager } from './skills';
import { ShopManager } from './shop';
import { PreloadedAssets } from './preloader';
import { Tutorial } from './tutorial';
import { ShaderManager } from './shader/shaderManager';
import { AssetLoader } from './asset_loader';
import { CanvasLoadoutBar, LOADOUT_SLOT_COUNT } from './graphics/loadout-bar';

// Global interface declarations
declare global {
    interface Window {
        shaderManager?: ShaderManager | null;
    }
}

// Add these interfaces at the top of the file
interface SandboxedScript {
    id: string;
    code: string;
    sender: string;
}

// Add this interface to properly type our sandbox window
interface SandboxWindow extends Window {
    safeContext?: any;
    eval?: (code: string) => any;
}

// Add these interfaces near the top of the file where other interfaces are defined
interface ItemRarityColors {
    common: string;
    uncommon: string;
    rare: string;
    epic: string;
    legendary: string;
    mythic: string;
    ultra: string;
    super: string;
    unique: string;
}

// Add after other interfaces at the top
interface CraftingSlot {
    index: number;
    item: Item | null;
}

export class Game {
    private speedBoostActive: boolean = false;
    private shieldActive: boolean = false;
    private debugCollision: boolean = false; // Toggle for collision debugging
    public canvas: HTMLCanvasElement;
    public graphics: Graphics;
    private socket!: Socket;  // Using the definite assignment assertion
    private players: Map<string, Player> = new Map();
    private activePlayerId: string | null = null; // Track active player ID for split players
    private dots: { x: number, y: number }[] = [];
    private readonly DOT_SIZE = 5;
    private readonly DOT_COUNT = 20;
    private readonly PLAYER_ACCELERATION = 0.5;  // Adjusted for smoother acceleration
    private readonly MAX_SPEED = 120;            // Further increased speed for better responsiveness
    private cameraX = 0;
    private cameraY = 0;
    private playerEye: { x: number, y: number } = { x: 0, y: 0 };
    private targetEye: { x: number, y: number } = { x: 0, y: 0 };
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
    private readonly WORLD_WIDTH = ACTUAL_WORLD_WIDTH;  // Increased from 2000 to 10000
    private readonly WORLD_HEIGHT = ACTUAL_WORLD_HEIGHT;  // Keep height the same
    private keysPressed: Set<string> = new Set();
    private mouseButtonsPressed: Set<number> = new Set(); // Track mouse buttons: 0 = left, 2 = right
    private petalExtension: number = 1.0; // 1.0 = normal, >1.0 = extended, <1.0 = retracted
    private enemies: Map<string, Enemy> = new Map();
    private mobProjectiles: Map<string, any> = new Map(); // Store mob projectiles
    private playerProjectiles: Map<string, any> = new Map(); // Store player projectiles
    private readonly PLAYER_MAX_HEALTH = 100;
    private readonly PLAYER_DAMAGE = 10;
    private readonly ENEMY_DAMAGE = 5;
    private readonly DAMAGE_COOLDOWN = 1000; // 1 second cooldown
    private lastDamageTime: number = 0;
    private obstacles: Obstacle[] = [];
    private readonly ENEMY_CORAL_MAX_HEALTH = 50;
    private items: Map<string, WorldItem> = new Map();
    private pickedUpItems: Set<string> = new Set(); // Track items picked up by this player
    get isInventoryOpen(): boolean {
        return this.inventoryManager?.getIsInventoryOpen() ?? false;
    }
    private gameLoopId: number | null = null;
    private socketHandlers: Map<string, Function> = new Map();
    private readonly BASE_XP_REQUIREMENT = 100;
    private readonly XP_MULTIPLIER = 1.5;
    private readonly MAX_LEVEL = 50;
    private readonly HEALTH_PER_LEVEL = 20;
    private readonly DAMAGE_PER_LEVEL = 2;
    // Add this property to store floating texts
    private floatingTexts: Array<{
        x: number;
        y: number;
        text: string;
        color: string;
        fontSize: number;
        alpha: number;
        lifetime: number;
    }> = [];
    // Add enemy size multipliers as a class property
    // Add property to track if player is dead
    private isPlayerDead: boolean = false;
    // Add minimap properties
    private readonly MINIMAP_WIDTH = 200;  // Increased from 40
    private readonly MINIMAP_HEIGHT = 200; // Made square for better visibility
    private readonly MINIMAP_PADDING = 10;
    // Add decoration-related properties
    private decorations: Array<{
        x: number;
        y: number;
        scale: number;
    }> = [];
    // Add sand property
    private sands: Array<{
        x: number;
        y: number;
        radius: number;
        rotation: number;
    }> = [];
    // Add control mode property
    private useMouseControls: boolean = localStorage.getItem('useMouseControls') === 'true';
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
    private fpsCounter: number = 0;
    private fpsUpdateTime: number = 0;
    // Rolling per-frame work-time average (ms). If this is well under
    // 1000/displayHz, the FPS cap is vsync/browser, not CPU work.
    private frameTimeAvgMs: number = 0;
    private frameTimeSamples: number = 0;
    private frameTimeAccum: number = 0;
    // Connection quality tracking for slow connection optimization
    private lastPingTime: number = 0;
    private averagePing: number = 0;
    private pingSamples: number[] = [];
    private readonly MAX_PING_SAMPLES = 10;
    private lastInputSendTime: number = 0;
    private readonly MIN_INPUT_INTERVAL = 33; // ~30 TPS (match server tick rate)
    private connectionQuality: 'good' | 'medium' | 'slow' = 'good';
    private frameCount: number = 0;
    private bytesReceived: number = 0;
    private bytesSent: number = 0;
    private lastBytesReceived: number = 0;
    private lastBytesSent: number = 0;
    private incomingThroughput: number = 0;
    private outgoingThroughput: number = 0;
    private titleScreen: HTMLElement | null;
    private nameInput: HTMLInputElement | null;
    private exitButton: HTMLElement | null;
    private exitButtonContainer: HTMLElement | null;
    private playerHue: number = 0;
    private playerColor: string = 'hsl(0, 100%, 50%)';
    private colorPreviewCanvas: HTMLCanvasElement;
    private readonly LOADOUT_SLOTS = 10;
    private readonly LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    // Add to class properties
    private inventoryPanel: HTMLDivElement | null = null;
    private saveIndicator: HTMLDivElement | null = null;
    private saveIndicatorTimeout: NodeJS.Timeout | null = null;
    // Add to class properties
    private chatContainer: HTMLDivElement | null = null;
    private chatInput: HTMLInputElement | null = null;
    private chatMessages: HTMLDivElement | null = null;
    private isChatFocused: boolean = false;
    // Add to Game class properties
    private pendingScripts: Map<string, SandboxedScript> = new Map();
    // Add to Game class properties
    public readonly ITEM_RARITY_COLORS = ITEM_RARITY_COLORS;
    // Add to Game class properties
    private craftingPanel: HTMLDivElement | null = null;
    private craftingSlots: CraftingSlot[] = Array(4).fill(null).map((_, i) => ({ index: i, item: null }));
    private isCraftingOpen: boolean = false;
    private svgLoader: SVGLoader;
    private readonly WALL_SPACING = 500; // Distance between walls
    private world_map_data: MapElement[] = [];

    // Add map rendering properties

    private lastUpdateTime: number = 0;         // Add this property for delta time
    private lastServerUpdate: number = 0;
    private lastHeartbeat: number = 0;
    private heartbeatInterval: NodeJS.Timeout | null = null;       // Add this property for server update time

    // Asset loader instance
    private assetLoader: AssetLoader;

    private lastDeathTime: number = 0;
    private deathCooldown: number = 3000; // 3 seconds

    private lastMessageTime: number = 0; // Add this line
    private messageCooldown: number = 1000; // 1 second cooldown

    private gameStartTime: number = 0;

    // Add chat property
    private chat: Chat | null = null;
    public guildMenu: GuildMenuManager | null = null;

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

    constructor(showHitboxes: boolean, serverIp: string, preloadedAssets?: PreloadedAssets | null, shadersEnabled: boolean = false, showStats: boolean = false, dynamicSkybox: boolean = false) {
        this.showHitboxes = showHitboxes;
        this.showStats = showStats;
        this.interpolationAmount = parseFloat(localStorage.getItem('interpolationAmount') || '0.15');
        this.loadControls();
        console.log('[Game] Constructor called, using preloaded assets:', !!preloadedAssets, 'shaders enabled:', shadersEnabled, 'show stats:', showStats, 'dynamic skybox:', dynamicSkybox);
        
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

        // Initialize shaders if enabled
        if (shadersEnabled && window.shaderManager) {
            window.shaderManager.setShadersEnabled(true);
        }

        // Set initial canvas size
        this.resizeCanvas();

        // Add resize listener (also fires on browser zoom changes)
        window.addEventListener('resize', () => this.resizeCanvas(), { signal: this.abortController.signal });

        // Create and set up preview canvas BEFORE using it
        this.colorPreviewCanvas = document.createElement('canvas');
        this.colorPreviewCanvas.width = 64;  // Set fixed size for preview
        this.colorPreviewCanvas.height = 64;
        this.colorPreviewCanvas.style.width = '64px';
        this.colorPreviewCanvas.style.height = '64px';
        this.colorPreviewCanvas.style.imageRendering = 'pixelated';

        // Add preview canvas to the color picker
        const previewContainer = document.createElement('div');
        previewContainer.style.display = 'flex';
        previewContainer.style.justifyContent = 'center';
        previewContainer.style.marginTop = '10px';
        previewContainer.appendChild(this.colorPreviewCanvas);
        document.querySelector('.color-picker')?.appendChild(previewContainer);

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
            this.updateColorPreview();
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
                this.updateColorPreview();
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
                this.updateColorPreview();
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

                    if (this.assetLoader.playerSprite.complete) {
                        this.updateColorPreview();
                    }

                    // Show confirmation message
                    this.showFloatingText(
                        this.canvas.width / 2,
                        50,
                        'Color Updated!',
                        '#4CAF50',
                        20
                    );
                }, { signal: this.abortController.signal });
            }
        }

        this.setupEventListeners();

        // Get title screen elements
        this.titleScreen = document.querySelector('.center_text');
        this.nameInput = document.getElementById('nameInput') as HTMLInputElement;

        // Initialize multiplayer mode after resource loading
        initMultiPlayerMode(this, serverIp);

        // Move authentication to after socket initialization
        this.authenticate();

        this.socket.on('inventoryUpdated', (inventory: PlayerInventory) => {
            const player = this.getLocalPlayer();
            if (player) {
                player.inventory = inventory;
                // Only update display if inventory UI is open to avoid unnecessary DOM updates
                if (this.isInventoryOpen) {
                    this.inventoryManager.updateInventoryDisplay();
                }
            }
        });

        // Add mouse move listener - always track mouse position so it's available when toggling mouse controls
        this.canvas.addEventListener('mousemove', (event) => {
            // Loadout bar hover/drag tracking (screen-space)
            const { x: sx, y: sy } = canvasCoords(this.canvas, event);
            // Settings panel hover/slider drag
            if (window.titleScreen && window.titleScreen.isSettingsOpen()) {
                window.titleScreen.handleSettingsMouseMoveExternal(sx);
                window.titleScreen.handleSettingsHoverExternal(sx, sy);
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
            const worldX = screenX / this.zoomLevel + this.cameraX;
            const worldY = screenY / this.zoomLevel + this.cameraY;

            // Calculate normalized screen coordinates (-1 to 1, where 0,0 is center of screen)
            // X: -1 is left edge, 0 is center, 1 is right edge
            // Y: -1 is top edge, 0 is center, 1 is bottom edge
            this.normalizedMouseXOnScreen = ((screenX / this.canvas.width) * 2 - 1) / (this.canvas.height / this.canvas.width);
            this.normalizedMouseYOnScreen = (screenY / this.canvas.height) * 2 - 1;

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
                const { x: sx, y: sy } = canvasCoords(this.canvas, event);
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
                const { x: sx, y: sy } = canvasCoords(this.canvas, event);
                if (window.titleScreen.handleSettingsMouseDownExternal(sx, sy)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
            // Intercept clicks on the canvas death screen buttons
            if (event.button === 0 && this.isPlayerDead && this.graphics.deathScreenVisible) {
                const { x: sx, y: sy } = canvasCoords(this.canvas, event);
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
                const { x: sx, y: sy } = canvasCoords(this.canvas, event);
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
                const { x: sx, y: sy } = canvasCoords(this.canvas, event);
                if (window.titleScreen.handleSettingsClickExternal(sx, sy)) {
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

        // Initialize exit button
        this.exitButton = document.getElementById('exitButton');
        this.exitButtonContainer = document.getElementById('exitButtonContainer');

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
        this.skillsManager = new SkillsManager(this);
        this.shopManager = new ShopManager(this);

        this.svgLoader = new SVGLoader();
        this.assetLoader.loadAssets();

        // Map is bundled with the client via src/map_data.ts (no longer streamed
        // from the server). The wall grid is populated as a side-effect of that
        // import, so we just need to wire the elements into the renderer.
        this.world_map_data = WORLD_MAP;
        this.graphics.setMap(WORLD_MAP);
        this.renderMap(WORLD_MAP);
        this.assetLoader.loadBiomeTextures(WORLD_MAP, this.graphics);
        this.assetLoader.loadSectionTextures(this.graphics);
        this.updateTitleScreenBiomes(WORLD_MAP);
        // preconnectedMapData is legacy — clear it if the title screen ever set it.
        if (window.preconnectedMapData) window.preconnectedMapData = null;

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

        // Load wall texture
        this.assetLoader.loadWallTexture();

        this.gameStartTime = Date.now();

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
        // Get credentials from AuthUI or localStorage
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
                this.showFloatingText(
                    this.canvas.width / 2,
                    50,
                    `Controls: ${this.useMouseControls ? 'Mouse' : 'Keyboard'}`,
                    '#FFFFFF',
                    20
                );
                return;
            }

            if (key === normalizeKey(this.controls.toggle_hitboxes)) {
                this.showHitboxes = !this.showHitboxes;
                this.graphics.showHitboxes = this.showHitboxes;
                localStorage.setItem('showHitboxes', this.showHitboxes.toString());
                this.showFloatingText(
                    this.canvas.width / 2,
                    50,
                    `Hitboxes: ${this.showHitboxes ? 'ON' : 'OFF'}`,
                    '#FFFFFF',
                    20
                );
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
                this.showFloatingText(
                    this.canvas.width / 2,
                    50,
                    `Minimap Zoom: ${Math.round(this.graphics.getMinimapZoom() * 100)}%`,
                    '#FFFFFF',
                    20
                );
                return;
            }
            if (key === normalizeKey(this.controls.minimap_zoom_out)) {
                this.graphics.zoomOutMinimap();
                this.showFloatingText(
                    this.canvas.width / 2,
                    50,
                    `Minimap Zoom: ${Math.round(this.graphics.getMinimapZoom() * 100)}%`,
                    '#FFFFFF',
                    20
                );
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

    private zoomIn() {
        this.zoomLevel = Math.min(this.zoomLevel + this.ZOOM_STEP, this.MAX_ZOOM);
        this.showFloatingText(
            this.canvas.width / 2,
            50,
            `Zoom: ${Math.round(this.zoomLevel * 100)}%`,
            '#FFFFFF',
            20
        );
    }

    private zoomOut() {
        this.zoomLevel = Math.max(this.zoomLevel - this.ZOOM_STEP, this.MIN_ZOOM);
        this.showFloatingText(
            this.canvas.width / 2,
            50,
            `Zoom: ${Math.round(this.zoomLevel * 100)}%`,
            '#FFFFFF',
            20
        );
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
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        
        const targetX = player.x - scaledWidth / 2;
        const targetY = player.y - scaledHeight / 2;

        // Clamp camera to world bounds with proper dimensions
        // this.cameraX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - scaledWidth, targetX)); // messes up mouse control
        // this.cameraY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - scaledHeight, targetY));
        this.cameraX = targetX;
        this.cameraY = targetY;
        this.graphics.setCamera(this.cameraX, this.cameraY, this.zoomLevel);
        
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
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        
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
                
                const scaledWidth = this.canvas.width / this.zoomLevel;
                const scaledHeight = this.canvas.height / this.zoomLevel;
                
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
        
        this.graphics.setCamera(this.cameraX, this.cameraY, this.zoomLevel);
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

                this.incomingThroughput = this.bytesReceived - this.lastBytesReceived;
                this.outgoingThroughput = this.bytesSent - this.lastBytesSent;
                this.lastBytesReceived = this.bytesReceived;
                this.lastBytesSent = this.bytesSent;

                // Roll the per-frame work-time average over to the displayed
                // value once per second alongside FPS.
                this.frameTimeAvgMs = this.frameTimeSamples > 0
                    ? this.frameTimeAccum / this.frameTimeSamples
                    : 0;
                this.frameTimeAccum = 0;
                this.frameTimeSamples = 0;
            }
        }

        this.update();
        
        // Filter out items that this player has already picked up
        const visibleItems = new Map<string, WorldItem>();
        for (const [itemId, item] of this.items.entries()) {
            if (!this.pickedUpItems.has(itemId)) {
                visibleItems.set(itemId, item);
            }
        }
        
        // Use active player ID for rendering (or socket.id if not split)
        const activePlayerId = this.activePlayerId || this.socket?.id || '';
        this.graphics.render(this.players, this.enemies, visibleItems, this.mobProjectiles, this.playerProjectiles, activePlayerId, this.petalExtension);
        // Draw canvas loadout bar on top of game UI
        if (this.loadoutBar) {
            const localPlayer = this.getLocalPlayer();
            if (localPlayer) this.loadoutBar.show(); else this.loadoutBar.hide();
            this.loadoutBar.draw(this.graphics.ctx);
        }
        if (this.showStats) {
            this.renderStatsOverlay();
        }
        // Render canvas-based settings overlay if open
        if (window.titleScreen && window.titleScreen.isSettingsOpen()) {
            window.titleScreen.renderSettingsOverlay(this.graphics.ctx);
        }
        if (this.showStats) {
            this.frameTimeAccum += performance.now() - frameStartMs;
            this.frameTimeSamples++;
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
        const lerpFactor = this.interpolationAmount;
        const now = performance.now();
        const frameDeltaMs = this.lastInterpolationTime > 0 ? now - this.lastInterpolationTime : 16.67;
        this.lastInterpolationTime = now;
        // Frame-rate-independent exponential smoothing: equivalent to lerpFactor at 60fps
        // rate ~= -ln(1 - lerpFactor) * 60
        const smoothingRate = -Math.log(1 - lerpFactor) * 60;
        const smoothingFactor = 1 - Math.exp(-smoothingRate * frameDeltaMs / 1000);

        for (const player of this.players.values()) {
            if (player.targetX !== undefined && player.targetY !== undefined) {
                const dx = player.targetX - player.x;
                const dy = player.targetY - player.y;
                // Snap when close enough to avoid sub-pixel oscillation
                if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
                    player.x = player.targetX;
                    player.y = player.targetY;
                } else {
                    player.x += dx * smoothingFactor;
                    player.y += dy * smoothingFactor;
                }
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
            if (enemy.targetX !== undefined && enemy.targetY !== undefined) {
                enemy.x += (enemy.targetX - enemy.x) * smoothingFactor;
                enemy.y += (enemy.targetY - enemy.y) * smoothingFactor;
            }
            if (enemy.targetAngle !== undefined) {
                let angleDiff = enemy.targetAngle - enemy.angle;
                if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                enemy.angle += angleDiff * smoothingFactor;
            }
        }

        // Update petal extension based on key presses
        this.updatePetalExtension();

        const player = this.getLocalPlayer();
        if (player) {
            this.updatePlayerMovement(player, 1); // Still needed to send input to server
            this.updateCamera(player);
            this.updatePlayerEye();
        }
    }

    private updatePetalExtension() {
        const extensionSpeed = 0.05; // How fast petals extend/retract
        const maxExtension = 2.0; // Maximum extension multiplier
        const minExtension = 0.7; // Minimum extension multiplier

        // Check for space key or left mouse button (button 0)
        const extendPressed = this.keysPressed.has(' ') || this.mouseButtonsPressed.has(0);
        // Check for shift key or right mouse button (button 2)
        const retractPressed = this.keysPressed.has('Shift') || this.mouseButtonsPressed.has(2);

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
        const speed = 5 * (player.speed_boost ? 2 : 1);
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
            viewportWidth: this.canvas.width / this.zoomLevel,
            viewportHeight: this.canvas.height / this.zoomLevel
        };

        // Calculate mouse movement direction on client when mouse controls are enabled
        if (this.useMouseControls && !isAnyMenuOpen) {
            // Always use the stored target position (in world coordinates)
            // This ensures the target doesn't drift as the camera moves
            let targetX: number;
            let targetY: number;
            
            if (this.hasValidMouseTarget && 
                isFinite(this.lastMouseTargetX) && isFinite(this.lastMouseTargetY) &&
                !isNaN(this.lastMouseTargetX) && !isNaN(this.lastMouseTargetY)) {
                targetX = this.lastMouseTargetX;
                targetY = this.lastMouseTargetY;
            } else {
                // If no valid target yet, use current mouse position and set it as target
                if (isFinite(this.mouseX) && isFinite(this.mouseY) &&
                    !isNaN(this.mouseX) && !isNaN(this.mouseY)) {
                    this.lastMouseTargetX = this.mouseX;
                    this.lastMouseTargetY = this.mouseY;
                    this.hasValidMouseTarget = true;
                    targetX = this.mouseX;
                    targetY = this.mouseY;
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
            // These represent the direction from center of screen to mouse cursor
            const dirX = this.normalizedMouseXOnScreen;
            const dirY = this.normalizedMouseYOnScreen;
            const distance = Math.sqrt(dirX * dirX + dirY * dirY);
            
            // Only send mouse input if distance is significant (greater than 0.01 to allow small movements)
            if (distance > 0.01) {
                // Normalize the direction vector to ensure it's a unit vector
                const normalizedDirX = dirX / distance;
                const normalizedDirY = dirY / distance;
                
                // Calculate nonlinear speed multiplier based on distance from center
                // Distance is already normalized (0 to ~1.414 for corner), so we can use it directly
                const normalizedDistance = Math.min(distance, 1.0);
                const speedMultiplier = Math.pow(normalizedDistance, MOUSE_NONLINEAR_EXPONENT);
                // Add minimum speed multiplier to prevent movement from becoming too slow when close to center
                const minSpeedMultiplier = 0.15;
                const finalSpeedMultiplier = Math.max(speedMultiplier, minSpeedMultiplier);
                
                // Send normalized direction and speed multiplier to server
                // Server will apply MAX_SPEED, speed_boost, and other multipliers
                inputData.useMouse = true;
                inputData.mouseDirectionX = normalizedDirX;
                inputData.mouseDirectionY = normalizedDirY;
                inputData.mouseSpeedMultiplier = finalSpeedMultiplier;
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
            this.socket.emit('playerInput', inputData);
            this.lastInputSendTime = now;
        }
    }

    private getInputInterval(): number {
        // Adjust input rate based on connection quality
        if (this.connectionQuality === 'slow') {
            return 66; // ~15 TPS for slow connections
        } else if (this.connectionQuality === 'medium') {
            return 50; // ~20 TPS for medium connections
        }
        return this.MIN_INPUT_INTERVAL; // ~30 TPS for good connections
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

        const x = canvas.width - 8;
        const player = this.socket?.id ? this.players.get(this.socket.id) : undefined;

        const lines: { text: string; color: string }[] = [];

        // Player position
        if (player) {
            lines.push({ text: `Pos: ${Math.round(player.x)}, ${Math.round(player.y)}`, color: '#ffd700' });
        }

        // Network
        const pingStr = this.averagePing > 0 ? `${Math.round(this.averagePing)}ms` : '--';
        lines.push({ text: `Ping: ${pingStr} | In: ${this.formatBytes(this.incomingThroughput)}/s | Out: ${this.formatBytes(this.outgoingThroughput)}/s`, color: '#a78bfa' });

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

        // Draw from bottom up
        let y = canvas.height - 8;
        for (const line of lines) {
            ctx.strokeText(line.text, x, y);
            ctx.fillStyle = line.color;
            ctx.fillText(line.text, x, y);
            y -= lineHeight;
        }
        ctx.restore();
    }

    public trackSocketBytes(bytes: number, direction: 'in' | 'out'): void {
        if (direction === 'in') {
            this.bytesReceived += bytes;
        } else {
            this.bytesSent += bytes;
        }
    }

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
        this.world_map_data = mapData;
        this.graphics.drawMap(mapData);
    }



    private resizeCanvas() {
        applyZoomCompensation(this.canvas);
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

        // Remove all socket listeners before disconnecting
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
        }

        // Clear heartbeat interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Clear all game data
        this.players.clear();
        this.enemies.clear();
        this.dots = [];
        this.obstacles = [];
        this.items = new Map();
        this.world_map_data = [];
        this.floatingTexts = [];
        this.decorations = [];
        this.sands = [];

        // Reset game state
        this.isCraftingOpen = false;
        this.speedBoostActive = false;
        this.shieldActive = false;
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
    }

    private hideExitButton() {
        if (this.exitButtonContainer) {
            this.exitButtonContainer.style.display = 'none';
        }
    }

    private handleExit() {
        this.cleanup();
    }


    private updateColorPreview() {
        if (!this.assetLoader.playerSprite.complete) return;

        const ctx = this.colorPreviewCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, this.colorPreviewCanvas.width, this.colorPreviewCanvas.height);

        // Draw the sprite centered in the preview
        const scale = Math.min(
            this.colorPreviewCanvas.width / this.assetLoader.playerSprite.width,
            this.colorPreviewCanvas.height / this.assetLoader.playerSprite.height
        );

        const x = (this.colorPreviewCanvas.width - this.assetLoader.playerSprite.width * scale) / 2;
        const y = (this.colorPreviewCanvas.height - this.assetLoader.playerSprite.height * scale) / 2;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.drawImage(this.assetLoader.playerSprite, 0, 0);

        const imageData = ctx.getImageData(0, 0, this.colorPreviewCanvas.width, this.colorPreviewCanvas.height);
        this.assetLoader.applyHueRotation(ctx, imageData, this.playerHue);
        ctx.putImageData(imageData, 0, 0);
        ctx.restore();
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
    public showSaveIndicator() {
        this.graphics.showFloatingText(this.canvas.width / 2, 0, 'Progress Saved', 'white', 20);
    }

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