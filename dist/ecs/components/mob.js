"use strict";
/**
 * Mob components — the decomposition of the old `Enemy` interface.
 *
 * `Enemy` was a single 45-field object built through `makeEnemy()`, whose
 * every field had to be emitted in a fixed order to keep V8 from going
 * megamorphic on `enemy.x` (profiling once showed ~48% of server CPU in
 * megamorphic load ICs). That constraint disappears here: fields live in typed
 * array columns, so there is no hidden class to keep monomorphic and no reason
 * for a centipede segment to carry a pet's fields.
 *
 * The split below groups fields by WHICH SYSTEM READS THEM, so each per-tick
 * pass touches the fewest columns possible.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsObstacle = exports.IsEnemy = exports.IsIdle = exports.GridStamps = exports.MobStats = exports.RenderFlip = exports.ChallengeMob = exports.DpsTracker = exports.CentipedeSegment = exports.PetOwner = exports.SpawnWaveState = exports.PeriodicSpawner = exports.HoleTether = exports.Wobble = exports.PassiveMotion = exports.Wander = exports.MobAI = exports.MobKind = void 0;
const component_1 = require("../component");
/**
 * What kind of mob this is.
 *
 * `type` is an id from the `mobTypes` interner and `tier` is the canonical
 * rarity index. Both are process-local integers on purpose — the wire encoder
 * converts back to strings, since interned ids are not stable across processes.
 */
exports.MobKind = (0, component_1.defineComponent)('MobKind', {
    type: 'u16',
    tier: 'u8',
});
/**
 * Targeting and aggression state.
 *
 * The three target fields are entity handles replacing `targetPlayerId`,
 * `targetEnemyId` and `targetPetId`. As handles, the "is my cached target still
 * valid?" check that runs every tick becomes a generation test instead of a map
 * lookup — and critically it cannot alias: a recycled mob id used to be able to
 * resolve to a *different* mob, silently retargeting the attacker.
 */
exports.MobAI = (0, component_1.defineComponent)('MobAI', {
    aiType: 'u8',
    isChasing: 'bool',
    /** Cached player target; NULL_ENTITY when none. */
    targetPlayer: 'entity',
    /** Pets: cached wild-mob target. */
    targetEnemy: 'entity',
    /** Wild mobs: cached pet target. */
    targetPet: 'entity',
    /** Aggro/attack range in pixels. */
    range: 'f32',
});
/** Wander destination for idle mobs. */
exports.Wander = (0, component_1.defineComponent)('Wander', {
    targetX: 'f64',
    targetY: 'f64',
    lastTime: 'f64',
});
/** The passive idle/moving state machine. Velocity itself lives on Velocity. */
exports.PassiveMotion = (0, component_1.defineComponent)('PassiveMotion', {
    state: 'u8',
    stateStart: 'f64',
});
/** Bee flight: per-mob phase offset for the sinusoidal heading wobble. */
exports.Wobble = (0, component_1.defineComponent)('Wobble', {
    phase: 'f32',
});
/**
 * Tether to the hole this mob spawned from (gardn `parent`), and whether it is
 * currently heading home after straying past the retreat radius.
 */
exports.HoleTether = (0, component_1.defineComponent)('HoleTether', {
    hole: 'entity',
    returning: 'bool',
});
/** A summoner that spawns on a timer (queen ant). */
exports.PeriodicSpawner = (0, component_1.defineComponent)('PeriodicSpawner', {
    lastSpawnTime: 'f64',
});
/** Ant-hole wave bookkeeping (`Enemy._spawnWavePrevHealth`). */
exports.SpawnWaveState = (0, component_1.defineComponent)('SpawnWaveState', {
    previousHealth: 'f32',
});
/**
 * Pet ownership. Presence of this component is what "is a pet" means, replacing
 * both `ownerId` and the separate `isPet` client flag.
 */
exports.PetOwner = (0, component_1.defineComponent)('PetOwner', {
    owner: 'entity',
    /** Optional 32x32 SVG override used when this mob renders as a pet. */
    image: 'str',
});
/**
 * Centipede chain links.
 *
 * `segmentIndex` 0 is the head. `leader` is the segment this one follows and
 * `head` is the chain's head, both as handles so a broken chain is detectable
 * without id lookups.
 */
exports.CentipedeSegment = (0, component_1.defineComponent)('CentipedeSegment', {
    leader: 'entity',
    head: 'entity',
    segmentIndex: 'u16',
});
/**
 * DPS measurement for target dummies. The history stays in parallel plain
 * arrays (as it already did, to avoid per-event object allocation) behind `obj`
 * columns — only a handful of dummies exist, and nothing hot reads this.
 */
exports.DpsTracker = (0, component_1.defineComponent)('DpsTracker', {
    /** number[] of sample timestamps. */
    historyTimes: 'obj',
    /** number[] of sample damages. */
    historyDamages: 'obj',
    startTime: 'f64',
    currentDPS: 'f32',
});
/** A mob spawned by a purchased challenge, and the stars it pays out. */
exports.ChallengeMob = (0, component_1.defineComponent)('ChallengeMob', {
    owner: 'entity',
    starsReward: 'f32',
});
/** Horizontal image flip for rendering (`Enemy.reversed`). */
exports.RenderFlip = (0, component_1.defineComponent)('RenderFlip', {
    flipped: 'bool',
});
/**
 * Cached `getMobStats(type, tier)` result.
 *
 * Previously `Enemy._mobStats`, recomputed and stamped on by the grid rebuild
 * each tick. It is a shared immutable config object, so an `obj` column holding
 * one pointer per mob is the cheap representation; resolving it at spawn rather
 * than per tick removes the rebuild's per-mob work entirely.
 */
exports.MobStats = (0, component_1.defineComponent)('MobStats', {
    stats: 'obj',
});
/**
 * Dedup stamps used by the collision grid (`_ci`) and the near-query (`_qs`).
 *
 * These exist because a mob spans several grid cells and would otherwise be
 * visited once per cell. Kept as a component so the grid can keep stamping
 * entities directly; both are plain counters compared against a per-query
 * epoch, never persisted.
 */
exports.GridStamps = (0, component_1.defineComponent)('GridStamps', {
    collisionStamp: 'u32',
    queryStamp: 'u32',
});
/**
 * The mob is idling this tick — not chasing, not walking home, not a sandstorm.
 *
 * This tag exists because the passive-drift machine (systems/enemyPassive.ts)
 * is a SEPARATE system from the AI, while in the original it was a call made
 * from inside `stepIdle`. Without an explicit idle state the passive systems
 * would drift mobs that are supposed to be chasing, fighting the AI's own
 * movement in the same tick.
 *
 * The AI system maintains it, so the archetype change happens only on an actual
 * state transition (chase start/stop) rather than every tick.
 */
exports.IsIdle = (0, component_1.defineTag)('IsIdle');
/** Tags identifying what an entity fundamentally is. */
exports.IsEnemy = (0, component_1.defineTag)('IsEnemy');
exports.IsObstacle = (0, component_1.defineTag)('IsObstacle');
