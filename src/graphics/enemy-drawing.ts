import {
    Graphics, FaceFlags, getPetalStats, getMobStats, getEnemySizeScale, mobHasRandomSize,
    getDroppablePetalTypes, PETAL_RING_ORBIT_SCALE, PETAL_RING_PETAL_SCALE, PETAL_RING_ROTATION_SPEED,
} from './core';
import { ClientWorld } from '../client_world';
import { Entity } from '../ecs';
import { drawBodyWithGlitch, glitchSeedFor } from './glitch-effect';

declare module './core' {
    interface Graphics {
        drawMobProjectile(projectile: any, currentTime?: number, petalStats?: any): void;
        drawEnemy(world: ClientWorld, enemy: Entity): void;
        drawDiggerFlower(world: ClientWorld, enemy: Entity, enemySize: number): void;
        drawPetalRingFlower(world: ClientWorld, enemy: Entity, enemySize: number, mobStats: any): void;
        getEligiblePetalTypes(): string[];
        drawGarbagePile(world: ClientWorld, enemy: Entity, enemySize: number): void;
        drawEnemyHealthBar(world: ClientWorld, enemy: Entity, enemySize: number): void;
        getMobLabelCanvas(cacheKey: string, tier: string, healthBarWidth: number, mobName: string): { canvas: HTMLCanvasElement; sx: number; sy: number; w: number; h: number };
    }
}

/**
 * Ease a mob's eye toward where it is facing, and store it back.
 *
 * The eye lives in a component so it dies with the mob; the ease itself stays
 * here because it is a fixed fraction per FRAME (0.15), not per second, and
 * moving it into a scheduler system would change how eyes track at any refresh
 * rate other than 60Hz.
 */
function easeMobEye(world: ClientWorld, enemy: Entity, angle: number): { x: number; y: number } {
    const targetX = Math.cos(angle) * 2;
    const targetY = Math.sin(angle) * 4.4;
    if (!world.hasEye(enemy)) return { x: targetX, y: targetY };
    if (!world.eyeInitialised(enemy)) {
        // First sight starts ON target: a mob popping in should not roll its
        // eyes into place from the origin.
        world.setEye(enemy, targetX, targetY);
        return { x: targetX, y: targetY };
    }
    const x = world.eyeX(enemy) + (targetX - world.eyeX(enemy)) * 0.15;
    const y = world.eyeY(enemy) + (targetY - world.eyeY(enemy)) * 0.15;
    world.setEye(enemy, x, y);
    return { x, y };
}

// Shared with drawGameObjects' health-bar pass, which must skip mobs whose
// death animation is running (drawEnemy scales/fades them instead).
export const DEATH_ANIMATION_DURATION = 200; // ms

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
            this.ctx.drawImage(
                petalCanvas,
                -petalSize / 2,
                -petalSize / 2,
                petalSize,
                petalSize
            );
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

