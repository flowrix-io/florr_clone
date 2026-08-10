/**
 * Per-tick enemy movement and AI.
 *
 * This is the behaviour half of the enemy tick: chain repair, per-mob steering,
 * target acquisition and projectile firing. Spawning lives in enemySpawner.ts,
 * collision response in physics.ts, and death/loot handling stays in server.ts
 * (it needs XP, drops and the database).
 *
 * The entry points, in the order server.ts calls them each tick:
 *
 *   beginEnemyTick()              snapshot pets/players once for the whole pass
 *   repairSeveredCentipedeChains() promote orphaned segments to chain heads
 *   stepEnemy() per enemy          knockback, then pet or wild-mob AI
 *   propagateCentipedeChains()     drag body segments along behind their head
 */

import {
    enemies,
    players,
    MAX_SPEED,
    ENEMY_SIZE,
    VIEWPORT_WIDTH,
    KNOCKBACK_RECOVERY_SPEED,
    getTileState,
    isTileIdBlocking,
} from '../constants';
import { WALL_GRID } from '../map_data';
import { Enemy, isCentipedeHeadType, isCentipedeBodyType } from '../server_utils';
import { ServerPlayer } from '../player';
import { getMobStats, SIZE_SCALING, getEnemySizeScale } from '../mobs';
import { getPetalStats, getRarityIndex } from '../petals';
import { MobProjectile } from '../enemy';
import { hasLineOfSight, checkEnemyWallCollisions, applyEnemyKnockback } from './physics';
import { mobProjectiles, allocateMobProjectileId } from './gameState';

type MobStats = NonNullable<ReturnType<typeof getMobStats>>;

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

const ENEMY_SPEED_MULTIPLIER = 2;
const ENEMY_CHASE_RANGE = 500;
const ENEMY_WANDER_RANGE = 200;

/**
 * Random wander is size-relative: how far a mob strays per hop scales with its
 * radius, so a mob 10x wider covers 10x the ground instead of taking the same
 * absolute step a common does. Mob `speed` is constant across rarities (only
 * `size` scales, SIZE_SCALING 1.5 -> 42.9), so an unscaled step that reads as a
 * few body-lengths for a common (radius 30) is a tenth of a body-length for an
 * apex (radius 858) — the "big mobs look frozen" bug. Normalised against a
 * radius above the common tier's 30 so small mobs also settle down in absolute
 * terms rather than only being caught up to.
 */
const WANDER_REF_RADIUS = 50;

/**
 * Ceiling on the resulting wander velocity. Straight radius-proportional scaling
 * drifts an apex mob at ~2000 u/s — 7x a player's top speed — so clamp the passive
 * step to the player's base speed. MAX_SPEED is per second; this is per 30 TPS tick.
 */
const MAX_WANDER_STEP = MAX_SPEED / 30;

/**
 * Mobs that chase at exactly the player's base speed (MAX_SPEED) instead of
 * their stat-derived step: a fleeing flower can never outrun them, but they
 * can't gain on one running straight either — florr's pursuit feel.
 */
const PLAYER_SPEED_CHASERS = new Set([
    'bee',
    'ladybug', 'shiny_ladybug', 'dark_ladybug',
    'soldier_ant', 'worker_ant', 'baby_ant',
    'soldier_fire_ant', 'worker_fire_ant', 'baby_fire_ant',
]);

/**
 * gardn StaticData SUMMON_RETREAT_RADIUS: hole-spawned mobs defend a territory
 * this large around their hole; dragged past it they give up and head home.
 */
const SUMMON_RETREAT_RADIUS = 600;

/** A mob drops a player target that gets further away than this. */
const MAX_TARGET_DISTANCE = VIEWPORT_WIDTH * 5;

// ---------------------------------------------------------------------------
// Target acquisition scratch buffers
// ---------------------------------------------------------------------------

/*
 * These scans used to LOS-raycast every candidate in range — O(candidates)
 * 21-sample rays per entity per tick. With several players stacking pet eggs
 * (apex eggs spawn 3 pets, centipede pets are 10 entities) the tick loop
 * blew past its 33ms budget and starved the event loop, so nginx answered 502.
 * Instead: collect in-range candidates by squared distance, sort nearest-first,
 * and raycast in that order, stopping at the first visible one. That computes
 * the same "nearest candidate with line of sight" the full scans did; the only
 * divergence is the ray cap, which gives up when everything nearby is occluded
 * instead of raycasting the entire candidate set.
 *
 * The buffers are module-level and reused across enemies to keep the tick
 * allocation-free; nothing holds a reference across a step.
 */
const TARGET_LOS_RAY_CAP = 8;
const _targetScratch: Enemy[] = [];
const _playerScratch: ServerPlayer[] = [];
const _alivePlayersScratch: ServerPlayer[] = [];

function _byScratchDist(a: any, b: any): number {
    return a._d2 - b._d2;
}

