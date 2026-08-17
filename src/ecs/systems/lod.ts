/**
 * Distance-based level of detail for mob simulation.
 *
 * ---------------------------------------------------------------------------
 * Why
 * ---------------------------------------------------------------------------
 * The world holds far more mobs than anyone can see. A production sample taken
 * 2026-08-15 (16 players) reported `46/2107 enemies in viewport` — 2% of the
 * population was observable, and the other 98% was still paying full price
 * every tick: target acquisition with line-of-sight raycasts, wander steps,
 * wall resolution, and a slot in the mob-vs-mob collision broad phase. That
 * bill was the single largest item in the tick, and none of it reached a
 * client.
 *
 * So mobs beyond `MOB_ACTIVE_RADIUS` of every player run their AI and collide
 * once every `MOB_FAR_STRIDE` ticks instead of every tick. They are not frozen
 * and not skipped — they simulate at a fifth of the rate, which is to say they
 * drift at a fifth of their speed while nobody is near enough to tell.
 *
 * ---------------------------------------------------------------------------
 * What this costs
 * ---------------------------------------------------------------------------
 * Honestly: a distant mob moves slower than it otherwise would, and a distant
 * mob-vs-mob shove can be missed. Both are unobservable by construction —
 * `MOB_ACTIVE_RADIUS` is set well beyond the furthest thing the broadcast will
 * put on the wire — and both self-correct the moment a player comes near,
 * without a snap: crossing the boundary just restores the full rate, it does
 * not replay the missed ticks.
 *
 * The one thing it must NOT do is change what a player experiences, which is
 * why the radius has so much margin over the cull distance (see below) and why
 * the stride is offset per mob rather than global — a global stride would step
 * every distant mob on the same tick and simply move the spike rather than
 * remove it.
 */

import * as C from '../components';
import { Entity, entityIndex } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/**
 * How close a player must be for a mob to simulate at full rate, in pixels.
 *
 * The budget this has to clear: `collectEnemyDeltas` culls to a box of 200%
 * the client's viewport, i.e. ±1920px horizontally for the default 1920×1080,
 * and `isPositionNearAnyPlayer` keeps mobs alive within half a viewport plus a
 * 500px buffer. 5000 is comfortably outside both, with room for a player
 * sprinting toward a distant mob: closing the ~3000px of slack takes dozens of
 * ticks even at the clamped maximum speed, and the mob returns to full rate as
 * soon as it is crossed.
 */
export const MOB_ACTIVE_RADIUS = 5000;

/** Squared, because every comparison against it is on squared distance. */
const MOB_ACTIVE_RADIUS_SQ = MOB_ACTIVE_RADIUS * MOB_ACTIVE_RADIUS;

/**
 * A distant mob simulates one tick in this many.
 *
 * 5 matches the existing strided passes (viewport status, unseen despawn), so
 * the server has one stride length rather than three.
 */
export const MOB_FAR_STRIDE = 5;

/**
 * Where the players are this tick, as a flat [x, y, ...] list.
 *
 * A flat number array rather than objects because the whole point is to test
 * it once per mob per tick — a few thousand times — and object field loads off
 * a heterogeneous array were exactly the megamorphic-access cost the July 2026
 * pass removed from the enemy loop.
 *
 * `empty` is the permissive case: with nobody connected, everything counts as
 * active, matching `isPositionNearAnyPlayer`'s default. It costs nothing —
 * with no players the tick early-returns anyway — and it means a test or bench
 * that forgets to add players sees unmodified behaviour rather than a world
 * running at a fifth speed.
 */
export class MobActivityField {
    private readonly coords: number[] = [];
    private empty = true;

    /** Drop last tick's players. */
    clear(): void {
        this.coords.length = 0;
        this.empty = true;
    }

    /** Record a player position for this tick. */
    add(x: number, y: number): void {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        this.coords.push(x, y);
        this.empty = false;
    }

    /** Whether a mob at (x, y) is close enough to any player to run full rate. */
    isActive(x: number, y: number): boolean {
        if (this.empty) return true;
        const coords = this.coords;
        for (let i = 0; i < coords.length; i += 2) {
            const dx = x - coords[i];
            const dy = y - coords[i + 1];
            if (dx * dx + dy * dy <= MOB_ACTIVE_RADIUS_SQ) return true;
        }
        return false;
    }

    /**
     * Whether a mob at (x, y) should simulate on this tick.
     *
     * Distant mobs are spread across the stride by entity slot, so the skipped
     * work is spread evenly over ticks instead of all landing on one.
     */
    shouldStep(mob: Entity, x: number, y: number, tick: number): boolean {
        if (this.isActive(x, y)) return true;
        return (tick + entityIndex(mob)) % MOB_FAR_STRIDE === 0;
    }
}

export interface MobActivityQueries {
    /** Every live player, INCLUDING bots — a bot fighting mobs is a real observer. */
    players: Query;
}

export function createMobActivityQueries(world: World): MobActivityQueries {
    return {
        // No IsDead exclusion: a dead player is about to respawn where they
        // stand, and letting the mobs around them coast for those few ticks is
        // exactly the kind of visible artefact this is supposed to avoid.
        players: world.query([C.Position, C.IsPlayer]),
    };
}

export function mobActivitySystem(field: MobActivityField, queries: MobActivityQueries) {
    return (_ctx: SystemContext): void => {
        field.clear();
        queries.players.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            for (let i = 0; i < chunk.count; i++) field.add(pos.x[i], pos.y[i]);
        });
    };
}

export function registerMobActivitySystem(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    field: MobActivityField,
    queries: MobActivityQueries,
): void {
    // SpatialIndex: this is an acceleration structure like the grid, and every
    // consumer of it runs in Input or later.
    scheduler.add('mobActivity', Phase.SpatialIndex, mobActivitySystem(field, queries));
}
