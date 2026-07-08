// Re-export the Graphics class and all types
export { Graphics } from './core';
export type { FloatingText, ExplosionEffect, ExplosionParticle, LightningEffect, PetalBreakEffect, PetalParticleEffect, PetalParticle, FallingStar, FlowerRenderAttributes } from './types';

// Side-effect imports: each module attaches methods to Graphics.prototype
import './iris-transition';
import './mob-preload';
import './sections';
import './wall-edges';
import './map-drawing';
import './flower';
import './player-skins';
import './player-drawing';
import './enemy-drawing';
import './items';
import './effects';
import './minimap';
import './background';
import './static-map-cache';
import './game-objects';
import './pvp-arena';
import './maze-render';
import './render';
import './utilities';

import { preloadCustomTileTextures } from './map-drawing';
// Eagerly rasterize all tile-type SVGs so the cache is hot before the first
// frame any tile enters the viewport (avoids fallback-color flicker on the
// player's first encounter with a custom-textured tile).
preloadCustomTileTextures();
