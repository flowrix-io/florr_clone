"use strict";
/**
 * Squads and guilds: create, invite, accept, decline, leave, kick, chat.
 *
 * Each handler is a thin permission/lookup shell over squadManager and
 * guildManager, which own the actual group state.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSocialHandlers = registerSocialHandlers;
const guildManager_1 = require("../guildManager");
const gameState_1 = require("../gameState");
const squadManager_1 = require("../squadManager");
function registerSocialHandlers(ctx) {
    const { io, socket } = ctx;
    socket.on('squadCreate', () => {
        if (!socket.username)
            return;
        const squad = (0, squadManager_1.createSquad)(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are already in a squad.', timestamp: Date.now() });
            return;
        }
        const player = (0, gameState_1.getSessionPlayer)(socket.id);
        if (player)
            player.squadId = squad.id;
        io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: '<span style="color: #4fc3f7;">Squad created! Use /squad invite &lt;username&gt; to invite players.</span>', timestamp: Date.now() });
    });
    socket.on('squadInvite', (targetUsername) => {
        if (!socket.username)
            return;
        const targetSocketId = (0, squadManager_1.findPlayerByUsername)(targetUsername, io);
        if (!targetSocketId) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `Player "${targetUsername}" not found.`, timestamp: Date.now() });
            return;
        }
        if (targetSocketId === socket.id) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You cannot invite yourself.', timestamp: Date.now() });
            return;
        }
        const error = (0, squadManager_1.inviteToSquad)(socket.id, targetSocketId, socket.username);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        io.to(targetSocketId).emit('squadInviteReceived', { fromUsername: socket.username });
        io.to(targetSocketId).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} has invited you to their squad. Use /squad accept or /squad decline.</span>`, timestamp: Date.now() });
    });
    socket.on('squadAccept', () => {
        if (!socket.username)
            return;
        const { squad, error } = (0, squadManager_1.acceptInvite)(socket.id);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        const player = (0, gameState_1.getSessionPlayer)(socket.id);
        if (player)
            player.squadId = squad.id;
        const playerName = player ? player.name : socket.username;
        (0, squadManager_1.sendSquadSystemMessage)(squad, io, `${playerName} has joined the squad.`);
        // Send squad update to all members
        for (const memberId of squad.memberIds) {
            io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
        }
    });
    socket.on('squadDecline', () => {
        if (!socket.username)
            return;
        (0, squadManager_1.declineInvite)(socket.id);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Squad invite declined.', timestamp: Date.now() });
    });
    socket.on('squadLeave', () => {
        if (!socket.username)
            return;
        const squad = (0, squadManager_1.getSquadForPlayer)(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
            return;
        }
        const player = (0, gameState_1.getSessionPlayer)(socket.id);
        const playerName = player ? player.name : socket.username;
        if (player)
            player.squadId = undefined;
        (0, squadManager_1.leaveSquad)(socket.id, io);
        io.to(socket.id).emit('squadUpdate', null);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You have left the squad.', timestamp: Date.now() });
        // Notify remaining members
        const remainingSquad = (0, squadManager_1.getSquadForPlayer)(squad.memberIds.find(id => id !== socket.id) || '');
        if (remainingSquad) {
            (0, squadManager_1.sendSquadSystemMessage)(remainingSquad, io, `${playerName} has left the squad.`);
            for (const memberId of remainingSquad.memberIds) {
                io.to(memberId).emit('squadUpdate', { squadId: remainingSquad.id, memberIds: remainingSquad.memberIds, leaderId: remainingSquad.leaderId });
            }
        }
    });
    // --- Guild events (also triggerable by /guild-* chat commands, but exposed directly for the UI menu) ---
    socket.on('guildCreate', (name) => {
        if (!socket.username)
            return;
        const { guild, error } = (0, guildManager_1.createGuild)(socket.username, typeof name === 'string' ? name : '');
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to create guild.', timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">Guild "${guild.name}" created.</span>`, timestamp: Date.now() });
        (0, guildManager_1.syncGuildToOnlineMembers)([socket.username], guild, io);
        (0, guildManager_1.broadcastGuildUpdate)(guild, io);
    });
    socket.on('guildInvite', (targetUsername) => {
        if (!socket.username || typeof targetUsername !== 'string')
            return;
        const { guild, error } = (0, guildManager_1.inviteToGuild)(socket.username, targetUsername);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to invite.', timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">Guild invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        const targetSid = (0, guildManager_1.findSocketIdByUsername)(targetUsername, io);
        if (targetSid) {
            io.to(targetSid).emit('guildInviteReceived', { guildName: guild.name, fromUsername: socket.username });
            io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">@${socket.username} has invited you to guild "${guild.name}". Use /guild-accept or /guild-decline.</span>`, timestamp: Date.now() });
        }
    });
    socket.on('guildAccept', () => {
        if (!socket.username)
            return;
        const { guild, error } = (0, guildManager_1.acceptGuildInvite)(socket.username);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to accept invite.', timestamp: Date.now() });
            return;
        }
        (0, guildManager_1.sendGuildSystemMessage)(guild, io, `${socket.username} has joined the guild.`);
        (0, guildManager_1.syncGuildToOnlineMembers)([socket.username], guild, io);
        (0, guildManager_1.broadcastGuildUpdate)(guild, io);
    });
    socket.on('guildDecline', () => {
        if (!socket.username)
            return;
        (0, guildManager_1.declineGuildInvite)(socket.username);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Guild invite declined.', timestamp: Date.now() });
    });
    socket.on('guildLeave', () => {
        if (!socket.username)
            return;
        const leavingUsername = socket.username;
        const { guild, disbanded, promotedTo, error } = (0, guildManager_1.leaveGuild)(socket.username);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('guildUpdate', null);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You have left the guild.', timestamp: Date.now() });
        (0, guildManager_1.syncGuildToOnlineMembers)([leavingUsername], null, io);
        if (!disbanded && guild) {
            (0, guildManager_1.sendGuildSystemMessage)(guild, io, `${socket.username} has left the guild.`);
            if (promotedTo)
                (0, guildManager_1.sendGuildSystemMessage)(guild, io, `${promotedTo} is now the guild leader.`);
            (0, guildManager_1.broadcastGuildUpdate)(guild, io);
        }
    });
    socket.on('guildKick', (targetUsername) => {
        if (!socket.username || typeof targetUsername !== 'string')
            return;
        const { guild, error } = (0, guildManager_1.kickFromGuild)(socket.username, targetUsername);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to kick.', timestamp: Date.now() });
            return;
        }
        (0, guildManager_1.sendGuildSystemMessage)(guild, io, `${targetUsername} was kicked from the guild by ${socket.username}.`);
        const targetSid = (0, guildManager_1.findSocketIdByUsername)(targetUsername, io);
        if (targetSid) {
            io.to(targetSid).emit('guildUpdate', null);
            io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">You were kicked from guild "${guild.name}".</span>`, timestamp: Date.now() });
        }
        (0, guildManager_1.syncGuildToOnlineMembers)([targetUsername], null, io);
        (0, guildManager_1.broadcastGuildUpdate)(guild, io);
    });
    socket.on('guildInviteToSquad', (targetUsername) => {
        if (!socket.username || typeof targetUsername !== 'string')
            return;
        const guild = (0, guildManager_1.getGuildForUsername)(socket.username);
        if (!guild || !guild.memberUsernames.some(u => u.toLowerCase() === targetUsername.toLowerCase())) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `${targetUsername} is not in your guild.`, timestamp: Date.now() });
            return;
        }
        const targetSid = (0, guildManager_1.findSocketIdByUsername)(targetUsername, io);
        if (!targetSid) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `${targetUsername} is offline.`, timestamp: Date.now() });
            return;
        }
        let squad = (0, squadManager_1.getSquadForPlayer)(socket.id);
        if (!squad) {
            squad = (0, squadManager_1.createSquad)(socket.id, false);
            if (squad) {
                const player = (0, gameState_1.getSessionPlayer)(socket.id);
                if (player)
                    player.squadId = squad.id;
                io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
            }
        }
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Failed to create a squad.', timestamp: Date.now() });
            return;
        }
        const err = (0, squadManager_1.inviteToSquad)(socket.id, targetSid, socket.username);
        if (err) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: err, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Squad invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        io.to(targetSid).emit('squadInviteReceived', { fromUsername: socket.username });
        io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
    });
    socket.on('guildSquadAll', () => {
        if (!socket.username)
            return;
        const guild = (0, guildManager_1.getGuildForUsername)(socket.username);
        if (!guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a guild.', timestamp: Date.now() });
            return;
        }
        let squad = (0, squadManager_1.getSquadForPlayer)(socket.id);
        if (!squad) {
            squad = (0, squadManager_1.createSquad)(socket.id, false);
            if (squad) {
                const player = (0, gameState_1.getSessionPlayer)(socket.id);
                if (player)
                    player.squadId = squad.id;
                io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
            }
        }
        if (!squad || squad.leaderId !== socket.id) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Only your squad leader can invite guildmates into the squad.', timestamp: Date.now() });
            return;
        }
        let invited = 0;
        for (const member of guild.memberUsernames) {
            if (member.toLowerCase() === socket.username.toLowerCase())
                continue;
            if (squad.memberIds.length + 1 >= squadManager_1.MAX_SQUAD_SIZE)
                break;
            const sid = (0, guildManager_1.findSocketIdByUsername)(member, io);
            if (!sid)
                continue;
            const err = (0, squadManager_1.inviteToSquad)(socket.id, sid, socket.username);
            if (!err) {
                invited++;
                io.to(sid).emit('squadInviteReceived', { fromUsername: socket.username });
                io.to(sid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
            }
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: invited === 0 ? 'No online guildmates available to invite (or squad is full).' : `<span style="color: #ffb74d;">Sent squad invites to ${invited} online guildmate(s).</span>`, timestamp: Date.now() });
    });
    socket.on('guildChat', (message) => {
        if (!socket.username || typeof message !== 'string')
            return;
        const guild = (0, guildManager_1.getGuildForUsername)(socket.username);
        if (!guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a guild.', timestamp: Date.now() });
            return;
        }
        const player = (0, gameState_1.getSessionPlayer)(socket.id);
        const playerName = player ? player.name : socket.username;
        (0, guildManager_1.sendGuildChatMessage)(guild, io, socket.username, playerName, message);
    });
    socket.on('squadChat', (message) => {
        if (!socket.username)
            return;
        const squad = (0, squadManager_1.getSquadForPlayer)(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
            return;
        }
        const player = (0, gameState_1.getSessionPlayer)(socket.id);
        const playerName = player ? player.name : socket.username;
        (0, squadManager_1.sendSquadChatMessage)(squad, io, socket.username, playerName, message);
    });
}
