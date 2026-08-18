/**
 * Non-creature world entities: dropped items, ground effects, scenery, walls.
 *
 * Each of these used to be its own global array with its own bespoke update
 * pass in the tick loop (`updateWorldItems`, `updateGroundPollens`,
 * `updateWebFields`). They share enough structure — a position, a lifetime, an
 * owner — that as components they reuse the same expiry and spatial systems.
 */

import { defineComponent, defineTag } from '../component';

/**
 * A dropped petal or pickup lying on the ground (`WorldItem`).
 *
 * `eligiblePlayers` and `pickedUpBy` stay as reference fields: they are a
 * string array and a Set, read only when a player actually overlaps the drop.
 */
export const DroppedItem = defineComponent('DroppedItem', {
    /** Interned petal type; -1 for non-petal pickups. */
    petalType: 'u16',
    rarity: 'u8',
    /** Item kind: health_potion / speed_boost / shield / petal. */
    kind: 'u8',
    /** string[] of player ids allowed to pick this up, or undefined for anyone. */
    eligiblePlayers: 'obj',
    /** Set<string> of players who already took it (clumped drops). */
    pickedUpBy: 'obj',
    /** The full Item payload, preserved verbatim for the inventory grant. */
    payload: 'obj',
});

/** `WorldItem.type` as a small enum. */
export const enum ItemKind {
    HealthPotion = 0,
    SpeedBoost = 1,
    Shield = 2,
    Petal = 3,
}

/**
 * A damaging puff left behind when a pollen petal breaks.
 *
 * `lastDamageByEnemy` (a Map) is the per-victim retrigger clock and stays a
 * reference field; everything the overlap test reads is numeric.
 */
export const GroundPollen = defineComponent('GroundPollen', {
    owner: 'entity',
    damage: 'f32',
    rarity: 'u8',
    /** Map<enemyId, lastDamageTime>. */
    lastDamageByEnemy: 'obj',
});

/**
 * A stationary field that halves the speed of anything standing in it, left by
 * a thrown web petal. Mirrors gardn's kWeb entity.
 */
export const WebField = defineComponent('WebField', {
    owner: 'entity',
    rarity: 'u8',
});

/**
 * A static wall. Obstacles never move and never die, so they carry only a box.
 * Position holds the top-left corner, matching the existing Obstacle shape.
 */
export const Box = defineComponent('Box', {
    width: 'f32',
    height: 'f32',
});

export const IsDroppedItem = defineTag('IsDroppedItem');
export const IsGroundEffect = defineTag('IsGroundEffect');
