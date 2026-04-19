"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingGuildInvites = exports.GUILD_NAME_REGEX = exports.GUILD_NAME_LENGTH = exports.MAX_GUILD_SIZE = void 0;
exports.loadGuildsFromDatabase = loadGuildsFromDatabase;
exports.getGuildForUsername = getGuildForUsername;
exports.getGuildByName = getGuildByName;
exports.listGuilds = listGuilds;
exports.registerBotGuild = registerBotGuild;
exports.clearBotGuilds = clearBotGuilds;
exports.getBotGuildNameForBot = getBotGuildNameForBot;
exports.syncGuildToOnlineMembers = syncGuildToOnlineMembers;
exports.createGuild = createGuild;
exports.inviteToGuild = inviteToGuild;
exports.acceptGuildInvite = acceptGuildInvite;
exports.declineGuildInvite = declineGuildInvite;
exports.leaveGuild = leaveGuild;
exports.kickFromGuild = kickFromGuild;
exports.forceJoinGuild = forceJoinGuild;
exports.findSocketIdByUsername = findSocketIdByUsername;
exports.getOnlineGuildSocketIds = getOnlineGuildSocketIds;
exports.buildGuildUpdate = buildGuildUpdate;
exports.broadcastGuildUpdate = broadcastGuildUpdate;
exports.sendGuildSystemMessage = sendGuildSystemMessage;
exports.sendGuildChatMessage = sendGuildChatMessage;
const constants_1 = require("../constants");
const database_1 = require("../database");
exports.MAX_GUILD_SIZE = 200;
exports.GUILD_NAME_LENGTH = 5;
exports.GUILD_NAME_REGEX = /^[A-Z0-9]{5}$/;
const INVITE_EXPIRY_MS = 60000;
// Key is the uppercase guild name.
const guilds = new Map();
// lowercase username -> guild name
const userGuildMap = new Map();
// Bot guilds live in a separate map so bot display names don't collide with
// real-player `userGuildMap` entries and don't get persisted to disk.
const botGuilds = new Map();
exports.pendingGuildInvites = new Map();
function normalizeUsername(username) {
    return username.toLowerCase();
}
function normalizeGuildName(name) {
    return (name || '').trim().toUpperCase();
}
function toDbGuild(g) {
    return {
        name: g.name,
        leaderUsername: g.leaderUsername,
        memberUsernames: g.memberUsernames.slice(),
        createdAt: g.createdAt,
    };
}
function loadGuildsFromDatabase() {
    guilds.clear();
    userGuildMap.clear();
    const stored = database_1.database.getAllGuilds();
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
function persistGuild(guild) {
    database_1.database.saveGuild(toDbGuild(guild));
}
function getGuildForUsername(username) {
    const name = userGuildMap.get(normalizeUsername(username));
    if (!name)
        return null;
    return guilds.get(name) || null;
}
/** Case-insensitive lookup across both user guilds and bot guilds. */
function getGuildByName(name) {
    const key = normalizeGuildName(name);
    if (!key)
        return null;
    return guilds.get(key) || botGuilds.get(key) || null;
}
function listGuilds() {
    return [...guilds.values(), ...botGuilds.values()];
}
/**
 * Register an in-memory bot-only guild. Bot guilds are never persisted, never
 * listed in `userGuildMap` (so real players with matching usernames keep their
 * own membership), and cannot be force-joined. Call this from botManager at
 * startup once per guild you want to exist.
 */
function registerBotGuild(name, leaderBotName, memberBotNames) {
    const normalizedName = normalizeGuildName(name);
    if (!exports.GUILD_NAME_REGEX.test(normalizedName))
        return null;
    if (botGuilds.has(normalizedName) || guilds.has(normalizedName))
        return null;
    const members = Array.from(new Set([leaderBotName, ...memberBotNames])).slice(0, exports.MAX_GUILD_SIZE);
    const guild = {
        name: normalizedName,
        leaderUsername: leaderBotName,
        memberUsernames: members,
        createdAt: Date.now(),
        isBot: true,
    };
    botGuilds.set(normalizedName, guild);
    return guild;
}
function clearBotGuilds() {
    botGuilds.clear();
}
/** Returns the bot-guild name whose members include a bot with this display name, or null. */
function getBotGuildNameForBot(botName) {
    if (!botName)
        return null;
    const lower = botName.toLowerCase();
    for (const guild of botGuilds.values()) {
        for (const member of guild.memberUsernames) {
            if (member.toLowerCase() === lower)
                return guild.name;
        }
    }
    return null;
}
/**
 * Push the current guild name onto each online member's ServerPlayer entry and
 * broadcast `guildTagUpdate` so clients can redraw the `[NAME]` label. Pass
 * `null` to clear membership (e.g. after a kick / leave).
 */
function syncGuildToOnlineMembers(memberUsernames, guild, io) {
    const nextName = guild ? guild.name : undefined;
    for (const username of memberUsernames) {
        const sid = findSocketIdByUsername(username, io);
        if (!sid)
            continue;
        const player = constants_1.players[sid];
        if (!player)
            continue;
        if (player.guildName === nextName)
            continue;
        player.guildName = nextName;
        io.emit('guildTagUpdate', {
            id: player.id,
            guildName: nextName ?? null,
        });
    }
}
function createGuild(leaderUsername, name) {
    if (!leaderUsername)
        return { guild: null, error: 'You must be logged in to create a guild.' };
    const normalized = normalizeGuildName(name);
    if (!normalized)
        return { guild: null, error: 'Guild name cannot be empty.' };
    if (!exports.GUILD_NAME_REGEX.test(normalized)) {
        return { guild: null, error: 'Guild name must be exactly 5 alphanumeric characters (A–Z, 0–9).' };
    }
    if (userGuildMap.has(normalizeUsername(leaderUsername))) {
        return { guild: null, error: 'You are already in a guild.' };
    }
    if (guilds.has(normalized) || botGuilds.has(normalized)) {
        return { guild: null, error: `A guild named "${normalized}" already exists.` };
    }
    const guild = {
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
function inviteToGuild(inviterUsername, targetUsername) {
    const guild = getGuildForUsername(inviterUsername);
    if (!guild)
        return { guild: null, error: 'You are not in a guild.' };
    if (normalizeUsername(guild.leaderUsername) !== normalizeUsername(inviterUsername)) {
        return { guild: null, error: 'Only the guild leader can invite players.' };
    }
    if (guild.memberUsernames.length >= exports.MAX_GUILD_SIZE) {
        return { guild: null, error: `Guild is full (max ${exports.MAX_GUILD_SIZE} members).` };
    }
    const trimmed = (targetUsername || '').trim();
    if (!trimmed)
        return { guild: null, error: 'Please provide a username to invite.' };
    if (!database_1.database.userExists(trimmed)) {
        return { guild: null, error: `No player named "${trimmed}" exists.` };
    }
    if (normalizeUsername(trimmed) === normalizeUsername(inviterUsername)) {
        return { guild: null, error: 'You cannot invite yourself.' };
    }
    const targetKey = normalizeUsername(trimmed);
    if (userGuildMap.has(targetKey)) {
        return { guild: null, error: `${trimmed} is already in a guild.` };
    }
    const existing = exports.pendingGuildInvites.get(targetKey);
    if (existing && existing.expires > Date.now()) {
        return { guild: null, error: `${trimmed} already has a pending guild invite.` };
    }
    exports.pendingGuildInvites.set(targetKey, {
        guildName: guild.name,
        fromUsername: inviterUsername,
        expires: Date.now() + INVITE_EXPIRY_MS,
    });
    setTimeout(() => {
        const invite = exports.pendingGuildInvites.get(targetKey);
        if (invite && invite.guildName === guild.name && invite.expires <= Date.now()) {
            exports.pendingGuildInvites.delete(targetKey);
        }
    }, INVITE_EXPIRY_MS + 100);
    return { guild, error: null };
}
function acceptGuildInvite(username) {
    const targetKey = normalizeUsername(username);
    const invite = exports.pendingGuildInvites.get(targetKey);
    if (!invite)
        return { guild: null, error: 'You have no pending guild invite.' };
    if (invite.expires < Date.now()) {
        exports.pendingGuildInvites.delete(targetKey);
        return { guild: null, error: 'Guild invite has expired.' };
    }
    const guild = guilds.get(invite.guildName);
    if (!guild) {
        exports.pendingGuildInvites.delete(targetKey);
        return { guild: null, error: 'Guild no longer exists.' };
    }
    if (guild.memberUsernames.length >= exports.MAX_GUILD_SIZE) {
        exports.pendingGuildInvites.delete(targetKey);
        return { guild: null, error: 'Guild is full.' };
    }
    if (userGuildMap.has(targetKey)) {
        exports.pendingGuildInvites.delete(targetKey);
        return { guild: null, error: 'You are already in a guild.' };
    }
    guild.memberUsernames.push(username);
    userGuildMap.set(targetKey, guild.name);
    exports.pendingGuildInvites.delete(targetKey);
    persistGuild(guild);
    return { guild, error: null };
}
function declineGuildInvite(username) {
    return exports.pendingGuildInvites.delete(normalizeUsername(username));
}
function leaveGuild(username) {
    const key = normalizeUsername(username);
    const name = userGuildMap.get(key);
    if (!name)
        return { guild: null, disbanded: false, promotedTo: null, error: 'You are not in a guild.' };
    const guild = guilds.get(name);
    if (!guild) {
        userGuildMap.delete(key);
        return { guild: null, disbanded: false, promotedTo: null, error: 'Guild not found.' };
    }
    guild.memberUsernames = guild.memberUsernames.filter(u => normalizeUsername(u) !== key);
    userGuildMap.delete(key);
    if (guild.memberUsernames.length === 0) {
        guilds.delete(guild.name);
        database_1.database.deleteGuild(guild.name);
        return { guild: null, disbanded: true, promotedTo: null, error: null };
    }
    let promotedTo = null;
    if (normalizeUsername(guild.leaderUsername) === key) {
        guild.leaderUsername = guild.memberUsernames[0];
        promotedTo = guild.leaderUsername;
    }
    persistGuild(guild);
    return { guild, disbanded: false, promotedTo, error: null };
}
function kickFromGuild(leaderUsername, targetUsername) {
    const guild = getGuildForUsername(leaderUsername);
    if (!guild)
        return { guild: null, error: 'You are not in a guild.' };
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
function forceJoinGuild(guildName, targetUsername) {
    const normalized = normalizeGuildName(guildName);
    if (!normalized)
        return { guild: null, prevGuild: null, error: 'Please provide a guild name.' };
    const guild = getGuildByName(normalized);
    if (!guild)
        return { guild: null, prevGuild: null, error: `Guild "${normalized}" not found.` };
    if (guild.isBot) {
        return { guild: null, prevGuild: null, error: 'Cannot force-join into a bot guild.' };
    }
    if (guild.memberUsernames.length >= exports.MAX_GUILD_SIZE) {
        return { guild: null, prevGuild: null, error: 'Guild is full.' };
    }
    const trimmed = (targetUsername || '').trim();
    if (!trimmed)
        return { guild: null, prevGuild: null, error: 'Please provide a username.' };
    if (!database_1.database.userExists(trimmed)) {
        return { guild: null, prevGuild: null, error: `No player named "${trimmed}" exists.` };
    }
    const targetKey = normalizeUsername(trimmed);
    const existingName = userGuildMap.get(targetKey);
    if (existingName === guild.name) {
        return { guild, prevGuild: null, error: `${trimmed} is already in this guild.` };
    }
    let prevGuild = null;
    if (existingName) {
        const existing = guilds.get(existingName);
        if (existing) {
            existing.memberUsernames = existing.memberUsernames.filter(u => normalizeUsername(u) !== targetKey);
            if (existing.memberUsernames.length === 0) {
                guilds.delete(existing.name);
                database_1.database.deleteGuild(existing.name);
            }
            else {
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
    exports.pendingGuildInvites.delete(targetKey);
    persistGuild(guild);
    return { guild, prevGuild, error: null };
}
// Find the online socket id for a given username (used for broadcasting guildUpdate).
function findSocketIdByUsername(username, io) {
    const key = normalizeUsername(username);
    for (const [socketId, socket] of io.sockets.sockets) {
        const u = socket.username;
        if (u && normalizeUsername(u) === key)
            return socketId;
    }
    return null;
}
// Return online members' socket ids for a guild.
function getOnlineGuildSocketIds(guild, io) {
    const ids = [];
    for (const member of guild.memberUsernames) {
        const sid = findSocketIdByUsername(member, io);
        if (sid)
            ids.push(sid);
    }
    return ids;
}
function buildGuildUpdate(guild, io) {
    const online = [];
    for (const member of guild.memberUsernames) {
        if (findSocketIdByUsername(member, io))
            online.push(member);
    }
    return {
        name: guild.name,
        leaderUsername: guild.leaderUsername,
        memberUsernames: guild.memberUsernames.slice(),
        onlineUsernames: online,
    };
}
function broadcastGuildUpdate(guild, io) {
    const payload = buildGuildUpdate(guild, io);
    for (const member of guild.memberUsernames) {
        const sid = findSocketIdByUsername(member, io);
        if (sid)
            io.to(sid).emit('guildUpdate', payload);
    }
}
function sendGuildSystemMessage(guild, io, content) {
    const message = {
        sender: `[Guild ${guild.name}]`,
        content: `<span style="color: #ffb74d;">${content}</span>`,
        timestamp: Date.now(),
    };
    for (const member of guild.memberUsernames) {
        const sid = findSocketIdByUsername(member, io);
        if (sid)
            io.to(sid).emit('chatMessage', message);
    }
}
function sendGuildChatMessage(guild, io, senderUsername, senderPlayerName, content) {
    const message = {
        sender: `[Guild ${guild.name}] @${senderUsername}`,
        content: `[<span style="color: #ffb74d;">${senderPlayerName}</span>] ${content}`,
        timestamp: Date.now(),
    };
    for (const member of guild.memberUsernames) {
        const sid = findSocketIdByUsername(member, io);
        if (sid)
            io.to(sid).emit('chatMessage', message);
    }
}
