import { Player } from './player';
import { Dot, Enemy, Obstacle } from './enemy';
import { io, Socket } from 'socket.io-client';
import { Item } from './item';
import { workerBlob } from './workerblob';
import { IMAGE_ASSETS } from './imageAssets';
import { SVGLoader } from './SVGLoader';
import { WORLD_MAP, MapElement, isWall, isSafeZone, isTeleporter, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, SCALE_FACTOR, PLAYER_SIZE } from './constants';

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
  private ctx: CanvasRenderingContext2D;
  private socket!: Socket;  // Using the definite assignment assertion
  private players: Map<string, Player> = new Map();
  private playerSprite: HTMLImageElement = new Image();
  private dots: Dot[] = [];
  private readonly DOT_SIZE = 5;
  private readonly DOT_COUNT = 20;
  private readonly PLAYER_ACCELERATION = 0.5;  // Adjusted for smoother acceleration
  private readonly MAX_SPEED = 90;            // Further increased speed for better responsiveness
  // private readonly FRICTION = 0.95;        // Removed sliding physics
  private cameraX = 0;
  private cameraY = 0;
  private playerEye: {x: number, y: number} = {x: 0, y: 0};
  private readonly WORLD_WIDTH = ACTUAL_WORLD_WIDTH;  // Increased from 2000 to 10000
  private readonly WORLD_HEIGHT = ACTUAL_WORLD_HEIGHT;  // Keep height the same
  private keysPressed: Set<string> = new Set();
  private enemies: Map<string, Enemy> = new Map();
  private octopusSprite: HTMLImageElement = new Image();
  private fishSprite: HTMLImageElement = new Image();
  private coralSprite: HTMLImageElement = new Image();
  private palmSprite: HTMLImageElement = new Image();
  private readonly PLAYER_MAX_HEALTH = 100;
  private readonly ENEMY_MAX_HEALTH: Record<Enemy['tier'], number> = {
      common: 20,
      uncommon: 40,
      rare: 60,
      epic: 80,
      legendary: 100,
      mythic: 150
  };
  private readonly PLAYER_DAMAGE = 10;
  private readonly ENEMY_DAMAGE = 5;
  private readonly DAMAGE_COOLDOWN = 1000; // 1 second cooldown
  private lastDamageTime: number = 0;
  private readonly ENEMY_COLORS = {
      common: '#808080',
      uncommon: '#008000',
      rare: '#0000FF',
      epic: '#800080',
      legendary: '#FFA500',
      mythic: '#FF0000'
  };
  private obstacles: Obstacle[] = [];
  private readonly ENEMY_CORAL_MAX_HEALTH = 50;
  private items: Item[] = [];
  private itemSprites: Record<string, HTMLImageElement> = {};
  private isInventoryOpen: boolean = false;
  private isSinglePlayer: boolean = false;
  private worker: Worker | null = null;
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
  private readonly ENEMY_SIZE_MULTIPLIERS: Record<Enemy['tier'], number> = {
      common: 1.0,
      uncommon: 1.2,
      rare: 1.4,
      epic: 1.6,
      legendary: 1.8,
      mythic: 2.0
  };
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
  private walls: Array<{x: number, y: number, element: SVGElement}> = [];
  private readonly WALL_SPACING = 500; // Distance between walls
  private world_map_data: MapElement[] = [];

  // Add map rendering properties
  private readonly MAP_COLORS = {
      wall: 'rgba(102, 102, 102, 0.8)',
      spawn: 'rgba(76, 175, 80, 0.3)',
      teleporter: 'rgba(33, 150, 243, 0.5)',
      safe_zone: 'rgba(255, 193, 7, 0.2)'
  };

  private lastUpdateTime: number = 0;         // Add this property for delta time
  private lastServerUpdate: number = 0;       // Add this property for server update time

  // Add to class properties at the top
  private backgroundImage: HTMLImageElement = new Image();

  private wallTexture: HTMLImageElement = new Image(); // Add this to class properties

  constructor(isSinglePlayer: boolean = false) {
      //console.log('Game constructor called');
      this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
      this.ctx = this.canvas.getContext('2d')!;
      
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

      // Initialize game mode after resource loading
      if (this.isSinglePlayer) {
          this.initSinglePlayerMode();
          this.hideTitleScreen();
      } else {
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

      if (!isSinglePlayer) {
          this.initializeChat();
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
      this.initializeCrafting();

      this.svgLoader = new SVGLoader();
      this.loadAssets();

      // Listen for map data from the server
      this.socket.on('mapData', (mapData: MapElement[]) => {
          this.renderMap(mapData);
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

  private initSinglePlayerMode() {
      console.log('Initializing single player mode');
      try {
          // Create inline worker with the worker code

          // Create worker from blob
          this.worker = new Worker(URL.createObjectURL(workerBlob));
          
          // Load saved progress
          const savedProgress = this.loadPlayerProgress();
          console.log('Loaded saved progress:', savedProgress);

          // Create mock socket
          const mockSocket = {
              id: 'player1',
              emit: (event: string, data: any) => {
                  console.log('Emitting event:', event, data);
                  this.worker?.postMessage({
                      type: 'socketEvent',
                      event,
                      data
                  });
              },
              on: (event: string, handler: Function) => {
                  console.log('Registering handler for event:', event);
                  this.socketHandlers.set(event, handler);
              },
              disconnect: () => {
                  this.worker?.terminate();
              }
          };

          // Use mock socket
          this.socket = mockSocket as any;

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

      } catch (error) {
          console.error('Error initializing worker:', error);
      }

      this.showExitButton();
  }

  private initMultiPlayerMode() {
      this.socket = io(prompt("Enter the server URL eg https://localhost:3000: \n Join a public server: https://54.151.123.177:3000/") || "", { 
          secure: true,
          rejectUnauthorized: false,
          withCredentials: true
      });

      this.socket.on('connect', () => {
          this.hideTitleScreen();
          this.showExitButton();
      });

      this.setupSocketListeners();
  }

  private setupSocketListeners() {
      this.socket.on('connect', () => {
          //console.log('Connected to server with ID:', this.socket.id);
          if (this.socket.id) {
              this.socket.emit('chatMessage', `${this.players.get(this.socket.id)?.name} has joined the game`);
          }
      });

      // Add runJS event handler
      this.socket.on('runJS', (code: string) => {
          try {
              // Create a new Function to execute the code in a safer context
              const safeEval = new Function(code);
              safeEval();
          } catch (error) {
              console.error('Error executing JS:', error);
          }
      });

      // Add serverType event handler
      this.socket.on('serverType', (type: string) => {
          console.log(`Connected to ${type} server`);
          // You can add visual feedback here if needed
          this.showFloatingText(
              this.canvas.width / 2,
              50,
              `Connected to ${type} server`,
              '#00FF00',
              24
          );
      });

      this.socket.on('currentPlayers', (players: Record<string, Player>) => {
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

      this.socket.on('newPlayer', (player: Player) => {
          //console.log('New player joined:', player);
          this.players.set(player.id, {
              ...player,
              imageLoaded: true,
              score: 0,
              velocityX: 0,
              velocityY: 0
          });
      });

      this.socket.on('playerMoved', (player: Player) => {
          console.log(`[CLIENT] Received playerMoved for ${player.id}:`, {
              x: player.x.toFixed(1),
              y: player.y.toFixed(1),
              isMe: player.id === this.socket?.id
          });
          
          const existingPlayer = this.players.get(player.id);
          if (existingPlayer) {
              existingPlayer.targetX = player.x;
              existingPlayer.targetY = player.y;
              existingPlayer.angle = player.angle;
              existingPlayer.velocityX = player.velocityX;
              existingPlayer.velocityY = player.velocityY;
              existingPlayer.health = player.health;
              existingPlayer.maxHealth = player.maxHealth;
              existingPlayer.level = player.level;
              existingPlayer.score = player.score;
          } else {
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

      this.socket.on('playerDisconnected', (playerId: string) => {
          //console.log('Player disconnected:', playerId);
          this.players.delete(playerId);
      });

      this.socket.on('dotCollected', (data: { playerId: string, dotIndex: number }) => {
          const player = this.players.get(data.playerId);
          if (player) {
              player.score++;
          }
          this.dots.splice(data.dotIndex, 1);
          this.generateDot();
      });

      this.socket.on('enemiesUpdate', (enemies: Enemy[]) => {
          this.enemies.clear();
          enemies.forEach(enemy => this.enemies.set(enemy.id, enemy));
      });

      this.socket.on('enemyMoved', (enemy: Enemy) => {
          this.enemies.set(enemy.id, enemy);
      });

      this.socket.on('playerDamaged', (data: { 
          playerId: string, 
          health: number,
          maxHealth: number,
          knockbackX: number,
          knockbackY: number 
      }) => {
          console.log('Player damaged event received:', data);
          const player = this.players.get(data.playerId);
          if (player) {
              player.health = data.health;
              player.maxHealth = data.maxHealth;
              player.knockbackX = data.knockbackX;
              player.knockbackY = data.knockbackY;
              
              // Add visual feedback
              this.showFloatingText(
                  player.x,
                  player.y - 20,
                  `-${player.maxHealth - data.health}`,
                  '#FF0000',
                  20
              );
          }
      });

      this.socket.on('enemyDamaged', (data: { enemyId: string, health: number }) => {
          const enemy = this.enemies.get(data.enemyId);
          if (enemy) {
              enemy.health = data.health;
          }
      });

      this.socket.on('enemyDestroyed', (enemyId: string) => {
          this.enemies.delete(enemyId);
      });

      this.socket.on('obstaclesUpdate', (obstacles: Obstacle[]) => {
          this.obstacles = obstacles;
      });

      this.socket.on('obstacleDamaged', (data: { obstacleId: string, health: number }) => {
          const obstacle = this.obstacles.find(o => o.id === data.obstacleId);
          if (obstacle && obstacle.isEnemy) {
              obstacle.health = data.health;
          }
      });

      this.socket.on('obstacleDestroyed', (obstacleId: string) => {
          const index = this.obstacles.findIndex(o => o.id === obstacleId);
          if (index !== -1) {
              this.obstacles.splice(index, 1);
          }
      });

      this.socket.on('itemsUpdate', (items: Item[]) => {
          this.items = items;
      });

      this.socket.on('itemCollected', (data: { playerId: string, itemId: string }) => {
          const player = this.players.get(data.playerId);
          if (player) {
              this.items = this.items.filter(item => item.id !== data.itemId);
              if (data.playerId === this.socket.id) {
                  // Update inventory display if it's open
                  if (this.isInventoryOpen) {
                      this.updateInventoryDisplay();
                  }
              }
          }
      });

      this.socket.on('inventoryUpdate', (inventory: Item[]) => {
          const player = this.players.get(this.socket?.id || '');
          if (player) {
              player.inventory = inventory;
              // Update inventory display if it's open
              if (this.isInventoryOpen) {
                  this.updateInventoryDisplay();
              }
          }
      });

      this.socket.on('xpGained', (data: { 
          playerId: string; 
          xp: number; 
          totalXp: number; 
          level: number; 
          xpToNextLevel: number;
          maxHealth: number;
          damage: number;
      }) => {
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

      this.socket.on('levelUp', (data: {
          playerId: string;
          level: number;
          maxHealth: number;
          damage: number;
      }) => {
          //console.log('Level up:', data);  // Add logging
          const player = this.players.get(data.playerId);
          if (player) {
              player.level = data.level;
              player.maxHealth = data.maxHealth;
              player.damage = data.damage;
              this.showFloatingText(
                  player.x, 
                  player.y - 30, 
                  'Level Up! Level ' + data.level, 
                  '#FFD700', 
                  24
              );
              this.savePlayerProgress(player);
          }
      });

      this.socket.on('playerLostLevel', (data: {
          playerId: string;
          level: number;
          maxHealth: number;
          damage: number;
          xp: number;
          xpToNextLevel: number;
      }) => {
          //console.log('Player lost level:', data);
          const player = this.players.get(data.playerId);
          if (player) {
              player.level = data.level;
              player.maxHealth = data.maxHealth;
              player.damage = data.damage;
              player.xp = data.xp;
              player.xpToNextLevel = data.xpToNextLevel;
              
              // Show level loss message
              this.showFloatingText(
                  player.x, 
                  player.y - 30, 
                  'Level Lost! Level ' + data.level, 
                  '#FF0000', 
                  24
              );
              
              // Save the new progress
              this.savePlayerProgress(player);
          }
      });

      this.socket.on('playerRespawned', (player: Player) => {
          const existingPlayer = this.players.get(player.id);
          if (existingPlayer) {
              Object.assign(existingPlayer, player);
              if (player.id === this.socket.id) {
                  this.isPlayerDead = false;
                  this.hideDeathScreen();
              }
              // Show respawn message
              this.showFloatingText(
                  player.x,
                  player.y - 50,
                  'Respawned!',
                  '#FFFFFF',
                  20
              );
          }
      });

      this.socket.on('playerDied', (playerId: string) => {
          if (playerId === this.socket.id) {
              this.isPlayerDead = true;
              this.showDeathScreen();
          }
      });

      this.socket.on('decorationsUpdate', (decorations: Array<{
          x: number;
          y: number;
          scale: number;
      }>) => {
          this.decorations = decorations;
      });

      this.socket.on('sandsUpdate', (sands: Array<{
          x: number;
          y: number;
          radius: number;
          rotation: number;
      }>) => {
          this.sands = sands;
      });

      this.socket.on('playerUpdated', (updatedPlayer: Player) => {
          const player = this.players.get(updatedPlayer.id);
          if (player) {
              Object.assign(player, updatedPlayer);
              // Update displays if this is the current player
              if (updatedPlayer.id === this.socket?.id) {
                  if (this.isInventoryOpen) {
                      this.updateInventoryDisplay();
                  }
                  this.updateLoadoutDisplay();  // Always update loadout display
              }
          }
      });

      this.socket.on('speedBoostActive', (playerId: string) => {
          console.log('Speed boost active:', playerId);
          if (playerId === this.socket.id) {
              this.speedBoostActive = true;
              console.log('Speed boost active for client');
          }
      });

      this.socket.on('savePlayerProgress', () => {
          this.showSaveIndicator();
      });

      this.socket.on('chatMessage', (message: { sender: string; content: string; timestamp: number }) => {
          this.addChatMessage(message);
      });

      this.socket.on('chatHistory', (history: Array<{ sender: string; content: string; timestamp: number }>) => {
          history.forEach(message => this.addChatMessage(message));
      });

      this.socket.on('craftingSuccess', (data: { newItem: Item; inventory: Item[] }) => {
          const player = this.players.get(this.socket?.id || '');
          if (player) {
              player.inventory = data.inventory;
              
              this.showFloatingText(
                  this.canvas.width / 2,
                  50,
                  `Successfully crafted ${data.newItem.rarity} ${data.newItem.type}!`,
                  this.ITEM_RARITY_COLORS[data.newItem.rarity || 'common'],
                  24
              );

              this.updateInventoryDisplay();
          }
      });

      this.socket.on('craftingFailed', (message: string) => {
          this.showFloatingText(
              this.canvas.width / 2,
              50,
              message,
              '#FF0000',
              20
          );

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
        this.socket.on('gameStateUpdate', (data: { players: Player[], enemies: any[], items: any[], dots: any[], timestamp: number }) => {
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
                } else {
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
  }

  private setupEventListeners() {
      document.addEventListener('keydown', (event) => {
          // Skip keyboard controls if chat is focused
          if (this.isChatFocused) {
              if (event.key === 'Escape') {
                  this.chatInput?.blur();
              }
              return;
          }
          
          // Add chat toggle
          if (event.key === 'Enter' && !this.isSinglePlayer) {
              this.chatInput?.focus();
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

  private updatePlayerVelocity() {
    const player = this.players.get(this.socket?.id || '');
    if (!player) return;

    if (this.useMouseControls) {
        // Mouse controls
        const dx = this.mouseX - player.x;
        const dy = this.mouseY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {  // Add dead zone to prevent jittering
            // Direct movement (no acceleration/momentum)
            const speed = this.MAX_SPEED * (this.speedBoostActive ? 3 : 1);
            player.velocityX = (dx / distance) * speed;
            player.velocityY = (dy / distance) * speed;
            player.angle = Math.atan2(dy, dx);
        } else {
            // Stop immediately when close to target
            player.velocityX = 0;
            player.velocityY = 0;
        }
    } else {
        // Keyboard controls
        let dx = 0;
        let dy = 0;

        if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('w')) dy -= 1;
        if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('s')) dy += 1;
        if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('a')) dx -= 1;
        if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('d')) dx += 1;

        if (dx !== 0 || dy !== 0) {
            // Normalize diagonal movement
            if (dx !== 0 && dy !== 0) {
                const length = Math.sqrt(dx * dx + dy * dy);
                dx /= length;
                dy /= length;
            }

            // Direct movement (no momentum/mass)
            const speed = this.MAX_SPEED * (this.speedBoostActive ? 3 : 1);
            player.velocityX = dx * speed;
            player.velocityY = dy * speed;
            player.angle = Math.atan2(dy, dx);
        } else {
            // Stop immediately when no keys pressed
            player.velocityX = 0;
            player.velocityY = 0;
        }
    }

    // Don't send here - updatePlayerMovement handles server communication
}

  private updateCamera(player: Player) {
    // Center camera on player
    const targetX = player.x - this.canvas.width / 2;
    const targetY = player.y - this.canvas.height / 2;

    // Clamp camera to world bounds with proper dimensions
    this.cameraX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - this.canvas.width, targetX));
    this.cameraY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - this.canvas.height, targetY));

    // Debug camera position
    if (this.showHitboxes) {
        console.log('Camera Position:', {
            x: this.cameraX,
            y: this.cameraY,
            playerX: player.x,
            playerY: player.y,
            worldWidth: ACTUAL_WORLD_WIDTH,
            worldHeight: ACTUAL_WORLD_HEIGHT
        });
    }
}

  private updatePlayerPosition(player: Player | undefined) {
    if (!player) return;

    // Direct position calculation (no sliding physics)
    let newX = player.x + player.velocityX;
    let newY = player.y + player.velocityY;

    // Apply knockback if it exists (keep knockback for combat)
    if (player.knockbackX) {
        player.knockbackX *= 0.8; // Simpler knockback recovery
        newX += player.knockbackX;
        if (Math.abs(player.knockbackX) < 0.1) player.knockbackX = 0;
    }
    if (player.knockbackY) {
        player.knockbackY *= 0.8; // Simpler knockback recovery
        newY += player.knockbackY;
        if (Math.abs(player.knockbackY) < 0.1) player.knockbackY = 0;
    }

    // Constrain to world bounds
    newX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - PLAYER_SIZE, newX));
    newY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - PLAYER_SIZE, newY));

    // Check wall collisions
    let collision = false;
    for (const element of this.world_map_data) {
        if (isWall(element)) {
            if (
                newX < element.x + element.width &&
                newX + PLAYER_SIZE > element.x &&
                newY < element.y + element.height &&
                newY + PLAYER_SIZE > element.y
            ) {
                collision = true;
                // Calculate push direction
                const centerX = element.x + element.width / 2;
                const centerY = element.y + element.height / 2;
                const dx = player.x - centerX;
                const dy = player.y - centerY;
                const angle = Math.atan2(dy, dx);
                
                // Push player away from wall
                newX = element.x + element.width / 2 + Math.cos(angle) * (element.width / 2 + PLAYER_SIZE);
                newY = element.y + element.height / 2 + Math.sin(angle) * (element.height / 2 + PLAYER_SIZE);
                
                // Stop movement in collision direction
                player.velocityX = 0;
                player.velocityY = 0;
                break;
            }
        }
    }

    // Update player position
    player.x = newX;
    player.y = newY;
}

  private generateDots() {
      for (let i = 0; i < this.DOT_COUNT; i++) {
          this.generateDot();
      }
  }

  private generateDot() {
      const dot: Dot = {
          x: Math.random() * this.WORLD_WIDTH,
          y: Math.random() * this.WORLD_HEIGHT
      };
      this.dots.push(dot);
  }

  private checkDotCollision(player: Player) {
      for (let i = this.dots.length - 1; i >= 0; i--) {
          const dot = this.dots[i];
          const dx = player.x - dot.x;
          const dy = player.y - dot.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < this.DOT_SIZE + 20) {
              this.socket.emit('collectDot', i);
              player.score++;
              this.dots.splice(i, 1);
              this.generateDot();
          }
      }
  }

  private checkEnemyCollision(player: Player) {
      const currentTime = Date.now();
      if (currentTime - this.lastDamageTime < this.DAMAGE_COOLDOWN) {
          return;
      }

      this.enemies.forEach((enemy, enemyId) => {
          const dx = player.x - enemy.x;
          const dy = player.y - enemy.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 40) { // Assuming both player and enemy are 40x40 pixels
              this.lastDamageTime = currentTime;
              this.socket.emit('collision', { enemyId });
          }
      });
  }

  private checkItemCollision(player: Player) {
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

  private handlePlayerMoved(playerData: Player) {
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

  private handleEnemiesUpdate(enemiesData: Enemy[]) {
      // Update enemies in single-player mode
      this.enemies.clear();
      enemiesData.forEach(enemy => this.enemies.set(enemy.id, enemy));
  }

  private gameLoop() {
    // Calculate delta time
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastUpdateTime) / 16.67; // Normalize to ~60 FPS
    this.lastUpdateTime = currentTime;

    // Clear the canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw tiled background
    const pattern = this.ctx.createPattern(this.backgroundImage, 'repeat');
    if (pattern) {
        this.ctx.save();
        // Apply camera transform to background
        this.ctx.translate(-this.cameraX * 0.5, -this.cameraY * 0.5); // Parallax effect
        this.ctx.fillStyle = pattern;
        this.ctx.fillRect(
            this.cameraX * 0.5, 
            this.cameraY * 0.5, 
            this.canvas.width + this.cameraX * 0.5, 
            this.canvas.height + this.cameraY * 0.5
        );
        this.ctx.restore();
    }

    // Get current player and update
    const currentSocketId = this.socket?.id;
    let currentPlayer: Player | undefined = undefined;
    if (currentSocketId) {
        currentPlayer = this.players.get(currentSocketId);
        if (currentPlayer) {
            this.updatePlayerMovement(currentPlayer, deltaTime);
            this.updateCamera(currentPlayer);
        }
    }

    this.ctx.save();
    this.ctx.translate(-this.cameraX, -this.cameraY);

    // Draw world bounds
    this.ctx.strokeStyle = 'black';
    this.ctx.strokeRect(0, 0, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT);

    // Draw zone boundaries
    const zoneWidth = ACTUAL_WORLD_WIDTH / 6;
    const zones = [
        { name: 'Common', color: 'rgba(128, 128, 128, 0.1)' },
        { name: 'Uncommon', color: 'rgba(144, 238, 144, 0.1)' },
        { name: 'Rare', color: 'rgba(0, 0, 255, 0.1)' },
        { name: 'Epic', color: 'rgba(128, 0, 128, 0.1)' },
        { name: 'Legendary', color: 'rgba(255, 165, 0, 0.1)' },
        { name: 'Mythic', color: 'rgba(255, 0, 0, 0.1)' }
    ];

    zones.forEach((zone, index) => {
        const x = index * zoneWidth;
        this.ctx.fillStyle = zone.color;
        this.ctx.fillRect(x, 0, zoneWidth, ACTUAL_WORLD_HEIGHT);
        
        // Draw zone name
        this.ctx.fillStyle = 'black';
        this.ctx.font = '20px Arial';
        this.ctx.fillText(zone.name, x + 10, 30);
    });

    // Draw map elements
    this.drawMap();

    // Draw game objects
    this.drawGameObjects();

    this.ctx.restore();

    // Draw UI elements (after restore)
    this.drawUI();

    requestAnimationFrame(() => this.gameLoop());
}

private updatePlayerMovement(player: Player, deltaTime: number) {
    const currentTime = performance.now();
    
    // Cap delta time to prevent huge jumps but allow faster movement
    const cappedDeltaTime = Math.min(deltaTime, 0.033); // Max 33ms (30fps minimum) - increased from 50ms
    
    // Removed excessive key logging for performance
    
    // Calculate desired velocity based on input
    let targetVelocityX = 0;
    let targetVelocityY = 0;

    if (this.useMouseControls) {
        const dx = this.mouseX - player.x;
        const dy = this.mouseY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            const speed = this.MAX_SPEED * (this.speedBoostActive ? 2 : 1);
            targetVelocityX = (dx / distance) * speed;
            targetVelocityY = (dy / distance) * speed;
            player.angle = Math.atan2(dy, dx);
        }
    } else {
        // Keyboard controls  
        if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('a')) targetVelocityX -= 1;
        if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('d')) targetVelocityX += 1;
        if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('w')) targetVelocityY -= 1;
        if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('s')) targetVelocityY += 1;

        // Normalize diagonal movement
        if (targetVelocityX !== 0 && targetVelocityY !== 0) {
            const length = Math.sqrt(targetVelocityX * targetVelocityX + targetVelocityY * targetVelocityY);
            targetVelocityX /= length;
            targetVelocityY /= length;
        }

        // Apply speed
        const speed = this.MAX_SPEED * (this.speedBoostActive ? 2 : 1);
        targetVelocityX *= speed;
        targetVelocityY *= speed;

        if (targetVelocityX !== 0 || targetVelocityY !== 0) {
            player.angle = Math.atan2(targetVelocityY, targetVelocityX);
        }
    }

    // Direct movement (no interpolation or friction)
    player.velocityX = targetVelocityX;
    player.velocityY = targetVelocityY;

    // Apply movement directly with capped delta time
    const predictedX = player.x + player.velocityX * cappedDeltaTime;
    const predictedY = player.y + player.velocityY * cappedDeltaTime;

    // Check world bounds and collisions
    const [finalX, finalY] = this.checkCollisions(player, predictedX, predictedY);
    player.x = finalX;
    player.y = finalY;

    // Send update to server more frequently for better sync
    if (currentTime - this.lastServerUpdate > 33) { // 30 updates per second
        // Reduced logging for performance
        if (Math.abs(player.velocityX) > 0 || Math.abs(player.velocityY) > 0) {
            console.log(`[CLIENT] Moving: vel(${player.velocityX.toFixed(1)},${player.velocityY.toFixed(1)}) delta:${cappedDeltaTime.toFixed(3)}`);
        }
        this.socket.emit('playerMovement', {
            x: predictedX,
            y: predictedY,
            angle: player.angle,
            velocityX: player.velocityX,
            velocityY: player.velocityY,
            timestamp: currentTime
        });
        this.lastServerUpdate = currentTime;
    }
}

private checkCollisions(player: Player, newX: number, newY: number): [number, number] {
    // World bounds with padding
    const PADDING = PLAYER_SIZE / 2;
    let finalX = Math.max(PADDING, Math.min(ACTUAL_WORLD_WIDTH - PADDING, newX));
    let finalY = Math.max(PADDING, Math.min(ACTUAL_WORLD_HEIGHT - PADDING, newY));

    // Store original position for restoration if needed
    const originalX = player.x;
    const originalY = player.y;
    let isColliding = false;
    let collisionDebugInfo: string[] = [];

    // Debug: Log if player position was clamped by world bounds
    if (newX !== finalX || newY !== finalY) {
        collisionDebugInfo.push(`[CLIENT] World bounds collision: requested(${newX.toFixed(1)}, ${newY.toFixed(1)}) -> clamped(${finalX.toFixed(1)}, ${finalY.toFixed(1)})`);
    }

    // Check wall collisions with improved corner handling
    for (const element of this.world_map_data) {
        // Skip non-wall elements
        if (!isWall(element)) continue;

        const wallX = element.x;
        const wallY = element.y;
        const wallWidth = element.width;
        const wallHeight = element.height;

        // Skip walls with zero or negative dimensions to prevent phantom collisions
        if (wallWidth <= 0 || wallHeight <= 0) {
            collisionDebugInfo.push(`[CLIENT] Skipped zero-sized wall at (${wallX}, ${wallY}) with size (${wallWidth}x${wallHeight})`);
            continue;
        }

        // Add padding to wall collision box
        const WALL_PADDING = 5;
        if (
            finalX - PADDING < wallX + wallWidth + WALL_PADDING &&
            finalX + PADDING > wallX - WALL_PADDING &&
            finalY - PADDING < wallY + wallHeight + WALL_PADDING &&
            finalY + PADDING > wallY - WALL_PADDING
        ) {
            isColliding = true;
            collisionDebugInfo.push(`[CLIENT] Wall collision detected: wall(${wallX}, ${wallY}, ${wallWidth}x${wallHeight}) vs player(${finalX.toFixed(1)}, ${finalY.toFixed(1)})`);

            // Debug: Log collision resolution details
            const closestXBefore = Math.max(wallX, Math.min(wallX + wallWidth, finalX));
            const closestYBefore = Math.max(wallY, Math.min(wallY + wallHeight, finalY));

            // Calculate the closest point on the wall to the player
            const closestX = Math.max(wallX, Math.min(wallX + wallWidth, finalX));
            const closestY = Math.max(wallY, Math.min(wallY + wallHeight, finalY));

            // Calculate vector from closest point to player
            const dx = finalX - closestX;
            const dy = finalY - closestY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < PADDING) {
                // Normalize the vector and push player out
                if (distance > 0) {
                    const newFinalX = closestX + (dx / distance) * (PADDING + 1);
                    const newFinalY = closestY + (dy / distance) * (PADDING + 1);
                    collisionDebugInfo.push(`[CLIENT] Collision resolution: distance=${distance.toFixed(2)}, pushed from (${finalX.toFixed(1)}, ${finalY.toFixed(1)}) to (${newFinalX.toFixed(1)}, ${newFinalY.toFixed(1)})`);
                    finalX = newFinalX;
                    finalY = newFinalY;
                } else {
                    // If distance is 0 (player exactly on wall), push in the direction of movement
                    const moveX = finalX - originalX;
                    const moveY = finalY - originalY;
                    const moveDist = Math.sqrt(moveX * moveX + moveY * moveY);
                    if (moveDist > 0) {
                        const newFinalX = closestX - (moveX / moveDist) * (PADDING + 1);
                        const newFinalY = closestY - (moveY / moveDist) * (PADDING + 1);
                        collisionDebugInfo.push(`[CLIENT] Zero-distance collision: moved from (${finalX.toFixed(1)}, ${finalY.toFixed(1)}) to (${newFinalX.toFixed(1)}, ${newFinalY.toFixed(1)})`);
                        finalX = newFinalX;
                        finalY = newFinalY;
                    }
                }

                // Zero out velocity in collision direction
                const vx = Math.abs(dx) > Math.abs(dy);
                if (vx) {
                    collisionDebugInfo.push(`[CLIENT] Zeroed X velocity (was ${player.velocityX.toFixed(2)})`);
                    player.velocityX = 0;
                } else {
                    collisionDebugInfo.push(`[CLIENT] Zeroed Y velocity (was ${player.velocityY.toFixed(2)})`);
                    player.velocityY = 0;
                }
            }
        }
    }

    // Debug: Log collision information if any occurred and debugging is enabled
    if (this.debugCollision && collisionDebugInfo.length > 0) {
        console.log(`=== COLLISION DEBUG ===`);
        collisionDebugInfo.forEach(info => console.log(info));
        console.log(`Final position: (${finalX.toFixed(1)}, ${finalY.toFixed(1)})`);
        console.log(`=======================`);
    }

    return [finalX, finalY];
}

private drawGameObjects() {
    // Draw only objects that are within the viewport
    const viewport = {
        left: this.cameraX,
        right: this.cameraX + this.canvas.width,
        top: this.cameraY,
        bottom: this.cameraY + this.canvas.height
    };

    // Draw dots
    this.dots.forEach(dot => {
        if (this.isInViewport(dot.x, dot.y, viewport)) {
            this.ctx.fillStyle = 'yellow';
            this.ctx.beginPath();
            this.ctx.arc(dot.x, dot.y, this.DOT_SIZE, 0, Math.PI * 2);
            this.ctx.fill();
        }
    });

    // Draw players
    this.players.forEach(player => {
        if (this.isInViewport(player.x, player.y, viewport)) {
            this.drawPlayer(player);
        }
    });

    // Draw enemies
    this.enemies.forEach(enemy => {
        if (this.isInViewport(enemy.x, enemy.y, viewport)) {
            this.drawEnemy(enemy);
        }
    });

    // Draw items
    this.items.forEach(item => {
        if (this.isInViewport(item.x, item.y, viewport)) {
            this.drawItem(item);
        }
    });
}

private isInViewport(x: number, y: number, viewport: { left: number, right: number, top: number, bottom: number }): boolean {
    return x >= viewport.left - 100 && 
           x <= viewport.right + 100 && 
           y >= viewport.top - 100 && 
           y <= viewport.bottom + 100;
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
    this.items = [];
    this.world_map_data = [];
    this.floatingTexts = [];
    this.decorations = [];
    this.sands = [];
    this.walls = [];

    // Define clear canvas function
    const clearCanvas = () => {
        // Clear the main canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Fill with white background
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Explicitly clear the minimap area
        const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
        const minimapY = this.MINIMAP_PADDING;
        this.ctx.clearRect(
            minimapX - 5,
            minimapY - 5,
            this.MINIMAP_WIDTH + 10,
            this.MINIMAP_HEIGHT + 10
        );
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(
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

  private calculateXPRequirement(level: number): number {
      return Math.floor(this.BASE_XP_REQUIREMENT * Math.pow(this.XP_MULTIPLIER, level - 1));
  }

  // Add the showFloatingText method
  private showFloatingText(x: number, y: number, text: string, color: string, fontSize: number) {
      this.floatingTexts.push({
          x,
          y,
          text,
          color,
          fontSize,
          alpha: 1,
          lifetime: 60 // frames
      });
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

  // Add minimap drawing
  private drawMinimap() {
    const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
    const minimapY = this.MINIMAP_PADDING;
    const minimapScale = {
        x: this.MINIMAP_WIDTH / ACTUAL_WORLD_WIDTH,
        y: this.MINIMAP_HEIGHT / ACTUAL_WORLD_HEIGHT
    };

    // Draw minimap background (white instead of black)
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.fillRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);

    // Draw only walls on minimap
    this.world_map_data.forEach(element => {
        // Only draw walls
        if (element.type === 'wall') {
            const scaledX = minimapX + (element.x * minimapScale.x);
            const scaledY = minimapY + (element.y * minimapScale.y);
            const scaledWidth = element.width * minimapScale.x;
            const scaledHeight = element.height * minimapScale.y;

            this.ctx.fillStyle = '#000000'; // Black for walls
            this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
        }
    });

    // Draw all players on minimap with solid colors
    this.players.forEach(player => {
        this.ctx.fillStyle = player.id === this.socket.id ? '#FF0000' : '#000000'; // Red for current player, black for others
        this.ctx.beginPath();
        this.ctx.arc(
            minimapX + (player.x * minimapScale.x),
            minimapY + (player.y * minimapScale.y),
            4, // Slightly larger dots
            0,
            Math.PI * 2
        );
        this.ctx.fill();
    });

    // Draw viewport rectangle in black
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(
        minimapX + (this.cameraX * minimapScale.x),
        minimapY + (this.cameraY * minimapScale.y),
        (this.canvas.width * minimapScale.x),
        (this.canvas.height * minimapScale.y)
    );

    // Draw border
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
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
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
                      if (t < 1/6) return p + (q - p) * 6 * t;
                      if (t < 1/2) return q;
                      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                      return p;
                  };
                  
                  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                  const p = 2 * l - q;
                  
                  data[i] = hue2rgb(p, q, h + 1/3) * 255;
                  data[i + 1] = hue2rgb(p, q, h) * 255;
                  data[i + 2] = hue2rgb(p, q, h - 1/3) * 255;
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

  // Update the sanitizeHTML method to handle script tags
  private sanitizeHTML(str: string): string {
      // Add 'script' to allowed tags
      const allowedTags = new Set(['b', 'i', 'u', 'strong', 'em', 'span', 'color', 'blink', 'script']);
      const allowedAttributes = new Set(['style', 'color']);
      
      // Create a temporary div to parse HTML
      const temp = document.createElement('div');
      temp.innerHTML = str;
      
      // Recursive function to sanitize nodes
      const sanitizeNode = (node: Node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;
              const tagName = element.tagName.toLowerCase();
              
              if (tagName === 'script') {
                  // Generate unique ID for this script
                  const scriptId = 'script_' + Math.random().toString(36).substr(2, 9);
                  
                  // Store the script content
                  this.pendingScripts.set(scriptId, {
                      id: scriptId,
                      code: element.textContent || '',
                      sender: 'Unknown' // Will be set properly in addChatMessage
                  });
                  
                  // Replace script with a warning button
                  const warningBtn = document.createElement('button');
                  warningBtn.className = 'script-warning';
                  warningBtn.setAttribute('data-script-id', scriptId);
                  warningBtn.style.cssText = `
                      background: rgba(255, 165, 0, 0.2);
                      border: 1px solid orange;
                      color: white;
                      padding: 2px 5px;
                      border-radius: 3px;
                      cursor: pointer;
                      font-size: 12px;
                      margin: 0 5px;
                  `;
                  warningBtn.textContent = '⚠️ Click to run script';
                  
                  // Replace the script node with our warning button
                  node.parentNode?.replaceChild(warningBtn, node);
                  return;
              }
              
              // Remove node if tag is not allowed
              if (!allowedTags.has(tagName)) {
                  node.parentNode?.removeChild(node);
                  return;
              }
              
              // Add blinking animation for blink tag
              if (tagName === 'blink') {
                  element.style.animation = 'blink 1s step-start infinite';
              }
              
              // Remove disallowed attributes
              Array.from(element.attributes).forEach(attr => {
                  if (!allowedAttributes.has(attr.name.toLowerCase())) {
                      element.removeAttribute(attr.name);
                  }
              });
              
              // Sanitize style attribute
              const style = element.getAttribute('style');
              if (style) {
                  // Allow color and animation styles
                  const safeStyle = style.split(';')
                      .filter(s => {
                          const prop = s.trim().toLowerCase();
                          return prop.startsWith('color:') || prop.startsWith('animation:');
                      })
                      .join(';');
                  if (safeStyle) {
                      element.setAttribute('style', safeStyle);
                  } else {
                      element.removeAttribute('style');
                  }
              }
              
              // Recursively sanitize child nodes
              Array.from(node.childNodes).forEach(sanitizeNode);
          }
      };
      
      // Sanitize all nodes
      Array.from(temp.childNodes).forEach(sanitizeNode);
      
      return temp.innerHTML;
  }

  // Add method to create sandbox and run script
  private createSandbox(script: SandboxedScript): void {
      // Create modal for confirmation
      const modal = document.createElement('div');
      modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.9);
          padding: 20px;
          border-radius: 5px;
          border: 1px solid orange;
          color: white;
          z-index: 2000;
          font-family: Arial, sans-serif;
          max-width: 80%;
      `;

      const content = document.createElement('div');
      content.innerHTML = `
          <h3 style="color: orange;">⚠️ Warning: Script Execution</h3>
          <p>Script from user: ${script.sender}</p>
          <pre style="
              background: rgba(255, 255, 255, 0.1);
              padding: 10px;
              border-radius: 3px;
              max-height: 200px;
              overflow-y: auto;
              white-space: pre-wrap;
          ">${script.code}</pre>
          <p style="color: orange;">This script will run in a sandboxed environment with limited capabilities.</p>
      `;

      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
          display: flex;
          gap: 10px;
          margin-top: 15px;
          justify-content: center;
      `;

      const runButton = document.createElement('button');
      runButton.textContent = 'Run Script';
      runButton.style.cssText = `
          background: orange;
          color: black;
          border: none;
          padding: 5px 15px;
          border-radius: 3px;
          cursor: pointer;
      `;

      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'Cancel';
      cancelButton.style.cssText = `
          background: #666;
          color: white;
          border: none;
          padding: 5px 15px;
          border-radius: 3px;
          cursor: pointer;
      `;

      buttonContainer.appendChild(cancelButton);
      buttonContainer.appendChild(runButton);
      modal.appendChild(content);
      modal.appendChild(buttonContainer);
      document.body.appendChild(modal);

      // Handle button clicks
      cancelButton.onclick = () => {
          document.body.removeChild(modal);
      };

      runButton.onclick = () => {
          try {
              // Create sandbox iframe
              const sandbox = document.createElement('iframe');
              sandbox.style.display = 'none';
              document.body.appendChild(sandbox);

              // Create restricted context
              const restrictedWindow = sandbox.contentWindow as SandboxWindow;
              if (restrictedWindow) {
                  // Define allowed APIs
                  const safeContext = {
                      console: {
                          log: (...args: any[]) => {
                              this.addChatMessage({
                                  sender: 'Script Output',
                                  content: args.join(' '),
                                  timestamp: Date.now()
                              });
                          }
                      },
                      alert: (msg: string) => {
                          this.addChatMessage({
                              sender: 'Script Alert',
                              content: msg,
                              timestamp: Date.now()
                          });
                      },
                      // Add more safe APIs as needed
                  };

                  // Run the script in sandbox using Function constructor instead of eval
                  const wrappedCode = `
                      try {
                          const runScript = new Function('safeContext', 'with (safeContext) { ${script.code} }');
                          runScript(${JSON.stringify(safeContext)});
                      } catch (error) {
                          console.log('Script Error:', error.message);
                      }
                  `;

                  // Use Function constructor instead of direct eval
                  const scriptRunner = new Function('safeContext', wrappedCode);
                  scriptRunner(safeContext);
              }

              // Cleanup
              document.body.removeChild(sandbox);
              document.body.removeChild(modal);
          } catch (error) {
              this.addChatMessage({
                  sender: 'Script Error',
                  content: `Failed to execute script: ${error}`,
                  timestamp: Date.now()
              });
              document.body.removeChild(modal);
          }
      };
  }

  // Update addChatMessage to handle script buttons
  private addChatMessage(message: { sender: string; content: string; timestamp: number }) {
      if (!this.chatMessages) return;
      
      const messageElement = document.createElement('div');
      messageElement.className = 'chat-message';
      messageElement.style.cssText = `
          margin: 2px 0;
          font-size: 14px;
          word-wrap: break-word;
          font-family: Arial, sans-serif;
      `;
      
      const time = new Date(message.timestamp).toLocaleTimeString();
      
      // Update pending scripts with sender information
      const sanitizedContent = this.sanitizeHTML(message.content);
      this.pendingScripts.forEach(script => {
          script.sender = message.sender;
      });
      
      messageElement.innerHTML = `
          <span class="chat-time" style="color: rgba(255, 255, 255, 0.6);">[${time}]</span>
          <span class="chat-sender" style="color: #00ff00;">${message.sender}:</span>
          <span style="color: white;">${sanitizedContent}</span>
      `;
      
      // Add click handlers for script buttons
      messageElement.querySelectorAll('.script-warning').forEach(button => {
          button.addEventListener('click', () => {
              const scriptId = (button as HTMLElement).getAttribute('data-script-id');
              if (scriptId) {
                  const script = this.pendingScripts.get(scriptId);
                  if (script) {
                      this.createSandbox(script);
                      this.pendingScripts.delete(scriptId);
                  }
              }
          });
      });
      
      this.chatMessages.appendChild(messageElement);
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      
      while (this.chatMessages.children.length > 100) {
          this.chatMessages.removeChild(this.chatMessages.firstChild!);
      }
  }

  // Update the help message in initializeChat
  private initializeChat() {
      // Add blink animation style to document
      const style = document.createElement('style');
      style.textContent = `
          @keyframes blink {
              50% { opacity: 0; }
          }
      `;
      document.head.appendChild(style);

      // Create chat container with updated styling
      this.chatContainer = document.createElement('div');
      this.chatContainer.className = 'chat-container';
      this.chatContainer.style.cssText = `
          position: fixed;
          bottom: 10px;
          left: 10px;
          width: 300px;
          height: 200px;
          background: transparent;
          display: flex;
          flex-direction: column;
          z-index: 1000;
          font-family: Arial, sans-serif;
      `;
      
      // Create messages container with transparent background
      this.chatMessages = document.createElement('div');
      this.chatMessages.className = 'chat-messages';
      this.chatMessages.style.cssText = `
          flex-grow: 1;
          overflow-y: auto;
          padding: 5px;
          color: white;
          text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
          background: transparent;
          font-family: Arial, sans-serif;
      `;
      
      // Create input container
      const inputContainer = document.createElement('div');
      inputContainer.className = 'chat-input-container';
      inputContainer.style.cssText = `
          padding: 5px;
          background: transparent;
          font-family: Arial, sans-serif;
      `;
      
      // Create input field with semi-transparent background
      this.chatInput = document.createElement('input');
      this.chatInput.type = 'text';
      this.chatInput.placeholder = 'Press Enter to chat...';
      this.chatInput.className = 'chat-input';
      this.chatInput.style.cssText = `
          width: 100%;
          padding: 5px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 3px;
          background: rgba(0, 0, 0, 0.3);
          color: white;
          outline: none;
          font-family: Arial, sans-serif;
      `;
      
      // Add event listeners
      this.chatInput.addEventListener('focus', () => {
          this.isChatFocused = true;
          // Make input background slightly more opaque when focused
          this.chatInput!.style.background = 'rgba(0, 0, 0, 0.5)';
      });
      
      this.chatInput.addEventListener('blur', () => {
          this.isChatFocused = false;
          // Restore original transparency when blurred
          this.chatInput!.style.background = 'rgba(0, 0, 0, 0.3)';
      });
      
      // Update the help message to include blink tag
      this.chatInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && this.chatInput?.value.trim()) {
              if (this.chatInput.value.trim().toLowerCase() === '/help') {
                  this.addChatMessage({
                      sender: 'System',
                      content: `Available HTML tags: 
                          <b>bold</b>, 
                          <i>italic</i>, 
                          <u>underline</u>, 
                          <span style="color: red">colored text</span>,
                          <blink>blinking text</blink>,
                          <script>console.log('Hello!')</script> (sandboxed). 
                          Example: Hello <b>world</b> in <span style="color: #ff0000">red</span> and <blink>blinking</blink>!
                          Script example: <script>alert('Hello from script!');</script>`,
                      timestamp: Date.now()
                  });
                  this.chatInput.value = '';
                  return;
              }
              
              // Send the chat message to the server
              this.socket?.emit('chatMessage', this.chatInput.value.trim());
              this.chatInput.value = '';
          }
      });
      
      // Assemble chat UI
      inputContainer.appendChild(this.chatInput);
      this.chatContainer.appendChild(this.chatMessages);
      this.chatContainer.appendChild(inputContainer);
      document.body.appendChild(this.chatContainer);
      
      // Request chat history
      this.socket.emit('requestChatHistory');
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

  // Example method to render an SVG
  private renderGameElement(elementId: string, svgPath: string) {
      const container = document.getElementById(elementId);
      if (container) {
          this.svgLoader.renderSVG(svgPath, container);
      }
  }

  // Add to class properties
  private async initializeWalls() {
    try {
        // Create a grid-based maze layout
        const GRID_SIZE = 10; // Size of each grid cell
        const GRID_COLS = Math.floor(this.WORLD_WIDTH / (this.WALL_SPACING * GRID_SIZE));
        const GRID_ROWS = Math.floor(this.WORLD_HEIGHT / (this.WALL_SPACING * GRID_SIZE));
        
        // Create maze pattern
        for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
                // Add random walls with 30% probability
                if (Math.random() < 0.3) {
                    const x = col * this.WALL_SPACING * GRID_SIZE;
                    const y = row * this.WALL_SPACING * GRID_SIZE;
                    
                    // Randomly choose horizontal or vertical wall
                    if (Math.random() < 0.5) {
                        // Horizontal wall
                        for (let i = 0; i < GRID_SIZE; i++) {
                            const wall = await this.svgLoader.loadSVG('/src/land.svg');
                            this.walls.push({
                                x: x + (i * this.WALL_SPACING),
                                y: y,
                                element: wall
                            });
                        }
                    } else {
                        // Vertical wall
                        for (let i = 0; i < GRID_SIZE; i++) {
                            const wall = await this.svgLoader.loadSVG('/src/land.svg');
                            this.walls.push({
                                x: x,
                                y: y + (i * this.WALL_SPACING),
                                element: wall
                            });
                        }
                    }
                }
            }
        }

        // Always add boundary walls
        // Top and bottom walls
        for (let x = 0; x < this.WORLD_WIDTH; x += this.WALL_SPACING) {
            const topWall = await this.svgLoader.loadSVG('/src/land.svg');
            const bottomWall = await this.svgLoader.loadSVG('/src/land.svg');
            this.walls.push(
                { x, y: 0, element: topWall },
                { x, y: this.WORLD_HEIGHT - 100, element: bottomWall }
            );
        }

        // Left and right walls
        for (let y = 0; y < this.WORLD_HEIGHT; y += this.WALL_SPACING) {
            const leftWall = await this.svgLoader.loadSVG('/src/land.svg');
            const rightWall = await this.svgLoader.loadSVG('/src/land.svg');
            this.walls.push(
                { x: 0, y, element: leftWall },
                { x: this.WORLD_WIDTH - 100, y, element: rightWall }
            );
        }

        console.log(`Generated ${this.walls.length} walls`);
    } catch (error) {
        console.error('Failed to initialize walls:', error);
    }
}

  // Update the drawWalls method to be more efficient
  private drawWalls() {
    if (!this.ctx) return;

    this.walls.forEach(wall => {
        if (!wall || !wall.element) return;

        // Only draw walls that are within the viewport
        if (
            wall.x + 100 >= this.cameraX && 
            wall.x <= this.cameraX + this.canvas.width &&
            wall.y + 100 >= this.cameraY && 
            wall.y <= this.cameraY + this.canvas.height
        ) {
            try {
                this.ctx.save();
                this.ctx.translate(wall.x - this.cameraX, wall.y - this.cameraY);
                
                // Draw a simple rectangle if SVG fails
                this.ctx.fillStyle = '#666';
                this.ctx.fillRect(0, 0, 100, 100);
                
                this.ctx.restore();
            } catch (error) {
                console.warn('Error drawing wall:', error);
            }
        }
    });
}

  private drawMap() {
      // Draw all map elements
      this.world_map_data.forEach(element => {
          const x = element.x;
          const y = element.y;
          const width = element.width;
          const height = element.height;

          // Only draw elements that are visible in the viewport
          if (
              x + width >= this.cameraX &&
              x <= this.cameraX + this.canvas.width &&
              y + height >= this.cameraY &&
              y <= this.cameraY + this.canvas.height
          ) {
              if (element.type === 'wall') {
                  // Draw wall texture tiled
                  const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                  if (pattern) {
                      this.ctx.save();
                      this.ctx.fillStyle = pattern;
                      this.ctx.fillRect(x, y, width, height);
                      this.ctx.restore();
                  }
              } else {
                  // Draw other elements normally
                  this.ctx.fillStyle = this.MAP_COLORS[element.type];
                  this.ctx.fillRect(x, y, width, height);

                  // Add visual indicators for special elements
                  if (element.type === 'teleporter') {
                      this.drawTeleporter(x, y, width, height);
                  } else if (element.type === 'spawn') {
                      this.drawSpawnPoint(x, y, width, height, element.properties?.spawnType);
                  }
              }

              // Draw debug info if hitboxes are enabled
              if (this.showHitboxes) {
                  this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                  this.ctx.strokeRect(x, y, width, height);
                  this.ctx.fillStyle = 'white';
                  this.ctx.font = '12px Arial';
                  this.ctx.fillText(`${Math.round(x)},${Math.round(y)}`, x, y - 5);
              }
          }
      });
  }

  private drawTeleporter(x: number, y: number, width: number, height: number) {
    // Create a pulsing effect
    const time = Date.now() / 1000;
    const pulseSize = 0.2 * Math.sin(time * 2) + 0.8; // Pulse between 0.6 and 1.0
    
    // Draw outer glow
    const gradient = this.ctx.createRadialGradient(
        x + width/2, y + height/2, 0,
        x + width/2, y + height/2, (width/2) * pulseSize
    );
    gradient.addColorStop(0, 'rgba(0, 183, 255, 0.6)');
    gradient.addColorStop(0.6, 'rgba(0, 106, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 47, 255, 0)');
    
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(x, y, width, height);

    // Draw portal rings
    const numRings = 3;
    this.ctx.lineWidth = 4;
    
    for (let i = 0; i < numRings; i++) {
        const ringSize = ((i + 1) / numRings) * width/2 * pulseSize;
        const opacity = 1 - (i / numRings);
        
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        this.ctx.beginPath();
        this.ctx.ellipse(
            x + width/2,
            y + height/2,
            ringSize,
            ringSize * 0.4,
            0,
            0,
            Math.PI * 2
        );
        this.ctx.stroke();
    }

    // Add some particle effects
    const numParticles = 8;
    const particleTime = time * 3;
    
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    for (let i = 0; i < numParticles; i++) {
        const angle = (i / numParticles) * Math.PI * 2 + particleTime;
        const particleX = x + width/2 + Math.cos(angle) * width/3 * pulseSize;
        const particleY = y + height/2 + Math.sin(angle) * height/4 * pulseSize;
        
        this.ctx.beginPath();
        this.ctx.arc(particleX, particleY, 3, 0, Math.PI * 2);
        this.ctx.fill();
    }
}

  private drawSpawnPoint(x: number, y: number, width: number, height: number, type?: string) {
      // Draw spawn area indicator
      const color = type ? this.getTierColor(type) : 'rgba(76, 175, 80, 0.3)';
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x, y, width, height);

      // Add spawn point marker
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(x + width/2, y + height/2, Math.min(width, height)/4, 0, Math.PI * 2);
      this.ctx.stroke();

      // Add tier label
      if (type) {
          this.ctx.fillStyle = 'white';
          this.ctx.font = '20px Arial';
          this.ctx.textAlign = 'center';
          this.ctx.fillText(type.toUpperCase(), x + width/2, y + height/2);
      }
  }

  private getTierColor(tier: string): string {
      const colors = {
          common: 'rgba(128, 128, 128, 0.3)',
          uncommon: 'rgba(0, 128, 0, 0.3)',
          rare: 'rgba(0, 0, 255, 0.3)',
          epic: 'rgba(128, 0, 128, 0.3)',
          legendary: 'rgba(255, 165, 0, 0.3)',
          mythic: 'rgba(255, 0, 0, 0.3)'
      };
      return colors[tier as keyof typeof colors] || colors.common;
  }

  // Add these methods to the Game class

  private drawUI() {
      // Draw player stats
      const player = this.players.get(this.socket?.id || '');
      if (player) {
          // Draw health bar
          const healthBarWidth = 200;
          const healthBarHeight = 20;
          const healthX = 20;
          const healthY = 20;

          // Health bar background
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          this.ctx.fillRect(healthX, healthY, healthBarWidth, healthBarHeight);

          // Health bar fill
          this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
          this.ctx.fillRect(
              healthX,
              healthY,
              (player.health / player.maxHealth) * healthBarWidth,
              healthBarHeight
          );

          // Health text
          this.ctx.fillStyle = 'white';
          this.ctx.font = '14px Arial';
          this.ctx.fillText(
              `Health: ${Math.round(player.health)}/${player.maxHealth}`,
              healthX + 5,
              healthY + 15
          );

          // Draw XP bar
          const xpBarY = healthY + healthBarHeight + 5;
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          this.ctx.fillRect(healthX, xpBarY, healthBarWidth, healthBarHeight);

          this.ctx.fillStyle = 'rgba(0, 128, 255, 0.7)';
          this.ctx.fillRect(
              healthX,
              xpBarY,
              (player.xp / player.xpToNextLevel) * healthBarWidth,
              healthBarHeight
          );

          this.ctx.fillStyle = 'white';
          this.ctx.fillText(
              `Level ${player.level} - XP: ${player.xp}/${player.xpToNextLevel}`,
              healthX + 5,
              xpBarY + 15
          );
      }

      // Draw minimap
      this.drawMinimap();

      // Draw floating texts
      this.drawFloatingTexts();
  }
  private s(size: number): number {
    return 1 * size;
  }
  private drawFlower(center: {x: number, y: number}, eye: {x: number, y: number}) {
    this.ctx.lineCap = "round";
    this.ctx.lineWidth = this.s(1.7);
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, this.s(26.5), 0, Math.PI*2, false);
    this.ctx.fillStyle = "#CFBB50";
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, this.s(23.5), 0, Math.PI*2, false);
    this.ctx.fillStyle = "#FFE763";
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.beginPath();
    this.ctx.moveTo(center.x-this.s(6), center.y+this.s(10));
    this.ctx.quadraticCurveTo(center.x, center.y+this.s(14.5), center.x+this.s(6), center.y+this.s(10));
    this.ctx.strokeStyle = "#000";
    this.ctx.fillStyle = "#000";
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.ellipse(center.x+this.s(7), center.y-this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI*2, false);
    this.ctx.ellipse(center.x-this.s(7), center.y-this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI*2, false);
    this.ctx.fill();
    this.ctx.clip();
    this.ctx.beginPath();
    this.ctx.fillStyle = "#fff";
    this.ctx.arc(center.x+this.s(7)+eye.x, center.y+eye.y-this.s(4.8), this.s(3), 0, Math.PI*2, false);
    this.ctx.arc(center.x-this.s(7)+eye.x, center.y+eye.y-this.s(4.8), this.s(3), 0, Math.PI*2, false);
    this.ctx.fill();
    this.ctx.lineWidth = this.s(1);
    this.ctx.beginPath();
    this.ctx.ellipse(center.x+this.s(7), center.y-this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI*2, false);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.ellipse(center.x-this.s(7), center.y-this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI*2, false);
    this.ctx.stroke();
}

  private rotateEye(angle: number, eye: {x: number, y: number}) {
    return {
      x: (Math.sin(angle) * this.s(2) - eye.x),
      y: (Math.cos(angle) * this.s(-4.4) - eye.y)
    };
  }
  private drawPlayer(player: Player) {
      this.ctx.save();
      this.ctx.translate(player.x, player.y);

      // Draw player sprite
      if (player.id === this.socket?.id) {
          // Apply hue rotation for current player
          const offscreen = document.createElement('canvas');
          offscreen.width = this.playerSprite.width;
          offscreen.height = this.playerSprite.height;
          const offCtx = offscreen.getContext('2d')!;
          
          offCtx.drawImage(this.playerSprite, 0, 0);
          const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
          this.applyHueRotation(offCtx, imageData);
          offCtx.putImageData(imageData, 0, 0);
          
          this.drawFlower(this.playerSprite, this.rotateEye(player.angle, this.playerEye));
      } else {
          this.drawFlower(this.playerSprite, this.rotateEye(player.angle, this.playerEye));
      }
      this.playerEye = this.rotateEye(player.angle, this.playerEye);

      // Draw hitbox if enabled
      if (this.showHitboxes) {
          this.ctx.strokeStyle = 'red';
          this.ctx.strokeRect(-20, -20, 40, 40);
      }

      // Draw player name
      this.ctx.fillStyle = 'white';
      this.ctx.textAlign = 'center';
      this.ctx.font = '14px Arial';
      this.ctx.fillText(player.name || 'Anonymous', 0, -30);

      this.ctx.restore();
  }

  private drawEnemy(enemy: Enemy) {
    const sizeMultiplier = this.ENEMY_SIZE_MULTIPLIERS[enemy.tier];
    const enemySize = 40 * sizeMultiplier;

    this.ctx.save();
    this.ctx.translate(enemy.x, enemy.y);
    this.ctx.rotate(enemy.angle);

    // Draw enemy sprite based on type
    const sprite = enemy.type === 'octopus' ? this.octopusSprite : this.fishSprite;
    this.ctx.drawImage(
        sprite,
        -enemySize / 2,
        -enemySize / 2,
        enemySize,
        enemySize
    );

    // Draw hitbox if enabled
    if (this.showHitboxes) {
        this.ctx.strokeStyle = this.ENEMY_COLORS[enemy.tier];
        this.ctx.strokeRect(-enemySize/2, -enemySize/2, enemySize, enemySize);
    }

    // Draw health bar
    const healthBarWidth = enemySize;
    const healthBarHeight = 5;
    const healthBarY = -enemySize/2 - 10;

    this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    this.ctx.fillRect(-healthBarWidth/2, healthBarY, healthBarWidth, healthBarHeight);

    this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
    this.ctx.fillRect(
        -healthBarWidth/2,
        healthBarY,
        (enemy.health / this.ENEMY_MAX_HEALTH[enemy.tier]) * healthBarWidth,
        healthBarHeight
    );

    // Draw enemy tier with tier color
    this.ctx.fillStyle = this.ENEMY_COLORS[enemy.tier];
    this.ctx.textAlign = 'center';
    this.ctx.font = '12px Arial'; // Made text bold for better visibility
    
    // Add black outline to text for better visibility
    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 1;
    this.ctx.strokeText(enemy.tier.toUpperCase(), 0, enemySize/2 + 20);
    
    // Draw the text
    this.ctx.fillText(enemy.tier.toUpperCase(), 0, enemySize/2 + 20);

    this.ctx.restore();
}

  private drawItem(item: Item) {
      const sprite = this.itemSprites[item.type];
      if (!sprite) return;

      // Draw item rarity glow
      if (item.rarity) {
          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.arc(item.x, item.y, 25, 0, Math.PI * 2);
          this.ctx.fillStyle = `${this.ITEM_RARITY_COLORS[item.rarity]}40`;
          this.ctx.fill();
          this.ctx.restore();
      }

      // Draw item sprite
      this.ctx.drawImage(sprite, item.x - 15, item.y - 15, 30, 30);

      // Draw hitbox if enabled
      if (this.showHitboxes) {
          this.ctx.strokeStyle = 'yellow';
          this.ctx.strokeRect(item.x - 15, item.y - 15, 30, 30);
      }
  }

  private drawFloatingTexts() {
      this.floatingTexts = this.floatingTexts.filter(text => {
          text.y -= 1;
          text.alpha -= 1 / text.lifetime;
          
          if (text.alpha <= 0) return false;
          
          this.ctx.save();
          this.ctx.globalAlpha = text.alpha;
          this.ctx.fillStyle = text.color;
          this.ctx.font = `${text.fontSize}px Arial`;
          this.ctx.textAlign = 'center';
          this.ctx.fillText(text.text, text.x, text.y);
          this.ctx.restore();
          
          return true;
      });
  }

  private renderMap(mapData: MapElement[]) {
      // Store the map data and render it
      this.world_map_data = mapData; // Assuming WORLD_MAP is mutable or use a separate variable
      this.drawMap();
  }

  private getCurrentPlayerId(): string {
      if (this.isSinglePlayer) {
          const player = this.players.values().next().value;
          return player?.id || '';
      } else {
          return this.socket?.id || '';
      }
  }
}