/** Nearest _targetScratch entry with line of sight from (fromX, fromY), if any. */
function pickNearestVisible(fromX: number, fromY: number): Enemy | undefined {
    _targetScratch.sort(_byScratchDist);
    const rays = Math.min(_targetScratch.length, TARGET_LOS_RAY_CAP);
    for (let i = 0; i < rays; i++) {
        const candidate = _targetScratch[i];
        if (hasLineOfSight(fromX, fromY, candidate.x, candidate.y)) return candidate;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Shared movement helpers
// ---------------------------------------------------------------------------

/**
 * Radius-derived multiplier applied to every random-wander distance/speed.
 * _radius/_mobStats are cached by rebuildEnemyGrid, but that pass skips pets and
 * runs after this one on a mob's first tick, hence the fallback.
 */
function wanderSizeFactor(enemy: Enemy): number {
    let radius = enemy._radius;
    if (radius === undefined) {
        const stats = enemy._mobStats ?? getMobStats(enemy.type, enemy.tier);
        radius = (stats ? (stats.size * 40) / 2 : ENEMY_SIZE / 2)
            * getEnemySizeScale(!!enemy.ownerId, enemy.tier);
    }
    return radius / WANDER_REF_RADIUS;
}

/**
 * How fast this mob is currently moving relative to normal, 1 = unslowed.
 *
 * Slows work by scaling `enemy.speed` (see applySlow), which covers every branch
 * that derives its step from that field. The two branches below deliberately do
 * NOT: mobs in PLAYER_SPEED_CHASERS chase and retreat at a fixed fraction of the
 * player's own speed so they can never be outrun. Without this factor a web,
 * honey or pincer slow did nothing at all to the mobs it matters most against —
 * measured at 0.92x instead of 0.5x on a chasing soldier ant.
 */
function speedScaleOf(enemy: Enemy): number {
    if (enemy.slowUntil === undefined || !enemy.baseSpeed) return 1;
    return enemy.speed / enemy.baseSpeed;
}

/** Per-tick step length for a mob chasing or returning home. */
function chaseStepOf(enemy: Enemy): number {
    return PLAYER_SPEED_CHASERS.has(enemy.type)
        ? (MAX_SPEED / 30) * speedScaleOf(enemy) // player base speed, per 30 TPS tick
        : enemy.speed * ENEMY_SPEED_MULTIPLIER;
}

/**
 * Steering vector that keeps a centipede head (or promoted severed-chain head) from
 * running into its own body. Direct followers are excluded since the chain-follow pass
 * positions them right behind the head and avoiding them would paralyze the head.
 */
function computeOwnSegmentAvoidance(enemy: Enemy): { x: number; y: number } | null {
    const isCentipedeHead =
        (isCentipedeHeadType(enemy.type) || isCentipedeBodyType(enemy.type)) && !enemy.leaderId;
    if (!isCentipedeHead) return null;

    const AVOID_RADIUS = 140;
    const AVOID_WEIGHT = 2.5;
    let ax = 0;
    let ay = 0;
    for (const seg of enemies) {
        if (seg === enemy) continue;
        if (!isCentipedeBodyType(seg.type)) continue;
        if (seg.headId !== enemy.id) continue;
        if (seg.leaderId === enemy.id) continue;
        const sdx = enemy.x - seg.x;
        const sdy = enemy.y - seg.y;
        const sd = Math.sqrt(sdx * sdx + sdy * sdy);
        if (sd > 0 && sd < AVOID_RADIUS) {
            const strength = (AVOID_RADIUS - sd) / AVOID_RADIUS;
            ax += (sdx / sd) * strength * AVOID_WEIGHT;
            ay += (sdy / sd) * strength * AVOID_WEIGHT;
        }
    }
    if (ax === 0 && ay === 0) return null;
    return { x: ax, y: ay };
}

/**
 * Move `enemy` one step along (dx, dy), blending in own-segment avoidance and
 * (for bees) the pursuit weave. Facing follows the resulting direction.
 */
function stepAlong(enemy: Enemy, dx: number, dy: number, distance: number, speed: number, currentTime: number): void {
    let moveX = dx / distance;
    let moveY = dy / distance;

    const avoid = computeOwnSegmentAvoidance(enemy);
    if (avoid) {
        moveX += avoid.x;
        moveY += avoid.y;
        const mag = Math.sqrt(moveX * moveX + moveY * moveY);
        if (mag > 0) {
            moveX /= mag;
            moveY /= mag;
        }
    }

    if (enemy.type === 'bee') {
        // Provoked bees weave toward the target instead of beelining.
        // The weave is a perpendicular velocity component ADDED to the
        // full-speed pursuit, NOT a rotation of it: rotating the step
        // cuts the closing rate by cos(sway), and a flower fleeing
        // straight at the same speed would slowly escape. Lateral
        // offset A·sin(2t) (A = 50u, the passive wobble's 2 rad/s)
        // contributes its derivative 2A·cos(2t) = ±100 u/s sideways —
        // ±18° of visible heading swing at full chase speed. Facing
        // follows the combined direction via the atan2 below.
        if (enemy.wobblePhase === undefined) enemy.wobblePhase = Math.random() * Math.PI * 2;
        const t = currentTime / 1000 + enemy.wobblePhase;
        const latFrac = (100 * Math.cos(2 * t)) / (speed * 30);
        const perpX = -moveY;
        const perpY = moveX;
        moveX += perpX * latFrac;
        moveY += perpY * latFrac;
    }

    enemy.x += moveX * speed;
    enemy.y += moveY * speed;
    if (enemy.speed !== 0) {
        enemy.angle = Math.atan2(moveY * speed, moveX * speed);
    }
}

/**
 * Re-pick a random wander destination if the mob has none or the current one is
 * older than 3s. Returns the mob's size factor, which the caller also needs to
 * scale its step.
 *
 * Range alone isn't enough to make wander size-relative: these forms walk to the
 * target at a fixed step, so a bigger range would just take proportionally
 * longer. The caller scales the step by the same factor.
 */
function pickWanderTargetIfStale(enemy: Enemy, currentTime: number): number {
    const factor = wanderSizeFactor(enemy);
    if (enemy.wanderTargetX === undefined || currentTime - (enemy.lastWanderTime || 0) > 3000) {
        const range = ENEMY_WANDER_RANGE * factor;
        enemy.wanderTargetX = enemy.x + (Math.random() * 2 - 1) * range;
        enemy.wanderTargetY = enemy.y + (Math.random() * 2 - 1) * range;
        enemy.lastWanderTime = currentTime;
    }
    return factor;
}

/** Per-tick step length for a mob walking to its random wander target. */
function wanderStepOf(enemy: Enemy, factor: number): number {
    return Math.min(enemy.speed * ENEMY_SPEED_MULTIPLIER * 0.5 * factor, MAX_WANDER_STEP);
}

/**
 * Fire one volley if the mob's cooldown has elapsed.
 *
 * `aimAngle` is supplied by the caller rather than derived here because the two
 * call sites aim from different positions: a pet aims after it has moved this
 * tick, a chasing wild mob aims along its pre-move offset to the target. Both
 * are long-standing behaviour, so the angle stays the caller's decision.
 */
function fireProjectileVolley(enemy: Enemy, mobStats: MobStats, aimAngle: number, currentTime: number): void {
    const projectileConfig = mobStats.projectile;
    if (!projectileConfig) return;

    const lastShotTime = enemy.lastProjectileTime || 0;
    const cooldown = mobStats.cooldown || 2000;
    if (currentTime - lastShotTime < cooldown) return;

    const projectileSpeed = projectileConfig.speed || 200; // pixels per second
    const spreadAngle = projectileConfig.spreadAngle || 0.2; // radians
    const projectileCount = projectileConfig.count || 1;

    // Use the enemy's tier/rarity for the projectile rather than a fixed rarity.
    const projectileRarity = enemy.tier;
    const petalStats = getPetalStats(projectileConfig.petalType, projectileRarity);
    if (!petalStats) return;

    for (let i = 0; i < projectileCount; i++) {
        let projectileAngle = aimAngle;
        if (projectileCount > 1) {
            const spreadOffset = (i - (projectileCount - 1) / 2) * spreadAngle;
            projectileAngle = aimAngle + spreadOffset;
        }

        // Scale projectile distance and size by the mob's rarity size scaling.
        const distanceScale = (SIZE_SCALING[enemy.tier] || 1) / 9;
        const sizeScale = (SIZE_SCALING[enemy.tier] || 1) / 3;

        const projectile: MobProjectile = {
            id: allocateMobProjectileId(),
            enemyId: enemy.id,
            x: enemy.x,
            y: enemy.y,
            startX: enemy.x,
            startY: enemy.y,
            angle: projectileAngle,
            speed: projectileSpeed / 1000, // Convert to pixels per millisecond
            distance: 0,
            maxDistance: projectileConfig.distance * distanceScale,
            petalType: projectileConfig.petalType,
            petalRarity: projectileRarity,
            damage: petalStats.damage,
            size: petalStats.size * sizeScale, // Mob projectiles scale size with rarity
            health: petalStats.health,
            maxHealth: petalStats.health,
            spawnTime: currentTime,
            sourceType: enemy.type,
        };

        mobProjectiles.push(projectile);
    }

    enemy.lastProjectileTime = currentTime;
}

// ---------------------------------------------------------------------------
// Tick context
// ---------------------------------------------------------------------------

export interface EnemyTickContext {
    currentTime: number;
    /** Every enemy by id, for leader/target lookups without a linear scan. */
    enemyById: Map<string, Enemy>;
    /** Live pets, collected once so pet-targeting doesn't rescan `enemies`. */
    petsThisTick: Enemy[];
    /**
     * Alive players in a dense array. The hostile target scan and the sandstorm
     * pull run per enemy — iterating the `players` dictionary (a delete-heavy
     * object, so V8 keeps it in slow hash-table mode) from inside those loops
     * was measurably hot.
     */
    alivePlayers: ServerPlayer[];
}

/** Build the once-per-tick snapshots every enemy step reads from. */
export function beginEnemyTick(currentTime: number): EnemyTickContext {
    const enemyById = new Map<string, Enemy>();
    for (const e of enemies) enemyById.set(e.id, e);

    const petsThisTick: Enemy[] = [];
    for (const e of enemies) {
        if (e.ownerId && !(e as any).isDead && e.health > 0) petsThisTick.push(e);
    }

    _alivePlayersScratch.length = 0;
    for (const pid in players) {
        const p = players[pid];
        if (p && !p.isDead) _alivePlayersScratch.push(p);
    }

    return { currentTime, enemyById, petsThisTick, alivePlayers: _alivePlayersScratch };
}

// ---------------------------------------------------------------------------
// Centipede chains
// ---------------------------------------------------------------------------

/**
 * Detect severed centipede chains: any body segment whose leader no longer
 * exists is promoted to a new chain head. Subsequent segments are re-chained
 * under the new head so they continue following it.
 */
export function repairSeveredCentipedeChains(ctx: EnemyTickContext): void {
    for (const enemy of enemies) {
        if (!isCentipedeBodyType(enemy.type) || !enemy.leaderId) continue;
        if (ctx.enemyById.has(enemy.leaderId)) continue;

        enemy.leaderId = undefined;
        enemy.headId = enemy.id;
        enemy.segmentIndex = 0;

        let leader: Enemy = enemy;
        let nextIndex = 1;
        // Guard against a cycle in the leaderId graph (e.g. two severed segments
        // that end up pointing at each other). Without this, enemies.find() keeps
        // returning a chain member forever and the server tick spins at 100% CPU —
        // a hang that silently stops all logging and stops serving. Track visited
        // segments; a revisit means the chain is corrupt, so sever it and stop.
        // The visited set also bounds the walk to at most `enemies.length` steps.
        const visited = new Set<string>([enemy.id]);
        while (true) {
            const follower = enemies.find(e => e.leaderId === leader.id);
            if (!follower) break;
            if (visited.has(follower.id)) {
                follower.leaderId = undefined; // break the cycle so it can't recur next tick
                break;
            }
            visited.add(follower.id);
            follower.headId = enemy.id;
            follower.segmentIndex = nextIndex++;
            leader = follower;
        }
    }
}

/**
 * Second pass: propagate centipede chain positions from each head down to its
 * body segments. Each head's chain is processed in order so segments always see
 * their leader's freshly-updated position. A "head" is either an original
 * centipede or a body segment promoted after a chain was severed.
 *
 * One pass groups segments by head (and reuses the tick's enemyById map for
 * leader lookups) — this used to re-filter and .find() over all ~1400 enemies
 * per head and per segment, which was O(chains × enemies) per tick.
 */
export function propagateCentipedeChains(ctx: EnemyTickContext): void {
    const segmentsByHead = new Map<string, Enemy[]>();
    const centipedeHeads: Enemy[] = [];

    for (const e of enemies) {
        if (isCentipedeBodyType(e.type)) {
            if (e.headId) {
                let list = segmentsByHead.get(e.headId);
                if (!list) { list = []; segmentsByHead.set(e.headId, list); }
                list.push(e);
            }
            if (!e.leaderId) centipedeHeads.push(e);
        } else if (isCentipedeHeadType(e.type) && !e.leaderId) {
            centipedeHeads.push(e);
        }
    }

    for (const head of centipedeHeads) {
        const chain = (segmentsByHead.get(head.id) || [])
            .sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));
        for (const segment of chain) {
            const leader = segment.leaderId ? ctx.enemyById.get(segment.leaderId) : undefined;
            if (!leader) continue;
            const segStats = getMobStats(segment.type, segment.tier);
            const segmentSize = (segStats ? segStats.size * 40 : 40)
                * getEnemySizeScale(!!segment.ownerId, segment.tier);
            const spacing = segmentSize * 0.9;
            const dx = segment.x - leader.x;
            const dy = segment.y - leader.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            segment.x = leader.x + (dx / dist) * spacing;
            segment.y = leader.y + (dy / dist) * spacing;
            segment.angle = Math.atan2(leader.y - segment.y, leader.x - segment.x);
            segment.isChasing = head.isChasing;
            checkEnemyWallCollisions(segment);
        }
    }
}

