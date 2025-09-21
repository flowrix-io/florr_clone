import {Item} from './item';

export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  score: number;
  imageLoaded: boolean;
  image: HTMLImageElement;
  velocityX: number;
  velocityY: number;
  health: number;
  maxHealth: number;
  damage: number;
  inventory: Item[];
  loadout: (Item | null)[];
  isInvulnerable?: boolean;
  knockbackX?: number;
  knockbackY?: number;
  level: number;
  xp: number;
  xpToNextLevel: number;
  lastDamageTime?: number;
  speed_boost?: boolean;
}
export interface ServerPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  score: number;
  velocityX: number;
  velocityY: number;
  health: number;
  maxHealth: number;
  damage: number;
  inventory: Item[];
  loadout: (Item | null)[];
  isInvulnerable?: boolean;
  knockbackX?: number;
  knockbackY?: number;
  level: number;
  xp: number;
  xpToNextLevel: number;
  lastDamageTime?: number;
  speed_boost?: boolean;
}