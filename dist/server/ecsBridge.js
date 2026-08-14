"use strict";
/**
 * Legacy <-> ECS entity bridge.
 *
 * Converts the game's existing `Enemy` and `ServerPlayer` objects into ECS
 * entities.
 *
 * The important work is not copying fields, it is choosing the ARCHETYPE:
 * a plain mob must NOT carry Wander/Wobble/PassiveMotion/HoleTether, because
 * the AI and drift systems route on exactly those components. Getting it wrong
 * fails silently — a bee without Wobble runs the stop-and-go machine and simply
 * stops looking like a bee.
 *
 * Since the spawn cutover this file has two distinct users, and the difference
 * matters:
 *
 *   - `attachMobBehaviour` / `linkEnemyReferences` are the ARCHETYPE DECISION,
 *     shared with server/enemyRegistry.ts so a mob built at spawn time and a mob
 *     adopted from a legacy snapshot end up with the same shape. There is one
 *     decision per component, here.
 *   - `importEnemy` / `importWorld` ADOPT an existing legacy object. That is now
 *     only the harness (which builds a legacy world on purpose) and the
 *     orphan-adoption safety net in ecsSync. The live game does not import mobs
 *     any more — they are born as entities.
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
exports.aiTypeOf = aiTypeOf;
exports.radiusOf = radiusOf;
exports.attachMobBehaviour = attachMobBehaviour;
exports.importEnemy = importEnemy;
exports.linkEnemyReferences = linkEnemyReferences;
exports.importPlayer = importPlayer;
exports.importWorld = importWorld;
const mobs_1 = require("../mobs");
const constants_1 = require("../constants");
const ecs_1 = require("../ecs");
const C = __importStar(require("../ecs/components"));
const interning_1 = require("../ecs/interning");
const prefabs_1 = require("../ecs/prefabs");
/** Mob types that use the bee cruise machine rather than the default one. */
const BEE_FLIGHT_TYPES = new Set(['bee']);
/** Mob AI type strings mapped to the component enum. */
function aiTypeOf(enemy) {
    switch (enemy.aiType) {
        case 'passive': return 0 /* C.AiType.Passive */;
        case 'hostile': return 2 /* C.AiType.Hostile */;
        case 'sandstorm': return 3 /* C.AiType.Sandstorm */;
        default: return 1 /* C.AiType.Neutral */;
    }
}
/** The collision radius formula, shared with the grid rebuild. */
function radiusOf(enemy, stats) {
    const base = stats ? (stats.size * 40) / 2 : constants_1.ENEMY_SIZE / 2;
    return base * (0, mobs_1.getEnemySizeScale)(!!enemy.ownerId, enemy.tier);
}
/**
 * Add the optional behaviour components a mob's TYPE and STATE call for.
 *
 * This is the archetype decision for everything `spawnMob` deliberately leaves
 * out, and it is shared by both entity-creation paths (birth in
 * enemyRegistry.spawnEnemy, adoption in importEnemy below). Keeping it in one
 * place is what stops a spawned bee and an adopted bee from having different
 * shapes — a difference that would show up as one of them silently running the
 * wrong movement machine.
 *
 * Reference-typed relationships (owner, hole, chain) are NOT here: they need
 * other entities to exist, so they go through `linkEnemyReferences`.
 */
function attachMobBehaviour(world, entity, enemy, now) {
    // Passive drift: only mobs that can actually move idle-drift.
    if (enemy.speed > 0) {
        world.add(entity, C.PassiveMotion, {
            state: enemy.passiveState === 'moving' ? 1 /* C.PassiveState.Moving */ : 0 /* C.PassiveState.Idle */,
            stateStart: enemy.passiveStateStart ?? now,
        });
        world.add(entity, C.IsIdle);
        world.write(entity, C.Velocity, { x: enemy.velX ?? 0, y: enemy.velY ?? 0 });
    }
    // The bee cruise machine is selected by the Wobble component.
    if (BEE_FLIGHT_TYPES.has(enemy.type)) {
        world.add(entity, C.Wobble, { phase: enemy.wobblePhase ?? Math.random() * Math.PI * 2 });
    }
    if (enemy.reversed !== undefined) {
        world.add(entity, C.RenderFlip, { flipped: enemy.reversed ? 1 : 0 });
    }
    if (enemy.despawnAt) {
        world.add(entity, C.Expires, { at: enemy.despawnAt });
    }
}
/**
 * Create an ECS entity mirroring an EXISTING legacy `enemy`.
 *
 * Adoption, not birth: it copies mid-life state (wander target, knockback,
 * attack timers, DPS history) that a freshly spawned mob does not have. The
 * live game spawns mobs through enemyRegistry.spawnEnemy instead; this remains
 * for the tick harness's legacy-world import and for ecsSync's orphan-adoption
 * safety net.
 */
