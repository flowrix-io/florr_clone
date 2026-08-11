"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_VOLLEY_COOLDOWN_MS = void 0;
exports.createFireVolley = createFireVolley;
const C = __importStar(require("../components"));
const prefabs_1 = require("../prefabs");
/** Default volley cooldown when a mob's config does not specify one. */
exports.DEFAULT_VOLLEY_COOLDOWN_MS = 2000;
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
function createFireVolley(world, deps) {
    return (shooter, aimAngle, now) => {
        if (!world.isAlive(shooter))
            return;
        const config = deps.projectileConfigOf(shooter);
        if (!config)
            return;
        // Cooldown gate. AttackTimers is added lazily so mobs that never shoot
        // do not carry the column.
        if (!world.has(shooter, C.AttackTimers)) {
            world.add(shooter, C.AttackTimers, { lastProjectileTime: 0, lastMeleeAttackTime: 0 });
        }
        const lastShot = world.get(shooter, C.AttackTimers, 'lastProjectileTime');
        const cooldown = deps.cooldownOf(shooter) || exports.DEFAULT_VOLLEY_COOLDOWN_MS;
        if (now - lastShot < cooldown)
            return;
        // The projectile inherits the SHOOTER's rarity rather than a fixed one.
        const rarityIndex = world.get(shooter, C.MobKind, 'tier');
        const petalStats = deps.petalStatsOf(config.petalType, rarityIndex);
        if (!petalStats)
            return;
        const x = world.get(shooter, C.Position, 'x');
        const y = world.get(shooter, C.Position, 'y');
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
            (0, prefabs_1.spawnProjectile)(world, {
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
