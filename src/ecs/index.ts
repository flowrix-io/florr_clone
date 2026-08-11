/**
 * ECS core — archetype storage with struct-of-arrays columns.
 *
 * Import from this barrel rather than the individual modules, so the internal
 * file layout can change without touching call sites across the game.
 *
 * Typical use:
 *
 *   // once, at module scope
 *   export const Position = defineComponent('Position', { x: 'f64', y: 'f64' });
 *   export const Velocity = defineComponent('Velocity', { x: 'f32', y: 'f32' });
 *
 *   const movers = world.query([Position, Velocity]);
 *
 *   // once per tick — arrays hoisted ABOVE the row loop
 *   movers.chunks(chunk => {
 *       const p = chunk.cols(Position);
 *       const v = chunk.cols(Velocity);
 *       for (let i = 0; i < chunk.count; i++) {
 *           p.x[i] += v.x[i] * dt;
 *           p.y[i] += v.y[i] * dt;
 *       }
 *   });
 */

export {
    Entity,
    NULL_ENTITY,
    ENTITY_INDEX_COUNT,
    ENTITY_MAX_GENERATION,
    makeEntity,
    entityIndex,
    entityGeneration,
    entityToString,
} from './entity';

export {
    ComponentType,
    Schema,
    FieldType,
    NumericFieldType,
    ReferenceFieldType,
    Columns,
    ArrayFor,
    defineComponent,
    defineTag,
    componentCount,
    componentById,
    allComponents,
    isNumericField,
} from './component';

export { Archetype, ComponentMask } from './archetype';

export { World, Query, Chunk, ComponentInit } from './world';

export { CommandBuffer } from './commands';

export {
    Scheduler,
    Phase,
    SystemContext,
    SystemFn,
    SystemOptions,
    SystemTiming,
} from './system';