// ---------------------------------------------------------------------------
// Per-enemy step
// ---------------------------------------------------------------------------

/**
 * Advance one enemy by a tick: knockback, then either pet or wild-mob AI.
 * Centipede body segments are skipped here and positioned by
 * propagateCentipedeChains instead.
 */
export function stepEnemy(enemy: Enemy, ctx: EnemyTickContext): void {
    // Apply knockback if it exists: decay, then move. The move is
    // substepped through wall checks (applyEnemyKnockback) because a
    // high-tier jelly impulse covers thousands of px per tick — enough to
    // jump past walls, and past the world edge where everything is air.
    if (enemy.knockbackX || enemy.knockbackY) {
        if (enemy.knockbackX) enemy.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
        if (enemy.knockbackY) enemy.knockbackY *= KNOCKBACK_RECOVERY_SPEED;
        applyEnemyKnockback(enemy);
        if (enemy.knockbackX && Math.abs(enemy.knockbackX) < 0.1) enemy.knockbackX = 0;
        if (enemy.knockbackY && Math.abs(enemy.knockbackY) < 0.1) enemy.knockbackY = 0;
    }

    // Centipede body segments skip normal AI unless they've been promoted
    // to a chain head (leaderId cleared after the previous segment died).
    // Promoted heads run AI so each half of a severed centipede keeps moving.
    if (isCentipedeBodyType(enemy.type) && enemy.leaderId) return;

    if (enemy.ownerId) {
        stepPet(enemy, ctx);
    } else {
        stepWildMob(enemy, ctx);
    }
}

