export interface Item {
  type: 'health_potion' | 'speed_boost' | 'shield' | 'petal';
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique';
  petalType?: string; // For petals: 'basic', 'rose', 'stinger', etc.
  health?: number; // For petals: current health
  maxHealth?: number; // For petals: maximum health
  onCooldown?: boolean; // For all items: cooldown state
}

export interface WorldItem extends Item {
  id: string;
  x: number;
  y: number;
  eligiblePlayers?: string[];  // List of player IDs eligible to pick up this drop
  pickedUpBy?: Set<string>;  // Set of player IDs who have already picked this up
}

export interface ItemWithRarity extends Item {
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique';
  onCooldown?: boolean;
}