export interface Item {
  type: 'health_potion' | 'speed_boost' | 'shield';
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
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