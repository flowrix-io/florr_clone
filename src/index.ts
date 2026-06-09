// ... (keep the existing imports and Player class)

import { Game } from './game';
import { AuthUI } from './auth_ui';
import { TitleScreen, injectTitleScreenStyles } from './title_screen';
import { Preloader, PreloadedAssets } from './preloader';
import { PETAL_CONFIG } from './petals';
import { io } from './ws_client';
import { dictToInventory } from './inventoryCodec';
import { WORLD_MAP } from './map_data';

let currentGame: Game | null = null;
let preconnectedSocket: any = null; // Store preconnected socket
let isConnecting = false; // Flag to prevent multiple connection attempts

// Make currentGame globally accessible
declare global {
    interface Window {
        currentGame: Game | null;
        titleScreen: TitleScreen | null;
        preconnectedSocket?: any;
        preconnectedMapData?: any;
    }
}

window.currentGame = currentGame;
let titleScreen: TitleScreen | null = null;
window.titleScreen = titleScreen;
let preloadedAssets: PreloadedAssets | null = null;

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

const bootstrap = async () => {
    console.log('[Index] Starting application initialization...');

    try {
        // Create preloader
        const preloader = new Preloader((progress) => {
            updateLoadingProgress(progress);
        });
        
        // Load all assets
        console.log('[Index] Loading assets...');
        preloadedAssets = await preloader.loadAssets();
        console.log('[Index] Assets loaded successfully');
        (window as any).preloadedAssets = preloadedAssets;

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
        window.titleScreen = titleScreen;
        await titleScreen.appendToBody();
        // Seed biome list from the bundled map so the selector is populated
        // before any server connection.
        titleScreen.updateBiomesFromMapData(WORLD_MAP);
        
        // Initialize auth UI after title screen is created
        new AuthUI();
        
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bootstrap(); });
} else {
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
    
    preconnectedSocket = io(serverUrl, {
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
function attachTitleScreenSocketListeners(sock: any) {
    sock.on('connect', () => {
        console.log(`[Index] Preconnected to server (socket ID: ${sock?.id})`);
        // Notify title screen that connection is complete
        if (titleScreen) {
            titleScreen.onConnectionComplete();
        }
    });

    sock.on('connect_error', (error: Error) => {
        console.error('[Index] Preconnect connection error:', error);
    });

    // Map is bundled with the client via src/map_data.ts — no longer received
    // from the server. Seed the title screen biome list from the bundled map.
    if (titleScreen) titleScreen.updateBiomesFromMapData(WORLD_MAP);

    // Listen for authenticated event to update title screen inventory and skills
    sock.on('authenticated', (response: { success: boolean; error?: string; player?: any }) => {
        if (response.success && response.player && titleScreen) {
            console.log('[Index] Updating title screen with player data');

            // Mark socket as authenticated - this allows operations to proceed immediately
            const username = localStorage.getItem('username');
            if (username) {
                (sock as any).username = username;
            }

            // Mark inventory manager as authenticated
            if ((titleScreen as any).titleScreenInventoryManager) {
                (titleScreen as any).titleScreenInventoryManager.isAuthenticated = true;
            }

            // Update title screen inventory manager with player data
            (titleScreen as any).titleScreenInventoryManager?.updateFromPlayerData({
                inventory: response.player.inventory ? dictToInventory(response.player.inventory) : [],
                loadout: (() => { const a = response.player.loadout || []; const o: any[] = new Array(20).fill(null); for (let i = 0; i < Math.min(a.length, 20); i++) o[i] = a[i] || null; return o; })(),
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
    sock.on('skillsUpdated', (data: { playerId: string; tp: number; skills: { [key: string]: string } }) => {
        console.log('[Index] skillsUpdated received:', data);
        // Check if this is for the current player (compare socket ID)
        if (data.playerId === sock.id && titleScreen) {
            if ((titleScreen as any).titleScreenSkillsManager) {
                (titleScreen as any).titleScreenSkillsManager.updateSkills(data.tp, data.skills);
            }
            // Also update skills data in inventory manager
            if ((titleScreen as any).titleScreenInventoryManager) {
                (titleScreen as any).titleScreenInventoryManager.updateSkillsData(data.tp, data.skills);
            }
        }
    });

    sock.on('disconnect', (reason: string) => {
        console.log(`[Index] Preconnected socket disconnected: ${reason}`);
        preconnectedSocket = null;
        window.preconnectedSocket = null;
        window.preconnectedMapData = null;
    });
}

// Expose preconnectToServer so the title screen can trigger it after first login
(window as any).preconnectToServer = preconnectToServer;

// Reuse a still-connected in-game socket for the title screen instead of
// disconnecting it. Keeps the same socket id, so the player is not counted as
// disconnected and their ground loot (eligibility keyed by socket id) survives.
(window as any).reuseSocketForTitleScreen = (sock: any) => {
    if (!sock) return;
    preconnectedSocket = sock;
    window.preconnectedSocket = sock;
    attachTitleScreenSocketListeners(sock);
};

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
            const showStats = titleScreen?.getShowStats() || false;
            const dynamicSkybox = titleScreen?.getDynamicSkybox() || false;

            currentGame = new Game(showHitboxes, serverIp, preloadedAssets, showStats, dynamicSkybox);
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
                const guildMenuManager = (titleScreen as any).guildMenuManager;
                if (guildMenuManager) {
                    currentGame.graphics.setGuildMenuManager(guildMenuManager);
                    currentGame.guildMenu = guildMenuManager;
                    currentGame.connectGuildMenu?.(guildMenuManager);
                }
                // Hand the title-screen canvas-button strip to the in-game
                // graphics so the same icon buttons paint on the gameCanvas
                // and route their clicks through TitleScreen's handler.
                const canvasButtons = (titleScreen as any).getCanvasButtons?.();
                if (canvasButtons) {
                    currentGame.graphics.setTitleCanvasButtons(canvasButtons);
                }
            }
            
            // Capture title screen screenshot for iris transition (also stored for exit animation)
            if (currentGame?.graphics) {
                const titleCanvas = document.getElementById('title-background-canvas') as HTMLCanvasElement | null;
                const screenshot = document.createElement('canvas');
                screenshot.width = window.innerWidth;
                screenshot.height = window.innerHeight;
                const sctx = screenshot.getContext('2d')!;
                if (titleCanvas) sctx.drawImage(titleCanvas, 0, 0, screenshot.width, screenshot.height);
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

            // Briefly show title screen canvas to capture a fresh screenshot
            const titleCanvas = document.getElementById('title-background-canvas') as HTMLCanvasElement | null;
            if (titleCanvas) titleCanvas.style.display = 'block';
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

                // Capture screenshot from the now-rendered title canvas
                const screenshot = document.createElement('canvas');
                screenshot.width = window.innerWidth;
                screenshot.height = window.innerHeight;
                const sctx = screenshot.getContext('2d')!;
                if (titleCanvas) sctx.drawImage(titleCanvas, 0, 0, screenshot.width, screenshot.height);

                // Hide title screen canvas so only game canvas is visible during animation
                if (titleCanvas) titleCanvas.style.display = 'none';
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

                    // game.cleanup() now hands the still-connected socket back to the
                    // title screen via reuseSocketForTitleScreen (no disconnect), so
                    // preconnectedSocket normally already points at a live socket and we
                    // just re-authenticate to refresh the loadout/inventory. The reconnect
                    // path below is only a fallback for when the connection was actually
                    // lost (e.g. the socket dropped on its own).
                    if (!preconnectedSocket || !(preconnectedSocket as any).connected) {
                        preconnectedSocket = null;
                        window.preconnectedSocket = null;
                        preconnectToServer();
                        // After the socket connects, re-authenticate through the title screen
                        // inventory manager so it refreshes player data via 'authenticated'.
                        const waitForConnect = () => {
                            if (preconnectedSocket && (preconnectedSocket as any).connected) {
                                const inv = (titleScreen as any)?.titleScreenInventoryManager;
                                inv?.reauthenticate();
                            } else {
                                setTimeout(waitForConnect, 100);
                            }
                        };
                        setTimeout(waitForConnect, 100);
                    } else {
                        // Socket already connected — just trigger a refresh
                        const inv = (titleScreen as any)?.titleScreenInventoryManager;
                        inv?.reauthenticate();
                    }

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

