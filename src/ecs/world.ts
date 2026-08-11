/**
 * The World: entity table, archetype graph, and component access.
 *
 * Layout, top to bottom:
 *
 *   Entity handle  ->  (archetype, row)          this file's `archetypeOf`/`rowOf`
 *   Archetype      ->  one column per component  archetype.ts
 *   Column         ->  one typed array per field component.ts
 *
 * Adding or removing a component MOVES the entity to a different archetype,
 * which is the expensive operation in this design (it copies every shared field
 * and swap-removes the old row). Components that toggle every few ticks should
 * therefore be a numeric field or a bool flag on a component the entity always
 * has — not their own tag. Components that describe what an entity fundamentally
 * *is* (a projectile, a pet, a centipede segment) are what tags are for.
 */

import {
    Archetype,
    archetypeKey,
    ComponentMask,
    createMask,
    maskContainsAll,
    maskIntersects,
    maskSet,
} from './archetype';
import {
    componentById,
    ComponentType,
    Columns,
    componentCount,
    Schema,
} from './component';
import {
    Entity,
    ENTITY_MAX_GENERATION,
    entityGeneration,
    entityIndex,
    entityToString,
    makeEntity,
    NULL_ENTITY,
} from './entity';

/** Initial number of entity slots; grows geometrically. */
const INITIAL_SLOTS = 1024;

/**
 * Values used to initialise a component when it is added.
 *
 * Deliberately `unknown` per field rather than a union of the storable
 * primitives: `obj` columns legitimately hold arbitrary payloads (loadouts,
 * Maps, config objects) that callers often have only as `unknown`, and a
 * narrower type here would force a cast at every prefab call site without
 * catching anything — the field's storage type already decides how the value is
 * used.
 */
export type ComponentInit<S extends Schema> = { [K in keyof S]?: unknown };

/**
 * One archetype's worth of rows handed to a system.
 *
 * `count` is the number of live rows; iterate `0 <= i < count`. `entities[i]`
 * is the handle for row `i`. Column arrays are fetched once per chunk and then
 * indexed directly — that hoisting is the whole point of the chunked API, so
 * always pull the arrays out ABOVE the row loop, never inside it.
 */
export interface Chunk {
    readonly archetype: Archetype;
    readonly count: number;
    readonly entities: Float64Array;
    /** The backing arrays for `type` in this chunk. Throws if not present. */
    cols<S extends Schema>(type: ComponentType<S>): Columns<S>;
}

class ChunkView implements Chunk {
    archetype!: Archetype;
    count = 0;
    entities!: Float64Array;

    cols<S extends Schema>(type: ComponentType<S>): Columns<S> {
        const col = this.archetype.columns[type.id];
        if (col === undefined) {
            throw new Error(
                `Chunk does not contain component "${type.name}". ` +
                `Add it to the query, or use an optional-component branch.`,
            );
        }
        return col.arrays as Columns<S>;
    }
}

/**
 * A cached set of archetypes matching a component filter.
 *
 * Queries are created once (ideally at module scope or system construction) and
 * re-iterated every tick. The matching archetype list is rebuilt only when the
 * world grows a new archetype, so steady-state iteration costs nothing beyond
 * the loop itself.
 */
export class Query {
    private readonly all: ComponentMask;
    private readonly none: ComponentMask;
    private readonly matched: Archetype[] = [];
    private seenArchetypes = -1;

    constructor(
        private readonly world: World,
        all: ReadonlyArray<ComponentType<any>>,
        none: ReadonlyArray<ComponentType<any>> = [],
    ) {
        const cap = Math.max(componentCount(), 1);
        this.all = createMask(cap);
        this.none = createMask(cap);
        for (const t of all) maskSet(this.all, t.id);
        for (const t of none) maskSet(this.none, t.id);
    }

    /** Refresh the archetype list if the world has grown new archetypes. */
    private refresh(): void {
        const archetypes = this.world.archetypes;
        if (this.seenArchetypes === archetypes.length) return;
        this.matched.length = 0;
        for (const a of archetypes) {
            if (maskContainsAll(a.mask, this.all) && !maskIntersects(a.mask, this.none)) {
                this.matched.push(a);
            }
        }
        this.seenArchetypes = archetypes.length;
    }

