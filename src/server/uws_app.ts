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

import uWS, { TemplatedApp, HttpRequest, HttpResponse, AppOptions, WebSocketBehavior } from 'uWebSockets.js';
import fs from 'fs';
import path from 'path';

export interface UReq {
    method: string;
    url: string;
    path: string;
    originalUrl: string;
    query: Record<string, string | undefined>;
    params: Record<string, string>;
    headers: Record<string, string>;
    body: any;
    header(name: string): string | undefined;
    get(name: string): string | undefined;
}

export interface UResponse {
    status(code: number): UResponse;
    sendStatus(code: number): UResponse;
    json(body: any): UResponse;
    send(body?: any): UResponse;
    sendFile(absPath: string): UResponse;
    header(name: string, value: string): UResponse;
    setHeader(name: string, value: string): UResponse;
    end(body?: string | Buffer): UResponse;
    write(body: string | Buffer): UResponse;
    readonly headersSent: boolean;
}

export type NextFunction = (err?: any) => void;
// Return type is `any` to match Express's RequestHandler, which lets handlers
// write `return res.status(400).json(...)` (a UResponse) for early-exit.
export type Handler = (req: UReq, res: UResponse, next: NextFunction) => any;

interface RouteEntry {
    method: string;
    pattern: string;
    matcher: PathMatcher;
    handlers: Handler[];
}

interface MiddlewareEntry {
    pathPrefix?: string;
    handler: Handler;
}

const STATUS_TEXT: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
};

const MIME_TYPES: Record<string, string> = {
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

function lookupMime(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

interface PathMatcher {
    test(url: string): Record<string, string> | null;
}

function compilePath(pattern: string): PathMatcher {
    const keys: string[] = [];
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
        test(url: string) {
            const m = re.exec(url);
            if (!m) return null;
            const params: Record<string, string> = {};
            for (let i = 0; i < keys.length; i++) {
                try { params[keys[i]] = decodeURIComponent(m[i + 1]); }
                catch { params[keys[i]] = m[i + 1]; }
            }
            return params;
        }
    };
}

function parseQuery(qs: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!qs) return result;
    for (const part of qs.split('&')) {
        if (!part) continue;
        const eq = part.indexOf('=');
        const rawKey = eq < 0 ? part : part.slice(0, eq);
        const rawVal = eq < 0 ? '' : part.slice(eq + 1);
        try {
            result[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal.replace(/\+/g, ' '));
        } catch {
            result[rawKey] = rawVal;
        }
    }
    return result;
}

function statusLine(code: number): string {
    return `${code} ${STATUS_TEXT[code] || ''}`.trim();
}

interface AbortedFlag { value: boolean; }

function createResponse(uRes: HttpResponse, aborted: AbortedFlag): UResponse {
    let statusCode = 200;
    const headers: Record<string, string> = {};
    let ended = false;

    const flush = (body?: string | Buffer) => {
        if (ended || aborted.value) return;
        ended = true;
        uRes.cork(() => {
            if (aborted.value) return;
            uRes.writeStatus(statusLine(statusCode));
            for (const k of Object.keys(headers)) {
                uRes.writeHeader(k, headers[k]);
            }
            if (body === undefined || body === null) {
                uRes.end();
            } else if (Buffer.isBuffer(body)) {
                uRes.end(body);
            } else {
                uRes.end(String(body));
            }
        });
    };

    const api: UResponse = {
        get headersSent() { return ended; },
        status(code: number) { statusCode = code; return api; },
        sendStatus(code: number) {
            statusCode = code;
            if (!headers['Content-Type']) headers['Content-Type'] = 'text/plain; charset=utf-8';
            flush(STATUS_TEXT[code] || String(code));
            return api;
        },
        json(body: any) {
            headers['Content-Type'] = 'application/json';
            flush(JSON.stringify(body));
            return api;
        },
        send(body?: any) {
            if (body === undefined || body === null) {
                flush();
            } else if (Buffer.isBuffer(body)) {
                if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream';
                flush(body);
            } else if (typeof body === 'object') {
                return api.json(body);
            } else {
                if (!headers['Content-Type']) headers['Content-Type'] = 'text/html; charset=utf-8';
                flush(String(body));
            }
            return api;
        },
        sendFile(absPath: string) {
            try {
                const stat = fs.statSync(absPath);
                if (!stat.isFile()) throw new Error('not a file');
                const buf = fs.readFileSync(absPath);
                if (!headers['Content-Type']) headers['Content-Type'] = lookupMime(absPath);
                flush(buf);
            } catch {
                statusCode = 404;
                if (!headers['Content-Type']) headers['Content-Type'] = 'text/plain; charset=utf-8';
                flush('Not Found');
            }
            return api;
        },
        header(name: string, value: string) { headers[name] = value; return api; },
        setHeader(name: string, value: string) { headers[name] = value; return api; },
        end(body?: string | Buffer) { flush(body); return api; },
        write(body: string | Buffer) {
            // Express semantics would buffer, then end on .end(). For simplicity
            // (and because the codebase never chains .write() + .end()), treat
            // .write() as a one-shot terminal flush.
            flush(body);
            return api;
        }
    };
    return api;
}

