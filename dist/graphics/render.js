"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
core_1.Graphics.prototype.render = function (players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension = 1.0) {
    // Cache timestamp for this frame to avoid Date.now() per enemy
    this.frameTimestamp = Date.now();
    // Update section-based texture loading based on player position
    const currentPlayer = players.get(currentPlayerId);
    if (currentPlayer) {
        this.updateSectionTextures(currentPlayer.x, currentPlayer.y);
    }
    this.ctx.save();
    // Clear the canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Apply zoom scaling
    this.ctx.scale(this.zoomLevel, this.zoomLevel);
    // Translate the context by the camera position
    // Ensure camera position is valid (not NaN or Infinity)
    const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
    const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;
    this.ctx.translate(-validCameraX, -validCameraY);
    // Draw scrolling background
    this.drawScrollingBackground();
    // Draw spawn zones below walls/water when ALT is held
    if (this.showRarityGlow) {
        this.drawSpawnZones(this.mapData);
    }
    // Draw the map
    this.drawMap(this.mapData);
    // Draw PVP arena boundary in world space (visible from inside the arena)
    this.drawPvpArenaBoundary();
    // Draw game objects
    this.drawGameObjects(players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension);
    // Draw explosion effects (in world coordinates, before camera restore)
    this.drawExplosionEffects();
    this.drawPetalBreakEffects();
    this.drawLightningEffects();
    this.drawPetalParticleEffects();
    this.ctx.restore();
    // Draw UI elements (not affected by camera)
    this.drawUI(players, currentPlayerId);
    // Draw falling stars (screen coordinates)
    this.drawFallingStars();
    // Draw boss bars for ultra, super, and unique mobs in view
    this.drawBossBars(enemies);
    // Draw the live PVP leaderboard (only visible while in the arena)
    this.drawPvpLeaderboard(players, currentPlayerId);
    // Draw changelog and notifications menus
    // Ensure canvas z-index is low so UI elements stay on top (only while in-game)
    if (this.canvas && window.currentGame) {
        this.canvas.style.zIndex = '0';
    }
    if (this.changelogManager) {
        this.changelogManager.render();
    }
    if (this.notificationsManager) {
        this.notificationsManager.render();
    }
    if (this.leaderboardManager) {
        this.leaderboardManager.render();
    }
    if (this.guildMenuManager) {
        this.guildMenuManager.render();
    }
    // Draw console logs overlay
    this.drawConsoleLogs();
    // Draw canvas-based death screen overlay
    this.drawDeathScreen();
    // Draw iris circle-reveal transition on top of everything
    if (this.irisTransitionActive) {
        this.drawIrisTransition();
    }
};
