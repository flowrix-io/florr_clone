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
    // Two-slot (time -> path) memo, filled at draw time. See interpolatePathAnim.
    memoTime0?: number;
    memoPath0?: Path2D | null;
    memoTime1?: number;
    memoPath1?: Path2D | null;
}

export interface AttributeAnimation {
    attributeName: string;
    values: string[];
    dur: number;
    begin: number;
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
    attributeAnimations: AttributeAnimation[];
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
    /**
     * True if any node is an <image>. Computed once here so per-frame callers
     * don't walk the tree: imageSmoothingEnabled only affects drawImage, so an
     * SVG made purely of paths must not pay a smoothing state write (see
     * renderSVGToCanvas).
     */
    hasImage: boolean;
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

function parseAttributeAnimations(el: Element): AttributeAnimation[] {
    const anims: AttributeAnimation[] = [];
    for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.tagName !== 'animate') continue;

        const attributeName = child.getAttribute('attributeName');
        if (!attributeName || attributeName === 'd') continue;

        let values: string[];
        const valuesAttr = child.getAttribute('values');
        if (valuesAttr) {
            values = valuesAttr.split(';').map((s: string) => s.trim()).filter(Boolean);
        } else {
            const from = child.getAttribute('from') ?? el.getAttribute(attributeName) ?? '';
            const to = child.getAttribute('to');
            if (!to) continue;
            values = [from, to];
        }
        if (values.length < 2) continue;

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

        anims.push({
            attributeName,
            values,
            dur: parseDuration(child.getAttribute('dur') || '1s'),
            begin: parseBegin(child.getAttribute('begin')),
            keyTimes,
            calcMode: child.getAttribute('calcMode') || 'linear',
            keySplines,
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
        transformAnimations: [], attributeAnimations: [], pathAnimations: [], children: [],
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
    node.attributeAnimations = parseAttributeAnimations(el);

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

        // Seed the inherited style from the root <svg>'s presentation
        // attributes (fill="none" on the root must cascade into children that
        // don't set their own fill), falling back to SVG defaults for anything
        // unset.
        const rootStyle = parseStyleWithInheritance(svgEl, ROOT_INHERITED_STYLE);
        const children = compileChildren(svgEl, doc, rootStyle);

        const compiled: CompiledSVG = { viewBox, children, clipPaths, hasImage: treeHasImage(children) };
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

function treeHasImage(nodes: CompiledNode[]): boolean {
    for (const n of nodes) {
        if (n.tag === 'image' || n.imageEl) return true;
        if (n.children && treeHasImage(n.children)) return true;
    }
    return false;
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

function getAnimationSegment(
    valueCount: number,
    keyTimes: number[] | null,
    calcMode: string,
    keySplines: number[][] | null,
    time: number,
    dur: number,
    begin: number,
): { seg: number; lp: number } {
    const effectiveTime = time - begin;
    const progress = (((effectiveTime % dur) + dur) % dur) / dur;

    const kt = keyTimes && keyTimes.length === valueCount
        ? keyTimes
        : Array.from({ length: valueCount }, (_, i) => i / (valueCount - 1));

    let seg = 0;
    for (let i = 0; i < valueCount - 1; i++) {
        if (progress >= kt[i] && progress <= kt[i + 1]) { seg = i; break; }
    }

    const segStart = kt[seg];
    const segEnd = kt[seg + 1];
    let lp = segEnd > segStart ? (progress - segStart) / (segEnd - segStart) : 0;

    if (calcMode === 'spline' && keySplines && keySplines[seg]) {
        const sp = keySplines[seg];
        lp = cubicBezierEase(lp, sp[0], sp[1], sp[2], sp[3]);
    } else if (calcMode === 'discrete') {
        lp = 0;
    }

    return { seg, lp };
}

function interpolateTransformAnim(anim: TransformAnimation, time: number): number[] {
    const values = anim.values;
    const { seg, lp } = getAnimationSegment(values.length, anim.keyTimes, anim.calcMode, anim.keySplines, time, anim.dur, anim.begin);

    const from = values[seg];
    const to = values[seg + 1] || from;
    return from.map((v, i) => v + ((to[i] ?? v) - v) * lp);
}

function parseColor(value: string): [number, number, number, number] | null {
    const v = value.trim().toLowerCase();
    if (v === 'none') return null;
    const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const h = hex[1].length === 3
            ? hex[1].split('').map(c => c + c).join('')
            : hex[1];
        return [
            parseInt(h.slice(0, 2), 16),
            parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16),
            1
        ];
    }
    const rgba = v.match(/^rgba?\(([^)]+)\)$/);
    if (rgba) {
        const parts = rgba[1].split(/[\s,]+/).map(Number);
        return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] ?? 1];
    }
    return null;
}

