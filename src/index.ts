// ... (keep the existing imports and Player class)

import { Game } from './game';
import { AuthUI } from './auth_ui';
import { TitleScreen, injectTitleScreenStyles } from './title_screen';
import { Preloader, PreloadedAssets } from './preloader';
import { PETAL_CONFIG } from './petals';
import { ShaderManager } from './shader/shaderManager';
import { io } from './ws_client';
import { dictToInventory } from './inventoryCodec';

// Add interfaces before the workerCode string
interface Decoration {
    x: number;
    y: number;
    scale: number;  // For random sizes
}

let currentGame: Game | null = null;
let preconnectedSocket: any = null; // Store preconnected socket
let preconnectedMapData: any = null; // Store map data received during preconnect
let isConnecting = false; // Flag to prevent multiple connection attempts

// Make currentGame globally accessible
declare global {
    interface Window {
        currentGame: Game | null;
        titleScreen: TitleScreen | null;
        shaderManager?: ShaderManager | null;
        preconnectedSocket?: any;
        preconnectedMapData?: any;
    }
}

window.currentGame = currentGame;
let titleScreen: TitleScreen | null = null;
window.titleScreen = titleScreen;
let authUI: AuthUI | null = null;
let preloadedAssets: PreloadedAssets | null = null;
let shaderManager: ShaderManager | null = null;

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
        
        // Initialize shader manager
        console.log('[Index] Initializing shader manager...');
        shaderManager = new ShaderManager();
        window.shaderManager = shaderManager;
        
        // Initialize title screen
        console.log('[Index] Initializing title screen...');
        injectTitleScreenStyles();
        titleScreen = new TitleScreen();
        window.titleScreen = titleScreen;
        await titleScreen.appendToBody();
        
        // Initialize auth UI after title screen is created
        authUI = new AuthUI();
        
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

// Preconnect to server without authenticating/spawning
function preconnectToServer() {
    if (preconnectedSocket) {
        console.log('[Index] Socket already preconnected');
        return;
    }
    
    const serverIp = titleScreen?.getServerIP() || window.location.origin;
    const serverUrl = serverIp || window.location.origin;
    
    console.log(`[Index] Preconnecting to server: ${serverUrl}`);
    
    preconnectedSocket = io(serverUrl, {
        secure: serverUrl.startsWith('https'),
        rejectUnauthorized: false,
        withCredentials: true,
        transports: ['websocket', 'polling'] // Explicitly set transports
    });
    
    preconnectedSocket.on('connect', () => {
        console.log(`[Index] Preconnected to server (socket ID: ${preconnectedSocket?.id})`);
        // Notify title screen that connection is complete
        if (titleScreen) {
            titleScreen.onConnectionComplete();
        }
    });
    
    preconnectedSocket.on('connect_error', (error: Error) => {
        console.error('[Index] Preconnect connection error:', error);
    });
    
    // Store map data if received during preconnect
    preconnectedSocket.on('mapData', (mapData: any) => {
        console.log('[Index] Received map data during preconnect');
        preconnectedMapData = mapData;
        window.preconnectedMapData = mapData;
        // Update title screen biomes if available
        if (titleScreen) {
            // Handle MapData format (with elements property) or legacy array format
            const elements = mapData.elements || mapData;
            titleScreen.updateBiomesFromMapData(elements);
        }
    });

    // Listen for authenticated event to update title screen inventory and skills
    preconnectedSocket.on('authenticated', (response: { success: boolean; error?: string; player?: any }) => {
        if (response.success && response.player && titleScreen) {
            console.log('[Index] Updating title screen with player data');
            
            // Mark socket as authenticated - this allows operations to proceed immediately
            const username = localStorage.getItem('username');
            if (username) {
                (preconnectedSocket as any).username = username;
            }
            
            // Mark inventory manager as authenticated
            if ((titleScreen as any).titleScreenInventoryManager) {
                (titleScreen as any).titleScreenInventoryManager.isAuthenticated = true;
            }
            
            // Update title screen inventory manager with player data
            (titleScreen as any).titleScreenInventoryManager?.updateFromPlayerData({
                inventory: response.player.inventory ? dictToInventory(response.player.inventory) : [],
                loadout: response.player.loadout || Array(10).fill(null),
                tp: response.player.tp,
                skills: response.player.skills
            });
            
            // Update title screen skills manager if it exists
            if ((titleScreen as any).titleScreenSkillsManager && response.player.tp !== undefined && response.player.skills) {
                (titleScreen as any).titleScreenSkillsManager.updateSkills(
                    response.player.tp || 0,
                    response.player.skills || {}
                );
            }
            
            // Also update skills data in inventory manager
            if ((titleScreen as any).titleScreenInventoryManager) {
                (titleScreen as any).titleScreenInventoryManager.updateSkillsData(
                    response.player.tp || 0,
                    response.player.skills || {}
                );
            }
        }
    });

    // Listen for skills updates
    preconnectedSocket.on('skillsUpdated', (data: { playerId: string; tp: number; skills: { [key: string]: string } }) => {
        console.log('[Index] skillsUpdated received:', data);
        // Check if this is for the current player (compare socket ID)
        if (data.playerId === preconnectedSocket.id && titleScreen) {
            if ((titleScreen as any).titleScreenSkillsManager) {
                (titleScreen as any).titleScreenSkillsManager.updateSkills(data.tp, data.skills);
            }
            // Also update skills data in inventory manager
            if ((titleScreen as any).titleScreenInventoryManager) {
                (titleScreen as any).titleScreenInventoryManager.updateSkillsData(data.tp, data.skills);
            }
        }
    });
    
    preconnectedSocket.on('disconnect', (reason: string) => {
        console.log(`[Index] Preconnected socket disconnected: ${reason}`);
        preconnectedSocket = null;
        preconnectedMapData = null;
        window.preconnectedSocket = null;
        window.preconnectedMapData = null;
    });
    
    window.preconnectedSocket = preconnectedSocket;
}

