"use strict";
// ... (keep the existing imports and Player class)
Object.defineProperty(exports, "__esModule", { value: true });
const game_1 = require("./game");
const auth_ui_1 = require("./auth_ui");
const title_screen_1 = require("./title_screen");
const preloader_1 = require("./preloader");
const petals_1 = require("./petals");
const shaderManager_1 = require("./shader/shaderManager");
const socket_io_client_1 = require("socket.io-client");
let currentGame = null;
let preconnectedSocket = null; // Store preconnected socket
let preconnectedMapData = null; // Store map data received during preconnect
let isConnecting = false; // Flag to prevent multiple connection attempts
window.currentGame = currentGame;
let titleScreen = null;
window.titleScreen = titleScreen;
let authUI = null;
let preloadedAssets = null;
let shaderManager = null;
// Create and show loading screen
function createLoadingScreen() {
    const loadingScreen = document.createElement('div');
    loadingScreen.id = 'preloadScreen';
    loadingScreen.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #00d885 0%, #02c278 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: Ubuntu, sans-serif;
    `;
    loadingScreen.innerHTML = `
        <div style="text-align: center;">
            <h1 style="color: white; font-size: 48px; margin-bottom: 20px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
                florr.io clone
            </h1>
            <p style="color: rgba(255,255,255,0.9); font-size: 20px; margin-bottom: 30px;">
                Loading assets...
            </p>
            <div style="width: 300px; height: 30px; background: rgba(255,255,255,0.3); border-radius: 15px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.2);">
                <div id="progressBar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%); transition: width 0.3s ease; border-radius: 15px;"></div>
            </div>
            <p id="progressText" style="color: white; font-size: 16px; margin-top: 15px;">0%</p>
            <div style="margin-top: 30px; color: rgba(255,255,255,0.7); font-size: 14px;">
                <p>Loading sprites, textures, and game systems...</p>
            </div>
        </div>
    `;
    // document.body.appendChild(loadingScreen);
    return loadingScreen;
}
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
window.onload = async () => {
    console.log('[Index] Starting application initialization...');
    // Show loading screen
    const loadingScreen = createLoadingScreen();
    try {
        // Create preloader
        const preloader = new preloader_1.Preloader((progress) => {
            updateLoadingProgress(progress);
        });
        // Load all assets
        console.log('[Index] Loading assets...');
        preloadedAssets = await preloader.loadAssets();
        console.log('[Index] Assets loaded successfully');
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
        // Initialize shader manager
        console.log('[Index] Initializing shader manager...');
        shaderManager = new shaderManager_1.ShaderManager();
        window.shaderManager = shaderManager;
        // Initialize title screen
        console.log('[Index] Initializing title screen...');
        (0, title_screen_1.injectTitleScreenStyles)();
        titleScreen = new title_screen_1.TitleScreen();
        window.titleScreen = titleScreen;
        await titleScreen.appendToBody();
        // Initialize auth UI after title screen is created
        authUI = new auth_ui_1.AuthUI();
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
// Preconnect to server without authenticating/spawning
function preconnectToServer() {
    if (preconnectedSocket) {
        console.log('[Index] Socket already preconnected');
        return;
    }
    const serverIp = titleScreen?.getServerIP() || window.location.origin;
    const serverUrl = serverIp || window.location.origin;
    console.log(`[Index] Preconnecting to server: ${serverUrl}`);
    preconnectedSocket = (0, socket_io_client_1.io)(serverUrl, {
        secure: serverUrl.startsWith('https'),
        rejectUnauthorized: false,
        withCredentials: true,
        transports: ['websocket', 'polling'] // Explicitly set transports
    });
    preconnectedSocket.on('connect', () => {
        console.log(`[Index] Preconnected to server (socket ID: ${preconnectedSocket?.id})`);
    });
    preconnectedSocket.on('connect_error', (error) => {
        console.error('[Index] Preconnect connection error:', error);
    });
    // Store map data if received during preconnect
    preconnectedSocket.on('mapData', (mapData) => {
        console.log('[Index] Received map data during preconnect');
        preconnectedMapData = mapData;
        window.preconnectedMapData = mapData;
        // Update title screen biomes if available
        if (titleScreen) {
            titleScreen.updateBiomesFromMapData(mapData);
        }
    });
    preconnectedSocket.on('disconnect', (reason) => {
        console.log(`[Index] Preconnected socket disconnected: ${reason}`);
        preconnectedSocket = null;
        preconnectedMapData = null;
        window.preconnectedSocket = null;
        window.preconnectedMapData = null;
    });
    window.preconnectedSocket = preconnectedSocket;
}
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
            const shadersEnabled = titleScreen?.getShadersEnabled() || false;
            const showStats = titleScreen?.getShowStats() || false;
            currentGame = new game_1.Game(showHitboxes, serverIp, preloadedAssets, shadersEnabled, showStats);
            window.currentGame = currentGame;
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
            if (currentGame) {
                currentGame.cleanup();
                currentGame = null;
                window.currentGame = null;
            }
            // Show title screen and hide game
            titleScreen?.showTitleScreen();
            titleScreen?.hideExitButton();
        });
    }
}
// Add this at the top of index.ts, before the Game class
