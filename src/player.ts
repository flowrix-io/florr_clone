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
//
// Glitch is the odd one out: it registers no skin and replaces no body. It is a
// post-process MODIFIER applied to whatever body ends up rendering (default
// flower, built-in skin or user-created skin), so it composes with the other
// bits — e.g. renderFlags = Pumpkin | Glitch is a glitching pumpkin. See
// graphics/glitch-effect.ts.
export enum PlayerRenderFlags {
    Pumpkin = 1 << 0,
    Robot = 1 << 1,
    Glitch = 1 << 2,
}

/**
 * The render flags a client should actually draw this player with: the
 * persisted cosmetic bits plus the transient Glitch bit a glitch mob infects
 * them with (ServerPlayer.glitched).
 *
 * The two are kept apart on the server on purpose — `renderFlags` is account
 * content that savePlayerProgress writes to the database, and an affliction
 * that lasts until the next respawn must never end up in there. They are only
 * merged on the way out, so no wire field or codec change is needed: the
 * existing `r` field carries both.
 */
export function effectiveRenderFlags(player: { renderFlags?: number; glitched?: boolean }): number {
    return (player.renderFlags ?? 0) | (player.glitched ? PlayerRenderFlags.Glitch : 0);
}

// Compact inventory: flat number array of [rarityId, itemId, count, ...] triplets
export type PlayerInventory = number[];

