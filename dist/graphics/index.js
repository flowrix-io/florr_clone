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
