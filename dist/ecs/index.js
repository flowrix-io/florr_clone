"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Phase = exports.Scheduler = exports.CommandBuffer = exports.Query = exports.World = exports.Archetype = exports.isNumericField = exports.allComponents = exports.componentById = exports.componentCount = exports.defineTag = exports.defineComponent = exports.entityToString = exports.entityGeneration = exports.entityIndex = exports.makeEntity = exports.ENTITY_MAX_GENERATION = exports.ENTITY_INDEX_COUNT = exports.NULL_ENTITY = void 0;
var entity_1 = require("./entity");
Object.defineProperty(exports, "NULL_ENTITY", { enumerable: true, get: function () { return entity_1.NULL_ENTITY; } });
Object.defineProperty(exports, "ENTITY_INDEX_COUNT", { enumerable: true, get: function () { return entity_1.ENTITY_INDEX_COUNT; } });
Object.defineProperty(exports, "ENTITY_MAX_GENERATION", { enumerable: true, get: function () { return entity_1.ENTITY_MAX_GENERATION; } });
Object.defineProperty(exports, "makeEntity", { enumerable: true, get: function () { return entity_1.makeEntity; } });
Object.defineProperty(exports, "entityIndex", { enumerable: true, get: function () { return entity_1.entityIndex; } });
Object.defineProperty(exports, "entityGeneration", { enumerable: true, get: function () { return entity_1.entityGeneration; } });
Object.defineProperty(exports, "entityToString", { enumerable: true, get: function () { return entity_1.entityToString; } });
var component_1 = require("./component");
Object.defineProperty(exports, "defineComponent", { enumerable: true, get: function () { return component_1.defineComponent; } });
Object.defineProperty(exports, "defineTag", { enumerable: true, get: function () { return component_1.defineTag; } });
Object.defineProperty(exports, "componentCount", { enumerable: true, get: function () { return component_1.componentCount; } });
Object.defineProperty(exports, "componentById", { enumerable: true, get: function () { return component_1.componentById; } });
Object.defineProperty(exports, "allComponents", { enumerable: true, get: function () { return component_1.allComponents; } });
Object.defineProperty(exports, "isNumericField", { enumerable: true, get: function () { return component_1.isNumericField; } });
var archetype_1 = require("./archetype");
Object.defineProperty(exports, "Archetype", { enumerable: true, get: function () { return archetype_1.Archetype; } });
var world_1 = require("./world");
Object.defineProperty(exports, "World", { enumerable: true, get: function () { return world_1.World; } });
Object.defineProperty(exports, "Query", { enumerable: true, get: function () { return world_1.Query; } });
var commands_1 = require("./commands");
Object.defineProperty(exports, "CommandBuffer", { enumerable: true, get: function () { return commands_1.CommandBuffer; } });
var system_1 = require("./system");
Object.defineProperty(exports, "Scheduler", { enumerable: true, get: function () { return system_1.Scheduler; } });
Object.defineProperty(exports, "Phase", { enumerable: true, get: function () { return system_1.Phase; } });
