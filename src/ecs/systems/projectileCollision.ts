/**
 * Projectile collision and damage — the port of the hit-testing halves of
 * `updateMobProjectiles` and `updatePlayerProjectiles` (server.ts).
 *
 * Four passes, in the order the two legacy loops ran them:
 *
 *   1. mob projectile  -> player         (only when the shooter is NOT a pet)
 *   2. pet projectile  -> wild mob       (only when the shooter IS a pet)
 *   3. player projectile -> mob projectile   (mutual, the only proj-vs-proj rule)
 *   4. player projectile -> mob
 *
 * and then the mob-projectile max-distance sweep, which deliberately runs LAST
 * (see the note on ordering below).
 *
 * ---------------------------------------------------------------------------
 * Why the four passes are ONE system
 * ---------------------------------------------------------------------------
 * The legacy loops spliced their arrays as they went, so a projectile consumed
 * by an earlier pass was already gone from the array a later pass walked. The
 * command buffer cannot reproduce that on its own — it flushes between PHASES,
 * so a projectile destroyed in pass 1 would still be visible to pass 3 in the
 * same tick and could trade damage from beyond the grave. Keeping the passes
 * together lets one `consumed` stamp stand in for the splice exactly, while the
 * actual destruction still goes through the command buffer (archetypes
 * swap-remove, so an inline destroy slides an unvisited row into the slot the
 * loop just passed).
 *
 * ---------------------------------------------------------------------------
 * Why the broad phase is gathered up front
 * ---------------------------------------------------------------------------
 * `Query.chunks` hands out a REUSED chunk view (world.chunkView), so two nested
 * chunks() walks would clobber each other's columns. Pass 3 needs both
 * projectile sets at once, so both are gathered into pooled records first and
 * every pass then reads plain arrays — the same shape mobCollision.ts uses.
 *
 * ---------------------------------------------------------------------------
 * What is injected and why
 * ---------------------------------------------------------------------------
 * Everything that needs game config (petal damage, mob mass, a player's damage
 * multiplier) or that has side effects outside the world (the playerDamaged
 * broadcast, XP/drops on a kill, the batched enemyDamaged flush) is a hook. The
 * ECS layer imports neither constants.ts nor petal_actions.ts nor the map, and
 * that is what keeps it typecheckable and runnable in about a second.
 */

import * as C from '../components';
import { Entity, NULL_ENTITY } from '../entity';
import { mobTypes, petalTypes } from '../interning';
import { GridQueryResult, SpatialGrid } from '../spatial/grid';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/** Knockback applied to a PLAYER hit by a mob projectile. */
export const PLAYER_KNOCKBACK_FORCE = 25;

/** Knockback applied to a MOB hit by a projectile, before mass division. */
export const MOB_KNOCKBACK_FORCE = 20;

/** Mass assumed for a mob whose config could not be resolved. */
const DEFAULT_MOB_MASS = 1.0;

/**
 * How kill attribution is timed, mirroring killEnemy's `trackMobKillTiming`.
 *
 * The two projectile kill sites differ and the difference is deliberate:
 * pet-projectile kills defer the (expensive, broadcast-to-everyone) kill
 * tracking to a setImmediate so the projectile pass keeps its tick budget,
 * while player-projectile kills track synchronously so `playerUpdated` lands in
 * the same frame the client saw the mob die.
 */
export type KillTiming = 'deferred' | 'sync-snapshot';

