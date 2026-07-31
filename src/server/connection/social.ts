/**
 * Squads and guilds: create, invite, accept, decline, leave, kick, chat.
 *
 * Each handler is a thin permission/lookup shell over squadManager and
 * guildManager, which own the actual group state.
 */

import { players } from '../../constants';
import { acceptGuildInvite, broadcastGuildUpdate, createGuild, declineGuildInvite, findSocketIdByUsername as findGuildSocketIdByUsername, getGuildForUsername, inviteToGuild, kickFromGuild, leaveGuild as leaveGuildFn, sendGuildChatMessage, sendGuildSystemMessage, syncGuildToOnlineMembers } from '../guildManager';
import { MAX_SQUAD_SIZE, acceptInvite, createSquad, declineInvite, findPlayerByUsername, getSquadForPlayer, inviteToSquad, leaveSquad as leaveSquadFn, sendSquadChatMessage, sendSquadSystemMessage } from '../squadManager';
import { ConnectionContext } from './context';

export function registerSocialHandlers(ctx: ConnectionContext): void {
    const { io, socket } = ctx;

    socket.on('squadCreate', () => {
        if (!socket.username) return;
        const squad = createSquad(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are already in a squad.', timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        if (player) player.squadId = squad.id;
        io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: '<span style="color: #4fc3f7;">Squad created! Use /squad invite &lt;username&gt; to invite players.</span>', timestamp: Date.now() });
    });

    socket.on('squadInvite', (targetUsername: string) => {
        if (!socket.username) return;
        const targetSocketId = findPlayerByUsername(targetUsername, io);
        if (!targetSocketId) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `Player "${targetUsername}" not found.`, timestamp: Date.now() });
            return;
        }
        if (targetSocketId === socket.id) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You cannot invite yourself.', timestamp: Date.now() });
            return;
        }
        const error = inviteToSquad(socket.id, targetSocketId, socket.username);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        io.to(targetSocketId).emit('squadInviteReceived', { fromUsername: socket.username });
        io.to(targetSocketId).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} has invited you to their squad. Use /squad accept or /squad decline.</span>`, timestamp: Date.now() });
    });

    socket.on('squadAccept', () => {
        if (!socket.username) return;
        const { squad, error } = acceptInvite(socket.id);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        if (player) player.squadId = squad.id;
        const playerName = player ? player.name : socket.username;
        sendSquadSystemMessage(squad, io, `${playerName} has joined the squad.`);
        // Send squad update to all members
        for (const memberId of squad.memberIds) {
            io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
        }
    });

    socket.on('squadDecline', () => {
        if (!socket.username) return;
        declineInvite(socket.id);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Squad invite declined.', timestamp: Date.now() });
    });

    socket.on('squadLeave', () => {
        if (!socket.username) return;
        const squad = getSquadForPlayer(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        const playerName = player ? player.name : socket.username;
        if (player) player.squadId = undefined;

        leaveSquadFn(socket.id, io);
        io.to(socket.id).emit('squadUpdate', null);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You have left the squad.', timestamp: Date.now() });

        // Notify remaining members
        const remainingSquad = getSquadForPlayer(squad.memberIds.find(id => id !== socket.id) || '');
        if (remainingSquad) {
            sendSquadSystemMessage(remainingSquad, io, `${playerName} has left the squad.`);
            for (const memberId of remainingSquad.memberIds) {
                io.to(memberId).emit('squadUpdate', { squadId: remainingSquad.id, memberIds: remainingSquad.memberIds, leaderId: remainingSquad.leaderId });
            }
        }
    });

    // --- Guild events (also triggerable by /guild-* chat commands, but exposed directly for the UI menu) ---
    socket.on('guildCreate', (name: string) => {
        if (!socket.username) return;
        const { guild, error } = createGuild(socket.username, typeof name === 'string' ? name : '');
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to create guild.', timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">Guild "${guild.name}" created.</span>`, timestamp: Date.now() });
        syncGuildToOnlineMembers([socket.username], guild, io);
        broadcastGuildUpdate(guild, io);
    });

    socket.on('guildInvite', (targetUsername: string) => {
        if (!socket.username || typeof targetUsername !== 'string') return;
        const { guild, error } = inviteToGuild(socket.username, targetUsername);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to invite.', timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">Guild invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        const targetSid = findGuildSocketIdByUsername(targetUsername, io);
        if (targetSid) {
            io.to(targetSid).emit('guildInviteReceived', { guildName: guild.name, fromUsername: socket.username });
            io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">@${socket.username} has invited you to guild "${guild.name}". Use /guild-accept or /guild-decline.</span>`, timestamp: Date.now() });
        }
    });

    socket.on('guildAccept', () => {
        if (!socket.username) return;
        const { guild, error } = acceptGuildInvite(socket.username);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to accept invite.', timestamp: Date.now() });
            return;
        }
        sendGuildSystemMessage(guild, io, `${socket.username} has joined the guild.`);
        syncGuildToOnlineMembers([socket.username], guild, io);
        broadcastGuildUpdate(guild, io);
    });

    socket.on('guildDecline', () => {
        if (!socket.username) return;
        declineGuildInvite(socket.username);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Guild invite declined.', timestamp: Date.now() });
    });

    socket.on('guildLeave', () => {
        if (!socket.username) return;
        const leavingUsername = socket.username;
        const { guild, disbanded, promotedTo, error } = leaveGuildFn(socket.username);
        if (error) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('guildUpdate', null);
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You have left the guild.', timestamp: Date.now() });
        syncGuildToOnlineMembers([leavingUsername], null, io);
        if (!disbanded && guild) {
            sendGuildSystemMessage(guild, io, `${socket.username} has left the guild.`);
            if (promotedTo) sendGuildSystemMessage(guild, io, `${promotedTo} is now the guild leader.`);
            broadcastGuildUpdate(guild, io);
        }
    });

    socket.on('guildKick', (targetUsername: string) => {
        if (!socket.username || typeof targetUsername !== 'string') return;
        const { guild, error } = kickFromGuild(socket.username, targetUsername);
        if (error || !guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to kick.', timestamp: Date.now() });
            return;
        }
        sendGuildSystemMessage(guild, io, `${targetUsername} was kicked from the guild by ${socket.username}.`);
        const targetSid = findGuildSocketIdByUsername(targetUsername, io);
        if (targetSid) {
            io.to(targetSid).emit('guildUpdate', null);
            io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">You were kicked from guild "${guild.name}".</span>`, timestamp: Date.now() });
        }
        syncGuildToOnlineMembers([targetUsername], null, io);
        broadcastGuildUpdate(guild, io);
    });

    socket.on('guildInviteToSquad', (targetUsername: string) => {
        if (!socket.username || typeof targetUsername !== 'string') return;
        const guild = getGuildForUsername(socket.username);
        if (!guild || !guild.memberUsernames.some(u => u.toLowerCase() === targetUsername.toLowerCase())) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `${targetUsername} is not in your guild.`, timestamp: Date.now() });
            return;
        }
        const targetSid = findGuildSocketIdByUsername(targetUsername, io);
        if (!targetSid) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: `${targetUsername} is offline.`, timestamp: Date.now() });
            return;
        }
        let squad = getSquadForPlayer(socket.id);
        if (!squad) {
            squad = createSquad(socket.id, false);
            if (squad) {
                const player = players[socket.id];
                if (player) player.squadId = squad.id;
                io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
            }
        }
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Failed to create a squad.', timestamp: Date.now() });
            return;
        }
        const err = inviteToSquad(socket.id, targetSid, socket.username);
        if (err) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: err, timestamp: Date.now() });
            return;
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Squad invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
        io.to(targetSid).emit('squadInviteReceived', { fromUsername: socket.username });
        io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
    });

    socket.on('guildSquadAll', () => {
        if (!socket.username) return;
        const guild = getGuildForUsername(socket.username);
        if (!guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a guild.', timestamp: Date.now() });
            return;
        }
        let squad = getSquadForPlayer(socket.id);
        if (!squad) {
            squad = createSquad(socket.id, false);
            if (squad) {
                const player = players[socket.id];
                if (player) player.squadId = squad.id;
                io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
            }
        }
        if (!squad || squad.leaderId !== socket.id) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Only your squad leader can invite guildmates into the squad.', timestamp: Date.now() });
            return;
        }
        let invited = 0;
        for (const member of guild.memberUsernames) {
            if (member.toLowerCase() === socket.username.toLowerCase()) continue;
            if (squad.memberIds.length + 1 >= MAX_SQUAD_SIZE) break;
            const sid = findGuildSocketIdByUsername(member, io);
            if (!sid) continue;
            const err = inviteToSquad(socket.id, sid, socket.username);
            if (!err) {
                invited++;
                io.to(sid).emit('squadInviteReceived', { fromUsername: socket.username });
                io.to(sid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
            }
        }
        io.to(socket.id).emit('chatMessage', { sender: 'System', content: invited === 0 ? 'No online guildmates available to invite (or squad is full).' : `<span style="color: #ffb74d;">Sent squad invites to ${invited} online guildmate(s).</span>`, timestamp: Date.now() });
    });

    socket.on('guildChat', (message: string) => {
        if (!socket.username || typeof message !== 'string') return;
        const guild = getGuildForUsername(socket.username);
        if (!guild) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a guild.', timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        const playerName = player ? player.name : socket.username;
        sendGuildChatMessage(guild, io, socket.username, playerName, message);
    });

    socket.on('squadChat', (message: string) => {
        if (!socket.username) return;
        const squad = getSquadForPlayer(socket.id);
        if (!squad) {
            io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
            return;
        }
        const player = players[socket.id];
        const playerName = player ? player.name : socket.username;
        sendSquadChatMessage(squad, io, socket.username, playerName, message);
    });
}
