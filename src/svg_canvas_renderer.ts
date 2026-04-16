/**
 * SVG-to-Canvas Command Compiler
 *
 * Parses SVG strings into a compiled intermediate representation (IR) that can be
 * efficiently drawn using HTML Canvas 2D commands, with real-time animation support.
 *
 * This replaces the old pixel-based approach (SVG → data URL → Image → canvas pixel cache)
 * with direct canvas drawing commands, eliminating the need to pre-render animation frames.
 */

// === Types ===

export interface ViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface StyleAttrs {
    fill: string | null;
    fillOpacity: number;
    fillRule: CanvasFillRule;
    stroke: string | null;
    strokeWidth: number;
    strokeLinecap: CanvasLineCap;
    strokeLinejoin: CanvasLineJoin;
    strokeOpacity: number;
    opacity: number;
}

export interface TransformAnimation {
    transformType: string;
    values: number[][];
    dur: number;
    begin: number;
    additive: boolean;
    keyTimes: number[] | null;
    calcMode: string;
    keySplines: number[][] | null;
}

export interface PathAnimation {
    keyframes: string[];
    keyframeNums: number[][];
    dur: number;
    begin: number;
    template: string;
    keyTimes: number[] | null;
    calcMode: string;
    keySplines: number[][] | null;
}

export interface CompiledNode {
    tag: string;
    style: StyleAttrs;
    transform: string | null;
    transformOrigin: [number, number] | null; // from style="transform-origin: Xpx Ypx"
    clipPathId: string | null;
    transformAnimations: TransformAnimation[];
    pathAnimations: PathAnimation[];
    children: CompiledNode[];
    // Shape data
    cx: number; cy: number; r: number;
    rx: number; ry: number;
    x: number; y: number; width: number; height: number;
    x1: number; y1: number; x2: number; y2: number;
    d: string;
    path2d: Path2D | null;
    // For <image> elements
    imageEl: HTMLImageElement | null;
    imageX: number; imageY: number; imageW: number; imageH: number;
}

export interface CompiledSVG {
    viewBox: ViewBox;
    children: CompiledNode[];
    clipPaths: Map<string, Path2D>;
}

// === Parsing Utilities ===

function num(s: string | null, def: number = 0): number {
    if (!s) return def;
    const n = parseFloat(s);
    return isNaN(n) ? def : n;
}

// SVG default inherited style
const ROOT_INHERITED_STYLE: StyleAttrs = {
    fill: '#000000',    // SVG default fill is black
    fillOpacity: 1,
    fillRule: 'nonzero',
    stroke: null,       // SVG default stroke is none
    strokeWidth: 1,
    strokeLinecap: 'butt',
    strokeLinejoin: 'miter',
    strokeOpacity: 1,
    opacity: 1,
};

/**
 * Parse style from element, inheriting unset attributes from parent.
 * In SVG, presentation attributes cascade: if a child doesn't set fill,
 * it inherits fill from its parent.
 */
function parseStyleWithInheritance(el: Element, inherited: StyleAttrs): StyleAttrs {
    const fillAttr = el.getAttribute('fill');
    const strokeAttr = el.getAttribute('stroke');

    return {
        fill: el.hasAttribute('fill')
            ? (fillAttr === 'none' ? null : fillAttr)
            : inherited.fill,
        fillOpacity: el.hasAttribute('fill-opacity')
            ? num(el.getAttribute('fill-opacity'), 1)
            : inherited.fillOpacity,
        fillRule: el.hasAttribute('fill-rule')
            ? (el.getAttribute('fill-rule') as CanvasFillRule) || 'nonzero'
            : inherited.fillRule,
        stroke: el.hasAttribute('stroke')
            ? (strokeAttr === 'none' ? null : strokeAttr)
            : inherited.stroke,
        strokeWidth: el.hasAttribute('stroke-width')
            ? num(el.getAttribute('stroke-width'), 1)
            : inherited.strokeWidth,
        strokeLinecap: el.hasAttribute('stroke-linecap')
            ? (el.getAttribute('stroke-linecap') as CanvasLineCap) || 'butt'
            : inherited.strokeLinecap,
        strokeLinejoin: el.hasAttribute('stroke-linejoin')
            ? (el.getAttribute('stroke-linejoin') as CanvasLineJoin) || 'miter'
            : inherited.strokeLinejoin,
        strokeOpacity: el.hasAttribute('stroke-opacity')
            ? num(el.getAttribute('stroke-opacity'), 1)
            : inherited.strokeOpacity,
        // opacity does NOT inherit in SVG — each element's opacity applies only to itself
        opacity: el.hasAttribute('opacity')
            ? num(el.getAttribute('opacity'), 1)
            : 1,
    };
}

