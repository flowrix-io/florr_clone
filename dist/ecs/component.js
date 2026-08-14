"use strict";
/**
 * Component types and their storage schemas.
 *
 * A component is declared once with `defineComponent(name, schema)`. The schema
 * names each field and the machine type it is stored as, which is what lets the
 * world lay components out as a struct-of-arrays: every field becomes its own
 * contiguous typed array, so a system that only reads `x`/`y` streams two tight
 * arrays instead of pulling whole objects (and everything else on them) through
 * cache.
 *
 * ---------------------------------------------------------------------------
 * Choosing a field type
 * ---------------------------------------------------------------------------
 * `f32` is the default for most numbers, but NOT for world coordinates. This
 * game places the maze at (200000, 200000) and the PVP arena far off-origin;
 * f32 has a 24-bit mantissa, so at 200k the representable step is ~0.015px and
 * accumulating per-tick movement there visibly drifts and jitters. Positions,
 * timestamps (`performance.now()` / `Date.now()` are far past f32 precision)
 * and entity handles therefore use `f64`.
 *
 * `obj` and `str` fall back to plain JS arrays. They exist because a lot of
 * genuinely cold per-entity state in this game is not numeric — poison-effect
 * lists, loadouts, damage-contributor Maps, socket ids. Putting them in an
 * `obj` column keeps them out of the hot numeric arrays while still moving with
 * the entity when it changes archetype. Prefer splitting cold `obj` fields into
 * their own component so hot systems never load the column at all.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineComponent = defineComponent;
exports.defineTag = defineTag;
exports.componentCount = componentCount;
exports.componentById = componentById;
exports.allComponents = allComponents;
exports.isNumericField = isNumericField;
exports.allocField = allocField;
exports.growField = growField;
exports.clearFieldSlot = clearFieldSlot;
/** Registry of every component declared in the process, indexed by `id`. */
const registry = [];
let nextComponentId = 0;
/**
 * Declare a component type.
 *
 * Must be called at module scope (not per-entity, not per-tick): ids are
 * assigned in declaration order and archetype bitmasks are sized from the total
 * count, so declaring components lazily would renumber storage mid-run.
 */
function defineComponent(name, schema = {}) {
    const fields = Object.keys(schema);
    for (const f of fields) {
        if (!isValidFieldType(schema[f])) {
            throw new Error(`Component "${name}" field "${f}" has unknown type "${String(schema[f])}"`);
        }
    }
    const type = {
        id: nextComponentId++,
        name,
        schema,
        fields: Object.freeze(fields),
        isTag: fields.length === 0,
    };
    registry.push(type);
    return type;
}
/** A component carrying no data — membership only (e.g. `IsPet`, `IsDead`). */
function defineTag(name) {
    return defineComponent(name, {});
}
/** How many component types have been declared. Sizes archetype bitmasks. */
function componentCount() {
    return nextComponentId;
}
/** Look up a declared component by id (diagnostics, debug dumps). */
function componentById(id) {
    return registry[id];
}
/** Every declared component, in declaration order. */
function allComponents() {
    return registry;
}
const VALID_FIELD_TYPES = new Set([
    'f64', 'f32', 'i32', 'u32', 'i16', 'u16', 'i8', 'u8', 'bool', 'entity', 'obj', 'str',
]);
function isValidFieldType(t) {
    return VALID_FIELD_TYPES.has(t);
}
/** True when the field type is backed by a typed array rather than a JS array. */
function isNumericField(t) {
    return t !== 'obj' && t !== 'str';
}
/**
 * Allocate the backing array for one field at a given capacity.
 * Reference fields get a plain array pre-filled with `undefined`.
 */
function allocField(type, capacity) {
    switch (type) {
        case 'f64': return new Float64Array(capacity);
        case 'f32': return new Float32Array(capacity);
        case 'i32': return new Int32Array(capacity);
        case 'u32': return new Uint32Array(capacity);
        case 'i16': return new Int16Array(capacity);
        case 'u16': return new Uint16Array(capacity);
        case 'i8': return new Int8Array(capacity);
        case 'u8': return new Uint8Array(capacity);
        case 'bool': return new Uint8Array(capacity);
        case 'entity': return new Float64Array(capacity);
        case 'str': return new Array(capacity);
        case 'obj': return new Array(capacity);
    }
}
/**
 * Grow a field's backing array to `capacity`, preserving existing values.
 * Typed arrays are reallocated and blitted; JS arrays just have their length set
 * (which leaves a sparse tail — written before it is ever read).
 */
function growField(type, old, capacity) {
    if (!isNumericField(type)) {
        old.length = capacity;
        return old;
    }
    const next = allocField(type, capacity);
    next.set(old);
    return next;
}
/**
 * Clear one slot of a field back to its zero value.
 *
 * Typed arrays are zeroed for hygiene; REFERENCE fields must be cleared because
 * a lingering pointer in a recycled slot would keep a dead entity's loadout,
 * Map or socket id reachable forever. That is exactly the shape of the heap leak
 * that used to crash long-running servers, so this is not optional.
 */
function clearFieldSlot(type, arr, row) {
    if (isNumericField(type)) {
        arr[row] = 0;
    }
    else {
        arr[row] = undefined;
    }
}
