/**
 * One account, one connection — except on loopback.
 *
 * Two live sockets on the same account are two authoritative copies of one
 * inventory: both loaded the same saved progress, both mutate their own copy,
 * and whichever saves last wins. That is a duplication bug in every direction
 * (craft in one tab, equip in the other, and the loser's save resurrects items
 * the winner spent), so a second authentication for an account kicks the first.
 *
 * The exception is a connection from the machine the server runs on. Developing
 * against a local server means driving several tabs at once — one playing, one
 * on the title screen, the load harness' clients — and that is exactly the setup
 * this guard would otherwise make impossible.
 *
 * The loopback test reads the accepted TCP peer address (see WSSocket.remote-
 * Address), never an X-Forwarded-For or similar client-supplied header, so a
 * remote client cannot claim to be local by asserting an address.
 *
 * A proxy in front of the origin is the thing that could break that. Anything
 * that terminates connections on this host and re-dials the server — Cloudflare
 * Tunnel, nginx — arrives on loopback, which would hand EVERY player the
 * developer exemption and switch the guard off wholesale. So a connection that
 * carries a forwarding header (`CF-Connecting-IP`, `X-Forwarded-For`) is never
 * treated as local: the header is the proxy announcing itself, and it is used
 * only in that negative direction, never as a claim of identity. Spoofing it
 * only costs the spoofer an exemption they would not otherwise have.
 */

import { players } from '../../constants';
import { ServerPlayer } from '../../player';
import { Server } from '../../ws_server';
import { lobbyPlayers, playerUserIds } from '../gameState';
import { AuthenticatedSocket } from '../shared/socketTypes';

/** The four octets of a dotted-quad IPv4 string, or null if it isn't one. */
function parseIPv4(text: string): number[] | null {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
    if (!m) return null;
    const octets = m.slice(1, 5).map(Number);
    return octets.some(o => o > 255) ? null : octets;
}

/**
 * An IPv6 address as its eight 16-bit groups, or null if it doesn't parse.
 *
 * Handles all three spellings that reach this code: uWS' uncompressed
 * `0000:0000:0000:0000:0000:ffff:7f00:0001`, the `::`-compressed form, and a
 * trailing dotted quad (`::ffff:127.0.0.1`).
 */
function expandIPv6(input: string): number[] | null {
    let text = input;
    let embeddedV4: number[] | null = null;

    const lastColon = text.lastIndexOf(':');
    if (lastColon >= 0 && text.slice(lastColon + 1).includes('.')) {
        const octets = parseIPv4(text.slice(lastColon + 1));
        if (!octets) return null;
        embeddedV4 = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
        text = text.slice(0, lastColon);
        // `::1.2.3.4` leaves a lone ':' behind; restore it to the `::` marker.
        if (text === ':') text = '::';
    }

    const halves = text.split('::');
    if (halves.length > 2) return null;
    const toGroups = (s: string): number[] =>
        s === '' ? [] : s.split(':').map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));

    const head = toGroups(halves[0]);
    const tail = halves.length === 2 ? toGroups(halves[1]) : [];
    if (head.concat(tail).some(Number.isNaN)) return null;

    const explicit = head.length + tail.length + (embeddedV4 ? 2 : 0);
    if (explicit > 8) return null;
    if (halves.length === 2) {
        return [...head, ...new Array(8 - explicit).fill(0), ...tail, ...(embeddedV4 || [])];
    }
    return explicit === 8 ? [...head, ...(embeddedV4 || [])] : null;
}

/** IPv4/IPv6 loopback, in any of the spellings uWS and the OS produce. */
export function isLoopbackAddress(address: string | undefined): boolean {
    if (!address) return false;
    const addr = address.trim().toLowerCase();
    if (!addr) return false;

    const v4 = parseIPv4(addr);
    if (v4) return v4[0] === 127;
    if (!addr.includes(':')) return false;

    const groups = expandIPv6(addr);
    if (!groups) return false;
    // ::1
    if (groups.slice(0, 7).every(g => g === 0) && groups[7] === 1) return true;
    // IPv4-mapped (::ffff:a.b.c.d): the first octet is the high byte of group 6.
    if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
        return (groups[6] >> 8) === 127;
    }
    return false;
}

/**
 * True if this socket is connected from the machine hosting the server, and
 * reached it directly rather than through a proxy running on that machine.
 */
export function isLocalSocket(socket: AuthenticatedSocket): boolean {
    if (socket.proxiedFor) return false;
    return isLoopbackAddress(socket.remoteAddress);
}

/** Best available identification of the peer, for logs only. */
function describeAddress(socket: AuthenticatedSocket): string {
    if (socket.proxiedFor) return `${socket.proxiedFor} via ${socket.remoteAddress || 'proxy'}`;
    return socket.remoteAddress || 'unknown ip';
}

/** The session a socket is holding, whether it is in the world or on the title screen. */
function sessionOf(socketId: string): ServerPlayer | undefined {
    return players[socketId] || lobbyPlayers[socketId];
}

/**
 * Drop every other socket already signed in as `userId`, unless both that socket
 * and the incoming one are local.
 *
 * Called from `authenticate` BEFORE the account is read back from disk: each
 * kicked session's progress is flushed here, synchronously, so the incoming one
 * loads the state the old tab actually ended with rather than a stale snapshot.
 * The kicked socket's own `disconnect` handler still runs the full teardown
 * (pets, cooldowns, world removal) when its close lands.
 *
 * @returns how many sessions were kicked.
 */
export function kickDuplicateSessions(
    io: Server,
    socket: AuthenticatedSocket,
    userId: string,
    savePlayerProgressImmediate: (player: ServerPlayer, userId: string) => void,
): number {
    const incomingIsLocal = isLocalSocket(socket);
    let kicked = 0;

    for (const other of Array.from(io.sockets.sockets.values()) as AuthenticatedSocket[]) {
        if (other.id === socket.id) continue;
        // socket.userId is set at authentication; playerUserIds covers a socket
        // whose session survived a soft leaveGame back to the title screen.
        const otherUserId = other.userId || playerUserIds[other.id];
        if (otherUserId !== userId) continue;
        // The multi-tab exemption: both ends of the pair have to be loopback.
        if (incomingIsLocal && isLocalSocket(other)) continue;

        const otherSession = sessionOf(other.id);
        if (otherSession) savePlayerProgressImmediate(otherSession, userId);

        console.log(`[SESSION] Kicking ${other.id} (${describeAddress(other)}): account ${userId} signed in from ${describeAddress(socket)}`);
        try {
            other.emit('sessionReplaced', {
                message: 'You signed in from another tab or device.',
            });
        } catch { /* socket already gone; the close below is still correct */ }
        // Graceful, so the message above is flushed before the socket closes.
        other.disconnect(true);
        kicked++;
    }

    return kicked;
}
