// ... (keep the existing imports and Player class)

import { Game } from './game';
import { AuthUI } from './auth_ui';

// Initialize auth UI
const authUI = new AuthUI();

// Add interfaces before the workerCode string
interface Decoration {
    x: number;
    y: number;
    scale: number;  // For random sizes
}

let currentGame: Game | null = null;

window.onload = () => {
    const multiPlayerButton = document.getElementById('multiPlayerButton');

    multiPlayerButton?.addEventListener('click', () => {
        if (currentGame) {
            // Cleanup previous game
            currentGame.cleanup();
        }
        currentGame = new Game();
    });
};

// Add this at the top of index.ts, before the Game class

