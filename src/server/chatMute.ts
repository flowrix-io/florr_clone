/**
 * Chat mutes — the `/admin mute` and `/admin unmute` console commands.
 *
 * The flag lives on the account record (see `User.muted` in database.ts), so a
 * mute survives reconnects, extra tabs and restarts. This module is only the
 * gate: every path that turns a player's typed text into a message other people
 * see calls `rejectIfMuted` first — global chat, `/g` and `/s`, and the
 * guildChat/squadChat socket events the UI panels use.
 *
 * A mute silences chat only. Commands (including `/admin` for an admin who
 * muted themselves), squad/guild membership actions and gameplay are untouched.
 */

import { database } from '../database';
import { Server as SocketIOServer } from '../ws_server';

export function isChatMuted(username?: string): boolean {
    return !!username && database.isUserMuted(username);
}

/**
 * True if `username` is muted — in which case the sender is told why and the
 * caller must drop the message.
 */
export function rejectIfMuted(io: SocketIOServer, socketId: string, username?: string): boolean {
    if (!isChatMuted(username)) return false;
    io.to(socketId).emit('chatMessage', {
        sender: 'System',
        content: '<span style="color: #ff8866;">You are muted and cannot send chat messages.</span>',
        timestamp: Date.now()
    });
    return true;
}
