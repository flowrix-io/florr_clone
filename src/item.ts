export interface Item {
  id: string;
  type: 'health_potion' | 'speed_boost' | 'shield';
  x: number;
  y: number;
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
}

export interface ItemWithRarity extends Item {
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
  onCooldown?: boolean;
}