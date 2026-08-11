import { Server as SocketIOServer } from '../ws_server';
import { ServerPlayer, canPetalsDamagePlayer } from '../player';
import { Enemy } from '../server_utils';
import { WorldItem } from '../item';
import { RARITY_LEVELS, getRarityIndex, Rarity, getAllPetalTypes, getPetalStats, getEffectivePetalCooldown } from '../petals';
import {
    players,
    enemies,
    PLAYER_SIZE,
    ENEMY_SIZE,
    MAX_SPEED,
    ACTUAL_WORLD_WIDTH,
    ACTUAL_WORLD_HEIGHT,
    VIEWPORT_WIDTH,
    VIEWPORT_HEIGHT,
    VIEWPORT_BUFFER,
    SCALE_FACTOR,
    TELEPORTER_RADIUS,
    TELEPORTER_SUCTION_RADIUS,
    TELEPORTER_SUCTION_FORCE,
    TELEPORTER_COOLDOWN,
    isTeleporter,
    RESPAWN_INVULNERABILITY_TIME,
    ServerConfig,
    PVP_ARENA_CENTER_X,
    PVP_ARENA_CENTER_Y,
    PVP_ARENA_RADIUS,
    isInPvpArena,
    stepPlayerMovement
} from '../constants';
import { isInMazeRegion, getActiveMaze, MAZE_ORIGIN_X, MAZE_ORIGIN_Y } from '../maze';
import { WORLD_MAP } from '../map_data';
import {
    items,
    playerUserIds,
    petalLastProjectileTime,
    petalLastRadiationTime,
    itemExpirationTimeouts,
    ITEM_EXPIRATION_TIMES,
    groundPollens,
    GROUND_POLLEN_LIFETIME_MS,
    webFields,
    WEB_LIFETIME_MS,
    WEB_THROW_DISTANCE,
    hasCorruptedPlayers,
    setPlayerCorrupted
} from './gameState';
import {
    checkPlayerWallCollisions,
    checkPlayerEnemyCollision
} from './physics';
import {
    checkItemWallCollisions
} from './physics';
import {
    updatePlayerEffects,
    getDamageMultiplier,
    getSpeedMultiplier,
    getShieldAmount,
    grantShield,
    executePetalActionsOnSpawn,
    handlePetalCollision,
    updatePetalPosition,
    executePetalActions,
    despawnAllPlayerPets,
    spawnPet,
    splitPlayers
} from '../petal_actions';
import {
    getMobStats,
    PETAL_RING_ORBIT_SCALE,
    PETAL_RING_HIT_SCALE,
    PETAL_RING_HIT_INTERVAL_MS,
} from '../mobs';
import { isGlitchInfectingType } from '../server_utils';
import { queryEnemiesNear, petalRingEnemies } from './enemyGrid';

// Reusable per-call buffers for enemy grid queries; avoids per-petal array allocs.
// Two separate buffers because queryEnemiesNear() clears the one it is handed:
// the petal-attraction query and the petal-collision query run in the same petal
// iteration, so sharing one buffer would let the second clobber the first.
const _enemyQueryBuffer: Enemy[] = [];
const _attractionQueryBuffer: Enemy[] = [];
// The guided-missile target scan and uranium's radiation pulse both run inside
// the same petal iteration, so they need buffers of their own for the same reason.
const _seekQueryBuffer: Enemy[] = [];
const _radiationQueryBuffer: Enemy[] = [];

// How long shell's burst shield lasts once delivered.
const BURST_SHIELD_DURATION_MS = 10000;

/**
 * How much of a stall lands on this mob, in [0, 1].
 *
 * A stall is a contest between the rarity of whatever inflicted it and the
 * rarity of the mob resisting it, fought on the same x3-per-tier ladder that
 * damage and health climb. Matched rarities give the source its full designed
 * slow; every tier the mob has on the source divides what gets through by
 * three, so a common pincer barely tickles a mythic mob. A source ABOVE the
 * mob's tier is already at full effect, hence the clamp at 1 — rarity buys you
 * reliability against tougher mobs, never a slow stronger than the petal's own
 * design value.
 */
export function stallPower(sourceRarity: string, mobTier: string): number {
    const src = getRarityIndex(sourceRarity);
    const mob = getRarityIndex(mobTier);
    if (src < 0 || mob < 0) return 1;
    return Math.min(1, Math.pow(3, src - mob));
}

/**
 * Slow a mob down for a while. `speed` is what every movement branch in
 * moveEnemies() reads, so a slow is a scale-down of that field with the
 * pre-slow value parked in `baseSpeed`; server.ts's updateSlowEffects restores
 * it when the timer lapses. Re-applying picks the stronger of the two slows and
 * always extends the timer, so standing in a web keeps the mob crawling.
 *
 * `baseFactor` is the source's design value (0.5 for web/pincer, 0.8 for
 * honey); what actually lands is that value pulled back toward "no slow" by the
 * mob's resistance — see stallPower.
 */
export function applySlow(enemy: Enemy, baseFactor: number, until: number, sourceRarity: string): void {
    const factor = 1 - (1 - baseFactor) * stallPower(sourceRarity, enemy.tier);
    // Nothing worth applying: leave baseSpeed/slowUntil untouched so a
    // negligible stall can't extend the timer on a real one.
    if (factor >= 0.999) return;

    if (enemy.baseSpeed === undefined) enemy.baseSpeed = enemy.speed;
    const slowed = enemy.baseSpeed * factor;
    if (enemy.slowUntil === undefined || enemy.slowUntil <= Date.now() || slowed < enemy.speed) {
        enemy.speed = slowed;
    }
    enemy.slowUntil = Math.max(enemy.slowUntil ?? 0, until);
}
import { addItem, applyPetalHealthBonus, calculatePlayerModifiers, enterPvpArena, exitPvpArena } from './playerManager';
import { ID_TO_RARITY, ID_TO_ITEM_KEY } from '../inventoryCodec';
import { trackDamage, cleanupEnemy, markEnemyDamaged, getOriginalSocketId } from './utils';
import { killEnemy, type KillContext } from './shared/killHandler';

/**
 * Adapt the PlayerStateDependencies bag (built in server.ts) to the kill-handler
 * context. The two share the same kill-related fields; this just projects them.
 */
function killCtxFromDeps(deps: PlayerStateDependencies): KillContext {
    return {
        io: deps.io,
        players,
        playerUserIds,
        database: deps.database,
        savePlayerProgress: deps.savePlayerProgress,
        addXPToPlayer: deps.addXPToPlayer,
        handleMobDrops: deps.handleMobDrops,
        sendBossMobDefeatedMessage: deps.sendBossMobDefeatedMessage,
        updateSpecialMobCounts: deps.updateSpecialMobCounts,
        cleanupEnemy,
        trackMobKill: deps.trackMobKill,
    };
}

// Petal physics state interface
interface PetalPhysicsState {
    vx: number; // Velocity X
    vy: number; // Velocity Y
    x: number; // Current position X
    y: number; // Current position Y
    spawnTime?: number; // Time when petal was spawned (for smooth initialization)
    attractedEnemyId?: string; // Enemy this petal is currently attraction-locked to (for smooth release when it dies)
    // While set and in the future, the petal glides toward its (moving) orbit
    // target with a first-order approach instead of the spring. The spring is
    // underdamped for large displacements (visible overshoot/oscillation), and
    // ramping its force down instead just stalls the petal while the orbit
    // rotates on, so it slings to a point far ahead when the ramp ends. The
    // glide has no momentum: it starts moving immediately, never overshoots,
    // and tracks the rotating target continuously. Used for the spawn/reload
    // fly-out and for the release when an attracting mob dies.
    glideUntil?: number;
}

const PETAL_SPAWN_GLIDE_MS = 300;   // reload/spawn: fly-out from the flower into orbit
const PETAL_RELEASE_GLIDE_MS = 250; // attracting mob died: glide back into orbit
const PETAL_GLIDE_RATE = 14;        // 1/s first-order approach rate (~95% converged in 220ms)

// Map to store petal physics state (keyed by petalId)
const petalPhysicsStates = new Map<string, PetalPhysicsState>();

// Drop a broken petal instance's spring state so its reload re-initializes at
// the flower's center (the petal flies back out into orbit instead of resuming
// from the stale position where it broke).
function resetPetalPhysicsOnBreak(playerId: string, loadoutIndex: number, instanceIndex: number): void {
    petalPhysicsStates.delete(`${playerId}_${loadoutIndex}_${instanceIndex}`);
}

// Slot-wide break: every instance of the slot goes on cooldown together, so
// drop all of their spring states.
function resetSlotPetalPhysicsOnBreak(playerId: string, loadoutIndex: number): void {
    const prefix = `${playerId}_${loadoutIndex}_`;
    for (const key of petalPhysicsStates.keys()) {
        if (key.startsWith(prefix)) petalPhysicsStates.delete(key);
    }
}

// Map to track last damage time for petals with damageCooldown (keyed by petalId)
const petalLastDamageTime = new Map<string, number>();

// Raindrop aura: tracks the last time each (player, enemy) pair took aura damage,
// so an enemy sitting inside the field takes chip damage on an interval rather
// than every server tick. Keyed by playerId -> (enemyId -> lastDamageTime).
const raindropAuraLastDamage = new Map<string, Map<string, number>>();
const RAINDROP_AURA_DAMAGE_INTERVAL_MS = 500;
const RAINDROP_AURA_BASE_RADIUS = 180;
const RAINDROP_AURA_RADIUS_PER_RARITY = 18;

// Petal-ring mobs (glitch flower): last time each player was hit by ANY ring, so
// walking into one costs a hit per sweep rather than one per tick. One timestamp
// per player rather than per (player, mob) pair — two rings closing on the same
// flower at once is rare, and sharing the timer keeps this map bounded by the
// player count and cleaned up by cleanupPetalPhysicsStates.
const petalRingLastHit = new Map<string, number>();

// The flower petal is a whole flower, so touching a mob shatters it and lets out
// whatever was inside: nearly always a squad of glitch flowers that fight for the
// player, and one break in twenty the glitch itself, which takes the player.
const FLOWER_PETAL_PET_TYPE = 'glitch_flower';
const FLOWER_PETAL_PET_COUNT = 3;
const FLOWER_PETAL_CORRUPT_CHANCE = 0.05;

/**
 * Corrupt a flower, splitter half included.
 *
 * Same rule the `corrupt` server command follows: the two halves of a split
 * player are one person, so corrupting only the half that happened to be
 * holding the petal would leave the clone fighting under the other half's
 * rules. tickBroadcast picks the state up from `player.corrupted` on its own,
 * so nothing needs to be emitted here.
 */
function corruptFlowerAndSplitHalf(player: ServerPlayer): void {
    const split = splitPlayers.get(getOriginalSocketId(player.id));
    const halves = split ? [split.player1, split.player2] : [player];
    for (const half of halves) {
        if (players[half.id]) setPlayerCorrupted(players[half.id], true);
    }
}

// Drop an enemy's per-player aura damage-timestamps when it leaves the world.
// Without this the inner maps grow by one entry per enemy ever seen in aura
// range and are only ever cleared on player disconnect — a heap leak that
// builds up over a long session as mobs continuously spawn and die. Called
// from cleanupEnemy so every enemy removal (death or despawn) prunes here.
export function forgetEnemyFromRaindropAura(enemyId: string): void {
    for (const lastDamageMap of raindropAuraLastDamage.values()) {
        lastDamageMap.delete(enemyId);
    }
}

