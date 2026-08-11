"use strict";
/**
 * Combat components — health, damage, and the timed afflictions.
 *
 * The organising rule here: an affliction that only SOME entities have at any
 * moment gets its own component, so the archetype tells you who is afflicted
 * and the per-tick sweep iterates only them. Under the old shape every poison
 * or slow check scanned all ~1400 mobs and tested a mostly-undefined field.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsDead = exports.Invulnerable = exports.SpongeDamage = exports.DamageContributors = exports.AttackTimers = exports.Slowed = exports.Poisoned = exports.PoisonStack = exports.DamageTaken = exports.Damage = exports.Health = void 0;
const component_1 = require("../component");
/** Current and maximum hit points. */
exports.Health = (0, component_1.defineComponent)('Health', {
    current: 'f32',
    max: 'f32',
});
/** Contact/attack damage this entity deals. */
exports.Damage = (0, component_1.defineComponent)('Damage', {
    value: 'f32',
});
/**
 * Timestamp of the last damage taken, for regeneration delays and the
 * "recently hit" face flag.
 */
exports.DamageTaken = (0, component_1.defineComponent)('DamageTaken', {
    lastTime: 'f64',
});
/**
 * A single poison stack.
 *
 * Poison is modelled as its OWN ENTITY pointing at its victim, rather than an
 * array field on the victim. Mobs can carry several stacks from different
 * players at once (the old `Enemy.poisonEffects: PoisonEffect[]`), and an array
 * column would mean a per-mob heap allocation plus a nested loop over a mostly
 * empty array for every mob every tick. As entities, the poison sweep iterates
 * exactly the poison stacks that exist.
 *
 * `target` and `source` are entity handles, so a stack whose victim or applier
 * has died is detected by a generation check rather than by an id lookup that
 * might hit a recycled mob.
 */
exports.PoisonStack = (0, component_1.defineComponent)('PoisonStack', {
    /** The entity taking the damage. */
    target: 'entity',
    /** The player credited with the damage (for kill attribution). */
    source: 'entity',
    /** Damage per millisecond, matching PoisonEffect.damage. */
    damagePerMs: 'f32',
    /** Absolute timestamp the stack lapses. */
    endTime: 'f64',
});
/**
 * Player-side poison, which differs from mob poison: exactly ONE stack at a
 * time, refreshed rather than accumulated (a fresh bite replaces the old one).
 * Kept as a component on the player instead of a PoisonStack entity precisely
 * because that single-stack rule is what the game wants.
 */
exports.Poisoned = (0, component_1.defineComponent)('Poisoned', {
    /** Damage per second currently ticking (ServerPlayer.poisonDamage). */
    damagePerSecond: 'f32',
    /** Timestamp the poison lapses (ServerPlayer.poisonUntil). */
    until: 'f64',
    /** Interned mob type credited in `killedBy` if this finishes the player. */
    sourceType: 'u16',
    /** Rarity index of that source. */
    sourceTier: 'u8',
});
/**
 * An active slow (web field, honey, pincer).
 *
 * Presence of this component IS the "currently slowed" state; the sweep that
 * restores Speed.current from Speed.base removes it when `until` passes.
 */
exports.Slowed = (0, component_1.defineComponent)('Slowed', {
    until: 'f64',
});
/** Cooldown timestamps for the two attack kinds a mob can have. */
exports.AttackTimers = (0, component_1.defineComponent)('AttackTimers', {
    lastProjectileTime: 'f64',
    lastMeleeAttackTime: 'f64',
});
/**
 * Who has damaged this entity and by how much, for XP and drop attribution.
 *
 * A `obj` column holding the existing `Map<string, number>`. This is genuinely
 * cold — written on hit, read once on death — so it stays a reference field
 * rather than being exploded into entities. It is its own component so the hot
 * mob archetypes that never take player damage do not carry the column at all.
 */
exports.DamageContributors = (0, component_1.defineComponent)('DamageContributors', {
    /** Map<playerId, damage>. */
    byPlayer: 'obj',
});
/**
 * Sponge damage-over-time effects on a player (ServerPlayer.spongeDamageEffects).
 * Array-valued and rare, so it stays a reference field on its own component.
 */
exports.SpongeDamage = (0, component_1.defineComponent)('SpongeDamage', {
    /** Array<{remainingDamage, damagePerSecond, sourcePlayerId?, killedBy?}>. */
    effects: 'obj',
});
/** Temporary invulnerability (spawn protection, second chance). */
exports.Invulnerable = (0, component_1.defineComponent)('Invulnerable', {
    /** Timestamp invulnerability ends; 0 means "until explicitly removed". */
    until: 'f64',
});
/**
 * Marks an entity as killed this tick.
 *
 * The old code set `Enemy.isDead` and spliced the mob out of the array at end
 * of tick, because in-flight loops still held references to it. The tag plays
 * the same role — systems skip tagged entities — and the reaper destroys them
 * in the Lifetime phase, after combat has finished reading them.
 */
exports.IsDead = (0, component_1.defineTag)('IsDead');
