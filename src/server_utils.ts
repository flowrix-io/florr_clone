import { WORLD_WIDTH, WORLD_HEIGHT, MIN_SAND_RADIUS, MAX_SAND_RADIUS } from "./constants";

const sands: Sand[] = [];

export interface Dot {
  x: number;
  y: number;
}

export interface PoisonEffect {
  damage: number;  // Damage per millisecond
  endTime: number;  // Timestamp when the poison effect ends
  playerId: string;  // ID of the player who applied the poison
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
  // Partial union — see the note on the client-side Enemy in enemy.ts. The
  // authoritative type set is the mob_configs.ts keys.
  type: 'bee' | 'ladybug' | 'soldier_ant' | 'hornet' | 'mantis' | 'leafbug' | 'bush' | 'target_dummy' | 'item_spawner' | 'garbage' | 'centipede' | 'centipede_body' | 'desert_centipede' | 'desert_centipede_body' | 'ant_hole' | 'fire_ant_hole' | 'digger' | 'glitch';
  tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
  x: number;
  y: number;
  angle: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  knockbackX?: number;
  knockbackY?: number;
  aiType?: 'passive' | 'neutral' | 'hostile' | 'sandstorm';
  isChasing?: boolean;  // Whether the enemy is currently chasing a player
  targetPlayerId?: string;  // ID of the player currently being targeted (persists until player is out of range)
  targetEnemyId?: string;   // pets: cached wild-mob target — revalidated each tick so steady-state targeting costs one LOS ray instead of a full rescan
  targetPetId?: string;     // wild mobs: cached pet target, same revalidate-then-rescan scheme
  range?: number;
  wanderTargetX?: number;
  wanderTargetY?: number;
  lastWanderTime?: number;
  // gardn-style passive AI (see moveEnemies): state machine + friction velocity.
  passiveState?: 'idle' | 'moving';
  passiveStateStart?: number;  // timestamp the current passive state began
  velX?: number;               // passive movement velocity (friction integrator)
  velY?: number;
  wobblePhase?: number;        // bee flight: per-mob phase offset for the sinusoidal heading wobble
  parentHoleId?: string;       // hole this mob spawned from — tethers it to a territory (gardn parent)
  returningToHole?: boolean;   // gardn kReturning: heading home after straying past the retreat radius
  spawnTime?: number;  // Timestamp when enemy was spawned
  lastViewportCheck?: number;  // Last time this enemy was in any player's viewport
  damageContributors?: Map<string, number>;  // Map of player ID to damage dealt
  poisonEffects?: PoisonEffect[];  // Active poison effects on this enemy
  lastProjectileTime?: number;  // Last time this enemy shot a projectile
  lastMeleeAttackTime?: number;  // Last time this enemy performed a melee attack
  reversed?: boolean;  // Whether the mob image should be flipped horizontally
  ownerId?: string;  // ID of the player who owns this pet (if this is a pet)
  petImage?: string;  // Optional image to use when this mob is spawned as a pet (32x32 SVG image)
  // DPS tracking for target dummies — parallel arrays avoid per-event object allocations
  dpsHistoryTimes?: number[];
  dpsHistoryDamages?: number[];
  dpsStartTime?: number;  // When DPS tracking started
  currentDPS?: number;  // Current calculated DPS
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
  baseSpeed?: number;   // unslowed speed, captured the first time a slow lands
  slowUntil?: number;   // timestamp the current slow expires
  // Periodic summoner (queen ant) and the despawn timer on what it summons
  lastPeriodicSpawnTime?: number;
  despawnAt?: number;   // timestamp this mob removes itself, 0/undefined = never
  // Server-internal caches. Declared here rather than bolted on through `as any`
  // so they are part of the shape from birth (see makeEnemy).
  isDead?: boolean;             // spliced from `enemies` at end of tick; still referenced by in-flight loops
  _radius?: number;             // collision radius, cached by rebuildEnemyGrid
  _mobStats?: any;              // getMobStats(type, tier), cached by rebuildEnemyGrid
  _ci?: number;                 // pair-dedup stamp for the enemy-enemy collision grid
  _qs?: number;                 // per-query dedup stamp for queryEnemiesNear (mobs span several cells)
  _spawnWavePrevHealth?: number; // ant-hole wave bookkeeping
}

/**
 * Every field of Enemy except the ten that have no sensible default.
 * `Partial<Enemy>` alone would let a caller omit `id`/`x`/`y`; the Pick re-requires them.
 */
