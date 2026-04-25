"use strict";
// External REST API authenticated by API key.
//
// Surfaces three operator-grade capabilities that the in-game systems already
// have but only expose internally:
//   * create/delete star codes (POST/DELETE /api/v1/star-codes)
//   * post a global notification        (POST /api/v1/notifications)
//   * read recent boss spawn/defeat events (GET /api/v1/events)
//
// Auth is "X-API-Key: <key>". Keys are stored in inventory.json under
// db.apiKeys (see database.ts).
//
// Spawn/defeat events are kept in an in-memory ring buffer; the existing
// emit sites in enemySpawner.ts and utils.ts call recordBossEvent() so the
// API can return them on demand.
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
exports.recordBossEvent = recordBossEvent;
exports.getRecentBossEvents = getRecentBossEvents;
exports.stripHtml = stripHtml;
exports.registerApiKeyRoutes = registerApiKeyRoutes;
const crypto = __importStar(require("crypto"));
const database_1 = require("../database");
const BOSS_EVENT_BUFFER_SIZE = 500;
const bossEventBuffer = [];
function recordBossEvent(event) {
    bossEventBuffer.push(event);
    if (bossEventBuffer.length > BOSS_EVENT_BUFFER_SIZE) {
        bossEventBuffer.splice(0, bossEventBuffer.length - BOSS_EVENT_BUFFER_SIZE);
    }
}
function getRecentBossEvents(limit, sinceTimestamp, typeFilter) {
    let events = bossEventBuffer;
    if (sinceTimestamp !== undefined) {
        events = events.filter(e => e.timestamp > sinceTimestamp);
    }
    if (typeFilter) {
        events = events.filter(e => e.type === typeFilter);
    }
    // Newest first
    return events.slice(-limit).reverse();
}
// Strip HTML tags from chat-message strings so plain consumers don't have to.
function stripHtml(input) {
    return input.replace(/<[^>]*>/g, '').trim();
}
// Pull the caller's API key from any of three places, in order of preference:
//   1. X-API-Key header (recommended — keeps the secret out of URLs/access logs)
//   2. ?api_key=...  query param
//   3. ?apiKey=...   query param (camelCase alias)
// Browser-side fetches against /api/v1/* often can't set custom headers without
// CORS preflight, so the URL form is the practical fallback.
function extractApiKeyFromRequest(req) {
    const header = req.header('X-API-Key');
    if (typeof header === 'string' && header.length > 0)
        return header;
    const snake = req.query.api_key;
    if (typeof snake === 'string' && snake.length > 0)
        return snake;
    const camel = req.query.apiKey;
    if (typeof camel === 'string' && camel.length > 0)
        return camel;
    return undefined;
}
const API_KEY_USAGE_HINT = 'API key required — pass it as the X-API-Key header or as ?api_key=... in the URL';
function requireApiKey(req, res, next) {
    const providedKey = extractApiKeyFromRequest(req);
    if (!providedKey) {
        return res.status(401).json({ error: API_KEY_USAGE_HINT });
    }
    const entry = database_1.database.getApiKey(providedKey);
    if (!entry) {
        return res.status(403).json({ error: 'Invalid API key' });
    }
    req.apiKey = entry;
    // Admin status is checked at request time so demoting a user immediately revokes
    // API admin access without needing to re-issue the key.
    req.apiKeyIsAdmin = database_1.database.isUserAdmin(entry.username);
    next();
}
// Used after requireApiKey for endpoints that expose admin-only data or actions
// (creating star codes, broadcasting notifications, listing all codes, etc.).
function requireAdminApiKey(req, res, next) {
    if (!req.apiKey) {
        return res.status(401).json({ error: API_KEY_USAGE_HINT });
    }
    if (!req.apiKeyIsAdmin) {
        return res.status(403).json({ error: 'Admin privileges required for this endpoint' });
    }
    next();
}
function registerApiKeyRoutes(app, deps) {
    const { redeemedCodes, saveCodeToDatabase, deleteCodeFromDatabase } = deps;
    // Create a star code. Body: { code, stars, maxUses? } — admin only.
    app.post('/api/v1/star-codes', requireApiKey, requireAdminApiKey, (req, res) => {
        const { code, stars, maxUses } = req.body ?? {};
        if (typeof code !== 'string' || !code.trim()) {
            return res.status(400).json({ error: '"code" must be a non-empty string' });
        }
        if (typeof stars !== 'number' || !Number.isFinite(stars) || stars <= 0) {
            return res.status(400).json({ error: '"stars" must be a positive number' });
        }
        if (maxUses !== undefined && (typeof maxUses !== 'number' || !Number.isFinite(maxUses) || maxUses <= 0)) {
            return res.status(400).json({ error: '"maxUses" must be a positive number when provided' });
        }
        const normalized = code.trim().toUpperCase();
        if (redeemedCodes.has(normalized)) {
            return res.status(409).json({ error: 'Code already exists' });
        }
        const codeData = {
            code: normalized,
            stars: Math.floor(stars),
            uses: 0,
            usedBy: [],
            createdBy: `api:${req.apiKey?.label ?? 'unknown'}`,
            createdAt: Date.now()
        };
        if (maxUses !== undefined)
            codeData.maxUses = Math.floor(maxUses);
        redeemedCodes.set(normalized, codeData);
        saveCodeToDatabase(normalized, codeData);
        res.status(201).json({ code: codeData });
    });
    // Delete an existing star code — admin only.
    app.delete('/api/v1/star-codes/:code', requireApiKey, requireAdminApiKey, (req, res) => {
        const normalized = req.params.code.trim().toUpperCase();
        if (!redeemedCodes.has(normalized)) {
            return res.status(404).json({ error: 'Code not found' });
        }
        redeemedCodes.delete(normalized);
        deleteCodeFromDatabase(normalized);
        res.json({ deleted: normalized });
    });
    // List currently active star codes — admin only (exposes redemption stats).
    app.get('/api/v1/star-codes', requireApiKey, requireAdminApiKey, (_req, res) => {
        const codes = Array.from(redeemedCodes.values());
        res.json({ codes });
    });
    // Post a global notification. Body: { type, message }.
    // type must be one of the in-game notification types. Admin only — broadcasts
    // to every player.
    app.post('/api/v1/notifications', requireApiKey, requireAdminApiKey, (req, res) => {
        const { type, message } = req.body ?? {};
        const validTypes = ['super_craft', 'unique_craft', 'star_code'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `"type" must be one of ${validTypes.join(', ')}` });
        }
        if (typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: '"message" must be a non-empty string' });
        }
        const notification = {
            id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            type,
            message: message.trim(),
            timestamp: Date.now()
        };
        database_1.database.addNotification(notification);
        res.status(201).json({ notification });
    });
    // Read boss spawn/defeat events from the in-memory ring buffer.
    // Query: ?limit=100&since=<ms>&type=spawn|defeat
    app.get('/api/v1/events', requireApiKey, (req, res) => {
        const limit = Math.min(BOSS_EVENT_BUFFER_SIZE, Math.max(1, parseInt(req.query.limit) || 100));
        const sinceRaw = req.query.since;
        const since = sinceRaw ? parseInt(sinceRaw) : undefined;
        const typeRaw = req.query.type;
        const typeFilter = typeRaw === 'spawn' || typeRaw === 'defeat' ? typeRaw : undefined;
        const events = getRecentBossEvents(limit, Number.isFinite(since) ? since : undefined, typeFilter);
        res.json({ events, bufferSize: BOSS_EVENT_BUFFER_SIZE });
    });
    // Lightweight health/auth check — useful for verifying a key works.
    app.get('/api/v1/whoami', requireApiKey, (req, res) => {
        res.json({
            username: req.apiKey?.username,
            label: req.apiKey?.label,
            createdAt: req.apiKey?.createdAt,
            admin: !!req.apiKeyIsAdmin
        });
    });
}
