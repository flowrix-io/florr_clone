/**
 * The server's view of a connected socket.
 *
 * `AuthenticatedSocket` carries the per-connection state the tick loop needs:
 * who the player is, how good their connection is, and what was last sent to
 * them (the delta-compression baseline). It lived as a local interface in
 * server.ts, which meant the broadcast code could not be lifted out of that
 * file without duplicating it — server/commands.ts already carries a narrower
 * copy for its own use.
 */

import { Socket } from '../../ws_server';

/** Connection grade, derived from ping samples; drives wire precision. */
export type ConnectionQuality = 'good' | 'medium' | 'slow';

/** One player's last-sent field values, the baseline for the next delta. */
export interface SentPlayerState {
    /** Which kind this entry describes; sent once, on first appearance. */
    K: number;
    x: number; y: number; a: number;
    vx: number; vy: number;
    h: number; H: number;
    l: number; s: number;
    e: number;
    f: number; q: number; r: number; k: string; m: number;
    v: number; M: number; V: number; z: number;
    n: string;
    sm: number;
    u: number;
    /**
     * Bitmask of loadout slots (0-9) currently on cooldown.
     *
     * petalBroken/petalRestored are owner-only (see server/petalEvents.ts), so
     * this is the ONLY carrier of reload state for other players' flowers. It
     * has to ride the snapshot rather than an event because petal POSITIONS are
     * budgeted (PETAL_DETAIL_MAX_PLAYERS): a flower past that budget sends no
     * positions, and the client's renderer then falls back to this flag to
     * decide whether a petal is out. Delta-encoded like every other field, so
     * it costs one small int only on the ticks a slot actually breaks or heals.
     */
    c: number;
    petalsSig: number;
}

/** One enemy's last-sent field values, the baseline for the next delta. */
export interface SentEnemyState {
    K: number;
    x: number; y: number; a: number; h: number; H: number; t: any; T: any;
}

/**
 * One dropped item's last-sent field values.
 *
 * Items used to travel on their own one-shot event channel (itemsSpawned /
 * itemRemoved / itemPickedUp) as whole unpacked maps. One-shot is the problem:
 * a frame lost to uWS backpressure left the client with loot it could not see
 * or a ghost it could never clear, which is why a whole `needsItemResync`
 * recovery path existed. As part of the entity stream they are delta-encoded
 * and re-derived from this baseline every tick, so a dropped frame self-heals.
 */
export interface SentItemState {
    K: number;
    x: number; y: number;
    /** Item kind (petal / potion / …) and rarity, interned to small ints. */
    I: number; R: number;
    /** Petal type name, for petal drops. Interned ids cannot cross the wire. */
    P: string;
}

export interface AuthenticatedSocket extends Socket {
    userId?: string;
    username?: string;
    connectionQuality?: ConnectionQuality;
    averagePing?: number;
    pingSamples?: number[];
    lastUpdateTime?: number;
    lastGameState?: any; // For delta compression
    lastStateHash?: number; // Lightweight hash for skip-if-unchanged
    /**
     * Everything this client has been told about, in ONE table.
     *
     * Was two maps (lastSentEnemies / lastSentPlayers) plus an untracked item
     * channel. Players, mobs and items share a single id sequence (see
     * entity_ids.ts — that is a deliberate invariant, because `world.lookup`
     * spans all kinds), so one map keyed by id is well-defined and the removal
     * sweep becomes one pass instead of one per kind.
     */
    lastSentEntities?: Map<string, SentPlayerState | SentEnemyState | SentItemState>;
    /**
     * Set when a gameStateUpdate frame was dropped by the uWS backpressure
     * limit: the lastSent* maps were already committed as if delivered, so the
     * next tick must re-send full state with a replace-all marker (F=1).
     */
    needsEntityResync?: boolean;
}