    /**
     * Run `fn` over every matching chunk.
     *
     * The chunk view is REUSED between calls to avoid per-tick allocation, so
     * never retain it past the callback.
     */
    chunks(fn: (chunk: Chunk) => void): void {
        this.refresh();
        const view = this.world.chunkView;
        for (const a of this.matched) {
            if (a.count === 0) continue;
            view.archetype = a;
            view.count = a.count;
            view.entities = a.entities;
            fn(view);
        }
    }

    /**
     * Collect matching entities into an array.
     *
     * Allocates, so it is for setup/teardown/debug paths and for the "destroy
     * everything matching" case — never a per-tick hot loop. Taking a snapshot
     * first is also what makes structural mutation safe while acting on results.
     */
    collect(out: Entity[] = []): Entity[] {
        out.length = 0;
        this.refresh();
        for (const a of this.matched) {
            for (let i = 0; i < a.count; i++) out.push(a.entities[i] as Entity);
        }
        return out;
    }

    /** Number of entities currently matching. */
    count(): number {
        this.refresh();
        let n = 0;
        for (const a of this.matched) n += a.count;
        return n;
    }
}

export class World {
    // --- entity table --------------------------------------------------------
    private generations = new Uint32Array(INITIAL_SLOTS);
    private alive = new Uint8Array(INITIAL_SLOTS);
    private archetypeOf = new Int32Array(INITIAL_SLOTS).fill(-1);
    private rowOf = new Int32Array(INITIAL_SLOTS).fill(-1);
    private freeSlots: number[] = [];
    /**
     * Starts at 1: slot 0 is permanently reserved and never handed out, because
     * index 0 with generation 0 packs to the handle `0` — which is NULL_ENTITY.
     * Without this the very first entity created would be indistinguishable from
     * "no entity", and every zero-filled `entity` column would appear to point
     * at it.
     */
    private slotCount = 1;
    private capacity = INITIAL_SLOTS;

    // --- archetypes ----------------------------------------------------------
    readonly archetypes: Archetype[] = [];
    private readonly archetypeByKey = new Map<string, Archetype>();

    /** Reused chunk view; see Query.chunks. */
    readonly chunkView = new ChunkView();

    /** Live entity count. */
    private liveCount = 0;

    /**
     * String id <-> entity, for the parts of the game that address entities by
     * socket id or mob id (the wire protocol, squads, pet ownership, targeting).
     * Kept here rather than in a component so `destroy` can drop both directions
     * in one place and never leak an id.
     */
    private readonly byExternalId = new Map<string, Entity>();
    private readonly externalIds: string[] = [];

    constructor() {
        // The empty archetype (no components) holds freshly created entities.
        this.getOrCreateArchetype([]);
    }

    // -------------------------------------------------------------------------
    // Entity lifecycle
    // -------------------------------------------------------------------------

    /** Create an entity with no components. */
    create(): Entity {
        let index: number;
        if (this.freeSlots.length > 0) {
            index = this.freeSlots.pop()!;
        } else {
            index = this.slotCount++;
            if (index >= this.capacity) this.growSlots(this.capacity * 2);
        }

        const entity = makeEntity(index, this.generations[index]);
        this.alive[index] = 1;
        this.liveCount++;

        const empty = this.archetypes[0];
        this.archetypeOf[index] = 0;
        this.rowOf[index] = empty.addRow(entity);
        return entity;
    }

    /** True when the handle refers to a live entity (right generation). */
    isAlive(e: Entity): boolean {
        if (e === NULL_ENTITY) return false;
        const index = entityIndex(e);
        return index < this.slotCount
            && this.alive[index] === 1
            && this.generations[index] === entityGeneration(e);
    }

    /**
     * Destroy an entity and free its slot.
     *
     * Bumps the slot's generation so every outstanding handle to it goes stale.
     * Safe to call on an already-dead handle (returns false).
     */
    destroy(e: Entity): boolean {
        if (!this.isAlive(e)) return false;
        const index = entityIndex(e);

        const archetype = this.archetypes[this.archetypeOf[index]];
        this.releaseRow(archetype, this.rowOf[index]);

        const externalId = this.externalIds[index];
        if (externalId !== undefined) {
            this.byExternalId.delete(externalId);
            this.externalIds[index] = undefined as unknown as string;
        }

        this.alive[index] = 0;
        this.archetypeOf[index] = -1;
        this.rowOf[index] = -1;
        // Wrap rather than overflow the Uint32Array; see entity.ts on why the
        // generation space is large enough that this is not a practical concern.
        this.generations[index] = (this.generations[index] + 1) % ENTITY_MAX_GENERATION;
        this.freeSlots.push(index);
        this.liveCount--;
        return true;
    }

