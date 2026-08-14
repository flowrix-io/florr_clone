/**
 * Wild-mob and pet AI — the port of `stepWildMob`, `stepPet` and their helpers.
 *
 * ---------------------------------------------------------------------------
 * Why this is not column-iteration code
 * ---------------------------------------------------------------------------
 * The systems above (movement, passive drift, expiry) are tight loops over
 * packed arrays. This one is not, and pretending otherwise would be a lie about
 * the workload: every mob's decision depends on OTHER entities — nearest visible
 * player, cached target still valid, own centipede segments to steer around —
 * and each of those is a scattered read plus a raycast. The win here is not
 * vectorisation, it is DISPATCH: `stepEnemy`'s chain of per-mob branches
 * (`isCentipedeBodyType(type) && leaderId`, then `ownerId`, then `aiType`)
 * becomes archetype routing, so a mob only enters the code path its components
 * say it can take.
 *
 * The targeting scans keep the original's shape exactly, because it was tuned
 * against a real outage: raycasting every candidate was O(candidates) 21-sample
 * rays per mob per tick, and with several players stacking pet eggs the tick
 * blew its 33ms budget, starved the event loop and nginx answered 502. So:
 * collect in-range candidates by squared distance, sort nearest-first, and
 * raycast in that order stopping at the first visible one, capped at
 * TARGET_LOS_RAY_CAP rays.
 */

import * as C from '../components';
import { Entity, NULL_ENTITY } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';
import { ENEMY_SPEED_MULTIPLIER, MAX_WANDER_STEP, WANDER_REF_RADIUS } from './enemyPassive';

/** Default aggro/chase range when a mob has no explicit one. */
export const ENEMY_CHASE_RANGE = 500;

/** Base random-wander range, scaled per mob by its size factor. */
export const ENEMY_WANDER_RANGE = 200;

/**
 * gardn SUMMON_RETREAT_RADIUS: hole-spawned mobs defend a territory this large.
 * Dragged past it they drop their target and head home, so kiting ants away
 * disperses a swarm instead of accumulating permanent pursuers.
 */
export const SUMMON_RETREAT_RADIUS = 600;

/** Cap on line-of-sight rays cast per target acquisition. See the header note. */
const TARGET_LOS_RAY_CAP = 8;

/** Sandstorms re-pick a heading this often. */
const SANDSTORM_DIRECTION_CHANGE_INTERVAL = 300;
const SANDSTORM_SUCK_RANGE = 400;
const SANDSTORM_SUCK_FORCE = 1.5;

/** Centipede head self-avoidance. */
const AVOID_RADIUS = 140;
const AVOID_WEIGHT = 2.5;

/** Ring positions tried when teleporting a pet back to its owner. */
const PET_TELEPORT_DISTANCE = 80;
const PET_TELEPORT_ANGLES = [
    0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4,
    Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4,
];

export interface EnemyAIDeps {
    /** Raycast for a clear path. Injected so the ECS never imports the tile grid. */
    hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean;
    /** Push an entity out of any wall it overlaps. */
    resolveWall(x: number, y: number, halfSize: number): { x: number; y: number };
    /** True when this world position sits inside a blocking tile. */
    isBlocked(x: number, y: number): boolean;
    /**
     * Fire this mob's projectile volley at `aimAngle` if its cooldown elapsed.
     * Injected because it needs mob stats, petal stats and the projectile
     * allocator — none of which the ECS layer should depend on.
     */
    fireVolley(shooter: Entity, aimAngle: number, now: number): void;
    /** Whether this mob has a projectile at all, so the volley call can be skipped. */
    hasProjectile(shooter: Entity): boolean;
    /**
     * Mobs that chase at exactly the player's base speed rather than their
     * stat-derived step: a fleeing flower can never outrun them, but they cannot
     * gain on one running straight either — florr's pursuit feel.
     */
    isPlayerSpeedChaser(mobTypeId: number): boolean;
    /** MAX_SPEED / 30 — the player's base speed expressed per 30 TPS tick. */
    playerChaseStep: number;
    /** Rarity index at or above which a sandstorm sucks players in. */
    sandstormSuckTier: number;
    /**
     * A mob drops a player target that gets further away than this.
     * VIEWPORT_WIDTH * 5 in the original.
     */
    maxTargetDistance: number;
}

