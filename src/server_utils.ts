export interface Dot {
  x: number;
  y: number;
}

export interface PoisonEffect {
  damage: number;  // Damage per millisecond
  endTime: number;  // Timestamp when the poison effect ends
  playerId: string;  // ID of the player who applied the poison
}

/**
 * Mobs whose touch (body, petal ring or shot) leaves a player glitched — the
 * transient PlayerRenderFlags.Glitch bit, cleared only on respawn. Kept in one
 * place so a new glitch-family mob infects through every contact path at once
 * (body collision in playerState.ts, projectile impact in server.ts).
 */
export function isGlitchInfectingType(type: string): boolean {
  return type === 'glitch' || type === 'glitch_flower';
}

export function isCentipedeHeadType(type: string): boolean {
  return type === 'centipede' || type === 'desert_centipede' || type === 'evil_centipede';
}

export function isCentipedeBodyType(type: string): boolean {
  return type === 'centipede_body' || type === 'desert_centipede_body' || type === 'evil_centipede_body';
}

export function getCentipedeBodyType(headType: string): string {
  if (headType === 'desert_centipede') return 'desert_centipede_body';
  if (headType === 'evil_centipede') return 'evil_centipede_body';
  return 'centipede_body';
}

export interface Enemy {
  id: string;
  /**
   * The mob's entity.
   *
   * Not a duplicated field — it is the IDENTITY link, and it is what lets a
   * call site holding a shell read the mob's state out of the components (see
   * server/mobFields.ts) without paying an id→entity map lookup. As the shell's
   * own fields are deleted group by group, what is left of a shell converges on
   * exactly this — at which point the shell is the entity and can go.
   *
   * NULL_ENTITY between `makeEnemy` and admission; `spawnEnemy` is the only
   * caller of makeEnemy and sets it immediately.
   */
  entity: import('./ecs').Entity;
  // Partial union — see the note on the client-side Enemy in enemy.ts. The
  // authoritative type set is the mob_configs.ts keys.
  type: 'bee' | 'ladybug' | 'soldier_ant' | 'hornet' | 'mantis' | 'leafbug' | 'bush' | 'target_dummy' | 'item_spawner' | 'garbage' | 'centipede' | 'centipede_body' | 'desert_centipede' | 'desert_centipede_body' | 'ant_hole' | 'fire_ant_hole' | 'digger' | 'glitch' | 'glitch_flower';
  tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
  // gardn-style passive AI (see moveEnemies): state machine + friction velocity.
  parentHoleId?: string;       // hole this mob spawned from — tethers it to a territory (gardn parent)
  returningToHole?: boolean;   // gardn kReturning: heading home after straying past the retreat radius
  damageContributors?: Map<string, number>;  // Map of player ID to damage dealt
  poisonEffects?: PoisonEffect[];  // Active poison effects on this enemy
  ownerId?: string;  // ID of the player who owns this pet (if this is a pet)
  petImage?: string;  // Optional image to use when this mob is spawned as a pet (32x32 SVG image)
  // DPS tracking for target dummies — parallel arrays avoid per-event object allocations
  // Challenge mob tracking
  challengeOwnerId?: string;  // ID of the player who purchased this challenge
  challengeStarsReward?: number;  // Stars to award when this challenge mob is killed
  // Centipede chain tracking
  leaderId?: string;  // ID of the segment this one follows (undefined for the head)
  headId?: string;  // ID of the centipede head for the whole chain
  segmentIndex?: number;  // 0 = head, 1..N = body segments
  // Slow (web/honey/pincer). `speed` is the value every movement branch reads, so
  // a slow is applied by scaling it down and restoring `baseSpeed` when it lapses
  // (see updateSlowEffects) rather than by teaching ~15 call sites about slows.
  // Periodic summoner (queen ant) and the despawn timer on what it summons
  // Server-internal caches. Declared here rather than bolted on through `as any`
  // so they are part of the shape from birth (see makeEnemy).
}

/**
 * What `makeEnemy` needs.
 *
 * Much shorter than it was: position, health, speed, damage, facing and the
 * rest are components now, so they are not passed here at all — `spawnEnemy`
 * writes them straight to the entity. What is left is identity plus the
 * legacy-only bookkeeping the shell still carries.
 */
