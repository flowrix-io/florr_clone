/*
    CanvasCapture
    -------------
    Records everything a page draws into its 2D canvases and re-emits it as
    plain JavaScript canvas commands (paste the result into html_render.html).

    Usage (paste this file into the console at any time):

        CanvasCapture.copy();            // last complete frame -> clipboard
        CanvasCapture.print();           // ...or to the console
        await CanvasCapture.next();      // wait for the next frame, return code

        CanvasCapture.output(someCanvas) // a specific canvas

    Nothing has to be wired up by hand. Loading this file patches
    CanvasRenderingContext2D.prototype, Path2D and CanvasGradient, so contexts
    that were created BEFORE the paste are captured too, and every canvas on
    the page (including detached / offscreen sprite atlases) is recorded.

    The legacy form still works:

        var capture = new CanvasCapture(canvas);
        var ctx = capture.ctx;                    // this is now the real ctx
        console.log(capture.output());

    What the generated code needs:

        * `ctx`     - a 2D context (required)
        * `canvas`  - optional, used to restore the original size
        * to run inside an async function (images are awaited)
        * `Image` / `document` are used only when the frame contains images
          or SVG overlays.
*/

var CanvasCapture = (function () {
    "use strict";

    var GLOBAL =
        typeof globalThis !== "undefined"
            ? globalThis
            : (typeof window !== "undefined" ? window : this);

    var HAS_DOM =
        typeof document !== "undefined" &&
        typeof HTMLCanvasElement !== "undefined";

    var HAS_WEAKREF =
        typeof WeakRef === "function";

    var OriginalPath2D =
        typeof Path2D !== "undefined" ? Path2D : null;

    /* canvas -> capture, ctx -> capture */
    var captures = new WeakMap();
    var contextCaptures = new WeakMap();

    /* Path2D -> { commands: [] } */
    var pathInfo = new WeakMap();

    /* CanvasGradient | CanvasPattern -> { call, args, stops, matrix } */
    var paintInfo = new WeakMap();

    /* every capture, so a frame boundary can reach all of them */
    var registry = [];

    var originalGetContext = null;

    /* Scratch canvases used while serializing must not record. */
    var ignored = new WeakSet();

    var installed = false;

    var options = {
        /* decimals kept for non-integer numbers - low values visibly
           clip arc end angles, so this is deliberately generous */
        precision: 6,

        /* drop property writes that cannot change anything */
        dedupeState: true,

        /* inline drawImage(otherCanvas) as commands instead of pixels */
        inlineCanvases: true,

        /* copy computed styles into captured <svg> markup */
        inlineSvgStyles: true,

        /* include <svg> elements that overlap the canvas */
        captureSvg: true,

        /* safety valve for canvases that never clear */
        maxCommands: 400000,

        /* commands retained per canvas so past blits stay resolvable */
        maxHistory: 200000,

        /* elements walked per <svg> when inlining styles */
        maxSvgNodes: 4000
    };

    var enabled = true;


    /*
     * ----------------------------------------------------------
     * Context surface
     * ----------------------------------------------------------
     */

    /* Recorded as commands. */
    var METHODS = [
        "save", "restore",
        "scale", "rotate", "translate", "transform",
        "setTransform", "resetTransform",
        "beginPath", "closePath", "moveTo", "lineTo",
        "bezierCurveTo", "quadraticCurveTo",
        "arc", "arcTo", "ellipse", "rect", "roundRect",
        "fill", "stroke", "clip",
        "fillRect", "strokeRect",
        "fillText", "strokeText",
        "setLineDash",
        "putImageData",
        "drawImage"
    ];

    /* Recorded as property writes. */
    var STATE_PROPS = [
        "globalAlpha", "globalCompositeOperation",
        "fillStyle", "strokeStyle",
        "lineWidth", "lineCap", "lineJoin", "miterLimit", "lineDashOffset",
        "shadowBlur", "shadowColor", "shadowOffsetX", "shadowOffsetY",
        "font", "textAlign", "textBaseline", "direction",
        "letterSpacing", "wordSpacing", "fontKerning", "fontStretch",
        "fontVariantCaps", "textRendering",
        "imageSmoothingEnabled", "imageSmoothingQuality",
        "filter"
    ];

    var DEFAULT_STATE = {
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        fillStyle: "#000000",
        strokeStyle: "#000000",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 10,
        lineDashOffset: 0,
        shadowBlur: 0,
        shadowColor: "rgba(0, 0, 0, 0)",
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        font: "10px sans-serif",
        textAlign: "start",
        textBaseline: "alphabetic",
        direction: "ltr",
        letterSpacing: "0px",
        wordSpacing: "0px",
        fontKerning: "auto",
        fontStretch: "normal",
        fontVariantCaps: "normal",
        textRendering: "auto",
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "low",
        filter: "none"
    };

    /* Paint factories: the result is tracked, the call is not emitted. */
    var PAINT_FACTORIES = [
        "createLinearGradient",
        "createRadialGradient",
        "createConicGradient",
        "createPattern"
    ];

    /*
     * Commands that only build the current path. A frame that is cut
     * while one of these runs can be repaired by replaying them at the
     * head of the next frame - they have no other side effect.
     */
    var PATH_BUILDERS = {
        beginPath: true,
        closePath: true,
        moveTo: true,
        lineTo: true,
        bezierCurveTo: true,
        quadraticCurveTo: true,
        arc: true,
        arcTo: true,
        ellipse: true,
        rect: true,
        roundRect: true
    };

    var PATH_METHODS = [
        "addPath", "closePath", "moveTo", "lineTo",
        "bezierCurveTo", "quadraticCurveTo",
        "arc", "arcTo", "ellipse", "rect", "roundRect"
    ];


    /*
     * ----------------------------------------------------------
     * Small helpers
     * ----------------------------------------------------------
     */

    function isImageSource(value) {
        if (!value || typeof value !== "object") {
            return false;
        }

        return (
            (HAS_DOM && value instanceof HTMLCanvasElement) ||
            (HAS_DOM && value instanceof HTMLImageElement) ||
            (HAS_DOM && typeof SVGImageElement !== "undefined" &&
                value instanceof SVGImageElement) ||
            (HAS_DOM && typeof HTMLVideoElement !== "undefined" &&
                value instanceof HTMLVideoElement) ||
            (typeof ImageBitmap !== "undefined" &&
                value instanceof ImageBitmap) ||
            (typeof OffscreenCanvas !== "undefined" &&
                value instanceof OffscreenCanvas) ||
            (typeof VideoFrame !== "undefined" &&
                value instanceof VideoFrame)
        );
    }


    function sourceSize(source) {
        if (typeof source.naturalWidth === "number" &&
            source.naturalWidth) {
            return {
                width: source.naturalWidth,
                height: source.naturalHeight
            };
        }

        if (typeof source.videoWidth === "number" &&
            source.videoWidth) {
            return {
                width: source.videoWidth,
                height: source.videoHeight
            };
        }

        if (typeof source.displayWidth === "number" &&
            source.displayWidth) {
            return {
                width: source.displayWidth,
                height: source.displayHeight
            };
        }

        return {
            width: source.width || 0,
            height: source.height || 0
        };
    }


    function scratchCanvas(width, height) {
        var canvas = document.createElement("canvas");

        ignored.add(canvas);

        canvas.width = width;
        canvas.height = height;

        /*
         * Bypass the patched accessor so the scratch canvas is not
         * itself recorded.
         */
        var ctx =
            originalGetContext
                ? originalGetContext.call(canvas, "2d")
                : canvas.getContext("2d");

        return {
            canvas: canvas,
            ctx: ctx
        };
    }


    function absoluteURL(url) {
        if (!url) {
            return url;
        }

        try {
            return new URL(url, GLOBAL.location.href).href;
        } catch (error) {
            return url;
        }
    }


    function toBase64(bytes) {
        var chunk = 0x8000;
        var out = "";

        for (var i = 0; i < bytes.length; i += chunk) {
            out += String.fromCharCode.apply(
                null,
                bytes.subarray(i, i + chunk)
            );
        }

        return GLOBAL.btoa(out);
    }


    function track(capture) {
        registry.push(
            HAS_WEAKREF ? new WeakRef(capture) : capture
        );
    }


    function eachCapture(fn) {
        var alive = [];

        for (var i = 0; i < registry.length; i++) {
            var entry = registry[i];

            var capture =
                HAS_WEAKREF ? entry.deref() : entry;

            if (!capture) {
                continue;
            }

            alive.push(entry);

            fn(capture);
        }

        registry = alive;
    }


    /*
     * ----------------------------------------------------------
     * Frame boundaries
     * ----------------------------------------------------------
     *
     * Games do not agree on how a frame starts, so three signals are
     * used: the requestAnimationFrame tick, a full-canvas clearRect and
     * a canvas resize. Whichever comes first closes the previous frame.
     *
     * Only on-screen canvases are cut at the rAF tick. A detached
     * sprite atlas is usually drawn once and reused for many frames, so
     * its buffer accumulates until it is explicitly cleared.
     * ----------------------------------------------------------
     */

    var lastTick = -1;

    function beginTick(time) {
        if (time === lastTick) {
            return;
        }

        lastTick = time;

        eachCapture(function (capture) {
            if (capture.isLive()) {
                capture.endFrame();
            }
        });
    }


    function installRAF() {
        if (!GLOBAL.requestAnimationFrame ||
            GLOBAL.requestAnimationFrame.__ccWrapped) {
            return;
        }

        var original = GLOBAL.requestAnimationFrame;

        function requestAnimationFrameWrapper(callback) {
            return original.call(GLOBAL, function (time) {
                if (enabled) {
                    beginTick(time);
                }

                return callback(time);
            });
        }

        requestAnimationFrameWrapper.__ccWrapped = true;

        GLOBAL.requestAnimationFrame =
            requestAnimationFrameWrapper;
    }


    /*
     * ----------------------------------------------------------
     * Path2D
     * ----------------------------------------------------------
     *
     * The prototype is patched instead of proxying instances. A proxy
     * around a Path2D fails the platform-object brand check when it is
     * handed back to fill()/stroke(), and - the reason paths used to
     * come out empty - the recorded commands ended up under a different
     * key than the object the game kept.
     * ----------------------------------------------------------
     */

    function pathCommands(path) {
        var info = pathInfo.get(path);

        if (!info) {
            info = { commands: [], source: null };
            pathInfo.set(path, info);
        }

        return info;
    }


    function installPath2D() {
        if (!OriginalPath2D ||
            OriginalPath2D.prototype.__ccInstalled) {
            return;
        }

        PATH_METHODS.forEach(function (name) {
            var original = OriginalPath2D.prototype[name];

            if (typeof original !== "function") {
                return;
            }

            OriginalPath2D.prototype[name] = function () {
                if (enabled) {
                    var info = pathCommands(this);

                    if (info.commands.length < options.maxCommands) {
                        info.commands.push({
                            name: name,
                            args: Array.prototype.slice.call(arguments)
                        });
                    }
                }

                return original.apply(this, arguments);
            };
        });

        Object.defineProperty(
            OriginalPath2D.prototype,
            "__ccInstalled",
            { value: true }
        );

        /*
         * Wrap the constructor so `new Path2D("M0 0 L10 10")` and
         * `new Path2D(other)` keep their geometry. Returning a real
         * Path2D (not a proxy) keeps instanceof and the brand checks
         * intact.
         */
        function CapturedPath2D(arg) {
            var path =
                arguments.length
                    ? new OriginalPath2D(arg)
                    : new OriginalPath2D();

            var info = { commands: [], source: null };

            if (typeof arg === "string") {
                info.source = arg;
            } else if (arg && pathInfo.has(arg)) {
                info.commands.push({
                    name: "addPath",
                    args: [arg]
                });
            }

            pathInfo.set(path, info);

            return path;
        }

        CapturedPath2D.prototype = OriginalPath2D.prototype;
        CapturedPath2D.__ccWrapped = true;

        GLOBAL.Path2D = CapturedPath2D;
    }


    /*
     * ----------------------------------------------------------
     * Gradients and patterns
     * ----------------------------------------------------------
     *
     * These used to encode as "unsupported", which emitted
     * `ctx.fillStyle = undefined` and painted everything black.
     * ----------------------------------------------------------
     */

    function installPaints() {
        if (typeof CanvasGradient !== "undefined" &&
            !CanvasGradient.prototype.__ccInstalled) {

            var addColorStop =
                CanvasGradient.prototype.addColorStop;

            CanvasGradient.prototype.addColorStop =
                function (offset, color) {
                    var info = paintInfo.get(this);

                    if (info) {
                        info.stops.push([offset, color]);
                    }

                    return addColorStop.apply(this, arguments);
                };

            Object.defineProperty(
                CanvasGradient.prototype,
                "__ccInstalled",
                { value: true }
            );
        }

        if (typeof CanvasPattern !== "undefined" &&
            CanvasPattern.prototype.setTransform &&
            !CanvasPattern.prototype.__ccInstalled) {

            var setTransform =
                CanvasPattern.prototype.setTransform;

            CanvasPattern.prototype.setTransform =
                function (matrix) {
                    var info = paintInfo.get(this);

                    if (info && matrix) {
                        info.matrix = [
                            matrix.a, matrix.b, matrix.c,
                            matrix.d, matrix.e, matrix.f
                        ];
                    }

                    return setTransform.apply(this, arguments);
                };

            Object.defineProperty(
                CanvasPattern.prototype,
                "__ccInstalled",
                { value: true }
            );
        }
    }


    /*
     * ----------------------------------------------------------
     * Context prototype patch
     * ----------------------------------------------------------
     */

    function captureFor(ctx) {
        var capture = contextCaptures.get(ctx);

        if (capture) {
            return capture;
        }

        var canvas = ctx.canvas;

        if (!canvas || ignored.has(canvas)) {
            return null;
        }

        capture = captures.get(canvas);

        if (!capture) {
            capture = new CanvasCapture(canvas, ctx);
        } else {
            contextCaptures.set(ctx, capture);
        }

        return capture;
    }


    function installContextPrototype(proto) {
        if (!proto || proto.__ccInstalled) {
            return;
        }

        METHODS.forEach(function (name) {
            var original = proto[name];

            if (typeof original !== "function") {
                return;
            }

            proto[name] = function () {
                if (enabled) {
                    var capture = captureFor(this);

                    if (capture) {
                        capture.record(this, name, arguments);
                    }
                }

                return original.apply(this, arguments);
            };
        });

        PAINT_FACTORIES.forEach(function (name) {
            var original = proto[name];

            if (typeof original !== "function") {
                return;
            }

            proto[name] = function () {
                var paint = original.apply(this, arguments);

                if (enabled && paint && typeof paint === "object") {
                    paintInfo.set(paint, {
                        call: name,
                        args: Array.prototype.slice.call(arguments),
                        stops: [],
                        matrix: null
                    });
                }

                return paint;
            };
        });

        STATE_PROPS.forEach(function (name) {
            var descriptor =
                Object.getOwnPropertyDescriptor(proto, name);

            if (!descriptor || !descriptor.set || !descriptor.get) {
                return;
            }

            Object.defineProperty(proto, name, {
                configurable: true,
                enumerable: descriptor.enumerable,

                get: descriptor.get,

                set: function (value) {
                    if (enabled) {
                        var capture = captureFor(this);

                        if (capture) {
                            capture.recordSet(name, value);
                        }
                    }

                    return descriptor.set.call(this, value);
                }
            });
        });

        /* reset() wipes state and content in one go. */
        if (typeof proto.reset === "function") {
            var reset = proto.reset;

            proto.reset = function () {
                var result = reset.apply(this, arguments);

                if (enabled) {
                    var capture = captureFor(this);

                    if (capture) {
                        capture.endFrame();
                    }
                }

                return result;
            };
        }

        Object.defineProperty(proto, "__ccInstalled", { value: true });
    }


    function installGetContext() {
        if (!HAS_DOM) {
            return;
        }

        var proto = HTMLCanvasElement.prototype;

        if (proto.getContext.__ccWrapped) {
            return;
        }

        originalGetContext = proto.getContext;

        function getContext(type) {
            var ctx =
                originalGetContext.apply(this, arguments);

            if (enabled && ctx && type === "2d") {
                captureFor(ctx);
            }

            return ctx;
        }

        getContext.__ccWrapped = true;

        proto.getContext = getContext;
    }


    /*
     * Resizing a canvas erases it, which is how some games clear.
     */
    function installResizeHooks() {
        if (!HAS_DOM) {
            return;
        }

        ["width", "height"].forEach(function (name) {
            var descriptor =
                Object.getOwnPropertyDescriptor(
                    HTMLCanvasElement.prototype,
                    name
                );

            if (!descriptor ||
                !descriptor.set ||
                descriptor.set.__ccWrapped) {
                return;
            }

            var setter = descriptor.set;

            function wrapped(value) {
                var result = setter.call(this, value);

                if (enabled) {
                    var capture = captures.get(this);

                    if (capture) {
                        capture.endFrame();
                    }
                }

                return result;
            }

            wrapped.__ccWrapped = true;

            Object.defineProperty(
                HTMLCanvasElement.prototype,
                name,
                {
                    configurable: true,
                    enumerable: descriptor.enumerable,
                    get: descriptor.get,
                    set: wrapped
                }
            );
        });
    }


    function install() {
        if (installed) {
            return;
        }

        installed = true;

        installPath2D();
        installPaints();

        if (typeof CanvasRenderingContext2D !== "undefined") {
            installContextPrototype(
                CanvasRenderingContext2D.prototype
            );
        }

        if (typeof OffscreenCanvasRenderingContext2D !== "undefined") {
            installContextPrototype(
                OffscreenCanvasRenderingContext2D.prototype
            );
        }

        installGetContext();
        installResizeHooks();
        installRAF();
    }


    /*
     * ----------------------------------------------------------
     * Constructor
     * ----------------------------------------------------------
     */

    function CanvasCapture(canvas, ctx) {
        if (!(this instanceof CanvasCapture)) {
            return new CanvasCapture(canvas, ctx);
        }

        var isCanvas =
            (HAS_DOM && canvas instanceof HTMLCanvasElement) ||
            (typeof OffscreenCanvas !== "undefined" &&
                canvas instanceof OffscreenCanvas);

        if (!isCanvas) {
            throw new TypeError(
                "CanvasCapture requires a canvas."
            );
        }

        var existing = captures.get(canvas);

        if (existing) {
            return existing;
        }

        install();

        this.canvas = canvas;

        this.realCtx =
            ctx ||
            (originalGetContext
                ? originalGetContext.call(canvas, "2d")
                : canvas.getContext("2d"));

        if (!this.realCtx) {
            throw new Error("Could not get 2D context.");
        }

        /*
         * Kept for the old API. The context is no longer proxied - the
         * prototype patch records whichever context object is used.
         */
        this.ctx = this.realCtx;

        this.commands = [];
        this.state = this.readState();

        this.frame = null;
        this.frameState = this.state;
        this.frameCount = 0;

        this.depth = 0;
        this.minDepth = 0;

        this.frameDepth = 0;
        this.frameMinDepth = 0;
        this.frameTruncated = false;

        this.truncated = false;
        this.pending = [];

        /* index of the live beginPath in `commands`, -1 when none */
        this.pathStart = -1;
        this.carried = 0;

        /*
         * A scratch canvas is redrawn many times per frame (a tint
         * buffer, a torn-band buffer, a whole-world buffer). Each blit
         * has to replay what the source held at that moment, so closed
         * buffers are retained and every blit records which one it saw.
         */
        this.epoch = 0;
        this.history = [];
        this.blitted = false;

        captures.set(canvas, this);
        contextCaptures.set(this.realCtx, this);

        track(this);

        return this;
    }


    CanvasCapture.prototype.isLive = function () {
        return this.canvas.isConnected === true;
    };


    CanvasCapture.prototype.width = function () {
        return this.canvas.width;
    };


    CanvasCapture.prototype.height = function () {
        return this.canvas.height;
    };


    /*
     * ----------------------------------------------------------
     * Recording
     * ----------------------------------------------------------
     */

    CanvasCapture.prototype.record =
        function (ctx, name, rawArgs) {

        var args = Array.prototype.slice.call(rawArgs);

        if (name === "clearRect" && this.isFullClear(ctx, args)) {
            this.endFrame();
            return;
        }

        if (this.commands.length >= options.maxCommands) {
            this.truncated = true;
            return;
        }

        if (name === "beginPath") {
            this.pathStart = this.commands.length;
        } else if (!PATH_BUILDERS[name]) {
            /*
             * Anything else between beginPath and the end of the frame
             * would have to be replayed too, which is not safe for
             * transforms, so the path is no longer carryable.
             */
            if (name !== "fill" && name !== "stroke" && name !== "clip") {
                this.pathStart = -1;
            }
        }

        if (name === "save") {
            this.depth += 1;
        } else if (name === "restore") {
            this.depth -= 1;

            if (this.depth < this.minDepth) {
                this.minDepth = this.depth;
            }
        }

        if (name === "drawImage" && isImageSource(args[0])) {
            var source = captures.get(args[0]);

            if (source) {
                source.blitted = true;
            }

            this.commands.push({
                type: "image",
                source: args[0],
                args: args.slice(1),

                /* what the source canvas held at this instant */
                srcEpoch: source ? source.epoch : -1,
                srcLength: source ? source.commands.length : 0
            });

            return;
        }

        var encoded = new Array(args.length);

        for (var i = 0; i < args.length; i++) {
            encoded[i] = this.encode(args[i]);
        }

        this.commands.push({
            type: "call",
            name: name,
            args: encoded
        });
    };


    CanvasCapture.prototype.recordSet = function (name, value) {
        if (this.commands.length >= options.maxCommands) {
            this.truncated = true;
            return;
        }

        this.commands.push({
            type: "set",
            name: name,
            value: this.encode(value)
        });
    };


    /*
     * A clear only starts a new frame when it really covers the canvas.
     * The rectangle is in user space, so the current transform has to be
     * applied before comparing it with the backing store.
     */
    CanvasCapture.prototype.isFullClear = function (ctx, args) {
        if (args.length < 4) {
            return false;
        }

        var x = args[0];
        var y = args[1];
        var w = args[2];
        var h = args[3];

        if (!(w > 0) || !(h > 0)) {
            return false;
        }

        var canvasWidth = this.width();
        var canvasHeight = this.height();

        var matrix = null;

        try {
            matrix = ctx.getTransform ? ctx.getTransform() : null;
        } catch (error) {
            matrix = null;
        }

        if (!matrix) {
            return (
                x <= 0 && y <= 0 &&
                x + w >= canvasWidth &&
                y + h >= canvasHeight
            );
        }

        var corners = [
            [x, y],
            [x + w, y],
            [x, y + h],
            [x + w, y + h]
        ];

        var minX = Infinity;
        var minY = Infinity;
        var maxX = -Infinity;
        var maxY = -Infinity;

        for (var i = 0; i < corners.length; i++) {
            var px =
                matrix.a * corners[i][0] +
                matrix.c * corners[i][1] +
                matrix.e;

            var py =
                matrix.b * corners[i][0] +
                matrix.d * corners[i][1] +
                matrix.f;

            minX = Math.min(minX, px);
            minY = Math.min(minY, py);
            maxX = Math.max(maxX, px);
            maxY = Math.max(maxY, py);
        }

        return (
            minX <= 0.5 &&
            minY <= 0.5 &&
            maxX >= canvasWidth - 0.5 &&
            maxY >= canvasHeight - 0.5
        );
    };


    CanvasCapture.prototype.readState = function () {
        var ctx = this.realCtx;
        var state = { props: {}, transform: null, lineDash: null };

        for (var i = 0; i < STATE_PROPS.length; i++) {
            var name = STATE_PROPS[i];

            if (!(name in ctx)) {
                continue;
            }

            try {
                state.props[name] = this.encode(ctx[name]);
            } catch (error) {
                /* some properties throw on a lost context */
            }
        }

        try {
            var matrix = ctx.getTransform ? ctx.getTransform() : null;

            if (matrix) {
                state.transform = [
                    matrix.a, matrix.b, matrix.c,
                    matrix.d, matrix.e, matrix.f
                ];
            }
        } catch (error) {
            state.transform = null;
        }

        try {
            var dash = ctx.getLineDash ? ctx.getLineDash() : null;

            if (dash && dash.length) {
                state.lineDash = Array.prototype.slice.call(dash);
            }
        } catch (error) {
            state.lineDash = null;
        }

        return state;
    };


    CanvasCapture.prototype.endFrame = function () {
        var carry = this.openPath();

        var closed = this.commands;
        var closedState = this.state;

        if (closed.length > this.carried) {
            this.frame = closed;
            this.frameState = closedState;
            this.frameDepth = this.depth;
            this.frameMinDepth = this.minDepth;
            this.frameTruncated = this.truncated;
            this.frameCount += 1;
        }

        this.remember(closed, closedState);

        this.epoch += 1;

        /*
         * A path that was still being built belongs to the next frame
         * as well - without it the replay starts mid-shape and the fill
         * closes across the missing segments. The buffer is replaced
         * rather than truncated, because a retained blit may point at
         * the old one.
         */
        this.commands = carry.slice();

        this.carried = carry.length;
        this.pathStart = carry.length ? 0 : -1;

        this.state = this.readState();
        this.depth = 0;
        this.minDepth = 0;
        this.truncated = false;

        if (this.pending.length) {
            var waiting = this.pending;

            this.pending = [];

            var self = this;

            Promise.resolve().then(function () {
                waiting.forEach(function (resolve) {
                    resolve(self.output());
                });
            });
        }
    };


    /*
     * Keep the buffer that just closed, so a blit recorded against it
     * can still be resolved. Bounded by total commands - a canvas that
     * clears sixty times a second would otherwise grow without limit.
     */
    CanvasCapture.prototype.remember = function (commands, state) {
        /*
         * Only a canvas something blits from can have a past worth
         * keeping; the main canvas would otherwise retain every frame.
         */
        if (!this.blitted || !commands.length) {
            return;
        }

        this.history.push({
            epoch: this.epoch,
            commands: commands,
            state: state
        });

        var total = 0;

        for (var i = this.history.length - 1; i >= 0; i--) {
            total += this.history[i].commands.length;

            if (total > options.maxHistory ||
                this.history.length - i > 512) {
                this.history = this.history.slice(i + 1);
                break;
            }
        }
    };


    /*
     * The commands this canvas held at a recorded point in its life.
     * Returns null once that buffer has been evicted.
     */
    CanvasCapture.prototype.bufferAt = function (epoch, length) {
        var commands = null;
        var state = null;

        if (epoch === this.epoch) {
            commands = this.commands;
            state = this.state;
        } else {
            for (var i = this.history.length - 1; i >= 0; i--) {
                if (this.history[i].epoch === epoch) {
                    commands = this.history[i].commands;
                    state = this.history[i].state;
                    break;
                }
            }
        }

        if (!commands) {
            return null;
        }

        var slice =
            length < commands.length
                ? commands.slice(0, length)
                : commands;

        var depth = 0;
        var minDepth = 0;

        for (var j = 0; j < slice.length; j++) {
            if (slice[j].type !== "call") {
                continue;
            }

            if (slice[j].name === "save") {
                depth += 1;
            } else if (slice[j].name === "restore") {
                depth -= 1;

                if (depth < minDepth) {
                    minDepth = depth;
                }
            }
        }

        return {
            commands: slice,
            state: state,
            depth: depth,
            minDepth: minDepth
        };
    };


    /*
     * The path-building commands issued since the last beginPath, when
     * every one of them is safe to replay.
     */
    CanvasCapture.prototype.openPath = function () {
        if (this.pathStart < 0 ||
            this.pathStart >= this.commands.length) {
            return [];
        }

        var slice = this.commands.slice(this.pathStart);

        for (var i = 0; i < slice.length; i++) {
            if (slice[i].type !== "call" ||
                !PATH_BUILDERS[slice[i].name]) {
                return [];
            }
        }

        return slice;
    };


    /*
     * ----------------------------------------------------------
     * Encoding
     * ----------------------------------------------------------
     *
     * Primitives are stored as-is; everything else gets a small tagged
     * wrapper. Mutable values are copied at record time so a later
     * mutation cannot rewrite history.
     * ----------------------------------------------------------
     */

    CanvasCapture.prototype.encode = function (value) {
        var type = typeof value;

        if (value === null ||
            type === "undefined" ||
            type === "string" ||
            type === "number" ||
            type === "boolean") {
            return value;
        }

        if (OriginalPath2D && value instanceof OriginalPath2D) {
            return { cc: "path", value: value };
        }

        if (paintInfo.has(value)) {
            return { cc: "paint", value: value };
        }

        if (typeof ImageData !== "undefined" &&
            value instanceof ImageData) {
            return {
                cc: "imagedata",
                width: value.width,
                height: value.height,
                data: new Uint8ClampedArray(value.data)
            };
        }

        if (typeof DOMMatrix !== "undefined" &&
            (value instanceof DOMMatrix ||
                (typeof DOMMatrixReadOnly !== "undefined" &&
                    value instanceof DOMMatrixReadOnly))) {
            return {
                cc: "matrix",
                value: [
                    value.a, value.b, value.c,
                    value.d, value.e, value.f
                ]
            };
        }

        if (isImageSource(value)) {
            return { cc: "image", value: value };
        }

        if (typeof ArrayBuffer !== "undefined" &&
            ArrayBuffer.isView &&
            ArrayBuffer.isView(value)) {
            return {
                cc: "typed",
                name: value.constructor.name,
                value: Array.prototype.slice.call(value)
            };
        }

        if (Array.isArray(value)) {
            var self = this;

            return {
                cc: "array",
                value: value.map(function (item) {
                    return self.encode(item);
                })
            };
        }

        /*
         * A plain object here is almost always a DOMMatrix-like or an
         * unknown platform object. Emitting `undefined` for it is better
         * than emitting "[object Object]", but it is worth flagging.
         */
        return { cc: "unsupported" };
    };


    /*
     * ----------------------------------------------------------
     * Emit context
     * ----------------------------------------------------------
     */

    function Emitter(capture) {
        this.capture = capture;

        this.decls = [];
        this.body = [];

        this.paths = new Map();
        this.paints = new Map();
        this.images = new Map();
        this.canvasFns = new Map();
        this.captureIds = new Map();
        this.clips = new Map();

        /*
         * The captures whose commands are currently being emitted, i.e.
         * the ancestor chain of the helper being written. A canvas that
         * appears in its own chain cannot be inlined - it would emit a
         * function that calls itself forever.
         */
        this.emitting = new Set();

        this.needsLoad = false;
        this.needsBytes = false;
        this.needsReset = false;

        this.warnings = [];

        this.stack = [];

        /*
         * True while emitting a nested canvas helper. Inside one, the
         * caller has already placed the context, so absolute transforms
         * have to be composed onto that base instead of replacing it.
         */
        this.relative = false;
    }


    Emitter.prototype.matrixLiteral = function (values) {
        var emitter = this;

        return (
            "new DOMMatrix([" +
            values.map(function (n) {
                return emitter.num(n);
            }).join(", ") +
            "])"
        );
    };


    Emitter.prototype.num = function (value) {
        if (typeof value !== "number") {
            return JSON.stringify(value);
        }

        if (Number.isNaN(value)) {
            return "NaN";
        }

        if (value === Infinity) {
            return "Infinity";
        }

        if (value === -Infinity) {
            return "-Infinity";
        }

        if (Object.is(value, -0)) {
            return "-0";
        }

        if (Number.isInteger(value)) {
            return String(value);
        }

        var rounded = Number(value.toFixed(options.precision));

        if (rounded === 0 && value !== 0) {
            return String(value);
        }

        return String(rounded);
    };


    Emitter.prototype.format = function (value) {
        var type = typeof value;

        if (value === null) {
            return "null";
        }

        if (type === "undefined") {
            return "undefined";
        }

        if (type === "number") {
            return this.num(value);
        }

        if (type === "string" || type === "boolean") {
            return JSON.stringify(value);
        }

        if (value.cc === "path") {
            return this.pathId(value.value);
        }

        if (value.cc === "paint") {
            return this.paintId(value.value);
        }

        if (value.cc === "image") {
            return this.imageId(value.value);
        }

        if (value.cc === "matrix") {
            var self = this;

            return (
                "new DOMMatrix([" +
                value.value.map(function (n) {
                    return self.num(n);
                }).join(", ") +
                "])"
            );
        }

        if (value.cc === "typed") {
            return (
                "new " + value.name + "([" +
                value.value.map(function (n) {
                    return String(n);
                }).join(",") +
                "])"
            );
        }

        if (value.cc === "imagedata") {
            this.needsBytes = true;

            return (
                "new ImageData(__bytes(" +
                JSON.stringify(toBase64(value.data)) +
                ")," + value.width + "," + value.height + ")"
            );
        }

        if (value.cc === "array") {
            var emitter = this;

            return (
                "[" +
                value.value.map(function (item) {
                    return emitter.format(item);
                }).join(", ") +
                "]"
            );
        }

        return "undefined";
    };


    /*
     * ----------------------------------------------------------
     * Path declarations
     * ----------------------------------------------------------
     */

    Emitter.prototype.pathId = function (path) {
        var existing = this.paths.get(path);

        if (existing) {
            return existing;
        }

        var id = "__path" + this.paths.size;

        /* Reserve the name first so a cyclic addPath cannot recurse. */
        this.paths.set(path, id);

        var info = pathInfo.get(path);

        if (!info) {
            this.decls.push("var " + id + " = new Path2D();");

            this.warnings.push(
                "a Path2D was created before CanvasCapture loaded, " +
                "its geometry is missing"
            );

            return id;
        }

        var lines = [];

        if (info.source) {
            lines.push(
                "var " + id + " = new Path2D(" +
                JSON.stringify(info.source) + ");"
            );
        } else {
            lines.push("var " + id + " = new Path2D();");
        }

        var emitter = this;

        info.commands.forEach(function (command) {
            var args = command.args.map(function (arg) {
                return emitter.format(
                    emitter.capture.encode(arg)
                );
            });

            lines.push(
                id + "." + command.name +
                "(" + args.join(", ") + ");"
            );
        });

        /*
         * Nested declarations (an addPath argument) have already pushed
         * themselves, so this path goes after them.
         */
        this.decls.push(lines.join("\n"));

        return id;
    };


    /*
     * ----------------------------------------------------------
     * Gradient / pattern declarations
     * ----------------------------------------------------------
     */

    Emitter.prototype.paintId = function (paint) {
        var existing = this.paints.get(paint);

        if (existing) {
            return existing;
        }

        var info = paintInfo.get(paint);
        var id = "__paint" + this.paints.size;

        this.paints.set(paint, id);

        if (!info) {
            this.decls.push("var " + id + " = \"#000000\";");
            return id;
        }

        var emitter = this;

        var args = info.args.map(function (arg) {
            return emitter.format(
                emitter.capture.encode(arg)
            );
        });

        var lines = [];

        /*
         * createPattern() returns null for a source it cannot use, and
         * a null fillStyle assignment is simply ignored, so the
         * fallback keeps the shape visible instead of invisible.
         */
        if (info.call === "createPattern") {
            lines.push(
                "var " + id + " = ctx." + info.call +
                "(" + args.join(", ") + ") || \"#000000\";"
            );
        } else {
            lines.push(
                "var " + id + " = ctx." + info.call +
                "(" + args.join(", ") + ");"
            );
        }

        info.stops.forEach(function (stop) {
            lines.push(
                id + ".addColorStop(" +
                emitter.num(stop[0]) + ", " +
                JSON.stringify(stop[1]) + ");"
            );
        });

        if (info.matrix) {
            lines.push(
                "if (" + id + ".setTransform) { " +
                id + ".setTransform(new DOMMatrix([" +
                info.matrix.map(function (n) {
                    return emitter.num(n);
                }).join(", ") +
                "])); }"
            );
        }

        this.decls.push(lines.join("\n"));

        return id;
    };


    /*
     * ----------------------------------------------------------
     * Image declarations
     * ----------------------------------------------------------
     */

    Emitter.prototype.imageId = function (source) {
        var existing = this.images.get(source);

        if (existing) {
            return existing;
        }

        var id = "__image" + this.images.size;

        this.images.set(source, id);

        var url = this.imageURL(source);

        if (!url) {
            this.decls.push(
                "var " + id + " = null; /* image unavailable */"
            );

            this.warnings.push(
                "an image source could not be serialized"
            );

            return id;
        }

        this.needsLoad = true;

        this.decls.push(
            "var " + id + " = await __load(" +
            JSON.stringify(url) + ");"
        );

        return id;
    };


    /*
     * Turn any canvas image source into something the generated code can
     * load: a data URL when the pixels are readable, otherwise the
     * original absolute URL.
     */
    Emitter.prototype.imageURL = function (source) {
        if (HAS_DOM && source instanceof HTMLImageElement) {
            var src = source.currentSrc || source.src || "";

            /* Already self-contained (this is how SVG sprites arrive). */
            if (src.indexOf("data:") === 0) {
                return src;
            }

            var rasterized = this.rasterize(source);

            if (rasterized) {
                return rasterized;
            }

            /* Blob URLs die with the page, so they are a last resort. */
            return absoluteURL(src);
        }

        var direct = this.rasterize(source);

        if (direct) {
            return direct;
        }

        if (HAS_DOM &&
            typeof SVGImageElement !== "undefined" &&
            source instanceof SVGImageElement) {
            return absoluteURL(
                source.href ? source.href.baseVal : ""
            );
        }

        return null;
    };


    Emitter.prototype.rasterize = function (source) {
        if (!HAS_DOM) {
            return null;
        }

        var size = sourceSize(source);

        if (!size.width || !size.height) {
            return null;
        }

        try {
            /* A canvas can hand over its pixels directly. */
            if (source instanceof HTMLCanvasElement &&
                typeof source.toDataURL === "function") {
                return source.toDataURL("image/png");
            }

            var scratch = scratchCanvas(size.width, size.height);

            scratch.ctx.drawImage(source, 0, 0);

            return scratch.canvas.toDataURL("image/png");
        } catch (error) {
            /* Tainted by a cross-origin source. */
            return null;
        }
    };


    /*
     * ----------------------------------------------------------
     * Nested canvases
     * ----------------------------------------------------------
     *
     * drawImage(otherCanvas, ...) used to be inlined once per call,
     * which duplicated an entire sprite atlas for every blit. Each
     * source canvas is now emitted once as a function.
     * ----------------------------------------------------------
     */

    Emitter.prototype.canvasFn = function (key, frame) {
        var existing = this.canvasFns.get(key);

        if (existing) {
            return existing;
        }

        var id = "__canvas" + this.canvasFns.size;

        this.canvasFns.set(key, id);

        var lines = [];

        this.needsReset = true;

        lines.push("function " + id + "(ctx) {");
        lines.push("var __base = ctx.getTransform();");
        lines.push("__reset(ctx);");

        /*
         * The source canvas had its own current path. Starting fresh
         * stops these commands from extending whatever the caller was
         * building, which would fill a wedge back to the caller's
         * points.
         */
        lines.push("ctx.beginPath();");

        /*
         * This runs in the middle of the caller's command stream, so the
         * caller's shadow state and mode have to survive it.
         */
        var outerStack = this.stack;
        var outerRelative = this.relative;

        this.relative = true;
        this.emitting.add(key);

        this.emitState(lines, frame.state, frame.minDepth);
        this.emitCommands(lines, frame.commands);

        this.emitting.delete(key);
        this.stack = outerStack;
        this.relative = outerRelative;

        /*
         * Unwind back to the depth this function was entered at. A
         * save() the source never restored would otherwise leave its
         * clip and state applied to everything the caller draws next.
         */
        var open =
            (frame.minDepth < 0 ? -frame.minDepth : 0) +
            (frame.depth || 0);

        for (var u = 0; u < open; u++) {
            lines.push("ctx.restore();");
        }

        lines.push("}");

        this.decls.push(lines.join("\n"));

        return id;
    };


    Emitter.prototype.emitDrawCanvas =
        function (lines, capture, args, key, frame) {

        var width = capture.width();
        var height = capture.height();

        var sx = 0;
        var sy = 0;
        var sw = width;
        var sh = height;

        var dx;
        var dy;
        var dw;
        var dh;

        if (args.length === 2) {
            dx = args[0];
            dy = args[1];
            dw = sw;
            dh = sh;
        } else if (args.length === 4) {
            dx = args[0];
            dy = args[1];
            dw = args[2];
            dh = args[3];
        } else if (args.length === 8) {
            sx = args[0];
            sy = args[1];
            sw = args[2];
            sh = args[3];

            dx = args[4];
            dy = args[5];
            dw = args[6];
            dh = args[7];
        } else {
            return false;
        }

        if (!sw || !sh) {
            return false;
        }

        var id = this.canvasFn(key, frame);

        lines.push("ctx.save();");

        lines.push(
            "ctx.translate(" +
            this.num(dx) + ", " + this.num(dy) + ");"
        );

        lines.push(
            "ctx.scale(" +
            this.num(dw / sw) + ", " + this.num(dh / sh) + ");"
        );

        /*
         * clip() on the current path would discard whatever the caller
         * had built; the Path2D overload leaves it alone.
         */
        lines.push("ctx.clip(" + this.clipId(sw, sh) + ");");

        lines.push(
            "ctx.translate(" +
            this.num(-sx) + ", " + this.num(-sy) + ");"
        );

        lines.push(id + "(ctx);");
        lines.push("ctx.restore();");

        return true;
    };


    /* Stable short name for a capture within one emit. */
    Emitter.prototype.captureKey = function (capture) {
        var existing = this.captureIds.get(capture);

        if (existing === undefined) {
            existing = this.captureIds.size;
            this.captureIds.set(capture, existing);
        }

        return "c" + existing;
    };


    /* A reusable rectangle path for source-rectangle clipping. */
    Emitter.prototype.clipId = function (width, height) {
        var key = width + "x" + height;

        var existing = this.clips.get(key);

        if (existing) {
            return existing;
        }

        var id = "__clip" + this.clips.size;

        this.clips.set(key, id);

        this.decls.push(
            "var " + id + " = new Path2D();\n" +
            id + ".rect(0, 0, " +
            this.num(width) + ", " + this.num(height) + ");"
        );

        return id;
    };


    /*
     * ----------------------------------------------------------
     * Shadow state (redundant-write removal)
     * ----------------------------------------------------------
     */

    Emitter.prototype.pushState = function () {
        var top = this.stack[this.stack.length - 1];

        this.stack.push(Object.assign({}, top));
    };


    Emitter.prototype.popState = function () {
        if (this.stack.length > 1) {
            this.stack.pop();
        }
    };


    Emitter.prototype.setState = function (name, text) {
        var top = this.stack[this.stack.length - 1];

        if (!top) {
            return true;
        }

        if (options.dedupeState && top[name] === text) {
            return false;
        }

        top[name] = text;

        return true;
    };


    /*
     * ----------------------------------------------------------
     * Frame prologue
     * ----------------------------------------------------------
     */

    Emitter.prototype.emitState = function (lines, state, minDepth) {
        var base = {};

        /*
         * A frame can restore more often than it saves - the matching
         * save() happened before the frame started. Balance it with
         * extra saves so the replay cannot underflow.
         */
        var extra = minDepth < 0 ? -minDepth : 0;

        for (var i = 0; i < extra; i++) {
            lines.push("ctx.save();");
        }

        if (state) {
            if (state.transform &&
                !isIdentity(state.transform)) {
                lines.push(this.setTransformLine(state.transform));
            }

            var names = Object.keys(state.props);

            for (var j = 0; j < names.length; j++) {
                var name = names[j];
                var text = this.format(state.props[name]);

                base[name] = text;

                if (text === "undefined") {
                    continue;
                }

                if (Object.prototype.hasOwnProperty.call(
                        DEFAULT_STATE, name) &&
                    text === this.format(DEFAULT_STATE[name])) {
                    continue;
                }

                lines.push("ctx." + name + " = " + text + ";");
            }

            if (state.lineDash && state.lineDash.length) {
                lines.push(
                    "ctx.setLineDash([" +
                    state.lineDash.map(function (n) {
                        return this.num(n);
                    }, this).join(", ") +
                    "]);"
                );
            }
        }

        this.stack = [base];

        for (var k = 0; k < extra; k++) {
            this.pushState();
        }
    };


    /*
     * setTransform() replaces the matrix outright, which would throw
     * away the placement a nested canvas helper was called with. In
     * relative mode it is composed onto the base instead.
     */
    Emitter.prototype.setTransformLine = function (values) {
        if (!this.relative) {
            var emitter = this;

            return (
                "ctx.setTransform(" +
                values.map(function (n) {
                    return emitter.num(n);
                }).join(", ") +
                ");"
            );
        }

        return (
            "ctx.setTransform(__base.multiply(" +
            this.matrixLiteral(values) + "));"
        );
    };


    function isIdentity(m) {
        return (
            m[0] === 1 && m[1] === 0 && m[2] === 0 &&
            m[3] === 1 && m[4] === 0 && m[5] === 0
        );
    }


    /*
     * ----------------------------------------------------------
     * Commands
     * ----------------------------------------------------------
     */

    Emitter.prototype.emitCommands = function (lines, commands) {

        for (var i = 0; i < commands.length; i++) {
            var command = commands[i];

            if (command.type === "set") {
                var text = this.format(command.value);

                if (text === "undefined") {
                    this.warnings.push(
                        "ctx." + command.name +
                        " was set to a value that could not be encoded"
                    );

                    continue;
                }

                if (!this.setState(command.name, text)) {
                    continue;
                }

                lines.push(
                    "ctx." + command.name + " = " + text + ";"
                );

                continue;
            }

            if (command.type === "image") {
                this.emitImageCommand(lines, command);
                continue;
            }

            if (command.type !== "call") {
                continue;
            }

            if (command.name === "save") {
                this.pushState();
            } else if (command.name === "restore") {
                this.popState();
            } else if (this.relative &&
                command.name === "resetTransform") {
                lines.push("ctx.setTransform(__base);");
                continue;
            } else if (this.relative &&
                command.name === "setTransform") {
                lines.push(
                    this.relativeSetTransform(command.args)
                );

                continue;
            }

            var args = new Array(command.args.length);

            for (var j = 0; j < command.args.length; j++) {
                args[j] = this.format(command.args[j]);
            }

            lines.push(
                "ctx." + command.name +
                "(" + args.join(", ") + ");"
            );
        }
    };


    /*
     * setTransform accepts six numbers or a single matrix.
     */
    Emitter.prototype.relativeSetTransform = function (args) {
        if (args.length >= 6) {
            var numbers = [];

            for (var i = 0; i < 6; i++) {
                numbers.push(
                    typeof args[i] === "number" ? args[i] : 0
                );
            }

            return this.setTransformLine(numbers);
        }

        if (args.length === 1 && args[0] && args[0].cc === "matrix") {
            return this.setTransformLine(args[0].value);
        }

        /* Anything else (a DOMMatrix-like object) is passed through. */
        return (
            "ctx.setTransform(__base.multiply(new DOMMatrix(" +
            (args.length ? this.format(args[0]) : "") +
            ")));"
        );
    };


    Emitter.prototype.emitImageCommand = function (lines, command) {
        var source = command.source;

        var sourceCapture = captures.get(source);

        if (options.inlineCanvases &&
            sourceCapture &&
            command.srcEpoch >= 0) {

            var key = this.captureKey(sourceCapture) +
                ":" + command.srcEpoch + ":" + command.srcLength;

            /*
             * A prefix of a canvas can include a blit of an earlier
             * prefix of itself, which terminates. This guard only
             * catches a pathological exact cycle.
             */
            if (!this.emitting.has(key)) {
                var frame =
                    sourceCapture.bufferAt(
                        command.srcEpoch,
                        command.srcLength
                    );

                if (frame && frame.commands.length &&
                    this.emitDrawCanvas(
                        lines, sourceCapture, command.args, key, frame
                    )) {
                    return;
                }

                if (!frame) {
                    /*
                     * The buffer this blit referred to has been evicted,
                     * so only the canvas's present pixels are left - which
                     * may be a later redraw of a shared scratch buffer.
                     */
                    this.warnings.push(
                        "a blit referred to canvas content that was no " +
                        "longer retained; its current pixels were used " +
                        "instead (raise CanvasCapture.options.maxHistory)"
                    );
                }
            }
        }

        var id = this.imageId(source);

        var args = command.args.map(function (arg) {
            return this.num(arg);
        }, this);

        lines.push(
            "if (" + id + ") { ctx.drawImage(" +
            [id].concat(args).join(", ") +
            "); }"
        );
    };


    /*
     * ----------------------------------------------------------
     * SVG overlays
     * ----------------------------------------------------------
     *
     * The old version only kept SVGs painted *behind* the canvas and
     * dropped everything else. Both layers are captured now, in paint
     * order, and coordinates are converted from CSS pixels to backing
     * store pixels so a device-pixel-ratio canvas lines up.
     * ----------------------------------------------------------
     */

    var SVG_STYLE_PROPS = [
        "fill", "fill-opacity", "fill-rule",
        "stroke", "stroke-width", "stroke-opacity",
        "stroke-linecap", "stroke-linejoin",
        "stroke-dasharray", "stroke-dashoffset",
        "opacity", "color", "display", "visibility",
        "font-family", "font-size", "font-weight", "font-style",
        "text-anchor", "dominant-baseline", "letter-spacing",
        "paint-order", "mix-blend-mode",
        "stop-color", "stop-opacity",
        "marker-start", "marker-mid", "marker-end",
        "clip-path", "mask", "filter",
        "transform", "transform-origin"
    ];


    function stackingKey(element, order) {
        var style = getComputedStyle(element);

        var z = parseInt(style.zIndex, 10);

        return {
            z: Number.isNaN(z) ? 0 : z,
            order: order
        };
    }


    /*
     * "none" is the default for most of these, but not for paint -
     * dropping `fill: none` would flood an outline-only shape black.
     */
    var KEEP_NONE = {
        "fill": true,
        "stroke": true,
        "display": true
    };


    function inlineComputedStyles(original, clone, budget) {
        var sourceNodes = [original];
        var cloneNodes = [clone];

        var used = 0;

        while (sourceNodes.length && used < budget) {
            var source = sourceNodes.pop();
            var target = cloneNodes.pop();

            if (!source || !target ||
                source.nodeType !== 1 ||
                target.nodeType !== 1) {
                continue;
            }

            used += 1;

            var computed = getComputedStyle(source);
            var declarations = "";

            for (var i = 0; i < SVG_STYLE_PROPS.length; i++) {
                var name = SVG_STYLE_PROPS[i];
                var value = computed.getPropertyValue(name);

                if (!value ||
                    (value === "none" && !KEEP_NONE[name])) {
                    continue;
                }

                declarations += name + ":" + value + ";";
            }

            if (declarations) {
                var existingStyle =
                    target.getAttribute("style") || "";

                target.setAttribute(
                    "style",
                    declarations + existingStyle
                );
            }

            var sourceChildren = source.children;
            var cloneChildren = target.children;

            var count =
                Math.min(sourceChildren.length, cloneChildren.length);

            for (var c = 0; c < count; c++) {
                sourceNodes.push(sourceChildren[c]);
                cloneNodes.push(cloneChildren[c]);
            }
        }
    }


    /*
     * `rect` is the on-page (CSS pixel) box, `width`/`height` are the
     * backing-store pixels the image is drawn at. Giving the standalone
     * SVG that intrinsic size makes the browser rasterize it at the
     * destination resolution instead of upscaling a CSS-sized bitmap.
     */
    function serializeSVG(svg, rect, width, height) {
        var clone = svg.cloneNode(true);

        if (!clone.getAttribute("xmlns")) {
            clone.setAttribute(
                "xmlns",
                "http://www.w3.org/2000/svg"
            );
        }

        if (!clone.getAttribute("xmlns:xlink")) {
            clone.setAttribute(
                "xmlns:xlink",
                "http://www.w3.org/1999/xlink"
            );
        }

        /*
         * A standalone SVG image has no CSS box to size it, so the
         * layout size becomes the intrinsic size. Without a viewBox the
         * user units are already the CSS pixels, so one is added.
         */
        if (!clone.getAttribute("viewBox")) {
            clone.setAttribute(
                "viewBox",
                "0 0 " + rect.width + " " + rect.height
            );
        }

        clone.setAttribute("width", width);
        clone.setAttribute("height", height);

        if (options.inlineSvgStyles) {
            try {
                inlineComputedStyles(
                    svg,
                    clone,
                    options.maxSvgNodes
                );
            } catch (error) {
                /* keep the unstyled markup rather than nothing */
            }
        }

        return new XMLSerializer().serializeToString(clone);
    }


    CanvasCapture.prototype.captureSVGs = function () {
        if (!HAS_DOM ||
            !options.captureSvg ||
            !this.canvas.getBoundingClientRect) {
            return { below: [], above: [] };
        }

        var canvasRect = this.canvas.getBoundingClientRect();

        if (!canvasRect.width || !canvasRect.height) {
            return { below: [], above: [] };
        }

        /* CSS pixels -> backing store pixels */
        var scaleX = this.width() / canvasRect.width;
        var scaleY = this.height() / canvasRect.height;

        var all =
            Array.prototype.slice.call(
                document.querySelectorAll("svg")
            );

        var order = 0;

        var canvasKey = stackingKey(this.canvas, 0);

        /* Document order decides who paints last within one z-index. */
        var nodes = [];

        var walker =
            document.createTreeWalker(
                document.documentElement,
                NodeFilter.SHOW_ELEMENT,
                null
            );

        var indexes = new Map();

        var node = document.documentElement;

        while (node) {
            indexes.set(node, order);
            order += 1;
            node = walker.nextNode();
        }

        canvasKey.order = indexes.get(this.canvas) || 0;

        for (var i = 0; i < all.length; i++) {
            var svg = all[i];

            /* Nested <svg> is drawn by its root. */
            if (svg.ownerSVGElement) {
                continue;
            }

            var rect = svg.getBoundingClientRect();

            if (!rect.width || !rect.height) {
                continue;
            }

            if (rect.right <= canvasRect.left ||
                rect.left >= canvasRect.right ||
                rect.bottom <= canvasRect.top ||
                rect.top >= canvasRect.bottom) {
                continue;
            }

            var style = getComputedStyle(svg);

            if (style.display === "none" ||
                style.visibility === "hidden" ||
                parseFloat(style.opacity) === 0) {
                continue;
            }

            var key = stackingKey(svg, indexes.get(svg) || 0);

            nodes.push({
                element: svg,
                rect: rect,
                key: key,

                x: (rect.left - canvasRect.left) * scaleX,
                y: (rect.top - canvasRect.top) * scaleY,
                width: rect.width * scaleX,
                height: rect.height * scaleY
            });
        }

        nodes.sort(function (a, b) {
            if (a.key.z !== b.key.z) {
                return a.key.z - b.key.z;
            }

            return a.key.order - b.key.order;
        });

        var below = [];
        var above = [];

        nodes.forEach(function (entry) {
            var isAbove =
                entry.key.z !== canvasKey.z
                    ? entry.key.z > canvasKey.z
                    : entry.key.order > canvasKey.order;

            (isAbove ? above : below).push(entry);
        });

        return { below: below, above: above };
    };


    Emitter.prototype.emitSVGLayer =
        function (lines, layer, label, prefix) {

        if (!layer.length) {
            return;
        }

        lines.push("/* " + label + " */");

        for (var i = 0; i < layer.length; i++) {
            var entry = layer[i];

            var markup;

            try {
                markup = serializeSVG(
                    entry.element,
                    entry.rect,
                    entry.width,
                    entry.height
                );
            } catch (error) {
                this.warnings.push(
                    "an <svg> element could not be serialized"
                );

                continue;
            }

            var url =
                "data:image/svg+xml;charset=utf-8," +
                encodeURIComponent(markup);

            var id = "__svg_" + prefix + i;

            this.needsLoad = true;

            this.decls.push(
                "var " + id + " = await __load(" +
                JSON.stringify(url) + ");"
            );

            lines.push("ctx.save();");
            lines.push("ctx.setTransform(1, 0, 0, 1, 0, 0);");

            lines.push(
                "if (" + id + ") { ctx.drawImage(" + id + ", " +
                this.num(entry.x) + ", " +
                this.num(entry.y) + ", " +
                this.num(entry.width) + ", " +
                this.num(entry.height) +
                "); }"
            );

            lines.push("ctx.restore();");
        }

        lines.push("");
    };


    /*
     * ----------------------------------------------------------
     * Output
     * ----------------------------------------------------------
     */

    /*
     * An on-screen canvas is cut at every rAF tick, so the last closed
     * buffer is the last *complete* frame and the open one is a partial
     * frame in progress.
     *
     * A detached canvas (a sprite atlas) is only cut when it is cleared,
     * so the open buffer is its current content and the closed one is
     * what it used to hold.
     */
    CanvasCapture.prototype.bestFrame = function () {
        var closed = {
            commands: this.frame || [],
            state: this.frameState,
            minDepth: this.frameMinDepth,
            depth: this.frameDepth,
            truncated: this.frameTruncated,
            complete: true
        };

        var open = {
            commands: this.commands,
            state: this.state,
            minDepth: this.minDepth,
            depth: this.depth,
            truncated: this.truncated,
            complete: false
        };

        if (this.isLive()) {
            return closed.commands.length ? closed : open;
        }

        return open.commands.length ? open : closed;
    };


    CanvasCapture.prototype.output = function (overrides) {
        var saved = null;

        if (overrides) {
            saved = Object.assign({}, options);
            Object.assign(options, overrides);
        }

        try {
            return this.build();
        } finally {
            if (saved) {
                Object.assign(options, saved);
            }
        }
    };


    CanvasCapture.prototype.build = function () {
        var emitter = new Emitter(this);

        var frame = this.bestFrame();

        var svgs = this.captureSVGs();

        var body = [];

        emitter.emitSVGLayer(
            body, svgs.below, "svg behind canvas", "below"
        );

        emitter.emitState(body, frame.state, frame.minDepth);
        emitter.emitCommands(body, frame.commands);

        emitter.emitSVGLayer(
            body, svgs.above, "svg above canvas", "above"
        );

        var header = [];

        header.push(
            "/*"
        );

        header.push(
            "    CanvasCapture - " +
            this.width() + "x" + this.height() +
            ", " + frame.commands.length + " commands" +
            (frame.complete
                ? " (frame " + this.frameCount + ")"
                : " (partial frame)")
        );

        header.push(
            "    Run inside an async function; `ctx` is required, " +
            "`canvas` is optional."
        );

        if (frame.truncated) {
            header.push(
                "    WARNING: the command limit was hit, " +
                "this frame is truncated."
            );
        }

        uniqueWarnings(emitter.warnings).forEach(function (warning) {
            header.push("    WARNING: " + warning);
        });

        header.push("*/");
        header.push("");

        var helpers = [];

        if (emitter.needsLoad) {
            helpers.push(
                "async function __load(src) {\n" +
                "    var image = new Image();\n" +
                "    image.src = src;\n" +
                "    if (image.decode) {\n" +
                "        try { await image.decode(); return image; }\n" +
                "        catch (error) { /* fall through */ }\n" +
                "    }\n" +
                "    await new Promise(function (resolve) {\n" +
                "        image.onload = resolve;\n" +
                "        image.onerror = resolve;\n" +
                "    });\n" +
                "    return image.complete && image.naturalWidth" +
                " ? image : null;\n" +
                "}"
            );
        }

        if (emitter.needsBytes) {
            helpers.push(
                "function __bytes(base64) {\n" +
                "    var binary = atob(base64);\n" +
                "    var out = new Uint8ClampedArray(binary.length);\n" +
                "    for (var i = 0; i < binary.length; i++) {\n" +
                "        out[i] = binary.charCodeAt(i);\n" +
                "    }\n" +
                "    return out;\n" +
                "}"
            );
        }

        if (emitter.needsReset) {
            helpers.push(
                "function __reset(ctx) {\n" +
                "    ctx.globalAlpha = 1;\n" +
                "    ctx.globalCompositeOperation = \"source-over\";\n" +
                "    ctx.fillStyle = \"#000000\";\n" +
                "    ctx.strokeStyle = \"#000000\";\n" +
                "    ctx.lineWidth = 1;\n" +
                "    ctx.lineCap = \"butt\";\n" +
                "    ctx.lineJoin = \"miter\";\n" +
                "    ctx.miterLimit = 10;\n" +
                "    ctx.lineDashOffset = 0;\n" +
                "    ctx.setLineDash([]);\n" +
                "    ctx.shadowBlur = 0;\n" +
                "    ctx.shadowColor = \"rgba(0, 0, 0, 0)\";\n" +
                "    ctx.shadowOffsetX = 0;\n" +
                "    ctx.shadowOffsetY = 0;\n" +
                "    ctx.font = \"10px sans-serif\";\n" +
                "    ctx.textAlign = \"start\";\n" +
                "    ctx.textBaseline = \"alphabetic\";\n" +
                "    ctx.filter = \"none\";\n" +
                "    ctx.imageSmoothingEnabled = true;\n" +
                "}"
            );
        }

        var size = [
            "if (typeof canvas !== \"undefined\" && canvas) {",
            "    canvas.width = " + this.width() + ";",
            "    canvas.height = " + this.height() + ";",
            "}",
            ""
        ];

        var out = header
            .concat(helpers.length ? helpers.concat([""]) : [])
            .concat(size)
            .concat(emitter.decls.length
                ? emitter.decls.concat([""])
                : [])
            .concat(body);

        return out.join("\n");
    };


    function uniqueWarnings(list) {
        var seen = Object.create(null);
        var out = [];

        list.forEach(function (warning) {
            if (seen[warning]) {
                return;
            }

            seen[warning] = true;

            out.push(warning);
        });

        return out.slice(0, 10);
    }


    CanvasCapture.prototype.print = function () {
        console.log(this.output());
    };


    CanvasCapture.prototype.clear = function () {
        this.commands.length = 0;
        this.frame = null;
    };


    /*
     * ----------------------------------------------------------
     * Static helpers
     * ----------------------------------------------------------
     */

    CanvasCapture.install = install;

    CanvasCapture.options = options;

    CanvasCapture.get = function (canvas) {
        return captures.get(canvas);
    };


    CanvasCapture.pause = function () {
        enabled = false;
    };


    CanvasCapture.resume = function () {
        enabled = true;
    };


    /*
     * The busiest on-screen canvas, which for a single-canvas game is
     * simply the game.
     */
    CanvasCapture.main = function () {
        var best = null;
        var bestScore = null;

        eachCapture(function (capture) {
            if (!capture.isLive()) {
                return;
            }

            if (!capture.frame && !capture.commands.length) {
                return;
            }

            /*
             * A canvas that has produced many frames is the animated
             * one; area only breaks ties between equally busy canvases.
             */
            var score = [
                capture.frameCount,
                capture.width() * capture.height()
            ];

            if (!bestScore ||
                score[0] > bestScore[0] ||
                (score[0] === bestScore[0] && score[1] > bestScore[1])) {
                bestScore = score;
                best = capture;
            }
        });

        return best;
    };


    function resolve(target) {
        if (target instanceof CanvasCapture) {
            return target;
        }

        if (target) {
            return captures.get(target) || new CanvasCapture(target);
        }

        var main = CanvasCapture.main();

        if (!main) {
            throw new Error(
                "CanvasCapture found no canvas with recorded commands. " +
                "Load the script before the page draws, or call " +
                "CanvasCapture.next() to wait for a frame."
            );
        }

        return main;
    }


    CanvasCapture.output = function (target, overrides) {
        return resolve(target).output(overrides);
    };


    CanvasCapture.print = function (target) {
        console.log(CanvasCapture.output(target));
        return undefined;
    };


    /* Wait for the current frame to finish, then emit it. */
    CanvasCapture.next = function (target) {
        var capture = resolve(target);

        return new Promise(function (resolve) {
            capture.pending.push(resolve);
        });
    };


    CanvasCapture.copy = function (target) {
        var code = CanvasCapture.output(target);

        return CanvasCapture.toClipboard(code);
    };


    CanvasCapture.copyNext = function (target) {
        return CanvasCapture.next(target).then(function (code) {
            return CanvasCapture.toClipboard(code);
        });
    };


    CanvasCapture.toClipboard = function (code) {
        if (GLOBAL.navigator &&
            GLOBAL.navigator.clipboard &&
            GLOBAL.navigator.clipboard.writeText) {

            return GLOBAL.navigator.clipboard
                .writeText(code)
                .then(function () {
                    console.log(
                        "[CanvasCapture] copied " +
                        code.length + " chars"
                    );

                    return code;
                })
                .catch(function (error) {
                    console.warn(
                        "[CanvasCapture] clipboard blocked, " +
                        "logging instead",
                        error
                    );

                    console.log(code);

                    return code;
                });
        }

        console.log(code);

        return Promise.resolve(code);
    };


    /*
     * Capture on load so contexts created afterwards - and the ones
     * created before, through the prototype patch - are all recorded.
     */
    if (HAS_DOM) {
        install();
    }

    GLOBAL.CanvasCapture = CanvasCapture;

    return CanvasCapture;
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = CanvasCapture;
}
