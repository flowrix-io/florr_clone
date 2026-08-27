import { Server as SocketIOServer } from '../ws_server';
import { players } from '../constants';
import { getSessionPlayer } from './gameState';

export const MAX_SQUAD_SIZE = 4;

export interface Squad {
    id: string;
    leaderId: string; // socket ID (or bot ID) of the squad leader
    memberIds: string[]; // socket/bot IDs of all members (including leader)
    isPublic: boolean;
    chatHistory: Array<{ sender: string; content: string; timestamp: number }>;
}

function isBotId(id: string): boolean {
    return id.startsWith('bot_');
}

// Active squads keyed by squad ID
export const squads: Map<string, Squad> = new Map();

// Maps player socket ID -> squad ID for quick lookup
export const playerSquadMap: Map<string, string> = new Map();

// Pending invites: maps target socket ID -> { squadId, fromSocketId, fromUsername, expires }
export const pendingInvites: Map<string, { squadId: string; fromSocketId: string; fromUsername: string; expires: number }> = new Map();

const INVITE_EXPIRY_MS = 30000; // 30 seconds

function generateSquadId(): string {
    return 'squad_' + Math.random().toString(36).substr(2, 9);
}

export function createSquad(leaderSocketId: string, isPublic: boolean = false): Squad | null {
    if (playerSquadMap.has(leaderSocketId)) return null; // already in a squad

    // Bot-led squads are always public so humans can discover and join them.
    const effectiveIsPublic = isBotId(leaderSocketId) ? true : isPublic;

    const squad: Squad = {
        id: generateSquadId(),
        leaderId: leaderSocketId,
        memberIds: [leaderSocketId],
        isPublic: effectiveIsPublic,
        chatHistory: [],
    };

    squads.set(squad.id, squad);
    playerSquadMap.set(leaderSocketId, squad.id);
    return squad;
}

// Directly add a member to a squad (used for public-join and auto-join bots). No invite required.
export function joinPublicSquad(squadId: string, memberId: string): { squad: Squad | null; error: string | null } {
    const squad = squads.get(squadId);
    if (!squad) return { squad: null, error: 'Squad not found.' };
    if (!squad.isPublic) return { squad: null, error: 'That squad is private.' };
    if (squad.memberIds.length >= MAX_SQUAD_SIZE) return { squad: null, error: 'Squad is full.' };
    if (playerSquadMap.has(memberId)) return { squad: null, error: 'You are already in a squad.' };

    squad.memberIds.push(memberId);
    playerSquadMap.set(memberId, squad.id);
    return { squad, error: null };
}

// Leader-only: toggle visibility.
export function setSquadVisibility(socketId: string, isPublic: boolean): { squad: Squad | null; error: string | null } {
    const squadId = playerSquadMap.get(socketId);
    if (!squadId) return { squad: null, error: 'You are not in a squad.' };
    const squad = squads.get(squadId);
    if (!squad) return { squad: null, error: 'Squad not found.' };
    if (squad.leaderId !== socketId) return { squad: null, error: 'Only the squad leader can change visibility.' };
    squad.isPublic = isPublic;
    return { squad, error: null };
}

// Returns public squads with room remaining.
export function listPublicSquads(): Squad[] {
    const out: Squad[] = [];
    for (const squad of squads.values()) {
        if (squad.isPublic && squad.memberIds.length < MAX_SQUAD_SIZE) {
            out.push(squad);
        }
    }
    return out;
}

// Directly add a bot to a squad bypassing the invite flow (used when a human invites a bot).
export function addBotToSquad(squadId: string, botId: string): { squad: Squad | null; error: string | null } {
    const squad = squads.get(squadId);
    if (!squad) return { squad: null, error: 'Squad not found.' };
    if (squad.memberIds.length >= MAX_SQUAD_SIZE) return { squad: null, error: 'Squad is full.' };
    if (playerSquadMap.has(botId)) return { squad: null, error: 'Player already has a squad.' };
    squad.memberIds.push(botId);
    playerSquadMap.set(botId, squad.id);
    return { squad, error: null };
}

export function inviteToSquad(inviterSocketId: string, targetSocketId: string, inviterUsername: string): string | null {
    const squadId = playerSquadMap.get(inviterSocketId);
    if (!squadId) return 'You are not in a squad.';

    const squad = squads.get(squadId);
    if (!squad) return 'Squad not found.';

    if (squad.leaderId !== inviterSocketId) return 'Only the squad leader can invite players.';
    if (squad.memberIds.length >= MAX_SQUAD_SIZE) return 'Squad is full (max 4 players).';
    if (playerSquadMap.has(targetSocketId)) return 'That player is already in a squad.';
    if (pendingInvites.has(targetSocketId)) return 'That player already has a pending invite.';

    pendingInvites.set(targetSocketId, {
        squadId,
        fromSocketId: inviterSocketId,
        fromUsername: inviterUsername,
        expires: Date.now() + INVITE_EXPIRY_MS,
    });

    // Auto-expire the invite
    setTimeout(() => {
        const invite = pendingInvites.get(targetSocketId);
        if (invite && invite.squadId === squadId) {
            pendingInvites.delete(targetSocketId);
        }
    }, INVITE_EXPIRY_MS);

    return null; // no error
}

