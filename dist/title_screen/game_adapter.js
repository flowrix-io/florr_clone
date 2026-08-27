"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleScreenGameAdapter = void 0;
const zoom_compensation_1 = require("../zoom-compensation");
const petals_1 = require("../petals");
const preconnect_1 = require("../net/preconnect");
const preloader_1 = require("../preloader");
const sprite_data_url_1 = require("./sprite_data_url");
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
            id: (0, preconnect_1.getPreconnectedSocket)()?.id || '',
            name: '',
            score: 0,
            imageLoaded: false,
            image: new Image(),
            velocityX: 0, velocityY: 0,
            health: 100, maxHealth: 100, damage: 0,
            inventory: this._playerData.inventory,
            loadout: this._playerData.loadout,
            level: 1, xp: 0, xpToNextLevel: 100,
        };
    }
    getSocket() {
        return (0, preconnect_1.getPreconnectedSocket)() || undefined;
    }
    showFloatingText(_x, _y, text, _color, _fontSize) {
        console.log(`[TitleScreen] ${text}`);
    }
    /** Used by CanvasInventoryPanel — pulls petal frames from preloaded assets. */
    getPetalCanvas(petalType, rarity, _time) {
        const assets = (0, preloader_1.getPreloadedAssets)();
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
    /** Used by preview renderers to look up the per-petal spawn count. */
    getPetalStats(petalType, rarity) {
        return (0, petals_1.getPetalStats)(petalType, rarity);
    }
    /** Used by CanvasInventoryPanel — converts a preloaded sprite into a data URL. */
    getItemSpriteDataUrl(itemType) {
        return (0, sprite_data_url_1.getItemSpriteDataUrl)(itemType);
    }
}
exports.TitleScreenGameAdapter = TitleScreenGameAdapter;