export interface ProjectileCollisionDeps {
    /**
     * `getPetalStats(type, rarity).damage`, or undefined when the petal is
     * unknown.
     *
     * Three of the four paths re-look this up on impact instead of trusting the
     * damage stamped at spawn, and the fallbacks differ (`stats ? stats.damage :
     * projectile.damage`). That is preserved verbatim: unifying them changes
     * damage for any petal whose stats were edited mid-flight.
     */
    petalDamageOf(petalTypeName: string, rarityIndex: number): number | undefined;
    /** `getMobStats(...).mass`, for knockback resistance. */
    massOf(mob: Entity): number | undefined;
    /**
     * A player's hit radius, live.
     *
     * NOT read from C.Radius: importPlayer bakes that from `sizeMultiplier` ONCE
     * and nothing refreshes it, so a player who equips a size-changing petal
     * would keep the radius they joined with. The legacy loop read
     * `(PLAYER_SIZE / 2) * player.sizeMultiplier` fresh on every test, so this
     * hook does too.
     */
    playerRadiusOf(player: Entity): number;
    /**
     * `getDamageMultiplier(player)`, or undefined when the shooter is no longer
     * a live player.
     *
     * Undefined reproduces the legacy `if (!players[projectile.playerId])`
     * branch: the projectile is consumed and deals nothing.
     */
    damageMultiplierOf(player: Entity): number | undefined;
    /**
     * A mob projectile connected with a player.
     *
     * The knockback is passed OUT rather than written to C.Position, because
     * syncToEcs pushes each player's legacy position INTO the ECS every tick —
     * an ECS-side write would be overwritten before it could ever be broadcast.
     * The hook is also what emits `playerDamaged`, applies glitch infection and
     * runs the death path, none of which is ported.
     *
     * `sourceTypeName` is the mob type stamped on the projectile AT SPAWN, which
     * is the only reason it survives: the shooter is frequently dead and
     * despawned by the time the shot lands.
     *
     * Returns whether the player is STILL ALIVE. The legacy loop tested
     * `player.isDead` on the live object at the top of every candidate, so a
     * player killed by the first projectile of a volley was skipped by the rest
     * of it; the IsDead tag only catches up on the next syncToEcs, so the
     * answer has to come back out of the hook.
     */
    onPlayerHit(
        player: Entity,
        damage: number,
        knockbackX: number,
        knockbackY: number,
        sourceTypeName: string,
    ): boolean;
    /**
     * Credit `amount` on `victim` to `playerEntity`, for XP and drop
     * attribution. Pet damage is credited to the pet's OWNER, since contributors
     * are keyed by player.
     */
    creditDamage(victim: Entity, playerEntity: Entity, amount: number): void;
    /**
     * Emit `enemyDamaged` for this victim IMMEDIATELY.
     *
     * The pet-projectile path emitted per-hit rather than going through the
     * end-of-frame batch, and that difference is preserved rather than tidied:
     * the batch collapses several hits on one mob into a single health value,
     * which changes what a client renders when a pet volley lands.
     */
    emitEnemyDamaged(victim: Entity, health: number): void;
    /** Queue the victim into this tick's BATCHED damage broadcast. */
    markEnemyDamaged(victim: Entity): void;
    /** The victim died: XP, drops, boss message, enemyDestroyed. */
    onProjectileKill(victim: Entity, killer: Entity, timing: KillTiming): void;
}

export interface ProjectileCollisionQueries {
    /** Mob-fired projectiles. */
    mobProjectiles: Query;
    /** Player-fired projectiles. */
    playerProjectiles: Query;
    /**
     * Live, in-world players.
     *
     * Scanned linearly exactly as the legacy `Object.values(players)` loop was.
     * A grid would be strictly worse here: player counts are in the dozens and
     * the shared grid holds mobs, not players.
     */
    players: Query;
}

export function createProjectileCollisionQueries(world: World): ProjectileCollisionQueries {
    return {
        mobProjectiles: world.query(
            [C.Position, C.Radius, C.Health, C.Damage, C.Projectile, C.ProjectileOrigin],
            [C.FromPlayer, C.IsDead],
        ),
        playerProjectiles: world.query(
            [C.Position, C.Radius, C.Health, C.Damage, C.Projectile, C.ProjectileOrigin, C.FromPlayer],
            [C.IsDead],
        ),
        players: world.query([C.Position, C.IsPlayer], [C.IsDead, C.IsLobby]),
    };
}

/** One projectile's per-tick record, pooled so a steady tick allocates nothing. */
interface ProjEntry {
    entity: Entity;
    x: number;
    y: number;
    radius: number;
    /** Damage stamped at spawn. Used directly by two of the four paths. */
    damage: number;
    health: number;
    petalType: number;
    petalRarity: number;
    distance: number;
    maxDistance: number;
    shooter: Entity;
    sourceType: number;
    /** Set when an earlier pass has claimed this projectile (the old splice). */
    consumed: boolean;
}

/** One player's per-tick record. */
interface PlayerEntry {
    entity: Entity;
    x: number;
    y: number;
    radius: number;
    /** Killed earlier in THIS pass; later projectiles must not hit them again. */
    dead: boolean;
}

