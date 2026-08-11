/**
 * The cutover: run mob simulation on the ECS while legacy code keeps the rest.
 *
 * ---------------------------------------------------------------------------
 * What owns what
 * ---------------------------------------------------------------------------
 * This is a strangler step, not a big bang, and the ownership split is the
 * whole design:
 *
 *   ECS owns   mob movement, AI, targeting, passive drift, centipede chains,
 *              mob-vs-mob collision, pet melee, and projectile flight,
 *              collision and damage.
 *   LEGACY owns spawning, despawning, viewport tracking, players, petals,
 *              damage attribution, drops, XP and the broadcast.
 *
 * Projectiles are worth calling out: they are ECS entities end to end, and
 * nothing about them is mirrored back into a legacy array. That is why there is
 * no projectile handling in this file at all — a projectile never needs syncing
 * because legacy never writes one.
 *
 * Lifecycle deliberately stays with legacy. The ECS despawn and reaper systems
 * are disabled here, because the viewport-status pass is not ported — with it
 * absent, `unseenDespawn` reaps every mob after 30 seconds (the tick harness hit
 * exactly that and silently measured an empty world). Legacy already does
 * lifecycle correctly, so it keeps doing it until the viewport pass moves over.
 *
 * ---------------------------------------------------------------------------
 * The sync contract
 * ---------------------------------------------------------------------------
 * Per tick: legacy state is pushed IN, the ECS simulates, results are pushed
 * OUT onto the same legacy objects that petals, collision and the broadcast
 * already read. Nothing downstream needs to know the simulation moved.
 *
 * Fields are split by writer to avoid the two sides fighting:
 *   pushed IN  — health, speed, knockback (legacy damage/effects write these)
 *   pushed OUT — x, y, angle, isChasing, velX/velY (the ECS decides motion)
 *
 * Pushing a field both ways would let one side's stale value overwrite the
 * other's fresh one, which is exactly how a dual-representation bug looks.
 */

import { Enemy } from '../server_utils';
import { ServerPlayer } from '../player';
import { Entity, World } from '../ecs';
import * as C from '../ecs/components';
import { EcsRuntime } from './ecsRuntime';
import { importEnemy, importPlayer, linkEnemyReferences } from './ecsBridge';

/** Systems legacy still owns, disabled so the two do not both act. */
const LEGACY_OWNED_SYSTEMS = [
    'playerMovement',    // legacy updatePlayerState still moves players
    'playerModifiers',   // derived from the legacy loadout for now
    'expiry',            // legacy timers
    'unseenDespawn',     // needs the unported viewport pass
    'reaper',            // legacy reapDeadEnemies awards XP and drops
    'poisonStacks',      // legacy updatePoisonEffects
    'playerPoison',      // legacy updatePlayerPoison
    'slowExpiry',        // legacy updateSlowEffects
];

/** Disable everything legacy still owns. Call once, after runtime creation. */
export function configureCutover(runtime: EcsRuntime): void {
    for (const name of LEGACY_OWNED_SYSTEMS) runtime.scheduler.setEnabled(name, false);
}

/** Entities the ECS created for legacy objects, so removals can be detected. */
const seenEnemyIds = new Set<string>();
const seenPlayerIds = new Set<string>();

/**
 * The entity for `player`, importing it if this is the first time it has been
 * seen.
 *
 * Exported because a player can act before syncToEcs has run for them: petal
 * firing happens in updatePlayerState, which runs BEFORE moveEnemies in the
 * simulation step, so on a player's very first tick their shots would otherwise
 * be stamped with a dead shooter and deal nothing. Going through here (rather
 * than importing directly) is also what keeps `seenPlayerIds` complete, so the
 * entity is still destroyed when the player leaves.
 */
export function ensurePlayerEntity(world: World, player: ServerPlayer, now: number): Entity {
    const existing = world.lookup(player.id);
    if (existing !== undefined) return existing;
    const entity = importPlayer(world, player, now);
    seenPlayerIds.add(player.id);
    return entity;
}