export type EnemyInit = Partial<Enemy> &
  Pick<Enemy, 'id' | 'type' | 'tier' | 'x' | 'y' | 'angle' | 'health' | 'maxHealth' | 'speed' | 'damage'>;

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
    type: init.type,
    tier: init.tier,
    x: init.x,
    y: init.y,
    angle: init.angle,
    health: init.health,
    maxHealth: init.maxHealth,
    speed: init.speed,
    damage: init.damage,
    knockbackX: init.knockbackX,
    knockbackY: init.knockbackY,
    aiType: init.aiType,
    isChasing: init.isChasing,
    targetPlayerId: init.targetPlayerId,
    targetEnemyId: init.targetEnemyId,
    targetPetId: init.targetPetId,
    range: init.range,
    wanderTargetX: init.wanderTargetX,
    wanderTargetY: init.wanderTargetY,
    lastWanderTime: init.lastWanderTime,
    passiveState: init.passiveState,
    passiveStateStart: init.passiveStateStart,
    velX: init.velX,
    velY: init.velY,
    wobblePhase: init.wobblePhase,
    parentHoleId: init.parentHoleId,
    returningToHole: init.returningToHole,
    spawnTime: init.spawnTime,
    lastViewportCheck: init.lastViewportCheck,
    damageContributors: init.damageContributors,
    poisonEffects: init.poisonEffects,
    lastProjectileTime: init.lastProjectileTime,
    lastMeleeAttackTime: init.lastMeleeAttackTime,
    reversed: init.reversed,
    ownerId: init.ownerId,
    petImage: init.petImage,
    dpsHistoryTimes: init.dpsHistoryTimes,
    dpsHistoryDamages: init.dpsHistoryDamages,
    dpsStartTime: init.dpsStartTime,
    currentDPS: init.currentDPS,
    challengeOwnerId: init.challengeOwnerId,
    challengeStarsReward: init.challengeStarsReward,
    leaderId: init.leaderId,
    headId: init.headId,
    segmentIndex: init.segmentIndex,
    baseSpeed: init.baseSpeed,
    slowUntil: init.slowUntil,
    lastPeriodicSpawnTime: init.lastPeriodicSpawnTime,
    despawnAt: init.despawnAt,
    isDead: init.isDead,
    _radius: init._radius,
    _mobStats: init._mobStats,
    _ci: init._ci,
    _qs: init._qs,
    _spawnWavePrevHealth: init._spawnWavePrevHealth,
  };
}

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

export interface Sand {
  x: number;
  y: number;
  radius: number;  // Random size for each sand blob
  rotation: number;  // For slight variation in shape
}

export interface Decoration {
  x: number;
  y: number;
  scale: number;  // For random sizes
}

export function getRandomPositionInZone(zoneIndex: number) {
  const zoneWidth = WORLD_WIDTH / 6;  // 6 zones
  const startX = zoneIndex * zoneWidth;
  
  // For legendary and mythic zones, ensure they're in the rightmost areas
  if (zoneIndex >= 4) {  // Legendary and Mythic zones
      const adjustedStartX = WORLD_WIDTH - (6 - zoneIndex) * (zoneWidth / 2);  // Start from right side
      return {
          x: adjustedStartX + Math.random() * (WORLD_WIDTH - adjustedStartX),
          y: Math.random() * WORLD_HEIGHT
      };
  }
  
  return {
      x: startX + Math.random() * zoneWidth,
      y: Math.random() * WORLD_HEIGHT
  };
}


export function createDecoration() {
  const zoneIndex = Math.floor(Math.random() * 6);  // 6 zones
  const pos = getRandomPositionInZone(zoneIndex);
  return {
      x: pos.x,
      y: pos.y,
      scale: 0.5 + Math.random() * 1.5
  };
}

export function createSand(): Sand {
  // Create sand patches with more spacing
  const sectionWidth = WORLD_WIDTH  // Divide world into sections
  const sectionIndex = sands.length;
  
  return {
      x: (sectionIndex * sectionWidth) + Math.random() * sectionWidth,  // Spread out along x-axis
      y: Math.random() * WORLD_HEIGHT,
      radius: MIN_SAND_RADIUS + Math.random() * (MAX_SAND_RADIUS - MIN_SAND_RADIUS),
      rotation: Math.random() * Math.PI * 2
  };
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
