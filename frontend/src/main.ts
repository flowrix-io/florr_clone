import { Game } from './Game';

function resizeCanvasToFullScreen(...canvases: HTMLCanvasElement[]) {
    canvases.forEach(canvas => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

async function main() {
    console.log('Starting game initialization...');
    
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    const uiCanvas = document.getElementById('uiCanvas') as HTMLCanvasElement;
    
    if (!canvas || !uiCanvas) {
        console.error('Canvas element not found');
        return;
    }

    // Set both canvases to full screen and update on resize
    resizeCanvasToFullScreen(canvas, uiCanvas);
    window.addEventListener('resize', () => resizeCanvasToFullScreen(canvas, uiCanvas));

    console.log('Canvas found:', canvas);
    console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);

    try {
        console.log('Creating game instance...');
        const game = new Game(canvas, uiCanvas);
        
        // Make game globally accessible for NetworkManager
        window.game = game;
        
        console.log('Starting game...');
        // Start the game
        await game.start();
        
        console.log('Game started successfully');
    } catch (error) {
        console.error('Failed to start game:', error);
        
        // Update UI to show error
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = 'Failed to start game: ' + error;
        }
    }
}

// Start the game when DOM is loaded
document.addEventListener('DOMContentLoaded', main); 