/**
 * Ground effects: pollen puffs and web fields, as entities.
 *
 * Replaces the two bespoke arrays + tick loops in server.ts
 * (`updateGroundPollens`, `updateWebFields`). Each effect is an entity built by
 * the prefabs in `../prefabs` — Position, Radius, its marker component, and an
 * `Expires` deadline — and the two systems here do per-tick what the legacy
 * loops did:
 *
 *   pollen   chip-damages every wild mob overlapping it, at most once per
 *            victim per GROUND_POLLEN_DAMAGE_INTERVAL_MS, credited to the
 *            owning player; a victim that reaches zero goes through the
 *            injected kill hook (XP, drops and the wire stay legacy).
 *   web      refreshes a short timed slow on everything standing in it, via
 *            the injected hook (the rarity contest against the mob's tier is
 *            config knowledge, so it runs in the composition root).
 *
 * Expiry is handled HERE rather than by the generic `expiry` sweep, because an
 * expiring effect has to tell clients (`groundPollenRemoved` / `webRemoved`),
 * and the sweep destroys silently. The generic sweep is disabled while legacy
 * owns timers anyway (see LEGACY_OWNED_SYSTEMS); if it is ever enabled, these
 * systems still win the race only because they run and destroy first within
 * the tick their deadline passes — so keep them registered ahead of it.
 *
 * Broad phase is the shared SpatialGrid, which already excludes pets and the
 * dead — the same filter the legacy pollen loop applied by hand. The grid is
 * rebuilt at the top of `tickProjectiles`; the caller ticks this scheduler
 * immediately after it, so the positions are this tick's.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';
import { GridQueryResult, SpatialGrid } from '../spatial/grid';

/** A mob standing on a pollen puff takes chip damage at most this often. */
export const GROUND_POLLEN_DAMAGE_INTERVAL_MS = 500;

/** gardn: Collision.cc clamps speed_ratio of anything overlapping a web to 0.5. */
export const WEB_SLOW_FACTOR = 0.5;

/**
 * gardn re-evaluates the overlap every tick and resets speed_ratio afterwards.
 * Here the slow is a short timed one that the field keeps refreshing, so a mob
 * walking out of a web is back to full speed within this long.
 */
export const WEB_SLOW_LINGER_MS = 250;

export type GroundEffectKind = 'pollen' | 'web';

export interface GroundEffectQueries {
    pollens: Query;
    webs: Query;
}

export function createGroundEffectQueries(world: World): GroundEffectQueries {
    return {
        pollens: world.query([C.Position, C.Radius, C.GroundPollen, C.Expires]),
        webs: world.query([C.Position, C.Radius, C.WebField, C.Expires]),
    };
}

/**
 * Everything the systems need from the legacy side.
 *
 * Injected, never imported: XP, drops, damage attribution, the slow's rarity
 * resistance and every wire emit are legacy-owned, and importing them would
 * drag server.ts into the ECS typecheck (and boot a server in the harness).
 */
export interface GroundEffectDeps {
    /** `getDamageMultiplier(owner)`, or undefined when the player is gone. */
    damageMultiplierOf(owner: Entity): number | undefined;
    /** Attribute pollen damage to the owning player (legacy trackDamage). */
    creditDamage(victim: Entity, owner: Entity, amount: number): void;
    /** Queue the victim into this tick's batched `enemiesDamaged`. */
    markEnemyDamaged(victim: Entity): void;
    /** The victim died: run the legacy kill sequence crediting `killer`. */
    onKill(victim: Entity, killer: Entity): void;
    /**
     * Slow the victim. The rarity-resistance contest (stallPower) is config
     * knowledge, so it runs in the composition root; the write itself lands on
     * the ECS Speed/Slowed pair, which owns slows now.
     */
    applySlow(victim: Entity, baseFactor: number, until: number, rarityId: number, now: number): void;
    /** An effect's deadline passed: emit its removal to clients. */
    emitExpired(kind: GroundEffectKind, externalId: string): void;
    /**
     * The radius legacy pollen tested against: the mob's UNSCALED config size
     * (`stats.size * 40 / 2`), not the tier-scaled entity radius. Preserved
     * exactly; the fat-inserted grid radius is >= this for wild mobs, so the
     * broad phase never misses a candidate the old linear scan would have hit.
     */
    pollenTargetRadiusOf(victim: Entity): number;
}

/**
 * Chip-damage pass for pollen puffs.
 *
 * Effect handles are snapshotted before any work: the kill hook reaches legacy
 * code that may create or retire entities, and iterating live chunks across
 * that is how a swap-remove skips a row.
 */
