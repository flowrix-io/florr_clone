import { Server as SocketIOServer } from '../ws_server';
import { players } from '../constants';
import { database, Guild as DbGuild } from '../database';

export const MAX_GUILD_SIZE = 200;
export const GUILD_NAME_LENGTH = 5;
export const GUILD_NAME_REGEX = /^[A-Z0-9]{5}$/;

export interface Guild {
    name: string; // 5-char alphanumeric uppercase — the sole identifier
    leaderUsername: string;
    memberUsernames: string[];
    createdAt: number;
    isBot?: boolean; // true for bot-only guilds defined in botManager
}

const INVITE_EXPIRY_MS = 60_000;

// Key is the uppercase guild name.
const guilds: Map<string, Guild> = new Map();
// lowercase username -> guild name
const userGuildMap: Map<string, string> = new Map();

// Bot guilds live in a separate map so bot display names don't collide with
// real-player `userGuildMap` entries and don't get persisted to disk.
const botGuilds: Map<string, Guild> = new Map();

export const pendingGuildInvites: Map<string, { guildName: string; fromUsername: string; expires: number }> = new Map();

function normalizeUsername(username: string): string {
    return username.toLowerCase();
}

function normalizeGuildName(name: string): string {
    return (name || '').trim().toUpperCase();
}

function toDbGuild(g: Guild): DbGuild {
    return {
        name: g.name,
        leaderUsername: g.leaderUsername,
        memberUsernames: g.memberUsernames.slice(),
        createdAt: g.createdAt,
    };
}

export function loadGuildsFromDatabase(): void {
    guilds.clear();
    userGuildMap.clear();
    const stored = database.getAllGuilds();
    for (const key in stored) {
        const g = stored[key];
        const name = normalizeGuildName(g.name);
        guilds.set(name, {
            name,
            leaderUsername: g.leaderUsername,
            memberUsernames: g.memberUsernames.slice(),
            createdAt: g.createdAt,
        });
        for (const member of g.memberUsernames) {
            userGuildMap.set(normalizeUsername(member), name);
        }
    }
}

function persistGuild(guild: Guild): void {
    database.saveGuild(toDbGuild(guild));
}

export function getGuildForUsername(username: string): Guild | null {
    const name = userGuildMap.get(normalizeUsername(username));
    if (!name) return null;
    return guilds.get(name) || null;
}

/** Case-insensitive lookup across both user guilds and bot guilds. */
export function getGuildByName(name: string): Guild | null {
    const key = normalizeGuildName(name);
    if (!key) return null;
    return guilds.get(key) || botGuilds.get(key) || null;
}

export function listGuilds(): Guild[] {
    return [...guilds.values(), ...botGuilds.values()];
}

/**
 * Register an in-memory bot-only guild. Bot guilds are never persisted, never
 * listed in `userGuildMap` (so real players with matching usernames keep their
 * own membership), and cannot be force-joined. Call this from botManager at
 * startup once per guild you want to exist.
 */
export function registerBotGuild(name: string, leaderBotName: string, memberBotNames: string[]): Guild | null {
    const normalizedName = normalizeGuildName(name);
    if (!GUILD_NAME_REGEX.test(normalizedName)) return null;
    if (botGuilds.has(normalizedName) || guilds.has(normalizedName)) return null;
    const members = Array.from(new Set([leaderBotName, ...memberBotNames])).slice(0, MAX_GUILD_SIZE);
    const guild: Guild = {
        name: normalizedName,
        leaderUsername: leaderBotName,
        memberUsernames: members,
        createdAt: Date.now(),
        isBot: true,
    };
    botGuilds.set(normalizedName, guild);
    return guild;
}

export function clearBotGuilds(): void {
    botGuilds.clear();
}

/** Returns the bot-guild name whose members include a bot with this display name, or null. */
export function getBotGuildNameForBot(botName: string): string | null {
    if (!botName) return null;
    const lower = botName.toLowerCase();
    for (const guild of botGuilds.values()) {
        for (const member of guild.memberUsernames) {
            if (member.toLowerCase() === lower) return guild.name;
        }
    }
    return null;
}

