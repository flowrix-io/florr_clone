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

import {
    allocField,
    clearFieldSlot,
    ComponentType,
    growField,
    Schema,
    ArrayFor,
    FieldType,
} from './component';
import { Entity, NULL_ENTITY } from './entity';

/** Initial row capacity of a freshly created archetype. */
const INITIAL_CAPACITY = 16;

/** The backing arrays for one component within one archetype. */
export interface Column {
    readonly type: ComponentType<any>;
    /** field name -> backing array, reallocated on growth. */
    arrays: Record<string, ArrayFor<FieldType>>;
}

/**
 * A bitset over component ids, used to match archetypes against queries.
 * Sized in 32-bit words so the component count is not capped at 32.
 */
export type ComponentMask = Uint32Array;

export function createMask(componentCapacity: number): ComponentMask {
    return new Uint32Array(Math.max(1, Math.ceil(componentCapacity / 32)));
}

export function maskSet(mask: ComponentMask, componentId: number): void {
    mask[componentId >>> 5] |= (1 << (componentId & 31)) >>> 0;
}

export function maskClear(mask: ComponentMask, componentId: number): void {
    mask[componentId >>> 5] &= ~((1 << (componentId & 31)) >>> 0);
}

export function maskHas(mask: ComponentMask, componentId: number): boolean {
    return (mask[componentId >>> 5] & ((1 << (componentId & 31)) >>> 0)) !== 0;
}

/** True when every bit set in `required` is also set in `mask`. */
export function maskContainsAll(mask: ComponentMask, required: ComponentMask): boolean {
    for (let i = 0; i < required.length; i++) {
        const r = required[i];
        if (r !== 0 && ((mask[i] ?? 0) & r) !== r) return false;
    }
    return true;
}

/** True when `mask` shares at least one bit with `any`. */
export function maskIntersects(mask: ComponentMask, any: ComponentMask): boolean {
    for (let i = 0; i < any.length; i++) {
        if (((mask[i] ?? 0) & any[i]) !== 0) return true;
    }
    return false;
}

export class Archetype {
    /** Component ids in this archetype, ascending. Also the identity key. */
    readonly componentIds: ReadonlyArray<number>;
    /** Stable string identity (`"3,7,12"`) used to dedupe archetypes. */
    readonly key: string;
    /** Membership bitset, tested by queries. */
    readonly mask: ComponentMask;
    /** Columns indexed by component id; holes for components not present. */
    readonly columns: Array<Column | undefined>;
    /** Entity handle occupying each row. Only `[0, count)` is meaningful. */
    entities: Float64Array;

    /**
     * This archetype's position in `World.archetypes`, assigned when the world
     * registers it. Stored here so moving an entity between archetypes is O(1)
     * instead of an `indexOf` scan — component add/remove is hot enough (every
     * poison application, every pet spawn) that a linear scan over every
     * archetype in the process would show up in profiles.
     */
    index = -1;

    count = 0;
    capacity = INITIAL_CAPACITY;

    /**
     * Bumped on every structural change (add/remove row). Query iterators read
     * this to fail loudly if a system mutates the world mid-iteration instead of
     * silently skipping or double-visiting entities.
     */
    version = 0;

    constructor(types: ReadonlyArray<ComponentType<any>>, componentCapacity: number) {
        const sorted = types.slice().sort((a, b) => a.id - b.id);
        this.componentIds = sorted.map(t => t.id);
        this.key = this.componentIds.join(',');
        this.mask = createMask(componentCapacity);
        this.columns = [];
        this.entities = new Float64Array(this.capacity);

        for (const type of sorted) {
            maskSet(this.mask, type.id);
            const arrays: Record<string, ArrayFor<FieldType>> = {};
            for (const field of type.fields) {
                arrays[field] = allocField(type.schema[field], this.capacity);
            }
            this.columns[type.id] = { type, arrays };
        }
    }

    has(componentId: number): boolean {
        return this.columns[componentId] !== undefined;
    }

    /** Typed access to one component's arrays. Returns undefined if absent. */
    column<S extends Schema>(type: ComponentType<S>): Column | undefined {
        return this.columns[type.id];
    }

    /**
     * Append a row for `entity` and return its index.
     * Field values are left at whatever the slot held; callers always write
     * every field immediately after (see World.add / moveEntity).
     */
    addRow(entity: Entity): number {
        if (this.count === this.capacity) this.grow(this.capacity * 2);
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
    removeRow(row: number): Entity {
        const last = this.count - 1;
        let moved = NULL_ENTITY;

        if (row !== last) {
            moved = this.entities[last] as Entity;
            this.entities[row] = moved;
            for (const col of this.columns) {
                if (!col) continue;
                for (const field of col.type.fields) {
                    const arr = col.arrays[field] as any;
                    arr[row] = arr[last];
                }
            }
        }

        // Always clear the vacated tail slot. For reference fields this is what
        // actually drops the last reference to loadouts/Maps/strings; leaving it
        // would pin dead entities' payloads in the heap for the process lifetime.
        for (const col of this.columns) {
            if (!col) continue;
            for (const field of col.type.fields) {
                clearFieldSlot(col.type.schema[field], col.arrays[field], last);
            }
        }
        this.entities[last] = NULL_ENTITY;

        this.count = last;
        this.version++;
        return moved;
    }

    private grow(capacity: number): void {
        const nextEntities = new Float64Array(capacity);
        nextEntities.set(this.entities);
        this.entities = nextEntities;

        for (const col of this.columns) {
            if (!col) continue;
            for (const field of col.type.fields) {
                col.arrays[field] = growField(col.type.schema[field], col.arrays[field], capacity);
            }
        }
        this.capacity = capacity;
    }
}

/** Build the identity key for a set of component ids without allocating an Archetype. */
export function archetypeKey(componentIds: ReadonlyArray<number>): string {
    return componentIds.slice().sort((a, b) => a - b).join(',');
}
