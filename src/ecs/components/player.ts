/**
 * Player components — the decomposition of `ServerPlayer`.
 *
 * `ServerPlayer` carried ~70 fields covering identity, input, two independent
 * progression tracks, inventory, loadout, cosmetics, PVP state, maze state,
 * afflictions and networking bookkeeping. Almost every one of those fields was
 * optional, so reading any of them meant an undefined check, and every system
 * that touched players pulled the whole object into cache to reach two numbers.
 *
 * The split below follows the natural ownership boundaries the comments in
 * player.ts already describe. Two of them are worth calling out because they
 * encode invariants that were previously only prose:
 *
 *  - The two-track progression (outside vs maze) is a LIVE component plus a
 *    PARKED one. Exactly one track is live at a time and the parked track is
 *    inert data, which is what stops a crash inside the maze from overwriting
 *    the outside level.
 *
 *  - The mode stashes (PVP and maze) are their own components. Their presence
 *    means "a mode-specific loadout/inventory is live and the pristine regular
 *    one is stashed here", so the restore-on-exit path can no longer be reached
 *    for a player who never entered the mode.
 */

import { defineComponent, defineTag } from '../component';

/** Display name and owning account. The socket id is the entity's external id. */
export const PlayerIdentity = defineComponent('PlayerIdentity', {
    name: 'str',
    /** Database user id; absent for bots. */
    userId: 'str',
});

/**
 * The most recent input sample from the client.
 *
 * Bots write these same fields, which is why bot AI runs in the Input phase —
 * downstream movement cannot tell a bot from a human, exactly as before.
 */
export const PlayerInput = defineComponent('PlayerInput', {
    /** Client sequence number, echoed back for prediction reconciliation. */
    seq: 'u32',
    lastProcessedSeq: 'u32',
    /** string[] of held keys. */
    keys: 'obj',
    useMouse: 'bool',
    /**
     * Normalised mouse direction, -1..1.
     *
     * f64, not f32, even though the magnitudes are tiny. These three fields are
     * multiplied by MAX_SPEED and the speed factor to produce the target
     * velocity that the SHARED `stepPlayerMovement` integrates, and the legacy
     * path this replaces did that arithmetic in doubles. Storing them narrower
     * would make the ECS result differ from the legacy one in the low bits, and
     * that difference is not observable in the game (petal positions are
     * quantised to 3-6px before they are hashed for the broadcast) but it IS
     * observable in the cutover check, which asserts exact equality against the
     * legacy formula. Keeping the check exact is worth 12 bytes per player.
     */
    mouseDirectionX: 'f64',
    mouseDirectionY: 'f64',
    /** Client-computed speed multiplier, 0.15..1.0. */
    mouseSpeedMultiplier: 'f64',
    petalExtension: 'f32',
});

/**
 * The LIVE progression track.
 *
 * Whichever world the player is standing in, these fields describe it — so
 * stat scaling, the XP bar and the skill menu all work without special-casing
 * the maze.
 */
export const Progression = defineComponent('Progression', {
    level: 'u16',
    xp: 'f64',
    xpToNextLevel: 'f64',
    score: 'f64',
    /** Talent points of the live track. */
    tp: 'u16',
    /** Talent tiers keyed by skill id (PlayerSkills). */
    skills: 'obj',
});

/**
 * The PARKED progression track — the one the player is not currently in.
 *
 * Stored as a plain total-XP number plus its own TP pool and talent tree, and
 * never read by gameplay. `mazeIsLive` says which way round the pair is, and
 * saves persist BOTH tracks explicitly rather than deriving one from the other.
 */
export const ParkedProgression = defineComponent('ParkedProgression', {
    /** True while the maze track is the live one. */
    mazeIsLive: 'bool',
    totalXP: 'f64',
    tp: 'u16',
    skills: 'obj',
});

/** Owned petals, as the compact flat [rarityId, itemId, count, ...] array. */
export const Inventory = defineComponent('Inventory', {
    items: 'obj',
});