/**
 * Push legacy state into the ECS.
 *
 * New mobs are imported; departed ones are destroyed. Mutable fields that
 * LEGACY writes (health from petal damage, speed from slows, knockback from
 * impacts) are copied in each tick so the ECS simulates against current values.
 */
export function syncToEcs(
    world: World,
    enemies: Enemy[],
    players: Record<string, ServerPlayer>,
    now: number,
): void {
    // --- players ---------------------------------------------------------
    const livePlayerIds = new Set<string>();
    for (const id in players) {
        const player = players[id];
        if (!player) continue;
        livePlayerIds.add(id);

        const entity = world.lookup(id);
        if (entity === undefined) {
            ensurePlayerEntity(world, player, now);
            continue;
        }
        // Legacy moves players, so their transform is pushed IN, not out.
        world.write(entity, C.Position, { x: player.x, y: player.y });
        world.set(entity, C.Angle, 'value', player.angle);
        world.write(entity, C.Health, { current: player.health, max: player.maxHealth });
        // Mob aggro reads this; it is derived by legacy petal code for now.
        if (world.has(entity, C.PlayerModifiers)) {
            world.set(entity, C.PlayerModifiers, 'aggroRadiusBonus', player.aggroRadiusBonus ?? 0);
        }
        // A dead player must be invisible to targeting immediately.
        const isDead = !!player.isDead;
        if (isDead && !world.has(entity, C.IsDead)) world.add(entity, C.IsDead);
        else if (!isDead && world.has(entity, C.IsDead)) world.remove(entity, C.IsDead);
    }

    for (const id of seenPlayerIds) {
        if (livePlayerIds.has(id)) continue;
        const entity = world.lookup(id);
        if (entity !== undefined) world.destroy(entity);
        seenPlayerIds.delete(id);
    }

    // --- enemies ---------------------------------------------------------
    const liveEnemyIds = new Set<string>();
    const freshlyImported: Enemy[] = [];

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        liveEnemyIds.add(enemy.id);

        let entity = world.lookup(enemy.id);
        if (entity === undefined) {
            entity = importEnemy(world, enemy, now);
            seenEnemyIds.add(enemy.id);
            // Cross-references are resolved after every mob exists this tick.
            freshlyImported.push(enemy);
            continue;
        }

        // Fields LEGACY writes.
        world.write(entity, C.Health, { current: enemy.health, max: enemy.maxHealth });
        world.write(entity, C.Speed, {
            current: enemy.speed,
            base: enemy.baseSpeed ?? enemy.speed,
        });

        // A slow applied by legacy shows up as speed below base.
        const slowed = enemy.slowUntil !== undefined && enemy.slowUntil > now;
        if (slowed && !world.has(entity, C.Slowed)) {
            world.add(entity, C.Slowed, { until: enemy.slowUntil! });
        } else if (!slowed && world.has(entity, C.Slowed)) {
            world.remove(entity, C.Slowed);
        }

        if (enemy.knockbackX || enemy.knockbackY) {
            if (!world.has(entity, C.Knockback)) {
                world.add(entity, C.Knockback, { x: 0, y: 0 });
            }
            world.write(entity, C.Knockback, {
                x: enemy.knockbackX ?? 0,
                y: enemy.knockbackY ?? 0,
            });
        }

        // Legacy marks kills; the ECS must stop simulating them at once.
        const isDead = !!(enemy as { isDead?: boolean }).isDead || enemy.health <= 0;
        if (isDead && !world.has(entity, C.IsDead)) world.add(entity, C.IsDead);

        // Provocation: legacy damage handlers set targetPlayerId directly, and
        // that is how a neutral mob becomes hostile.
        if (enemy.targetPlayerId) {
            const target = world.lookup(enemy.targetPlayerId);
            if (target !== undefined) world.set(entity, C.MobAI, 'targetPlayer', target);
        }
    }

    for (const enemy of freshlyImported) linkEnemyReferences(world, enemy);

    for (const id of seenEnemyIds) {
        if (liveEnemyIds.has(id)) continue;
        const entity = world.lookup(id);
        if (entity !== undefined) world.destroy(entity);
        seenEnemyIds.delete(id);
    }
}

