"use strict";
/**
 * Title Screen Menu Management
 * Handles all menu-related DOM elements and interactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleScreen = exports.titleScreenStyles = exports.injectTitleScreenStyles = void 0;
const changelog_1 = require("../changelog");
const notifications_1 = require("../notifications");
const leaderboard_1 = require("../leaderboard");
const guildMenu_1 = require("../guildMenu");
const constants_1 = require("../constants");
const chat_1 = require("../chat");
const skills_1 = require("../skills");
const inventory_1 = require("../inventory");
const shop_1 = require("../shop");
const core_1 = require("../graphics/core");
require("../graphics/flower");
const zoom_compensation_1 = require("../zoom-compensation");
const biome_svgs_1 = require("../biome_svgs");
const daily_streak_widget_1 = require("../daily_streak_widget");
const floating_petals_1 = require("./floating_petals");
const inventory_manager_1 = require("./inventory_manager");
var styles_1 = require("./styles");
Object.defineProperty(exports, "injectTitleScreenStyles", { enumerable: true, get: function () { return styles_1.injectTitleScreenStyles; } });
Object.defineProperty(exports, "titleScreenStyles", { enumerable: true, get: function () { return styles_1.titleScreenStyles; } });
class TitleScreen {
    constructor() {
        this.availableBiomes = [];
        this.backgroundTime = 0;
        this.titleScreenChat = null;
        this.titleScreenSkillsManager = null;
        this.titleScreenShopManager = null;
        this.titleScreenMobGallery = null;
        this.dailyStreakWidget = null;
        this.isTitleScreenVisible = true;
        this.playerName = '';
        this.isNameInputFocused = false;
        this.hoveredBiomeIndex = -1;
        this.hoveredStartButton = false;
        this.animationFrameId = null;
        // Auth form state (canvas-based)
        this.isConnecting = true; // Show connecting initially
        this.showAuthForm = false; // Don't show until loadout loads
        this.isLoginForm = true; // true = login, false = register
        this.authFocusedField = null; // 'username', 'password', 'confirmPassword', 'serverIP'
        this.authUsername = '';
        this.authPassword = '';
        this.authConfirmPassword = '';
        this.authServerIP = window.location.origin;
        this.authAdvancedSettingsVisible = false;
        this.hoveredAuthButton = null; // 'login', 'register', 'guest', 'offline', 'toggleAdvanced', 'showRegister', 'showLogin'
        this.pressedButton = null; // tracks which button is currently pressed (mousedown)
        // Canvas-based settings menu state
        this.settingsOpen = false;
        this.settingsTab = 'controls';
        this.settingsScrollY = 0;
        this.settingsHoveredItem = null;
        this.settingsEditingControl = null; // which control key is being edited
        // Settings values (synced with localStorage)
        this.settingsShowHitboxes = false;
        this.settingsShadersEnabled = false;
        this.settingsShowStats = false;
        this.settingsMobFramerate = 15;
        this.settingsHighQualityMobs = false;
        this.settingsDynamicSkybox = false;
        this.settingsMobDeathAnimation = true;
        this.settingsInterpolation = 0.15;
        this.settingsShowConsoleLogs = false;
        this.settingsServerIP = '';
        this.settingsServerIPFocused = false;
        this.settingsSliderDragging = null; // 'mobFramerate' or 'interpolation'
        // FPS/stats tracking for title screen
        this.titleFrameCount = 0;
        this.titleFpsCounter = 0;
        this.titleFpsUpdateTime = performance.now();
        this.initializeElements();
        this.changelogManager = new changelog_1.ChangelogManager();
        this.notificationsManager = new notifications_1.NotificationsManager();
        this.leaderboardManager = new leaderboard_1.LeaderboardManager();
        this.guildMenuManager = new guildMenu_1.GuildMenuManager();
        window.guildMenuManager = this.guildMenuManager;
        // Make notifications manager globally accessible
        window.notificationsManager = this.notificationsManager;
        // Set canvas on managers after canvas is available
        const setupCanvas = (canvas) => {
            // Ensure canvas has proper dimensions (not just CSS sizing)
            if (canvas.width === 0 || canvas.height === 0) {
                (0, zoom_compensation_1.applyZoomCompensation)(canvas);
            }
            // Ensure canvas is visible on title screen
            canvas.style.zIndex = '1';
            canvas.style.pointerEvents = 'auto';
            this.changelogManager.setCanvas(canvas);
            this.notificationsManager.setCanvas(canvas);
            this.leaderboardManager.setCanvas(canvas);
            this.guildMenuManager.setCanvas(canvas);
        };
        const gameCanvas = document.getElementById('gameCanvas');
        if (gameCanvas) {
            setupCanvas(gameCanvas);
        }
        else {
            // Wait for canvas to be ready
            const checkCanvas = setInterval(() => {
                const canvas = document.getElementById('gameCanvas');
                if (canvas) {
                    setupCanvas(canvas);
                    clearInterval(checkCanvas);
                }
            }, 100);
        }
        this.setupEventListeners();
        this.titleScreenInventoryManager = new inventory_manager_1.TitleScreenInventoryManager();
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
    updateBiomesFromMapData(mapData) {
        // Extract unique biome names from map data
        const biomeNames = new Set();
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
    /**
     * Gets configuration for a biome (colors, display names, etc.)
     */
    getBiomeConfig(biomeName) {
        const configs = {
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
            },
            'pvp': {
                color: 'rgb(220, 60, 60)',
                title: 'PVP Arena',
                displayName: 'PVP Arena'
            }
        };
        // Return config for known biome or create a default one
        return configs[biomeName] || {
            color: '#cccccc',
            title: biomeName.charAt(0).toUpperCase() + biomeName.slice(1),
            displayName: biomeName.charAt(0).toUpperCase() + biomeName.slice(1)
        };
    }
    initializeElements() {
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
        this.loadingScreen = document.getElementById('loadingScreen');
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
        // Settings menu is now rendered on canvas - load initial values
        this.loadSettingsValues();
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
        const settingsIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'settings')?.value || '';
        const changelogIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'changelog')?.value || '';
        const notificationsIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'notifications')?.value || '';
        const leaderboardIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'leaderboard')?.value || '';
        const guildIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'guild')?.value || '';
        const exitIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'exit_button')?.value || '';
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
            <div id="changelogButton" class="gardn-icon-btn ${changelog_1.CHANGELOG.length > parseInt(localStorage.getItem('lastSeenChangelogCount') || '0') ? 'shake' : ''}" style="background: #00db3e; border-color: #00af32;" title="Changelog">
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
        const craftIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'craft')?.value || '';
        const inventoryIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'inventory')?.value || '';
        const skillsIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'skills')?.value || '';
        const mobGalleryIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'mob_gallery')?.value || '';
        // Use the star icon for shop
        const shopIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'stars')?.value || '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><text x="16" y="24" font-size="24" text-anchor="middle" fill="#ffd700">⭐</text></svg>';
        // Update SVGs to be 32x32 - craft icon has different attributes than inventory
        const formattedCraftIcon = craftIcon
            .replace('width="512px"', 'width="32"')
            .replace('height="512px"', 'height="32"')
            .replace('fill="#000"', 'fill="#fff"') // Ensure white fill
            .replace('<svg', '<svg style="pointer-events: none;"'); // Prevent SVG from capturing clicks
        const formattedInventoryIcon = inventoryIcon
            .replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"')
            .replace('<svg', '<svg style="pointer-events: none;"'); // Prevent SVG from capturing clicks
        const formattedSkillsIcon = skillsIcon
            .replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"')
            .replace('<svg', '<svg style="pointer-events: none;"'); // Prevent SVG from capturing clicks
        const formattedMobGalleryIcon = mobGalleryIcon
            .replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"')
            .replace('<svg', '<svg style="pointer-events: none;"'); // Prevent SVG from capturing clicks
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
            pointer-events: none;
            z-index: 1;
        `;
        (0, zoom_compensation_1.applyZoomCompensation)(this.backgroundCanvas);
        this.backgroundCtx = this.backgroundCanvas.getContext('2d');
        this.backgroundTexture = new Image();
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
        (0, zoom_compensation_1.applyZoomCompensation)(this.uiCanvas);
        this.uiCtx = this.uiCanvas.getContext('2d');
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
    createElement(tagName, className) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        return element;
    }
    setupEventListeners() {
        // Add keyboard shortcuts for chat and skills on title screen
        document.addEventListener('keydown', (event) => {
            // Don't interfere if game is running
            if (window.currentGame)
                return;
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
                this.settingsOpen = false;
                this.notificationsManager.hide();
                this.leaderboardManager.hide();
                this.guildMenuManager.hide();
                console.log('[CHANGELOG] Button clicked, isOpen before:', this.changelogManager.isChangelogOpen());
                this.changelogManager.toggle();
                console.log('[CHANGELOG] Button clicked, isOpen after:', this.changelogManager.isChangelogOpen());
                const gameCanvas = document.getElementById('gameCanvas');
                console.log('[CHANGELOG] Canvas exists:', !!gameCanvas, 'Canvas width:', gameCanvas?.width, 'Canvas height:', gameCanvas?.height);
                console.log('[CHANGELOG] Manager canvas:', !!this.changelogManager['canvas'], 'Manager ctx:', !!this.changelogManager['ctx']);
                // Mark changelog as seen and stop shaking
                changelogButton.classList.remove('shake');
                localStorage.setItem('lastSeenChangelogCount', String(changelog_1.CHANGELOG.length));
            });
        }
        else {
            console.error('[CHANGELOG] Button not found!');
        }
        if (notificationsButton) {
            notificationsButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                // Close other menus
                this.settingsOpen = false;
                this.changelogManager.hide();
                this.leaderboardManager.hide();
                this.guildMenuManager.hide();
                console.log('[NOTIFICATIONS] Button clicked, isOpen before:', this.notificationsManager.isNotificationsOpen());
                this.notificationsManager.toggle();
                console.log('[NOTIFICATIONS] Button clicked, isOpen after:', this.notificationsManager.isNotificationsOpen());
                const gameCanvas = document.getElementById('gameCanvas');
                console.log('[NOTIFICATIONS] Canvas exists:', !!gameCanvas, 'Canvas width:', gameCanvas?.width, 'Canvas height:', gameCanvas?.height);
                console.log('[NOTIFICATIONS] Manager canvas:', !!this.notificationsManager['canvas'], 'Manager ctx:', !!this.notificationsManager['ctx']);
            });
            // Set the button reference in notifications manager for badge updates
            this.notificationsManager.setNotificationButton(notificationsButton);
        }
        else {
            console.error('[NOTIFICATIONS] Button not found!');
        }
        if (leaderboardButton) {
            leaderboardButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                // Close other menus
                this.settingsOpen = false;
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
                this.settingsOpen = false;
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
                    }
                    else {
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
                    }
                    else {
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
                    }
                    else {
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
                    }
                    else if (this.titleScreenShopManager) {
                        this.titleScreenShopManager.toggleShop();
                    }
                    else {
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
                    }
                    else if (this.titleScreenMobGallery) {
                        this.titleScreenMobGallery.toggleMobGallery();
                    }
                    else {
                        console.log('Mob Gallery not yet available');
                    }
                    return false;
                }, true);
            }
        }, 100);
        // Setup name input persistence
        this.setupNameInputPersistence();
    }
    async appendToBody() {
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
        // Initialize floating petals manager
        this.floatingPetalManager = new floating_petals_1.FloatingPetalManager(this.floatingPetalsContainer);
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
                    || loadoutBar.parentNode?.id === 'titleScreenLoadoutWrap') {
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
        this.loadSettingsValues();
    }
    getControls() {
        const savedControls = localStorage.getItem('controls');
        if (savedControls) {
            return { ...this.getDefaultControls(), ...JSON.parse(savedControls) };
        }
        return this.getDefaultControls();
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
        };
    }
    saveControls() {
        // Controls are already saved to localStorage as they are edited via canvas
        alert('Controls saved!');
    }
    resetControls() {
        localStorage.removeItem('controls');
        alert('Controls have been reset to default.');
    }
    addAdvancedSettingsStyles() {
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
    setupAdvancedSettingsToggle() {
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
            const loginServerInput = document.getElementById('serverIP-connect');
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
                    }
                    else {
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
            const registerServerInput = document.getElementById('serverIP-single');
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
                    }
                    else {
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
    setupCanvasUIListeners() {
        // Mouse click handling
        this.uiCanvas.addEventListener('click', (e) => {
            const { x, y } = (0, zoom_compensation_1.canvasCoords)(this.uiCanvas, e);
            this.handleCanvasClick(x, y);
        });
        // Mouse move for hover effects
        this.uiCanvas.addEventListener('mousemove', (e) => {
            const { x, y } = (0, zoom_compensation_1.canvasCoords)(this.uiCanvas, e);
            if (this.settingsSliderDragging) {
                this.handleSliderDrag(x);
            }
            this.handleCanvasHover(x, y);
        });
        // Mouse down for pressed state
        this.uiCanvas.addEventListener('mousedown', (e) => {
            if (this.settingsOpen && this.settingsHoveredItem) {
                this.pressedButton = `settings_${this.settingsHoveredItem}`;
                // Start slider dragging
                if (this.settingsHoveredItem === 'slider_mobFramerate' || this.settingsHoveredItem === 'slider_interpolation') {
                    this.settingsSliderDragging = this.settingsHoveredItem.replace('slider_', '');
                    const { x } = (0, zoom_compensation_1.canvasCoords)(this.uiCanvas, e);
                    this.handleSliderDrag(x);
                }
            }
            else if (this.hoveredStartButton)
                this.pressedButton = 'start';
            else if (this.hoveredBiomeIndex >= 0)
                this.pressedButton = `biome_${this.hoveredBiomeIndex}`;
            else if (this.hoveredAuthButton)
                this.pressedButton = this.hoveredAuthButton;
            else
                this.pressedButton = null;
        });
        // Mouse up to clear pressed state
        document.addEventListener('mouseup', () => {
            this.pressedButton = null;
            this.settingsSliderDragging = null;
        });
        // Mouse leave to clear hover
        this.uiCanvas.addEventListener('mouseleave', () => {
            this.hoveredBiomeIndex = -1;
            this.hoveredStartButton = false;
            this.hoveredAuthButton = null;
            this.pressedButton = null;
            this.settingsHoveredItem = null;
            this.settingsSliderDragging = null;
        });
        // Scroll wheel for settings panel
        this.uiCanvas.addEventListener('wheel', (e) => {
            if (this.settingsOpen) {
                this.settingsScrollY -= e.deltaY;
                this.settingsScrollY = Math.min(0, this.settingsScrollY);
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
            if (this.settingsOpen) {
                if (this.settingsEditingControl) {
                    // Capture key for control binding
                    e.preventDefault();
                    const controls = this.getControls();
                    controls[this.settingsEditingControl] = e.key;
                    localStorage.setItem('controls', JSON.stringify(controls));
                    this.settingsEditingControl = null;
                    return;
                }
                if (this.settingsServerIPFocused) {
                    if (e.key === 'Backspace') {
                        this.settingsServerIP = this.settingsServerIP.slice(0, -1);
                        localStorage.setItem('serverIP', this.settingsServerIP);
                        e.preventDefault();
                    }
                    else if (e.key === 'Escape' || e.key === 'Enter') {
                        this.settingsServerIPFocused = false;
                        e.preventDefault();
                    }
                    else if (e.key.length === 1) {
                        this.settingsServerIP += e.key;
                        localStorage.setItem('serverIP', this.settingsServerIP);
                        e.preventDefault();
                    }
                    return;
                }
                if (e.key === 'Escape') {
                    this.settingsOpen = false;
                    e.preventDefault();
                    return;
                }
            }
            // Don't interfere with game controls for non-settings input
            if (window.currentGame)
                return;
            // Handle auth form input
            if (this.showAuthForm && this.authFocusedField) {
                if (e.key === 'Backspace') {
                    if (this.authFocusedField === 'username') {
                        this.authUsername = this.authUsername.slice(0, -1);
                    }
                    else if (this.authFocusedField === 'password') {
                        this.authPassword = this.authPassword.slice(0, -1);
                    }
                    else if (this.authFocusedField === 'confirmPassword') {
                        this.authConfirmPassword = this.authConfirmPassword.slice(0, -1);
                    }
                    else if (this.authFocusedField === 'serverIP') {
                        this.authServerIP = this.authServerIP.slice(0, -1);
                    }
                    e.preventDefault();
                }
                else if (e.key === 'Enter') {
                    if (this.isLoginForm) {
                        this.handleAuthLogin();
                    }
                    else {
                        this.handleAuthRegister();
                    }
                    e.preventDefault();
                }
                else if (e.key === 'Tab') {
                    // Cycle through fields
                    e.preventDefault();
                    if (this.isLoginForm) {
                        if (this.authFocusedField === 'username') {
                            this.authFocusedField = 'password';
                        }
                        else if (this.authFocusedField === 'password') {
                            this.authFocusedField = this.authAdvancedSettingsVisible ? 'serverIP' : 'username';
                        }
                        else {
                            this.authFocusedField = 'username';
                        }
                    }
                    else {
                        if (this.authFocusedField === 'username') {
                            this.authFocusedField = 'password';
                        }
                        else if (this.authFocusedField === 'password') {
                            this.authFocusedField = 'confirmPassword';
                        }
                        else if (this.authFocusedField === 'confirmPassword') {
                            this.authFocusedField = this.authAdvancedSettingsVisible ? 'serverIP' : 'username';
                        }
                        else {
                            this.authFocusedField = 'username';
                        }
                    }
                }
                else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                    if (this.authFocusedField === 'username') {
                        if (this.authUsername.length < 50) {
                            this.authUsername += e.key;
                        }
                    }
                    else if (this.authFocusedField === 'password') {
                        if (this.authPassword.length < 100) {
                            this.authPassword += e.key;
                        }
                    }
                    else if (this.authFocusedField === 'confirmPassword') {
                        if (this.authConfirmPassword.length < 100) {
                            this.authConfirmPassword += e.key;
                        }
                    }
                    else if (this.authFocusedField === 'serverIP') {
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
                }
                else if (e.key === 'Enter') {
                    // Trigger start button
                    this.handleStartButtonClick();
                    e.preventDefault();
                }
                else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
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
            (0, zoom_compensation_1.applyZoomCompensation)(this.uiCanvas);
        });
    }
    /**
     * Handles canvas click events
     */
    handleCanvasClick(x, y) {
        const centerX = this.uiCanvas.width / 2;
        const centerY = this.uiCanvas.height / 2;
        // Ignore clicks while connecting animation is playing
        if (this.isConnecting) {
            return;
        }
        // Handle settings menu clicks
        if (this.settingsOpen) {
            this.handleSettingsClick(x, y);
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
    handleAuthFormClick(x, y, centerX, centerY) {
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
        }
        else {
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
    handleCanvasHover(x, y) {
        const centerX = this.uiCanvas.width / 2;
        const centerY = this.uiCanvas.height / 2;
        // Handle settings menu hover
        if (this.settingsOpen) {
            this.handleSettingsHover(x, y);
            return;
        }
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
    handleAuthFormHover(x, y, centerX, centerY) {
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
        }
        else {
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
    handleStartButtonClick() {
        const multiPlayerButton = this.getMultiPlayerButton();
        if (multiPlayerButton) {
            multiPlayerButton.click();
        }
    }
    /**
     * Selects a biome
     */
    selectBiome(biomeName) {
        const selectedBiome = biomeName || 'default';
        localStorage.setItem('spawnBiome', selectedBiome);
        console.log('Selected spawn biome:', selectedBiome);
        this.loadBackgroundTexture(selectedBiome);
    }
    /**
     * Syncs the playerName to the dummy input element for compatibility
     */
    syncPlayerNameToInput() {
        const input = document.getElementById('nameInput');
        if (input) {
            input.value = this.playerName;
        }
    }
    /**
     * Draws a rounded rectangle
     */
    drawRoundedRect(ctx, x, y, width, height, radius) {
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
    hsvAdjust(color, brightness) {
        let r, g, b;
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            r = parseInt(hex.slice(0, 2), 16) / 255;
            g = parseInt(hex.slice(2, 4), 16) / 255;
            b = parseInt(hex.slice(4, 6), 16) / 255;
        }
        else if (color.startsWith('rgba')) {
            const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!match)
                return color;
            r = parseInt(match[1]) / 255;
            g = parseInt(match[2]) / 255;
            b = parseInt(match[3]) / 255;
        }
        else if (color.startsWith('rgb')) {
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (!match)
                return color;
            r = parseInt(match[1]) / 255;
            g = parseInt(match[2]) / 255;
            b = parseInt(match[3]) / 255;
        }
        else {
            return color;
        }
        // RGB to HSV
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        const s = max === 0 ? 0 : d / max;
        const v = max;
        if (d !== 0) {
            if (max === r)
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g)
                h = ((b - r) / d + 2) / 6;
            else
                h = ((r - g) / d + 4) / 6;
        }
        // Adjust value
        const newV = Math.min(1, Math.max(0, v * brightness));
        // HSV to RGB
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = newV * (1 - s);
        const q = newV * (1 - f * s);
        const t = newV * (1 - (1 - f) * s);
        let nr, ng, nb;
        switch (i % 6) {
            case 0:
                nr = newV;
                ng = t;
                nb = p;
                break;
            case 1:
                nr = q;
                ng = newV;
                nb = p;
                break;
            case 2:
                nr = p;
                ng = newV;
                nb = t;
                break;
            case 3:
                nr = p;
                ng = q;
                nb = newV;
                break;
            case 4:
                nr = t;
                ng = p;
                nb = newV;
                break;
            default:
                nr = newV;
                ng = p;
                nb = q;
                break;
        }
        const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
        return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
    }
    /**
     * Gets the button fill color based on hover/press state, matching gardn style.
     * Hover = 1.1x brightness, pressed = 0.9x brightness.
     */
    getButtonFillColor(baseColor, isHovered, isPressed) {
        if (isPressed)
            return this.hsvAdjust(baseColor, 0.9);
        if (isHovered)
            return this.hsvAdjust(baseColor, 1.1);
        return baseColor;
    }
    /**
     * Gets the stroke color for a button (darker shade via HSV, like gardn's stroke_hsv = 0.8)
     */
    getButtonStrokeColor(baseColor) {
        return this.hsvAdjust(baseColor, 0.8);
    }
    /**
     * Draws a gardn-style button: rounded rect with thick stroke, round cap/join
     */
    drawGardnButton(ctx, x, y, width, height, baseColor, isHovered, isPressed, text, fontSize = 18, lineWidth = 5, radius = 3) {
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
    startCanvasRendering() {
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
    stopCanvasRendering() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
    /**
     * Renders the canvas UI
     */
    renderCanvasUI() {
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
        this.drawGardnButton(ctx, startButtonX, startButtonY, startButtonWidth, startButtonHeight, '#1dd129', this.hoveredStartButton, this.pressedButton === 'start', 'Ready', 18, 5, 3);
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
            this.drawGardnButton(ctx, biomeX, biomeStartY, biomeButtonWidth, biomeButtonHeight, biomeColor, isHovered && !isSelected, isPressed, buttonText, 14, isSelected ? 5 : 4, 3);
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
        if (this.settingsOpen) {
            this.renderSettingsMenu(ctx);
        }
    }
    /**
     * Renders stats counters (FPS, memory, mobs, players) in the bottom-right corner
     */
    renderStatsCounters(ctx, width, height) {
        const showStats = localStorage.getItem('showStats') === 'true';
        if (!showStats)
            return;
        ctx.save();
        const lineHeight = 15;
        ctx.font = 'bold 11px Ubuntu, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000000';
        const x = width - 8;
        const lines = [
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
    getSettingsLayout() {
        const panelW = 420;
        const panelH = 500;
        const panelX = 20;
        const panelY = 70;
        const pad = 15;
        const tabH = 32;
        const headerH = 30;
        const contentX = panelX + pad;
        const contentW = panelW - 2 * pad;
        const contentTop = panelY + headerH + pad + tabH + 10;
        const contentBottom = panelY + panelH - pad;
        return { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom };
    }
    /** Renders the canvas-based settings menu (gardn style) */
    renderSettingsMenu(ctx) {
        const { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom } = this.getSettingsLayout();
        ctx.save();
        // Panel background (gardn style: darker stroke border, lighter fill)
        ctx.fillStyle = this.hsvAdjust('#aaaaaa', 0.8);
        ctx.beginPath();
        this.drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 5);
        ctx.fill();
        // Inner fill
        ctx.fillStyle = '#aaaaaa';
        ctx.beginPath();
        ctx.rect(panelX + 4, panelY + 4, panelW - 8, panelH - 8);
        ctx.fill();
        // Header: "Settings" title
        ctx.font = 'bold 20px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText('Settings', panelX + pad, panelY + pad + headerH / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Settings', panelX + pad, panelY + pad + headerH / 2);
        // Close button (X)
        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        const closeBtnSize = 28;
        const closeHovered = this.settingsHoveredItem === 'close';
        this.drawGardnButton(ctx, closeBtnX, closeBtnY, closeBtnSize, closeBtnSize, '#cc4444', closeHovered, this.pressedButton === 'settings_close', 'X', 16, 3, 3);
        // Tabs
        const tabs = [
            { id: 'controls', label: 'Controls' },
            { id: 'graphics', label: 'Graphics' },
            { id: 'advanced', label: 'Advanced' },
            { id: 'credits', label: 'Credits' },
        ];
        const tabW = (contentW - (tabs.length - 1) * 5) / tabs.length;
        const tabY = panelY + headerH + pad + 5;
        tabs.forEach((tab, i) => {
            const tx = contentX + i * (tabW + 5);
            const isActive = this.settingsTab === tab.id;
            const hovered = this.settingsHoveredItem === `tab_${tab.id}`;
            const baseColor = isActive ? '#8888bb' : '#a3a3a3';
            this.drawGardnButton(ctx, tx, tabY, tabW, tabH, baseColor, hovered && !isActive, this.pressedButton === `settings_tab_${tab.id}`, tab.label, 13, 3, 3);
        });
        // Content area - clip to prevent overflow
        ctx.save();
        ctx.beginPath();
        ctx.rect(panelX, contentTop, panelW, contentBottom - contentTop);
        ctx.clip();
        const rowH = 32;
        const checkboxSize = 22;
        const sliderH = 8;
        let cy = contentTop + this.settingsScrollY;
        if (this.settingsTab === 'graphics') {
            // Checkboxes
            const checkboxes = [
                { id: 'showHitboxes', label: 'Show Hitboxes', value: this.settingsShowHitboxes },
                // { id: 'enableShaders', label: 'Enable Shaders', value: this.settingsShadersEnabled },
                { id: 'showStats', label: 'Show Performance Stats', value: this.settingsShowStats },
                // { id: 'highQualityMobs', label: 'High Quality Mobs', value: this.settingsHighQualityMobs },
                { id: 'dynamicSkybox', label: 'Dynamic Skybox', value: this.settingsDynamicSkybox },
                { id: 'mobDeathAnimation', label: 'Mob Death Animation', value: this.settingsMobDeathAnimation },
                { id: 'showConsoleLogs', label: 'Show Console Logs', value: this.settingsShowConsoleLogs },
            ];
            for (const cb of checkboxes) {
                this.drawSettingsCheckbox(ctx, contentX, cy, checkboxSize, cb.value, cb.label, this.settingsHoveredItem === `cb_${cb.id}`);
                cy += rowH;
            }
            // Mob Framerate slider
            cy += 5;
            ctx.font = 'bold 13px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText(`Mob Animation FPS: ${this.settingsMobFramerate}`, contentX, cy + 8);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`Mob Animation FPS: ${this.settingsMobFramerate}`, contentX, cy + 8);
            cy += 22;
            this.drawSettingsSlider(ctx, contentX, cy, contentW, sliderH, (this.settingsMobFramerate - 5) / 55, 'mobFramerate');
            cy += 25;
            // Interpolation slider
            ctx.strokeText(`Interpolation: ${this.settingsInterpolation.toFixed(2)}`, contentX, cy + 8);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`Interpolation: ${this.settingsInterpolation.toFixed(2)}`, contentX, cy + 8);
            cy += 22;
            this.drawSettingsSlider(ctx, contentX, cy, contentW, sliderH, (this.settingsInterpolation - 0.05) / 0.45, 'interpolation');
            cy += 30;
            // Reset tutorial button
            const resetBtnW = 160;
            const resetBtnH = 30;
            const resetHovered = this.settingsHoveredItem === 'resetTutorial';
            this.drawGardnButton(ctx, contentX, cy, resetBtnW, resetBtnH, '#a3a3a3', resetHovered, this.pressedButton === 'settings_resetTutorial', 'Reset Tutorial', 13, 3, 3);
            cy += resetBtnH + 10;
        }
        else if (this.settingsTab === 'controls') {
            // Controls heading
            ctx.font = 'bold 15px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText('Controls', contentX, cy + 10);
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Controls', contentX, cy + 10);
            cy += 28;
            const controls = this.getControls();
            const controlKeys = Object.keys(controls);
            const labelW = contentW * 0.55;
            const inputW = contentW * 0.4;
            const inputH = 26;
            for (const action of controlKeys) {
                const displayName = action.replace(/_/g, ' ');
                // Label
                ctx.font = 'bold 12px Ubuntu, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                const labelText = displayName.charAt(0).toUpperCase() + displayName.slice(1);
                ctx.strokeText(labelText, contentX, cy + inputH / 2);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(labelText, contentX, cy + inputH / 2);
                // Key input box
                const inputX = contentX + labelW;
                const isEditing = this.settingsEditingControl === action;
                const hovered = this.settingsHoveredItem === `ctrl_${action}`;
                const boxColor = isEditing ? '#ffffff' : (hovered ? '#f0f0f0' : '#e6e6e6');
                ctx.fillStyle = this.hsvAdjust('#a3a3a3', 0.8);
                this.drawRoundedRect(ctx, inputX, cy, inputW, inputH, 3);
                ctx.fill();
                ctx.fillStyle = boxColor;
                ctx.fillRect(inputX + 3, cy + 3, inputW - 6, inputH - 6);
                // Key text
                ctx.font = 'bold 12px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#000000';
                const keyText = isEditing ? '...' : (controls[action] === ' ' ? 'Space' : controls[action]);
                ctx.fillText(keyText, inputX + inputW / 2, cy + inputH / 2);
                cy += inputH + 6;
            }
            cy += 10;
            // Save & Reset buttons
            const btnW = (contentW - 10) / 2;
            const btnH = 30;
            const saveHovered = this.settingsHoveredItem === 'saveControls';
            const resetHovered = this.settingsHoveredItem === 'resetControls';
            this.drawGardnButton(ctx, contentX, cy, btnW, btnH, '#5a9fdb', saveHovered, this.pressedButton === 'settings_saveControls', 'Save Controls', 13, 3, 3);
            this.drawGardnButton(ctx, contentX + btnW + 10, cy, btnW, btnH, '#a3a3a3', resetHovered, this.pressedButton === 'settings_resetControls', 'Reset to Default', 13, 3, 3);
            cy += btnH + 10;
        }
        else if (this.settingsTab === 'advanced') {
            // Server IP
            ctx.font = 'bold 13px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText('Server IP:', contentX, cy + 10);
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Server IP:', contentX, cy + 10);
            cy += 25;
            // Server IP input box
            const ipInputW = contentW;
            const ipInputH = 32;
            const ipFocused = this.settingsServerIPFocused;
            const ipHovered = this.settingsHoveredItem === 'serverIP';
            ctx.fillStyle = this.hsvAdjust('#a3a3a3', 0.8);
            this.drawRoundedRect(ctx, contentX, cy, ipInputW, ipInputH, 3);
            ctx.fill();
            ctx.fillStyle = ipFocused ? '#ffffff' : (ipHovered ? '#f0f0f0' : '#e6e6e6');
            ctx.fillRect(contentX + 3, cy + 3, ipInputW - 6, ipInputH - 6);
            ctx.font = '13px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#000000';
            const ipText = this.settingsServerIP || window.location.origin;
            // Truncate if too wide
            let displayIP = ipText;
            while (ctx.measureText(displayIP).width > ipInputW - 20 && displayIP.length > 0) {
                displayIP = displayIP.slice(1);
            }
            ctx.fillText(displayIP, contentX + 8, cy + ipInputH / 2);
            // Cursor if focused
            if (ipFocused && Math.floor(Date.now() / 500) % 2 === 0) {
                const cursorX = contentX + 8 + ctx.measureText(displayIP).width;
                ctx.fillStyle = '#000000';
                ctx.fillRect(cursorX, cy + 8, 2, ipInputH - 16);
            }
            cy += ipInputH + 15;
            // Show Console Logs checkbox
            this.drawSettingsCheckbox(ctx, contentX, cy, 22, this.settingsShowConsoleLogs, 'Show Console Logs on Screen', this.settingsHoveredItem === 'cb_showConsoleLogs_adv');
            cy += rowH;
        }
        else if (this.settingsTab === 'credits') {
            this.renderCreditsTab(ctx, contentX, contentW, cy);
        }
        ctx.restore(); // restore clip
        ctx.restore(); // restore initial save
    }
    /** Renders the credits tab content */
    renderCreditsTab(ctx, contentX, contentW, startY) {
        let cy = startY;
        const drawText = (text, font, color, y, align = 'left') => {
            ctx.font = font;
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            const drawX = align === 'center' ? contentX + contentW / 2 : contentX;
            ctx.strokeText(text, drawX, y);
            ctx.fillStyle = color;
            ctx.fillText(text, drawX, y);
        };
        drawText('Flowrix.pro', 'bold 18px Ubuntu, sans-serif', '#ffffff', cy + 10, 'center');
        cy += 30;
        drawText('Developers', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawText('• sussybite8888', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('Inspired By', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawText('• florr.io by M28', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 28;
        drawText('Assets & Libraries', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawText('• Icons from game-icons.net and svgrepo.com', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('• Ubuntu font by Canonical', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 28;
        drawText('• Assets extracted by Bismuth(https://github.com/trigonal-bacon/gardn)', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('• UI style by Bismuth(https://github.com/trigonal-bacon/gardn)', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('Thanks for playing!', 'bold 13px Ubuntu, sans-serif', '#cccccc', cy + 8, 'center');
    }
    /** Draws a gardn-style checkbox (toggle square) */
    drawSettingsCheckbox(ctx, x, y, size, checked, label, hovered) {
        // Outer box (dark border)
        ctx.fillStyle = this.hsvAdjust('#666666', 0.4);
        this.drawRoundedRect(ctx, x, y + 2, size, size, 4);
        ctx.fill();
        // Inner fill
        const innerColor = checked ? '#cfcfcf' : '#666666';
        ctx.fillStyle = hovered ? this.hsvAdjust(innerColor, 1.1) : innerColor;
        ctx.fillRect(x + 3, y + 5, size - 6, size - 6);
        // Label text
        ctx.font = 'bold 13px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeText(label, x + size + 8, y + 2 + size / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + size + 8, y + 2 + size / 2);
    }
    /** Draws a gardn-style slider */
    drawSettingsSlider(ctx, x, y, width, height, ratio, id) {
        const r = Math.max(0, Math.min(1, ratio));
        // Track background
        ctx.fillStyle = '#888888';
        this.drawRoundedRect(ctx, x, y, width, height, height / 2);
        ctx.fill();
        // Filled portion
        const fillW = Math.max(height, width * r);
        ctx.fillStyle = '#5a9fdb';
        this.drawRoundedRect(ctx, x, y, fillW, height, height / 2);
        ctx.fill();
        // Thumb
        const thumbR = 10;
        const thumbX = x + width * r;
        const thumbY = y + height / 2;
        const thumbHovered = this.settingsHoveredItem === `slider_${id}` || this.settingsSliderDragging === id;
        ctx.fillStyle = thumbHovered ? '#ffffff' : '#dddddd';
        ctx.strokeStyle = '#888888';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    /** Loads settings values from localStorage into canvas state */
    loadSettingsValues() {
        this.settingsShowHitboxes = localStorage.getItem('showHitboxes') === 'true';
        this.settingsShadersEnabled = localStorage.getItem('shadersEnabled') === 'true';
        this.settingsShowStats = localStorage.getItem('showStats') === 'true';
        this.settingsMobFramerate = parseInt(localStorage.getItem('mobAnimationFramerate') || '15', 10);
        this.settingsHighQualityMobs = localStorage.getItem('highQualityMobs') === 'true';
        this.settingsDynamicSkybox = localStorage.getItem('dynamicSkybox') === 'true';
        this.settingsMobDeathAnimation = localStorage.getItem('mobDeathAnimation') !== 'false';
        this.settingsInterpolation = parseFloat(localStorage.getItem('interpolationAmount') || '0.15');
        this.settingsShowConsoleLogs = localStorage.getItem('showConsoleLogs') === 'true';
        this.settingsServerIP = localStorage.getItem('serverIP') || window.location.origin;
    }
    /** Handles click events within the settings panel */
    handleSettingsClick(x, y) {
        const { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom } = this.getSettingsLayout();
        // Check if click is outside panel
        if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) {
            this.settingsOpen = false;
            return;
        }
        // Close button
        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        if (x >= closeBtnX && x <= closeBtnX + 28 && y >= closeBtnY && y <= closeBtnY + 28) {
            this.settingsOpen = false;
            return;
        }
        // Tabs
        const tabs = ['controls', 'graphics', 'advanced', 'credits'];
        const tabW = (contentW - (tabs.length - 1) * 5) / tabs.length;
        const tabY = panelY + headerH + pad + 5;
        for (let i = 0; i < tabs.length; i++) {
            const tx = contentX + i * (tabW + 5);
            if (x >= tx && x <= tx + tabW && y >= tabY && y <= tabY + tabH) {
                this.settingsTab = tabs[i];
                this.settingsScrollY = 0;
                this.settingsEditingControl = null;
                this.settingsServerIPFocused = false;
                return;
            }
        }
        // Content area clicks
        if (y < contentTop || y > contentBottom)
            return;
        const rowH = 32;
        const checkboxSize = 22;
        let cy = contentTop + this.settingsScrollY;
        if (this.settingsTab === 'graphics') {
            const checkboxIds = ['showHitboxes', 'showStats', 'dynamicSkybox', 'mobDeathAnimation', 'showConsoleLogs'];
            for (const id of checkboxIds) {
                if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                    this.toggleSettingsCheckbox(id);
                    return;
                }
                cy += rowH;
            }
            // Skip mob framerate label + slider
            cy += 5 + 22;
            // Slider area for mob framerate
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.settingsSliderDragging = 'mobFramerate';
                this.handleSliderDrag(x);
                return;
            }
            cy += 25;
            // Skip interpolation label + slider
            cy += 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.settingsSliderDragging = 'interpolation';
                this.handleSliderDrag(x);
                return;
            }
            cy += 30;
            // Reset tutorial
            if (y >= cy && y <= cy + 30 && x >= contentX && x <= contentX + 160) {
                if (confirm('This will restart the tutorial on your next game. Continue?')) {
                    localStorage.removeItem('tutorial_completed');
                    localStorage.removeItem('tutorial_step');
                    alert('Tutorial will restart on your next game!');
                }
                return;
            }
        }
        else if (this.settingsTab === 'controls') {
            // Skip heading
            cy += 28;
            const controls = this.getControls();
            const controlKeys = Object.keys(controls);
            const labelW = contentW * 0.55;
            const inputW = contentW * 0.4;
            const inputH = 26;
            for (const action of controlKeys) {
                const inputX = contentX + labelW;
                if (x >= inputX && x <= inputX + inputW && y >= cy && y <= cy + inputH) {
                    this.settingsEditingControl = action;
                    return;
                }
                cy += inputH + 6;
            }
            // Save/Reset buttons
            cy += 10;
            const btnW = (contentW - 10) / 2;
            const btnH = 30;
            if (y >= cy && y <= cy + btnH) {
                if (x >= contentX && x <= contentX + btnW) {
                    this.saveControls();
                    return;
                }
                if (x >= contentX + btnW + 10 && x <= contentX + contentW) {
                    this.resetControls();
                    return;
                }
            }
        }
        else if (this.settingsTab === 'advanced') {
            // Server IP label
            cy += 25;
            // Server IP input
            const ipInputH = 32;
            if (x >= contentX && x <= contentX + contentW && y >= cy && y <= cy + ipInputH) {
                this.settingsServerIPFocused = true;
                return;
            }
            cy += ipInputH + 15;
            // Console logs checkbox
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.toggleSettingsCheckbox('showConsoleLogs');
                return;
            }
        }
        // Unfocus server IP if clicking elsewhere
        this.settingsServerIPFocused = false;
        this.settingsEditingControl = null;
    }
    /** Handles hover events within the settings panel */
    handleSettingsHover(x, y) {
        this.settingsHoveredItem = null;
        const { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom } = this.getSettingsLayout();
        // Outside panel
        if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH)
            return;
        // Close button
        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        if (x >= closeBtnX && x <= closeBtnX + 28 && y >= closeBtnY && y <= closeBtnY + 28) {
            this.settingsHoveredItem = 'close';
            return;
        }
        // Tabs
        const tabs = ['controls', 'graphics', 'advanced', 'credits'];
        const tabW = (contentW - (tabs.length - 1) * 5) / tabs.length;
        const tabY = panelY + headerH + pad + 5;
        for (let i = 0; i < tabs.length; i++) {
            const tx = contentX + i * (tabW + 5);
            if (x >= tx && x <= tx + tabW && y >= tabY && y <= tabY + tabH) {
                this.settingsHoveredItem = `tab_${tabs[i]}`;
                return;
            }
        }
        if (y < contentTop || y > contentBottom)
            return;
        const rowH = 32;
        let cy = contentTop + this.settingsScrollY;
        if (this.settingsTab === 'graphics') {
            const checkboxIds = ['showHitboxes', 'showStats', 'dynamicSkybox', 'mobDeathAnimation', 'showConsoleLogs'];
            for (const id of checkboxIds) {
                if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                    this.settingsHoveredItem = `cb_${id}`;
                    return;
                }
                cy += rowH;
            }
            cy += 5 + 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.settingsHoveredItem = 'slider_mobFramerate';
                return;
            }
            cy += 25 + 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.settingsHoveredItem = 'slider_interpolation';
                return;
            }
            cy += 30;
            if (y >= cy && y <= cy + 30 && x >= contentX && x <= contentX + 160) {
                this.settingsHoveredItem = 'resetTutorial';
                return;
            }
        }
        else if (this.settingsTab === 'controls') {
            cy += 28;
            const controls = this.getControls();
            const controlKeys = Object.keys(controls);
            const labelW = contentW * 0.55;
            const inputW = contentW * 0.4;
            const inputH = 26;
            for (const action of controlKeys) {
                const inputX = contentX + labelW;
                if (x >= inputX && x <= inputX + inputW && y >= cy && y <= cy + inputH) {
                    this.settingsHoveredItem = `ctrl_${action}`;
                    return;
                }
                cy += inputH + 6;
            }
            cy += 10;
            const btnW = (contentW - 10) / 2;
            const btnH = 30;
            if (y >= cy && y <= cy + btnH) {
                if (x >= contentX && x <= contentX + btnW) {
                    this.settingsHoveredItem = 'saveControls';
                    return;
                }
                if (x >= contentX + btnW + 10 && x <= contentX + contentW) {
                    this.settingsHoveredItem = 'resetControls';
                    return;
                }
            }
        }
        else if (this.settingsTab === 'advanced') {
            cy += 25;
            if (y >= cy && y <= cy + 32 && x >= contentX && x <= contentX + contentW) {
                this.settingsHoveredItem = 'serverIP';
                return;
            }
            cy += 32 + 15;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.settingsHoveredItem = 'cb_showConsoleLogs_adv';
                return;
            }
        }
    }
    /** Toggles a settings checkbox and persists to localStorage */
    toggleSettingsCheckbox(id) {
        switch (id) {
            case 'showHitboxes':
                this.settingsShowHitboxes = !this.settingsShowHitboxes;
                localStorage.setItem('showHitboxes', this.settingsShowHitboxes.toString());
                break;
            case 'enableShaders':
                this.settingsShadersEnabled = !this.settingsShadersEnabled;
                localStorage.setItem('shadersEnabled', this.settingsShadersEnabled.toString());
                if (window.shaderManager) {
                    window.shaderManager.setShadersEnabled(this.settingsShadersEnabled);
                }
                break;
            case 'showStats':
                this.settingsShowStats = !this.settingsShowStats;
                localStorage.setItem('showStats', this.settingsShowStats.toString());
                break;
            case 'highQualityMobs':
                this.settingsHighQualityMobs = !this.settingsHighQualityMobs;
                localStorage.setItem('highQualityMobs', this.settingsHighQualityMobs.toString());
                (0, constants_1.invalidateSettingsCache)();
                break;
            case 'dynamicSkybox':
                this.settingsDynamicSkybox = !this.settingsDynamicSkybox;
                localStorage.setItem('dynamicSkybox', this.settingsDynamicSkybox.toString());
                if (window.currentGame && window.currentGame.graphics) {
                    window.currentGame.graphics.dynamicSkybox = this.settingsDynamicSkybox;
                }
                break;
            case 'mobDeathAnimation':
                this.settingsMobDeathAnimation = !this.settingsMobDeathAnimation;
                localStorage.setItem('mobDeathAnimation', this.settingsMobDeathAnimation.toString());
                if (window.currentGame) {
                    window.currentGame.mobDeathAnimation = this.settingsMobDeathAnimation;
                }
                break;
            case 'showConsoleLogs':
                this.settingsShowConsoleLogs = !this.settingsShowConsoleLogs;
                localStorage.setItem('showConsoleLogs', this.settingsShowConsoleLogs.toString());
                if (window.currentGame && window.currentGame.graphics) {
                    window.currentGame.graphics.setShowConsoleLogs(this.settingsShowConsoleLogs);
                }
                break;
        }
    }
    /** Handles slider drag interaction */
    handleSliderDrag(mouseX) {
        const { contentX, contentW } = this.getSettingsLayout();
        const ratio = Math.max(0, Math.min(1, (mouseX - contentX) / contentW));
        if (this.settingsSliderDragging === 'mobFramerate') {
            this.settingsMobFramerate = Math.round(5 + ratio * 55);
            localStorage.setItem('mobAnimationFramerate', this.settingsMobFramerate.toString());
            (0, constants_1.invalidateSettingsCache)();
        }
        else if (this.settingsSliderDragging === 'interpolation') {
            this.settingsInterpolation = Math.round((0.05 + ratio * 0.45) * 100) / 100;
            localStorage.setItem('interpolationAmount', this.settingsInterpolation.toString());
            if (window.currentGame) {
                window.currentGame.interpolationAmount = this.settingsInterpolation;
            }
        }
    }
    /**
     * Renders the connecting state on canvas
     */
    renderConnecting(ctx, centerX, centerY) {
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
    /**
     * Renders the auth form on canvas
     */
    renderAuthForm(ctx, centerX, centerY) {
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
        this.drawAuthInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 'username', this.authUsername, 'Username');
        currentY += inputHeight + 15;
        // Password input
        this.drawAuthInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 'password', this.authPassword, 'Password', true);
        currentY += inputHeight + 15;
        // Confirm password (register only)
        if (!this.isLoginForm) {
            this.drawAuthInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 'confirmPassword', this.authConfirmPassword, 'Confirm Password', true);
            currentY += inputHeight + 15;
        }
        // Advanced settings toggle button (gardn style)
        const advancedButtonY = currentY;
        const advancedButtonWidth = inputWidth;
        const advancedButtonHeight = 35;
        const isAdvancedHovered = this.hoveredAuthButton === 'toggleAdvanced';
        const isAdvancedPressed = this.pressedButton === 'toggleAdvanced';
        const advancedText = `Advanced Settings ${this.authAdvancedSettingsVisible ? '▲' : '▼'}`;
        this.drawGardnButton(ctx, inputX, advancedButtonY, advancedButtonWidth, advancedButtonHeight, '#7B2FA0', isAdvancedHovered, isAdvancedPressed, advancedText, 14, 4, inputRadius);
        currentY += advancedButtonHeight + 10;
        // Advanced settings (server IP)
        if (this.authAdvancedSettingsVisible) {
            this.drawAuthInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 'serverIP', this.authServerIP, 'Server IP');
            currentY += inputHeight + 15;
        }
        // Buttons
        currentY += 10;
        if (this.isLoginForm) {
            // Login button (purple) - full width
            this.drawAuthButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'login', 'Login', '#8A2BE2'); // Purple
            currentY += buttonHeight + buttonSpacing;
            // Register button (make it prominent and easy to access)
            this.drawAuthButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'showRegister', 'Register', '#8A2BE2'); // Purple - same as login
            currentY += buttonHeight + buttonSpacing;
            // Guest button (smaller, less prominent)
            const guestButtonWidth = inputWidth * 0.5; // Half width
            const guestButtonX = inputX + (inputWidth - guestButtonWidth) / 2; // Centered
            this.drawAuthButton(ctx, guestButtonX, currentY, guestButtonWidth, buttonHeight * 0.8, inputRadius, 'guest', 'Guest', '#6A1B9A'); // Darker purple, smaller
            currentY += buttonHeight * 0.8 + 4;
            // Guest warning text
            ctx.font = '11px Ubuntu, sans-serif';
            ctx.fillStyle = '#FF9800';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Guest accounts do not keep progress', centerX, currentY + 6);
            currentY += buttonSpacing + 8;
        }
        else {
            // Register button (purple)
            this.drawAuthButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'register', 'Register', '#8A2BE2'); // Purple
            currentY += buttonHeight + buttonSpacing;
            // Offline register button (darker purple)
            this.drawAuthButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'offline', 'Register Offline', '#6A1B9A'); // Darker purple
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
    drawAuthInput(ctx, x, y, width, height, _radius, fieldName, value, placeholder, isPassword = false) {
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
    drawAuthButton(ctx, x, y, width, height, radius, buttonId, text, color) {
        const isHovered = this.hoveredAuthButton === buttonId;
        const isPressed = this.pressedButton === buttonId;
        this.drawGardnButton(ctx, x, y, width, height, color, isHovered, isPressed, text, 18, 5, radius);
    }
    setupNameInputPersistence() {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            const nameInput = document.getElementById('nameInput');
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
    hideAuthContainer() {
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
    showAuthContainer() {
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
    onLoadoutLoaded() {
        if (!this.isConnecting)
            return; // Already handled
        this.isConnecting = false;
        // Check if user is logged in - if not, show auth form
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        const currentUser = localStorage.getItem('currentUser') || sessionStorage.getItem('currentUser');
        if (!username || !password || !currentUser) {
            // User is not logged in, show auth form
            this.showAuthContainer();
        }
        else {
            // User is logged in, hide auth form
            this.hideAuthContainer();
        }
    }
    /**
     * Called when connection attempt completes (even if no loadout to load)
     */
    onConnectionComplete() {
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
    async handleAuthLogin() {
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
                    window.preconnectToServer?.();
                }
                else {
                    this.titleScreenInventoryManager.reauthenticate();
                }
            }
            else {
                const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
                if (offlineCredentials.username === username &&
                    offlineCredentials.password === password &&
                    offlineCredentials.isOffline) {
                    sessionStorage.setItem('currentUser', username);
                    sessionStorage.setItem('isOffline', 'true');
                    this.hideAuthContainer();
                }
                else {
                    alert('Invalid username or password');
                }
            }
        }
        catch (error) {
            console.error('Login error:', error);
            const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
            if (offlineCredentials.username === username &&
                offlineCredentials.password === password &&
                offlineCredentials.isOffline) {
                sessionStorage.setItem('currentUser', username);
                sessionStorage.setItem('isOffline', 'true');
                this.hideAuthContainer();
            }
            else {
                alert('Invalid username or password');
            }
        }
    }
    async handleAuthGuest() {
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
                    window.preconnectToServer?.();
                }
                else {
                    this.titleScreenInventoryManager.reauthenticate();
                }
                alert(`Guest account created!\nUsername: ${guestUsername}\nPassword: ${guestPassword}\n\nSave these credentials if you want to log in again!`);
            }
            else {
                const errorData = await response.json();
                if (errorData.message && errorData.message.includes('already exists')) {
                    this.handleAuthGuest(); // Retry
                }
                else {
                    alert('Failed to create guest account: ' + (errorData.message || 'Unknown error'));
                }
            }
        }
        catch (error) {
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
    async handleAuthRegister() {
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
            }
            else {
                const errorData = await response.json();
                alert(errorData.message || 'Registration failed');
            }
        }
        catch (error) {
            console.error('Registration error:', error);
            alert('Could not connect to server. Please check the server IP and try again.');
        }
    }
    handleAuthOfflineRegister() {
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
        if (storedCredentials.some((cred) => cred.username === username)) {
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
    hideGameMenu() {
        this.gameMenu.style.display = 'none';
    }
    showGameMenu() {
        // gameMenu is empty (contents moved elsewhere), keep it hidden
        this.gameMenu.style.display = 'none';
    }
    hideCenterText() {
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
    showCenterText() {
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
    hideTitleScreen() {
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
        this.isTitleScreenVisible = false;
        this.dailyStreakWidget?.hide();
        // Hide all title screen panels
        this.hideTitleScreenPanels();
        // Resize canvas back to full screen for game
        const gameCanvas = document.getElementById('gameCanvas');
        if (gameCanvas) {
            // Resize canvas to full screen dimensions
            // Reset canvas positioning to full screen
            gameCanvas.style.position = 'absolute';
            gameCanvas.style.left = '0px';
            gameCanvas.style.top = '0px';
            gameCanvas.style.zIndex = '0';
            gameCanvas.style.pointerEvents = 'auto';
            gameCanvas.style.display = 'block';
            (0, zoom_compensation_1.applyZoomCompensation)(gameCanvas);
            // Re-setup canvas on managers with full screen dimensions
            this.changelogManager.setCanvas(gameCanvas);
            this.notificationsManager.setCanvas(gameCanvas);
        }
    }
    hideTitleScreenPanels() {
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
            skillsPanel.style.display = 'none';
        }
        // Hide chat container (created by Chat, no ID, so we need to find it by class)
        const chatContainer = document.querySelector('.chat-container');
        if (chatContainer) {
            chatContainer.style.display = 'none';
        }
        // Also close panels through managers if they exist
        // Note: We check display style directly and hide manually to avoid toggling logic
        // The panels are already hidden above, but we ensure managers know they're closed
        if (this.titleScreenInventoryManager) {
            // Force close inventory panel if it exists
            const invPanel = document.getElementById('inventoryPanel');
            if (invPanel) {
                invPanel.classList.remove('open');
                invPanel.style.display = 'none';
            }
            // Force close crafting panel if it exists
            const craftPanel = document.getElementById('craftingPanel');
            if (craftPanel) {
                craftPanel.classList.remove('open');
                craftPanel.style.display = 'none';
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
    showTitleScreen() {
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
        }
        else {
            this.hideAuthContainer();
        }
        this.showGameMenu();
        this.showCenterText();
        this.showFloatingPetals();
        this.showBackgroundCanvas();
        this.startBackgroundAnimation();
        this.isTitleScreenVisible = true;
        this.dailyStreakWidget?.show();
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
        const gameCanvas = document.getElementById('gameCanvas');
        if (gameCanvas) {
            gameCanvas.style.display = 'none';
        }
    }
    showExitButton() {
        this.exitButtonContainer.style.display = 'flex';
        // Show the exit button when in game
        const exitButton = this.exitButtonContainer.querySelector('#exitButton');
        if (exitButton) {
            exitButton.style.display = 'flex';
        }
        // Also show bottom left buttons
        const bottomLeftButtons = document.getElementById('bottomLeftButtons');
        if (bottomLeftButtons) {
            bottomLeftButtons.style.display = 'flex';
        }
    }
    hideExitButton() {
        // Don't hide the container completely, just hide the exit button
        // Keep settings button visible on title screen
        const exitButton = this.exitButtonContainer.querySelector('#exitButton');
        if (exitButton) {
            exitButton.style.display = 'none';
        }
        // Keep bottom left buttons visible on title screen
        // They are now always visible
    }
    showLoadingScreen() {
        this.loadingScreen.classList.remove('hidden');
    }
    hideLoadingScreen() {
        this.loadingScreen.classList.add('hidden');
    }
    getMultiPlayerButton() {
        // Return a dummy button that can be clicked programmatically
        // The actual button is now rendered on canvas
        let button = document.getElementById('multiPlayerButton');
        if (!button) {
            button = document.createElement('button');
            button.style.display = 'none';
            button.id = 'multiPlayerButton';
            document.body.appendChild(button);
        }
        return button;
    }
    getSettingsButton() {
        return this.exitButtonContainer.querySelector('#settingsButton');
    }
    isSettingsOpen() {
        return this.settingsOpen;
    }
    toggleSettings() {
        this.settingsOpen = !this.settingsOpen;
        if (this.settingsOpen) {
            this.loadSettingsValues();
        }
    }
    /** Render settings overlay onto an external canvas context (for in-game use) */
    renderSettingsOverlay(ctx) {
        if (this.settingsOpen) {
            this.renderSettingsMenu(ctx);
        }
    }
    /** Forward a click to the settings panel (for in-game canvas). Returns true if consumed. */
    handleSettingsClickExternal(x, y) {
        if (!this.settingsOpen)
            return false;
        this.handleSettingsClick(x, y);
        return true;
    }
    /** Forward hover to the settings panel (for in-game canvas) */
    handleSettingsHoverExternal(x, y) {
        if (!this.settingsOpen)
            return;
        this.handleSettingsHover(x, y);
    }
    /** Forward mousedown for settings slider dragging (for in-game canvas). Returns true if consumed. */
    handleSettingsMouseDownExternal(x, y) {
        if (!this.settingsOpen)
            return false;
        if (this.settingsHoveredItem) {
            this.pressedButton = `settings_${this.settingsHoveredItem}`;
            if (this.settingsHoveredItem === 'slider_mobFramerate' || this.settingsHoveredItem === 'slider_interpolation') {
                this.settingsSliderDragging = this.settingsHoveredItem.replace('slider_', '');
                this.handleSliderDrag(x);
            }
            return true;
        }
        // Check if click is inside panel bounds
        const { panelW, panelH, panelX, panelY } = this.getSettingsLayout();
        if (x >= panelX && x <= panelX + panelW && y >= panelY && y <= panelY + panelH) {
            return true;
        }
        return false;
    }
    /** Forward mousemove for settings slider dragging (for in-game canvas) */
    handleSettingsMouseMoveExternal(x) {
        if (this.settingsSliderDragging) {
            this.handleSliderDrag(x);
        }
    }
    /** Forward mouseup for settings (for in-game canvas) */
    handleSettingsMouseUpExternal() {
        this.pressedButton = null;
        this.settingsSliderDragging = null;
    }
    /** Forward wheel event for settings scroll (for in-game canvas) */
    handleSettingsWheelExternal(deltaY) {
        if (this.settingsOpen) {
            this.settingsScrollY -= deltaY;
            this.settingsScrollY = Math.min(0, this.settingsScrollY);
        }
    }
    getShowHitboxes() {
        return this.settingsShowHitboxes;
    }
    getShadersEnabled() {
        return this.settingsShadersEnabled;
    }
    getShowStats() {
        return this.settingsShowStats;
    }
    getDynamicSkybox() {
        return this.settingsDynamicSkybox;
    }
    getServerIP() {
        return this.settingsServerIP || window.location.origin;
    }
    getNameInput() {
        // Return a dummy input that can be accessed programmatically
        // The actual input is now rendered on canvas
        let input = document.getElementById('nameInput');
        if (!input) {
            input = document.createElement('input');
            input.style.display = 'none';
            input.id = 'nameInput';
            document.body.appendChild(input);
        }
        input.value = this.playerName;
        return input;
    }
    getExitButtonContainer() {
        return this.exitButtonContainer;
    }
    startFloatingPetals() {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.startAnimation();
        }
    }
    stopFloatingPetals() {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.stopAnimation();
        }
    }
    destroyFloatingPetals() {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.destroy();
        }
    }
    /**
     * Gets the SVG file name for a given biome
     */
    getBiomeSvgFile(biomeName) {
        const biomeSvgMap = {
            'default': 'land.svg',
            'land': 'land.svg',
            'desert': 'desert.svg',
            'ocean': 'ocean.svg',
            'ant_hell': 'ant_hell.svg',
            'hel': 'hel.svg',
            'sewers': 'sewers.svg',
            'jungle': 'jungle.svg'
        };
        return biomeSvgMap[biomeName] || biomeSvgMap['default'];
    }
    async loadBackgroundTexture(biomeName) {
        // Get biome from parameter or localStorage, default to 'default'
        const biome = biomeName || localStorage.getItem('spawnBiome') || 'default';
        const svgFile = this.getBiomeSvgFile(biome);
        return new Promise((resolve) => {
            this.backgroundTexture.onload = () => {
                console.log(`Title screen background loaded successfully for biome: ${biome}`);
                resolve();
            };
            this.backgroundTexture.onerror = (error) => {
                console.error(`Failed to load title screen background for biome ${biome}:`, error);
                this.createFallbackImage();
                resolve();
            };
            let svgText = (0, biome_svgs_1.getBiomeSvgContent)(svgFile);
            if (!svgText) {
                this.createFallbackImage();
                resolve();
                return;
            }
            try {
                const base64 = btoa(unescape(encodeURIComponent(svgText)));
                const dataUrl = `data:image/svg+xml;base64,${base64}`;
                this.backgroundTexture.src = dataUrl;
            }
            catch (error) {
                console.error('Error encoding SVG:', error);
                this.createFallbackImage();
                resolve();
            }
        });
    }
    createFallbackImage() {
        // Create a simple colored rectangle as fallback
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#00d885';
        ctx.fillRect(0, 0, 400, 400);
        this.backgroundTexture.src = canvas.toDataURL();
    }
    drawScrollingBackground() {
        // Resize canvas to match window size (zoom-compensated)
        (0, zoom_compensation_1.applyZoomCompensation)(this.backgroundCanvas);
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
        }
        catch (error) {
            console.log('Error drawing background:', error);
        }
    }
    animateBackground() {
        this.backgroundTime += 16; // ~60fps
        this.drawScrollingBackground();
        // Only handle canvas resizing on title screen (not in-game)
        // In-game, the Graphics class handles menu rendering on the full-screen canvas
        if (!window.currentGame) {
            // Render changelog and notifications menus on game canvas (title screen only)
            const gameCanvas = document.getElementById('gameCanvas');
            if (gameCanvas) {
                const changelogOpen = this.changelogManager.isChangelogOpen();
                const notificationsOpen = this.notificationsManager.isNotificationsOpen();
                const leaderboardOpen = this.leaderboardManager.isLeaderboardOpen();
                const guildOpen = this.guildMenuManager.isGuildMenuOpen();
                if (changelogOpen || notificationsOpen || leaderboardOpen || guildOpen) {
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
                        this.guildMenuManager.setCanvas(gameCanvas);
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
                    this.guildMenuManager.render();
                }
                else {
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
    startBackgroundAnimation() {
        if (!this.backgroundAnimationId) {
            this.animateBackground();
        }
    }
    stopBackgroundAnimation() {
        if (this.backgroundAnimationId) {
            cancelAnimationFrame(this.backgroundAnimationId);
            this.backgroundAnimationId = 0;
        }
    }
    hideFloatingPetals() {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.stopAnimation();
        }
        if (this.floatingPetalsContainer) {
            this.floatingPetalsContainer.style.display = 'none';
        }
    }
    showFloatingPetals() {
        if (this.floatingPetalManager) {
            this.floatingPetalManager.startAnimation();
        }
        if (this.floatingPetalsContainer) {
            this.floatingPetalsContainer.style.display = 'block';
        }
    }
    hideBackgroundCanvas() {
        if (this.backgroundCanvas) {
            this.backgroundCanvas.style.display = 'none';
        }
    }
    showBackgroundCanvas() {
        if (this.backgroundCanvas) {
            this.backgroundCanvas.style.display = 'block';
        }
    }
    toggleInventoryOnTitleScreen() {
        // Use the title screen inventory manager
        this.titleScreenInventoryManager.toggleInventory();
    }
    toggleCraftingOnTitleScreen() {
        // Check if game is running - if so, use game's crafting
        if (window.currentGame && window.currentGame.inventoryManager) {
            window.currentGame.inventoryManager.toggleCrafting();
            return;
        }
        // Use title screen inventory manager to show crafting
        this.titleScreenInventoryManager.toggleCrafting();
    }
    toggleSkillsOnTitleScreen() {
        // Check if game is running - if so, use game's skills
        if (window.currentGame && window.currentGame.skillsManager) {
            window.currentGame.skillsManager.toggle();
            return;
        }
        // Use title screen skills manager
        if (this.titleScreenSkillsManager) {
            this.titleScreenSkillsManager.toggle();
        }
        else {
            alert('Please start the game to view and upgrade your skills.');
        }
    }
    initializeTitleScreenChat() {
        // Wait for preconnected socket to be available
        const checkSocket = setInterval(() => {
            if (window.preconnectedSocket && window.preconnectedSocket.connected) {
                console.log('[TitleScreen] Initializing chat with preconnected socket');
                this.titleScreenChat = new chat_1.Chat(window.preconnectedSocket);
                this.guildMenuManager.setSocket(window.preconnectedSocket);
                // Forward guild events received while on the title screen (before
                // the in-game socket handlers in socket.ts are wired up).
                const menu = this.guildMenuManager;
                window.preconnectedSocket.on('guildUpdate', (data) => menu.applyGuildUpdate(data));
                window.preconnectedSocket.on('guildInviteReceived', (data) => menu.applyInviteReceived(data));
                clearInterval(checkSocket);
            }
        }, 100);
        // Timeout after 5 seconds if socket doesn't connect
        setTimeout(() => {
            clearInterval(checkSocket);
            if (!this.titleScreenChat && window.preconnectedSocket && window.preconnectedSocket.connected) {
                console.log('[TitleScreen] Initializing chat with preconnected socket (delayed)');
                this.titleScreenChat = new chat_1.Chat(window.preconnectedSocket);
                this.guildMenuManager.setSocket(window.preconnectedSocket);
                // Forward guild events received while on the title screen (before
                // the in-game socket handlers in socket.ts are wired up).
                const menu = this.guildMenuManager;
                window.preconnectedSocket.on('guildUpdate', (data) => menu.applyGuildUpdate(data));
                window.preconnectedSocket.on('guildInviteReceived', (data) => menu.applyInviteReceived(data));
            }
        }, 5000);
    }
    initializeTitleScreenSkills() {
        // Create a minimal game interface for skills manager
        const createGameInterface = () => ({
            getLocalPlayer: () => {
                // Get player data from title screen inventory manager
                const playerData = this.titleScreenInventoryManager.playerData;
                if (!playerData)
                    return undefined;
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
                };
            },
            getSocket: () => window.preconnectedSocket,
            showFloatingText: () => { }, // No-op for title screen
            canvas: document.createElement('canvas'),
            graphics: (() => {
                const c = document.createElement('canvas');
                const dummy = new Image();
                return new core_1.Graphics(c, dummy, dummy, dummy, dummy, dummy, dummy);
            })()
        });
        // Wait for socket to be available
        const checkSocket = setInterval(() => {
            if (window.preconnectedSocket && window.preconnectedSocket.connected) {
                console.log('[TitleScreen] Initializing skills manager with preconnected socket');
                this.titleScreenSkillsManager = new skills_1.SkillsManager(createGameInterface());
                // Refresh skills if player data is already available
                const playerData = this.titleScreenInventoryManager.playerData;
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
                this.titleScreenSkillsManager = new skills_1.SkillsManager(createGameInterface());
                // Refresh skills if player data is already available
                const playerData = this.titleScreenInventoryManager.playerData;
                if (playerData && playerData.tp !== undefined && playerData.skills) {
                    this.titleScreenSkillsManager.updateSkills(playerData.tp || 0, playerData.skills || {});
                }
            }
        }, 5000);
    }
    cloneCanvas(src) {
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d')?.drawImage(src, 0, 0);
        return c;
    }
    buildTitleScreenGameInterface() {
        const offscreenCanvas = document.createElement('canvas');
        (0, zoom_compensation_1.applyZoomCompensation)(offscreenCanvas);
        return {
            getLocalPlayer: () => {
                const playerData = this.titleScreenInventoryManager.playerData;
                if (!playerData)
                    return undefined;
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
                };
            },
            getSocket: () => window.preconnectedSocket,
            showFloatingText: () => { },
            showFallingStars: () => { },
            canvas: offscreenCanvas,
            getPetalCanvas: (petalType, rarity, time = Date.now()) => {
                const assets = window.preloadedAssets;
                if (!assets || !assets.petalImages)
                    return null;
                const key = `${petalType}_${rarity}`;
                const entry = assets.petalImages[key];
                if (!entry)
                    return null;
                if (Array.isArray(entry)) {
                    const frameIndex = Math.floor((time / 42) % entry.length);
                    // Clone so the same cache canvas isn't appended to multiple DOM nodes
                    return this.cloneCanvas(entry[frameIndex]);
                }
                return this.cloneCanvas(entry);
            },
            getItemSpriteDataUrl: (itemType) => {
                const assets = window.preloadedAssets;
                if (!assets || !assets.itemSprites)
                    return null;
                const img = assets.itemSprites[itemType];
                if (!img)
                    return null;
                try {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth || 32;
                    c.height = img.naturalHeight || 32;
                    c.getContext('2d')?.drawImage(img, 0, 0);
                    return c.toDataURL('image/png');
                }
                catch {
                    return null;
                }
            }
        };
    }
    initializeTitleScreenShop() {
        const gameInterface = this.buildTitleScreenGameInterface();
        const initShop = () => {
            if (this.titleScreenShopManager)
                return;
            console.log('[TitleScreen] Initializing shop manager');
            this.titleScreenShopManager = new shop_1.ShopManager(gameInterface);
            // Wire up shop socket events (same as socket.ts in-game handlers)
            const socket = window.preconnectedSocket;
            if (!socket)
                return;
            socket.on('shopPurchaseSuccess', (data) => {
                const playerData = this.titleScreenInventoryManager.playerData;
                if (playerData) {
                    playerData.inventory = data.inventory;
                    playerData.stars = data.stars;
                }
                this.titleScreenShopManager?.handlePurchaseSuccess();
                this.titleScreenShopManager?.updateStarsDisplay();
            });
            socket.on('shopPurchaseError', (message) => {
                this.titleScreenShopManager?.handlePurchaseError(message);
            });
            socket.on('codeRedeemSuccess', (data) => {
                const playerData = this.titleScreenInventoryManager.playerData;
                if (playerData)
                    playerData.stars = data.totalStars;
                this.titleScreenShopManager?.handleCodeRedeemSuccess(data.stars);
                this.titleScreenShopManager?.updateStarsDisplay();
            });
            socket.on('codeRedeemError', (message) => {
                this.titleScreenShopManager?.handleCodeRedeemError(message);
            });
            socket.on('starsEarned', (data) => {
                const playerData = this.titleScreenInventoryManager.playerData;
                if (playerData)
                    playerData.stars = data.total;
                this.titleScreenShopManager?.updateStarsDisplay();
            });
            socket.on('dailyStreakStatus', (data) => {
                const playerData = this.titleScreenInventoryManager.playerData;
                if (playerData)
                    playerData.stars = data.totalStars;
                this.titleScreenShopManager?.updateStarsDisplay();
                this.ensureDailyStreakWidget();
                this.dailyStreakWidget?.update({
                    streak: data.streak,
                    newDay: data.newDay,
                    starsAwarded: data.starsAwarded,
                    nextClaimAtMs: data.nextClaimAtMs,
                    streakExpiresAtMs: data.streakExpiresAtMs,
                });
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
    ensureDailyStreakWidget() {
        if (!this.dailyStreakWidget) {
            this.dailyStreakWidget = new daily_streak_widget_1.DailyStreakWidget();
        }
        if (this.isTitleScreenVisible) {
            this.dailyStreakWidget.show();
        }
        else {
            this.dailyStreakWidget.hide();
        }
    }
    initializeTitleScreenMobGallery() {
        const gameInterface = this.buildTitleScreenGameInterface();
        const initGallery = () => {
            if (this.titleScreenMobGallery)
                return;
            console.log('[TitleScreen] Initializing mob gallery manager');
            this.titleScreenMobGallery = new inventory_1.InventoryManager(gameInterface, null, { mobGalleryOnly: true });
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
exports.TitleScreen = TitleScreen;
