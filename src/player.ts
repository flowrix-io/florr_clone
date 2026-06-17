import {Item} from './item';
import { PlayerEffect } from './petal_actions';

export enum FaceFlags {
    Poisoned = 1 << 0,
    Dandelioned = 1 << 1,
    DeadEyes = 1 << 2,
    SquareEyes = 1 << 3,
    Attacking = 1 << 4,
    Defending = 1 << 5,
}

export enum EquipmentFlags {
    Cutter = 1 << 0,
    ThirdEye = 1 << 1,
    Observer = 1 << 2,
    Antennae = 1 << 3,
    Test1 = 1 << 4, // Unused/test flag for bitmask expansion
}

// Bitmask flags that activate a custom player skin. Each bit maps to a skin
// registered in graphics/player-skins.ts whose render() replaces the default
// drawFlower() body. A skin only renders when its bit is set in player.renderFlags
// — with no bit set the player draws as the normal flower. Bits are checked in
// registration order, so the lowest-priority set bit wins if several are on.
export enum PlayerRenderFlags {
    Pumpkin = 1 << 0,
    Robot = 1 << 1,
}

// Compact inventory: flat number array of [rarityId, itemId, count, ...] triplets
export type PlayerInventory = number[];

// Legacy string-based format used only for database storage and configs
export interface PlayerInventoryDict {
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
  // Smoothly-interpolated server position for the local (predicted) player, used
  // only to anchor its absolute petal positions (player.x/y itself is predicted).
  _refX?: number;
  _refY?: number;
  // Effective speed multiplier from the server (speed boosts / speed petals), so
  // client-side prediction can move at the same speed as the server.
  speedFactor?: number;
  eye?: {x: number, y: number};
  targetEye?: {x: number, y: number};
  isDead?: boolean;
  petalExtension?: number; // Petal extension value from server (per-player)
  petalPositions?: Array<{ loadoutIndex: number; instanceIndex: number; x: number; y: number; targetX?: number; targetY?: number; noPhysics?: boolean }>; // Petal positions from server (with interpolation targets)
  tp?: number; // Talent Points
  skills?: {
    damage?: string; // Rarity tier: common, uncommon, rare, etc.
    petalHealth?: string;
    playerHealth?: string;
    healingMultiplier?: string;
    secondChance?: string; // Invulnerability when reaching 1 HP
  };
  mobKills?: { [mobType: string]: { [rarity: string]: number } }; // Track mob kills: mobType -> rarity -> count
  stars?: number; // In-game currency earned from challenges and codes
  teleporterCharging?: boolean; // True when player is standing in a teleporter charging up
  teleporterChargeStart?: number; // Timestamp when teleporter charge began
  flowerColor?: string;    // Base flower color (hex like '#FFE763')
  faceFlags?: number;      // Bitmask of FaceFlags (poisoned, dead eyes, square eyes, etc.)
  equipFlags?: number;     // Bitmask of EquipmentFlags (cutter, third eye, observer, antennae)
  renderFlags?: number;    // Bitmask of PlayerRenderFlags — when a bit is set the matching custom skin replaces the default flower render
  equippedSkinId?: string; // ID of an equipped user-created skin (data-driven, see skin_format.ts); takes priority over renderFlags
  mouth?: number;          // Mouth curve Y control point (14.5 = smile, higher = more open)
  cutterAngle?: number;    // Rotation angle for cutter equipment
  forcedFlags?: boolean;   // When true, server flag updates are ignored (set by /forcelocalplayerflags)
  squadId?: string;        // ID of the squad this player belongs to
  guildName?: string;      // 5-char alphanumeric guild name — rendered as [NAME] under the health bar
  inPvpArena?: boolean;    // True when this player is currently inside the PVP arena
  pvpScore?: number;       // PVP arena score (resets when leaving the arena)
  sizeMultiplier?: number; // Multiplier applied to the flower's radius/hitbox (from equipped petal playerRadius modifiers)
  magnetism?: number;      // Additive pixels added to item pickup radius (sum of equipped petal magnetism modifiers)
}
export interface PlayerProgress {
  totalXP: number; // Total XP accumulated (level, maxHealth, damage calculated from this)
  inventory: PlayerInventory;
  loadout: (Item | null)[];
  tp?: number; // Talent Points
  skills?: {
    damage?: string; // Rarity tier: common, uncommon, rare, etc.
    petalHealth?: string;
    playerHealth?: string;
    healingMultiplier?: string;
    secondChance?: string; // Invulnerability when reaching 1 HP
  };
  mobKills?: { [mobType: string]: { [rarity: string]: number } }; // Track mob kills: mobType -> rarity -> count
  stars?: number; // In-game currency earned from challenges and codes
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
  // Effective speed multiplier (speed_boost × petal/effect multipliers) used for
  // movement this tick. Cached so the broadcast can send it to the owning client
  // for accurate client-side prediction.
  speedFactor?: number;
  inputs: {
    keys: string[];
    useMouse?: boolean;
    mouseX?: number; // Deprecated - kept for backwards compatibility
    mouseY?: number; // Deprecated - kept for backwards compatibility
    mouseDirectionX?: number; // Normalized direction X (-1 to 1)
    mouseDirectionY?: number; // Normalized direction Y (-1 to 1)
    mouseSpeedMultiplier?: number; // Speed multiplier calculated on client (0.15 to 1.0)
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
  spawnBiome?: string; // The biome selected on the title screen (for respawning)
  viewportWidth?: number; // Client's effective viewport width (canvas.width / zoomLevel)
  viewportHeight?: number; // Client's effective viewport height (canvas.height / zoomLevel)
  effects?: PlayerEffect[]; // Active petal effects
  tp?: number; // Talent Points
  skills?: {
    damage?: string; // Rarity tier: common, uncommon, rare, etc.
    petalHealth?: string;
    playerHealth?: string;
    healingMultiplier?: string;
    secondChance?: string; // Invulnerability when reaching 1 HP
  };
  secondChanceCooldownUntil?: number; // Timestamp when second chance cooldown expires
  mobKills?: { [mobType: string]: { [rarity: string]: number } }; // Track mob kills: mobType -> rarity -> count
  stars?: number; // In-game currency earned from challenges and codes
  petalPositions?: Array<{ loadoutIndex: number; instanceIndex: number; x: number; y: number; noPhysics?: boolean }>; // Petal positions calculated on server
  faceFlags?: number;      // Bitmask of FaceFlags (computed each tick)
  equipFlags?: number;     // Bitmask of EquipmentFlags (computed from loadout)
  renderFlags?: number;    // Bitmask of PlayerRenderFlags — broadcast so clients pick the custom skin render
  equippedSkinId?: string; // ID of an equipped user-created skin (broadcast so clients render it on this player)
  mouth?: number;          // Mouth curve Y control point
  squadId?: string;        // ID of the squad this player belongs to
  guildName?: string;      // 5-char alphanumeric guild name (broadcast so clients can render it)
  inPvpArena?: boolean;    // True when player is currently inside the PVP arena
  pvpScore?: number;       // PVP arena score (kills + assists). Resets when leaving the arena.
  // While inside the PVP arena, `inventory`/`loadout` hold the PVP-only versions
  // and the player's regular versions are stashed here. On exit, 25% of the PVP
  // inventory is transferred into `regularInventory` and the regular inventory/
  // loadout are restored.
  regularInventory?: PlayerInventory;
  regularLoadout?: (Item | null)[];
  lastDamagedByPlayerId?: string; // ID of the most recent player to damage this player (for PVP kill credit)
  spongeDamageEffects?: Array<{
    remainingDamage: number;
    damagePerSecond: number;
    sourcePlayerId?: string;
    killedBy?: { type: string; tier: string };
  }>;
  sizeMultiplier?: number; // Multiplier applied to the flower's radius/hitbox (from equipped petal playerRadius modifiers)
  magnetism?: number;      // Additive pixels added to item pickup radius (sum of equipped petal magnetism modifiers)
  aggroRadiusBonus?: number; // Additive pixels added to the range at which mobs detect/aggro this player (sum of equipped petal aggroRadius modifiers, e.g. Bulb)
  // Continuous integral of playerRotationSpeedModifier * deltaTime. Used so that
  // changing rotation-speed modifiers mid-flight (e.g. swapping Faster or Yin Yang)
  // bends the orbit's rate instead of snapping its angle to a new one.
  petalOrbitPhase?: number;
}
