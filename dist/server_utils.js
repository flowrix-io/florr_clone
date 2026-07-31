"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCentipedeHeadType = isCentipedeHeadType;
exports.isCentipedeBodyType = isCentipedeBodyType;
exports.getCentipedeBodyType = getCentipedeBodyType;
exports.makeEnemy = makeEnemy;
exports.getRandomPositionInZone = getRandomPositionInZone;
exports.createDecoration = createDecoration;
exports.createSand = createSand;
exports.getXPFromEnemy = getXPFromEnemy;
const constants_1 = require("./constants");
const sands = [];
function isCentipedeHeadType(type) {
    return type === 'centipede' || type === 'desert_centipede' || type === 'evil_centipede';
}
function isCentipedeBodyType(type) {
    return type === 'centipede_body' || type === 'desert_centipede_body' || type === 'evil_centipede_body';
}
function getCentipedeBodyType(headType) {
    if (headType === 'desert_centipede')
        return 'desert_centipede_body';
    if (headType === 'evil_centipede')
        return 'evil_centipede_body';
    return 'centipede_body';
}
/**
 * The ONLY place a server-side enemy object may be created.
 *
 * Why this exists: V8 gives an object a hidden class determined by its exact set of
 * properties *and the order they were added*. Enemies used to be built from ten
 * different object literals with different key sets (pets added `ownerId`/`petImage`,
 * special mobs omitted `reversed`/`lastViewportCheck`, centipede segments added
 * `leaderId`/`headId`/`segmentIndex`), and `_radius`/`_mobStats`/`isDead` were bolted
 * on later still. Any property read that saw more than four of those shapes went
 * megamorphic, so `enemy.x` in the petal/collision hot loops became a hash lookup in
 * V8's global IC cache instead of an inlined offset load — profiling prod showed ~48%
 * of all server CPU sitting in Builtins_*LoadIC_Megamorphic.
 *
 * Emitting one literal with every key, always in this order, gives every enemy in the
 * process one identical hidden class, so those loads go monomorphic.
 *
 * Rules for anyone editing this file:
 *  - Add new fields to BOTH the interface and this literal, in the same position.
 *  - Never `delete` a property off an enemy (that demotes it to dictionary mode).
 *  - Optional fields default to `undefined`, never `0`/`false`/`null`: raw enemies are
 *    emitted to clients by `enemiesUpdate` and `enemySpawned`, and JSON.stringify drops
 *    undefined values, so the wire format is unchanged. A concrete default would add
 *    new keys to those payloads.
 */
function makeEnemy(init) {
    return {
        id: init.id,
        type: init.type,
        tier: init.tier,
        x: init.x,
        y: init.y,
        angle: init.angle,
        health: init.health,
        maxHealth: init.maxHealth,
        speed: init.speed,
        damage: init.damage,
        knockbackX: init.knockbackX,
        knockbackY: init.knockbackY,
        aiType: init.aiType,
        isChasing: init.isChasing,
        targetPlayerId: init.targetPlayerId,
        targetEnemyId: init.targetEnemyId,
        targetPetId: init.targetPetId,
        range: init.range,
        wanderTargetX: init.wanderTargetX,
        wanderTargetY: init.wanderTargetY,
        lastWanderTime: init.lastWanderTime,
        passiveState: init.passiveState,
        passiveStateStart: init.passiveStateStart,
        velX: init.velX,
        velY: init.velY,
        wobblePhase: init.wobblePhase,
        parentHoleId: init.parentHoleId,
        returningToHole: init.returningToHole,
        spawnTime: init.spawnTime,
        lastViewportCheck: init.lastViewportCheck,
        damageContributors: init.damageContributors,
        poisonEffects: init.poisonEffects,
        lastProjectileTime: init.lastProjectileTime,
        lastMeleeAttackTime: init.lastMeleeAttackTime,
        reversed: init.reversed,
        ownerId: init.ownerId,
        petImage: init.petImage,
        dpsHistoryTimes: init.dpsHistoryTimes,
        dpsHistoryDamages: init.dpsHistoryDamages,
        dpsStartTime: init.dpsStartTime,
        currentDPS: init.currentDPS,
        challengeOwnerId: init.challengeOwnerId,
        challengeStarsReward: init.challengeStarsReward,
        leaderId: init.leaderId,
        headId: init.headId,
        segmentIndex: init.segmentIndex,
        baseSpeed: init.baseSpeed,
        slowUntil: init.slowUntil,
        lastPeriodicSpawnTime: init.lastPeriodicSpawnTime,
        despawnAt: init.despawnAt,
        isDead: init.isDead,
        _radius: init._radius,
        _mobStats: init._mobStats,
        _ci: init._ci,
        _qs: init._qs,
        _spawnWavePrevHealth: init._spawnWavePrevHealth,
    };
}
function getRandomPositionInZone(zoneIndex) {
    const zoneWidth = constants_1.WORLD_WIDTH / 6; // 6 zones
    const startX = zoneIndex * zoneWidth;
    // For legendary and mythic zones, ensure they're in the rightmost areas
    if (zoneIndex >= 4) { // Legendary and Mythic zones
        const adjustedStartX = constants_1.WORLD_WIDTH - (6 - zoneIndex) * (zoneWidth / 2); // Start from right side
        return {
            x: adjustedStartX + Math.random() * (constants_1.WORLD_WIDTH - adjustedStartX),
            y: Math.random() * constants_1.WORLD_HEIGHT
        };
    }
    return {
        x: startX + Math.random() * zoneWidth,
        y: Math.random() * constants_1.WORLD_HEIGHT
    };
}
function createDecoration() {
    const zoneIndex = Math.floor(Math.random() * 6); // 6 zones
    const pos = getRandomPositionInZone(zoneIndex);
    return {
        x: pos.x,
        y: pos.y,
        scale: 0.5 + Math.random() * 1.5
    };
}
function createSand() {
    // Create sand patches with more spacing
    const sectionWidth = constants_1.WORLD_WIDTH; // Divide world into sections
    const sectionIndex = sands.length;
    return {
        x: (sectionIndex * sectionWidth) + Math.random() * sectionWidth, // Spread out along x-axis
        y: Math.random() * constants_1.WORLD_HEIGHT,
        radius: constants_1.MIN_SAND_RADIUS + Math.random() * (constants_1.MAX_SAND_RADIUS - constants_1.MIN_SAND_RADIUS),
        rotation: Math.random() * Math.PI * 2
    };
}
function getXPFromEnemy(enemy) {
    // Import mob config to get actual XP values
    const { getMobStats } = require('./mobs');
    // Map enemy types to mob types - only handle mobs that exist in our config
    const mobType = enemy.type;
    if (mobType === 'bee' || mobType === 'ladybug' || mobType === 'soldier_ant') {
        const mobStats = getMobStats(mobType, enemy.tier);
        if (mobStats && mobStats.xp) {
            return mobStats.xp;
        }
    }
    // Fallback to tier-based XP for other enemy types or if mob config lookup fails
    const tierXP = {
        common: 10,
        uncommon: 30,
        rare: 90,
        epic: 270,
        legendary: 810,
        mythic: 2430,
        ultra: 7290,
        super: 21870,
        unique: 65610,
        apex: 196830
    };
    return tierXP[enemy.tier] || 10;
}
// Note: addXPToPlayer moved to server.ts to properly handle socket events
