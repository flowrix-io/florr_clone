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

import { Entity, World } from '../ecs';
import * as C from '../ecs/components';
import { getEntityWorld } from './entityRegistry';
import { mobTypes, rarityToId, idToRarity } from '../ecs/interning';

/** The live world. Hoist this in any loop that touches more than one mob. */
export function mobWorld(): World {
    return getEntityWorld();
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export function mobX(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Position, 'x') as number;
}

export function mobY(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Position, 'y') as number;
}

export function setMobPosition(e: Entity, x: number, y: number, world: World = getEntityWorld()): void {
    world.write(e, C.Position, { x, y });
}

export function mobAngle(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Angle, 'value') as number;
}

export function setMobAngle(e: Entity, value: number, world: World = getEntityWorld()): void {
    world.set(e, C.Angle, 'value', value);
}

export function mobVelX(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Velocity, 'x') as number;
}

export function mobVelY(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Velocity, 'y') as number;
}

export function setMobVelocity(e: Entity, x: number, y: number, world: World = getEntityWorld()): void {
    world.write(e, C.Velocity, { x, y });
}

export function mobRadiusOf(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Radius, 'value') as number;
}

/** Clamp repair for a degenerate radius; see the grid rebuild. */
export function setMobRadius(e: Entity, value: number, world: World = getEntityWorld()): void {
    world.set(e, C.Radius, 'value', value);
}

// ---------------------------------------------------------------------------
// Health and damage
// ---------------------------------------------------------------------------

export function mobHealth(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Health, 'current') as number;
}

export function mobMaxHealth(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Health, 'max') as number;
}

/**
 * Apply damage and report the remaining health.
 *
 * The single writer for mob health. It replaces the
 * `enemy.health = Math.max(0, enemy.health - dmg)` pattern that appeared at
 * eleven call sites and had to be reconciled with the ECS's own damage by a
 * MIN-merge in syncFromEcs — which is to say, the reason that merge existed.
 */
export function damageMob(e: Entity, amount: number, world: World = getEntityWorld()): number {
    const next = Math.max(0, (world.get(e, C.Health, 'current') as number) - amount);
    world.set(e, C.Health, 'current', next);
    // Marking death here is what let syncToEcs go. That pass existed largely to
    // notice, once per tick, that legacy had zeroed a mob's health and to add
    // IsDead so the ECS stopped simulating it. With one writer the transition is
    // immediate instead of deferred to the next tick boundary.
    if (next <= 0 && !world.has(e, C.IsDead)) world.add(e, C.IsDead);
    return next;
}

export function setMobHealth(e: Entity, value: number, world: World = getEntityWorld()): void {
    world.set(e, C.Health, 'current', value);
    if (value <= 0 && !world.has(e, C.IsDead)) world.add(e, C.IsDead);
}

export function mobDamage(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Damage, 'value') as number;
}

/** Marked dead this tick. The ECS stops simulating a dead mob immediately. */
export function isMobDead(e: Entity, world: World = getEntityWorld()): boolean {
    return world.has(e, C.IsDead) || (world.get(e, C.Health, 'current') as number) <= 0;
}

export function markMobDead(e: Entity, world: World = getEntityWorld()): void {
    if (!world.has(e, C.IsDead)) world.add(e, C.IsDead);
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export function mobSpeed(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Speed, 'current') as number;
}

export function mobBaseSpeed(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Speed, 'base') as number;
}

export function mobKnockbackX(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Knockback, 'x') as number;
}

export function mobKnockbackY(e: Entity, world: World = getEntityWorld()): number {
    return world.get(e, C.Knockback, 'y') as number;
}

