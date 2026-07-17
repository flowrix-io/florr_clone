"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ID_TO_RARITY = exports.RARITY_TO_ID = exports.ID_TO_ITEM_KEY = exports.ITEM_KEY_TO_ID = void 0;
exports.initInventoryCodec = initInventoryCodec;
exports.addItem = addItem;
exports.removeItem = removeItem;
exports.hasItem = hasItem;
exports.getItemCount = getItemCount;
exports.createEmptyInventory = createEmptyInventory;
exports.createInitialInventory = createInitialInventory;
exports.inventoryToDict = inventoryToDict;
exports.dictToInventory = dictToInventory;
exports.forEachItem = forEachItem;
// Auto-generate item type IDs from all known petal types + consumables
const CONSUMABLE_TYPES = ['health_potion', 'speed_boost', 'shield'];
// These get populated by initInventoryCodec()
exports.ITEM_KEY_TO_ID = new Map();
exports.ID_TO_ITEM_KEY = new Map();
exports.RARITY_TO_ID = new Map();
exports.ID_TO_RARITY = new Map();
let nextItemId = 0;
function registerItemKey(key) {
    if (!exports.ITEM_KEY_TO_ID.has(key)) {
        exports.ITEM_KEY_TO_ID.set(key, nextItemId);
        exports.ID_TO_ITEM_KEY.set(nextItemId, key);
        nextItemId++;
    }
}
/**
 * Called once at startup after PETAL_CONFIG is initialized.
 * Registers rarity levels and all petal types so they get numeric IDs.
 */
function initInventoryCodec(rarityLevels, petalTypes) {
    for (let i = 0; i < rarityLevels.length; i++) {
        exports.RARITY_TO_ID.set(rarityLevels[i], i);
        exports.ID_TO_RARITY.set(i, rarityLevels[i]);
    }
    for (const c of CONSUMABLE_TYPES) {
        registerItemKey(c);
    }
    const sorted = [...petalTypes].sort();
    for (const pt of sorted) {
        registerItemKey(`petal_${pt}`);
    }
}
// --- Inventory operations on compact number[] format ---
/** Find the index of a (rarityId, itemId) triplet, or -1 */
function findEntry(inv, rarityId, itemId) {
    for (let i = 0; i < inv.length; i += 3) {
        if (inv[i] === rarityId && inv[i + 1] === itemId)
            return i;
    }
    return -1;
}
function addItem(inv, rarity, type, count) {
    const rid = exports.RARITY_TO_ID.get(rarity);
    const iid = exports.ITEM_KEY_TO_ID.get(type);
    if (rid === undefined || iid === undefined)
        return;
    const idx = findEntry(inv, rid, iid);
    if (idx >= 0) {
        inv[idx + 2] += count;
    }
    else {
        inv.push(rid, iid, count);
    }
}
function removeItem(inv, rarity, type, count) {
    const rid = exports.RARITY_TO_ID.get(rarity);
    const iid = exports.ITEM_KEY_TO_ID.get(type);
    if (rid === undefined || iid === undefined)
        return false;
    const idx = findEntry(inv, rid, iid);
    if (idx < 0 || inv[idx + 2] < count)
        return false;
    inv[idx + 2] -= count;
    if (inv[idx + 2] === 0) {
        inv.splice(idx, 3);
    }
    return true;
}
function hasItem(inv, rarity, type, count) {
    const rid = exports.RARITY_TO_ID.get(rarity);
    const iid = exports.ITEM_KEY_TO_ID.get(type);
    if (rid === undefined || iid === undefined)
        return false;
    const idx = findEntry(inv, rid, iid);
    return idx >= 0 && inv[idx + 2] >= count;
}
function getItemCount(inv, rarity, type) {
    const rid = exports.RARITY_TO_ID.get(rarity);
    const iid = exports.ITEM_KEY_TO_ID.get(type);
    if (rid === undefined || iid === undefined)
        return 0;
    const idx = findEntry(inv, rid, iid);
    return idx >= 0 ? inv[idx + 2] : 0;
}
function createEmptyInventory() {
    return [];
}
function createInitialInventory() {
    const inv = [];
    addItem(inv, 'common', 'petal_basic', 5);
    return inv;
}
// --- Conversion to/from legacy dict format (for database & display) ---
function inventoryToDict(inv) {
    const dict = {};
    for (let i = 0; i + 2 < inv.length; i += 3) {
        const rarity = exports.ID_TO_RARITY.get(inv[i]);
        const itemKey = exports.ID_TO_ITEM_KEY.get(inv[i + 1]);
        if (!rarity || !itemKey)
            continue;
        if (!dict[rarity])
            dict[rarity] = {};
        dict[rarity][itemKey] = inv[i + 2];
    }
    return dict;
}
function dictToInventory(dict) {
    const inv = [];
    for (const rarity in dict) {
        const rid = exports.RARITY_TO_ID.get(rarity);
        if (rid === undefined)
            continue;
        const items = dict[rarity];
        for (const itemKey in items) {
            const iid = exports.ITEM_KEY_TO_ID.get(itemKey);
            if (iid === undefined)
                continue;
            const count = items[itemKey];
            if (count > 0) {
                inv.push(rid, iid, count);
            }
        }
    }
    return inv;
}
/**
 * Iterates over inventory entries, calling fn(rarity, itemKey, count) for each.
 */
function forEachItem(inv, fn) {
    for (let i = 0; i + 2 < inv.length; i += 3) {
        const rarity = exports.ID_TO_RARITY.get(inv[i]);
        const itemKey = exports.ID_TO_ITEM_KEY.get(inv[i + 1]);
        if (rarity && itemKey) {
            fn(rarity, itemKey, inv[i + 2]);
        }
    }
}
