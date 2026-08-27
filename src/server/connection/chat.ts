/**
 * Chat, and the admin command console that shares its input box.
 *
 * NOTE: `chatHistory` is per-connection, so requestChatHistory replays only
 * what this socket itself sent. That is pre-existing behaviour, preserved here
 * unchanged.
 */

import { SECTION_CONFIGS, players } from '../../constants';
import { ApiKey, database } from '../../database';
import { getBotLevelForName, getBotLoadoutForName, triggerBotRaid } from '../botManager';
import { getAdminHelpText, handleAdminCommand } from '../commands';
import { hasTempAdmin } from '../tempAdmin';
import { rejectIfMuted } from '../chatMute';
import { filterChatImages, messageHasImage } from '../imageModeration';
import { MAX_GUILD_SIZE, acceptGuildInvite, broadcastGuildUpdate, buildGuildUpdate, createGuild, declineGuildInvite, findSocketIdByUsername as findGuildSocketIdByUsername, getGuildForUsername, inviteToGuild, kickFromGuild, leaveGuild as leaveGuildFn, listGuilds, sendGuildChatMessage, sendGuildSystemMessage, syncGuildToOnlineMembers } from '../guildManager';
import { getSessionPlayer } from '../gameState';
import { getOrCreateSquad, MAX_SQUAD_SIZE, acceptInvite, addBotToSquad, createSquad, declineInvite, findBotByName, findPlayerByUsername, getSquadForPlayer, inviteToSquad, joinPublicSquad, leaveSquad as leaveSquadFn, listPublicSquads, sendSquadChatMessage, sendSquadSystemMessage, setSquadVisibility } from '../squadManager';
import { ConnectionContext } from './context';

