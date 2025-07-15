import { GameState, Player, Mob, Vector2, Input, OrbitingCircle, MobType } from './types';
import { NetworkManager } from './NetworkManager';
import { AssetManager } from './AssetManager';

export class Game {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private uiCtx: CanvasRenderingContext2D;
    private gameState: GameState;
    private networkManager: NetworkManager;
    private assetManager: AssetManager;
    private input: Input;
    private playerId: string;
    private camera: Vector2;
    private lastTime: number = 0;
    private lastMouseSend: number = 0;
    private canvasSize = {
        w: window.innerWidth,
        h: window.innerHeight
    }
    
    private center = {
        x: this.canvasSize.w/2,
        y: this.canvasSize.h/2
    }
    
    private eye = {
        x: this.canvasSize.w/2,
        y: this.canvasSize.h/2
    }

    constructor(canvas: HTMLCanvasElement, uiCanvas: HTMLCanvasElement) {
        console.log('Game constructor called');
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.uiCtx = uiCanvas.getContext('2d')!;
        
        if (!this.ctx) {
            throw new Error('Failed to get 2D rendering context');
        }
        
        console.log('Canvas context obtained');
        
        this.playerId = this.generatePlayerId();
        this.camera = { x: 0, y: 0 };
        
        console.log('Player ID generated:', this.playerId);
        
        this.gameState = {
            players: {},
            mobs: {},
            worldBounds: { width: 2000, height: 2000 }
        };

        this.input = {
            mouseX: 0,
            mouseY: 0,
            keys: new Set()
        };

        console.log('Creating NetworkManager...');
        this.networkManager = new NetworkManager(this.playerId);
        
        console.log('Creating AssetManager...');
        this.assetManager = new AssetManager();
        
        console.log('Setting up event listeners...');
        this.setupEventListeners();
        
        console.log('Initializing player...');
        this.initializePlayer();
        this.center = {
            x: this.canvas.width/2,
            y: this.canvas.height/2
        }
        document.body.addEventListener("mousemove", (e)=>{
            const angle = Math.atan2((e.pageX-window.pageXOffset-this.canvas.getBoundingClientRect().x)*window.devicePixelRatio-this.center.x, -((e.pageY-window.pageYOffset-this.canvas.getBoundingClientRect().y)*window.devicePixelRatio-this.center.y)) - Math.PI/2;
            this.eye.x = Math.cos(angle)*this.s(2);
            this.eye.y = Math.sin(angle)*this.s(2);
        });
        
        console.log('Game constructor completed');
    }

    private generatePlayerId(): string {
        return Math.random().toString(36).substr(2, 9);
    }

