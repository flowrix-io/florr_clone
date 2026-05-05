"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
core_1.Graphics.prototype.render = function (players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension = 1.0, groundPollens) {
    // Cache timestamp for this frame to avoid Date.now() per enemy
    this.frameTimestamp = Date.now();
    // Apply the antialiasing preference at the start of every frame so
    // intermediate `ctx.save()/restore()` sequences (which capture and roll
    // back the smoothing state) can't drift away from the user's setting.
    this.ctx.imageSmoothingEnabled = this.antialiasing;
    // Update section-based texture loading based on player position
    const currentPlayer = players.get(currentPlayerId);
    if (currentPlayer) {
        this.updateSectionTextures(currentPlayer.x, currentPlayer.y);
    }
    // Always clear the visible main canvas. When we render the world to an
    // offscreen target, the blit at the end overwrites the world region but
    // not the UI region, so a stale frame would peek through without this.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Render the world into an offscreen canvas when renderScale < 1, so
    // the GPU only fills (canvas.width * canvas.height * renderScale²)
    // pixels per frame instead of the full screen. UI continues to draw
    // to the main canvas afterward at full resolution.
    const useOffscreen = this.renderScale < 1 && this.worldCtx !== null && this.worldCanvas !== null;
    const mainCtx = this.ctx;
    if (useOffscreen) {
        this.ctx = this.worldCtx;
        this.ctx.imageSmoothingEnabled = this.antialiasing;
    }
    this.ctx.save();
    // Clear the world target. With offscreen, this is the small buffer; at
    // renderScale=1 it's the main canvas (already cleared above — harmless).
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    // Apply zoom scaling. Multiplying by renderScale folds the offscreen
    // resolution into the world transform so the same camera/world view
    // that fits the main canvas also fits the smaller offscreen.
    this.ctx.scale(this.zoomLevel * this.renderScale, this.zoomLevel * this.renderScale);
    // Translate the context by the camera position
    // Ensure camera position is valid (not NaN or Infinity)
    const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
    const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;
    this.ctx.translate(-validCameraX, -validCameraY);
    // Static world (background + walls + edges) is pre-rendered into
    // chunk canvases and blitted in a handful of drawImage calls per
    // frame. Replaces what used to be drawScrollingBackground + the wall
    // grid pass inside drawMap, both of which did hundreds of fillRect /
    // stroke calls per frame for content that never changes.
    const visibleW = this.canvas.width / (this.zoomLevel * this.renderScale);
    const visibleH = this.canvas.height / (this.zoomLevel * this.renderScale);
    const mapViewport = {
        left: this.cameraX,
        top: this.cameraY,
        right: this.cameraX + visibleW,
        bottom: this.cameraY + visibleH,
    };
    this.renderStaticMap(mapViewport);
    // Draw spawn zones below walls/water when ALT is held
    if (this.showRarityGlow) {
        this.drawSpawnZones(this.mapData);
    }
    // Draw the map (dynamic overlays only — teleporters, spawn points,
    // hitbox debug). The wall grid that used to live here is now baked
    // into the static map cache above.
    this.drawMap(this.mapData);
    // Draw PVP arena boundary in world space (visible from inside the arena)
    this.drawPvpArenaBoundary();
    // Draw ground pollen drops below enemies/items so they sit on the ground
    if (groundPollens && groundPollens.size > 0) {
        this.drawGroundPollens(groundPollens);
    }
    // Draw game objects
    this.drawGameObjects(players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension);
    // Draw explosion effects (in world coordinates, before camera restore)
    this.drawExplosionEffects();
    this.drawPetalBreakEffects();
    this.drawLightningEffects();
    this.drawPetalParticleEffects();
    this.ctx.restore();
    // Blit the offscreen world back to the main canvas (stretched to fill),
    // then point this.ctx at the main canvas so all UI below renders at
    // full resolution.
    if (useOffscreen) {
        this.ctx = mainCtx;
        this.ctx.imageSmoothingEnabled = this.antialiasing;
        this.ctx.drawImage(this.worldCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }
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
    // Draw the canvas icon-button strip on top of the menu panels so it stays
    // accessible (same z-order as the legacy DOM buttons sat above gameCanvas).
    if (this.titleCanvasButtons) {
        this.titleCanvasButtons.draw(this.ctx, this.canvas.width, this.canvas.height);
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