export function registerChatHandlers(ctx: ConnectionContext): void {
    const { io, socket } = ctx;
    const { commandDeps } = ctx.deps;

    // Add after other imports
    interface ChatMessage {
        sender: string;
        content: string;
        timestamp: number;
    }

    // Add to class-level variables after other declarations
    const chatHistory: ChatMessage[] = [];
    const MAX_CHAT_HISTORY = 100;  // Keep last 100 messages

    /**
     * Everyone may embed <img> in chat, but non-admin images are screened by
     * the moderation filter first (see server/imageModeration.ts). Admins are
     * trusted and skip it, as they always have.
     *
     * Screening is async, so sends go through `queueSend`, which chains them
     * per socket — a player's later messages wait behind their own pending
     * image check instead of overtaking it.
     */
    let sendChain: Promise<void> = Promise.resolve();

    const emitSelfNotice = (content: string): void => {
        io.to(socket.id).emit('chatMessage', {
            sender: 'System',
            content: `<span style="color: #ff8866;">${content}</span>`,
            timestamp: Date.now(),
        });
    };

    /** The broadcast-safe form of `message`, with rejected images stripped. */
    const applyImagePolicy = async (message: string, username: string): Promise<string> => {
        if (!messageHasImage(message)) return message;
        if (database.isUserAdmin(username)) return message;

        const { content, notices } = await filterChatImages(message, username);
        for (const notice of notices) emitSelfNotice(notice);
        return content;
    };

    /** Send `message` once its images clear, preserving this socket's ordering. */
    const queueSend = (message: string, username: string, send: (safeMessage: string) => void): void => {
        sendChain = sendChain
            .then(async () => {
                const safeMessage = await applyImagePolicy(message, username);
                // Drop a message that the filter emptied out — but only if the
                // filter is what emptied it, so blank sends behave as before.
                if (safeMessage !== message && !safeMessage.trim()) return;
                send(safeMessage);
            })
            .catch(err => console.error('[chat] failed to send message:', err));
    };

    // Add this inside the socket.io connection handler (after other socket handlers)
    socket.on('chatMessage', (message: string) => {
        if (!socket.username) return;  // Ensure user is authenticated

        // Check for admin commands
        if (handleAdminCommand(message, socket, io, commandDeps)) {
                return; // Don't process as regular chat message
        }

        // Normalize hyphenated squad commands to the space form so a single parser handles both.
        // /squad-find-public -> /squad find-public, /squad-invite -> /squad invite, etc.
        let normalizedMessage = message;
        if (normalizedMessage.startsWith('/squad-find-public')) {
            normalizedMessage = '/squad find-public' + normalizedMessage.substring('/squad-find-public'.length);
        } else {
            const squadDashMatch = normalizedMessage.match(/^\/squad-([a-z]+)(\s|$)/i);
            if (squadDashMatch) {
                normalizedMessage = `/squad ${squadDashMatch[1]}${normalizedMessage.substring(squadDashMatch[0].length - squadDashMatch[2].length)}`;
            }
        }

        // Check for squad commands
        if (normalizedMessage.startsWith('/squad ') || normalizedMessage === '/squad') {
            const args = normalizedMessage.substring('/squad'.length).trim().split(/\s+/);
            const subCommand = (args[0] || '').toLowerCase();

            if (subCommand === 'create') {
                const visibility = (args[1] || '').toLowerCase();
                const isPublic = visibility === 'public';
                const squad = createSquad(socket.id, isPublic);
                if (!squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are already in a squad.', timestamp: Date.now() });
                } else {
                    const player = getSessionPlayer(socket.id);
                    if (player) player.squadId = squad.id;
                    io.to(socket.id).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                    const label = isPublic ? 'public' : 'private';
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">${label} squad created! Use /squad-invite &lt;username&gt; to invite players${isPublic ? ', or wait for others to join via /squad-find-public' : ''}.</span>`, timestamp: Date.now() });
                }
            } else if ((subCommand === 'invite') && args[1]) {
                const targetUsername = args[1];
                // Try human first, then bot by display name.
                let targetId: string | null = findPlayerByUsername(targetUsername, io);
                let targetIsBot = false;
                if (!targetId) {
                    const botId = findBotByName(targetUsername);
                    if (botId) {
                        targetId = botId;
                        targetIsBot = true;
                    }
                }

                if (!targetId) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: `Player "${targetUsername}" not found.`, timestamp: Date.now() });
                } else if (targetId === socket.id) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You cannot invite yourself.', timestamp: Date.now() });
                } else if (targetIsBot) {
                    // Bots skip the invite flow and join directly.
                    const squad = getSquadForPlayer(socket.id);
                    if (!squad) {
                        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad. Use /squad create first.', timestamp: Date.now() });
                    } else if (squad.leaderId !== socket.id) {
                        io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Only the squad leader can invite players.', timestamp: Date.now() });
                    } else {
                        const { error } = addBotToSquad(squad.id, targetId);
                        if (error) {
                            io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
                        } else {
                            const botPlayer = players[targetId];
                            if (botPlayer) botPlayer.squadId = squad.id;
                            sendSquadSystemMessage(squad, io, `${botPlayer ? botPlayer.name : targetUsername} has joined the squad.`);
                            for (const memberId of squad.memberIds) {
                                if (memberId.startsWith('bot_')) continue;
                                io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                            }
                        }
                    }
                } else {
                    const error = inviteToSquad(socket.id, targetId, socket.username);
                    if (error) {
                        io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
                    } else {
                        io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Invite sent to ${targetUsername}.</span>`, timestamp: Date.now() });
                        io.to(targetId).emit('squadInviteReceived', { fromUsername: socket.username });
                        io.to(targetId).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} has invited you to their squad. Use /squad accept or /squad decline.</span>`, timestamp: Date.now() });
                    }
                }
            } else if (subCommand === 'find-public') {
                const publicSquads = listPublicSquads();
                if (publicSquads.length === 0) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'No public squads available. Create one with /squad create public.', timestamp: Date.now() });
                } else {
                    const lines = publicSquads.map(sq => {
                        const leader = players[sq.leaderId];
                        const leaderName = leader ? leader.name : 'Unknown';
                        return `${sq.id} &mdash; leader: ${leaderName} (${sq.memberIds.length}/${MAX_SQUAD_SIZE}) [/squad-join ${sq.id}]`;
                    });
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Public squads:<br/>${lines.join('<br/>')}</span>`, timestamp: Date.now() });
                }
            } else if (subCommand === 'join' && args[1]) {
                const { squad, error } = joinPublicSquad(args[1], socket.id);
                if (error || !squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to join squad.', timestamp: Date.now() });
                } else {
                    const player = getSessionPlayer(socket.id);
                    if (player) player.squadId = squad.id;
                    const playerName = player ? player.name : socket.username;
                    sendSquadSystemMessage(squad, io, `${playerName} has joined the squad.`);
                    for (const memberId of squad.memberIds) {
                        if (memberId.startsWith('bot_')) continue;
                        io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                    }
                }
            } else if (subCommand === 'public' || subCommand === 'private') {
                const { squad, error } = setSquadVisibility(socket.id, subCommand === 'public');
                if (error || !squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: error || 'Failed to update squad.', timestamp: Date.now() });
                } else {
                    sendSquadSystemMessage(squad, io, `Squad is now ${subCommand}.`);
                }
            } else if (subCommand === 'accept') {
                const { squad, error } = acceptInvite(socket.id);
                if (error) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: error, timestamp: Date.now() });
                } else {
                    const player = getSessionPlayer(socket.id);
                    if (player) player.squadId = squad.id;
                    const playerName = player ? player.name : socket.username;
                    sendSquadSystemMessage(squad, io, `${playerName} has joined the squad.`);
                    for (const memberId of squad.memberIds) {
                        io.to(memberId).emit('squadUpdate', { squadId: squad.id, memberIds: squad.memberIds, leaderId: squad.leaderId });
                    }
                }
            } else if (subCommand === 'decline') {
                declineInvite(socket.id);
                io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Squad invite declined.', timestamp: Date.now() });
            } else if (subCommand === 'leave') {
                const squad = getSquadForPlayer(socket.id);
                if (!squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
                } else {
                    const player = getSessionPlayer(socket.id);
                    const playerName = player ? player.name : socket.username;
                    if (player) player.squadId = undefined;
                    const membersBefore = [...squad.memberIds];
                    leaveSquadFn(socket.id, io);
                    io.to(socket.id).emit('squadUpdate', null);
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You have left the squad.', timestamp: Date.now() });
                    // Notify remaining members
                    const remainingId = membersBefore.find(id => id !== socket.id);
                    if (remainingId) {
                        const remainingSquad = getSquadForPlayer(remainingId);
                        if (remainingSquad) {
                            sendSquadSystemMessage(remainingSquad, io, `${playerName} has left the squad.`);
                            for (const memberId of remainingSquad.memberIds) {
                                io.to(memberId).emit('squadUpdate', { squadId: remainingSquad.id, memberIds: remainingSquad.memberIds, leaderId: remainingSquad.leaderId });
                            }
                        }
                    }
                }
            } else if (subCommand === 'info') {
                const squad = getSquadForPlayer(socket.id);
                if (!squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
                } else {
                    const memberNames = squad.memberIds.map(id => {
                        const p = players[id];
                        const isBotMember = id.startsWith('bot_');
                        const s = io.sockets.sockets.get(id) as any;
                        const name = p ? p.name : 'Unknown';
                        const username = isBotMember ? name : (s?.username || 'Unknown');
                        const isLeader = id === squad.leaderId ? ' (Leader)' : '';
                        return `@${username} [${name}]${isLeader}`;
                    });
                    const visibility = squad.isPublic ? 'public' : 'private';
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">Squad ${squad.id} [${visibility}] (${squad.memberIds.length}/${MAX_SQUAD_SIZE}):<br/>${memberNames.join('<br/>')}</span>`, timestamp: Date.now() });
                }
            } else {
                io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'Squad commands: /squad-create [public|private], /squad-invite &lt;username&gt;, /squad-find-public, /squad-join &lt;squadId&gt;, /squad-public, /squad-private, /squad-accept, /squad-decline, /squad-leave, /squad-info', timestamp: Date.now() });
            }
            return;
        }

        // Normalize hyphenated guild commands to the space form (mirrors the squad approach).
        let normalizedGuildMessage = message;
        const guildDashMatch = normalizedGuildMessage.match(/^\/guild-([a-z]+)(\s|$)/i);
        if (guildDashMatch) {
            normalizedGuildMessage = `/guild ${guildDashMatch[1]}${normalizedGuildMessage.substring(guildDashMatch[0].length - guildDashMatch[2].length)}`;
        }

        if (normalizedGuildMessage.startsWith('/guild ') || normalizedGuildMessage === '/guild') {
            if (!socket.username) return;
            const args = normalizedGuildMessage.substring('/guild'.length).trim().split(/\s+/);
            const subCommand = (args[0] || '').toLowerCase();
            const emitSystem = (content: string) => io.to(socket.id).emit('chatMessage', { sender: 'System', content, timestamp: Date.now() });

            if (subCommand === 'create') {
                const guildName = args.slice(1).join(' ').trim();
                if (!guildName) {
                    emitSystem('Usage: /guild-create &lt;name&gt;');
                } else {
                    const { guild, error } = createGuild(socket.username, guildName);
                    if (error || !guild) {
                        emitSystem(error || 'Failed to create guild.');
                    } else {
                        emitSystem(`<span style="color: #ffb74d;">Guild "${guild.name}" created. Use /guild-invite &lt;username&gt; to invite players.</span>`);
                        syncGuildToOnlineMembers([socket.username], guild, io);
                        broadcastGuildUpdate(guild, io);
                    }
                }
            } else if (subCommand === 'invite' && args[1]) {
                const { guild, error } = inviteToGuild(socket.username, args[1]);
                if (error || !guild) {
                    emitSystem(error || 'Failed to invite.');
                } else {
                    emitSystem(`<span style="color: #ffb74d;">Guild invite sent to ${args[1]}.</span>`);
                    const targetSid = findGuildSocketIdByUsername(args[1], io);
                    if (targetSid) {
                        io.to(targetSid).emit('guildInviteReceived', { guildName: guild.name, fromUsername: socket.username });
                        io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">@${socket.username} has invited you to guild "${guild.name}". Use /guild-accept or /guild-decline.</span>`, timestamp: Date.now() });
                    }
                }
            } else if (subCommand === 'accept') {
                const { guild, error } = acceptGuildInvite(socket.username);
                if (error || !guild) {
                    emitSystem(error || 'Failed to accept invite.');
                } else {
                    sendGuildSystemMessage(guild, io, `${socket.username} has joined the guild.`);
                    syncGuildToOnlineMembers([socket.username], guild, io);
                    broadcastGuildUpdate(guild, io);
                }
            } else if (subCommand === 'decline') {
                declineGuildInvite(socket.username);
                emitSystem('Guild invite declined.');
            } else if (subCommand === 'leave') {
                const existed = getGuildForUsername(socket.username);
                const leavingUsername = socket.username;
                const { guild, disbanded, promotedTo, error } = leaveGuildFn(socket.username);
                if (error) {
                    emitSystem(error);
                } else {
                    emitSystem('You have left the guild.');
                    socket.emit('guildUpdate', null);
                    syncGuildToOnlineMembers([leavingUsername], null, io);
                    if (disbanded) {
                        // nothing more to do
                    } else if (guild) {
                        sendGuildSystemMessage(guild, io, `${socket.username} has left the guild.`);
                        if (promotedTo) {
                            sendGuildSystemMessage(guild, io, `${promotedTo} is now the guild leader.`);
                        }
                        broadcastGuildUpdate(guild, io);
                    }
                    // silence unused var warning for narrowing
                    void existed;
                }
            } else if (subCommand === 'kick' && args[1]) {
                const target = args[1];
                const { guild, error } = kickFromGuild(socket.username, target);
                if (error || !guild) {
                    emitSystem(error || 'Failed to kick.');
                } else {
                    sendGuildSystemMessage(guild, io, `${target} was kicked from the guild by ${socket.username}.`);
                    const targetSid = findGuildSocketIdByUsername(target, io);
                    if (targetSid) {
                        io.to(targetSid).emit('guildUpdate', null);
                        io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #ffb74d;">You were kicked from guild "${guild.name}".</span>`, timestamp: Date.now() });
                    }
                    syncGuildToOnlineMembers([target], null, io);
                    broadcastGuildUpdate(guild, io);
                }
            } else if (subCommand === 'info') {
                const guild = getGuildForUsername(socket.username);
                if (!guild) {
                    emitSystem('You are not in a guild.');
                } else {
                    const payload = buildGuildUpdate(guild, io);
                    const onlineSet = new Set(payload.onlineUsernames.map(u => u.toLowerCase()));
                    const lines = guild.memberUsernames.map(u => {
                        const isLeader = u.toLowerCase() === guild.leaderUsername.toLowerCase();
                        const online = onlineSet.has(u.toLowerCase());
                        const dot = online ? '<span style="color: #6eff6e;">&#9679;</span>' : '<span style="color: #888;">&#9679;</span>';
                        return `${dot} @${u}${isLeader ? ' <span style="color: #ffd54f;">(Leader)</span>' : ''}`;
                    });
                    emitSystem(`<span style="color: #ffb74d;">Guild "${guild.name}" (${guild.memberUsernames.length}/${MAX_GUILD_SIZE}):<br/>${lines.join('<br/>')}</span>`);
                }
            } else if (subCommand === 'squad') {
                // Form a squad from online guildmates. Leader becomes squad leader; invites are sent to others.
                const guild = getGuildForUsername(socket.username);
                if (!guild) {
                    emitSystem('You are not in a guild.');
                } else {
                    const squad = getOrCreateSquad(io, socket.id);
                    if (!squad) {
                        emitSystem('Failed to create a squad.');
                    } else if (squad.leaderId !== socket.id) {
                        emitSystem('Only your squad leader can invite guildmates into the squad.');
                    } else {
                        let invited = 0;
                        for (const member of guild.memberUsernames) {
                            if (member.toLowerCase() === socket.username.toLowerCase()) continue;
                            if (squad.memberIds.length + 1 /* pending */ >= MAX_SQUAD_SIZE) break;
                            const sid = findGuildSocketIdByUsername(member, io);
                            if (!sid) continue;
                            const err = inviteToSquad(socket.id, sid, socket.username);
                            if (!err) {
                                invited++;
                                io.to(sid).emit('squadInviteReceived', { fromUsername: socket.username });
                                io.to(sid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
                            }
                        }
                        if (invited === 0) {
                            emitSystem('No online guildmates available to invite (or squad is full).');
                        } else {
                            emitSystem(`<span style="color: #ffb74d;">Sent squad invites to ${invited} online guildmate(s).</span>`);
                        }
                    }
                }
            } else if (subCommand === 'squad-invite' && args[1]) {
                // Invite a single guild member to your squad (UI button uses socket event instead).
                const targetUsername = args[1];
                const guild = getGuildForUsername(socket.username);
                if (!guild || !guild.memberUsernames.some(u => u.toLowerCase() === targetUsername.toLowerCase())) {
                    emitSystem(`${targetUsername} is not in your guild.`);
                } else {
                    const targetSid = findGuildSocketIdByUsername(targetUsername, io);
                    if (!targetSid) {
                        emitSystem(`${targetUsername} is offline.`);
                    } else {
                        const squad = getOrCreateSquad(io, socket.id);
                        if (!squad) {
                            emitSystem('Failed to create a squad.');
                        } else {
                            const err = inviteToSquad(socket.id, targetSid, socket.username);
                            if (err) emitSystem(err);
                            else {
                                emitSystem(`<span style="color: #4fc3f7;">Squad invite sent to ${targetUsername}.</span>`);
                                io.to(targetSid).emit('squadInviteReceived', { fromUsername: socket.username });
                                io.to(targetSid).emit('chatMessage', { sender: 'System', content: `<span style="color: #4fc3f7;">@${socket.username} (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>`, timestamp: Date.now() });
                            }
                        }
                    }
                }
            } else if (subCommand === 'list') {
                const all = listGuilds();
                if (all.length === 0) {
                    emitSystem('No guilds exist yet.');
                } else {
                    const lines = all.map(g => `"${g.name}" — ${g.memberUsernames.length}/${MAX_GUILD_SIZE} — leader @${g.leaderUsername}`);
                    emitSystem(`<span style="color: #ffb74d;">Guilds:<br/>${lines.join('<br/>')}</span>`);
                }
            } else {
                emitSystem('Guild commands: /guild-create &lt;name&gt;, /guild-invite &lt;username&gt;, /guild-accept, /guild-decline, /guild-leave, /guild-kick &lt;username&gt;, /guild-info, /guild-squad, /guild-list');
            }
            return;
        }

        // Check for guild chat shorthand: /g <message>
        if (message.startsWith('/g ')) {
            if (!socket.username) return;
            const guildMsg = message.substring(3).trim();
            if (guildMsg) {
                if (rejectIfMuted(io, socket.id, socket.username)) return;
                const guild = getGuildForUsername(socket.username);
                if (!guild) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a guild.', timestamp: Date.now() });
                } else {
                    const player = getSessionPlayer(socket.id);
                    const username = socket.username;
                    const playerName = player ? player.name : username;
                    queueSend(guildMsg, username, safeGuildMsg =>
                        sendGuildChatMessage(guild, io, username, playerName, safeGuildMsg));
                }
            }
            return;
        }

        // Check for squad chat shorthand: /s <message>
        if (message.startsWith('/s ')) {
            const squadMsg = message.substring(3).trim();
            if (squadMsg) {
                if (rejectIfMuted(io, socket.id, socket.username)) return;
                const squad = getSquadForPlayer(socket.id);
                if (!squad) {
                    io.to(socket.id).emit('chatMessage', { sender: 'System', content: 'You are not in a squad.', timestamp: Date.now() });
                } else {
                    const player = getSessionPlayer(socket.id);
                    const username = socket.username;
                    const playerName = player ? player.name : username;
                    queueSend(squadMsg, username, safeSquadMsg =>
                        sendSquadChatMessage(squad, io, username, playerName, safeSquadMsg));
                }
            }
            return;
        }

        // Check for commands
        if (message.startsWith('/')) {
            const command = message.substring(1).toLowerCase();

            if (command === 'help') {
                // A temporary grant unlocks the admin console, so /help must list
                // it too — otherwise the grantee can't see what they can now run.
                const isAdmin = (socket.username ? database.isUserAdmin(socket.username) : false)
                    || hasTempAdmin(socket.id);
                let helpText = 'Available commands:\n';
                helpText += '/biome - Show the most populated biome <br/>';
                helpText += '/level-from-string &lt;name&gt; - Show what level a bot named &lt;name&gt; would roll <br/>';
                helpText += '/loadout-from-string &lt;name&gt; - Show the loadout a bot named &lt;name&gt; would roll <br/>';
                helpText += '/create-api-key [label] - Issue an API key tied to your account for /api/v1/* <br/>';
                helpText += '/delete-api-key &lt;key-or-prefix&gt; - Revoke one of your API keys <br/>';
                helpText += '<br/>Post an image with &lt;img src="https://..."&gt; - links are screened, and inappropriate ones are blocked.<br/>';
                helpText += '<br/><b>Squad commands (groups of 4, share loot as one instance):</b><br/>';
                helpText += '/squad-create [public|private] - Create a new squad (defaults to private)<br/>';
                helpText += '/squad-invite &lt;username&gt; - Invite a player to your squad<br/>';
                helpText += '/squad-find-public - List joinable public squads<br/>';
                helpText += '/squad-join &lt;squadId&gt; - Join a public squad<br/>';
                helpText += '/squad-public / /squad-private - Toggle your squad\'s visibility (leader only)<br/>';
                helpText += '/squad-accept / /squad-decline - Respond to an invite<br/>';
                helpText += '/squad-leave - Leave your squad<br/>';
                helpText += '/squad-info - Show squad members<br/>';
                helpText += '/s &lt;message&gt; - Send a message to your squad<br/>';
                helpText += '<br/><b>Guild commands (up to 200 members, persistent):</b><br/>';
                helpText += '/guild-create &lt;name&gt; - Create a new guild (5-char alphanumeric ID)<br/>';
                helpText += '/guild-invite &lt;username&gt; - Invite a player (leader only)<br/>';
                helpText += '/guild-accept / /guild-decline - Respond to a guild invite<br/>';
                helpText += '/guild-leave - Leave your guild<br/>';
                helpText += '/guild-kick &lt;username&gt; - Kick a member (leader only)<br/>';
                helpText += '/guild-info - Show guild info<br/>';
                helpText += '/guild-squad - Invite online guildmates into a squad<br/>';
                helpText += '/guild-list - List all guilds<br/>';
                helpText += '/guild-menu - Toggle guild menu panel (client, also "G" key)<br/>';
                helpText += '/g &lt;message&gt; - Send a message to your guild<br/>';
                helpText += '<br/>Chat supports HTML tags: <b>bold</b>, <i>italic</i>, <u>underline</u>, <span style="color: red">colored text</span>, <blink>blinking text</blink>';

                if (isAdmin) {
                    helpText += getAdminHelpText();
                }

                io.to(socket.id).emit('chatMessage', {
                    sender: 'System',
                    content: helpText,
                    timestamp: Date.now()
                });
                return;
            }

            if (command === 'biome') {
                // Count players/bots per section (3x3 grid, 20000px each).
                // Mirrors getSectionAtPosition in src/graphics/sections.ts.
                const SECTION_SIZE = 20000;
                const counts = new Map<number, number>();
                for (const pid in players) {
                    const p = players[pid];
                    if (!p || p.isDead) continue;
                    const sx = Math.max(0, Math.min(2, Math.floor(p.x / SECTION_SIZE)));
                    const sy = Math.max(0, Math.min(2, Math.floor(p.y / SECTION_SIZE)));
                    const idx = sy * 3 + sx;
                    counts.set(idx, (counts.get(idx) ?? 0) + 1);
                }

                if (counts.size === 0) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No players are currently in any section.',
                        timestamp: Date.now()
                    });
                } else {
                    const sectionLabel = (idx: number) =>
                        SECTION_CONFIGS[idx]?.name || `Section ${idx + 1}`;
                    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
                    const [topIdx, topCount] = sorted[0];
                    const breakdown = sorted
                        .map(([idx, count]) => `${sectionLabel(idx)}: ${count}`)
                        .join('<br/>');
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: `<span style="color: #4fc3f7;">Most populated biome: <b>${sectionLabel(topIdx)}</b> (${topCount} player${topCount === 1 ? '' : 's'})</span><br/>${breakdown}`,
                        timestamp: Date.now()
                    });
                }
                return;
            }

            if (command === 'delete-api-key' || command.startsWith('delete-api-key ')) {
                if (!socket.username) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'You must be logged in to delete an API key.',
                        timestamp: Date.now()
                    });
                    return;
                }
                const spaceIdx = message.indexOf(' ');
                const arg = spaceIdx === -1 ? '' : message.substring(spaceIdx + 1).trim();
                if (!arg) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'Usage: /delete-api-key &lt;key-or-prefix&gt;',
                        timestamp: Date.now()
                    });
                    return;
                }
                // Only operate on keys owned by this user; an admin still has to use
                // an out-of-band path (editing inventory.json) to remove someone
                // else's key, so this command can never escalate across users.
                const ownedKeys = database.getAllApiKeys().filter(k => k.username === socket.username);
                let target = ownedKeys.find(k => k.key === arg);
                if (!target) {
                    const prefixMatches = ownedKeys.filter(k => k.key.startsWith(arg));
                    if (prefixMatches.length === 1) {
                        target = prefixMatches[0];
                    } else if (prefixMatches.length > 1) {
                        io.to(socket.id).emit('chatMessage', {
                            sender: 'System',
                            content: `Prefix "${arg}" is ambiguous — matches ${prefixMatches.length} of your keys. Provide more characters.`,
                            timestamp: Date.now()
                        });
                        return;
                    }
                }
                if (!target) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'No API key of yours matched that key or prefix.',
                        timestamp: Date.now()
                    });
                    return;
                }
                database.deleteApiKey(target.key);
                io.to(socket.id).emit('chatMessage', {
                    sender: 'System',
                    content: `Deleted API key "${target.label}" (${target.key.substring(0, 10)}...).`,
                    timestamp: Date.now()
                });
                return;
            }

            if (command === 'create-api-key' || command.startsWith('create-api-key ')) {
                if (!socket.username) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'You must be logged in to create an API key.',
                        timestamp: Date.now()
                    });
                    return;
                }
                const spaceIdx = message.indexOf(' ');
                const label = spaceIdx === -1 ? socket.username : message.substring(spaceIdx + 1).trim() || socket.username;
                // 64 random alphanumeric chars after the sk_ prefix.
                let body = '';
                while (body.length < 64) {
                    body += Math.random().toString(36).substring(2);
                }
                const key = `sk_${body.substring(0, 64)}`;
                const entry: ApiKey = {
                    key,
                    username: socket.username,
                    label,
                    createdAt: Date.now()
                };
                database.saveApiKey(entry);
                const isAdmin = database.isUserAdmin(socket.username);
                const scopeNote = isAdmin
                    ? 'Your account is admin, so this key has admin scope (can create star codes, broadcast notifications, etc.).'
                    : 'Your account is not admin, so this key has user scope only (read events, whoami). Admin endpoints will return 403.';
                io.to(socket.id).emit('chatMessage', {
                    sender: 'System',
                    content: `<b>[API KEY CREATED]</b><br/>Label: ${label}<br/>Key: <b>${key}</b><br/>Send this on requests as the X-API-Key header, or append ?api_key=&lt;key&gt; to the URL. Save it now — the full key is not shown again.<br/>${scopeNote}`,
                    timestamp: Date.now()
                });
                return;
            }

            if (command.startsWith('level-from-string')) {
                const spaceIdx = message.indexOf(' ');
                const name = spaceIdx === -1 ? '' : message.substring(spaceIdx + 1).trim();
                if (!name) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'Usage: /level-from-string &lt;name&gt;',
                        timestamp: Date.now()
                    });
                } else {
                    const level = getBotLevelForName(name);
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: `"${name}" would be level ${level}.`,
                        timestamp: Date.now()
                    });
                }
                return;
            }

            if (command.startsWith('loadout-from-string')) {
                const spaceIdx = message.indexOf(' ');
                const name = spaceIdx === -1 ? '' : message.substring(spaceIdx + 1).trim();
                if (!name) {
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: 'Usage: /loadout-from-string &lt;name&gt;',
                        timestamp: Date.now()
                    });
                } else {
                    const loadout = getBotLoadoutForName(name);
                    const lines = loadout.map((item: any, i: number) =>
                        `Slot ${i + 1}: ${item.rarity} ${item.petalType}`
                    );
                    io.to(socket.id).emit('chatMessage', {
                        sender: 'System',
                        content: `"${name}" loadout:<br/>${lines.join('<br/>')}`,
                        timestamp: Date.now()
                    });
                }
                return;
            }

            // Unknown command
            io.to(socket.id).emit('chatMessage', {
                sender: 'System',
                content: 'Unknown command. Available commands: /biome, /level-from-string, /loadout-from-string, /create-api-key, /delete-api-key',
                timestamp: Date.now()
            });
            return;
        }

        // Everything above this point is a command; from here the message is
        // broadcast to other players, which is exactly what a mute blocks.
        if (rejectIfMuted(io, socket.id, socket.username)) return;

        const player = getSessionPlayer(socket.id);
        const username = socket.username;
        const playerName = player ? player.name : username;

        queueSend(message, username, safeMessage => {
            const chatMessage: ChatMessage = {
                sender: `@${username}`,
                content: `[<span style="color: yellow;">${playerName}</span>] ${safeMessage}`,
                timestamp: Date.now()
            };

            // Add to history and trim if needed
            chatHistory.push(chatMessage);
            if (chatHistory.length > MAX_CHAT_HISTORY) {
                chatHistory.shift();
            }

            // Broadcast to all connected clients
            io.emit('chatMessage', chatMessage);
        });

        // Trigger a bot raid if the message mentions a raid-eligible boss tier.
        // Only supers and uniques count — never ultras. triggerBotRaid picks
        // the actual target (uniques preferred) or no-ops if none exist.
        if (/\b(super|unique)\b/i.test(message)) {
            const target = triggerBotRaid();
            if (target) {
                // io.emit('chatMessage', {
                //     sender: 'System',
                //     content: `<span style="color: #ff8866;">Bots are raiding a ${target.tier}!</span>`,
                //     timestamp: Date.now()
                // });
            }
        }
    });

    // Add this after socket handlers but before socket.on('authenticate'...)
    socket.on('requestChatHistory', () => {
        socket.emit('chatHistory', chatHistory);
    });
}
