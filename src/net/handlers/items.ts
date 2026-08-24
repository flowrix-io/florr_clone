/**
 * World loot and the player's own petals: spawns, pickups, despawn
 * animations, petal break/restore, and inventory replacement.
 */

import { ClientWorld } from '../../client_world';
import { Item, WorldItem } from '../../item';
import { forEachOwnPlayer, isLocalPlayerId, isOwnPlayerId, localPlayer, localPlayerId } from '../playerRefs';

export function registerItemHandlers(game: any): void {
    const cw: ClientWorld = game.clientWorld;

    // itemsUpdate is gone: there is no separate item channel to full-replace.
    // Drops arrive in the gameStateUpdate entity stream, and the stream's own
    // F=1 resync is what repairs a client whose frame was dropped.

    const registerSpawnAnim = (item: WorldItem) => {
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

    // Exposed for the entity-stream ingest in gameState.ts: item STATE arrives
    // in the delta stream now, but the cues (spawn flourish, despawn fade) still
    // belong here with the rest of the item visuals.
    game.registerItemSpawnAnim = registerSpawnAnim;

    // itemSpawned / itemsSpawned / itemsUpdate are gone: dropped loot is part of
    // the gameStateUpdate entity stream now, delta-encoded and viewport-culled
    // like mobs and players. They were one-shot events, and a frame lost to uWS
    // backpressure meant loot the client never rendered — the failure the
    // `needsItemResync` recovery channel existed to paper over.

    // Petal action event handlers
    game.socket.on('playerHealed', (data: { playerId: string, health: number, healAmount: number }) => {
        const player = cw.player(data.playerId);
        const entity = cw.playerEntity(data.playerId);
        if (player && entity !== undefined) {
            player.health = data.health;

            // Show healing effect
            if (data.healAmount > 0) {
                const roundedHeal = Math.round(data.healAmount * 10) / 10;
                const formattedHeal = roundedHeal % 1 === 0 ? roundedHeal.toString() : roundedHeal.toFixed(1);
                game.showFloatingText(
                    cw.playerX(entity),
                    cw.playerY(entity) - 20,
                    `+${formattedHeal}`,
                    '#00FF00',
                    20
                );
            }
        }
    });

    game.socket.on('petalExplosion', (data: { x: number, y: number, radius: number, damage: number }) => {
        // Show explosion effect
        game.showExplosionEffect(data.x, data.y, data.radius);
    });

    // Debounce loadout UI updates to prevent multiple DOM re-renders when many petals break/restore at once
    let loadoutUpdateTimeout: NodeJS.Timeout | null = null;
    function scheduleLoadoutUIUpdate() {
        if (loadoutUpdateTimeout) return;
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

    game.socket.on('petalBroken', (data: { playerId: string, slotIndex: number, petalType: string, rarity: string }) => {
        const player = cw.player(data.playerId);
        const entity = cw.playerEntity(data.playerId);
        if (player && entity !== undefined && player.loadout && player.loadout[data.slotIndex]) {
            player.loadout[data.slotIndex]!.health = 0;
            player.loadout[data.slotIndex]!.onCooldown = true;
            game.showPetalBreakEffect(cw.playerX(entity), cw.playerY(entity), data.petalType);
            if (isLocalPlayerId(game, data.playerId)) {
                scheduleLoadoutUIUpdate();
            }
        }
    });

    game.socket.on('petalRestored', (data: { playerId: string, slotIndex: number, petal: any }) => {
        const player = cw.player(data.playerId);
        if (player && player.loadout) {
            player.loadout[data.slotIndex] = data.petal;
            if (isLocalPlayerId(game, data.playerId)) {
                scheduleLoadoutUIUpdate();
            }
        }
    });

    const PICKUP_ANIM_MS = 150;
    const DESPAWN_ANIM_MS = 300;

    const registerPickupAnim = (itemId: string, playerId?: string) => {
        const item = game.items.get(itemId);
        if (!item) return;
        if (!game.graphics.itemDeathAnim) {
            game.graphics.itemDeathAnim = new Map();
        }
        if (game.graphics.itemDeathAnim.has(itemId)) return; // already animating
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
            if (game.pickedUpItems) game.pickedUpItems.delete(itemId);
        }, PICKUP_ANIM_MS);
    };

    const registerDespawnAnim = (itemId: string) => {
        const item = game.items.get(itemId);
        if (!item) return;
        if (!game.graphics.itemDeathAnim) {
            game.graphics.itemDeathAnim = new Map();
        }
        if (game.graphics.itemDeathAnim.has(itemId)) return; // already animating (e.g. pickup)
        game.graphics.itemDeathAnim.set(itemId, {
            type: 'despawn',
            startX: item.x,
            startY: item.y,
            startTime: Date.now()
        });
        setTimeout(() => {
            game.items.delete(itemId);
            game.graphics.itemDeathAnim?.delete(itemId);
            if (game.pickedUpItems) game.pickedUpItems.delete(itemId);
        }, DESPAWN_ANIM_MS);
    };

    game.socket.on('itemPickedUp', (payload: string | {
        id: string; x: number; y: number;
        type?: WorldItem['type']; rarity?: WorldItem['rarity']; petalType?: string;
    }) => {
        // Local player picked up this item — animate toward the half that's
        // actually on screen (the pickup is emitted to the socket, not per half).
        const id = typeof payload === 'string' ? payload : payload.id;

        // The drop may never have reached us: a magnet petal's pickup radius
        // (500px) collects loot on the tick it spawns, well before the next
        // snapshot could carry it. The animations all start from `game.items`,
        // so without this the whole flourish is skipped and the pickup is
        // invisible. Materialise the item from the cue, play its drop burst,
        // and let the normal pickup animation carry it to the flower.
        if (typeof payload === 'object' && !game.items.has(id)) {
            game.items.set(id, {
                id, x: payload.x, y: payload.y,
                type: payload.type ?? 'petal',
                rarity: payload.rarity,
                petalType: payload.petalType,
            } as WorldItem);
            if (payload.rarity) {
                game.graphics.showItemDropBurst(payload.x, payload.y, payload.rarity);
            }
        }

        registerPickupAnim(id, localPlayerId(game));
    });

    // Removal is driven by the entity stream's R list; this is the cue it calls.
    game.removeWorldItem = (itemId: string) => registerDespawnAnim(itemId);

    game.socket.on('itemCollected', (data: { playerId: string, itemId: string }) => {
        const player = cw.player(data.playerId);
        if (player) {
            registerPickupAnim(data.itemId, data.playerId);
            if (isOwnPlayerId(game, data.playerId)) {
                if (game.isInventoryOpen) {
                    game.inventoryManager.updateInventoryDisplay();
                }
            }
        }
    });

    game.socket.on('inventoryUpdate', (inventory: Item[]) => {
        const player = localPlayer(game);
        if (player) {
            forEachOwnPlayer(game, p => { p.inventory = inventory; });
            game.inventoryManager?.reconcileStagedWithInventory();
            // Update inventory display if it's open
            if (game.isInventoryOpen) {
                game.inventoryManager.updateInventoryDisplay();
            }
        }
    });
}