// Drop a damaging pollen puff at the given position. Pollen petals call this
// when they break so the petal still goes through the normal cooldown/reload
// cycle while leaving a short-lived AoE behind.
function spawnGroundPollen(io: any, player: ServerPlayer, petalStats: any, petal: any, petalX: number, petalY: number, petalSize: number) {
    const now = Date.now();
    const id = `pollen_${player.id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
    groundPollens.push({
        id,
        playerId: player.id,
        x: petalX,
        y: petalY,
        damage: petalStats.damage,
        radius: petalSize / 2,
        rarity: petal.rarity,
        expiresAt: now + GROUND_POLLEN_LIFETIME_MS,
        lastDamageByEnemy: new Map<string, number>()
    });
    io.emit('groundPollenSpawned', {
        id,
        playerId: player.id,
        x: petalX,
        y: petalY,
        radius: petalSize / 2,
        rarity: petal.rarity,
        lifetime: GROUND_POLLEN_LIFETIME_MS
    });
}

// Leave a web field where a thrown web petal came to rest. gardn's web petal is
// launched outward while attacking (or dropped where it sits while defending)
// and spawns the field from alloc_web() when it despawns 0.6s later; the petal
// itself is consumed either way and reloads normally.
function spawnWebField(io: any, player: ServerPlayer, radius: number, rarity: string, x: number, y: number) {
    const now = Date.now();
    const id = `web_${player.id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
    webFields.push({ id, playerId: player.id, x, y, radius, rarity, expiresAt: now + WEB_LIFETIME_MS });
    io.emit('webSpawned', { id, x, y, radius, rarity, lifetime: WEB_LIFETIME_MS });
}

// --- Per-instance petal health/cooldown helpers ---
// Some petals spawn multiple instances (count > 1) that should each carry their own
// health and cooldown, so a single hit can't kill them all at once and each breaks
// and recharges independently. This applies to clumped petals (e.g. sand, which share
// one orbit slot) and to spread petals flagged `independentHealth` (e.g. light, whose
// particles orbit in separate slots). `clumped` controls only visual arrangement; the
// independent-health behavior is gated separately here.

function hasIndependentInstances(petalStats: any): boolean {
    return !!((petalStats?.clumped || petalStats?.independentHealth) && (petalStats.count ?? 1) > 1);
}

function ensureInstanceArrays(petal: any, petalStats: any): void {
    if (!hasIndependentInstances(petalStats)) return;
    const count = petalStats.count ?? 1;
    const defaultHealth = petal.maxHealth ?? petalStats.health;
    if (!Array.isArray(petal.instanceHealth) || petal.instanceHealth.length !== count) {
        petal.instanceHealth = new Array(count).fill(defaultHealth);
    }
    if (!Array.isArray(petal.instanceOnCooldown) || petal.instanceOnCooldown.length !== count) {
        petal.instanceOnCooldown = new Array(count).fill(false);
    }
}

function restoreIndependentPetalInstance(
    playerId: string,
    loadoutIndex: number,
    instanceIndex: number,
    snapshotPetalType: string | undefined,
    snapshotRarity: string | undefined,
    snapshotMaxHealth: number | undefined,
    io: any
): void {
    const current = players[playerId]?.loadout?.[loadoutIndex];
    if (!current || current.type !== 'petal') return;
    if (current.petalType !== snapshotPetalType || current.rarity !== snapshotRarity) return;
    if (!current.petalType || !current.rarity) return;

    const currentStats = getPetalStats(current.petalType, current.rarity);
    if (!currentStats || !hasIndependentInstances(currentStats)) return;

    ensureInstanceArrays(current, currentStats);
    const restoredHealth = snapshotMaxHealth ?? current.maxHealth ?? currentStats.health;
    current.instanceOnCooldown![instanceIndex] = false;
    if (Array.isArray(current.instanceCooldownEndTime)) {
        current.instanceCooldownEndTime[instanceIndex] = undefined;
    }
    current.instanceHealth![instanceIndex] = restoredHealth;
    current.health = Math.max(0, ...current.instanceHealth!);
    current.onCooldown = current.instanceOnCooldown!.every((c: boolean) => c);

    io.emit('petalRestored', {
        playerId,
        slotIndex: loadoutIndex,
        instanceIndex,
        petal: current
    });
}

function getInstanceHealth(petal: any, instanceIndex: number, petalStats: any): number {
    if (hasIndependentInstances(petalStats) && Array.isArray(petal.instanceHealth)) {
        return petal.instanceHealth[instanceIndex] ?? 0;
    }
    return petal.health ?? 0;
}

function setInstanceHealth(petal: any, instanceIndex: number, petalStats: any, value: number): void {
    if (hasIndependentInstances(petalStats) && Array.isArray(petal.instanceHealth)) {
        petal.instanceHealth[instanceIndex] = value;
        // Keep petal.health reflecting the max across live instances so legacy UI/health bars
        // render a sensible value for the slot overall.
        petal.health = Math.max(0, ...petal.instanceHealth);
    } else {
        petal.health = value;
    }
}

/**
 * Has an on-cooldown petal/instance reached its restore deadline? Stamps one
 * when it's missing (returning false for this tick) rather than reading
 * "no deadline" as "expired" — see the backstop in the tick loop.
 */
function cooldownDeadlinePassed(petal: any, instanceIndex: number, petalStats: any, currentTime: number): boolean {
    if (hasIndependentInstances(petalStats)) {
        const count = petalStats.count ?? 1;
        if (!Array.isArray(petal.instanceCooldownEndTime) || petal.instanceCooldownEndTime.length !== count) {
            petal.instanceCooldownEndTime = new Array(count).fill(undefined);
        }
        const endTime = petal.instanceCooldownEndTime[instanceIndex];
        if (endTime === undefined) {
            petal.instanceCooldownEndTime[instanceIndex] = currentTime + getEffectiveCooldown(petal, petalStats);
            return false;
        }
        return currentTime >= endTime;
    }
    if (petal.cooldownEndTime === undefined) {
        petal.cooldownEndTime = currentTime + getEffectiveCooldown(petal, petalStats);
        return false;
    }
    return currentTime >= petal.cooldownEndTime;
}

function isInstanceOnCooldown(petal: any, instanceIndex: number, petalStats: any): boolean {
    if (hasIndependentInstances(petalStats) && Array.isArray(petal.instanceOnCooldown)) {
        return !!petal.instanceOnCooldown[instanceIndex];
    }
    return !!petal.onCooldown;
}

// Physics constants
const SPRING_FORCE = 600; // Spring force back to orbit position (pixels per second^2) - reduced from 300
const DAMPING = 0.72; // Velocity damping per frame (0-1, lower = more damping)
const SPAWN_SMOOTH_TIME = 300; // Time in ms to smoothly ramp up forces after spawn - reduced from 500

// Healing-skill multiplier applied to all petal healing (passive and burst).
// Skills are disabled inside the PVP arena.
const HEAL_SKILL_MULTIPLIERS: Record<string, number> = {
    common: 1.0,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.35,
    legendary: 1.6,
    mythic: 2.0,
    ultra: 2.6,
    super: 3.3,
    unique: 4.0,
    apex: 4.8
};

function getHealingSkillMultiplier(player: ServerPlayer): number {
    return !player.inPvpArena && player.skills?.healingMultiplier
        ? (HEAL_SKILL_MULTIPLIERS[player.skills.healingMultiplier] || 1.0)
        : 1.0;
}

function getEffectiveCooldown(petal: any, petalStats: any): number {
    return getEffectivePetalCooldown(petal.petalType, petal.rarity, petalStats);
}

function getSpongeAbsorbDuration(player: ServerPlayer): number {
    let duration = 0;
    const loadout = player.loadout || [];
    for (let i = 0; i < loadout.length && i < 10; i++) {
        const petal = loadout[i];
        if (!petal || petal.type !== 'petal' || petal.petalType !== 'sponge' || !petal.rarity || petal.onCooldown) continue;
        const stats = getPetalStats(petal.petalType, petal.rarity);
        if (stats?.spongeDamageDuration) {
            duration = Math.max(duration, stats.spongeDamageDuration);
        }
    }
    return duration;
}

function queueSpongeDamage(
    player: ServerPlayer,
    damage: number,
    durationMs: number,
    killedBy?: { type: string; tier: string },
    sourcePlayerId?: string
): void {
    if (damage <= 0 || durationMs <= 0) return;
    const durationSec = durationMs / 1000;
    if (!player.spongeDamageEffects) {
        player.spongeDamageEffects = [];
    }
    player.spongeDamageEffects.push({
        remainingDamage: damage,
        damagePerSecond: damage / durationSec,
        sourcePlayerId,
        killedBy
    });
    player.lastDamageTime = Date.now();
    if (sourcePlayerId) {
        player.lastDamagedByPlayerId = sourcePlayerId;
    }
}

function updateSpongeDamage(player: ServerPlayer, deltaTime: number, io: SocketIOServer): void {
    if (!player.spongeDamageEffects?.length || player.isDead || player.isInvulnerable) return;

    let totalDamage = 0;
    const remainingEffects: NonNullable<ServerPlayer['spongeDamageEffects']> = [];
    for (const effect of player.spongeDamageEffects) {
        const damageThisFrame = Math.min(effect.remainingDamage, effect.damagePerSecond * deltaTime);
        if (damageThisFrame <= 0) continue;

        totalDamage += damageThisFrame;
        effect.remainingDamage -= damageThisFrame;
        if (effect.sourcePlayerId) {
            player.lastDamagedByPlayerId = effect.sourcePlayerId;
        }
        if (effect.killedBy) {
            player.killedBy = effect.killedBy;
        }
        if (effect.remainingDamage > 0.001) {
            remainingEffects.push(effect);
        }
    }

    player.spongeDamageEffects = remainingEffects;
    if (totalDamage <= 0) return;

    player.health -= totalDamage;
    player.lastDamageTime = Date.now();

    const secondChanceTriggered = player.health <= 0 && trySecondChance(player, io);
    if (secondChanceTriggered) {
        player.spongeDamageEffects = [];
    }

    io.emit('playerDamaged', {
        playerId: player.id,
        health: player.health,
        maxHealth: player.maxHealth,
        isInvulnerable: player.isInvulnerable
    });
}

/**
 * Clean up petal physics states for a player
 */
export function cleanupPetalPhysicsStates(playerId: string): void {
    const keysToDelete: string[] = [];
    petalPhysicsStates.forEach((_value, key) => {
        if (key.startsWith(playerId)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => {
        petalPhysicsStates.delete(key);
        petalLastDamageTime.delete(key);
    });
    // Player-vs-player hit cooldowns key on BOTH sides
    // (`${attacker}_${slot}_${inst}_pvp_${victim}`) and have no petalPhysicsStates
    // entry to be swept by the pass above, so they outlive the players named in
    // them. Bounded while this only happened inside the arena; with corruption
    // any two flowers in the world can mint one, so drop them explicitly.
    // `includes`, not `endsWith`: the victim may be this player's splitter half
    // (`${playerId}_split2`), whose keys carry the suffix mid-string.
    const pvpVictimMarker = `_pvp_${playerId}`;
    petalLastDamageTime.forEach((_value, key) => {
        if (key.startsWith(playerId) || key.includes(pvpVictimMarker)) {
            petalLastDamageTime.delete(key);
        }
    });
    raindropAuraLastDamage.delete(playerId);
    petalRingLastHit.delete(playerId);
}

/**
 * Compute the raindrop aura radius for a given rarity. Returns 0 if the
 * player has no raindrop petal equipped on the primary loadout. Picks the
 * largest radius among equipped raindrops so duplicates don't fight each
 * other and the visual matches the damage range.
 */
export function getRaindropAuraRadius(player: ServerPlayer): number {
    if (!player || !player.loadout) return 0;
    let bestRadius = 0;
    for (let i = 0; i < player.loadout.length && i < 10; i++) {
        const petal = player.loadout[i];
        if (!petal || petal.type !== 'petal' || petal.petalType !== 'raindrop' || !petal.rarity) continue;
        if (petal.onCooldown) continue;
        const rarityIndex = Math.max(0, getRarityIndex(petal.rarity));
        const radius = RAINDROP_AURA_BASE_RADIUS + rarityIndex * RAINDROP_AURA_RADIUS_PER_RARITY;
        if (radius > bestRadius) bestRadius = radius;
    }
    return bestRadius;
}

/**
 * Apply raindrop aura damage from this player to enemies in range. The
 * field damages each enemy on a fixed interval (per player/enemy pair)
 * so dwelling inside the field deals continuous chip damage rather than
 * one massive hit per tick. Uses the equipped petal's damage stat, which
 * already scales by rarity in generatePetalStats.
 */
function applyRaindropAuraDamage(player: ServerPlayer, deps: PlayerStateDependencies): void {
    if (!player || !player.loadout || player.isDead) return;

    // Pick the strongest equipped raindrop (highest rarity damage wins).
    let bestDamage = 0;
    let bestRadius = 0;
    for (let i = 0; i < player.loadout.length && i < 10; i++) {
        const petal = player.loadout[i];
        if (!petal || petal.type !== 'petal' || petal.petalType !== 'raindrop' || !petal.rarity) continue;
        if (petal.onCooldown) continue;
        const stats = getPetalStats(petal.petalType, petal.rarity);
        if (!stats) continue;
        const rarityIndex = Math.max(0, getRarityIndex(petal.rarity));
        const radius = RAINDROP_AURA_BASE_RADIUS + rarityIndex * RAINDROP_AURA_RADIUS_PER_RARITY;
        if (stats.damage > bestDamage) bestDamage = stats.damage;
        if (radius > bestRadius) bestRadius = radius;
    }
    if (bestRadius <= 0 || bestDamage <= 0) return;

    const now = Date.now();
    const damageMultiplier = getDamageMultiplier(player);
    const finalDamage = bestDamage * damageMultiplier;

    let lastDamageMap = raindropAuraLastDamage.get(player.id);
    if (!lastDamageMap) {
        lastDamageMap = new Map();
        raindropAuraLastDamage.set(player.id, lastDamageMap);
    }

    const candidates = queryEnemiesNear(player.x, player.y, bestRadius, _enemyQueryBuffer);
    for (let i = 0; i < candidates.length; i++) {
        const enemy = candidates[i];
        if (enemy.isDead) continue;

        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const enemyRadius = enemy._radius ?? (ENEMY_SIZE / 2);
        const hitDist = bestRadius + enemyRadius;
        if (dx * dx + dy * dy >= hitDist * hitDist) continue;

        const lastDmg = lastDamageMap.get(enemy.id) || 0;
        if (now - lastDmg < RAINDROP_AURA_DAMAGE_INTERVAL_MS) continue;
        lastDamageMap.set(enemy.id, now);

        trackDamage(enemy, player.id, finalDamage);
        enemy.health = Math.max(0, enemy.health - finalDamage);
        markEnemyDamaged(enemy);

        if (enemy.health <= 0 && !(enemy as any).isDead) {
            const idx = enemies.findIndex(e => e.id === enemy.id);
            killEnemy(enemy, idx, enemies, killCtxFromDeps(deps), {
                killerPlayerId: player.id,
                trackMobKillTiming: 'sync-snapshot',
            });
        }
    }
}

/**
 * Damage from a mob's orbiting petal ring (the glitch flower) — the mob-side
 * mirror of a player's petals shredding a mob.
 *
 * The test is a BAND, not a per-petal circle: a hit lands whenever the player
 * overlaps the ring's orbit radius, regardless of where the individual petals
 * are at that instant. The petals' angles are drawn from the viewer's own
 * wallclock (the ring is never broadcast — see drawPetalRingFlower), so an
 * angle-exact server test would disagree with what the player is looking at on
 * every client whose clock is off. Rate-limiting to PETAL_RING_HIT_INTERVAL_MS
 * makes the band cost about what being swept by each petal in turn would, and
 * what the player sees — petals passing through them — is what happens.
 *
 * Runs before the movement/collision block of updatePlayerState, so a kill here
 * is picked up by that function's usual end-of-tick death handling.
 */
function applyPetalRingDamage(player: ServerPlayer, io: SocketIOServer): void {
    // Almost always empty (no glitch flower alive nearby), so this is the cost
    // of the feature for everyone else.
    if (petalRingEnemies.length === 0) return;
    if (!player || player.isDead) return;

    const playerRadius = (PLAYER_SIZE / 2) * (player.sizeMultiplier ?? 1.0);
    const now = Date.now();

    for (let i = 0; i < petalRingEnemies.length; i++) {
        const enemy = petalRingEnemies[i];
        if (enemy.isDead) continue;

        const mobRadius = enemy._radius ?? (ENEMY_SIZE / 2);
        const orbitRadius = mobRadius * PETAL_RING_ORBIT_SCALE;
        const petalRadius = mobRadius * PETAL_RING_HIT_SCALE;

        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(distance - orbitRadius) > petalRadius + playerRadius) continue;

        // Infection is a property of touch, so it lands even when the hit itself
        // is on cooldown or the player is invulnerable — same rule as bouncing
        // off a glitch mob's body.
        if (isGlitchInfectingType(enemy.type)) player.glitched = true;

        if (now - (petalRingLastHit.get(player.id) ?? 0) < PETAL_RING_HIT_INTERVAL_MS) continue;
        petalRingLastHit.set(player.id, now);

        // Knockback outward, off the ring. distance can only be ~0 if the mob is
        // standing on the player, which the band test above already excludes for
        // any real orbit radius, but guard the divide anyway.
        let knockbackX = 0;
        let knockbackY = 0;
        if (distance > 0) {
            const knockbackDistance = 25;
            knockbackX = (dx / distance) * knockbackDistance;
            knockbackY = (dy / distance) * knockbackDistance;
            player.x += knockbackX;
            player.y += knockbackY;
        }

        if (!player.isInvulnerable) {
            const shieldAmount = getShieldAmount(player);
            const damageToPlayer = Math.max(0, enemy.damage - shieldAmount);
            const spongeDuration = getSpongeAbsorbDuration(player);

            if (damageToPlayer > 0 && spongeDuration > 0) {
                queueSpongeDamage(player, damageToPlayer, spongeDuration, { type: enemy.type, tier: enemy.tier });
                player.isInvulnerable = true;
                setTimeout(() => {
                    if (players[player.id]) {
                        players[player.id].isInvulnerable = false;
                        io.emit('playerInvulnerabilityEnded', { playerId: player.id });
                    }
                }, 50);
            } else {
                player.health -= damageToPlayer;
                player.lastDamageTime = now;

                if (!(player.health <= 0 && trySecondChance(player, io))) {
                    if (player.health <= 0) {
                        player.killedBy = { type: enemy.type, tier: enemy.tier };
                    }
                    player.isInvulnerable = true;
                    setTimeout(() => {
                        if (players[player.id]) {
                            players[player.id].isInvulnerable = false;
                            io.emit('playerInvulnerabilityEnded', { playerId: player.id });
                        }
                    }, 50);
                }
            }
        }

        io.emit('playerDamaged', {
            playerId: player.id,
            health: player.health,
            maxHealth: player.maxHealth,
            isInvulnerable: player.isInvulnerable,
            knockbackX,
            knockbackY,
        });

        // One ring hit per tick: the cooldown stamp above would swallow the rest
        // anyway, and a second ring should not knock the player twice in a frame.
        break;
    }
}

// Interface for player state dependencies
export interface PlayerStateDependencies {
    io: SocketIOServer;
    addXPToPlayer: (player: ServerPlayer, xp: number, socketId?: string) => void;
    handleMobDrops: (enemy: Enemy, dropMultiplier?: number) => void;
    sendBossMobDefeatedMessage: (enemy: Enemy, io: SocketIOServer, players: Record<string, ServerPlayer>) => void;
    updateSpecialMobCounts: () => void;
    createEnemy: () => Enemy | null;
    savePlayerProgress: (player: ServerPlayer, userId: string) => void;
    transferPlayerToServer: (player: ServerPlayer, targetServerPort: number, targetX: number, targetY: number, io: SocketIOServer, database: any, USE_HTTPS: boolean, currentServerConfig: ServerConfig, currentServerPort: number) => Promise<boolean>;
    currentServerConfig: any;
    currentServerPort: number;
    useHttps: boolean;
    database: any;
    trackMobKill: (enemy: Enemy, players: Record<string, ServerPlayer>, playerUserIds: Record<string, string>, database: any, io: SocketIOServer, savePlayerProgress?: (player: ServerPlayer, userId: string) => void) => void;
    /**
     * The two places petals still touch projectiles, now that projectiles are
     * ECS entities.
     *
     * Injected rather than imported so this module keeps knowing nothing about
     * the ECS — and, more importantly, so the ECS keeps knowing nothing about
     * this module: playerState.ts binds a port at module scope, and any import
     * edge from src/ecs/** back to here boots a real server inside the headless
     * harness (which asserts against exactly that).
     */
    projectiles: ProjectileBridge;
}

/** Damage a mob projectile deals to whatever blocked it. */
export interface BlockedProjectile {
    damage: number;
}

/** The petal <-> ECS-projectile boundary. Implemented in server.ts. */
export interface ProjectileBridge {
    /** Spawn a player-fired projectile. Speed is pixels per MILLISECOND. */
    spawn(spec: {
        playerId: string;
        x: number;
        y: number;
        angle: number;
        speed: number;
        maxDistance: number;
        petalType: string;
        petalRarity: string;
        damage: number;
        health: number;
        size: number;
        now: number;
    }): void;
    /**
     * Run `visit` for every mob projectile a petal at (x, y) is overlapping.
     * The return value is the damage the petal deals back to that projectile.
     */
    forEachBlocking(
        x: number,
        y: number,
        petalRadius: number,
        visit: (projectile: BlockedProjectile) => number,
    ): void;
}

/**
 * Get viewports for all players
 *
 * Cached with a sub-tick TTL: callers invoke this per ENEMY (viewport counting,
 * spawn checks — ~1400 calls per pass), and each call used to walk the whole
 * `players` dictionary and allocate a fresh array. Players don't move within a
 * tick, so one snapshot per half-tick is exact for every existing caller.
 * Callers must treat the result as read-only (all current ones do).
 */
const _viewportCache: Array<{x: number, y: number, width: number, height: number}> = [];
let _viewportCacheAt = -1;
const VIEWPORT_CACHE_TTL_MS = 16;

export function getPlayerViewports(): Array<{x: number, y: number, width: number, height: number}> {
    const now = Date.now();
    if (now - _viewportCacheAt < VIEWPORT_CACHE_TTL_MS) return _viewportCache;
    _viewportCacheAt = now;
    _viewportCache.length = 0;

    for (const playerId in players) {
        // Bots don't dictate enemy spawn budget — otherwise 17 bots clustered
        // around one human would ~18x the spawned mob count.
        if (playerId.startsWith('bot_')) continue;
        const player = players[playerId];
        if (player && player.x !== undefined && player.y !== undefined &&
            !isNaN(player.x) && !isNaN(player.y) &&
            player.x >= 0 && player.x <= ACTUAL_WORLD_WIDTH &&
            player.y >= 0 && player.y <= ACTUAL_WORLD_HEIGHT) {

            // Use per-player viewport size if available, otherwise fall back to default
            const vpWidth = player.viewportWidth || VIEWPORT_WIDTH;
            const vpHeight = player.viewportHeight || VIEWPORT_HEIGHT;

            _viewportCache.push({
                x: player.x - vpWidth / 2,
                y: player.y - vpHeight / 2,
                width: vpWidth,
                height: vpHeight
            });
        }
    }

    return _viewportCache;
}

/**
 * Check if a position is near ANY player — including players in the maze or
 * PVP arena, whose coordinates sit outside the regular world rectangle and are
 * therefore excluded from getPlayerViewports (that function feeds the
 * main-world spawn budget). Use this for enemy keep-alive / despawn decisions:
 * with the world-clamped check, every mob in the maze counted as "outside all
 * viewports" even with a player standing on it, so the entire maze despawned
 * and respawned on a 30-second churn cycle.
 */
// Flat box cache for isPositionNearAnyPlayer, same sub-tick TTL rationale as
// getPlayerViewports: the function is called per enemy per pass (keep-alive +
// despawn = ~2800 calls/tick), and walking the `players` dictionary each call
// was ~6% of total server CPU. Boxes are [cx, cy, halfW, halfH] quads.
const _nearBoxes: number[] = [];
let _nearBoxesAt = -1;
let _nearBoxesSawPlayer = false;

export function isPositionNearAnyPlayer(x: number, y: number): boolean {
    const now = Date.now();
    if (now - _nearBoxesAt >= VIEWPORT_CACHE_TTL_MS) {
        _nearBoxesAt = now;
        _nearBoxes.length = 0;
        _nearBoxesSawPlayer = false;
        for (const playerId in players) {
            if (playerId.startsWith('bot_')) continue;
            const player = players[playerId];
            if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) continue;
            _nearBoxesSawPlayer = true;
            _nearBoxes.push(
                player.x,
                player.y,
                (player.viewportWidth || VIEWPORT_WIDTH) / 2 + VIEWPORT_BUFFER,
                (player.viewportHeight || VIEWPORT_HEIGHT) / 2 + VIEWPORT_BUFFER
            );
        }
    }
    for (let i = 0; i < _nearBoxes.length; i += 4) {
        if (Math.abs(x - _nearBoxes[i]) <= _nearBoxes[i + 2] && Math.abs(y - _nearBoxes[i + 1]) <= _nearBoxes[i + 3]) {
            return true;
        }
    }
    // No players connected: match isPositionInAnyViewport's permissive default.
    return !_nearBoxesSawPlayer;
}

/**
 * Check if a position is in any player's viewport
 */
export function isPositionInAnyViewport(x: number, y: number): boolean {
    const viewports = getPlayerViewports();
    
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    
    // Pure arithmetic — this runs per enemy from the viewport-count pass.
    for (const viewport of viewports) {
        if (x >= viewport.x - VIEWPORT_BUFFER && x <= viewport.x + viewport.width + VIEWPORT_BUFFER &&
            y >= viewport.y - VIEWPORT_BUFFER && y <= viewport.y + viewport.height + VIEWPORT_BUFFER) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a position is in any player's viewport with 200% buffer (for websocket optimization)
 */
export function isPositionInAnyViewport200Percent(x: number, y: number): boolean {
    const viewports = getPlayerViewports();
    
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    
    // Use 200% of VIEWPORT_BUFFER (2x). Pure arithmetic — this runs per enemy.
    const buffer200Percent = VIEWPORT_BUFFER * 2;

    for (const viewport of viewports) {
        if (x >= viewport.x - buffer200Percent && x <= viewport.x + viewport.width + buffer200Percent &&
            y >= viewport.y - buffer200Percent && y <= viewport.y + viewport.height + buffer200Percent) {
            return true;
        }
    }

    return false;
}

/**
 * Filter enemies to only include those in any player's viewport with 200% buffer
 */
export function getEnemiesInViewport200Percent(): Enemy[] {
    return enemies.filter(enemy => isPositionInAnyViewport200Percent(enemy.x, enemy.y));
}

/**
 * Check if a position is within any player's petal range
 */
export function isPositionInPlayerPetalRange(x: number, y: number, mobSize: number): boolean {
    // Check if the mob spawn position would overlap with any player's petal range
    for (const playerId in players) {
        const player = players[playerId];
        if (!player || !player.loadout) continue;
        
        // Calculate player's maximum petal range
        const petalExtension = player.inputs?.petalExtension || 1.0;
        const sizeMult = player.sizeMultiplier ?? 1.0;
        const baseRadius = (60 + (PLAYER_SIZE / 2) * (sizeMult - 1)) * petalExtension;
        
        // Find the largest petal size and range in the player's loadout.
        // Secondary loadout (slots 10+) is storage only — those petals are not in orbit.
        const playerRangeMod = calculatePlayerModifiers(player).range ?? 1.0;
        let maxPetalSize = 0;
        let maxPetalRange = 1.0;
        for (let i = 0; i < player.loadout.length && i < 10; i++) {
            const item = player.loadout[i];
            if (item && item.type === 'petal' && item.petalType && item.rarity) {
                const petalStats = getPetalStats(item.petalType, item.rarity);
                if (petalStats) {
                    const effectiveSize = (item as any).customSize !== undefined ? (item as any).customSize : petalStats.size;
                    const petalSize = 40 * effectiveSize;
                    maxPetalSize = Math.max(maxPetalSize, petalSize);
                    const petalRange = (petalStats.range ?? 1.0) * playerRangeMod;
                    maxPetalRange = Math.max(maxPetalRange, petalRange);
                }
            }
        }
        
        // Calculate the maximum range from player center (base radius * max range multiplier + half petal size + half mob size)
        // Ensure mobs never spawn on top of the player body (PLAYER_SIZE/2 + mobSize/2 + buffer)
        const minBodyRange = PLAYER_SIZE / 2 + mobSize / 2 + 20;
        const maxRange = Math.max(minBodyRange, (baseRadius * maxPetalRange) + (maxPetalSize / 2) + (mobSize / 2));
        
        // Check if the mob spawn position is within this range
        const dx = x - player.x;
        const dy = y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= maxRange) {
            return true; // Position is within petal range
        }
    }
    
    return false; // Position is safe from petal range
}

/**
 * Get count of enemies in viewport
 */
export function getEnemiesInViewportCount(): number {
    const viewports = getPlayerViewports();
    
    // If no players are connected, count all enemies (for initial server startup)
    if (viewports.length === 0) {
        return enemies.length;
    }
    
    let count = 0;
    for (const enemy of enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            count++;
        }
    }
    
    return count;
}

/**
 * Validate and fix invalid player positions
 */
export function validatePlayerPositions(io: SocketIOServer): void {
    // Clean up any invalid player positions that might affect viewport calculations
    for (const playerId in players) {
        const player = players[playerId];
        if (player) {
            // Reset invalid positions to a safe default. PVP-arena and maze
            // coordinates sit outside the regular world but are still valid.
            const inArena = isInPvpArena(player.x, player.y)
                || isInMazeRegion(player.x, player.y);
            if (!inArena && (isNaN(player.x) || isNaN(player.y) ||
                player.x < 0 || player.x > ACTUAL_WORLD_WIDTH ||
                player.y < 0 || player.y > ACTUAL_WORLD_HEIGHT)) {
                
                if (!playerId.startsWith('bot_')) {
                    console.log(`[SERVER] Fixing invalid position for player ${playerId}: (${player.x}, ${player.y})`);
                }
                
                // Reset to center of world
                player.x = ACTUAL_WORLD_WIDTH / 2;
                player.y = ACTUAL_WORLD_HEIGHT / 2;
                
                // Notify client of position correction
                io.to(playerId).emit('positionCorrected', { x: player.x, y: player.y });
            }
        }
    }
}

/** Second Chance invulnerability durations per tier (seconds). */
const SECOND_CHANCE_DURATIONS: Record<string, number> = {
    common: 0.3,
    uncommon: 1.5,
};

/** Second Chance cooldown per tier (seconds). */
const SECOND_CHANCE_COOLDOWNS: Record<string, number> = {
    common: 60,
    uncommon: 30,
};

/**
 * Check if Second Chance should activate after taking damage. If the player
 * has the secondChance skill, it's off cooldown, and health has dropped to 0
 * or below, set health to 1 and grant invulnerability.
 * Returns true if second chance was triggered.
 */
export function trySecondChance(player: ServerPlayer, io: SocketIOServer): boolean {
    if (player.health > 0) return false;
    // Skills are disabled inside the PVP arena.
    if (player.inPvpArena) return false;
    const tier = player.skills?.secondChance;
    if (!tier) return false;
    const duration = SECOND_CHANCE_DURATIONS[tier];
    if (!duration) return false;

    // Check cooldown
    const now = Date.now();
    if (player.secondChanceCooldownUntil && now < player.secondChanceCooldownUntil) return false;

    player.health = 1;
    player.isInvulnerable = true;

    // Set cooldown
    const cooldownSec = SECOND_CHANCE_COOLDOWNS[tier] ?? 60;
    player.secondChanceCooldownUntil = now + cooldownSec * 1000;

    // Grant invulnerability for the skill's duration
    const durationMs = duration * 1000;
    setTimeout(() => {
        if (players[player.id]) {
            players[player.id].isInvulnerable = false;
            io.emit('playerInvulnerabilityEnded', { playerId: player.id });
        }
    }, durationMs);

    io.emit('playerDamaged', {
        playerId: player.id,
        health: player.health,
        maxHealth: player.maxHealth,
        isInvulnerable: true,
    });

    return true;
}

/**
 * Apply damage to a player from another player (PVP). Handles knockback,
 * invulnerability, second-chance, kill tracking, and gain transfer.
 */
function applyPvpDamage(
    attacker: ServerPlayer,
    victim: ServerPlayer,
    damage: number,
    io: SocketIOServer,
    savePlayerProgress: (player: ServerPlayer, userId: string) => void
): void {
    if (victim.isDead || victim.isInvulnerable) return;
    if (damage <= 0) return;

    const shieldAmount = getShieldAmount(victim);
    const damageToVictim = Math.max(0, damage - shieldAmount);
    const spongeDuration = getSpongeAbsorbDuration(victim);

    victim.lastDamagedByPlayerId = attacker.id;
    if (damageToVictim > 0 && spongeDuration > 0) {
        queueSpongeDamage(victim, damageToVictim, spongeDuration, { type: 'player', tier: 'common' }, attacker.id);
        victim.isInvulnerable = true;
        setTimeout(() => {
            if (players[victim.id]) {
                players[victim.id].isInvulnerable = false;
                io.emit('playerInvulnerabilityEnded', { playerId: victim.id });
            }
        }, 50);
    } else {
        victim.health -= damageToVictim;
        victim.lastDamageTime = Date.now();
    }

    const secondChanceTriggered = victim.health <= 0 && trySecondChance(victim, io);

    if (!secondChanceTriggered && !(damageToVictim > 0 && spongeDuration > 0)) {
        if (victim.health <= 0) {
            victim.killedBy = { type: 'player', tier: 'common' };
        }
        victim.isInvulnerable = true;
        setTimeout(() => {
            if (players[victim.id]) {
                players[victim.id].isInvulnerable = false;
                io.emit('playerInvulnerabilityEnded', { playerId: victim.id });
            }
        }, 50);
    }

    // Knockback: away from attacker
    const dx = victim.x - attacker.x;
    const dy = victim.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const knockDist = 25;
    const knockbackX = (dx / dist) * knockDist;
    const knockbackY = (dy / dist) * knockDist;
    victim.x += knockbackX;
    victim.y += knockbackY;

    io.emit('playerDamaged', {
        playerId: victim.id,
        health: victim.health,
        maxHealth: victim.maxHealth,
        isInvulnerable: victim.isInvulnerable,
        knockbackX,
        knockbackY
    });

    // Killed by attacker: transfer victim's PVP score and full PVP inventory,
    // mark dead now. While in the arena, `inventory` IS the PVP inventory.
    if (victim.health <= 0 && !secondChanceTriggered && !victim.isDead) {
        const transferredScore = victim.pvpScore || 0;
        attacker.pvpScore = (attacker.pvpScore || 0) + transferredScore;
        victim.pvpScore = 0;
        // Loot transfer is ARENA-ONLY. Inside the arena `inventory` is the
        // throwaway PVP inventory that enterPvpArena() swapped in, so handing it
        // to the killer and emptying it is the whole point. Outside it — the only
        // place a corrupted flower can kill — `inventory` is the player's real,
        // persisted one, and clearing it would delete their account's petals. A
        // corruption kill costs the victim exactly what a mob kill costs them.
        const victimGains = victim.inPvpArena ? (victim.inventory || []) : [];
        if (victimGains.length > 0 && attacker.inPvpArena) {
            if (!attacker.inventory) attacker.inventory = [];
            for (let i = 0; i < victimGains.length; i += 3) {
                const rarityId = victimGains[i];
                const itemId = victimGains[i + 1];
                const count = victimGains[i + 2];
                const rarity = ID_TO_RARITY.get(rarityId);
                const itemKey = ID_TO_ITEM_KEY.get(itemId);
                if (rarity && itemKey) {
                    addItem(attacker.inventory, rarity, itemKey, count);
                }
            }
            // A splitter half has no socket of its own — address the owner.
            io.to(getOriginalSocketId(attacker.id)).emit('inventoryUpdated', attacker.inventory);
        }
        if (victim.inPvpArena) {
            victim.inventory = [];
            io.to(getOriginalSocketId(victim.id)).emit('inventoryUpdated', victim.inventory);
        }

        // Mark dead immediately so passive-heal can't revive the victim before
        // their own update tick runs the standard death handler.
        victim.isDead = true;
        victim.angle = Math.random() * Math.PI * 2;
        despawnAllPlayerPets(victim.id, io);
        io.emit('playerDied', {
            playerId: victim.id,
            x: victim.x,
            y: victim.y,
            angle: victim.angle,
            killedBy: victim.killedBy
        });
        void savePlayerProgress;
    }
}


/**
 * Base 1 HP/sec plus every equipped petal's passiveHeal, scaled by the healing
 * skill. Only the primary loadout heals — slots 10+ are storage.
 */
function applyPassiveHealing(player: ServerPlayer, deltaTime: number): void {
    if (!player.isDead) {
        let totalPassiveHeal = 1.0 * deltaTime; // Base passive heal: 1 HP/sec
        const loadout = player.loadout || [];
        // Secondary loadout (slots 10+) is storage only — its petals don't heal.
        for (let i = 0; i < loadout.length && i < 10; i++) {
            const petal = loadout[i];
            if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                const petalStats = getPetalStats(petal.petalType, petal.rarity);
                if (petalStats && petalStats.passiveHeal) {
                    // Passive heal is already scaled by rarity (sqrt(3) per level) in generatePetalStats
                    // Now apply healing skill multiplier
                    const healingMultiplier = getHealingSkillMultiplier(player);

                    // Calculate heal per second, then multiply by deltaTime (in seconds)
                    const healPerSecond = petalStats.passiveHeal * healingMultiplier;
                    const healThisFrame = healPerSecond * deltaTime;
                    totalPassiveHeal += healThisFrame;
                }
            }
        }

        if (totalPassiveHeal > 0) {
            player.health = Math.min(player.maxHealth, player.health + totalPassiveHeal);
        }
    }
}

