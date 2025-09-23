export interface Item {
  type: 'health_potion' | 'speed_boost' | 'shield' | 'petal';
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
  petalType?: string; // For petals: 'basic', 'rose', 'stinger', etc.
  health?: number; // For petals: current health
  maxHealth?: number; // For petals: maximum health
  onCooldown?: boolean; // For all items: cooldown state
}

export interface WorldItem extends Item {
  id: string;
  x: number;
  y: number;
}

export interface ItemWithRarity extends Item {
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
  onCooldown?: boolean;
}