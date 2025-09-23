export interface Item {
  type: 'health_potion' | 'speed_boost' | 'shield' | 'petal';
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
  petalType?: string; // For petals: 'basic', 'rose', 'stinger', etc.
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