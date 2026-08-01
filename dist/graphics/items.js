"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
// Canvas size: 50x50 rarity box + text below (needs ~18px extra) + padding
const ITEM_CANVAS_SIZE = 60;
const ITEM_CANVAS_CENTER = 30;
const SPAWN_ANIM_DURATION = 400; // ms
const PICKUP_ANIM_DURATION = 150; // ms
const DESPAWN_ANIM_DURATION = 300; // ms
core_1.Graphics.prototype.getItemCanvas = function (item) {
    if (!this.itemCanvasCache) {
        this.itemCanvasCache = new Map();
    }
    // Build cache key from visual properties
    // For petals: cache background (rarity box + text) only, petal drawn separately
    const isPetal = item.type === 'petal';
    const nameKey = isPetal ? (item.petalType || '') : item.type;
    const key = `${item.type}|${item.rarity || 'none'}|${nameKey}|${isPetal ? 'bg' : 'full'}`;
    let cached = this.itemCanvasCache.get(key);
    if (cached)
        return cached;
    const canvas = document.createElement('canvas');
    canvas.width = ITEM_CANVAS_SIZE;
    canvas.height = ITEM_CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        return null;
    ctx.translate(ITEM_CANVAS_CENTER, ITEM_CANVAS_CENTER);
    // Draw rarity background
    if (item.rarity) {
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
        ctx.roundRect(-30, -30, 60, 60, 3);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(-25, -25, 50, 50, 3);
        ctx.lineWidth = 5;
        ctx.strokeStyle = this.darkenColor(this.ITEM_RARITY_COLORS[item.rarity], 30);
        ctx.stroke();
        ctx.fillStyle = `${this.ITEM_RARITY_COLORS[item.rarity]}`;
        ctx.fill();
        ctx.restore();
    }
    // Draw sprite only for non-petal items (petal drawn on top separately).
    // The sprite must be checked for readiness, not just existence: a PNG that
    // 404s (the consumable sprites have no files) still leaves an Image object
    // here, and drawImage() on a broken/undecoded one throws InvalidStateError.
    if (!isPetal) {
        const sprite = this.itemSprites[item.type];
        if (sprite && sprite.complete && sprite.naturalWidth > 0) {
            ctx.drawImage(sprite, -15, -15, 30, 30);
        }
    }
    else if (item.petalType && item.rarity) {
        // Bake the petal sprite into the cached canvas. Ground drops don't
        // need the 24fps animation, and combining bg+petal into a single
        // texture eliminates a per-drop drawImage call AND the texture
        // switch between bg canvas and petal canvas — which on the GPU was
        // the actual bottleneck (JS was already fast).
        const petalEntry = this.petalImageCache[`${item.petalType}_${item.rarity}`];
        const petalCanvas = Array.isArray(petalEntry) ? petalEntry[0] : petalEntry;
        const stats = (0, core_1.getPetalStats)(item.petalType, item.rarity);
        if (petalCanvas && stats) {
            const petalSize = 12 * stats.size;
            ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
        }
    }
    // Draw item name
    let itemName;
    if (isPetal && item.petalType) {
        itemName = item.petalType[0].toUpperCase() + item.petalType.slice(1).toLowerCase();
    }
    else {
        itemName = item.type[0].toUpperCase() + item.type.slice(1).toLowerCase();
    }
    itemName = itemName.replace('_', ' ');
    ctx.font = '12px Ubuntu, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(itemName, 0, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(itemName, 0, 20);
    this.itemCanvasCache.set(key, canvas);
    return canvas;
};
core_1.Graphics.prototype.drawItem = function (item, players) {
    // Compute spawn spin-out animation offset
    let drawX = item.x;
    let drawY = item.y;
    let rotation = 0;
    let alpha = 1;
    let scale = 1;
    // Death animation (pickup or despawn) takes precedence
    const deathAnim = this.itemDeathAnim?.get(item.id);
    if (deathAnim) {
        const elapsed = this.frameTimestamp - deathAnim.startTime;
        const duration = deathAnim.type === 'pickup' ? PICKUP_ANIM_DURATION : DESPAWN_ANIM_DURATION;
        const t = Math.min(1, elapsed / duration);
        if (deathAnim.type === 'pickup') {
            // Fly toward target player (tracking current position) with ease-in
            const eased = t * t;
            let targetX = deathAnim.startX;
            let targetY = deathAnim.startY;
            if (deathAnim.targetPlayerId && players) {
                const targetPlayer = players.get(deathAnim.targetPlayerId);
                if (targetPlayer) {
                    targetX = targetPlayer.x;
                    targetY = targetPlayer.y;
                }
            }
            drawX = deathAnim.startX + (targetX - deathAnim.startX) * eased;
            drawY = deathAnim.startY + (targetY - deathAnim.startY) * eased;
            scale = 1 - eased * 0.7; // shrink as it flies in
            alpha = 1 - eased * 0.5;
        }
        else {
            // Despawn: spin and fade
            rotation = t * Math.PI * 2;
            alpha = 1 - t;
            scale = 1 - t * 0.3;
        }
    }
    else {
        // Spawn spin-out animation
        const anim = this.itemSpawnAnim?.get(item.id);
        if (anim) {
            const elapsed = this.frameTimestamp - anim.startTime;
            if (elapsed >= SPAWN_ANIM_DURATION) {
                this.itemSpawnAnim.delete(item.id);
            }
            else {
                const t = elapsed / SPAWN_ANIM_DURATION;
                const eased = 1 - (1 - t) * (1 - t);
                const offset = anim.distance * (1 - eased);
                drawX = item.x + Math.cos(anim.angle) * offset;
                drawY = item.y + Math.sin(anim.angle) * offset;
                rotation = anim.rotation * (1 - eased);
            }
        }
    }
    // Build/fetch per-item render cache once. The petal sprite is now baked
    // into `bg` by getItemCanvas, so the per-frame draw is a single
    // drawImage of one cached texture per drop.
    let cache = item._renderCache;
    if (!cache) {
        const bg = this.getItemCanvas(item);
        cache = { bg, petalFrames: null, petalSize: 0 };
        item._renderCache = cache;
    }
    if (cache.bg) {
        const needsTransform = rotation !== 0 || scale !== 1 || alpha !== 1;
        if (needsTransform) {
            this.ctx.save();
            this.ctx.globalAlpha = alpha;
            this.ctx.translate(drawX, drawY);
            if (rotation !== 0)
                this.ctx.rotate(rotation);
            if (scale !== 1)
                this.ctx.scale(scale, scale);
            this.ctx.drawImage(cache.bg, -ITEM_CANVAS_CENTER, -ITEM_CANVAS_CENTER);
            this.ctx.restore();
        }
        else {
            // Fast path: one drawImage per drop, no transform state churn,
            // and no second texture bind (petal is baked into bg).
            this.ctx.drawImage(cache.bg, drawX - ITEM_CANVAS_CENTER, drawY - ITEM_CANVAS_CENTER);
        }
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = 'yellow';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0;
            this.ctx.shadowBlur = 0;
            this.ctx.strokeRect(item.x - 15, item.y - 15, 30, 30);
            this.ctx.restore();
        }
        if (!deathAnim && item.rarity && (item.rarity === 'ultra' || item.rarity === 'super' || item.rarity === 'unique' || item.rarity === 'apex') && Math.random() < 0.1) {
            this.showPetalParticleEffect(drawX, drawY, item.rarity);
        }
        return;
    }
    console.warn('Item not cached, drawing normally');
    // Fallback/petal path: draw normally
    this.ctx.save();
    this.ctx.translate(item.x, item.y);
    // Draw item rarity glow
    if (item.rarity) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.roundRect(-25, -25, 50, 50, 3);
        this.ctx.lineWidth = 5;
        this.ctx.strokeStyle = this.darkenColor(this.ITEM_RARITY_COLORS[item.rarity], 30);
        this.ctx.stroke();
        this.ctx.fillStyle = `${this.ITEM_RARITY_COLORS[item.rarity]}`;
        this.ctx.fill();
        this.ctx.restore();
    }
    // Handle different item types
    if (item.type === 'petal') {
        // Draw petal procedurally
        this.drawWorldPetal(item);
    }
    else {
        // Draw other items with sprites (see getItemCanvas: a sprite whose file
        // failed to load is still an Image, and drawing it throws).
        const sprite = this.itemSprites[item.type];
        if (sprite && sprite.complete && sprite.naturalWidth > 0) {
            this.ctx.drawImage(sprite, -15, -15, 30, 30);
        }
    }
    // Draw item name
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '12px Ubuntu, sans-serif';
    this.ctx.textAlign = 'center';
    let itemName = "";
    if (item.type === 'petal' && item.petalType) {
        itemName = item.petalType[0].toUpperCase() + item.petalType.slice(1).toLowerCase() || "";
    }
    else {
        itemName = item.type[0].toUpperCase() + item.type.slice(1).toLowerCase();
    }
    itemName = itemName.replace('_', ' ');
    // Ensure item name is not blurred by setting shadow blur to 0
    this.ctx.shadowBlur = 0;
    this.ctx.globalAlpha = 1.0;
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 3;
    this.ctx.strokeText(itemName, 0, 20);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(itemName, 0, 20);
    // Draw hitbox if enabled
    if (this.showHitboxes) {
        this.ctx.save();
        this.ctx.strokeStyle = 'yellow';
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 1.0;
        this.ctx.shadowBlur = 0;
        this.ctx.strokeRect(-15, -15, 30, 30);
        this.ctx.restore();
    }
    this.ctx.restore();
};
core_1.Graphics.prototype.drawWorldPetal = function (item) {
    if (!item.petalType || !item.rarity)
        return;
    const stats = (0, core_1.getPetalStats)(item.petalType, item.rarity);
    if (!stats)
        return;
    // Draw petal using cached image
    const size = 12 * stats.size;
    const petalKey = `${item.petalType}_${item.rarity}`;
    const petalCanvas = this.getPetalCanvas(petalKey, this.frameTimestamp);
    if (petalCanvas) {
        // Use consistent scaling to maintain aspect ratio
        const petalSize = size;
        this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
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
    // Particle burst is now emitted once when the item spawns, not per-frame
};
