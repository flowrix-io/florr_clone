"use strict";
/**
 * The admission point for dropped world items — the item counterpart to
 * server/enemyRegistry.ts, and structured the same way for the same reason:
 * an item is ONE thing whose spatial/lifecycle half is an ECS entity
 * (Position, Expires — see ecs/systems/droppedItems.ts) while its WIRE OBJECT
 * (the legacy `WorldItem`) rides in the DroppedItem component's `payload` and
 * is what pickup, eligibility and every item event still speak.
 *
 * Unlike mobs there is no separate shell ARRAY any more: the world is the only
 * container, and the payloads are collected from it on demand. That kills the
 * old triple bookkeeping (`items[]` + a setTimeout per item in
 * `itemExpirationTimeouts` + the per-tick sweep), which had exactly the
 * leak/ghost failure modes this file's mob sibling documents.
 *
 * The spawn-batch queue lives here too: drops mark themselves for one batched
 * `itemsSpawned` per recipient per tick (see server.ts flushItemSpawnBatch),
 * and the queue replaces the `pendingSpawnEmission` markers that used to be
 * monkey-patched onto each item object.
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
exports.bindItemHost = bindItemHost;
exports.spawnWorldItem = spawnWorldItem;
exports.removeWorldItem = removeWorldItem;
exports.collectWorldItems = collectWorldItems;
exports.worldItemCount = worldItemCount;
exports.queueItemSpawnEmission = queueItemSpawnEmission;
exports.drainItemSpawnEmissions = drainItemSpawnEmissions;
const C = __importStar(require("../ecs/components"));
const interning_1 = require("../ecs/interning");
const prefabs_1 = require("../ecs/prefabs");
let host;
/** Install the ECS host. Called once, from the composition root. */
function bindItemHost(installed) {
    host = installed;
}
function requireHost() {
    if (!host) {
        throw new Error('itemRegistry: no ECS host installed. server.ts must call '
            + 'bindItemHost() at startup — without it a drop would have nowhere '
            + 'to exist.');
    }
    return host;
}
let itemQuery;
let itemQueryWorld;
function droppedItems(world) {
    if (itemQuery === undefined || itemQueryWorld !== world) {
        itemQuery = world.query([C.DroppedItem]);
        itemQueryWorld = world;
    }
    return itemQuery;
}
function kindOf(type) {
    switch (type) {
        case 'health_potion': return 0 /* C.ItemKind.HealthPotion */;
        case 'speed_boost': return 1 /* C.ItemKind.SpeedBoost */;
        case 'shield': return 2 /* C.ItemKind.Shield */;
        default: return 3 /* C.ItemKind.Petal */;
    }
}
/**
 * Admit a drop. `expiresAt` is the rarity deadline the caller computes from
 * ITEM_EXPIRATION_TIMES — it replaces the setTimeout every spawn site used to
 * register.
 */
function spawnWorldItem(item, expiresAt) {
    const world = requireHost().getWorld();
    return (0, prefabs_1.spawnDroppedItem)(world, {
        id: item.id,
        x: item.x,
        y: item.y,
        petalType: item.petalType ? interning_1.petalTypes.intern(item.petalType) : 0xffff,
        rarity: item.rarity ?? 'common',
        kind: kindOf(item.type),
        eligiblePlayers: item.eligiblePlayers,
        pickedUpBy: item.pickedUpBy,
        payload: item,
        spawnTime: item.spawnTime ?? Date.now(),
        expiresAt,
    });
}
/**
 * Remove a drop (all eligible players picked it up, or an admin cleared it).
 * The caller keeps doing its own `itemRemoved` emits, which differ per site.
 * Returns false when the item already left.
 */
function removeWorldItem(item) {
    const world = requireHost().getWorld();
    const entity = world.lookup(item.id);
    if (entity === undefined)
        return false;
    return world.destroy(entity);
}
/**
 * Collect every live drop's payload into `out` (cleared first).
 *
 * Callers own their buffer so two passes (the pickup loop, the per-socket
 * resync builder) can never scribble over each other. Iterating a COPY is the
 * point: the pickup loop removes items as it goes, and destroying entities
 * while walking the query's chunks would swap unvisited rows into visited
 * slots.
 */
function collectWorldItems(out) {
    out.length = 0;
    const world = requireHost().getWorld();
    droppedItems(world).chunks(chunk => {
        const dropped = chunk.cols(C.DroppedItem);
        for (let i = 0; i < chunk.count; i++) {
            out.push(dropped.payload[i]);
        }
    });
    return out;
}
/** Number of live drops. Diagnostics. */
function worldItemCount() {
    return host ? droppedItems(host.getWorld()).count() : 0;
}
// ---------------------------------------------------------------------------
// The spawn batch
// ---------------------------------------------------------------------------
const pendingSpawnItems = [];
const pendingSpawnRecipients = [];
/** Queue `item` for the end-of-tick batched `itemsSpawned` to these sockets. */
function queueItemSpawnEmission(item, socketIds) {
    pendingSpawnItems.push(item);
    pendingSpawnRecipients.push(socketIds);
}
/** Drain the queue, invoking `visit` once per (item, recipients) pair. */
function drainItemSpawnEmissions(visit) {
    for (let i = 0; i < pendingSpawnItems.length; i++) {
        visit(pendingSpawnItems[i], pendingSpawnRecipients[i]);
    }
    pendingSpawnItems.length = 0;
    pendingSpawnRecipients.length = 0;
}
