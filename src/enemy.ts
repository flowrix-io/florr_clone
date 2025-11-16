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
  id: string;
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
  petalRarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique';
  damage: number;
  size: number;
}

export interface PlayerProjectile {
  id: string;
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
  petalRarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique';
  damage: number;
  size: number;
}

export interface Enemy {
  id: string;
  type: 'octopus' | 'fish' | 'shark' | 'bee' | 'ladybug' | 'soldier_ant' | 'hornet';
  tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique';
  x: number;
  y: number;
  angle: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  knockbackX?: number;
  knockbackY?: number;
  wanderTarget?: { x: number; y: number };
  lastWanderTime?: number;
  isHostile?: boolean;
  isChasing?: boolean;  // Whether the enemy is currently chasing a player
  poisonEffects?: PoisonEffect[];  // Active poison effects on this enemy
  range?: number;
  lastProjectileTime?: number;  // Last time this enemy shot a projectile
}

export interface Obstacle {
id: string;
x: number;
y: number;
width: number;
height: number;
type: 'coral';
isEnemy: boolean;
health?: number;
}