"use strict";
/**
 * Express-compatible shim layered over uWebSockets.js.
 *
 * Exposes the slice of the Express API the codebase actually uses
 * (app.use, app.get/post/delete, req.body/query/params/headers, res.status/json/send/sendFile/sendStatus/setHeader/header)
 * so existing route handlers in server.ts, crossServer.ts, and apiKeyApi.ts
 * keep working unchanged.
 *
 * Why a shim instead of porting each route to uWS natively: the route
 * handlers use Express's req/res shape extensively; rewriting them all
 * loses no perf in practice (HTTP routes are low-traffic vs. the WebSocket
 * hot path) and keeps the diff tractable.
 *
 * Architecture: a single uWS `app.any('/*', dispatcher)` catches everything;
 * the dispatcher runs registered middleware + the matching route's handler
 * chain. Route patterns are matched with our own compiled regex (supports
 * Express-style `:param` segments) rather than uWS's native router so
 * middleware and routes share one dispatch path.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UApp = void 0;
exports.staticFiles = staticFiles;
exports.jsonParser = jsonParser;
exports.createApp = createApp;
const uWebSockets_js_1 = __importDefault(require("uWebSockets.js"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const STATUS_TEXT = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
};
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.wasm': 'application/wasm',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.zip': 'application/zip',
};
function lookupMime(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}
function compilePath(pattern) {
    const keys = [];
    // Escape regex specials, except for the `:param` segments we want to
    // treat specially below. We pre-mark them, escape everything else,
    // then unmark + substitute.
    const PARAM_MARK = '\x01';
    let marked = pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => {
        keys.push(name);
        return PARAM_MARK;
    });
    marked = marked.replace(/[.+*?^$()[\]{}|\\]/g, '\\$&');
    const regexStr = marked.replace(new RegExp(PARAM_MARK, 'g'), '([^/]+)');
    const re = new RegExp('^' + regexStr + '$');
    return {
        test(url) {
            const m = re.exec(url);
            if (!m)
                return null;
            const params = {};
            for (let i = 0; i < keys.length; i++) {
                try {
                    params[keys[i]] = decodeURIComponent(m[i + 1]);
                }
                catch {
                    params[keys[i]] = m[i + 1];
                }
            }
            return params;
        }
    };
}
function parseQuery(qs) {
    const result = {};
    if (!qs)
        return result;
    for (const part of qs.split('&')) {
        if (!part)
            continue;
        const eq = part.indexOf('=');
        const rawKey = eq < 0 ? part : part.slice(0, eq);
        const rawVal = eq < 0 ? '' : part.slice(eq + 1);
        try {
            result[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal.replace(/\+/g, ' '));
        }
        catch {
            result[rawKey] = rawVal;
        }
    }
    return result;
}
function statusLine(code) {
    return `${code} ${STATUS_TEXT[code] || ''}`.trim();
}
function createResponse(uRes, aborted) {
    let statusCode = 200;
    const headers = {};
    let ended = false;
    const flush = (body) => {
        if (ended || aborted.value)
            return;
        ended = true;
        uRes.cork(() => {
            if (aborted.value)
                return;
            uRes.writeStatus(statusLine(statusCode));
            for (const k of Object.keys(headers)) {
                uRes.writeHeader(k, headers[k]);
            }
            if (body === undefined || body === null) {
                uRes.end();
            }
            else if (Buffer.isBuffer(body)) {
                uRes.end(body);
            }
            else {
                uRes.end(String(body));
            }
        });
    };
    const api = {
        get headersSent() { return ended; },
        status(code) { statusCode = code; return api; },
        sendStatus(code) {
            statusCode = code;
            if (!headers['Content-Type'])
                headers['Content-Type'] = 'text/plain; charset=utf-8';
            flush(STATUS_TEXT[code] || String(code));
            return api;
        },
        json(body) {
            headers['Content-Type'] = 'application/json';
            flush(JSON.stringify(body));
            return api;
        },
        send(body) {
            if (body === undefined || body === null) {
                flush();
            }
            else if (Buffer.isBuffer(body)) {
                if (!headers['Content-Type'])
                    headers['Content-Type'] = 'application/octet-stream';
                flush(body);
            }
            else if (typeof body === 'object') {
                return api.json(body);
            }
            else {
                if (!headers['Content-Type'])
                    headers['Content-Type'] = 'text/html; charset=utf-8';
                flush(String(body));
            }
            return api;
        },
        sendFile(absPath) {
            try {
                const stat = fs_1.default.statSync(absPath);
                if (!stat.isFile())
                    throw new Error('not a file');
                const buf = fs_1.default.readFileSync(absPath);
                if (!headers['Content-Type'])
                    headers['Content-Type'] = lookupMime(absPath);
                flush(buf);
            }
            catch {
                statusCode = 404;
                if (!headers['Content-Type'])
                    headers['Content-Type'] = 'text/plain; charset=utf-8';
                flush('Not Found');
            }
            return api;
        },
        header(name, value) { headers[name] = value; return api; },
        setHeader(name, value) { headers[name] = value; return api; },
        end(body) { flush(body); return api; },
        write(body) {
            // Express semantics would buffer, then end on .end(). For simplicity
            // (and because the codebase never chains .write() + .end()), treat
            // .write() as a one-shot terminal flush.
            flush(body);
            return api;
        }
    };
    return api;
}
/**
 * Build a middleware that serves files out of `root`. If `root` is a file path
 * (the codebase does this for /favicon.ico), serve that one file when matched.
 */
