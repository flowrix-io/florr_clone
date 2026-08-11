"use strict";
/**
 * Projectile components.
 *
 * `MobProjectile` and `PlayerProjectile` were two near-identical interfaces
 * differing only in whether the origin field was `enemyId` or `playerId`, each
 * with its own array, its own update loop and its own delta-sync bookkeeping.
 * Here they are one archetype distinguished by the `FromPlayer` tag, so the
 * flight integration and expiry sweep are written once.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsProjectile = exports.FromPlayer = exports.ProjectileSync = exports.ProjectileOrigin = exports.Projectile = void 0;
const component_1 = require("../component");
/**
 * Flight state.
 *
 * `startX`/`startY` and `maxDistance` are kept rather than derived because the
 * existing expiry rule is distance-travelled-from-origin, not a lifetime, and
 * several petals re-sync position mid-flight.
 */
exports.Projectile = (0, component_1.defineComponent)('Projectile', {
    startX: 'f64',
    startY: 'f64',
    /** Distance covered so far, compared against maxDistance. */
    distance: 'f32',
    maxDistance: 'f32',
    /** Interned petal type that fired this. */
    petalType: 'u16',
    /** Rarity index of that petal. */
    petalRarity: 'u8',
    size: 'f32',
});
/**
 * Who fired it, and what it was fired from.
 *
 * `sourceType` is stamped at spawn rather than resolved from the shooter on
 * impact, because the shooter can already be dead and despawned by the time the
 * projectile lands — the same reason the old MobProjectile carried it.
 */
exports.ProjectileOrigin = (0, component_1.defineComponent)('ProjectileOrigin', {
    /** The player or mob that fired this. May already be dead. */
    shooter: 'entity',
    /** Interned mob type of the shooter, for kill attribution. */
    sourceType: 'u16',
    /** Rarity index of the shooter. */
    sourceTier: 'u8',
});
/**
 * Timestamp of the last position re-sync broadcast.
 *
 * Server-only, and separate from Projectile so the flight integration never
 * pulls the networking column through cache.
 */
exports.ProjectileSync = (0, component_1.defineComponent)('ProjectileSync', {
    spawnTime: 'f64',
    lastSyncTime: 'f64',
});
/**
 * Fired by a player rather than a mob. Splits the two damage rules (player
 * projectiles hurt mobs, mob projectiles hurt players) without a per-projectile
 * branch on an id lookup.
 */
exports.FromPlayer = (0, component_1.defineTag)('FromPlayer');
/** Marks the entity as a projectile, for queries that want all of them. */
exports.IsProjectile = (0, component_1.defineTag)('IsProjectile');
