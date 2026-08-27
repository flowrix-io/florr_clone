"use strict";
/**
 * The chat transcript, kept outside the `Chat` UI so it survives a respawn.
 *
 * A respawn is a full scene handover: the death screen's Continue button exits
 * to the title screen, which runs Game.cleanup() — that removes the chat
 * container from the DOM and strips every listener off the socket — and the
 * next Play builds a brand new Game with a brand new `Chat`. Anything the Chat
 * instance owned (its message nodes, its socket handlers) is gone at that
 * point, so the transcript lives here instead:
 *
 *  - the log is module state, so it outlives any single Chat instance;
 *  - the socket handlers are stable module functions, re-attached both by the
 *    next Chat and by the title screen's socket handover (see index.ts), so
 *    messages that arrive while the player is dead or picking a biome are still
 *    recorded with nothing on screen to show them;
 *  - a new Chat replays the log into its fresh container and then subscribes,
 *    so the player sees exactly the same backlog they had before dying.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChatLog = getChatLog;
exports.pushChatEntry = pushChatEntry;
exports.mergeChatHistory = mergeChatHistory;
exports.subscribeChatLog = subscribeChatLog;
exports.attachChatLogSocket = attachChatLogSocket;
/** Matches the on-screen cap in Chat.renderChatMessage(). */
const MAX_CHAT_LOG = 100;
const log = [];
const subscribers = new Set();
/** The transcript, oldest first. */
function getChatLog() {
    return log;
}
/** Record a message and hand it to whatever chat UI is currently mounted. */
function pushChatEntry(entry) {
    log.push(entry);
    while (log.length > MAX_CHAT_LOG)
        log.shift();
    for (const subscriber of subscribers)
        subscriber(entry);
}
/**
 * Fold a server-sent history batch in, skipping lines we already hold. The
 * server replays history on a cross-server transfer, which usually overlaps
 * what this client already saw.
 */
function mergeChatHistory(history) {
    for (const entry of history) {
        const duplicate = log.some(existing => existing.timestamp === entry.timestamp &&
            existing.sender === entry.sender &&
            existing.content === entry.content);
        if (!duplicate)
            pushChatEntry(entry);
    }
}
/**
 * Render callback for the mounted chat UI. Returns an unsubscribe function;
 * the log itself keeps running either way.
 */
function subscribeChatLog(onEntry) {
    subscribers.add(onEntry);
    return () => { subscribers.delete(onEntry); };
}
const onChatMessage = (message) => pushChatEntry(message);
const onChatHistory = (history) => mergeChatHistory(history);
/**
 * Start (or resume) recording from `socket`. Safe to call repeatedly: handlers
 * are stored in a Set keyed by function identity, so re-attaching the same
 * module functions is a no-op — which is what makes this the right call after
 * Game.cleanup()'s removeAllListeners() has wiped the socket clean.
 */
function attachChatLogSocket(socket) {
    socket.on('chatMessage', onChatMessage);
    socket.on('chatHistory', onChatHistory);
}
