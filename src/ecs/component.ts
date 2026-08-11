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

/** Field types backed by a typed array. */
export type NumericFieldType =
    | 'f64' | 'f32'
    | 'i32' | 'u32'
    | 'i16' | 'u16'
    | 'i8' | 'u8'
    | 'bool'      // Uint8Array, 0 or 1
    | 'entity';   // Float64Array — handles exceed 32 bits, see entity.ts

/** Field types backed by a plain JS array (cold / non-numeric data). */
export type ReferenceFieldType = 'obj' | 'str';

export type FieldType = NumericFieldType | ReferenceFieldType;

/** A component's field layout: field name -> storage type. */
export interface Schema {
    readonly [field: string]: FieldType;
}

/** The concrete array type a given field type is stored in. */
export type ArrayFor<T extends FieldType> =
    T extends 'f64' ? Float64Array :
    T extends 'f32' ? Float32Array :
    T extends 'i32' ? Int32Array :
    T extends 'u32' ? Uint32Array :
    T extends 'i16' ? Int16Array :
    T extends 'u16' ? Uint16Array :
    T extends 'i8' ? Int8Array :
    T extends 'u8' ? Uint8Array :
    T extends 'bool' ? Uint8Array :
    T extends 'entity' ? Float64Array :
    T extends 'str' ? string[] :
    T extends 'obj' ? any[] :
    never;

/** The set of arrays backing one component inside one archetype. */
export type Columns<S extends Schema> = { [K in keyof S]: ArrayFor<S[K]> };

/**
 * A declared component type. `id` is a dense integer assigned in declaration
 * order and is what archetypes key on; the object identity is what user code
 * passes around.
 */
export interface ComponentType<S extends Schema = Schema> {
    readonly id: number;
    readonly name: string;
    readonly schema: S;
    /** Field names, frozen in declaration order, for fast iteration. */
    readonly fields: ReadonlyArray<Extract<keyof S, string>>;
    /** True when the component carries no data and is pure membership. */
    readonly isTag: boolean;
}

/** Registry of every component declared in the process, indexed by `id`. */
const registry: ComponentType<any>[] = [];

let nextComponentId = 0;

/**
 * Declare a component type.
 *
 * Must be called at module scope (not per-entity, not per-tick): ids are
 * assigned in declaration order and archetype bitmasks are sized from the total
 * count, so declaring components lazily would renumber storage mid-run.
 */
export function defineComponent<S extends Schema>(name: string, schema: S = {} as S): ComponentType<S> {
    const fields = Object.keys(schema) as Extract<keyof S, string>[];
    for (const f of fields) {
        if (!isValidFieldType(schema[f])) {
            throw new Error(`Component "${name}" field "${f}" has unknown type "${String(schema[f])}"`);
        }
    }
    const type: ComponentType<S> = {
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
export function defineTag(name: string): ComponentType<Record<string, never>> {
    return defineComponent<Record<string, never>>(name, {} as Record<string, never>);
}

/** How many component types have been declared. Sizes archetype bitmasks. */
export function componentCount(): number {
    return nextComponentId;
}

/** Look up a declared component by id (diagnostics, debug dumps). */
export function componentById(id: number): ComponentType<any> | undefined {
    return registry[id];
}

/** Every declared component, in declaration order. */
export function allComponents(): ReadonlyArray<ComponentType<any>> {
    return registry;
}

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
    'f64', 'f32', 'i32', 'u32', 'i16', 'u16', 'i8', 'u8', 'bool', 'entity', 'obj', 'str',
]);

function isValidFieldType(t: string): t is FieldType {
    return VALID_FIELD_TYPES.has(t);
}

/** True when the field type is backed by a typed array rather than a JS array. */
export function isNumericField(t: FieldType): boolean {
    return t !== 'obj' && t !== 'str';
}

/**
 * Allocate the backing array for one field at a given capacity.
 * Reference fields get a plain array pre-filled with `undefined`.
 */
export function allocField(type: FieldType, capacity: number): ArrayFor<FieldType> {
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
        case 'str': return new Array<string>(capacity);
        case 'obj': return new Array<any>(capacity);
    }
}

/**
 * Grow a field's backing array to `capacity`, preserving existing values.
 * Typed arrays are reallocated and blitted; JS arrays just have their length set
 * (which leaves a sparse tail — written before it is ever read).
 */
export function growField(
    type: FieldType,
    old: ArrayFor<FieldType>,
    capacity: number,
): ArrayFor<FieldType> {
    if (!isNumericField(type)) {
        (old as any[]).length = capacity;
        return old;
    }
    const next = allocField(type, capacity) as any;
    next.set(old as any);
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
export function clearFieldSlot(type: FieldType, arr: ArrayFor<FieldType>, row: number): void {
    if (isNumericField(type)) {
        (arr as any)[row] = 0;
    } else {
        (arr as any[])[row] = undefined;
    }
}