    private setupEventListeners(): void {
        // Mouse movement
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.input.mouseX = e.clientX - rect.left;
            this.input.mouseY = e.clientY - rect.top;
            
            // Calculate eye movement relative to canvas center
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            const angle = Math.atan2(this.input.mouseY - centerY, this.input.mouseX - centerX);
            this.eye.x = Math.cos(angle) * this.s(3);
            this.eye.y = Math.sin(angle) * this.s(3);
        });

        // Keyboard input
        window.addEventListener('keydown', (e) => {
            this.input.keys.add(e.code);
        });

        window.addEventListener('keyup', (e) => {
            this.input.keys.delete(e.code);
        });
    }

    private initializePlayer(): void {
        const player: Player = {
            id: this.playerId,
            position: { x: 400, y: 300 },
            health: 100,
            maxHealth: 100,
            radius: 20,
            color: '#3498db',
            orbitingCircles: this.createOrbitingCircles()
        };

        this.gameState.players[this.playerId] = player;
    }

    private createOrbitingCircles(): OrbitingCircle[] {
        const circles: OrbitingCircle[] = [];
        const colors = ['#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
        
        for (let i = 0; i < 5; i++) {
            circles.push({
                angle: (i * Math.PI * 2) / 5,
                radius: 8,
                orbitRadius: 60,
                color: colors[i]
            });
        }
        
        return circles;
    }

    public async start(): Promise<void> {
        console.log('Game.start() called');
        
        console.log('Loading assets...');
        await this.assetManager.loadAssets();
        console.log('Assets loaded');
        
        console.log('Connecting to server...');
        this.networkManager.connect();
        console.log('Connected to server');
        
        console.log('Starting game loop...');
        this.gameLoop();
        console.log('Game loop started');
    }

    private gameLoop = (currentTime: number = 0): void => {
        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;

        this.update(deltaTime);
        this.render();

        requestAnimationFrame(this.gameLoop);
    };

    private update(deltaTime: number): void {
        this.updatePlayer(deltaTime);
        this.updateOrbitingCircles(deltaTime);
        this.updateMobs(deltaTime);
        this.checkCollisions();
        this.updateCamera();
    }

    private updatePlayer(deltaTime: number): void {
        // Client only sends input to server, doesn't update position locally
        // Server will send back the authoritative position
        
        // Only send mouse position updates periodically to avoid spamming the server
        const currentTime = Date.now();
        if (currentTime - this.lastMouseSend > 50) { // Send at most 20 times per second
            console.log('Updating player - mouse position:', this.input.mouseX, this.input.mouseY);
            this.networkManager.sendMousePosition(this.input.mouseX, this.input.mouseY);
            this.lastMouseSend = currentTime;
        }
    }

    private updateOrbitingCircles(deltaTime: number): void {
        const player = this.gameState.players[this.playerId];
        if (!player) return;

        const rotationSpeed = 2; // radians per second
        
        player.orbitingCircles.forEach(circle => {
            circle.angle += rotationSpeed * (deltaTime / 1000);
            if (circle.angle > Math.PI * 2) {
                circle.angle -= Math.PI * 2;
            }
        });
    }

    private updateMobs(deltaTime: number): void {
        // Mob AI will be handled by the server
        // This is just for client-side prediction
    }

    private checkCollisions(): void {
        const player = this.gameState.players[this.playerId];
        if (!player) return;

        Object.values(this.gameState.mobs).forEach(mob => {
            // Check collision with orbiting circles
            player.orbitingCircles.forEach(circle => {
                const circleX = player.position.x + Math.cos(circle.angle) * circle.orbitRadius;
                const circleY = player.position.y + Math.sin(circle.angle) * circle.orbitRadius;
                
                const dx = circleX - mob.position.x;
                const dy = circleY - mob.position.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < circle.radius + mob.radius) {
                    // Collision detected - damage mob
                    this.networkManager.sendDamage(mob.id, 10);
                }
            });

            // Check collision with player
            const dx = player.position.x - mob.position.x;
            const dy = player.position.y - mob.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < player.radius + mob.radius) {
                // Player takes damage
                player.health = Math.max(0, player.health - 1);
                this.updateHealthUI();
            }
        });
    }

    private updateCamera(): void {
        const player = this.gameState.players[this.playerId];
        if (!player) return;

        // Center camera on player so player is always in the center of the screen
        this.camera.x = player.position.x - this.canvas.width / 2;
        this.camera.y = player.position.y - this.canvas.height / 2;
    }

    private render(): void {
        // Debug: Log render calls occasionally
        if (Math.random() < 0.01) { // Log 1% of render calls
            console.log('Rendering frame - Players:', Object.keys(this.gameState.players).length, 'Mobs:', Object.keys(this.gameState.mobs).length);
        }
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw background (easy.svg) as world-locked tiles
        const bgImage = this.assetManager.getAsset('easy');
        if (bgImage) {
            const pattern = this.ctx.createPattern(bgImage, 'repeat');
            if (pattern) {
                this.ctx.save();
                // Offset pattern so it scrolls with the world
                this.ctx.setTransform(1, 0, 0, 1, -this.camera.x, -this.camera.y);
                this.ctx.fillStyle = pattern;
                this.ctx.fillRect(
                    this.camera.x, // left edge of visible world
                    this.camera.y, // top edge of visible world
                    this.canvas.width, // only fill the visible area
                    this.canvas.height
                );
                this.ctx.restore();
            }
        }
        
        // Save context for camera transformation
        this.ctx.save();
        this.ctx.translate(-this.camera.x, -this.camera.y);
        
        // Draw world bounds
        this.drawWorldBounds();
        
        // Draw all players
        Object.values(this.gameState.players).forEach(player => {
            this.drawPlayer(player);
        });
        
        // Draw all mobs
        Object.values(this.gameState.mobs).forEach(mob => {
            this.drawMob(mob);
        });
        
        // Restore context
        this.ctx.restore();
    }

    private drawWorldBounds(): void {
        this.ctx.strokeStyle = '#95a5a6';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(0, 0, this.gameState.worldBounds.width, this.gameState.worldBounds.height);
    }
    private s(size: number): number {
        return (0.9*size);
    }

    private drawFlower() {
        // Save the canvas state before any transformations or clipping
        this.uiCtx.save();
        
        this.uiCtx.lineCap = "round";
        this.uiCtx.lineWidth = this.s(1.7);
        this.uiCtx.beginPath();
        this.uiCtx.arc(this.center.x, this.center.y, this.s(26.5), 0, Math.PI*2, false);
        this.uiCtx.fillStyle = "#CFBB50";
        this.uiCtx.closePath();
        this.uiCtx.fill();
        this.uiCtx.beginPath();
        this.uiCtx.arc(this.center.x, this.center.y, this.s(23.5), 0, Math.PI*2, false);
        this.uiCtx.fillStyle = "#FFE763";
        this.uiCtx.closePath();
        this.uiCtx.fill();
        this.uiCtx.beginPath();
        this.uiCtx.moveTo(this.center.x-this.s(6), this.center.y+this.s(10));
        this.uiCtx.quadraticCurveTo(this.center.x, this.center.y+this.s(14.5), this.center.x+this.s(6), this.center.y+this.s(10));
        this.uiCtx.strokeStyle = "#000";
        this.uiCtx.fillStyle = "#000";
        this.uiCtx.stroke();
        this.uiCtx.beginPath();
        this.uiCtx.ellipse(this.center.x+this.s(7), this.center.y-this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI*2, false);
        this.uiCtx.ellipse(this.center.x-this.s(7), this.center.y-this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI*2, false);
        this.uiCtx.fill();
        this.uiCtx.clip();
        this.uiCtx.beginPath();

        this.uiCtx.fillStyle = "#fff";
        this.uiCtx.arc(this.center.x+this.s(7)+this.eye.x, this.center.y+this.eye.y-this.s(4.8), this.s(3), 0, Math.PI*2, false);
        this.uiCtx.arc(this.center.x-this.s(7)+this.eye.x, this.center.y+this.eye.y-this.s(4.8), this.s(3), 0, Math.PI*2, false);
        this.uiCtx.fill(); // Add the missing fill() call for the eyes
       
        this.uiCtx.lineWidth = this.s(1);
        this.uiCtx.beginPath();
        this.uiCtx.ellipse(this.center.x+this.s(7), this.center.y-this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI*2, false);
        this.uiCtx.stroke();
        this.uiCtx.beginPath();
        this.uiCtx.ellipse(this.center.x-this.s(7), this.center.y-this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI*2, false);
        this.uiCtx.stroke();
        
        // Restore the canvas state to remove clipping and other transformations
        this.uiCtx.restore();
    }
    

    private drawPlayer(player: Player): void {
        // Draw player
        const playerImage = this.assetManager.getAsset('player');
        this.drawFlower();

        // Draw orbiting circles
        player.orbitingCircles.forEach(circle => {
            const circleX = player.position.x + Math.cos(circle.angle) * circle.orbitRadius;
            const circleY = player.position.y + Math.sin(circle.angle) * circle.orbitRadius;
            
            this.ctx.fillStyle = circle.color;
            this.ctx.beginPath();
            this.ctx.arc(circleX, circleY, circle.radius, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Draw health bar
        if (player.health < player.maxHealth) {
            const barWidth = player.radius * 2;
            const barHeight = 4;
            const barX = player.position.x - player.radius;
            const barY = player.position.y - player.radius - 10;
            
            // Background
            this.ctx.fillStyle = '#e74c3c';
            this.ctx.fillRect(barX, barY, barWidth, barHeight);
            
            // Health
            this.ctx.fillStyle = '#2ecc71';
            this.ctx.fillRect(barX, barY, (player.health / player.maxHealth) * barWidth, barHeight);
        }
    }

    private drawMob(mob: Mob): void {
        const mobImage = this.assetManager.getAsset(mob.type);
        if (mobImage) {
            this.ctx.drawImage(
                mobImage,
                mob.position.x - mob.radius,
                mob.position.y - mob.radius,
                mob.radius * 2,
                mob.radius * 2
            );
        } else {
            this.ctx.fillStyle = '#e74c3c';
            this.ctx.beginPath();
            this.ctx.arc(mob.position.x, mob.position.y, mob.radius, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw health bar
        if (mob.health < mob.maxHealth) {
            const barWidth = mob.radius * 2;
            const barHeight = 3;
            const barX = mob.position.x - mob.radius;
            const barY = mob.position.y - mob.radius - 8;
            
            // Background
            this.ctx.fillStyle = '#e74c3c';
            this.ctx.fillRect(barX, barY, barWidth, barHeight);
            
            // Health
            this.ctx.fillStyle = '#2ecc71';
            this.ctx.fillRect(barX, barY, (mob.health / mob.maxHealth) * barWidth, barHeight);
        }
    }

    private updateHealthUI(): void {
        const player = this.gameState.players[this.playerId];
        if (!player) return;

        const healthElement = document.getElementById('health');
        if (healthElement) {
            healthElement.textContent = player.health.toString();
        }
    }

    public updateGameState(newState: Partial<GameState>): void {
        if (newState.players) {
            Object.assign(this.gameState.players, newState.players);
        }
        if (newState.mobs) {
            Object.assign(this.gameState.mobs, newState.mobs);
        }
        if (newState.worldBounds) {
            this.gameState.worldBounds = newState.worldBounds;
        }
    }

    public addPlayer(player: Player): void {
        this.gameState.players[player.id] = player;
        this.updatePlayerCountUI();
    }

    public removePlayer(playerId: string): void {
        delete this.gameState.players[playerId];
        this.updatePlayerCountUI();
    }

    private updatePlayerCountUI(): void {
        const playerCountElement = document.getElementById('playerCount');
        if (playerCountElement) {
            playerCountElement.textContent = Object.keys(this.gameState.players).length.toString();
        }
    }
} 