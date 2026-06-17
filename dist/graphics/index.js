"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Graphics = void 0;
// Re-export the Graphics class and all types
var core_1 = require("./core");
Object.defineProperty(exports, "Graphics", { enumerable: true, get: function () { return core_1.Graphics; } });
// Side-effect imports: each module attaches methods to Graphics.prototype
require("./iris-transition");
require("./mob-preload");
require("./sections");
require("./wall-edges");
require("./map-drawing");
require("./flower");
require("./player-skins");
require("./player-drawing");
require("./enemy-drawing");
require("./items");
require("./effects");
require("./minimap");
require("./background");
require("./static-map-cache");
require("./game-objects");
require("./pvp-arena");
require("./render");
require("./utilities");
const map_drawing_1 = require("./map-drawing");
// Eagerly rasterize all tile-type SVGs so the cache is hot before the first
// frame any tile enters the viewport (avoids fallback-color flicker on the
// player's first encounter with a custom-textured tile).
(0, map_drawing_1.preloadCustomTileTextures)();
