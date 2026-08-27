"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getItemSpriteDataUrl = getItemSpriteDataUrl;
/**
 * Preloaded item sprite -> data URL, for the canvas panels.
 *
 * The title screen's game adapter, its inventory manager and its submanagers
 * each built the same adapter object and each carried a byte-identical copy of
 * this conversion.
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
