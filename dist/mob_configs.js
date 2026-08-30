"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASE_MOB_CONFIGS = exports.PETAL_RING_HIT_INTERVAL_MS = exports.PETAL_RING_ROTATION_SPEED = exports.PETAL_RING_HIT_SCALE = exports.PETAL_RING_PETAL_SCALE = exports.PETAL_RING_ORBIT_SCALE = void 0;
// Mob configuration: the schema and the petal-ring constants. The mob table
// itself is data and lives in src/mobs.json — see BASE_MOB_CONFIGS below.
const mobs_json_1 = __importDefault(require("./mobs.json"));
const sponge_svg_1 = require("./sponge_svg");
/**
 * Ring geometry, expressed in multiples of the mob's own radius so it scales
 * with rarity exactly the way the body does. The reference is a player: a
 * radius-25 flower orbits its petals at 60 (2.4x) and draws each at 12 across
 * (0.48x), with a collision radius of 20 (0.8x — deliberately far more generous
 * than the art, see the petal loop in server/playerState.ts).
 */
exports.PETAL_RING_ORBIT_SCALE = 2.4;
exports.PETAL_RING_PETAL_SCALE = 0.55;
exports.PETAL_RING_HIT_SCALE = 0.5;
/**
 * Ring spin rate in rad/ms, matching a speed-1.0 petal on a player
 * (drawPlayerPetals: stats.speed * 0.002). Client-side visual only — see
 * applyPetalRingDamage for why the damage test is deliberately angle-blind.
 */
exports.PETAL_RING_ROTATION_SPEED = 0.002;
/**
 * Minimum gap between two ring hits on the same player. Roughly the interval at
 * which a 5-petal ring at PETAL_RING_ROTATION_SPEED sweeps past a fixed point
 * (2π / 0.002 / 5 ≈ 628ms), so standing in the ring costs about what being
 * swept by each petal in turn would.
 */
exports.PETAL_RING_HIT_INTERVAL_MS = 600;
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
exports.BASE_MOB_CONFIGS = mobs_json_1.default;
for (const config of Object.values(exports.BASE_MOB_CONFIGS)) {
    config.image = (0, sponge_svg_1.resolveSpongeImage)(config.image);
}
