#!/usr/bin/env node
/**
 * Force-regenerate the localhost development certificate (`dev-cert.crt` /
 * `dev-cert.key`).
 *
 * You normally do not need this: the server generates the certificate on boot
 * when the committed `cert.crt` has expired, and regenerates it again whenever
 * it lapses (see src/server/devCert.ts). Run this to get a fresh one on demand —
 * after changing DEV_CERT_ALT_NAMES, say, or to read the digest a client would
 * pin.
 *
 *   npm run dev:cert
 *
 * The certificate is ECDSA P-256 with a 13-day life, which is what browsers
 * require before they will accept it pinned by hash over WebTransport.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const paths = {
    certPath: path.join(root, 'dev-cert.crt'),
    keyPath: path.join(root, 'dev-cert.key'),
};

let generateDevCert;
try {
    ({ generateDevCert } = require(path.join(root, 'dist/server/devCert.js')));
} catch {
    console.error('dist/server/devCert.js not found — run `npm run build:server` first.');
    process.exit(1);
}

if (!generateDevCert(paths)) process.exit(1);

const der = new crypto.X509Certificate(fs.readFileSync(paths.certPath)).raw;
const digest = crypto.createHash('sha256').update(der).digest('base64');
const cert = new crypto.X509Certificate(fs.readFileSync(paths.certPath));

console.log(`Wrote ${path.relative(root, paths.certPath)} and ${path.relative(root, paths.keyPath)}`);
console.log(`Valid until ${cert.validTo} · SHA-256 (base64): ${digest}`);
