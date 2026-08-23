"use strict";
/**
 * The admission point for dropped world items — the item counterpart to
 * server/enemyRegistry.ts, and structured the same way for the same reason:
 * an item is ONE thing whose spatial/lifecycle half is an ECS entity
 * (Position, Expires — see ecs/systems/droppedItems.ts) while its WIRE OBJECT
 * (the legacy `WorldItem`) rides in the DroppedItem component's `payload` and
 * is what pickup and eligibility still speak. The WIRE no longer reads it: the
 * broadcast projects drops into the entity stream from these components.
 *
 * Unlike mobs there is no separate shell ARRAY any more: the world is the only
 * container, and the payloads are collected from it on demand. That kills the
 * old triple bookkeeping (`items[]` + a setTimeout per item in
 * `itemExpirationTimeouts` + the per-tick sweep), which had exactly the
 * leak/ghost failure modes this file's mob sibling documents.
 *
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
exports.spawnWorldItem = spawnWorldItem;
exports.removeWorldItem = removeWorldItem;
exports.collectWorldItems = collectWorldItems;
exports.worldItemCount = worldItemCount;
const C = __importStar(require("../ecs/components"));
const interning_1 = require("../ecs/interning");
const prefabs_1 = require("../ecs/prefabs");
const entityRegistry_1 = require("./entityRegistry");
const itemQuerySlot = {};
function droppedItems(world) {
    return (0, entityRegistry_1.cachedQuery)(itemQuerySlot, world, [C.DroppedItem]);
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
    const world = (0, entityRegistry_1.getEntityWorld)();
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
    const entity = (0, entityRegistry_1.getEntityWorld)().lookup(item.id);
    if (entity === undefined)
        return false;
    // Immediate, not deferred: a drop's WorldItem payload lives in its
    // DroppedItem component, so an item left in the world until the drain
    // would be collected by a second pickup pass in the same tick and handed
    // out twice. See the retireNow note in entityRegistry.
    return (0, entityRegistry_1.retireNow)(entity);
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
    const world = (0, entityRegistry_1.getEntityWorld)();
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
    return (0, entityRegistry_1.hasEntityHost)() ? droppedItems((0, entityRegistry_1.getEntityWorld)()).count() : 0;
}
// The spawn-emission queue is gone with the one-shot item channel: drops are
// part of the entity delta stream now (see server/tickBroadcast.ts), so there
// is nothing to queue and nothing to drain.
