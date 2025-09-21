"use strict";
// ... (keep the existing imports and Player class)
Object.defineProperty(exports, "__esModule", { value: true });
const game_1 = require("./game");
const auth_ui_1 = require("./auth_ui");
// Initialize auth UI
const authUI = new auth_ui_1.AuthUI();
let currentGame = null;
window.onload = () => {
    const singlePlayerButton = document.getElementById('singlePlayerButton');
    const multiPlayerButton = document.getElementById('multiPlayerButton');
    singlePlayerButton?.addEventListener('click', () => {
        if (currentGame) {
            // Cleanup previous game
            currentGame.cleanup();
        }
        currentGame = new game_1.Game(true);
    });
    multiPlayerButton?.addEventListener('click', () => {
        if (currentGame) {
            // Cleanup previous game
            currentGame.cleanup();
        }
        currentGame = new game_1.Game(false);
    });
};
// Add this at the top of index.ts, before the Game class
