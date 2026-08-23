"use strict";
/**
 * Component accessors for mobs — the replacement for reading fields off the
 * legacy `Enemy` shell.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Every field on the `Enemy` interface already has a component home: Position,
 * Health, Speed, MobAI, Wander, PetOwner, CentipedeSegment and the rest cover
 * all 57 of them. The shell was therefore not a representation of anything — it
 * was a SECOND COPY of state the components already held, kept in step by two
 * bridge passes (`syncToEcs`/`syncFromEcs`) that had to decide, field by field,
 * which side was allowed to write. Health needed a MIN-merge because both sides
 * wrote it; a dropped write there meant "mobs unkillable by ranged attacks".
 *
 * These accessors let legacy code read and write the components directly, so
 * the copy can be deleted field group by field group. The compiler drives the
 * migration: delete a field from the `Enemy` interface and every site that used
 * it becomes a type error, which is the same trick the `LiveEnemy` brand uses to
 * enumerate spawn sites.
 *
 * ---------------------------------------------------------------------------
 * Cost
 * ---------------------------------------------------------------------------
 * `world.get` resolves liveness, archetype and row, then indexes a column —
 * about six operations against one for a plain field read. That is the right
 * trade everywhere EXCEPT loops that touch every mob every tick (the grid
 * rebuild, bot target scans). Those should iterate the mob QUERY and read the
 * columns directly, which is both faster than the accessors and faster than the
 * shell ever was. Use these for the single-mob cases; use a query for the sweeps.
 *
 * Accessors take an `Entity`, not a shell, because the shell is what is being
 * removed. During the migration `LiveEnemy.entity` is how a call site that
 * still holds a shell reaches its entity.
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
exports.mobWorld = mobWorld;
exports.mobX = mobX;
exports.mobY = mobY;
exports.setMobPosition = setMobPosition;
exports.mobAngle = mobAngle;
exports.setMobAngle = setMobAngle;
exports.mobVelX = mobVelX;
exports.mobVelY = mobVelY;
exports.setMobVelocity = setMobVelocity;
exports.mobRadiusOf = mobRadiusOf;
exports.setMobRadius = setMobRadius;
exports.mobHealth = mobHealth;
exports.mobMaxHealth = mobMaxHealth;
exports.damageMob = damageMob;
exports.setMobHealth = setMobHealth;
exports.mobDamage = mobDamage;
exports.isMobDead = isMobDead;
exports.markMobDead = markMobDead;
exports.mobSpeed = mobSpeed;
exports.mobBaseSpeed = mobBaseSpeed;
exports.mobKnockbackX = mobKnockbackX;
exports.mobKnockbackY = mobKnockbackY;
exports.setMobKnockback = setMobKnockback;
exports.mobType = mobType;
exports.mobTier = mobTier;
exports.mobId = mobId;
exports.mobTierId = mobTierId;
exports.mobIsChasing = mobIsChasing;
exports.mobTargetPlayerId = mobTargetPlayerId;
exports.setMobTargetPlayer = setMobTargetPlayer;
exports.provokeMob = provokeMob;
exports.mobTargetEnemyId = mobTargetEnemyId;
exports.mobOwnerId = mobOwnerId;
exports.mobIsPet = mobIsPet;
exports.mobHeadId = mobHeadId;
exports.mobSegmentIndex = mobSegmentIndex;
exports.mobSpawnTime = mobSpawnTime;
exports.mobStatsOf = mobStatsOf;
exports.mobRange = mobRange;
exports.mobAiType = mobAiType;
exports.mobReversed = mobReversed;
exports.mobDespawnAt = mobDespawnAt;
exports.mobCurrentDPS = mobCurrentDPS;
exports.setMobCurrentDPS = setMobCurrentDPS;
exports.mobDpsStartTime = mobDpsStartTime;
exports.mobLastViewportCheck = mobLastViewportCheck;
exports.mobTargetPetId = mobTargetPetId;
exports.mobDamageContributors = mobDamageContributors;
exports.mobParentHoleId = mobParentHoleId;
exports.mobQueryStamp = mobQueryStamp;
exports.setMobQueryStamp = setMobQueryStamp;
const C = __importStar(require("../ecs/components"));
const entityRegistry_1 = require("./entityRegistry");
const interning_1 = require("../ecs/interning");
/** The live world. Hoist this in any loop that touches more than one mob. */
function mobWorld() {
    return (0, entityRegistry_1.getEntityWorld)();
}
// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------
function mobX(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Position, 'x');
}
function mobY(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Position, 'y');
}
function setMobPosition(e, x, y, world = (0, entityRegistry_1.getEntityWorld)()) {
    world.write(e, C.Position, { x, y });
}
function mobAngle(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Angle, 'value');
}
function setMobAngle(e, value, world = (0, entityRegistry_1.getEntityWorld)()) {
    world.set(e, C.Angle, 'value', value);
}
function mobVelX(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Velocity, 'x');
}
function mobVelY(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Velocity, 'y');
}
function setMobVelocity(e, x, y, world = (0, entityRegistry_1.getEntityWorld)()) {
    world.write(e, C.Velocity, { x, y });
}
function mobRadiusOf(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Radius, 'value');
}
/** Clamp repair for a degenerate radius; see the grid rebuild. */
function setMobRadius(e, value, world = (0, entityRegistry_1.getEntityWorld)()) {
    world.set(e, C.Radius, 'value', value);
}
// ---------------------------------------------------------------------------
// Health and damage
// ---------------------------------------------------------------------------
function mobHealth(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Health, 'current');
}
function mobMaxHealth(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Health, 'max');
}
/**
 * Apply damage and report the remaining health.
 *
 * The single writer for mob health. It replaces the
 * `enemy.health = Math.max(0, enemy.health - dmg)` pattern that appeared at
 * eleven call sites and had to be reconciled with the ECS's own damage by a
 * MIN-merge in syncFromEcs — which is to say, the reason that merge existed.
 */
