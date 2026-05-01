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
import './player-drawing';
import './enemy-drawing';
import './items';
import './effects';
import './minimap';
import './background';
import './static-map-cache';
import './game-objects';
import './pvp-arena';
import './render';
import './utilities';
