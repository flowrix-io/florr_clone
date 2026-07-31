"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEATH_ANIMATION_DURATION = void 0;
const core_1 = require("./core");
// Shared with drawGameObjects' health-bar pass, which must skip mobs whose
// death animation is running (drawEnemy scales/fades them instead).
exports.DEATH_ANIMATION_DURATION = 200; // ms
core_1.Graphics.prototype.drawMobProjectile = function (projectile, currentTime, petalStats) {
    if (!projectile || typeof projectile.x !== 'number' || typeof projectile.y !== 'number') {
        return;
    }
    // Get petal stats for rendering (use cached if provided)
    if (!petalStats) {
        petalStats = (0, core_1.getPetalStats)(projectile.petalType, projectile.petalRarity);
        if (!petalStats) {
            return;
        }
    }
    // Fast path for gas projectiles - they're just simple green circles, no rotation needed
    if (projectile.petalType === 'gas' && projectile.petalRarity === 'common') {
        const petalSize = projectile.size * 20; // Use projectile's scaled size
        const radius = petalSize / 2;
        // Draw directly without transforms - much faster
        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
        this.ctx.beginPath();
        this.ctx.arc(projectile.x, projectile.y, radius, 0, Math.PI * 2);
        this.ctx.fill();
        // Draw hitbox for gas projectiles
        if (this.showHitboxes) {
            this.ctx.strokeStyle = 'cyan';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0;
            this.ctx.shadowBlur = 0;
            this.ctx.beginPath();
            this.ctx.arc(projectile.x, projectile.y, radius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        return;
    }
    const petalSize = projectile.size * 20; // Use projectile's scaled size
    this.ctx.save();
    this.ctx.translate(projectile.x, projectile.y);
    this.ctx.rotate(projectile.angle);
    // Draw petal using the same method as player petals
    const petalKey = `${projectile.petalType}_${projectile.petalRarity}`;
    // Only pass time for animated petals - for static petals like gas, we can skip it
    // Check if petal is animated by checking if the cached image is an array
    const petalImage = this.petalImageCache[petalKey];
    const isAnimated = Array.isArray(petalImage);
    const petalCanvas = isAnimated && currentTime !== undefined
        ? this.getPetalCanvas(petalKey, currentTime)
        : this.getPetalCanvas(petalKey);
    if (petalCanvas && petalCanvas.width > 0 && petalCanvas.height > 0) {
        try {
            // Draw the petal canvas image centered at origin
            this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
        }
        catch (error) {
            console.error(`[Graphics] Error drawing projectile petal image:`, error);
            // Fallback to colored circle if image fails
            this.ctx.fillStyle = petalStats.color;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, petalSize / 2, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }
    else {
        // Fallback to colored circle if petal canvas not available
        this.ctx.fillStyle = petalStats.color;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, petalSize / 2, 0, Math.PI * 2);
        this.ctx.fill();
        // Add a border for visibility
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }
    // Draw hitbox circle
    if (this.showHitboxes) {
        this.ctx.strokeStyle = 'cyan';
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 1.0;
        this.ctx.shadowBlur = 0;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, petalSize / 2, 0, Math.PI * 2);
        this.ctx.stroke();
    }
    this.ctx.restore();
};
core_1.Graphics.prototype.drawEnemy = function (enemy) {
    // Validate enemy has required properties
    if (!enemy || typeof enemy.x !== 'number' || typeof enemy.y !== 'number') {
        console.error('[Graphics] Invalid enemy data:', enemy);
        return;
    }
    // Check if enemy is in death animation (only if setting is enabled)
    let isDying = false;
    let deathProgress = 0;
    if (this.mobDeathAnimation && enemy.deathAnimationStartTime) {
        const elapsed = this.frameTimestamp - enemy.deathAnimationStartTime;
        if (elapsed < exports.DEATH_ANIMATION_DURATION) {
            isDying = true;
            deathProgress = Math.min(1.0, elapsed / exports.DEATH_ANIMATION_DURATION); // 0 to 1, clamped
        }
    }
    // Get enemy size from mob stats
    const mobStats = (0, core_1.getMobStats)(enemy.type, enemy.tier);
    // Use visual_scale for rendering (affects visual only, not hitbox)
    const baseSize = mobStats ? mobStats.size * 40 : 40;
    const visualScale = mobStats?.visual_scale ?? 1.0;
    let enemySize = baseSize * visualScale;
    // Apply death animation effects: scale up, fade out, red tint
    let deathScale = 1.0;
    let deathAlpha = 1.0;
    if (isDying) {
        // Scale up from 1.0 to 3.0 over the animation (much larger)
        deathScale = 1.0 + (deathProgress * 2.0);
        // Fade out more intensely using cubic ease-out curve
        const easeOutProgress = deathProgress * deathProgress * deathProgress; // Cubic ease-out (more intense)
        deathAlpha = 1.0 - easeOutProgress;
        // Apply scale to size
        enemySize *= deathScale;
    }
    // Enter the mob's local frame (translate/rotate/flip) with a single
    // setTransform composed against the camera snapshot. The save()/translate/
    // rotate/restore quartet this replaces was ~50% of the mobs section under
    // CPU throttling — save() copies the full context state per call. The
    // local frame is deliberately left active on return: the next mob's
    // setTransform overwrites it, and drawGameObjects restores the base
    // transform once before the health-bar pass. Non-transform state
    // (fillStyle, font, ...) is likewise not restored, matching the codebase
    // norm of setting style state before each use; alpha is reset at the
    // exits below.
    let baseTf = this._worldBaseTf;
    if (!baseTf) {
        const tf = this.ctx.getTransform();
        baseTf = this._worldBaseTf = { a: tf.a, b: tf.b, c: tf.c, d: tf.d, e: tf.e, f: tf.f };
    }
    const angle = mobStats?.hideRotation ? 0 : (enemy.angle || 0);
    const flip = (enemy.reversed || mobStats?.reversed) ? -1 : 1;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    this.ctx.setTransform((baseTf.a * cosA + baseTf.c * sinA) * flip, (baseTf.b * cosA + baseTf.d * sinA) * flip, baseTf.c * cosA - baseTf.a * sinA, baseTf.d * cosA - baseTf.b * sinA, baseTf.a * enemy.x + baseTf.c * enemy.y + baseTf.e, baseTf.b * enemy.x + baseTf.d * enemy.y + baseTf.f);
    // Apply death animation: transparency (before drawing, preserves transparency)
    if (isDying) {
        this.ctx.globalAlpha = deathAlpha;
    }
    // Emissive light glow behind the mob, drawn in the local frame at the
    // origin — the gradient disc is radially symmetric, so the frame's
    // rotation/flip don't matter. Baked once per (color, radius); a
    // createRadialGradient + three rgba strings per mob per frame was one of
    // the top per-frame costs under CPU throttling. deathAlpha (set above)
    // fades the glow along with the body.
    if (mobStats?.emissive) {
        const hex = mobStats.light_color || mobStats.color || '#ffffff';
        const lightRadius = mobStats.light_radius ?? (enemySize * 2);
        const glow = this.getGlowSprite(hex, lightRadius);
        this.ctx.drawImage(glow, -lightRadius, -lightRadius, lightRadius * 2, lightRadius * 2);
    }
    // Special rendering for garbage mob - render as a pile of random petals
    if (enemy.type === 'garbage') {
        this.drawGarbagePile(enemy, enemySize);
        // No death tint for the garbage pile. It's drawn from baked petal
        // bitmaps, so there's no per-shape colour to blend the way the mob path
        // does — and the source-atop rect this used to do tinted a square of
        // the ground rather than the pile (source-atop clips to the whole
        // canvas's alpha, and the world background is opaque by then). Tinting
        // bitmaps correctly needs an offscreen layer per dying mob, which isn't
        // worth it for one mob type; the scale-up and fade-out still read as a
        // death. Revisit if petals ever gain a vector draw path.
        // Local frame stays active (next mob overwrites it); health bars are
        // drawn by drawGameObjects in a single world-frame pass afterwards.
        if (isDying)
            this.ctx.globalAlpha = 1.0;
        return;
    }
    // NOTE: imageSmoothingEnabled is NOT touched per mob — drawGameObjects
    // sets it once for the whole pass. Per-mob toggles broke Chrome's canvas
    // op batching (a pipeline flush per mob on the GPU path).
    const cacheKey = `${enemy.type}_${enemy.tier}`;
    const mobSVG = this.mobSVGCache[cacheKey];
    // Pass raw time to the canvas-command renderer — it handles animation
    // timing internally using each animation's own dur/repeatCount.
    let currentTime = this.frameTimestamp;
    // If enemy is chasing, play animation 2x faster
    if (enemy.isChasing && (enemy.aiType === 'hostile' || enemy.aiType === 'neutral')) {
        currentTime = this.frameTimestamp * 2;
    }
    let rendered = false;
    // Mobs are drawn straight from their compiled canvas commands, at the mob's
    // real size, every frame. There is deliberately NO bitmap bake in front of
    // this — one was added in e847451 and removed again after measurement: it
    // bought ~0.5ms/frame at 100 mobs and cost first-sight bake stalls (18ms in
    // one frame, hundreds under throttle), an atlas that grew to GBs because
    // nothing evicted it, and animation quantized to the baked frame count.
    // Above ~256px the live path is also simply FASTER than blitting a baked
    // frame, since the bake downscales a big source on every draw.
    if (mobSVG && this.svgRenderer.isInitialized()) {
        try {
            // x, y, rotation are 0 because transforms are already applied by the context
            // Pass true to indicate this is a mob render (disable anti-aliasing)
            rendered = this.svgRenderer.renderSVGToCanvas(this.ctx, mobSVG, 0, // x (already translated)
            0, // y (already translated)
            enemySize, enemySize, 0, // rotation (already rotated)
            currentTime, true, // disableAntiAliasing flag
            // Death tint: blended into each shape as it's painted. Doing it
            // afterwards with a source-atop rect (as this used to) tinted a
            // square of the world instead of the mob — source-atop clips to
            // the whole canvas's alpha and the background is opaque by then.
            isDying ? { color: '#ff0000', amount: 0.15 + deathProgress * 0.15 } : null);
        }
        catch (error) {
            console.error(`[Graphics] Error rendering enemy SVG for ${cacheKey}:`, error);
        }
    }
    // If WASM renderer didn't work, use sprite fallback (no data URLs)
    if (!rendered) {
        // Draw a colored circle as fallback
        // This should ALWAYS render something visible
        {
            const tierColor = this.ENEMY_COLORS[enemy.tier] || '#ff0000';
            // Ensure we're in the right context state
            this.ctx.globalAlpha = 1.0;
            this.ctx.fillStyle = tierColor;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, enemySize / 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        }
        // No async loading - mobs use canvas rendering via svgRenderer (no data URLs)
    }
    // Draw hitbox if enabled (before restore, so it's in enemy's coordinate space)
    // Use baseSize for hitbox (actual collision size, not visual size)
    if (this.showHitboxes) {
        this.ctx.strokeStyle = this.ENEMY_COLORS[enemy.tier];
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
        this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
        this.ctx.beginPath();
        this.ctx.arc(0, 0, baseSize / 2, 0, Math.PI * 2);
        this.ctx.stroke();
    }
    // No post-hoc tint pass here: the death tint is blended per shape by the
    // renderer (see the `tint` argument above), so it lands on the mob instead
    // of on a rectangle of whatever was underneath it.
    // Local frame stays active (next mob overwrites it); health bars are
    // drawn by drawGameObjects in a single world-frame pass afterwards.
    if (isDying)
        this.ctx.globalAlpha = 1.0;
};
core_1.Graphics.prototype.getEligiblePetalTypes = function () {
    if (!this.cachedEligiblePetalTypes) {
        const allPetalTypes = (0, core_1.getAllPetalTypes)();
        this.cachedEligiblePetalTypes = allPetalTypes.filter(petalType => {
            const stats = (0, core_1.getPetalStats)(petalType, 'common');
            return stats && !stats.isAdminPetal && !(0, core_1.isUndroppableEggPetalType)(petalType) && petalType !== 'cutter' && petalType !== 'lightning_cutter';
        });
    }
    return this.cachedEligiblePetalTypes;
};
core_1.Graphics.prototype.drawGarbagePile = function (enemy, enemySize) {
    // Get base size for hitbox calculation
    const mobStats = (0, core_1.getMobStats)(enemy.type, enemy.tier);
    const baseSize = mobStats ? mobStats.size * 40 : 40;
    // Use enemy position as seed for deterministic random petal selection
    const seed = Math.floor(enemy.x * 1000 + enemy.y * 1000);
    const eligiblePetalTypes = this.getEligiblePetalTypes();
    const numPetals = 5 + Math.floor((seed % 5)); // 5-9 petals
    // Disable anti-aliasing for pixelated look
    this.ctx.imageSmoothingEnabled = false;
    // Draw multiple petals in a pile formation
    for (let i = 0; i < numPetals; i++) {
        // Use seeded random for consistent petal selection per garbage mob
        const petalSeed = (seed + i * 1000) % 1000000;
        const randomValue = (petalSeed / 1000000);
        const petalType = eligiblePetalTypes[Math.floor(randomValue * eligiblePetalTypes.length)];
        const rarity = 'common'; // Use common rarity for garbage pile
        const stats = (0, core_1.getPetalStats)(petalType, rarity);
        if (!stats)
            continue;
        // Calculate position in pile - spread out to fill the hitbox
        const angle = (i / numPetals) * Math.PI * 2;
        // Use larger radius to fill the hitbox area (baseSize is the hitbox diameter)
        const maxRadius = (baseSize / 2) * 0.8; // 80% of hitbox radius
        const radiusVariation = (petalSeed % 300) / 1000; // 0-0.3 variation
        const radius = maxRadius * (0.7 + radiusVariation); // 70-100% of max radius
        const petalX = Math.cos(angle) * radius;
        const petalY = Math.sin(angle) * radius + ((i % 3) * 3); // Slight stacking
        // Random rotation for each petal
        const rotation = (petalSeed % 360) * (Math.PI / 180);
        // Draw petal - make it large enough to fill the hitbox
        this.ctx.save();
        this.ctx.translate(petalX, petalY);
        this.ctx.rotate(rotation);
        // Make petals large - use baseSize to ensure they fill the hitbox
        // Each petal should be about 60-80% of the hitbox diameter
        const petalBaseSize = baseSize * (0.6 + (petalSeed % 200) / 1000); // 60-80% of hitbox
        const size = petalBaseSize * stats.size;
        const petalKey = `${petalType}_${rarity}`;
        const petalCanvas = this.getPetalCanvas(petalKey, this.frameTimestamp);
        if (petalCanvas) {
            this.ctx.drawImage(petalCanvas, -size / 2, -size / 2, size, size);
        }
        else {
            // Fallback to colored circle
            this.ctx.fillStyle = stats.color;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        }
        this.ctx.restore();
    }
    // Draw hitbox if enabled
    if (this.showHitboxes) {
        const baseSize = enemySize;
        this.ctx.strokeStyle = this.ENEMY_COLORS[enemy.tier];
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 1.0;
        this.ctx.shadowBlur = 0;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, baseSize / 2, 0, Math.PI * 2);
        this.ctx.stroke();
    }
    // Restore pass-wide smoothing (see drawGameObjects) — the pixelated look
    // above is garbage-pile-local, and later glow/label draws need it ON.
    this.ctx.imageSmoothingEnabled = true;
};
// Static overlay (mob name + rarity label + health-bar background) baked once
// per (type, tier): four text draws, two font changes, and a rounded-rect
// fill per mob per frame were a top per-frame cost with many mobs on screen.
// The canvas spans from the name line to the tier line; only the green
// health-fill roundRect stays dynamic.
const MOB_LABEL_PAD_X = 4; // room for stroke overhang
const MOB_LABEL_ASCENT = 14; // px above the name baseline kept in the canvas
core_1.Graphics.prototype.getMobLabelCanvas = function (enemy, healthBarWidth, mobName) {
    const key = `${enemy.type}_${enemy.tier}_${healthBarWidth | 0}`;
    let cell = this.mobLabelCache[key];
    if (cell)
        return cell;
    // Layout mirrors the draw code below: name baseline at y=0 (cell-local
    // MOB_LABEL_ASCENT), bar top 4px below it, tier baseline
    // +healthBarHeight+16 below the name. Baked into the shared atlas
    // sheets — see mobLabelCache.
    const healthBarHeight = 8;
    const tierDY = 4 + healthBarHeight + 12; // nameY -> tierY distance
    const w = Math.ceil(healthBarWidth + MOB_LABEL_PAD_X * 2);
    const h = MOB_LABEL_ASCENT + tierDY + 6;
    const alloc = this.atlasAlloc(w, h);
    const canvas = alloc.canvas;
    const ox = alloc.x, oy = alloc.y;
    const cctx = canvas.getContext('2d');
    cctx.save();
    cctx.beginPath();
    cctx.rect(ox, oy, w, h);
    cctx.clip();
    cctx.textAlign = 'left';
    cctx.font = '12px Ubuntu, sans-serif';
    cctx.strokeStyle = '#000000';
    cctx.lineWidth = 3;
    cctx.strokeText(mobName, ox + MOB_LABEL_PAD_X, oy + MOB_LABEL_ASCENT);
    cctx.fillStyle = 'white';
    cctx.fillText(mobName, ox + MOB_LABEL_PAD_X, oy + MOB_LABEL_ASCENT);
    // Health bar background (rounded), drawn after the name so it covers
    // descenders exactly like the old world-space draw order did.
    cctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
    cctx.beginPath();
    cctx.roundRect(ox + MOB_LABEL_PAD_X - 1, oy + MOB_LABEL_ASCENT + 3, healthBarWidth + 2, healthBarHeight + 2, healthBarHeight / 2);
    cctx.fill();
    cctx.textAlign = 'right';
    cctx.fillStyle = this.ENEMY_COLORS[enemy.tier];
    cctx.font = '10px Ubuntu, sans-serif';
    cctx.strokeStyle = '#000000';
    cctx.lineWidth = 3;
    const tierLabel = enemy.tier.charAt(0).toUpperCase() + enemy.tier.slice(1);
    cctx.strokeText(tierLabel, ox + MOB_LABEL_PAD_X + healthBarWidth, oy + MOB_LABEL_ASCENT + tierDY);
    cctx.fillText(tierLabel, ox + MOB_LABEL_PAD_X + healthBarWidth, oy + MOB_LABEL_ASCENT + tierDY);
    cctx.restore();
    cell = { canvas, sx: ox, sy: oy, w, h };
    this.mobLabelCache[key] = cell;
    return cell;
};
// Drawn in world coordinates under the camera transform — no save/translate/
// restore of its own (a second per-mob save() pair showed up hot under CPU
// throttling). Steady-state cost is one drawImage + one roundRect fill.
core_1.Graphics.prototype.drawEnemyHealthBar = function (enemy, enemySize) {
    const mobStats = enemy._mobStats ?? (0, core_1.getMobStats)(enemy.type, enemy.tier);
    const mobName = mobStats ? mobStats.name : `${enemy.tier} ${enemy.type}`;
    const minHealthBarWidth = 60; // Minimum size: common hornet (size 1.0 * 40 * visual_scale 1.5)
    const healthBarWidth = Math.max(enemySize, minHealthBarWidth);
    const healthBarHeight = 8;
    const healthBarY = enemy.y + enemySize / 2 + 8;
    const radius = healthBarHeight / 2;
    const nameY = healthBarY - 4;
    // Baked name + rarity + bar-background overlay (see getMobLabelCanvas),
    // blitted 1:1 from its shared-atlas cell.
    const label = this.getMobLabelCanvas(enemy, healthBarWidth, mobName);
    this.ctx.drawImage(label.canvas, label.sx, label.sy, label.w, label.h, enemy.x - healthBarWidth / 2 - MOB_LABEL_PAD_X, nameY - MOB_LABEL_ASCENT, label.w, label.h);
    // Health bar fill (rounded) - same green as player health bar
    const clampedHealth = Math.max(0, Math.min(enemy.health, enemy.maxHealth));
    const healthFillWidth = (clampedHealth / enemy.maxHealth) * healthBarWidth;
    this.ctx.fillStyle = '#73ff54';
    this.ctx.beginPath();
    this.ctx.roundRect(enemy.x - healthBarWidth / 2, healthBarY, healthFillWidth, healthBarHeight, radius);
    this.ctx.fill();
    // Draw DPS for target dummies
    if (enemy.type === 'target_dummy' && enemy.currentDPS !== undefined) {
        const dps = enemy.currentDPS || 0;
        const formattedDPS = this.formatNumber(dps);
        const dpsText = `DPS: ${formattedDPS}`;
        this.ctx.textAlign = 'right';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '10px Ubuntu, sans-serif';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        const dpsY = healthBarY + healthBarHeight + 12 + 14;
        this.ctx.strokeText(dpsText, enemy.x + healthBarWidth / 2, dpsY);
        this.ctx.fillText(dpsText, enemy.x + healthBarWidth / 2, dpsY);
        this.ctx.textAlign = 'start'; // no restore() here anymore — reset explicitly
    }
};