/**
 * The velocity the player is trying to reach this tick, from mouse or keyboard
 * input. Also caches the clamped speed multiplier on the player, which the
 * broadcast sends to the owning client for prediction.
 */
function computeTargetVelocity(player: ServerPlayer): { targetVelocityX: number; targetVelocityY: number } {
    let targetVelocityX = 0;
    let targetVelocityY = 0;

    // Effective speed multiplier (boosts + petal/effect modifiers). Cached on the
    // player so the broadcast can send it to the owning client for prediction.
    let speedFactor = player.speed_boost * getSpeedMultiplier(player);
    // Clamp the effective speed. getSpeedMultiplier multiplies every speed_boost effect
    // and petal modifier with no cap, so an apex/stacked boost (or a degenerate value)
    // can make this enormous — moving the player thousands of px in one tick and landing
    // them at an absurd coordinate that then hangs distance/raycast loops elsewhere (e.g.
    // bot wall-avoidance rayHitsWall). 8x is well above any intended boost.
    if (!(speedFactor >= 0)) speedFactor = 1;   // NaN / negative → 1
    if (speedFactor > 8) speedFactor = 8;
    player.speedFactor = speedFactor;

    if (player.inputs.useMouse &&
        player.inputs.mouseDirectionX !== undefined &&
        player.inputs.mouseDirectionY !== undefined &&
        player.inputs.mouseSpeedMultiplier !== undefined) {
        // Client has already calculated the direction and speed multiplier
        // Server just needs to apply MAX_SPEED and the effective speed factor
        // mouseSpeedMultiplier is a client-supplied fraction (normally 0..1); clamp it so
        // a malformed/huge value can't bypass the speedFactor cap above. NaN → 0 (no move).
        const mouseMult = Math.min(1.5, Math.max(0, player.inputs.mouseSpeedMultiplier)) || 0;
        const speed = MAX_SPEED * speedFactor * mouseMult;
        targetVelocityX = player.inputs.mouseDirectionX * speed;
        targetVelocityY = player.inputs.mouseDirectionY * speed;
        player.angle = Math.atan2(player.inputs.mouseDirectionY, player.inputs.mouseDirectionX);
    } else if (player.inputs.keys) {
        if (player.inputs.keys.includes('ArrowLeft') || player.inputs.keys.includes('a')) targetVelocityX -= 1;
        if (player.inputs.keys.includes('ArrowRight') || player.inputs.keys.includes('d')) targetVelocityX += 1;
        if (player.inputs.keys.includes('ArrowUp') || player.inputs.keys.includes('w')) targetVelocityY -= 1;
        if (player.inputs.keys.includes('ArrowDown') || player.inputs.keys.includes('s')) targetVelocityY += 1;

        if (targetVelocityX !== 0 && targetVelocityY !== 0) {
            const length = Math.sqrt(targetVelocityX * targetVelocityX + targetVelocityY * targetVelocityY);
            targetVelocityX /= length;
            targetVelocityY /= length;
        }

        const speed = MAX_SPEED * speedFactor;
        targetVelocityX *= speed;
        targetVelocityY *= speed;

        if (targetVelocityX !== 0 || targetVelocityY !== 0) {
            player.angle = Math.atan2(targetVelocityY, targetVelocityX);
        }
    }

    return { targetVelocityX, targetVelocityY };
}

