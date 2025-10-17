"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Game = void 0;
const imageAssets_1 = require("./imageAssets");
const SVGLoader_1 = require("./SVGLoader");
const constants_1 = require("./constants");
const graphics_1 = require("./graphics");
const chat_1 = require("./chat");
const socket_1 = require("./socket");
const inventory_1 = require("./inventory");
const tutorial_1 = require("./tutorial");
class Game {
    constructor(showHitboxes, serverIp, preloadedAssets) {
        this.speedBoostActive = false;
        this.shieldActive = false;
        this.debugCollision = false; // Toggle for collision debugging
        this.players = new Map();
        this.playerSprite = new Image();
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
        this.petalExtension = 1.0; // 1.0 = normal, >1.0 = extended, <1.0 = retracted
        this.enemies = new Map();
        this.octopusSprite = new Image();
        this.fishSprite = new Image();
        this.coralSprite = new Image();
        this.palmSprite = new Image();
        this.PLAYER_MAX_HEALTH = 100;
        this.PLAYER_DAMAGE = 10;
        this.ENEMY_DAMAGE = 5;
        this.DAMAGE_COOLDOWN = 1000; // 1 second cooldown
        this.lastDamageTime = 0;
        this.obstacles = [];
        this.ENEMY_CORAL_MAX_HEALTH = 50;
        this.items = new Map();
        this.itemSprites = {};
        this.isInventoryOpen = false;
        this.gameLoopId = null;
        this.socketHandlers = new Map();
        this.BASE_XP_REQUIREMENT = 100;
        this.XP_MULTIPLIER = 1.5;
        this.MAX_LEVEL = 50;
        this.HEALTH_PER_LEVEL = 10;
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
        this.showHitboxes = false; // Changed from true to false
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
        // Add to class properties
        this.walls = [];
        this.WALL_SPACING = 500; // Distance between walls
        this.world_map_data = [];
        // Add map rendering properties
        this.lastUpdateTime = 0; // Add this property for delta time
        this.lastServerUpdate = 0;
        this.lastHeartbeat = 0;
        this.heartbeatInterval = null; // Add this property for server update time
        // Add to class properties at the top
        this.backgroundImage = new Image();
        this.wallTexture = new Image(); // Add this to class properties
        this.backgroundTexture = new Image();
        this.healthPotionSprite = new Image();
        this.speedBoostSprite = new Image();
        this.shieldSprite = new Image();
        this.backgroundLoadAttempted = false;
        this.lastDeathTime = 0;
        this.deathCooldown = 3000; // 3 seconds
        this.lastMessageTime = 0; // Add this line
        this.messageCooldown = 1000; // 1 second cooldown
        this.gameStartTime = 0;
        // Add chat property
        this.chat = null;
        this.showHitboxes = showHitboxes;
        this.loadControls();
        console.log('[Game] Constructor called, using preloaded assets:', !!preloadedAssets);
        this.canvas = document.getElementById('gameCanvas');
        // Use preloaded assets if available
        if (preloadedAssets) {
            console.log('[Game] Using preloaded assets');
            this.playerSprite = preloadedAssets.sprites.player;
            this.octopusSprite = preloadedAssets.sprites.octopus;
            this.fishSprite = preloadedAssets.sprites.fish;
            this.coralSprite = preloadedAssets.sprites.coral;
            this.palmSprite = preloadedAssets.sprites.palm;
            this.healthPotionSprite = preloadedAssets.sprites.healthPotion;
            this.speedBoostSprite = preloadedAssets.sprites.speedBoost;
            this.shieldSprite = preloadedAssets.sprites.shield;
            this.wallTexture = preloadedAssets.sprites.wall;
            this.backgroundTexture = preloadedAssets.backgroundTexture;
        }
        this.graphics = new graphics_1.Graphics(this.canvas, this.playerSprite, this.wallTexture, this.octopusSprite, this.fishSprite, this.healthPotionSprite, this.speedBoostSprite, this.shieldSprite, this.backgroundTexture);
        this.graphics.showHitboxes = this.showHitboxes;
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
            this.setupItemSpritesFromPreloaded(preloadedAssets);
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
                this.initializeSprites(),
                this.setupItemSprites(),
                this.graphics.preloadPetalImages()
            ]).then(() => {
                console.log('[Game] All sprites loaded successfully');
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
                    if (this.playerSprite.complete) {
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
        // Add mouse move listener
        this.canvas.addEventListener('mousemove', (event) => {
            if (this.useMouseControls) {
                const rect = this.canvas.getBoundingClientRect();
                this.mouseX = event.clientX - rect.left + this.cameraX;
                this.mouseY = event.clientY - rect.top + this.cameraY;
            }
        });
        // Initialize exit button
        this.exitButton = document.getElementById('exitButton');
        this.exitButtonContainer = document.getElementById('exitButtonContainer');
        // Add exit button click handler
        this.exitButton?.addEventListener('click', () => this.handleExit());
        // Set up item sprites
        this.setupItemSprites();
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
        this.inventoryManager.updateLoadoutDisplay();
        this.svgLoader = new SVGLoader_1.SVGLoader();
        this.loadAssets();
        // Listen for map data from the server
        this.socket.on('mapData', (mapData) => {
            //console.log('Received map data:', mapData);
            this.world_map_data = mapData;
            this.graphics.setMap(mapData);
            this.renderMap(mapData);
        });
        this.socket.on('zoneUpdate', (zones) => {
            // ... existing code ...
        });
        // Handle viewport animation to mobs
        this.socket.on('animateViewportToMob', (data) => {
            this.startViewportAnimation(data.x, data.y);
        });
        // Load background image from land.svg
        this.loadBackgroundFromSVG();
        // Load wall texture
        this.wallTexture.src = imageAssets_1.IMAGE_ASSETS["wall"];
        this.wallTexture.onload = () => {
            console.log('Wall texture loaded successfully');
        };
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
    }
    async initializeSprites() {
        const loadSprite = async (sprite, filename) => {
            try {
                sprite.crossOrigin = "anonymous";
                sprite.src = await this.getAssetUrl(filename);
                return new Promise((resolve, reject) => {
                    sprite.onload = () => resolve();
                    sprite.onerror = (e) => {
                        console.error(`Failed to load sprite: ${filename}`, e);
                        reject(e);
                    };
                });
            }
            catch (error) {
                console.error(`Error loading sprite ${filename}:`, error);
                // Don't throw error, just log it and continue
            }
        };
        try {
            await Promise.allSettled([
                loadSprite(this.playerSprite, 'player.png'),
                loadSprite(this.octopusSprite, 'octopus.png'),
                loadSprite(this.fishSprite, 'fish.png'),
                loadSprite(this.coralSprite, 'coral.png'),
                loadSprite(this.palmSprite, 'palm.png')
            ]);
        }
        catch (error) {
            console.error('Error loading sprites:', error);
            // Continue even if some sprites fail to load
        }
    }
    authenticate() {
        // Get credentials from AuthUI or localStorage
        const credentials = {
            username: localStorage.getItem('username') || 'player1',
            password: localStorage.getItem('password') || 'password123',
            playerName: this.nameInput?.value || 'Unnamed'
        };
        this.socket.emit('authenticate', credentials);
        this.socket.on('authenticated', (response) => {
            if (response.success) {
                console.log('Authentication successful');
                if (response.player) {
                    if (this.socket.id) {
                        // Update player data with saved progress
                        const player = this.players.get(this.socket.id);
                        if (player) {
                            Object.assign(player, response.player);
                        }
                    }
                }
                // Start tutorial for new users after a short delay
                setTimeout(() => {
                    this.tutorial.start();
                }, 1000);
            }
            else {
                console.error('Authentication failed:', response.error);
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
        // Center camera on player with zoom
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        const targetX = player.x - scaledWidth / 2;
        const targetY = player.y - scaledHeight / 2;
        // Clamp camera to world bounds with proper dimensions
        this.cameraX = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_WIDTH - scaledWidth, targetX));
        this.cameraY = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_HEIGHT - scaledHeight, targetY));
        this.graphics.setCamera(this.cameraX, this.cameraY, this.zoomLevel);
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
        this.update();
        this.graphics.render(this.players, this.enemies, this.items, this.socket?.id ?? '', this.petalExtension);
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
        if (this.keysPressed.has(' ')) {
            // Space key - extend petals
            this.petalExtension = Math.min(maxExtension, this.petalExtension + extensionSpeed);
        }
        else if (this.keysPressed.has('Shift')) {
            // Shift key - retract petals
            this.petalExtension = Math.max(minExtension, this.petalExtension - extensionSpeed);
        }
        else {
            // No keys pressed - return to normal
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
        // Only send input, don't update position locally
        this.socket.emit('playerInput', {
            keys: Array.from(this.keysPressed),
            petalExtension: this.petalExtension
        });
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
    showPetalBreakEffect(x, y, petalType) {
        this.graphics.showPetalBreakEffect(x, y, petalType);
    }
    renderMap(mapData) {
        // Store the map data and render it
        this.world_map_data = mapData;
        this.graphics.drawMap(mapData);
    }
    setupItemSpritesFromPreloaded(preloadedAssets) {
        console.log('[Game] Setting up item sprites from preloaded assets');
        this.itemSprites = {
            health_potion: preloadedAssets.sprites.healthPotion,
            speed_boost: preloadedAssets.sprites.speedBoost,
            shield: preloadedAssets.sprites.shield,
        };
        this.graphics.setupItemSprites(this.itemSprites);
        console.log('[Game] Item sprites set up successfully');
    }
    async setupItemSprites() {
        this.itemSprites = {};
        const itemTypes = ['health_potion', 'speed_boost', 'shield'];
        try {
            await Promise.all(itemTypes.map(async (type) => {
                const sprite = new Image();
                sprite.crossOrigin = "anonymous";
                const url = await this.getAssetUrl(`${type}.png`);
                await new Promise((resolve, reject) => {
                    sprite.onload = () => {
                        this.itemSprites[type] = sprite;
                        resolve();
                    };
                    sprite.onerror = (error) => {
                        console.error(`Failed to load sprite for ${type}:`, error);
                        reject(error);
                    };
                    sprite.src = url;
                });
            }));
            console.log('All item sprites loaded successfully:', Object.keys(this.itemSprites));
            this.graphics.setupItemSprites(this.itemSprites);
        }
        catch (error) {
            console.error('Error loading item sprites:', error);
        }
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
        this.walls = [];
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
        // Force multiple clear attempts to ensure everything is gone
        for (let i = 0; i < 3; i++) {
            requestAnimationFrame(() => {
                this.graphics.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.graphics.ctx.fillStyle = 'white';
                this.graphics.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            });
        }
    }
    applyHueRotation(ctx, imageData) {
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            // Skip fully transparent pixels
            if (data[i + 3] === 0)
                continue;
            // Convert RGB to HSL
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;
            if (max === min) {
                h = s = 0; // achromatic
            }
            else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r:
                        h = (g - b) / d + (g < b ? 6 : 0);
                        break;
                    case g:
                        h = (b - r) / d + 2;
                        break;
                    case b:
                        h = (r - g) / d + 4;
                        break;
                    default: h = 0;
                }
                h /= 6;
            }
            // Only adjust hue if the pixel has some saturation
            if (s > 0.1) { // Threshold for considering a pixel colored
                h = (h + this.playerHue / 360) % 1;
                // Convert back to RGB
                if (s === 0) {
                    data[i] = data[i + 1] = data[i + 2] = l * 255;
                }
                else {
                    const hue2rgb = (p, q, t) => {
                        if (t < 0)
                            t += 1;
                        if (t > 1)
                            t -= 1;
                        if (t < 1 / 6)
                            return p + (q - p) * 6 * t;
                        if (t < 1 / 2)
                            return q;
                        if (t < 2 / 3)
                            return p + (q - p) * (2 / 3 - t) * 6;
                        return p;
                    };
                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;
                    data[i] = hue2rgb(p, q, h + 1 / 3) * 255;
                    data[i + 1] = hue2rgb(p, q, h) * 255;
                    data[i + 2] = hue2rgb(p, q, h - 1 / 3) * 255;
                }
            }
        }
    }
    updateColorPreview() {
        if (!this.playerSprite.complete)
            return;
        const ctx = this.colorPreviewCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.colorPreviewCanvas.width, this.colorPreviewCanvas.height);
        // Draw the sprite centered in the preview
        const scale = Math.min(this.colorPreviewCanvas.width / this.playerSprite.width, this.colorPreviewCanvas.height / this.playerSprite.height);
        const x = (this.colorPreviewCanvas.width - this.playerSprite.width * scale) / 2;
        const y = (this.colorPreviewCanvas.height - this.playerSprite.height * scale) / 2;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.drawImage(this.playerSprite, 0, 0);
        const imageData = ctx.getImageData(0, 0, this.colorPreviewCanvas.width, this.colorPreviewCanvas.height);
        this.applyHueRotation(ctx, imageData);
        ctx.putImageData(imageData, 0, 0);
        ctx.restore();
    }
    // Add this helper method to handle asset URLs
    async getAssetUrl(filename) {
        // Remove the file extension to get the asset key
        const assetKey = filename.replace('.png', '');
        // If running from file:// protocol, use base64 data
        if (window.location.protocol === 'file:') {
            // Get the base64 data from our assets
            const base64Data = imageAssets_1.IMAGE_ASSETS[assetKey];
            if (base64Data) {
                return base64Data;
            }
            console.error(`No base64 data found for asset: ${filename}`);
        }
        // Otherwise use normal URL
        return `./assets/${filename}`;
    }
    async loadBackgroundFromSVG() {
        if (this.backgroundLoadAttempted) {
            return; // Prevent infinite loop
        }
        this.backgroundLoadAttempted = true;
        try {
            // Load the land.svg file
            const response = await fetch('./land.svg');
            if (!response.ok) {
                throw new Error(`Failed to fetch land.svg: ${response.status}`);
            }
            const svgText = await response.text();
            // Convert SVG to data URL (base64) so it's persistent
            const base64 = btoa(unescape(encodeURIComponent(svgText)));
            const dataUrl = `data:image/svg+xml;base64,${base64}`;
            // Load directly into backgroundTexture
            this.backgroundTexture.onload = () => {
                console.log('Background SVG loaded successfully');
                // Remove error handler after successful load
                this.backgroundTexture.onerror = null;
            };
            this.backgroundTexture.onerror = (error) => {
                console.error('Failed to load background SVG:', error);
                // Remove error handler to prevent infinite loop
                this.backgroundTexture.onerror = null;
                // Create a fallback programmatic SVG if loading fails
                this.createFallbackBackground();
            };
            this.backgroundTexture.src = dataUrl;
        }
        catch (error) {
            console.error('Error loading background SVG:', error);
            // Create a fallback programmatic SVG if loading fails
            this.createFallbackBackground();
        }
    }
    createFallbackBackground() {
        console.log('Using fallback background');
        try {
            // Create a simple green background with grass triangles as fallback
            const svg = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="400" x="0" y="0" fill="#00d885"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(60, 60) rotate(45)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(180, 80) rotate(-20)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(300, 70) rotate(120)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(100, 200) rotate(180)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(250, 280) rotate(210)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(340, 230) rotate(-90)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#02c278" transform="translate(80, 300) rotate(75)" stroke-width="7" stroke="#02c278" stroke-linejoin="round"/>
  <circle cx="150" cy="50" r="18" fill="#00f295"/>
  <circle cx="280" cy="180" r="18" fill="#00f295"/>
  <circle cx="50" cy="150" r="18" fill="#00f295"/>
  <circle cx="200" cy="350" r="18" fill="#00f295"/>
  <circle cx="360" cy="320" r="18" fill="#00f295"/>
</svg>`;
            // Convert to persistent base64 data URL
            const base64 = btoa(unescape(encodeURIComponent(svg)));
            const dataUrl = `data:image/svg+xml;base64,${base64}`;
            // Clear any existing handlers to prevent loops
            this.backgroundTexture.onload = () => {
                console.log('Fallback background loaded successfully');
                this.backgroundTexture.onload = null;
                this.backgroundTexture.onerror = null;
            };
            // If even the fallback fails, don't try again - just log it
            this.backgroundTexture.onerror = (error) => {
                console.error('Fallback background also failed to load:', error);
                this.backgroundTexture.onerror = null;
                this.backgroundTexture.onload = null;
                // Don't throw or retry - just let the graphics system use the fallback color
            };
            this.backgroundTexture.src = dataUrl;
        }
        catch (error) {
            console.error('Error creating fallback background:', error);
            // Clear handlers to prevent any further errors
            this.backgroundTexture.onerror = null;
            this.backgroundTexture.onload = null;
        }
    }
    async loadAssets() {
        try {
            // Create a simple wall SVG programmatically
            const wallSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            wallSVG.setAttribute("width", "100");
            wallSVG.setAttribute("height", "100");
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("width", "100");
            rect.setAttribute("height", "100");
            rect.setAttribute("fill", "#666");
            wallSVG.appendChild(rect);
            // Store the wall SVG
            this.walls = Array(100).fill(null).map(() => ({
                x: Math.random() * this.WORLD_WIDTH,
                y: Math.random() * this.WORLD_HEIGHT,
                element: wallSVG.cloneNode(true)
            }));
            console.log('Successfully initialized walls');
        }
        catch (error) {
            console.error('Failed to load game assets:', error);
            // Create empty walls array if loading fails
            this.walls = [];
        }
    }
    getLocalPlayer() {
        return this.players.get(this.socket?.id || '');
    }
    getSocket() {
        return this.socket;
    }
    getPetalStats(petalType, rarity) {
        // Import the petals module dynamically to avoid circular dependencies
        const { getPetalStats } = require('./petals');
        return getPetalStats(petalType, rarity);
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
            toggle_mouse_controls: 'c',
            toggle_hitboxes: 'h',
            zoom_in: '=',
            zoom_out: '-',
            chat: 'Enter',
            extend_petals: ' ',
            retract_petals: 'Shift',
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
