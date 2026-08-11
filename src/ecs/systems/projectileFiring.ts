/**
 * Mob projectile firing — the port of `fireProjectileVolley`.
 *
 * Not a system: it is a function the AI calls at the moment it decides to
 * shoot, because the aim angle is the CALLER's decision and the two call sites
 * differ deliberately. A chasing wild mob aims along its pre-move offset to the
 * target, while a pet aims from where it ended up this tick. Both are
 * long-standing behaviour, so the angle stays a parameter rather than being
 * re-derived here.
 *
 * The stat lookups are injected. Resolving a projectile config means reaching
 * into mob_configs and petals, and the ECS layer deliberately depends on
 * neither — that separation is what keeps the ECS testable in a second without
 * booting the game.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { spawnProjectile } from '../prefabs';
import { World } from '../world';

/** The `projectile` block from a mob's config. */
export interface ProjectileConfig {
    /** Petal type the projectile renders and damages as. */
    petalType: string;
    /** Pixels per SECOND. Converted to per-millisecond at spawn. */
    speed?: number;
    /** Radians between shots in a multi-shot volley. */
    spreadAngle?: number;
    /** Number of projectiles per volley. */
    count?: number;
    /** Base travel distance before expiry, scaled by the shooter's rarity. */
    distance: number;
}

/** The petal stats a projectile inherits. */
export interface ProjectilePetalStats {
    damage: number;
    health: number;
    size: number;
}

export interface FiringDeps {
    /** The shooter's projectile config, or undefined if it has none. */
    projectileConfigOf(shooter: Entity): ProjectileConfig | undefined;
    /** Volley cooldown in ms. The original defaults to 2000 when unset. */
    cooldownOf(shooter: Entity): number;
    /** Petal stats for a (type, rarity) pair. */
    petalStatsOf(petalType: string, rarityIndex: number): ProjectilePetalStats | undefined;
    /** SIZE_SCALING for a rarity index; 1 when absent. */
    sizeScalingOf(rarityIndex: number): number;
    /** Interned name of the shooter's mob type, stamped onto the projectile. */
    mobTypeNameOf(shooter: Entity): string;
    /** Rarity name for an index, for the projectile's rarity field. */
    rarityNameOf(rarityIndex: number): string;
}

/** Default volley cooldown when a mob's config does not specify one. */
export const DEFAULT_VOLLEY_COOLDOWN_MS = 2000;

/** Default projectile speed in px/sec when a config omits it. */
const DEFAULT_PROJECTILE_SPEED = 200;

/** Default spread between shots in a multi-shot volley. */
const DEFAULT_SPREAD_ANGLE = 0.2;

/**
 * Build the `fireVolley` function the AI depends on.
 *
 * Returns a closure rather than a system because firing is event-driven — it
 * happens inside the AI's chase branch, not on a schedule.
 */
export function createFireVolley(world: World, deps: FiringDeps) {
    return (shooter: Entity, aimAngle: number, now: number): void => {
        if (!world.isAlive(shooter)) return;

        const config = deps.projectileConfigOf(shooter);
        if (!config) return;

        // Cooldown gate. AttackTimers is added lazily so mobs that never shoot
        // do not carry the column.
        if (!world.has(shooter, C.AttackTimers)) {
            world.add(shooter, C.AttackTimers, { lastProjectileTime: 0, lastMeleeAttackTime: 0 });
        }
        const lastShot = world.get(shooter, C.AttackTimers, 'lastProjectileTime') as number;
        const cooldown = deps.cooldownOf(shooter) || DEFAULT_VOLLEY_COOLDOWN_MS;
        if (now - lastShot < cooldown) return;

        // The projectile inherits the SHOOTER's rarity rather than a fixed one.
        const rarityIndex = world.get(shooter, C.MobKind, 'tier') as number;
        const petalStats = deps.petalStatsOf(config.petalType, rarityIndex);
        if (!petalStats) return;

        const x = world.get(shooter, C.Position, 'x') as number;
        const y = world.get(shooter, C.Position, 'y') as number;

        const speed = config.speed ?? DEFAULT_PROJECTILE_SPEED;
        const spreadAngle = config.spreadAngle ?? DEFAULT_SPREAD_ANGLE;
        const count = config.count ?? 1;

        // Distance and size scale with the shooter's rarity, on the two
        // different divisors the original uses.
        const scaling = deps.sizeScalingOf(rarityIndex);
        const distanceScale = scaling / 9;
        const sizeScale = scaling / 3;

        const sourceType = deps.mobTypeNameOf(shooter);
        const rarityName = deps.rarityNameOf(rarityIndex);

        for (let i = 0; i < count; i++) {
            let angle = aimAngle;
            if (count > 1) {
                // Centre the fan on the aim angle.
                angle = aimAngle + (i - (count - 1) / 2) * spreadAngle;
            }

            spawnProjectile(world, {
                x,
                y,
                angle,
                // Config speed is per second; projectile flight is per
                // millisecond, matching the existing convention.
                speed: speed / 1000,
                maxDistance: config.distance * distanceScale,
                damage: petalStats.damage,
                health: petalStats.health,
                size: petalStats.size * sizeScale,
                petalType: config.petalType,
                petalRarity: rarityName,
                shooter,
                sourceType,
                sourceTier: rarityName,
                fromPlayer: false,
                now,
            });
        }

        world.set(shooter, C.AttackTimers, 'lastProjectileTime', now);
    };
}
