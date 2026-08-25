"use strict";
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
exports.SUMMON_RETREAT_RADIUS = exports.ENEMY_WANDER_RANGE = exports.ENEMY_CHASE_RANGE = void 0;
exports.createEnemyAIQueries = createEnemyAIQueries;
exports.enemyAISystem = enemyAISystem;
exports.registerEnemyAISystem = registerEnemyAISystem;
const C = __importStar(require("../components"));
const entity_1 = require("../entity");
const system_1 = require("../system");
const enemyPassive_1 = require("./enemyPassive");
/** Default aggro/chase range when a mob has no explicit one. */
exports.ENEMY_CHASE_RANGE = 500;
/** Base random-wander range, scaled per mob by its size factor. */
exports.ENEMY_WANDER_RANGE = 200;
/**
 * gardn SUMMON_RETREAT_RADIUS: hole-spawned mobs defend a territory this large.
 * Dragged past it they drop their target and head home, so kiting ants away
 * disperses a swarm instead of accumulating permanent pursuers.
 */
exports.SUMMON_RETREAT_RADIUS = 600;
/** Cap on line-of-sight rays cast per target acquisition. See the header note. */
const TARGET_LOS_RAY_CAP = 8;
/** Sandstorms re-pick a heading this often. */
const SANDSTORM_DIRECTION_CHANGE_INTERVAL = 300;
const SANDSTORM_SUCK_RANGE = 400;
const SANDSTORM_SUCK_FORCE = 1.5;
/** Centipede head self-avoidance. */
const AVOID_RADIUS = 140;
const AVOID_WEIGHT = 2.5;
/** Sandstorm pets shadow the owner's heading this much faster than the owner. */
const SANDSTORM_PET_SPEED_FACTOR = 1.2;
/** Ring positions tried when teleporting a pet back to its owner. */
const PET_TELEPORT_DISTANCE = 80;
const PET_TELEPORT_ANGLES = [
    0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4,
    Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4,
];
function createEnemyAIQueries(world) {
    return {
        wildMobs: world.query([C.Position, C.Angle, C.Speed, C.Radius, C.MobKind, C.MobAI, C.IsEnemy], [C.IsDead, C.PetOwner]),
        pets: world.query([C.Position, C.Angle, C.Speed, C.Radius, C.MobKind, C.MobAI, C.PetOwner, C.IsEnemy], [C.IsDead]),
        players: world.query([C.Position, C.IsPlayer], [C.IsDead, C.IsLobby]),
        wildTargets: world.query([C.Position, C.Health, C.IsEnemy], [C.IsDead, C.PetOwner]),
        centipedeSegments: world.query([C.CentipedeSegment, C.Position], [C.IsDead]),
    };
}
function byScore(a, b) {
    return a.score - b.score;
}
function enemyAISystem(queries, deps) {
    const { hasLineOfSight, resolveWall, isBlocked, fireVolley, hasProjectile, isPlayerSpeedChaser, playerChaseStep, sandstormSuckTier, maxTargetDistance, activity, viewHalfWidth, viewHalfHeight, onPetOutOfView, } = deps;
    // Scratch reused across mobs and ticks so a full tick allocates nothing.
    const candidates = [];
    const alivePlayers = [];
    const wildMobs = [];
    const petList = [];
    /** head entity -> its body segments, for own-segment avoidance. */
    const segmentsByHead = new Map();
    /** Nearest candidate with line of sight, or undefined. */
    function pickNearestVisible(fromX, fromY) {
        candidates.sort(byScore);
        const rays = Math.min(candidates.length, TARGET_LOS_RAY_CAP);
        for (let i = 0; i < rays; i++) {
            const candidate = candidates[i];
            if (hasLineOfSight(fromX, fromY, candidate.x, candidate.y))
                return candidate;
        }
        return undefined;
    }
    function sizeFactor(radius) {
        return radius / enemyPassive_1.WANDER_REF_RADIUS;
    }
    /** Per-tick step for a mob chasing or walking home. */
    function chaseStepOf(world, mob, mobTypeId) {
        const speed = world.get(mob, C.Speed, 'current');
        if (!isPlayerSpeedChaser(mobTypeId))
            return speed * enemyPassive_1.ENEMY_SPEED_MULTIPLIER;
        // Slows scale Speed.current, which covers every branch that derives its
        // step from that field. This branch does NOT, so without re-deriving the
        // ratio here a web/honey/pincer slow did nothing at all to exactly the
        // mobs it matters most against.
        const base = world.get(mob, C.Speed, 'base');
        const scale = world.has(mob, C.Slowed) && base ? speed / base : 1;
        return playerChaseStep * scale;
    }
    /** Steering vector that keeps a centipede head off its own body. */
    function ownSegmentAvoidance(mob, x, y) {
        const chain = segmentsByHead.get(mob);
        if (chain === undefined)
            return null;
        let ax = 0;
        let ay = 0;
        for (let i = 0; i < chain.length; i++) {
            const seg = chain[i];
            if (seg.entity === mob)
                continue;
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
    function stepAlong(world, mob, dx, dy, distance, speed, now) {
        const x = world.get(mob, C.Position, 'x');
        const y = world.get(mob, C.Position, 'y');
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
            const phase = world.get(mob, C.Wobble, 'phase');
            const t = now / 1000 + phase;
            const latFrac = (100 * Math.cos(2 * t)) / (speed * 30);
            const perpX = -moveY;
            const perpY = moveX;
            moveX += perpX * latFrac;
            moveY += perpY * latFrac;
        }
        world.write(mob, C.Position, { x: x + moveX * speed, y: y + moveY * speed });
        if (world.get(mob, C.Speed, 'current') !== 0) {
            world.set(mob, C.Angle, 'value', Math.atan2(moveY * speed, moveX * speed));
        }
    }
    /** Re-pick a stale wander destination; returns the mob's size factor. */
    function pickWanderTargetIfStale(world, mob, now, radius) {
        const factor = sizeFactor(radius);
        if (!world.has(mob, C.Wander)) {
            world.add(mob, C.Wander, { targetX: 0, targetY: 0, lastTime: 0 });
        }
        const lastTime = world.get(mob, C.Wander, 'lastTime');
        if (lastTime === 0 || now - lastTime > 3000) {
            const range = exports.ENEMY_WANDER_RANGE * factor;
            const x = world.get(mob, C.Position, 'x');
            const y = world.get(mob, C.Position, 'y');
            world.write(mob, C.Wander, {
                targetX: x + (Math.random() * 2 - 1) * range,
                targetY: y + (Math.random() * 2 - 1) * range,
                lastTime: now,
            });
        }
        return factor;
    }
    function wanderStepOf(speed, factor) {
        return Math.min(speed * enemyPassive_1.ENEMY_SPEED_MULTIPLIER * 0.5 * factor, enemyPassive_1.MAX_WANDER_STEP);
    }
    /** Apply the wall pass to a mob after it has moved. */
    function applyWall(world, mob, radius) {
        const x = world.get(mob, C.Position, 'x');
        const y = world.get(mob, C.Position, 'y');
        const resolved = resolveWall(x, y, radius);
        if (resolved.x !== x || resolved.y !== y) {
            // Zero the velocity component along whichever axis the wall pushed,
            // so the mob stops at the wall instead of grinding along it while
            // its facing points elsewhere.
            if (world.has(mob, C.Velocity)) {
                if (resolved.x !== x)
                    world.set(mob, C.Velocity, 'x', 0);
                if (resolved.y !== y)
                    world.set(mob, C.Velocity, 'y', 0);
            }
            world.write(mob, C.Position, { x: resolved.x, y: resolved.y });
        }
    }
    /** Mark a mob as idling (or not), maintaining the tag the passive systems gate on. */
    function setIdle(world, mob, idle) {
        const has = world.has(mob, C.IsIdle);
        if (idle && !has)
            world.add(mob, C.IsIdle);
        else if (!idle && has)
            world.remove(mob, C.IsIdle);
    }
    // ------------------------------------------------------------------
    // Target acquisition
    // ------------------------------------------------------------------
    function acquirePlayerTarget(world, mob, x, y, aiType) {
        const cached = world.get(mob, C.MobAI, 'targetPlayer');
        if (cached !== entity_1.NULL_ENTITY && world.isAlive(cached) && !world.has(cached, C.IsDead)) {
            const px = world.get(cached, C.Position, 'x');
            const py = world.get(cached, C.Position, 'y');
            const dx = px - x;
            const dy = py - y;
            // Keep the target while within 5x view distance AND visible; a wall
            // between them drops it.
            if (Math.sqrt(dx * dx + dy * dy) <= maxTargetDistance && hasLineOfSight(x, y, px, py)) {
                return cached;
            }
        }
        if (cached !== entity_1.NULL_ENTITY)
            world.set(mob, C.MobAI, 'targetPlayer', entity_1.NULL_ENTITY);
        // Neutral, sandstorm and passive mobs never actively scan — a neutral
        // only acquires a target by being provoked.
        if (aiType !== 2 /* C.AiType.Hostile */)
            return entity_1.NULL_ENTITY;
        const range = world.get(mob, C.MobAI, 'range') || exports.ENEMY_CHASE_RANGE;
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
        const target = found ? found.entity : entity_1.NULL_ENTITY;
        world.set(mob, C.MobAI, 'targetPlayer', target);
        return target;
    }
    function acquirePetTarget(world, mob, x, y, aiType, hasPlayerTarget) {
        if (hasPlayerTarget)
            return entity_1.NULL_ENTITY;
        // Only mobs that can actually chase consume a pet target, so passive,
        // sandstorm and unprovoked-neutral mobs skip the scan entirely.
        const provoked = aiType === 1 /* C.AiType.Neutral */
            && world.get(mob, C.MobAI, 'targetPlayer') !== entity_1.NULL_ENTITY;
        if (aiType !== 2 /* C.AiType.Hostile */ && !provoked)
            return entity_1.NULL_ENTITY;
        const range = world.get(mob, C.MobAI, 'range') || exports.ENEMY_CHASE_RANGE;
        const rangeSq = range * range;
        const cached = world.get(mob, C.MobAI, 'targetPet');
        if (cached !== entity_1.NULL_ENTITY && world.isAlive(cached)
            && world.has(cached, C.PetOwner) && !world.has(cached, C.IsDead)) {
            const px = world.get(cached, C.Position, 'x');
            const py = world.get(cached, C.Position, 'y');
            const dx = px - x;
            const dy = py - y;
            if (dx * dx + dy * dy < rangeSq && hasLineOfSight(x, y, px, py))
                return cached;
        }
        world.set(mob, C.MobAI, 'targetPet', entity_1.NULL_ENTITY);
        candidates.length = 0;
        for (let i = 0; i < petList.length; i++) {
            const pet = petList[i];
            if (pet.entity === mob)
                continue;
            const dx = pet.x - x;
            const dy = pet.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < rangeSq)
                candidates.push({ entity: pet.entity, x: pet.x, y: pet.y, score: d2 });
        }
        const found = pickNearestVisible(x, y);
        const target = found ? found.entity : entity_1.NULL_ENTITY;
        world.set(mob, C.MobAI, 'targetPet', target);
        return target;
    }
    /**
     * A pet's wild-mob target: revalidate the cached one, else rescan.
     *
     * With a living owner the pet sees exactly what the owner's screen shows —
     * candidates are the wild mobs inside the owner's viewport rectangle,
     * scored nearest-to-the-PET first. Ownerless pets have no screen to be
     * clipped to and fall back to their own aggro range.
     */
    function acquirePetWildTarget(world, pet, x, y, hasOwner, ox, oy) {
        const range = world.get(pet, C.MobAI, 'range') || exports.ENEMY_CHASE_RANGE;
        const rangeSq = range * range;
        const canSee = (cx, cy, d2) => hasOwner
            ? Math.abs(cx - ox) <= viewHalfWidth && Math.abs(cy - oy) <= viewHalfHeight
            : d2 < rangeSq;
        const cached = world.get(pet, C.MobAI, 'targetEnemy');
        if (cached !== entity_1.NULL_ENTITY && world.isAlive(cached)
            && !world.has(cached, C.PetOwner) && !world.has(cached, C.IsDead)
            && world.get(cached, C.Health, 'current') > 0) {
            const cx = world.get(cached, C.Position, 'x');
            const cy = world.get(cached, C.Position, 'y');
            const dx = cx - x;
            const dy = cy - y;
            if (canSee(cx, cy, dx * dx + dy * dy) && hasLineOfSight(x, y, cx, cy))
                return cached;
        }
        world.set(pet, C.MobAI, 'targetEnemy', entity_1.NULL_ENTITY);
        candidates.length = 0;
        for (let i = 0; i < wildMobs.length; i++) {
            const wild = wildMobs[i];
            if (wild.entity === pet)
                continue;
            const dx = wild.x - x;
            const dy = wild.y - y;
            const d2 = dx * dx + dy * dy;
            if (canSee(wild.x, wild.y, d2))
                candidates.push({ entity: wild.entity, x: wild.x, y: wild.y, score: d2 });
        }
        const found = pickNearestVisible(x, y);
        const target = found ? found.entity : entity_1.NULL_ENTITY;
        world.set(pet, C.MobAI, 'targetEnemy', target);
        return target;
    }
    /**
     * Pop a pet to a clear, visible ring position around its owner, else onto
     * the owner's own tile if that is clear. Returns the new position, or null
     * when nothing was clear and the pet stayed put.
     */
    function teleportPetToOwner(world, pet, ox, oy) {
        for (const angle of PET_TELEPORT_ANGLES) {
            const tx = ox + Math.cos(angle) * PET_TELEPORT_DISTANCE;
            const ty = oy + Math.sin(angle) * PET_TELEPORT_DISTANCE;
            if (!isBlocked(tx, ty) && hasLineOfSight(tx, ty, ox, oy)) {
                world.write(pet, C.Position, { x: tx, y: ty });
                if (ox !== tx || oy !== ty) {
                    world.set(pet, C.Angle, 'value', Math.atan2(oy - ty, ox - tx));
                }
                return { x: tx, y: ty };
            }
        }
        if (!isBlocked(ox, oy)) {
            world.write(pet, C.Position, { x: ox, y: oy });
            return { x: ox, y: oy };
        }
        return null;
    }
    // ------------------------------------------------------------------
    // Behaviours
    // ------------------------------------------------------------------
    /** Returns true if the mob spent this tick walking home. */
    function applyParentHoleTether(world, mob, x, y, radius, mobTypeId, now) {
        if (!world.has(mob, C.HoleTether))
            return false;
        const hole = world.get(mob, C.HoleTether, 'hole');
        if (!world.isAlive(hole) || world.has(hole, C.IsDead)
            || (world.has(hole, C.Health) && world.get(hole, C.Health, 'current') <= 0)) {
            // Hole destroyed: unparent and roam free (gardn parity).
            world.remove(mob, C.HoleTether);
            return false;
        }
        const homeDx = world.get(hole, C.Position, 'x') - x;
        const homeDy = world.get(hole, C.Position, 'y') - y;
        const homeDist = Math.hypot(homeDx, homeDy) || 1;
        let returning = !!world.get(mob, C.HoleTether, 'returning');
        if (!returning && homeDist > exports.SUMMON_RETREAT_RADIUS) {
            world.set(mob, C.MobAI, 'targetPlayer', entity_1.NULL_ENTITY);
            world.set(mob, C.MobAI, 'isChasing', 0);
            world.set(mob, C.HoleTether, 'returning', 1);
            returning = true;
        }
        if (!returning)
            return false;
        if (homeDist < 100) {
            world.set(mob, C.HoleTether, 'returning', 0);
            if (world.has(mob, C.PassiveMotion)) {
                world.write(mob, C.PassiveMotion, { state: 0 /* C.PassiveState.Idle */, stateStart: now });
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
    function chaseAndShoot(world, mob, target, x, y, mobTypeId, now) {
        world.set(mob, C.MobAI, 'isChasing', 1);
        // Offset to the target BEFORE moving: the volley deliberately aims along
        // this pre-move offset, which is long-standing behaviour.
        const dx = world.get(target, C.Position, 'x') - x;
        const dy = world.get(target, C.Position, 'y') - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 0) {
            stepAlong(world, mob, dx, dy, distance, chaseStepOf(world, mob, mobTypeId), now);
        }
        if (hasProjectile(mob))
            fireVolley(mob, Math.atan2(dy, dx), now);
    }
    function stepSandstorm(world, mob, x, y, radius, now) {
        world.set(mob, C.MobAI, 'isChasing', 0);
        if (!world.has(mob, C.Wander)) {
            world.add(mob, C.Wander, { targetX: 0, targetY: 0, lastTime: 0 });
        }
        const lastTime = world.get(mob, C.Wander, 'lastTime');
        if (lastTime === 0 || now - lastTime > SANDSTORM_DIRECTION_CHANGE_INTERVAL) {
            const randomAngle = Math.random() * Math.PI * 2;
            const wanderDistance = exports.ENEMY_WANDER_RANGE * 2;
            world.write(mob, C.Wander, {
                targetX: x + Math.cos(randomAngle) * wanderDistance,
                targetY: y + Math.sin(randomAngle) * wanderDistance,
                lastTime: now,
            });
        }
        const speed = world.get(mob, C.Speed, 'current');
        if (speed > 0) {
            const dx = world.get(mob, C.Wander, 'targetX') - x;
            const dy = world.get(mob, C.Wander, 'targetY') - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 5) {
                // Sandstorms move at full speed, not the 0.5x wander speed.
                const step = speed * enemyPassive_1.ENEMY_SPEED_MULTIPLIER;
                world.write(mob, C.Position, {
                    x: x + (dx / distance) * step,
                    y: y + (dy / distance) * step,
                });
                world.set(mob, C.Angle, 'value', Math.atan2(dy, dx));
            }
        }
        // Super rarity and above drag nearby players in.
        if (world.get(mob, C.MobKind, 'tier') >= sandstormSuckTier) {
            const sx = world.get(mob, C.Position, 'x');
            const sy = world.get(mob, C.Position, 'y');
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
    function stepIdle(world, mob, x, y, radius, now) {
        world.set(mob, C.MobAI, 'isChasing', 0);
        const cached = world.get(mob, C.MobAI, 'targetPlayer');
        if (cached !== entity_1.NULL_ENTITY) {
            if (!world.isAlive(cached) || world.has(cached, C.IsDead)) {
                world.set(mob, C.MobAI, 'targetPlayer', entity_1.NULL_ENTITY);
            }
            else {
                const dx = world.get(cached, C.Position, 'x') - x;
                const dy = world.get(cached, C.Position, 'y') - y;
                if (Math.sqrt(dx * dx + dy * dy) > maxTargetDistance) {
                    world.set(mob, C.MobAI, 'targetPlayer', entity_1.NULL_ENTITY);
                }
            }
        }
        // Centipede heads keep the target-based wander; it is intentionally NOT
        // the gardn passive machine.
        if (world.has(mob, C.CentipedeSegment)) {
            setIdle(world, mob, false);
            const factor = pickWanderTargetIfStale(world, mob, now, radius);
            const dx = world.get(mob, C.Wander, 'targetX') - x;
            const dy = world.get(mob, C.Wander, 'targetY') - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 5) {
                const speed = world.get(mob, C.Speed, 'current');
                stepAlong(world, mob, dx, dy, distance, wanderStepOf(speed, factor), now);
            }
            return;
        }
        // Everything else drifts via the passive systems, which gate on IsIdle.
        setIdle(world, mob, world.get(mob, C.Speed, 'current') > 0);
    }
    // ------------------------------------------------------------------
    // The system
    // ------------------------------------------------------------------
    return (ctx) => {
        const world = ctx.world;
        const now = ctx.now;
        // --- gather per-tick scratch -----------------------------------------
        alivePlayers.length = 0;
        queries.players.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                const entity = entities[i];
                // `score` carries the aggro bonus here so the sort stays on one
                // numeric field; it is subtracted from distance, not compared raw.
                const bonus = world.has(entity, C.PlayerModifiers)
                    ? world.get(entity, C.PlayerModifiers, 'aggroRadiusBonus')
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
                if (health.current[i] <= 0)
                    continue;
                wildMobs.push({ entity: entities[i], x: pos.x[i], y: pos.y[i], score: 0 });
            }
        });
        petList.length = 0;
        queries.pets.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                petList.push({ entity: entities[i], x: pos.x[i], y: pos.y[i], score: 0 });
            }
        });
        segmentsByHead.clear();
        queries.centipedeSegments.chunks(chunk => {
            const segment = chunk.cols(C.CentipedeSegment);
            const pos = chunk.cols(C.Position);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                const head = segment.head[i];
                if (head === entity_1.NULL_ENTITY)
                    continue;
                // Direct followers are excluded: the chain-follow pass puts them
                // right behind the head, and avoiding them would paralyse it.
                if (segment.leader[i] === head)
                    continue;
                let chain = segmentsByHead.get(head);
                if (chain === undefined) {
                    chain = [];
                    segmentsByHead.set(head, chain);
                }
                chain.push({ entity: entities[i], x: pos.x[i], y: pos.y[i], score: 0 });
            }
        });
        // --- wild mobs --------------------------------------------------------
        // Collected first: the behaviours below add/remove components (IsIdle,
        // Wander), which is a structural change, and mutating while a query
        // iterates would swap unvisited rows into already-passed slots.
        const wildToStep = queries.wildMobs.collect();
        for (const mob of wildToStep) {
            if (!world.isAlive(mob))
                continue;
            // Centipede body segments skip normal AI unless promoted to a head.
            if (world.has(mob, C.CentipedeSegment)
                && world.get(mob, C.CentipedeSegment, 'leader') !== entity_1.NULL_ENTITY) {
                continue;
            }
            const x = world.get(mob, C.Position, 'x');
            const y = world.get(mob, C.Position, 'y');
            // Nowhere near a player: step at the reduced rate. Checked before
            // anything else in the body because everything after it — above all
            // the two target acquisitions and their raycasts — is the work this
            // exists to skip.
            if (!activity.shouldStep(mob, x, y, ctx.tick))
                continue;
            const radius = world.get(mob, C.Radius, 'value');
            const mobTypeId = world.get(mob, C.MobKind, 'type');
            const aiType = world.get(mob, C.MobAI, 'aiType');
            if (applyParentHoleTether(world, mob, x, y, radius, mobTypeId, now)) {
                setIdle(world, mob, false);
                continue;
            }
            const targetPlayer = acquirePlayerTarget(world, mob, x, y, aiType);
            const targetPet = acquirePetTarget(world, mob, x, y, aiType, targetPlayer !== entity_1.NULL_ENTITY);
            const target = targetPlayer !== entity_1.NULL_ENTITY ? targetPlayer : targetPet;
            // Neutral mobs only chase once provoked, i.e. once damage has given
            // them a cached player target.
            const provoked = aiType === 1 /* C.AiType.Neutral */
                && world.get(mob, C.MobAI, 'targetPlayer') !== entity_1.NULL_ENTITY;
            if (target !== entity_1.NULL_ENTITY && (aiType === 2 /* C.AiType.Hostile */ || provoked)) {
                setIdle(world, mob, false);
                chaseAndShoot(world, mob, target, x, y, mobTypeId, now);
            }
            else if (aiType === 3 /* C.AiType.Sandstorm */) {
                setIdle(world, mob, false);
                stepSandstorm(world, mob, x, y, radius, now);
            }
            else {
                stepIdle(world, mob, x, y, radius, now);
            }
            applyWall(world, mob, radius);
        }
        // --- pets -------------------------------------------------------------
        const petsToStep = queries.pets.collect();
        for (const pet of petsToStep) {
            if (!world.isAlive(pet))
                continue;
            const owner = world.get(pet, C.PetOwner, 'owner');
            const ownerAlive = world.isAlive(owner) && !world.has(owner, C.IsDead);
            const speed = world.get(pet, C.Speed, 'current');
            const radius = world.get(pet, C.Radius, 'value');
            const aiType = world.get(pet, C.MobAI, 'aiType');
            // A neutral mob has nothing to be neutral ABOUT once tamed — it
            // fights for its owner, so neutral and hostile both run the hostile
            // pet AI. Passive stays passive; sandstorms keep their drift.
            const attacks = aiType === 2 /* C.AiType.Hostile */ || aiType === 1 /* C.AiType.Neutral */;
            let x = world.get(pet, C.Position, 'x');
            let y = world.get(pet, C.Position, 'y');
            let target = entity_1.NULL_ENTITY;
            let targetResolved = false;
            if (ownerAlive) {
                const ox = world.get(owner, C.Position, 'x');
                const oy = world.get(owner, C.Position, 'y');
                // Sandstorm and passive pets never teleport back to the ring:
                // once off the owner's screen they despawn, and the egg that
                // hatched them reloads and hatches a replacement.
                if (aiType === 3 /* C.AiType.Sandstorm */ || aiType === 0 /* C.AiType.Passive */) {
                    const inView = Math.abs(x - ox) <= viewHalfWidth && Math.abs(y - oy) <= viewHalfHeight;
                    if (!inView) {
                        onPetOutOfView(pet);
                        continue;
                    }
                }
                if (aiType === 3 /* C.AiType.Sandstorm */) {
                    // Sandstorm pets shadow their owner: same heading the owner
                    // is moving in, slightly faster. Being faster they steadily
                    // pull ahead until they drift off-screen and despawn above.
                    if (speed > 0 && world.has(owner, C.Velocity)) {
                        const vx = world.get(owner, C.Velocity, 'x');
                        const vy = world.get(owner, C.Velocity, 'y');
                        const ownerSpeed = Math.sqrt(vx * vx + vy * vy);
                        // Velocity is px/sec; friction leaves a tiny residual
                        // after the keys are released, so treat sub-1px/sec
                        // as standing still.
                        if (ownerSpeed > 1) {
                            const step = ownerSpeed * ctx.deltaTime * SANDSTORM_PET_SPEED_FACTOR;
                            x += (vx / ownerSpeed) * step;
                            y += (vy / ownerSpeed) * step;
                            world.write(pet, C.Position, { x, y });
                            world.set(pet, C.Angle, 'value', Math.atan2(vy, vx));
                        }
                    }
                }
                else if (hasLineOfSight(x, y, ox, oy)) {
                    // Follow directly — no distance limit while sight holds.
                    const dx = ox - x;
                    const dy = oy - y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance > 0 && speed > 0) {
                        const step = speed * enemyPassive_1.ENEMY_SPEED_MULTIPLIER;
                        x += (dx / distance) * step;
                        y += (dy / distance) * step;
                        world.write(pet, C.Position, { x, y });
                        world.set(pet, C.Angle, 'value', Math.atan2(dy, dx));
                    }
                }
                else if (aiType === 0 /* C.AiType.Passive */) {
                    // Sight-blocked passive pet: hold position. The off-screen
                    // rule above is what recovers it, not a teleport.
                }
                else {
                    // No sight: pop back to the owner's ring.
                    const moved = teleportPetToOwner(world, pet, ox, oy);
                    if (moved) {
                        x = moved.x;
                        y = moved.y;
                    }
                }
                if (attacks && speed > 0) {
                    target = acquirePetWildTarget(world, pet, x, y, true, ox, oy);
                    targetResolved = true;
                    if (target !== entity_1.NULL_ENTITY) {
                        const mobDx = world.get(target, C.Position, 'x') - x;
                        const mobDy = world.get(target, C.Position, 'y') - y;
                        const mobDistance = Math.sqrt(mobDx * mobDx + mobDy * mobDy);
                        if (mobDistance > 0) {
                            const step = speed * enemyPassive_1.ENEMY_SPEED_MULTIPLIER;
                            x += (mobDx / mobDistance) * step;
                            y += (mobDy / mobDistance) * step;
                            world.write(pet, C.Position, { x, y });
                            world.set(pet, C.Angle, 'value', Math.atan2(mobDy, mobDx));
                            world.set(pet, C.MobAI, 'isChasing', 1);
                        }
                    }
                    else {
                        world.set(pet, C.MobAI, 'isChasing', 0);
                    }
                }
                else if (!attacks) {
                    // Passive and sandstorm pets never engage.
                    world.set(pet, C.MobAI, 'isChasing', 0);
                }
            }
            else {
                // Owner dead or gone: wander, straight at the target, no avoidance.
                world.set(pet, C.MobAI, 'isChasing', 0);
                const factor = pickWanderTargetIfStale(world, pet, now, radius);
                if (speed > 0) {
                    const dx = world.get(pet, C.Wander, 'targetX') - x;
                    const dy = world.get(pet, C.Wander, 'targetY') - y;
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
            if (attacks && hasProjectile(pet) && speed > 0) {
                // Only a wandering (ownerless) pet skipped the block above, so
                // acquire a target for it here — with no owner there is no
                // screen to clip to, so it uses its own range.
                if (!targetResolved)
                    target = acquirePetWildTarget(world, pet, x, y, false, 0, 0);
                if (target !== entity_1.NULL_ENTITY) {
                    // A pet aims from where it ended up this tick.
                    const aim = Math.atan2(world.get(target, C.Position, 'y') - y, world.get(target, C.Position, 'x') - x);
                    fireVolley(pet, aim, now);
                }
            }
            applyWall(world, pet, radius);
        }
    };
}
function registerEnemyAISystem(scheduler, queries, deps) {
    // Runs in Input, before the passive drift in Simulation, so the IsIdle tag
    // it maintains is already correct when the drift systems read it.
    scheduler.add('enemyAI', system_1.Phase.Input, enemyAISystem(queries, deps));
}