    /** Number of live entities. */
    size(): number {
        return this.liveCount;
    }

    // -------------------------------------------------------------------------
    // Components
    // -------------------------------------------------------------------------

    /** True when `e` currently has `type`. */
    has(e: Entity, type: ComponentType<any>): boolean {
        if (!this.isAlive(e)) return false;
        return this.archetypes[this.archetypeOf[entityIndex(e)]].has(type.id);
    }

    /**
     * Add `type` to `e`, initialising the given fields (others start zeroed).
     * No-op apart from applying `values` when the entity already has it.
     */
    add<S extends Schema>(e: Entity, type: ComponentType<S>, values?: ComponentInit<S>): void {
        this.assertAlive(e, 'add');
        const index = entityIndex(e);
        const from = this.archetypes[this.archetypeOf[index]];

        if (!from.has(type.id)) {
            const ids = from.componentIds.slice();
            ids.push(type.id);
            const to = this.getOrCreateArchetypeByIds(ids);
            this.moveEntity(e, index, from, to);
            // Zero the destination slot: the row may be recycled storage.
            const col = to.columns[type.id]!;
            const row = this.rowOf[index];
            for (const field of type.fields) {
                const arr = col.arrays[field] as any;
                arr[row] = type.schema[field] === 'obj' || type.schema[field] === 'str' ? undefined : 0;
            }
        }

        if (values) this.write(e, type, values);
    }

    /** Remove `type` from `e`. No-op when absent. */
    remove(e: Entity, type: ComponentType<any>): void {
        this.assertAlive(e, 'remove');
        const index = entityIndex(e);
        const from = this.archetypes[this.archetypeOf[index]];
        if (!from.has(type.id)) return;

        const ids = from.componentIds.filter(id => id !== type.id);
        const to = this.getOrCreateArchetypeByIds(ids);
        this.moveEntity(e, index, from, to);
    }

    /** Read one field. Throws if the entity lacks the component. */
    get<S extends Schema, K extends Extract<keyof S, string>>(
        e: Entity,
        type: ComponentType<S>,
        field: K,
    ): any {
        this.assertAlive(e, 'get');
        const index = entityIndex(e);
        const archetype = this.archetypes[this.archetypeOf[index]];
        const col = archetype.columns[type.id];
        if (!col) throw new Error(`${entityToString(e)} has no component "${type.name}"`);
        return (col.arrays[field] as any)[this.rowOf[index]];
    }

    /** Write one field. Throws if the entity lacks the component. */
    set<S extends Schema, K extends Extract<keyof S, string>>(
        e: Entity,
        type: ComponentType<S>,
        field: K,
        value: any,
    ): void {
        this.assertAlive(e, 'set');
        const index = entityIndex(e);
        const archetype = this.archetypes[this.archetypeOf[index]];
        const col = archetype.columns[type.id];
        if (!col) throw new Error(`${entityToString(e)} has no component "${type.name}"`);
        (col.arrays[field] as any)[this.rowOf[index]] = value;
    }

    /** Write several fields at once. */
    write<S extends Schema>(e: Entity, type: ComponentType<S>, values: ComponentInit<S>): void {
        this.assertAlive(e, 'write');
        const index = entityIndex(e);
        const archetype = this.archetypes[this.archetypeOf[index]];
        const col = archetype.columns[type.id];
        if (!col) throw new Error(`${entityToString(e)} has no component "${type.name}"`);
        const row = this.rowOf[index];
        for (const field in values) {
            const v = values[field];
            if (v === undefined) continue;
            (col.arrays[field] as any)[row] = v;
        }
    }

    /**
     * Read every field of a component into a plain object.
     * Allocates — for debug dumps, persistence and wire encoding, not hot loops.
     */
    snapshot<S extends Schema>(e: Entity, type: ComponentType<S>): Record<string, any> {
        this.assertAlive(e, 'snapshot');
        const index = entityIndex(e);
        const col = this.archetypes[this.archetypeOf[index]].columns[type.id];
        if (!col) throw new Error(`${entityToString(e)} has no component "${type.name}"`);
        const row = this.rowOf[index];
        const out: Record<string, any> = {};
        for (const field of type.fields) out[field] = (col.arrays[field] as any)[row];
        return out;
    }

    /** Every component type currently on `e`. Diagnostics only. */
    componentsOf(e: Entity): ComponentType<any>[] {
        this.assertAlive(e, 'componentsOf');
        const archetype = this.archetypes[this.archetypeOf[entityIndex(e)]];
        const out: ComponentType<any>[] = [];
        for (const col of archetype.columns) if (col) out.push(col.type);
        return out;
    }