/**
 * Push the current guild name onto each online member's ServerPlayer entry and
 * broadcast `guildTagUpdate` so clients can redraw the `[NAME]` label. Pass
 * `null` to clear membership (e.g. after a kick / leave).
 */
export function syncGuildToOnlineMembers(
    memberUsernames: string[],
    guild: Guild | null,
    io: SocketIOServer,
): void {
    const nextName = guild ? guild.name : undefined;
    for (const username of memberUsernames) {
        const sid = findSocketIdByUsername(username, io);
        if (!sid) continue;
        const player = players[sid];
        if (!player) continue;
        if (player.guildName === nextName) continue;
        player.guildName = nextName;
        io.emit('guildTagUpdate', {
            id: player.id,
            guildName: nextName ?? null,
        });
    }
}

export function createGuild(leaderUsername: string, name: string): { guild: Guild | null; error: string | null } {
    if (!leaderUsername) return { guild: null, error: 'You must be logged in to create a guild.' };
    const normalized = normalizeGuildName(name);
    if (!normalized) return { guild: null, error: 'Guild name cannot be empty.' };
    if (!GUILD_NAME_REGEX.test(normalized)) {
        return { guild: null, error: 'Guild name must be exactly 5 alphanumeric characters (A–Z, 0–9).' };
    }
    if (userGuildMap.has(normalizeUsername(leaderUsername))) {
        return { guild: null, error: 'You are already in a guild.' };
    }
    if (guilds.has(normalized) || botGuilds.has(normalized)) {
        return { guild: null, error: `A guild named "${normalized}" already exists.` };
    }

    const guild: Guild = {
        name: normalized,
        leaderUsername,
        memberUsernames: [leaderUsername],
        createdAt: Date.now(),
    };

    guilds.set(guild.name, guild);
    userGuildMap.set(normalizeUsername(leaderUsername), guild.name);
    persistGuild(guild);
    return { guild, error: null };
}

export function inviteToGuild(inviterUsername: string, targetUsername: string): { guild: Guild | null; error: string | null } {
    const guild = getGuildForUsername(inviterUsername);
    if (!guild) return { guild: null, error: 'You are not in a guild.' };
    if (normalizeUsername(guild.leaderUsername) !== normalizeUsername(inviterUsername)) {
        return { guild: null, error: 'Only the guild leader can invite players.' };
    }
    if (guild.memberUsernames.length >= MAX_GUILD_SIZE) {
        return { guild: null, error: `Guild is full (max ${MAX_GUILD_SIZE} members).` };
    }
    const trimmed = (targetUsername || '').trim();
    if (!trimmed) return { guild: null, error: 'Please provide a username to invite.' };
    if (!database.userExists(trimmed)) {
        return { guild: null, error: `No player named "${trimmed}" exists.` };
    }
    if (normalizeUsername(trimmed) === normalizeUsername(inviterUsername)) {
        return { guild: null, error: 'You cannot invite yourself.' };
    }
    const targetKey = normalizeUsername(trimmed);
    if (userGuildMap.has(targetKey)) {
        return { guild: null, error: `${trimmed} is already in a guild.` };
    }
    const existing = pendingGuildInvites.get(targetKey);
    if (existing && existing.expires > Date.now()) {
        return { guild: null, error: `${trimmed} already has a pending guild invite.` };
    }

    pendingGuildInvites.set(targetKey, {
        guildName: guild.name,
        fromUsername: inviterUsername,
        expires: Date.now() + INVITE_EXPIRY_MS,
    });

    setTimeout(() => {
        const invite = pendingGuildInvites.get(targetKey);
        if (invite && invite.guildName === guild.name && invite.expires <= Date.now()) {
            pendingGuildInvites.delete(targetKey);
        }
    }, INVITE_EXPIRY_MS + 100);

    return { guild, error: null };
}

