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
  return type === 'centipede' || type === 'desert_centipede';
}

export function isCentipedeBodyType(type: string): boolean {
  return type === 'centipede_body' || type === 'desert_centipede_body';
}

export function getCentipedeBodyType(headType: string): string {
  if (headType === 'desert_centipede') return 'desert_centipede_body';
  return 'centipede_body';
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
  aiType?: 'passive' | 'neutral' | 'hostile' | 'sandstorm';
  isChasing?: boolean;  // Whether the enemy is currently chasing a player
  targetPlayerId?: string;  // ID of the player currently being targeted (persists until player is out of range)
  range?: number;
  wanderTargetX?: number;
  wanderTargetY?: number;
  lastWanderTime?: number;
  // gardn-style passive AI (see moveEnemies): state machine + friction velocity.
  passiveState?: 'idle' | 'moving';
  passiveStateStart?: number;  // timestamp the current passive state began
  velX?: number;               // passive movement velocity (friction integrator)
  velY?: number;
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
  
  // Map enemy types to mob types - only handle mobs that exist in our config
  const mobType = enemy.type;
  if (mobType === 'bee' || mobType === 'ladybug' || mobType === 'soldier_ant') {
    const mobStats = getMobStats(mobType, enemy.tier);
    if (mobStats && mobStats.xp) {
      return mobStats.xp;
    }
  }
  
  // Fallback to tier-based XP for other enemy types or if mob config lookup fails
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
