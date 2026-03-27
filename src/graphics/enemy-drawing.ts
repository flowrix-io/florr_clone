import { Graphics, Enemy, getPetalStats, getAllPetalTypes, getMobStats, MOB_CONFIG, getMobAnimationFrameTime } from './core';

declare module './core' {
    interface Graphics {
        drawMobProjectile(projectile: any, currentTime?: number, petalStats?: any): void;
        drawEnemy(enemy: Enemy): void;
        getEligiblePetalTypes(): string[];
        drawGarbagePile(enemy: Enemy, enemySize: number): void;
        drawEnemyHealthBar(enemy: Enemy, enemySize: number): void;
    }
}

Graphics.prototype.drawMobProjectile = function(this: Graphics, projectile: any, currentTime?: number, petalStats?: any) {
    if (!projectile || typeof projectile.x !== 'number' || typeof projectile.y !== 'number') {
        return;
    }

    // Get petal stats for rendering (use cached if provided)
    if (!petalStats) {
        petalStats = getPetalStats(projectile.petalType, projectile.petalRarity);
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
            this.ctx.drawImage(
                petalCanvas,
                -petalSize / 2,
                -petalSize / 2,
                petalSize,
                petalSize
            );

            // Add rarity glow effect for non-common projectiles
            if (projectile.petalRarity !== 'common') {
                this.ctx.save();
                this.ctx.shadowColor = petalStats.color;
                this.ctx.shadowBlur = 5;
                this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                this.ctx.restore();
            }
        } catch (error) {
            console.error(`[Graphics] Error drawing projectile petal image:`, error);
            // Fallback to colored circle if image fails
            this.ctx.fillStyle = petalStats.color;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, petalSize / 2, 0, Math.PI * 2);
            this.ctx.fill();
        }
    } else {
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

    this.ctx.restore();
};

