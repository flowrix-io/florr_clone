/**
 * Chat image moderation.
 *
 * Every player may embed <img> tags in chat, but images from non-admins are
 * screened here before the message is broadcast. Admin messages bypass the
 * filter entirely (same as before).
 *
 * The screen runs in layers, cheapest first:
 *   1. Structural  - at most N images per message, https only, no credentials
 *                    in the URL, no IP literals / private hosts (we fetch the
 *                    URL server-side, so this doubles as SSRF protection).
 *   2. Reputation  - explicit host blocklist, plus a keyword blocklist matched
 *                    against the URL itself ("porn", "nsfw", "gore", ...).
 *   3. Host policy - unless a moderation provider is configured, the image must
 *                    come from a host that moderates its own uploads.
 *   4. Content     - the URL is fetched (headers only) to confirm it really is
 *                    an image of a sane size, and, when a provider is
 *                    configured, handed to that provider for classification.
 *
 * Verdicts are cached per-URL so a popular image is only screened once.
 * Anything that errors or times out is rejected: the filter fails closed.
 *
 * Provider configuration (all optional):
 *   IMAGE_MODERATION_URL        POST endpoint; receives {"url": "..."} JSON.
 *   IMAGE_MODERATION_KEY        sent as `Authorization: Bearer <key>`.
 *   IMAGE_MODERATION_THRESHOLD  score above which an image is rejected (0.7).
 *   IMAGE_MODERATION_ANY_HOST   "false" keeps the host allowlist on even when
 *                               a provider is configured.
 */

/** Max <img> tags a single non-admin message may carry. Extras are dropped. */
const MAX_IMAGES_PER_MESSAGE = 2;
/** Per-account cooldown between messages that contain images. */
const IMAGE_POST_COOLDOWN_MS = 8000;
/** Budget for the content check (fetch + provider call combined). */
const SCREEN_TIMEOUT_MS = 5000;
/** Images larger than this are rejected outright. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Verdict cache size. Entries are evicted oldest-first. */
const VERDICT_CACHE_MAX = 512;

/**
 * Hosts trusted to run their own upload moderation. Used when no classifier is
 * configured — matched against the registrable suffix, so "cdn.discordapp.com"
 * is covered by "discordapp.com".
 */
const ALLOWED_HOSTS = [
    'imgur.com',
    'i.imgur.com',
    'discordapp.com',
    'discordapp.net',
    'discord.com',
    'redd.it',
    'redditmedia.com',
    'giphy.com',
    'tenor.com',
    'githubusercontent.com',
    'github.com',
    'wikimedia.org',
    'wikipedia.org',
    'ibb.co',
    'postimg.cc',
    'prnt.sc',
    'gyazo.com',
    'steamstatic.com',
    'steamusercontent.com',
    'florr.io',
];

/** Hosts that are never allowed, provider or not. */
const BLOCKED_HOSTS = [
    'pornhub.com',
    'xvideos.com',
    'xhamster.com',
    'redtube.com',
    'youporn.com',
    'xnxx.com',
    'rule34.xxx',
    'e621.net',
    'nhentai.net',
    'gelbooru.com',
    'danbooru.donmai.us',
    'r34.app',
    'motherless.com',
    'liveleak.com',
    'bestgore.com',
    'kaotic.com',
    'theync.com',
    '4chan.org',
    '4cdn.org',
    'goatse.cx',
];

/** Substrings that disqualify a URL on sight. Matched case-insensitively. */
const BLOCKED_URL_KEYWORDS = [
    'porn', 'pron', 'nsfw', 'xxx', 'hentai', 'rule34', 'r34', 'nude', 'nudes',
    'naked', 'boobs', 'tits', 'titty', 'penis', 'vagina', 'pussy', 'dick',
    'cock', 'cum', 'creampie', 'blowjob', 'handjob', 'anal', 'bdsm', 'fetish',
    'incest', 'milf', 'hardcore', 'sex', 'sexy', 'erotic', 'lewd', 'ecchi',
    'gore', 'guro', 'beheading', 'decapitat', 'mutilat', 'suicide', 'hanging',
    'corpse', 'snuff', 'goatse', 'lemonparty', 'meatspin',
    'loli', 'shota', 'jailbait', 'swastika', 'nigger', 'faggot',
];

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const ALLOWED_CONTENT_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/avif',
]);

export interface ImageVerdict {
    ok: boolean;
    /** Player-facing explanation, present when `ok` is false. */
    reason?: string;
}

export interface FilteredMessage {
    /** The message with rejected <img> tags removed and accepted ones rebuilt. */
    content: string;
    /** Notices for the poster only — never broadcast. */
    notices: string[];
}

const verdictCache = new Map<string, ImageVerdict>();
const inFlight = new Map<string, Promise<ImageVerdict>>();
const lastImagePost = new Map<string, number>();

/** Cheap pre-check so image-free messages never touch the async path. */
export function messageHasImage(message: string): boolean {
    return /<img\b/i.test(message);
}

function providerUrl(): string {
    return process.env.IMAGE_MODERATION_URL || '';
}

