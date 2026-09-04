"use strict";
/**
 * Registration and login abuse limits.
 *
 * Someone spam-created over 9000 accounts against production. Nothing stopped
 * them: `/auth/register` accepted an unlimited number of requests from one
 * source, each one bcrypt-hashing a password (CPU) and growing inventory.json
 * (memory, and a bigger save on every write — see the tick-stall history).
 *
 * Three limits, deliberately layered, because each covers the others' blind
 * spot:
 *
 *  - **Per-IP token bucket.** A handful of accounts in a burst, then a slow
 *    drip. This is the one that actually matches how a real player behaves.
 *    Its weakness is that the address it keys on can be a claim (below).
 *  - **Persisted per-IP daily cap.** The bucket lives in memory, so a restart
 *    hands the attacker a fresh one. Accounts carry a salted hash of the
 *    address that created them, so the 24h count survives restarts — and gives
 *    an operator a way to find the spam afterwards.
 *  - **Global token bucket.** Nothing keyed on a client-supplied value can be
 *    trusted absolutely, so there is also a server-wide ceiling on how fast
 *    accounts can be created at all. It cannot be spoofed around, because it
 *    is not keyed on anything the client says. It is set well above real
 *    demand, so it only ever engages during an attack.
 *
 * On the address itself: prod sits behind Cloudflare, so the TCP peer is the
 * proxy and every player would otherwise share one key. `CF-Connecting-IP` is
 * therefore used when present — which means a client reaching the origin
 * directly could assert one. That is exactly why the global cap exists and why
 * the per-IP cap is not the only line of defence.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_WINDOW_MS = exports.REGISTER_DAILY_PER_ADDRESS = void 0;
exports.addressKey = addressKey;
exports.clientAddressOf = clientAddressOf;
exports.spendRegistration = spendRegistration;
exports.spendLoginAttempt = spendLoginAttempt;
exports.refundLoginAttempt = refundLoginAttempt;
exports.refusalLogLine = refusalLogLine;
exports.limiterSnapshot = limiterSnapshot;
exports.resetAccountLimiter = resetAccountLimiter;
/** Registrations one address may make back-to-back before the drip rate binds. */
const REGISTER_BURST = 3;
/** Sustained registration rate per address: one per ten minutes. */
const REGISTER_REFILL_PER_SEC = 1 / 600;
/** Accounts one address may create in a rolling 24h, counted from the database. */
exports.REGISTER_DAILY_PER_ADDRESS = 10;
/** Server-wide registration burst, and its sustained rate (one per 20s). */
const GLOBAL_REGISTER_BURST = 50;
const GLOBAL_REGISTER_REFILL_PER_SEC = 1 / 20;
/** Login attempts per address: a burst for typos, then one every six seconds. */
const LOGIN_BURST = 10;
const LOGIN_REFILL_PER_SEC = 1 / 6;
/**
 * Most addresses the table will hold. A flood from many sources must not turn
 * the defence into the memory leak it is defending against, so the table is
 * swept when it grows past this — see sweep().
 */
const MAX_TRACKED_ADDRESSES = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED = { allowed: true, retryAfterSeconds: 0, message: '', scope: null };
/** At most one refusal line per this many ms — see refusalLogLine. */
const REFUSAL_LOG_INTERVAL_MS = 10000;
let lastRefusalLogAt = 0;
let suppressedRefusals = 0;
const registerBuckets = new Map();
const loginBuckets = new Map();
const globalRegisterBucket = {
    tokens: GLOBAL_REGISTER_BURST,
    updatedAt: Date.now(),
    burst: GLOBAL_REGISTER_BURST,
    refillPerSec: GLOBAL_REGISTER_REFILL_PER_SEC,
};
function refill(bucket, now) {
    const elapsed = (now - bucket.updatedAt) / 1000;
    if (elapsed <= 0)
        return;
    bucket.updatedAt = now;
    bucket.tokens = Math.min(bucket.burst, bucket.tokens + elapsed * bucket.refillPerSec);
}
/** Seconds until the bucket holds a whole token again. */
function waitSeconds(bucket) {
    if (bucket.tokens >= 1)
        return 0;
    return Math.ceil((1 - bucket.tokens) / bucket.refillPerSec);
}
/**
 * Drop entries that have refilled to full: a full bucket is indistinguishable
 * from an address that was never seen, so forgetting it costs nothing. Only
 * runs when the table is over budget, so the common case is untouched.
 */
