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

import { WorldItem } from '../item';
import { Entity, Query, World } from '../ecs';
import * as C from '../ecs/components';
import { petalTypes } from '../ecs/interning';
import { spawnDroppedItem } from '../ecs/prefabs';
import { cachedQuery, getEntityWorld, hasEntityHost, retireNow } from './entityRegistry';

const itemQuerySlot: { query?: Query; world?: World } = {};

function droppedItems(world: World): Query {
    return cachedQuery(itemQuerySlot, world, [C.DroppedItem]);
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
    const world = getEntityWorld();
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
    const entity = getEntityWorld().lookup(item.id);
    if (entity === undefined) return false;
    // Immediate, not deferred: a drop's WorldItem payload lives in its
    // DroppedItem component, so an item left in the world until the drain
    // would be collected by a second pickup pass in the same tick and handed
    // out twice. See the retireNow note in entityRegistry.
    return retireNow(entity);
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
    const world = getEntityWorld();
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
    return hasEntityHost() ? droppedItems(getEntityWorld()).count() : 0;
}

// The spawn-emission queue is gone with the one-shot item channel: drops are
// part of the entity delta stream now (see server/tickBroadcast.ts), so there
// is nothing to queue and nothing to drain.
