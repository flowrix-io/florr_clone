// ... (keep the existing imports and Player class)

import { Game } from './game';
import { AuthUI } from './auth_ui';
import { TitleScreen, injectTitleScreenStyles } from './title_screen';

// Add interfaces before the workerCode string
interface Decoration {
    x: number;
    y: number;
    scale: number;  // For random sizes
}

let currentGame: Game | null = null;
let titleScreen: TitleScreen | null = null;
let authUI: AuthUI | null = null;

window.onload = () => {
    // Initialize title screen first
    injectTitleScreenStyles();
    titleScreen = new TitleScreen();
    titleScreen.appendToBody();
    
    // Initialize auth UI after title screen is created
    authUI = new AuthUI();
    
    // Set up game event listeners
    setupGameEventListeners();
};

function setupGameEventListeners() {
    if (!titleScreen) return;
    
    // Handle multiplayer button click
    const multiPlayerButton = titleScreen.getMultiPlayerButton();
    if (multiPlayerButton) {
        multiPlayerButton.addEventListener('click', () => {
            if (currentGame) {
                // Cleanup previous game
                currentGame.cleanup();
            }
            const showHitboxes = titleScreen?.getShowHitboxes() || false;
            const serverIp = titleScreen?.getServerIP() || window.location.origin;
            currentGame = new Game(showHitboxes, serverIp);
            
            // Hide menus and show game
            titleScreen?.hideAuthContainer();
            titleScreen?.hideCenterText();
            titleScreen?.hideGameMenu();
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
            }
            
            // Show menus and hide game
            titleScreen?.showAuthContainer();
            titleScreen?.showCenterText();
            titleScreen?.showGameMenu();
            titleScreen?.hideExitButton();
        });
    }
}

// Add this at the top of index.ts, before the Game class