/** The equipped petals (`(Item | null)[]`). */
export const Loadout = defineComponent('Loadout', {
    slots: 'obj',
});

/**
 * Pristine regular inventory/loadout stashed while a mode-specific one is live.
 *
 * Presence of this component is precisely the condition the old code expressed
 * as "regularLoadout is defined". In PVP both are stashed; in the maze only the
 * loadout is (the inventory stays live and in regular-world terms).
 */
export const StashedProgress = defineComponent('StashedProgress', {
    inventory: 'obj',
    loadout: 'obj',
});

/**
 * The player's separate maze loadout preset, in regular-world terms.
 * Persisted independently of the regular loadout and shared across runs.
 */
export const MazeLoadoutPreset = defineComponent('MazeLoadoutPreset', {
    slots: 'obj',
});

/** Appearance. All broadcast, so clients render the right flower. */
export const Cosmetics = defineComponent('Cosmetics', {
    flowerColor: 'str',
    /** Bitmask of FaceFlags, recomputed each tick. */
    faceFlags: 'u32',
    /** Bitmask of EquipmentFlags, derived from the loadout. */
    equipFlags: 'u32',
    /** Bitmask of PlayerRenderFlags (persisted cosmetic bits only). */
    renderFlags: 'u32',
    /** Id of an equipped user-created skin; takes priority over renderFlags. */
    equippedSkinId: 'str',
    /** Mouth curve Y control point. */
    mouth: 'f32',
});

/**
 * Derived per-tick movement and petal modifiers, recomputed from the loadout.
 *
 * `speedFactor` is cached here because the broadcast sends it to the owning
 * client so client-side prediction moves at exactly the server's speed.
 */
export const PlayerModifiers = defineComponent('PlayerModifiers', {
    /**
     * The three fields movement consumes are f64 for the same reason
     * PlayerInput's direction fields are: they feed the shared physics step, and
     * the legacy code they replace computed them in doubles. `sizeMultiplier`
     * additionally decides the substep count inside `stepPlayerMovement`, where
     * a rounding difference can change how many substeps a wall contact gets.
     */
    speedBoost: 'f64',
    /**
     * The BASE multiplier the speed derivation starts from
     * (`ServerPlayer.speed_boost`, written by the speed-boost consumable).
     * Mirrored in by the sync while consumables stay legacy; the
     * playerModifiers system multiplies the loadout and effect contributions
     * onto it to produce `speedBoost`.
     */
    speedBoostBase: 'f64',
    speedFactor: 'f64',
    /** Multiplier on the flower's radius and hitbox. */
    sizeMultiplier: 'f64',
    /** Additive pixels on item pickup radius. */
    magnetism: 'f32',
    /** Additive pixels on the range at which mobs aggro this player. */
    aggroRadiusBonus: 'f32',
    /**
     * Continuous integral of the rotation-speed modifier. Kept as an
     * accumulated phase so that changing rotation speed mid-flight bends the
     * orbit rate instead of snapping the angle.
     *
     * f64, and that is not a spare-bytes decision. This is an UNBOUNDED
     * accumulator — it grows by `rotationSpeed * deltaTime` every tick for the
     * whole of a session and is never wrapped, so a long-lived flower reaches
     * ~1e5 after a day of play. It is then multiplied by up to the petal's speed
     * multiplier and fed to cos/sin, and the result is the petal position that
     * gets hashed for the broadcast change detector. In f32 the representable
     * step at 1e5 is ~0.008 while a tick's increment is ~0.03, so the phase
     * would quantise to a coarse ladder: the whole ring would visibly step
     * rather than rotate, and — because the hash would change on a different
     * schedule from the legacy value — the broadcast would churn. The legacy
     * `ServerPlayer.petalOrbitPhase` this replaces was a plain JS double, and
     * `ecs/bench/petal_cutover_check.ts` asserts exact equality against it.
     */
    petalOrbitPhase: 'f64',
});