function damageMob(e, amount, world = (0, entityRegistry_1.getEntityWorld)()) {
    const next = Math.max(0, world.get(e, C.Health, 'current') - amount);
    world.set(e, C.Health, 'current', next);
    // Marking death here is what let syncToEcs go. That pass existed largely to
    // notice, once per tick, that legacy had zeroed a mob's health and to add
    // IsDead so the ECS stopped simulating it. With one writer the transition is
    // immediate instead of deferred to the next tick boundary.
    if (next <= 0 && !world.has(e, C.IsDead))
        world.add(e, C.IsDead);
    return next;
}
function setMobHealth(e, value, world = (0, entityRegistry_1.getEntityWorld)()) {
    world.set(e, C.Health, 'current', value);
    if (value <= 0 && !world.has(e, C.IsDead))
        world.add(e, C.IsDead);
}
function mobDamage(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Damage, 'value');
}
/** Marked dead this tick. The ECS stops simulating a dead mob immediately. */
function isMobDead(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.IsDead) || world.get(e, C.Health, 'current') <= 0;
}
function markMobDead(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.IsDead))
        world.add(e, C.IsDead);
}
// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------
function mobSpeed(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Speed, 'current');
}
function mobBaseSpeed(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Speed, 'base');
}
function mobKnockbackX(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Knockback, 'x');
}
function mobKnockbackY(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.get(e, C.Knockback, 'y');
}
/** Knockback is in every mob's archetype (see spawnMob), so this never adds. */
function setMobKnockback(e, x, y, world = (0, entityRegistry_1.getEntityWorld)()) {
    world.write(e, C.Knockback, { x, y });
}
// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
function mobType(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return interning_1.mobTypes.nameOf(world.get(e, C.MobKind, 'type'));
}
function mobTier(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return (0, interning_1.idToRarity)(world.get(e, C.MobKind, 'tier')) ?? 'common';
}
function mobId(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.externalIdOf(e) ?? '';
}
/** Interned tier id, for callers comparing against a rarity without a string. */
function mobTierId(tier) {
    return (0, interning_1.rarityToId)(tier);
}
// ---------------------------------------------------------------------------
// AI and targeting
// ---------------------------------------------------------------------------
function mobIsChasing(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.MobAI) && !!world.get(e, C.MobAI, 'isChasing');
}
/**
 * The player this mob is hunting, as a socket id.
 *
 * Stored as an ENTITY on MobAI; the id is resolved on demand. Legacy damage
 * handlers set this to provoke a neutral mob, which is why the setter exists.
 */
function mobTargetPlayerId(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.MobAI))
        return undefined;
    const target = world.get(e, C.MobAI, 'targetPlayer');
    if (!world.isAlive(target))
        return undefined;
    return world.externalIdOf(target);
}
function setMobTargetPlayer(e, target, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (world.has(e, C.MobAI))
        world.set(e, C.MobAI, 'targetPlayer', target);
}
/**
 * Make this mob hunt a player, by socket id.
 *
 * The provocation path: legacy damage handlers used to set `enemy.targetPlayerId`
 * and rely on syncToEcs noticing it next tick. This writes the component, so a
 * neutral mob turns hostile the instant it is hit rather than a tick later.
 * A player with no entity yet cannot be targeted — the same no-op the old
 * `world.lookup` miss produced.
 */
