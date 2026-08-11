/**
 * The game's component catalog.
 *
 * Every component the game uses is declared in this directory and re-exported
 * here. Declaration must happen at module scope and the whole catalog must be
 * loaded before any archetype is built — component ids are assigned in
 * declaration order and size the archetype bitmasks — so importing this barrel
 * (rather than individual files) is what guarantees a consistent id space.
 *
 * Grouping:
 *   spatial       position, velocity, facing, radius, speed
 *   combat        health, damage, poison, slow, death
 *   lifetime      expiry, spawn time, viewport despawn
 *   mob           the old Enemy interface, decomposed
 *   projectile    mob + player projectiles, unified
 *   player        the old ServerPlayer interface, decomposed
 *   world_objects drops, ground effects, scenery, walls
 */

export * from './spatial';
export * from './combat';
export * from './lifetime';
export * from './mob';
export * from './projectile';
export * from './player';
export * from './world_objects';
