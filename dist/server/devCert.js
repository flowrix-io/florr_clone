"use strict";
/**
 * Keeps local HTTPS working without anyone having to think about certificates.
 *
 * The repository ships a `cert.crt` for `localhost` so a fresh clone can run
 * over HTTPS immediately. Being a committed file it eventually expires, and then
 * `npm start` serves a certificate every browser rejects — and WebTransport,
 * which needs a *live* certificate to validate or to pin, stops being offered at
 * all. So an expired development certificate is simply regenerated at boot.
 *
 * The replacement is ECDSA P-256 with a 13-day life, which is what browsers
 * require before they will accept a certificate pinned by hash
 * (`serverCertificateHashes`). That is what lets WebTransport work on localhost
 * with no trust-store setup: the server publishes the digest at
 * /transport-info and the client pins it. A side effect is that the certificate
 * expires quickly — which is fine, because expiry is now self-healing.
 *
 * Two rules keep this from ever touching a real deployment:
 *
 *   1. A certificate that is currently valid is always used as-is, whatever it
 *      is. A trusted localhost certificate (mkcert and friends) is never
 *      swapped out for a self-signed one.
 *   2. Only a certificate that names nothing but localhost/loopback is eligible
 *      for regeneration. Production serves a real certificate for a real
 *      hostname (see update_aws.sh, which installs the Let's Encrypt chain
 *      here); if that expires it is reported loudly and left exactly as it is,
 *      because quietly self-signing over it would turn a renewal failure into a
 *      much more confusing one.
 *
 * The generated pair lives beside the committed one under a different name, so
 * regeneration never dirties a tracked file.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDevCert = generateDevCert;
exports.resolveTlsPaths = resolveTlsPaths;
const child_process_1 = require("child_process");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Days a generated certificate is valid for. */
const DEV_VALIDITY_DAYS = 13;
/**
 * Regenerate a bit before expiry rather than exactly at it, so a server that has
 * been up for a while does not hand out a certificate that dies mid-session.
 */
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
/** Is every name on this certificate a loopback name? */
function namesAreLocalOnly(cert) {
    const san = cert.subjectAltName;
    if (san) {
        const entries = san.split(',').map(e => e.trim()).filter(Boolean);
        if (entries.length === 0)
            return false;
        return entries.every(entry => {
            const value = entry.slice(entry.indexOf(':') + 1).trim().toLowerCase();
            if (entry.toLowerCase().startsWith('dns:')) {
                return value === 'localhost' || value.endsWith('.localhost');
            }
            if (entry.toLowerCase().startsWith('ip address:')) {
                return value.startsWith('127.') || value === '::1'
                    || /^(0:){7}1$/.test(value) || value === '0:0:0:0:0:0:0:1';
            }
            return false;
        });
    }
    // No SAN at all: fall back to the common name.
    return /(^|,)\s*CN=localhost\s*$/i.test(cert.subject.trim());
}
function inspect(certPath) {
    let cert;
    try {
        cert = new crypto_1.default.X509Certificate(fs_1.default.readFileSync(certPath));
    }
    catch {
        return null;
    }
    const from = Date.parse(cert.validFrom);
    const to = Date.parse(cert.validTo);
    const now = Date.now();
    const usable = Number.isFinite(from) && Number.isFinite(to)
        && now >= from && now < to - RENEW_BEFORE_MS;
    return { usable, localOnly: namesAreLocalOnly(cert) };
}
/**
 * Write a fresh self-signed localhost certificate to `paths`.
 *
 * Shells out to openssl: Node can hash and parse certificates but cannot create
 * one. Returns false (rather than throwing) if openssl is unavailable, so a
 * missing tool degrades to "no HTTPS" instead of a server that will not boot.
 */
function generateDevCert(paths) {
    const altNames = process.env.DEV_CERT_ALT_NAMES
        || 'DNS:localhost,IP:127.0.0.1,IP:::1';
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(paths.certPath), { recursive: true });
        (0, child_process_1.execFileSync)('openssl', [
            'req', '-x509',
            '-newkey', 'ec',
            '-pkeyopt', 'ec_paramgen_curve:prime256v1',
            '-nodes',
            '-keyout', paths.keyPath,
            '-out', paths.certPath,
            '-days', String(DEV_VALIDITY_DAYS),
            '-subj', '/CN=localhost',
            '-addext', `subjectAltName=${altNames}`,
        ], { stdio: ['ignore', 'ignore', 'pipe'] });
        // The private key is readable only by its owner; it is still a key.
        try {
            fs_1.default.chmodSync(paths.keyPath, 0o600);
        }
        catch { /* best effort */ }
        return true;
    }
    catch (e) {
        const detail = e?.stderr?.toString().trim() || e?.message || e;
        console.warn(`[CERT] Could not generate a development certificate (is openssl installed?): ${detail}`);
        return false;
    }
}
/**
 * Decide which certificate to serve, refreshing the localhost one if needed.
 *
 * @param primary the committed `cert.crt` / `cert.key`
 * @param fallback where a generated development certificate lives
 * @returns the pair to serve with, or null if HTTPS is not possible at all
 */
function resolveTlsPaths(primary, fallback) {
    const primaryFacts = inspect(primary.certPath);
    const primaryKeyExists = fs_1.default.existsSync(primary.keyPath);
    // Rule 1: anything currently valid is used untouched.
    if (primaryFacts?.usable && primaryKeyExists) {
        return primary;
    }
    // Rule 2: never self-sign over a real hostname's certificate.
    if (primaryFacts && !primaryFacts.localOnly) {
        console.error(`[CERT] ${path_1.default.basename(primary.certPath)} is expired or not yet valid, and it is not a `
            + `localhost certificate — leaving it alone. Renew it (see update_aws.sh).`);
        return primaryKeyExists ? primary : null;
    }
    if (primaryFacts) {
        console.warn(`[CERT] ${path_1.default.basename(primary.certPath)} has expired; using a generated localhost certificate instead.`);
    }
    else if (primaryKeyExists) {
        console.warn(`[CERT] ${path_1.default.basename(primary.certPath)} is missing or unreadable; generating a localhost certificate.`);
    }
    const fallbackFacts = inspect(fallback.certPath);
    if (fallbackFacts?.usable && fs_1.default.existsSync(fallback.keyPath)) {
        return fallback;
    }
    if (!generateDevCert(fallback)) {
        // Could not make one — fall back to whatever was there, if anything.
        return primaryFacts && primaryKeyExists ? primary : null;
    }
    console.log(`[CERT] Generated ${path_1.default.basename(fallback.certPath)} for localhost `
        + `(ECDSA P-256, ${DEV_VALIDITY_DAYS} days) — regenerated automatically when it expires.`);
    return fallback;
}
