import { ServerPlayer } from '../player';
import { Enemy, Obstacle } from '../server_utils';
import {
    isWall,
    SCALE_FACTOR,
    enemies,
    players
} from '../constants';
import { WORLD_MAP } from '../map_data';

// World items are ECS entities now — see server/itemRegistry.ts (admission,
// payload collection, the spawn batch) and ecs/systems/droppedItems.ts (wall
// push, bounds, expiry). Only the rarity->lifetime table remains here.

// Special mob tracking - using getters/setters for mutability
let _ultraMobCount = 0;
let _superMobCount = 0;
let _uniqueMobCount = 0;
let _ENEMY_COUNT = 1000;

// Track super bosses per section (9 sections, 0-8)
// Section layout:
//   0 | 1 | 2
//   ---------
//   3 | 4 | 5
//   ---------
//   6 | 7 | 8
let _superMobPerSection: (string | null)[] = [null, null, null, null, null, null, null, null, null];

// Super boss per section tracking
export function setSuperMobInSection(section: number, mobId: string | null) {
    if (section >= 0 && section < 9) {
        _superMobPerSection[section] = mobId;
    }
}
export function getSuperMobInSection(section: number): string | null {
    return (section >= 0 && section < 9) ? _superMobPerSection[section] : null;
}
export function clearSuperMobFromSection(section: number) {
    if (section >= 0 && section < 9) {
        _superMobPerSection[section] = null;
    }
}

// For backwards compatibility, export as mutable objects
export const ultraMobCount = { get value() { return _ultraMobCount; }, set value(v: number) { _ultraMobCount = v; } };
export const superMobCount = { get value() { return _superMobCount; }, set value(v: number) { _superMobCount = v; } };
export const uniqueMobCount = { get value() { return _uniqueMobCount; }, set value(v: number) { _uniqueMobCount = v; } };
export const superMobPerSection = {
    get value() { return _superMobPerSection; },
    set value(v: (string | null)[]) { _superMobPerSection = v; }
};

export const ENEMY_COUNT = { get value() { return _ENEMY_COUNT; }, set value(v: number) { _ENEMY_COUNT = v; } };

/**
 * Accounts that are authenticated but still sitting on the title screen.
 *
 * A title-screen client has to authenticate — its inventory, loadout, talent
 * tree and stars all come from the account — but it must not exist in the world
 * until the player presses Ready. Parking those players HERE instead of in
 * `players` is what guarantees that: every simulation, spawn, targeting, save
 * and broadcast loop in the server iterates `players`, so a lobby flower is
 * invisible to all of them by construction rather than by a flag each of those
 * loops would have to remember to check.
 *
 * `authenticate` builds the entry here when `lobby` is set and rebuilds it in
 * `players` (from freshly-flushed saved progress) when the player enters the
 * world. Nothing is ever in both maps.
 */
export const lobbyPlayers: Record<string, ServerPlayer> = {};

/**
 * The player behind a socket whether they are in the world or on the title
 * screen.
 *
 * Use this in ACCOUNT-level handlers — loadout, crafting, shop, talents, skins,
 * chat display names — i.e. anything the title screen can also do. Anything
 * that touches the world must keep reading `players` directly so it can never
 * act on a flower that isn't in it.
 */
export function getSessionPlayer(socketId: string): ServerPlayer | undefined {
    return players[socketId] || lobbyPlayers[socketId];
}

/**
 * Ids of the flowers currently CORRUPTED (ServerPlayer.corrupted).
 *
 * The flag itself lives on the player; this set exists only so the per-tick
 * petal-vs-player pass can ask "is anyone corrupted at all?" in O(1) instead of
 * scanning `players`. Outside the PVP arena that pass is dead weight for every
 * ordinary server, so it stays behind this gate.
 *
 * Always go through setPlayerCorrupted() — writing `player.corrupted` directly
 * leaves the set stale and the gate wrong.
 */
const corruptedPlayerIds = new Set<string>();

export function setPlayerCorrupted(player: ServerPlayer, corrupted: boolean): void {
    player.corrupted = corrupted || undefined;
    if (corrupted) corruptedPlayerIds.add(player.id);
    else corruptedPlayerIds.delete(player.id);
}

/**
 * Whether any corrupted flower is in the world. Prunes ids whose player has
 * left (or whose flag was cleared elsewhere, e.g. by a wholesale respawn
 * rebuild) so a disconnect can't pin the gate open — or leak the id forever.
 */