function importEnemy(world, enemy, now) {
    const stats = enemy._mobStats ?? (0, mobs_1.getMobStats)(enemy.type, enemy.tier);
    const entity = (0, prefabs_1.spawnMob)(world, {
        id: enemy.id,
        type: enemy.type,
        tier: enemy.tier,
        x: enemy.x,
        y: enemy.y,
        angle: enemy.angle,
        health: enemy.health,
        maxHealth: enemy.maxHealth,
        speed: enemy.speed,
        damage: enemy.damage,
        radius: enemy._radius ?? radiusOf(enemy, stats),
        aiType: aiTypeOf(enemy),
        range: enemy.range,
        stats,
        now,
    });
    // Speed carries its unslowed baseline separately so a lapsing slow restores
    // the right value.
    world.write(entity, C.Speed, {
        current: enemy.speed,
        base: enemy.baseSpeed ?? enemy.speed,
    });
    if (enemy.slowUntil !== undefined) {
        world.add(entity, C.Slowed, { until: enemy.slowUntil });
    }
    attachMobBehaviour(world, entity, enemy, now);
    if (enemy.wanderTargetX !== undefined) {
        world.add(entity, C.Wander, {
            targetX: enemy.wanderTargetX,
            targetY: enemy.wanderTargetY ?? enemy.y,
            lastTime: enemy.lastWanderTime ?? 0,
        });
    }
    if (enemy.knockbackX || enemy.knockbackY) {
        world.add(entity, C.Knockback, { x: enemy.knockbackX ?? 0, y: enemy.knockbackY ?? 0 });
    }
    if (enemy.lastProjectileTime !== undefined || enemy.lastMeleeAttackTime !== undefined) {
        world.add(entity, C.AttackTimers, {
            lastProjectileTime: enemy.lastProjectileTime ?? 0,
            lastMeleeAttackTime: enemy.lastMeleeAttackTime ?? 0,
        });
    }
    if (enemy.damageContributors) {
        world.add(entity, C.DamageContributors, { byPlayer: enemy.damageContributors });
    }
    if (enemy.lastPeriodicSpawnTime !== undefined) {
        world.add(entity, C.PeriodicSpawner, { lastSpawnTime: enemy.lastPeriodicSpawnTime });
    }
    if (enemy.currentDPS !== undefined || enemy.dpsStartTime !== undefined) {
        world.add(entity, C.DpsTracker, {
            historyTimes: enemy.dpsHistoryTimes ?? [],
            historyDamages: enemy.dpsHistoryDamages ?? [],
            startTime: enemy.dpsStartTime ?? now,
            currentDPS: enemy.currentDPS ?? 0,
        });
    }
    // ChallengeMob is added by linkEnemyReferences, which is where the buyer's
    // entity can actually be resolved.
    return entity;
}
/**
 * Resolve the id-based cross-references an enemy carries into entity handles.
 *
 * When ADOPTING a snapshot this must run as a SECOND pass, after every enemy
 * has an entity: a centipede segment can reference a leader that has not been
 * imported yet. At SPAWN time no second pass is needed — a chain's head is
 * admitted before its segments and a hole before its guardians — so
 * enemyRegistry calls this inline.
 *
 * `resolveOwner` exists because a pet's owner is a PLAYER, and a player who
 * acted on their very first tick may not have been imported yet. Passing
 * `ensurePlayerEntity` here imports them on demand; without it the pet would
 * carry `owner: NULL_ENTITY` forever, since nothing re-links after spawn.
 */
function linkEnemyReferences(world, enemy, resolveOwner) {
    const entity = world.lookup(enemy.id);
    if (entity === undefined)
        return;
    if (enemy.ownerId) {
        const owner = resolveOwner ? resolveOwner(enemy.ownerId) : world.lookup(enemy.ownerId);
        world.add(entity, C.PetOwner, {
            owner: owner ?? ecs_1.NULL_ENTITY,
            image: enemy.petImage ?? '',
        });
    }
    if (enemy.parentHoleId) {
        const hole = world.lookup(enemy.parentHoleId);
        if (hole !== undefined) {
            world.add(entity, C.HoleTether, {
                hole,
                returning: enemy.returningToHole ? 1 : 0,
            });
        }
    }
    if (enemy.headId || enemy.leaderId || enemy.segmentIndex !== undefined) {
        world.add(entity, C.CentipedeSegment, {
            leader: enemy.leaderId ? (world.lookup(enemy.leaderId) ?? ecs_1.NULL_ENTITY) : ecs_1.NULL_ENTITY,
            head: enemy.headId ? (world.lookup(enemy.headId) ?? entity) : entity,
            segmentIndex: enemy.segmentIndex ?? 0,
        });
    }
    if (enemy.challengeOwnerId) {
        // Resolved here rather than in importEnemy for the same reason as the
        // others: the buyer may not have an entity yet at construction time.
        world.add(entity, C.ChallengeMob, {
            owner: (resolveOwner
                ? resolveOwner(enemy.challengeOwnerId)
                : world.lookup(enemy.challengeOwnerId)) ?? ecs_1.NULL_ENTITY,
            starsReward: enemy.challengeStarsReward ?? 0,
        });
    }
    if (enemy.targetPlayerId) {
        const target = world.lookup(enemy.targetPlayerId);
        if (target !== undefined)
            world.set(entity, C.MobAI, 'targetPlayer', target);
    }
    if (enemy.targetEnemyId) {
        const target = world.lookup(enemy.targetEnemyId);
        if (target !== undefined)
            world.set(entity, C.MobAI, 'targetEnemy', target);
    }
    if (enemy.targetPetId) {
        const target = world.lookup(enemy.targetPetId);
        if (target !== undefined)
            world.set(entity, C.MobAI, 'targetPet', target);
    }
}
/**
 * Create an ECS entity mirroring `player`.
 *
 * `lobby` reproduces the guarantee the separate `lobbyPlayers` map gave: a
 * title-screen flower carries IsLobby, and every world query excludes it, so it
 * cannot be simulated, targeted, saved or broadcast by a system that did not
 * explicitly ask for lobby players.
 */
