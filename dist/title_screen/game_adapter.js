"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleScreenGameAdapter = void 0;
const zoom_compensation_1 = require("../zoom-compensation");
/**
 * Adapter that provides a GameInterface for using InventoryManager on the title screen.
 * Wraps the title screen's player data and preconnected socket.
 */
class TitleScreenGameAdapter {
    constructor() {
        this._playerData = null;
        this.canvas = document.createElement('canvas');
        (0, zoom_compensation_1.applyZoomCompensation)(this.canvas);
    }
    setPlayerData(pd) {
        this._playerData = pd;
    }
    getLocalPlayer() {
        if (!this._playerData)
            return undefined;
        return {
            id: window.preconnectedSocket?.id || '',
            name: '',
            x: 0, y: 0, angle: 0, score: 0,
            imageLoaded: false,
            image: new Image(),
            velocityX: 0, velocityY: 0,
            health: 100, maxHealth: 100, damage: 0,
            inventory: this._playerData.inventory,
            loadout: this._playerData.loadout,
            level: 1, xp: 0, xpToNextLevel: 100,
            targetX: 0, targetY: 0,
        };
    }
    getSocket() {
        return window.preconnectedSocket || undefined;
    }
    showFloatingText(_x, _y, text, _color, _fontSize) {
        console.log(`[TitleScreen] ${text}`);
    }
    /** Used by CanvasInventoryPanel — pulls petal frames from preloaded assets. */
    getPetalCanvas(petalType, rarity, _time) {
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
    /** Used by CanvasInventoryPanel — converts a preloaded sprite into a data URL. */
    getItemSpriteDataUrl(itemType) {
        const assets = window.preloadedAssets;
        if (!assets || !assets.itemSprites)
            return null;
        const img = assets.itemSprites[itemType];
        if (!img)
            return null;
        try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth || 32;
            c.height = img.naturalHeight || 32;
            c.getContext('2d')?.drawImage(img, 0, 0);
            return c.toDataURL('image/png');
        }
        catch {
            return null;
        }
    }
}
exports.TitleScreenGameAdapter = TitleScreenGameAdapter;
