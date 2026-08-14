"use strict";
/**
 * World loot and the player's own petals: spawns, pickups, despawn
 * animations, petal break/restore, and inventory replacement.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerItemHandlers = registerItemHandlers;
const playerRefs_1 = require("../playerRefs");
function registerItemHandlers(game) {
    const cw = game.clientWorld;
    game.socket.on('itemsUpdate', (items) => {
        game.items.clear();
        items.forEach(item => {
            game.items.set(item.id, item);
        });
        // This full replace is also the server's drop-recovery payload (a
        // spawn/remove frame to us was discarded under backpressure). Clear
        // animation entries for items that no longer exist — their items are
        // gone from the map, so they'd linger in these Maps forever.
        game.graphics.itemSpawnAnim?.forEach((_, id) => {
            if (!game.items.has(id))
                game.graphics.itemSpawnAnim.delete(id);
        });
        game.graphics.itemDeathAnim?.forEach((_, id) => {
            if (!game.items.has(id))
                game.graphics.itemDeathAnim.delete(id);
        });
    });
    const registerSpawnAnim = (item) => {
        if (!game.graphics.itemSpawnAnim) {
            game.graphics.itemSpawnAnim = new Map();
        }
        game.graphics.itemSpawnAnim.set(item.id, {
            angle: Math.random() * Math.PI * 2,
            distance: 30 + Math.random() * 20,
            rotation: (Math.random() - 0.5) * Math.PI * 2,
            startTime: Date.now()
        });
    };
    game.socket.on('itemSpawned', (item) => {
        // Legacy handler for single item spawn (kept for backwards compatibility)
        game.items.set(item.id, item);
        registerSpawnAnim(item);
        if (item.rarity) {
            game.graphics.showItemDropBurst(item.x, item.y, item.rarity);
        }
    });
    game.socket.on('itemsSpawned', (items) => {
        // Batch handler for multiple item spawns
        for (const item of items) {
            game.items.set(item.id, item);
            registerSpawnAnim(item);
            if (item.rarity) {
                game.graphics.showItemDropBurst(item.x, item.y, item.rarity);
            }
        }
    });
    // Petal action event handlers
    game.socket.on('playerHealed', (data) => {
        const player = cw.player(data.playerId);
        const entity = cw.playerEntity(data.playerId);
        if (player && entity !== undefined) {
            player.health = data.health;
            // Show healing effect
            if (data.healAmount > 0) {
                const roundedHeal = Math.round(data.healAmount * 10) / 10;
                const formattedHeal = roundedHeal % 1 === 0 ? roundedHeal.toString() : roundedHeal.toFixed(1);
                game.showFloatingText(cw.playerX(entity), cw.playerY(entity) - 20, `+${formattedHeal}`, '#00FF00', 20);
            }
        }
    });
    game.socket.on('petalExplosion', (data) => {
        // Show explosion effect
        game.showExplosionEffect(data.x, data.y, data.radius);
    });
    // Debounce loadout UI updates to prevent multiple DOM re-renders when many petals break/restore at once
    let loadoutUpdateTimeout = null;
    function scheduleLoadoutUIUpdate() {
        if (loadoutUpdateTimeout)
            return;
        loadoutUpdateTimeout = setTimeout(() => {
            loadoutUpdateTimeout = null;
            if (game.isInventoryOpen) {
                game.inventoryManager.updateInventoryDisplay();
            }
            if (game.inventoryManager) {
                game.inventoryManager.updateLoadoutDisplay();
            }
        }, 50);
    }
    game.socket.on('petalBroken', (data) => {
        const player = cw.player(data.playerId);
        const entity = cw.playerEntity(data.playerId);
        if (player && entity !== undefined && player.loadout && player.loadout[data.slotIndex]) {
            player.loadout[data.slotIndex].health = 0;
            player.loadout[data.slotIndex].onCooldown = true;
            game.showPetalBreakEffect(cw.playerX(entity), cw.playerY(entity), data.petalType);
            if ((0, playerRefs_1.isLocalPlayerId)(game, data.playerId)) {
                scheduleLoadoutUIUpdate();
            }
        }
    });
    game.socket.on('petalRestored', (data) => {
        const player = cw.player(data.playerId);
        if (player && player.loadout) {
            player.loadout[data.slotIndex] = data.petal;
            if ((0, playerRefs_1.isLocalPlayerId)(game, data.playerId)) {
                scheduleLoadoutUIUpdate();
            }
        }
    });
    const PICKUP_ANIM_MS = 150;
    const DESPAWN_ANIM_MS = 300;
    const registerPickupAnim = (itemId, playerId) => {
        const item = game.items.get(itemId);
        if (!item)
            return;
        if (!game.graphics.itemDeathAnim) {
            game.graphics.itemDeathAnim = new Map();
        }
        if (game.graphics.itemDeathAnim.has(itemId))
            return; // already animating
        game.graphics.itemDeathAnim.set(itemId, {
            type: 'pickup',
            targetPlayerId: playerId,
            startX: item.x,
            startY: item.y,
            startTime: Date.now()
        });
        setTimeout(() => {
            game.items.delete(itemId);
            game.graphics.itemDeathAnim?.delete(itemId);
            if (game.pickedUpItems)
                game.pickedUpItems.delete(itemId);
        }, PICKUP_ANIM_MS);
    };
    const registerDespawnAnim = (itemId) => {
        const item = game.items.get(itemId);
        if (!item)
            return;
        if (!game.graphics.itemDeathAnim) {
            game.graphics.itemDeathAnim = new Map();
        }
        if (game.graphics.itemDeathAnim.has(itemId))
            return; // already animating (e.g. pickup)
        game.graphics.itemDeathAnim.set(itemId, {
            type: 'despawn',
            startX: item.x,
            startY: item.y,
            startTime: Date.now()
        });
        setTimeout(() => {
            game.items.delete(itemId);
            game.graphics.itemDeathAnim?.delete(itemId);
            if (game.pickedUpItems)
                game.pickedUpItems.delete(itemId);
        }, DESPAWN_ANIM_MS);
    };
    game.socket.on('itemPickedUp', (itemId) => {
        // Local player picked up this item — animate toward the half that's
        // actually on screen (the pickup is emitted to the socket, not per half).
        registerPickupAnim(itemId, (0, playerRefs_1.localPlayerId)(game));
    });
    game.socket.on('itemRemoved', (itemId) => {
        // If not already animating (e.g. pickup), show despawn animation
        registerDespawnAnim(itemId);
    });
    game.socket.on('itemCollected', (data) => {
        const player = cw.player(data.playerId);
        if (player) {
            registerPickupAnim(data.itemId, data.playerId);
            if ((0, playerRefs_1.isOwnPlayerId)(game, data.playerId)) {
                if (game.isInventoryOpen) {
                    game.inventoryManager.updateInventoryDisplay();
                }
            }
        }
    });
    game.socket.on('inventoryUpdate', (inventory) => {
        const player = (0, playerRefs_1.localPlayer)(game);
        if (player) {
            (0, playerRefs_1.forEachOwnPlayer)(game, p => { p.inventory = inventory; });
            game.inventoryManager?.reconcileStagedWithInventory();
            // Update inventory display if it's open
            if (game.isInventoryOpen) {
                game.inventoryManager.updateInventoryDisplay();
            }
        }
    });
}
