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
import { InventoryManager, GameInterface } from './inventory';
import { ShopManager } from './shop';
import { inventoryToDict, addItem as codecAddItem, removeItem as codecRemoveItem, getItemCount as codecGetItemCount, dictToInventory } from './inventoryCodec';
import { CanvasLoadoutBar, LOADOUT_SLOT_COUNT as CANVAS_LOADOUT_SLOT_COUNT } from './graphics/loadout-bar';
import { CanvasInventoryPanel, InventoryHitInfo } from './graphics/inventory-panel';

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
    private pressedButton: string | null = null; // tracks which button is currently pressed (mousedown)

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
                if (element.type === 'biome' && element.properties?.biomeName && element.properties.biomeName !== 'garden' && element.properties.biomeName !== 'unnamed_biome') {
                    console.log('Found biome:', element.properties.biomeName);
                    biomeNames.add(element.properties.biomeName);
                }
            });
        }
        
        // Update available biomes
        this.availableBiomes = Array.from(biomeNames);
        console.log('Available biomes detected:', this.availableBiomes);
    }

    /**
     * Gets configuration for a biome (colors, display names, etc.)
     */
    private getBiomeConfig(biomeName: string): { color: string; title: string; displayName: string } {
        const configs: { [key: string]: { color: string; title: string; displayName: string } } = {
            'default': {
                color: 'rgb(0, 190, 79)',
                title: 'Garden',
                displayName: 'Garden'
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
            },
            'sewers': {
                color: 'rgb(128, 63, 2)',
                title: 'Sewers',
                displayName: 'Sewers'
            },
            'computer': {
                color: 'rgb(96, 255, 149)',
                title: 'Computer Lab',
                displayName: 'Computer Lab'
            }
        };
        
        // Return config for known biome or create a default one
        return configs[biomeName] || {
            color: '#cccccc',
            title: biomeName.charAt(0).toUpperCase() + biomeName.slice(1),
            displayName: biomeName.charAt(0).toUpperCase() + biomeName.slice(1)
        };
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
            <div id="titleScreenLoadoutWrap" style="margin-top: 20px; display: flex; justify-content: center;">
                <canvas id="titleScreenLoadoutBar" width="900" height="210" style="background: transparent; display: block; pointer-events: auto; width: 900px; height: 211px;"></canvas>
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
            <style>
                .gardn-icon-btn {
                    width: 42px; height: 42px; cursor: pointer; padding: 5px;
                    border-radius: 3px; display: flex; align-items: center;
                    justify-content: center; box-sizing: border-box;
                    border-style: solid; border-width: 4px;
                    transition: filter 0.05s;
                }
                .gardn-icon-btn:hover { filter: brightness(1.1); }
                .gardn-icon-btn:active { filter: brightness(0.9); }
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
            <div id="settingsButton" class="gardn-icon-btn" style="background: #b3b3b3; border-color: #8f8f8f;" title="Settings">
                ${formattedSettingsIcon}
            </div>
            <div id="changelogButton" class="gardn-icon-btn ${CHANGELOG.length > parseInt(localStorage.getItem('lastSeenChangelogCount') || '0') ? 'shake' : ''}" style="background: #00db3e; border-color: #00af32;" title="Changelog">
                ${formattedChangelogIcon}
            </div>
            <div id="notificationsButton" class="gardn-icon-btn" style="background: #4a90e2; border-color: #3b73b5;" title="Notifications">
                ${formattedNotificationsIcon}
            </div>
            <div id="leaderboardButton" class="gardn-icon-btn" style="background: #e8a023; border-color: #ba801c;" title="Leaderboard">
                ${formattedLeaderboardIcon}
            </div>
            <div id="exitButton" class="gardn-icon-btn" style="background: #ff0000; border-color: #cc0000; display: none;" title="Exit to Menu">
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
            <div id="inventoryButtonIcon" class="gardn-icon-btn" style="background: #00b3ff; border-color: #008fcc; position: relative; z-index: 5; pointer-events: auto;" title="Inventory (I)">
                ${formattedInventoryIcon}
            </div>
            <div id="skillsButtonIcon" class="gardn-icon-btn" style="background: #9d4edd; border-color: #7e3eb1; position: relative; z-index: 4; pointer-events: auto;" title="Skills (K)">
                ${formattedSkillsIcon}
            </div>
            <div id="mobGalleryButtonIcon" class="gardn-icon-btn" style="background: #d6c206; border-color: #ab9b05; position: relative; z-index: 3; pointer-events: auto;" title="Mob Gallery (G)">
                ${formattedMobGalleryIcon}
            </div>
            <div id="shopButtonIcon" class="gardn-icon-btn" style="background: #36d153; border-color: #2ba742; position: relative; z-index: 2; pointer-events: auto;" title="Shop (B)">
                ${formattedShopIcon}
            </div>
            <div id="craftButtonIcon" class="gardn-icon-btn" style="background: #ff9d00; border-color: #cc7e00; position: relative; z-index: 1; pointer-events: auto;" title="Craft (R)">
                ${formattedCraftIcon}
            </div>
        `;
        document.body.appendChild(bottomLeftButtons);

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

            // Don't interfere if an input/textarea is focused
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return;
            }

            // Don't interfere if chat is focused
            if (this.titleScreenChat && this.titleScreenChat.isFocused) {
                if (event.key === 'Escape') {
                    this.titleScreenChat.blur();
                }
                return;
            }

            // Don't interfere if auth form field or name input is focused
            if ((this.showAuthForm && this.authFocusedField) || this.isNameInputFocused) {
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

            // Crafting shortcut
            if (event.key === (controls.crafting || 'c')) {
                this.toggleCraftingOnTitleScreen();
                event.preventDefault();
                return;
            }

            // Inventory shortcut
            if (event.key === (controls.inventory || 'z')) {
                this.toggleInventoryOnTitleScreen();
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
                // Close other menus
                this.changelogManager.hide();
                this.notificationsManager.hide();
                this.leaderboardManager.hide();
                this.settingsMenu.classList.toggle('hidden');
            });
        }

        if (changelogButton) {
            changelogButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                // Close other menus
                this.settingsMenu.classList.add('hidden');
                this.notificationsManager.hide();
                this.leaderboardManager.hide();
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
                // Close other menus
                this.settingsMenu.classList.add('hidden');
                this.changelogManager.hide();
                this.leaderboardManager.hide();
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
                // Close other menus
                this.settingsMenu.classList.add('hidden');
                this.changelogManager.hide();
                this.notificationsManager.hide();
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
                if (loadoutBar.parentNode === this.centerText || loadoutBar.parentNode === null
                    || (loadoutBar.parentNode as HTMLElement | null)?.id === 'titleScreenLoadoutWrap') {
                    document.body.appendChild(loadoutBar);
                }
                // Position the canvas loadout bar (centered horizontally, above the instructions)
                loadoutBar.style.position = 'absolute';
                loadoutBar.style.top = '50%';
                loadoutBar.style.left = '50%';
                loadoutBar.style.transform = 'translate(-50%, 0)';
                loadoutBar.style.marginTop = '50px';
                loadoutBar.style.zIndex = '1001';
                loadoutBar.style.pointerEvents = 'auto';
                // Hide if auth form is shown
                loadoutBar.style.display = this.showAuthForm ? 'none' : 'block';
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

        // Mouse down for pressed state
        this.uiCanvas.addEventListener('mousedown', () => {
            if (this.hoveredStartButton) this.pressedButton = 'start';
            else if (this.hoveredBiomeIndex >= 0) this.pressedButton = `biome_${this.hoveredBiomeIndex}`;
            else if (this.hoveredAuthButton) this.pressedButton = this.hoveredAuthButton;
            else this.pressedButton = null;
        });

        // Mouse up to clear pressed state
        document.addEventListener('mouseup', () => {
            this.pressedButton = null;
        });

        // Mouse leave to clear hover
        this.uiCanvas.addEventListener('mouseleave', () => {
            this.hoveredBiomeIndex = -1;
            this.hoveredStartButton = false;
            this.hoveredAuthButton = null;
            this.pressedButton = null;
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
     * Adjusts a color's brightness via HSV, like gardn's Renderer::HSV.
     * brightness > 1 brightens, < 1 darkens.
     */
    private hsvAdjust(color: string, brightness: number): string {
        let r: number, g: number, b: number;
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            r = parseInt(hex.slice(0, 2), 16) / 255;
            g = parseInt(hex.slice(2, 4), 16) / 255;
            b = parseInt(hex.slice(4, 6), 16) / 255;
        } else if (color.startsWith('rgba')) {
            const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!match) return color;
            r = parseInt(match[1]) / 255;
            g = parseInt(match[2]) / 255;
            b = parseInt(match[3]) / 255;
        } else if (color.startsWith('rgb')) {
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (!match) return color;
            r = parseInt(match[1]) / 255;
            g = parseInt(match[2]) / 255;
            b = parseInt(match[3]) / 255;
        } else {
            return color;
        }

        // RGB to HSV
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        const s = max === 0 ? 0 : d / max;
        const v = max;
        if (d !== 0) {
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }

        // Adjust value
        const newV = Math.min(1, Math.max(0, v * brightness));

        // HSV to RGB
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = newV * (1 - s);
        const q = newV * (1 - f * s);
        const t = newV * (1 - (1 - f) * s);
        let nr: number, ng: number, nb: number;
        switch (i % 6) {
            case 0: nr = newV; ng = t; nb = p; break;
            case 1: nr = q; ng = newV; nb = p; break;
            case 2: nr = p; ng = newV; nb = t; break;
            case 3: nr = p; ng = q; nb = newV; break;
            case 4: nr = t; ng = p; nb = newV; break;
            default: nr = newV; ng = p; nb = q; break;
        }

        const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
        return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
    }

    /**
     * Gets the button fill color based on hover/press state, matching gardn style.
     * Hover = 1.1x brightness, pressed = 0.9x brightness.
     */
    private getButtonFillColor(baseColor: string, isHovered: boolean, isPressed: boolean): string {
        if (isPressed) return this.hsvAdjust(baseColor, 0.9);
        if (isHovered) return this.hsvAdjust(baseColor, 1.1);
        return baseColor;
    }

    /**
     * Gets the stroke color for a button (darker shade via HSV, like gardn's stroke_hsv = 0.8)
     */
    private getButtonStrokeColor(baseColor: string): string {
        return this.hsvAdjust(baseColor, 0.8);
    }

    /**
     * Draws a gardn-style button: rounded rect with thick stroke, round cap/join
     */
    private drawGardnButton(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
                            baseColor: string, isHovered: boolean, isPressed: boolean,
                            text: string, fontSize: number = 18, lineWidth: number = 5, radius: number = 3): void {
        const fillColor = this.getButtonFillColor(baseColor, isHovered, isPressed);
        const strokeColor = this.getButtonStrokeColor(baseColor);

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.drawRoundedRect(ctx, x, y, width, height, radius);
        ctx.fill();
        ctx.stroke();

        // Draw text with stroke outline
        if (text) {
            ctx.font = `bold ${fontSize}px Ubuntu, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'miter';
            ctx.strokeText(text, x + width / 2, y + height / 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, x + width / 2, y + height / 2);
        }
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

        // Input background with rounded corners (gardn style)
        const nameInputBgColor = this.isNameInputFocused ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.9)';
        ctx.fillStyle = nameInputBgColor;
        ctx.strokeStyle = 'rgba(180, 180, 180, 0.8)';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.drawRoundedRect(ctx, nameInputX, nameInputY, nameInputWidth, nameInputHeight, 3);
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

        // Draw start button (gardn style)
        const startButtonY = centerY - 100;
        const startButtonX = centerX + 120;
        const startButtonWidth = 120;
        const startButtonHeight = 42;

        this.drawGardnButton(ctx, startButtonX, startButtonY, startButtonWidth, startButtonHeight,
            '#1dd129', this.hoveredStartButton, this.pressedButton === 'start', 'Ready', 18, 5, 3);

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
            const isPressed = this.pressedButton === `biome_${index}`;

            const buttonText = biomeConfig.displayName;
            const biomeColor = isSelected ? this.hsvAdjust(biomeConfig.color, 0.85) : biomeConfig.color;

            // Gardn-style button
            this.drawGardnButton(ctx, biomeX, biomeStartY, biomeButtonWidth, biomeButtonHeight,
                biomeColor, isHovered && !isSelected, isPressed, buttonText, 14, isSelected ? 5 : 4, 3);
        });

        // Draw controls text (below the loadout bar, which sits at centerY+50 with ~158px height)
        const controlsY = centerY + 225;
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
            'Press Z to open the inventory.',
            'Press number keys 1-9 to use items.',
            'Press K to switch between mouse and keyboard controls',
            'Use Q and E to swap petals',
            'Use T to unequip the selected petal'
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

        // Advanced settings toggle button (gardn style)
        const advancedButtonY = currentY;
        const advancedButtonWidth = inputWidth;
        const advancedButtonHeight = 35;
        const isAdvancedHovered = this.hoveredAuthButton === 'toggleAdvanced';
        const isAdvancedPressed = this.pressedButton === 'toggleAdvanced';
        const advancedText = `Advanced Settings ${this.authAdvancedSettingsVisible ? '▲' : '▼'}`;
        this.drawGardnButton(ctx, inputX, advancedButtonY, advancedButtonWidth, advancedButtonHeight,
            '#7B2FA0', isAdvancedHovered, isAdvancedPressed, advancedText, 14, 4, inputRadius);
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
                         _radius: number, fieldName: string, value: string, placeholder: string, isPassword: boolean = false): void {
        const isFocused = this.authFocusedField === fieldName;
        const bgColor = 'rgb(24, 206, 24)';
        ctx.fillStyle = bgColor;
        ctx.strokeStyle = this.hsvAdjust('#18ce18', 0.8);
        ctx.lineWidth = isFocused ? 5 : 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.drawRoundedRect(ctx, x, y, width, height, 3);
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
        const isPressed = this.pressedButton === buttonId;
        this.drawGardnButton(ctx, x, y, width, height, color, isHovered, isPressed, text, 18, 5, radius);
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


    public hideAuthContainer(): void {
        this.showAuthForm = false;
        // Also hide DOM-based auth container
        if (this.authContainer) {
            this.authContainer.style.display = 'none';
        }
        // Show loadout bar when auth form is hidden
        const loadoutBar = document.getElementById('titleScreenLoadoutBar');
        if (loadoutBar) {
            loadoutBar.style.display = 'block';
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
                // Connect socket if not already connected, then authenticate
                if (!window.preconnectedSocket) {
                    (window as any).preconnectToServer?.();
                } else {
                    this.titleScreenInventoryManager.reauthenticate();
                }
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
                if (!window.preconnectedSocket) {
                    (window as any).preconnectToServer?.();
                } else {
                    this.titleScreenInventoryManager.reauthenticate();
                }
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
            loadoutBar.style.display = 'block';
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

        // Re-initialize shop and mob gallery (they were torn down in hideTitleScreenPanels)
        if (!this.titleScreenShopManager) {
            this.initializeTitleScreenShop();
        }
        if (!this.titleScreenMobGallery) {
            this.initializeTitleScreenMobGallery();
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

    public showLoadingScreen(): void {
        this.loadingScreen.classList.remove('hidden');
    }

    public hideLoadingScreen(): void {
        this.loadingScreen.classList.add('hidden');
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
 * Adapter that provides a GameInterface for using InventoryManager on the title screen.
 * Wraps the title screen's player data and preconnected socket.
 */
class TitleScreenGameAdapter implements GameInterface {
    canvas: HTMLCanvasElement;
    private _playerData: { inventory: PlayerInventory; loadout: (Item | null)[] } | null = null;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setPlayerData(pd: { inventory: PlayerInventory; loadout: (Item | null)[] } | null): void {
        this._playerData = pd;
    }

    getLocalPlayer(): Player | undefined {
        if (!this._playerData) return undefined;
        return {
            id: (window as any).preconnectedSocket?.id || '',
            name: '',
            x: 0, y: 0, angle: 0, score: 0,
            imageLoaded: false,
            image: new Image(),
            velocityX: 0, velocityY: 0,
            health: 100, maxHealth: 100, damage: 0,
            inventory: this._playerData.inventory,
            loadout: this._playerData.loadout,
            level: 1, xp: 0, xpToNextLevel: 100,
            targetX: 0, targetY: 0,
        };
    }

    getSocket() {
        return (window as any).preconnectedSocket || undefined;
    }

    showFloatingText(_x: number, _y: number, text: string, _color: string, _fontSize: number): void {
        console.log(`[TitleScreen] ${text}`);
    }

    /** Used by CanvasInventoryPanel — pulls petal frames from preloaded assets. */
    getPetalCanvas(petalType: string, rarity: string, _time?: number): HTMLCanvasElement | null {
        const assets = (window as any).preloadedAssets;
        if (!assets || !assets.petalImages) return null;
        const entry = assets.petalImages[`${petalType}_${rarity}`];
        if (!entry) return null;
        if (Array.isArray(entry)) {
            const frameIndex = Math.floor((Date.now() / 42) % entry.length);
            return entry[frameIndex];
        }
        return entry;
    }

    /** Used by CanvasInventoryPanel — converts a preloaded sprite into a data URL. */
    getItemSpriteDataUrl(itemType: string): string | null {
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
        } catch {
            return null;
        }
    }
}

/**
 * Title Screen Inventory Manager
 * Handles inventory and loadout on the title screen using the preconnected socket.
 * Crafting is delegated to a real InventoryManager instance.
 */
class TitleScreenInventoryManager {
    private inventoryPanel: HTMLDivElement | null = null;
    private loadoutCanvas: HTMLCanvasElement | null = null;
    private canvasLoadoutBar: CanvasLoadoutBar | null = null;
    private loadoutRafId: number | null = null;
    /** source slot of an in-progress canvas-to-canvas drag, -1 if none */
    private canvasDragSourceSlot: number = -1;
    /** timestamp of last local loadout mutation for optimistic-update suppression */
    public lastLocalLoadoutChange: number = 0;
    public readonly LOADOUT_SYNC_SUPPRESS_MS: number = 600;
    private playerData: { inventory: PlayerInventory; loadout: (Item | null)[]; tp?: number; skills?: any; stars?: number; mobKills?: any } | null = null;
    private socket: any = null;
    private isAuthenticated: boolean = false;
    // Incremental inventory display caching
    private renderedItems: Map<string, { element: HTMLElement; count: number }> = new Map();
    private renderedRarityRows: Map<string, { row: HTMLElement; grid: HTMLElement }> = new Map();
    private inventoryGridContainer: HTMLElement | null = null;
    private canvasInventoryPanel: CanvasInventoryPanel | null = null;
    private svgBlobUrlCache: Map<string, string> = new Map();
    private readonly LOADOUT_SLOTS = 20;
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
    /** Real InventoryManager used for crafting (uses the same code as in-game) */
    private gameAdapter: TitleScreenGameAdapter;
    public craftingInventoryManager: InventoryManager;

    constructor() {
        this.gameAdapter = new TitleScreenGameAdapter();
        this.craftingInventoryManager = new InventoryManager(this.gameAdapter, null, { craftingOnly: true });
        this.initializeLoadoutBar();
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
        // The title-screen loadout is now a <canvas> that uses the same CanvasLoadoutBar
        // renderer as the in-game loadout.
        const canvas = document.getElementById('titleScreenLoadoutBar') as HTMLCanvasElement | null;
        if (!canvas) {
            setTimeout(() => this.initializeLoadoutBar(), 100);
            return;
        }
        this.loadoutCanvas = canvas;

        // Hand CanvasLoadoutBar a minimal "game" adapter that exposes player data and sprites.
        const adapter = {
            canvas,
            getLocalPlayer: () => ({
                loadout: this.playerData?.loadout ?? new Array(this.LOADOUT_SLOTS).fill(null)
            }),
            getPetalCanvas: (petalType: string, rarity: string, _time?: number): HTMLCanvasElement | null => {
                const assets = (window as any).preloadedAssets;
                if (!assets || !assets.petalImages) return null;
                const entry = assets.petalImages[`${petalType}_${rarity}`];
                if (!entry) return null;
                if (Array.isArray(entry)) {
                    const frameIndex = Math.floor((Date.now() / 42) % entry.length);
                    return entry[frameIndex];
                }
                return entry;
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
            },
            inventoryManager: this as any,
        };
        this.canvasLoadoutBar = new CanvasLoadoutBar(adapter);
        this.canvasLoadoutBar.show();

        // RAF loop to keep the bar painted (cheap: returns early when hidden)
        const ctx = canvas.getContext('2d');
        console.log('[TitleScreen] initializeLoadoutBar: canvas found, ctx=', !!ctx, 'bar=', !!this.canvasLoadoutBar);
        const frame = () => {
            if (ctx && this.canvasLoadoutBar) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                this.canvasLoadoutBar.draw(ctx);
            }
            this.loadoutRafId = requestAnimationFrame(frame);
        };
        if (this.loadoutRafId == null) this.loadoutRafId = requestAnimationFrame(frame);

        this.setupCanvasLoadoutInteractions(canvas);
    }

    private setupCanvasLoadoutInteractions(canvas: HTMLCanvasElement): void {
        const getLocalXY = (e: MouseEvent | DragEvent) => {
            const r = canvas.getBoundingClientRect();
            // Map CSS pixels back to canvas internal resolution
            const sx = (e.clientX - r.left) * (canvas.width / r.width);
            const sy = (e.clientY - r.top) * (canvas.height / r.height);
            return { x: sx, y: sy };
        };

        // Hover tracking
        canvas.addEventListener('mousemove', (e) => {
            if (!this.canvasLoadoutBar) return;
            const { x, y } = getLocalXY(e);
            this.canvasLoadoutBar.setHover(x, y);
            if (this.canvasLoadoutBar.draggingSlotIndex >= 0) {
                this.canvasLoadoutBar.setDragPos(x, y);
            }
        });
        canvas.addEventListener('mouseleave', () => {
            if (this.canvasLoadoutBar) this.canvasLoadoutBar.setHover(-1, -1);
        });

        // Start drag from a filled canvas slot — uses HTML5 DataTransfer so it can be
        // dropped onto the existing DOM inventory grid.
        canvas.draggable = true;
        canvas.addEventListener('dragstart', (e: DragEvent) => {
            if (!this.canvasLoadoutBar || !this.playerData) { e.preventDefault(); return; }
            const { x, y } = getLocalXY(e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);
            if (hit < 0 || hit >= this.LOADOUT_SLOTS) { e.preventDefault(); return; }
            const item = this.playerData.loadout[hit];
            if (!item) { e.preventDefault(); return; }
            this.canvasDragSourceSlot = hit;
            this.canvasLoadoutBar.beginDrag(hit, x, y);
            e.dataTransfer?.setData('text/loadoutSlot', hit.toString());
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            // Render the dragged petal onto a small offscreen canvas and use it as the drag image
            // (some browsers render a URL icon for blank canvas drag images).
            if (e.dataTransfer && item.type === 'petal' && item.petalType && item.rarity) {
                const gs = 40;
                const ghost = document.createElement('canvas');
                ghost.width = gs; ghost.height = gs;
                // Force CSS size to match internal resolution so the browser doesn't scale it up
                ghost.style.width = `${gs}px`;
                ghost.style.height = `${gs}px`;
                ghost.style.position = 'fixed';
                ghost.style.top = '-1000px';
                ghost.style.left = '-1000px';
                document.body.appendChild(ghost);
                const gctx = ghost.getContext('2d');
                const assets = (window as any).preloadedAssets;
                const entry = assets?.petalImages?.[`${item.petalType}_${item.rarity}`];
                const petalCanvas = Array.isArray(entry)
                    ? entry[Math.floor(Date.now() / 42) % entry.length]
                    : entry;
                if (gctx && petalCanvas) {
                    gctx.drawImage(petalCanvas, 0, 0, gs, gs);
                }
                e.dataTransfer.setDragImage(ghost, gs / 2, gs / 2);
                requestAnimationFrame(() => ghost.remove());
            } else {
                // Fallback: a 1x1 transparent image
                const img = new Image();
                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                e.dataTransfer?.setDragImage(img, 0, 0);
            }
        });
        canvas.addEventListener('dragend', () => {
            this.canvasDragSourceSlot = -1;
            this.canvasLoadoutBar?.endDrag();
        });

        // Accept drops from the inventory grid OR from other canvas slots
        canvas.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            if (this.canvasLoadoutBar) {
                const { x, y } = getLocalXY(e);
                this.canvasLoadoutBar.setHover(x, y);
                if (this.canvasLoadoutBar.draggingSlotIndex >= 0) {
                    this.canvasLoadoutBar.setDragPos(x, y);
                }
            }
        });
        canvas.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            if (!this.canvasLoadoutBar) return;
            const { x, y } = getLocalXY(e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);

            const itemData = e.dataTransfer?.getData('text/plain');
            const fromLoadoutSlot = e.dataTransfer?.getData('text/loadoutSlot');

            if (hit === CANVAS_LOADOUT_SLOT_COUNT) {
                // Dropped on trash
                if (fromLoadoutSlot) this.moveItemToInventory(parseInt(fromLoadoutSlot));
            } else if (hit >= 0 && hit < CANVAS_LOADOUT_SLOT_COUNT) {
                if (itemData) {
                    try {
                        const { rarity, type } = JSON.parse(itemData);
                        if (rarity && type) this.equipItemToLoadout(rarity, type, hit);
                    } catch {}
                } else if (fromLoadoutSlot) {
                    const from = parseInt(fromLoadoutSlot);
                    if (from !== hit) this.swapLoadoutItems(from, hit);
                }
            }
            this.canvasLoadoutBar.endDrag();
            this.canvasDragSourceSlot = -1;
        });
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

        // Listen for crafting finished event
        this.socket.on('craftingFinished', (data: { successCount: number; failCount: number; newItem: { type: string; rarity: string }; inventory: any }) => {
            console.log('[TitleScreen] craftingFinished received:', data);

            // Update inventory
            if (this.playerData) {
                this.playerData.inventory = data.inventory;
                this.gameAdapter.setPlayerData(this.playerData);
            }

            if (data.successCount > 0) {
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

                this.craftingInventoryManager.showCraftingSuccess(displayItem, data.successCount);
            }

            if (data.failCount > 0) {
                console.log(`[TitleScreen] Failed to craft ${data.failCount}x. Items were lost.`);
            }

            // Update displays
            if (this.craftingInventoryManager.isCraftingOpen) {
                this.craftingInventoryManager.updateCraftingDisplay();
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
                    this.gameAdapter.setPlayerData(this.playerData);
                }
                if (this.craftingInventoryManager.isCraftingOpen) {
                    this.craftingInventoryManager.updateCraftingDisplay();
                    this.updateInventoryDisplay();
                }
            }
            if (this.playerData) {
                if (updatedPlayer.stars !== undefined) this.playerData.stars = updatedPlayer.stars;
                if (updatedPlayer.mobKills) this.playerData.mobKills = updatedPlayer.mobKills;
            }
        });
    }

    /** Re-bind to the current preconnected socket and re-authenticate to fetch fresh data. */
    public reauthenticate(): void {
        if (window.preconnectedSocket) {
            this.socket = window.preconnectedSocket;
            // Clear the one-shot flag so authenticate runs again
            if ((this.socket as any)._titleScreenAuthenticated) {
                (this.socket as any)._titleScreenAuthenticated = false;
            }
            this.isAuthenticated = false;
            this.authenticateAndFetchData();
        }
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
                // Sync adapter so the real InventoryManager can access player data
                this.gameAdapter.setPlayerData(this.playerData);
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

    private updateLoadoutDisplay(): void {
        // The title-screen loadout is now canvas-rendered and repaints every frame.
        // This method is kept as a no-op for existing callers.
        return;
    }

    
    private formatPetalName(petalType: string): string {
        if (!petalType) return "";
        let itemName = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
        itemName = itemName.replace('_', ' ');
        return itemName;
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
        
        // Pad to full loadout length so secondary-row writes are preserved
        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = this.playerData.loadout[i] || null;
        }

        this.removeItem(rarity, type, 1);

        const existingItem = newLoadout[loadoutSlot];
        if (existingItem && existingItem.rarity) {
            const existingKey = existingItem.type === 'petal' ? `${existingItem.type}_${existingItem.petalType}` : existingItem.type;
            this.addItem(existingItem.rarity, existingKey, 1);
        }

        newLoadout[loadoutSlot] = item;
        this.playerData.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        
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

        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = this.playerData.loadout[i] || null;
        }
        newLoadout[loadoutSlot] = null;
        this.playerData.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        
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

        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = this.playerData.loadout[i] || null;
        }
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        this.playerData.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        
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

    private createInventoryItemElement(rarity: string, type: string, count: number): HTMLElement | null {
        // Skip eggs on title screen
        if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg')) {
            return null;
        }
        const itemCount = typeof count === 'number' ? count : 0;
        if (itemCount <= 0) return null;

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

        itemElement.addEventListener('click', () => {
            if (!this.playerData) return;
            const loadout = this.playerData.loadout;
            let emptySlot = -1;
            for (let i = 0; i < CANVAS_LOADOUT_SLOT_COUNT; i++) {
                if (!loadout[i]) { emptySlot = i; break; }
            }
            if (emptySlot >= 0) {
                this.equipItemToLoadout(rarity, type, emptySlot);
            }
        });

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

                const cacheKey = `${petalType}_${rarity}`;
                let url = this.svgBlobUrlCache.get(cacheKey);
                if (!url) {
                    const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                    url = URL.createObjectURL(svgBlob);
                    this.svgBlobUrlCache.set(cacheKey, url);
                }
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

            this.setupTooltip(itemElement, petalType, rarity);
        }

        return itemElement;
    }

    private createRarityRow(rarity: string): { row: HTMLElement; grid: HTMLElement } {
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

        rarityRow.appendChild(grid);
        return { row: rarityRow, grid };
    }

    private updateInventoryDisplay(): void {
        if (!this.inventoryPanel) return;

        // Canvas inventory re-renders from playerData every frame; nothing to push.
        if (this.canvasInventoryPanel) return;

        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content) return;

        if (!this.playerData) {
            content.innerHTML = '';
            const title = document.createElement('h2');
            title.textContent = 'Inventory';
            content.appendChild(title);
            const loading = document.createElement('div');
            loading.textContent = 'Loading inventory...';
            loading.style.cssText = 'color: white; padding: 20px; text-align: center;';
            content.appendChild(loading);
            this.inventoryGridContainer = null;
            return;
        }

        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        const invDict = this.playerData?.inventory ? inventoryToDict(this.playerData.inventory) : {};

        // Build set of current item keys for removal detection
        const currentKeys = new Set<string>();
        for (const rarity in invDict) {
            for (const type in invDict[rarity]) {
                if (invDict[rarity][type] > 0) {
                    // Skip eggs
                    if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg')) continue;
                    currentKeys.add(`${rarity}:${type}`);
                }
            }
        }

        // Incremental update if grid container already exists
        if (this.inventoryGridContainer && this.inventoryGridContainer.parentNode === content) {
            // Remove items that no longer exist
            for (const [key, entry] of this.renderedItems) {
                if (!currentKeys.has(key)) {
                    entry.element.remove();
                    this.renderedItems.delete(key);
                }
            }

            rarities.forEach(rarity => {
                const items = invDict[rarity];
                const hasItems = items && Object.keys(items).some(type => {
                    if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg')) return false;
                    return items[type] > 0;
                });

                if (hasItems) {
                    let rarityEntry = this.renderedRarityRows.get(rarity);
                    if (!rarityEntry) {
                        rarityEntry = this.createRarityRow(rarity);
                        this.renderedRarityRows.set(rarity, rarityEntry);
                        const rarityIndex = rarities.indexOf(rarity);
                        let insertBefore: HTMLElement | null = null;
                        for (let i = rarityIndex + 1; i < rarities.length; i++) {
                            const nextEntry = this.renderedRarityRows.get(rarities[i]);
                            if (nextEntry) { insertBefore = nextEntry.row; break; }
                        }
                        this.inventoryGridContainer!.insertBefore(rarityEntry.row, insertBefore);
                    }

                    Object.entries(items).forEach(([type, count]) => {
                        const key = `${rarity}:${type}`;
                        if (!currentKeys.has(key)) return;
                        const existing = this.renderedItems.get(key);
                        if (existing) {
                            if (existing.count !== count) {
                                const countLabel = existing.element.querySelector('.item-count');
                                if (countLabel) countLabel.textContent = count.toString();
                                existing.count = count;
                            }
                        } else {
                            const itemElement = this.createInventoryItemElement(rarity, type, count);
                            if (itemElement) {
                                rarityEntry!.grid.appendChild(itemElement);
                                this.renderedItems.set(key, { element: itemElement, count });
                            }
                        }
                    });
                } else {
                    const rarityEntry = this.renderedRarityRows.get(rarity);
                    if (rarityEntry) {
                        rarityEntry.row.remove();
                        this.renderedRarityRows.delete(rarity);
                    }
                }
            });

            return;
        }

        // Full rebuild (first render)
        content.innerHTML = '';
        this.renderedItems.clear();
        this.renderedRarityRows.clear();

        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);

        const gridContainer = document.createElement('div');
        gridContainer.className = 'inventory-grid-container';
        gridContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
        `;
        this.inventoryGridContainer = gridContainer;

        rarities.forEach(rarity => {
            const items = invDict[rarity];
            if (items && Object.keys(items).length > 0) {
                const rarityEntry = this.createRarityRow(rarity);
                this.renderedRarityRows.set(rarity, rarityEntry);

                Object.entries(items).forEach(([type, count]) => {
                    const itemElement = this.createInventoryItemElement(rarity, type, count);
                    if (itemElement) {
                        rarityEntry.grid.appendChild(itemElement);
                        this.renderedItems.set(`${rarity}:${type}`, { element: itemElement, count });
                    }
                });

                gridContainer.appendChild(rarityEntry.row);
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

        // Reuse a stale panel from a previous game session if one exists, but
        // always strip its old DOM children so the canvas mounts cleanly.
        let inventoryPanel = document.getElementById('inventoryPanel') as HTMLDivElement;
        if (!inventoryPanel) {
            inventoryPanel = document.createElement('div');
            inventoryPanel.id = 'inventoryPanel';
            inventoryPanel.className = 'inventory-panel';
            inventoryPanel.style.display = 'none';
            document.body.appendChild(inventoryPanel);
        }
        this.inventoryPanel = inventoryPanel;

        // First-time mount: build header + close button + canvas inventory.
        if (!this.canvasInventoryPanel) {
            inventoryPanel.innerHTML = '';

            const closeBtn = document.createElement('button');
            closeBtn.className = 'inventory-close-button';
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = `
                position: absolute;
                top: 10px;
                right: 10px;
                width: 28px;
                height: 28px;
                background: #dc7e92;
                color: white;
                border: 2px solid #b56476;
                border-radius: 6px;
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                line-height: 1;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2;
            `;
            closeBtn.addEventListener('click', () => this.toggleInventory());
            inventoryPanel.appendChild(closeBtn);

            const title = document.createElement('h2');
            title.className = 'inventory-title';
            title.textContent = 'Inventory';
            inventoryPanel.appendChild(title);

            const subtitle = document.createElement('div');
            subtitle.className = 'inventory-subtitle';
            subtitle.textContent = 'Drag a petal to equip it';
            inventoryPanel.appendChild(subtitle);

            const controls = document.createElement('div');
            controls.className = 'inventory-controls';

            const stackLabel = document.createElement('label');
            stackLabel.className = 'inventory-stack-toggle';
            const stackCheckbox = document.createElement('input');
            stackCheckbox.type = 'checkbox';
            stackCheckbox.checked = true;
            const stackText = document.createElement('span');
            stackText.textContent = 'Stack';
            stackLabel.appendChild(stackCheckbox);
            stackLabel.appendChild(stackText);
            controls.appendChild(stackLabel);

            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.className = 'inventory-search';
            controls.appendChild(searchInput);
            inventoryPanel.appendChild(controls);

            const inventoryContent = document.createElement('div');
            inventoryContent.className = 'inventory-content';
            inventoryContent.style.cssText = `
                flex: 1 1 auto;
                min-height: 0;
                min-width: 0;
                overflow: hidden;
                padding: 0;
                margin: 0;
                box-sizing: border-box;
                position: relative;
                display: block;
            `;
            inventoryPanel.appendChild(inventoryContent);

            this.canvasInventoryPanel = new CanvasInventoryPanel(this.gameAdapter as any);
            this.canvasInventoryPanel.attachTo(inventoryContent);
            this.canvasInventoryPanel.onItemMouseDown = (rarity, itemType) => {
                if (!this.playerData) return;
                let emptySlot = -1;
                for (let i = 0; i < CANVAS_LOADOUT_SLOT_COUNT; i++) {
                    if (!this.playerData.loadout[i]) { emptySlot = i; break; }
                }
                if (emptySlot >= 0) {
                    this.equipItemToLoadout(rarity, itemType, emptySlot);
                }
            };
            this.canvasInventoryPanel.onItemHoverChange = (hit: InventoryHitInfo | null) => {
                this.handleCanvasInventoryHover(hit);
            };
            this.canvasInventoryPanel.setStackMode(stackCheckbox.checked);
            stackCheckbox.addEventListener('change', () => {
                this.canvasInventoryPanel?.setStackMode(stackCheckbox.checked);
            });
            searchInput.addEventListener('input', () => {
                this.canvasInventoryPanel?.setSearchFilter(searchInput.value);
            });
        }

        const isOpen = inventoryPanel.style.display !== 'none' && inventoryPanel.style.display !== '';
        if (!isOpen) {
            inventoryPanel.style.display = 'flex';
            this.canvasInventoryPanel.start();
            setTimeout(() => inventoryPanel.classList.add('open'), 10);
        } else {
            inventoryPanel.classList.remove('open');
            this.canvasInventoryPanel.stop();
            setTimeout(() => { inventoryPanel.style.display = 'none'; }, 300);
        }
    }

    /** Tooltip hover bridge for the canvas inventory panel. */
    private handleCanvasInventoryHover(hit: InventoryHitInfo | null): void {
        if (this.tooltipTimeout !== null) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        if (this.tooltipElement) {
            this.tooltipElement.remove();
            this.tooltipElement = null;
        }
        if (!hit || !hit.itemType.startsWith('petal_')) return;
        const petalType = hit.itemType.replace('petal_', '');
        const rarity = hit.rarity;
        const rect = hit.rect;
        this.tooltipTimeout = window.setTimeout(() => {
            this.showTooltipAtRect(rect, petalType, rarity);
            this.updateTooltipValues((window as any).altKeyPressed || false);
        }, 200);
    }

    /** Like showTooltip() but anchored to a client-space rect (canvas hit). */
    private showTooltipAtRect(
        rect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
        petalType: string,
        rarity: string
    ): void {
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return;
        if (this.tooltipElement) { this.tooltipElement.remove(); this.tooltipElement = null; }

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

        const tooltipRect = tooltip.getBoundingClientRect();
        let left = rect.right + 10;
        let top = rect.top;
        if (left + tooltipRect.width > window.innerWidth) left = rect.left - tooltipRect.width - 10;
        if (top + tooltipRect.height > window.innerHeight) top = window.innerHeight - tooltipRect.height - 10;
        if (top < 0) top = 10;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    public updateFromPlayerData(playerData: { inventory: PlayerInventory; loadout: (Item | null)[]; tp?: number; skills?: any }): void {
        // Suppress stale server-pushed loadout data while an optimistic edit is in flight
        if (this.playerData && Date.now() - this.lastLocalLoadoutChange < this.LOADOUT_SYNC_SUPPRESS_MS) {
            // Keep local loadout, merge other fields
            this.playerData = {
                ...playerData,
                loadout: this.playerData.loadout,
                inventory: this.playerData.inventory,
            };
        } else {
            // Pad loadout to 20 slots so secondary row is always present
            const padded: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
            const src = playerData.loadout || [];
            for (let i = 0; i < Math.min(src.length, this.LOADOUT_SLOTS); i++) padded[i] = src[i] || null;
            this.playerData = { ...playerData, loadout: padded };
        }
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
        // Update the game adapter and crafting display
        this.gameAdapter.setPlayerData(this.playerData);
        if (this.craftingInventoryManager.isCraftingOpen) {
            this.craftingInventoryManager.updateCraftingDisplay();
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

        // Update adapter with current player data before toggling
        this.gameAdapter.setPlayerData(this.playerData);
        this.craftingInventoryManager.toggleCrafting();
    }

    public toggleSkills(): void {
        // This is now handled by TitleScreen.toggleSkillsOnTitleScreen()
        // This method is kept for compatibility but shouldn't be called directly
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
