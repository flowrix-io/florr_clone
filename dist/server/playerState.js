"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forgetEnemyFromRaindropAura = forgetEnemyFromRaindropAura;
exports.cleanupPetalPhysicsStates = cleanupPetalPhysicsStates;
exports.getRaindropAuraRadius = getRaindropAuraRadius;
exports.getPlayerViewports = getPlayerViewports;
exports.isPositionNearAnyPlayer = isPositionNearAnyPlayer;
exports.isPositionInAnyViewport = isPositionInAnyViewport;
exports.isPositionInAnyViewport200Percent = isPositionInAnyViewport200Percent;
exports.getEnemiesInViewport200Percent = getEnemiesInViewport200Percent;
exports.isPositionInPlayerPetalRange = isPositionInPlayerPetalRange;
exports.getEnemiesInViewportCount = getEnemiesInViewportCount;
exports.validatePlayerPositions = validatePlayerPositions;
exports.trySecondChance = trySecondChance;
exports.computeSpeedBoost = computeSpeedBoost;
exports.updatePlayerPreMovement = updatePlayerPreMovement;
exports.resolvePlayerMobContact = resolvePlayerMobContact;
exports.resolvePlayerItemPickups = resolvePlayerItemPickups;
exports.clampPlayerToRegion = clampPlayerToRegion;
exports.resolvePlayerTeleporters = resolvePlayerTeleporters;
exports.resolvePlayerPetals = resolvePlayerPetals;
exports.updatePlayerState = updatePlayerState;
const mobFields_1 = require("./mobFields");
const player_1 = require("../player");
const petals_1 = require("../petals");
const constants_1 = require("../constants");
const maze_1 = require("../maze");
const map_data_1 = require("../map_data");
const gameState_1 = require("./gameState");
const itemRegistry_1 = require("./itemRegistry");
const physics_1 = require("./physics");
const physics_2 = require("./physics");
const petal_actions_1 = require("../petal_actions");
const mobs_1 = require("../mobs");
const server_utils_1 = require("../server_utils");
const enemyGrid_1 = require("./enemyGrid");
const ecsSync_1 = require("./ecsSync");
// The ECS petal ring. Importing `src/ecs` from here is the SAFE direction: that
// tree is isomorphic and side-effect free. The banned direction is the reverse —
// this module binds a port at import, so nothing under src/ecs may import it.
const petalRing_1 = require("../ecs/systems/petalRing");
const petalEvents_1 = require("./petalEvents");
// Reusable per-call buffers for enemy grid queries; avoids per-petal array allocs.
// Two separate buffers because queryEnemiesNear() clears the one it is handed:
// the petal-attraction query and the petal-collision query run in the same petal
// iteration, so sharing one buffer would let the second clobber the first.
const _enemyQueryBuffer = [];
const _attractionQueryBuffer = [];
// The guided-missile target scan and uranium's radiation pulse both run inside
// the same petal iteration, so they need buffers of their own for the same reason.
const _seekQueryBuffer = [];
const _radiationQueryBuffer = [];
// How long shell's burst shield lasts once delivered.
const BURST_SHIELD_DURATION_MS = 10000;
// ---------------------------------------------------------------------------
// The petal ring's view of the legacy world
// ---------------------------------------------------------------------------
/**
 * Scratch and dependency plumbing for `ecs/systems/petalRing`.
 *
 * One SHARED deps object and one shared result struct rather than a fresh set
 * per player per tick. That is safe because `updatePlayerState` is not
 * re-entrant — the tick loop calls it for one flower at a time and nothing
 * inside it calls back into it — and it matters because the alternative is
 * allocating four closures and two objects per player per tick, on the path
 * that already dominates the tick budget with 30 players and a full ring each.
 *
 * The `_ringHoming*` pair is how `isHoming` reports WHICH burst fired back to
 * the petal loop: the ring only needs the boolean, but the loop has to know
 * whether to heal or to shield. Both are only meaningful immediately after a
 * `stepPetalKinematics` call that reported `homing`.
 */
let _ringDepsPlayer = null;
let _ringHomingWasHeal = false;
let _ringHomingWasShield = false;
const _ringStepResult = { x: 0, y: 0, angle: 0, homing: false };
const _dropTargetScratch = { x: 0, y: 0, angle: 0, range: 0 };
const _attractionTarget = { id: '', x: 0, y: 0, radius: 0 };
const _petalRingDeps = {
    /**
     * The closest attractable mob to a petal's ORBIT point.
     *
     * Reads the legacy `enemyGrid`, rebuilt once per tick in start_loop — not
     * the ECS spatial grid, which is rebuilt at two other points in the tick and
     * would therefore hold different mob positions. See PetalRingDeps.
     *
     * The eligibility test uses the grid's CACHED `_radius` (which includes the
     * pet/rarity size scaling) while the returned projection radius comes from
     * the mob CONFIG. That asymmetry is in the code this replaces and is
     * preserved deliberately: unifying them would move where attracted petals
     * sit on every rarity-scaled mob.
     */
    findAttractionTarget(x, y, radius) {
        const candidates = (0, enemyGrid_1.queryEnemiesNear)(x, y, radius, _attractionQueryBuffer);
        let closest = null;
        let closestDistanceSq = Infinity;
        for (let ai = 0; ai < candidates.length; ai++) {
            const enemy = candidates[ai];
            // A mob killed earlier this tick (by an earlier petal in this same
            // loop) is spliced out of `enemies` but is still in the grid.
            if ((0, mobFields_1.isMobDead)(enemy.entity))
                continue;
            const candidateEnemyRadius = (0, mobFields_1.mobRadiusOf)(enemy.entity) ?? (constants_1.ENEMY_SIZE / 2);
            const dx = (0, mobFields_1.mobX)(enemy.entity) - x;
            const dy = (0, mobFields_1.mobY)(enemy.entity) - y;
            const distSq = dx * dx + dy * dy;
            const maxDist = radius + candidateEnemyRadius;
            if (distSq <= maxDist * maxDist && distSq < closestDistanceSq) {
                closestDistanceSq = distSq;
                closest = enemy;
            }
        }
        if (!closest)
            return null;
        const stats = (0, mobs_1.getMobStats)(closest.type, closest.tier);
        _attractionTarget.id = closest.id;
        _attractionTarget.x = (0, mobFields_1.mobX)(closest.entity);
        _attractionTarget.y = (0, mobFields_1.mobY)(closest.entity);
        _attractionTarget.radius = stats ? (stats.size * 40) / 2 : constants_1.ENEMY_SIZE / 2;
        return _attractionTarget;
    },
    isEnemyPresent(id) {
        for (let i = 0; i < (0, enemyRegistry_1.liveEnemies)().length; i++) {
            if ((0, enemyRegistry_1.liveEnemies)()[i].id === id)
                return true;
        }
        return false;
    },
    resolveWall(x, y, size) {
        return (0, physics_1.checkPlayerWallCollisions)(x, y, size);
    },
    /**
     * Burst-delivery homing: rose flies home to heal, shell flies home to lay a
     * shield. Both wait out a charge time in orbit first, which is why this is a
     * callback — `timeSinceSpawn` is ring state and only exists inside the step.
     *
     * The cast is sound: `stepPetalKinematics` hands back the very object the
     * petal loop passed in, which is a full `PetalStats`. `PetalRingStats` is a
     * structural subset naming only the fields the KINEMATICS read, and burst
     * behaviour is not one of them.
     */
    isHoming(stats, timeSinceSpawn) {
        const player = _ringDepsPlayer;
        const full = stats;
        const chargeMs = full.burstHealChargeMs ?? 1000;
        _ringHomingWasHeal = !!full.burstHeal
            && player.health < player.maxHealth
            && timeSinceSpawn >= chargeMs;
        _ringHomingWasShield = !!full.burstShield
            && (0, petal_actions_1.getShieldAmount)(player) <= 0
            && timeSinceSpawn >= chargeMs;
        return _ringHomingWasHeal || _ringHomingWasShield;
    },
};
/** Point the shared ring deps at `player` for the duration of its petal loop. */
function makePetalRingDeps(player) {
    _ringDepsPlayer = player;
    _ringHomingWasHeal = false;
    _ringHomingWasShield = false;
    return _petalRingDeps;
}
// Mob slows (web/honey/pincer) are ECS-owned now: application goes through the
// `slows` bridge in PlayerStateDependencies (EcsRuntime.slowEnemy runs the
// stallPower rarity contest and writes the Speed/Slowed pair), and the
// slowExpiry system restores the speed when the timer lapses. The shell-side
// applySlow that lived here is gone; stallPower moved to server/shared/rarity.ts.
const playerManager_1 = require("./playerManager");
const inventoryCodec_1 = require("../inventoryCodec");
const utils_1 = require("./utils");
const killHandler_1 = require("./shared/killHandler");
const enemyRegistry_1 = require("./enemyRegistry");
const wireOutbox_1 = require("./wireOutbox");
/**
 * Adapt the PlayerStateDependencies bag (built in server.ts) to the kill-handler
 * context. The two share the same kill-related fields; this just projects them.
 */