function allowAnyHost(): boolean {
    return !!providerUrl() && process.env.IMAGE_MODERATION_ANY_HOST !== 'false';
}

function hostMatches(hostname: string, list: string[]): boolean {
    const host = hostname.toLowerCase();
    return list.some(entry => host === entry || host.endsWith('.' + entry));
}

/** Hostnames we refuse to fetch: loopback, link-local, and RFC1918 space. */
function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (!host.includes('.') && !host.includes(':')) return true;  // bare hostname → intranet
    if (host.includes(':')) return true;                          // IPv6 literal
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4) return false;
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return a >= 224;  // multicast / reserved
}

/** Layers 1-3: everything decidable from the URL alone. */
function screenUrl(raw: string): { verdict: ImageVerdict; url?: URL } {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { verdict: { ok: false, reason: 'that image link is not a valid URL' } };
    }

    if (url.protocol !== 'https:') {
        return { verdict: { ok: false, reason: 'image links must use https' } };
    }
    if (url.username || url.password) {
        return { verdict: { ok: false, reason: 'image links may not contain credentials' } };
    }
    if (isPrivateHost(url.hostname)) {
        return { verdict: { ok: false, reason: 'that image host is not reachable' } };
    }
    if (hostMatches(url.hostname, BLOCKED_HOSTS)) {
        return { verdict: { ok: false, reason: 'that image host is blocked' } };
    }

    let decoded = raw;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        /* keep the raw form if it is not valid percent-encoding */
    }
    // Split the URL on every non-alphanumeric run so "porn-pic_1.jpg" becomes
    // " porn pic 1 jpg ". Short words match whole segments only, so "anal"
    // cannot fire on "analysis" or "cock" on "cocktail".
    const haystack = ' ' + decoded.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    const hit = BLOCKED_URL_KEYWORDS.some(word =>
        word.length > 4 ? haystack.includes(word) : haystack.includes(` ${word} `));
    if (hit) {
        return { verdict: { ok: false, reason: 'that image link looks inappropriate' } };
    }

    if (!allowAnyHost() && !hostMatches(url.hostname, ALLOWED_HOSTS)) {
        return {
            verdict: {
                ok: false,
                reason: `images must be hosted on a moderated host (${ALLOWED_HOSTS.slice(0, 5).join(', ')}, ...)`,
            },
        };
    }

    return { verdict: { ok: true }, url };
}

/** Layer 4a: confirm the URL really serves an image of a sane size. */
async function checkHeaders(url: string, signal: AbortSignal): Promise<ImageVerdict> {
    let res: Response;
    try {
        res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal,
            headers: { 'Range': 'bytes=0-0', 'User-Agent': 'florrclone-image-filter' },
        });
    } catch {
        return { ok: false, reason: 'that image could not be loaded' };
    }

    // Cancel the body immediately — we only ever needed the headers.
    try { await res.body?.cancel(); } catch { /* already closed */ }

    if (!res.ok && res.status !== 206) {
        return { ok: false, reason: `that image returned HTTP ${res.status}` };
    }

    // A redirect can land somewhere the original URL check never saw.
    const final = screenUrl(res.url || url);
    if (!final.verdict.ok) return final.verdict;

    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(type)) {
        return { ok: false, reason: 'that link is not an image' };
    }

    const lengthHeader = res.headers.get('content-range')?.split('/')[1] || res.headers.get('content-length');
    const size = Number(lengthHeader);
    if (Number.isFinite(size) && size > MAX_IMAGE_BYTES) {
        return { ok: false, reason: 'that image is too large' };
    }

    return { ok: true };
}

/**
 * Layer 4b: hand the URL to the configured classifier.
 *
 * Response shapes understood: `{flagged}`, `{nsfw|score|confidence}`, and the
 * OpenAI-moderations shape `{results:[{flagged, category_scores:{...}}]}`.
 */
async function checkProvider(url: string, signal: AbortSignal): Promise<ImageVerdict> {
    const endpoint = providerUrl();
    if (!endpoint) return { ok: true };

    const threshold = Number(process.env.IMAGE_MODERATION_THRESHOLD) || 0.7;
    let body: any;
    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (process.env.IMAGE_MODERATION_KEY) {
            headers['Authorization'] = `Bearer ${process.env.IMAGE_MODERATION_KEY}`;
        }
        const res = await fetch(endpoint, {
            method: 'POST',
            headers,
            signal,
            body: JSON.stringify({ url }),
        });
        if (!res.ok) {
            console.warn(`[imageModeration] provider returned HTTP ${res.status}`);
            return { ok: false, reason: 'the image filter is unavailable right now' };
        }
        body = await res.json();
    } catch (err) {
        console.warn('[imageModeration] provider call failed:', err);
        return { ok: false, reason: 'the image filter is unavailable right now' };
    }

    const result = Array.isArray(body?.results) ? body.results[0] : body;
    if (!result || typeof result !== 'object') return { ok: true };

    if (result.flagged === true) return { ok: false, reason: 'that image was flagged as inappropriate' };

    const scores: number[] = [];
    for (const key of ['nsfw', 'score', 'confidence', 'porn', 'hentai', 'sexy', 'gore', 'violence']) {
        const value = Number(result[key]);
        if (Number.isFinite(value)) scores.push(value);
    }
    const categories = result.category_scores || result.categories;
    if (categories && typeof categories === 'object') {
        for (const value of Object.values(categories)) {
            const num = Number(value);
            if (Number.isFinite(num)) scores.push(num);
        }
    }
    if (scores.some(score => score >= threshold)) {
        return { ok: false, reason: 'that image was flagged as inappropriate' };
    }

    return { ok: true };
}

