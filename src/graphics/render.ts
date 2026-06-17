import { Graphics, Player, Enemy, WorldItem } from './core';

declare module './core' {
    interface Graphics {
        render(players: Map<string, Player>, enemies: Map<string, Enemy>, items: Map<string, WorldItem>, mobProjectiles: Map<string, any>, playerProjectiles: Map<string, any>, currentPlayerId: string, petalExtension?: number, groundPollens?: Map<string, any>): void;
    }
}

Graphics.prototype.render = function(this: Graphics, players: Map<string, Player>, enemies: Map<string, Enemy>, items: Map<string, WorldItem>, mobProjectiles: Map<string, any>, playerProjectiles: Map<string, any>, currentPlayerId: string, petalExtension: number = 1.0, groundPollens?: Map<string, any>): void {
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

    // HiDPI base transform. The main canvas backing store is physical pixels
    // (logical × uiScale); applying scale(uiScale) once lets all drawing below
    // — world and UI — work in *logical* coordinates yet render at native
    // resolution. Everything reads this.viewW/viewH (logical) instead of
    // canvas.width/height (physical).
    const uiScale = this.uiScale || 1;
    const mainCtx = this.ctx;
    mainCtx.setTransform(uiScale, 0, 0, uiScale, 0, 0);
    mainCtx.imageSmoothingEnabled = this.antialiasing;

    // Clear to a black background (logical coords cover the full physical
    // canvas through the base scale).
    mainCtx.clearRect(0, 0, this.viewW, this.viewH);
    mainCtx.fillStyle = 'black';
    mainCtx.fillRect(0, 0, this.viewW, this.viewH);

    // When renderScale < 1, render the world into a smaller offscreen buffer
    // first (GPU fills native² × renderScale² pixels), then stretch it up onto
    // the main canvas. Otherwise the world renders straight onto the main
    // canvas at native resolution.
    const useBuffer = this.renderScale < 1 && this.worldCtx !== null && this.worldCanvas !== null;

    // Visible world extent (logical) — independent of renderScale; only the
    // pixel density changes, not how much of the world is shown.
    const visibleW = this.viewW / this.zoomLevel;
    const visibleH = this.viewH / this.zoomLevel;

    const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
    const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;

    if (useBuffer) {
        // Buffer maps world → buffer pixels directly: zoom × uiScale ×
        // renderScale (buffer size is canvas physical × renderScale).
        this.ctx = this.worldCtx!;
        this.ctx.imageSmoothingEnabled = this.antialiasing;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        const bufferScale = this.zoomLevel * uiScale * this.renderScale;
        this.ctx.scale(bufferScale, bufferScale);
    } else {
        // Direct: build on the base scale(uiScale) so total world scale is
        // zoom × uiScale (native resolution).
        this.ctx.save();
        this.ctx.scale(this.zoomLevel, this.zoomLevel);
    }
    this.ctx.translate(-validCameraX, -validCameraY);

    // Static world (background + walls + edges) is pre-rendered into
    // chunk canvases and blitted in a handful of drawImage calls per
    // frame. Replaces what used to be drawScrollingBackground + the wall
    // grid pass inside drawMap, both of which did hundreds of fillRect /
    // stroke calls per frame for content that never changes.
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

    // Draw raindrop auras (grass + droplets) below enemies and players
    this.drawRaindropAuras(players);

    // Draw game objects
    this.drawGameObjects(players, enemies, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension);

    // Draw explosion effects (in world coordinates, before camera restore)
    this.drawExplosionEffects();
    this.drawPetalBreakEffects();
    this.drawLightningEffects();
    this.drawPetalParticleEffects();

    if (useBuffer) {
        // Stretch the low-res buffer onto the main canvas. drawImage at logical
        // size (viewW/viewH) fills the full physical canvas via the base scale.
        this.ctx = mainCtx;
        this.ctx.imageSmoothingEnabled = this.antialiasing;
        this.ctx.drawImage(this.worldCanvas!, 0, 0, this.viewW, this.viewH);
    } else {
        // Undo the world scale/translate; back to the base scale(uiScale).
        this.ctx.restore();
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
    if (this.canvas && (window as any).currentGame) {
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
    if (this.skinStudioManager) {
        this.skinStudioManager.render();
    }

    // Draw the canvas icon-button strip on top of the menu panels so it stays
    // accessible (same z-order as the legacy DOM buttons sat above gameCanvas).
    if (this.titleCanvasButtons) {
        this.titleCanvasButtons.draw(this.ctx, this.viewW, this.viewH);
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
