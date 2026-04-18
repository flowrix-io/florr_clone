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
const bcrypt = __importStar(require("bcrypt"));
const dbPath = path.join(__dirname, '..', 'game.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}
const inventoryPath = path.join(__dirname, 'inventory.json');
// Password hashing configuration
const SALT_ROUNDS = 12;
let db = { players: {}, users: {} };
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
        console.error('Error reading database file:', error);
    }
};
let writePending = false;
const writeDatabase = () => {
    if (writePending)
        return;
    writePending = true;
    setImmediate(() => {
        writePending = false;
        try {
            fs.writeFileSync(inventoryPath, JSON.stringify(db, null, 2));
        }
        catch (error) {
            console.error('Error writing to database file:', error);
        }
    });
};
readDatabase();
function isDefaultProgress(progress) {
    // Has gained any XP
    if (progress.totalXP > 0)
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
    // Check if a user is admin by username
    isUserAdmin: (username) => {
        const user = db.users[username];
        return user?.admin === true;
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
                // Calculate total XP using same formula as server
                // BASE_XP_REQUIREMENT = 100, XP_MULTIPLIER = 1.25
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
    // Remove invalid eggs from all player inventories and loadouts
    removeInvalidEggs: (invalidEggTypes) => {
        let cleaned = 0;
        for (const userId in db.players) {
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
                    if (item && item.petalType && invalidEggTypes.has(item.petalType)) {
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
    // Get leaderboard data: all accounts sorted by totalXP descending
    getLeaderboard: (limit = 50) => {
        const entries = [];
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        let dailyActiveUsers = 0;
        for (const username in db.users) {
            const user = db.users[username];
            const progress = db.players[user.id];
            const totalXP = progress?.totalXP || 0;
            entries.push({ username, totalXP });
            if (user.lastActiveAt && user.lastActiveAt >= dayAgo) {
                dailyActiveUsers++;
            }
        }
        const totalAccounts = entries.length;
        // Sort by totalXP descending
        entries.sort((a, b) => b.totalXP - a.totalXP);
        return { entries: entries.slice(0, limit), totalAccounts, dailyActiveUsers };
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
