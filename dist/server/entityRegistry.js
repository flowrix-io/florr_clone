"use strict";
/**
 * The generic entity registry — one lifecycle for every kind of thing.
 *
 * Mobs, dropped items, players and projectiles used to each have their own
 * admission point, their own removal path and their own answer to "is this
 * thing still real?". Three of those were near-copies of each other, and the
 * fourth (players) was implicit. The rules they were copying are not
 * kind-specific at all, so they live here once and the per-kind modules keep
 * only what is genuinely per-kind: how to build the thing.
 *
 * ---------------------------------------------------------------------------
 * Retirement is deferred, and that is load-bearing
 * ---------------------------------------------------------------------------
 * Removals arrive from inside loops that are mid-iteration over pooled entity
 * handles — the projectile sweep, the mob-collision entries list, the pickup
 * pass. Destroying an entity inline pulls its row out from under the iteration,
 * and a swap-remove archetype then hands the loop an already-visited row while
 * skipping an unvisited one. So `retire()` queues, and `drainRetired()` runs at
 * one safe point per tick where nothing is walking a query.
 *
 * `retireNow()` exists for the one case that cannot wait: a thing whose STATE
 * lives in a component the rest of the tick still reads. A dropped item is the
 * example — its `WorldItem` payload rides in the DroppedItem component, so an
 * item left in the world until the drain would be collected by a second pickup
 * pass in the same tick and handed out twice. Mobs have the opposite shape and
 * must defer. That difference is policy, not mechanism, which is why both live
 * here side by side with the reason attached.
 *
 * ---------------------------------------------------------------------------
 * One liveness rule for the wire
 * ---------------------------------------------------------------------------
 * `isLiveForWire` is the single predicate that decides whether an entity may be
 * mentioned in outbound traffic. It has to account for the gap between "removed"
 * and "destroyed": the broadcast timer fires BETWEEN ticks and reads the world
 * directly, so an entity waiting for the drain is still physically present and
 * would otherwise go back on the wire one frame after the client was told it
 * died. Every ghost-entity bug this codebase has had was some kind's private,
 * partial version of this check — see the ghost-entity notes in tickBroadcast.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindEntityHost = bindEntityHost;
exports.requireEntityHost = requireEntityHost;
exports.getEntityWorld = getEntityWorld;
exports.hasEntityHost = hasEntityHost;
exports.entityRetirementVersion = entityRetirementVersion;
exports.retire = retire;
exports.retireNow = retireNow;
exports.isPendingRetirement = isPendingRetirement;
exports.isLiveForWire = isLiveForWire;
exports.drainRetired = drainRetired;
exports.pendingRetirementCount = pendingRetirementCount;
exports.cachedQuery = cachedQuery;
let host;
/** Install the ECS host. Called once, from the composition root. */
function bindEntityHost(installed) {
    host = installed;
}
function requireEntityHost() {
    if (!host) {
        throw new Error('entityRegistry: no ECS host installed. server.ts must call '
            + 'bindEntityHost() at startup — without it nothing can be admitted to '
            + 'or removed from the world.');
    }
    return host;
}
/** The live world. Throws if the host has not been installed yet. */
function getEntityWorld() {
    return requireEntityHost().getWorld();
}
/** Whether a host is installed. For diagnostics that must not throw. */
function hasEntityHost() {
    return host !== undefined;
}
// ---------------------------------------------------------------------------
// Deferred retirement
// ---------------------------------------------------------------------------
/**
 * Entities removed from the game but not yet destroyed.
 *
 * The parallel Set answers "is this already gone?" for readers that see the
 * world between the removal and the drain. Both are reused across ticks.
 */
const pendingRetirements = [];
const pendingRetirementSet = new Set();
/**
 * Bumped whenever the pending-retirement set changes.
 *
 * A retired entity is still physically in the world until the drain, so
 * `World.version()` alone cannot tell a derived view that something left the
 * game. Views compare BOTH counters — see liveEnemies() in enemyRegistry.
 */
let retirementVersion = 0;
/** The retirement counter; pair it with `World.version()` to cache a view. */
function entityRetirementVersion() {
    return retirementVersion;
}
/** Queue an entity for destruction at the end of the current tick. */
function retire(entity) {
    if (pendingRetirementSet.has(entity))
        return;
    pendingRetirements.push(entity);
    pendingRetirementSet.add(entity);
    retirementVersion++;
}
/**
 * Destroy an entity immediately, and mark it retired so anything reading the
 * world in the same tick agrees it is gone.
 *
 * Only for kinds whose state lives in a component the rest of the tick still
 * reads — see the header. Returns whether the entity existed.
 */
function retireNow(entity) {
    pendingRetirementSet.add(entity);
    retirementVersion++;
    return getEntityWorld().destroy(entity);
}
/** Whether this entity has been removed and is waiting for the drain. */
function isPendingRetirement(entity) {
    return pendingRetirementSet.has(entity);
}
/**
 * May this entity be mentioned in outbound traffic?
 *
 * The one rule, for every kind. An entity that is dead, destroyed, or removed
 * but not yet drained must never appear in a spawn event, a delta or a
 * snapshot: the client was already told it is gone, or was never told it
 * existed, and either way the mention becomes a ghost it can never clear.
 */
function isLiveForWire(world, entity) {
    return world.isAlive(entity) && !pendingRetirementSet.has(entity);
}
/**
 * Destroy everything retired since the last drain.
 *
 * Called once per tick from the point where the ECS has finished stepping and
 * nothing is iterating a query or a pooled handle list. Destroying is idempotent
 * on a stale handle (`World.destroy` returns false), so a thing retired twice in
 * one tick is harmless.
 */
function drainRetired(world) {
    if (pendingRetirements.length === 0) {
        // retireNow() adds to the set without queueing; the set still has to be
        // cleared each tick or it grows without bound and starts reporting
        // long-dead handles as pending.
        if (pendingRetirementSet.size > 0) {
            pendingRetirementSet.clear();
            retirementVersion++;
        }
        return;
    }
    for (let i = 0; i < pendingRetirements.length; i++) {
        world.destroy(pendingRetirements[i]);
    }
    pendingRetirements.length = 0;
    pendingRetirementSet.clear();
    retirementVersion++;
}
/** Entities waiting for the drain. Diagnostics. */
function pendingRetirementCount() {
    return pendingRetirements.length;
}
// ---------------------------------------------------------------------------
// Query caching
// ---------------------------------------------------------------------------
/**
 * A query built once and reused, re-created if the world is ever replaced.
 *
 * Every registry and encoder was hand-rolling this pair of module-level
 * `let`s. Queries are cheap to hold and expensive to rebuild per call, and the
 * world identity check matters because the tick harness and the self-tests
 * construct throwaway worlds in the same process.
 */
function cachedQuery(slot, world, all, none = []) {
    if (slot.query === undefined || slot.world !== world) {
        slot.query = world.query(all, none);
        slot.world = world;
    }
    return slot.query;
}