export function acceptInvite(targetSocketId: string): { squad: Squad; error: string | null } {
    const invite = pendingInvites.get(targetSocketId);
    if (!invite) return { squad: null as any, error: 'No pending invite.' };

    if (Date.now() > invite.expires) {
        pendingInvites.delete(targetSocketId);
        return { squad: null as any, error: 'Invite has expired.' };
    }

    const squad = squads.get(invite.squadId);
    if (!squad) {
        pendingInvites.delete(targetSocketId);
        return { squad: null as any, error: 'Squad no longer exists.' };
    }

    if (squad.memberIds.length >= MAX_SQUAD_SIZE) {
        pendingInvites.delete(targetSocketId);
        return { squad: null as any, error: 'Squad is full.' };
    }

    if (playerSquadMap.has(targetSocketId)) {
        pendingInvites.delete(targetSocketId);
        return { squad: null as any, error: 'You are already in a squad.' };
    }

    squad.memberIds.push(targetSocketId);
    playerSquadMap.set(targetSocketId, squad.id);
    pendingInvites.delete(targetSocketId);

    return { squad, error: null };
}

export function declineInvite(targetSocketId: string): boolean {
    return pendingInvites.delete(targetSocketId);
}

export function leaveSquad(socketId: string, io: SocketIOServer): string | null {
    const squadId = playerSquadMap.get(socketId);
    if (!squadId) return 'You are not in a squad.';

    const squad = squads.get(squadId);
    if (!squad) {
        playerSquadMap.delete(socketId);
        return 'Squad not found.';
    }

    squad.memberIds = squad.memberIds.filter(id => id !== socketId);
    playerSquadMap.delete(socketId);

    if (squad.memberIds.length === 0) {
        // Squad is empty, disband
        squads.delete(squadId);
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
        const newLeader = players[squad.leaderId];
        const newLeaderName = newLeader ? newLeader.name : 'Unknown';
        sendSquadSystemMessage(squad, io, `${newLeaderName} is now the squad leader.`);
    }

    return null;
}

export function disbandSquad(squadId: string): void {
    const squad = squads.get(squadId);
    if (!squad) return;

    for (const memberId of squad.memberIds) {
        playerSquadMap.delete(memberId);
    }
    squads.delete(squadId);
}

export function getSquadForPlayer(socketId: string): Squad | null {
    const squadId = playerSquadMap.get(socketId);
    if (!squadId) return null;
    return squads.get(squadId) || null;
}

export function getSquadMemberIds(socketId: string): string[] {
    const squad = getSquadForPlayer(socketId);
    if (!squad) return [socketId];
    return squad.memberIds;
}

export function sendSquadChatMessage(
    squad: Squad,
    io: SocketIOServer,
    senderUsername: string,
    senderPlayerName: string,
    content: string
): void {
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
        if (isBotId(memberId)) continue;
        io.to(memberId).emit('chatMessage', message);
    }
}

export function sendSquadSystemMessage(squad: Squad, io: SocketIOServer, content: string): void {
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
        if (isBotId(memberId)) continue;
        io.to(memberId).emit('chatMessage', message);
    }
}

// Find a player socket ID by their username (searches the io server sockets)
export function findPlayerByUsername(username: string, io: SocketIOServer): string | null {
    for (const [socketId, socket] of io.sockets.sockets) {
        if ((socket as any).username && (socket as any).username.toLowerCase() === username.toLowerCase()) {
            return socketId;
        }
    }
    return null;
}

// Find a bot by in-game name (bots have no username — they match by display name).
export function findBotByName(name: string): string | null {
    const lower = name.toLowerCase();
    for (const id in players) {
        if (!isBotId(id)) continue;
        const p = players[id];
        if (p && p.name && p.name.toLowerCase() === lower) {
            return id;
        }
    }
    return null;
}

// Clean up squad when a player disconnects
export function handlePlayerDisconnect(socketId: string, io: SocketIOServer): void {
    const squad = getSquadForPlayer(socketId);
    if (!squad) return;

    const player = players[socketId];
    const playerName = player ? player.name : 'Unknown';

    leaveSquad(socketId, io);

    // Notify remaining members
    const remainingSquad = squads.get(squad.id);
    if (remainingSquad) {
        sendSquadSystemMessage(remainingSquad, io, `${playerName} has left the squad.`);
    }
}

// Get squad's pooled damage for an enemy's damageContributors map.
// Returns a new map where squad members' damage is pooled under a single key (squad ID).
// Non-squad players keep their own entries.
export function getPooledDamageContributors(damageContributors: Map<string, number>): Map<string, number> {
    const pooled = new Map<string, number>();
    const squadDamage = new Map<string, number>(); // squadId -> total damage
    const squadPlayerCount = new Map<string, number>(); // squadId -> number of contributing members

    for (const [playerId, damage] of damageContributors) {
        const squadId = playerSquadMap.get(playerId);
        if (squadId) {
            squadDamage.set(squadId, (squadDamage.get(squadId) || 0) + damage);
            squadPlayerCount.set(squadId, (squadPlayerCount.get(squadId) || 0) + 1);
        } else {
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
export function expandEligibleToPlayerIds(eligibleIds: string[]): string[] {
    const playerIds: string[] = [];
    for (const id of eligibleIds) {
        const squad = squads.get(id);
        if (squad) {
            // This is a squad ID - include all squad members
            playerIds.push(...squad.memberIds);
        } else {
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
export function getOrCreateSquad(io: SocketIOServer, socketId: string): Squad | null {
    const existing = getSquadForPlayer(socketId);
    if (existing) return existing;

    const squad = createSquad(socketId, false);
    if (!squad) return null;

    const player = getSessionPlayer(socketId);
    if (player) player.squadId = squad.id;
    io.to(socketId).emit('squadUpdate', {
        squadId: squad.id,
        memberIds: squad.memberIds,
        leaderId: squad.leaderId,
    });
    return squad;
}