// ---- Pets ----------------------------------------------------------------

/** A pet follows its owner and attacks wild mobs; ownerless pets wander. */
function stepPet(enemy: Enemy, ctx: EnemyTickContext): void {
    const { currentTime } = ctx;
    const owner = players[enemy.ownerId!];

    // One wild-mob target per pet per tick, shared by chase movement and
    // the projectile block below (they used to each rescan all enemies).
    let petTarget: Enemy | undefined;
    let petTargetResolved = false;

    if (owner && !owner.isDead) {
        if (hasLineOfSight(enemy.x, enemy.y, owner.x, owner.y)) {
            followOwner(enemy, owner);
        } else {
            teleportNearOwner(enemy, owner);
        }

        // Attack wild mobs (enemies without ownerId) if pet is movable
        if (enemy.speed > 0) {
            petTarget = acquirePetWildTarget(enemy, ctx);
            petTargetResolved = true;

            if (petTarget) {
                const mobDx = petTarget.x - enemy.x;
                const mobDy = petTarget.y - enemy.y;
                const mobDistance = Math.sqrt(mobDx * mobDx + mobDy * mobDy);
                if (mobDistance > 0) {
                    const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER;
                    enemy.x += (mobDx / mobDistance) * speed;
                    enemy.y += (mobDy / mobDistance) * speed;
                    enemy.angle = Math.atan2(mobDy, mobDx);
                    enemy.isChasing = true;
                }
            } else {
                enemy.isChasing = false;
            }
        }
    } else {
        // Owner is dead or disconnected, pet wanders.
        enemy.isChasing = false;
        stepPetWander(enemy, currentTime);
    }

    // Handle pet projectiles (same as regular enemies)
    const mobStats = getMobStats(enemy.type, enemy.tier);
    if (mobStats?.projectile && enemy.speed > 0) {
        // Reuse the chase target acquired above. Only ownerless (wandering)
        // pets skip that block, so acquire a target for them here.
        if (!petTargetResolved) {
            petTarget = acquirePetWildTarget(enemy, ctx);
        }
        if (petTarget) {
            // A pet aims from where it ended up this tick.
            const aimAngle = Math.atan2(petTarget.y - enemy.y, petTarget.x - enemy.x);
            fireProjectileVolley(enemy, mobStats, aimAngle, currentTime);
        }
    }

    checkEnemyWallCollisions(enemy);
}

