"use strict";
/**
 * Spatial components — shared by every entity that exists somewhere in the world.
 *
 * These are the hottest columns in the process: the collision grid, the AI
 * targeting pass, the viewport test and the broadcast encoder all stream them
 * every tick. Everything here is therefore numeric, and split so a system pulls
 * only the arrays it actually reads — the grid rebuild wants Position and
 * Radius but not Angle, the broadcast wants Position and Angle but not Velocity.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Speed = exports.Radius = exports.Knockback = exports.Angle = exports.Velocity = exports.Position = void 0;
const component_1 = require("../component");
/**
 * World position in pixels.
 *
 * f64, NOT f32. The maze is anchored at (200000, 200000) and the PVP arena is
 * similarly far off-origin; f32's step size at 200k is ~0.015px, so per-tick
 * sub-pixel movement out there quantises away and entities visibly stick. See
 * the assertion in ecs_self_test.ts.
 */
exports.Position = (0, component_1.defineComponent)('Position', {
    x: 'f64',
    y: 'f64',
});
/**
 * Integrated velocity, in pixels per second.
 *
 * Corresponds to `velX`/`velY` on Enemy (the passive-AI friction integrator)
 * and `velocityX`/`velocityY` on ServerPlayer. f32 is fine here: velocities are
 * small numbers near zero where f32 has plenty of precision — it is only the
 * large absolute coordinates that need f64.
 */
exports.Velocity = (0, component_1.defineComponent)('Velocity', {
    x: 'f32',
    y: 'f32',
});
/** Facing angle in radians. Separate from Position because many systems that move things never touch facing, and vice versa. */
exports.Angle = (0, component_1.defineComponent)('Angle', {
    value: 'f32',
});
/**
 * Knockback impulse applied this tick, decayed by the movement system.
 *
 * Its own component rather than fields on Velocity because most entities are
 * not being knocked back at any given moment, and keeping it separate means the
 * common case iterates a narrower archetype.
 */
exports.Knockback = (0, component_1.defineComponent)('Knockback', {
    x: 'f32',
    y: 'f32',
});
/**
 * Collision radius in pixels.
 *
 * Replaces `Enemy._radius`, which was a cache the grid rebuild recomputed and
 * stamped onto the mob each tick. As a real component it is written once at
 * spawn (and on size-changing effects) and simply read thereafter.
 */
exports.Radius = (0, component_1.defineComponent)('Radius', {
    value: 'f32',
});
/**
 * Movement speed. `base` is the unslowed value, `current` is what movement
 * actually reads.
 *
 * This mirrors the existing `speed`/`baseSpeed` pair exactly, and for the same
 * reason: a slow is applied by scaling `current` down and restoring it from
 * `base` when the slow lapses, so the ~15 movement branches never learn about
 * slows. `slowUntil` lives on the Slowed component so that only actually-slowed
 * entities carry it.
 */
exports.Speed = (0, component_1.defineComponent)('Speed', {
    current: 'f32',
    base: 'f32',
});
