"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Game = void 0;
const socket_io_client_1 = require("socket.io-client");
const workerblob_1 = require("./workerblob");
const imageAssets_1 = require("./imageAssets");
const SVGLoader_1 = require("./SVGLoader");
const constants_1 = require("./constants");
const graphics_1 = require("./graphics");
const chat_1 = require("./chat");
class Game {
    constructor(isSinglePlayer = false) {
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
        this.WORLD_WIDTH = constants_1.ACTUAL_WORLD_WIDTH; // Increased from 2000 to 10000
        this.WORLD_HEIGHT = constants_1.ACTUAL_WORLD_HEIGHT; // Keep height the same
        this.keysPressed = new Set();
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
        this.isSinglePlayer = false;
        this.worker = null;
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
        this.lastDeathTime = 0;
        this.deathCooldown = 3000; // 3 seconds
        this.lastMessageTime = 0; // Add this line
        this.messageCooldown = 1000; // 1 second cooldown
        this.gameStartTime = 0;
        // Add chat property
        this.chat = null;
        //console.log('Game constructor called');
        this.canvas = document.getElementById('gameCanvas');
        this.graphics = new graphics_1.Graphics(this.canvas, this.playerSprite, this.wallTexture, this.octopusSprite, this.fishSprite, this.healthPotionSprite, this.speedBoostSprite, this.shieldSprite, this.backgroundTexture);
        // Set initial canvas size
        this.resizeCanvas();
        // Add resize listener
        window.addEventListener('resize', () => this.resizeCanvas());
        this.isSinglePlayer = isSinglePlayer;
        // Initialize sprites with CORS settings and wait for them to load
        Promise.all([
            this.initializeSprites(),
            this.setupItemSprites()
        ]).then(() => {
            console.log('All sprites loaded successfully');
            this.updateColorPreview();
            this.gameLoop();
        }).catch(console.error);
        // Create and set up preview canvas
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
        // Initialize game mode after resource loading
        if (this.isSinglePlayer) {
            this.initSinglePlayerMode();
            this.hideTitleScreen();
        }
        else {
            this.initMultiPlayerMode();
        }
        // Move authentication to after socket initialization
        this.authenticate();
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
        // Create loadout bar HTML element
        const loadoutBar = document.createElement('div');
        loadoutBar.id = 'loadoutBar';
        loadoutBar.style.position = 'fixed';
        loadoutBar.style.bottom = '20px';
        loadoutBar.style.left = '50%';
        loadoutBar.style.transform = 'translateX(-50%)';
        loadoutBar.style.display = 'flex';
        loadoutBar.style.gap = '5px';
        loadoutBar.style.zIndex = '1000';
        // Create slots
        for (let i = 0; i < this.LOADOUT_SLOTS; i++) {
            const slot = document.createElement('div');
            slot.className = 'loadout-slot';
            slot.dataset.slot = i.toString();
            slot.style.width = '50px';
            slot.style.height = '50px';
            slot.style.backgroundColor = 'rgba(99, 255, 182, 1)';
            slot.style.border = '2px solid #00ba3e';
            slot.style.borderRadius = '5px';
            loadoutBar.appendChild(slot);
        }
        document.body.appendChild(loadoutBar);
        // Set up item sprites
        this.setupItemSprites();
        // Add drag-and-drop event listeners
        this.setupDragAndDrop();
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
        this.initializeCrafting();
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
        // Load background image
        this.backgroundImage.src = imageAssets_1.IMAGE_ASSETS["background"];
        this.backgroundImage.onload = () => {
            console.log('Background image loaded successfully');
        };
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
            playerName: this.nameInput?.value || 'Anonymous'
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
            }
            else {
                console.error('Authentication failed:', response.error);
                alert('Authentication failed: ' + response.error);
                localStorage.removeItem('currentUser');
                window.location.reload();
            }
        });
    }
    initSinglePlayerMode() {
        console.log('Initializing single player mode');
        try {
            // Create inline worker with the worker code
            // Create worker from blob
            this.worker = new Worker(URL.createObjectURL(workerblob_1.workerBlob));
            // Load saved progress
            const savedProgress = this.loadPlayerProgress();
            console.log('Loaded saved progress:', savedProgress);
            // Create mock socket
            const mockSocket = {
                id: 'player1',
                emit: (event, data) => {
                    console.log('Emitting event:', event, data);
                    this.worker?.postMessage({
                        type: 'socketEvent',
                        event,
                        data
                    });
                },
                on: (event, handler) => {
                    console.log('Registering handler for event:', event);
                    this.socketHandlers.set(event, handler);
                },
                disconnect: () => {
                    this.worker?.terminate();
                }
            };
            // Use mock socket
            this.socket = mockSocket;
            // Set up socket listeners
            this.setupSocketListeners();
            // Handle worker messages
            this.worker.onmessage = (event) => {
                const { type, event: socketEvent, data } = event.data;
                //console.log('Received message from worker:', type, socketEvent, data);
                if (type === 'socketEvent') {
                    const handler = this.socketHandlers.get(socketEvent);
                    if (handler) {
                        handler(data);
                    }
                }
            };
            // Initialize game
            console.log('Sending init message to worker with saved progress');
            this.worker.postMessage({
                type: 'init',
                savedProgress: {
                    level: savedProgress['level'],
                    xp: savedProgress['xp'],
                    maxHealth: savedProgress['maxHealth'],
                    damage: savedProgress['damage']
                }
            });
        }
        catch (error) {
            console.error('Error initializing worker:', error);
        }
        this.showExitButton();
    }
    initMultiPlayerMode() {
        this.socket = (0, socket_io_client_1.io)(prompt("Enter the server URL eg https://localhost:3000: \n Join a public server: https://54.151.123.177:3000/") || "", {
            secure: true,
            rejectUnauthorized: false,
            withCredentials: true
        });
        this.socket.on('connect', () => {
            const connectTime = performance.now();
            console.log(`[CLIENT] Connected to server at ${connectTime.toFixed(0)}`);
            this.hideTitleScreen();
            this.showExitButton();
        });
        this.setupSocketListeners();
    }
    setupSocketListeners() {
        this.socket.on('connect', () => {
            const connectTime = performance.now();
            console.log(`[CLIENT] Socket connected with ID ${this.socket.id} at ${connectTime.toFixed(0)}`);
            if (this.socket.id) {
                this.socket.emit('chatMessage', `${this.players.get(this.socket.id)?.name} has joined the game`);
            }
            // Start heartbeat monitoring
            this.lastHeartbeat = performance.now();
            this.heartbeatInterval = setInterval(() => {
                const now = performance.now();
                const timeSinceLastHeartbeat = now - this.lastHeartbeat;
                if (timeSinceLastHeartbeat > 5000) { // 5 seconds without heartbeat
                    console.log(`[CLIENT] Warning: No server response for ${timeSinceLastHeartbeat.toFixed(0)}ms`);
                }
                this.socket.emit('ping', now);
            }, 1000); // Send ping every second
        });
        // Add runJS event handler
        this.socket.on('runJS', (code) => {
            try {
                // Create a new Function to execute the code in a safer context
                const safeEval = new Function(code);
                safeEval();
            }
            catch (error) {
                console.error('Error executing JS:', error);
            }
        });
        // Add serverType event handler
        this.socket.on('serverType', (type) => {
            console.log(`Connected to ${type} server`);
            // You can add visual feedback here if needed
            this.showFloatingText(this.canvas.width / 2, 50, `Connected to ${type} server`, '#00FF00', 24);
        });
        this.socket.on('currentPlayers', (players) => {
            //console.log('Received current players:', players);
            this.players.clear();
            Object.values(players).forEach(player => {
                // Don't override health with max health
                this.players.set(player.id, {
                    ...player,
                    imageLoaded: true,
                    score: 0,
                    velocityX: 0,
                    velocityY: 0
                });
            });
        });
        this.socket.on('newPlayer', (player) => {
            //console.log('New player joined:', player);
            this.players.set(player.id, {
                ...player,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0
            });
        });
        this.socket.on('playerMoved', (player) => {
            const now = performance.now();
            this.lastHeartbeat = now; // Update heartbeat on any server message
            const existingPlayer = this.players.get(player.id);
            const isCurrentPlayer = player.id === this.socket?.id;
            // Debug: Log server position updates with timing
            if (existingPlayer && isCurrentPlayer) {
                const positionDiff = Math.sqrt(Math.pow(existingPlayer.x - player.x, 2) +
                    Math.pow(existingPlayer.y - player.y, 2));
                console.log(`[CLIENT] playerMoved received at ${now.toFixed(0)}: server(${player.x.toFixed(1)}, ${player.y.toFixed(1)}) client_current(${existingPlayer.x.toFixed(1)}, ${existingPlayer.y.toFixed(1)}) diff:${positionDiff.toFixed(1)}px`);
            }
            console.log(`[CLIENT] Received playerMoved for ${player.id}:`, {
                x: player.x.toFixed(1),
                y: player.y.toFixed(1),
                isMe: player.id === this.socket?.id
            });
            if (existingPlayer) {
                if (isCurrentPlayer) {
                    // For current player, use smooth interpolation to server position
                    console.log(`[CLIENT] Updating position from server: (${existingPlayer.x.toFixed(1)}, ${existingPlayer.y.toFixed(1)}) -> (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`);
                    existingPlayer.targetX = player.x;
                    existingPlayer.targetY = player.y;
                }
                else {
                    // For other players, use interpolation to smooth movement
                    existingPlayer.targetX = player.x;
                    existingPlayer.targetY = player.y;
                }
                // Update other properties
                existingPlayer.angle = player.angle;
                existingPlayer.velocityX = player.velocityX;
                existingPlayer.velocityY = player.velocityY;
                existingPlayer.health = player.health;
                existingPlayer.maxHealth = player.maxHealth;
                existingPlayer.level = player.level;
                existingPlayer.score = player.score;
            }
            else {
                this.players.set(player.id, {
                    ...player,
                    imageLoaded: true,
                    score: 0,
                    velocityX: 0,
                    velocityY: 0,
                    targetX: player.x,
                    targetY: player.y
                });
            }
        });
        this.socket.on('disconnect', (reason) => {
            const disconnectTime = performance.now();
            console.log(`[CLIENT] Disconnected from server at ${disconnectTime.toFixed(0)}, reason: ${reason}`);
            // Clear heartbeat monitoring
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
        });
        this.socket.on('pong', (serverTime) => {
            const now = performance.now();
            const roundTripTime = now - serverTime;
            this.lastHeartbeat = now;
            if (roundTripTime < 1000) { // Only log normal pings, not catch-up ones
                console.log(`[CLIENT] Ping: ${roundTripTime.toFixed(1)}ms`);
            }
            else {
                console.log(`[CLIENT] High ping detected: ${roundTripTime.toFixed(1)}ms`);
            }
        });
        this.socket.on('connect_error', (error) => {
            const errorTime = performance.now();
            console.log(`[CLIENT] Connection error at ${errorTime.toFixed(0)}:`, error);
        });
        this.socket.on('playerDisconnected', (playerId) => {
            const disconnectTime = performance.now();
            console.log(`[CLIENT] Player ${playerId} disconnected at ${disconnectTime.toFixed(0)}`);
            this.players.delete(playerId);
        });
        this.socket.on('dotCollected', (data) => {
            const player = this.players.get(data.playerId);
            if (player) {
                player.score++;
            }
            this.dots.splice(data.dotIndex, 1);
            this.generateDot();
        });
        this.socket.on('enemiesUpdate', (enemies) => {
            this.enemies.clear();
            enemies.forEach(enemy => this.enemies.set(enemy.id, enemy));
        });
        this.socket.on('enemyMoved', (enemy) => {
            this.enemies.set(enemy.id, enemy);
        });
        this.socket.on('playerDamaged', (data) => {
            console.log('Player damaged event received:', data);
            const player = this.players.get(data.playerId);
            if (player) {
                const oldHealth = player.health;
                player.health = data.health;
                player.maxHealth = data.maxHealth || player.maxHealth;
                // Update invulnerability status
                if (data.isInvulnerable !== undefined) {
                    player.isInvulnerable = data.isInvulnerable;
                    // Set a client-side backup timer in case server event is missed
                    if (data.isInvulnerable) {
                        setTimeout(() => {
                            if (player && player.isInvulnerable) {
                                player.isInvulnerable = false;
                                console.log(`[CLIENT] Backup timer: Player ${data.playerId} invulnerability ended`);
                            }
                        }, 2000); // 2 seconds backup (longer than server 1 second)
                    }
                }
                // Apply knockback if provided
                if (data.knockbackX !== undefined && data.knockbackY !== undefined) {
                    player.knockbackX = data.knockbackX;
                    player.knockbackY = data.knockbackY;
                }
                // Add visual feedback for damage taken
                const damageTaken = oldHealth - data.health;
                if (damageTaken > 0) {
                    this.showFloatingText(player.x, player.y - 20, `-${damageTaken}`, '#FF0000', 20);
                }
            }
        });
        this.socket.on('enemyDamaged', (data) => {
            const enemy = this.enemies.get(data.enemyId);
            if (enemy) {
                enemy.health = data.health;
            }
        });
        this.socket.on('enemyDestroyed', (enemyId) => {
            this.enemies.delete(enemyId);
        });
        this.socket.on('playerInvulnerabilityEnded', (data) => {
            const player = this.players.get(data.playerId);
            if (player) {
                player.isInvulnerable = false;
                console.log(`[CLIENT] Player ${data.playerId} invulnerability ended`);
            }
        });
        this.socket.on('obstaclesUpdate', (obstacles) => {
            this.obstacles = obstacles;
        });
        this.socket.on('obstacleDamaged', (data) => {
            const obstacle = this.obstacles.find(o => o.id === data.obstacleId);
            if (obstacle && obstacle.isEnemy) {
                obstacle.health = data.health;
            }
        });
        this.socket.on('obstacleDestroyed', (obstacleId) => {
            const index = this.obstacles.findIndex(o => o.id === obstacleId);
            if (index !== -1) {
                this.obstacles.splice(index, 1);
            }
        });
        this.socket.on('itemsUpdate', (items) => {
            this.items.clear();
            items.forEach(item => {
                this.items.set(item.id, item);
            });
        });
        this.socket.on('itemCollected', (data) => {
            const player = this.players.get(data.playerId);
            if (player) {
                this.items.delete(data.itemId);
                if (data.playerId === this.socket.id) {
                    // Update inventory display if it's open
                    if (this.isInventoryOpen) {
                        this.updateInventoryDisplay();
                    }
                }
            }
        });
        this.socket.on('inventoryUpdate', (inventory) => {
            const player = this.players.get(this.socket?.id || '');
            if (player) {
                player.inventory = inventory;
                // Update inventory display if it's open
                if (this.isInventoryOpen) {
                    this.updateInventoryDisplay();
                }
            }
        });
        this.socket.on('xpGained', (data) => {
            //console.log('XP gained:', data);  // Add logging
            const player = this.players.get(data.playerId);
            if (player) {
                player.xp = data.totalXp;
                player.level = data.level;
                player.xpToNextLevel = data.xpToNextLevel;
                player.maxHealth = data.maxHealth;
                player.damage = data.damage;
                this.showFloatingText(player.x, player.y - 20, '+' + data.xp + ' XP', '#32CD32', 16);
                this.savePlayerProgress(player);
            }
        });
        this.socket.on('levelUp', (data) => {
            //console.log('Level up:', data);  // Add logging
            const player = this.players.get(data.playerId);
            if (player) {
                player.level = data.level;
                player.maxHealth = data.maxHealth;
                player.damage = data.damage;
                this.showFloatingText(player.x, player.y - 30, 'Level Up! Level ' + data.level, '#FFD700', 24);
                this.savePlayerProgress(player);
            }
        });
        this.socket.on('playerLostLevel', (data) => {
            //console.log('Player lost level:', data);
            const player = this.players.get(data.playerId);
            if (player) {
                player.level = data.level;
                player.maxHealth = data.maxHealth;
                player.damage = data.damage;
                player.xp = data.xp;
                player.xpToNextLevel = data.xpToNextLevel;
                // Show level loss message
                this.showFloatingText(player.x, player.y - 30, 'Level Lost! Level ' + data.level, '#FF0000', 24);
                // Save the new progress
                this.savePlayerProgress(player);
            }
        });
        this.socket.on('playerRespawned', (player) => {
            const existingPlayer = this.players.get(player.id);
            if (existingPlayer) {
                Object.assign(existingPlayer, player);
                if (player.id === this.socket.id) {
                    this.isPlayerDead = false;
                    this.hideDeathScreen();
                }
                // Show respawn message
                this.showFloatingText(player.x, player.y - 50, 'Respawned!', '#FFFFFF', 20);
            }
        });
        this.socket.on('playerDied', (playerId) => {
            if (playerId === this.socket.id) {
                this.isPlayerDead = true;
                this.showDeathScreen();
            }
        });
        this.socket.on('decorationsUpdate', (decorations) => {
            this.decorations = decorations;
        });
        this.socket.on('sandsUpdate', (sands) => {
            this.sands = sands;
        });
        this.socket.on('playerUpdated', (updatedPlayer) => {
            const player = this.players.get(updatedPlayer.id);
            if (player) {
                Object.assign(player, updatedPlayer);
                // Update displays if this is the current player
                if (updatedPlayer.id === this.socket?.id) {
                    if (this.isInventoryOpen) {
                        this.updateInventoryDisplay();
                    }
                    this.updateLoadoutDisplay(); // Always update loadout display
                }
            }
        });
        this.socket.on('speedBoostActive', (playerId) => {
            console.log('Speed boost active:', playerId);
            if (playerId === this.socket.id) {
                this.speedBoostActive = true;
                console.log('Speed boost active for client');
            }
        });
        this.socket.on('savePlayerProgress', () => {
            this.showSaveIndicator();
        });
        this.socket.on('craftingSuccess', (data) => {
            const player = this.players.get(this.socket?.id || '');
            if (player) {
                player.inventory = data.inventory;
                this.showFloatingText(this.canvas.width / 2, 50, `Successfully crafted ${data.newItem.rarity} ${data.newItem.type}!`, this.ITEM_RARITY_COLORS[data.newItem.rarity || 'common'], 24);
                this.updateInventoryDisplay();
            }
        });
        this.socket.on('craftingFailed', (message) => {
            this.showFloatingText(this.canvas.width / 2, 50, message, '#FF0000', 20);
            // Return items to inventory
            const player = this.players.get(this.socket?.id || '');
            if (player) {
                this.craftingSlots.forEach(slot => {
                    if (slot.item) {
                        player.inventory.push(slot.item);
                    }
                });
                this.craftingSlots.forEach(slot => slot.item = null);
                this.updateCraftingDisplay();
                this.updateInventoryDisplay();
            }
        });
        // Listen for server game state updates for better synchronization
        this.socket.on('gameStateUpdate', (data) => {
            const serverPlayers = data.players;
            serverPlayers.forEach(serverPlayer => {
                const existingPlayer = this.players.get(serverPlayer.id);
                if (existingPlayer) {
                    existingPlayer.targetX = serverPlayer.x;
                    existingPlayer.targetY = serverPlayer.y;
                    existingPlayer.angle = serverPlayer.angle;
                    existingPlayer.health = serverPlayer.health;
                    existingPlayer.maxHealth = serverPlayer.maxHealth;
                    existingPlayer.level = serverPlayer.level;
                }
                else {
                    this.players.set(serverPlayer.id, {
                        ...serverPlayer,
                        imageLoaded: true,
                        score: 0,
                        velocityX: 0,
                        velocityY: 0,
                        targetX: serverPlayer.x,
                        targetY: serverPlayer.y
                    });
                }
            });
        });
        this.socket.on('updatePlayers', (serverPlayers) => {
            const serverPlayerIds = serverPlayers.map(p => p.id);
            // Remove players that are no longer sent by the server
            this.players.forEach((player, playerId) => {
                if (!serverPlayerIds.includes(playerId)) {
                    this.players.delete(playerId);
                }
            });
            serverPlayers.forEach(serverPlayer => {
                let player = this.players.get(serverPlayer.id);
                if (player) {
                    // Update existing player
                    player.x = serverPlayer.x;
                    player.y = serverPlayer.y;
                    player.angle = serverPlayer.angle;
                    player.score = serverPlayer.score;
                    player.health = serverPlayer.health;
                    player.maxHealth = serverPlayer.maxHealth;
                    player.damage = serverPlayer.damage;
                    player.inventory = serverPlayer.inventory;
                    player.loadout = serverPlayer.loadout;
                    player.isInvulnerable = serverPlayer.isInvulnerable;
                    player.knockbackX = serverPlayer.knockbackX;
                    player.knockbackY = serverPlayer.knockbackY;
                    player.level = serverPlayer.level;
                    player.xp = serverPlayer.xp;
                    player.xpToNextLevel = serverPlayer.xpToNextLevel;
                    player.lastDamageTime = serverPlayer.lastDamageTime;
                    player.speed_boost = serverPlayer.speed_boost;
                }
                else {
                    // Add new player
                    player = {
                        ...serverPlayer,
                        image: new Image(),
                        imageLoaded: false,
                        targetX: serverPlayer.x,
                        targetY: serverPlayer.y,
                    };
                    player.image.src = 'assets/player.png';
                    player.image.onload = () => {
                        player.imageLoaded = true;
                    };
                    this.players.set(serverPlayer.id, player);
                }
            });
        });
        this.socket.on('updateEnemies', (serverEnemies) => {
            this.enemies.clear();
            serverEnemies.forEach(enemy => {
                this.enemies.set(enemy.id, enemy);
            });
        });
        this.socket.on('updateItems', (serverItems) => {
            this.items.clear();
            serverItems.forEach(item => {
                this.items.set(item.id, item);
            });
        });
        this.socket.on('playerDied', (data) => {
            if (data.playerId === this.socket.id) {
                this.isPlayerDead = true;
                this.showDeathScreen();
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
            // Add chat toggle
            if (event.key === 'Enter' && !this.isSinglePlayer) {
                this.chat?.focus();
                return;
            }
            if (event.key === 'i' || event.key === 'I') {
                this.toggleInventory();
                return;
            }
            // Add control toggle with 'C' key
            if (event.key === 'c' || event.key === 'C') {
                this.useMouseControls = !this.useMouseControls;
                this.showFloatingText(this.canvas.width / 2, 50, `Controls: ${this.useMouseControls ? 'Mouse' : 'Keyboard'}`, '#FFFFFF', 20);
                return;
            }
            // Add crafting toggle with 'R' key
            if (event.key === 'r' || event.key === 'R') {
                this.toggleCrafting();
            }
            this.keysPressed.add(event.key);
            // Remove immediate velocity update - handled in game loop
            // Handle loadout key bindings
            const key = event.key;
            const slotIndex = this.LOADOUT_KEY_BINDINGS.indexOf(key);
            if (slotIndex !== -1) {
                this.useLoadoutItem(slotIndex);
            }
        });
        document.addEventListener('keyup', (event) => {
            this.keysPressed.delete(event.key);
            // Remove immediate velocity update - handled in game loop
        });
        // Add hitbox toggle with 'H' key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'h' || event.key === 'H') {
                this.showHitboxes = !this.showHitboxes;
                this.showFloatingText(this.canvas.width / 2, 50, `Hitboxes: ${this.showHitboxes ? 'ON' : 'OFF'}`, '#FFFFFF', 20);
            }
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
            loadoutBar.addEventListener('drop', (e) => {
                e.preventDefault();
                const itemIndex = parseInt(e.dataTransfer?.getData('text/plain') || '-1');
                const slot = e.target.dataset.slot;
                if (itemIndex >= 0 && slot) {
                    this.equipItemToLoadout(itemIndex, parseInt(slot));
                }
            });
        }
    }
    updateCamera(player) {
        // Center camera on player
        const targetX = player.x - this.canvas.width / 2;
        const targetY = player.y - this.canvas.height / 2;
        // Clamp camera to world bounds with proper dimensions
        this.cameraX = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_WIDTH - this.canvas.width, targetX));
        this.cameraY = Math.max(0, Math.min(constants_1.ACTUAL_WORLD_HEIGHT - this.canvas.height, targetY));
        this.graphics.setCamera(this.cameraX, this.cameraY);
    }
    generateDots() {
        for (let i = 0; i < this.DOT_COUNT; i++) {
            this.generateDot();
        }
    }
    generateDot() {
        const dot = {
            x: Math.random() * this.WORLD_WIDTH,
            y: Math.random() * this.WORLD_HEIGHT
        };
        this.dots.push(dot);
    }
    checkItemCollision(player) {
        this.items.forEach(item => {
            const dx = player.x - item.x;
            const dy = player.y - item.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 40) {
                this.socket.emit('collectItem', item.id);
                // Update displays immediately for better responsiveness
                if (this.isInventoryOpen) {
                    this.updateInventoryDisplay();
                }
            }
        });
    }
    toggleInventory() {
        if (!this.inventoryPanel)
            return;
        const isOpen = this.inventoryPanel.style.display === 'block';
        if (!isOpen) {
            this.inventoryPanel.style.display = 'block';
            setTimeout(() => {
                this.inventoryPanel?.classList.add('open');
            }, 10);
            this.updateInventoryDisplay();
        }
        else {
            this.inventoryPanel.classList.remove('open');
            setTimeout(() => {
                if (this.inventoryPanel) {
                    this.inventoryPanel.style.display = 'none';
                }
            }, 300); // Match transition duration
        }
        this.isInventoryOpen = !isOpen;
    }
    handlePlayerMoved(playerData) {
        // Update player position in single-player mode
        const player = this.players.get(playerData.id);
        if (player) {
            Object.assign(player, playerData);
            // Update camera position for the local player
            if (this.isSinglePlayer) {
                this.updateCamera(player);
            }
        }
    }
    handleEnemiesUpdate(enemiesData) {
        // Update enemies in single-player mode
        this.enemies.clear();
        enemiesData.forEach(enemy => this.enemies.set(enemy.id, enemy));
    }
    gameLoop() {
        this.update();
        this.graphics.render(this.players, this.enemies, this.items, this.socket?.id ?? '');
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
        const player = this.players.get(this.socket?.id ?? '');
        if (player) {
            this.updatePlayerMovement(player, 1); // Assuming 60fps, so delta is roughly 1
            this.updateCamera(player);
            this.updatePlayerEye();
        }
    }
    updatePlayerMovement(player, deltaTime) {
        const speed = 5 * (player.speed_boost ? 2 : 1);
        let dx = 0;
        let dy = 0;
        if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('w')) {
            dy -= 1;
        }
        if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('s')) {
            dy += 1;
        }
        if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('a')) {
            dx -= 1;
        }
        if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('d')) {
            dx += 1;
        }
        // Only send input, don't update position locally
        this.socket.emit('playerInput', { keys: Array.from(this.keysPressed) });
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
    renderMap(mapData) {
        // Store the map data and render it
        this.world_map_data = mapData;
        this.graphics.drawMap(mapData);
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
        // Save progress before cleanup if in single player mode
        if (this.isSinglePlayer && this.socket?.id) {
            const player = this.players.get(this.socket.id);
            if (player) {
                this.savePlayerProgress(player);
            }
        }
        // Stop the game loop immediately to prevent further drawing
        if (this.gameLoopId) {
            cancelAnimationFrame(this.gameLoopId);
            this.gameLoopId = null;
        }
        // Terminate the web worker if it exists
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
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
    }
    loadPlayerProgress() {
        const savedProgress = localStorage.getItem('playerProgress');
        if (savedProgress) {
            return JSON.parse(savedProgress);
        }
        return {
            level: 1,
            xp: 0,
            maxHealth: this.PLAYER_MAX_HEALTH,
            damage: this.PLAYER_DAMAGE
        };
    }
    savePlayerProgress(player) {
        const progress = {
            level: player.level,
            xp: player.xp,
            maxHealth: player.maxHealth,
            damage: player.damage
        };
        localStorage.setItem('playerProgress', JSON.stringify(progress));
    }
    calculateXPRequirement(level) {
        return Math.floor(this.BASE_XP_REQUIREMENT * Math.pow(this.XP_MULTIPLIER, level - 1));
    }
    showDeathScreen() {
        const deathScreen = document.getElementById('deathScreen');
        if (deathScreen) {
            deathScreen.style.display = 'flex';
        }
    }
    hideDeathScreen() {
        const deathScreen = document.getElementById('deathScreen');
        if (deathScreen) {
            deathScreen.style.display = 'none';
        }
    }
    hideTitleScreen() {
        if (this.titleScreen) {
            this.titleScreen.style.display = 'none';
            this.titleScreen.style.opacity = '0';
        }
        if (this.nameInput) {
            this.nameInput.style.display = 'none';
            this.nameInput.style.opacity = '0';
        }
        // Hide game menu when game starts
        const gameMenu = document.getElementById('gameMenu');
        if (gameMenu) {
            gameMenu.style.display = 'none';
            gameMenu.style.opacity = '0';
        }
        // Ensure canvas is visible
        this.canvas.style.zIndex = '1';
    }
    showExitButton() {
        if (this.exitButtonContainer) {
            this.exitButtonContainer.style.display = 'block';
        }
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
    equipItemToLoadout(inventoryIndex, loadoutSlot) {
        const player = this.players.get(this.socket?.id || '');
        if (!player || loadoutSlot >= this.LOADOUT_SLOTS)
            return;
        const item = player.inventory[inventoryIndex];
        if (!item)
            return;
        console.log('Moving item from inventory to loadout:', {
            item,
            fromIndex: inventoryIndex,
            toSlot: loadoutSlot
        });
        // Create a copy of the current state
        const newInventory = [...player.inventory];
        const newLoadout = [...player.loadout];
        // Remove item from inventory
        newInventory.splice(inventoryIndex, 1);
        // If there's an item in the loadout slot, move it to inventory
        const existingItem = newLoadout[loadoutSlot];
        if (existingItem) {
            newInventory.push(existingItem);
        }
        // Equip new item to loadout
        newLoadout[loadoutSlot] = item;
        // Update player's state
        player.inventory = newInventory;
        player.loadout = newLoadout;
        // Update server
        this.socket?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: newInventory
        });
        // Force immediate visual updates
        requestAnimationFrame(() => {
            this.updateInventoryDisplay();
            this.updateLoadoutDisplay();
        });
        console.log('Updated player state:', {
            inventory: player.inventory,
            loadout: player.loadout
        });
    }
    useLoadoutItem(slot) {
        const player = this.players.get(this.socket?.id || '');
        if (!player || !player.loadout[slot])
            return;
        const item = player.loadout[slot];
        if (!item || item.onCooldown)
            return; // Check for cooldown
        // Use the item
        this.socket?.emit('useItem', item.id);
        console.log('Used item:', item.id);
        // Listen for item effects
        this.socket?.on('speedBoostActive', (playerId) => {
            if (playerId === this.socket?.id) {
                this.speedBoostActive = true;
                console.log('Speed boost activated');
            }
        });
        // Show floating text based on item type and rarity
        const rarityMultipliers = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4
        };
        const multiplier = item.rarity ? rarityMultipliers[item.rarity] : 1;
        switch (item.type) {
            case 'health_potion':
                this.showFloatingText(player.x, player.y - 30, `+${Math.floor(50 * multiplier)} HP`, '#32CD32', 20);
                break;
            case 'speed_boost':
                this.showFloatingText(player.x, player.y - 30, `Speed Boost (${Math.floor(5 * multiplier)}s)`, '#4169E1', 20);
                break;
            case 'shield':
                this.showFloatingText(player.x, player.y - 30, `Shield (${Math.floor(3 * multiplier)}s)`, '#FFD700', 20);
                break;
        }
        // Add visual cooldown effect to the loadout slot
        const slot_element = document.querySelector(`.loadout-slot[data-slot="${slot}"]`);
        if (slot_element) {
            slot_element.classList.add('on-cooldown');
            // Remove cooldown class when cooldown is complete
            const cooldownTime = 10000 * (1 / multiplier); // 10 seconds base, reduced by rarity
            setTimeout(() => {
                slot_element.classList.remove('on-cooldown');
            }, cooldownTime);
        }
        // Update displays
        if (this.isInventoryOpen) {
            this.updateInventoryDisplay();
        }
        this.updateLoadoutDisplay();
    }
    updateLoadoutDisplay() {
        const player = this.players.get(this.socket?.id || '');
        if (!player)
            return;
        const slots = document.querySelectorAll('.loadout-slot');
        slots.forEach((slot, index) => {
            // Clear existing content
            slot.innerHTML = '';
            // Add item if it exists in that slot
            const item = player.loadout[index];
            if (item) {
                const img = document.createElement('img');
                img.src = `./assets/${item.type}.png`;
                img.alt = item.type;
                img.style.width = '80%';
                img.style.height = '80%';
                img.style.objectFit = 'contain';
                slot.appendChild(img);
            }
            // Add key binding text
            const keyText = document.createElement('div');
            keyText.className = 'key-binding';
            keyText.textContent = this.LOADOUT_KEY_BINDINGS[index];
            slot.appendChild(keyText);
        });
    }
    setupDragAndDrop() {
        // Add global drop handler
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            const dragEvent = e;
            const target = e.target;
            // If not dropping on loadout slot or inventory grid, return item to inventory
            if (!target.closest('.loadout-slot') && !target.closest('.inventory-grid')) {
                const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (loadoutSlot) {
                    this.moveItemToInventory(parseInt(loadoutSlot));
                }
            }
        });
        // Make loadout items draggable
        const updateLoadoutDraggable = () => {
            const slots = document.querySelectorAll('.loadout-slot');
            slots.forEach((slot, slotIndex) => {
                const img = slot.querySelector('img');
                if (img) {
                    img.draggable = true;
                    img.addEventListener('dragstart', (e) => {
                        const dragEvent = e;
                        dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                        dragEvent.dataTransfer.effectAllowed = 'move';
                    });
                }
            });
        };
        // Update loadout items draggable state whenever the display updates
        const originalUpdateLoadoutDisplay = this.updateLoadoutDisplay.bind(this);
        this.updateLoadoutDisplay = () => {
            originalUpdateLoadoutDisplay();
            updateLoadoutDraggable();
        };
        // Handle drops on loadout slots
        const slots = document.querySelectorAll('.loadout-slot');
        slots.forEach((slot, slotIndex) => {
            // Set the slot index as a data attribute
            slot.dataset.slot = slotIndex.toString();
            slot.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.currentTarget.classList.add('drag-over');
            });
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragEvent = e;
                dragEvent.dataTransfer.dropEffect = 'move';
                e.currentTarget.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', (e) => {
                e.currentTarget.classList.remove('drag-over');
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                const dragEvent = e;
                const target = e.currentTarget;
                target.classList.remove('drag-over');
                // Check if the drop is from inventory or loadout
                const inventoryIndex = dragEvent.dataTransfer?.getData('text/plain');
                const fromLoadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (inventoryIndex) {
                    // Drop from inventory to loadout
                    const index = parseInt(inventoryIndex);
                    const slot = parseInt(target.dataset.slot || '-1');
                    if (index >= 0 && slot >= 0) {
                        this.equipItemToLoadout(index, slot);
                    }
                }
                else if (fromLoadoutSlot) {
                    // Drop from loadout to loadout (swap items)
                    const fromSlot = parseInt(fromLoadoutSlot);
                    const toSlot = slotIndex;
                    if (fromSlot !== toSlot) {
                        this.swapLoadoutItems(fromSlot, toSlot);
                    }
                }
            });
        });
        // Make inventory panel a drop target for loadout items
        if (this.inventoryPanel) {
            const grid = this.inventoryPanel.querySelector('.inventory-grid');
            if (grid) {
                grid.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const dragEvent = e;
                    dragEvent.dataTransfer.dropEffect = 'move';
                    grid.classList.add('drag-over');
                });
                grid.addEventListener('dragleave', (e) => {
                    grid.classList.remove('drag-over');
                });
                grid.addEventListener('drop', (e) => {
                    e.preventDefault();
                    grid.classList.remove('drag-over');
                    const dragEvent = e;
                    const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                    if (loadoutSlot) {
                        this.moveItemToInventory(parseInt(loadoutSlot));
                    }
                });
            }
        }
    }
    // Add method to swap loadout items
    swapLoadoutItems(fromSlot, toSlot) {
        const player = this.players.get(this.socket?.id || '');
        if (!player)
            return;
        const newLoadout = [...player.loadout];
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        // Update player's state
        player.loadout = newLoadout;
        // Update server
        this.socket?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });
        // Force immediate visual updates
        this.updateLoadoutDisplay();
    }
    // Update the updateInventoryDisplay method
    updateInventoryDisplay() {
        if (!this.inventoryPanel)
            return;
        const player = this.players.get(this.socket?.id || '');
        if (!player)
            return;
        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content)
            return;
        content.innerHTML = '';
        // Add inventory title
        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);
        // Group items by rarity
        const itemsByRarity = {
            mythic: [],
            legendary: [],
            epic: [],
            rare: [],
            uncommon: [],
            common: []
        };
        // Sort items into rarity groups
        player.inventory.forEach(item => {
            const rarity = item.rarity || 'common';
            itemsByRarity[rarity].push(item);
        });
        // Create inventory grid container
        const gridContainer = document.createElement('div');
        gridContainer.className = 'inventory-grid-container';
        gridContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
      `;
        // Create rows for each rarity that has items
        Object.entries(itemsByRarity).forEach(([rarity, items]) => {
            if (items.length > 0) {
                // Create rarity row container
                const rarityRow = document.createElement('div');
                rarityRow.className = 'rarity-row';
                rarityRow.style.cssText = `
                  display: flex;
                  flex-direction: column;
                  gap: 5px;
              `;
                // Add rarity label
                const rarityLabel = document.createElement('div');
                rarityLabel.textContent = rarity.toUpperCase();
                rarityLabel.style.cssText = `
                  color: ${this.ITEM_RARITY_COLORS[rarity]};
                  font-weight: bold;
                  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
                  padding-left: 5px;
              `;
                rarityRow.appendChild(rarityLabel);
                // Create grid for this rarity's items
                const grid = document.createElement('div');
                grid.className = 'inventory-grid';
                grid.style.cssText = `
                  display: flex;
                  flex-wrap: wrap;
                  gap: 5px;
                  padding: 5px;
                  background: rgba(0, 0, 0, 0.2);
                  border-radius: 5px;
                  border: 1px solid ${this.ITEM_RARITY_COLORS[rarity]}40;
              `;
                // Add items to grid
                items.forEach(item => {
                    const itemElement = document.createElement('div');
                    itemElement.className = 'inventory-item';
                    itemElement.draggable = true;
                    // Style for item slot
                    itemElement.style.cssText = `
                      position: relative;
                      width: 50px;
                      height: 50px;
                      background-color: ${this.ITEM_RARITY_COLORS[rarity]}20;
                      border: 2px solid ${this.ITEM_RARITY_COLORS[rarity]};
                      border-radius: 5px;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      cursor: pointer;
                      transition: all 0.2s ease;
                  `;
                    // Add hover effect
                    itemElement.addEventListener('mouseover', () => {
                        itemElement.style.transform = 'scale(1.05)';
                        itemElement.style.boxShadow = `0 0 10px ${this.ITEM_RARITY_COLORS[rarity]}`;
                    });
                    itemElement.addEventListener('mouseout', () => {
                        itemElement.style.transform = 'scale(1)';
                        itemElement.style.boxShadow = 'none';
                    });
                    // Add drag functionality
                    itemElement.addEventListener('dragstart', (e) => {
                        const index = player.inventory.findIndex(i => i.id === item.id);
                        e.dataTransfer?.setData('text/plain', index.toString());
                        itemElement.classList.add('dragging');
                    });
                    itemElement.addEventListener('dragend', () => {
                        itemElement.classList.remove('dragging');
                    });
                    // Add item image
                    const img = document.createElement('img');
                    img.src = `./assets/${item.type}.png`;
                    img.alt = item.type;
                    img.draggable = false;
                    img.style.cssText = `
                      width: 40px;
                      height: 40px;
                      object-fit: contain;
                  `;
                    itemElement.appendChild(img);
                    grid.appendChild(itemElement);
                });
                rarityRow.appendChild(grid);
                gridContainer.appendChild(rarityRow);
            }
        });
        content.appendChild(gridContainer);
    }
    // Add this method to the Game class
    moveItemToInventory(loadoutSlot) {
        const player = this.players.get(this.socket?.id || '');
        if (!player)
            return;
        const item = player.loadout[loadoutSlot];
        if (!item)
            return;
        console.log('Moving item from loadout to inventory:', {
            item,
            fromSlot: loadoutSlot
        });
        // Create a copy of the current state
        const newInventory = [...player.inventory];
        const newLoadout = [...player.loadout];
        // Move item to inventory
        newInventory.push(item);
        // Remove from loadout
        newLoadout[loadoutSlot] = null;
        // Update player's state
        player.inventory = newInventory;
        player.loadout = newLoadout;
        // Update server
        this.socket?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: newInventory
        });
        // Force immediate visual updates
        requestAnimationFrame(() => {
            this.updateInventoryDisplay();
            this.updateLoadoutDisplay();
        });
        console.log('Updated player state:', {
            inventory: player.inventory,
            loadout: player.loadout
        });
    }
    showSaveIndicator() {
        if (!this.saveIndicator)
            return;
        // Clear any existing timeout
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
        }
        // Show the indicator
        this.saveIndicator.style.display = 'block';
        this.saveIndicator.style.opacity = '1';
        // Hide after 2 seconds
        this.saveIndicatorTimeout = setTimeout(() => {
            if (this.saveIndicator) {
                this.saveIndicator.style.opacity = '0';
                setTimeout(() => {
                    if (this.saveIndicator) {
                        this.saveIndicator.style.display = 'none';
                    }
                }, 300); // Match transition duration
            }
        }, 2000);
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
    // Add to Game class properties
    initializeCrafting() {
        // Create crafting panel
        this.craftingPanel = document.createElement('div');
        this.craftingPanel.id = 'craftingPanel';
        this.craftingPanel.className = 'crafting-panel';
        this.craftingPanel.style.display = 'none';
        // Create crafting grid
        const craftingGrid = document.createElement('div');
        craftingGrid.className = 'crafting-grid';
        // Create 4 crafting slots
        for (let i = 0; i < 4; i++) {
            const slot = document.createElement('div');
            slot.className = 'crafting-slot';
            slot.dataset.index = i.toString();
            // Add drop zone functionality
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                slot.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', () => {
                slot.classList.remove('drag-over');
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                slot.classList.remove('drag-over');
                const itemIndex = e.dataTransfer?.getData('text/plain');
                if (itemIndex) {
                    this.addItemToCraftingSlot(parseInt(itemIndex), i);
                }
            });
            craftingGrid.appendChild(slot);
        }
        // Create craft button
        const craftButton = document.createElement('button');
        craftButton.className = 'craft-button';
        craftButton.textContent = 'Craft';
        craftButton.addEventListener('click', () => this.craftItems());
        this.craftingPanel.appendChild(craftingGrid);
        this.craftingPanel.appendChild(craftButton);
        document.body.appendChild(this.craftingPanel);
        // Add crafting styles
        const style = document.createElement('style');
        style.textContent = `
          .crafting-panel {
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              background: rgba(0, 0, 0, 0.9);
              padding: 20px;
              border-radius: 10px;
              border: 2px solid #666;
              display: none;
              z-index: 1000;
          }

          .crafting-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 10px;
              margin-bottom: 20px;
          }

          .crafting-slot {
              width: 60px;
              height: 60px;
              background: rgba(255, 255, 255, 0.1);
              border: 2px solid #666;
              border-radius: 5px;
              display: flex;
              align-items: center;
              justify-content: center;
          }

          .crafting-slot.drag-over {
              border-color: #00ff00;
              background: rgba(0, 255, 0, 0.2);
          }

          .craft-button {
              width: 100%;
              padding: 10px;
              background: #4CAF50;
              color: white;
              border: none;
              border-radius: 5px;
              cursor: pointer;
              font-size: 16px;
          }

          .craft-button:hover {
              background: #45a049;
          }

          .craft-button:disabled {
              background: #666;
              cursor: not-allowed;
          }
      `;
        document.head.appendChild(style);
    }
    // Add to Game class properties
    toggleCrafting() {
        if (!this.craftingPanel)
            return;
        this.isCraftingOpen = !this.isCraftingOpen;
        this.craftingPanel.style.display = this.isCraftingOpen ? 'block' : 'none';
        if (this.isCraftingOpen) {
            this.updateCraftingDisplay();
        }
    }
    // Add to Game class properties
    addItemToCraftingSlot(inventoryIndex, slotIndex) {
        const player = this.players.get(this.socket?.id || '');
        if (!player)
            return;
        const item = player.inventory[inventoryIndex];
        if (!item)
            return;
        // Check if slot already has an item
        if (this.craftingSlots[slotIndex].item) {
            return;
        }
        // Check if item can be added (same type and rarity as other items)
        const existingItems = this.craftingSlots.filter(slot => slot.item !== null);
        if (existingItems.length > 0) {
            const firstItem = existingItems[0].item;
            if (item.type !== firstItem.type || item.rarity !== firstItem.rarity) {
                this.showFloatingText(this.canvas.width / 2, 50, 'Items must be of the same type and rarity!', '#FF0000', 20);
                return;
            }
        }
        // Add item to crafting slot
        this.craftingSlots[slotIndex].item = item;
        // Remove item from inventory
        player.inventory.splice(inventoryIndex, 1);
        // Update displays
        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }
    // Add to Game class properties
    craftItems() {
        const player = this.players.get(this.socket?.id || '');
        if (!player)
            return;
        // Check if all slots are filled
        if (!this.craftingSlots.every(slot => slot.item !== null)) {
            this.showFloatingText(this.canvas.width / 2, 50, 'All slots must be filled to craft!', '#FF0000', 20);
            return;
        }
        // Get items for crafting
        const craftingItems = this.craftingSlots
            .map(slot => slot.item)
            .filter((item) => item !== null);
        // Send crafting request to server
        this.socket?.emit('craftItems', { items: craftingItems });
        // Clear crafting slots immediately for responsiveness
        this.craftingSlots.forEach(slot => slot.item = null);
        this.updateCraftingDisplay();
    }
    // Add to Game class properties
    updateCraftingDisplay() {
        const slots = document.querySelectorAll('.crafting-slot');
        slots.forEach((slot, index) => {
            // Clear existing content
            slot.innerHTML = '';
            const craftingSlot = this.craftingSlots[index];
            if (craftingSlot.item) {
                const img = document.createElement('img');
                img.src = `./assets/${craftingSlot.item.type}.png`;
                img.alt = craftingSlot.item.type;
                img.style.width = '80%';
                img.style.height = '80%';
                img.style.objectFit = 'contain';
                // Add rarity border color
                if (craftingSlot.item.rarity) {
                    slot.style.borderColor = this.ITEM_RARITY_COLORS[craftingSlot.item.rarity];
                }
                slot.appendChild(img);
            }
            else {
                slot.style.borderColor = '#666';
            }
        });
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
    // Add these methods to the Game class
    getCurrentPlayerId() {
        if (this.isSinglePlayer) {
            const player = this.players.values().next().value;
            return player?.id || '';
        }
        else {
            return this.socket?.id || '';
        }
    }
}
exports.Game = Game;