function importPlayer(world, player, now, lobby = false) {
    const entity = (0, prefabs_1.spawnPlayer)(world, {
        socketId: player.id,
        name: player.name,
        userId: undefined,
        x: player.x,
        y: player.y,
        health: player.health,
        maxHealth: player.maxHealth,
        damage: player.damage,
        radius: (constants_1.PLAYER_SIZE * (player.sizeMultiplier ?? 1)) / 2,
        inventory: player.inventory,
        loadout: player.loadout,
        lobby,
        // The `bot_` id prefix is the de facto tag across the whole server
        // (playerState's spawn-budget and streaming exclusions, the spawners,
        // squads, chat), so it stays authoritative and this MIRRORS it rather
        // than replacing it. Until it is set, every ECS-side bot query returns
        // empty — which is a silent wrong answer, not an error.
        bot: player.id.startsWith('bot_'),
        now,
    });
    world.write(entity, C.Velocity, { x: player.velocityX, y: player.velocityY });
    world.set(entity, C.Angle, 'value', player.angle);
    world.write(entity, C.PlayerInput, {
        seq: player.inputs?.seq ?? 0,
        lastProcessedSeq: player.lastProcessedInputSeq ?? 0,
        keys: player.inputs?.keys ?? [],
        useMouse: player.inputs?.useMouse ? 1 : 0,
        mouseDirectionX: player.inputs?.mouseDirectionX ?? 0,
        mouseDirectionY: player.inputs?.mouseDirectionY ?? 0,
        mouseSpeedMultiplier: player.inputs?.mouseSpeedMultiplier ?? 1,
        petalExtension: player.inputs?.petalExtension ?? 0,
    });
    world.write(entity, C.PlayerModifiers, {
        speedBoost: player.speed_boost || 1,
        speedFactor: player.speedFactor ?? 1,
        sizeMultiplier: player.sizeMultiplier ?? 1,
        magnetism: player.magnetism ?? 0,
        aggroRadiusBonus: player.aggroRadiusBonus ?? 0,
        petalOrbitPhase: player.petalOrbitPhase ?? 0,
    });
    world.add(entity, C.Progression, {
        level: player.level,
        xp: player.xp,
        xpToNextLevel: player.xpToNextLevel,
        score: player.score,
        tp: player.tp ?? 0,
        skills: player.skills ?? {},
    });
    if (player.effects)
        world.add(entity, C.PlayerEffects, { list: player.effects });
    if (player.isDead)
        world.add(entity, C.IsDead);
    if (player.inPvpArena)
        world.add(entity, C.InPvpArena);
    if (player.inMaze)
        world.add(entity, C.InMaze);
    if (player.glitched)
        world.add(entity, C.Glitched);
    if (player.corrupted)
        world.add(entity, C.Corrupted);
    if (player.poisonUntil !== undefined && player.poisonDamage !== undefined) {
        world.add(entity, C.Poisoned, {
            damagePerSecond: player.poisonDamage,
            until: player.poisonUntil,
            sourceType: player.poisonSource ? interning_1.mobTypes.intern(player.poisonSource.type) : 0,
            sourceTier: player.poisonSource ? (0, interning_1.rarityToId)(player.poisonSource.tier) : 0,
        });
    }
    return entity;
}
/**
 * Import a whole world snapshot: players first (so pets can resolve owners),
 * then enemies, then the reference-linking pass.
 */
function importWorld(world, players, enemies, now) {
    for (const player of players)
        importPlayer(world, player, now);
    for (const enemy of enemies)
        importEnemy(world, enemy, now);
    for (const enemy of enemies)
        linkEnemyReferences(world, enemy);
}
