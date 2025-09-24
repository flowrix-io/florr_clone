export interface Dot {
  x: number;
  y: number;
}

export interface Enemy {
  id: string;
  type: 'octopus' | 'fish' | 'shark';
  tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
  x: number;
  y: number;
  angle: number;
  health: number;
  speed: number;
  damage: number;
  knockbackX?: number;
  knockbackY?: number;
  wanderTarget?: { x: number; y: number };
  lastWanderTime?: number;
  isHostile?: boolean;
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