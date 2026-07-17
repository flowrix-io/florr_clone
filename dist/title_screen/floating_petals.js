"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FloatingPetalManager = void 0;
const petals_1 = require("../petals");
const BASE_PETAL_PIXELS = 32;
const SPAWN_PROBABILITY = 0.02;
class FloatingPetalManager {
    constructor() {
        this.petals = [];
        this.active = true;
        this.spawnEnabled = true;
        // Render-only manager: petals are drawn onto whatever canvas the
        // background animation hands us each frame.
    }
    pickPetal() {
        const petalTypes = Object.keys(petals_1.PETAL_CONFIG);
        const nonAdminPetalTypes = petalTypes.filter(type => !petals_1.PETAL_CONFIG[type]['common']?.isAdminPetal &&
            !type.endsWith('_egg'));
        const petalType = nonAdminPetalTypes.length > 0
            ? nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)]
            : 'basic';
        const rarity = petals_1.RARITY_LEVELS[Math.floor(Math.random() * petals_1.RARITY_LEVELS.length)];
        const petalStats = petals_1.PETAL_CONFIG[petalType]?.[rarity] ?? petals_1.PETAL_CONFIG.basic?.common;
        return { petalType, rarity, petalStats };
    }
    createPetal(viewportHeight) {
        const { petalType, rarity, petalStats } = this.pickPetal();
        const size = 0.5 + Math.random() * 1.5;
        const speedX = 0.5 + Math.random() * 2;
        const rotationSpeed = (Math.random() - 0.5) * 4;
        return {
            x: -50,
            y: Math.random() * viewportHeight,
            speedX,
            rotation: Math.random() * 360,
            rotationSpeed,
            size,
            petalType,
            rarity,
            petalStats,
        };
    }
    getPetalCanvas(petalType, rarity) {
        const assets = window.preloadedAssets;
        if (!assets || !assets.petalImages)
            return null;
        const entry = assets.petalImages[`${petalType}_${rarity}`];
        if (!entry)
            return null;
        if (Array.isArray(entry)) {
            const frameIndex = Math.floor((Date.now() / 42) % entry.length);
            return entry[frameIndex];
        }
        return entry;
    }
    /** Advance + draw all petals. Called once per frame by BackgroundAnimation. */
    draw(ctx, viewportWidth, viewportHeight) {
        if (!this.active)
            return;
        if (this.spawnEnabled && Math.random() < SPAWN_PROBABILITY) {
            this.petals.push(this.createPetal(viewportHeight));
        }
        for (let i = this.petals.length - 1; i >= 0; i--) {
            const petal = this.petals[i];
            petal.x += petal.speedX;
            petal.rotation += petal.rotationSpeed;
            if (petal.x > viewportWidth + 50) {
                this.petals.splice(i, 1);
            }
        }
        for (const petal of this.petals) {
            const drawSize = petal.size * BASE_PETAL_PIXELS;
            const cx = petal.x + drawSize / 2;
            const cy = petal.y + drawSize / 2;
            const sprite = this.getPetalCanvas(petal.petalType, petal.rarity);
            if (!sprite)
                continue;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((petal.rotation * Math.PI) / 180);
            ctx.drawImage(sprite, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
            ctx.restore();
        }
    }
    startAnimation() {
        this.active = true;
        this.spawnEnabled = true;
    }
    stopAnimation() {
        this.spawnEnabled = false;
    }
    destroy() {
        this.active = false;
        this.spawnEnabled = false;
        this.petals = [];
    }
    hide() {
        this.active = false;
    }
    show() {
        this.active = true;
    }
}
exports.FloatingPetalManager = FloatingPetalManager;
