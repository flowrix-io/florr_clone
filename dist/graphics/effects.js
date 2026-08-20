"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
// Rarity ordering kept in sync with petals.RARITY_LEVELS so the client computes
// the same aura radius the server uses. Duplicating it (rather than importing
// petals.ts) keeps this draw layer free of heavy dependencies and matches the
// pattern used elsewhere in the graphics module.
const RAINDROP_RARITY_INDEX = {
    common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4,
    mythic: 5, ultra: 6, super: 7, unique: 8, apex: 9
};
const RAINDROP_AURA_BASE_RADIUS = 180;
const RAINDROP_AURA_RADIUS_PER_RARITY = 18;
/**
 * Is this loadout slot currently orbiting, judged by the server's petal
 * position stream? Returns false when the stream carries no petals for this
 * flower at all, so callers fall back to the (owner-only) cooldown flag.
 */
function hasLivePetalPosition(player, loadoutIndex) {
    const positions = player.petalPositions;
    if (!positions || positions.length === 0)
        return false;
    for (let j = 0; j < positions.length; j++) {
        if (positions[j].loadoutIndex === loadoutIndex)
            return true;
    }
    return false;
}
function getRaindropAuraRadiusFromLoadout(player) {
    if (!player.loadout)
        return 0;
    let best = 0;
    for (let i = 0; i < player.loadout.length && i < 10; i++) {
        const item = player.loadout[i];
        if (!item || item.type !== 'petal' || item.petalType !== 'raindrop' || !item.rarity)
            continue;
        // `onCooldown` is only pushed to the petal's OWNER now (see
        // server/petalEvents.ts), so on a remote flower this flag sticks at
        // true after the first break. The position stream is the live signal:
        // the server omits a broken instance from petalPositions. Trust the
        // flag only when there are no positions to check it against — petal
        // detail is budgeted per recipient, so they can be absent entirely.
        if (item.onCooldown && !hasLivePetalPosition(player, i))
            continue;
        const idx = RAINDROP_RARITY_INDEX[item.rarity] ?? 0;
        const r = RAINDROP_AURA_BASE_RADIUS + idx * RAINDROP_AURA_RADIUS_PER_RARITY;
        if (r > best)
            best = r;
    }
    return best;
}
const raindropTrails = new Map();
const RAINDROP_TILE_LIFETIME_MS = 7000;
const RAINDROP_DOT_LIFETIME_MS = 1200;
const RAINDROP_TILE_SPAWN_INTERVAL_MS = 120;
const RAINDROP_DOT_SPAWN_INTERVAL_MS = 90;
// Cap memory in the (rare) case a player camps in one spot with a huge aura.
const RAINDROP_MAX_TILES_PER_PLAYER = 400;
const RAINDROP_MAX_DOTS_PER_PLAYER = 80;
const FLOWER_COLORS = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"];
/** Reused entity snapshot; see ClientWorld.collectPlayers. */
const auraScratch = [];
core_1.Graphics.prototype.drawRaindropAuras = function (world) {
    const now = Date.now();
    const viewW = this.viewW / (this.zoomLevel * this.renderScale);
    const viewH = this.viewH / (this.zoomLevel * this.renderScale);
    const viewLeft = this.cameraX;
    const viewTop = this.cameraY;
    const viewRight = viewLeft + viewW;
    const viewBottom = viewTop + viewH;
    // Spawn new tiles/dots for any player currently emitting an aura. Cleanup
    // for players who no longer have raindrop (or who disconnected) happens
    // naturally when their trails finish fading and we drop the empty entry.
    for (const entity of world.collectPlayers(auraScratch)) {
        const player = world.playerOf(entity);
        if (!player || player.isDead)
            continue;
        const radius = getRaindropAuraRadiusFromLoadout(player);
        if (radius <= 0)
            continue;
        const playerX = world.playerX(entity);
        const playerY = world.playerY(entity);
        let trail = raindropTrails.get(player.id);
        if (!trail) {
            trail = { tiles: [], dots: [], lastTileSpawn: 0, lastDotSpawn: 0 };
            raindropTrails.set(player.id, trail);
        }
        if (now - trail.lastTileSpawn >= RAINDROP_TILE_SPAWN_INTERVAL_MS) {
            trail.lastTileSpawn = now;
            const ang = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius * 0.92;
            trail.tiles.push({
                x: playerX + Math.cos(ang) * r,
                y: playerY + Math.sin(ang) * r,
                spawnedAt: now,
                kind: Math.random() < 0.45 ? 1 : 0,
                seedA: Math.random(),
                seedB: Math.random(),
                colorIndex: Math.floor(Math.random() * FLOWER_COLORS.length)
            });
            if (trail.tiles.length > RAINDROP_MAX_TILES_PER_PLAYER) {
                trail.tiles.splice(0, trail.tiles.length - RAINDROP_MAX_TILES_PER_PLAYER);
            }
        }
        if (now - trail.lastDotSpawn >= RAINDROP_DOT_SPAWN_INTERVAL_MS) {
            trail.lastDotSpawn = now;
            const ang = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius * 0.9;
            trail.dots.push({
                x: playerX + Math.cos(ang) * r,
                y: playerY + Math.sin(ang) * r,
                spawnedAt: now
            });
            if (trail.dots.length > RAINDROP_MAX_DOTS_PER_PLAYER) {
                trail.dots.splice(0, trail.dots.length - RAINDROP_MAX_DOTS_PER_PLAYER);
            }
        }
    }
    // Render and age all trails (including those whose owner no longer has
    // raindrop equipped — their tiles still fade out gracefully).
    for (const [playerId, trail] of raindropTrails) {
        // Drop expired entries
        let tileWrite = 0;
        for (let i = 0; i < trail.tiles.length; i++) {
            const t = trail.tiles[i];
            if (now - t.spawnedAt < RAINDROP_TILE_LIFETIME_MS) {
                trail.tiles[tileWrite++] = t;
            }
        }
        trail.tiles.length = tileWrite;
        let dotWrite = 0;
        for (let i = 0; i < trail.dots.length; i++) {
            const d = trail.dots[i];
            if (now - d.spawnedAt < RAINDROP_DOT_LIFETIME_MS) {
                trail.dots[dotWrite++] = d;
            }
        }
        trail.dots.length = dotWrite;
        if (trail.tiles.length === 0 && trail.dots.length === 0) {
            raindropTrails.delete(playerId);
            continue;
        }
        this.ctx.save();
        for (let i = 0; i < trail.tiles.length; i++) {
            const tile = trail.tiles[i];
            if (tile.x + 8 < viewLeft || tile.x - 8 > viewRight ||
                tile.y + 8 < viewTop || tile.y - 8 > viewBottom)
                continue;
            const age = now - tile.spawnedAt;
            // Grow for the first 200ms, hold, fade over the final 30%.
            const growT = Math.min(1, age / 200);
            const fadeT = age < RAINDROP_TILE_LIFETIME_MS * 0.7
                ? 1
                : 1 - (age - RAINDROP_TILE_LIFETIME_MS * 0.7) / (RAINDROP_TILE_LIFETIME_MS * 0.3);
            const alpha = Math.max(0, Math.min(1, fadeT));
            const scale = growT;
            this.ctx.globalAlpha = alpha;
            if (tile.kind === 1) {
                // Tiny 5-petal flower.
                const petalR = (2.2 + tile.seedA * 1.0) * scale;
                this.ctx.fillStyle = FLOWER_COLORS[tile.colorIndex];
                this.ctx.lineWidth = 1;
                const base = tile.seedB * Math.PI * 2;
                for (let p = 0; p < 5; p++) {
                    const pa = base + (p / 5) * Math.PI * 2;
                    this.ctx.beginPath();
                    this.ctx.arc(tile.x + Math.cos(pa) * petalR, tile.y + Math.sin(pa) * petalR, petalR, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.stroke();
                }
                this.ctx.fillStyle = '#f4d65a';
                this.ctx.beginPath();
                this.ctx.arc(tile.x, tile.y, 1.4 * scale, 0, Math.PI * 2);
                this.ctx.fill();
            }
            else {
                // Grass blade.
                const lean = (tile.seedA - 0.5) * 6;
                const height = (5 + tile.seedB * 3) * scale;
                this.ctx.strokeStyle = '#3aa15c';
                this.ctx.lineWidth = 1.6;
                this.ctx.lineCap = 'round';
                this.ctx.beginPath();
                this.ctx.moveTo(tile.x, tile.y + 3 * scale);
                this.ctx.quadraticCurveTo(tile.x + lean * 0.5, tile.y - 1, tile.x + lean, tile.y - height);
                this.ctx.stroke();
            }
        }
        for (let i = 0; i < trail.dots.length; i++) {
            const dot = trail.dots[i];
            if (dot.x + 6 < viewLeft || dot.x - 6 > viewRight ||
                dot.y + 12 < viewTop || dot.y - 6 > viewBottom)
                continue;
            const age = now - dot.spawnedAt;
            const t = age / RAINDROP_DOT_LIFETIME_MS;
            if (t >= 1)
                continue;
            const alpha = 1 - t;
            const rise = t * 8;
            this.ctx.globalAlpha = 0.55 * alpha;
            this.ctx.fillStyle = '#bce7ff';
            this.ctx.strokeStyle = '#5fb6e8';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(dot.x, dot.y - rise, 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        }
        this.ctx.globalAlpha = 1;
        this.ctx.restore();
    }
};
core_1.Graphics.prototype.drawGroundPollens = function (groundPollens) {
    const now = Date.now();
    this.ctx.save();
    for (const pollen of groundPollens.values()) {
        const elapsed = now - (pollen.spawnedAt || now);
        const lifetime = pollen.lifetime || 5000;
        if (elapsed >= lifetime)
            continue;
        // Hold full opacity for first 70% of life, then fade.
        const fadeStart = lifetime * 0.7;
        const alpha = elapsed < fadeStart ? 1 : 1 - (elapsed - fadeStart) / (lifetime - fadeStart);
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = '#ffe763';
        this.ctx.strokeStyle = '#cfbb50';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(pollen.x, pollen.y, pollen.radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
    }
    this.ctx.restore();
};
/**
 * Web fields left by thrown web petals. Transcribed from gardn's
 * Client/Assets/Web.cc draw_web(): ten spokes out to the rim, then five
 * concentric rings of quadratic segments that sag toward the middle between
 * consecutive spokes, all in one translucent white stroke.
 */
core_1.Graphics.prototype.drawWebFields = function (webFields) {
    const now = Date.now();
    const SPOKES = 10;
    const LEVELS = 5;
    this.ctx.save();
    for (const web of webFields.values()) {
        const elapsed = now - (web.spawnedAt || now);
        const lifetime = web.lifetime || 10000;
        // Self-prune rather than just skipping: if the server's `webRemoved`
        // never lands (dropped under backpressure), the entry would otherwise
        // sit in the map for the rest of the session.
        if (elapsed >= lifetime) {
            webFields.delete(web.id);
            continue;
        }
        // Hold full opacity for most of its life, then fade out.
        const fadeStart = lifetime * 0.75;
        const alpha = elapsed < fadeStart ? 1 : 1 - (elapsed - fadeStart) / (lifetime - fadeStart);
        const r = web.radius;
        this.ctx.save();
        this.ctx.translate(web.x, web.y);
        this.ctx.rotate(web.angle || 0);
        this.ctx.globalAlpha = alpha * (0x60 / 0xff);
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineCap = 'round';
        // gardn strokes at 0.75 in a 10-unit web, i.e. 7.5% of the radius.
        this.ctx.lineWidth = Math.max(1, r * 0.075);
        this.ctx.beginPath();
        for (let i = 0; i < SPOKES; i++) {
            const angle = (2 * i * Math.PI) / SPOKES;
            this.ctx.moveTo(0, 0);
            this.ctx.lineTo(r * Math.cos(angle), r * Math.sin(angle));
        }
        for (let j = 0; j < LEVELS; j++) {
            const curr = (j * r) / LEVELS;
            const below = curr - r / (2 * LEVELS);
            this.ctx.moveTo(curr, 0);
            for (let i = 0; i < SPOKES; i++) {
                const angle = (2 * (i + 1) * Math.PI) / SPOKES;
                const before = ((2 * i + 1) * Math.PI) / SPOKES;
                this.ctx.quadraticCurveTo(below * Math.cos(before), below * Math.sin(before), curr * Math.cos(angle), curr * Math.sin(angle));
            }
        }
        this.ctx.stroke();
        this.ctx.restore();
    }
    this.ctx.restore();
};
core_1.Graphics.prototype.drawFloatingTexts = function () {
    this.floatingTexts = this.floatingTexts.filter(text => {
        text.y -= 1;
        text.alpha -= 1 / text.lifetime;
        if (text.alpha <= 0)
            return false;
        this.ctx.save();
        // Apply camera transform to convert world coordinates to screen coordinates
        this.ctx.scale(this.zoomLevel, this.zoomLevel);
        const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
        const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;
        this.ctx.translate(-validCameraX, -validCameraY);
        this.ctx.globalAlpha = text.alpha;
        this.ctx.fillStyle = text.color;
        this.ctx.font = `${text.fontSize}px Ubuntu, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(text.text, text.x, text.y);
        this.ctx.restore();
        return true;
    });
};
core_1.Graphics.prototype.drawExplosionEffects = function () {
    this.explosionEffects = this.explosionEffects.filter(effect => {
        const elapsed = Date.now() - effect.startTime;
        const progress = elapsed / effect.lifetime;
        if (progress >= 1)
            return false;
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
            if (particleProgress <= 0)
                return false;
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
};
core_1.Graphics.prototype.drawPetalBreakEffects = function () {
    this.petalBreakEffects = this.petalBreakEffects.filter(effect => {
        const elapsed = Date.now() - effect.startTime;
        const progress = elapsed / effect.lifetime;
        return progress < 1;
    });
};
core_1.Graphics.prototype.drawLightningEffects = function () {
    this.lightningEffects = this.lightningEffects.filter(effect => {
        const elapsed = Date.now() - effect.startTime;
        const progress = elapsed / effect.lifetime;
        if (progress >= 1)
            return false;
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
};
core_1.Graphics.prototype.drawPetalParticleEffects = function () {
    this.petalParticleEffects = this.petalParticleEffects.filter(effect => {
        const elapsed = Date.now() - effect.startTime;
        const progress = elapsed / effect.lifetime;
        if (progress >= 1)
            return false;
        this.ctx.save();
        // Draw particles
        effect.particles = effect.particles.filter(particle => {
            const particleProgress = particle.life / particle.maxLife;
            if (particleProgress <= 0)
                return false;
            // Update particle position
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= 16; // Assuming 60fps, reduce by ~16ms per frame
            // particle.color is pre-blended with white at creation time
            // (see blendHexWithWhite in core.ts), so the hot path stays
            // free of hex parsing / Math.round per particle per frame.
            this.ctx.globalAlpha = particleProgress * 0.6;
            this.ctx.fillStyle = particle.color;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size * particleProgress, 0, Math.PI * 2);
            this.ctx.fill();
            return true;
        });
        this.ctx.restore();
        return true;
    });
};
core_1.Graphics.prototype.drawFallingStars = function () {
    this.fallingStars = this.fallingStars.filter(star => {
        // Update position
        star.y += star.vy;
        star.rotation += star.rotationSpeed;
        // Update lifetime
        star.lifetime -= 16; // Assuming ~60fps
        const progress = star.lifetime / star.maxLife;
        // Remove if off screen or lifetime expired
        if (star.y > this.viewH + 50 || progress <= 0) {
            return false;
        }
        // Draw star (in screen coordinates)
        this.ctx.save();
        this.ctx.globalAlpha = star.alpha * progress;
        this.ctx.translate(star.x, star.y);
        this.ctx.rotate(star.rotation);
        // Draw a star shape
        this.ctx.fillStyle = '#ffd700';
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        const points = 5;
        const outerRadius = star.size / 2;
        const innerRadius = outerRadius * 0.4;
        this.ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const angle = (i * Math.PI) / points - Math.PI / 2;
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (i === 0) {
                this.ctx.moveTo(x, y);
            }
            else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
        return true;
    });
};
