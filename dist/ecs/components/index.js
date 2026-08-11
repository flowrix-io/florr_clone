"use strict";
/**
 * The game's component catalog.
 *
 * Every component the game uses is declared in this directory and re-exported
 * here. Declaration must happen at module scope and the whole catalog must be
 * loaded before any archetype is built — component ids are assigned in
 * declaration order and size the archetype bitmasks — so importing this barrel
 * (rather than individual files) is what guarantees a consistent id space.
 *
 * Grouping:
 *   spatial       position, velocity, facing, radius, speed
 *   combat        health, damage, poison, slow, death
 *   lifetime      expiry, spawn time, viewport despawn
 *   mob           the old Enemy interface, decomposed
 *   projectile    mob + player projectiles, unified
 *   player        the old ServerPlayer interface, decomposed
 *   world_objects drops, ground effects, scenery, walls
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./spatial"), exports);
__exportStar(require("./combat"), exports);
__exportStar(require("./lifetime"), exports);
__exportStar(require("./mob"), exports);
__exportStar(require("./projectile"), exports);
__exportStar(require("./player"), exports);
__exportStar(require("./world_objects"), exports);