function staticFiles(root, opts = {}) {
    let rootIsFile = false;
    try {
        rootIsFile = fs_1.default.statSync(root).isFile();
    }
    catch { /* dir or missing */ }
    return (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD')
            return next();
        if (rootIsFile) {
            try {
                const stat = fs_1.default.statSync(root);
                if (!stat.isFile())
                    return next();
                const buf = fs_1.default.readFileSync(root);
                res.setHeader('Content-Type', lookupMime(root));
                if (opts.setHeaders)
                    opts.setHeaders(res, root);
                res.end(buf);
            }
            catch {
                return next();
            }
            return;
        }
        // For a directory mount, `req.path` is relative to the mount point —
        // the middleware dispatcher rewrites it before calling us.
        let relPath = req.path;
        if (relPath === '/' || relPath === '') {
            if (opts.index === false)
                return next();
            relPath = '/' + (opts.index || 'index.html');
        }
        // Strip query, normalize, block traversal.
        const safe = path_1.default.posix.normalize(relPath);
        if (safe.includes('..'))
            return next();
        const filePath = path_1.default.join(root, safe);
        if (!filePath.startsWith(root))
            return next();
        let stat;
        try {
            stat = fs_1.default.statSync(filePath);
        }
        catch {
            return next();
        }
        if (stat.isDirectory()) {
            if (opts.index === false)
                return next();
            const idxPath = path_1.default.join(filePath, opts.index || 'index.html');
            try {
                const idxStat = fs_1.default.statSync(idxPath);
                if (!idxStat.isFile())
                    return next();
                const buf = fs_1.default.readFileSync(idxPath);
                res.setHeader('Content-Type', lookupMime(idxPath));
                if (opts.setHeaders)
                    opts.setHeaders(res, idxPath);
                res.end(buf);
            }
            catch {
                return next();
            }
            return;
        }
        if (!stat.isFile())
            return next();
        const buf = fs_1.default.readFileSync(filePath);
        res.setHeader('Content-Type', lookupMime(filePath));
        if (opts.setHeaders)
            opts.setHeaders(res, filePath);
        res.end(buf);
    };
}
/** No-op JSON parser — body parsing is built into the dispatcher. Exposed so
 *  callers writing `app.use(express.json())` keep compiling. */