function interpolateColor(from: string, to: string, lp: number): string | null {
    const c1 = parseColor(from);
    const c2 = parseColor(to);
    if (!c1 || !c2) return lp < 1 ? from : to;

    const r = Math.round(c1[0] + (c2[0] - c1[0]) * lp);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * lp);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * lp);
    const a = c1[3] + (c2[3] - c1[3]) * lp;
    return a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function interpolateAttributeAnim(anim: AttributeAnimation, time: number): string {
    const { seg, lp } = getAnimationSegment(anim.values.length, anim.keyTimes, anim.calcMode, anim.keySplines, time, anim.dur, anim.begin);
    const from = anim.values[seg];
    const to = anim.values[seg + 1] || from;

    const fromNum = parseFloat(from);
    const toNum = parseFloat(to);
    if (!isNaN(fromNum) && !isNaN(toNum)) {
        const value = fromNum + (toNum - fromNum) * lp;
        return value % 1 === 0 ? value.toString() : value.toFixed(3);
    }

    if (anim.attributeName === 'fill' || anim.attributeName === 'stroke') {
        return interpolateColor(from, to, lp) ?? (lp < 1 ? from : to);
    }

    return lp < 1 ? from : to;
}

function getAnimatedAttribute(node: CompiledNode, name: string, time: number): string | null {
    const anim = node.attributeAnimations.find(a => a.attributeName === name);
    return anim ? interpolateAttributeAnim(anim, time) : null;
}

function getAnimatedNumber(node: CompiledNode, name: string, fallback: number, time: number): number {
    const value = getAnimatedAttribute(node, name, time);
    return value === null ? fallback : num(value, fallback);
}

function getAnimatedStyle(node: CompiledNode, time: number): StyleAttrs {
    const style = { ...node.style };
    const fill = getAnimatedAttribute(node, 'fill', time);
    if (fill !== null) style.fill = fill === 'none' ? null : fill;
    const stroke = getAnimatedAttribute(node, 'stroke', time);
    if (stroke !== null) style.stroke = stroke === 'none' ? null : stroke;
    style.opacity = getAnimatedNumber(node, 'opacity', style.opacity, time);
    style.fillOpacity = getAnimatedNumber(node, 'fill-opacity', style.fillOpacity, time);
    style.strokeOpacity = getAnimatedNumber(node, 'stroke-opacity', style.strokeOpacity, time);
    style.strokeWidth = getAnimatedNumber(node, 'stroke-width', style.strokeWidth, time);
    return style;
}

function buildAnimatedShapePath(node: CompiledNode, time: number): Path2D | null {
    const path = new Path2D();
    try {
        switch (node.tag) {
            case 'circle': {
                const cx = getAnimatedNumber(node, 'cx', node.cx, time);
                const cy = getAnimatedNumber(node, 'cy', node.cy, time);
                const r = getAnimatedNumber(node, 'r', node.r, time);
                if (r <= 0) return null;
                path.arc(cx, cy, r, 0, Math.PI * 2);
                return path;
            }
            case 'ellipse': {
                const cx = getAnimatedNumber(node, 'cx', node.cx, time);
                const cy = getAnimatedNumber(node, 'cy', node.cy, time);
                const rx = getAnimatedNumber(node, 'rx', node.rx, time);
                const ry = getAnimatedNumber(node, 'ry', node.ry, time);
                if (rx <= 0 || ry <= 0) return null;
                path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                return path;
            }
            case 'rect': {
                const x = getAnimatedNumber(node, 'x', node.x, time);
                const y = getAnimatedNumber(node, 'y', node.y, time);
                const width = getAnimatedNumber(node, 'width', node.width, time);
                const height = getAnimatedNumber(node, 'height', node.height, time);
                const rx = getAnimatedNumber(node, 'rx', node.rx, time);
                const ry = getAnimatedNumber(node, 'ry', node.ry, time);
                if (width <= 0 || height <= 0) return null;
                if (rx > 0 || ry > 0) path.roundRect(x, y, width, height, [rx || ry]);
                else path.rect(x, y, width, height);
                return path;
            }
        }
    } catch {
        return null;
    }
    return node.path2d;
}

/**
 * Interpolated path for `anim` at `time`, memoized.
 *
 * Every instance of a mob type shares one compiled node tree (the compiler
 * caches by SVG string) and every mob is drawn at the same frameTimestamp, so
 * all N instances ask for the identical path each frame. The miss path below
 * allocates a number array, rebuilds the `d` string and parses a fresh Path2D
 * — the live renderer's single hottest operation — so memoizing collapses that
 * from once per mob to once per frame.
 *
 * Two slots, not one: chasing mobs animate at time*2 (see drawEnemy), so a type
 * can legitimately be asked for two distinct times within the same frame, and a
 * single slot would thrash to a 0% hit rate when both are on screen.
 *
 * Returned paths are only ever read (fillStrokePath), never mutated, so handing
 * the same Path2D to every instance is safe.
 */
