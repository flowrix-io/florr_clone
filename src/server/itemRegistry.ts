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

import { WorldItem } from '../item';
import { Entity, Query, World } from '../ecs';
import * as C from '../ecs/components';
import { petalTypes } from '../ecs/interning';
import { spawnDroppedItem } from '../ecs/prefabs';

export interface ItemHost {
    getWorld(): World;
}

let host: ItemHost | undefined;

/** Install the ECS host. Called once, from the composition root. */
export function bindItemHost(installed: ItemHost): void {
    host = installed;
}

function requireHost(): ItemHost {
    if (!host) {
        throw new Error(
            'itemRegistry: no ECS host installed. server.ts must call '
            + 'bindItemHost() at startup — without it a drop would have nowhere '
            + 'to exist.',
        );
    }
    return host;
}

let itemQuery: Query | undefined;
let itemQueryWorld: World | undefined;

function droppedItems(world: World): Query {
    if (itemQuery === undefined || itemQueryWorld !== world) {
        itemQuery = world.query([C.DroppedItem]);
        itemQueryWorld = world;
    }
    return itemQuery;
}

function kindOf(type: WorldItem['type']): C.ItemKind {
    switch (type) {
        case 'health_potion': return C.ItemKind.HealthPotion;
        case 'speed_boost': return C.ItemKind.SpeedBoost;
        case 'shield': return C.ItemKind.Shield;
        default: return C.ItemKind.Petal;
    }
}

/**
 * Admit a drop. `expiresAt` is the rarity deadline the caller computes from
 * ITEM_EXPIRATION_TIMES — it replaces the setTimeout every spawn site used to
 * register.
 */
export function spawnWorldItem(item: WorldItem, expiresAt: number): Entity {
    const world = requireHost().getWorld();
    return spawnDroppedItem(world, {
        id: item.id,
        x: item.x,
        y: item.y,
        petalType: item.petalType ? petalTypes.intern(item.petalType) : 0xffff,
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
export function removeWorldItem(item: WorldItem): boolean {
    const world = requireHost().getWorld();
    const entity = world.lookup(item.id);
    if (entity === undefined) return false;
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
export function collectWorldItems(out: WorldItem[]): WorldItem[] {
    out.length = 0;
    const world = requireHost().getWorld();
    droppedItems(world).chunks(chunk => {
        const dropped = chunk.cols(C.DroppedItem);
        for (let i = 0; i < chunk.count; i++) {
            out.push(dropped.payload[i] as WorldItem);
        }
    });
    return out;
}

/** Number of live drops. Diagnostics. */
export function worldItemCount(): number {
    return host ? droppedItems(host.getWorld()).count() : 0;
}

// ---------------------------------------------------------------------------
// The spawn batch
// ---------------------------------------------------------------------------

const pendingSpawnItems: WorldItem[] = [];
const pendingSpawnRecipients: string[][] = [];

/** Queue `item` for the end-of-tick batched `itemsSpawned` to these sockets. */
export function queueItemSpawnEmission(item: WorldItem, socketIds: string[]): void {
    pendingSpawnItems.push(item);
    pendingSpawnRecipients.push(socketIds);
}

/** Drain the queue, invoking `visit` once per (item, recipients) pair. */
export function drainItemSpawnEmissions(
    visit: (item: WorldItem, socketIds: string[]) => void,
): void {
    for (let i = 0; i < pendingSpawnItems.length; i++) {
        visit(pendingSpawnItems[i], pendingSpawnRecipients[i]);
    }
    pendingSpawnItems.length = 0;
    pendingSpawnRecipients.length = 0;
}