function killCtxFromDeps(deps) {
    return {
        io: deps.io,
        players: constants_1.players,
        playerUserIds: gameState_1.playerUserIds,
        database: deps.database,
        removeEnemy: enemyRegistry_1.removeEnemy,
        savePlayerProgress: deps.savePlayerProgress,
        addXPToPlayer: deps.addXPToPlayer,
        handleMobDrops: deps.handleMobDrops,
        sendBossMobDefeatedMessage: deps.sendBossMobDefeatedMessage,
        updateSpecialMobCounts: deps.updateSpecialMobCounts,
        cleanupEnemy: utils_1.cleanupEnemy,
        trackMobKill: deps.trackMobKill,
    };
}
// ---------------------------------------------------------------------------
// Petal kinematics live in the ECS now
// ---------------------------------------------------------------------------
// The spring/glide state that used to sit in a module-level
// `Map<"<socketId>_<slot>_<instance>", PetalPhysicsState>` here is a
// `PetalRingState` held in the `PetalRing` component on the flower's entity,
// and the integrator, the orbit-slot layout and the orbit-point maths are in
// `ecs/systems/petalRing.ts`. That file's header carries the modelling
// argument for why a petal instance is component data on the player rather
// than an entity of its own.
//
// Everything BELOW the kinematics is still legacy and stays that way for now:
// per-instance health, the break/cooldown/reload state machine, petal-vs-mob
// and petal-vs-projectile combat, the fields and auras, PVP swings and the
// specials. The reason is ordering, not effort — see the "What is NOT here"
// section of the ring's header. In short: this loop interleaves kinematics and
// effects per instance, and instance k's effects change instance k+1's
// kinematics, so the ring has to be STEPPED from inside this loop rather than
// batched ahead of it.
//
// The one thing to keep in mind when editing below: the ring is the SOLE writer
// of petal positions. Nothing here may write back into a PetalPhysics — the
// wall-collision write-back that used to live in this file is now inside
// `stepPetalKinematics`, where it belongs.
// Map to track last damage time for petals with damageCooldown (keyed by petalId)
const petalLastDamageTime = new Map();
// Raindrop aura: tracks the last time each (player, enemy) pair took aura damage,
// so an enemy sitting inside the field takes chip damage on an interval rather
// than every server tick. Keyed by playerId -> (enemyId -> lastDamageTime).
const raindropAuraLastDamage = new Map();
const RAINDROP_AURA_DAMAGE_INTERVAL_MS = 500;
const RAINDROP_AURA_BASE_RADIUS = 180;
const RAINDROP_AURA_RADIUS_PER_RARITY = 18;
// Petal-ring mobs (glitch flower): last time each player was hit by ANY ring, so
// walking into one costs a hit per sweep rather than one per tick. One timestamp
// per player rather than per (player, mob) pair — two rings closing on the same
// flower at once is rare, and sharing the timer keeps this map bounded by the
// player count and cleaned up by cleanupPetalPhysicsStates.
const petalRingLastHit = new Map();
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
function corruptFlowerAndSplitHalf(player) {
    const split = petal_actions_1.splitPlayers.get((0, utils_1.getOriginalSocketId)(player.id));
    const halves = split ? [split.player1, split.player2] : [player];
    for (const half of halves) {
        if (constants_1.players[half.id])
            (0, gameState_1.setPlayerCorrupted)(constants_1.players[half.id], true);
    }
}
// Drop an enemy's per-player aura damage-timestamps when it leaves the world.
// Without this the inner maps grow by one entry per enemy ever seen in aura
// range and are only ever cleared on player disconnect — a heap leak that
// builds up over a long session as mobs continuously spawn and die. Called
// from cleanupEnemy so every enemy removal (death or despawn) prunes here.
function forgetEnemyFromRaindropAura(enemyId) {
    for (const lastDamageMap of raindropAuraLastDamage.values()) {
        lastDamageMap.delete(enemyId);
    }
}
// Drop a damaging pollen puff at the given position. Pollen petals call this
// when they break so the petal still goes through the normal cooldown/reload
// cycle while leaving a short-lived AoE behind. The puff itself is an ECS
// entity (ecs/systems/groundEffects.ts); this module only mints the wire id,
// hands the spec across the bridge and emits the spawn event.
function spawnGroundPollen(io, groundEffects, player, petalStats, petal, petalX, petalY, petalSize) {
    const now = Date.now();
    const id = `pollen_${player.id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
    groundEffects.spawnPollen({
        id,
        playerId: player.id,
        x: petalX,
        y: petalY,
        damage: petalStats.damage,
        radius: petalSize / 2,
        rarity: petal.rarity,
        expiresAt: now + gameState_1.GROUND_POLLEN_LIFETIME_MS,
    });
    (0, wireOutbox_1.getWireOutbox)().all('groundPollenSpawned', {
        id,
        playerId: player.id,
        x: petalX,
        y: petalY,
        radius: petalSize / 2,
        rarity: petal.rarity,
        lifetime: gameState_1.GROUND_POLLEN_LIFETIME_MS
    });
}
// Leave a web field where a thrown web petal came to rest. gardn's web petal is
// launched outward while attacking (or dropped where it sits while defending)
// and spawns the field from alloc_web() when it despawns 0.6s later; the petal
// itself is consumed either way and reloads normally. Like pollen, the field is
// an ECS entity now.
function spawnWebField(io, groundEffects, player, radius, rarity, x, y) {
    const now = Date.now();
    const id = `web_${player.id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
    groundEffects.spawnWeb({
        id,
        playerId: player.id,
        x,
        y,
        radius,
        rarity,
        expiresAt: now + gameState_1.WEB_LIFETIME_MS,
    });
    (0, wireOutbox_1.getWireOutbox)().all('webSpawned', { id, x, y, radius, rarity, lifetime: gameState_1.WEB_LIFETIME_MS });
}
// --- Per-instance petal health/cooldown helpers ---
// Some petals spawn multiple instances (count > 1) that should each carry their own
// health and cooldown, so a single hit can't kill them all at once and each breaks
// and recharges independently. This applies to clumped petals (e.g. sand, which share
// one orbit slot) and to spread petals flagged `independentHealth` (e.g. light, whose
// particles orbit in separate slots). `clumped` controls only visual arrangement; the
// independent-health behavior is gated separately here.
function hasIndependentInstances(petalStats) {
    return !!((petalStats?.clumped || petalStats?.independentHealth) && (petalStats.count ?? 1) > 1);
}
function ensureInstanceArrays(petal, petalStats) {
    if (!hasIndependentInstances(petalStats))
        return;
    const count = petalStats.count ?? 1;
    const defaultHealth = petal.maxHealth ?? petalStats.health;
    if (!Array.isArray(petal.instanceHealth) || petal.instanceHealth.length !== count) {
        petal.instanceHealth = new Array(count).fill(defaultHealth);
    }
    if (!Array.isArray(petal.instanceOnCooldown) || petal.instanceOnCooldown.length !== count) {
        petal.instanceOnCooldown = new Array(count).fill(false);
    }
}
function restoreIndependentPetalInstance(playerId, loadoutIndex, instanceIndex, snapshotPetalType, snapshotRarity, snapshotMaxHealth, io) {
    const current = constants_1.players[playerId]?.loadout?.[loadoutIndex];
    if (!current || current.type !== 'petal')
        return;
    if (current.petalType !== snapshotPetalType || current.rarity !== snapshotRarity)
        return;
    if (!current.petalType || !current.rarity)
        return;
    const currentStats = (0, petals_1.getPetalStats)(current.petalType, current.rarity);
    if (!currentStats || !hasIndependentInstances(currentStats))
        return;
    ensureInstanceArrays(current, currentStats);
    const restoredHealth = snapshotMaxHealth ?? current.maxHealth ?? currentStats.health;
    current.instanceOnCooldown[instanceIndex] = false;
    if (Array.isArray(current.instanceCooldownEndTime)) {
        current.instanceCooldownEndTime[instanceIndex] = undefined;
    }
    current.instanceHealth[instanceIndex] = restoredHealth;
    current.health = Math.max(0, ...current.instanceHealth);
    current.onCooldown = current.instanceOnCooldown.every((c) => c);
    (0, petalEvents_1.emitPetalRestored)(playerId, {
        playerId,
        slotIndex: loadoutIndex,
        instanceIndex,
        petal: current
    });
}
function getInstanceHealth(petal, instanceIndex, petalStats) {
    if (hasIndependentInstances(petalStats) && Array.isArray(petal.instanceHealth)) {
        return petal.instanceHealth[instanceIndex] ?? 0;
    }
    return petal.health ?? 0;
}
function setInstanceHealth(petal, instanceIndex, petalStats, value) {
    if (hasIndependentInstances(petalStats) && Array.isArray(petal.instanceHealth)) {
        petal.instanceHealth[instanceIndex] = value;
        // Keep petal.health reflecting the max across live instances so legacy UI/health bars
        // render a sensible value for the slot overall.
        petal.health = Math.max(0, ...petal.instanceHealth);
    }
    else {
        petal.health = value;
    }
}
/**
 * Has an on-cooldown petal/instance reached its restore deadline? Stamps one
 * when it's missing (returning false for this tick) rather than reading
 * "no deadline" as "expired" — see the backstop in the tick loop.
 */
function cooldownDeadlinePassed(petal, instanceIndex, petalStats, currentTime) {
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
function isInstanceOnCooldown(petal, instanceIndex, petalStats) {
    if (hasIndependentInstances(petalStats) && Array.isArray(petal.instanceOnCooldown)) {
        return !!petal.instanceOnCooldown[instanceIndex];
    }
    return !!petal.onCooldown;
}
// The orbit spring/damping/smoothing constants moved with the integrator; see
// PETAL_SPRING_FORCE and friends in ecs/systems/petalRing.ts.
// Healing-skill multiplier applied to all petal healing (passive and burst).
// Skills are disabled inside the PVP arena.
const HEAL_SKILL_MULTIPLIERS = {
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
function getHealingSkillMultiplier(player) {
    return !player.inPvpArena && player.skills?.healingMultiplier
        ? (HEAL_SKILL_MULTIPLIERS[player.skills.healingMultiplier] || 1.0)
        : 1.0;
}
function getEffectiveCooldown(petal, petalStats) {
    return (0, petals_1.getEffectivePetalCooldown)(petal.petalType, petal.rarity, petalStats);
}
function getSpongeAbsorbDuration(player) {
    let duration = 0;
    const loadout = player.loadout || [];
    for (let i = 0; i < loadout.length && i < 10; i++) {
        const petal = loadout[i];
        if (!petal || petal.type !== 'petal' || petal.petalType !== 'sponge' || !petal.rarity || petal.onCooldown)
            continue;
        const stats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
        if (stats?.spongeDamageDuration) {
            duration = Math.max(duration, stats.spongeDamageDuration);
        }
    }
    return duration;
}
function queueSpongeDamage(player, damage, durationMs, killedBy, sourcePlayerId) {
    if (damage <= 0 || durationMs <= 0)
        return;
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
function updateSpongeDamage(player, deltaTime, io) {
    if (!player.spongeDamageEffects?.length || player.isDead || player.isInvulnerable)
        return;
    let totalDamage = 0;
    const remainingEffects = [];
    for (const effect of player.spongeDamageEffects) {
        const damageThisFrame = Math.min(effect.remainingDamage, effect.damagePerSecond * deltaTime);
        if (damageThisFrame <= 0)
            continue;
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
    if (totalDamage <= 0)
        return;
    player.health -= totalDamage;
    player.lastDamageTime = Date.now();
    const secondChanceTriggered = player.health <= 0 && trySecondChance(player, io);
    if (secondChanceTriggered) {
        player.spongeDamageEffects = [];
    }
    (0, wireOutbox_1.getWireOutbox)().all('playerDamaged', {
        playerId: player.id,
        health: player.health,
        maxHealth: player.maxHealth,
        isInvulnerable: player.isInvulnerable
    });
}
/**
 * Clean up a departing player's petal bookkeeping.
 *
 * The SPRING STATE half of this is gone: petal kinematics live in the
 * `PetalRing` component on the player's entity, so they are released when
 * `syncToEcs` destroys the entity for a player who has left `players`. That is
 * the point of moving them — this function used to be the only thing standing
 * between a missed disconnect path and a permanently leaked ring, and it swept
 * by string prefix, so `"abc"` also matched `"abcdef"`'s petals.
 *
 * What remains is the damage-cooldown table, which is keyed by petal id but is
 * NOT petal kinematic state (it is combat bookkeeping, still legacy).
 */
function cleanupPetalPhysicsStates(playerId) {
    // Attacker-side keys (`${playerId}_${slot}_${inst}`) and player-vs-player
    // hit cooldowns, which key on BOTH sides
    // (`${attacker}_${slot}_${inst}_pvp_${victim}`) and so outlive the players
    // named in them. Bounded while PVP only happened inside the arena; with
    // corruption any two flowers in the world can mint one, so drop them
    // explicitly.
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
function getRaindropAuraRadius(player) {
    if (!player || !player.loadout)
        return 0;
    let bestRadius = 0;
    for (let i = 0; i < player.loadout.length && i < 10; i++) {
        const petal = player.loadout[i];
        if (!petal || petal.type !== 'petal' || petal.petalType !== 'raindrop' || !petal.rarity)
            continue;
        if (petal.onCooldown)
            continue;
        const rarityIndex = Math.max(0, (0, petals_1.getRarityIndex)(petal.rarity));
        const radius = RAINDROP_AURA_BASE_RADIUS + rarityIndex * RAINDROP_AURA_RADIUS_PER_RARITY;
        if (radius > bestRadius)
            bestRadius = radius;
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
function applyRaindropAuraDamage(player, deps) {
    if (!player || !player.loadout || player.isDead)
        return;
    // Pick the strongest equipped raindrop (highest rarity damage wins).
    let bestDamage = 0;
    let bestRadius = 0;
    for (let i = 0; i < player.loadout.length && i < 10; i++) {
        const petal = player.loadout[i];
        if (!petal || petal.type !== 'petal' || petal.petalType !== 'raindrop' || !petal.rarity)
            continue;
        if (petal.onCooldown)
            continue;
        const stats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
        if (!stats)
            continue;
        const rarityIndex = Math.max(0, (0, petals_1.getRarityIndex)(petal.rarity));
        const radius = RAINDROP_AURA_BASE_RADIUS + rarityIndex * RAINDROP_AURA_RADIUS_PER_RARITY;
        if (stats.damage > bestDamage)
            bestDamage = stats.damage;
        if (radius > bestRadius)
            bestRadius = radius;
    }
    if (bestRadius <= 0 || bestDamage <= 0)
        return;
    const now = Date.now();
    const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
    const finalDamage = bestDamage * damageMultiplier;
    let lastDamageMap = raindropAuraLastDamage.get(player.id);
    if (!lastDamageMap) {
        lastDamageMap = new Map();
        raindropAuraLastDamage.set(player.id, lastDamageMap);
    }
    const candidates = (0, enemyGrid_1.queryEnemiesNear)(player.x, player.y, bestRadius, _enemyQueryBuffer);
    for (let i = 0; i < candidates.length; i++) {
        const enemy = candidates[i];
        if ((0, mobFields_1.isMobDead)(enemy.entity))
            continue;
        const dx = (0, mobFields_1.mobX)(enemy.entity) - player.x;
        const dy = (0, mobFields_1.mobY)(enemy.entity) - player.y;
        const enemyRadius = (0, mobFields_1.mobRadiusOf)(enemy.entity) ?? (constants_1.ENEMY_SIZE / 2);
        const hitDist = bestRadius + enemyRadius;
        if (dx * dx + dy * dy >= hitDist * hitDist)
            continue;
        const lastDmg = lastDamageMap.get(enemy.id) || 0;
        if (now - lastDmg < RAINDROP_AURA_DAMAGE_INTERVAL_MS)
            continue;
        lastDamageMap.set(enemy.id, now);
        (0, utils_1.trackDamage)(enemy, player.id, finalDamage);
        (0, mobFields_1.damageMob)(enemy.entity, finalDamage);
        (0, utils_1.markEnemyDamaged)(enemy);
        if ((0, mobFields_1.mobHealth)(enemy.entity) <= 0 && !enemy.isDead) {
            (0, killHandler_1.killEnemy)(enemy, killCtxFromDeps(deps), {
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
function applyPetalRingDamage(player, io) {
    // Almost always empty (no glitch flower alive nearby), so this is the cost
    // of the feature for everyone else.
    if (enemyGrid_1.petalRingEnemies.length === 0)
        return;
    if (!player || player.isDead)
        return;
    const playerRadius = (constants_1.PLAYER_SIZE / 2) * (player.sizeMultiplier ?? 1.0);
    const now = Date.now();
    for (let i = 0; i < enemyGrid_1.petalRingEnemies.length; i++) {
        const enemy = enemyGrid_1.petalRingEnemies[i];
        if ((0, mobFields_1.isMobDead)(enemy.entity))
            continue;
        const mobRadius = (0, mobFields_1.mobRadiusOf)(enemy.entity) ?? (constants_1.ENEMY_SIZE / 2);
        const orbitRadius = mobRadius * mobs_1.PETAL_RING_ORBIT_SCALE;
        const petalRadius = mobRadius * mobs_1.PETAL_RING_HIT_SCALE;
        const dx = player.x - (0, mobFields_1.mobX)(enemy.entity);
        const dy = player.y - (0, mobFields_1.mobY)(enemy.entity);
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(distance - orbitRadius) > petalRadius + playerRadius)
            continue;
        // Infection is a property of touch, so it lands even when the hit itself
        // is on cooldown or the player is invulnerable — same rule as bouncing
        // off a glitch mob's body.
        if ((0, server_utils_1.isGlitchInfectingType)(enemy.type))
            player.glitched = true;
        if (now - (petalRingLastHit.get(player.id) ?? 0) < mobs_1.PETAL_RING_HIT_INTERVAL_MS)
            continue;
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
            const shieldAmount = (0, petal_actions_1.getShieldAmount)(player);
            const damageToPlayer = Math.max(0, (0, mobFields_1.mobDamage)(enemy.entity) - shieldAmount);
            const spongeDuration = getSpongeAbsorbDuration(player);
            if (damageToPlayer > 0 && spongeDuration > 0) {
                queueSpongeDamage(player, damageToPlayer, spongeDuration, { type: enemy.type, tier: enemy.tier });
                player.isInvulnerable = true;
                setTimeout(() => {
                    if (constants_1.players[player.id]) {
                        constants_1.players[player.id].isInvulnerable = false;
                        (0, wireOutbox_1.getWireOutbox)().all('playerInvulnerabilityEnded', { playerId: player.id });
                    }
                }, 50);
            }
            else {
                player.health -= damageToPlayer;
                player.lastDamageTime = now;
                if (!(player.health <= 0 && trySecondChance(player, io))) {
                    if (player.health <= 0) {
                        player.killedBy = { type: enemy.type, tier: enemy.tier };
                    }
                    player.isInvulnerable = true;
                    setTimeout(() => {
                        if (constants_1.players[player.id]) {
                            constants_1.players[player.id].isInvulnerable = false;
                            (0, wireOutbox_1.getWireOutbox)().all('playerInvulnerabilityEnded', { playerId: player.id });
                        }
                    }, 50);
                }
            }
        }
        (0, wireOutbox_1.getWireOutbox)().all('playerDamaged', {
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
/**
 * Get viewports for all players
 *
 * Cached with a sub-tick TTL: callers invoke this per ENEMY (viewport counting,
 * spawn checks — ~1400 calls per pass), and each call used to walk the whole
 * `players` dictionary and allocate a fresh array. Players don't move within a
 * tick, so one snapshot per half-tick is exact for every existing caller.
 * Callers must treat the result as read-only (all current ones do).
 */
const _viewportCache = [];
let _viewportCacheAt = -1;
const VIEWPORT_CACHE_TTL_MS = 16;
function getPlayerViewports() {
    const now = Date.now();
    if (now - _viewportCacheAt < VIEWPORT_CACHE_TTL_MS)
        return _viewportCache;
    _viewportCacheAt = now;
    _viewportCache.length = 0;
    for (const playerId in constants_1.players) {
        // Bots don't dictate enemy spawn budget — otherwise 17 bots clustered
        // around one human would ~18x the spawned mob count.
        if (playerId.startsWith('bot_'))
            continue;
        const player = constants_1.players[playerId];
        if (player && player.x !== undefined && player.y !== undefined &&
            !isNaN(player.x) && !isNaN(player.y) &&
            player.x >= 0 && player.x <= constants_1.ACTUAL_WORLD_WIDTH &&
            player.y >= 0 && player.y <= constants_1.ACTUAL_WORLD_HEIGHT) {
            // Use per-player viewport size if available, otherwise fall back to default
            const vpWidth = player.viewportWidth || constants_1.VIEWPORT_WIDTH;
            const vpHeight = player.viewportHeight || constants_1.VIEWPORT_HEIGHT;
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
const _nearBoxes = [];
let _nearBoxesAt = -1;
let _nearBoxesSawPlayer = false;
function isPositionNearAnyPlayer(x, y) {
    const now = Date.now();
    if (now - _nearBoxesAt >= VIEWPORT_CACHE_TTL_MS) {
        _nearBoxesAt = now;
        _nearBoxes.length = 0;
        _nearBoxesSawPlayer = false;
        for (const playerId in constants_1.players) {
            if (playerId.startsWith('bot_'))
                continue;
            const player = constants_1.players[playerId];
            if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y))
                continue;
            _nearBoxesSawPlayer = true;
            _nearBoxes.push(player.x, player.y, (player.viewportWidth || constants_1.VIEWPORT_WIDTH) / 2 + constants_1.VIEWPORT_BUFFER, (player.viewportHeight || constants_1.VIEWPORT_HEIGHT) / 2 + constants_1.VIEWPORT_BUFFER);
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
/**
 * Flat box cache backing both viewport tests — same rationale (and shape) as
 * `_nearBoxes` above, which already took this treatment after the dictionary
 * walk measured ~6% of server CPU.
 *
 * These two tests had been left on the object-array path: every call re-entered
 * getPlayerViewports() for a Date.now() + TTL check, then walked an array of
 * `{x,y,width,height}` objects re-deriving `x - BUFFER` / `x + width + BUFFER`
 * per box. Called per enemy per pass (~1600 enemies × 30Hz), a CPU profile at
 * 63 players put the pair at 4.7% of wall — ~19% of all non-idle time, second
 * only to enemy spawning.
 *
 * The box is symmetric around the player once expanded (minX = px - vw/2 - BUF,
 * maxX = px + vw/2 + BUF), so it stores as centre + half-extent and the test is
 * two abs-compares against precomputed numbers. Stride 6: cx, cy, then the 100%
 * and 200% half-extents, so one rebuild serves both callers.
 */
const _vpBoxes = [];
let _vpBoxesAt = -1;
let _vpSawPlayer = false;
function refreshViewportBoxes() {
    const now = Date.now();
    if (now - _vpBoxesAt < VIEWPORT_CACHE_TTL_MS)
        return;
    _vpBoxesAt = now;
    _vpBoxes.length = 0;
    _vpSawPlayer = false;
    // Filtering MUST match getPlayerViewports exactly — bots excluded (they
    // must not inflate the spawn budget) and world-rect clamped.
    for (const playerId in constants_1.players) {
        if (playerId.startsWith('bot_'))
            continue;
        const player = constants_1.players[playerId];
        if (!player || player.x === undefined || player.y === undefined ||
            isNaN(player.x) || isNaN(player.y) ||
            player.x < 0 || player.x > constants_1.ACTUAL_WORLD_WIDTH ||
            player.y < 0 || player.y > constants_1.ACTUAL_WORLD_HEIGHT)
            continue;
        _vpSawPlayer = true;
        const halfW = (player.viewportWidth || constants_1.VIEWPORT_WIDTH) / 2;
        const halfH = (player.viewportHeight || constants_1.VIEWPORT_HEIGHT) / 2;
        _vpBoxes.push(player.x, player.y, halfW + constants_1.VIEWPORT_BUFFER, halfH + constants_1.VIEWPORT_BUFFER, halfW + constants_1.VIEWPORT_BUFFER * 2, halfH + constants_1.VIEWPORT_BUFFER * 2);
    }
}
/** @internal Shared by both viewport tests; `o` picks the 100% (2) or 200% (4) half-extent pair. */
function inAnyViewportBox(x, y, o) {
    for (let i = 0; i < _vpBoxes.length; i += 6) {
        const dx = x - _vpBoxes[i];
        const dy = y - _vpBoxes[i + 1];
        if ((dx < 0 ? -dx : dx) <= _vpBoxes[i + o] && (dy < 0 ? -dy : dy) <= _vpBoxes[i + o + 1]) {
            return true;
        }
    }
    // No players connected: allow spawning anywhere (initial server startup).
    return !_vpSawPlayer;
}
function isPositionInAnyViewport(x, y) {
    refreshViewportBoxes();
    return inAnyViewportBox(x, y, 2);
}
/**
 * Check if a position is in any player's viewport with 200% buffer (for websocket optimization)
 */
function isPositionInAnyViewport200Percent(x, y) {
    refreshViewportBoxes();
    return inAnyViewportBox(x, y, 4);
}
/**
 * Filter enemies to only include those in any player's viewport with 200% buffer
 */
function getEnemiesInViewport200Percent() {
    // Same hoist as getEnemiesInViewportCount — one TTL check for the pass.
    refreshViewportBoxes();
    if (!_vpSawPlayer)
        return (0, enemyRegistry_1.liveEnemies)().slice();
    const out = [];
    for (let i = 0; i < (0, enemyRegistry_1.liveEnemies)().length; i++) {
        const e = (0, enemyRegistry_1.liveEnemies)()[i];
        if (inAnyViewportBox((0, mobFields_1.mobX)(e.entity), (0, mobFields_1.mobY)(e.entity), 4))
            out.push(e);
    }
    return out;
}
/**
 * Check if a position is within any player's petal range
 */
function isPositionInPlayerPetalRange(x, y, mobSize) {
    // Check if the mob spawn position would overlap with any player's petal range
    for (const playerId in constants_1.players) {
        const player = constants_1.players[playerId];
        if (!player || !player.loadout)
            continue;
        // Calculate player's maximum petal range
        const petalExtension = player.inputs?.petalExtension || 1.0;
        const sizeMult = player.sizeMultiplier ?? 1.0;
        const baseRadius = (60 + (constants_1.PLAYER_SIZE / 2) * (sizeMult - 1)) * petalExtension;
        // Find the largest petal size and range in the player's loadout.
        // Secondary loadout (slots 10+) is storage only — those petals are not in orbit.
        const playerRangeMod = (0, playerManager_1.calculatePlayerModifiers)(player).range ?? 1.0;
        let maxPetalSize = 0;
        let maxPetalRange = 1.0;
        for (let i = 0; i < player.loadout.length && i < 10; i++) {
            const item = player.loadout[i];
            if (item && item.type === 'petal' && item.petalType && item.rarity) {
                const petalStats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
                if (petalStats) {
                    const effectiveSize = item.customSize !== undefined ? item.customSize : petalStats.size;
                    const petalSize = 40 * effectiveSize;
                    maxPetalSize = Math.max(maxPetalSize, petalSize);
                    const petalRange = (petalStats.range ?? 1.0) * playerRangeMod;
                    maxPetalRange = Math.max(maxPetalRange, petalRange);
                }
            }
        }
        // Calculate the maximum range from player center (base radius * max range multiplier + half petal size + half mob size)
        // Ensure mobs never spawn on top of the player body (PLAYER_SIZE/2 + mobSize/2 + buffer)
        const minBodyRange = constants_1.PLAYER_SIZE / 2 + mobSize / 2 + 20;
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
 * Get count of liveEnemies() in viewport
 */
function getEnemiesInViewportCount() {
    // Refresh once for the whole pass rather than per enemy: the per-call
    // variant re-checks Date.now() against the cache TTL every time, which at
    // ~1600 enemies is 1600 clock reads for one pass.
    refreshViewportBoxes();
    // If no players are connected, count all enemies (initial server startup).
    if (!_vpSawPlayer)
        return (0, enemyRegistry_1.liveEnemies)().length;
    let count = 0;
    for (let i = 0; i < (0, enemyRegistry_1.liveEnemies)().length; i++) {
        if (inAnyViewportBox((0, mobFields_1.mobX)((0, enemyRegistry_1.liveEnemies)()[i].entity), (0, mobFields_1.mobY)((0, enemyRegistry_1.liveEnemies)()[i].entity), 2))
            count++;
    }
    return count;
}
/**
 * Validate and fix invalid player positions
 */
function validatePlayerPositions(io) {
    // Clean up any invalid player positions that might affect viewport calculations
    for (const playerId in constants_1.players) {
        const player = constants_1.players[playerId];
        if (player) {
            // Reset invalid positions to a safe default. PVP-arena and maze
            // coordinates sit outside the regular world but are still valid.
            const inArena = (0, constants_1.isInPvpArena)(player.x, player.y)
                || (0, maze_1.isInMazeRegion)(player.x, player.y);
            if (!inArena && (isNaN(player.x) || isNaN(player.y) ||
                player.x < 0 || player.x > constants_1.ACTUAL_WORLD_WIDTH ||
                player.y < 0 || player.y > constants_1.ACTUAL_WORLD_HEIGHT)) {
                if (!playerId.startsWith('bot_')) {
                    console.log(`[SERVER] Fixing invalid position for player ${playerId}: (${player.x}, ${player.y})`);
                }
                // Reset to center of world
                player.x = constants_1.ACTUAL_WORLD_WIDTH / 2;
                player.y = constants_1.ACTUAL_WORLD_HEIGHT / 2;
                // Notify client of position correction
                (0, wireOutbox_1.getWireOutbox)().toSocket(playerId, 'positionCorrected', { x: player.x, y: player.y });
            }
        }
    }
}
/** Second Chance invulnerability durations per tier (seconds). */
const SECOND_CHANCE_DURATIONS = {
    common: 0.3,
    uncommon: 1.5,
};
/** Second Chance cooldown per tier (seconds). */
const SECOND_CHANCE_COOLDOWNS = {
    common: 60,
    uncommon: 30,
};
/**
 * Check if Second Chance should activate after taking damage. If the player
 * has the secondChance skill, it's off cooldown, and health has dropped to 0
 * or below, set health to 1 and grant invulnerability.
 * Returns true if second chance was triggered.
 */
function trySecondChance(player, io) {
    if (player.health > 0)
        return false;
    // Skills are disabled inside the PVP arena.
    if (player.inPvpArena)
        return false;
    const tier = player.skills?.secondChance;
    if (!tier)
        return false;
    const duration = SECOND_CHANCE_DURATIONS[tier];
    if (!duration)
        return false;
    // Check cooldown
    const now = Date.now();
    if (player.secondChanceCooldownUntil && now < player.secondChanceCooldownUntil)
        return false;
    player.health = 1;
    player.isInvulnerable = true;
    // Set cooldown
    const cooldownSec = SECOND_CHANCE_COOLDOWNS[tier] ?? 60;
    player.secondChanceCooldownUntil = now + cooldownSec * 1000;
    // Grant invulnerability for the skill's duration
    const durationMs = duration * 1000;
    setTimeout(() => {
        if (constants_1.players[player.id]) {
            constants_1.players[player.id].isInvulnerable = false;
            (0, wireOutbox_1.getWireOutbox)().all('playerInvulnerabilityEnded', { playerId: player.id });
        }
    }, durationMs);
    (0, wireOutbox_1.getWireOutbox)().all('playerDamaged', {
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
function applyPvpDamage(attacker, victim, damage, io, savePlayerProgress) {
    if (victim.isDead || victim.isInvulnerable)
        return;
    if (damage <= 0)
        return;
    const shieldAmount = (0, petal_actions_1.getShieldAmount)(victim);
    const damageToVictim = Math.max(0, damage - shieldAmount);
    const spongeDuration = getSpongeAbsorbDuration(victim);
    victim.lastDamagedByPlayerId = attacker.id;
    if (damageToVictim > 0 && spongeDuration > 0) {
        queueSpongeDamage(victim, damageToVictim, spongeDuration, { type: 'player', tier: 'common' }, attacker.id);
        victim.isInvulnerable = true;
        setTimeout(() => {
            if (constants_1.players[victim.id]) {
                constants_1.players[victim.id].isInvulnerable = false;
                (0, wireOutbox_1.getWireOutbox)().all('playerInvulnerabilityEnded', { playerId: victim.id });
            }
        }, 50);
    }
    else {
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
            if (constants_1.players[victim.id]) {
                constants_1.players[victim.id].isInvulnerable = false;
                (0, wireOutbox_1.getWireOutbox)().all('playerInvulnerabilityEnded', { playerId: victim.id });
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
    // NOT `victim.x += ...`. This runs inside the ATTACKER's updatePlayerState,
    // so for a victim the player loop has not reached yet the write would sit in
    // the gap between the movement window and that victim's own commit, and be
    // thrown away by `player.x = newX`. See displacePlayer in server/ecsSync.
    (0, ecsSync_1.displacePlayer)(victim, knockbackX, knockbackY);
    (0, wireOutbox_1.getWireOutbox)().all('playerDamaged', {
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
            if (!attacker.inventory)
                attacker.inventory = [];
            for (let i = 0; i < victimGains.length; i += 3) {
                const rarityId = victimGains[i];
                const itemId = victimGains[i + 1];
                const count = victimGains[i + 2];
                const rarity = inventoryCodec_1.ID_TO_RARITY.get(rarityId);
                const itemKey = inventoryCodec_1.ID_TO_ITEM_KEY.get(itemId);
                if (rarity && itemKey) {
                    (0, playerManager_1.addItem)(attacker.inventory, rarity, itemKey, count);
                }
            }
            // A splitter half has no socket of its own — address the owner.
            io.to((0, utils_1.getOriginalSocketId)(attacker.id)).emit('inventoryUpdated', attacker.inventory);
        }
        if (victim.inPvpArena) {
            victim.inventory = [];
            io.to((0, utils_1.getOriginalSocketId)(victim.id)).emit('inventoryUpdated', victim.inventory);
        }
        // Mark dead immediately so passive-heal can't revive the victim before
        // their own update tick runs the standard death handler.
        victim.isDead = true;
        victim.angle = Math.random() * Math.PI * 2;
        (0, petal_actions_1.despawnAllPlayerPets)(victim.id, io);
        (0, wireOutbox_1.getWireOutbox)().all('playerDied', {
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
function applyPassiveHealing(player, deltaTime) {
    if (!player.isDead) {
        let totalPassiveHeal = 1.0 * deltaTime; // Base passive heal: 1 HP/sec
        const loadout = player.loadout || [];
        // Secondary loadout (slots 10+) is storage only — its petals don't heal.
        for (let i = 0; i < loadout.length && i < 10; i++) {
            const petal = loadout[i];
            if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
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
 * The unclamped effective speed multiplier for this player.
 *
 * This was the first three lines of `computeTargetVelocity`, which the ECS
 * `playerMovement` system now replaces. It stays here — and is exported —
 * because the ECS may not import petal_actions.ts (it binds port 3000 at module
 * scope), so server.ts injects this into the sync layer instead. The CLAMP that
 * used to live alongside it moved into the system with the rest of the maths.
 *
 * When the `playerModifiers` system is enabled this function and its injection
 * both disappear; until then it is the single definition of the value, so bot
 * standoff maths and movement cannot disagree about it.
 */
function computeSpeedBoost(player) {
    return player.speed_boost * (0, petal_actions_1.getSpeedMultiplier)(player);
}
/**
 * The per-player work that used to run BEFORE movement inside
 * `updatePlayerState`, lifted out so it still runs before movement now that
 * movement is a batched ECS pass over every player at once.
 *
 * Splitting it out is not cosmetic. `applyPetalRingDamage` writes `player.x/y`
 * DIRECTLY (a glitch flower's ring knocks you off it), and `updatePlayerEffects`
 * expires the speed_boost effects that decide this tick's speed factor — both
 * are inputs to the integration step, so both have to land on the same side of
 * it they always did. Everything else here is health bookkeeping and mob damage
 * that movement does not read.
 *
 * Called once per player, for every player, immediately before the movement
 * window opens. See runSimulationStep.
 */
function updatePlayerPreMovement(player, deltaTime, deps) {
    // The same guards updatePlayerState opens with, so the two halves agree on
    // exactly which flowers are live this tick.
    if (!player || !player.inputs)
        return;
    if (player.isDead)
        return;
    const { io } = deps;
    (0, petal_actions_1.updatePlayerEffects)(player, deltaTime);
    updateSpongeDamage(player, deltaTime, io);
    applyPassiveHealing(player, deltaTime);
    // Apply raindrop aura damage to mobs around the player
    applyRaindropAuraDamage(player, deps);
    // ...and the reverse: a glitch flower's petal ring sweeping through the player.
    applyPetalRingDamage(player, io);
}
/**
 * The stat lookup the ring layout is driven by.
 *
 * `getPetalStats` returns the full `PetalStats`, of which `PetalRingStats` is a
 * structural subset — so this is a widening, not a conversion. Hoisted to module
 * scope so the ring layout does not allocate a closure per player per tick.
 */
function ringStatsOf(slot) {
    return (0, petals_1.getPetalStats)(slot.petalType, slot.rarity);
}
/**
 * Expand the loadout into one entry per petal instance, assigning each an orbit
 * slot, and run the per-instance spawn side effects.
 *
 * The slot ASSIGNMENT is `ecs/systems/petalRing.layoutPetalRing` — one source of
 * truth, because the same expansion decides the ring divisor, which instance
 * indices the kinematic store is keyed by, and which orbit angle a pollen puff
 * is dropped at. What stays here is the pair of side effects the ECS has no
 * business doing: sizing the per-instance health arrays that live on the loadout
 * ITEM (persisted, and carried across the cross-server portal) and seeding the
 * petal action VM.
 *
 * Returns the instances and the number of slots consumed (the ring divisor).
 */
function buildPetalInstances(player, io) {
    const petalInstances = [];
    let nextSlotIndex = 0;
    try {
        nextSlotIndex = (0, petalRing_1.layoutPetalRing)(player.loadout, ringStatsOf, petalInstances);
        // Second pass for the side effects. Splitting them out of the expansion
        // is what lets the expansion itself be pure and shared; the order is
        // unchanged because `layoutPetalRing` emits instances in exactly the
        // loadout-then-count order the single loop used to.
        let lastSizedPetal = null;
        for (let k = 0; k < petalInstances.length; k++) {
            const { petal, loadoutIndex: i, instanceIndex: j } = petalInstances[k];
            const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
            if (!petalStats)
                continue;
            // Once per SLOT, on its first instance — `ensureInstanceArrays` is
            // idempotent, but calling it per instance would re-check the array
            // lengths `count` times for every slot of every player every tick.
            if (petal !== lastSizedPetal) {
                ensureInstanceArrays(petal, petalStats);
                lastSizedPetal = petal;
            }
            // Execute petal actions immediately when spawned
            if ((0, petal_actions_1.hasPetalBehaviour)(petal.petalType)) {
                const petalId = `${player.id}_${i}_${j}`;
                const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
                const actionContext = {
                    player: player,
                    petalX: player.x, // Will be updated with actual position in game loop
                    petalY: player.y, // Will be updated with actual position in game loop
                    petalSize: effectiveSize * 40,
                    petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                    enemies: (0, enemyRegistry_1.liveEnemies)(),
                    io: io,
                    petalId: petalId,
                    loadoutIndex: i,
                    instanceIndex: j
                };
                (0, petal_actions_1.armPetalBehaviour)(petal.petalType, actionContext);
            }
        }
    }
    catch (error) {
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
function dropFieldsOnExtension(opts) {
    const { player, io, groundEffects, petalInstances, geom } = opts;
    const playerExt = player.inputs?.petalExtension || 1.0;
    if (playerExt !== 1.0) {
        const dropsToBreak = [];
        for (let idx = 0; idx < petalInstances.length; idx++) {
            const { petal, instanceIndex, slotIndex } = petalInstances[idx];
            if (!petal)
                continue;
            const isPollen = petal.petalType === 'pollen';
            const stats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
            if (!stats)
                continue;
            const isWeb = !!stats.webRadius;
            if (!isPollen && !isWeb)
                continue;
            if (isInstanceOnCooldown(petal, instanceIndex, stats))
                continue;
            if (getInstanceHealth(petal, instanceIndex, stats) <= 0)
                continue;
            const eSize = petal.customSize !== undefined ? petal.customSize : stats.size;
            // The SAME orbit-point function the petal loop steps against, so a
            // puff lands exactly where its petal was rather than at a
            // separately-maintained copy of the formula that can drift from it.
            // (Web is defendOnly, so it is sitting at its unextended orbit radius
            // when the throw starts — `petalOrbitTarget` applies that rule.)
            (0, petalRing_1.petalOrbitTarget)(geom, stats, slotIndex, instanceIndex, eSize, _dropTargetScratch);
            const totalAngle = _dropTargetScratch.angle;
            let dropX = _dropTargetScratch.x;
            let dropY = _dropTargetScratch.y;
            if (isWeb) {
                // Throwing (attacking) flings it outward along the petal's
                // own bearing; defending plants it in place.
                if (playerExt > 1.0) {
                    dropX += Math.cos(totalAngle) * gameState_1.WEB_THROW_DISTANCE;
                    dropY += Math.sin(totalAngle) * gameState_1.WEB_THROW_DISTANCE;
                }
                spawnWebField(io, groundEffects, player, stats.webRadius, petal.rarity ?? 'common', dropX, dropY);
            }
            else {
                spawnGroundPollen(io, groundEffects, player, stats, petal, dropX, dropY, 12 * eSize);
            }
            dropsToBreak.push({ petal, instanceIndex, stats });
        }
        for (const d of dropsToBreak) {
            setInstanceHealth(d.petal, d.instanceIndex, d.stats, 0);
        }
    }
}
/**
 * Player-vs-mob body contact: knockback, damage both ways, poison, and the kill.
 *
 * Lifted verbatim out of `updatePlayerState`, which is a ~1700-line sequential
 * pipeline (contact -> petals -> pickups -> wall clamps -> teleporters -> commit)
 * run one player at a time. That per-player sequencing is load-bearing and is
 * why this is a FUNCTION rather than an ECS system: a system is a pass over all
 * players, so promoting this block would resolve every player's contact before
 * any player's petals, and one player could then no longer kill a mob out from
 * under another's contact within the same tick. Extracting it behind a seam
 * makes the block testable and gives the eventual ECS move somewhere to land,
 * without changing the interleaving.
 *
 * Operates on the STAGED position (`startX`/`startY`, i.e. `player.movedX`)
 * and returns where knockback left it; the caller keeps committing to
 * `player.x`/`player.y` at the end of the pipeline, exactly as before.
 *
 * Only the FIRST colliding mob is processed — the original `break`s out of the
 * candidate loop on contact, so a player wedged between two mobs takes one hit
 * per tick, not one per mob.
 */
function resolvePlayerMobContact(player, startX, startY, effectivePlayerSize, deps) {
    const { io } = deps;
    // Spatial-grid broad-phase: only test enemies whose center is within
    // (playerRadius + maxEnemyRadius). Pets and dead enemies are excluded by the grid.
    let newX = startX;
    let newY = startY;
    const _playerRadius = effectivePlayerSize / 2;
    const _candidates = (0, enemyGrid_1.queryEnemiesNear)(newX, newY, _playerRadius, _enemyQueryBuffer);
    for (let _ci = 0; _ci < _candidates.length; _ci++) {
        const enemy = _candidates[_ci];
        const collisionInfo = (0, physics_1.checkPlayerEnemyCollision)(newX, newY, effectivePlayerSize, enemy);
        if (collisionInfo.collided) {
            // Don't interact with dead players (corpses)
            if (!player.isDead) {
                // Calculate knockback direction
                const dx = (0, mobFields_1.mobX)(enemy.entity) - newX;
                const dy = (0, mobFields_1.mobY)(enemy.entity) - newY;
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
                if ((0, server_utils_1.isGlitchInfectingType)(enemy.type))
                    player.glitched = true;
                // Only apply damage when not invulnerable
                if (!player.isInvulnerable && enemy.type !== 'item_spawner') {
                    const shieldAmount = (0, petal_actions_1.getShieldAmount)(player);
                    const damageToPlayer = Math.max(0, (0, mobFields_1.mobDamage)(enemy.entity) - shieldAmount);
                    const spongeDuration = getSpongeAbsorbDuration(player);
                    if (damageToPlayer > 0 && spongeDuration > 0) {
                        queueSpongeDamage(player, damageToPlayer, spongeDuration, { type: enemy.type, tier: enemy.tier });
                        player.isInvulnerable = true;
                        setTimeout(() => {
                            if (constants_1.players[player.id]) {
                                constants_1.players[player.id].isInvulnerable = false;
                                (0, wireOutbox_1.getWireOutbox)().all('playerInvulnerabilityEnded', { playerId: player.id });
                            }
                        }, 50);
                    }
                    else {
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
                                if (constants_1.players[player.id]) {
                                    constants_1.players[player.id].isInvulnerable = false;
                                    // Notify client that invulnerability has ended
                                    (0, wireOutbox_1.getWireOutbox)().all('playerInvulnerabilityEnded', { playerId: player.id });
                                }
                            }, 50);
                        }
                    }
                    // Poisonous mobs (evil centipede) leave poison on contact.
                    // One stack: a fresh bite replaces whatever was ticking.
                    const mobStats = (0, mobFields_1.mobStatsOf)(enemy.entity) ?? (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                    if (mobStats?.poison && mobStats.poisonDuration) {
                        player.poisonDamage = mobStats.poison * 1000; // per-ms -> per-second
                        player.poisonUntil = Date.now() + mobStats.poisonDuration;
                        player.poisonSource = { type: enemy.type, tier: enemy.tier };
                    }
                }
                // Always emit knockback (and current health state)
                (0, wireOutbox_1.getWireOutbox)().all('playerDamaged', {
                    playerId: player.id,
                    health: player.health,
                    maxHealth: player.maxHealth,
                    isInvulnerable: player.isInvulnerable,
                    knockbackX: knockbackX,
                    knockbackY: knockbackY
                });
                // Track damage dealt by this player (always track, even if enemy is dead)
                (0, utils_1.trackDamage)(enemy, player.id, player.damage);
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
                if (enemy.isDead) {
                    continue;
                }
                (0, mobFields_1.damageMob)(enemy.entity, player.damage);
                // Mark enemy for batched damage update at end of frame
                (0, utils_1.markEnemyDamaged)(enemy);
                if ((0, mobFields_1.mobHealth)(enemy.entity) <= 0 && !enemy.isDead) {
                    const index = (0, enemyRegistry_1.liveEnemies)().findIndex(e => e.id === enemy.id);
                    // Original gated the entire death sequence on the enemy still
                    // being in the array (it can already be gone if another damage
                    // source finished it this tick). killEnemy handles a -1 index
                    // by skipping just the splice, so preserve the gate here.
                    if (index !== -1) {
                        (0, killHandler_1.killEnemy)(enemy, killCtxFromDeps(deps), {
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
    return { x: newX, y: newY };
}
/**
 * Item pickups for one player, at their staged position.
 *
 * Second slice lifted out of `updatePlayerState` (see resolvePlayerMobContact
 * for why these are functions rather than ECS systems). Reads and writes
 * nothing positional — pickups do not move the player — so unlike contact it
 * returns nothing and can be called with the staged coordinates directly.
 *
 * Kept verbatim, including the two lazy `require`s inside the loop: both reach
 * back into modules that import this one, and hoisting them to the top would
 * close a cycle.
 */
/** Reused payload buffer for the pickup pass; see collectWorldItems. */
const _pickupItemScratch = [];
function resolvePlayerItemPickups(player, newX, newY, deps) {
    // `savePlayerProgress` came from the enclosing function's destructure of
    // `deps`; pulled in here for the same reason `io` is.
    const { io, savePlayerProgress } = deps;
    // Check for item collisions (independent of enemy collisions)
    // Optimize: use squared distance comparison to avoid Math.sqrt
    const pickupSize = constants_1.PLAYER_SIZE * (player.sizeMultiplier ?? 1.0) + (player.magnetism ?? 0);
    const pickupRadiusSquared = pickupSize * pickupSize;
    // Items are ECS entities; the payloads are collected into a reused buffer so
    // removing one mid-loop can never disturb the iteration.
    const pickupItems = (0, itemRegistry_1.collectWorldItems)(_pickupItemScratch);
    for (let i = pickupItems.length - 1; i >= 0; i--) {
        const item = pickupItems[i];
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
                }
                else {
                    // Check if this player is part of a split pair
                    const { splitPlayers } = require('../petal_actions');
                    const originalId = player.id.replace('_split2', '').replace('_split1', '');
                    const splitState = splitPlayers.get(originalId);
                    if (splitState) {
                        // Player is split - check if any of the split player IDs or original ID is eligible
                        isEligible = item.eligiblePlayers.includes(splitState.player1.id) ||
                            item.eligiblePlayers.includes(splitState.player2.id) ||
                            item.eligiblePlayers.includes(originalId);
                    }
                    else {
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
                const rarityIdx = (0, petals_1.getRarityIndex)(rarity);
                if (rarityIdx >= 0) {
                    rarity = petals_1.RARITY_LEVELS[Math.min(rarityIdx + 1, petals_1.RARITY_LEVELS.length - 1)];
                }
            }
            (0, playerManager_1.addItem)(player.inventory, rarity, itemKey, 1);
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
                }
                else if (splitState.player2.id === player.id) {
                    splitState.player1.inventory = player.inventory;
                }
            }
            // Emit events to update client
            // Map split player IDs to original socket IDs for socket room targeting
            const { getOriginalSocketId } = require('./utils');
            const originalSocketId = getOriginalSocketId(player.id);
            (0, wireOutbox_1.getWireOutbox)().toSocket(originalSocketId, 'itemPickedUp', item.id);
            io.to(originalSocketId).emit('inventoryUpdated', player.inventory);
            // Save player progress to persist inventory changes
            const userId = gameState_1.playerUserIds[player.id];
            if (userId) {
                savePlayerProgress(player, userId);
            }
            // Remove item from world if all eligible players have picked it up
            if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
                const allPickedUp = item.eligiblePlayers.every(playerId => item.pickedUpBy && item.pickedUpBy.has(playerId));
                if (allPickedUp) {
                    // No expiry timer to clear any more: the deadline lives on the
                    // entity, and destroying it retires deadline and item together.
                    // No notification needed: the item leaves the entity stream,
                    // and every client that could see it gets it on their removal
                    // list next frame.
                    (0, itemRegistry_1.removeWorldItem)(item);
                }
            }
        }
    }
}
/**
 * Keep a player inside the region they are supposed to be in.
 *
 * Third slice out of `updatePlayerState` (see resolvePlayerMobContact for why
 * these are functions and not ECS systems). Pure position arithmetic: takes the
 * staged position and returns the clamped one, touching nothing else.
 *
 * Both clamps are safety nets rather than the primary containment — the maze's
 * border ring is solid wall and the arena is only leavable through its exit
 * teleporter — so they exist to catch knockback and teleport edge cases that
 * would otherwise strand someone outside the world.
 */
function clampPlayerToRegion(player, startX, startY) {
    // Maze players stay inside the maze region. The maze's border ring is
    // solid wall so collision already contains them — this is a safety net
    // against knockback/teleport edge cases ejecting someone into the void.
    let newX = startX;
    let newY = startY;
    if (player.inMaze) {
        const mazeNow = (0, maze_1.getActiveMaze)();
        if (mazeNow) {
            const margin = constants_1.PLAYER_SIZE / 2;
            newX = Math.max(maze_1.MAZE_ORIGIN_X + margin, Math.min(maze_1.MAZE_ORIGIN_X + mazeNow.worldSize - margin, newX));
            newY = Math.max(maze_1.MAZE_ORIGIN_Y + margin, Math.min(maze_1.MAZE_ORIGIN_Y + mazeNow.worldSize - margin, newY));
        }
    }
    // Clamp position to the PVP arena boundary if the player is currently inside it.
    // Players can only leave via the central exit teleporter — never by walking out.
    if (player.inPvpArena) {
        const dxArena = newX - constants_1.PVP_ARENA_CENTER_X;
        const dyArena = newY - constants_1.PVP_ARENA_CENTER_Y;
        const distSqArena = dxArena * dxArena + dyArena * dyArena;
        const maxR = constants_1.PVP_ARENA_RADIUS - constants_1.PLAYER_SIZE / 2;
        if (distSqArena > maxR * maxR) {
            const distArena = Math.sqrt(distSqArena) || 1;
            newX = constants_1.PVP_ARENA_CENTER_X + (dxArena / distArena) * maxR;
            newY = constants_1.PVP_ARENA_CENTER_Y + (dyArena / distArena) * maxR;
        }
    }
    return { x: newX, y: newY };
}
/**
 * Teleporter entry, the 1-second dwell, and the jump itself.
 *
 * Fourth slice out of `updatePlayerState` (see resolvePlayerMobContact for why
 * these are functions and not ECS systems).
 *
 * `transferred` is the important part of the return: a teleporter pointing at
 * ANOTHER server hands the player off asynchronously and the original code
 * `return`ed straight out of `updatePlayerState`, skipping the arena
 * enter/exit check and — critically — the final commit to `player.x`/`player.y`.
 * A player mid-transfer must not have their position written, so the caller
 * returns too rather than falling through.
 */
function resolvePlayerTeleporters(player, startX, startY, deltaTime, deps) {
    const { io, transferPlayerToServer, currentServerConfig, currentServerPort, useHttps, database } = deps;
    let newX = startX;
    let newY = startY;
    // Check for teleporter interactions
    let currentTeleporter = null;
    const currentTime = Date.now();
    const isOnCooldown = player.teleportCooldown && currentTime < player.teleportCooldown;
    for (const element of map_data_1.WORLD_MAP.filter(constants_1.isTeleporter)) {
        if (!element.properties?.teleportTo)
            continue;
        const teleporterId = `teleporter_${element.x}_${element.y}`;
        const teleporterCX = (element.x + element.width / 2) * constants_1.SCALE_FACTOR;
        const teleporterCY = (element.y + element.height / 2) * constants_1.SCALE_FACTOR;
        const playerCX = newX + constants_1.PLAYER_SIZE / 2;
        const playerCY = newY + constants_1.PLAYER_SIZE / 2;
        const dx = playerCX - teleporterCX;
        const dy = playerCY - teleporterCY;
        const distSq = dx * dx + dy * dy;
        const suctionRadius = constants_1.TELEPORTER_SUCTION_RADIUS * constants_1.SCALE_FACTOR;
        const activationRadius = constants_1.TELEPORTER_RADIUS * constants_1.SCALE_FACTOR;
        // Apply suction force if player is within suction radius and NOT on cooldown
        if (distSq <= suctionRadius * suctionRadius && !isOnCooldown) {
            const dist = Math.sqrt(distSq) || 1;
            // Stronger pull as player gets closer
            const pullStrength = constants_1.TELEPORTER_SUCTION_FORCE * (1 - dist / suctionRadius) * deltaTime;
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
                (0, wireOutbox_1.getWireOutbox)().toSocket((0, utils_1.getOriginalSocketId)(player.id), 'teleporterEntered', {
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
                player.teleportCooldown = currentTime + constants_1.TELEPORTER_COOLDOWN;
                if (teleportTo.serverPort && teleportTo.serverPort !== currentServerPort) {
                    if (!player.id.startsWith('bot_')) {
                        console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleporting to server port ${teleportTo.serverPort} after 1 second delay`);
                    }
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    transferPlayerToServer(player, teleportTo.serverPort, teleportTo.x * constants_1.SCALE_FACTOR, teleportTo.y * constants_1.SCALE_FACTOR, io, database, useHttps, currentServerConfig, currentServerPort).catch(error => {
                        console.error(`[SERVER ${currentServerConfig.name}] Failed to transfer player ${player.name}:`, error);
                        (0, wireOutbox_1.getWireOutbox)().toSocket((0, utils_1.getOriginalSocketId)(player.id), 'transferFailed', { message: 'Failed to connect to target server' });
                        player.teleportCooldown = undefined;
                    });
                    return { x: newX, y: newY, transferred: true };
                }
                else {
                    newX = teleportTo.x * constants_1.SCALE_FACTOR;
                    newY = teleportTo.y * constants_1.SCALE_FACTOR;
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    if (!player.id.startsWith('bot_')) {
                        console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleported to (${newX}, ${newY}) after 1 second delay`);
                    }
                    (0, wireOutbox_1.getWireOutbox)().toSocket((0, utils_1.getOriginalSocketId)(player.id), 'playerTeleported', {
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
        io.to((0, utils_1.getOriginalSocketId)(player.id)).emit('teleporterExited');
    }
    return { x: newX, y: newY, transferred: false };
}
/**
 * The petal pass: ring kinematics, collisions, effects, breaking and reload.
 *
 * The last and largest slice out of `updatePlayerState` — about a thousand
 * lines, and the one genuinely entangled piece: it drives the ECS petal-ring
 * kinematics one instance at a time, applies petal damage and its effects,
 * runs the break/cooldown/restore machine, and attributes kills for XP and
 * drops. See resolvePlayerMobContact for why these are functions rather than
 * ECS systems.
 *
 * It DOES move the player: wall collision during the pass pushes them, so the
 * staged position goes in and comes back out, and the caller keeps committing
 * at the end of the pipeline.
 *
 * Note the deliberate use of `player.x`/`player.y` (NOT the staged position)
 * for the ring's centre — that is what makes petals trail the flower, and the
 * comment inside says not to "fix" it. Preserved verbatim.
 */
function resolvePlayerPetals(player, startX, startY, deltaTime, deps) {
    const { io, savePlayerProgress } = deps;
    // Recomputed here rather than passed: it is the same one-line derivation the
    // caller does, and threading it would make the seam's signature depend on
    // the caller's locals.
    const effectivePlayerSize = constants_1.PLAYER_SIZE * (player.sizeMultiplier ?? 1.0);
    let newX = startX;
    let newY = startY;
    // Check for petal-enemy collisions
    if (player.loadout) {
        const { petalInstances, nextSlotIndex } = buildPetalInstances(player, io);
        const currentTime = Date.now();
        const petalExtension = player.inputs.petalExtension || 1.0;
        const playerSizeMult = player.sizeMultiplier ?? 1.0;
        const totalSlots = nextSlotIndex;
        const playerModifiers = (0, playerManager_1.calculatePlayerModifiers)(player);
        const playerRotationSpeedModifier = playerModifiers.rotationSpeed ?? 1.0;
        // Open the ECS-owned ring for this tick. This is the only stateful step:
        // it records the slot count and advances the orbit phase (an integral, so
        // exactly once per player per tick — see PetalRingBridge).
        const ring = deps.petalRing.open(player, totalSlots, playerRotationSpeedModifier, deltaTime, currentTime);
        // The ring's per-tick constants. `player.x`/`player.y` here are the
        // PREVIOUS tick's committed position — the integrated one is parked in
        // movedX/movedY and is not committed until the end of this function —
        // and that is exactly what makes petals trail the flower rather than
        // orbit its live centre. Do not "fix" this to newX/newY.
        const geom = (0, petalRing_1.computeRingGeometry)({
            playerX: player.x,
            playerY: player.y,
            orbitPhase: ring.orbitPhase,
            slotCount: totalSlots,
            petalExtension,
            sizeMultiplier: playerSizeMult,
            playerSize: constants_1.PLAYER_SIZE,
            rangeModifier: playerModifiers.range ?? 1.0,
            rotationSpeedModifier: playerRotationSpeedModifier,
            attractionRadius: playerModifiers.petalAttractionRadius ?? 0,
            deltaTime,
            now: currentTime,
        });
        // Per-petal attraction eligibility (a mob within the attraction radius of
        // the petal's own orbit position) is resolved inside the ring step, via
        // the grid broad-phase injected below, so each petal only considers mobs
        // actually near where *it* will swing past.
        const ringDeps = makePetalRingDeps(player);
        // Initialize petal positions array
        player.petalPositions = [];
        dropFieldsOnExtension({ player, io, groundEffects: deps.groundEffects, petalInstances, geom });
        // Resolved once per player-tick: the petal-vs-player pass below walks
        // every other player, so outside the PVP arena it must stay behind a
        // cheap "is anyone corrupted at all" check rather than run for free.
        const anyCorruptedPlayers = (0, gameState_1.hasCorruptedPlayers)();
        for (let idx = 0; idx < petalInstances.length; idx++) {
            const { petal, instanceIndex, loadoutIndex, slotIndex } = petalInstances[idx];
            if (!petal) {
                continue;
            }
            const instancePetalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
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
                        restoreIndependentPetalInstance(player.id, loadoutIndex, instanceIndex, petal.petalType, petal.rarity, petal.maxHealth, io);
                    }
                }
                else if (player.loadout[loadoutIndex] === petal &&
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
                    (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, player);
                    player.loadout[loadoutIndex] = restoredPetal;
                    (0, petalEvents_1.emitPetalRestored)(player.id, {
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
                    // Scripted behaviour before breaking (unconditional — see
                    // "immediate mode" in petal_actions.ts).
                    if ((0, petal_actions_1.hasPetalBehaviour)(petal.petalType)) {
                        // NOTE: this reconstructs the orbit point with its OWN,
                        // different radius (`60 + level*2`) rather than the
                        // ring's. That is a pre-existing quirk of the on-break
                        // action context and it is preserved verbatim: routing it
                        // through `petalOrbitTarget` would move where an
                        // on_break explosion or lightning strike lands.
                        const baseRadius = 60 + (player.level * 2);
                        const breakAngleStep = totalSlots > 0 ? (Math.PI * 2) / totalSlots : 0;
                        const baseAngle = slotIndex * breakAngleStep;
                        const rotationAngle = ((petalStats.speed ?? 1.0) * geom.orbitPhase * 2) % (Math.PI * 2);
                        const totalAngle = baseAngle + rotationAngle;
                        const petalRange = (petalStats.range ?? 1.0) * geom.rangeModifier;
                        const petalRadius = baseRadius * petalRange;
                        const petalX = player.x + Math.cos(totalAngle) * petalRadius;
                        const petalY = player.y + Math.sin(totalAngle) * petalRadius;
                        const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
                        const petalSize = 40 * effectiveSize;
                        const actionContext = {
                            player: player,
                            petalX: petalX,
                            petalY: petalY,
                            petalSize: petalSize,
                            petalDamage: petalStats.damage,
                            enemies: (0, enemyRegistry_1.liveEnemies)(),
                            io: io
                        };
                        (0, petal_actions_1.runPetalBreakBehaviour)(petal.petalType, actionContext);
                    }
                    const cooldownTime = getEffectiveCooldown(petal, petalStats);
                    if (hasIndependentInstances(petalStats)) {
                        // Per-instance: only this instance breaks; other instances keep working
                        ensureInstanceArrays(petal, petalStats);
                        petal.instanceOnCooldown[instanceIndex] = true;
                        // Absolute restore deadline alongside the setTimeout — the timer
                        // dies with this process (cross-server portal transfer), the
                        // stamp travels with the loadout. See the tick-loop backstop.
                        const cdCount = petalStats.count ?? 1;
                        if (!Array.isArray(petal.instanceCooldownEndTime) || petal.instanceCooldownEndTime.length !== cdCount) {
                            petal.instanceCooldownEndTime = new Array(cdCount).fill(undefined);
                        }
                        petal.instanceCooldownEndTime[instanceIndex] = currentTime + cooldownTime;
                        ring.state.dropInstance(loadoutIndex, instanceIndex);
                        const snapshotPetalType = petal.petalType;
                        const snapshotRarity = petal.rarity;
                        const snapshotMaxHealth = petal.maxHealth;
                        const snapshotPlayerId = player.id;
                        setTimeout(() => {
                            restoreIndependentPetalInstance(snapshotPlayerId, loadoutIndex, instanceIndex, snapshotPetalType, snapshotRarity, snapshotMaxHealth, io);
                        }, cooldownTime);
                        // Slot shows cooldown only when every instance is on cooldown
                        if (petal.instanceOnCooldown.every((c) => c)) {
                            petal.onCooldown = true;
                            // Tell clients too, or the loadout slot never draws its
                            // reload: nothing else pushes the slot-level flag out
                            // (petalRestored is the only other carrier, and that's
                            // the end of the reload, not the start).
                            (0, petalEvents_1.emitPetalBroken)(player.id, {
                                playerId: player.id,
                                slotIndex: loadoutIndex,
                                petalType: petal.petalType,
                                rarity: petal.rarity
                            }, player.x, player.y);
                        }
                    }
                    else {
                        // Non-clumped: whole slot breaks (legacy behavior)
                        petal.onCooldown = true;
                        // Absolute restore deadline — survives process handoff where the
                        // setTimeout below does not. See the tick-loop backstop.
                        petal.cooldownEndTime = currentTime + cooldownTime;
                        ring.state.dropSlot(loadoutIndex);
                        const originalPetal = {
                            type: petal.type,
                            petalType: petal.petalType,
                            rarity: petal.rarity,
                            maxHealth: petal.maxHealth
                        };
                        const snapshotPetalType = originalPetal.petalType;
                        const snapshotRarity = originalPetal.rarity;
                        setTimeout(() => {
                            const current = constants_1.players[player.id]?.loadout?.[loadoutIndex];
                            if (!constants_1.players[player.id] || !current || !current.onCooldown)
                                return;
                            if (current.type !== 'petal' ||
                                current.petalType !== snapshotPetalType ||
                                current.rarity !== snapshotRarity)
                                return;
                            {
                                const restoredPetal = {
                                    ...originalPetal,
                                    health: originalPetal.maxHealth,
                                    onCooldown: false
                                };
                                (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, player);
                                player.loadout[loadoutIndex] = restoredPetal;
                                (0, petalEvents_1.emitPetalRestored)(player.id, {
                                    playerId: player.id,
                                    slotIndex: loadoutIndex,
                                    petal: player.loadout[loadoutIndex]
                                });
                            }
                        }, cooldownTime);
                        (0, petalEvents_1.emitPetalBroken)(player.id, {
                            playerId: player.id,
                            slotIndex: loadoutIndex,
                            petalType: petal.petalType,
                            rarity: petal.rarity
                        }, player.x, player.y);
                    }
                }
                continue;
            }
            const petalStats = instancePetalStats;
            if (!petalStats)
                continue;
            // Get effective size (custom size if set, otherwise base stats)
            const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
            // Petal ID is needed for actions, projectiles and damage cooldowns
            // regardless of physics. The ECS ring keys the same instance by the
            // integer pair (loadoutIndex, instanceIndex) instead; this string
            // form survives because the legacy tables it indexes
            // (petalLastProjectileTime, petalLastRadiationTime,
            // petalLastDamageTime, the action VM) are all still legacy.
            const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
            // ---- kinematics: ECS-owned -------------------------------------
            // Everything from the orbit angle to the wall push-out now lives in
            // ecs/systems/petalRing.ts, against per-instance state held in the
            // `PetalRing` component on this flower's entity. It is stepped HERE,
            // one instance at a time in ring order, rather than batched ahead of
            // the loop — see the ring header for why: the effects below change
            // the next instance's kinematics (a kill removes an attraction
            // target; damage to a shared-health slot makes the next instance
            // take the break path above and emit no position at all), so
            // batching would change both the values and the LENGTH of
            // petalPositions, which the broadcast hashes.
            (0, petalRing_1.stepPetalKinematics)(ring.state, geom, petalStats, loadoutIndex, instanceIndex, slotIndex, effectiveSize, ringDeps, _ringStepResult);
            const petalX = _ringStepResult.x;
            const petalY = _ringStepResult.y;
            const petalOrbitAngle = _ringStepResult.angle;
            // Rose-style burst heal (rysteria_gardn): once the petal has been in
            // orbit past its charge time and the flower is below max health, it
            // detaches, homes to the flower, heals a burst and is consumed.
            // Shell works the same way but lays a shield instead, and waits for
            // the current shield to lapse rather than for missing health.
            //
            // The ring decides WHETHER a petal is homing (it needs the spawn
            // time, which is ring state) by calling `ringDeps.isHoming`; that
            // callback records which of the two fired into the pair below, which
            // the delivery block further down consumes. `_ringHoming*` are module
            // scratch, valid only until the next `stepPetalKinematics` call.
            const burstHealHoming = _ringStepResult.homing && _ringHomingWasHeal;
            const burstShieldHoming = _ringStepResult.homing && _ringHomingWasShield;
            // Update petal position in action context
            (0, petal_actions_1.updatePetalPosition)(petalId, petalX, petalY);
            // Store petal position for client synchronization
            player.petalPositions.push({
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
                        player.health = Math.min(player.maxHealth, player.health + petalStats.burstHeal * getHealingSkillMultiplier(player));
                    }
                    else {
                        (0, petal_actions_1.grantShield)(player, petalStats.burstShield, BURST_SHIELD_DURATION_MS);
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
                    const rarityIdx = Math.max(0, (0, petals_1.getRarityIndex)(petal.rarity ?? 'common'));
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
                        const wallCollision = (0, physics_1.checkPlayerWallCollisions)(trialX, trialY, effectivePlayerSize);
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
                            if (blockedX)
                                vx = -vx * BOUNCE_DAMPING;
                            if (blockedY)
                                vy = -vy * BOUNCE_DAMPING;
                            // If both axes blocked (wedged in a corner), bail rather than spin.
                            if (blockedX && blockedY)
                                break;
                        }
                    }
                    (0, wireOutbox_1.getWireOutbox)().all('playerDamaged', {
                        playerId: player.id,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        isInvulnerable: player.isInvulnerable,
                        knockbackX: appliedX,
                        knockbackY: appliedY,
                        damageDealt: 0
                    });
                }
                setInstanceHealth(petal, instanceIndex, instancePetalStats, 0);
                continue;
            }
            // Check if petal can shoot projectiles (only when extended)
            if (petalExtension > 1.0 && petalStats.projectile) {
                const projectileConfig = petalStats.projectile;
                const lastShotTime = gameState_1.petalLastProjectileTime.get(petalId) || 0;
                const cooldown = petalStats.cooldown || 2000;
                // Check if cooldown has passed
                if (currentTime - lastShotTime >= cooldown) {
                    // Calculate projectile angle - shoot in the direction the petal is facing (tangent to rotation)
                    // The petal is at its orbit bearing, so the projectile goes
                    // that way. Reported by the ring step rather than recomputed,
                    // so the two cannot drift apart.
                    let projectileAngle = petalOrbitAngle;
                    // Guided shots re-aim at the nearest mob inside a cone around
                    // the firing direction (gardn find_nearest_enemy_within_angle).
                    // Done once, at launch — the shot still flies straight, so the
                    // client's dead-reckoning stays exact.
                    if (projectileConfig.seekRange) {
                        const cone = projectileConfig.seekCone ?? Math.PI / 4;
                        const seekCandidates = (0, enemyGrid_1.queryEnemiesNear)(petalX, petalY, projectileConfig.seekRange, _seekQueryBuffer);
                        let bestDistSq = Infinity;
                        let bestAngle = null;
                        for (let _si = 0; _si < seekCandidates.length; _si++) {
                            const candidate = seekCandidates[_si];
                            if ((0, mobFields_1.isMobDead)(candidate.entity))
                                continue;
                            const sdx = (0, mobFields_1.mobX)(candidate.entity) - petalX;
                            const sdy = (0, mobFields_1.mobY)(candidate.entity) - petalY;
                            const sDistSq = sdx * sdx + sdy * sdy;
                            if (sDistSq > projectileConfig.seekRange * projectileConfig.seekRange)
                                continue;
                            if (sDistSq >= bestDistSq)
                                continue;
                            let delta = Math.atan2(sdy, sdx) - projectileAngle;
                            while (delta > Math.PI)
                                delta -= Math.PI * 2;
                            while (delta < -Math.PI)
                                delta += Math.PI * 2;
                            if (Math.abs(delta) > cone)
                                continue;
                            bestDistSq = sDistSq;
                            bestAngle = Math.atan2(sdy, sdx);
                        }
                        if (bestAngle !== null)
                            projectileAngle = bestAngle;
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
                    gameState_1.petalLastProjectileTime.delete(petalId);
                    gameState_1.petalLastProjectileTime.set(petalId, currentTime);
                }
            }
            // Uranium: a damage pulse over everything in a wide radius, on its own
            // timer. Reuses petalLastRadiationTime (an LRU map like the projectile
            // one) so each petal instance pulses independently of its neighbours.
            if (petalStats.radiation) {
                const lastPulse = gameState_1.petalLastRadiationTime.get(petalId) || 0;
                if (currentTime - lastPulse >= petalStats.radiation.intervalMs) {
                    gameState_1.petalLastRadiationTime.delete(petalId);
                    gameState_1.petalLastRadiationTime.set(petalId, currentTime);
                    const pulseRadius = petalStats.radiation.radius;
                    const pulseDamage = petalStats.damage * (petalStats.radiation.damageFactor ?? 1) * (0, petal_actions_1.getDamageMultiplier)(player);
                    const irradiated = (0, enemyGrid_1.queryEnemiesNear)(petalX, petalY, pulseRadius, _radiationQueryBuffer);
                    for (let _ri = 0; _ri < irradiated.length; _ri++) {
                        const target = irradiated[_ri];
                        if ((0, mobFields_1.isMobDead)(target.entity))
                            continue;
                        const rdx = (0, mobFields_1.mobX)(target.entity) - petalX;
                        const rdy = (0, mobFields_1.mobY)(target.entity) - petalY;
                        const reach = pulseRadius + ((0, mobFields_1.mobRadiusOf)(target.entity) ?? constants_1.ENEMY_SIZE / 2);
                        if (rdx * rdx + rdy * rdy > reach * reach)
                            continue;
                        (0, utils_1.trackDamage)(target, player.id, pulseDamage);
                        (0, mobFields_1.damageMob)(target.entity, pulseDamage);
                        (0, utils_1.markEnemyDamaged)(target);
                        if ((0, mobFields_1.mobHealth)(target.entity) <= 0 && !(0, mobFields_1.isMobDead)(target.entity)) {
                            const index = (0, enemyRegistry_1.liveEnemies)().findIndex(e => e.id === target.id);
                            if (index !== -1) {
                                (0, killHandler_1.killEnemy)(target, killCtxFromDeps(deps), {
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
            const candidates = (0, enemyGrid_1.queryEnemiesNear)(petalX, petalY, _petalRadius, _enemyQueryBuffer);
            for (let _ei = 0; _ei < candidates.length; _ei++) {
                const enemy = candidates[_ei];
                // Cached on the enemy by rebuildEnemyGrid — type/tier never change after spawn.
                const mobStats = (0, mobFields_1.mobStatsOf)(enemy.entity) || (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                const enemyRadius = (0, mobFields_1.mobRadiusOf)(enemy.entity) ?? (constants_1.ENEMY_SIZE / 2);
                const petalSize = _petalSize;
                const petalRadius = _petalRadius;
                const dx = (0, mobFields_1.mobX)(enemy.entity) - petalX;
                const dy = (0, mobFields_1.mobY)(enemy.entity) - petalY;
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
                    const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
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
                    (0, utils_1.trackDamage)(enemy, player.id, finalDamage);
                    // Skip further processing if enemy is already dead (being processed)
                    if (enemy.isDead) {
                        continue;
                    }
                    (0, mobFields_1.damageMob)(enemy.entity, finalDamage);
                    // Petals with damageCooldown don't take damage from mobs (they can't break)
                    if (petalStats.damageCooldown) {
                        petalLastDamageTime.set(damageCooldownKey, currentTime);
                    }
                    else {
                        const mobDamage = mobStats ? mobStats.damage : 1; // Petal loses health equal to mob damage, fallback to 1 if mobStats is null
                        const prevInstanceHealth = getInstanceHealth(petal, instanceIndex, petalStats);
                        setInstanceHealth(petal, instanceIndex, petalStats, Math.max(0, prevInstanceHealth - mobDamage));
                    }
                    // Apply poison effect if the petal has poison. The stack lives
                    // in the ECS now (one per mob+player, gardn's outlast rule) —
                    // see applyPoisonStack in ecs/systems/afflictions.ts.
                    if (petalStats.poison && petalStats.poison > 0 && petalStats.poisonDuration && petalStats.poisonDuration > 0) {
                        deps.poisons.apply(enemy.id, player.id, petalStats.poison, Date.now() + petalStats.poisonDuration);
                    }
                    // Sticky petals (honey / pincer) slow what they touch. How
                    // much of it lands depends on the petal's rarity against the
                    // mob's — see stallPower in shared/rarity.ts.
                    if (petalStats.slowFactor && petalStats.slowDuration) {
                        deps.slows.apply(enemy.id, petalStats.slowFactor, currentTime + petalStats.slowDuration, petal.rarity ?? 'common');
                    }
                    // Apply knockback to enemy
                    const knockbackForce = petalStats.knockback || 0;
                    if (knockbackForce > 0) {
                        // Calculate knockback direction from petal to enemy
                        const dx = (0, mobFields_1.mobX)(enemy.entity) - petalX;
                        const dy = (0, mobFields_1.mobY)(enemy.entity) - petalY;
                        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                        const normalizedDx = dx / distance;
                        const normalizedDy = dy / distance;
                        // Apply knockback to enemy, accounting for mass (heavier mobs are harder to knock back)
                        // Mass is already calculated from size (which includes rarity), so higher rarity = more mass
                        const mobMass = mobStats ? mobStats.mass : 1.0; // Default mass of 1.0 if mobStats is null
                        const effectiveKnockback = knockbackForce / mobMass; // Divide by mass so heavier mobs resist knockback more
                        (0, mobFields_1.setMobKnockback)(enemy.entity, normalizedDx * effectiveKnockback, normalizedDy * effectiveKnockback);
                    }
                    // Mark enemy for batched damage update at end of frame
                    (0, utils_1.markEnemyDamaged)(enemy);
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
                        }
                        else {
                            // spawnPet's apex rule turns one summon into three unique
                            // pets, which would make an apex flower open onto nine.
                            // Clamp so the squad is always the three this petal promises.
                            const petRarity = (petal.rarity ?? 'common') === 'apex' ? 'unique' : (petal.rarity ?? 'common');
                            (0, petal_actions_1.spawnPet)(FLOWER_PETAL_PET_TYPE, petRarity, petalX, petalY, player.id, io, false, FLOWER_PETAL_PET_COUNT);
                        }
                        // Broken petals don't hit anything else this tick.
                        break;
                    }
                    // Check if item spawner was hit and has 1% chance to spawn a random petal
                    if (enemy.type === 'item_spawner' && Math.random() < 0.01) {
                        // Same eligibility list mob drops use: no admin/test petals,
                        // no eggs for mobs marked noEggDrop, no cutters.
                        const eligiblePetalTypes = (0, petals_1.getDroppablePetalTypes)();
                        if (eligiblePetalTypes.length > 0) {
                            // Pick a random petal type
                            const randomPetalType = eligiblePetalTypes[Math.floor(Math.random() * eligiblePetalTypes.length)];
                            // Pick a random rarity with weighted probabilities (rarer items are much rarer)
                            // Weighted distribution: common is most common, rarer items are exponentially rarer
                            const rarityWeights = {
                                'common': 30.0, // 50%
                                'uncommon': 10.0, // 20%
                                'rare': 10.0, // 12%
                                'epic': 5.0, // 8%
                                'legendary': 5.0, // 5%
                                'mythic': 5.0, // 3%
                                'ultra': 5.0, // 1.5%
                                'super': 5.0, // 0.4%
                                'unique': 0.05 // 0.1%
                            };
                            // Calculate total weight
                            const totalWeight = petals_1.RARITY_LEVELS.reduce((sum, rarity) => sum + (rarityWeights[rarity] || 0), 0);
                            // Pick a rarity based on weighted probability
                            let randomRarity = 'common'; // Default fallback
                            const random = Math.random() * totalWeight;
                            let cumulativeWeight = 0;
                            for (const rarity of petals_1.RARITY_LEVELS) {
                                cumulativeWeight += rarityWeights[rarity] || 0;
                                if (random <= cumulativeWeight) {
                                    randomRarity = rarity;
                                    break;
                                }
                            }
                            // Calculate spawner's hitbox radius to ensure items spawn outside it
                            const spawnerMobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                            const spawnerSize = spawnerMobStats ? spawnerMobStats.size * 40 : constants_1.ENEMY_SIZE;
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
                            const newItem = {
                                id: itemId,
                                type: 'petal',
                                x: (0, mobFields_1.mobX)(enemy.entity) + offsetX,
                                y: (0, mobFields_1.mobY)(enemy.entity) + offsetY,
                                rarity: randomRarity,
                                petalType: randomPetalType,
                                eligiblePlayers: eligiblePlayersForItem, // Include all split player IDs
                                pickedUpBy: new Set(),
                                spawnTime: spawnTime
                            };
                            // Check and fix wall collisions before adding item
                            (0, physics_2.checkItemWallCollisions)(newItem);
                            // Admit the drop as an entity; the Expires deadline
                            // replaces the per-item removal setTimeout, and the
                            // droppedItems system emits `itemRemoved` on expiry.
                            const expirationTime = gameState_1.ITEM_EXPIRATION_TIMES[randomRarity] || 10000;
                            (0, itemRegistry_1.spawnWorldItem)(newItem, spawnTime + expirationTime);
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
                                projectileDamageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
                            }
                            const prevProjInstanceHealth = getInstanceHealth(petal, instanceIndex, petalStats);
                            setInstanceHealth(petal, instanceIndex, petalStats, Math.max(0, prevProjInstanceHealth - mobProjectile.damage));
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
                        enemies: (0, enemyRegistry_1.liveEnemies)(),
                        io: io,
                        petalId: petalId,
                        loadoutIndex: loadoutIndex,
                        instanceIndex: instanceIndex
                    };
                    (0, petal_actions_1.petalBehaviourCollision)(petalId, collisionContext);
                    // Check if petal breaks (per-instance for clumped)
                    if (getInstanceHealth(petal, instanceIndex, petalStats) <= 0) {
                        // Scripted behaviour before breaking (unconditional).
                        if ((0, petal_actions_1.hasPetalBehaviour)(petal.petalType)) {
                            const actionContext = {
                                player: player,
                                petalX: petalX,
                                petalY: petalY,
                                petalSize: petalSize,
                                petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                                enemies: (0, enemyRegistry_1.liveEnemies)(),
                                io: io
                            };
                            (0, petal_actions_1.runPetalBreakBehaviour)(petal.petalType, actionContext);
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
                            petal.instanceOnCooldown[instanceIndex] = true;
                            const cdCount = petalStats.count ?? 1;
                            if (!Array.isArray(petal.instanceCooldownEndTime) || petal.instanceCooldownEndTime.length !== cdCount) {
                                petal.instanceCooldownEndTime = new Array(cdCount).fill(undefined);
                            }
                            petal.instanceCooldownEndTime[instanceIndex] = cooldownEndsAt;
                            ring.state.dropInstance(loadoutIndex, instanceIndex);
                            const snapshotPetalType = petal.petalType;
                            const snapshotRarity = petal.rarity;
                            const snapshotMaxHealth = petal.maxHealth;
                            const snapshotPlayerId = player.id;
                            setTimeout(() => {
                                restoreIndependentPetalInstance(snapshotPlayerId, loadoutIndex, instanceIndex, snapshotPetalType, snapshotRarity, snapshotMaxHealth, io);
                            }, cooldownTime);
                            if (petal.instanceOnCooldown.every((c) => c)) {
                                petal.onCooldown = true;
                                // See the matching emit in the tick-loop break above.
                                (0, petalEvents_1.emitPetalBroken)(player.id, {
                                    playerId: player.id,
                                    slotIndex: loadoutIndex,
                                    petalType: petal.petalType,
                                    rarity: petal.rarity
                                }, player.x, player.y);
                            }
                        }
                        else {
                            // Non-clumped: whole slot breaks (legacy behavior)
                            petal.onCooldown = true;
                            petal.cooldownEndTime = cooldownEndsAt;
                            ring.state.dropSlot(loadoutIndex);
                            const originalPetal = {
                                type: petal.type,
                                petalType: petal.petalType,
                                rarity: petal.rarity,
                                maxHealth: petal.maxHealth
                            };
                            const snapshotPetalType = originalPetal.petalType;
                            const snapshotRarity = originalPetal.rarity;
                            setTimeout(() => {
                                const current = constants_1.players[player.id]?.loadout?.[loadoutIndex];
                                if (!constants_1.players[player.id] || !current || !current.onCooldown)
                                    return;
                                if (current.type !== 'petal' ||
                                    current.petalType !== snapshotPetalType ||
                                    current.rarity !== snapshotRarity)
                                    return;
                                {
                                    const restoredPetal = {
                                        ...originalPetal,
                                        health: originalPetal.maxHealth,
                                        onCooldown: false
                                    };
                                    (0, playerManager_1.applyPetalHealthBonus)(restoredPetal, player);
                                    player.loadout[loadoutIndex] = restoredPetal;
                                    (0, petalEvents_1.emitPetalRestored)(player.id, {
                                        playerId: player.id,
                                        slotIndex: loadoutIndex,
                                        petal: player.loadout[loadoutIndex]
                                    });
                                }
                            }, cooldownTime);
                            (0, petalEvents_1.emitPetalBroken)(player.id, {
                                playerId: player.id,
                                slotIndex: loadoutIndex,
                                petalType: petal.petalType,
                                rarity: petal.rarity
                            }, player.x, player.y);
                        }
                    }
                    // Check if enemy dies (only process once per enemy)
                    if ((0, mobFields_1.mobHealth)(enemy.entity) <= 0 && !enemy.isDead) {
                        const index = (0, enemyRegistry_1.liveEnemies)().findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            (0, killHandler_1.killEnemy)(enemy, killCtxFromDeps(deps), {
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
                const ownerSocketId = (0, utils_1.getOriginalSocketId)(player.id);
                for (const otherId in constants_1.players) {
                    if (otherId === player.id)
                        continue;
                    const other = constants_1.players[otherId];
                    if (!other || other.isDead)
                        continue;
                    if (!(0, player_1.canPetalsDamagePlayer)(player, other))
                        continue;
                    if ((0, utils_1.getOriginalSocketId)(otherId) === ownerSocketId)
                        continue;
                    const otherPlayerRadius = (constants_1.PLAYER_SIZE / 2) * (other.sizeMultiplier ?? 1.0);
                    const minDist = petalRadius + otherPlayerRadius;
                    const minDistSq = minDist * minDist;
                    const dxp = other.x - petalX;
                    const dyp = other.y - petalY;
                    const distSqP = dxp * dxp + dyp * dyp;
                    if (distSqP >= minDistSq || distSqP <= 0)
                        continue;
                    // Per-victim cooldown so a single petal can't deal damage every tick
                    const damageCooldownKey = `${player.id}_${loadoutIndex}_${instanceIndex}_pvp_${otherId}`;
                    const PVP_PETAL_COOLDOWN = petalStats.damageCooldown || 250; // ms between hits on same victim
                    const lastDmgTime = petalLastDamageTime.get(damageCooldownKey) || 0;
                    if (currentTime - lastDmgTime < PVP_PETAL_COOLDOWN)
                        continue;
                    petalLastDamageTime.set(damageCooldownKey, currentTime);
                    const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
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
                for (const [otherPlayerId, otherPlayer] of Object.entries(constants_1.players)) {
                    if (otherPlayerId !== player.id && otherPlayer.isDead) {
                        const distance = Math.sqrt((petalX - otherPlayer.x) ** 2 + (petalY - otherPlayer.y) ** 2);
                        if (distance <= revivalRange) {
                            // Break the yggdrasil petal when it revives someone
                            petal.health = 0; // This will trigger the petal breaking logic below
                            // Revive the target player.
                            //
                            // This lands inside the REVIVER's updatePlayerState,
                            // so the revived flower may still have its own
                            // updatePlayerState to run in this same loop — it
                            // will, from here on, seed newX from movedX/movedY
                            // and commit. That is safe only because
                            // syncPlayersToEcs keeps the staging pair pinned to a
                            // corpse's real position; see the comment there. Do
                            // not move the seed back below the dead-player skip.
                            otherPlayer.isDead = false;
                            otherPlayer.health = otherPlayer.maxHealth;
                            otherPlayer.isInvulnerable = true;
                            otherPlayer.lastDamageTime = 0;
                            // Notify all clients about the revival
                            (0, wireOutbox_1.getWireOutbox)().all('playerRevived', {
                                revivedPlayerId: otherPlayerId,
                                revivingPlayerId: player.id,
                                revivedPlayerName: otherPlayer.name,
                                revivingPlayerName: player.name
                            });
                            // Give revived player temporary invulnerability
                            setTimeout(() => {
                                if (constants_1.players[otherPlayerId]) {
                                    constants_1.players[otherPlayerId].isInvulnerable = false;
                                    (0, wireOutbox_1.getWireOutbox)().all('playerInvulnerabilityEnded', { playerId: otherPlayerId });
                                }
                            }, constants_1.RESPAWN_INVULNERABILITY_TIME);
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
    return { x: newX, y: newY };
}
/**
 * Update player state (movement, collisions, etc.)
 * This is the main function that handles all player state updates
 */
function updatePlayerState(player, deltaTime, deps) {
    if (!player || !player.inputs) {
        return;
    }
    // Don't update movement for dead players
    if (player.isDead) {
        return;
    }
    const { io, savePlayerProgress } = deps;
    // The pre-movement half (effects, healing, aura and ring damage) ran in
    // updatePlayerPreMovement, and INTEGRATION now happens on the ECS between
    // the two — see runSimulationStep and server/ecsSync.syncPlayersToEcs.
    //
    // `movedX`/`movedY` are what `stepPlayerMovement` used to return straight
    // into these locals, so newX/newY start in exactly the same place they
    // always did, and everything below — knockback, wall repulsion, pickups,
    // teleporters, the maze/arena clamps — is unchanged and still commits to
    // player.x/y at the very end of the function.
    //
    // What matters just as much is what is NOT assigned yet: `player.x`/
    // `player.y` still hold the PREVIOUS tick's committed position for the whole
    // of this function, which is what the petal block below reads and what makes
    // petals trail the flower. velocity, angle and speedFactor were all written
    // up-front by the legacy code too, so the movement window writes those
    // directly and they are already current here.
    const effectivePlayerSize = constants_1.PLAYER_SIZE * (player.sizeMultiplier ?? 1.0);
    let newX = player.movedX ?? player.x;
    let newY = player.movedY ?? player.y;
    // Body contact with mobs. Extracted for testability; still called from
    // exactly here so the per-player pipeline order is unchanged.
    {
        const contact = resolvePlayerMobContact(player, newX, newY, effectivePlayerSize, deps);
        newX = contact.x;
        newY = contact.y;
    }
    // The petal pass. Extracted; call site unchanged so the per-player
    // pipeline order is preserved.
    {
        const petals = resolvePlayerPetals(player, newX, newY, deltaTime, deps);
        newX = petals.x;
        newY = petals.y;
    }
    // Item pickups. Extracted for testability; call site unchanged so the
    // per-player pipeline order is preserved.
    resolvePlayerItemPickups(player, newX, newY, deps);
    // Region containment (maze / PVP arena). Extracted; call site unchanged.
    {
        const clamped = clampPlayerToRegion(player, newX, newY);
        newX = clamped.x;
        newY = clamped.y;
    }
    // Teleporters. Extracted; call site unchanged. A cross-server transfer
    // aborts the rest of the pipeline exactly as the inline `return` did — the
    // position must NOT be committed while the handoff is in flight.
    {
        const tp = resolvePlayerTeleporters(player, newX, newY, deltaTime, deps);
        if (tp.transferred)
            return;
        newX = tp.x;
        newY = tp.y;
    }
    const wasInArena = !!player.inPvpArena;
    player.x = newX;
    player.y = newY;
    const isNowInArena = (0, constants_1.isInPvpArena)(player.x, player.y);
    if (!wasInArena && isNowInArena) {
        // Entering: stash regular inventory/loadout, swap in fresh PVP versions.
        (0, playerManager_1.enterPvpArena)(player, io);
    }
    else if (wasInArena && !isNowInArena) {
        // Exiting: transfer 25% of the PVP inventory into the regular inventory,
        // then restore regular inventory/loadout.
        (0, playerManager_1.exitPvpArena)(player, io, (p, uid) => savePlayerProgress(p, uid));
    }
    if (player.health <= 0 && !player.isDead) {
        // Mark player as dead instead of respawning immediately
        player.isDead = true;
        // Set random rotation for the corpse
        player.angle = Math.random() * Math.PI * 2;
        // Despawn all pets owned by this player
        (0, petal_actions_1.despawnAllPlayerPets)(player.id, io);
        (0, wireOutbox_1.getWireOutbox)().all('playerDied', {
            playerId: player.id,
            x: player.x,
            y: player.y,
            angle: player.angle,
            killedBy: player.killedBy
        });
        // No automatic respawn - player must manually respawn via continue button
    }
}
