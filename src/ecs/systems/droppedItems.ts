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

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/** Item hitbox radius (30x30), matching checkItemWallCollisions. */
export const DROPPED_ITEM_RADIUS = 15;

/** The slice of the legacy WorldItem this system mirrors position onto. */
export interface DroppedItemPayload {
    x: number;
    y: number;
}

export interface DroppedItemQueries {
    items: Query;
}

export function createDroppedItemQueries(world: World): DroppedItemQueries {
    return {
        items: world.query([C.Position, C.DroppedItem, C.Expires]),
    };
}

export interface DroppedItemDeps {
    /** Resolve the item out of any wall it overlaps (the tile grid is injected). */
    resolveWall(x: number, y: number): { x: number; y: number };
    /** Outside the playable space (world rect minus PVP arena and maze)? */
    isOutOfBounds(x: number, y: number): boolean;
    /**
     * The item is leaving the world (expired or out of bounds): tell the
     * eligible clients. Runs BEFORE the destroy so the payload is readable.
     */
    onRemoved(item: Entity): void;
}

/**
 * Per-tick item maintenance: wall push, bounds check, expiry.
 *
 * Handles snapshotted first, as everywhere a hook runs mid-pass: `onRemoved`
 * reaches the socket layer, and the destroys are deferred through the command
 * buffer either way.
 */
export function droppedItemSystem(queries: DroppedItemQueries, deps: DroppedItemDeps) {
    const { resolveWall, isOutOfBounds, onRemoved } = deps;
    const scratch: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { world, cmd, now } = ctx;

        scratch.length = 0;
        queries.items.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) scratch.push(entities[i] as Entity);
        });

        for (let i = 0; i < scratch.length; i++) {
            const item = scratch[i];
            if (!world.isAlive(item)) continue;

            let x = world.get(item, C.Position, 'x') as number;
            let y = world.get(item, C.Position, 'y') as number;
            const payload = world.get(item, C.DroppedItem, 'payload') as DroppedItemPayload;

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

            if (isOutOfBounds(x, y) || now >= (world.get(item, C.Expires, 'at') as number)) {
                onRemoved(item);
                cmd.destroy(item);
            }
        }
        scratch.length = 0;
    };
}

export function registerDroppedItemSystems(
    scheduler: {
        add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown;
    },
    queries: DroppedItemQueries,
    deps: DroppedItemDeps,
): void {
    // Lifetime, after the ground effects' Combat pass — the order the legacy
    // tick ran them in (updateWorldItems was the last world pass of the tick).
    scheduler.add('droppedItems', Phase.Lifetime, droppedItemSystem(queries, deps));
}