export function acceptGuildInvite(username: string): { guild: Guild | null; error: string | null } {
    const targetKey = normalizeUsername(username);
    const invite = pendingGuildInvites.get(targetKey);
    if (!invite) return { guild: null, error: 'You have no pending guild invite.' };
    if (invite.expires < Date.now()) {
        pendingGuildInvites.delete(targetKey);
        return { guild: null, error: 'Guild invite has expired.' };
    }

    const guild = guilds.get(invite.guildName);
    if (!guild) {
        pendingGuildInvites.delete(targetKey);
        return { guild: null, error: 'Guild no longer exists.' };
    }

    if (guild.memberUsernames.length >= MAX_GUILD_SIZE) {
        pendingGuildInvites.delete(targetKey);
        return { guild: null, error: 'Guild is full.' };
    }

    if (userGuildMap.has(targetKey)) {
        pendingGuildInvites.delete(targetKey);
        return { guild: null, error: 'You are already in a guild.' };
    }

    guild.memberUsernames.push(username);
    userGuildMap.set(targetKey, guild.name);
    pendingGuildInvites.delete(targetKey);
    persistGuild(guild);

    return { guild, error: null };
}

export function declineGuildInvite(username: string): boolean {
    return pendingGuildInvites.delete(normalizeUsername(username));
}

export function leaveGuild(username: string): { guild: Guild | null; disbanded: boolean; promotedTo: string | null; error: string | null } {
    const key = normalizeUsername(username);
    const name = userGuildMap.get(key);
    if (!name) return { guild: null, disbanded: false, promotedTo: null, error: 'You are not in a guild.' };
    const guild = guilds.get(name);
    if (!guild) {
        userGuildMap.delete(key);
        return { guild: null, disbanded: false, promotedTo: null, error: 'Guild not found.' };
    }

    guild.memberUsernames = guild.memberUsernames.filter(u => normalizeUsername(u) !== key);
    userGuildMap.delete(key);

    if (guild.memberUsernames.length === 0) {
        guilds.delete(guild.name);
        database.deleteGuild(guild.name);
        return { guild: null, disbanded: true, promotedTo: null, error: null };
    }

    let promotedTo: string | null = null;
    if (normalizeUsername(guild.leaderUsername) === key) {
        guild.leaderUsername = guild.memberUsernames[0];
        promotedTo = guild.leaderUsername;
    }

    persistGuild(guild);
    return { guild, disbanded: false, promotedTo, error: null };
}

export function kickFromGuild(leaderUsername: string, targetUsername: string): { guild: Guild | null; error: string | null } {
    const guild = getGuildForUsername(leaderUsername);
    if (!guild) return { guild: null, error: 'You are not in a guild.' };
    if (normalizeUsername(guild.leaderUsername) !== normalizeUsername(leaderUsername)) {
        return { guild: null, error: 'Only the guild leader can kick players.' };
    }
    const targetKey = normalizeUsername(targetUsername);
    if (targetKey === normalizeUsername(leaderUsername)) {
        return { guild: null, error: 'You cannot kick yourself. Use /guild-leave instead.' };
    }
    const memberIndex = guild.memberUsernames.findIndex(u => normalizeUsername(u) === targetKey);
    if (memberIndex === -1) {
        return { guild: null, error: `${targetUsername} is not in your guild.` };
    }

    guild.memberUsernames.splice(memberIndex, 1);
    userGuildMap.delete(targetKey);
    persistGuild(guild);
    return { guild, error: null };
}

