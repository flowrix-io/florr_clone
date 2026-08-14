"use strict";
/**
 * The admission point for wild mobs.
 *
 * ---------------------------------------------------------------------------
 * Who owns a mob
 * ---------------------------------------------------------------------------
 * A mob is ONE thing with TWO representations, and both are load-bearing:
 *
 *   the ECS entity   is what the simulation moves, aims, collides and shoots.
 *   the legacy shell (`Enemy` in `enemies[]`) is what the broadcast encodes and
 *                    what the reaper walks to award XP and drops. Broadcast and
 *                    persistence stay legacy, so the shell is not optional.
 *
 * Either one alone is a bug that fails SILENTLY:
 *   entity with no shell  -> invisible to every client, never reaped, immortal.
 *   shell with no entity  -> never simulated; a statue that still deals contact
 *                            damage and still shows up on the wire.
 *
 * So creation is made atomic and structural rather than conventional:
 * `spawnEnemy` is the ONLY producer of `LiveEnemy`, `enemies` is a
 * `LiveEnemy[]`, and the entity is created BEFORE the array push. There is no
 * ordering in which one exists without the other, and `enemies.push(someEnemy)`
 * elsewhere does not compile.
 *
 * ---------------------------------------------------------------------------
 * The other half
 * ---------------------------------------------------------------------------
 * DESTRUCTION is still legacy-driven: ~14 sites splice `enemies[]` (the reaper,
 * killHandler, pet despawns, the maze rotation, the distance despawner), and
 * lifecycle is not part of this cutover. `reconcileEnemyEntities` in ecsSync.ts
 * is the removal half of the bridge: once per tick it destroys any mob entity
 * whose shell has left the array. That is a reconcile, not a convention — no
 * splice site has to remember anything.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindEnemySpawnHost = bindEnemySpawnHost;
exports.spawnEnemy = spawnEnemy;
exports.markCentipedeHead = markCentipedeHead;
const server_utils_1 = require("../server_utils");
const constants_1 = require("../constants");
const mobs_1 = require("../mobs");
const ecs_1 = require("../ecs");
const C = __importStar(require("../ecs/components"));
const prefabs_1 = require("../ecs/prefabs");
const ecsBridge_1 = require("./ecsBridge");
let host;
/** Install the ECS host. Called once, from the composition root. */
function bindEnemySpawnHost(installed) {
    host = installed;
}
function requireHost() {
    if (!host) {
        throw new Error('enemyRegistry: no ECS host installed. server.ts must call '
            + 'bindEnemySpawnHost() at startup — without it a spawn would produce '
            + 'a legacy shell with no entity, which nothing would ever simulate.');
    }
    return host;
}
/**
 * Create a mob. Returns null when the (type, tier) pair has no stats.
 *
 * Order matters: the shell is built as a plain value, the entity is created and
 * linked, and ADMISSION to `enemies[]` is the last thing that happens. So there
 * is no window in which the array holds a mob the simulation cannot see, and an
 * early return leaves nothing behind in either representation.
 *
 * This replaces the old `buildEnemy` + `enemies.push(...)` pair at every spawn
 * site. Both representations are derived from the SAME resolved locals below,
 * so they cannot disagree about health, damage, facing or radius.
 */
function spawnEnemy(type, tier, x, y, opts) {
    const stats = (0, mobs_1.getMobStats)(type, tier);
    if (!stats)
        return null;
    const activeHost = requireHost();
    const world = activeHost.getWorld();
    const now = Date.now();
    const id = Math.random().toString(36).slice(2, 11);
    const angle = opts?.angle ?? Math.random() * Math.PI * 2;
    const maxHealth = opts?.maxHealth ?? stats.health;
    const health = opts?.health ?? maxHealth;
    const damage = opts?.damage ?? stats.damage;
    const speed = stats.speed;
    // The legacy shell. Still built through makeEnemy so every enemy in the
    // process keeps the one hidden class that file exists to guarantee.
    const enemy = (0, server_utils_1.makeEnemy)({
        id,
        type: type,
        tier,
        x,
        y,
        angle,
        health,
        maxHealth,
        speed,
        damage,
        knockbackX: 0,
        knockbackY: 0,
        aiType: opts?.aiType ?? stats.ai_type,
        range: opts?.range ?? stats.range,
        reversed: opts?.bossWireShape ? undefined : (opts?.reversed ?? stats.reversed ?? false),
        spawnTime: now,
        lastViewportCheck: opts?.bossWireShape ? undefined : now,
        parentHoleId: opts?.parentHoleId,
        ownerId: opts?.ownerId,
        petImage: opts?.petImage,
        leaderId: opts?.leaderId,
        headId: opts?.headId,
        segmentIndex: opts?.segmentIndex,
        challengeOwnerId: opts?.challengeOwnerId,
        challengeStarsReward: opts?.challengeStarsReward,
        targetPlayerId: opts?.targetPlayerId,
        despawnAt: opts?.despawnAt,
    });
    // The entity, from the same locals. `spawnMob` is the archetype every mob
    // shares; `attachMobBehaviour` adds the per-type extras (drift, bee wobble,
    // render flip, expiry); `linkEnemyReferences` resolves owner / hole / chain,
    // all of which already exist because a parent is always admitted first.
    const entity = (0, prefabs_1.spawnMob)(world, {
        id,
        type,
        tier,
        x,
        y,
        angle,
        health,
        maxHealth,
        speed,
        damage,
        radius: (0, ecsBridge_1.radiusOf)(enemy, stats),
        aiType: (0, ecsBridge_1.aiTypeOf)(enemy),
        range: enemy.range,
        stats,
        now,
    });
    (0, ecsBridge_1.attachMobBehaviour)(world, entity, enemy, now);
    (0, ecsBridge_1.linkEnemyReferences)(world, enemy, activeHost.resolvePlayer);
    constants_1.enemies.push(enemy);
    return enemy;
}
/**
 * Promote an already-admitted mob to the head of a centipede chain.
 *
 * Split out because the chain is laid down by `spawnCentipedeBodySegments`
 * AFTER the head exists, and the head's own CentipedeSegment (index 0, leader
 * none, head self) has to reach the entity too — the legacy fields alone are
 * read by nobody now that the chain passes are ECS-owned.
 */
function markCentipedeHead(head) {
    head.headId = head.id;
    head.segmentIndex = 0;
    const world = requireHost().getWorld();
    const entity = world.lookup(head.id);
    if (entity === undefined)
        return;
    world.add(entity, C.CentipedeSegment, {
        leader: ecs_1.NULL_ENTITY,
        head: entity,
        segmentIndex: 0,
    });
}