function parseDuration(s: string): number {
    if (s.endsWith('ms')) return parseFloat(s);
    return parseFloat(s) * 1000;
}

function parseBegin(s: string | null): number {
    if (!s) return 0;
    if (s.endsWith('ms')) return parseFloat(s);
    return parseFloat(s) * 1000;
}

function parseTransformAnimations(el: Element): TransformAnimation[] {
    const anims: TransformAnimation[] = [];
    for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.tagName !== 'animateTransform') continue;

        const transformType = child.getAttribute('type') || 'rotate';

        let valStrs: string[];
        const valuesAttr = child.getAttribute('values');
        if (valuesAttr) {
            valStrs = valuesAttr.split(';').map((s: string) => s.trim()).filter(Boolean);
        } else {
            valStrs = [
                child.getAttribute('from') || '0',
                child.getAttribute('to') || '0'
            ];
        }
        const values = valStrs.map((s: string) => s.split(/[\s,]+/).map(Number));

        const dur = parseDuration(child.getAttribute('dur') || '1s');
        const begin = parseBegin(child.getAttribute('begin'));
        const additive = child.getAttribute('additive') === 'sum';
        const calcMode = child.getAttribute('calcMode') || 'linear';

        let keyTimes: number[] | null = null;
        const ktAttr = child.getAttribute('keyTimes');
        if (ktAttr) {
            keyTimes = ktAttr.split(';').map((s: string) => parseFloat(s.trim()));
        }

        let keySplines: number[][] | null = null;
        const ksAttr = child.getAttribute('keySplines');
        if (ksAttr) {
            keySplines = ksAttr.split(';').map((s: string) =>
                s.trim().split(/[\s,]+/).map(Number)
            );
        }

        anims.push({ transformType, values, dur, begin, additive, keyTimes, calcMode, keySplines });
    }
    return anims;
}

function parsePathAnimations(el: Element): PathAnimation[] {
    const anims: PathAnimation[] = [];
    for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.tagName !== 'animate') continue;
        if (child.getAttribute('attributeName') !== 'd') continue;

        const valuesAttr = child.getAttribute('values');
        if (!valuesAttr) continue;

        const keyframes = valuesAttr.split(';').map((s: string) => s.trim()).filter(Boolean);
        if (keyframes.length < 2) continue;

        const numRegex = /-?[\d.]+/g;
        const keyframeNums = keyframes.map((kf: string) => (kf.match(numRegex) || []).map(Number));

        let pathKeyTimes: number[] | null = null;
        const pathKtAttr = child.getAttribute('keyTimes');
        if (pathKtAttr) {
            pathKeyTimes = pathKtAttr.split(';').map((s: string) => parseFloat(s.trim()));
        }
        let pathKeySplines: number[][] | null = null;
        const pathKsAttr = child.getAttribute('keySplines');
        if (pathKsAttr) {
            pathKeySplines = pathKsAttr.split(';').map((s: string) =>
                s.trim().split(/[\s,]+/).map(Number)
            );
        }

        anims.push({
            keyframes,
            keyframeNums,
            dur: parseDuration(child.getAttribute('dur') || '1s'),
            begin: parseBegin(child.getAttribute('begin')),
            template: keyframes[0],
            keyTimes: pathKeyTimes,
            calcMode: child.getAttribute('calcMode') || 'linear',
            keySplines: pathKeySplines,
        });
    }
    return anims;
}

