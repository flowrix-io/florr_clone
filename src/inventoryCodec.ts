import { PlayerInventory, PlayerInventoryDict } from './player';

// Auto-generate item type IDs from all known petal types + consumables
const CONSUMABLE_TYPES = ['health_potion', 'speed_boost', 'shield'] as const;

// These get populated by initInventoryCodec()
export const ITEM_KEY_TO_ID: Map<string, number> = new Map();
export const ID_TO_ITEM_KEY: Map<number, string> = new Map();

export const RARITY_TO_ID: Map<string, number> = new Map();
export const ID_TO_RARITY: Map<number, string> = new Map();

let nextItemId = 0;

function registerItemKey(key: string) {
    if (!ITEM_KEY_TO_ID.has(key)) {
        ITEM_KEY_TO_ID.set(key, nextItemId);
        ID_TO_ITEM_KEY.set(nextItemId, key);
        nextItemId++;
    }
}

/**
 * Called once at startup after PETAL_CONFIG is initialized.
 * Registers rarity levels and all petal types so they get numeric IDs.
 */
export function initInventoryCodec(rarityLevels: readonly string[], petalTypes: string[]) {
    for (let i = 0; i < rarityLevels.length; i++) {
        RARITY_TO_ID.set(rarityLevels[i], i);
        ID_TO_RARITY.set(i, rarityLevels[i]);
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
function findEntry(inv: PlayerInventory, rarityId: number, itemId: number): number {
    for (let i = 0; i < inv.length; i += 3) {
        if (inv[i] === rarityId && inv[i + 1] === itemId) return i;
    }
    return -1;
}

export function addItem(inv: PlayerInventory, rarity: string, type: string, count: number): void {
    const rid = RARITY_TO_ID.get(rarity);
    const iid = ITEM_KEY_TO_ID.get(type);
    if (rid === undefined || iid === undefined) return;
    const idx = findEntry(inv, rid, iid);
    if (idx >= 0) {
        inv[idx + 2] += count;
    } else {
        inv.push(rid, iid, count);
    }
}

export function removeItem(inv: PlayerInventory, rarity: string, type: string, count: number): boolean {
    const rid = RARITY_TO_ID.get(rarity);
    const iid = ITEM_KEY_TO_ID.get(type);
    if (rid === undefined || iid === undefined) return false;
    const idx = findEntry(inv, rid, iid);
    if (idx < 0 || inv[idx + 2] < count) return false;
    inv[idx + 2] -= count;
    if (inv[idx + 2] === 0) {
        inv.splice(idx, 3);
    }
    return true;
}

export function hasItem(inv: PlayerInventory, rarity: string, type: string, count: number): boolean {
    const rid = RARITY_TO_ID.get(rarity);
    const iid = ITEM_KEY_TO_ID.get(type);
    if (rid === undefined || iid === undefined) return false;
    const idx = findEntry(inv, rid, iid);
    return idx >= 0 && inv[idx + 2] >= count;
}

export function getItemCount(inv: PlayerInventory, rarity: string, type: string): number {
    const rid = RARITY_TO_ID.get(rarity);
    const iid = ITEM_KEY_TO_ID.get(type);
    if (rid === undefined || iid === undefined) return 0;
    const idx = findEntry(inv, rid, iid);
    return idx >= 0 ? inv[idx + 2] : 0;
}

export function createEmptyInventory(): PlayerInventory {
    return [];
}

export function createInitialInventory(): PlayerInventory {
    const inv: PlayerInventory = [];
    addItem(inv, 'common', 'petal_basic', 5);
    return inv;
}

// --- Conversion to/from legacy dict format (for database & display) ---

export function inventoryToDict(inv: PlayerInventory): PlayerInventoryDict {
    const dict: PlayerInventoryDict = {};
    for (let i = 0; i + 2 < inv.length; i += 3) {
        const rarity = ID_TO_RARITY.get(inv[i]);
        const itemKey = ID_TO_ITEM_KEY.get(inv[i + 1]);
        if (!rarity || !itemKey) continue;
        if (!dict[rarity]) dict[rarity] = {};
        dict[rarity][itemKey] = inv[i + 2];
    }
    return dict;
}

export function dictToInventory(dict: PlayerInventoryDict): PlayerInventory {
    const inv: PlayerInventory = [];
    for (const rarity in dict) {
        const rid = RARITY_TO_ID.get(rarity);
        if (rid === undefined) continue;
        const items = dict[rarity];
        for (const itemKey in items) {
            const iid = ITEM_KEY_TO_ID.get(itemKey);
            if (iid === undefined) continue;
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
export function forEachItem(inv: PlayerInventory, fn: (rarity: string, itemKey: string, count: number) => void): void {
    for (let i = 0; i + 2 < inv.length; i += 3) {
        const rarity = ID_TO_RARITY.get(inv[i]);
        const itemKey = ID_TO_ITEM_KEY.get(inv[i + 1]);
        if (rarity && itemKey) {
            fn(rarity, itemKey, inv[i + 2]);
        }
    }
}
