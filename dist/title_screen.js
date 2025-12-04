"use strict";
/**
 * Title Screen Menu Management
 * Handles all menu-related DOM elements and interactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.titleScreenStyles = exports.TitleScreen = void 0;
exports.injectTitleScreenStyles = injectTitleScreenStyles;
const petals_1 = require("./petals");
const changelog_1 = require("./changelog");
const constants_1 = require("./constants");
const chat_1 = require("./chat");
const skills_1 = require("./skills");
class FloatingPetalManager {
    constructor(container) {
        this.petals = [];
        this.animationId = null;
        this.container = container;
        this.startAnimation();
    }
    createPetal() {
        const petal = document.createElement('div');
        petal.className = 'floating-petal';
        // Get random petal type and rarity from actual petals.ts
        const petalTypes = Object.keys(petals_1.PETAL_CONFIG);
        const nonAdminPetalTypes = petalTypes.filter(type => !petals_1.PETAL_CONFIG[type]['common']?.isAdminPetal);
        const petalType = nonAdminPetalTypes.length > 0 ? nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)] : 'basic';
        const rarity = petals_1.RARITY_LEVELS[Math.floor(Math.random() * petals_1.RARITY_LEVELS.length)];
        // Get petal stats from actual petals.ts
        const petalStats = petals_1.PETAL_CONFIG[petalType]?.[rarity];
        if (!petalStats) {
            // Fallback to basic common if petal not found
            const fallbackStats = petals_1.PETAL_CONFIG.basic?.common;
            if (fallbackStats) {
                petal.innerHTML = fallbackStats.image || `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${fallbackStats.color}" stroke="#d9d9d9" stroke-width="2"/></svg>`;
            }
        }
        else {
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
            petalStats: petalStats || petals_1.PETAL_CONFIG.basic?.common
        };
    }
    updatePetal(petal) {
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
    removePetal(petal) {
        const index = this.petals.indexOf(petal);
        if (index > -1) {
            this.petals.splice(index, 1);
            this.container.removeChild(petal.element);
        }
    }
    animate() {
        // Update all petals
        this.petals.forEach(petal => this.updatePetal(petal));
        // Spawn new petals occasionally
        if (Math.random() < 0.02) { // 2% chance per frame
            this.spawnPetal();
        }
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    spawnPetal() {
        const petal = this.createPetal();
        this.petals.push(petal);
        this.container.appendChild(petal.element);
    }
    startAnimation() {
        if (this.animationId === null) {
            this.animate();
        }
    }
    stopAnimation() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    destroy() {
        this.stopAnimation();
        this.petals.forEach(petal => {
            if (petal.element.parentNode) {
                petal.element.parentNode.removeChild(petal.element);
            }
        });
        this.petals = [];
    }
}
class TitleScreen {
    constructor() {
        this.availableBiomes = [];
        this.backgroundTime = 0;
        this.titleScreenChat = null;
        this.titleScreenSkillsManager = null;
        this.initializeElements();
        this.setupEventListeners();
        this.changelogManager = new changelog_1.ChangelogManager();
        this.titleScreenInventoryManager = new TitleScreenInventoryManager();
        // Initialize chat and skills when socket is available
        this.initializeTitleScreenChat();
        this.initializeTitleScreenSkills();
        // Initialize biome selector with local map data
        this.updateBiomesFromMapData(constants_1.WORLD_MAP);
    }
    /**
     * Scans map data for available biomes and updates the biome selector
     */
    updateBiomesFromMapData(mapData) {
        // Extract unique biome names from map data
        const biomeNames = new Set();
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
    updateBiomeSelector() {
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
    createBiomeButton(biomeName) {
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
    getBiomeConfig(biomeName) {
        const configs = {
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
    setupBiomeButtonListeners() {
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
            background: rgb(0, 216, 133);
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
        `;
        this.centerText.innerHTML = `
            <p class="title" style="-webkit-text-stroke: 3px black;">florr.io clone</p>
            <!-- <p class="instructions">Use arrow keys to move. Hold space to extend petals.</p> -->
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
                            <input type="checkbox" id="enableParticles">
                            Enable Particle Effects
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
                            <input type="checkbox" class="tab-button" id="debugMode">
                            Enable Debug Mode
                        </label>
                        <br/><br/>
                        <label>
                            <input type="checkbox" class="tab-button" id="autoReconnect">
                            Auto-reconnect on disconnect
                        </label>
                        <br/><br/>
                        <label>
                            <input type="checkbox" class="tab-button" id="showNetworkStats">
                            Show Network Statistics
                        </label>
                        <br/><br/>
                        <h3>Performance</h3>
                        <label>
                            <select class="tab-button" id="renderDistance">
                                <option value="low">Low</option>
                                <option value="medium" selected>Medium</option>
                                <option value="high">High</option>
                            </select>
                            Render Distance
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
        const settingsIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'settings')?.value || '';
        const changelogIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'changelog')?.value || '';
        const exitIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'exit_button')?.value || '';
        // Update the SVG to be 32x32
        const formattedSettingsIcon = settingsIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedChangelogIcon = changelogIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        const formattedExitIcon = exitIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
        this.exitButtonContainer.innerHTML = `
            <div id="settingsButton" style="width: 42px; height: 42px; cursor: pointer; background: #b3b3b3; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" title="Settings">
                ${formattedSettingsIcon}
            </div>
            <div id="changelogButton" style="width: 42px; height: 42px; cursor: pointer; background: #00db3e; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" title="Changelog">
                ${formattedChangelogIcon}
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
        const craftIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'craft')?.value || '';
        const inventoryIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'inventory')?.value || '';
        const skillsIcon = GAME_ICONS_NET_ICONS.find((icon) => icon.name === 'skills')?.value || '';
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
        console.log('Craft icon HTML:', formattedCraftIcon.substring(0, 100));
        console.log('Inventory icon HTML:', formattedInventoryIcon.substring(0, 100));
        // Order: inventory (top), skills (middle), craft (bottom)
        bottomLeftButtons.innerHTML = `
            <div id="inventoryButtonIcon" style="width: 42px; height: 42px; cursor: pointer; background: #00b3ff; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; position: relative; z-index: 3; pointer-events: auto;" title="Inventory (I)">
                ${formattedInventoryIcon}
            </div>
            <div id="skillsButtonIcon" style="width: 42px; height: 42px; cursor: pointer; background: #9d4edd; padding: 5px; border-radius: 5px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; position: relative; z-index: 2; pointer-events: auto;" title="Skills (K)">
                ${formattedSkillsIcon}
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
        this.backgroundCtx = this.backgroundCanvas.getContext('2d');
        this.backgroundTexture = new Image();
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
            if (event.key === (controls.skills || 'k')) {
                this.toggleSkillsOnTitleScreen();
                event.preventDefault();
                return;
            }
        });
        // Settings button event listener (now in exitButtonContainer)
        const settingsButton = this.exitButtonContainer.querySelector('#settingsButton');
        const changelogButton = this.exitButtonContainer.querySelector('#changelogButton');
        const exitButton = this.exitButtonContainer.querySelector('#exitButton');
        const closeSettingsButton = this.settingsMenu.querySelector('#closeSettingsButton');
        if (settingsButton) {
            settingsButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.settingsMenu.classList.toggle('hidden');
            });
        }
        if (changelogButton) {
            changelogButton.addEventListener('click', () => {
                this.changelogManager.toggle();
            });
        }
        if (exitButton) {
            exitButton.addEventListener('click', () => {
                window.location.reload();
            });
        }
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
                        const controls = savedControls ? JSON.parse(savedControls) : { crafting: 'r' };
                        const event = new KeyboardEvent('keydown', { key: controls.crafting || 'r', bubbles: true, cancelable: true });
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
                        const savedControls = localStorage.getItem('controls');
                        const controls = savedControls ? JSON.parse(savedControls) : { skills: 'k' };
                        const event = new KeyboardEvent('keydown', { key: controls.skills || 'k', bubbles: true, cancelable: true });
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
                        const controls = savedControls ? JSON.parse(savedControls) : { inventory: 'i' };
                        const event = new KeyboardEvent('keydown', { key: controls.inventory || 'i', bubbles: true, cancelable: true });
                        document.dispatchEvent(event);
                    }
                    else {
                        // Toggle inventory panel directly on title screen
                        this.toggleInventoryOnTitleScreen();
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
                !this.settingsMenu.contains(e.target) &&
                !this.exitButtonContainer.querySelector('#settingsButton')?.contains(e.target)) {
                this.settingsMenu.classList.add('hidden');
            }
        });
        this.settingsMenu.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                const tab = button.getAttribute('data-tab');
                this.settingsMenu.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                this.settingsMenu.querySelectorAll('.tab-content').forEach(content => {
                    if (content.id === `${tab}-tab`) {
                        content.classList.add('active');
                    }
                    else {
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
        const showHitboxesCheckbox = this.settingsMenu.querySelector('#showHitboxesCheckbox');
        if (showHitboxesCheckbox) {
            showHitboxesCheckbox.addEventListener('change', () => {
                localStorage.setItem('showHitboxes', showHitboxesCheckbox.checked.toString());
            });
        }
        const enableShadersCheckbox = this.settingsMenu.querySelector('#enableShadersCheckbox');
        if (enableShadersCheckbox) {
            enableShadersCheckbox.addEventListener('change', () => {
                localStorage.setItem('shadersEnabled', enableShadersCheckbox.checked.toString());
                // Update shader manager if available
                if (window.shaderManager) {
                    window.shaderManager.setShadersEnabled(enableShadersCheckbox.checked);
                }
            });
        }
        const showStatsCheckbox = this.settingsMenu.querySelector('#showStats');
        if (showStatsCheckbox) {
            showStatsCheckbox.addEventListener('change', () => {
                localStorage.setItem('showStats', showStatsCheckbox.checked.toString());
            });
        }
        const mobFramerateSlider = this.settingsMenu.querySelector('#mobFramerateSlider');
        const mobFramerateValue = this.settingsMenu.querySelector('#mobFramerateValue');
        if (mobFramerateSlider && mobFramerateValue) {
            mobFramerateSlider.addEventListener('input', () => {
                const framerate = parseInt(mobFramerateSlider.value, 10);
                mobFramerateValue.textContent = framerate.toString();
                localStorage.setItem('mobAnimationFramerate', framerate.toString());
            });
        }
        const highQualityMobsCheckbox = this.settingsMenu.querySelector('#highQualityMobs');
        if (highQualityMobsCheckbox) {
            highQualityMobsCheckbox.addEventListener('change', () => {
                localStorage.setItem('highQualityMobs', highQualityMobsCheckbox.checked.toString());
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
        const serverIPInput = this.settingsMenu.querySelector('#serverIP-settings');
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
    async appendToBody() {
        document.body.appendChild(this.backgroundCanvas);
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
    populateControlsTab() {
        const controlsGrid = this.settingsMenu.querySelector('.controls-grid');
        if (!controlsGrid)
            return;
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
            input.addEventListener('keydown', (e) => {
                e.preventDefault();
                input.value = e.key;
            });
        });
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
    saveControls() {
        const controls = {};
        this.settingsMenu.querySelectorAll('.control-input').forEach(input => {
            const action = input.getAttribute('data-action');
            if (action) {
                controls[action] = input.value;
            }
        });
        localStorage.setItem('controls', JSON.stringify(controls));
        alert('Controls saved!');
    }
    resetControls() {
        localStorage.removeItem('controls');
        this.populateControlsTab();
        alert('Controls have been reset to default.');
    }
    loadSettings() {
        const showHitboxes = localStorage.getItem('showHitboxes') === 'true';
        const showHitboxesCheckbox = this.settingsMenu.querySelector('#showHitboxesCheckbox');
        if (showHitboxesCheckbox) {
            showHitboxesCheckbox.checked = showHitboxes;
        }
        const shadersEnabled = localStorage.getItem('shadersEnabled') === 'true';
        const enableShadersCheckbox = this.settingsMenu.querySelector('#enableShadersCheckbox');
        if (enableShadersCheckbox) {
            enableShadersCheckbox.checked = shadersEnabled;
        }
        // Load combined stats setting (migrate from old separate settings if needed)
        let showStats = localStorage.getItem('showStats') === 'true';
        if (!localStorage.getItem('showStats')) {
            // Migrate from old settings
            const oldShowFPS = localStorage.getItem('showFPS') === 'true';
            const oldShowCounters = localStorage.getItem('showCounters') === 'true';
            showStats = oldShowFPS || oldShowCounters;
            if (showStats) {
                localStorage.setItem('showStats', 'true');
            }
        }
        const showStatsCheckbox = this.settingsMenu.querySelector('#showStats');
        if (showStatsCheckbox) {
            showStatsCheckbox.checked = showStats;
        }
        const serverIP = localStorage.getItem('serverIP') || window.location.origin;
        const serverIPInput = this.settingsMenu.querySelector('#serverIP-settings');
        if (serverIPInput) {
            serverIPInput.value = serverIP;
        }
        const mobFramerate = parseInt(localStorage.getItem('mobAnimationFramerate') || '15', 10);
        const mobFramerateSlider = this.settingsMenu.querySelector('#mobFramerateSlider');
        const mobFramerateValue = this.settingsMenu.querySelector('#mobFramerateValue');
        if (mobFramerateSlider) {
            mobFramerateSlider.value = mobFramerate.toString();
        }
        if (mobFramerateValue) {
            mobFramerateValue.textContent = mobFramerate.toString();
        }
        const highQualityMobs = localStorage.getItem('highQualityMobs') === 'true';
        const highQualityMobsCheckbox = this.settingsMenu.querySelector('#highQualityMobs');
        if (highQualityMobsCheckbox) {
            highQualityMobsCheckbox.checked = highQualityMobs;
        }
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
    showLoginForm() {
        // console.log('Showing login form');
        // this.loginForm.classList.remove('hidden');
        // this.registerForm.classList.add('hidden');
        // handled in auth_ui.ts
    }
    showRegisterForm() {
        // console.log('Showing register form');
        // this.loginForm.classList.add('hidden');
        // this.registerForm.classList.remove('hidden');
        // handled in auth_ui.ts
    }
    hideAuthContainer() {
        this.authContainer.style.display = 'none';
    }
    showAuthContainer() {
        this.authContainer.style.display = 'block';
    }
    hideGameMenu() {
        this.gameMenu.style.display = 'none';
    }
    showGameMenu() {
        this.gameMenu.style.display = 'flex';
    }
    hideCenterText() {
        this.centerText.style.display = 'none';
    }
    showCenterText() {
        this.centerText.style.display = 'block';
    }
    hideTitleScreen() {
        this.hideAuthContainer();
        this.hideGameMenu();
        this.hideCenterText();
        this.hideFloatingPetals();
        this.stopBackgroundAnimation();
        this.hideBackgroundCanvas();
        // Hide all title screen panels
        this.hideTitleScreenPanels();
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
    }
    showTitleScreen() {
        this.showAuthContainer();
        this.showGameMenu();
        this.showCenterText();
        this.showFloatingPetals();
        this.showBackgroundCanvas();
        this.startBackgroundAnimation();
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
    showDeathScreen(killedBy) {
        this.deathScreen.classList.remove('hidden');
        // Update the death message with killer information
        const deathMessage = this.deathScreen.querySelector('.death-screen-content p');
        if (deathMessage && killedBy) {
            const mobName = this.getMobDisplayName(killedBy.type, killedBy.tier);
            deathMessage.textContent = `You were destroyed by: ${mobName}`;
        }
        else if (deathMessage) {
            deathMessage.textContent = 'Your adventure has come to an end...';
        }
    }
    hideDeathScreen() {
        this.deathScreen.classList.add('hidden');
    }
    getMobDisplayName(type, tier) {
        // Capitalize the first letter of the type
        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
        // Capitalize the first letter of the tier
        const capitalizedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
        return `${capitalizedTier} ${capitalizedType}`;
    }
    showLoadingScreen() {
        this.loadingScreen.classList.remove('hidden');
    }
    hideLoadingScreen() {
        this.loadingScreen.classList.add('hidden');
    }
    // Getters for accessing form elements
    getLoginUsername() {
        return this.loginForm.querySelector('#loginUsername');
    }
    getLoginPassword() {
        return this.loginForm.querySelector('#loginPassword');
    }
    getServerIPConnect() {
        return this.loginForm.querySelector('#serverIP-connect');
    }
    getLoginButton() {
        return this.loginForm.querySelector('#loginButton');
    }
    getRegisterUsername() {
        return this.registerForm.querySelector('#registerUsername');
    }
    getRegisterPassword() {
        return this.registerForm.querySelector('#registerPassword');
    }
    getRegisterConfirmPassword() {
        return this.registerForm.querySelector('#registerConfirmPassword');
    }
    getServerIPSingle() {
        return this.registerForm.querySelector('#serverIP-single');
    }
    getRegisterButton() {
        return this.registerForm.querySelector('#registerButton');
    }
    getRegisterOfflineButton() {
        return this.registerForm.querySelector('#registerOfflineButton');
    }
    getMultiPlayerButton() {
        return this.centerText.querySelector('#multiPlayerButton');
    }
    getSettingsButton() {
        return this.exitButtonContainer.querySelector('#settingsButton');
    }
    getShowHitboxes() {
        const checkbox = this.settingsMenu.querySelector('#showHitboxesCheckbox');
        return checkbox ? checkbox.checked : false;
    }
    getShadersEnabled() {
        const checkbox = this.settingsMenu.querySelector('#enableShadersCheckbox');
        return checkbox ? checkbox.checked : false;
    }
    getShowStats() {
        const checkbox = this.settingsMenu.querySelector('#showStats');
        return checkbox ? checkbox.checked : false;
    }
    getServerIP() {
        const input = this.settingsMenu.querySelector('#serverIP-settings');
        return input ? input.value : window.location.origin;
    }
    getNameInput() {
        return this.centerText.querySelector('#nameInput');
    }
    getHueSlider() {
        return this.centerText.querySelector('#hueSlider');
    }
    getColorPreview() {
        return this.centerText.querySelector('#colorPreview');
    }
    getUpdateColorButton() {
        return this.centerText.querySelector('#updateColorButton');
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
     * Gets the SVG file path for a given biome
     */
    getBiomeSvgPath(biomeName) {
        const biomeSvgMap = {
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
    async loadBackgroundTexture(biomeName) {
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
                }
                catch (error) {
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
                }
                catch (error) {
                    console.error('Error encoding fallback SVG:', error);
                    this.createFallbackImage();
                    resolve();
                }
            });
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
    createFallbackBackground() {
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
    drawScrollingBackground() {
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
        // Calculate how many tiles we need to draw
        const tilesX = Math.ceil(visibleWidth / bgWidth) + 2;
        const tilesY = Math.ceil(visibleHeight / bgHeight) + 2;
        // Draw the tiled background
        try {
            for (let i = 0; i <= tilesX; i++) {
                for (let j = 0; j <= tilesY; j++) {
                    const x = startX + (i * bgWidth) - cameraX;
                    const y = startY + (j * bgHeight) - cameraY;
                    this.backgroundCtx.drawImage(this.backgroundTexture, x, y, bgWidth, bgHeight);
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
                clearInterval(checkSocket);
            }
        }, 100);
        // Timeout after 5 seconds if socket doesn't connect
        setTimeout(() => {
            clearInterval(checkSocket);
            if (!this.titleScreenChat && window.preconnectedSocket && window.preconnectedSocket.connected) {
                console.log('[TitleScreen] Initializing chat with preconnected socket (delayed)');
                this.titleScreenChat = new chat_1.Chat(window.preconnectedSocket);
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
            canvas: document.createElement('canvas')
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
}
exports.TitleScreen = TitleScreen;
/**
 * Title Screen Inventory Manager
 * Handles inventory and loadout on the title screen using the preconnected socket
 */
class TitleScreenInventoryManager {
    constructor() {
        this.inventoryPanel = null;
        this.craftingPanel = null;
        this.loadoutBar = null;
        this.playerData = null;
        this.socket = null;
        this.craftingItems = [];
        this.isCraftingOpen = false;
        this.isAuthenticated = false;
        this.LOADOUT_SLOTS = 10;
        this.LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
        this.ITEM_RARITY_COLORS = {
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
        this.initializeLoadoutBar();
        this.initializeCraftingPanel();
        this.setupSocketListeners();
        this.setupGlobalDragAndDrop();
    }
    setupGlobalDragAndDrop() {
        // Handle dropping items outside loadout slots to move them back to inventory
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            const dragEvent = e;
            const target = e.target;
            // If dropped outside loadout slots and inventory grid, move item back to inventory
            if (!target.closest('.loadout-slot') && !target.closest('.inventory-grid') && !target.closest('.crafting-inventory-grid')) {
                const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (loadoutSlot) {
                    this.moveItemToInventory(parseInt(loadoutSlot));
                }
            }
        });
    }
    initializeLoadoutBar() {
        // Create loadout bar for title screen
        const loadoutContainer = document.getElementById('titleScreenLoadoutBar');
        if (!loadoutContainer) {
            // Retry after a short delay if container doesn't exist yet
            setTimeout(() => this.initializeLoadoutBar(), 100);
            return;
        }
        this.loadoutBar = loadoutContainer;
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
            slot.style.width = '50px';
            slot.style.height = '50px';
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
                font-size: 12px;
                pointer-events: none;
            `;
            slot.appendChild(keyText);
            if (this.loadoutBar) {
                this.loadoutBar.appendChild(slot);
            }
        }
    }
    setupSocketListeners() {
        // Check for preconnected socket and authenticate early to get player data
        if (window.preconnectedSocket && window.preconnectedSocket.connected) {
            this.socket = window.preconnectedSocket;
            this.authenticateAndFetchData();
            this.setupCraftingSocketListeners();
            this.setupSkillsSocketListeners();
        }
        else {
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
    setupSkillsSocketListeners() {
        if (!this.socket)
            return;
        // Listen for skills updates - this will be handled by index.ts which has access to titleScreen
        // We just update our local skills data here
        this.socket.on('skillsUpdated', (data) => {
            console.log('[TitleScreenInventory] skillsUpdated received:', data);
            // Check if this is for the current player
            if (data.playerId === this.socket.id) {
                // Update skills data in inventory manager
                this.updateSkillsData(data.tp, data.skills);
            }
        });
    }
    setupCraftingSocketListeners() {
        if (!this.socket)
            return;
        // Listen for crafting finished event (server emits 'craftingFinished', not 'craftResult')
        this.socket.on('craftingFinished', (data) => {
            console.log('[TitleScreen] craftingFinished received:', data);
            // Update inventory
            if (this.playerData) {
                this.playerData.inventory = data.inventory;
            }
            if (data.successCount > 0) {
                // Parse item type and petalType from itemKey
                const itemKey = data.newItem.type;
                let itemType = 'petal';
                let petalType;
                if (itemKey.startsWith('petal_')) {
                    itemType = 'petal';
                    petalType = itemKey.substring(6);
                }
                else {
                    itemType = itemKey;
                }
                const displayItem = {
                    type: itemType,
                    rarity: data.newItem.rarity,
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
        this.socket.on('craftingFailed', (error) => {
            alert(error);
        });
        // Listen for player updates to refresh inventory
        this.socket.on('playerUpdated', (updatedPlayer) => {
            if (updatedPlayer.inventory) {
                if (this.playerData) {
                    this.playerData.inventory = updatedPlayer.inventory;
                }
                if (this.isCraftingOpen) {
                    this.updateCraftingInventoryPreview();
                    this.updateInventoryDisplay();
                }
            }
        });
    }
    authenticateAndFetchData() {
        if (!this.socket || !this.socket.connected)
            return;
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        const playerName = document.getElementById('nameInput')?.value || 'Unnamed';
        const spawnBiome = localStorage.getItem('spawnBiome') || 'default';
        if (!username || !password)
            return;
        console.log('[TitleScreenInventory] Authenticating to fetch player data...');
        // Authenticate to get player data (this will spawn on server but we won't show game until Ready)
        // Use a flag to prevent duplicate authentication
        if (this.socket._titleScreenAuthenticated) {
            console.log('[TitleScreenInventory] Already authenticated, skipping');
            return;
        }
        this.socket._titleScreenAuthenticated = true;
        this.socket.emit('authenticate', {
            username,
            password,
            playerName,
            spawnBiome
        });
        // Listen for authentication response (use on instead of once to catch it if already sent)
        const authenticatedHandler = (response) => {
            if (response.success && response.player) {
                console.log('[TitleScreenInventory] Received player data:', response.player);
                this.isAuthenticated = true;
                this.playerData = {
                    inventory: response.player.inventory || {},
                    loadout: response.player.loadout || Array(10).fill(null)
                };
                this.updateLoadoutDisplay();
                if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
                    this.updateInventoryDisplay();
                }
                // Mark socket as authenticated - this allows operations to proceed
                // The server sets socket.username during authentication, but we ensure it's set here too
                if (this.socket && !this.socket.username) {
                    const username = localStorage.getItem('username');
                    if (username) {
                        this.socket.username = username;
                    }
                }
            }
        };
        // Check if already authenticated (socket might have authenticated before we set up listener)
        if (this.socket._authenticatedData) {
            authenticatedHandler(this.socket._authenticatedData);
        }
        else {
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
    updateLoadoutDisplay() {
        if (!this.loadoutBar || !this.playerData)
            return;
        const slots = this.loadoutBar.querySelectorAll('.loadout-slot');
        slots.forEach((slot, index) => {
            const slotElement = slot;
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
                    const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
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
                    }
                }
                else if (item.type) {
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
    formatPetalName(petalType) {
        if (!petalType)
            return "";
        let itemName = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
        itemName = itemName.replace('_', ' ');
        return itemName;
    }
    setupLoadoutDragAndDrop() {
        if (!this.loadoutBar)
            return;
        const slots = this.loadoutBar.querySelectorAll('.loadout-slot');
        // Setup draggable items in slots
        slots.forEach((slot, slotIndex) => {
            const slotElement = slot;
            // Find draggable element (img or petal div)
            const img = slotElement.querySelector('img');
            const petalDiv = slotElement.querySelector('div[style*="display: flex"]');
            let draggableElement = img || petalDiv || slotElement;
            if (draggableElement && slotElement.querySelector('img, div[style*="display: flex"]')) {
                draggableElement.draggable = true;
                draggableElement.style.cursor = 'grab';
                // Remove old listeners by cloning
                const newElement = draggableElement.cloneNode(true);
                draggableElement.parentNode?.replaceChild(newElement, draggableElement);
                draggableElement = newElement;
                draggableElement.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    const dragEvent = e;
                    dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                    dragEvent.dataTransfer.effectAllowed = 'move';
                });
            }
        });
        // Setup drop listeners on slots
        slots.forEach((slot, slotIndex) => {
            const slotElement = slot;
            // Remove old listeners by cloning
            const newSlot = slotElement.cloneNode(true);
            slotElement.parentNode?.replaceChild(newSlot, slotElement);
            newSlot.addEventListener('dragenter', (e) => {
                e.preventDefault();
                newSlot.classList.add('drag-over');
            });
            newSlot.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragEvent = e;
                dragEvent.dataTransfer.dropEffect = 'move';
                newSlot.classList.add('drag-over');
            });
            newSlot.addEventListener('dragleave', (e) => {
                newSlot.classList.remove('drag-over');
            });
            newSlot.addEventListener('drop', (e) => {
                e.preventDefault();
                const dragEvent = e;
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
                }
                else if (fromLoadoutSlot) {
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
    equipItemToLoadout(rarity, type, loadoutSlot) {
        if (!this.playerData || loadoutSlot >= this.LOADOUT_SLOTS || this.getItemCount(rarity, type) === 0)
            return;
        // Parse petal type if it's a petal
        let itemType;
        let petalType;
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6);
        }
        else {
            itemType = type;
        }
        const item = {
            type: itemType,
            rarity: rarity,
            petalType: petalType
        };
        // Initialize health for petals
        if (itemType === 'petal' && petalType && rarity) {
            const stats = (0, petals_1.getPetalStats)(petalType, rarity);
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
        if (this.socket && this.socket.connected && this.isAuthenticated && this.socket.username) {
            console.log('[TitleScreen] Emitting updateLoadout (equipItemToLoadout):', {
                socketId: this.socket.id,
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        }
        else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!this.socket?.username,
                socketId: this.socket?.id
            });
        }
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }
    moveItemToInventory(loadoutSlot) {
        if (!this.playerData || loadoutSlot >= this.playerData.loadout.length)
            return;
        const item = this.playerData.loadout[loadoutSlot];
        if (!item || !item.rarity)
            return;
        const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
        this.addItem(item.rarity, itemKey, 1);
        const newLoadout = [...this.playerData.loadout];
        newLoadout[loadoutSlot] = null;
        this.playerData.loadout = newLoadout;
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && this.socket.username) {
            console.log('[TitleScreen] Emitting updateLoadout (moveItemToInventory):', {
                socketId: this.socket.id,
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        }
        else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!this.socket?.username,
                socketId: this.socket?.id
            });
        }
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }
    swapLoadoutItems(fromSlot, toSlot) {
        if (!this.playerData)
            return;
        const newLoadout = [...this.playerData.loadout];
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        this.playerData.loadout = newLoadout;
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && this.socket.username) {
            console.log('[TitleScreen] Emitting updateLoadout (swapLoadoutItems):', {
                socketId: this.socket.id,
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        }
        else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!this.socket?.username,
                socketId: this.socket?.id
            });
        }
        this.updateLoadoutDisplay();
    }
    updateInventoryDisplay() {
        if (!this.inventoryPanel || !this.playerData)
            return;
        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content)
            return;
        content.innerHTML = '';
        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);
        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        const gridContainer = document.createElement('div');
        gridContainer.className = 'inventory-grid-container';
        gridContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
      `;
        rarities.forEach(rarity => {
            const items = this.playerData?.inventory[rarity];
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
                            const stats = (0, petals_1.getPetalStats)(petalType, rarity);
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
                        }
                        else {
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
    darkenColor(hex, percent = 30) {
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
    toggleInventory() {
        let inventoryPanel = document.getElementById('inventoryPanel');
        if (!inventoryPanel) {
            inventoryPanel = document.createElement('div');
            inventoryPanel.id = 'inventoryPanel';
            inventoryPanel.className = 'inventory-panel';
            inventoryPanel.style.display = 'none';
            const inventoryContent = document.createElement('div');
            inventoryContent.className = 'inventory-content';
            inventoryPanel.appendChild(inventoryContent);
            document.body.appendChild(inventoryPanel);
            this.inventoryPanel = inventoryPanel;
        }
        const isOpen = inventoryPanel.style.display === 'block';
        if (!isOpen) {
            this.updateInventoryDisplay();
            inventoryPanel.style.display = 'block';
            setTimeout(() => {
                inventoryPanel.classList.add('open');
            }, 10);
        }
        else {
            inventoryPanel.classList.remove('open');
            setTimeout(() => {
                inventoryPanel.style.display = 'none';
            }, 300);
        }
    }
    updateFromPlayerData(playerData) {
        this.playerData = playerData;
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
        if (this.isCraftingOpen) {
            this.updateCraftingInventoryPreview();
        }
    }
    updateSkillsData(tp, skills) {
        // Update skills data in playerData
        if (this.playerData) {
            this.playerData.tp = tp;
            this.playerData.skills = skills;
        }
    }
    toggleCrafting() {
        // Check if game is running - if so, use game's crafting
        if (window.currentGame && window.currentGame.inventoryManager) {
            window.currentGame.inventoryManager.toggleCrafting();
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
            }
            else {
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
    toggleSkills() {
        // This is now handled by TitleScreen.toggleSkillsOnTitleScreen()
        // This method is kept for compatibility but shouldn't be called directly
    }
    initializeCraftingPanel() {
        // Check if crafting panel already exists (from game)
        let existingPanel = document.getElementById('craftingPanel');
        if (existingPanel) {
            this.craftingPanel = existingPanel;
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
    setupCraftingDragAndDrop() {
        if (!this.craftingPanel)
            return;
        const slots = this.craftingPanel.querySelectorAll('.crafting-slot');
        slots.forEach((slot, index) => {
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.currentTarget.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', (e) => {
                e.currentTarget.classList.remove('drag-over');
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                const dragEvent = e;
                e.currentTarget.classList.remove('drag-over');
                const itemData = dragEvent.dataTransfer?.getData('text/plain');
                if (itemData) {
                    const { rarity, type } = JSON.parse(itemData);
                    this.addItemToCraftingSlot(rarity, type, index);
                }
            });
        });
    }
    getItemCount(rarity, type) {
        if (!this.playerData || !this.playerData.inventory)
            return 0;
        const rarityInventory = this.playerData.inventory[rarity];
        if (!rarityInventory)
            return 0;
        return rarityInventory[type] || 0;
    }
    removeItem(rarity, type, count) {
        if (!this.playerData || !this.playerData.inventory)
            return;
        if (!this.playerData.inventory[rarity]) {
            this.playerData.inventory[rarity] = {};
        }
        const currentCount = this.playerData.inventory[rarity][type] || 0;
        this.playerData.inventory[rarity][type] = Math.max(0, currentCount - count);
    }
    addItem(rarity, type, count) {
        if (!this.playerData || !this.playerData.inventory)
            return;
        if (!this.playerData.inventory[rarity]) {
            this.playerData.inventory[rarity] = {};
        }
        const currentCount = this.playerData.inventory[rarity][type] || 0;
        this.playerData.inventory[rarity][type] = currentCount + count;
    }
    addItemToCraftingSlot(rarity, type, slotIndex) {
        if (this.getItemCount(rarity, type) === 0)
            return;
        let itemType;
        let petalType;
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6);
        }
        else {
            itemType = type;
        }
        const item = {
            type: itemType,
            rarity: rarity,
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
    removeCraftingBatch() {
        if (this.craftingItems.length === 0)
            return;
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
    craftItems() {
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
        if (!this.socket.username) {
            alert('Please wait for authentication to complete');
            return;
        }
        console.log('[TitleScreen] Sending craftItems request:', { itemCount: this.craftingItems.length, socketId: this.socket.id });
        this.socket.emit('craftItems', { items: this.craftingItems });
        this.craftingItems = [];
        this.updateCraftingDisplay();
    }
    updateCraftingDisplay() {
        if (!this.craftingPanel)
            return;
        const slots = this.craftingPanel.querySelectorAll('.crafting-slot');
        const container = this.craftingPanel.querySelector('.crafting-circle-container');
        const multiplierEl = this.craftingPanel.querySelector('.crafting-multiplier');
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
                    slot.style.left = `${x}px`;
                    slot.style.top = `${y}px`;
                }
                slot.innerHTML = '';
                const rarityColor = this.ITEM_RARITY_COLORS[firstItem.rarity] || '#666';
                slot.style.borderColor = rarityColor;
                if (firstItem.type === 'petal' && firstItem.petalType && firstItem.rarity) {
                    const stats = (0, petals_1.getPetalStats)(firstItem.petalType, firstItem.rarity);
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
                }
                else {
                    const img = document.createElement('img');
                    img.src = `./assets/${firstItem.type}.png`;
                    img.alt = firstItem.type;
                    img.style.width = '80%';
                    img.style.height = '80%';
                    img.style.objectFit = 'contain';
                    slot.appendChild(img);
                }
            });
        }
        else {
            if (multiplierEl) {
                multiplierEl.style.display = 'none';
            }
            slots.forEach((slot, index) => {
                if (container) {
                    const angle = (index / slots.length) * 2 * Math.PI;
                    const x = (containerSize / 2) + radius * Math.cos(angle) - 20;
                    const y = (containerSize / 2) + radius * Math.sin(angle) - 20;
                    slot.style.left = `${x}px`;
                    slot.style.top = `${y}px`;
                }
                slot.innerHTML = '';
                slot.style.borderColor = '#666';
            });
        }
        const successChance = this.calculateSuccessChance();
        const successElement = this.craftingPanel.querySelector('.success-chance');
        if (successElement) {
            successElement.textContent = `Success Chance: ${successChance}%`;
        }
    }
    calculateSuccessChance() {
        if (this.craftingItems.length < 5)
            return 0;
        if (this.craftingItems.length % 5 !== 0)
            return 0;
        const firstItem = this.craftingItems[0];
        if (!firstItem.rarity)
            return 0;
        const rarityIndex = petals_1.RARITY_LEVELS.indexOf(firstItem.rarity);
        if (rarityIndex === -1)
            return 0;
        // Base chance decreases as rarity increases
        const baseChance = 100 - (rarityIndex * 10);
        return Math.max(10, baseChance);
    }
    updateCraftingInventoryPreview() {
        if (!this.craftingPanel || !this.playerData)
            return;
        const inventoryGrid = this.craftingPanel.querySelector('.crafting-inventory-grid');
        if (!inventoryGrid)
            return;
        inventoryGrid.innerHTML = '';
        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        rarities.forEach(rarity => {
            const items = this.playerData?.inventory[rarity];
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
                            const isShiftClick = e.shiftKey;
                            this.handleCraftingItemClick(rarity, itemType, isShiftClick);
                        });
                        if (itemType.startsWith('petal_')) {
                            const petalType = itemType.replace('petal_', '');
                            const stats = (0, petals_1.getPetalStats)(petalType, rarity);
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
                        }
                        else {
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
    handleCraftingItemClick(rarity, type, isShiftClick) {
        const itemsFromStack = this.getItemCount(rarity, type);
        if (itemsFromStack === 0)
            return;
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
                    this.addItem(item.rarity, itemKey, 1);
                });
            }
        }
        let amountToAdd;
        if (isShiftClick) {
            amountToAdd = itemsFromStack;
        }
        else {
            amountToAdd = 5;
        }
        const actualAmountToAdd = Math.min(amountToAdd, this.getItemCount(rarity, type));
        if (actualAmountToAdd < 5) {
            alert('You need at least 5 items to add a batch.');
            return;
        }
        const batchesToAdd = Math.floor(actualAmountToAdd / 5);
        const totalItemsToAdd = batchesToAdd * 5;
        const item = {
            type: itemType,
            rarity: rarity,
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
    showCraftingSuccess(newItem, successCount) {
        if (!this.craftingPanel)
            return;
        const successDisplay = this.craftingPanel.querySelector('.crafting-success-display');
        if (!successDisplay)
            return;
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
            const stats = (0, petals_1.getPetalStats)(newItem.petalType, rarity);
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
        }
        else {
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
exports.titleScreenStyles = `
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
function injectTitleScreenStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = exports.titleScreenStyles;
    document.head.appendChild(styleElement);
}