function provokeMob(e, playerId, world = (0, entityRegistry_1.getEntityWorld)()) {
    const target = world.lookup(playerId);
    if (target !== undefined)
        setMobTargetPlayer(e, target, world);
}
function mobTargetEnemyId(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.MobAI))
        return undefined;
    const target = world.get(e, C.MobAI, 'targetEnemy');
    if (!world.isAlive(target))
        return undefined;
    return world.externalIdOf(target);
}
// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------
/** The owning player's socket id for a pet, or undefined for a wild mob. */
function mobOwnerId(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.PetOwner))
        return undefined;
    const owner = world.get(e, C.PetOwner, 'owner');
    if (!world.isAlive(owner))
        return undefined;
    return world.externalIdOf(owner);
}
function mobIsPet(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.PetOwner);
}
function mobHeadId(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.CentipedeSegment))
        return undefined;
    const head = world.get(e, C.CentipedeSegment, 'head');
    if (!world.isAlive(head))
        return undefined;
    return world.externalIdOf(head);
}
function mobSegmentIndex(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.CentipedeSegment))
        return undefined;
    return world.get(e, C.CentipedeSegment, 'segmentIndex');
}
// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------
function mobSpawnTime(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.SpawnTime) ? world.get(e, C.SpawnTime, 'at') : 0;
}
function mobStatsOf(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.MobStats) ? world.get(e, C.MobStats, 'stats') : undefined;
}
// ---------------------------------------------------------------------------
// The remainder
// ---------------------------------------------------------------------------
/** Aggro/attack range in pixels. */
function mobRange(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.MobAI) ? world.get(e, C.MobAI, 'range') : undefined;
}
/** The mob's AI archetype, as the legacy string the config uses. */
function mobAiType(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.MobAI))
        return undefined;
    switch (world.get(e, C.MobAI, 'aiType')) {
        case 0 /* C.AiType.Passive */: return 'passive';
        case 2 /* C.AiType.Hostile */: return 'hostile';
        case 3 /* C.AiType.Sandstorm */: return 'sandstorm';
        default: return 'neutral';
    }
}
/** Horizontal image flip. Absent component means "not flipped". */
function mobReversed(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.RenderFlip) ? !!world.get(e, C.RenderFlip, 'flipped') : undefined;
}
/** Self-despawn deadline (periodic-spawn escorts), or undefined for none. */
function mobDespawnAt(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.Expires) ? world.get(e, C.Expires, 'at') : undefined;
}
function mobCurrentDPS(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.DpsTracker) ? world.get(e, C.DpsTracker, 'currentDPS') : undefined;
}
function setMobCurrentDPS(e, value, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (world.has(e, C.DpsTracker))
        world.set(e, C.DpsTracker, 'currentDPS', value);
}
function mobDpsStartTime(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.DpsTracker) ? world.get(e, C.DpsTracker, 'startTime') : undefined;
}
/** Last time this mob was near a player — feeds the unseen-despawn sweep. */
function mobLastViewportCheck(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.ViewportTracked)
        ? world.get(e, C.ViewportTracked, 'lastInViewport')
        : undefined;
}
/** Wild mobs: the pet they are currently fighting. */
function mobTargetPetId(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.MobAI))
        return undefined;
    const target = world.get(e, C.MobAI, 'targetPet');
    if (!world.isAlive(target))
        return undefined;
    return world.externalIdOf(target);
}
/** Per-player damage tally, for kill credit and drop eligibility. */
function mobDamageContributors(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.DamageContributors)
        ? world.get(e, C.DamageContributors, 'byPlayer')
        : undefined;
}
/** The mob this one spawned from (ant holes), as an id. */
function mobParentHoleId(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (!world.has(e, C.HoleTether))
        return undefined;
    const hole = world.get(e, C.HoleTether, 'hole');
    if (!world.isAlive(hole))
        return undefined;
    return world.externalIdOf(hole);
}
/**
 * Per-query dedup stamp — a mob occupies several grid cells, so a radius query
 * can reach it more than once. Was `Enemy._qs`; lives in C.GridStamps.
 */
function mobQueryStamp(e, world = (0, entityRegistry_1.getEntityWorld)()) {
    return world.has(e, C.GridStamps) ? world.get(e, C.GridStamps, 'queryStamp') : -1;
}
function setMobQueryStamp(e, stamp, world = (0, entityRegistry_1.getEntityWorld)()) {
    if (world.has(e, C.GridStamps))
        world.set(e, C.GridStamps, 'queryStamp', stamp);
}