/**
 * Expand the loadout into one entry per petal instance, assigning each an orbit
 * slot. Petals with `count` occupy `count` entries; `clumped` petals share a
 * single slot so their instances cluster instead of spreading round the ring.
 *
 * Returns the instances and the number of slots consumed (the ring divisor).
 */
function buildPetalInstances(
    player: ServerPlayer,
    io: SocketIOServer,
): { petalInstances: Array<{petal: any, instanceIndex: number, loadoutIndex: number, slotIndex: number}>; nextSlotIndex: number } {
    const petalInstances: Array<{petal: any, instanceIndex: number, loadoutIndex: number, slotIndex: number}> = [];
    let nextSlotIndex = 0;
    try {
        for (let i = 0; i < player.loadout.length; i++) {
            // Secondary loadout (slots 10+) is storage only — don't spawn petals
            if (i >= 10) continue;
            const petal = player.loadout[i];
            if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                const petalStats = getPetalStats(petal.petalType, petal.rarity);
                if (!petalStats) continue;

                const count = petalStats.count || 1; // Use count from stats, default to 1

                // Validate count is a valid number
                if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                    console.warn('Invalid petal count:', count, 'for', petal.petalType, petal.rarity);
                    continue;
                }

                // Clumped petals share a single orbit slot across all their instances
                const clumped = !!petalStats.clumped;
                const sharedSlot = nextSlotIndex;
                // Ensure per-instance health/cooldown arrays are sized to count
                ensureInstanceArrays(petal, petalStats);
                // Create multiple instances based on count
                for (let j = 0; j < count; j++) {
                    const slotIndex = clumped ? sharedSlot : nextSlotIndex;
                    if (!clumped) nextSlotIndex++;
                    petalInstances.push({ petal, instanceIndex: j, loadoutIndex: i, slotIndex });

                    // Execute petal actions immediately when spawned
                    if (petalStats.actions) {
                        const petalId = `${player.id}_${i}_${j}`;
                        const effectiveSize = (petal as any).customSize !== undefined ? (petal as any).customSize : petalStats.size;
                        const actionContext = {
                            player: player,
                            petalX: player.x, // Will be updated with actual position in game loop
                            petalY: player.y, // Will be updated with actual position in game loop
                            petalSize: effectiveSize * 40,
                            petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                            enemies: enemies,
                            io: io,
                            petalId: petalId,
                            loadoutIndex: i,
                            instanceIndex: j
                        };
                        executePetalActionsOnSpawn(petalStats.actions, actionContext);
                    }
                }
                if (clumped) nextSlotIndex++;
            }
        }
    } catch (error) {
        console.error('Error building petal instances:', error);
    }

    return { petalInstances, nextSlotIndex };
}

/**
 * Field-dropping pre-pass: when the player attacks or defends, every alive
 * pollen instance drops a puff and every alive web instance leaves a web, each
 * at its own orbit position. Health is zeroed in a second pass so non-clumped
 * multi-count petals (which share petal.health) don't have instance 0
 * short-circuit the others.
 *
 * Web follows gardn: attacking LAUNCHES it outward (the field lands
 * WEB_THROW_DISTANCE past the orbit), defending drops it where it sits. Either
 * way the petal is consumed and reloads normally.
 */
function dropFieldsOnExtension(opts: {
    player: ServerPlayer;
    io: SocketIOServer;
    petalInstances: Array<{petal: any, instanceIndex: number, loadoutIndex: number, slotIndex: number}>;
    playerOrbitPhase: number;
    angleStep: number;
    playerRangeModifier: number;
    defendOnlyBaseRadius: number;
    playerSizeMult: number;
}): void {
    const {
        player, io, petalInstances, playerOrbitPhase, angleStep,
        playerRangeModifier, defendOnlyBaseRadius, playerSizeMult,
    } = opts;

    const playerExt = player.inputs?.petalExtension || 1.0;
    if (playerExt !== 1.0) {
        const baseRadius = (60 + (PLAYER_SIZE / 2) * (playerSizeMult - 1)) * playerExt;
        const dropsToBreak: Array<{petal: any, instanceIndex: number, stats: any}> = [];
        for (let idx = 0; idx < petalInstances.length; idx++) {
            const {petal, instanceIndex, slotIndex} = petalInstances[idx];
            if (!petal) continue;
            const isPollen = petal.petalType === 'pollen';
            const stats = getPetalStats(petal.petalType, petal.rarity);
            if (!stats) continue;
            const isWeb = !!stats.webRadius;
            if (!isPollen && !isWeb) continue;
            if (isInstanceOnCooldown(petal, instanceIndex, stats)) continue;
            if (getInstanceHealth(petal, instanceIndex, stats) <= 0) continue;

            const rotationAngle = ((stats.speed ?? 1.0) * playerOrbitPhase * 2) % (Math.PI * 2);
            const totalAngle = stats.fixedDirection !== undefined
                ? slotIndex * angleStep
                : slotIndex * angleStep + rotationAngle;
            const range = (stats.range ?? 1.0) * playerRangeModifier;
            // Web is defendOnly, so it is sitting at its unextended orbit
            // radius when the throw starts — same rule the main petal loop
            // uses below.
            const orbitR = (stats.defendOnly ? defendOnlyBaseRadius : baseRadius) * range;
            let dropX = player.x + Math.cos(totalAngle) * orbitR;
            let dropY = player.y + Math.sin(totalAngle) * orbitR;

            const eSize = (petal as any).customSize !== undefined ? (petal as any).customSize : stats.size;
            const clumpCount = stats.count || 1;
            if (stats.clumped && clumpCount > 1) {
                const clumpSpacing = eSize * 40 * 0.5;
                const subAngle = (instanceIndex / clumpCount) * Math.PI * 2 + totalAngle;
                dropX += Math.cos(subAngle) * clumpSpacing;
                dropY += Math.sin(subAngle) * clumpSpacing;
            }

            if (isWeb) {
                // Throwing (attacking) flings it outward along the petal's
                // own bearing; defending plants it in place.
                if (playerExt > 1.0) {
                    dropX += Math.cos(totalAngle) * WEB_THROW_DISTANCE;
                    dropY += Math.sin(totalAngle) * WEB_THROW_DISTANCE;
                }
                spawnWebField(io, player, stats.webRadius!, petal.rarity ?? 'common', dropX, dropY);
            } else {
                spawnGroundPollen(io, player, stats, petal, dropX, dropY, 12 * eSize);
            }
            dropsToBreak.push({petal, instanceIndex, stats});
        }
        for (const d of dropsToBreak) {
            setInstanceHealth(d.petal, d.instanceIndex, d.stats, 0);
        }
    }
}

/**
 * Update player state (movement, collisions, etc.)
 * This is the main function that handles all player state updates
 */
