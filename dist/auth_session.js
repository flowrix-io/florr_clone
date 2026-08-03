"use strict";
/**
 * Client-side login state — the single place that decides what a browser is
 * allowed to remember about an account.
 *
 * What it remembers is an opaque session token issued by /auth/login. The
 * password is used once, in the login request, and is never written to disk.
 * Before this module the client kept the plaintext password in localStorage
 * (plus a `credentials` array of every account ever registered in that
 * browser), so anyone with a moment at the keyboard — or any XSS — walked away
 * with the accounts themselves. A token is scoped, expires, and is revoked by
 * logout; a password is none of those things.
 *
 * localStorage is still readable by whoever holds the machine, so this bounds
 * the damage rather than eliminating it. The token is not reusable anywhere
 * else and dies at logout.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServerUrl = getServerUrl;
exports.getAuthToken = getAuthToken;
exports.getUsername = getUsername;
exports.isLoggedIn = isLoggedIn;
exports.startSession = startSession;
exports.clearSession = clearSession;
exports.purgeLegacyCredentials = purgeLegacyCredentials;
exports.authHeaders = authHeaders;
exports.getSocketAuth = getSocketAuth;
exports.requestSessionToken = requestSessionToken;
exports.migrateLegacyCredentials = migrateLegacyCredentials;
const TOKEN_KEY = 'authToken';
const USERNAME_KEY = 'username';
const CURRENT_USER_KEY = 'currentUser';
const SERVER_URL_KEY = 'serverUrl';
/**
 * Pre-token storage keys. Read once by migrateLegacyCredentials() and then
 * deleted — nothing in the client writes them any more.
 */
const LEGACY_PASSWORD_KEY = 'password';
const LEGACY_CREDENTIAL_LIST_KEY = 'credentials';
const hasStorage = () => typeof localStorage !== 'undefined';
const read = (key) => {
    if (!hasStorage())
        return null;
    try {
        return localStorage.getItem(key);
    }
    catch {
        return null;
    }
};
const remove = (key) => {
    if (!hasStorage())
        return;
    try {
        localStorage.removeItem(key);
    }
    catch {
        /* private-mode storage failures are not worth breaking boot over */
    }
};
function getServerUrl() {
    return read(SERVER_URL_KEY) || window.location.origin;
}
function getAuthToken() {
    return read(TOKEN_KEY);
}
function getUsername() {
    return read(USERNAME_KEY);
}
/** True once the browser holds something it can authenticate with. */
function isLoggedIn() {
    if (!getUsername())
        return false;
    return !!getAuthToken() || !!read(LEGACY_PASSWORD_KEY);
}
/** Persist a freshly issued session. The password the user typed stops here. */
function startSession(username, token, serverUrl) {
    if (!hasStorage())
        return;
    try {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USERNAME_KEY, username);
        localStorage.setItem(CURRENT_USER_KEY, username);
        if (serverUrl)
            localStorage.setItem(SERVER_URL_KEY, serverUrl);
    }
    catch {
        /* ignore */
    }
    // A session supersedes anything the pre-token client left behind.
    purgeLegacyCredentials();
}
/**
 * Forget the local half of the session. Revoking the server half is the
 * caller's job (POST /auth/logout with the token, before calling this).
 */
function clearSession() {
    remove(TOKEN_KEY);
    remove(USERNAME_KEY);
    remove(CURRENT_USER_KEY);
    purgeLegacyCredentials();
    try {
        sessionStorage.removeItem(CURRENT_USER_KEY);
        sessionStorage.removeItem('offlineCredentials');
        sessionStorage.removeItem('isOffline');
    }
    catch {
        /* ignore */
    }
}
/**
 * Delete every plaintext credential a previous build may have stored. Called
 * on boot, so an existing player's saved passwords are wiped the first time
 * they load this version.
 */
function purgeLegacyCredentials() {
    remove(LEGACY_PASSWORD_KEY);
    remove(LEGACY_CREDENTIAL_LIST_KEY);
}
/** Authorization header for authenticated REST calls; empty when logged out. */
function authHeaders() {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
/**
 * Build the socket `authenticate` payload, or null when there is no usable
 * session. The server accepts nothing but a token, so a browser arriving with
 * pre-token storage has to finish trading its password for one first — hence
 * the await. migrateLegacyCredentials() is idempotent and resolves immediately
 * once there is nothing left to migrate, which is every load after the first.
 */
async function getSocketAuth(playerName, spawnBiome) {
    await migrateLegacyCredentials();
    const username = getUsername();
    const token = getAuthToken();
    if (!username || !token)
        return null;
    return { token, username, playerName, spawnBiome };
}
/**
 * Exchange a password for a session token. This is the only function in the
 * client that handles a password, and it does not keep one: the caller stores
 * the returned token via startSession() and lets the password go.
 */
async function requestSessionToken(serverUrl, username, password) {
    const response = await fetch(`${serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!response.ok)
        return { ok: false, status: response.status };
    const data = await response.json().catch(() => null);
    return { ok: true, token: data?.token, status: response.status };
}
let migrationPromise = null;
/**
 * One-time upgrade for browsers still holding pre-token credentials: trade the
 * stored password for a session token, then delete it. The multi-account
 * `credentials` array is dropped unconditionally — it was pure leak, nothing
 * ever authenticated with it.
 *
 * Safe to call from anywhere: the work runs once and every later caller awaits
 * the same promise. A page reload does not clear localStorage, so this is what
 * carries an already-logged-in player across the upgrade instead of dumping
 * them back at the login form.
 *
 * A network failure leaves the password in place for one more boot rather than
 * locking the player out; a 401 means it is stale anyway, so it goes.
 */
function migrateLegacyCredentials() {
    if (!migrationPromise)
        migrationPromise = runLegacyMigration();
    return migrationPromise;
}
async function runLegacyMigration() {
    if (!hasStorage())
        return;
    // Unconditional: this list is never read by anything that still exists.
    remove(LEGACY_CREDENTIAL_LIST_KEY);
    const password = read(LEGACY_PASSWORD_KEY);
    if (!password)
        return;
    const username = getUsername();
    if (!username) {
        remove(LEGACY_PASSWORD_KEY);
        return;
    }
    // Already have a token (e.g. logged in again since) — the password is dead weight.
    if (getAuthToken()) {
        remove(LEGACY_PASSWORD_KEY);
        return;
    }
    try {
        const result = await requestSessionToken(getServerUrl(), username, password);
        if (result.ok) {
            if (result.token) {
                startSession(username, result.token);
                console.log('[Auth] Upgraded stored password to a session token');
            }
            // A server too old to issue tokens keeps the password around for
            // the legacy socket path; the next load tries again.
            return;
        }
        if (result.status === 401) {
            // Stored password no longer valid; nothing is lost by dropping it.
            remove(LEGACY_PASSWORD_KEY);
        }
    }
    catch {
        // Offline or unreachable server: retry on the next load.
    }
}
