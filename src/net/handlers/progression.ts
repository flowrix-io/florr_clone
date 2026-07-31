/**
 * Everything that advances or spends an account: XP and levels, the skill
 * tree, the mob gallery, crafting, absorbing, the shop, and redeem codes.
 */

import { Item } from '../../item';
import { Player } from '../../player';
import { forEachOwnPlayer, isLocalPlayerId, isOwnPlayerId, localPlayer } from '../playerRefs';

export function registerProgressionHandlers(game: any): void {

    game.socket.on('xpGained', (data: {
        playerId: string;
        xp: number;
        totalXp: number;
        level: number;
        xpToNextLevel: number;
        maxHealth: number;
        damage: number;
    }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.xp = data.totalXp;
            player.level = data.level;
            player.xpToNextLevel = data.xpToNextLevel;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            game.savePlayerProgress(player);
        }
    });

    // XP banked onto the OUTSIDE track while the player stands in the maze —
    // every mob kill in there. The XP bar shows the maze level, so it must not
    // move; we just record where the outside level has got to.
    game.socket.on('outsideXpGained', (data: {
        playerId: string;
        xp: number;
        outsideLevel: number;
        outsideTotalXp: number;
    }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.outsideLevel = data.outsideLevel;
        }
    });

    game.socket.on('levelUp', (data: {
        playerId: string;
        level: number;
        maxHealth: number;
        damage: number;
    }) => {
        //console.log('Level up:', data);  // Add logging
        const player = game.players.get(data.playerId);
        if (player) {
            player.level = data.level;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            game.savePlayerProgress(player);
        }
    });


    game.socket.on('playerRespawned', (player: Player) => {
        const existingPlayer = game.players.get(player.id);
        if (existingPlayer) {
            Object.assign(existingPlayer, player);
            // Reset the isDead flag
            existingPlayer.isDead = false;
            if (isLocalPlayerId(game, player.id)) {
                game.isPlayerDead = false;
                game.hideDeathScreen();
            }
        }
    });

    game.socket.on('decorationsUpdate', (decorations: Array<{
        x: number;
        y: number;
        scale: number;
    }>) => {
        game.decorations = decorations;
    });

    game.socket.on('sandsUpdate', (sands: Array<{
        x: number;
        y: number;
        radius: number;
        rotation: number;
    }>) => {
        game.sands = sands;
    });

    // Debounce mob gallery updates to prevent lag when multiple mobs die
    let mobGalleryUpdateTimeout: NodeJS.Timeout | null = null;

    game.socket.on('playerUpdated', (updatedPlayer: Player) => {
        // console.log('[MobGallery] Received playerUpdated event', {
        //     playerId: updatedPlayer.id,
        //     hasMobKills: !!updatedPlayer.mobKills,
        //     mobKills: updatedPlayer.mobKills
        // });
        let player = game.players.get(updatedPlayer.id);

        // If player doesn't exist yet, create it (e.g., for split players)
        if (!player) {
            player = {
                ...updatedPlayer,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                targetX: updatedPlayer.x,
                targetY: updatedPlayer.y
            };
            game.players.set(updatedPlayer.id, player);
        } else {
            let loadoutChanged = false;
            let inventoryChanged = false;
            let mobKillsChanged = false;

            if (isOwnPlayerId(game, updatedPlayer.id)) {
                // Use reference check - server always sends new objects when data changes
                loadoutChanged = updatedPlayer.loadout !== undefined && player.loadout !== updatedPlayer.loadout;
                inventoryChanged = updatedPlayer.inventory !== undefined && player.inventory !== updatedPlayer.inventory;
                mobKillsChanged = updatedPlayer.mobKills !== undefined && player.mobKills !== updatedPlayer.mobKills;
            }

            // Set position as interpolation targets to avoid camera jitter
            const prevX = player.x;
            const prevY = player.y;
            const newX = updatedPlayer.x;
            const newY = updatedPlayer.y;
            // The full server player carries its raw petalPositions. Assigning
            // them would wipe the client's per-petal interpolation state and
            // snap every petal to its un-smoothed server spot — the whole
            // orbit visibly jumps ahead by the interpolation lag. This event
            // fires on every mob kill (trackMobKill) and on loadout changes,
            // which is exactly when the jump was seen. Petal positions are
            // owned by the gameStateUpdate delta pipeline; keep the client's.
            const prevPetalPositions = player.petalPositions;
            Object.assign(player, updatedPlayer);
            if (prevPetalPositions) player.petalPositions = prevPetalPositions;
            // Restore interpolated position, update targets
            if (newX !== undefined && newY !== undefined) {
                player.x = prevX;
                player.y = prevY;
                player.targetX = newX;
                player.targetY = newY;
            }
            // The snapshot resurrected any craft-slot staged items into the
            // inventory (staging is client-side only) — re-deduct them so the
            // slots and inventory don't double-count (craft dupe glitch).
            if (inventoryChanged) {
                game.inventoryManager?.reconcileStagedWithInventory();
            }

            // Update displays if this is the current player. Both halves count:
            // the inventory is shared, and a switch delivers the newly active
            // half's loadout under ITS id — the loadout bar has to follow it.
            if (isOwnPlayerId(game, updatedPlayer.id)) {
                if (game.isInventoryOpen && inventoryChanged) {
                    game.inventoryManager.updateInventoryDisplay();
                }
                // Only update loadout display if loadout actually changed
                if (game.inventoryManager && loadoutChanged) {
                    game.inventoryManager.updateLoadoutDisplay();
                    // Equipped clovers affect the displayed craft success chance
                    if (game.inventoryManager.isCraftingOpen) {
                        game.inventoryManager.updateCraftingDisplay();
                    }
                }
                // Show notification when mobs are killed while gallery is open
                if (game.inventoryManager && mobKillsChanged) {
                    // console.log('[MobGallery] Calling updateMobGalleryIfOpen, isOpen:', game.inventoryManager.getIsMobGalleryOpen());
                    if (mobGalleryUpdateTimeout) {
                        clearTimeout(mobGalleryUpdateTimeout);
                    }
                    mobGalleryUpdateTimeout = setTimeout(() => {
                        game.inventoryManager.updateMobGalleryIfOpen();
                        mobGalleryUpdateTimeout = null;
                    }, 100); // Small delay to batch multiple updates
                }
                // Update skills menu if open
                if (game.skillsManager && updatedPlayer.tp !== undefined && updatedPlayer.skills) {
                    game.skillsManager.updateSkills(updatedPlayer.tp, updatedPlayer.skills);
                }
            }
        }
    });

    // Incremental mob-gallery counter. The server used to re-send the entire
    // player (inventory, loadout and the whole mobKills table — ~9.9KB on a
    // late-game save) on every single kill just to move one number; this is the
    // ~12-byte version of that. `c` is the authoritative count, not a delta, so
    // a dropped frame self-heals on the next kill of the same type.
    game.socket.on('mobKillUpdate', (data: { t: string; r: string; c: number }) => {
        forEachOwnPlayer(game, p => {
            if (!p.mobKills) p.mobKills = {};
            if (!p.mobKills[data.t]) p.mobKills[data.t] = {};
            p.mobKills[data.t][data.r] = data.c;
        });
        // Same debounce as the old playerUpdated path — several mobs dying in
        // one tick would otherwise re-render the gallery once per kill.
        if (game.inventoryManager) {
            if (mobGalleryUpdateTimeout) clearTimeout(mobGalleryUpdateTimeout);
            mobGalleryUpdateTimeout = setTimeout(() => {
                game.inventoryManager.updateMobGalleryIfOpen();
                mobGalleryUpdateTimeout = null;
            }, 100);
        }
    });

    game.socket.on('skillsUpdated', (data: {
        playerId: string;
        tp: number;
        skills: { [key: string]: string };
    }) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.tp = data.tp;
            player.skills = data.skills;
            // Update skills menu if this is the current player and menu is open
            if (isLocalPlayerId(game, data.playerId) && game.skillsManager) {
                game.skillsManager.updateSkills(data.tp, data.skills);
            }
        }
    });

    game.socket.on('speedBoostActive', (playerId: string) => {
        if (isOwnPlayerId(game, playerId)) {
            game.speedBoostActive = true;
        }
    });

    game.socket.on('savePlayerProgress', () => {
        game.showSaveIndicator();
    });

    // Absorb tab of the craft menu: server destroyed the petals and granted XP.
    game.socket.on('itemsAbsorbed', (data: { xpGained: number, absorbedCount: number, inventory: any }) => {
        const player = localPlayer(game);
        if (player && data.inventory) {
            forEachOwnPlayer(game, p => { p.inventory = data.inventory; });
            game.inventoryManager?.reconcileStagedWithInventory();
        }
        game.inventoryManager?.handleItemsAbsorbed(data);
    });

    game.socket.on('absorbFailed', (data: { message?: string, inventory?: any }) => {
        console.warn('[CLIENT] absorbFailed:', data?.message);
        const player = localPlayer(game);
        if (player && data?.inventory) {
            forEachOwnPlayer(game, p => { p.inventory = data.inventory; });
            game.inventoryManager?.reconcileStagedWithInventory();
        }
        game.inventoryManager?.handleAbsorbFailed();
    });

    game.socket.on('craftingFinished', (data: { successCount: number, failCount: number, newItem: Item, inventory: any, petalsReturned?: number }) => {
        console.log('[CLIENT] craftingFinished received:', data);
        const player = localPlayer(game);
        if (player) {
            forEachOwnPlayer(game, p => { p.inventory = data.inventory; });
            // Anything staged into the slots after this craft was sent is
            // still present in the snapshot — re-deduct it (dupe guard).
            game.inventoryManager?.reconcileStagedWithInventory();

            if (game.inventoryManager.isCraftingOpen) {
                // Parse item type and petalType from itemKey
                const itemKey = data.newItem.type;
                let itemType: Item['type'] = 'petal';
                let petalType: string | undefined;

                if (itemKey.startsWith('petal_')) {
                    itemType = 'petal';
                    petalType = itemKey.substring(6);
                } else {
                    itemType = itemKey as Item['type'];
                }

                const displayItem: Item = {
                    type: itemType,
                    rarity: data.newItem.rarity,
                    petalType: petalType
                };

                game.inventoryManager.showCraftingSuccess(displayItem, data.successCount, data.petalsReturned || 0);
            }

            if (game.inventoryManager.isCraftingOpen) {
                game.inventoryManager.updateCraftingDisplay();
            }
        }
    });

    game.socket.on('craftingFailed', (message: string) => {
        console.log('[CLIENT] craftingFailed received:', message);
        if (game.inventoryManager.isCraftingOpen) {
            game.inventoryManager.updateCraftingDisplay();
        }
    });

    // Shop handlers
    game.socket.on('shopPurchaseSuccess', (data: { inventory: any, stars: number }) => {
        console.log('[CLIENT] shopPurchaseSuccess received:', data);
        const player = localPlayer(game);
        if (player) {
            forEachOwnPlayer(game, p => { p.inventory = data.inventory; p.stars = data.stars; });
            game.inventoryManager?.reconcileStagedWithInventory();
            if (game.inventoryManager) {
                game.inventoryManager.updateInventoryDisplay();
            }
            if (game.shopManager) {
                game.shopManager.handlePurchaseSuccess();
                game.shopManager.updateStarsDisplay();
            }
        }
    });

    game.socket.on('shopPurchaseError', (message: string) => {
        console.log('[CLIENT] shopPurchaseError received:', message);
        if (game.shopManager) {
            game.shopManager.handlePurchaseError(message);
        }
    });

    game.socket.on('codeRedeemSuccess', (data: { code?: string, stars: number, totalStars: number }) => {
        console.log('[CLIENT] codeRedeemSuccess received:', data);
        const player = localPlayer(game);
        if (player) {
            forEachOwnPlayer(game, p => { p.stars = data.totalStars; });
            if (game.shopManager) {
                game.shopManager.handleCodeRedeemSuccess(data.stars);
                game.shopManager.updateStarsDisplay();
            }
        }
        // Notifications are now handled on the server side
    });

    game.socket.on('codeRedeemError', (message: string) => {
        console.log('[CLIENT] codeRedeemError received:', message);
        if (game.shopManager) {
            game.shopManager.handleCodeRedeemError(message);
        }
    });

    game.socket.on('starsEarned', (data: { amount: number, total: number, mobName: string, tier: string }) => {
        console.log('[CLIENT] starsEarned received:', data);
        // Update player stars
        const player = game.getLocalPlayer();
        if (player) {
            player.stars = data.total;
        }
        // Update shop display (including challenges tab if open)
        if (game.shopManager) {
            game.shopManager.updateStarsDisplay();
        }
    });
}