// Talent tiers, keyed by skill id. The maze has its own independent tree
// (ServerPlayer.mazeSkills), bought with its own TP pool.
export interface PlayerSkills {
  damage?: string; // Rarity tier: common, uncommon, rare, etc.
  petalHealth?: string;
  playerHealth?: string;
  healingMultiplier?: string;
  secondChance?: string; // Invulnerability when reaching 1 HP
  absorbing?: string; // Boosts maze Absorb-tab XP, up to 800% at apex. Outside-tree only.
}

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
  // The flower's own eased render position, republished by game.ts easeToTarget()
  // for EVERY player, and used to anchor that player's absolute (server-sent)
  // petal positions in graphics/player-drawing.ts.
  _refX?: number;
  _refY?: number;
  // NOTE: players deliberately have NO `_snapshots` buffer (enemies do). Every
  // flower, local and remote, renders by easing x/y toward targetX/targetY at
  // the same rate — see game.ts easeToTarget()/predictLocalPlayer().
  // Effective speed multiplier from the server (speed boosts / speed petals), so
  // client-side prediction can move at the same speed as the server.
  speedFactor?: number;
  eye?: {x: number, y: number};
  targetEye?: {x: number, y: number};
  isDead?: boolean;
  petalExtension?: number; // Petal extension value from server (per-player)
  // Authoritative per-petal positions from the server, with interpolation targets.
  // Sent for the local player AND every on-screen remote player (server.ts
  // PETAL_DETAIL_MAX_PLAYERS); empty/absent means "out of detail range", and
  // player-drawing.ts falls back to a canonical client-side orbit for that flower.
  petalPositions?: Array<{ loadoutIndex: number; instanceIndex: number; x: number; y: number; targetX?: number; targetY?: number; noPhysics?: boolean }>;
  tp?: number; // Talent Points
  skills?: {
    damage?: string; // Rarity tier: common, uncommon, rare, etc.
    petalHealth?: string;
    playerHealth?: string;
    healingMultiplier?: string;
    secondChance?: string; // Invulnerability when reaching 1 HP
    absorbing?: string; // Boosts maze Absorb-tab XP, up to 800% at apex
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
  inMaze?: boolean;        // True when this player is currently inside the maze
  // While inMaze, `level`/`xp` describe the MAZE track. This mirrors the
  // outside level so the HUD can show what mob kills in here are banking into.
  outsideLevel?: number;
  // What this player brought into the maze ("rarityId|itemId" → count;
  // inventory in regular terms + loadout in maze-shifted terms). Sent by the
  // server on authenticate/respawn. Petals beyond these counts were obtained
  // during the maze run and are the only ones the Absorb tab accepts.
  mazeEntryCounts?: Record<string, number>;
  sizeMultiplier?: number; // Multiplier applied to the flower's radius/hitbox (from equipped petal playerRadius modifiers)
  magnetism?: number;      // Additive pixels added to item pickup radius (sum of equipped petal magnetism modifiers)
}
export interface PlayerProgress {
  totalXP: number; // Total XP accumulated (level, maxHealth, damage calculated from this)
  inventory: PlayerInventory;
  loadout: (Item | null)[];
  tp?: number; // Talent Points
  skills?: PlayerSkills;
  // The maze's independent progression track (see ServerPlayer). Persisted
  // separately from totalXP/tp/skills and never reset.
  mazeTotalXP?: number;
  mazeTp?: number;
  mazeSkills?: PlayerSkills;
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
    seq?: number;
    keys: string[];
    useMouse?: boolean;
    mouseX?: number; // Deprecated - kept for backwards compatibility
    mouseY?: number; // Deprecated - kept for backwards compatibility
    mouseDirectionX?: number; // Normalized direction X (-1 to 1)
    mouseDirectionY?: number; // Normalized direction Y (-1 to 1)
    mouseSpeedMultiplier?: number; // Speed multiplier calculated on client (0.15 to 1.0)
    petalExtension?: number;
  };
  lastProcessedInputSeq?: number;
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
  tp?: number; // Talent Points (of whichever track is live — see mazeXPSwapped)
  skills?: PlayerSkills;
  secondChanceCooldownUntil?: number; // Timestamp when second chance cooldown expires
  mobKills?: { [mobType: string]: { [rarity: string]: number } }; // Track mob kills: mobType -> rarity -> count
  stars?: number; // In-game currency earned from challenges and codes
  petalPositions?: Array<{ loadoutIndex: number; instanceIndex: number; x: number; y: number; noPhysics?: boolean }>; // Petal positions calculated on server
  faceFlags?: number;      // Bitmask of FaceFlags (computed each tick)
  equipFlags?: number;     // Bitmask of EquipmentFlags (computed from loadout)
  renderFlags?: number;    // Bitmask of PlayerRenderFlags — broadcast so clients pick the custom skin render
  // Infected by a glitch mob (contact or projectile). Transient and NEVER
  // persisted: it rides out to clients merged into renderFlags by
  // effectiveRenderFlags() and is cleared on respawn, not on death — a corpse
  // stays glitched.
  glitched?: boolean;
  equippedSkinId?: string; // ID of an equipped user-created skin (broadcast so clients render it on this player)
  mouth?: number;          // Mouth curve Y control point
  squadId?: string;        // ID of the squad this player belongs to
  guildName?: string;      // 5-char alphanumeric guild name (broadcast so clients can render it)
  inPvpArena?: boolean;    // True when player is currently inside the PVP arena
  pvpScore?: number;       // PVP arena score (kills + assists). Resets when leaving the arena.
  inMaze?: boolean;        // True when player is currently inside the maze. Unlike PVP, the
                           // regular inventory stays live — petals found in the maze are kept
                           // permanently. The loadout is LOCKED inside (updateLoadout rejects
                           // every change): petals must be equipped on the title screen.
  // Maze loadout: on entry the pristine regular loadout is stashed in
  // `regularLoadout` (like PVP) and the player runs on a DERIVED loadout that
  // is shifted DOWN one rarity, with active-slot petals above the maze cap
  // benched. The stash is restored verbatim on exit and is what every save
  // persists, so the maze never mutates the regular loadout. The inventory
  // stays in regular-world terms the whole run — drops are upgraded one rarity
  // at pickup instead — which is safe because the locked loadout (updateLoadout
  // rejects every change) and the inventory never mix. True while the derived
  // maze loadout is live.
  mazeRarityShifted?: boolean;
  // Snapshot of everything brought into the maze (inventory + loadout, in
  // post-shift terms), keyed "rarityId|itemId" → count. Absorbing is limited
  // to the surplus over this snapshot: only petals obtained during the maze
  // run may be absorbed. Cleared on maze exit; survives in-maze deaths.
  mazeEntryCounts?: Record<string, number>;

  // --- Two-track progression ------------------------------------------------
  // The maze has its own permanent level, TP pool and talent tree, separate
  // from the outside world's. Exactly ONE track is live at a time: `level`,
  // `xp`, `xpToNextLevel`, `tp` and `skills` always describe the track the
  // player is currently standing in, so stat scaling, the XP bar and the
  // skill menu all follow without special-casing. The other track is parked
  // as a plain totalXP number. `mazeXPSwapped` says which way round we are.
  //
  //   outside:  live = outside track;  mazeTotalXP/mazeTp/mazeSkills   parked
  //   in maze:  live = maze track;     regularTotalXP/Tp/Skills        parked
  //
  // Reads should go through getOutsideTotalXP()/getMazeTotalXP() rather than
  // touching the parked fields, and saves are NEVER written from the live
  // fields directly — savePlayerProgress persists both tracks explicitly, so
  // a crash inside the maze can't overwrite the outside level.
  mazeXPSwapped?: boolean;
  mazeTotalXP?: number;      // parked maze totalXP (authoritative while OUTSIDE)
  mazeTp?: number;
  mazeSkills?: PlayerSkills;
  regularTotalXP?: number;   // parked outside totalXP (authoritative while INSIDE)
  regularTp?: number;
  regularSkills?: PlayerSkills;

  // Pristine regular loadout/inventory stashed while a mode-specific loadout is
  // live, so the mode never touches the persisted regular data. In PVP both are
  // stashed: `loadout` becomes fixed basics, `inventory` becomes the PVP-only
  // inventory, and on exit 25% of the PVP inventory is transferred into
  // `regularInventory` before both are restored. In the maze only
  // `regularLoadout` is stashed (the inventory stays live and regular-world);
  // `loadout` runs on the derived maze loadout and the stash is restored on
  // exit. Exactly one mode is ever active at a time, so the fields don't clash.
  regularInventory?: PlayerInventory;
  regularLoadout?: (Item | null)[];
  // The player's SEPARATE maze loadout preset, in regular-world terms, shared
  // across maze runs and persisted independently of the regular `loadout`.
  // Configured on the title screen when the maze biome is selected. A preset
  // over the full collection (inventory + regular loadout) — the same owned
  // petal may appear in both builds; it does not physically consume from the
  // inventory. `undefined` = never customised (defaults to a copy of the
  // regular loadout on first maze entry); an explicit array is respected.
  mazeLoadout?: (Item | null)[];
  // Poison inflicted by a mob's body contact (evil centipede). One stack at a
  // time: a fresh bite replaces the old one rather than adding to it, matching
  // how petal poison refreshes on mobs. Lotus subtracts from `poisonDamage`
  // (see calculatePlayerModifiers().poisonArmor) rather than shortening it.
  poisonDamage?: number;   // damage per second currently ticking
  poisonUntil?: number;    // timestamp the poison lapses
  poisonSource?: { type: string; tier: string }; // credited in `killedBy` if the poison finishes the player
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