    // -------------------------------------------------------------------------
    // Queries
    // -------------------------------------------------------------------------

    /**
     * Build a query for entities having all of `all` and none of `none`.
     * Create these ONCE and reuse; constructing one per tick defeats the cache.
     */
    query(all: ReadonlyArray<ComponentType<any>>, none: ReadonlyArray<ComponentType<any>> = []): Query {
        return new Query(this, all, none);
    }

    // -------------------------------------------------------------------------
    // External string ids
    // -------------------------------------------------------------------------

    /** Associate a string id (socket id, mob id) with an entity. */
    bindExternalId(e: Entity, id: string): void {
        this.assertAlive(e, 'bindExternalId');
        const index = entityIndex(e);
        const previous = this.externalIds[index];
        if (previous !== undefined) this.byExternalId.delete(previous);
        this.externalIds[index] = id;
        this.byExternalId.set(id, e);
    }

    /** Look up an entity by its string id, if it is still alive. */
    lookup(id: string): Entity | undefined {
        const e = this.byExternalId.get(id);
        if (e === undefined) return undefined;
        if (!this.isAlive(e)) {
            this.byExternalId.delete(id);
            return undefined;
        }
        return e;
    }

    /** The string id bound to `e`, if any. */
    externalIdOf(e: Entity): string | undefined {
        if (!this.isAlive(e)) return undefined;
        return this.externalIds[entityIndex(e)];
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private assertAlive(e: Entity, op: string): void {
        if (!this.isAlive(e)) {
            throw new Error(`${op}() called on dead or invalid entity ${entityToString(e)}`);
        }
    }

    private growSlots(capacity: number): void {
        const generations = new Uint32Array(capacity);
        generations.set(this.generations);
        this.generations = generations;

        const alive = new Uint8Array(capacity);
        alive.set(this.alive);
        this.alive = alive;

        const archetypeOf = new Int32Array(capacity).fill(-1);
        archetypeOf.set(this.archetypeOf);
        this.archetypeOf = archetypeOf;

        const rowOf = new Int32Array(capacity).fill(-1);
        rowOf.set(this.rowOf);
        this.rowOf = rowOf;

        this.externalIds.length = capacity;
        this.capacity = capacity;
    }

    private getOrCreateArchetype(types: ReadonlyArray<ComponentType<any>>): Archetype {
        return this.getOrCreateArchetypeByIds(types.map(t => t.id));
    }

    private getOrCreateArchetypeByIds(ids: ReadonlyArray<number>): Archetype {
        const key = archetypeKey(ids);
        const existing = this.archetypeByKey.get(key);
        if (existing) return existing;

        const types: ComponentType<any>[] = [];
        for (const id of ids) {
            const t = componentByIdOrThrow(id);
            types.push(t);
        }
        const archetype = new Archetype(types, Math.max(componentCount(), 1));
        archetype.index = this.archetypes.length;
        this.archetypeByKey.set(key, archetype);
        this.archetypes.push(archetype);
        return archetype;
    }

    /**
     * Move `e` from one archetype to another, carrying over every component the
     * two have in common. Components only in `from` are dropped; components only
     * in `to` are left for the caller to initialise.
     */
    private moveEntity(e: Entity, index: number, from: Archetype, to: Archetype): void {
        const fromRow = this.rowOf[index];
        const toRow = to.addRow(e);

        for (const id of to.componentIds) {
            const src = from.columns[id];
            if (!src) continue;
            const dst = to.columns[id]!;
            for (const field of src.type.fields) {
                (dst.arrays[field] as any)[toRow] = (src.arrays[field] as any)[fromRow];
            }
        }

        this.archetypeOf[index] = to.index;
        this.rowOf[index] = toRow;
        this.releaseRow(from, fromRow);
    }

    /**
     * Swap-remove `row` from `archetype` and repair the location of whichever
     * entity was moved into the hole.
     */
    private releaseRow(archetype: Archetype, row: number): void {
        const moved = archetype.removeRow(row);
        if (moved !== NULL_ENTITY) {
            this.rowOf[entityIndex(moved)] = row;
        }
    }
}

function componentByIdOrThrow(id: number): ComponentType<any> {
    const t = componentById(id);
    if (!t) throw new Error(`Unknown component id ${id} — was defineComponent() called at module scope?`);
    return t;
}
