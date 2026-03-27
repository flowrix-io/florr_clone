import { Graphics, WorldItem, getPetalStats } from './core';

declare module './core' {
    interface Graphics {
        drawItem(item: WorldItem): void;
        drawWorldPetal(item: WorldItem): void;
    }
}

Graphics.prototype.drawItem = function(this: Graphics, item: WorldItem): void {
    this.ctx.save();
    this.ctx.translate(item.x, item.y);

    // Draw item rarity glow
    if (item.rarity) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.roundRect(-25, -25, 50, 50, 5);
        this.ctx.lineWidth = 3;
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
        this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
        this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
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

        // Add rarity glow effect
        if (item.rarity !== 'common') {
            this.ctx.shadowColor = stats.color;
            this.ctx.shadowBlur = 5;
            this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
        }
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

    // Create particle effects for ultra, super, and unique world petals
    if (['ultra', 'super', 'unique'].includes(item.rarity)) {
        // Only create particles occasionally to avoid performance issues
        if (Math.random() < 0.05) { // 5% chance per frame for world petals
            this.showPetalParticleEffect(item.x, item.y, item.rarity);
        }
    }
};
