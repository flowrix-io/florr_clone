/**
 * Title Screen Menu Management
 * Handles all menu-related DOM elements and interactions
 */

import { PETAL_CONFIG, RARITY_LEVELS, PetalStats, getPetalStats, getAllPetalTypes } from './petals';
import { ChangelogManager, CHANGELOG } from './changelog';
import { NotificationsManager } from './notifications';
import { LeaderboardManager } from './leaderboard';
import { invalidateSettingsCache } from './constants';
import { Item } from './item';
import { Player, PlayerInventory } from './player';
import { Chat } from './chat';
import { SkillsManager } from './skills';
import { InventoryManager } from './inventory';
import { ShopManager } from './shop';
import { inventoryToDict, addItem as codecAddItem, removeItem as codecRemoveItem, getItemCount as codecGetItemCount, dictToInventory } from './inventoryCodec';

interface FloatingPetal {
    element: HTMLElement;
    x: number;
    y: number;
    speedX: number;
    rotation: number;
    rotationSpeed: number;
    size: number;
    petalStats: PetalStats;
}

class FloatingPetalManager {
    private petals: FloatingPetal[] = [];
    private container: HTMLElement;
    private animationId: number | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
        this.startAnimation();
    }

    private createPetal(): FloatingPetal {
        const petal = document.createElement('div');
        petal.className = 'floating-petal';
        
        // Get random petal type and rarity from actual petals.ts
        const petalTypes = Object.keys(PETAL_CONFIG);
        const nonAdminPetalTypes = petalTypes.filter(type => 
            !PETAL_CONFIG[type]['common']?.isAdminPetal && 
            !type.endsWith('_egg') // Exclude eggs from title screen
        );
        const petalType = nonAdminPetalTypes.length > 0 ? nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)] : 'basic';
        const rarity = RARITY_LEVELS[Math.floor(Math.random() * RARITY_LEVELS.length)];
        
        // Get petal stats from actual petals.ts
        const petalStats = PETAL_CONFIG[petalType]?.[rarity];
        if (!petalStats) {
            // Fallback to basic common if petal not found
            const fallbackStats = PETAL_CONFIG.basic?.common;
            if (fallbackStats) {
                petal.innerHTML = fallbackStats.image || `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${fallbackStats.color}" stroke="#d9d9d9" stroke-width="2"/></svg>`;
            }
        } else {
            // Use actual petal image from petals.ts
            petal.innerHTML = petalStats.image || `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${petalStats.color}" stroke="#d9d9d9" stroke-width="2"/></svg>`;
        }

        // Random properties - only horizontal movement
        const size = 0.5 + Math.random() * 1.5; // 0.5x to 2x size
        const speedX = 0.5 + Math.random() * 2; // 0.5 to 2.5 pixels per frame (left to right only)
        const rotationSpeed = (Math.random() - 0.5) * 4; // -2 to 2 degrees per frame (rotation around center)

        petal.style.cssText = `
            position: absolute;
            width: ${size * 32}px;
            height: ${size * 32}px;
            pointer-events: none;
            z-index: 100;
            opacity: 1.0;
            transform-origin: center center;
        `;

        return {
            element: petal,
            x: -50, // Start off-screen to the left
            y: Math.random() * window.innerHeight,
            speedX,
            rotation: Math.random() * 360,
            rotationSpeed,
            size,
            petalStats: petalStats || PETAL_CONFIG.basic?.common!
        };
    }


    private updatePetal(petal: FloatingPetal): void {
        petal.x += petal.speedX;
        petal.rotation += petal.rotationSpeed;

        // Apply position and rotation (rotation around center)
        petal.element.style.left = `${petal.x}px`;
        petal.element.style.top = `${petal.y}px`;
        petal.element.style.transform = `rotate(${petal.rotation}deg)`;

        // Remove petals that have moved off-screen
        if (petal.x > window.innerWidth + 50) {
            this.removePetal(petal);
        }
    }

    private removePetal(petal: FloatingPetal): void {
        const index = this.petals.indexOf(petal);
        if (index > -1) {
            this.petals.splice(index, 1);
            this.container.removeChild(petal.element);
        }
    }

    private animate(): void {
        // Update all petals
        this.petals.forEach(petal => this.updatePetal(petal));

        // Spawn new petals occasionally
        if (Math.random() < 0.02) { // 2% chance per frame
            this.spawnPetal();
        }

        this.animationId = requestAnimationFrame(() => this.animate());
    }

    public spawnPetal(): void {
        const petal = this.createPetal();
        this.petals.push(petal);
        this.container.appendChild(petal.element);
    }

    public startAnimation(): void {
        if (this.animationId === null) {
            this.animate();
        }
    }

    public stopAnimation(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    public destroy(): void {
        this.stopAnimation();
        this.petals.forEach(petal => {
            if (petal.element.parentNode) {
                petal.element.parentNode.removeChild(petal.element);
            }
        });
        this.petals = [];
    }
}

export class TitleScreen {
    private authContainer!: HTMLElement;
    private loginForm!: HTMLElement;
    private registerForm!: HTMLElement;
    private gameMenu!: HTMLElement;
    private centerText!: HTMLElement;
    private exitButtonContainer!: HTMLElement;
    private deathScreen!: HTMLElement;
    private loadingScreen!: HTMLElement;
    private landContainer!: HTMLElement;
    private axolotlContainer!: HTMLElement;
    private settingsMenu!: HTMLElement;
    private floatingPetalsContainer!: HTMLElement;
    private floatingPetalManager!: FloatingPetalManager;
    private availableBiomes: string[] = [];
    private backgroundCanvas!: HTMLCanvasElement;
    private backgroundCtx!: CanvasRenderingContext2D;
    private backgroundTexture!: HTMLImageElement;
    private backgroundAnimationId!: number;
    private backgroundTime: number = 0;
    private changelogManager!: ChangelogManager;
    private notificationsManager!: NotificationsManager;
    private leaderboardManager!: LeaderboardManager;
    private titleScreenInventoryManager!: TitleScreenInventoryManager;
    private titleScreenChat: Chat | null = null;
    private titleScreenSkillsManager: SkillsManager | null = null;
    private titleScreenShopManager: ShopManager | null = null;
    private titleScreenMobGallery: InventoryManager | null = null;
    // Canvas-based UI
    private uiCanvas!: HTMLCanvasElement;
    private uiCtx!: CanvasRenderingContext2D;
    private playerName: string = '';
    private isNameInputFocused: boolean = false;
    private hoveredBiomeIndex: number = -1;
    private hoveredStartButton: boolean = false;
    private animationFrameId: number | null = null;
    
    // Auth form state (canvas-based)
    private isConnecting: boolean = true; // Show connecting initially
    private showAuthForm: boolean = false; // Don't show until loadout loads
    private isLoginForm: boolean = true; // true = login, false = register
    private authFocusedField: string | null = null; // 'username', 'password', 'confirmPassword', 'serverIP'
    private authUsername: string = '';
    private authPassword: string = '';
    private authConfirmPassword: string = '';
    private authServerIP: string = window.location.origin;
    private authAdvancedSettingsVisible: boolean = false;
    private hoveredAuthButton: string | null = null; // 'login', 'register', 'guest', 'offline', 'toggleAdvanced', 'showRegister', 'showLogin'

    // FPS/stats tracking for title screen
    private titleFrameCount: number = 0;
    private titleFpsCounter: number = 0;
    private titleFpsUpdateTime: number = performance.now();

    constructor() {
        this.initializeElements();
        this.changelogManager = new ChangelogManager();
        this.notificationsManager = new NotificationsManager();
        this.leaderboardManager = new LeaderboardManager();
        // Make notifications manager globally accessible
        (window as any).notificationsManager = this.notificationsManager;
        
        // Set canvas on managers after canvas is available
        const setupCanvas = (canvas: HTMLCanvasElement) => {
            // Ensure canvas has proper dimensions (not just CSS sizing)
            if (canvas.width === 0 || canvas.height === 0) {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            }
            // Ensure canvas is visible on title screen
            canvas.style.zIndex = '1';
            canvas.style.pointerEvents = 'auto';
            this.changelogManager.setCanvas(canvas);
            this.notificationsManager.setCanvas(canvas);
            this.leaderboardManager.setCanvas(canvas);
        };
        
        const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        if (gameCanvas) {
            setupCanvas(gameCanvas);
        } else {
            // Wait for canvas to be ready
            const checkCanvas = setInterval(() => {
                const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
                if (canvas) {
                    setupCanvas(canvas);
                    clearInterval(checkCanvas);
                }
            }, 100);
        }
        
        this.setupEventListeners();
        this.titleScreenInventoryManager = new TitleScreenInventoryManager();
        
        // Initialize chat and skills when socket is available
        this.initializeTitleScreenChat();
        this.initializeTitleScreenSkills();
        this.initializeTitleScreenShop();
        this.initializeTitleScreenMobGallery();
        
        // Biome selector is populated when server sends mapData
    }

    /**
     * Scans map data for available biomes and updates the biome selector
     */
    public updateBiomesFromMapData(mapData: any[]): void {
        // Extract unique biome names from map data
        const biomeNames = new Set<string>();
        
        // Add default biome
        biomeNames.add('default');
        
        // Scan map data for biome elements
        if (mapData && Array.isArray(mapData)) {
            console.log('Scanning map data for biomes, total elements:', mapData.length);
            mapData.forEach(element => {
                if (element.type === 'biome' && element.properties?.biomeName && element.properties.biomeName !== 'garden') {
                    console.log('Found biome:', element.properties.biomeName);
                    biomeNames.add(element.properties.biomeName);
                }
            });
        }
        
        // Update available biomes
        this.availableBiomes = Array.from(biomeNames);
        console.log('Available biomes detected:', this.availableBiomes);
        
        // Update the biome selector UI
        this.updateBiomeSelector();
    }

