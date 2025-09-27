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
const writeDatabase = () => {
    try {
        fs.writeFileSync(inventoryPath, JSON.stringify(db, null, 2));
    }
    catch (error) {
        console.error('Error writing to database file:', error);
    }
};
readDatabase();
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
};
