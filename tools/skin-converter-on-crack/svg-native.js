'use strict';
// Flowrix's native geometry engine, adapted to the current 255-shape protocol.
// No source SVG is executed or inserted in a browser document.
const fs = require('fs');
const engine = require('./vendor/flowrix-svg-to-skin.js');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = engine.convertSvg(input.svg, {
  maxShapes: input.budget, size: input.size, fit: 'viewbox', precision: 3
});
function element(s) {
  let geometry;
  switch (s.t) {
    case 'circle': geometry = `<circle r="${s.r}"`; break;
    case 'ellipse': geometry = `<ellipse rx="${s.rx}" ry="${s.ry}"`; break;
    case 'rect': geometry = `<rect x="${-s.rx}" y="${-s.ry}" width="${2*s.rx}" height="${2*s.ry}"`; break;
    case 'line': geometry = `<path d="M0 0 L${s.x2-s.x} ${s.y2-s.y}"`; break;
    case 'curve': geometry = `<path d="M0 0 C${s.cx1-s.x} ${s.cy1-s.y} ${s.cx2-s.x} ${s.cy2-s.y} ${s.x2-s.x} ${s.y2-s.y}"`; break;
    case 'polygon': geometry = `<polygon points="${s.points.join(' ')}"`; break;
    default: throw Error('Unknown shape');
  }
  // All values below are engine-generated numeric values and parsed hex colours.
  return `${geometry} transform="translate(${s.x} ${s.y}) rotate(${s.rot||0})" fill="${s.fill||'none'}" stroke="${s.stroke||'none'}" stroke-width="${s.sw||0}" stroke-linejoin="round" stroke-linecap="round"/>`;
}
result.preview = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="${-input.size/2} ${-input.size/2} ${input.size} ${input.size}">${result.shapes.map(element).join('')}</svg>`;
process.stdout.write(JSON.stringify(result));
