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

export const MAX_SKIN_SHAPES = 24;
export const MAX_SKIN_NAME_LEN = 24;
export const MAX_POLY_POINTS = 16;
export const SKIN_COORD_LIMIT = 64;   // local-space coordinate bound (flower body radius ~25)
export const SKIN_RADIUS_LIMIT = 64;
export const MAX_STROKE_WIDTH = 14;
export const MAX_SKINS_PER_USER = 24;

export type SkinShapeType = 'circle' | 'ellipse' | 'rect' | 'polygon' | 'line' | 'curve';

export interface SkinShape {
    t: SkinShapeType;
    x: number;             // anchor X in player-local space
    y: number;             // anchor Y
    r?: number;            // circle radius
    rx?: number;           // ellipse / rect half-width
    ry?: number;           // ellipse / rect half-height
    x2?: number;           // line / curve endpoint X
    y2?: number;           // line / curve endpoint Y
    cx1?: number;          // curve: first control point X (absolute local space)
    cy1?: number;          // curve: first control point Y
    cx2?: number;          // curve: second control point X
    cy2?: number;          // curve: second control point Y
    points?: number[];     // polygon: flat [x0,y0,x1,y1,...] in local space
    rot?: number;          // rotation in degrees (ellipse / rect / polygon)
    fill?: string;         // '#rrggbb' or '' for no fill
    stroke?: string;       // '#rrggbb' or '' for no stroke
    sw?: number;           // stroke width
}

export interface CustomSkin {
    id: string;            // server-assigned unique id
    name: string;          // sanitized display name
    author: string;        // owner username
    shapes: SkinShape[];
    createdAt: number;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clampNum(v: any, lo: number, hi: number, dflt: number): number {
    const n = typeof v === 'number' && isFinite(v) ? v : dflt;
    return n < lo ? lo : n > hi ? hi : n;
}

function sanColor(v: any): string {
    return typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : '';
}

const SHAPE_TYPES: SkinShapeType[] = ['circle', 'ellipse', 'rect', 'polygon', 'line', 'curve'];

/** Sanitize one shape from untrusted input, or return null if unusable. */
export function sanitizeShape(raw: any): SkinShape | null {
    if (!raw || typeof raw !== 'object') return null;
    const t = raw.t;
    if (SHAPE_TYPES.indexOf(t) === -1) return null;

    const s: SkinShape = {
        t,
        x: clampNum(raw.x, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, 0),
        y: clampNum(raw.y, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, 0),
        rot: clampNum(raw.rot, -360, 360, 0),
        fill: sanColor(raw.fill),
        stroke: sanColor(raw.stroke),
        sw: clampNum(raw.sw, 0, MAX_STROKE_WIDTH, 1),
    };

    if (t === 'circle') {
        s.r = clampNum(raw.r, 0.5, SKIN_RADIUS_LIMIT, 8);
    } else if (t === 'ellipse' || t === 'rect') {
        s.rx = clampNum(raw.rx, 0.5, SKIN_RADIUS_LIMIT, 8);
        s.ry = clampNum(raw.ry, 0.5, SKIN_RADIUS_LIMIT, 8);
    } else if (t === 'line') {
        s.x2 = clampNum(raw.x2, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, 0);
        s.y2 = clampNum(raw.y2, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, 0);
        if (!s.stroke) s.stroke = '#000000';
        if (!s.sw) s.sw = 2;
    } else if (t === 'curve') {
        // Cubic bezier: (x,y) → (x2,y2) bent by two control points. Every point
        // is absolute local space, like the line endpoint.
        s.x2 = clampNum(raw.x2, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, 0);
        s.y2 = clampNum(raw.y2, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, 0);
        s.cx1 = clampNum(raw.cx1, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, s.x);
        s.cy1 = clampNum(raw.cy1, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, s.y);
        s.cx2 = clampNum(raw.cx2, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, s.x2);
        s.cy2 = clampNum(raw.cy2, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, s.y2);
        // An unfilled curve is a stroked arc; only default the stroke when there
        // is no fill either, so a filled blob stays outline-free.
        if (!s.stroke && !s.fill) { s.stroke = '#000000'; if (!s.sw) s.sw = 2; }
    } else if (t === 'polygon') {
        const pts = Array.isArray(raw.points) ? raw.points : [];
        const out: number[] = [];
        for (let i = 0; i + 1 < pts.length && out.length < MAX_POLY_POINTS * 2; i += 2) {
            out.push(clampNum(pts[i], -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, 0));
            out.push(clampNum(pts[i + 1], -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT, 0));
        }
        if (out.length < 6) return null; // need at least 3 points
        s.points = out;
    }

    // A shape with neither fill nor stroke would be invisible — give it a fill.
    if (!s.fill && !s.stroke) s.fill = '#000000';
    return s;
}

/** Collapse a name to a safe, length-limited display string. */
export function sanitizeSkinName(raw: any): string {
    const name = (typeof raw === 'string' ? raw : '')
        .replace(/[^\w \-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SKIN_NAME_LEN);
    return name;
}

/**
 * Validate + sanitize an authored skin payload. Returns { name, shapes } on
 * success or { error } describing the first problem. Does not assign an id.
 */
export function sanitizeSkin(raw: any): { name: string; shapes: SkinShape[] } | { error: string } {
    const name = sanitizeSkinName(raw?.name);
    if (!name) return { error: 'Skin needs a name.' };

    const rawShapes = raw?.shapes;
    if (!Array.isArray(rawShapes) || rawShapes.length === 0) return { error: 'Skin needs at least one shape.' };

    const shapes: SkinShape[] = [];
    for (const rs of rawShapes.slice(0, MAX_SKIN_SHAPES)) {
        const s = sanitizeShape(rs);
        if (s) shapes.push(s);
    }
    if (shapes.length === 0) return { error: 'No valid shapes in skin.' };

    return { name, shapes };
}
