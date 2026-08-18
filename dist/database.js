"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.database = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const bcrypt = __importStar(require("bcrypt"));
const dbPath = path.join(__dirname, '..', 'game.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}
const inventoryPath = path.join(__dirname, 'inventory.json');
/** Staging file for the atomic write in writeDatabase(); never read at startup. */
const tmpPath = inventoryPath + '.tmp';
// Database backups: timestamped snapshots of inventory.json, kept one level
// above the runtime dir (outside dist/) so redeploys can't delete them.
const backupDir = path.join(__dirname, '..', 'db_backups');
const BACKUP_FILE_PATTERN = /^inventory-.*\.json$/;
const MAX_DB_BACKUPS = 30;
const pruneOldBackups = () => {
    try {
        const backups = fs.readdirSync(backupDir)
            .filter(f => BACKUP_FILE_PATTERN.test(f))
            .map(f => ({ f, mtimeMs: fs.statSync(path.join(backupDir, f)).mtimeMs }))
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const { f } of backups.slice(MAX_DB_BACKUPS)) {
            fs.unlinkSync(path.join(backupDir, f));
        }
    }
    catch (error) {
        // Pruning is best-effort; never let it fail a successful backup.
        console.error('Error pruning old database backups:', error);
    }
};
// Password hashing configuration
const SALT_ROUNDS = 12;
// Session configuration. A session token is what a logged-in browser keeps —
// the password is never persisted client-side, so a shared or stolen machine
// leaks at most one revocable, expiring handle instead of the account itself.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Only the hash is stored, so a leaked inventory.json hands out no live sessions. */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
let db = { players: {}, users: {} };
/**
 * Set when the database file exists but could not be loaded. Every write is
 * then refused: the in-memory db is the empty default, and persisting it would
 * turn a recoverable bad file into permanent, total account loss. Operator has
 * to restore from db_backups and restart.
 */
let loadFailed = false;
const readDatabase = () => {
    try {
        if (fs.existsSync(inventoryPath)) {
            const data = fs.readFileSync(inventoryPath, 'utf-8');
            db = JSON.parse(data);
        }
        else {
            fs.writeFileSync(inventoryPath, JSON.stringify(db, null, 2));
        }
    }
    catch (error) {
        loadFailed = true;
        console.error('Error reading database file:', error);
        console.error(`[DATABASE] FATAL: ${inventoryPath} exists but could not be loaded. ` +
            'Refusing all writes so the file is not overwritten with an empty database. ' +
            'Restore from db_backups and restart.');
    }
};
let writePending = false;
const writeDatabase = () => {
    if (loadFailed)
        return;
    if (writePending)
        return;
    writePending = true;
    setImmediate(() => {
        writePending = false;
        try {
            // Write-then-rename, never in place. writeFileSync truncates its
            // target before writing, so a crash partway through (the process
            // has died on heap exhaustion before) used to leave inventory.json
            // half-written. readDatabase's JSON.parse would then throw, the
            // catch would swallow it, the server would come up on an EMPTY db,
            // and the next save would persist that emptiness over the ruined
            // file — every account gone. rename(2) is atomic within a
            // filesystem, so a crash now leaves the previous good file intact.
            const json = JSON.stringify(db, null, 2);
            fs.writeFileSync(tmpPath, json);
            // Parse the bytes back off disk before they replace the live file:
            // a short write or bad encoding must never be promoted (mirrors the
            // read-back check backupDatabase already does).
            JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
            fs.renameSync(tmpPath, inventoryPath);
        }
        catch (error) {
            console.error('Error writing to database file:', error);
            try {
                if (fs.existsSync(tmpPath))
                    fs.unlinkSync(tmpPath);
            }
            catch { }
        }
    });
};
readDatabase();
/**
 * Drop expired sessions. Cheap and rare (login/logout only), so it just walks
 * the map — it never grows past one entry per logged-in browser.
 * Returns true when something was removed, so callers can skip a write.
 */
