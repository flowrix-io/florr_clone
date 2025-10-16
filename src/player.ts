import {Item, ItemWithRarity} from './item';

export interface PlayerInventory {
    [rarity: string]: {
        [itemType: string]: number;
    };
}

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
  inventory: PlayerInventory;
  loadout: (Item | null)[];
  isInvulnerable?: boolean;
  knockbackX?: number;
  knockbackY?: number;
  level: number;
  xp: number;
  xpToNextLevel: number;
  lastDamageTime?: number;
  speed_boost?: boolean;
  targetX: number;
  targetY: number;
  eye?: {x: number, y: number};
  targetEye?: {x: number, y: number};
  isDead?: boolean;
}
export interface PlayerProgress {
  level: number;
  xp: number;
  inventory: PlayerInventory;
  loadout: (Item | null)[];
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
  inventory: PlayerInventory;
  loadout: (Item | null)[];
  isInvulnerable?: boolean;
  knockbackX?: number;
  knockbackY?: number;
  level: number;
  xp: number;
  xpToNextLevel: number;
  lastDamageTime?: number;
  speed_boost: number;
  inputs: {
    keys: string[];
    useMouse?: boolean;
    mouseX?: number;
    mouseY?: number;
    petalExtension?: number;
  };
  // Cross-server transfer properties
  isTransferred?: boolean;
  transferToken?: string;
  // Teleporter timing properties
  currentTeleporter?: string; // ID of teleporter player is in
  teleporterEnterTime?: number; // Timestamp when player entered teleporter
  teleportCooldown?: number; // Cooldown to prevent rapid teleportations
  isDead?: boolean;
  killedBy?: { type: string; tier: string }; // Track which enemy killed the player
}