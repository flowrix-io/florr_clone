"use strict";
/**
 * Lifetime systems: timed expiry, unseen-mob despawn, and the death reaper.
 *
 * Replaces three separate mechanisms — the `Expires`-style deadline checks in
 * `updateGroundPollens`/`updateWebFields`, the per-drop `setTimeout` tracked in
 * `itemExpirationTimeouts`, and the end-of-tick `enemies.splice()` pass that
 * cleared `isDead` mobs.
 *
 * Retiring the per-item timers matters beyond tidiness: each one held a closure
 * over its item, so any path that removed a drop early leaked the timer unless
 * it remembered to clear it, and a timer that outlived its item kept the item
 * reachable. A single swept deadline has neither failure mode.
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
exports.expirySystem = expirySystem;
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
        expiring: world.query([C.Expires]),
        viewportTracked: world.query([C.ViewportTracked], [C.IsDead]),
        dead: world.query([C.IsDead]),
    };
}
/** Destroy everything whose deadline has passed. */
function expirySystem(queries) {
    return (ctx) => {
        const { cmd, now } = ctx;
        queries.expiring.chunks(chunk => {
            const expires = chunk.cols(C.Expires);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (now >= expires.at[i])
                    cmd.destroy(entities[i]);
            }
        });
    };
}
/**
 * Despawn mobs that no player has seen for a while.
 *
 * Registered with an interval so it runs at ~6Hz rather than 30Hz, exactly as
 * the old strided pass did — the threshold is 30 seconds, so a 166ms cadence is
 * equivalent and avoids sweeping ~1400 mobs every tick. The offset keeps it off
 * the same tick as the viewport-status pass that feeds it.
 */
function unseenDespawnSystem(queries) {
    return (ctx) => {
        const { cmd, now } = ctx;
        const deadline = now - exports.UNSEEN_DESPAWN_MS;
        queries.viewportTracked.chunks(chunk => {
            const tracked = chunk.cols(C.ViewportTracked);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (tracked.lastInViewport[i] < deadline)
                    cmd.destroy(entities[i]);
            }
        });
    };
}
/**
 * Destroy entities marked dead during this tick.
 *
 * Runs in the Lifetime phase, i.e. AFTER Combat, which preserves the property
 * the old two-step (`isDead` flag now, splice at end of tick) existed to
 * provide: in-flight combat loops can still read a mob that died earlier in the
 * same tick, so damage attribution and drops resolve against a live entity.
 */
function reaperSystem(queries) {
    return (ctx) => {
        const { cmd } = ctx;
        queries.dead.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++)
                cmd.destroy(entities[i]);
        });
    };
}
function registerLifetimeSystems(scheduler, queries) {
    scheduler.add('expiry', system_1.Phase.Lifetime, expirySystem(queries));
    scheduler.add('unseenDespawn', system_1.Phase.Lifetime, unseenDespawnSystem(queries), { interval: 5, offset: 2 });
    // The reaper must be last in the phase: everything above may still want to
    // read entities that died this tick.
    scheduler.add('reaper', system_1.Phase.Lifetime, reaperSystem(queries));
}
