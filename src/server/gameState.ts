import { WorldItem } from '../item';
import { Decoration, Sand } from '../server_utils';
import { MobProjectile, PlayerProjectile } from '../enemy';
import { ServerPlayer } from '../player';
import { Enemy, Obstacle } from '../server_utils';
import { 
    WORLD_MAP, 
    isWall, 
    SCALE_FACTOR, 
    enemies, 
    players, 
    obstacles,
    dots
} from '../constants';

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

export function getUltraMobCount() { return _ultraMobCount; }
export function setUltraMobCount(value: number) { _ultraMobCount = value; }
export function getSuperMobCount() { return _superMobCount; }
export function setSuperMobCount(value: number) { _superMobCount = value; }
export function getUniqueMobCount() { return _uniqueMobCount; }
export function setUniqueMobCount(value: number) { _uniqueMobCount = value; }

// Super boss per section tracking
export function getSuperMobPerSection(): (string | null)[] { return _superMobPerSection; }
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

export const playerUserIds: Record<string, string> = {}; // Maps player ID to user ID
export const mobProjectiles: MobProjectile[] = []; // Track all active mob projectiles
export const playerProjectiles: PlayerProjectile[] = []; // Track all active player projectiles
export const petalLastProjectileTime: Map<string, number> = new Map(); // Track last projectile time per petal instance

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
    unique: 300000      // 300 seconds (5 minutes)
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
            type: 'coral',
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