function cacheVerdict(key: string, verdict: ImageVerdict): ImageVerdict {
    if (verdictCache.size >= VERDICT_CACHE_MAX) {
        const oldest = verdictCache.keys().next().value;
        if (oldest !== undefined) verdictCache.delete(oldest);
    }
    verdictCache.set(key, verdict);
    return verdict;
}

/** Full screen for one image URL, cached and deduplicated across posters. */
export async function screenImageUrl(raw: string): Promise<ImageVerdict> {
    const cached = verdictCache.get(raw);
    if (cached) return cached;

    const pending = inFlight.get(raw);
    if (pending) return pending;

    const { verdict, url } = screenUrl(raw);
    if (!verdict.ok || !url) return cacheVerdict(raw, verdict);

    const run = (async (): Promise<ImageVerdict> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SCREEN_TIMEOUT_MS);
        try {
            const headers = await checkHeaders(url.toString(), controller.signal);
            if (!headers.ok) return headers;
            return await checkProvider(url.toString(), controller.signal);
        } catch (err) {
            console.warn('[imageModeration] screen failed:', err);
            return { ok: false, reason: 'that image could not be checked' };
        } finally {
            clearTimeout(timer);
        }
    })();

    inFlight.set(raw, run);
    try {
        return cacheVerdict(raw, await run);
    } finally {
        inFlight.delete(raw);
    }
}

/** True (and starts the cooldown) when this account may post images right now. */
function consumeCooldown(username: string): boolean {
    const key = username.toLowerCase();
    const now = Date.now();
    const last = lastImagePost.get(key) || 0;
    if (now - last < IMAGE_POST_COOLDOWN_MS) return false;

    if (lastImagePost.size > 5000) {
        for (const [name, at] of lastImagePost) {
            if (now - at > IMAGE_POST_COOLDOWN_MS * 10) lastImagePost.delete(name);
        }
    }
    lastImagePost.set(key, now);
    return true;
}

/** Forget a poster's cooldown — used when every image in their message was dropped. */
function refundCooldown(username: string): void {
    lastImagePost.delete(username.toLowerCase());
}

function extractSrc(tag: string): string {
    const match = tag.match(SRC_ATTR_RE);
    if (!match) return '';
    return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

/**
 * Screen every <img> in a non-admin message.
 *
 * Accepted images are rebuilt as a bare `<img src="...">` so no other attribute
 * survives; rejected ones are dropped and explained to the poster only.
 */
export async function filterChatImages(message: string, username: string): Promise<FilteredMessage> {
    const tags = message.match(IMG_TAG_RE);
    if (!tags || tags.length === 0) return { content: message, notices: [] };

    const notices: string[] = [];

    if (!consumeCooldown(username)) {
        return {
            content: message.replace(IMG_TAG_RE, ''),
            notices: [`You can only post an image every ${Math.round(IMAGE_POST_COOLDOWN_MS / 1000)} seconds.`],
        };
    }

    // Screen the images we are willing to keep, concurrently.
    const kept = tags.slice(0, MAX_IMAGES_PER_MESSAGE);
    if (tags.length > kept.length) {
        notices.push(`Only ${MAX_IMAGES_PER_MESSAGE} images per message — the rest were dropped.`);
    }

    const verdicts = new Map<string, ImageVerdict>();
    await Promise.all(kept.map(async tag => {
        if (verdicts.has(tag)) return;
        const src = extractSrc(tag);
        if (!src) {
            verdicts.set(tag, { ok: false, reason: 'that image tag has no source' });
            return;
        }
        verdicts.set(tag, await screenImageUrl(src));
    }));

    let index = 0;
    let accepted = 0;
    const content = message.replace(IMG_TAG_RE, tag => {
        if (index++ >= MAX_IMAGES_PER_MESSAGE) return '';
        const verdict = verdicts.get(tag) || { ok: false, reason: 'that image could not be checked' };
        if (!verdict.ok) {
            if (verdict.reason && !notices.includes(`Image blocked: ${verdict.reason}.`)) {
                notices.push(`Image blocked: ${verdict.reason}.`);
            }
            return '';
        }
        accepted++;
        return `<img src="${escapeAttribute(extractSrc(tag))}">`;
    });

    // Nothing got through, so the poster shouldn't burn their cooldown on it.
    if (accepted === 0) refundCooldown(username);

    return { content, notices };
}

function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