Graphics.prototype.drawEnemy = function(this: Graphics, world: ClientWorld, enemy: Entity) {
    // Component reads hoisted once. Everything below works off these locals, so
    // there is exactly one place each field is sourced from.
    const enemyX = world.mobX(enemy);
    const enemyY = world.mobY(enemy);
    const enemyType = world.mobType(enemy);
    const enemyTier = world.mobTier(enemy);
    if (!isFinite(enemyX) || !isFinite(enemyY)) {
        console.error('[Graphics] Invalid enemy position:', world.mobId(enemy));
        return;
    }

    // Check if enemy is in death animation (only if setting is enabled)
    let isDying = false;
    let deathProgress = 0;
    const deathStart = world.deathAnimationStart(enemy);
    if (this.mobDeathAnimation && deathStart !== 0) {
        const elapsed = this.frameTimestamp - deathStart;
        if (elapsed < DEATH_ANIMATION_DURATION) {
            isDying = true;
            deathProgress = Math.min(1.0, elapsed / DEATH_ANIMATION_DURATION); // 0 to 1, clamped
        }
    }

    // Get enemy size from mob stats. A pet is drawn smaller than the wild mob of
    // its rarity (getEnemySizeScale) — the same factor the server applies to its
    // hitbox, so the sprite and what it collides with stay the same circle.
    const mobStats = getMobStats(enemyType, enemyTier);
    // Use visual_scale for rendering (affects visual only, not hitbox)
    // The id fetch is gated on mobHasRandomSize: mobId() allocates, and this
    // runs per mob per frame (see the mob-bake note in client_world).
    const baseSize = (mobStats ? mobStats.size * 40 : 40)
        * getEnemySizeScale(world.isPet(enemy), enemyTier, enemyType, mobHasRandomSize(enemyType) ? world.mobId(enemy) : undefined);
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
    const angle = mobStats?.hideRotation ? 0 : world.mobAngle(enemy);
    const flip = (world.mobFlipped(enemy) || mobStats?.reversed) ? -1 : 1;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    this.ctx.setTransform(
        (baseTf.a * cosA + baseTf.c * sinA) * flip,
        (baseTf.b * cosA + baseTf.d * sinA) * flip,
        baseTf.c * cosA - baseTf.a * sinA,
        baseTf.d * cosA - baseTf.b * sinA,
        baseTf.a * enemyX + baseTf.c * enemyY + baseTf.e,
        baseTf.b * enemyX + baseTf.d * enemyY + baseTf.f
    );

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
    if (enemyType === 'garbage') {
        this.drawGarbagePile(world, enemy, enemySize);

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
        if (isDying) this.ctx.globalAlpha = 1.0;
        return;
    }

    // NOTE: imageSmoothingEnabled is NOT touched per mob — drawGameObjects
    // sets it once for the whole pass. Per-mob toggles broke Chrome's canvas
    // op batching (a pipeline flush per mob on the GPU path).

    // Memoised by interned (type, tier) — building this string per mob per
    // frame is an allocation right where the measured mob-pass optimisations
    // live. See ClientWorld.mobCacheKey.
    const cacheKey = world.mobCacheKey(enemy);
    const mobSVG = this.mobSVGCache[cacheKey];

    // Pass raw time to the canvas-command renderer — it handles animation
    // timing internally using each animation's own dur/repeatCount.
    let currentTime = this.frameTimestamp;

    // If enemy is chasing, play animation 2x faster
    if (world.mobAnimatesFast(enemy)) {
        currentTime = this.frameTimestamp * 2;
    }

    let rendered = false;

    // The digger is a flower, not a sprite: gardn dispatches kDigger straight
    // into draw_static_flower instead of a mob drawing, so it renders here
    // through the same flower path players use. No death tint on this branch —
    // the tint is blended per shape by the SVG renderer below and there are no
    // shapes here; the scale-up and fade still read as a death (same trade-off
    // as the garbage pile above).
    if (enemyType === 'digger') {
        this.drawDiggerFlower(world, enemy, enemySize);
        rendered = true;
    } else if (mobStats?.petal_ring) {
        // Same deal for petal-ring mobs (the glitch flower): they are flowers
        // carrying petals, so they go through the flower path rather than an SVG.
        this.drawPetalRingFlower(world, enemy, enemySize, mobStats);
        rendered = true;
    }

    // Mobs are drawn straight from their compiled canvas commands, at the mob's
    // real size, every frame. There is deliberately NO bitmap bake in front of
    // this — one was added in e847451 and removed again after measurement: it
    // bought ~0.5ms/frame at 100 mobs and cost first-sight bake stalls (18ms in
    // one frame, hundreds under throttle), an atlas that grew to GBs because
    // nothing evicted it, and animation quantized to the baked frame count.
    // Above ~256px the live path is also simply FASTER than blitting a baked
    // frame, since the bake downscales a big source on every draw.
    if (!rendered && mobSVG && this.svgRenderer.isInitialized()) {
        try {
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
                true, // disableAntiAliasing flag
                // Death tint: blended into each shape as it's painted. Doing it
                // afterwards with a source-atop rect (as this used to) tinted a
                // square of the world instead of the mob — source-atop clips to
                // the whole canvas's alpha and the background is opaque by then.
                isDying ? { color: '#ff0000', amount: 0.15 + deathProgress * 0.15 } : null
            );
        } catch (error) {
            console.error(`[Graphics] Error rendering enemy SVG for ${cacheKey}:`, error);
        }
    }

    // If WASM renderer didn't work, use sprite fallback (no data URLs)
    if (!rendered) {
        // Draw a colored circle as fallback
        // This should ALWAYS render something visible
        {
            const tierColor = this.ENEMY_COLORS[enemyTier] || '#ff0000';
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
        this.ctx.strokeStyle = this.ENEMY_COLORS[enemyTier];
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
    if (isDying) this.ctx.globalAlpha = 1.0;
};

// gardn's ColorID::kGray (FLOWER_COLORS[1] = 0xff999999) — the body colour its
// digger is spawned with. Not read off mob stats: generateMobStats overwrites
// every mob's `color` with its rarity colour.
const DIGGER_FLOWER_COLOR = '#999999';

/**
 * Draw the digger as a flower with a spinning cutter, mirroring gardn's
 * kDigger case (Client/Assets/Mob.cc): draw_static_flower with a gray body,
 * square eyes and an equipped cutter, i.e. it looks like a player carrying a
 * cutter rather than like a bug.
 *
 * Called with the mob's local frame already active (origin at the mob centre,
 * and unrotated — the digger's `hideRotation` keeps its face upright the way a
 * flower's is). The flower art is authored in radius-25 space, the same space
 * drawFlower and the player petal ring use, so everything scales by radius/25.
 */
Graphics.prototype.drawDiggerFlower = function(this: Graphics, world: ClientWorld, enemy: Entity, enemySize: number) {
    const ctx = this.ctx;
    const radius = enemySize / 2;
    const scale = radius / 25;

    // Cutter first, so the blade sits behind the face. It spins off wallclock at
    // the rate an equipped cutter does on a player (drawPlayerPetals: petal
    // speed * 0.002 rad/ms) and is sized like one (12 * petal size), so the
    // digger's blade and a player's read as the same object.
    const cutterStats = getPetalStats('cutter', 'common');
    const cutterCanvas = this.getPetalCanvas('cutter_common', this.frameTimestamp);
    if (cutterStats && cutterCanvas && cutterCanvas.width > 0 && cutterCanvas.height > 0) {
        const cutterSize = 12 * cutterStats.size * scale;
        ctx.save();
        ctx.rotate((this.frameTimestamp * (cutterStats.speed ?? 1.0) * 0.002) % (Math.PI * 2));
        ctx.drawImage(cutterCanvas, -cutterSize / 2, -cutterSize / 2, cutterSize, cutterSize);
        ctx.restore();
    }

    // The body never rotates, so the digger has to show where it is heading with
    // its eyes — same offsets and easing drawPlayer uses for a flower.
    const eye = easeMobEye(world, enemy, world.mobAngle(enemy));

    this.drawFlower({
        radius,
        color: DIGGER_FLOWER_COLOR,
        faceFlags: FaceFlags.SquareEyes,
        // Not EquipmentFlags.Cutter: drawFlower has no cutter branch (a player's
        // cutter is drawn by the petal ring), and the blade is already drawn above.
        equipFlags: 0,
        eyeX: eye.x,
        eyeY: eye.y,
        mouth: 14.5,
    });
};

// The body colour of a flower-shaped mob. Not read off mob stats:
// generateMobStats overwrites every mob's `color` with its rarity colour, and
// the point of this mob is that it looks like a flower.
const PETAL_RING_FLOWER_COLOR = '#ffe763';

/**
 * Draw a mob that carries an orbiting petal ring (the glitch flower) as a
 * flower with petals, i.e. as something that looks like a player rather than
 * like a bug — the same treatment the digger gets, one config field further:
 * the ring's petal art and count come from the mob's `petal_ring`, and the
 * geometry from the shared PETAL_RING_* constants the server damages with.
 *
 * Called with the mob's local frame active (origin at the mob centre, and
 * unrotated — `hideRotation` keeps the face upright the way a flower's is).
 * Every distance is a multiple of the mob's own radius, so the ring grows with
 * rarity along with the body and the server's damage band lines up with it.
 *
 * Petal angles come from the viewer's own clock and are never broadcast: the
 * ring is a spinning wheel of identical petals, so it reads correctly without a
 * synchronised phase. The server's damage test is angle-blind for the same
 * reason (see applyPetalRingDamage).
 */
Graphics.prototype.drawPetalRingFlower = function(this: Graphics, world: ClientWorld, enemy: Entity, enemySize: number, mobStats: any) {
    const ring = mobStats?.petal_ring;
    if (!ring) return;
    const radius = enemySize / 2;

    // Eased eye offset, mirroring drawPlayer — with the body upright, the eyes
    // are the only thing showing which way the mob is coming at you.
    const eye = easeMobEye(world, enemy, world.mobAngle(enemy));

    const tier = world.mobTier(enemy);
    const petalStats = getPetalStats(ring.petalType, tier);
    const petalKey = `${ring.petalType}_${tier}`;
    const orbitRadius = radius * PETAL_RING_ORBIT_SCALE;
    const petalSize = radius * PETAL_RING_PETAL_SCALE * (petalStats?.size ?? 1);
    const count = Math.max(0, Math.min(16, ring.count || 0));
    const rotation = (this.frameTimestamp * (petalStats?.speed ?? 1.0) * PETAL_RING_ROTATION_SPEED) % (Math.PI * 2);
    const angleStep = count > 0 ? (Math.PI * 2) / count : 0;

    // Body first, then the ring on top — same order a player is drawn in.
    const drawFlowerAndRing = () => {
        const ctx = this.ctx; // read at call time: the glitch wrapper swaps it
        this.drawFlower({
            radius,
            color: PETAL_RING_FLOWER_COLOR,
            faceFlags: FaceFlags.SquareEyes,
            equipFlags: 0,
            eyeX: eye.x,
            eyeY: eye.y,
            mouth: 14.5,
        });

        const petalCanvas = this.getPetalCanvas(petalKey, this.frameTimestamp);
        if (!petalCanvas || petalCanvas.width <= 0 || petalCanvas.height <= 0) return;
        for (let i = 0; i < count; i++) {
            const petalAngle = i * angleStep + rotation;
            const px = Math.cos(petalAngle) * orbitRadius;
            const py = Math.sin(petalAngle) * orbitRadius;
            ctx.drawImage(petalCanvas, px - petalSize / 2, py - petalSize / 2, petalSize, petalSize);
        }
    };

    this.ctx.save();
    if (world.mobType(enemy) === 'glitch_flower') {
        // Wraps body AND ring, so the whole flower tears as one object. The
        // radius handed to the wrapper has to cover the ring, not just the body
        // (it sizes its buffer at radius * 2 + 24), hence the orbit scale.
        drawBodyWithGlitch(this, radius * (PETAL_RING_ORBIT_SCALE / 2 + 0.3), glitchSeedFor(world.mobId(enemy)), drawFlowerAndRing);
    } else {
        drawFlowerAndRing();
    }
    this.ctx.restore();
};

Graphics.prototype.getEligiblePetalTypes = function(this: Graphics): string[] {
    if (!this.cachedEligiblePetalTypes) {
        // Must match what the server can actually spawn (petals.ts), or the ring
        // advertises petals the spawner never gives out.
        this.cachedEligiblePetalTypes = getDroppablePetalTypes();
    }
    return this.cachedEligiblePetalTypes;
};

Graphics.prototype.drawGarbagePile = function(this: Graphics, world: ClientWorld, enemy: Entity, enemySize: number) {
    // Get base size for hitbox calculation
    const tier = world.mobTier(enemy);
    const mobType = world.mobType(enemy);
    const mobStats = getMobStats(mobType, tier);
    const baseSize = (mobStats ? mobStats.size * 40 : 40)
        * getEnemySizeScale(world.isPet(enemy), tier, mobType, mobHasRandomSize(mobType) ? world.mobId(enemy) : undefined);

    // Use enemy position as seed for deterministic random petal selection
    const seed = Math.floor(world.mobX(enemy) * 1000 + world.mobY(enemy) * 1000);
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
        this.ctx.strokeStyle = this.ENEMY_COLORS[tier];
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
const MOB_LABEL_PAD_X = 4;   // room for stroke overhang
const MOB_LABEL_ASCENT = 14; // px above the name baseline kept in the canvas
Graphics.prototype.getMobLabelCanvas = function(this: Graphics, cacheKey: string, tier: string, healthBarWidth: number, mobName: string): { canvas: HTMLCanvasElement; sx: number; sy: number; w: number; h: number } {
    const key = `${cacheKey}_${healthBarWidth | 0}`;
    let cell = this.mobLabelCache[key];
    if (cell) return cell;

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
    const cctx = canvas.getContext('2d')!;
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
    cctx.fillStyle = this.ENEMY_COLORS[tier as keyof typeof this.ENEMY_COLORS];
    cctx.font = '10px Ubuntu, sans-serif';
    cctx.strokeStyle = '#000000';
    cctx.lineWidth = 3;
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
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
Graphics.prototype.drawEnemyHealthBar = function(this: Graphics, world: ClientWorld, enemy: Entity, enemySize: number) {
    const enemyX = world.mobX(enemy);
    const enemyY = world.mobY(enemy);
    const enemyType = world.mobType(enemy);
    const enemyTier = world.mobTier(enemy);
    const mobStats = getMobStats(enemyType, enemyTier);
    const mobName = mobStats ? mobStats.name : `${enemyTier} ${enemyType}`;

    const minHealthBarWidth = 60; // Minimum size: common hornet (size 1.0 * 40 * visual_scale 1.5)
    const healthBarWidth = Math.max(enemySize, minHealthBarWidth);
    const healthBarHeight = 8;
    const healthBarY = enemyY + enemySize / 2 + 8;
    const radius = healthBarHeight / 2;
    const nameY = healthBarY - 4;

    // Baked name + rarity + bar-background overlay (see getMobLabelCanvas),
    // blitted 1:1 from its shared-atlas cell.
    const label = this.getMobLabelCanvas(world.mobCacheKey(enemy), enemyTier, healthBarWidth, mobName);
    this.ctx.drawImage(label.canvas, label.sx, label.sy, label.w, label.h,
        enemyX - healthBarWidth / 2 - MOB_LABEL_PAD_X, nameY - MOB_LABEL_ASCENT, label.w, label.h);

    // Health bar fill (rounded) - same green as player health bar
    const maxHealth = world.mobMaxHealth(enemy);
    const clampedHealth = Math.max(0, Math.min(world.mobHealth(enemy), maxHealth));
    const healthFillWidth = (clampedHealth / maxHealth) * healthBarWidth;
    this.ctx.fillStyle = '#73ff54';
    this.ctx.beginPath();
    this.ctx.roundRect(enemyX - healthBarWidth / 2, healthBarY, healthFillWidth, healthBarHeight, radius);
    this.ctx.fill();

    // Draw DPS for target dummies
    const reportedDps = world.mobDps(enemy);
    if (enemyType === 'target_dummy' && reportedDps !== undefined) {
        const dps = reportedDps || 0;
        const formattedDPS = this.formatNumber(dps);
        const dpsText = `DPS: ${formattedDPS}`;
        this.ctx.textAlign = 'right';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '10px Ubuntu, sans-serif';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        const dpsY = healthBarY + healthBarHeight + 12 + 14;
        this.ctx.strokeText(dpsText, enemyX + healthBarWidth / 2, dpsY);
        this.ctx.fillText(dpsText, enemyX + healthBarWidth / 2, dpsY);
        this.ctx.textAlign = 'start'; // no restore() here anymore — reset explicitly
    }
};
