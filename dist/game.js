"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Game = void 0;
const SVGLoader_1 = require("./SVGLoader");
const constants_1 = require("./constants");
const graphics_1 = require("./graphics");
const chat_1 = require("./chat");
const socket_1 = require("./socket");
const inventory_1 = require("./inventory");
const skills_1 = require("./skills");
const shop_1 = require("./shop");
const tutorial_1 = require("./tutorial");
const asset_loader_1 = require("./asset_loader");
const loadout_bar_1 = require("./graphics/loadout-bar");
class Game {
    get isInventoryOpen() {
        return this.inventoryManager?.getIsInventoryOpen() ?? false;
    }
    constructor(showHitboxes, serverIp, preloadedAssets, shadersEnabled = false, showStats = false, dynamicSkybox = false) {
        this.speedBoostActive = false;
        this.shieldActive = false;
        this.debugCollision = false; // Toggle for collision debugging
        this.players = new Map();
        this.activePlayerId = null; // Track active player ID for split players
        this.dots = [];
        this.DOT_SIZE = 5;
        this.DOT_COUNT = 20;
        this.PLAYER_ACCELERATION = 0.5; // Adjusted for smoother acceleration
        this.MAX_SPEED = 120; // Further increased speed for better responsiveness
        this.cameraX = 0;
        this.cameraY = 0;
        this.playerEye = { x: 0, y: 0 };
        this.targetEye = { x: 0, y: 0 };
        this.zoomLevel = 1.0;
        // Viewport animation properties
        this.isAnimatingViewport = false;
        this.animationStartTime = 0;
        this.animationDuration = 1000; // 1 second for each animation phase
        this.animationStartPos = { x: 0, y: 0 };
        this.animationTargetPos = { x: 0, y: 0 };
        this.animationPhase = 'none';
        this.savedPlayerPos = { x: 0, y: 0 };
        this.MIN_ZOOM = 0.5;
        this.MAX_ZOOM = 3.0;
        this.ZOOM_STEP = 0.1;
        this.WORLD_WIDTH = constants_1.ACTUAL_WORLD_WIDTH; // Increased from 2000 to 10000
        this.WORLD_HEIGHT = constants_1.ACTUAL_WORLD_HEIGHT; // Keep height the same
        this.keysPressed = new Set();
        this.mouseButtonsPressed = new Set(); // Track mouse buttons: 0 = left, 2 = right
        this.petalExtension = 1.0; // 1.0 = normal, >1.0 = extended, <1.0 = retracted
        this.enemies = new Map();
        this.mobProjectiles = new Map(); // Store mob projectiles
        this.playerProjectiles = new Map(); // Store player projectiles
        this.PLAYER_MAX_HEALTH = 100;
        this.PLAYER_DAMAGE = 10;
        this.ENEMY_DAMAGE = 5;
        this.DAMAGE_COOLDOWN = 1000; // 1 second cooldown
        this.lastDamageTime = 0;
        this.obstacles = [];
        this.ENEMY_CORAL_MAX_HEALTH = 50;
        this.items = new Map();
        this.pickedUpItems = new Set(); // Track items picked up by this player
        this.gameLoopId = null;
        this.socketHandlers = new Map();
        this.BASE_XP_REQUIREMENT = 100;
        this.XP_MULTIPLIER = 1.5;
        this.MAX_LEVEL = 50;
        this.HEALTH_PER_LEVEL = 20;
        this.DAMAGE_PER_LEVEL = 2;
        // Add this property to store floating texts
        this.floatingTexts = [];
        // Add enemy size multipliers as a class property
        // Add property to track if player is dead
        this.isPlayerDead = false;
        // Add minimap properties
        this.MINIMAP_WIDTH = 200; // Increased from 40
        this.MINIMAP_HEIGHT = 200; // Made square for better visibility
        this.MINIMAP_PADDING = 10;
        // Add decoration-related properties
        this.decorations = [];
        // Add sand property
        this.sands = [];
        // Add control mode property
        this.useMouseControls = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.normalizedMouseXOnScreen = 0;
        this.normalizedMouseYOnScreen = 0;
        this.lastMouseTargetX = 0;
        this.lastMouseTargetY = 0;
        this.hasValidMouseTarget = false;
        this.showHitboxes = false; // Changed from true to false
        this.showStats = false; // Combined setting for FPS, counters, and memory
        this.mobDeathAnimation = true; // Mob death animation setting (default true)
        this.interpolationAmount = 0.3; // Interpolation factor (0 = no interpolation/snap, 1 = instant)
        this.lastInterpolationTime = 0;
        this.fpsCounter = 0;
        this.fpsUpdateTime = 0;
        // Connection quality tracking for slow connection optimization
        this.lastPingTime = 0;
        this.averagePing = 0;
        this.pingSamples = [];
        this.MAX_PING_SAMPLES = 10;
        this.lastInputSendTime = 0;
        this.MIN_INPUT_INTERVAL = 33; // ~30 TPS (match server tick rate)
        this.connectionQuality = 'good';
        this.frameCount = 0;
        this.fpsDisplayElement = null;
        this.mobCounterElement = null;
        this.playerCounterElement = null;
        this.networkStatsElement = null;
        this.bytesReceived = 0;
        this.bytesSent = 0;
        this.lastBytesReceived = 0;
        this.lastBytesSent = 0;
        this.incomingThroughput = 0;
        this.outgoingThroughput = 0;
        this.playerHue = 0;
        this.playerColor = 'hsl(0, 100%, 50%)';
        this.LOADOUT_SLOTS = 10;
        this.LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
        // Add to class properties
        this.inventoryPanel = null;
        this.saveIndicator = null;
        this.saveIndicatorTimeout = null;
        // Add to class properties
        this.chatContainer = null;
        this.chatInput = null;
        this.chatMessages = null;
        this.isChatFocused = false;
        // Add to Game class properties
        this.pendingScripts = new Map();
        // Add to Game class properties
        this.ITEM_RARITY_COLORS = {
            common: '#808080', // Gray
            uncommon: '#008000', // Green
            rare: '#0000FF', // Blue
            epic: '#800080', // Purple
            legendary: '#FFA500', // Orange
            mythic: '#FF0000' // Red
        };
        // Add to Game class properties
        this.craftingPanel = null;
        this.craftingSlots = Array(4).fill(null).map((_, i) => ({ index: i, item: null }));
        this.isCraftingOpen = false;
        this.WALL_SPACING = 500; // Distance between walls
        this.world_map_data = [];
        // Add map rendering properties
        this.lastUpdateTime = 0; // Add this property for delta time
        this.lastServerUpdate = 0;
        this.lastHeartbeat = 0;
        this.heartbeatInterval = null; // Add this property for server update time
        this.lastDeathTime = 0;
        this.deathCooldown = 3000; // 3 seconds
        this.lastMessageTime = 0; // Add this line
        this.messageCooldown = 1000; // 1 second cooldown
        this.gameStartTime = 0;
        // Add chat property
        this.chat = null;
        this.beforeUnloadHandler = null;
        this.abortController = new AbortController();
        this.createdElements = []; // Track DOM elements for cleanup
        this.itemSpriteDataUrls = new Map();
        this.showHitboxes = showHitboxes;
        this.showStats = showStats;
        this.interpolationAmount = parseFloat(localStorage.getItem('interpolationAmount') || '0.15');
        this.loadControls();
        console.log('[Game] Constructor called, using preloaded assets:', !!preloadedAssets, 'shaders enabled:', shadersEnabled, 'show stats:', showStats, 'dynamic skybox:', dynamicSkybox);
        // Initialize asset loader
        this.assetLoader = new asset_loader_1.AssetLoader();
        // Wait for canvas to be ready before proceeding
        this.waitForCanvas();
        this.canvas = document.getElementById('gameCanvas');
        // Use preloaded assets if available
        if (preloadedAssets) {
            console.log('[Game] Using preloaded assets');
            this.assetLoader.initializeFromPreloaded(preloadedAssets);
        }
        this.graphics = new graphics_1.Graphics(this.canvas, this.assetLoader.playerSprite, this.assetLoader.wallTexture, this.assetLoader.healthPotionSprite, this.assetLoader.speedBoostSprite, this.assetLoader.shieldSprite, this.assetLoader.backgroundTexture);
        this.graphics.showHitboxes = this.showHitboxes;
        this.graphics.dynamicSkybox = dynamicSkybox;
        this.graphics.mobDeathAnimation = this.mobDeathAnimation;
        // Initialize shaders if enabled
        if (shadersEnabled && window.shaderManager) {
            window.shaderManager.setShadersEnabled(true);
        }
        // Set initial canvas size
        this.resizeCanvas();
        // Add resize listener
        window.addEventListener('resize', () => this.resizeCanvas(), { signal: this.abortController.signal });
        // Create and set up preview canvas BEFORE using it
        this.colorPreviewCanvas = document.createElement('canvas');
        this.colorPreviewCanvas.width = 64; // Set fixed size for preview
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
            }
            else {
                // Fallback: load petal images dynamically
                console.log('[Game] Petal images not preloaded, loading dynamically');
                this.graphics.preloadPetalImages().catch(console.error);
            }
            this.updateColorPreview();
            this.gameLoop();
        }
        else {
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
        const hueSlider = document.getElementById('hueSlider');
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
                const value = e.target.value;
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
                    this.showFloatingText(this.canvas.width / 2, 50, 'Color Updated!', '#4CAF50', 20);
                }, { signal: this.abortController.signal });
            }
        }
        this.setupEventListeners();
        // Get title screen elements
        this.titleScreen = document.querySelector('.center_text');
        this.nameInput = document.getElementById('nameInput');
        // Initialize multiplayer mode after resource loading
        (0, socket_1.initMultiPlayerMode)(this, serverIp);
        // Move authentication to after socket initialization
        this.authenticate();
        this.socket.on('inventoryUpdated', (inventory) => {
            const player = this.getLocalPlayer();
            if (player) {
                player.inventory = inventory;
                // Only update display if inventory UI is open to avoid unnecessary DOM updates
                if (this.isInventoryOpen) {
                    this.inventoryManager.updateInventoryDisplay();
                }
            }
        });
        // Add respawn button listener
        const respawnButton = document.getElementById('respawnButton');
        respawnButton?.addEventListener('click', () => {
            if (this.isPlayerDead) {
                this.socket.emit('requestRespawn');
            }
        }, { signal: this.abortController.signal });
        // Add mouse move listener - always track mouse position so it's available when toggling mouse controls
        this.canvas.addEventListener('mousemove', (event) => {
            // Loadout bar hover/drag tracking (screen-space)
            const cRect = this.canvas.getBoundingClientRect();
            const sx = event.clientX - cRect.left;
            const sy = event.clientY - cRect.top;
            if (this.loadoutBar) {
                this.loadoutBar.setHover(sx, sy);
                if (this.loadoutBar.draggingSlotIndex >= 0) {
                    this.loadoutBar.setDragPos(sx, sy);
                }
            }
            const rect = this.canvas.getBoundingClientRect();
            // Convert screen coordinates to world coordinates accounting for zoom
            // Formula: worldX = (screenX / zoom) + cameraX
            // This gives the absolute world position of the mouse cursor
            const screenX = event.clientX - rect.left;
            const screenY = event.clientY - rect.top;
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
        // Add mouse button listeners for petal extension/retraction
        this.canvas.addEventListener('mousedown', (event) => {
            // Intercept left-clicks over the canvas loadout bar to start drag
            if (event.button === 0 && this.loadoutBar && this.loadoutBar.isVisible()) {
                const cRect = this.canvas.getBoundingClientRect();
                const sx = event.clientX - cRect.left;
                const sy = event.clientY - cRect.top;
                const hit = this.loadoutBar.hitTest(sx, sy);
                if (hit >= 0 && hit < loadout_bar_1.LOADOUT_SLOT_COUNT) {
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
        }, { signal: this.abortController.signal });
        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        }, { signal: this.abortController.signal });
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
        // Create FPS display element
        this.fpsDisplayElement = document.createElement('div');
        this.fpsDisplayElement.id = 'fpsDisplay';
        this.fpsDisplayElement.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            color: #00ff00;
            font-family: Ubuntu, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 10000;
            display: none;
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
        `;
        this.fpsDisplayElement.textContent = 'FPS: 0';
        document.body.appendChild(this.fpsDisplayElement);
        this.createdElements.push(this.fpsDisplayElement);
        // Set initial stats display visibility
        if (this.fpsDisplayElement) {
            this.fpsDisplayElement.style.display = this.showStats ? 'block' : 'none';
        }
        // Create mob counter element
        this.mobCounterElement = document.createElement('div');
        this.mobCounterElement.id = 'mobCounter';
        this.mobCounterElement.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 10px;
            color: #ff6b6b;
            font-family: Ubuntu, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 10000;
            display: block;
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
        `;
        this.mobCounterElement.textContent = 'Mobs: 0';
        document.body.appendChild(this.mobCounterElement);
        this.createdElements.push(this.mobCounterElement);
        // Create player counter element
        this.playerCounterElement = document.createElement('div');
        this.playerCounterElement.id = 'playerCounter';
        this.playerCounterElement.style.cssText = `
            position: fixed;
            bottom: 50px;
            right: 10px;
            color: #4ecdc4;
            font-family: Ubuntu, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 10000;
            display: block;
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
        `;
        this.playerCounterElement.textContent = 'Players: 0';
        document.body.appendChild(this.playerCounterElement);
        this.createdElements.push(this.playerCounterElement);
        // Create network stats element
        this.networkStatsElement = document.createElement('div');
        this.networkStatsElement.id = 'networkStats';
        this.networkStatsElement.style.cssText = `
            position: fixed;
            bottom: 70px;
            right: 10px;
            color: #a78bfa;
            font-family: Ubuntu, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 10000;
            display: block;
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
        `;
        this.networkStatsElement.textContent = 'Ping: -- | In: 0 B/s | Out: 0 B/s';
        document.body.appendChild(this.networkStatsElement);
        this.createdElements.push(this.networkStatsElement);
        // Set initial counter visibility
        if (this.mobCounterElement) {
            this.mobCounterElement.style.display = this.showStats ? 'block' : 'none';
        }
        if (this.playerCounterElement) {
            this.playerCounterElement.style.display = this.showStats ? 'block' : 'none';
        }
        if (this.networkStatsElement) {
            this.networkStatsElement.style.display = this.showStats ? 'block' : 'none';
        }
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
        this.inventoryManager = new inventory_1.InventoryManager(this, this.chat);
        this.loadoutBar = new loadout_bar_1.CanvasLoadoutBar(this);
        this.skillsManager = new skills_1.SkillsManager(this);
        this.shopManager = new shop_1.ShopManager(this);
        this.svgLoader = new SVGLoader_1.SVGLoader();
        this.assetLoader.loadAssets();
        // Check if we have preconnected map data
        if (window.preconnectedMapData) {
            console.log('[Game] Using preconnected map data');
            const mapData = window.preconnectedMapData;
            // Handle MapData format (with elements property) or legacy array format
            const elements = mapData.elements || mapData;
            this.world_map_data = elements;
            this.graphics.setMap(elements);
            this.renderMap(elements);
            // Load biome textures
            this.assetLoader.loadBiomeTextures(elements, this.graphics);
            // Load section textures
            this.assetLoader.loadSectionTextures(this.graphics);
            // Update title screen with available biomes
            this.updateTitleScreenBiomes(elements);
            // Update wall grid if provided
            if (mapData.wallGrid) {
                for (let y = 0; y < mapData.wallGrid.length && y < constants_1.WALL_GRID.length; y++) {
                    for (let x = 0; x < mapData.wallGrid[y].length && x < constants_1.WALL_GRID[y].length; x++) {
                        constants_1.WALL_GRID[y][x] = mapData.wallGrid[y][x];
                    }
                }
                console.log('[Game] Applied wall grid from preconnected data');
            }
            // Clear preconnected map data
            window.preconnectedMapData = null;
        }
        // Listen for map data from the server (includes elements and wallGrid)
        this.socket.on('mapData', (mapData) => {
            //console.log('Received map data:', mapData);
            const elements = mapData.elements;
            this.world_map_data = elements;
            this.graphics.setMap(elements);
            this.renderMap(elements);
            // Load biome textures
            this.assetLoader.loadBiomeTextures(elements, this.graphics);
            // Load section textures
            this.assetLoader.loadSectionTextures(this.graphics);
            // Update title screen with available biomes
            this.updateTitleScreenBiomes(elements);
            // Update wall grid if provided
            if (mapData.wallGrid) {
                // Copy wall grid data to the shared WALL_GRID constant
                for (let y = 0; y < mapData.wallGrid.length && y < constants_1.WALL_GRID.length; y++) {
                    for (let x = 0; x < mapData.wallGrid[y].length && x < constants_1.WALL_GRID[y].length; x++) {
                        constants_1.WALL_GRID[y][x] = mapData.wallGrid[y][x];
                    }
                }
                console.log('[Game] Received wall grid data');
            }
        });
        this.socket.on('zoneUpdate', (zones) => {
            // ... existing code ...
        });
        // Handle viewport animation to mobs
        this.socket.on('animateViewportToMob', (data) => {
            this.startViewportAnimation(data.x, data.y);
        });
        // Handle lightning strike effects
        this.socket.on('lightningStrike', (data) => {
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
        this.chat = new chat_1.Chat(this.socket);
        // Warn before leaving the page
        this.beforeUnloadHandler = (e) => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler, { signal: this.abortController.signal });
        // Initialize tutorial
        this.tutorial = new tutorial_1.Tutorial();
        document.getElementById('connectingDiv')?.remove();
        // Note: updateLoadoutDisplay() is now called after player data is received
        // in the 'authenticated' and 'currentPlayers' event handlers
    }
    /**
     * Waits for the canvas element to be ready in the DOM
     * Uses a synchronous polling approach to avoid async constructor issues
     */
    waitForCanvas() {
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
    authenticate() {
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
    performAuthentication() {
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
        this.socket.on('authenticated', (response) => {
            console.log('[Game] Received authentication response:', response);
            if (response.success) {
                console.log('[Game] Authentication successful');
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
            }
            else {
                console.error('[Game] Authentication failed:', response.error);
                alert('Authentication failed: ' + response.error);
                localStorage.removeItem('currentUser');
                window.location.reload();
            }
        });
    }
    setupEventListeners() {
        const signal = this.abortController.signal;
        document.addEventListener('keydown', (event) => {
            if (this.chat && this.chat.isFocused) {
                if (event.key === 'Escape') {
                    this.chat.blur();
                }
                return;
            }
            // Prevent browser shortcuts for game keys only when chat is not focused
            const gameKeys = Object.values(this.controls);
            if (gameKeys.includes(event.key) || event.key.match(/^[1-9]$/)) {
                event.preventDefault();
            }
            if (event.key === this.controls.chat) {
                this.chat?.focus();
                return;
            }
            // Zoom controls
            if (event.key === this.controls.zoom_out) {
                this.zoomOut();
                return;
            }
            if (event.key === this.controls.zoom_in) {
                this.zoomIn();
                return;
            }
            if (event.key === this.controls.inventory) {
                this.inventoryManager.toggleInventory();
                return;
            }
            if (event.key === this.controls.crafting) {
                this.inventoryManager.toggleCrafting();
                return;
            }
            if (event.key === this.controls.skills) {
                this.skillsManager.toggle();
                return;
            }
            if (event.key === 'g' || event.key === 'G') {
                this.inventoryManager.toggleMobGallery();
                return;
            }
            if (event.key === 'b' || event.key === 'B') {
                this.shopManager.toggleShop();
                return;
            }
            if (event.key === this.controls.toggle_mouse_controls) {
                this.useMouseControls = !this.useMouseControls;
                this.showFloatingText(this.canvas.width / 2, 50, `Controls: ${this.useMouseControls ? 'Mouse' : 'Keyboard'}`, '#FFFFFF', 20);
                return;
            }
            if (event.key === this.controls.toggle_hitboxes) {
                this.showHitboxes = !this.showHitboxes;
                this.graphics.showHitboxes = this.showHitboxes;
                this.showFloatingText(this.canvas.width / 2, 50, `Hitboxes: ${this.showHitboxes ? 'ON' : 'OFF'}`, '#FFFFFF', 20);
                return;
            }
            // Minimap scroll controls
            if (event.key === this.controls.minimap_scroll_up) {
                this.graphics.scrollMinimap(0, -1000);
                return;
            }
            if (event.key === this.controls.minimap_scroll_down) {
                this.graphics.scrollMinimap(0, 1000);
                return;
            }
            if (event.key === this.controls.minimap_scroll_left) {
                this.graphics.scrollMinimap(-1000, 0);
                return;
            }
            if (event.key === this.controls.minimap_scroll_right) {
                this.graphics.scrollMinimap(1000, 0);
                return;
            }
            if (event.key === this.controls.minimap_center_player) {
                const currentPlayer = this.getLocalPlayer();
                if (currentPlayer) {
                    this.graphics.centerMinimapOnPlayer(currentPlayer.x, currentPlayer.y);
                }
                return;
            }
            if (event.key === this.controls.minimap_zoom_in) {
                this.graphics.zoomInMinimap();
                this.showFloatingText(this.canvas.width / 2, 50, `Minimap Zoom: ${Math.round(this.graphics.getMinimapZoom() * 100)}%`, '#FFFFFF', 20);
                return;
            }
            if (event.key === this.controls.minimap_zoom_out) {
                this.graphics.zoomOutMinimap();
                this.showFloatingText(this.canvas.width / 2, 50, `Minimap Zoom: ${Math.round(this.graphics.getMinimapZoom() * 100)}%`, '#FFFFFF', 20);
                return;
            }
            // Handle respawn when dead
            if (event.key === ' ' && this.isPlayerDead) {
                this.socket.emit('requestRespawn');
                return;
            }
            const key = event.key;
            // Gardn-style Q/E secondary-row selection cycling
            if (key === 'q' || key === 'Q') {
                this.loadoutBar?.cycleSecondaryBackward();
                return;
            }
            if (key === 'e' || key === 'E') {
                this.loadoutBar?.cycleSecondaryForward();
                return;
            }
            const slotIndex = this.inventoryManager.getLoadoutKeyBindings().indexOf(key);
            if (slotIndex !== -1) {
                // If a secondary slot is selected, number keys swap primary<->secondary (gardn)
                const selectedSecondary = this.loadoutBar?.selectedSecondary ?? -1;
                if (selectedSecondary >= 0) {
                    const secondaryIdx = 10 + selectedSecondary;
                    this.inventoryManager.swapLoadoutItems(slotIndex, secondaryIdx);
                    // Move to next non-empty secondary (or clear if exhausted)
                    this.loadoutBar?.cycleSecondaryForward();
                }
                else {
                    this.inventoryManager.useLoadoutItem(slotIndex);
                }
                return;
            }
            // T deletes the selected secondary petal (gardn)
            if (key === 't' || key === 'T') {
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
            this.keysPressed.add(event.key);
            // ALT key toggles rarity glow on petals
            if (event.key === 'Alt') {
                event.preventDefault();
                this.graphics.showRarityGlow = true;
                this.graphics.altKeyPressed = true;
            }
        }, { signal });
        document.addEventListener('keyup', (event) => {
            this.keysPressed.delete(event.key);
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
    setupSettingsListeners() {
        // Listen for settings changes from the title screen
        const signal = this.abortController.signal;
        const settingsMenu = document.getElementById('settingsMenu');
        if (settingsMenu) {
            const hitboxesCheckbox = settingsMenu.querySelector('#showHitboxesCheckbox');
            const statsCheckbox = settingsMenu.querySelector('#showStats');
            if (hitboxesCheckbox) {
                hitboxesCheckbox.addEventListener('change', () => {
                    this.showHitboxes = hitboxesCheckbox.checked;
                    this.graphics.showHitboxes = this.showHitboxes;
                }, { signal });
            }
            if (statsCheckbox) {
                statsCheckbox.addEventListener('change', () => {
                    this.showStats = statsCheckbox.checked;
                    // Reset FPS counter when toggling
                    if (this.showStats) {
                        this.frameCount = 0;
                        this.fpsUpdateTime = performance.now();
                        if (this.fpsDisplayElement) {
                            this.fpsDisplayElement.style.display = 'block';
                        }
                        if (this.mobCounterElement) {
                            this.mobCounterElement.style.display = 'block';
                        }
                        if (this.playerCounterElement) {
                            this.playerCounterElement.style.display = 'block';
                        }
                        if (this.networkStatsElement) {
                            this.networkStatsElement.style.display = 'block';
                        }
                    }
                    else {
                        if (this.fpsDisplayElement) {
                            this.fpsDisplayElement.style.display = 'none';
                        }
                        if (this.mobCounterElement) {
                            this.mobCounterElement.style.display = 'none';
                        }
                        if (this.playerCounterElement) {
                            this.playerCounterElement.style.display = 'none';
                        }
                        if (this.networkStatsElement) {
                            this.networkStatsElement.style.display = 'none';
                        }
                    }
                }, { signal });
            }
            const mobDeathAnimationCheckbox = settingsMenu.querySelector('#mobDeathAnimationCheckbox');
            if (mobDeathAnimationCheckbox) {
                mobDeathAnimationCheckbox.addEventListener('change', () => {
                    this.mobDeathAnimation = mobDeathAnimationCheckbox.checked;
                    this.graphics.mobDeathAnimation = mobDeathAnimationCheckbox.checked;
                    localStorage.setItem('mobDeathAnimation', mobDeathAnimationCheckbox.checked.toString());
                }, { signal });
            }
        }
    }
    /**
     * Calculate the total memory used by offscreen canvases in MB
     */
    getOffscreenCanvasMemoryMB() {
        return this.graphics.getOffscreenCanvasMemoryMB();
    }
    zoomIn() {
        this.zoomLevel = Math.min(this.zoomLevel + this.ZOOM_STEP, this.MAX_ZOOM);
        this.showFloatingText(this.canvas.width / 2, 50, `Zoom: ${Math.round(this.zoomLevel * 100)}%`, '#FFFFFF', 20);
    }
    zoomOut() {
        this.zoomLevel = Math.max(this.zoomLevel - this.ZOOM_STEP, this.MIN_ZOOM);
        this.showFloatingText(this.canvas.width / 2, 50, `Zoom: ${Math.round(this.zoomLevel * 100)}%`, '#FFFFFF', 20);
    }
    updateCamera(player) {
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
    startViewportAnimation(mobX, mobY) {
        const localPlayer = this.getLocalPlayer();
        if (!localPlayer)
            return;
        // Save current player position
        this.savedPlayerPos = { x: localPlayer.x, y: localPlayer.y };
        // Set up animation to mob
        this.animationStartPos = { x: this.cameraX, y: this.cameraY };
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        this.animationTargetPos = {
            x: Math.max(0, Math.min(constants_1.ACTUAL_WORLD_WIDTH - scaledWidth, mobX - scaledWidth / 2)),
            y: Math.max(0, Math.min(constants_1.ACTUAL_WORLD_HEIGHT - scaledHeight, mobY - scaledHeight / 2))
        };
        this.isAnimatingViewport = true;
        this.animationPhase = 'to_mob';
        this.animationStartTime = Date.now();
    }
    updateViewportAnimation() {
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
        }
        else if (this.animationPhase === 'at_mob') {
            // Wait at mob for 1 second
            if (elapsed >= this.animationDuration) {
                // Set up animation back to player
                this.animationStartPos = { x: this.cameraX, y: this.cameraY };
                const scaledWidth = this.canvas.width / this.zoomLevel;
                const scaledHeight = this.canvas.height / this.zoomLevel;
                this.animationTargetPos = {
                    x: Math.max(0, Math.min(constants_1.ACTUAL_WORLD_WIDTH - scaledWidth, this.savedPlayerPos.x - scaledWidth / 2)),
                    y: Math.max(0, Math.min(constants_1.ACTUAL_WORLD_HEIGHT - scaledHeight, this.savedPlayerPos.y - scaledHeight / 2))
                };
                this.animationPhase = 'to_player';
                this.animationStartTime = currentTime;
            }
        }
        else if (this.animationPhase === 'to_player') {
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
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    gameLoop() {
        // Stop this loop if a different Game instance has taken over
        // (prevents duplicate loops after exit + re-enter)
        if (window.currentGame && window.currentGame !== this)
            return;
        // Calculate FPS and update stats
        if (this.showStats) {
            this.frameCount++;
            const currentTime = performance.now();
            if (currentTime - this.fpsUpdateTime >= 1000) { // Update every second
                this.fpsCounter = this.frameCount;
                this.frameCount = 0;
                this.fpsUpdateTime = currentTime;
                // Update DOM elements
                if (this.fpsDisplayElement) {
                    // Calculate memory usage
                    const memoryMB = this.getOffscreenCanvasMemoryMB();
                    this.fpsDisplayElement.textContent = `FPS: ${this.fpsCounter} | Memory: ${memoryMB.toFixed(2)} MB`;
                }
                // Calculate throughput (bytes per second)
                this.incomingThroughput = this.bytesReceived - this.lastBytesReceived;
                this.outgoingThroughput = this.bytesSent - this.lastBytesSent;
                this.lastBytesReceived = this.bytesReceived;
                this.lastBytesSent = this.bytesSent;
                if (this.networkStatsElement) {
                    const pingStr = this.averagePing > 0 ? `${Math.round(this.averagePing)}ms` : '--';
                    this.networkStatsElement.textContent = `Ping: ${pingStr} | In: ${this.formatBytes(this.incomingThroughput)}/s | Out: ${this.formatBytes(this.outgoingThroughput)}/s`;
                }
            }
        }
        // Update counters
        if (this.showStats) {
            if (this.mobCounterElement) {
                this.mobCounterElement.textContent = `Mobs: ${this.enemies.size}`;
            }
            if (this.playerCounterElement) {
                this.playerCounterElement.textContent = `Players: ${this.players.size}`;
            }
        }
        this.update();
        // Filter out items that this player has already picked up
        const visibleItems = new Map();
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
            const alive = !this.isPlayerDead && !!localPlayer;
            if (alive)
                this.loadoutBar.show();
            else
                this.loadoutBar.hide();
            this.loadoutBar.draw(this.graphics.ctx);
        }
        requestAnimationFrame(() => this.gameLoop());
    }
    update() {
        // Clean up enemies that have completed their death animation
        const DEATH_ANIMATION_DURATION = 200; // Must match the duration in graphics.ts
        const enemiesToRemove = [];
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
                }
                else {
                    player.x += dx * smoothingFactor;
                    player.y += dy * smoothingFactor;
                }
            }
            // Interpolate petal positions
            if (player.petalPositions) {
                player.petalPositions.forEach((petalPos) => {
                    if (petalPos.targetX !== undefined && petalPos.targetY !== undefined) {
                        if (petalPos.noPhysics) {
                            // Snap directly to target — no interpolation lag
                            petalPos.x = petalPos.targetX;
                            petalPos.y = petalPos.targetY;
                        }
                        else {
                            petalPos.x += (petalPos.targetX - petalPos.x) * smoothingFactor;
                            petalPos.y += (petalPos.targetY - petalPos.y) * smoothingFactor;
                        }
                    }
                });
            }
        }
        // Interpolate all enemies' positions (skip dying enemies)
        for (const enemy of this.enemies.values()) {
            if (enemy.deathAnimationStartTime)
                continue;
            if (enemy.targetX !== undefined && enemy.targetY !== undefined) {
                enemy.x += (enemy.targetX - enemy.x) * smoothingFactor;
                enemy.y += (enemy.targetY - enemy.y) * smoothingFactor;
            }
            if (enemy.targetAngle !== undefined) {
                let angleDiff = enemy.targetAngle - enemy.angle;
                if (angleDiff > Math.PI)
                    angleDiff -= Math.PI * 2;
                if (angleDiff < -Math.PI)
                    angleDiff += Math.PI * 2;
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
    updatePetalExtension() {
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
        }
        else if (retractPressed) {
            // Shift key or right mouse - retract petals
            this.petalExtension = Math.max(minExtension, this.petalExtension - extensionSpeed);
        }
        else {
            // No keys or buttons pressed - return to normal
            const targetExtension = 1.0;
            if (this.petalExtension > targetExtension) {
                this.petalExtension = Math.max(targetExtension, this.petalExtension - extensionSpeed);
            }
            else if (this.petalExtension < targetExtension) {
                this.petalExtension = Math.min(targetExtension, this.petalExtension + extensionSpeed);
            }
        }
    }
    updatePlayerMovement(player, deltaTime) {
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
        const inputData = {
            keys: Array.from(this.keysPressed),
            petalExtension: this.petalExtension,
            viewportWidth: this.canvas.width / this.zoomLevel,
            viewportHeight: this.canvas.height / this.zoomLevel
        };
        // Calculate mouse movement direction on client when mouse controls are enabled
        if (this.useMouseControls && !isAnyMenuOpen) {
            // Always use the stored target position (in world coordinates)
            // This ensures the target doesn't drift as the camera moves
            let targetX;
            let targetY;
            if (this.hasValidMouseTarget &&
                isFinite(this.lastMouseTargetX) && isFinite(this.lastMouseTargetY) &&
                !isNaN(this.lastMouseTargetX) && !isNaN(this.lastMouseTargetY)) {
                targetX = this.lastMouseTargetX;
                targetY = this.lastMouseTargetY;
            }
            else {
                // If no valid target yet, use current mouse position and set it as target
                if (isFinite(this.mouseX) && isFinite(this.mouseY) &&
                    !isNaN(this.mouseX) && !isNaN(this.mouseY)) {
                    this.lastMouseTargetX = this.mouseX;
                    this.lastMouseTargetY = this.mouseY;
                    this.hasValidMouseTarget = true;
                    targetX = this.mouseX;
                    targetY = this.mouseY;
                }
                else {
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
                const speedMultiplier = Math.pow(normalizedDistance, constants_1.MOUSE_NONLINEAR_EXPONENT);
                // Add minimum speed multiplier to prevent movement from becoming too slow when close to center
                const minSpeedMultiplier = 0.15;
                const finalSpeedMultiplier = Math.max(speedMultiplier, minSpeedMultiplier);
                // Send normalized direction and speed multiplier to server
                // Server will apply MAX_SPEED, speed_boost, and other multipliers
                inputData.useMouse = true;
                inputData.mouseDirectionX = normalizedDirX;
                inputData.mouseDirectionY = normalizedDirY;
                inputData.mouseSpeedMultiplier = finalSpeedMultiplier;
            }
            else {
                inputData.useMouse = false;
            }
        }
        else {
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
    getInputInterval() {
        // Adjust input rate based on connection quality
        if (this.connectionQuality === 'slow') {
            return 66; // ~15 TPS for slow connections
        }
        else if (this.connectionQuality === 'medium') {
            return 50; // ~20 TPS for medium connections
        }
        return this.MIN_INPUT_INTERVAL; // ~30 TPS for good connections
    }
    formatBytes(bytes) {
        if (bytes < 1024)
            return `${bytes} B`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    trackSocketBytes(bytes, direction) {
        if (direction === 'in') {
            this.bytesReceived += bytes;
        }
        else {
            this.bytesSent += bytes;
        }
    }
    updateConnectionQuality(ping) {
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
        }
        else if (this.averagePing > 100) {
            this.connectionQuality = 'medium';
        }
        else {
            this.connectionQuality = 'good';
        }
    }
    isAnyMenuOpen() {
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
        if (this.inventoryManager && this.inventoryManager.isMobGalleryOpen) {
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
        // Check settings menu (if it doesn't have 'hidden' class, it's open)
        const settingsMenu = document.getElementById('settingsMenu');
        if (settingsMenu && !settingsMenu.classList.contains('hidden')) {
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
    updatePlayerEye() {
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
    showFloatingText(x, y, text, color, fontSize) {
        this.graphics.showFloatingText(x, y, text, color, fontSize);
    }
    showExplosionEffect(x, y, radius) {
        this.graphics.showExplosionEffect(x, y, radius);
    }
    showFallingStars() {
        this.graphics.showFallingStars();
    }
    showLightningEffect(x, y, targets, damage) {
        this.graphics.showLightningEffect(x, y, targets, damage);
    }
    showPetalBreakEffect(x, y, petalType) {
        this.graphics.showPetalBreakEffect(x, y, petalType);
    }
    renderMap(mapData) {
        // Store the map data and render it
        this.world_map_data = mapData;
        this.graphics.drawMap(mapData);
    }
    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        // Update any viewport-dependent calculations here
        // For example, you might want to adjust the camera bounds
        // console.log('Canvas resized to:', this.canvas.width, 'x', this.canvas.height);
    }
    // Change from private to public
    cleanup() {
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
        this.useMouseControls = false;
        // Remove all dynamically created DOM elements
        for (const el of this.createdElements) {
            el.remove();
        }
        this.createdElements = [];
        // Hide canvas loadout bar
        if (this.loadoutBar)
            this.loadoutBar.hide();
        // Remove any legacy DOM loadout bar that may have been attached
        document.getElementById('loadoutBar')?.remove();
        // Remove other dynamic UI elements
        document.getElementById('disconnect-message')?.remove();
        document.getElementById('transfer-message')?.remove();
        document.getElementById('teleporter-ui')?.remove();
        document.getElementById('deathScreen')?.remove();
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
    hideExitButton() {
        if (this.exitButtonContainer) {
            this.exitButtonContainer.style.display = 'none';
        }
    }
    handleExit() {
        this.cleanup();
    }
    updateColorPreview() {
        if (!this.assetLoader.playerSprite.complete)
            return;
        const ctx = this.colorPreviewCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.colorPreviewCanvas.width, this.colorPreviewCanvas.height);
        // Draw the sprite centered in the preview
        const scale = Math.min(this.colorPreviewCanvas.width / this.assetLoader.playerSprite.width, this.colorPreviewCanvas.height / this.assetLoader.playerSprite.height);
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
    updateTitleScreenBiomes(mapData) {
        if (window.titleScreen && typeof window.titleScreen.updateBiomesFromMapData === 'function') {
            window.titleScreen.updateBiomesFromMapData(mapData);
        }
    }
    getLocalPlayer() {
        // If we have an active player ID (from split), use that; otherwise use socket.id
        const playerId = this.activePlayerId || this.socket?.id || '';
        return this.players.get(playerId);
    }
    getSocket() {
        return this.socket;
    }
    getItemSprites() {
        return this.assetLoader.itemSprites;
    }
    getItemSpriteDataUrl(itemType) {
        // Check if we already have the data URL cached
        if (this.itemSpriteDataUrls.has(itemType)) {
            return this.itemSpriteDataUrls.get(itemType);
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
        }
        catch (error) {
            console.error(`[Game] Error converting sprite to data URL for ${itemType}:`, error);
            return null;
        }
    }
    getPetalStats(petalType, rarity) {
        // Import the petals module dynamically to avoid circular dependencies
        const { getPetalStats } = require('./petals');
        return getPetalStats(petalType, rarity);
    }
    getPetalCanvas(petalType, rarity, time = Date.now()) {
        const petalKey = `${petalType}_${rarity}`;
        const petalImage = this.graphics.petalImageCache[petalKey];
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
    getMobCanvas(mobType, rarity) {
        // Get the SVG string from graphics cache
        const cacheKey = `${mobType}_${rarity}`;
        const svgString = this.graphics.mobSVGCache?.[cacheKey];
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
        }
        catch (error) {
            console.error(`[Game] Error creating mob canvas for ${cacheKey}:`, error);
            return null;
        }
    }
    loadControls() {
        const savedControls = localStorage.getItem('controls');
        if (savedControls) {
            this.controls = { ...this.getDefaultControls(), ...JSON.parse(savedControls) };
        }
        else {
            this.controls = this.getDefaultControls();
        }
    }
    getDefaultControls() {
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
    savePlayerProgress() { }
    hideTitleScreen() { }
    showDeathScreen(killedBy) {
        const deathScreen = document.getElementById('deathScreen');
        if (deathScreen) {
            deathScreen.classList.remove('hidden');
            // Update the death message with killer information
            const deathMessage = deathScreen.querySelector('.death-screen-content p');
            if (deathMessage && killedBy) {
                const mobName = this.getMobDisplayName(killedBy.type, killedBy.tier);
                deathMessage.textContent = `You were destroyed by: ${mobName}`;
            }
            else if (deathMessage) {
                deathMessage.textContent = 'You were destroyed by: A mysterious entity';
            }
        }
    }
    hideDeathScreen() {
        document.getElementById('deathScreen')?.classList.add('hidden');
    }
    requestRespawn() {
        if (this.isPlayerDead) {
            this.socket.emit('requestRespawn');
        }
    }
    getMobDisplayName(type, tier) {
        // Capitalize the first letter of the type
        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
        // Capitalize the first letter of the tier
        const capitalizedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
        return `${capitalizedTier} ${capitalizedType}`;
    }
    showTitleScreen() {
        document.getElementById('titleScreen')?.classList.remove('hidden');
    }
    showSaveIndicator() {
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
    showTransferMessage(message) {
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
exports.Game = Game;
