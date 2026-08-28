"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingInvites = exports.playerSquadMap = exports.squads = exports.MAX_SQUAD_SIZE = void 0;
exports.createSquad = createSquad;
exports.joinPublicSquad = joinPublicSquad;
exports.setSquadVisibility = setSquadVisibility;
exports.listPublicSquads = listPublicSquads;
exports.addBotToSquad = addBotToSquad;
exports.inviteToSquad = inviteToSquad;
exports.acceptInvite = acceptInvite;
exports.declineInvite = declineInvite;
exports.leaveSquad = leaveSquad;
exports.disbandSquad = disbandSquad;
exports.getSquadForPlayer = getSquadForPlayer;
exports.getSquadMemberIds = getSquadMemberIds;
exports.sendSquadChatMessage = sendSquadChatMessage;
exports.sendSquadSystemMessage = sendSquadSystemMessage;
exports.findPlayerByUsername = findPlayerByUsername;
exports.findBotByName = findBotByName;
exports.handlePlayerDisconnect = handlePlayerDisconnect;
exports.getPooledDamageContributors = getPooledDamageContributors;
exports.expandEligibleToPlayerIds = expandEligibleToPlayerIds;
exports.getOrCreateSquad = getOrCreateSquad;
exports.inviteGuildmatesToSquad = inviteGuildmatesToSquad;
const constants_1 = require("../constants");
const gameState_1 = require("./gameState");
exports.MAX_SQUAD_SIZE = 4;
function isBotId(id) {
    return id.startsWith('bot_');
}
// Active squads keyed by squad ID
exports.squads = new Map();
// Maps player socket ID -> squad ID for quick lookup
exports.playerSquadMap = new Map();
// Pending invites: maps target socket ID -> { squadId, fromSocketId, fromUsername, expires }
exports.pendingInvites = new Map();
const INVITE_EXPIRY_MS = 30000; // 30 seconds
function generateSquadId() {
    return 'squad_' + Math.random().toString(36).substr(2, 9);
}
function createSquad(leaderSocketId, isPublic = false) {
    if (exports.playerSquadMap.has(leaderSocketId))
        return null; // already in a squad
    // Bot-led squads are always public so humans can discover and join them.
    const effectiveIsPublic = isBotId(leaderSocketId) ? true : isPublic;
    const squad = {
        id: generateSquadId(),
        leaderId: leaderSocketId,
        memberIds: [leaderSocketId],
        isPublic: effectiveIsPublic,
        chatHistory: [],
    };
    exports.squads.set(squad.id, squad);
    exports.playerSquadMap.set(leaderSocketId, squad.id);
    return squad;
}
// Directly add a member to a squad (used for public-join and auto-join bots). No invite required.
function joinPublicSquad(squadId, memberId) {
    const squad = exports.squads.get(squadId);
    if (!squad)
        return { squad: null, error: 'Squad not found.' };
    if (!squad.isPublic)
        return { squad: null, error: 'That squad is private.' };
    if (squad.memberIds.length >= exports.MAX_SQUAD_SIZE)
        return { squad: null, error: 'Squad is full.' };
    if (exports.playerSquadMap.has(memberId))
        return { squad: null, error: 'You are already in a squad.' };
    squad.memberIds.push(memberId);
    exports.playerSquadMap.set(memberId, squad.id);
    return { squad, error: null };
}
// Leader-only: toggle visibility.
function setSquadVisibility(socketId, isPublic) {
    const squadId = exports.playerSquadMap.get(socketId);
    if (!squadId)
        return { squad: null, error: 'You are not in a squad.' };
    const squad = exports.squads.get(squadId);
    if (!squad)
        return { squad: null, error: 'Squad not found.' };
    if (squad.leaderId !== socketId)
        return { squad: null, error: 'Only the squad leader can change visibility.' };
    squad.isPublic = isPublic;
    return { squad, error: null };
}
// Returns public squads with room remaining.
function listPublicSquads() {
    const out = [];
    for (const squad of exports.squads.values()) {
        if (squad.isPublic && squad.memberIds.length < exports.MAX_SQUAD_SIZE) {
            out.push(squad);
        }
    }
    return out;
}
// Directly add a bot to a squad bypassing the invite flow (used when a human invites a bot).
function addBotToSquad(squadId, botId) {
    const squad = exports.squads.get(squadId);
    if (!squad)
        return { squad: null, error: 'Squad not found.' };
    if (squad.memberIds.length >= exports.MAX_SQUAD_SIZE)
        return { squad: null, error: 'Squad is full.' };
    if (exports.playerSquadMap.has(botId))
        return { squad: null, error: 'Player already has a squad.' };
    squad.memberIds.push(botId);
    exports.playerSquadMap.set(botId, squad.id);
    return { squad, error: null };
}
function inviteToSquad(inviterSocketId, targetSocketId, inviterUsername) {
    const squadId = exports.playerSquadMap.get(inviterSocketId);
    if (!squadId)
        return 'You are not in a squad.';
    const squad = exports.squads.get(squadId);
    if (!squad)
        return 'Squad not found.';
    if (squad.leaderId !== inviterSocketId)
        return 'Only the squad leader can invite players.';
    if (squad.memberIds.length >= exports.MAX_SQUAD_SIZE)
        return 'Squad is full (max 4 players).';
    if (exports.playerSquadMap.has(targetSocketId))
        return 'That player is already in a squad.';
    if (exports.pendingInvites.has(targetSocketId))
        return 'That player already has a pending invite.';
    exports.pendingInvites.set(targetSocketId, {
        squadId,
        fromSocketId: inviterSocketId,
        fromUsername: inviterUsername,
        expires: Date.now() + INVITE_EXPIRY_MS,
    });
    // Auto-expire the invite
    setTimeout(() => {
        const invite = exports.pendingInvites.get(targetSocketId);
        if (invite && invite.squadId === squadId) {
            exports.pendingInvites.delete(targetSocketId);
        }
    }, INVITE_EXPIRY_MS);
    return null; // no error
}
function acceptInvite(targetSocketId) {
    const invite = exports.pendingInvites.get(targetSocketId);
    if (!invite)
        return { squad: null, error: 'No pending invite.' };
    if (Date.now() > invite.expires) {
        exports.pendingInvites.delete(targetSocketId);
        return { squad: null, error: 'Invite has expired.' };
    }
    const squad = exports.squads.get(invite.squadId);
    if (!squad) {
        exports.pendingInvites.delete(targetSocketId);
        return { squad: null, error: 'Squad no longer exists.' };
    }
    if (squad.memberIds.length >= exports.MAX_SQUAD_SIZE) {
        exports.pendingInvites.delete(targetSocketId);
        return { squad: null, error: 'Squad is full.' };
    }
    if (exports.playerSquadMap.has(targetSocketId)) {
        exports.pendingInvites.delete(targetSocketId);
        return { squad: null, error: 'You are already in a squad.' };
    }
    squad.memberIds.push(targetSocketId);
    exports.playerSquadMap.set(targetSocketId, squad.id);
    exports.pendingInvites.delete(targetSocketId);
    return { squad, error: null };
}
function declineInvite(targetSocketId) {
    return exports.pendingInvites.delete(targetSocketId);
}
function leaveSquad(socketId, io) {
    const squadId = exports.playerSquadMap.get(socketId);
    if (!squadId)
        return 'You are not in a squad.';
    const squad = exports.squads.get(squadId);
    if (!squad) {
        exports.playerSquadMap.delete(socketId);
        return 'Squad not found.';
    }
    squad.memberIds = squad.memberIds.filter(id => id !== socketId);
    exports.playerSquadMap.delete(socketId);
    if (squad.memberIds.length === 0) {
        // Squad is empty, disband
        exports.squads.delete(squadId);
        return null;
    }
    // If the leader left, promote the next member
    if (squad.leaderId === socketId) {
        squad.leaderId = squad.memberIds[0];
        // Bot leaders keep the squad public so humans can still join.
        if (isBotId(squad.leaderId)) {
            squad.isPublic = true;
        }
        // Notify new leader
        const newLeader = constants_1.players[squad.leaderId];
        const newLeaderName = newLeader ? newLeader.name : 'Unknown';
        sendSquadSystemMessage(squad, io, `${newLeaderName} is now the squad leader.`);
    }
    return null;
}
function disbandSquad(squadId) {
    const squad = exports.squads.get(squadId);
    if (!squad)
        return;
    for (const memberId of squad.memberIds) {
        exports.playerSquadMap.delete(memberId);
    }
    exports.squads.delete(squadId);
}
function getSquadForPlayer(socketId) {
    const squadId = exports.playerSquadMap.get(socketId);
    if (!squadId)
        return null;
    return exports.squads.get(squadId) || null;
}
function getSquadMemberIds(socketId) {
    const squad = getSquadForPlayer(socketId);
    if (!squad)
        return [socketId];
    return squad.memberIds;
}
function sendSquadChatMessage(squad, io, senderUsername, senderPlayerName, content) {
    const message = {
        sender: `[Squad] @${senderUsername}`,
        content: `[<span style="color: yellow;">${senderPlayerName}</span>] ${content}`,
        timestamp: Date.now(),
    };
    squad.chatHistory.push(message);
    if (squad.chatHistory.length > 50) {
        squad.chatHistory.shift();
    }
    for (const memberId of squad.memberIds) {
        if (isBotId(memberId))
            continue;
        io.to(memberId).emit('chatMessage', message);
    }
}
function sendSquadSystemMessage(squad, io, content) {
    const message = {
        sender: '[Squad]',
        content: `<span style="color: #4fc3f7;">${content}</span>`,
        timestamp: Date.now(),
    };
    squad.chatHistory.push(message);
    if (squad.chatHistory.length > 50) {
        squad.chatHistory.shift();
    }
    for (const memberId of squad.memberIds) {
        if (isBotId(memberId))
            continue;
        io.to(memberId).emit('chatMessage', message);
    }
}
// Find a player socket ID by their username (searches the io server sockets)
function findPlayerByUsername(username, io) {
    for (const [socketId, socket] of io.sockets.sockets) {
        if (socket.username && socket.username.toLowerCase() === username.toLowerCase()) {
            return socketId;
        }
    }
    return null;
}
// Find a bot by in-game name (bots have no username — they match by display name).
function findBotByName(name) {
    const lower = name.toLowerCase();
    for (const id in constants_1.players) {
        if (!isBotId(id))
            continue;
        const p = constants_1.players[id];
        if (p && p.name && p.name.toLowerCase() === lower) {
            return id;
        }
    }
    return null;
}
// Clean up squad when a player disconnects
function handlePlayerDisconnect(socketId, io) {
    const squad = getSquadForPlayer(socketId);
    if (!squad)
        return;
    const player = constants_1.players[socketId];
    const playerName = player ? player.name : 'Unknown';
    leaveSquad(socketId, io);
    // Notify remaining members
    const remainingSquad = exports.squads.get(squad.id);
    if (remainingSquad) {
        sendSquadSystemMessage(remainingSquad, io, `${playerName} has left the squad.`);
    }
}
// Get squad's pooled damage for an enemy's damageContributors map.
// Returns a new map where squad members' damage is pooled under a single key (squad ID).
// Non-squad players keep their own entries.
function getPooledDamageContributors(damageContributors) {
    const pooled = new Map();
    const squadDamage = new Map(); // squadId -> total damage
    const squadPlayerCount = new Map(); // squadId -> number of contributing members
    for (const [playerId, damage] of damageContributors) {
        const squadId = exports.playerSquadMap.get(playerId);
        if (squadId) {
            squadDamage.set(squadId, (squadDamage.get(squadId) || 0) + damage);
            squadPlayerCount.set(squadId, (squadPlayerCount.get(squadId) || 0) + 1);
        }
        else {
            pooled.set(playerId, damage);
        }
    }
    // For squads, use average damage (total damage / number of contributing members)
    for (const [squadId, totalDamage] of squadDamage) {
        const memberCount = squadPlayerCount.get(squadId) || 1;
        pooled.set(squadId, totalDamage / memberCount);
    }
    return pooled;
}
// Expand a list of eligible "entity IDs" (which may include squad IDs) back into player socket IDs
function expandEligibleToPlayerIds(eligibleIds) {
    const playerIds = [];
    for (const id of eligibleIds) {
        const squad = exports.squads.get(id);
        if (squad) {
            // This is a squad ID - include all squad members
            playerIds.push(...squad.memberIds);
        }
        else {
            // This is a regular player ID
            playerIds.push(id);
        }
    }
    return playerIds;
}
/**
 * Returns the caller's squad, creating a private one if they have none.
 *
 * Four copies of this create-then-announce dance lived across the squad chat
 * commands and the social handlers. The `squadUpdate` emit is part of it: a
 * squad created implicitly this way is never announced anywhere else, so the
 * inviter's own client would otherwise not know it exists.
 */
