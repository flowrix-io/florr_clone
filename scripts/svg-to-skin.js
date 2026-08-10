#!/usr/bin/env node
/**
 * SVG → skin commands.
 *
 * Turns an SVG drawing into the canvas-command lines the Skin Studio's Text mode
 * accepts (one shape per line, see parseShapes() in src/skinStudio.ts and the
 * data model in src/skin_format.ts). The output is deliberately the *text*
 * format, not JSON, because pasting it into the studio is the shortest path from
 * artwork to a publishable skin.
 *
 * The skin format is a tiny fixed vocabulary — circle / ellipse / rect / polygon
 * / line / curve — with hard limits (24 shapes, ±64 local coords, 16 polygon
 * points, #rrggbb colors, no alpha, no gradients, no clipping). So conversion is
 * lossy by construction and this file is mostly about *how* to lose things well:
 *
 *   - every element is flattened through its full ancestor transform chain
 *   - paths become polygons (filled) or line/curve segments (stroke-only), with
 *     Visvalingam simplification down to the 16-point polygon limit
 *   - a single cubic path segment survives exactly as a `curve` shape
 *   - gradients/patterns collapse to an average stop color, alpha is dropped
 *   - the whole drawing is uniformly scaled + centred to fit the flower body
 *   - when there are more shapes than the format allows, the visually smallest
 *     ones are dropped (and reported) rather than truncating in document order
 *
 * Runs in Node (CLI) and in the browser (SvgToSkin.html loads it as a plain
 * script and calls SvgToSkin.convertSvg). No dependencies, no DOM use, so the
 * same code path produces the same output in both.
 *
 * Usage:
 *   node scripts/svg-to-skin.js logo.svg
 *   node scripts/svg-to-skin.js logo.svg -o skin.txt --max-shapes 20 --size 46
 *   node scripts/svg-to-skin.js logo.svg --json --name "My Skin"
 */

