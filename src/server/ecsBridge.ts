/**
 * Legacy <-> ECS entity bridge.
 *
 * Converts the game's existing `Enemy` and `ServerPlayer` objects into ECS
 * entities. This is what actually populates the world — until spawners write
 * through here, every system has nothing to iterate.
 *
 * The important work is not copying fields, it is choosing the ARCHETYPE:
 * a plain mob must NOT carry Wander/Wobble/PassiveMotion/HoleTether, because
 * the AI and drift systems route on exactly those components. Getting it wrong
 * fails silently — a bee without Wobble runs the stop-and-go machine and simply
 * stops looking like a bee.
 */

import { Enemy } from '../server_utils';
import { ServerPlayer } from '../player';
import { getEnemySizeScale, getMobStats, MobStats } from '../mobs';
import { ENEMY_SIZE, PLAYER_SIZE } from '../constants';

import { Entity, NULL_ENTITY, World } from '../ecs';
import * as C from '../ecs/components';
import { mobTypes, rarityToId } from '../ecs/interning';
import { spawnMob, spawnPlayer } from '../ecs/prefabs';

/** Mob types that use the bee cruise machine rather than the default one. */
const BEE_FLIGHT_TYPES = new Set(['bee']);

/** Mob AI type strings mapped to the component enum. */
function aiTypeOf(enemy: Enemy): C.AiType {
    switch (enemy.aiType) {
        case 'passive': return C.AiType.Passive;
        case 'hostile': return C.AiType.Hostile;
        case 'sandstorm': return C.AiType.Sandstorm;
        default: return C.AiType.Neutral;
    }
}

/** The collision radius formula, shared with the grid rebuild. */
export function radiusOf(enemy: Enemy, stats: MobStats | null): number {
    const base = stats ? (stats.size * 40) / 2 : ENEMY_SIZE / 2;
    return base * getEnemySizeScale(!!enemy.ownerId, enemy.tier);
}

/**
 * Create an ECS entity mirroring `enemy`.
 *
 * Optional behaviour components are added only for the mobs that use them, so
 * the common archetype stays narrow and the per-tick passes iterate the
 * smallest possible set.
 */
export function importEnemy(world: World, enemy: Enemy, now: number): Entity {
    const stats = enemy._mobStats ?? getMobStats(enemy.type, enemy.tier);

    const entity = spawnMob(world, {
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

    // Passive drift: only mobs that can actually move idle-drift.
    if (enemy.speed > 0) {
        world.add(entity, C.PassiveMotion, {
            state: enemy.passiveState === 'moving' ? C.PassiveState.Moving : C.PassiveState.Idle,
            stateStart: enemy.passiveStateStart ?? now,
        });
        world.add(entity, C.IsIdle);
        world.write(entity, C.Velocity, { x: enemy.velX ?? 0, y: enemy.velY ?? 0 });
    }

    // The bee cruise machine is selected by the Wobble component.
    if (BEE_FLIGHT_TYPES.has(enemy.type)) {
        world.add(entity, C.Wobble, { phase: enemy.wobblePhase ?? Math.random() * Math.PI * 2 });
    }

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

    if (enemy.reversed !== undefined) {
        world.add(entity, C.RenderFlip, { flipped: enemy.reversed ? 1 : 0 });
    }

    if (enemy.damageContributors) {
        world.add(entity, C.DamageContributors, { byPlayer: enemy.damageContributors });
    }

    if (enemy.despawnAt) {
        world.add(entity, C.Expires, { at: enemy.despawnAt });
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

    if (enemy.challengeOwnerId) {
        world.add(entity, C.ChallengeMob, {
            owner: NULL_ENTITY, // resolved by linkEnemyReferences
            starsReward: enemy.challengeStarsReward ?? 0,
        });
    }

    return entity;
}

/**
 * Resolve the id-based cross-references an enemy carries into entity handles.
 *
 * Must run as a SECOND pass, after every enemy has an entity: a centipede
 * segment can reference a leader that has not been imported yet, and a pet's
 * owner may be imported after it.
 */
export function linkEnemyReferences(world: World, enemy: Enemy): void {
    const entity = world.lookup(enemy.id);
    if (entity === undefined) return;

    if (enemy.ownerId) {
        const owner = world.lookup(enemy.ownerId);
        world.add(entity, C.PetOwner, {
            owner: owner ?? NULL_ENTITY,
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
            leader: enemy.leaderId ? (world.lookup(enemy.leaderId) ?? NULL_ENTITY) : NULL_ENTITY,
            head: enemy.headId ? (world.lookup(enemy.headId) ?? entity) : entity,
            segmentIndex: enemy.segmentIndex ?? 0,
        });
    }

    if (enemy.targetPlayerId) {
        const target = world.lookup(enemy.targetPlayerId);
        if (target !== undefined) world.set(entity, C.MobAI, 'targetPlayer', target);
    }
    if (enemy.targetEnemyId) {
        const target = world.lookup(enemy.targetEnemyId);
        if (target !== undefined) world.set(entity, C.MobAI, 'targetEnemy', target);
    }
    if (enemy.targetPetId) {
        const target = world.lookup(enemy.targetPetId);
        if (target !== undefined) world.set(entity, C.MobAI, 'targetPet', target);
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
export function importPlayer(world: World, player: ServerPlayer, now: number, lobby = false): Entity {
    const entity = spawnPlayer(world, {
        socketId: player.id,
        name: player.name,
        userId: undefined,
        x: player.x,
        y: player.y,
        health: player.health,
        maxHealth: player.maxHealth,
        damage: player.damage,
        radius: (PLAYER_SIZE * (player.sizeMultiplier ?? 1)) / 2,
        inventory: player.inventory,
        loadout: player.loadout,
        lobby,
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

    if (player.effects) world.add(entity, C.PlayerEffects, { list: player.effects });
    if (player.isDead) world.add(entity, C.IsDead);
    if (player.inPvpArena) world.add(entity, C.InPvpArena);
    if (player.inMaze) world.add(entity, C.InMaze);
    if (player.glitched) world.add(entity, C.Glitched);
    if (player.corrupted) world.add(entity, C.Corrupted);

    if (player.poisonUntil !== undefined && player.poisonDamage !== undefined) {
        world.add(entity, C.Poisoned, {
            damagePerSecond: player.poisonDamage,
            until: player.poisonUntil,
            sourceType: player.poisonSource ? mobTypes.intern(player.poisonSource.type) : 0,
            sourceTier: player.poisonSource ? rarityToId(player.poisonSource.tier) : 0,
        });
    }

    return entity;
}

/**
 * Import a whole world snapshot: players first (so pets can resolve owners),
 * then enemies, then the reference-linking pass.
 */
export function importWorld(
    world: World,
    players: ServerPlayer[],
    enemies: Enemy[],
    now: number,
): void {
    for (const player of players) importPlayer(world, player, now);
    for (const enemy of enemies) importEnemy(world, enemy, now);
    for (const enemy of enemies) linkEnemyReferences(world, enemy);
}
