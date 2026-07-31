/**
 * Shared helpers for reading the client's own player(s) out of the game object.
 *
 * These were module-private in socket.ts, which was fine while every socket
 * handler lived in that one file. The handlers are now split across
 * src/net/handlers/*, so the helpers they all rely on live here.
 */

import { Player } from '../player';
import { Item } from '../item';

export function padLoadout(arr: (Item | null)[] | undefined, size: number): (Item | null)[] {
    const out: (Item | null)[] = new Array(size).fill(null);
    if (arr) for (let i = 0; i < Math.min(arr.length, size); i++) out[i] = arr[i] || null;
    return out;
}

// Full-player broadcasts (currentPlayers, newPlayer, updatePlayers, transfers)
// spread the whole server player object, which carries that tick's raw
// petalPositions: absolute coords with no per-petal interpolation targets, and —
// for a flower outside the recipient's petal-detail range — never refreshed
// again. Rendering those would pin the ring to coords the flower has since moved
// away from. The gameStateUpdate `p` channel is the only valid source, so drop
// the raw array at ingestion and let that channel (re)build it.
export function withoutRawPetalPositions<T extends { petalPositions?: any }>(player: T): T {
    if (player.petalPositions) player.petalPositions = undefined;
    return player;
}

// After the splitter petal runs, this client owns two flowers — `socket.id` and
// `${socket.id}_split2` — but drives only one at a time (`game.activePlayerId`,
// flipped by the server's `playerSwitched`). The camera, prediction, inventory
// panel and loadout bar all follow that ACTIVE half (game.getLocalPlayer()), so
// every "is this me?" event check has to as well. Comparing against
// `socket.id` alone answered for the abandoned half: the death screen never
// appeared when the clone died, its broken petals never refreshed the loadout
// bar, and shop/inventory updates landed on a player object nothing rendered.
export function localPlayerId(game: any): string {
    return game.activePlayerId || game.socket?.id || '';
}

export function localPlayer(game: any): Player | undefined {
    return game.players.get(localPlayerId(game));
}

// True for the half currently being driven — use for camera/UI/death state.
export function isLocalPlayerId(game: any, id: string | undefined): boolean {
    return !!id && id === localPlayerId(game);
}

// True for EITHER half — use for things that belong to the account rather than
// to the flower on screen (loot eligibility, shared inventory, pickup anims).
export function isOwnPlayerId(game: any, id: string | undefined): boolean {
    if (!id) return false;
    const socketId = game.socket?.id;
    if (!socketId) return false;
    return id === socketId || id === game.activePlayerId || id === `${socketId}_split2`;
}

// Run `fn` on every flower this client owns. Account-wide state (inventory,
// stars) is ONE object shared by both halves on the server, so applying a
// snapshot to a single half leaves the other showing a stale bag the moment
// the player switches.
export function forEachOwnPlayer(game: any, fn: (player: any) => void): void {
    const socketId = game.socket?.id;
    if (!socketId) return;
    const seen = new Set<string>();
    for (const id of [socketId, game.activePlayerId, `${socketId}_split2`]) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const p = game.players.get(id);
        if (p) fn(p);
    }
}
