"use strict";
// Runtime shim. The hand-edited canonical source lives in `./map_source`
// and is consumed only by the build script (scripts/encodeMap.js). At runtime
// we use the compact RLE-compressed form in `./map_bundle` (auto-generated),
// which decodes once into the shared wall grid.
//
// Loading the full 435 KB source on the server cost ~5–15 MB of resident heap
// (parsed JSON literal + a duplicated 200×200 wallGrid kept alive by both
// WORLD_MAP_DATA and SHARED_WALL_GRID). Routing through the bundle removes
// that duplication.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALL_GRID = exports.WORLD_MAP = void 0;
const constants_1 = require("./constants");
const map_bundle_1 = require("./map_bundle");
(0, constants_1.setCustomTileTypes)(map_bundle_1.MAP_CUSTOM_TILE_TYPES);
(function populateSharedWallGrid() {
    const flat = (0, constants_1.decodeTileGridRLE)(map_bundle_1.MAP_TILE_RLE, map_bundle_1.MAP_GRID_WIDTH * map_bundle_1.MAP_GRID_HEIGHT);
    const h = Math.min(map_bundle_1.MAP_GRID_HEIGHT, constants_1.WALL_GRID.length);
    for (let y = 0; y < h; y++) {
        const dst = constants_1.WALL_GRID[y];
        const w = Math.min(map_bundle_1.MAP_GRID_WIDTH, dst.length);
        const base = y * map_bundle_1.MAP_GRID_WIDTH;
        for (let x = 0; x < w; x++)
            dst[x] = flat[base + x] | 0;
    }
})();
exports.WORLD_MAP = map_bundle_1.MAP_ELEMENTS;
exports.WALL_GRID = constants_1.WALL_GRID;
