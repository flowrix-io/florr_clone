import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { Item } from './item';

const dbPath = path.join(__dirname, '..', 'game.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

const inventoryPath = path.join(__dirname, 'inventory.json');

// Password hashing configuration
const SALT_ROUNDS = 12;

interface PlayerInventory {
    [rarity: string]: {
        [itemType: string]: number;
    };
}

export interface PlayerProgress {
    totalXP: number; // Total XP accumulated (level, maxHealth, damage calculated from this)
    inventory?: PlayerInventory;
    loadout?: (Item | null)[];
    mobKills?: { [mobType: string]: { [rarity: string]: number } }; // Track mob kills: mobType -> rarity -> count
    stars?: number; // In-game currency earned from challenges and codes
}

interface User {
    id: string;
    username: string;
    password: string; // Now stores bcrypt hashed password
    isPlainText?: boolean; // Flag to track if password needs migration
    admin?: boolean; // Admin flag for server command access
}

export interface RedeemedCode {
    code: string;
    stars: number;
    maxUses?: number; // Optional: limit how many times code can be used
    uses: number;
    usedBy?: string[]; // Track which users have used this code
    createdBy?: string; // Admin who created the code
    createdAt?: number; // Timestamp when code was created
}

export interface Notification {
    id: string;
    type: 'super_craft' | 'unique_craft' | 'star_code';
    message: string;
    timestamp: number;
}

interface DatabaseData {
    players: { [userId: string]: PlayerProgress };
    users: { [username: string]: User };
    codes?: { [code: string]: RedeemedCode }; // Store codes persistently
    notifications?: Notification[]; // Global notifications array
}

let db: DatabaseData = { players: {}, users: {} };

const readDatabase = () => {
    try {
        if (fs.existsSync(inventoryPath)) {
            const data = fs.readFileSync(inventoryPath, 'utf-8');
            db = JSON.parse(data);
        } else {
            fs.writeFileSync(inventoryPath, JSON.stringify(db, null, 2));
        }
    } catch (error) {
        console.error('Error reading database file:', error);
    }
};

let writePending = false;
const writeDatabase = () => {
    if (writePending) return;
    writePending = true;
    setImmediate(() => {
        writePending = false;
        try {
            fs.writeFileSync(inventoryPath, JSON.stringify(db, null, 2));
        } catch (error) {
            console.error('Error writing to database file:', error);
        }
    });
};

readDatabase();


export const database = {
    // User-related functions
    createUser: (username: string, password: string): User | null => {
        if (db.users[username]) {
            return null; // User already exists
        }
        const userId = Math.random().toString(36).substr(2, 9);
        const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);
        const newUser: User = { id: userId, username, password: hashedPassword };
        db.users[username] = newUser;
        writeDatabase();
        return newUser;
    },

    getUser: (username: string, password: string): User | null => {
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
                db.users[username] = user;
                writeDatabase();
                return user;
            }
            return null;
        }

        // This is a hashed password - use bcrypt to compare
        if (bcrypt.compareSync(password, user.password)) {
            return user;
        }
        return null;
    },

    // Check if a user is admin by username
    isUserAdmin: (username: string): boolean => {
        const user = db.users[username];
        return user?.admin === true;
    },

    // Player-related functions
    savePlayer: (userId: string, progress: PlayerProgress) => {
        db.players[userId] = {
            ...db.players[userId],
            ...progress
        };
        writeDatabase();
        return true;
    },

    getPlayerByUserId: (userId:string): PlayerProgress | null => {
        return db.players[userId] || null;
    },

    // Migration function to upgrade all plain text passwords to hashed passwords
    migratePasswords: (): number => {
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
    checkForPlainTextPasswords: (): boolean => {
        for (const username in db.users) {
            const user = db.users[username];
            if (user.isPlainText || !user.password.startsWith('$2b$')) {
                return true;
            }
        }
        return false;
    },

    // Migrate old player data format (level, xp, maxHealth, damage) to new format (totalXP)
    migratePlayerData: (): number => {
        let migrated = 0;
        for (const userId in db.players) {
            const player = db.players[userId] as any; // Use any for migration to handle old format
            // Check if this is old format (has level and xp but not totalXP)
            if ('level' in player && 'xp' in player && !('totalXP' in player)) {
                // Calculate total XP from old level and xp
                const level = player.level || 1;
                const currentLevelXP = player.xp || 0;
                
                // Calculate total XP using same formula as server
                // BASE_XP_REQUIREMENT = 100, XP_MULTIPLIER = 1.25
                const BASE_XP_REQUIREMENT = 100;
                const XP_MULTIPLIER = 1.25;
                
                const calculateXPRequirement = (lvl: number): number => {
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
                } as PlayerProgress;
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
    removeInvalidEggs: (invalidEggTypes: Set<string>): number => {
        let cleaned = 0;
        for (const userId in db.players) {
            const player = db.players[userId];
            if (!player) continue;
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
    saveCode: (code: string, codeData: RedeemedCode) => {
        if (!db.codes) {
            db.codes = {};
        }
        db.codes[code] = codeData;
        writeDatabase();
        return true;
    },

    deleteCode: (code: string) => {
        if (db.codes && db.codes[code]) {
            delete db.codes[code];
            writeDatabase();
            return true;
        }
        return false;
    },

    getAllCodes: (): { [code: string]: RedeemedCode } => {
        return db.codes || {};
    },

    updateCode: (code: string, codeData: RedeemedCode) => {
        if (!db.codes) {
            db.codes = {};
        }
        db.codes[code] = codeData;
        writeDatabase();
        return true;
    },

    // Notification-related functions
    addNotification: (notification: Notification) => {
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

    getNotifications: (limit: number = 50, beforeTimestamp?: number): Notification[] => {
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

    // Delete all guest accounts (usernames matching "User" + 8 digits)
    deleteGuestAccounts: (): number => {
        const guestPattern = /^User\d{8}$/;
        let deleted = 0;
        for (const username in db.users) {
            if (guestPattern.test(username)) {
                const userId = db.users[username].id;
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