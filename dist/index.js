"use strict";
// ... (keep the existing imports and Player class)
Object.defineProperty(exports, "__esModule", { value: true });
const game_1 = require("./game");
const skinStudio_1 = require("./skinStudio");
const auth_ui_1 = require("./auth_ui");
const title_screen_1 = require("./title_screen");
const preloader_1 = require("./preloader");
const petals_1 = require("./petals");
const ws_client_1 = require("./ws_client");
const inventoryCodec_1 = require("./inventoryCodec");
const map_data_1 = require("./map_data");
let currentGame = null;
let preconnectedSocket = null; // Store preconnected socket
let isConnecting = false; // Flag to prevent multiple connection attempts
window.currentGame = currentGame;
let titleScreen = null;
window.titleScreen = titleScreen;
let preloadedAssets = null;
// Update loading screen progress
function updateLoadingProgress(progress) {
    // const progressBar = document.getElementById('progressBar');
    // const progressText = document.getElementById('progressText');
    // if (progressBar) {
    //     progressBar.style.width = `${progress}%`;
    // }
    // if (progressText) {
    //     progressText.textContent = `${Math.round(progress)}%`;
    // }
}
// Remove loading screen
function removeLoadingScreen() {
    const loadingScreen = document.getElementById('preloadScreen');
    if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        loadingScreen.style.transition = 'opacity 0.5s ease';
        setTimeout(() => {
            loadingScreen.remove();
        }, 500);
    }
}
const bootstrap = async () => {
    console.log('[Index] Starting application initialization...');
    try {
        // Create preloader
        const preloader = new preloader_1.Preloader((progress) => {
            updateLoadingProgress(progress);
        });
        // Load all assets
        console.log('[Index] Loading assets...');
        preloadedAssets = await preloader.loadAssets();
        console.log('[Index] Assets loaded successfully');
        window.preloadedAssets = preloadedAssets;
        //debug
        Object.defineProperty(window, 'petalConfig', {
            value: petals_1.PETAL_CONFIG,
            writable: false,
            configurable: false
        });
        // Small delay to show 100% completion
        await new Promise(resolve => setTimeout(resolve, 300));
        // Remove loading screen
        removeLoadingScreen();
        // Initialize title screen
        console.log('[Index] Initializing title screen...');
        (0, title_screen_1.injectTitleScreenStyles)();
        titleScreen = new title_screen_1.TitleScreen();
        window.titleScreen = titleScreen;
        await titleScreen.appendToBody();
        // Seed biome list from the bundled map so the selector is populated
        // before any server connection.
        titleScreen.updateBiomesFromMapData(map_data_1.WORLD_MAP);
        // Initialize auth UI after title screen is created
        window.authUI = new auth_ui_1.AuthUI();
        // Preconnect if user is already logged in (showing "logging in")
        // Use setTimeout to ensure titleScreen is fully initialized
        setTimeout(() => {
            if (localStorage.getItem('username')) {
                console.log('[Index] User is logged in, preconnecting to server...');
                preconnectToServer();
            }
        }, 100);
        // Set up game event listeners
        setupGameEventListeners();
        console.log('[Index] Application initialized successfully');
    }
    catch (error) {
        console.error('[Index] Error during initialization:', error);
        // Show error message
        const errorMsg = document.createElement('div');
        errorMsg.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255,0,0,0.9);
            color: white;
            padding: 20px;
            border-radius: 10px;
            z-index: 10001;
            text-align: center;
        `;
        errorMsg.innerHTML = `
            <h2>Loading Error</h2>
            <p>Failed to load game assets. Please refresh the page.</p>
            <button onclick="location.reload()" style="margin-top: 10px; padding: 10px 20px; cursor: pointer;">
                Reload
            </button>
        `;
        document.body.appendChild(errorMsg);
    }
};
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bootstrap(); });
}
else {
    bootstrap();
}
// Preconnect to server without authenticating/spawning
function preconnectToServer() {
    if (preconnectedSocket) {
        console.log('[Index] Socket already preconnected');
        return;
    }
    const serverIp = titleScreen?.getServerIP() || window.location.origin;
    const serverUrl = serverIp || window.location.origin;
    console.log(`[Index] Preconnecting to server: ${serverUrl}`);
    preconnectedSocket = (0, ws_client_1.io)(serverUrl, {
        secure: serverUrl.startsWith('https'),
        rejectUnauthorized: false,
        withCredentials: true,
        transports: ['websocket', 'polling'] // Explicitly set transports
    });
    attachTitleScreenSocketListeners(preconnectedSocket);
    window.preconnectedSocket = preconnectedSocket;
}
// Attaches the title-screen socket listeners. Shared between a freshly
// preconnected socket and a live in-game socket handed back when the player
// returns to the title screen (so the connection — and the player's loot — is
// reused rather than dropped and recreated under a new socket id).
function attachTitleScreenSocketListeners(sock) {
    sock.on('connect', () => {
        console.log(`[Index] Preconnected to server (socket ID: ${sock?.id})`);
        // Notify title screen that connection is complete
        if (titleScreen) {
            titleScreen.onConnectionComplete();
        }
    });
    sock.on('connect_error', (error) => {
        console.error('[Index] Preconnect connection error:', error);
    });
    // Map is bundled with the client via src/map_data.ts — no longer received
    // from the server. Seed the title screen biome list from the bundled map.
    if (titleScreen)
        titleScreen.updateBiomesFromMapData(map_data_1.WORLD_MAP);
    // Listen for authenticated event to update title screen inventory and skills
    sock.on('authenticated', (response) => {
        if (response.success && response.player && titleScreen) {
            console.log('[Index] Updating title screen with player data');
            // Mark socket as authenticated - this allows operations to proceed immediately
            const username = localStorage.getItem('username');
            if (username) {
                sock.username = username;
            }
            // Mark inventory manager as authenticated
            if (titleScreen.titleScreenInventoryManager) {
                titleScreen.titleScreenInventoryManager.isAuthenticated = true;
            }
            // Update title screen inventory manager with player data
            titleScreen.titleScreenInventoryManager?.updateFromPlayerData({
                inventory: response.player.inventory ? (0, inventoryCodec_1.dictToInventory)(response.player.inventory) : [],
                loadout: (() => { const a = response.player.loadout || []; const o = new Array(20).fill(null); for (let i = 0; i < Math.min(a.length, 20); i++)
                    o[i] = a[i] || null; return o; })(),
                tp: response.player.tp,
                skills: response.player.skills
            });
            // Update title screen skills manager if it exists
            if (titleScreen.titleScreenSkillsManager && response.player.tp !== undefined && response.player.skills) {
                titleScreen.titleScreenSkillsManager.updateSkills(response.player.tp || 0, response.player.skills || {});
            }
            // Also update skills data in inventory manager
            if (titleScreen.titleScreenInventoryManager) {
                titleScreen.titleScreenInventoryManager.updateSkillsData(response.player.tp || 0, response.player.skills || {});
            }
        }
    });
    // Listen for skills updates
    sock.on('skillsUpdated', (data) => {
        console.log('[Index] skillsUpdated received:', data);
        // Check if this is for the current player (compare socket ID)
        if (data.playerId === sock.id && titleScreen) {
            if (titleScreen.titleScreenSkillsManager) {
                titleScreen.titleScreenSkillsManager.updateSkills(data.tp, data.skills);
            }
            // Also update skills data in inventory manager
            if (titleScreen.titleScreenInventoryManager) {
                titleScreen.titleScreenInventoryManager.updateSkillsData(data.tp, data.skills);
            }
        }
    });
    sock.on('disconnect', (reason) => {
        console.log(`[Index] Preconnected socket disconnected: ${reason}`);
        preconnectedSocket = null;
        window.preconnectedSocket = null;
        window.preconnectedMapData = null;
    });
}
// Expose preconnectToServer so the title screen can trigger it after first login
window.preconnectToServer = preconnectToServer;
// Reuse a still-connected in-game socket for the title screen instead of
// disconnecting it. Keeps the same socket id, so the player is not counted as
// disconnected and their ground loot (eligibility keyed by socket id) survives.
window.reuseSocketForTitleScreen = (sock) => {
    if (!sock)
        return;
    preconnectedSocket = sock;
    window.preconnectedSocket = sock;
    attachTitleScreenSocketListeners(sock);
};
function setupGameEventListeners() {
    if (!titleScreen)
        return;
    // Handle multiplayer button click
    const multiPlayerButton = titleScreen.getMultiPlayerButton();
    if (multiPlayerButton) {
        multiPlayerButton.addEventListener('click', () => {
            // Prevent multiple clicks
            if (isConnecting || currentGame) {
                return;
            }
            isConnecting = true;
            // Remove any existing connectingDiv first
            const existingConnectingDiv = document.getElementById('connectingDiv');
            if (existingConnectingDiv) {
                existingConnectingDiv.remove();
            }
            const connectingDiv = document.createElement('div');
            connectingDiv.innerHTML = 'Connecting...';
            connectingDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0,0,0,0);
                color: white;
                padding: 20px;
                border-radius: 10px;
                z-index: 10001;
                text-align: center;
                -webkit-text-stroke: 2px black;
                font-size: 48px;
                font-weight: 700;
                font-family: Ubuntu, sans-serif;
                z-index: 20001;
            `;
            connectingDiv.id = 'connectingDiv';
            document.body.appendChild(connectingDiv);
            const showHitboxes = titleScreen?.getShowHitboxes() || false;
            const serverIp = titleScreen?.getServerIP() || window.location.origin;
            const showStats = titleScreen?.getShowStats() || false;
            const dynamicSkybox = titleScreen?.getDynamicSkybox() || false;
            currentGame = new game_1.Game(showHitboxes, serverIp, preloadedAssets, showStats, dynamicSkybox);
            window.currentGame = currentGame;
            // Set changelog and notifications managers on graphics
            if (titleScreen && currentGame.graphics) {
                const changelogManager = titleScreen.changelogManager;
                const notificationsManager = titleScreen.notificationsManager;
                if (changelogManager) {
                    currentGame.graphics.setChangelogManager(changelogManager);
                }
                if (notificationsManager) {
                    currentGame.graphics.setNotificationsManager(notificationsManager);
                }
                const leaderboardManager = titleScreen.leaderboardManager;
                if (leaderboardManager) {
                    currentGame.graphics.setLeaderboardManager(leaderboardManager);
                }
                const guildMenuManager = titleScreen.guildMenuManager;
                if (guildMenuManager) {
                    currentGame.graphics.setGuildMenuManager(guildMenuManager);
                    currentGame.guildMenu = guildMenuManager;
                    currentGame.connectGuildMenu?.(guildMenuManager);
                }
                // Point the Skin Studio canvas menu at the in-game canvas (the
                // singleton's socket is already connected in Game's constructor).
                currentGame.graphics.setSkinStudio?.((0, skinStudio_1.getSkinStudio)());
                // Hand the title-screen canvas-button strip to the in-game
                // graphics so the same icon buttons paint on the gameCanvas
                // and route their clicks through TitleScreen's handler.
                const canvasButtons = titleScreen.getCanvasButtons?.();
                if (canvasButtons) {
                    currentGame.graphics.setTitleCanvasButtons(canvasButtons);
                }
            }
            // Capture title screen screenshot for iris transition (also stored for exit animation)
            if (currentGame?.graphics) {
                const titleCanvas = document.getElementById('title-background-canvas');
                const screenshot = document.createElement('canvas');
                screenshot.width = window.innerWidth;
                screenshot.height = window.innerHeight;
                const sctx = screenshot.getContext('2d');
                if (titleCanvas)
                    sctx.drawImage(titleCanvas, 0, 0, screenshot.width, screenshot.height);
                currentGame.graphics.startIrisTransition(screenshot);
                currentGame.graphics.irisTitleScreen = true;
            }
            // Hide title screen and show game
            titleScreen?.hideTitleScreen();
            titleScreen?.showExitButton();
            // Reset connecting flag after a short delay
            setTimeout(() => {
                isConnecting = false;
                // Ensure connectingDiv is removed (backup)
                const connectingDiv = document.getElementById('connectingDiv');
                if (connectingDiv) {
                    connectingDiv.remove();
                }
            }, 1000);
        });
    }
    // Handle exit button click
    const exitButton = titleScreen.getExitButtonContainer().querySelector('#exitButton');
    if (exitButton) {
        exitButton.addEventListener('click', () => {
            if (!currentGame)
                return;
            titleScreen?.hideExitButton();
            // Briefly show title screen canvas to capture a fresh screenshot
            const titleCanvas = document.getElementById('title-background-canvas');
            if (titleCanvas)
                titleCanvas.style.display = 'block';
            titleScreen?.startBackgroundAnimation();
            titleScreen?.startCanvasRendering();
            // Wait a few frames for title screen canvases to fully render
            let framesWaited = 0;
            const waitForRender = () => {
                framesWaited++;
                if (framesWaited < 3) {
                    requestAnimationFrame(waitForRender);
                    return;
                }
                // Capture screenshot from the now-rendered title canvas
                const screenshot = document.createElement('canvas');
                screenshot.width = window.innerWidth;
                screenshot.height = window.innerHeight;
                const sctx = screenshot.getContext('2d');
                if (titleCanvas)
                    sctx.drawImage(titleCanvas, 0, 0, screenshot.width, screenshot.height);
                // Hide title screen canvas so only game canvas is visible during animation
                if (titleCanvas)
                    titleCanvas.style.display = 'none';
                titleScreen?.stopCanvasRendering();
                titleScreen?.stopBackgroundAnimation();
                // Ensure game canvas is visible (animateBackground may have hidden it)
                const gameCanvas = document.getElementById('gameCanvas');
                if (gameCanvas)
                    gameCanvas.style.display = 'block';
                // Start iris close animation
                currentGame.graphics.startIrisClose(screenshot, () => {
                    if (currentGame) {
                        currentGame.cleanup();
                        currentGame = null;
                        window.currentGame = null;
                    }
                    // Now fully show the title screen
                    titleScreen?.showTitleScreen();
                    // game.cleanup() now hands the still-connected socket back to the
                    // title screen via reuseSocketForTitleScreen (no disconnect), so
                    // preconnectedSocket normally already points at a live socket and we
                    // just re-authenticate to refresh the loadout/inventory. The reconnect
                    // path below is only a fallback for when the connection was actually
                    // lost (e.g. the socket dropped on its own).
                    if (!preconnectedSocket || !preconnectedSocket.connected) {
                        preconnectedSocket = null;
                        window.preconnectedSocket = null;
                        preconnectToServer();
                        // After the socket connects, re-authenticate through the title screen
                        // inventory manager so it refreshes player data via 'authenticated'.
                        const waitForConnect = () => {
                            if (preconnectedSocket && preconnectedSocket.connected) {
                                const inv = titleScreen?.titleScreenInventoryManager;
                                inv?.reauthenticate();
                            }
                            else {
                                setTimeout(waitForConnect, 100);
                            }
                        };
                        setTimeout(waitForConnect, 100);
                    }
                    else {
                        // Socket already connected — just trigger a refresh
                        const inv = titleScreen?.titleScreenInventoryManager;
                        inv?.reauthenticate();
                    }
                    // Reset connecting flag so user can rejoin
                    isConnecting = false;
                });
                currentGame.graphics.irisTitleScreen = true;
            };
            requestAnimationFrame(waitForRender);
        });
    }
}
// Add this at the top of index.ts, before the Game class
