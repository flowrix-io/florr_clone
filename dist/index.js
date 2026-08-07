"use strict";
// ... (keep the existing imports and Player class)
Object.defineProperty(exports, "__esModule", { value: true });
const game_1 = require("./game");
const skinStudio_1 = require("./skinStudio");
const title_screen_1 = require("./title_screen");
const preloader_1 = require("./preloader");
const ws_client_1 = require("./ws_client");
const inventoryCodec_1 = require("./inventoryCodec");
const map_data_1 = require("./map_data");
const maze_1 = require("./maze");
const app_shell_1 = require("./app_shell");
const app_refs_1 = require("./app_refs");
const preconnect_1 = require("./net/preconnect");
const dev_expose_1 = require("./dev_expose");
const auth_session_1 = require("./auth_session");
// Build today's maze immediately from the local clock. The server's
// authoritative 'mazeInfo' (sent at socket connection and on daily rotation)
// overrides this if the days ever disagree, but the local fallback guarantees
// the maze exists client-side even if that early message arrives before any
// listener is attached — otherwise maze walls would render (and predict) as
// empty space.
(0, maze_1.setActiveMazeDay)((0, maze_1.getCurrentMazeDay)());
let isConnecting = false; // Flag to prevent multiple connection attempts
// The client's singletons (Game, TitleScreen, the preconnected socket, the
// preloaded assets) live in module scope — app_refs.ts, net/preconnect.ts and
// preloader.ts — deliberately not on `window`. Development builds re-expose
// read-only getters for them; see dev_expose.ts.
let titleScreen = null;
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
    // Before anything else touches storage: wipe the plaintext credentials
    // older builds saved, trading the stored password for a session token.
    // Fire-and-forget — nothing below depends on it, and the socket falls back
    // to the legacy pair for this one page load if the trade is still in flight.
    void (0, auth_session_1.migrateLegacyCredentials)();
    try {
        // Create preloader
        const preloader = new preloader_1.Preloader((progress) => {
            updateLoadingProgress(progress);
        });
        // Load all assets
        console.log('[Index] Loading assets...');
        const preloadedAssets = await preloader.loadAssets();
        console.log('[Index] Assets loaded successfully');
        (0, preloader_1.setPreloadedAssets)(preloadedAssets);
        // Debug handles on window (currentGame, titleScreen, petalConfig, …).
        // No-op — and removed by the minifier — in a production build.
        (0, dev_expose_1.exposeDevGlobals)();
        // Small delay to show 100% completion
        await new Promise(resolve => setTimeout(resolve, 300));
        // Remove loading screen
        removeLoadingScreen();
        // Initialize title screen
        console.log('[Index] Initializing title screen...');
        (0, title_screen_1.injectTitleScreenStyles)();
        titleScreen = new title_screen_1.TitleScreen();
        (0, app_refs_1.setTitleScreen)(titleScreen);
        await titleScreen.appendToBody();
        // Seed biome list from the bundled map so the selector is populated
        // before any server connection.
        titleScreen.updateBiomesFromMapData(map_data_1.WORLD_MAP);
        // Preconnect if user is already logged in (showing "logging in")
        // Use setTimeout to ensure titleScreen is fully initialized
        setTimeout(() => {
            if ((0, auth_session_1.isLoggedIn)()) {
                console.log('[Index] User is logged in, preconnecting to server...');
                preconnectToServer();
            }
        }, 100);
        // Set up game event listeners
        setupGameEventListeners();
        registerGameScene();
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
    if ((0, preconnect_1.getPreconnectedSocket)()) {
        console.log('[Index] Socket already preconnected');
        return;
    }
    const serverIp = titleScreen?.getServerIP() || window.location.origin;
    const serverUrl = serverIp || window.location.origin;
    console.log(`[Index] Preconnecting to server: ${serverUrl}`);
    const sock = (0, ws_client_1.io)(serverUrl);
    (0, preconnect_1.setPreconnectedSocket)(sock);
    attachTitleScreenSocketListeners(sock);
}
// Attaches the title-screen socket listeners. Shared between a freshly
// preconnected socket and a live in-game socket handed back when the player
// returns to the title screen (so the connection — and the player's loot — is
// reused rather than dropped and recreated under a new socket id).
function attachTitleScreenSocketListeners(sock) {
    // Daily maze descriptor — keeps the locally-generated maze in sync with
    // the server (matters across the UTC day boundary / client clock skew).
    sock.on('mazeInfo', (data) => {
        if (typeof data?.day === 'number')
            (0, maze_1.setActiveMazeDay)(data.day);
    });
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
        (0, preconnect_1.setPreconnectedSocket)(null);
    });
}
// The title screen (after first login) and the Game (on exit) both need to
// reach back into this module. Registering the two entry points here — rather
// than importing index.ts from either — keeps the entry module free of inbound
// imports, which is what the window function-handles used to buy.
(0, preconnect_1.setPreconnectHooks)({
    preconnect: preconnectToServer,
    // Reuse a still-connected in-game socket for the title screen instead of
    // disconnecting it. Keeps the same socket id, so the player is not counted
    // as disconnected and their ground loot (eligibility keyed by socket id)
    // survives.
    reuseSocketForTitleScreen: (sock) => {
        if (!sock)
            return;
        (0, preconnect_1.setPreconnectedSocket)(sock);
        attachTitleScreenSocketListeners(sock);
        // The Game stripped every handler off this socket on its way out, so the
        // inventory manager's own listeners (craftingFinished, playerUpdated, ...)
        // have to be re-installed too — without them a title-screen craft never
        // gets its result back and the panel spins forever.
        titleScreen?.titleScreenInventoryManager?.rebindSocketListeners(sock);
    },
});
function setupGameEventListeners() {
    if (!titleScreen)
        return;
    // Handle multiplayer button click
    const multiPlayerButton = titleScreen.getMultiPlayerButton();
    if (multiPlayerButton) {
        multiPlayerButton.addEventListener('click', () => {
            // Prevent multiple clicks
            if (isConnecting || (0, app_refs_1.getCurrentGame)()) {
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
            // Hand over to the game scene. The shell snapshots the title screen
            // first, then runs `prepare` (which builds the Game and, in doing
            // so, resizes and clears the shared canvas), then commits and plays
            // the wipe: the world irises in through the frozen title screen,
            // held fully covered until the game reports readyToReveal().
            app_shell_1.appShell.switchTo('game', {
                prepare: () => {
                    const game = new game_1.Game(showHitboxes, serverIp, (0, preloader_1.getPreloadedAssets)(), showStats, dynamicSkybox);
                    // A plain module-scoped reference for other modules to
                    // reach the running game (the Game constructor already
                    // registers it; this is just explicit). It is NOT what
                    // decides who renders — the shell's mode is.
                    (0, app_refs_1.setCurrentGame)(game);
                    // Hand the shared panel managers to Graphics so they get
                    // drawn in the game's render pass.
                    if (!titleScreen || !game.graphics)
                        return;
                    const g = game.graphics;
                    const ts = titleScreen;
                    if (ts.changelogManager)
                        g.setChangelogManager(ts.changelogManager);
                    if (ts.notificationsManager)
                        g.setNotificationsManager(ts.notificationsManager);
                    if (ts.leaderboardManager)
                        g.setLeaderboardManager(ts.leaderboardManager);
                    if (ts.guildMenuManager) {
                        g.setGuildMenuManager(ts.guildMenuManager);
                        game.guildMenu = ts.guildMenuManager;
                        game.connectGuildMenu?.(ts.guildMenuManager);
                    }
                    g.setSkinStudio?.((0, skinStudio_1.getSkinStudio)());
                    // The icon-button strip is the title screen's widget; the
                    // game just paints it. Its input stays on the title
                    // screen's own canvas listeners — same canvas, so no
                    // second binding.
                    const canvasButtons = ts.getCanvasButtons?.();
                    if (canvasButtons)
                        g.setTitleCanvasButtons(canvasButtons);
                },
                onDone: () => {
                    isConnecting = false;
                    document.getElementById('connectingDiv')?.remove();
                },
            });
        });
    }
    // Handle exit button click. All this does is ask the shell to change
    // scenes; the teardown, the reveal and the reconnect all hang off the
    // scene hooks in registerGameScene() so there is exactly one exit path
    // whether the click came from this button, the death screen or ENTER.
    const exitButton = titleScreen.getExitButtonContainer().querySelector('#exitButton');
    if (exitButton) {
        exitButton.addEventListener('click', () => {
            if (!(0, app_refs_1.getCurrentGame)() || app_shell_1.appShell.isTransitioning())
                return;
            titleScreen?.hideExitButton();
            app_shell_1.appShell.switchTo('title');
        });
    }
}
/**
 * Registers the game scene once, at boot. The shell calls these hooks from
 * inside its loop while the transition is fully closed, so the handover cannot
 * be half-applied: whatever else happens, a scene change always runs exactly
 * this teardown and this setup.
 */
function registerGameScene() {
    app_shell_1.appShell.registerScene('game', {
        frame: () => (0, app_refs_1.getCurrentGame)()?.frame(),
        readyToReveal: () => (0, app_refs_1.getCurrentGame)()?.readyToReveal() ?? true,
        onFrameError: (error) => (0, app_refs_1.getCurrentGame)()?.onFrameError(error),
        onEnter: () => {
            titleScreen?.hideTitleScreen();
            titleScreen?.showExitButton();
        },
        onExit: () => {
            (0, app_refs_1.getCurrentGame)()?.cleanup();
            (0, app_refs_1.setCurrentGame)(null);
            isConnecting = false;
            // cleanup() hands the still-connected socket back to the title
            // screen via reuseSocketForTitleScreen (no disconnect), so
            // preconnectedSocket normally already points at a live socket and
            // we just re-authenticate to refresh the loadout/inventory. The
            // reconnect path below is only a fallback for when the connection
            // was actually lost (e.g. the socket dropped on its own).
            const reauth = () => titleScreen?.titleScreenInventoryManager?.reauthenticate();
            if (!(0, preconnect_1.getLivePreconnectedSocket)()) {
                (0, preconnect_1.setPreconnectedSocket)(null);
                preconnectToServer();
                const waitForConnect = () => {
                    if ((0, preconnect_1.getLivePreconnectedSocket)())
                        reauth();
                    else
                        setTimeout(waitForConnect, 100);
                };
                setTimeout(waitForConnect, 100);
            }
            else {
                reauth();
            }
        },
    });
}
// Add this at the top of index.ts, before the Game class