function makeProjEntry(): ProjEntry {
    return {
        entity: NULL_ENTITY, x: 0, y: 0, radius: 0, damage: 0, health: 0,
        petalType: 0, petalRarity: 0, distance: 0, maxDistance: 0,
        shooter: NULL_ENTITY, sourceType: 0, consumed: false,
    };
}

/** Sentinel `sourceType` meaning "no mob type was stamped" (see prefabs.ts). */
const NO_SOURCE_TYPE = 0xffff;

export function projectileCollisionSystem(
    queries: ProjectileCollisionQueries,
    grid: SpatialGrid,
    gridResult: GridQueryResult,
    deps: ProjectileCollisionDeps,
) {
    const {
        petalDamageOf, massOf, playerRadiusOf, damageMultiplierOf,
        onPlayerHit, creditDamage, emitEnemyDamaged, markEnemyDamaged, onProjectileKill,
    } = deps;

    // Pools, reused across ticks.
    const mobPool: ProjEntry[] = [];
    const playerPool: ProjEntry[] = [];
    const playerEntries: PlayerEntry[] = [];
    let mobCount = 0;
    let playerProjCount = 0;
    let playerCount = 0;

    /** Gather one projectile query into a pool, returning how many were written. */
    function gather(query: Query, pool: ProjEntry[]): number {
        let n = 0;
        query.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const rad = chunk.cols(C.Radius);
            const hp = chunk.cols(C.Health);
            const dmg = chunk.cols(C.Damage);
            const proj = chunk.cols(C.Projectile);
            const origin = chunk.cols(C.ProjectileOrigin);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                let entry = pool[n];
                if (entry === undefined) {
                    entry = makeProjEntry();
                    pool[n] = entry;
                }
                entry.entity = entities[i] as Entity;
                entry.x = pos.x[i];
                entry.y = pos.y[i];
                entry.radius = rad.value[i];
                entry.damage = dmg.value[i];
                entry.health = hp.current[i];
                entry.petalType = proj.petalType[i];
                entry.petalRarity = proj.petalRarity[i];
                entry.distance = proj.distance[i];
                entry.maxDistance = proj.maxDistance[i];
                entry.shooter = origin.shooter[i] as Entity;
                entry.sourceType = origin.sourceType[i];
                entry.consumed = false;
                n++;
            }
        });
        return n;
    }

    /** Damage re-looked-up from the petal table, falling back to the stamp. */
    function lookedUpDamage(entry: ProjEntry): number {
        const stats = petalDamageOf(petalTypes.nameOf(entry.petalType), entry.petalRarity);
        return stats === undefined ? entry.damage : stats;
    }

    /**
     * Apply a projectile hit to a mob: health, knockback, attribution, death.
     *
     * Shared by the pet-projectile and player-projectile paths because the two
     * legacy blocks were line-for-line identical apart from the damage source,
     * the broadcast style and the kill timing — all three of which are
     * parameters here rather than duplicated code.
     */
    function damageMob(
        world: World,
        victim: Entity,
        amount: number,
        dx: number,
        dy: number,
        distance: number,
        killer: Entity,
        timing: KillTiming,
        immediateBroadcast: boolean,
    ): void {
        const current = world.get(victim, C.Health, 'current') as number;
        const next = Math.max(0, current - amount);
        world.set(victim, C.Health, 'current', next);

        if (immediateBroadcast) emitEnemyDamaged(victim, next);
        else markEnemyDamaged(victim);

        // Knockback is SET, not accumulated: a burst volley must not launch a
        // mob. Dividing by mass is what makes heavy (and therefore high-rarity)
        // mobs resist it. The `distance > 0` guard is what stops a
        // divide-by-zero producing a NaN position.
        if (distance > 0) {
            const mass = massOf(victim) ?? DEFAULT_MOB_MASS;
            const effective = MOB_KNOCKBACK_FORCE / mass;
            const kx = (dx / distance) * effective;
            const ky = (dy / distance) * effective;
            if (world.has(victim, C.Knockback)) {
                world.write(victim, C.Knockback, { x: kx, y: ky });
            } else {
                // Structural, but nothing is iterating a query here — the passes
                // walk the pooled arrays, not the world.
                world.add(victim, C.Knockback, { x: kx, y: ky });
            }
        }

        if (next <= 0) {
            // IsDead is what makes every later pass this tick skip the victim,
            // standing in for the legacy `enemies.splice` that killEnemy does.
            world.add(victim, C.IsDead);
            onProjectileKill(victim, killer, timing);
        }
    }

    return (ctx: SystemContext): void => {
        const world = ctx.world;
        const cmd = ctx.cmd;

        mobCount = gather(queries.mobProjectiles, mobPool);
        playerProjCount = gather(queries.playerProjectiles, playerPool);

        // --- players ---------------------------------------------------------
        playerCount = 0;
        if (mobCount > 0) {
            queries.players.chunks(chunk => {
                const pos = chunk.cols(C.Position);
                const entities = chunk.entities;
                for (let i = 0; i < chunk.count; i++) {
                    const entity = entities[i] as Entity;
                    let entry = playerEntries[playerCount];
                    if (entry === undefined) {
                        entry = { entity, x: 0, y: 0, radius: 0, dead: false };
                        playerEntries[playerCount] = entry;
                    }
                    entry.entity = entity;
                    entry.x = pos.x[i];
                    entry.y = pos.y[i];
                    entry.radius = playerRadiusOf(entity);
                    entry.dead = false;
                    playerCount++;
                }
            });
        }

        // =====================================================================
        // 1 & 2 — mob projectiles
        // =====================================================================
        for (let i = 0; i < mobCount; i++) {
            const p = mobPool[i];
            if (p.consumed) continue;

            // Pet-ness is resolved LIVE from the shooter, not stamped at spawn.
            // The legacy code did `enemyById.get(projectile.enemyId)` and treated
            // a missing shooter as "not a pet", so a dead pet's in-flight shots
            // START HITTING PLAYERS. That reads like a bug and is very tempting
            // to fix while porting — it is long-standing behaviour, and stamping
            // ownership at spawn would change it.
            const shooterAlive = world.isAlive(p.shooter);
            const isPet = shooterAlive && world.has(p.shooter, C.PetOwner);

            if (!isPet) {
                for (let j = 0; j < playerCount; j++) {
                    const target = playerEntries[j];
                    if (target.dead) continue;
                    const dx = target.x - p.x;
                    const dy = target.y - p.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (!(distance < target.radius + p.radius)) continue;

                    let knockbackX = 0;
                    let knockbackY = 0;
                    if (distance > 0) {
                        knockbackX = (dx / distance) * PLAYER_KNOCKBACK_FORCE;
                        knockbackY = (dy / distance) * PLAYER_KNOCKBACK_FORCE;
                    }

                    const stillAlive = onPlayerHit(
                        target.entity,
                        // The player path uses the STAMPED damage, unlike the
                        // three paths that re-look it up. Preserved as-is.
                        p.damage,
                        knockbackX,
                        knockbackY,
                        p.sourceType === NO_SOURCE_TYPE ? '' : mobTypes.nameOf(p.sourceType),
                    );
                    if (!stillAlive) target.dead = true;

                    p.consumed = true;
                    cmd.destroy(p.entity);
                    // One projectile hits ONE player, even when several are stacked.
                    break;
                }
            } else {
                const owner = world.get(p.shooter, C.PetOwner, 'owner') as Entity;

                // The shared grid already excludes pets and the dead, which is
                // exactly the legacy `targetEnemy.ownerId` filter, so the only
                // extra exclusion needed is the shooter itself. Queried with the
                // projectile's OWN radius: the grid uses fat insertion, so each
                // mob is already indexed by its own size.
                grid.query(p.x, p.y, p.radius, gridResult);

                for (let k = 0; k < gridResult.count; k++) {
                    const victim = gridResult.entity(k);
                    if (victim === p.shooter) continue;
                    if (!world.isAlive(victim)) continue;

                    const dx = gridResult.x[k] - p.x;
                    const dy = gridResult.y[k] - p.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (!(distance < gridResult.radius[k] + p.radius)) continue;

                    const amount = lookedUpDamage(p);

                    // Damage is credited even to an already-dead mob, matching
                    // the legacy order (trackDamage before the isDead test).
                    if (owner !== NULL_ENTITY && world.isAlive(owner)) {
                        creditDamage(victim, owner, amount);
                    }

                    if (world.has(victim, C.IsDead)) {
                        // Already dying: the shot is spent, nothing more applies.
                        p.consumed = true;
                        cmd.destroy(p.entity);
                        break;
                    }

                    damageMob(world, victim, amount, dx, dy, distance, owner, 'deferred', true);

                    p.consumed = true;
                    cmd.destroy(p.entity);
                    break;
                }
            }
        }

        // =====================================================================
        // 3 — player projectile vs mob projectile (the only proj-vs-proj rule)
        // =====================================================================
        for (let i = 0; i < playerProjCount; i++) {
            const p = playerPool[i];
            if (p.consumed) continue;

            for (let j = 0; j < mobCount; j++) {
                const m = mobPool[j];
                if (m.consumed || m.health <= 0) continue;

                const dx = m.x - p.x;
                const dy = m.y - p.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                // `distance > 0` is load-bearing: exactly coincident projectiles
                // pass through each other rather than producing a zero-length
                // normal for anything downstream to divide by.
                if (!(distance < p.radius + m.radius && distance > 0)) continue;

                // Both sides re-look their damage up from the petal table.
                const playerDamage = lookedUpDamage(p);
                const mobDamage = lookedUpDamage(m);

                p.health -= mobDamage;
                m.health -= playerDamage;
                world.set(p.entity, C.Health, 'current', p.health);
                world.set(m.entity, C.Health, 'current', m.health);

                if (p.health <= 0) {
                    p.consumed = true;
                    cmd.destroy(p.entity);
                    break;
                }
                if (m.health <= 0) {
                    m.consumed = true;
                    cmd.destroy(m.entity);
                }
            }

            if (p.consumed || p.health <= 0) continue;

            // =================================================================
            // 4 — player projectile vs mob
            // =================================================================
            grid.query(p.x, p.y, p.radius, gridResult);

            for (let k = 0; k < gridResult.count; k++) {
                const victim = gridResult.entity(k);
                if (!world.isAlive(victim)) continue;

                const dx = gridResult.x[k] - p.x;
                const dy = gridResult.y[k] - p.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (!(distance < gridResult.radius[k] + p.radius)) continue;

                // The shooter may have disconnected mid-flight. Legacy dropped
                // the projectile on the spot rather than guessing a multiplier.
                const multiplier = damageMultiplierOf(p.shooter);
                if (multiplier === undefined) {
                    p.consumed = true;
                    cmd.destroy(p.entity);
                    break;
                }

                // This path uses the STAMPED damage times the player's
                // multiplier — note the pet path above applies no multiplier at
                // all. Both are long-standing and deliberately not unified.
                const amount = p.damage * multiplier;
                creditDamage(victim, p.shooter, amount);

                // An already-dying mob absorbs the attribution but NOT the shot:
                // the projectile keeps looking for another target. (The pet path
                // above consumes it instead — the two loops really did differ.)
                if (world.has(victim, C.IsDead)) continue;

                damageMob(
                    world, victim, amount, dx, dy, distance,
                    p.shooter, 'sync-snapshot', false,
                );

                p.consumed = true;
                cmd.destroy(p.entity);
                break;
            }
        }

        // =====================================================================
        // Mob-projectile max-distance sweep — LAST, on purpose
        // =====================================================================
        // updateMobProjectiles tested range AFTER its hit tests, so a mob shot
        // that reaches its maximum range on the same tick it reaches a player
        // still lands. (The player-projectile rule is the opposite and lives in
        // projectileFlightSystem.) Retiring these here is what preserves it.
        for (let i = 0; i < mobCount; i++) {
            const p = mobPool[i];
            if (p.consumed) continue;
            if (p.distance >= p.maxDistance) {
                p.consumed = true;
                cmd.destroy(p.entity);
            }
        }

        // Drop the entity references so a destroyed projectile's handle is not
        // pinned in the pool until the next tick overwrites it.
        for (let i = 0; i < mobCount; i++) mobPool[i].shooter = NULL_ENTITY;
        for (let i = 0; i < playerProjCount; i++) playerPool[i].shooter = NULL_ENTITY;
        for (let i = 0; i < playerCount; i++) playerEntries[i].entity = NULL_ENTITY;
    };
}

export function registerProjectileCollisionSystem(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: ProjectileCollisionQueries,
    grid: SpatialGrid,
    gridResult: GridQueryResult,
    deps: ProjectileCollisionDeps,
): void {
    // Combat phase: after flight has moved everything this tick, and before the
    // Lifetime reaper, so anything killed here is still readable by later passes.
    scheduler.add(
        'projectileCollision',
        Phase.Combat,
        projectileCollisionSystem(queries, grid, gridResult, deps),
    );
}