function sweep(table, now) {
    if (table.size <= MAX_TRACKED_ADDRESSES)
        return;
    for (const [key, bucket] of table) {
        refill(bucket, now);
        if (bucket.tokens >= bucket.burst)
            table.delete(key);
    }
    // Still over budget means every tracked address is actively spending, i.e.
    // a distributed flood. Drop the oldest half rather than grow without
    // bound; the global cap is what holds the line in that case anyway.
    if (table.size > MAX_TRACKED_ADDRESSES) {
        const oldestFirst = Array.from(table.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        for (let i = 0; i < oldestFirst.length / 2; i++)
            table.delete(oldestFirst[i][0]);
    }
}
function bucketFor(table, key, burst, refillPerSec, now) {
    let bucket = table.get(key);
    if (!bucket) {
        sweep(table, now);
        bucket = { tokens: burst, updatedAt: now, burst, refillPerSec };
        table.set(key, bucket);
    }
    refill(bucket, now);
    return bucket;
}
/** The four octets of a dotted quad, or null. */
function parseIPv4(text) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
    if (!m)
        return null;
    const octets = m.slice(1, 5).map(Number);
    return octets.some(o => o > 255) ? null : octets;
}
/**
 * An IPv6 address as its eight 16-bit groups, or null if it doesn't parse.
 *
 * Handles the three spellings that reach this code: uWS' fully expanded
 * `0000:0000:0000:0000:0000:ffff:7f00:0001`, the `::`-compressed form a proxy
 * header carries, and a trailing dotted quad (`::ffff:127.0.0.1`). Parsing to
 * numbers rather than comparing text is what makes those spellings agree on one
 * key. (connection/sessionGuard.ts has the same parser for the loopback test;
 * it is duplicated rather than shared so this module stays free of the game
 * modules that one pulls in.)
 */
function expandIPv6(input) {
    let text = input;
    let embeddedV4 = null;
    const lastColon = text.lastIndexOf(':');
    if (lastColon >= 0 && text.slice(lastColon + 1).includes('.')) {
        const octets = parseIPv4(text.slice(lastColon + 1));
        if (!octets)
            return null;
        embeddedV4 = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
        text = text.slice(0, lastColon);
        if (text === ':')
            text = '::';
    }
    const halves = text.split('::');
    if (halves.length > 2)
        return null;
    const toGroups = (part) => part === '' ? [] : part.split(':').map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    const head = toGroups(halves[0]);
    const tail = halves.length === 2 ? toGroups(halves[1]) : [];
    if (head.concat(tail).some(Number.isNaN))
        return null;
    const explicit = head.length + tail.length + (embeddedV4 ? 2 : 0);
    if (explicit > 8)
        return null;
    if (halves.length === 2) {
        return [...head, ...new Array(8 - explicit).fill(0), ...tail, ...(embeddedV4 || [])];
    }
    return explicit === 8 ? [...head, ...(embeddedV4 || [])] : null;
}
/**
 * The key an address is limited under.
 *
 * IPv4 is keyed whole. IPv6 is keyed on its /64 prefix: a residential IPv6
 * allocation hands one customer 2^64 addresses, so limiting the full address
 * would be no limit at all. An IPv4-mapped address collapses to the IPv4 it
 * carries, so one client gets one key however its address is spelled.
 */
function addressKey(address) {
    const addr = (address || '').trim().toLowerCase();
    if (!addr)
        return 'unknown';
    if (parseIPv4(addr))
        return addr;
    if (!addr.includes(':'))
        return addr;
    const groups = expandIPv6(addr);
    if (!groups)
        return addr;
    // IPv4-mapped: ::ffff:a.b.c.d, with the octets packed into the last two groups.
    if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
        return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    }
    return `${groups.slice(0, 4).map(g => g.toString(16)).join(':')}::/64`;
}
/**
 * The address a request came from.
 *
 * `CF-Connecting-IP` (else the first `X-Forwarded-For` hop) wins when present,
 * because in production every request arrives through Cloudflare and the peer
 * address is the proxy's. This is client-supplied text: see the file header for
 * why that is acceptable here and what backs it up.
 */