const pruneExpiredSessions = () => {
    if (!db.sessions)
        return false;
    const now = Date.now();
    let removed = false;
    for (const tokenHash in db.sessions) {
        if (db.sessions[tokenHash].expiresAt <= now) {
            delete db.sessions[tokenHash];
            removed = true;
        }
    }
    return removed;
};
if (pruneExpiredSessions())
    writeDatabase();
function isDefaultProgress(progress) {
    // Has gained any XP
    if (progress.totalXP > 0)
        return false;
    // Owns/equips a custom skin — that's account content worth keeping
    if (progress.renderFlags)
        return false;
    if (progress.equippedSkinId)
        return false;
    // Check inventory: default is only { common: { petal_basic: 5 } }
    if (progress.inventory) {
        const rarities = Object.keys(progress.inventory);
        if (rarities.length === 0)
            return true; // empty inventory counts as default
        if (rarities.length > 1)
            return false;
        if (rarities[0] !== 'common')
            return false;
        const items = progress.inventory['common'];
        const itemTypes = Object.keys(items);
        if (itemTypes.length > 1)
            return false;
        if (itemTypes.length === 1 && (itemTypes[0] !== 'petal_basic' || items['petal_basic'] !== 5))
            return false;
    }
    // Check loadout: default is 5 basic common petals
    if (progress.loadout) {
        for (const slot of progress.loadout) {
            if (slot && (slot.petalType !== 'basic' || slot.rarity !== 'common'))
                return false;
        }
    }
    return true;
}
/**
 * Top-10/top-20 leaderboard userIds, cached: computing this is a full sort over
 * every account, and it's consulted on every mob kill (via
 * getLeaderboardRewardMultipliers) to grant the leaderboard reward tiers, so a
 * fresh sort per kill would be far too hot. Refreshed lazily at most every 15s.
 */
let cachedTopRankUserIds = null;
let cachedTopRankUserIdsAt = 0;
const TOP_RANK_CACHE_MS = 15000;
/**
 * Resolve `username` to the key it is actually stored under — accounts keep the
 * casing they registered with, but admins type names as they see them in chat.
 */