function interpolatePathAnim(anim: PathAnimation, time: number): Path2D | null {
    if (anim.memoTime0 === time) return anim.memoPath0!;
    if (anim.memoTime1 === time) return anim.memoPath1!;
    const path = computePathAnim(anim, time);
    anim.memoTime1 = anim.memoTime0;
    anim.memoPath1 = anim.memoPath0;
    anim.memoTime0 = time;
    anim.memoPath0 = path;
    return path;
}

function computePathAnim(anim: PathAnimation, time: number): Path2D | null {
    const n = anim.keyframes.length;
    const { seg, lp } = getAnimationSegment(n, anim.keyTimes, anim.calcMode, anim.keySplines, time, anim.dur, anim.begin);

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

/**
 * When set, every fill/stroke is blended this far toward `tintColor` as it is
 * painted. Module-scoped because drawing is synchronous and single-threaded,
 * and threading it through drawNode's recursion buys nothing.
 *
 * This is how the mob death tint works. It must NOT be done by compositing a
 * coloured rect over the mob with `source-atop`: that clips to the whole
 * canvas's alpha, and the world background is opaque by then, so it tinted a
 * mob-sized SQUARE of ground (verified by pixel probe). Blending per shape
 * tints exactly the pixels the mob paints, and — unlike drawing a second
 * tinted pass on top — overlapping parts can't double-tint.
 */
let tintColor: string | null = null;
let tintAmount = 0;

function tinted(color: string): string {
    return tintColor ? (interpolateColor(color, tintColor, tintAmount) ?? color) : color;
}

function fillStrokePath(ctx: CanvasRenderingContext2D, path: Path2D, style: StyleAttrs): void {
    if (style.fill) {
        ctx.fillStyle = tinted(style.fill);
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
        ctx.strokeStyle = tinted(style.stroke);
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
    const style = node.attributeAnimations.length > 0 ? getAnimatedStyle(node, time) : node.style;

    // Apply opacity
    if (style.opacity < 1) {
        ctx.globalAlpha *= style.opacity;
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
            fillStrokePath(ctx, path, style);
        }
    } else if (tag === 'circle' || tag === 'ellipse' || tag === 'rect' || tag === 'polygon') {
        const path = node.attributeAnimations.length > 0
            ? buildAnimatedShapePath(node, time)
            : node.path2d;
        if (path) {
            fillStrokePath(ctx, path, style);
        }
    } else if (tag === 'image') {
        if (node.imageEl && node.imageEl.complete && node.imageEl.naturalWidth > 0) {
            ctx.drawImage(node.imageEl, node.imageX, node.imageY, node.imageW, node.imageH);
        }
    } else if (tag === 'line') {
        if (style.stroke) {
            const lp = new Path2D();
            lp.moveTo(
                getAnimatedNumber(node, 'x1', node.x1, time),
                getAnimatedNumber(node, 'y1', node.y1, time),
            );
            lp.lineTo(
                getAnimatedNumber(node, 'x2', node.x2, time),
                getAnimatedNumber(node, 'y2', node.y2, time),
            );
            ctx.strokeStyle = tinted(style.stroke);
            ctx.lineWidth = style.strokeWidth;
            ctx.lineCap = style.strokeLinecap;
            ctx.lineJoin = style.strokeLinejoin;
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
    tint: { color: string; amount: number } | null = null,
): void {
    const vb = compiled.viewBox;

    tintColor = tint && tint.amount > 0 ? tint.color : null;
    tintAmount = tint ? tint.amount : 0;

    ctx.save();

    // Position and rotate
    if (x !== 0 || y !== 0) ctx.translate(x, y);
    if (rotation !== 0) ctx.rotate(rotation);

    // Uniform scale — equivalent to preserveAspectRatio="xMidYMid meet"
    const scale = Math.min(width / vb.w, height / vb.h);
    ctx.scale(scale, scale);
    ctx.translate(-vb.x - vb.w / 2, -vb.y - vb.h / 2);

    try {
        for (const child of compiled.children) {
            drawNode(ctx, child, time, compiled.clipPaths);
        }
    } finally {
        ctx.restore();
        // finally, not a plain reset: drawNode throwing must not leave the tint
        // armed. Callers catch render errors, so a leak would silently tint the
        // next mob — and petal bakes, which call drawNode without going through
        // this function.
        tintColor = null;
        tintAmount = 0;
    }
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
    // This path draws nodes directly, so it must state its own tint: an
    // offscreen bake is never tinted.
    tintColor = null;
    tintAmount = 0;

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
