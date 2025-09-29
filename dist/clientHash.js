"use strict";
// Client-side password hashing utility
// Using bcrypt for consistent hashing with server
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
exports.ClientHash = void 0;
const bcrypt = __importStar(require("bcryptjs"));
class ClientHash {
    // Validate bcrypt hash format
    static validateBcryptFormat(hash) {
        if (!hash || typeof hash !== 'string') {
            return false;
        }
        // Check if hash starts with bcrypt prefix
        if (!hash.startsWith(this.BCRYPT_PREFIX)) {
            console.error('[CLIENT] Invalid bcrypt hash format: missing prefix');
            return false;
        }
        // Check if hash has correct length
        if (hash.length !== this.EXPECTED_HASH_LENGTH) {
            console.error(`[CLIENT] Invalid bcrypt hash length: expected ${this.EXPECTED_HASH_LENGTH}, got ${hash.length}`);
            return false;
        }
        // Check if salt rounds match expected value
        const saltRoundsStr = hash.substring(4, 6); // Extract salt rounds from hash
        const saltRounds = parseInt(saltRoundsStr, 10);
        if (saltRounds !== this.SALT_ROUNDS) {
            console.error(`[CLIENT] Invalid salt rounds: expected ${this.SALT_ROUNDS}, got ${saltRounds}`);
            return false;
        }
        return true;
    }
    static async hashPassword(password) {
        try {
            // Generate salt and hash password using bcrypt
            const salt = await bcrypt.genSalt(this.SALT_ROUNDS);
            const hash = await bcrypt.hash(password, salt);
            // Validate the generated hash format
            if (!this.validateBcryptFormat(hash)) {
                throw new Error('Generated bcrypt hash has invalid format');
            }
            // Extract salt from bcrypt hash (bcrypt includes salt in the hash)
            const saltFromHash = hash.substring(0, 29); // bcrypt salt is first 29 characters
            console.log(`[CLIENT] Generated bcrypt hash: ${hash.substring(0, 20)}... (length: ${hash.length})`);
            console.log(`[CLIENT] Extracted salt: ${saltFromHash} (length: ${saltFromHash.length})`);
            return { hash, salt: saltFromHash };
        }
        catch (error) {
            console.error('[CLIENT] Error hashing password with bcrypt:', error);
            throw error;
        }
    }
    static async verifyPassword(password, hash, salt) {
        try {
            // Use bcrypt.compare for verification
            return await bcrypt.compare(password, hash);
        }
        catch (error) {
            console.error('[CLIENT] Error verifying password with bcrypt:', error);
            return false;
        }
    }
    static isUsingHttp() {
        return window.location.protocol === 'http:';
    }
    static isUsingHttps() {
        return window.location.protocol === 'https:';
    }
    // Method to get salt rounds (for server compatibility)
    static getSaltRounds() {
        return this.SALT_ROUNDS;
    }
}
exports.ClientHash = ClientHash;
ClientHash.SALT_ROUNDS = 12; // Match server-side salt rounds
ClientHash.BCRYPT_PREFIX = '$2b$'; // Bcrypt format prefix
ClientHash.EXPECTED_HASH_LENGTH = 60; // Bcrypt hash length
