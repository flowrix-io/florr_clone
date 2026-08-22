"use strict";
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
exports.UNSEEN_DESPAWN_MS = void 0;
exports.createLifetimeQueries = createLifetimeQueries;
exports.mobExpirySystem = mobExpirySystem;
exports.unseenDespawnSystem = unseenDespawnSystem;
exports.reaperSystem = reaperSystem;
exports.registerLifetimeSystems = registerLifetimeSystems;
const C = __importStar(require("../components"));
const system_1 = require("../system");
/**
 * How long a mob may go unseen by every player's viewport before it despawns.
 * Matches the existing 30-second threshold in `despawnDistantEnemies`.
 */
exports.UNSEEN_DESPAWN_MS = 30000;
function createLifetimeQueries(world) {
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
 * Retire mobs whose self-despawn deadline has passed (periodic-spawn escorts,
 * timed pets) — the expiry half of the legacy `updatePeriodicSpawns`.
 *
 * Goes through the same despawn hook as the unseen sweep: removal must splice
 * the legacy shell and emit `enemyDestroyed`, and the entity itself is retired
 * by the registry's deferred drain.
 */
function mobExpirySystem(queries, deps) {
    const { despawn } = deps;
    const victims = [];
    return (ctx) => {
        const { now } = ctx;
        victims.length = 0;
        queries.expiring.chunks(chunk => {
            const expires = chunk.cols(C.Expires);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (now >= expires.at[i])
                    victims.push(entities[i]);
            }
        });
        for (let i = 0; i < victims.length; i++)
            despawn(victims[i]);
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
function unseenDespawnSystem(queries, deps) {
    const { neverDespawns, isProtectedAt, despawn } = deps;
    const victims = [];
    return (ctx) => {
        const { now } = ctx;
        const deadline = now - exports.UNSEEN_DESPAWN_MS;
        victims.length = 0;
        queries.viewportTracked.chunks(chunk => {
            const tracked = chunk.cols(C.ViewportTracked);
            const pos = chunk.cols(C.Position);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (tracked.lastInViewport[i] >= deadline)
                    continue;
                const entity = entities[i];
                if (neverDespawns(entity))
                    continue;
                if (isProtectedAt(pos.x[i], pos.y[i])) {
                    tracked.lastInViewport[i] = now;
                    continue;
                }
                victims.push(entity);
            }
        });
        for (let i = 0; i < victims.length; i++)
            despawn(victims[i]);
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
function reaperSystem(queries, deps) {
    const { reap } = deps;
    const victims = [];
    return (ctx) => {
        const { world } = ctx;
        victims.length = 0;
        queries.dead.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++)
                victims.push(entities[i]);
        });
        for (let i = 0; i < victims.length; i++) {
            if (world.isAlive(victims[i]))
                reap(victims[i]);
        }
        victims.length = 0;
    };
}
function registerLifetimeSystems(scheduler, queries, despawnDeps) {
    scheduler.add('mobExpiry', system_1.Phase.Lifetime, mobExpirySystem(queries, despawnDeps));
    scheduler.add('unseenDespawn', system_1.Phase.Lifetime, unseenDespawnSystem(queries, despawnDeps), { interval: 5, offset: 2 });
    // The reaper must be last in the phase: everything above may still want to
    // read entities that died this tick.
    scheduler.add('reaper', system_1.Phase.Lifetime, reaperSystem(queries, despawnDeps));
}
