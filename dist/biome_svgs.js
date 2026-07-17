"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBiomeSvgContent = getBiomeSvgContent;
const land_svg_1 = __importDefault(require("./land.svg"));
const desert_svg_1 = __importDefault(require("./desert.svg"));
const ocean_svg_1 = __importDefault(require("./ocean.svg"));
const ant_hell_svg_1 = __importDefault(require("./ant_hell.svg"));
const hel_svg_1 = __importDefault(require("./hel.svg"));
const sewers_svg_1 = __importDefault(require("./sewers.svg"));
const jungle_svg_1 = __importDefault(require("./jungle.svg"));
const biomeSvgMap = {
    'land.svg': land_svg_1.default,
    'desert.svg': desert_svg_1.default,
    'ocean.svg': ocean_svg_1.default,
    'ant_hell.svg': ant_hell_svg_1.default,
    'hel.svg': hel_svg_1.default,
    'sewers.svg': sewers_svg_1.default,
    'jungle.svg': jungle_svg_1.default,
};
/**
 * Get the SVG text content for a biome texture file.
 * Returns undefined if the texture is not a bundled biome SVG.
 */
function getBiomeSvgContent(textureFile) {
    // Strip leading './' if present
    const normalized = textureFile.replace(/^\.\//, '');
    return biomeSvgMap[normalized];
}
