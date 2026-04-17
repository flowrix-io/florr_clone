export interface Item {
  type: 'health_potion' | 'speed_boost' | 'shield' | 'petal';
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
  petalType?: string; // For petals: 'basic', 'rose', 'stinger', etc.
  health?: number; // For petals: current health
  maxHealth?: number; // For petals: maximum health
  onCooldown?: boolean; // For all items: cooldown state
  customDamage?: number; // Custom damage override (writable via memory)
  customSize?: number; // Custom size override (writable via memory)
  instanceHealth?: number[]; // Per-instance health for clumped petals (one entry per spawned instance)
  instanceOnCooldown?: boolean[]; // Per-instance cooldown state for clumped petals
  instanceCooldownEndTime?: number[]; // Absolute ms timestamp when each instance's cooldown ends
}

export interface WorldItem extends Item {
  id: string;
  x: number;
  y: number;
  eligiblePlayers?: string[];  // List of player IDs eligible to pick up this drop
  pickedUpBy?: Set<string>;  // Set of player IDs who have already picked this up
  spawnTime?: number;  // Timestamp when item was spawned
}

export interface ItemWithRarity extends Item {
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
  onCooldown?: boolean;
}