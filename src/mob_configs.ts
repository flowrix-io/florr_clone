// Mob configuration: the schema and the petal-ring constants. The mob table
// itself is data and lives in src/mobs.json — see BASE_MOB_CONFIGS below.
import mobsJson from './mobs.json';
import { resolveSpongeImage } from './sponge_svg';

/**
 * A mob that orbits a ring of petals the way a flower does (the glitch flower).
 *
 * The ring is NOT decoration: the client draws it (graphics/enemy-drawing.ts)
 * and the server damages players who stand in it (server/playerState.ts), both
 * off this one config plus the PETAL_RING_* constants below, so what is drawn
 * and what hurts stay the same ring.
 */
export interface PetalRingConfig {
    /** Petal art the ring is drawn from — must be a key of PETAL_STATS. */
    petalType: string;
    /** Petals in the ring, evenly spaced. */
    count: number;
}

/**
 * Ring geometry, expressed in multiples of the mob's own radius so it scales
 * with rarity exactly the way the body does. The reference is a player: a
 * radius-25 flower orbits its petals at 60 (2.4x) and draws each at 12 across
 * (0.48x), with a collision radius of 20 (0.8x — deliberately far more generous
 * than the art, see the petal loop in server/playerState.ts).
 */
export const PETAL_RING_ORBIT_SCALE = 2.4;
export const PETAL_RING_PETAL_SCALE = 0.55;
export const PETAL_RING_HIT_SCALE = 0.5;

/**
 * Ring spin rate in rad/ms, matching a speed-1.0 petal on a player
 * (drawPlayerPetals: stats.speed * 0.002). Client-side visual only — see
 * applyPetalRingDamage for why the damage test is deliberately angle-blind.
 */
export const PETAL_RING_ROTATION_SPEED = 0.002;

/**
 * Minimum gap between two ring hits on the same player. Roughly the interval at
 * which a 5-petal ring at PETAL_RING_ROTATION_SPEED sweeps past a fixed point
 * (2π / 0.002 / 5 ≈ 628ms), so standing in the ring costs about what being
 * swept by each petal in turn would.
 */
export const PETAL_RING_HIT_INTERVAL_MS = 600;

export interface BaseMobConfig {
    name: string;
    damage: number;
    health: number;
    size: number;
    speed: number;
    cooldown: number;
    description: string;
    color: string;
    image: string;
    ai_type: 'passive' | 'neutral' | 'hostile' | 'sandstorm';
    range: number;
    section?: number[]; // Optional: section numbers (0-8) where this mob spawns. Empty array (or omitted) means the mob does not spawn naturally.
    // Per-spawn random size range, in the same units as `size` (rarity scaling
    // applies on top). Each spawned mob rolls its own size in [min, max),
    // derived deterministically from its wire id so the client and server agree
    // on every mob's size without sending it (see getEnemySizeScale in mobs.ts).
    // Keep `size` at the midpoint of the range: `size` still feeds mass and the
    // nominal-size heuristics (spawn spacing, magnet radius, pollen radius).
    random_size?: [number, number];
    min_rarity?: string; // Optional: lowest rarity this mob spawns at. Lower rarities get an empty section list, so every spawner's section filter rejects them.
    poison?: number; // Optional: poison damage per millisecond inflicted on players on contact
    poisonDuration?: number; // Optional: milliseconds the inflicted poison lasts
    visual_scale?: number; // Optional: visual scale multiplier (affects rendering only, not hitbox)
    reversed?: boolean; // Optional: whether the mob image should be flipped horizontally
    hideRotation?: boolean; // Optional: whether to hide the mob's rotation visually
    noEggDrop?: boolean; // Optional: whether this mob should not drop eggs
    petImage?: string; // Optional image to use when this mob is spawned as a pet (32x32 SVG image)
    spawn_weight?: number; // Spawn weight (1 = normal, <1 = less common, >1 = more common). Default is 1
    emissive?: boolean; // Whether this mob emits light
    light_radius?: number; // Radius of the emissive light glow (in pixels, default: mob size * 2)
    light_color?: string; // Color of the emissive light (defaults to mob color)
    projectile?: {
        count: number;
        distance: number;
        petalType: string;
        petalRarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
        speed?: number;
        spreadAngle?: number;
    };
    spawn_waves?: string[][];
    initial_spawns?: string[];
    no_mob_collision?: boolean;
    // Mobs that carry an orbiting petal ring like a player's (glitch flower).
    petal_ring?: PetalRingConfig;
    // Mobs that summon escorts on a timer while alive (queen ant). Each summon is
    // removed again after `lifetimeMs`, and `maxAlive` caps the standing escort.
    periodic_spawn?: {
        mobType: string;
        intervalMs: number;
        lifetimeMs: number;
        maxAlive: number;
        // Rarity tiers below the summoner's own tier to spawn the escort at
        // (e.g. -1 = one rarity below). Clamped at 'common'. Default 0 (same tier).
        spawnRarityOffset?: number;
    };
}

/**
 * The mob table itself lives in src/mobs.json — one JSON object keyed by mob
 * type, each value a BaseMobConfig. It is data, not code: keeping it out of the
 * TypeScript source is what lets this file stay readable as the schema plus the
 * ring constants above.
 *
 * The one thing JSON cannot express is the shared sponge artwork, which the two
 * sponge mobs used to build with a spongeSvg() call. They carry a `$sponge:`
 * palette marker instead, expanded here on startup (see sponge_svg.ts).
 */
export const BASE_MOB_CONFIGS = mobsJson as unknown as { [mobType: string]: BaseMobConfig };

for (const config of Object.values(BASE_MOB_CONFIGS)) {
    config.image = resolveSpongeImage(config.image);
}
