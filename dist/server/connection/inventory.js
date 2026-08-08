"use strict";
/**
 * Everything that moves items: pickups, the loadout grid, crafting,
 * absorbing, the shop, and redeem codes.
 *
 * `validateInventoryAndLoadout` is the trust boundary — the client sends its
 * whole intended loadout and inventory, and this reconciles that against the
 * server's authoritative copy before anything is persisted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInventoryHandlers = registerInventoryHandlers;
const constants_1 = require("../../constants");
const database_1 = require("../../database");
const inventoryCodec_1 = require("../../inventoryCodec");
const petal_actions_1 = require("../../petal_actions");
const petals_1 = require("../../petals");
const gameState_1 = require("../gameState");
const playerManager_1 = require("../playerManager");
const playerWire_1 = require("../playerWire");
function registerInventoryHandlers(ctx) {
    const { io, socket } = ctx;
    const { addMazeXPToPlayer, addXPToPlayer, deleteCodeFromDatabase, redeemedCodes, saveCodeToDatabase, savePlayerProgress, savePlayerProgressImmediate } = ctx.deps;
    socket.on('useItem', (itemData) => {
        // Check if player is split and route to the active player
        const { splitPlayers } = require('../../petal_actions');
        const originalId = socket.id.replace('_split2', '').replace('_split1', '');
        const splitState = splitPlayers.get(originalId);
        // Determine which player should receive the item effect
        let targetPlayerId = socket.id;
        if (splitState) {
            // Player is split - route to the active player
            targetPlayerId = splitState.activeIndex === 0 ? splitState.player1.id : splitState.player2.id;
        }
        const player = constants_1.players[targetPlayerId];
        if (!player)
            return;
        // For now, we don't check if the item is in the loadout on the server,
        // we trust the client. This could be improved for security.
        const item = {
            type: itemData.type,
            rarity: itemData.rarity,
            petalType: itemData.petalType,
        };
        const rarityMultipliers = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4,
            ultra: 5,
            super: 6,
            unique: 7,
            apex: 8
        };
        const multiplier = item.rarity ? rarityMultipliers[item.rarity] : 1;
        switch (item.type) {
            case 'health_potion':
                player.health = Math.min(player.maxHealth, player.health + (50 * multiplier));
                // console.log('Applied health potion effect:', player.health);
                break;
            case 'speed_boost':
                player.speed_boost = item.rarity ? rarityMultipliers[item.rarity] : 1;
                io.emit('speedBoostActive', player.id);
                // console.log('Applied speed boost effect');
                setTimeout(() => {
                    if (constants_1.players[targetPlayerId]) {
                        constants_1.players[targetPlayerId].speed_boost = 1;
                        // console.log('Speed boost wore off');
                    }
                }, 5000 * multiplier);
                break;
            case 'shield':
                player.isInvulnerable = true;
                // console.log('Applied shield effect');
                setTimeout(() => {
                    if (constants_1.players[targetPlayerId]) {
                        constants_1.players[targetPlayerId].isInvulnerable = false;
                        // console.log('Shield wore off');
                    }
                }, 3000 * multiplier);
                break;
            case 'petal':
                // Handle splitter petal
                if (item.petalType === 'splitter') {
                    const { splitPlayer, switchPlayer, splitPlayers } = require('../../petal_actions');
                    const originalId = socket.id; // Use socket.id as the original ID (before any splits)
                    if (splitPlayers.has(originalId)) {
                        // Already split - switch between players
                        // Get the current active player to switch from
                        const splitState = splitPlayers.get(originalId);
                        if (splitState) {
                            // Switch from the currently active player, pass socket.id so it only notifies this client
                            switchPlayer(splitState.activeIndex === 0 ? splitState.player1 : splitState.player2, io, socket.id);
                        }
                    }
                    else {
                        // Not split - split the player
                        splitPlayer(player, io);
                    }
                }
                break;
        }
        // Notify clients about the item use without removing it
        io.emit('itemUsed', {
            playerId: socket.id,
            item: itemData,
        });
        // Add cooldown to the item in player's loadout (client-side handles the visual)
        // Update the player state (only relevant to this player)
        socket.emit('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(player));
    });
    /**
     * Validates inventory structure and checks if items in loadout exist in inventory.
     * When an item is equipped, it's removed from inventory, so we need to check:
     * 1. If item is newly equipped (not in old loadout), it must exist in the old inventory (before equipping)
     * 2. If item is already equipped (in old loadout), we allow it to stay (it was already validated)
     * 3. If item doesn't exist in old inventory and wasn't in old loadout, unequip it
     *
     * @param newInventory - The new inventory sent by client (after equipping changes)
     * @param newLoadout - The new loadout sent by client
     * @param oldLoadout - The previous loadout on the server
     * @param oldInventory - The previous inventory on the server (before client changes)
     * @returns A validated loadout with missing items unequipped (set to null)
     */
    function validateInventoryAndLoadout(newInventory, newLoadout, oldLoadout, oldInventory) {
        // Validate inventory structure
        if (!newInventory || !Array.isArray(newInventory)) {
            console.warn('[SERVER] Invalid inventory structure, using empty inventory');
            newInventory = [];
        }
        // Create a validated copy of the loadout
        const validatedLoadout = [...newLoadout];
        // Build a reservoir of available items = oldInventory + all items in oldLoadout.
        // This lets us accept swaps between loadout slots (the items *conceptually* exist,
        // just not in inventory proper).
        const reservoir = {};
        const keyOfItem = (it) => {
            if (!it.rarity)
                return null;
            if (it.type === 'petal') {
                if (!it.petalType)
                    return null;
                return `${it.rarity}|petal_${it.petalType}`;
            }
            return `${it.rarity}|${it.type}`;
        };
        // Seed reservoir with every item in oldInventory (compact triples: [rid,iid,count,...])
        if (Array.isArray(oldInventory)) {
            for (let i = 0; i + 2 < oldInventory.length; i += 3) {
                const rid = oldInventory[i];
                const iid = oldInventory[i + 1];
                const count = oldInventory[i + 2];
                const rarity = inventoryCodec_1.ID_TO_RARITY.get(rid);
                const itemKey = inventoryCodec_1.ID_TO_ITEM_KEY.get(iid);
                if (!rarity || !itemKey)
                    continue;
                const k = `${rarity}|${itemKey}`;
                reservoir[k] = (reservoir[k] || 0) + count;
            }
        }
        // Add every item currently in oldLoadout
        for (const it of oldLoadout || []) {
            if (!it)
                continue;
            const k = keyOfItem(it);
            if (!k)
                continue;
            reservoir[k] = (reservoir[k] || 0) + 1;
        }
        // Consume reservoir for each item in newLoadout
        validatedLoadout.forEach((item, index) => {
            if (!item)
                return;
            if (!item.rarity) {
                console.warn(`[SERVER] Item at slot ${index} missing rarity, unequipping`);
                validatedLoadout[index] = null;
                return;
            }
            const k = keyOfItem(item);
            if (!k || (reservoir[k] || 0) <= 0) {
                console.warn(`[SERVER] Item ${item.type === 'petal' ? `petal_${item.petalType}` : item.type} (${item.rarity}) not available (reservoir exhausted), unequipping`);
                validatedLoadout[index] = null;
                return;
            }
            reservoir[k]--;
        });
        return validatedLoadout;
    }
    socket.on('updateLoadout', (data) => {
        // console.log('[PET DEBUG] updateLoadout called for socket:', socket.id);
        // Check if player is split and route to the active player
        const { splitPlayers } = require('../../petal_actions');
        const originalId = socket.id.replace('_split2', '').replace('_split1', '');
        const splitState = splitPlayers.get(originalId);
        // Determine which player should receive the loadout update
        let targetPlayerId = socket.id;
        if (splitState) {
            // Player is split - route to the active player
            targetPlayerId = splitState.activeIndex === 0 ? splitState.player1.id : splitState.player2.id;
        }
        // Equipping is an account edit — the title screen is where most of it
        // happens — so this resolves a lobby player too. Note the pet spawn /
        // cooldown-timer paths below deliberately keep looking the player up in
        // `players`, so a title-screen edit changes the loadout without putting
        // anything (pets included) into the world.
        const player = (0, gameState_1.getSessionPlayer)(targetPlayerId);
        if (!player) {
            console.warn('[SERVER] updateLoadout: Player not found for socket:', socket.id, 'targetPlayerId:', targetPlayerId);
            return;
        }
        if (!socket.username) {
            console.warn('[SERVER] updateLoadout: Socket not authenticated');
            return;
        }
        // console.log('[PET DEBUG] updateLoadout: Player found, processing loadout...');
        if (player) {
            // Maze-loadout edit (from the title screen when the maze biome is
            // selected). The maze loadout is a SEPARATE preset over the player's
            // full collection (inventory + regular loadout); the same owned petal
            // may sit in both builds and it does NOT consume from the inventory.
            // Validate/cap the proposed preset against the collection and store
            // it — never touching the regular inventory/loadout. Rejected while
            // actually inside the maze (the loadout is locked in there).
            if (data.context === 'maze') {
                if (!player.inMaze) {
                    const collection = (0, playerManager_1.buildCollection)(player.inventory, player.loadout);
                    player.mazeLoadout = (0, playerManager_1.capLoadoutToCollection)(data.loadout || [], collection);
                    if (socket.userId)
                        savePlayerProgressImmediate(player, socket.userId);
                }
                socket.emit('mazeLoadoutUpdated', { mazeLoadout: player.mazeLoadout || null });
                return;
            }
            // The loadout is LOCKED inside the maze — petals must be equipped
            // on the title screen before entering. Reject the whole update and
            // echo the authoritative state back so the client's optimistic
            // edit reverts. (This lock is also what makes the maze rarity
            // accounting safe: the shifted loadout and the regular-terms
            // inventory can never mix.)
            if (player.inMaze) {
                socket.emit('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(player));
                socket.emit('chatMessage', {
                    sender: 'System',
                    content: '<span style="color: #c77dff;">You cannot equip new petals in the maze — set up your loadout on the title screen before entering.</span>',
                    timestamp: Date.now()
                });
                return;
            }
            // Mode-tag guard for the PVP arena. The arena is a physical region
            // the player walks in/out of, and enter/exit runs on a movement
            // tick that swaps `loadout` between the PVP basics and the stashed
            // regular loadout. The client tags each edit with the arena state it
            // believed it was in; if that no longer matches the server, this is
            // a stale edit straddling the boundary (e.g. a PVP loadout edit that
            // arrived just after the player left the arena). Applying it would
            // overwrite the just-restored regular loadout with PVP petals and
            // persist it. Reject and echo authoritative state so the client
            // resyncs. A missing tag is treated as "not in PVP".
            if (!!data.inPvpArena !== !!player.inPvpArena) {
                socket.emit('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(player));
                return;
            }
            // Track which slots had items before to detect changes
            const oldLoadout = player.loadout || [];
            const oldInventory = player.inventory || [];
            // IMPORTANT: Use server's inventory as source of truth, NOT client's
            // This prevents console-added items from being accepted
            // For split players, we need to use the shared inventory directly (not a copy)
            // If split, use the shared inventory directly; otherwise create a copy for validation
            const serverInventory = splitState ? oldInventory : [...oldInventory];
            // Validate inventory and loadout - unequip items that don't exist in inventory
            const validatedLoadout = validateInventoryAndLoadout(serverInventory, data.loadout, oldLoadout, serverInventory);
            // Calculate inventory changes based on loadout changes
            // Split into two passes so swaps between slots net out correctly:
            //   Pass 1: add every unequipped item back to inventory
            //   Pass 2: remove every newly-equipped item from inventory
            // (Doing both in a single pass can temporarily leave the inventory short
            //  during swaps, causing the removal of the other swap-partner to fail.)
            const loadoutIterationLength = Math.max(oldLoadout.length, validatedLoadout.length);
            const getInventoryKey = (item) => {
                if (!item || !item.rarity)
                    return null;
                if (item.type === 'petal') {
                    if (!item.petalType)
                        return null;
                    return `petal_${item.petalType}`;
                }
                return item.type;
            };
            const itemsMatch = (item1, item2) => {
                if (!item1 || !item2)
                    return false;
                if (item1.type !== item2.type)
                    return false;
                if (item1.rarity !== item2.rarity)
                    return false;
                if (item1.type === 'petal')
                    return item1.petalType === item2.petalType;
                return true;
            };
            for (let index = 0; index < validatedLoadout.length; index++) {
                const oldItem = oldLoadout[index] || null;
                const newItem = validatedLoadout[index];
                if (oldItem && newItem && itemsMatch(oldItem, newItem)) {
                    validatedLoadout[index] = oldItem;
                }
            }
            // Pass 1: add unequipped items back, despawn pets for removed petals
            for (let index = 0; index < loadoutIterationLength; index++) {
                const oldItem = oldLoadout[index] || null;
                const newItem = validatedLoadout[index];
                if (!oldItem)
                    continue;
                if (newItem && itemsMatch(oldItem, newItem))
                    continue;
                const oldKey = getInventoryKey(oldItem);
                if (oldKey && oldItem.rarity) {
                    (0, playerManager_1.addItem)(serverInventory, oldItem.rarity, oldKey, 1);
                }
                // If the unequipped item was a petal with petMobType, despawn all pets of that type
                // (apex eggs spawn multiple pets, so we need to clear them all)
                if (oldItem.type === 'petal' && oldItem.petalType && oldItem.rarity) {
                    const oldPetalStats = (0, petals_1.getPetalStats)(oldItem.petalType, oldItem.rarity);
                    if (oldPetalStats?.petMobType) {
                        for (let i = constants_1.enemies.length - 1; i >= 0; i--) {
                            const e = constants_1.enemies[i];
                            if (e.ownerId === player.id && e.type === oldPetalStats.petMobType) {
                                (0, petal_actions_1.despawnPet)(e, io);
                            }
                        }
                    }
                }
            }
            // Pass 2: remove newly-equipped items from inventory
            for (let index = 0; index < loadoutIterationLength; index++) {
                const oldItem = oldLoadout[index] || null;
                const newItem = validatedLoadout[index];
                if (!newItem)
                    continue;
                if (oldItem && itemsMatch(oldItem, newItem))
                    continue;
                const newKey = getInventoryKey(newItem);
                if (newKey && newItem.rarity) {
                    if ((0, playerManager_1.hasItem)(serverInventory, newItem.rarity, newKey, 1)) {
                        (0, playerManager_1.removeItem)(serverInventory, newItem.rarity, newKey, 1);
                    }
                    else {
                        console.warn(`[SERVER] Attempted to equip ${newKey} (${newItem.rarity}) but it doesn't exist in inventory`);
                    }
                }
            }
            // Apply petal health bonuses to all petals in loadout
            validatedLoadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal') {
                    (0, playerManager_1.applyPetalHealthBonus)(petal, player);
                    // Check if this is a new petal (different from old loadout) or newly equipped
                    const oldPetal = oldLoadout[index];
                    const isNewPetal = !oldPetal ||
                        oldPetal.type !== 'petal' ||
                        oldPetal.petalType !== petal.petalType ||
                        oldPetal.rarity !== petal.rarity;
                    // console.log(`[PET DEBUG] Petal at index ${index}: type=${petal.petalType}, rarity=${petal.rarity}, isNewPetal=${isNewPetal}`);
                    // If it's a new petal, set it on cooldown and start the cooldown timer
                    if (isNewPetal && petal.petalType) {
                        petal.onCooldown = true;
                        const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity || 'common');
                        // console.log(`[PET DEBUG] Petal stats for ${petal.petalType}:`, petalStats ? { petMobType: petalStats.petMobType, petMobRarity: petalStats.petMobRarity } : 'null');
                        if (petalStats) {
                            const cooldownTime = (0, petals_1.getEffectivePetalCooldown)(petal.petalType, petal.rarity, petalStats);
                            // Deadline for the tick-loop backstop; without it a freshly
                            // equipped petal's reload is cancelled on the next tick.
                            petal.cooldownEndTime = Date.now() + cooldownTime;
                            // Capture targetPlayerId in closure for setTimeout
                            const targetId = targetPlayerId;
                            // Snapshot the petal identity at scheduling time so a stale timer
                            // cannot overwrite a slot that has since been swapped to a different petal.
                            const snapshotPetalType = petal.petalType;
                            const snapshotRarity = petal.rarity;
                            setTimeout(() => {
                                const current = constants_1.players[targetId]?.loadout[index];
                                if (!constants_1.players[targetId] || !current || !current.onCooldown)
                                    return;
                                // Only restore if the slot still holds the same petal identity
                                if (current.type !== 'petal' ||
                                    current.petalType !== snapshotPetalType ||
                                    current.rarity !== snapshotRarity) {
                                    return;
                                }
                                {
                                    // Restore petal after cooldown
                                    const restoredPetal = {
                                        type: petal.type,
                                        petalType: petal.petalType,
                                        rarity: petal.rarity,
                                        health: petal.maxHealth,
                                        maxHealth: petal.maxHealth,
                                        onCooldown: false
                                    };
                                    // Apply petal health bonus
                                    (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, constants_1.players[targetId]);
                                    constants_1.players[targetId].loadout[index] = restoredPetal;
                                    io.emit('petalRestored', {
                                        playerId: constants_1.players[targetId].id,
                                        slotIndex: index,
                                        petal: constants_1.players[targetId].loadout[index]
                                    });
                                    // Check if this petal should spawn a pet when restored
                                    // Get fresh petal stats to ensure we have the latest petMobType
                                    if (restoredPetal.petalType && restoredPetal.rarity) {
                                        const restoredPetalStats = (0, petals_1.getPetalStats)(restoredPetal.petalType, restoredPetal.rarity);
                                        // console.log(`[PET DEBUG] Restored petal stats:`, restoredPetalStats ? { petMobType: restoredPetalStats.petMobType, petMobRarity: restoredPetalStats.petMobRarity } : 'null');
                                        if (restoredPetalStats?.petMobType && restoredPetal.rarity) {
                                            const petMobType = restoredPetalStats.petMobType;
                                            // Pet inherits the petal's rarity
                                            const player = constants_1.players[targetPlayerId];
                                            if (player && !player.isDead) {
                                                // console.log(`[PET] Spawning pet ${petMobType} (${restoredPetal.rarity}) for player ${player.id} when petal restored`);
                                                (0, petal_actions_1.spawnPet)(petMobType, restoredPetal.rarity, player.x, player.y, player.id, io, false, restoredPetalStats.petCount ?? 1);
                                            }
                                            else {
                                                // console.log(`[PET DEBUG] Player check failed: player=${!!player}, isDead=${player?.isDead}`);
                                            }
                                        }
                                        else {
                                            // console.log(`[PET DEBUG] No petMobType in restored petal stats`);
                                        }
                                    }
                                    else {
                                        // console.log(`[PET DEBUG] Missing petalType or rarity: petalType=${restoredPetal.petalType}, rarity=${restoredPetal.rarity}`);
                                    }
                                }
                            }, cooldownTime);
                        }
                    }
                    // Check if this petal should spawn a pet when first equipped (spawn immediately)
                    if (isNewPetal && petal.petalType) {
                        const petalStatsForSpawn = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity || 'common');
                        // console.log(`[PET DEBUG] Checking for immediate spawn: petalStatsForSpawn=`, petalStatsForSpawn ? { petMobType: petalStatsForSpawn.petMobType, petMobRarity: petalStatsForSpawn.petMobRarity } : 'null');
                        if (petalStatsForSpawn?.petMobType && petal.rarity) {
                            const petMobType = petalStatsForSpawn.petMobType;
                            // Pet inherits the petal's rarity
                            // Spawn pet immediately when petal is first equipped
                            const player = constants_1.players[targetPlayerId];
                            // console.log(`[PET DEBUG] Player check: player=`, !!player, `isDead=`, player?.isDead);
                            if (player && !player.isDead) {
                                // console.log(`[PET] Spawning pet ${petMobType} (${petal.rarity}) for player ${player.id} when petal equipped`);
                                (0, petal_actions_1.spawnPet)(petMobType, petal.rarity, player.x, player.y, player.id, io, false, petalStatsForSpawn.petCount ?? 1);
                            }
                            else {
                                // console.log(`[PET DEBUG] Failed to spawn: player=${!!player}, isDead=${player?.isDead}`);
                            }
                        }
                        else {
                            // console.log(`[PET DEBUG] No petMobType found in petalStatsForSpawn`);
                        }
                    }
                }
            });
            // Use validated loadout and server's authoritative inventory
            player.loadout = validatedLoadout;
            player.inventory = serverInventory; // Use server's inventory, not client's
            // While split, the two halves share ONE inventory and ONE logical
            // loadout (the split clones it, so they start identical). Every
            // loadout edit must be mirrored onto the parked half: if it kept
            // its own copy, unequipping on the active half would return petals
            // to the shared inventory while the parked half still held them —
            // and any save that grabs the parked half (the 60s autosave and
            // the disconnect save both use players[originalId]) would persist
            // both copies, duping the whole loadout every session.
            if (splitState) {
                const otherHalfId = splitState.player1.id === targetPlayerId
                    ? splitState.player2.id
                    : splitState.player1.id;
                const otherHalf = constants_1.players[otherHalfId];
                if (otherHalf) {
                    // The parked half's pets follow its loadout: despawn pets of
                    // any egg petal this edit removed (its mirrored copy is about
                    // to lose that slot too).
                    for (let index = 0; index < loadoutIterationLength; index++) {
                        const oldItem = oldLoadout[index] || null;
                        const newItem = validatedLoadout[index];
                        if (!oldItem)
                            continue;
                        if (newItem && itemsMatch(oldItem, newItem))
                            continue;
                        if (oldItem.type === 'petal' && oldItem.petalType && oldItem.rarity) {
                            const oldPetalStats = (0, petals_1.getPetalStats)(oldItem.petalType, oldItem.rarity);
                            if (oldPetalStats?.petMobType) {
                                for (let i = constants_1.enemies.length - 1; i >= 0; i--) {
                                    const e = constants_1.enemies[i];
                                    if (e.ownerId === otherHalf.id && e.type === oldPetalStats.petMobType) {
                                        (0, petal_actions_1.despawnPet)(e, io);
                                    }
                                }
                            }
                        }
                    }
                    otherHalf.inventory = serverInventory;
                    otherHalf.loadout = validatedLoadout.map(item => (item ? { ...item } : null));
                    (0, playerManager_1.recalculatePlayerStats)(otherHalf, io);
                    // Broadcast like splitPlayer does so other clients re-render
                    // the parked half's petals from its new loadout.
                    io.emit('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(otherHalf));
                }
            }
            // Recalculate player stats based on equipped petal modifiers
            (0, playerManager_1.recalculatePlayerStats)(player, io);
            // Only the player needs their own loadout update
            socket.emit('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(player));
            // Persist to DB so title-screen edits survive re-authentication when the game starts
            if (socket.userId) {
                savePlayerProgressImmediate(player, socket.userId);
            }
        }
    });
    socket.on('craftItems', (data) => {
        try {
            console.log('[CRAFT] Craft request received:', { itemCount: data.items?.length, playerId: socket.id });
            const player = (0, gameState_1.getSessionPlayer)(socket.id);
            if (!player) {
                console.log('[CRAFT] Player not found');
                socket.emit('craftingFailed', 'Player not found');
                return;
            }
            // A shift "craft all" may stage a sub-batch remainder (it gets pooled
            // below), so only a plain craft has to be whole batches of 5.
            if (!data.items || data.items.length < 5 || (!data.craftAll && data.items.length % 5 !== 0)) {
                console.log('[CRAFT] Invalid item count:', data.items?.length);
                socket.emit('craftingFailed', 'Invalid number of items for crafting');
                return;
            }
            const firstItem = data.items[0];
            const { type, rarity, petalType } = firstItem;
            if (!rarity) {
                console.log('[CRAFT] Missing rarity');
                socket.emit('craftingFailed', 'Items must have a rarity');
                return;
            }
            // Use the same format as when items are picked up: `${type}_${petalType}` for petals
            const itemKey = type === 'petal' && petalType ? `${type}_${petalType}` : type;
            console.log('[CRAFT] Crafting:', { type, rarity, petalType, itemKey, itemCount: data.items.length });
            const validCraft = data.items.every(item => item.type === type && item.rarity === rarity && item.petalType === petalType);
            if (!validCraft) {
                console.log('[CRAFT] Invalid craft - items not matching');
                socket.emit('craftingFailed', 'Items must be of same type and rarity');
                return;
            }
            if (!(0, playerManager_1.hasItem)(player.inventory, rarity, itemKey, data.items.length)) {
                console.log('[CRAFT] Not enough items in inventory');
                socket.emit('craftingFailed', 'Not enough items to craft');
                return;
            }
            const rarityUpgrades = {
                common: 'uncommon',
                uncommon: 'rare',
                rare: 'epic',
                epic: 'legendary',
                legendary: 'mythic',
                mythic: 'ultra',
                ultra: 'super',
                super: 'unique',
                unique: 'apex'
            };
            const newRarity = rarityUpgrades[rarity];
            if (!newRarity) {
                console.log('[CRAFT] Cannot upgrade apex items');
                socket.emit('craftingFailed', 'Cannot upgrade apex items');
                return;
            }
            const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
            const rarityIndex = rarities.indexOf(rarity);
            const baseChance = 64;
            // Each equipped clover matching the crafted rarity adds +0.05%
            // success chance. Storage slots (10+) don't count, same as
            // calculatePlayerModifiers.
            let cloverBonus = 0;
            if (player.loadout) {
                for (let i = 0; i < Math.min(player.loadout.length, 10); i++) {
                    const slot = player.loadout[i];
                    if (slot && slot.type === 'petal' && slot.petalType === 'clover' && slot.rarity === rarity) {
                        cloverBonus += 0.05;
                    }
                }
            }
            const successChance = Math.min(100, baseChance / Math.pow(2, rarityIndex) + cloverBonus);
            // Remove items from inventory - check if removal was successful
            const removed = (0, playerManager_1.removeItem)(player.inventory, rarity, itemKey, data.items.length);
            if (!removed) {
                console.log('[CRAFT] Failed to remove items from inventory');
                socket.emit('craftingFailed', 'Failed to remove items from inventory');
                return;
            }
            let successfulCrafts = 0;
            let numBatches = 0;
            let petalsReturned = 0;
            if (data.craftAll) {
                // Shift "craft all": pool the staged petals with the rest of
                // this petal still in inventory, then craft whole batches —
                // recycling the petals returned from failed batches — until
                // fewer than 5 remain, so it all resolves in one pass.
                // Bounded: each batch removes 5 and returns at most 4, so the
                // pool strictly shrinks and the loop always terminates.
                let pool = data.items.length; // staged petals were removed above
                const remainder = (0, inventoryCodec_1.getItemCount)(player.inventory, rarity, itemKey);
                if (remainder > 0) {
                    (0, playerManager_1.removeItem)(player.inventory, rarity, itemKey, remainder);
                    pool += remainder;
                }
                while (pool >= 5) {
                    pool -= 5;
                    numBatches++;
                    if (Math.random() * 100 < successChance) {
                        successfulCrafts++; // all 5 consumed for one upgrade
                    }
                    else {
                        // On failure, lose 1-4 petals; the survivors go back
                        // into the pool to be crafted again.
                        pool += 5 - (1 + Math.floor(Math.random() * 4));
                    }
                }
                petalsReturned = pool; // sub-batch remainder (< 5)
                if (pool > 0) {
                    (0, playerManager_1.addItem)(player.inventory, rarity, itemKey, pool);
                }
            }
            else {
                // Normal craft: exactly the staged batches. Failure returns are
                // handed back but not re-crafted.
                let totalLost = 0;
                numBatches = data.items.length / 5;
                for (let i = 0; i < numBatches; i++) {
                    if (Math.random() * 100 < successChance) {
                        successfulCrafts++;
                        totalLost += 5; // All 5 consumed on success
                    }
                    else {
                        // On failure, lose 1-4 petals (return 1-4 back)
                        const lost = 1 + Math.floor(Math.random() * 4); // 1 to 4
                        totalLost += lost;
                    }
                }
                // Return the petals that weren't lost
                petalsReturned = data.items.length - totalLost;
                if (petalsReturned > 0) {
                    (0, playerManager_1.addItem)(player.inventory, rarity, itemKey, petalsReturned);
                }
            }
            if (successfulCrafts > 0) {
                (0, playerManager_1.addItem)(player.inventory, newRarity, itemKey, successfulCrafts);
                // Send global notification for super or unique petal crafts
                if ((newRarity === 'super' || newRarity === 'unique' || newRarity === 'apex') && type === 'petal' && petalType) {
                    const petalStats = (0, petals_1.getPetalStats)(petalType, newRarity);
                    if (petalStats) {
                        const rarityColors = {
                            super: '#2bffa4',
                            unique: '#ffffff',
                            apex: '#ff00ff'
                        };
                        const rarityColor = rarityColors[newRarity] || '#ffffff';
                        const petalName = petalStats.name;
                        const rarityLabel = newRarity.charAt(0).toUpperCase() + newRarity.slice(1);
                        const article = /^[aeiou]/i.test(rarityLabel) ? 'An' : 'A';
                        const username = socket.username || 'Unknown';
                        const playerNickname = player.name || username;
                        const chatMessage = `<b style="color: ${rarityColor};">${article} ${rarityLabel} ${petalName} has been crafted by <b style="color: #00ff00;">@${username}</b> [<b style="color: yellow;">${playerNickname}</b>]</b>`;
                        const plainMessage = `${article} ${rarityLabel} ${petalName} has been crafted by @${username} [${playerNickname}]`;
                        io.emit('chatMessage', {
                            sender: '',
                            content: chatMessage,
                            timestamp: Date.now()
                        });
                        // Save to global notifications with player info
                        const notification = {
                            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            type: newRarity === 'apex' ? 'apex_craft'
                                : newRarity === 'unique' ? 'unique_craft'
                                    : 'super_craft',
                            message: plainMessage,
                            timestamp: Date.now()
                        };
                        database_1.database.addNotification(notification);
                    }
                }
            }
            console.log('[CRAFT] Crafting complete:', { successfulCrafts, failCount: numBatches - successfulCrafts, newRarity });
            // Persist immediately. Crafting from the TITLE SCREEN otherwise never
            // reaches the DB: nothing else there triggers a save, and pressing
            // Play re-authenticates on the same socket, which rebuilds
            // players[socket.id] from saved progress — silently reverting the
            // craft. (Same reason updateLoadout saves immediately.)
            if (socket.userId) {
                savePlayerProgressImmediate(player, socket.userId);
            }
            // Always emit craftingFinished, even if all crafts failed
            // This ensures the client gets feedback and updates inventory
            socket.emit('craftingFinished', {
                successCount: successfulCrafts,
                failCount: numBatches - successfulCrafts,
                newItem: successfulCrafts > 0 ? { type: itemKey, rarity: newRarity } : { type: itemKey, rarity: rarity },
                inventory: player.inventory,
                petalsReturned
            });
            console.log('[CRAFT] craftingFinished event emitted');
        }
        catch (error) {
            console.error('[CRAFT] Error during crafting:', error);
            socket.emit('craftingFailed', 'An error occurred during crafting');
        }
    });
    // Absorb petals for XP — the "Switch" tab of the craft menu. Maze-only:
    // just the surplus over the maze entry snapshot (petals obtained during
    // this run) may be absorbed. Validates the full request before removing
    // anything, so a failed request never eats a partial batch.
    socket.on('absorbItems', (data) => {
        try {
            const player = constants_1.players[socket.id];
            if (!player || !socket.username) {
                socket.emit('absorbFailed', { message: 'Player not found' });
                return;
            }
            if (!player.inMaze || !player.mazeRarityShifted) {
                socket.emit('absorbFailed', { message: 'Petals can only be absorbed inside the maze', inventory: player.inventory });
                return;
            }
            if (!data || !Array.isArray(data.items) || data.items.length === 0 || data.items.length > 1000) {
                socket.emit('absorbFailed', { message: 'Invalid absorb request', inventory: player.inventory });
                return;
            }
            // Tally the request into (rarity, itemKey) stacks.
            const tally = new Map();
            for (const item of data.items) {
                if (!item || item.type !== 'petal' || !item.petalType || !item.rarity || (0, petals_1.getRarityIndex)(item.rarity) < 0) {
                    socket.emit('absorbFailed', { message: 'Only petals can be absorbed', inventory: player.inventory });
                    return;
                }
                const itemKey = `petal_${item.petalType}`;
                const mapKey = `${item.rarity}|${itemKey}`;
                const entry = tally.get(mapKey);
                if (entry)
                    entry.count++;
                else
                    tally.set(mapKey, { rarity: item.rarity, itemKey, count: 1 });
            }
            for (const entry of tally.values()) {
                if (!(0, playerManager_1.hasItem)(player.inventory, entry.rarity, entry.itemKey, entry.count)) {
                    socket.emit('absorbFailed', { message: 'Missing items in inventory', inventory: player.inventory });
                    return;
                }
                if (entry.count > (0, playerManager_1.getMazeAbsorbableCount)(player, entry.rarity, entry.itemKey)) {
                    socket.emit('absorbFailed', { message: 'Only petals found in the maze can be absorbed', inventory: player.inventory });
                    return;
                }
            }
            let xpGained = 0;
            let absorbedCount = 0;
            for (const entry of tally.values()) {
                (0, playerManager_1.removeItem)(player.inventory, entry.rarity, entry.itemKey, entry.count);
                xpGained += (petals_1.ABSORB_XP[entry.rarity] || 0) * entry.count;
                absorbedCount += entry.count;
            }
            if (xpGained > 0) {
                // Absorption skill talent boosts Absorb-tab XP, up to 800% at apex.
                // Read from the OUTSIDE tree — absorbing is bought out there.
                const absorbingMultiplier = petals_1.ABSORBING_SKILL_MULTIPLIERS[(0, playerManager_1.getAbsorbingTier)(player) || ''] || 1.0;
                xpGained = Math.round(xpGained * absorbingMultiplier);
                // Absorbing is the only source that feeds BOTH tracks: it raises
                // the outside level (banked, silent) and the maze level (live).
                // Only the second call saves — savePlayerProgress writes both.
                addXPToPlayer(player, xpGained);
                addMazeXPToPlayer(player, xpGained, socket.id);
            }
            socket.emit('itemsAbsorbed', {
                xpGained,
                absorbedCount,
                inventory: player.inventory
            });
            if (socket.userId) {
                savePlayerProgress(player, socket.userId);
            }
        }
        catch (error) {
            console.error('[ABSORB] Error during absorb:', error);
            const player = constants_1.players[socket.id];
            socket.emit('absorbFailed', { message: 'An error occurred during absorbing', inventory: player?.inventory });
        }
    });
    // Shop handlers
    socket.on('shopBuy', (data) => {
        try {
            const player = (0, gameState_1.getSessionPlayer)(socket.id);
            if (!player) {
                socket.emit('shopPurchaseError', 'Player not found');
                return;
            }
            // Check if petal exists
            const petalStats = (0, petals_1.getPetalStats)(data.petalType, data.rarity);
            if (!petalStats) {
                socket.emit('shopPurchaseError', 'Invalid petal');
                return;
            }
            // Skip admin petals
            if (petalStats.isAdminPetal) {
                socket.emit('shopPurchaseError', 'Cannot purchase admin petals');
                return;
            }
            if ((0, petals_1.isUndroppableEggPetalType)(data.petalType)) {
                socket.emit('shopPurchaseError', 'Cannot purchase undroppable eggs');
                return;
            }
            // Skip unique/apex rarity - not purchasable (matches the client's
            // buyableRarities filter in shop.ts; the server must enforce this
            // itself since a modified client can send any rarity string).
            if (data.rarity === 'unique' || data.rarity === 'apex') {
                socket.emit('shopPurchaseError', 'Cannot purchase this rarity');
                return;
            }
            // Price is always recomputed server-side — the client-supplied
            // `data.price` is never trusted (a modified client could send an
            // arbitrary or negative value to get free petals or mint stars).
            const price = (0, petals_1.getShopPrice)(data.petalType, data.rarity);
            const stars = player.stars || 0;
            if (stars < price) {
                socket.emit('shopPurchaseError', 'Insufficient stars');
                return;
            }
            // Deduct stars
            player.stars = stars - price;
            (0, petal_actions_1.syncSplitStars)(player);
            // Add item to inventory. The inventory is always in regular-world
            // terms — even inside the maze (only the locked loadout shifts) —
            // so shop purchases land at their listed rarity everywhere.
            const itemKey = `petal_${data.petalType}`;
            (0, playerManager_1.addItem)(player.inventory, data.rarity, itemKey, 1);
            // Save progress
            const userId = gameState_1.playerUserIds[socket.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
            // Emit success (only to this player)
            socket.emit('shopPurchaseSuccess', {
                inventory: player.inventory,
                stars: player.stars
            });
            socket.emit('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(player));
        }
        catch (error) {
            console.error('[SHOP] Error during purchase:', error);
            socket.emit('shopPurchaseError', 'An error occurred during purchase');
        }
    });
    socket.on('redeemCode', (data) => {
        try {
            const player = (0, gameState_1.getSessionPlayer)(socket.id);
            if (!player) {
                socket.emit('codeRedeemError', 'Player not found');
                return;
            }
            const code = data.code.trim().toUpperCase();
            const redeemedCode = redeemedCodes.get(code);
            if (!redeemedCode) {
                socket.emit('codeRedeemError', 'Invalid code');
                return;
            }
            // Check if code is already used by this player
            const userId = gameState_1.playerUserIds[socket.id];
            if (redeemedCode.usedBy && redeemedCode.usedBy.includes(userId || socket.id)) {
                socket.emit('codeRedeemError', 'Code already redeemed');
                return;
            }
            // Check if code has usage limit
            if (redeemedCode.maxUses && redeemedCode.uses >= redeemedCode.maxUses) {
                socket.emit('codeRedeemError', 'Code has reached maximum uses');
                return;
            }
            // Award stars
            if (player.stars === undefined) {
                player.stars = 0;
            }
            player.stars += redeemedCode.stars;
            (0, petal_actions_1.syncSplitStars)(player);
            // Track usage
            redeemedCode.uses++;
            if (!redeemedCode.usedBy) {
                redeemedCode.usedBy = [];
            }
            redeemedCode.usedBy.push(userId || socket.id);
            // Check if code has reached max uses
            const hasReachedMaxUses = redeemedCode.maxUses && redeemedCode.uses >= redeemedCode.maxUses;
            if (hasReachedMaxUses) {
                // Remove code from memory and database since it's fully used
                redeemedCodes.delete(code);
                deleteCodeFromDatabase(code);
            }
            else {
                // Save code usage to database (only if not fully used)
                saveCodeToDatabase(code, redeemedCode);
            }
            // Save progress
            if (userId) {
                savePlayerProgress(player, userId);
            }
            // Emit success
            socket.emit('codeRedeemSuccess', {
                code: code,
                stars: redeemedCode.stars,
                totalStars: player.stars
            });
            // Save to global notifications with player info
            const username = socket.username || 'Unknown';
            const playerNickname = player.name || username;
            const notification = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'star_code',
                message: `Star code "${code}" redeemed by @${username} [${playerNickname}]! +${redeemedCode.stars} ⭐ Stars`,
                timestamp: Date.now()
            };
            database_1.database.addNotification(notification);
            socket.emit('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(player));
        }
        catch (error) {
            console.error('[SHOP] Error during code redemption:', error);
            socket.emit('codeRedeemError', 'An error occurred during code redemption');
        }
    });
}