/** Follow the owner directly — no distance limit while line of sight holds. */
function followOwner(enemy: Enemy, owner: ServerPlayer): void {
    const dx = owner.x - enemy.x;
    const dy = owner.y - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 0 && enemy.speed > 0) {
        const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER;
        enemy.x += (dx / distance) * speed;
        enemy.y += (dy / distance) * speed;
        enemy.angle = Math.atan2(dy, dx);
    }
}

/**
 * No line of sight to the owner: try to pop the pet to a ring position around
 * them that is out of walls and visible, else onto the owner directly.
 */
function teleportNearOwner(enemy: Enemy, owner: ServerPlayer): void {
    const teleportDistance = 80;
    const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];

    for (const angle of angles) {
        const teleportX = owner.x + Math.cos(angle) * teleportDistance;
        const teleportY = owner.y + Math.sin(angle) * teleportDistance;

        const isInWall = isTileIdBlocking(getTileState(WALL_GRID, teleportX, teleportY));
        if (!isInWall && hasLineOfSight(teleportX, teleportY, owner.x, owner.y)) {
            enemy.x = teleportX;
            enemy.y = teleportY;
            const dx = owner.x - enemy.x;
            const dy = owner.y - enemy.y;
            if (dx !== 0 || dy !== 0) {
                enemy.angle = Math.atan2(dy, dx);
            }
            return;
        }
    }

    // No good ring position: fall back to the owner's own tile if it is clear.
    if (!isTileIdBlocking(getTileState(WALL_GRID, owner.x, owner.y))) {
        enemy.x = owner.x;
        enemy.y = owner.y;
    }
}

/** Wander used by a pet whose owner is gone — straight at the target, no avoidance. */
function stepPetWander(enemy: Enemy, currentTime: number): void {
    const factor = pickWanderTargetIfStale(enemy, currentTime);
    if (enemy.wanderTargetX === undefined || enemy.speed <= 0) return;

    const dx = enemy.wanderTargetX - enemy.x;
    const dy = enemy.wanderTargetY! - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= 5) return;

    const speed = wanderStepOf(enemy, factor);
    enemy.x += (dx / distance) * speed;
    enemy.y += (dy / distance) * speed;
    enemy.angle = Math.atan2(dy, dx);
}

/**
 * Wander used by centipede heads (and promoted severed-chain heads). Unlike the
 * pet wander this steers around its own body, because the chain-follow pass
 * depends on smooth directed head movement. Segments are snapped to their leader
 * at fixed spacing every tick, so a faster head doesn't stretch the chain.
 */
function stepCentipedeHeadWander(enemy: Enemy, currentTime: number): void {
    const factor = pickWanderTargetIfStale(enemy, currentTime);
    if (enemy.wanderTargetX === undefined) return;

    const dx = enemy.wanderTargetX - enemy.x;
    const dy = enemy.wanderTargetY! - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= 5) return;

    stepAlong(enemy, dx, dy, distance, wanderStepOf(enemy, factor), currentTime);
}

/**
 * Resolve a pet's wild-mob target. The cached target is revalidated first
 * (alive, still wild, in range, visible — one ray), so a pet locked onto a mob
 * costs one raycast per tick instead of a rescan. Like wild mobs' player
 * targeting, the pet keeps its target until it dies, leaves range, or is
 * occluded, rather than flip-flopping to whatever is momentarily closest.
 */
function acquirePetWildTarget(enemy: Enemy, ctx: EnemyTickContext): Enemy | undefined {
    const petRange = enemy.range || ENEMY_CHASE_RANGE;
    const rangeSq = petRange * petRange;

    if (enemy.targetEnemyId) {
        const cached = ctx.enemyById.get(enemy.targetEnemyId);
        if (cached && !cached.ownerId && !(cached as any).isDead && cached.health > 0) {
            const dx = cached.x - enemy.x;
            const dy = cached.y - enemy.y;
            if (dx * dx + dy * dy < rangeSq && hasLineOfSight(enemy.x, enemy.y, cached.x, cached.y)) {
                return cached;
            }
        }
        enemy.targetEnemyId = undefined;
    }

    _targetScratch.length = 0;
    for (const otherEnemy of enemies) {
        if (otherEnemy.id === enemy.id || otherEnemy.ownerId) continue;
        if ((otherEnemy as any).isDead || otherEnemy.health <= 0) continue;
        const dx = otherEnemy.x - enemy.x;
        const dy = otherEnemy.y - enemy.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < rangeSq) {
            (otherEnemy as any)._d2 = d2;
            _targetScratch.push(otherEnemy);
        }
    }
    const target = pickNearestVisible(enemy.x, enemy.y);
    enemy.targetEnemyId = target ? target.id : undefined;
    return target;
}

