import { Player } from './player';
import { Enemy } from './enemy';
import { Item, WorldItem } from './item';
import { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE } from './constants';

export interface FloatingText {
    x: number;
    y: number;
    text: string;
    color: string;
    fontSize: number;
    alpha: number;
    yOffset: number;
    lifetime: number;
}

export class Graphics {
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    private cameraX: number = 0;
    private cameraY: number = 0;
    private playerSprite: HTMLImageElement;
    private floatingTexts: FloatingText[] = [];
    private mapData: MapElement[] = [];

    private readonly MINIMAP_WIDTH = 200;
    private readonly MINIMAP_HEIGHT = 200;
    private readonly MINIMAP_PADDING = 10;
    private playerEye: { x: number, y: number } = { x: 0, y: 0 };
    private wallTexture: HTMLImageElement = new Image();
    private octopusSprite: HTMLImageElement = new Image();
    private fishSprite: HTMLImageElement = new Image();
    private healthPotionSprite: HTMLImageElement = new Image();
    private speedBoostSprite: HTMLImageElement = new Image();
    private shieldSprite: HTMLImageElement = new Image();
    private backgroundTexture: HTMLImageElement = new Image();
    private readonly MAP_COLORS = {
        wall: 'rgba(102, 102, 102, 0.8)',
        spawn: 'rgba(76, 175, 80, 0.3)',
        teleporter: 'rgba(33, 150, 243, 0.5)',
        safe_zone: 'rgba(255, 193, 7, 0.2)'
    };
    private readonly ENEMY_COLORS = {
        common: '#808080',
        uncommon: '#008000',
        rare: '#0000FF',
        epic: '#800080',
        legendary: '#FFA500',
        mythic: '#FF0000'
    };
    private readonly ENEMY_SIZE_MULTIPLIERS: Record<Enemy['tier'], number> = {
        common: 1.0,
        uncommon: 1.2,
        rare: 1.4,
        epic: 1.6,
        legendary: 1.8,
        mythic: 2.0
    };
    private readonly ENEMY_MAX_HEALTH: Record<Enemy['tier'], number> = {
        common: 20,
        uncommon: 40,
        rare: 60,
        epic: 80,
        legendary: 100,
        mythic: 150
    };
    private readonly ITEM_RARITY_COLORS: Record<string, string> = {
        common: '#808080',      // Gray
        uncommon: '#008000',    // Green
        rare: '#0000FF',       // Blue
        epic: '#800080',       // Purple
        legendary: '#FFA500',   // Orange
        mythic: '#FF0000'      // Red
    };
    private showHitboxes: boolean = false;
    private itemSprites: Record<string, HTMLImageElement> = {};


