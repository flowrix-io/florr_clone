"use strict";
/**
 * Title Screen Initialization
 * Example of how to use the TitleScreen class
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeTitleScreen = initializeTitleScreen;
const title_screen_1 = require("./title_screen");
// Initialize the title screen
function initializeTitleScreen() {
    // Inject the CSS styles
    (0, title_screen_1.injectTitleScreenStyles)();
    // Create and initialize the title screen
    const titleScreen = new title_screen_1.TitleScreen();
    // Append all menu elements to the body
    titleScreen.appendToBody();
    // Example: Set up event listeners for game-specific functionality
    setupGameEventListeners(titleScreen);
    return titleScreen;
}
function setupGameEventListeners(titleScreen) {
    // Example: Handle login button click
    const loginButton = titleScreen.getLoginButton();
    if (loginButton) {
        loginButton.addEventListener('click', () => {
            console.log('Login button clicked');
            // Add your login logic here
        });
    }
    // Example: Handle register button click
    const registerButton = titleScreen.getRegisterButton();
    if (registerButton) {
        registerButton.addEventListener('click', () => {
            console.log('Register button clicked');
            // Add your registration logic here
        });
    }
    // Example: Handle multiplayer button click
    const multiPlayerButton = titleScreen.getMultiPlayerButton();
    if (multiPlayerButton) {
        multiPlayerButton.addEventListener('click', () => {
            console.log('Multiplayer button clicked');
            // Hide auth container and show game
            titleScreen.hideAuthContainer();
            titleScreen.hideCenterText();
            titleScreen.hideGameMenu();
            titleScreen.showExitButton();
            // Add your game start logic here
        });
    }
    // Example: Handle color update
    const updateColorButton = titleScreen.getUpdateColorButton();
    if (updateColorButton) {
        updateColorButton.addEventListener('click', () => {
            const hueSlider = titleScreen.getHueSlider();
            const colorPreview = titleScreen.getColorPreview();
            if (hueSlider && colorPreview) {
                const hue = hueSlider.value;
                colorPreview.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
                console.log(`Color updated to hue: ${hue}`);
            }
        });
    }
}
// Auto-initialize when this module is loaded
// Uncomment the line below if you want automatic initialization
// initializeTitleScreen();