    /**
     * Updates the biome selector UI with available biomes
     */
    private updateBiomeSelector(): void {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            const biomeButtonsContainer = document.querySelector('.biome-buttons');
            if (!biomeButtonsContainer) {
                console.warn('Biome buttons container not found, retrying...');
                // Retry after a short delay
                setTimeout(() => this.updateBiomeSelector(), 100);
                return;
            }
            
            // Clear existing buttons
            biomeButtonsContainer.innerHTML = '';
            
            // Create biome buttons dynamically
            this.availableBiomes.forEach(biomeName => {
                const button = this.createBiomeButton(biomeName);
                biomeButtonsContainer.appendChild(button);
            });
            
            // Re-setup event listeners for the new buttons
            this.setupBiomeButtonListeners();
            
            console.log('Biome selector updated with biomes:', this.availableBiomes);
        }, 100);
    }

    /**
     * Creates a biome button element
     */
    private createBiomeButton(biomeName: string): HTMLElement {
        const button = document.createElement('button');
        button.className = 'biome-button';
        button.setAttribute('data-biome', biomeName);
        
        // Set biome-specific styling
        const biomeConfig = this.getBiomeConfig(biomeName);
        button.style.backgroundColor = biomeConfig.color;
        button.title = biomeConfig.title;
        button.textContent = biomeConfig.displayName;
        
        return button;
    }

    /**
     * Gets configuration for a biome (colors, display names, etc.)
     */
    private getBiomeConfig(biomeName: string): { color: string; title: string; displayName: string } {
        const configs: { [key: string]: { color: string; title: string; displayName: string } } = {
            'default': {
                color: 'rgb(0, 190, 79)',
                title: 'Default (Common Spawn)',
                displayName: 'Default'
            },
            'desert': {
                color: '#ffff9c',
                title: 'Desert',
                displayName: 'Desert'
            },
            'ocean': {
                color: 'rgb(200,255,250)',
                title: 'Ocean',
                displayName: 'Ocean'
            },
            'hel': {
                color: 'rgb(255, 0, 0)',
                title: 'Hel',
                displayName: 'Hel'
            },
            'ant_hell': {
                color: '#c9904f',
                title: 'Ant Hell',
                displayName: 'Ant Hell'
            },
            'jungle': {
                color: 'rgb(0, 255, 0)',
                title: 'Jungle',
                displayName: 'Jungle'
            }
        };
        
        // Return config for known biome or create a default one
        return configs[biomeName] || {
            color: '#cccccc',
            title: biomeName.charAt(0).toUpperCase() + biomeName.slice(1),
            displayName: biomeName.charAt(0).toUpperCase() + biomeName.slice(1)
        };
    }

    /**
     * Sets up event listeners for biome buttons
     */
    private setupBiomeButtonListeners(): void {
        const biomeButtons = document.querySelectorAll('.biome-button');
        
        biomeButtons.forEach(button => {
            const biome = button.getAttribute('data-biome');
            
            // Add click handler
            button.addEventListener('click', () => {
                // Remove selected class from all buttons
                biomeButtons.forEach(btn => btn.classList.remove('selected'));
                
                // Add selected class to clicked button
                button.classList.add('selected');
                
                // Save to localStorage
                const selectedBiome = biome || 'default';
                localStorage.setItem('spawnBiome', selectedBiome);
                console.log('Selected spawn biome:', selectedBiome);
                
                // Reload background with new biome
                this.loadBackgroundTexture(selectedBiome);
            });
        });
        
        // Load saved biome selection from localStorage
        const savedBiome = localStorage.getItem('spawnBiome') || 'default';
        biomeButtons.forEach(button => {
            const biome = button.getAttribute('data-biome');
            if (biome === savedBiome) {
                button.classList.add('selected');
            }
        });
    }

    private initializeElements(): void {
        // Create authentication container
        this.authContainer = this.createElement('div', 'auth-container');
        this.authContainer.id = 'authContainer';
        this.authContainer.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 2000;
            background: rgba(0, 0, 0, 0.8);
            padding: 20px;
            border-radius: 10px;
            color: white;
            pointer-events: auto;
        `;
        document.body.style.cssText = `
            background: rgb(0, 0, 0);
        `;
        this.loadingScreen = document.getElementById('loadingScreen') as HTMLElement;
        if (this.loadingScreen) {
            this.loadingScreen.style.cssText = `
                display: none;
            `;
        }

        // Create login form
        this.loginForm = this.createElement('div', 'auth-form');
        this.loginForm.id = 'loginForm';
        this.loginForm.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 15px;
            min-width: 300px;
            `;
        const displayHTTPWarning = location.protocol === 'http:';
        const httpWarning = displayHTTPWarning ? '<h3>WARNING: You are using HTTP. This is not secure. Do not use a shared password with other accounts.</h3>' : '';
        this.loginForm.innerHTML = `
            <h2>Login</h2>
            <div class="register-warning">
                ${httpWarning}
            </div>
            <input type="text" id="loginUsername" placeholder="Username">
            <input type="password" id="loginPassword" placeholder="Password">
            <div class="advanced-settings">
                <button type="button" id="advancedSettingsToggle" class="advanced-toggle">Advanced Settings ▼</button>
                <div id="advancedSettings" class="advanced-settings-content hidden">
                    <div class="server-input">
                        <label for="serverIP-connect">Server IP:</label>
                        <input type="text" id="serverIP-connect" placeholder="Server IP">
                    </div>
                </div>
            </div>
            <button id="loginButton">Login</button>
            <button id="guestButton" style="background-color: #6c757d;">Play As Guest</button>
            <p class="form-switch" id="showRegister">Need an account? Register</p>
        `;

        // Create register form
        this.registerForm = this.createElement('div', 'auth-form hidden');
        this.registerForm.id = 'registerForm';
        this.registerForm.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 15px;
            min-width: 300px;
        `;
        this.registerForm.innerHTML = `
            <h2>Register</h2>
            <br/>
            <div class="register-warning">
                ${httpWarning}
                <h3>Do not use your real name or any personal information as your username.</h3>
            </div>
            <input type="text" id="registerUsername" placeholder="Username">
            <input type="password" id="registerPassword" placeholder="Password">
            <input type="password" id="registerConfirmPassword" placeholder="Confirm Password">
            <div class="advanced-settings">
                <button type="button" id="advancedSettingsToggleRegister" class="advanced-toggle">Advanced Settings ▼</button>
                <div id="advancedSettingsRegister" class="advanced-settings-content hidden">
                    <div class="server-input">
                        <label for="serverIP-single">Server IP:</label>
                        <input type="text" id="serverIP-single" placeholder="Server IP">
                    </div>
                </div>
            </div>
            <button id="registerButton">Register</button>
            <button id="registerOfflineButton">Register Offline</button>
            <p class="form-switch" id="showLogin">Already have an account? Login</p>
        `;
        if (localStorage.getItem('username')) {
            this.loginForm.style.display = 'none';
            this.registerForm.style.display = 'none';
            this.authContainer.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 2000;
                background: transparent;
            `;
            this.authContainer.innerHTML = `
                <h1 style="text-align: center; color: white; -webkit-text-stroke: 2px black;">Logging in...</h1>
            `;
        }

        // Create game menu (keeping for future buttons if needed)
        this.gameMenu = this.createElement('div', '');
        this.gameMenu.id = 'gameMenu';
        this.gameMenu.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 3000;
            text-align: center;
            display: none;
            gap: 10px;
            padding: 15px;
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.7);
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
        `;
        this.gameMenu.innerHTML = `
            <!-- Settings button moved to exit button container -->
        `;

        // Create center text
        this.centerText = this.createElement('div', 'center_text');
        this.centerText.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000;
            text-align: center;
            color: white;
            padding: 20px;
            border-radius: 10px;
            background: transparent;
            box-shadow: none;
        `;
        this.centerText.innerHTML = `
            <p class="title" style="-webkit-text-stroke: 3px black;">florr.io clone</p>
            <div class="name-input-container">
                <input type="text" id="nameInput" class="name-input" placeholder="This flower is called...">
                <button id="multiPlayerButton" class="ready-button">Ready▶︎</button>
            </div>
            <div class="biome-selector-container">
                <label>Spawn Biome:</label>
                <div class="biome-buttons">
                    <!-- Biome buttons will be dynamically generated here -->
                </div>
            </div>
            <!-- <div class="color-picker">
                <label for="hueSlider">Player Color:</label>
                <input type="range" id="hueSlider" min="0" max="360" value="0" class="hue-slider">
                <div id="colorPreview" class="color-preview"></div>
                <button id="updateColorButton" class="color-update-btn">Update Color</button>
            </div> -->
            <div class="controls">
                <p>Controls:</p>
                <br/>
                <p>Arrow keys to move</p>
                <br/>
                <p>Hold space to extend petals</p>
                <br/>
                <p>Press I to open the inventory.</p>
                <br/>
                <p>Press number keys 1-9 to use items.</p>
                <br/>
                <p>Press C to switch between mouse and keyboard controls</p>
                <br/>
                <p>Press R to craft items</p>
            </div>
            <div id="titleScreenLoadoutBar" style="margin-top: 20px; display: flex; gap: 5px; justify-content: center; flex-wrap: wrap; max-width: 600px;">
                <!-- Loadout slots will be added here -->
            </div>
        `;

        this.settingsMenu = this.createElement('div', 'settings-menu hidden');
        this.settingsMenu.id = 'settingsMenu';
        this.settingsMenu.style.position = 'absolute';
        this.settingsMenu.style.top = '52px';
        this.settingsMenu.style.left = '0';
        this.settingsMenu.innerHTML = `
            <div class="settings-menu-content">
                <div class="settings-menu-header">
                    <h2>Settings</h2>
                    <button id="closeSettingsButton">&times;</button>
                </div>
                <div class="settings-menu-tabs">
                    <button class="tab-button active" data-tab="controls">Controls</button>
                    <button class="tab-button" data-tab="graphics">Graphics</button>
                    <button class="tab-button" data-tab="advanced">Advanced</button>
                </div>
                <div class="settings-menu-body">
                    <div id="controls-tab" class="tab-content active">
                        <h3>Controls</h3>
                        <div class="controls-grid">
                            <!-- Controls will be dynamically added here -->
                        </div>
                        <button id="saveControlsButton" class="tab-button">Save Controls</button>
                        <button id="resetControlsButton" class="tab-button">Reset to Default</button>
                    </div>
                    <div id="graphics-tab" class="tab-content">
                        <h3>Graphics</h3>
                        <label>
                            <input type="checkbox" id="showHitboxesCheckbox">
                            Show Hitboxes
                        </label>
                        <br/><br/>
                        <label>
                            <input type="checkbox" id="enableShadersCheckbox">
                            Enable Shaders
                        </label>
                        <br/><br/>
                        <label>
                            <input type="checkbox" id="showStats">
                            Show Performance Stats (FPS, Counters, Memory)
                        </label>
                        <br/><br/>
                        <label>
                            Mob Animation Framerate: <span id="mobFramerateValue">15</span> FPS
                            <input type="range" id="mobFramerateSlider" min="5" max="60" value="15" step="1">
                        </label>
                        <br/><br/>
                        <label>
                            <input type="checkbox" id="highQualityMobs">
                            High Quality Mobs (Pre-render frames per rarity - uses more memory)
                        </label>
                        <br/><br/>
                        <label>
                            <input type="checkbox" id="dynamicSkyboxCheckbox">
                            Dynamic Skybox (Tile wall/biome textures for out of bounds areas)
                        </label>
                        <br/><br/>
                        <label>
                            <input type="checkbox" id="mobDeathAnimationCheckbox">
                            Mob Death Animation
                        </label>
                        <br/><br/>
                        <label>
                            Interpolation: <span id="interpolationValue">0.15</span>
                            <br/>
                            <input type="range" id="interpolationSlider" min="0.05" max="0.5" step="0.05" value="0.15" style="width: 200px;">
                        </label>
                        <br/><br/>
                        <h3>Tutorial</h3>
                        <button id="resetTutorialButton" class="tab-button">Reset Tutorial</button>
                    </div>
                    <div id="advanced-tab" class="tab-content">
                        <h3>Advanced Settings</h3>
                        <div class="server-input">
                            <label for="serverIP-settings">Server IP:</label>
                            <input type="text" class="tab-button" id="serverIP-settings" placeholder="Server IP">
                        </div>
                        <br/><br/>
                        <label>
                            <input type="checkbox" class="tab-button" id="showConsoleLogs">
                            Show Console Logs on Screen
                        </label>
                    </div>
                </div>
            </div>
        `;


        // Create exit button container (now contains settings and exit buttons)
        this.exitButtonContainer = this.createElement('div', '');
        this.exitButtonContainer.id = 'exitButtonContainer';
        this.exitButtonContainer.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 3000;
            display: flex;
            gap: 10px;
        `;
        // Import game icons
        const { GAME_ICONS_NET_ICONS } = require('./game-icons-net-icons');
        const settingsIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'settings')?.value || '';
        const changelogIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'changelog')?.value || '';
        const notificationsIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'notifications')?.value || '';
        const leaderboardIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'leaderboard')?.value || '';
        const exitIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'exit_button')?.value || '';
        // Update the SVG to be 32x32
        const formattedSettingsIcon = settingsIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedChangelogIcon = changelogIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedNotificationsIcon = notificationsIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedLeaderboardIcon = leaderboardIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedExitIcon = exitIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        this.exitButtonContainer.innerHTML = `
            <div id="settingsButton" style="width: 42px; height: 42px; cursor: pointer; background: #b3b3b3; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" title="Settings">
                ${formattedSettingsIcon}
            </div>
            <style>
                @keyframes changelog-shake {
                    0%, 100% { transform: rotate(0deg); }
                    10% { transform: rotate(-12deg); }
                    20% { transform: rotate(12deg); }
                    30% { transform: rotate(-10deg); }
                    40% { transform: rotate(10deg); }
                    50% { transform: rotate(-6deg); }
                    60% { transform: rotate(6deg); }
                    70% { transform: rotate(-2deg); }
                    80% { transform: rotate(0deg); }
                }
                #changelogButton.shake {
                    animation: changelog-shake 0.8s ease-in-out infinite;
                    animation-delay: 0s;
                }
            </style>
            <div id="changelogButton" class="${CHANGELOG.length > parseInt(localStorage.getItem('lastSeenChangelogCount') || '0') ? 'shake' : ''}" style="width: 42px; height: 42px; cursor: pointer; background: #00db3e; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" title="Changelog">
                ${formattedChangelogIcon}
            </div>
            <div id="notificationsButton" style="width: 42px; height: 42px; cursor: pointer; background: #4a90e2; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" title="Notifications">
                ${formattedNotificationsIcon}
            </div>
            <div id="leaderboardButton" style="width: 42px; height: 42px; cursor: pointer; background: #e8a023; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" title="Leaderboard">
                ${formattedLeaderboardIcon}
            </div>
            <div id="exitButton" style="width: 42px; height: 42px; cursor: pointer; background: #ff0000; padding: 5px; border-radius: 5px; display: none; align-items: center; justify-content: center; box-sizing: border-box;" title="Exit to Menu">
                ${formattedExitIcon}
            </div>
        `;

        // Create bottom left buttons container (craft and inventory)
        const bottomLeftButtons = this.createElement('div', '');
        bottomLeftButtons.id = 'bottomLeftButtons';
        bottomLeftButtons.style.cssText = `
            position: absolute;
            bottom: 20px;
            left: 20px;
            z-index: 3000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: auto;
        `;
        const craftIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'craft')?.value || '';
        const inventoryIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'inventory')?.value || '';
        const skillsIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'skills')?.value || '';
        const mobGalleryIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'mob_gallery')?.value || '';
        // Use the star icon for shop
        const shopIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'stars')?.value || '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><text x="16" y="24" font-size="24" text-anchor="middle" fill="#ffd700">⭐</text></svg>';
        // Update SVGs to be 32x32 - craft icon has different attributes than inventory
        const formattedCraftIcon = craftIcon
            .replace('width="512px"', 'width="32"')
            .replace('height="512px"', 'height="32"')
            .replace('fill="#000"', 'fill="#fff"')  // Ensure white fill
            .replace('<svg', '<svg style="pointer-events: none;"');  // Prevent SVG from capturing clicks
        const formattedInventoryIcon = inventoryIcon
            .replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"')
            .replace('<svg', '<svg style="pointer-events: none;"');  // Prevent SVG from capturing clicks
        const formattedSkillsIcon = skillsIcon
            .replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"')
            .replace('<svg', '<svg style="pointer-events: none;"');  // Prevent SVG from capturing clicks
        const formattedMobGalleryIcon = mobGalleryIcon
            .replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"')
            .replace('<svg', '<svg style="pointer-events: none;"');  // Prevent SVG from capturing clicks
        const formattedShopIcon = shopIcon.includes('viewBox') 
            ? shopIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"').replace('<svg', '<svg style="pointer-events: none;"').replace('fill="#fff"', 'fill="#fff"').replace('fill="#ffd700"', 'fill="#fff"')
            : shopIcon.replace('<svg', '<svg style="pointer-events: none;" width="32" height="32"').replace('fill="#ffd700"', 'fill="#fff"');
        
        console.log('Craft icon HTML:', formattedCraftIcon.substring(0, 100));
        console.log('Inventory icon HTML:', formattedInventoryIcon.substring(0, 100));
        // Order: inventory (top), skills, mob gallery, shop, craft (bottom)
        bottomLeftButtons.innerHTML = `
            <div id="inventoryButtonIcon" style="width: 42px; height: 42px; cursor: pointer; background: #00b3ff; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; position: relative; z-index: 5; pointer-events: auto;" title="Inventory (I)">
                ${formattedInventoryIcon}
            </div>
            <div id="skillsButtonIcon" style="width: 42px; height: 42px; cursor: pointer; background: #9d4edd; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; position: relative; z-index: 4; pointer-events: auto;" title="Skills (K)">
                ${formattedSkillsIcon}
            </div>
            <div id="mobGalleryButtonIcon" style="width: 42px; height: 42px; cursor: pointer; background: #d6c206; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; position: relative; z-index: 3; pointer-events: auto;" title="Mob Gallery (G)">
                ${formattedMobGalleryIcon}
            </div>
            <div id="shopButtonIcon" style="width: 42px; height: 42px; cursor: pointer; background: #36d153; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; position: relative; z-index: 2; pointer-events: auto;" title="Shop (B)">
                ${formattedShopIcon}
            </div>
            <div id="craftButtonIcon" style="width: 42px; height: 42px; cursor: pointer; background: #ff9d00; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; position: relative; z-index: 1; pointer-events: auto;" title="Craft (R)">
                ${formattedCraftIcon}
            </div>
        `;
        document.body.appendChild(bottomLeftButtons);

        // Create death screen
        this.deathScreen = this.createElement('div', 'hidden');
        this.deathScreen.id = 'deathScreen';
        this.deathScreen.innerHTML = `
            <div class="death-screen-content">
                <h2>You Died!</h2>
                <p>Your adventure has come to an end...</p>
                <div class="death-screen-buttons">
                    <button id="continueButton" class="continue-button">Continue</button>
                    <button id="closeDeathButton" class="close-button">Close</button>
                </div>
            </div>
        `;

        // Create loading screen
        this.loadingScreen = this.createElement('div', 'hidden');
        this.loadingScreen.id = 'loadingScreen';
        this.loadingScreen.innerHTML = `<p>Loading...</p>`;

        // Create land and axolotl containers
        this.landContainer = this.createElement('div', '');
        this.landContainer.id = 'land-container';

        this.axolotlContainer = this.createElement('div', '');
        this.axolotlContainer.id = 'axolotl-container';

        // Create floating petals container
        this.floatingPetalsContainer = this.createElement('div', '');
        this.floatingPetalsContainer.id = 'floating-petals-container';
        this.floatingPetalsContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 50;
            overflow: hidden;
        `;

        // Create background canvas
        this.backgroundCanvas = document.createElement('canvas');
        this.backgroundCanvas.id = 'title-background-canvas';
        this.backgroundCanvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        `;
        this.backgroundCtx = this.backgroundCanvas.getContext('2d')!;
        this.backgroundTexture = new Image();

        // Create UI canvas for title screen elements
        this.uiCanvas = document.createElement('canvas');
        this.uiCanvas.id = 'title-ui-canvas';
        this.uiCanvas.width = window.innerWidth;
        this.uiCanvas.height = window.innerHeight;
        this.uiCanvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: auto;
            z-index: 1000;
        `;
        this.uiCtx = this.uiCanvas.getContext('2d')!;
        
        // Load saved player name
        const savedName = localStorage.getItem('playerName') || '';
        this.playerName = savedName;
        // Sync to dummy input after a short delay to ensure DOM is ready
        setTimeout(() => this.syncPlayerNameToInput(), 100);
        
        // Initialize auth server IP from localStorage
        const savedServerUrl = localStorage.getItem('serverUrl');
        if (savedServerUrl) {
            this.authServerIP = savedServerUrl;
        }

        // Name input persistence will be handled in setupEventListeners
        
    }

    private createElement(tagName: string, className: string): HTMLElement {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        return element;
    }

    private setupEventListeners(): void {
        // Add keyboard shortcuts for chat and skills on title screen
        document.addEventListener('keydown', (event) => {
            // Don't interfere if game is running
            if (window.currentGame) return;
            
            // Don't interfere if chat is focused
            if (this.titleScreenChat && this.titleScreenChat.isFocused) {
                if (event.key === 'Escape') {
                    this.titleScreenChat.blur();
                }
                return;
            }
            
            const controls = this.getControls();
            
            // Chat shortcut
            if (event.key === (controls.chat || 'Enter')) {
                if (this.titleScreenChat) {
                    this.titleScreenChat.focus();
                }
                event.preventDefault();
                return;
            }
            
            // Skills shortcut
            if (event.key === (controls.skills || 'x')) {
                this.toggleSkillsOnTitleScreen();
                event.preventDefault();
                return;
            }
        });
        
        // Settings button event listener (now in exitButtonContainer)
        const settingsButton = this.exitButtonContainer.querySelector('#settingsButton');
        const changelogButton = this.exitButtonContainer.querySelector('#changelogButton');
        const notificationsButton = this.exitButtonContainer.querySelector('#notificationsButton');
        const leaderboardButton = this.exitButtonContainer.querySelector('#leaderboardButton');
        const exitButton = this.exitButtonContainer.querySelector('#exitButton');
        const closeSettingsButton = this.settingsMenu.querySelector('#closeSettingsButton');

        console.log('Setting up buttons - changelogButton:', !!changelogButton, 'notificationsButton:', !!notificationsButton);

        if (settingsButton) {
            settingsButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.settingsMenu.classList.toggle('hidden');
            });
        }

        if (changelogButton) {
            changelogButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('[CHANGELOG] Button clicked, isOpen before:', this.changelogManager.isChangelogOpen());
                this.changelogManager.toggle();
                console.log('[CHANGELOG] Button clicked, isOpen after:', this.changelogManager.isChangelogOpen());
                const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
                console.log('[CHANGELOG] Canvas exists:', !!gameCanvas, 'Canvas width:', gameCanvas?.width, 'Canvas height:', gameCanvas?.height);
                console.log('[CHANGELOG] Manager canvas:', !!this.changelogManager['canvas'], 'Manager ctx:', !!this.changelogManager['ctx']);
                // Mark changelog as seen and stop shaking
                changelogButton.classList.remove('shake');
                localStorage.setItem('lastSeenChangelogCount', String(CHANGELOG.length));
            });
        } else {
            console.error('[CHANGELOG] Button not found!');
        }

        if (notificationsButton) {
            notificationsButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('[NOTIFICATIONS] Button clicked, isOpen before:', this.notificationsManager.isNotificationsOpen());
                this.notificationsManager.toggle();
                console.log('[NOTIFICATIONS] Button clicked, isOpen after:', this.notificationsManager.isNotificationsOpen());
                const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
                console.log('[NOTIFICATIONS] Canvas exists:', !!gameCanvas, 'Canvas width:', gameCanvas?.width, 'Canvas height:', gameCanvas?.height);
                console.log('[NOTIFICATIONS] Manager canvas:', !!this.notificationsManager['canvas'], 'Manager ctx:', !!this.notificationsManager['ctx']);
            });
            // Set the button reference in notifications manager for badge updates
            this.notificationsManager.setNotificationButton(notificationsButton as HTMLElement);
        } else {
            console.error('[NOTIFICATIONS] Button not found!');
        }

        if (leaderboardButton) {
            leaderboardButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.leaderboardManager.toggle();
            });
        }

        // Exit button is handled by index.ts setupGameEventListeners

        // Craft, Skills, and Inventory button event listeners
        // Using setTimeout to ensure these run after the DOM is fully ready
        setTimeout(() => {
            const craftButtonIcon = document.getElementById('craftButtonIcon');
            const skillsButtonIcon = document.getElementById('skillsButtonIcon');
            const inventoryButtonIcon = document.getElementById('inventoryButtonIcon');

            if (craftButtonIcon) {
                // Remove any existing listeners by cloning
                const newCraftButton = craftButtonIcon.cloneNode(true);
                craftButtonIcon.parentNode?.replaceChild(newCraftButton, craftButtonIcon);
                
                newCraftButton.addEventListener('click', (e) => {
                    console.log('Craft button clicked');
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // Check if game is running
                    if (window.currentGame) {
                        // Get the controls from localStorage or use default
                        const savedControls = localStorage.getItem('controls');
                        const controls = savedControls ? JSON.parse(savedControls) : { crafting: 'c' };
                        const event = new KeyboardEvent('keydown', { key: controls.crafting || 'c', bubbles: true, cancelable: true });
                        document.dispatchEvent(event);
                    } else {
                        // Toggle crafting panel directly on title screen
                        this.toggleCraftingOnTitleScreen();
                    }
                    return false;
                }, true);
            }

            if (skillsButtonIcon) {
                // Remove any existing listeners by cloning
                const newSkillsButton = skillsButtonIcon.cloneNode(true);
                skillsButtonIcon.parentNode?.replaceChild(newSkillsButton, skillsButtonIcon);
                
                newSkillsButton.addEventListener('click', (e) => {
                    console.log('Skills button clicked');
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // Check if game is running
                    if (window.currentGame) {
                        // Get the controls from localStorage or use default
                        // NOTE: default must match game's default ('x'), not 'k',
                        // since 'k' is the default for toggle_mouse_controls.
                        const savedControls = localStorage.getItem('controls');
                        const controls = savedControls ? JSON.parse(savedControls) : { skills: 'x' };
                        const event = new KeyboardEvent('keydown', { key: controls.skills || 'x', bubbles: true, cancelable: true });
                        document.dispatchEvent(event);
                    } else {
                        // Toggle skills panel directly on title screen
                        this.toggleSkillsOnTitleScreen();
                    }
                    return false;
                }, true);
            }

            if (inventoryButtonIcon) {
                // Remove any existing listeners by cloning
                const newInventoryButton = inventoryButtonIcon.cloneNode(true);
                inventoryButtonIcon.parentNode?.replaceChild(newInventoryButton, inventoryButtonIcon);
                
                newInventoryButton.addEventListener('click', (e) => {
                    console.log('Inventory button clicked');
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // Check if game is running
                    if (window.currentGame) {
                        // Get the controls from localStorage or use default
                        const savedControls = localStorage.getItem('controls');
                        const controls = savedControls ? JSON.parse(savedControls) : { inventory: 'z' };
                        const event = new KeyboardEvent('keydown', { key: controls.inventory || 'z', bubbles: true, cancelable: true });
                        document.dispatchEvent(event);
                    } else {
                        // Toggle inventory panel directly on title screen
                        this.toggleInventoryOnTitleScreen();
                    }
                    return false;
                }, true);
            }

            const shopButtonIcon = document.getElementById('shopButtonIcon');
            if (shopButtonIcon) {
                // Remove any existing listeners by cloning
                const newShopButton = shopButtonIcon.cloneNode(true);
                shopButtonIcon.parentNode?.replaceChild(newShopButton, shopButtonIcon);
                
                newShopButton.addEventListener('click', (e) => {
                    console.log('Shop button clicked');
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // Check if game is running
                    if (window.currentGame && window.currentGame.shopManager) {
                        window.currentGame.shopManager.toggleShop();
                    } else if (this.titleScreenShopManager) {
                        this.titleScreenShopManager.toggleShop();
                    } else {
                        console.log('Shop not yet available');
                    }
                    return false;
                }, true);
            }

            const mobGalleryButtonIcon = document.getElementById('mobGalleryButtonIcon');
            if (mobGalleryButtonIcon) {
                // Remove any existing listeners by cloning
                const newMobGalleryButton = mobGalleryButtonIcon.cloneNode(true);
                mobGalleryButtonIcon.parentNode?.replaceChild(newMobGalleryButton, mobGalleryButtonIcon);
                
                newMobGalleryButton.addEventListener('click', (e) => {
                    console.log('Mob Gallery button clicked');
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // Check if game is running
                    if (window.currentGame && window.currentGame.inventoryManager) {
                        window.currentGame.inventoryManager.toggleMobGallery();
                    } else if (this.titleScreenMobGallery) {
                        this.titleScreenMobGallery.toggleMobGallery();
                    } else {
                        console.log('Mob Gallery not yet available');
                    }
                    return false;
                }, true);
            }
        }, 100);

        if (closeSettingsButton) {
            closeSettingsButton.addEventListener('click', () => {
                this.settingsMenu.classList.add('hidden');
            });
        }

        // Click outside to close settings menu
        document.addEventListener('click', (e) => {
            if (!this.settingsMenu.classList.contains('hidden') && 
                !this.settingsMenu.contains(e.target as Node) && 
                !this.exitButtonContainer.querySelector('#settingsButton')?.contains(e.target as Node)) {
                this.settingsMenu.classList.add('hidden');
            }
        });

        this.settingsMenu.querySelectorAll('.tab-button[data-tab]').forEach(button => {
            button.addEventListener('click', () => {
                const tab = button.getAttribute('data-tab');
                this.settingsMenu.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                this.settingsMenu.querySelectorAll('.tab-content').forEach(content => {
                    if (content.id === `${tab}-tab`) {
                        content.classList.add('active');
                    } else {
                        content.classList.remove('active');
                    }
                });
            });
        });

        // Controls settings
        this.populateControlsTab();

        // Death screen continue button event listener
        const continueButton = this.deathScreen.querySelector('#continueButton');
        if (continueButton) {
            continueButton.addEventListener('click', () => {
                // Request respawn through the game instance
                if (window.currentGame) {
                    window.currentGame.requestRespawn();
                }
                this.hideDeathScreen();
            });
        }

        // Death screen close button event listener
        const closeDeathButton = this.deathScreen.querySelector('#closeDeathButton');
        if (closeDeathButton) {
            closeDeathButton.addEventListener('click', () => {
                // Just close the death screen without respawning
                this.hideDeathScreen();
            });
        }
        const saveControlsButton = this.settingsMenu.querySelector('#saveControlsButton');
        if (saveControlsButton) {
            saveControlsButton.addEventListener('click', () => this.saveControls());
        }
        const resetControlsButton = this.settingsMenu.querySelector('#resetControlsButton');
        if (resetControlsButton) {
            resetControlsButton.addEventListener('click', () => this.resetControls());
        }


        // Settings change listeners
        const showHitboxesCheckbox = this.settingsMenu.querySelector('#showHitboxesCheckbox') as HTMLInputElement;
        if (showHitboxesCheckbox) {
            showHitboxesCheckbox.addEventListener('change', () => {
                localStorage.setItem('showHitboxes', showHitboxesCheckbox.checked.toString());
            });
        }

        const enableShadersCheckbox = this.settingsMenu.querySelector('#enableShadersCheckbox') as HTMLInputElement;
        if (enableShadersCheckbox) {
            enableShadersCheckbox.addEventListener('change', () => {
                localStorage.setItem('shadersEnabled', enableShadersCheckbox.checked.toString());
                // Update shader manager if available
                if (window.shaderManager) {
                    window.shaderManager.setShadersEnabled(enableShadersCheckbox.checked);
                }
            });
        }

        const showStatsCheckbox = this.settingsMenu.querySelector('#showStats') as HTMLInputElement;
        if (showStatsCheckbox) {
            showStatsCheckbox.addEventListener('change', () => {
                localStorage.setItem('showStats', showStatsCheckbox.checked.toString());
            });
        }

        const mobFramerateSlider = this.settingsMenu.querySelector('#mobFramerateSlider') as HTMLInputElement;
        const mobFramerateValue = this.settingsMenu.querySelector('#mobFramerateValue') as HTMLElement;
        if (mobFramerateSlider && mobFramerateValue) {
            mobFramerateSlider.addEventListener('input', () => {
                const framerate = parseInt(mobFramerateSlider.value, 10);
                mobFramerateValue.textContent = framerate.toString();
                localStorage.setItem('mobAnimationFramerate', framerate.toString());
                invalidateSettingsCache();
            });
        }

        const highQualityMobsCheckbox = this.settingsMenu.querySelector('#highQualityMobs') as HTMLInputElement;
        if (highQualityMobsCheckbox) {
            highQualityMobsCheckbox.addEventListener('change', () => {
                localStorage.setItem('highQualityMobs', highQualityMobsCheckbox.checked.toString());
                invalidateSettingsCache();
            });
        }

        const dynamicSkyboxCheckbox = this.settingsMenu.querySelector('#dynamicSkyboxCheckbox') as HTMLInputElement;
        if (dynamicSkyboxCheckbox) {
            dynamicSkyboxCheckbox.addEventListener('change', () => {
                localStorage.setItem('dynamicSkybox', dynamicSkyboxCheckbox.checked.toString());
                // Update graphics if game is running
                if (window.currentGame && window.currentGame.graphics) {
                    window.currentGame.graphics.dynamicSkybox = dynamicSkyboxCheckbox.checked;
                }
            });
        }

        const mobDeathAnimationCheckbox = this.settingsMenu.querySelector('#mobDeathAnimationCheckbox') as HTMLInputElement;
        if (mobDeathAnimationCheckbox) {
            mobDeathAnimationCheckbox.addEventListener('change', () => {
                localStorage.setItem('mobDeathAnimation', mobDeathAnimationCheckbox.checked.toString());
                // Update game if running
                if (window.currentGame) {
                    window.currentGame.mobDeathAnimation = mobDeathAnimationCheckbox.checked;
                }
            });
        }

        const interpolationSlider = this.settingsMenu.querySelector('#interpolationSlider') as HTMLInputElement;
        const interpolationValue = this.settingsMenu.querySelector('#interpolationValue') as HTMLSpanElement;
        if (interpolationSlider) {
            const saved = localStorage.getItem('interpolationAmount');
            if (saved) {
                interpolationSlider.value = saved;
                if (interpolationValue) interpolationValue.textContent = saved;
            }
            interpolationSlider.addEventListener('input', () => {
                const val = interpolationSlider.value;
                if (interpolationValue) interpolationValue.textContent = val;
                localStorage.setItem('interpolationAmount', val);
                if (window.currentGame) {
                    window.currentGame.interpolationAmount = parseFloat(val);
                }
            });
        }

        const showConsoleLogsCheckbox = this.settingsMenu.querySelector('#showConsoleLogs') as HTMLInputElement;
        if (showConsoleLogsCheckbox) {
            showConsoleLogsCheckbox.addEventListener('change', () => {
                localStorage.setItem('showConsoleLogs', showConsoleLogsCheckbox.checked.toString());
                if (window.currentGame && window.currentGame.graphics) {
                    window.currentGame.graphics.setShowConsoleLogs(showConsoleLogsCheckbox.checked);
                }
            });
        }

        // Reset tutorial button
        const resetTutorialButton = this.settingsMenu.querySelector('#resetTutorialButton');
        if (resetTutorialButton) {
            resetTutorialButton.addEventListener('click', () => {
                if (confirm('This will restart the tutorial on your next game. Continue?')) {
                    localStorage.removeItem('tutorial_completed');
                    localStorage.removeItem('tutorial_step');
                    alert('Tutorial will restart on your next game!');
                }
            });
        }

        const serverIPInput = this.settingsMenu.querySelector('#serverIP-settings') as HTMLInputElement;
        if (serverIPInput) {
            serverIPInput.addEventListener('input', () => {
                localStorage.setItem('serverIP', serverIPInput.value);
            });
            serverIPInput.value = localStorage.getItem('serverIP') || window.location.origin;
        }


        // Form switching
        const showRegister = this.loginForm.querySelector('#showRegister');
        const showLogin = this.registerForm.querySelector('#showLogin');
        
        if (showRegister) {
            showRegister.addEventListener('click', () => {
                this.showRegisterForm();
            });
        }
        
        if (showLogin) {
            showLogin.addEventListener('click', () => {
                this.showLoginForm();
            });
        }

        // Setup name input persistence
        this.setupNameInputPersistence();
    }

    public async appendToBody(): Promise<void> {
        document.body.appendChild(this.backgroundCanvas);
        document.body.appendChild(this.uiCanvas);
        // Hide DOM-based auth container since we're using canvas
        this.authContainer.style.display = 'none';
        document.body.appendChild(this.authContainer);
        this.authContainer.appendChild(this.loginForm);
        this.authContainer.appendChild(this.registerForm);
        document.body.appendChild(this.gameMenu);
        document.body.appendChild(this.centerText);
        document.body.appendChild(this.exitButtonContainer);
        document.body.appendChild(this.deathScreen);
        document.body.appendChild(this.loadingScreen);
        document.body.appendChild(this.landContainer);
        document.body.appendChild(this.axolotlContainer);
        document.body.appendChild(this.floatingPetalsContainer);
        // Append settings menu to exitButtonContainer for proper positioning
        this.exitButtonContainer.appendChild(this.settingsMenu);

        // Initialize floating petals manager
        this.floatingPetalManager = new FloatingPetalManager(this.floatingPetalsContainer);

        // Load and start background animation
        await this.loadBackgroundTexture();
        this.startBackgroundAnimation();

        // Hide HTML centerText and use canvas instead
        this.centerText.style.display = 'none';
        
        // Move loadout bar out of centerText and make it visible (only if auth form is not shown)
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            const loadoutBar = document.getElementById('titleScreenLoadoutBar');
            if (loadoutBar) {
                // Remove from centerText if it's a child and append to body
                if (loadoutBar.parentNode === this.centerText || loadoutBar.parentNode === null) {
                    document.body.appendChild(loadoutBar);
                }
                // Position it (above instructions)
                loadoutBar.style.position = 'absolute';
                loadoutBar.style.top = '50%';
                loadoutBar.style.left = '50%';
                loadoutBar.style.transform = 'translate(-50%, 0)';
                loadoutBar.style.marginTop = '50px'; // Position above instructions (controls text is at +150px)
                loadoutBar.style.zIndex = '1001'; // Above canvas
                loadoutBar.style.pointerEvents = 'auto';
                loadoutBar.style.gap = '8px'; // Larger gap between slots
                loadoutBar.style.justifyContent = 'center';
                loadoutBar.style.flexWrap = 'wrap';
                loadoutBar.style.maxWidth = '800px'; // Wider to accommodate larger slots
                // Hide if auth form is shown
                loadoutBar.style.display = this.showAuthForm ? 'none' : 'flex';
            }
        }, 100);

        // Setup canvas UI event listeners
        this.setupCanvasUIListeners();

        // Start canvas rendering loop
        this.startCanvasRendering();
        
        // If user is not logged in, show login form after a short delay
        // (in case preconnectToServer is not called)
        setTimeout(() => {
            if (this.isConnecting) {
                const username = localStorage.getItem('username');
                const password = localStorage.getItem('password');
                if (!username || !password) {
                    // User is not logged in and no connection attempt, show login form
                    this.onLoadoutLoaded();
                }
            }
        }, 2000); // Wait 2 seconds for connection attempt

        // Add CSS for advanced settings
        this.addAdvancedSettingsStyles();
        
        // Debug: Check if forms are in DOM
        console.log('Login form in DOM:', document.getElementById('loginForm'));
        console.log('Register form in DOM:', document.getElementById('registerForm'));
        console.log('Advanced settings toggle in DOM:', document.getElementById('advancedSettingsToggle'));
        console.log('Advanced settings toggle register in DOM:', document.getElementById('advancedSettingsToggleRegister'));
        console.log('Login form innerHTML:', this.loginForm.innerHTML);
        
        // Setup advanced settings toggle functionality
        this.setupAdvancedSettingsToggle();
        this.loadSettings();
    }

    private populateControlsTab(): void {
        const controlsGrid = this.settingsMenu.querySelector('.controls-grid');
        if (!controlsGrid) return;

        const controls = this.getControls();

        controlsGrid.innerHTML = '';
        for (const action in controls) {
            const controlRow = document.createElement('div');
            controlRow.className = 'control-row';
            controlRow.innerHTML = `
                <label>${action.replace(/_/g, ' ')}</label>
                <input type="text" class="control-input" data-action="${action}" value="${controls[action]}">
            `;
            controlsGrid.appendChild(controlRow);
        }

        controlsGrid.querySelectorAll('.control-input').forEach(input => {
            input.addEventListener('keydown', (e: any) => {
                e.preventDefault();
                (input as HTMLInputElement).value = e.key;
            });
        });
    }

    private getControls(): { [key: string]: string } {
        const savedControls = localStorage.getItem('controls');
        if (savedControls) {
            return { ...this.getDefaultControls(), ...JSON.parse(savedControls) };
        }
        return this.getDefaultControls();
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
        };
    }

    private saveControls(): void {
        const controls: { [key: string]: string } = {};
        this.settingsMenu.querySelectorAll('.control-input').forEach(input => {
            const action = input.getAttribute('data-action');
            if (action) {
                controls[action] = (input as HTMLInputElement).value;
            }
        });
        localStorage.setItem('controls', JSON.stringify(controls));
        alert('Controls saved!');
    }

    private resetControls(): void {
        localStorage.removeItem('controls');
        this.populateControlsTab();
        alert('Controls have been reset to default.');
    }

    private loadSettings(): void {
        const showHitboxes = localStorage.getItem('showHitboxes') === 'true';
        const showHitboxesCheckbox = this.settingsMenu.querySelector('#showHitboxesCheckbox') as HTMLInputElement;
        if (showHitboxesCheckbox) {
            showHitboxesCheckbox.checked = showHitboxes;
        }

        const shadersEnabled = localStorage.getItem('shadersEnabled') === 'true';
        const enableShadersCheckbox = this.settingsMenu.querySelector('#enableShadersCheckbox') as HTMLInputElement;
        if (enableShadersCheckbox) {
            enableShadersCheckbox.checked = shadersEnabled;
        }

        const showStats = localStorage.getItem('showStats') === 'true';
        const showStatsCheckbox = this.settingsMenu.querySelector('#showStats') as HTMLInputElement;
        if (showStatsCheckbox) {
            showStatsCheckbox.checked = showStats;
        }

        const serverIP = localStorage.getItem('serverIP') || window.location.origin;
        const serverIPInput = this.settingsMenu.querySelector('#serverIP-settings') as HTMLInputElement;
        if (serverIPInput) {
            serverIPInput.value = serverIP;
        }

        const mobFramerate = parseInt(localStorage.getItem('mobAnimationFramerate') || '15', 10);
        const mobFramerateSlider = this.settingsMenu.querySelector('#mobFramerateSlider') as HTMLInputElement;
        const mobFramerateValue = this.settingsMenu.querySelector('#mobFramerateValue') as HTMLElement;
        if (mobFramerateSlider) {
            mobFramerateSlider.value = mobFramerate.toString();
        }
        if (mobFramerateValue) {
            mobFramerateValue.textContent = mobFramerate.toString();
        }

        const highQualityMobs = localStorage.getItem('highQualityMobs') === 'true';
        const highQualityMobsCheckbox = this.settingsMenu.querySelector('#highQualityMobs') as HTMLInputElement;
        if (highQualityMobsCheckbox) {
            highQualityMobsCheckbox.checked = highQualityMobs;
        }

        const dynamicSkybox = localStorage.getItem('dynamicSkybox') === 'true';
        const dynamicSkyboxCheckbox = this.settingsMenu.querySelector('#dynamicSkyboxCheckbox') as HTMLInputElement;
        if (dynamicSkyboxCheckbox) {
            dynamicSkyboxCheckbox.checked = dynamicSkybox;
        }

        // Load mob death animation setting (default to true if not set)
        const mobDeathAnimation = localStorage.getItem('mobDeathAnimation') !== 'false'; // Default true
        const mobDeathAnimationCheckbox = this.settingsMenu.querySelector('#mobDeathAnimationCheckbox') as HTMLInputElement;
        if (mobDeathAnimationCheckbox) {
            mobDeathAnimationCheckbox.checked = mobDeathAnimation;
        }

        const showConsoleLogs = localStorage.getItem('showConsoleLogs') === 'true';
        const showConsoleLogsCheckbox = this.settingsMenu.querySelector('#showConsoleLogs') as HTMLInputElement;
        if (showConsoleLogsCheckbox) {
            showConsoleLogsCheckbox.checked = showConsoleLogs;
        }
    }

    private addAdvancedSettingsStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            .auth-form .advanced-settings {
                margin: 10px 0 !important;
            }
            
            .auth-form .advanced-toggle {
                background: rgba(255, 0, 0, 0.8) !important;
                border: 2px solid yellow !important;
                color: white !important;
                padding: 8px 12px !important;
                border-radius: 5px !important;
                cursor: pointer !important;
                font-size: 14px !important;
                transition: all 0.3s ease !important;
                width: 100% !important;
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            
            .auth-form .advanced-toggle:hover {
                background: rgba(255, 255, 255, 0.2) !important;
                border-color: rgba(255, 255, 255, 0.5) !important;
            }
            
            .auth-form .advanced-settings-content {
                margin-top: 10px !important;
                padding: 10px !important;
                background: rgba(0, 0, 0, 0.3) !important;
                border-radius: 5px !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
            }
            
            .auth-form .advanced-settings-content.hidden {
                display: none !important;
            }
            
            .auth-form .server-input {
                display: flex !important;
                flex-direction: column !important;
                gap: 5px !important;
            }
            
            .auth-form .server-input label {
                color: white !important;
                font-size: 14px !important;
                font-weight: bold !important;
            }
            
            .auth-form .server-input input {
                padding: 8px !important;
                border: 1px solid rgba(255, 255, 255, 0.3) !important;
                border-radius: 4px !important;
                background: rgba(255, 255, 255, 0.1) !important;
                color: white !important;
                font-size: 14px !important;
            }
            
            .auth-form .server-input input::placeholder {
                color: rgba(255, 255, 255, 0.6) !important;
            }
            
            .auth-form .server-input input:focus {
                outline: none !important;
                border-color: rgba(255, 255, 255, 0.6) !important;
                background: rgba(255, 255, 255, 0.15) !important;
            }
        `;
        document.head.appendChild(style);
    }

    private setupAdvancedSettingsToggle(): void {
        // Get current origin for default values
        const currentOrigin = window.location.origin;
        
        console.log('Setting up advanced settings toggle...');
        console.log('Current origin:', currentOrigin);
        
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            console.log('Inside setTimeout - checking for elements...');
            
            // Setup login form advanced settings
            const loginToggle = document.getElementById('advancedSettingsToggle');
            const loginAdvancedSettings = document.getElementById('advancedSettings');
            const loginServerInput = document.getElementById('serverIP-connect') as HTMLInputElement;
            
            console.log('Login elements found:', { loginToggle, loginAdvancedSettings, loginServerInput });
            console.log('Login toggle element:', loginToggle);
            console.log('Login toggle innerHTML:', loginToggle?.innerHTML);
            console.log('Login toggle style:', loginToggle?.style.cssText);
            console.log('Login toggle computed style:', loginToggle ? window.getComputedStyle(loginToggle) : 'Element not found');
            
            if (loginToggle && loginAdvancedSettings && loginServerInput) {
                // Set default value to current origin
                loginServerInput.value = currentOrigin;
                
                loginToggle.addEventListener('click', () => {
                    const isHidden = loginAdvancedSettings.classList.contains('hidden');
                    if (isHidden) {
                        loginAdvancedSettings.classList.remove('hidden');
                        loginToggle.textContent = 'Advanced Settings ▲';
                    } else {
                        loginAdvancedSettings.classList.add('hidden');
                        loginToggle.textContent = 'Advanced Settings ▼';
                        // Reset to default when collapsed
                        loginServerInput.value = currentOrigin;
                    }
                });
                }
            
            // Setup register form advanced settings
            const registerToggle = document.getElementById('advancedSettingsToggleRegister');
            const registerAdvancedSettings = document.getElementById('advancedSettingsRegister');
            const registerServerInput = document.getElementById('serverIP-single') as HTMLInputElement;
            
            console.log('Register elements found:', { registerToggle, registerAdvancedSettings, registerServerInput });
            console.log('Current origin for register:', currentOrigin);
            
            if (registerToggle && registerAdvancedSettings && registerServerInput) {
                // Set default value to current origin
                registerServerInput.value = currentOrigin;
                
                registerToggle.addEventListener('click', () => {
                    const isHidden = registerAdvancedSettings.classList.contains('hidden');
                    if (isHidden) {
                        registerAdvancedSettings.classList.remove('hidden');
                        registerToggle.textContent = 'Advanced Settings ▲';
                    } else {
                        registerAdvancedSettings.classList.add('hidden');
                        registerToggle.textContent = 'Advanced Settings ▼';
                        // Reset to default when collapsed
                        registerServerInput.value = currentOrigin;
                    }
                });
            }
        }, 100); // 100ms delay to ensure DOM is ready
    }

    /**
     * Sets up canvas UI event listeners for mouse and keyboard input
     */
    private setupCanvasUIListeners(): void {
        // Mouse click handling
        this.uiCanvas.addEventListener('click', (e) => {
            const rect = this.uiCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            this.handleCanvasClick(x, y);
        });

        // Mouse move for hover effects
        this.uiCanvas.addEventListener('mousemove', (e) => {
            const rect = this.uiCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            this.handleCanvasHover(x, y);
        });

        // Mouse leave to clear hover
        this.uiCanvas.addEventListener('mouseleave', () => {
            this.hoveredBiomeIndex = -1;
            this.hoveredStartButton = false;
            this.hoveredAuthButton = null;
        });

        // Keyboard input for name field and auth form
        document.addEventListener('keydown', (e) => {
            // Don't interfere if game is running
            if (window.currentGame) return;

            // Don't interfere if a real HTML input/textarea is focused
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return;
            }

            // Handle auth form input
            if (this.showAuthForm && this.authFocusedField) {
                if (e.key === 'Backspace') {
                    if (this.authFocusedField === 'username') {
                        this.authUsername = this.authUsername.slice(0, -1);
                    } else if (this.authFocusedField === 'password') {
                        this.authPassword = this.authPassword.slice(0, -1);
                    } else if (this.authFocusedField === 'confirmPassword') {
                        this.authConfirmPassword = this.authConfirmPassword.slice(0, -1);
                    } else if (this.authFocusedField === 'serverIP') {
                        this.authServerIP = this.authServerIP.slice(0, -1);
                    }
                    e.preventDefault();
                } else if (e.key === 'Enter') {
                    if (this.isLoginForm) {
                        this.handleAuthLogin();
                    } else {
                        this.handleAuthRegister();
                    }
                    e.preventDefault();
                } else if (e.key === 'Tab') {
                    // Cycle through fields
                    e.preventDefault();
                    if (this.isLoginForm) {
                        if (this.authFocusedField === 'username') {
                            this.authFocusedField = 'password';
                        } else if (this.authFocusedField === 'password') {
                            this.authFocusedField = this.authAdvancedSettingsVisible ? 'serverIP' : 'username';
                        } else {
                            this.authFocusedField = 'username';
                        }
                    } else {
                        if (this.authFocusedField === 'username') {
                            this.authFocusedField = 'password';
                        } else if (this.authFocusedField === 'password') {
                            this.authFocusedField = 'confirmPassword';
                        } else if (this.authFocusedField === 'confirmPassword') {
                            this.authFocusedField = this.authAdvancedSettingsVisible ? 'serverIP' : 'username';
                        } else {
                            this.authFocusedField = 'username';
                        }
                    }
                } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                    if (this.authFocusedField === 'username') {
                        if (this.authUsername.length < 50) {
                            this.authUsername += e.key;
                        }
                    } else if (this.authFocusedField === 'password') {
                        if (this.authPassword.length < 100) {
                            this.authPassword += e.key;
                        }
                    } else if (this.authFocusedField === 'confirmPassword') {
                        if (this.authConfirmPassword.length < 100) {
                            this.authConfirmPassword += e.key;
                        }
                    } else if (this.authFocusedField === 'serverIP') {
                        this.authServerIP += e.key;
                    }
                    e.preventDefault();
                }
                return;
            }

            // Only handle if name input is focused and not in game
            if (this.isNameInputFocused && !window.currentGame) {
            if (e.key === 'Backspace') {
                this.playerName = this.playerName.slice(0, -1);
                localStorage.setItem('playerName', this.playerName);
                this.syncPlayerNameToInput();
                e.preventDefault();
                } else if (e.key === 'Enter') {
                    // Trigger start button
                    this.handleStartButtonClick();
                    e.preventDefault();
                } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                    // Only allow printable characters, max 20 chars
                    if (this.playerName.length < 20) {
                        this.playerName += e.key;
                        localStorage.setItem('playerName', this.playerName);
                        this.syncPlayerNameToInput();
                    }
                    e.preventDefault();
                }
            } else if (!window.currentGame && !this.isNameInputFocused && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Auto-focus name input when typing
                this.isNameInputFocused = true;
                if (e.key === 'Backspace') {
                    this.playerName = this.playerName.slice(0, -1);
                } else if (e.key.length === 1) {
                    if (this.playerName.length < 20) {
                        this.playerName += e.key;
                    }
                }
                localStorage.setItem('playerName', this.playerName);
                this.syncPlayerNameToInput();
                e.preventDefault();
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.uiCanvas.width = window.innerWidth;
            this.uiCanvas.height = window.innerHeight;
        });
    }

    /**
     * Handles canvas click events
     */
    private handleCanvasClick(x: number, y: number): void {
        const centerX = this.uiCanvas.width / 2;
        const centerY = this.uiCanvas.height / 2;

        // Ignore clicks while connecting animation is playing
        if (this.isConnecting) {
            return;
        }

        // Handle auth form clicks
        if (this.showAuthForm) {
            this.handleAuthFormClick(x, y, centerX, centerY);
            return;
        }
        
        // Check if clicking on name input field
        const nameInputY = centerY - 100;
        const nameInputX = centerX - 200;
        const nameInputWidth = 280; // Match the rendering width
        if (x >= nameInputX && x <= nameInputX + nameInputWidth && y >= nameInputY && y <= nameInputY + 42) {
            this.isNameInputFocused = true;
            return;
        }

        // Check if clicking on start button
        const startButtonY = centerY - 100;
        const startButtonX = centerX + 120;
        if (x >= startButtonX && x <= startButtonX + 120 && y >= startButtonY && y <= startButtonY + 42) {
            this.handleStartButtonClick();
            return;
        }

        // Check if clicking on biome buttons
        const biomeStartY = centerY - 20;
        const biomeButtonWidth = 90;
        const biomeButtonHeight = 35;
        const biomeSpacing = 10;
        const totalBiomeWidth = this.availableBiomes.length * (biomeButtonWidth + biomeSpacing) - biomeSpacing;
        const biomeStartX = centerX - totalBiomeWidth / 2;

        this.availableBiomes.forEach((biome, index) => {
            const biomeX = biomeStartX + index * (biomeButtonWidth + biomeSpacing);
            if (x >= biomeX && x <= biomeX + biomeButtonWidth && 
                y >= biomeStartY && y <= biomeStartY + biomeButtonHeight) {
                this.selectBiome(biome);
                return;
            }
        });

        // Clicking elsewhere unfocuses name input
        this.isNameInputFocused = false;
    }

    /**
     * Handles auth form click events
     */
    private handleAuthFormClick(x: number, y: number, centerX: number, centerY: number): void {
        const formWidth = 400;
        const formHeight = this.isLoginForm ? 500 : 600;
        const formX = centerX - formWidth / 2;
        const formY = centerY - formHeight / 2;
        const inputWidth = formWidth - 40;
        const inputHeight = 40;
        const inputX = formX + 20;
        let currentY = formY + 30;

        // Skip title
        currentY += 50;
        if (location.protocol === 'http:') {
            currentY += 30;
        }
        currentY += 10;

        // Username input
        if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
            this.authFocusedField = 'username';
            return;
        }
        currentY += inputHeight + 15;

        // Password input
        if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
            this.authFocusedField = 'password';
            return;
        }
        currentY += inputHeight + 15;

        // Confirm password (register only)
        if (!this.isLoginForm) {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
                this.authFocusedField = 'confirmPassword';
                return;
            }
            currentY += inputHeight + 15;
        }

        // Advanced settings toggle
        const advancedButtonY = currentY;
        const advancedButtonHeight = 35;
        if (x >= inputX && x <= inputX + inputWidth && y >= advancedButtonY && y <= advancedButtonY + advancedButtonHeight) {
            this.authAdvancedSettingsVisible = !this.authAdvancedSettingsVisible;
            return;
        }
        currentY += advancedButtonHeight + 10;

        // Server IP input (if advanced settings visible)
        if (this.authAdvancedSettingsVisible) {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
                this.authFocusedField = 'serverIP';
                return;
            }
            currentY += inputHeight + 15;
        }

        // Buttons
        currentY += 10;
        const buttonHeight = 40;
        const buttonSpacing = 10;

        if (this.isLoginForm) {
            // Login button
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.handleAuthLogin();
                return;
            }
            currentY += buttonHeight + buttonSpacing;

            // Register button (now a full button instead of just a link)
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.isLoginForm = false;
                this.authFocusedField = null;
                return;
            }
            currentY += buttonHeight + buttonSpacing;

            // Guest button (smaller, centered)
            const guestButtonWidth = inputWidth * 0.5;
            const guestButtonX = inputX + (inputWidth - guestButtonWidth) / 2;
            const guestButtonHeight = buttonHeight * 0.8;
            if (x >= guestButtonX && x <= guestButtonX + guestButtonWidth && 
                y >= currentY && y <= currentY + guestButtonHeight) {
                this.handleAuthGuest();
                return;
            }
        } else {
            // Register button
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.handleAuthRegister();
                return;
            }
            currentY += buttonHeight + buttonSpacing;

            // Offline register button
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.handleAuthOfflineRegister();
                return;
            }
            currentY += buttonHeight + buttonSpacing;

            // Show login link
            if (y >= currentY && y <= currentY + 20) {
                this.isLoginForm = true;
                this.authFocusedField = null;
                return;
            }
        }

        // Clicking elsewhere unfocuses all fields
        this.authFocusedField = null;
    }

    /**
     * Handles canvas hover events
     */
    private handleCanvasHover(x: number, y: number): void {
        const centerX = this.uiCanvas.width / 2;
        const centerY = this.uiCanvas.height / 2;
        
        // Handle auth form hover
        if (this.showAuthForm) {
            this.handleAuthFormHover(x, y, centerX, centerY);
            return;
        }
        
        // Check start button hover
        const startButtonY = centerY - 100;
        const startButtonX = centerX + 120;
        this.hoveredStartButton = (x >= startButtonX && x <= startButtonX + 120 && 
                                   y >= startButtonY && y <= startButtonY + 42);

        // Check biome button hover
        const biomeStartY = centerY - 20;
        const biomeButtonWidth = 90;
        const biomeButtonHeight = 35;
        const biomeSpacing = 10;
        const totalBiomeWidth = this.availableBiomes.length * (biomeButtonWidth + biomeSpacing) - biomeSpacing;
        const biomeStartX = centerX - totalBiomeWidth / 2;

        this.hoveredBiomeIndex = -1;
        this.availableBiomes.forEach((biome, index) => {
            const biomeX = biomeStartX + index * (biomeButtonWidth + biomeSpacing);
            if (x >= biomeX && x <= biomeX + biomeButtonWidth && 
                y >= biomeStartY && y <= biomeStartY + biomeButtonHeight) {
                this.hoveredBiomeIndex = index;
            }
        });
    }

    /**
     * Handles auth form hover events
     */
    private handleAuthFormHover(x: number, y: number, centerX: number, centerY: number): void {
        const formWidth = 400;
        const formHeight = this.isLoginForm ? 500 : 600;
        const formX = centerX - formWidth / 2;
        const formY = centerY - formHeight / 2;
        const inputWidth = formWidth - 40;
        const inputHeight = 40;
        const inputX = formX + 20;
        let currentY = formY + 30;

        // Skip title
        currentY += 50;
        if (location.protocol === 'http:') {
            currentY += 30;
        }
        currentY += 10;

        // Skip inputs
        currentY += inputHeight + 15;
        currentY += inputHeight + 15;
        if (!this.isLoginForm) {
            currentY += inputHeight + 15;
        }

        // Advanced settings toggle
        const advancedButtonY = currentY;
        const advancedButtonHeight = 35;
        if (x >= inputX && x <= inputX + inputWidth && y >= advancedButtonY && y <= advancedButtonY + advancedButtonHeight) {
            this.hoveredAuthButton = 'toggleAdvanced';
            return;
        }
        currentY += advancedButtonHeight + 10;

        if (this.authAdvancedSettingsVisible) {
            currentY += inputHeight + 15;
        }

        // Buttons
        currentY += 10;
        const buttonHeight = 40;
        const buttonSpacing = 10;

        if (this.isLoginForm) {
            // Login button
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.hoveredAuthButton = 'login';
                return;
            }
            currentY += buttonHeight + buttonSpacing;

            // Register button (now a full button)
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.hoveredAuthButton = 'showRegister';
                return;
            }
            currentY += buttonHeight + buttonSpacing;

            // Guest button (smaller, centered)
            const guestButtonWidth = inputWidth * 0.5;
            const guestButtonX = inputX + (inputWidth - guestButtonWidth) / 2;
            const guestButtonHeight = buttonHeight * 0.8;
            if (x >= guestButtonX && x <= guestButtonX + guestButtonWidth && 
                y >= currentY && y <= currentY + guestButtonHeight) {
                this.hoveredAuthButton = 'guest';
                return;
            }
        } else {
            // Register button
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.hoveredAuthButton = 'register';
                return;
            }
            currentY += buttonHeight + buttonSpacing;

            // Offline register button
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.hoveredAuthButton = 'offline';
                return;
            }
            currentY += buttonHeight + buttonSpacing;

            // Show login link
            if (y >= currentY && y <= currentY + 20) {
                this.hoveredAuthButton = 'showLogin';
                return;
            }
        }

        this.hoveredAuthButton = null;
    }

    /**
     * Handles start button click
     */
    private handleStartButtonClick(): void {
        const multiPlayerButton = this.getMultiPlayerButton();
        if (multiPlayerButton) {
            multiPlayerButton.click();
        }
    }

    /**
     * Selects a biome
     */
    private selectBiome(biomeName: string): void {
        const selectedBiome = biomeName || 'default';
        localStorage.setItem('spawnBiome', selectedBiome);
        console.log('Selected spawn biome:', selectedBiome);
        this.loadBackgroundTexture(selectedBiome);
    }

    /**
     * Syncs the playerName to the dummy input element for compatibility
     */
    private syncPlayerNameToInput(): void {
        const input = document.getElementById('nameInput') as HTMLInputElement;
        if (input) {
            input.value = this.playerName;
        }
    }

    /**
     * Draws a rounded rectangle
     */
    private drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    /**
     * Darkens a color by a given factor (0-1, where 0.3 means 30% darker)
     */
    private darkenColor(color: string, factor: number = 0.3): string {
        // Handle rgba colors
        if (color.startsWith('rgba')) {
            const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (match) {
                const r = Math.max(0, Math.floor(parseInt(match[1]) * (1 - factor)));
                const g = Math.max(0, Math.floor(parseInt(match[2]) * (1 - factor)));
                const b = Math.max(0, Math.floor(parseInt(match[3]) * (1 - factor)));
                const a = match[4] ? parseFloat(match[4]) : 1;
                return `rgba(${r}, ${g}, ${b}, ${a})`;
            }
        }
        // Handle hex colors
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const newR = Math.max(0, Math.floor(r * (1 - factor)));
            const newG = Math.max(0, Math.floor(g * (1 - factor)));
            const newB = Math.max(0, Math.floor(b * (1 - factor)));
            return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
        }
        // Handle rgb colors
        if (color.startsWith('rgb')) {
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                const r = Math.max(0, Math.floor(parseInt(match[1]) * (1 - factor)));
                const g = Math.max(0, Math.floor(parseInt(match[2]) * (1 - factor)));
                const b = Math.max(0, Math.floor(parseInt(match[3]) * (1 - factor)));
                return `rgb(${r}, ${g}, ${b})`;
            }
        }
        return color; // Return original if we can't parse it
    }

    /**
     * Starts the canvas rendering loop
     */
    private startCanvasRendering(): void {
        if (!this.uiCanvas || !this.uiCtx) {
            return;
        }
        // Stop any existing rendering loop
        this.stopCanvasRendering();
        const render = () => {
            if (this.uiCanvas && this.uiCtx) {
                this.renderCanvasUI();
                this.animationFrameId = requestAnimationFrame(render);
            }
        };
        render();
    }

    /**
     * Stops the canvas rendering loop
     */
    private stopCanvasRendering(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Renders the canvas UI
     */
    private renderCanvasUI(): void {
        const ctx = this.uiCtx;
        const width = this.uiCanvas.width;
        const height = this.uiCanvas.height;
        const centerX = width / 2;
        const centerY = height / 2;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Track FPS
        this.titleFrameCount++;
        const currentTime = performance.now();
        if (currentTime - this.titleFpsUpdateTime >= 1000) {
            this.titleFpsCounter = this.titleFrameCount;
            this.titleFrameCount = 0;
            this.titleFpsUpdateTime = currentTime;
        }

        // Draw title
        ctx.save();
        ctx.font = 'bold 48px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 6;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const titleText = 'florr.io clone';
        // Render connecting state, auth form, or game menu
        if (this.isConnecting) {
            this.renderConnecting(ctx, centerX, centerY);
            return;
        }
        
        if (!this.showAuthForm) {
            ctx.strokeText(titleText, centerX, centerY - 200);
            ctx.fillText(titleText, centerX, centerY - 200);
            ctx.restore();
        }
        else {
            ctx.strokeText(titleText, centerX, centerY - 400);
            ctx.fillText(titleText, centerX, centerY - 400);
            ctx.restore();
        }

        // Render auth form if visible, otherwise render game menu
        if (this.showAuthForm) {
            this.renderAuthForm(ctx, centerX, centerY);
            return;
        }

        // Draw name input field (shorter to avoid overlap with ready button)
        const nameInputY = centerY - 100;
        const nameInputWidth = 280; // Reduced from 400 to prevent overlap
        const nameInputX = centerX - 200; // Keep left edge at same position
        const nameInputHeight = 42;
        const nameInputRadius = 5; // Rounded corner radius

        // Input background with rounded corners
        const nameInputBgColor = this.isNameInputFocused ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.9)';
        ctx.fillStyle = nameInputBgColor;
        ctx.strokeStyle = this.darkenColor(nameInputBgColor, 0.4); // Darker border
        ctx.lineWidth = this.isNameInputFocused ? 3 : 2;
        this.drawRoundedRect(ctx, nameInputX, nameInputY, nameInputWidth, nameInputHeight, nameInputRadius);
        ctx.fill();
        ctx.stroke();

        // Input text
        ctx.font = 'bold 18px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const displayText = this.playerName || (this.isNameInputFocused ? '' : 'This flower is called...');
        
        // Measure text to handle overflow
        const maxTextWidth = nameInputWidth - 20;
        let displayName = displayText;
        const metrics = ctx.measureText(displayName);
        if (metrics.width > maxTextWidth) {
            // Truncate text with ellipsis
            while (ctx.measureText(displayName + '...').width > maxTextWidth && displayName.length > 0) {
                displayName = displayName.slice(0, -1);
            }
            displayName += '...';
        }
        
        const textX = nameInputX + 10;
        const textY = nameInputY + nameInputHeight / 2;
        // Draw black outline
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(displayName, textX, textY);
        // Draw text fill (white)
        ctx.fillStyle = '#ffffff';
        ctx.fillText(displayName, textX, textY);

        // Draw cursor if focused
        if (this.isNameInputFocused) {
            const cursorX = nameInputX + 10 + ctx.measureText(displayName).width;
            const time = Date.now();
            if (Math.floor(time / 500) % 2 === 0) {
                ctx.fillStyle = '#000000';
                ctx.fillRect(cursorX, nameInputY + 10, 2, nameInputHeight - 20);
            }
        }

        // Draw start button
        const startButtonY = centerY - 100;
        const startButtonX = centerX + 120;
        const startButtonWidth = 120;
        const startButtonHeight = 42;
        const startButtonRadius = 5; // Rounded corner radius

        // Button background with rounded corners (always green, darker when hovered)
        const startButtonColor = '#1dd129'; // Always green
        const buttonFillColor = this.hoveredStartButton ? this.darkenColor(startButtonColor, 0.2) : startButtonColor;
        ctx.fillStyle = buttonFillColor;
        ctx.strokeStyle = this.darkenColor(buttonFillColor, 0.3); // Darker border
        ctx.lineWidth = 2;
        this.drawRoundedRect(ctx, startButtonX, startButtonY, startButtonWidth, startButtonHeight, startButtonRadius);
        ctx.fill();
        ctx.stroke();

        // Button text (always white since button is always green)
        ctx.font = 'bold 18px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const readyTextX = startButtonX + startButtonWidth / 2;
        const readyTextY = startButtonY + startButtonHeight / 2;
        // Draw black outline
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText('Ready▶', readyTextX, readyTextY);
        // Draw text fill
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Ready▶', readyTextX, readyTextY);

        // Draw biome selector label
        ctx.font = 'bold 18px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText('Spawn Biome:', centerX, centerY - 50);
        ctx.fillText('Spawn Biome:', centerX, centerY - 50);

        // Draw biome buttons
        const biomeStartY = centerY - 20;
        const biomeButtonWidth = 90;
        const biomeButtonHeight = 35;
        const biomeSpacing = 10;
        const totalBiomeWidth = this.availableBiomes.length * (biomeButtonWidth + biomeSpacing) - biomeSpacing;
        const biomeStartX = centerX - totalBiomeWidth / 2;
        const selectedBiome = localStorage.getItem('spawnBiome') || 'default';

        this.availableBiomes.forEach((biome, index) => {
            const biomeX = biomeStartX + index * (biomeButtonWidth + biomeSpacing);
            const biomeConfig = this.getBiomeConfig(biome);
            const isSelected = biome === selectedBiome;
            const isHovered = this.hoveredBiomeIndex === index;

            // Button background with rounded corners (darker when hovered)
            const biomeButtonRadius = 8; // Rounded corner radius
            // Darken the button when hovered (but not when selected)
            const biomeFillColor = (isHovered && !isSelected) ? this.darkenColor(biomeConfig.color, 0.2) : biomeConfig.color;
            ctx.fillStyle = biomeFillColor;
            // Use darker version of the biome color for border, or white if selected
            const borderColor = isSelected ? '#ffffff' : this.darkenColor(biomeFillColor, 0.3);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = isSelected ? 3 : 2;
            this.drawRoundedRect(ctx, biomeX, biomeStartY, biomeButtonWidth, biomeButtonHeight, biomeButtonRadius);
            ctx.fill();
            ctx.stroke();

            // Button text
            ctx.font = 'bold 14px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            let buttonText = biomeConfig.displayName;
            if (isSelected) {
                buttonText += ' ✓';
            }
            const biomeTextX = biomeX + biomeButtonWidth / 2;
            const biomeTextY = biomeStartY + biomeButtonHeight / 2;
            // Draw black outline
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText(buttonText, biomeTextX, biomeTextY);
            // Draw text fill (white)
            ctx.fillStyle = '#ffffff';
            ctx.fillText(buttonText, biomeTextX, biomeTextY);
        });

        // Draw controls text (smaller, at bottom)
        const controlsY = centerY + 150;
        ctx.font = 'bold 14px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        const controlsText = [
            'Controls:',
            'Arrow keys to move',
            'Hold space to extend petals',
            'Press I to open the inventory.',
            'Press number keys 1-9 to use items.',
            'Press C to switch between mouse and keyboard controls',
            'Press R to craft items'
        ];

        controlsText.forEach((text, index) => {
            const y = controlsY + index * 20;
            // Draw black outline (already has stroke from above)
            ctx.strokeText(text, centerX, y);
            // Draw text fill
            ctx.fillText(text, centerX, y);
        });

        // Draw stats counters
        this.renderStatsCounters(ctx, width, height);
    }

    /**
     * Renders stats counters (FPS, memory, mobs, players) in the bottom-right corner
     */
    private renderStatsCounters(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const showStats = localStorage.getItem('showStats') === 'true';
        if (!showStats) return;

        ctx.save();
        ctx.font = 'bold 14px Ubuntu, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000000';

        // FPS & Memory
        ctx.fillStyle = '#00ff00';
        const fpsText = `FPS: ${this.titleFpsCounter} | Memory: 0.00 MB`;
        ctx.strokeText(fpsText, width - 10, height - 10);
        ctx.fillText(fpsText, width - 10, height - 10);

        // Mobs
        ctx.fillStyle = '#ff6b6b';
        ctx.strokeText('Mobs: 0', width - 10, height - 30);
        ctx.fillText('Mobs: 0', width - 10, height - 30);

        // Players
        ctx.fillStyle = '#4ecdc4';
        ctx.strokeText('Players: 0', width - 10, height - 50);
        ctx.fillText('Players: 0', width - 10, height - 50);

        ctx.restore();
    }

    /**
     * Renders the connecting state on canvas
     */
    private renderConnecting(ctx: CanvasRenderingContext2D, centerX: number, centerY: number): void {
        // Draw title
        ctx.save();
        ctx.font = 'bold 48px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 6;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const titleText = 'florr.io clone';
        ctx.strokeText(titleText, centerX, centerY - 200);
        ctx.fillText(titleText, centerX, centerY - 200);
        ctx.restore();

        // Draw connecting text
        ctx.font = 'bold 24px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const connectingText = 'Connecting...';
        ctx.strokeText(connectingText, centerX, centerY);
        ctx.fillText(connectingText, centerX, centerY);

        // Draw stats counters
        this.renderStatsCounters(ctx, this.uiCanvas.width, this.uiCanvas.height);
    }

    /**
     * Renders the auth form on canvas
     */
    private renderAuthForm(ctx: CanvasRenderingContext2D, centerX: number, centerY: number): void {
        const formWidth = 400;
        const formHeight = this.isLoginForm ? 500 : 600;
        const formX = centerX - formWidth / 2;
        const formY = centerY - formHeight / 2;
        const formRadius = 10;
        const inputWidth = formWidth - 40;
        const inputHeight = 40;
        const inputX = formX + 20;
        const inputRadius = 5;
        const buttonHeight = 40;
        const buttonSpacing = 10;
        let currentY = formY + 30;

        // Draw form background (purple theme)
        // ctx.fillStyle = 'rgba(138, 43, 226, 1)'; // Purple background
        // ctx.strokeStyle = 'rgba(186, 85, 211, 1)'; // Light purple border
        // ctx.lineWidth = 2;
        // this.drawRoundedRect(ctx, formX, formY, formWidth, formHeight, formRadius);
        // ctx.fill();
        // ctx.stroke();

        // Draw form title
        ctx.font = 'bold 28px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const formTitle = this.isLoginForm ? 'Login' : 'Register';
        ctx.strokeText(formTitle, centerX, currentY);
        ctx.fillText(formTitle, centerX, currentY);
        currentY += 50;

        // HTTP warning (if applicable)
        if (location.protocol === 'http:') {
            ctx.font = 'bold 14px Ubuntu, sans-serif';
            ctx.fillStyle = '#ff6b6b';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            const warningText = 'WARNING: Using HTTP (not secure)';
            ctx.strokeText(warningText, centerX, currentY);
            ctx.fillText(warningText, centerX, currentY);
            currentY += 30;
        }

        // Username input
        currentY += 10;
        this.drawAuthInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 
            'username', this.authUsername, 'Username');
        currentY += inputHeight + 15;

        // Password input
        this.drawAuthInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius,
            'password', this.authPassword, 'Password', true);
        currentY += inputHeight + 15;

        // Confirm password (register only)
        if (!this.isLoginForm) {
            this.drawAuthInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius,
                'confirmPassword', this.authConfirmPassword, 'Confirm Password', true);
            currentY += inputHeight + 15;
        }

        // Advanced settings toggle button
        const advancedButtonY = currentY;
        const advancedButtonWidth = inputWidth;
        const advancedButtonHeight = 35;
        const isAdvancedHovered = this.hoveredAuthButton === 'toggleAdvanced';
        ctx.fillStyle = isAdvancedHovered ? 'rgba(186, 85, 211, 0.4)' : 'rgba(186, 85, 211, 0.2)'; // Purple
        ctx.strokeStyle = 'rgba(186, 85, 211, 0.6)'; // Purple border
        ctx.lineWidth = 1;
        this.drawRoundedRect(ctx, inputX, advancedButtonY, advancedButtonWidth, advancedButtonHeight, inputRadius);
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 14px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const advancedText = `Advanced Settings ${this.authAdvancedSettingsVisible ? '▲' : '▼'}`;
        ctx.fillText(advancedText, centerX, advancedButtonY + advancedButtonHeight / 2);
        currentY += advancedButtonHeight + 10;

        // Advanced settings (server IP)
        if (this.authAdvancedSettingsVisible) {
            this.drawAuthInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius,
                'serverIP', this.authServerIP, 'Server IP');
            currentY += inputHeight + 15;
        }

        // Buttons
        currentY += 10;
        
        if (this.isLoginForm) {
            // Login button (purple) - full width
            this.drawAuthButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius,
                'login', 'Login', '#8A2BE2'); // Purple
            currentY += buttonHeight + buttonSpacing;

            // Register button (make it prominent and easy to access)
            this.drawAuthButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius,
                'showRegister', 'Register', '#8A2BE2'); // Purple - same as login
            currentY += buttonHeight + buttonSpacing;

            // Guest button (smaller, less prominent)
            const guestButtonWidth = inputWidth * 0.5; // Half width
            const guestButtonX = inputX + (inputWidth - guestButtonWidth) / 2; // Centered
            this.drawAuthButton(ctx, guestButtonX, currentY, guestButtonWidth, buttonHeight * 0.8, inputRadius,
                'guest', 'Guest', '#6A1B9A'); // Darker purple, smaller
            currentY += buttonHeight * 0.8 + 4;

            // Guest warning text
            ctx.font = '11px Ubuntu, sans-serif';
            ctx.fillStyle = '#FF9800';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Guest accounts do not keep progress', centerX, currentY + 6);
            currentY += buttonSpacing + 8;
        } else {
            // Register button (purple)
            this.drawAuthButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius,
                'register', 'Register', '#8A2BE2'); // Purple
            currentY += buttonHeight + buttonSpacing;

            // Offline register button (darker purple)
            this.drawAuthButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius,
                'offline', 'Register Offline', '#6A1B9A'); // Darker purple
            currentY += buttonHeight + buttonSpacing;

            // Show login link
            ctx.font = '14px Ubuntu, sans-serif';
            ctx.fillStyle = this.hoveredAuthButton === 'showLogin' ? '#ffffff' : '#E0B0FF'; // Light purple
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Already have an account? Login', centerX, currentY + 10);
        }

        // Draw stats counters
        this.renderStatsCounters(ctx, this.uiCanvas.width, this.uiCanvas.height);
    }

    /**
     * Draws an auth input field
     */
    private drawAuthInput(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, 
                         radius: number, fieldName: string, value: string, placeholder: string, isPassword: boolean = false): void {
        const isFocused = this.authFocusedField === fieldName;
        const bgColor = 'rgb(24, 206, 24)';
        ctx.fillStyle = bgColor;
        ctx.strokeStyle = 'rgb(17, 151, 17)';
        ctx.lineWidth = isFocused ? 3 : 2;
        this.drawRoundedRect(ctx, x, y, width, height, radius);
        ctx.fill();
        ctx.stroke();

        // Draw text
        ctx.font = '18px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const displayValue = isPassword ? '*'.repeat(value.length) : value;
        const displayText = displayValue || (isFocused ? '' : placeholder);
        ctx.strokeStyle = 'rgb(0, 0, 0)';
        ctx.lineWidth = 2;
        ctx.strokeText(displayText, x + 10, y + height / 2);
        ctx.lineWidth = 0;
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.fillText(displayText, x + 10, y + height / 2);

        // Draw cursor if focused
        if (isFocused) {
            const textWidth = ctx.measureText(displayText).width;
            const cursorX = x + 10 + textWidth;
            const time = Date.now();
            if (Math.floor(time / 500) % 2 === 0) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(cursorX, y + 10, 2, height - 20);
            }
        }
    }

    /**
     * Draws an auth button
     */
    private drawAuthButton(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
                          radius: number, buttonId: string, text: string, color: string): void {
        const isHovered = this.hoveredAuthButton === buttonId;
        const buttonColor = isHovered ? this.darkenColor(color, 0.2) : color;
        ctx.fillStyle = buttonColor;
        ctx.strokeStyle = this.darkenColor(buttonColor, 0.3);
        ctx.lineWidth = 2;
        this.drawRoundedRect(ctx, x, y, width, height, radius);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 18px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(text, x + width / 2, y + height / 2);
        ctx.fillText(text, x + width / 2, y + height / 2);
    }

    private setupNameInputPersistence(): void {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            const nameInput = document.getElementById('nameInput') as HTMLInputElement;
            if (nameInput) {
                // Load saved name from localStorage
                const savedName = localStorage.getItem('playerName') || '';
                nameInput.value = savedName;
                
                // Save name to localStorage when it changes
                nameInput.addEventListener('input', () => {
                    localStorage.setItem('playerName', nameInput.value);
                });
                
                // Also save on blur (when user clicks away)
                nameInput.addEventListener('blur', () => {
                    localStorage.setItem('playerName', nameInput.value);
                });
            }

        }, 100); // 100ms delay to ensure DOM is ready
    }

    public showLoginForm(): void {
        // console.log('Showing login form');
        // this.loginForm.classList.remove('hidden');
        // this.registerForm.classList.add('hidden');
        // handled in auth_ui.ts
    }

    public showRegisterForm(): void {
        // console.log('Showing register form');
        // this.loginForm.classList.add('hidden');
        // this.registerForm.classList.remove('hidden');
        // handled in auth_ui.ts
    }

    public hideAuthContainer(): void {
        this.showAuthForm = false;
        // Also hide DOM-based auth container
        if (this.authContainer) {
            this.authContainer.style.display = 'none';
        }
        // Show loadout bar when auth form is hidden
        const loadoutBar = document.getElementById('titleScreenLoadoutBar');
        if (loadoutBar) {
            loadoutBar.style.display = 'flex';
        }
    }

    public showAuthContainer(): void {
        this.showAuthForm = true;
        // Keep DOM-based auth container hidden since we're using canvas-based form
        if (this.authContainer) {
            this.authContainer.style.display = 'none';
        }
        // Hide loadout bar when auth form is shown
        const loadoutBar = document.getElementById('titleScreenLoadoutBar');
        if (loadoutBar) {
            loadoutBar.style.display = 'none';
        }
    }

    /**
     * Called when loadout items have finished loading, or when connection attempt completes
     */
    public onLoadoutLoaded(): void {
        if (!this.isConnecting) return; // Already handled
        
        this.isConnecting = false;
        
        // Check if user is logged in - if not, show auth form
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        const currentUser = localStorage.getItem('currentUser') || sessionStorage.getItem('currentUser');
        
        if (!username || !password || !currentUser) {
            // User is not logged in, show auth form
            this.showAuthContainer();
        } else {
            // User is logged in, hide auth form
            this.hideAuthContainer();
        }
    }

    /**
     * Called when connection attempt completes (even if no loadout to load)
     */
    public onConnectionComplete(): void {
        // If still connecting and no loadout will load (user not logged in), show login form
        if (this.isConnecting) {
            const username = localStorage.getItem('username');
            const password = localStorage.getItem('password');
            
            if (!username || !password) {
                // User is not logged in, wait a bit for socket to connect, then show login
                setTimeout(() => {
                    if (this.isConnecting) {
                        this.onLoadoutLoaded(); // This will show the login form
                    }
                }, 1000); // Wait 1 second for connection attempt
            }
        }
    }

    /**
     * Auth form action handlers
     */
    private async handleAuthLogin(): Promise<void> {
        const username = this.authUsername;
        const password = this.authPassword;
        const serverUrl = this.authServerIP || window.location.origin;

        try {
            const response = await fetch(`${serverUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });

            if (response.ok) {
                localStorage.setItem('username', username);
                localStorage.setItem('password', password);
                localStorage.setItem('currentUser', username);
                localStorage.setItem('serverUrl', serverUrl);
                sessionStorage.removeItem('isOffline');
                this.hideAuthContainer();
            } else {
                const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
                if (offlineCredentials.username === username && 
                    offlineCredentials.password === password && 
                    offlineCredentials.isOffline) {
                    sessionStorage.setItem('currentUser', username);
                    sessionStorage.setItem('isOffline', 'true');
                    this.hideAuthContainer();
                } else {
                    alert('Invalid username or password');
                }
            }
        } catch (error) {
            console.error('Login error:', error);
            const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
            if (offlineCredentials.username === username && 
                offlineCredentials.password === password && 
                offlineCredentials.isOffline) {
                sessionStorage.setItem('currentUser', username);
                sessionStorage.setItem('isOffline', 'true');
                this.hideAuthContainer();
            } else {
                alert('Invalid username or password');
            }
        }
    }

    private async handleAuthGuest(): Promise<void> {
        const guestUsername = `User${Math.floor(Math.random() * 100000000)}`;
        const guestPassword = `password${Math.floor(Math.random() * 10000000000)}`;
        const serverUrl = this.authServerIP || window.location.origin;

        try {
            const response = await fetch(`${serverUrl}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: guestUsername, password: guestPassword }),
                credentials: 'include'
            });

            if (response.ok) {
                localStorage.setItem('username', guestUsername);
                localStorage.setItem('password', guestPassword);
                localStorage.setItem('currentUser', guestUsername);
                localStorage.setItem('serverUrl', serverUrl);
                sessionStorage.removeItem('isOffline');
                this.hideAuthContainer();
                alert(`Guest account created!\nUsername: ${guestUsername}\nPassword: ${guestPassword}\n\nSave these credentials if you want to log in again!`);
            } else {
                const errorData = await response.json();
                if (errorData.message && errorData.message.includes('already exists')) {
                    this.handleAuthGuest(); // Retry
                } else {
                    alert('Failed to create guest account: ' + (errorData.message || 'Unknown error'));
                }
            }
        } catch (error) {
            console.error('Guest registration error:', error);
            const offlineCredentials = {
                username: guestUsername,
                password: guestPassword,
                isOffline: true
            };
            sessionStorage.setItem('offlineCredentials', JSON.stringify(offlineCredentials));
            sessionStorage.setItem('currentUser', guestUsername);
            sessionStorage.setItem('isOffline', 'true');
            this.hideAuthContainer();
            alert(`Guest account created (Offline Mode)!\nUsername: ${guestUsername}\nPassword: ${guestPassword}\n\nNote: This account is temporary and will be lost when you close the browser.`);
        }
    }

    private async handleAuthRegister(): Promise<void> {
        const username = this.authUsername;
        const password = this.authPassword;
        const confirmPassword = this.authConfirmPassword;
        const serverUrl = this.authServerIP || window.location.origin;

        if (!serverUrl) {
            alert('Please enter a server IP address');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }

        try {
            const response = await fetch(`${serverUrl}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });

            if (response.ok) {
                const storedCredentials = JSON.parse(localStorage.getItem('credentials') || '[]');
                storedCredentials.push({ username, password });
                localStorage.setItem('credentials', JSON.stringify(storedCredentials));
                localStorage.setItem('serverUrl', serverUrl);
                this.isLoginForm = true;
                this.authFocusedField = null;
                alert('Registration successful! Please login.');
            } else {
                const errorData = await response.json();
                alert(errorData.message || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            alert('Could not connect to server. Please check the server IP and try again.');
        }
    }

    private handleAuthOfflineRegister(): void {
        const username = this.authUsername;
        const password = this.authPassword;
        const confirmPassword = this.authConfirmPassword;

        if (!username || !password) {
            alert('Username and password are required');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }

        const storedCredentials = JSON.parse(localStorage.getItem('credentials') || '[]');
        if (storedCredentials.some((cred: any) => cred.username === username)) {
            alert('Username already exists locally');
            return;
        }

        const offlineCredentials = {
            username,
            password,
            isOffline: true
        };
        
        sessionStorage.setItem('offlineCredentials', JSON.stringify(offlineCredentials));
        sessionStorage.setItem('currentUser', username);
        sessionStorage.setItem('isOffline', 'true');
        this.isLoginForm = true;
        this.authFocusedField = null;
        alert('Offline registration successful! Note: This account is temporary and will be lost when you close the browser.');
    }

    public hideGameMenu(): void {
        this.gameMenu.style.display = 'none';
    }

    public showGameMenu(): void {
        // gameMenu is empty (contents moved elsewhere), keep it hidden
        this.gameMenu.style.display = 'none';
    }

    public hideCenterText(): void {
        this.centerText.style.display = 'none';
        // Hide canvas UI
        if (this.uiCanvas) {
            this.uiCanvas.style.display = 'none';
        }
        // Hide loadout bar
        const loadoutBar = document.getElementById('titleScreenLoadoutBar');
        if (loadoutBar) {
            loadoutBar.style.display = 'none';
        }
        this.stopCanvasRendering();
    }

    public showCenterText(): void {
        this.centerText.style.display = 'none'; // Keep HTML hidden, use canvas
        // Show canvas UI
        if (this.uiCanvas) {
            this.uiCanvas.style.display = 'block';
        }
        // Show loadout bar
        const loadoutBar = document.getElementById('titleScreenLoadoutBar');
        if (loadoutBar) {
            loadoutBar.style.display = 'flex';
        }
        this.startCanvasRendering();
    }

    public hideTitleScreen(): void {
        // Stop canvas rendering
        this.stopCanvasRendering();
        // Hide canvas
        if (this.uiCanvas) {
            this.uiCanvas.style.display = 'none';
        }
        this.hideAuthContainer();
        this.hideGameMenu();
        this.hideCenterText();
        this.hideFloatingPetals();
        this.stopBackgroundAnimation();
        this.hideBackgroundCanvas();
        
        // Hide all title screen panels
        this.hideTitleScreenPanels();
        
        // Resize canvas back to full screen for game
        const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        if (gameCanvas) {
            // Resize canvas to full screen dimensions
            gameCanvas.width = window.innerWidth;
            gameCanvas.height = window.innerHeight;
            
            // Reset canvas positioning to full screen
            gameCanvas.style.position = 'absolute';
            gameCanvas.style.left = '0px';
            gameCanvas.style.top = '0px';
            gameCanvas.style.width = '100%';
            gameCanvas.style.height = '100%';
            gameCanvas.style.zIndex = '0';
            gameCanvas.style.pointerEvents = 'auto';
            gameCanvas.style.display = 'block';
            
            // Re-setup canvas on managers with full screen dimensions
            this.changelogManager.setCanvas(gameCanvas);
            this.notificationsManager.setCanvas(gameCanvas);
        }
    }
    
    private hideTitleScreenPanels(): void {
        // Hide inventory panel
        const inventoryPanel = document.getElementById('inventoryPanel');
        if (inventoryPanel) {
            inventoryPanel.classList.remove('open');
            inventoryPanel.style.display = 'none';
        }
        
        // Hide crafting panel
        const craftingPanel = document.getElementById('craftingPanel');
        if (craftingPanel) {
            craftingPanel.classList.remove('open');
            craftingPanel.style.display = 'none';
        }
        
        // Hide title screen loadout bar
        const titleScreenLoadoutBar = document.getElementById('titleScreenLoadoutBar');
        if (titleScreenLoadoutBar) {
            titleScreenLoadoutBar.style.display = 'none';
        }
        
        // Hide skills panel (created by SkillsManager, no ID, so we need to find it by class)
        const skillsPanel = document.querySelector('.skills-panel');
        if (skillsPanel) {
            (skillsPanel as HTMLElement).style.display = 'none';
        }
        
        // Hide chat container (created by Chat, no ID, so we need to find it by class)
        const chatContainer = document.querySelector('.chat-container');
        if (chatContainer) {
            (chatContainer as HTMLElement).style.display = 'none';
        }
        
        // Also close panels through managers if they exist
        // Note: We check display style directly and hide manually to avoid toggling logic
        // The panels are already hidden above, but we ensure managers know they're closed
        if (this.titleScreenInventoryManager) {
            // Force close inventory panel if it exists
            const invPanel = document.getElementById('inventoryPanel');
            if (invPanel) {
                (invPanel as HTMLElement).classList.remove('open');
                (invPanel as HTMLElement).style.display = 'none';
            }
            // Force close crafting panel if it exists
            const craftPanel = document.getElementById('craftingPanel');
            if (craftPanel) {
                (craftPanel as HTMLElement).classList.remove('open');
                (craftPanel as HTMLElement).style.display = 'none';
            }
        }
        
        // Close skills panel if open
        if (this.titleScreenSkillsManager) {
            this.titleScreenSkillsManager.hide();
        }
        
        // Hide chat if open
        if (this.titleScreenChat && this.titleScreenChat.chatContainer) {
            this.titleScreenChat.hide();
        }

        // Tear down title-screen shop and mob gallery panels so they don't
        // conflict (duplicate IDs, stale event handlers) with the in-game
        // versions created by the Game's InventoryManager/ShopManager.
        if (this.titleScreenShopManager) {
            this.titleScreenShopManager.cleanup();
            this.titleScreenShopManager = null;
        }
        if (this.titleScreenMobGallery) {
            const mobGalleryPanel = document.getElementById('mobGalleryPanel');
            mobGalleryPanel?.remove();
            this.titleScreenMobGallery = null;
        }
    }

    public showTitleScreen(): void {
        // Reset connecting state so the title screen doesn't show the connecting animation
        this.isConnecting = false;

        // Show canvas
        if (this.uiCanvas) {
            this.uiCanvas.style.display = 'block';
        }
        // Restart canvas rendering
        this.startCanvasRendering();
        // Only show auth form if the user is not logged in
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        const currentUser = localStorage.getItem('currentUser') || sessionStorage.getItem('currentUser');
        if (!username || !password || !currentUser) {
            this.showAuthContainer();
        } else {
            this.hideAuthContainer();
        }
        this.showGameMenu();
        this.showCenterText();
        this.showFloatingPetals();
        this.showBackgroundCanvas();
        this.startBackgroundAnimation();

        // Re-show title screen chat
        if (this.titleScreenChat) {
            this.titleScreenChat.show();
        }

        // Hide game canvas initially (it will be shown when menus are opened)
        const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        if (gameCanvas) {
            gameCanvas.style.display = 'none';
        }
    }

    public showExitButton(): void {
        this.exitButtonContainer.style.display = 'flex';
        // Show the exit button when in game
        const exitButton = this.exitButtonContainer.querySelector('#exitButton') as HTMLElement;
        if (exitButton) {
            exitButton.style.display = 'flex';
        }
        // Also show bottom left buttons
        const bottomLeftButtons = document.getElementById('bottomLeftButtons');
        if (bottomLeftButtons) {
            bottomLeftButtons.style.display = 'flex';
        }
    }

    public hideExitButton(): void {
        // Don't hide the container completely, just hide the exit button
        // Keep settings button visible on title screen
        const exitButton = this.exitButtonContainer.querySelector('#exitButton') as HTMLElement;
        if (exitButton) {
            exitButton.style.display = 'none';
        }
        // Keep bottom left buttons visible on title screen
        // They are now always visible
    }

    public showDeathScreen(killedBy?: { type: string; tier: string }): void {
        this.deathScreen.classList.remove('hidden');
        
        // Update the death message with killer information
        const deathMessage = this.deathScreen.querySelector('.death-screen-content p');
        if (deathMessage && killedBy) {
            const mobName = this.getMobDisplayName(killedBy.type, killedBy.tier);
            deathMessage.textContent = `You were destroyed by: ${mobName}`;
        } else if (deathMessage) {
            deathMessage.textContent = 'Your adventure has come to an end...';
        }
    }

    public hideDeathScreen(): void {
        this.deathScreen.classList.add('hidden');
    }

    private getMobDisplayName(type: string, tier: string): string {
        // Capitalize the first letter of the type
        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
        
        // Capitalize the first letter of the tier
        const capitalizedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
        
        return `${capitalizedTier} ${capitalizedType}`;
    }

    public showLoadingScreen(): void {
        this.loadingScreen.classList.remove('hidden');
    }

    public hideLoadingScreen(): void {
        this.loadingScreen.classList.add('hidden');
    }

    // Getters for accessing form elements
    public getLoginUsername(): HTMLInputElement | null {
        return this.loginForm.querySelector('#loginUsername') as HTMLInputElement;
    }

    public getLoginPassword(): HTMLInputElement | null {
        return this.loginForm.querySelector('#loginPassword') as HTMLInputElement;
    }

    public getServerIPConnect(): HTMLInputElement | null {
        return this.loginForm.querySelector('#serverIP-connect') as HTMLInputElement;
    }

    public getLoginButton(): HTMLButtonElement | null {
        return this.loginForm.querySelector('#loginButton') as HTMLButtonElement;
    }

    public getRegisterUsername(): HTMLInputElement | null {
        return this.registerForm.querySelector('#registerUsername') as HTMLInputElement;
    }

    public getRegisterPassword(): HTMLInputElement | null {
        return this.registerForm.querySelector('#registerPassword') as HTMLInputElement;
    }

    public getRegisterConfirmPassword(): HTMLInputElement | null {
        return this.registerForm.querySelector('#registerConfirmPassword') as HTMLInputElement;
    }

    public getServerIPSingle(): HTMLInputElement | null {
        return this.registerForm.querySelector('#serverIP-single') as HTMLInputElement;
    }

    public getRegisterButton(): HTMLButtonElement | null {
        return this.registerForm.querySelector('#registerButton') as HTMLButtonElement;
    }

    public getRegisterOfflineButton(): HTMLButtonElement | null {
        return this.registerForm.querySelector('#registerOfflineButton') as HTMLButtonElement;
    }

    public getMultiPlayerButton(): HTMLButtonElement | null {
        // Return a dummy button that can be clicked programmatically
        // The actual button is now rendered on canvas
        let button = document.getElementById('multiPlayerButton') as HTMLButtonElement;
        if (!button) {
            button = document.createElement('button');
            button.style.display = 'none';
            button.id = 'multiPlayerButton';
            document.body.appendChild(button);
        }
        return button;
    }

    public getSettingsButton(): HTMLElement | null {
        return this.exitButtonContainer.querySelector('#settingsButton') as HTMLElement;
    }

    public getShowHitboxes(): boolean {
        const checkbox = this.settingsMenu.querySelector('#showHitboxesCheckbox') as HTMLInputElement;
        return checkbox ? checkbox.checked : false;
    }

    public getShadersEnabled(): boolean {
        const checkbox = this.settingsMenu.querySelector('#enableShadersCheckbox') as HTMLInputElement;
        return checkbox ? checkbox.checked : false;
    }

    public getShowStats(): boolean {
        const checkbox = this.settingsMenu.querySelector('#showStats') as HTMLInputElement;
        return checkbox ? checkbox.checked : false;
    }

    public getDynamicSkybox(): boolean {
        const checkbox = this.settingsMenu.querySelector('#dynamicSkyboxCheckbox') as HTMLInputElement;
        return checkbox ? checkbox.checked : false;
    }

    public getServerIP(): string {
        const input = this.settingsMenu.querySelector('#serverIP-settings') as HTMLInputElement;
        return input ? input.value : window.location.origin;
    }

    public getNameInput(): HTMLInputElement | null {
        // Return a dummy input that can be accessed programmatically
        // The actual input is now rendered on canvas
        let input = document.getElementById('nameInput') as HTMLInputElement;
        if (!input) {
            input = document.createElement('input');
            input.style.display = 'none';
            input.id = 'nameInput';
            document.body.appendChild(input);
        }
        input.value = this.playerName;
        return input;
    }

    public getHueSlider(): HTMLInputElement | null {
        return this.centerText.querySelector('#hueSlider') as HTMLInputElement;
    }

    public getColorPreview(): HTMLElement | null {
        return this.centerText.querySelector('#colorPreview') as HTMLElement;
    }

    public getUpdateColorButton(): HTMLButtonElement | null {
        return this.centerText.querySelector('#updateColorButton') as HTMLButtonElement;
    }

    public getExitButtonContainer(): HTMLElement {
        return this.exitButtonContainer;
    }

    public startFloatingPetals(): void {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.startAnimation();
        }
    }

    public stopFloatingPetals(): void {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.stopAnimation();
        }
    }

    public destroyFloatingPetals(): void {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.destroy();
        }
    }

    /**
     * Gets the SVG file path for a given biome
     */
    private getBiomeSvgPath(biomeName: string): string {
        const biomeSvgMap: { [key: string]: string } = {
            'default': './land.svg',
            'land': './land.svg',
            'desert': './desert.svg',
            'ocean': './ocean.svg',
            'ant_hell': './ant_hell.svg',
            'hel': './hel.svg',
            'sewers': './sewers.svg',
            'jungle': './jungle.svg'
        };
        
        return biomeSvgMap[biomeName] || biomeSvgMap['default'];
    }

    private async loadBackgroundTexture(biomeName?: string): Promise<void> {
        // Get biome from parameter or localStorage, default to 'default'
        const biome = biomeName || localStorage.getItem('spawnBiome') || 'default';
        const svgPath = this.getBiomeSvgPath(biome);
        
        return new Promise((resolve) => {
            this.backgroundTexture.onload = () => {
                console.log(`Title screen background loaded successfully for biome: ${biome}`);
                resolve();
            };
            this.backgroundTexture.onerror = (error) => {
                console.error(`Failed to load title screen background for biome ${biome}:`, error);
                // Create a fallback image to prevent broken state
                this.createFallbackImage();
                resolve();
            };
            
            // Load SVG file using fetch
            fetch(svgPath)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch SVG: ${response.statusText}`);
                    }
                    return response.text();
                })
                .then(svgText => {
                    try {
                        const base64 = btoa(unescape(encodeURIComponent(svgText)));
                        const dataUrl = `data:image/svg+xml;base64,${base64}`;
                        this.backgroundTexture.src = dataUrl;
                    } catch (error) {
                        console.error('Error encoding SVG:', error);
                        this.createFallbackImage();
                        resolve();
                    }
                })
                .catch(error => {
                    console.error(`Error loading SVG from ${svgPath}:`, error);
                    // Fallback to hardcoded default SVG
                    const svgText = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="400" x="0" y="0" fill="#1ea761"/>

  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#1c9959" transform="translate(60, 60) rotate(45)" stroke-width="7" stroke="#1c9959" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#2fb571" transform="translate(180, 80) rotate(-20)" stroke-width="7" stroke="#2fb571" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#1ca35e" transform="translate(300, 70) rotate(120)" stroke-width="7" stroke="#1ca35e" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#1c9959" transform="translate(100, 200) rotate(180)" stroke-width="7" stroke="#1c9959" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#1ca35e" transform="translate(250, 280) rotate(210)" stroke-width="7" stroke="#1ca35e" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#2fb571" transform="translate(340, 230) rotate(-90)" stroke-width="7" stroke="#2fb571" stroke-linejoin="round"/>
  <polygon points="0,-23.1 -20,11.55 20,11.55" fill="#1c9959" transform="translate(80, 300) rotate(75)" stroke-width="7" stroke="#1c9959" stroke-linejoin="round"/>

  <circle cx="150" cy="50" r="18" fill="#1c9959"/>
  <circle cx="280" cy="180" r="18" fill="#2fb571"/>
  <circle cx="50" cy="150" r="18" fill="#1ca35e"/>
  <circle cx="200" cy="350" r="18" fill="#1c9959"/>
  <circle cx="360" cy="320" r="18" fill="#2fb571"/>
</svg>`;
                    try {
                        const base64 = btoa(unescape(encodeURIComponent(svgText)));
                        const dataUrl = `data:image/svg+xml;base64,${base64}`;
                        this.backgroundTexture.src = dataUrl;
                    } catch (error) {
                        console.error('Error encoding fallback SVG:', error);
                        this.createFallbackImage();
                        resolve();
                    }
                });
        });
    }

    private createFallbackImage(): void {
        // Create a simple colored rectangle as fallback
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#00d885';
        ctx.fillRect(0, 0, 400, 400);
        this.backgroundTexture.src = canvas.toDataURL();
    }


    private createFallbackBackground(): void {
        console.log('Using fallback background for title screen');
        // Create a programmatic SVG that matches land.svg
        const svgContent = `
            <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
                <rect width="400" height="400" fill="#00d885"/>
                <polygon points="200,50 300,150 200,250 100,150" fill="#02c278"/>
                <polygon points="200,100 250,200 200,300 150,200" fill="#02c278"/>
                <polygon points="200,150 275,225 200,300 125,225" fill="#02c278"/>
                <polygon points="200,200 300,250 200,300 100,250" fill="#02c278"/>
                <polygon points="200,250 275,275 200,300 125,275" fill="#02c278"/>
                <polygon points="200,300 250,325 200,350 150,325" fill="#02c278"/>
                <polygon points="200,350 300,375 200,400 100,375" fill="#02c278"/>
            </svg>
        `;
        const base64 = btoa(unescape(encodeURIComponent(svgContent)));
        const dataUrl = `data:image/svg+xml;base64,${base64}`;
        this.backgroundTexture.src = dataUrl;
    }

    private drawScrollingBackground(): void {
        // Resize canvas to match window size
        this.backgroundCanvas.width = window.innerWidth;
        this.backgroundCanvas.height = window.innerHeight;

        // If background texture is not loaded or is broken, just fill with a color
        if (!this.backgroundTexture || !this.backgroundTexture.complete || this.backgroundTexture.naturalWidth === 0) {
            this.backgroundCtx.fillStyle = '#00d885'; // Default green color from the SVG
            this.backgroundCtx.fillRect(0, 0, this.backgroundCanvas.width, this.backgroundCanvas.height);
            return;
        }

        // Get the size of the background texture (400x400 from the SVG)
        const bgWidth = this.backgroundTexture.width;
        const bgHeight = this.backgroundTexture.height;

        // Create circular scrolling effect
        const radius = 2000; // Large radius for slow circular movement
        const centerX = this.backgroundCanvas.width / 2;
        const centerY = this.backgroundCanvas.height / 2;
        
        // Calculate camera position based on circular motion (much slower)
        const cameraX = centerX + Math.cos(this.backgroundTime * 0.00002) * radius;
        const cameraY = centerY + Math.sin(this.backgroundTime * 0.00002) * radius;

        // Calculate the visible area
        const visibleWidth = this.backgroundCanvas.width;
        const visibleHeight = this.backgroundCanvas.height;

        // Calculate the starting position for tiling (offset by camera position)
        const startX = Math.floor(cameraX / bgWidth) * bgWidth;
        const startY = Math.floor(cameraY / bgHeight) * bgHeight;

        // Scale each tile up by 2 pixels to prevent rendering artifacts and gaps
        const TILE_OVERLAP = 2;
        const scaledWidth = bgWidth + TILE_OVERLAP;
        const scaledHeight = bgHeight + TILE_OVERLAP;

        // Calculate how many tiles we need to draw
        const tilesX = Math.ceil(visibleWidth / bgWidth) + 2;
        const tilesY = Math.ceil(visibleHeight / bgHeight) + 2;

        // Draw the tiled background
        try {
            for (let i = 0; i <= tilesX; i++) {
                for (let j = 0; j <= tilesY; j++) {
                    // Calculate base position
                    const baseX = startX + (i * bgWidth) - cameraX;
                    const baseY = startY + (j * bgHeight) - cameraY;
                    
                    // Adjust position to center the overlap (draw 1 pixel to the left and top)
                    const x = Math.floor(baseX - TILE_OVERLAP / 2);
                    const y = Math.floor(baseY - TILE_OVERLAP / 2);
                    
                    // Draw tile scaled up by 2 pixels to ensure no gaps
                    this.backgroundCtx.drawImage(this.backgroundTexture, x, y, scaledWidth, scaledHeight);
                }
            } 
        } catch (error) {
                console.log('Error drawing background:', error);
        }
    }

    private animateBackground(): void {
        this.backgroundTime += 16; // ~60fps
        this.drawScrollingBackground();
        
        // Only handle canvas resizing on title screen (not in-game)
        // In-game, the Graphics class handles menu rendering on the full-screen canvas
        if (!(window as any).currentGame) {
            // Render changelog and notifications menus on game canvas (title screen only)
            const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
            if (gameCanvas) {
                const changelogOpen = this.changelogManager.isChangelogOpen();
                const notificationsOpen = this.notificationsManager.isNotificationsOpen();
                const leaderboardOpen = this.leaderboardManager.isLeaderboardOpen();

                if (changelogOpen || notificationsOpen || leaderboardOpen) {
                    // Menu is open - resize canvas to only cover menu area
                    const PANEL_X = 20;
                    const PANEL_Y = 72;
                    const PANEL_WIDTH = 600;
                    const PANEL_HEIGHT = 500;

                    // Set canvas size to menu dimensions
                    if (gameCanvas.width !== PANEL_WIDTH || gameCanvas.height !== PANEL_HEIGHT) {
                        gameCanvas.width = PANEL_WIDTH;
                        gameCanvas.height = PANEL_HEIGHT;
                        // Re-setup canvas on managers if dimensions changed
                        this.changelogManager.setCanvas(gameCanvas);
                        this.notificationsManager.setCanvas(gameCanvas);
                        this.leaderboardManager.setCanvas(gameCanvas);
                    }

                    // Position canvas at menu location and show it
                    gameCanvas.style.position = 'absolute';
                    gameCanvas.style.left = `${PANEL_X}px`;
                    gameCanvas.style.top = `${PANEL_Y}px`;
                    gameCanvas.style.width = `${PANEL_WIDTH}px`;
                    gameCanvas.style.height = `${PANEL_HEIGHT}px`;
                    gameCanvas.style.zIndex = '2000';
                    gameCanvas.style.pointerEvents = 'auto';
                    gameCanvas.style.display = 'block';

                    // Clear canvas before rendering
                    const ctx = gameCanvas.getContext('2d');
                    if (ctx) {
                        ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
                    }

                    // Render menus (coordinates are relative to canvas, which is now at menu position)
                    this.changelogManager.render();
                    this.notificationsManager.render();
                    this.leaderboardManager.render();
                } else {
                    // No menus open - hide canvas
                    gameCanvas.style.display = 'none';
                    // Clear canvas
                    const ctx = gameCanvas.getContext('2d');
                    if (ctx && gameCanvas.width > 0 && gameCanvas.height > 0) {
                        ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
                    }
                }
            }
        }
        
        this.backgroundAnimationId = requestAnimationFrame(() => this.animateBackground());
    }

    public startBackgroundAnimation(): void {
        if (!this.backgroundAnimationId) {
            this.animateBackground();
        }
    }

    public stopBackgroundAnimation(): void {
        if (this.backgroundAnimationId) {
            cancelAnimationFrame(this.backgroundAnimationId);
            this.backgroundAnimationId = 0;
        }
    }

    public hideFloatingPetals(): void {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.stopAnimation();
        }
        if (this.floatingPetalsContainer) {
            this.floatingPetalsContainer.style.display = 'none';
        }
    }

    public showFloatingPetals(): void {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.startAnimation();
        }
        if (this.floatingPetalsContainer) {
            this.floatingPetalsContainer.style.display = 'block';
        }
    }

    public hideBackgroundCanvas(): void {
        if (this.backgroundCanvas) {
            this.backgroundCanvas.style.display = 'none';
        }
    }

    public showBackgroundCanvas(): void {
        if (this.backgroundCanvas) {
            this.backgroundCanvas.style.display = 'block';
        }
    }

    private toggleInventoryOnTitleScreen(): void {
        // Use the title screen inventory manager
        this.titleScreenInventoryManager.toggleInventory();
    }

    private toggleCraftingOnTitleScreen(): void {
        // Check if game is running - if so, use game's crafting
        if (window.currentGame && (window.currentGame as any).inventoryManager) {
            (window.currentGame as any).inventoryManager.toggleCrafting();
            return;
        }

        // Use title screen inventory manager to show crafting
        this.titleScreenInventoryManager.toggleCrafting();
    }

    private toggleSkillsOnTitleScreen(): void {
        // Check if game is running - if so, use game's skills
        if (window.currentGame && (window.currentGame as any).skillsManager) {
            (window.currentGame as any).skillsManager.toggle();
            return;
        }

        // Use title screen skills manager
        if (this.titleScreenSkillsManager) {
            this.titleScreenSkillsManager.toggle();
        } else {
            alert('Please start the game to view and upgrade your skills.');
        }
    }

    private initializeTitleScreenChat(): void {
        // Wait for preconnected socket to be available
        const checkSocket = setInterval(() => {
            if (window.preconnectedSocket && window.preconnectedSocket.connected) {
                console.log('[TitleScreen] Initializing chat with preconnected socket');
                this.titleScreenChat = new Chat(window.preconnectedSocket);
                clearInterval(checkSocket);
            }
        }, 100);

        // Timeout after 5 seconds if socket doesn't connect
        setTimeout(() => {
            clearInterval(checkSocket);
            if (!this.titleScreenChat && window.preconnectedSocket && window.preconnectedSocket.connected) {
                console.log('[TitleScreen] Initializing chat with preconnected socket (delayed)');
                this.titleScreenChat = new Chat(window.preconnectedSocket);
            }
        }, 5000);
    }

    private initializeTitleScreenSkills(): void {
        // Create a minimal game interface for skills manager
        const createGameInterface = () => ({
            getLocalPlayer: () => {
                // Get player data from title screen inventory manager
                const playerData = (this.titleScreenInventoryManager as any).playerData;
                if (!playerData) return undefined;
                
                return {
                    id: window.preconnectedSocket?.id || '',
                    name: localStorage.getItem('username') || 'Unnamed',
                    x: 0,
                    y: 0,
                    angle: 0,
                    score: 0,
                    imageLoaded: true,
                    image: new Image(),
                    velocityX: 0,
                    velocityY: 0,
                    health: 100,
                    maxHealth: 100,
                    damage: 10,
                    inventory: playerData.inventory,
                    loadout: playerData.loadout,
                    level: 1,
                    xp: 0,
                    xpToNextLevel: 100,
                    tp: playerData.tp || 0,
                    skills: playerData.skills || {}
                } as Player;
            },
            getSocket: () => window.preconnectedSocket,
            showFloatingText: () => {}, // No-op for title screen
            canvas: document.createElement('canvas')
        });

        // Wait for socket to be available
        const checkSocket = setInterval(() => {
            if (window.preconnectedSocket && window.preconnectedSocket.connected) {
                console.log('[TitleScreen] Initializing skills manager with preconnected socket');
                this.titleScreenSkillsManager = new SkillsManager(createGameInterface());
                // Refresh skills if player data is already available
                const playerData = (this.titleScreenInventoryManager as any).playerData;
                if (playerData && playerData.tp !== undefined && playerData.skills) {
                    this.titleScreenSkillsManager.updateSkills(playerData.tp || 0, playerData.skills || {});
                }
                clearInterval(checkSocket);
            }
        }, 100);

        // Timeout after 5 seconds if socket doesn't connect
        setTimeout(() => {
            clearInterval(checkSocket);
            if (!this.titleScreenSkillsManager && window.preconnectedSocket && window.preconnectedSocket.connected) {
                console.log('[TitleScreen] Initializing skills manager with preconnected socket (delayed)');
                this.titleScreenSkillsManager = new SkillsManager(createGameInterface());
                // Refresh skills if player data is already available
                const playerData = (this.titleScreenInventoryManager as any).playerData;
                if (playerData && playerData.tp !== undefined && playerData.skills) {
                    this.titleScreenSkillsManager.updateSkills(playerData.tp || 0, playerData.skills || {});
                }
            }
        }, 5000);
    }

    private cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d')?.drawImage(src, 0, 0);
        return c;
    }

    private buildTitleScreenGameInterface() {
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = window.innerWidth;
        offscreenCanvas.height = window.innerHeight;
        return {
            getLocalPlayer: () => {
                const playerData = (this.titleScreenInventoryManager as any).playerData;
                if (!playerData) return undefined;
                return {
                    id: window.preconnectedSocket?.id || '',
                    name: localStorage.getItem('username') || 'Unnamed',
                    x: 0,
                    y: 0,
                    angle: 0,
                    score: 0,
                    imageLoaded: true,
                    image: new Image(),
                    velocityX: 0,
                    velocityY: 0,
                    health: 100,
                    maxHealth: 100,
                    damage: 10,
                    inventory: playerData.inventory,
                    loadout: playerData.loadout,
                    level: 1,
                    xp: 0,
                    xpToNextLevel: 100,
                    tp: playerData.tp || 0,
                    skills: playerData.skills || {},
                    stars: playerData.stars || 0,
                    mobKills: playerData.mobKills || {}
                } as any;
            },
            getSocket: () => window.preconnectedSocket,
            showFloatingText: () => {},
            showFallingStars: () => {},
            canvas: offscreenCanvas,
            getPetalCanvas: (petalType: string, rarity: string, time: number = Date.now()): HTMLCanvasElement | null => {
                const assets = (window as any).preloadedAssets;
                if (!assets || !assets.petalImages) return null;
                const key = `${petalType}_${rarity}`;
                const entry = assets.petalImages[key];
                if (!entry) return null;
                if (Array.isArray(entry)) {
                    const frameIndex = Math.floor((time / 42) % entry.length);
                    // Clone so the same cache canvas isn't appended to multiple DOM nodes
                    return this.cloneCanvas(entry[frameIndex]);
                }
                return this.cloneCanvas(entry);
            },
            getItemSpriteDataUrl: (itemType: string): string | null => {
                const assets = (window as any).preloadedAssets;
                if (!assets || !assets.itemSprites) return null;
                const img = assets.itemSprites[itemType];
                if (!img) return null;
                try {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth || 32;
                    c.height = img.naturalHeight || 32;
                    c.getContext('2d')?.drawImage(img, 0, 0);
                    return c.toDataURL('image/png');
                } catch { return null; }
            }
        };
    }

    private initializeTitleScreenShop(): void {
        const gameInterface = this.buildTitleScreenGameInterface();
        const initShop = () => {
            if (this.titleScreenShopManager) return;
            console.log('[TitleScreen] Initializing shop manager');
            this.titleScreenShopManager = new ShopManager(gameInterface as any);

            // Wire up shop socket events (same as socket.ts in-game handlers)
            const socket = window.preconnectedSocket;
            if (!socket) return;
            socket.on('shopPurchaseSuccess', (data: { inventory: any, stars: number }) => {
                const playerData = (this.titleScreenInventoryManager as any).playerData;
                if (playerData) {
                    playerData.inventory = data.inventory;
                    playerData.stars = data.stars;
                }
                this.titleScreenShopManager?.handlePurchaseSuccess();
                this.titleScreenShopManager?.updateStarsDisplay();
            });
            socket.on('shopPurchaseError', (message: string) => {
                this.titleScreenShopManager?.handlePurchaseError(message);
            });
            socket.on('codeRedeemSuccess', (data: { code?: string, stars: number, totalStars: number }) => {
                const playerData = (this.titleScreenInventoryManager as any).playerData;
                if (playerData) playerData.stars = data.totalStars;
                this.titleScreenShopManager?.handleCodeRedeemSuccess(data.stars);
                this.titleScreenShopManager?.updateStarsDisplay();
            });
            socket.on('codeRedeemError', (message: string) => {
                this.titleScreenShopManager?.handleCodeRedeemError(message);
            });
            socket.on('starsEarned', (data: { amount: number, total: number }) => {
                const playerData = (this.titleScreenInventoryManager as any).playerData;
                if (playerData) playerData.stars = data.total;
                this.titleScreenShopManager?.updateStarsDisplay();
            });
        };
        const checkSocket = setInterval(() => {
            if (window.preconnectedSocket && window.preconnectedSocket.connected) {
                initShop();
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => clearInterval(checkSocket), 5000);
    }

    private initializeTitleScreenMobGallery(): void {
        const gameInterface = this.buildTitleScreenGameInterface();
        const initGallery = () => {
            if (this.titleScreenMobGallery) return;
            console.log('[TitleScreen] Initializing mob gallery manager');
            this.titleScreenMobGallery = new InventoryManager(gameInterface as any, null, { mobGalleryOnly: true });
        };
        const checkSocket = setInterval(() => {
            if (window.preconnectedSocket && window.preconnectedSocket.connected) {
                initGallery();
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => clearInterval(checkSocket), 5000);
    }
}

/**
 * Title Screen Inventory Manager
 * Handles inventory and loadout on the title screen using the preconnected socket
 */
class TitleScreenInventoryManager {
    private inventoryPanel: HTMLDivElement | null = null;
    private craftingPanel: HTMLDivElement | null = null;
    private loadoutBar: HTMLDivElement | null = null;
    private playerData: { inventory: PlayerInventory; loadout: (Item | null)[]; tp?: number; skills?: any; stars?: number; mobKills?: any } | null = null;
    private socket: any = null;
    private craftingItems: Item[] = [];
    private isCraftingOpen: boolean = false;
    private isAuthenticated: boolean = false;
    private readonly LOADOUT_SLOTS = 10;
    private readonly LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    private readonly ITEM_RARITY_COLORS: Record<string, string> = {
        common: '#7eef6d',
        uncommon: '#ffe65d',
        rare: '#4d52e3',
        epic: '#861fde',
        legendary: '#de1f1f',
        mythic: '#1fdbde',
        ultra: '#de1f65',
        super: '#2bffa4',
        unique: '#bf00ff'
    };
    private tooltipElement: HTMLDivElement | null = null;
    private tooltipTimeout: number | null = null;
    private hoveredElement: HTMLElement | null = null;

    constructor() {
        this.initializeLoadoutBar();
        this.initializeCraftingPanel();
        this.setupSocketListeners();
        this.setupGlobalDragAndDrop();
        
        // Setup ALT key tracking for tooltip value display (only once globally)
        if (!(window as any).altKeyTrackingSetup) {
            (window as any).altKeyPressed = false;
            (window as any).altKeyTrackingSetup = true;
            (window as any).titleScreenInventoryManagers = [];
            document.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Alt') {
                    (window as any).altKeyPressed = true;
                    // Update all tooltips
                    const managers = (window as any).titleScreenInventoryManagers || [];
                    managers.forEach((manager: TitleScreenInventoryManager) => {
                        if (manager.tooltipElement) {
                            manager.updateTooltipValues(true);
                        }
                    });
                }
            });
            document.addEventListener('keyup', (e: KeyboardEvent) => {
                if (e.key === 'Alt') {
                    (window as any).altKeyPressed = false;
                    // Update all tooltips
                    const managers = (window as any).titleScreenInventoryManagers || [];
                    managers.forEach((manager: TitleScreenInventoryManager) => {
                        if (manager.tooltipElement) {
                            manager.updateTooltipValues(false);
                        }
                    });
                }
            });
        }
        // Register this instance
        if (!(window as any).titleScreenInventoryManagers) {
            (window as any).titleScreenInventoryManagers = [];
        }
        (window as any).titleScreenInventoryManagers.push(this);
    }
    
    private setupGlobalDragAndDrop(): void {
        // Handle dropping items outside loadout slots to move them back to inventory
        document.addEventListener('dragover', (e: Event) => {
            e.preventDefault();
        });
        
        document.addEventListener('drop', (e: Event) => {
            e.preventDefault();
            const dragEvent = e as DragEvent;
            const target = e.target as HTMLElement;
            
            // If dropped outside loadout slots and inventory grid, move item back to inventory
            if (!target.closest('.loadout-slot') && !target.closest('.inventory-grid') && !target.closest('.crafting-inventory-grid')) {
                const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (loadoutSlot) {
                    this.moveItemToInventory(parseInt(loadoutSlot));
                }
            }
        });
    }

    private initializeLoadoutBar(): void {
        // Create loadout bar for title screen
        const loadoutContainer = document.getElementById('titleScreenLoadoutBar');
        if (!loadoutContainer) {
            // Retry after a short delay if container doesn't exist yet
            setTimeout(() => this.initializeLoadoutBar(), 100);
            return;
        }

        this.loadoutBar = loadoutContainer as HTMLDivElement;
        
        // Add drag-over style class support (only once)
        if (!document.getElementById('titleScreenLoadoutStyles')) {
            const style = document.createElement('style');
            style.id = 'titleScreenLoadoutStyles';
            style.textContent = `
                #titleScreenLoadoutBar .loadout-slot.drag-over {
                    border-color: #00ff00 !important;
                    background-color: rgba(0, 255, 0, 0.2) !important;
                    transform: scale(1.05);
                }
            `;
            document.head.appendChild(style);
        }
        
        for (let i = 0; i < this.LOADOUT_SLOTS; i++) {
            const slot = document.createElement('div');
            slot.className = 'loadout-slot';
            slot.dataset.slot = i.toString();
            slot.style.width = '70px';
            slot.style.height = '70px';
            slot.style.backgroundColor = 'rgba(99, 255, 182, 1)';
            slot.style.border = '3px solid #00ba3e';
            slot.style.borderRadius = '5px';
            slot.style.position = 'relative';
            slot.style.display = 'flex';
            slot.style.alignItems = 'center';
            slot.style.justifyContent = 'center';
            slot.style.transition = 'all 0.2s ease';
            
            // Add key binding label
            const keyText = document.createElement('div');
            keyText.className = 'key-binding';
            keyText.textContent = this.LOADOUT_KEY_BINDINGS[i];
            keyText.style.cssText = `
                position: absolute;
                top: 5px;
                left: 5px;
                color: white;
                font-size: 16px;
                font-weight: bold;
                pointer-events: none;
            `;
            slot.appendChild(keyText);
            
            if (this.loadoutBar) {
                this.loadoutBar.appendChild(slot);
            }
        }
    }

    private setupSocketListeners(): void {
        // Check for preconnected socket and authenticate early to get player data
        if (window.preconnectedSocket && window.preconnectedSocket.connected) {
            this.socket = window.preconnectedSocket;
            this.authenticateAndFetchData();
            this.setupCraftingSocketListeners();
            this.setupSkillsSocketListeners();
        } else {
            // Wait for socket to connect
            const checkSocket = setInterval(() => {
                if (window.preconnectedSocket && window.preconnectedSocket.connected) {
                    this.socket = window.preconnectedSocket;
                    this.authenticateAndFetchData();
                    this.setupCraftingSocketListeners();
                    this.setupSkillsSocketListeners();
                    clearInterval(checkSocket);
                }
            }, 100);
        }
    }

    private setupSkillsSocketListeners(): void {
        if (!this.socket) return;
        
        // Listen for skills updates - this will be handled by index.ts which has access to titleScreen
        // We just update our local skills data here
        this.socket.on('skillsUpdated', (data: { playerId: string; tp: number; skills: { [key: string]: string } }) => {
            console.log('[TitleScreenInventory] skillsUpdated received:', data);
            // Check if this is for the current player
            if (data.playerId === this.socket.id) {
                // Update skills data in inventory manager
                this.updateSkillsData(data.tp, data.skills);
            }
        });
    }

    private setupCraftingSocketListeners(): void {
        if (!this.socket) return;
        
        // Listen for crafting finished event (server emits 'craftingFinished', not 'craftResult')
        this.socket.on('craftingFinished', (data: { successCount: number; failCount: number; newItem: { type: string; rarity: string }; inventory: any }) => {
            console.log('[TitleScreen] craftingFinished received:', data);

            // Update inventory
            if (this.playerData) {
                this.playerData.inventory = data.inventory;
            }
            
            if (data.successCount > 0) {
                // Parse item type and petalType from itemKey
                const itemKey = data.newItem.type;
                let itemType: Item['type'] = 'petal';
                let petalType: string | undefined;
                
                if (itemKey.startsWith('petal_')) {
                    itemType = 'petal';
                    petalType = itemKey.substring(6);
                } else {
                    itemType = itemKey as Item['type'];
                }
                
                const displayItem: Item = {
                    type: itemType,
                    rarity: data.newItem.rarity as Item['rarity'],
                    petalType: petalType
                };
                
                this.showCraftingSuccess(displayItem, data.successCount);
            }
            
            if (data.failCount > 0) {
                console.log(`[TitleScreen] Failed to craft ${data.failCount}x. Items were lost.`);
            }
            
            // Update displays
            if (this.isCraftingOpen) {
                this.updateCraftingInventoryPreview();
                this.updateInventoryDisplay();
            }
        });
        
        // Listen for crafting failures
        this.socket.on('craftingFailed', (error: string) => {
            alert(error);
        });
        
        // Listen for player updates to refresh inventory
        this.socket.on('playerUpdated', (updatedPlayer: any) => {
            if (updatedPlayer.inventory) {
                if (this.playerData) {
                    this.playerData.inventory = updatedPlayer.inventory;
                }
                if (this.isCraftingOpen) {
                    this.updateCraftingInventoryPreview();
                    this.updateInventoryDisplay();
                }
            }
            if (this.playerData) {
                if (updatedPlayer.stars !== undefined) this.playerData.stars = updatedPlayer.stars;
                if (updatedPlayer.mobKills) this.playerData.mobKills = updatedPlayer.mobKills;
            }
        });
    }

    private authenticateAndFetchData(): void {
        if (!this.socket || !this.socket.connected) return;

        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        // Get player name from localStorage or the name input element
        const nameInput = document.getElementById('nameInput') as HTMLInputElement;
        const playerName = (nameInput?.value || localStorage.getItem('playerName') || 'Unnamed');
        const spawnBiome = localStorage.getItem('spawnBiome') || 'default';

        if (!username || !password) return;

        console.log('[TitleScreenInventory] Authenticating to fetch player data...');
        
        // Authenticate to get player data (this will spawn on server but we won't show game until Ready)
        // Use a flag to prevent duplicate authentication
        if ((this.socket as any)._titleScreenAuthenticated) {
            console.log('[TitleScreenInventory] Already authenticated, skipping');
            return;
        }
        
        (this.socket as any)._titleScreenAuthenticated = true;
        
        this.socket.emit('authenticate', {
            username,
            password,
            playerName,
            spawnBiome
        });

        // Listen for authentication response (use on instead of once to catch it if already sent)
        const authenticatedHandler = (response: { success: boolean; error?: string; player?: any }) => {
            if (response.success && response.player) {
                console.log('[TitleScreenInventory] Received player data:', response.player);
                this.isAuthenticated = true;
                // inventory may come as either a PlayerInventory array (triples
                // of [rarityId, itemId, count]) or a dict keyed by rarity.
                // Only run dictToInventory when it's a plain object.
                const rawInv = response.player.inventory;
                const normalizedInv = Array.isArray(rawInv)
                    ? rawInv
                    : (rawInv ? dictToInventory(rawInv) : []);
                this.playerData = {
                    inventory: normalizedInv,
                    loadout: (() => { const a = response.player.loadout || []; const o: any[] = new Array(20).fill(null); for (let i = 0; i < Math.min(a.length, 20); i++) o[i] = a[i] || null; return o; })(),
                    tp: response.player.tp,
                    skills: response.player.skills,
                    stars: response.player.stars || 0,
                    mobKills: response.player.mobKills || {}
                };
                console.log('[TitleScreenInventory] Normalized inventory, len=', normalizedInv.length, 'rawType=', Array.isArray(rawInv) ? 'array' : typeof rawInv);
                this.updateLoadoutDisplay();
                // Always refresh the inventory display if the panel exists.
                // The user may have already clicked the inventory button before
                // authentication completed, leaving the panel open but empty;
                // this re-populates it once data arrives.
                if (this.inventoryPanel) {
                    this.updateInventoryDisplay();
                }
                // Mark socket as authenticated - this allows operations to proceed
                // The server sets socket.username during authentication, but we ensure it's set here too
                if (this.socket && !(this.socket as any).username) {
                    const username = localStorage.getItem('username');
                    if (username) {
                        (this.socket as any).username = username;
                    }
                }
                
                // Loadout has loaded, notify title screen to stop showing connecting
                if ((window as any).titleScreen) {
                    (window as any).titleScreen.onLoadoutLoaded();
                }
            }
        };
        
        // Check if already authenticated (socket might have authenticated before we set up listener)
        if ((this.socket as any)._authenticatedData) {
            authenticatedHandler((this.socket as any)._authenticatedData);
        } else {
            this.socket.on('authenticated', authenticatedHandler);
        }
    }

    // private authenticateAndFetchData(): void {
    //     if (!this.socket || !this.socket.connected) return;

    //     const username = localStorage.getItem('username');
    //     const password = localStorage.getItem('password');
    //     const playerName = (document.getElementById('nameInput') as HTMLInputElement)?.value || 'Unnamed';
    //     const spawnBiome = localStorage.getItem('spawnBiome') || 'default';

    //     if (!username || !password) return;

    //     console.log('[TitleScreenInventory] Authenticating to fetch player data...');
        
    //     // Authenticate to get player data
    //     this.socket.emit('authenticate', {
    //         username,
    //         password,
    //         playerName,
    //         spawnBiome
    //     });

    //     // Listen for authentication response
    //     this.socket.once('authenticated', (response: { success: boolean; error?: string; player?: any }) => {
    //         if (response.success && response.player) {
    //             console.log('[TitleScreenInventory] Received player data:', response.player);
    //             this.playerData = {
    //                 inventory: response.player.inventory || {},
    //                 loadout: response.player.loadout || Array(10).fill(null)
    //             };
    //             this.updateLoadoutDisplay();
    //             this.updateInventoryDisplay();
    //         }
    //     });
    // }

    private updateLoadoutDisplay(): void {
        if (!this.loadoutBar || !this.playerData) return;

        const slots = this.loadoutBar.querySelectorAll('.loadout-slot');
        slots.forEach((slot, index) => {
            const slotElement = slot as HTMLElement;
            slotElement.innerHTML = '';
            slotElement.classList.remove('on-cooldown', 'petal-slot');
            slotElement.style.backgroundColor = '';
            slotElement.style.borderColor = '';
            slotElement.dataset.slot = index.toString();
            
            // Add key binding back
            const keyText = document.createElement('div');
            keyText.className = 'key-binding';
            keyText.textContent = this.LOADOUT_KEY_BINDINGS[index];
            keyText.style.cssText = `
                position: absolute;
                top: 5px;
                left: 5px;
                color: white;
                font-size: 12px;
                pointer-events: none;
                z-index: 5;
            `;
            slotElement.appendChild(keyText);

            const item = this.playerData?.loadout[index];
            if (item) {
                // Handle cooldown state
                if (item.onCooldown) {
                    slotElement.classList.add('on-cooldown');
                }

                // Handle different item types
                if (item.type === 'petal' && item.petalType && item.rarity) {
                    slotElement.classList.add('petal-slot');
                    
                    // Set background and border colors based on rarity
                    if (this.ITEM_RARITY_COLORS[item.rarity]) {
                        const rarityColor = this.ITEM_RARITY_COLORS[item.rarity];
                        slotElement.style.backgroundColor = rarityColor;
                        slotElement.style.borderColor = this.darkenColor(rarityColor);
                    }
                    
                    const stats = getPetalStats(item.petalType, item.rarity);
                    if (stats && stats.image) {
                        // Create petal visual container
                        const petalDiv = document.createElement('div');
                        petalDiv.style.width = '60%';
                        petalDiv.style.height = '60%';
                        petalDiv.style.display = 'flex';
                        petalDiv.style.alignItems = 'center';
                        petalDiv.style.justifyContent = 'center';
                        petalDiv.style.position = 'relative';
                        
                        // Use img element with SVG data URL
                        const img = document.createElement('img');
                        img.style.width = '100%';
                        img.style.height = '100%';
                        img.style.objectFit = 'contain';
                        img.draggable = true;
                        img.style.cursor = 'grab';
                        
                        // Convert SVG to data URL
                        const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                        const url = URL.createObjectURL(svgBlob);
                        img.src = url;
                        
                        petalDiv.appendChild(img);
                        slotElement.appendChild(petalDiv);
                        
                        // Show health bar for petals
                        if (item.health !== undefined && item.maxHealth !== undefined && item.maxHealth > 0) {
                            const healthBar = document.createElement('div');
                            healthBar.style.position = 'absolute';
                            healthBar.style.bottom = '0';
                            healthBar.style.left = '0';
                            healthBar.style.width = '100%';
                            healthBar.style.height = '3px';
                            healthBar.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
                            
                            const healthFill = document.createElement('div');
                            const clampedHealth = Math.max(0, item.health);
                            const healthPercentage = clampedHealth / item.maxHealth;
                            healthFill.style.width = `${healthPercentage * 100}%`;
                            healthFill.style.height = '100%';
                            healthFill.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
                            
                            healthBar.appendChild(healthFill);
                            slotElement.appendChild(healthBar);
                        }
                        
                        // Add petal name label
                        const petalName = this.formatPetalName(item.petalType);
                        if (petalName) {
                            const nameLabel = document.createElement('div');
                            nameLabel.className = 'petal-name';
                            nameLabel.textContent = petalName;
                            nameLabel.style.cssText = `
                                position: absolute;
                                bottom: 5px;
                                left: 50%;
                                transform: translateX(-50%);
                                color: white;
                                font-size: 10px;
                                font-weight: bold;
                                text-shadow: 
                                    -1px -1px 0 #000,
                                    1px -1px 0 #000,
                                    -1px 1px 0 #000,
                                    1px 1px 0 #000,
                                    0 0 3px rgba(0,0,0,0.8);
                                white-space: nowrap;
                                pointer-events: none;
                                z-index: 10;
                            `;
                            slotElement.appendChild(nameLabel);
                        }

                        // Setup tooltip for loadout petal
                        if (item.rarity) {
                            this.setupTooltip(slotElement, item.petalType, item.rarity);
                        }
                    }
                } else if (item.type) {
                    // Regular items (health potion, speed boost, shield)
                    const img = document.createElement('img');
                    img.src = `./assets/${item.type}.png`;
                    img.alt = item.type;
                    img.style.width = '60%';
                    img.style.height = '60%';
                    img.style.objectFit = 'contain';
                    img.draggable = true;
                    img.style.cursor = 'grab';
                    slotElement.appendChild(img);
                }
            }
        });
        
        // Re-setup drag and drop listeners after updating display
        this.setupLoadoutDragAndDrop();
    }
    
    private formatPetalName(petalType: string): string {
        if (!petalType) return "";
        let itemName = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
        itemName = itemName.replace('_', ' ');
        return itemName;
    }
    
    private setupLoadoutDragAndDrop(): void {
        if (!this.loadoutBar) return;
        
        const slots = this.loadoutBar.querySelectorAll('.loadout-slot');
        
        // Setup draggable items in slots
        slots.forEach((slot, slotIndex) => {
            const slotElement = slot as HTMLElement;
            
            // Find draggable element (img or petal div)
            const img = slotElement.querySelector('img');
            const petalDiv = slotElement.querySelector('div[style*="display: flex"]');
            let draggableElement: HTMLElement | null = img as HTMLElement || (petalDiv as HTMLElement) || slotElement;
            
            if (draggableElement && slotElement.querySelector('img, div[style*="display: flex"]')) {
                draggableElement.draggable = true;
                draggableElement.style.cursor = 'grab';
                
                // Remove old listeners by cloning
                const newElement = draggableElement.cloneNode(true) as HTMLElement;
                draggableElement.parentNode?.replaceChild(newElement, draggableElement);
                draggableElement = newElement;
                
                draggableElement.addEventListener('dragstart', (e: Event) => {
                    e.stopPropagation();
                    const dragEvent = e as DragEvent;
                    dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                    dragEvent.dataTransfer!.effectAllowed = 'move';
                });
            }
        });
        
        // Setup drop listeners on slots
        slots.forEach((slot, slotIndex) => {
            const slotElement = slot as HTMLElement;
            
            // Remove old listeners by cloning
            const newSlot = slotElement.cloneNode(true) as HTMLElement;
            slotElement.parentNode?.replaceChild(newSlot, slotElement);
            
            newSlot.addEventListener('dragenter', (e: Event) => {
                e.preventDefault();
                newSlot.classList.add('drag-over');
            });
            
            newSlot.addEventListener('dragover', (e: Event) => {
                e.preventDefault();
                const dragEvent = e as DragEvent;
                dragEvent.dataTransfer!.dropEffect = 'move';
                newSlot.classList.add('drag-over');
            });
            
            newSlot.addEventListener('dragleave', (e: Event) => {
                newSlot.classList.remove('drag-over');
            });
            
            newSlot.addEventListener('drop', (e: Event) => {
                e.preventDefault();
                const dragEvent = e as DragEvent;
                newSlot.classList.remove('drag-over');
                
                const itemData = dragEvent.dataTransfer?.getData('text/plain');
                const fromLoadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                
                if (itemData) {
                    // Item from inventory
                    const { rarity, type } = JSON.parse(itemData);
                    const slot = parseInt(newSlot.dataset.slot || '-1');
                    if (rarity && type && slot >= 0) {
                        this.equipItemToLoadout(rarity, type, slot);
                    }
                } else if (fromLoadoutSlot) {
                    // Item from another loadout slot
                    const fromSlot = parseInt(fromLoadoutSlot);
                    const toSlot = slotIndex;
                    if (fromSlot !== toSlot) {
                        this.swapLoadoutItems(fromSlot, toSlot);
                    }
                }
            });
        });
    }
    
    private equipItemToLoadout(rarity: string, type: string, loadoutSlot: number): void {
        if (!this.playerData || loadoutSlot >= this.LOADOUT_SLOTS || this.getItemCount(rarity, type) === 0) return;
        
        // Parse petal type if it's a petal
        let itemType: Item['type'];
        let petalType: string | undefined;
        
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6);
        } else {
            itemType = type as Item['type'];
        }
        
        const item: Item = { 
            type: itemType, 
            rarity: rarity as Item['rarity'],
            petalType: petalType
        };
        
        // Initialize health for petals
        if (itemType === 'petal' && petalType && rarity) {
            const stats = getPetalStats(petalType, rarity);
            if (stats) {
                item.health = stats.health;
                item.maxHealth = stats.health;
                item.onCooldown = true;
            }
        }
        
        const newLoadout = [...this.playerData.loadout];
        
        this.removeItem(rarity, type, 1);
        
        const existingItem = newLoadout[loadoutSlot];
        if (existingItem && existingItem.rarity) {
            const existingKey = existingItem.type === 'petal' ? `${existingItem.type}_${existingItem.petalType}` : existingItem.type;
            this.addItem(existingItem.rarity, existingKey, 1);
        }
        
        newLoadout[loadoutSlot] = item;
        this.playerData.loadout = newLoadout;
        
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && (this.socket as any).username) {
            console.log('[TitleScreen] Emitting updateLoadout (equipItemToLoadout):', { 
                socketId: this.socket.id,
                loadout: newLoadout, 
                inventory: this.playerData.inventory 
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        } else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!(this.socket as any)?.username,
                socketId: this.socket?.id
            });
        }
        
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }
    
    private moveItemToInventory(loadoutSlot: number): void {
        if (!this.playerData || loadoutSlot >= this.playerData.loadout.length) return;
        
        const item = this.playerData.loadout[loadoutSlot];
        if (!item || !item.rarity) return;
        
        const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
        this.addItem(item.rarity, itemKey, 1);
        
        const newLoadout = [...this.playerData.loadout];
        newLoadout[loadoutSlot] = null;
        this.playerData.loadout = newLoadout;
        
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && (this.socket as any).username) {
            console.log('[TitleScreen] Emitting updateLoadout (moveItemToInventory):', { 
                socketId: this.socket.id,
                loadout: newLoadout, 
                inventory: this.playerData.inventory 
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        } else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!(this.socket as any)?.username,
                socketId: this.socket?.id
            });
        }
        
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }
    
    private swapLoadoutItems(fromSlot: number, toSlot: number): void {
        if (!this.playerData) return;
        
        const newLoadout = [...this.playerData.loadout];
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        this.playerData.loadout = newLoadout;
        
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && (this.socket as any).username) {
            console.log('[TitleScreen] Emitting updateLoadout (swapLoadoutItems):', { 
                socketId: this.socket.id,
                loadout: newLoadout, 
                inventory: this.playerData.inventory 
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        } else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!(this.socket as any)?.username,
                socketId: this.socket?.id
            });
        }
        
        this.updateLoadoutDisplay();
    }

    private updateInventoryDisplay(): void {
        console.log('[TitleScreenInventory] updateInventoryDisplay. panel:', !!this.inventoryPanel, 'panel.display:', this.inventoryPanel?.style.display, 'panel.parent:', this.inventoryPanel?.parentElement?.tagName, 'playerData:', !!this.playerData, 'inventoryItems:', this.playerData?.inventory?.length);
        if (!this.inventoryPanel) return;

        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content) return;

        content.innerHTML = '';

        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);

        if (!this.playerData) {
            const loading = document.createElement('div');
            loading.textContent = 'Loading inventory...';
            loading.style.cssText = 'color: white; padding: 20px; text-align: center;';
            content.appendChild(loading);
            return;
        }

        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

        const gridContainer = document.createElement('div');
        gridContainer.className = 'inventory-grid-container';
        gridContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
      `;

        const invDict = this.playerData?.inventory ? inventoryToDict(this.playerData.inventory) : {};
        rarities.forEach(rarity => {
            const items = invDict[rarity];
            if (items && Object.keys(items).length > 0) {
                const rarityRow = document.createElement('div');
                rarityRow.className = 'rarity-row';
                rarityRow.style.cssText = `
                  display: flex;
                  flex-direction: column;
                  gap: 5px;
              `;

                const rarityLabel = document.createElement('div');
                rarityLabel.textContent = rarity.toUpperCase();
                rarityLabel.style.cssText = `
                  color: ${this.ITEM_RARITY_COLORS[rarity]};
                  font-weight: bold;
                  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
                  padding-left: 5px;
              `;
                rarityRow.appendChild(rarityLabel);

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

                Object.entries(items).forEach(([type, count]) => {
                    // Skip eggs on title screen
                    if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg')) {
                        return;
                    }
                    const itemCount = typeof count === 'number' ? count : 0;
                    if (itemCount > 0) {
                        const itemElement = document.createElement('div');
                        itemElement.className = 'inventory-item';
                        itemElement.draggable = true;

                        const rarityColor = this.ITEM_RARITY_COLORS[rarity];
                        const darkenedColor = this.darkenColor(rarityColor);
                        itemElement.style.cssText = `
                      position: relative;
                      width: 50px;
                      height: 50px;
                      background-color: ${rarityColor};
                      border: 3px solid ${darkenedColor};
                      border-radius: 5px;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      cursor: pointer;
                      transition: all 0.2s ease;
                  `;

                        itemElement.addEventListener('mouseover', () => {
                            itemElement.style.transform = 'scale(1.05)';
                            itemElement.style.boxShadow = `0 0 10px ${this.ITEM_RARITY_COLORS[rarity]}`;
                        });

                        itemElement.addEventListener('mouseout', () => {
                            itemElement.style.transform = 'scale(1)';
                            itemElement.style.boxShadow = 'none';
                        });

                        itemElement.addEventListener('dragstart', (e) => {
                            e.dataTransfer?.setData('text/plain', JSON.stringify({ rarity, type }));
                            itemElement.classList.add('dragging');
                        });

                        itemElement.addEventListener('dragend', () => {
                            itemElement.classList.remove('dragging');
                        });

                        // Handle different item types for display
                        if (type.startsWith('petal_')) {
                            const petalType = type.replace('petal_', '');
                            const stats = getPetalStats(petalType, rarity);
                            if (stats && stats.image) {
                                const img = document.createElement('img');
                                img.alt = type;
                                img.draggable = false;
                                img.style.cssText = `
                              width: 30px;
                              height: 30px;
                              object-fit: contain;
                          `;
                                
                                // For title screen, use SVG directly since we don't have canvas
                                const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                                const url = URL.createObjectURL(svgBlob);
                                img.src = url;
                                itemElement.appendChild(img);
                            }
                        } else {
                            const img = document.createElement('img');
                            img.src = `./assets/${type}.png`;
                            img.alt = type;
                            img.draggable = false;
                            img.style.cssText = `
                          width: 30px;
                          height: 30px;
                          object-fit: contain;
                      `;
                            itemElement.appendChild(img);
                        }

                        const countLabel = document.createElement('div');
                        countLabel.className = 'item-count';
                        countLabel.textContent = itemCount.toString();
                        countLabel.style.cssText = `
                        position: absolute;
                        top: 2px;
                        right: 4px;
                        color: white;
                        font-size: 12px;
                        font-weight: bold;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                    `;
                        itemElement.appendChild(countLabel);

                        // Add petal name label for petals
                        if (type.startsWith('petal_')) {
                            const petalType = type.replace('petal_', '');
                            const petalName = this.formatPetalName(petalType);
                            if (petalName) {
                                const nameLabel = document.createElement('div');
                                nameLabel.className = 'petal-name';
                                nameLabel.textContent = petalName;
                                nameLabel.style.cssText = `
                                position: absolute;
                                bottom: 5px;
                                left: 50%;
                                transform: translateX(-50%);
                                color: white;
                                font-size: 10px;
                                font-weight: bold;
                                text-shadow: 
                                    -1px -1px 0 #000,
                                    1px -1px 0 #000,
                                    -1px 1px 0 #000,
                                    1px 1px 0 #000,
                                    0 0 3px rgba(0,0,0,0.8);
                                white-space: nowrap;
                                pointer-events: none;
                                z-index: 10;
                            `;
                                itemElement.appendChild(nameLabel);
                            }

                            // Setup tooltip for petal items
                            this.setupTooltip(itemElement, petalType, rarity);
                        }

                        grid.appendChild(itemElement);
                    }
                });

                rarityRow.appendChild(grid);
                gridContainer.appendChild(rarityRow);
            }
        });

        content.appendChild(gridContainer);
    }

    private darkenColor(hex: string, percent: number = 30): string {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const factor = 1 - (percent / 100);
        const newR = Math.round(r * factor);
        const newG = Math.round(g * factor);
        const newB = Math.round(b * factor);
        return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
    }

    private getSkillMultiplier(skillTier: string | undefined): number {
        if (!skillTier) return 1.0;
        const SKILL_MULTIPLIERS: Record<string, number> = {
            common: 1.0,
            uncommon: 1.1,
            rare: 1.2,
            epic: 1.35,
            legendary: 1.6,
            mythic: 2.0,
            ultra: 2.6,
            super: 3.3,
            unique: 4.0
        };
        return SKILL_MULTIPLIERS[skillTier] || 1.0;
    }

    private abbreviateNumber(value: number): string {
        if (value < 1000) {
            return value.toString();
        } else if (value < 1000000) {
            const k = value / 1000;
            return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
        } else if (value < 1000000000) {
            const m = value / 1000000;
            return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
        } else {
            const b = value / 1000000000;
            return b % 1 === 0 ? `${b}B` : `${b.toFixed(1)}B`;
        }
    }

    private calculateFinalPetalDamage(petalType: string, rarity: string): number {
        if (!this.playerData) return 0;
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return 0;
        const baseDamage = stats.damage;
        const damageSkillMultiplier = this.getSkillMultiplier(this.playerData.skills?.damage);
        return Math.round(baseDamage * damageSkillMultiplier);
    }

    private calculateFinalPetalHealth(petalType: string, rarity: string): number {
        if (!this.playerData) return 0;
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return 0;
        const baseHealth = stats.health;
        const petalHealthMultiplier = this.getSkillMultiplier(this.playerData.skills?.petalHealth);
        return Math.round(baseHealth * petalHealthMultiplier);
    }

    private showTooltip(element: HTMLElement, petalType: string, rarity: string): void {
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return;

        this.hideTooltip();

        const tooltip = document.createElement('div');
        tooltip.className = 'petal-tooltip';
        tooltip.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.95);
            border: 2px solid ${this.ITEM_RARITY_COLORS[rarity] || '#fff'};
            border-radius: 8px;
            padding: 12px;
            color: white;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 10000;
            pointer-events: none;
            max-width: 250px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        const finalDamage = this.calculateFinalPetalDamage(petalType, rarity);
        const finalHealth = this.calculateFinalPetalHealth(petalType, rarity);

        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight: bold; font-size: 16px; margin-bottom: 8px; color: ' + (this.ITEM_RARITY_COLORS[rarity] || '#fff') + ';';
        nameDiv.textContent = stats.name;
        tooltip.appendChild(nameDiv);

        if (stats.description) {
            const descDiv = document.createElement('div');
            descDiv.style.cssText = 'margin-bottom: 8px; color: #ccc; line-height: 1.4;';
            descDiv.textContent = stats.description;
            tooltip.appendChild(descDiv);
        }

        const hpDiv = document.createElement('div');
        hpDiv.style.cssText = 'margin-bottom: 4px;';
        hpDiv.setAttribute('data-full-value', finalHealth.toString());
        hpDiv.innerHTML = `<span style="color: #4CAF50;">HP:</span> <span class="tooltip-value">${this.abbreviateNumber(finalHealth)}</span>`;
        tooltip.appendChild(hpDiv);

        const damageDiv = document.createElement('div');
        damageDiv.setAttribute('data-full-value', finalDamage.toString());
        damageDiv.innerHTML = `<span style="color: #f44336;">Damage:</span> <span class="tooltip-value">${this.abbreviateNumber(finalDamage)}</span>`;
        tooltip.appendChild(damageDiv);

        document.body.appendChild(tooltip);
        this.tooltipElement = tooltip;

        this.updateTooltipPosition(element, tooltip);
    }

    private updateTooltipPosition(element: HTMLElement, tooltip: HTMLDivElement): void {
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let left = rect.right + 10;
        let top = rect.top;

        if (left + tooltipRect.width > window.innerWidth) {
            left = rect.left - tooltipRect.width - 10;
        }

        if (top + tooltipRect.height > window.innerHeight) {
            top = window.innerHeight - tooltipRect.height - 10;
        }

        if (top < 0) {
            top = 10;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    private hideTooltip(): void {
        if (this.tooltipTimeout !== null) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        if (this.tooltipElement) {
            this.tooltipElement.remove();
            this.tooltipElement = null;
        }
        this.hoveredElement = null;
    }

    private updateTooltipValues(showFull: boolean): void {
        if (!this.tooltipElement) return;

        const valueElements = this.tooltipElement.querySelectorAll('.tooltip-value');
        valueElements.forEach((valueEl) => {
            const parent = valueEl.parentElement;
            if (parent && parent.hasAttribute('data-full-value')) {
                const fullValue = parent.getAttribute('data-full-value');
                if (fullValue) {
                    if (showFull) {
                        valueEl.textContent = fullValue;
                    } else {
                        valueEl.textContent = this.abbreviateNumber(parseInt(fullValue));
                    }
                }
            }
        });
    }

    private setupTooltip(element: HTMLElement, petalType: string, rarity: string): void {
        let isDragging = false;
        let mouseDownTime = 0;

        const handleMouseEnter = () => {
            if (isDragging) return;
            this.hoveredElement = element;
            this.tooltipTimeout = window.setTimeout(() => {
                if (this.hoveredElement === element && !isDragging) {
                    this.showTooltip(element, petalType, rarity);
                    // Check initial ALT state
                    this.updateTooltipValues((window as any).altKeyPressed || false);
                }
            }, 200);
        };

        const handleMouseLeave = () => {
            this.hideTooltip();
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (this.tooltipElement && this.hoveredElement === element) {
                this.updateTooltipPosition(element, this.tooltipElement);
            }
        };

        const handleMouseDown = () => {
            mouseDownTime = Date.now();
            this.hideTooltip();
        };

        const handleMouseUp = () => {
            if (Date.now() - mouseDownTime < 200) {
                this.hideTooltip();
            }
        };

        const handleDragStart = () => {
            isDragging = true;
            this.hideTooltip();
        };

        const handleDragEnd = () => {
            setTimeout(() => {
                isDragging = false;
            }, 100);
        };

        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
        element.addEventListener('mousemove', handleMouseMove);
        element.addEventListener('mousedown', handleMouseDown);
        element.addEventListener('mouseup', handleMouseUp);
        element.addEventListener('dragstart', handleDragStart);
        element.addEventListener('dragend', handleDragEnd);
    }

    public toggleInventory(): void {
        console.log('[TitleScreenInventory] toggleInventory called. playerData:', !!this.playerData, 'isAuthenticated:', this.isAuthenticated);
        let inventoryPanel = document.getElementById('inventoryPanel') as HTMLDivElement;
        
        if (!inventoryPanel) {
            inventoryPanel = document.createElement('div');
            inventoryPanel.id = 'inventoryPanel';
            inventoryPanel.className = 'inventory-panel';
            inventoryPanel.style.display = 'none';

            const inventoryContent = document.createElement('div');
            inventoryContent.className = 'inventory-content';
            inventoryPanel.appendChild(inventoryContent);
            document.body.appendChild(inventoryPanel);
        }
        // Always bind the field to the current element (an existing panel
        // from a previous game session won't update `this.inventoryPanel`
        // otherwise, causing updateInventoryDisplay to early-return).
        this.inventoryPanel = inventoryPanel;
        // Ensure the content container exists (in case a stale panel was found
        // whose content was torn down).
        if (!inventoryPanel.querySelector('.inventory-content')) {
            const inventoryContent = document.createElement('div');
            inventoryContent.className = 'inventory-content';
            inventoryPanel.appendChild(inventoryContent);
        }

        const isOpen = inventoryPanel.style.display === 'block';
        console.log('[TitleScreenInventory] toggleInventory: isOpen=', isOpen, 'inDOM=', !!inventoryPanel.parentElement);
        if (!isOpen) {
            this.updateInventoryDisplay();
            inventoryPanel.style.display = 'block';
            setTimeout(() => {
                inventoryPanel.classList.add('open');
                const cs = getComputedStyle(inventoryPanel);
                console.log('[TitleScreenInventory] .open added. classList=', inventoryPanel.className, 'transform=', cs.transform, 'left=', cs.left, 'position=', cs.position, 'rect=', inventoryPanel.getBoundingClientRect());
            }, 10);
        } else {
            inventoryPanel.classList.remove('open');
            setTimeout(() => {
                inventoryPanel.style.display = 'none';
            }, 300);
        }
    }

    public updateFromPlayerData(playerData: { inventory: PlayerInventory; loadout: (Item | null)[]; tp?: number; skills?: any }): void {
        this.playerData = playerData;
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
        if (this.isCraftingOpen) {
            this.updateCraftingInventoryPreview();
        }
        
        // Loadout has loaded, notify title screen to stop showing connecting
        if ((window as any).titleScreen) {
            (window as any).titleScreen.onLoadoutLoaded();
        }
    }
    
    public updateSkillsData(tp: number, skills: { [key: string]: string }): void {
        // Update skills data in playerData
        if (this.playerData) {
            this.playerData.tp = tp;
            this.playerData.skills = skills;
        }
    }

    public toggleCrafting(): void {
        // Check if game is running - if so, use game's crafting
        if (window.currentGame && (window.currentGame as any).inventoryManager) {
            (window.currentGame as any).inventoryManager.toggleCrafting();
            return;
        }

        // Toggle title screen crafting panel
        if (!this.craftingPanel) {
            this.initializeCraftingPanel();
        }
        
        if (this.craftingPanel) {
            const isOpen = this.craftingPanel.style.display === 'block';
            if (!isOpen) {
                this.craftingPanel.style.display = 'block';
                this.isCraftingOpen = true;
                setTimeout(() => {
                    this.craftingPanel?.classList.add('open');
                }, 10);
                this.updateCraftingDisplay();
                this.updateCraftingInventoryPreview();
            } else {
                this.craftingPanel.classList.remove('open');
                this.isCraftingOpen = false;
                setTimeout(() => {
                    if (this.craftingPanel) {
                        this.craftingPanel.style.display = 'none';
                    }
                }, 300);
            }
        }
    }

    public toggleSkills(): void {
        // This is now handled by TitleScreen.toggleSkillsOnTitleScreen()
        // This method is kept for compatibility but shouldn't be called directly
    }

    private initializeCraftingPanel(): void {
        // Check if crafting panel already exists (from game)
        let existingPanel = document.getElementById('craftingPanel');
        if (existingPanel) {
            this.craftingPanel = existingPanel as HTMLDivElement;
            return;
        }

        this.craftingPanel = document.createElement('div');
        this.craftingPanel.id = 'craftingPanel';
        this.craftingPanel.className = 'crafting-panel';
        this.craftingPanel.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 900px;
            max-height: 700px;
            background: #c4914a;
            border: 2px solid #8b6f3a;
            border-radius: 10px;
            padding: 20px;
            z-index: 4000;
            display: none;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        const craftingContent = document.createElement('div');
        craftingContent.className = 'crafting-content';

        const title = document.createElement('h2');
        title.textContent = 'Crafting';
        title.style.cssText = 'margin: 0 0 20px 0; text-align: center; color: white; font-size: 24px;';
        craftingContent.appendChild(title);

        const craftingMain = document.createElement('div');
        craftingMain.className = 'crafting-main';
        craftingMain.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 15px;';

        const craftingCircleContainer = document.createElement('div');
        craftingCircleContainer.className = 'crafting-circle-container';
        craftingCircleContainer.style.cssText = 'position: relative; width: 180px; height: 180px; flex-shrink: 0;';

        for (let i = 0; i < 5; i++) {
            const slot = document.createElement('div');
            slot.className = 'crafting-slot';
            slot.dataset.index = i.toString();
            slot.style.cssText = `
                width: 40px;
                height: 40px;
                position: absolute;
                cursor: pointer;
                user-select: none;
                background: rgba(255, 255, 255, 0.1);
                border: 2px solid #666;
                border-radius: 5px;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            slot.addEventListener('click', () => this.removeCraftingBatch());
            craftingCircleContainer.appendChild(slot);
        }

        const multiplierText = document.createElement('div');
        multiplierText.className = 'crafting-multiplier';
        multiplierText.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 24px;
            font-weight: bold;
            color: white;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
            display: none;
        `;
        craftingCircleContainer.appendChild(multiplierText);

        const successDisplay = document.createElement('div');
        successDisplay.className = 'crafting-success-display';
        successDisplay.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80px;
            height: 80px;
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 10;
            pointer-events: none;
        `;
        craftingCircleContainer.appendChild(successDisplay);

        craftingMain.appendChild(craftingCircleContainer);

        const craftingActions = document.createElement('div');
        craftingActions.className = 'crafting-actions';
        craftingActions.style.cssText = 'display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;';

        const craftButton = document.createElement('button');
        craftButton.className = 'craft-button';
        craftButton.textContent = 'Craft';
        craftButton.style.cssText = `
            width: 100%;
            padding: 10px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
        `;
        craftButton.addEventListener('click', () => this.craftItems());
        craftingActions.appendChild(craftButton);

        const successChance = document.createElement('div');
        successChance.className = 'success-chance';
        successChance.textContent = 'Success Chance: 0%';
        successChance.style.cssText = 'text-align: center; font-size: 16px; font-weight: bold; color: #fff;';
        craftingActions.appendChild(successChance);

        craftingMain.appendChild(craftingActions);
        craftingContent.appendChild(craftingMain);

        const inventoryPreview = document.createElement('div');
        inventoryPreview.className = 'crafting-inventory-preview';
        inventoryPreview.style.cssText = 'margin-top: 15px; border-top: 2px solid #444; padding-top: 10px;';

        const previewTitle = document.createElement('h3');
        previewTitle.textContent = 'Inventory';
        previewTitle.style.cssText = 'margin: 0 0 10px 0; text-align: center; color: white; font-size: 18px;';
        inventoryPreview.appendChild(previewTitle);

        const inventoryGrid = document.createElement('div');
        inventoryGrid.className = 'crafting-inventory-grid';
        inventoryGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(50px, 1fr)); gap: 5px;';
        inventoryPreview.appendChild(inventoryGrid);

        craftingContent.appendChild(inventoryPreview);
        this.craftingPanel.appendChild(craftingContent);
        document.body.appendChild(this.craftingPanel);

        // Setup drag and drop for crafting slots
        this.setupCraftingDragAndDrop();
    }

    private setupCraftingDragAndDrop(): void {
        if (!this.craftingPanel) return;

        const slots = this.craftingPanel.querySelectorAll('.crafting-slot');
        slots.forEach((slot, index) => {
            slot.addEventListener('dragover', (e: Event) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.add('drag-over');
            });

            slot.addEventListener('dragleave', (e: Event) => {
                (e.currentTarget as HTMLElement).classList.remove('drag-over');
            });

            slot.addEventListener('drop', (e: Event) => {
                e.preventDefault();
                const dragEvent = e as DragEvent;
                (e.currentTarget as HTMLElement).classList.remove('drag-over');

                const itemData = dragEvent.dataTransfer?.getData('text/plain');
                if (itemData) {
                    const { rarity, type } = JSON.parse(itemData);
                    this.addItemToCraftingSlot(rarity, type, index);
                }
            });
        });
    }

    private getItemCount(rarity: string, type: string): number {
        if (!this.playerData || !this.playerData.inventory) return 0;
        return codecGetItemCount(this.playerData.inventory, rarity, type);
    }

    private removeItem(rarity: string, type: string, count: number): void {
        if (!this.playerData || !this.playerData.inventory) return;
        codecRemoveItem(this.playerData.inventory, rarity, type, count);
    }

    private addItem(rarity: string, type: string, count: number): void {
        if (!this.playerData || !this.playerData.inventory) return;
        codecAddItem(this.playerData.inventory, rarity, type, count);
    }

    private addItemToCraftingSlot(rarity: string, type: string, slotIndex: number): void {
        if (this.getItemCount(rarity, type) === 0) return;
        
        let itemType: Item['type'];
        let petalType: string | undefined;
        
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6);
        } else {
            itemType = type as Item['type'];
        }

        const item: Item = { 
            type: itemType,
            rarity: rarity as Item['rarity'], 
            petalType: petalType 
        };
        
        if (this.craftingItems[slotIndex]) {
            return;
        }

        const existingItems = this.craftingItems.filter(slot => slot !== null);
        if (existingItems.length > 0) {
            const firstItem = existingItems[0];
            if (item.type !== firstItem.type || item.rarity !== firstItem.rarity || item.petalType !== firstItem.petalType) {
                alert('Items must be of the same type and rarity!');
                return;
            }
        }

        this.craftingItems[slotIndex] = item;
        this.removeItem(rarity, type, 1);

        this.updateCraftingDisplay();
        this.updateCraftingInventoryPreview();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }

    public removeCraftingBatch(): void {
        if (this.craftingItems.length === 0) return;

        const itemsToRemove = this.craftingItems.splice(-5);

        if (itemsToRemove.length > 0) {
            const item = itemsToRemove[0];
            const type = item.petalType ? `petal_${item.petalType}` : item.type;
            if (item.rarity) {
                this.addItem(item.rarity, type, itemsToRemove.length);
            }
        }
        
        this.updateCraftingDisplay();
        this.updateCraftingInventoryPreview();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }

    public craftItems(): void {
        const itemsToCraftCount = this.craftingItems.length;

        if (itemsToCraftCount < 5 || itemsToCraftCount % 5 !== 0) {
            alert('You must add items in multiples of 5 to craft!');
            return;
        }

        if (!this.socket || !this.socket.connected) {
            alert('Not connected to server');
            return;
        }

        // Check if player is authenticated (socket.username is set during authentication)
        if (!(this.socket as any).username) {
            alert('Please wait for authentication to complete');
            return;
        }

        console.log('[TitleScreen] Sending craftItems request:', { itemCount: this.craftingItems.length, socketId: this.socket.id });
        this.socket.emit('craftItems', { items: this.craftingItems });

        this.craftingItems = [];
        this.updateCraftingDisplay();
    }

    private updateCraftingDisplay(): void {
        if (!this.craftingPanel) return;

        const slots = this.craftingPanel.querySelectorAll('.crafting-slot');
        const container = this.craftingPanel.querySelector('.crafting-circle-container') as HTMLElement;
        const multiplierEl = this.craftingPanel.querySelector('.crafting-multiplier') as HTMLElement;
        const radius = 70;
        const containerSize = 180;

        if (this.craftingItems.length > 0) {
            const firstItem = this.craftingItems[0];
            const attempts = this.craftingItems.length / 5;
            if (multiplierEl) {
                multiplierEl.textContent = `x${attempts}`;
                multiplierEl.style.display = 'block';
            }

            slots.forEach((slot, index) => {
                if (container) {
                    const angle = (index / slots.length) * 2 * Math.PI;
                    const x = (containerSize / 2) + radius * Math.cos(angle) - 20;
                    const y = (containerSize / 2) + radius * Math.sin(angle) - 20;
                    (slot as HTMLElement).style.left = `${x}px`;
                    (slot as HTMLElement).style.top = `${y}px`;
                }
    
                slot.innerHTML = '';
                const rarityColor = this.ITEM_RARITY_COLORS[firstItem.rarity!] || '#666';
                (slot as HTMLElement).style.borderColor = rarityColor;

                if (firstItem.type === 'petal' && firstItem.petalType && firstItem.rarity) {
                    const stats = getPetalStats(firstItem.petalType, firstItem.rarity);
                    if (stats && stats.image) {
                        const img = document.createElement('img');
                        img.style.width = '100%';
                        img.style.height = '100%';
                        img.style.objectFit = 'contain';
                        const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                        const url = URL.createObjectURL(svgBlob);
                        img.src = url;
                        slot.appendChild(img);
                    }
                } else {
                    const img = document.createElement('img');
                    img.src = `./assets/${firstItem.type}.png`;
                    img.alt = firstItem.type;
                    img.style.width = '80%';
                    img.style.height = '80%';
                    img.style.objectFit = 'contain';
                    slot.appendChild(img);
                }
            });
        } else {
            if (multiplierEl) {
                multiplierEl.style.display = 'none';
            }
            slots.forEach((slot, index) => {
                if (container) {
                    const angle = (index / slots.length) * 2 * Math.PI;
                    const x = (containerSize / 2) + radius * Math.cos(angle) - 20;
                    const y = (containerSize / 2) + radius * Math.sin(angle) - 20;
                    (slot as HTMLElement).style.left = `${x}px`;
                    (slot as HTMLElement).style.top = `${y}px`;
                }
                slot.innerHTML = '';
                (slot as HTMLElement).style.borderColor = '#666';
            });
        }

        const successChance = this.calculateSuccessChance();
        const successElement = this.craftingPanel.querySelector('.success-chance');
        if (successElement) {
            successElement.textContent = `Success Chance: ${successChance}%`;
        }
    }

    private calculateSuccessChance(): number {
        if (this.craftingItems.length < 5) return 0;
        if (this.craftingItems.length % 5 !== 0) return 0;

        const firstItem = this.craftingItems[0];
        if (!firstItem.rarity) return 0;

        const rarityIndex = RARITY_LEVELS.indexOf(firstItem.rarity);
        if (rarityIndex === -1) return 0;

        // Base chance decreases as rarity increases
        const baseChance = 100 - (rarityIndex * 10);
        return Math.max(10, baseChance);
    }

    private updateCraftingInventoryPreview(): void {
        if (!this.craftingPanel || !this.playerData) return;

        const inventoryGrid = this.craftingPanel.querySelector('.crafting-inventory-grid');
        if (!inventoryGrid) return;

        inventoryGrid.innerHTML = '';

        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        const craftInvDict = this.playerData?.inventory ? inventoryToDict(this.playerData.inventory) : {};
        rarities.forEach(rarity => {
            const items = craftInvDict[rarity];
            if (items && Object.keys(items).length > 0) {
                Object.entries(items).forEach(([itemType, count]) => {
                    const itemCount = typeof count === 'number' ? count : 0;
                    if (itemCount > 0) {
                        const itemElement = document.createElement('div');
                        itemElement.className = 'crafting-inventory-item';
                        itemElement.draggable = true;
                        itemElement.style.cssText = `
                            position: relative;
                            width: 50px;
                            height: 50px;
                            background-color: ${this.ITEM_RARITY_COLORS[rarity]};
                            border: 3px solid ${this.darkenColor(this.ITEM_RARITY_COLORS[rarity])};
                            border-radius: 5px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            cursor: grab;
                        `;

                        itemElement.addEventListener('dragstart', (e) => {
                            e.dataTransfer?.setData('text/plain', JSON.stringify({ rarity, type: itemType }));
                        });

                        // Add click handler to add items to crafting slots
                        itemElement.addEventListener('click', (e) => {
                            const isShiftClick = (e as MouseEvent).shiftKey;
                            this.handleCraftingItemClick(rarity, itemType, isShiftClick);
                        });

                        if (itemType.startsWith('petal_')) {
                            const petalType = itemType.replace('petal_', '');
                            const stats = getPetalStats(petalType, rarity);
                            if (stats && stats.image) {
                                const imgDiv = document.createElement('div');
                                imgDiv.innerHTML = stats.image;
                                imgDiv.style.width = '60%';
                                imgDiv.style.height = '60%';
                                imgDiv.style.display = 'flex';
                                imgDiv.style.alignItems = 'center';
                                imgDiv.style.justifyContent = 'center';
                                itemElement.appendChild(imgDiv);
                            }
                        } else {
                            const img = document.createElement('img');
                            img.src = `./assets/${itemType}.png`;
                            img.style.width = '60%';
                            img.style.height = '60%';
                            img.style.objectFit = 'contain';
                            itemElement.appendChild(img);
                        }

                        const countLabel = document.createElement('div');
                        countLabel.textContent = itemCount.toString();
                        countLabel.style.cssText = `
                            position: absolute;
                            top: 2px;
                            right: 4px;
                            color: white;
                            font-size: 12px;
                            font-weight: bold;
                            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                        `;
                        itemElement.appendChild(countLabel);

                        inventoryGrid.appendChild(itemElement);
                    }
                });
            }
        });
    }

    private handleCraftingItemClick(rarity: string, type: string, isShiftClick: boolean): void {
        const itemsFromStack = this.getItemCount(rarity, type);
        if (itemsFromStack === 0) return;

        const isPetal = type.startsWith('petal_');
        const petalType = isPetal ? type.substring(6) : undefined;
        const itemType = isPetal ? 'petal' : type;

        if (this.craftingItems.length > 0) {
            const firstItem = this.craftingItems[0];
            if (firstItem.rarity !== rarity || firstItem.type !== itemType || firstItem.petalType !== petalType) {
                const itemsToReturn = [...this.craftingItems];
                this.craftingItems = [];
                itemsToReturn.forEach(item => {
                    const itemKey = item.petalType ? `petal_${item.petalType}` : item.type;
                    this.addItem(item.rarity!, itemKey, 1);
                });
            }
        }

        let amountToAdd;
        if (isShiftClick) {
            amountToAdd = itemsFromStack;
        } else {
            amountToAdd = 5;
        }
        
        const actualAmountToAdd = Math.min(amountToAdd, this.getItemCount(rarity, type));

        if (actualAmountToAdd < 5) {
            alert('You need at least 5 items to add a batch.');
            return;
        }

        const batchesToAdd = Math.floor(actualAmountToAdd / 5);
        const totalItemsToAdd = batchesToAdd * 5;

        const item: Item = {
            type: itemType as Item['type'],
            rarity: rarity as Item['rarity'],
            petalType: petalType
        };

        // Find empty slots and fill them
        for (let i = 0; i < 5 && this.craftingItems.length < 5; i++) {
            if (!this.craftingItems[i]) {
                this.craftingItems[i] = item;
            }
        }

        // If we have 5 items, add more batches
        if (this.craftingItems.length === 5 && batchesToAdd > 1) {
            for (let batch = 1; batch < batchesToAdd; batch++) {
                for (let i = 0; i < 5; i++) {
                    this.craftingItems.push(item);
                }
            }
        }

        this.removeItem(rarity, type, totalItemsToAdd);

        this.updateCraftingDisplay();
        this.updateCraftingInventoryPreview();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }

    private showCraftingSuccess(newItem: Item, successCount: number): void {
        if (!this.craftingPanel) return;

        const successDisplay = this.craftingPanel.querySelector('.crafting-success-display') as HTMLElement;
        if (!successDisplay) return;

        successDisplay.innerHTML = '';
        successDisplay.style.display = 'flex';

        const itemContainer = document.createElement('div');
        itemContainer.className = 'success-item';
        const rarity = newItem.rarity || 'common';
        const rarityColor = this.ITEM_RARITY_COLORS[rarity] || '#7eef6d';
        itemContainer.style.cssText = `
            width: 60px;
            height: 60px;
            border: 3px solid ${rarityColor};
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: ${rarityColor};
            position: relative;
        `;

        if (newItem.type === 'petal' && newItem.petalType && rarity) {
            const stats = getPetalStats(newItem.petalType, rarity);
            if (stats && stats.image) {
                const img = document.createElement('img');
                img.style.width = '90%';
                img.style.height = '90%';
                img.style.objectFit = 'contain';
                const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(svgBlob);
                img.src = url;
                itemContainer.appendChild(img);
            }
        } else {
            const img = document.createElement('img');
            img.src = `./assets/${newItem.type}.png`;
            img.style.width = '90%';
            img.style.height = '90%';
            img.style.objectFit = 'contain';
            itemContainer.appendChild(img);
        }

        const countLabel = document.createElement('div');
        countLabel.className = 'success-count';
        countLabel.textContent = `x${successCount}`;
        countLabel.style.cssText = `
            position: absolute;
            bottom: -25px;
            font-size: 18px;
            font-weight: bold;
            color: white;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        `;
        itemContainer.appendChild(countLabel);

        successDisplay.appendChild(itemContainer);

        setTimeout(() => {
            successDisplay.style.display = 'none';
        }, 3000);
    }
}

