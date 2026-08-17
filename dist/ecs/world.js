"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.World = exports.Query = exports.EntityCursor = void 0;
const archetype_1 = require("./archetype");
const component_1 = require("./component");
const entity_1 = require("./entity");
/** Initial number of entity slots; grows geometrically. */
const INITIAL_SLOTS = 1024;
class ChunkView {
    constructor() {
        this.count = 0;
    }
    has(type) {
        return this.archetype.columns[type.id] !== undefined;
    }
    cols(type) {
        const col = this.archetype.columns[type.id];
        if (col === undefined) {
            throw new Error(`Chunk does not contain component "${type.name}". ` +
                `Add it to the query, or use an optional-component branch.`);
        }
        return col.arrays;
    }
}
/**
 * One entity's storage location, resolved once.
 *
 * `get`/`set`/`write`/`has` each re-derive the same three things from the
 * handle: liveness, archetype, row. That is the right trade for a handful of
 * accesses, and the wrong one for the bridge passes in server/ecsSync.ts, which
 * touch a dozen-odd fields on every mob every tick and were paying the
 * resolution a dozen-odd times per mob. Seek once, then index the columns.
 *
 * Use it exactly like a Chunk's arrays, at `cursor.row`:
 *
 *   if (world.seek(entity, cursor)) {
 *       const pos = cursor.cols(C.Position);
 *       enemy.x = pos.x[cursor.row];
 *   }
 *
 * ⚠️ A cursor is only valid until the next STRUCTURAL change to the world —
 * `add`, `remove`, `destroy` or anything that moves an entity between
 * archetypes, including on a DIFFERENT entity (rows are swap-removed, so
 * another entity's destroy can relocate this row). Re-seek after any of those.
 * Plain field writes never invalidate it.
 */
class EntityCursor {
    constructor() {
        /** The sought entity's row within `archetype`, or -1 when unseated. */
        this.row = -1;
    }
    /** Whether the sought entity carries `type`. */
    has(type) {
        return this.archetype.columns[type.id] !== undefined;
    }
    /** The backing arrays for `type`, or undefined when the entity lacks it. */
    cols(type) {
        const col = this.archetype.columns[type.id];
        return col === undefined ? undefined : col.arrays;
    }
    /**
     * The backing arrays for `type`, which the caller knows is present.
     * Throws otherwise, so a wrong assumption fails loudly instead of reading
     * `undefined[row]`.
     */
    need(type) {
        const col = this.archetype.columns[type.id];
        if (col === undefined) {
            throw new Error(`Cursor entity has no component "${type.name}"`);
        }
        return col.arrays;
    }
}
exports.EntityCursor = EntityCursor;
/**
 * A cached set of archetypes matching a component filter.
 *
 * Queries are created once (ideally at module scope or system construction) and
 * re-iterated every tick. The matching archetype list is rebuilt only when the
 * world grows a new archetype, so steady-state iteration costs nothing beyond
 * the loop itself.
 */
