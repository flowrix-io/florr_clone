/**
 * Title Screen Menu Management
 * Handles all menu-related DOM elements and interactions
 */

import { ChangelogManager, CHANGELOG } from '../changelog';
import { NotificationsManager } from '../notifications';
import { LeaderboardManager } from '../leaderboard';
import { GuildMenuManager } from '../guildMenu';
import '../graphics/flower';
import { applyZoomCompensation, canvasCoords } from '../zoom-compensation';
import { TitleScreenInventoryManager } from './inventory_manager';
import { drawRoundedRect, hsvAdjust, drawGardnButton } from './render_utils';
import { getBiomeConfig } from './biomes';
import { BackgroundAnimation } from './background';
import { SettingsMenu, getControls } from './settings_menu';
import { AuthForm } from './auth_form';
import { TitleScreenSubmanagers } from './submanagers';

export { injectTitleScreenStyles, titleScreenStyles } from './styles';

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
    // settingsMenu is now canvas-based (see settingsOpen, settingsTab, etc.)
    private background: BackgroundAnimation;
    private availableBiomes: string[] = [];
    private changelogManager!: ChangelogManager;
    private notificationsManager!: NotificationsManager;
    private leaderboardManager!: LeaderboardManager;
    public guildMenuManager!: GuildMenuManager;
    private titleScreenInventoryManager!: TitleScreenInventoryManager;
    private submanagers!: TitleScreenSubmanagers;
    // Canvas-based UI
    private uiCanvas!: HTMLCanvasElement;
    private uiCtx!: CanvasRenderingContext2D;
    private playerName: string = '';
    private isNameInputFocused: boolean = false;
    private hoveredBiomeIndex: number = -1;
    private hoveredStartButton: boolean = false;
    private animationFrameId: number | null = null;
    
    // Auth form state (canvas-based)
    private authForm: AuthForm = new AuthForm({ onAction: (action) => {
        if (action === 'login') this.handleAuthLogin();
        else if (action === 'register') this.handleAuthRegister();
        else if (action === 'guest') this.handleAuthGuest();
        else if (action === 'offline') this.handleAuthOfflineRegister();
    }});
    private pressedButton: string | null = null; // tracks which button is currently pressed (mousedown)

    private settings: SettingsMenu = new SettingsMenu();

    // FPS/stats tracking for title screen
    private titleFrameCount: number = 0;
    private titleFpsCounter: number = 0;
    private titleFpsUpdateTime: number = performance.now();

    constructor() {
        this.background = new BackgroundAnimation();
        this.initializeElements();
        this.changelogManager = new ChangelogManager();
        this.notificationsManager = new NotificationsManager();
        this.leaderboardManager = new LeaderboardManager();
        this.guildMenuManager = new GuildMenuManager();
        (window as any).guildMenuManager = this.guildMenuManager;
        // Make notifications manager globally accessible
        (window as any).notificationsManager = this.notificationsManager;
        
        // Set canvas on managers after canvas is available
        const setupCanvas = (canvas: HTMLCanvasElement) => {
            // Ensure canvas has proper dimensions (not just CSS sizing)
            if (canvas.width === 0 || canvas.height === 0) {
                applyZoomCompensation(canvas);
            }
            // Ensure canvas is visible on title screen
            canvas.style.zIndex = '1';
            canvas.style.pointerEvents = 'auto';
            this.changelogManager.setCanvas(canvas);
            this.notificationsManager.setCanvas(canvas);
            this.leaderboardManager.setCanvas(canvas);
            this.guildMenuManager.setCanvas(canvas);
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
        this.submanagers = new TitleScreenSubmanagers(this.titleScreenInventoryManager, this.guildMenuManager);

        // Initialize chat / skills / shop / mob gallery when the socket is available
        this.submanagers.initChat();
        this.submanagers.initSkills();
        this.submanagers.initShop();
        this.submanagers.initMobGallery();
        
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
        // PVP arena lives outside the regular map; surface it as its own pickable destination.
        biomeNames.add('pvp');

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
            pointer-events: none;
        `;
        this.centerText.innerHTML = `
            <div id="titleScreenLoadoutWrap" style="margin-top: 20px; display: flex; justify-content: center;">
                <canvas id="titleScreenLoadoutBar" width="900" height="210" style="background: transparent; display: block; pointer-events: auto; width: 900px; height: 211px;"></canvas>
            </div>
        `;

        // Settings values load themselves in the SettingsMenu constructor.


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
            pointer-events: none;
        `;
        // Import game icons
        const { GAME_ICONS_NET_ICONS } = require('../game-icons-net-icons');
        const settingsIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'settings')?.value || '';
        const changelogIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'changelog')?.value || '';
        const notificationsIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'notifications')?.value || '';
        const leaderboardIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'leaderboard')?.value || '';
        const guildIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'guild')?.value || '';
        const exitIcon = GAME_ICONS_NET_ICONS.find((icon: any) => icon.name === 'exit_button')?.value || '';
        // Update the SVG to be 32x32
        const formattedSettingsIcon = settingsIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedChangelogIcon = changelogIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedNotificationsIcon = notificationsIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedLeaderboardIcon = leaderboardIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedGuildIcon = guildIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedExitIcon = exitIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        this.exitButtonContainer.innerHTML = `
            <style>
                .gardn-icon-btn {
                    width: 42px; height: 42px; cursor: pointer; padding: 5px;
                    border-radius: 3px; display: flex; align-items: center;
                    justify-content: center; box-sizing: border-box;
                    border-style: solid; border-width: 4px;
                    transition: filter 0.05s;
                    pointer-events: auto;
                    overflow: hidden;
                }
                .gardn-icon-btn svg {
                    width: 32px !important; height: 32px !important;
                    pointer-events: none;
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
            <div id="guildButton" class="gardn-icon-btn" style="background: #27dade; border-color: #1fb3b0;" title="Guild">
                ${formattedGuildIcon}
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
            pointer-events: none;
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

        // Create UI canvas for title screen elements
        this.uiCanvas = document.createElement('canvas');
        this.uiCanvas.id = 'title-ui-canvas';
        this.uiCanvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: auto;
            z-index: 1000;
        `;
        applyZoomCompensation(this.uiCanvas);
        this.uiCtx = this.uiCanvas.getContext('2d')!;
        
        // Load saved player name
        const savedName = localStorage.getItem('playerName') || '';
        this.playerName = savedName;
        // Sync to dummy input after a short delay to ensure DOM is ready
        setTimeout(() => this.syncPlayerNameToInput(), 100);
        
        // Initialize auth server IP from localStorage
        const savedServerUrl = localStorage.getItem('serverUrl');
        if (savedServerUrl) {
            this.authForm.serverIP = savedServerUrl;
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
            if (this.submanagers.chat && this.submanagers.chat.isFocused) {
                if (event.key === 'Escape') {
                    this.submanagers.chat.blur();
                }
                return;
            }

            // Don't interfere if auth form field or name input is focused
            if (this.authForm.isVisible() || this.isNameInputFocused) {
                return;
            }
            
            const controls = getControls();
            
            // Chat shortcut
            if (event.key === (controls.chat || 'Enter')) {
                if (this.submanagers.chat) {
                    this.submanagers.chat.focus();
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
        const guildButton = this.exitButtonContainer.querySelector('#guildButton');
        const exitButton = this.exitButtonContainer.querySelector('#exitButton');

        console.log('Setting up buttons - changelogButton:', !!changelogButton, 'notificationsButton:', !!notificationsButton);

        if (settingsButton) {
            settingsButton.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close other menus
                this.changelogManager.hide();
                this.notificationsManager.hide();
                this.leaderboardManager.hide();
                this.guildMenuManager.hide();
                this.toggleSettings();
            });
        }

        if (changelogButton) {
            changelogButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                // Close other menus
                this.settings.close();
                this.notificationsManager.hide();
                this.leaderboardManager.hide();
                this.guildMenuManager.hide();
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
                this.settings.close();
                this.changelogManager.hide();
                this.leaderboardManager.hide();
                this.guildMenuManager.hide();
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
                this.settings.close();
                this.changelogManager.hide();
                this.notificationsManager.hide();
                this.guildMenuManager.hide();
                this.leaderboardManager.toggle();
            });
        }

        if (guildButton) {
            guildButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                // Close other menus
                this.settings.close();
                this.changelogManager.hide();
                this.notificationsManager.hide();
                this.leaderboardManager.hide();
                this.guildMenuManager.toggle();
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
                    } else if (this.submanagers.shop) {
                        this.submanagers.shop.toggleShop();
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
                    } else if (this.submanagers.mobGallery) {
                        this.submanagers.mobGallery.toggleMobGallery();
                    } else {
                        console.log('Mob Gallery not yet available');
                    }
                    return false;
                }, true);
            }
        }, 100);

        // Setup name input persistence
        this.setupNameInputPersistence();
    }

    public async appendToBody(): Promise<void> {
        this.background.mount();
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

        // Load and start background animation; per-frame callback drives the
        // changelog/notifications/leaderboard/guild canvas state.
        await this.background.loadTexture();
        this.background.start(() => this.renderInGameMenusOverlay());

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
                loadoutBar.style.display = this.authForm.isVisible() ? 'none' : 'block';
            }
        }, 100);

        // Setup canvas UI event listeners
        this.setupCanvasUIListeners();

        // Start canvas rendering loop
        this.startCanvasRendering();
        
        // If user is not logged in, show login form after a short delay
        // (in case preconnectToServer is not called)
        setTimeout(() => {
            if (this.authForm.isConnectingState()) {
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
            const { x, y } = canvasCoords(this.uiCanvas, e);
            this.handleCanvasClick(x, y);
        });

        // Mouse move for hover effects
        this.uiCanvas.addEventListener('mousemove', (e) => {
            const { x, y } = canvasCoords(this.uiCanvas, e);
            this.settings.handleMouseMove(x);
            this.handleCanvasHover(x, y);
        });

        // Mouse down for pressed state
        this.uiCanvas.addEventListener('mousedown', (e) => {
            const { x, y } = canvasCoords(this.uiCanvas, e as MouseEvent);
            if (this.settings.handleMouseDown(x, y)) {
                this.pressedButton = null;
                return;
            }
            if (this.hoveredStartButton) this.pressedButton = 'start';
            else if (this.hoveredBiomeIndex >= 0) this.pressedButton = `biome_${this.hoveredBiomeIndex}`;
            else if (this.authForm.getHoveredButton()) this.pressedButton = this.authForm.getHoveredButton();
            else this.pressedButton = null;
        });

        // Mouse up to clear pressed state
        document.addEventListener('mouseup', () => {
            this.pressedButton = null;
            this.settings.handleMouseUp();
        });

        // Mouse leave to clear hover
        this.uiCanvas.addEventListener('mouseleave', () => {
            this.hoveredBiomeIndex = -1;
            this.hoveredStartButton = false;
            this.authForm.clearHover();
            this.pressedButton = null;
            this.settings.clearHover();
        });

        // Scroll wheel for settings panel
        this.uiCanvas.addEventListener('wheel', (e) => {
            if (this.settings.isMenuOpen()) {
                this.settings.handleWheel(e.deltaY);
                e.preventDefault();
            }
        }, { passive: false });

        // Keyboard input for name field and auth form
        document.addEventListener('keydown', (e) => {
            // Don't interfere if a real HTML input/textarea is focused
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return;
            }

            // Handle settings keyboard input (works both in-game and on title screen)
            if (this.settings.handleKeyDown(e)) return;

            // Don't interfere with game controls for non-settings input
            if (window.currentGame) return;

            // Handle auth form input
            if (this.authForm.handleKeyDown(e)) return;

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
            applyZoomCompensation(this.uiCanvas);
        });
    }

    /**
     * Handles canvas click events
     */
    private handleCanvasClick(x: number, y: number): void {
        const centerX = this.uiCanvas.width / 2;
        const centerY = this.uiCanvas.height / 2;

        // Ignore clicks while connecting animation is playing
        if (this.authForm.isConnectingState()) {
            return;
        }

        // Handle settings menu clicks
        if (this.settings.handleClick(x, y)) {
            return;
        }

        // Handle auth form clicks
        if (this.authForm.isVisible()) {
            this.authForm.handleClick(x, y, centerX, centerY);
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
     * Handles canvas hover events
     */
    private handleCanvasHover(x: number, y: number): void {
        const centerX = this.uiCanvas.width / 2;
        const centerY = this.uiCanvas.height / 2;

        // Handle settings menu hover
        if (this.settings.isMenuOpen()) {
            this.settings.handleHover(x, y);
            return;
        }

        // Handle auth form hover
        if (this.authForm.isVisible()) {
            this.authForm.handleHover(x, y, centerX, centerY);
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
        this.background.loadTexture(selectedBiome);
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
        const titleText = 'flowrix.pro';
        // Render connecting state, auth form, or game menu
        if (this.authForm.isConnectingState()) {
            this.renderConnecting(ctx, centerX, centerY);
            return;
        }
        
        if (!this.authForm.isVisible()) {
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
        if (this.authForm.isVisible()) {
            this.authForm.render(ctx, centerX, centerY, this.pressedButton);
            this.renderStatsCounters(ctx, this.uiCanvas.width, this.uiCanvas.height);
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
        drawRoundedRect(ctx, nameInputX, nameInputY, nameInputWidth, nameInputHeight, 3);
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

        drawGardnButton(ctx, startButtonX, startButtonY, startButtonWidth, startButtonHeight,
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
            const biomeConfig = getBiomeConfig(biome);
            const isSelected = biome === selectedBiome;
            const isHovered = this.hoveredBiomeIndex === index;
            const isPressed = this.pressedButton === `biome_${index}`;

            const buttonText = biomeConfig.displayName;
            const biomeColor = isSelected ? hsvAdjust(biomeConfig.color, 0.85) : biomeConfig.color;

            // Gardn-style button
            drawGardnButton(ctx, biomeX, biomeStartY, biomeButtonWidth, biomeButtonHeight,
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

        // Draw settings menu overlay
        this.settings.render(ctx);
    }

    /**
     * Renders stats counters (FPS, memory, mobs, players) in the bottom-right corner
     */
    private renderStatsCounters(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const showStats = localStorage.getItem('showStats') === 'true';
        if (!showStats) return;

        ctx.save();
        const lineHeight = 15;
        ctx.font = 'bold 11px Ubuntu, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000000';

        const x = width - 8;
        const lines: { text: string; color: string }[] = [
            { text: 'Pos: --, --', color: '#ffd700' },
            { text: 'Ping: -- | In: 0 B/s | Out: 0 B/s', color: '#a78bfa' },
            { text: 'Players: 0', color: '#4ecdc4' },
            { text: 'Mobs: 0', color: '#ff6b6b' },
            { text: `FPS: ${this.titleFpsCounter} | Memory: 0.00 MB`, color: '#00ff00' },
        ];

        let y = height - 8;
        for (const line of lines) {
            ctx.strokeText(line.text, x, y);
            ctx.fillStyle = line.color;
            ctx.fillText(line.text, x, y);
            y -= lineHeight;
        }

        ctx.restore();
    }

    /** Returns the layout geometry for the settings panel */

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
        const titleText = 'flowrix.pro';
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
        this.authForm.hide();
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
        this.authForm.show();
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
        if (!this.authForm.isConnectingState()) return; // Already handled
        
        this.authForm.setConnecting(false);
        
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
        if (this.authForm.isConnectingState()) {
            const username = localStorage.getItem('username');
            const password = localStorage.getItem('password');
            
            if (!username || !password) {
                // User is not logged in, wait a bit for socket to connect, then show login
                setTimeout(() => {
                    if (this.authForm.isConnectingState()) {
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
        const username = this.authForm.username;
        const password = this.authForm.password;
        const serverUrl = this.authForm.serverIP || window.location.origin;

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
        const serverUrl = this.authForm.serverIP || window.location.origin;

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
        const username = this.authForm.username;
        const password = this.authForm.password;
        const confirmPassword = this.authForm.confirmPassword;
        const serverUrl = this.authForm.serverIP || window.location.origin;

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
                this.authForm.setLoginMode(true);
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
        const username = this.authForm.username;
        const password = this.authForm.password;
        const confirmPassword = this.authForm.confirmPassword;

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
        this.authForm.setLoginMode(true);
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
        this.submanagers.setTitleScreenVisible(false);
        this.submanagers.dailyStreakWidget?.hide();

        // Hide all title screen panels
        this.hideTitleScreenPanels();
        
        // Resize canvas back to full screen for game
        const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        if (gameCanvas) {
            // Resize canvas to full screen dimensions
            // Reset canvas positioning to full screen
            gameCanvas.style.position = 'absolute';
            gameCanvas.style.left = '0px';
            gameCanvas.style.top = '0px';
            gameCanvas.style.zIndex = '0';
            gameCanvas.style.pointerEvents = 'auto';
            gameCanvas.style.display = 'block';
            applyZoomCompensation(gameCanvas);
            
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
        if (this.submanagers.skills) {
            this.submanagers.skills.hide();
        }
        
        // Hide chat if open
        if (this.submanagers.chat && this.submanagers.chat.chatContainer) {
            this.submanagers.chat.hide();
        }

        // Tear down title-screen shop and mob gallery panels so they don't
        // conflict (duplicate IDs, stale event handlers) with the in-game
        // versions created by the Game's InventoryManager/ShopManager.
        if (this.submanagers.shop) {
            this.submanagers.shop.cleanup();
            this.submanagers.shop = null;
        }
        if (this.submanagers.mobGallery) {
            const mobGalleryPanel = document.getElementById('mobGalleryPanel');
            mobGalleryPanel?.remove();
            this.submanagers.mobGallery = null;
        }
    }

    public showTitleScreen(): void {
        // Reset connecting state so the title screen doesn't show the connecting animation
        this.authForm.setConnecting(false);

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
        this.submanagers.setTitleScreenVisible(true);
        this.submanagers.dailyStreakWidget?.show();

        // Re-show title screen chat
        if (this.submanagers.chat) {
            this.submanagers.chat.show();
        }

        // Re-initialize shop and mob gallery (they were torn down in hideTitleScreenPanels)
        if (!this.submanagers.shop) this.submanagers.initShop();
        if (!this.submanagers.mobGallery) this.submanagers.initMobGallery();

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

    public isSettingsOpen(): boolean {
        return this.settings.isMenuOpen();
    }

    public toggleSettings(): void { this.settings.toggle(); }

    /** Render settings overlay onto an external canvas context (for in-game use) */
    public renderSettingsOverlay(ctx: CanvasRenderingContext2D): void {
        this.settings.render(ctx);
    }

    /** Forward a click to the settings panel (for in-game canvas). Returns true if consumed. */
    public handleSettingsClickExternal(x: number, y: number): boolean {
        return this.settings.handleClick(x, y);
    }

    /** Forward hover to the settings panel (for in-game canvas) */
    public handleSettingsHoverExternal(x: number, y: number): void {
        this.settings.handleHover(x, y);
    }

    /** Forward mousedown for settings slider dragging (for in-game canvas). Returns true if consumed. */
    public handleSettingsMouseDownExternal(x: number, y: number): boolean {
        return this.settings.handleMouseDown(x, y);
    }

    /** Forward mousemove for settings slider dragging (for in-game canvas) */
    public handleSettingsMouseMoveExternal(x: number): void {
        this.settings.handleMouseMove(x);
    }

    /** Forward mouseup for settings (for in-game canvas) */
    public handleSettingsMouseUpExternal(): void {
        this.pressedButton = null;
        this.settings.handleMouseUp();
    }

    /** Forward wheel event for settings scroll (for in-game canvas) */
    public handleSettingsWheelExternal(deltaY: number): void {
        this.settings.handleWheel(deltaY);
    }

    public getShowHitboxes(): boolean { return this.settings.getShowHitboxes(); }
    public getShadersEnabled(): boolean { return this.settings.getShadersEnabled(); }
    public getShowStats(): boolean { return this.settings.getShowStats(); }
    public getDynamicSkybox(): boolean { return this.settings.getDynamicSkybox(); }
    public getServerIP(): string { return this.settings.getServerIP(); }

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

    public startFloatingPetals(): void { this.background.startFloatingPetals(); }
    public stopFloatingPetals(): void { this.background.stopFloatingPetals(); }
    public destroyFloatingPetals(): void { this.background.destroyFloatingPetals(); }
    public hideFloatingPetals(): void { this.background.hideFloatingPetals(); }
    public showFloatingPetals(): void { this.background.showFloatingPetals(); }
    public hideBackgroundCanvas(): void { this.background.hide(); }
    public showBackgroundCanvas(): void { this.background.show(); }
    public startBackgroundAnimation(): void { this.background.start(() => this.renderInGameMenusOverlay()); }
    public stopBackgroundAnimation(): void { this.background.stop(); }

    /**
     * Per-frame work driven by the background animation loop: positions the
     * shared gameCanvas as a panel for whichever in-game menu is currently
     * open (changelog/notifications/leaderboard/guild), or hides it otherwise.
     * Skipped while a game is in progress — the in-game Graphics class owns
     * the canvas then.
     */
    private renderInGameMenusOverlay(): void {
        if ((window as any).currentGame) return;

        const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        if (!gameCanvas) return;

        const changelogOpen = this.changelogManager.isChangelogOpen();
        const notificationsOpen = this.notificationsManager.isNotificationsOpen();
        const leaderboardOpen = this.leaderboardManager.isLeaderboardOpen();
        const guildOpen = this.guildMenuManager.isGuildMenuOpen();

        if (changelogOpen || notificationsOpen || leaderboardOpen || guildOpen) {
            const PANEL_X = 20;
            const PANEL_Y = 72;
            const PANEL_WIDTH = 600;
            const PANEL_HEIGHT = 500;

            if (gameCanvas.width !== PANEL_WIDTH || gameCanvas.height !== PANEL_HEIGHT) {
                gameCanvas.width = PANEL_WIDTH;
                gameCanvas.height = PANEL_HEIGHT;
                this.changelogManager.setCanvas(gameCanvas);
                this.notificationsManager.setCanvas(gameCanvas);
                this.leaderboardManager.setCanvas(gameCanvas);
                this.guildMenuManager.setCanvas(gameCanvas);
            }

            gameCanvas.style.position = 'absolute';
            gameCanvas.style.left = `${PANEL_X}px`;
            gameCanvas.style.top = `${PANEL_Y}px`;
            gameCanvas.style.width = `${PANEL_WIDTH}px`;
            gameCanvas.style.height = `${PANEL_HEIGHT}px`;
            gameCanvas.style.zIndex = '2000';
            gameCanvas.style.pointerEvents = 'auto';
            gameCanvas.style.display = 'block';

            const ctx = gameCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

            this.changelogManager.render();
            this.notificationsManager.render();
            this.leaderboardManager.render();
            this.guildMenuManager.render();
        } else {
            gameCanvas.style.display = 'none';
            const ctx = gameCanvas.getContext('2d');
            if (ctx && gameCanvas.width > 0 && gameCanvas.height > 0) {
                ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
            }
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
        if (this.submanagers.skills) {
            this.submanagers.skills.toggle();
        } else {
            alert('Please start the game to view and upgrade your skills.');
        }
    }
}
