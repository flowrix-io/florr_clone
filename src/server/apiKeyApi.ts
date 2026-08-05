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

import type { UApp, UReq, UResponse, NextFunction } from './uws_app';
import { database, ApiKey, Notification, RedeemedCode } from '../database';

// Local aliases keep the rest of this file readable; the route handlers below
// were written against an Express-style req/res shape, which our shim mirrors.
type Request = UReq;
type Response = UResponse;

export interface BossEvent {
    type: 'spawn' | 'defeat';
    tier: string;
    mobType: string;
    x: number;
    y: number;
    timestamp: number;
    message: string;          // Plain-text version of the chat message
    defeatedBy?: {            // Only populated for defeat events
        username: string;
        playerName: string;
    };
}

const BOSS_EVENT_BUFFER_SIZE = 500;
const bossEventBuffer: BossEvent[] = [];

export function recordBossEvent(event: BossEvent): void {
    bossEventBuffer.push(event);
    if (bossEventBuffer.length > BOSS_EVENT_BUFFER_SIZE) {
        bossEventBuffer.splice(0, bossEventBuffer.length - BOSS_EVENT_BUFFER_SIZE);
    }
}

export function getRecentBossEvents(limit: number, sinceTimestamp?: number, typeFilter?: 'spawn' | 'defeat'): BossEvent[] {
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
export function stripHtml(input: string): string {
    return input.replace(/<[^>]*>/g, '').trim();
}

interface AuthedRequest extends Request {
    apiKey?: ApiKey;
    apiKeyIsAdmin?: boolean;
}

// Pull the caller's API key from any of three places, in order of preference:
//   1. X-API-Key header (recommended — keeps the secret out of URLs/access logs)
//   2. ?api_key=...  query param
//   3. ?apiKey=...   query param (camelCase alias)
// Browser-side fetches against /api/v1/* often can't set custom headers without
// CORS preflight, so the URL form is the practical fallback.
function extractApiKeyFromRequest(req: Request): string | undefined {
    const header = req.header('X-API-Key');
    if (typeof header === 'string' && header.length > 0) return header;
    const snake = req.query.api_key;
    if (typeof snake === 'string' && snake.length > 0) return snake;
    const camel = req.query.apiKey;
    if (typeof camel === 'string' && camel.length > 0) return camel;
    return undefined;
}

const API_KEY_USAGE_HINT = 'API key required — pass it as the X-API-Key header or as ?api_key=... in the URL';

function requireApiKey(req: AuthedRequest, res: Response, next: NextFunction) {
    const providedKey = extractApiKeyFromRequest(req);
    if (!providedKey) {
        return res.status(401).json({ error: API_KEY_USAGE_HINT });
    }
    const entry = database.getApiKey(providedKey);
    if (!entry) {
        return res.status(403).json({ error: 'Invalid API key' });
    }
    req.apiKey = entry;
    // Admin status is checked at request time so demoting a user immediately revokes
    // API admin access without needing to re-issue the key.
    req.apiKeyIsAdmin = database.isUserAdmin(entry.username);
    next();
}

// Used after requireApiKey for endpoints that expose admin-only data or actions
// (creating star codes, broadcasting notifications, listing all codes, etc.).
function requireAdminApiKey(req: AuthedRequest, res: Response, next: NextFunction) {
    if (!req.apiKey) {
        return res.status(401).json({ error: API_KEY_USAGE_HINT });
    }
    if (!req.apiKeyIsAdmin) {
        return res.status(403).json({ error: 'Admin privileges required for this endpoint' });
    }
    next();
}

export interface ApiKeyApiDeps {
    redeemedCodes: Map<string, RedeemedCode>;
    saveCodeToDatabase: (code: string, codeData: RedeemedCode) => void;
    deleteCodeFromDatabase: (code: string) => void;
}

export function registerApiKeyRoutes(app: UApp, deps: ApiKeyApiDeps): void {
    const { redeemedCodes, saveCodeToDatabase, deleteCodeFromDatabase } = deps;

    // Create a star code. Body: { code, stars, maxUses? } — admin only.
    app.post('/api/v1/star-codes', requireApiKey, requireAdminApiKey, (req: AuthedRequest, res: Response) => {
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
        const codeData: RedeemedCode = {
            code: normalized,
            stars: Math.floor(stars),
            uses: 0,
            usedBy: [],
            createdBy: `api:${req.apiKey?.label ?? 'unknown'}`,
            createdAt: Date.now()
        };
        if (maxUses !== undefined) codeData.maxUses = Math.floor(maxUses);
        redeemedCodes.set(normalized, codeData);
        saveCodeToDatabase(normalized, codeData);
        res.status(201).json({ code: codeData });
    });

    // Delete an existing star code — admin only.
    app.delete('/api/v1/star-codes/:code', requireApiKey, requireAdminApiKey, (req: AuthedRequest, res: Response) => {
        const normalized = req.params.code.trim().toUpperCase();
        if (!redeemedCodes.has(normalized)) {
            return res.status(404).json({ error: 'Code not found' });
        }
        redeemedCodes.delete(normalized);
        deleteCodeFromDatabase(normalized);
        res.json({ deleted: normalized });
    });

    // List currently active star codes — admin only (exposes redemption stats).
    app.get('/api/v1/star-codes', requireApiKey, requireAdminApiKey, (_req: AuthedRequest, res: Response) => {
        const codes = Array.from(redeemedCodes.values());
        res.json({ codes });
    });

    // Post a global notification. Body: { type, message }.
    // type must be one of the in-game notification types. Admin only — broadcasts
    // to every player.
    app.post('/api/v1/notifications', requireApiKey, requireAdminApiKey, (req: AuthedRequest, res: Response) => {
        const { type, message } = req.body ?? {};
        const validTypes: Notification['type'][] = ['super_craft', 'unique_craft', 'apex_craft', 'star_code'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `"type" must be one of ${validTypes.join(', ')}` });
        }
        if (typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: '"message" must be a non-empty string' });
        }
        const notification: Notification = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            type,
            message: message.trim(),
            timestamp: Date.now()
        };
        database.addNotification(notification);
        res.status(201).json({ notification });
    });

    // Read boss spawn/defeat events from the in-memory ring buffer.
    // Query: ?limit=100&since=<ms>&type=spawn|defeat
    app.get('/api/v1/events', requireApiKey, (req: AuthedRequest, res: Response) => {
        const limit = Math.min(BOSS_EVENT_BUFFER_SIZE, Math.max(1, parseInt(req.query.limit as string) || 100));
        const sinceRaw = req.query.since as string | undefined;
        const since = sinceRaw ? parseInt(sinceRaw) : undefined;
        const typeRaw = req.query.type as string | undefined;
        const typeFilter = typeRaw === 'spawn' || typeRaw === 'defeat' ? typeRaw : undefined;
        const events = getRecentBossEvents(limit, Number.isFinite(since as number) ? since : undefined, typeFilter);
        res.json({ events, bufferSize: BOSS_EVENT_BUFFER_SIZE });
    });

    // Lightweight health/auth check — useful for verifying a key works.
    app.get('/api/v1/whoami', requireApiKey, (req: AuthedRequest, res: Response) => {
        res.json({
            username: req.apiKey?.username,
            label: req.apiKey?.label,
            createdAt: req.apiKey?.createdAt,
            admin: !!req.apiKeyIsAdmin
        });
    });
}