    constructor(
        canvas: HTMLCanvasElement, 
        playerSprite: HTMLImageElement, 
        wallTexture: HTMLImageElement,
        octopusSprite: HTMLImageElement,
        fishSprite: HTMLImageElement,
        healthPotionSprite: HTMLImageElement,
        speedBoostSprite: HTMLImageElement,
        shieldSprite: HTMLImageElement,
        backgroundTexture: HTMLImageElement
    ) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d')!;
        this.playerSprite = playerSprite;
        this.wallTexture = wallTexture;
        this.octopusSprite = octopusSprite;
        this.fishSprite = fishSprite;
        this.healthPotionSprite = healthPotionSprite;
        this.speedBoostSprite = speedBoostSprite;
        this.shieldSprite = shieldSprite;
        this.backgroundTexture = backgroundTexture;
    }

    public clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    public setCamera(x: number, y: number) {
        this.cameraX = x;
        this.cameraY = y;
    }
    
    public setMap(mapData: MapElement[]) {
        this.mapData = mapData;
    }

    public showFloatingText(x: number, y: number, text: string, color: string, fontSize: number) {
        this.floatingTexts.push({
            x,
            y,
            text,
            color,
            fontSize,
            alpha: 1.0,
            yOffset: 0,
            lifetime: 1000
        });
    }

    public drawMap(world_map_data: MapElement[]) {
        // Draw all map elements
        world_map_data.forEach(element => {
            const x = element.x;
            const y = element.y;
            const width = element.width;
            const height = element.height;

            // Only draw elements that are visible in the viewport
            if (
                x + width >= this.cameraX &&
                x <= this.cameraX + this.canvas.width &&
                y + height >= this.cameraY &&
                y <= this.cameraY + this.canvas.height
            ) {
                if (element.type === 'wall') {
                    // Draw wall texture tiled
                    const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                    if (pattern) {
                        this.ctx.save();
                        this.ctx.fillStyle = pattern;
                        this.ctx.fillRect(x, y, width, height);
                        this.ctx.restore();
                    }
                } else {
                    // Draw other elements normally
                    this.ctx.fillStyle = this.MAP_COLORS[element.type];
                    this.ctx.fillRect(x, y, width, height);

                    // Add visual indicators for special elements
                    if (element.type === 'teleporter') {
                        this.drawTeleporter(x, y, width, height);
                    } else if (element.type === 'spawn') {
                        this.drawSpawnPoint(x, y, width, height, element.properties?.spawnType);
                    }
                }

                // Draw debug info if hitboxes are enabled
                if (this.showHitboxes) {
                    this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                    this.ctx.strokeRect(x, y, width, height);
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    this.ctx.fillText(`${Math.round(x)},${Math.round(y)}`, x, y - 5);
                }
            }
        });
    }

    private drawTeleporter(x: number, y: number, width: number, height: number) {
        // Create a pulsing effect
        const time = Date.now() / 1000;
        const pulseSize = 0.2 * Math.sin(time * 2) + 0.8; // Pulse between 0.6 and 1.0

        // Draw outer glow
        const gradient = this.ctx.createRadialGradient(
            x + width / 2, y + height / 2, 0,
            x + width / 2, y + height / 2, (width / 2) * pulseSize
        );
        gradient.addColorStop(0, 'rgba(0, 183, 255, 0.6)');
        gradient.addColorStop(0.6, 'rgba(0, 106, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 47, 255, 0)');

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x, y, width, height);

        // Draw portal rings
        const numRings = 3;
        this.ctx.lineWidth = 4;

        for (let i = 0; i < numRings; i++) {
            const ringSize = ((i + 1) / numRings) * width / 2 * pulseSize;
            const opacity = 1 - (i / numRings);

            this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.ellipse(
                x + width / 2,
                y + height / 2,
                ringSize,
                ringSize * 0.4,
                0,
                0,
                Math.PI * 2
            );
            this.ctx.stroke();
        }

        // Add some particle effects
        const numParticles = 8;
        const particleTime = time * 3;

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        for (let i = 0; i < numParticles; i++) {
            const angle = (i / numParticles) * Math.PI * 2 + particleTime;
            const particleX = x + width / 2 + Math.cos(angle) * width / 3 * pulseSize;
            const particleY = y + height / 2 + Math.sin(angle) * height / 4 * pulseSize;

            this.ctx.beginPath();
            this.ctx.arc(particleX, particleY, 3, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    private getTierColor(tier: string): string {
        const colors = {
            common: 'rgba(128, 128, 128, 0.3)',
            uncommon: 'rgba(0, 128, 0, 0.3)',
            rare: 'rgba(0, 0, 255, 0.3)',
            epic: 'rgba(128, 0, 128, 0.3)',
            legendary: 'rgba(255, 165, 0, 0.3)',
            mythic: 'rgba(255, 0, 0, 0.3)'
        };
        return colors[tier as keyof typeof colors] || colors.common;
    }

    public drawSpawnPoint(x: number, y: number, width: number, height: number, type?: string) {
        // Draw spawn area indicator
        const color = type ? this.getTierColor(type) : 'rgba(76, 175, 80, 0.3)';
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y, width, height);

        // Add spawn point marker
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
        this.ctx.stroke();

        // Add tier label
        if (type) {
            this.ctx.fillStyle = 'white';
            this.ctx.font = '20px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(type.toUpperCase(), x + width / 2, y + height / 2);
        }
    }

    public drawUI(players: Map<string, Player>, socket: string) {
        // Draw player stats
        const player = players.get(socket);
        if (player) {
            // Draw health bar
            const healthBarWidth = 200;
            const healthBarHeight = 20;
            const healthX = 20;
            const healthY = 20;

            // Health bar background
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(healthX, healthY, healthBarWidth, healthBarHeight);

            // Health bar fill
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
            this.ctx.fillRect(
                healthX,
                healthY,
                (player.health / player.maxHealth) * healthBarWidth,
                healthBarHeight
            );

            // Health text
            this.ctx.fillStyle = 'white';
            this.ctx.font = '14px Arial';
            this.ctx.fillText(
                `Health: ${Math.round(player.health)}/${player.maxHealth}`,
                healthX + 5,
                healthY + 15
            );

            // Draw XP bar
            const xpBarY = healthY + healthBarHeight + 5;
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(healthX, xpBarY, healthBarWidth, healthBarHeight);

            this.ctx.fillStyle = 'rgba(0, 128, 255, 0.7)';
            this.ctx.fillRect(
                healthX,
                xpBarY,
                (player.xp / player.xpToNextLevel) * healthBarWidth,
                healthBarHeight
            );

            this.ctx.fillStyle = 'white';
            this.ctx.fillText(
                `Level ${player.level} - XP: ${player.xp}/${player.xpToNextLevel}`,
                healthX + 5,
                xpBarY + 15
            );
        }

        // Draw minimap
        this.drawMinimap(players, socket);

        // Draw floating texts
        this.drawFloatingTexts();
    }

    private s(size: number): number {
        return 1 * size;
    }
    private drawFlower(center: { x: number, y: number }, eye: { x: number, y: number }) {
        this.ctx.lineCap = "round";
        this.ctx.lineWidth = this.s(1.7);
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, this.s(26.5), 0, Math.PI * 2, false);
        this.ctx.fillStyle = "#CFBB50";
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, this.s(23.5), 0, Math.PI * 2, false);
        this.ctx.fillStyle = "#FFE763";
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.moveTo(center.x - this.s(6), center.y + this.s(10));
        this.ctx.quadraticCurveTo(center.x, center.y + this.s(14.5), center.x + this.s(6), center.y + this.s(10));
        this.ctx.strokeStyle = "#000";
        this.ctx.fillStyle = "#000";
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.ellipse(center.x + this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.ellipse(center.x - this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.fill();
        this.ctx.clip();
        this.ctx.beginPath();
        this.ctx.fillStyle = "#fff";
        this.ctx.arc(center.x + this.s(7) + eye.x, center.y + eye.y - this.s(4.8), this.s(3), 0, Math.PI * 2, false);
        this.ctx.arc(center.x - this.s(7) + eye.x, center.y + eye.y - this.s(4.8), this.s(3), 0, Math.PI * 2, false);
        this.ctx.fill();
        this.ctx.lineWidth = this.s(1);
        this.ctx.beginPath();
        this.ctx.ellipse(center.x + this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.ellipse(center.x - this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.stroke();
    }

    public drawPlayer(player: Player, socket: string) {
        this.ctx.save();
        this.ctx.translate(player.x, player.y);

        // Apply invulnerability visual effect
        if (player.isInvulnerable) {
            const flashRate = 200; // Flash every 200ms
            const currentTime = Date.now();
            const shouldFlash = Math.floor(currentTime / flashRate) % 2 === 0;

            if (shouldFlash) {
                this.ctx.globalAlpha = 0.3; // Make player semi-transparent when flashing
            }

            // Draw invulnerability glow effect
            this.ctx.shadowColor = '#FFFF00';
            this.ctx.shadowBlur = 15;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 0;
        }

        // Draw player sprite
        if (player.id === socket) {
            // Calculate target eye position
            this.playerEye = {
                x: Math.cos(player.angle) * this.s(2),
                y: Math.sin(player.angle) * this.s(4.4)
            };

            // Smooth interpolation of eye position (lerp factor controls smoothness)
            const lerpFactor = 0.15; // Lower = smoother, higher = more responsive
            this.playerEye.x += (this.playerEye.x - this.playerEye.x) * lerpFactor;
            this.playerEye.y += (this.playerEye.y - this.playerEye.y) * lerpFactor;

            // Apply hue rotation for current player
            const offscreen = document.createElement('canvas');
            offscreen.width = this.playerSprite.width;
            offscreen.height = this.playerSprite.height;
            const offCtx = offscreen.getContext('2d')!;

            offCtx.drawImage(this.playerSprite, 0, 0);
            const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
            offCtx.putImageData(imageData, 0, 0);

            this.drawFlower(this.playerSprite, this.playerEye);
        } else {
            // For other players, use their own smooth eye interpolation
            if (!player.eye) {
                player.eye = { x: 0, y: 0 };
                player.targetEye = { x: 0, y: 0 };
            }

            // Calculate target eye position for this player
            player.targetEye = {
                x: Math.sin(player.angle) * this.s(2),
                y: Math.cos(player.angle) * this.s(-4.4)
            };

            // Smooth interpolation
            const lerpFactor = 0.15;
            player.eye.x += (player.targetEye.x - player.eye.x) * lerpFactor;
            player.eye.y += (player.targetEye.y - player.eye.y) * lerpFactor;

            this.drawFlower(this.playerSprite, player.eye);
        }

        // Reset effects after drawing
        if (player.isInvulnerable) {
            this.ctx.globalAlpha = 1.0;
            this.ctx.shadowBlur = 0;
        }

        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = 'red';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
            this.ctx.restore();
        }

        // Draw player name
        this.ctx.fillStyle = 'white';
        this.ctx.textAlign = 'center';
        this.ctx.font = '14px Arial';
        this.ctx.fillText(player.name || 'Anonymous', 0, -30);

        this.ctx.restore();
    }

    public drawEnemy(enemy: Enemy) {
        const sizeMultiplier = this.ENEMY_SIZE_MULTIPLIERS[enemy.tier];
        const enemySize = 40 * sizeMultiplier;

        this.ctx.save();
        this.ctx.translate(enemy.x, enemy.y);
        this.ctx.rotate(enemy.angle);

        // Draw enemy sprite based on type
        const sprite = enemy.type === 'octopus' ? this.octopusSprite : this.fishSprite;
        this.ctx.drawImage(
            sprite,
            -enemySize / 2,
            -enemySize / 2,
            enemySize,
            enemySize
        );

        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = this.ENEMY_COLORS[enemy.tier];
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-enemySize / 2, -enemySize / 2, enemySize, enemySize);
            this.ctx.restore();
        }

        // Draw health bar
        const healthBarWidth = enemySize;
        const healthBarHeight = 5;
        const healthBarY = -enemySize / 2 - 10;

        this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight);

        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
        this.ctx.fillRect(
            -healthBarWidth / 2,
            healthBarY,
            (enemy.health / this.ENEMY_MAX_HEALTH[enemy.tier]) * healthBarWidth,
            healthBarHeight
        );

        // Draw enemy tier with tier color
        this.ctx.fillStyle = this.ENEMY_COLORS[enemy.tier];
        this.ctx.textAlign = 'center';
        this.ctx.font = '12px Arial'; // Made text bold for better visibility

        // Add black outline to text for better visibility
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.strokeText(enemy.tier.toUpperCase(), 0, enemySize / 2 + 20);

        // Draw the text
        this.ctx.fillText(enemy.tier.toUpperCase(), 0, enemySize / 2 + 20);

        this.ctx.restore();
    }

    private drawItem(item: WorldItem) {
        const sprite = this.itemSprites[item.type];
        if (!sprite) return;

        this.ctx.save();
        this.ctx.translate(item.x, item.y);

        // Draw item rarity glow
        if (item.rarity) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 25, 0, Math.PI * 2);
            this.ctx.fillStyle = `${this.ITEM_RARITY_COLORS[item.rarity]}40`;
            this.ctx.fill();
            this.ctx.restore();
        }

        // Draw item sprite
        this.ctx.drawImage(sprite, -15, -15, 30, 30);

        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = 'yellow';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-15, -15, 30, 30);
            this.ctx.restore();
        }

        this.ctx.restore();
    }

    private drawFloatingTexts() {
        this.floatingTexts = this.floatingTexts.filter(text => {
            text.y -= 1;
            text.alpha -= 1 / text.lifetime;

            if (text.alpha <= 0) return false;

            this.ctx.save();
            this.ctx.globalAlpha = text.alpha;
            this.ctx.fillStyle = text.color;
            this.ctx.font = `${text.fontSize}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText(text.text, text.x, text.y);
            this.ctx.restore();

            return true;
        });
    }
    // Add minimap drawing
    private drawMinimap(players: Map<string, Player>, socket: string) {
        const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
        const minimapY = this.MINIMAP_PADDING;
        const minimapScale = {
            x: this.MINIMAP_WIDTH / ACTUAL_WORLD_WIDTH,
            y: this.MINIMAP_HEIGHT / ACTUAL_WORLD_HEIGHT
        };

        // Draw minimap background (white instead of black)
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.fillRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);

        // Draw only walls on minimap
        this.mapData.forEach(element => {
            // Only draw walls
            if (element.type === 'wall') {
                const scaledX = minimapX + (element.x * minimapScale.x);
                const scaledY = minimapY + (element.y * minimapScale.y);
                const scaledWidth = element.width * minimapScale.x;
                const scaledHeight = element.height * minimapScale.y;

                this.ctx.fillStyle = '#000000'; // Black for walls
                this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
            }
        });

        // Draw all players on minimap with solid colors
        players.forEach(player => {
            this.ctx.fillStyle = player.id === socket ? '#FF0000' : '#000000'; // Red for current player, black for others
            this.ctx.beginPath();
            this.ctx.arc(
                minimapX + (player.x * minimapScale.x),
                minimapY + (player.y * minimapScale.y),
                4, // Slightly larger dots
                0,
                Math.PI * 2
            );
            this.ctx.fill();
        });

        // Draw viewport rectangle in black
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(
            minimapX + (this.cameraX * minimapScale.x),
            minimapY + (this.cameraY * minimapScale.y),
            (this.canvas.width * minimapScale.x),
            (this.canvas.height * minimapScale.y)
        );

        // Draw border
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    }

    public drawGameObjects(players: Map<string, Player>, enemies: Map<string, Enemy>, items: Map<string, WorldItem>, currentPlayerId: string) {
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + this.canvas.width,
            bottom: this.cameraY + this.canvas.height
        };

        // Draw players
        for (const player of players.values()) {
            if (player.x > viewport.left - PLAYER_SIZE && player.x < viewport.right + PLAYER_SIZE &&
                player.y > viewport.top - PLAYER_SIZE && player.y < viewport.bottom + PLAYER_SIZE) {
                this.drawPlayer(player, currentPlayerId);
            }
        }

        // Draw enemies
        for (const enemy of enemies.values()) {
            // Add similar viewport culling for enemies
            this.drawEnemy(enemy);
        }

        // Draw items
        for (const item of items.values()) {
            // Add similar viewport culling for items
            this.drawItem(item);
        }
    }

    public render(players: Map<string, Player>, enemies: Map<string, Enemy>, items: Map<string, WorldItem>, currentPlayerId: string) {
        const player = players.get(currentPlayerId);
        if (player) {
            const targetX = player.x - this.canvas.width / 2;
            const targetY = player.y - this.canvas.height / 2;
            this.cameraX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - this.canvas.width, targetX));
            this.cameraY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - this.canvas.height, targetY));
        }

        this.ctx.save();

        // Clear the canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Translate the context by the camera position
        this.ctx.translate(-this.cameraX, -this.cameraY);
        
        // Draw background pattern
        const pattern = this.ctx.createPattern(this.backgroundTexture, 'repeat');
        if (pattern) {
            this.ctx.fillStyle = pattern;
            this.ctx.fillRect(
                this.cameraX,
                this.cameraY,
                this.canvas.width + this.cameraX * 0.5,
                this.canvas.height + this.cameraY * 0.5
            );
        }


        // Draw the map
        this.drawMap(this.mapData);

        // Draw game objects
        this.drawGameObjects(players, enemies, items, currentPlayerId);

        this.ctx.restore();

        // Draw UI elements (not affected by camera)
        this.drawUI(players, currentPlayerId);
    }
    public setupItemSprites(itemSprites: Record<string, HTMLImageElement>) {
        this.itemSprites = itemSprites;
    }
}
