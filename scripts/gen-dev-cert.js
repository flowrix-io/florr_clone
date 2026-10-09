#!/usr/bin/env node
/**
 * Writes a fresh localhost development certificate, `dev-cert.crt` and
 * `dev-cert.key`.
 *
 *   npm run dev:cert                     # into the repository root
 *   node scripts/gen-dev-cert.js <dir>   # into another server directory
 *
 * The default is the repository root because that is the working directory
 * `npm start` runs the server in, and the working directory is where the
 * server looks for its certificates: cert.crt/cert.key first, then this pair
 * (cpp/shared/net/web_channel.cpp).
 *
 * This script is the only thing that writes the pair. The C++ server never
 * generates or renews a certificate: when the one it has to serve has expired
 * it says so in its log and serves it anyway, and browsers refuse it. Run this
 * again when that happens, after changing DEV_CERT_ALT_NAMES, or to read the
 * digest a client would pin.
 *
 * The certificate is ECDSA P-256 with a 13-day life, which is what browsers
 * require before they will accept it pinned by hash over WebTransport: the
 * server publishes the digest of a certificate that short-lived at
 * /transport-info and the client pins it, so local WebTransport needs no
 * trust-store setup. The flip side is that it expires quickly.
 *
 * Env:
 *   DEV_CERT_ALT_NAMES   the subjectAltName list
 *                        (default DNS:localhost,IP:127.0.0.1,IP:::1)
 *
 * Needs the openssl command line tool: Node can parse and hash a certificate
 * but cannot create one. Ported from the TypeScript server's
 * src/server/devCert.ts (in git history at d47055a7), which regenerated the
 * pair on boot.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Days the certificate is valid for: 14 or fewer, or it cannot be pinned. */
const VALIDITY_DAYS = 13;

const root = path.resolve(__dirname, '..');
const dir = path.resolve(process.argv[2] || root);
const certPath = path.join(dir, 'dev-cert.crt');
const keyPath = path.join(dir, 'dev-cert.key');
const altNames = process.env.DEV_CERT_ALT_NAMES || 'DNS:localhost,IP:127.0.0.1,IP:::1';

try {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', [
        'req', '-x509',
        '-newkey', 'ec',
        '-pkeyopt', 'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout', keyPath,
        '-out', certPath,
        '-days', String(VALIDITY_DAYS),
        '-subj', '/CN=localhost',
        '-addext', `subjectAltName=${altNames}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
    const detail = (e.stderr && e.stderr.toString().trim()) || e.message || String(e);
    console.error(`Could not generate a development certificate (is openssl installed?): ${detail}`);
    process.exit(1);
}

// The private key is readable only by its owner; it is still a key.
try {
    fs.chmodSync(keyPath, 0o600);
} catch (e) {
    console.warn(`Could not restrict ${keyPath} to its owner: ${e.message}`);
}

const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
const digest = crypto.createHash('sha256').update(cert.raw).digest('base64');

const shown = (file) => {
    const relative = path.relative(process.cwd(), file);
    return relative.startsWith('..') || path.isAbsolute(relative) ? file : relative;
};
console.log(`Wrote ${shown(certPath)} and ${shown(keyPath)}`);
console.log(`Valid until ${cert.validTo} · SHA-256 (base64): ${digest}`);
