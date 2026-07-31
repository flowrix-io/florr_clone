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
    petalsSig: number;
}

/** One enemy's last-sent field values, the baseline for the next delta. */
export interface SentEnemyState {
    x: number; y: number; a: number; h: number; H: number; t: any; T: any;
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
    lastSentEnemies?: Map<string, SentEnemyState>;
    lastSentPlayers?: Map<string, SentPlayerState>;
    /**
     * Set when a gameStateUpdate frame was dropped by the uWS backpressure
     * limit: the lastSent* maps were already committed as if delivered, so the
     * next tick must re-send full state with a replace-all marker (F=1).
     */
    needsEntityResync?: boolean;
    /**
     * Set when any item-channel frame (spawn/remove/pickup) was dropped: the
     * client's item map has silently diverged (invisible loot or ghost items),
     * so re-send the full eligible list via the itemsUpdate replace channel.
     */
    needsItemResync?: boolean;
}
