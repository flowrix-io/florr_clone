/**
 * Wire -> client world ingestion. The ECS port of net/enemyIngest.ts.
 *
 * Both delivery paths — the bulk `enemySpawned` payload and the per-tick delta
 * decoder — funnel through here, because they must treat a mid-death-animation
 * entity identically: updating or deleting one out from under its animation
 * makes mobs blink out instead of playing their death pop.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { World } from '../world';
import { InterpTarget, pushSnapshot, RendersAsPet, SnapshotBuffer } from './components';
import { mobTypes, rarityToId } from '../interning';

/** Must match the death-pop duration the renderer draws. */
export const DEATH_ANIMATION_DURATION_MS = 200;

/** One enemy record off the wire, after the codec has expanded it. */
export interface EnemyUpdate {
    id: string;
    x: number;
    y: number;
    angle: number;
    health: number;
    maxHealth: number;
    type?: string;
    tier?: string;
    /** Present on the full spawn payload; the delta stream sets `isPet`. */
    ownerId?: string;
    isPet?: boolean;
}

/**
 * True when the entity is playing its death animation and must be left alone.
 */
function isAnimatingDeath(world: World, entity: Entity, now: number): boolean {
    if (!world.has(entity, C.DeathAnimation)) return false;
    const start = world.get(entity, C.DeathAnimation, 'startTime') as number;
    return now - start < DEATH_ANIMATION_DURATION_MS;
}

/**
 * Apply a server enemy record, creating the entity on first sight.
 *
 * A NEW entity takes the position immediately — interpolating from nowhere
 * would make it fly in from the origin. An EXISTING one only has its
 * interpolation target moved, so the renderer eases rather than snapping at the
 * tick rate.
 */
export function applyEnemyUpdate(
    world: World,
    update: EnemyUpdate,
    now: number,
    snapTimeMs?: number,
): Entity | undefined {
    const existing = world.lookup(update.id);

    if (existing !== undefined) {
        if (isAnimatingDeath(world, existing, now)) return existing;

        world.write(existing, InterpTarget, {
            x: update.x,
            y: update.y,
            angle: update.angle,
        });

        if (!world.has(existing, SnapshotBuffer)) {
            world.add(existing, SnapshotBuffer, { samples: [] });
        }
        pushSnapshot(
            world.get(existing, SnapshotBuffer, 'samples') as never,
            snapTimeMs ?? now,
            update.x,
            update.y,
            update.angle,
        );

        world.write(existing, C.Health, { current: update.health, max: update.maxHealth });
        if (update.type !== undefined) {
            world.set(existing, C.MobKind, 'type', mobTypes.intern(update.type));
        }
        if (update.tier !== undefined) {
            world.set(existing, C.MobKind, 'tier', rarityToId(update.tier));
        }
        return existing;
    }

    const entity = world.create();
    world.bindExternalId(entity, update.id);
    world.add(entity, C.Position, { x: update.x, y: update.y });
    world.add(entity, C.Angle, { value: update.angle });
    world.add(entity, C.Health, { current: update.health, max: update.maxHealth });
    world.add(entity, C.MobKind, {
        type: mobTypes.intern(update.type ?? 'bee'),
        tier: rarityToId(update.tier ?? 'common'),
    });
    // First appearance: draw where the server says, with no easing.
    world.add(entity, InterpTarget, { x: update.x, y: update.y, angle: update.angle });
    world.add(entity, C.IsEnemy);

    // The two delivery paths disagree on how they mark a pet; normalise to one
    // tag so the renderer reads a single thing.
    if (update.ownerId !== undefined || update.isPet) {
        world.add(entity, RendersAsPet);
    }
    return entity;
}

/**
 * Remove an entity the server says is gone.
 *
 * Refuses while a death animation is playing, so the pop finishes. The caller
 * is expected to re-issue removal (or let the animation system reap it) rather
 * than assume this succeeded.
 */
export function forgetEnemy(world: World, id: string, now: number): boolean {
    const entity = world.lookup(id);
    if (entity === undefined) return true;
    if (isAnimatingDeath(world, entity, now)) return false;
    world.destroy(entity);
    return true;
}

/**
 * Begin the death animation instead of removing outright.
 *
 * The entity stays in the world, still rendered, until the animation system
 * retires it.
 */
export function beginDeathAnimation(world: World, id: string, now: number): void {
    const entity = world.lookup(id);
    if (entity === undefined) return;
    if (world.has(entity, C.DeathAnimation)) return;
    world.add(entity, C.DeathAnimation, { startTime: now });
}