/**
 * Push ECS results back onto the legacy objects.
 *
 * Only the fields the ECS decided: transform, motion and chase state. Health is
 * NOT written back here — legacy owns damage bookkeeping, and clobbering it
 * would drop damage applied later in the same tick. The one exception is pet
 * melee, which the ECS now performs, so its damage is merged rather than
 * overwritten.
 */
export function syncFromEcs(world: World, enemies: Enemy[]): void {
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const entity: Entity | undefined = world.lookup(enemy.id);
        if (entity === undefined) continue;

        enemy.x = world.get(entity, C.Position, 'x') as number;
        enemy.y = world.get(entity, C.Position, 'y') as number;
        enemy.angle = world.get(entity, C.Angle, 'value') as number;

        if (world.has(entity, C.Velocity)) {
            enemy.velX = world.get(entity, C.Velocity, 'x') as number;
            enemy.velY = world.get(entity, C.Velocity, 'y') as number;
        }
        if (world.has(entity, C.MobAI)) {
            enemy.isChasing = !!world.get(entity, C.MobAI, 'isChasing');
        }
        if (world.has(entity, C.Knockback)) {
            enemy.knockbackX = world.get(entity, C.Knockback, 'x') as number;
            enemy.knockbackY = world.get(entity, C.Knockback, 'y') as number;
        }

        // Pet melee is simulated by the ECS, so damage it dealt has to come
        // back. Taking the MINIMUM merges it with any legacy damage applied
        // this tick instead of overwriting one with the other.
        const ecsHealth = world.get(entity, C.Health, 'current') as number;
        if (ecsHealth < enemy.health) enemy.health = ecsHealth;

        if (world.has(entity, C.IsDead) && enemy.health > 0) {
            // The ECS killed it (pet melee); let legacy's reaper award the drop.
            enemy.health = 0;
        }

        // Targeting must round-trip. Legacy code still reads targetPlayerId —
        // trackDamage gates provocation on it (`!enemy.targetPlayerId`), a
        // splitting centipede copies it to its children, and item drops use it
        // for eligibility. Writing only INTO the ECS left those readers looking
        // at a field the simulation no longer maintained, so a mob the ECS had
        // acquired or dropped looked un-aggroed to every legacy consumer.
        if (world.has(entity, C.MobAI)) {
            const target = world.get(entity, C.MobAI, 'targetPlayer') as Entity;
            if (world.isAlive(target)) {
                enemy.targetPlayerId = world.externalIdOf(target);
            } else if (enemy.targetPlayerId !== undefined) {
                // Only clear once the ECS has genuinely dropped it, so a
                // provocation applied by legacy later this tick survives.
                enemy.targetPlayerId = undefined;
            }
            const targetEnemy = world.get(entity, C.MobAI, 'targetEnemy') as Entity;
            enemy.targetEnemyId = world.isAlive(targetEnemy)
                ? world.externalIdOf(targetEnemy) : undefined;
            const targetPet = world.get(entity, C.MobAI, 'targetPet') as Entity;
            enemy.targetPetId = world.isAlive(targetPet)
                ? world.externalIdOf(targetPet) : undefined;
        }

        // Centipede chain links can be re-headed by the repair pass.
        if (world.has(entity, C.CentipedeSegment)) {
            const leader = world.get(entity, C.CentipedeSegment, 'leader') as Entity;
            const head = world.get(entity, C.CentipedeSegment, 'head') as Entity;
            enemy.leaderId = world.isAlive(leader) ? world.externalIdOf(leader) : undefined;
            enemy.headId = world.isAlive(head) ? world.externalIdOf(head) : undefined;
            enemy.segmentIndex = world.get(entity, C.CentipedeSegment, 'segmentIndex') as number;
        }
    }
}

/** Reset cross-tick tracking. For tests and for a clean world rebuild. */
export function resetSyncState(): void {
    seenEnemyIds.clear();
    seenPlayerIds.clear();
}
