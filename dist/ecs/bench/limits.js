"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SANE_WORLD_COORD_LIMIT = void 0;
/**
 * Sanity bound shared by the harness and the grid.
 *
 * Past roughly 2^53 an integer increment is a no-op, so a cell-scan loop that
 * reaches such a coordinate never terminates — the long-session server hang.
 * Anything beyond this is treated as corrupt rather than merely far away.
 */
exports.MAX_SANE_WORLD_COORD_LIMIT = 1e9;