export function forceJoinGuild(guildName: string, targetUsername: string): { guild: Guild | null; prevGuild: Guild | null; error: string | null } {
    const normalized = normalizeGuildName(guildName);
    if (!normalized) return { guild: null, prevGuild: null, error: 'Please provide a guild name.' };
    const guild = getGuildByName(normalized);
    if (!guild) return { guild: null, prevGuild: null, error: `Guild "${normalized}" not found.` };
    if (guild.isBot) {
        return { guild: null, prevGuild: null, error: 'Cannot force-join into a bot guild.' };
    }
    if (guild.memberUsernames.length >= MAX_GUILD_SIZE) {
        return { guild: null, prevGuild: null, error: 'Guild is full.' };
    }
    const trimmed = (targetUsername || '').trim();
    if (!trimmed) return { guild: null, prevGuild: null, error: 'Please provide a username.' };
    if (!database.userExists(trimmed)) {
        return { guild: null, prevGuild: null, error: `No player named "${trimmed}" exists.` };
    }
    const targetKey = normalizeUsername(trimmed);
    const existingName = userGuildMap.get(targetKey);
    if (existingName === guild.name) {
        return { guild, prevGuild: null, error: `${trimmed} is already in this guild.` };
    }
    let prevGuild: Guild | null = null;
    if (existingName) {
        const existing = guilds.get(existingName);
        if (existing) {
            existing.memberUsernames = existing.memberUsernames.filter(u => normalizeUsername(u) !== targetKey);
            if (existing.memberUsernames.length === 0) {
                guilds.delete(existing.name);
                database.deleteGuild(existing.name);
            } else {
                if (normalizeUsername(existing.leaderUsername) === targetKey) {
                    existing.leaderUsername = existing.memberUsernames[0];
                }
                persistGuild(existing);
                prevGuild = existing;
            }
        }
    }

    guild.memberUsernames.push(trimmed);
    userGuildMap.set(targetKey, guild.name);
    pendingGuildInvites.delete(targetKey);
    persistGuild(guild);
    return { guild, prevGuild, error: null };
}

// Find the online socket id for a given username (used for broadcasting guildUpdate).
export function findSocketIdByUsername(username: string, io: SocketIOServer): string | null {
    const key = normalizeUsername(username);
    for (const [socketId, socket] of io.sockets.sockets) {
        const u = (socket as any).username;
        if (u && normalizeUsername(u) === key) return socketId;
    }
    return null;
}

// Return online members' socket ids for a guild.
export function getOnlineGuildSocketIds(guild: Guild, io: SocketIOServer): string[] {
    const ids: string[] = [];
    for (const member of guild.memberUsernames) {
        const sid = findSocketIdByUsername(member, io);
        if (sid) ids.push(sid);
    }
    return ids;
}

export interface GuildUpdatePayload {
    name: string;
    leaderUsername: string;
    memberUsernames: string[];
    onlineUsernames: string[];
}

export function buildGuildUpdate(guild: Guild, io: SocketIOServer): GuildUpdatePayload {
    const online: string[] = [];
    for (const member of guild.memberUsernames) {
        if (findSocketIdByUsername(member, io)) online.push(member);
    }
    return {
        name: guild.name,
        leaderUsername: guild.leaderUsername,
        memberUsernames: guild.memberUsernames.slice(),
        onlineUsernames: online,
    };
}

export function broadcastGuildUpdate(guild: Guild, io: SocketIOServer): void {
    const payload = buildGuildUpdate(guild, io);
    for (const member of guild.memberUsernames) {
        const sid = findSocketIdByUsername(member, io);
        if (sid) io.to(sid).emit('guildUpdate', payload);
    }
}

export function sendGuildSystemMessage(guild: Guild, io: SocketIOServer, content: string): void {
    const message = {
        sender: `[Guild ${guild.name}]`,
        content: `<span style="color: #ffb74d;">${content}</span>`,
        timestamp: Date.now(),
    };
    for (const member of guild.memberUsernames) {
        const sid = findSocketIdByUsername(member, io);
        if (sid) io.to(sid).emit('chatMessage', message);
    }
}

export function sendGuildChatMessage(
    guild: Guild,
    io: SocketIOServer,
    senderUsername: string,
    senderPlayerName: string,
    content: string
): void {
    const message = {
        sender: `[Guild ${guild.name}] @${senderUsername}`,
        content: `[<span style="color: #ffb74d;">${senderPlayerName}</span>] ${content}`,
        timestamp: Date.now(),
    };
    for (const member of guild.memberUsernames) {
        const sid = findSocketIdByUsername(member, io);
        if (sid) io.to(sid).emit('chatMessage', message);
    }
}