(function (global) {
    'use strict';

    // ── format limits (mirror src/skin_format.ts) ───────────────────────────
    var LIMITS = {
        MAX_SKIN_SHAPES: 24,
        MAX_POLY_POINTS: 16,
        SKIN_COORD_LIMIT: 64,
        SKIN_RADIUS_LIMIT: 64,
        MAX_STROKE_WIDTH: 14,
        // The editor authors against a flower body of radius 25; renderCustomSkinShapes
        // clips local space to radius 100.
        BODY_RADIUS: 25,
    };

    // ── tiny XML parser ─────────────────────────────────────────────────────
    // Enough of XML for real-world SVG files: nesting, self-closing tags, quoted
    // attributes, entities. <style> blocks are pulled out before parsing because
    // this parser drops text nodes.

    function decodeEntities(s) {
        return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, ent) {
            if (ent.charAt(0) === '#') {
                var code = ent.charAt(1) === 'x' || ent.charAt(1) === 'X'
                    ? parseInt(ent.slice(2), 16)
                    : parseInt(ent.slice(1), 10);
                return isFinite(code) ? String.fromCharCode(code) : m;
            }
            var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
            return named[ent] !== undefined ? named[ent] : m;
        });
    }

    function parseAttrs(src) {
        var attrs = {};
        var re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
        var m;
        while ((m = re.exec(src))) {
            var key = m[1].toLowerCase();
            // Strip the namespace prefix so xlink:href and href land in one place.
            if (key.indexOf(':') > 0 && key.indexOf('xml') !== 0) key = key.slice(key.indexOf(':') + 1);
            attrs[key] = decodeEntities(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]);
        }
        return attrs;
    }

    function parseXml(src) {
        var styleText = '';
        src = src
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<\?[\s\S]*?\?>/g, '')
            .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, '')
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/<style\b[^>]*>([\s\S]*?)<\/\s*style\s*>/gi, function (m, body) { styleText += body + '\n'; return ''; });

        var root = { tag: '#root', attrs: {}, children: [], parent: null };
        var stack = [root];
        var re = /<\s*\/\s*([\w:.-]+)\s*>|<\s*([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g;
        var m;
        // Void-ish SVG elements that authors sometimes leave unclosed.
        while ((m = re.exec(src))) {
            if (m[1]) {
                // Closing tag: unwind to the matching open element (tolerates stray closers).
                var name = m[1].toLowerCase();
                for (var i = stack.length - 1; i > 0; i--) {
                    if (stack[i].tag === name) { stack.length = i; break; }
                }
            } else {
                var node = {
                    tag: m[2].toLowerCase(),
                    attrs: parseAttrs(m[3] || ''),
                    children: [],
                    parent: stack[stack.length - 1],
                };
                stack[stack.length - 1].children.push(node);
                if (!m[4]) stack.push(node);
            }
        }
        return { root: root, styleText: styleText };
    }

    // ── minimal CSS (only what Illustrator/Figma exports actually emit) ──────
    // Simple selectors: `.cls-1`, `#id`, `tag`, comma lists. Everything else is
    // ignored rather than half-applied.

    function parseCss(text) {
        var rules = [];
        text = text.replace(/\/\*[\s\S]*?\*\//g, '');
        var re = /([^{}]+)\{([^{}]*)\}/g;
        var m;
        while ((m = re.exec(text))) {
            var decls = parseDeclarations(m[2]);
            if (!Object.keys(decls).length) continue;
            var sels = m[1].split(',');
            for (var i = 0; i < sels.length; i++) {
                var sel = sels[i].trim();
                if (/^[.#]?[\w-]+$/.test(sel)) rules.push({ sel: sel, decls: decls });
            }
        }
        return rules;
    }

    function parseDeclarations(text) {
        var out = {};
        var parts = String(text).split(';');
        for (var i = 0; i < parts.length; i++) {
            var c = parts[i].indexOf(':');
            if (c <= 0) continue;
            var k = parts[i].slice(0, c).trim().toLowerCase();
            var v = parts[i].slice(c + 1).trim();
            if (k) out[k] = v;
        }
        return out;
    }

    function cssFor(rules, node) {
        var out = {};
        var classes = (node.attrs['class'] || '').split(/\s+/).filter(Boolean);
        for (var i = 0; i < rules.length; i++) {
            var sel = rules[i].sel, hit = false;
            if (sel.charAt(0) === '.') hit = classes.indexOf(sel.slice(1)) >= 0;
            else if (sel.charAt(0) === '#') hit = node.attrs.id === sel.slice(1);
            else hit = node.tag === sel.toLowerCase();
            if (hit) for (var k in rules[i].decls) out[k] = rules[i].decls[k];
        }
        return out;
    }

    // ── colors ──────────────────────────────────────────────────────────────

    var NAMED_COLORS = {
        aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff',
        beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff',
        blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
        chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
        cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
        darkgrey: '#a9a9a9', darkgreen: '#006400', darkkhaki: '#bdb76b', darkmagenta: '#8b008b',
        darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000',
        darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b', darkslategray: '#2f4f4f',
        darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493',
        deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff',
        firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff',
        gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520', gray: '#808080',
        grey: '#808080', green: '#008000', greenyellow: '#adff2f', honeydew: '#f0fff0', hotpink: '#ff69b4',
        indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
        lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
        lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
        lightgrey: '#d3d3d3', lightgreen: '#90ee90', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
        lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
        lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6',
        magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd',
        mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee',
        mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
        midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
        navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23',
        orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa',
        palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5',
        peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6',
        purple: '#800080', rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1',
        saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee',
        sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090',
        slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c',
        teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee',
        wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
    };

    function hex2(n) {
        var v = Math.max(0, Math.min(255, Math.round(n)));
        return (v < 16 ? '0' : '') + v.toString(16);
    }

    /** Parse any CSS color the format can represent → '#rrggbb', or null. Alpha is dropped. */
    function parseColor(raw) {
        if (raw == null) return null;
        var s = String(raw).trim().toLowerCase();
        if (!s || s === 'none' || s === 'transparent') return null;
        if (s.charAt(0) === '#') {
            var h = s.slice(1);
            if (/^[0-9a-f]{3,4}$/.test(h)) return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            if (/^[0-9a-f]{6}$/.test(h) || /^[0-9a-f]{8}$/.test(h)) return '#' + h.slice(0, 6);
            return null;
        }
        var m = s.match(/^rgba?\(([^)]*)\)$/);
        if (m) {
            var p = m[1].split(/[\s,\/]+/).filter(Boolean);
            if (p.length < 3) return null;
            var c = [];
            for (var i = 0; i < 3; i++) {
                var v = parseFloat(p[i]);
                if (!isFinite(v)) return null;
                c.push(p[i].indexOf('%') >= 0 ? v * 2.55 : v);
            }
            return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
        }
        m = s.match(/^hsla?\(([^)]*)\)$/);
        if (m) {
            var q = m[1].split(/[\s,\/]+/).filter(Boolean);
            if (q.length < 3) return null;
            return hslToHex(parseFloat(q[0]), parseFloat(q[1]) / 100, parseFloat(q[2]) / 100);
        }
        if (NAMED_COLORS[s]) return NAMED_COLORS[s];
        return null;
    }

    function hslToHex(h, s, l) {
        if (!isFinite(h) || !isFinite(s) || !isFinite(l)) return null;
        h = ((h % 360) + 360) % 360 / 360;
        s = Math.max(0, Math.min(1, s));
        l = Math.max(0, Math.min(1, l));
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        function ch(t) {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        }
        return '#' + hex2(ch(h + 1 / 3) * 255) + hex2(ch(h) * 255) + hex2(ch(h - 1 / 3) * 255);
    }

    function mixHex(colors) {
        if (!colors.length) return null;
        var r = 0, g = 0, b = 0;
        for (var i = 0; i < colors.length; i++) {
            r += parseInt(colors[i].slice(1, 3), 16);
            g += parseInt(colors[i].slice(3, 5), 16);
            b += parseInt(colors[i].slice(5, 7), 16);
        }
        var n = colors.length;
        return '#' + hex2(r / n) + hex2(g / n) + hex2(b / n);
    }

    // ── transforms (2×3 matrices as [a,b,c,d,e,f]) ──────────────────────────

    var IDENTITY = [1, 0, 0, 1, 0, 0];

    function matMul(m1, m2) {
        return [
            m1[0] * m2[0] + m1[2] * m2[1],
            m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3],
            m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
            m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
        ];
    }

    function applyMat(m, x, y) {
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }

    function parseTransform(str) {
        var m = IDENTITY;
        if (!str) return m;
        var re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
        var t;
        while ((t = re.exec(str))) {
            var n = t[2].split(/[\s,]+/).map(parseFloat).filter(function (v) { return isFinite(v); });
            var op = t[1].toLowerCase();
            if (op === 'translate') m = matMul(m, [1, 0, 0, 1, n[0] || 0, n[1] || 0]);
            else if (op === 'scale') m = matMul(m, [n[0] || 0, 0, 0, n.length > 1 ? n[1] : (n[0] || 0), 0, 0]);
            else if (op === 'rotate') {
                var a = (n[0] || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
                if (n.length >= 3) {
                    m = matMul(m, [1, 0, 0, 1, n[1], n[2]]);
                    m = matMul(m, [cos, sin, -sin, cos, 0, 0]);
                    m = matMul(m, [1, 0, 0, 1, -n[1], -n[2]]);
                } else m = matMul(m, [cos, sin, -sin, cos, 0, 0]);
            } else if (op === 'matrix' && n.length >= 6) m = matMul(m, n.slice(0, 6));
            else if (op === 'skewx') m = matMul(m, [1, 0, Math.tan((n[0] || 0) * Math.PI / 180), 1, 0, 0]);
            else if (op === 'skewy') m = matMul(m, [1, Math.tan((n[0] || 0) * Math.PI / 180), 0, 1, 0, 0]);
        }
        return m;
    }

    /**
     * Split a matrix into rotation + axis scales, assuming no skew. `skew` reports
     * how far off that assumption is — callers fall back to polygons when it's big,
     * because the skin format has no shear.
     */
    function decompose(m) {
        var sx = Math.hypot(m[0], m[1]);
        var det = m[0] * m[3] - m[1] * m[2];
        var sy = sx ? det / sx : Math.hypot(m[2], m[3]);
        var rot = Math.atan2(m[1], m[0]);
        // Dot product of the two basis vectors, normalized: 0 when they stay perpendicular.
        var dot = (m[0] * m[2] + m[1] * m[3]);
        var skew = sx && sy ? Math.abs(dot / (sx * Math.abs(sy))) : 0;
        return { sx: sx, sy: sy, rot: rot * 180 / Math.PI, skew: skew, flipped: det < 0 };
    }

    // ── path data → subpaths of line/cubic segments ─────────────────────────

    function parsePathData(d) {
        var tokens = String(d).match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
        var subpaths = [];
        var cur = null;
        var x = 0, y = 0, startX = 0, startY = 0;
        var prevCtrlX = null, prevCtrlY = null, prevQCtrlX = null, prevQCtrlY = null;
        var i = 0, cmd = '', prevCmd = '';

        function num() { return parseFloat(tokens[i++]); }
        function begin(px, py) { cur = { start: [px, py], segs: [], closed: false }; subpaths.push(cur); }
        function lineTo(px, py) { if (cur) cur.segs.push({ t: 'L', p: [px, py] }); }
        function cubicTo(c1x, c1y, c2x, c2y, px, py) {
            if (cur) cur.segs.push({ t: 'C', c1: [c1x, c1y], c2: [c2x, c2y], p: [px, py] });
        }

        while (i < tokens.length) {
            if (/[MmZzLlHhVvCcSsQqTtAa]/.test(tokens[i])) { cmd = tokens[i++]; }
            else if (!cmd) { i++; continue; }
            else if (cmd === 'M') cmd = 'L';           // implicit repeats after a moveto
            else if (cmd === 'm') cmd = 'l';
            var rel = cmd >= 'a';
            var C = cmd.toUpperCase();

            if (C === 'Z') {
                if (cur) { cur.closed = true; x = startX; y = startY; }
                cur = null;
            } else if (C === 'M') {
                var mx = num(), my = num();
                x = rel ? x + mx : mx; y = rel ? y + my : my;
                startX = x; startY = y;
                begin(x, y);
            } else if (C === 'L') {
                var lx = num(), ly = num();
                x = rel ? x + lx : lx; y = rel ? y + ly : ly;
                if (!cur) begin(x, y); else lineTo(x, y);
            } else if (C === 'H') {
                var hx = num(); x = rel ? x + hx : hx;
                if (!cur) begin(x, y); else lineTo(x, y);
            } else if (C === 'V') {
                var vy = num(); y = rel ? y + vy : vy;
                if (!cur) begin(x, y); else lineTo(x, y);
            } else if (C === 'C' || C === 'S') {
                var c1x, c1y;
                if (C === 'C') {
                    c1x = num(); c1y = num();
                    if (rel) { c1x += x; c1y += y; }
                } else {
                    // Smooth cubic: reflect the previous control point through the current point.
                    var smooth = /[CcSs]/.test(prevCmd);
                    c1x = smooth && prevCtrlX !== null ? 2 * x - prevCtrlX : x;
                    c1y = smooth && prevCtrlY !== null ? 2 * y - prevCtrlY : y;
                }
                var c2x = num(), c2y = num(), ex = num(), ey = num();
                if (rel) { c2x += x; c2y += y; ex += x; ey += y; }
                if (!cur) begin(x, y);
                cubicTo(c1x, c1y, c2x, c2y, ex, ey);
                prevCtrlX = c2x; prevCtrlY = c2y;
                x = ex; y = ey;
            } else if (C === 'Q' || C === 'T') {
                var qx, qy;
                if (C === 'Q') {
                    qx = num(); qy = num();
                    if (rel) { qx += x; qy += y; }
                } else {
                    var smoothQ = /[QqTt]/.test(prevCmd);
                    qx = smoothQ && prevQCtrlX !== null ? 2 * x - prevQCtrlX : x;
                    qy = smoothQ && prevQCtrlY !== null ? 2 * y - prevQCtrlY : y;
                }
                var qex = num(), qey = num();
                if (rel) { qex += x; qey += y; }
                if (!cur) begin(x, y);
                // Quadratic → cubic (exact).
                cubicTo(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y),
                    qex + 2 / 3 * (qx - qex), qey + 2 / 3 * (qy - qey), qex, qey);
                prevQCtrlX = qx; prevQCtrlY = qy;
                x = qex; y = qey;
            } else if (C === 'A') {
                var rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
                var ax = num(), ay = num();
                if (rel) { ax += x; ay += y; }
                if (!cur) begin(x, y);
                var arcs = arcToCubics(x, y, rx, ry, rot, large, sweep, ax, ay);
                for (var a = 0; a < arcs.length; a++) {
                    cubicTo(arcs[a][0], arcs[a][1], arcs[a][2], arcs[a][3], arcs[a][4], arcs[a][5]);
                }
                x = ax; y = ay;
            } else { i++; continue; }

            if (C !== 'C' && C !== 'S') { prevCtrlX = null; prevCtrlY = null; }
            if (C !== 'Q' && C !== 'T') { prevQCtrlX = null; prevQCtrlY = null; }
            prevCmd = cmd;
        }
        // A malformed `d` runs the token stream dry mid-command and yields NaN
        // coordinates; drop anything non-finite rather than poisoning the bbox.
        return subpaths.filter(function (sp) {
            if (!sp.segs.length || !isFinite(sp.start[0]) || !isFinite(sp.start[1])) return false;
            sp.segs = sp.segs.filter(function (seg) {
                var vals = seg.t === 'L' ? seg.p : seg.c1.concat(seg.c2, seg.p);
                for (var v = 0; v < vals.length; v++) if (!isFinite(vals[v])) return false;
                return true;
            });
            return sp.segs.length > 0;
        });
    }

    /** Endpoint-parameterized elliptical arc → up to 4 cubic segments. */
    function arcToCubics(x1, y1, rx, ry, angleDeg, largeArc, sweep, x2, y2) {
        if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
        rx = Math.abs(rx); ry = Math.abs(ry);
        var phi = angleDeg * Math.PI / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
        var dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
        var x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy;
        var lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lam > 1) { var s = Math.sqrt(lam); rx *= s; ry *= s; }
        var sign = largeArc !== sweep ? 1 : -1;
        var num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
        var den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
        var co = den ? sign * Math.sqrt(Math.max(0, num / den)) : 0;
        var cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
        var cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
        var cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
        var ang = function (ux, uy, vx, vy) {
            var d = (Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1;
            var a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d)));
            return (ux * vy - uy * vx < 0 ? -a : a);
        };
        var theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
        var dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
        if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
        else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

        var segCount = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
        var delta = dTheta / segCount;
        var k = 4 / 3 * Math.tan(delta / 4);
        var out = [];
        var th = theta1;
        for (var i = 0; i < segCount; i++) {
            var cos1 = Math.cos(th), sin1 = Math.sin(th);
            var th2 = th + delta, cos2 = Math.cos(th2), sin2 = Math.sin(th2);
            var p = function (c, s) {
                return [cosP * rx * c - sinP * ry * s + cx, sinP * rx * c + cosP * ry * s + cy];
            };
            var p1 = p(cos1, sin1), p2 = p(cos2, sin2);
            var d1 = [cosP * rx * -sin1 - sinP * ry * cos1, sinP * rx * -sin1 + cosP * ry * cos1];
            var d2 = [cosP * rx * -sin2 - sinP * ry * cos2, sinP * rx * -sin2 + cosP * ry * cos2];
            out.push([p1[0] + k * d1[0], p1[1] + k * d1[1], p2[0] - k * d2[0], p2[1] - k * d2[1], p2[0], p2[1]]);
            th = th2;
        }
        return out;
    }

    // ── geometry helpers ────────────────────────────────────────────────────

    function cubicPoint(p0, c1, c2, p1, t) {
        var mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
        return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
    }

    function flattenSubpath(sp, tolerance) {
        var pts = [sp.start.slice()];
        var cursor = sp.start;
        for (var i = 0; i < sp.segs.length; i++) {
            var seg = sp.segs[i];
            if (seg.t === 'L') { pts.push(seg.p.slice()); cursor = seg.p; continue; }
            var approxLen = Math.hypot(seg.c1[0] - cursor[0], seg.c1[1] - cursor[1])
                + Math.hypot(seg.c2[0] - seg.c1[0], seg.c2[1] - seg.c1[1])
                + Math.hypot(seg.p[0] - seg.c2[0], seg.p[1] - seg.c2[1]);
            var steps = Math.max(4, Math.min(24, Math.ceil(approxLen / Math.max(0.001, tolerance))));
            for (var s = 1; s <= steps; s++) pts.push(cubicPoint(cursor, seg.c1, seg.c2, seg.p, s / steps));
            cursor = seg.p;
        }
        return dedupe(pts);
    }

    function dedupe(pts, eps) {
        eps = eps || 1e-6;
        var out = [];
        for (var i = 0; i < pts.length; i++) {
            var last = out[out.length - 1];
            if (!last || Math.abs(last[0] - pts[i][0]) > eps || Math.abs(last[1] - pts[i][1]) > eps) out.push(pts[i]);
        }
        return out;
    }

    /**
     * Visvalingam-Whyatt: drop the point whose triangle with its neighbours has
     * the least area until `max` remain. Gives an exact target count (unlike
     * epsilon-based simplification), which is what the 16-point cap needs.
     */
    function simplifyPoints(pts, max, closed) {
        var p = pts.slice();
        if (closed && p.length > 1) {
            var f = p[0], l = p[p.length - 1];
            if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) p.pop();
        }
        while (p.length > max) {
            var bestIdx = -1, bestArea = Infinity;
            var lo = closed ? 0 : 1, hi = closed ? p.length : p.length - 1;
            for (var i = lo; i < hi; i++) {
                var a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
                var area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
                if (area < bestArea) { bestArea = area; bestIdx = i; }
            }
            if (bestIdx < 0) break;
            p.splice(bestIdx, 1);
        }
        return p;
    }

    function polygonArea(pts) {
        var a = 0;
        for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            a += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
        }
        return Math.abs(a) / 2;
    }

    function polylineLength(pts) {
        var l = 0;
        for (var i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        return l;
    }

    // ── SVG tree → skin shapes in user space ────────────────────────────────

    var SKIP_TAGS = { defs: 1, clippath: 1, mask: 1, marker: 1, symbol: 1, pattern: 1, filter: 1, style: 1,
        title: 1, desc: 1, metadata: 1, lineargradient: 1, radialgradient: 1, animate: 1, animatetransform: 1,
        animatemotion: 1, script: 1, foreignobject: 1 };

    function Converter(options, warn) {
        this.opt = options;
        this.warn = warn;
        this.shapes = [];
        this.idMap = {};
        this.paints = {};   // gradient/pattern id → flat color
        this.rules = [];
        this.unsupported = {};
    }

    Converter.prototype.note = function (what) {
        if (this.unsupported[what]) { this.unsupported[what]++; return; }
        this.unsupported[what] = 1;
    };

    Converter.prototype.indexIds = function (node) {
        if (node.attrs && node.attrs.id) this.idMap[node.attrs.id] = node;
        for (var i = 0; i < node.children.length; i++) this.indexIds(node.children[i]);
    };

    /** Flatten every gradient to one color so `url(#x)` paints resolve to something. */
    Converter.prototype.indexPaints = function (node) {
        if (node.tag === 'lineargradient' || node.tag === 'radialgradient') {
            var stops = [];
            var walk = function (n) {
                if (n.tag === 'stop') {
                    var css = parseDeclarations(n.attrs.style || '');
                    var c = parseColor(css['stop-color'] || n.attrs['stop-color']);
                    var op = parseFloat(css['stop-opacity'] !== undefined ? css['stop-opacity'] : n.attrs['stop-opacity']);
                    if (c && !(isFinite(op) && op < 0.05)) stops.push(c);
                }
                for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
            };
            walk(node);
            // Gradients often reuse another's stops via href; remember the id either way.
            if (node.attrs.id) {
                this.paints[node.attrs.id] = stops.length ? mixHex(stops) : null;
                if (!stops.length && node.attrs.href) this.paints[node.attrs.id] = '@' + node.attrs.href.replace('#', '');
            }
        }
        for (var j = 0; j < node.children.length; j++) this.indexPaints(node.children[j]);
    };

    Converter.prototype.resolvePaint = function (value, depth) {
        var m = /^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/.exec(value);
        if (!m) return parseColor(value);
        var hit = this.paints[m[1]];
        if (typeof hit === 'string' && hit.charAt(0) === '@' && (depth || 0) < 4) {
            return this.resolvePaint('url(#' + hit.slice(1) + ')', (depth || 0) + 1);
        }
        if (hit) { this.note('gradient (flattened to one color)'); return hit; }
        this.note('unresolved paint reference (used gray)');
        return '#808080';
    };

    /** Presentation attrs < CSS rules < style="" (the SVG cascade, minus specificity). */
    Converter.prototype.mergedDecls = function (node) {
        var merged = {};
        var PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity',
            'display', 'visibility', 'transform-origin', 'transform-box'];
        for (var i = 0; i < PROPS.length; i++) {
            if (node.attrs[PROPS[i]] !== undefined) merged[PROPS[i]] = node.attrs[PROPS[i]];
        }
        var css = cssFor(this.rules, node);
        for (var k in css) merged[k] = css[k];
        var inline = parseDeclarations(node.attrs.style || '');
        for (var k2 in inline) merged[k2] = inline[k2];
        return merged;
    };

    Converter.prototype.styleFor = function (node, parentStyle, merged) {
        var s = {
            fill: parentStyle.fill, stroke: parentStyle.stroke, strokeWidth: parentStyle.strokeWidth,
            opacity: 1, fillOpacity: parentStyle.fillOpacity, strokeOpacity: parentStyle.strokeOpacity,
            display: parentStyle.display, visibility: parentStyle.visibility,
        };
        merged = merged || this.mergedDecls(node);

        if (merged.fill !== undefined) {
            s.fill = /^none$/i.test(merged.fill.trim()) ? null
                : merged.fill.trim().toLowerCase() === 'currentcolor' ? (parentStyle.fill || '#000000')
                    : this.resolvePaint(merged.fill);
        }
        if (merged.stroke !== undefined) {
            s.stroke = /^none$/i.test(merged.stroke.trim()) ? null
                : merged.stroke.trim().toLowerCase() === 'currentcolor' ? (parentStyle.stroke || '#000000')
                    : this.resolvePaint(merged.stroke);
        }
        if (merged['stroke-width'] !== undefined) {
            var sw = parseFloat(merged['stroke-width']);
            if (isFinite(sw)) s.strokeWidth = sw;
        }
        var op = parseFloat(merged.opacity);
        if (isFinite(op)) s.opacity = Math.max(0, Math.min(1, op));
        var fo = parseFloat(merged['fill-opacity']);
        if (isFinite(fo)) s.fillOpacity = Math.max(0, Math.min(1, fo));
        var so = parseFloat(merged['stroke-opacity']);
        if (isFinite(so)) s.strokeOpacity = Math.max(0, Math.min(1, so));
        if (merged.display !== undefined) s.display = merged.display.trim().toLowerCase();
        if (merged.visibility !== undefined) s.visibility = merged.visibility.trim().toLowerCase();
        return s;
    };

    /**
     * The element's own transform, applied about its transform-origin. Editors
     * (Boxy SVG, Figma) lean on `transform-box: fill-box; transform-origin: 50% 50%`
     * to rotate a shape in place — reading the matrix alone would fling it across
     * the canvas, which is exactly what a naive converter gets wrong.
     */
    Converter.prototype.elementMatrix = function (node, decls) {
        var m = parseTransform(node.attrs.transform || decls.transform);
        var originDecl = decls['transform-origin'];
        var boxDecl = (decls['transform-box'] || '').trim().toLowerCase();
        if (!originDecl && boxDecl !== 'fill-box' && boxDecl !== 'stroke-box') return m;

        var box = null;
        if (boxDecl === 'fill-box' || boxDecl === 'stroke-box' || boxDecl === 'content-box' || boxDecl === 'border-box') {
            box = bboxOfPoints(this.nodePoints(node, IDENTITY, 0));
            if (!isFinite(box.x0)) return m;
        } else {
            box = this.viewBox || { x0: 0, y0: 0, w: 0, h: 0 };   // view-box: percentages resolve against the viewport
        }
        var o = resolveOrigin(originDecl, box, boxDecl === 'fill-box' || boxDecl === 'stroke-box');
        return matMul(matMul([1, 0, 0, 1, o[0], o[1]], m), [1, 0, 0, 1, -o[0], -o[1]]);
    };

    /** Untransformed geometry of a node (and its children) as points, for bbox work. */
    Converter.prototype.nodePoints = function (node, mat, depth) {
        if (depth > 8) return [];
        var a = node.attrs || {};
        var out = [];
        var push = function (x, y) { out.push(applyMat(mat, x, y)); };
        if (node.tag === 'rect') {
            var x = num(a.x, 0), y = num(a.y, 0), w = num(a.width, 0), h = num(a.height, 0);
            push(x, y); push(x + w, y); push(x + w, y + h); push(x, y + h);
        } else if (node.tag === 'circle' || node.tag === 'ellipse') {
            var cx = num(a.cx, 0), cy = num(a.cy, 0);
            var rx = node.tag === 'circle' ? num(a.r, 0) : num(a.rx, num(a.ry, 0));
            var ry = node.tag === 'circle' ? num(a.r, 0) : num(a.ry, num(a.rx, 0));
            push(cx - rx, cy - ry); push(cx + rx, cy + ry);
        } else if (node.tag === 'line') {
            push(num(a.x1, 0), num(a.y1, 0)); push(num(a.x2, 0), num(a.y2, 0));
        } else if (node.tag === 'polygon' || node.tag === 'polyline') {
            var raw = (a.points || '').trim().split(/[\s,]+/).map(parseFloat);
            for (var i = 0; i + 1 < raw.length; i += 2) if (isFinite(raw[i]) && isFinite(raw[i + 1])) push(raw[i], raw[i + 1]);
        } else if (node.tag === 'path' && a.d) {
            var sps = parsePathData(a.d);
            for (var s = 0; s < sps.length; s++) {
                var pts = flattenSubpath(sps[s], 2);
                for (var p = 0; p < pts.length; p++) push(pts[p][0], pts[p][1]);
            }
        }
        for (var c = 0; c < (node.children || []).length; c++) {
            var kid = node.children[c];
            if (SKIP_TAGS[kid.tag]) continue;
            out = out.concat(this.nodePoints(kid, matMul(mat, parseTransform(kid.attrs.transform)), depth + 1));
        }
        return out;
    };

    Converter.prototype.walk = function (node, mat, parentStyle, depth) {
        if (depth > 24) return;
        for (var i = 0; i < node.children.length; i++) {
            var child = node.children[i];
            if (SKIP_TAGS[child.tag]) continue;
            var decls = this.mergedDecls(child);
            var style = this.styleFor(child, parentStyle, decls);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            var m = matMul(mat, this.elementMatrix(child, decls));

            if (child.tag === 'g' || child.tag === 'a' || child.tag === 'switch') {
                this.walk(child, m, style, depth + 1);
            } else if (child.tag === 'svg') {
                this.walk(child, matMul(m, viewBoxMatrix(child.attrs)), style, depth + 1);
            } else if (child.tag === 'use') {
                var ref = (child.attrs.href || '').replace(/^.*#/, '');
                var target = this.idMap[ref];
                if (target) {
                    var um = matMul(m, [1, 0, 0, 1, num(child.attrs.x, 0), num(child.attrs.y, 0)]);
                    // Wrap the referenced node so walk() handles it like a child. A
                    // <symbol>/<defs> target is skipped by tag, so descend into it.
                    var host = (target.tag === 'symbol' || target.tag === 'defs') ? target : { children: [target] };
                    this.walk(host, um, style, depth + 1);
                } else this.note('<use> with unresolved reference');
            } else {
                this.emitElement(child, m, style);
                if (child.children.length) this.walk(child, m, style, depth + 1);
            }
        }
    };

    Converter.prototype.emitElement = function (node, m, style) {
        var a = node.attrs;
        var fillAlpha = style.opacity * style.fillOpacity;
        var strokeAlpha = style.opacity * style.strokeOpacity;
        var fill = fillAlpha < 0.06 ? null : style.fill;
        var stroke = strokeAlpha < 0.06 ? null : style.stroke;
        if ((fill && fillAlpha < 0.99) || (stroke && strokeAlpha < 0.99)) {
            this.note('semi-transparent shape (alpha dropped — skins are fully opaque)');
        }
        var d = decompose(m);
        var scaleAvg = (Math.abs(d.sx) + Math.abs(d.sy)) / 2;
        var sw = stroke ? Math.max(0.05, style.strokeWidth * scaleAvg) : 0;
        var self = this;

        function paint(shape) {
            shape.fill = fill || '';
            shape.stroke = stroke || '';
            shape.sw = stroke ? sw : 0;
            if (!shape.fill && !shape.stroke) return;   // fully invisible
            self.shapes.push(shape);
        }
        function pt(x, y) { return applyMat(m, x, y); }
        function poly(points, closed) {
            paint({ t: 'polygon', points: points, closed: closed !== false });
        }

        switch (node.tag) {
            case 'rect': {
                var x = num(a.x, 0), y = num(a.y, 0), w = num(a.width, 0), h = num(a.height, 0);
                if (!(w > 0 && h > 0)) return;
                var rx = num(a.rx, num(a.ry, 0)), ry = num(a.ry, num(a.rx, 0));
                rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
                if (rx > 0.01 || ry > 0.01 || d.skew > 0.01) {
                    // No rounded-rect primitive and no shear: trace the outline instead.
                    var pts = roundedRectPoints(x, y, w, h, rx, ry).map(function (p) { return pt(p[0], p[1]); });
                    poly(pts, true);
                } else {
                    var c = pt(x + w / 2, y + h / 2);
                    paint({ t: 'rect', x: c[0], y: c[1], rx: w / 2 * Math.abs(d.sx), ry: h / 2 * Math.abs(d.sy), rot: d.rot });
                }
                return;
            }
            case 'circle':
            case 'ellipse': {
                var cx = num(a.cx, 0), cy = num(a.cy, 0);
                var erx = node.tag === 'circle' ? num(a.r, 0) : num(a.rx, num(a.ry, 0));
                var ery = node.tag === 'circle' ? num(a.r, 0) : num(a.ry, num(a.rx, 0));
                if (!(erx > 0 && ery > 0)) return;
                var ec = pt(cx, cy);
                var sx = erx * Math.abs(d.sx), sy = ery * Math.abs(d.sy);
                if (d.skew > 0.01) this.note('sheared ellipse (approximated)');
                if (Math.abs(sx - sy) < 1e-4) paint({ t: 'circle', x: ec[0], y: ec[1], r: sx });
                else paint({ t: 'ellipse', x: ec[0], y: ec[1], rx: sx, ry: sy, rot: d.rot });
                return;
            }
            case 'line': {
                var p1 = pt(num(a.x1, 0), num(a.y1, 0)), p2 = pt(num(a.x2, 0), num(a.y2, 0));
                paint({ t: 'line', x: p1[0], y: p1[1], x2: p2[0], y2: p2[1] });
                return;
            }
            case 'polygon':
            case 'polyline': {
                var raw = (a.points || '').trim().split(/[\s,]+/).map(parseFloat).filter(function (v) { return isFinite(v); });
                var pl = [];
                for (var i = 0; i + 1 < raw.length; i += 2) pl.push(pt(raw[i], raw[i + 1]));
                if (pl.length < 2) return;
                if (node.tag === 'polygon' || fill || nearlyClosed(pl)) poly(dedupe(pl), true);
                else this.emitOpenPolyline(dedupe(pl), fill, stroke, sw);
                return;
            }
            case 'path': {
                if (!a.d) return;
                var subpaths = parsePathData(a.d);
                var tol = 0.6 / Math.max(0.05, scaleAvg);   // flatten in user units, ~0.6 output units
                var holes = fill ? findHoles(subpaths, tol) : null;
                for (var s = 0; s < subpaths.length; s++) {
                    this.emitSubpath(subpaths[s], m, tol, fill, stroke, sw, holes ? holes[s] : false);
                }
                return;
            }
            case 'text':
            case 'tspan':
                this.note('<text> (not representable — convert text to outlines first)');
                return;
            case 'image':
                this.note('<image> (raster content cannot be converted)');
                return;
            default:
                return;
        }
    };

    /**
     * Which subpaths of one filled path are cut-outs. Canvas fills a multi-subpath
     * path as a single winding region, so an icon's inner loops punch holes; the
     * skin format has one loop per shape and cannot subtract. Even-odd nesting
     * depth decides: a loop inside an odd number of others is a hole.
     */
    function findHoles(subpaths, tol) {
        if (subpaths.length < 2) return null;
        var polys = subpaths.map(function (sp) { return flattenSubpath(sp, tol); });
        var flags = [];
        for (var i = 0; i < polys.length; i++) {
            var depth = 0;
            var probe = polys[i][0];
            for (var j = 0; j < polys.length; j++) {
                if (i === j || polys[j].length < 3) continue;
                if (polygonArea(polys[j]) > polygonArea(polys[i]) && pointInPolygon(probe, polys[j])) depth++;
            }
            flags.push(depth % 2 === 1);
        }
        return flags;
    }

    function pointInPolygon(p, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var yi = poly[i][1], yj = poly[j][1];
            if ((yi > p[1]) !== (yj > p[1])) {
                var x = (poly[j][0] - poly[i][0]) * (p[1] - yi) / (yj - yi) + poly[i][0];
                if (p[0] < x) inside = !inside;
            }
        }
        return inside;
    }

    Converter.prototype.emitSubpath = function (sp, m, tol, fill, stroke, sw, isHole) {
        if (isHole) {
            // No subtraction in the format: either paint the cut-out with the
            // chosen hole colour, keep just its stroked edge, or drop it.
            if (this.opt.holeFill) fill = this.opt.holeFill;
            else if (stroke) fill = null;
            else { this.holes = (this.holes || 0) + 1; return; }
        }
        if (!fill && !stroke) return;
        var xf = function (p) { return applyMat(m, p[0], p[1]); };

        // A lone cubic keeps its control points: the format has an exact `curve`.
        if (!fill && stroke && sp.segs.length === 1 && !sp.closed) {
            var seg = sp.segs[0];
            var a = xf(sp.start);
            if (seg.t === 'L') {
                var b = xf(seg.p);
                this.shapes.push({ t: 'line', x: a[0], y: a[1], x2: b[0], y2: b[1], fill: '', stroke: stroke, sw: sw });
            } else {
                var c1 = xf(seg.c1), c2 = xf(seg.c2), e = xf(seg.p);
                this.shapes.push({ t: 'curve', x: a[0], y: a[1], x2: e[0], y2: e[1],
                    cx1: c1[0], cy1: c1[1], cx2: c2[0], cy2: c2[1], fill: '', stroke: stroke, sw: sw });
            }
            return;
        }

        var pts = flattenSubpath(sp, tol).map(xf);
        if (pts.length < 2) return;
        var closed = sp.closed || !!fill || nearlyClosed(pts);
        if (closed) {
            this.shapes.push({ t: 'polygon', points: pts, closed: true, fill: fill || '', stroke: stroke || '', sw: stroke ? sw : 0 });
        } else if (stroke) {
            this.emitOpenPolyline(pts, null, stroke, sw);
        }
    };

    /**
     * An open stroked path has no primitive: `polygon` would draw a closing edge
     * that isn't in the artwork. Emit it as a chain of `line` shapes, simplified
     * first so a 60-point squiggle doesn't eat the whole 24-shape budget.
     */
    Converter.prototype.emitOpenPolyline = function (pts, fill, stroke, sw) {
        var maxSegs = Math.max(2, Math.min(8, this.opt.maxShapes - 1));
        var simple = simplifyPoints(pts, maxSegs + 1, false);
        if (simple.length > 2) this.note('open stroked path (split into ' + (simple.length - 1) + ' line segments)');
        for (var i = 1; i < simple.length; i++) {
            this.shapes.push({ t: 'line', x: simple[i - 1][0], y: simple[i - 1][1], x2: simple[i][0], y2: simple[i][1],
                fill: '', stroke: stroke || '#000000', sw: sw || 1 });
        }
    };

    function nearlyClosed(pts) {
        if (pts.length < 4) return false;
        var f = pts[0], l = pts[pts.length - 1];
        var d = Math.hypot(f[0] - l[0], f[1] - l[1]);
        var b = bboxOfPoints(pts);
        var diag = Math.hypot(b.w, b.h) || 1;
        return d / diag < 0.02;
    }

    function roundedRectPoints(x, y, w, h, rx, ry) {
        if (rx <= 0.01 && ry <= 0.01) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        var k = 3;  // points per corner arc — 4 corners × 3 = 12, under the 16 cap
        var pts = [];
        var corners = [
            [x + w - rx, y + ry, -Math.PI / 2, 0],
            [x + w - rx, y + h - ry, 0, Math.PI / 2],
            [x + rx, y + h - ry, Math.PI / 2, Math.PI],
            [x + rx, y + ry, Math.PI, Math.PI * 1.5],
        ];
        for (var c = 0; c < corners.length; c++) {
            var cc = corners[c];
            for (var i = 0; i <= k; i++) {
                var t = cc[2] + (cc[3] - cc[2]) * (i / k);
                pts.push([cc[0] + Math.cos(t) * rx, cc[1] + Math.sin(t) * ry]);
            }
        }
        return dedupe(pts);
    }

    /** `transform-origin` value → a point in the box's coordinate space. */
    function resolveOrigin(decl, box, isFillBox) {
        var w = box.w || 0, h = box.h || 0;
        var x0 = isFillBox ? (box.x0 || 0) : 0, y0 = isFillBox ? (box.y0 || 0) : 0;
        // With no explicit origin, fill-box means the shape's own centre.
        if (!decl) return isFillBox ? [x0 + w / 2, y0 + h / 2] : [0, 0];
        var parts = String(decl).trim().toLowerCase().split(/\s+/).slice(0, 2);
        var KEY_X = { left: 0, center: 0.5, centre: 0.5, right: 1 };
        var KEY_Y = { top: 0, center: 0.5, centre: 0.5, bottom: 1 };
        // A single keyword/length sets X; Y defaults to the centre.
        if (parts.length === 1) parts.push('center');
        if (KEY_Y[parts[0]] !== undefined && KEY_X[parts[0]] === undefined) parts.reverse();
        function comp(v, size, base, keys) {
            if (keys[v] !== undefined) return base + size * keys[v];
            if (/%$/.test(v)) return base + size * (parseFloat(v) / 100);
            var n = parseFloat(v);
            return isFinite(n) ? base + n : base + size / 2;
        }
        return [comp(parts[0], w, x0, KEY_X), comp(parts[1], h, y0, KEY_Y)];
    }

    function num(v, dflt) {
        if (v === undefined || v === null || v === '') return dflt;
        var n = parseFloat(String(v));
        return isFinite(n) ? n : dflt;
    }

    /** Nested <svg> / <symbol> viewBox → the matrix that maps it into the parent. */
    function viewBoxMatrix(attrs) {
        var vb = (attrs.viewbox || '').trim().split(/[\s,]+/).map(parseFloat);
        if (vb.length !== 4 || vb.some(function (v) { return !isFinite(v); })) return IDENTITY;
        var w = num(attrs.width, vb[2]), h = num(attrs.height, vb[3]);
        if (!(vb[2] > 0 && vb[3] > 0)) return IDENTITY;
        var s = Math.min(w / vb[2], h / vb[3]);
        return matMul([1, 0, 0, 1, num(attrs.x, 0), num(attrs.y, 0)],
            matMul([s, 0, 0, s, 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]));
    }

    // ── fitting, budgeting, output ──────────────────────────────────────────

    function bboxOfPoints(pts) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (var i = 0; i < pts.length; i++) {
            if (pts[i][0] < x0) x0 = pts[i][0];
            if (pts[i][0] > x1) x1 = pts[i][0];
            if (pts[i][1] < y0) y0 = pts[i][1];
            if (pts[i][1] > y1) y1 = pts[i][1];
        }
        return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
    }

    function shapeBBoxPoints(s) {
        var out = [];
        if (s.t === 'circle') {
            out.push([s.x - s.r, s.y - s.r], [s.x + s.r, s.y + s.r]);
        } else if (s.t === 'ellipse' || s.t === 'rect') {
            // Rotated extent of a half-width/height box.
            var a = (s.rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a));
            var ex = s.rx * c + s.ry * si, ey = s.rx * si + s.ry * c;
            out.push([s.x - ex, s.y - ey], [s.x + ex, s.y + ey]);
        } else if (s.t === 'polygon') {
            out = s.points.slice();
        } else if (s.t === 'line') {
            out.push([s.x, s.y], [s.x2, s.y2]);
        } else if (s.t === 'curve') {
            for (var i = 0; i <= 8; i++) {
                out.push(cubicPoint([s.x, s.y], [s.cx1, s.cy1], [s.cx2, s.cy2], [s.x2, s.y2], i / 8));
            }
        }
        return out;
    }

    /** Rough "how much of the drawing is this?" score, used to pick what survives. */
    function shapeWeight(s) {
        if (s.t === 'circle') return Math.PI * s.r * s.r;
        if (s.t === 'ellipse') return Math.PI * s.rx * s.ry;
        if (s.t === 'rect') return 4 * s.rx * s.ry;
        if (s.t === 'polygon') {
            var area = polygonArea(s.points);
            return s.fill ? area : Math.max(area * 0.35, polylineLength(s.points) * Math.max(1, s.sw || 1));
        }
        var pts = shapeBBoxPoints(s);
        return polylineLength(pts) * Math.max(1, s.sw || 1);
    }

    function scaleShape(s, k, cx, cy) {
        var o = { t: s.t, fill: s.fill, stroke: s.stroke, sw: (s.sw || 0) * k, rot: s.rot || 0 };
        var X = function (v) { return (v - cx) * k; };
        var Y = function (v) { return (v - cy) * k; };
        if (s.t === 'polygon') {
            o.x = 0; o.y = 0;
            o.points = s.points.map(function (p) { return [X(p[0]), Y(p[1])]; });
        } else {
            o.x = X(s.x); o.y = Y(s.y);
            if (s.t === 'circle') o.r = s.r * k;
            else if (s.t === 'ellipse' || s.t === 'rect') { o.rx = s.rx * k; o.ry = s.ry * k; }
            else if (s.t === 'line') { o.x2 = X(s.x2); o.y2 = Y(s.y2); }
            else if (s.t === 'curve') {
                o.x2 = X(s.x2); o.y2 = Y(s.y2);
                o.cx1 = X(s.cx1); o.cy1 = Y(s.cy1); o.cx2 = X(s.cx2); o.cy2 = Y(s.cy2);
            }
        }
        return o;
    }

    function round(v, precision) {
        var f = Math.pow(10, precision);
        var r = Math.round(v * f) / f;
        return r === 0 ? 0 : r;   // kill "-0"
    }

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    /** Final pass: clamp into the format's ranges and round for readable output. */
    function finalizeShape(s, precision) {
        var C = LIMITS.SKIN_COORD_LIMIT, R = LIMITS.SKIN_RADIUS_LIMIT;
        var o = { t: s.t, fill: s.fill || '', stroke: s.stroke || '', sw: round(clamp(s.sw || 0, 0, LIMITS.MAX_STROKE_WIDTH), precision) };
        o.x = round(clamp(s.x, -C, C), precision);
        o.y = round(clamp(s.y, -C, C), precision);
        var rot = ((s.rot || 0) % 360 + 360) % 360;
        if (rot > 180) rot -= 360;
        o.rot = round(rot, precision);
        if (s.t === 'circle') o.r = round(clamp(s.r, 0.5, R), precision);
        else if (s.t === 'ellipse' || s.t === 'rect') {
            o.rx = round(clamp(s.rx, 0.5, R), precision);
            o.ry = round(clamp(s.ry, 0.5, R), precision);
        } else if (s.t === 'line') {
            o.x2 = round(clamp(s.x2, -C, C), precision);
            o.y2 = round(clamp(s.y2, -C, C), precision);
        } else if (s.t === 'curve') {
            o.x2 = round(clamp(s.x2, -C, C), precision);
            o.y2 = round(clamp(s.y2, -C, C), precision);
            o.cx1 = round(clamp(s.cx1, -C, C), precision);
            o.cy1 = round(clamp(s.cy1, -C, C), precision);
            o.cx2 = round(clamp(s.cx2, -C, C), precision);
            o.cy2 = round(clamp(s.cy2, -C, C), precision);
        } else if (s.t === 'polygon') {
            o.points = [];
            for (var i = 0; i < s.points.length; i++) {
                o.points.push(round(clamp(s.points[i][0], -C, C), precision));
                o.points.push(round(clamp(s.points[i][1], -C, C), precision));
            }
        }
        if (o.stroke && !(o.sw > 0)) o.sw = round(Math.max(0.5, o.sw), precision) || 0.5;
        if (!o.fill && !o.stroke) o.fill = '#000000';
        return o;
    }

    /** One shape → one command line (same grammar serializeShape() in skinStudio.ts writes). */
    function serializeShape(s) {
        var p = [s.t, 'x=' + s.x, 'y=' + s.y];
        if (s.t === 'circle') p.push('r=' + s.r);
        else if (s.t === 'ellipse' || s.t === 'rect') p.push('rx=' + s.rx, 'ry=' + s.ry);
        else if (s.t === 'line') p.push('x2=' + s.x2, 'y2=' + s.y2);
        else if (s.t === 'curve') p.push('x2=' + s.x2, 'y2=' + s.y2, 'cx1=' + s.cx1, 'cy1=' + s.cy1, 'cx2=' + s.cx2, 'cy2=' + s.cy2);
        else if (s.t === 'polygon') p.push('points=' + s.points.join(','));
        if (s.t !== 'line' && s.t !== 'curve' && s.rot) p.push('rot=' + s.rot);
        if (s.fill) p.push('fill=' + s.fill);
        if (s.stroke) p.push('stroke=' + s.stroke);
        if (s.sw > 0) p.push('sw=' + s.sw);
        return p.join(' ');
    }

    /**
     * Convert SVG source into skin shapes + command text.
     *
     * options:
     *   maxShapes  shape budget (default/max 24)
     *   size       fit the drawing into a size×size box, centred on the origin
     *              (default 50 = the flower body's diameter)
     *   fit        'content' (default, uses the drawn bbox) or 'viewbox'
     *   precision  decimals in the output (default 1)
     *   minWeight  drop shapes smaller than this fraction of the largest (default 0)
     */
    function convertSvg(svgText, options) {
        options = options || {};
        var opt = {
            maxShapes: Math.max(1, Math.min(LIMITS.MAX_SKIN_SHAPES, options.maxShapes || LIMITS.MAX_SKIN_SHAPES)),
            size: options.size > 0 ? options.size : LIMITS.BODY_RADIUS * 2,
            fit: options.fit === 'viewbox' ? 'viewbox' : 'content',
            precision: options.precision === undefined ? 1 : Math.max(0, Math.min(3, options.precision)),
            minWeight: options.minWeight || 0,
            holeFill: parseColor(options.holeFill) || '',
        };
        var warnings = [];
        var parsed = parseXml(String(svgText || ''));
        var conv = new Converter(opt, function (w) { warnings.push(w); });
        conv.rules = parseCss(parsed.styleText);

        // The document element: <svg> if present, otherwise treat the whole file as one.
        var svgNode = findTag(parsed.root, 'svg');
        if (!svgNode) return { shapes: [], commands: '', warnings: ['No <svg> element found.'], stats: null };
        conv.indexIds(svgNode);
        conv.indexPaints(svgNode);
        // Viewport box, for percentage transform-origins.
        var rootVb = (svgNode.attrs.viewbox || '').trim().split(/[\s,]+/).map(parseFloat);
        conv.viewBox = (rootVb.length === 4 && rootVb.every(function (v) { return isFinite(v); }))
            ? { x0: rootVb[0], y0: rootVb[1], w: rootVb[2], h: rootVb[3] }
            : { x0: 0, y0: 0, w: num(svgNode.attrs.width, 0), h: num(svgNode.attrs.height, 0) };

        var baseStyle = {
            fill: '#000000', stroke: null, strokeWidth: 1,
            fillOpacity: 1, strokeOpacity: 1, display: 'inline', visibility: 'visible',
        };
        conv.walk(svgNode, IDENTITY, baseStyle, 0);

        var raw = conv.shapes;
        if (!raw.length) {
            for (var u in conv.unsupported) warnings.push(conv.unsupported[u] + '× ' + u);
            return { shapes: [], commands: '', warnings: warnings.concat(['Nothing drawable found in this SVG.']), stats: null };
        }

        // Budget: keep the visually biggest shapes, then restore document order so
        // the paint order (and therefore the layering) is preserved.
        for (var i = 0; i < raw.length; i++) { raw[i]._i = i; raw[i]._w = shapeWeight(raw[i]); }
        var kept = raw.slice();
        var maxW = kept.reduce(function (a, s) { return Math.max(a, s._w); }, 0);
        if (opt.minWeight > 0) {
            kept = kept.filter(function (s) { return s._w >= maxW * opt.minWeight; });
        }
        var droppedSmall = raw.length - kept.length;
        if (kept.length > opt.maxShapes) {
            kept = kept.slice().sort(function (a, b) { return b._w - a._w; }).slice(0, opt.maxShapes);
            kept.sort(function (a, b) { return a._i - b._i; });
        }
        var dropped = raw.length - kept.length;
        if (dropped > 0) {
            warnings.push('Dropped ' + dropped + ' of ' + raw.length + ' shapes to fit the '
                + opt.maxShapes + '-shape limit' + (droppedSmall ? '' : ' (smallest first)') + '.');
        }

        // Polygon point cap.
        var simplified = 0;
        for (var p = 0; p < kept.length; p++) {
            if (kept[p].t === 'polygon' && kept[p].points.length > LIMITS.MAX_POLY_POINTS) {
                kept[p].points = simplifyPoints(kept[p].points, LIMITS.MAX_POLY_POINTS, true);
                simplified++;
            }
            if (kept[p].t === 'polygon' && kept[p].points.length < 3) { kept.splice(p, 1); p--; }
        }
        if (simplified) {
            warnings.push('Simplified ' + simplified + ' outline' + (simplified > 1 ? 's' : '')
                + ' to the ' + LIMITS.MAX_POLY_POINTS + '-point polygon limit — fine detail is lost.');
        }
        if (conv.holes) {
            warnings.push('Dropped ' + conv.holes + ' cut-out' + (conv.holes > 1 ? 's' : '')
                + ' (holes/donuts): the skin format cannot subtract shapes. Set a hole colour to paint them instead.');
        }

        // Uniform fit into the target box.
        var allPts = [];
        for (var b = 0; b < kept.length; b++) allPts = allPts.concat(shapeBBoxPoints(kept[b]));
        var box = bboxOfPoints(allPts);
        if (opt.fit === 'viewbox') {
            var vb = (svgNode.attrs.viewbox || '').trim().split(/[\s,]+/).map(parseFloat);
            if (vb.length === 4 && vb.every(function (v) { return isFinite(v); }) && vb[2] > 0 && vb[3] > 0) {
                box = { x0: vb[0], y0: vb[1], x1: vb[0] + vb[2], y1: vb[1] + vb[3], w: vb[2], h: vb[3] };
            } else warnings.push('No usable viewBox — fitted to the drawing bounds instead.');
        }
        var k = Math.min(opt.size / (box.w || 1), opt.size / (box.h || 1));
        if (!isFinite(k) || k <= 0) k = 1;
        var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;

        var out = [];
        for (var f = 0; f < kept.length; f++) out.push(finalizeShape(scaleShape(kept[f], k, cx, cy), opt.precision));

        for (var uw in conv.unsupported) {
            warnings.push(conv.unsupported[uw] + '× ' + uw);
        }

        return {
            shapes: out,
            commands: out.map(serializeShape).join('\n'),
            warnings: warnings,
            stats: {
                sourceShapes: raw.length,
                shapes: out.length,
                scale: k,
                bounds: box,
                types: out.reduce(function (acc, s) { acc[s.t] = (acc[s.t] || 0) + 1; return acc; }, {}),
            },
        };
    }

    function findTag(node, tag) {
        if (node.tag === tag) return node;
        for (var i = 0; i < node.children.length; i++) {
            var hit = findTag(node.children[i], tag);
            if (hit) return hit;
        }
        return null;
    }

    /** Command text → the { name, shapes } payload the studio publishes. */
    function toSkinJson(result, name) {
        return {
            name: name || 'Imported Skin',
            shapes: result.shapes.map(function (s) {
                var o = { t: s.t, x: s.x, y: s.y };
                if (s.rot) o.rot = s.rot;
                if (s.fill) o.fill = s.fill;
                if (s.stroke) o.stroke = s.stroke;
                if (s.sw) o.sw = s.sw;
                if (s.t === 'circle') o.r = s.r;
                else if (s.t === 'ellipse' || s.t === 'rect') { o.rx = s.rx; o.ry = s.ry; }
                else if (s.t === 'line') { o.x2 = s.x2; o.y2 = s.y2; }
                else if (s.t === 'curve') { o.x2 = s.x2; o.y2 = s.y2; o.cx1 = s.cx1; o.cy1 = s.cy1; o.cx2 = s.cx2; o.cy2 = s.cy2; }
                else if (s.t === 'polygon') o.points = s.points;
                return o;
            }),
        };
    }

    var api = {
        convertSvg: convertSvg,
        toSkinJson: toSkinJson,
        serializeShape: serializeShape,
        parseColor: parseColor,
        parsePathData: parsePathData,
        parseTransform: parseTransform,
        LIMITS: LIMITS,
    };

    if (typeof module === 'object' && module && module.exports) module.exports = api;
    else global.SvgToSkin = api;

    // ── CLI ─────────────────────────────────────────────────────────────────
    if (typeof require === 'function' && typeof module === 'object' && require.main === module) {
        var fs = require('fs');
        var argv = process.argv.slice(2);
        var input = null, outFile = null, asJson = false, skinName = null, quiet = false;
        var o = { };
        for (var ai = 0; ai < argv.length; ai++) {
            var arg = argv[ai];
            if (arg === '-o' || arg === '--out') outFile = argv[++ai];
            else if (arg === '--max-shapes') o.maxShapes = parseInt(argv[++ai], 10);
            else if (arg === '--size') o.size = parseFloat(argv[++ai]);
            else if (arg === '--fit') o.fit = argv[++ai];
            else if (arg === '--precision') o.precision = parseInt(argv[++ai], 10);
            else if (arg === '--min-weight') o.minWeight = parseFloat(argv[++ai]);
            else if (arg === '--hole-fill') o.holeFill = argv[++ai];
            else if (arg === '--json') asJson = true;
            else if (arg === '--name') skinName = argv[++ai];
            else if (arg === '-q' || arg === '--quiet') quiet = true;
            else if (arg === '-h' || arg === '--help') { printHelp(); process.exit(0); }
            else if (arg.charAt(0) === '-') { console.error('Unknown option: ' + arg); process.exit(1); }
            else input = arg;
        }
        if (!input) { printHelp(); process.exit(1); }

        var src = fs.readFileSync(input, 'utf8');
        var result = convertSvg(src, o);
        if (!result.shapes.length) {
            console.error(result.warnings.join('\n'));
            process.exit(1);
        }
        var text = asJson
            ? JSON.stringify(toSkinJson(result, skinName || require('path').basename(input, '.svg')), null, 2)
            : result.commands;

        if (outFile) fs.writeFileSync(outFile, text + '\n');
        else console.log(text);

        if (!quiet) {
            var st = result.stats;
            var typeList = Object.keys(st.types).map(function (t) { return st.types[t] + ' ' + t; }).join(', ');
            console.error('\n' + st.shapes + '/' + LIMITS.MAX_SKIN_SHAPES + ' shapes (' + typeList + ')'
                + '  ·  scale ×' + st.scale.toFixed(3)
                + '  ·  source bounds ' + st.bounds.w.toFixed(1) + '×' + st.bounds.h.toFixed(1));
            for (var w = 0; w < result.warnings.length; w++) console.error('  ! ' + result.warnings[w]);
            if (outFile) console.error('  → ' + outFile);
        }
    }

    function printHelp() {
        console.error([
            'SVG → skin commands (paste into Skin Studio ▸ Create ▸ Text)',
            '',
            'Usage: node scripts/svg-to-skin.js <input.svg> [options]',
            '',
            '  -o, --out <file>     write to a file instead of stdout',
            '      --max-shapes <n> shape budget, 1-24 (default 24)',
            '      --size <n>       fit the art into an n×n box (default 50 = body diameter)',
            '      --fit <mode>     content (default) | viewbox',
            '      --precision <n>  decimals, 0-3 (default 1)',
            '      --min-weight <f> drop shapes under this fraction of the biggest (e.g. 0.01)',
            '      --hole-fill <c>  paint cut-outs/holes this colour instead of dropping them',
            '      --json           emit a { name, shapes } payload instead of command lines',
            '      --name <name>    skin name for --json',
            '  -q, --quiet          no stats/warnings on stderr',
            '',
            'Browser version: open SvgToSkin.html for drag-and-drop with a live preview.',
        ].join('\n'));
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