export interface EnemyAIQueries {
    wildMobs: Query;
    pets: Query;
    players: Query;
    /** All living wild mobs, as pet-attack candidates. */
    wildTargets: Query;
    centipedeSegments: Query;
}

export function createEnemyAIQueries(world: World): EnemyAIQueries {
    return {
        wildMobs: world.query(
            [C.Position, C.Angle, C.Speed, C.Radius, C.MobKind, C.MobAI, C.IsEnemy],
            [C.IsDead, C.PetOwner],
        ),
        pets: world.query(
            [C.Position, C.Angle, C.Speed, C.Radius, C.MobKind, C.MobAI, C.PetOwner, C.IsEnemy],
            [C.IsDead],
        ),
        players: world.query([C.Position, C.IsPlayer], [C.IsDead, C.IsLobby]),
        wildTargets: world.query([C.Position, C.Health, C.IsEnemy], [C.IsDead, C.PetOwner]),
        centipedeSegments: world.query([C.CentipedeSegment, C.Position], [C.IsDead]),
    };
}

/** A scored candidate for the nearest-visible scan. */
interface Candidate {
    entity: Entity;
    x: number;
    y: number;
    score: number;
}

function byScore(a: Candidate, b: Candidate): number {
    return a.score - b.score;
}

export function enemyAISystem(queries: EnemyAIQueries, deps: EnemyAIDeps) {
    const {
        hasLineOfSight, resolveWall, isBlocked,
        fireVolley, hasProjectile, isPlayerSpeedChaser, playerChaseStep, sandstormSuckTier,
        maxTargetDistance,
    } = deps;

    // Scratch reused across mobs and ticks so a full tick allocates nothing.
    const candidates: Candidate[] = [];
    const alivePlayers: Candidate[] = [];
    const wildMobs: Candidate[] = [];
    const petList: Candidate[] = [];
    /** head entity -> its body segments, for own-segment avoidance. */
    const segmentsByHead = new Map<number, Candidate[]>();

    /** Nearest candidate with line of sight, or undefined. */
    function pickNearestVisible(fromX: number, fromY: number): Candidate | undefined {
        candidates.sort(byScore);
        const rays = Math.min(candidates.length, TARGET_LOS_RAY_CAP);
        for (let i = 0; i < rays; i++) {
            const candidate = candidates[i];
            if (hasLineOfSight(fromX, fromY, candidate.x, candidate.y)) return candidate;
        }
        return undefined;
    }

    function sizeFactor(radius: number): number {
        return radius / WANDER_REF_RADIUS;
    }

    /** Per-tick step for a mob chasing or walking home. */
    function chaseStepOf(world: World, mob: Entity, mobTypeId: number): number {
        const speed = world.get(mob, C.Speed, 'current') as number;
        if (!isPlayerSpeedChaser(mobTypeId)) return speed * ENEMY_SPEED_MULTIPLIER;
        // Slows scale Speed.current, which covers every branch that derives its
        // step from that field. This branch does NOT, so without re-deriving the
        // ratio here a web/honey/pincer slow did nothing at all to exactly the
        // mobs it matters most against.
        const base = world.get(mob, C.Speed, 'base') as number;
        const scale = world.has(mob, C.Slowed) && base ? speed / base : 1;
        return playerChaseStep * scale;
    }

    /** Steering vector that keeps a centipede head off its own body. */
    function ownSegmentAvoidance(mob: Entity, x: number, y: number): { x: number; y: number } | null {
        const chain = segmentsByHead.get(mob);
        if (chain === undefined) return null;

        let ax = 0;
        let ay = 0;
        for (let i = 0; i < chain.length; i++) {
            const seg = chain[i];
            if (seg.entity === mob) continue;
            const sdx = x - seg.x;
            const sdy = y - seg.y;
            const sd = Math.sqrt(sdx * sdx + sdy * sdy);
            if (sd > 0 && sd < AVOID_RADIUS) {
                const strength = (AVOID_RADIUS - sd) / AVOID_RADIUS;
                ax += (sdx / sd) * strength * AVOID_WEIGHT;
                ay += (sdy / sd) * strength * AVOID_WEIGHT;
            }
        }
        return ax === 0 && ay === 0 ? null : { x: ax, y: ay };
    }

    /**
     * Move `mob` one step along (dx, dy), blending in own-segment avoidance and
     * (for bees) the pursuit weave. Facing follows the resulting direction.
     */
    function stepAlong(
        world: World, mob: Entity,
        dx: number, dy: number, distance: number, speed: number, now: number,
    ): void {
        const x = world.get(mob, C.Position, 'x') as number;
        const y = world.get(mob, C.Position, 'y') as number;

        let moveX = dx / distance;
        let moveY = dy / distance;

        const avoid = ownSegmentAvoidance(mob, x, y);
        if (avoid) {
            moveX += avoid.x;
            moveY += avoid.y;
            const mag = Math.sqrt(moveX * moveX + moveY * moveY);
            if (mag > 0) {
                moveX /= mag;
                moveY /= mag;
            }
        }

        // Provoked bees weave toward the target instead of beelining. The weave
        // is a perpendicular component ADDED to full-speed pursuit, not a
        // rotation of it: rotating cuts the closing rate by cos(sway) and a
        // flower fleeing straight at the same speed would slowly escape.
        if (world.has(mob, C.Wobble)) {
            const phase = world.get(mob, C.Wobble, 'phase') as number;
            const t = now / 1000 + phase;
            const latFrac = (100 * Math.cos(2 * t)) / (speed * 30);
            const perpX = -moveY;
            const perpY = moveX;
            moveX += perpX * latFrac;
            moveY += perpY * latFrac;
        }

        world.write(mob, C.Position, { x: x + moveX * speed, y: y + moveY * speed });
        if ((world.get(mob, C.Speed, 'current') as number) !== 0) {
            world.set(mob, C.Angle, 'value', Math.atan2(moveY * speed, moveX * speed));
        }
    }

    /** Re-pick a stale wander destination; returns the mob's size factor. */
    function pickWanderTargetIfStale(world: World, mob: Entity, now: number, radius: number): number {
        const factor = sizeFactor(radius);
        if (!world.has(mob, C.Wander)) {
            world.add(mob, C.Wander, { targetX: 0, targetY: 0, lastTime: 0 });
        }
        const lastTime = world.get(mob, C.Wander, 'lastTime') as number;
        if (lastTime === 0 || now - lastTime > 3000) {
            const range = ENEMY_WANDER_RANGE * factor;
            const x = world.get(mob, C.Position, 'x') as number;
            const y = world.get(mob, C.Position, 'y') as number;
            world.write(mob, C.Wander, {
                targetX: x + (Math.random() * 2 - 1) * range,
                targetY: y + (Math.random() * 2 - 1) * range,
                lastTime: now,
            });
        }
        return factor;
    }

    function wanderStepOf(speed: number, factor: number): number {
        return Math.min(speed * ENEMY_SPEED_MULTIPLIER * 0.5 * factor, MAX_WANDER_STEP);
    }

    /** Apply the wall pass to a mob after it has moved. */
    function applyWall(world: World, mob: Entity, radius: number): void {
        const x = world.get(mob, C.Position, 'x') as number;
        const y = world.get(mob, C.Position, 'y') as number;
        const resolved = resolveWall(x, y, radius);
        if (resolved.x !== x || resolved.y !== y) {
            // Zero the velocity component along whichever axis the wall pushed,
            // so the mob stops at the wall instead of grinding along it while
            // its facing points elsewhere.
            if (world.has(mob, C.Velocity)) {
                if (resolved.x !== x) world.set(mob, C.Velocity, 'x', 0);
                if (resolved.y !== y) world.set(mob, C.Velocity, 'y', 0);
            }
            world.write(mob, C.Position, { x: resolved.x, y: resolved.y });
        }
    }

    /** Mark a mob as idling (or not), maintaining the tag the passive systems gate on. */
    function setIdle(world: World, mob: Entity, idle: boolean): void {
        const has = world.has(mob, C.IsIdle);
        if (idle && !has) world.add(mob, C.IsIdle);
        else if (!idle && has) world.remove(mob, C.IsIdle);
    }

    // ------------------------------------------------------------------
    // Target acquisition
    // ------------------------------------------------------------------

    function acquirePlayerTarget(world: World, mob: Entity, x: number, y: number, aiType: number): Entity {
        const cached = world.get(mob, C.MobAI, 'targetPlayer') as Entity;
        if (cached !== NULL_ENTITY && world.isAlive(cached) && !world.has(cached, C.IsDead)) {
            const px = world.get(cached, C.Position, 'x') as number;
            const py = world.get(cached, C.Position, 'y') as number;
            const dx = px - x;
            const dy = py - y;
            // Keep the target while within 5x view distance AND visible; a wall
            // between them drops it.
            if (Math.sqrt(dx * dx + dy * dy) <= maxTargetDistance && hasLineOfSight(x, y, px, py)) {
                return cached;
            }
        }
        if (cached !== NULL_ENTITY) world.set(mob, C.MobAI, 'targetPlayer', NULL_ENTITY);

        // Neutral, sandstorm and passive mobs never actively scan — a neutral
        // only acquires a target by being provoked.
        if (aiType !== C.AiType.Hostile) return NULL_ENTITY;

        const range = (world.get(mob, C.MobAI, 'range') as number) || ENEMY_CHASE_RANGE;
        candidates.length = 0;
        for (let i = 0; i < alivePlayers.length; i++) {
            const player = alivePlayers[i];
            const dx = player.x - x;
            const dy = player.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            // Petals like Bulb raise a player's aggro radius: treated as being
            // that many pixels closer, so mobs detect them from further away.
            const effective = distance - player.score;
            if (effective < range) {
                candidates.push({ entity: player.entity, x: player.x, y: player.y, score: effective });
            }
        }
        const found = pickNearestVisible(x, y);
        const target = found ? found.entity : NULL_ENTITY;
        world.set(mob, C.MobAI, 'targetPlayer', target);
        return target;
    }

    function acquirePetTarget(world: World, mob: Entity, x: number, y: number, aiType: number, hasPlayerTarget: boolean): Entity {
        if (hasPlayerTarget) return NULL_ENTITY;
        // Only mobs that can actually chase consume a pet target, so passive,
        // sandstorm and unprovoked-neutral mobs skip the scan entirely.
        const provoked = aiType === C.AiType.Neutral
            && (world.get(mob, C.MobAI, 'targetPlayer') as Entity) !== NULL_ENTITY;
        if (aiType !== C.AiType.Hostile && !provoked) return NULL_ENTITY;

        const range = (world.get(mob, C.MobAI, 'range') as number) || ENEMY_CHASE_RANGE;
        const rangeSq = range * range;

        const cached = world.get(mob, C.MobAI, 'targetPet') as Entity;
        if (cached !== NULL_ENTITY && world.isAlive(cached)
            && world.has(cached, C.PetOwner) && !world.has(cached, C.IsDead)) {
            const px = world.get(cached, C.Position, 'x') as number;
            const py = world.get(cached, C.Position, 'y') as number;
            const dx = px - x;
            const dy = py - y;
            if (dx * dx + dy * dy < rangeSq && hasLineOfSight(x, y, px, py)) return cached;
        }
        world.set(mob, C.MobAI, 'targetPet', NULL_ENTITY);

        candidates.length = 0;
        for (let i = 0; i < petList.length; i++) {
            const pet = petList[i];
            if (pet.entity === mob) continue;
            const dx = pet.x - x;
            const dy = pet.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < rangeSq) candidates.push({ entity: pet.entity, x: pet.x, y: pet.y, score: d2 });
        }
        const found = pickNearestVisible(x, y);
        const target = found ? found.entity : NULL_ENTITY;
        world.set(mob, C.MobAI, 'targetPet', target);
        return target;
    }

    /** A pet's wild-mob target: revalidate the cached one, else rescan. */
    function acquirePetWildTarget(world: World, pet: Entity, x: number, y: number): Entity {
        const range = (world.get(pet, C.MobAI, 'range') as number) || ENEMY_CHASE_RANGE;
        const rangeSq = range * range;

        const cached = world.get(pet, C.MobAI, 'targetEnemy') as Entity;
        if (cached !== NULL_ENTITY && world.isAlive(cached)
            && !world.has(cached, C.PetOwner) && !world.has(cached, C.IsDead)
            && (world.get(cached, C.Health, 'current') as number) > 0) {
            const cx = world.get(cached, C.Position, 'x') as number;
            const cy = world.get(cached, C.Position, 'y') as number;
            const dx = cx - x;
            const dy = cy - y;
            if (dx * dx + dy * dy < rangeSq && hasLineOfSight(x, y, cx, cy)) return cached;
        }
        world.set(pet, C.MobAI, 'targetEnemy', NULL_ENTITY);

        candidates.length = 0;
        for (let i = 0; i < wildMobs.length; i++) {
            const wild = wildMobs[i];
            if (wild.entity === pet) continue;
            const dx = wild.x - x;
            const dy = wild.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < rangeSq) candidates.push({ entity: wild.entity, x: wild.x, y: wild.y, score: d2 });
        }
        const found = pickNearestVisible(x, y);
        const target = found ? found.entity : NULL_ENTITY;
        world.set(pet, C.MobAI, 'targetEnemy', target);
        return target;
    }

    // ------------------------------------------------------------------
    // Behaviours
    // ------------------------------------------------------------------

    /** Returns true if the mob spent this tick walking home. */
    function applyParentHoleTether(world: World, mob: Entity, x: number, y: number, radius: number, mobTypeId: number, now: number): boolean {
        if (!world.has(mob, C.HoleTether)) return false;

        const hole = world.get(mob, C.HoleTether, 'hole') as Entity;
        if (!world.isAlive(hole) || world.has(hole, C.IsDead)
            || (world.has(hole, C.Health) && (world.get(hole, C.Health, 'current') as number) <= 0)) {
            // Hole destroyed: unparent and roam free (gardn parity).
            world.remove(mob, C.HoleTether);
            return false;
        }

        const homeDx = (world.get(hole, C.Position, 'x') as number) - x;
        const homeDy = (world.get(hole, C.Position, 'y') as number) - y;
        const homeDist = Math.hypot(homeDx, homeDy) || 1;

        let returning = !!world.get(mob, C.HoleTether, 'returning');
        if (!returning && homeDist > SUMMON_RETREAT_RADIUS) {
            world.set(mob, C.MobAI, 'targetPlayer', NULL_ENTITY);
            world.set(mob, C.MobAI, 'isChasing', 0);
            world.set(mob, C.HoleTether, 'returning', 1);
            returning = true;
        }
        if (!returning) return false;

        if (homeDist < 100) {
            world.set(mob, C.HoleTether, 'returning', 0);
            if (world.has(mob, C.PassiveMotion)) {
                world.write(mob, C.PassiveMotion, { state: C.PassiveState.Idle, stateStart: now });
            }
            return false;
        }

        const returnSpeed = chaseStepOf(world, mob, mobTypeId);
        world.write(mob, C.Position, {
            x: x + (homeDx / homeDist) * returnSpeed,
            y: y + (homeDy / homeDist) * returnSpeed,
        });
        world.set(mob, C.Angle, 'value', Math.atan2(homeDy, homeDx));
        applyWall(world, mob, radius);
        return true;
    }

    function chaseAndShoot(world: World, mob: Entity, target: Entity, x: number, y: number, mobTypeId: number, now: number): void {
        world.set(mob, C.MobAI, 'isChasing', 1);

        // Offset to the target BEFORE moving: the volley deliberately aims along
        // this pre-move offset, which is long-standing behaviour.
        const dx = (world.get(target, C.Position, 'x') as number) - x;
        const dy = (world.get(target, C.Position, 'y') as number) - y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
            stepAlong(world, mob, dx, dy, distance, chaseStepOf(world, mob, mobTypeId), now);
        }
        if (hasProjectile(mob)) fireVolley(mob, Math.atan2(dy, dx), now);
    }

    function stepSandstorm(world: World, mob: Entity, x: number, y: number, radius: number, now: number): void {
        world.set(mob, C.MobAI, 'isChasing', 0);

        if (!world.has(mob, C.Wander)) {
            world.add(mob, C.Wander, { targetX: 0, targetY: 0, lastTime: 0 });
        }
        const lastTime = world.get(mob, C.Wander, 'lastTime') as number;
        if (lastTime === 0 || now - lastTime > SANDSTORM_DIRECTION_CHANGE_INTERVAL) {
            const randomAngle = Math.random() * Math.PI * 2;
            const wanderDistance = ENEMY_WANDER_RANGE * 2;
            world.write(mob, C.Wander, {
                targetX: x + Math.cos(randomAngle) * wanderDistance,
                targetY: y + Math.sin(randomAngle) * wanderDistance,
                lastTime: now,
            });
        }

        const speed = world.get(mob, C.Speed, 'current') as number;
        if (speed > 0) {
            const dx = (world.get(mob, C.Wander, 'targetX') as number) - x;
            const dy = (world.get(mob, C.Wander, 'targetY') as number) - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 5) {
                // Sandstorms move at full speed, not the 0.5x wander speed.
                const step = speed * ENEMY_SPEED_MULTIPLIER;
                world.write(mob, C.Position, {
                    x: x + (dx / distance) * step,
                    y: y + (dy / distance) * step,
                });
                world.set(mob, C.Angle, 'value', Math.atan2(dy, dx));
            }
        }

        // Super rarity and above drag nearby players in.
        if ((world.get(mob, C.MobKind, 'tier') as number) >= sandstormSuckTier) {
            const sx = world.get(mob, C.Position, 'x') as number;
            const sy = world.get(mob, C.Position, 'y') as number;
            for (let i = 0; i < alivePlayers.length; i++) {
                const player = alivePlayers[i];
                const dx = sx - player.x;
                const dy = sy - player.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < SANDSTORM_SUCK_RANGE && distance > 0) {
                    const pull = SANDSTORM_SUCK_FORCE * (1 - distance / SANDSTORM_SUCK_RANGE);
                    const px = player.x + (dx / distance) * pull;
                    const py = player.y + (dy / distance) * pull;
                    world.write(player.entity, C.Position, { x: px, y: py });
                    player.x = px;
                    player.y = py;
                }
            }
        }
        void radius;
    }

    /** Not chasing: drop a stale target, then wander or idle-drift. */
    function stepIdle(world: World, mob: Entity, x: number, y: number, radius: number, now: number): void {
        world.set(mob, C.MobAI, 'isChasing', 0);

        const cached = world.get(mob, C.MobAI, 'targetPlayer') as Entity;
        if (cached !== NULL_ENTITY) {
            if (!world.isAlive(cached) || world.has(cached, C.IsDead)) {
                world.set(mob, C.MobAI, 'targetPlayer', NULL_ENTITY);
            } else {
                const dx = (world.get(cached, C.Position, 'x') as number) - x;
                const dy = (world.get(cached, C.Position, 'y') as number) - y;
                if (Math.sqrt(dx * dx + dy * dy) > maxTargetDistance) {
                    world.set(mob, C.MobAI, 'targetPlayer', NULL_ENTITY);
                }
            }
        }

        // Centipede heads keep the target-based wander; it is intentionally NOT
        // the gardn passive machine.
        if (world.has(mob, C.CentipedeSegment)) {
            setIdle(world, mob, false);
            const factor = pickWanderTargetIfStale(world, mob, now, radius);
            const dx = (world.get(mob, C.Wander, 'targetX') as number) - x;
            const dy = (world.get(mob, C.Wander, 'targetY') as number) - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 5) {
                const speed = world.get(mob, C.Speed, 'current') as number;
                stepAlong(world, mob, dx, dy, distance, wanderStepOf(speed, factor), now);
            }
            return;
        }

        // Everything else drifts via the passive systems, which gate on IsIdle.
        setIdle(world, mob, (world.get(mob, C.Speed, 'current') as number) > 0);
    }

    // ------------------------------------------------------------------
    // The system
    // ------------------------------------------------------------------

    return (ctx: SystemContext): void => {
        const world = ctx.world;
        const now = ctx.now;

        // --- gather per-tick scratch -----------------------------------------
        alivePlayers.length = 0;
        queries.players.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                const entity = entities[i] as Entity;
                // `score` carries the aggro bonus here so the sort stays on one
                // numeric field; it is subtracted from distance, not compared raw.
                const bonus = world.has(entity, C.PlayerModifiers)
                    ? (world.get(entity, C.PlayerModifiers, 'aggroRadiusBonus') as number)
                    : 0;
                alivePlayers.push({ entity, x: pos.x[i], y: pos.y[i], score: bonus });
            }
        });

        wildMobs.length = 0;
        queries.wildTargets.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const health = chunk.cols(C.Health);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (health.current[i] <= 0) continue;
                wildMobs.push({ entity: entities[i] as Entity, x: pos.x[i], y: pos.y[i], score: 0 });
            }
        });

        petList.length = 0;
        queries.pets.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                petList.push({ entity: entities[i] as Entity, x: pos.x[i], y: pos.y[i], score: 0 });
            }
        });

        segmentsByHead.clear();
        queries.centipedeSegments.chunks(chunk => {
            const segment = chunk.cols(C.CentipedeSegment);
            const pos = chunk.cols(C.Position);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                const head = segment.head[i] as Entity;
                if (head === NULL_ENTITY) continue;
                // Direct followers are excluded: the chain-follow pass puts them
                // right behind the head, and avoiding them would paralyse it.
                if ((segment.leader[i] as Entity) === head) continue;
                let chain = segmentsByHead.get(head);
                if (chain === undefined) {
                    chain = [];
                    segmentsByHead.set(head, chain);
                }
                chain.push({ entity: entities[i] as Entity, x: pos.x[i], y: pos.y[i], score: 0 });
            }
        });

        // --- wild mobs --------------------------------------------------------
        // Collected first: the behaviours below add/remove components (IsIdle,
        // Wander), which is a structural change, and mutating while a query
        // iterates would swap unvisited rows into already-passed slots.
        const wildToStep = queries.wildMobs.collect();
        for (const mob of wildToStep) {
            if (!world.isAlive(mob)) continue;

            // Centipede body segments skip normal AI unless promoted to a head.
            if (world.has(mob, C.CentipedeSegment)
                && (world.get(mob, C.CentipedeSegment, 'leader') as Entity) !== NULL_ENTITY) {
                continue;
            }

            const x = world.get(mob, C.Position, 'x') as number;
            const y = world.get(mob, C.Position, 'y') as number;
            const radius = world.get(mob, C.Radius, 'value') as number;
            const mobTypeId = world.get(mob, C.MobKind, 'type') as number;
            const aiType = world.get(mob, C.MobAI, 'aiType') as number;

            if (applyParentHoleTether(world, mob, x, y, radius, mobTypeId, now)) {
                setIdle(world, mob, false);
                continue;
            }

            const targetPlayer = acquirePlayerTarget(world, mob, x, y, aiType);
            const targetPet = acquirePetTarget(world, mob, x, y, aiType, targetPlayer !== NULL_ENTITY);
            const target = targetPlayer !== NULL_ENTITY ? targetPlayer : targetPet;

            // Neutral mobs only chase once provoked, i.e. once damage has given
            // them a cached player target.
            const provoked = aiType === C.AiType.Neutral
                && (world.get(mob, C.MobAI, 'targetPlayer') as Entity) !== NULL_ENTITY;

            if (target !== NULL_ENTITY && (aiType === C.AiType.Hostile || provoked)) {
                setIdle(world, mob, false);
                chaseAndShoot(world, mob, target, x, y, mobTypeId, now);
            } else if (aiType === C.AiType.Sandstorm) {
                setIdle(world, mob, false);
                stepSandstorm(world, mob, x, y, radius, now);
            } else {
                stepIdle(world, mob, x, y, radius, now);
            }

            applyWall(world, mob, radius);
        }

        // --- pets -------------------------------------------------------------
        const petsToStep = queries.pets.collect();
        for (const pet of petsToStep) {
            if (!world.isAlive(pet)) continue;

            const owner = world.get(pet, C.PetOwner, 'owner') as Entity;
            const ownerAlive = world.isAlive(owner) && !world.has(owner, C.IsDead);
            const speed = world.get(pet, C.Speed, 'current') as number;
            const radius = world.get(pet, C.Radius, 'value') as number;

            let x = world.get(pet, C.Position, 'x') as number;
            let y = world.get(pet, C.Position, 'y') as number;
            let target = NULL_ENTITY;
            let targetResolved = false;

            if (ownerAlive) {
                const ox = world.get(owner, C.Position, 'x') as number;
                const oy = world.get(owner, C.Position, 'y') as number;

                if (hasLineOfSight(x, y, ox, oy)) {
                    // Follow directly — no distance limit while sight holds.
                    const dx = ox - x;
                    const dy = oy - y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance > 0 && speed > 0) {
                        const step = speed * ENEMY_SPEED_MULTIPLIER;
                        x += (dx / distance) * step;
                        y += (dy / distance) * step;
                        world.write(pet, C.Position, { x, y });
                        world.set(pet, C.Angle, 'value', Math.atan2(dy, dx));
                    }
                } else {
                    // No sight: pop to a clear, visible ring position, else onto
                    // the owner's own tile if that is clear.
                    let placed = false;
                    for (const angle of PET_TELEPORT_ANGLES) {
                        const tx = ox + Math.cos(angle) * PET_TELEPORT_DISTANCE;
                        const ty = oy + Math.sin(angle) * PET_TELEPORT_DISTANCE;
                        if (!isBlocked(tx, ty) && hasLineOfSight(tx, ty, ox, oy)) {
                            x = tx;
                            y = ty;
                            world.write(pet, C.Position, { x, y });
                            if (ox !== x || oy !== y) {
                                world.set(pet, C.Angle, 'value', Math.atan2(oy - y, ox - x));
                            }
                            placed = true;
                            break;
                        }
                    }
                    if (!placed && !isBlocked(ox, oy)) {
                        x = ox;
                        y = oy;
                        world.write(pet, C.Position, { x, y });
                    }
                }

                if (speed > 0) {
                    target = acquirePetWildTarget(world, pet, x, y);
                    targetResolved = true;

                    if (target !== NULL_ENTITY) {
                        const mobDx = (world.get(target, C.Position, 'x') as number) - x;
                        const mobDy = (world.get(target, C.Position, 'y') as number) - y;
                        const mobDistance = Math.sqrt(mobDx * mobDx + mobDy * mobDy);
                        if (mobDistance > 0) {
                            const step = speed * ENEMY_SPEED_MULTIPLIER;
                            x += (mobDx / mobDistance) * step;
                            y += (mobDy / mobDistance) * step;
                            world.write(pet, C.Position, { x, y });
                            world.set(pet, C.Angle, 'value', Math.atan2(mobDy, mobDx));
                            world.set(pet, C.MobAI, 'isChasing', 1);
                        }
                    } else {
                        world.set(pet, C.MobAI, 'isChasing', 0);
                    }
                }
            } else {
                // Owner dead or gone: wander, straight at the target, no avoidance.
                world.set(pet, C.MobAI, 'isChasing', 0);
                const factor = pickWanderTargetIfStale(world, pet, now, radius);
                if (speed > 0) {
                    const dx = (world.get(pet, C.Wander, 'targetX') as number) - x;
                    const dy = (world.get(pet, C.Wander, 'targetY') as number) - y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance > 5) {
                        const step = wanderStepOf(speed, factor);
                        x += (dx / distance) * step;
                        y += (dy / distance) * step;
                        world.write(pet, C.Position, { x, y });
                        world.set(pet, C.Angle, 'value', Math.atan2(dy, dx));
                    }
                }
            }

            if (hasProjectile(pet) && speed > 0) {
                // Only a wandering (ownerless) pet skipped the block above, so
                // acquire a target for it here.
                if (!targetResolved) target = acquirePetWildTarget(world, pet, x, y);
                if (target !== NULL_ENTITY) {
                    // A pet aims from where it ended up this tick.
                    const aim = Math.atan2(
                        (world.get(target, C.Position, 'y') as number) - y,
                        (world.get(target, C.Position, 'x') as number) - x,
                    );
                    fireVolley(pet, aim, now);
                }
            }

            applyWall(world, pet, radius);
        }
    };
}

export function registerEnemyAISystem(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: EnemyAIQueries,
    deps: EnemyAIDeps,
): void {
    // Runs in Input, before the passive drift in Simulation, so the IsIdle tag
    // it maintains is already correct when the drift systems read it.
    scheduler.add('enemyAI', Phase.Input, enemyAISystem(queries, deps));
}
