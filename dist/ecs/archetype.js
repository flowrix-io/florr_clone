"use strict";
/**
 * Archetypes: the storage blocks of the world.
 *
 * An archetype owns every entity that has EXACTLY one particular set of
 * components. All bees with the same component set live in one archetype, so a
 * system that queries `Position + Velocity` gets whole blocks of densely packed
 * rows and can run a plain indexed `for` loop over typed arrays with no
 * per-entity branching or property lookups.
 *
 * Rows are kept dense by SWAP-REMOVE: deleting row `r` moves the last row into
 * it and shrinks the count. That means **a row index is only valid until the
 * next structural change**, which is why nothing outside this module stores row
 * indices across ticks — entity handles are the stable reference, and the world
 * maintains the handle -> (archetype, row) map.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Archetype = void 0;
exports.createMask = createMask;
exports.maskSet = maskSet;
exports.maskClear = maskClear;
exports.maskHas = maskHas;
exports.maskContainsAll = maskContainsAll;
exports.maskIntersects = maskIntersects;
exports.archetypeKey = archetypeKey;
const component_1 = require("./component");
const entity_1 = require("./entity");
/** Initial row capacity of a freshly created archetype. */
const INITIAL_CAPACITY = 16;
function createMask(componentCapacity) {
    return new Uint32Array(Math.max(1, Math.ceil(componentCapacity / 32)));
}
function maskSet(mask, componentId) {
    mask[componentId >>> 5] |= (1 << (componentId & 31)) >>> 0;
}
function maskClear(mask, componentId) {
    mask[componentId >>> 5] &= ~((1 << (componentId & 31)) >>> 0);
}
function maskHas(mask, componentId) {
    return (mask[componentId >>> 5] & ((1 << (componentId & 31)) >>> 0)) !== 0;
}
/** True when every bit set in `required` is also set in `mask`. */
function maskContainsAll(mask, required) {
    for (let i = 0; i < required.length; i++) {
        const r = required[i];
        if (r !== 0 && ((mask[i] ?? 0) & r) !== r)
            return false;
    }
    return true;
}
/** True when `mask` shares at least one bit with `any`. */
function maskIntersects(mask, any) {
    for (let i = 0; i < any.length; i++) {
        if (((mask[i] ?? 0) & any[i]) !== 0)
            return true;
    }
    return false;
}
class Archetype {
    constructor(types, componentCapacity) {
        /**
         * This archetype's position in `World.archetypes`, assigned when the world
         * registers it. Stored here so moving an entity between archetypes is O(1)
         * instead of an `indexOf` scan — component add/remove is hot enough (every
         * poison application, every pet spawn) that a linear scan over every
         * archetype in the process would show up in profiles.
         */
        this.index = -1;
        this.count = 0;
        this.capacity = INITIAL_CAPACITY;
        /**
         * Bumped on every structural change (add/remove row). Query iterators read
         * this to fail loudly if a system mutates the world mid-iteration instead of
         * silently skipping or double-visiting entities.
         */
        this.version = 0;
        const sorted = types.slice().sort((a, b) => a.id - b.id);
        this.componentIds = sorted.map(t => t.id);
        this.key = this.componentIds.join(',');
        this.mask = createMask(componentCapacity);
        this.columns = [];
        this.entities = new Float64Array(this.capacity);
        for (const type of sorted) {
            maskSet(this.mask, type.id);
            const arrays = {};
            for (const field of type.fields) {
                arrays[field] = (0, component_1.allocField)(type.schema[field], this.capacity);
            }
            this.columns[type.id] = { type, arrays };
        }
    }
    has(componentId) {
        return this.columns[componentId] !== undefined;
    }
    /** Typed access to one component's arrays. Returns undefined if absent. */
    column(type) {
        return this.columns[type.id];
    }
    /**
     * Append a row for `entity` and return its index.
     * Field values are left at whatever the slot held; callers always write
     * every field immediately after (see World.add / moveEntity).
     */
    addRow(entity) {
        if (this.count === this.capacity)
            this.grow(this.capacity * 2);
        const row = this.count++;
        this.entities[row] = entity;
        this.version++;
        return row;
    }
    /**
     * Swap-remove `row`.
     *
     * Returns the entity that was moved from the tail into `row` so the world
     * can fix up its location map, or NULL_ENTITY when `row` was the tail (in
     * which case nothing moved).
     */
    removeRow(row) {
        const last = this.count - 1;
        let moved = entity_1.NULL_ENTITY;
        if (row !== last) {
            moved = this.entities[last];
            this.entities[row] = moved;
            for (const col of this.columns) {
                if (!col)
                    continue;
                for (const field of col.type.fields) {
                    const arr = col.arrays[field];
                    arr[row] = arr[last];
                }
            }
        }
        // Always clear the vacated tail slot. For reference fields this is what
        // actually drops the last reference to loadouts/Maps/strings; leaving it
        // would pin dead entities' payloads in the heap for the process lifetime.
        for (const col of this.columns) {
            if (!col)
                continue;
            for (const field of col.type.fields) {
                (0, component_1.clearFieldSlot)(col.type.schema[field], col.arrays[field], last);
            }
        }
        this.entities[last] = entity_1.NULL_ENTITY;
        this.count = last;
        this.version++;
        return moved;
    }
    grow(capacity) {
        const nextEntities = new Float64Array(capacity);
        nextEntities.set(this.entities);
        this.entities = nextEntities;
        for (const col of this.columns) {
            if (!col)
                continue;
            for (const field of col.type.fields) {
                col.arrays[field] = (0, component_1.growField)(col.type.schema[field], col.arrays[field], capacity);
            }
        }
        this.capacity = capacity;
    }
}
exports.Archetype = Archetype;
/** Build the identity key for a set of component ids without allocating an Archetype. */
function archetypeKey(componentIds) {
    return componentIds.slice().sort((a, b) => a - b).join(',');
}
