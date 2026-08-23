"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGlitchInfectingType = isGlitchInfectingType;
exports.isCentipedeHeadType = isCentipedeHeadType;
exports.isCentipedeBodyType = isCentipedeBodyType;
exports.getCentipedeBodyType = getCentipedeBodyType;
exports.makeEnemy = makeEnemy;
exports.getXPFromEnemy = getXPFromEnemy;
/**
 * Mobs whose touch (body, petal ring or shot) leaves a player glitched — the
 * transient PlayerRenderFlags.Glitch bit, cleared only on respawn. Kept in one
 * place so a new glitch-family mob infects through every contact path at once
 * (body collision in playerState.ts, projectile impact in server.ts).
 */
function isGlitchInfectingType(type) {
    return type === 'glitch' || type === 'glitch_flower';
}
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
        entity: 0,
        type: init.type,
        tier: init.tier,
        parentHoleId: init.parentHoleId,
        damageContributors: init.damageContributors,
        ownerId: init.ownerId,
        petImage: init.petImage,
        challengeOwnerId: init.challengeOwnerId,
        challengeStarsReward: init.challengeStarsReward,
        leaderId: init.leaderId,
        headId: init.headId,
        segmentIndex: init.segmentIndex,
    };
}
function getXPFromEnemy(enemy) {
    // Import mob config to get actual XP values
    const { getMobStats } = require('./mobs');
    const mobStats = getMobStats(enemy.type, enemy.tier);
    if (mobStats && mobStats.xp) {
        return mobStats.xp;
    }
    // Fallback to tier-based XP if mob config lookup fails (e.g. unconfigured mob type)
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