function clientAddressOf(req) {
    const cf = req.header('cf-connecting-ip');
    if (cf && cf.trim())
        return cf.trim();
    const forwarded = req.header('x-forwarded-for');
    if (forwarded && forwarded.trim())
        return forwarded.split(',')[0].trim();
    return req.ip || '';
}
function denied(scope, retryAfterSeconds, message) {
    return { allowed: false, retryAfterSeconds, message, scope };
}
/**
 * Take one registration attempt's budget for `key`.
 *
 * `accountsToday` reports how many accounts this address already created in the
 * last 24h (database.countAccountsCreatedBy). It is a function, not a number,
 * because that count walks every account: calling it on requests the two O(1)
 * buckets have already refused would hand an attacker a full table scan per
 * packet — a cheaper attack than the one being defended against.
 *
 * Nothing is consumed unless all three limits agree, so a request one limit
 * refuses does not also burn another's budget. An attempt that fails later
 * (name taken, weak password) does still cost its token: otherwise probing
 * which names exist is free.
 */
function spendRegistration(key, accountsToday, now = Date.now()) {
    const ipBucket = bucketFor(registerBuckets, key, REGISTER_BURST, REGISTER_REFILL_PER_SEC, now);
    refill(globalRegisterBucket, now);
    if (ipBucket.tokens < 1) {
        return denied('ip', waitSeconds(ipBucket), 'Too many accounts created from here. Please wait a few minutes.');
    }
    if (globalRegisterBucket.tokens < 1) {
        return denied('global', waitSeconds(globalRegisterBucket), 'The server is creating accounts as fast as it will right now. Please try again shortly.');
    }
    if (accountsToday() >= exports.REGISTER_DAILY_PER_ADDRESS) {
        return denied('daily', 3600, 'This network has created too many accounts today. Try again tomorrow.');
    }
    ipBucket.tokens -= 1;
    globalRegisterBucket.tokens -= 1;
    return ALLOWED;
}
/**
 * Take one login attempt's budget for `key`. Login verifies a bcrypt hash, so
 * an unlimited stream of guesses is both a credential-stuffing channel and a
 * way to spend the server's CPU for free.
 */
function spendLoginAttempt(key, now = Date.now()) {
    const bucket = bucketFor(loginBuckets, key, LOGIN_BURST, LOGIN_REFILL_PER_SEC, now);
    if (bucket.tokens < 1) {
        return denied('ip', waitSeconds(bucket), 'Too many login attempts. Please wait a moment.');
    }
    bucket.tokens -= 1;
    return ALLOWED;
}
/** Refund a login attempt that succeeded, so a busy legitimate player is never held back. */
function refundLoginAttempt(key) {
    const bucket = loginBuckets.get(key);
    if (bucket)
        bucket.tokens = Math.min(bucket.burst, bucket.tokens + 1);
}
/**
 * A log line for a refused attempt, or null when one was written too recently.
 *
 * The refusals arrive at exactly the rate of the attack, so logging each one
 * turns a registration flood into a disk flood. One line per window carries the
 * same information — that an attack is happening, and where from — and says how
 * many refusals it stands for.
 */
function refusalLogLine(address, scope, now = Date.now()) {
    suppressedRefusals++;
    if (now - lastRefusalLogAt < REFUSAL_LOG_INTERVAL_MS)
        return null;
    const suppressed = suppressedRefusals - 1;
    lastRefusalLogAt = now;
    suppressedRefusals = 0;
    const also = suppressed > 0 ? ` (+${suppressed} more since the last line)` : '';
    return `[ABUSE] Registration refused (${scope}) for ${address}${also}`;
}
/** Ms after which an account no longer counts against its creator's daily cap. */
exports.DAILY_WINDOW_MS = DAY_MS;
/** For tests and `/admin` reporting. */
function limiterSnapshot() {
    return { addresses: registerBuckets.size, globalTokens: globalRegisterBucket.tokens };
}
/** Test hook: forget everything. Not called by the server. */
function resetAccountLimiter(now = Date.now()) {
    registerBuckets.clear();
    loginBuckets.clear();
    lastRefusalLogAt = 0;
    suppressedRefusals = 0;
    globalRegisterBucket.tokens = GLOBAL_REGISTER_BURST;
    globalRegisterBucket.updatedAt = now;
}
