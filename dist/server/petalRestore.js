"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restorePetalSlot = restorePetalSlot;
const constants_1 = require("../constants");
const playerManager_1 = require("./playerManager");
const petalEvents_1 = require("./petalEvents");
/**
 * Refills `slotIndex` from `snapshot` and tells the owner's clients.
 *
 * No-ops (returning null) when the player has gone, the slot is no longer
 * reloading, or the slot has since been swapped to a different petal — a stale
 * timer must never overwrite whatever is there now.
 */
function restorePetalSlot(playerId, slotIndex, snapshot) {
    const player = constants_1.players[playerId];
    const current = player?.loadout?.[slotIndex];
    if (!player || !current || !current.onCooldown)
        return null;
    if (current.type !== 'petal' ||
        current.petalType !== snapshot.petalType ||
        current.rarity !== snapshot.rarity) {
        return null;
    }
    const restoredPetal = {
        type: snapshot.type,
        petalType: snapshot.petalType,
        rarity: snapshot.rarity,
        health: snapshot.maxHealth,
        maxHealth: snapshot.maxHealth,
        onCooldown: false,
    };
    (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, player);
    player.loadout[slotIndex] = restoredPetal;
    (0, petalEvents_1.emitPetalRestored)(player.id, {
        playerId: player.id,
        slotIndex,
        petal: player.loadout[slotIndex],
    });
    return { player, petal: restoredPetal };
}
