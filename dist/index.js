"use strict";
// ... (keep the existing imports and Player class)
Object.defineProperty(exports, "__esModule", { value: true });
const game_1 = require("./game");
const auth_ui_1 = require("./auth_ui");
const title_screen_1 = require("./title_screen");
let currentGame = null;
let titleScreen = null;
let authUI = null;
window.onload = () => {
    // Initialize title screen first
    (0, title_screen_1.injectTitleScreenStyles)();
    titleScreen = new title_screen_1.TitleScreen();
    titleScreen.appendToBody();
    // Initialize auth UI after title screen is created
    authUI = new auth_ui_1.AuthUI();
    // Set up game event listeners
    setupGameEventListeners();
};
function setupGameEventListeners() {
    if (!titleScreen)
        return;
    // Handle multiplayer button click
    const multiPlayerButton = titleScreen.getMultiPlayerButton();
    if (multiPlayerButton) {
        multiPlayerButton.addEventListener('click', () => {
            if (currentGame) {
                // Cleanup previous game
                currentGame.cleanup();
            }
            currentGame = new game_1.Game();
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
