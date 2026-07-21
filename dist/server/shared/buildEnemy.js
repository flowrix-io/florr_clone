"use strict";
/**
 * `buildEnemy` — the canonical way to construct a fully-statted enemy from a
 * (type, tier, x, y) tuple, built on top of `makeEnemy`.
 *
 * Why this exists: every spawner used to hand-build the same ~15-field
 * `makeEnemy({...})` literal, copying the `getMobStats` lookup, the
 * `Math.random().toString(36)` id, the `Date.now()` timestamps, and the
 * angle/health/speed/damage/ai wiring. The literals drifted subtly (some set
 * `reversed`, some didn't; some used `.substr(2, 9)`, some `.slice(2, 11)`).
 * This is the single source; site-specific fields (`parentHoleId`,
 * `ownerId`/`petImage` for pets, `leaderId`/`headId`/`segmentIndex` for
 * centipede chains, etc.) go through `opts`.
 *
 * Lives in `server/shared/` rather than `server_utils.ts` to keep
 * `server_utils.ts` a pure leaf (its only import is `./constants`); importing
 * `getMobStats` there would widen its dependency surface for no other benefit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEnemy = buildEnemy;
const server_utils_1 = require("../../server_utils");
const mobs_1 = require("../../mobs");
/**
 * Build a fully-initialised enemy from mob stats. Returns `null` if the mob
 * type/tier has no stats (same contract as the old `mazeSpawner.buildEnemy`).
 *
 * Field defaults match the historical `mazeSpawner.buildEnemy` literal — the
 * most complete of the originals — so every enemy gets `reversed`,
 * `spawnTime`, and `lastViewportCheck` populated.
 */
function buildEnemy(type, tier, x, y, opts) {
    const stats = (0, mobs_1.getMobStats)(type, tier);
    if (!stats)
        return null;
    const currentTime = Date.now();
    return (0, server_utils_1.makeEnemy)({
        id: Math.random().toString(36).slice(2, 11),
        type: type,
        tier,
        x,
        y,
        angle: Math.random() * Math.PI * 2,
        health: stats.health,
        maxHealth: stats.health,
        speed: stats.speed,
        damage: stats.damage,
        knockbackX: 0,
        knockbackY: 0,
        aiType: opts?.aiType ?? stats.ai_type,
        range: opts?.range ?? stats.range,
        reversed: opts?.reversed ?? stats.reversed ?? false,
        spawnTime: currentTime,
        lastViewportCheck: currentTime,
        parentHoleId: opts?.parentHoleId,
        ownerId: opts?.ownerId,
        petImage: opts?.petImage,
        leaderId: opts?.leaderId,
        headId: opts?.headId,
        segmentIndex: opts?.segmentIndex,
        challengeOwnerId: opts?.challengeOwnerId,
        challengeStarsReward: opts?.challengeStarsReward,
    });
}
