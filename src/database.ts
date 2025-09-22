import * as fs from 'fs';
import * as path from 'path';
import { Item } from './item';

const dbPath = path.join(__dirname, '..', 'game.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

const inventoryPath = path.join(__dirname, 'inventory.json');

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
    // For simplicity, storing passwords in plain text. In a real app, hash and salt them.
    password: string; 
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
        const newUser: User = { id: userId, username, password };
        db.users[username] = newUser;
        writeDatabase();
        return newUser;
    },

    getUser: (username: string, password: string): User | null => {
        const user = db.users[username];
        if (user && user.password === password) {
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
}; 