function polygonPointsToD(points: string): string {
    const nums = points.trim().split(/[\s,]+/).map(Number);
    let d = '';
    for (let i = 0; i < nums.length; i += 2) {
        d += (i === 0 ? 'M ' : 'L ') + nums[i] + ' ' + nums[i + 1] + ' ';
    }
    return d + 'Z';
}

function parseClipPathRef(attr: string | null): string | null {
    if (!attr) return null;
    const m = attr.match(/url\(#([^)]+)\)/);
    return m ? m[1] : null;
}

function buildClipPath2D(clipEl: Element): Path2D {
    const combined = new Path2D();
    for (let i = 0; i < clipEl.children.length; i++) {
        const child = clipEl.children[i];
        const tag = child.tagName.toLowerCase();
        switch (tag) {
            case 'circle': {
                const cx = num(child.getAttribute('cx'));
                const cy = num(child.getAttribute('cy'));
                const r = num(child.getAttribute('r'));
                const sub = new Path2D();
                sub.arc(cx, cy, r, 0, Math.PI * 2);
                combined.addPath(sub);
                break;
            }
            case 'ellipse': {
                const cx = num(child.getAttribute('cx'));
                const cy = num(child.getAttribute('cy'));
                const rx = num(child.getAttribute('rx'));
                const ry = num(child.getAttribute('ry'));
                const sub = new Path2D();
                sub.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                combined.addPath(sub);
                break;
            }
            case 'rect': {
                const x = num(child.getAttribute('x'));
                const y = num(child.getAttribute('y'));
                const w = num(child.getAttribute('width'));
                const h = num(child.getAttribute('height'));
                const sub = new Path2D();
                sub.rect(x, y, w, h);
                combined.addPath(sub);
                break;
            }
            case 'path': {
                const d = child.getAttribute('d');
                if (d) combined.addPath(new Path2D(d));
                break;
            }
            case 'polygon': {
                const pts = child.getAttribute('points');
                if (pts) combined.addPath(new Path2D(polygonPointsToD(pts)));
                break;
            }
        }
    }
    return combined;
}

// === Compiler ===

function parseTransformOrigin(el: Element): [number, number] | null {
    const styleAttr = el.getAttribute('style');
    if (!styleAttr) return null;
    const m = styleAttr.match(/transform-origin\s*:\s*([-\d.]+)(?:px)?\s+([-\d.]+)(?:px)?/);
    if (!m) return null;
    return [parseFloat(m[1]), parseFloat(m[2])];
}

function makeEmptyNode(tag: string, style: StyleAttrs): CompiledNode {
    return {
        tag, style, transform: null, transformOrigin: null, clipPathId: null,
        transformAnimations: [], pathAnimations: [], children: [],
        cx: 0, cy: 0, r: 0, rx: 0, ry: 0,
        x: 0, y: 0, width: 0, height: 0,
        x1: 0, y1: 0, x2: 0, y2: 0,
        d: '', path2d: null,
        imageEl: null, imageX: 0, imageY: 0, imageW: 0, imageH: 0,
    };
}

const SKIP_TAGS = new Set(['defs', 'clippath', 'animatetransform', 'animate', 'desc', 'title', 'metadata']);

/**
 * Compile a single DOM element into a CompiledNode.
 * @param el - The DOM element to compile
 * @param doc - The owning document (for resolving <use> references)
 * @param inherited - The inherited style from parent elements
 */
function compileElement(el: Element, doc: Document, inherited: StyleAttrs): CompiledNode | null {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;

    const style = parseStyleWithInheritance(el, inherited);
    const node = makeEmptyNode(tag, style);
    node.transform = el.getAttribute('transform');
    node.transformOrigin = parseTransformOrigin(el);
    node.clipPathId = parseClipPathRef(el.getAttribute('clip-path'));
    node.transformAnimations = parseTransformAnimations(el);

    switch (tag) {
        case 'g':
        case 'svg':
            node.children = compileChildren(el, doc, style);
            break;

        case 'circle':
            node.cx = num(el.getAttribute('cx'));
            node.cy = num(el.getAttribute('cy'));
            node.r = num(el.getAttribute('r'));
            if (node.r > 0) {
                node.path2d = new Path2D();
                node.path2d.arc(node.cx, node.cy, node.r, 0, Math.PI * 2);
            }
            break;

        case 'ellipse':
            node.cx = num(el.getAttribute('cx'));
            node.cy = num(el.getAttribute('cy'));
            node.rx = num(el.getAttribute('rx'));
            node.ry = num(el.getAttribute('ry'));
            if (node.rx > 0 && node.ry > 0) {
                node.path2d = new Path2D();
                node.path2d.ellipse(node.cx, node.cy, node.rx, node.ry, 0, 0, Math.PI * 2);
            }
            break;

        case 'rect':
            node.x = num(el.getAttribute('x'));
            node.y = num(el.getAttribute('y'));
            node.width = num(el.getAttribute('width'));
            node.height = num(el.getAttribute('height'));
            node.rx = num(el.getAttribute('rx'));
            node.ry = num(el.getAttribute('ry'));
            if (node.width > 0 && node.height > 0) {
                node.path2d = new Path2D();
                if (node.rx > 0 || node.ry > 0) {
                    node.path2d.roundRect(node.x, node.y, node.width, node.height, [node.rx || node.ry]);
                } else {
                    node.path2d.rect(node.x, node.y, node.width, node.height);
                }
            }
            break;

        case 'path': {
            node.d = el.getAttribute('d') || '';
            node.pathAnimations = parsePathAnimations(el);
            if (node.d && node.pathAnimations.length === 0) {
                try { node.path2d = new Path2D(node.d); } catch { node.path2d = null; }
            }
            break;
        }

        case 'polygon': {
            const pts = el.getAttribute('points') || '';
            if (pts) {
                try { node.path2d = new Path2D(polygonPointsToD(pts)); } catch { node.path2d = null; }
            }
            break;
        }

        case 'line':
            node.x1 = num(el.getAttribute('x1'));
            node.y1 = num(el.getAttribute('y1'));
            node.x2 = num(el.getAttribute('x2'));
            node.y2 = num(el.getAttribute('y2'));
            break;

        case 'image': {
            const imgHref = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (imgHref) {
                const img = new Image();
                img.src = imgHref;
                node.imageEl = img;
                node.imageX = num(el.getAttribute('x'));
                node.imageY = num(el.getAttribute('y'));
                node.imageW = num(el.getAttribute('width'));
                node.imageH = num(el.getAttribute('height'));
            }
            break;
        }

        case 'use': {
            // Resolve <use href="#id"> references
            const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (href && href.startsWith('#')) {
                const refId = href.substring(1);
                const refEl = doc.querySelector('[id="' + refId + '"]');
                if (refEl) {
                    // Compile the referenced element with current inherited style
                    const refNode = compileElement(refEl, doc, style);
                    if (refNode) {
                        // <use> becomes a group containing the referenced content
                        node.tag = 'g';
                        // Apply x/y offset from <use> element
                        const useX = num(el.getAttribute('x'));
                        const useY = num(el.getAttribute('y'));
                        if (useX !== 0 || useY !== 0) {
                            const existingTransform = node.transform || '';
                            node.transform = `translate(${useX}, ${useY})` + (existingTransform ? ' ' + existingTransform : '');
                        }
                        node.children = [refNode];
                    }
                }
            }
            break;
        }

        default:
            if (el.children.length > 0) {
                node.tag = 'g';
                node.children = compileChildren(el, doc, style);
            } else {
                return null;
            }
    }

    return node;
}

function compileChildren(parent: Element, doc: Document, inherited: StyleAttrs): CompiledNode[] {
    const nodes: CompiledNode[] = [];
    for (let i = 0; i < parent.children.length; i++) {
        const node = compileElement(parent.children[i], doc, inherited);
        if (node) nodes.push(node);
    }
    return nodes;
}

export class SVGCanvasCompiler {
    private cache = new Map<string, CompiledSVG>();

    compile(svgString: string): CompiledSVG {
        const cached = this.cache.get(svgString);
        if (cached) return cached;

        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl = doc.documentElement;

        // Parse viewBox
        const vbAttr = svgEl.getAttribute('viewBox');
        let viewBox: ViewBox;
        if (vbAttr) {
            const parts = vbAttr.split(/[\s,]+/).map(Number);
            viewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
        } else {
            const w = num(svgEl.getAttribute('width'), 32);
            const h = num(svgEl.getAttribute('height'), 32);
            viewBox = { x: 0, y: 0, w, h };
        }

        // Compile clip paths from anywhere in the SVG (not just <defs>)
        const clipPaths = new Map<string, Path2D>();
        const cpList = svgEl.querySelectorAll('clipPath');
        for (let i = 0; i < cpList.length; i++) {
            const id = cpList[i].getAttribute('id');
            if (id) {
                clipPaths.set(id, buildClipPath2D(cpList[i]));
            }
        }

        // Compile children with SVG default inherited style
        const children = compileChildren(svgEl, doc, ROOT_INHERITED_STYLE);

        const compiled: CompiledSVG = { viewBox, children, clipPaths };
        this.cache.set(svgString, compiled);
        return compiled;
    }

    clearCache(): void {
        this.cache.clear();
    }

    getCacheSize(): number {
        return this.cache.size;
    }
}

// === Animation Interpolation ===

function cubicBezierEase(t: number, p1x: number, p1y: number, p2x: number, p2y: number): number {
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        const x = 3 * p1x * (1 - mid) * (1 - mid) * mid
                + 3 * p2x * (1 - mid) * mid * mid
                + mid * mid * mid;
        if (x < t) lo = mid; else hi = mid;
    }
    const tt = (lo + hi) / 2;
    return 3 * p1y * (1 - tt) * (1 - tt) * tt
         + 3 * p2y * (1 - tt) * tt * tt
         + tt * tt * tt;
}

function interpolateTransformAnim(anim: TransformAnimation, time: number): number[] {
    const effectiveTime = time - anim.begin;
    const progress = (((effectiveTime % anim.dur) + anim.dur) % anim.dur) / anim.dur;

    const values = anim.values;
    const n = values.length;

    let kt: number[];
    if (anim.keyTimes && anim.keyTimes.length === n) {
        kt = anim.keyTimes;
    } else {
        kt = values.map((_, i) => i / (n - 1));
    }

    let seg = 0;
    for (let i = 0; i < n - 1; i++) {
        if (progress >= kt[i] && progress <= kt[i + 1]) { seg = i; break; }
    }

    const segStart = kt[seg];
    const segEnd = kt[seg + 1];
    let lp = segEnd > segStart ? (progress - segStart) / (segEnd - segStart) : 0;

    if (anim.calcMode === 'spline' && anim.keySplines && anim.keySplines[seg]) {
        const sp = anim.keySplines[seg];
        lp = cubicBezierEase(lp, sp[0], sp[1], sp[2], sp[3]);
    } else if (anim.calcMode === 'discrete') {
        lp = 0;
    }

    const from = values[seg];
    const to = values[seg + 1] || from;
    return from.map((v, i) => v + ((to[i] ?? v) - v) * lp);
}

function interpolatePathAnim(anim: PathAnimation, time: number): Path2D | null {
    const effectiveTime = time - anim.begin;
    const progress = (((effectiveTime % anim.dur) + anim.dur) % anim.dur) / anim.dur;

    const n = anim.keyframes.length;

    // Determine keyframe positions
    let kt: number[];
    if (anim.keyTimes && anim.keyTimes.length === n) {
        kt = anim.keyTimes;
    } else {
        kt = anim.keyframes.map((_, i) => i / (n - 1));
    }

    // Find active segment
    let seg = 0;
    for (let i = 0; i < n - 1; i++) {
        if (progress >= kt[i] && progress <= kt[i + 1]) { seg = i; break; }
    }

    const segStart = kt[seg];
    const segEnd = kt[seg + 1];
    let lp = segEnd > segStart ? (progress - segStart) / (segEnd - segStart) : 0;

    // Apply spline easing
    if (anim.calcMode === 'spline' && anim.keySplines && anim.keySplines[seg]) {
        const sp = anim.keySplines[seg];
        lp = cubicBezierEase(lp, sp[0], sp[1], sp[2], sp[3]);
    } else if (anim.calcMode === 'discrete') {
        lp = 0;
    }

    const idx = seg;
    const nums1 = anim.keyframeNums[idx];
    const nums2 = anim.keyframeNums[idx + 1];
    if (nums1.length !== nums2.length || nums1.length === 0) {
        try { return new Path2D(anim.keyframes[idx]); } catch { return null; }
    }

    const interpolated = nums1.map((v, i) => v + (nums2[i] - v) * lp);

    let numIdx = 0;
    const numRegex = /-?[\d.]+/g;
    const dValue = anim.template.replace(numRegex, () => {
        const val = interpolated[numIdx++];
        return val % 1 === 0 ? val.toString() : val.toFixed(2);
    });

    try { return new Path2D(dValue); } catch { return null; }
}

// === Canvas Drawing Engine ===

function applyTransform(ctx: CanvasRenderingContext2D, transform: string): void {
    const re = /(\w+)\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(transform)) !== null) {
        const type = m[1];
        const vals = m[2].split(/[\s,]+/).map(Number);
        switch (type) {
            case 'translate':
                ctx.translate(vals[0] || 0, vals[1] || 0);
                break;
            case 'rotate':
                if (vals.length >= 3) {
                    ctx.translate(vals[1], vals[2]);
                    ctx.rotate(vals[0] * Math.PI / 180);
                    ctx.translate(-vals[1], -vals[2]);
                } else {
                    ctx.rotate((vals[0] || 0) * Math.PI / 180);
                }
                break;
            case 'scale':
                ctx.scale(vals[0] || 1, vals[1] ?? vals[0] ?? 1);
                break;
            case 'matrix':
                ctx.transform(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5]);
                break;
            case 'skewX':
                ctx.transform(1, 0, Math.tan((vals[0] || 0) * Math.PI / 180), 1, 0, 0);
                break;
            case 'skewY':
                ctx.transform(1, Math.tan((vals[0] || 0) * Math.PI / 180), 0, 1, 0, 0);
                break;
        }
    }
}

