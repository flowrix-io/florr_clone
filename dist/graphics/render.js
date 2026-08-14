"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
const maze_1 = require("../maze");
/**
 * One entry point, one entity source.
 *
 * Every renderer below takes the same `ClientWorld` and reads components off
 * it. There is deliberately no Map rebuilt from the world for the older
 * renderers to keep using: a compatibility shim like that is exactly the dual
 * representation this pass removes, and a half-migrated renderer set means one
 * mob with two positions.
 */
core_1.Graphics.prototype.render = function (world, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension = 1.0, groundPollens, webFields) {
    // Cache timestamp for this frame to avoid Date.now() per enemy. This is the
    // DEATH-ANIMATION clock — the same Date.now() the ingest layer stamps
    // DeathAnimation.startTime with. Snapshot timestamps live in the
    // performance.now() domain and are never compared against it.
    this.frameTimestamp = Date.now();
    // Apply the antialiasing preference at the start of every frame so
    // intermediate `ctx.save()/restore()` sequences (which capture and roll
    // back the smoothing state) can't drift away from the user's setting.
    this.ctx.imageSmoothingEnabled = this.antialiasing;
    // Update section-based texture loading based on player position
    const currentPlayer = world.playerEntity(currentPlayerId);
    if (currentPlayer !== undefined) {
        this.updateSectionTextures(world.playerX(currentPlayer), world.playerY(currentPlayer));
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
        this.ctx = this.worldCtx;
        this.ctx.imageSmoothingEnabled = this.antialiasing;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        const bufferScale = this.zoomLevel * uiScale * this.renderScale;
        this.ctx.scale(bufferScale, bufferScale);
    }
    else {
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
    // When the whole viewport sits inside the maze region, the regular map
    // passes have nothing visible to draw — skip them so the static-map cache
    // doesn't bake empty far-away chunks (they'd churn its FIFO for nothing).
    // The maze region is an axis-aligned square, so containing both opposite
    // viewport corners means containing the whole viewport.
    const viewportFullyInMaze = (0, maze_1.isInMazeRegion)(mapViewport.left, mapViewport.top) &&
        (0, maze_1.isInMazeRegion)(mapViewport.right, mapViewport.bottom);
    if (!viewportFullyInMaze) {
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
    }
    // Draw the daily maze (biome ground + rrolf-style walls) when the camera
    // is over its region — the static map cache doesn't cover it.
    this.drawMazeWorld();
    // Draw ground pollen drops below enemies/items so they sit on the ground
    if (groundPollens && groundPollens.size > 0) {
        this.drawGroundPollens(groundPollens);
    }
    // Draw web fields below enemies so caught mobs render on top of the web
    if (webFields && webFields.size > 0) {
        this.drawWebFields(webFields);
    }
    // Draw raindrop auras (grass + droplets) below enemies and players
    this.drawRaindropAuras(world);
    // Draw game objects
    this.drawGameObjects(world, items, mobProjectiles, playerProjectiles, currentPlayerId, petalExtension);
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
        this.ctx.drawImage(this.worldCanvas, 0, 0, this.viewW, this.viewH);
    }
    else {
        // Undo the world scale/translate; back to the base scale(uiScale).
        this.ctx.restore();
    }
    // Draw UI elements (not affected by camera)
    this.drawUI(world, currentPlayerId);
    // Draw falling stars (screen coordinates)
    this.drawFallingStars();
    // Draw boss bars for ultra, super, and unique mobs in view
    this.drawBossBars(world);
    // Draw the live PVP leaderboard (only visible while in the arena)
    this.drawPvpLeaderboard(world, currentPlayerId);
    // Draw changelog and notifications menus. The canvas' stacking is set once
    // by AppShell.attachCanvas() and never changes, so there is nothing to
    // re-assert per frame here any more.
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
