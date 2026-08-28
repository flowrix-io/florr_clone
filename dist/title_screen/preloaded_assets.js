"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getItemSpriteDataUrl = getItemSpriteDataUrl;
exports.getPetalCanvas = getPetalCanvas;
/**
 * Lookups into the preloaded asset cache, for the title screen's canvas UI.
 *
 * The title screen builds several small game-adapter objects (the loadout bar's,
 * the inventory manager's, the submanagers', the floating-petal background's)
 * and each one carried its own copy of these two lookups.
 */
const preloader_1 = require("../preloader");
/**
 * Returns a PNG data URL for `itemType`'s preloaded sprite, or null when the
 * sprite is missing or the canvas is tainted.
 */
function getItemSpriteDataUrl(itemType) {
    const assets = (0, preloader_1.getPreloadedAssets)();
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
/**
 * The preloaded canvas for one petal at one rarity, or null if it was never
 * preloaded.
 *
 * Animated petals are stored as a frame array; `time` picks the frame at the
 * fixed ~24fps the preloader bakes them at. Callers that hand the result to
 * something which mutates it must clone first — the returned canvas is the
 * shared cache entry.
 */
function getPetalCanvas(petalType, rarity, time = Date.now()) {
    const assets = (0, preloader_1.getPreloadedAssets)();
    if (!assets || !assets.petalImages)
        return null;
    const entry = assets.petalImages[`${petalType}_${rarity}`];
    if (!entry)
        return null;
    if (Array.isArray(entry)) {
        return entry[Math.floor((time / 42) % entry.length)];
    }
    return entry;
}