export function groundPollenSystem(
    queries: GroundEffectQueries,
    grid: SpatialGrid,
    gridResult: GridQueryResult,
    deps: GroundEffectDeps,
) {
    const {
        damageMultiplierOf, creditDamage, markEnemyDamaged, onKill,
        emitExpired, pollenTargetRadiusOf,
    } = deps;
    const scratch: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { world, cmd, now } = ctx;

        scratch.length = 0;
        queries.pollens.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) scratch.push(entities[i] as Entity);
        });

        for (let p = 0; p < scratch.length; p++) {
            const pollen = scratch[p];
            if (!world.isAlive(pollen)) continue;

            if (now >= (world.get(pollen, C.Expires, 'at') as number)) {
                const id = world.externalIdOf(pollen);
                if (id) emitExpired('pollen', id);
                cmd.destroy(pollen);
                continue;
            }

            const x = world.get(pollen, C.Position, 'x') as number;
            const y = world.get(pollen, C.Position, 'y') as number;
            const radius = world.get(pollen, C.Radius, 'value') as number;
            const damage = world.get(pollen, C.GroundPollen, 'damage') as number;
            const owner = world.get(pollen, C.GroundPollen, 'owner') as Entity;
            const lastDamageByEnemy =
                world.get(pollen, C.GroundPollen, 'lastDamageByEnemy') as Map<number, number>;

            // Owner gone -> damage still lands, just unattributed and
            // unmultiplied, exactly as the legacy `players[pollen.playerId]`
            // miss behaved.
            const ownerAlive = world.isAlive(owner);
            const multiplier = ownerAlive ? (damageMultiplierOf(owner) ?? 1) : 1;
            const finalDamage = damage * multiplier;

            grid.query(x, y, radius, gridResult);
            for (let i = 0; i < gridResult.count; i++) {
                const victim = gridResult.entity(i);
                if (!world.isAlive(victim)) continue;
                // A mob killed earlier this tick may still be in the grid; its
                // shell has already left `enemies[]`, so skip it the way the
                // legacy scan (which iterated the shells) never saw it.
                const health = world.get(victim, C.Health, 'current') as number;
                if (health <= 0 || world.has(victim, C.IsDead)) continue;

                const dx = gridResult.x[i] - x;
                const dy = gridResult.y[i] - y;
                const minDistance = radius + pollenTargetRadiusOf(victim);
                if (dx * dx + dy * dy >= minDistance * minDistance) continue;

                const last = lastDamageByEnemy.get(victim as number) || 0;
                if (now - last < GROUND_POLLEN_DAMAGE_INTERVAL_MS) continue;
                lastDamageByEnemy.set(victim as number, now);

                if (ownerAlive) creditDamage(victim, owner, finalDamage);
                const next = Math.max(0, health - finalDamage);
                world.set(victim, C.Health, 'current', next);
                markEnemyDamaged(victim);

                if (next <= 0 && !world.has(victim, C.IsDead)) {
                    onKill(victim, owner);
                }
            }
        }
        scratch.length = 0;
    };
}

/** Slow-refresh pass for web fields. */
export function webFieldSystem(
    queries: GroundEffectQueries,
    grid: SpatialGrid,
    gridResult: GridQueryResult,
    deps: GroundEffectDeps,
) {
    const { applySlow, emitExpired } = deps;
    const scratch: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { world, cmd, now } = ctx;

        scratch.length = 0;
        queries.webs.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) scratch.push(entities[i] as Entity);
        });

        for (let w = 0; w < scratch.length; w++) {
            const web = scratch[w];
            if (!world.isAlive(web)) continue;

            if (now >= (world.get(web, C.Expires, 'at') as number)) {
                const id = world.externalIdOf(web);
                if (id) emitExpired('web', id);
                cmd.destroy(web);
                continue;
            }

            const x = world.get(web, C.Position, 'x') as number;
            const y = world.get(web, C.Position, 'y') as number;
            const radius = world.get(web, C.Radius, 'value') as number;
            // The field carries the rarity of the petal that was thrown, so a
            // high-rarity web still bites on mobs that shrug off a common one.
            const rarity = world.get(web, C.WebField, 'rarity') as number;

            grid.query(x, y, radius, gridResult);
            for (let i = 0; i < gridResult.count; i++) {
                const victim = gridResult.entity(i);
                if (!world.isAlive(victim)) continue;
                if ((world.get(victim, C.Health, 'current') as number) <= 0) continue;
                if (world.has(victim, C.IsDead)) continue;

                const dx = gridResult.x[i] - x;
                const dy = gridResult.y[i] - y;
                const reach = radius + gridResult.radius[i];
                if (dx * dx + dy * dy >= reach * reach) continue;

                applySlow(victim, WEB_SLOW_FACTOR, now + WEB_SLOW_LINGER_MS, rarity, now);
            }
        }
        scratch.length = 0;
    };
}

export function registerGroundEffectSystems(
    scheduler: {
        add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown;
    },
    queries: GroundEffectQueries,
    grid: SpatialGrid,
    gridResult: GridQueryResult,
    deps: GroundEffectDeps,
): void {
    scheduler.add('groundPollens', Phase.Combat, groundPollenSystem(queries, grid, gridResult, deps));
    scheduler.add('webFields', Phase.Combat, webFieldSystem(queries, grid, gridResult, deps));
}