// ---- Wild mobs -----------------------------------------------------------

/** Full AI for a non-pet enemy: tether, targeting, then chase/sandstorm/idle. */
function stepWildMob(enemy: Enemy, ctx: EnemyTickContext): void {
    if (applyParentHoleTether(enemy, ctx)) return;

    const targetPlayer = acquirePlayerTarget(enemy, ctx);
    const closestPet = acquirePetTarget(enemy, ctx, targetPlayer);

    // Prioritize players, but target pets if no player is in range.
    const target = targetPlayer ? targetPlayer : (closestPet ? closestPet : null);

    // Neutral mobs only chase if provoked (have a targetPlayerId from taking damage).
    const isProvoked = enemy.aiType === 'neutral' && !!enemy.targetPlayerId;

    if (target && (enemy.aiType === 'hostile' || isProvoked)) {
        chaseAndShoot(enemy, target, ctx);
    } else if (enemy.aiType === 'sandstorm') {
        stepSandstorm(enemy, ctx);
    } else {
        stepIdle(enemy, ctx);
    }

    checkEnemyWallCollisions(enemy);
}

/**
 * gardn tick_ai_behavior parent tether: hole-spawned ants defend the
 * territory around their hole. Dragged past SUMMON_RETREAT_RADIUS they
 * drop their target and return home (gardn kReturning) until back
 * within 100u, then resume normal AI — so kiting ants away disperses
 * the swarm instead of accumulating permanent pursuers. If the hole
 * is destroyed they unparent and roam free (gardn parity).
 *
 * Returns true if the mob spent this tick walking home, in which case the
 * caller skips the rest of its AI (the wall check has already run).
 */
function applyParentHoleTether(enemy: Enemy, ctx: EnemyTickContext): boolean {
    if (!enemy.parentHoleId) return false;

    const hole = ctx.enemyById.get(enemy.parentHoleId);
    if (!hole || (hole as any).isDead || hole.health <= 0) {
        enemy.parentHoleId = undefined;
        enemy.returningToHole = false;
        return false;
    }

    const homeDx = hole.x - enemy.x;
    const homeDy = hole.y - enemy.y;
    const homeDist = Math.hypot(homeDx, homeDy) || 1;

    if (!enemy.returningToHole && homeDist > SUMMON_RETREAT_RADIUS) {
        enemy.targetPlayerId = undefined;
        enemy.isChasing = false;
        enemy.returningToHole = true;
    }
    if (!enemy.returningToHole) return false;

    if (homeDist < 100) {
        enemy.returningToHole = false;
        enemy.passiveState = 'idle';
        enemy.passiveStateStart = ctx.currentTime;
        return false;
    }

    const returnSpeed = chaseStepOf(enemy);
    enemy.x += (homeDx / homeDist) * returnSpeed;
    enemy.y += (homeDy / homeDist) * returnSpeed;
    enemy.angle = Math.atan2(homeDy, homeDx);
    checkEnemyWallCollisions(enemy);
    return true;
}

/**
 * Keep the current player target while it stays alive, within 5x view distance
 * and visible; otherwise scan for a new one.
 *
 * Candidates are ordered by aggro-adjusted distance and raycast nearest-first,
 * so the common case costs one ray instead of one per player. Petals like Bulb
 * raise a player's aggro radius — treated as being that many pixels closer, so
 * mobs detect them from further away (effectively widening the chase range).
 */
function acquirePlayerTarget(enemy: Enemy, ctx: EnemyTickContext): ServerPlayer | undefined {
    let targetPlayer: ServerPlayer | undefined;

    if (enemy.targetPlayerId && players[enemy.targetPlayerId]) {
        const existingTarget = players[enemy.targetPlayerId];
        if (!existingTarget.isDead) {
            const dx = existingTarget.x - enemy.x;
            const dy = existingTarget.y - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            // Keep targeting if within 5x view distance AND has line of sight;
            // a wall between them drops the target.
            if (distance <= MAX_TARGET_DISTANCE && hasLineOfSight(enemy.x, enemy.y, existingTarget.x, existingTarget.y)) {
                targetPlayer = existingTarget;
            } else {
                enemy.targetPlayerId = undefined;
            }
        } else {
            enemy.targetPlayerId = undefined;
        }
    }

    // Neutral, sandstorm and passive mobs don't actively scan — neutral only
    // acquires a target via provocation.
    if (targetPlayer || enemy.aiType === 'neutral' || enemy.aiType === 'sandstorm' || enemy.aiType === 'passive') {
        return targetPlayer;
    }

    const chaseRange = enemy.range || ENEMY_CHASE_RANGE;
    _playerScratch.length = 0;
    for (let _pi = 0; _pi < ctx.alivePlayers.length; _pi++) {
        const player = ctx.alivePlayers[_pi];
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const effectiveDistance = distance - (player.aggroRadiusBonus || 0);
        if (effectiveDistance < chaseRange) {
            (player as any)._d2 = effectiveDistance;
            _playerScratch.push(player);
        }
    }
    _playerScratch.sort(_byScratchDist);

    const playerRays = Math.min(_playerScratch.length, TARGET_LOS_RAY_CAP);
    for (let ci = 0; ci < playerRays; ci++) {
        const candidate = _playerScratch[ci];
        if (hasLineOfSight(enemy.x, enemy.y, candidate.x, candidate.y)) {
            enemy.targetPlayerId = candidate.id;
            return candidate;
        }
    }
    return undefined;
}

