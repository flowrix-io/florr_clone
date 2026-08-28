/**
 * Restoring a petal slot when its reload timer fires.
 *
 * Three paths schedule that timer — equipping onto a cooling slot
 * (connection/inventory.ts), restoring a cooling loadout at spawn-in
 * (connection/session.ts), and the break path in playerState.ts — and each
 * carried its own copy of the same guard-then-rebuild block. The guard is the
 * important part: a timer can outlive the petal it was scheduled for, so the
 * slot's identity is re-checked before anything is written back.
 */
import { Item } from '../item';
import { ServerPlayer } from '../player';
import { players } from '../constants';
import { applyPetalHealthBonus } from './playerManager';
import { emitPetalRestored } from './petalEvents';

/** The petal identity captured when the reload timer was scheduled. */
export interface PetalSnapshot {
    type: Item['type'];
    petalType?: string;
    rarity?: string;
    maxHealth?: number;
}

/**
 * Refills `slotIndex` from `snapshot` and tells the owner's clients.
 *
 * No-ops (returning null) when the player has gone, the slot is no longer
 * reloading, or the slot has since been swapped to a different petal — a stale
 * timer must never overwrite whatever is there now.
 */
export function restorePetalSlot(
    playerId: string,
    slotIndex: number,
    snapshot: PetalSnapshot,
): { player: ServerPlayer; petal: any } | null {
    const player = players[playerId];
    const current = player?.loadout?.[slotIndex];
    if (!player || !current || !current.onCooldown) return null;
    if (current.type !== 'petal' ||
        current.petalType !== snapshot.petalType ||
        current.rarity !== snapshot.rarity) {
        return null;
    }

    const restoredPetal: any = {
        type: snapshot.type,
        petalType: snapshot.petalType,
        rarity: snapshot.rarity,
        health: snapshot.maxHealth,
        maxHealth: snapshot.maxHealth,
        onCooldown: false,
    };
    applyPetalHealthBonus(restoredPetal, player);
    player.loadout[slotIndex] = restoredPetal;

    emitPetalRestored(player.id, {
        playerId: player.id,
        slotIndex,
        petal: player.loadout[slotIndex],
    });

    return { player, petal: restoredPetal };
}
