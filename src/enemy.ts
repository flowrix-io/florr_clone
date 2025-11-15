export interface Dot {
  x: number;
  y: number;
}

export interface PoisonEffect {
  damage: number;  // Damage per millisecond
  endTime: number;  // Timestamp when the poison effect ends
  playerId: string;  // ID of the player who applied the poison
}

export interface Enemy {
  id: string;
  type: 'octopus' | 'fish' | 'shark' | 'bee' | 'ladybug' | 'soldier_ant';
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