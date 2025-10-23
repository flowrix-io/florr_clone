import { Player } from './player';
import { Enemy } from './enemy';
import { Item, WorldItem } from './item';
import { MapElement, ACTUAL_WORLD_WIDTH, ACTUAL_WORLD_HEIGHT, PLAYER_SIZE } from './constants';
import { getPetalStats } from './petals';
import { getMobStats, getAllMobTypes, MOB_CONFIG } from './mobs';

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

export interface ExplosionEffect {
    x: number;
    y: number;
    radius: number;
    maxRadius: number;
    alpha: number;
    lifetime: number;
    startTime: number;
    particles: ExplosionParticle[];
}

export interface ExplosionParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
}

export interface LightningEffect {
    x: number;
    y: number;
    targets: { x: number; y: number; enemyId: string }[];
    damage: number;
    lifetime: number;
    startTime: number;
    alpha: number;
}

export interface PetalBreakEffect {
    x: number;
    y: number;
    petalType: string;
    alpha: number;
    scale: number;
    lifetime: number;
    startTime: number;
}

export class Graphics {
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    private cameraX: number = 0;
    private cameraY: number = 0;
    private zoomLevel: number = 1.0;
    private playerSprite: HTMLImageElement;
    private floatingTexts: FloatingText[] = [];
    private explosionEffects: ExplosionEffect[] = [];
    private petalBreakEffects: PetalBreakEffect[] = [];
    private lightningEffects: LightningEffect[] = [];
    private mapData: MapElement[] = [];

    private readonly MINIMAP_WIDTH = 200;
    private readonly MINIMAP_HEIGHT = 200;
    private readonly MINIMAP_PADDING = 10;
    private minimapScrollX = 0; // Scroll offset for minimap X
    private minimapScrollY = 0; // Scroll offset for minimap Y
    private minimapZoom = 1.0; // Zoom level for minimap (1.0 = 20000x20000 area)
    private readonly MINIMAP_MIN_ZOOM = 0.5; // Show 40000x40000 area
    private readonly MINIMAP_MAX_ZOOM = 3.0; // Show 6667x6667 area
    private readonly MINIMAP_ZOOM_STEP = 0.2;
    private playerEye: { x: number, y: number } = { x: 0, y: 0 };
    private wallTexture: HTMLImageElement = new Image();
    private octopusSprite: HTMLImageElement = new Image();
    private fishSprite: HTMLImageElement = new Image();
    private healthPotionSprite: HTMLImageElement = new Image();
    private speedBoostSprite: HTMLImageElement = new Image();
    private shieldSprite: HTMLImageElement = new Image();
    private backgroundTexture: HTMLImageElement = new Image();
    private biomeTextures: Map<string, HTMLImageElement> = new Map(); // Store biome-specific background textures
    private readonly MAP_COLORS = {
        wall: 'rgba(102, 102, 102, 0.8)',
        spawn: 'rgba(76, 175, 80, 0.3)',
        teleporter: 'rgba(33, 150, 243, 0.5)',
        safe_zone: 'rgba(255, 193, 7, 0.2)',
        biome: 'rgba(128, 64, 192, 0.0)' // Purple tint for biomes on minimap
    };
    private readonly ENEMY_COLORS = {
        common: '#7eef6d',
        uncommon: '#ffe65d',
        rare: '#4d52e3',
        epic: '#861fde',
        legendary: '#de1f1f',
        mythic: '#1fdbde',
        ultra: '#de1f65',
        super: '#2bffa4',
        unique: '#bf00ff'
    };
    private readonly ENEMY_SIZE_MULTIPLIERS: Record<Enemy['tier'], number> = {
        common: 1.0,
        uncommon: 1.2,
        rare: 1.4,
        epic: 1.6,
        legendary: 1.8,
        mythic: 2.0,
        ultra: 2.5,
        super: 3.0,
        unique: 3.5
    };
    private readonly ENEMY_MAX_HEALTH: Record<Enemy['tier'], number> = {
        common: 20,
        uncommon: 40,
        rare: 60,
        epic: 80,
        legendary: 100,
        mythic: 150,
        ultra: 450,
        super: 1350,
        unique: 4050
    };
    private readonly ITEM_RARITY_COLORS = {
        common: '#7eef6d',
        uncommon: '#ffe65d',
        rare: '#4d52e3',
        epic: '#861fde',
        legendary: '#de1f1f',
        mythic: '#1fdbde',
        ultra: '#de1f65',
        super: '#2bffa4',
        unique: '#bf00ff'
    };
    public showHitboxes: boolean = false;
    private itemSprites: Record<string, HTMLImageElement> = {};
    private petalImageCache: Record<string, HTMLImageElement> = {};


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
        