class Query {
    constructor(world, all, none = []) {
        this.world = world;
        this.matched = [];
        this.seenArchetypes = -1;
        const cap = Math.max((0, component_1.componentCount)(), 1);
        this.all = (0, archetype_1.createMask)(cap);
        this.none = (0, archetype_1.createMask)(cap);
        for (const t of all)
            (0, archetype_1.maskSet)(this.all, t.id);
        for (const t of none)
            (0, archetype_1.maskSet)(this.none, t.id);
    }
    /** Refresh the archetype list if the world has grown new archetypes. */
    refresh() {
        const archetypes = this.world.archetypes;
        if (this.seenArchetypes === archetypes.length)
            return;
        this.matched.length = 0;
        for (const a of archetypes) {
            if ((0, archetype_1.maskContainsAll)(a.mask, this.all) && !(0, archetype_1.maskIntersects)(a.mask, this.none)) {
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
    chunks(fn) {
        this.refresh();
        const view = this.world.chunkView;
        for (const a of this.matched) {
            if (a.count === 0)
                continue;
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
    collect(out = []) {
        out.length = 0;
        this.refresh();
        for (const a of this.matched) {
            for (let i = 0; i < a.count; i++)
                out.push(a.entities[i]);
        }
        return out;
    }
    /** Number of entities currently matching. */
    count() {
        this.refresh();
        let n = 0;
        for (const a of this.matched)
            n += a.count;
        return n;
    }
}
exports.Query = Query;
class World {
    constructor() {
        // --- entity table --------------------------------------------------------
        this.generations = new Uint32Array(INITIAL_SLOTS);
        this.alive = new Uint8Array(INITIAL_SLOTS);
        this.archetypeOf = new Int32Array(INITIAL_SLOTS).fill(-1);
        this.rowOf = new Int32Array(INITIAL_SLOTS).fill(-1);
        this.freeSlots = [];
        /**
         * Starts at 1: slot 0 is permanently reserved and never handed out, because
         * index 0 with generation 0 packs to the handle `0` — which is NULL_ENTITY.
         * Without this the very first entity created would be indistinguishable from
         * "no entity", and every zero-filled `entity` column would appear to point
         * at it.
         */
        this.slotCount = 1;
        this.capacity = INITIAL_SLOTS;
        // --- archetypes ----------------------------------------------------------
        this.archetypes = [];
        this.archetypeByKey = new Map();
        /** Reused chunk view; see Query.chunks. */
        this.chunkView = new ChunkView();
        /** Live entity count. */
        this.liveCount = 0;
        /**
         * String id <-> entity, for the parts of the game that address entities by
         * socket id or mob id (the wire protocol, squads, pet ownership, targeting).
         * Kept here rather than in a component so `destroy` can drop both directions
         * in one place and never leak an id.
         */
        this.byExternalId = new Map();
        this.externalIds = [];
        // The empty archetype (no components) holds freshly created entities.
        this.getOrCreateArchetype([]);
    }
    // -------------------------------------------------------------------------
    // Entity lifecycle
    // -------------------------------------------------------------------------
    /** Create an entity with no components. */
    create() {
        let index;
        if (this.freeSlots.length > 0) {
            index = this.freeSlots.pop();
        }
        else {
            index = this.slotCount++;
            if (index >= this.capacity)
                this.growSlots(this.capacity * 2);
        }
        const entity = (0, entity_1.makeEntity)(index, this.generations[index]);
        this.alive[index] = 1;
        this.liveCount++;
        const empty = this.archetypes[0];
        this.archetypeOf[index] = 0;
        this.rowOf[index] = empty.addRow(entity);
        return entity;
    }
    /** True when the handle refers to a live entity (right generation). */
    isAlive(e) {
        if (e === entity_1.NULL_ENTITY)
            return false;
        const index = (0, entity_1.entityIndex)(e);
        return index < this.slotCount
            && this.alive[index] === 1
            && this.generations[index] === (0, entity_1.entityGeneration)(e);
    }
    /**
     * Destroy an entity and free its slot.
     *
     * Bumps the slot's generation so every outstanding handle to it goes stale.
     * Safe to call on an already-dead handle (returns false).
     */
    destroy(e) {
        if (!this.isAlive(e))
            return false;
        const index = (0, entity_1.entityIndex)(e);
        const archetype = this.archetypes[this.archetypeOf[index]];
        this.releaseRow(archetype, this.rowOf[index]);
        const externalId = this.externalIds[index];
        if (externalId !== undefined) {
            this.byExternalId.delete(externalId);
            this.externalIds[index] = undefined;
        }
        this.alive[index] = 0;
        this.archetypeOf[index] = -1;
        this.rowOf[index] = -1;
        // Wrap rather than overflow the Uint32Array; see entity.ts on why the
        // generation space is large enough that this is not a practical concern.
        this.generations[index] = (this.generations[index] + 1) % entity_1.ENTITY_MAX_GENERATION;
        this.freeSlots.push(index);
        this.liveCount--;
        return true;
    }
    /** Number of live entities. */
    size() {
        return this.liveCount;
    }
    // -------------------------------------------------------------------------
    // Components
    // -------------------------------------------------------------------------
    /** True when `e` currently has `type`. */
    has(e, type) {
        if (!this.isAlive(e))
            return false;
        return this.archetypes[this.archetypeOf[(0, entity_1.entityIndex)(e)]].has(type.id);
    }
    /**
     * Point `cursor` at `e`'s storage. Returns false (leaving the cursor
     * unseated) when the handle is dead or stale.
     *
     * For code that reads or writes several fields on one entity — see
     * EntityCursor for the invalidation rule, which is the whole risk of using
     * this instead of the scalar accessors.
     */
    seek(e, cursor) {
        if (!this.isAlive(e)) {
            cursor.row = -1;
            return false;
        }
        const index = (0, entity_1.entityIndex)(e);
        cursor.archetype = this.archetypes[this.archetypeOf[index]];
        cursor.row = this.rowOf[index];
        return true;
    }
    /**
     * Add `type` to `e`, initialising the given fields (others start zeroed).
     * No-op apart from applying `values` when the entity already has it.
     */
    add(e, type, values) {
        this.assertAlive(e, 'add');
        const index = (0, entity_1.entityIndex)(e);
        const from = this.archetypes[this.archetypeOf[index]];
        if (!from.has(type.id)) {
            const ids = from.componentIds.slice();
            ids.push(type.id);
            const to = this.getOrCreateArchetypeByIds(ids);
            this.moveEntity(e, index, from, to);
            // Zero the destination slot: the row may be recycled storage.
            const col = to.columns[type.id];
            const row = this.rowOf[index];
            for (const field of type.fields) {
                const arr = col.arrays[field];
                arr[row] = type.schema[field] === 'obj' || type.schema[field] === 'str' ? undefined : 0;
            }
        }
        if (values)
            this.write(e, type, values);
    }
    /** Remove `type` from `e`. No-op when absent. */
    remove(e, type) {
        this.assertAlive(e, 'remove');
        const index = (0, entity_1.entityIndex)(e);
        const from = this.archetypes[this.archetypeOf[index]];
        if (!from.has(type.id))
            return;
        const ids = from.componentIds.filter(id => id !== type.id);
        const to = this.getOrCreateArchetypeByIds(ids);
        this.moveEntity(e, index, from, to);
    }
    /** Read one field. Throws if the entity lacks the component. */
    get(e, type, field) {
        this.assertAlive(e, 'get');
        const index = (0, entity_1.entityIndex)(e);
        const archetype = this.archetypes[this.archetypeOf[index]];
        const col = archetype.columns[type.id];
        if (!col)
            throw new Error(`${(0, entity_1.entityToString)(e)} has no component "${type.name}"`);
        return col.arrays[field][this.rowOf[index]];
    }
    /** Write one field. Throws if the entity lacks the component. */
    set(e, type, field, value) {
        this.assertAlive(e, 'set');
        const index = (0, entity_1.entityIndex)(e);
        const archetype = this.archetypes[this.archetypeOf[index]];
        const col = archetype.columns[type.id];
        if (!col)
            throw new Error(`${(0, entity_1.entityToString)(e)} has no component "${type.name}"`);
        col.arrays[field][this.rowOf[index]] = value;
    }
    /** Write several fields at once. */
    write(e, type, values) {
        this.assertAlive(e, 'write');
        const index = (0, entity_1.entityIndex)(e);
        const archetype = this.archetypes[this.archetypeOf[index]];
        const col = archetype.columns[type.id];
        if (!col)
            throw new Error(`${(0, entity_1.entityToString)(e)} has no component "${type.name}"`);
        const row = this.rowOf[index];
        for (const field in values) {
            const v = values[field];
            if (v === undefined)
                continue;
            col.arrays[field][row] = v;
        }
    }
    /**
     * Read every field of a component into a plain object.
     * Allocates — for debug dumps, persistence and wire encoding, not hot loops.
     */
    snapshot(e, type) {
        this.assertAlive(e, 'snapshot');
        const index = (0, entity_1.entityIndex)(e);
        const col = this.archetypes[this.archetypeOf[index]].columns[type.id];
        if (!col)
            throw new Error(`${(0, entity_1.entityToString)(e)} has no component "${type.name}"`);
        const row = this.rowOf[index];
        const out = {};
        for (const field of type.fields)
            out[field] = col.arrays[field][row];
        return out;
    }
    /** Every component type currently on `e`. Diagnostics only. */
    componentsOf(e) {
        this.assertAlive(e, 'componentsOf');
        const archetype = this.archetypes[this.archetypeOf[(0, entity_1.entityIndex)(e)]];
        const out = [];
        for (const col of archetype.columns)
            if (col)
                out.push(col.type);
        return out;
    }
    // -------------------------------------------------------------------------
    // Queries
    // -------------------------------------------------------------------------
    /**
     * Build a query for entities having all of `all` and none of `none`.
     * Create these ONCE and reuse; constructing one per tick defeats the cache.
     */
    query(all, none = []) {
        return new Query(this, all, none);
    }
    // -------------------------------------------------------------------------
    // External string ids
    // -------------------------------------------------------------------------
    /** Associate a string id (socket id, mob id) with an entity. */
    bindExternalId(e, id) {
        this.assertAlive(e, 'bindExternalId');
        const index = (0, entity_1.entityIndex)(e);
        const previous = this.externalIds[index];
        if (previous !== undefined)
            this.byExternalId.delete(previous);
        this.externalIds[index] = id;
        this.byExternalId.set(id, e);
    }
    /** Look up an entity by its string id, if it is still alive. */
    lookup(id) {
        const e = this.byExternalId.get(id);
        if (e === undefined)
            return undefined;
        if (!this.isAlive(e)) {
            this.byExternalId.delete(id);
            return undefined;
        }
        return e;
    }
    /** The string id bound to `e`, if any. */
    externalIdOf(e) {
        if (!this.isAlive(e))
            return undefined;
        return this.externalIds[(0, entity_1.entityIndex)(e)];
    }
    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------
    assertAlive(e, op) {
        if (!this.isAlive(e)) {
            throw new Error(`${op}() called on dead or invalid entity ${(0, entity_1.entityToString)(e)}`);
        }
    }
    growSlots(capacity) {
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
    getOrCreateArchetype(types) {
        return this.getOrCreateArchetypeByIds(types.map(t => t.id));
    }
    getOrCreateArchetypeByIds(ids) {
        const key = (0, archetype_1.archetypeKey)(ids);
        const existing = this.archetypeByKey.get(key);
        if (existing)
            return existing;
        const types = [];
        for (const id of ids) {
            const t = componentByIdOrThrow(id);
            types.push(t);
        }
        const archetype = new archetype_1.Archetype(types, Math.max((0, component_1.componentCount)(), 1));
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
    moveEntity(e, index, from, to) {
        const fromRow = this.rowOf[index];
        const toRow = to.addRow(e);
        for (const id of to.componentIds) {
            const src = from.columns[id];
            if (!src)
                continue;
            const dst = to.columns[id];
            for (const field of src.type.fields) {
                dst.arrays[field][toRow] = src.arrays[field][fromRow];
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
    releaseRow(archetype, row) {
        const moved = archetype.removeRow(row);
        if (moved !== entity_1.NULL_ENTITY) {
            this.rowOf[(0, entity_1.entityIndex)(moved)] = row;
        }
    }
}
exports.World = World;
function componentByIdOrThrow(id) {
    const t = (0, component_1.componentById)(id);
    if (!t)
        throw new Error(`Unknown component id ${id} — was defineComponent() called at module scope?`);
    return t;
}
