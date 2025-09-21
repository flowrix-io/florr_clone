"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.database = void 0;
var better_sqlite3_1 = require("better-sqlite3");
var db = new better_sqlite3_1.default('game.db');
// Initialize database with schema version tracking
db.exec("\n    CREATE TABLE IF NOT EXISTS schema_version (\n        version INTEGER PRIMARY KEY\n    );\n");
// Check current schema version
var currentVersion = db.prepare('SELECT version FROM schema_version').get();
var LATEST_VERSION = 2;
if (!currentVersion) {
    // First time setup
    db.exec("\n        CREATE TABLE IF NOT EXISTS players (\n            id TEXT PRIMARY KEY,\n            userId TEXT NOT NULL,\n            level INTEGER DEFAULT 1,\n            xp INTEGER DEFAULT 0,\n            maxHealth INTEGER DEFAULT 100,\n            damage INTEGER DEFAULT 10,\n            inventory TEXT DEFAULT '[]',\n            loadout TEXT DEFAULT '[]',\n            lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP\n        );\n\n        CREATE TABLE IF NOT EXISTS users (\n            id TEXT PRIMARY KEY,\n            username TEXT UNIQUE NOT NULL,\n            password TEXT NOT NULL,\n            created_at DATETIME DEFAULT CURRENT_TIMESTAMP\n        );\n\n        INSERT INTO schema_version (version) VALUES (".concat(LATEST_VERSION, ");\n    "));
}
else if (currentVersion.version < LATEST_VERSION) {
    // Handle migrations
    if (currentVersion.version < 1) {
        // Add inventory column if it doesn't exist
        db.exec("\n            ALTER TABLE players ADD COLUMN inventory TEXT DEFAULT '[]';\n        ");
    }
    if (currentVersion.version < 2) {
        // Add loadout column
        try {
            db.exec("\n                ALTER TABLE players ADD COLUMN loadout TEXT DEFAULT '[]';\n            ");
            console.log('Successfully added loadout column');
        }
        catch (error) {
            console.error('Error adding loadout column:', error);
        }
    }
    // Update schema version
    db.prepare('UPDATE schema_version SET version = ?').run(LATEST_VERSION);
}
exports.database = {
    // User-related functions
    createUser: function (username, password) {
        var stmt = db.prepare("\n            INSERT INTO users (id, username, password)\n            VALUES (?, ?, ?)\n        ");
        try {
            var userId = Math.random().toString(36).substr(2, 9);
            stmt.run(userId, username, password);
            return { id: userId, username: username, password: password };
        }
        catch (error) {
            console.error('Error creating user:', error);
            return null;
        }
    },
    getUser: function (username, password) {
        var stmt = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?');
        return stmt.get(username, password);
    },
    // Player-related functions
    savePlayer: function (playerId, userId, progress) {
        try {
            console.log('Attempting to save player progress:', {
                playerId: playerId,
                userId: userId,
                progress: progress
            });
            var stmt = db.prepare("\n                INSERT OR REPLACE INTO players (\n                    id, userId, level, xp, maxHealth, damage, inventory, loadout, lastSeen\n                )\n                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)\n            ");
            var result = stmt.run(playerId, userId, progress.level, progress.xp, progress.maxHealth, progress.damage, JSON.stringify(progress.inventory || []), JSON.stringify(progress.loadout || Array(10).fill(null)));
            console.log('Save player result:', result);
            return true;
        }
        catch (error) {
            console.error('Error saving player progress:', error);
            return false;
        }
    },
    getPlayer: function (playerId) {
        var stmt = db.prepare('SELECT level, xp, maxHealth, damage, inventory FROM players WHERE id = ?');
        var result = stmt.get(playerId);
        if (result) {
            return {
                level: result.level,
                xp: result.xp,
                maxHealth: result.maxHealth,
                damage: result.damage,
                inventory: JSON.parse(result.inventory || '[]')
            };
        }
        return null;
    },
    getPlayerByUserId: function (userId) {
        try {
            console.log('Attempting to get player by userId:', userId);
            var stmt = db.prepare("\n                SELECT level, xp, maxHealth, damage, inventory, loadout \n                FROM players \n                WHERE userId = ?\n                ORDER BY lastSeen DESC\n                LIMIT 1\n            ");
            var result = stmt.get(userId);
            if (result) {
                console.log('Found player data:', result);
                return {
                    level: result.level,
                    xp: result.xp,
                    maxHealth: result.maxHealth,
                    damage: result.damage,
                    inventory: JSON.parse(result.inventory || '[]'),
                    loadout: JSON.parse(result.loadout || '[]')
                };
            }
            console.log('No player data found for userId:', userId);
            return null;
        }
        catch (error) {
            console.error('Error getting player by userId:', error);
            return null;
        }
    },
    cleanupOldPlayers: function (daysOld) {
        if (daysOld === void 0) { daysOld = 30; }
        var stmt = db.prepare("\n            DELETE FROM players \n            WHERE lastSeen < datetime('now', '-' || ? || ' days')\n        ");
        stmt.run(daysOld);
    }
};
