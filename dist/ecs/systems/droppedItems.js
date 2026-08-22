"use strict";
/**
 * Dropped world items (petal drops, potions) as entities.
 *
 * Replaces the `items: WorldItem[]` array's three lifecycle mechanisms:
 *
 *   per-item setTimeout   -> the `Expires` deadline, swept here. The timers
 *                            were a real hazard: each held a closure over its
 *                            item, and every early-removal path had to
 *                            remember to clear one or leak it.
 *   wall push per tick    -> the same resolve, against the injected tile hook.
 *   out-of-bounds sweep   -> the injected bounds hook (the world rectangle
 *                            minus the PVP arena and the maze, which sit
 *                            outside it on purpose).
 *
 * The item's WIRE OBJECT (the legacy `WorldItem`) rides in
 * `DroppedItem.payload`: pickup, eligibility and the item events still speak
 * that shape, so the payload is the boundary — this system owns WHERE the item
 * is and WHEN it dies, and mirrors x/y onto the payload for the legacy
 * consumers. Pickup itself stays in the player pipeline (it is sequential
 * per-player, like everything else there) and reads the payloads through
 * server/itemRegistry.ts.
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
exports.DROPPED_ITEM_RADIUS = void 0;
exports.createDroppedItemQueries = createDroppedItemQueries;
exports.droppedItemSystem = droppedItemSystem;
exports.registerDroppedItemSystems = registerDroppedItemSystems;
const C = __importStar(require("../components"));
const system_1 = require("../system");
/** Item hitbox radius (30x30), matching checkItemWallCollisions. */
exports.DROPPED_ITEM_RADIUS = 15;
function createDroppedItemQueries(world) {
    return {
        items: world.query([C.Position, C.DroppedItem, C.Expires]),
    };
}
/**
 * Per-tick item maintenance: wall push, bounds check, expiry.
 *
 * Handles snapshotted first, as everywhere a hook runs mid-pass: `onRemoved`
 * reaches the socket layer, and the destroys are deferred through the command
 * buffer either way.
 */
function droppedItemSystem(queries, deps) {
    const { resolveWall, isOutOfBounds, onRemoved } = deps;
    const scratch = [];
    return (ctx) => {
        const { world, cmd, now } = ctx;
        scratch.length = 0;
        queries.items.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++)
                scratch.push(entities[i]);
        });
        for (let i = 0; i < scratch.length; i++) {
            const item = scratch[i];
            if (!world.isAlive(item))
                continue;
            let x = world.get(item, C.Position, 'x');
            let y = world.get(item, C.Position, 'y');
            const payload = world.get(item, C.DroppedItem, 'payload');
            // Wall push. Position is the authority; the payload x/y is a
            // mirror the wire and the pickup pass read.
            const resolved = resolveWall(x, y);
            if (resolved.x !== x || resolved.y !== y) {
                x = resolved.x;
                y = resolved.y;
                world.write(item, C.Position, { x, y });
            }
            if (payload && (payload.x !== x || payload.y !== y)) {
                payload.x = x;
                payload.y = y;
            }
            if (isOutOfBounds(x, y) || now >= world.get(item, C.Expires, 'at')) {
                onRemoved(item);
                cmd.destroy(item);
            }
        }
        scratch.length = 0;
    };
}
function registerDroppedItemSystems(scheduler, queries, deps) {
    // Lifetime, after the ground effects' Combat pass — the order the legacy
    // tick ran them in (updateWorldItems was the last world pass of the tick).
    scheduler.add('droppedItems', system_1.Phase.Lifetime, droppedItemSystem(queries, deps));
}