function applyAnimatedTransforms(ctx: CanvasRenderingContext2D, anims: TransformAnimation[], time: number): void {
    for (const anim of anims) {
        const vals = interpolateTransformAnim(anim, time);
        switch (anim.transformType) {
            case 'rotate':
                if (vals.length >= 3) {
                    ctx.translate(vals[1], vals[2]);
                    ctx.rotate(vals[0] * Math.PI / 180);
                    ctx.translate(-vals[1], -vals[2]);
                } else {
                    ctx.rotate((vals[0] || 0) * Math.PI / 180);
                }
                break;
            case 'translate':
                ctx.translate(vals[0] || 0, vals[1] || 0);
                break;
            case 'scale':
                ctx.scale(vals[0] || 1, vals[1] ?? vals[0] ?? 1);
                break;
        }
    }
}

function fillStrokePath(ctx: CanvasRenderingContext2D, path: Path2D, style: StyleAttrs): void {
    if (style.fill) {
        ctx.fillStyle = style.fill;
        if (style.fillOpacity < 1) {
            const prev = ctx.globalAlpha;
            ctx.globalAlpha *= style.fillOpacity;
            ctx.fill(path, style.fillRule);
            ctx.globalAlpha = prev;
        } else {
            ctx.fill(path, style.fillRule);
        }
    }
    if (style.stroke) {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.strokeWidth;
        ctx.lineCap = style.strokeLinecap;
        ctx.lineJoin = style.strokeLinejoin;
        if (style.strokeOpacity < 1) {
            const prev = ctx.globalAlpha;
            ctx.globalAlpha *= style.strokeOpacity;
            ctx.stroke(path);
            ctx.globalAlpha = prev;
        } else {
            ctx.stroke(path);
        }
    }
}

