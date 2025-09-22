import { Player, PlayerProgress, ServerPlayer } from './player';
import { Dot, Enemy, Obstacle } from './enemy';
import { Item, ItemWithRarity } from './item';
import { IMAGE_ASSETS } from './imageAssets';
import { SVGLoader } from './SVGLoader';
import { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE } from './constants';
import { Graphics } from './graphics';
import { Chat } from './chat';
import { initMultiPlayerMode, Socket } from './socket';

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
    private canvas: HTMLCanvasElement;
    private graphics: Graphics;
    private socket!: Socket;  // Using the definite assignment assertion
    private players: Map<string, Player> = new Map();
    private playerSprite: HTMLImageElement = new Image();
    private dots: { x: number, y: number }[] = [];
    private readonly DOT_SIZE = 5;
    private readonly DOT_COUNT = 20;
    private readonly PLAYER_ACCELERATION = 0.5;  // Adjusted for smoother acceleration
    private readonly MAX_SPEED = 90;            // Further increased speed for better responsiveness
    // private readonly FRICTION = 0.95;        // Removed sliding physics
    private cameraX = 0;
    private cameraY = 0;
    private playerEye: { x: number, y: number } = { x: 0, y: 0 };
    private targetEye: { x: number, y: number } = { x: 0, y: 0 };
    private readonly WORLD_WIDTH = ACTUAL_WORLD_WIDTH;  // Increased from 2000 to 10000
    private readonly WORLD_HEIGHT = ACTUAL_WORLD_HEIGHT;  // Keep height the same
    private keysPressed: Set<string> = new Set();
    private enemies: Map<string, Enemy> = new Map();
    private octopusSprite: HTMLImageElement = new Image();
    private fishSprite: HTMLImageElement = new Image();
    private coralSprite: HTMLImageElement = new Image();
    private palmSprite: HTMLImageElement = new Image();
    private readonly PLAYER_MAX_HEALTH = 100;
    private readonly PLAYER_DAMAGE = 10;
    private readonly ENEMY_DAMAGE = 5;
    private readonly DAMAGE_COOLDOWN = 1000; // 1 second cooldown
    private lastDamageTime: number = 0;
    private obstacles: Obstacle[] = [];
    private readonly ENEMY_CORAL_MAX_HEALTH = 50;
    private items: Map<string, Item> = new Map();
    private itemSprites: Record<string, HTMLImageElement> = {};
    private isInventoryOpen: boolean = false;
    private gameLoopId: number | null = null;
    private socketHandlers: Map<string, Function> = new Map();
    private readonly BASE_XP_REQUIREMENT = 100;
    private readonly XP_MULTIPLIER = 1.5;
    private readonly MAX_LEVEL = 50;
    private readonly HEALTH_PER_LEVEL = 10;
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
    private useMouseControls: boolean = false;
    private mouseX: number = 0;
    private mouseY: number = 0;
    private showHitboxes: boolean = false;  // Changed from true to false
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
    private readonly ITEM_RARITY_COLORS: Record<string, string> = {
        common: '#808080',      // Gray
        uncommon: '#008000',    // Green
        rare: '#0000FF',       // Blue
        epic: '#800080',       // Purple
        legendary: '#FFA500',   // Orange
        mythic: '#FF0000'      // Red
    };
    // Add to Game class properties
    private craftingPanel: HTMLDivElement | null = null;
    private craftingSlots: CraftingSlot[] = Array(4).fill(null).map((_, i) => ({ index: i, item: null }));
    private isCraftingOpen: boolean = false;
    private svgLoader: SVGLoader;
    // Add to class properties
    private walls: any[] = [];
    private readonly WALL_SPACING = 500; // Distance between walls
    private world_map_data: MapElement[] = [];

    // Add map rendering properties

    private lastUpdateTime: number = 0;         // Add this property for delta time
    private lastServerUpdate: number = 0;
    private lastHeartbeat: number = 0;
    private heartbeatInterval: NodeJS.Timeout | null = null;       // Add this property for server update time

    // Add to class properties at the top
    private backgroundImage: HTMLImageElement = new Image();

    private wallTexture: HTMLImageElement = new Image(); // Add this to class properties
    private backgroundTexture: HTMLImageElement = new Image();
    private healthPotionSprite: HTMLImageElement = new Image();
    private speedBoostSprite: HTMLImageElement = new Image();
    private shieldSprite: HTMLImageElement = new Image();

    private lastDeathTime: number = 0;
    private deathCooldown: number = 3000; // 3 seconds

    private lastMessageTime: number = 0; // Add this line
    private messageCooldown: number = 1000; // 1 second cooldown

    private gameStartTime: number = 0;

    // Add chat property
    private chat: Chat | null = null;

    constructor() {
        //console.log('Game constructor called');
        this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        this.graphics = new Graphics(
            this.canvas, 
            this.playerSprite, 
            this.wallTexture,
            this.octopusSprite,
            this.fishSprite,
            this.healthPotionSprite,
            this.speedBoostSprite,
            this.shieldSprite,
            this.backgroundTexture
        );

        // Set initial canvas size
        this.resizeCanvas();

        // Add resize listener
        window.addEventListener('resize', () => this.resizeCanvas());


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
                    this.showFloatingText(
                        this.canvas.width / 2,
                        50,
                        'Color Updated!',
                        '#4CAF50',
                        20
                    );
                });
            }
        }

        this.setupEventListeners();

        // Get title screen elements
        this.titleScreen = document.querySelector('.center_text');
        this.nameInput = document.getElementById('nameInput') as HTMLInputElement;

        // Initialize multiplayer mode after resource loading
        initMultiPlayerMode(this);

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

        this.svgLoader = new SVGLoader();
        this.loadAssets();

        // Listen for map data from the server
        this.socket.on('mapData', (mapData: MapElement[]) => {
            //console.log('Received map data:', mapData);
            this.world_map_data = mapData;
            this.graphics.setMap(mapData);
            this.renderMap(mapData);
        });

        this.socket.on('zoneUpdate', (zones: any) => {
            // ... existing code ...
        });

        // Load background image
        this.backgroundImage.src = IMAGE_ASSETS["background"];
        this.backgroundImage.onload = () => {
            console.log('Background image loaded successfully');
        };

        // Load wall texture
        this.wallTexture.src = IMAGE_ASSETS["wall"];
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

        this.chat = new Chat(this.socket);
    }

    private async initializeSprites(): Promise<void> {
        const loadSprite = async (sprite: HTMLImageElement, filename: string): Promise<void> => {
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
            } catch (error) {
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
        } catch (error) {
            console.error('Error loading sprites:', error);
            // Continue even if some sprites fail to load
        }
    }

    private authenticate() {
        // Get credentials from AuthUI or localStorage
        const credentials = {
            username: localStorage.getItem('username') || 'player1',
            password: localStorage.getItem('password') || 'password123',
            playerName: this.nameInput?.value || 'Anonymous'
        };

        this.socket.emit('authenticate', credentials);

        this.socket.on('authenticated', (response: { success: boolean; error?: string; player?: any }) => {
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
            } else {
                console.error('Authentication failed:', response.error);
                alert('Authentication failed: ' + response.error);
                localStorage.removeItem('currentUser');
                window.location.reload();
            }
        });
    }

    private setupEventListeners() {
        document.addEventListener('keydown', (event) => {
            if (this.chat && this.chat.isFocused) {
                if (event.key === 'Escape') {
                    this.chat.blur();
                }
                return;
            }

            // Add chat toggle
            if (event.key === 'Enter') {
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
                this.showFloatingText(
                    this.canvas.width / 2,
                    50,
                    `Controls: ${this.useMouseControls ? 'Mouse' : 'Keyboard'}`,
                    '#FFFFFF',
                    20
                );
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
                this.showFloatingText(
                    this.canvas.width / 2,
                    50,
                    `Hitboxes: ${this.showHitboxes ? 'ON' : 'OFF'}`,
                    '#FFFFFF',
                    20
                );
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
                const slot = (e.target as HTMLElement).dataset.slot;

                if (itemIndex >= 0 && slot) {
                    this.equipItemToLoadout(itemIndex, parseInt(slot));
                }
            });
        }
    }

    private updateCamera(player: Player) {
        // Center camera on player
        const targetX = player.x - this.canvas.width / 2;
        const targetY = player.y - this.canvas.height / 2;

        // Clamp camera to world bounds with proper dimensions
        this.cameraX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - this.canvas.width, targetX));
        this.cameraY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - this.canvas.height, targetY));
        this.graphics.setCamera(this.cameraX, this.cameraY);
    }

    private generateDot() {
        const dot: Dot = {
            x: Math.random() * this.WORLD_WIDTH,
            y: Math.random() * this.WORLD_HEIGHT
        };
        this.dots.push(dot);
    }

    private toggleInventory() {
        if (!this.inventoryPanel) return;

        const isOpen = this.inventoryPanel.style.display === 'block';
        if (!isOpen) {
            this.inventoryPanel.style.display = 'block';
            setTimeout(() => {
                this.inventoryPanel?.classList.add('open');
            }, 10);
            this.updateInventoryDisplay();
        } else {
            this.inventoryPanel.classList.remove('open');
            setTimeout(() => {
                if (this.inventoryPanel) {
                    this.inventoryPanel.style.display = 'none';
                }
            }, 300); // Match transition duration
        }
        this.isInventoryOpen = !isOpen;
    }

    private gameLoop() {
        this.update();
        this.graphics.render(this.players, this.enemies, this.items, this.socket?.id ?? '');
        requestAnimationFrame(() => this.gameLoop());
    }

    private update() {
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

    private updatePlayerMovement(player: Player, deltaTime: number) {
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

    private updatePlayerEye() {
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

    private showFloatingText(x: number, y: number, text: string, color: string, fontSize: number) {
        this.graphics.showFloatingText(x, y, text, color, fontSize);
    }

    private renderMap(mapData: MapElement[]) {
        // Store the map data and render it
        this.world_map_data = mapData;
        this.graphics.drawMap(mapData);
    }

    private async setupItemSprites() {
        this.itemSprites = {};
        const itemTypes = ['health_potion', 'speed_boost', 'shield'];

        try {
            await Promise.all(itemTypes.map(async type => {
                const sprite = new Image();
                sprite.crossOrigin = "anonymous";
                const url = await this.getAssetUrl(`${type}.png`);

                await new Promise<void>((resolve, reject) => {
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
        } catch (error) {
            console.error('Error loading item sprites:', error);
        }
    }

    private resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Update any viewport-dependent calculations here
        // For example, you might want to adjust the camera bounds
        // console.log('Canvas resized to:', this.canvas.width, 'x', this.canvas.height);
    }

    // Change from private to public
    public cleanup() {
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
            this.graphics.ctx.clearRect(
                minimapX - 5,
                minimapY - 5,
                this.MINIMAP_WIDTH + 10,
                this.MINIMAP_HEIGHT + 10
            );
            this.graphics.ctx.fillStyle = 'white';
            this.graphics.ctx.fillRect(
                minimapX - 5,
                minimapY - 5,
                this.MINIMAP_WIDTH + 10,
                this.MINIMAP_HEIGHT + 10
            );
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
        if (this.inventoryPanel) this.inventoryPanel.style.display = 'none';
        if (this.craftingPanel) this.craftingPanel.style.display = 'none';
        if (this.chatContainer) this.chatContainer.style.display = 'none';
        if (this.saveIndicator) this.saveIndicator.style.display = 'none';

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

    private loadPlayerProgress(): { level: number; xp: number; maxHealth: number; damage: number } {
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

    private savePlayerProgress(player: Player) {
        const progress = {
            level: player.level,
            xp: player.xp,
            maxHealth: player.maxHealth,
            damage: player.damage
        };
        localStorage.setItem('playerProgress', JSON.stringify(progress));
    }

    private showDeathScreen() {
        const deathScreen = document.getElementById('deathScreen');
        if (deathScreen) {
            deathScreen.style.display = 'flex';
        }
    }

    private hideDeathScreen() {
        const deathScreen = document.getElementById('deathScreen');
        if (deathScreen) {
            deathScreen.style.display = 'none';
        }
    }

    private hideTitleScreen() {
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

    private showExitButton() {
        if (this.exitButtonContainer) {
            this.exitButtonContainer.style.display = 'block';
        }
    }

    private hideExitButton() {
        if (this.exitButtonContainer) {
            this.exitButtonContainer.style.display = 'none';
        }
    }

    private handleExit() {
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

    private applyHueRotation(ctx: CanvasRenderingContext2D, imageData: ImageData): void {
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            // Skip fully transparent pixels
            if (data[i + 3] === 0) continue;

            // Convert RGB to HSL
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;

            if (max === min) {
                h = s = 0; // achromatic
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                    default: h = 0;
                }
                h /= 6;
            }

            // Only adjust hue if the pixel has some saturation
            if (s > 0.1) {  // Threshold for considering a pixel colored
                h = (h + this.playerHue / 360) % 1;

                // Convert back to RGB
                if (s === 0) {
                    data[i] = data[i + 1] = data[i + 2] = l * 255;
                } else {
                    const hue2rgb = (p: number, q: number, t: number) => {
                        if (t < 0) t += 1;
                        if (t > 1) t -= 1;
                        if (t < 1 / 6) return p + (q - p) * 6 * t;
                        if (t < 1 / 2) return q;
                        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
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

    private updateColorPreview() {
        if (!this.playerSprite.complete) return;

        const ctx = this.colorPreviewCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, this.colorPreviewCanvas.width, this.colorPreviewCanvas.height);

        // Draw the sprite centered in the preview
        const scale = Math.min(
            this.colorPreviewCanvas.width / this.playerSprite.width,
            this.colorPreviewCanvas.height / this.playerSprite.height
        );

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

    private equipItemToLoadout(inventoryIndex: number, loadoutSlot: number) {
        const player = this.players.get(this.socket?.id || '');
        if (!player || loadoutSlot >= this.LOADOUT_SLOTS) return;

        const item = player.inventory[inventoryIndex];
        if (!item) return;

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

    private useLoadoutItem(slot: number) {
        const player = this.players.get(this.socket?.id || '');
        if (!player || !player.loadout[slot]) return;

        const item = player.loadout[slot];
        if (!item || (item as any).onCooldown) return;  // Check for cooldown

        // Use the item
        this.socket?.emit('useItem', item.id);
        console.log('Used item:', item.id);

        // Listen for item effects
        this.socket?.on('speedBoostActive', (playerId: string) => {
            if (playerId === this.socket?.id) {
                this.speedBoostActive = true;
                console.log('Speed boost activated');
            }
        });

        // Show floating text based on item type and rarity
        const rarityMultipliers: Record<string, number> = {
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
                this.showFloatingText(
                    player.x,
                    player.y - 30,
                    `+${Math.floor(50 * multiplier)} HP`,
                    '#32CD32',
                    20
                );
                break;
            case 'speed_boost':
                this.showFloatingText(
                    player.x,
                    player.y - 30,
                    `Speed Boost (${Math.floor(5 * multiplier)}s)`,
                    '#4169E1',
                    20
                );
                break;
            case 'shield':
                this.showFloatingText(
                    player.x,
                    player.y - 30,
                    `Shield (${Math.floor(3 * multiplier)}s)`,
                    '#FFD700',
                    20
                );
                break;
        }

        // Add visual cooldown effect to the loadout slot
        const slot_element = document.querySelector(`.loadout-slot[data-slot="${slot}"]`);
        if (slot_element) {
            slot_element.classList.add('on-cooldown');

            // Remove cooldown class when cooldown is complete
            const cooldownTime = 10000 * (1 / multiplier);  // 10 seconds base, reduced by rarity
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

    private updateLoadoutDisplay() {
        const player = this.players.get(this.socket?.id || '');
        if (!player) return;

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

    private setupDragAndDrop() {
        // Add global drop handler
        document.addEventListener('dragover', (e: Event) => {
            e.preventDefault();
        });

        document.addEventListener('drop', (e: Event) => {
            e.preventDefault();
            const dragEvent = e as DragEvent;
            const target = e.target as HTMLElement;

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
                    img.addEventListener('dragstart', (e: Event) => {
                        const dragEvent = e as DragEvent;
                        dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                        dragEvent.dataTransfer!.effectAllowed = 'move';
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
            (slot as HTMLElement).dataset.slot = slotIndex.toString();

            slot.addEventListener('dragenter', (e: Event) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.add('drag-over');
            });

            slot.addEventListener('dragover', (e: Event) => {
                e.preventDefault();
                const dragEvent = e as DragEvent;
                dragEvent.dataTransfer!.dropEffect = 'move';
                (e.currentTarget as HTMLElement).classList.add('drag-over');
            });

            slot.addEventListener('dragleave', (e: Event) => {
                (e.currentTarget as HTMLElement).classList.remove('drag-over');
            });

            slot.addEventListener('drop', (e: Event) => {
                e.preventDefault();
                const dragEvent = e as DragEvent;
                const target = e.currentTarget as HTMLElement;
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
                } else if (fromLoadoutSlot) {
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
                grid.addEventListener('dragover', (e: Event) => {
                    e.preventDefault();
                    const dragEvent = e as DragEvent;
                    dragEvent.dataTransfer!.dropEffect = 'move';
                    grid.classList.add('drag-over');
                });

                grid.addEventListener('dragleave', (e: Event) => {
                    grid.classList.remove('drag-over');
                });

                grid.addEventListener('drop', (e: Event) => {
                    e.preventDefault();
                    grid.classList.remove('drag-over');
                    const dragEvent = e as DragEvent;
                    const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                    if (loadoutSlot) {
                        this.moveItemToInventory(parseInt(loadoutSlot));
                    }
                });
            }
        }
    }

    // Add method to swap loadout items
    private swapLoadoutItems(fromSlot: number, toSlot: number) {
        const player = this.players.get(this.socket?.id || '');
        if (!player) return;

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
    private updateInventoryDisplay() {
        if (!this.inventoryPanel) return;

        const player = this.players.get(this.socket?.id || '');
        if (!player) return;

        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content) return;

        content.innerHTML = '';

        // Add inventory title
        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);

        // Group items by rarity
        const itemsByRarity: Record<string, Item[]> = {
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
    private moveItemToInventory(loadoutSlot: number) {
        const player = this.players.get(this.socket?.id || '');
        if (!player) return;

        const item = player.loadout[loadoutSlot];
        if (!item) return;

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

    private showSaveIndicator() {
        if (!this.saveIndicator) return;

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
    private async getAssetUrl(filename: string): Promise<string> {
        // Remove the file extension to get the asset key
        const assetKey = filename.replace('.png', '');

        // If running from file:// protocol, use base64 data
        if (window.location.protocol === 'file:') {
            // Get the base64 data from our assets
            const base64Data = IMAGE_ASSETS[assetKey as keyof typeof IMAGE_ASSETS];
            if (base64Data) {
                return base64Data;
            }
            console.error(`No base64 data found for asset: ${filename}`);
        }

        // Otherwise use normal URL
        return `./assets/${filename}`;
    }

    // Add to Game class properties
    private initializeCrafting() {
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
    private toggleCrafting() {
        if (!this.craftingPanel) return;

        this.isCraftingOpen = !this.isCraftingOpen;
        this.craftingPanel.style.display = this.isCraftingOpen ? 'block' : 'none';

        if (this.isCraftingOpen) {
            this.updateCraftingDisplay();
        }
    }

    // Add to Game class properties
    private addItemToCraftingSlot(inventoryIndex: number, slotIndex: number) {
        const player = this.players.get(this.socket?.id || '');
        if (!player) return;

        const item = player.inventory[inventoryIndex];
        if (!item) return;

        // Check if slot already has an item
        if (this.craftingSlots[slotIndex].item) {
            return;
        }

        // Check if item can be added (same type and rarity as other items)
        const existingItems = this.craftingSlots.filter(slot => slot.item !== null);
        if (existingItems.length > 0) {
            const firstItem = existingItems[0].item!;
            if (item.type !== firstItem.type || item.rarity !== firstItem.rarity) {
                this.showFloatingText(
                    this.canvas.width / 2,
                    50,
                    'Items must be of the same type and rarity!',
                    '#FF0000',
                    20
                );
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
    private craftItems() {
        const player = this.players.get(this.socket?.id || '');
        if (!player) return;

        // Check if all slots are filled
        if (!this.craftingSlots.every(slot => slot.item !== null)) {
            this.showFloatingText(
                this.canvas.width / 2,
                50,
                'All slots must be filled to craft!',
                '#FF0000',
                20
            );
            return;
        }

        // Get items for crafting
        const craftingItems = this.craftingSlots
            .map(slot => slot.item)
            .filter((item): item is Item => item !== null);

        // Send crafting request to server
        this.socket?.emit('craftItems', { items: craftingItems });

        // Clear crafting slots immediately for responsiveness
        this.craftingSlots.forEach(slot => slot.item = null);
        this.updateCraftingDisplay();
    }

    // Add to Game class properties
    private updateCraftingDisplay() {
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
                    (slot as HTMLElement).style.borderColor = this.ITEM_RARITY_COLORS[craftingSlot.item.rarity];
                }

                slot.appendChild(img);
            } else {
                (slot as HTMLElement).style.borderColor = '#666';
            }
        });
    }

    private async loadAssets() {
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
                element: wallSVG.cloneNode(true) as SVGElement
            }));

            console.log('Successfully initialized walls');
        } catch (error) {
            console.error('Failed to load game assets:', error);
            // Create empty walls array if loading fails
            this.walls = [];
        }
    }

    // Add these methods to the Game class


    private getCurrentPlayerId(): string {
        return this.socket?.id || '';
    }
}