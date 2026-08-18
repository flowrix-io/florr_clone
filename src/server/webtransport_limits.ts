/**
 * Admission control for WebTransport sessions.
 *
 * The WebSocket listener is protected mostly by the operating system: a TCP
 * connection costs the peer a handshake and a real, routable address, and the
 * kernel's accept queue bounds how fast they arrive. A QUIC listener sits on
 * UDP, where the process is doing that accounting itself, so the cheap defences
 * have to be written down.
 *
 * Two counters, both released when a session ends:
 *
 *   - a global ceiling, so total concurrent sessions can never grow past what
 *     the heap budget can hold (each one owns a frame buffer — see
 *     MAX_INBOUND_MESSAGE_BYTES in ws_server.ts);
 *   - a per-address ceiling, so a single source cannot occupy the global one.
 *
 * The per-address limit is meaningful *here* in a way it would not be for a
 * plain UDP service: QUIC validates the peer's address during the handshake
 * before a session exists, so the address a session is charged to is one the
 * peer demonstrably receives packets on. Spoofed sources never reach admission.
 *
 * The limit is deliberately not 1 — households behind one NAT, and a developer
 * with several tabs open, share an address legitimately.
 */

export interface AdmissionLimits {
    /** Total concurrent sessions across all peers. */
    maxSessions: number;
    /** Concurrent sessions from any one peer address. */
    maxSessionsPerAddress: number;
}

export type AdmissionResult =
    | { admitted: true }
    | { admitted: false; reason: string };

export class SessionAdmission {
    private readonly perAddress = new Map<string, number>();
    private total = 0;

    constructor(private readonly limits: AdmissionLimits) {}

    get activeSessions(): number {
        return this.total;
    }

    /**
     * Claim a slot for `address`. Every successful call must be paired with
     * exactly one `release(address)`, or the counters leak and the listener
     * eventually refuses everyone.
     */
    tryAdmit(address: string): AdmissionResult {
        if (this.total >= this.limits.maxSessions) {
            return { admitted: false, reason: `server session limit (${this.limits.maxSessions}) reached` };
        }
        // An address the transport could not report is counted under one shared
        // key rather than waved through, so it cannot become a free lane.
        const key = address || 'unknown';
        const forAddress = this.perAddress.get(key) ?? 0;
        if (forAddress >= this.limits.maxSessionsPerAddress) {
            return {
                admitted: false,
                reason: `per-address session limit (${this.limits.maxSessionsPerAddress}) reached for ${key}`,
            };
        }

        this.perAddress.set(key, forAddress + 1);
        this.total++;
        return { admitted: true };
    }

    /** Give back a slot claimed by `tryAdmit`. Safe to call more than once. */
    release(address: string): void {
        const key = address || 'unknown';
        const forAddress = this.perAddress.get(key);
        if (forAddress === undefined) return;

        if (forAddress <= 1) this.perAddress.delete(key);
        else this.perAddress.set(key, forAddress - 1);
        this.total = Math.max(0, this.total - 1);
    }
}