function drawNode(ctx: CanvasRenderingContext2D, node: CompiledNode, time: number, clipPaths: Map<string, Path2D>): void {
    ctx.save();

    // Apply opacity
    if (node.style.opacity < 1) {
        ctx.globalAlpha *= node.style.opacity;
    }

    // Apply transform-origin: translate to origin, apply transforms, translate back
    const to = node.transformOrigin;
    if (to) {
        ctx.translate(to[0], to[1]);
    }

    // Apply static transform
    if (node.transform) {
        applyTransform(ctx, node.transform);
    }

    // Apply animated transforms
    if (node.transformAnimations.length > 0) {
        applyAnimatedTransforms(ctx, node.transformAnimations, time);
    }

    if (to) {
        ctx.translate(-to[0], -to[1]);
    }

    // Apply clip path
    if (node.clipPathId) {
        const cp = clipPaths.get(node.clipPathId);
        if (cp) ctx.clip(cp);
    }

    const tag = node.tag;

    if (tag === 'g' || tag === 'svg') {
        for (const child of node.children) {
            drawNode(ctx, child, time, clipPaths);
        }
    } else if (tag === 'path') {
        let path: Path2D | null;
        if (node.pathAnimations.length > 0) {
            path = interpolatePathAnim(node.pathAnimations[0], time);
        } else {
            path = node.path2d;
        }
        if (path) {
            fillStrokePath(ctx, path, node.style);
        }
    } else if (tag === 'circle' || tag === 'ellipse' || tag === 'rect' || tag === 'polygon') {
        if (node.path2d) {
            fillStrokePath(ctx, node.path2d, node.style);
        }
    } else if (tag === 'image') {
        if (node.imageEl && node.imageEl.complete && node.imageEl.naturalWidth > 0) {
            ctx.drawImage(node.imageEl, node.imageX, node.imageY, node.imageW, node.imageH);
        }
    } else if (tag === 'line') {
        if (node.style.stroke) {
            const lp = new Path2D();
            lp.moveTo(node.x1, node.y1);
            lp.lineTo(node.x2, node.y2);
            ctx.strokeStyle = node.style.stroke;
            ctx.lineWidth = node.style.strokeWidth;
            ctx.lineCap = node.style.strokeLinecap;
            ctx.lineJoin = node.style.strokeLinejoin;
            ctx.stroke(lp);
        }
    }

    ctx.restore();
}

