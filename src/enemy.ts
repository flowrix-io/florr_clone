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
 * One mob AS IT ARRIVES OFF THE WIRE.
 *
 * This is now a transient record, not a store: the client holds mobs as ECS
 * entities (src/client_world.ts) and nothing keeps an `Enemy` object alive past
 * the handler that decoded it. The client-side render fields this used to carry
 * — the interpolation targets, the snapshot buffer, the eased eye and the
 * death-animation stamp — are components, and are gone from here so no renderer
 * can read a stale copy of one.
 */
export interface Enemy {
  id: string;
  // NOTE: this union lists only a fraction of the types in mob_configs.ts — the
  // authoritative set is that file's keys, and values outside this union do
  // occur at runtime. Members are added here as code needs to compare against
  // them ('glitch' infects players on contact, see playerState.ts).
  type: 'bee' | 'ladybug' | 'soldier_ant' | 'hornet' | 'mantis' | 'leafbug' | 'bush' | 'target_dummy' | 'item_spawner' | 'garbage' | 'centipede' | 'centipede_body' | 'desert_centipede' | 'desert_centipede_body' | 'ant_hole' | 'fire_ant_hole' | 'digger' | 'glitch' | 'glitch_flower';
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
  wanderTargetX?: number;
  wanderTargetY?: number;
  lastWanderTime?: number;
  aiType?: 'passive' | 'neutral' | 'hostile' | 'sandstorm';
  isChasing?: boolean;  // Whether the enemy is currently chasing a player
  poisonEffects?: PoisonEffect[];  // Active poison effects on this enemy
  range?: number;
  lastProjectileTime?: number;  // Last time this enemy shot a projectile
  lastMeleeAttackTime?: number;  // Last time this enemy performed a melee attack
  reversed?: boolean;  // Whether the mob image should be flipped horizontally
  ownerId?: string;  // ID of the player who owns this pet (if this is a pet)
  // Client-side "this is somebody's pet" flag. `ownerId` only rides along on the
  // full `enemySpawned` payload; the per-tick delta stream carries just the `o`
  // marker (see tickBroadcast.encodeEnemyDelta), so anything the renderer needs
  // to gate on pet-ness reads this instead.
  isPet?: boolean;
  petImage?: string;  // Optional image to use when this mob is spawned as a pet (32x32 SVG image)
  // DPS tracking for target dummies
  currentDPS?: number;  // Current calculated DPS
  // Centipede chain tracking
  leaderId?: string;
  headId?: string;
  segmentIndex?: number;
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