/**
 * Find the closest pet as an alternative target, only when no player is in
 * range. Only mobs that can actually chase consume this target (hostile, or a
 * provoked neutral whose player target vanished), so passive/sandstorm/
 * unprovoked-neutral mobs skip the scan entirely.
 */
function acquirePetTarget(enemy: Enemy, ctx: EnemyTickContext, targetPlayer: ServerPlayer | undefined): Enemy | undefined {
    if (targetPlayer) return undefined;
    if (!(enemy.aiType === 'hostile' || (enemy.aiType === 'neutral' && enemy.targetPlayerId))) return undefined;

    const petChaseRange = enemy.range || ENEMY_CHASE_RANGE;
    const petChaseRangeSq = petChaseRange * petChaseRange;
    let closestPet: Enemy | undefined;

    // Revalidate the cached pet target (one ray) before rescanning.
    if (enemy.targetPetId) {
        const cached = ctx.enemyById.get(enemy.targetPetId);
        if (cached && cached.ownerId && !(cached as any).isDead && cached.health > 0) {
            const petDx = cached.x - enemy.x;
            const petDy = cached.y - enemy.y;
            if (petDx * petDx + petDy * petDy < petChaseRangeSq &&
                hasLineOfSight(enemy.x, enemy.y, cached.x, cached.y)) {
                closestPet = cached;
            }
        }
        if (!closestPet) enemy.targetPetId = undefined;
    }

    if (!closestPet && ctx.petsThisTick.length > 0) {
        _targetScratch.length = 0;
        for (const pet of ctx.petsThisTick) {
            if (pet.id === enemy.id) continue;
            const petDx = pet.x - enemy.x;
            const petDy = pet.y - enemy.y;
            const d2 = petDx * petDx + petDy * petDy;
            if (d2 < petChaseRangeSq) {
                (pet as any)._d2 = d2;
                _targetScratch.push(pet);
            }
        }
        closestPet = pickNearestVisible(enemy.x, enemy.y);
        enemy.targetPetId = closestPet ? closestPet.id : undefined;
    }

    return closestPet;
}

/** Chase the acquired target and fire at it if this mob has a projectile. */
function chaseAndShoot(enemy: Enemy, target: ServerPlayer | Enemy, ctx: EnemyTickContext): void {
    const { currentTime } = ctx;

    enemy.isChasing = true;
    // Offset to the target BEFORE moving. The projectile below deliberately
    // aims along this pre-move offset (long-standing behaviour).
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
        stepAlong(enemy, dx, dy, distance, chaseStepOf(enemy), currentTime);
    }

    const mobStats = getMobStats(enemy.type, enemy.tier);
    if (mobStats?.projectile) {
        fireProjectileVolley(enemy, mobStats, Math.atan2(dy, dx), currentTime);
    }
}

/** Sandstorm AI: fast random movement, changing direction frequently. */
function stepSandstorm(enemy: Enemy, ctx: EnemyTickContext): void {
    const { currentTime } = ctx;
    enemy.isChasing = false;

    const SANDSTORM_DIRECTION_CHANGE_INTERVAL = 300;
    if (enemy.wanderTargetX === undefined || currentTime - (enemy.lastWanderTime || 0) > SANDSTORM_DIRECTION_CHANGE_INTERVAL) {
        const randomAngle = Math.random() * Math.PI * 2;
        const wanderDistance = ENEMY_WANDER_RANGE * 2;
        enemy.wanderTargetX = enemy.x + Math.cos(randomAngle) * wanderDistance;
        enemy.wanderTargetY = enemy.y + Math.sin(randomAngle) * wanderDistance;
        enemy.lastWanderTime = currentTime;
    }

    if (enemy.wanderTargetX !== undefined && enemy.speed > 0) {
        const dx = enemy.wanderTargetX - enemy.x;
        const dy = enemy.wanderTargetY! - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 5) {
            // Sandstorms move at full speed (not the 0.5x wander speed).
            const speed = enemy.speed * ENEMY_SPEED_MULTIPLIER;
            enemy.x += (dx / distance) * speed;
            enemy.y += (dy / distance) * speed;
            enemy.angle = Math.atan2(dy, dx);
        }
    }

    // Suck in nearby players if the sandstorm is super rarity or above.
    if (getRarityIndex(enemy.tier) >= getRarityIndex('super')) {
        const SANDSTORM_SUCK_RANGE = 400;
        const SANDSTORM_SUCK_FORCE = 1.5;
        for (const player of ctx.alivePlayers) {
            const dx = enemy.x - player.x;
            const dy = enemy.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < SANDSTORM_SUCK_RANGE && distance > 0) {
                // Pull strength increases as the player gets closer.
                const pullStrength = SANDSTORM_SUCK_FORCE * (1 - distance / SANDSTORM_SUCK_RANGE);
                player.x += (dx / distance) * pullStrength;
                player.y += (dy / distance) * pullStrength;
            }
        }
    }
}

/** Not chasing: drop a stale target, then wander. */
function stepIdle(enemy: Enemy, ctx: EnemyTickContext): void {
    const { currentTime } = ctx;
    enemy.isChasing = false;

    if (enemy.targetPlayerId) {
        const existingTarget = players[enemy.targetPlayerId];
        if (existingTarget && !existingTarget.isDead) {
            const dx = existingTarget.x - enemy.x;
            const dy = existingTarget.y - enemy.y;
            if (Math.sqrt(dx * dx + dy * dy) > MAX_TARGET_DISTANCE) {
                enemy.targetPlayerId = undefined;
            }
        } else {
            enemy.targetPlayerId = undefined;
        }
    }

    if (isCentipedeHeadType(enemy.type) || isCentipedeBodyType(enemy.type)) {
        // Centipede heads keep the target-based wander — it is intentionally
        // not the gardn passive machine below.
        stepCentipedeHeadWander(enemy, currentTime);
    } else if (enemy.speed > 0) {
        stepGardnPassive(enemy, currentTime);
    }
}

