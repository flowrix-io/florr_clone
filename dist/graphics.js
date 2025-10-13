"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Graphics = void 0;
const constants_1 = require("./constants");
const petals_1 = require("./petals");
const mobs_1 = require("./mobs");
class Graphics {
    constructor(canvas, playerSprite, wallTexture, octopusSprite, fishSprite, healthPotionSprite, speedBoostSprite, shieldSprite, backgroundTexture) {
        this.cameraX = 0;
        this.cameraY = 0;
        this.zoomLevel = 1.0;
        this.floatingTexts = [];
        this.mapData = [];
        this.MINIMAP_WIDTH = 200;
        this.MINIMAP_HEIGHT = 200;
        this.MINIMAP_PADDING = 10;
        this.playerEye = { x: 0, y: 0 };
        this.wallTexture = new Image();
        this.octopusSprite = new Image();
        this.fishSprite = new Image();
        this.healthPotionSprite = new Image();
        this.speedBoostSprite = new Image();
        this.shieldSprite = new Image();
        this.backgroundTexture = new Image();
        this.MAP_COLORS = {
            wall: 'rgba(102, 102, 102, 0.8)',
            spawn: 'rgba(76, 175, 80, 0.3)',
            teleporter: 'rgba(33, 150, 243, 0.5)',
            safe_zone: 'rgba(255, 193, 7, 0.2)'
        };
        this.ENEMY_COLORS = {
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
        this.ENEMY_SIZE_MULTIPLIERS = {
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
        this.ENEMY_MAX_HEALTH = {
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
        this.ITEM_RARITY_COLORS = {
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
        this.showHitboxes = false;
        this.itemSprites = {};
        this.petalImageCache = {};
        this.mobImageCache = new Map();
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
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
    async preloadMobImages() {
        const mobTypes = (0, mobs_1.getAllMobTypes)();
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        for (const mobType of mobTypes) {
            for (const rarity of rarities) {
                const mobStats = (0, mobs_1.getMobStats)(mobType, rarity);
                if (mobStats && mobStats.image) {
                    const cacheKey = `${mobType}_${rarity}`;
                    try {
                        await this.loadSVGAsImage(mobStats.image, cacheKey);
                        console.log(`[GRAPHICS] Preloaded ${mobType} ${rarity} sprite`);
                    }
                    catch (error) {
                        console.error(`[GRAPHICS] Failed to load ${mobType} ${rarity} sprite:`, error);
                    }
                }
            }
        }
    }
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    setCamera(x, y, zoom = 1.0) {
        this.cameraX = x;
        this.cameraY = y;
        this.zoomLevel = zoom;
    }
    setMap(mapData) {
        this.mapData = mapData;
    }
    showFloatingText(x, y, text, color, fontSize) {
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
    drawMap(world_map_data) {
        // Draw all map elements
        world_map_data.forEach(element => {
            const x = element.x;
            const y = element.y;
            const width = element.width;
            const height = element.height;
            // Only draw elements that are visible in the viewport
            if (x + width >= this.cameraX &&
                x <= this.cameraX + this.canvas.width &&
                y + height >= this.cameraY &&
                y <= this.cameraY + this.canvas.height) {
                if (element.type === 'wall') {
                    // Draw wall texture tiled
                    const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                    if (pattern) {
                        this.ctx.save();
                        this.ctx.fillStyle = pattern;
                        this.ctx.fillRect(x, y, width, height);
                        this.ctx.restore();
                    }
                }
                else {
                    // Draw other elements normally
                    this.ctx.fillStyle = this.MAP_COLORS[element.type];
                    this.ctx.fillRect(x, y, width, height);
                    // Add visual indicators for special elements
                    if (element.type === 'teleporter') {
                        this.drawTeleporter(x, y, width, height);
                    }
                    else if (element.type === 'spawn') {
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
    drawTeleporter(x, y, width, height) {
        // Create a pulsing effect
        const time = Date.now() / 1000;
        const pulseSize = 0.2 * Math.sin(time * 2) + 0.8; // Pulse between 0.6 and 1.0
        // Draw outer glow
        const gradient = this.ctx.createRadialGradient(x + width / 2, y + height / 2, 0, x + width / 2, y + height / 2, (width / 2) * pulseSize);
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
            this.ctx.ellipse(x + width / 2, y + height / 2, ringSize, ringSize * 0.4, 0, 0, Math.PI * 2);
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
    getTierColor(tier) {
        const colors = {
            common: 'rgba(128, 128, 128, 0.3)',
            uncommon: 'rgba(0, 128, 0, 0.3)',
            rare: 'rgba(0, 0, 255, 0.3)',
            epic: 'rgba(128, 0, 128, 0.3)',
            legendary: 'rgba(255, 165, 0, 0.3)',
            mythic: 'rgba(255, 0, 0, 0.3)'
        };
        return colors[tier] || colors.common;
    }
    drawSpawnPoint(x, y, width, height, type) {
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
        //     this.ctx.font = '20px Arial';
        //     this.ctx.textAlign = 'center';
        //     this.ctx.fillText(type.toUpperCase(), x + width / 2, y + height / 2);
        // }
    }
    drawUI(players, socket) {
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
            const healthFillWidth = (player.health / player.maxHealth) * healthBarWidth;
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
            this.ctx.font = '14px Arial';
            this.ctx.fillText(`Health: ${Math.round(player.health)}/${player.maxHealth}`, healthX + 5, healthY + 15);
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
            this.ctx.fillText(`Level ${player.level} - XP: ${player.xp}/${player.xpToNextLevel}`, healthX + 5, xpBarY + 15);
        }
        // Draw minimap
        this.drawMinimap(players, socket);
        // Draw floating texts
        this.drawFloatingTexts();
    }
    s(size) {
        return 1 * size;
    }
    drawFlower(center, eye) {
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
    drawPlayer(player, socket, petalExtension = 1.0) {
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
            const offCtx = offscreen.getContext('2d');
            offCtx.drawImage(this.playerSprite, 0, 0);
            const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
            offCtx.putImageData(imageData, 0, 0);
            this.drawFlower(this.playerSprite, this.playerEye);
        }
        else {
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
            this.ctx.strokeRect(-constants_1.PLAYER_SIZE / 2, -constants_1.PLAYER_SIZE / 2, constants_1.PLAYER_SIZE, constants_1.PLAYER_SIZE);
            this.ctx.restore();
        }
        // Draw player name
        this.ctx.fillStyle = 'white';
        this.ctx.textAlign = 'center';
        this.ctx.font = '14px Arial';
        this.ctx.fillText(player.name || 'Anonymous', 0, -30);
        this.ctx.restore();
        // Draw petals around player (outside of transform context)
        this.drawPlayerPetals(player, petalExtension);
    }
    drawPlayerPetals(player, petalExtension = 1.0) {
        // Safety check: ensure player loadout exists before filtering
        if (!player.loadout || !Array.isArray(player.loadout)) {
            return; // Skip drawing petals if loadout is not properly initialized
        }
        // Get all petals from player loadout and expand based on count property
        const petalInstances = [];
        try {
            player.loadout.forEach(item => {
                if (item && item.type === 'petal' && item.petalType && item.rarity) {
                    const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
                    if (!stats)
                        return;
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
        }
        catch (error) {
            console.error('Error building petal instances:', error);
            return;
        }
        if (petalInstances.length === 0)
            return;
        const currentTime = Date.now();
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = (Math.PI * 2) / petalInstances.length; // Evenly space petals
        petalInstances.forEach(({ petal, instanceIndex }, index) => {
            if (!petal || !petal.petalType || !petal.rarity)
                return;
            const stats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
            if (!stats)
                return;
            // Skip drawing if petal is on cooldown
            if (petal.onCooldown)
                return;
            // Calculate rotation angle
            const rotationSpeed = stats.speed * 0.002; // Convert to radians per ms
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
            }
            else {
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
    async loadSVGAsImage(svgString, cacheKey) {
        // Check cache first
        if (this.mobImageCache.has(cacheKey)) {
            return this.mobImageCache.get(cacheKey);
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
    drawEnemy(enemy) {
        // Get enemy size from mob stats
        const mobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
        const enemySize = mobStats ? mobStats.size * 40 : 40;
        this.ctx.save();
        this.ctx.translate(enemy.x, enemy.y);
        this.ctx.rotate(enemy.angle);
        // Draw enemy sprite using SVG from mob config
        const cacheKey = `${enemy.type}_${enemy.tier}`;
        if (mobStats && mobStats.image && this.mobImageCache.has(cacheKey)) {
            // Use cached SVG image
            const img = this.mobImageCache.get(cacheKey);
            this.ctx.drawImage(img, -enemySize / 2, -enemySize / 2, enemySize, enemySize);
        }
        else if (mobStats && mobStats.image) {
            // Load SVG image asynchronously and cache it
            this.loadSVGAsImage(mobStats.image, cacheKey);
            // For now, use fallback until image loads
            const sprite = enemy.type === 'octopus' ? this.octopusSprite : this.fishSprite;
            this.ctx.drawImage(sprite, -enemySize / 2, -enemySize / 2, enemySize, enemySize);
        }
        else {
            // Fallback to old sprite system if no mob config found
            const sprite = enemy.type === 'octopus' ? this.octopusSprite : this.fishSprite;
            this.ctx.drawImage(sprite, -enemySize / 2, -enemySize / 2, enemySize, enemySize);
        }
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
        this.ctx.fillRect(-healthBarWidth / 2, healthBarY, (enemy.health / enemy.maxHealth) * healthBarWidth, healthBarHeight);
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
    drawItem(item) {
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
        }
        else {
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
    drawWorldPetal(item) {
        if (!item.petalType || !item.rarity)
            return;
        const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
        if (!stats)
            return;
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
        }
        else {
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
    drawFloatingTexts() {
        this.floatingTexts = this.floatingTexts.filter(text => {
            text.y -= 1;
            text.alpha -= 1 / text.lifetime;
            if (text.alpha <= 0)
                return false;
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
    drawMinimap(players, socket) {
        const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
        const minimapY = this.MINIMAP_PADDING;
        const minimapScale = {
            x: this.MINIMAP_WIDTH / constants_1.ACTUAL_WORLD_WIDTH,
            y: this.MINIMAP_HEIGHT / constants_1.ACTUAL_WORLD_HEIGHT
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
            this.ctx.arc(minimapX + (player.x * minimapScale.x), minimapY + (player.y * minimapScale.y), 4, // Slightly larger dots
            0, Math.PI * 2);
            this.ctx.fill();
        });
        // Draw viewport rectangle in black
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX + (this.cameraX * minimapScale.x), minimapY + (this.cameraY * minimapScale.y), (this.canvas.width * minimapScale.x), (this.canvas.height * minimapScale.y));
        // Draw border
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    }
    drawScrollingBackground() {
        // If background texture is not loaded, just fill with a color
        if (!this.backgroundTexture || !this.backgroundTexture.complete) {
            this.ctx.fillStyle = '#00d885'; // Default green color from the SVG
            this.ctx.fillRect(this.cameraX, this.cameraY, this.canvas.width / this.zoomLevel, this.canvas.height / this.zoomLevel);
            return;
        }
        // Get the size of the background texture (400x400 from the SVG)
        const bgWidth = this.backgroundTexture.width;
        const bgHeight = this.backgroundTexture.height;
        // Calculate the visible area in world coordinates
        const visibleWidth = this.canvas.width / this.zoomLevel;
        const visibleHeight = this.canvas.height / this.zoomLevel;
        // Calculate the starting position for tiling (offset by camera position)
        // Use modulo to create seamless scrolling
        const startX = Math.floor(this.cameraX / bgWidth) * bgWidth;
        const startY = Math.floor(this.cameraY / bgHeight) * bgHeight;
        // Calculate how many tiles we need to draw
        const tilesX = Math.ceil(visibleWidth / bgWidth) + 1;
        const tilesY = Math.ceil(visibleHeight / bgHeight) + 1;
        // Draw the tiled background
        for (let i = 0; i <= tilesX; i++) {
            for (let j = 0; j <= tilesY; j++) {
                const x = startX + (i * bgWidth);
                const y = startY + (j * bgHeight);
                this.ctx.drawImage(this.backgroundTexture, x, y, bgWidth, bgHeight);
            }
        }
    }
    drawGameObjects(players, enemies, items, currentPlayerId, petalExtension = 1.0) {
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + this.canvas.width,
            bottom: this.cameraY + this.canvas.height
        };
        // Draw players
        for (const player of players.values()) {
            if (player.x > viewport.left - constants_1.PLAYER_SIZE && player.x < viewport.right + constants_1.PLAYER_SIZE &&
                player.y > viewport.top - constants_1.PLAYER_SIZE && player.y < viewport.bottom + constants_1.PLAYER_SIZE) {
                this.drawPlayer(player, currentPlayerId, petalExtension);
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
    render(players, enemies, items, currentPlayerId, petalExtension = 1.0) {
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
        this.ctx.restore();
        // Draw UI elements (not affected by camera)
        this.drawUI(players, currentPlayerId);
    }
    setupItemSprites(itemSprites) {
        this.itemSprites = itemSprites;
    }
    async preloadPetalImages() {
        const { PETAL_CONFIG } = await Promise.resolve().then(() => __importStar(require('./petals')));
        const loadPromises = [];
        Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
            Object.entries(rarities).forEach(([rarity, stats]) => {
                const key = `${petalType}_${rarity}`;
                const img = new Image();
                const promise = new Promise((resolve, reject) => {
                    img.onload = () => {
                        this.petalImageCache[key] = img;
                        resolve();
                    };
                    img.onerror = reject;
                    // Convert SVG string to data URL
                    const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(svgBlob);
                    img.src = url;
                });
                loadPromises.push(promise);
            });
        });
        await Promise.all(loadPromises);
        console.log('All petal images preloaded');
    }
}
exports.Graphics = Graphics;