function jsonParser() {
    return (_req, _res, next) => next();
}
class UApp {
    constructor(uwsApp) {
        this.middlewares = [];
        this.routes = [];
        this.uwsApp = uwsApp;
    }
    /** Express-style `app.use(mw)` or `app.use(pathPrefix, mw)`. */
    use(pathOrMw, mw) {
        if (typeof pathOrMw === 'function') {
            this.middlewares.push({ handler: pathOrMw });
        }
        else if (typeof pathOrMw === 'string' && typeof mw === 'function') {
            this.middlewares.push({ pathPrefix: pathOrMw, handler: mw });
        }
        return this;
    }
    get(pattern, ...handlers) {
        this.routes.push({ method: 'GET', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    post(pattern, ...handlers) {
        this.routes.push({ method: 'POST', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    put(pattern, ...handlers) {
        this.routes.push({ method: 'PUT', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    delete(pattern, ...handlers) {
        this.routes.push({ method: 'DELETE', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    patch(pattern, ...handlers) {
        this.routes.push({ method: 'PATCH', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    /** Register a WebSocket route on the underlying uWS app. */
    ws(pattern, behavior) {
        this.uwsApp.ws(pattern, behavior);
        return this;
    }
    /**
     * Start listening. Must be called *after* all routes and the WebSocket
     * route are registered, because we install the HTTP catch-all here.
     */
    listen(port, cb) {
        // Install the HTTP catch-all last so that any specific route registered
        // on the underlying uWS app (e.g. the WebSocket upgrade at /ws) takes
        // precedence.
        this.uwsApp.any('/*', this.dispatch.bind(this));
        this.uwsApp.listen(port, (token) => {
            if (cb)
                cb(!!token);
        });
        return this;
    }
    /** Underlying uWS HTTP dispatcher — entry point for every HTTP request. */
    dispatch(uRes, uReq) {
        // Capture all sync data from uReq BEFORE any async work — uWS
        // invalidates `req` after the handler yields.
        const method = uReq.getCaseSensitiveMethod().toUpperCase();
        const urlPath = uReq.getUrl();
        const qs = uReq.getQuery();
        const headers = {};
        uReq.forEach((k, v) => { headers[k.toLowerCase()] = v; });
        const aborted = { value: false };
        uRes.onAborted(() => { aborted.value = true; });
        const req = {
            method,
            url: qs ? `${urlPath}?${qs}` : urlPath,
            path: urlPath,
            originalUrl: qs ? `${urlPath}?${qs}` : urlPath,
            query: parseQuery(qs),
            params: {},
            headers,
            body: undefined,
            header(n) { return headers[n.toLowerCase()]; },
            get(n) { return headers[n.toLowerCase()]; }
        };
        const res = createResponse(uRes, aborted);
        const needsBody = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
        if (needsBody) {
            const chunks = [];
            uRes.onData((chunk, isLast) => {
                if (chunk.byteLength > 0)
                    chunks.push(Buffer.from(chunk));
                if (isLast) {
                    const raw = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
                    const ct = headers['content-type'] || '';
                    if (raw.length === 0) {
                        req.body = {};
                    }
                    else if (ct.includes('application/json')) {
                        try {
                            req.body = JSON.parse(raw.toString('utf-8'));
                        }
                        catch {
                            req.body = {};
                        }
                    }
                    else if (ct.includes('application/x-www-form-urlencoded')) {
                        req.body = parseQuery(raw.toString('utf-8'));
                    }
                    else {
                        req.body = raw;
                    }
                    this.runChain(req, res, aborted);
                }
            });
        }
        else {
            this.runChain(req, res, aborted);
        }
    }
    runChain(req, res, aborted) {
        // Build the ordered handler chain: applicable middlewares, then the
        // matching route's handlers. Preserves Express-style registration order.
        const chain = [];
        const origPath = req.path;
        for (const mw of this.middlewares) {
            if (mw.pathPrefix === undefined || mw.pathPrefix === '/' || mw.pathPrefix === '') {
                // Express-equivalent global middleware — runs on every request,
                // path is left untouched.
                chain.push(mw.handler);
            }
            else if (req.path === mw.pathPrefix || req.path.startsWith(mw.pathPrefix + '/')) {
                // Strip the mount prefix for the duration of this middleware,
                // matching Express's `app.use(path, mw)` semantics. Wrap the
                // handler so the next() restores req.path.
                const prefix = mw.pathPrefix;
                const handler = mw.handler;
                chain.push((r, s, next) => {
                    const saved = r.path;
                    r.path = saved.slice(prefix.length) || '/';
                    handler(r, s, (err) => { r.path = saved; next(err); });
                });
            }
        }
        let routeMatched = false;
        for (const route of this.routes) {
            if (route.method !== req.method)
                continue;
            const params = route.matcher.test(origPath);
            if (params) {
                req.params = params;
                for (const h of route.handlers)
                    chain.push(h);
                routeMatched = true;
                break;
            }
        }
        let i = 0;
        const next = (err) => {
            if (aborted.value)
                return;
            if (err) {
                if (!res.headersSent) {
                    console.error('[uws_app] middleware error:', err);
                    res.status(500).send('Internal Server Error');
                }
                return;
            }
            if (i >= chain.length) {
                if (!res.headersSent) {
                    if (routeMatched)
                        res.end();
                    else
                        res.status(404).send('Not Found');
                }
                return;
            }
            const handler = chain[i++];
            try {
                const ret = handler(req, res, next);
                if (ret && typeof ret.catch === 'function') {
                    ret.catch(e => {
                        if (!aborted.value && !res.headersSent) {
                            console.error('[uws_app] async handler error:', e);
                            res.status(500).send('Internal Server Error');
                        }
                    });
                }
            }
            catch (e) {
                if (!aborted.value && !res.headersSent) {
                    console.error('[uws_app] handler threw:', e);
                    res.status(500).send('Internal Server Error');
                }
            }
        };
        next();
    }
}
exports.UApp = UApp;
/** Build an SSLApp or App depending on whether cert/key files exist. */
function createApp(opts) {
    let uwsApp;
    if (opts?.ssl) {
        const appOpts = {
            key_file_name: opts.ssl.keyPath,
            cert_file_name: opts.ssl.certPath,
        };
        uwsApp = uWebSockets_js_1.default.SSLApp(appOpts);
    }
    else {
        uwsApp = uWebSockets_js_1.default.App();
    }
    return new UApp(uwsApp);
}