function setupGameEventListeners() {
    if (!titleScreen) return;
    
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
            const dynamicSkybox = titleScreen?.getDynamicSkybox() || false;
            
            currentGame = new Game(showHitboxes, serverIp, preloadedAssets, shadersEnabled, showStats, dynamicSkybox);
            window.currentGame = currentGame;
            
            // Set changelog and notifications managers on graphics
            if (titleScreen && currentGame.graphics) {
                const changelogManager = (titleScreen as any).changelogManager;
                const notificationsManager = (titleScreen as any).notificationsManager;
                if (changelogManager) {
                    currentGame.graphics.setChangelogManager(changelogManager);
                }
                if (notificationsManager) {
                    currentGame.graphics.setNotificationsManager(notificationsManager);
                }
                const leaderboardManager = (titleScreen as any).leaderboardManager;
                if (leaderboardManager) {
                    currentGame.graphics.setLeaderboardManager(leaderboardManager);
                }
            }
            
            // Capture title screen screenshot for iris transition (also stored for exit animation)
            if (currentGame?.graphics) {
                const bgCanvas = document.getElementById('title-background-canvas') as HTMLCanvasElement | null;
                const uiCanvas = document.getElementById('title-ui-canvas') as HTMLCanvasElement | null;
                const screenshot = document.createElement('canvas');
                screenshot.width = window.innerWidth;
                screenshot.height = window.innerHeight;
                const sctx = screenshot.getContext('2d')!;
                if (bgCanvas) sctx.drawImage(bgCanvas, 0, 0, screenshot.width, screenshot.height);
                if (uiCanvas) sctx.drawImage(uiCanvas, 0, 0, screenshot.width, screenshot.height);
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
            if (!currentGame) return;

            titleScreen?.hideExitButton();

            // Briefly show title screen canvases to capture a fresh screenshot
            const bgCanvas = document.getElementById('title-background-canvas') as HTMLCanvasElement | null;
            const uiCanvas = document.getElementById('title-ui-canvas') as HTMLCanvasElement | null;
            if (bgCanvas) bgCanvas.style.display = 'block';
            if (uiCanvas) uiCanvas.style.display = 'block';
            titleScreen?.startBackgroundAnimation();
            (titleScreen as any)?.startCanvasRendering();

            // Wait a few frames for title screen canvases to fully render
            let framesWaited = 0;
            const waitForRender = () => {
                framesWaited++;
                if (framesWaited < 3) {
                    requestAnimationFrame(waitForRender);
                    return;
                }

                // Capture screenshot from the now-rendered canvases
                const screenshot = document.createElement('canvas');
                screenshot.width = window.innerWidth;
                screenshot.height = window.innerHeight;
                const sctx = screenshot.getContext('2d')!;
                if (bgCanvas) sctx.drawImage(bgCanvas, 0, 0, screenshot.width, screenshot.height);
                if (uiCanvas) sctx.drawImage(uiCanvas, 0, 0, screenshot.width, screenshot.height);

                // Hide title screen canvases so only game canvas is visible during animation
                if (bgCanvas) bgCanvas.style.display = 'none';
                if (uiCanvas) uiCanvas.style.display = 'none';
                (titleScreen as any)?.stopCanvasRendering();
                titleScreen?.stopBackgroundAnimation();

                // Ensure game canvas is visible (animateBackground may have hidden it)
                const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
                if (gameCanvas) gameCanvas.style.display = 'block';

                // Start iris close animation
                currentGame!.graphics.startIrisClose(screenshot, () => {
                    if (currentGame) {
                        currentGame.cleanup();
                        currentGame = null;
                        window.currentGame = null;
                    }

                    // Now fully show the title screen
                    titleScreen?.showTitleScreen();

                    // Reset connecting flag so user can rejoin
                    isConnecting = false;
                });
                currentGame!.graphics.irisTitleScreen = true;
            };
            requestAnimationFrame(waitForRender);
        });
    }
}

// Add this at the top of index.ts, before the Game class

