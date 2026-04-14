import landSvg from './land.svg';
import desertSvg from './desert.svg';
import oceanSvg from './ocean.svg';
import antHellSvg from './ant_hell.svg';
import helSvg from './hel.svg';
import sewersSvg from './sewers.svg';
import jungleSvg from './jungle.svg';

const biomeSvgMap: { [key: string]: string } = {
    'land.svg': landSvg,
    'desert.svg': desertSvg,
    'ocean.svg': oceanSvg,
    'ant_hell.svg': antHellSvg,
    'hel.svg': helSvg,
    'sewers.svg': sewersSvg,
    'jungle.svg': jungleSvg,
};

/**
 * Get the SVG text content for a biome texture file.
 * Returns undefined if the texture is not a bundled biome SVG.
 */
export function getBiomeSvgContent(textureFile: string): string | undefined {
    // Strip leading './' if present
    const normalized = textureFile.replace(/^\.\//, '');
    return biomeSvgMap[normalized];
}
