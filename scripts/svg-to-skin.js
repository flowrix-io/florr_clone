#!/usr/bin/env node
/**
 * SVG → skin commands.
 *
 * Turns an SVG drawing into the canvas-command lines the Skin Studio's Text mode
 * accepts (one shape per line, see Studio::parseShapes() in
 * cpp/client/ui/menu_skins.cpp and the data model in
 * cpp/shared/game/skin_format.h). The output is deliberately the *text*
 * format, not JSON, because pasting it into the studio is the shortest path from
 * artwork to a publishable skin.
 *
 * The skin format is a tiny fixed vocabulary — circle / ellipse / rect / polygon
 * / line / curve — with hard limits (128 shapes, ±64 local coords, 16 polygon
 * points, #rrggbb colors, no alpha, no gradients, no clipping). So conversion is
 * lossy by construction and this file is mostly about *how* to lose things well:
 *
 *   - every element is flattened through its full ancestor transform chain
 *   - paths become polygons (filled) or line/curve segments (stroke-only),
 *     simplified down to the 16-point polygon limit
 *   - a single cubic path segment survives exactly as a `curve` shape
 *   - the whole drawing is uniformly scaled + centred to fit the flower body,
 *     and cut to the root viewBox the way a browser clips it
 *   - the SVG is also rasterised as it really looks (alpha, group opacity,
 *     gradients, fill-rule, occlusion) into a small reference picture, and
 *     that picture decides the rest:
 *       · when there are more shapes than the format allows, shapes are chosen
 *         greedily by how much closer each brings the skin to the picture —
 *         hidden, hairline and sub-pixel shapes go first, a background
 *         everything else covered stays as the backdrop for what was dropped
 *       · a shape that is semi-transparent, gradient-filled, or stands in for
 *         dropped detail is painted in the colour it shows in the picture; a
 *         solid opaque shape keeps its exact colour
 *       · artwork made of pieces edge to edge (a traced bitmap) would open a
 *         hole wherever a piece is dropped, so shapes traced from the picture
 *         itself (its silhouette, regions of similar colour) are offered as a
 *         backdrop beneath the drawing; selection decides which earn a slot
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

    // ── format limits (mirror cpp/shared/game/skin_format.h) ────────────────
    var LIMITS = {
        MAX_SKIN_SHAPES: 128,
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

    /** Binary min-heap of (key, int value) pairs. pop() leaves the pair in topKey/topVal. */
    function Heap() { this.k = []; this.v = []; this.topKey = 0; this.topVal = -1; }
    Heap.prototype.size = function () { return this.k.length; };
    Heap.prototype.push = function (key, val) {
        var k = this.k, v = this.v, i = k.length;
        k.push(key); v.push(val);
        while (i > 0) {
            var p = (i - 1) >> 1;
            if (k[p] <= key) break;
            k[i] = k[p]; v[i] = v[p]; i = p;
        }
        k[i] = key; v[i] = val;
    };
    Heap.prototype.pop = function () {
        var k = this.k, v = this.v;
        this.topKey = k[0]; this.topVal = v[0];
        var lastK = k.pop(), lastV = v.pop(), n = k.length;
        if (!n) return;
        var i = 0;
        for (;;) {
            var l = 2 * i + 1;
            if (l >= n) break;
            var c = l + 1 < n && k[l + 1] < k[l] ? l + 1 : l;
            if (k[c] >= lastK) break;
            k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lastK; v[i] = lastV;
    };

    /**
     * Visvalingam-Whyatt: drop the point whose triangle with its neighbours has
     * the least area until `max` remain. Gives an exact target count (unlike
     * epsilon-based simplification), which is what the 16-point cap needs.
     * Heap-driven, so a few-thousand-point outline costs milliseconds, not seconds.
     */
    function simplifyPoints(pts, max, closed) {
        var p = pts.slice();
        if (closed && p.length > 1) {
            var f = p[0], l = p[p.length - 1];
            if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) p.pop();
        }
        var n = p.length;
        if (n <= max) return p;
        var prev = new Int32Array(n), next = new Int32Array(n), alive = new Uint8Array(n), cur = new Float64Array(n);
        for (var i = 0; i < n; i++) { prev[i] = i - 1; next[i] = i + 1; alive[i] = 1; }
        if (closed) { prev[0] = n - 1; next[n - 1] = 0; } else next[n - 1] = -1;
        var area = function (j) {
            var a = p[prev[j]], b = p[j], c = p[next[j]];
            return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
        };
        var heap = new Heap();
        for (var j = 0; j < n; j++) {
            if (prev[j] < 0 || next[j] < 0) continue;   // an open line keeps its endpoints
            cur[j] = area(j);
            heap.push(cur[j], j);
        }
        var remaining = n;
        while (remaining > max && heap.size()) {
            heap.pop();
            var r = heap.topVal;
            if (!alive[r] || heap.topKey !== cur[r]) continue;   // stale entry
            alive[r] = 0; remaining--;
            var a = prev[r], c = next[r];
            next[a] = c; prev[c] = a;
            if (prev[a] >= 0 && next[a] >= 0) { cur[a] = area(a); heap.push(cur[a], a); }
            if (prev[c] >= 0 && next[c] >= 0) { cur[c] = area(c); heap.push(cur[c], c); }
        }
        var out = [];
        for (var q = 0; q < n; q++) if (alive[q]) out.push(p[q]);
        return out;
    }

    /**
     * Top-down point insertion for a closed outline: start from the two points
     * farthest apart, then keep adding whichever point sits farthest from the
     * outline so far. Where Visvalingam erodes the least-area corners first, this
     * keeps the extremities — a spike of hair, the tip of a leaf.
     */
    function insertSimplify(pts, max) {
        var n = pts.length;
        if (n <= max) return pts.slice();
        var far = 0, best = -1;
        for (var i = 1; i < n; i++) {
            var dx = pts[i][0] - pts[0][0], dy = pts[i][1] - pts[0][1];
            if (dx * dx + dy * dy > best) { best = dx * dx + dy * dy; far = i; }
        }
        var keep = new Uint8Array(n);
        keep[0] = keep[far] = 1;
        // One heap entry per ring segment (a → b) with points between its ends,
        // keyed by how far its farthest point strays from the chord.
        var heap = new Heap(), segA = [], segB = [], segK = [];
        var addSegment = function (a, b) {
            var A = pts[a], B = pts[b], ex = B[0] - A[0], ey = B[1] - A[1], L = ex * ex + ey * ey;
            var bi = -1, bd = 0;
            for (var j = (a + 1) % n; j !== b; j = (j + 1) % n) {
                var t = L > 0 ? ((pts[j][0] - A[0]) * ex + (pts[j][1] - A[1]) * ey) / L : 0;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                var qx = A[0] + t * ex - pts[j][0], qy = A[1] + t * ey - pts[j][1], d = qx * qx + qy * qy;
                if (d > bd) { bd = d; bi = j; }
            }
            if (bi < 0) return;
            segA.push(a); segB.push(b); segK.push(bi);
            heap.push(-bd, segK.length - 1);
        };
        addSegment(0, far);
        addSegment(far, 0);
        var count = 2;
        while (count < max && heap.size()) {
            heap.pop();
            var s = heap.topVal, k = segK[s];
            keep[k] = 1;
            count++;
            addSegment(segA[s], k);
            addSegment(k, segB[s]);
        }
        var out = [];
        for (var q = 0; q < n; q++) if (keep[q]) out.push(pts[q]);
        return out;
    }

    /** Pixels (at `cell` units each) where two filled outlines disagree. */
    function outlineMismatch(a, b, cell) {
        var bb = bboxOfPoints(a);
        var w = Math.ceil(bb.w / cell) + 3, h = Math.ceil(bb.h / cell) + 3;
        if (w * h > 1 << 16) {   // bound the cost on a huge shape: coarser grid
            cell *= Math.sqrt(w * h / (1 << 16));
            w = Math.ceil(bb.w / cell) + 3; h = Math.ceil(bb.h / cell) + 3;
        }
        var ox = bb.x0 / cell - 1, oy = bb.y0 / cell - 1;
        var local = function (p) { return [p[0] / cell - ox, p[1] / cell - oy]; };
        var mark = new Uint8Array(w * h), clip = { x0: 0, y0: 0, x1: w, y1: h, N: w };
        fillRings([a.map(local)], false, clip, function (i) { mark[i] |= 1; });
        fillRings([b.map(local)], false, clip, function (i) { mark[i] |= 2; });
        var bad = 0;
        for (var i = 0; i < mark.length; i++) if (mark[i] === 1 || mark[i] === 2) bad++;
        return bad;
    }

    /**
     * A closed outline down to `max` points. Visvalingam and top-down insertion
     * fail on different shapes, and which 16 points survive decides how a big
     * outline reads, so when the shape spans more than a few pixels (`cell`
     * units each) both are tried and the one covering the same pixels wins.
     */
    function simplifyOutline(pts, max, cell) {
        var vw = simplifyPoints(pts, max, true);
        var bb = bboxOfPoints(pts);
        if (Math.max(bb.w, bb.h) < cell * 6) return vw;
        var ins = insertSimplify(simplifyPoints(pts, Math.max(max * 8, 64), true), max);
        return outlineMismatch(pts, ins, cell) < outlineMismatch(pts, vw, cell) ? ins : vw;
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

    function matInvert(m) {
        var det = m[0] * m[3] - m[1] * m[2];
        if (!det || !isFinite(det)) return null;
        var a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
        return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
    }

    function hexRgb(hex) {
        if (!hex || hex.length !== 7 || hex.charAt(0) !== '#') return null;
        var v = parseInt(hex.slice(1), 16);
        return isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : null;
    }

    // ── SVG tree → skin shapes in user space ────────────────────────────────

    var SKIP_TAGS = { defs: 1, clippath: 1, mask: 1, marker: 1, symbol: 1, pattern: 1, filter: 1, style: 1,
        title: 1, desc: 1, metadata: 1, lineargradient: 1, radialgradient: 1, animate: 1, animatetransform: 1,
        animatemotion: 1, script: 1, foreignobject: 1 };

    /** CSS absolute units → user units (px). */
    var UNIT_PX = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

    function Converter(options, warn) {
        this.opt = options;
        this.warn = warn;
        this.shapes = [];
        // What every element paints at full fidelity — compound fills, fill-rule,
        // alpha, real gradients. The selection stage rasterises this into the
        // picture the skin is scored against; `shapes` is what it can choose from.
        this.draws = [];
        this.idMap = {};
        this.paints = {};   // gradient/pattern id → flat color
        this.gradNodes = {};
        this.gradCache = {};
        this.rules = [];
        this.unsupported = {};
        this.flatTol = 0.6;
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
                this.gradNodes[node.attrs.id] = node;
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
        if (hit) { this.note('gradient (drawn in the colour it shows on average)'); return hit; }
        this.note('unresolved paint reference (used gray)');
        return '#808080';
    };

    /** `url(#id)` → that id, when it names a gradient. */
    Converter.prototype.gradientRef = function (value) {
        var m = /^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/.exec(String(value || '').trim());
        return m && this.gradNodes[m[1]] ? m[1] : null;
    };

    /**
     * A gradient the rasteriser can evaluate: geometry, units and transform,
     * each inherited through href the way SVG does. Null when it has no stops.
     */
    Converter.prototype.gradient = function (id) {
        if (Object.prototype.hasOwnProperty.call(this.gradCache, id)) return this.gradCache[id];
        this.gradCache[id] = null;   // cycle guard
        var chain = [], node = this.gradNodes[id];
        while (node && chain.length < 8 && chain.indexOf(node) < 0) {
            chain.push(node);
            var href = String(node.attrs.href || '').replace(/^.*#/, '');
            node = href ? this.gradNodes[href] : null;
        }
        if (!chain.length) return null;
        var attr = function (name) {
            for (var i = 0; i < chain.length; i++) if (chain[i].attrs[name] !== undefined) return chain[i].attrs[name];
            return undefined;
        };
        var stops = [];
        for (var c = 0; c < chain.length && !stops.length; c++) stops = gradientStops(chain[c]);
        if (!stops.length) return null;

        var bbox = String(attr('gradientunits') || '').trim().toLowerCase() !== 'userspaceonuse';
        var vb = this.viewBox || { w: 0, h: 0 };
        var diag = Math.sqrt((vb.w * vb.w + vb.h * vb.h) / 2);
        var self = this;
        var coord = function (name, dflt, axis) {
            var v = attr(name);
            if (v === undefined || v === '') return dflt;
            var s = String(v).trim(), n = parseFloat(s);
            if (!isFinite(n)) return dflt;
            if (/%$/.test(s)) return n / 100 * (bbox ? 1 : axis === 'x' ? vb.w : axis === 'y' ? vb.h : diag);
            return bbox ? n : self.len(s, dflt, axis);
        };
        var g = {
            type: chain[0].tag === 'radialgradient' ? 'radial' : 'linear',
            bbox: bbox,
            gt: parseTransform(attr('gradienttransform')),
            spread: String(attr('spreadmethod') || 'pad').trim().toLowerCase(),
            stops: stops,
        };
        if (g.type === 'linear') {
            g.x1 = coord('x1', 0, 'x'); g.y1 = coord('y1', 0, 'y');
            g.x2 = coord('x2', bbox ? 1 : vb.w, 'x'); g.y2 = coord('y2', 0, 'y');
        } else {
            g.cx = coord('cx', bbox ? 0.5 : vb.w / 2, 'x'); g.cy = coord('cy', bbox ? 0.5 : vb.h / 2, 'y');
            g.r = coord('r', bbox ? 0.5 : diag / 2, 'r');
            g.fx = coord('fx', g.cx, 'x'); g.fy = coord('fy', g.cy, 'y');
        }
        this.gradCache[id] = g;
        return g;
    };

    function gradientStops(node) {
        var out = [], last = 0;
        for (var i = 0; i < node.children.length; i++) {
            var n = node.children[i];
            if (n.tag !== 'stop') continue;
            var css = parseDeclarations(n.attrs.style || '');
            var offRaw = String(n.attrs.offset !== undefined ? n.attrs.offset : (css.offset || '0')).trim();
            var off = parseFloat(offRaw);
            if (!isFinite(off)) off = 0;
            if (/%$/.test(offRaw)) off /= 100;
            off = Math.max(last, Math.min(1, Math.max(0, off)));   // offsets never run backwards
            last = off;
            var rawColor = css['stop-color'] !== undefined ? css['stop-color'] : n.attrs['stop-color'];
            var op = parseFloat(css['stop-opacity'] !== undefined ? css['stop-opacity'] : n.attrs['stop-opacity']);
            if (!isFinite(op)) op = 1;
            var hex = rawColor === undefined ? '#000000' : parseColor(rawColor);
            if (!hex) { hex = '#000000'; op = 0; }   // 'transparent'
            var rgb = hexRgb(hex);
            out.push({ o: off, r: rgb[0], g: rgb[1], b: rgb[2], a: Math.max(0, Math.min(1, op)) });
        }
        return out;
    }

    /** Colour + alpha of gradient `g` at (x, y) in its own space → out[0..3]. */
    function gradientAt(g, x, y, out) {
        var t;
        if (g.type === 'linear') {
            var dx = g.x2 - g.x1, dy = g.y2 - g.y1, L = dx * dx + dy * dy;
            t = L > 0 ? ((x - g.x1) * dx + (y - g.y1) * dy) / L : 1;
        } else if (!(g.r > 0)) {
            t = 1;
        } else {
            // Focal form: (x, y) lies on the circle centred at f + t(c - f) with radius t·r.
            var ddx = g.cx - g.fx, ddy = g.cy - g.fy, qx = x - g.fx, qy = y - g.fy;
            var a = ddx * ddx + ddy * ddy - g.r * g.r;
            var b = qx * ddx + qy * ddy;
            t = a < -1e-12 ? (b - Math.sqrt(Math.max(0, b * b - a * (qx * qx + qy * qy)))) / a
                : Math.hypot(x - g.cx, y - g.cy) / g.r;
        }
        if (g.spread === 'repeat') t -= Math.floor(t);
        else if (g.spread === 'reflect') { t = Math.abs(t) % 2; if (t > 1) t = 2 - t; }
        var s = g.stops, A = s[0], B = s[0], u = 0;
        if (t >= s[s.length - 1].o) A = B = s[s.length - 1];
        else if (t > s[0].o) {
            for (var i = 1; i < s.length; i++) {
                if (t <= s[i].o) {
                    A = s[i - 1]; B = s[i];
                    u = B.o > A.o ? (t - A.o) / (B.o - A.o) : 1;
                    break;
                }
            }
        }
        out[0] = A.r + (B.r - A.r) * u;
        out[1] = A.g + (B.g - A.g) * u;
        out[2] = A.b + (B.b - A.b) * u;
        out[3] = A.a + (B.a - A.a) * u;
    }

    /**
     * An SVG length → user units: absolute units converted, percentages taken
     * against the root viewport (`axis` 'x', 'y', or 'r' for the normalised
     * diagonal, as SVG does for r).
     */
    Converter.prototype.len = function (v, dflt, axis) {
        if (v === undefined || v === null || v === '') return dflt;
        var s = String(v).trim(), n = parseFloat(s);
        if (!isFinite(n)) return dflt;
        if (/%$/.test(s)) {
            var vb = this.viewBox || { w: 0, h: 0 };
            var ref = axis === 'x' ? vb.w : axis === 'y' ? vb.h : Math.sqrt((vb.w * vb.w + vb.h * vb.h) / 2);
            return n / 100 * ref;
        }
        var unit = /([a-z]+)$/i.exec(s);
        if (unit && UNIT_PX[unit[1].toLowerCase()]) n *= UNIT_PX[unit[1].toLowerCase()];
        return n;
    };

    /** A paint for the rasteriser: flat rgb, or a gradient plus the matrix from root space into it. */
    Converter.prototype.makePaint = function (hex, gradId, m, localBox) {
        var g = gradId ? this.gradient(gradId) : null;
        if (g) {
            var M = m;
            var usable = true;
            if (g.bbox) {
                // objectBoundingBox on a zero-width or zero-height shape has no
                // space to map into; SVG falls back the same way.
                if (localBox && localBox.w > 0 && localBox.h > 0) {
                    M = matMul(M, [localBox.w, 0, 0, localBox.h, localBox.x0, localBox.y0]);
                } else usable = false;
            }
            var inv = usable ? matInvert(matMul(M, g.gt)) : null;
            if (inv) return { grad: g, inv: inv };
        }
        var rgb = hexRgb(hex);
        return rgb ? { rgb: rgb } : null;
    };

    /** Presentation attrs < CSS rules < style="" (the SVG cascade, minus specificity). */
    Converter.prototype.mergedDecls = function (node) {
        var merged = {};
        var PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule',
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
            fillGrad: parentStyle.fillGrad, strokeGrad: parentStyle.strokeGrad, fillRule: parentStyle.fillRule,
            opacity: parentStyle.opacity, fillOpacity: parentStyle.fillOpacity, strokeOpacity: parentStyle.strokeOpacity,
            display: parentStyle.display, visibility: parentStyle.visibility,
        };
        merged = merged || this.mergedDecls(node);

        if (merged.fill !== undefined) {
            var fv = merged.fill.trim();
            s.fillGrad = null;
            if (/^none$/i.test(fv)) s.fill = null;
            else if (fv.toLowerCase() === 'currentcolor') { s.fill = parentStyle.fill || '#000000'; s.fillGrad = parentStyle.fillGrad; }
            else { s.fill = this.resolvePaint(fv); s.fillGrad = this.gradientRef(fv); }
        }
        if (merged.stroke !== undefined) {
            var sv = merged.stroke.trim();
            s.strokeGrad = null;
            if (/^none$/i.test(sv)) s.stroke = null;
            else if (sv.toLowerCase() === 'currentcolor') { s.stroke = parentStyle.stroke || '#000000'; s.strokeGrad = parentStyle.strokeGrad; }
            else { s.stroke = this.resolvePaint(sv); s.strokeGrad = this.gradientRef(sv); }
        }
        if (merged['stroke-width'] !== undefined) {
            var sw = this.len(merged['stroke-width'], NaN, 'r');
            if (isFinite(sw)) s.strokeWidth = sw;
        }
        if (merged['fill-rule'] !== undefined) s.fillRule = /evenodd/i.test(merged['fill-rule']) ? 'evenodd' : 'nonzero';
        // `opacity` is not inherited, it composites the whole group; multiplying
        // it down onto every descendant is the flat approximation of that.
        var op = parseFloat(merged.opacity);
        if (isFinite(op)) s.opacity *= Math.max(0, Math.min(1, op));
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
            var x = this.len(a.x, 0, 'x'), y = this.len(a.y, 0, 'y'), w = this.len(a.width, 0, 'x'), h = this.len(a.height, 0, 'y');
            push(x, y); push(x + w, y); push(x + w, y + h); push(x, y + h);
        } else if (node.tag === 'circle' || node.tag === 'ellipse') {
            var cx = this.len(a.cx, 0, 'x'), cy = this.len(a.cy, 0, 'y');
            var rx = node.tag === 'circle' ? this.len(a.r, 0, 'r') : this.len(a.rx, this.len(a.ry, 0, 'y'), 'x');
            var ry = node.tag === 'circle' ? rx : this.len(a.ry, this.len(a.rx, 0, 'x'), 'y');
            push(cx - rx, cy - ry); push(cx + rx, cy + ry);
        } else if (node.tag === 'line') {
            push(this.len(a.x1, 0, 'x'), this.len(a.y1, 0, 'y')); push(this.len(a.x2, 0, 'x'), this.len(a.y2, 0, 'y'));
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
                    var um = matMul(m, [1, 0, 0, 1, this.len(child.attrs.x, 0, 'x'), this.len(child.attrs.y, 0, 'y')]);
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

    /** A candidate skin shape, tagged with what selection needs to know about its paint. */
    Converter.prototype.addShape = function (shape, meta) {
        shape.fa = meta.fa;          // fill alpha
        shape.sa = meta.sa;          // stroke alpha
        shape.fg = meta.fg;          // fill is a gradient
        shape.sg = meta.sg;          // stroke is a gradient
        shape.fixed = !!meta.fixed;  // fill colour was chosen by the user (painted hole): never recolour
        this.shapes.push(shape);
    };

    Converter.prototype.emitElement = function (node, m, style) {
        var a = node.attrs;
        var fillAlpha = style.opacity * style.fillOpacity;
        var strokeAlpha = style.opacity * style.strokeOpacity;
        var fill = fillAlpha < 0.06 ? null : style.fill;
        var stroke = strokeAlpha < 0.06 ? null : style.stroke;
        if ((fill && fillAlpha < 0.99) || (stroke && strokeAlpha < 0.99)) {
            this.note('semi-transparent shape (drawn in the solid colour it shows)');
        }
        var d = decompose(m);
        var scaleAvg = (Math.abs(d.sx) + Math.abs(d.sy)) / 2;
        var sw = stroke ? Math.max(0.05, style.strokeWidth * scaleAvg) : 0;
        var meta = { fa: fillAlpha, sa: strokeAlpha, fg: !!style.fillGrad, sg: !!style.strokeGrad };
        var self = this;

        function paint(shape) {
            shape.fill = fill || '';
            shape.stroke = stroke || '';
            shape.sw = stroke ? sw : 0;
            if (!shape.fill && !shape.stroke) return;   // fully invisible
            self.addShape(shape, meta);
        }
        function pt(x, y) { return applyMat(m, x, y); }
        function poly(points, closed) {
            paint({ t: 'polygon', points: points, closed: closed !== false });
        }
        /** Record what this element really paints (root space), for the reference picture. */
        function picture(rings, closed, localBox, ellipse, noFill) {
            var fp = !noFill && style.fill && fillAlpha > 0.004
                ? self.makePaint(style.fill, style.fillGrad, m, localBox) : null;
            var sp = style.stroke && strokeAlpha > 0.004 && style.strokeWidth > 0
                ? self.makePaint(style.stroke, style.strokeGrad, m, localBox) : null;
            if (!fp && !sp) return;
            self.draws.push({ rings: rings, closed: closed, ellipse: ellipse || null, rule: style.fillRule,
                fill: fp, fa: fillAlpha, stroke: sp, sa: strokeAlpha, sw: style.strokeWidth * scaleAvg });
        }

        switch (node.tag) {
            case 'rect': {
                var x = this.len(a.x, 0, 'x'), y = this.len(a.y, 0, 'y');
                var w = this.len(a.width, 0, 'x'), h = this.len(a.height, 0, 'y');
                if (!(w > 0 && h > 0)) return;
                var rx = this.len(a.rx, this.len(a.ry, 0, 'y'), 'x'), ry = this.len(a.ry, this.len(a.rx, 0, 'x'), 'y');
                rx = Math.min(Math.max(0, rx), w / 2); ry = Math.min(Math.max(0, ry), h / 2);
                picture([roundedRectPoints(x, y, w, h, rx, ry, 6).map(function (p) { return pt(p[0], p[1]); })],
                    [true], { x0: x, y0: y, w: w, h: h });
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
                var cx = this.len(a.cx, 0, 'x'), cy = this.len(a.cy, 0, 'y');
                var erx = node.tag === 'circle' ? this.len(a.r, 0, 'r') : this.len(a.rx, this.len(a.ry, 0, 'y'), 'x');
                var ery = node.tag === 'circle' ? erx : this.len(a.ry, this.len(a.rx, 0, 'x'), 'y');
                if (!(erx > 0 && ery > 0)) return;
                picture(null, [true], { x0: cx - erx, y0: cy - ery, w: 2 * erx, h: 2 * ery },
                    { cx: cx, cy: cy, rx: erx, ry: ery, m: m });
                var ec = pt(cx, cy);
                var sx = erx * Math.abs(d.sx), sy = ery * Math.abs(d.sy);
                if (d.skew > 0.01) this.note('sheared ellipse (approximated)');
                if (Math.abs(sx - sy) < 1e-4) paint({ t: 'circle', x: ec[0], y: ec[1], r: sx });
                else paint({ t: 'ellipse', x: ec[0], y: ec[1], rx: sx, ry: sy, rot: d.rot });
                return;
            }
            case 'line': {
                var lx1 = this.len(a.x1, 0, 'x'), ly1 = this.len(a.y1, 0, 'y');
                var lx2 = this.len(a.x2, 0, 'x'), ly2 = this.len(a.y2, 0, 'y');
                var p1 = pt(lx1, ly1), p2 = pt(lx2, ly2);
                picture([[p1, p2]], [false], { x0: Math.min(lx1, lx2), y0: Math.min(ly1, ly2),
                    w: Math.abs(lx2 - lx1), h: Math.abs(ly2 - ly1) }, null, true);
                if (!stroke) return;   // a line has no inside to fill
                this.addShape({ t: 'line', x: p1[0], y: p1[1], x2: p2[0], y2: p2[1], fill: '', stroke: stroke, sw: sw }, meta);
                return;
            }
            case 'polygon':
            case 'polyline': {
                var raw = (a.points || '').trim().split(/[\s,]+/).map(parseFloat).filter(function (v) { return isFinite(v); });
                var local = [], pl = [];
                for (var i = 0; i + 1 < raw.length; i += 2) { local.push([raw[i], raw[i + 1]]); pl.push(pt(raw[i], raw[i + 1])); }
                if (pl.length < 2) return;
                var lb = bboxOfPoints(local);
                picture([pl], [node.tag === 'polygon'], { x0: lb.x0, y0: lb.y0, w: lb.w, h: lb.h });
                if (node.tag === 'polygon' || fill || nearlyClosed(pl)) poly(dedupe(pl), true);
                else if (stroke) this.emitOpenPolyline(dedupe(pl), stroke, sw, meta);
                return;
            }
            case 'path': {
                if (!a.d) return;
                var subpaths = parsePathData(a.d);
                if (!subpaths.length) return;
                // Flatten once, in user units, fine enough for the reference picture.
                var tol = this.flatTol / Math.max(0.05, scaleAvg);
                var flat = subpaths.map(function (sp) { return flattenSubpath(sp, tol); });
                var pb = bboxOfRings(flat);
                picture(flat.map(function (f) { return f.map(function (p) { return pt(p[0], p[1]); }); }),
                    subpaths.map(function (sp) { return sp.closed; }), { x0: pb.x0, y0: pb.y0, w: pb.w, h: pb.h });
                var holes = fill ? findHoles(flat) : null;
                // Solids before cut-outs: a painted-over hole has to land on top of
                // the outline it cuts, whatever order the path data lists them in.
                var order = [];
                for (var s = 0; s < subpaths.length; s++) if (!holes || !holes[s]) order.push(s);
                if (holes) for (var s2 = 0; s2 < subpaths.length; s2++) if (holes[s2]) order.push(s2);
                for (var o = 0; o < order.length; o++) {
                    var si = order[o];
                    this.emitSubpath(subpaths[si], flat[si], m, fill, stroke, sw, holes ? holes[si] : false, meta);
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
    function findHoles(polys) {
        if (polys.length < 2) return null;
        var areas = polys.map(function (p) { return p.length >= 3 ? polygonArea(p) : 0; });
        var flags = [];
        for (var i = 0; i < polys.length; i++) {
            var depth = 0;
            var probe = polys[i][0];
            for (var j = 0; j < polys.length; j++) {
                if (i === j || polys[j].length < 3) continue;
                if (areas[j] > areas[i] && pointInPolygon(probe, polys[j])) depth++;
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

    Converter.prototype.emitSubpath = function (sp, flat, m, fill, stroke, sw, isHole, meta) {
        if (isHole) {
            // No subtraction in the format: either paint the cut-out with the
            // chosen hole colour, keep just its stroked edge, or drop it.
            if (this.opt.holeFill) {
                fill = this.opt.holeFill;
                meta = { fa: 1, sa: meta.sa, fg: false, sg: meta.sg, fixed: true };
            } else if (stroke) fill = null;
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
                this.addShape({ t: 'line', x: a[0], y: a[1], x2: b[0], y2: b[1], fill: '', stroke: stroke, sw: sw }, meta);
            } else {
                var c1 = xf(seg.c1), c2 = xf(seg.c2), e = xf(seg.p);
                this.addShape({ t: 'curve', x: a[0], y: a[1], x2: e[0], y2: e[1],
                    cx1: c1[0], cy1: c1[1], cx2: c2[0], cy2: c2[1], fill: '', stroke: stroke, sw: sw }, meta);
            }
            return;
        }

        var pts = flat.map(xf);
        if (pts.length < 2) return;
        var closed = sp.closed || !!fill || nearlyClosed(pts);
        if (closed) {
            this.addShape({ t: 'polygon', points: pts, closed: true, fill: fill || '', stroke: stroke || '', sw: stroke ? sw : 0 }, meta);
        } else if (stroke) {
            this.emitOpenPolyline(pts, stroke, sw, meta);
        }
    };

    /**
     * An open stroked path has no primitive: `polygon` would draw a closing edge
     * that isn't in the artwork. Emit it as a chain of `line` shapes, simplified
     * first so a 60-point squiggle doesn't eat the whole shape budget.
     */
    Converter.prototype.emitOpenPolyline = function (pts, stroke, sw, meta) {
        var maxSegs = Math.max(2, Math.min(8, this.opt.maxShapes - 1));
        var simple = simplifyPoints(pts, maxSegs + 1, false);
        if (simple.length > 2) this.note('open stroked path (split into up to ' + maxSegs + ' line segments)');
        for (var i = 1; i < simple.length; i++) {
            this.addShape({ t: 'line', x: simple[i - 1][0], y: simple[i - 1][1], x2: simple[i][0], y2: simple[i][1],
                fill: '', stroke: stroke || '#000000', sw: sw || 1 }, meta);
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

    /** Rounded-rect outline; `k` points per corner arc (3 → 12 total, under the 16 cap). */
    function roundedRectPoints(x, y, w, h, rx, ry, k) {
        if (rx <= 0.01 && ry <= 0.01) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        k = k || 3;
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

    function bboxOfRings(rings) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (var r = 0; r < rings.length; r++) {
            var b = bboxOfPoints(rings[r]);
            if (b.x0 < x0) x0 = b.x0;
            if (b.x1 > x1) x1 = b.x1;
            if (b.y0 < y0) y0 = b.y0;
            if (b.y1 > y1) y1 = b.y1;
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

    /** Rough "how much of the drawing is this?" score, for the minWeight cut. */
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
        var o = { t: s.t, fill: s.fill, stroke: s.stroke, sw: (s.sw || 0) * k, rot: s.rot || 0,
            fa: s.fa, sa: s.sa, fg: s.fg, sg: s.sg, fixed: s.fixed };
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

    /** One shape → one command line (same grammar serializeShape() in cpp/client/ui/menu_skins.cpp writes). */
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

    // ── skin-space shape geometry ───────────────────────────────────────────
    // renderSkinShapes translates to (x, y) and rotates by `rot` before tracing
    // the path; lines and curves are written without a rotation.

    /** Outline of a shape's fill as renderSkinShapes traces it, or null for a line. */
    function shapeRing(s, segs) {
        var a = (s.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        var out = [];
        var P = function (lx, ly) { out.push([s.x + lx * ca - ly * sa, s.y + lx * sa + ly * ca]); };
        var i, t;
        if (s.t === 'circle' || s.t === 'ellipse') {
            var rx = s.t === 'circle' ? s.r : s.rx, ry = s.t === 'circle' ? s.r : s.ry;
            for (i = 0; i < segs; i++) { t = i / segs * Math.PI * 2; P(Math.cos(t) * rx, Math.sin(t) * ry); }
        } else if (s.t === 'rect') {
            P(-s.rx, -s.ry); P(s.rx, -s.ry); P(s.rx, s.ry); P(-s.rx, s.ry);
        } else if (s.t === 'polygon') {
            for (i = 0; i < s.points.length; i++) P(s.points[i][0], s.points[i][1]);
        } else if (s.t === 'curve') {
            for (i = 0; i <= 16; i++) out.push(cubicPoint([s.x, s.y], [s.cx1, s.cy1], [s.cx2, s.cy2], [s.x2, s.y2], i / 16));
        } else return null;
        return out;
    }

    /** The polylines a shape's stroke follows. */
    function shapeStrokes(s, segs) {
        if (s.t === 'line') return { polys: [[[s.x, s.y], [s.x2, s.y2]]], closed: [false] };
        var ring = shapeRing(s, segs);
        return ring ? { polys: [ring], closed: [s.t !== 'curve'] } : null;
    }

    function ringSegments(s, unitsPerPixel) {
        var r = s.t === 'circle' ? s.r : s.t === 'ellipse' ? Math.max(s.rx, s.ry) : 0;
        return Math.max(12, Math.min(64, Math.ceil(r / unitsPerPixel * 1.5) + 8));
    }

    // ── clipping to the root viewport ───────────────────────────────────────
    // A browser clips the drawing to the root <svg>'s viewport; skins only clip
    // at radius 100. Anything poking past the viewBox is cut here so the skin
    // keeps the picture's edges.

    function clipPolygonToRect(pts, r) {
        var planes = [[0, r.x0, 1], [0, r.x1, -1], [1, r.y0, 1], [1, r.y1, -1]];
        var out = pts;
        for (var e = 0; e < planes.length && out.length; e++) {
            var ax = planes[e][0], v = planes[e][1], sg = planes[e][2];
            var inp = out;
            out = [];
            for (var i = 0; i < inp.length; i++) {
                var A = inp[(i + inp.length - 1) % inp.length], B = inp[i];
                var inA = sg * (A[ax] - v) >= 0, inB = sg * (B[ax] - v) >= 0;
                if (inA !== inB) {
                    var t = (v - A[ax]) / (B[ax] - A[ax]);
                    out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
                }
                if (inB) out.push(B);
            }
        }
        return dedupe(out);
    }

    /** Liang–Barsky. */
    function clipSegment(x0, y0, x1, y1, r) {
        var t0 = 0, t1 = 1, dx = x1 - x0, dy = y1 - y0;
        var p = [-dx, dx, -dy, dy], q = [x0 - r.x0, r.x1 - x0, y0 - r.y0, r.y1 - y0];
        for (var i = 0; i < 4; i++) {
            if (p[i] === 0) { if (q[i] < 0) return null; continue; }
            var t = q[i] / p[i];
            if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
            else { if (t < t0) return null; if (t < t1) t1 = t; }
        }
        return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
    }

    /** `s` cut to rect `r`: the same shape, a clipped polygon, or null when nothing is left. */
    function clipShape(s, r) {
        var b = bboxOfPoints(shapeBBoxPoints(s)), pad = (s.sw || 0) / 2;
        if (b.x0 - pad >= r.x0 && b.x1 + pad <= r.x1 && b.y0 - pad >= r.y0 && b.y1 + pad <= r.y1) return s;
        if (b.x1 + pad < r.x0 || b.x0 - pad > r.x1 || b.y1 + pad < r.y0 || b.y0 - pad > r.y1) return null;
        if (s.t === 'line') {
            var seg = clipSegment(s.x, s.y, s.x2, s.y2, r);
            if (!seg) return null;
            s.x = seg[0]; s.y = seg[1]; s.x2 = seg[2]; s.y2 = seg[3];
            return s;
        }
        // A curve has no clipped form, and cutting a stroke-only outline would
        // stroke the cut edge too; only the stroke overhangs on a filled shape
        // that fits. Leave all three alone.
        if (s.t === 'curve' || !s.fill) return s;
        if (b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1) return s;
        var ring = clipPolygonToRect(shapeRing(s, 40), r);
        if (ring.length < 3 || polygonArea(ring) < 1e-6) return null;
        if (ring.length > LIMITS.MAX_POLY_POINTS) ring = simplifyPoints(ring, LIMITS.MAX_POLY_POINTS, true);
        return { t: 'polygon', x: 0, y: 0, rot: 0, points: ring, fill: s.fill, stroke: s.stroke, sw: s.sw,
            fa: s.fa, sa: s.sa, fg: s.fg, sg: s.sg, fixed: s.fixed };
    }

    // ── rasterising ─────────────────────────────────────────────────────────
    // Everything below works on a square grid laid over the fitted drawing
    // (skin space [-size/2, size/2]²). Sample (c, r) has its centre at grid
    // coordinates (c + 0.5, r + 0.5). Callbacks receive the flat index r·N + c.

    /** Grid bounds (exclusive max) of the region worth sampling: the square ∩ the viewport clip. */
    function gridClip(fr, N) {
        var cell = fr.size / N, H = fr.size / 2;
        var c = { x0: 0, y0: 0, x1: N, y1: N, N: N };
        if (fr.clip) {
            c.x0 = Math.max(0, Math.ceil((fr.clip.x0 + H) / cell - 0.5));
            c.x1 = Math.min(N, Math.ceil((fr.clip.x1 + H) / cell - 0.5));
            c.y0 = Math.max(0, Math.ceil((fr.clip.y0 + H) / cell - 0.5));
            c.y1 = Math.min(N, Math.ceil((fr.clip.y1 + H) / cell - 0.5));
        }
        return c;
    }

    /** Scanline fill of one compound region (all rings together, nonzero or even-odd). */
    function fillRings(rings, evenOdd, clip, cb) {
        var N = clip.N;
        var ex0 = [], ey0 = [], ex1 = [], ey1 = [], dir = [];
        var ymin = Infinity, ymax = -Infinity;
        for (var r = 0; r < rings.length; r++) {
            var ring = rings[r], n = ring.length;
            if (n < 3) continue;
            for (var i = 0; i < n; i++) {
                var a = ring[i], b = ring[i + 1 < n ? i + 1 : 0];
                if (a[1] === b[1]) continue;
                if (a[1] < b[1]) { ex0.push(a[0]); ey0.push(a[1]); ex1.push(b[0]); ey1.push(b[1]); dir.push(1); }
                else { ex0.push(b[0]); ey0.push(b[1]); ex1.push(a[0]); ey1.push(a[1]); dir.push(-1); }
                if (a[1] < ymin) ymin = a[1];
                if (b[1] < ymin) ymin = b[1];
                if (a[1] > ymax) ymax = a[1];
                if (b[1] > ymax) ymax = b[1];
            }
        }
        if (!dir.length) return;
        var r0 = Math.max(clip.y0, Math.ceil(ymin - 0.5)), r1 = Math.min(clip.y1 - 1, Math.ceil(ymax - 0.5) - 1);
        if (r1 < r0) return;
        var rows = new Array(r1 - r0 + 1);
        for (var e = 0; e < dir.length; e++) {
            var ya = ey0[e], yb = ey1[e];
            var s0 = Math.max(r0, Math.ceil(ya - 0.5)), s1 = Math.min(r1, Math.ceil(yb - 0.5) - 1);
            if (s1 < s0) continue;
            var slope = (ex1[e] - ex0[e]) / (yb - ya);
            for (var y = s0; y <= s1; y++) {
                var row = rows[y - r0] || (rows[y - r0] = []);
                row.push({ x: ex0[e] + (y + 0.5 - ya) * slope, d: dir[e] });
            }
        }
        var byX = function (p, q) { return p.x - q.x; };
        for (var ri = 0; ri < rows.length; ri++) {
            var xs = rows[ri];
            if (!xs || xs.length < 2) continue;
            xs.sort(byX);
            var wind = 0, base = (r0 + ri) * N;
            for (var k = 0; k + 1 < xs.length; k++) {
                wind += evenOdd ? 1 : xs[k].d;
                if (evenOdd ? !(wind & 1) : wind === 0) continue;
                var c0 = Math.max(clip.x0, Math.ceil(xs[k].x - 0.5));
                var c1 = Math.min(clip.x1 - 1, Math.ceil(xs[k + 1].x - 0.5) - 1);
                for (var c = c0; c <= c1; c++) cb(base + c);
            }
        }
    }

    /** Samples within `hw` of any segment of the polylines, each reported once (stamp/sid). */
    function strokePolylines(polys, closed, hw, clip, stamp, sid, cb) {
        var N = clip.N, hw2 = hw * hw;
        for (var k = 0; k < polys.length; k++) {
            var pts = polys[k], n = pts.length;
            if (!n) continue;
            var segs = n === 1 ? 1 : closed[k] ? n : n - 1;
            for (var i = 0; i < segs; i++) {
                var a = pts[i], b = pts[i + 1 < n ? i + 1 : 0];
                var c0 = Math.max(clip.x0, Math.ceil(Math.min(a[0], b[0]) - hw - 0.5));
                var c1 = Math.min(clip.x1 - 1, Math.floor(Math.max(a[0], b[0]) + hw - 0.5));
                var r0 = Math.max(clip.y0, Math.ceil(Math.min(a[1], b[1]) - hw - 0.5));
                var r1 = Math.min(clip.y1 - 1, Math.floor(Math.max(a[1], b[1]) + hw - 0.5));
                if (c1 < c0 || r1 < r0) continue;
                var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
                for (var r = r0; r <= r1; r++) {
                    var py = r + 0.5;
                    for (var c = c0; c <= c1; c++) {
                        var px = c + 0.5;
                        var t = L > 0 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L : 0;
                        t = t < 0 ? 0 : t > 1 ? 1 : t;
                        var qx = a[0] + t * dx - px, qy = a[1] + t * dy - py;
                        if (qx * qx + qy * qy > hw2) continue;
                        var idx = r * N + c;
                        if (stamp[idx] === sid) continue;
                        stamp[idx] = sid;
                        cb(idx);
                    }
                }
            }
        }
    }

    function ellipseRing(e, unitsToGrid) {
        var d = decompose(e.m);
        var rg = Math.max(e.rx * Math.abs(d.sx), e.ry * Math.abs(d.sy)) * unitsToGrid;
        var segs = Math.max(12, Math.min(96, Math.ceil(rg * 1.5) + 8));
        var out = [];
        for (var i = 0; i < segs; i++) {
            var t = i / segs * Math.PI * 2;
            out.push(applyMat(e.m, e.cx + Math.cos(t) * e.rx, e.cy + Math.sin(t) * e.ry));
        }
        return out;
    }

    /**
     * The SVG as it actually looks, n×n over the fitted drawing: every element
     * in paint order with its alpha, gradient and fill-rule, supersampled ss×ss.
     * Returns the picture composited over black (Tb) and over white (Tw) —
     * a skin replaces the flower body, so whatever the SVG leaves transparent
     * shows the world behind it, and scoring against both backgrounds charges a
     * shape for painting there whatever colour it is.
     */
    function renderPicture(draws, fr) {
        var ss = fr.ss, n = fr.n, N = n * ss, cell = fr.size / N, H = fr.size / 2;
        var k = fr.k, cx = fr.cx, cy = fr.cy;
        var clip = gridClip(fr, N);
        var buf = new Float32Array(N * N * 4);
        var stamp = new Uint32Array(N * N), sid = 0;
        var toGrid = function (p) { return [((p[0] - cx) * k + H) / cell, ((p[1] - cy) * k + H) / cell]; };
        var rgba = [0, 0, 0, 0];
        var paint = null, alpha = 1;

        function blend(idx) {
            var r, g, b, a = alpha;
            if (paint.rgb) { r = paint.rgb[0]; g = paint.rgb[1]; b = paint.rgb[2]; }
            else {
                var X = (((idx % N) + 0.5) * cell - H) / k + cx;
                var Y = ((((idx / N) | 0) + 0.5) * cell - H) / k + cy;
                var M = paint.inv;
                gradientAt(paint.grad, M[0] * X + M[2] * Y + M[4], M[1] * X + M[3] * Y + M[5], rgba);
                r = rgba[0]; g = rgba[1]; b = rgba[2]; a *= rgba[3];
            }
            var o = idx * 4, keep = 1 - a;
            buf[o] = r * a + buf[o] * keep;
            buf[o + 1] = g * a + buf[o + 1] * keep;
            buf[o + 2] = b * a + buf[o + 2] * keep;
            buf[o + 3] = a + buf[o + 3] * keep;
        }

        // A fill smaller than a sample would be hit or missed at random; spread
        // it as its area's worth of alpha on the sample it sits in instead.
        function splatTiny(g) {
            var bb = bboxOfRings(g);
            if (!(bb.w < 1.5 && bb.h < 1.5)) return false;
            var c = Math.floor((bb.x0 + bb.x1) / 2), r = Math.floor((bb.y0 + bb.y1) / 2);
            if (c < clip.x0 || c >= clip.x1 || r < clip.y0 || r >= clip.y1) return true;
            var area = 0;
            for (var i = 0; i < g.length; i++) if (g[i].length >= 3) area += polygonArea(g[i]);
            var saved = alpha;
            alpha *= Math.min(1, area);
            if (alpha > 0) blend(r * N + c);
            alpha = saved;
            return true;
        }

        for (var i = 0; i < draws.length; i++) {
            var d = draws[i];
            var rings = d.ellipse ? [ellipseRing(d.ellipse, k / cell)] : d.rings;
            var g = rings.map(function (ring) { return ring.map(toGrid); });
            if (d.fill) {
                paint = d.fill; alpha = d.fa;
                if (!splatTiny(g)) fillRings(g, d.rule === 'evenodd', clip, blend);
            }
            if (d.stroke && d.sw > 0) {
                var hw = d.sw * k / cell / 2;
                paint = d.stroke; alpha = d.sa;
                // Same idea for hairlines: one sample wide, alpha scaled to the true width.
                if (hw < 0.5) { alpha *= hw * 2; hw = 0.5; }
                strokePolylines(g, d.closed, hw, clip, stamp, ++sid, blend);
            }
        }

        var P = n * n, Tb = new Float32Array(P * 3), Tw = new Float32Array(P * 3), norm = 1 / (ss * ss);
        for (var y = 0; y < n; y++) {
            for (var x = 0; x < n; x++) {
                var sr = 0, sg = 0, sb = 0, sa = 0;
                for (var dy = 0; dy < ss; dy++) {
                    for (var dx = 0; dx < ss; dx++) {
                        var o = ((y * ss + dy) * N + x * ss + dx) * 4;
                        sr += buf[o]; sg += buf[o + 1]; sb += buf[o + 2]; sa += buf[o + 3];
                    }
                }
                var p3 = (y * n + x) * 3, bg = (1 - sa * norm) * 255;
                Tb[p3] = sr * norm; Tb[p3 + 1] = sg * norm; Tb[p3 + 2] = sb * norm;
                Tw[p3] = Tb[p3] + bg; Tw[p3 + 1] = Tb[p3 + 1] + bg; Tw[p3 + 2] = Tb[p3 + 2] + bg;
            }
        }
        return { n: n, Tb: Tb, Tw: Tw };
    }

    /**
     * Which pixels each candidate would paint, the way renderSkinShapes draws it
     * (centre-sampled, nonzero fill, round-capped stroke over the fill). Stroke
     * and fill pixel lists are disjoint: where both cover a pixel the stroke is
     * the one on top. A stroke under half a pixel wide is invisible at skin size
     * and gets no pixels.
     */
    function buildMasks(cands, fr) {
        var n = fr.n, cell = fr.size / n, H = fr.size / 2;
        var clip = gridClip(fr, n);
        var C = cands.length;
        var m = { fOff: new Int32Array(C), fLen: new Int32Array(C), sOff: new Int32Array(C), sLen: new Int32Array(C) };
        var pool = new Int32Array(1 << 16), used = 0;
        var push = function (idx) {
            if (used === pool.length) { var grown = new Int32Array(pool.length * 2); grown.set(pool); pool = grown; }
            pool[used++] = idx;
        };
        var stamp = new Uint32Array(n * n), sid = 0;
        var toGrid = function (p) { return [(p[0] + H) / cell, (p[1] + H) / cell]; };
        var fillPush = function (idx) { if (stamp[idx] !== sid) push(idx); };
        for (var i = 0; i < C; i++) {
            var s = cands[i], segs = ringSegments(s, cell);
            sid++;
            m.sOff[i] = used;
            if (s.stroke && s.sw / cell >= 0.5) {
                var st = shapeStrokes(s, segs);
                if (st) strokePolylines(st.polys.map(function (pl) { return pl.map(toGrid); }), st.closed, s.sw / cell / 2, clip, stamp, sid, push);
            }
            m.sLen[i] = used - m.sOff[i];
            m.fOff[i] = used;
            if (s.fill && s.t !== 'line') {
                var ring = shapeRing(s, segs);
                if (ring) fillRings([ring.map(toGrid)], false, clip, fillPush);
            }
            m.fLen[i] = used - m.fOff[i];
        }
        m.pool = pool;
        m.used = used;
        return m;
    }

    /** Mask sets side by side: `order` lists [set, index] pairs, the result follows it. */
    function joinMasks(sets, order) {
        var total = 0, base = [];
        for (var i = 0; i < sets.length; i++) { base.push(total); total += sets[i].used; }
        var pool = new Int32Array(Math.max(1, total));
        for (var j = 0; j < sets.length; j++) pool.set(sets[j].pool.subarray(0, sets[j].used), base[j]);
        var C = order.length;
        var m = { pool: pool, used: total, fOff: new Int32Array(C), fLen: new Int32Array(C), sOff: new Int32Array(C), sLen: new Int32Array(C) };
        for (var k = 0; k < C; k++) {
            var s = sets[order[k][0]], i2 = order[k][1], b = base[order[k][0]];
            m.fOff[k] = s.fOff[i2] + b; m.fLen[k] = s.fLen[i2];
            m.sOff[k] = s.sOff[i2] + b; m.sLen[k] = s.sLen[i2];
        }
        return m;
    }

    /** Shapes less than a tenth visible once everything after them is painted. */
    function buriedShapes(masks, C, n) {
        var covered = new Uint8Array(n * n), buried = new Uint8Array(C), pool = masks.pool;
        for (var i = C - 1; i >= 0; i--) {
            var total = masks.fLen[i] + masks.sLen[i], seen = 0;
            if (!total) continue;
            for (var part = 0; part < 2; part++) {
                var off = part ? masks.sOff[i] : masks.fOff[i], end = off + (part ? masks.sLen[i] : masks.fLen[i]);
                for (var j = off; j < end; j++) if (!covered[pool[j]]) { covered[pool[j]] = 1; seen++; }
            }
            if (seen < total * 0.1) buried[i] = 1;
        }
        return buried;
    }

    // ── backdrop: shapes traced from the picture ────────────────────────────
    // A drawing made of pieces that tile the canvas — a traced bitmap is
    // hundreds of regions edge to edge with nothing underneath — opens a hole
    // wherever a piece is dropped, and no shape in the SVG can cover it. These
    // candidates are not in the SVG: they are traced from the picture (the
    // outline of everything opaque, and regions of similar colour) and go
    // beneath the drawing, so what the kept pieces leave open shows the colour
    // that was there instead of the world behind the skin. Selection decides
    // which, if any, are worth a slot.

    /** Un-premultiplied colour (0-255) and alpha per pixel, from the over-black/over-white pair. */
    function pictureColours(pic) {
        var P = pic.n * pic.n, alpha = new Float32Array(P), rgb = new Float32Array(P * 3);
        for (var p = 0; p < P; p++) {
            var d = (pic.Tw[p * 3] - pic.Tb[p * 3] + pic.Tw[p * 3 + 1] - pic.Tb[p * 3 + 1] + pic.Tw[p * 3 + 2] - pic.Tb[p * 3 + 2]) / 3;
            var a = clamp(1 - d / 255, 0, 1);
            alpha[p] = a;
            for (var ch = 0; ch < 3; ch++) rgb[p * 3 + ch] = a > 0.02 ? clamp(pic.Tb[p * 3 + ch] / a, 0, 255) : 0;
        }
        return { alpha: alpha, rgb: rgb };
    }

    /** Box blur of premultiplied colour, so a busy texture clusters into areas rather than speckle. */
    function blurColours(cols, n, radius) {
        var P = n * n, src = new Float32Array(P * 4), tmp = new Float32Array(P * 4), out = new Float32Array(P * 3);
        for (var p = 0; p < P; p++) {
            var a = cols.alpha[p];
            src[p * 4] = cols.rgb[p * 3] * a; src[p * 4 + 1] = cols.rgb[p * 3 + 1] * a; src[p * 4 + 2] = cols.rgb[p * 3 + 2] * a; src[p * 4 + 3] = a;
        }
        var pass = function (from, to, horizontal) {
            for (var r = 0; r < n; r++) {
                for (var c = 0; c < n; c++) {
                    var s0 = 0, s1 = 0, s2 = 0, s3 = 0, cnt = 0;
                    for (var d = -radius; d <= radius; d++) {
                        var cc = horizontal ? c + d : c, rr = horizontal ? r : r + d;
                        if (cc < 0 || rr < 0 || cc >= n || rr >= n) continue;
                        var q = (rr * n + cc) * 4;
                        s0 += from[q]; s1 += from[q + 1]; s2 += from[q + 2]; s3 += from[q + 3]; cnt++;
                    }
                    var o = (r * n + c) * 4;
                    to[o] = s0 / cnt; to[o + 1] = s1 / cnt; to[o + 2] = s2 / cnt; to[o + 3] = s3 / cnt;
                }
            }
        };
        pass(src, tmp, true);
        pass(tmp, src, false);
        for (var q2 = 0; q2 < P; q2++) {
            var al = src[q2 * 4 + 3];
            for (var ch = 0; ch < 3; ch++) out[q2 * 3 + ch] = al > 0.02 ? clamp(src[q2 * 4 + ch] / al, 0, 255) : 0;
        }
        return out;
    }

    /** k-means colour labels for the `solid` pixels (-1 elsewhere); deterministic farthest-point seeding. */
    function colourLabels(rgb, solid, k) {
        var P = solid.length, idx = [];
        for (var p = 0; p < P; p++) if (solid[p]) idx.push(p);
        if (idx.length < k * 4) return null;
        var dist = function (q, c) {
            var d0 = rgb[q * 3] - c[0], d1 = rgb[q * 3 + 1] - c[1], d2 = rgb[q * 3 + 2] - c[2];
            return W0 * d0 * d0 + W1 * d1 * d1 + W2 * d2 * d2;
        };
        var mean = [0, 0, 0];
        for (var i = 0; i < idx.length; i++) for (var ch = 0; ch < 3; ch++) mean[ch] += rgb[idx[i] * 3 + ch] / idx.length;
        var cents = [mean], step = Math.max(1, Math.floor(idx.length / 3000));
        while (cents.length < k) {
            var bestQ = -1, bestD = 25;   // stop once every colour sits within ~5 levels of a centre
            for (var s = 0; s < idx.length; s += step) {
                var q = idx[s], dmin = Infinity;
                for (var c = 0; c < cents.length; c++) dmin = Math.min(dmin, dist(q, cents[c]));
                if (dmin > bestD) { bestD = dmin; bestQ = q; }
            }
            if (bestQ < 0) break;
            cents.push([rgb[bestQ * 3], rgb[bestQ * 3 + 1], rgb[bestQ * 3 + 2]]);
        }
        var labels = new Int16Array(P).fill(-1);
        for (var it = 0; it < 10; it++) {
            var sums = cents.map(function () { return [0, 0, 0, 0]; }), changed = 0;
            for (var j = 0; j < idx.length; j++) {
                var px = idx[j], best = 0, bd = Infinity;
                for (var c2 = 0; c2 < cents.length; c2++) {
                    var dd = dist(px, cents[c2]);
                    if (dd < bd) { bd = dd; best = c2; }
                }
                if (labels[px] !== best) { labels[px] = best; changed++; }
                sums[best][0] += rgb[px * 3]; sums[best][1] += rgb[px * 3 + 1]; sums[best][2] += rgb[px * 3 + 2]; sums[best][3]++;
            }
            for (var c3 = 0; c3 < cents.length; c3++) {
                if (sums[c3][3]) cents[c3] = [sums[c3][0] / sums[c3][3], sums[c3][1] / sums[c3][3], sums[c3][2] / sums[c3][3]];
            }
            if (!changed) break;
        }
        return labels;
    }

    /**
     * Outer outline of one 4-connected pixel region, along pixel edges (grid
     * corner units). Boundary edges run with the region on their right; at a
     * corner where two region pixels only touch diagonally the trace turns
     * right, keeping to the pixel it is on. Of the loops found, the one
     * enclosing the most area is the outside.
     */
    function regionOutline(comp, id, members, n) {
        var W = n + 1, edges = [], from = {};
        var add = function (sx, sy, ex, ey) {
            var e = { s: sy * W + sx, e: ey * W + ex, used: false };
            edges.push(e);
            (from[e.s] || (from[e.s] = [])).push(e);
        };
        var inside = function (c, r) { return c >= 0 && r >= 0 && c < n && r < n && comp[r * n + c] === id; };
        for (var i = 0; i < members.length; i++) {
            var p = members[i], c = p % n, r = (p / n) | 0;
            if (!inside(c, r - 1)) add(c, r, c + 1, r);
            if (!inside(c + 1, r)) add(c + 1, r, c + 1, r + 1);
            if (!inside(c, r + 1)) add(c + 1, r + 1, c, r + 1);
            if (!inside(c - 1, r)) add(c, r + 1, c, r);
        }
        var best = null, bestArea = 0;
        for (var k = 0; k < edges.length; k++) {
            if (edges[k].used) continue;
            var loop = [], e = edges[k];
            while (e && !e.used) {
                e.used = true;
                loop.push(e.s);
                var dx = (e.e % W) - (e.s % W), dy = ((e.e / W) | 0) - ((e.s / W) | 0);
                var outs = from[e.e] || [], next = null, rank = 9;
                for (var o = 0; o < outs.length; o++) {
                    if (outs[o].used) continue;
                    var ndx = (outs[o].e % W) - (outs[o].s % W), ndy = ((outs[o].e / W) | 0) - ((outs[o].s / W) | 0);
                    // right turn (y down) first, then straight, then left
                    var rk = (ndx === -dy && ndy === dx) ? 0 : (ndx === dx && ndy === dy) ? 1 : 2;
                    if (rk < rank) { rank = rk; next = outs[o]; }
                }
                e = next;
            }
            if (loop.length < 4) continue;
            var area = 0;
            for (var a = 0; a < loop.length; a++) {
                var v0 = loop[a], v1 = loop[(a + 1) % loop.length];
                area += (v0 % W) * ((v1 / W) | 0) - (v1 % W) * ((v0 / W) | 0);
            }
            if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = loop; }
        }
        if (!best) return null;
        // Edge midpoints instead of corners: a staircase becomes a diagonal,
        // which simplifies to far fewer points.
        var pts = [];
        for (var m = 0; m < best.length; m++) {
            var u = best[m], w = best[(m + 1) % best.length];
            pts.push([((u % W) + (w % W)) / 2, (((u / W) | 0) + ((w / W) | 0)) / 2]);
        }
        var out = [];
        for (var t = 0; t < pts.length; t++) {
            var A = pts[(t + pts.length - 1) % pts.length], B = pts[t], C = pts[(t + 1) % pts.length];
            if ((B[0] - A[0]) * (C[1] - B[1]) - (B[1] - A[1]) * (C[0] - B[0]) !== 0) out.push(B);
        }
        return out.length >= 3 ? out : null;
    }

    /** Every 4-connected region of `mask` with at least `minPixels` pixels → a backdrop polygon. */
    function traceRegions(mask, n, fr, rgb, minPixels, out) {
        var P = n * n, comp = new Int32Array(P).fill(-1), cell = fr.size / n, H = fr.size / 2, next = 0;
        var stack = [];
        for (var p = 0; p < P; p++) {
            if (!mask[p] || comp[p] >= 0) continue;
            var id = next++, members = [];
            comp[p] = id; stack.push(p);
            while (stack.length) {
                var q = stack.pop(), c = q % n, r = (q / n) | 0;
                members.push(q);
                var nb = [r > 0 ? q - n : -1, r < n - 1 ? q + n : -1, c > 0 ? q - 1 : -1, c < n - 1 ? q + 1 : -1];
                for (var i = 0; i < 4; i++) {
                    if (nb[i] >= 0 && mask[nb[i]] && comp[nb[i]] < 0) { comp[nb[i]] = id; stack.push(nb[i]); }
                }
            }
            if (members.length < minPixels) continue;
            var ring = regionOutline(comp, id, members, n);
            if (!ring) continue;
            ring = ring.map(function (v) { return [v[0] * cell - H, v[1] * cell - H]; });
            if (ring.length > LIMITS.MAX_POLY_POINTS) ring = simplifyOutline(ring, LIMITS.MAX_POLY_POINTS, cell / 2);
            var s0 = 0, s1 = 0, s2 = 0;
            for (var j = 0; j < members.length; j++) {
                s0 += rgb[members[j] * 3]; s1 += rgb[members[j] * 3 + 1]; s2 += rgb[members[j] * 3 + 2];
            }
            var nm = members.length;
            out.push({ t: 'polygon', x: 0, y: 0, rot: 0, points: ring,
                fill: '#' + hex2(s0 / nm) + hex2(s1 / nm) + hex2(s2 / nm), stroke: '', sw: 0,
                // A stand-in by nature: always painted in the colour it ends up showing.
                fa: 1, sa: 1, fg: true, sg: false, fixed: false, backdrop: true, _area: polygonArea(ring) });
        }
    }

    function backdropShapes(pic, fr) {
        var n = pic.n, P = n * n;
        var cols = pictureColours(pic);
        var solid = new Uint8Array(P), any = 0;
        for (var p = 0; p < P; p++) if (cols.alpha[p] >= 0.5) { solid[p] = 1; any++; }
        var out = [];
        if (!any) return out;
        var minPixels = Math.max(16, Math.round(P / 1000));   // smaller than this is detail, not a gap
        traceRegions(solid, n, fr, cols.rgb, minPixels, out);
        var variants = [[cols.rgb, 8], [blurColours(cols, n, 2), 6]];
        for (var v = 0; v < variants.length; v++) {
            var labels = colourLabels(variants[v][0], solid, variants[v][1]);
            if (!labels) continue;
            for (var l = 0; l < variants[v][1]; l++) {
                var mask = new Uint8Array(P);
                for (var q = 0; q < P; q++) if (labels[q] === l) mask[q] = 1;
                traceRegions(mask, n, fr, cols.rgb, minPixels, out);
            }
        }
        // Bigger regions underneath, so the regions nested in them land on top.
        out.sort(function (a, b) { return b._area - a._area; });
        return out;
    }

    // ── choosing shapes ─────────────────────────────────────────────────────

    // Colour error weights per channel: green counts most, red least — a cheap
    // stand-in for perceptual distance with no colour-space conversion.
    var W0 = 2 / 9, W1 = 4 / 9, W2 = 3 / 9;

    /**
     * Pick at most `budget` candidates and their colours so the skin looks as
     * much like the picture as it can.
     *
     * Every pixel belongs to the topmost chosen shape covering it (document
     * order is paint order, whatever order shapes are chosen in), or to nothing.
     * A shape part's colour is its own when that is about as good as anything,
     * otherwise the mean of the picture over the pixels it owns — which is how a
     * half-transparent shape, a gradient, or a background whose detail was
     * dropped gets the colour it actually shows. Shapes are added greedily by
     * how much they lower the squared error (lazy greedy: a stale gain is an
     * optimistic bound, so only the heap top is re-evaluated).
     *
     * With `keepAll` every candidate is kept and only the colours are solved.
     */
    function selectShapes(cands, masks, pic, budget, keepAll, recolor) {
        var C = cands.length, P = pic.n * pic.n, Tb = pic.Tb, Tw = pic.Tw, pool = masks.pool;
        // Per pixel, summed over both backgrounds: S (per channel), Q (weighted
        // squares) and the error of painting nothing there.
        var Sp = new Float64Array(P * 3), Qp = new Float64Array(P), Eb = new Float64Array(P);
        for (var p = 0; p < P; p++) {
            var b0 = Tb[p * 3], b1 = Tb[p * 3 + 1], b2 = Tb[p * 3 + 2];
            var w0 = Tw[p * 3], w1 = Tw[p * 3 + 1], w2 = Tw[p * 3 + 2];
            Sp[p * 3] = b0 + w0; Sp[p * 3 + 1] = b1 + w1; Sp[p * 3 + 2] = b2 + w2;
            Qp[p] = W0 * (b0 * b0 + w0 * w0) + W1 * (b1 * b1 + w1 * w1) + W2 * (b2 * b2 + w2 * w2);
            Eb[p] = W0 * (b0 * b0 + (255 - w0) * (255 - w0)) + W1 * (b1 * b1 + (255 - w1) * (255 - w1))
                + W2 * (b2 * b2 + (255 - w2) * (255 - w2));
        }

        // Part id = candidate * 2 + (0 fill | 1 stroke).
        var top = new Int32Array(P).fill(-1);
        var pn = new Int32Array(2 * C), pS = new Float64Array(6 * C), pQ = new Float64Array(2 * C);
        var col = new Float64Array(6 * C), own = new Float64Array(6 * C);
        var mode = new Uint8Array(2 * C);   // 0 own colour only, 1 own unless clearly worse, 2 picture's colour
        var dirtyMark = new Int32Array(2 * C);
        for (var i = 0; i < C; i++) {
            var s = cands[i];
            own.set(hexRgb(s.fill) || [0, 0, 0], i * 6);
            own.set(hexRgb(s.stroke) || [0, 0, 0], i * 6 + 3);
            mode[i * 2] = !recolor || s.fixed ? 0 : (s.fg || s.fa < 0.99 ? 2 : 1);
            mode[i * 2 + 1] = !recolor ? 0 : (s.sg || s.sa < 0.99 ? 2 : 1);
        }
        col.set(own);

        var pick = new Float64Array(3);
        function errOf(n, S0, S1, S2, Q, c0, c1, c2) {
            return Q - 2 * (W0 * c0 * S0 + W1 * c1 * S1 + W2 * c2 * S2) + 2 * n * (W0 * c0 * c0 + W1 * c1 * c1 + W2 * c2 * c2);
        }
        function choose(id, n, S0, S1, S2, Q) {
            var o = id * 3;
            pick[0] = own[o]; pick[1] = own[o + 1]; pick[2] = own[o + 2];
            if (!n || !mode[id]) return;
            var m0 = clamp(S0 / (2 * n), 0, 255), m1 = clamp(S1 / (2 * n), 0, 255), m2 = clamp(S2 / (2 * n), 0, 255);
            // A solid opaque shape keeps its exact colour unless the picture over
            // it is clearly something else (detail dropped on top of it, say).
            if (mode[id] === 1 && errOf(n, S0, S1, S2, Q, pick[0], pick[1], pick[2])
                <= errOf(n, S0, S1, S2, Q, m0, m1, m2) * 1.25 + n * 8) return;
            pick[0] = m0; pick[1] = m1; pick[2] = m2;
        }
        function pixErr(q, o) {
            if (o < 0) return Eb[q];
            var c0 = col[o * 3], c1 = col[o * 3 + 1], c2 = col[o * 3 + 2];
            return Qp[q] - 2 * (W0 * c0 * Sp[q * 3] + W1 * c1 * Sp[q * 3 + 1] + W2 * c2 * Sp[q * 3 + 2])
                + 2 * (W0 * c0 * c0 + W1 * c1 * c1 + W2 * c2 * c2);
        }
        // Scratch for gain(): what each current owner would lose to the candidate.
        var tMark = new Int32Array(2 * C), tN = new Int32Array(2 * C), tS = new Float64Array(6 * C), tQ = new Float64Array(2 * C);
        var touched = [], gainSerial = 0;
        /**
         * How much the error drops if `c` joins: on the pixels it would own, and on
         * what the shapes it covers keep — those re-pick their colour for the part
         * still showing. Without that second term an outline chosen first (and
         * coloured as the average of outline + body) makes the body look useless,
         * when adding it is what lets the outline go back to its own colour.
         */
        function gain(c) {
            var total = 0;
            gainSerial++;
            touched.length = 0;
            for (var part = 1; part >= 0; part--) {
                var off = part ? masks.sOff[c] : masks.fOff[c], end = off + (part ? masks.sLen[c] : masks.fLen[c]);
                var n = 0, S0 = 0, S1 = 0, S2 = 0, Q = 0, before = 0;
                for (var j = off; j < end; j++) {
                    var q = pool[j], o = top[q];
                    if (o >= 0) {
                        if ((o >> 1) > c) continue;   // a chosen shape above already owns it
                        if (tMark[o] !== gainSerial) {
                            tMark[o] = gainSerial; touched.push(o);
                            tN[o] = 0; tQ[o] = 0; tS[o * 3] = tS[o * 3 + 1] = tS[o * 3 + 2] = 0;
                        }
                        tN[o]++; tQ[o] += Qp[q];
                        tS[o * 3] += Sp[q * 3]; tS[o * 3 + 1] += Sp[q * 3 + 1]; tS[o * 3 + 2] += Sp[q * 3 + 2];
                    }
                    before += pixErr(q, o);
                    n++; S0 += Sp[q * 3]; S1 += Sp[q * 3 + 1]; S2 += Sp[q * 3 + 2]; Q += Qp[q];
                }
                if (!n) continue;
                choose(c * 2 + part, n, S0, S1, S2, Q);
                total += before - errOf(n, S0, S1, S2, Q, pick[0], pick[1], pick[2]);
            }
            for (var t = 0; t < touched.length; t++) {
                var ow = touched[t], rn = pn[ow] - tN[ow];
                if (rn <= 0) continue;
                var r0 = pS[ow * 3] - tS[ow * 3], r1 = pS[ow * 3 + 1] - tS[ow * 3 + 1], r2 = pS[ow * 3 + 2] - tS[ow * 3 + 2];
                var rQ = pQ[ow] - tQ[ow];
                var now = errOf(rn, r0, r1, r2, rQ, col[ow * 3], col[ow * 3 + 1], col[ow * 3 + 2]);
                choose(ow, rn, r0, r1, r2, rQ);
                total += now - errOf(rn, r0, r1, r2, rQ, pick[0], pick[1], pick[2]);
            }
            return total;
        }
        function recolour(id) {
            choose(id, pn[id], pS[id * 3], pS[id * 3 + 1], pS[id * 3 + 2], pQ[id]);
            col[id * 3] = pick[0]; col[id * 3 + 1] = pick[1]; col[id * 3 + 2] = pick[2];
        }

        var kept = new Uint8Array(C), keptCount = 0, serial = 0;
        function accept(c) {
            kept[c] = 1; keptCount++; serial++;
            var dirty = [];
            for (var part = 1; part >= 0; part--) {
                var id = c * 2 + part;
                var off = part ? masks.sOff[c] : masks.fOff[c], end = off + (part ? masks.sLen[c] : masks.fLen[c]);
                for (var j = off; j < end; j++) {
                    var q = pool[j], o = top[q];
                    if (o >= 0) {
                        if ((o >> 1) > c) continue;
                        pn[o]--; pQ[o] -= Qp[q];
                        pS[o * 3] -= Sp[q * 3]; pS[o * 3 + 1] -= Sp[q * 3 + 1]; pS[o * 3 + 2] -= Sp[q * 3 + 2];
                        if (dirtyMark[o] !== serial) { dirtyMark[o] = serial; dirty.push(o); }
                    }
                    top[q] = id; pn[id]++; pQ[id] += Qp[q];
                    pS[id * 3] += Sp[q * 3]; pS[id * 3 + 1] += Sp[q * 3 + 1]; pS[id * 3 + 2] += Sp[q * 3 + 2];
                }
                recolour(id);
            }
            for (var d = 0; d < dirty.length; d++) {
                var od = dirty[d];
                if (!pn[od]) { pQ[od] = 0; pS[od * 3] = pS[od * 3 + 1] = pS[od * 3 + 2] = 0; }
                recolour(od);
                // Buried completely by what came after: it no longer shows, so it
                // gives its slot back.
                var oc = od >> 1;
                if (!keepAll && kept[oc] && !pn[oc * 2] && !pn[oc * 2 + 1]) { kept[oc] = 0; keptCount--; }
            }
        }

        /**
         * The reverse of gain(): how much the error drops if kept shape `c` goes,
         * its pixels falling to whatever kept shape is under each of them
         * (`under`, from layerBelow()), which re-pick their colour for them.
         */
        function removalGain(c, under) {
            var change = 0;
            gainSerial++;
            touched.length = 0;
            for (var part = 0; part < 2; part++) {
                var id = c * 2 + part;
                var off = part ? masks.sOff[c] : masks.fOff[c], end = off + (part ? masks.sLen[c] : masks.fLen[c]);
                for (var j = off; j < end; j++) {
                    var q = pool[j];
                    if (top[q] !== id) continue;
                    change += pixErr(q, id);
                    var o = under[q];
                    if (o < 0) { change -= Eb[q]; continue; }
                    if (tMark[o] !== gainSerial) {
                        tMark[o] = gainSerial; touched.push(o);
                        tN[o] = 0; tQ[o] = 0; tS[o * 3] = tS[o * 3 + 1] = tS[o * 3 + 2] = 0;
                    }
                    tN[o]++; tQ[o] += Qp[q];
                    tS[o * 3] += Sp[q * 3]; tS[o * 3 + 1] += Sp[q * 3 + 1]; tS[o * 3 + 2] += Sp[q * 3 + 2];
                }
            }
            for (var t = 0; t < touched.length; t++) {
                var ow = touched[t], rn = pn[ow] + tN[ow];
                var r0 = pS[ow * 3] + tS[ow * 3], r1 = pS[ow * 3 + 1] + tS[ow * 3 + 1], r2 = pS[ow * 3 + 2] + tS[ow * 3 + 2];
                var rQ = pQ[ow] + tQ[ow];
                change += errOf(pn[ow], pS[ow * 3], pS[ow * 3 + 1], pS[ow * 3 + 2], pQ[ow], col[ow * 3], col[ow * 3 + 1], col[ow * 3 + 2]);
                choose(ow, rn, r0, r1, r2, rQ);
                change -= errOf(rn, r0, r1, r2, rQ, pick[0], pick[1], pick[2]);
            }
            return change;
        }
        /** For every pixel, the kept part directly beneath its top one (or -1). */
        function layerBelow() {
            var stackTop = new Int32Array(P).fill(-1), under = new Int32Array(P).fill(-1);
            for (var c = 0; c < C; c++) {
                if (!kept[c]) continue;
                for (var part = 0; part < 2; part++) {
                    var id = c * 2 + part;
                    var off = part ? masks.sOff[c] : masks.fOff[c], end = off + (part ? masks.sLen[c] : masks.fLen[c]);
                    for (var j = off; j < end; j++) { var q = pool[j]; under[q] = stackTop[q]; stackTop[q] = id; }
                }
            }
            return under;
        }
        function remove(c, under) {
            kept[c] = 0; keptCount--; serial++;
            var dirty = [];
            for (var part = 0; part < 2; part++) {
                var id = c * 2 + part;
                var off = part ? masks.sOff[c] : masks.fOff[c], end = off + (part ? masks.sLen[c] : masks.fLen[c]);
                for (var j = off; j < end; j++) {
                    var q = pool[j];
                    if (top[q] !== id) continue;
                    var o = under[q];
                    top[q] = o;
                    if (o < 0) continue;
                    pn[o]++; pQ[o] += Qp[q];
                    pS[o * 3] += Sp[q * 3]; pS[o * 3 + 1] += Sp[q * 3 + 1]; pS[o * 3 + 2] += Sp[q * 3 + 2];
                    if (dirtyMark[o] !== serial) { dirtyMark[o] = serial; dirty.push(o); }
                }
                pn[id] = 0; pQ[id] = 0; pS[id * 3] = pS[id * 3 + 1] = pS[id * 3 + 2] = 0;
                recolour(id);
            }
            for (var d = 0; d < dirty.length; d++) recolour(dirty[d]);
        }

        var exhausted = false;
        if (keepAll) {
            for (var a = 0; a < C; a++) accept(a);
        } else {
            var EPS = 64;   // a sliver of one pixel; below this a shape changes nothing you could see
            // A traced backdrop shape is ranked at a discount: in the pixel model
            // it fits as well as the SVG's own shape for the same spot, but it is
            // a blockier outline, so where the two are close the SVG's shape wins.
            var rank = function (c) { var g = gain(c); return cands[c].backdrop && g > 0 ? g * 0.8 : g; };
            var fill = function () {
                var heap = new Heap(), parked = [];
                for (var b = 0; b < C; b++) {
                    if (kept[b] || (!masks.fLen[b] && !masks.sLen[b])) continue;
                    var g0 = rank(b);
                    if (g0 > EPS) heap.push(-g0, b);
                    else parked.push(b);
                }
                // A shape that helps nothing now can start to once others are in
                // (it may be what lets them keep their own colours), so a useless
                // one is parked, not discarded, and the parked ones get another
                // look whenever the heap runs dry with slots left.
                for (;;) {
                    var acceptedNow = 0;
                    while (keptCount < budget && heap.size()) {
                        heap.pop();
                        var c = heap.topVal, g1 = rank(c);
                        if (g1 <= EPS) { parked.push(c); continue; }
                        if (heap.size() && g1 < -heap.k[0]) { heap.push(-g1, c); continue; }
                        accept(c);
                        acceptedNow++;
                    }
                    if (keptCount >= budget || !acceptedNow || !parked.length) break;
                    var again = parked;
                    parked = [];
                    for (var pi = 0; pi < again.length; pi++) {
                        if (kept[again[pi]]) continue;
                        var g2 = rank(again[pi]);
                        if (g2 > EPS) heap.push(-g2, again[pi]);
                        else parked.push(again[pi]);
                    }
                    if (!heap.size()) break;
                }
            };
            // Greedy only adds, so a shape that earned its place early (a big
            // region, before the detail on top took most of it) can end up doing
            // more harm than good. Take those back out, best riddance first, and
            // refill the slots they free.
            var prune = function () {
                var removed = 0;
                for (;;) {
                    var under = layerBelow(), worst = -1, worstGain = EPS;
                    for (var c = 0; c < C; c++) {
                        if (!kept[c]) continue;
                        var rg = removalGain(c, under);
                        if (rg > worstGain) { worstGain = rg; worst = c; }
                    }
                    if (worst < 0) return removed;
                    remove(worst, under);
                    removed++;
                }
            };
            for (var round = 0; round < 4; round++) {
                fill();
                if (!prune()) break;
            }
            exhausted = keptCount < budget;
        }

        var out = [], recoloured = 0;
        for (var e = 0; e < C; e++) {
            if (!kept[e]) continue;
            var sh = cands[e], moved = false;
            if (sh.fill && sh.t !== 'line') {
                var nf = '#' + hex2(col[e * 6]) + hex2(col[e * 6 + 1]) + hex2(col[e * 6 + 2]);
                moved = colourMoved(sh.fill, nf);
                sh.fill = nf;
            }
            if (sh.stroke) {
                var ns = '#' + hex2(col[e * 6 + 3]) + hex2(col[e * 6 + 4]) + hex2(col[e * 6 + 5]);
                moved = colourMoved(sh.stroke, ns) || moved;
                sh.stroke = ns;
            }
            if (moved && !sh.backdrop) recoloured++;
            out.push(sh);
        }
        return { shapes: out, recoloured: recoloured, exhausted: exhausted };
    }

    function colourMoved(a, b) {
        var x = hexRgb(a), y = hexRgb(b);
        if (!x || !y) return a !== b;
        return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2])) > 12;
    }

    /**
     * Convert SVG source into skin shapes + command text.
     *
     * options:
     *   maxShapes  shape budget (default/max 128)
     *   size       fit the drawing into a size×size box, centred on the origin
     *              (default 50 = the flower body's diameter)
     *   fit        'content' (default, uses the drawn bbox) or 'viewbox'
     *   precision  decimals in the output (default 1)
     *   minWeight  drop shapes smaller than this fraction of the largest (default 0)
     *   holeFill   paint cut-outs this colour instead of dropping them
     *   recolor    false keeps every shape's own colour (default true: shapes take
     *              the colour they show — transparency, gradients, dropped detail)
     *   fillGaps   false keeps to the SVG's own shapes (default true: when shapes
     *              must be dropped, shapes traced from the picture may go beneath
     *              the drawing to cover the holes they leave)
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
            recolor: options.recolor !== false,
            fillGaps: options.fillGaps !== false,
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

        // The root viewport: what percentages resolve against and what a browser
        // clips the drawing to. Unknown when the root has neither a viewBox nor
        // absolute width and height.
        conv.viewBox = { x0: 0, y0: 0, w: 0, h: 0 };
        var rootVb = (svgNode.attrs.viewbox || '').trim().split(/[\s,]+/).map(parseFloat);
        var viewport = null;
        if (rootVb.length === 4 && rootVb.every(function (v) { return isFinite(v); }) && rootVb[2] > 0 && rootVb[3] > 0) {
            viewport = { x0: rootVb[0], y0: rootVb[1], w: rootVb[2], h: rootVb[3] };
        } else {
            var vw = conv.len(svgNode.attrs.width, 0, 'x'), vh = conv.len(svgNode.attrs.height, 0, 'y');
            if (vw > 0 && vh > 0) viewport = { x0: 0, y0: 0, w: vw, h: vh };
        }
        if (viewport) {
            conv.viewBox = viewport;
            conv.flatTol = Math.hypot(viewport.w, viewport.h) * 0.0005;
        }

        var baseStyle = {
            fill: '#000000', stroke: null, strokeWidth: 1, fillGrad: null, strokeGrad: null, fillRule: 'nonzero',
            opacity: 1, fillOpacity: 1, strokeOpacity: 1, display: 'inline', visibility: 'visible',
        };
        conv.walk(svgNode, IDENTITY, baseStyle, 0);

        var raw = conv.shapes;
        if (!raw.length) {
            for (var u in conv.unsupported) warnings.push(conv.unsupported[u] + '× ' + u);
            return { shapes: [], commands: '', warnings: warnings.concat(['Nothing drawable found in this SVG.']), stats: null };
        }

        // ── fit: the whole drawing (as clipped by its viewport) into the box ──
        var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (var i = 0; i < raw.length; i++) {
            var rb = bboxOfPoints(shapeBBoxPoints(raw[i]));
            if (rb.x0 < box.x0) box.x0 = rb.x0;
            if (rb.y0 < box.y0) box.y0 = rb.y0;
            if (rb.x1 > box.x1) box.x1 = rb.x1;
            if (rb.y1 > box.y1) box.y1 = rb.y1;
        }
        if (viewport) {
            var ix0 = Math.max(box.x0, viewport.x0), iy0 = Math.max(box.y0, viewport.y0);
            var ix1 = Math.min(box.x1, viewport.x0 + viewport.w), iy1 = Math.min(box.y1, viewport.y0 + viewport.h);
            if (ix1 > ix0 && iy1 > iy0) box = { x0: ix0, y0: iy0, x1: ix1, y1: iy1 };
        }
        box.w = box.x1 - box.x0; box.h = box.y1 - box.y0;
        if (opt.fit === 'viewbox') {
            if (viewport && rootVb.length === 4) {
                box = { x0: viewport.x0, y0: viewport.y0, x1: viewport.x0 + viewport.w, y1: viewport.y0 + viewport.h,
                    w: viewport.w, h: viewport.h };
            } else warnings.push('No usable viewBox — fitted to the drawing bounds instead.');
        }
        var k = Math.min(opt.size / (box.w || 1), opt.size / (box.h || 1));
        if (!isFinite(k) || k <= 0) k = 1;
        var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
        var clipRect = viewport ? {
            x0: (viewport.x0 - cx) * k, y0: (viewport.y0 - cy) * k,
            x1: (viewport.x0 + viewport.w - cx) * k, y1: (viewport.y0 + viewport.h - cy) * k,
        } : null;

        // ── candidates in skin space, already within the format's point cap ──
        var cands = [], clippedAway = 0, maxW = 0;
        for (var r = 0; r < raw.length; r++) {
            var s = scaleShape(raw[r], k, cx, cy);
            if (s.t === 'polygon' && s.points.length > LIMITS.MAX_POLY_POINTS) {
                s.points = simplifyOutline(s.points, LIMITS.MAX_POLY_POINTS, opt.size / 256);
                s.simplified = true;
            }
            if (s.t === 'polygon' && s.points.length < 3) continue;
            if (clipRect) {
                s = clipShape(s, clipRect);
                if (!s) { clippedAway++; continue; }
            }
            s._w = shapeWeight(s);
            if (s._w > maxW) maxW = s._w;
            cands.push(s);
        }
        var droppedSmall = 0;
        if (opt.minWeight > 0) {
            var before = cands.length;
            cands = cands.filter(function (c) { return c._w >= maxW * opt.minWeight; });
            droppedSmall = before - cands.length;
        }

        // ── choose what to keep, and in what colours ──
        var kept = cands, recoloured = 0, exhausted = false;
        var overBudget = cands.length > opt.maxShapes;
        var needsColour = opt.recolor && cands.some(function (c) {
            return (c.fill && (c.fg || c.fa < 0.99) && !c.fixed) || (c.stroke && (c.sg || c.sa < 0.99));
        });
        if (cands.length && (overBudget || needsColour)) {
            var fr = { n: 128, ss: 3, size: opt.size, k: k, cx: cx, cy: cy, clip: clipRect };
            var pic = renderPicture(conv.draws, fr);
            var masks = buildMasks(cands, fr), pool = cands;
            if (overBudget) {
                // Paint order for selection: source shapes that barely show in
                // the original (a background everything else covers) first, then
                // the backdrop traced from the picture, then the rest of the SVG
                // — so a buried background can't hide the backdrop. A shape that
                // paints no pixel can't be chosen and is left out altogether.
                var backdrop = opt.fillGaps ? backdropShapes(pic, fr) : [];
                var bdMasks = backdrop.length ? buildMasks(backdrop, fr) : null;
                var buried = buriedShapes(masks, cands.length, pic.n);
                var order = [], ci;
                var paints = function (m, i) { return m.fLen[i] || m.sLen[i]; };
                for (ci = 0; ci < cands.length; ci++) if (buried[ci] && paints(masks, ci)) order.push([0, ci]);
                for (ci = 0; ci < backdrop.length; ci++) if (paints(bdMasks, ci)) order.push([1, ci]);
                for (ci = 0; ci < cands.length; ci++) if (!buried[ci] && paints(masks, ci)) order.push([0, ci]);
                masks = joinMasks(bdMasks ? [masks, bdMasks] : [masks], order);
                pool = order.map(function (o) { return o[0] ? backdrop[o[1]] : cands[o[1]]; });
            }
            var sel = selectShapes(pool, masks, pic, opt.maxShapes, !overBudget, opt.recolor);
            kept = sel.shapes; recoloured = sel.recoloured; exhausted = sel.exhausted;
        }

        var filled = kept.filter(function (c) { return c.backdrop; }).length;
        var dropped = cands.length - (kept.length - filled);
        if (dropped > 0) {
            warnings.push('Dropped ' + dropped + ' of ' + cands.length + ' shapes'
                + (exhausted ? ' — the rest add nothing visible at skin size.'
                    : ' to fit the ' + opt.maxShapes + '-shape limit, keeping the ones that matter most to how it looks.'));
        }
        if (filled) {
            warnings.push('Added ' + filled + ' shape' + (filled > 1 ? 's' : '') + ' traced from the picture beneath the drawing'
                + ' to cover holes the dropped shapes left (not in the SVG; turn off with "fill gaps").');
        }
        if (droppedSmall) warnings.push('Dropped ' + droppedSmall + ' shapes under the minimum size.');
        if (clippedAway) warnings.push('Dropped ' + clippedAway + ' shapes that lie outside the viewBox.');
        if (recoloured) {
            warnings.push('Recoloured ' + recoloured + ' shape' + (recoloured > 1 ? 's' : '')
                + ' to the colour they show (transparency, gradients, or detail dropped on top).');
        }
        var simplified = kept.filter(function (c) { return c.simplified; }).length;
        if (simplified) {
            warnings.push('Simplified ' + simplified + ' outline' + (simplified > 1 ? 's' : '')
                + ' to the ' + LIMITS.MAX_POLY_POINTS + '-point polygon limit — fine detail is lost.');
        }
        if (conv.holes) {
            warnings.push('Dropped ' + conv.holes + ' cut-out' + (conv.holes > 1 ? 's' : '')
                + ' (holes/donuts): the skin format cannot subtract shapes. Set a hole colour to paint them instead.');
        }

        var out = [];
        for (var f = 0; f < kept.length; f++) out.push(finalizeShape(kept[f], opt.precision));

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
            else if (arg === '--keep-colors') o.recolor = false;
            else if (arg === '--no-fill-gaps') o.fillGaps = false;
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
            '      --max-shapes <n> shape budget, 1-128 (default 128)',
            '      --size <n>       fit the art into an n×n box (default 50 = body diameter)',
            '      --fit <mode>     content (default) | viewbox',
            '      --precision <n>  decimals, 0-3 (default 1)',
            '      --min-weight <f> drop shapes under this fraction of the biggest (e.g. 0.01)',
            '      --hole-fill <c>  paint cut-outs/holes this colour instead of dropping them',
            '      --no-fill-gaps   only the SVG\'s own shapes (default: shapes traced from the',
            '                       picture may sit beneath to cover holes dropped shapes leave)',
            '      --keep-colors    keep every shape\'s own colour (default: shapes take the',
            '                       colour they show — transparency, gradients, dropped detail)',
            '      --json           emit a { name, shapes } payload instead of command lines',
            '      --name <name>    skin name for --json',
            '  -q, --quiet          no stats/warnings on stderr',
            '',
            'Browser version: open SvgToSkin.html for drag-and-drop with a live preview.',
        ].join('\n'));
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