/** Options for serving static files (subset of express.static's API the codebase uses). */
export interface StaticOptions {
    index?: string | false;
    setHeaders?: (res: UResponse, filePath: string) => void;
}

/**
 * Build a middleware that serves files out of `root`. If `root` is a file path
 * (the codebase does this for /favicon.ico), serve that one file when matched.
 */
export function staticFiles(root: string, opts: StaticOptions = {}): Handler {
    let rootIsFile = false;
    try { rootIsFile = fs.statSync(root).isFile(); } catch { /* dir or missing */ }

    return (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        if (rootIsFile) {
            try {
                const stat = fs.statSync(root);
                if (!stat.isFile()) return next();
                const buf = fs.readFileSync(root);
                res.setHeader('Content-Type', lookupMime(root));
                if (opts.setHeaders) opts.setHeaders(res, root);
                res.end(buf);
            } catch {
                return next();
            }
            return;
        }

        // For a directory mount, `req.path` is relative to the mount point —
        // the middleware dispatcher rewrites it before calling us.
        let relPath = req.path;
        if (relPath === '/' || relPath === '') {
            if (opts.index === false) return next();
            relPath = '/' + (opts.index || 'index.html');
        }
        // Strip query, normalize, block traversal.
        const safe = path.posix.normalize(relPath);
        if (safe.includes('..')) return next();
        const filePath = path.join(root, safe);
        if (!filePath.startsWith(root)) return next();

        let stat: fs.Stats;
        try { stat = fs.statSync(filePath); }
        catch { return next(); }

        if (stat.isDirectory()) {
            if (opts.index === false) return next();
            const idxPath = path.join(filePath, opts.index || 'index.html');
            try {
                const idxStat = fs.statSync(idxPath);
                if (!idxStat.isFile()) return next();
                const buf = fs.readFileSync(idxPath);
                res.setHeader('Content-Type', lookupMime(idxPath));
                if (opts.setHeaders) opts.setHeaders(res, idxPath);
                res.end(buf);
            } catch { return next(); }
            return;
        }

        if (!stat.isFile()) return next();
        const buf = fs.readFileSync(filePath);
        res.setHeader('Content-Type', lookupMime(filePath));
        if (opts.setHeaders) opts.setHeaders(res, filePath);
        res.end(buf);
    };
}

/** No-op JSON parser — body parsing is built into the dispatcher. Exposed so
 *  callers writing `app.use(express.json())` keep compiling. */
export function jsonParser(): Handler {
    return (_req, _res, next) => next();
}

export class UApp {
    public readonly uwsApp: TemplatedApp;
    private middlewares: MiddlewareEntry[] = [];
    private routes: RouteEntry[] = [];

    constructor(uwsApp: TemplatedApp) {
        this.uwsApp = uwsApp;
    }

    /** Express-style `app.use(mw)` or `app.use(pathPrefix, mw)`. */
    use(pathOrMw: string | Handler, mw?: Handler): this {
        if (typeof pathOrMw === 'function') {
            this.middlewares.push({ handler: pathOrMw });
        } else if (typeof pathOrMw === 'string' && typeof mw === 'function') {
            this.middlewares.push({ pathPrefix: pathOrMw, handler: mw });
        }
        return this;
    }