export function hasCorruptedPlayers(): boolean {
    if (corruptedPlayerIds.size === 0) return false;
    for (const id of corruptedPlayerIds) {
        if (!players[id]?.corrupted) corruptedPlayerIds.delete(id);
    }
    return corruptedPlayerIds.size > 0;
}

export const playerUserIds: Record<string, string> = {}; // Maps player ID to user ID
export const petalLastProjectileTime: Map<string, number> = new Map(); // Track last projectile time per petal instance
export const petalLastRadiationTime: Map<string, number> = new Map(); // Track last radiation pulse per petal instance (uranium)

// Delta sync: for each player, the set of projectile IDs they currently "know about" (i.e. were
// told about via a spawn event and not yet told to remove). Used so we only re-broadcast a
// projectile's full state once on spawn / viewport-enter, instead of every tick.
export const knownMobProjectilesByPlayer: Map<string, Set<number>> = new Map();
export const knownPlayerProjectilesByPlayer: Map<string, Set<number>> = new Map();

// Monotonic counters for projectile IDs. Numeric IDs encode as 1-5 bytes in the binary codec
// versus ~52 bytes for a 50-char string ID — a huge win for high-volume petals (gas/rainbow).
//
// The projectiles themselves are ECS entities (src/ecs/systems/projectileCollision.ts); these
// counters stay here because an ENTITY HANDLE can never be a wire id — handles pack
// index+generation and the index is recycled within seconds under projectile churn, so a
// client would eventually see one alias a different projectile. See components/projectile.ts.
let _nextMobProjectileId = 1;
let _nextPlayerProjectileId = 1;
export function allocateMobProjectileId(): number { return _nextMobProjectileId++; }
export function allocatePlayerProjectileId(): number { return _nextPlayerProjectileId++; }

// Ground pollen puffs and web fields are ECS entities now — see
// ecs/systems/groundEffects.ts for the per-tick behaviour (and the constants
// the tick owns: damage interval, slow factor, slow linger). What stays here
// are the SPAWN-side constants the legacy petal loop stamps into each entity
// and into the spawn events it emits.
export const GROUND_POLLEN_LIFETIME_MS = 5000;
export const WEB_LIFETIME_MS = 10000;       // gardn: entity_set_despawn_tick(web, 10 * TPS)
// How far an attacking throw carries the web out from the petal's orbit. gardn
// accelerates the petal at 30x PLAYER_ACCELERATION for its 0.6s despawn window,
// which carries it several screens; that is unreadable at florr's zoom, so the
// throw is shortened to land just inside the viewport.
export const WEB_THROW_DISTANCE = 620;

// Track petal cooldown timeouts for cleanup (key: `${socketId}-${loadoutIndex}`)
export const petalCooldownTimeouts: Map<string, NodeJS.Timeout> = new Map();

// Item expiration times based on rarity (in milliseconds)
export const ITEM_EXPIRATION_TIMES: Record<string, number> = {
    common: 10000,      // 10 seconds
    uncommon: 20000,    // 20 seconds
    rare: 30000,        // 30 seconds
    epic: 40000,        // 40 seconds
    legendary: 50000,   // 50 seconds
    mythic: 60000,      // 60 seconds
    ultra: 80000,       // 80 seconds
    super: 120000,      // 120 seconds
    unique: 300000,     // 300 seconds (5 minutes)
    apex: 600000        // 600 seconds (10 minutes)
};

// Initialize map obstacles
export function initializeMapObstacles(): Obstacle[] {
    const mapObstacles: Obstacle[] = [];

    // Convert wall elements from WORLD_MAP to obstacles
    WORLD_MAP.filter(isWall).forEach(wall => {
        mapObstacles.push({
            id: Math.random().toString(36).substr(2, 9),
            x: wall.x * SCALE_FACTOR,
            y: wall.y * SCALE_FACTOR,
            width: wall.width * SCALE_FACTOR,
            height: wall.height * SCALE_FACTOR,
            type: 'wall',
            isEnemy: false
        });
    });

    return mapObstacles;
}

// Export getters for game state
export function getPlayers(): Record<string, ServerPlayer> {
    return players;
}

export function getEnemies(): Enemy[] {
    return enemies;
}

export function setEnemyCount(count: number) {
    _ENEMY_COUNT = count;
}

export function getEnemyCount(): number {
    return _ENEMY_COUNT;
}

