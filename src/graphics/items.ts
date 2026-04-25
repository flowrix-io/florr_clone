import { Graphics, WorldItem, Player, getPetalStats } from './core';

declare module './core' {
    interface Graphics {
        drawItem(item: WorldItem, players?: Map<string, Player>): void;
        drawWorldPetal(item: WorldItem): void;
        getItemCanvas(item: WorldItem): HTMLCanvasElement | null;
        itemCanvasCache?: Map<string, HTMLCanvasElement>;
        itemSpawnAnim?: Map<string, { angle: number; distance: number; startTime: number; rotation: number }>;
        itemDeathAnim?: Map<string, { type: 'pickup' | 'despawn'; targetPlayerId?: string; startX: number; startY: number; startTime: number }>;
    }
}

// Per-item render cache attached to the WorldItem on first draw to avoid
// per-frame string concat / Map.get / getPetalStats lookups.
type ItemRenderCache = {
    bg: HTMLCanvasElement | null;
    petalFrames: HTMLCanvasElement | HTMLCanvasElement[] | null;
    petalSize: number;
};

// Canvas size: 50x50 rarity box + text below (needs ~18px extra) + padding
const ITEM_CANVAS_SIZE = 60;
const ITEM_CANVAS_CENTER = 30;
const SPAWN_ANIM_DURATION = 400; // ms
const PICKUP_ANIM_DURATION = 150; // ms
const DESPAWN_ANIM_DURATION = 300; // ms

Graphics.prototype.getItemCanvas = function(this: Graphics, item: WorldItem): HTMLCanvasElement | null {
    if (!this.itemCanvasCache) {
        this.itemCanvasCache = new Map();
    }

    // Build cache key from visual properties
    // For petals: cache background (rarity box + text) only, petal drawn separately
    const isPetal = item.type === 'petal';
    const nameKey = isPetal ? (item.petalType || '') : item.type;
    const key = `${item.type}|${item.rarity || 'none'}|${nameKey}|${isPetal ? 'bg' : 'full'}`;
    let cached = this.itemCanvasCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = ITEM_CANVAS_SIZE;
    canvas.height = ITEM_CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

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

    // Draw sprite only for non-petal items (petal drawn on top separately)
    if (!isPetal) {
        const sprite = this.itemSprites[item.type];
        if (sprite) {
            ctx.drawImage(sprite, -15, -15, 30, 30);
        }
    }

    // Draw item name
    let itemName: string;
    if (isPetal && item.petalType) {
        itemName = item.petalType[0].toUpperCase() + item.petalType.slice(1).toLowerCase();
    } else {
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

Graphics.prototype.drawItem = function(this: Graphics, item: WorldItem, players?: Map<string, Player>): void {
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
        } else {
            // Despawn: spin and fade
            rotation = t * Math.PI * 2;
            alpha = 1 - t;
            scale = 1 - t * 0.3;
        }
    } else {
        // Spawn spin-out animation
        const anim = this.itemSpawnAnim?.get(item.id);
        if (anim) {
            const elapsed = this.frameTimestamp - anim.startTime;
            if (elapsed >= SPAWN_ANIM_DURATION) {
                this.itemSpawnAnim!.delete(item.id);
            } else {
                const t = elapsed / SPAWN_ANIM_DURATION;
                const eased = 1 - (1 - t) * (1 - t);
                const offset = anim.distance * (1 - eased);
                drawX = item.x + Math.cos(anim.angle) * offset;
                drawY = item.y + Math.sin(anim.angle) * offset;
                rotation = anim.rotation * (1 - eased);
            }
        }
    }

    // Build/fetch per-item render cache once. Subsequent frames skip the
    // string-key build, the itemCanvasCache Map.get, and the getPetalStats
    // lookup that would otherwise run for every drop every frame.
    let cache: ItemRenderCache | undefined = (item as any)._renderCache;
    if (!cache) {
        const bg = this.getItemCanvas(item);
        let petalFrames: HTMLCanvasElement | HTMLCanvasElement[] | null = null;
        let petalSize = 0;
        if (item.type === 'petal' && item.petalType && item.rarity) {
            const stats = getPetalStats(item.petalType, item.rarity);
            if (stats) {
                petalFrames = this.petalImageCache[`${item.petalType}_${item.rarity}`] ?? null;
                petalSize = 12 * stats.size;
            }
        }
        cache = { bg, petalFrames, petalSize };
        (item as any)._renderCache = cache;
    }

    if (cache.bg) {
        // Resolve current petal animation frame (cheap when static).
        // Use Math.floor — `| 0` truncates to int32 and produces a negative
        // index for Date.now()-scale timestamps, which would land on an
        // undefined frame and silently drop the petal back to the fallback.
        let petalFrame: HTMLCanvasElement | null = null;
        if (cache.petalFrames) {
            if (Array.isArray(cache.petalFrames)) {
                const arr = cache.petalFrames;
                petalFrame = arr[Math.floor((this.frameTimestamp / 42) % arr.length)];
            } else {
                petalFrame = cache.petalFrames;
            }
        }

        const needsTransform = rotation !== 0 || scale !== 1 || alpha !== 1;
        if (needsTransform) {
            this.ctx.save();
            this.ctx.globalAlpha = alpha;
            this.ctx.translate(drawX, drawY);
            if (rotation !== 0) this.ctx.rotate(rotation);
            if (scale !== 1) this.ctx.scale(scale, scale);
            this.ctx.drawImage(cache.bg, -ITEM_CANVAS_CENTER, -ITEM_CANVAS_CENTER);
            if (petalFrame) {
                const half = cache.petalSize / 2;
                this.ctx.drawImage(petalFrame, -half, -half, cache.petalSize, cache.petalSize);
            }
            this.ctx.restore();
        } else {
            // Fast path: no transforms required, so no save/restore — just
            // draw directly at world coordinates. With many drops on screen
            // this avoids ~2 ctx state saves per item per frame.
            this.ctx.drawImage(cache.bg, drawX - ITEM_CANVAS_CENTER, drawY - ITEM_CANVAS_CENTER);
            if (petalFrame) {
                const half = cache.petalSize / 2;
                this.ctx.drawImage(petalFrame, drawX - half, drawY - half, cache.petalSize, cache.petalSize);
            }
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
    } else {
        // Draw other items with sprites
        const sprite = this.itemSprites[item.type];
        if (sprite) {
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
    } else {
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

Graphics.prototype.drawWorldPetal = function(this: Graphics, item: WorldItem): void {
    if (!item.petalType || !item.rarity) return;

    const stats = getPetalStats(item.petalType, item.rarity);
    if (!stats) return;

    // Draw petal using cached image
    const size = 12 * stats.size;
    const petalKey = `${item.petalType}_${item.rarity}`;
    const petalCanvas = this.getPetalCanvas(petalKey, this.frameTimestamp);

    if (petalCanvas) {
        // Use consistent scaling to maintain aspect ratio
        const petalSize = size;
        this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
    } else {
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
