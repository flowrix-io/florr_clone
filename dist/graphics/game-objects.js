"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
core_1.Graphics.prototype.drawGameObjects = function (players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension = 1.0) {
    // Calculate viewport accounting for zoom level
    const scaledWidth = this.canvas.width / this.zoomLevel;
    const scaledHeight = this.canvas.height / this.zoomLevel;
    const viewport = {
        left: this.cameraX,
        top: this.cameraY,
        right: this.cameraX + scaledWidth,
        bottom: this.cameraY + scaledHeight
    };
    // Draw enemies first (including pets) - below players and petals
    const enemyCount = enemies.size;
    const mobsT0 = performance.now();
    for (const enemy of enemies.values()) {
        // Calculate actual enemy size for accurate culling
        const mobStats = (0, core_1.getMobStats)(enemy.type, enemy.tier);
        const baseSize = mobStats ? mobStats.size * 40 : 40;
        const visualScale = mobStats?.visual_scale ?? 1.0;
        const enemySize = baseSize * visualScale;
        // Add a buffer margin to ensure mobs are completely out before culling
        // This prevents culling when mobs are barely outside the viewport
        const cullingBuffer = Math.max(enemySize, 100); // At least 100px buffer, or enemy size if larger
        // Only cull if the mob is completely outside the viewport (with buffer)
        // A mob is completely outside if all of its edges are outside the viewport bounds
        if (enemy.x + enemySize / 2 + cullingBuffer < viewport.left ||
            enemy.x - enemySize / 2 - cullingBuffer > viewport.right ||
            enemy.y + enemySize / 2 + cullingBuffer < viewport.top ||
            enemy.y - enemySize / 2 - cullingBuffer > viewport.bottom) {
            continue;
        }
        try {
            this.drawEnemy(enemy);
        }
        catch (error) {
            console.error('[Graphics] Error drawing enemy:', error, enemy);
            // Draw a simple fallback circle if rendering fails
            try {
                this.ctx.save();
                this.ctx.translate(enemy.x, enemy.y);
                this.ctx.fillStyle = '#ff0000';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 20, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.restore();
            }
            catch (fallbackError) {
                console.error('[Graphics] Fallback rendering also failed:', fallbackError);
            }
        }
    }
    // Draw players (with petals) - above enemies
    for (const player of players.values()) {
        if (player.x > viewport.left - core_1.PLAYER_SIZE && player.x < viewport.right + core_1.PLAYER_SIZE &&
            player.y > viewport.top - core_1.PLAYER_SIZE && player.y < viewport.bottom + core_1.PLAYER_SIZE) {
            if (player.isDead) {
                // Draw corpse for dead players
                this.drawCorpse(player.x, player.y, player.angle, player);
            }
            else {
                // Use each player's own petal extension, or fallback to the passed value (for current player)
                const playerPetalExtension = player.id === currentPlayerId
                    ? petalExtension
                    : (player.petalExtension || 1.0);
                // Draw normal player (pass enemies for petal physics)
                this.drawPlayer(player, currentPlayerId, playerPetalExtension, enemies);
            }
        }
    }
    this.perfMobsMs = performance.now() - mobsT0;
    // Draw items (with viewport culling)
    const itemsT0 = performance.now();
    let itemsDrawn = 0;
    const ITEM_CULL_BUFFER = 50; // Item size ~50px + text
    for (const item of items.values()) {
        if (item.x + ITEM_CULL_BUFFER < viewport.left ||
            item.x - ITEM_CULL_BUFFER > viewport.right ||
            item.y + ITEM_CULL_BUFFER < viewport.top ||
            item.y - ITEM_CULL_BUFFER > viewport.bottom) {
            continue;
        }
        this.drawItem(item, players);
        itemsDrawn++;
    }
    this.perfItemsMs = performance.now() - itemsT0;
    this.perfItemsCount = itemsDrawn;
    const projT0 = performance.now();
    // Cache current time once per frame for animated projectiles
    const currentTime = Date.now();
    // Batch ALL gas projectiles (mob + player) for optimal performance
    const allGasProjectiles = [];
    const otherProjectiles = [];
    const MAX_GAS_PROJECTILES = 500; // Limit to prevent performance issues
    // Process mob projectiles
    for (const projectile of mobProjectiles.values()) {
        const petalStats = (0, core_1.getPetalStats)(projectile.petalType, projectile.petalRarity);
        if (!petalStats) {
            continue;
        }
        const projectileSize = projectile.size * 20; // Use projectile's scaled size
        const cullingBuffer = Math.max(projectileSize, 50);
        // Viewport culling
        if (projectile.x + projectileSize / 2 + cullingBuffer < viewport.left ||
            projectile.x - projectileSize / 2 - cullingBuffer > viewport.right ||
            projectile.y + projectileSize / 2 + cullingBuffer < viewport.top ||
            projectile.y - projectileSize / 2 - cullingBuffer > viewport.bottom) {
            continue;
        }
        if (projectile.petalType === 'gas' && projectile.petalRarity === 'common') {
            if (allGasProjectiles.length < MAX_GAS_PROJECTILES) {
                allGasProjectiles.push({
                    x: projectile.x,
                    y: projectile.y,
                    radius: projectileSize / 2 // Already uses scaled size
                });
            }
        }
        else {
            otherProjectiles.push({ projectile, petalStats });
        }
    }
    // Process player projectiles
    for (const projectile of playerProjectiles.values()) {
        const petalStats = (0, core_1.getPetalStats)(projectile.petalType, projectile.petalRarity);
        if (!petalStats) {
            continue;
        }
        const projectileSize = petalStats.size * 20;
        const cullingBuffer = Math.max(projectileSize, 50);
        // Viewport culling
        if (projectile.x + projectileSize / 2 + cullingBuffer < viewport.left ||
            projectile.x - projectileSize / 2 - cullingBuffer > viewport.right ||
            projectile.y + projectileSize / 2 + cullingBuffer < viewport.top ||
            projectile.y - projectileSize / 2 - cullingBuffer > viewport.bottom) {
            continue;
        }
        if (projectile.petalType === 'gas' && projectile.petalRarity === 'common') {
            if (allGasProjectiles.length < MAX_GAS_PROJECTILES) {
                allGasProjectiles.push({
                    x: projectile.x,
                    y: projectile.y,
                    radius: projectileSize / 2
                });
            }
        }
        else {
            otherProjectiles.push({ projectile, petalStats });
        }
    }
    // Batch draw ALL gas projectiles in a single operation (much faster)
    if (allGasProjectiles.length > 0) {
        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
        this.ctx.beginPath();
        for (const gas of allGasProjectiles) {
            this.ctx.arc(gas.x, gas.y, gas.radius, 0, Math.PI * 2);
        }
        this.ctx.fill();
    }
    // Draw other projectiles normally
    for (const { projectile, petalStats } of otherProjectiles) {
        this.drawMobProjectile(projectile, currentTime, petalStats);
    }
    this.perfProjectilesMs = performance.now() - projT0;
};