// === Public Drawing API ===

/**
 * Draw a compiled SVG to a canvas context, centered at (x, y).
 * Uses uniform scaling (preserveAspectRatio="xMidYMid meet" equivalent).
 */
export function drawCompiledSVG(
    ctx: CanvasRenderingContext2D,
    compiled: CompiledSVG,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number = 0,
    time: number = 0,
): void {
    const vb = compiled.viewBox;

    ctx.save();

    // Position and rotate
    if (x !== 0 || y !== 0) ctx.translate(x, y);
    if (rotation !== 0) ctx.rotate(rotation);

    // Uniform scale — equivalent to preserveAspectRatio="xMidYMid meet"
    const scale = Math.min(width / vb.w, height / vb.h);
    ctx.scale(scale, scale);
    ctx.translate(-vb.x - vb.w / 2, -vb.y - vb.h / 2);

    for (const child of compiled.children) {
        drawNode(ctx, child, time, compiled.clipPaths);
    }

    ctx.restore();
}

/**
 * Render a compiled SVG to an offscreen canvas (for petal caching etc.)
 * Uses uniform scaling to fill the canvas while preserving aspect ratio.
 */
export function renderCompiledSVGToCanvas(
    compiled: CompiledSVG,
    width: number,
    height: number,
    time: number = 0,
): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const vb = compiled.viewBox;
    // Uniform scale, centered
    const scale = Math.min(width / vb.w, height / vb.h);
    const offsetX = (width - vb.w * scale) / 2;
    const offsetY = (height - vb.h * scale) / 2;
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.translate(-vb.x, -vb.y);

    for (const child of compiled.children) {
        drawNode(ctx, child, time, compiled.clipPaths);
    }

    return canvas;
}
