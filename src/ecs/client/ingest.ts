/**
 * Wire -> client world ingestion. The ECS port of net/enemyIngest.ts.
 *
 * Both enemy delivery paths — the bulk `enemySpawned` payload and the per-tick
 * delta decoder — funnel through here, because they must treat a
 * mid-death-animation entity identically: updating or deleting one out from
 * under its animation makes mobs blink out instead of playing their death pop.
 *
 * ---------------------------------------------------------------------------
 * TWO CLOCKS, AND WHY THEY DO NOT MIX
 * ---------------------------------------------------------------------------
 * `now` is the WORLD clock (`Date.now()` on the client). Death animations are
 * stamped and compared against it, and the renderer compares them against its
 * own `Date.now()` frame timestamp, so both sides agree.
 *
 * `snapTime` is the SNAPSHOT clock: `performance.now()`, or the server tick
 * timestamp mapped into that domain (see handlers/gameState.ts). It is only
 * ever compared against other snapshot samples, never against `now`. The two
 * differ by the page-load epoch — about 1.7e12 ms — so feeding one where the
 * other is expected produces animations that never start or entities that are
 * never reaped. That is why `snapTime` is a required parameter rather than
 * defaulting to `now`: a missing argument is a compile error, not a silent
 * 1.7e12 ms jump.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { World } from '../world';
import {
    DpsLabel,
    InterpTarget,
    IsPlayerRender,
    LegacyPlayer,
    MobRender,
    NeedsSnap,
    pushSnapshot,
    RendersAsPet,
    RenderEye,
    RenderRef,
    SnapshotBuffer,
} from './components';
import { mobTypes, rarityToId } from '../interning';

/** Must match the death-pop duration the renderer draws. */
export const DEATH_ANIMATION_DURATION_MS = 200;

/**
 * `MobRender.aiType` when the server has never said. Distinct from
 * `AiType.Passive` (0) so "unknown" cannot accidentally read as a real value.
 */
export const AI_TYPE_UNKNOWN = 255;

/**
 * Players and mobs share ONE external-id namespace in a single World, and mob
 * ids come from a server-side generator while player ids are socket ids. A
 * collision would silently alias a flower to a mob, so every key is built here
 * and nowhere else.
 */
export function playerKey(id: string): string {
    return `p:${id}`;
}

export function enemyKey(id: string): string {
    return `e:${id}`;
}

/**
 * Called with the entity's UNPREFIXED id just before it leaves the world.
 *
 * The graphics layer keeps several id-keyed Maps outside the ECS (accumulated
 * damage, damage-text throttles, invulnerability fades, petal physics). The
 * World clears its own reference columns on destroy, but nothing clears those —
 * and before this hook existed the death-animation reap path never did, so
 * every mob that died leaked two entries.
 */
export interface ClientReaper {
    enemyGone(id: string): void;
    playerGone(id: string): void;
}

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
    /** Full payloads only — see MobRender. */
    aiType?: string;
    isChasing?: boolean;
    reversed?: boolean;
    /**
     * Drawn through the flower path (the digger, petal-ring mobs) and therefore
     * needing eye state. Decided by the caller, which can read mob_configs;
     * src/ecs must not import it.
     */
    rendersAsFlower?: boolean;
}

/** One player record, reduced to what the client world owns. */
export interface PlayerUpdate {
    id: string;
    x: number;
    y: number;
    angle?: number;
}

const AI_TYPE_IDS: Record<string, number> = {
    passive: 0,
    neutral: 1,
    hostile: 2,
    sandstorm: 3,
};

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
    snapTime: number,
): Entity | undefined {
    const key = enemyKey(update.id);
    const existing = world.lookup(key);

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
            snapTime,
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
        // Only the full payloads carry these. The delta stream leaves them
        // alone, exactly as the legacy merge did — a mob keeps whatever its
        // spawn payload said.
        writeMobRender(world, existing, update);
        return existing;
    }

    const entity = world.create();
    world.bindExternalId(entity, key);
    world.add(entity, C.Position, { x: update.x, y: update.y });
    world.add(entity, C.Angle, { value: update.angle });
    world.add(entity, C.Health, { current: update.health, max: update.maxHealth });
    world.add(entity, C.MobKind, {
        type: mobTypes.intern(update.type ?? 'bee'),
        tier: rarityToId(update.tier ?? 'common'),
    });
    // First appearance: draw where the server says, with no easing.
    world.add(entity, InterpTarget, { x: update.x, y: update.y, angle: update.angle });
    world.add(entity, MobRender, { aiType: AI_TYPE_UNKNOWN, chasing: 0, flipped: 0 });
    world.add(entity, C.IsEnemy);
    if (update.rendersAsFlower) world.add(entity, RenderEye, { x: 0, y: 0, init: 0 });
    writeMobRender(world, entity, update);

    // The two delivery paths disagree on how they mark a pet; normalise to one
    // tag so the renderer reads a single thing.
    if (update.ownerId !== undefined || update.isPet) {
        world.add(entity, RendersAsPet);
    }
    return entity;
}

