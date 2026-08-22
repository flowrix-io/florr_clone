/**
 * Mob lifetime systems: timed despawn, unseen despawn, and the death reaper.
 *
 * MOB expiry only: the other `Expires` carriers sweep themselves, because each
 * has its own removal emit — ground effects in systems/groundEffects.ts
 * (`groundPollenRemoved`/`webRemoved`) and dropped items in
 * systems/droppedItems.ts (`itemRemoved`). Mob removal itself goes through the
 * injected despawn hook: the legacy shell must leave `enemies[]` and clients
 * must get `enemyDestroyed`, so destroying the entity here alone would be the
 * silent statue bug (see server/enemyRegistry.ts).
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/**
 * How long a mob may go unseen by every player's viewport before it despawns.
 * Matches the existing 30-second threshold in `despawnDistantEnemies`.
 */
export const UNSEEN_DESPAWN_MS = 30_000;

export interface LifetimeQueries {
    expiring: Query;
    viewportTracked: Query;
    dead: Query;
}

export function createLifetimeQueries(world: World): LifetimeQueries {
    return {
        // Mobs only: every other Expires carrier (ground effects, dropped
        // items) sweeps itself, because each has its own removal emit.
        expiring: world.query([C.Expires, C.IsEnemy], [C.IsDead]),
        viewportTracked: world.query([C.ViewportTracked, C.Position], [C.IsDead]),
        // Mobs only, again deliberately: players carry IsDead too, but a dead
        // flower respawns — its entity leaves the world on disconnect, not
        // through the reaper.
        dead: world.query([C.IsDead, C.IsEnemy]),
    };
}

/**
 * What the mob-lifecycle sweeps need from the legacy side, ported from the
 * checks `despawnDistantEnemies` / `reapDeadEnemies` made inline.
 */
export interface UnseenDespawnDeps {
    /**
     * Special mobs (ultra/super/unique/apex tiers) and target dummies never
     * despawn. Tier and type name live in mob config, so the answer is
     * composed outside the ECS.
     */
    neverDespawns(entity: Entity): boolean;
    /**
     * The maze is a bounded, persistently-populated dungeon: while anyone is
     * inside, none of its mobs distance-despawn — otherwise the deep zones
     * would always be empty except a bubble around each player. A protected
     * mob's timer is REFRESHED (the port of `lastViewportCheck = undefined`),
     * so the normal 30s clock restarts once the maze empties.
     */
    isProtectedAt(x: number, y: number): boolean;
    /**
     * Remove the mob. On the live server this splices the legacy shell, runs
     * cleanupEnemy and emits `enemyDestroyed`; the ENTITY is retired by the
     * registry's deferred drain, not here — destroying it inline would leave
     * the shell behind, which is the silent statue bug.
     */
    despawn(entity: Entity): void;
    /**
     * The mob DIED (rather than despawning): run the death sequence — XP to
     * the top damage contributor, drops, kill tracking, the digger roll — and
     * remove it. Must be idempotent: a mob can be marked dead and reaped in
     * the same tick a direct kill path (projectile, pollen) already removed
     * its shell.
     */
    reap(entity: Entity): void;
}

/**
 * Retire mobs whose self-despawn deadline has passed (periodic-spawn escorts,
 * timed pets) — the expiry half of the legacy `updatePeriodicSpawns`.
 *
 * Goes through the same despawn hook as the unseen sweep: removal must splice
 * the legacy shell and emit `enemyDestroyed`, and the entity itself is retired
 * by the registry's deferred drain.
 */
export function mobExpirySystem(queries: LifetimeQueries, deps: UnseenDespawnDeps) {
    const { despawn } = deps;
    const victims: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { now } = ctx;

        victims.length = 0;
        queries.expiring.chunks(chunk => {
            const expires = chunk.cols(C.Expires);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (now >= expires.at[i]) victims.push(entities[i] as Entity);
            }
        });

        for (let i = 0; i < victims.length; i++) despawn(victims[i]);
        victims.length = 0;
    };
}

/**
 * Despawn mobs that no player has seen for a while.
 *
 * Registered with an interval so it runs at ~6Hz rather than 30Hz, exactly as
 * the old strided pass did — the threshold is 30 seconds, so a 166ms cadence is
 * equivalent and avoids sweeping ~1400 mobs every tick. The offset keeps it off
 * the same tick as the viewport-status pass that feeds it.
 *
 * Victims are snapshotted before the hook runs: `despawn` reaches legacy
 * removal code, and mutating anything mid-chunk-walk is how a swap-remove
 * skips a row.
 */
export function unseenDespawnSystem(queries: LifetimeQueries, deps: UnseenDespawnDeps) {
    const { neverDespawns, isProtectedAt, despawn } = deps;
    const victims: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { now } = ctx;
        const deadline = now - UNSEEN_DESPAWN_MS;

        victims.length = 0;
        queries.viewportTracked.chunks(chunk => {
            const tracked = chunk.cols(C.ViewportTracked);
            const pos = chunk.cols(C.Position);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (tracked.lastInViewport[i] >= deadline) continue;
                const entity = entities[i] as Entity;
                if (neverDespawns(entity)) continue;
                if (isProtectedAt(pos.x[i], pos.y[i])) {
                    tracked.lastInViewport[i] = now;
                    continue;
                }
                victims.push(entity);
            }
        });

        for (let i = 0; i < victims.length; i++) despawn(victims[i]);
        victims.length = 0;
    };
}

/**
 * Reap mobs marked dead during this tick — the port of `reapDeadEnemies`.
 *
 * Runs in the Lifetime phase, i.e. AFTER Combat, which preserves the property
 * the old two-step (`isDead` flag now, splice at end of tick) existed to
 * provide: in-flight combat loops can still read a mob that died earlier in the
 * same tick, so damage attribution and drops resolve against a live entity.
 *
 * The death sequence itself (XP, drops, kill tracking, removal) is the
 * injected `reap` hook: all of it reads mob config and writes the database,
 * which stay outside the ECS. Victims are snapshotted first — the hook can
 * spawn a digger, and appending entities mid-chunk-walk is the swap-remove
 * hazard everywhere else avoids the same way.
 */
export function reaperSystem(queries: LifetimeQueries, deps: UnseenDespawnDeps) {
    const { reap } = deps;
    const victims: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { world } = ctx;

        victims.length = 0;
        queries.dead.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) victims.push(entities[i] as Entity);
        });

        for (let i = 0; i < victims.length; i++) {
            if (world.isAlive(victims[i])) reap(victims[i]);
        }
        victims.length = 0;
    };
}

export function registerLifetimeSystems(
    scheduler: {
        add: (
            name: string,
            phase: Phase,
            run: (ctx: SystemContext) => void,
            options?: { interval?: number; offset?: number },
        ) => unknown;
    },
    queries: LifetimeQueries,
    despawnDeps: UnseenDespawnDeps,
): void {
    scheduler.add('mobExpiry', Phase.Lifetime, mobExpirySystem(queries, despawnDeps));
    scheduler.add('unseenDespawn', Phase.Lifetime, unseenDespawnSystem(queries, despawnDeps), { interval: 5, offset: 2 });
    // The reaper must be last in the phase: everything above may still want to
    // read entities that died this tick.
    scheduler.add('reaper', Phase.Lifetime, reaperSystem(queries, despawnDeps));
}
