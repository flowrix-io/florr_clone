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
const tutorial_1 = require("./tutorial");
const asset_loader_1 = require("./asset_loader");
class Game {
    constructor(showHitboxes, serverIp, preloadedAssets, shadersEnabled = false, showStats = false, dynamicSkybox = false) {
        this.speedBoostActive = false;
        this.shieldActive = false;
        this.debugCollision = false; // Toggle for collision debugging
        this.players = new Map();
        this.dots = [];
        this.DOT_SIZE = 5;
        this.DOT_COUNT = 20;
        this.PLAYER_ACCELERATION = 0.5; // Adjusted for smoother acceleration
        this.MAX_SPEED = 90; // Further increased speed for better responsiveness
        // private readonly FRICTION = 0.95;        // Removed sliding physics
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
        this.isInventoryOpen = false;
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
        this.fpsCounter = 0;
        this.fpsUpdateTime = 0;
        this.frameCount = 0;
        this.fpsDisplayElement = null;
        this.mobCounterElement = null;
        this.playerCounterElement = null;
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
        this.itemSpriteDataUrls = new Map();
        this.showHitboxes = showHitboxes;
        this.showStats = showStats;
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
        this.graphics = new graphics_1.Graphics(this.canvas, this.assetLoader.playerSprite, this.assetLoader.wallTexture, this.assetLoader.octopusSprite, this.assetLoader.fishSprite, this.assetLoader.healthPotionSprite, this.assetLoader.speedBoostSprite, this.assetLoader.shieldSprite, this.assetLoader.backgroundTexture);
        this.graphics.showHitboxes = this.showHitboxes;
        this.graphics.dynamicSkybox = dynamicSkybox;
        // Initialize shaders if enabled
        if (shadersEnabled && window.shaderManager) {
            window.shaderManager.setShadersEnabled(true);
        }
        // Set initial canvas size
        this.resizeCanvas();
        // Add resize listener
        window.addEventListener('resize', () => this.resizeCanvas());
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
            });
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
                });
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
                this.inventoryManager.updateInventoryDisplay();
            }
        });
        // Add respawn button listener
        const respawnButton = document.getElementById('respawnButton');
        respawnButton?.addEventListener('click', () => {
            if (this.isPlayerDead) {
                this.socket.emit('requestRespawn');
            }
        });
        // Add mouse move listener - always track mouse position so it's available when toggling mouse controls
        this.canvas.addEventListener('mousemove', (event) => {
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
        });
        // Add mouse button listeners for petal extension/retraction
        this.canvas.addEventListener('mousedown', (event) => {
            this.mouseButtonsPressed.add(event.button);
            // Prevent context menu on right click
            if (event.button === 2) {
                event.preventDefault();
            }
        });
        this.canvas.addEventListener('mouseup', (event) => {
            this.mouseButtonsPressed.delete(event.button);
        });
        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
        // Initialize exit button
        this.exitButton = document.getElementById('exitButton');
        this.exitButtonContainer = document.getElementById('exitButtonContainer');
        // Add exit button click handler
        this.exitButton?.addEventListener('click', () => this.handleExit());
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
        // Create save indicator
        this.saveIndicator = document.createElement('div');
        this.saveIndicator.className = 'save-indicator';
        this.saveIndicator.textContent = 'Progress Saved';
        this.saveIndicator.style.display = 'none';
        document.body.appendChild(this.saveIndicator);
        // Create FPS display element
        this.fpsDisplayElement = document.createElement('div');
        this.fpsDisplayElement.id = 'fpsDisplay';
        this.fpsDisplayElement.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: #00ff00;
            padding: 5px 10px;
            border-radius: 5px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 10000;
            display: none;
            pointer-events: none;
        `;
        this.fpsDisplayElement.textContent = 'FPS: 0';
        document.body.appendChild(this.fpsDisplayElement);
        // Set initial stats display visibility
        if (this.fpsDisplayElement) {
            this.fpsDisplayElement.style.display = this.showStats ? 'block' : 'none';
        }
        // Create mob counter element
        this.mobCounterElement = document.createElement('div');
        this.mobCounterElement.id = 'mobCounter';
        this.mobCounterElement.style.cssText = `
            position: fixed;
            bottom: 50px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: #ff6b6b;
            padding: 5px 10px;
            border-radius: 5px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 10000;
            display: block;
            pointer-events: none;
        `;
        this.mobCounterElement.textContent = 'Mobs: 0';
        document.body.appendChild(this.mobCounterElement);
        // Create player counter element
        this.playerCounterElement = document.createElement('div');
        this.playerCounterElement.id = 'playerCounter';
        this.playerCounterElement.style.cssText = `
            position: fixed;
            bottom: 90px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: #4ecdc4;
            padding: 5px 10px;
            border-radius: 5px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 10000;
            display: block;
            pointer-events: none;
        `;
        this.playerCounterElement.textContent = 'Players: 0';
        document.body.appendChild(this.playerCounterElement);
        // Set initial counter visibility
        if (this.mobCounterElement) {
            this.mobCounterElement.style.display = this.showStats ? 'block' : 'none';
        }
        if (this.playerCounterElement) {
            this.playerCounterElement.style.display = this.showStats ? 'block' : 'none';
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
        // Add to constructor after other UI initialization
        this.inventoryManager = new inventory_1.InventoryManager(this, this.chat);
        this.skillsManager = new skills_1.SkillsManager(this);
        this.svgLoader = new SVGLoader_1.SVGLoader();
        this.assetLoader.loadAssets();
        // Check if we have preconnected map data
        if (window.preconnectedMapData) {
            console.log('[Game] Using preconnected map data');
            const mapData = window.preconnectedMapData;
            this.world_map_data = mapData;
            this.graphics.setMap(mapData);
            this.renderMap(mapData);
            // Load biome textures
            this.assetLoader.loadBiomeTextures(mapData, this.graphics);
            // Update title screen with available biomes
            this.updateTitleScreenBiomes(mapData);
            // Clear preconnected map data
            window.preconnectedMapData = null;
        }
        // Listen for map data from the server
        this.socket.on('mapData', (mapData) => {
            //console.log('Received map data:', mapData);
            this.world_map_data = mapData;
            this.graphics.setMap(mapData);
            this.renderMap(mapData);
            // Load biome textures
            this.assetLoader.loadBiomeTextures(mapData, this.graphics);
            // Update title screen with available biomes
            this.updateTitleScreenBiomes(mapData);
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
            playerName: this.nameInput?.value || 'Unnamed',
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
                const currentPlayer = this.socket?.id ? this.players.get(this.socket.id) : null;
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
            const slotIndex = this.inventoryManager.getLoadoutKeyBindings().indexOf(key);
            if (slotIndex !== -1) {
                this.inventoryManager.useLoadoutItem(slotIndex);
                return;
            }
            this.keysPressed.add(event.key);
        });
        document.addEventListener('keyup', (event) => {
            this.keysPressed.delete(event.key);
            // Remove immediate velocity update - handled in game loop
        });
        // Add name input change listener
        this.nameInput?.addEventListener('change', () => {
            if (this.socket && this.nameInput) {
                this.socket.emit('updateName', this.nameInput.value);
            }
        });
        // Add drag and drop handlers for loadout
        const loadoutBar = document.getElementById('loadoutBar');
        if (loadoutBar) {
            loadoutBar.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
        }
        // Add settings change listeners
        this.setupSettingsListeners();
    }
    setupSettingsListeners() {
        // Listen for settings changes from the title screen
        const settingsMenu = document.getElementById('settingsMenu');
        if (settingsMenu) {
            const hitboxesCheckbox = settingsMenu.querySelector('#showHitboxesCheckbox');
            const statsCheckbox = settingsMenu.querySelector('#showStats');
            if (hitboxesCheckbox) {
                hitboxesCheckbox.addEventListener('change', () => {
                    this.showHitboxes = hitboxesCheckbox.checked;
                    this.graphics.showHitboxes = this.showHitboxes;
                });
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
                    }
                });
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
        this.graphics.render(this.players, this.enemies, this.items, this.mobProjectiles, this.playerProjectiles, this.socket?.id ?? '', this.petalExtension);
        requestAnimationFrame(() => this.gameLoop());
    }
    update() {
        // Interpolate all players' positions
        for (const player of this.players.values()) {
            if (player.targetX !== undefined && player.targetY !== undefined) {
                const lerpFactor = 0.1; // Adjust for smoother or more responsive movement
                player.x += (player.targetX - player.x) * lerpFactor;
                player.y += (player.targetY - player.y) * lerpFactor;
            }
        }
        // Update petal extension based on key presses
        this.updatePetalExtension();
        const player = this.players.get(this.socket?.id ?? '');
        if (player) {
            this.updatePlayerMovement(player, 1); // Assuming 60fps, so delta is roughly 1
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
            petalExtension: this.petalExtension
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
                    this.socket.emit('playerInput', inputData);
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
        this.socket.emit('playerInput', inputData);
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
        const player = this.players.get(this.socket?.id ?? '');
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
        // Disconnect socket if it exists
        if (this.socket) {
            this.socket.disconnect();
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
        // Define clear canvas function
        const clearCanvas = () => {
            // Clear the main canvas
            this.graphics.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            // Fill with white background
            this.graphics.ctx.fillStyle = 'white';
            this.graphics.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            // Explicitly clear the minimap area
            const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
            const minimapY = this.MINIMAP_PADDING;
            this.graphics.ctx.clearRect(minimapX - 5, minimapY - 5, this.MINIMAP_WIDTH + 10, this.MINIMAP_HEIGHT + 10);
            this.graphics.ctx.fillStyle = 'white';
            this.graphics.ctx.fillRect(minimapX - 5, minimapY - 5, this.MINIMAP_WIDTH + 10, this.MINIMAP_HEIGHT + 10);
        };
        // Clear multiple times to ensure everything is gone
        clearCanvas();
        requestAnimationFrame(clearCanvas);
        setTimeout(clearCanvas, 50);
        // Reset game state
        this.isInventoryOpen = false;
        this.isCraftingOpen = false;
        this.speedBoostActive = false;
        this.shieldActive = false;
        this.isPlayerDead = false;
        this.useMouseControls = false;
        // Hide all game UI elements
        if (this.inventoryPanel)
            this.inventoryPanel.style.display = 'none';
        if (this.craftingPanel)
            this.craftingPanel.style.display = 'none';
        if (this.chatContainer)
            this.chatContainer.style.display = 'none';
        if (this.saveIndicator)
            this.saveIndicator.style.display = 'none';
        // Clear loadout bar
        const loadoutBar = document.getElementById('loadoutBar');
        if (loadoutBar) {
            loadoutBar.style.display = 'none';
            // Clear all loadout slots
            const slots = loadoutBar.querySelectorAll('.loadout-slot');
            slots.forEach(slot => {
                slot.innerHTML = '';
            });
        }
        // Reset camera position
        this.cameraX = 0;
        this.cameraY = 0;
        // Clear any remaining timeouts or intervals
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }
        // Remove any event listeners
        this.keysPressed.clear();
        this.mouseButtonsPressed.clear();
        // Set canvas background to white
        this.canvas.style.backgroundColor = 'white';
        // Stop drawing the game loop
        this.gameLoopId = null;
        // Clean up inventory manager
        this.inventoryManager.cleanup();
    }
    hideExitButton() {
        if (this.exitButtonContainer) {
            this.exitButtonContainer.style.display = 'none';
        }
    }
    handleExit() {
        // Clean up game state
        this.cleanup();
        // Show title screen elements with proper styling
        if (this.titleScreen) {
            this.titleScreen.style.display = 'flex';
            this.titleScreen.style.opacity = '1';
            this.titleScreen.style.zIndex = '1000';
            this.titleScreen.style.pointerEvents = 'auto';
        }
        if (this.nameInput) {
            this.nameInput.style.display = 'block';
            this.nameInput.style.opacity = '1';
            this.nameInput.value = ''; // Clear the input
        }
        // Hide exit button
        this.hideExitButton();
        // Show game menu with proper styling
        const gameMenu = document.getElementById('gameMenu');
        if (gameMenu) {
            gameMenu.style.display = 'flex';
            gameMenu.style.opacity = '1';
            gameMenu.style.zIndex = '3000';
            gameMenu.style.pointerEvents = 'auto';
        }
        // Reset canvas state
        this.canvas.style.zIndex = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.backgroundColor = 'white';
        // Clear any remaining timeouts or intervals
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }
        // Remove any event listeners
        this.keysPressed.clear();
        this.mouseButtonsPressed.clear();
        // Force multiple clear attempts to ensure everything is gone
        for (let i = 0; i < 3; i++) {
            requestAnimationFrame(() => {
                this.graphics.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.graphics.ctx.fillStyle = 'white';
                this.graphics.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            });
        }
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
        return this.players.get(this.socket?.id || '');
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
            inventory: 'i',
            crafting: 'r',
            skills: 'k',
            toggle_mouse_controls: 'c',
            toggle_hitboxes: 'h',
            zoom_in: '=',
            zoom_out: '-',
            chat: 'Enter',
            extend_petals: ' ',
            retract_petals: 'Shift',
            minimap_scroll_up: 'q',
            minimap_scroll_down: 'e',
            minimap_scroll_left: 'z',
            minimap_scroll_right: 'x',
            minimap_center_player: 'm',
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
    addTeleportEffect(x, y) {
        // Add visual teleport effect at the specified coordinates
        // This would typically involve particle effects or other visual feedback
        console.log(`[CLIENT] Teleport effect at (${x}, ${y})`);
        // Simple flash effect (you could expand this with more sophisticated graphics)
        const canvas = document.querySelector('canvas');
        if (canvas && this.graphics) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Save current state
                ctx.save();
                // Draw teleport flash
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = '#00b3ff';
                ctx.beginPath();
                ctx.arc(x - this.cameraX, y - this.cameraY, 50, 0, Math.PI * 2);
                ctx.fill();
                // Restore state
                ctx.restore();
                // Fade out effect
                setTimeout(() => {
                    if (ctx) {
                        ctx.save();
                        ctx.globalAlpha = 0.3;
                        ctx.fillStyle = '#00b3ff';
                        ctx.beginPath();
                        ctx.arc(x - this.cameraX, y - this.cameraY, 30, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                    }
                }, 100);
            }
        }
    }
    // UI methods for teleporter countdown
    showTeleporterUI(teleportTo, timeRequired) {
        // Create or update teleporter UI
        let teleporterDiv = document.getElementById('teleporter-ui');
        if (!teleporterDiv) {
            teleporterDiv = document.createElement('div');
            teleporterDiv.id = 'teleporter-ui';
            teleporterDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 30, 60, 0.95);
                color: white;
                padding: 25px;
                border-radius: 15px;
                font-size: 18px;
                font-family: Ubuntu, sans-serif;
                z-index: 1000;
                text-align: center;
                border: 3px solid #2196F3;
                box-shadow: 0 0 20px rgba(33, 150, 243, 0.5);
                min-width: 300px;
            `;
            document.body.appendChild(teleporterDiv);
        }
        // Create countdown display
        const startTime = Date.now();
        const updateCountdown = () => {
            if (!document.getElementById('teleporter-ui'))
                return; // UI was removed
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, timeRequired - elapsed);
            const progress = Math.min(1, elapsed / timeRequired);
            let message = '<div style="margin-bottom: 15px; font-weight: bold; color: #2196F3;">🌀 TELEPORTER CHARGING</div>';
            if (teleportTo.serverPort) {
                message += `<div style="margin-bottom: 10px;">Destination: <span style="color: #FFD700;">Server ${teleportTo.serverPort}</span></div>`;
            }
            else {
                message += '<div style="margin-bottom: 10px;">Destination: <span style="color: #4CAF50;">Same Server</span></div>';
            }
            message += `<div style="margin-bottom: 10px;">Coordinates: (${teleportTo.x}, ${teleportTo.y})</div>`;
            if (remaining > 0) {
                message += `<div style="margin-bottom: 15px; font-size: 20px; color: #FFC107;">${(remaining / 1000).toFixed(1)}s</div>`;
                // Progress bar
                message += `
                    <div style="width: 100%; background: rgba(255,255,255,0.2); border-radius: 10px; height: 8px; margin-bottom: 10px;">
                        <div style="width: ${progress * 100}%; background: linear-gradient(90deg, #2196F3, #00BCD4); height: 100%; border-radius: 10px; transition: width 0.1s;"></div>
                    </div>
                `;
                message += '<div style="font-size: 14px; color: #AAA;">Stay in teleporter to continue...</div>';
            }
            else {
                message += '<div style="font-size: 20px; color: #4CAF50;">✨ TELEPORTING! ✨</div>';
            }
            teleporterDiv.innerHTML = message;
            if (remaining > 0) {
                setTimeout(updateCountdown, 100); // Update every 100ms for smooth countdown
            }
        };
        updateCountdown();
    }
    hideTeleporterUI() {
        const teleporterDiv = document.getElementById('teleporter-ui');
        if (teleporterDiv) {
            teleporterDiv.remove();
        }
    }
}
exports.Game = Game;