function writeMobRender(world: World, entity: Entity, update: EnemyUpdate): void {
    if (update.aiType !== undefined) {
        const id = AI_TYPE_IDS[update.aiType];
        world.set(entity, MobRender, 'aiType', id === undefined ? AI_TYPE_UNKNOWN : id);
    }
    if (update.isChasing !== undefined) {
        world.set(entity, MobRender, 'chasing', update.isChasing ? 1 : 0);
    }
    if (update.reversed !== undefined) {
        world.set(entity, MobRender, 'flipped', update.reversed ? 1 : 0);
    }
}

/** Record a target dummy's measured DPS for its health-bar label. */
export function setMobDps(world: World, id: string, dps: number): void {
    const entity = world.lookup(enemyKey(id));
    if (entity === undefined) return;
    if (!world.has(entity, DpsLabel)) world.add(entity, DpsLabel, { value: dps });
    else world.set(entity, DpsLabel, 'value', dps);
}

/** Overwrite a mob's current health (the `enemyDamaged` batch). */
export function setMobHealth(world: World, id: string, health: number): number | undefined {
    const entity = world.lookup(enemyKey(id));
    if (entity === undefined) return undefined;
    const before = world.get(entity, C.Health, 'current') as number;
    world.set(entity, C.Health, 'current', health);
    return before;
}

/**
 * Remove an entity the server says is gone.
 *
 * Refuses while a death animation is playing, so the pop finishes. The caller
 * is expected to re-issue removal (or let the animation system reap it) rather
 * than assume this succeeded.
 */
export function forgetEnemy(world: World, id: string, now: number, reaper?: ClientReaper): boolean {
    const entity = world.lookup(enemyKey(id));
    if (entity === undefined) {
        reaper?.enemyGone(id);
        return true;
    }
    if (isAnimatingDeath(world, entity, now)) return false;
    reaper?.enemyGone(id);
    world.destroy(entity);
    return true;
}

/**
 * Begin the death animation instead of removing outright.
 *
 * The entity stays in the world, still rendered, until the animation system
 * retires it.
 */
export function beginDeathAnimation(world: World, id: string, now: number): boolean {
    const entity = world.lookup(enemyKey(id));
    if (entity === undefined) return false;
    if (world.has(entity, C.DeathAnimation)) return false;
    world.add(entity, C.DeathAnimation, { startTime: now });
    return true;
}

/**
 * Apply a server player record, creating the flower on first sight.
 *
 * Players deliberately get NO SnapshotBuffer. Every flower, local and remote,
 * eases toward its target at the same rate so the local player's motion and a
 * remote player's motion look identical; buffered playback would put remote
 * flowers ~80ms behind the one you are driving, which reads as "other players
 * move differently". That is a bug this client has already had once, and the
 * shape of it is subtle — `applyEnemyUpdate` ADDS SnapshotBuffer on every
 * update, so routing players through it would silently migrate them from the
 * eased archetype to the buffered one. Hence a separate function, and a
 * self-test asserting a player entity never lands in the buffered query.
 *
 * `legacyRef` is the plain `Player` object carrying everything this layer does
 * not own; it is required on creation and ignored afterwards.
 */
export function applyPlayerUpdate(
    world: World,
    update: PlayerUpdate,
    legacyRef?: unknown,
): Entity | undefined {
    const key = playerKey(update.id);
    const existing = world.lookup(key);

    if (existing !== undefined) {
        world.write(existing, InterpTarget, { x: update.x, y: update.y });
        if (update.angle !== undefined) {
            // Flower facing is NOT interpolated: it comes straight off the wire
            // and drives the eye direction, which must not lag the body.
            world.set(existing, C.Angle, 'value', update.angle);
        }
        return existing;
    }

    if (legacyRef === undefined) return undefined;

    const entity = world.create();
    world.bindExternalId(entity, key);
    world.add(entity, C.Position, { x: update.x, y: update.y });
    world.add(entity, C.Angle, { value: update.angle ?? 0 });
    world.add(entity, InterpTarget, { x: update.x, y: update.y, angle: update.angle ?? 0 });
    world.add(entity, RenderRef, { x: update.x, y: update.y });
    world.add(entity, RenderEye, { x: 0, y: 0, init: 0 });
    world.add(entity, LegacyPlayer, { ref: legacyRef });
    world.add(entity, IsPlayerRender);
    return entity;
}

/** Cut this flower onto its target on the next tick instead of easing to it. */
export function snapPlayer(world: World, id: string): void {
    const entity = world.lookup(playerKey(id));
    if (entity === undefined) return;
    if (!world.has(entity, NeedsSnap)) world.add(entity, NeedsSnap);
}

/** Drop a flower the server says is gone. */
export function forgetPlayer(world: World, id: string, reaper?: ClientReaper): void {
    const entity = world.lookup(playerKey(id));
    reaper?.playerGone(id);
    if (entity === undefined) return;
    world.destroy(entity);
}

/** The `Player` object behind a flower entity, or undefined if it has none. */
export function playerRefOf(world: World, entity: Entity): unknown {
    if (!world.has(entity, LegacyPlayer)) return undefined;
    return world.get(entity, LegacyPlayer, 'ref');
}

/** Look up a flower's `Player` object by socket id. */
export function findPlayerRef(world: World, id: string): unknown {
    const entity = world.lookup(playerKey(id));
    if (entity === undefined) return undefined;
    return playerRefOf(world, entity);
}
