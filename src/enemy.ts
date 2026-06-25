export interface Dot {
  x: number;
  y: number;
}

export interface PoisonEffect {
  damage: number;  // Damage per millisecond
  endTime: number;  // Timestamp when the poison effect ends
  playerId: string;  // ID of the player who applied the poison
}

export interface MobProjectile {
  id: number;
  enemyId: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  angle: number;
  speed: number;
  distance: number;
  maxDistance: number;
  petalType: string;
  petalRarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
  damage: number;
  size: number;
  health: number; // Health of the projectile (can be destroyed by player petals)
  maxHealth: number; // Maximum health of the projectile
  spawnTime: number; // ms timestamp (server clock) when the projectile was created
  lastSyncTime?: number; // ms timestamp of the most recent position re-sync broadcast (server-only)
}

export interface PlayerProjectile {
  id: number;
  playerId: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  angle: number;
  speed: number;
  distance: number;
  maxDistance: number;
  petalType: string;
  petalRarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
  damage: number;
  size: number;
  health: number; // Health of the projectile (can be destroyed by enemy petals)
  maxHealth: number; // Maximum health of the projectile
  spawnTime: number; // ms timestamp (server clock) when the projectile was created
  lastSyncTime?: number; // ms timestamp of the most recent position re-sync broadcast (server-only)
}

export interface Enemy {
  id: string;
  type: 'bee' | 'ladybug' | 'soldier_ant' | 'hornet' | 'mantis' | 'leafbug' | 'bush' | 'target_dummy' | 'item_spawner' | 'garbage' | 'centipede' | 'centipede_body' | 'desert_centipede' | 'desert_centipede_body' | 'ant_hole' | 'fire_ant_hole';
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
  petImage?: string;  // Optional image to use when this mob is spawned as a pet (32x32 SVG image)
  // DPS tracking for target dummies
  currentDPS?: number;  // Current calculated DPS
  // Death animation
  deathAnimationStartTime?: number;  // Timestamp when death animation started
  // Client-side interpolation targets
  targetX?: number;
  targetY?: number;
  targetAngle?: number;
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