"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupPetalPhysicsStates = cleanupPetalPhysicsStates;
exports.getRaindropAuraRadius = getRaindropAuraRadius;
exports.getPlayerViewports = getPlayerViewports;
exports.isPositionInAnyViewport = isPositionInAnyViewport;
exports.isPositionInAnyViewport200Percent = isPositionInAnyViewport200Percent;
exports.getEnemiesInViewport200Percent = getEnemiesInViewport200Percent;
exports.isPositionInPlayerPetalRange = isPositionInPlayerPetalRange;
exports.getEnemiesInViewportCount = getEnemiesInViewportCount;
exports.validatePlayerPositions = validatePlayerPositions;
exports.updatePlayerState = updatePlayerState;
const server_utils_1 = require("../server_utils");
const petals_1 = require("../petals");
const constants_1 = require("../constants");
const map_data_1 = require("../map_data");
const gameState_1 = require("./gameState");
const physics_1 = require("./physics");
const physics_2 = require("./physics");
const petal_actions_1 = require("../petal_actions");
const mobs_1 = require("../mobs");
const enemyGrid_1 = require("./enemyGrid");
// Reusable per-call buffer for enemy grid queries; avoids per-petal array allocs.
const _enemyQueryBuffer = [];
const playerManager_1 = require("./playerManager");
const inventoryCodec_1 = require("../inventoryCodec");
const utils_1 = require("./utils");
// Map to store petal physics state (keyed by petalId)
const petalPhysicsStates = new Map();
// Map to track last damage time for petals with damageCooldown (keyed by petalId)
const petalLastDamageTime = new Map();
// Raindrop aura: tracks the last time each (player, enemy) pair took aura damage,
// so an enemy sitting inside the field takes chip damage on an interval rather
// than every server tick. Keyed by playerId -> (enemyId -> lastDamageTime).
const raindropAuraLastDamage = new Map();
const RAINDROP_AURA_DAMAGE_INTERVAL_MS = 500;
const RAINDROP_AURA_BASE_RADIUS = 180;
const RAINDROP_AURA_RADIUS_PER_RARITY = 18;
// Drop a damaging pollen puff at the given position. Pollen petals call this
// when they break so the petal still goes through the normal cooldown/reload
// cycle while leaving a short-lived AoE behind.
function spawnGroundPollen(io, player, petalStats, petal, petalX, petalY, petalSize) {
    const now = Date.now();
    const id = `pollen_${player.id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
    gameState_1.groundPollens.push({
        id,
        playerId: player.id,
        x: petalX,
        y: petalY,
        damage: petalStats.damage,
        radius: petalSize / 2,
        rarity: petal.rarity,
        expiresAt: now + gameState_1.GROUND_POLLEN_LIFETIME_MS,
        lastDamageByEnemy: new Map()
    });
    io.emit('groundPollenSpawned', {
        id,
        playerId: player.id,
        x: petalX,
        y: petalY,
        radius: petalSize / 2,
        rarity: petal.rarity,
        lifetime: gameState_1.GROUND_POLLEN_LIFETIME_MS
    });
}
// --- Clumped-petal per-instance health/cooldown helpers ---
// Clumped petals (e.g. sand) spawn multiple instances that share one orbit slot.
// Each instance needs its own health and cooldown so a single hit can't kill them all at once.
function isClumpedMulti(petalStats) {
    return !!(petalStats?.clumped && (petalStats.count ?? 1) > 1);
}
function ensureInstanceArrays(petal, petalStats) {
    if (!isClumpedMulti(petalStats))
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
function getInstanceHealth(petal, instanceIndex, petalStats) {
    if (isClumpedMulti(petalStats) && Array.isArray(petal.instanceHealth)) {
        return petal.instanceHealth[instanceIndex] ?? 0;
    }
    return petal.health ?? 0;
}
function setInstanceHealth(petal, instanceIndex, petalStats, value) {
    if (isClumpedMulti(petalStats) && Array.isArray(petal.instanceHealth)) {
        petal.instanceHealth[instanceIndex] = value;
        // Keep petal.health reflecting the max across live instances so legacy UI/health bars
        // render a sensible value for the slot overall.
        petal.health = Math.max(0, ...petal.instanceHealth);
    }
    else {
        petal.health = value;
    }
}
function isInstanceOnCooldown(petal, instanceIndex, petalStats) {
    if (isClumpedMulti(petalStats) && Array.isArray(petal.instanceOnCooldown)) {
        return !!petal.instanceOnCooldown[instanceIndex];
    }
    return !!petal.onCooldown;
}
// Physics constants
const SPRING_FORCE = 600; // Spring force back to orbit position (pixels per second^2) - reduced from 300
const DAMPING = 0.72; // Velocity damping per frame (0-1, lower = more damping)
const SPAWN_SMOOTH_TIME = 300; // Time in ms to smoothly ramp up forces after spawn - reduced from 500
function getEffectiveCooldown(petal, petalStats) {
    let cooldownTime = petalStats.cooldown || 10000;
    if (petal.petalType === 'bubble' && petal.rarity) {
        const rarityIdx = Math.max(0, petals_1.RARITY_LEVELS.indexOf(petal.rarity));
        cooldownTime = Math.max(50, cooldownTime * Math.pow(0.85, rarityIdx));
    }
    return cooldownTime;
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
function cleanupPetalPhysicsStates(playerId) {
    const keysToDelete = [];
    petalPhysicsStates.forEach((_value, key) => {
        if (key.startsWith(playerId)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => {
        petalPhysicsStates.delete(key);
        petalLastDamageTime.delete(key);
    });
    raindropAuraLastDamage.delete(playerId);
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
        const rarityIndex = Math.max(0, petals_1.RARITY_LEVELS.indexOf(petal.rarity));
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
        const rarityIndex = Math.max(0, petals_1.RARITY_LEVELS.indexOf(petal.rarity));
        const radius = RAINDROP_AURA_BASE_RADIUS + rarityIndex * RAINDROP_AURA_RADIUS_PER_RARITY;
        if (stats.damage > bestDamage)
            bestDamage = stats.damage;
        if (radius > bestRadius)
            bestRadius = radius;
    }
    if (bestRadius <= 0 || bestDamage <= 0)
        return;
    const { io, addXPToPlayer, handleMobDrops, sendBossMobDefeatedMessage, updateSpecialMobCounts, trackMobKill, database, savePlayerProgress } = deps;
    const now = Date.now();
    const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
    const finalDamage = bestDamage * damageMultiplier;
    let lastDamageMap = raindropAuraLastDamage.get(player.id);
    if (!lastDamageMap) {
        lastDamageMap = new Map();
        raindropAuraLastDamage.set(player.id, lastDamageMap);
    }
    const candidates = (0, enemyGrid_1.queryEnemiesNear)(player.x, player.y, bestRadius + (0, enemyGrid_1.getMaxEnemyRadius)(), _enemyQueryBuffer);
    for (let i = 0; i < candidates.length; i++) {
        const enemy = candidates[i];
        if (enemy.isDead)
            continue;
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const enemyRadius = enemy._radius ?? (constants_1.ENEMY_SIZE / 2);
        const hitDist = bestRadius + enemyRadius;
        if (dx * dx + dy * dy >= hitDist * hitDist)
            continue;
        const lastDmg = lastDamageMap.get(enemy.id) || 0;
        if (now - lastDmg < RAINDROP_AURA_DAMAGE_INTERVAL_MS)
            continue;
        lastDamageMap.set(enemy.id, now);
        (0, utils_1.trackDamage)(enemy, player.id, finalDamage);
        enemy.health = Math.max(0, enemy.health - finalDamage);
        (0, utils_1.markEnemyDamaged)(enemy);
        if (enemy.health <= 0 && !enemy.isDead) {
            enemy.isDead = true;
            const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
            addXPToPlayer(player, xpGained, player.id);
            handleMobDrops(enemy);
            sendBossMobDefeatedMessage(enemy, io, constants_1.players);
            updateSpecialMobCounts();
            const damageContributorsCopy = enemy.damageContributors ? new Map(enemy.damageContributors) : undefined;
            (0, utils_1.cleanupEnemy)(enemy);
            const idx = constants_1.enemies.findIndex(e => e.id === enemy.id);
            if (idx !== -1)
                constants_1.enemies.splice(idx, 1);
            io.emit('enemyDestroyed', enemy.id);
            if (damageContributorsCopy) {
                const enemyDataForTracking = {
                    type: enemy.type,
                    tier: enemy.tier,
                    damageContributors: damageContributorsCopy
                };
                trackMobKill(enemyDataForTracking, constants_1.players, gameState_1.playerUserIds, database, io, savePlayerProgress);
            }
        }
    }
}
/**
 * Get viewports for all players
 */
function getPlayerViewports() {
    const viewports = [];
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
            viewports.push({
                x: player.x - vpWidth / 2,
                y: player.y - vpHeight / 2,
                width: vpWidth,
                height: vpHeight
            });
        }
    }
    return viewports;
}
/**
 * Check if a position is in any player's viewport
 */
function isPositionInAnyViewport(x, y) {
    const viewports = getPlayerViewports();
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    for (const viewport of viewports) {
        const extendedViewport = {
            x: viewport.x - constants_1.VIEWPORT_BUFFER,
            y: viewport.y - constants_1.VIEWPORT_BUFFER,
            width: viewport.width + (constants_1.VIEWPORT_BUFFER * 2),
            height: viewport.height + (constants_1.VIEWPORT_BUFFER * 2)
        };
        if (x >= extendedViewport.x && x <= extendedViewport.x + extendedViewport.width &&
            y >= extendedViewport.y && y <= extendedViewport.y + extendedViewport.height) {
            return true;
        }
    }
    return false;
}
/**
 * Check if a position is in any player's viewport with 200% buffer (for websocket optimization)
 */
function isPositionInAnyViewport200Percent(x, y) {
    const viewports = getPlayerViewports();
    // If no players are connected, allow spawning anywhere (for initial server startup)
    if (viewports.length === 0) {
        return true;
    }
    // Use 200% of VIEWPORT_BUFFER (2x)
    const buffer200Percent = constants_1.VIEWPORT_BUFFER * 2;
    for (const viewport of viewports) {
        const extendedViewport = {
            x: viewport.x - buffer200Percent,
            y: viewport.y - buffer200Percent,
            width: viewport.width + (buffer200Percent * 2),
            height: viewport.height + (buffer200Percent * 2)
        };
        if (x >= extendedViewport.x && x <= extendedViewport.x + extendedViewport.width &&
            y >= extendedViewport.y && y <= extendedViewport.y + extendedViewport.height) {
            return true;
        }
    }
    return false;
}
/**
 * Filter enemies to only include those in any player's viewport with 200% buffer
 */
function getEnemiesInViewport200Percent() {
    return constants_1.enemies.filter(enemy => isPositionInAnyViewport200Percent(enemy.x, enemy.y));
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
 * Get count of enemies in viewport
 */
function getEnemiesInViewportCount() {
    const viewports = getPlayerViewports();
    // If no players are connected, count all enemies (for initial server startup)
    if (viewports.length === 0) {
        return constants_1.enemies.length;
    }
    let count = 0;
    for (const enemy of constants_1.enemies) {
        if (isPositionInAnyViewport(enemy.x, enemy.y)) {
            count++;
        }
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
            // Reset invalid positions to a safe default. PVP-arena coordinates
            // sit outside the regular world but are still valid.
            const inArena = (0, constants_1.isInPvpArena)(player.x, player.y);
            if (!inArena && (isNaN(player.x) || isNaN(player.y) ||
                player.x < 0 || player.x > constants_1.ACTUAL_WORLD_WIDTH ||
                player.y < 0 || player.y > constants_1.ACTUAL_WORLD_HEIGHT)) {
                console.log(`[SERVER] Fixing invalid position for player ${playerId}: (${player.x}, ${player.y})`);
                // Reset to center of world
                player.x = constants_1.ACTUAL_WORLD_WIDTH / 2;
                player.y = constants_1.ACTUAL_WORLD_HEIGHT / 2;
                // Notify client of position correction
                io.to(playerId).emit('positionCorrected', { x: player.x, y: player.y });
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
                io.emit('playerInvulnerabilityEnded', { playerId: victim.id });
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
        const victimGains = victim.inventory || [];
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
            io.to(attacker.id).emit('inventoryUpdated', attacker.inventory);
        }
        victim.inventory = [];
        io.to(victim.id).emit('inventoryUpdated', victim.inventory);
        // Mark dead immediately so passive-heal can't revive the victim before
        // their own update tick runs the standard death handler.
        victim.isDead = true;
        victim.angle = Math.random() * Math.PI * 2;
        (0, petal_actions_1.despawnAllPlayerPets)(victim.id, io);
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
    const { io, addXPToPlayer, handleMobDrops, sendBossMobDefeatedMessage, updateSpecialMobCounts, savePlayerProgress, transferPlayerToServer, currentServerConfig, currentServerPort, useHttps, database, trackMobKill } = deps;
    // Update player effects
    (0, petal_actions_1.updatePlayerEffects)(player, deltaTime);
    updateSpongeDamage(player, deltaTime, io);
    // Apply passive healing (base 1 HP/sec + petal bonuses)
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
                    const SKILL_MULTIPLIERS = {
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
                    // Skills are disabled inside the PVP arena.
                    const healingMultiplier = !player.inPvpArena && player.skills?.healingMultiplier
                        ? (SKILL_MULTIPLIERS[player.skills.healingMultiplier] || 1.0)
                        : 1.0;
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
    // Apply raindrop aura damage to mobs around the player
    applyRaindropAuraDamage(player, deps);
    let targetVelocityX = 0;
    let targetVelocityY = 0;
    if (player.inputs.useMouse &&
        player.inputs.mouseDirectionX !== undefined &&
        player.inputs.mouseDirectionY !== undefined &&
        player.inputs.mouseSpeedMultiplier !== undefined) {
        // Client has already calculated the direction and speed multiplier
        // Server just needs to apply MAX_SPEED, speed_boost, and other multipliers
        const speed = constants_1.MAX_SPEED * player.speed_boost * (0, petal_actions_1.getSpeedMultiplier)(player) * player.inputs.mouseSpeedMultiplier;
        targetVelocityX = player.inputs.mouseDirectionX * speed;
        targetVelocityY = player.inputs.mouseDirectionY * speed;
        player.angle = Math.atan2(player.inputs.mouseDirectionY, player.inputs.mouseDirectionX);
    }
    else if (player.inputs.keys) {
        if (player.inputs.keys.includes('ArrowLeft') || player.inputs.keys.includes('a'))
            targetVelocityX -= 1;
        if (player.inputs.keys.includes('ArrowRight') || player.inputs.keys.includes('d'))
            targetVelocityX += 1;
        if (player.inputs.keys.includes('ArrowUp') || player.inputs.keys.includes('w'))
            targetVelocityY -= 1;
        if (player.inputs.keys.includes('ArrowDown') || player.inputs.keys.includes('s'))
            targetVelocityY += 1;
        if (targetVelocityX !== 0 && targetVelocityY !== 0) {
            const length = Math.sqrt(targetVelocityX * targetVelocityX + targetVelocityY * targetVelocityY);
            targetVelocityX /= length;
            targetVelocityY /= length;
        }
        const speed = constants_1.MAX_SPEED * player.speed_boost * (0, petal_actions_1.getSpeedMultiplier)(player);
        targetVelocityX *= speed;
        targetVelocityY *= speed;
        if (targetVelocityX !== 0 || targetVelocityY !== 0) {
            player.angle = Math.atan2(targetVelocityY, targetVelocityX);
        }
    }
    // Apply movement smoothing using linear interpolation
    // Smoothing factor represents how fast to reach target velocity (higher = faster response)
    // Using exponential smoothing that works with deltaTime in seconds
    const SMOOTHING_RATE = 20.0; // Velocity change per second (higher = faster response, lower = smoother)
    const smoothingFactor = 1 - Math.exp(-SMOOTHING_RATE * deltaTime);
    // Smoothly interpolate from current velocity to target velocity
    player.velocityX = player.velocityX + (targetVelocityX - player.velocityX) * smoothingFactor;
    player.velocityY = player.velocityY + (targetVelocityY - player.velocityY) * smoothingFactor;
    const deltaX = player.velocityX * deltaTime;
    const deltaY = player.velocityY * deltaTime;
    // Substep movement so a single fast tick can't skip past a wall.
    // Step size is bounded by half the player hitbox so collision checks
    // always sample an overlapping position against any tile in the path.
    const effectivePlayerSize = constants_1.PLAYER_SIZE * (player.sizeMultiplier ?? 1.0);
    const MAX_STEP = effectivePlayerSize / 2;
    const moveDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const steps = Math.max(1, Math.ceil(moveDistance / MAX_STEP));
    const stepX = deltaX / steps;
    const stepY = deltaY / steps;
    let newX = player.x;
    let newY = player.y;
    for (let i = 0; i < steps; i++) {
        newX += stepX;
        newY += stepY;
        const wallCollision = (0, physics_1.checkPlayerWallCollisions)(newX, newY, effectivePlayerSize);
        newX = wallCollision.x;
        newY = wallCollision.y;
    }
    // Spatial-grid broad-phase: only test enemies whose center is within
    // (playerRadius + maxEnemyRadius). Pets and dead enemies are excluded by the grid.
    const _playerRadius = effectivePlayerSize / 2;
    const _candidates = (0, enemyGrid_1.queryEnemiesNear)(newX, newY, _playerRadius + (0, enemyGrid_1.getMaxEnemyRadius)(), _enemyQueryBuffer);
    for (let _ci = 0; _ci < _candidates.length; _ci++) {
        const enemy = _candidates[_ci];
        const collisionInfo = (0, physics_1.checkPlayerEnemyCollision)(newX, newY, effectivePlayerSize, enemy);
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
                // Only apply damage when not invulnerable
                if (!player.isInvulnerable && enemy.type !== 'item_spawner') {
                    const shieldAmount = (0, petal_actions_1.getShieldAmount)(player);
                    const damageToPlayer = Math.max(0, enemy.damage - shieldAmount);
                    const spongeDuration = getSpongeAbsorbDuration(player);
                    if (damageToPlayer > 0 && spongeDuration > 0) {
                        queueSpongeDamage(player, damageToPlayer, spongeDuration, { type: enemy.type, tier: enemy.tier });
                        player.isInvulnerable = true;
                        setTimeout(() => {
                            if (constants_1.players[player.id]) {
                                constants_1.players[player.id].isInvulnerable = false;
                                io.emit('playerInvulnerabilityEnded', { playerId: player.id });
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
                                    io.emit('playerInvulnerabilityEnded', { playerId: player.id });
                                }
                            }, 50);
                        }
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
                enemy.health = Math.max(0, enemy.health - player.damage);
                // Mark enemy for batched damage update at end of frame
                (0, utils_1.markEnemyDamaged)(enemy);
                if (enemy.health <= 0 && !enemy.isDead) {
                    // console.log('[Server] Enemy health reached 0 from petal damage', {
                    //     enemyId: enemy.id,
                    //     enemyType: enemy.type,
                    //     enemyTier: enemy.tier,
                    //     oldHealth,
                    //     newHealth: enemy.health,
                    //     playerId: player.id,
                    //     hasDamageContributors: !!enemy.damageContributors,
                    //     damageContributorsSize: enemy.damageContributors?.size || 0
                    // });
                    // Mark enemy as dead to prevent multiple death handlers
                    enemy.isDead = true;
                    const index = constants_1.enemies.findIndex(e => e.id === enemy.id);
                    // console.log('[Server] Enemy death handler - found index:', index, 'enemyId:', enemy.id);
                    if (index !== -1) {
                        // Copy enemy data BEFORE cleanup to ensure trackMobKill has all needed info
                        const damageContributorsCopy = enemy.damageContributors ? new Map(enemy.damageContributors) : undefined;
                        // console.log('[Server] Enemy killed by petal collision - BEFORE cleanup', {
                        //     enemyType: enemy.type,
                        //     enemyTier: enemy.tier,
                        //     hasDamageContributors: !!enemy.damageContributors,
                        //     damageContributorsSize: enemy.damageContributors?.size || 0,
                        //     damageContributorsEntries: enemy.damageContributors ? Array.from(enemy.damageContributors.entries()) : [],
                        //     hasDamageContributorsCopy: !!damageContributorsCopy,
                        //     copySize: damageContributorsCopy?.size || 0,
                        //     hasIo: !!io
                        // });
                        // Follow same path as lightning damage - synchronous execution
                        const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                        addXPToPlayer(player, xpGained, player.id);
                        handleMobDrops(enemy);
                        sendBossMobDefeatedMessage(enemy, io, constants_1.players);
                        updateSpecialMobCounts();
                        // Remove enemy from array
                        (0, utils_1.cleanupEnemy)(enemy);
                        constants_1.enemies.splice(index, 1);
                        // Emit enemy destroyed event
                        io.emit('enemyDestroyed', enemy.id);
                        // Call trackMobKill synchronously to ensure it runs (was deferred but causing issues)
                        if (damageContributorsCopy && damageContributorsCopy.size > 0) {
                            const enemyDataForTracking = {
                                type: enemy.type,
                                tier: enemy.tier,
                                damageContributors: damageContributorsCopy
                            };
                            // console.log('[Server] Calling trackMobKill synchronously', {
                            //     enemyType: enemyDataForTracking.type,
                            //     enemyTier: enemyDataForTracking.tier,
                            //     hasIo: !!io,
                            //     damageContributorsSize: enemyDataForTracking.damageContributors.size
                            // });
                            trackMobKill(enemyDataForTracking, constants_1.players, gameState_1.playerUserIds, database, io, savePlayerProgress);
                        }
                        else {
                            // console.warn('[Server] No damageContributorsCopy or empty, skipping trackMobKill', {
                            //     hasCopy: !!damageContributorsCopy,
                            //     copySize: damageContributorsCopy?.size || 0
                            // });
                        }
                    }
                    else {
                        // console.warn('[Server] Enemy not found in enemies array when trying to process death');
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
        // Build array of petal instances considering count property
        const petalInstances = [];
        let nextSlotIndex = 0;
        try {
            for (let i = 0; i < player.loadout.length; i++) {
                // Secondary loadout (slots 10+) is storage only — don't spawn petals
                if (i >= 10)
                    continue;
                const petal = player.loadout[i];
                if (petal && petal.type === 'petal' && petal.petalType && petal.rarity) {
                    const petalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
                    if (!petalStats)
                        continue;
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
                        if (!clumped)
                            nextSlotIndex++;
                        petalInstances.push({ petal, instanceIndex: j, loadoutIndex: i, slotIndex });
                        // Execute petal actions immediately when spawned
                        if (petalStats.actions) {
                            const petalId = `${player.id}_${i}_${j}`;
                            const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
                            const actionContext = {
                                player: player,
                                petalX: player.x, // Will be updated with actual position in game loop
                                petalY: player.y, // Will be updated with actual position in game loop
                                petalSize: effectiveSize * 40,
                                petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                                enemies: constants_1.enemies,
                                io: io,
                                petalId: petalId,
                                loadoutIndex: i,
                                instanceIndex: j
                            };
                            (0, petal_actions_1.executePetalActionsOnSpawn)(petalStats.actions, actionContext);
                        }
                    }
                    if (clumped)
                        nextSlotIndex++;
                }
            }
        }
        catch (error) {
            console.error('Error building petal instances:', error);
        }
        const currentTime = Date.now();
        const petalExtension = player.inputs.petalExtension || 1.0;
        // Keep petals a constant distance from the flower edge: scale only the body-radius portion by sizeMultiplier.
        const playerSizeMult = player.sizeMultiplier ?? 1.0;
        const baseRadius = (60 + (constants_1.PLAYER_SIZE / 2) * (playerSizeMult - 1)) * petalExtension;
        const totalSlots = nextSlotIndex;
        const angleStep = totalSlots > 0 ? (Math.PI * 2) / totalSlots : 0;
        const playerModifiers = (0, playerManager_1.calculatePlayerModifiers)(player);
        const playerRangeModifier = playerModifiers.range ?? 1.0;
        const playerRotationSpeedModifier = playerModifiers.rotationSpeed ?? 1.0;
        // Integrate the rotation-speed modifier over time so swapping a petal that
        // changes the modifier (Faster, Yin Yang) only bends the rate from this point
        // forward, rather than remapping `currentTime * newSpeed` and yanking every
        // petal to a different angle.
        player.petalOrbitPhase = (player.petalOrbitPhase ?? 0) + playerRotationSpeedModifier * deltaTime;
        const playerOrbitPhase = player.petalOrbitPhase;
        const playerPetalAttractionRadius = playerModifiers.petalAttractionRadius ?? 0;
        // Filter out pets up-front; per-petal eligibility (mob within
        // playerPetalAttractionRadius of the petal's own orbit position) is checked
        // inside the petal physics loop, so each petal only attracts to mobs that are
        // actually near where *it* will swing past.
        const attractionCandidates = [];
        if (playerPetalAttractionRadius > 0) {
            for (const enemy of constants_1.enemies) {
                if (enemy.ownerId)
                    continue;
                attractionCandidates.push(enemy);
            }
        }
        // Initialize petal positions array
        player.petalPositions = [];
        // Pollen pre-pass: when the player attacks/defends, every alive pollen
        // instance drops a puff at its own orbit position. Health is zeroed in
        // a second pass so non-clumped multi-count petals (which share
        // petal.health) don't have instance 0 short-circuit the others.
        {
            const playerExt = player.inputs?.petalExtension || 1.0;
            if (playerExt !== 1.0) {
                const baseRadius = (60 + (constants_1.PLAYER_SIZE / 2) * (playerSizeMult - 1)) * playerExt;
                const dropsToBreak = [];
                for (let idx = 0; idx < petalInstances.length; idx++) {
                    const { petal, instanceIndex, slotIndex } = petalInstances[idx];
                    if (!petal || petal.petalType !== 'pollen')
                        continue;
                    const stats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
                    if (!stats)
                        continue;
                    if (isInstanceOnCooldown(petal, instanceIndex, stats))
                        continue;
                    if (getInstanceHealth(petal, instanceIndex, stats) <= 0)
                        continue;
                    const rotationAngle = ((stats.speed ?? 1.0) * playerOrbitPhase * 2) % (Math.PI * 2);
                    const totalAngle = stats.fixedDirection !== undefined
                        ? slotIndex * angleStep
                        : slotIndex * angleStep + rotationAngle;
                    const range = (stats.range ?? 1.0) * playerRangeModifier;
                    const orbitR = baseRadius * range;
                    let dropX = player.x + Math.cos(totalAngle) * orbitR;
                    let dropY = player.y + Math.sin(totalAngle) * orbitR;
                    const eSize = petal.customSize !== undefined ? petal.customSize : stats.size;
                    const clumpCount = stats.count || 1;
                    if (stats.clumped && clumpCount > 1) {
                        const clumpSpacing = eSize * 40 * 0.5;
                        const subAngle = (instanceIndex / clumpCount) * Math.PI * 2 + totalAngle;
                        dropX += Math.cos(subAngle) * clumpSpacing;
                        dropY += Math.sin(subAngle) * clumpSpacing;
                    }
                    spawnGroundPollen(io, player, stats, petal, dropX, dropY, 12 * eSize);
                    dropsToBreak.push({ petal, instanceIndex, stats });
                }
                for (const d of dropsToBreak) {
                    setInstanceHealth(d.petal, d.instanceIndex, d.stats, 0);
                }
            }
        }
        for (let idx = 0; idx < petalInstances.length; idx++) {
            const { petal, instanceIndex, loadoutIndex, slotIndex } = petalInstances[idx];
            if (!petal) {
                continue;
            }
            const instancePetalStats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
            // Skip petals that are on cooldown (per-instance for clumped, slot-wide otherwise)
            if (isInstanceOnCooldown(petal, instanceIndex, instancePetalStats)) {
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
                        const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
                        const petalSize = 40 * effectiveSize;
                        const actionContext = {
                            player: player,
                            petalX: petalX,
                            petalY: petalY,
                            petalSize: petalSize,
                            petalDamage: petalStats.damage,
                            enemies: constants_1.enemies,
                            io: io
                        };
                        (0, petal_actions_1.executePetalActions)(petalStats.actions, actionContext, 'on_break');
                    }
                    const cooldownTime = getEffectiveCooldown(petal, petalStats);
                    if (isClumpedMulti(petalStats)) {
                        // Clumped: only this instance breaks; other instances keep working
                        ensureInstanceArrays(petal, petalStats);
                        petal.instanceOnCooldown[instanceIndex] = true;
                        const snapshotPetalType = petal.petalType;
                        const snapshotRarity = petal.rarity;
                        const snapshotMaxHealth = petal.maxHealth;
                        setTimeout(() => {
                            const current = constants_1.players[player.id]?.loadout?.[loadoutIndex];
                            if (!current || current.type !== 'petal')
                                return;
                            if (current.petalType !== snapshotPetalType ||
                                current.rarity !== snapshotRarity)
                                return;
                            if (Array.isArray(current.instanceOnCooldown) &&
                                Array.isArray(current.instanceHealth)) {
                                current.instanceOnCooldown[instanceIndex] = false;
                                current.instanceHealth[instanceIndex] = snapshotMaxHealth ?? current.instanceHealth[instanceIndex];
                                // If any instance is alive, the slot is no longer fully on cooldown
                                if (current.instanceOnCooldown.every((c) => !c)) {
                                    current.onCooldown = false;
                                }
                            }
                        }, cooldownTime);
                        // Slot shows cooldown only when every instance is on cooldown
                        if (petal.instanceOnCooldown.every((c) => c)) {
                            petal.onCooldown = true;
                        }
                    }
                    else {
                        // Non-clumped: whole slot breaks (legacy behavior)
                        petal.onCooldown = true;
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
            if (!petalStats)
                continue;
            // Get effective size (custom size if set, otherwise base stats)
            const effectiveSize = petal.customSize !== undefined ? petal.customSize : petalStats.size;
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
            const petalRadius = baseRadius * petalRange;
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
            let petalX;
            let petalY;
            if (petalStats.fixedDirection !== undefined) {
                // Fixed-direction petals stay directly on the player
                petalX = player.x;
                petalY = player.y;
            }
            else if (petalRange === 0 || petalStats.noPhysics) {
                // No physics for range 0 or noPhysics petals - snap to orbit position directly
                petalX = targetX;
                petalY = targetY;
            }
            else {
                // Get per-petal physics values (use defaults if not specified)
                const petalSpringForce = petalStats.springForce ?? SPRING_FORCE;
                const petalDamping = petalStats.damping ?? DAMPING;
                const petalSpawnSmoothTime = petalStats.spawnSmoothTime ?? SPAWN_SMOOTH_TIME;
                // Get or initialize petal physics state
                let physicsState = petalPhysicsStates.get(petalId);
                if (!physicsState) {
                    // Initialize physics state at target orbit position (prevents petals from appearing inside player on reload)
                    physicsState = {
                        x: targetX,
                        y: targetY,
                        vx: 0,
                        vy: 0,
                        spawnTime: currentTime
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
                let closestEnemy = null;
                let closestDistanceSq = Infinity;
                for (const enemy of attractionCandidates) {
                    const candidateMobStats = (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                    const candidateEnemyRadius = candidateMobStats ? (candidateMobStats.size * 40) / 2 : constants_1.ENEMY_SIZE / 2;
                    const dx = enemy.x - targetX;
                    const dy = enemy.y - targetY;
                    const distSq = dx * dx + dy * dy;
                    const maxDist = playerPetalAttractionRadius + candidateEnemyRadius;
                    if (distSq <= maxDist * maxDist && distSq < closestDistanceSq) {
                        closestDistanceSq = distSq;
                        closestEnemy = enemy;
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
                    const closestMobStats = (0, mobs_1.getMobStats)(closestEnemy.type, closestEnemy.tier);
                    const closestEnemyRadius = closestMobStats ? (closestMobStats.size * 40) / 2 : constants_1.ENEMY_SIZE / 2;
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
                    springFx = normalizedSpringDx * petalSpringForce * springDistance * deltaTime * smoothFactor;
                    springFy = normalizedSpringDy * petalSpringForce * springDistance * deltaTime * smoothFactor;
                }
                physicsState.vx += springFx;
                physicsState.vy += springFy;
                physicsState.vx *= petalDamping;
                physicsState.vy *= petalDamping;
                physicsState.x += physicsState.vx * deltaTime;
                physicsState.y += physicsState.vy * deltaTime;
                // Use physics-based position
                petalX = physicsState.x;
                petalY = physicsState.y;
            }
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
            // Bubble pops in defensive position and propels the player away from where it was.
            // Boost magnitude scales up with rarity; the slot's cooldown also scales down (handled in the break flow).
            // Note: push newX/newY (the post-movement position that will be written back to player at the end
            // of updatePlayerState) — modifying player.x/player.y directly here gets clobbered.
            if (petal.petalType === 'bubble' && petalExtension < 1.0) {
                const dx = player.x - petalX;
                const dy = player.y - petalY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    const rarityIdx = Math.max(0, petals_1.RARITY_LEVELS.indexOf((petal.rarity ?? 'common')));
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
                        const stepLen = Math.min(MAX_STEP, remaining);
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
                    // The petal is at totalAngle, so the projectile should go in that direction
                    const projectileAngle = totalAngle;
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
                        const projectile = {
                            id: (0, gameState_1.allocatePlayerProjectileId)(),
                            playerId: player.id,
                            x: petalX,
                            y: petalY,
                            startX: petalX,
                            startY: petalY,
                            angle: finalAngle,
                            speed: projectileSpeed / 1000, // Convert to pixels per millisecond
                            distance: 0,
                            maxDistance: projectileConfig.distance,
                            petalType: petal.petalType,
                            petalRarity: petal.rarity,
                            damage: petalStats.damage,
                            size: effectiveSize,
                            health: petalStats.health,
                            maxHealth: petalStats.health,
                            spawnTime: currentTime
                        };
                        gameState_1.playerProjectiles.push(projectile);
                    }
                    // Update last shot time for this petal instance
                    // delete-then-set so the key moves to the end of insertion order;
                    // server.ts evicts from the front of the map as an O(1) LRU.
                    gameState_1.petalLastProjectileTime.delete(petalId);
                    gameState_1.petalLastProjectileTime.set(petalId, currentTime);
                }
            }
            // Check collision with enemies — broad-phase via spatial grid (built
            // once per tick in start_loop), then precise per-enemy distance test.
            // Pets and dead enemies are excluded by the grid.
            const _petalSize = 40 * effectiveSize;
            const _petalRadius = _petalSize / 2;
            const candidates = (0, enemyGrid_1.queryEnemiesNear)(petalX, petalY, _petalRadius + (0, enemyGrid_1.getMaxEnemyRadius)(), _enemyQueryBuffer);
            for (let _ei = 0; _ei < candidates.length; _ei++) {
                const enemy = candidates[_ei];
                // Cached on the enemy by rebuildEnemyGrid — type/tier never change after spawn.
                const mobStats = enemy._mobStats || (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
                const enemyRadius = enemy._radius ?? (constants_1.ENEMY_SIZE / 2);
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
                    enemy.health = Math.max(0, enemy.health - finalDamage);
                    // Petals with damageCooldown don't take damage from mobs (they can't break)
                    if (petalStats.damageCooldown) {
                        petalLastDamageTime.set(damageCooldownKey, currentTime);
                    }
                    else {
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
                            // Refresh the existing poison effect with the new damage and duration
                            enemy.poisonEffects[existingPoisonIndex] = {
                                damage: petalStats.poison,
                                endTime: endTime,
                                playerId: player.id
                            };
                        }
                        else {
                            // Add a new poison effect
                            enemy.poisonEffects.push({
                                damage: petalStats.poison,
                                endTime: endTime,
                                playerId: player.id
                            });
                        }
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
                    (0, utils_1.markEnemyDamaged)(enemy);
                    // Check if item spawner was hit and has 1% chance to spawn a random petal
                    if (enemy.type === 'item_spawner' && Math.random() < 0.01) {
                        // Get all petal types and filter out admin petals
                        const allPetalTypes = (0, petals_1.getAllPetalTypes)();
                        const nonAdminPetalTypes = allPetalTypes.filter(petalType => {
                            // Check if the petal is an admin petal by checking any rarity
                            const commonStats = (0, petals_1.getPetalStats)(petalType, 'common');
                            return !commonStats?.isAdminPetal;
                        });
                        if (nonAdminPetalTypes.length > 0) {
                            // Pick a random petal type
                            const randomPetalType = nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)];
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
                                x: enemy.x + offsetX,
                                y: enemy.y + offsetY,
                                rarity: randomRarity,
                                petalType: randomPetalType,
                                eligiblePlayers: eligiblePlayersForItem, // Include all split player IDs
                                pickedUpBy: new Set(),
                                spawnTime: spawnTime
                            };
                            // Check and fix wall collisions before adding item
                            (0, physics_2.checkItemWallCollisions)(newItem);
                            gameState_1.items.push(newItem);
                            // Send itemSpawned event to eligible players (map split player IDs to original socket IDs)
                            const { getOriginalSocketId } = require('./utils');
                            for (const eligiblePlayerId of eligiblePlayersForItem) {
                                const originalSocketId = getOriginalSocketId(eligiblePlayerId);
                                io.to(originalSocketId).emit('itemSpawned', newItem);
                            }
                            // Schedule automatic removal after expiration time
                            const expirationTime = gameState_1.ITEM_EXPIRATION_TIMES[randomRarity] || 10000;
                            const timeout = setTimeout(() => {
                                gameState_1.itemExpirationTimeouts.delete(itemId);
                                const itemIndex = gameState_1.items.findIndex(item => item.id === itemId);
                                if (itemIndex !== -1) {
                                    const expiredItem = gameState_1.items[itemIndex];
                                    gameState_1.items.splice(itemIndex, 1);
                                    // Notify eligible players that item expired
                                    const { getOriginalSocketId } = require('./utils');
                                    if (expiredItem.eligiblePlayers) {
                                        for (const playerId of expiredItem.eligiblePlayers) {
                                            const originalSocketId = getOriginalSocketId(playerId);
                                            io.to(originalSocketId).emit('itemRemoved', itemId);
                                        }
                                    }
                                    console.log(`[ITEM_SPAWNER] Petal ${randomPetalType} (${randomRarity}) expired after ${expirationTime}ms`);
                                }
                            }, expirationTime);
                            gameState_1.itemExpirationTimeouts.set(itemId, timeout);
                            console.log(`[ITEM_SPAWNER] Spawned random petal: ${randomPetalType} (${randomRarity}) for player ${player.name}`);
                        }
                    }
                    // Check collision with mob projectiles (treat them as enemy petals)
                    for (let projIdx = gameState_1.mobProjectiles.length - 1; projIdx >= 0; projIdx--) {
                        const mobProjectile = gameState_1.mobProjectiles[projIdx];
                        // Skip destroyed projectiles
                        if (!mobProjectile || mobProjectile.health <= 0) {
                            continue;
                        }
                        const projectileSize = mobProjectile.size * 20; // Convert to pixels
                        const projectileRadius = projectileSize / 2;
                        const petalSize = 40 * effectiveSize; // Use effective size (custom or base)
                        const petalRadius = petalSize / 2;
                        const dx = mobProjectile.x - petalX;
                        const dy = mobProjectile.y - petalY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const minDistance = projectileRadius + petalRadius;
                        if (distance < minDistance && distance > 0) {
                            // Player petal hits mob projectile - deal damage to both
                            const damageMultiplier = (0, petal_actions_1.getDamageMultiplier)(player);
                            const finalDamage = petalStats.damage * damageMultiplier;
                            // Damage the mob projectile
                            mobProjectile.health -= finalDamage;
                            // Damage the player petal (mob projectile acts as enemy petal)
                            const projectilePetalStats = (0, petals_1.getPetalStats)(mobProjectile.petalType, mobProjectile.petalRarity);
                            const projectileDamage = projectilePetalStats ? projectilePetalStats.damage : mobProjectile.damage;
                            const prevProjInstanceHealth = getInstanceHealth(petal, instanceIndex, petalStats);
                            setInstanceHealth(petal, instanceIndex, petalStats, Math.max(0, prevProjInstanceHealth - projectileDamage));
                            // Remove projectile if destroyed
                            if (mobProjectile.health <= 0) {
                                gameState_1.mobProjectiles.splice(projIdx, 1);
                            }
                        }
                    }
                    // Handle petal collision for wait_until_collision actions
                    const petalId = `${player.id}_${loadoutIndex}_${instanceIndex}`;
                    const collisionContext = {
                        player: player,
                        petalX: petalX,
                        petalY: petalY,
                        petalSize: petalSize,
                        petalDamage: petalStats.damage, // Include petal damage for rarity scaling
                        enemies: constants_1.enemies,
                        io: io,
                        petalId: petalId,
                        loadoutIndex: loadoutIndex,
                        instanceIndex: instanceIndex
                    };
                    (0, petal_actions_1.handlePetalCollision)(petalId, collisionContext);
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
                                enemies: constants_1.enemies,
                                io: io
                            };
                            (0, petal_actions_1.executePetalActions)(petalStats.actions, actionContext, 'on_break');
                        }
                        const cooldownTime = getEffectiveCooldown(petal, petalStats);
                        if (isClumpedMulti(petalStats)) {
                            // Clumped: only this instance breaks
                            ensureInstanceArrays(petal, petalStats);
                            petal.instanceOnCooldown[instanceIndex] = true;
                            const snapshotPetalType = petal.petalType;
                            const snapshotRarity = petal.rarity;
                            const snapshotMaxHealth = petal.maxHealth;
                            setTimeout(() => {
                                const current = constants_1.players[player.id]?.loadout?.[loadoutIndex];
                                if (!current || current.type !== 'petal')
                                    return;
                                if (current.petalType !== snapshotPetalType ||
                                    current.rarity !== snapshotRarity)
                                    return;
                                if (Array.isArray(current.instanceOnCooldown) &&
                                    Array.isArray(current.instanceHealth)) {
                                    current.instanceOnCooldown[instanceIndex] = false;
                                    current.instanceHealth[instanceIndex] = snapshotMaxHealth ?? current.instanceHealth[instanceIndex];
                                    if (current.instanceOnCooldown.every((c) => !c)) {
                                        current.onCooldown = false;
                                    }
                                }
                            }, cooldownTime);
                            if (petal.instanceOnCooldown.every((c) => c)) {
                                petal.onCooldown = true;
                            }
                        }
                        else {
                            // Non-clumped: whole slot breaks (legacy behavior)
                            petal.onCooldown = true;
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
                    if (enemy.health <= 0 && !enemy.isDead) {
                        // console.log('[Server] Enemy died from petal collision', {
                        //     enemyId: enemy.id,
                        //     enemyType: enemy.type,
                        //     enemyTier: enemy.tier,
                        //     enemyHealth: enemy.health,
                        //     playerId: player.id,
                        //     hasDamageContributors: !!enemy.damageContributors,
                        //     damageContributorsSize: enemy.damageContributors?.size || 0
                        // });
                        // Mark enemy as dead to prevent multiple death handlers
                        enemy.isDead = true;
                        const index = constants_1.enemies.findIndex(e => e.id === enemy.id);
                        if (index !== -1) {
                            // console.log('[Server] Enemy death handler - found index', { enemyId: enemy.id });
                            // CRITICAL: Copy damageContributors BEFORE cleanupEnemy clears it
                            const damageContributorsCopy = enemy.damageContributors ? new Map(enemy.damageContributors) : undefined;
                            // console.log('[Server] Enemy killed by petal collision (second handler) - BEFORE cleanup', {
                            //     enemyType: enemy.type,
                            //     enemyTier: enemy.tier,
                            //     hasDamageContributors: !!enemy.damageContributors,
                            //     damageContributorsSize: enemy.damageContributors?.size || 0,
                            //     hasDamageContributorsCopy: !!damageContributorsCopy,
                            //     copySize: damageContributorsCopy?.size || 0,
                            //     hasIo: !!io
                            // });
                            // Follow same path as lightning damage - synchronous execution
                            const xpGained = (0, server_utils_1.getXPFromEnemy)(enemy);
                            addXPToPlayer(player, xpGained, player.id);
                            handleMobDrops(enemy);
                            sendBossMobDefeatedMessage(enemy, io, constants_1.players);
                            updateSpecialMobCounts();
                            // Remove enemy from array
                            (0, utils_1.cleanupEnemy)(enemy);
                            constants_1.enemies.splice(index, 1);
                            // Emit enemy destroyed event
                            io.emit('enemyDestroyed', enemy.id);
                            // Call trackMobKill synchronously to ensure it runs
                            // Use the copy we made BEFORE cleanupEnemy
                            if (damageContributorsCopy) {
                                const enemyDataForTracking = {
                                    type: enemy.type,
                                    tier: enemy.tier,
                                    damageContributors: damageContributorsCopy
                                };
                                // console.log('[Server] Calling trackMobKill synchronously (second handler)', {
                                //     enemyType: enemyDataForTracking.type,
                                //     enemyTier: enemyDataForTracking.tier,
                                //     hasIo: !!io,
                                //     damageContributorsSize: enemyDataForTracking.damageContributors.size
                                // });
                                trackMobKill(enemyDataForTracking, constants_1.players, gameState_1.playerUserIds, database, io, savePlayerProgress);
                            }
                            else {
                                // console.warn('[Server] No damageContributorsCopy (second handler), skipping trackMobKill');
                            }
                        }
                    }
                }
            }
            // PVP petal-vs-player collision: if both attacker and victim are inside the
            // arena, a petal swing on contact deals damage and knocks the victim back.
            if (player.inPvpArena) {
                const petalSizePx = 40 * effectiveSize;
                const petalRadius = petalSizePx / 2;
                for (const otherId in constants_1.players) {
                    if (otherId === player.id)
                        continue;
                    const other = constants_1.players[otherId];
                    if (!other || other.isDead || !other.inPvpArena)
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
                                if (constants_1.players[otherPlayerId]) {
                                    constants_1.players[otherPlayerId].isInvulnerable = false;
                                    io.emit('playerInvulnerabilityEnded', { playerId: otherPlayerId });
                                }
                            }, constants_1.RESPAWN_INVULNERABILITY_TIME);
                            console.log(`Player ${player.name} automatically revived ${otherPlayer.name} using yggdrasil petal (petal broke)`);
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
    const pickupSize = constants_1.PLAYER_SIZE * (player.sizeMultiplier ?? 1.0) + (player.magnetism ?? 0);
    const pickupRadiusSquared = pickupSize * pickupSize;
    for (let i = gameState_1.items.length - 1; i >= 0; i--) {
        const item = gameState_1.items[i];
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
            const rarity = item.rarity || 'common';
            const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
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
            io.to(originalSocketId).emit('itemPickedUp', item.id);
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
                    // Clean up expiration timeout if item is removed early
                    const timeout = gameState_1.itemExpirationTimeouts.get(item.id);
                    if (timeout) {
                        clearTimeout(timeout);
                        gameState_1.itemExpirationTimeouts.delete(item.id);
                    }
                    gameState_1.items.splice(i, 1);
                    // Notify only eligible players that the item is gone
                    for (const playerId of item.eligiblePlayers) {
                        io.to(playerId).emit('itemRemoved', item.id);
                    }
                }
            }
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
                io.to(player.id).emit('teleporterEntered', {
                    teleporterId,
                    timeRequired: 1000,
                    teleportTo: element.properties.teleportTo
                });
                console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} entered teleporter, waiting 1 second...`);
            }
            // Check if player has been in teleporter for 1 second and is not on cooldown
            const timeInTeleporter = currentTime - (player.teleporterEnterTime || currentTime);
            if (timeInTeleporter >= 1000 && !isOnCooldown) {
                const teleportTo = element.properties.teleportTo;
                // Set 5 second player-based cooldown
                player.teleportCooldown = currentTime + constants_1.TELEPORTER_COOLDOWN;
                if (teleportTo.serverPort && teleportTo.serverPort !== currentServerPort) {
                    console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleporting to server port ${teleportTo.serverPort} after 1 second delay`);
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    transferPlayerToServer(player, teleportTo.serverPort, teleportTo.x * constants_1.SCALE_FACTOR, teleportTo.y * constants_1.SCALE_FACTOR, io, database, useHttps, currentServerConfig, currentServerPort).catch(error => {
                        console.error(`[SERVER ${currentServerConfig.name}] Failed to transfer player ${player.name}:`, error);
                        io.to(player.id).emit('transferFailed', { message: 'Failed to connect to target server' });
                        player.teleportCooldown = undefined;
                    });
                    return;
                }
                else {
                    newX = teleportTo.x * constants_1.SCALE_FACTOR;
                    newY = teleportTo.y * constants_1.SCALE_FACTOR;
                    player.currentTeleporter = undefined;
                    player.teleporterEnterTime = undefined;
                    console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} teleported to (${newX}, ${newY}) after 1 second delay`);
                    io.to(player.id).emit('playerTeleported', {
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
        console.log(`[SERVER ${currentServerConfig.name}] Player ${player.name} left teleporter`);
        player.currentTeleporter = undefined;
        player.teleporterEnterTime = undefined;
        io.to(player.id).emit('teleporterExited');
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