/**
 * Passive movement ported from ~/gardn (Server/Process/Ai.cc
 * tick_default_passive + Motion.cc). State machine:
 *   idle ~1s  → pick a random heading (= the mob's facing angle)
 *   moving ~2.5s → pause 0.5s, then ease into motion ALONG that heading
 *                  for ~2s with a parabolic accel ramp → back to idle.
 * Movement is the gardn friction integrator (velocity *= 1 - friction;
 * velocity += acceleration), so the mob eases in and glides to a stop.
 * Because it accelerates along enemy.angle, facing always equals the
 * movement direction by construction — no facing derivation needed.
 * gardn's friction is 1/3 per tick @ SIM_RATE 20; ~0.25 per tick gives
 * the same glide at this server's 30 TPS.
 */
function stepGardnPassive(enemy: Enemy, currentTime: number): void {
    const FRICTION = 0.25;
    // gardn ramps acceleration as 2 * PLAYER_ACCELERATION * (r - r^2); the
    // base is scaled per-mob (gardn-matched wander baseline). This used to
    // carry a 3x roam factor, which sent mobs sprinting way too far per
    // move — removed for gardn-like short wander hops.
    // Hop distance is (sum of accel)/FRICTION, so scaling ACCEL by the mob's
    // radius factor scales the distance covered per move phase with it — the
    // phase durations stay fixed, which is what keeps hops size-proportional.
    const ACCEL = enemy.speed * ENEMY_SPEED_MULTIPLIER * 0.25 * wanderSizeFactor(enemy);

    let accelX = 0;
    let accelY = 0;

    if (enemy.type === 'bee') {
        // gardn Ai.cc tick_bee_passive: bees don't stop-and-go like the
        // default machine below — they cruise continuously along a heading
        // that wobbles sinusoidally (the wavy flight line), re-pick a random
        // base heading every 5s, and pulse speed (half accel for the first
        // 0.5s of every 1.5s window). gardn per tick @ SIM_RATE 20:
        //   angle += 1.5·sin(lifetime/(SIM_RATE/2))/SIM_RATE  ⇒  dθ/dt = 1.5·sin(2t) rad/s
        // which integrates to ±0.75 rad of heading sway. wobblePhase
        // de-synchronizes bees so they don't all weave in lockstep.
        // Facing = heading by construction, same as the default machine.
        if (enemy.wobblePhase === undefined) enemy.wobblePhase = Math.random() * Math.PI * 2;
        if (enemy.passiveStateStart === undefined || currentTime - enemy.passiveStateStart >= 5000) {
            enemy.angle = Math.random() * Math.PI * 2;
            enemy.passiveStateStart = currentTime;
        }
        const t = currentTime / 1000 + enemy.wobblePhase;
        enemy.angle += 1.5 * Math.sin(2 * t) / 30;
        // Sustained (not ramped) accel of 3× the wander baseline ⇒ terminal
        // 3·speed/tick = 90 u/s for the bee's 0.5 speed — gardn's bee cruise
        // (accel 1.5 vs PLAYER_ACCELERATION 5, of a 300 u/s top speed).
        let mag = ACCEL * 3;
        if ((t * 1000) % 1500 < 500) mag *= 0.5;
        accelX = Math.cos(enemy.angle) * mag;
        accelY = Math.sin(enemy.angle) * mag;
    } else {
        if (enemy.passiveState === undefined) {
            enemy.passiveState = 'idle';
            enemy.passiveStateStart = currentTime;
        }
        const elapsed = currentTime - (enemy.passiveStateStart ?? currentTime);
        if (enemy.passiveState === 'idle') {
            if (elapsed >= 1000) { // idle for ~1s, then choose a new heading
                enemy.angle = Math.random() * Math.PI * 2;
                enemy.passiveState = 'moving';
                enemy.passiveStateStart = currentTime;
            }
        } else {
            if (elapsed >= 2500) { // full move phase done → idle
                enemy.passiveState = 'idle';
                enemy.passiveStateStart = currentTime;
            } else if (elapsed >= 500) { // 0.5s pause, then 2s parabolic ramp
                const r = (elapsed - 500) / 2000;       // 0..1 across the move
                const ramp = r - r * r;                 // gardn (r - r^2), peak 0.25
                const mag = ACCEL * 2 * ramp;           // gardn 2*ACCEL*(r - r^2)
                accelX = Math.cos(enemy.angle) * mag;
                accelY = Math.sin(enemy.angle) * mag;
            }
        }
    }

    // gardn Motion.cc integrator: friction bleeds velocity, accel refills it.
    enemy.velX = (enemy.velX ?? 0) * (1 - FRICTION) + accelX;
    enemy.velY = (enemy.velY ?? 0) * (1 - FRICTION) + accelY;
    // Clamp the size-scaled drift so the largest mobs can't outrun players.
    // velX/velY are exclusively this integrator's state (physics.ts only ever
    // zeroes them on a wall hit), so clamping here affects nothing else.
    const velMag = Math.sqrt(enemy.velX * enemy.velX + enemy.velY * enemy.velY);
    if (velMag > MAX_WANDER_STEP) {
        const k = MAX_WANDER_STEP / velMag;
        enemy.velX *= k;
        enemy.velY *= k;
    }
    enemy.x += enemy.velX;
    enemy.y += enemy.velY;
}