export function updatePlayerState(
    player: ServerPlayer, 
    deltaTime: number,
    deps: PlayerStateDependencies
): void {
    if (!player || !player.inputs) {
        return;
    }

    // Don't update movement for dead players
    if (player.isDead) {
        return;
    }

    const { io, savePlayerProgress, transferPlayerToServer, currentServerConfig, currentServerPort, useHttps, database } = deps;

    // Update player effects
    updatePlayerEffects(player, deltaTime);
    updateSpongeDamage(player, deltaTime, io);

    applyPassiveHealing(player, deltaTime);

    // Apply raindrop aura damage to mobs around the player
    applyRaindropAuraDamage(player, deps);

    // ...and the reverse: a glitch flower's petal ring sweeping through the player.
    applyPetalRingDamage(player, io);

    const { targetVelocityX, targetVelocityY } = computeTargetVelocity(player);

    // Player movement physics (gardn friction + substepped wall/water collision).
    // Run through the SHARED stepPlayerMovement so the client's movement prediction
    // (game.ts) executes byte-for-byte the same physics — nothing to reconcile in
    // open movement. targetVelocity is the terminal velocity it converges to
    // (MAX_SPEED × speed_boost × multipliers, computed above).
    const effectivePlayerSize = PLAYER_SIZE * (player.sizeMultiplier ?? 1.0);
    const moved = stepPlayerMovement(
        { x: player.x, y: player.y, vx: player.velocityX, vy: player.velocityY },
        targetVelocityX, targetVelocityY, deltaTime, effectivePlayerSize
    );
    player.velocityX = moved.vx;
    player.velocityY = moved.vy;
    let newX = moved.x;
    let newY = moved.y;

    // Spatial-grid broad-phase: only test enemies whose center is within
    // (playerRadius + maxEnemyRadius). Pets and dead enemies are excluded by the grid.
    const _playerRadius = effectivePlayerSize / 2;
    const _candidates = queryEnemiesNear(newX, newY, _playerRadius, _enemyQueryBuffer);
    for (let _ci = 0; _ci < _candidates.length; _ci++) {
        const enemy = _candidates[_ci];
        const collisionInfo = checkPlayerEnemyCollision(newX, newY, effectivePlayerSize, enemy);

        if (collisionInfo.collided) {

            // Don't interact with dead players (corpses)
            if (!player.isDead) {
                // Calculate knockback direction
                const dx = enemy.x - newX;
                const dy = enemy.y - newY;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const normalizedDx = dx / distance;
                const normalizedDy = dy / distance;

                const knockbackDistance = 25;
                const knockbackX = -normalizedDx * knockbackDistance;
                const knockbackY = -normalizedDy * knockbackDistance;

                // Apply knockback to player position (always, even when invulnerable)
                newX -= normalizedDx * knockbackDistance;
                newY -= normalizedDy * knockbackDistance;

                // Glitch mobs infect on TOUCH, so this sits outside the damage
                // branch below: bouncing off one while invulnerable still counts.
                // Lasts until the player respawns (cleared in respawnPlayer).
                if (isGlitchInfectingType(enemy.type)) player.glitched = true;

                // Only apply damage when not invulnerable
                if (!player.isInvulnerable && enemy.type !== 'item_spawner') {
                    const shieldAmount = getShieldAmount(player);
                    const damageToPlayer = Math.max(0, enemy.damage - shieldAmount);
                    const spongeDuration = getSpongeAbsorbDuration(player);

                    if (damageToPlayer > 0 && spongeDuration > 0) {
                        queueSpongeDamage(player, damageToPlayer, spongeDuration, { type: enemy.type, tier: enemy.tier });
                        player.isInvulnerable = true;
                        setTimeout(() => {
                            if (players[player.id]) {
                                players[player.id].isInvulnerable = false;
                                io.emit('playerInvulnerabilityEnded', { playerId: player.id });
                            }
                        }, 50);
                    } else {
                        player.health -= damageToPlayer;
                        player.lastDamageTime = Date.now();

                        // Second Chance: if health dropped to 0 or below, try to save the player
                        const secondChanceTriggered = player.health <= 0 && trySecondChance(player, io);

                        if (!secondChanceTriggered) {
                            // Track which enemy dealt the killing blow
                            if (player.health <= 0) {
                                player.killedBy = { type: enemy.type, tier: enemy.tier };
                            }

                            player.isInvulnerable = true;
                            // Set invulnerability timer (50ms after taking damage)
                            setTimeout(() => {
                                if (players[player.id]) {
                                    players[player.id].isInvulnerable = false;
                                    // Notify client that invulnerability has ended
                                    io.emit('playerInvulnerabilityEnded', { playerId: player.id });
                                }
                            }, 50);
                        }
                    }

                    // Poisonous mobs (evil centipede) leave poison on contact.
                    // One stack: a fresh bite replaces whatever was ticking.
                    const mobStats = enemy._mobStats ?? getMobStats(enemy.type, enemy.tier);
                    if (mobStats?.poison && mobStats.poisonDuration) {
                        player.poisonDamage = mobStats.poison * 1000; // per-ms -> per-second
                        player.poisonUntil = Date.now() + mobStats.poisonDuration;
                        player.poisonSource = { type: enemy.type, tier: enemy.tier };
                    }
                }

                // Always emit knockback (and current health state)
                io.emit('playerDamaged', {
                    playerId: player.id,
                    health: player.health,
                    maxHealth: player.maxHealth,
                    isInvulnerable: player.isInvulnerable,
                    knockbackX: knockbackX,
                    knockbackY: knockbackY
                });
                
                // Track damage dealt by this player (always track, even if enemy is dead)
                trackDamage(enemy, player.id, player.damage);
                // if (enemy.health - player.damage <= 0) {
                //     console.log('[Server] About to kill enemy with petal', {
                //         enemyId: enemy.id,
                //         enemyType: enemy.type,
                //         currentHealth: enemy.health,
                //         damage: player.damage,
                //         playerId: player.id,
                //         hasDamageContributors: !!enemy.damageContributors,
                //         damageContributorsSize: enemy.damageContributors?.size || 0
                //     });
                // }
                
                // Skip further processing if enemy is already dead (being processed)
                if ((enemy as any).isDead) {
                    continue;
                }
                
                enemy.health = Math.max(0, enemy.health - player.damage);
                // Mark enemy for batched damage update at end of frame
                markEnemyDamaged(enemy);

                if (enemy.health <= 0 && !(enemy as any).isDead) {
                    const index = enemies.findIndex(e => e.id === enemy.id);
                    // Original gated the entire death sequence on the enemy still
                    // being in the array (it can already be gone if another damage
                    // source finished it this tick). killEnemy handles a -1 index
                    // by skipping just the splice, so preserve the gate here.
                    if (index !== -1) {
                        killEnemy(enemy, index, enemies, killCtxFromDeps(deps), {
                            killerPlayerId: player.id,
                            trackMobKillTiming: 'sync-snapshot',
                            requireNonEmptyContributors: true,
                        });
                    }
                }

                if (player.health <= 0) {
                    break;
                }
            }
            break;
        }
    }

    // Check for petal-enemy collisions
    if (player.loadout) {
        const { petalInstances, nextSlotIndex } = buildPetalInstances(player, io);

        const currentTime = Date.now();
        const petalExtension = player.inputs.petalExtension || 1.0;
        // Keep petals a constant distance from the flower edge: scale only the body-radius portion by sizeMultiplier.
        const playerSizeMult = player.sizeMultiplier ?? 1.0;
        const baseRadius = (60 + (PLAYER_SIZE / 2) * (playerSizeMult - 1)) * petalExtension;
        // Defend-only petals (rose) never fly out while attacking — their extension is
        // clamped at the neutral orbit, though they still pull in on defend (<1).
        const defendOnlyBaseRadius = (60 + (PLAYER_SIZE / 2) * (playerSizeMult - 1)) * Math.min(petalExtension, 1.0);
        const totalSlots = nextSlotIndex;
        const angleStep = totalSlots > 0 ? (Math.PI * 2) / totalSlots : 0;
        const playerModifiers = calculatePlayerModifiers(player);
        const playerRangeModifier = playerModifiers.range ?? 1.0;
        const playerRotationSpeedModifier = playerModifiers.rotationSpeed ?? 1.0;
        // Integrate the rotation-speed modifier over time so swapping a petal that
        // changes the modifier (Faster, Yin Yang) only bends the rate from this point
        // forward, rather than remapping `currentTime * newSpeed` and yanking every
        // petal to a different angle.
        player.petalOrbitPhase = (player.petalOrbitPhase ?? 0) + playerRotationSpeedModifier * deltaTime;
        const playerOrbitPhase = player.petalOrbitPhase;
        const playerPetalAttractionRadius = playerModifiers.petalAttractionRadius ?? 0;

        // Per-petal eligibility (mob within playerPetalAttractionRadius of the petal's
        // own orbit position) is checked inside the petal physics loop via a spatial-grid
        // broad-phase, so each petal only considers mobs actually near where *it* will
        // swing past. See the query at the attraction block below.

        // Initialize petal positions array
        player.petalPositions = [];

        dropFieldsOnExtension({
            player, io, petalInstances, playerOrbitPhase, angleStep,
            playerRangeModifier, defendOnlyBaseRadius, playerSizeMult,
        });

        // Resolved once per player-tick: the petal-vs-player pass below walks
        // every other player, so outside the PVP arena it must stay behind a
        // cheap "is anyone corrupted at all" check rather than run for free.
        const anyCorruptedPlayers = hasCorruptedPlayers();

        for (let idx = 0; idx < petalInstances.length; idx++) {
            const {petal, instanceIndex, loadoutIndex, slotIndex} = petalInstances[idx];

            if (!petal) {
                continue;
            }

            const instancePetalStats = getPetalStats(petal.petalType, petal.rarity);

            // Skip petals that are on cooldown (per-instance for clumped, slot-wide otherwise).
            // Restore backstop: breaking schedules a setTimeout to end the cooldown, but
            // that timer only lives in this process — a loadout that crosses a
            // cross-server portal (or is otherwise imported) arrives with
            // onCooldown: true and no timer, so without this the petal never comes
            // back (e.g. a rose consumed by its burst heal right before the portal).
            // Breaks stamp cooldownEndTime/instanceCooldownEndTime (absolute ms)
            // alongside the timer; once the stamp passes, restore here in the tick.
            // Double-firing with a live timer is safe: the timer's callback bails
            // when onCooldown is already false.
            //
            // A MISSING stamp must never mean "expired". Plenty of paths put a
            // petal on cooldown with a timer but no stamp (equipping a new petal,
            // the spawn-in reload, on_break actions, and — until this was fixed —
            // the collision break below), and treating undefined as expired
            // restored every one of them on the very next tick: petals broke and
            // came back ~50ms later at full health, with no reload at all. Adopt a
            // deadline instead, so an unstamped cooldown still runs its full
            // length and an imported one recovers a cooldown after arrival.
            if (isInstanceOnCooldown(petal, instanceIndex, instancePetalStats)) {
                if (hasIndependentInstances(instancePetalStats)) {
                    if (cooldownDeadlinePassed(petal, instanceIndex, instancePetalStats, currentTime)) {
                        restoreIndependentPetalInstance(
                            player.id, loadoutIndex, instanceIndex,
                            petal.petalType, petal.rarity, petal.maxHealth, io
                        );
                    }
                } else if (player.loadout[loadoutIndex] === petal &&
                           cooldownDeadlinePassed(petal, instanceIndex, instancePetalStats, currentTime)) {
                    // (identity check: with count > 1 the slot appears once per
                    // instance; only the first hit restores/emits.)
                    const restoredPetal = {
                        type: petal.type,
                        petalType: petal.petalType,
                        rarity: petal.rarity,
                        maxHealth: petal.maxHealth,
                        health: petal.maxHealth,
                        onCooldown: false
                    };
                    applyPetalHealthBonus(restoredPetal, player);
                    player.loadout[loadoutIndex] = restoredPetal;
                    io.emit('petalRestored', {
                        playerId: player.id,
                        slotIndex: loadoutIndex,
                        petal: player.loadout[loadoutIndex]
                    });
                }
                // Restored or not, this instance sits this tick out; a restored
                // petal starts orbiting on the next tick like a timer restore.
                continue;
            }

            // If this instance has 0 health but isn't on cooldown, break it immediately
            const currentInstanceHealth = getInstanceHealth(petal, instanceIndex, instancePetalStats);
            if (!currentInstanceHealth || currentInstanceHealth <= 0) {
                const petalStats = instancePetalStats;
                if (petalStats) {
                    // Execute petal actions before breaking
                    if (petalStats.actions) {
                        const baseRadius = 60 + (player.level * 2);
                        const breakAngleStep = totalSlots > 0 ? (Math.PI * 2) / totalSlots : 0;
                        const baseAngle = slotIndex * breakAngleStep;
                        const rotationAngle = ((petalStats.speed ?? 1.0) * playerOrbitPhase * 2) % (Math.PI * 2);
                        const totalAngle = baseAngle + rotationAngle;
                        const petalRange = (petalStats.range ?? 1.0) * playerRangeModifier;
                        const petalRadius = baseRadius * petalRange;
                        const petalX = player.x + Math.cos(totalAngle) * petalRadius;
                        const petalY = player.y + Math.sin(totalAngle) * petalRadius;
                        const effectiveSize = (petal as any).customSize !== undefined ? (petal as any).customSize : petalStats.size;
                        const petalSize = 40 * effectiveSize;

                        const actionContext = {
                            player: player,
                            petalX: petalX,
                            petalY: petalY,
                            petalSize: petalSize,
                            petalDamage: petalStats.damage,
                            enemies: enemies,
                            io: io
                        };
                        executePetalActions(petalStats.actions, actionContext, 'on_break');
                    }

                    const cooldownTime = getEffectiveCooldown(petal, petalStats);

                    if (hasIndependentInstances(petalStats)) {
                        // Per-instance: only this instance breaks; other instances keep working
                        ensureInstanceArrays(petal, petalStats);
                        petal.instanceOnCooldown![instanceIndex] = true;
                        // Absolute restore deadline alongside the setTimeout — the timer
                        // dies with this process (cross-server portal transfer), the
                        // stamp travels with the loadout. See the tick-loop backstop.
                        const cdCount = petalStats.count ?? 1;
                        if (!Array.isArray(petal.instanceCooldownEndTime) || petal.instanceCooldownEndTime.length !== cdCount) {
                            petal.instanceCooldownEndTime = new Array(cdCount).fill(undefined);
                        }
                        petal.instanceCooldownEndTime[instanceIndex] = currentTime + cooldownTime;
                        resetPetalPhysicsOnBreak(player.id, loadoutIndex, instanceIndex);
                        const snapshotPetalType = petal.petalType;
                        const snapshotRarity = petal.rarity;
                        const snapshotMaxHealth = petal.maxHealth;
                        const snapshotPlayerId = player.id;
                        setTimeout(() => {
                            restoreIndependentPetalInstance(
                                snapshotPlayerId,
                                loadoutIndex,
                                instanceIndex,
                                snapshotPetalType,
                                snapshotRarity,
                                snapshotMaxHealth,
                                io
                            );
                        }, cooldownTime);

                        // Slot shows cooldown only when every instance is on cooldown
                        if (petal.instanceOnCooldown!.every((c: boolean) => c)) {
                            petal.onCooldown = true;
                            // Tell clients too, or the loadout slot never draws its
                            // reload: nothing else pushes the slot-level flag out
                            // (petalRestored is the only other carrier, and that's
                            // the end of the reload, not the start).
                            io.emit('petalBroken', {
                                playerId: player.id,
                                slotIndex: loadoutIndex,
                                petalType: petal.petalType,
                                rarity: petal.rarity
                            });
                        }
                    } else {
                        // Non-clumped: whole slot breaks (legacy behavior)
                        petal.onCooldown = true;
                        // Absolute restore deadline — survives process handoff where the
                        // setTimeout below does not. See the tick-loop backstop.
                        petal.cooldownEndTime = currentTime + cooldownTime;
                        resetSlotPetalPhysicsOnBreak(player.id, loadoutIndex);
                        const originalPetal = {
                            type: petal.type,
                            petalType: petal.petalType,
                            rarity: petal.rarity,
                            maxHealth: petal.maxHealth
                        };
                        const snapshotPetalType = originalPetal.petalType;
                        const snapshotRarity = originalPetal.rarity;
                        setTimeout(() => {
                            const current = players[player.id]?.loadout?.[loadoutIndex];
                            if (!players[player.id] || !current || !current.onCooldown) return;
                            if (current.type !== 'petal' ||
                                current.petalType !== snapshotPetalType ||
                                current.rarity !== snapshotRarity) return;
                            {
                                const restoredPetal = {
                                    ...originalPetal,
                                    health: originalPetal.maxHealth,
                                    onCooldown: false
                                };
                                applyPetalHealthBonus(restoredPetal, player);
                                player.loadout[loadoutIndex] = restoredPetal;

                                io.emit('petalRestored', {
                                    playerId: player.id,
                                    slotIndex: loadoutIndex,
                                    petal: player.loadout[loadoutIndex]
                                });
                            }
                        }, cooldownTime);

                        io.emit('petalBroken', {
                            playerId: player.id,
                            slotIndex: loadoutIndex,
                            petalType: petal.petalType,
                            rarity: petal.rarity
                        });
                    }
                }
                continue;
            }

            const petalStats = instancePetalStats;
            if (!petalStats) continue;
            
            // Get effective size (custom size if set, otherwise base stats)
            const effectiveSize = (petal as any).customSize !== undefined ? (petal as any).customSize : petalStats.size;
            
            // Per-frame angular velocity (rad/ms) — used by the mob-orbit projection
            // boost below, which is integrated against this frame's deltaTime.
            const rotationSpeed = (petalStats.speed ?? 1.0) * playerRotationSpeedModifier * 0.002;
            const baseAngle = slotIndex * angleStep;
            // Angle is the per-petal speed times the integrated phase, *2 to preserve
            // the original 0.002 rad/ms × 1000 ms/s rate.
            const rotationAngle = ((petalStats.speed ?? 1.0) * playerOrbitPhase * 2) % (Math.PI * 2);
            // Fixed-direction petals don't orbit - they stay at a fixed relative position
            const totalAngle = petalStats.fixedDirection !== undefined ? baseAngle : baseAngle + rotationAngle;

            // Apply petal range multiplier and player range modifier to base radius
            const petalRange = (petalStats.range ?? 1.0) * playerRangeModifier;
            const petalRadius = (petalStats.defendOnly ? defendOnlyBaseRadius : baseRadius) * petalRange;

            // Calculate target orbit position (where petal should be without physics)
            let targetX = player.x + Math.cos(totalAngle) * petalRadius;
            let targetY = player.y + Math.sin(totalAngle) * petalRadius;

            // Clumped petals arrange instances in a small cluster around the slot center
            const clumpCount = petalStats.count || 1;
            if (petalStats.clumped && clumpCount > 1) {
                const clumpSpacing = effectiveSize * 40 * 0.5;
                const subAngle = (instanceIndex / clumpCount) * Math.PI * 2 + totalAngle;
                targetX += Math.cos(subAngle) * clumpSpacing;
                targetY += Math.sin(subAngle) * clumpSpacing;
            }
            
            // Petal ID is needed for actions, projectiles, and collisions regardless of physics
            const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
            
            // Skip physics for petals with range 0 (they should stay at player position)
            let petalX: number;
            let petalY: number;

            // Rose-style burst heal (rysteria_gardn): once the petal has been in orbit
            // past its charge time and the flower is below max health, it detaches,
            // homes to the flower, heals a burst and is consumed. Set inside the
            // physics branch (needs the petal's spawn time); consumed after the
            // position is final.
            let burstHealHoming = false;
            // Shell works the same way, but it flies home to lay a shield on the
            // flower rather than to heal it, and it waits for the current shield
            // to lapse instead of for missing health.
            let burstShieldHoming = false;

            if (petalStats.fixedDirection !== undefined) {
                // Fixed-direction petals stay directly on the player
                petalX = player.x;
                petalY = player.y;
            } else if (petalRange === 0 || petalStats.noPhysics) {
                // No physics for range 0 or noPhysics petals - snap to orbit position directly
                petalX = targetX;
                petalY = targetY;
            } else {
                // Get per-petal physics values (use defaults if not specified)
                const petalSpringForce = petalStats.springForce ?? SPRING_FORCE;
                const petalDamping = petalStats.damping ?? DAMPING;
                const petalSpawnSmoothTime = petalStats.spawnSmoothTime ?? SPAWN_SMOOTH_TIME;
                
                // Get or initialize petal physics state
                let physicsState = petalPhysicsStates.get(petalId);
                if (!physicsState) {
                    // New or reloaded petal: start at the flower's center and glide
                    // out into orbit (overshoot-free, see glideUntil).
                    physicsState = {
                        x: player.x,
                        y: player.y,
                        vx: 0,
                        vy: 0,
                        spawnTime: currentTime,
                        glideUntil: currentTime + PETAL_SPAWN_GLIDE_MS
                    };
                    petalPhysicsStates.set(petalId, physicsState);
                }
                
                // Calculate smooth initialization factor (ramp up forces over spawn smooth time)
                const timeSinceSpawn = physicsState.spawnTime ? currentTime - physicsState.spawnTime : petalSpawnSmoothTime;
                const smoothFactor = Math.min(1.0, timeSinceSpawn / petalSpawnSmoothTime);
                
                // Pick the closest mob within playerPetalAttractionRadius of this petal's
                // orbit position (targetX/Y). Measuring eligibility from the orbit point
                // — not the petal's current physics-displaced position or the player —
                // means "30 px attraction" reliably lights up when a mob is 30 px from
                // where the petal will naturally swing past.
                burstHealHoming = !!petalStats.burstHeal &&
                    player.health < player.maxHealth &&
                    timeSinceSpawn >= (petalStats.burstHealChargeMs ?? 1000);
                burstShieldHoming = !!petalStats.burstShield &&
                    getShieldAmount(player) <= 0 &&
                    timeSinceSpawn >= (petalStats.burstHealChargeMs ?? 1000);

                let closestEnemy: typeof enemies[number] | null = null;
                let closestDistanceSq = Infinity;
                if (playerPetalAttractionRadius > 0 && !burstHealHoming && !burstShieldHoming) {
                    // Broad-phase around this petal's own orbit point. The eligibility test
                    // below is `dist <= attractionRadius + thatMob's radius`, so querying
                    // `attractionRadius + largest mob radius` returns a strict superset of
                    // the eligible mobs — same closest-mob result as scanning every enemy,
                    // but not O(mobs) per petal. That mattered: a full Light loadout is ~70
                    // petal instances, and with a populated maze `enemies` is ~1400 long, so
                    // the old scan cost ~100k iterations per player per tick.
                    // The grid already excludes pets and mobs that were dead at rebuild.
                    const attractionCandidates = queryEnemiesNear(
                        targetX,
                        targetY,
                        playerPetalAttractionRadius,
                        _attractionQueryBuffer
                    );
                    for (let ai = 0; ai < attractionCandidates.length; ai++) {
                        const enemy = attractionCandidates[ai];
                        // A mob killed earlier this tick (by another petal in this same
                        // loop) is spliced out of `enemies` but is still in the grid.
                        if (enemy.isDead) continue;
                        // _radius is cached on every grid member by rebuildEnemyGrid.
                        const candidateEnemyRadius = enemy._radius ?? (ENEMY_SIZE / 2);
                        const dx = enemy.x - targetX;
                        const dy = enemy.y - targetY;
                        const distSq = dx * dx + dy * dy;
                        const maxDist = playerPetalAttractionRadius + candidateEnemyRadius;
                        if (distSq <= maxDist * maxDist && distSq < closestDistanceSq) {
                            closestDistanceSq = distSq;
                            closestEnemy = enemy;
                        }
                    }
                }

                // The spring target is normally the petal's player-orbit position. When
                // attracted, it gets redirected to the closest point on the mob's hitbox edge
                // (slightly inside, so contact is continuous) along the direction of the
                // natural orbit position from the mob. As the player's orbit rotates around
                // the player, that projection rotates around the mob — so the petal spinning
                // around the mob falls out as a side-effect of the existing rotation, no
                // dedicated angular-motion code needed.
                let effectiveTargetX = targetX;
                let effectiveTargetY = targetY;

                if (closestEnemy) {
                    physicsState.attractedEnemyId = closestEnemy.id;
                } else if (physicsState.attractedEnemyId !== undefined) {
                    // Attraction just released. If it released because the mob died
                    // (rather than the orbit sweeping out of range), glide back into
                    // orbit — the raw spring covers most of the gap in a couple of
                    // ticks, which reads as the whole orbit jumping.
                    const releasedFrom = physicsState.attractedEnemyId;
                    physicsState.attractedEnemyId = undefined;
                    if (!enemies.some(e => e.id === releasedFrom)) {
                        physicsState.glideUntil = currentTime + PETAL_RELEASE_GLIDE_MS;
                    }
                }

                if (closestEnemy) {
                    const closestMobStats = getMobStats(closestEnemy.type, closestEnemy.tier);
                    const closestEnemyRadius = closestMobStats ? (closestMobStats.size * 40) / 2 : ENEMY_SIZE / 2;
                    const dx = targetX - closestEnemy.x;
                    const dy = targetY - closestEnemy.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    const mobOrbitRadius = closestEnemyRadius * 0.85;
                    // Most of the angular motion comes for free from the player orbit moving
                    // the projection point around the mob's edge each frame; this small extra
                    // boost on top makes the spin feel snappier without overriding the
                    // side-effect rotation. Tunable: bigger multiplier = faster whip.
                    const MOB_ORBIT_SPIN_BOOST = 2;
                    const baseProjectionAngle = len > 0 ? Math.atan2(dy, dx) : totalAngle;
                    const projectionAngle = baseProjectionAngle + rotationSpeed * MOB_ORBIT_SPIN_BOOST * (deltaTime * 1000);
                    effectiveTargetX = closestEnemy.x + Math.cos(projectionAngle) * mobOrbitRadius;
                    effectiveTargetY = closestEnemy.y + Math.sin(projectionAngle) * mobOrbitRadius;
                }

                if (burstHealHoming || burstShieldHoming) {
                    // Home straight to the flower. Keeping the glide window open every
                    // tick uses the overshoot-free first-order approach instead of the
                    // spring, so the petal flies in cleanly and tracks a moving player.
                    effectiveTargetX = player.x;
                    effectiveTargetY = player.y;
                    physicsState.glideUntil = currentTime + PETAL_RELEASE_GLIDE_MS;
                }

                if (physicsState.glideUntil !== undefined && currentTime < physicsState.glideUntil) {
                    // Transit glide (spawn fly-out / post-kill release): first-order
                    // approach toward the live target. vx/vy track the glide motion
                    // so the spring takes over seamlessly when the window ends.
                    const approach = 1 - Math.exp(-PETAL_GLIDE_RATE * deltaTime);
                    const glideX = physicsState.x + (effectiveTargetX - physicsState.x) * approach;
                    const glideY = physicsState.y + (effectiveTargetY - physicsState.y) * approach;
                    physicsState.vx = (glideX - physicsState.x) / deltaTime;
                    physicsState.vy = (glideY - physicsState.y) / deltaTime;
                    physicsState.x = glideX;
                    physicsState.y = glideY;
                } else {
                    if (physicsState.glideUntil !== undefined) physicsState.glideUntil = undefined;

                    // This semi-implicit Euler spring is unconditionally unstable once
                    // dt exceeds sqrt(2*(1+damping)/(damping*springForce)) — ~0.089s at
                    // the defaults above — because the tracked error's growth factor per
                    // tick passes -( 1+damping) beyond that point and blows up exponentially,
                    // with no restoring force able to bring it back (this is how a petal
                    // "flies off and never returns"). The server's own tick-time smoothing
                    // already allows dt up to 0.1s under load (server.ts MAX_DELTA), which
                    // is past that threshold, so substep the integration to keep each
                    // slice's dt safely below it regardless of real tick time.
                    const SPRING_SUBSTEP_DT = 0.05;
                    const substeps = Math.min(4, Math.max(1, Math.ceil(deltaTime / SPRING_SUBSTEP_DT)));
                    const subDt = deltaTime / substeps;

                    for (let sub = 0; sub < substeps; sub++) {
                        const springDx = effectiveTargetX - physicsState.x;
                        const springDy = effectiveTargetY - physicsState.y;
                        const springDistance = Math.sqrt(springDx * springDx + springDy * springDy);

                        let springFx = 0;
                        let springFy = 0;

                        if (springDistance > 0) {
                            const normalizedSpringDx = springDx / springDistance;
                            const normalizedSpringDy = springDy / springDistance;

                            // Spring force is proportional to distance from target
                            // Apply smooth factor to spring force (gradually increase after spawn)
                            springFx = normalizedSpringDx * petalSpringForce * springDistance * subDt * smoothFactor;
                            springFy = normalizedSpringDy * petalSpringForce * springDistance * subDt * smoothFactor;
                        }

                        physicsState.vx += springFx;
                        physicsState.vy += springFy;

                        physicsState.vx *= petalDamping;
                        physicsState.vy *= petalDamping;

                        physicsState.x += physicsState.vx * subDt;
                        physicsState.y += physicsState.vy * subDt;
                    }

                    // Defense in depth: if the integrator ever ends up non-finite anyway,
                    // self-heal to the target instead of leaving the petal stuck away forever.
                    if (!Number.isFinite(physicsState.x) || !Number.isFinite(physicsState.y)) {
                        physicsState.x = effectiveTargetX;
                        physicsState.y = effectiveTargetY;
                        physicsState.vx = 0;
                        physicsState.vy = 0;
                    }
                }
                
                // Use physics-based position
                petalX = physicsState.x;
                petalY = physicsState.y;
            }

            // Petals flagged wallCollide can't orbit through walls/water — push them
            // back out of any solid tile. Persist the resolved position (and kill the
            // velocity into the wall) into the physics state so the orbit spring
            // doesn't keep driving them back inside on the next frame.
            if (petalStats.wallCollide) {
                const resolved = checkPlayerWallCollisions(petalX, petalY, 40 * effectiveSize);
                if (resolved.collided) {
                    petalX = resolved.x;
                    petalY = resolved.y;
                    const ps = petalPhysicsStates.get(petalId);
                    if (ps) {
                        ps.x = petalX;
                        ps.y = petalY;
                        ps.vx = 0;
                        ps.vy = 0;
                    }
                }
            }

            // Update petal position in action context
            updatePetalPosition(petalId, petalX, petalY);

            // Store petal position for client synchronization
            player.petalPositions!.push({
                loadoutIndex,
                instanceIndex,
                x: petalX,
                y: petalY,
                noPhysics: petalStats.noPhysics || false
            });

            // Burst-heal delivery: when the homing petal touches the flower it heals
            // and is consumed — zeroing the instance sends it through the normal
            // break/cooldown/reload flow on the next tick.
            if (burstHealHoming || burstShieldHoming) {
                const healDx = player.x - petalX;
                const healDy = player.y - petalY;
                const contactDist = effectivePlayerSize / 2;
                if (healDx * healDx + healDy * healDy <= contactDist * contactDist) {
                    if (burstHealHoming) {
                        player.health = Math.min(player.maxHealth,
                            player.health + petalStats.burstHeal! * getHealingSkillMultiplier(player));
                    } else {
                        grantShield(player, petalStats.burstShield!, BURST_SHIELD_DURATION_MS);
                    }
                    setInstanceHealth(petal, instanceIndex, petalStats, 0);
                    continue;
                }
            }

            // Bubble pops in defensive position and propels the player away from where it was.
            // Boost magnitude scales up with rarity; the slot's cooldown also scales down (handled in the break flow).
            // Note: push newX/newY (the post-movement position that will be written back to player at the end
            // of updatePlayerState) — modifying player.x/player.y directly here gets clobbered.
            if (petal.petalType === 'bubble' && petalExtension < 1.0) {
                const dx = player.x - petalX;
                const dy = player.y - petalY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    const rarityIdx = Math.max(0, getRarityIndex(petal.rarity ?? 'common'));
                    const boostMagnitude = 60 * (1 + rarityIdx * 0.6);
                    // Substep so a high-rarity boost can't tunnel through walls; on each blocked
                    // step, reflect the remaining boost across the wall normal so the player bounces.
                    let vx = (dx / dist) * boostMagnitude;
                    let vy = (dy / dist) * boostMagnitude;
                    const BOUNCE_DAMPING = 0.7;
                    let appliedX = 0;
                    let appliedY = 0;
                    let remaining = boostMagnitude;
                    let safetyIterations = 32;
                    while (remaining > 0.5 && safetyIterations-- > 0) {
                        const stepLen = Math.min(effectivePlayerSize / 2, remaining);
                        const speed = Math.sqrt(vx * vx + vy * vy) || 1;
                        const stepX = (vx / speed) * stepLen;
                        const stepY = (vy / speed) * stepLen;
                        const trialX = newX + stepX;
                        const trialY = newY + stepY;
                        const wallCollision = checkPlayerWallCollisions(trialX, trialY, effectivePlayerSize);
                        const dxStep = wallCollision.x - newX;
                        const dyStep = wallCollision.y - newY;
                        newX = wallCollision.x;
                        newY = wallCollision.y;
                        appliedX += dxStep;
                        appliedY += dyStep;
                        remaining -= stepLen;
                        // If the resolver clipped this step, infer the wall normal from which axis
                        // shrank the most and reflect the corresponding velocity component.
                        const clipX = stepX - dxStep;
                        const clipY = stepY - dyStep;
                        const blockedX = Math.abs(clipX) > Math.abs(stepX) * 0.5;
                        const blockedY = Math.abs(clipY) > Math.abs(stepY) * 0.5;
                        if (blockedX || blockedY) {
                            if (blockedX) vx = -vx * BOUNCE_DAMPING;
                            if (blockedY) vy = -vy * BOUNCE_DAMPING;
                            // If both axes blocked (wedged in a corner), bail rather than spin.
                            if (blockedX && blockedY) break;
                        }
                    }
                    io.emit('playerDamaged', {
                        playerId: player.id,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        isInvulnerable: player.isInvulnerable,
                        knockbackX: appliedX,
                        knockbackY: appliedY,
                        damageDealt: 0
                    });
                }
                setInstanceHealth(petal, instanceIndex, instancePetalStats!, 0);
                continue;
            }

            // Check if petal can shoot projectiles (only when extended)
            if (petalExtension > 1.0 && petalStats.projectile) {
                const projectileConfig = petalStats.projectile;
                const lastShotTime = petalLastProjectileTime.get(petalId) || 0;
                const cooldown = petalStats.cooldown || 2000;

                // Check if cooldown has passed
                if (currentTime - lastShotTime >= cooldown) {
                    // Calculate projectile angle - shoot in the direction the petal is facing (tangent to rotation)
                    // The petal is at totalAngle, so the projectile should go in that direction
                    let projectileAngle = totalAngle;

                    // Guided shots re-aim at the nearest mob inside a cone around
                    // the firing direction (gardn find_nearest_enemy_within_angle).
                    // Done once, at launch — the shot still flies straight, so the
                    // client's dead-reckoning stays exact.
                    if (projectileConfig.seekRange) {
                        const cone = projectileConfig.seekCone ?? Math.PI / 4;
                        const seekCandidates = queryEnemiesNear(petalX, petalY, projectileConfig.seekRange, _seekQueryBuffer);
                        let bestDistSq = Infinity;
                        let bestAngle: number | null = null;
                        for (let _si = 0; _si < seekCandidates.length; _si++) {
                            const candidate = seekCandidates[_si];
                            if (candidate.isDead) continue;
                            const sdx = candidate.x - petalX;
                            const sdy = candidate.y - petalY;
                            const sDistSq = sdx * sdx + sdy * sdy;
                            if (sDistSq > projectileConfig.seekRange * projectileConfig.seekRange) continue;
                            if (sDistSq >= bestDistSq) continue;
                            let delta = Math.atan2(sdy, sdx) - projectileAngle;
                            while (delta > Math.PI) delta -= Math.PI * 2;
                            while (delta < -Math.PI) delta += Math.PI * 2;
                            if (Math.abs(delta) > cone) continue;
                            bestDistSq = sDistSq;
                            bestAngle = Math.atan2(sdy, sdx);
                        }
                        if (bestAngle !== null) projectileAngle = bestAngle;
                    }

                    const projectileSpeed = projectileConfig.speed || 200; // pixels per second
                    const spreadAngle = projectileConfig.spreadAngle || 0.2; // radians
                    const projectileCount = projectileConfig.count || 1;

                    // Create projectiles
                    for (let i = 0; i < projectileCount; i++) {
                        // Calculate spread angle for multiple projectiles
                        let finalAngle = projectileAngle;
                        if (projectileCount > 1) {
                            const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
                            finalAngle = projectileAngle + spreadOffset;
                        }

                        // NOTE: a player projectile does NOT get the rarity
                        // distance/size scaling a mob volley gets (see
                        // ecs/systems/projectileFiring.ts) — it inherits the
                        // petal's own size and the config's flat distance.
                        deps.projectiles.spawn({
                            playerId: player.id,
                            x: petalX,
                            y: petalY,
                            angle: finalAngle,
                            speed: projectileSpeed / 1000, // Convert to pixels per millisecond
                            maxDistance: projectileConfig.distance,
                            petalType: petal.petalType,
                            petalRarity: petal.rarity,
                            damage: petalStats.damage,
                            size: effectiveSize,
                            health: petalStats.health,
                            now: currentTime,
                        });
                    }

                    // Update last shot time for this petal instance
                    // delete-then-set so the key moves to the end of insertion order;
                    // server.ts evicts from the front of the map as an O(1) LRU.
                    petalLastProjectileTime.delete(petalId);
                    petalLastProjectileTime.set(petalId, currentTime);
                }
            }

            // Uranium: a damage pulse over everything in a wide radius, on its own
            // timer. Reuses petalLastRadiationTime (an LRU map like the projectile
            // one) so each petal instance pulses independently of its neighbours.
            if (petalStats.radiation) {
                const lastPulse = petalLastRadiationTime.get(petalId) || 0;
                if (currentTime - lastPulse >= petalStats.radiation.intervalMs) {
                    petalLastRadiationTime.delete(petalId);
                    petalLastRadiationTime.set(petalId, currentTime);

                    const pulseRadius = petalStats.radiation.radius;
                    const pulseDamage =
                        petalStats.damage * (petalStats.radiation.damageFactor ?? 1) * getDamageMultiplier(player);
                    const irradiated = queryEnemiesNear(petalX, petalY, pulseRadius, _radiationQueryBuffer);
                    for (let _ri = 0; _ri < irradiated.length; _ri++) {
                        const target = irradiated[_ri];
                        if (target.isDead) continue;
                        const rdx = target.x - petalX;
                        const rdy = target.y - petalY;
                        const reach = pulseRadius + (target._radius ?? ENEMY_SIZE / 2);
                        if (rdx * rdx + rdy * rdy > reach * reach) continue;

                        trackDamage(target, player.id, pulseDamage);
                        target.health = Math.max(0, target.health - pulseDamage);
                        markEnemyDamaged(target);

                        if (target.health <= 0 && !target.isDead) {
                            const index = enemies.findIndex(e => e.id === target.id);
                            if (index !== -1) {
                                killEnemy(target, index, enemies, killCtxFromDeps(deps), {
                                    killerPlayerId: player.id,
                                    trackMobKillTiming: 'sync-snapshot',
                                    requireNonEmptyContributors: true,
                                });
                            }
                        }
                    }
                }
            }

            // Check collision with enemies — broad-phase via spatial grid (built
            // once per tick in start_loop), then precise per-enemy distance test.
            // Pets and dead enemies are excluded by the grid.
            const _petalSize = 40 * effectiveSize;
            const _petalRadius = _petalSize / 2;
            const candidates = queryEnemiesNear(petalX, petalY, _petalRadius, _enemyQueryBuffer);
            for (let _ei = 0; _ei < candidates.length; _ei++) {
                const enemy = candidates[_ei];

                // Cached on the enemy by rebuildEnemyGrid — type/tier never change after spawn.
                const mobStats = enemy._mobStats || getMobStats(enemy.type, enemy.tier);
                const enemyRadius = enemy._radius ?? (ENEMY_SIZE / 2);
                const petalSize = _petalSize;
                const petalRadius = _petalRadius;

                const dx = enemy.x - petalX;
                const dy = enemy.y - petalY;
                const distSq = dx * dx + dy * dy;
                const minDistance = enemyRadius + petalRadius;
                const minDistSq = minDistance * minDistance;

                if (distSq < minDistSq && distSq > 0) {
                    // Check if petal has a damage cooldown and is still on cooldown
                    const damageCooldownKey = `${player.id}_${loadoutIndex}_${instanceIndex}`;
                    if (petalStats.damageCooldown) {
                        const lastDmgTime = petalLastDamageTime.get(damageCooldownKey) || 0;
                        if (currentTime - lastDmgTime < petalStats.damageCooldown) {
                            continue; // Skip damage, petal stays active
                        }
                    }

                    // Petal hits enemy - deal damage to both
                    const damageMultiplier = getDamageMultiplier(player);
                    const finalDamage = petalStats.damage * damageMultiplier;

                    // console.log('[Server] Petal collision detected', {
                    //     enemyId: enemy.id,
                    //     enemyType: enemy.type,
                    //     enemyHealth: enemy.health,
                    //     finalDamage,
                    //     playerId: player.id,
                    //     petalType: petal.petalType
                    // });

                    // Track damage dealt by this player (always track, even if enemy is dead)
                    trackDamage(enemy, player.id, finalDamage);

                    // Skip further processing if enemy is already dead (being processed)
                    if ((enemy as any).isDead) {
                        continue;
                    }

                    enemy.health = Math.max(0, enemy.health - finalDamage);

                    // Petals with damageCooldown don't take damage from mobs (they can't break)
                    if (petalStats.damageCooldown) {
                        petalLastDamageTime.set(damageCooldownKey, currentTime);
                    } else {
                        const mobDamage = mobStats ? mobStats.damage : 1; // Petal loses health equal to mob damage, fallback to 1 if mobStats is null
                        const prevInstanceHealth = getInstanceHealth(petal, instanceIndex, petalStats);
                        setInstanceHealth(petal, instanceIndex, petalStats, Math.max(0, prevInstanceHealth - mobDamage));
                    }

                    // Apply poison effect if the petal has poison
                    if (petalStats.poison && petalStats.poison > 0 && petalStats.poisonDuration && petalStats.poisonDuration > 0) {
                        if (!enemy.poisonEffects) {
                            enemy.poisonEffects = [];
                        }
                        
                        // Add or refresh poison effect
                        const currentTime = Date.now();
                        const endTime = currentTime + petalStats.poisonDuration;
                        
                        // Check if there's already a poison effect from this player
                        const existingPoisonIndex = enemy.poisonEffects.findIndex(p => p.playerId === player.id);
                        if (existingPoisonIndex >= 0) {
                            // gardn's rule (Damage.cc): a fresh bite only takes over
                            // when it would outlast what is already ticking —
                            // `if (defender.poison_ticks < attacker.poison_damage.time * TPS)`.
                            // Without the guard, a short weak poison stomps a long
                            // strong one: pincer (1s) landing after iris (6s) used to
                            // wipe the iris poison and leave 1s of 5dps in its place.
                            if (enemy.poisonEffects[existingPoisonIndex].endTime < endTime) {
                                enemy.poisonEffects[existingPoisonIndex] = {
                                    damage: petalStats.poison,
                                    endTime: endTime,
                                    playerId: player.id
                                };
                            }
                        } else {
                            // Add a new poison effect
                            enemy.poisonEffects.push({
                                damage: petalStats.poison,
                                endTime: endTime,
                                playerId: player.id
                            });
                        }
                    }

                    // Sticky petals (honey / pincer) slow what they touch. How
                    // much of it lands depends on the petal's rarity against the
                    // mob's — see stallPower.
                    if (petalStats.slowFactor && petalStats.slowDuration) {
                        applySlow(enemy, petalStats.slowFactor, currentTime + petalStats.slowDuration,
                                  petal.rarity ?? 'common');
                    }

                    // Apply knockback to enemy
                    const knockbackForce = petalStats.knockback || 0;
                    if (knockbackForce > 0) {
                        // Calculate knockback direction from petal to enemy
                        const dx = enemy.x - petalX;
                        const dy = enemy.y - petalY;
                        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                        const normalizedDx = dx / distance;
                        const normalizedDy = dy / distance;

                        // Apply knockback to enemy, accounting for mass (heavier mobs are harder to knock back)
                        // Mass is already calculated from size (which includes rarity), so higher rarity = more mass
                        const mobMass = mobStats ? mobStats.mass : 1.0; // Default mass of 1.0 if mobStats is null
                        const effectiveKnockback = knockbackForce / mobMass; // Divide by mass so heavier mobs resist knockback more
                        enemy.knockbackX = normalizedDx * effectiveKnockback;
                        enemy.knockbackY = normalizedDy * effectiveKnockback;
                    }

                    // Mark enemy for batched damage update at end of frame
                    markEnemyDamaged(enemy);

                    // The flower petal cracks open on the mob it touches, whatever
                    // the mob's damage was: zeroing this instance's health makes the
                    // next tick's petal loop run the normal break + reload path, so
                    // it comes back on its cooldown like any other spent petal. The
                    // squad spawns at the petal, not the player, so it lands on the
                    // mob that broke it. Pass the petal's own rarity through — a
                    // rarer flower opens onto rarer glitch flowers.
                    if (petal.petalType === 'flower') {
                        setInstanceHealth(petal, instanceIndex, petalStats, 0);
                        if (Math.random() < FLOWER_PETAL_CORRUPT_CHANCE) {
                            corruptFlowerAndSplitHalf(player);
                        } else {
                            // spawnPet's apex rule turns one summon into three unique
                            // pets, which would make an apex flower open onto nine.
                            // Clamp so the squad is always the three this petal promises.
                            const petRarity = (petal.rarity ?? 'common') === 'apex' ? 'unique' : (petal.rarity ?? 'common');
                            spawnPet(FLOWER_PETAL_PET_TYPE, petRarity, petalX, petalY, player.id, io, false, FLOWER_PETAL_PET_COUNT);
                        }
                        // Broken petals don't hit anything else this tick.
                        break;
                    }

                    // Check if item spawner was hit and has 1% chance to spawn a random petal
                    if (enemy.type === 'item_spawner' && Math.random() < 0.01) {
                        // Get all petal types and filter out admin petals
                        const allPetalTypes = getAllPetalTypes();
                        const nonAdminPetalTypes = allPetalTypes.filter(petalType => {
                            // Check if the petal is an admin petal by checking any rarity
                            const commonStats = getPetalStats(petalType, 'common');
                            return !commonStats?.isAdminPetal;
                        });

                        if (nonAdminPetalTypes.length > 0) {
                            // Pick a random petal type
                            const randomPetalType = nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)];
                            
                            // Pick a random rarity with weighted probabilities (rarer items are much rarer)
                            // Weighted distribution: common is most common, rarer items are exponentially rarer
                            const rarityWeights: { [key: string]: number } = {
                                'common': 30.0,      // 50%
                                'uncommon': 10.0,    // 20%
                                'rare': 10.0,        // 12%
                                'epic': 5.0,         // 8%
                                'legendary': 5.0,    // 5%
                                'mythic': 5.0,       // 3%
                                'ultra': 5.0,        // 1.5%
                                'super': 5.0,        // 0.4%
                                'unique': 0.05        // 0.1%
                            };
                            
                            // Calculate total weight
                            const totalWeight = RARITY_LEVELS.reduce((sum, rarity) => sum + (rarityWeights[rarity] || 0), 0);
                            
                            // Pick a rarity based on weighted probability
                            let randomRarity: Rarity = 'common'; // Default fallback
                            const random = Math.random() * totalWeight;
                            let cumulativeWeight = 0;
                            
                            for (const rarity of RARITY_LEVELS) {
                                cumulativeWeight += rarityWeights[rarity] || 0;
                                if (random <= cumulativeWeight) {
                                    randomRarity = rarity;
                                    break;
                                }
                            }
                            
                            // Calculate spawner's hitbox radius to ensure items spawn outside it
                            const spawnerMobStats = getMobStats(enemy.type, enemy.tier);
                            const spawnerSize = spawnerMobStats ? spawnerMobStats.size * 40 : ENEMY_SIZE;
                            const spawnerRadius = spawnerSize / 2;
                            const minSpawnDistance = spawnerRadius + 30; // Spawn at least 30px outside the hitbox
                            const maxSpawnDistance = spawnerRadius + 100; // Spawn up to 100px away
                            
                            // Spawn item at a random angle and distance outside the spawner's hitbox
                            const spawnAngle = Math.random() * Math.PI * 2;
                            const spawnDistance = minSpawnDistance + Math.random() * (maxSpawnDistance - minSpawnDistance);
                            const offsetX = Math.cos(spawnAngle) * spawnDistance;
                            const offsetY = Math.sin(spawnAngle) * spawnDistance;
                            
                            const itemId = Math.random().toString(36).substr(2, 9);
                            const spawnTime = Date.now();
                            
                            // Determine eligible players - include split player IDs if player is split
                            let eligiblePlayersForItem = [player.id];
                            const { splitPlayers } = require('../petal_actions');
                            const originalId = player.id.replace('_split2', '').replace('_split1', '');
                            const splitState = splitPlayers.get(originalId);
                            if (splitState) {
                                // Player is split - include both split player IDs
                                eligiblePlayersForItem = [splitState.player1.id, splitState.player2.id, originalId];
                            }
                            
                            const newItem: WorldItem = {
                                id: itemId,
                                type: 'petal',
                                x: enemy.x + offsetX,
                                y: enemy.y + offsetY,
                                rarity: randomRarity,
                                petalType: randomPetalType,
                                eligiblePlayers: eligiblePlayersForItem, // Include all split player IDs
                                pickedUpBy: new Set(),
                                spawnTime: spawnTime
                            };
                            
                            // Check and fix wall collisions before adding item
                            checkItemWallCollisions(newItem);
                            
                            items.push(newItem);
                            
                            // Send itemSpawned event to eligible players (map split player IDs to original socket IDs)
                            const { getOriginalSocketId } = require('./utils');
                            for (const eligiblePlayerId of eligiblePlayersForItem) {
                                const originalSocketId = getOriginalSocketId(eligiblePlayerId);
                                io.to(originalSocketId).emit('itemSpawned', newItem);
                            }
                            
                            // Schedule automatic removal after expiration time
                            const expirationTime = ITEM_EXPIRATION_TIMES[randomRarity] || 10000;
                            const timeout = setTimeout(() => {
                                itemExpirationTimeouts.delete(itemId);
                                const itemIndex = items.findIndex(item => item.id === itemId);
                                if (itemIndex !== -1) {
                                    const expiredItem = items[itemIndex];
                                    items.splice(itemIndex, 1);
                                    
                                    // Notify eligible players that item expired
                                    const { getOriginalSocketId } = require('./utils');
                                    if (expiredItem.eligiblePlayers) {
                                        for (const playerId of expiredItem.eligiblePlayers) {
                                            const originalSocketId = getOriginalSocketId(playerId);
                                            io.to(originalSocketId).emit('itemRemoved', itemId);
                                        }
                                    }
                                    
                                    if (!player.id.startsWith('bot_')) {
                                        console.log(`[ITEM_SPAWNER] Petal ${randomPetalType} (${randomRarity}) expired after ${expirationTime}ms`);
                                    }
                                }
                            }, expirationTime);
                            itemExpirationTimeouts.set(itemId, timeout);
                            
                            if (!player.id.startsWith('bot_')) {
                                console.log(`[ITEM_SPAWNER] Spawned random petal: ${randomPetalType} (${randomRarity}) for player ${player.name}`);
                            }
                        }
                    }

            // Petals block mob projectiles: each side damages the other, exactly
            // as if the projectile were an enemy petal. The projectile lives in
            // the ECS now, so the bridge does the overlap test and applies the
            // damage this callback returns; the petal side stays here because
            // petal instance health is legacy state.
            {
                // Resolved lazily: the callback fires only on an actual block,
                // and this runs for every petal instance of every player.
                let projectileDamageMultiplier = -1;
                const petalBlockRadius = (40 * effectiveSize) / 2;
                deps.projectiles.forEachBlocking(petalX, petalY, petalBlockRadius, (mobProjectile) => {
                    if (projectileDamageMultiplier < 0) {
                        projectileDamageMultiplier = getDamageMultiplier(player);
                    }
                    const prevProjInstanceHealth = getInstanceHealth(petal, instanceIndex, petalStats);
                    setInstanceHealth(
                        petal, instanceIndex, petalStats,
                        Math.max(0, prevProjInstanceHealth - mobProjectile.damage),
                    );
                    return petalStats.damage * projectileDamageMultiplier;
                });
            }

                    // Handle petal collision for wait_until_collision actions
                    const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
                    const collisionContext = {
                        player: player,
                        petalX: petalX,
                        petalY: petalY,
                        petalSize: petalSize,
                        petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                        enemies: enemies,
                        io: io,
                        petalId: petalId,
                        loadoutIndex: loadoutIndex,
                        instanceIndex: instanceIndex
                    };
                    handlePetalCollision(petalId, collisionContext);

                    // Check if petal breaks (per-instance for clumped)
                    if (getInstanceHealth(petal, instanceIndex, petalStats) <= 0) {
                        // Execute petal actions before breaking
                        if (petalStats.actions) {
                            const actionContext = {
                                player: player,
                                petalX: petalX,
                                petalY: petalY,
                                petalSize: petalSize,
                                petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                                enemies: enemies,
                                io: io
                            };
                            executePetalActions(petalStats.actions, actionContext, 'on_break');
                        }

                        const cooldownTime = getEffectiveCooldown(petal, petalStats);
                        // Absolute restore deadline alongside the setTimeout. Without it
                        // the tick-loop backstop has no idea when this cooldown is meant
                        // to end — and this is the path petals normally break on, so a
                        // missing stamp meant every petal reloaded instantly.
                        const cooldownEndsAt = Date.now() + cooldownTime;

                        if (hasIndependentInstances(petalStats)) {
                            // Per-instance: only this instance breaks; other instances keep working
                            ensureInstanceArrays(petal, petalStats);
                            petal.instanceOnCooldown![instanceIndex] = true;
                            const cdCount = petalStats.count ?? 1;
                            if (!Array.isArray(petal.instanceCooldownEndTime) || petal.instanceCooldownEndTime.length !== cdCount) {
                                petal.instanceCooldownEndTime = new Array(cdCount).fill(undefined);
                            }
                            petal.instanceCooldownEndTime[instanceIndex] = cooldownEndsAt;
                            resetPetalPhysicsOnBreak(player.id, loadoutIndex, instanceIndex);
                            const snapshotPetalType = petal.petalType;
                            const snapshotRarity = petal.rarity;
                            const snapshotMaxHealth = petal.maxHealth;
                            const snapshotPlayerId = player.id;
                            setTimeout(() => {
                                restoreIndependentPetalInstance(
                                    snapshotPlayerId,
                                    loadoutIndex,
                                    instanceIndex,
                                    snapshotPetalType,
                                    snapshotRarity,
                                    snapshotMaxHealth,
                                    io
                                );
                            }, cooldownTime);

                            if (petal.instanceOnCooldown!.every((c: boolean) => c)) {
                                petal.onCooldown = true;
                                // See the matching emit in the tick-loop break above.
                                io.emit('petalBroken', {
                                    playerId: player.id,
                                    slotIndex: loadoutIndex,
                                    petalType: petal.petalType,
                                    rarity: petal.rarity
                                });
                            }
                        } else {
                            // Non-clumped: whole slot breaks (legacy behavior)
                            petal.onCooldown = true;
                            petal.cooldownEndTime = cooldownEndsAt;
                            resetSlotPetalPhysicsOnBreak(player.id, loadoutIndex);
                            const originalPetal = {
                                type: petal.type,
                                petalType: petal.petalType,
                                rarity: petal.rarity,
                                maxHealth: petal.maxHealth
                            };
                            const snapshotPetalType = originalPetal.petalType;
                            const snapshotRarity = originalPetal.rarity;
                            setTimeout(() => {
                                const current = players[player.id]?.loadout?.[loadoutIndex];
                                if (!players[player.id] || !current || !current.onCooldown) return;
                                if (current.type !== 'petal' ||
                                    current.petalType !== snapshotPetalType ||
                                    current.rarity !== snapshotRarity) return;
                                {
                                    const restoredPetal = {
                                        ...originalPetal,
                                        health: originalPetal.maxHealth,
                                        onCooldown: false
                                    };
                                    applyPetalHealthBonus(restoredPetal, player);
                                    player.loadout[loadoutIndex] = restoredPetal;

                                    io.emit('petalRestored', {
                                        playerId: player.id,
                                        slotIndex: loadoutIndex,
                                        petal: player.loadout[loadoutIndex]
                                    });
                                }
                            }, cooldownTime);

                            io.emit('petalBroken', {
                                playerId: player.id,
                                slotIndex: loadoutIndex,
                                petalType: petal.petalType,
                                rarity: petal.rarity
                            });
                        }
                    }

                    // Check if enemy dies (only process once per enemy)
                    if (enemy.health <= 0 && !(enemy as any).isDead) {
                        const index = enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            killEnemy(enemy, index, enemies, killCtxFromDeps(deps), {
                                killerPlayerId: player.id,
                                trackMobKillTiming: 'sync-snapshot',
                            });
                        }
                    }
                }
            }

            // Petal-vs-player collision: a petal swing on contact deals damage and
            // knocks the victim back. Only runs between players who are allowed to
            // fight — both inside the PVP arena, or either one corrupted, which makes
            // a corrupted flower hostile to everyone anywhere in the world. The
            // `player.corrupted` term is redundant with the registry check beside it
            // and stays as a backstop: an attacker whose flag was set without
            // setPlayerCorrupted() still swings.
            if (player.inPvpArena || player.corrupted || anyCorruptedPlayers) {
                const petalSizePx = 40 * effectiveSize;
                const petalRadius = petalSizePx / 2;
                // A splitter half is the SAME person as its other half — they must
                // never damage each other, corrupted or not.
                const ownerSocketId = getOriginalSocketId(player.id);

                for (const otherId in players) {
                    if (otherId === player.id) continue;
                    const other = players[otherId];
                    if (!other || other.isDead) continue;
                    if (!canPetalsDamagePlayer(player, other)) continue;
                    if (getOriginalSocketId(otherId) === ownerSocketId) continue;

                    const otherPlayerRadius = (PLAYER_SIZE / 2) * (other.sizeMultiplier ?? 1.0);
                    const minDist = petalRadius + otherPlayerRadius;
                    const minDistSq = minDist * minDist;

                    const dxp = other.x - petalX;
                    const dyp = other.y - petalY;
                    const distSqP = dxp * dxp + dyp * dyp;
                    if (distSqP >= minDistSq || distSqP <= 0) continue;

                    // Per-victim cooldown so a single petal can't deal damage every tick
                    const damageCooldownKey = `${player.id}_${loadoutIndex}_${instanceIndex}_pvp_${otherId}`;
                    const PVP_PETAL_COOLDOWN = petalStats.damageCooldown || 250; // ms between hits on same victim
                    const lastDmgTime = petalLastDamageTime.get(damageCooldownKey) || 0;
                    if (currentTime - lastDmgTime < PVP_PETAL_COOLDOWN) continue;
                    petalLastDamageTime.set(damageCooldownKey, currentTime);

                    const damageMultiplier = getDamageMultiplier(player);
                    const finalDamage = petalStats.damage * damageMultiplier;
                    applyPvpDamage(player, other, finalDamage, io, savePlayerProgress);

                    // The attacking petal also takes damage from the hit and may break.
                    if (!petalStats.damageCooldown) {
                        const prevHealth = getInstanceHealth(petal, instanceIndex, petalStats);
                        // Use a fixed self-damage so PVP doesn't trivially destroy petals on the first hit.
                        setInstanceHealth(petal, instanceIndex, petalStats, Math.max(0, prevHealth - 1));
                    }
                }
            }

            // Check for corpse revival if this is a yggdrasil petal (always active)
            if (petal.petalType === 'yggdrasil') {
                const revivalRange = 80; // Range for automatic revival
                
                for (const [otherPlayerId, otherPlayer] of Object.entries(players)) {
                    if (otherPlayerId !== player.id && otherPlayer.isDead) {
                        const distance = Math.sqrt(
                            (petalX - otherPlayer.x) ** 2 + (petalY - otherPlayer.y) ** 2
                        );
                        
                        if (distance <= revivalRange) {
                            // Break the yggdrasil petal when it revives someone
                            petal.health = 0; // This will trigger the petal breaking logic below
                            
                            // Revive the target player
                            otherPlayer.isDead = false;
                            otherPlayer.health = otherPlayer.maxHealth;
                            otherPlayer.isInvulnerable = true;
                            otherPlayer.lastDamageTime = 0;
                            
                            // Notify all clients about the revival
                            io.emit('playerRevived', {
                                revivedPlayerId: otherPlayerId,
                                revivingPlayerId: player.id,
                                revivedPlayerName: otherPlayer.name,
                                revivingPlayerName: player.name
                            });
                            
                            // Give revived player temporary invulnerability
                            setTimeout(() => {
                                if (players[otherPlayerId]) {
                                    players[otherPlayerId].isInvulnerable = false;
                                    io.emit('playerInvulnerabilityEnded', { playerId: otherPlayerId });
                                }
                            }, RESPAWN_INVULNERABILITY_TIME);
                            
                            if (!player.id.startsWith('bot_') && !otherPlayerId.startsWith('bot_')) {
                                console.log(`Player ${player.name} automatically revived ${otherPlayer.name} using yggdrasil petal (petal broke)`);
                            }
                            
                            // Break out of the loop since we've used the petal
                            break;
                        }
                    }
                }
            }
        }
    }

    // Check for item collisions (independent of enemy collisions)
    // Optimize: use squared distance comparison to avoid Math.sqrt
    const pickupSize = PLAYER_SIZE * (player.sizeMultiplier ?? 1.0) + (player.magnetism ?? 0);
    const pickupRadiusSquared = pickupSize * pickupSize;
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const dx = newX - item.x;
        const dy = newY - item.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < pickupRadiusSquared) {
            // Check if player has already picked up this item
            if (item.pickedUpBy && item.pickedUpBy.has(player.id)) {
                continue; // Skip if already picked up by this player
            }
            
            // Check if player is eligible to pick up this item
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                let isEligible = false;
                
                // First, check if player ID is directly eligible
                if (item.eligiblePlayers.includes(player.id)) {
                    isEligible = true;
                } else {
                    // Check if this player is part of a split pair
                    const { splitPlayers } = require('../petal_actions');
                    const originalId = player.id.replace('_split2', '').replace('_split1', '');
                    const splitState = splitPlayers.get(originalId);
                    
                    if (splitState) {
                        // Player is split - check if any of the split player IDs or original ID is eligible
                        isEligible = item.eligiblePlayers.includes(splitState.player1.id) || 
                                     item.eligiblePlayers.includes(splitState.player2.id) ||
                                     item.eligiblePlayers.includes(originalId);
                    } else {
                        // Not split - check if original socket ID is eligible (for items created with original ID)
                        const { getOriginalSocketId } = require('./utils');
                        const originalSocketId = getOriginalSocketId(player.id);
                        if (player.id !== originalSocketId) {
                            isEligible = item.eligiblePlayers.includes(originalSocketId);
                        }
                    }
                }
                
                if (!isEligible) {
                    // Player is not eligible - skip this item
                    // Debug log to help diagnose pickup issues
                    continue;
                }
            }
            
            // Add item to player's inventory (which may be shared with split player).
            // While inside the PVP arena, `inventory` IS the PVP-only inventory; on
            // exit, 25% of it is transferred back into the regular inventory.
            let rarity = item.rarity || 'common';
            const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
            // Maze drops gain a rarity the moment they enter the inventory:
            // the inventory stays in regular-world terms inside the maze, so
            // the +1 the maze promises is applied at pickup, not on exit.
            if (player.inMaze && player.mazeRarityShifted) {
                const rarityIdx = getRarityIndex(rarity);
                if (rarityIdx >= 0) {
                    rarity = RARITY_LEVELS[Math.min(rarityIdx + 1, RARITY_LEVELS.length - 1)];
                }
            }
            addItem(player.inventory, rarity, itemKey, 1);
            
            // Mark as picked up by this player (don't remove from world)
            if (!item.pickedUpBy) {
                item.pickedUpBy = new Set();
            }
            item.pickedUpBy.add(player.id);
            
            // console.log(`[PICKUP] Player ${player.id} (${player.name}) picked up item ${item.id} (${itemKey}, ${rarity})`);
            
            // Check if this player is split and update the other split player's inventory reference
            const { splitPlayers } = require('../petal_actions');
            const originalId = player.id.replace('_split2', '').replace('_split1', '');
            const splitState = splitPlayers.get(originalId);
            if (splitState) {
                // Both players share the same inventory, so update the other player's reference
                if (splitState.player1.id === player.id) {
                    splitState.player2.inventory = player.inventory;
                } else if (splitState.player2.id === player.id) {
                    splitState.player1.inventory = player.inventory;
                }
            }
            
            // Emit events to update client
            // Map split player IDs to original socket IDs for socket room targeting
            const { getOriginalSocketId } = require('./utils');
            const originalSocketId = getOriginalSocketId(player.id);
            io.to(originalSocketId).emit('itemPickedUp', item.id);
            io.to(originalSocketId).emit('inventoryUpdated', player.inventory);
            
            // Save player progress to persist inventory changes
            const userId = playerUserIds[player.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
            
            // Remove item from world if all eligible players have picked it up
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                const allPickedUp = item.eligiblePlayers.every(playerId => 
                    item.pickedUpBy && item.pickedUpBy.has(playerId)
                );
                if (allPickedUp) {
                    // Clean up expiration timeout if item is removed early
                    const timeout = itemExpirationTimeouts.get(item.id);
                    if (timeout) {
                        clearTimeout(timeout);
                        itemExpirationTimeouts.delete(item.id);
                    }
                    items.splice(i, 1);
                    // Notify only eligible players that the item is gone
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
            }
        }
    }

    // Maze players stay inside the maze region. The maze's border ring is
    // solid wall so collision already contains them — this is a safety net
    // against knockback/teleport edge cases ejecting someone into the void.
    if (player.inMaze) {
        const mazeNow = getActiveMaze();
        if (mazeNow) {
            const margin = PLAYER_SIZE / 2;
            newX = Math.max(MAZE_ORIGIN_X + margin, Math.min(MAZE_ORIGIN_X + mazeNow.worldSize - margin, newX));
            newY = Math.max(MAZE_ORIGIN_Y + margin, Math.min(MAZE_ORIGIN_Y + mazeNow.worldSize - margin, newY));
        }
    }

    // Clamp position to the PVP arena boundary if the player is currently inside it.
    // Players can only leave via the central exit teleporter — never by walking out.
    if (player.inPvpArena) {
        const dxArena = newX - PVP_ARENA_CENTER_X;
        const dyArena = newY - PVP_ARENA_CENTER_Y;
        const distSqArena = dxArena * dxArena + dyArena * dyArena;
        const maxR = PVP_ARENA_RADIUS - PLAYER_SIZE / 2;
        if (distSqArena > maxR * maxR) {
            const distArena = Math.sqrt(distSqArena) || 1;
            newX = PVP_ARENA_CENTER_X + (dxArena / distArena) * maxR;
            newY = PVP_ARENA_CENTER_Y + (dyArena / distArena) * maxR;
        }
    }

    // Check for teleporter interactions
    let currentTeleporter: string | null = null;
    const currentTime = Date.now();
    const isOnCooldown = player.teleportCooldown && currentTime < player.teleportCooldown;

    for (const element of WORLD_MAP.filter(isTeleporter)) {
        if (!element.properties?.teleportTo) continue;

        const teleporterId = `teleporter_${element.x}_${element.y}`;
        const teleporterCX = (element.x + element.width / 2) * SCALE_FACTOR;
        const teleporterCY = (element.y + element.height / 2) * SCALE_FACTOR;
        const playerCX = newX + PLAYER_SIZE / 2;
        const playerCY = newY + PLAYER_SIZE / 2;
        const dx = playerCX - teleporterCX;
        const dy = playerCY - teleporterCY;
        const distSq = dx * dx + dy * dy;
        const suctionRadius = TELEPORTER_SUCTION_RADIUS * SCALE_FACTOR;
        const activationRadius = TELEPORTER_RADIUS * SCALE_FACTOR;

        // Apply suction force if player is within suction radius and NOT on cooldown
        if (distSq <= suctionRadius * suctionRadius && !isOnCooldown) {
            const dist = Math.sqrt(distSq) || 1;
            // Stronger pull as player gets closer
            const pullStrength = TELEPORTER_SUCTION_FORCE * (1 - dist / suctionRadius) * deltaTime;
            newX -= (dx / dist) * pullStrength;
            newY -= (dy / dist) * pullStrength;
        }

        // Check if player is within activation radius
        if (distSq <= activationRadius * activationRadius) {
            currentTeleporter = teleporterId;

            // Check if player just entered this teleporter
            if (player.currentTeleporter !== teleporterId) {
                player.currentTeleporter = teleporterId;
                player.teleporterEnterTime = currentTime;

                // Teleporter feedback goes to the OWNING SOCKET, not the player
                // id: a splitter half (`..._split2`) has no socket of its own, so
                // addressing it dropped the event and the flower charged up with
                // no spin animation and no iris transition.
                io.to(getOriginalSocketId(player.id)).emit('teleporterEntered', {
                    teleporterId,
                    timeRequired: 1000,
                    teleportTo: element.properties.teleportTo
                });

                if (!player.id.startsWith('bot_')) {
                    console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} entered teleporter, waiting 1 second...`);
                }
            }

            // Check if player has been in teleporter for 1 second and is not on cooldown
            const timeInTeleporter = currentTime - (player.teleporterEnterTime || currentTime);

            if (timeInTeleporter >= 1000 && !isOnCooldown) {
                const teleportTo = element.properties.teleportTo;

                // Set 5 second player-based cooldown
                player.teleportCooldown = currentTime + TELEPORTER_COOLDOWN;

                if (teleportTo.serverPort && teleportTo.serverPort !== currentServerPort) {
                    if (!player.id.startsWith('bot_')) {
                        console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleporting to server port ${teleportTo.serverPort} after 1 second delay`);
                    }

                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;

                    transferPlayerToServer(
                        player,
                        teleportTo.serverPort,
                        teleportTo.x * SCALE_FACTOR,
                        teleportTo.y * SCALE_FACTOR,
                        io,
                        database,
                        useHttps,
                        currentServerConfig,
                        currentServerPort
                    ).catch(error => {
                        console.error(`[SERVER ${currentServerConfig.name}] Failed to transfer player ${player.name}:`, error);
                        io.to(getOriginalSocketId(player.id)).emit('transferFailed', { message: 'Failed to connect to target server' });
                        player.teleportCooldown = undefined;
                    });

                    return;
                } else {
                    newX = teleportTo.x * SCALE_FACTOR;
                    newY = teleportTo.y * SCALE_FACTOR;

                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;

                    if (!player.id.startsWith('bot_')) {
                        console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleported to (${newX}, ${newY}) after 1 second delay`);
                    }

                    io.to(getOriginalSocketId(player.id)).emit('playerTeleported', {
                        newX,
                        newY,
                        playerId: player.id
                    });
                }
            }

            break;
        }
    }

    // If player is no longer in any teleporter, reset teleporter state
    if (!currentTeleporter && player.currentTeleporter) {
        if (!player.id.startsWith('bot_')) {
            console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} left teleporter`);
        }
        player.currentTeleporter = undefined;
        player.teleporterEnterTime = undefined;

        io.to(getOriginalSocketId(player.id)).emit('teleporterExited');
    }

    const wasInArena = !!player.inPvpArena;
    player.x = newX;
    player.y = newY;
    const isNowInArena = isInPvpArena(player.x, player.y);
    if (!wasInArena && isNowInArena) {
        // Entering: stash regular inventory/loadout, swap in fresh PVP versions.
        enterPvpArena(player, io);
    } else if (wasInArena && !isNowInArena) {
        // Exiting: transfer 25% of the PVP inventory into the regular inventory,
        // then restore regular inventory/loadout.
        exitPvpArena(player, io, (p, uid) => savePlayerProgress(p, uid));
    }

    if (player.health <= 0 && !player.isDead) {
        // Mark player as dead instead of respawning immediately
        player.isDead = true;
        // Set random rotation for the corpse
        player.angle = Math.random() * Math.PI * 2;
        // Despawn all pets owned by this player
        despawnAllPlayerPets(player.id, io);

        io.emit('playerDied', {
            playerId: player.id,
            x: player.x,
            y: player.y,
            angle: player.angle,
            killedBy: player.killedBy
        });

        // No automatic respawn - player must manually respawn via continue button
    }
}
