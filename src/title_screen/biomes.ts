export interface BiomeConfig {
    color: string;
    title: string;
    displayName: string;
}

const BIOME_CONFIGS: { [key: string]: BiomeConfig } = {
    'default':   { color: 'rgb(0, 190, 79)',     title: 'Garden',       displayName: 'Garden' },
    'desert':    { color: '#ffff9c',             title: 'Desert',       displayName: 'Desert' },
    'ocean':     { color: 'rgb(200,255,250)',    title: 'Ocean',        displayName: 'Ocean' },
    'hel':       { color: 'rgb(255, 0, 0)',      title: 'Hel',          displayName: 'Hel' },
    'ant_hell':  { color: '#c9904f',             title: 'Ant Hell',     displayName: 'Ant Hell' },
    'jungle':    { color: 'rgb(0, 255, 0)',      title: 'Jungle',       displayName: 'Jungle' },
    'sewers':    { color: 'rgb(128, 63, 2)',     title: 'Sewers',       displayName: 'Sewers' },
    'computer':  { color: 'rgb(96, 255, 149)',   title: 'Computer Lab', displayName: 'Computer Lab' },
    'pvp':       { color: 'rgb(220, 60, 60)',    title: 'PVP Arena',    displayName: 'PVP Arena' },
};

const BIOME_SVG_MAP: { [key: string]: string } = {
    'default':  'land.svg',
    'land':     'land.svg',
    'desert':   'desert.svg',
    'ocean':    'ocean.svg',
    'ant_hell': 'ant_hell.svg',
    'hel':      'hel.svg',
    'sewers':   'sewers.svg',
    'jungle':   'jungle.svg',
};

export function getBiomeConfig(biomeName: string): BiomeConfig {
    return BIOME_CONFIGS[biomeName] || {
        color: '#cccccc',
        title: biomeName.charAt(0).toUpperCase() + biomeName.slice(1),
        displayName: biomeName.charAt(0).toUpperCase() + biomeName.slice(1),
    };
}

export function getBiomeSvgFile(biomeName: string): string {
    return BIOME_SVG_MAP[biomeName] || BIOME_SVG_MAP['default'];
}