Graphics.prototype.drawEnemy = function(this: Graphics, enemy: Enemy) {
    // Validate enemy has required properties
    if (!enemy || typeof enemy.x !== 'number' || typeof enemy.y !== 'number') {
        console.error('[Graphics] Invalid enemy data:', enemy);
        return;
    }

    // Check if enemy is in death animation (only if setting is enabled)
    const DEATH_ANIMATION_DURATION = 200; // 200ms animation
    let isDying = false;
    let deathProgress = 0;
    if (this.mobDeathAnimation && enemy.deathAnimationStartTime) {
        const elapsed = this.frameTimestamp - enemy.deathAnimationStartTime;
        if (elapsed < DEATH_ANIMATION_DURATION) {
            isDying = true;
            deathProgress = Math.min(1.0, elapsed / DEATH_ANIMATION_DURATION); // 0 to 1, clamped
        }
    }

    // Get enemy size from mob stats
    const mobStats = getMobStats(enemy.type, enemy.tier);
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

    // Always set up the transform for the enemy position
    // The context already has camera transforms applied, so we translate to world position
    this.ctx.save();
    this.ctx.translate(enemy.x, enemy.y);

    // Only apply rotation if hideRotation is not set
    if (!mobStats?.hideRotation) {
        this.ctx.rotate(enemy.angle || 0);
    }

    // Flip horizontally if reversed is true
    if (enemy.reversed || mobStats?.reversed) {
        this.ctx.scale(-1, 1);
    }

    // Apply death animation: transparency (before drawing, preserves transparency)
    if (isDying) {
        this.ctx.globalAlpha = deathAlpha;
    }

    // Special rendering for garbage mob - render as a pile of random petals
    if (enemy.type === 'garbage') {
        this.drawGarbagePile(enemy, enemySize);

        // Apply red tint overlay for death animation using composite operations
        if (isDying) {
            const tintIntensity = 0.15 + (deathProgress * 0.15);
            this.ctx.globalCompositeOperation = 'source-atop';
            this.ctx.fillStyle = `rgba(255, 0, 0, ${tintIntensity})`;
            this.ctx.fillRect(-enemySize / 2, -enemySize / 2, enemySize, enemySize);
            this.ctx.globalCompositeOperation = 'source-over';
        }

        this.ctx.restore();

        // Don't draw health bar during death animation
        if (!isDying) {
            // Draw health bar and tier (after restore, so we need to set up transforms again)
            this.drawEnemyHealthBar(enemy, enemySize);
        }
        return;
    }

    // Disable anti-aliasing for mobs (pixelated look)
    this.ctx.imageSmoothingEnabled = false;

    // Debug: Always draw something visible to verify coordinates work
    // This ensures we can see enemies even if images/sprites fail

    const cacheKey = `${enemy.type}_${enemy.tier}`;
    const mobSVG = this.mobSVGCache[cacheKey];

    // Use relative time for animation (wraps within animation cycle)
    // Per-mob cycle duration ensures animations loop seamlessly
    const frameTime = getMobAnimationFrameTime();
    const framesPerCycle = this.svgRenderer.getFramesPerCycleForSVG(mobSVG);
    const animationCycleDuration = framesPerCycle * frameTime;
    let currentTime = this.frameTimestamp % animationCycleDuration;

    // If enemy is chasing, play animation 2x faster
    if (enemy.isChasing && enemy.isHostile) {
        // Multiply time by 2 to make animation play 2x faster
        currentTime = (currentTime * 2) % animationCycleDuration;
    }

    // Try to use WASM SVG renderer with animations first
    let rendered = false;

    // Check if WASM renderer is available and not in fallback mode
    // Note: We check isInitialized() but not isUsingFallback() because
    // the renderer might use WASM for animation even if image loading falls back
    if (mobSVG && this.svgRenderer.isInitialized()) {
        try {
            // Use SVG renderer to render animated SVG (synchronous - uses cached canvases)
            // x, y, rotation are 0 because transforms are already applied by the context
            // Pass true to indicate this is a mob render (disable anti-aliasing)
            rendered = this.svgRenderer.renderSVGToCanvas(
                this.ctx,
                mobSVG,
                0, // x (already translated)
                0, // y (already translated)
                enemySize,
                enemySize,
                0, // rotation (already rotated)
                currentTime,
                true // disableAntiAliasing flag
            );

            // Debug: Log when WASM rendering is attempted
        } catch (error) {
            console.error(`[Graphics] Error rendering enemy SVG with WASM for ${cacheKey}:`, error);
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

    // Apply red tint overlay for death animation using composite operations
    if (isDying) {
        const tintIntensity = 0.15 + (deathProgress * 0.15);
        this.ctx.globalCompositeOperation = 'source-atop';
        this.ctx.fillStyle = `rgba(255, 0, 0, ${tintIntensity})`;
        this.ctx.fillRect(-enemySize / 2, -enemySize / 2, enemySize, enemySize);
        this.ctx.globalCompositeOperation = 'source-over';
    }

    this.ctx.restore();

    // Don't draw health bar during death animation
    if (!isDying) {
        // Draw health bar and tier
        this.drawEnemyHealthBar(enemy, enemySize);
    }
};

Graphics.prototype.getEligiblePetalTypes = function(this: Graphics): string[] {
    if (!this.cachedEligiblePetalTypes) {
        const allPetalTypes = getAllPetalTypes();
        this.cachedEligiblePetalTypes = allPetalTypes.filter(petalType => {
            const stats = getPetalStats(petalType, 'common');
            return stats && !stats.isAdminPetal && petalType !== 'cutter' && petalType !== 'lightning_cutter';
        });
    }
    return this.cachedEligiblePetalTypes;
};

Graphics.prototype.drawGarbagePile = function(this: Graphics, enemy: Enemy, enemySize: number) {
    // Get base size for hitbox calculation
    const mobStats = getMobStats(enemy.type, enemy.tier);
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

        const stats = getPetalStats(petalType, rarity);
        if (!stats) continue;

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
        } else {
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
};

Graphics.prototype.drawEnemyHealthBar = function(this: Graphics, enemy: Enemy, enemySize: number) {
    const mobStats = getMobStats(enemy.type, enemy.tier);
    const mobName = mobStats ? mobStats.name : `${enemy.tier} ${enemy.type}`;

    this.ctx.save();
    this.ctx.translate(enemy.x, enemy.y);

    const minHealthBarWidth = 60; // Minimum size: common hornet (size 1.0 * 40 * visual_scale 1.5)
    const healthBarWidth = Math.max(enemySize, minHealthBarWidth);
    const healthBarHeight = 8;
    const healthBarY = enemySize / 2 + 8;
    const radius = healthBarHeight / 2;

    // Draw mob name above health bar, left-aligned
    this.ctx.textAlign = 'left';
    this.ctx.font = '12px Ubuntu, sans-serif';
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 3;
    const nameX = -healthBarWidth / 2;
    const nameY = healthBarY - 4;
    this.ctx.strokeText(mobName, nameX, nameY);
    this.ctx.fillStyle = 'white';
    this.ctx.fillText(mobName, nameX, nameY);

    // Health bar background (rounded)
    this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
    this.ctx.beginPath();
    this.ctx.roundRect(-healthBarWidth / 2 - 1, healthBarY - 1, healthBarWidth + 2, healthBarHeight + 2, radius);
    this.ctx.fill();

    // Health bar fill (rounded) - same green as player health bar
    const clampedHealth = Math.max(0, Math.min(enemy.health, enemy.maxHealth));
    const healthFillWidth = (clampedHealth / enemy.maxHealth) * healthBarWidth;
    this.ctx.fillStyle = '#73ff54';
    this.ctx.beginPath();
    this.ctx.roundRect(-healthBarWidth / 2, healthBarY, healthFillWidth, healthBarHeight, radius);
    this.ctx.fill();

    // Draw rarity below the health bar at bottom right
    this.ctx.textAlign = 'right';
    this.ctx.fillStyle = this.ENEMY_COLORS[enemy.tier];
    this.ctx.font = '10px Ubuntu, sans-serif';
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 3;
    const tierX = healthBarWidth / 2;
    const tierY = healthBarY + healthBarHeight + 12;
    const tierLabel = enemy.tier.charAt(0).toUpperCase() + enemy.tier.slice(1);
    this.ctx.strokeText(tierLabel, tierX, tierY);
    this.ctx.fillText(tierLabel, tierX, tierY);

    // Draw DPS for target dummies
    if (enemy.type === 'target_dummy' && enemy.currentDPS !== undefined) {
        const dps = enemy.currentDPS || 0;
        const formattedDPS = this.formatNumber(dps);
        const dpsText = `DPS: ${formattedDPS}`;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '10px Ubuntu, sans-serif';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        const dpsY = tierY + 14;
        this.ctx.strokeText(dpsText, tierX, dpsY);
        this.ctx.fillText(dpsText, tierX, dpsY);
    }

    this.ctx.restore();
};
