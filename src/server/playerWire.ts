import { ServerPlayer, effectiveRenderFlags } from '../player';
import { getWireOutbox } from './wireOutbox';

/**
 * Fields of ServerPlayer that a client actually consumes from a `playerUpdated`
 * event. Everything else on ServerPlayer is either server-internal bookkeeping,
 * owned by a different channel, or (in the case of `transferToken`) a secret
 * that must never reach a client at all.
 *
 * Spreading the whole ServerPlayer used to put ~9.9KB on the wire for a
 * late-game player. Measured against a real save (777 inventory entries, 365
 * mobKills entries), the dropped fields accounted for most of it:
 *
 *   mobKills        3657B  now streamed incrementally as `mobKillUpdate`
 *   petalPositions  1336B  discarded on arrival — the gameStateUpdate `p`
 *                          channel owns per-petal state, and assigning these
 *                          snaps every petal past its interpolation
 *   mazeLoadout      854B  title-screen only, via its own `mazeLoadoutUpdated`
 *   inputs/effects/parked-track XP/regular* stashes — never read by a client
 *
 * Keys are only emitted when the value is not `undefined`: the codec spends
 * ~3 bytes on an explicitly-undefined field, and the client's `Object.assign`
 * would otherwise wipe a value it owns.
 */
/**
 * What any client needs to see and render SOMEONE ELSE'S flower. `loadout` is
 * in here because graphics/player-drawing.ts renders a remote flower's petals
 * straight off it; `level` because it prints under the health bar.
 */
const PUBLIC_FIELDS: readonly (keyof ServerPlayer)[] = [
    'id', 'name', 'x', 'y', 'angle', 'score',
    'velocityX', 'velocityY', 'knockbackX', 'knockbackY',
    'health', 'maxHealth', 'damage',
    'speed_boost',
    'isInvulnerable', 'isDead',
    'faceFlags', 'equipFlags', 'renderFlags', 'equippedSkinId', 'mouth',
    'squadId', 'guildName',
    'inPvpArena', 'pvpScore', 'inMaze',
    'sizeMultiplier', 'magnetism',
    'level',
    'loadout',
];

/**
 * Additionally sent when the recipient IS this player. All menu/progression
 * state — no client ever reads another player's inventory (every client-side
 * write to it is behind `forEachOwnPlayer`), and `inventory` alone is 2.5KB on
 * a late-game save, so shipping it per-player in the join snapshot was the bulk
 * of that frame.
 */
const OWN_FIELDS: readonly (keyof ServerPlayer)[] = [
    'speedFactor',                      // client-side prediction, own flower only
    'killedBy',                         // death overlay on splitter switch (socket.ts)
    'xp', 'xpToNextLevel',
    'inventory',
    'tp', 'skills', 'stars',
    'mazeEntryCounts',                  // Absorb tab accounting (inventory.ts)
];

const WIRE_FIELDS: readonly (keyof ServerPlayer)[] = [...PUBLIC_FIELDS, ...OWN_FIELDS];

/**
 * Project a ServerPlayer down to the fields a client reads. Array/object values
 * are passed through by reference (not cloned) — the server already allocates a
 * fresh `inventory`/`loadout` when either changes, which is what the client's
 * change detection keys off.
 *
 * `includeMobKills` is for the one-shot join snapshot: the in-game mob gallery
 * seeds itself from the recipient's OWN entry in `currentPlayers`, and from
 * then on `mobKillUpdate` keeps it current. No client ever renders another
 * player's gallery, so every other entry omits the table.
 */
export function sanitizePlayerForClient(
    player: ServerPlayer,
    includeMobKills = false,
): Partial<ServerPlayer> {
    const out = project(player, WIRE_FIELDS);
    if (includeMobKills && player.mobKills !== undefined) out.mobKills = player.mobKills;
    return out;
}

/**
 * Trim to just the render fields, for broadcasts that by construction describe
 * someone OTHER than the recipient (`newPlayer`).
 */
export function sanitizePublicPlayerForClient(player: ServerPlayer): Partial<ServerPlayer> {
    return project(player, PUBLIC_FIELDS);
}

/**
 * Join snapshot for `currentPlayers`. This used to be the raw `players` map:
 * every ServerPlayer in full, which meant a joining client downloaded everyone
 * else's inventory and mobKills table — and their `transferToken`, a
 * cross-server auth secret that has no business leaving the server. On a busy
 * shard that single frame ran to hundreds of KB, far past the 64KB uWS
 * backpressure limit at which the frame is dropped outright.
 */
export function sanitizePlayersForClient(
    players: Record<string, ServerPlayer>,
    ownSocketId: string,
): Record<string, Partial<ServerPlayer>> {
    const out: Record<string, Partial<ServerPlayer>> = {};
    for (const id in players) {
        // Only the recipient's own entry carries progression state; everyone
        // else is trimmed to what it takes to draw their flower.
        out[id] = id === ownSocketId
            ? sanitizePlayerForClient(players[id], true)
            : project(players[id], PUBLIC_FIELDS);
    }
    return out;
}

function project(player: ServerPlayer, fields: readonly (keyof ServerPlayer)[]): Partial<ServerPlayer> {
    const out: any = {};
    for (let i = 0; i < fields.length; i++) {
        const k = fields[i];
        // renderFlags goes out merged with the transient glitch bit, matching
        // what the per-tick `r` field carries (see effectiveRenderFlags). If it
        // didn't, an occasional `playerUpdated` would assign the un-glitched
        // value over what the tick stream just set, flickering the effect off
        // for a frame.
        if (k === 'renderFlags') {
            if (player.renderFlags !== undefined || player.glitched) {
                out.renderFlags = effectiveRenderFlags(player);
            }
            continue;
        }
        const v = (player as any)[k];
        if (v !== undefined) out[k] = v;
    }
    return out;
}

/**
 * Broadcasts a flower's post-damage state: health, invulnerability and — when
 * the cause imparts one — the knockback impulse the client should apply.
 *
 * Eight sites assembled this payload by hand (mob contact, ring hit, the
 * petal-vs-player swing, poison ticks, PVP hits, second chance, sponge
 * absorb...), so a field added to the packet had to be remembered in eight
 * places. Only the fields a caller actually supplies are included: two sites
 * deliberately omit knockback and two omit damageDealt, and the wire shape
 * must not change.
 */
export function emitPlayerDamaged(
    player: ServerPlayer,
    extra: {
        knockbackX?: number;
        knockbackY?: number;
        damageDealt?: number;
        /** Overrides the player's current flag (the second-chance grant). */
        isInvulnerable?: boolean;
    } = {},
): void {
    const payload: Record<string, unknown> = {
        playerId: player.id,
        health: player.health,
        maxHealth: player.maxHealth,
        isInvulnerable: extra.isInvulnerable ?? player.isInvulnerable,
    };
    if (extra.knockbackX !== undefined) payload.knockbackX = extra.knockbackX;
    if (extra.knockbackY !== undefined) payload.knockbackY = extra.knockbackY;
    if (extra.damageDealt !== undefined) payload.damageDealt = extra.damageDealt;
    getWireOutbox().all('playerDamaged', payload);
}