    get(pattern: string, ...handlers: Handler[]): this {
        this.routes.push({ method: 'GET', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    post(pattern: string, ...handlers: Handler[]): this {
        this.routes.push({ method: 'POST', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    put(pattern: string, ...handlers: Handler[]): this {
        this.routes.push({ method: 'PUT', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    delete(pattern: string, ...handlers: Handler[]): this {
        this.routes.push({ method: 'DELETE', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }
    patch(pattern: string, ...handlers: Handler[]): this {
        this.routes.push({ method: 'PATCH', pattern, matcher: compilePath(pattern), handlers });
        return this;
    }

    /** Register a WebSocket route on the underlying uWS app. */
    ws<UserData>(pattern: string, behavior: WebSocketBehavior<UserData>): this {
        this.uwsApp.ws<UserData>(pattern, behavior);
        return this;
    }

    /**
     * Start listening. Must be called *after* all routes and the WebSocket
     * route are registered, because we install the HTTP catch-all here.
     */
    listen(port: number, cb?: (ok: boolean) => void): this {
        // Install the HTTP catch-all last so that any specific route registered
        // on the underlying uWS app (e.g. the WebSocket upgrade at /ws) takes
        // precedence.
        this.uwsApp.any('/*', this.dispatch.bind(this));

        this.uwsApp.listen(port, (token) => {
            if (cb) cb(!!token);
        });
        return this;
    }

    /** Underlying uWS HTTP dispatcher — entry point for every HTTP request. */
    private dispatch(uRes: HttpResponse, uReq: HttpRequest): void {
        // Capture all sync data from uReq BEFORE any async work — uWS
        // invalidates `req` after the handler yields.
        const method = uReq.getCaseSensitiveMethod().toUpperCase();
        const urlPath = uReq.getUrl();
        const qs = uReq.getQuery();
        const headers: Record<string, string> = {};
        uReq.forEach((k, v) => { headers[k.toLowerCase()] = v; });

        const aborted: AbortedFlag = { value: false };
        uRes.onAborted(() => { aborted.value = true; });

        const req: UReq = {
            method,
            url: qs ? `${urlPath}?${qs}` : urlPath,
            path: urlPath,
            originalUrl: qs ? `${urlPath}?${qs}` : urlPath,
            query: parseQuery(qs),
            params: {},
            headers,
            body: undefined,
            header(n: string) { return headers[n.toLowerCase()]; },
            get(n: string) { return headers[n.toLowerCase()]; }
        };
        const res = createResponse(uRes, aborted);

        const needsBody = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
        if (needsBody) {
            const chunks: Buffer[] = [];
            uRes.onData((chunk, isLast) => {
                if (chunk.byteLength > 0) chunks.push(Buffer.from(chunk));
                if (isLast) {
                    const raw = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
                    const ct = headers['content-type'] || '';
                    if (raw.length === 0) {
                        req.body = {};
                    } else if (ct.includes('application/json')) {
                        try { req.body = JSON.parse(raw.toString('utf-8')); }
                        catch { req.body = {}; }
                    } else if (ct.includes('application/x-www-form-urlencoded')) {
                        req.body = parseQuery(raw.toString('utf-8'));
                    } else {
                        req.body = raw;
                    }
                    this.runChain(req, res, aborted);
                }
            });
        } else {
            this.runChain(req, res, aborted);
        }
    }

    private runChain(req: UReq, res: UResponse, aborted: AbortedFlag): void {
        // Build the ordered handler chain: applicable middlewares, then the
        // matching route's handlers. Preserves Express-style registration order.
        const chain: Handler[] = [];
        const origPath = req.path;

        for (const mw of this.middlewares) {
            if (mw.pathPrefix === undefined || mw.pathPrefix === '/' || mw.pathPrefix === '') {
                // Express-equivalent global middleware — runs on every request,
                // path is left untouched.
                chain.push(mw.handler);
            } else if (req.path === mw.pathPrefix || req.path.startsWith(mw.pathPrefix + '/')) {
                // Strip the mount prefix for the duration of this middleware,
                // matching Express's `app.use(path, mw)` semantics. Wrap the
                // handler so the next() restores req.path.
                const prefix = mw.pathPrefix;
                const handler = mw.handler;
                chain.push((r, s, next) => {
                    const saved = r.path;
                    r.path = saved.slice(prefix.length) || '/';
                    handler(r, s, (err?: any) => { r.path = saved; next(err); });
                });
            }
        }

        let routeMatched = false;
        for (const route of this.routes) {
            if (route.method !== req.method) continue;
            const params = route.matcher.test(origPath);
            if (params) {
                req.params = params;
                for (const h of route.handlers) chain.push(h);
                routeMatched = true;
                break;
            }
        }

        let i = 0;
        const next = (err?: any) => {
            if (aborted.value) return;
            if (err) {
                if (!res.headersSent) {
                    console.error('[uws_app] middleware error:', err);
                    res.status(500).send('Internal Server Error');
                }
                return;
            }
            if (i >= chain.length) {
                if (!res.headersSent) {
                    if (routeMatched) res.end();
                    else res.status(404).send('Not Found');
                }
                return;
            }
            const handler = chain[i++];
            try {
                const ret = handler(req, res, next);
                if (ret && typeof (ret as Promise<void>).catch === 'function') {
                    (ret as Promise<void>).catch(e => {
                        if (!aborted.value && !res.headersSent) {
                            console.error('[uws_app] async handler error:', e);
                            res.status(500).send('Internal Server Error');
                        }
                    });
                }
            } catch (e) {
                if (!aborted.value && !res.headersSent) {
                    console.error('[uws_app] handler threw:', e);
                    res.status(500).send('Internal Server Error');
                }
            }
        };
        next();
    }
}

/** Build an SSLApp or App depending on whether cert/key files exist. */
export function createApp(opts?: { ssl?: { certPath: string; keyPath: string } }): UApp {
    let uwsApp: TemplatedApp;
    if (opts?.ssl) {
        const appOpts: AppOptions = {
            key_file_name: opts.ssl.keyPath,
            cert_file_name: opts.ssl.certPath,
        };
        uwsApp = uWS.SSLApp(appOpts);
    } else {
        uwsApp = uWS.App();
    }
    return new UApp(uwsApp);
}