function getOrCreateSquad(io, socketId) {
    const existing = getSquadForPlayer(socketId);
    if (existing)
        return existing;
    const squad = createSquad(socketId, false);
    if (!squad)
        return null;
    const player = (0, gameState_1.getSessionPlayer)(socketId);
    if (player)
        player.squadId = squad.id;
    io.to(socketId).emit('squadUpdate', {
        squadId: squad.id,
        memberIds: squad.memberIds,
        leaderId: squad.leaderId,
    });
    return squad;
}
/**
 * Invites every online guildmate into `squad`, up to MAX_SQUAD_SIZE.
 *
 * Both the `/squad-invite-guild` chat command and the `squadInviteGuild` socket
 * handler ran this loop, down to the invite message text. Returns how many
 * invites were actually sent, which is all either caller reports.
 */
function inviteGuildmatesToSquad(io, squad, inviterSocketId, inviterUsername, guildMemberUsernames, findSocketIdByUsername) {
    let invited = 0;
    for (const member of guildMemberUsernames) {
        if (member.toLowerCase() === inviterUsername.toLowerCase())
            continue;
        // +1 for the invite already in flight this iteration.
        if (squad.memberIds.length + 1 >= exports.MAX_SQUAD_SIZE)
            break;
        const sid = findSocketIdByUsername(member, io);
        if (!sid)
            continue;
        if (inviteToSquad(inviterSocketId, sid, inviterUsername))
            continue;
        invited++;
        io.to(sid).emit('squadInviteReceived', { fromUsername: inviterUsername });
        io.to(sid).emit('chatMessage', {
            sender: 'System',
            content: `<span style="color: #4fc3f7;">@${inviterUsername} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`,
            timestamp: Date.now(),
        });
    }
    return invited;
}
