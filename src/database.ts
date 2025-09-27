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
    level: number;
    xp: number;
    maxHealth: number;
    damage: number;
    inventory?: PlayerInventory;
    loadout?: (Item | null)[];
}

interface User {
    id: string;
    username: string;
    password: string; // Now stores bcrypt hashed password
    isPlainText?: boolean; // Flag to track if password needs migration
}

interface DatabaseData {
    players: { [userId: string]: PlayerProgress };
    users: { [username: string]: User };
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

const writeDatabase = () => {
    try {
        fs.writeFileSync(inventoryPath, JSON.stringify(db, null, 2));
    } catch (error) {
        console.error('Error writing to database file:', error);
    }
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
}; 