// CSS styles that were in the HTML
export const titleScreenStyles = `
    .auth-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2000;
        background: rgba(0, 0, 0, 0.8);
        padding: 20px;
        border-radius: 10px;
        color: white;
        pointer-events: auto;
    }

    .auth-form {
        display: flex;
        flex-direction: column;
        gap: 15px;
        min-width: 300px;
    }

    .auth-form input {
        padding: 10px;
        border-radius: 5px;
        border: 1px solid #ccc;
    }

    .auth-form button {
        margin: 5px 0;
    }

    .hidden {
        display: none !important;
    }

    .buttons {
        opacity: 1;
        pointer-events: auto;
    }

    .auth-visible .buttons {
        opacity: 0.5;
    }

    .center_text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1000;
        text-align: center;
        color: white;
        padding: 20px;
        border-radius: 10px;
        background: transparent;
        box-shadow: none;
    }

    .title {
        font-size: 48px;
        margin-bottom: 20px;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
        color: #ffffff;
    }

    .instructions {
        font-size: 24px;
        margin-bottom: 30px;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
        color: #ffffff;
    }

    .name-input-container {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        gap: 10px;
        margin: 10px 0;
    }

    .name-input-container .ready-button {
        height: 42px;
        padding: 10px 20px;
        font-size: 18px;
        box-sizing: border-box;
        margin-top: 0;
        vertical-align: top;
    }

    .name-input-container .ready-button:hover {
        background: #1dd129 !important;
        color: white !important;
        transform: scale(1.05);
    }

    .name-input {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        font-size: 18px;
        padding: 10px;
        width: 300px;
        border-radius: 5px;
    }

    .biome-selector-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        margin: 15px 0;
    }

    .biome-selector-container label {
        color: white;
        font-size: 18px;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
    }

    .biome-buttons {
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        justify-content: center;
        max-width: 100%;
        overflow-x: auto;
        padding: 5px;
    }

    .biome-button {
        padding: 8px 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        color: #000;
        transition: all 0.3s ease;
        min-width: 70px;
        text-align: center;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .biome-button:hover {
        transform: scale(1.05);
        border-color: rgba(255, 255, 255, 0.6);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    }

    .biome-button.selected {
        border-color: #fff;
        border-width: 3px;
        transform: scale(1.1);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
    }

    .biome-button.selected::after {
        content: " ✓";
        font-weight: bold;
    }

    .color-picker {
        padding: 15px;
        border-radius: 10px;
        margin-top: 20px;
    }

    .color-picker label {
        color: white;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
    }

    .hue-slider {
        width: 200px;
        margin: 10px 0;
    }

    .color-update-btn {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        padding: 8px 15px;
        border-radius: 5px;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .color-update-btn:hover {
        background: rgba(255, 255, 255, 1);
        transform: scale(1.1);
    }

    #gameMenu {
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 3000;
        text-align: center;
        display: flex;
        gap: 10px;
        padding: 15px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.7);
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
    }

    #gameMenu button {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        font-weight: bold;
        transition: all 0.3s ease;
        margin: 0 10px;
        padding: 10px 20px;
        font-size: 16px;
        border-radius: 5px;
        cursor: pointer;
    }

    #gameMenu button:hover {
        background: rgba(255, 255, 255, 1);
        transform: scale(1.1);
    }

    button {
        margin: 0 10px;
        padding: 10px 20px;
        font-size: 16px;
        background-color: rgba(255, 255, 255, 0.9);
        border: 2px solid #333;
        border-radius: 5px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    button:hover {
        transform: scale(1.05);
    }

    .settings-menu {
        position: absolute;
        top: 52px;
        left: 0;
        background: #aaaaaa;
        border-radius: 8px;
        color: white;
        width: 400px;
        max-width: 90vw;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 4000;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .settings-menu-content {
        padding: 15px;
        max-height: 70vh;
        overflow-y: auto;
    }

    .settings-menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #444;
        padding-bottom: 10px;
        margin-bottom: 10px;
    }

    #closeSettingsButton {
        background: transparent;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
    }

    .settings-menu-tabs {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
    }

    .tab-button {
        padding: 10px;
        background: #a3a3a3;
        border: 3px solid #858585;
        color: white;
        cursor: pointer;
        border-radius: 5px;
    }

    .tab-button.active {
        background: #a3a3a3;
        border-bottom: 3px solid #858585;
    }

    .tab-content {
        display: none;
    }

    .tab-content.active {
        display: block;
    }

    .controls-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 10px;
    }

    .control-row {
        display: contents;
    }

    .control-row label {
        text-transform: capitalize;
    }

    .control-input {
        background: #e6e6e6;
        border: 3px solid #a3a3a3;
        color: #000000;
        padding: 5px;
        border-radius: 3px;
        text-align: center;
    }

    #mobFramerateSlider {
        width: 100%;
        margin: 10px 0;
        cursor: pointer;
    }

    #mobFramerateValue {
        font-weight: bold;
        color: #4CAF50;
        margin-left: 10px;
    }

    .tab-content label {
        display: block;
        margin: 10px 0;
        color: white;
    }

    .register-warning {
        color: red;
    }

    .floating-petal {
        position: absolute;
        pointer-events: none;
        z-index: 100;
        opacity: 0.7;
        transition: opacity 0.3s ease;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
    }

    .floating-petal:hover {
        opacity: 1;
    }

    .floating-petal svg {
        width: 100%;
        height: 100%;
        display: block;
    }

    #floating-petals-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 50;
        overflow: hidden;
    }

    #title-background-canvas {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
    }
`;

// Function to inject styles
export function injectTitleScreenStyles(): void {
    const styleElement = document.createElement('style');
    styleElement.textContent = titleScreenStyles;
    document.head.appendChild(styleElement);
}
