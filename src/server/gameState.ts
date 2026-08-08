import { WorldItem } from '../item';
import { Decoration, Sand } from '../server_utils';
import { MobProjectile, PlayerProjectile } from '../enemy';
import { ServerPlayer } from '../player';
import { Enemy, Obstacle } from '../server_utils';
import {
    isWall,
    SCALE_FACTOR,
    enemies,
    players
} from '../constants';
import { WORLD_MAP } from '../map_data';

// Game state variables
export const items: WorldItem[] = [];

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

export const decorations: Decoration[] = [];
export const sands: Sand[] = [];
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

export const playerUserIds: Record<string, string> = {}; // Maps player ID to user ID
export const mobProjectiles: MobProjectile[] = []; // Track all active mob projectiles
export const playerProjectiles: PlayerProjectile[] = []; // Track all active player projectiles
export const petalLastProjectileTime: Map<string, number> = new Map(); // Track last projectile time per petal instance
export const petalLastRadiationTime: Map<string, number> = new Map(); // Track last radiation pulse per petal instance (uranium)

// Delta sync: for each player, the set of projectile IDs they currently "know about" (i.e. were
// told about via a spawn event and not yet told to remove). Used so we only re-broadcast a
// projectile's full state once on spawn / viewport-enter, instead of every tick.
export const knownMobProjectilesByPlayer: Map<string, Set<number>> = new Map();
export const knownPlayerProjectilesByPlayer: Map<string, Set<number>> = new Map();

// Monotonic counters for projectile IDs. Numeric IDs encode as 1-5 bytes in the binary codec
// versus ~52 bytes for a 50-char string ID — a huge win for high-volume petals (gas/rainbow).
let _nextMobProjectileId = 1;
let _nextPlayerProjectileId = 1;
export function allocateMobProjectileId(): number { return _nextMobProjectileId++; }
export function allocatePlayerProjectileId(): number { return _nextPlayerProjectileId++; }

// Pollen petals leave a damaging puff on the ground when they break.
export interface GroundPollen {
    id: string;
    playerId: string;
    x: number;
    y: number;
    damage: number;
    radius: number;       // pixel radius for collision + render
    rarity: string;
    expiresAt: number;
    lastDamageByEnemy: Map<string, number>;
}
export const groundPollens: GroundPollen[] = [];
export const GROUND_POLLEN_LIFETIME_MS = 5000;
export const GROUND_POLLEN_DAMAGE_INTERVAL_MS = 500;

// A thrown web petal leaves one of these behind: a stationary field that halves
// the speed of everything standing in it. Mirrors gardn's kWeb entity — spawned
// by alloc_web() when the petal despawns, 10s lifetime, and Collision.cc clamps
// the speed_ratio of anything overlapping it to 0.5.
export interface WebField {
    id: string;
    playerId: string;
    x: number;
    y: number;
    radius: number;
    rarity: string;
    expiresAt: number;
}
export const webFields: WebField[] = [];
export const WEB_LIFETIME_MS = 10000;       // gardn: entity_set_despawn_tick(web, 10 * TPS)
export const WEB_SLOW_FACTOR = 0.5;         // gardn: speed_ratio = min(speed_ratio, 0.5)
// gardn re-evaluates the overlap every tick and resets speed_ratio afterwards.
// Here the slow is a short timed one that the field keeps refreshing, so a mob
// walking out of a web is back to full speed within this long.
export const WEB_SLOW_LINGER_MS = 250;
// How far an attacking throw carries the web out from the petal's orbit. gardn
// accelerates the petal at 30x PLAYER_ACCELERATION for its 0.6s despawn window,
// which carries it several screens; that is unreadable at florr's zoom, so the
// throw is shortened to land just inside the viewport.
export const WEB_THROW_DISTANCE = 620;

// Track item expiration timeouts for cleanup
export const itemExpirationTimeouts: Map<string, NodeJS.Timeout> = new Map();

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

export function getItems(): WorldItem[] {
    return items;
}

export function getMobProjectiles(): MobProjectile[] {
    return mobProjectiles;
}

export function getPlayerProjectiles(): PlayerProjectile[] {
    return playerProjectiles;
}

export function setEnemyCount(count: number) {
    _ENEMY_COUNT = count;
}

export function getEnemyCount(): number {
    return _ENEMY_COUNT;
}