        // Preload all mob SVG images
        this.preloadMobImages();
    }

    private async preloadMobImages() {
        const mobTypes = getAllMobTypes();
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        
        for (const mobType of mobTypes) {
            for (const rarity of rarities) {
                const mobStats = getMobStats(mobType, rarity);
                if (mobStats && mobStats.image) {
                    const cacheKey = `${mobType}_${rarity}`;
                    try {
                        await this.loadSVGAsImage(mobStats.image, cacheKey);
                        console.log(`[GRAPHICS] Preloaded ${mobType} ${rarity} sprite`);
                    } catch (error) {
                        console.error(`[GRAPHICS] Failed to load ${mobType} ${rarity} sprite:`, error);
                    }
                }
            }
        }
    }

    // Method to set a biome texture
    public setBiomeTexture(biomeName: string, texture: HTMLImageElement) {
        this.biomeTextures.set(biomeName, texture);
    }

    // Method to get biome at a position
    private getBiomeAtPosition(x: number, y: number): MapElement | null {
        for (const element of this.mapData) {
            if (element.type === 'biome') {
                if (x >= element.x && x <= element.x + element.width && 
                    y >= element.y && y <= element.y + element.height) {
                    return element;
                }
            }
        }
        return null;
    }

    public clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    public setCamera(x: number, y: number, zoom: number = 1.0) {
        this.cameraX = x;
        this.cameraY = y;
        this.zoomLevel = zoom;
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

    public showExplosionEffect(x: number, y: number, radius: number) {
        // Create particles for the explosion
        const particles: ExplosionParticle[] = [];
        const particleCount = Math.min(50, Math.max(10, radius / 5)); // Scale particle count with radius
        
        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
            const speed = 2 + Math.random() * 3;
            const particleLife = 800 + Math.random() * 400;
            
            particles.push({
                x: x + (Math.random() - 0.5) * 10,
                y: y + (Math.random() - 0.5) * 10,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: particleLife,
                maxLife: particleLife,
                size: 2 + Math.random() * 3,
                color: Math.random() > 0.5 ? '#FF4500' : '#FFD700'
            });
        }
        
        // Create explosion effect
        this.explosionEffects.push({
            x,
            y,
            radius,
            maxRadius: radius,
            alpha: 1.0,
            lifetime: 1000,
            startTime: Date.now(),
            particles
        });
        
        console.log(`[GRAPHICS] Created explosion effect at (${x}, ${y}) with ${particles.length} particles`);
    }

    public showPetalBreakEffect(x: number, y: number, petalType: string) {
        // Create petal break effect
        this.petalBreakEffects.push({
            x,
            y,
            petalType,
            alpha: 1.0,
            scale: 1.0,
            lifetime: 300,
            startTime: Date.now()
        });
    }

    public showLightningEffect(x: number, y: number, targets: { x: number; y: number; enemyId: string }[], damage: number) {
        // Create lightning effect
        this.lightningEffects.push({
            x,
            y,
            targets,
            damage,
            lifetime: 500, // Lightning effect lasts 500ms
            startTime: Date.now(),
            alpha: 1.0
        });
        
        console.log(`[GRAPHICS] Created lightning effect at (${x}, ${y}) with ${targets.length} targets`);
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
                    this.ctx.font = '12px Ubuntu, sans-serif';
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
        // // Draw spawn area indicator
        // const color = type ? this.getTierColor(type) : 'rgba(76, 175, 80, 0.3)';
        // this.ctx.fillStyle = color;
        // this.ctx.fillRect(x, y, width, height);

        // // Add spawn point marker
        // this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        // this.ctx.lineWidth = 2;
        // this.ctx.beginPath();
        // this.ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
        // this.ctx.stroke();

        // // Add tier label
        // if (type) {
        //     this.ctx.fillStyle = 'white';
        //     this.ctx.font = '20px Ubuntu, sans-serif';
        //     this.ctx.textAlign = 'center';
        //     this.ctx.fillText(type.toUpperCase(), x + width / 2, y + height / 2);
        // }
    }

    public drawUI(players: Map<string, Player>, socket: string) {
        // Draw player stats
        const player = players.get(socket);
        if (player) {
            // Draw flower in top left (moved down for exit button)
            const flowerCenterX = 50;
            const flowerCenterY = 120; // 50 + 70 pixels down
            const flowerEye = { x: 2, y: 0 }; // Centered eyes for UI flower
            
            this.ctx.save();
            this.drawFlower({ x: flowerCenterX, y: flowerCenterY }, flowerEye);
            this.ctx.restore();

            // Position bars to the right of the flower
            const healthBarWidth = 200;
            const healthBarHeight = 20;
            const healthX = flowerCenterX + 40; // Offset from flower center
            const healthY = 100; // 30 + 70 pixels down

            // Draw health bar with rounded ends
            const clampedHealth = Math.max(0, player.health); // Cap health at 0
            const healthFillWidth = (clampedHealth / player.maxHealth) * healthBarWidth;
            const radius = healthBarHeight / 2;

            // Health bar background (rounded)
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.beginPath();
            this.ctx.roundRect(healthX, healthY, healthBarWidth, healthBarHeight, radius);
            this.ctx.fill();

            // Health bar fill (rounded)
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
            this.ctx.beginPath();
            this.ctx.roundRect(healthX, healthY, healthFillWidth, healthBarHeight, radius);
            this.ctx.fill();

            // Health text
            this.ctx.fillStyle = 'white';
            this.ctx.font = '14px Ubuntu, sans-serif';
            this.ctx.fillText(
                `Health: ${Math.round(clampedHealth)}/${player.maxHealth}`,
                healthX + 5,
                healthY + 15
            );

            // Draw XP bar with rounded ends
            const xpBarY = healthY + healthBarHeight + 5;
            const xpFillWidth = (player.xp / player.xpToNextLevel) * healthBarWidth;

            // XP bar background (rounded)
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.beginPath();
            this.ctx.roundRect(healthX, xpBarY, healthBarWidth, healthBarHeight, radius);
            this.ctx.fill();

            // XP bar fill (rounded) with new color
            this.ctx.fillStyle = '#faffc9';
            this.ctx.beginPath();
            this.ctx.roundRect(healthX, xpBarY, xpFillWidth, healthBarHeight, radius);
            this.ctx.fill();

            // XP text
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(
                `Level ${player.level} - XP: ${player.xp}/${player.xpToNextLevel}`,
                healthX + 5,
                xpBarY + 15
            );
        }

        // Draw floating texts
        this.drawFloatingTexts();
        
        // Draw minimap
        this.drawMinimap(players, socket);
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

    public drawPlayer(player: Player, socket: string, petalExtension: number = 1.0) {
        this.ctx.save();
        this.ctx.translate(player.x, player.y);

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
        // Reset any effects that might interfere with text rendering
        this.ctx.globalAlpha = 1.0;
        this.ctx.shadowBlur = 0;
        this.ctx.shadowColor = 'transparent';
        this.ctx.fillStyle = 'black';
        this.ctx.textAlign = 'center';
        this.ctx.font = '14px Ubuntu, sans-serif';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(player.name || 'Unnamed', 0, -50);
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(player.name || 'Unnamed', 0, -50);

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


        this.ctx.restore();
        
        // Draw petals around player (outside of transform context)
        this.drawPlayerPetals(player, petalExtension);
    }

    private drawPlayerPetals(player: Player, petalExtension: number = 1.0) {
        // Safety check: ensure player loadout exists before filtering
        if (!player.loadout || !Array.isArray(player.loadout)) {
            return; // Skip drawing petals if loadout is not properly initialized
        }
        
        // Get all petals from player loadout and expand based on count property
        const petalInstances: Array<{petal: any, instanceIndex: number}> = [];
        try {
            player.loadout.forEach(item => {
                if (item && item.type === 'petal' && item.petalType && item.rarity) {
                    const stats = getPetalStats(item.petalType, item.rarity);
                    if (!stats) return;
                    
                    const count = stats.count || 1; // Use count from stats, default to 1
                    
                    // Validate count is a valid number
                    if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                        console.warn('Invalid petal count:', count, 'for', item.petalType, item.rarity);
                        return;
                    }
                    
                    // Create multiple instances based on count
                    for (let i = 0; i < count; i++) {
                        petalInstances.push({ petal: item, instanceIndex: i });
                    }
                }
            });
        } catch (error) {
            console.error('Error building petal instances:', error);
            return;
        }
        
        if (petalInstances.length === 0) return;

        const currentTime = Date.now();
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = (Math.PI * 2) / petalInstances.length; // Evenly space petals

        petalInstances.forEach(({petal, instanceIndex}, index) => {
            if (!petal || !petal.petalType || !petal.rarity) return;
            
            const stats = getPetalStats(petal.petalType, petal.rarity);
            if (!stats) return;

            // Skip drawing if petal is on cooldown
            if (petal.onCooldown) return;

            // Calculate rotation angle
            const rotationSpeed = (stats.speed ?? 1.0) * 0.002; // Convert to radians per ms
            const baseAngle = index * angleStep;
            const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
            const totalAngle = baseAngle + rotationAngle;

            // Calculate position around player
            const petalX = player.x + Math.cos(totalAngle) * baseRadius;
            const petalY = player.y + Math.sin(totalAngle) * baseRadius;

            // Draw petal using SVG image
            this.ctx.save();
            this.ctx.translate(petalX, petalY);
            this.ctx.rotate(totalAngle + Math.PI / 2); // Orient petal tangent to circle

            const size = 12 * stats.size;
            
            // Render petal using cached image
            const petalKey = `${petal.petalType}_${petal.rarity}`;
            const petalImage = this.petalImageCache[petalKey];
            
            if (petalImage) {
                // Use consistent scaling to maintain aspect ratio
                const petalSize = size;
                this.ctx.drawImage(petalImage, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                
                // Add rarity glow effect
                if (petal.rarity !== 'common') {
                    this.ctx.shadowColor = stats.color;
                    this.ctx.shadowBlur = 5;
                    this.ctx.drawImage(petalImage, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                }
            } else {
                // Fallback to colored circle if image not loaded
                this.ctx.fillStyle = stats.color;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            }
            
            // Draw health bar for petals
            if (petal.health !== undefined && petal.maxHealth !== undefined && petal.maxHealth > 0) {
                const healthBarWidth = size;
                const healthBarHeight = 3;
                const healthBarY = -size * 0.7 / 2 - 8;

                // Health bar background
                this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight);

                // Health bar fill
                const healthPercentage = petal.health / petal.maxHealth;
                this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
                this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth * healthPercentage, healthBarHeight);
            }

            this.ctx.restore();
        });
    }

    private mobImageCache: Map<string, HTMLImageElement> = new Map();

    private async loadSVGAsImage(svgString: string, cacheKey: string): Promise<HTMLImageElement> {
        // Check cache first
        if (this.mobImageCache.has(cacheKey)) {
            return this.mobImageCache.get(cacheKey)!;
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgString);
            
            img.onload = () => {
                this.mobImageCache.set(cacheKey, img);
                resolve(img);
            };
            
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    public drawEnemy(enemy: Enemy) {
        // Get enemy size from mob stats
        const mobStats = getMobStats(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : 40;

        this.ctx.save();
        this.ctx.translate(enemy.x, enemy.y);
        this.ctx.rotate(enemy.angle);

        // Draw enemy sprite using SVG from mob config
        const cacheKey = `${enemy.type}_${enemy.tier}`;
        
        if (mobStats && mobStats.image && this.mobImageCache.has(cacheKey)) {
            // Use cached SVG image
            const img = this.mobImageCache.get(cacheKey)!;
            this.ctx.drawImage(
                img,
                -enemySize / 2,
                -enemySize / 2,
                enemySize,
                enemySize
            );
        } else if (mobStats && mobStats.image) {
            // Load SVG image asynchronously and cache it
            this.loadSVGAsImage(mobStats.image, cacheKey);
            // For now, use fallback until image loads
            const sprite = enemy.type === 'octopus' ? this.octopusSprite : this.fishSprite;
            this.ctx.drawImage(
                sprite,
                -enemySize / 2,
                -enemySize / 2,
                enemySize,
                enemySize
            );
        } else {
            // Fallback to old sprite system if no mob config found
            const sprite = enemy.type === 'octopus' ? this.octopusSprite : this.fishSprite;
            this.ctx.drawImage(
                sprite,
                -enemySize / 2,
                -enemySize / 2,
                enemySize,
                enemySize
            );
        }

        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = this.ENEMY_COLORS[enemy.tier];
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.beginPath();
            this.ctx.arc(0, 0, enemySize / 2, 0, Math.PI * 2);
            this.ctx.stroke();
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
            (enemy.health / enemy.maxHealth) * healthBarWidth,
            healthBarHeight
        );

        // Draw enemy tier with tier color
        this.ctx.fillStyle = this.ENEMY_COLORS[enemy.tier];
        this.ctx.textAlign = 'center';
        this.ctx.font = '12px Ubuntu, sans-serif'; // Made text bold for better visibility

        // Add black outline to text for better visibility
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.strokeText(enemy.tier.toUpperCase(), 0, enemySize / 2 + 20);

        // Draw the text
        this.ctx.fillText(enemy.tier.toUpperCase(), 0, enemySize / 2 + 20);

        this.ctx.restore();
    }

    private drawItem(item: WorldItem) {
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

        // Handle different item types
        if (item.type === 'petal') {
            // Draw petal procedurally
            this.drawWorldPetal(item);
        } else {
            // Draw other items with sprites
            const sprite = this.itemSprites[item.type];
            if (sprite) {
                this.ctx.drawImage(sprite, -15, -15, 30, 30);
            }
        }

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

    private drawWorldPetal(item: WorldItem) {
        if (!item.petalType || !item.rarity) return;

        const stats = getPetalStats(item.petalType, item.rarity);
        if (!stats) return;

        // Draw petal using cached image
        const size = 12 * stats.size;
        const petalKey = `${item.petalType}_${item.rarity}`;
        const petalImage = this.petalImageCache[petalKey];
        
        if (petalImage) {
            // Use consistent scaling to maintain aspect ratio
            const petalSize = size;
            this.ctx.drawImage(petalImage, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
            
            // Add rarity glow effect
            if (item.rarity !== 'common') {
                this.ctx.shadowColor = stats.color;
                this.ctx.shadowBlur = 5;
                this.ctx.drawImage(petalImage, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
            }
        } else {
            // Fallback to colored circle if image not loaded
            this.ctx.fillStyle = stats.color;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        }
    }

    private drawFloatingTexts() {
        this.floatingTexts = this.floatingTexts.filter(text => {
            text.y -= 1;
            text.alpha -= 1 / text.lifetime;

            if (text.alpha <= 0) return false;

            this.ctx.save();
            this.ctx.globalAlpha = text.alpha;
            this.ctx.fillStyle = text.color;
            this.ctx.font = `${text.fontSize}px Ubuntu, sans-serif`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText(text.text, text.x, text.y);
            this.ctx.restore();

            return true;
        });
    }

    private drawExplosionEffects() {
        this.explosionEffects = this.explosionEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            
            if (progress >= 1) return false;

            this.ctx.save();
            this.ctx.globalAlpha = effect.alpha * (1 - progress);
            
            // Draw expanding circle
            const currentRadius = effect.radius * progress;
            this.ctx.strokeStyle = '#FF4500';
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(effect.x, effect.y, currentRadius, 0, Math.PI * 2);
            this.ctx.stroke();
            
            // Draw inner circle
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(effect.x, effect.y, currentRadius * 0.5, 0, Math.PI * 2);
            this.ctx.stroke();
            
            // Draw particles
            effect.particles = effect.particles.filter(particle => {
                const particleProgress = particle.life / particle.maxLife;
                if (particleProgress <= 0) return false;
                
                // Update particle position
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.life -= 16; // Assuming 60fps, reduce by ~16ms per frame
                
                // Draw particle
                this.ctx.globalAlpha = particleProgress * effect.alpha;
                this.ctx.fillStyle = particle.color;
                this.ctx.beginPath();
                this.ctx.arc(particle.x, particle.y, particle.size * particleProgress, 0, Math.PI * 2);
                this.ctx.fill();
                
                return true;
            });
            
            this.ctx.restore();
            return true;
        });
    }

    private drawPetalBreakEffects() {
        this.petalBreakEffects = this.petalBreakEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            
            if (progress >= 1) return false;

            this.ctx.save();
            this.ctx.globalAlpha = effect.alpha * (1 - progress);
            
            // Draw petal fragments
            const fragmentCount = 6;
            for (let i = 0; i < fragmentCount; i++) {
                const angle = (i / fragmentCount) * Math.PI * 2;
                const distance = progress * 30;
                const fragmentX = effect.x + Math.cos(angle) * distance;
                const fragmentY = effect.y + Math.sin(angle) * distance;
                
                this.ctx.fillStyle = '#FF69B4';
                this.ctx.beginPath();
                this.ctx.arc(fragmentX, fragmentY, 3, 0, Math.PI * 2);
                this.ctx.fill();
            }
            
            this.ctx.restore();
            return true;
        });
    }

    private drawLightningEffects() {
        this.lightningEffects = this.lightningEffects.filter(effect => {
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.lifetime;
            
            if (progress >= 1) return false;

            this.ctx.save();
            this.ctx.globalAlpha = effect.alpha * (1 - progress);
            
            // Draw lightning bolts as white lines between targets
            this.ctx.strokeStyle = '#FFFFFF';
            this.ctx.lineWidth = 2;
            this.ctx.lineCap = 'round';
            
            // Draw lines from origin to each target
            effect.targets.forEach(target => {
                this.ctx.beginPath();
                this.ctx.moveTo(effect.x, effect.y);
                this.ctx.lineTo(target.x, target.y);
                this.ctx.stroke();
            });
            
            // Draw lines between targets to create a web effect
            for (let i = 0; i < effect.targets.length; i++) {
                for (let j = i + 1; j < effect.targets.length; j++) {
                    const target1 = effect.targets[i];
                    const target2 = effect.targets[j];
                    
                    this.ctx.beginPath();
                    this.ctx.moveTo(target1.x, target1.y);
                    this.ctx.lineTo(target2.x, target2.y);
                    this.ctx.stroke();
                }
            }
            
            // Draw bright center point
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.beginPath();
            this.ctx.arc(effect.x, effect.y, 5, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw target points
            effect.targets.forEach(target => {
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.beginPath();
                this.ctx.arc(target.x, target.y, 3, 0, Math.PI * 2);
                this.ctx.fill();
            });
            
            this.ctx.restore();
            return true;
        });
    }

    // Minimap scrolling methods
    public scrollMinimap(deltaX: number, deltaY: number) {
        const MINIMAP_AREA_SIZE = 20000 / this.minimapZoom;
        const MAX_SCROLL_X = ACTUAL_WORLD_WIDTH - MINIMAP_AREA_SIZE;
        const MAX_SCROLL_Y = ACTUAL_WORLD_HEIGHT - MINIMAP_AREA_SIZE;
        
        this.minimapScrollX = Math.max(0, Math.min(MAX_SCROLL_X, this.minimapScrollX + deltaX));
        this.minimapScrollY = Math.max(0, Math.min(MAX_SCROLL_Y, this.minimapScrollY + deltaY));
    }

    public setMinimapScroll(x: number, y: number) {
        const MINIMAP_AREA_SIZE = 20000 / this.minimapZoom;
        const MAX_SCROLL_X = ACTUAL_WORLD_WIDTH - MINIMAP_AREA_SIZE;
        const MAX_SCROLL_Y = ACTUAL_WORLD_HEIGHT - MINIMAP_AREA_SIZE;
        
        this.minimapScrollX = Math.max(0, Math.min(MAX_SCROLL_X, x));
        this.minimapScrollY = Math.max(0, Math.min(MAX_SCROLL_Y, y));
    }

    public centerMinimapOnPlayer(playerX: number, playerY: number) {
        const MINIMAP_AREA_SIZE = 20000 / this.minimapZoom;
        const HALF_AREA = MINIMAP_AREA_SIZE / 2;
        
        this.setMinimapScroll(
            playerX - HALF_AREA,
            playerY - HALF_AREA
        );
    }

    public zoomInMinimap() {
        this.minimapZoom = Math.min(this.minimapZoom + this.MINIMAP_ZOOM_STEP, this.MINIMAP_MAX_ZOOM);
    }

    public zoomOutMinimap() {
        this.minimapZoom = Math.max(this.minimapZoom - this.MINIMAP_ZOOM_STEP, this.MINIMAP_MIN_ZOOM);
    }

    public setMinimapZoom(zoom: number) {
        this.minimapZoom = Math.max(this.MINIMAP_MIN_ZOOM, Math.min(this.MINIMAP_MAX_ZOOM, zoom));
    }

    public getMinimapZoom(): number {
        return this.minimapZoom;
    }

    public followPlayerOnMinimap(playerX: number, playerY: number) {
        // Automatically center minimap on player
        this.centerMinimapOnPlayer(playerX, playerY);
    }

    // Add minimap drawing
    private drawMinimap(players: Map<string, Player>, socket: string) {
        const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
        const minimapY = this.MINIMAP_PADDING;
        
        // Define the area to show on minimap (scaled by zoom level)
        const MINIMAP_AREA_SIZE = 20000 / this.minimapZoom;
        const minimapScale = {
            x: this.MINIMAP_WIDTH / MINIMAP_AREA_SIZE,
            y: this.MINIMAP_HEIGHT / MINIMAP_AREA_SIZE
        };

        // Draw minimap background (white instead of black)
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.fillRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);

        // Set up clipping region for minimap to prevent drawing outside bounds
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
        this.ctx.clip();

        // Draw only walls on minimap (with scroll offset)
        this.mapData.forEach(element => {
            // Only draw walls
            if (element.type === 'wall') {
                const scaledX = minimapX + ((element.x - this.minimapScrollX) * minimapScale.x);
                const scaledY = minimapY + ((element.y - this.minimapScrollY) * minimapScale.y);
                const scaledWidth = element.width * minimapScale.x;
                const scaledHeight = element.height * minimapScale.y;

                // Only draw if the element is within the visible minimap area
                if (scaledX + scaledWidth > minimapX && scaledX < minimapX + this.MINIMAP_WIDTH &&
                    scaledY + scaledHeight > minimapY && scaledY < minimapY + this.MINIMAP_HEIGHT) {
                    this.ctx.fillStyle = '#000000'; // Black for walls
                    this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                }
            }
        });

        // Draw all players on minimap with solid colors (with scroll offset)
        players.forEach(player => {
            const playerMinimapX = minimapX + ((player.x - this.minimapScrollX) * minimapScale.x);
            const playerMinimapY = minimapY + ((player.y - this.minimapScrollY) * minimapScale.y);
            
            // Only draw if player is within the visible minimap area
            if (playerMinimapX > minimapX && playerMinimapX < minimapX + this.MINIMAP_WIDTH &&
                playerMinimapY > minimapY && playerMinimapY < minimapY + this.MINIMAP_HEIGHT) {
                this.ctx.fillStyle = player.id === socket ? '#FF0000' : '#000000'; // Red for current player, black for others
                this.ctx.beginPath();
                this.ctx.arc(
                    playerMinimapX,
                    playerMinimapY,
                    4, // Slightly larger dots
                    0,
                    Math.PI * 2
                );
                this.ctx.fill();
            }
        });

        // Draw viewport rectangle in black (with scroll offset)
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(
            minimapX + ((this.cameraX - this.minimapScrollX) * minimapScale.x),
            minimapY + ((this.cameraY - this.minimapScrollY) * minimapScale.y),
            (this.canvas.width / this.zoomLevel) * minimapScale.x,
            (this.canvas.height / this.zoomLevel) * minimapScale.y
        );

        // Restore context to remove clipping region
        this.ctx.restore();

        // Draw border
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    }

    private drawScrollingBackground() {
        // If background texture is not loaded or is broken, just fill with a color
        if (!this.backgroundTexture || !this.backgroundTexture.complete || this.backgroundTexture.naturalWidth === 0) {
            this.ctx.fillStyle = '#00d885'; // Default green color from the SVG
            this.ctx.fillRect(
                this.cameraX,
                this.cameraY,
                this.canvas.width / this.zoomLevel,
                this.canvas.height / this.zoomLevel
            );
            return;
        }

        // Calculate the visible area in world coordinates
        const visibleWidth = this.canvas.width / this.zoomLevel;
        const visibleHeight = this.canvas.height / this.zoomLevel;

        // Get the size of the background texture (400x400 from the SVG)
        const defaultBgWidth = this.backgroundTexture.width;
        const defaultBgHeight = this.backgroundTexture.height;

        // Calculate the starting position for tiling (offset by camera position)
        const startX = Math.floor(this.cameraX / defaultBgWidth) * defaultBgWidth;
        const startY = Math.floor(this.cameraY / defaultBgHeight) * defaultBgHeight;

        // Calculate how many tiles we need to draw
        const tilesX = Math.ceil(visibleWidth / defaultBgWidth) + 1;
        const tilesY = Math.ceil(visibleHeight / defaultBgHeight) + 1;

        // Draw the tiled background
        for (let i = 0; i <= tilesX; i++) {
            for (let j = 0; j <= tilesY; j++) {
                const tileX = startX + (i * defaultBgWidth);
                const tileY = startY + (j * defaultBgHeight);
                
                // Check if this tile overlaps with any biome
                const biome = this.getBiomeAtPosition(tileX + defaultBgWidth / 2, tileY + defaultBgHeight / 2);
                
                if (biome && biome.properties?.biomeName && biome.properties?.backgroundTexture) {
                    // Use biome-specific texture if available
                    const biomeTexture = this.biomeTextures.get(biome.properties.biomeName);
                    
                    if (biomeTexture && biomeTexture.complete && biomeTexture.naturalWidth > 0) {
                        const biomeWidth = biomeTexture.width;
                        const biomeHeight = biomeTexture.height;
                        this.ctx.drawImage(biomeTexture, tileX, tileY, biomeWidth, biomeHeight);
                    } else {
                        // Fallback to default texture if biome texture not loaded
                        this.ctx.drawImage(this.backgroundTexture, tileX, tileY, defaultBgWidth, defaultBgHeight);
                    }
                } else {
                    // Use default texture
                    this.ctx.drawImage(this.backgroundTexture, tileX, tileY, defaultBgWidth, defaultBgHeight);
                }
            }
        }
    }

    public drawGameObjects(players: Map<string, Player>, enemies: Map<string, Enemy>, items: Map<string, WorldItem>, currentPlayerId: string, petalExtension: number = 1.0) {
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
                
                if (player.isDead) {
                    // Draw corpse for dead players
                    this.drawCorpse(player.x, player.y, player.angle);
                } else {
                    // Draw normal player
                    this.drawPlayer(player, currentPlayerId, petalExtension);
                }
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

    public render(players: Map<string, Player>, enemies: Map<string, Enemy>, items: Map<string, WorldItem>, currentPlayerId: string, petalExtension: number = 1.0) {
        this.ctx.save();

        // Clear the canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply zoom scaling
        this.ctx.scale(this.zoomLevel, this.zoomLevel);

        // Translate the context by the camera position
        this.ctx.translate(-this.cameraX, -this.cameraY);
        
        // Draw scrolling background
        this.drawScrollingBackground();


        // Draw the map
        this.drawMap(this.mapData);

        // Draw game objects
        this.drawGameObjects(players, enemies, items, currentPlayerId, petalExtension);

        // Draw explosion effects (in world coordinates, before camera restore)
        this.drawExplosionEffects();
        this.drawPetalBreakEffects();
        this.drawLightningEffects();

        this.ctx.restore();

        // Draw UI elements (not affected by camera)
        this.drawUI(players, currentPlayerId);
    }
    public setupItemSprites(itemSprites: Record<string, HTMLImageElement>) {
        this.itemSprites = itemSprites;
    }

    public setPetalImagesFromPreloaded(imageCache: Record<string, HTMLImageElement>) {
        console.log('[Graphics] Setting petal images from preloaded cache');
        this.petalImageCache = imageCache;
        console.log('[Graphics] Petal images set:', Object.keys(this.petalImageCache).length, 'images');
    }

    public async preloadPetalImages() {
        const { PETAL_CONFIG } = await import('./petals');
        
        const loadPromises: Promise<void>[] = [];
        
        Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
            Object.entries(rarities).forEach(([rarity, stats]) => {
                const key = `${petalType}_${rarity}`;
                const img = new Image();
                
                const promise = new Promise<void>((resolve, reject) => {
                    img.onload = () => {
                        this.petalImageCache[key] = img;
                        resolve();
                    };
                    img.onerror = reject;
                    
                    // Convert SVG string to data URL
                    const svgBlob = new Blob([stats.image ?? ''], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(svgBlob);
                    img.src = url;
                });
                
                loadPromises.push(promise);
            });
        });
        
        await Promise.all(loadPromises);
        console.log('All petal images preloaded');
    }

    public drawCorpse(x: number, y: number, angle: number) {
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);
        
        // Draw the corpse SVG
        this.ctx.fillStyle = '#ffe763';
        this.ctx.strokeStyle = '#cfbb50';
        this.ctx.lineWidth = 3;
        
        // Draw the main circle (face)
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 25, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        
        // Draw the X eyes
        this.ctx.strokeStyle = '#222222';
        this.ctx.lineWidth = 1.5;
        this.ctx.lineCap = 'round';
        
        // Left eye X
        this.ctx.beginPath();
        this.ctx.moveTo(-10, -8);
        this.ctx.lineTo(-4, -2);
        this.ctx.moveTo(-4, -8);
        this.ctx.lineTo(-10, -2);
        this.ctx.stroke();
        
        // Right eye X
        this.ctx.beginPath();
        this.ctx.moveTo(10, -8);
        this.ctx.lineTo(4, -2);
        this.ctx.moveTo(4, -8);
        this.ctx.lineTo(10, -2);
        this.ctx.stroke();
        
        // Draw the sad mouth
        this.ctx.beginPath();
        this.ctx.moveTo(-6, 10);
        this.ctx.quadraticCurveTo(0, 15, 6, 10);
        this.ctx.stroke();
        
        this.ctx.restore();
    }

}
