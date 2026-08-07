"use strict";
// Shared, dependency-free skin data model.
//
// User-created skins are DATA, not code: a skin is a small list of drawing
// primitives that the client renders with plain canvas calls. Nothing here
// touches the DOM or the canvas, so the server imports the same validator the
// client trusts. Because a published skin is rendered on EVERY player's screen,
// the server must sanitize untrusted input through sanitizeSkin() before storing
// it — clamping every number, whitelisting shape types, and accepting colors
// only as #rrggbb hex. The renderer never interprets skin strings as anything
// other than canvas fill/stroke styles.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SKINS_PER_USER = exports.MAX_STROKE_WIDTH = exports.SKIN_RADIUS_LIMIT = exports.SKIN_COORD_LIMIT = exports.MAX_POLY_POINTS = exports.MAX_SKIN_NAME_LEN = exports.MAX_SKIN_SHAPES = void 0;
exports.sanitizeShape = sanitizeShape;
exports.sanitizeSkinName = sanitizeSkinName;
exports.sanitizeSkin = sanitizeSkin;
exports.MAX_SKIN_SHAPES = 24;
exports.MAX_SKIN_NAME_LEN = 24;
exports.MAX_POLY_POINTS = 16;
exports.SKIN_COORD_LIMIT = 64; // local-space coordinate bound (flower body radius ~25)
exports.SKIN_RADIUS_LIMIT = 64;
exports.MAX_STROKE_WIDTH = 14;
exports.MAX_SKINS_PER_USER = 24;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function clampNum(v, lo, hi, dflt) {
    const n = typeof v === 'number' && isFinite(v) ? v : dflt;
    return n < lo ? lo : n > hi ? hi : n;
}
function sanColor(v) {
    return typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : '';
}
const SHAPE_TYPES = ['circle', 'ellipse', 'rect', 'polygon', 'line', 'curve'];
/** Sanitize one shape from untrusted input, or return null if unusable. */
function sanitizeShape(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const t = raw.t;
    if (SHAPE_TYPES.indexOf(t) === -1)
        return null;
    const s = {
        t,
        x: clampNum(raw.x, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, 0),
        y: clampNum(raw.y, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, 0),
        rot: clampNum(raw.rot, -360, 360, 0),
        fill: sanColor(raw.fill),
        stroke: sanColor(raw.stroke),
        sw: clampNum(raw.sw, 0, exports.MAX_STROKE_WIDTH, 1),
    };
    if (t === 'circle') {
        s.r = clampNum(raw.r, 0.5, exports.SKIN_RADIUS_LIMIT, 8);
    }
    else if (t === 'ellipse' || t === 'rect') {
        s.rx = clampNum(raw.rx, 0.5, exports.SKIN_RADIUS_LIMIT, 8);
        s.ry = clampNum(raw.ry, 0.5, exports.SKIN_RADIUS_LIMIT, 8);
    }
    else if (t === 'line') {
        s.x2 = clampNum(raw.x2, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, 0);
        s.y2 = clampNum(raw.y2, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, 0);
        if (!s.stroke)
            s.stroke = '#000000';
        if (!s.sw)
            s.sw = 2;
    }
    else if (t === 'curve') {
        // Cubic bezier: (x,y) → (x2,y2) bent by two control points. Every point
        // is absolute local space, like the line endpoint.
        s.x2 = clampNum(raw.x2, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, 0);
        s.y2 = clampNum(raw.y2, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, 0);
        s.cx1 = clampNum(raw.cx1, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, s.x);
        s.cy1 = clampNum(raw.cy1, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, s.y);
        s.cx2 = clampNum(raw.cx2, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, s.x2);
        s.cy2 = clampNum(raw.cy2, -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, s.y2);
        // An unfilled curve is a stroked arc; only default the stroke when there
        // is no fill either, so a filled blob stays outline-free.
        if (!s.stroke && !s.fill) {
            s.stroke = '#000000';
            if (!s.sw)
                s.sw = 2;
        }
    }
    else if (t === 'polygon') {
        const pts = Array.isArray(raw.points) ? raw.points : [];
        const out = [];
        for (let i = 0; i + 1 < pts.length && out.length < exports.MAX_POLY_POINTS * 2; i += 2) {
            out.push(clampNum(pts[i], -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, 0));
            out.push(clampNum(pts[i + 1], -exports.SKIN_COORD_LIMIT, exports.SKIN_COORD_LIMIT, 0));
        }
        if (out.length < 6)
            return null; // need at least 3 points
        s.points = out;
    }
    // A shape with neither fill nor stroke would be invisible — give it a fill.
    if (!s.fill && !s.stroke)
        s.fill = '#000000';
    return s;
}
/** Collapse a name to a safe, length-limited display string. */
function sanitizeSkinName(raw) {
    const name = (typeof raw === 'string' ? raw : '')
        .replace(/[^\w \-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, exports.MAX_SKIN_NAME_LEN);
    return name;
}
/**
 * Validate + sanitize an authored skin payload. Returns { name, shapes } on
 * success or { error } describing the first problem. Does not assign an id.
 */
function sanitizeSkin(raw) {
    const name = sanitizeSkinName(raw?.name);
    if (!name)
        return { error: 'Skin needs a name.' };
    const rawShapes = raw?.shapes;
    if (!Array.isArray(rawShapes) || rawShapes.length === 0)
        return { error: 'Skin needs at least one shape.' };
    const shapes = [];
    for (const rs of rawShapes.slice(0, exports.MAX_SKIN_SHAPES)) {
        const s = sanitizeShape(rs);
        if (s)
            shapes.push(s);
    }
    if (shapes.length === 0)
        return { error: 'No valid shapes in skin.' };
    return { name, shapes };
}