/** Server-computed absolute petal positions, broadcast for accurate rendering. */
export const PetalPositions = defineComponent('PetalPositions', {
    /** Array<{loadoutIndex, instanceIndex, x, y, noPhysics?}>. */
    positions: 'obj',
});

/** Active petal effects (`PlayerEffect[]`). */
export const PlayerEffects = defineComponent('PlayerEffects', {
    list: 'obj',
});

/** The client's effective viewport, used to decide what to stream it. */
export const Viewport = defineComponent('Viewport', {
    width: 'f32',
    height: 'f32',
});

/** Teleporter charge state. */
export const TeleporterState = defineComponent('TeleporterState', {
    /** Id of the teleporter being stood in. */
    current: 'str',
    enterTime: 'f64',
    /** Timestamp before which further teleports are rejected. */
    cooldownUntil: 'f64',
});

/** Cross-server transfer bookkeeping. */
export const TransferState = defineComponent('TransferState', {
    token: 'str',
});

/** PVP arena score, reset when the player leaves the arena. */
export const PvpState = defineComponent('PvpState', {
    score: 'f64',
    /** Most recent player to damage this one, for kill credit. */
    lastDamagedBy: 'entity',
});

/**
 * Maze run state.
 *
 * `entryCounts` is the snapshot of everything brought in ("rarityId|itemId" ->
 * count); absorbing is limited to the surplus over it, so only petals found
 * during the run can be absorbed.
 */
export const MazeState = defineComponent('MazeState', {
    /** Record<string, number> snapshot taken on entry. */
    entryCounts: 'obj',
    /** True while the derived, rarity-shifted maze loadout is live. */
    rarityShifted: 'bool',
    /** The outside level, mirrored so the HUD can show what kills bank into. */
    outsideLevel: 'u16',
});

/** Squad and guild membership, both broadcast for rendering. */
export const Social = defineComponent('Social', {
    squadId: 'str',
    /** 5-char alphanumeric guild name, rendered as [NAME]. */
    guildName: 'str',
});

/** What killed this player, for the death screen. */
export const KilledBy = defineComponent('KilledBy', {
    type: 'u16',
    tier: 'u8',
});

/** Second-chance talent cooldown. */
export const SecondChance = defineComponent('SecondChance', {
    cooldownUntil: 'f64',
});

/** Per-mob-type kill counters (`mobType -> rarity -> count`). */
export const MobKills = defineComponent('MobKills', {
    counts: 'obj',
});

/** In-game currency earned from challenges and codes. */
export const Currency = defineComponent('Currency', {
    stars: 'f64',
});

/** The biome chosen on the title screen, used when respawning. */
export const SpawnPreference = defineComponent('SpawnPreference', {
    biome: 'str',
});

// --- state tags --------------------------------------------------------------

export const IsPlayer = defineTag('IsPlayer');

/** A server-driven bot rather than a real connection. */
export const IsBot = defineTag('IsBot');

/**
 * Authenticated but still on the title screen.
 *
 * The old code kept these in a SEPARATE `lobbyPlayers` map specifically so that
 * every simulation, targeting, spawn, save and broadcast loop — all of which
 * iterated `players` — would be blind to them by construction rather than by a
 * flag each loop had to remember to check. The tag preserves that guarantee the
 * same way: world queries exclude IsLobby, so a lobby flower cannot be seen by
 * a system that did not explicitly ask for it.
 */
export const IsLobby = defineTag('IsLobby');

export const InPvpArena = defineTag('InPvpArena');
export const InMaze = defineTag('InMaze');

/**
 * Infected by a glitch mob. Transient and NEVER persisted — it is merged into
 * the broadcast render flags on the way out and cleared on respawn, not on
 * death, so a corpse stays glitched.
 */
export const Glitched = defineTag('Glitched');

/**
 * Corrupted flower: hostile to everything, everywhere. Symmetric — a corrupted
 * player's petals damage other players anywhere in the world, and theirs damage
 * it back. Transient and never persisted.
 */
export const Corrupted = defineTag('Corrupted');