export type EnemyInit = Partial<Enemy> & Pick<Enemy, 'id' | 'type' | 'tier'>;

/**
 * The ONLY place a server-side enemy object may be created.
 *
 * Why this exists: V8 gives an object a hidden class determined by its exact set of
 * properties *and the order they were added*. Enemies used to be built from ten
 * different object literals with different key sets (pets added `ownerId`/`petImage`,
 * special mobs omitted `reversed`/`lastViewportCheck`, centipede segments added
 * `leaderId`/`headId`/`segmentIndex`), and `_radius`/`_mobStats`/`isDead` were bolted
 * on later still. Any property read that saw more than four of those shapes went
 * megamorphic, so `enemy.x` in the petal/collision hot loops became a hash lookup in
 * V8's global IC cache instead of an inlined offset load — profiling prod showed ~48%
 * of all server CPU sitting in Builtins_*LoadIC_Megamorphic.
 *
 * Emitting one literal with every key, always in this order, gives every enemy in the
 * process one identical hidden class, so those loads go monomorphic.
 *
 * Rules for anyone editing this file:
 *  - Add new fields to BOTH the interface and this literal, in the same position.
 *  - Never `delete` a property off an enemy (that demotes it to dictionary mode).
 *  - Optional fields default to `undefined`, never `0`/`false`/`null`: raw enemies are
 *    emitted to clients by `enemiesUpdate` and `enemySpawned`, and JSON.stringify drops
 *    undefined values, so the wire format is unchanged. A concrete default would add
 *    new keys to those payloads.
 */
export function makeEnemy(init: EnemyInit): Enemy {
  return {
    id: init.id,
    entity: 0 as import('./ecs').Entity,
    type: init.type,
    tier: init.tier,
    parentHoleId: init.parentHoleId,
    damageContributors: init.damageContributors,
    ownerId: init.ownerId,
    petImage: init.petImage,
    challengeOwnerId: init.challengeOwnerId,
    challengeStarsReward: init.challengeStarsReward,
    leaderId: init.leaderId,
    headId: init.headId,
    segmentIndex: init.segmentIndex,
  };
}

/**
 * An enemy that has been ADMITTED to the world — i.e. one that has an ECS
 * entity, which is now the only sense in which a mob exists at all.
 *
 * This brand is the structural half of the spawn cutover. The only way to
 * obtain a `LiveEnemy` is `spawnEnemy()` in server/enemyRegistry.ts, which
 * creates the entity and the shell together; `makeEnemy()` alone yields a plain
 * `Enemy`, which nothing that expects a live mob will accept. So a mob can
 * never exist as a shell with no entity (invisible to the simulation).
 *
 * The converse — an entity with no shell — used to be possible and is not any
 * more: `liveEnemies()` PROJECTS the shell list out of the world, so the shell
 * is reached through the entity rather than stored beside it. There is no
 * container to fall out of sync with.
 *
 * The brand is erased at runtime; it costs nothing and exists purely so the
 * compiler enumerates every spawn site.
 */
declare const ecsBound: unique symbol;
export type LiveEnemy = Enemy & { readonly [ecsBound]: true };

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'wall';
  isEnemy: boolean;
  health?: number;
}

export interface Item {
  id: string;
  type: 'health_potion' | 'speed_boost' | 'shield';
  x: number;
  y: number;
}

export function getXPFromEnemy(enemy: Enemy): number {
  // Import mob config to get actual XP values
  const { getMobStats } = require('./mobs');

  const mobStats = getMobStats(enemy.type, enemy.tier);
  if (mobStats && mobStats.xp) {
    return mobStats.xp;
  }

  // Fallback to tier-based XP if mob config lookup fails (e.g. unconfigured mob type)
  const tierXP = {
    common: 10,
    uncommon: 30,
    rare: 90,
    epic: 270,
    legendary: 810,
    mythic: 2430,
    ultra: 7290,
    super: 21870,
    unique: 65610,
    apex: 196830
  };
  return tierXP[enemy.tier] || 10;
}

// Note: addXPToPlayer moved to server.ts to properly handle socket events