/** Knockback is in every mob's archetype (see spawnMob), so this never adds. */
export function setMobKnockback(e: Entity, x: number, y: number, world: World = getEntityWorld()): void {
    world.write(e, C.Knockback, { x, y });
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function mobType(e: Entity, world: World = getEntityWorld()): string {
    return mobTypes.nameOf(world.get(e, C.MobKind, 'type') as number);
}

export function mobTier(e: Entity, world: World = getEntityWorld()): string {
    return idToRarity(world.get(e, C.MobKind, 'tier') as number) ?? 'common';
}

export function mobId(e: Entity, world: World = getEntityWorld()): string {
    return world.externalIdOf(e) ?? '';
}

/** Interned tier id, for callers comparing against a rarity without a string. */
export function mobTierId(tier: string): number {
    return rarityToId(tier);
}

// ---------------------------------------------------------------------------
// AI and targeting
// ---------------------------------------------------------------------------

export function mobIsChasing(e: Entity, world: World = getEntityWorld()): boolean {
    return world.has(e, C.MobAI) && !!world.get(e, C.MobAI, 'isChasing');
}

/**
 * The player this mob is hunting, as a socket id.
 *
 * Stored as an ENTITY on MobAI; the id is resolved on demand. Legacy damage
 * handlers set this to provoke a neutral mob, which is why the setter exists.
 */
export function mobTargetPlayerId(e: Entity, world: World = getEntityWorld()): string | undefined {
    if (!world.has(e, C.MobAI)) return undefined;
    const target = world.get(e, C.MobAI, 'targetPlayer') as Entity;
    if (!world.isAlive(target)) return undefined;
    return world.externalIdOf(target);
}

export function setMobTargetPlayer(e: Entity, target: Entity, world: World = getEntityWorld()): void {
    if (world.has(e, C.MobAI)) world.set(e, C.MobAI, 'targetPlayer', target);
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
export function provokeMob(e: Entity, playerId: string, world: World = getEntityWorld()): void {
    const target = world.lookup(playerId);
    if (target !== undefined) setMobTargetPlayer(e, target, world);
}

export function mobTargetEnemyId(e: Entity, world: World = getEntityWorld()): string | undefined {
    if (!world.has(e, C.MobAI)) return undefined;
    const target = world.get(e, C.MobAI, 'targetEnemy') as Entity;
    if (!world.isAlive(target)) return undefined;
    return world.externalIdOf(target);
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

/** The owning player's socket id for a pet, or undefined for a wild mob. */
export function mobOwnerId(e: Entity, world: World = getEntityWorld()): string | undefined {
    if (!world.has(e, C.PetOwner)) return undefined;
    const owner = world.get(e, C.PetOwner, 'owner') as Entity;
    if (!world.isAlive(owner)) return undefined;
    return world.externalIdOf(owner);
}

export function mobIsPet(e: Entity, world: World = getEntityWorld()): boolean {
    return world.has(e, C.PetOwner);
}

export function mobHeadId(e: Entity, world: World = getEntityWorld()): string | undefined {
    if (!world.has(e, C.CentipedeSegment)) return undefined;
    const head = world.get(e, C.CentipedeSegment, 'head') as Entity;
    if (!world.isAlive(head)) return undefined;
    return world.externalIdOf(head);
}

export function mobSegmentIndex(e: Entity, world: World = getEntityWorld()): number | undefined {
    if (!world.has(e, C.CentipedeSegment)) return undefined;
    return world.get(e, C.CentipedeSegment, 'segmentIndex') as number;
}

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------

export function mobSpawnTime(e: Entity, world: World = getEntityWorld()): number {
    return world.has(e, C.SpawnTime) ? (world.get(e, C.SpawnTime, 'at') as number) : 0;
}

export function mobStatsOf(e: Entity, world: World = getEntityWorld()): any {
    return world.has(e, C.MobStats) ? world.get(e, C.MobStats, 'stats') : undefined;
}

// ---------------------------------------------------------------------------
// The remainder
// ---------------------------------------------------------------------------

/** Aggro/attack range in pixels. */
export function mobRange(e: Entity, world: World = getEntityWorld()): number | undefined {
    return world.has(e, C.MobAI) ? (world.get(e, C.MobAI, 'range') as number) : undefined;
}

/** The mob's AI archetype, as the legacy string the config uses. */
export function mobAiType(e: Entity, world: World = getEntityWorld()): string | undefined {
    if (!world.has(e, C.MobAI)) return undefined;
    switch (world.get(e, C.MobAI, 'aiType') as number) {
        case C.AiType.Passive: return 'passive';
        case C.AiType.Hostile: return 'hostile';
        case C.AiType.Sandstorm: return 'sandstorm';
        default: return 'neutral';
    }
}

/** Horizontal image flip. Absent component means "not flipped". */
export function mobReversed(e: Entity, world: World = getEntityWorld()): boolean | undefined {
    return world.has(e, C.RenderFlip) ? !!world.get(e, C.RenderFlip, 'flipped') : undefined;
}

/** Self-despawn deadline (periodic-spawn escorts), or undefined for none. */
export function mobDespawnAt(e: Entity, world: World = getEntityWorld()): number | undefined {
    return world.has(e, C.Expires) ? (world.get(e, C.Expires, 'at') as number) : undefined;
}

export function mobCurrentDPS(e: Entity, world: World = getEntityWorld()): number | undefined {
    return world.has(e, C.DpsTracker) ? (world.get(e, C.DpsTracker, 'currentDPS') as number) : undefined;
}

export function setMobCurrentDPS(e: Entity, value: number, world: World = getEntityWorld()): void {
    if (world.has(e, C.DpsTracker)) world.set(e, C.DpsTracker, 'currentDPS', value);
}

export function mobDpsStartTime(e: Entity, world: World = getEntityWorld()): number | undefined {
    return world.has(e, C.DpsTracker) ? (world.get(e, C.DpsTracker, 'startTime') as number) : undefined;
}

/** Last time this mob was near a player — feeds the unseen-despawn sweep. */
export function mobLastViewportCheck(e: Entity, world: World = getEntityWorld()): number | undefined {
    return world.has(e, C.ViewportTracked)
        ? (world.get(e, C.ViewportTracked, 'lastInViewport') as number)
        : undefined;
}

/** Wild mobs: the pet they are currently fighting. */
export function mobTargetPetId(e: Entity, world: World = getEntityWorld()): string | undefined {
    if (!world.has(e, C.MobAI)) return undefined;
    const target = world.get(e, C.MobAI, 'targetPet') as Entity;
    if (!world.isAlive(target)) return undefined;
    return world.externalIdOf(target);
}

/** Per-player damage tally, for kill credit and drop eligibility. */
export function mobDamageContributors(
    e: Entity,
    world: World = getEntityWorld(),
): Map<string, number> | undefined {
    return world.has(e, C.DamageContributors)
        ? (world.get(e, C.DamageContributors, 'byPlayer') as Map<string, number>)
        : undefined;
}

/** The mob this one spawned from (ant holes), as an id. */
export function mobParentHoleId(e: Entity, world: World = getEntityWorld()): string | undefined {
    if (!world.has(e, C.HoleTether)) return undefined;
    const hole = world.get(e, C.HoleTether, 'hole') as Entity;
    if (!world.isAlive(hole)) return undefined;
    return world.externalIdOf(hole);
}

/**
 * Per-query dedup stamp — a mob occupies several grid cells, so a radius query
 * can reach it more than once. Was `Enemy._qs`; lives in C.GridStamps.
 */
export function mobQueryStamp(e: Entity, world: World = getEntityWorld()): number {
    return world.has(e, C.GridStamps) ? (world.get(e, C.GridStamps, 'queryStamp') as number) : -1;
}

export function setMobQueryStamp(e: Entity, stamp: number, world: World = getEntityWorld()): void {
    if (world.has(e, C.GridStamps)) world.set(e, C.GridStamps, 'queryStamp', stamp);
}
