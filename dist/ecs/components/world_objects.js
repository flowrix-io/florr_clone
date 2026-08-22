"use strict";
/**
 * Non-creature world entities: dropped items, ground effects, scenery, walls.
 *
 * Each of these used to be its own global array with its own bespoke update
 * pass in the tick loop (`updateWorldItems`, `updateGroundPollens`,
 * `updateWebFields`). They share enough structure — a position, a lifetime, an
 * owner — that as components they reuse the same expiry and spatial systems.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsGroundEffect = exports.IsDroppedItem = exports.Box = exports.WebField = exports.GroundPollen = exports.DroppedItem = void 0;
const component_1 = require("../component");
/**
 * A dropped petal or pickup lying on the ground (`WorldItem`).
 *
 * `eligiblePlayers` and `pickedUpBy` stay as reference fields: they are a
 * string array and a Set, read only when a player actually overlaps the drop.
 */
exports.DroppedItem = (0, component_1.defineComponent)('DroppedItem', {
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
/**
 * A damaging puff left behind when a pollen petal breaks.
 *
 * `lastDamageByEnemy` (a Map) is the per-victim retrigger clock and stays a
 * reference field; everything the overlap test reads is numeric.
 */
exports.GroundPollen = (0, component_1.defineComponent)('GroundPollen', {
    owner: 'entity',
    damage: 'f32',
    rarity: 'u8',
    /**
     * Map<entity handle, lastDamageTime> — the per-victim retrigger clock.
     * Keyed by handle rather than external id: the generation bits make a
     * recycled slot a new key, so no stale-id hygiene is needed.
     */
    lastDamageByEnemy: 'obj',
});
/**
 * A stationary field that halves the speed of anything standing in it, left by
 * a thrown web petal. Mirrors gardn's kWeb entity.
 */
exports.WebField = (0, component_1.defineComponent)('WebField', {
    owner: 'entity',
    rarity: 'u8',
});
/**
 * A static wall. Obstacles never move and never die, so they carry only a box.
 * Position holds the top-left corner, matching the existing Obstacle shape.
 */
exports.Box = (0, component_1.defineComponent)('Box', {
    width: 'f32',
    height: 'f32',
});
exports.IsDroppedItem = (0, component_1.defineTag)('IsDroppedItem');
exports.IsGroundEffect = (0, component_1.defineTag)('IsGroundEffect');