function findUsernameKey(username) {
    if (!username)
        return null;
    if (db.users[username])
        return username;
    const key = username.toLowerCase();
    for (const name in db.users) {
        if (name.toLowerCase() === key)
            return name;
    }
    return null;
}
exports.database = {
    // User-related functions
    createUser: (username, password) => {
        if (db.users[username]) {
            return null; // User already exists
        }
        const userId = Math.random().toString(36).substr(2, 9);
        const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);
        const newUser = { id: userId, username, password: hashedPassword };
        db.users[username] = newUser;
        writeDatabase();
        return newUser;
    },
    getUser: (username, password) => {
        const user = db.users[username];
        if (!user) {
            return null;
        }
        // Check if this is a plain text password (for migration)
        if (user.isPlainText || !user.password.startsWith('$2b$')) {
            // This is a plain text password - check it and migrate to hash
            if (user.password === password) {
                console.log(`Migrating password for user: ${username}`);
                const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);
                user.password = hashedPassword;
                user.isPlainText = false;
                user.lastActiveAt = Date.now();
                db.users[username] = user;
                writeDatabase();
                return user;
            }
            return null;
        }
        // This is a hashed password - use bcrypt to compare
        if (bcrypt.compareSync(password, user.password)) {
            user.lastActiveAt = Date.now();
            writeDatabase();
            return user;
        }
        return null;
    },
    /**
     * Mint a login session for an already-authenticated user and return the raw
     * token. This is the only time the raw token exists server-side — only its
     * hash is kept, so it cannot be recovered from the database or a backup.
     */
    createSession: (user) => {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const now = Date.now();
        if (!db.sessions)
            db.sessions = {};
        pruneExpiredSessions();
        db.sessions[tokenHash] = {
            tokenHash,
            userId: user.id,
            username: user.username,
            createdAt: now,
            expiresAt: now + SESSION_TTL_MS
        };
        writeDatabase();
        return token;
    },
    /** Resolve a session token to its user, or null if unknown/expired/orphaned. */
    getUserBySession: (token) => {
        if (!token || typeof token !== 'string' || !db.sessions)
            return null;
        const session = db.sessions[hashToken(token)];
        if (!session)
            return null;
        if (session.expiresAt <= Date.now()) {
            delete db.sessions[session.tokenHash];
            writeDatabase();
            return null;
        }
        // The account may have been renamed or deleted since the session was
        // issued; a session must never resurrect or reassign one.
        const user = db.users[session.username];
        if (!user || user.id !== session.userId) {
            delete db.sessions[session.tokenHash];
            writeDatabase();
            return null;
        }
        user.lastActiveAt = Date.now();
        writeDatabase();
        return user;
    },
    /** Revoke a single session (logout). Unknown tokens are a no-op. */
    destroySession: (token) => {
        if (!token || typeof token !== 'string' || !db.sessions)
            return;
        const tokenHash = hashToken(token);
        if (db.sessions[tokenHash]) {
            delete db.sessions[tokenHash];
            writeDatabase();
        }
    },
    /** Revoke every session belonging to a user (password change, ban, admin action). */
    destroySessionsForUser: (username) => {
        if (!db.sessions)
            return 0;
        let revoked = 0;
        for (const tokenHash in db.sessions) {
            if (db.sessions[tokenHash].username === username) {
                delete db.sessions[tokenHash];
                revoked++;
            }
        }
        if (revoked > 0)
            writeDatabase();
        return revoked;
    },
    // Check if a user is admin by username
    isUserAdmin: (username) => {
        const user = db.users[username];
        return user?.admin === true;
    },
    /** The stored spelling of `username`, or null if no such account exists. */
    getCanonicalUsername: (username) => findUsernameKey(username),
    // Is this account barred from chat? Consulted on every chat send, so it stays
    // a plain map lookup — the case-insensitive walk is only the fallback for the
    // rare caller that doesn't already hold the canonical username.
    isUserMuted: (username) => {
        if (!username)
            return false;
        const user = db.users[username] || db.users[findUsernameKey(username) || ''];
        return user?.muted === true;
    },
    /**
     * Mute or unmute an account for chat. Works on offline accounts too, since
     * the flag lives on the user record. Returns the canonical username on
     * success, or null if no such account exists.
     */
    setUserMuted: (username, muted, mutedBy) => {
        const key = db.users[username] ? username : findUsernameKey(username);
        if (!key)
            return null;
        const user = db.users[key];
        if (muted) {
            user.muted = true;
            user.mutedAt = Date.now();
            user.mutedBy = mutedBy || 'console';
        }
        else {
            delete user.muted;
            delete user.mutedAt;
            delete user.mutedBy;
        }
        writeDatabase();
        return key;
    },
    // Case-insensitive lookup of registered users, used to validate guild targets
    // before inviting/force-joining since usernames are stored with their original casing.
    userExists: (username) => {
        if (!username)
            return false;
        if (db.users[username])
            return true;
        const key = username.toLowerCase();
        for (const name in db.users) {
            if (name.toLowerCase() === key)
                return true;
        }
        return false;
    },
    // Case-insensitive username -> userId lookup, used by admin commands (e.g. `give`)
    // that need to act on an account whether or not it's currently connected.
    getUserIdByUsername: (username) => {
        if (!username)
            return null;
        if (db.users[username])
            return db.users[username].id;
        const key = username.toLowerCase();
        for (const name in db.users) {
            if (name.toLowerCase() === key)
                return db.users[name].id;
        }
        return null;
    },
    // Player-related functions
    savePlayer: (userId, progress) => {
        db.players[userId] = {
            ...db.players[userId],
            ...progress
        };
        writeDatabase();
        return true;
    },
    getPlayerByUserId: (userId) => {
        return db.players[userId] || null;
    },
    // Daily streak: awards stars on the first login of each UTC day.
    // Streak cycles 1..5 (1⭐, 2⭐, 3⭐, 4⭐, 5⭐ then wraps). Missed days reset to 1.
    // - nextClaimAtMs: UTC epoch ms when the next claim window opens (next UTC midnight
    //   if already claimed, or now if unclaimed).
    // - streakExpiresAtMs: UTC epoch ms when the streak lapses if unclaimed — the end
    //   of the day after the next claim window (i.e. two UTC midnights from last claim).
    processDailyStreak: (userId) => {
        const progress = db.players[userId] || { totalXP: 0 };
        const today = new Date().toISOString().slice(0, 10);
        const todayUtcMs = Date.parse(today + 'T00:00:00Z');
        const msPerDay = 86400000;
        const last = progress.lastStreakDate;
        let starsAwarded = 0;
        let newDay = false;
        let streak = progress.dailyStreak || 0;
        if (last === today) {
            // Already claimed today — no award, streak as-is.
        }
        else {
            if (last) {
                const lastMs = Date.parse(last + 'T00:00:00Z');
                const dayDiff = Math.round((todayUtcMs - lastMs) / msPerDay);
                streak = dayDiff === 1 ? streak + 1 : 1;
            }
            else {
                streak = 1;
            }
            starsAwarded = ((streak - 1) % 5) + 1;
            progress.dailyStreak = streak;
            progress.lastStreakDate = today;
            progress.stars = (progress.stars || 0) + starsAwarded;
            db.players[userId] = progress;
            writeDatabase();
            newDay = true;
        }
        const claimedToday = progress.lastStreakDate === today;
        const nextClaimAtMs = claimedToday ? todayUtcMs + msPerDay : Date.now();
        // Streak expires at the end of the day after the next claim window.
        const streakExpiresAtMs = claimedToday ? todayUtcMs + 2 * msPerDay : todayUtcMs + msPerDay;
        return { starsAwarded, streak, newDay, nextClaimAtMs, streakExpiresAtMs };
    },
    // Migration function to upgrade all plain text passwords to hashed passwords
    migratePasswords: () => {
        let migrated = 0;
        for (const username in db.users) {
            const user = db.users[username];
            if (user.isPlainText || !user.password.startsWith('$2b$')) {
                console.log(`Migrating password for user: ${username}`);
                const hashedPassword = bcrypt.hashSync(user.password, SALT_ROUNDS);
                user.password = hashedPassword;
                user.isPlainText = false;
                migrated++;
            }
        }
        if (migrated > 0) {
            writeDatabase();
            console.log(`Successfully migrated ${migrated} passwords to hashed format`);
        }
        return migrated;
    },
    // Check if there are any plain text passwords that need migration
    checkForPlainTextPasswords: () => {
        for (const username in db.users) {
            const user = db.users[username];
            if (user.isPlainText || !user.password.startsWith('$2b$')) {
                return true;
            }
        }
        return false;
    },
    // Migrate old player data format (level, xp, maxHealth, damage) to new format (totalXP)
    migratePlayerData: () => {
        let migrated = 0;
        for (const userId in db.players) {
            const player = db.players[userId]; // Use any for migration to handle old format
            // Check if this is old format (has level and xp but not totalXP)
            if ('level' in player && 'xp' in player && !('totalXP' in player)) {
                // Calculate total XP from old level and xp
                const level = player.level || 1;
                const currentLevelXP = player.xp || 0;
                // Historical curve: these records were written before the
                // 2025-11 XP rework, so they must be converted with the
                // multiplier that was live then (1.25), NOT the current
                // XP_MULTIPLIER in constants.ts.
                const BASE_XP_REQUIREMENT = 100;
                const XP_MULTIPLIER = 1.25;
                const calculateXPRequirement = (lvl) => {
                    return Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, lvl - 1));
                };
                let totalXP = currentLevelXP;
                for (let i = 1; i < level; i++) {
                    totalXP += calculateXPRequirement(i);
                }
                // Update to new format
                db.players[userId] = {
                    totalXP: totalXP,
                    inventory: player.inventory,
                    loadout: player.loadout
                };
                migrated++;
            }
        }
        if (migrated > 0) {
            writeDatabase();
            console.log(`Successfully migrated ${migrated} players to new XP format`);
        }
        return migrated;
    },
    // Remove invalid eggs from all player inventories and loadouts.
    // `invalidEggTypes` holds inventory keys like `petal_<mob>_egg`; the loadout
    // stores `petalType` without the `petal_` prefix, so we check both forms.
    // Admin accounts are exempt: unobtainable eggs are kept for them so admins can
    // still hold/use eggs for mobs flagged noEggDrop.
    removeInvalidEggs: (invalidEggTypes) => {
        const invalidLoadoutPetalTypes = new Set();
        for (const key of invalidEggTypes) {
            invalidLoadoutPetalTypes.add(key.startsWith('petal_') ? key.slice('petal_'.length) : key);
        }
        // Collect the userIds of admin accounts. `db.players` is keyed by userId
        // while the admin flag lives on the User record (keyed by username), so we
        // map admins back to their userId to skip them below.
        const adminUserIds = new Set();
        for (const username in db.users) {
            const user = db.users[username];
            if (user?.admin === true)
                adminUserIds.add(user.id);
        }
        let cleaned = 0;
        for (const userId in db.players) {
            if (adminUserIds.has(userId))
                continue;
            const player = db.players[userId];
            if (!player)
                continue;
            let playerModified = false;
            // Clean inventory
            if (player.inventory) {
                for (const rarity in player.inventory) {
                    for (const itemType in player.inventory[rarity]) {
                        if (invalidEggTypes.has(itemType)) {
                            delete player.inventory[rarity][itemType];
                            playerModified = true;
                        }
                    }
                    // Clean up empty rarity objects
                    if (Object.keys(player.inventory[rarity]).length === 0) {
                        delete player.inventory[rarity];
                    }
                }
            }
            // Clean loadout
            if (player.loadout) {
                for (let i = 0; i < player.loadout.length; i++) {
                    const item = player.loadout[i];
                    if (item && item.petalType && invalidLoadoutPetalTypes.has(item.petalType)) {
                        player.loadout[i] = null;
                        playerModified = true;
                    }
                }
            }
            if (playerModified) {
                cleaned++;
            }
        }
        if (cleaned > 0) {
            writeDatabase();
        }
        return cleaned;
    },
    // Code-related functions
    saveCode: (code, codeData) => {
        if (!db.codes) {
            db.codes = {};
        }
        db.codes[code] = codeData;
        writeDatabase();
        return true;
    },
    deleteCode: (code) => {
        if (db.codes && db.codes[code]) {
            delete db.codes[code];
            writeDatabase();
            return true;
        }
        return false;
    },
    getAllCodes: () => {
        return db.codes || {};
    },
    updateCode: (code, codeData) => {
        if (!db.codes) {
            db.codes = {};
        }
        db.codes[code] = codeData;
        writeDatabase();
        return true;
    },
    // Notification-related functions
    addNotification: (notification) => {
        if (!db.notifications) {
            db.notifications = [];
        }
        db.notifications.push(notification);
        // Keep only last 1000 notifications in memory
        if (db.notifications.length > 1000) {
            db.notifications = db.notifications.slice(-1000);
        }
        writeDatabase();
        return true;
    },
    getNotifications: (limit = 50, beforeTimestamp) => {
        if (!db.notifications) {
            return [];
        }
        let filtered = [...db.notifications];
        // Filter by timestamp if provided (for pagination)
        if (beforeTimestamp) {
            filtered = filtered.filter(n => n.timestamp < beforeTimestamp);
        }
        // Sort by timestamp descending (newest first)
        filtered.sort((a, b) => b.timestamp - a.timestamp);
        // Return limited results
        return filtered.slice(0, limit);
    },
    clearAllNotifications: () => {
        if (!db.notifications) {
            return 0;
        }
        const count = db.notifications.length;
        db.notifications = [];
        writeDatabase();
        return count;
    },
    // API key management for the external REST API.
    // Keys are stored verbatim — operators add them by editing inventory.json or via
    // an admin tool, then attach them as the X-API-Key header on requests.
    saveApiKey: (entry) => {
        if (!db.apiKeys)
            db.apiKeys = {};
        db.apiKeys[entry.key] = entry;
        writeDatabase();
        return true;
    },
    deleteApiKey: (key) => {
        if (db.apiKeys && db.apiKeys[key]) {
            delete db.apiKeys[key];
            writeDatabase();
            return true;
        }
        return false;
    },
    getApiKey: (key) => {
        return (db.apiKeys && db.apiKeys[key]) || null;
    },
    getAllApiKeys: () => {
        return db.apiKeys ? Object.values(db.apiKeys) : [];
    },
    // Get leaderboard data: non-admin accounts sorted by totalXP descending by default.
    getLeaderboard: (limit = 50, includeAdmins = false) => {
        const entries = [];
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        let dailyActiveUsers = 0;
        for (const username in db.users) {
            const user = db.users[username];
            if (user.lastActiveAt && user.lastActiveAt >= dayAgo) {
                dailyActiveUsers++;
            }
            if (!includeAdmins && user.admin === true) {
                continue;
            }
            const progress = db.players[user.id];
            const totalXP = progress?.totalXP || 0;
            entries.push({ username, totalXP });
        }
        const totalAccounts = entries.length;
        // Sort by totalXP descending
        entries.sort((a, b) => b.totalXP - a.totalXP);
        return { entries: entries.slice(0, limit), totalAccounts, dailyActiveUsers };
    },
    // userIds of the current top-10/top-20 accounts by totalXP (non-admin), cached — see TOP_RANK_CACHE_MS.
    getTopRankUserIds: () => {
        const now = Date.now();
        if (cachedTopRankUserIds && now - cachedTopRankUserIdsAt < TOP_RANK_CACHE_MS) {
            return cachedTopRankUserIds;
        }
        const entries = [];
        for (const username in db.users) {
            const user = db.users[username];
            if (user.admin === true)
                continue;
            const progress = db.players[user.id];
            entries.push({ userId: user.id, totalXP: progress?.totalXP || 0 });
        }
        entries.sort((a, b) => b.totalXP - a.totalXP);
        cachedTopRankUserIds = {
            top10: new Set(entries.slice(0, 10).map(e => e.userId)),
            top20: new Set(entries.slice(0, 20).map(e => e.userId)),
        };
        cachedTopRankUserIdsAt = now;
        return cachedTopRankUserIds;
    },
    // Reward multipliers for the leaderboard's top 10 / top 20 accounts:
    // top 10 get 1.2x drop rate but 0.5x mob XP, top 20 get 1.1x drop rate but 0.75x mob XP.
    getLeaderboardRewardMultipliers: (userId) => {
        if (!userId)
            return { xpMultiplier: 1, dropMultiplier: 1 };
        const { top10, top20 } = exports.database.getTopRankUserIds();
        if (top10.has(userId))
            return { xpMultiplier: 0.5, dropMultiplier: 1.2 };
        if (top20.has(userId))
            return { xpMultiplier: 0.75, dropMultiplier: 1.1 };
        return { xpMultiplier: 1, dropMultiplier: 1 };
    },
    // Get users who have authenticated within the last 24 hours
    getTodayLogins: () => {
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const active = [];
        for (const username in db.users) {
            const user = db.users[username];
            if (user.lastActiveAt && user.lastActiveAt >= dayAgo) {
                active.push({ username, lastActiveAt: user.lastActiveAt });
            }
        }
        active.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
        return active;
    },
    // Guild-related functions
    saveGuild: (guild) => {
        if (!db.guilds)
            db.guilds = {};
        db.guilds[guild.name] = {
            name: guild.name,
            leaderUsername: guild.leaderUsername,
            memberUsernames: guild.memberUsernames.slice(),
            createdAt: guild.createdAt,
        };
        writeDatabase();
        return true;
    },
    deleteGuild: (guildName) => {
        if (db.guilds && db.guilds[guildName]) {
            delete db.guilds[guildName];
            writeDatabase();
            return true;
        }
        return false;
    },
    getAllGuilds: () => {
        return db.guilds || {};
    },
    // ── Custom (user-created) skins ───────────────────────────────────────
    // Collection is lazily created so older inventory.json files load fine.
    saveCustomSkin: (skin) => {
        if (!db.customSkins)
            db.customSkins = {};
        db.customSkins[skin.id] = {
            id: skin.id,
            name: skin.name,
            author: skin.author,
            shapes: skin.shapes,
            createdAt: skin.createdAt,
        };
        writeDatabase();
        return true;
    },
    getCustomSkin: (skinId) => {
        return (db.customSkins && db.customSkins[skinId]) || null;
    },
    getAllCustomSkins: () => {
        return db.customSkins ? Object.values(db.customSkins) : [];
    },
    countCustomSkinsByAuthor: (author) => {
        if (!db.customSkins)
            return 0;
        const lower = author.toLowerCase();
        let n = 0;
        for (const id in db.customSkins) {
            if (db.customSkins[id].author.toLowerCase() === lower)
                n++;
        }
        return n;
    },
    deleteCustomSkin: (skinId) => {
        if (db.customSkins && db.customSkins[skinId]) {
            delete db.customSkins[skinId];
            writeDatabase();
            return true;
        }
        return false;
    },
    // ── Database backups ──────────────────────────────────────────────────
    // Snapshots the in-memory db (the authoritative state — a debounced write
    // to inventory.json may still be pending) to a timestamped file. Backups
    // live OUTSIDE dist/ because full redeploys (update_aws.sh) rm -rf dist;
    // in prod that puts them in ~/db_backups, in dev at the repo root.
    backupDatabase: (label = 'manual') => {
        const safeLabel = label.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'manual';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.mkdirSync(backupDir, { recursive: true });
        const file = path.join(backupDir, `inventory-${timestamp}-${safeLabel}.json`);
        const json = JSON.stringify(db, null, 2);
        fs.writeFileSync(file, json);
        // Read back and parse so a truncated/corrupt write can never pass as a
        // good backup (callers abort updates when this throws).
        JSON.parse(fs.readFileSync(file, 'utf-8'));
        pruneOldBackups();
        return { file, bytes: Buffer.byteLength(json) };
    },
    listDatabaseBackups: () => {
        if (!fs.existsSync(backupDir))
            return [];
        return fs.readdirSync(backupDir)
            .filter(f => BACKUP_FILE_PATTERN.test(f))
            .map(f => {
            const stat = fs.statSync(path.join(backupDir, f));
            return { file: path.join(backupDir, f), bytes: stat.size, mtimeMs: stat.mtimeMs };
        })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
    },
    // Delete guest accounts that still have the default initial inventory/loadout
    deleteGuestAccounts: () => {
        const guestPattern = /^User\d{8}$/;
        let deleted = 0;
        for (const username in db.users) {
            if (guestPattern.test(username)) {
                const userId = db.users[username].id;
                const progress = db.players[userId];
                // Skip guests that have progressed beyond the initial state
                if (progress && !isDefaultProgress(progress)) {
                    continue;
                }
                // Remove player progress data
                delete db.players[userId];
                // Remove user account
                delete db.users[username];
                deleted++;
            }
        }
        if (deleted > 0) {
            writeDatabase();
        }
        return deleted;
    },
};
