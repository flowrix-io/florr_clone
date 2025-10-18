// ... (keep the existing imports and Player class)

import { Game } from './game';
import { AuthUI } from './auth_ui';
import { TitleScreen, injectTitleScreenStyles } from './title_screen';
import { Preloader, PreloadedAssets } from './preloader';
import { PETAL_CONFIG } from './petals';

// Add interfaces before the workerCode string
interface Decoration {
    x: number;
    y: number;
    scale: number;  // For random sizes
}

let currentGame: Game | null = null;

// Make currentGame globally accessible
declare global {
    interface Window {
        currentGame: Game | null;
    }
}

window.currentGame = currentGame;
let titleScreen: TitleScreen | null = null;
let authUI: AuthUI | null = null;
let preloadedAssets: PreloadedAssets | null = null;

// Create and show loading screen
function createLoadingScreen(): HTMLDivElement {
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
function updateLoadingProgress(progress: number) {
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
        const preloader = new Preloader((progress) => {
            updateLoadingProgress(progress);
        });
        
        // Load all assets
        console.log('[Index] Loading assets...');
        preloadedAssets = await preloader.loadAssets();
        console.log('[Index] Assets loaded successfully');

        //debug
        Object.defineProperty(window, 'petalConfig', {
            value: PETAL_CONFIG,
            writable: false,
            configurable: false
        });
        
        // Small delay to show 100% completion
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Remove loading screen
        removeLoadingScreen();
        
        // Initialize title screen
        console.log('[Index] Initializing title screen...');
        injectTitleScreenStyles();
        titleScreen = new TitleScreen();
        await titleScreen.appendToBody();
        
        // Initialize auth UI after title screen is created
        authUI = new AuthUI();
        
        // Set up game event listeners
        setupGameEventListeners();
        
        console.log('[Index] Application initialized successfully');
    } catch (error) {
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

function setupGameEventListeners() {
    if (!titleScreen) return;
    
    // Handle multiplayer button click
    const multiPlayerButton = titleScreen.getMultiPlayerButton();
    if (multiPlayerButton) {
        multiPlayerButton.addEventListener('click', () => {
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
            if (currentGame) {
                // Cleanup previous game
                currentGame.cleanup();
            }
            const showHitboxes = titleScreen?.getShowHitboxes() || false;
            const serverIp = titleScreen?.getServerIP() || window.location.origin;
            currentGame = new Game(showHitboxes, serverIp, preloadedAssets);
            window.currentGame = currentGame;
            
            // Hide title screen and show game
            titleScreen?.hideTitleScreen();
            titleScreen?.showExitButton();
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

